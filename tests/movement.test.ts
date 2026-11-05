import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GAME_SPAWN, PLAYER_RADIUS, WALL_SEGMENTS, YARD_OBSTACLES,
  createCollision, depenetrate, freeSpawn, pathClear, wallRects,
} from '../src/movement';

const isBlocked = createCollision();

test('createCollision(): punkt startu rundy jest wolny (regresja v0.8)', () => {
  assert.equal(isBlocked(GAME_SPAWN.x, GAME_SPAWN.z), false,
    'gracz nie może rodzić się wewnątrz collidera blatu monitoringu');
  assert.deepEqual([GAME_SPAWN.yaw, GAME_SPAWN.pitch], [0, 0],
    'kamera startuje w tym samym kierunku, w którym celuje yawTarget');
  const spawn = freeSpawn(isBlocked);
  assert.equal(spawn.adjusted, false);
  assert.deepEqual([spawn.x, spawn.y, spawn.z], [GAME_SPAWN.x, GAME_SPAWN.y, GAME_SPAWN.z]);
});

test('createCollision(): stary błędny start (0, 12.4) był zablokowany', () => {
  assert.equal(isBlocked(0, 12.4), true);
  const desk = YARD_OBSTACLES[1];
  assert.ok(0 > desk.minX - PLAYER_RADIUS && 0 < desk.maxX + PLAYER_RADIUS);
  assert.ok(12.4 > desk.minZ - PLAYER_RADIUS && 12.4 < desk.maxZ + PLAYER_RADIUS);
});

test('createCollision(): cała droga od samochodu do frontowych drzwi jest przechodnia', () => {
  // Oś korytarza: od startu, przez próg drzwi (z = 9), do wnętrza domu.
  assert.equal(pathClear(isBlocked, GAME_SPAWN.x, GAME_SPAWN.z, 0, 8.4, 64), true);
  for (let z = GAME_SPAWN.z; z >= 8.4; z -= 0.1) {
    assert.equal(isBlocked(0, z), false, `korytarz zablokowany na z=${z.toFixed(2)}`);
  }
});

test('createCollision(): ściany, samochód i blat nadal blokują', () => {
  assert.equal(isBlocked(0, -9), true, 'tylna ściana');
  assert.equal(isBlocked(-2.5, 9), true, 'fragment frontowej ściany');
  assert.equal(isBlocked(2.6, 14), true, 'samochód-baza');
  assert.equal(isBlocked(1.0, 13.0), true, 'blat monitoringu');
  assert.equal(isBlocked(9, 0), true, 'granica pokoju');
  assert.equal(isBlocked(0, 18), true, 'koniec podwórka');
});

test('createCollision(): zepsute współrzędne są traktowane jako przeszkoda', () => {
  assert.equal(isBlocked(Number.NaN, 0), true);
  assert.equal(isBlocked(0, Infinity), true);
});

test('wallRects(): 13 segmentów, margines 0.08, bez mutacji wejścia', () => {
  const rects = wallRects();
  assert.equal(rects.length, WALL_SEGMENTS.length);
  assert.equal(rects.length, 13);
  assert.deepEqual(rects[0], { minX: -9.08, maxX: 9.08, minZ: -9.08, maxZ: -8.92 });
  assert.deepEqual(WALL_SEGMENTS[0], [-9, -9, 9, -9]);
});

test('freeSpawn(): cofa start, gdy pierwszy kandydat jest zasłonięty', () => {
  const narrow = createCollision(wallRects(), PLAYER_RADIUS);
  const blockedFirst: typeof narrow = (x, z) => (x === 0 && z < 11.8) || narrow(x, z);
  const spawn = freeSpawn(blockedFirst);
  assert.equal(spawn.adjusted, true);
  assert.equal(blockedFirst(spawn.x, spawn.z), false);
});

test('freeSpawn(): punkt awaryjny jest wolny przy standardowych ścianach', () => {
  const impossible: typeof isBlocked = (x, z) => (z > 8.7 && z < 12) || isBlocked(x, z);
  const spawn = freeSpawn(impossible);
  // Gdy nawet awaryjny punkt jest zasłonięty, funkcja i tak zwraca skończony,
  // zdeterminowany punkt zamiast rzucać wyjątkiem lub zwracać NaN.
  assert.ok(Number.isFinite(spawn.x) && Number.isFinite(spawn.z));
  assert.equal(spawn.adjusted, true);
});

test('depenetrate(): wypycha gracza z collidera na wolny korytarz', () => {
  const freed = depenetrate(isBlocked, 0, 12.4);
  assert.equal(freed.moved, true);
  assert.equal(isBlocked(freed.x, freed.z), false);
});

test('depenetrate(): nie rusza gracza stojącego w wolnym miejscu', () => {
  assert.deepEqual(depenetrate(isBlocked, GAME_SPAWN.x, GAME_SPAWN.z), {
    x: GAME_SPAWN.x, z: GAME_SPAWN.z, moved: false,
  });
});

test('pathClear(): wykrywa ścianę na trasie', () => {
  assert.equal(pathClear(isBlocked, 0, 8.4, -2.5, 9), false);
  assert.equal(pathClear(isBlocked, GAME_SPAWN.x, GAME_SPAWN.z, 0, 10.2), true);
});
