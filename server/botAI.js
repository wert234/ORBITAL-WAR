'use strict';

// The bot is not a separate game mode or client-side simulation. It is simply
// player 2 making server-authoritative commands through the same applyCommand
// function used by human players.
const CONFIG = require('./config');
const { applyCommand, moduleSlotCount } = require('./gameLogic');

function livingShips(state, owner) {
  return state.ships.filter(ship => ship.owner === owner && ship.hp > 0 && !ship.delivered);
}

function freeSlot(base) {
  const installed = new Set(base.modules.map(module => module.slotId));
  return CONFIG.slots.slice(0, moduleSlotCount(base.level)).find(slotId => !installed.has(slotId)) || null;
}

function issue(game, action, data = {}) {
  return applyCommand(game.state, 1, { action, data });
}

function runBotAI(game, now = Date.now()) {
  if (!game || game.state?.status !== 'active' || !game.room?.isBotMatch) return;

  if (!game.botAI) game.botAI = { nextThinkAt: 0, decisions: 0, shipOrders: 0 };
  if (now < game.botAI.nextThinkAt) return;
  game.botAI.nextThinkAt = now + 900;

  const state = game.state;
  const base = state.bases[1];
  const myShips = livingShips(state, 1);
  const enemyShips = livingShips(state, 0);
  let slotId = freeSlot(base);

  // Prioritize installing a real hangar so bot matches begin testing ship
  // movement and combat early instead of waiting for a defensive/economy build.
  let hangars = base.modules.filter(module => module.type === 'hangar');
  if (!hangars.length && slotId && base.energy >= CONFIG.modules.hangar.cost) {
    const result = issue(game, 'install', { slotId, moduleType: 'hangar' });
    if (result.ok) {
      game.botAI.decisions += 1;
      slotId = freeSlot(base);
      hangars = base.modules.filter(module => module.type === 'hangar');
    }
  }

  let weaponCount = base.modules.filter(module => CONFIG.modules[module.type]?.category === 'weapon').length;

  // Build defense through the same validated command handler as humans.
  if (weaponCount === 0 && slotId && base.energy >= CONFIG.modules.ballistic.cost) {
    const result = issue(game, 'install', { slotId, moduleType: 'ballistic' });
    if (result.ok) {
      game.botAI.decisions += 1;
      slotId = freeSlot(base);
      weaponCount += 1;
    }
  }

  if (weaponCount < 2 && enemyShips.length >= 2 && slotId && base.energy >= CONFIG.modules.ballistic.cost) {
    const result = issue(game, 'install', { slotId, moduleType: 'ballistic' });
    if (result.ok) {
      game.botAI.decisions += 1;
      slotId = freeSlot(base);
      weaponCount += 1;
    }
  }

  const reactorCount = base.modules.filter(module => module.type === 'reactor').length;
  if (reactorCount === 0 && slotId && base.energy >= CONFIG.modules.reactor.cost + 30) {
    const result = issue(game, 'install', { slotId, moduleType: 'reactor' });
    if (result.ok) {
      game.botAI.decisions += 1;
      slotId = freeSlot(base);
    }
  }

  if (base.level < 3) {
    const upgradeCost = CONFIG.base.levels[base.level].upgradeCost;
    if (base.energy >= upgradeCost + 100) {
      const result = issue(game, 'upgrade');
      if (result.ok) {
        game.botAI.decisions += 1;
        slotId = freeSlot(base);
      }
    }
  }

  // Each installed hangar owns one independent build slot.
  const freeHangar = hangars.find(module => !module.production);
  if (!freeHangar) return;
  const activeProduction = hangars.filter(module => module.production).length;
  if (myShips.length + activeProduction >= CONFIG.MAX_SHIPS_PER_PLAYER) return;

  const orderNumber = game.botAI.shipOrders || 0;
  let shipType = 'fighter';
  if (enemyShips.length > myShips.length && base.energy >= CONFIG.ships.interceptor.cost) {
    shipType = 'interceptor';
  } else if (orderNumber % 3 === 1 && base.energy >= CONFIG.ships.interceptor.cost) {
    shipType = 'interceptor';
  } else if (orderNumber % 3 === 2 && base.energy >= CONFIG.ships.bomber.cost) {
    shipType = 'bomber';
  }

  const result = issue(game, 'produce', { shipType, hangarSlotId: freeHangar.slotId });
  if (result.ok) {
    game.botAI.decisions += 1;
    game.botAI.shipOrders = orderNumber + 1;
  }
}

module.exports = { runBotAI };
