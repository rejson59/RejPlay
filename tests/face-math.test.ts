import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BlinkCalibrator, EMPTY_FACE, emptyFace, faceFrameFromLandmarks,
} from '../src/face-math';
import { makeFace } from './fixtures';

test('EMPTY_FACE jest bezpiecznym, nieobecnym odczytem', () => {
  assert.equal(EMPTY_FACE.present, false);
  assert.equal(EMPTY_FACE.blink, 0);
  assert.equal(EMPTY_FACE.openness, 0);
  assert.deepEqual(EMPTY_FACE.landmarks, []);
  const copy = emptyFace();
  copy.yaw = 1;
  assert.equal(EMPTY_FACE.yaw, 0, 'kopiowanie nie może mutować wzorca');
});

test('faceFrameFromLandmarks(): odrzuca brak, skrócone i zatrute klatki', () => {
  assert.equal(faceFrameFromLandmarks(undefined).present, false);
  assert.equal(faceFrameFromLandmarks(makeFace(467)).present, false);
  assert.equal(faceFrameFromLandmarks(makeFace(700)).present, false);
  const poisoned = makeFace();
  poisoned[145] = { x: Number.NaN, y: 0, z: 0 };
  assert.equal(faceFrameFromLandmarks(poisoned).present, false);
});

test('faceFrameFromLandmarks(): każdy sygnał jest skończony i w skali', () => {
  const frame = faceFrameFromLandmarks(makeFace());
  assert.equal(frame.present, true);
  assert.equal(frame.iris, true, '478 punktów oznacza refineLandmarks');
  for (const key of ['yaw', 'pitch', 'roll', 'gazeX', 'gazeY', 'blink', 'openness'] as const) {
    assert.ok(Number.isFinite(frame[key]), `${key} musi być liczbą`);
  }
  assert.ok(Math.abs(frame.yaw) <= 1);
  assert.ok(Math.abs(frame.pitch) <= 1);
  assert.ok(Math.abs(frame.gazeX) <= 1.6);
  assert.ok(frame.blink >= 0 && frame.blink <= 1);
  assert.equal(frame.landmarks.length, 478);
});

test('faceFrameFromLandmarks(): bez źrenic nadal daje głowę i mrugnięcie', () => {
  const frame = faceFrameFromLandmarks(makeFace(468));
  assert.equal(frame.present, true);
  assert.equal(frame.iris, false);
  assert.equal(frame.gazeX, 0);
  assert.equal(frame.gazeY, 0);
  assert.ok(Number.isFinite(frame.pitch));
});

test('BlinkCalibrator(): adaptuje się do wąskich i szerokich oczu', () => {
  for (const open of [0.18, 0.32, 0.5]) {
    const cal = new BlinkCalibrator();
    let resting = 1;
    for (let i = 0; i < 20; i += 1) resting = cal.next(open).blink;
    assert.equal(resting, 0, `otwarte oko ${open} nie może być mrugnięciem`);
    assert.equal(cal.next(open * 0.05).blink, 1, `zamknięte oko ${open} musi być mrugnięciem`);
  }
});

test('BlinkCalibrator(): NaN nie zatruwa kalibracji', () => {
  const cal = new BlinkCalibrator();
  assert.ok(Number.isFinite(cal.next(Number.NaN).blink));
  assert.ok(Number.isFinite(cal.baseline));
  cal.reset();
  assert.equal(cal.baseline, 0.32);
});
