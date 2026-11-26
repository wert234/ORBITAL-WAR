import { ArenaRenderer } from './renderer.js';

const MODULE_DESCRIPTIONS = {
  ballistic: 'Средний урон · автонаведение',
  laser: 'Большая дальность · периодический урон',
  reactor: 'Увеличивает генерацию энергии',
  hangar: 'Нажмите ангар, чтобы собрать корабль'
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
    this.selectedHangarSlotId = null;
    this.modal = document.getElementById('slot-modal');
    this.hangarModal = document.getElementById('hangar-modal');
    this.bindControls();
    this.populateCatalog();
  }

  populateCatalog() {
    const ships = this.config?.ships || {};
    document.querySelectorAll('[data-hangar-ship]').forEach(button => {
      const spec = ships[button.dataset.hangarShip];
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
      if (installed?.type === 'hangar') {
        this.selectedHangarSlotId = slot.id;
        this.openHangarModal(installed);
        return;
      }
      if (installed) {
        const names = this.config?.modules || {};
        this.toast(`${names[installed.type]?.name || 'Установка'} уже находится в этом отсеке.`);
        return;
      }
      this.selectedSlotId = slot.id;
      this.openModuleModal();
    });

    document.querySelectorAll('[data-hangar-ship]').forEach(button => {
      button.addEventListener('click', () => {
        if (!this.selectedHangarSlotId) return;
        this.audio.play('click');
        this.network.command('produce', {
          shipType: button.dataset.hangarShip,
          hangarSlotId: this.selectedHangarSlotId
        });
        this.closeHangarModal();
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
    document.getElementById('close-hangar-modal').addEventListener('click', () => this.closeHangarModal());
    this.hangarModal.addEventListener('pointerdown', event => {
      if (event.target === this.hangarModal) this.closeHangarModal();
    });
  }

  openModuleModal() {
    const energy = this.state?.base?.energy || 0;
    document.querySelectorAll('[data-module]').forEach(button => {
      const spec = this.config?.modules?.[button.dataset.module];
      button.disabled = !spec || !this.network.isConnected();
      button.classList.toggle('unaffordable', Boolean(spec && energy < spec.cost));
      button.title = spec && energy < spec.cost ? 'Недостаточно энергии' : '';
    });
    this.modal.classList.remove('hidden');
  }

  closeModuleModal() {
    this.modal.classList.add('hidden');
    this.selectedSlotId = null;
  }

  openHangarModal(hangar) {
    const production = hangar?.production || null;
    const stateLabel = document.getElementById('hangar-production-state');
    if (production) {
      const shipName = this.config?.ships?.[production.type]?.name || production.type;
      stateLabel.textContent = production.waitingForCapacity
        ? `${shipName.toUpperCase()} · ОЖИДАЕТ МЕСТО ВО ФЛОТЕ`
        : `${shipName.toUpperCase()} · СБОРКА ${Math.ceil(production.remainingMs / 1000)}С`;
    } else {
      stateLabel.textContent = 'АНГАР СВОБОДЕН · ВЫБЕРИТЕ КОРАБЛЬ';
    }

    const energy = this.state?.base?.energy || 0;
    document.querySelectorAll('[data-hangar-ship]').forEach(button => {
      const spec = this.config?.ships?.[button.dataset.hangarShip];
      button.disabled = !spec || Boolean(production) || !this.network.isConnected();
      button.classList.toggle('unaffordable', Boolean(spec && energy < spec.cost));
      button.classList.toggle('busy', Boolean(production));
      button.title = production ? 'Этот ангар уже занят' : (spec && energy < spec.cost ? 'Недостаточно энергии' : '');
    });
    this.hangarModal.classList.remove('hidden');
  }

  closeHangarModal() {
    this.hangarModal.classList.add('hidden');
    this.selectedHangarSlotId = null;
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
    document.getElementById('generation-value').textContent = `+${base.generation}/С`;
    document.getElementById('match-status').textContent = this.state.opponentIsBot ? 'БОТ' : (this.state.opponentConnected ? 'БОЙ' : 'СВЯЗЬ');
    const opponentLabel = document.getElementById('opponent-label');
    if (opponentLabel) opponentLabel.textContent = this.state.opponentIsBot ? 'БОТ' : 'ВРАГ';

    const upgrade = document.getElementById('upgrade-button');
    const upgradeCost = base.level < 3 ? this.config?.base?.levels?.[base.level]?.upgradeCost : null;
    upgrade.querySelector('strong').textContent = base.level;
    if (base.level >= 3) {
      upgrade.disabled = true;
      upgrade.classList.remove('unaffordable');
      upgrade.title = 'Максимальный уровень базы';
    } else {
      upgrade.disabled = !this.network.isConnected();
      upgrade.classList.toggle('unaffordable', base.energy < upgradeCost);
      upgrade.title = `Улучшить базу · ${upgradeCost} ✦`;
    }

    if (!this.modal.classList.contains('hidden')) this.openModuleModal();
    if (!this.hangarModal.classList.contains('hidden') && this.selectedHangarSlotId) {
      const selected = base.modules.find(module => module.slotId === this.selectedHangarSlotId);
      if (selected?.type === 'hangar') this.openHangarModal(selected);
      else this.closeHangarModal();
    }
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
    document.querySelectorAll('[data-hangar-ship], #upgrade-button').forEach(button => {
      if (!connected) button.disabled = true;
    });
    if (connected && this.state) this.updateHud();
  }

  reset() {
    this.state = null;
    this.renderer.setState(null);
    this.closeModuleModal();
    this.closeHangarModal();
  }

  destroy() {
    this.renderer.destroy();
  }
}
