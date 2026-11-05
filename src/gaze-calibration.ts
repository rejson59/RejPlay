/**
 * Kalibracja wzroku punktami na ekranie — czysta matematyka, bez DOM.
 *
 * v0.9: dawna „kalibracja" polegała wyłącznie na patrzeniu prosto przez 2 s
 * i zapisaniu jednego punktu neutralnego. Surowy `gazeX/gazeY` z FaceMesh
 * jest jednak u każdej osoby inny (kształt oka, odległość od kamery, kąt
 * patrzenia), więc jedno odejmowanie nie wystarczało: kamera jechała sama,
 * a spojrzenie w lewo nie trafiało w lewą krawędź ekranu.
 *
 * Tutaj gracz patrzy na 9 punktów siatki 3×3. Dla każdego zbieramy surowe
 * spojrzenie i dopasowujemy przekształcenie afiniczne
 *
 *   x' = a·gx + b·gy + c
 *   y' = d·gx + e·gy + f
 *
 * metodą najmniejszych kwadratów z regularizacją (macierz 3×3 jest odporna
 * na zdegenerowane próbki). Wynik mapuje surowe spojrzenie wprost na
 * współrzędne ekranu −1..1, więc środek staje się zerem bez zgadywania.
 * Moduł nie zna `localStorage` ani Three.js i daje się przetestować w Node.
 */

export interface CalibrationTarget {
  id: string;
  /** Pozycja punktu na ekranie: −1 = lewa góra, +1 = prawy dół. */
  x: number;
  y: number;
}

export interface GazeSample {
  x: number;
  y: number;
}

/** Siatka 3×3. Środek jest pierwszy: najpierw uczymy się „patrzę prosto". */
export const GAZE_TARGETS: readonly CalibrationTarget[] = Object.freeze([
  { id: 'center', x: 0, y: 0 },
  { id: 'top-left', x: -0.78, y: -0.78 },
  { id: 'top', x: 0, y: -0.78 },
  { id: 'top-right', x: 0.78, y: -0.78 },
  { id: 'left', x: -0.78, y: 0 },
  { id: 'right', x: 0.78, y: 0 },
  { id: 'bottom-left', x: -0.78, y: 0.78 },
  { id: 'bottom', x: 0, y: 0.78 },
  { id: 'bottom-right', x: 0.78, y: 0.78 },
]);

export interface CalibrationPair {
  target: CalibrationTarget;
  gaze: GazeSample;
}

/** Dopasowane przekształcenie + ocena jakości (0..1) i błąd RMS. */
export interface GazeMapping {
  ax: number; bx: number; cx: number;
  ay: number; by: number; cy: number;
  quality: number;
  residual: number;
  points: number;
}

/** Minimalna liczba punktów, żeby 3×3 miała sens (inaczej to zgadywanie). */
export const MIN_CALIBRATION_POINTS = 4;
/** Powyżej tego błędu odrzucamy próbę zamiast pogarszać sterowanie. */
const MAX_RESIDUAL = 0.72;
/** Słabe dopasowanie (np. gracz nie patrzył na punkty) też odrzucamy. */
const MIN_QUALITY = 0.35;
const RIDGE = 0.015;

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const finite = (v: number): boolean => Number.isFinite(v);

function sane(sample: GazeSample | undefined): boolean {
  return Boolean(sample) && finite(sample!.x) && finite(sample!.y)
    && Math.abs(sample!.x) < 8 && Math.abs(sample!.y) < 8;
}

/** Mediana jest odporna na pojedyncze mrugnięcie / zgubioną klatkę źrenicy. */
export function median(values: readonly number[]): number {
  const clean = values.filter(finite).sort((a, b) => a - b);
  if (clean.length === 0) return 0;
  const mid = clean.length >> 1;
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

/** Rozwiązuje (AᵀA + λI)·w = Aᵀb eliminacją Gaussa z pivotem. */
function solve3(m: number[][], rhs: number[]): number[] | null {
  const a = m.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-7) return null;
    if (pivot !== col) [a[col], a[pivot]] = [a[pivot], a[col]];
    const div = a[col][col];
    for (let k = col; k < 4; k += 1) a[col][k] /= div;
    for (let row = 0; row < 3; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let k = col; k < 4; k += 1) a[row][k] -= factor * a[col][k];
    }
  }
  const out = [a[0][3], a[1][3], a[2][3]];
  return out.every(finite) ? out : null;
}

function fitAxis(pairs: readonly CalibrationPair[], axis: 'x' | 'y'): number[] | null {
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const rhs = [0, 0, 0];
  for (const pair of pairs) {
    const row = [pair.gaze.x, pair.gaze.y, 1];
    const target = pair.target[axis];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) m[i][j] += row[i] * row[j];
      rhs[i] += row[i] * target;
    }
  }
  for (let i = 0; i < 3; i += 1) m[i][i] += RIDGE;
  const w = solve3(m, rhs);
  if (!w) return null;
  return [
    clamp(w[0], -8, 8),
    clamp(w[1], -8, 8),
    clamp(w[2], -2.5, 2.5),
  ];
}

function residualRms(mapping: Omit<GazeMapping, 'quality' | 'residual' | 'points'>,
  pairs: readonly CalibrationPair[]): number {
  let sum = 0;
  for (const p of pairs) {
    const x = mapping.ax * p.gaze.x + mapping.bx * p.gaze.y + mapping.cx;
    const y = mapping.ay * p.gaze.x + mapping.by * p.gaze.y + mapping.cy;
    sum += (x - p.target.x) ** 2 + (y - p.target.y) ** 2;
  }
  return Math.sqrt(sum / Math.max(1, pairs.length * 2));
}

/**
 * Zwraca `null`, gdy próbek jest za mało, są zdegenerowane (gracz w ogóle nie
 * ruszał oczami) albo dopasowanie jest gorsze niż surowy sygnał.
 */
export function fitGazeMapping(pairs: readonly CalibrationPair[]): GazeMapping | null {
  const clean = pairs.filter((p) => sane(p.gaze) && finite(p.target.x) && finite(p.target.y));
  if (clean.length < MIN_CALIBRATION_POINTS) return null;
  const xs = clean.map((p) => p.gaze.x);
  const ys = clean.map((p) => p.gaze.y);
  const spreadX = Math.max(...xs) - Math.min(...xs);
  const spreadY = Math.max(...ys) - Math.min(...ys);
  if (spreadX < 0.02 || spreadY < 0.02) return null;
  const wx = fitAxis(clean, 'x');
  const wy = fitAxis(clean, 'y');
  if (!wx || !wy) return null;
  const base = {
    ax: wx[0], bx: wx[1], cx: wx[2],
    ay: wy[0], by: wy[1], cy: wy[2],
  };
  const residual = residualRms(base, clean);
  if (!finite(residual) || residual > MAX_RESIDUAL) return null;
  const quality = clamp(1 - residual / MAX_RESIDUAL, 0, 1);
  if (quality < MIN_QUALITY) return null;
  return { ...base, quality, residual, points: clean.length };
}

/** Surowy odczyt → współrzędne ekranu. Bez mapowania zostaje surowy sygnał. */
export function applyGazeMapping(mapping: GazeMapping | null, x: number, y: number): GazeSample {
  if (!mapping || !finite(x) || !finite(y)) return { x: finite(x) ? x : 0, y: finite(y) ? y : 0 };
  return {
    x: clamp(mapping.ax * x + mapping.bx * y + mapping.cx, -1.6, 1.6),
    y: clamp(mapping.ay * x + mapping.by * y + mapping.cy, -1.6, 1.6),
  };
}

/** Bezpieczne wczytanie mapowania z zapisu (odrzuca zepsute/niestabilne). */
export function parseGazeMapping(raw: unknown): GazeMapping | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const keys = ['ax', 'bx', 'cx', 'ay', 'by', 'cy', 'quality', 'residual', 'points'] as const;
  if (!keys.every((k) => typeof r[k] === 'number' && finite(r[k] as number))) return null;
  const m = r as unknown as GazeMapping;
  if (m.points < MIN_CALIBRATION_POINTS || m.quality < 0 || m.quality > 1) return null;
  return m;
}

/**
 * Stan kreatora: zbiera próbki dla bieżącego punktu i przechodzi po kolei.
 * Nie zna czasu ani DOM — interfejs sam decyduje, kiedy wołać `capture`/`next`.
 */
export class GazeCalibrator {
  private samples = new Map<string, GazeSample[]>();
  private index = 0;

  reset(): void {
    this.samples.clear();
    this.index = 0;
  }

  get current(): CalibrationTarget | null {
    return GAZE_TARGETS[this.index] ?? null;
  }

  get position(): number {
    return this.index;
  }

  get total(): number {
    return GAZE_TARGETS.length;
  }

  get progress(): number {
    return clamp(this.index / GAZE_TARGETS.length, 0, 1);
  }

  get sampleCount(): number {
    return this.samples.get(this.current?.id ?? '')?.length ?? 0;
  }

  /** Zapisuje jedną klatkę dla aktualnego punktu. */
  capture(sample: GazeSample): boolean {
    const target = this.current;
    if (!target || !sane(sample)) return false;
    const list = this.samples.get(target.id) ?? [];
    list.push({ x: sample.x, y: sample.y });
    this.samples.set(target.id, list);
    return true;
  }

  /** Przechodzi dalej; `false` oznacza koniec siatki. */
  next(): boolean {
    this.index += 1;
    return this.current !== null;
  }

  result(): { mapping: GazeMapping | null; captured: number; pairs: CalibrationPair[] } {
    const pairs: CalibrationPair[] = [];
    for (const target of GAZE_TARGETS) {
      const list = this.samples.get(target.id) ?? [];
      if (list.length === 0) continue;
      pairs.push({
        target,
        gaze: {
          x: median(list.map((s) => s.x)),
          y: median(list.map((s) => s.y)),
        },
      });
    }
    return { mapping: fitGazeMapping(pairs), captured: pairs.length, pairs };
  }
}
