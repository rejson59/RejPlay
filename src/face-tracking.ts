/**
 * Śledzenie twarzy, głowy i źrenic (MediaPipe FaceMesh, assets lokalne).
 *
 * 468 punktów twarzy + 10 punktów tęczówek (refineLandmarks). Z nich liczymy:
 *  - przechył głowy przód / tył (pitch) → ruch postaci,
 *  - przechył na bok (roll) → strafowanie,
 *  - obrót głowy (yaw) → wspomaganie rozglądania,
 *  - pozycję źrenicy względem kącików oka → ultra-precyzyjna kamera,
 *  - mrugnięcie (do testu kalibracji).
 *
 * Nic nie jest nagrywane ani wysyłane: kadr zostaje w przeglądarce, a model
 * leży w public/mediapipe/face/. Strumień kamery jest współdzielony z Hands —
 * nie prosimy o zgodę na kamerę dwa razy.
 */

import type { NormalizedLandmark } from './hand-pose';
import { lowPowerDevice } from './performance';

export interface FaceFrame {
  present: boolean;
  /** Obrót głowy wokół osi pionowej (ok. −0.5..0.5). */
  yaw: number;
  /** Kiwnięcie: + = głowa w dół / w przód, − = głowa do tyłu. */
  pitch: number;
  /** Przechył na bok w radianach. */
  roll: number;
  /** Spojrzenie: +x = w prawo, +y = w dół, skala ok. −1..1. */
  gazeX: number;
  gazeY: number;
  /** 0 = oko otwarte, 1 = zamknięte. */
  blink: number;
  /** Czy model zwrócił punkty tęczówek (refineLandmarks). */
  iris: boolean;
  landmarks: NormalizedLandmark[];
}

export const EMPTY_FACE: FaceFrame = {
  present: false, yaw: 0, pitch: 0, roll: 0, gazeX: 0, gazeY: 0,
  blink: 0, iris: false, landmarks: [],
};

interface FaceResults {
  multiFaceLandmarks?: NormalizedLandmark[][];
}

interface FaceMeshSolution {
  setOptions(options: Record<string, number | boolean>): void;
  onResults(callback: (results: FaceResults) => void): void;
  send(input: { image: HTMLVideoElement }): Promise<void>;
  close(): Promise<void>;
}

type FaceMeshConstructor = new (config: {
  locateFile: (file: string) => string;
}) => FaceMeshSolution;

declare global {
  interface Window {
    FaceMesh?: FaceMeshConstructor;
  }
}

const MP_FACE = `${import.meta.env.BASE_URL}mediapipe/face/`;

async function loadFaceMesh(): Promise<FaceMeshConstructor> {
  if (window.FaceMesh) return window.FaceMesh;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${MP_FACE}face_mesh.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Nie udało się wczytać modelu twarzy.'));
    document.head.appendChild(script);
  });
  if (!window.FaceMesh) throw new Error('Biblioteka śledzenia twarzy nie jest dostępna.');
  return window.FaceMesh;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const dist = (a: NormalizedLandmark, b: NormalizedLandmark): number =>
  Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.4);

/** Średni punkt z listy indeksów (odporny na pojedynczy szum). */
function centroid(lm: NormalizedLandmark[], indices: number[]): NormalizedLandmark {
  let x = 0, y = 0, z = 0;
  for (const i of indices) {
    x += lm[i].x; y += lm[i].y; z += lm[i].z;
  }
  const n = indices.length || 1;
  return { x: x / n, y: y / n, z: z / n };
}

/** Jedna klatka → sygnały kalibracyjne. Wszystko względne, bez stałych znaków. */
export function faceFrameFromLandmarks(lm: NormalizedLandmark[] | undefined): FaceFrame {
  if (!lm || lm.length < 468) return { ...EMPTY_FACE };
  const nose = lm[1];
  const forehead = lm[10];
  const chin = lm[152];
  const leftEar = lm[234];
  const rightEar = lm[454];
  const eyeSpan = Math.max(0.02, rightEar.x - leftEar.x);
  const faceSpan = Math.max(0.02, chin.y - forehead.y);
  const eyeCenterX = (leftEar.x + rightEar.x) / 2;

  const yaw = clamp((nose.x - eyeCenterX) / eyeSpan, -1, 1);
  const pitch = clamp((nose.y - (forehead.y + chin.y) / 2) / faceSpan, -1, 1);
  const roll = clamp(Math.atan2(rightEar.y - leftEar.y, rightEar.x - leftEar.x), -1, 1);

  // Kąciki oczu: 33/133 (lewe), 362/263 (prawe). Gdyby indeks 362 leżał
  // po niewłaściwej stronie, szerokość bierzemy z wartości bezwzględnej.
  const leftInner = lm[133], leftOuter = lm[33];
  const rightInner = lm[263], rightOuter = lm[362];
  const hasIris = lm.length >= 478;
  let gazeX = 0;
  let gazeY = 0;
  let blink = 0;

  if (hasIris) {
    const leftIris = centroid(lm, [468, 469, 470, 471]);
    const rightIris = centroid(lm, [473, 474, 475, 476]);
    const lx = (leftIris.x - (leftOuter.x + leftInner.x) / 2) / Math.max(0.006, Math.abs(leftInner.x - leftOuter.x));
    const rx = (rightIris.x - (rightOuter.x + rightInner.x) / 2) / Math.max(0.006, Math.abs(rightInner.x - rightOuter.x));
    const ly = (leftIris.y - (lm[159].y + lm[145].y) / 2) / Math.max(0.004, Math.abs(lm[145].y - lm[159].y));
    const ry = (rightIris.y - (lm[386].y + lm[374].y) / 2) / Math.max(0.004, Math.abs(lm[374].y - lm[386].y));
    gazeX = clamp(((lx + rx) / 2) * 1.9, -1.6, 1.6);
    gazeY = clamp(((ly + ry) / 2) * 1.9, -1.6, 1.6);
  }

  const leftOpen = dist(lm[159], lm[145]) / Math.max(0.006, dist(lm[33], lm[133]));
  const rightOpen = dist(lm[386], lm[374]) / Math.max(0.006, dist(lm[362], lm[263]));
  blink = clamp(1 - ((leftOpen + rightOpen) / 2) / 0.32, 0, 1);

  return { present: true, yaw, pitch, roll, gazeX, gazeY, blink, iris: hasIris, landmarks: lm };
}

export interface FaceTrackerOptions {
  video: HTMLVideoElement;
  /** Opcjonalny canvas z obrysem twarzy / źrenic (tylko laboratorium). */
  canvas?: HTMLCanvasElement;
  onFrame?: (frame: FaceFrame) => void;
  onStatus?: (message: string, kind: 'info' | 'error') => void;
}

export class FaceTracker {
  private readonly video: HTMLVideoElement;
  private readonly canvas?: HTMLCanvasElement;
  private readonly context?: CanvasRenderingContext2D;
  private readonly onFrame: FaceTrackerOptions['onFrame'];
  private readonly onStatus: FaceTrackerOptions['onStatus'];
  private solution: FaceMeshSolution | null = null;
  private running = false;
  private sending = false;
  private frameId = 0;
  private lastSend = 0;
  private readonly lowPower = lowPowerDevice();
  private drawEnabled = true;

  constructor(options: FaceTrackerOptions) {
    this.video = options.video;
    this.canvas = options.canvas;
    this.context = options.canvas?.getContext('2d') ?? undefined;
    this.onFrame = options.onFrame;
    this.onStatus = options.onStatus;
  }

  /** W grze nie rysujemy obrysu twarzy (jest tylko w laboratorium). */
  setDrawEnabled(enabled: boolean): void {
    this.drawEnabled = enabled;
    if (!enabled) this.context?.clearRect(0, 0, this.canvas?.width ?? 0, this.canvas?.height ?? 0);
  }

  private status(message: string, kind: 'info' | 'error' = 'info'): void {
    this.onStatus?.(message, kind);
  }

  /** Używa istniejącego strumienia wideo — nie woła getUserMedia. */
  async start(): Promise<void> {
    if (this.running) return;
    this.status('Wczytuję model głowy i oczu…');
    const FaceMesh = await loadFaceMesh();
    const solution = new FaceMesh({ locateFile: (file) => `${MP_FACE}${file}` });
    solution.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true, // 10 punktów tęczówki na oko → eyes tracking
      minDetectionConfidence: 0.55,
      minTrackingConfidence: 0.55,
      selfieMode: true,
    });
    solution.onResults((results) => this.handle(results));
    this.solution = solution;
    this.running = true;
    this.status('Głowa i oczy wykrywane. Wykonaj testy w laboratorium.');
    this.frameId = requestAnimationFrame(() => void this.tick());
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    const now = performance.now();
    const minGap = 1000 / (this.lowPower ? 12 : 20);
    if (this.solution && this.video.readyState >= 2 && !this.sending && now - this.lastSend >= minGap) {
      this.lastSend = now;
      this.sending = true;
      try {
        await this.solution.send({ image: this.video });
      } catch (error) {
        this.status(`Błąd odczytu twarzy: ${String(error)}`, 'error');
      } finally {
        this.sending = false;
      }
    }
    if (this.running) this.frameId = requestAnimationFrame(() => void this.tick());
  }

  private handle(results: FaceResults): void {
    const frame = faceFrameFromLandmarks(results.multiFaceLandmarks?.[0]);
    if (frame.present && this.context && this.canvas && this.drawEnabled) this.draw(frame);
    this.onFrame?.(frame);
  }

  private draw(frame: FaceFrame): void {
    const ctx = this.context!;
    const w = this.canvas!.width;
    const h = this.canvas!.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(126, 174, 178, 0.75)';
    ctx.lineWidth = 1;
    const outline = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10];
    ctx.beginPath();
    outline.forEach((i, n) => {
      const x = frame.landmarks[i].x * w;
      const y = frame.landmarks[i].y * h;
      if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    if (frame.iris) {
      ctx.fillStyle = '#e4c99e';
      for (const set of [[468, 469, 470, 471, 472], [473, 474, 475, 476, 477]]) {
        const c = centroid(frame.landmarks, set);
        ctx.beginPath();
        ctx.arc(c.x * w, c.y * h, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(228, 201, 158, 0.9)';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(`głowa ${frame.pitch >= 0 ? '+' : ''}${frame.pitch.toFixed(2)} · wzrok ${frame.gazeX >= 0 ? '+' : ''}${frame.gazeX.toFixed(2)}`, 8, h - 10);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
    if (this.solution) void this.solution.close().catch(() => undefined);
    this.solution = null;
    this.sending = false;
    this.context?.clearRect(0, 0, this.canvas?.width ?? 0, this.canvas?.height ?? 0);
    this.onFrame?.({ ...EMPTY_FACE });
  }
}
