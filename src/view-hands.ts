import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { neutralHandPose, type HandPose } from './hand-pose';

/**
 * Dłonie first-person. Nie są to „klocki”: każdy palec ma trzy zaokrąglone
 * ogniwa na własnym przegubie, dokładnie jak szkielet awatara. Te same kąty
 * z src/hand-pose.ts sterują i awatarem w lobby, i tym widokiem w grze.
 *
 * Układ lokalny: palce wskazują +Y (w górę ekranu), wnętrze dłoni to +Z
 * (w stronę kamery), rozstaw idzie po X. Zgięcie = obrót wokół +X, więc
 * koniuszki wędrują w stronę widza — dokładnie tak, jak przy zaciskaniu pięści.
 */

const FINGER_LENGTHS = [0.046, 0.036, 0.027];
const THUMB_LENGTHS = [0.043, 0.034, 0.024];

function segment(radius: number, length: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), material);
  mesh.position.y = length / 2;
  mesh.castShadow = true;
  return mesh;
}

export class ViewHand {
  readonly root = new THREE.Group();

  private readonly material: THREE.MeshStandardMaterial;
  private readonly joints: THREE.Group[][] = [];
  private readonly bases: THREE.Group[] = [];
  private readonly side: number;
  private readonly pose: HandPose = neutralHandPose();

  constructor(side: 'L' | 'R', skin: string) {
    this.side = side === 'L' ? 1 : -1;
    this.material = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.84, metalness: 0 });
    const nail = new THREE.MeshStandardMaterial({ color: 0xd9b9a2, roughness: 0.4 });

    // Krótki fragment przedramienia, żeby dłoń nie wyglądała jak odcięta.
    const forearm = segment(0.039, 0.12, this.material);
    forearm.position.y = -0.075;
    this.root.add(forearm);

    // Zaokrąglony prostokąt zamiast kuli — dłoń nie wygląda jak piłeczka.
    const palm = new THREE.Mesh(
      new RoundedBoxGeometry(0.132, 0.145, 0.05, 4, 0.038),
      this.material,
    );
    palm.position.set(0, 0.055, 0);
    palm.castShadow = true;
    this.root.add(palm);

    const knuckleGeo = new THREE.SphereGeometry(1, 10, 8);

    for (let f = 0; f < 5; f += 1) {
      const thumb = f === 0;
      const base = new THREE.Group();
      if (thumb) {
        base.position.set(this.side * 0.062, 0.026, 0.004);
        base.rotation.z = -this.side * 0.92;
      } else {
        base.position.set(this.side * (0.049 - (f - 1) * 0.032), 0.122, 0);
      }
      this.root.add(base);
      this.bases.push(base);

      const lengths = thumb ? THUMB_LENGTHS : FINGER_LENGTHS;
      const chain: THREE.Group[] = [];
      let pivot = base;
      for (let j = 0; j < 3; j += 1) {
        const radius = (thumb ? 0.0165 : 0.0135) - j * 0.0018;
        const joint = new THREE.Group();
        joint.add(segment(radius, lengths[j], this.material));
        const knuckle = new THREE.Mesh(knuckleGeo, this.material);
        knuckle.scale.setScalar(radius * 1.06);
        joint.add(knuckle);
        if (j === 2) {
          const plate = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), nail);
          plate.scale.set(radius * 0.8, radius * 0.75, radius * 0.26);
          plate.position.set(0, lengths[j] * 0.72, radius * 0.62);
          joint.add(plate);
        }
        pivot.add(joint);
        if (j > 0) joint.position.y = lengths[j - 1];
        chain.push(joint);
        pivot = joint;
      }
      this.joints.push(chain);
    }
  }

  setSkin(hex: string): void {
    this.material.color.set(hex);
  }

  /** Wygładzanie ruchu, żeby odczyt z kamery nie drżał. */
  apply(target: HandPose, dt: number, sway = 0): void {
    const k = 1 - Math.exp(-dt * 17);
    const t = target.present ? target : neutralHandPose();
    for (let f = 0; f < 5; f += 1) {
      for (let j = 0; j < 3; j += 1) {
        this.pose.curl[f][j] += (t.curl[f][j] - this.pose.curl[f][j]) * k;
        // Każdy kolejny staw zgina się ciut mocniej, jak w prawdziwym palcu.
        this.joints[f][j].rotation.x = this.pose.curl[f][j] * (j === 0 ? 0.85 : 1);
      }
      this.pose.spread[f] += (t.spread[f] - this.pose.spread[f]) * k;
      this.bases[f].rotation.z =
        (f === 0 ? -this.side * 0.92 : 0) - this.side * this.pose.spread[f] * 0.7;
    }
    this.pose.roll += (t.roll - this.pose.roll) * k;
    this.pose.pitch += (t.pitch - this.pose.pitch) * k;
    this.root.rotation.y = -this.pose.roll * 0.4 + sway * 0.04;
    this.root.rotation.x = this.pose.pitch * 0.35;
  }
}

/** Narzędzie trzymane w prawej dłoni: obudowa, ekran, przyciski, sonda. */
export class ToolViewmodel {
  readonly root = new THREE.Group();

  private readonly screenCanvas = document.createElement('canvas');
  private readonly screenCtx: CanvasRenderingContext2D;
  private readonly screenTexture: THREE.CanvasTexture;
  private readonly accent: THREE.MeshStandardMaterial;
  private readonly probe: THREE.Group;
  private readonly antenna: THREE.Group;
  private readonly microphone: THREE.Group;
  private readonly labels = ['TERMOMETR', 'MIERNIK POLA', 'REJESTRATOR'];
  private toolIndex = 0;
  private reading = 0;

  constructor() {
    this.screenCanvas.width = 256;
    this.screenCanvas.height = 128;
    this.screenCtx = this.screenCanvas.getContext('2d')!;
    this.screenTexture = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTexture.colorSpace = THREE.SRGBColorSpace;

    const shell = new THREE.MeshStandardMaterial({ color: 0x20262a, roughness: 0.62, metalness: 0.12 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x121719, roughness: 0.95 });
    this.accent = new THREE.MeshStandardMaterial({
      color: 0x9ad8c4, emissive: 0x4fb79a, emissiveIntensity: 0.8, roughness: 0.35,
    });

    const body = new THREE.Mesh(new RoundedBoxGeometry(0.105, 0.17, 0.038, 3, 0.012), shell);
    body.castShadow = true;
    this.root.add(body);
    const grip = new THREE.Mesh(new RoundedBoxGeometry(0.096, 0.06, 0.044, 3, 0.014), rubber);
    grip.position.y = -0.098;
    this.root.add(grip);

    const bezel = new THREE.Mesh(new RoundedBoxGeometry(0.092, 0.06, 0.006, 2, 0.004), rubber);
    bezel.position.set(0, 0.038, 0.0195);
    this.root.add(bezel);
    const display = new THREE.Mesh(
      new THREE.PlaneGeometry(0.082, 0.05),
      new THREE.MeshStandardMaterial({
        map: this.screenTexture,
        emissiveMap: this.screenTexture,
        emissive: 0xffffff,
        emissiveIntensity: 0.45,
        roughness: 0.3,
      }),
    );
    display.position.set(0, 0.038, 0.023);
    this.root.add(display);

    for (let i = 0; i < 3; i += 1) {
      const button = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.006, 12), shell);
      button.rotation.x = Math.PI / 2;
      button.position.set((i - 1) * 0.026, -0.031, 0.022);
      this.root.add(button);
    }
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), this.accent);
    led.position.set(0.032, 0.079, 0.021);
    this.root.add(led);

    this.probe = new THREE.Group();
    const probeStem = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.003, 0.13, 10), shell);
    probeStem.position.y = 0.15;
    this.probe.add(probeStem);
    const probeTip = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.001, 0.035, 10), this.accent);
    probeTip.position.y = 0.232;
    this.probe.add(probeTip);
    this.root.add(this.probe);

    this.antenna = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.002, 0.14, 8), shell);
    rod.position.y = 0.153;
    this.antenna.add(rod);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 10), this.accent);
    bulb.position.y = 0.226;
    this.antenna.add(bulb);
    this.root.add(this.antenna);

    this.microphone = new THREE.Group();
    const micHead = new THREE.Mesh(new THREE.SphereGeometry(0.017, 14, 12), rubber);
    micHead.position.y = 0.145;
    this.microphone.add(micHead);
    for (let i = 0; i < 3; i += 1) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.012 + i * 0.002, 0.0015, 6, 16), shell);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.15 + i * 0.006;
      this.microphone.add(ring);
    }
    this.root.add(this.microphone);

    this.setTool(0);
  }

  setTool(index: number): void {
    this.toolIndex = index;
    this.probe.visible = index === 0;
    this.antenna.visible = index === 1;
    this.microphone.visible = index === 2;
    this.accent.color.set([0x9ad8c4, 0xb7a4e8, 0xe0b678][index] ?? 0x9ad8c4);
    this.accent.emissive.set([0x4fb79a, 0x7b63c4, 0xb8863c][index] ?? 0x4fb79a);
    this.drawScreen();
  }

  setReading(value: number): void {
    this.reading = THREE.MathUtils.clamp(value, 0, 1);
    this.drawScreen();
  }

  private drawScreen(): void {
    const ctx = this.screenCtx;
    ctx.fillStyle = '#0b1a17';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#79cbb0';
    ctx.font = '600 18px ui-monospace, monospace';
    ctx.fillText(this.labels[this.toolIndex] ?? 'NARZĘDZIE', 12, 30);
    ctx.fillStyle = '#2c4a43';
    ctx.fillRect(12, 52, 232, 10);
    ctx.fillStyle = '#8fe0c2';
    ctx.fillRect(12, 52, 232 * this.reading, 10);
    ctx.fillStyle = '#c9f2e0';
    ctx.font = '700 34px ui-monospace, monospace';
    ctx.fillText(`${(this.reading * 100).toFixed(0)}%`, 12, 106);
    ctx.font = '500 13px ui-monospace, monospace';
    ctx.fillStyle = '#4f8777';
    ctx.fillText(this.reading > 0.45 ? '■ ODCZYT' : '○ SZUKAM', 150, 104);
    this.screenTexture.needsUpdate = true;
  }
}
