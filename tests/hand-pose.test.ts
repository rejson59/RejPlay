import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HandAnimator, computeHandPose, neutralHandPose, neutralHandPosePair,
  posesFromHands, recaptureWristNeutral, resetWristCalibration,
} from '../src/hand-pose';
import { makeHand } from './fixtures';

function assertFinitePose(pose: ReturnType<typeof computeHandPose>): void {
  for (const row of pose.curl) for (const value of row) assert.ok(Number.isFinite(value));
  for (const value of pose.spread) assert.ok(Number.isFinite(value));
  for (const key of ['roll', 'pitch', 'yaw', 'presence'] as const) {
    assert.ok(Number.isFinite(pose[key]), `${key} musi być liczbą`);
  }
  for (const value of Object.values(pose.wrist)) assert.ok(Number.isFinite(value));
}

test('computeHandPose(): 21 punktów daje kompletną, skończoną pozę', () => {
  const pose = computeHandPose(makeHand(), 4 / 3, 1000);
  assert.equal(pose.present, true);
  assert.equal(pose.curl.length, 5);
  assert.equal(pose.curl[0].length, 3);
  assert.equal(pose.presence, 1);
  assertFinitePose(pose);
});

test('computeHandPose(): zatruta klatka wraca do pozycji neutralnej', () => {
  const bad = makeHand();
  bad.landmarks[8] = { x: Number.NaN, y: 0, z: 0 };
  const pose = computeHandPose(bad, 4 / 3, 1000);
  assert.equal(pose.present, false);
  assert.equal(pose.presence, 0);
  assertFinitePose(pose);
  assert.equal(computeHandPose(makeHand(), Number.NaN, 1000).present, false);
});

test('posesFromHands(): obie dłonie trafiają na różne boki awatara', () => {
  const pair = posesFromHands([makeHand(0.28, 'Left'), makeHand(0.72, 'Right')]);
  assert.equal(pair.L.present, true);
  assert.equal(pair.R.present, true);
});

test('posesFromHands(): duplikat etykiety nie kasuje jednej dłoni', () => {
  // Historyczny błąd: obie mapowały się na bok R i druga nadpisywała pierwszą.
  const pair = posesFromHands([makeHand(0.28, 'Left'), makeHand(0.72, 'Left')]);
  assert.equal(pair.L.present, true);
  assert.equal(pair.R.present, true);
});

test('posesFromHands(): zatruta dłoń nie psuje zdrowej', () => {
  const bad = makeHand(0.28, 'Left');
  bad.landmarks[4] = { x: Infinity, y: 0, z: 0 };
  const pair = posesFromHands([bad, makeHand(0.72, 'Right')]);
  assert.equal(pair.L.present, true);
  assert.equal(pair.R.present, false);
  assert.equal(posesFromHands([]).L.present, false);
});

test('wristTwist(): ciągły w czasie, bez skoku po przerwie w śledzeniu', () => {
  resetWristCalibration();
  const hand = makeHand(0.5, 'Left');
  const first = computeHandPose(hand, 4 / 3, 1000).roll;
  assert.equal(first, 0, 'pierwsza klatka kalibruje zero');
  const next = computeHandPose(hand, 4 / 3, 1030).roll;
  assert.ok(Number.isFinite(next));
  // Dłuższa przerwa = nowa sesja, a nie dokładanie zawiniętego kąta ±π.
  const rotated = makeHand(0.5, 'Left');
  rotated.landmarks[5] = { x: 0.8, y: 0.3, z: 0.2 };
  const afterGap = computeHandPose(rotated, 4 / 3, 5000).roll;
  assert.equal(afterGap, 0);
  recaptureWristNeutral();
  assert.equal(computeHandPose(hand, 4 / 3, 5020).roll, 0);
});

test('HandAnimator(): NaN w jednej klatce nie psuje sprężyny na zawsze', () => {
  const animator = new HandAnimator();
  const good = computeHandPose(makeHand(), 4 / 3, 1000);
  assertFinitePose(animator.step(good, 1 / 60));
  const poisoned = neutralHandPose();
  poisoned.present = true;
  poisoned.curl[2][1] = Number.NaN;
  poisoned.wrist.x = Number.NaN;
  const during = animator.step(poisoned, 1 / 60);
  assertFinitePose(during);
  const after = animator.step(good, 1 / 60);
  assertFinitePose(after);
  assert.ok(Number.isFinite(animator.pose.wrist.x));
  // Zły dt też nie może rozjechać integratora.
  assertFinitePose(animator.step(good, Number.NaN));
});

test('neutralHandPosePair(): dwa niezależne, nieobecne obiekty', () => {
  const pair = neutralHandPosePair();
  assert.equal(pair.L.present, false);
  assert.equal(pair.R.present, false);
  pair.L.curl[0][0] = 1;
  assert.equal(pair.R.curl[0][0], 0);
});
