import * as THREE from 'three';
import type { HandPosePair } from './hand-pose';

/** Pomocnicze etykiety 3D (nick gracza, nazwa świata przy bramie). */

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

/** Utrzymuje etykietę w stałym rozmiarze ekranowym niezależnie od odległości. */
export function scaleLabelToDistance(
  label: LabelHandle,
  distance: number,
  multiplier = 1,
): void {
  const height = THREE.MathUtils.clamp(distance * 0.05 * multiplier, 0.3, 1.1);
  label.sprite.scale.set(height * 4, height, 1);
}

/** Etykieta z nickiem / nazwą świata jako sprite (zawsze zwrócona do kamery). */
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
  sprite.position.set(0, 2.7 + Math.random() * 0.5, 0);
  sprite.renderOrder = 20;

  return { sprite, setText: draw };
}

/** Wspólny kontrakt awatara używany przez Character i World. */
export interface Avatar {
  readonly root: THREE.Group;
  setColor(hex: string): void;
  setLabel(text: string): void;
  setLabelVisible(visible: boolean): void;
  scaleLabel(distance: number): void;
  update(elapsed: number, intensity: number): void;
  wave(): void;
  playEmote(clipName: string): void;
  dispose(): void;
  isWaving(): boolean;
  setAppearance(appearance: { model: number; skin: string; hair: string; outfit: string }): void;
  setHandPose(pair: HandPosePair): void;
}
