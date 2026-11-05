import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GAZE_TARGETS, GazeCalibrator, MIN_CALIBRATION_POINTS, applyGazeMapping,
  fitGazeMapping, median, parseGazeMapping, type CalibrationPair,
} from '../src/gaze-calibration';

/** Odtwarza surowy odczyt źrenicy dla idealnej, ale skręconej kamerki. */
const RAW = {
  ax: 0.22, ay: 0.03, bx: 0.04, by: 0.19, cx: 0.11, cy: -0.07,
};
function fakeGaze(x: number, y: number): { x: number; y: number } {
  // Odwrócone przekształcenie: surowe = (ekran − offset) / wzmocnienie.
  return { x: (x - RAW.cx) / RAW.ax + y * 0.05, y: (y - RAW.cy) / RAW.by - x * 0.03 };
}

test('GAZE_TARGETS: siatka 3×3 zaczyna się od środka i mieści się w −1..1', () => {
  assert.equal(GAZE_TARGETS.length, 9);
  assert.equal(GAZE_TARGETS[0].id, 'center');
  assert.deepEqual([GAZE_TARGETS[0].x, GAZE_TARGETS[0].y], [0, 0]);
  assert.equal(new Set(GAZE_TARGETS.map((t) => t.id)).size, 9);
  for (const t of GAZE_TARGETS) {
    assert.ok(Math.abs(t.x) <= 1 && Math.abs(t.y) <= 1);
    assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y));
  }
  assert.equal([...GAZE_TARGETS.map((t) => t.x)].some((v) => v < 0), true);
  assert.equal([...GAZE_TARGETS.map((t) => t.y)].some((v) => v > 0), true);
});

test('median(): nieparzyste, parzyste i zepsute próbki', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([1, Number.NaN, 3, Infinity]), 2);
  assert.equal(median([]), 0);
  // Mediana wycina pojedyncze mrugnięcie, które zniszczyłoby średnią.
  assert.equal(median([0.2, 0.21, 0.19, 0.2, 7]), 0.2);
});

test('fitGazeMapping(): odtwarza przekształcenie afiniczne z 9 punktów', () => {
  const pairs: CalibrationPair[] = GAZE_TARGETS.map((target) => ({
    target, gaze: fakeGaze(target.x, target.y),
  }));
  const m = fitGazeMapping(pairs);
  assert.ok(m, 'dopasowanie nie może zostać odrzucone');
  assert.equal(m.points, 9);
  assert.ok(m.quality > 0.8, `jakość ${m.quality}`);
  assert.ok(m.residual < 0.15, `residual ${m.residual}`);
  for (const target of GAZE_TARGETS) {
    const raw = fakeGaze(target.x, target.y);
    const mapped = applyGazeMapping(m, raw.x, raw.y);
    assert.ok(Math.abs(mapped.x - target.x) < 0.2, `x dla ${target.id}: ${mapped.x}`);
    assert.ok(Math.abs(mapped.y - target.y) < 0.2, `y dla ${target.id}: ${mapped.y}`);
  }
  // Środek ekranu staje się zerem — bez zgadywania punktu neutralnego.
  const centre = fakeGaze(0, 0);
  const zero = applyGazeMapping(m, centre.x, centre.y);
  assert.ok(Math.abs(zero.x) < 0.15 && Math.abs(zero.y) < 0.15);
});

test('fitGazeMapping(): odrzuca za mało punktów i nieruchome oczy', () => {
  const pairs: CalibrationPair[] = GAZE_TARGETS.slice(0, MIN_CALIBRATION_POINTS - 1)
    .map((target) => ({ target, gaze: fakeGaze(target.x, target.y) }));
  assert.equal(fitGazeMapping(pairs), null);
  const frozen = GAZE_TARGETS.map((target) => ({ target, gaze: { x: 0.3, y: 0.2 } }));
  assert.equal(fitGazeMapping(frozen), null);
  assert.equal(fitGazeMapping([]), null);
});

test('fitGazeMapping(): odrzuca szum i zepsute próbki zamiast psuć sterowanie', () => {
  const noisy: CalibrationPair[] = GAZE_TARGETS.map((target, i) => ({
    target, gaze: { x: (i % 2 ? -1 : 1) * 1.4, y: (i % 3 ? 1 : -1) * 1.3 },
  }));
  assert.equal(fitGazeMapping(noisy), null);
  const broken: CalibrationPair[] = GAZE_TARGETS.map((target, i) => ({
    target, gaze: i === 0 ? { x: Number.NaN, y: 0 } : fakeGaze(target.x, target.y),
  }));
  const m = fitGazeMapping(broken);
  assert.ok(m, 'jedna zepsuta próbka nie może unieważnić całej kalibracji');
  assert.equal(m.points, 8);
});

test('applyGazeMapping(): brak mapowania i zepsuty odczyt są bezpieczne', () => {
  assert.deepEqual(applyGazeMapping(null, 0.3, -0.2), { x: 0.3, y: -0.2 });
  assert.deepEqual(applyGazeMapping(null, Number.NaN, 0.2), { x: 0, y: 0.2 });
  const m = parseGazeMapping({
    ax: 1, bx: 0, cx: 0, ay: 0, by: 1, cy: 0,
    quality: 1, residual: 0, points: 9,
  });
  assert.ok(m);
  assert.deepEqual(applyGazeMapping(m, 9, -9), { x: 1.6, y: -1.6 }, 'twardy clamp ±1.6');
});

test('parseGazeMapping(): przyjmuje tylko kompletny, skończony zapis', () => {
  const good = {
    ax: 0.2, bx: 0, cx: 0.1, ay: 0, by: 0.2, cy: -0.1,
    quality: 0.9, residual: 0.07, points: 9,
  };
  assert.deepEqual(parseGazeMapping(good), good);
  assert.equal(parseGazeMapping(null), null);
  assert.equal(parseGazeMapping({ ...good, ax: 'x' }), null);
  assert.equal(parseGazeMapping({ ...good, residual: Number.NaN }), null);
  assert.equal(parseGazeMapping({ ...good, points: 2 }), null);
  assert.equal(parseGazeMapping({ ...good, quality: 3 }), null);
});

test('GazeCalibrator(): przechodzi po 9 punktach i liczy postęp', () => {
  const c = new GazeCalibrator();
  assert.equal(c.total, 9);
  assert.equal(c.current?.id, 'center');
  assert.equal(c.progress, 0);
  assert.equal(c.capture({ x: Number.NaN, y: 0 }), false);
  for (const target of GAZE_TARGETS) {
    assert.equal(c.current?.id, target.id);
    const raw = fakeGaze(target.x, target.y);
    for (let k = 0; k < 5; k += 1) {
      // Jedna klatka z mrugnięciem nie może zepsuć mediany punktu.
      assert.equal(c.capture(k === 2 ? { x: raw.x + 0.6, y: raw.y } : raw), true);
    }
    assert.equal(c.sampleCount, 5);
    c.next();
  }
  assert.equal(c.current, null);
  assert.equal(c.progress, 1);
  const result = c.result();
  assert.equal(result.captured, 9);
  assert.ok(result.mapping, 'kreator musi zwrócić mapowanie po komplecie punktów');
  assert.ok(result.mapping.quality > 0.7);
  c.reset();
  assert.equal(c.current?.id, 'center');
  assert.equal(c.result().captured, 0);
});
