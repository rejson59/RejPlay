import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Pas na biodrach w widoku first-person.
 *
 * Sześć fizycznych slotów przypiętych do kamery viewmodelu. Narzędzie znika
 * z pasa, gdy gracz bierze je do dłoni, i wraca po odłożeniu. Gracz może
 * wskazać slot palcem / spojrzeniem i chwycić go gestem (src/camera-control.ts).
 * To nie jest HTML-owy pasek: sloty są geometrią 3D oświetloną razem z dłońmi.
 */

interface Slot {
  root: THREE.Group;
  plate: THREE.Mesh;
  tool: THREE.Mesh;
  led: THREE.Mesh;
  texture: THREE.CanvasTexture;
  label: string;
  key: string;
  active: boolean;
}

function plateTexture(key: string, label: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#111a1b';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#3a5b56';
  ctx.lineWidth = 5;
  ctx.strokeRect(6, 6, 244, 116);
  ctx.fillStyle = '#9ad8c4';
  ctx.font = '700 46px ui-monospace, monospace';
  ctx.fillText(key, 18, 56);
  ctx.fillStyle = '#cfe1db';
  ctx.font = '500 24px ui-monospace, monospace';
  ctx.fillText(label.toUpperCase().slice(0, 15), 18, 98);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

export class ToolBelt {
  readonly root = new THREE.Group();
  private readonly slots: Slot[] = [];
  private aimed = 0;
  private halfH = 0.62;
  private halfW = 1.1;

  constructor(tools: Array<{ name: string; key: string }>) {
    this.root.name = 'tool-belt';
    const strap = new THREE.Mesh(
      new THREE.BoxGeometry(1.06, 0.085, 0.035),
      new THREE.MeshStandardMaterial({ color: 0x2a2f2e, roughness: 0.92, metalness: 0.08 }),
    );
    strap.position.y = -0.005;
    this.root.add(strap);

    const shell = new THREE.MeshStandardMaterial({ color: 0x20282a, roughness: 0.7, metalness: 0.25 });
    const ledMat = new THREE.MeshStandardMaterial({
      color: 0x9ad8c4, emissive: 0x4fb79a, emissiveIntensity: 0.8, roughness: 0.35,
    });
    tools.forEach((tool, i) => {
      const group = new THREE.Group();
      group.position.x = (i - (tools.length - 1) / 2) * 0.168;
      const plate = new THREE.Mesh(new RoundedBoxGeometry(0.146, 0.112, 0.045, 2, 0.008), shell);
      group.add(plate);
      const texture = plateTexture(tool.key, tool.name);
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(0.13, 0.065),
        new THREE.MeshStandardMaterial({
          map: texture, emissiveMap: texture, emissive: 0xffffff,
          emissiveIntensity: 0.35, roughness: 0.5,
        }),
      );
      face.position.set(0, 0, 0.024);
      group.add(face);
      // Miniatura narzędzia „wpięta” w pas — znika po wzięciu do dłoni.
      const mini = new THREE.Mesh(
        new RoundedBoxGeometry(0.032, 0.07, 0.022, 2, 0.005),
        new THREE.MeshStandardMaterial({ color: 0x39464a, roughness: 0.55, metalness: 0.3 }),
      );
      mini.position.set(0.045, 0.075, 0);
      group.add(mini);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.007, 10, 8), ledMat.clone());
      led.position.set(-0.05, 0.045, 0.026);
      group.add(led);
      this.root.add(group);
      this.slots.push({ root: group, plate, tool: mini, led, texture, label: tool.name, key: tool.key, active: true });
    });
    this.setHeld(0);
  }

  setViewport(aspect: number, fov: number): void {
    const z = 1.05;
    this.halfH = z * Math.tan((fov * Math.PI) / 360);
    this.halfW = this.halfH * aspect;
    const scale = Math.min(1, this.halfW / 0.62);
    this.root.scale.setScalar(scale);
    this.root.position.set(0, -this.halfH * 0.55 / Math.max(scale, 0.35), -z);
  }

  setHeld(index: number): void {
    this.slots.forEach((slot, i) => {
      slot.active = i !== index;
      slot.tool.visible = slot.active;
      (slot.plate.material as THREE.MeshStandardMaterial).color.set(i === index ? 0x141b1c : 0x20282a);
    });
    this.refreshLeds();
  }

  setAimed(index: number): void {
    this.aimed = THREE.MathUtils.clamp(Math.round(index), 0, this.slots.length - 1);
    this.refreshLeds();
  }

  private refreshLeds(): void {
    this.slots.forEach((slot, i) => {
      const mat = slot.led.material as THREE.MeshStandardMaterial;
      const on = i === this.aimed && slot.active;
      mat.emissiveIntensity = on ? 2.2 : 0.45;
      mat.color.set(on ? 0xd9f6ea : 0x507168);
    });
  }

  update(elapsed: number): void {
    this.root.position.y += Math.sin(elapsed * 1.7) * 0.0004;
    for (const slot of this.slots) {
      slot.root.rotation.z = Math.sin(elapsed * 1.3 + slot.root.position.x * 6) * 0.012;
    }
  }
}
