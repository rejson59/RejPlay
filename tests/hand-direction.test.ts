import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeHandPose, estimateHandInversions, getHandAxes,
  posesFromHands, setHandAxes,
} from '../src/hand-pose';
import { makeHand } from './fixtures';

test('estimateHandInversions(): wykrywa odwróconą oś dłoni', () => {
  assert.deepEqual(estimateHandInversions([
    { axis: 'x', expected: 1, observed: 0.4 },
    { axis: 'z', expected: 1, observed: 0.5 },
  ]), { invertX: false, invertY: false, invertDepth: false });

  assert.deepEqual(estimateHandInversions([
    { axis: 'x', expected: 1, observed: -0.5 },
    { axis: 'y', expected: 1, observed: -0.4 },
    { axis: 'z', expected: 1, observed: -0.6 },
  ]), { invertX: true, invertY: true, invertDepth: true },
  'dłoń „chodząca do tyłu" musi zostać wykryta i odwrócona');
});

test('estimateHandInversions(): szum i sprzeczne próbki nie przewracają sterowania', () => {
  assert.deepEqual(estimateHandInversions([
    { axis: 'z', expected: 1, observed: 0.01 },
    { axis: 'z', expected: 1, observed: Number.NaN },
  ]), { invertX: false, invertY: false, invertDepth: false });
  assert.deepEqual(estimateHandInversions([
    { axis: 'z', expected: 1, observed: 0.5 },
    { axis: 'z', expected: 1, observed: -0.5 },
  ]), { invertX: false, invertY: false, invertDepth: false });
});

test('setHandAxes(): zmienia znak pozycji nadgarstka bez utraty innych osi', () => {
  try {
    setHandAxes({ invertX: false, invertY: false, invertDepth: false });
    const base = computeHandPose(makeHand(0.3));
    assert.ok(base.wrist.x > 0.2, 'dłoń po lewej stronie kadru = +x');
    const beforeY = base.wrist.y;
    const beforeZ = base.wrist.z;

    setHandAxes({ invertX: true });
    assert.equal(getHandAxes().invertX, true);
    const flipped = computeHandPose(makeHand(0.3));
    assert.ok(flipped.wrist.x < -0.2);
    assert.equal(flipped.wrist.y, beforeY);
    assert.equal(flipped.wrist.z, beforeZ);

    setHandAxes({ invertDepth: true });
    const depth = computeHandPose(makeHand(0.3));
    assert.equal(depth.wrist.z, -beforeZ);
  } finally {
    setHandAxes({ invertX: false, invertY: false, invertDepth: false });
  }
});

test('posesFromHands(): odwrócona oś X działa też dla zamienionych stron', () => {
  try {
    setHandAxes({ invertX: true, invertY: false, invertDepth: false });
    const pair = posesFromHands([makeHand(0.25, 'Left')]);
    assert.equal(pair.L.present, false);
    assert.equal(pair.R.present, true);
    assert.ok(pair.R.wrist.x < -0.2, 'prawa dłoń awatara również się odwraca');
  } finally {
    setHandAxes({ invertX: false, invertY: false, invertDepth: false });
  }
});
