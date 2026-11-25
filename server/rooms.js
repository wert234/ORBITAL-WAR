'use strict';

const CONFIG = require('./config');

function isValidToken(token) {
  return typeof token === 'string' && token.length >= 16 && token.length <= 100 && /^[a-zA-Z0-9_-]+$/.test(token);
}

class RoomManager {
  constructor(io, gameManager) {
    this.io = io;
    this.gameManager = gameManager;
    this.rooms = new Map();
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
  }

  createCode() {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const code = String(10000 + Math.floor(Math.random() * 90000));
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Unable to allocate a unique room code');
  }

  bindSocket(socket) {
    socket.on('room:create', payload => this.createRoom(socket, payload));
    socket.on('room:createBot', payload => this.createBotRoom(socket, payload));
    socket.on('room:join', payload => this.joinRoom(socket, payload));
    socket.on('room:cancel', () => this.cancelRoom(socket));
    socket.on('room:leave', () => this.leaveRoom(socket));
    socket.on('room:rematch', () => this.requestRematch(socket));
    socket.on('disconnect', () => this.handleDisconnect(socket));
  }

  emitError(socket, code, message) {
    socket.emit('room:error', { code, message });
  }

  createRoom(socket, payload) {
    const token = payload?.token;
    if (!isValidToken(token)) return this.emitError(socket, 'BAD_TOKEN', 'Не удалось создать защищённую сессию. Обновите страницу.');
    if (socket.data.roomCode) this.detachSocket(socket);

    const code = this.createCode();
    const room = {
      code,
      status: 'waiting',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      players: [this.makePlayer(0, token, socket.id), null],
      game: null
    };
    this.rooms.set(code, room);
    socket.data.roomCode = code;
    socket.data.playerIndex = 0;
    socket.emit('room:created', { code, token, playerIndex: 0 });
  }


  createBotRoom(socket, payload) {
    const token = payload?.token;
    if (!isValidToken(token)) return this.emitError(socket, 'BAD_TOKEN', 'Не удалось создать защищённую сессию. Обновите страницу.');
    if (socket.data.roomCode) this.detachSocket(socket);

    const code = this.createCode();
    const botToken = `bot-${code}-${Date.now()}`;
    const room = {
      code,
      status: 'active',
      isBotMatch: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      players: [
        this.makePlayer(0, token, socket.id),
        { ...this.makePlayer(1, botToken, null), isBot: true }
      ],
      game: null
    };
    this.rooms.set(code, room);
    socket.data.roomCode = code;
    socket.data.playerIndex = 0;
    socket.emit('room:created', { code, token, playerIndex: 0, mode: 'bot' });
    this.gameManager.startRoom(room);
  }

  makePlayer(playerIndex, token, socketId) {
    return {
      playerIndex,
      token,
      socketId,
      connected: true,
      disconnectTimer: null,
      disconnectedAt: null,
      rematch: false
    };
  }

  joinRoom(socket, payload) {
    const code = String(payload?.code || '').trim();
    const token = payload?.token;
    if (!/^\d{5}$/.test(code)) return this.emitError(socket, 'BAD_CODE', 'Введите пятизначный код комнаты.');
    if (!isValidToken(token)) return this.emitError(socket, 'BAD_TOKEN', 'Не удалось проверить сессию. Обновите страницу.');
    const room = this.rooms.get(code);
    if (!room) return this.emitError(socket, 'ROOM_NOT_FOUND', 'Комната не найдена. Проверьте код.');

    const existing = room.players.find(player => player && player.token === token);
    if (!existing && socket.data.roomCode === room.code) {
      return this.emitError(socket, 'ALREADY_IN_ROOM', 'Это соединение уже занято другим местом в комнате.');
    }
    if (existing) {
      if (socket.data.roomCode && socket.data.roomCode !== room.code) this.detachSocket(socket);
      if (existing.connected && existing.socketId !== socket.id) {
        const oldSocket = this.io.sockets.sockets.get(existing.socketId);
        if (oldSocket && oldSocket.connected) {
          return this.emitError(socket, 'SESSION_ACTIVE', 'Эта игровая сессия уже подключена на другом устройстве.');
        }
      }
      if (existing.disconnectTimer) clearTimeout(existing.disconnectTimer);
      const wasDisconnected = !existing.connected;
      existing.connected = true;
      existing.socketId = socket.id;
      existing.disconnectedAt = null;
      room.updatedAt = Date.now();
      socket.data.roomCode = room.code;
      socket.data.playerIndex = existing.playerIndex;
      socket.emit('room:joined', {
        code: room.code,
        token,
        playerIndex: existing.playerIndex,
        reconnected: wasDisconnected,
        status: room.status
      });
      if (wasDisconnected) this.notifyOther(room, existing.playerIndex, 'room:playerReconnected', { playerIndex: existing.playerIndex });
      if (room.status === 'waiting' && room.players.every(player => player && player.connected)) {
        room.status = 'active';
        this.gameManager.startRoom(room);
      } else if (room.status === 'active') {
        socket.emit('match:started', {
          code: room.code,
          playerIndex: existing.playerIndex,
          resumed: true,
          opponentType: room.isBotMatch ? 'bot' : 'human'
        });
        this.gameManager.broadcastRoom(room.code, true);
      } else if (room.status === 'ended' && room.game) {
        socket.emit('match:ended', {
          result: existing.playerIndex === room.game.winnerIndex ? 'win' : 'loss',
          winnerIndex: room.game.winnerIndex,
          reason: room.game.endReason || 'base-destroyed'
        });
      }
      return;
    }

    const freeIndex = room.players.findIndex(player => player === null);
    if (freeIndex < 0 || room.status !== 'waiting') {
      return this.emitError(socket, 'ROOM_FULL', 'В комнате уже два игрока.');
    }
    if (socket.data.roomCode) this.detachSocket(socket);

    room.players[freeIndex] = this.makePlayer(freeIndex, token, socket.id);
    room.updatedAt = Date.now();
    socket.data.roomCode = room.code;
    socket.data.playerIndex = freeIndex;
    socket.emit('room:joined', { code: room.code, token, playerIndex: freeIndex, reconnected: false, status: room.status });

    if (room.players.every(player => player && player.connected)) {
      room.status = 'active';
      room.updatedAt = Date.now();
      this.gameManager.startRoom(room);
    }
  }

  notifyOther(room, exceptIndex, eventName, payload) {
    room.players.forEach((player, index) => {
      if (index === exceptIndex || !player?.connected || !player.socketId) return;
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (socket) socket.emit(eventName, payload);
    });
  }

  getSession(socket) {
    const code = socket.data.roomCode;
    const playerIndex = socket.data.playerIndex;
    const room = code ? this.rooms.get(code) : null;
    if (!room || !Number.isInteger(playerIndex)) return null;
    const player = room.players[playerIndex];
    if (!player || player.socketId !== socket.id) return null;
    return { room, playerIndex, player };
  }

  cancelRoom(socket) {
    const session = this.getSession(socket);
    if (!session) return;
    if (session.room.status !== 'waiting') {
      return this.emitError(socket, 'CANNOT_CANCEL', 'Матч уже начался.');
    }
    this.closeRoom(session.room, 'Создатель комнаты отменил ожидание.');
  }

  leaveRoom(socket) {
    const session = this.getSession(socket);
    if (!session) return;
    const { room, playerIndex } = session;
    if (room.status === 'waiting' || room.status === 'ended' || room.isBotMatch) {
      this.closeRoom(room, 'Игрок покинул комнату.');
      return;
    }
    // Explicitly leaving an active match is a forfeit, unlike an unexpected
    // network drop which receives the full 30-second reconnect grace period.
    this.gameManager.finishByForfeit(room, playerIndex);
    this.clearSocketSession(socket);
    this.markPlayerDisconnected(room, playerIndex, true);
  }

  requestRematch(socket) {
    const session = this.getSession(socket);
    if (!session || session.room.status !== 'ended') return;
    const { room, playerIndex } = session;
    session.player.rematch = true;
    room.updatedAt = Date.now();
    if (room.isBotMatch) {
      const botPlayer = room.players[1];
      if (botPlayer) botPlayer.rematch = true;
      this.gameManager.startRoom(room);
      return;
    }
    room.players.forEach(player => {
      if (!player?.connected || !player.socketId) return;
      const target = this.io.sockets.sockets.get(player.socketId);
      if (target) target.emit('room:rematchStatus', {
        ready: room.players.filter(item => item?.rematch).length,
        total: 2
      });
    });
    if (room.players.every(player => player && player.connected && player.rematch)) {
      room.status = 'active';
      room.updatedAt = Date.now();
      this.gameManager.startRoom(room);
    }
  }

  handleDisconnect(socket) {
    const session = this.getSession(socket);
    if (!session) return;
    this.markPlayerDisconnected(session.room, session.playerIndex, false);
  }

  markPlayerDisconnected(room, playerIndex, explicit) {
    const player = room.players[playerIndex];
    if (!player) return;
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    player.connected = false;
    player.disconnectedAt = Date.now();
    const oldSocketId = player.socketId;
    if (!explicit) player.socketId = oldSocketId;
    room.updatedAt = Date.now();
    this.notifyOther(room, playerIndex, 'room:playerDisconnected', {
      playerIndex,
      graceMs: CONFIG.RECONNECT_GRACE_MS
    });

    player.disconnectTimer = setTimeout(() => {
      if (player.connected) return;
      if (room.status === 'waiting') {
        this.closeRoom(room, 'Игрок не вернулся в комнату.');
      } else if (room.status === 'active') {
        this.gameManager.finishByForfeit(room, playerIndex);
      } else if (room.status === 'ended' && room.players.every(item => !item || !item.connected)) {
        this.closeRoom(room, 'Комната закрыта из-за отсутствия игроков.');
      }
    }, CONFIG.RECONNECT_GRACE_MS);
  }

  detachSocket(socket) {
    const session = this.getSession(socket);
    if (session) this.markPlayerDisconnected(session.room, session.playerIndex, true);
    this.clearSocketSession(socket);
  }

  clearSocketSession(socket) {
    delete socket.data.roomCode;
    delete socket.data.playerIndex;
  }

  closeRoom(room, message) {
    if (!this.rooms.has(room.code)) return;
    room.players.forEach((player, index) => {
      if (!player) return;
      if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
      if (player.socketId) {
        const socket = this.io.sockets.sockets.get(player.socketId);
        if (socket) {
          socket.emit('room:closed', { message });
          this.clearSocketSession(socket);
        }
      }
    });
    this.gameManager.destroyRoom(room.code);
    this.rooms.delete(room.code);
  }

  cleanup() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const noConnectedPlayers = room.players.every(player => !player || !player.connected);
      const staleLobbyOrResult = (room.status === 'waiting' || room.status === 'ended') && now - room.updatedAt > CONFIG.ROOM_IDLE_MS;
      if ((noConnectedPlayers && now - room.updatedAt > CONFIG.ROOM_IDLE_MS) || staleLobbyOrResult) {
        this.closeRoom(room, 'Комната автоматически очищена.');
      }
    }
  }

  shutdown() {
    clearInterval(this.cleanupTimer);
    for (const room of this.rooms.values()) {
      room.players.forEach(player => player?.disconnectTimer && clearTimeout(player.disconnectTimer));
    }
    this.rooms.clear();
  }
}

module.exports = RoomManager;
