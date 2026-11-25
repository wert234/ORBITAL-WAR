const SLOT_OFFSETS = [
  [-0.15, -0.28], [0.15, -0.28],
  [-0.15, 0.10], [0.15, 0.10],
  [-0.28, -0.08], [0.28, -0.08],
  [-0.065, 0.34], [0.065, 0.34]
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
  const hullWidth = Math.min(width * 0.72, 330);
  const hullHeight = Math.min(height * 0.235, 142);
  return {
    centerX: width / 2,
    centerY: height * 0.855,
    hullWidth,
    hullHeight,
    slots: SLOT_OFFSETS.map(([dx, dy], index) => ({
      id: `s${index + 1}`,
      x: width / 2 + dx * hullWidth,
      y: height * 0.855 + dy * hullHeight,
      radius: Math.max(12, Math.min(17, width * 0.045))
    }))
  };
}

export class ArenaRenderer {
  constructor(canvas) {
    this.canvas = canvas;
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
    this.drawProjectiles(ctx, w, h, this.getInterpolatedList('projectiles'));
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
    const { centerX: cx, centerY: cy, hullWidth: bw, hullHeight: bh } = layout;
    ctx.save();

    // Local animated shield halo; no opposing station is ever rendered.
    const shieldPulse = 0.65 + (Math.sin(now * 0.002) + 1) * 0.16;
    ctx.strokeStyle = `rgba(77, 194, 255, ${0.1 * shieldPulse})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy + bh * .1, bw * (0.57 + 0.012 * Math.sin(now * 0.0014)), bh * .78, 0, Math.PI, Math.PI * 2);
    ctx.stroke();

    const hull = new Path2D();
    hull.moveTo(cx - bw * .31, cy - bh * .48);
    hull.lineTo(cx + bw * .31, cy - bh * .48);
    hull.lineTo(cx + bw * .47, cy + bh * .12);
    hull.lineTo(cx + bw * .27, cy + bh * .47);
    hull.lineTo(cx - bw * .27, cy + bh * .47);
    hull.lineTo(cx - bw * .47, cy + bh * .12);
    hull.closePath();
    const bodyGradient = ctx.createLinearGradient(cx, cy - bh * .5, cx, cy + bh * .5);
    bodyGradient.addColorStop(0, '#263c62');
    bodyGradient.addColorStop(.5, '#121f3e');
    bodyGradient.addColorStop(1, '#0b142d');
    ctx.fillStyle = bodyGradient;
    ctx.shadowColor = 'rgba(65, 164, 255, .3)';
    ctx.shadowBlur = 20;
    ctx.fill(hull);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#58c9f0';
    ctx.lineWidth = 1.35;
    ctx.stroke(hull);

    // Hull plating and energy spine.
    ctx.strokeStyle = 'rgba(91, 196, 255, .34)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - bw * .26, cy - bh * .32);
    ctx.lineTo(cx, cy - bh * .1);
    ctx.lineTo(cx + bw * .26, cy - bh * .32);
    ctx.moveTo(cx - bw * .32, cy + bh * .17);
    ctx.lineTo(cx, cy + bh * .35);
    ctx.lineTo(cx + bw * .32, cy + bh * .17);
    ctx.stroke();
    ctx.fillStyle = 'rgba(79, 212, 255, .16)';
    ctx.fillRect(cx - bw * .045, cy - bh * .24, bw * .09, bh * .5);
    ctx.fillStyle = '#73efff';
    ctx.shadowColor = '#55e4ff';
    ctx.shadowBlur = 13;
    ctx.fillRect(cx - 2, cy - bh * .16, 4, bh * .36);
    ctx.shadowBlur = 0;

    // Twin engine lights.
    for (const side of [-1, 1]) {
      const enginePulse = 0.7 + (Math.sin(now * 0.012 + side) + 1) * 0.15;
      ctx.globalAlpha = enginePulse;
      ctx.fillStyle = '#76a6ff';
      ctx.shadowColor = '#579dff';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.ellipse(cx + side * bw * .34, cy + bh * .29, 4, 8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    const slotCount = placeholder ? 4 : (base?.level === 3 ? 8 : base?.level === 2 ? 6 : 4);
    const installed = new Map((base?.modules || []).map(module => [module.slotId, module.type]));
    layout.slots.slice(0, slotCount).forEach(slot => {
      const moduleType = installed.get(slot.id);
      this.drawSlot(ctx, slot, moduleType, now);
    });

    // Compact base label and health status.
    ctx.font = '800 8px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(170, 218, 255, .66)';
    ctx.fillText(`ORBITAL CORE · LVL ${base?.level || 1}`, cx, cy + bh * .59);
    if (!placeholder) {
      const healthRatio = clamp((base?.hp || 0) / (base?.maxHp || 1000), 0, 1);
      const barW = bw * .48;
      ctx.fillStyle = 'rgba(6, 12, 29, .9)';
      ctx.fillRect(cx - barW / 2, cy + bh * .68, barW, 3);
      ctx.fillStyle = healthRatio > .35 ? '#4fe3c1' : '#ff6b83';
      ctx.fillRect(cx - barW / 2, cy + bh * .68, barW * healthRatio, 3);
    }
    ctx.restore();
  }

  drawSlot(ctx, slot, moduleType, now = 0) {
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
    }
    ctx.restore();
  }

  drawShip(ctx, w, h, ship, now = 0) {
    const x = ship.x * w;
    const y = ship.y * h;
    const friendly = ship.friendly;
    const color = friendly ? '#68eaff' : '#ff82b3';
    const size = Math.max(7, Math.min(12, w * (ship.type === 'bomber' ? .033 : .026)));
    const angle = friendly ? -Math.PI / 2 : Math.PI / 2;
    const pulse = 0.72 + (Math.sin(now * 0.024 + String(ship.id).length * 1.7) + 1) * 0.2;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Animated engine plume and a short luminous wake.
    ctx.globalAlpha = pulse;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    const plumeLength = size * (1.35 + pulse * 0.65);
    const plume = ctx.createLinearGradient(-size * 0.55, 0, -plumeLength, 0);
    plume.addColorStop(0, '#ffffff');
    plume.addColorStop(.24, color);
    plume.addColorStop(1, 'rgba(75, 145, 255, 0)');
    ctx.fillStyle = plume;
    ctx.beginPath();
    ctx.moveTo(-size * .55, -size * .2);
    ctx.lineTo(-plumeLength, 0);
    ctx.lineTo(-size * .55, size * .2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    ctx.shadowColor = color;
    ctx.shadowBlur = 13;
    ctx.fillStyle = friendly ? 'rgba(52, 184, 226, .94)' : 'rgba(228, 89, 150, .94)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    if (ship.type === 'bomber') {
      ctx.moveTo(size * 1.2, 0);
      ctx.lineTo(size * .25, -size * .88);
      ctx.lineTo(-size * .72, -size * .72);
      ctx.lineTo(-size * .92, 0);
      ctx.lineTo(-size * .72, size * .72);
      ctx.lineTo(size * .25, size * .88);
    } else if (ship.type === 'interceptor') {
      ctx.moveTo(size * 1.45, 0);
      ctx.lineTo(-size, -size * .43);
      ctx.lineTo(-size * .48, 0);
      ctx.lineTo(-size, size * .43);
    } else {
      ctx.moveTo(size * 1.35, 0);
      ctx.lineTo(-size, -size * .72);
      ctx.lineTo(-size * .55, 0);
      ctx.lineTo(-size, size * .72);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // Reflective spine and cockpit add a little more definition to each hull.
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(235, 250, 255, .6)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(size * .72, 0);
    ctx.lineTo(-size * .48, 0);
    ctx.stroke();
    ctx.fillStyle = '#f4fdff';
    ctx.beginPath(); ctx.ellipse(size * .28, 0, size * .2, size * .13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    const barW = size * 2.1;
    const ratio = clamp(ship.hp / ship.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(5, 9, 22, .8)';
    ctx.fillRect(x - barW / 2, y + size * 1.25, barW, 2);
    ctx.fillStyle = friendly ? '#52e4ce' : '#ff759f';
    ctx.fillRect(x - barW / 2, y + size * 1.25, barW * ratio, 2);
  }

  drawProjectiles(ctx, w, h, projectiles) {
    for (const projectile of projectiles) {
      const x = projectile.x * w;
      const y = projectile.y * h;
      const color = projectile.friendly ? '#7befff' : '#ff83b0';
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.4;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(x, y + (projectile.friendly ? 11 : -11)); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = .45;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  drawBeams(ctx, w, h, beams) {
    for (const beam of beams) {
      const alpha = clamp(1 - beam.age / beam.duration, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#ff9deb'; ctx.lineWidth = 3;
      ctx.shadowColor = '#ff6bdf'; ctx.shadowBlur = 13;
      ctx.beginPath(); ctx.moveTo(beam.x1 * w, beam.y1 * h); ctx.lineTo(beam.x2 * w, beam.y2 * h); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
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

  destroy() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
  }
}
