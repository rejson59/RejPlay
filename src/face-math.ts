/**
 * Czysta matematyka twarzy, głowy i źrenic (MediaPipe FaceMesh).
 *
 * Wydzielona z `face-tracking.ts`, żeby nie zależeć od DOM ani `import.meta.env`
 * i dawać się przetestować w zwykłym Node. `face-tracking.ts` odpowiada teraz
 * wyłącznie za izolowany iframe i transport klatek; liczby powstają tutaj.
 *
 * 468 punktów twarzy + 10 punktów tęczówek (refineLandmarks) dają:
 * przechył głowy (pitch/roll/yaw), spojrzenie względem kącików oka i mrugnięcie.
 */

import {
  clampFinite, finite, plausiblePoint, validLandmarks, type Landmark,
} from './tracking-guard';

export interface FaceFrame {
  present: boolean;
  /** Obrót głowy wokół osi pionowej (ok. −0.5..0.5). */
  yaw: number;
  /** Kiwnięcie: + = głowa w dół / w przód, − = głowa do tyłu. */
  pitch: number;
  /** Przechył na bok w radianach. */
  roll: number;
  /** Spojrzenie: +x = w prawo, +y = w dół, skala ok. −1..1. */
  gazeX: number;
  gazeY: number;
  /** 0 = oko otwarte, 1 = zamknięte. */
  blink: number;
  /** Surowa, nienormalizowana szerokość szpary powiekowej. */
  openness: number;
  /** Czy model zwrócił punkty tęczówek (refineLandmarks). */
  iris: boolean;
  landmarks: Landmark[];
}

export const EMPTY_FACE: Readonly<FaceFrame> = Object.freeze({
  present: false, yaw: 0, pitch: 0, roll: 0, gazeX: 0, gazeY: 0,
  blink: 0, openness: 0, iris: false, landmarks: [] as Landmark[],
});

export function emptyFace(): FaceFrame {
  return { ...EMPTY_FACE, landmarks: [] };
}

const dist = (a: Landmark, b: Landmark): number =>
  Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.4);

/** Średni punkt z listy indeksów (odporny na pojedynczy szum). */
export function centroid(lm: readonly Landmark[], indices: readonly number[]): Landmark {
  let x = 0, y = 0, z = 0;
  let used = 0;
  for (const i of indices) {
    const point = lm[i];
    if (!plausiblePoint(point)) continue;
    x += point.x; y += point.y; z += point.z;
    used += 1;
  }
  const n = used || 1;
  return { x: x / n, y: y / n, z: z / n };
}

/**
 * Jedna klatka → sygnały kalibracyjne. Wszystko względne, bez stałych znaków.
 * `blinkBaseline` pozwala wpiąć adaptacyjną kalibrację powiek z `FaceTracker`.
 */
export function faceFrameFromLandmarks(
  lm: readonly Landmark[] | undefined,
  blinkBaseline = 0.32,
): FaceFrame {
  if (!validLandmarks(lm, 468, 600)) return emptyFace();
  const points = lm as readonly Landmark[];
  const nose = points[1];
  const forehead = points[10];
  const chin = points[152];
  const leftEar = points[234];
  const rightEar = points[454];
  const eyeSpan = Math.max(0.02, rightEar.x - leftEar.x);
  const faceSpan = Math.max(0.02, chin.y - forehead.y);
  const eyeCenterX = (leftEar.x + rightEar.x) / 2;

  const yaw = clampFinite((nose.x - eyeCenterX) / eyeSpan, -1, 1);
  const pitch = clampFinite((nose.y - (forehead.y + chin.y) / 2) / faceSpan, -1, 1);
  const roll = clampFinite(Math.atan2(rightEar.y - leftEar.y, rightEar.x - leftEar.x), -1, 1);

  const leftInner = points[133], leftOuter = points[33];
  const rightInner = points[263], rightOuter = points[362];
  const hasIris = points.length >= 478 && plausiblePoint(points[477]);
  let gazeX = 0;
  let gazeY = 0;

  if (hasIris) {
    const leftIris = centroid(points, [468, 469, 470, 471]);
    const rightIris = centroid(points, [473, 474, 475, 476]);
    const lx = (leftIris.x - (leftOuter.x + leftInner.x) / 2)
      / Math.max(0.006, Math.abs(leftInner.x - leftOuter.x));
    const rx = (rightIris.x - (rightOuter.x + rightInner.x) / 2)
      / Math.max(0.006, Math.abs(rightInner.x - rightOuter.x));
    const ly = (leftIris.y - (points[159].y + points[145].y) / 2)
      / Math.max(0.004, Math.abs(points[145].y - points[159].y));
    const ry = (rightIris.y - (points[386].y + points[374].y) / 2)
      / Math.max(0.004, Math.abs(points[374].y - points[386].y));
    gazeX = clampFinite(((lx + rx) / 2) * 1.9, -1.6, 1.6);
    gazeY = clampFinite(((ly + ry) / 2) * 1.9, -1.6, 1.6);
  }

  const openness = (
    dist(points[159], points[145]) / Math.max(0.006, dist(points[33], points[133]))
    + dist(points[386], points[374]) / Math.max(0.006, dist(points[362], points[263]))
  ) / 2;
  const baseline = Math.max(0.08, finite(blinkBaseline, 0.32));
  const blink = clampFinite(1 - openness / baseline, 0, 1);

  return {
    present: true,
    yaw, pitch, roll,
    gazeX, gazeY,
    blink,
    openness: finite(openness),
    iris: hasIris,
    landmarks: points.slice() as Landmark[],
  };
}

/**
 * Mrugnięcie musi być względne wobec TWARZY użytkownika. Stały próg 0,32
 * oznaczał u osób z wąskimi oczami wieczne „mruganie”, a u osób z szerokimi
 * oczami test kalibracji nie przechodził nigdy. Trzymamy wolno gasnące
 * maksimum otwarcia i liczymy zamknięcie jako ułamek własnej normy.
 */
export class BlinkCalibrator {
  private peak = 0.32;

  next(openness: number): { blink: number; baseline: number } {
    const o = finite(openness, this.peak);
    this.peak = Math.max(0.12, o, this.peak * 0.994);
    const closeAt = this.peak * 0.62;
    const span = Math.max(0.02, this.peak * 0.46);
    return {
      blink: clampFinite((closeAt - o) / span, 0, 1),
      baseline: this.peak,
    };
  }

  reset(): void {
    this.peak = 0.32;
  }

  get baseline(): number {
    return this.peak;
  }
}
