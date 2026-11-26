'use strict';

const CONFIG = require('./config');
const { makeShip } = require('./entities');

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function moduleSlotCount(level) {
  return CONFIG.base.levels[level].slots;
}

function getBaseY(playerIndex) {
  return playerIndex === 0 ? 0 : CONFIG.world.baseSeparation;
}

function getSlotPosition(playerIndex, slotIndex) {
  // Coordinates are in the shared two-screen route. Each client sees its own
  // base at the bottom through the perspective transform in GameManager.
  const positions = [
    [-0.38, -0.023], [-0.127, -0.023], [0.127, -0.023], [0.38, -0.023],
    [-0.38, 0.086], [-0.127, 0.086], [0.127, 0.086], [0.38, 0.086]
  ];
  const [dx, dy] = positions[slotIndex] || [0, 0];
  // Slot offsets are authored in the owner's screen coordinates. The shared
  // world axis runs from player 0's base towards player 1's base.
  const worldOffset = playerIndex === 0 ? -dy : dy;
  return { x: 0.5 + dx, y: getBaseY(playerIndex) + worldOffset };
}

function pushEffect(state, type, x, y, duration = 550) {
  state.effects.push({ id: `fx-${state.nextEntityId++}`, type, x, y, age: 0, duration });
}

function aliveShipCount(state, owner) {
  return state.ships.reduce((count, ship) => count + (ship.owner === owner ? 1 : 0), 0);
}

function getEnemyShips(state, owner) {
  return state.ships.filter(ship => ship.owner !== owner && ship.hp > 0);
}

function damageShip(state, target, amount, sourceX, sourceY) {
  if (!target || target.hp <= 0) return;
  target.hp -= amount;
  pushEffect(state, 'hit', target.x, target.y, 260);
  if (target.hp <= 0) {
    target.hp = 0;
    pushEffect(state, 'explosion', target.x, target.y, 650);
  }
}

function updateProduction(state, base, owner, dtMs) {
  const hangars = base.modules.filter(module => module.type === 'hangar' && module.production);
  for (const hangar of hangars) {
    const production = hangar.production;
    production.remainingMs = Math.max(0, production.remainingMs - dtMs);
    if (production.remainingMs > 0) continue;

    if (aliveShipCount(state, owner) >= CONFIG.MAX_SHIPS_PER_PLAYER) {
      production.remainingMs = 0;
      production.waitingForCapacity = true;
      continue;
    }

    state.ships.push(makeShip(state, owner, production.type));
    const launchY = owner === 0 ? 0.17 : CONFIG.world.baseSeparation - 0.17;
    pushEffect(state, 'launch', 0.5, launchY, 520);
    hangar.production = null;
  }
}

function activeProductionCount(base) {
  return base.modules.reduce((count, module) => count + (module.type === 'hangar' && module.production ? 1 : 0), 0);
}

function updateBaseWeapons(state, base, owner, dt) {
  const enemies = getEnemyShips(state, owner);
  if (!enemies.length) return;

  for (const installed of base.modules) {
    const spec = CONFIG.modules[installed.type];
    if (!spec || spec.category !== 'weapon') continue;
    installed.cooldownRemaining = Math.max(0, (installed.cooldownRemaining || 0) - dt);
    if (installed.cooldownRemaining > 0) continue;

    const slotIndex = CONFIG.slots.indexOf(installed.slotId);
    const origin = getSlotPosition(owner, slotIndex);
    const target = enemies
      .map(enemy => ({ enemy, d: distance(origin, enemy) }))
      .filter(item => item.d <= spec.range)
      .sort((a, b) => a.d - b.d)[0]?.enemy;
    if (!target) continue;

    installed.cooldownRemaining = spec.cooldown;
    pushEffect(state, 'muzzle', origin.x, origin.y, 190);
    if (installed.type === 'ballistic') {
      state.projectiles.push({
        id: `pr-${state.nextEntityId++}`,
        owner,
        targetId: target.id,
        x: origin.x,
        y: origin.y,
        damage: spec.damage,
        speed: spec.projectileSpeed
      });
    } else {
      damageShip(state, target, spec.damage, origin.x, origin.y);
      state.beams.push({
        id: `beam-${state.nextEntityId++}`,
        x1: origin.x, y1: origin.y,
        x2: target.x, y2: target.y,
        age: 0, duration: 240
      });
    }
  }
}

function updateProjectiles(state, dt) {
  const remaining = [];
  for (const projectile of state.projectiles) {
    const target = state.ships.find(ship => ship.id === projectile.targetId && ship.hp > 0);
    if (!target) continue;
    const dx = target.x - projectile.x;
    const dy = target.y - projectile.y;
    const dist = Math.hypot(dx, dy);
    const step = projectile.speed * dt;
    if (dist <= step + 0.012) {
      damageShip(state, target, projectile.damage, projectile.x, projectile.y);
      pushEffect(state, 'impact', target.x, target.y, 320);
      continue;
    }
    projectile.x += (dx / dist) * step;
    projectile.y += (dy / dist) * step;
    remaining.push(projectile);
  }
  state.projectiles = remaining;
}

function updateShips(state, dt) {
  for (const ship of state.ships) {
    if (ship.hp <= 0 || ship.delivered) continue;
    const spec = CONFIG.ships[ship.type];
    ship.attackCooldown = Math.max(0, ship.attackCooldown - dt);

    const enemies = getEnemyShips(state, ship.owner);
    const target = enemies
      .map(enemy => ({ enemy, d: distance(ship, enemy) }))
      .filter(item => item.d <= spec.shipRange)
      .sort((a, b) => a.d - b.d)[0]?.enemy || null;

    if (target) {
      ship.targetId = target.id;
      if (ship.attackCooldown <= 0) {
        damageShip(state, target, spec.shipDamage, ship.x, ship.y);
        ship.attackCooldown = spec.shipCooldown;
      }
      // Ships engage nearby enemies, then resume their outbound flight.
      continue;
    }
    ship.targetId = null;

    ship.y += ship.direction * spec.speed * dt;
    ship.x = clamp(ship.x, 0.12, 0.88);

    // The shared route is two home-view lengths long. A ship first leaves
    // its owner's viewport, enters the opponent's viewport at the top, and
    // only then reaches the opponent's base.
    const crossedEnemyBase = ship.owner === 0
      ? ship.y >= CONFIG.world.baseSeparation
      : ship.y <= 0;
    if (crossedEnemyBase) {
      const enemyBase = state.bases[1 - ship.owner];
      enemyBase.hp = Math.max(0, enemyBase.hp - spec.baseDamage);
      pushEffect(state, 'base-hit', 0.5, ship.owner === 0 ? CONFIG.world.baseSeparation : 0, 520);
      ship.delivered = true;
    }
  }
}

function applyCommand(state, playerIndex, command) {
  if (!command || typeof command !== 'object') return { ok: false, code: 'BAD_COMMAND', message: 'Некорректная команда.' };
  if (state.status !== 'active') return { ok: false, code: 'MATCH_ENDED', message: 'Матч уже завершён.' };

  const base = state.bases[playerIndex];
  const action = String(command.action || '');
  const data = command.data && typeof command.data === 'object' ? command.data : {};
  const fail = (code, message) => ({ ok: false, code, message });

  if (action === 'install') {
    const slotId = String(data.slotId || '');
    const moduleType = String(data.moduleType || '');
    const slotIndex = CONFIG.slots.indexOf(slotId);
    if (slotIndex < 0 || slotIndex >= moduleSlotCount(base.level)) return fail('INVALID_SLOT', 'Этот отсек пока недоступен.');
    if (base.modules.some(item => item.slotId === slotId)) return fail('SLOT_OCCUPIED', 'Этот отсек уже занят.');
    const spec = CONFIG.modules[moduleType];
    if (!spec) return fail('UNKNOWN_MODULE', 'Неизвестная установка.');
    if (base.energy < spec.cost) return fail('NOT_ENOUGH_ENERGY', 'Недостаточно энергии.');
    base.energy -= spec.cost;
    base.modules.push({
      slotId,
      type: moduleType,
      cooldownRemaining: 0
    });
    return { ok: true, message: `${spec.name} установлена.` };
  }

  if (action === 'upgrade') {
    if (base.level >= 3) return fail('MAX_LEVEL', 'Достигнут максимальный уровень базы.');
    const nextLevel = base.level + 1;
    const cost = CONFIG.base.levels[base.level].upgradeCost;
    if (base.energy < cost) return fail('NOT_ENOUGH_ENERGY', 'Недостаточно энергии.');
    base.energy -= cost;
    base.level = nextLevel;
    return { ok: true, message: `База улучшена до уровня ${nextLevel}.` };
  }

  if (action === 'produce') {
    const type = String(data.shipType || '');
    const hangarSlotId = String(data.hangarSlotId || data.slotId || '');
    const spec = CONFIG.ships[type];
    if (!spec) return fail('UNKNOWN_SHIP', 'Неизвестный тип корабля.');
    const hangar = base.modules.find(item => item.slotId === hangarSlotId && item.type === 'hangar');
    if (!hangar) return fail('HANGAR_NOT_FOUND', 'Сначала установите ангар и выберите его.');
    if (hangar.production) return fail('HANGAR_BUSY', 'Этот ангар уже собирает корабль.');
    if (aliveShipCount(state, playerIndex) + activeProductionCount(base) >= CONFIG.MAX_SHIPS_PER_PLAYER) {
      return fail('FLEET_LIMIT', 'Достигнут лимит кораблей с учётом производства.');
    }
    if (base.energy < spec.cost) return fail('NOT_ENOUGH_ENERGY', 'Недостаточно энергии.');
    base.energy -= spec.cost;
    hangar.production = {
      id: base.nextProductionId++,
      type,
      remainingMs: spec.buildMs,
      totalMs: spec.buildMs,
      waitingForCapacity: false
    };
    return { ok: true, message: `Ангар начал сборку: ${spec.name}.` };
  }

  return fail('UNKNOWN_ACTION', 'Неизвестное действие.');
}

function stepGame(state, dt) {
  if (state.status !== 'active') return;
  state.tick += 1;
  const dtMs = dt * 1000;

  for (let owner = 0; owner < 2; owner += 1) {
    const base = state.bases[owner];
    const reactorCount = base.modules.filter(item => item.type === 'reactor').length;
    const generation = CONFIG.economy.baseGenerationPerSecond + reactorCount * CONFIG.economy.reactorBonusPerSecond;
    base.energy = Math.min(CONFIG.economy.maxEnergy, base.energy + generation * dt);
    updateProduction(state, base, owner, dtMs);
    updateBaseWeapons(state, base, owner, dt);
  }

  updateShips(state, dt);
  updateProjectiles(state, dt);

  state.ships = state.ships.filter(ship => ship.hp > 0 && !ship.delivered && ship.y >= -0.04 && ship.y <= CONFIG.world.baseSeparation + 0.04);
  state.effects = state.effects.filter(effect => {
    effect.age += dtMs;
    return effect.age < effect.duration;
  });
  state.beams = state.beams.filter(beam => {
    beam.age += dtMs;
    return beam.age < beam.duration;
  });

  for (let index = 0; index < 2; index += 1) {
    if (state.bases[index].hp <= 0) {
      state.bases[index].hp = 0;
      state.status = 'ended';
      state.winnerIndex = 1 - index;
      break;
    }
  }
}

module.exports = {
  applyCommand,
  stepGame,
  moduleSlotCount,
  getSlotPosition,
  getBaseY
};
