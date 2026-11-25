export class AudioManager {
  constructor() {
    this.soundEnabled = localStorage.getItem('ow_sound') !== 'false';
    this.musicEnabled = localStorage.getItem('ow_music') === 'true';
    this.context = null;
    this.musicNodes = null;
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
    if (!context || this.musicNodes) return;
    const master = context.createGain();
    master.gain.value = 0.018;
    master.connect(context.destination);
    const oscillators = [55, 82.41, 110].map((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = index === 1 ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.value = index === 0 ? 0.55 : 0.18;
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start();
      return { oscillator, gain };
    });
    this.musicNodes = { master, oscillators };
  }

  stopMusic() {
    if (!this.musicNodes) return;
    this.musicNodes.oscillators.forEach(({ oscillator }) => {
      try { oscillator.stop(); } catch { /* already stopped */ }
    });
    try { this.musicNodes.master.disconnect(); } catch { /* no-op */ }
    this.musicNodes = null;
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
