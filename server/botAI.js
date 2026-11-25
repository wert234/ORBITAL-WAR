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
  let weaponCount = base.modules.filter(module => CONFIG.modules[module.type]?.category === 'weapon').length;

  // Establish a defensive gun early. It uses the same module slot, energy,
  // cooldown, targeting and damage rules as a human-built turret.
  if (weaponCount === 0 && slotId && base.energy >= CONFIG.modules.ballistic.cost) {
    const result = issue(game, 'install', { slotId, moduleType: 'ballistic' });
    if (result.ok) {
      game.botAI.decisions += 1;
      slotId = freeSlot(base);
      weaponCount += 1;
    }
  }

  // Add a second gun only when there is something to defend against.
  if (weaponCount < 2 && enemyShips.length >= 2 && slotId && base.energy >= CONFIG.modules.ballistic.cost) {
    const result = issue(game, 'install', { slotId, moduleType: 'ballistic' });
    if (result.ok) {
      game.botAI.decisions += 1;
      slotId = freeSlot(base);
      weaponCount += 1;
    }
  }

  // Invest in energy production once the first defence and some fleet are
  // online. The economy module is also placed through the normal command path.
  const reactorCount = base.modules.filter(module => module.type === 'reactor').length;
  if (reactorCount === 0 && slotId && base.energy >= 150) {
    const result = issue(game, 'install', { slotId, moduleType: 'reactor' });
    if (result.ok) {
      game.botAI.decisions += 1;
      slotId = freeSlot(base);
    }
  }

  // Expand the same base levels and slot capacity available to a human player.
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

  // Keep the shared production queue moving. The bot uses the same costs,
  // build timers, queue cap and fleet cap as the human player.
  const queue = base.productionQueue || (base.production ? [base.production] : []);
  if (queue.length >= Math.min(3, CONFIG.MAX_PRODUCTION_QUEUE)) return;
  // Save the next 150 energy for the first reactor instead of spending every
  // small surplus on another ship and keeping the bot's economy stagnant.
  if (!base.modules.some(module => module.type === 'reactor') && freeSlot(base) && base.energy < 150) return;
  if (myShips.length + queue.length >= CONFIG.MAX_SHIPS_PER_PLAYER) return;

  const orderNumber = game.botAI.shipOrders || 0;
  let shipType = 'fighter';
  if (enemyShips.length > myShips.length && base.energy >= CONFIG.ships.interceptor.cost) {
    shipType = 'interceptor';
  } else if (orderNumber % 3 === 1 && base.energy >= CONFIG.ships.interceptor.cost) {
    shipType = 'interceptor';
  } else if (orderNumber % 3 === 2 && base.energy >= CONFIG.ships.bomber.cost) {
    shipType = 'bomber';
  }

  const result = issue(game, 'produce', { shipType });
  if (result.ok) {
    game.botAI.decisions += 1;
    game.botAI.shipOrders = orderNumber + 1;
  }
}

module.exports = { runBotAI };
