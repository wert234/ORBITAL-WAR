export class AudioManager {
  constructor() {
    this.soundEnabled = localStorage.getItem('ow_sound') !== 'false';
    this.musicEnabled = localStorage.getItem('ow_music') === 'true';
    this.context = null;
    this.musicNodes = null;
    this.ambientTimer = null;
    this.ambientStep = 0;
  }

  ensureContext() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      this.context = new AudioContextClass();
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    return this.context;
  }

  setSound(enabled) {
    this.soundEnabled = Boolean(enabled);
    localStorage.setItem('ow_sound', String(this.soundEnabled));
    if (this.soundEnabled) this.play('click');
  }

  setMusic(enabled) {
    this.musicEnabled = Boolean(enabled);
    localStorage.setItem('ow_music', String(this.musicEnabled));
    if (this.musicEnabled) this.startMusic();
    else this.stopMusic();
  }

  startMusic() {
    const context = this.ensureContext();
    if (!context || this.musicNodes || !this.musicEnabled) return;

    const now = context.currentTime;
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.19, now + 3.2);
    master.connect(context.destination);

    const lowPass = context.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = 1500;
    lowPass.Q.value = 0.45;
    lowPass.connect(master);

    const oscillators = [];
    const pads = [
      { frequency: 43.65, type: 'sine', gain: 0.22, detune: -2 },
      { frequency: 55, type: 'sine', gain: 0.17, detune: 2 },
      { frequency: 82.41, type: 'triangle', gain: 0.085, detune: -3 },
      { frequency: 110, type: 'sine', gain: 0.075, detune: 3 },
      { frequency: 164.81, type: 'sine', gain: 0.045, detune: 0 },
      { frequency: 220, type: 'triangle', gain: 0.022, detune: 0 }
    ];

    pads.forEach((pad, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = pad.type;
      oscillator.frequency.value = pad.frequency;
      oscillator.detune.value = pad.detune;
      gain.gain.value = pad.gain;
      oscillator.connect(gain);
      gain.connect(lowPass);
      oscillator.start();
      oscillators.push({ oscillator, gain });

      if (index >= 2) {
        const lfo = context.createOscillator();
        const lfoDepth = context.createGain();
        lfo.frequency.value = 0.035 + index * 0.008;
        lfoDepth.gain.value = pad.gain * 0.34;
        lfo.connect(lfoDepth);
        lfoDepth.connect(gain.gain);
        lfo.start();
        oscillators.push({ oscillator: lfo, gain: lfoDepth });
      }
    });

    // A quiet filtered noise layer adds the airy, distant texture of a sci-fi
    // engine room without requiring a downloaded music file.
    const noiseBuffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noiseData.length; index += 1) {
      noiseData[index] = (Math.random() * 2 - 1) * 0.55;
    }
    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 720;
    noiseFilter.Q.value = 0.55;
    const noiseGain = context.createGain();
    noiseGain.gain.value = 0.012;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start();

    // Soft echo gives occasional high notes space and depth.
    const delay = context.createDelay(1.5);
    delay.delayTime.value = 0.72;
    const feedback = context.createGain();
    feedback.gain.value = 0.19;
    const wet = context.createGain();
    wet.gain.value = 0.22;
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(master);

    this.musicNodes = { master, oscillators, noise, noiseFilter, noiseGain, lowPass, delay, feedback, wet };
    this.ambientStep = 0;
    this.playAmbientNote();
    this.ambientTimer = window.setInterval(() => this.playAmbientNote(), 5200);
  }

  playAmbientNote() {
    if (!this.musicEnabled || !this.musicNodes || !this.context) return;
    const context = this.context;
    const { master, delay } = this.musicNodes;
    const scale = [220, 293.66, 329.63, 440, 493.88, 587.33, 659.25];
    const note = scale[(this.ambientStep * 3 + (this.ambientStep % 2 ? 1 : 0)) % scale.length];
    this.ambientStep += 1;

    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const filter = context.createBiquadFilter();
    const now = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(note, now);
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(0.018, now + 0.35);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 4.6);
    oscillator.connect(filter);
    filter.connect(envelope);
    envelope.connect(master);
    envelope.connect(delay);
    oscillator.start(now);
    oscillator.stop(now + 4.8);
    oscillator.onended = () => {
      try { oscillator.disconnect(); filter.disconnect(); envelope.disconnect(); } catch { /* already disconnected */ }
    };
  }

  stopMusic() {
    if (this.ambientTimer) window.clearInterval(this.ambientTimer);
    this.ambientTimer = null;
    if (!this.musicNodes || !this.context) return;

    const nodes = this.musicNodes;
    this.musicNodes = null;
    const now = this.context.currentTime;
    try {
      nodes.master.gain.cancelScheduledValues(now);
      nodes.master.gain.setTargetAtTime(0.0001, now, 0.22);
    } catch { /* context may already be closed */ }

    window.setTimeout(() => {
      nodes.oscillators.forEach(({ oscillator, gain }) => {
        try { oscillator.stop(); oscillator.disconnect(); } catch { /* already stopped */ }
        try { gain.disconnect(); } catch { /* no-op */ }
      });
      try { nodes.noise.stop(); } catch { /* already stopped */ }
      [nodes.noise, nodes.noiseFilter, nodes.noiseGain, nodes.lowPass, nodes.delay, nodes.feedback, nodes.wet, nodes.master]
        .forEach(node => { try { node.disconnect(); } catch { /* no-op */ } });
    }, 1100);
  }

  play(name = 'click') {
    if (!this.soundEnabled) return;
    const context = this.ensureContext();
    if (!context) return;
    const sounds = {
      click: { frequency: 520, duration: 0.055, type: 'sine' },
      purchase: { frequency: 740, duration: 0.12, type: 'triangle' },
      error: { frequency: 170, duration: 0.16, type: 'sawtooth' },
      explosion: { frequency: 95, duration: 0.22, type: 'triangle' },
      launch: { frequency: 390, duration: 0.1, type: 'sine' }
    };
    const spec = sounds[name] || sounds.click;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = spec.type;
    oscillator.frequency.setValueAtTime(spec.frequency, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(45, spec.frequency * 0.62), context.currentTime + spec.duration);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.075, context.currentTime + 0.009);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + spec.duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + spec.duration + 0.02);
  }
}
