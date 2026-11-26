'use strict';

const CONFIG = require('./config');

function makeBase(playerIndex) {
  return {
    playerIndex,
    hp: CONFIG.base.startingHealth,
    maxHp: CONFIG.base.maxHealth,
    level: 1,
    energy: CONFIG.economy.startingEnergy,
    modules: [],
    // Each installed hangar owns its own independent production slot.
    nextProductionId: 1
  };
}

function makeGameState() {
  return {
    status: 'active',
    tick: 0,
    startedAt: Date.now(),
    bases: [makeBase(0), makeBase(1)],
    ships: [],
    projectiles: [],
    effects: [],
    beams: [],
    nextEntityId: 1,
    winnerIndex: null,
    lastSnapshotAt: 0
  };
}

function makeShip(state, owner, type) {
  const spec = CONFIG.ships[type];
  const direction = owner === 0 ? 1 : -1;
  const baseY = owner === 0 ? 0 : CONFIG.world.baseSeparation;
  const jitter = (Math.random() - 0.5) * 0.12;
  return {
    id: `sh-${state.nextEntityId++}`,
    owner,
    type,
    x: Math.max(0.16, Math.min(0.84, 0.5 + jitter)),
    y: baseY + direction * 0.17,
    hp: spec.maxHp,
    maxHp: spec.maxHp,
    direction,
    attackCooldown: 0,
    baseCooldown: 0,
    targetId: null,
    interceptedBy: null
  };
}

module.exports = { makeGameState, makeShip };
