import * as THREE from 'three';
import { BallAvatar, createLabel, scaleLabelToDistance, type LabelHandle } from './avatar';
import { BOTS, GAMES, PALETTE } from './games';

export type Mode = 'home' | 'lobby';

interface Bot {
  avatar: BallAvatar;
  target: THREE.Vector3;
  timer: number;
  speed: number;
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

function dotTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#171b34';
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  for (let y = 32; y < 512; y += 64) {
    for (let x = 32; x < 512; x += 64) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
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
 * Jeden renderer, dwie sceny: podgląd awatara na home screenie oraz lobby 3D.
 * Dzięki temu przeglądarka trzyma tylko jeden kontekst WebGL.
 */
export class World {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly heroScene = new THREE.Scene();
  private readonly lobbyScene = new THREE.Scene();
  private readonly heroCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  private readonly lobbyCamera = new THREE.PerspectiveCamera(58, 1, 0.1, 200);

  private readonly heroAvatar: BallAvatar;
  private readonly player: BallAvatar;
  private readonly bots: Bot[] = [];
  private readonly portals: Portal[] = [];
  private readonly heroOrbs: Orb[] = [];
  private readonly centerpiece = new THREE.Group();

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
  private yaw = 0.35;
  private pitch = 0.3;
  private dragging = false;
  private dragMoved = 0;
  private pointerStart = { x: 0, y: 0 };
  private pointerLast = { x: 0, y: 0 };
  private velocityY = 0;
  private jumpHeight = 0;
  private camReady = false;
  private portalHandler: ((id: string) => void) | undefined;

  constructor(options: { color: string; name: string }) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = 'stage__canvas';

    this.heroAvatar = new BallAvatar({ color: options.color, scale: 0.92 });
    this.player = new BallAvatar({ color: options.color, label: options.name });

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
    if (mode === 'lobby') this.camReady = false;
  }

  setPlayerColor(color: string): void {
    this.heroAvatar.setColor(color);
    this.player.setColor(color);
  }

  setPlayerName(name: string): void {
    this.player.setLabel(name);
  }

  onPortalSelect(handler: (id: string) => void): void {
    this.portalHandler = handler;
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
    this.heroScene.add(new THREE.AmbientLight(0xffffff, 1.15));

    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(3, 6, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 20;
    this.heroScene.add(key);

    const violet = new THREE.PointLight(0x7c5cff, 55, 14, 2);
    violet.position.set(-3, 2.4, -2.5);
    const mint = new THREE.PointLight(0x42e8b4, 32, 12, 2);
    mint.position.set(3, 1.4, -2);
    this.heroScene.add(violet, mint);

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.68, 0.28, 64),
      new THREE.MeshStandardMaterial({
        color: 0x1b2040,
        roughness: 0.5,
        metalness: 0.25,
      }),
    );
    pedestal.position.y = -0.14;
    pedestal.receiveShadow = true;
    this.heroScene.add(pedestal);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1.5, 0.035, 12, 64),
      new THREE.MeshStandardMaterial({
        color: 0x7c5cff,
        emissive: 0x7c5cff,
        emissiveIntensity: 1.1,
        roughness: 0.3,
      }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.01;
    this.heroScene.add(rim);

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
    this.heroScene.add(contact);

    this.heroScene.add(this.heroAvatar.root);

    PALETTE.forEach((entry, i) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(i % 2 === 0 ? 0.13 : 0.09, 16, 12),
        new THREE.MeshPhysicalMaterial({
          color: entry.value,
          emissive: entry.value,
          emissiveIntensity: 0.45,
          roughness: 0.3,
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
    this.lobbyScene.background = new THREE.Color(0x0a0c18);
    this.lobbyScene.fog = new THREE.FogExp2(0x0a0c18, 0.018);
    this.lobbyCamera.position.set(0, 5, 9);

    this.lobbyScene.add(new THREE.HemisphereLight(0x9db4ff, 0x14162b, 1.7));
    this.lobbyScene.add(new THREE.AmbientLight(0xffffff, 0.5));

    const sun = new THREE.DirectionalLight(0xffffff, 2.3);
    sun.position.set(9, 15, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 16;
    sun.shadow.camera.bottom = -16;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 50;
    sun.shadow.bias = -0.0006;
    this.lobbyScene.add(sun);

    const glowA = new THREE.PointLight(0x7c5cff, 90, 30, 2);
    glowA.position.set(-7, 4, -6);
    const glowB = new THREE.PointLight(0x42e8b4, 70, 30, 2);
    glowB.position.set(7, 4, -6);
    this.lobbyScene.add(glowA, glowB);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(12, 12.3, 0.7, 72),
      new THREE.MeshStandardMaterial({ color: 0x141830, roughness: 0.85, metalness: 0.1 }),
    );
    base.position.y = -0.35;
    base.receiveShadow = true;
    this.lobbyScene.add(base);

    const top = new THREE.Mesh(
      new THREE.CircleGeometry(11.9, 72),
      new THREE.MeshStandardMaterial({
        map: dotTexture(),
        color: 0xffffff,
        roughness: 0.92,
        metalness: 0.02,
      }),
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.005;
    top.receiveShadow = true;
    this.lobbyScene.add(top);

    const edge = new THREE.Mesh(
      new THREE.TorusGeometry(11.75, 0.075, 10, 96),
      new THREE.MeshStandardMaterial({
        color: 0x7c5cff,
        emissive: 0x7c5cff,
        emissiveIntensity: 0.7,
        roughness: 0.4,
      }),
    );
    edge.rotation.x = Math.PI / 2;
    edge.position.y = 0.03;
    this.lobbyScene.add(edge);

    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2;
      const color = new THREE.Color(PALETTE[i % PALETTE.length].value);
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.13 + (i % 3) * 0.025, 16, 12),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.55,
          roughness: 0.3,
        }),
      );
      ball.position.set(Math.sin(angle) * 11.1, 0.22, Math.cos(angle) * 11.1);
      ball.castShadow = true;
      this.lobbyScene.add(ball);
    }

    // Znak RejPlay nad środkiem plazy
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 32, 24),
      new THREE.MeshPhysicalMaterial({
        color: 0x7c5cff,
        emissive: 0x5a35ff,
        emissiveIntensity: 0.8,
        roughness: 0.22,
        clearcoat: 0.8,
      }),
    );
    this.centerpiece.add(core);
    for (let i = 0; i < 3; i++) {
      const satellite = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 16, 12),
        new THREE.MeshStandardMaterial({
          color: 0x42e8b4,
          emissive: 0x42e8b4,
          emissiveIntensity: 0.6,
        }),
      );
      const angle = (i / 3) * Math.PI * 2;
      satellite.position.set(Math.cos(angle) * 1.15, 0, Math.sin(angle) * 1.15);
      this.centerpiece.add(satellite);
    }
    this.centerpiece.position.set(-4.8, 4.6, -4.5);
    this.lobbyScene.add(this.centerpiece);

    // Portale = pozostałe gierki z katalogu
    const portalGames = GAMES.slice(1);
    const angles = [-Math.PI / 3, Math.PI / 3, Math.PI];
    portalGames.forEach((game, i) => {
      const angle = angles[i] ?? (i / portalGames.length) * Math.PI * 2;
      const group = new THREE.Group();
      group.position.set(Math.sin(angle) * 8.8, 0, Math.cos(angle) * 8.8);
      group.rotation.y = angle + Math.PI;

      const color = new THREE.Color(game.color);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.15, 0.13, 16, 64),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.9,
          roughness: 0.32,
          metalness: 0.15,
        }),
      );
      ring.position.y = 1.55;
      ring.castShadow = true;

      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(1.08, 48),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.15,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      disc.position.set(0, 1.55, 0.01);

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
        color: 0x22284a,
        roughness: 0.6,
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

      group.add(ring, disc, hit, label.sprite);
      this.lobbyScene.add(group);
      this.portals.push({ hit, group, label, id: game.id, index: i });
    });

    // Gracz
    this.player.root.position.set(0, 0, 2.4);
    this.lobbyScene.add(this.player.root);

    // Boty — docelowo podmieniane na prawdziwych graczy z serwera
    BOTS.forEach((bot, i) => {
      const avatar = new BallAvatar({ color: bot.color, label: bot.name });
      avatar.root.position.copy(this.pickBotTarget());
      avatar.root.rotation.y = (i / BOTS.length) * Math.PI * 2;
      this.lobbyScene.add(avatar.root);
      this.bots.push({
        avatar,
        target: this.pickBotTarget(),
        timer: 2 + Math.random() * 4,
        speed: 1.1 + Math.random() * 0.9,
      });
    });
  }

  /** Boty nie wchodzą w pole widzenia kamery — inaczej ich kulki zasłaniają cały ekran. */
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
      this.dragging = true;
      this.dragMoved = 0;
      this.pointerStart = { x: event.clientX, y: event.clientY };
      this.pointerLast = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener('pointermove', (event: PointerEvent) => {
      if (!this.dragging) return;
      const dx = event.clientX - this.pointerLast.x;
      const dy = event.clientY - this.pointerLast.y;
      this.pointerLast = { x: event.clientX, y: event.clientY };
      this.dragMoved += Math.abs(dx) + Math.abs(dy);

      if (this.mode === 'home') {
        this.heroAngle -= dx * 0.008;
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
    for (const camera of [this.heroCamera, this.lobbyCamera]) {
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
    } else {
      this.updateLobby(dt);
      this.renderer.render(this.lobbyScene, this.lobbyCamera);
    }
  }

  private updateHero(): void {
    this.heroAvatar.update(this.elapsed, 0.16);
    this.heroAvatar.root.rotation.y = this.elapsed * 0.22;

    for (const orb of this.heroOrbs) {
      const angle = orb.angle + this.elapsed * orb.speed;
      orb.mesh.position.set(
        Math.sin(angle) * orb.radius,
        orb.height + Math.sin(this.elapsed * 1.3 + orb.angle) * 0.14,
        Math.cos(angle) * orb.radius,
      );
    }

    this.heroCamera.position.set(
      Math.sin(this.heroAngle) * 5.1,
      2.6,
      Math.cos(this.heroAngle) * 5.1,
    );
    this.heroCamera.lookAt(0, 1.12, 0);
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

    for (const bot of this.bots) {
      bot.timer -= dt;
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
        if (gap > 0.001 && gap < 1.6) {
          const push = (1.6 - gap) * Math.min(1, dt * 4);
          const nx = (dx / gap) * push;
          const nz = (dz / gap) * push;
          a.x -= nx;
          a.z -= nz;
          b.x += nx;
          b.z += nz;
        }
      }
    }

    this.centerpiece.rotation.y = this.elapsed * 0.35;
    this.centerpiece.position.y = 4.6 + Math.sin(this.elapsed * 1.1) * 0.18;
    for (const portal of this.portals) {
      portal.group.position.y = Math.sin(this.elapsed * 1.2 + portal.index) * 0.09;
    }

    const target = new THREE.Vector3(position.x, position.y + 1.3, position.z);
    const distance = 8.2 * Math.cos(this.pitch * 0.55);
    const desired = new THREE.Vector3(
      target.x + Math.sin(this.yaw) * distance,
      target.y + 2.1 + this.pitch * 5.5,
      target.z + Math.cos(this.yaw) * distance,
    );

    if (!this.camReady) {
      this.lobbyCamera.position.copy(desired);
      this.camTarget.copy(target);
      this.camReady = true;
    } else {
      this.lobbyCamera.position.lerp(desired, 1 - Math.exp(-dt * 6));
      this.camTarget.lerp(target, 1 - Math.exp(-dt * 9));
    }
    this.lobbyCamera.lookAt(this.camTarget);

    // Etykiety trzymają stały rozmiar na ekranie, nawet gdy ktoś podejdzie blisko.
    const camera = this.lobbyCamera.position;
    this.player.scaleLabel(camera.distanceTo(this.player.root.position));
    for (const bot of this.bots) {
      bot.avatar.scaleLabel(camera.distanceTo(bot.avatar.root.position));
    }
    for (const portal of this.portals) {
      scaleLabelToDistance(portal.label, camera.distanceTo(portal.group.position), 0.95);
    }
  }
}
