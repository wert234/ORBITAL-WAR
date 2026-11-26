const SLOT_OFFSETS = [
  [0.12, 0.40], [0.373, 0.40], [0.627, 0.40], [0.88, 0.40],
  [0.12, 0.79], [0.373, 0.79], [0.627, 0.79], [0.88, 0.79]
];

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + width - r, y); ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r); ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height); ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

export function getBaseLayout(width, height) {
  const hullWidth = width;
  const hullHeight = Math.min(height * 0.28, 172);
  const top = height - hullHeight;
  return {
    centerX: width / 2,
    centerY: top + hullHeight / 2,
    hullWidth,
    hullHeight,
    top,
    core: {
      x: width / 2,
      y: top + hullHeight * 0.91,
      radius: Math.max(22, Math.min(29, width * 0.07))
    },
    slots: SLOT_OFFSETS.map(([dx, dy], index) => ({
      id: `s${index + 1}`,
      x: width * dx,
      y: top + hullHeight * dy,
      radius: Math.max(10, Math.min(15, width * 0.038))
    }))
  };
}

export class ArenaRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.shipSprites = {};
    for (const type of ['fighter', 'bomber', 'interceptor']) {
      const image = new Image();
      image.src = `/img/${type}.png`;
      this.shipSprites[type] = image;
    }
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.previous = null;
    this.current = null;
    this.receivedAt = performance.now();
    this.stars = Array.from({ length: 110 }, (_, index) => {
      const seed = (index * 9301 + 49297) % 233280;
      const seed2 = (index * 233 + 719) % 997;
      return {
        x: (seed / 233280),
        y: (seed2 / 997),
        r: 0.35 + ((index * 13) % 10) / 10,
        phase: index * 0.7,
        speed: 0.5 + (index % 5) * 0.22
      };
    });
    this.spaceDust = Array.from({ length: 26 }, (_, index) => ({
      x: ((index * 71 + 19) % 997) / 997,
      y: ((index * 137 + 53) % 991) / 991,
      speed: 0.35 + (index % 6) * 0.16,
      length: 3 + (index % 4) * 2
    }));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.raf = 0;
    this.renderLoop = this.renderLoop.bind(this);
    this.raf = requestAnimationFrame(this.renderLoop);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setState(state) {
    if (!state) return;
    this.previous = this.current;
    this.current = state;
    this.receivedAt = performance.now();
  }

  getInterpolatedList(key) {
    const current = this.current?.[key] || [];
    const previous = this.previous?.[key] || [];
    const alpha = clamp((performance.now() - this.receivedAt) / 105, 0, 1);
    const previousById = new Map(previous.map(item => [item.id, item]));
    return current.map(item => {
      const old = previousById.get(item.id);
      if (!old) return item;
      const result = { ...item };
      for (const axis of ['x', 'y', 'x1', 'y1', 'x2', 'y2']) {
        if (typeof item[axis] === 'number' && typeof old[axis] === 'number') result[axis] = lerp(old[axis], item[axis], alpha);
      }
      return result;
    });
  }

  renderLoop(now) {
    this.draw(now);
    this.raf = requestAnimationFrame(this.renderLoop);
  }

  draw(now) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.drawBackground(ctx, w, h, now);
    this.drawOutboundEdge(ctx, w, h, now);
    const state = this.current;
    if (!state) {
      this.drawBase(ctx, w, h, { hp: 1000, maxHp: 1000, level: 1, modules: [] }, true);
      return;
    }

    this.drawBeams(ctx, w, h, this.getInterpolatedList('beams'));
    this.drawProjectiles(ctx, w, h, this.getInterpolatedList('projectiles'), now);
    this.getInterpolatedList('ships').forEach(ship => this.drawShip(ctx, w, h, ship, now));
    this.drawEffects(ctx, w, h, state.effects || []);
    this.drawBase(ctx, w, h, state.base, false, now);
  }

  drawBackground(ctx, w, h, now) {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#080b20');
    gradient.addColorStop(0.52, '#080d25');
    gradient.addColorStop(1, '#10132e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w * 0.5, h * 0.42, 5, w * 0.5, h * 0.42, w * 0.7);
    glow.addColorStop(0, 'rgba(45, 64, 143, .19)');
    glow.addColorStop(1, 'rgba(9, 13, 35, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // Slowly drifting nebula clouds add depth while remaining inexpensive to render.
    ctx.save();
    const driftX = Math.sin(now * 0.00008) * w * 0.08;
    const driftY = Math.cos(now * 0.00006) * h * 0.05;
    for (const cloud of [
      { x: .22, y: .24, rx: .34, ry: .22, color: '72, 67, 180', alpha: .10 },
      { x: .78, y: .62, rx: .30, ry: .26, color: '35, 125, 185', alpha: .085 },
      { x: .48, y: .86, rx: .38, ry: .18, color: '100, 58, 150', alpha: .06 }
    ]) {
      const cx = cloud.x * w + driftX;
      const cy = cloud.y * h + driftY;
      const haze = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w * cloud.rx, h * cloud.ry));
      haze.addColorStop(0, `rgba(${cloud.color}, ${cloud.alpha})`);
      haze.addColorStop(1, 'rgba(8, 12, 35, 0)');
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();

    for (const star of this.stars) {
      const twinkle = 0.38 + (Math.sin(now * 0.001 * star.speed + star.phase) + 1) * 0.25;
      ctx.globalAlpha = twinkle;
      ctx.fillStyle = star.r > 1 ? '#c6e5ff' : '#829bcf';
      ctx.beginPath();
      ctx.arc(star.x * w, star.y * h, star.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Slow parallax dust gives the arena depth without heavy image assets.
    for (const particle of this.spaceDust) {
      const y = ((particle.y + now * 0.000006 * particle.speed) % 1) * h;
      const x = particle.x * w;
      ctx.globalAlpha = 0.1 + particle.speed * 0.07;
      ctx.strokeStyle = '#9bcfff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + particle.length);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.strokeStyle = 'rgba(85, 137, 218, .075)';
    ctx.lineWidth = 1;
    const spacing = Math.max(34, w / 8);
    for (let x = w % spacing; x < w; x += spacing) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 25; y < h; y += spacing) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.restore();

    // Faint vertical travel lane makes both fleets' directions legible.
    ctx.save();
    const lane = ctx.createLinearGradient(w * .5, 0, w * .5, h);
    lane.addColorStop(0, 'rgba(89, 132, 255, .012)');
    lane.addColorStop(.5, 'rgba(89, 132, 255, .055)');
    lane.addColorStop(1, 'rgba(89, 132, 255, .012)');
    ctx.fillStyle = lane;
    ctx.fillRect(w * .28, 0, w * .44, h);
    ctx.restore();
  }

  drawOutboundEdge(ctx, w, h, now) {
    const pulse = 0.45 + (Math.sin(now * 0.0022) + 1) * 0.18;
    const center = w * 0.5;
    ctx.save();
    const edgeGlow = ctx.createLinearGradient(0, 0, 0, 18);
    edgeGlow.addColorStop(0, `rgba(82, 190, 255, ${0.16 * pulse})`);
    edgeGlow.addColorStop(1, 'rgba(82, 190, 255, 0)');
    ctx.fillStyle = edgeGlow;
    ctx.fillRect(0, 0, w, 18);
    ctx.strokeStyle = `rgba(113, 210, 255, ${0.24 * pulse})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 8]);
    ctx.beginPath();
    ctx.moveTo(w * 0.16, 3);
    ctx.lineTo(w * 0.84, 3);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = `rgba(119, 220, 255, ${0.2 + pulse * 0.25})`;
    ctx.shadowColor = '#55ceff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(center, 2, Math.min(40, w * 0.12), 0, Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  drawBase(ctx, w, h, base, placeholder, now = 0) {
    const layout = getBaseLayout(w, h);
    const { hullHeight: bh, top } = layout;
    ctx.save();

    const pulse = 0.58 + (Math.sin(now * 0.002) + 1) * 0.16;
    const bodyGradient = ctx.createLinearGradient(0, top, 0, h);
    bodyGradient.addColorStop(0, '#263d65');
    bodyGradient.addColorStop(0.18, '#17294b');
    bodyGradient.addColorStop(1, '#09152f');
    roundedRect(ctx, 0, top, w, bh, 8);
    ctx.fillStyle = bodyGradient;
    ctx.shadowColor = 'rgba(65, 164, 255, .36)';
    ctx.shadowBlur = 22;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(91, 215, 255, ${0.62 + pulse * 0.2})`;
    ctx.lineWidth = 1.25;
    ctx.stroke();

    // Broad deck plating emphasizes that this is the player's full-width base.
    ctx.save();
    ctx.beginPath();
    roundedRect(ctx, 1, top + 1, Math.max(0, w - 2), Math.max(0, bh - 2), 7);
    ctx.clip();
    const topGlow = ctx.createLinearGradient(0, top, 0, top + 30);
    topGlow.addColorStop(0, `rgba(83, 205, 255, ${0.24 * pulse})`);
    topGlow.addColorStop(1, 'rgba(83, 205, 255, 0)');
    ctx.fillStyle = topGlow;
    ctx.fillRect(0, top, w, 30);

    ctx.strokeStyle = 'rgba(112, 181, 238, .15)';
    ctx.lineWidth = 1;
    for (let index = 1; index < 8; index += 1) {
      const x = w * index / 8;
      ctx.beginPath(); ctx.moveTo(x, top + 5); ctx.lineTo(x, h); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, top + bh * 0.59); ctx.lineTo(w, top + bh * 0.59); ctx.stroke();
    ctx.strokeStyle = 'rgba(72, 191, 255, .22)';
    ctx.beginPath(); ctx.moveTo(0, top + bh - 3); ctx.lineTo(w, top + bh - 3); ctx.stroke();
    ctx.restore();

    // Status strip and the modular hardpoints are embedded in the deck itself.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '800 8px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(190, 227, 255, .8)';
    ctx.fillText(`ORBITAL CORE  ·  LVL ${base?.level || 1}`, w / 2, top + 13);

    if (!placeholder) {
      const healthRatio = clamp((base?.hp || 0) / (base?.maxHp || 1000), 0, 1);
      const barW = Math.min(w * 0.26, 150);
      ctx.fillStyle = 'rgba(4, 10, 25, .85)';
      roundedRect(ctx, w / 2 - barW / 2, top + 18, barW, 3, 2);
      ctx.fill();
      ctx.fillStyle = healthRatio > .35 ? '#4fe3c1' : '#ff6b83';
      roundedRect(ctx, w / 2 - barW / 2, top + 18, barW * healthRatio, 3, 2);
      ctx.fill();
    }

    const slotCount = placeholder ? 4 : (base?.level === 3 ? 8 : base?.level === 2 ? 6 : 4);
    const installed = new Map((base?.modules || []).map(module => [module.slotId, module]));
    layout.slots.slice(0, slotCount).forEach(slot => {
      const module = installed.get(slot.id);
      this.drawSlot(ctx, slot, module?.type || null, now, module?.production || null);
    });
    this.drawMainCore(ctx, layout.core, base?.level || 1, now, placeholder);
    ctx.restore();
  }

  drawMainCore(ctx, core, level, now = 0, placeholder = false) {
    const pulse = 0.65 + (Math.sin(now * 0.0024) + 1) * 0.16;
    const { x, y, radius } = core;
    ctx.save();
    ctx.shadowColor = '#5ce7ff';
    ctx.shadowBlur = 14 + pulse * 10;
    ctx.fillStyle = 'rgba(7, 20, 46, .98)';
    ctx.strokeStyle = `rgba(103, 225, 255, ${0.7 + pulse * 0.25})`;
    ctx.lineWidth = 1.5;
    roundedRect(ctx, x - radius * 1.38, y - radius * 0.5, radius * 2.76, radius, 8);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Four luminous conduits connect the command core to the base deck.
    ctx.strokeStyle = 'rgba(88, 208, 255, .46)';
    ctx.lineWidth = 2;
    for (const direction of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + direction * radius * 1.15, y);
      ctx.lineTo(x + direction * radius * 1.48, y);
      ctx.stroke();
    }

    const coreGradient = ctx.createRadialGradient(x, y - 1, 1, x, y, radius * 0.55);
    coreGradient.addColorStop(0, '#f1ffff');
    coreGradient.addColorStop(0.34, '#85f1ff');
    coreGradient.addColorStop(1, '#2377c7');
    ctx.fillStyle = coreGradient;
    ctx.shadowColor = '#71eaff';
    ctx.shadowBlur = 12 + pulse * 9;
    ctx.beginPath();
    ctx.arc(x, y - 1, radius * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = `rgba(164, 244, 255, ${0.42 + pulse * 0.3})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y - 1, radius * 0.58 + pulse * 1.6, 0, Math.PI * 2);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = '800 7px system-ui, sans-serif';
    ctx.fillStyle = placeholder ? 'rgba(181, 215, 243, .74)' : '#b9efff';
    ctx.fillText(`CORE ↑ · LV ${level}`, x, y - radius * 0.7);
    ctx.restore();
  }

  drawSlot(ctx, slot, moduleType, now = 0, production = null) {
    ctx.save();
    if (!moduleType) {
      ctx.fillStyle = 'rgba(5, 16, 40, .9)';
      ctx.strokeStyle = 'rgba(93, 217, 255, .72)';
      ctx.lineWidth = 1.1;
      ctx.setLineDash([3, 2]);
      roundedRect(ctx, slot.x - slot.radius, slot.y - slot.radius, slot.radius * 2, slot.radius * 2, 5);
      ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(95, 224, 255, .75)';
      ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('+', slot.x, slot.y + .5);
    } else if (moduleType === 'ballistic') {
      const aimAngle = -Math.PI / 2 + Math.sin(now * .0011 + slot.x) * .12;
      ctx.fillStyle = '#1d3656'; ctx.strokeStyle = '#68d9ff'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(slot.x, slot.y, slot.radius * .82, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#b0efff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(slot.x, slot.y); ctx.lineTo(slot.x + Math.cos(aimAngle) * slot.radius * 1.15, slot.y + Math.sin(aimAngle) * slot.radius * 1.15); ctx.stroke();
      ctx.fillStyle = '#76eaff'; ctx.shadowColor = '#55dfff'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(slot.x, slot.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    } else if (moduleType === 'laser') {
      const laserPulse = 3.2 + (Math.sin(now * .004 + slot.x) + 1) * 1.2;
      ctx.fillStyle = '#39234e'; ctx.strokeStyle = '#ff8de8'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(slot.x, slot.y, slot.radius * .82, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.shadowColor = '#ff70df'; ctx.shadowBlur = 10 + laserPulse; ctx.fillStyle = '#ff9deb';
      ctx.beginPath(); ctx.arc(slot.x, slot.y, laserPulse, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    } else if (moduleType === 'reactor') {
      ctx.fillStyle = '#514126'; ctx.strokeStyle = '#ffdb77'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(slot.x, slot.y - slot.radius); ctx.lineTo(slot.x + slot.radius, slot.y); ctx.lineTo(slot.x, slot.y + slot.radius); ctx.lineTo(slot.x - slot.radius, slot.y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff0a4'; ctx.shadowColor = '#ffd96b'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(slot.x, slot.y, 2.5 + (Math.sin(now * .006 + slot.x) + 1) * 1.1, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    } else if (moduleType === 'hangar') {
      ctx.fillStyle = '#2e2857'; ctx.strokeStyle = '#b69bff'; ctx.lineWidth = 1.2;
      roundedRect(ctx, slot.x - slot.radius, slot.y - slot.radius * .75, slot.radius * 2, slot.radius * 1.5, 4); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#cbbdff'; ctx.beginPath(); ctx.moveTo(slot.x - 5, slot.y); ctx.lineTo(slot.x + 5, slot.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(slot.x - 3, slot.y - 4); ctx.lineTo(slot.x - 3, slot.y + 4); ctx.moveTo(slot.x + 3, slot.y - 4); ctx.lineTo(slot.x + 3, slot.y + 4); ctx.stroke();
      if (production) {
        const ratio = production.totalMs > 0 ? clamp(1 - production.remainingMs / production.totalMs, 0, 1) : 0;
        ctx.strokeStyle = production.waitingForCapacity ? '#ffc56f' : '#d7c4ff';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(slot.x, slot.y, slot.radius + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio); ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawShip(ctx, w, h, ship, now = 0) {
    const x = ship.x * w;
    const y = ship.y * h;
    const friendly = ship.friendly;
    const color = friendly ? '#68eaff' : '#ff82b3';
    const size = Math.max(7, Math.min(12, w * (ship.type === 'bomber' ? .033 : .026)));
    const pulse = 0.72 + (Math.sin(now * 0.024 + String(ship.id).length * 1.7) + 1) * 0.2;

    ctx.save();
    ctx.translate(x, y);
    const sprite = this.shipSprites[ship.type];
    const spriteReady = sprite && sprite.complete && sprite.naturalWidth > 0;
    const shipAngle = friendly ? 0 : Math.PI;
    ctx.rotate(shipAngle);

    // Engine plume is drawn behind the sprite and pulses independently.
    ctx.globalAlpha = pulse;
    ctx.shadowColor = color;
    ctx.shadowBlur = 15;
    const plumeGradient = ctx.createLinearGradient(0, size * .35, 0, size * 2.1);
    plumeGradient.addColorStop(0, '#f5ffff');
    plumeGradient.addColorStop(.22, color);
    plumeGradient.addColorStop(1, 'rgba(70,150,255,0)');
    ctx.fillStyle = plumeGradient;
    ctx.beginPath();
    ctx.moveTo(-size * .24, size * .38);
    ctx.quadraticCurveTo(0, size * (1.1 + pulse * .35), size * .24, size * .38);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    if (spriteReady) {
      const aspect = sprite.naturalWidth / sprite.naturalHeight;
      const drawH = size * (ship.type === 'bomber' ? 3.25 : ship.type === 'interceptor' ? 3.0 : 2.9);
      const drawW = drawH * aspect;
      ctx.shadowColor = color;
      ctx.shadowBlur = 7;
      ctx.drawImage(sprite, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.shadowBlur = 0;
      // Team-color edge marker keeps both fleets distinguishable without tinting texture.
      ctx.strokeStyle = color;
      ctx.globalAlpha = .72;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, drawW * .43, drawH * .43, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      // Fallback vector silhouette if an image fails to load.
      ctx.fillStyle = friendly ? '#39a9d2' : '#c94f83';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(0, -size * 1.25);
      ctx.lineTo(size * .9, size * .8);
      ctx.lineTo(0, size * .48);
      ctx.lineTo(-size * .9, size * .8);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();

    const barW = size * 2.1;
    const ratio = clamp(ship.hp / ship.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(5, 9, 22, .8)';
    ctx.fillRect(x - barW / 2, y + size * 1.25, barW, 2);
    ctx.fillStyle = friendly ? '#52e4ce' : '#ff759f';
    ctx.fillRect(x - barW / 2, y + size * 1.25, barW * ratio, 2);
  }

  drawProjectiles(ctx, w, h, projectiles, now = 0) {
    for (const projectile of projectiles) {
      const x = projectile.x * w;
      const y = projectile.y * h;
      const color = projectile.friendly ? '#7befff' : '#ff83b0';
      const flicker = .82 + (Math.sin(now * .035 + x) + 1) * .09;
      ctx.save();
      ctx.globalAlpha = flicker;
      const trail = ctx.createLinearGradient(x, y - 20, x, y + 3);
      trail.addColorStop(0, 'rgba(90,190,255,0)');
      trail.addColorStop(.65, color);
      trail.addColorStop(1, '#ffffff');
      ctx.strokeStyle = trail;
      ctx.lineWidth = 5;
      ctx.shadowColor = color;
      ctx.shadowBlur = 17;
      ctx.beginPath();
      ctx.moveTo(x, y + (projectile.friendly ? 20 : -20));
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, 3.1, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 6 + Math.sin(now * .04) * 1.2, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  drawBeams(ctx, w, h, beams) {
    for (const beam of beams) {
      const alpha = clamp(1 - beam.age / beam.duration, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#ff70e8'; ctx.lineWidth = 6;
      ctx.shadowColor = '#ff6bdf'; ctx.shadowBlur = 22;
      ctx.beginPath(); ctx.moveTo(beam.x1 * w, beam.y1 * h); ctx.lineTo(beam.x2 * w, beam.y2 * h); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(beam.x1 * w, beam.y1 * h); ctx.lineTo(beam.x2 * w, beam.y2 * h); ctx.stroke();
      ctx.restore();
    }
  }

  drawEffects(ctx, w, h, effects) {
    for (const effect of effects) {
      const ratio = clamp(1 - effect.age / effect.duration, 0, 1);
      const progress = 1 - ratio;
      const x = effect.x * w;
      const y = effect.y * h;
      ctx.save();
      ctx.globalAlpha = ratio;
      if (effect.type === 'explosion' || effect.type === 'base-hit') {
        const radius = progress * (effect.type === 'base-hit' ? 58 : 30) + 3;
        ctx.strokeStyle = effect.type === 'base-hit' ? '#76eaff' : '#ffb36f';
        ctx.lineWidth = effect.type === 'base-hit' ? 2.5 : 2;
        ctx.shadowColor = effect.type === 'base-hit' ? '#55cfff' : '#ff8d5e';
        ctx.shadowBlur = 17;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#fff0bd';
        ctx.beginPath(); ctx.arc(x, y, (1 - progress) * 6 + 1, 0, Math.PI * 2); ctx.fill();
        if (effect.type === 'base-hit') {
          ctx.globalAlpha = ratio * .55;
          ctx.fillStyle = '#6bdfff';
          ctx.fillRect(0, y - 1, w, 2);
        }
      } else if (effect.type === 'hit' || effect.type === 'impact') {
        const radius = progress * 15 + 2;
        ctx.strokeStyle = effect.type === 'impact' ? '#fff2bb' : '#d7f5ff';
        ctx.lineWidth = 1.6;
        ctx.shadowColor = '#8eeaff';
        ctx.shadowBlur = 11;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(x, y, 2 + ratio * 2, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.strokeStyle = effect.type === 'launch' ? '#62eaff' : '#d7f5ff';
        ctx.lineWidth = 1.5; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(x, y, progress * 17 + 2, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  }

  hitTestSlot(clientX, clientY, slotCount) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const layout = getBaseLayout(this.width, this.height);
    return layout.slots.slice(0, slotCount).find(slot => Math.hypot(x - slot.x, y - slot.y) <= slot.radius + 8) || null;
  }

  hitTestCore(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const core = getBaseLayout(this.width, this.height).core;
    return Math.hypot(x - core.x, y - core.y) <= core.radius * 1.15;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
  }
}
