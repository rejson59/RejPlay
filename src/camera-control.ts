/**
 * Konfiguracja kamery + sterowanie bez klawiatury i myszy.
 *
 * Wejścia: FaceMesh (głowa, oczy) i MediaPipe Hands (dłonie).
 * Wyjścia: prędkość kątowa kamery (px/s, jak ruch myszą), wektor ruchu
 * (−1..1, jak joystick) oraz zdarzenia chwytu / odłożenia / użycia.
 *
 * Kalibracja zapamiętuje neutralną pozycję głowy i spojrzenia — bez niej
 * każda twarz ma inną geometrię i „patrzenie prosto" nie jest zerem.
 * Ustawienia są zapisywane lokalnie; testy sprawdzają, czy głowa, oczy i
 * dłonie faktycznie dają mierzalny sygnał, zanim odblokujemy tryb bez rąk.
 */

import { EMPTY_FACE, type FaceFrame } from './face-math';
import type { TrackedHand } from './hand-pose';
import {
  clampFinite, disambiguateHandedness, finite, validLandmarks,
} from './tracking-guard';

export interface ControlSettings {
  enabled: boolean;
  gazeSensitivity: number;
  headSensitivity: number;
  deadzone: number;
  smoothing: number;
  invertX: boolean;
}

export interface ControlFrame {
  /** px/s „jak mysz": +x = w prawo, +y = w dół. */
  lookX: number;
  lookY: number;
  /** −1..1 „jak joystick": +y = w przód, +x = w prawo. */
  moveX: number;
  moveY: number;
  /** Surowe sygnały po kalibracji do wizualizacji w laboratorium. */
  gazeX: number;
  gazeY: number;
  headPitch: number;
  headRoll: number;
}

export type GestureType = 'grab' | 'release' | 'useStart' | 'useEnd' | 'aim';

export interface GestureEvent {
  type: GestureType;
  slot: number;
  hand: 'L' | 'R';
}

export interface CalibrationSample {
  yaw: number;
  pitch: number;
  roll: number;
  gazeX: number;
  gazeY: number;
}

export interface LabDiagnostics {
  face: FaceFrame | null;
  hands: number;
  left: { curl: number; open: number; pinch: number };
  right: { curl: number; open: number; pinch: number };
  ranges: {
    pitch: number; roll: number; gazeX: number; gazeY: number;
    blink: number; twoHands: boolean; allFingers: boolean;
  };
  tests: { hands: boolean; head: boolean; eyes: boolean };
  ready: boolean;
  calibrated: boolean;
  enabled: boolean;
  settings: ControlSettings;
  neutral: CalibrationSample | null;
  slot: number;
}

const STORE = 'rejplay:camera-control-v1';
const ZERO: CalibrationSample = { yaw: 0, pitch: 0, roll: 0, gazeX: 0, gazeY: 0 };
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const dead = (value: number, zone: number): number => {
  const v = finite(value);
  const z = clampFinite(zone, 0, 0.3);
  const sign = v >= 0 ? 1 : -1;
  const mag = Math.max(0, Math.abs(v) - z) / Math.max(0.001, 1 - z);
  return sign * Math.min(1, mag);
};

function loadSettings(): ControlSettings {
  const base: ControlSettings = {
    enabled: false, gazeSensitivity: 1, headSensitivity: 1,
    deadzone: 0.07, smoothing: 0.55, invertX: false,
  };
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (!raw) return base;
    return {
      enabled: Boolean(raw.enabled),
      gazeSensitivity: clampFinite(raw.gazeSensitivity, 0.3, 2.5, 1),
      headSensitivity: clampFinite(raw.headSensitivity, 0.3, 2.5, 1),
      deadzone: clampFinite(raw.deadzone, 0, 0.3, 0.07),
      smoothing: clampFinite(raw.smoothing, 0, 0.95, 0.55),
      invertX: Boolean(raw.invertX),
      neutral: raw.neutral,
    } as ControlSettings;
  } catch {
    return base;
  }
}

function d2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

interface HandSignal { curl: number; open: number; pinch: number; x: number; y: number }

const NO_SIGNAL: HandSignal = { curl: 0, open: 0, pinch: 0, x: 0.5, y: 0.5 };

function handSignal(hand: TrackedHand): HandSignal {
  const lm = hand.landmarks;
  if (!validLandmarks(lm, 21, 64)) return { ...NO_SIGNAL };
  const wrist = lm[0];
  const palm = Math.max(0.02, d2(lm[5], lm[17]));
  const pinch = clampFinite((0.72 - d2(lm[4], lm[8]) / palm) / 0.55, 0, 1);
  let extended = 0;
  let curl = 0;
  for (const [mcp, pip, tip] of [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]]) {
    const full = d2(wrist, lm[tip]) / Math.max(0.008, d2(wrist, lm[mcp]));
    const bent = d2(lm[mcp], lm[tip]) / Math.max(0.008, d2(lm[mcp], lm[pip]));
    curl += clampFinite(1 - bent / 2.2, 0, 1);
    if (full > 1.55 && bent > 1.4) extended += 1;
  }
  return {
    curl: curl / 4, open: extended / 4, pinch,
    x: clampFinite(lm[9].x, -1, 2, 0.5), y: clampFinite(lm[9].y, -1, 2, 0.5),
  };
}

export class CameraControl {
  settings: ControlSettings = loadSettings();
  neutral: CalibrationSample | null = null;
  private calibrating = false;
  private samples: CalibrationSample[] = [];
  private readonly min = { pitch: 9, roll: 9, gazeX: 9, gazeY: 9 };
  private readonly max = { pitch: -9, roll: -9, gazeX: -9, gazeY: -9 };
  private blinkSeen = 0;
  private twoHandsSeen = false;
  private fingersSeen = false;
  private lastFace: FaceFrame | null = null;
  private handCount = 0;
  private lastHands = { L: { curl: 0, open: 0, pinch: 0 }, R: { curl: 0, open: 0, pinch: 0 } };
  private lastPinch = { L: false, R: false };
  private lastOpen = { L: false, R: false };
  private lastSlot = -1;
  private smooth = { lookX: 0, lookY: 0, moveX: 0, moveY: 0 };
  private emptyStreak = 0;
  /** −1 = pusta dłoń; aktualizowane z HUD-u gry, żeby gest chwytu wiedział,
   *  czy ma wziąć narzędzie z pasa, czy zacząć go używać. */
  private held = -1;
  private time = 0;
  private readonly openSince = { L: 0, R: 0 };
  private readonly releaseSent = { L: false, R: false };

  constructor() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null');
      const n = raw?.neutral;
      if (n && typeof n.pitch === 'number') {
        this.neutral = {
          yaw: Number(n.yaw) || 0, pitch: Number(n.pitch) || 0, roll: Number(n.roll) || 0,
          gazeX: Number(n.gazeX) || 0, gazeY: Number(n.gazeY) || 0,
        };
      }
    } catch { /* brak zapisanej kalibracji */ }
  }

  setHeld(index: number): void {
    this.held = index;
  }

  save(): void {
    try {
      localStorage.setItem(STORE, JSON.stringify({ ...this.settings, neutral: this.neutral }));
    } catch { /* tryb prywatny */ }
  }

  beginCalibration(): void {
    this.calibrating = true;
    this.samples = [];
  }

  /** Zatwierdza neutralną pozycję z ostatnich ~50 klatek. */
  finishCalibration(): boolean {
    this.calibrating = false;
    if (this.samples.length < 12) return false;
    const sum = this.samples.reduce(
      (acc, s) => ({
        yaw: acc.yaw + s.yaw, pitch: acc.pitch + s.pitch, roll: acc.roll + s.roll,
        gazeX: acc.gazeX + s.gazeX, gazeY: acc.gazeY + s.gazeY,
      }),
      { ...ZERO },
    );
    const n = this.samples.length;
    this.neutral = {
      yaw: sum.yaw / n, pitch: sum.pitch / n, roll: sum.roll / n,
      gazeX: sum.gazeX / n, gazeY: sum.gazeY / n,
    };
    this.save();
    return true;
  }

  resetTests(): void {
    for (const key of ['pitch', 'roll', 'gazeX', 'gazeY'] as const) {
      this.min[key] = 9;
      this.max[key] = -9;
    }
    this.blinkSeen = 0;
    this.twoHandsSeen = false;
    this.fingersSeen = false;
  }

  get calibrationProgress(): number {
    return clamp(this.samples.length / 45, 0, 1);
  }

  get tests(): LabDiagnostics['tests'] {
    return {
      hands: this.twoHandsSeen && this.fingersSeen,
      head: this.range('pitch') > 0.13 && this.range('roll') > 0.07,
      eyes: this.range('gazeX') > 0.22 && (this.range('gazeY') > 0.14 || this.blinkSeen > 0.75),
    };
  }

  get ready(): boolean {
    const t = this.tests;
    return Boolean(this.neutral) && t.hands && t.head && t.eyes;
  }

  private range(key: 'pitch' | 'roll' | 'gazeX' | 'gazeY'): number {
    return Math.max(0, this.max[key] - this.min[key]);
  }

  private track(key: 'pitch' | 'roll' | 'gazeX' | 'gazeY', value: number): void {
    if (value < this.min[key]) this.min[key] = value;
    if (value > this.max[key]) this.max[key] = value;
  }

  diagnostics(): LabDiagnostics {
    return {
      face: this.lastFace,
      hands: this.handCount,
      left: this.lastHands.L,
      right: this.lastHands.R,
      ranges: {
        pitch: this.range('pitch'), roll: this.range('roll'),
        gazeX: this.range('gazeX'), gazeY: this.range('gazeY'),
        blink: this.blinkSeen, twoHands: this.twoHandsSeen, allFingers: this.fingersSeen,
      },
      tests: this.tests,
      ready: this.ready,
      calibrated: Boolean(this.neutral),
      enabled: this.settings.enabled,
      settings: { ...this.settings },
      neutral: this.neutral,
      slot: Math.max(0, this.lastSlot),
    };
  }

  /**
   * Jedna klatka z obu modeli → sterowanie + gesty. Wywoływana tylko gdy
   * kamerka działa; dt w sekundach (z limitem, żeby po spadku FPS nie skoczyć).
   */
  ingest(face: FaceFrame, hands: TrackedHand[], dt: number): { control: ControlFrame; gestures: GestureEvent[] } {
    const gestures: GestureEvent[] = [];
    const s = this.settings;
    const step = clampFinite(dt, 0.001, 0.12, 1 / 60);
    this.time += step;
    // Pusta klatka NIE jest „głową w pozycji zero". Odejmowanie neutralnej
    // kalibracji od zera dawało stały, niezerowy wektor ruchu: po zniknięciu
    // twarzy postać jechała sama. Rozróżniamy brak sygnału od sygnału zerowego.
    const faceActive = face.present
      && Number.isFinite(face.yaw) && Number.isFinite(face.pitch)
      && Number.isFinite(face.roll) && Number.isFinite(face.gazeX)
      && Number.isFinite(face.gazeY) && Number.isFinite(face.blink);
    this.lastFace = faceActive ? face : (++this.emptyStreak <= 12 ? this.lastFace : null);

    // --- kalibracja i zakresy testowe
    if (faceActive) {
      this.emptyStreak = 0;
      const raw: CalibrationSample = {
        yaw: face.yaw, pitch: face.pitch, roll: face.roll,
        gazeX: face.gazeX, gazeY: face.gazeY,
      };
      if (this.calibrating && this.samples.length < 70) this.samples.push(raw);
      const n = this.neutral ?? ZERO;
      this.track('pitch', raw.pitch - n.pitch);
      this.track('roll', raw.roll - n.roll);
      this.track('gazeX', raw.gazeX - n.gazeX);
      this.track('gazeY', raw.gazeY - n.gazeY);
      this.blinkSeen = Math.max(this.blinkSeen, finite(face.blink));
    }

    // --- dłonie: sygnały i gesty
    const bySide: Record<'L' | 'R', TrackedHand | null> = { L: null, R: null };
    for (const hand of disambiguateHandedness(hands ?? [])) {
      // MediaPipe zakłada obraz lustrzany; zamiana stron jak w posesFromHands.
      bySide[hand.label === 'Left' ? 'R' : 'L'] = hand as TrackedHand;
    }
    const signals: Record<'L' | 'R', HandSignal> = {
      L: bySide.L ? handSignal(bySide.L) : { ...NO_SIGNAL },
      R: bySide.R ? handSignal(bySide.R) : { ...NO_SIGNAL },
    };
    this.lastHands = {
      L: { curl: signals.L.curl, open: signals.L.open, pinch: signals.L.pinch },
      R: { curl: signals.R.curl, open: signals.R.open, pinch: signals.R.pinch },
    };
    const present = (bySide.L ? 1 : 0) + (bySide.R ? 1 : 0);
    this.handCount = present;
    if (present === 2) this.twoHandsSeen = true;
    if (present >= 1 && (signals.L.open > 0.9 || signals.R.open > 0.9)) this.fingersSeen = true;

    for (const side of ['L', 'R'] as const) {
      const pinching = signals[side].pinch > 0.72 && Boolean(bySide[side]);
      const spread = signals[side].open > 0.88 && signals[side].curl < 0.28 && Boolean(bySide[side]);
      if (pinching && !this.lastPinch[side]) {
        if (this.held < 0) {
          gestures.push({ type: 'grab', slot: this.lastSlot < 0 ? 0 : this.lastSlot, hand: side });
        } else {
          gestures.push({ type: 'useStart', slot: 0, hand: side });
        }
      }
      if (!pinching && this.lastPinch[side]) gestures.push({ type: 'useEnd', slot: 0, hand: side });
      // Odłożenie wymaga ŚWIADOMIE otwartej dłoni przez ~0,9 s. Dzięki temu
      // zwykłe puszczenie chwytu nie wyrzuca narzędzia z ręki.
      if (spread && !this.releaseSent[side]) {
        if (!this.openSince[side]) this.openSince[side] = this.time;
        if (this.held >= 0 && this.time - this.openSince[side] > 0.9) {
          gestures.push({ type: 'release', slot: 0, hand: side });
          this.releaseSent[side] = true;
        }
      } else if (!spread) {
        this.openSince[side] = 0;
        this.releaseSent[side] = false;
      }
      this.lastPinch[side] = pinching;
      this.lastOpen[side] = spread;
    }

    // --- celowanie na slot pasa: palec wskazujący albo spojrzenie w dół
    let slot = this.lastSlot < 0 ? 0 : this.lastSlot;
    const pointHand = signals.L.open >= 0.5 ? bySide.L : bySide.R;
    if (pointHand) {
      const sig = signals[pointHand === bySide.L ? 'L' : 'R'];
      slot = clamp(Math.round(((sig.x - 0.18) / 0.64) * 5), 0, 5);
    } else if (faceActive && face.gazeY > 0.35) {
      slot = clamp(Math.round(((face.gazeX - (this.neutral?.gazeX ?? 0) + 0.6) / 1.2) * 5), 0, 5);
    }
    if (slot !== this.lastSlot) {
      this.lastSlot = slot;
      gestures.push({ type: 'aim', slot, hand: 'L' });
    }

    // --- mapowanie sygnałów na kamerę i ruch
    const n = this.neutral ?? ZERO;
    const gx = faceActive ? dead((face.gazeX - n.gazeX) * (s.invertX ? -1 : 1), s.deadzone) : 0;
    const gy = faceActive ? dead(face.gazeY - n.gazeY, s.deadzone) : 0;
    const headPitch = faceActive ? dead(face.pitch - n.pitch, s.deadzone * 0.8) : 0;
    const headRoll = faceActive ? dead(face.roll - n.roll, s.deadzone * 0.8) : 0;
    const headYaw = faceActive ? dead(face.yaw - n.yaw, s.deadzone) : 0;
    const gazeGain = clampFinite(s.gazeSensitivity, 0.3, 2.5, 1);
    const headGain = clampFinite(s.headSensitivity, 0.3, 2.5, 1);

    const targetLookX = (gx * 1050 + headYaw * 260) * gazeGain;
    const targetLookY = (gy * 900) * gazeGain;
    // Prędkość jest WPROST proporcjonalna do przechyłu głowy.
    const targetMoveY = clampFinite(headPitch * 3.1 * headGain, -1, 1);
    const targetMoveX = clampFinite(headRoll * 2.4 * headGain, -1, 1);

    const smoothing = clampFinite(s.smoothing, 0, 0.95, 0.55);
    const k = 1 - Math.exp(-step / Math.max(0.02, 0.06 + smoothing * 0.34));
    for (const [key, target] of [
      ['lookX', targetLookX], ['lookY', targetLookY],
      ['moveX', targetMoveX], ['moveY', targetMoveY],
    ] as const) {
      // Zatruty kanał wraca do zera, zamiast na zawsze zamrażać kamerę.
      this.smooth[key] = clampFinite(
        this.smooth[key] + (target - this.smooth[key]) * k, -1500, 1500, target,
      );
    }

    const control: ControlFrame = {
      lookX: s.enabled ? finite(this.smooth.lookX) : 0,
      lookY: s.enabled ? finite(this.smooth.lookY) : 0,
      moveX: s.enabled ? finite(this.smooth.moveX) : 0,
      moveY: s.enabled ? finite(this.smooth.moveY) : 0,
      gazeX: gx, gazeY: gy, headPitch, headRoll,
    };
    return { control, gestures: s.enabled ? gestures : gestures.filter((g) => g.type === 'aim') };
  }

  zero(): void {
    this.handCount = 0;
    this.smooth = { lookX: 0, lookY: 0, moveX: 0, moveY: 0 };
    this.lastFace = null;
  }
}

export { EMPTY_FACE };
