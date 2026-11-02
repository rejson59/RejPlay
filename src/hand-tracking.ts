/**
 * Przechwytywanie dłoni z kamerki (MediaPipe Hands, assets lokalne).
 *
 * To NIE jest wirtualny tryb kamery/aparatu i NIE jest to klasyfikator gestów.
 * Kamerka dostarcza 21 punktów 3D na każdą dłoń; te punkty trafiają bezpośrednio
 * na kości palców awatara (src/hand-pose.ts). Nic nie jest nagrywane ani
 * wysyłane — `getUserMedia` działa lokalnie, model leży w public/mediapipe/.
 */

import type { NormalizedLandmark, TrackedHand } from './hand-pose';

const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

const HAND_COLORS = ['rgba(200, 160, 106, 0.9)', 'rgba(126, 174, 178, 0.9)'];

interface Handedness {
  label?: string;
  score?: number;
  index?: number;
}

interface HandsResults {
  multiHandLandmarks?: NormalizedLandmark[][];
  multiHandedness?: Handedness[];
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
  /** Surowy odczyt obu dłoni + proporcje kadru (do poprawienia skali z). */
  onFrame?: (hands: TrackedHand[], aspect: number) => void;
  onStatus?: (message: string, kind: 'info' | 'error') => void;
}

export class HandTracker {
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly onFrame: HandTrackerOptions['onFrame'];
  private readonly onStatus: HandTrackerOptions['onStatus'];

  private hands: HandsSolution | null = null;
  private stream: MediaStream | null = null;
  private frame = 0;
  private sending = false;
  private running = false;

  constructor(options: HandTrackerOptions) {
    this.video = options.video;
    this.canvas = options.canvas;
    this.context = options.canvas.getContext('2d')!;
    this.onFrame = options.onFrame;
    this.onStatus = options.onStatus;
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
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    hands.onResults((results) => this.handleResults(results));
    this.hands = hands;
    this.running = true;
    this.status('Kamerka działa. Pokaż dłonie w kadrze — palce odwzorowują się 1:1.');
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
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    const aspect = w / Math.max(h, 1);
    const landmarks = results.multiHandLandmarks ?? [];
    const tracked: TrackedHand[] = [];

    landmarks.forEach((hand, i) => {
      const color = HAND_COLORS[i % HAND_COLORS.length];
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      for (const [a, b] of CONNECTIONS) {
        ctx.beginPath();
        ctx.moveTo(hand[a].x * w, hand[a].y * h);
        ctx.lineTo(hand[b].x * w, hand[b].y * h);
        ctx.stroke();
      }
      ctx.fillStyle = i === 0 ? '#e4c99e' : '#a8d0d2';
      for (let p = 0; p < hand.length; p += 1) {
        ctx.beginPath();
        // Koniuszki palców wyróżnione — to je śledzimy najdokładniej.
        ctx.arc(hand[p].x * w, hand[p].y * h, p % 4 === 0 && p > 0 ? 4.2 : 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      const raw = results.multiHandedness?.[i];
      tracked.push({
        label: raw?.label === 'Right' ? 'Right' : 'Left',
        score: raw?.score ?? 1,
        landmarks: hand,
      });
    });

    this.onFrame?.(tracked, aspect);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    if (this.hands) void this.hands.close().catch(() => undefined);
    this.hands = null;
    this.sending = false;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.onFrame?.([], this.canvas.width / Math.max(this.canvas.height, 1));
  }
}
