/**
 * Śledzenie twarzy, głowy i źrenic (MediaPipe FaceMesh, assets lokalne).
 *
 * 468 punktów twarzy + 10 punktów tęczówek (refineLandmarks). Matematyka
 * sygnałów leży w `face-math.ts` (czysta, testowalna w Node); ten plik
 * odpowiada wyłącznie za transport klatek i izolację modelu.
 *
 * v0.6.1 — IZOLACJA MODELU. Hands i FaceMesh to dwa zminifikowane bundle
 * Emscripten. W jednym dokumencie nadpisują sobie globalne `var`, przez co
 * WASM drugiego z nich nie wstaje. FaceMesh działa więc w ukrytym, same-origin
 * iframe (public/mediapipe/face/bridge.html), a rodzic przesyła mu TYLKO
 * pomniejszone klatki jako ImageBitmap. Nic nie jest nagrywane ani wysyłane.
 *
 * v0.7.1 — ODPORNOŚĆ. Sesja ma numer (epoch), więc zaległy timer z poprzedniego
 * uruchomienia nie może zgłosić błędu w nowej, zdrowej sesji. Start sprząta po
 * sobie przy porażce, a watchdog wypuszcza pustą klatkę, gdy iframe zamilknie —
 * bez tego kamera jechała ostatnim wektorem głowy w nieskończoność.
 */

import {
  BlinkCalibrator, EMPTY_FACE, centroid, emptyFace, faceFrameFromLandmarks,
  type FaceFrame,
} from './face-math';
import { diagnostics } from './diagnostics';
import { lowPowerDevice } from './performance';
import {
  FrameWatchdog, finite, validLandmarks, type Landmark,
} from './tracking-guard';

export { EMPTY_FACE, faceFrameFromLandmarks };
export type { FaceFrame };

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
  /** Czas od ostatniej wiadomości z izolowanego dokumentu (ms). */
  lastFrameAgeMs: number;
  /** Ile razy brak odczytu wymusił bezpieczne wyzerowanie sterowania. */
  staleReleases: number;
  /** Odrzucone klatki z niekompletnymi / nieskończonymi punktami. */
  rejectedFrames: number;
  blinkBaseline: number;
}

const MP_FACE = `${import.meta.env.BASE_URL}mediapipe/face/`;
const TAG_CHILD = '__rejplayFace';
const TAG_PARENT = '__rejplayFaceParent';
/** Po 1,5 s ciszy głowa i oczy przestają sterować kamerą. */
const FACE_TIMEOUT_MS = 1500;
const READY_TIMEOUT_MS = 14000;

interface BridgeMessage {
  tag?: string;
  type?: string;
  payload?: {
    data?: Float32Array | number[];
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
  private readyTimer = 0;
  private lastSend = 0;
  private seq = 0;
  private epoch = 0;
  private readonly lowPower = lowPowerDevice();
  private drawEnabled = true;
  private readonly refineLandmarks = true;
  private lastError: string | null = null;
  private stats = { frames: 0, results: 0, faces: 0, iris: 0 };
  private lastStatusAt = 0;
  private firstFaceLogged = false;
  private readonly blink = new BlinkCalibrator();
  private readonly watchdog = new FrameWatchdog(FACE_TIMEOUT_MS);
  private staleReleases = 0;
  private rejectedFrames = 0;

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
      lastFrameAgeMs: Math.round(this.watchdog.age()),
      staleReleases: this.staleReleases,
      rejectedFrames: this.rejectedFrames,
      blinkBaseline: Number(this.blink.baseline.toFixed(3)),
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
    if (!this.iframe || event.origin !== location.origin || event.data?.tag !== TAG_CHILD) return;
    if (this.iframe && event.source !== this.iframe.contentWindow) return;
    const msg = event.data;
    const payload = msg.payload ?? {};
    // Każda wiadomość (także „idle") dowodzi, że izolowany dokument żyje.
    this.watchdog.mark();
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
        this.mergeStats(payload);
        const flat = payload.data;
        const count = payload.count ?? 0;
        if (!flat || !Number.isInteger(count) || count < 468 || count > 600
          || flat.length < count * 3) {
          this.rejectedFrames += 1;
          this.handle(emptyFace());
          return;
        }
        const lm: Landmark[] = new Array(count);
        for (let i = 0; i < count; i += 1) {
          lm[i] = {
            x: finite(flat[i * 3], Number.NaN),
            y: finite(flat[i * 3 + 1], Number.NaN),
            z: finite(flat[i * 3 + 2], Number.NaN),
          };
        }
        if (!validLandmarks(lm, 468, 600)) {
          this.rejectedFrames += 1;
          this.handle(emptyFace());
          return;
        }
        if (!this.firstFaceLogged && this.stats.faces > 0) {
          this.firstFaceLogged = true;
          diagnostics.push('info', 'face', `Pierwsza twarz wykryta po ${this.seq} klatkach · punktów ${count} · źrenice ${count >= 478 ? 'tak' : 'nie'}.`);
        }
        this.handle(faceFrameFromLandmarks(lm, this.blink.baseline));
        break;
      }
      case 'empty':
        this.mergeStats(payload);
        this.handle(emptyFace());
        break;
      case 'idle':
      case 'stats':
        this.mergeStats(payload);
        break;
      default:
        break;
    }
  };

  private mergeStats(payload: BridgeMessage['payload']): void {
    if (!payload) return;
    this.stats.frames = finite(payload.frames, this.stats.frames);
    this.stats.results = finite(payload.results, this.stats.results);
    this.stats.faces = finite(payload.faces, this.stats.faces);
    this.stats.iris = finite(payload.iris, this.stats.iris);
  }

  /** Używa istniejącego strumienia wideo — nie woła getUserMedia. */
  async start(): Promise<void> {
    if (this.running) return;
    const epoch = ++this.epoch;
    this.clearTimers();
    this.status('Wczytuję izolowany model głowy i oczu…');
    this.lastError = null;
    this.seq = 0;
    this.stats = { frames: 0, results: 0, faces: 0, iris: 0 };
    this.firstFaceLogged = false;
    this.staleReleases = 0;
    this.rejectedFrames = 0;
    this.blink.reset();
    this.watchdog.reset();

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

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(
          () => reject(new Error('Model twarzy nie odpowiedział w ciągu 20 s.')),
          20000,
        );
        iframe.onload = () => { window.clearTimeout(timer); resolve(); };
        iframe.onerror = () => {
          window.clearTimeout(timer);
          reject(new Error('Nie udało się otworzyć izolowanego modelu twarzy.'));
        };
        document.body.appendChild(iframe);
      });
    } catch (error) {
      // Bez sprzątania zostawał osierocony listener + iframe + „wiecznie
      // wczytuję…". Dłonie mogą dalej działać, ale stan musi być czysty.
      this.stop();
      throw error;
    }
    if (epoch !== this.epoch) return; // w międzyczasie ktoś zatrzymał sesję

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
    this.watchdog.mark();
    this.frameId = requestAnimationFrame(() => void this.tick());

    // Watchdog gotowości: jeśli iframe wczytał się, ale model nie odpowiedział,
    // użytkownik dostaje czytelny błąd zamiast wiecznego „wczytuję…".
    // Timer jest przypięty do epoch, więc nie dotknie kolejnej sesji.
    this.readyTimer = window.setTimeout(() => {
      if (epoch !== this.epoch || !this.running || this.ready || this.lastError) return;
      this.lastError = 'model twarzy nie odpowiedział z izolowanego dokumentu';
      this.status(
        `Głowa i oczy: ${this.lastError}. Naciśnij „Restart kamerki" i wyślij „Kopiuj logi".`,
        'error',
      );
    }, READY_TIMEOUT_MS);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    const now = performance.now();
    // Gdy izolowany dokument przestanie odpowiadać, nie zostawiamy „ostatniej
    // twarzy" w sterowaniu: wypuszczamy pustą klatkę dokładnie raz.
    if (this.watchdog.isStale(now)) {
      this.watchdog.release();
      this.staleReleases += 1;
      this.handle(emptyFace());
      if (now - this.lastStatusAt > 5000) {
        this.lastStatusAt = now;
        this.status('Głowa i oczy: brak odczytu z modelu. Sterowanie wyzerowane — wciąż działają dłonie.', 'error');
      }
    }
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
    const safe: FaceFrame = { ...frame };
    if (safe.present) {
      // Mrugnięcie liczymy względem własnej szerokości oka użytkownika.
      safe.blink = this.blink.next(safe.openness).blink;
    }
    if (safe.present && this.context && this.canvas && this.drawEnabled
      && validLandmarks(safe.landmarks, 468, 600)) this.draw(safe);
    this.onFrame?.(safe);
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
    if (frame.iris && frame.landmarks.length >= 478) {
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

  private clearTimers(): void {
    if (this.readyTimer) window.clearTimeout(this.readyTimer);
    this.readyTimer = 0;
  }

  stop(): void {
    this.epoch += 1;
    this.running = false;
    this.ready = false;
    cancelAnimationFrame(this.frameId);
    this.clearTimers();
    window.removeEventListener('message', this.onMessage);
    if (this.iframe) {
      try { this.post('stop'); } catch { /* ramka mogła już zniknąć */ }
      this.iframe.remove();
    }
    this.iframe = null;
    this.frameCanvas = null;
    this.frameCtx = null;
    this.sending = false;
    this.watchdog.reset();
    this.context?.clearRect(0, 0, this.canvas?.width ?? 0, this.canvas?.height ?? 0);
    this.onFrame?.(emptyFace());
  }
}
