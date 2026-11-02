import * as THREE from 'three';
import { BallAvatar, type Avatar } from './avatar';
import { HumanAvatar, type HumanAssets } from './human';

export type AvatarStyle = 'human' | 'balls';

/** Wygląd wybierany w edytorze postaci. */
export interface Appearance {
  model: number;
  skin: string;
  hair: string;
  outfit: string;
}

export const DEFAULT_APPEARANCE: Appearance = {
  model: 0,
  skin: '#f3ddc3',
  hair: '#4b3020',
  outfit: '#ffffff',
};

export interface CharacterOptions {
  color: string;
  label?: string;
  scale?: number;
  assets: HumanAssets | null;
  templateIndex: number;
  style: AvatarStyle;
  appearance?: Appearance;
}

/**
 * Jeden „slot" gracza trzyma oba style awatara jednocześnie.
 * Przełączanie to tylko zmiana widoczności — bez przeładowywania modeli i animacji.
 */
export class Character implements Avatar {
  readonly root = new THREE.Group();

  private readonly balls: BallAvatar;
  private readonly assets: HumanAssets | null;
  private readonly colorHex: string;
  private readonly labelText: string | undefined;
  private human: HumanAvatar | null;
  private templateIndex: number;
  private appearance: Appearance;
  private style: AvatarStyle;

  constructor(options: CharacterOptions) {
    this.assets = options.assets;
    this.colorHex = options.color;
    this.labelText = options.label;
    this.templateIndex = options.templateIndex;
    this.appearance = options.appearance ?? DEFAULT_APPEARANCE;
    this.style = options.style;

    this.balls = new BallAvatar({
      color: options.color,
      label: options.label,
      scale: options.scale,
    });
    this.human = this.makeHuman();
    this.root.add(this.balls.root);
    if (this.human) this.root.add(this.human.root);
    this.applyStyle();
  }

  private makeHuman(): HumanAvatar | null {
    if (!this.assets) return null;
    return new HumanAvatar(this.assets, this.templateIndex, {
      color: this.colorHex,
      label: this.labelText,
      appearance: this.appearance,
    });
  }

  get activeStyle(): AvatarStyle {
    return this.style === 'human' && this.human ? 'human' : 'balls';
  }

  private get active(): Avatar {
    return this.activeStyle === 'human' && this.human ? this.human : this.balls;
  }

  setStyle(style: AvatarStyle): void {
    this.style = style;
    this.applyStyle();
  }

  private applyStyle(): void {
    const human = this.activeStyle === 'human';
    this.balls.root.visible = !human;
    if (this.human) this.human.root.visible = human;
  }

  /** Zmiana kolorów bez przebudowy, zmiana modelu (fryzury) z przebudową. */
  setAppearance(appearance: Appearance): void {
    this.appearance = appearance;
    if (!this.assets) return;
    if (appearance.model !== this.templateIndex) {
      this.templateIndex = appearance.model;
      const wasVisible = this.human?.root.visible ?? false;
      if (this.human) this.root.remove(this.human.root);
      this.human = this.makeHuman();
      if (this.human) {
        this.root.add(this.human.root);
        this.human.root.visible = wasVisible;
      }
      this.applyStyle();
    } else {
      this.human?.setAppearance(appearance);
    }
  }

  setColor(hex: string): void {
    this.balls.setColor(hex);
    this.human?.setColor(hex);
  }

  setLabel(text: string): void {
    this.balls.setLabel(text);
    this.human?.setLabel(text);
  }

  setLabelVisible(visible: boolean): void {
    this.balls.setLabelVisible(visible);
    this.human?.setLabelVisible(visible);
  }

  scaleLabel(distance: number): void {
    this.active.scaleLabel(distance);
  }

  wave(): void {
    this.active.wave();
  }

  isWaving(): boolean {
    return this.active.isWaving();
  }

  update(elapsed: number, intensity: number): void {
    this.active.update(elapsed, intensity);
  }
}
