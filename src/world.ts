import * as THREE from 'three';
import { createLabel, scaleLabelToDistance, type LabelHandle } from './avatar';
import { Character, type Appearance } from './character';
import type { HumanAssets } from './human';
import { HorrorGame, type HorrorResult, type HorrorState } from './horror';
import { GAMES, PALETTE } from './games';
import { neutralHandPosePair, posesFromHands, type HandPosePair, type TrackedHand } from './hand-pose';
import type { OnlinePeer } from './online';
import { FirstPersonHands } from './first-person-hands';
import { loadLobbyGallery, loadLobbyScenery, updateLobbyGallery } from './real-scenery';
import { buildPark } from './park';
import {
  QualityManager,
  deviceHints,
  initialProfile,
  type QualityProfile,
} from './performance';

export type Mode = 'home' | 'lobby' | 'game';

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

function approachAngle(current: number, target: number, factor: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * Math.min(1, factor);
}

/**
 * Jeden renderer, trzy sceny: podgląd awatara, Lobby oraz gra dochodzeniowa.
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
  private readonly assets: HumanAssets | null;
  /** Prawdziwi gracze z Supabase Realtime — awatary w Lobby. */
  private readonly remote = new Map<string, {
    avatar: Character;
    target: THREE.Vector3;
    yaw: number;
    nick: string;
    appearance: Appearance;
  }>();
  private readonly portals: Portal[] = [];
  private readonly portalHits: THREE.Object3D[] = [];
  private readonly centerNdc = new THREE.Vector2(0, 0);
  private portalAimed = false;
  private lobbySkipMouse = 0;
  private readonly heroOrbs: Orb[] = [];
  private readonly centerpiece = new THREE.Group();
  private readonly heroPlatform = new THREE.Group();
  /** Viewmodel first-person w Lobby (te same dłonie awatara, bez narzędzia). */
  private readonly lobbyHands: FirstPersonHands;
  private firstPerson = true;
  private lastLobbyYaw = 0;
  private lastHandPair: HandPosePair = neutralHandPosePair();

  private readonly raycaster = new THREE.Raycaster();
  private readonly resizeObserver: ResizeObserver;
  private readonly keys = new Set<string>();
  private readonly joystick = { x: 0, y: 0 };
  /** Ruch z przechyłu głowy (CameraRig), sumowany z klawiaturą / dotykiem. */
  private readonly cameraMove = { x: 0, y: 0 };
  private readonly camTarget = new THREE.Vector3();
  private readonly qualityManager: QualityManager;
  private readonly shadowLights: THREE.DirectionalLight[] = [];
  private readonly vForward = new THREE.Vector3();
  private readonly vRight = new THREE.Vector3();
  private readonly vDirection = new THREE.Vector3();
  private readonly vDesired = new THREE.Vector3();
  private readonly vLookAt = new THREE.Vector3();
  private readonly vTarget = new THREE.Vector3();
  private visibilityObserver: IntersectionObserver | null = null;
  private stageVisible = true;
  private lastRenderAt = 0;
  private shadowsEnabled: boolean | null = null;

  private container: HTMLElement | null = null;
  private mode: Mode = 'home';
  private elapsed = 0;
  private heroAngle = 0.55;
  /** Obrót samej postaci w edytorze — niezależny od kamery i świateł. */
  private previewAngle = 0.35;
  private yaw = 0.35;
  private pitch = 0.3;
  /** Osobny kąt patrzenia w FP: kamera 3D unosi się w górę przy tym samym
   *  kącie, który w first-person oznaczałby gapienie się w ciemne niebo. */
  private lookPitch = -0.08;
  private dragging = false;
  private dragMoved = 0;
  private pointerStart = { x: 0, y: 0 };
  private pointerLast = { x: 0, y: 0 };
  private velocityY = 0;
  private jumpHeight = 0;
  private camReady = false;
  private previewClose = false;
  private portalHandler: ((id: string) => void) | undefined;

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
    const initial = initialProfile();
    this.renderer = new THREE.WebGLRenderer({
      // Antyaliasingu nie da się przełączyć po utworzeniu kontekstu, więc
      // słabe urządzenia startują bez MSAA (oszczędność całej klatki).
      antialias: initial.antialias,
      alpha: true,
      powerPreference: 'high-performance',
      // Foto-dowód jest wyłącznie zdarzeniem w grze (bez pliku PNG), więc
      // nie musimy trzymać bufora klatki przy każdym rysowaniu.
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, initial.maxDpr));
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

    this.lobbyHands = new FirstPersonHands({
      assets: this.assets,
      appearance: options.appearance,
    });
    this.lobbyCamera.rotation.order = 'YXZ';

    this.horror.setLookSensitivity(deviceHints().coarse ? 1.15 : 1);
    this.buildHero();
    this.buildLobby();
    this.bindInput();
    this.collectShadowLights();
    this.qualityManager = new QualityManager((profile, dpr) => this.applyQuality(profile, dpr));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------------------------------------------------------- public API

  mount(container: HTMLElement, mode: Mode): void {
    container.appendChild(this.renderer.domElement);
    this.container = container;
    this.resizeObserver.disconnect();
    this.resizeObserver.observe(container);
    this.visibilityObserver?.disconnect();
    this.stageVisible = true;
    if (typeof IntersectionObserver !== 'undefined') {
      this.visibilityObserver = new IntersectionObserver(
        (entries) => { this.stageVisible = entries[0]?.isIntersecting ?? true; },
        { threshold: 0.01 },
      );
      this.visibilityObserver.observe(container);
    }
    this.setMode(mode);
    this.resize();
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.keys.clear();
    this.joystick.x = 0;
    this.joystick.y = 0;
    this.horror.setActive(mode === 'game');
    // W first-person własna sylwetka zasłaniałaby kamerę. Pozycja i tak jest
    // wysyłana do Presence, więc inni gracze widzą nasz awatar normalnie.
    this.player.root.visible = !(mode === 'lobby' && this.firstPerson);
    if (mode === 'lobby') {
      this.camReady = false;
    } else {
      this.setLabelsVisible(true);
    }
  }

  /** Celownik FP trafia w portal? main.ts podświetla wtedy krzyżyk. */
  get crosshairOnPortal(): boolean {
    return this.portalAimed;
  }

  /** Klik w wolny kursor: true, jeśli trafił w portal (wtedy nie lockujemy). */
  tryLobbyClick(clientX: number, clientY: number): boolean {
    if (this.mode !== 'lobby') return false;
    return this.pickPortal(clientX, clientY);
  }

  /** Klik przy przechwyconym kursorze: użyj tego, co jest na środku ekranu. */
  useFirstPersonPortal(): boolean {
    if (this.mode !== 'lobby' || !this.firstPerson) return false;
    this.lobbyCamera.updateMatrixWorld();
    const rect = this.renderer.domElement.getBoundingClientRect();
    return this.pickPortal(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  /** Lobby: widok z oczu (domyślny) albo klasyczna kamera za plecami. */
  get firstPersonView(): boolean {
    return this.firstPerson;
  }

  /**
   * Sterowanie bez klawiatury i myszy. Sygnały z CameraRig mają dokładnie
   * tę samą semantykę co ruch myszą (lookX/lookY w px/s) i joystick
   * (moveX/moveY w −1..1), więc nie omijamy istniejących zabezpieczeń.
   */
  applyCameraControl(ctrl: {
    lookX: number; lookY: number; moveX: number; moveY: number;
  }, dt: number): void {
    this.cameraMove.x = ctrl.moveX;
    this.cameraMove.y = ctrl.moveY;
    if (this.mode === 'game') {
      if (this.horror) {
        this.horror.look(ctrl.lookX * dt, ctrl.lookY * dt);
        this.horror.setCameraJoystick(ctrl.moveX, ctrl.moveY);
      }
      return;
    }
    if (this.mode === 'lobby' && this.firstPerson) {
      this.yaw -= ctrl.lookX * dt * 0.005;
      this.lookPitch = THREE.MathUtils.clamp(
        this.lookPitch - ctrl.lookY * dt * 0.002, -1.1, 1.1,
      );
    }
  }

  setFirstPerson(enabled: boolean): void {
    if (this.firstPerson === enabled) return;
    this.firstPerson = enabled;
    this.camReady = false;
    this.player.root.visible = !(this.mode === 'lobby' && enabled);
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
    this.lobbyHands.setAppearance(this.assets, appearance);
  }

  /** Pozycja lokalnego gracza wysyłana do Supabase Realtime presence. */
  getPlayerState(): { x: number; y: number; z: number; yaw: number } {
    const p = this.player.root.position;
    return { x: p.x, y: p.y, z: p.z, yaw: this.player.root.rotation.y };
  }

  /** Lista obecnych graczy → rigowane awatary w Lobby. */
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

  /** Ostatni odczyt — panel kamerki pokazuje z niego pozycję x/y/z. */
  get handPosePair(): HandPosePair {
    return this.lastHandPair;
  }

  /** Kąty palców i pozycja 3D z kamerki trafiają na awatary i dłonie FP. */
  setHandPose(hands: TrackedHand[], aspect: number): void {
    const pair = posesFromHands(hands, aspect);
    this.lastHandPair = pair;
    this.heroAvatar.setHandPose(pair);
    this.player.setHandPose(pair);
    this.horror.setHandPose(pair);
    this.lobbyHands.setHandPose(pair);
  }

  /** Bezpośredni odczyt (np. testy / inne źródła śledzenia). */
  setHandPosePair(pair: HandPosePair): void {
    this.lastHandPair = pair;
    this.heroAvatar.setHandPose(pair);
    this.player.setHandPose(pair);
    this.horror.setHandPose(pair);
    this.lobbyHands.setHandPose(pair);
  }

  /** Zbliżenie podglądu na potrzeby edytora postaci. */
  setPreviewClose(close: boolean): void {
    this.previewClose = close;
  }

  get hasHumans(): boolean {
    return this.assets !== null;
  }

  /** Przycisk „Jakość” w górnym pasku. */
  get qualityControl(): QualityManager {
    return this.qualityManager;
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
  }

  /** Zwraca gotowe zdjęcie (data URL PNG) z aktualnej klatki. */
  onPortalSelect(handler: (id: string) => void): void {
    this.portalHandler = handler;
  }

  /** Machnięcie odebrane z broadcastu — animujemy dokładnie tego gracza. */
  remoteWave(clientId: string): boolean {
    const entry = this.remote.get(clientId);
    if (!entry) return false;
    entry.avatar.wave();
    return true;
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

  private collectShadowLights(): void {
    for (const scene of [this.heroScene, this.lobbyScene, this.gameScene]) {
      scene.traverse((object) => {
        const light = object as THREE.DirectionalLight;
        if (light.isLight && light.castShadow && light.shadow) this.shadowLights.push(light);
      });
    }
  }

  private refreshShadowMaterials(): void {
    // Przełączenie renderer.shadowMap.enabled wymaga rekompilacji programów.
    for (const scene of [this.heroScene, this.lobbyScene, this.gameScene]) {
      scene.traverse((object) => {
        const material = (object as THREE.Mesh).material;
        if (!material) return;
        if (Array.isArray(material)) material.forEach((m) => { m.needsUpdate = true; });
        else material.needsUpdate = true;
      });
    }
  }

  private applyQuality(profile: QualityProfile, dpr: number): void {
    if (Math.abs(this.renderer.getPixelRatio() - dpr) > 0.01) this.renderer.setPixelRatio(dpr);
    if (this.shadowsEnabled !== profile.shadows) {
      this.shadowsEnabled = profile.shadows;
      this.renderer.shadowMap.enabled = profile.shadows;
      this.refreshShadowMaterials();
    }
    for (const light of this.shadowLights) {
      light.castShadow = profile.shadows;
      if (light.shadow.mapSize.x !== profile.shadowSize) {
        light.shadow.mapSize.set(profile.shadowSize, profile.shadowSize);
        light.shadow.map?.dispose();
        light.shadow.map = null;
      }
    }
    this.horror.setQuality(profile);
    document.body.classList.toggle('is-low-quality', profile.level === 'low');
  }

  /** Delikatne światło wypełniające, zawsze od strony kamery podglądu. */
  private readonly heroFill = new THREE.DirectionalLight(0xfff0dc, 1.15);

  private buildHero(): void {
    this.heroScene.add(new THREE.AmbientLight(0xb9c0c4, 0.75));
    // Podgląd obraca POSTAĆ, a nie światła. Bez doświetlenia od kamery twarz
    // wpadała w cień kluczowego reflektora i wyglądała na prawie czarną.
    this.heroScene.add(this.heroFill);

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
    // v0.7: Lobby to jasny park w świetle dnia, nie nocny betonowy plac.
    buildPark(this.lobbyScene, this.centerpiece);
    this.lobbyCamera.position.set(0, 5.2, 11);

    // Portale = drewniane tablice przy alejkach, z okładką świata z katalogu.
    const portalGames = GAMES.filter((game) => game.id !== 'lobby').slice(0, 3);
    const angles = portalGames.map((_, i) => Math.PI + (i - (portalGames.length - 1) / 2) * 0.62);
    portalGames.forEach((game, i) => {
      const angle = angles[i] ?? Math.PI;
      const group = new THREE.Group();
      group.position.set(Math.sin(angle) * 8.6, 0, Math.cos(angle) * 8.6);
      group.rotation.y = angle + Math.PI;

      const wood = new THREE.MeshStandardMaterial({ color: 0x7d5a3a, roughness: 0.88, metalness: 0.02 });
      const woodDark = new THREE.MeshStandardMaterial({ color: 0x59402a, roughness: 0.9, metalness: 0.02 });
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.8, 0.22), wood);
        post.position.set(side * 1.15, 1.4, 0);
        post.castShadow = true;
        group.add(post);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.22, 0.3), woodDark);
      lintel.position.set(0, 2.9, 0);
      lintel.castShadow = true;
      group.add(lintel);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.12, 0.62), wood);
      roof.position.set(0, 3.08, 0);
      roof.rotation.x = 0.12;
      roof.castShadow = true;
      group.add(roof);

      const panelMaterial = new THREE.MeshStandardMaterial({
        color: game.color, roughness: 0.9, side: THREE.DoubleSide,
      });
      if (game.art) {
        const texture = new THREE.TextureLoader().load(game.art);
        texture.colorSpace = THREE.SRGBColorSpace;
        panelMaterial.map = texture;
        panelMaterial.color.set(0xb0b0b0);
      }
      const board = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 0.16), woodDark);
      board.position.set(0, 2.55, 0);
      const disc = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 2.35), panelMaterial);
      disc.position.set(0, 1.5, 0.12);
      group.add(board, disc);

      const hit = new THREE.Mesh(
        new THREE.CircleGeometry(1.4, 32),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
      );
      hit.position.set(0, 1.5, 0.16);
      hit.userData.gameId = game.id;

      const label = createLabel(game.title);
      label.sprite.position.set(0, 3.4, 0);

      group.add(hit, label.sprite);
      this.lobbyScene.add(group);
      this.portals.push({ hit, group, label, id: game.id, index: i });
      this.portalHits.push(hit);
    });

    // Gracz startuje na głównej alejce, z widokiem na cały park i altanę.
    this.player.root.position.set(0, 0, 8.8);
    this.lobbyScene.add(this.player.root);

    // Drzewa, ławki, latarnie i galeria assetów dokładają się asynchronicznie.
    void loadLobbyScenery(this.lobbyScene);
    void loadLobbyGallery(this.lobbyScene);
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

    // Lobby first-person z przechwyconym kursorem: nieskończone delty myszy,
    // bez zatrzymywania się na krawędzi monitora (problem przy 2 ekranach).
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === canvas) this.lobbySkipMouse = 2;
    });
    window.addEventListener('mousemove', (event: MouseEvent) => {
      if (this.mode !== 'lobby' || !this.firstPerson) return;
      if (document.pointerLockElement !== canvas) return;
      if (this.lobbySkipMouse > 0) {
        this.lobbySkipMouse -= 1;
        return;
      }
      const dx = THREE.MathUtils.clamp(event.movementX || 0, -600, 600);
      const dy = THREE.MathUtils.clamp(event.movementY || 0, -600, 600);
      this.yaw -= dx * 0.005;
      // Ruch myszą W GÓRĘ ma unosić wzrok: movementY jest wtedy ujemne,
      // a dodatni rotation.x kamery Three.js oznacza patrzenie w górę.
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - dy * 0.002, -1.1, 1.1);
    });

    canvas.addEventListener('pointerdown', (event: PointerEvent) => {
      if (this.mode === 'game') return;
      // Klik z celownikiem obsługuje main.ts (useFirstPersonPortal) — nie
      // uruchamiamy tu mechaniki przeciągania ani przechwytywania wskaźnika.
      if (document.pointerLockElement === canvas) return;
      this.dragging = true;
      this.dragMoved = 0;
      this.pointerStart = { x: event.clientX, y: event.clientY };
      this.pointerLast = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener('pointermove', (event: PointerEvent) => {
      if (!this.dragging || this.mode === 'game') return;
      if (document.pointerLockElement === canvas) return;
      // movementX/Y nie zacina się na krawędzi monitora; clientX/Y zostaje
      // jako fallback dla przeglądarek, które nie podają delt w PointerEvent.
      const dx = event.movementX || event.clientX - this.pointerLast.x;
      const dy = event.movementY || event.clientY - this.pointerLast.y;
      this.pointerLast = { x: event.clientX, y: event.clientY };
      this.dragMoved += Math.abs(dx) + Math.abs(dy);

      if (this.mode === 'home') {
        // W edytorze przeciąganie obraca POSTAĆ. Gdyby obracać też kamerę,
        // model stałby nieruchomo względem kadru i wyglądałoby to jak
        // przesuwanie się światła po scenie.
        if (this.previewClose) this.previewAngle -= dx * 0.008;
        else this.heroAngle -= dx * 0.008;
      } else if (this.firstPerson) {
        this.yaw -= dx * 0.005;
        this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - dy * 0.002, -1.1, 1.1);
      } else {
        this.yaw -= dx * 0.005;
        this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.002, -0.12, 0.8);
      }
    });

    const endDrag = (event: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (document.pointerLockElement === canvas) return;
      // W FP pojedynczy klik obsługuje main.ts (celownik / ponowny lock),
      // żeby portal nie otwierał się dwa razy. W 3D zostaje stary mechanizm.
      if (
        this.mode === 'lobby' &&
        !this.firstPerson &&
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

  private pickPortal(clientX: number, clientY: number): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.lobbyCamera);
    const hits = this.raycaster.intersectObjects(this.portalHits, false);
    const id = hits.length > 0
      ? hits[0].object.userData.gameId as string | undefined
      : undefined;
    if (id) this.portalHandler?.(id);
    return Boolean(id);
  }

  private resize(): void {
    if (!this.container) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    for (const camera of [this.heroCamera, this.lobbyCamera, this.horror.camera, this.horror.viewCamera]) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    this.horror.setViewport(aspect);
    this.lobbyHands.setViewport(aspect);
  }

  // --------------------------------------------------------------------- loop

  private frame(): void {
    const now = performance.now();
    // Ekrany 90/120 Hz nie muszą rysować 120 klatek 3D na sekundę.
    if (now - this.lastRenderAt < this.qualityManager.minFrameMs) return;
    const realDt = this.lastRenderAt ? (now - this.lastRenderAt) / 1000 : 1 / 60;
    this.lastRenderAt = now;
    // Jedno źródło czasu: deprecated THREE.Clock liczyłby to samo, ale
    // osobnym zegarem (i generował ostrzeżenie w konsoli).
    const dt = Math.min(realDt, 0.05);
    this.qualityManager.sample(realDt);

    // Podgląd postaci na stronie głównej jest często poza ekranem. Nie ma
    // sensu odpalać pełnego renderu WebGL, dopóki użytkownik nie doscrolluje.
    if (this.mode === 'home' && !this.stageVisible) return;
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
      if (this.firstPerson) {
        // Dłonie rysujemy na osobnej scenie po wyczyszczeniu Z, dokładnie tak
        // jak w grze — dzięki temu nie przecinają się z awatarami i portalami.
        this.renderer.autoClear = false;
        this.renderer.clearDepth();
        this.renderer.render(this.lobbyHands.scene, this.lobbyHands.camera);
        this.renderer.autoClear = true;
      }
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
    this.heroFill.position.set(
      this.heroCamera.position.x * 0.8,
      this.heroCamera.position.y + 0.9,
      this.heroCamera.position.z + 1.4,
    );
  }

  private updateLobby(dt: number): void {
    const turn = dt > 0 ? THREE.MathUtils.clamp((this.yaw - this.lastLobbyYaw) / dt, -6, 6) : 0;
    this.lastLobbyYaw = this.yaw;
    let ix = this.joystick.x + this.cameraMove.x;
    let iy = this.joystick.y + this.cameraMove.y;
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

    this.vForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.vRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const direction = this.vDirection
      .copy(this.vForward)
      .multiplyScalar(iy)
      .addScaledVector(this.vRight, ix);
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
    } else if (this.firstPerson) {
      // W FP awatar (widziany przez innych graczy) patrzy tam, gdzie kamera.
      this.player.root.rotation.y = approachAngle(
        this.player.root.rotation.y,
        this.yaw + Math.PI,
        dt * 9,
      );
    }
    this.player.update(this.elapsed, intensity);

    for (const entry of this.remote.values()) {
      entry.avatar.root.position.lerp(entry.target, 1 - Math.exp(-dt * 8));
      entry.avatar.root.rotation.y = approachAngle(entry.avatar.root.rotation.y, entry.yaw, dt * 9);
      entry.avatar.update(this.elapsed, 0.12);
    }

    this.centerpiece.rotation.y = Math.sin(this.elapsed * 0.08) * 0.05;
    updateLobbyGallery(this.elapsed);

    if (this.firstPerson) {
      // Kamera w oczach postaci. Pozycji NIE wygładzamy: opóźnienie kamery
      // względem ruchu w FP wywołuje mdłości. Kołysanie jest bardzo małe.
      const bob = Math.sin(this.elapsed * 9) * 0.011 * intensity;
      this.lobbyCamera.position.set(
        position.x,
        position.y + 1.62 + bob,
        position.z,
      );
      this.lobbyCamera.rotation.set(this.lookPitch, this.yaw, 0, 'YXZ');
      this.lobbyHands.update(dt, bob * 9, turn);
    } else {
      const target = this.vTarget.set(position.x, position.y + 1.3, position.z);
      const distance = 8.2 * Math.cos(this.pitch * 0.55);
      const desired = this.vDesired.set(
        target.x + Math.sin(this.yaw) * distance,
        target.y + 2.1 + this.pitch * 5.5,
        target.z + Math.cos(this.yaw) * distance,
      );
      const lookAt = this.vLookAt.copy(target);

      if (!this.camReady) {
        this.lobbyCamera.position.copy(desired);
        this.camTarget.copy(lookAt);
        this.camReady = true;
      } else {
        this.lobbyCamera.position.lerp(desired, 1 - Math.exp(-dt * 6));
        this.camTarget.lerp(lookAt, 1 - Math.exp(-dt * 9));
      }
      this.lobbyCamera.lookAt(this.camTarget);
      // Animatory dłoni pracują też w 3D, żeby przełączenie widoku nie skakało.
      this.lobbyHands.update(dt, 0, turn);
    }

    // Celownik: jeden rzut promienia z samego środka ekranu, tylko przy locku.
    this.portalAimed = false;
    if (this.firstPerson && document.pointerLockElement === this.renderer.domElement) {
      // Kąt kamery zmieniamy w tej samej klatce — bez odświeżenia macierzy
      // promień celownika korzystałby z poprzedniej klatki (widoczne przy 2 FPS).
      this.lobbyCamera.updateMatrixWorld();
      this.raycaster.setFromCamera(this.centerNdc, this.lobbyCamera);
      this.portalAimed = this.raycaster.intersectObjects(this.portalHits, false).length > 0;
    }

    // Etykiety trzymają stały rozmiar na ekranie, nawet gdy ktoś podejdzie blisko.
    const camera = this.lobbyCamera.position;
    this.player.scaleLabel(camera.distanceTo(this.player.root.position));
    for (const entry of this.remote.values()) {
      entry.avatar.scaleLabel(camera.distanceTo(entry.avatar.root.position));
    }
    for (const portal of this.portals) {
      scaleLabelToDistance(portal.label, camera.distanceTo(portal.group.position), 0.95);
    }
  }
}
