'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const GameManager = require('./gameManager');
const RoomManager = require('./rooms');
const CONFIG = require('./config');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const CLIENT_DIR = path.join(__dirname, '..', 'client');

const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true, name: 'ORBITAL WAR', time: new Date().toISOString() }));
app.get('/api/config', (_req, res) => res.json({ economy: CONFIG.economy, base: CONFIG.base, modules: CONFIG.modules, ships: CONFIG.ships, productionQueueLimit: CONFIG.MAX_PRODUCTION_QUEUE }));
app.use(express.static(CLIENT_DIR, {
  extensions: ['html'],
  maxAge: 0,
  setHeaders: response => response.setHeader('Cache-Control', 'no-cache')
}));
app.get('*', (_req, res) => res.sendFile(path.join(CLIENT_DIR, 'index.html'), {
  headers: { 'Cache-Control': 'no-cache' }
}));

const server = http.createServer(app);
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(value => value.trim())
  : true;
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  pingInterval: 25_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 1e5
});

const gameManager = new GameManager(io);
const roomManager = new RoomManager(io, gameManager);
gameManager.onMatchEnd = room => {
  room.status = 'ended';
  room.updatedAt = Date.now();
};

io.on('connection', socket => {
  socket.emit('server:hello', { ok: true, reconnectGraceMs: 30_000 });
  roomManager.bindSocket(socket);
  socket.on('game:command', payload => {
    const session = roomManager.getSession(socket);
    if (!session) return;
    gameManager.handleCommand(session.room, session.playerIndex, payload);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`ORBITAL WAR server listening on http://${HOST}:${PORT}`);
});

function shutdown() {
  console.log('Shutting down ORBITAL WAR server...');
  roomManager.shutdown();
  gameManager.shutdown();
  io.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
