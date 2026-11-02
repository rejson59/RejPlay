/**
 * Przechwytywanie dłoni z kamerki (MediaPipe Hands, assets lokalne).
 *
 * To NIE jest wirtualny tryb kamery/aparatu: obraz z kamery służy wyłącznie do
 * wykrycia 21 punktów dłoni i rozpoznania gestu, który odtwarza animację na
 * awatarze. Nic nie jest nagrywane ani wysyłane — `getUserMedia` działa
 * lokalnie w przeglądarce, a pliki modelu leżą w `public/mediapipe/`.
 */

export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
}

export interface Gesture {
  id: 'none' | 'open' | 'fist' | 'point' | 'peace' | 'thumb';
  label: string;
  clip: string;
}

const GESTURES: Record<Gesture['id'], Gesture> = {
  none: { id: 'none', label: 'Pokaż dłoń', clip: '' },
  open: { id: 'open', label: 'Otwarta dłoń · machnięcie', clip: 'wave' },
  fist: { id: 'fist', label: 'Pięść · stuknięcie', clip: 'knock' },
  point: { id: 'point', label: 'Wskazanie · sięgnięcie', clip: 'door_try' },
  peace: { id: 'peace', label: 'Dwa palce · rozmowa', clip: 'talk-loop' },
  thumb: { id: 'thumb', label: 'Kciuk w górę · rozejrzenie', clip: 'idle_look-loop' },
};

const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

function distance(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Klasyfikacja oparta na odległości końców palców od nadgarstka — działa
 * niezależnie od obrotu i odbicia obrazu z kamerki. Eksportowana osobno,
 * żeby można było przetestować ją bez kamery.
 */
export function classifyGesture(landmarks: NormalizedLandmark[]): Gesture {
  if (!landmarks || landmarks.length < 21) return GESTURES.none;
  const wrist = landmarks[0];
  const fingers = [
    { tip: 8, pip: 6 },
    { tip: 12, pip: 10 },
    { tip: 16, pip: 14 },
    { tip: 20, pip: 18 },
  ];
  const extended = fingers.map(
    (finger) =>
      distance(landmarks[finger.tip], wrist) > distance(landmarks[finger.pip], wrist) + 0.025,
  );
  const thumb =
    distance(landmarks[4], landmarks[17]) > distance(landmarks[3], landmarks[17]) + 0.018;
  const count = extended.filter(Boolean).length;

  if (count === 4 && thumb) return GESTURES.open;
  if (count === 0 && thumb) return GESTURES.thumb;
  if (count === 0) return GESTURES.fist;
  if (count === 1 && extended[0]) return GESTURES.point;
  if (count === 2 && extended[0] && extended[1]) return GESTURES.peace;
  return GESTURES.none;
}

interface HandsResults {
  multiHandLandmarks?: NormalizedLandmark[][];
}

interface HandsSolution {
  setOptions(options: Record<string, number | boolean>): void;
  onResults(callback: (results: HandsResults) => void): void;
  send(input: { image: HTMLVideoElement }): Promise<void>;
  close(): Promise<void>;
}

type HandsConstructor = new (config: {
  locateFile: (file: string) => string;
}) => HandsSolution;

declare global {
  interface Window {
    Hands?: HandsConstructor;
  }
}

async function loadHands(): Promise<HandsConstructor> {
  if (window.Hands) return window.Hands;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/mediapipe/hands.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Nie udało się wczytać modelu wykrywania dłoni.'));
    document.head.appendChild(script);
  });
  if (!window.Hands) throw new Error('Biblioteka wykrywania dłoni nie jest dostępna.');
  return window.Hands;
}

export interface HandTrackerOptions {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  onGesture?: (gesture: Gesture) => void;
  onStatus?: (message: string, kind: 'info' | 'error') => void;
  /** Minimalny odstęp między dwiema animacjami wywołanymi gestem (ms). */
  cooldownMs?: number;
}

export class HandTracker {
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly onGesture: HandTrackerOptions['onGesture'];
  private readonly onStatus: HandTrackerOptions['onStatus'];
  private readonly cooldownMs: number;

  private hands: HandsSolution | null = null;
  private stream: MediaStream | null = null;
  private frame = 0;
  private sending = false;
  private running = false;
  private lastGestureId: Gesture['id'] = 'none';
  private lastEmoteAt = 0;

  constructor(options: HandTrackerOptions) {
    this.video = options.video;
    this.canvas = options.canvas;
    this.context = options.canvas.getContext('2d')!;
    this.onGesture = options.onGesture;
    this.onStatus = options.onStatus;
    this.cooldownMs = options.cooldownMs ?? 1400;
  }

  get active(): boolean {
    return this.running;
  }

  private status(message: string, kind: 'info' | 'error' = 'info'): void {
    this.onStatus?.(message, kind);
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Kamerka wymaga bezpiecznego połączenia (HTTPS) i zgody przeglądarki.');
    }
    this.status('Czekam na zgodę na kamerę…');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.canvas.width = this.video.videoWidth || 640;
    this.canvas.height = this.video.videoHeight || 480;

    this.status('Wczytuję model wykrywania dłoni…');
    const Hands = await loadHands();
    const hands = new Hands({ locateFile: (file) => `/mediapipe/${file}` });
    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.55,
    });
    hands.onResults((results) => this.handleResults(results));
    this.hands = hands;
    this.running = true;
    this.lastGestureId = 'none';
    this.status('Kamerka działa. Pokaż dłoń w kadrze.');
    this.frame = requestAnimationFrame(() => void this.tick());
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    if (this.hands && this.video.readyState >= 2 && !this.sending) {
      this.sending = true;
      try {
        await this.hands.send({ image: this.video });
      } catch (error) {
        this.status(`Błąd odczytu klatki: ${String(error)}`, 'error');
      } finally {
        this.sending = false;
      }
    }
    if (this.running) this.frame = requestAnimationFrame(() => void this.tick());
  }

  private handleResults(results: HandsResults): void {
    const ctx = this.context;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const hand = results.multiHandLandmarks?.[0];
    if (!hand) {
      this.lastGestureId = 'none';
      this.onGesture?.(GESTURES.none);
      return;
    }

    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(200, 160, 106, 0.85)';
    for (const [a, b] of CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(hand[a].x * w, hand[a].y * h);
      ctx.lineTo(hand[b].x * w, hand[b].y * h);
      ctx.stroke();
    }
    ctx.fillStyle = '#e4c99e';
    for (const point of hand) {
      ctx.beginPath();
      ctx.arc(point.x * w, point.y * h, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    const gesture = classifyGesture(hand);
    this.onGesture?.(gesture);
    const now = performance.now();
    if (
      gesture.id !== 'none' &&
      gesture.id !== this.lastGestureId &&
      now - this.lastEmoteAt > this.cooldownMs
    ) {
      this.lastEmoteAt = now;
      this.onEmote?.(gesture);
    }
    this.lastGestureId = gesture.id;
  }

  /** Ustawiane z zewnątrz: wywołanie animacji tylko przy zmianie gestu. */
  onEmote?: (gesture: Gesture) => void;

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    if (this.hands) void this.hands.close().catch(() => undefined);
    this.hands = null;
    this.sending = false;
    this.lastGestureId = 'none';
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
