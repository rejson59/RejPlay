/** Deterministyczny RNG i małe funkcje matematyczne. Czyste, bez DOM. */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  float(min = 0, max = 1): number { return min + this.next() * (max - min); }
  int(min: number, max: number): number { return Math.floor(this.float(min, max + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(items: readonly T[]): T { return items[Math.floor(this.next() * items.length)]; }

  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const round2 = (v: number): number => Math.round(v * 100) / 100;
export const fmtInt = (v: number): string => String(Math.round(v));
export const pad2 = (v: number): string => String(Math.floor(v)).padStart(2, '0');
