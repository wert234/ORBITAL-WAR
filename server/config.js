'use strict';

// All balance values live here so the prototype can be tuned without changing
// the simulation or client code.
module.exports = Object.freeze({
  TICK_RATE: 20,
  SNAPSHOT_RATE: 10,
  RECONNECT_GRACE_MS: 30_000,
  ROOM_IDLE_MS: 10 * 60_000,
  MAX_SHIPS_PER_PLAYER: 30,
  world: {
    // Each home base sits near the bottom of its owner's viewport. The two
    // viewports meet at the center of the route, so ships leave one screen
    // and enter the opponent's screen from its top edge.
    viewportBaseY: 0.855,
    baseSeparation: 1.71
  },
  MAX_COMMANDS_PER_SECOND: 10,
  MAX_COMMAND_CACHE: 300,

  economy: {
    startingEnergy: 200,
    maxEnergy: 1000,
    baseGenerationPerSecond: 5,
    reactorBonusPerSecond: 3
  },

  base: {
    startingHealth: 1000,
    maxHealth: 1000,
    levels: {
      1: { slots: 4, upgradeCost: 300 },
      2: { slots: 6, upgradeCost: 700 },
      3: { slots: 8, upgradeCost: null }
    }
  },

  // Slot IDs are stable. Additional slots become available as the base levels up.
  slots: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'],

  modules: {
    ballistic: {
      name: 'Баллистическая пушка',
      category: 'weapon',
      cost: 100,
      range: 0.52,
      cooldown: 1.8,
      damage: 12,
      projectileSpeed: 1.55
    },
    laser: {
      name: 'Лазерная установка',
      category: 'weapon',
      cost: 150,
      range: 0.66,
      cooldown: 2.4,
      damage: 18
    },
    reactor: {
      name: 'Энергогенератор',
      category: 'economy',
      cost: 120,
      generationBonus: 3
    },
    hangar: {
      name: 'Ангар',
      category: 'production',
      cost: 180
    }
  },

  ships: {
    fighter: {
      name: 'Истребитель',
      behavior: 'siege',
      cost: 60,
      buildMs: 3000,
      maxHp: 48,
      speed: 0.19,
      shipDamage: 0,
      shipRange: 0,
      shipCooldown: 0.85,
      baseDamage: 24,
      baseCooldown: 1.2,
      baseAttackRange: 0.24
    },
    bomber: {
      name: 'Бомбардировщик',
      behavior: 'ram',
      cost: 110,
      buildMs: 6200,
      maxHp: 125,
      speed: 0.095,
      shipDamage: 0,
      shipRange: 0,
      shipCooldown: 1.8,
      baseDamage: 78,
      baseCooldown: 1.5,
      baseAttackRange: 0.105
    },
    interceptor: {
      name: 'Перехватчик',
      behavior: 'intercept',
      cost: 90,
      buildMs: 4500,
      maxHp: 78,
      speed: 0.225,
      shipDamage: 19,
      shipRange: 0.145,
      shipCooldown: 0.78,
      baseDamage: 14,
      baseCooldown: 1.15,
      baseAttackRange: 0.095
    }
  }
});
