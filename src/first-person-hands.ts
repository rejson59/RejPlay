import * as THREE from 'three';
import { CHARACTER_MODELS } from './games';
import type { HumanAssets } from './human';
import type { Appearance } from './character';
import { neutralHandPosePair, type HandMotion, type HandPosePair } from './hand-pose';
import { AvatarViewHand, FallbackViewHand, viewmodelFov } from './view-hands';

/**
 * Wspólny viewmodel first-person dla Atrium.
 *
 * To ten sam rigowany `SkinnedMesh` wybranego awatara, którego używa gra —
 * wycięte dłonie, 15 stawów, pozycja 3D z kamerki. Różnica: w lobby nie ma
 * narzędzia, a dłonie są rozluźnione. Dzięki temu włączenie kamerki daje
 * poczucie „rąk przed oczami” bez gogli, a wygląd z edytora obowiązuje też tu.
 *
 * Świadomie trzymamy osobną, lekką scenę zamiast współdzielić viewScene gry:
 * gra ma własne światło, latarkę, narzędzie i cykl skanowania, które nie mają
 * sensu w spokojnym lobby. Jeden renderer rysuje obie sceny po kolei.
 */

type ViewHand = AvatarViewHand | FallbackViewHand;

export class FirstPersonHands {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5);

  private left!: ViewHand;
  private right!: ViewHand;
  private pair: HandPosePair = neutralHandPosePair();
  private assets: HumanAssets | null;
  private appearance: Appearance;
  private skin: string;
  private aspect = 16 / 9;
  private fov = 60;
  private time = 0;

  private readonly motionL: HandMotion = {
    time: 0, sway: 0, turn: 0, grip: 0.26, scan: 0, sprint: 0, side: 'L',
  };
  private readonly motionR: HandMotion = {
    time: 0, sway: 0, turn: 0, grip: 0.26, scan: 0, sprint: 0, side: 'R',
  };

  constructor(options: { assets: HumanAssets | null; appearance: Appearance }) {
    this.assets = options.assets;
    this.appearance = { ...options.appearance };
    this.skin = options.appearance.skin;

    this.scene.background = null;
    this.camera.position.set(0, 0, 0);
    this.scene.add(this.camera);
    this.scene.add(new THREE.AmbientLight(0xb9c3c9, 1.05));
    const key = new THREE.DirectionalLight(0xffe2be, 1.25);
    key.position.set(1.2, 2.2, 2.5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x8fb2c4, 0.55);
    fill.position.set(-2, -0.5, 1.5);
    this.scene.add(fill);

    this.makeHands();
  }

  private makeHands(): void {
    const template = this.assets?.templates[this.appearance.model];
    const female = CHARACTER_MODELS[this.appearance.model]?.female ?? false;
    for (const side of ['L', 'R'] as const) {
      const base = new THREE.Vector3(side === 'L' ? -0.33 : 0.33, -0.40, -0.62);
      const hand: ViewHand = template && this.assets
        ? new AvatarViewHand({
          template,
          female,
          side,
          assets: this.assets,
          appearance: this.appearance,
          base,
        })
        : new FallbackViewHand(side, this.skin, base);
      if (side === 'L') this.left = hand;
      else this.right = hand;
    }
    this.camera.add(this.left.root, this.right.root);
    this.setViewport(this.aspect);
  }

  /** Zmiana w edytorze: skóra/ubranie bez przebudowy, model → nowy szkielet. */
  setAppearance(assets: HumanAssets | null, appearance: Appearance): void {
    const modelChanged = appearance.model !== this.appearance.model;
    const becameAvailable = Boolean(assets) && !(this.left instanceof AvatarViewHand);
    this.assets = assets;
    this.appearance = { ...appearance };
    this.skin = appearance.skin;

    const template = assets?.templates[appearance.model];
    const female = CHARACTER_MODELS[appearance.model]?.female ?? false;
    if (!modelChanged && !becameAvailable && template && assets
      && this.left instanceof AvatarViewHand && this.right instanceof AvatarViewHand) {
      this.left.setAppearance(appearance, female, template);
      this.right.setAppearance(appearance, female, template);
      return;
    }
    if (this.left instanceof FallbackViewHand) this.left.setSkin(this.skin);
    if (this.right instanceof FallbackViewHand) this.right.setSkin(this.skin);
    if (modelChanged || becameAvailable) {
      this.camera.remove(this.left.root, this.right.root);
      this.makeHands();
    }
  }

  setViewport(aspect: number): void {
    this.aspect = aspect;
    this.fov = viewmodelFov(aspect);
    this.camera.fov = this.fov;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.left.setViewport(aspect, this.fov);
    this.right.setViewport(aspect, this.fov);
  }

  setHandPose(pair: HandPosePair): void {
    this.pair = pair;
  }

  /** sway = faza kroku, turn = prędkość obrotu głowy (dłonie zostają w tyle). */
  update(dt: number, sway: number, turn: number): void {
    this.time += dt;
    const L = this.motionL;
    const R = this.motionR;
    L.time = this.time; R.time = this.time;
    L.sway = sway; R.sway = -sway;
    L.turn = turn; R.turn = turn;
    this.left.apply(this.pair.L, dt, L);
    this.right.apply(this.pair.R, dt, R);
  }

  dispose(): void {
    this.camera.remove(this.left.root, this.right.root);
    this.scene.clear();
  }
}
