import { NetworkClient } from './network.js';
import { AudioManager } from './audio.js';
import { GameUI } from './game.js';

const network = new NetworkClient();
const audio = new AudioManager();
let game = null;
let toastTimer = null;

const screens = ['home-screen', 'network-screen', 'waiting-screen', 'join-screen', 'settings-screen', 'game-screen', 'result-screen'];
function showScreen(id) {
  screens.forEach(screenId => document.getElementById(screenId).classList.toggle('active', screenId === id));
}

function showToast(message, tone = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
  if (tone === 'error') audio.play('error');
  else if (tone === 'success') audio.play('purchase');
}

function updateNetworkStatus(connected) {
  const light = document.getElementById('network-light');
  const label = document.getElementById('network-status');
  light.classList.toggle('connected', connected);
  light.classList.toggle('disconnected', !connected);
  label.textContent = connected ? 'Сервер доступен · готово к игре' : 'Нет соединения с сервером';
  game?.setNetworkConnected(connected);
}

async function loadPublicConfig() {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('Config unavailable');
    return await response.json();
  } catch (error) {
    console.warn('Could not load game config:', error);
    return null;
  }
}

function openGame() {
  showScreen('game-screen');
  if (game) game.reset();
  document.getElementById('opponent-alert').classList.add('hidden');
  document.getElementById('connection-overlay').classList.toggle('hidden', network.isConnected());
}

function openResult(payload) {
  const won = payload.result === 'win';
  const screen = document.getElementById('result-screen');
  screen.classList.toggle('defeat', !won);
  document.getElementById('result-title').textContent = won ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
  document.getElementById('result-emblem').textContent = won ? '✦' : '×';
  const resultReason = payload.reason;
  if (resultReason === 'surrender') {
    document.getElementById('result-subtitle').textContent = won ? 'Соперник сдался.' : 'Ты сдался. Матч завершён.';
  } else if (resultReason === 'forfeit') {
    document.getElementById('result-subtitle').textContent = won ? 'Соперник не вернулся в бой.' : 'Ты не вернулся в бой вовремя.';
  } else {
    document.getElementById('result-subtitle').textContent = won ? 'Вражеская база уничтожена.' : 'Твоя база пала. Перегруппируй флот.';
  }
  document.getElementById('rematch-status').textContent = '';
  showScreen('result-screen');
}

function wireMenus() {
  document.querySelectorAll('[data-home-tab]').forEach(button => {
    button.addEventListener('click', () => {
      const tab = button.dataset.homeTab;
      audio.play('click');
      document.querySelectorAll('[data-home-tab]').forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active);
        if (active) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
      });
      document.querySelectorAll('.home-tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `home-${tab}-panel`);
      });
    });
  });
  document.getElementById('open-network').addEventListener('click', () => { audio.play('click'); showScreen('network-screen'); });
  document.getElementById('open-bot').addEventListener('click', () => {
    audio.play('click');
    if (!network.isConnected()) return showToast('Нет соединения с игровым сервером.', 'error');
    if (network.createBotGame()) showToast('Подготавливаем бой с ботом…');
  });
  document.getElementById('open-settings').addEventListener('click', () => { audio.play('click'); showScreen('settings-screen'); });
  document.getElementById('network-back').addEventListener('click', () => showScreen('home-screen'));
  document.getElementById('join-back').addEventListener('click', () => showScreen('network-screen'));
  document.getElementById('settings-back').addEventListener('click', () => showScreen('home-screen'));

  document.getElementById('create-room').addEventListener('click', () => {
    if (!network.isConnected()) return showToast('Нет соединения с игровым сервером.', 'error');
    if (network.createRoom()) showScreen('waiting-screen');
  });
  document.getElementById('open-join').addEventListener('click', () => showScreen('join-screen'));
  document.getElementById('join-form').addEventListener('submit', event => {
    event.preventDefault();
    const code = document.getElementById('room-code-input').value.trim();
    if (!/^\d{5}$/.test(code)) return showToast('Введите пятизначный код.', 'error');
    if (!network.isConnected()) return showToast('Нет соединения с игровым сервером.', 'error');
    if (network.joinRoom(code)) showScreen('waiting-screen');
  });

  document.getElementById('copy-code').addEventListener('click', async () => {
    const code = document.getElementById('room-code').textContent;
    try {
      await navigator.clipboard.writeText(code);
      showToast('Код скопирован.', 'success');
    } catch {
      const helper = document.createElement('textarea');
      helper.value = code;
      helper.style.position = 'fixed'; helper.style.opacity = '0';
      document.body.appendChild(helper); helper.select();
      const ok = document.execCommand('copy'); helper.remove();
      showToast(ok ? 'Код скопирован.' : `Код комнаты: ${code}`, ok ? 'success' : 'info');
    }
  });
  document.getElementById('cancel-room').addEventListener('click', () => {
    network.cancelRoom();
    showScreen('network-screen');
  });

  document.getElementById('sound-toggle').checked = audio.soundEnabled;
  document.getElementById('music-toggle').checked = audio.musicEnabled;
  document.getElementById('sound-toggle').addEventListener('change', event => audio.setSound(event.target.checked));
  document.getElementById('music-toggle').addEventListener('change', event => audio.setMusic(event.target.checked));
  document.getElementById('fullscreen-toggle').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) {
        if (!document.documentElement.requestFullscreen) return showToast('Полноэкранный режим недоступен в этом браузере.');
        await document.documentElement.requestFullscreen();
      } else {
        if (!document.exitFullscreen) return showToast('Выход из полноэкранного режима недоступен.');
        await document.exitFullscreen();
      }
    } catch { showToast('Полноэкранный режим недоступен в этом браузере.'); }
  });

  document.getElementById('rematch-button').addEventListener('click', () => {
    document.getElementById('rematch-status').textContent = 'Ожидаем подтверждение второго игрока…';
    network.requestRematch();
  });
  document.getElementById('result-menu-button').addEventListener('click', () => {
    network.leaveRoom();
    game?.reset();
    showScreen('home-screen');
  });
}

function wireNetworkEvents() {
  network.on('connection', ({ connected }) => updateNetworkStatus(connected));
  network.on('connection:error', () => updateNetworkStatus(false));

  network.on('room:created', payload => {
    if (payload.mode === 'bot') return;
    document.getElementById('room-code').textContent = payload.code;
    document.getElementById('waiting-text').textContent = 'Ожидаем второго игрока…';
    showScreen('waiting-screen');
  });
  network.on('room:joined', payload => {
    if (payload.status === 'waiting') {
      document.getElementById('room-code').textContent = payload.code;
      document.getElementById('waiting-text').textContent = payload.reconnected ? 'Соединение восстановлено. Ожидаем соперника…' : 'Подключение выполнено. Запускаем матч…';
      showScreen('waiting-screen');
    }
  });
  network.on('room:error', payload => {
    showToast(payload.message || 'Не удалось подключиться к комнате.', 'error');
    if (payload.code === 'ROOM_NOT_FOUND' || payload.code === 'ROOM_FULL') showScreen('join-screen');
  });
  network.on('room:closed', payload => {
    game?.reset();
    // Leaving from the result screen already returned the user to the main
    // menu. A server-side room cleanup should not pull them back a level.
    if (!document.getElementById('home-screen').classList.contains('active')) showScreen('network-screen');
    if (payload?.message) showToast(payload.message);
  });
  network.on('room:playerDisconnected', payload => {
    if (game) game.setOpponentConnected(false);
    document.getElementById('opponent-alert').textContent = 'СОПЕРНИК ОТКЛЮЧЁН · 30 СЕК';
    showToast('Соперник потерял соединение. Ожидаем переподключения.');
  });
  network.on('room:playerReconnected', () => {
    if (game) game.setOpponentConnected(true);
    showToast('Соперник вернулся в бой.', 'success');
  });
  network.on('room:rematchStatus', payload => {
    document.getElementById('rematch-status').textContent = payload.ready === 2
      ? 'Новый матч запускается…'
      : 'Готовы к повторной игре: ' + payload.ready + ' / 2';
  });
  network.on('match:started', payload => {
    openGame();
    showToast(payload?.opponentType === 'bot'
      ? 'Бой с ботом начался. Проверь свою стратегию!'
      : 'Матч начался. Уничтожь базу противника.');
  });
  network.on('game:state', state => {
    if (!game) return;
    game.setState(state);
    game.setOpponentConnected(state.opponentConnected);
  });
  network.on('command:result', result => {
    if (result.ok) showToast(result.message || 'Команда выполнена.', 'success');
    else showToast(result.message || 'Команда отклонена.', 'error');
  });
  network.on('match:pauseState', payload => game?.setPaused(payload.paused, payload.accepted));
  network.on('match:ended', payload => {
    game?.onMatchEnded();
    openResult(payload);
  });
}

async function boot() {
  wireMenus();
  wireNetworkEvents();
  const config = await loadPublicConfig();
  game = new GameUI({ network, audio, toast: showToast, config });
  network.connect();
  updateNetworkStatus(network.isConnected());

  // A small interaction is enough to resume an enabled WebAudio context on
  // browsers that suspend it until the first user gesture.
  document.addEventListener('pointerdown', () => {
    if (audio.musicEnabled) audio.startMusic();
  }, { once: true, passive: true });
}

boot();
