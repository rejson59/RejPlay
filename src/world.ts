import * as THREE from 'three';
import { createLabel, scaleLabelToDistance, type LabelHandle } from './avatar';
import { Character, type Appearance } from './character';
import type { HumanAssets } from './human';
import { HorrorGame, type HorrorResult, type HorrorState } from './horror';
import { BOTS, GAMES, PALETTE } from './games';
import { posesFromHands, type HandPosePair, type TrackedHand } from './hand-pose';
import type { OnlinePeer } from './online';

export type Mode = 'home' | 'lobby' | 'game';

interface Bot {
  avatar: Character;
  name: string;
  target: THREE.Vector3;
  timer: number;
  speed: number;
  waveTimer: number;
}

interface Portal {
  hit: THREE.Mesh;
  group: THREE.Group;
  label: LabelHandle;
  id: string;
  index: number;
}

interface Orb {
  mesh: THREE.Mesh;
  angle: number;
  radius: number;
  height: number;
  speed: number;
}

/** Ciemny, ziarnisty beton — bez neonowych kropek. */
function concreteTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#414647';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 14000; i++) {
    const v = Math.random();
    ctx.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.12)';
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 1.5);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 512; i += 128) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

function shadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(128, 128, 10, 128, 128, 126);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
  gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.28)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

function randomPoint(minRadius = 2, maxRadius = 8): THREE.Vector3 {
  const angle = Math.random() * Math.PI * 2;
  const radius = minRadius + Math.random() * (maxRadius - minRadius);
  return new THREE.Vector3(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
}

function approachAngle(current: number, target: number, factor: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * Math.min(1, factor);
}

/**
 * Jeden renderer, trzy sceny: podgląd awatara, lobby 3D oraz gra dochodzeniowa.
 * Dzięki temu przeglądarka trzyma tylko jeden kontekst WebGL.
 */
export class World {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly heroScene = new THREE.Scene();
  private readonly lobbyScene = new THREE.Scene();
  private readonly gameScene = new THREE.Scene();
  private readonly heroCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  private readonly lobbyCamera = new THREE.PerspectiveCamera(58, 1, 0.1, 200);
  readonly horror: HorrorGame;

  private readonly heroAvatar: Character;
  private readonly player: Character;
  private readonly bots: Bot[] = [];
  private readonly assets: HumanAssets | null;
  /** Prawdziwi gracze z Supabase Realtime — awatary w lobby 3D. */
  private readonly remote = new Map<string, {
    avatar: Character;
    target: THREE.Vector3;
    yaw: number;
    nick: string;
    appearance: Appearance;
  }>();
  private readonly portals: Portal[] = [];
  private readonly heroOrbs: Orb[] = [];
  private readonly centerpiece = new THREE.Group();
  private readonly heroPlatform = new THREE.Group();

  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly resizeObserver: ResizeObserver;
  private readonly keys = new Set<string>();
  private readonly joystick = { x: 0, y: 0 };
  private readonly camTarget = new THREE.Vector3();

  private container: HTMLElement | null = null;
  private mode: Mode = 'home';
  private elapsed = 0;
  private heroAngle = 0.55;
  /** Obrót samej postaci w edytorze — niezależny od kamery i świateł. */
  private previewAngle = 0.35;
  private yaw = 0.35;
  private pitch = 0.3;
  private dragging = false;
  private dragMoved = 0;
  private pointerStart = { x: 0, y: 0 };
  private pointerLast = { x: 0, y: 0 };
  private velocityY = 0;
  private jumpHeight = 0;
  private camReady = false;
  private previewClose = false;
  private portalHandler: ((id: string) => void) | undefined;
  private waveHandler: ((name: string) => void) | undefined;

  constructor(options: {
    color: string;
    name: string;
    assets: HumanAssets | null;
    appearance: Appearance;
    onHorrorState?: (state: HorrorState) => void;
    onHorrorFinish?: (result: HorrorResult) => void;
    onHorrorPhoto?: () => void;
  }) {
    this.assets = options.assets;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // potrzebne do zapisu zdjęć z trybu kamery
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = 'stage__canvas';

    this.horror = new HorrorGame({
      scene: this.gameScene,
      canvas: this.renderer.domElement,
      assets: this.assets,
      appearance: options.appearance,
      onState: (state) => options.onHorrorState?.(state),
      onFinish: (result) => options.onHorrorFinish?.(result),
      onPhoto: () => options.onHorrorPhoto?.(),
    });
    this.heroAvatar = new Character({
      color: options.color,
      assets: this.assets,
      templateIndex: options.appearance.model,
      appearance: options.appearance,
    });
    this.player = new Character({
      color: options.color,
      label: options.name,
      assets: this.assets,
      templateIndex: options.appearance.model,
      appearance: options.appearance,
    });

    this.buildHero();
    this.buildLobby();
    this.bindInput();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    window.addEventListener('resize', () => this.resize());
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------------------------------------------------------- public API

  mount(container: HTMLElement, mode: Mode): void {
    container.appendChild(this.renderer.domElement);
    this.container = container;
    this.resizeObserver.disconnect();
    this.resizeObserver.observe(container);
    this.setMode(mode);
    this.resize();
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.keys.clear();
    this.joystick.x = 0;
    this.joystick.y = 0;
    this.horror.setActive(mode === 'game');
    if (mode === 'lobby') {
      this.camReady = false;
    } else {
      this.setLabelsVisible(true);
    }
  }

  setPlayerColor(color: string): void {
    this.heroAvatar.setColor(color);
    this.player.setColor(color);
  }

  setPlayerName(name: string): void {
    this.player.setLabel(name);
  }

  setPlayerAppearance(appearance: Appearance): void {
    this.heroAvatar.setAppearance(appearance);
    this.player.setAppearance(appearance);
    this.horror.setAvatar(this.assets, appearance);
  }

  /** Pozycja lokalnego gracza wysyłana do Supabase Realtime presence. */
  getPlayerState(): { x: number; y: number; z: number; yaw: number } {
    const p = this.player.root.position;
    return { x: p.x, y: p.y, z: p.z, yaw: this.player.root.rotation.y };
  }

  /** Lista obecnych graczy → rigowane awatary w Atrium. */
  updatePeers(peers: OnlinePeer[]): void {
    const seen = new Set<string>();
    for (const peer of peers) {
      if (peer.mode !== 'lobby') continue;
      seen.add(peer.id);
      let entry = this.remote.get(peer.id);
      if (!entry || entry.appearance.model !== peer.appearance.model) {
        if (entry) {
          this.lobbyScene.remove(entry.avatar.root);
          entry.avatar.dispose();
        }
        const avatar = new Character({
          color: peer.color,
          label: peer.nick,
          assets: this.assets,
          templateIndex: peer.appearance.model,
          appearance: peer.appearance,
        });
        avatar.root.position.set(peer.x, peer.y, peer.z);
        this.lobbyScene.add(avatar.root);
        entry = {
          avatar,
          target: new THREE.Vector3(peer.x, peer.y, peer.z),
          yaw: peer.yaw,
          nick: peer.nick,
          appearance: peer.appearance,
        };
        this.remote.set(peer.id, entry);
      }
      entry.target.set(peer.x, peer.y, peer.z);
      entry.yaw = peer.yaw;
      entry.nick = peer.nick;
      entry.avatar.setLabel(peer.nick);
      entry.avatar.setColor(peer.color);
    }
    for (const [id, entry] of this.remote) {
      if (seen.has(id)) continue;
      this.lobbyScene.remove(entry.avatar.root);
      entry.avatar.dispose();
      this.remote.delete(id);
    }
  }

  get peerCount(): number {
    return this.remote.size;
  }

  /** Kąty palców z kamerki trafiają i na awatary, i na dłonie first-person. */
  setHandPose(hands: TrackedHand[], aspect: number): void {
    const pair = posesFromHands(hands, aspect);
    this.heroAvatar.setHandPose(pair);
    this.player.setHandPose(pair);
    this.horror.setHandPose(pair);
  }

  /** Bezpośredni odczyt (np. testy / inne źródła śledzenia). */
  setHandPosePair(pair: HandPosePair): void {
    this.heroAvatar.setHandPose(pair);
    this.player.setHandPose(pair);
    this.horror.setHandPose(pair);
  }

  /** Zbliżenie podglądu na potrzeby edytora postaci. */
  setPreviewClose(close: boolean): void {
    this.previewClose = close;
  }

  get hasHumans(): boolean {
    return this.assets !== null;
  }

  /** Machnięcie bez VR — mechanicznym odpowiednikiem gestu z kamerki. */
  wave(): void {
    if (this.mode === 'game') return;
    this.heroAvatar.wave();
    this.player.wave();
  }

  /** Emote z klawiatury (kamerka nie wyzwala już żadnych animacji). */
  playEmote(clipName: string): void {
    if (this.mode === 'game') return;
    this.heroAvatar.playEmote(clipName);
    this.player.playEmote(clipName);
  }

  private setLabelsVisible(visible: boolean): void {
    this.player.setLabelVisible(visible);
    for (const bot of this.bots) bot.avatar.setLabelVisible(visible);
  }

  /** Zwraca gotowe zdjęcie (data URL PNG) z aktualnej klatki. */
  capturePhoto(): string {
    if (this.mode === 'game') {
      this.renderer.render(this.gameScene, this.horror.camera);
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.horror.viewScene, this.horror.viewCamera);
      this.renderer.autoClear = true;
    } else {
      this.renderer.render(
        this.mode === 'home' ? this.heroScene : this.lobbyScene,
        this.mode === 'home' ? this.heroCamera : this.lobbyCamera,
      );
    }
    return this.renderer.domElement.toDataURL('image/png');
  }

  onPortalSelect(handler: (id: string) => void): void {
    this.portalHandler = handler;
  }

  onWave(handler: (name: string) => void): void {
    this.waveHandler = handler;
  }

  setJoystick(x: number, y: number): void {
    this.joystick.x = x;
    this.joystick.y = y;
  }

  jump(): void {
    if (this.jumpHeight > 0.001 || this.mode !== 'lobby') return;
    this.velocityY = 7.4;
  }

  // ------------------------------------------------------------------- scenes

  private buildHero(): void {
    this.heroScene.add(new THREE.AmbientLight(0xb9c0c4, 0.75));

    const key = new THREE.DirectionalLight(0xffe0bd, 2.1);
    key.position.set(3, 6, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 20;
    this.heroScene.add(key);

    const warm = new THREE.PointLight(0xffc98a, 42, 14, 2);
    warm.position.set(-3, 2.4, -2.5);
    const cool = new THREE.PointLight(0x8fa6b5, 20, 12, 2);
    cool.position.set(3, 1.4, -2);
    this.heroScene.add(warm, cool);

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.68, 0.28, 64),
      new THREE.MeshStandardMaterial({
        color: 0x24272a,
        roughness: 0.92,
        metalness: 0.02,
      }),
    );
    pedestal.position.y = -0.14;
    pedestal.receiveShadow = true;
    this.heroPlatform.add(pedestal);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1.5, 0.035, 12, 64),
      new THREE.MeshStandardMaterial({
        color: 0x8a6b45,
        emissive: 0x3a2a15,
        emissiveIntensity: 0.35,
        roughness: 0.7,
      }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.01;
    this.heroPlatform.add(rim);

    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 4.6),
      new THREE.MeshBasicMaterial({
        map: shadowTexture(),
        transparent: true,
        depthWrite: false,
      }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.006;
    this.heroPlatform.add(contact);
    this.heroScene.add(this.heroPlatform);

    this.heroScene.add(this.heroAvatar.root);

    PALETTE.forEach((_entry, i) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(i % 2 === 0 ? 0.075 : 0.05, 12, 8),
        new THREE.MeshBasicMaterial({
          color: 0xb9a37d,
          transparent: true,
          opacity: 0.3,
        }),
      );
      this.heroOrbs.push({
        mesh,
        angle: (i / PALETTE.length) * Math.PI * 2,
        radius: 1.75 + (i % 3) * 0.22,
        height: 0.7 + (i % 4) * 0.55,
        speed: 0.2 + (i % 3) * 0.07,
      });
      this.heroScene.add(mesh);
    });
  }

  private buildLobby(): void {
    this.lobbyScene.background = new THREE.Color(0x12171a);
    this.lobbyScene.fog = new THREE.FogExp2(0x12171a, 0.016);
    this.lobbyCamera.position.set(0, 5, 9);

    this.lobbyScene.add(new THREE.HemisphereLight(0x9fb3c0, 0x24282a, 2.05));
    this.lobbyScene.add(new THREE.AmbientLight(0xc2c8ca, 0.6));

    const moon = new THREE.DirectionalLight(0xb6c8d4, 2.6);
    moon.position.set(-9, 15, 7);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = -16;
    moon.shadow.camera.right = 16;
    moon.shadow.camera.top = 16;
    moon.shadow.camera.bottom = -16;
    moon.shadow.camera.near = 0.5;
    moon.shadow.camera.far = 50;
    moon.shadow.bias = -0.0006;
    this.lobbyScene.add(moon);

    // Trzy ciepłe latarnie zamiast fioletowo-miętowego blasku.
    for (const [x, z, power] of [[-7, -6, 72], [7, -6, 60], [0, 6, 46]] as const) {
      const lamp = new THREE.PointLight(0xffbd7d, power, 26, 2);
      lamp.position.set(x, 3.4, z);
      this.lobbyScene.add(lamp);
    }

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(12, 12.3, 0.7, 72),
      new THREE.MeshStandardMaterial({ color: 0x252a2b, roughness: 0.95, metalness: 0.02 }),
    );
    base.position.y = -0.35;
    base.receiveShadow = true;
    this.lobbyScene.add(base);

    const top = new THREE.Mesh(
      new THREE.CircleGeometry(11.9, 72),
      new THREE.MeshStandardMaterial({
        map: concreteTexture(),
        color: 0xc2c5c2,
        roughness: 0.95,
        metalness: 0.02,
      }),
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.005;
    top.receiveShadow = true;
    this.lobbyScene.add(top);

    const edge = new THREE.Mesh(
      new THREE.TorusGeometry(11.75, 0.14, 8, 96),
      new THREE.MeshStandardMaterial({ color: 0x3c4143, roughness: 0.92 }),
    );
    edge.rotation.x = Math.PI / 2;
    edge.position.y = 0.025;
    this.lobbyScene.add(edge);

    // Niskie słupki oświetleniowe na obwodzie placu.
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2f31, roughness: 0.8, metalness: 0.25 });
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: 0xffc98a,
      emissive: 0xffa452,
      emissiveIntensity: 0.45,
      roughness: 0.5,
    });
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const x = Math.sin(angle) * 11.1;
      const z = Math.cos(angle) * 11.1;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.85, 12), postMaterial);
      post.position.set(x, 0.43, z);
      post.castShadow = true;
      const glass = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), glassMaterial);
      glass.position.set(x, 0.94, z);
      this.lobbyScene.add(post, glass);
    }

    // Kamienny obelisk z mosiężną tablicą zamiast świecącej kuli.
    const stone = new THREE.MeshStandardMaterial({ color: 0x50565a, roughness: 0.95 });
    const brass = new THREE.MeshStandardMaterial({ color: 0x9a7b4c, roughness: 0.55, metalness: 0.6 });
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.25, 0.5, 8), stone);
    plinth.position.y = 0.25;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.82, 3.4, 8), stone);
    shaft.position.y = 2.2;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.68, 0.8, 8), brass);
    cap.position.y = 4.3;
    const plaque = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.6, 0.09), brass);
    plaque.position.set(0, 2.4, 0.7);
    this.centerpiece.add(plinth, shaft, cap, plaque);
    this.centerpiece.position.set(7.8, 0, -2.4);
    this.centerpiece.scale.setScalar(0.7);
    this.lobbyScene.add(this.centerpiece);

    // Portale = pozostałe gierki z katalogu
    const portalGames = GAMES.filter((game) => game.id !== 'plaza').slice(0, 3);
    // Bramy stoją w rzędzie na dalszym końcu placu, zwrócone do kamery.
    const angles = portalGames.map((_, i) => Math.PI + (i - (portalGames.length - 1) / 2) * 0.72);
    portalGames.forEach((game, i) => {
      const angle = angles[i] ?? (i / portalGames.length) * Math.PI * 2;
      const group = new THREE.Group();
      group.position.set(Math.sin(angle) * 8.6, 0, Math.cos(angle) * 8.6);
      group.rotation.y = angle + Math.PI;

      const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0x303638,
        roughness: 0.82,
        metalness: 0.22,
      });
      const frame = new THREE.Group();
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.7, 0.2), frameMaterial);
        post.position.set(side * 1.12, 1.5, 0);
        post.castShadow = true;
        frame.add(post);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.2, 0.22), frameMaterial);
      lintel.position.set(0, 2.94, 0);
      lintel.castShadow = true;
      frame.add(lintel);

      // Plakat z okładką gry, jeśli istnieje — zamiast neonowego pierścienia.
      const panelMaterial = new THREE.MeshStandardMaterial({
        color: game.color,
        roughness: 0.92,
        side: THREE.DoubleSide,
      });
      if (game.art) {
        const texture = new THREE.TextureLoader().load(game.art);
        texture.colorSpace = THREE.SRGBColorSpace;
        panelMaterial.map = texture;
        panelMaterial.color.set(0x9a9a9a);
      }
      const disc = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 2.45), panelMaterial);
      disc.position.set(0, 1.55, 0);

      const hit = new THREE.Mesh(
        new THREE.CircleGeometry(1.45, 32),
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      hit.position.set(0, 1.55, 0.03);
      hit.userData.gameId = game.id;

      const footMaterial = new THREE.MeshStandardMaterial({
        color: 0x303638,
        roughness: 0.8,
        metalness: 0.2,
      });
      for (const side of [-1, 1]) {
        const foot = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), footMaterial);
        foot.position.set(side * 0.82, 0.24, 0);
        foot.castShadow = true;
        group.add(foot);
      }

      const label = createLabel(game.title);
      label.sprite.position.set(0, 3.05, 0);

      group.add(frame, disc, hit, label.sprite);
      this.lobbyScene.add(group);
      this.portals.push({ hit, group, label, id: game.id, index: i });
    });

    // Gracz
    this.player.root.position.set(0, 0, 2.4);
    this.lobbyScene.add(this.player.root);

    // Boty — docelowo podmieniane na prawdziwych graczy z serwera
    BOTS.forEach((bot, i) => {
      const avatar = new Character({
        color: bot.color,
        label: bot.name,
        assets: this.assets,
        templateIndex: (i + 1) % 6,
        });
      avatar.root.position.copy(this.pickBotTarget());
      avatar.root.rotation.y = (i / BOTS.length) * Math.PI * 2;
      this.lobbyScene.add(avatar.root);
      this.bots.push({
        avatar,
        name: bot.name,
        target: this.pickBotTarget(),
        timer: 2 + Math.random() * 4,
        speed: 1.1 + Math.random() * 0.9,
        waveTimer: 6 + i * 4 + Math.random() * 8,
      });
    });
  }

  /** Boty trzymają się poza polem widzenia kamery, żeby nie zasłaniać placu. */
  private pickBotTarget(): THREE.Vector3 {
    const camera = this.lobbyCamera.position;
    for (let attempt = 0; attempt < 16; attempt++) {
      const point = randomPoint(2, 8.5);
      if (Math.hypot(point.x - camera.x, point.z - camera.z) > 5) return point;
    }
    return new THREE.Vector3(0, 0, -3);
  }

  // -------------------------------------------------------------------- input

  private bindInput(): void {
    window.addEventListener('keydown', (event) => {
      if (this.mode !== 'lobby') return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      this.keys.add(event.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        event.preventDefault();
      }
      if (event.code === 'Space') this.jump();
    });

    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (event: PointerEvent) => {
      if (this.mode === 'game') return;
      this.dragging = true;
      this.dragMoved = 0;
      this.pointerStart = { x: event.clientX, y: event.clientY };
      this.pointerLast = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener('pointermove', (event: PointerEvent) => {
      if (!this.dragging || this.mode === 'game') return;
      const dx = event.clientX - this.pointerLast.x;
      const dy = event.clientY - this.pointerLast.y;
      this.pointerLast = { x: event.clientX, y: event.clientY };
      this.dragMoved += Math.abs(dx) + Math.abs(dy);

      if (this.mode === 'home') {
        // W edytorze przeciąganie obraca POSTAĆ. Gdyby obracać też kamerę,
        // model stałby nieruchomo względem kadru i wyglądałoby to jak
        // przesuwanie się światła po scenie.
        if (this.previewClose) this.previewAngle -= dx * 0.008;
        else this.heroAngle -= dx * 0.008;
      } else {
        this.yaw -= dx * 0.005;
        this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.002, -0.12, 0.8);
      }
    });

    const endDrag = (event: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (
        this.mode === 'lobby' &&
        this.dragMoved < 8 &&
        Math.hypot(
          event.clientX - this.pointerStart.x,
          event.clientY - this.pointerStart.y,
        ) < 8
      ) {
        this.pickPortal(event.clientX, event.clientY);
      }
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
  }

  private pickPortal(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.lobbyCamera);
    const hits = this.raycaster.intersectObjects(
      this.portals.map((portal) => portal.hit),
      false,
    );
    if (hits.length > 0) {
      const id = hits[0].object.userData.gameId as string | undefined;
      if (id) this.portalHandler?.(id);
    }
  }

  private resize(): void {
    if (!this.container) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    for (const camera of [this.heroCamera, this.lobbyCamera, this.horror.camera, this.horror.viewCamera]) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }

  // --------------------------------------------------------------------- loop

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;

    if (this.mode === 'home') {
      this.updateHero();
      this.renderer.render(this.heroScene, this.heroCamera);
    } else if (this.mode === 'game') {
      this.horror.update(dt);
      this.renderer.render(this.gameScene, this.horror.camera);
      // Viewmodel ma własną scenę i światło; rysujemy go na wierzchu po czystym Z.
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.horror.viewScene, this.horror.viewCamera);
      this.renderer.autoClear = true;
    } else {
      this.updateLobby(dt);
      this.renderer.render(this.lobbyScene, this.lobbyCamera);
    }
  }

  private updateHero(): void {
    this.heroPlatform.visible = !this.previewClose;
    for (const orb of this.heroOrbs) orb.mesh.visible = !this.previewClose;
    this.heroAvatar.update(this.elapsed, 0);
    // W edytorze postać staje przodem do kamery, żeby było widać twarz,
    // kolor włosów i krój ubrania. Na stronie głównej obraca się powoli.
    this.heroAvatar.root.rotation.y = this.previewClose
      ? this.previewAngle
      : this.elapsed * 0.1;

    for (const orb of this.heroOrbs) {
      const angle = orb.angle + this.elapsed * orb.speed;
      orb.mesh.position.set(
        Math.sin(angle) * orb.radius,
        orb.height + Math.sin(this.elapsed * 1.3 + orb.angle) * 0.14,
        Math.cos(angle) * orb.radius,
      );
    }

    const heroDistance = this.previewClose ? 3.15 : 4.2;
    const cameraAngle = this.previewClose ? 0.35 : this.heroAngle;
    this.heroCamera.position.set(
      Math.sin(cameraAngle) * heroDistance,
      this.previewClose ? 1.55 : 2.1,
      Math.cos(cameraAngle) * heroDistance,
    );
    this.heroCamera.lookAt(0, this.previewClose ? 1.18 : 0.95, 0);
  }

  private updateLobby(dt: number): void {
    let ix = this.joystick.x;
    let iy = this.joystick.y;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iy += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iy -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;

    const magnitude = Math.hypot(ix, iy);
    const intensity = Math.min(1, magnitude);
    if (magnitude > 1) {
      ix /= magnitude;
      iy /= magnitude;
    }

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const direction = forward.multiplyScalar(iy).add(right.multiplyScalar(ix));
    if (direction.lengthSq() > 0) direction.normalize();

    const position = this.player.root.position;
    position.addScaledVector(direction, 5.2 * dt);
    const radial = Math.hypot(position.x, position.z);
    if (radial > 10.4) {
      const scale = 10.4 / radial;
      position.x *= scale;
      position.z *= scale;
    }

    if (this.velocityY !== 0 || this.jumpHeight > 0) {
      this.velocityY -= 18 * dt;
      this.jumpHeight += this.velocityY * dt;
      if (this.jumpHeight <= 0) {
        this.jumpHeight = 0;
        this.velocityY = 0;
      }
    }
    position.y = this.jumpHeight;

    if (direction.lengthSq() > 0) {
      const targetYaw = Math.atan2(direction.x, direction.z);
      this.player.root.rotation.y = approachAngle(
        this.player.root.rotation.y,
        targetYaw,
        dt * 9,
      );
    }
    this.player.update(this.elapsed, intensity);

    for (const entry of this.remote.values()) {
      entry.avatar.root.position.lerp(entry.target, 1 - Math.exp(-dt * 8));
      entry.avatar.root.rotation.y = approachAngle(entry.avatar.root.rotation.y, entry.yaw, dt * 9);
      entry.avatar.update(this.elapsed, 0.12);
    }

    for (const bot of this.bots) {
      bot.timer -= dt;
      bot.waveTimer -= dt;
      if (bot.waveTimer <= 0) {
        bot.avatar.wave();
        this.waveHandler?.(bot.name);
        bot.waveTimer = 20 + Math.random() * 30;
      }
      const botPosition = bot.avatar.root.position;
      const radialBot = Math.hypot(botPosition.x, botPosition.z);
      if (radialBot > 9.2) {
        const scale = 9.2 / radialBot;
        botPosition.x *= scale;
        botPosition.z *= scale;
      }
      const cameraDistance = Math.hypot(
        botPosition.x - this.lobbyCamera.position.x,
        botPosition.z - this.lobbyCamera.position.z,
      );
      if (cameraDistance < 4) {
        bot.target = this.pickBotTarget();
        bot.timer = 3 + Math.random() * 3;
      }
      const toTarget = bot.target.clone().sub(botPosition);
      toTarget.y = 0;
      const distance = toTarget.length();
      let moving = 0;
      if (distance > 0.2 && bot.timer > 0) {
        toTarget.normalize();
        botPosition.addScaledVector(toTarget, Math.min(bot.speed * dt, distance));
        bot.avatar.root.rotation.y = approachAngle(
          bot.avatar.root.rotation.y,
          Math.atan2(toTarget.x, toTarget.z),
          dt * 4,
        );
        moving = 0.8;
      } else {
        bot.target = this.pickBotTarget();
        bot.timer = 2.5 + Math.random() * 4;
      }
      bot.avatar.update(this.elapsed, moving);
    }

    // Proste odpychanie: boty nie stają w jednym punkcie (i nicki się nie zlepiają).
    for (let i = 0; i < this.bots.length; i++) {
      for (let j = i + 1; j < this.bots.length; j++) {
        const a = this.bots[i].avatar.root.position;
        const b = this.bots[j].avatar.root.position;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const gap = Math.hypot(dx, dz);
        const minGap = 2.8;
        if (gap > 0.001 && gap < minGap) {
          const push = (minGap - gap) * Math.min(1, dt * 4);
          const nx = (dx / gap) * push;
          const nz = (dz / gap) * push;
          a.x -= nx;
          a.z -= nz;
          b.x += nx;
          b.z += nz;
        }
      }
    }

    this.centerpiece.rotation.y = Math.sin(this.elapsed * 0.08) * 0.05;

    const target = new THREE.Vector3(position.x, position.y + 1.3, position.z);
    let desired: THREE.Vector3;
    let lookAt: THREE.Vector3;

    const distance = 8.2 * Math.cos(this.pitch * 0.55);
    desired = new THREE.Vector3(
      target.x + Math.sin(this.yaw) * distance,
      target.y + 2.1 + this.pitch * 5.5,
      target.z + Math.cos(this.yaw) * distance,
    );
    lookAt = target;

    if (!this.camReady) {
      this.lobbyCamera.position.copy(desired);
      this.camTarget.copy(lookAt);
      this.camReady = true;
    } else {
      this.lobbyCamera.position.lerp(desired, 1 - Math.exp(-dt * 6));
      this.camTarget.lerp(lookAt, 1 - Math.exp(-dt * 9));
    }
    this.lobbyCamera.lookAt(this.camTarget);

    // Etykiety trzymają stały rozmiar na ekranie, nawet gdy ktoś podejdzie blisko.
    const camera = this.lobbyCamera.position;
    this.player.scaleLabel(camera.distanceTo(this.player.root.position));
    for (const bot of this.bots) {
      bot.avatar.scaleLabel(camera.distanceTo(bot.avatar.root.position));
    }
    for (const entry of this.remote.values()) {
      entry.avatar.scaleLabel(camera.distanceTo(entry.avatar.root.position));
    }
    for (const portal of this.portals) {
      scaleLabelToDistance(portal.label, camera.distanceTo(portal.group.position), 0.95);
    }
  }
}
