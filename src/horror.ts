import * as THREE from 'three';
import { buildDecor, type Decor } from './horror-decor';
import { AvatarViewHand, FallbackViewHand, ToolViewmodel, viewmodelFov } from './view-hands';
import type { HumanAssets } from './human';
import type { Appearance } from './character';
import { CHARACTER_MODELS } from './games';
import { loadRealProps } from './real-props';
import { neutralHandPosePair, type HandMotion, type HandPosePair } from './hand-pose';
import type { QualityProfile } from './performance';

/**
 * „Demonofobia” — autorska, pierwszoosobowa gra dochodzeniowa.
 *
 * To ORYGINALNA interpretacja gatunku: własna nazwa, własna klasyfikacja zjaw,
 * własne dowody, teksty i dźwięki. Nie używamy nazwy, lore'u, interfejsu ani
 * assetów Phasmophobia (Kinetic Games). Cała scena jest budowana z geometrii
 * Three.js i proceduralnych tekstur, więc nie potrzebuje dodatkowych plików.
 */

// ------------------------------------------------------------------ konfiguracja

export interface ToolInfo {
  id: string;
  name: string;
  key: string;
}

export interface EvidenceInfo {
  id: string;
  name: string;
  status: 'unknown' | 'found' | 'absent';
}

export interface GhostInfo {
  id: string;
  name: string;
  hint: string;
  signature: string[];
}

export interface HorrorResult {
  win: boolean;
  ghost: string;
  reason: string;
  found: string[];
  seconds: number;
}

export interface HorrorState {
  tools: ToolInfo[];
  toolIndex: number;
  reading: number;
  scan: number;
  evidence: EvidenceInfo[];
  ghosts: GhostInfo[];
  nerves: number;
  flashlight: boolean;
  journal: boolean;
  hint: string;
  result: HorrorResult | null;
  seconds: number;
  canReport: boolean;
  hunting: boolean;
  photos: number;
}

export interface HorrorOptions {
  scene: THREE.Scene;
  canvas: HTMLCanvasElement;
  assets: HumanAssets | null;
  appearance: Appearance;
  onState: (state: HorrorState) => void;
  onFinish: (result: HorrorResult) => void;
  onPhoto?: () => void;
}

const TOOLS: ToolInfo[] = [
  { id: 'cold', name: 'Termometr', key: '1' },
  { id: 'field', name: 'Miernik pola', key: '2' },
  { id: 'voice', name: 'Rejestrator', key: '3' },
];

const EVIDENCE: Array<{ id: string; name: string }> = [
  { id: 'cold', name: 'Zimny punkt' },
  { id: 'field', name: 'Zakłócenia pola' },
  { id: 'voice', name: 'Szepty' },
];

const GHOSTS: GhostInfo[] = [
  { id: 'mara', name: 'Mara', hint: 'Unika prądu. Zostawia zimno i szepty.', signature: ['cold', 'voice'] },
  { id: 'iskra', name: 'Iskra', hint: 'Nie obniża temperatury. Pole i szepty.', signature: ['field', 'voice'] },
  { id: 'szron', name: 'Szron', hint: 'Milczy. Zostawia zimno i pole.', signature: ['cold', 'field'] },
  { id: 'cisza', name: 'Cisza', hint: 'Zostawia wszystkie trzy ślady naraz.', signature: ['cold', 'field', 'voice'] },
  { id: 'popiol', name: 'Popiół', hint: 'Zimno bez żadnego dźwięku. Tylko jeden ślad.', signature: ['cold'] },
  { id: 'nic', name: 'Nić', hint: 'Same szepty. Nie rusza temperatury ani prądu.', signature: ['voice'] },
];

/**
 * Ściany [x1, z1, x2, z2]. Środkiem biegnie korytarz (x od -1.35 do 1.35),
 * po bokach leżą cztery pokoje. W ścianach korytarza są dwa przejścia
 * z każdej strony, a frontowe drzwi prowadzą prosto do wyjścia.
 */
const WALL_SEGMENTS: Array<[number, number, number, number]> = [
  [-9, -9, 9, -9],
  [-9, 9, -1.25, 9],
  [1.25, 9, 9, 9],
  [-9, -9, -9, 9],
  [9, -9, 9, 9],
  [-1.35, -9, -1.35, -5.6],
  [-1.35, -3.6, -1.35, 3.6],
  [-1.35, 5.6, -1.35, 9],
  [1.35, -9, 1.35, -5.6],
  [1.35, -3.6, 1.35, 3.6],
  [1.35, 5.6, 1.35, 9],
  [-9, 0, -1.35, 0],
  [1.35, 0, 9, 0],
];

/** Kandydaci na miejsca dowodów — rozsiani po czterech pokojach. */
const CLUE_SPOTS: Array<[number, number]> = [
  [-5.4, -5.6], [-3.1, -7.4], [-6.9, -2.9],
  [5.3, -5.9], [3.2, -7.2], [7.1, -3.1],
  [-5.6, 5.5], [-3.0, 7.3], [-7.0, 3.0],
  [5.6, 5.4], [3.1, 7.2], [7.0, 3.1],
];

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

// ------------------------------------------------------------------- silnik gry

export class HorrorGame {
  readonly camera = new THREE.PerspectiveCamera(74, 1, 0.05, 70);
  /** Osobna scena dłoni first-person: własne światło, bez prześwietlenia latarką. */
  readonly viewScene = new THREE.Scene();
  readonly viewCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 5);

  private readonly scene: THREE.Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly onState: (state: HorrorState) => void;
  private readonly onFinish: (result: HorrorResult) => void;
  private readonly onPhoto: (() => void) | undefined;

  private readonly position = new THREE.Vector3(0, 1.65, 7.0);
  private readonly walls: Box[] = [];
  private readonly hotspots = new Map<string, THREE.Vector3>();
  private readonly keys = new Set<string>();
  private readonly joystick = { x: 0, y: 0 };
  private readonly flashlight: THREE.SpotLight;
  private readonly apparition = new THREE.Group();
  private readonly statuses = new Map<string, 'unknown' | 'found' | 'absent'>();
  private decor: Decor | null = null;
  private readonly handPoses: HandPosePair = neutralHandPosePair();
  private leftHand!: AvatarViewHand | FallbackViewHand;
  private rightHand!: AvatarViewHand | FallbackViewHand;
  private toolView!: ToolViewmodel;
  private assets: HumanAssets | null;
  private appearance: Appearance;
  private skin = '#d3a377';
  private readonly velocity = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly leftMotion: HandMotion = {
    time: 0, sway: 0, turn: 0, grip: 0.22, scan: 0, sprint: 0, side: 'L',
  };
  private readonly rightMotion: HandMotion = {
    time: 0, sway: 0, turn: 0, grip: 1, scan: 0, sprint: 0, side: 'R',
  };
  private lookVelocity = 0;
  private lastYaw = 0;
  private lookScale = 1;
  /** Pierwsze ruchy po przejęciu kursora to „wyśrodkowanie” — ignorujemy je. */
  private skipLockMouse = 0;
  /** Fallback bez pointer locku: przytrzymanie myszy + ciągły obrót przy krawędzi. */
  private mouseHeld = false;
  private edgeX = 0;
  private edgeY = 0;
  private touchSprint = false;
  private quality: QualityProfile | null = null;
  private viewportAspect = 16 / 9;
  private viewFov = 60;
  private propsGroup: THREE.Group | null = null;
  private propsLoading = false;
  private screenTimer = 0;
  private lastStep = 0;
  private lastToolIndex = -1;

  private yaw = 0;
  private pitch = 0;
  private yawTarget = 0;
  private pitchTarget = 0;
  private toolIndex = 0;
  private reading = 0;
  private scan = 0;
  private interacting = false;
  private nerves = 100;
  private flashlightOn = true;
  private flicker = 0;
  private journal = false;
  private active = false;
  private ghost: GhostInfo = GHOSTS[0];
  private result: HorrorResult | null = null;
  private hint = 'Szukaj śladów. Narzędzia: 1, 2, 3 — skanuj, przytrzymując E.';
  private seconds = 0;
  private elapsed = 0;
  private eventTimer = 12;
  private apparitionTimer = 0;
  private hunting = false;
  private huntTimer = 0;
  private huntCooldown = 26;
  private photos = 0;
  private emitTimer = 0;
  private bob = 0;
  private moving = false;
  private lastFrameTime = 0;
  private audio: AudioContext | null = null;
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };

  constructor(options: HorrorOptions) {
    this.scene = options.scene;
    this.canvas = options.canvas;
    this.onState = options.onState;
    this.onFinish = options.onFinish;
    this.onPhoto = options.onPhoto;
    this.assets = options.assets;
    this.appearance = { ...options.appearance };
    this.skin = options.appearance.skin;

    this.camera.rotation.order = 'YXZ';
    this.scene.background = new THREE.Color(0x0a0d0f);
    this.scene.fog = new THREE.FogExp2(0x0a0d0f, 0.03);

    // Światło księżyca rzuca prawdziwe cienie mebli, latarka ma miękki stożek.
    this.scene.add(new THREE.AmbientLight(0x8d9aa6, 0.34));
    this.scene.add(new THREE.HemisphereLight(0x71879a, 0x24201c, 0.34));
    const moon = new THREE.DirectionalLight(0x7d95ad, 0.62);
    moon.position.set(-6, 10, -4);
    // Księżycowe światło jest statyczne, więc nie dokładamy drugiej mapy cieni.
    moon.castShadow = false;
    this.scene.add(moon);

    this.flashlight = new THREE.SpotLight(0xffe4bd, 62, 19, 0.56, 0.65, 1.3);
    this.flashlight.position.set(0.16, -0.14, 0);
    this.flashlight.target.position.set(0, -0.06, -1);
    this.flashlight.castShadow = false; // włączane dopiero w aktywnej rundzie
    this.flashlight.shadow.mapSize.set(512, 512);
    this.flashlight.shadow.camera.near = 0.2;
    this.flashlight.shadow.camera.far = 19;
    this.flashlight.shadow.bias = -0.0008;
    this.flashlight.shadow.normalBias = 0.02;
    this.camera.add(this.flashlight, this.flashlight.target);
    this.scene.add(this.camera);

    this.buildHouse();
    this.buildApparition();
    this.buildViewmodel();
    this.bindInput();
    this.emit();
  }

  // ------------------------------------------------------------------- scena 3D

  private buildHouse(): void {
    // Kolizje zostają w prostych prostokątach, a wygląd ścian, podłóg i
    // wyposażenia buduje osobny moduł z proceduralnymi teksturami.
    for (const [x1, z1, x2, z2] of WALL_SEGMENTS) {
      this.walls.push({
        minX: Math.min(x1, x2) - 0.08,
        maxX: Math.max(x1, x2) + 0.08,
        minZ: Math.min(z1, z2) - 0.08,
        maxZ: Math.max(z1, z2) + 0.08,
      });
    }
    this.decor = buildDecor(this.scene, WALL_SEGMENTS);
    // Gotowe modele CC0 (Poly Haven) ładujemy dopiero przy pierwszej rundzie:
    // nie dokładamy 8 requestów do startu strony głównej.
  }

  /**
   * Dłonie first-person to wycięty fragment ORYGINALNEGO awatara (ten sam
   * szkielet, skóra i rękaw), a nie osobny proceduralny model.
   */
  private buildViewmodel(): void {
    this.viewScene.background = null;
    this.viewCamera.position.set(0, 0, 0);
    this.viewScene.add(this.viewCamera);
    this.viewScene.add(new THREE.AmbientLight(0xb9c3c9, 0.9));
    const key = new THREE.DirectionalLight(0xffe2be, 1.2);
    key.position.set(1.2, 2.2, 2.5);
    this.viewScene.add(key);
    const fill = new THREE.DirectionalLight(0x7f9fb2, 0.45);
    fill.position.set(-2, -0.5, 1.5);
    this.viewScene.add(fill);

    this.makeHands();
    this.toolView = new ToolViewmodel();
    this.toolView.root.position.set(-0.055, 0.23, 0.13);
    this.toolView.root.scale.setScalar(0.7);
    this.toolView.root.rotation.set(0.04, 0.05, -0.22);
    this.rightHand.root.add(this.toolView.root);
    this.viewCamera.add(this.leftHand.root, this.rightHand.root);
  }

  private makeHands(): void {
    const template = this.assets?.templates[this.appearance.model];
    const female = CHARACTER_MODELS[this.appearance.model]?.female ?? false;
    for (const side of ['L', 'R'] as const) {
      const base = new THREE.Vector3(side === 'L' ? -0.33 : 0.33, -0.40, -0.62);
      const hand = template && this.assets
        ? new AvatarViewHand({
          template,
          female,
          side,
          assets: this.assets,
          appearance: this.appearance,
          base,
        })
        : new FallbackViewHand(side, this.skin, base);
      hand.setViewport(this.viewportAspect, this.viewFov);
      if (side === 'L') this.leftHand = hand;
      else this.rightHand = hand;
    }
  }

  /** Wygląd wybrany w edytorze — również na dłoniach w grze. */
  setAvatar(assets: HumanAssets | null, appearance: Appearance): void {
    const modelChanged = appearance.model !== this.appearance.model;
    this.assets = assets;
    this.appearance = { ...appearance };
    this.skin = appearance.skin;
    const template = assets?.templates[appearance.model];
    const female = CHARACTER_MODELS[appearance.model]?.female ?? false;
    if (this.leftHand instanceof AvatarViewHand && this.rightHand instanceof AvatarViewHand && template && assets) {
      this.leftHand.setAppearance(appearance, female, template);
      this.rightHand.setAppearance(appearance, female, template);
      return;
    }
    if (this.leftHand instanceof FallbackViewHand) this.leftHand.setSkin(this.skin);
    if (this.rightHand instanceof FallbackViewHand) this.rightHand.setSkin(this.skin);
    if (modelChanged || (template && assets)) {
      this.viewCamera.remove(this.leftHand.root, this.rightHand.root);
      this.makeHands();
      this.rightHand.root.add(this.toolView.root);
      this.viewCamera.add(this.leftHand.root, this.rightHand.root);
    }
  }

  /** Zachowana dla kompatybilności: kolor skóry ustawia teraz setAvatar. */
  setSkinColor(hex: string): void {
    this.skin = hex;
    this.appearance = { ...this.appearance, skin: hex };
    if (this.leftHand instanceof FallbackViewHand) this.leftHand.setSkin(hex);
    if (this.rightHand instanceof FallbackViewHand) this.rightHand.setSkin(hex);
    if (this.leftHand instanceof AvatarViewHand && this.rightHand instanceof AvatarViewHand && this.assets) {
      const female = CHARACTER_MODELS[this.appearance.model]?.female ?? false;
      this.leftHand.setAppearance(this.appearance, female);
      this.rightHand.setAppearance(this.appearance, female);
    }
  }

  /** Surowy odczyt stawów obu dłoni z kamery (bez gestów, bez animacji). */
  setHandPose(pair: HandPosePair): void {
    this.handPoses.L = pair.L;
    this.handPoses.R = pair.R;
  }

  /** Proporcje ekranu → dłonie pierwszoosobowe nie uciekają poza kadr. */
  setViewport(aspect: number): void {
    this.viewportAspect = aspect;
    // Wąski ekran w pionie ma bardzo małe pole widzenia w poziomie —
    // poszerzamy FOV viewmodelu, żeby obie dłonie zmieściły się w kadrze.
    this.viewFov = viewmodelFov(aspect);
    if (Math.abs(this.viewCamera.fov - this.viewFov) > 0.1) {
      this.viewCamera.fov = this.viewFov;
      this.viewCamera.updateProjectionMatrix();
    }
    this.leftHand.setViewport(aspect, this.viewFov);
    this.rightHand.setViewport(aspect, this.viewFov);
  }

  /** Jakość renderingu ustawiana przez World (adaptacyjnie lub ręcznie). */
  setQuality(profile: QualityProfile): void {
    this.quality = profile;
    this.syncFlashlightShadow();
    this.decor?.setQuality(profile);
    if (this.propsGroup) this.propsGroup.visible = profile.props;
  }

  private syncFlashlightShadow(): void {
    // Cień z latarki to jedyna dynamiczna mapa cieni w grze. Gdy latarka jest
    // zgaszona albo profil oszczędny, nie ma sensu jej renderować.
    this.flashlight.castShadow = Boolean(
      this.active && this.flashlightOn && (this.quality?.shadows ?? true),
    );
  }

  private ensureProps(): void {
    if (this.propsLoading || this.quality?.props === false) return;
    this.propsLoading = true;
    void loadRealProps(this.scene).then((group) => {
      this.propsGroup = group;
      if (this.quality && !this.quality.props) group.visible = false;
    }).catch(() => { this.propsLoading = false; });
  }

  /** Czułość rozglądania: na dotyku palec pokonuje krótszą drogę niż mysz. */
  setLookSensitivity(scale: number): void {
    this.lookScale = THREE.MathUtils.clamp(scale, 0.6, 2);
  }

  /** Przycisk „Bieg” na ekranie dotykowym. */
  setSprint(active: boolean): void {
    this.touchSprint = active;
  }

  private buildApparition(): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0xaeb9bd,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 1.0, 6, 12), material);
    body.position.y = 0.95;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), material);
    head.position.y = 1.72;
    this.apparition.add(body, head);
    this.apparition.visible = false;
    this.scene.add(this.apparition);
  }

  // --------------------------------------------------------------------- input

  private bindInput(): void {
    window.addEventListener('keydown', (event) => {
      if (!this.active || this.result) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      // Notatnik blokuje ruch, ale musi dawać się zamknąć tym samym klawiszem.
      if (this.journal) {
        if (event.code === 'KeyJ' || event.code === 'Tab') {
          event.preventDefault();
          this.toggleJournal();
        }
        return;
      }
      this.keys.add(event.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        event.preventDefault();
      }
      if (event.code === 'Digit1') this.selectTool(0);
      if (event.code === 'Digit2') this.selectTool(1);
      if (event.code === 'Digit3') this.selectTool(2);
      if (event.code === 'KeyF') this.toggleFlashlight();
      if (event.code === 'KeyP' && !event.repeat) this.photo();
      if (event.code === 'KeyJ' || event.code === 'Tab') {
        event.preventDefault();
        this.toggleJournal();
      }
      if (event.code === 'KeyE' && !event.repeat) this.beginInteract();
    });

    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
      if (event.code === 'KeyE') this.endInteract();
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.endInteract();
      this.mouseHeld = false;
      this.edgeX = 0;
      this.edgeY = 0;
    });

    // Dwa tryby myszy. Z pointer lockiem delty są nieograniczone krawędzią
    // ekranu (kluczowe przy wielu monitorach) i trafiają prosto na canvas —
    // bez filtra UI. Gdy kursor jest wolny, zachowujemy stary tryb: HUD i
    // notatnik pozostają klikalne, a rozglądanie ignoruje ruch nad przyciskami.
    // Gdy przeglądarka przejmie kursor, pierwsze 1–2 zdarzenia mousemove to
    // skok „wyśrodkowania kursora” (setki pikseli). Bez ignora kamera robiła
    // pół obrotu w ułamku sekundy, zanim gracz w ogóle dotknął myszy.
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === this.canvas) {
        this.skipLockMouse = 2;
        this.edgeX = 0;
        this.edgeY = 0;
      }
    });

    document.addEventListener('mousemove', (event) => {
      if (!this.active || this.journal || this.result || this.dragging) return;
      // Przy locku delty są wiarygodne (brak krawędzi monitora), więc tylko
      // odcinamy absurdalne skoki. Przy wolnym kursorze limit jest ciaśniejszy,
      // bo wyskok na drugi ekran potrafi wygenerować tysiące pikseli naraz.
      const locked = document.pointerLockElement === this.canvas;
      const limit = locked ? 600 : 180;
      const dx = THREE.MathUtils.clamp(event.movementX || 0, -limit, limit);
      const dy = THREE.MathUtils.clamp(event.movementY || 0, -limit, limit);
      if (locked) {
        if (this.skipLockMouse > 0) {
          this.skipLockMouse -= 1;
          return;
        }
        this.look(dx, dy);
        return;
      }
      // Wolny kursor: przy przytrzymanym przycisku ignorujemy filtr UI, żeby
      // dało się rozglądać także nad paskiem narzędzi i HUD-em.
      if (!this.mouseHeld) {
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, input, select, .game__top, .game__tools, .game__touch')) return;
      }
      this.look(dx, dy);
      this.trackEdge(event.clientX, event.clientY);
    });

    document.addEventListener('mousedown', (event) => {
      if (this.active && event.button === 0 && event.target === this.canvas) this.mouseHeld = true;
    });
    document.addEventListener('mouseup', () => { this.mouseHeld = false; this.edgeX = 0; this.edgeY = 0; });
    // Przeciąganie palcem (mobile) + przechwycenie myszy, gdy lock jest niedostępny.
    this.canvas.addEventListener('pointerdown', (event: PointerEvent) => {
      if (!this.active || this.journal || this.result) return;
      if (event.pointerType === 'mouse') {
        if (document.pointerLockElement !== this.canvas) {
          // Bez tego kursor uciekający na drugi monitor przerywałby strumień
          // mousemove nawet w trakcie trzymania przycisku.
          try { this.canvas.setPointerCapture(event.pointerId); } catch { /* brak wsparcia */ }
        }
        return;
      }
      this.dragging = true;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      // Przechwytujemy palec: rozglądanie nie urwie się, gdy przesunie się
      // nad HUD, przycisk albo poza sam canvas.
      try { this.canvas.setPointerCapture(event.pointerId); } catch { /* brak wsparcia */ }
    });
    this.canvas.addEventListener('pointermove', (event: PointerEvent) => {
      if (!this.dragging || !this.active || this.journal || this.result) return;
      this.look((event.clientX - this.lastPointer.x) * 1.4, (event.clientY - this.lastPointer.y) * 1.4);
      this.lastPointer = { x: event.clientX, y: event.clientY };
    });
    const endDrag = (event: PointerEvent): void => {
      this.dragging = false;
      try { this.canvas.releasePointerCapture(event.pointerId); } catch { /* jw. */ }
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
  }

  /** Zapisuje, jak blisko krawędzi okna jest kursor (do obrotu ciągłego). */
  private trackEdge(x: number, y: number): void {
    const edge = 72;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.edgeX = x < edge ? -(edge - x) / edge
      : x > w - edge ? (x - (w - edge)) / edge : 0;
    this.edgeY = y < edge ? -(edge - y) / edge
      : y > h - edge ? (y - (h - edge)) / edge : 0;
  }

  look(dx: number, dy: number): void {
    if (!this.active || this.journal || this.result) return;
    this.yawTarget -= dx * 0.0022 * this.lookScale;
    this.pitchTarget = THREE.MathUtils.clamp(
      this.pitchTarget - dy * 0.0022 * this.lookScale, -1.2, 1.2,
    );
  }

  setJoystick(x: number, y: number): void {
    this.joystick.x = x;
    this.joystick.y = y;
  }

  /** Wywołane z gestu użytkownika — odblokowuje syntezę dźwięku. */
  beginInput(): void {
    this.unlockAudio();
  }

  setInteracting(value: boolean): void {
    if (value) this.beginInteract();
    else this.endInteract();
  }

  // -----------------------------------------------------------------public API

  start(): void {
    this.ghost = GHOSTS[Math.floor(Math.random() * GHOSTS.length)];
    const spots = [...CLUE_SPOTS].sort(() => Math.random() - 0.5);
    this.hotspots.clear();
    this.ghost.signature.forEach((id, i) => {
      const [x, z] = spots[i];
      this.hotspots.set(id, new THREE.Vector3(x, 0, z));
    });
    this.statuses.clear();
    for (const evidence of EVIDENCE) this.statuses.set(evidence.id, 'unknown');

    this.position.set(0, 1.65, 7.0);
    this.yaw = 0;
    this.pitch = 0;
    this.yawTarget = 0;
    this.pitchTarget = 0;
    this.velocity.set(0, 0, 0);
    this.bob = 0;
    this.lastStep = 0;
    this.toolIndex = 0;
    this.reading = 0;
    this.scan = 0;
    this.interacting = false;
    this.nerves = 100;
    this.flashlightOn = true;
    this.flicker = 0;
    this.journal = false;
    this.result = null;
    this.seconds = 0;
    this.elapsed = 0;
    this.eventTimer = 11;
    this.apparitionTimer = 0;
    this.apparition.visible = false;
    this.hunting = false;
    this.huntTimer = 0;
    this.huntCooldown = 26;
    this.photos = 0;
    this.lastFrameTime = 0;
    this.lastYaw = 0;
    this.lookVelocity = 0;
    this.touchSprint = false;
    this.ensureProps();
    this.keys.clear();
    this.joystick.x = 0;
    this.joystick.y = 0;
    this.hint = 'Dom przy Wrzosowej 12. Znajdź trzy ślady i rozpoznaj zjawę.';
    this.unlockAudio();
    this.emit();
  }

  /** Wywoływane przez World przy zmianie trybu. */
  setActive(active: boolean): void {
    this.active = active;
    this.syncFlashlightShadow();
    if (!active) {
      this.keys.clear();
      this.interacting = false;
      this.hunting = false;
      this.huntTimer = 0;
      this.joystick.x = 0;
      this.joystick.y = 0;
    } else {
      this.start();
    }
  }

  selectTool(index: number): void {
    if (!this.active || this.result || this.journal) return;
    this.toolIndex = THREE.MathUtils.clamp(index, 0, TOOLS.length - 1);
    this.toolView.setTool(this.toolIndex);
    this.scan = 0;
    this.hint = `${TOOLS[this.toolIndex].name} w dłoni. Przytrzymaj E, żeby skanować.`;
    this.beep(520, 0.06, 0.025);
    this.emit();
  }

  cycleTool(): void {
    this.selectTool((this.toolIndex + 1) % TOOLS.length);
  }

  toggleFlashlight(): void {
    if (!this.active || this.result) return;
    this.flashlightOn = !this.flashlightOn;
    this.syncFlashlightShadow();
    this.beep(this.flashlightOn ? 380 : 260, 0.05, 0.02);
    this.emit();
  }

  toggleJournal(): void {
    if (!this.active || this.result) return;
    this.journal = !this.journal;
    this.interacting = false;
    this.scan = 0;
    this.hint = this.journal
      ? 'Notatnik: porównaj ślady z opisem zjaw i złóż raport.'
      : 'Szukaj śladów. Narzędzia: 1, 2, 3 — skanuj, przytrzymując E.';
    this.emit();
  }

  /** Foto-dowód: zapis klatki + przerwanie nalotu, jeśli uda się sfotografować zjawę. */
  photo(): void {
    if (!this.active || this.result || this.journal) return;
    this.photos += 1;
    this.onPhoto?.();
    this.beep(880, 0.09, 0.03);
    if (this.hunting) {
      this.endHunt('Uchwyciłeś zjawę na zdjęciu — nalot się cofnął.');
      this.nerves = Math.min(100, this.nerves + 8);
    } else if (this.reading > 0.5) {
      this.nerves = Math.min(100, this.nerves + 3);
      this.hint = 'Foto-dowód zapisany. Nerwy trochę wracają do równowagi.';
    } else {
      this.hint = 'Zdjęcie zapisane. Tu nic nie ma — szukaj dalej.';
    }
    this.emit();
  }

  private startHunt(): void {
    this.hunting = true;
    this.huntTimer = 13;
    this.huntCooldown = 30 + Math.random() * 18;
    this.hint = 'NALOT. Zjawa idzie w Twoją stronę — wyjdź frontowymi drzwiami albo zrób jej zdjęcie (P).';
    this.flicker = 1.2;
    this.knock();
    this.showApparition();
    this.emit();
  }

  private endHunt(reason: string): void {
    this.hunting = false;
    this.huntTimer = 0;
    this.apparitionTimer = 0;
    this.apparition.visible = false;
    this.hint = reason;
    this.emit();
  }

  selectGhost(id: string): void {
    if (!this.active || this.result || !this.journal) return;
    if (id === this.ghost.id) {
      this.finish(true, `Raport przyjęty. W domu zostawała ${this.ghost.name}.`);
      return;
    }
    this.nerves = Math.max(1, this.nerves - 24);
    this.hint = 'To nie pasuje do śladów. Nerwy kosztują Cię każdą pomyłkę.';
    this.beep(120, 0.28, 0.05);
    this.emit();
  }

  leave(): void {
    if (!this.active || this.result) return;
    this.finish(false, 'Wyszedłeś, zanim udało się rozpoznać zjawę.');
  }

  private finish(win: boolean, reason: string): void {
    const found = EVIDENCE.filter((entry) => this.statuses.get(entry.id) === 'found').map((e) => e.name);
    this.result = {
      win,
      ghost: this.ghost.name,
      reason,
      found,
      seconds: Math.round(this.seconds),
    };
    this.journal = false;
    this.interacting = false;
    this.hunting = false;
    this.apparition.visible = false;
    this.beep(win ? 660 : 150, 0.5, 0.05);
    this.emit();
    this.onFinish(this.result);
  }

  // -------------------------------------------------------------- mechanika

  private beginInteract(): void {
    if (!this.active || this.result || this.journal) return;
    // Wyjście znajduje się w szczelinie frontowej ściany.
    if (this.position.z > 8.35 && Math.abs(this.position.x) < 1.15) {
      this.leave();
      return;
    }
    this.interacting = true;
  }

  private endInteract(): void {
    // Postęp skanu wygasa powoli, więc krótkie puszczenie E nie kasuje pracy.
    this.interacting = false;
  }

  private currentHotspot(): THREE.Vector3 | undefined {
    return this.hotspots.get(TOOLS[this.toolIndex].id);
  }

  private blocked(x: number, z: number): boolean {
    const r = 0.33;
    if (x < -8.7 || x > 8.7 || z < -8.7 || z > 8.7) return true;
    for (const wall of this.walls) {
      if (x > wall.minX - r && x < wall.maxX + r && z > wall.minZ - r && z < wall.maxZ + r) {
        return true;
      }
    }
    return false;
  }

  private updateMovement(dt: number, realDt = dt): void {
    // Fallback dla przeglądarek / ramek, które odmówiły pointer locku: trzymając
    // przycisk przy krawędzi okna, gracz obraca się dalej bez końca — kursor
    // nie musi (i nie może) wychodzić na drugi monitor, żeby zrobić pełne 360°.
    if (this.mouseHeld && document.pointerLockElement !== this.canvas
      && (this.edgeX !== 0 || this.edgeY !== 0)) {
      // Zegar ścienny, nie dławiony dt: na wolnym komputerze obrót nie zwalnia
      // razem z animacją (inaczej fallback byłby bezużyteczny przy 2 FPS).
      const step = Math.min(realDt, 0.25);
      this.yawTarget -= this.edgeX * step * 2.8 * this.lookScale;
      this.pitchTarget = THREE.MathUtils.clamp(
        this.pitchTarget - this.edgeY * step * 1.9 * this.lookScale, -1.2, 1.2,
      );
    }
    // Rozglądanie z lekkim opóźnieniem: kamera nie „skacze” przy każdym
    // ruchu myszy, tylko dogania cel (jak głowa przy prawdziwym chodzie).
    const lookK = 1 - Math.exp(-dt * 18);
    this.yaw += (this.yawTarget - this.yaw) * lookK;
    this.pitch += (this.pitchTarget - this.pitch) * lookK;

    let ix = this.joystick.x;
    let iy = this.joystick.y;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iy += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iy -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
    const magnitude = Math.hypot(ix, iy);
    if (magnitude > 1) { ix /= magnitude; iy /= magnitude; }

    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchSprint;
    const speed = sprint ? 3.9 : 2.45;
    // Bez alokacji wektorów co klatkę: te dwa są polami klasy.
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const forward = this.forward;
    const right = this.right;
    const wishX = (forward.x * iy + right.x * ix) * speed;
    const wishZ = (forward.z * iy + right.z * ix) * speed;
    this.lookVelocity = dt > 0 ? THREE.MathUtils.clamp((this.yaw - this.lastYaw) / dt, -6, 6) : 0;
    this.lastYaw = this.yaw;
    // Bezwładność: rozpędzanie i hamowanie mają różne czasy, bez „ślizgu”.
    const accel = magnitude > 0.02 ? 8.5 : 12;
    const k = 1 - Math.exp(-dt * accel);
    this.velocity.x += (wishX - this.velocity.x) * k;
    this.velocity.z += (wishZ - this.velocity.z) * k;
    if (Math.abs(this.velocity.x) < 0.01) this.velocity.x = 0;
    if (Math.abs(this.velocity.z) < 0.01) this.velocity.z = 0;

    const dx = this.velocity.x * dt;
    const dz = this.velocity.z * dt;
    if (!this.blocked(this.position.x + dx, this.position.z)) this.position.x += dx;
    else this.velocity.x *= 0.35;
    if (!this.blocked(this.position.x, this.position.z + dz)) this.position.z += dz;
    else this.velocity.z *= 0.35;

    this.moving = Math.hypot(this.velocity.x, this.velocity.z) > 0.22;
    const stride = sprint ? 12.4 : 9.1;
    if (this.moving) {
      this.bob += dt * stride;
      const step = Math.floor(this.bob / Math.PI);
      if (step !== this.lastStep) {
        this.lastStep = step;
        this.step(sprint);
      }
    } else {
      this.bob += dt * 1.4;
    }

    // Kołysanie: pion, delikatny ruch na boki i przechył przy skręcie.
    const bobY = this.moving ? Math.sin(this.bob * 2) * 0.028 : Math.sin(this.bob) * 0.005;
    const sway = this.moving ? Math.sin(this.bob) * 0.014 : 0;
    this.camera.position.set(
      this.position.x + right.x * sway,
      this.position.y + bobY,
      this.position.z + right.z * sway,
    );
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = this.moving ? Math.sin(this.bob) * 0.009 : Math.sin(this.bob * 0.7) * 0.0015;

    const targetFov = sprint ? 78 : 74;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-dt * 4));
      this.camera.updateProjectionMatrix();
    }
  }

  /** Dłonie i narzędzie reagują na krok, obrót głowy, skan i odczyt z kamerki. */
  private updateViewmodel(realDt: number): void {
    const sway = this.moving ? Math.sin(this.bob) : Math.sin(this.elapsed * 1.3) * 0.12;
    const sprint = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchSprint) ? 1 : 0;
    const turn = this.lookVelocity;
    const L = this.leftMotion;
    const R = this.rightMotion;
    L.time = this.elapsed; L.sway = sway; L.turn = turn; L.sprint = sprint; L.scan = 0;
    R.time = this.elapsed; R.sway = -sway; R.turn = turn; R.sprint = sprint; R.scan = this.scan;
    this.leftHand.apply(this.handPoses.L, realDt, L);
    this.rightHand.apply(this.handPoses.R, realDt, R);
    // Narzędzie ma własną bezwładność: przy szybkim skręcie zostaje w tyle.
    this.toolView.root.position.y = 0.23 + this.scan * 0.05 + Math.sin(this.elapsed * 2) * 0.003;
    this.toolView.root.position.x = -0.055 - THREE.MathUtils.clamp(turn * 0.007, -0.025, 0.025);
    this.toolView.root.rotation.z = -0.22 + sway * 0.035 + THREE.MathUtils.clamp(turn * 0.012, -0.06, 0.06);
    this.screenTimer -= realDt;
    if (this.screenTimer <= 0) {
      this.screenTimer = 0.12;
      this.toolView.setReading(this.reading);
    }
  }

  private updateScan(dt: number): void {
    const hotspot = this.currentHotspot();
    const distance = hotspot ? Math.hypot(this.position.x - hotspot.x, this.position.z - hotspot.z) : 999;
    const base = Math.max(0, 1 - distance / 3.4);
    const wobble = 0.9 + Math.sin(this.elapsed * 5.3) * 0.08 + Math.sin(this.elapsed * 11) * 0.03;
    this.reading = THREE.MathUtils.clamp(base * wobble + Math.random() * 0.02, 0, 1);

    if (!this.interacting) {
      this.scan = Math.max(0, this.scan - dt * 0.9);
      return;
    }
    this.scan = Math.min(1, this.scan + dt / 1.2);
    if (this.scan < 1) return;

    const toolId = TOOLS[this.toolIndex].id;
    const already = this.statuses.get(toolId) ?? 'unknown';
    const peak = this.reading;
    this.interacting = false;
    this.scan = 0;
    if (already !== 'unknown') {
      this.hint = 'Ten ślad jest już opisany w notatniku. Spróbuj innego narzędzia.';
    } else if (peak > 0.45) {
      this.statuses.set(toolId, 'found');
      const name = EVIDENCE.find((e) => e.id === toolId)?.name ?? 'Ślad';
      this.hint = `Zapisano: ${name}. Otwórz notatnik klawiszem J.`;
      this.beep(760, 0.16, 0.045);
      this.nerves = Math.max(1, this.nerves - 3);
    } else {
      this.statuses.set(toolId, 'absent');
      this.hint = 'Brak odczytu. Ten ślad nie występuje w tym domu.';
      this.beep(300, 0.14, 0.03);
    }
    this.emit();
  }

  private updateEvents(dt: number): void {
    this.eventTimer -= dt;
    if (this.eventTimer <= 0) {
      this.eventTimer = 9 + Math.random() * 9;
      const roll = Math.random();
      if (roll < 0.3) {
        this.flicker = 0.9;
        this.hint = 'Latarka zatrzepotała…';
        this.knock();
      } else if (roll < 0.55) {
        this.nerves = Math.max(0, this.nerves - 5);
        this.hint = 'Nagle robi się zimno.';
        this.beep(190, 0.5, 0.035);
      } else if (roll < 0.8) {
        this.hint = 'Coś stoi w korytarzu.';
        this.showApparition();
        this.knock();
      } else {
        this.hint = 'Gdzieś za ścianą trzasnęły drzwi.';
        this.knock();
        this.nerves = Math.max(0, this.nerves - 3);
      }
      this.emit();
    }

    this.huntCooldown -= dt;
    if (!this.hunting && this.huntCooldown <= 0 && this.seconds > 18) this.startHunt();
    if (this.hunting) {
      this.huntTimer -= dt;
      if (this.huntTimer <= 0) {
        this.endHunt('Nalot minął. Dom znowu cichnie, ale nerwy zostały nadwyrężone.');
      }
    }

    if (this.flicker > 0) this.flicker = Math.max(0, this.flicker - dt);
    if (!this.hunting && this.apparitionTimer > 0) {
      this.apparitionTimer -= dt;
      const material = (this.apparition.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      material.opacity = Math.min(0.22, this.apparitionTimer * 0.22);
      if (this.apparitionTimer <= 0) this.apparition.visible = false;
    }

    const drain = (this.flashlightOn ? 0.28 : 0.62) + (this.hunting ? 1.5 : 0);
    this.nerves = Math.max(0, this.nerves - drain * dt);
    if (this.nerves <= 0 && !this.result) {
      this.finish(false, 'Nerwy nie wytrzymały. Musiałeś wyjść z domu.');
    }
  }

  private showApparition(): void {
    const angle = this.yaw + (Math.random() - 0.5) * 0.9;
    const distance = 4.5 + Math.random() * 2;
    const x = this.position.x - Math.sin(angle) * distance;
    const z = this.position.z - Math.cos(angle) * distance;
    this.apparition.position.set(THREE.MathUtils.clamp(x, -8, 8), 0, THREE.MathUtils.clamp(z, -8, 8));
    this.apparition.rotation.y = angle;
    this.apparition.visible = true;
    this.apparitionTimer = 2.6;
  }

  update(dt: number): void {
    if (!this.active) return;
    // Ruch używa dławionego dt (stabilna kolizja), a czas gry i skanowanie
    // tykają według zegara ściennego — wolny komputer nie wydłuża rozgrywki.
    const now = performance.now();
    const realDt = this.lastFrameTime ? Math.min((now - this.lastFrameTime) / 1000, 0.8) : dt;
    this.lastFrameTime = now;

    if (this.result || this.journal) {
      this.camera.position.copy(this.position);
      return;
    }

    this.elapsed += realDt;
    this.seconds += realDt;
    this.updateMovement(dt, realDt);
    this.updateScan(realDt);
    this.updateEvents(realDt);
    this.decor?.update(realDt, this.elapsed, this.flicker);
    this.updateViewmodel(realDt);

    if (this.hunting) {
      // Sylwetka podąża korytarzem, ale zatrzymuje się ~1,6 m od gracza.
      const dx = this.position.x - this.apparition.position.x;
      const dz = this.position.z - this.apparition.position.z;
      const distance = Math.hypot(dx, dz) || 1;
      if (distance > 1.6) {
        const step = Math.min(0.85 * realDt, distance - 1.6);
        this.apparition.position.x += (dx / distance) * step;
        this.apparition.position.z += (dz / distance) * step;
      }
      this.apparition.rotation.y = Math.atan2(dx, dz);
      this.apparition.visible = true;
      const material = (this.apparition.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      material.opacity = 0.3;
      if (this.position.z > 8.35 && Math.abs(this.position.x) < 1.15) {
        this.nerves = Math.max(1, this.nerves - 6);
        this.endHunt('Wypadłeś frontowymi drzwiami. Nalot Cię nie dopadł.');
      }
    }

    const flickerFactor = this.flicker > 0 && Math.random() > 0.55 ? 0.08 : 1;
    this.flashlight.intensity = this.flashlightOn ? 62 * flickerFactor : 0;

    this.emitTimer -= realDt;
    if (this.emitTimer <= 0) {
      this.emitTimer = 0.12;
      this.emit();
    }
  }

  // ----------------------------------------------------------- dźwięk (synteza)

  private unlockAudio(): void {
    try {
      if (!this.audio) this.audio = new AudioContext();
      if (this.audio.state === 'suspended') void this.audio.resume();
    } catch {
      this.audio = null;
    }
  }

  private beep(frequency: number, duration: number, gain: number): void {
    const audio = this.audio;
    if (!audio) return;
    try {
      const oscillator = audio.createOscillator();
      const volume = audio.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(60, frequency * 0.7), audio.currentTime + duration);
      volume.gain.setValueAtTime(gain, audio.currentTime);
      volume.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
      oscillator.connect(volume).connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + duration + 0.02);
    } catch {
      // Brak zgody na dźwięk nie przerywa rozgrywki.
    }
  }

  /** Krok na drewnianej podłodze: krótki, przefiltrowany szum. */
  private step(sprint: boolean): void {
    const audio = this.audio;
    if (!audio) return;
    try {
      const length = Math.floor(audio.sampleRate * (sprint ? 0.1 : 0.13));
      const buffer = audio.createBuffer(1, length, audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) {
        const decay = Math.pow(1 - i / length, 4);
        data[i] = (Math.random() * 2 - 1) * decay;
      }
      const source = audio.createBufferSource();
      const filter = audio.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 150 + Math.random() * 90;
      filter.Q.value = 0.8;
      const volume = audio.createGain();
      volume.gain.value = sprint ? 0.085 : 0.055;
      source.buffer = buffer;
      source.connect(filter).connect(volume).connect(audio.destination);
      source.start();
    } catch {
      // Brak zgody na dźwięk nie przerywa rozgrywki.
    }
  }

  private knock(): void {
    const audio = this.audio;
    if (!audio) return;
    try {
      const length = Math.floor(audio.sampleRate * 0.22);
      const buffer = audio.createBuffer(1, length, audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
      }
      const source = audio.createBufferSource();
      const filter = audio.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      const volume = audio.createGain();
      volume.gain.value = 0.14;
      source.buffer = buffer;
      source.connect(filter).connect(volume).connect(audio.destination);
      source.start();
    } catch {
      // jw.
    }
  }

  // ----------------------------------------------------------------- stan HUD

  private emit(): void {
    const evidence: EvidenceInfo[] = EVIDENCE.map((entry) => ({
      id: entry.id,
      name: entry.name,
      status: this.statuses.get(entry.id) ?? 'unknown',
    }));
    const canReport = evidence.every((entry) => entry.status !== 'unknown');
    this.onState({
      tools: TOOLS,
      toolIndex: this.toolIndex,
      reading: this.reading,
      scan: this.scan,
      evidence,
      ghosts: GHOSTS,
      nerves: Math.round(this.nerves),
      flashlight: this.flashlightOn,
      journal: this.journal,
      hint: this.hint,
      result: this.result,
      seconds: Math.floor(this.seconds),
      canReport,
      hunting: this.hunting,
      photos: this.photos,
    });
  }
}
