import { ArenaRenderer } from './renderer.js';

const MODULE_DESCRIPTIONS = {
  ballistic: 'Средний урон · автонаведение',
  laser: 'Большая дальность · периодический урон',
  reactor: 'Увеличивает генерацию энергии',
  hangar: 'Ускоряет производство кораблей'
};

export class GameUI {
  constructor({ network, audio, toast, config }) {
    this.network = network;
    this.audio = audio;
    this.toast = toast;
    this.config = config;
    this.canvas = document.getElementById('arena');
    this.renderer = new ArenaRenderer(this.canvas);
    this.state = null;
    this.selectedSlotId = null;
    this.modal = document.getElementById('slot-modal');
    this.bindControls();
    this.populateCatalog();
  }

  populateCatalog() {
    const ships = this.config?.ships || {};
    document.querySelectorAll('[data-ship]').forEach(button => {
      const spec = ships[button.dataset.ship];
      if (!spec) return;
      button.querySelector('small').textContent = `${spec.cost} ✦ · ${(spec.buildMs / 1000).toFixed(spec.buildMs % 1000 ? 1 : 0)}с`;
    });
    const modules = this.config?.modules || {};
    document.querySelectorAll('[data-module]').forEach(button => {
      const spec = modules[button.dataset.module];
      if (!spec) return;
      const description = MODULE_DESCRIPTIONS[button.dataset.module] || '';
      button.querySelector('small').textContent = `${description} · ${spec.cost} ✦`;
    });
  }

  bindControls() {
    this.canvas.addEventListener('pointerup', event => {
      if (!this.state?.base) return;
      const slot = this.renderer.hitTestSlot(event.clientX, event.clientY, this.state.base.slotCount);
      if (!slot) return;
      const installed = this.state.base.modules.find(module => module.slotId === slot.id);
      if (installed) {
        const names = this.config?.modules || {};
        this.toast(`${names[installed.type]?.name || 'Установка'} уже находится в этом отсеке.`);
        return;
      }
      this.selectedSlotId = slot.id;
      this.openModuleModal();
    });

    document.querySelectorAll('[data-ship]').forEach(button => {
      button.addEventListener('click', () => {
        this.audio.play('click');
        this.network.command('produce', { shipType: button.dataset.ship });
      });
    });

    document.getElementById('upgrade-button').addEventListener('click', () => {
      this.audio.play('click');
      this.network.command('upgrade');
    });

    document.querySelectorAll('[data-module]').forEach(button => {
      button.addEventListener('click', () => {
        if (!this.selectedSlotId) return;
        this.audio.play('click');
        this.network.command('install', { slotId: this.selectedSlotId, moduleType: button.dataset.module });
        this.closeModuleModal();
      });
    });

    document.getElementById('close-slot-modal').addEventListener('click', () => this.closeModuleModal());
    this.modal.addEventListener('pointerdown', event => {
      if (event.target === this.modal) this.closeModuleModal();
    });
  }

  openModuleModal() {
    const energy = this.state?.base?.energy || 0;
    document.querySelectorAll('[data-module]').forEach(button => {
      const spec = this.config?.modules?.[button.dataset.module];
      button.disabled = !spec || !this.network.isConnected();
      button.classList.toggle('unaffordable', Boolean(spec && energy < spec.cost));
      button.title = spec && energy < spec.cost ? 'Нажмите, чтобы увидеть ответ сервера' : '';
    });
    this.modal.classList.remove('hidden');
  }

  closeModuleModal() {
    this.modal.classList.add('hidden');
    this.selectedSlotId = null;
  }

  setState(state) {
    if (!state) return;
    this.state = state;
    this.renderer.setState(state);
    this.updateHud();
  }

  updateHud() {
    const base = this.state?.base;
    if (!base) return;
    const hpRatio = Math.max(0, Math.min(1, base.hp / base.maxHp));
    const opponentMaxHp = this.state.opponentBaseMaxHp || this.config?.base?.maxHealth || 1000;
    const opponentHp = Math.max(0, this.state.opponentBaseHp ?? opponentMaxHp);
    const opponentRatio = Math.max(0, Math.min(1, opponentHp / opponentMaxHp));
    document.getElementById('hp-value').textContent = Math.ceil(base.hp);
    document.getElementById('hp-fill').style.width = `${hpRatio * 100}%`;
    document.getElementById('opponent-hp-value').textContent = Math.ceil(opponentHp);
    document.getElementById('opponent-hp-fill').style.width = `${opponentRatio * 100}%`;
    document.getElementById('energy-value').textContent = Math.floor(base.energy);
    document.getElementById('level-value').textContent = base.level;
    document.getElementById('generation-value').textContent = `+${base.generation} ЭНЕРГИИ/С`;
    document.getElementById('match-status').textContent = this.state.opponentIsBot ? 'БОТ' : (this.state.opponentConnected ? 'БОЙ' : 'СВЯЗЬ');
    const opponentLabel = document.getElementById('opponent-label');
    if (opponentLabel) opponentLabel.textContent = this.state.opponentIsBot ? 'БОТ' : 'ВРАГ';

    const productionLabel = document.getElementById('production-state');
    const productionQueue = base.productionQueue || (base.production ? [base.production] : []);
    const queueLimit = this.config?.productionQueueLimit || 5;
    const activeProduction = productionQueue[0];
    if (activeProduction) {
      const shipName = this.config?.ships?.[activeProduction.type]?.name || activeProduction.type;
      if (activeProduction.waitingForCapacity) productionLabel.textContent = `ФЛОТ ЗАПОЛНЕН · ${productionQueue.length}/${queueLimit}`;
      else {
        const queuedCount = Math.max(0, productionQueue.length - 1);
        productionLabel.textContent = `${shipName.toUpperCase()} · ${Math.ceil(activeProduction.remainingMs / 1000)}С${queuedCount ? ` · +${queuedCount}` : ''}`;
      }
    } else {
      productionLabel.textContent = 'АНГАР ГОТОВ';
    }

    document.querySelectorAll('[data-ship]').forEach(button => {
      const spec = this.config?.ships?.[button.dataset.ship];
      button.disabled = productionQueue.length >= queueLimit || !spec || !this.network.isConnected();
      button.classList.toggle('busy', productionQueue.length > 0);
      button.classList.toggle('unaffordable', Boolean(spec && base.energy < spec.cost));
      button.title = productionQueue.length >= queueLimit ? 'Очередь производства заполнена' : '';
    });

    const upgrade = document.getElementById('upgrade-button');
    const upgradeCost = base.level < 3 ? this.config?.base?.levels?.[base.level]?.upgradeCost : null;
    if (base.level >= 3) {
      upgrade.disabled = true;
      upgrade.innerHTML = 'МАКСИМАЛЬНЫЙ УРОВЕНЬ';
    } else {
      upgrade.disabled = !this.network.isConnected();
      upgrade.classList.toggle('unaffordable', base.energy < upgradeCost);
      upgrade.innerHTML = `УЛУЧШИТЬ БАЗУ <span>${upgradeCost} ✦</span>`;
    }

    if (!this.modal.classList.contains('hidden')) this.openModuleModal();
  }

  setOpponentConnected(connected) {
    document.getElementById('opponent-alert').classList.toggle('hidden', connected);
    if (this.state) {
      this.state.opponentConnected = connected;
      document.getElementById('match-status').textContent = this.state.opponentIsBot ? 'БОТ' : (connected ? 'БОЙ' : 'СВЯЗЬ');
    }
  }

  setNetworkConnected(connected) {
    document.getElementById('connection-overlay').classList.toggle('hidden', connected);
    document.querySelectorAll('.ship-button, .upgrade-button').forEach(button => {
      if (!connected) button.disabled = true;
    });
    if (connected && this.state) this.updateHud();
  }

  reset() {
    this.state = null;
    this.renderer.setState(null);
    this.closeModuleModal();
  }

  destroy() {
    this.renderer.destroy();
  }
}
