import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FrameWatchdog, clampFinite, disambiguateHandedness, finite,
  plausiblePoint, validLandmarks,
} from '../src/tracking-guard';
import { makeHand } from './fixtures';

test('finite(): wycina NaN, Infinity i tekst, zachowuje zero', () => {
  assert.equal(finite(0), 0);
  assert.equal(finite(-3.5), -3.5);
  assert.equal(finite(Number.NaN, 7), 7);
  assert.equal(finite(Infinity, 7), 7);
  assert.equal(finite('12' as unknown as number, 7), 7);
});

test('clampFinite(): nigdy nie zwraca wartości nieskończonej', () => {
  assert.equal(clampFinite(5, 0, 1), 1);
  assert.equal(clampFinite(-5, 0, 1), 0);
  assert.equal(clampFinite(Number.NaN, 0, 1, 0.5), 0.5);
  assert.equal(clampFinite(Infinity, 0, 1, 0.5), 0.5, 'fallback jest jawny i przewidywalny');
});

test('plausiblePoint(): odrzuca brak, NaN i skoki poza kadr', () => {
  assert.equal(plausiblePoint({ x: 0.5, y: 0.5, z: 0 }), true);
  assert.equal(plausiblePoint({ x: -0.1, y: 1.05, z: 0.3 }), true);
  assert.equal(plausiblePoint(undefined), false);
  assert.equal(plausiblePoint({ x: Number.NaN, y: 0, z: 0 }), false);
  assert.equal(plausiblePoint({ x: 50, y: 0, z: 0 }), false);
});

test('validLandmarks(): kompletna dłoń / twarz i nic poza tym', () => {
  const hand = makeHand().landmarks;
  assert.equal(validLandmarks(hand, 21, 64), true);
  assert.equal(validLandmarks(hand.slice(0, 20), 21, 64), false);
  assert.equal(validLandmarks(undefined, 21, 64), false);
  const poisoned = hand.map((p) => ({ ...p }));
  poisoned[7] = { x: Number.NaN, y: 0, z: 0 };
  assert.equal(validLandmarks(poisoned, 21, 64), false);
  assert.equal(validLandmarks(new Array(700).fill({ x: 0, y: 0, z: 0 }), 468, 600), false);
});

test('disambiguateHandedness(): dwie identyczne etykiety nie znikają', () => {
  const hands = [makeHand(0.72, 'Left'), makeHand(0.28, 'Left')];
  const fixed = disambiguateHandedness(hands);
  assert.equal(fixed.length, 2);
  assert.deepEqual(new Set(fixed.map((h) => h.label)), new Set(['Left', 'Right']));
  // Surowy kadr: dłoń bliżej lewej krawędzi dostaje etykietę Left.
  assert.equal(fixed.find((h) => h.landmarks[0].x === 0.28)?.label, 'Left');
});

test('disambiguateHandedness(): różne etykiety zostają nienaruszone', () => {
  const hands = [makeHand(0.72, 'Right'), makeHand(0.28, 'Left')];
  const fixed = disambiguateHandedness(hands);
  assert.equal(fixed[0].label, 'Right');
  assert.equal(fixed[1].label, 'Left');
});

test('disambiguateHandedness(): odrzuca zatrutą dłoń bez zgadywania', () => {
  const bad = makeHand(0.4, 'Left');
  bad.landmarks[3] = { x: Number.NaN, y: 0, z: 0 };
  assert.equal(disambiguateHandedness([bad, makeHand(0.6, 'Right')]).length, 1);
});

test('FrameWatchdog(): jedno zwolnienie, potem cisza aż do nowego odczytu', () => {
  const w = new FrameWatchdog(100);
  assert.equal(w.isStale(0), false);
  w.mark(1000);
  assert.equal(w.isStale(1050), false);
  assert.equal(w.isStale(1200), true);
  assert.equal(w.age(1200), 200);
  w.release();
  assert.equal(w.isStale(5000), false);
  w.mark(6000);
  assert.equal(w.isStale(6050), false);
  w.reset();
  assert.equal(w.hasFrame, false);
  assert.equal(w.age(9999), 0);
});

test('disambiguateHandedness(): nakładające się nadgarstki nie są zgadywane', () => {
  const hands = [makeHand(0.5, 'Left'), makeHand(0.505, 'Left')];
  const fixed = disambiguateHandedness(hands);
  assert.equal(fixed.length, 2);
  assert.ok(fixed.every((h) => h.label === 'Left'), 'bez pewnego podziału zostawiamy oryginał');
});
