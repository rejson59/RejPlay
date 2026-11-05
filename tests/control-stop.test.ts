/**
 * Regresje v0.9: sterowanie bez klawiatury musi mieć pewny stan ZERO.
 * Dawniej `enabled`/`neutral` persystowały w localStorage, kamerka startowała
 * sama, a zniknięcie twarzy zostawiało rozpędzony wektor ruchu.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraControl } from '../src/camera-control';
import { EMPTY_FACE } from '../src/face-math';
import { makeFaceFrame } from './fixtures';

function withStorage<T>(seed: Record<string, string>, fn: (store: Map<string, string>) => T): T {
  const store = new Map(Object.entries(seed));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    },
  });
  try {
    return fn(store);
  } finally {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

const STALE = 'rejplay:camera-control-v1';

test('start sesji nigdy nie wczytuje włączonego sterowania ani starego neutralu', () => {
  withStorage({
    [STALE]: JSON.stringify({
      enabled: true, smoothing: 0.5,
      neutral: { yaw: 0.2, pitch: 0.9, roll: 0, gazeX: 0.3, gazeY: 0.2 },
    }),
  }, () => {
    const c = new CameraControl();
    assert.equal(c.settings.enabled, false, 'po reloadzie sterowanie jest wyłączone');
    assert.equal(c.neutral, null, 'stary schemat neutralu jest ignorowany');
    const out = c.ingest(makeFaceFrame(), [], 1 / 60);
    assert.deepEqual(
      [out.control.moveX, out.control.moveY, out.control.lookX, out.control.lookY],
      [0, 0, 0, 0],
    );
  });

  withStorage({
    [STALE]: JSON.stringify({
      schema: 2, enabled: true, gazeSensitivity: 1, headSensitivity: 1,
      deadzone: 0.07, smoothing: 0.55, invertX: false,
    }),
  }, () => {
    const c = new CameraControl();
    assert.equal(c.settings.enabled, false, 'nawet schemat 2 nie zapamiętuje enabled');
    assert.equal(c.settings.deadzone, 0.07);
  });
});

test('save(): nie zapisuje enabled do localStorage', () => {
  withStorage({}, (store) => {
    const c = new CameraControl();
    c.settings.enabled = true;
    c.save();
    const raw = JSON.parse(store.get(STALE) ?? 'null');
    assert.equal(raw.schema, 2);
    assert.equal('enabled' in raw, false);
    assert.equal(new CameraControl().settings.enabled, false);
  });
});

test('wyłączone sterowanie: pełne zero mimo wychylonej głowy i oczu', () => {
  const c = new CameraControl();
  c.settings.enabled = false;
  c.neutral = { yaw: 0, pitch: 0, roll: 0, gazeX: 0, gazeY: 0 };
  for (let i = 0; i < 30; i += 1) {
    const out = c.ingest(makeFaceFrame(), [], 1 / 60);
    assert.equal(out.control.moveY, 0);
    assert.equal(out.control.lookX, 0);
  }
});

test('brak twarzy = natychmiastowy stop, bez wygaszania rozpędzonej postaci', () => {
  const c = new CameraControl();
  c.settings.enabled = true;
  c.neutral = { yaw: 0, pitch: 0, roll: 0, gazeX: 0, gazeY: 0 };
  let driven = 0;
  for (let i = 0; i < 40; i += 1) driven = c.ingest(makeFaceFrame(), [], 1 / 60).control.moveY;
  assert.ok(driven > 0.1, 'najpierw postać naprawdę idzie');
  const stopped = c.ingest(EMPTY_FACE, [], 1 / 60).control;
  assert.equal(stopped.moveY, 0, 'tej samej klatki musi być zero');
  assert.equal(stopped.moveX, 0);
  assert.equal(stopped.lookX, 0);
  assert.equal(stopped.lookY, 0);
});

test('stop(): wyłącza, zeruje i wycentrowuje na bieżący odczyt', () => {
  withStorage({}, () => {
    const c = new CameraControl();
    c.settings.enabled = true;
    // Celowo stary punkt neutralny: postać jest rozpędzona, STOP ma ją
    // zatrzymać i przestawić zero na aktualny odczyt twarzy.
    c.neutral = { yaw: 0.2, pitch: 0, roll: -0.1, gazeX: 0.4, gazeY: 0.2 };
    const face = makeFaceFrame({ pitch: 0.42, gazeX: 0.55 });
    for (let i = 0; i < 20; i += 1) c.ingest(face, [], 1 / 60);
    assert.ok(c.ingest(face, [], 1 / 60).control.moveY !== 0);
    c.stop();
    assert.equal(c.settings.enabled, false);
    assert.ok(c.neutral, 'stop ustawia nowy punkt neutralny');
    assert.ok(Math.abs(c.neutral.pitch - 0.42) < 1e-9);
    assert.ok(Math.abs(c.neutral.gazeX - 0.55) < 1e-9);
    const after = c.ingest(face, [], 1 / 60).control;
    assert.deepEqual([after.moveX, after.moveY, after.lookX, after.lookY], [0, 0, 0, 0]);
  });
});

test('adaptacyjna kompensacja dryfu: stary neutral nie może wozić gracza w kółko', () => {
  const c = new CameraControl();
  c.settings.enabled = true;
  const face = makeFaceFrame({ pitch: 0.3, gazeX: 0.4 });
  // Mały błąd kalibracji z poprzedniej sesji: dawniej dawał stały wektor ruchu.
  c.neutral = { yaw: 0.2, pitch: 0.22, roll: -0.1, gazeX: 0.42, gazeY: 0.2 };
  let early = 0;
  for (let i = 0; i < 5; i += 1) early = c.ingest(face, [], 1 / 60).control.moveY;
  assert.ok(Math.abs(early) > 0.01);
  for (let i = 0; i < 180; i += 1) c.ingest(face, [], 1 / 60);
  const late = c.ingest(face, [], 1 / 60).control.moveY;
  assert.ok(Math.abs(late) < 0.05, `dryf nie wygasł: ${late}`);
});

test('pierwsza klatka twarzy = zero, więc sterowanie nie rusza samo', () => {
  const c = new CameraControl();
  c.settings.enabled = true;
  assert.equal(c.neutral, null, 'na starcie nie ma punktu neutralnego');
  // Zwykła, wyprostowana głowa ma niezerowy surowy pitch — dawniej dawało to
  // stały wektor ruchu w jedną stronę od pierwszej klatki.
  const face = makeFaceFrame({ pitch: 0.3, yaw: 0.2, gazeX: 0.4 });
  let value = 0;
  for (let i = 0; i < 60; i += 1) value = c.ingest(face, [], 1 / 60).control.moveY;
  assert.ok(c.neutral, 'pierwsza klatka wyznacza zero');
  assert.equal(Math.abs(value) < 0.02, true, `postać ruszyła sama: ${value}`);
  const off = c.ingest(EMPTY_FACE, [], 1 / 60).control;
  assert.deepEqual([off.moveX, off.moveY, off.lookX, off.lookY], [0, 0, 0, 0]);
});

test('świadomy przechył głowy NIE jest wygaszany — dalej można chodzić', () => {
  const c = new CameraControl();
  c.settings.enabled = true;
  c.neutral = { yaw: 0.2, pitch: 0, roll: -0.1, gazeX: 0.4, gazeY: 0.2 };
  const face = makeFaceFrame({ pitch: 0.3 });
  let value = 0;
  for (let i = 0; i < 180; i += 1) value = c.ingest(face, [], 1 / 60).control.moveY;
  assert.ok(value > 0.4, `chodzenie głową zostało stłumione: ${value}`);
});

test('invertHeadMove(): odwraca tylko kierunek chodzenia', () => {
  const face = makeFaceFrame({ pitch: 0.3 });
  const forward = new CameraControl();
  forward.settings.enabled = true;
  forward.neutral = { yaw: 0.2, pitch: 0, roll: -0.1, gazeX: 0.4, gazeY: 0.2 };
  let a = 0;
  for (let i = 0; i < 40; i += 1) a = forward.ingest(face, [], 1 / 60).control.moveY;
  const back = new CameraControl();
  back.settings.enabled = true;
  back.settings.invertHeadMove = true;
  back.neutral = { yaw: 0.2, pitch: 0, roll: -0.1, gazeX: 0.4, gazeY: 0.2 };
  let b = 0;
  for (let i = 0; i < 40; i += 1) b = back.ingest(face, [], 1 / 60).control.moveY;
  assert.ok(a > 0.4 && b < -0.4);
  assert.ok(Math.abs(a + b) < 1e-6);
});

test('mapowanie spojrzenia: centrowanie ekranu i diagnostyka laboratorium', () => {
  const raw = new CameraControl();
  raw.settings.enabled = true;
  raw.neutral = { yaw: 0.2, pitch: 0.3, roll: -0.1, gazeX: 0, gazeY: 0 };
  const mapped = new CameraControl();
  mapped.settings.enabled = true;
  mapped.neutral = { yaw: 0.2, pitch: 0.3, roll: -0.1, gazeX: 0, gazeY: 0 };
  mapped.setGazeMapping({
    ax: 1, bx: 0, cx: -0.4, ay: 0, by: 1, cy: -0.2,
    quality: 0.95, residual: 0.03, points: 9,
  });
  assert.equal(mapped.diagnostics().gazeCalibrated, true);
  assert.equal(mapped.diagnostics().gazeQuality, 0.95);
  assert.equal(raw.diagnostics().gazeCalibrated, false);
  const face = makeFaceFrame({ gazeX: 0.4, gazeY: 0.2 });
  let a = 0; let b = 0;
  for (let i = 0; i < 30; i += 1) {
    a = raw.ingest(face, [], 1 / 60).control.lookX;
    b = mapped.ingest(face, [], 1 / 60).control.lookX;
  }
  assert.ok(Math.abs(b) < Math.abs(a), 'po kalibracji „patrzę prosto" = brak obrotu kamery');
});
