import * as THREE from 'three';

/**
 * Awatar RejPlay = dokładnie 6 kulek:
 *   1 głowa + 2 ręce + 1 wydłużona kulka (ciało) + 2 nogi.
 * Jedyna nie-idealnie-okrągła część to ciało, rozciągnięte w osi Y.
 */

const GEO = {
  head: new THREE.SphereGeometry(0.36, 28, 20),
  body: new THREE.SphereGeometry(0.42, 28, 20),
  arm: new THREE.SphereGeometry(0.21, 22, 16),
  leg: new THREE.SphereGeometry(0.25, 22, 16),
};

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export interface LabelHandle {
  sprite: THREE.Sprite;
  setText: (text: string) => void;
}

/** Utrzymuje etykietę w stałym rozmiarze ekranowym niezależnie od odległości od kamery. */
export function scaleLabelToDistance(
  label: LabelHandle,
  distance: number,
  multiplier = 1,
): void {
  const height = THREE.MathUtils.clamp(distance * 0.05 * multiplier, 0.3, 1.1);
  label.sprite.scale.set(height * 4, height, 1);
}

/** Etykieta z nickiem / nazwą gry jako sprite (zawsze zwrócona do kamery). */
export function createLabel(text: string): LabelHandle {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 80;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const draw = (value: string): void => {
    ctx.clearRect(0, 0, 320, 80);
    ctx.fillStyle = 'rgba(14, 17, 18, 0.9)';
    roundedRect(ctx, 8, 10, 304, 60, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 160, 106, 0.42)';
    ctx.lineWidth = 2;
    ctx.stroke();
    let size = 32;
    ctx.font = `600 ${size}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
    while (ctx.measureText(value).width > 282 && size > 18) {
      size -= 2;
      ctx.font = `600 ${size}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
    }
    ctx.fillStyle = '#e8e4dc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(value, 160, 42, 286);
    texture.needsUpdate = true;
  };

  draw(text);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  sprite.scale.set(1.6, 0.4, 1);
  // Lekkie rozproszenie wysokości, żeby nicki stojących obok siebie awatarów się nie zlepiały.
  sprite.position.set(0, 2.7 + Math.random() * 0.5, 0);
  sprite.renderOrder = 20;

  return { sprite, setText: draw };
}

/** Wspólny kontrakt dla obu stylów awatara (kulki i postacie ludzkie). */
export interface Avatar {
  readonly root: THREE.Group;
  setColor(hex: string): void;
  setLabel(text: string): void;
  setLabelVisible(visible: boolean): void;
  scaleLabel(distance: number): void;
  update(elapsed: number, intensity: number): void;
  wave(): void;
  isWaving(): boolean;
}

export interface AvatarOptions {
  color: string;
  label?: string;
  scale?: number;
}

export class BallAvatar implements Avatar {
  readonly root = new THREE.Group();

  private readonly rig = new THREE.Group();
  private readonly head: THREE.Mesh;
  private readonly body: THREE.Mesh;
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private readonly bodyMat: THREE.MeshPhysicalMaterial;
  private readonly headMat: THREE.MeshPhysicalMaterial;
  private readonly limbMat: THREE.MeshPhysicalMaterial;
  private readonly phase = Math.random() * Math.PI * 2;
  private label: LabelHandle | undefined;
  private lastElapsed = 0;
  private waveStart = -100;

  constructor(options: AvatarOptions) {
    const makeMaterial = () =>
      new THREE.MeshPhysicalMaterial({
        color: options.color,
        roughness: 0.33,
        metalness: 0.02,
        clearcoat: 0.55,
        clearcoatRoughness: 0.3,
      });

    this.bodyMat = makeMaterial();
    this.headMat = makeMaterial();
    this.limbMat = makeMaterial();

    // 1/6 — głowa
    this.head = new THREE.Mesh(GEO.head, this.headMat);
    this.head.position.y = 1.86;

    // 2/6 — ciało: jedna kulka rozciągnięta w pionie
    this.body = new THREE.Mesh(GEO.body, this.bodyMat);
    this.body.position.y = 1.05;
    this.body.scale.set(1, 1.5, 0.9);

    this.rig.add(this.head, this.body);

    // 3/6 i 4/6 — po jednej kulce na rękę, na zawiasach w ramionach
    const makeArm = (side: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.44, 1.36, 0);
      const ball = new THREE.Mesh(GEO.arm, this.limbMat);
      ball.position.set(side * 0.16, -0.24, 0);
      ball.scale.set(0.95, 1.15, 0.95);
      pivot.add(ball);
      this.rig.add(pivot);
      return pivot;
    };
    this.armL = makeArm(-1);
    this.armR = makeArm(1);

    // 5/6 i 6/6 — dwie kulki na nogi
    const makeLeg = (side: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.21, 0.62, 0);
      const ball = new THREE.Mesh(GEO.leg, this.limbMat);
      ball.position.y = -0.28;
      ball.scale.set(1, 1.12, 1);
      pivot.add(ball);
      this.rig.add(pivot);
      return pivot;
    };
    this.legL = makeLeg(-1);
    this.legR = makeLeg(1);

    for (const mesh of [this.head, this.body]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    this.rig.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    this.root.add(this.rig);
    this.root.scale.setScalar(options.scale ?? 1);
    this.setColor(options.color);
    if (options.label) this.setLabel(options.label);
  }

  setColor(hex: string): void {
    const base = new THREE.Color(hex);
    const lighter = base.clone().offsetHSL(0, -0.04, 0.1);
    const darker = base.clone().offsetHSL(0.01, 0.02, -0.09);

    this.bodyMat.color.copy(base);
    this.headMat.color.copy(lighter);
    this.limbMat.color.copy(darker);

    for (const material of [this.bodyMat, this.headMat, this.limbMat]) {
      material.emissive.copy(material.color).multiplyScalar(0.12);
    }
  }

  setLabel(text: string): void {
    if (this.label) {
      this.label.setText(text);
      return;
    }
    this.label = createLabel(text);
    this.root.add(this.label.sprite);
  }

  setLabelVisible(visible: boolean): void {
    if (this.label) this.label.sprite.visible = visible;
  }

  scaleLabel(distance: number): void {
    if (this.label) scaleLabelToDistance(this.label, distance, 0.85);
  }

  wave(): void {
    this.waveStart = this.lastElapsed;
  }

  isWaving(): boolean {
    return this.lastElapsed - this.waveStart < 2.2;
  }

  /** intensity: 0 = stoi, 1 = biegnie. */
  update(elapsed: number, intensity: number): void {
    this.lastElapsed = elapsed;
    const t = elapsed + this.phase;
    const walk = Math.sin(t * 7) * intensity;
    const idle = Math.sin(t * 1.8);

    this.armL.rotation.x = walk * 0.7;
    this.armR.rotation.x = -walk * 0.7;
    this.armR.rotation.z = 0;
    this.legL.rotation.x = -walk * 0.85;
    this.legR.rotation.x = walk * 0.85;

    if (this.isWaving()) {
      const w = elapsed - this.waveStart;
      this.armR.rotation.z = -1.85;
      this.armR.rotation.x = Math.sin(w * 11) * 0.55;
      this.rig.rotation.z = -0.05;
    } else {
      this.rig.rotation.z = Math.sin(t * 3.5) * 0.025 * intensity;
    }

    this.rig.position.y = idle * 0.035 + Math.abs(walk) * 0.035;
    this.body.scale.set(1 + idle * 0.012, 1.5 - idle * 0.02, 0.9 + idle * 0.012);
    this.head.rotation.z = Math.sin(t * 1.3) * 0.04;
  }
}
