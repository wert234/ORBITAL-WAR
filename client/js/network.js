function makeToken() {
  if (crypto.randomUUID) return crypto.randomUUID().replaceAll('-', '');
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export class NetworkClient {
  constructor() {
    this.socket = null;
    this.listeners = new Map();
    this.pendingToken = null;
    this.session = this.readSession();
    this.commandSequence = 0;
    this.resumeRetries = 0;
  }

  readSession() {
    try {
      const parsed = JSON.parse(localStorage.getItem('ow_session') || 'null');
      if (parsed && /^\d{5}$/.test(parsed.code) && typeof parsed.token === 'string') return parsed;
    } catch { /* ignore malformed local storage */ }
    return null;
  }

  saveSession(code, token, playerIndex) {
    this.session = { code, token, playerIndex };
    localStorage.setItem('ow_session', JSON.stringify(this.session));
  }

  clearSession() {
    this.session = null;
    this.pendingToken = null;
    localStorage.removeItem('ow_session');
  }

  on(eventName, handler) {
    if (!this.listeners.has(eventName)) this.listeners.set(eventName, new Set());
    this.listeners.get(eventName).add(handler);
    return () => this.listeners.get(eventName)?.delete(handler);
  }

  dispatch(eventName, payload) {
    this.listeners.get(eventName)?.forEach(handler => handler(payload));
  }

  connect() {
    if (this.socket) return;
    this.socket = window.io({ transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 700, reconnectionDelayMax: 5000, timeout: 10000 });
    this.socket.on('connect', () => {
      this.resumeRetries = 0;
      this.dispatch('connection', { connected: true });
      if (this.session) {
        this.socket.emit('room:join', { code: this.session.code, token: this.session.token, resume: true });
      }
    });
    this.socket.on('disconnect', reason => this.dispatch('connection', { connected: false, reason }));
    this.socket.on('connect_error', error => this.dispatch('connection:error', { message: error.message }));

    const events = [
      'server:hello', 'room:created', 'room:joined', 'room:error', 'room:closed',
      'room:playerDisconnected', 'room:playerReconnected', 'room:rematchStatus',
      'match:started', 'match:ended', 'match:pauseState', 'game:state', 'command:result'
    ];
    events.forEach(eventName => this.socket.on(eventName, payload => {
      if (eventName === 'room:error' && payload?.code === 'SESSION_ACTIVE' && this.session && this.resumeRetries < 3) {
        this.resumeRetries += 1;
        const delay = 500 * this.resumeRetries;
        setTimeout(() => {
          if (this.socket?.connected && this.session) this.socket.emit('room:join', { code: this.session.code, token: this.session.token, resume: true });
        }, delay);
        return;
      }
      if (eventName === 'room:created' || eventName === 'room:joined') {
        if (eventName === 'room:joined') this.resumeRetries = 0;
        const token = payload.token || this.session?.token || this.pendingToken;
        if (token) this.saveSession(payload.code, token, payload.playerIndex);
      }
      if (eventName === 'room:closed') this.clearSession();
      this.dispatch(eventName, payload);
    }));
  }

  isConnected() {
    return Boolean(this.socket?.connected);
  }

  createRoom() {
    if (!this.isConnected()) return false;
    this.clearSession();
    this.pendingToken = makeToken();
    this.socket.emit('room:create', { token: this.pendingToken });
    return true;
  }

  createBotGame() {
    if (!this.isConnected()) return false;
    this.clearSession();
    this.pendingToken = makeToken();
    this.socket.emit('room:createBot', { token: this.pendingToken });
    return true;
  }

  joinRoom(code) {
    if (!this.isConnected()) return false;
    const normalizedCode = String(code).replace(/\D/g, '').slice(0, 5);
    if (!/^\d{5}$/.test(normalizedCode)) return false;
    const token = this.session?.code === normalizedCode ? this.session.token : makeToken();
    this.pendingToken = token;
    this.socket.emit('room:join', { code: normalizedCode, token });
    return true;
  }

  cancelRoom() {
    if (this.socket?.connected) this.socket.emit('room:cancel');
    this.clearSession();
  }

  leaveRoom() {
    if (this.socket?.connected) this.socket.emit('room:leave');
    this.clearSession();
  }

  surrender() {
    if (this.socket?.connected) this.socket.emit('room:leave');
  }

  setBotPaused(paused) {
    if (this.socket?.connected) this.socket.emit('match:pause', { paused: Boolean(paused) });
  }

  requestRematch() {
    if (this.socket?.connected) this.socket.emit('room:rematch');
  }

  command(action, data = {}) {
    if (!this.isConnected()) return false;
    const requestId = `${Date.now().toString(36)}-${(++this.commandSequence).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    this.socket.emit('game:command', { requestId, command: { action, data } });
    return true;
  }
}
