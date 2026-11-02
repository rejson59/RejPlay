import * as THREE from 'three';
import { BallAvatar, type Avatar } from './avatar';
import { HumanAvatar, type HumanAssets } from './human';

export type AvatarStyle = 'human' | 'balls';

export interface CharacterOptions {
  color: string;
  label?: string;
  scale?: number;
  assets: HumanAssets | null;
  templateIndex: number;
  style: AvatarStyle;
}

/**
 * Jeden „slot" gracza trzyma oba style awatara jednocześnie.
 * Przełączanie to tylko zmiana widoczności — bez przeładowywania modeli i animacji.
 */
export class Character implements Avatar {
  readonly root = new THREE.Group();

  private readonly balls: BallAvatar;
  private readonly human: HumanAvatar | null;
  private style: AvatarStyle;

  constructor(options: CharacterOptions) {
    this.balls = new BallAvatar({
      color: options.color,
      label: options.label,
      scale: options.scale,
    });
    this.human = options.assets
      ? new HumanAvatar(options.assets, options.templateIndex, {
          color: options.color,
          label: options.label,
        })
      : null;

    this.root.add(this.balls.root);
    if (this.human) this.root.add(this.human.root);
    this.style = options.style;
    this.applyStyle();
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
