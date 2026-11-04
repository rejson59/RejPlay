/**
 * Runner testów: zbiera `tests/*.test.ts` i uruchamia wbudowany `node:test`.
 *
 * Explicitna lista plików (zamiast globu w powłoce) działa identycznie na
 * Linuxie, macOS i Windows, a `--import` rejestruje hak resolucji `.ts`.
 * Nie potrzebujemy Vitest ani żadnej dodatkowej zależności w `npm ci`.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => join(dir, name));

if (files.length === 0) {
  console.error('Brak plików tests/*.test.ts — odmawiam zielonego wyniku.');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--test', '--import', join(dir, 'register.mjs'), ...files],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
