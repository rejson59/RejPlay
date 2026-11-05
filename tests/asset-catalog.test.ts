import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, openSync, readSync, closeSync, readFileSync, statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, ASSET_CATEGORIES, ASSET_TOTAL, type AssetLicense } from '../src/asset-catalog';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const json = JSON.parse(readFileSync(join(root, 'public/assets/ASSETS.json'), 'utf8')) as {
  version: string;
  categories: Array<{ id: string; count: number }>;
  assets: Array<{
    name: string; label: string; category: string; file: string;
    source: string; license: AssetLicense; bytes: number; attribution?: string;
  }>;
};

const LICENSES = ['MIT / CC0', 'CC0', 'CC-BY 4.0'];
const SOURCES = ['gridfall', 'khronos'];
/** Budżet repozytorium: cała biblioteka GLB nie może przekroczyć 80 MB. */
const BYTE_BUDGET = 80 * 1024 * 1024;

test('ASSETS.json i src/asset-catalog.ts to jedno źródło prawdy', () => {
  assert.equal(json.assets.length, ASSETS.length);
  assert.equal(ASSET_TOTAL, ASSETS.length);
  assert.match(json.version, /^\d+\.\d+\.\d+$/, 'wersja katalogu w formacie semver');
  assert.deepEqual(
    json.categories.map((c) => [c.id, c.count]),
    ASSET_CATEGORIES.map((c) => [c.id, c.count]),
  );
  for (let i = 0; i < ASSETS.length; i += 1) {
    const a = ASSETS[i];
    const j = json.assets[i];
    assert.deepEqual(
      [a.name, a.label, a.category, a.file, a.source, a.license, a.bytes],
      [j.name, j.label, j.category, j.file, j.source, j.license, j.bytes],
      `wpis ${i} (${a.name}) różni się między JSON a TS`,
    );
  }
});

test('katalog: unikalne nazwy, poprawne kategorie, licencje i źródła', () => {
  const names = new Set<string>();
  const ids = new Set(ASSET_CATEGORIES.map((c) => c.id));
  for (const asset of ASSETS) {
    assert.equal(names.has(asset.name), false, `duplikat: ${asset.name}`);
    names.add(asset.name);
    assert.ok(ids.has(asset.category), `nieznana kategoria: ${asset.category}`);
    assert.ok(LICENSES.includes(asset.license), `nieznana licencja: ${asset.license}`);
    assert.ok(SOURCES.includes(asset.source), `nieznane źródło: ${asset.source}`);
    assert.ok(asset.label.length > 1);
    if (asset.license === 'CC-BY 4.0') {
      assert.ok(asset.attribution, `CC BY 4.0 wymaga autorstwa: ${asset.name}`);
    }
  }
});

test('katalog: liczności w nagłówkach kategorii zgadzają się z wpisami', () => {
  for (const category of ASSET_CATEGORIES) {
    const actual = ASSETS.filter((a) => a.category === category.id).length;
    assert.equal(category.count, actual, `kategoria ${category.id}`);
  }
});

test('katalog: każdy plik GLB istnieje, ma zadeklarowany rozmiar i nagłówek glTF 2.0', () => {
  let total = 0;
  for (const asset of ASSETS) {
    const path = join(root, 'public', asset.file);
    assert.ok(existsSync(path), `brak pliku: ${asset.file}`);
    const size = statSync(path).size;
    assert.equal(size, asset.bytes, `zły rozmiar w katalogu: ${asset.file}`);
    const fd = openSync(path, 'r');
    const head = Buffer.alloc(12);
    readSync(fd, head, 0, 12, 0);
    closeSync(fd);
    assert.equal(head.toString('ascii', 0, 4), 'glTF', `nie glTF: ${asset.file}`);
    assert.equal(head.readUInt32LE(4), 2, `nie wersja 2.0: ${asset.file}`);
    assert.equal(head.readUInt32LE(8), size, `uszkodzony nagłówek: ${asset.file}`);
    total += size;
  }
  assert.ok(total < BYTE_BUDGET, `budżet assetów przekroczony: ${total} B`);
  assert.ok(ASSETS.length >= 120, 'katalog nie może się skurczyć bez świadomej zmiany testu');
});
