import * as THREE from 'three';

/**
 * „Zimny Ślad” — autorska, pierwszoosobowa gra dochodzeniowa.
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
}

export interface HorrorOptions {
  scene: THREE.Scene;
  canvas: HTMLCanvasElement;
  onState: (state: HorrorState) => void;
  onFinish: (result: HorrorResult) => void;
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

// ------------------------------------------------------------- tekstury (canvas)

function planksTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#3a3028';
  ctx.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 8; row++) {
    const y = row * 64;
    const shade = 42 + Math.floor(Math.random() * 22);
    ctx.fillStyle = `rgb(${shade + 16}, ${shade + 5}, ${shade - 8})`;
    ctx.fillRect(0, y + 2, 512, 60);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
    for (let i = 0; i < 24; i++) {
      ctx.strokeStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.09})`;
      ctx.lineWidth = 1;
      const gy = y + 6 + Math.random() * 52;
      ctx.beginPath();
      ctx.moveTo(Math.random() * 512, gy);
      ctx.lineTo(Math.random() * 512, gy + (Math.random() - 0.5) * 4);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  return texture;
}

function wallpaperTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#6c6559';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(40,35,30,0.28)';
  ctx.lineWidth = 3;
  for (let x = 0; x < 256; x += 32) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke();
  }
  for (let i = 0; i < 2200; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.09)';
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  // Zacieki i ubytki tapety.
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = 'rgba(28,24,22,0.16)';
    const x = Math.random() * 256;
    const y = Math.random() * 180;
    ctx.beginPath();
    ctx.ellipse(x, y, 8 + Math.random() * 22, 20 + Math.random() * 60, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 1);
  return texture;
}

// ------------------------------------------------------------------- silnik gry

export class HorrorGame {
  readonly camera = new THREE.PerspectiveCamera(74, 1, 0.05, 70);

  private readonly scene: THREE.Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly onState: (state: HorrorState) => void;
  private readonly onFinish: (result: HorrorResult) => void;

  private readonly position = new THREE.Vector3(0, 1.65, 7.0);
  private readonly walls: Box[] = [];
  private readonly hotspots = new Map<string, THREE.Vector3>();
  private readonly keys = new Set<string>();
  private readonly joystick = { x: 0, y: 0 };
  private readonly flashlight: THREE.SpotLight;
  private readonly apparition = new THREE.Group();
  private readonly statuses = new Map<string, 'unknown' | 'found' | 'absent'>();

  private yaw = 0;
  private pitch = 0;
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

    this.camera.rotation.order = 'YXZ';
    this.scene.background = new THREE.Color(0x0a0d0f);
    this.scene.fog = new THREE.FogExp2(0x0a0d0f, 0.03);

    this.scene.add(new THREE.AmbientLight(0x8d9aa6, 0.55));
    const moon = new THREE.DirectionalLight(0x6f88a0, 0.5);
    moon.position.set(-6, 9, -4);
    this.scene.add(moon);

    this.flashlight = new THREE.SpotLight(0xffe4bd, 62, 19, 0.56, 0.65, 1.3);
    this.flashlight.position.set(0.16, -0.14, 0);
    this.flashlight.target.position.set(0, -0.06, -1);
    this.camera.add(this.flashlight, this.flashlight.target);
    this.scene.add(this.camera);

    this.buildHouse();
    this.buildApparition();
    this.bindInput();
    this.emit();
  }

  // ------------------------------------------------------------------- scena 3D

  private buildHouse(): void {
    const floorTexture = planksTexture();
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18),
      new THREE.MeshStandardMaterial({ map: floorTexture, color: 0x9a9188, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18),
      new THREE.MeshStandardMaterial({ color: 0x24211e, roughness: 1, side: THREE.DoubleSide }),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 3.2;
    this.scene.add(ceiling);

    const wallTexture = wallpaperTexture();
    const wallMaterial = new THREE.MeshStandardMaterial({
      map: wallTexture,
      color: 0xa39c8f,
      roughness: 0.96,
    });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x3a332c, roughness: 0.9 });

    for (const [x1, z1, x2, z2] of WALL_SEGMENTS) {
      const length = Math.hypot(x2 - x1, z2 - z1);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(length, 3.2, 0.16), wallMaterial);
      wall.position.set((x1 + x2) / 2, 1.6, (z1 + z2) / 2);
      wall.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      wall.receiveShadow = true;
      this.scene.add(wall);

      const trim = new THREE.Mesh(new THREE.BoxGeometry(length, 0.14, 0.2), trimMaterial);
      trim.position.set((x1 + x2) / 2, 0.12, (z1 + z2) / 2);
      trim.rotation.y = wall.rotation.y;
      this.scene.add(trim);

      this.walls.push({
        minX: Math.min(x1, x2) - 0.08,
        maxX: Math.max(x1, x2) + 0.08,
        minZ: Math.min(z1, z2) - 0.08,
        maxZ: Math.max(z1, z2) + 0.08,
      });
    }

    // Zimne światło w oknach — jedyne źródła poza latarką.
    const windowMaterial = new THREE.MeshBasicMaterial({ color: 0x2b4252 });
    const windows: Array<[number, number, number]> = [
      [-9, 1.8, -4.5], [9, 1.8, 4.5], [-4.5, 1.8, -9],
    ];
    for (const [x, y, z] of windows) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.15), windowMaterial);
      pane.position.set(x === -4.5 ? x : x + (x < 0 ? 0.09 : -0.09), y, z + (z === -9 ? 0.09 : 0));
      pane.rotation.y = x === -4.5 ? 0 : Math.PI / 2;
      this.scene.add(pane);
      const light = new THREE.PointLight(0x7191a8, 3.2, 7, 2);
      light.position.set(x + (x < 0 ? 0.6 : -0.6), y, z + (z < 0 ? 0.6 : 0));
      this.scene.add(light);
    }

    this.addFurniture();
  }

  private addFurniture(): void {
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3b2e, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2e2b29, roughness: 0.92 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x5b5449, roughness: 1 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x555a5c, roughness: 0.6, metalness: 0.35 });

    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    };

    // Salon (lewy tył): stół, krzesła, regał.
    box(2.3, 0.12, 1.2, -5.0, 0.78, -5.4, wood);
    for (const dx of [-0.95, 0.95]) {
      for (const dz of [-0.45, 0.45]) box(0.12, 0.75, 0.12, -5.0 + dx, 0.38, -5.4 + dz, wood);
    }
    box(0.5, 0.08, 0.5, -5.9, 0.44, -3.4, cloth);
    box(0.5, 0.45, 0.5, -5.9, 0.23, -3.4, wood);
    box(2.0, 2.1, 0.35, -8.5, 1.05, -6.6, wood);
    for (let i = 0; i < 4; i++) box(1.9, 0.06, 0.3, -8.5, 0.4 + i * 0.5, -6.4, dark);

    // Sypialnia (prawy tył): łóżko i szafka.
    box(2.2, 0.35, 1.5, 5.4, 0.3, -6.2, wood);
    box(2.1, 0.18, 1.4, 5.4, 0.56, -6.2, cloth);
    box(0.6, 0.7, 0.5, 7.7, 0.35, -7.4, wood);
    box(1.6, 0.04, 1.2, 5.4, 0.02, -4.0, cloth);

    // Kuchnia (lewy przód): blat i skrzynie.
    box(3.4, 0.9, 0.6, -5.6, 0.45, 8.3, wood);
    box(3.5, 0.08, 0.7, -5.6, 0.94, 8.3, metal);
    box(0.8, 0.8, 0.8, -2.7, 0.4, 6.9, wood);
    box(0.7, 0.65, 0.7, -2.7, 1.12, 6.9, wood);

    // Przedpokój / prawy przód: wieszak i dywan.
    box(0.14, 2.0, 0.14, 7.6, 1.0, 6.8, wood);
    box(1.5, 0.08, 0.14, 7.6, 1.95, 6.8, wood);
    box(2.4, 0.03, 1.5, 4.6, 0.02, 5.4, cloth);

    // Lampa naftowa na stole — mały, ciepły punkt w ciemności.
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xffc07a, emissive: 0xffa347, emissiveIntensity: 0.8 }),
    );
    lamp.position.set(-5.0, 1.0, -5.4);
    this.scene.add(lamp);
    const lampLight = new THREE.PointLight(0xffb469, 5, 5, 2);
    lampLight.position.copy(lamp.position);
    this.scene.add(lampLight);
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
    });

    document.addEventListener('mousemove', (event) => {
      if (!this.active || this.journal || this.result) return;
      if (document.pointerLockElement === this.canvas) {
        this.look(event.movementX, event.movementY);
      }
    });

    this.canvas.addEventListener('click', () => {
      if (!this.active || this.journal || this.result) return;
      if (document.pointerLockElement !== this.canvas) {
        void this.canvas.requestPointerLock?.();
      }
    });

    // Przeciąganie palcem / myszką bez pointer locku (mobile i fallback).
    this.canvas.addEventListener('pointerdown', (event: PointerEvent) => {
      if (!this.active || this.journal || this.result) return;
      if (event.pointerType === 'mouse' && document.pointerLockElement === this.canvas) return;
      this.dragging = true;
      this.lastPointer = { x: event.clientX, y: event.clientY };
    });
    this.canvas.addEventListener('pointermove', (event: PointerEvent) => {
      if (!this.dragging || !this.active || this.journal || this.result) return;
      this.look((event.clientX - this.lastPointer.x) * 1.4, (event.clientY - this.lastPointer.y) * 1.4);
      this.lastPointer = { x: event.clientX, y: event.clientY };
    });
    const endDrag = (): void => { this.dragging = false; };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
  }

  look(dx: number, dy: number): void {
    if (!this.active || this.journal || this.result) return;
    this.yaw -= dx * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0022, -1.2, 1.2);
  }

  setJoystick(x: number, y: number): void {
    this.joystick.x = x;
    this.joystick.y = y;
  }

  /** Musi być wywołane w obrębie gestu użytkownika (kliknięcie przycisku). */
  lockPointer(): void {
    if (!this.active || this.journal || this.result) return;
    this.unlockAudio();
    if (document.pointerLockElement !== this.canvas) {
      try {
        void this.canvas.requestPointerLock?.();
      } catch {
        // Brak pointer locku nie blokuje gry — działa też przeciąganie.
      }
    }
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
    this.lastFrameTime = 0;
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
    if (!active) {
      this.keys.clear();
      this.interacting = false;
      this.joystick.x = 0;
      this.joystick.y = 0;
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    } else {
      this.start();
    }
  }

  selectTool(index: number): void {
    if (!this.active || this.result || this.journal) return;
    this.toolIndex = THREE.MathUtils.clamp(index, 0, TOOLS.length - 1);
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
    this.beep(this.flashlightOn ? 380 : 260, 0.05, 0.02);
    this.emit();
  }

  toggleJournal(): void {
    if (!this.active || this.result) return;
    this.journal = !this.journal;
    this.interacting = false;
    this.scan = 0;
    if (this.journal && document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.hint = this.journal
      ? 'Notatnik: porównaj ślady z opisem zjaw i złóż raport.'
      : 'Szukaj śladów. Narzędzia: 1, 2, 3 — skanuj, przytrzymując E.';
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
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
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

  private updateMovement(dt: number): void {
    let ix = this.joystick.x;
    let iy = this.joystick.y;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iy += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iy -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
    const magnitude = Math.hypot(ix, iy);
    if (magnitude > 1) { ix /= magnitude; iy /= magnitude; }
    this.moving = magnitude > 0.02;

    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = (sprint ? 3.9 : 2.45) * dt;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const dx = (forward.x * iy + right.x * ix) * speed;
    const dz = (forward.z * iy + right.z * ix) * speed;

    if (!this.blocked(this.position.x + dx, this.position.z)) this.position.x += dx;
    if (!this.blocked(this.position.x, this.position.z + dz)) this.position.z += dz;

    if (this.moving) this.bob += dt * (sprint ? 13 : 9);
    const bobY = this.moving ? Math.sin(this.bob) * 0.035 : 0;
    this.camera.position.set(this.position.x, this.position.y + bobY, this.position.z);
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = this.moving ? Math.sin(this.bob * 0.5) * 0.006 : 0;
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

    if (this.flicker > 0) this.flicker = Math.max(0, this.flicker - dt);
    if (this.apparitionTimer > 0) {
      this.apparitionTimer -= dt;
      const material = (this.apparition.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      material.opacity = Math.min(0.22, this.apparitionTimer * 0.22);
      if (this.apparitionTimer <= 0) this.apparition.visible = false;
    }

    const drain = this.flashlightOn ? 0.28 : 0.62;
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
    this.updateMovement(dt);
    this.updateScan(realDt);
    this.updateEvents(realDt);

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
    });
  }
}
