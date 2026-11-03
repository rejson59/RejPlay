/**
 * Adaptacyjna jakość renderingu.
 *
 * Problem: pojedynczy renderer WebGL obsługuje trzy sceny, a na telefonach
 * antyaliasing + DPR 2 + cienie latarki potrafią zepchnąć klatkę poniżej 30 fps.
 * Zamiast zgadywać „czy to słaby telefon”, mierzymy prawdziwy czas między
 * klatkami i z histerezą zmniejszamy rozdzielczość (oraz wyłączamy cienie i
 * kurz). Gdy komputer ma zapas, jakość wraca — ale powoli, żeby nie mrugać.
 *
 * Użytkownik może też wybrać tryb na sztywno (Auto / Oszczędna / Wysoka).
 * Wybór zapisuje się w localStorage, tak jak motyw i wygląd postaci.
 */

export type QualityMode = 'auto' | 'low' | 'high';
export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityProfile {
  level: QualityLevel;
  label: string;
  /** Maksymalny mnożnik devicePixelRatio. */
  maxDpr: number;
  shadows: boolean;
  shadowSize: number;
  dust: boolean;
  grain: boolean;
  props: boolean;
  /** Górny limit klatek (chroni baterię na ekranach 90/120 Hz). */
  maxFps: number;
  antialias: boolean;
}

export const PROFILES: Record<QualityLevel, QualityProfile> = {
  low: {
    level: 'low', label: 'Oszczędna', maxDpr: 1, shadows: false, shadowSize: 512,
    dust: false, grain: false, props: true, maxFps: 45, antialias: false,
  },
  medium: {
    level: 'medium', label: 'Zrównoważona', maxDpr: 1.5, shadows: true, shadowSize: 1024,
    dust: true, grain: true, props: true, maxFps: 60, antialias: true,
  },
  high: {
    level: 'high', label: 'Wysoka', maxDpr: 2, shadows: true, shadowSize: 2048,
    dust: true, grain: true, props: true, maxFps: 60, antialias: true,
  },
};

const STORAGE_KEY = 'rejplay:quality';

export function readQualityMode(): QualityMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'low' || value === 'high' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export function storeQualityMode(mode: QualityMode): void {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* prywatny tryb */ }
}

interface DeviceHints {
  coarse: boolean;
  cores: number;
  memory: number;
  smallScreen: boolean;
  dpr: number;
}

export function deviceHints(): DeviceHints {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    coarse: window.matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints ?? 0) > 0,
    cores: nav.hardwareConcurrency ?? 4,
    memory: nav.deviceMemory ?? 4,
    smallScreen: Math.min(window.innerWidth, window.innerHeight) < 520,
    dpr: window.devicePixelRatio || 1,
  };
}

/** Slabsze telefony i tablety nie powinny w ogóle alokować map cieni 2048². */
export function lowPowerDevice(): boolean {
  const d = deviceHints();
  return d.cores <= 4 || d.memory <= 3 || (d.coarse && d.smallScreen) || d.dpr > 2.6;
}

export function guessLevel(): QualityLevel {
  const d = deviceHints();
  if (d.cores <= 2 || d.memory <= 2 || (d.coarse && d.smallScreen && d.cores <= 6)) return 'low';
  if (d.coarse || d.cores <= 6 || d.memory <= 4 || d.dpr > 2.5) return 'medium';
  return 'high';
}

/** Profil znany przed utworzeniem WebGLRenderer (antyaliasingu nie da się zmienić). */
export function initialProfile(): QualityProfile {
  const mode = readQualityMode();
  if (mode === 'low') return PROFILES.low;
  if (mode === 'high') return PROFILES.high;
  return PROFILES[guessLevel()];
}

export type QualityApply = (profile: QualityProfile, dpr: number) => void;

export class QualityManager {
  private mode: QualityMode;
  private level: QualityLevel;
  /** Ciągły mnożnik rozdzielczości w trybie auto (0,62–1). */
  private scale = 1;
  private ema = 1 / 60;
  private lastChange = 0;
  private readonly started = performance.now();
  private lastSignature = '';
  private shadows: boolean | null = null;

  constructor(private readonly apply: QualityApply) {
    this.mode = readQualityMode();
    this.level = this.mode === 'auto' ? guessLevel() : this.mode === 'low' ? 'low' : 'high';
    this.commit(true);
  }

  get current(): QualityProfile { return PROFILES[this.level]; }
  get modeValue(): QualityMode { return this.mode; }
  get renderScale(): number { return this.scale; }
  get minFrameMs(): number { return 1000 / PROFILES[this.level].maxFps - 1.5; }
  get buttonLabel(): string {
    return this.mode === 'auto' ? `Jakość: auto (${this.current.label})`
      : this.mode === 'low' ? 'Jakość: oszczędna' : 'Jakość: wysoka';
  }
  get shadowsEnabled(): boolean | null { return this.shadows; }
  set shadowsEnabled(value: boolean | null) { this.shadows = value; }

  /** Auto → Oszczędna → Wysoka → Auto. */
  cycle(): void {
    this.setMode(this.mode === 'auto' ? 'low' : this.mode === 'low' ? 'high' : 'auto');
  }

  setMode(mode: QualityMode): void {
    this.mode = mode;
    storeQualityMode(mode);
    this.level = mode === 'auto' ? guessLevel() : mode === 'low' ? 'low' : 'high';
    this.scale = 1;
    this.ema = 1 / 60;
    this.lastChange = performance.now();
    this.commit(true);
  }

  private dpr(): number {
    const base = Math.min(window.devicePixelRatio || 1, this.current.maxDpr);
    return Math.max(0.6, Math.min(2, base * (this.mode === 'auto' ? this.scale : 1)));
  }

  private commit(force = false): void {
    const profile = this.current;
    const dpr = this.dpr();
    const signature = `${profile.level}|${dpr.toFixed(3)}`;
    if (!force && signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.apply(profile, dpr);
  }

  /**
   * realDt = rzeczywisty czas między wyrenderowanymi klatkami (nie dławiony dt
   * fizyki). Pierwsze 1,8 s ignorujemy: wtedy kompilują się shadery i wczytują
   * tekstury, więc jednorazowe przycięcie nie powinno degradować jakości.
   */
  sample(realDt: number): void {
    // Powrót z ukrytej karty / długa pauza GC to nie jest „wolny komputer”.
    if (this.mode !== 'auto' || realDt > 0.25) return;
    const clamped = Math.min(Math.max(realDt, 0.001), 0.2);
    this.ema += (clamped - this.ema) * 0.1;
    const now = performance.now();
    if (now - this.started < 1800 || now - this.lastChange < 1500) return;

    // 38 fps (26 ms) → zdecydowanie za wolno. Najpierw tniemy rozdzielczość.
    if (this.ema > 0.026) {
      if (this.scale > 0.62) {
        this.scale = Math.max(0.62, this.scale - 0.12);
      } else if (this.level !== 'low') {
        this.level = this.level === 'high' ? 'medium' : 'low';
      }
      this.lastChange = now;
      this.commit();
      return;
    }
    // 48 fps (21 ms) — lekki spadek tylko przy wysokim profilu.
    if (this.ema > 0.021 && this.level === 'high') {
      this.level = 'medium';
      this.lastChange = now;
      this.commit();
      return;
    }
    // Stabilne ~60 fps: powoli oddajemy rozdzielczość, potem profil.
    if (this.ema < 0.0168 && now - this.lastChange > 5200) {
      if (this.scale < 0.995) this.scale = Math.min(1, this.scale + 0.06);
      else if (this.level === 'low') this.level = 'medium';
      else if (this.level === 'medium' && !lowPowerDevice()) this.level = 'high';
      else return;
      this.lastChange = now;
      this.commit();
    }
  }
}
