import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraControl } from '../src/camera-control';
import { emptyFace } from '../src/face-math';
import { makeFaceFrame, makeHand } from './fixtures';

function assertFiniteControl(control: Record<string, number>): void {
  for (const [key, value] of Object.entries(control)) {
    assert.ok(Number.isFinite(value), `${key} nie może być NaN/Infinity`);
  }
}

test('utrata twarzy NIE powoduje samoczynnej jazdy kamery', () => {
  // Historyczny błąd: emptyFace() ma zera, a odjęcie od nich neutralnej
  // kalibracji dawało stały, niezerowy wektor ruchu. Postać jechała sama.
  const c = new CameraControl();
  c.settings.enabled = true;
  c.neutral = { yaw: 0.3, pitch: 0.45, roll: -0.3, gazeX: 0.5, gazeY: -0.4 };
  const face = makeFaceFrame({ pitch: 0.75, gazeX: 0.8, gazeY: -0.1 });
  let control = c.ingest(face, [], 1 / 30).control;
  for (let i = 0; i < 40; i += 1) control = c.ingest(face, [], 1 / 30).control;
  assert.ok(Math.abs(control.moveY) > 0.05, 'przy obecnej twarzy ruch musi działać');

  for (let i = 0; i < 150; i += 1) control = c.ingest(emptyFace(), [], 1 / 30).control;
  assertFiniteControl(control);
  assert.ok(Math.abs(control.moveY) < 0.01, `po zniknięciu twarzy ruch musi wygasnąć, jest ${control.moveY}`);
  assert.ok(Math.abs(control.lookX) < 1, `kamera nie może dalej się obracać, jest ${control.lookX}`);
});

test('zatrute sygnały twarzy, dłoni i dt nie zatruwają sterowania', () => {
  const c = new CameraControl();
  c.settings.enabled = true;
  const bad = makeFaceFrame({ gazeX: Number.NaN, pitch: Infinity });
  const control = c.ingest(bad, [], 1 / 30).control;
  assertFiniteControl(control);
  const hand = makeHand();
  hand.landmarks[9] = { x: Number.NaN, y: 0, z: 0 };
  assertFiniteControl(c.ingest(bad, [hand], Number.NaN).control);
  const after = c.ingest(makeFaceFrame(), [makeHand()], 1 / 30).control;
  assertFiniteControl(after);
});

test('uszkodzone ustawienia z localStorage nie psują integratora', () => {
  const c = new CameraControl();
  c.settings.enabled = true;
  c.settings.smoothing = Number.NaN;
  c.settings.deadzone = Number.NaN;
  c.settings.gazeSensitivity = Infinity;
  const control = c.ingest(makeFaceFrame(), [], 1 / 30).control;
  assertFiniteControl(control);
});

test('loadSettings(): zepsuty JSON lub NaN w zapisie daje domyślne wartości', () => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    },
  });
  try {
    store.set('rejplay:camera-control-v1', '{niepoprawne');
    const broken = new CameraControl();
    assert.equal(broken.settings.deadzone, 0.07);
    assert.equal(broken.settings.smoothing, 0.55);
    store.set('rejplay:camera-control-v1', JSON.stringify({
      smoothing: null, deadzone: 'oops', gazeSensitivity: null, headSensitivity: null,
    }));
    const weird = new CameraControl();
    for (const value of Object.values(weird.settings)) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value));
    }
    assert.equal(weird.settings.deadzone, 0.07);
    assert.equal(weird.settings.smoothing, 0.55);
  } finally {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('gesty chwytu wymagają włączonego sterowania', () => {
  const c = new CameraControl();
  c.settings.enabled = false;
  const out = c.ingest(makeFaceFrame(), [makeHand()], 1 / 30);
  assert.equal(out.control.lookX, 0);
  assert.equal(out.gestures.some((g) => g.type === 'grab'), false);
  c.settings.enabled = true;
  const enabled = c.ingest(makeFaceFrame(), [], 1 / 30);
  assertFiniteControl(enabled.control);
});

test('diagnostyka laboratorium zawsze zawiera skończone liczby', () => {
  const c = new CameraControl();
  c.ingest(makeFaceFrame({ gazeX: Number.NaN }), [makeHand()], 1 / 30);
  const d = c.diagnostics();
  assert.ok(Number.isFinite(d.ranges.pitch));
  assert.ok(Number.isFinite(d.ranges.gazeX));
  assert.ok(Number.isFinite(d.left.curl));
  assert.ok(Number.isFinite(d.right.pinch));
});
