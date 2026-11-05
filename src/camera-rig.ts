/**
 * Jeden strumień z kamerki → trzy źródła sterowania.
 *
 * Hands (21 punktów × 2 dłonie) i FaceMesh (478 punktów twarzy + źrenice)
 * dostają TEN SAM kadr video. CameraRig pilnuje jednej zgody na kamerę,
 * jednego zegara i jednego miejsca, w którym sygnały zamieniane są na ruch:
 * głowa → chodzenie, oczy → kamera, palce → chwyt / odłożenie / użycie.
 *
 * v0.7.1 — ODPORNOŚĆ. Każdy sygnał ma znacznik czasu: gdy któryś tracker
 * zamilknie, rig sam wypuszcza puste dłonie i pustą twarz, więc postać nie
 * zamarza w ostatniej pozie, a kamera nie jedzie ostatnim wektorem głowy.
 * Odłączenie kamerki wykrywa tor `ended` i próbuje wznowić strumień co
 * najwyżej dwa razy, zamiast zostawiać gracza z martwym podglądem.
 */

import { HandTracker } from './hand-tracking';
import { FaceTracker } from './face-tracking';
import { emptyFace, type FaceFrame } from './face-math';
import {
  CameraControl, type ControlFrame, type GestureEvent, type LabDiagnostics,
} from './camera-control';
import { recaptureWristNeutral, resetWristCalibration, type TrackedHand } from './hand-pose';
import { diagnostics } from './diagnostics';
import { lowPowerDevice } from './performance';
import { FrameWatchdog } from './tracking-guard';

const HAND_TIMEOUT_MS = 1000;
const FACE_TIMEOUT_MS = 1800;
const MAX_RECOVERY_ATTEMPTS = 2;

export interface CameraRigDiagnostics {
  active: boolean;
  lowPower: boolean;
  constraint: string;
  trackSettings: string;
  video: string;
  hands: ReturnType<HandTracker['diagnostics']>;
  face: ReturnType<FaceTracker['diagnostics']>;
  tests: LabDiagnostics;
  /** Wiek ostatniego odczytu dłoni / twarzy i liczba bezpiecznych zwolnień. */
  handAgeMs: number;
  faceAgeMs: number;
  handReleases: number;
  faceReleases: number;
  recoveryAttempts: number;
}

export interface CameraRigOptions {
  video: HTMLVideoElement;
  /** Canvas 2D ze szkieletem dłoni (panel kamerki / laboratorium). */
  canvas: HTMLCanvasElement;
  /** Osobny canvas z obrysem twarzy i źrenicami, tylko laboratorium. */
  faceCanvas?: HTMLCanvasElement;
  onHands: (hands: TrackedHand[], aspect: number) => void;
  onStatus: (message: string, kind: 'info' | 'error') => void;
  onControl: (control: ControlFrame, dt: number) => void;
  onGesture: (gesture: GestureEvent) => void;
  onDiagnostics?: (diagnostics: LabDiagnostics) => void;
}

export class CameraRig {
  readonly control = new CameraControl();
  readonly hands: HandTracker;
  readonly face: FaceTracker;

  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly faceCanvas?: HTMLCanvasElement;
  private readonly onControl: CameraRigOptions['onControl'];
  private readonly onGesture: CameraRigOptions['onGesture'];
  private readonly onDiagnostics: CameraRigOptions['onDiagnostics'];
  private readonly onStatus: CameraRigOptions['onStatus'];

  private stream: MediaStream | null = null;
  private running = false;
  private frameId = 0;
  private lastTick = 0;
  private lastDiag = 0;
  private latestFace: FaceFrame = emptyFace();
  private latestHands: TrackedHand[] = [];
  private readonly handsWatchdog = new FrameWatchdog(HAND_TIMEOUT_MS);
  private readonly faceWatchdog = new FrameWatchdog(FACE_TIMEOUT_MS);
  private handReleases = 0;
  private faceReleases = 0;
  private recoveryAttempts = 0;
  private recoveryTimer = 0;
  private watchedTrack: MediaStreamTrack | null = null;
  private trackEndListener: (() => void) | null = null;
  private labOpen = false;
  private readonly lowPower = lowPowerDevice();
  private constraint = 'nie rozpoczęto';

  constructor(options: CameraRigOptions) {
    this.video = options.video;
    this.canvas = options.canvas;
    this.faceCanvas = options.faceCanvas;
    this.onControl = options.onControl;
    this.onGesture = options.onGesture;
    this.onDiagnostics = options.onDiagnostics;
    this.onStatus = options.onStatus;

    this.hands = new HandTracker({
      video: options.video,
      canvas: options.canvas,
      onFrame: (hands) => {
        this.latestHands = hands;
        this.handsWatchdog.mark();
        options.onHands(hands, this.canvas.width / Math.max(this.canvas.height, 1));
      },
      onStatus: options.onStatus,
    });
    this.face = new FaceTracker({
      video: options.video,
      canvas: options.faceCanvas,
      onFrame: (frame) => {
        this.latestFace = frame;
        this.faceWatchdog.mark();
      },
      onStatus: options.onStatus,
    });
    // Raport musi mieć sekcję kamerki także wtedy, gdy użytkownik jej jeszcze
    // nie włączył — inaczej „Kopiuj logi" nie pokazuje stanu wyjściowego.
    diagnostics.setFact('kamerka', this.diagnostics());
  }

  get active(): boolean {
    return this.running;
  }

  get labVisible(): boolean {
    return this.labOpen;
  }

  /** Bieżąca, surowa klatka twarzy dla kreatora kalibracji punktowej. */
  get currentFace(): FaceFrame {
    return this.latestFace;
  }

  /** Bieżące, surowe dłonie dla kreatora kierunku ruchu. */
  get currentHands(): readonly TrackedHand[] {
    return this.latestHands;
  }

  /** Pełny stan do przycisku „Kopiuj logi". */
  diagnostics(): CameraRigDiagnostics {
    const track = this.stream?.getVideoTracks()[0];
    const settings = track?.getSettings();
    return {
      active: this.running,
      lowPower: this.lowPower,
      constraint: this.constraint,
      trackSettings: track
        ? `${settings?.width ?? '?'}x${settings?.height ?? '?'} @ ${settings?.frameRate ?? '?'} fps · ${track.label || 'bez nazwy'} · ${track.readyState}`
        : 'brak toru wideo',
      video: `${this.video.videoWidth}x${this.video.videoHeight} · readyState ${this.video.readyState}`,
      hands: this.hands.diagnostics(),
      face: this.face.diagnostics(),
      tests: this.control.diagnostics(),
      handAgeMs: Math.round(this.handsWatchdog.age()),
      faceAgeMs: Math.round(this.faceWatchdog.age()),
      handReleases: this.handReleases,
      faceReleases: this.faceReleases,
      recoveryAttempts: this.recoveryAttempts,
    };
  }

  /** Przycisk „Kalibruj pozycję neutralną" obejmuje też nadgarstki. */
  recaptureNeutral(): void {
    this.control.beginCalibration();
    recaptureWristNeutral();
  }

  async restart(): Promise<void> {
    this.recoveryAttempts = 0;
    this.stop();
    await this.start();
  }

  setOverlayVisible(visible: boolean): void {
    this.hands.setOverlayVisible(visible || this.labOpen);
    this.face.setDrawEnabled(this.labOpen);
  }

  setLabOpen(open: boolean): void {
    this.labOpen = open;
    this.face.setDrawEnabled(open);
    this.hands.setOverlayVisible(open || !document.body.classList.contains('in-game'));
    if (open) this.control.resetTests();
  }

  /**
   * Słabsza kamerka często odrzuca `ideal + max + facingMode` jako
   * OverconstrainedError. Schodzimy po drabinie aż do gołego `video: true`
   * i zapisujemy każdą próbę w logach — bez wywalania całej kamerki.
   */
  private async openStream(): Promise<MediaStream> {
    const attempts: Array<{ label: string; constraints: MediaStreamConstraints }> = [
      {
        label: this.lowPower ? '480x360 / 24 fps' : '640x480 / 30 fps',
        constraints: {
          video: {
            width: { ideal: this.lowPower ? 480 : 640 },
            height: { ideal: this.lowPower ? 360 : 480 },
            frameRate: { ideal: this.lowPower ? 24 : 30, max: 30 },
            facingMode: 'user',
          },
          audio: false,
        },
      },
      {
        label: '320x240 / 20 fps',
        constraints: {
          video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 20 } },
          audio: false,
        },
      },
      { label: 'dowolna rozdzielczość', constraints: { video: true, audio: false } },
    ];
    const failures: string[] = [];
    for (const attempt of attempts) {
      try {
        diagnostics.push('info', 'camera', `Próba: ${attempt.label}`);
        const stream = await navigator.mediaDevices.getUserMedia(attempt.constraints);
        this.constraint = attempt.label;
        return stream;
      } catch (error) {
        const text = `${error instanceof Error ? error.name : 'Error'}: ${String(error)}`;
        failures.push(`${attempt.label} → ${text}`);
        diagnostics.push('warn', 'camera', `Nieudana próba ${attempt.label}: ${text}`);
        const name = error instanceof Error ? error.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          throw new Error('Brak zgody na kamerę. Włącz ją w ustawieniach przeglądarki przy kłódce obok adresu.');
        }
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          throw new Error('Nie znaleziono kamerki. Podłącz urządzenie lub sprawdź, czy nie jest zajęte przez inną aplikację.');
        }
        if (name === 'NotReadableError' || name === 'TrackStartError') {
          throw new Error('Kamerka jest zajęta lub odłączyła się. Zamknij inne aplikacje i naciśnij „Restart kamerki".');
        }
      }
    }
    throw new Error(`Nie udało się uruchomić kamerki. ${failures.join(' | ')}`);
  }

  /** Czekamy na pierwszy prawdziwy kadr — zerowe wymiary psuły WASM. */
  private async waitForFrame(): Promise<void> {
    if (this.video.videoWidth > 0 && this.video.videoHeight > 0) return;
    const gotFrame = await new Promise<boolean>((resolve) => {
      const finish = (ok: boolean): void => {
        this.video.removeEventListener('loadedmetadata', onFrame);
        this.video.removeEventListener('canplay', onFrame);
        window.clearTimeout(timer);
        resolve(ok);
      };
      const onFrame = (): void => finish(this.video.videoWidth > 0 && this.video.videoHeight > 0);
      const timer = window.setTimeout(() => finish(this.video.videoWidth > 0), 4000);
      this.video.addEventListener('loadedmetadata', onFrame, { once: true });
      this.video.addEventListener('canplay', onFrame, { once: true });
    });
    if (!gotFrame) {
      throw new Error('Kamerka nie dostarczyła kadru w ciągu 4 s. Spróbuj „Restart kamerki".');
    }
  }

  private attachTrackWatch(stream: MediaStream): void {
    this.detachTrackWatch();
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    this.watchedTrack = track;
    this.trackEndListener = () => { void this.handleTrackEnd(); };
    track.addEventListener('ended', this.trackEndListener);
  }

  private detachTrackWatch(): void {
    if (this.watchedTrack && this.trackEndListener) {
      this.watchedTrack.removeEventListener('ended', this.trackEndListener);
    }
    this.watchedTrack = null;
    this.trackEndListener = null;
  }

  /** Kamerka odłączona / przełączona w trakcie gry: bounded auto-recovery. */
  private async handleTrackEnd(): Promise<void> {
    if (!this.running) return;
    diagnostics.push('warn', 'camera', 'Tor wideo zakończył się — próba wznowienia.');
    this.stop();
    if (this.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS || document.visibilityState === 'hidden') {
      this.onStatus('Kamerka została odłączona. Podłącz ją i naciśnij „Restart kamerki".', 'error');
      return;
    }
    this.recoveryAttempts += 1;
    this.onStatus('Kamerka została odłączona. Próbuję wznowić…', 'error');
    this.recoveryTimer = window.setTimeout(() => {
      this.recoveryTimer = 0;
      void this.start().then(() => {
        this.recoveryAttempts = 0;
        this.onStatus('Kamerka wznowiona — dłonie, głowa i oczy znów działają.', 'info');
      }).catch((error: unknown) => {
        this.onStatus(
          `Nie udało się wznowić kamerki: ${String(error)}. Naciśnij „Restart kamerki".`,
          'error',
        );
      });
    }, 900);
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Kamerka wymaga bezpiecznego połączenia (HTTPS) i zgody przeglądarki.');
    }
    this.onStatus('Czekam na zgodę na kamerę…', 'info');
    resetWristCalibration();
    try {
      const stream = await this.openStream();
      this.stream = stream;
      this.video.srcObject = stream;
      try { await this.video.play(); } catch (error) {
        diagnostics.push('warn', 'camera', `video.play(): ${String(error)}`);
      }
      await this.waitForFrame();
      const width = Math.max(1, this.video.videoWidth || 320);
      const height = Math.max(1, this.video.videoHeight || 240);
      this.canvas.width = width;
      this.canvas.height = height;
      if (this.faceCanvas) {
        this.faceCanvas.width = width;
        this.faceCanvas.height = height;
      }
      diagnostics.setFact('kamerka', this.diagnostics());
      this.onStatus(`Kamerka: ${this.constraint}, kadr ${width}x${height}. Wczytuję modele…`, 'info');

      await this.hands.start(stream);
      diagnostics.setFact('kamerka', this.diagnostics());
      try {
        await this.face.start();
      } catch (error) {
        // Brak modelu twarzy nie może wyłączyć śledzenia dłoni z v0.5.
        this.onStatus(`Dłonie działają, ale głowa/oczy nie: ${String(error)}`, 'error');
        diagnostics.push('error', 'camera', `face.start(): ${String(error)}`);
      }
      this.attachTrackWatch(stream);
      this.running = true;
      this.lastTick = performance.now();
      this.handsWatchdog.mark();
      this.faceWatchdog.mark();
      diagnostics.setFact('kamerka', this.diagnostics());
      this.onStatus(
        'Kamerka działa: dłonie 1:1, przechył głowy = ruch, źrenice = kamera. Otwórz laboratorium, aby skalibrować.',
        'info',
      );
      this.frameId = requestAnimationFrame(() => this.tick());
    } catch (error) {
      // Bez sprzątania porażka zostawiała włączoną kamerę, działający
      // tracker i osierocony iframe — kolejny start dokładał następne.
      this.stop();
      throw error;
    }
  }

  private tick(): void {
    if (!this.running) return;
    const now = performance.now();
    const rawDt = (now - this.lastTick) / 1000;
    const dt = Number.isFinite(rawDt) ? Math.min(0.12, Math.max(0.008, rawDt)) : 1 / 60;
    this.lastTick = now;
    const visible = document.visibilityState !== 'hidden';
    let hands = this.latestHands;
    let face = this.latestFace;
    if (visible && this.handsWatchdog.isStale(now)) {
      this.handsWatchdog.release();
      this.handReleases += 1;
      hands = [];
    }
    if (visible && this.faceWatchdog.isStale(now)) {
      this.faceWatchdog.release();
      this.faceReleases += 1;
      face = emptyFace();
    }
    const { control, gestures } = this.control.ingest(face, hands, dt);
    // WOŁAMY ZAWSZE. Dawniej przy wyłączonym sterowaniu `onControl` nie był
    // wywoływany, więc `world.cameraMove` i `horror.cameraJoystick` zostawały
    // na ostatniej niezerowej wartości — postać jechała dalej mimo „wyłącz".
    this.onControl(control, dt);
    for (const gesture of gestures) this.onGesture(gesture);
    if (this.labOpen && now - this.lastDiag > 90) {
      this.lastDiag = now;
      this.onDiagnostics?.(this.control.diagnostics());
      diagnostics.setFact('kamerka', this.diagnostics());
    }
    this.frameId = requestAnimationFrame(() => this.tick());
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
    if (this.recoveryTimer) window.clearTimeout(this.recoveryTimer);
    this.recoveryTimer = 0;
    this.detachTrackWatch();
    this.face.stop();
    this.hands.stop();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.latestFace = emptyFace();
    this.latestHands = [];
    this.handsWatchdog.reset();
    this.faceWatchdog.reset();
    this.control.zero();
    this.constraint = 'zatrzymana';
    diagnostics.setFact('kamerka', this.diagnostics());
    this.onControl(
      { lookX: 0, lookY: 0, moveX: 0, moveY: 0, gazeX: 0, gazeY: 0, headPitch: 0, headRoll: 0 },
      1 / 60,
    );
    this.onDiagnostics?.(this.control.diagnostics());
  }
}
