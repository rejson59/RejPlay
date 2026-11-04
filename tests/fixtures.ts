/** Dane testowe o kształcie identycznym z odczytem MediaPipe. */
import type { Landmark } from '../src/tracking-guard';
import type { TrackedHand } from '../src/hand-pose';
import type { FaceFrame } from '../src/face-math';

/** 478 punktów twarzy + źrenic, wszystkie skończone i w plausible range. */
export function makeFace(count = 478): Landmark[] {
  return Array.from({ length: count }, (_, i) => ({
    x: 0.15 + ((i * 7) % 70) / 100,
    y: 0.15 + ((i * 13) % 70) / 100,
    z: ((i % 11) - 5) / 100,
  }));
}

/** 21 punktów dłoni; nadgarstek (0) i nasada palca środkowego (9) są wyraźne. */
export function makeHand(wristX = 0.5, label: 'Left' | 'Right' = 'Left', score = 0.9): TrackedHand {
  const landmarks: Landmark[] = Array.from({ length: 21 }, (_, i) => ({
    x: wristX + ((i % 5) - 2) * 0.03,
    y: 0.72 - (i % 5) * 0.045,
    z: ((i % 3) - 1) * 0.01,
  }));
  landmarks[0] = { x: wristX, y: 0.78, z: 0 };
  landmarks[9] = { x: wristX + 0.01, y: 0.52, z: 0 };
  return { label, score, landmarks };
}

export function makeFaceFrame(overrides: Partial<FaceFrame> = {}): FaceFrame {
  return {
    present: true,
    yaw: 0.2, pitch: 0.3, roll: -0.1,
    gazeX: 0.4, gazeY: 0.2, blink: 0, openness: 0.3,
    iris: true,
    landmarks: makeFace(),
    ...overrides,
  };
}
