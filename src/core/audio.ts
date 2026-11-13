import type { AudioEngineLike } from './types';

/**
 * Cała warstwa dźwiękowa jest GENEROWANA w WebAudio — nie ma ani jednego pliku
 * audio. To ważne dla „Głuchego Świata": każdy materiał ma własną barwę echa,
 * więc dźwięk niesie informację o geometrii, a nie tylko ozdabia obraz.
 */
export class AudioEngine implements AudioEngineLike {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private droneNodes: AudioNode[] = [];
  private noiseBuffer: AudioBuffer | null = null;
  private isMuted = false;

  constructor() {
    try { this.isMuted = localStorage.getItem('rejplay:gabinet:mute') === '1'; } catch { /* prywatny */ }
  }

  get muted(): boolean { return this.isMuted; }

  setMuted(value: boolean): void {
    this.isMuted = value;
    try { localStorage.setItem('rejplay:gabinet:mute', value ? '1' : '0'); } catch { /* prywatny */ }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(value ? 0 : 0.55, this.ctx.currentTime, 0.05);
    }
  }

  /** Wywoływane przy pierwszym geście użytkownika (polityka autoplay). */
  unlock(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.isMuted ? 0 : 0.55;
    this.master.connect(this.ctx.destination);
  }

  private get noise(): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
    return buf;
  }

  private tone(freq: number, duration: number, opts: {
    type?: OscillatorType; gain?: number; delay?: number; endFreq?: number; q?: number;
  } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.endFreq), t + duration);
    const peak = opts.gain ?? 0.18;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.015, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private hiss(duration: number, opts: { gain?: number; freq?: number; q?: number; delay?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = opts.freq ?? 1400;
    filter.Q.value = opts.q ?? 1.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(opts.gain ?? 0.09, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  /** `options.pitch` przestraja, `options.gain` wzmacnia, `options.delay` opóźnia. */
  play(name: string, options: Record<string, number | string> = {}): void {
    this.unlock();
    if (!this.ctx || this.isMuted) return;
    const pitch = typeof options.pitch === 'number' ? options.pitch : 1;
    const gain = typeof options.gain === 'number' ? options.gain : 1;
    const delay = typeof options.delay === 'number' ? options.delay : 0;
    const f = (v: number): number => v * pitch;
    switch (name) {
      case 'ui': this.tone(f(620), 0.055, { type: 'triangle', gain: 0.09 * gain, delay }); break;
      case 'click': this.tone(f(1500), 0.022, { type: 'square', gain: 0.055 * gain, delay });
        this.hiss(0.03, { freq: 3200, gain: 0.045 * gain, delay }); break;
      case 'relay': this.tone(f(240), 0.07, { type: 'square', gain: 0.075 * gain, delay });
        this.hiss(0.06, { freq: 900, gain: 0.07 * gain, delay }); break;
      case 'dial': this.tone(f(420), 0.11, { type: 'sine', gain: 0.09 * gain, delay });
        this.tone(f(360), 0.11, { type: 'sine', gain: 0.04 * gain, delay: delay + 0.05 }); break;
      case 'tape': this.hiss(0.42, { freq: 2400, gain: 0.055 * gain, delay, q: 0.6 });
        this.tone(f(90), 0.3, { type: 'triangle', gain: 0.05 * gain, delay }); break;
      case 'bell': this.tone(f(880), 0.5, { type: 'sine', gain: 0.11 * gain, delay });
        this.tone(f(1320), 0.42, { type: 'sine', gain: 0.05 * gain, delay }); break;
      case 'ping': this.tone(f(1100), 0.16, { type: 'sine', gain: 0.13 * gain, delay, endFreq: f(700) }); break;
      case 'concrete': this.hiss(0.14, { freq: 520, gain: 0.075 * gain, delay, q: 0.8 }); break;
      case 'metal': this.tone(f(1750), 0.55, { type: 'sine', gain: 0.075 * gain, delay, endFreq: f(1650) });
        this.tone(f(2630), 0.4, { type: 'sine', gain: 0.035 * gain, delay }); break;
      case 'water': this.hiss(0.3, { freq: 760, gain: 0.07 * gain, delay, q: 0.5 });
        this.tone(f(300), 0.24, { type: 'sine', gain: 0.045 * gain, delay, endFreq: 190 }); break;
      case 'glass': this.hiss(0.2, { freq: 4200, gain: 0.08 * gain, delay, q: 2 }); break;
      case 'step': this.hiss(0.055, { freq: 300, gain: 0.055 * gain, delay, q: 0.7 }); break;
      case 'heart': this.tone(f(62), 0.16, { type: 'sine', gain: 0.14 * gain, delay, endFreq: 42 });
        this.tone(f(55), 0.13, { type: 'sine', gain: 0.09 * gain, delay: delay + 0.22 }); break;
      case 'squelch': this.tone(f(160), 0.22, { type: 'sawtooth', gain: 0.06 * gain, delay, endFreq: 75 });
        this.hiss(0.2, { freq: 420, gain: 0.055 * gain, delay }); break;
      case 'whisper': this.hiss(0.32, { freq: 2000, gain: 0.04 * gain, delay, q: 2.5 }); break;
      case 'paper': this.hiss(0.16, { freq: 3100, gain: 0.05 * gain, delay, q: 0.7 }); break;
      case 'success': [523, 659, 784, 1046].forEach((n, i) =>
        this.tone(f(n), 0.3, { type: 'triangle', gain: 0.085 * gain, delay: delay + i * 0.1 })); break;
      case 'fail': [330, 247, 165].forEach((n, i) =>
        this.tone(f(n), 0.34, { type: 'sawtooth', gain: 0.07 * gain, delay: delay + i * 0.13 })); break;
      case 'alarm': this.tone(f(700), 0.3, { type: 'square', gain: 0.09 * gain, delay });
        this.tone(f(520), 0.3, { type: 'square', gain: 0.09 * gain, delay: delay + 0.32 }); break;
      default: this.tone(f(440), 0.09, { gain: 0.07 * gain, delay });
    }
  }

  /** Ciągły, cichy podkład. Każda gra ma własną barwę. */
  startDrone(kind: string): void {
    this.unlock();
    this.stopDrone();
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const bus = ctx.createGain();
    bus.gain.value = 0.0001;
    bus.connect(this.master);
    bus.gain.setTargetAtTime(kind === 'gluchy' ? 0.035 : 0.028, ctx.currentTime, 1.2);
    const spec: Record<string, { f: number; type: OscillatorType; g: number }[]> = {
      centrala: [{ f: 50, type: 'sine', g: 0.5 }, { f: 100, type: 'triangle', g: 0.15 }],
      pasozyt: [{ f: 44, type: 'sine', g: 0.6 }, { f: 66, type: 'sine', g: 0.2 }],
      gluchy: [{ f: 34, type: 'sine', g: 0.7 }, { f: 51, type: 'triangle', g: 0.12 }],
      amnezja: [{ f: 196, type: 'sine', g: 0.25 }, { f: 293.7, type: 'sine', g: 0.14 }],
    };
    for (const voice of spec[kind] ?? spec.centrala) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = voice.type;
      osc.frequency.value = voice.f;
      g.gain.value = voice.g;
      osc.connect(g).connect(bus);
      osc.start();
      this.droneNodes.push(osc, g);
    }
    this.droneGain = bus;
    this.droneNodes.push(bus);
  }

  stopDrone(): void {
    const ctx = this.ctx;
    if (this.droneGain && ctx) this.droneGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2);
    const nodes = this.droneNodes;
    this.droneNodes = [];
    this.droneGain = null;
    window.setTimeout(() => {
      for (const node of nodes) {
        if ('stop' in node) try { (node as OscillatorNode).stop(); } catch { /* już zatrzymany */ }
        try { node.disconnect(); } catch { /* już odłączony */ }
      }
    }, 600);
  }
}
