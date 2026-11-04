import * as THREE from 'three';
import {
  clampFinite, disambiguateHandedness, finite, validLandmarks,
} from './tracking-guard';

/**
 * Retargetowanie dłoni: 21 punktów MediaPipe Hands → kąty zgięcia 15 stawów.
 *
 * To nie jest klasyfikator gestów. Każdy palec ma trzy ogniwa, a kąt każdego
 * z nich liczymy z rzeczywistych wektorów między kolejnymi punktami dłoni.
 * Kąty są niezależne od obrotu i odbicia obrazu, więc ruch palca w świecie
 * rzeczywistym daje taki sam ruch palca awatara (także w widoku first-person).
 *
 * Warstwa „realizmu” (v0.4):
 *  - anatomiczne limity i sprzężenie ścięgien (DIP podąża za PIP),
 *  - lekka współzależność palców — prawdziwa dłoń nie zgina ich całkiem osobno,
 *  - sprężynowe wygładzanie z bezwładnością zamiast zwykłego lerp,
 *  - spoczynkowy chwyt narzędzia, mikro-drżenie i opóźnienie przy obrocie kamery.
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
  /** Pozycja nadgarstka w kadrze, znormalizowana do −1..1 (x, y, głębokość).
   *  x: −1 = lewa krawędź odbitego podglądu, +1 = prawa; y: −1 = dół, +1 = góra;
   *  z: +1 = dłoń bliżej kamery (większa), −1 = dalej. */
  wrist: { x: number; y: number; z: number };
  /** Obrót nadgarstka wokół osi pionowej. */
  yaw: number;
  /** Wyładzona obecność dłoni (0..1) — pozwala wrócić do pozycji spoczynkowej
   *  bez teleportu, gdy dłoń znika z kadru. */
  presence: number;
  present: boolean;
}

export interface HandPosePair {
  L: HandPose;
  R: HandPose;
}

/** Kontekst ruchu dłoni first-person (awatar w lobby go nie potrzebuje). */
export interface HandMotion {
  /** Czas gry w sekundach — napędza spokojny oddech i mikro-drżenie. */
  time: number;
  /** Faza kroku (−1..1). */
  sway: number;
  /** Prędkość obrotu kamery w rad/s — dłonie „zostają” przy skręcie. */
  turn: number;
  /** 0..1 — jak mocno dłoń zaciska się na narzędziu. */
  grip: number;
  /** 0..1 — palec wskazujący prostuje się, wciskając przycisk. */
  scan: number;
  sprint: number;
  side: 'L' | 'R';
}

/** 0 = kciuk, 1 = wskazujący, 2 = środkowy, 3 = serdeczny, 4 = mały. */
const CHAINS: number[][] = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16],
  [0, 17, 18, 19, 20],
];

/** Stały kąt między kolejnymi punktami przy wyprostowanym palcu. */
const JOINT_BIAS = [0.30, 0.10, 0.06];
const THUMB_BIAS = [0.22, 0.12, 0.08];
const JOINT_GAIN = [1.15, 1.06, 0.95];
const JOINT_MAX = [1.55, 1.75, 1.25];

/** Zrelaksowany chwyt: palce nie są ani całkiem proste, ani zaciśnięte w pięść. */
const GRIP_CURL: number[][] = [
  [0.30, 0.30, 0.18],
  [0.30, 0.46, 0.30],
  [0.34, 0.54, 0.34],
  [0.38, 0.60, 0.38],
  [0.46, 0.68, 0.42],
];
const GRIP_SPREAD = [0.20, -0.05, -0.01, 0.04, 0.10];

const clamp = THREE.MathUtils.clamp;

/**
 * Jak bardzo dłoń ma „kleić się” do odczytu. 1 = domyślne 1:1, niżej =
 * bardziej płynnie (przy drżącej kamerce), wyżej = jeszcze mniejsze opóźnienie.
 * Ustawienie jest globalne, bo ten sam odczyt zasila awatara, grę i Lobby.
 */
let wristResponsiveness = 1;

export function setHandResponsiveness(value: number): void {
  wristResponsiveness = clamp(value, 0.45, 2.2);
}

export function handResponsiveness(): number {
  return wristResponsiveness;
}

/**
 * Kalibracja obrotu nadgarstka (v0.6.1).
 *
 * Stary wzór `atan2(palm.x, -palm.y)` dawał π dla zwykłej dłoni skierowanej
 * palcami w górę, a clamp ±1 zamieniał to w stałą „1”: obrót nadgarstka był
 * całkowicie niewidoczny — dokładnie to zgłosił użytkownik. Teraz mierzymy
 * kąt normalnej dłoni wokół osi palców i integrujemy go z zawijaniem fazy,
 * więc kąt jest ciągły (bez skoku przy ±π) i zaczyna się od zera w pozie,
 * w której dłoń została pierwszy raz zobaczona.
 */
interface WristState { last: number | null; angle: number; at: number }
const wristStates = new Map<string, WristState>();
/** Po ilu ms braku dłoni uznajemy powrót za nową sesję (bez skoku kąta). */
const WRIST_REACQUIRE_MS = 350;

/** Wołane przy każdym restarcie kamerki — nowa sesja, nowa pozycja neutralna. */
export function resetWristCalibration(): void {
  wristStates.clear();
}

/** Przycisk „Kalibruj pozycję neutralną” w laboratorium. */
export function recaptureWristNeutral(): void {
  for (const state of wristStates.values()) {
    state.angle = 0;
    // Bez wyzerowania kotwicy następna klatka dokładała różnicę między
    // starą a nową pozą i natychmiast wbijała kąt w limit ±1,75 rad.
    state.last = null;
    state.at = 0;
  }
}

function wristTwist(key: string, raw: number, at: number): number {
  let state = wristStates.get(key);
  if (!state) {
    state = { last: null, angle: 0, at };
    wristStates.set(key, state);
  }
  const rawSafe = finite(raw);
  // Dłoń wyszła z kadru i wróciła w innym ułożeniu: zaczynamy od zera
  // zamiast dokładać zawinięty kąt ±π do poprzedniej sesji.
  if (state.last === null || at - state.at > WRIST_REACQUIRE_MS) {
    state.last = rawSafe;
    state.at = at;
    state.angle = 0;
    return 0;
  }
  let delta = rawSafe - state.last;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  state.last = rawSafe;
  state.at = at;
  // Filtr przeciw szumowi pojedynczej klatki na słabej kamerce.
  if (Math.abs(delta) > 0.002) {
    state.angle = clamp(state.angle + delta, -1.75, 1.75);
  }
  return clampFinite(state.angle, -1.75, 1.75);
}

export function neutralHandPose(): HandPose {
  return {
    curl: Array.from({ length: 5 }, () => [0, 0, 0]),
    spread: [0, 0, 0, 0, 0],
    roll: 0,
    pitch: 0,
    wrist: { x: 0, y: 0, z: 0 },
    yaw: 0,
    presence: 0,
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

function jointAngle(a: THREE.Vector3, b: THREE.Vector3, j: number, thumb: boolean): number {
  const raw = Math.acos(clampFinite(a.dot(b), -1, 1, 1));
  const bias = thumb ? THUMB_BIAS[j] : JOINT_BIAS[j];
  const gain = thumb ? 1 : JOINT_GAIN[j];
  // Lekko ujemny dolny limit pozwala na naturalne, minimalne wyprostowanie.
  return clamp((raw - bias) * gain, -0.07, thumb ? 1.15 : JOINT_MAX[j]);
}

/** Z wektorów między punktami dłoni liczymy kąty dla wszystkich 15 stawów. */
/**
 * `at` jest jawne, żeby testy mogły symulować przerwę w śledzeniu bez
 * czekania na prawdziwy zegar. Produkcja korzysta z domyślnego `performance.now()`.
 */
export function computeHandPose(
  hand: TrackedHand,
  aspect = 4 / 3,
  at = performance.now(),
): HandPose {
  const pose = neutralHandPose();
  if (!validLandmarks(hand?.landmarks, 21, 64) || !Number.isFinite(aspect)) return pose;
  pose.present = true;

  const p = points(hand, aspect);
  const dir = (from: number, to: number): THREE.Vector3 => {
    const v = new THREE.Vector3().subVectors(p[to], p[from]);
    // Zerowy wektor (dwa punkty w tym samym miejscu) nie ma kierunku.
    // normalize() zostawiłby (0,0,0), a acos(dot) zwróciłoby π/2.
    return v.lengthSq() > 1e-12 ? v.normalize() : new THREE.Vector3(0, 1, 0);
  };

  const wrist = p[0];
  const indexBase = new THREE.Vector3().subVectors(p[5], wrist);
  const pinkyBase = new THREE.Vector3().subVectors(p[17], wrist);
  const normal = new THREE.Vector3().crossVectors(indexBase, pinkyBase).normalize();
  if (normal.lengthSq() < 0.5) normal.set(0, 1, 0);

  for (let f = 0; f < 5; f += 1) {
    const chain = CHAINS[f];
    const seg = chain.slice(0, -1).map((_, i) => dir(chain[i], chain[i + 1]));
    for (let j = 0; j < 3; j += 1) {
      pose.curl[f][j] = jointAngle(seg[j], seg[j + 1], j, f === 0);
    }

    // Rozstawienie: kąt między nasadą palca a nasadą palca środkowego,
    // mierzony w płaszczyźnie dłoni (normalna daje znak).
    const base = f === 0 ? dir(1, 2) : dir(0, chain[1]);
    const middle = dir(0, 9);
    const cross = new THREE.Vector3().crossVectors(base, middle);
    const angle = Math.atan2(cross.dot(normal), clamp(base.dot(middle), -1, 1));
    pose.spread[f] = clamp(angle * (f === 0 ? 0.85 : 0.55), -0.55, 0.55);
  }

  // Ścięgno: ostatnie ogniwo nie zgina się niezależnie od środkowego.
  // Koniuszki palców są najbardziej zaszumione, więc 38% kąta bierzemy z PIP.
  for (let f = 0; f < 5; f += 1) {
    const tendon = clamp(pose.curl[f][1] * 0.68, 0, JOINT_MAX[2]);
    pose.curl[f][2] = pose.curl[f][2] * 0.62 + tendon * 0.38;
  }

  // Palce są częściowo sprzężone — bez tego dłoń wygląda jak pięć osobnych
  // manipulatorów. Zachowujemy jednak 88% własnego odczytu (pełne 1:1).
  const measured = pose.curl.map((row) => row.slice());
  for (let f = 1; f < 5; f += 1) {
    for (let j = 0; j < 3; j += 1) {
      const neighbour = f === 1
        ? measured[2][j]
        : measured[f - 1][j] * 0.6 + measured[Math.min(4, f + 1)][j] * 0.4;
      pose.curl[f][j] = clamp(measured[f][j] * 0.88 + neighbour * 0.12, -0.07, JOINT_MAX[j]);
    }
  }

  // Kciuk zgina się inaczej niż reszta — pierwszy staw dostaje odwiedzenie.
  pose.curl[0][0] = clamp(Math.abs(pose.spread[0]) * 0.7, 0, 0.55);

  // Pozycja 3D: cały kadr kamerki → cała przestrzeń przed kamerą.
  // Podgląd jest lustrzany (CSS scaleX(-1)), więc x trzeba odwrócić: dłoń
  // przesunięta w prawo w podglądzie ma trafić w prawo także w grze.
  const w = hand.landmarks[0];
  const middleBase = hand.landmarks[9];
  // Odległość nadgarstek → nasada palca środkowego jest stabilnym przybliżeniem
  // odległości od kamery: im dłoń bliżej, tym większy jest ten wektor. MediaPipe
  // zwraca z względem nadgarstka, więc sam lm.z[0] nie nadaje się do tego celu.
  const palmSpan = Math.hypot((middleBase.x - w.x) * aspect, middleBase.y - w.y);
  pose.wrist = {
    x: clamp((0.5 - w.x) * 2, -1, 1),
    y: clamp((0.5 - w.y) * 2, -1, 1),
    z: clamp((palmSpan - 0.18) / 0.11, -1, 1),
  };
  pose.presence = 1;

  /*
   * Prawdziwy obrót nadgarstka (pronacja / supinacja).
   *
   * `fwd`  = kierunek palców (nadgarstek → nasada palca środkowego),
   * `normal` = prostopadła do dłoni. Gdy wnętrze dłoni patrzy w kamerę,
   * `normal` leży blisko osi Z; przy obrocie nadgarstka wychodzi w bok.
   * Rzutujemy obie osie na płaszczyznę prostopadłą do `fwd` i mierzymy
   * kąt — dzięki temu wynik nie zależy od tego, czy dłoń jest uniesiona,
   * opuszczona albo odchylona w bok.
   */
  const fwd = dir(0, 9);
  const cameraAxis = new THREE.Vector3(0, 0, 1);
  const cPlane = cameraAxis.clone().addScaledVector(fwd, -cameraAxis.dot(fwd));
  if (cPlane.lengthSq() < 1e-4) cPlane.set(0, 1, 0).addScaledVector(fwd, -fwd.y);
  if (cPlane.lengthSq() < 1e-4) cPlane.set(1, 0, 0);
  cPlane.normalize();
  const sidePlane = new THREE.Vector3().crossVectors(fwd, cPlane).normalize();
  const nPlane = normal.clone().addScaledVector(fwd, -normal.dot(fwd));
  if (nPlane.lengthSq() < 1e-4) nPlane.copy(cPlane);
  nPlane.normalize();
  const rawTwist = Math.atan2(nPlane.dot(sidePlane), nPlane.dot(cPlane));
  // Klucz po etykiecie MediaPipe: obie dłonie kalibrują się niezależnie,
  // więc lustrzane odbicie nie wywraca jednej z nich na lewą stronę.
  pose.roll = wristTwist(hand.label ?? 'Left', rawTwist, finite(at, performance.now()));

  // Przechylenie i odchylenie dłoni też bierzemy z osi palców, a nie z
  // palm.y — dzięki temu ruch nadgarstka w przód / tył / na bok jest widoczny.
  pose.pitch = clampFinite(Math.asin(clampFinite(fwd.z, -1, 1)) * 1.15, -1.1, 1.1);
  pose.yaw = clampFinite(Math.atan2(fwd.x, Math.max(0.08, fwd.y)) * 0.85, -1.1, 1.1);
  return pose;
}

/**
 * MediaPipe zakłada obraz lustrzany, a my podajemy surowy kadr z kamery
 * (CSS odwraca tylko podgląd). Trzeba zamienić strony, żeby prawa dłoń
 * użytkownika poruszała prawą dłonią awatara.
 */
export function posesFromHands(hands: TrackedHand[], aspect = 4 / 3): HandPosePair {
  const pair = neutralHandPosePair();
  const score: Record<'L' | 'R', number> = { L: -Infinity, R: -Infinity };
  // Odrzucamy zatrute klatki i rozstrzygamy identyczne etykiety, żeby obie
  // dłonie nie trafiły na ten sam bok awatara (jedna znikała z widoku).
  const clean = disambiguateHandedness(hands ?? []);
  for (const hand of clean) {
    const side: 'L' | 'R' = hand.label === 'Left' ? 'R' : 'L';
    const pose = computeHandPose(hand, aspect);
    if (!pose.present) continue;
    const confidence = finite(hand.score, 0);
    if (!pair[side].present || confidence >= score[side]) {
      pair[side] = pose;
      score[side] = confidence;
    }
  }
  return pair;
}

/** Zwykłe wygładzanie — zostawione dla kodu, który nie potrzebuje sprężyny. */
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
  current.presence += ((target.present ? 1 : 0) - current.presence) * k;
  current.present = target.present;
}

// ---------------------------------------------------------- animacja ruchu dłoni

interface Channel {
  value: number;
  velocity: number;
}

const channel = (): Channel => ({ value: 0, velocity: 0 });

/**
 * Krytycznie tłumiona sprężyna na każdym kanale. W przeciwieństwie do lerp
 * daje opóźnienie przy ruszaniu i leciutkie „dociągnięcie” przy zatrzymaniu,
 * czyli to, co widać w prawdziwej dłoni. Nie alokuje nic w pętli klatek.
 */
export class HandAnimator {
  readonly pose: HandPose = neutralHandPose();

  private readonly curlV: Channel[][] = Array.from({ length: 5 }, () => [channel(), channel(), channel()]);
  private readonly spreadV: Channel[] = Array.from({ length: 5 }, channel);
  private readonly rollV = channel();
  private readonly pitchV = channel();
  private readonly yawV = channel();
  private readonly wristV = { x: channel(), y: channel(), z: channel() };
  private readonly presenceV = channel();
  private readonly rest = neutralHandPose();
  private readonly tracked = neutralHandPose();

  private readonly options: { idle?: boolean };

  constructor(options: { idle?: boolean } = {}) {
    this.options = options;
  }

  /**
   * Bezwarunkowo stabilne tłumienie (formuła SmoothDamp). Zwykła integracja
   * sprężyny `v += (k·(target−x) − c·v)·dt` rozjeżdża się przy dt ≈ 50 ms,
   * bo mianownik `2·ζ·ω·dt` przekracza 1 — palce „wybuchały” do limitów.
   * Zaciskanie jest trochę szybsze niż prostowanie, jak w prawdziwej dłoni.
   */
  private integrate(c: Channel, target: number, dt: number, smoothTime: number): number {
    const want = finite(target, c.value);
    // Jedna zatruta klatka nie może na zawsze zepsuć kanału: przywracamy
    // stan z aktualnego celu i zerujemy prędkość zamiast mnożyć NaN dalej.
    if (!Number.isFinite(c.value) || !Number.isFinite(c.velocity)) {
      c.value = want;
      c.velocity = 0;
      return want;
    }
    const omega = 2 / Math.max(0.01, want > c.value ? smoothTime * 0.84 : smoothTime);
    const x = omega * dt;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = c.value - want;
    const temp = (c.velocity + omega * change) * dt;
    c.velocity = (c.velocity - omega * temp) * decay;
    c.value = clampFinite(want + (change + temp) * decay, -3, 3, want);
    return c.value;
  }

  /** Spoczynek: chwyt narzędzia + bardzo drobny, niesynchroniczny ruch. */
  private makeRest(motion?: HandMotion): HandPose {
    const r = this.rest;
    const idle = motion && this.options.idle ? 1 : 0;
    const time = motion?.time ?? 0;
    const grip = motion?.grip ?? 0;
    const side = motion?.side === 'L' ? 0 : 2.1;
    for (let f = 0; f < 5; f += 1) {
      const phase = f * 1.63 + side;
      for (let j = 0; j < 3; j += 1) {
        const tremor = Math.sin(time * (1.05 + f * 0.19) + phase + j * 0.85)
          * (0.013 + j * 0.005) * idle;
        r.curl[f][j] = clamp(
          GRIP_CURL[f][j] * grip + tremor + (motion?.sprint ?? 0) * 0.11,
          0, JOINT_MAX[j],
        );
      }
      r.spread[f] = GRIP_SPREAD[f] * grip;
    }
    // Wciskanie przycisku: wskazujący się prostuje, reszta trzyma narzędzie.
    const scan = motion?.scan ?? 0;
    if (scan > 0) {
      r.curl[1][0] = Math.max(0, r.curl[1][0] - 0.14 * scan);
      r.curl[1][1] = Math.max(0, r.curl[1][1] - 0.52 * scan);
      r.curl[1][2] = Math.max(0, r.curl[1][2] - 0.34 * scan);
    }
    r.roll = Math.sin(time * 0.61 + side) * 0.022 * idle;
    r.pitch = Math.sin(time * 0.47 + side * 1.7) * 0.014 * idle;
    r.yaw = Math.sin(time * 0.39 + side) * 0.018 * idle;
    r.wrist.x = Math.sin(time * 0.53 + side) * 0.012 * idle;
    r.wrist.y = Math.sin(time * 0.87 + side * 1.3) * 0.011 * idle;
    r.wrist.z = Math.sin(time * 0.41 + side) * 0.008 * idle;
    r.presence = 0;
    r.present = false;
    return r;
  }

  /**
   * Zwraca wygładzoną pozę. Gdy dłoń znika z kadru, sprężyna sama przechodzi
   * do chwytu spoczynkowego — nie ma już „skoku” do płasko otwartej dłoni.
   */
  step(target: HandPose, dt: number, motion?: HandMotion): HandPose {
    const d = Math.min(Math.max(finite(dt, 1 / 60), 0.001), 0.05);
    let t: HandPose;
    if (target.present) {
      // Fizjologiczne mikro-drżenie nałożone na prawdziwy odczyt (bardzo małe,
      // żeby nie zepsuć odwzorowania 1:1).
      const tr = this.tracked;
      const idle = motion && this.options.idle ? 1 : 0;
      const time = motion?.time ?? 0;
      for (let f = 0; f < 5; f += 1) {
        for (let j = 0; j < 3; j += 1) {
          const tremor = Math.sin(time * (7.3 + f * 0.6) + f * 1.9 + j) * 0.004 * idle;
          tr.curl[f][j] = clampFinite(target.curl[f][j] + tremor, -0.07, JOINT_MAX[j]);
        }
        tr.spread[f] = target.spread[f];
      }
      tr.roll = target.roll;
      tr.pitch = target.pitch;
      tr.yaw = target.yaw;
      tr.wrist.x = target.wrist.x;
      tr.wrist.y = target.wrist.y;
      tr.wrist.z = target.wrist.z;
      t = tr;
    } else {
      t = this.makeRest(motion);
    }

    const out = this.pose;
    for (let f = 0; f < 5; f += 1) {
      for (let j = 0; j < 3; j += 1) {
        out.curl[f][j] = clamp(this.integrate(this.curlV[f][j], t.curl[f][j], d, 0.085), -0.09, JOINT_MAX[j]);
      }
      out.spread[f] = this.integrate(this.spreadV[f], t.spread[f], d, 0.11);
    }
    out.roll = this.integrate(this.rollV, t.roll, d, 0.15);
    out.pitch = this.integrate(this.pitchV, t.pitch, d, 0.15);
    out.yaw = this.integrate(this.yawV, t.yaw, d, 0.16);
    // Adaptacyjne wygładzanie pozycji: gdy dłoń jedzie szybko, tłumienie
    // maleje (brak „gumy” i opóźnienia przy ruchu w lewo/prawo); gdy stoi,
    // rośnie i wycina szum detekcji. Dzięki temu ruch jest jednocześnie 1:1
    // i stabilny — bez stałego kompromisu między lagiem a drżeniem.
    const speed = Math.hypot(
      t.wrist.x - out.wrist.x,
      t.wrist.y - out.wrist.y,
      (t.wrist.z - out.wrist.z) * 0.5,
    ) / d;
    const wristTime = clamp(0.10 - speed * 0.020, 0.032, 0.10) / wristResponsiveness;
    out.wrist.x = this.integrate(this.wristV.x, t.wrist.x, d, wristTime);
    out.wrist.y = this.integrate(this.wristV.y, t.wrist.y, d, wristTime);
    out.wrist.z = this.integrate(this.wristV.z, t.wrist.z, d, wristTime * 1.35);
    out.presence = clamp(this.integrate(this.presenceV, target.present ? 1 : 0, d, 0.13), 0, 1);
    out.present = target.present;
    return out;
  }
}
