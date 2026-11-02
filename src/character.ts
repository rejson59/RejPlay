import * as THREE from 'three';
import { createLabel, scaleLabelToDistance, type Avatar, type LabelHandle } from './avatar';
import { HumanAvatar, type HumanAssets } from './human';
import type { HandPosePair } from './hand-pose';

/** Wygląd wybierany w edytorze postaci. */
export interface Appearance {
  model: number;
  skin: string;
  hair: string;
  outfit: string;
}

export const DEFAULT_APPEARANCE: Appearance = {
  model: 0,
  skin: '#d3a377',
  hair: '#4b3020',
  outfit: 'casual',
};

export interface CharacterOptions {
  color: string;
  label?: string;
  assets: HumanAssets | null;
  templateIndex: number;
  appearance?: Appearance;
}

/**
 * Neutralna sylwetka użyta wyłącznie wtedy, gdy pliki modeli nie wczytały się
 * (np. brakujący asset). Nie jest to awatar z kulek — tylko prosty placeholder,
 * żeby scena i sterowanie pozostały sprawne.
 */
class PlaceholderAvatar implements Avatar {
  readonly root = new THREE.Group();

  private readonly material = new THREE.MeshStandardMaterial({
    color: 0x6d7075,
    roughness: 0.9,
  });
  private readonly label: LabelHandle | undefined;
  private waveStart = -100;
  private lastElapsed = 0;

  constructor(color: string, label?: string) {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.95, 6, 12), this.material);
    body.position.y = 0.95;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), this.material);
    head.position.y = 1.72;
    head.castShadow = true;
    this.root.add(body, head);
    this.setColor(color);
    if (label) {
      this.label = createLabel(label);
      this.label.sprite.position.set(0, 2.15, 0);
      this.root.add(this.label.sprite);
    }
  }

  setColor(hex: string): void {
    this.material.color.set(hex).lerp(new THREE.Color(0x555a5c), 0.55);
  }

  setLabel(text: string): void {
    this.label?.setText(text);
  }

  setLabelVisible(visible: boolean): void {
    if (this.label) this.label.sprite.visible = visible;
  }

  scaleLabel(distance: number): void {
    if (this.label) scaleLabelToDistance(this.label, distance, 0.72);
  }

  setAppearance(_appearance: Appearance): void {
    // Placeholder nie ma tekstur ani garderoby do zmiany.
  }

  setHandPose(_pair: HandPosePair): void {
    // Placeholder nie ma kości palców.
  }

  playEmote(_clipName: string): void {
    this.waveStart = this.lastElapsed;
  }

  wave(): void {
    this.waveStart = this.lastElapsed;
  }

  isWaving(): boolean {
    return this.lastElapsed - this.waveStart < 2.2;
  }

  dispose(): void {
    // Placeholder nie alokuje geometrii poza swoim rootem.
  }

  update(elapsed: number, _intensity: number): void {
    this.lastElapsed = elapsed;
    this.root.rotation.z = this.isWaving() ? Math.sin(elapsed * 9) * 0.08 : 0;
  }
}

/** Jeden slot gracza = jedna realistyczna, teksturowana postać 3D. */
export class Character implements Avatar {
  readonly root = new THREE.Group();

  private readonly assets: HumanAssets | null;
  private readonly colorHex: string;
  private readonly labelText: string | undefined;
  private human: HumanAvatar | PlaceholderAvatar;
  private templateIndex: number;
  private appearance: Appearance;

  constructor(options: CharacterOptions) {
    this.assets = options.assets;
    this.colorHex = options.color;
    this.labelText = options.label;
    this.templateIndex = options.templateIndex;
    this.appearance = options.appearance ?? DEFAULT_APPEARANCE;
    this.human = this.makeHuman();
    this.root.add(this.human.root);
  }

  private makeHuman(): HumanAvatar | PlaceholderAvatar {
    if (!this.assets) return new PlaceholderAvatar(this.colorHex, this.labelText);
    return new HumanAvatar(this.assets, this.templateIndex, {
      color: this.colorHex,
      label: this.labelText,
      appearance: this.appearance,
    });
  }

  setAppearance(appearance: Appearance): void {
    const modelChanged = appearance.model !== this.templateIndex;
    this.appearance = appearance;
    this.templateIndex = appearance.model;
    if (modelChanged) {
      this.root.remove(this.human.root);
      this.human.dispose();
      this.human = this.makeHuman();
      this.root.add(this.human.root);
    } else {
      this.human.setAppearance(appearance);
    }
  }

  setHandPose(pair: HandPosePair): void {
    this.human.setHandPose(pair);
  }

  setColor(hex: string): void {
    this.human.setColor(hex);
  }

  setLabel(text: string): void {
    this.human.setLabel(text);
  }

  setLabelVisible(visible: boolean): void {
    this.human.setLabelVisible(visible);
  }

  scaleLabel(distance: number): void {
    this.human.scaleLabel(distance);
  }

  playEmote(clipName: string): void {
    this.human.playEmote(clipName);
  }

  wave(): void {
    this.human.wave();
  }

  isWaving(): boolean {
    return this.human.isWaving();
  }

  update(elapsed: number, intensity: number): void {
    this.human.update(elapsed, intensity);
  }

  dispose(): void {
    this.human.dispose();
  }
}
