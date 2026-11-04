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
 * v0.6.1 — IZOLACJA MODELU.
 * Hands i FaceMesh to dwa zminifikowane bundle Emscripten. W jednym dokumencie
 * nadpisują sobie globalne `var` (nie tylko `createMediapipeSolutionsWasm`),
 * przez co WASM drugiego z nich nie wstaje: `hands.send()` rzuca
 * "Cannot read properties of undefined (reading 'buffer')", a głowa i oczy
 * nie są wykrywane. FaceMesh działa więc w ukrytym, same-origin iframe
 * (public/mediapipe/face/bridge.html), a rodzic przesyła mu TYLKO kolejne,
 * pomniejszone klatki jako ImageBitmap. Nic nie jest nagrywane ani wysyłane —
 * kadr zostaje w przeglądarce, a strumień jest współdzielony z Hands.
 */

import type { NormalizedLandmark } from './hand-pose';
import { diagnostics } from './diagnostics';
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

export interface FaceTrackerDiagnostics {
  isolated: boolean;
  ready: boolean;
  framesSent: number;
  results: number;
  faces: number;
  irisFrames: number;
  frameWidth: number;
  frameHeight: number;
  refineLandmarks: boolean;
  lastError: string | null;
}

const MP_FACE = `${import.meta.env.BASE_URL}mediapipe/face/`;
const TAG_CHILD = '__rejplayFace';
const TAG_PARENT = '__rejplayFaceParent';

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

  const leftInner = lm[133], leftOuter = lm[33];
  const rightInner = lm[263], rightOuter = lm[362];
  const hasIris = lm.length >= 478;
  let gazeX = 0;
  let gazeY = 0;

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
  const blink = clamp(1 - ((leftOpen + rightOpen) / 2) / 0.32, 0, 1);

  return { present: true, yaw, pitch, roll, gazeX, gazeY, blink, iris: hasIris, landmarks: lm };
}

interface BridgeMessage {
  tag?: string;
  type?: string;
  payload?: {
    data?: Float32Array;
    count?: number;
    frames?: number;
    results?: number;
    faces?: number;
    iris?: number;
    message?: string;
    hasModel?: boolean;
    lastError?: string;
  };
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

  private iframe: HTMLIFrameElement | null = null;
  private frameCanvas: HTMLCanvasElement | null = null;
  private frameCtx: CanvasRenderingContext2D | null = null;
  private running = false;
  private ready = false;
  private sending = false;
  private frameId = 0;
  private lastSend = 0;
  private seq = 0;
  private readonly lowPower = lowPowerDevice();
  private drawEnabled = true;
  private readonly refineLandmarks = true;
  private lastError: string | null = null;
  private stats = { frames: 0, results: 0, faces: 0, iris: 0 };
  private lastStatusAt = 0;
  private firstFaceLogged = false;

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

  diagnostics(): FaceTrackerDiagnostics {
    return {
      isolated: !!this.iframe,
      ready: this.ready,
      framesSent: this.seq,
      results: this.stats.results,
      faces: this.stats.faces,
      irisFrames: this.stats.iris,
      frameWidth: this.frameCanvas?.width ?? 0,
      frameHeight: this.frameCanvas?.height ?? 0,
      refineLandmarks: this.refineLandmarks,
      lastError: this.lastError,
    };
  }

  private status(message: string, kind: 'info' | 'error' = 'info'): void {
    diagnostics.push(kind === 'error' ? 'error' : 'info', 'face', message);
    this.onStatus?.(message, kind);
  }

  private post(type: string, payload: Record<string, unknown> = {}, transfer: Transferable[] = []): void {
    const win = this.iframe?.contentWindow;
    if (!win) return;
    win.postMessage({ tag: TAG_PARENT, type, ...payload }, location.origin, transfer);
  }

  private readonly onMessage = (event: MessageEvent<BridgeMessage>): void => {
    if (event.origin !== location.origin || event.data?.tag !== TAG_CHILD) return;
    if (this.iframe && event.source !== this.iframe.contentWindow) return;
    const msg = event.data;
    const payload = msg.payload ?? {};
    switch (msg.type) {
      case 'loaded':
        if (payload.hasModel === false) {
          this.lastError = 'face_mesh.js nie wczytał się w izolowanym dokumencie';
          this.status(`Głowa i oczy: ${this.lastError}`, 'error');
        }
        break;
      case 'ready':
        this.ready = true;
        this.lastError = null;
        this.status('Model głowy i oczu gotowy (izolowany, bez konfliktu z dłońmi).');
        break;
      case 'error':
        this.lastError = payload.message ?? 'nieznany błąd modelu twarzy';
        this.status(`Głowa i oczy: ${this.lastError}`, 'error');
        break;
      case 'landmarks': {
        const flat = payload.data;
        const count = payload.count ?? 0;
        this.stats.frames = payload.frames ?? this.stats.frames;
        this.stats.results = payload.results ?? this.stats.results;
        this.stats.faces = payload.faces ?? this.stats.faces;
        this.stats.iris = payload.iris ?? this.stats.iris;
        if (!flat || count < 468) return;
        const lm: NormalizedLandmark[] = new Array(count);
        for (let i = 0; i < count; i += 1) {
          lm[i] = { x: flat[i * 3], y: flat[i * 3 + 1], z: flat[i * 3 + 2] };
        }
        if (!this.firstFaceLogged && this.stats.faces > 0) {
          this.firstFaceLogged = true;
          diagnostics.push('info', 'face', `Pierwsza twarz wykryta po ${this.seq} klatkach · punktów ${count} · źrenice ${count >= 478 ? 'tak' : 'nie'}.`);
        }
        this.handle(faceFrameFromLandmarks(lm));
        break;
      }
      case 'empty':
        this.stats.frames = payload.frames ?? this.stats.frames;
        this.stats.results = payload.results ?? this.stats.results;
        this.handle({ ...EMPTY_FACE });
        break;
      case 'idle':
        this.stats.frames = payload.frames ?? this.stats.frames;
        this.stats.results = payload.results ?? this.stats.results;
        this.stats.faces = payload.faces ?? this.stats.faces;
        this.stats.iris = payload.iris ?? this.stats.iris;
        break;
      case 'stats':
        this.stats.frames = payload.frames ?? this.stats.frames;
        this.stats.results = payload.results ?? this.stats.results;
        this.stats.faces = payload.faces ?? this.stats.faces;
        this.stats.iris = payload.iris ?? this.stats.iris;
        break;
      default:
        break;
    }
  };

  /** Używa istniejącego strumienia wideo — nie woła getUserMedia. */
  async start(): Promise<void> {
    if (this.running) return;
    this.status('Wczytuję izolowany model głowy i oczu…');
    this.lastError = null;
    this.seq = 0;
    this.stats = { frames: 0, results: 0, faces: 0, iris: 0 };
    this.firstFaceLogged = false;

    // Słabsza kamerka: mniejszy kadr wejściowy = mniej pracy WASM i mniej
    // odrzuconych klatek. Przy zwykłym sprzęcie 480×360, na niskim 320×240.
    const width = this.lowPower ? 320 : 480;
    const height = this.lowPower ? 240 : 360;
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = width;
    frameCanvas.height = height;
    this.frameCanvas = frameCanvas;
    this.frameCtx = frameCanvas.getContext('2d', { alpha: false, willReadFrequently: false });

    window.addEventListener('message', this.onMessage);
    const iframe = document.createElement('iframe');
    iframe.title = 'RejPlay · model twarzy';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('tabindex', '-1');
    // Nie display:none — ukryty iframe nadal musi móc stworzyć kontekst WebGL.
    Object.assign(iframe.style, {
      position: 'fixed', left: '-10000px', top: '0', width: '2px', height: '2px',
      opacity: '0', border: '0', pointerEvents: 'none',
    });
    iframe.src = `${MP_FACE}bridge.html`;
    this.iframe = iframe;

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Model twarzy nie odpowiedział w ciągu 20 s.')), 20000);
      iframe.onload = () => { window.clearTimeout(timer); resolve(); };
      iframe.onerror = () => { window.clearTimeout(timer); reject(new Error('Nie udało się otworzyć izolowanego modelu twarzy.')); };
      document.body.appendChild(iframe);
    });

    // Niższe progi pewności niż w v0.6: na słabej kamerce 0,55 odrzucało
    // niemal każdą twarz, więc głowa i oczy „nie chciały się wykrywać”.
    this.post('init', {
      options: {
        refineLandmarks: this.refineLandmarks,
        minDetectionConfidence: 0.3,
        minTrackingConfidence: 0.3,
      },
    });
    this.running = true;
    this.lastSend = performance.now();
    this.frameId = requestAnimationFrame(() => void this.tick());
    // Watchdog: jeśli iframe wczytał się, ale model nie odpowiedział,
    // użytkownik dostaje czytelny błąd zamiast wiecznego „wczytuję…".
    window.setTimeout(() => {
      if (!this.running || this.ready || this.lastError) return;
      this.lastError = 'model twarzy nie odpowiedział z izolowanego dokumentu';
      this.status(
        `Głowa i oczy: ${this.lastError}. Naciśnij „Restart kamerki" i wyślij „Kopiuj logi".`,
        'error',
      );
    }, 14000);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    const now = performance.now();
    // Backpressure w iframe sam odrzuca klatki, ale nie zarzucamy go ponad miarę.
    const minGap = 1000 / (this.lowPower ? 10 : 16);
    const videoOk = this.video.readyState >= 2 && this.video.videoWidth > 0 && this.video.videoHeight > 0;
    if (this.ready && this.frameCtx && this.frameCanvas && !this.sending && videoOk && now - this.lastSend >= minGap) {
      this.sending = true;
      this.lastSend = now;
      try {
        const { width, height } = this.frameCanvas;
        this.frameCtx.drawImage(this.video, 0, 0, width, height);
        if (typeof createImageBitmap === 'function') {
          const bitmap = await createImageBitmap(this.frameCanvas);
          this.post('frame', { bitmap, seq: ++this.seq }, [bitmap]);
        } else {
          // Safari / starsze przeglądarki bez ImageBitmap: surowe piksele.
          const image = this.frameCtx.getImageData(0, 0, width, height);
          const buffer = image.data.buffer;
          this.post('pixels', { buffer, width, height, seq: ++this.seq }, [buffer]);
        }
      } catch (error) {
        this.lastError = String(error);
        // Błąd tworzenia klatki nie może wywalać pętli ani spamować statusu.
        if (now - this.lastStatusAt > 4000) {
          this.lastStatusAt = now;
          this.status(`Głowa i oczy: pominięto klatkę (${this.lastError})`, 'error');
        }
      } finally {
        this.sending = false;
      }
    }
    if (this.running) this.frameId = requestAnimationFrame(() => void this.tick());
  }

  private handle(frame: FaceFrame): void {
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
    this.ready = false;
    cancelAnimationFrame(this.frameId);
    window.removeEventListener('message', this.onMessage);
    if (this.iframe) {
      try { this.post('stop'); } catch { /* ramka mogła już zniknąć */ }
      this.iframe.remove();
    }
    this.iframe = null;
    this.frameCanvas = null;
    this.frameCtx = null;
    this.sending = false;
    this.context?.clearRect(0, 0, this.canvas?.width ?? 0, this.canvas?.height ?? 0);
    this.onFrame?.({ ...EMPTY_FACE });
  }
}
