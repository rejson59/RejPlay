/** Regresje ruchu v0.9: „deska na spawnie" i wpadanie w rekwizyty. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRONT_DOOR, GAME_SPAWN, PLAYER_RADIUS, YARD_OBSTACLES,
  combineMovement, createCollision, depenetrate, freeSpawn, pathClear,
} from '../src/movement';

const isBlocked = createCollision();

test('combineMovement(): W wygrywa z zatrutym kanałem głowy (regresja deski)', () => {
  // W = +1, kamerka trzyma −1. Dawna suma dawała 0 i gracz stał przy desce.
  assert.deepEqual(combineMovement(0, 1, 0, -1), { x: 0, y: 1 });
  assert.deepEqual(combineMovement(1, 0, -1, 0), { x: 1, y: 0 });
  // Bez świadomego ruchu ster przejmuje kamerka…
  assert.deepEqual(combineMovement(0, 0, 0.2, -0.5), { x: 0.2, y: -0.5 });
  // …a gdy oba kanały są zerowe, postać stoi.
  assert.deepEqual(combineMovement(0, 0, 0, 0), { x: 0, y: 0 });
});

test('combineMovement(): normalizuje przekątną i odrzuca zepsute dane', () => {
  const v = combineMovement(1, 1, 0, 0);
  assert.ok(Math.abs(Math.hypot(v.x, v.y) - 1) < 1e-9);
  assert.deepEqual(combineMovement(0, 0, Number.NaN, Infinity), { x: 0, y: 0 });
  assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y));
});

test('korytarz od spawnu do drzwi jest wolny na całej szerokości kapsuły', () => {
  assert.equal(isBlocked(GAME_SPAWN.x, GAME_SPAWN.z), false);
  for (let z = GAME_SPAWN.z; z >= FRONT_DOOR.z; z -= 0.05) {
    for (const x of [-PLAYER_RADIUS, 0, PLAYER_RADIUS]) {
      assert.equal(isBlocked(x, z), false, `zablokowano (${x}, ${z.toFixed(2)})`);
    }
  }
  assert.equal(pathClear(isBlocked, GAME_SPAWN.x, GAME_SPAWN.z, 0, 8.4, 96), true);
});

test('collidery rekwizytów istnieją, ale nie zachodzą na oś korytarza', () => {
  assert.ok(YARD_OBSTACLES.length >= 11);
  for (const rect of YARD_OBSTACLES) {
    assert.ok(rect.minX < rect.maxX && rect.minZ < rect.maxZ);
    const overlapsAxis = rect.minX - PLAYER_RADIUS < 0 && rect.maxX + PLAYER_RADIUS > 0;
    if (overlapsAxis) {
      // Wyjątek: blat monitoringu stoi z tyłu, za punktem spawnu.
      assert.ok(rect.minZ > GAME_SPAWN.z + PLAYER_RADIUS,
        `collider ${JSON.stringify(rect)} zagradza dojście do drzwi`);
    }
  }
});

test('freeSpawn(): punkt startu ma wolny pierścień i drogę do drzwi', () => {
  const spawn = freeSpawn(isBlocked);
  assert.equal(spawn.adjusted, false);
  for (let k = 0; k < 16; k += 1) {
    const a = (k / 16) * Math.PI * 2;
    assert.equal(isBlocked(spawn.x + Math.cos(a) * PLAYER_RADIUS,
      spawn.z + Math.sin(a) * PLAYER_RADIUS), false);
  }
  assert.equal(pathClear(isBlocked, spawn.x, spawn.z, FRONT_DOOR.x, FRONT_DOOR.z, 24), true);
});

test('depenetrate(): wypycha gracza z wnętrza nowego collidera rekwizytu', () => {
  const rect = YARD_OBSTACLES[2];
  const cx = (rect.minX + rect.maxX) / 2;
  const cz = (rect.minZ + rect.maxZ) / 2;
  assert.equal(isBlocked(cx, cz), true);
  const freed = depenetrate(isBlocked, cx, cz);
  assert.ok(Number.isFinite(freed.x) && Number.isFinite(freed.z));
  assert.equal(isBlocked(freed.x, freed.z), false);
});
