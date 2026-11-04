/**
 * Przechwytywanie dłoni z kamerki (MediaPipe Hands, assets lokalne).
 *
 * To NIE jest wirtualny tryb kamery/aparatu i NIE jest to klasyfikator gestów.
 * Kamerka dostarcza 21 punktów 3D na każdą dłoń; te punkty trafiają bezpośrednio
 * na kości palców awatara (src/hand-pose.ts). Nic nie jest nagrywane ani
 * wysyłane — `getUserMedia` działa lokalnie, model leży w public/mediapipe/.
 *
 * v0.7.1 — ODPORNOŚĆ. Start sprząta strumień, gdy model nie wstanie; zatrute
 * klatki (NaN, brak punktów) są odrzucane, zanim wejdą w kwaterniony; watchdog
 * wypuszcza dłonie, gdy WASM przestanie odpowiadać; zawieszony `send()` nie
 * blokuje pętli na zawsze. Liczniki diagnostyczne resetują się co sesję.
 */

import type { NormalizedLandmark, TrackedHand } from './hand-pose';
import { diagnostics } from './diagnostics';
import { lowPowerDevice } from './performance';
import {
  FrameWatchdog, disambiguateHandedness, validLandmarks,
} from './tracking-guard';

export interface HandTrackerDiagnostics {
  ready: boolean;
  framesSent: number;
  results: number;
  handsSeen: number;
  videoWidth: number;
  videoHeight: number;
  lastError: string | null;
  modelComplexity: number;
  /** Czas od ostatniego odczytu modelu (ms). */
  lastResultAgeMs: number;
  /** Ile razy brak odczytu wymusił zwolnienie dłoni. */
  staleReleases: number;
  /** Klatki odrzucone jako niekompletne / nieskończone. */
  rejectedFrames: number;
}

const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

const HAND_COLORS = ['rgba(200, 160, 106, 0.9)', 'rgba(126, 174, 178, 0.9)'];
/** Po 900 ms ciszy dłonie wracają do spoczynku zamiast zamarzać w pozie. */
const HAND_TIMEOUT_MS = 900;
/** `hands.send()` nie może zablokować pętli dłużej niż 5 s. */
const SEND_TIMEOUT_MS = 5000;

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

const MP_BASE = `${import.meta.env.BASE_URL}mediapipe/`;

type HandsConstructor = new (config: {
  locateFile: (file: string) => string;
}) => HandsSolution;

declare global {
  interface Window {
    Hands?: HandsConstructor;
  }
}

/** Jeden wątek wczytywania skryptu — restart nie dołoży drugiego `<script>`. */
let handsLoad: Promise<HandsConstructor> | null = null;

function loadHands(): Promise<HandsConstructor> {
  if (window.Hands) return Promise.resolve(window.Hands);
  if (handsLoad) return handsLoad;
  handsLoad = new Promise<HandsConstructor>((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (error) {
        script.remove();
        reject(error);
      } else {
        resolve(window.Hands as HandsConstructor);
      }
    };
    const timer = window.setTimeout(
      () => finish(new Error('Model wykrywania dłoni nie wczytał się w ciągu 15 s.')),
      15000,
    );
    script.src = `${MP_BASE}hands.js`;
    script.async = true;
    script.onload = () => {
      if (!window.Hands) finish(new Error('Biblioteka wykrywania dłoni nie jest dostępna.'));
      else finish();
    };
    script.onerror = () => finish(new Error('Nie udało się wczytać modelu wykrywania dłoni.'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    handsLoad = null; // pozwalamy na ponowną próbę po „Restart kamerki"
    throw error;
  });
  return handsLoad;
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
  private sendToken = 0;
  private sendStartedAt = 0;
  private running = false;
  private readonly lowPower = lowPowerDevice();
  private overlay = true;
  private lastSend = 0;
  private ownsStream = true;
  private framesSent = 0;
  private results = 0;
  private handsSeen = 0;
  private staleReleases = 0;
  private rejectedFrames = 0;
  private lastError: string | null = null;
  private lastErrorAt = 0;
  private errorCooldownUntil = 0;
  private firstHandLogged = false;
  private readonly resultWatchdog = new FrameWatchdog(HAND_TIMEOUT_MS);

  constructor(options: HandTrackerOptions) {
    this.video = options.video;
    this.canvas = options.canvas;
    this.context = options.canvas.getContext('2d')!;
    this.onFrame = options.onFrame;
    this.onStatus = options.onStatus;
  }

  /** W grze panel kamerki jest ukryty — nie rysujemy wtedy szkieletu 2D. */
  setOverlayVisible(visible: boolean): void {
    this.overlay = visible;
    if (!visible) this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  get active(): boolean {
    return this.running;
  }

  private status(message: string, kind: 'info' | 'error' = 'info'): void {
    diagnostics.push(kind === 'error' ? 'error' : 'info', 'hands', message);
    this.onStatus?.(message, kind);
  }

  diagnostics(): HandTrackerDiagnostics {
    return {
      ready: !!this.hands,
      framesSent: this.framesSent,
      results: this.results,
      handsSeen: this.handsSeen,
      videoWidth: this.video.videoWidth,
      videoHeight: this.video.videoHeight,
      lastError: this.lastError,
      modelComplexity: this.lowPower ? 0 : 1,
      lastResultAgeMs: Math.round(this.resultWatchdog.age()),
      staleReleases: this.staleReleases,
      rejectedFrames: this.rejectedFrames,
    };
  }

  /**
   * `stream` pozwala współdzielić JEDEN strumień z FaceTracker (CameraRig) —
   * bez drugiej prośby o zgodę na kamerę. Bez argumentu tracker działa sam.
   */
  async start(stream?: MediaStream): Promise<void> {
    if (this.running) return;
    if (!stream && !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Kamerka wymaga bezpiecznego połączenia (HTTPS) i zgody przeglądarki.');
    }
    // Nowa sesja = nowe liczniki. Wcześniej „Restart kamerki" sumował wyniki
    // z poprzednich uruchomień i raport z „Kopiuj logi" kłamał.
    this.framesSent = 0;
    this.results = 0;
    this.handsSeen = 0;
    this.staleReleases = 0;
    this.rejectedFrames = 0;
    this.lastError = null;
    this.lastErrorAt = 0;
    this.errorCooldownUntil = 0;
    this.firstHandLogged = false;
    this.lastSend = 0;
    this.sending = false;
    this.resultWatchdog.reset();
    this.ownsStream = !stream;

    try {
      if (stream) {
        this.stream = stream;
        this.video.srcObject = stream;
        await this.video.play();
      } else {
        this.status('Czekam na zgodę na kamerę…');
        const width = this.lowPower ? 480 : 640;
        const height = this.lowPower ? 360 : 480;
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: width }, height: { ideal: height },
            frameRate: { ideal: 30, max: 30 }, facingMode: 'user',
          },
          audio: false,
        });
        this.video.srcObject = this.stream;
        await this.video.play();
      }
      // Nigdy nie zostawiamy canvasu o zerowych wymiarach — to jedna z dróg
      // do `Cannot read properties of undefined (reading 'buffer')` w WASM.
      this.canvas.width = Math.max(1, this.video.videoWidth || (this.lowPower ? 480 : 640));
      this.canvas.height = Math.max(1, this.video.videoHeight || (this.lowPower ? 360 : 480));

      this.status('Wczytuję model wykrywania dłoni…');
      const Hands = await loadHands();
      const hands = new Hands({ locateFile: (file) => `${MP_BASE}${file}` });
      hands.setOptions({
        maxNumHands: 2,
        // Na słabszych telefonach lżejszy model + wygładzanie czasowe MediaPipe
        // dają mniej drżących palców przy mniejszym zużyciu CPU.
        modelComplexity: this.lowPower ? 0 : 1,
        smoothLandmarks: true,
        // v0.6.1: 0,6 było zbyt wysokie dla słabej kamerki — dłoń znikała
        // przy gorszym świetle. Niższy próg + wygładzanie dają ciągłość.
        minDetectionConfidence: this.lowPower ? 0.35 : 0.45,
        minTrackingConfidence: this.lowPower ? 0.35 : 0.45,
      });
      hands.onResults((results) => this.handleResults(results));
      this.hands = hands;
      this.running = true;
      this.resultWatchdog.mark();
      this.status('Kamerka działa. Pokaż dłonie w kadrze — palce odwzorowują się 1:1.');
      this.frame = requestAnimationFrame(() => void this.tick());
    } catch (error) {
      // Bez tego `getUserMedia` zostawiało włączoną diodę i odtwarzany obraz
      // po błędzie modelu, a ponowny start dokładał kolejny strumień.
      this.stop();
      throw error;
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    const now = performance.now();
    const minGap = 1000 / (this.lowPower ? 16 : 24);
    // Uśpiona karta nie dostaje klatek — nie pompujemy WASM w tle i nie
    // doprowadzamy do „stale release" tylko dlatego, że rAF stanął.
    const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    if (visible && this.resultWatchdog.isStale(now)) {
      this.resultWatchdog.release();
      this.staleReleases += 1;
      this.onFrame?.([], this.canvas.width / Math.max(this.canvas.height, 1));
      if (now - this.lastErrorAt > 5000) {
        this.lastErrorAt = now;
        this.status('Dłonie: brak odczytu z modelu. Palce wróciły do spoczynku.', 'error');
      }
    }
    // Zawieszony `send()` nie może zablokować pętli na zawsze. Token chroni
    // przed sytuacją, w której spóźnione `finally` odblokowuje nowe wywołanie.
    if (this.sending && now - this.sendStartedAt > SEND_TIMEOUT_MS) {
      this.sending = false;
      this.sendToken += 1;
      this.errorCooldownUntil = now + 1200;
      this.lastError = 'model dłoni nie odpowiedział w ciągu 5 s';
      diagnostics.push('error', 'hands.send', this.lastError);
      if (now - this.lastErrorAt > 5000) {
        this.lastErrorAt = now;
        this.status('Dłonie: model przestał odpowiadać. Naciśnij „Restart kamerki".', 'error');
      }
    }
    const hasFrame = this.video.readyState >= 2
      && this.video.videoWidth > 0 && this.video.videoHeight > 0
      && this.canvas.width > 0 && this.canvas.height > 0;
    if (this.hands && visible && hasFrame && !this.sending
      && now >= this.errorCooldownUntil && now - this.lastSend >= minGap) {
      this.lastSend = now;
      this.sending = true;
      this.sendStartedAt = now;
      const token = ++this.sendToken;
      this.framesSent += 1;
      try {
        await this.hands.send({ image: this.video });
        this.lastError = null;
      } catch (error) {
        // `Błąd odczytu klatki` było w v0.6 wyrzucane setki razy na sekundę,
        // gdy WASM nie wstał. Teraz zapisujemy pełny błąd do raportu, a UI
        // dostaje jeden czytelny komunikat i krótką pauzę zamiast zalewu.
        this.lastError = String(error);
        diagnostics.push('error', 'hands.send', this.lastError);
        this.errorCooldownUntil = now + 1200;
        if (now - this.lastErrorAt > 5000) {
          this.lastErrorAt = now;
          this.status(
            `Błąd odczytu klatki: ${this.lastError}. Spróbuj „Restart kamerki" i wyślij logi przyciskiem „Kopiuj logi".`,
            'error',
          );
        }
      } finally {
        if (token === this.sendToken) this.sending = false;
      }
    }
    if (this.running) this.frame = requestAnimationFrame(() => void this.tick());
  }

  private handleResults(results: HandsResults): void {
    this.results += 1;
    this.resultWatchdog.mark();
    const landmarks = results.multiHandLandmarks ?? [];
    const ctx = this.context;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const aspect = w / Math.max(h, 1);

    // Jedna zatruta klatka nie może wejść do kwaternionów: odrzucamy całą
    // dłoń, a nie „naprawiamy" pojedyncze punkty zgadywaniem.
    const clean: NormalizedLandmark[][] = [];
    let rejected = false;
    for (const hand of landmarks) {
      if (validLandmarks(hand, 21, 64)) clean.push(hand);
      else rejected = true;
    }
    this.rejectedFrames += rejected ? 1 : 0;
    this.handsSeen += clean.length;
    if (clean.length > 0 && !this.firstHandLogged) {
      this.firstHandLogged = true;
      diagnostics.push('info', 'hands', `Pierwsza dłoń wykryta po ${this.framesSent} klatkach.`);
    }

    // Rysowanie szkieletu 2D jest potrzebne tylko w panelu kamerki. W grze
    // oszczędzamy pełne czyszczenie canvasu 640×480 przy każdym odczycie.
    if (this.overlay) {
      ctx.clearRect(0, 0, w, h);
      clean.forEach((hand, i) => {
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
      });
    }

    const labeled: TrackedHand[] = clean.map((hand, i) => {
      const raw = results.multiHandedness?.[i];
      return {
        label: raw?.label === 'Right' ? 'Right' : 'Left',
        score: typeof raw?.score === 'number' && Number.isFinite(raw.score) ? raw.score : 1,
        landmarks: hand,
      };
    });
    // Identyczne etykiety dla obu dłoni kończyły się utratą jednej z nich.
    this.onFrame?.(disambiguateHandedness(labeled), aspect);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.sendToken += 1;
    if (this.ownsStream) {
      this.stream?.getTracks().forEach((track) => track.stop());
      this.video.srcObject = null;
    }
    this.stream = null;
    if (this.hands) void this.hands.close().catch(() => undefined);
    this.hands = null;
    this.sending = false;
    this.resultWatchdog.reset();
    this.lastError = null;
    this.errorCooldownUntil = 0;
    this.firstHandLogged = false;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.onFrame?.([], this.canvas.width / Math.max(this.canvas.height, 1));
  }
}
