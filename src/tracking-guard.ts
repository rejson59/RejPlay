/**
 * Wspólne zabezpieczenia numeryczne dla śledzenia dłoni, głowy i oczu.
 *
 * MediaPipe potrafi zwrócić `NaN`, `Infinity` albo punkt daleko poza kadrem,
 * gdy WASM wstaje, kamerka zmienia rozdzielczość albo kadr jest pusty.
 * Pojedyncza taka wartość wchodzi w kwaterniony i sprężyny `HandSpring`,
 * a te — raz zatrute `NaN` — już nigdy nie wracają do liczb. Dlatego każdy
 * sygnał przechodzi przez ten moduł, zanim trafi do awatara lub kamery.
 *
 * Moduł jest czysty: bez DOM, bez `import.meta.env`, bez zależności.
 * Dzięki temu można go uruchomić w `node --test` bez przeglądarki.
 */

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export type Landmark = Point3;

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/** Liczba albo bezpieczny zapas — nigdy `NaN` i nigdy `Infinity`. */
export function finite(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** `clamp`, który nie przepuszcza wartości nie-skończonych. */
export function clampFinite(value: unknown, min: number, max: number, fallback = 0): number {
  const n = finite(value, fallback);
  return n < min ? min : n > max ? max : n;
}

/**
 * MediaPipe zwraca współrzędne znormalizowane do kadru; punkty tuż poza
 * krawędzią (np. −0,1) są normalne, ale skok o cały kadr to już szum.
 * `z` jest względne wobec nadgarstka i bywa większe, stąd osobny margines.
 */
export function plausiblePoint(point: Point3 | undefined | null): boolean {
  if (!point) return false;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return false;
  return Math.abs(point.x) <= 2 && Math.abs(point.y) <= 2 && Math.abs(point.z) <= 4;
}

/** Cała dłoń / twarz musi być kompletna i skończona, inaczej klatkę odrzucamy. */
export function validLandmarks(
  points: readonly Point3[] | undefined | null,
  min: number,
  max = 600,
): boolean {
  if (!Array.isArray(points) || points.length < min || points.length > max) return false;
  for (const point of points) if (!plausiblePoint(point)) return false;
  return true;
}

export interface LabeledHand<T extends Point3 = Point3> {
  /** Etykieta MediaPipe, wyliczana dla obrazu lustrzanego. */
  label: 'Left' | 'Right';
  score: number;
  landmarks: T[];
}

/**
 * Gdy `multiHandedness` nie potrafi odróżnić dłoni, MediaPipe zwraca tę samą
 * etykietę dla obu. `posesFromHands` mapowałoby wtedy obie na ten sam bok i
 * jedna znikała. Rozstrzygamy po położeniu nadgarstków w surowym kadrze:
 * kamerka patrzy na użytkownika, więc jego prawa dłoń jest po lewej stronie
 * kadru — dokładnie tak, jak zakłada konwencja „obraz lustrzany” MediaPipe.
 */
export function disambiguateHandedness<T extends Point3>(
  hands: readonly LabeledHand<T>[],
): LabeledHand<T>[] {
  const known = hands.filter(
    (hand) => validLandmarks(hand.landmarks, 21, 64) && (hand.label === 'Left' || hand.label === 'Right'),
  );
  if (known.length < 2) return known;
  const labels = new Set(known.map((hand) => hand.label));
  if (labels.size === known.length) return known;

  const ordered = [...known].sort(
    (a, b) => finite(a.landmarks[0]?.x, 0.5) - finite(b.landmarks[0]?.x, 0.5),
  );
  const span = Math.abs(
    finite(ordered[0].landmarks[0]?.x, 0) - finite(ordered[ordered.length - 1].landmarks[0]?.x, 0),
  );
  // Nadgarstki w tym samym miejscu: nie zgadujemy, zostawiamy wyższe score.
  if (span < 0.02) return known;
  return ordered.map((hand, index) => ({
    ...hand,
    label: index < ordered.length / 2 ? 'Left' : 'Right',
  })) as LabeledHand<T>[];
}

/**
 * Pilnuje, czy model wciąż dostarcza odczyty. Gdy zamilknie (WASM, iframe,
 * odłączona kamerka, uśpiona karta), trzeba świadomie wypuścić dłonie i
 * wyzerować sterowanie — inaczej awatar zamarza w ostatniej pozie, a kamera
 * jedzie dalej ostatnim wektorem głowy.
 */
export class FrameWatchdog {
  private last = Number.NEGATIVE_INFINITY;
  private armed = false;
  private readonly timeout: number;

  constructor(timeoutMs: number) {
    this.timeout = Math.max(1, finite(timeoutMs, 1000));
  }

  mark(at = now()): void {
    this.last = at;
    this.armed = true;
  }

  isStale(at = now()): boolean {
    return this.armed && at - this.last > this.timeout;
  }

  age(at = now()): number {
    return this.armed ? Math.max(0, at - this.last) : 0;
  }

  /** Po wyemitowaniu zwolnienia nie powtarzamy go co klatkę. */
  release(): void {
    this.armed = false;
  }

  reset(): void {
    this.last = Number.NEGATIVE_INFINITY;
    this.armed = false;
  }

  get hasFrame(): boolean {
    return this.armed;
  }
}
