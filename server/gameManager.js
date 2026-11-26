'use strict';

const CONFIG = require('./config');
const { makeGameState } = require('./entities');
const { applyCommand, stepGame, moduleSlotCount } = require('./gameLogic');
const { runBotAI } = require('./botAI');

function transformY(playerIndex, y) {
  const baseOffset = CONFIG.world.viewportBaseY;
  return playerIndex === 0
    ? baseOffset - y
    : baseOffset - (CONFIG.world.baseSeparation - y);
}

class GameManager {
  constructor(io) {
    this.io = io;
    this.games = new Map();
    this.onMatchEnd = null;
    this.lastStepAt = Date.now();
    this.stepInterval = setInterval(() => this.step(), 1000 / CONFIG.TICK_RATE);
  }

  startRoom(room) {
    const state = makeGameState();
    room.game = state;
    room.status = 'active';
    room.players.forEach((player, playerIndex) => {
      if (!player) return;
      player.rematch = false;
      if (player.socketId) {
        const socket = this.io.sockets.sockets.get(player.socketId);
        if (socket) socket.emit('match:started', {
          code: room.code,
          playerIndex,
          opponentType: room.isBotMatch ? 'bot' : 'human'
        });
      }
    });
    this.games.set(room.code, {
      room,
      state,
      commandCaches: [new Map(), new Map()],
      commandTimes: [[], []],
      paused: false,
      botAI: room.isBotMatch ? { nextThinkAt: Date.now() + 500, decisions: 0, shipOrders: 0 } : null
    });
    this.broadcastRoom(room.code, true);
  }

  setBotPaused(room, playerIndex, paused) {
    const game = this.games.get(room.code);
    if (!room.isBotMatch || room.status !== 'active' || playerIndex !== 0 || !game || game.state.status !== 'active') return false;
    game.paused = Boolean(paused);
    room.updatedAt = Date.now();
    this.broadcastRoom(room.code, true);
    return true;
  }

  finishByForfeit(room, missingPlayerIndex, reason = 'forfeit') {
    const game = this.games.get(room.code);
    if (!game || game.state.status !== 'active') return;
    game.state.status = 'ended';
    game.state.winnerIndex = 1 - missingPlayerIndex;
    this.notifyEnd(game, reason);
  }

  notifyEnd(game, reason = 'base-destroyed') {
    const { room, state } = game;
    state.endReason = reason;
    room.status = 'ended';
    room.players.forEach((player, playerIndex) => {
      if (!player || !player.socketId) return;
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (socket) socket.emit('match:ended', {
        result: playerIndex === state.winnerIndex ? 'win' : 'loss',
        winnerIndex: state.winnerIndex,
        reason
      });
    });
    if (typeof this.onMatchEnd === 'function') this.onMatchEnd(room);
  }

  handleCommand(room, playerIndex, payload) {
    const game = this.games.get(room.code);
    if (!game || game.state.status !== 'active') return;
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId.slice(0, 100) : '';
    if (!requestId) return;

    const cache = game.commandCaches[playerIndex];
    if (cache.has(requestId)) {
      const previous = cache.get(requestId);
      const player = room.players[playerIndex];
      const socket = player?.socketId ? this.io.sockets.sockets.get(player.socketId) : null;
      if (socket) socket.emit('command:result', { requestId, ...previous });
      return;
    }

    if (game.paused) {
      this.replyCommand(room, playerIndex, requestId, {
        ok: false,
        code: 'MATCH_PAUSED',
        message: 'Матч на паузе. Нажмите «Продолжить», чтобы снова управлять базой.'
      }, game);
      return;
    }

    const now = Date.now();
    const times = game.commandTimes[playerIndex];
    while (times.length && now - times[0] > 1000) times.shift();
    if (times.length >= CONFIG.MAX_COMMANDS_PER_SECOND) {
      this.replyCommand(room, playerIndex, requestId, { ok: false, code: 'RATE_LIMIT', message: 'Слишком много команд. Попробуйте ещё раз.' }, game);
      return;
    }
    times.push(now);

    const result = applyCommand(game.state, playerIndex, payload.command);
    this.replyCommand(room, playerIndex, requestId, result, game);
  }

  replyCommand(room, playerIndex, requestId, result, game) {
    const cache = game.commandCaches[playerIndex];
    cache.set(requestId, result);
    if (cache.size > CONFIG.MAX_COMMAND_CACHE) cache.delete(cache.keys().next().value);
    const player = room.players[playerIndex];
    const socket = player?.socketId ? this.io.sockets.sockets.get(player.socketId) : null;
    if (socket) socket.emit('command:result', { requestId, ...result });
  }

  step() {
    const now = Date.now();
    const dt = Math.min(0.1, Math.max(0.001, (now - this.lastStepAt) / 1000));
    this.lastStepAt = now;
    for (const [code, game] of this.games) {
      if (game.state.status === 'active' && !game.paused) {
        if (game.botAI) runBotAI(game, now);
        stepGame(game.state, dt);
        if (game.state.status === 'ended') {
          this.notifyEnd(game, 'base-destroyed');
        }
      }
      if (game.state.status === 'active' && now - game.state.lastSnapshotAt >= 1000 / CONFIG.SNAPSHOT_RATE) {
        game.state.lastSnapshotAt = now;
        this.broadcastRoom(code, false);
      }
    }
  }

  broadcastRoom(code, force) {
    const game = this.games.get(code);
    if (!game) return;
    for (let playerIndex = 0; playerIndex < 2; playerIndex += 1) {
      const player = game.room.players[playerIndex];
      if (!player || !player.connected || !player.socketId) continue;
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (socket) socket.emit('game:state', this.createPlayerView(game, playerIndex));
    }
  }

  createPlayerView(game, playerIndex) {
    const state = game.state;
    const ownBase = state.bases[playerIndex];
    const opposingBase = state.bases[1 - playerIndex];
    const enemyPlayer = game.room.players[1 - playerIndex];
    const transformEntity = (entity) => ({ ...entity, y: transformY(playerIndex, entity.y) });
    const transformEffect = (effect) => ({ ...effect, y: transformY(playerIndex, effect.y), friendly: typeof effect.owner === 'number' ? effect.owner === playerIndex : undefined });
    const transformBeam = (beam) => ({
      ...beam,
      friendly: typeof beam.owner === 'number' ? beam.owner === playerIndex : undefined,
      y1: transformY(playerIndex, beam.y1),
      y2: transformY(playerIndex, beam.y2)
    });

    // Deliberately serialize only the requesting player's base. The enemy
    // base, level, modules, HP and energy are never included in this payload.
    return {
      status: state.status,
      tick: state.tick,
      paused: Boolean(game.paused),
      serverTime: Date.now(),
      opponentConnected: Boolean(enemyPlayer && (enemyPlayer.isBot || enemyPlayer.connected)),
      opponentIsBot: Boolean(enemyPlayer && enemyPlayer.isBot),
      // Only opponent HP is exposed for the duel HUD; no enemy base entity,
      // position, level, modules, slots, production, or resources are sent.
      opponentBaseHp: opposingBase.hp,
      opponentBaseMaxHp: opposingBase.maxHp,
      base: {
        hp: ownBase.hp,
        maxHp: ownBase.maxHp,
        energy: Math.floor(ownBase.energy),
        maxEnergy: CONFIG.economy.maxEnergy,
        level: ownBase.level,
        slotCount: require('./gameLogic').moduleSlotCount(ownBase.level),
        modules: ownBase.modules.map(module => ({
          slotId: module.slotId,
          type: module.type,
          production: module.production ? { ...module.production } : null
        })),
        generation: CONFIG.economy.baseGenerationPerSecond + ownBase.modules.filter(module => module.type === 'reactor').length * CONFIG.economy.reactorBonusPerSecond
      },
      ships: state.ships.map(ship => ({
        id: ship.id,
        friendly: ship.owner === playerIndex,
        type: ship.type,
        x: ship.x,
        y: transformY(playerIndex, ship.y),
        hp: ship.hp,
        maxHp: ship.maxHp,
        targetId: ship.targetId,
        intercepted: Boolean(ship.interceptedBy)
      })),
      projectiles: state.projectiles.map(projectile => ({
        id: projectile.id,
        friendly: projectile.owner === playerIndex,
        x: projectile.x,
        y: transformY(playerIndex, projectile.y)
      })),
      effects: state.effects.map(transformEffect),
      beams: state.beams.map(transformBeam)
    };
  }

  destroyRoom(code) {
    this.games.delete(code);
  }

  shutdown() {
    clearInterval(this.stepInterval);
    this.games.clear();
  }
}

module.exports = GameManager;
