import * as THREE from 'three';

/**
 * Retargetowanie dłoni: 21 punktów MediaPipe Hands → kąty zgięcia 15 stawów.
 *
 * To nie jest klasyfikator gestów. Każdy palec ma trzy ogniwa, a kąt każdego
 * z nich liczymy z rzeczywistych wektorów między kolejnymi punktami dłoni.
 * Kąty są niezależne od obrotu i odbicia obrazu, więc ruch palca w świecie
 * rzeczywistym daje taki sam ruch palca awatara (także w widoku first-person).
 */

export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
}

export interface TrackedHand {
  /** Etykieta MediaPipe (liczona dla obrazu lustrzanego). */
  label: 'Left' | 'Right';
  score: number;
  landmarks: NormalizedLandmark[];
}

export interface HandPose {
  /** [palec][staw] — kąty zgięcia w radianach. 0 = prosto. */
  curl: number[][];
  /** [palec] — rozstawienie palców w płaszczyźnie dłoni. */
  spread: number[];
  /** Obrót nadgarstka wokół osi palców. */
  roll: number;
  /** Przechylenie dłoni w stronę / od kamery. */
  pitch: number;
  /** Pozycja nadgarstka w kadrze, znormalizowana do −1..1 (x, y, głębokość). */
  wrist: { x: number; y: number; z: number };
  /** Obrót nadgarstka wokół osi pionowej. */
  yaw: number;
  present: boolean;
}

export interface HandPosePair {
  L: HandPose;
  R: HandPose;
}

/** 0 = kciuk, 1 = wskazujący, 2 = środkowy, 3 = serdeczny, 4 = mały. */
const CHAINS: number[][] = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16],
  [0, 17, 18, 19, 20],
];

const clamp = THREE.MathUtils.clamp;

export function neutralHandPose(): HandPose {
  return {
    curl: Array.from({ length: 5 }, () => [0, 0, 0]),
    spread: [0, 0, 0, 0, 0],
    roll: 0,
    pitch: 0,
    wrist: { x: 0, y: 0, z: 0 },
    yaw: 0,
    present: false,
  };
}

export function neutralHandPosePair(): HandPosePair {
  return { L: neutralHandPose(), R: neutralHandPose() };
}

function points(hand: TrackedHand, aspect: number): THREE.Vector3[] {
  // x i z MediaPipe są w skali szerokości kadru, y w skali wysokości —
  // mnożymy przez aspect, żeby kąty 3D nie były zniekształcone.
  return hand.landmarks.map(
    (lm) => new THREE.Vector3(lm.x * aspect, -lm.y, -lm.z * aspect),
  );
}

function jointAngle(a: THREE.Vector3, b: THREE.Vector3, base = false): number {
  const dot = clamp(a.dot(b), -1, 1);
  const raw = Math.acos(dot) * 0.96;
  // Pierwszy staw ma stały bias: nadgarstek nie leży na osi palca, więc nawet
  // wyprostowana dłoń daje ~25°. Odejmujemy go, żeby „otwarta” = prosta.
  return clamp(base ? (raw - 0.32) * 1.2 : raw, 0, 1.45);
}

/** Z wektorów między punktami dłoni liczymy kąty dla wszystkich 15 stawów. */
export function computeHandPose(hand: TrackedHand, aspect = 4 / 3): HandPose {
  const pose = neutralHandPose();
  if (!hand?.landmarks || hand.landmarks.length < 21) return pose;
  pose.present = true;

  const p = points(hand, aspect);
  const dir = (from: number, to: number): THREE.Vector3 =>
    new THREE.Vector3().subVectors(p[to], p[from]).normalize();

  const wrist = p[0];
  const indexBase = new THREE.Vector3().subVectors(p[5], wrist);
  const pinkyBase = new THREE.Vector3().subVectors(p[17], wrist);
  const normal = new THREE.Vector3().crossVectors(indexBase, pinkyBase).normalize();
  if (normal.lengthSq() < 0.5) normal.set(0, 1, 0);

  for (let f = 0; f < 5; f += 1) {
    const chain = CHAINS[f];
    const seg = chain.slice(0, -1).map((from, i) => dir(chain[i], chain[i + 1]));
    // Trzy ogniwa: kąt między (segmentem poprzednim) a (segmentem następnym).
    // Dla pierwszego ogniwa poprzednikiem jest kierunek od nadgarstka do nasady.
    for (let j = 0; j < 3; j += 1) {
      pose.curl[f][j] = jointAngle(seg[j], seg[j + 1], j === 0);
    }

    // Rozstawienie: kąt między nasadą palca a nasadą palca środkowego,
    // mierzony w płaszczyźnie dłoni (normalna daje znak).
    const base = f === 0 ? dir(1, 2) : dir(0, chain[1]);
    const middle = dir(0, 9);
    const cross = new THREE.Vector3().crossVectors(base, middle);
    const angle = Math.atan2(cross.dot(normal), clamp(base.dot(middle), -1, 1));
    pose.spread[f] = clamp(angle * (f === 0 ? 0.85 : 0.55), -0.55, 0.55);
  }

  // Kciuk zgina się inaczej niż reszta — pierwszy staw dostaje odwiedzenie.
  pose.curl[0][0] = clamp(Math.abs(pose.spread[0]) * 0.7, 0, 0.55);

  const palm = dir(0, 9);
  pose.roll = clamp(Math.atan2(palm.x, -palm.y) * 0.8, -1.0, 1.0);
  pose.pitch = clamp(Math.asin(clamp(normal.z, -1, 1)) * 0.55, -0.5, 0.5);
  // Trzeci wymiar: nie tylko kąty palców, ale gdzie w kadrze jest nadgarstek.
  // Dzięki temu przesunięcie ręki w lewo/prawo, góra/dół i bliżej/dalej
  // przesuwa całą dłoń awatara (także w widoku first-person).
  const w = hand.landmarks[0];
  pose.wrist = {
    x: clamp((w.x - 0.5) * 2, -1, 1),
    y: clamp((0.5 - w.y) * 2, -1, 1),
    z: clamp(-w.z * 2.4, -1, 1),
  };
  pose.yaw = clamp(Math.atan2(normal.x, normal.z + 0.4) * 0.55, -0.8, 0.8);
  return pose;
}

/**
 * MediaPipe zakłada obraz lustrzany, a my podajemy surowy kadr z kamery
 * (CSS odwraca tylko podgląd). Trzeba zamienić strony, żeby prawa dłoń
 * użytkownika poruszała prawą dłonią awatara.
 */
export function posesFromHands(hands: TrackedHand[], aspect = 4 / 3): HandPosePair {
  const pair = neutralHandPosePair();
  for (const hand of hands) {
    const side: 'L' | 'R' = hand.label === 'Left' ? 'R' : 'L';
    const pose = computeHandPose(hand, aspect);
    if (!pair[side].present || hand.score > 0.5) pair[side] = pose;
  }
  return pair;
}

export function blendPose(current: HandPose, target: HandPose, k: number): void {
  for (let f = 0; f < 5; f += 1) {
    for (let j = 0; j < 3; j += 1) {
      current.curl[f][j] += (target.curl[f][j] - current.curl[f][j]) * k;
    }
    current.spread[f] += (target.spread[f] - current.spread[f]) * k;
  }
  current.roll += (target.roll - current.roll) * k;
  current.pitch += (target.pitch - current.pitch) * k;
  current.yaw += (target.yaw - current.yaw) * k;
  current.wrist.x += (target.wrist.x - current.wrist.x) * k;
  current.wrist.y += (target.wrist.y - current.wrist.y) * k;
  current.wrist.z += (target.wrist.z - current.wrist.z) * k;
  current.present = target.present;
}
