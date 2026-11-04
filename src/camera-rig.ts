/**
 * Jeden strumień z kamerki → trzy źródła sterowania.
 *
 * Hands (21 punktów × 2 dłonie) i FaceMesh (478 punktów twarzy + źrenice)
 * dostają TEN SAM kadr video. CameraRig pilnuje jednej zgody na kamerę,
 * jednego zegara i jednego miejsca, w którym sygnały zamieniane są na ruch:
 * głowa → chodzenie, oczy → kamera, palce → chwyt / odłożenie / użycie.
 */

import { HandTracker } from './hand-tracking';
import { FaceTracker, EMPTY_FACE, type FaceFrame } from './face-tracking';
import {
  CameraControl, type ControlFrame, type GestureEvent, type LabDiagnostics,
} from './camera-control';
import type { TrackedHand } from './hand-pose';
import { lowPowerDevice } from './performance';

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
  private latestFace: FaceFrame = { ...EMPTY_FACE };
  private latestHands: TrackedHand[] = [];
  private labOpen = false;
  private readonly lowPower = lowPowerDevice();

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
        options.onHands(hands, this.canvas.width / Math.max(this.canvas.height, 1));
      },
      onStatus: options.onStatus,
    });
    this.face = new FaceTracker({
      video: options.video,
      canvas: options.faceCanvas,
      onFrame: (frame) => { this.latestFace = frame; },
      onStatus: options.onStatus,
    });
  }

  get active(): boolean {
    return this.running;
  }

  get labVisible(): boolean {
    return this.labOpen;
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

  async start(): Promise<void> {
    if (this.running) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Kamerka wymaga bezpiecznego połączenia (HTTPS) i zgody przeglądarki.');
    }
    this.onStatus('Czekam na zgodę na kamerę…', 'info');
    const width = this.lowPower ? 480 : 640;
    const height = this.lowPower ? 360 : 480;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: width }, height: { ideal: height },
        frameRate: { ideal: 30, max: 30 }, facingMode: 'user',
      },
      audio: false,
    });
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play();
    this.canvas.width = this.video.videoWidth || width;
    this.canvas.height = this.video.videoHeight || height;
    if (this.faceCanvas) {
      this.faceCanvas.width = this.canvas.width;
      this.faceCanvas.height = this.canvas.height;
    }

    await this.hands.start(stream);
    try {
      await this.face.start();
    } catch (error) {
      // Brak modelu twarzy nie może wyłączyć śledzenia dłoni z v0.5.
      this.onStatus(`Dłonie działają, ale głowa/oczy nie: ${String(error)}`, 'error');
    }
    this.running = true;
    this.lastTick = performance.now();
    this.onStatus(
      'Kamerka działa: dłonie 1:1, przechył głowy = ruch, źrenice = kamera. Otwórz laboratorium, aby skalibrować.',
      'info',
    );
    this.frameId = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    if (!this.running) return;
    const now = performance.now();
    const dt = Math.min(0.12, Math.max(0.008, (now - this.lastTick) / 1000));
    this.lastTick = now;
    const { control, gestures } = this.control.ingest(this.latestFace, this.latestHands, dt);
    if (this.control.settings.enabled) this.onControl(control, dt);
    for (const gesture of gestures) this.onGesture(gesture);
    if (this.labOpen && now - this.lastDiag > 90) {
      this.lastDiag = now;
      this.onDiagnostics?.(this.control.diagnostics());
    }
    this.frameId = requestAnimationFrame(() => this.tick());
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
    this.face.stop();
    this.hands.stop();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.latestFace = { ...EMPTY_FACE };
    this.latestHands = [];
    this.control.zero();
    this.onControl(
      { lookX: 0, lookY: 0, moveX: 0, moveY: 0, gazeX: 0, gazeY: 0, headPitch: 0, headRoll: 0 },
      1 / 60,
    );
    this.onDiagnostics?.(this.control.diagnostics());
  }
}
