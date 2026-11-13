import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng, mulberry32, clamp, lerp, round2 } from '../src/core/random';
import { Store } from '../src/core/save';
import { GAMES } from '../src/core/types';

test('mulberry32 / Rng: ten sam seed daje ten sam ciąg', () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const seqA = Array.from({ length: 20 }, () => a());
  const seqB = Array.from({ length: 20 }, () => b());
  const seqC = Array.from({ length: 20 }, () => c());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
});

test('Rng: pick, shuffle i int nie wychodzą poza zakres', () => {
  const r = new Rng(7);
  const items = ['a', 'b', 'c', 'd', 'e'];
  for (let i = 0; i < 50; i += 1) {
    assert.ok(items.includes(r.pick(items)));
    const n = r.int(2, 5);
    assert.ok(n >= 2 && n <= 5);
  }
  const shuffled = r.shuffle(items);
  assert.deepEqual(shuffled.slice().sort(), items.slice().sort());
});

test('funkcje matematyczne są odporne na skrajności', () => {
  assert.equal(clamp(12, 0, 10), 10);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(lerp(0, 10, 0.25), 2.5);
  assert.equal(round2(1.23456), 1.23);
  assert.ok(Number.isFinite(round2(0.1 + 0.2)));
});

test('Store: zapis, najlepszy wynik i licznik partii', () => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { data.set(k, v); },
    },
  });
  try {
    const s = new Store();
    assert.equal(s.get('brak', 5), 5);
    assert.equal(s.best('centrala'), null);
    s.record('centrala', { won: false, score: 20, summary: 'a' });
    s.record('centrala', { won: true, score: 90, summary: 'b' });
    s.record('centrala', { won: false, score: 30, summary: 'c' });
    assert.equal(s.best('centrala')?.score, 90, 'słabsza partia nie nadpisuje rekordu');
    assert.equal(s.plays('centrala'), 3);
    assert.equal(s.get<number>('plays:pasozyt', 0) === 0, true, 'gry mają osobne liczniki');
  } finally {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('GAMES: dokładnie cztery kompletne, unikalne pozycje', () => {
  assert.equal(GAMES.length, 4);
  assert.equal(new Set(GAMES.map((g) => g.id)).size, 4);
  for (const g of GAMES) {
    assert.ok(g.title.length > 2);
    assert.ok(g.subtitle.length > 5);
    assert.ok(g.hook.length > 20);
    assert.equal(g.features.length, 4);
    assert.match(g.accent, /^#[0-9a-f]{6}$/i);
  }
});
