import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FINGER_CASCADE, HandAnimator, JOINT_MAX, JOINT_MIN, JOINT_SMOOTH_TIME,
  applyTenodesis, computeHandPose, neutralHandPose,
} from '../src/hand-pose';
import { makeHand } from './fixtures';

function curlPose(value: number): ReturnType<typeof neutralHandPose> {
  const pose = neutralHandPose();
  pose.present = true;
  for (let f = 0; f < 5; f += 1) for (let j = 0; j < 3; j += 1) pose.curl[f][j] = value;
  return pose;
}

test('anatomiczne minima: tylko MCP może się lekko wyprostować', () => {
  assert.ok(JOINT_MIN[0] < 0);
  assert.ok(JOINT_MIN[1] < 0);
  assert.equal(JOINT_MIN[2], 0, 'DIP nie prostuje się poniżej zera');
  assert.ok(JOINT_MIN.every((min, j) => min < JOINT_MAX[j]));
  assert.ok(JOINT_SMOOTH_TIME.every((t, i) => i === 0 || t > JOINT_SMOOTH_TIME[i - 1]),
    'MCP prowadzi, ogniwa doganiają');
  assert.ok(FINGER_CASCADE.every((t, i) => i === 0 || t > FINGER_CASCADE[i - 1]),
    'wskazujący wyprzedza mały palec');
});

test('applyTenodesis(): wyprost nadgarstka zgina palce, zgięcie prostuje', () => {
  const flat = curlPose(0.5);
  flat.pitch = 0.8;
  applyTenodesis(flat);
  const extended = flat.curl[2][0];

  const flexed = curlPose(0.5);
  flexed.pitch = -0.8;
  applyTenodesis(flexed);
  const flexedCurl = flexed.curl[2][0];

  assert.ok(extended > 0.5, `wyprost powinien zginać (${extended})`);
  assert.ok(flexedCurl < 0.5, `zgięcie powinno prostować (${flexedCurl})`);
  assert.ok(extended - 0.5 <= 0.09 + 1e-9);
});

test('applyTenodesis(): nigdy nie wychodzi poza limity i nie psuje NaN', () => {
  const pose = curlPose(1.55);
  pose.pitch = 1.1;
  applyTenodesis(pose);
  for (let f = 0; f < 5; f += 1) {
    for (let j = 0; j < 3; j += 1) {
      assert.ok(pose.curl[f][j] >= JOINT_MIN[j]);
      assert.ok(pose.curl[f][j] <= JOINT_MAX[j]);
    }
  }
  const poisoned = curlPose(0.4);
  poisoned.pitch = Number.NaN;
  applyTenodesis(poisoned);
  assert.equal(poisoned.curl[2][0], 0.4, 'NaN pitch nie może zmienić pozy');
});

test('computeHandPose(): stawy międzypaliczkowe nie wywijają się na lewą stronę', () => {
  const pose = computeHandPose(makeHand(), 4 / 3, 1000);
  for (let f = 0; f < 5; f += 1) {
    for (let j = 0; j < 3; j += 1) {
      assert.ok(Number.isFinite(pose.curl[f][j]));
      assert.ok(pose.curl[f][j] >= JOINT_MIN[j] - 1e-6, `palec ${f} staw ${j}`);
      assert.ok(pose.curl[f][j] <= JOINT_MAX[j] + 1e-6);
    }
  }
});

test('HandAnimator(): kaskada czasowa — MCP prowadzi, DIP i mały palec doganiają', () => {
  const animator = new HandAnimator();
  animator.step(neutralHandPose(), 1 / 60);
  const out = animator.step(curlPose(1), 1 / 60);
  assert.ok(out.curl[2][0] > out.curl[2][1], 'MCP szybciej niż PIP');
  assert.ok(out.curl[2][1] > out.curl[2][2], 'PIP szybciej niż DIP');
  assert.ok(out.curl[1][0] > out.curl[4][0], 'wskazujący szybciej niż mały palec');
  for (let f = 0; f < 5; f += 1) {
    for (let j = 0; j < 3; j += 1) {
      assert.ok(out.curl[f][j] >= JOINT_MIN[j] - 0.02 - 1e-6);
      assert.ok(out.curl[f][j] <= JOINT_MAX[j]);
    }
  }
});

test('HandAnimator(): kaskada domyka się do celu (brak trwałego opóźnienia)', () => {
  const animator = new HandAnimator();
  const target = curlPose(0.9);
  let out = animator.step(target, 1 / 60);
  for (let i = 0; i < 120; i += 1) out = animator.step(target, 1 / 60);
  for (let f = 0; f < 5; f += 1) {
    for (let j = 0; j < 3; j += 1) {
      assert.ok(Math.abs(out.curl[f][j] - 0.9) < 0.01, `palec ${f} staw ${j}: ${out.curl[f][j]}`);
    }
  }
});
