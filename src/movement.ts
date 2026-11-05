/**
 * Czysta geometria ruchu i kolizji Demonofobii — bez THREE, bez DOM.
 *
 * Wydzielona z `horror.ts`, żeby układ podwórka był sprawdzalny w `node --test`.
 * v0.8: gracz startował w (0, 12.4), czyli WEWNĄTRZ collidera blatu
 * monitoringu powiększonego o promień postaci. `blocked()` sprawdza tylko cel
 * kroku, więc każdy ruch był odrzucany, prędkość dławiona do zera, a postać
 * stała w miejscu mimo wciśniętego W. Testy w `tests/movement.test.ts`
 * pilnują startu ORAZ całej drogi od samochodu do frontowych drzwi.
 */

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type WallSegment = [number, number, number, number];

/** Promień kapsuły gracza i wysokość oczu nad podłożem. */
export const PLAYER_RADIUS = 0.33;
export const EYE_HEIGHT = 1.65;

/**
 * Ściany [x1, z1, x2, z2]. Środkiem biegnie korytarz (x od -1.35 do 1.35),
 * po bokach leżą cztery pokoje. W ścianach korytarza są dwa przejścia
 * z każdej strony, a frontowe drzwi prowadzą prosto do wyjścia.
 */
export const WALL_SEGMENTS: WallSegment[] = [
  [-9, -9, 9, -9],
  [-9, 9, -1.25, 9],
  [1.25, 9, 9, 9],
  [-9, -9, -9, 9],
  [9, -9, 9, 9],
  [-1.35, -9, -1.35, -5.6],
  [-1.35, -3.6, -1.35, 3.6],
  [-1.35, 5.6, -1.35, 9],
  [1.35, -9, 1.35, -5.6],
  [1.35, -3.6, 1.35, 3.6],
  [1.35, 5.6, 1.35, 9],
  [-9, 0, -1.35, 0],
  [1.35, 0, 9, 0],
];

/** Wyposażenie podwórka w surowych (niepowiększonych) współrzędnych. */
export const YARD_OBSTACLES: Rect[] = [
  // Samochód-baza stoi po prawej stronie dojazdu.
  { minX: 1.35, maxX: 3.8, minZ: 11.1, maxZ: 16.6 },
  // Blat stanowiska monitoringu: mesh 1.5 × 0.6 przy (1.0, 13.0).
  { minX: 0.25, maxX: 1.75, minZ: 12.6, maxZ: 13.4 },
  // v0.9: widoczne rekwizyty podwórka też są colliderami. Wcześniej gracz
  // „wjeżdżał" w deskę/słupek i wyglądało to jak zacięcie ruchu. Wszystkie
  // leżą POZA osią korytarza x ∈ (−0,95; 0,95), więc dojście do drzwi jest
  // zawsze wolne — pilnuje tego test `korytarz od spawnu do drzwi`.
  { minX: -1.85, maxX: -1.35, minZ: 9.45, maxZ: 9.95 },   // słupek lewy
  { minX: 1.35, maxX: 1.85, minZ: 9.45, maxZ: 9.95 },     // słupek prawy
  { minX: -2.15, maxX: -1.65, minZ: 9.85, maxZ: 10.35 },  // pachołek lewy
  { minX: 1.65, maxX: 2.15, minZ: 9.85, maxZ: 10.35 },    // pachołek prawy
  { minX: 2.0, maxX: 2.5, minZ: 9.9, maxZ: 10.4 },        // skrzynka na listy
  { minX: 3.0, maxX: 3.6, minZ: 10.1, maxZ: 10.7 },       // kosz na kółkach
  { minX: -3.65, maxX: -3.05, minZ: 10.9, maxZ: 11.5 },   // latarnia
  { minX: -3.2, maxX: -2.6, minZ: 10.3, maxZ: 10.9 },     // krzak
  { minX: 5.15, maxX: 5.65, minZ: 10.25, maxZ: 10.75 },   // głaz
];
/** Oś dojścia do frontowych drzwi — testowana w całej długości. */
export const FRONT_DOOR = Object.freeze({ x: 0, z: 8.9 });

/**
 * Start rundy: na dojeździe przed blatem, twarzą do frontowych drzwi.
 * `yaw === pitch === 0` jest celowe — `yawTarget` też jest zerem, więc kamera
 * nie wykonuje już wymuszonego obrotu o 180° w pierwszej sekundzie gry.
 */
export const GAME_SPAWN = Object.freeze({
  x: 0,
  y: EYE_HEIGHT,
  z: 11.6,
  yaw: 0,
  pitch: 0,
});

/** Ściany jako prostokąty z tym samym marginesem, którego używa dekoracja. */
export function wallRects(
  segments: readonly WallSegment[] = WALL_SEGMENTS,
  padding = 0.08,
): Rect[] {
  return segments.map(([x1, z1, x2, z2]) => ({
    minX: Math.min(x1, x2) - padding,
    maxX: Math.max(x1, x2) + padding,
    minZ: Math.min(z1, z2) - padding,
    maxZ: Math.max(z1, z2) + padding,
  }));
}

export type Collision = (x: number, z: number) => boolean;

/** Funkcja kolizji. Zepsute współrzędne traktujemy jako przeszkodę, nie wyjątek. */
export function createCollision(
  walls: readonly Rect[] = wallRects(),
  radius = PLAYER_RADIUS,
): Collision {
  return (x: number, z: number): boolean => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return true;
    const inYard = z > 8.7;
    const limitX = inYard ? 3.8 : 8.7;
    const limitZ = inYard ? 17.4 : 8.7;
    if (x < -limitX || x > limitX || z < -8.7 || z > limitZ) return true;
    const hits = (rect: Rect): boolean =>
      x > rect.minX - radius && x < rect.maxX + radius
      && z > rect.minZ - radius && z < rect.maxZ + radius;
    for (const wall of walls) if (hits(wall)) return true;
    if (inYard) for (const obstacle of YARD_OBSTACLES) if (hits(obstacle)) return true;
    return false;
  };
}

/** Czy cały odcinek jest przechodni (próbkowanie chroni przed przeskoczeniem ściany). */
/**
 * Łączy świadomy ruch (klawiatura, joystick dotykowy) z sygnałem z kamerki.
 *
 * v0.9 — regresja „deska na spawnie": `iy = joystick + cameraJoystick`
 * sumowało W (+1) z zatrutym kanałem głowy (−1) i dawało 0, więc gracz
 * stał mimo wciśniętego klawisza. Klawiatura/dotyk mają PIERWSZEŃSTWO,
 * a kamerka przejmuje ster dopiero, gdy ręce i klawisze są w spoczynku.
 * Funkcja jest czysta, żeby tę regułę mógł egzekwować test jednostkowy.
 */
export interface MovementVector { x: number; y: number }

export function combineMovement(
  manualX: number, manualY: number, cameraX: number, cameraY: number,
): MovementVector {
  const manual = Math.hypot(manualX, manualY);
  let x = manual > 0.02 ? manualX : cameraX;
  let y = manual > 0.02 ? manualY : cameraY;
  if (!Number.isFinite(x)) x = 0;
  if (!Number.isFinite(y)) y = 0;
  const magnitude = Math.hypot(x, y);
  if (magnitude > 1) { x /= magnitude; y /= magnitude; }
  return { x, y };
}

export function pathClear(
  isBlocked: Collision,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  samples = 16,
): boolean {
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    if (isBlocked(fromX + (toX - fromX) * t, fromZ + (toZ - fromZ) * t)) return false;
  }
  return true;
}

/** Kandydaci na start: zawsze w wolnym korytarzu, od najbliższego samochodu. */
const SPAWN_CANDIDATES: ReadonlyArray<readonly [number, number]> = [
  [0, 11.6], [0, 10.8], [-0.8, 11.6], [-0.8, 10.8],
  [0, 10.2], [-1.6, 10.2], [0, 9.7],
];

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  adjusted: boolean;
}

/**
 * Nigdy nie stawiamy gracza w colliderze. Jeśli przyszła zmiana wyposażenia
 * zasłoni któryś z kandydatów, start cofa się w stronę drzwi, a `adjusted`
 * trafia do diagnostyki — błąd jest widoczny, zamiast znów blokować ruch.
 */
export function freeSpawn(isBlocked: Collision, eyeHeight = EYE_HEIGHT): SpawnPoint {
  const ringClear = (x: number, z: number): boolean => {
    if (isBlocked(x, z)) return false;
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * Math.PI * 2;
      if (isBlocked(x + Math.cos(a) * PLAYER_RADIUS, z + Math.sin(a) * PLAYER_RADIUS)) {
        return false;
      }
    }
    return true;
  };
  // Przebieg 1: kandydat wolny w całym promieniu kapsuły ORAZ ma czystą
  // drogę do frontowych drzwi. To jedyny przypadek „start bez korekty".
  for (let i = 0; i < SPAWN_CANDIDATES.length; i += 1) {
    const [x, z] = SPAWN_CANDIDATES[i];
    if (ringClear(x, z)
      && pathClear(isBlocked, x, z, FRONT_DOOR.x, FRONT_DOOR.z, 24)) {
      return { x, y: eyeHeight, z, adjusted: i > 0 };
    }
  }
  // Przebieg 2: niestandardowa kolizja (testy, przyszłe poziomy) może zasłonić
  // samą oś, ale wciąż musimy postawić gracza w wolnym miejscu — nigdy w
  // colliderze. Droga do drzwi nie jest tu warunkiem istnienia startu.
  for (let i = 0; i < SPAWN_CANDIDATES.length; i += 1) {
    const [x, z] = SPAWN_CANDIDATES[i];
    if (ringClear(x, z)) return { x, y: eyeHeight, z, adjusted: true };
  }
  // Ostatnia deska ratunku: oś korytarza tuż przed frontowymi drzwiami.
  return { x: 0, y: eyeHeight, z: 10.2, adjusted: true };
}

const ESCAPE_STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, -0.5], [0, -1], [-0.5, 0], [0.5, 0],
  [-1, 0], [1, 0], [0, -2], [-1.5, 0], [0, -3],
];

/**
 * Samonaprawa: gdy gracz i tak znajdzie się wewnątrz przeszkody (teleport,
 * zmiana poziomu, zepsuty stan), wypychamy go najkrótszą wolną drogą zamiast
 * zostawiać go uwięzionego na zawsze.
 */
export function depenetrate(
  isBlocked: Collision,
  x: number,
  z: number,
): { x: number; z: number; moved: boolean } {
  if (!isBlocked(x, z)) return { x, z, moved: false };
  for (const [dx, dz] of ESCAPE_STEPS) {
    // Punkt startowy jest z definicji WEWNĄTRZ collidera (np. w słupku),
    // więc wymaganie „cała droga wolna" od t = 0 skazywało nas na porażkę
    // i gracz zostawał uwięziony. Szukamy pierwszego wyjścia, a potem
    // pilnujemy, żeby dalej nie wejść w KOLEJNĄ ścianę (brak teleportacji).
    let exited = false;
    let clear = true;
    for (let i = 1; i <= 12; i += 1) {
      const t = i / 12;
      const blocked = isBlocked(x + dx * t, z + dz * t);
      if (!blocked) exited = true;
      else if (exited) { clear = false; break; }
    }
    if (clear && exited) return { x: x + dx, z: z + dz, moved: true };
  }
  return { x, z, moved: false };
}
