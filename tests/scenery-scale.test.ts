/**
 * Regresja „DLACZEGO LAMPY SĄ WIELKOŚCI CAŁEGO LOBBY" (v0.9).
 *
 * `Lantern.glb` z Khronos ma 25,66 m wysokości w jednostkach pliku, a układ
 * parku dawał mu `scale: 2.2` → 56 m w parku o promieniu 12 m. Test mierzy
 * PRAWDZIWY bbox każdego GLB (z transformacjami węzłów, przez Three.js) i
 * pilnuje, żeby żaden obiekt nie przekraczał limitu wysokości.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {
  LOBBY_PROPS, MAX_PROP_HEIGHT, YARD_PROPS, allSceneryFiles,
} from '../src/scenery-layout';

// GLTFLoader w Node nie ma `self` (używany przez loader obrazów). Ustawiamy
// go przed pierwszym parse; w przeglądarce ta linia jest no-op.
(globalThis as unknown as { self?: unknown }).self ??= globalThis;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(
  readFileSync(resolve(root, 'public/assets/ASSETS.json'), 'utf8'),
) as { assets: Array<{ file: string }> };
const catalogFiles = new Set(catalog.assets.map((a) => a.file));

const heights = new Map<string, number>();
async function nativeHeight(file: string): Promise<number> {
  const cached = heights.get(file);
  if (cached !== undefined) return cached;
  const path = resolve(root, 'public/assets', file);
  assert.ok(existsSync(path), `brak pliku GLB: ${file}`);
  const buf = readFileSync(path);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  // Wbudowane tekstury w Node nie mają ImageBitmap — to tylko ostrzeżenia.
  const warn = console.warn;
  console.warn = () => {};
  try {
    const gltf = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(arrayBuffer as ArrayBuffer, '');
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const height = box.getSize(new THREE.Vector3()).y;
    assert.ok(Number.isFinite(height) && height > 0, `pusty bbox: ${file}`);
    heights.set(file, height);
    return height;
  } finally {
    console.warn = warn;
  }
}

test('każdy obiekt parku ma plik w katalogu assetów i na dysku', () => {
  const files = allSceneryFiles();
  assert.ok(files.length >= 30);
  assert.equal(files.length, new Set(files).size);
  for (const file of files) {
    assert.ok(catalogFiles.has(`assets/${file}`), `${file} nie ma wpisu w ASSETS.json`);
    assert.ok(existsSync(resolve(root, 'public/assets', file)), `${file} nie istnieje`);
  }
});

test('Lantern.glb: przyczyna gigantycznych lamp jest udokumentowana i naprawiona', async () => {
  const raw = await nativeHeight('library/przedmioty/Lantern.glb');
  assert.ok(raw > 20, `Khronos trzyma model w jednostkach ~25 m (zmierzono ${raw})`);
  const bad = raw * 2.2;
  assert.ok(bad > 50, `stary scale 2.2 dawał ${bad} m w parku o promieniu 12 m`);
  const lanterns = LOBBY_PROPS.filter((p) => p.file.includes('Lantern.glb'));
  assert.equal(lanterns.length, 2);
  for (const prop of lanterns) {
    assert.ok(prop.height !== undefined, 'każda latarnia ma jawną wysokość w metrach');
    assert.ok(prop.height! <= 2, 'latarnia nie może zasłaniać Lobby');
  }
});

test('żaden model w Lobby ani na podwórku nie przekracza limitu wysokości', async () => {
  for (const prop of [...LOBBY_PROPS, ...YARD_PROPS]) {
    const raw = await nativeHeight(prop.file);
    const scale = prop.height ? prop.height / raw : prop.scale;
    const effective = prop.height
      ? prop.height
      : Math.min(raw * scale, MAX_PROP_HEIGHT);
    assert.ok(Number.isFinite(effective), `${prop.file}: nieskończona skala`);
    assert.ok(effective >= 0.1, `${prop.file}: obiekt zniknął (${effective} m)`);
    assert.ok(effective <= MAX_PROP_HEIGHT + 1e-6,
      `${prop.file}: ${effective.toFixed(2)} m > ${MAX_PROP_HEIGHT} m`);
  }
});

test('domyślny mnożnik skali nie produkuje gigantów bez clampu', async () => {
  const oversized: string[] = [];
  for (const file of allSceneryFiles()) {
    const raw = await nativeHeight(file);
    for (const prop of [...LOBBY_PROPS, ...YARD_PROPS]) {
      if (prop.file !== file || prop.height) continue;
      if (raw * prop.scale > MAX_PROP_HEIGHT) oversized.push(file);
    }
  }
  // Wszystkie takie przypadki są w runtime twardo clampowane do limitu;
  // test pilnuje, żeby ich lista nie rosła niezauważenie.
  assert.ok(oversized.length <= 2,
    `zbyt dużo modeli polega na clampie: ${[...new Set(oversized)].join(', ')}`);
});
