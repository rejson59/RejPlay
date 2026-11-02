import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import {
  createLabel,
  scaleLabelToDistance,
  type Avatar,
  type LabelHandle,
} from './avatar';
import type { Appearance } from './character';

/**
 * Realistyczne postacie: Microsoft Rocketbox (MIT), przekonwertowane do glTF.
 * Modele + tekstury + biblioteki animacji motion capture leżą w public/characters/.
 * Szczegóły licencyjne: public/characters/LICENSE-rocketbox-MIT.txt
 */

const AVATAR_NAMES = [
  'Female_Adult_01',
  'Male_Adult_01',
  'Business_Female_01',
  'Male_Adult_02',
  'Female_Adult_03',
  'Female_Adult_05',
] as const;

export interface HumanTemplate {
  scene: THREE.Group;
  female: boolean;
}

export interface HumanAssets {
  templates: HumanTemplate[];
  femaleClips: THREE.AnimationClip[];
  maleClips: THREE.AnimationClip[];
}

/** Wycinamy translację korzenia — o ruch awatara dba World, nie animacja. */
function inPlaceClips(clips: THREE.AnimationClip[]): THREE.AnimationClip[] {
  return clips.map((clip) => {
    const copy = clip.clone();
    copy.tracks = copy.tracks.filter((track) => {
      if (!track.name.endsWith('.position')) return true;
      const node = track.name.split('/').pop()?.split('.')[0];
      return node !== 'Root' && node !== 'Bip01';
    });
    return copy;
  });
}

function texture(file: string, srgb = false): THREE.Texture {
  const map = new THREE.TextureLoader().load(`/characters/${file}`);
  map.flipY = false;
  map.anisotropy = 8;
  if (srgb) map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function dressUp(scene: THREE.Group, name: string): void {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const material = object.material as THREE.MeshStandardMaterial;
    const label = material.name.toLowerCase();
    material.color.set(0xffffff);
    material.metalness = 0;
    material.roughness = 0.72;

    if (label.includes('body')) {
      material.map = texture(`${name}_body_color.jpg`, true);
      material.normalMap = texture(`${name}_body_normal.jpg`);
      material.normalScale.set(0.55, 0.55);
    } else if (label.includes('head')) {
      material.map = texture(`${name}_head_color.jpg`, true);
      material.normalMap = texture(`${name}_head_normal.jpg`);
      material.normalScale.set(0.55, 0.55);
    } else if (label.includes('opacity')) {
      // Hair / eyelashes as alpha-cutout cards.
      material.map = texture(`${name}_opacity_color.png`, true);
      material.alphaTest = 0.5;
      material.transparent = true;
      material.side = THREE.DoubleSide;
      material.roughness = 0.85;
    }
    material.needsUpdate = true;
  });
}

function normalizeHeight(scene: THREE.Group, height = 1.75): void {
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  if (size.y > 0.001) scene.scale.setScalar(height / size.y);
  const fitted = new THREE.Box3().setFromObject(scene);
  scene.position.y = -fitted.min.y;
}

export async function loadHumanAssets(): Promise<HumanAssets> {
  const loader = new GLTFLoader();
  const [models, animationLibs] = await Promise.all([
    Promise.all(
      AVATAR_NAMES.map((name) =>
        loader.loadAsync(`/characters/${name}.glb`),
      ),
    ),
    Promise.all([
      loader.loadAsync('/characters/anim_f.glb'),
      loader.loadAsync('/characters/anim_m.glb'),
    ]),
  ]);

  const templates: HumanTemplate[] = models.map((gltf, i) => {
    const name = AVATAR_NAMES[i];
    dressUp(gltf.scene, name);
    normalizeHeight(gltf.scene);
    return { scene: gltf.scene, female: name.includes('Female') };
  });

  return {
    templates,
    femaleClips: inPlaceClips(animationLibs[0].animations),
    maleClips: inPlaceClips(animationLibs[1].animations),
  };
}

type State = 'idle' | 'walk' | 'wave';

export interface HumanAvatarOptions {
  color: string;
  label?: string;
  appearance: Appearance;
}

interface TintedMaterial {
  kind: 'head' | 'body' | 'hair';
  material: THREE.MeshStandardMaterial;
}

export class HumanAvatar implements Avatar {
  readonly root = new THREE.Group();

  private readonly model: THREE.Group;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions: Record<State, THREE.AnimationAction>;
  private readonly accentMaterial: THREE.MeshStandardMaterial;
  private readonly tinted: TintedMaterial[] = [];
  private readonly label: LabelHandle | undefined;
  private state: State = 'idle';
  private readonly weights: Record<State, number> = { idle: 1, walk: 0, wave: 0 };
  private lastElapsed = 0;
  private waveStart = -100;
  private waveDuration = 2.8;

  constructor(assets: HumanAssets, templateIndex: number, options: HumanAvatarOptions) {
    const template = assets.templates[templateIndex % assets.templates.length];
    this.model = cloneSkeleton(template.scene) as THREE.Group;
    this.root.add(this.model);

    // Materiały klonujemy per instancja, żeby barwienie jednej postaci
    // nie zmieniało wszystkich awatarów używających tego samego modelu.
    this.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = (object.material as THREE.MeshStandardMaterial).clone();
      object.material = material;
      const label = material.name.toLowerCase();
      if (label.includes('head')) this.tinted.push({ kind: 'head', material });
      else if (label.includes('body')) this.tinted.push({ kind: 'body', material });
      else if (label.includes('opacity')) this.tinted.push({ kind: 'hair', material });
    });
    this.setAppearance(options.appearance);

    // Kolor gracza jako matowa, stonowana obręcz pod stopami.
    this.accentMaterial = new THREE.MeshStandardMaterial({
      color: options.color,
      emissive: options.color,
      emissiveIntensity: 0.08,
      roughness: 0.9,
    });
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.43, 0.018, 8, 48),
      this.accentMaterial,
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.025;
    this.root.add(ring);

    if (options.label) {
      this.label = createLabel(options.label);
      this.label.sprite.position.set(0, 2.02 + Math.random() * 0.3, 0);
      this.root.add(this.label.sprite);
    }

    const clips = template.female ? assets.femaleClips : assets.maleClips;
    const find = (name: string): THREE.AnimationClip =>
      clips.find((clip) => clip.name === name) ?? clips[0];

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {
      idle: this.mixer.clipAction(find('idle-loop')),
      walk: this.mixer.clipAction(find('walk-loop')),
      wave: this.mixer.clipAction(find('wave')),
    };
    this.waveDuration = this.actions.wave.getClip().duration;

    this.actions.wave.setLoop(THREE.LoopOnce, 1);
    this.actions.wave.clampWhenFinished = true;
    for (const action of Object.values(this.actions)) {
      action.play();
      action.setEffectiveWeight(0);
    }
    this.actions.idle.setEffectiveWeight(1);
  }

  setColor(hex: string): void {
    this.accentMaterial.color.set(hex);
    this.accentMaterial.emissive.set(hex);
  }

  /** Barwi tekstury: skóra (głowa), włosy (karty alpha), ubranie (ciało). */
  setAppearance(appearance: Appearance): void {
    for (const entry of this.tinted) {
      const hex =
        entry.kind === 'head'
          ? appearance.skin
          : entry.kind === 'body'
            ? appearance.outfit
            : appearance.hair;
      entry.material.color.set(hex);
      // Mapa kart włosów jest ciemna, więc sam mnożnik barwy byłby prawie
      // niewidoczny. Delikatna emisja pozwala zobaczyć wybrany kolor fryzury.
      if (entry.kind === 'hair') {
        entry.material.emissive.set(hex);
        entry.material.emissiveIntensity = 0.28;
      }
      entry.material.needsUpdate = true;
    }
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

  wave(): void {
    this.waveStart = this.lastElapsed;
  }

  isWaving(): boolean {
    return this.lastElapsed - this.waveStart < this.waveDuration;
  }

  update(elapsed: number, intensity: number): void {
    const dt = THREE.MathUtils.clamp(elapsed - this.lastElapsed, 0, 0.05);
    this.lastElapsed = elapsed;

    const desired: State = this.isWaving()
      ? 'wave'
      : intensity > 0.12
        ? 'walk'
        : 'idle';

    if (desired === 'wave' && this.state !== 'wave') this.actions.wave.reset();
    this.state = desired;

    // Własny blending: wagi zawsze sumują się do 1, więc nigdy nie przebija
    // pozycja spoczynkowa szkieletu (tzw. T-pose).
    const target: Record<State, number> = { idle: 0, walk: 0, wave: 0 };
    target[desired] = 1;
    const k = 1 - Math.exp(-dt * 9);
    for (const key of ['idle', 'walk', 'wave'] as const) {
      this.weights[key] += (target[key] - this.weights[key]) * k;
      this.actions[key].setEffectiveWeight(this.weights[key]);
    }

    this.mixer.update(dt);
  }
}
