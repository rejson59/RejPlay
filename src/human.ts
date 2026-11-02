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
import { CHARACTER_MODELS, getOutfit, OUTFITS } from './games';
import {
  blendPose,
  neutralHandPosePair,
  type HandPosePair,
} from './hand-pose';

/**
 * Realistyczne postacie: Microsoft Rocketbox (MIT), przekonwertowane do glTF.
 * Modele + tekstury + animacje leżą w public/characters/.
 * Licencja: public/characters/LICENSE-rocketbox-MIT.txt
 *
 * Ubrania NIE są rzeźbione ręcznie: podmieniamy gotowe tekstury korpusu z
 * innych wariantów Rocketbox (garnitur, fartuch, strój roboczy…). Włosy są
 * przeliczane w canvas z maską fryzury, więc kolor działa na całej głowie,
 * a nie tylko na pojedynczych kartach alpha.
 */

const AVATAR_NAMES = CHARACTER_MODELS.map((model) => model.file);

export interface HumanTemplate {
  scene: THREE.Group;
  female: boolean;
}

export interface BodyLook {
  color: THREE.Texture;
  normal: THREE.Texture;
}

interface HeadBase {
  width: number;
  height: number;
  /** Oryginalne RGBA tekstury głowy. */
  data: Uint8ClampedArray;
  /** 1 = skóra do przebarwienia, 0 = zostawiamy oryginał. */
  skin: Float32Array;
  /** 1 = włosy do przebarwienia. */
  hair: Float32Array;
  /** Średnia jasność fryzury i skóry: normalizujemy cieniowanie pod wybrany kolor. */
  hairLuma: number;
  skinLuma: number;
}

export interface HumanAssets {
  templates: HumanTemplate[];
  femaleClips: THREE.AnimationClip[];
  maleClips: THREE.AnimationClip[];
  hairMaps: THREE.Texture[];
  bodyLooks: Map<string, BodyLook>;
  headTexture(name: string, skin: string, hair: string): THREE.Texture;
}

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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Nie udało się wczytać ${src}`));
    image.src = src;
  });
}

function canvasTexture(image: HTMLImageElement, srgb: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.flipY = false;
  map.anisotropy = 8;
  if (srgb) map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function hexRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const clamp255 = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

/**
 * Karty włosów zawierają zapisany na sztywno brąz. Zamieniamy RGB na skalę
 * jasności, zachowując alpha i rysunek kosmyków — wtedy `material.color`
 * daje dokładnie wybrany odcień (blond, czerń, rudy, siwy).
 */
async function makeHairMap(name: string): Promise<THREE.CanvasTexture> {
  const image = await loadImage(`/characters/${name}_opacity_color.png`);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue;
    const luminance = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    const value = luminance < 0.12 ? 44 : clamp255(150 + luminance * 105);
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.flipY = false;
  map.anisotropy = 8;
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

/**
 * Maska fryzury na teksturze głowy. Skóra ma charakterystyczny stosunek
 * kanałów i jasność; włosy są ciemniejsze / bardziej żółto-brązowe. Środkowy
 * owal twarzy jest wyłączony, żeby nie przebarwiać oczu i ust.
 */
async function makeHeadBase(name: string): Promise<HeadBase> {
  const image = await loadImage(`/characters/${name}_head_color.jpg`);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  const length = canvas.width * canvas.height;
  const skin = new Float32Array(length);
  const hair = new Float32Array(length);
  let hairSum = 0;
  let hairCount = 0;
  let skinSum = 0;
  let skinCount = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const x = p % canvas.width;
    const y = Math.floor(p / canvas.width);
    const nx = x / canvas.width;
    const ny = y / canvas.height;
    const inFace = nx > 0.3 && nx < 0.7 && ny > 0.15 && ny < 0.63;
    const gOverB = g / Math.max(b, 1);
    const rOverG = r / Math.max(g, 1);
    const isSkin = luminance > 0.38 && gOverB < 1.46 && rOverG < 1.62 && b > 48;
    const isBackground = luminance < 0.035;
    skin[p] = isSkin ? 1 : 0;
    hair[p] = !inFace && !isSkin && !isBackground && luminance > 0.06 ? 1 : 0;
    if (skin[p]) { skinSum += luminance; skinCount += 1; }
    if (hair[p]) { hairSum += luminance; hairCount += 1; }
  }
  return {
    width: canvas.width,
    height: canvas.height,
    data: new Uint8ClampedArray(data),
    skin,
    hair,
    hairLuma: hairCount ? hairSum / hairCount : 0.25,
    skinLuma: skinCount ? skinSum / skinCount : 0.65,
  };
}

async function makeBodyLook(name: string): Promise<BodyLook> {
  const [colorImage, normalImage] = await Promise.all([
    loadImage(`/characters/${name}_body_color.jpg`),
    loadImage(`/characters/${name}_body_normal.jpg`),
  ]);
  return {
    color: canvasTexture(colorImage, true),
    normal: canvasTexture(normalImage, false),
  };
}

function dressUp(scene: THREE.Group, name: string, hairMap: THREE.Texture): void {
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
      material.map = hairMap;
      material.alphaTest = 0.5;
      material.transparent = true;
      material.side = THREE.DoubleSide;
      material.roughness = 0.85;
      material.emissive.set(0x000000);
      material.emissiveIntensity = 1;
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
  const [models, animationLibs, hairMaps, headBases, bodyLookEntries] = await Promise.all([
    Promise.all(AVATAR_NAMES.map((name) => loader.loadAsync(`/characters/${name}.glb`))),
    Promise.all([
      loader.loadAsync('/characters/anim_f.glb'),
      loader.loadAsync('/characters/anim_m.glb'),
    ]),
    Promise.all(AVATAR_NAMES.map(makeHairMap)),
    Promise.all(AVATAR_NAMES.map(makeHeadBase)),
    Promise.all(OUTFITS.map(async (outfit) => [outfit.body, await makeBodyLook(outfit.body)] as const)),
  ]);

  const templates: HumanTemplate[] = models.map((gltf, i) => {
    const name = AVATAR_NAMES[i];
    dressUp(gltf.scene, name, hairMaps[i]);
    normalizeHeight(gltf.scene);
    return { scene: gltf.scene, female: CHARACTER_MODELS[i].female };
  });

  const bases = new Map<string, HeadBase>();
  AVATAR_NAMES.forEach((name, i) => bases.set(name, headBases[i]));
  const headCache = new Map<string, THREE.CanvasTexture>();

  const headTexture = (name: string, skinHex: string, hairHex: string): THREE.Texture => {
    const key = `${name}|${skinHex}|${hairHex}`;
    const cached = headCache.get(key);
    if (cached) return cached;
    const base = bases.get(name) ?? headBases[0];
    const canvas = document.createElement('canvas');
    canvas.width = base.width;
    canvas.height = base.height;
    const context = canvas.getContext('2d')!;
    const output = context.createImageData(base.width, base.height);
    const [sr, sg, sb] = hexRgb(skinHex);
    const [hr, hg, hb] = hexRgb(hairHex);
    for (let i = 0, p = 0; i < base.data.length; i += 4, p += 1) {
      const r = base.data[i];
      const g = base.data[i + 1];
      const b = base.data[i + 2];
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      if (base.skin[p] > 0) {
        // Zachowujemy rysunek twarzy i ciepły odcień oryginału: bez domieszki
        // skóra wychodziła kredowo-biała niezależnie od wybranego koloru.
        const f = Math.max(0.5, Math.min(1.16, 0.3 + 0.7 * (luminance / base.skinLuma)));
        output.data[i] = clamp255(0.84 * sr * f + 0.16 * r);
        output.data[i + 1] = clamp255(0.84 * sg * f + 0.16 * g);
        output.data[i + 2] = clamp255(0.84 * sb * f + 0.16 * b);
      } else if (base.hair[p] > 0) {
        // Bez normalizacji ciemna, wypieczona fryzura zawsze dawała brąz,
        // nawet przy wybranym blondzie. Teraz kolor jest kolorem bazowym.
        const f = Math.max(0.32, Math.min(1.65, 0.25 + 0.75 * (luminance / base.hairLuma)));
        output.data[i] = clamp255(hr * f);
        output.data[i + 1] = clamp255(hg * f);
        output.data[i + 2] = clamp255(hb * f);
      } else {
        output.data[i] = r;
        output.data[i + 1] = g;
        output.data[i + 2] = b;
      }
      output.data[i + 3] = base.data[i + 3];
    }
    context.putImageData(output, 0, 0);
    const map = new THREE.CanvasTexture(canvas);
    map.flipY = false;
    map.anisotropy = 8;
    map.colorSpace = THREE.SRGBColorSpace;
    headCache.set(key, map);
    return map;
  };

  return {
    templates,
    femaleClips: inPlaceClips(animationLibs[0].animations),
    maleClips: inPlaceClips(animationLibs[1].animations),
    hairMaps,
    bodyLooks: new Map(bodyLookEntries),
    headTexture,
  };
}

interface FingerRig {
  bone: THREE.Object3D;
  rest: THREE.Quaternion;
  curlAxis: THREE.Vector3;
  normalAxis: THREE.Vector3;
}

type State = 'idle' | 'walk' | 'emote';

export interface HumanAvatarOptions {
  color: string;
  label?: string;
  appearance: Appearance;
}

export class HumanAvatar implements Avatar {
  readonly root = new THREE.Group();

  private readonly assets: HumanAssets;
  private readonly model: THREE.Group;
  private readonly modelName: string;
  private readonly mixer: THREE.AnimationMixer;
  private readonly idle: THREE.AnimationAction;
  private readonly walk: THREE.AnimationAction;
  private readonly clips: THREE.AnimationClip[];
  private readonly emoteActions = new Map<string, THREE.AnimationAction>();
  private currentEmote: THREE.AnimationAction;
  private readonly accentMaterial: THREE.MeshStandardMaterial;
  private readonly headMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly bodyMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly hairMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly label: LabelHandle | undefined;
  private state: State = 'idle';
  private readonly weights: Record<State, number> = { idle: 1, walk: 0, emote: 0 };
  private lastElapsed = 0;
  private waveStart = -100;
  private waveDuration = 2.8;
  private handTargets: HandPosePair = neutralHandPosePair();
  private handCurrent: HandPosePair = neutralHandPosePair();
  private readonly handRigs: Record<'L' | 'R', FingerRig[]> = { L: [], R: [] };
  private handOverride = false;

  constructor(assets: HumanAssets, templateIndex: number, options: HumanAvatarOptions) {
    this.assets = assets;
    const index = templateIndex % assets.templates.length;
    const template = assets.templates[index];
    this.modelName = AVATAR_NAMES[index];
    this.model = cloneSkeleton(template.scene) as THREE.Group;
    this.root.add(this.model);
    this.clips = template.female ? assets.femaleClips : assets.maleClips;

    this.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = (object.material as THREE.MeshStandardMaterial).clone();
      object.material = material;
      const label = material.name.toLowerCase();
      if (label.includes('head')) this.headMaterials.push(material);
      else if (label.includes('body')) this.bodyMaterials.push(material);
      else if (label.includes('opacity')) this.hairMaterials.push(material);
    });

    this.mixer = new THREE.AnimationMixer(this.model);
    const find = (name: string): THREE.AnimationClip =>
      this.clips.find((clip) => clip.name === name) ?? this.clips[0];
    this.idle = this.mixer.clipAction(find('idle-loop'));
    this.walk = this.mixer.clipAction(find('walk-loop'));
    for (const action of [this.idle, this.walk]) {
      action.play();
      action.setEffectiveWeight(0);
    }
    this.idle.setEffectiveWeight(1);
    this.currentEmote = this.emoteAction('wave');
    this.waveDuration = this.currentEmote.getClip().duration;

    this.setAppearance(options.appearance);
    this.buildHandRig();

    this.accentMaterial = new THREE.MeshStandardMaterial({
      color: options.color,
      emissive: options.color,
      emissiveIntensity: 0.08,
      roughness: 0.9,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.018, 8, 48), this.accentMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.025;
    this.root.add(ring);

    if (options.label) {
      this.label = createLabel(options.label);
      this.label.sprite.position.set(0, 2.02 + Math.random() * 0.3, 0);
      this.root.add(this.label.sprite);
    }
  }

  private emoteAction(name: string): THREE.AnimationAction {
    const clip =
      this.clips.find((entry) => entry.name === name) ??
      this.clips.find((entry) => entry.name === 'wave') ??
      this.clips[0];
    let action = this.emoteActions.get(clip.name);
    if (!action) {
      action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      action.setEffectiveWeight(0);
      this.emoteActions.set(clip.name, action);
    }
    return action;
  }

  playEmote(clipName: string): void {
    const action = this.emoteAction(clipName);
    action.reset();
    action.play();
    action.setEffectiveWeight(0);
    this.currentEmote = action;
    this.waveDuration = action.getClip().duration;
    this.waveStart = this.lastElapsed;
  }

  /**
   * Mapujemy 15 stawów każdej dłoni na kości Rocketbox. Oś zgięcia liczymy
   * z restowej pozycji palca i normalnej dłoni, więc działa dla każdego z 13
   * modeli (różne rigi, różne długości palców) bez ręcznego kalibrowania.
   */
  private buildHandRig(): void {
    this.model.updateMatrixWorld(true);
    const wristPos = new THREE.Vector3();
    const indexPos = new THREE.Vector3();
    const pinkyPos = new THREE.Vector3();

    for (const side of ['L', 'R'] as const) {
      // GLTFLoader zamienia spacje w nazwach węzłów na podkreślenia —
      // obsługujemy obie formy, żeby rig działał niezależnie od eksportera.
      const find = (name: string): THREE.Object3D | undefined =>
        this.model.getObjectByName(`Bip01 ${side} ${name}`) ??
        this.model.getObjectByName(`Bip01_${side}_${name}`);
      const wrist = find('Hand');
      const indexBase = find('Finger1');
      const pinkyBase = find('Finger4');
      if (!wrist || !indexBase || !pinkyBase) continue;

      wrist.getWorldPosition(wristPos);
      indexBase.getWorldPosition(indexPos);
      pinkyBase.getWorldPosition(pinkyPos);
      const normal = new THREE.Vector3()
        .crossVectors(indexPos.clone().sub(wristPos), pinkyPos.clone().sub(wristPos))
        .normalize();
      if (normal.lengthSq() < 0.5) normal.set(0, 1, 0);

      for (let f = 0; f < 5; f += 1) {
        for (let j = 0; j < 3; j += 1) {
          const suffix = j === 0 ? '' : String(j);
          const bone = find(`Finger${f}${suffix}`);
          if (!bone) continue;
          const worldQuat = bone.getWorldQuaternion(new THREE.Quaternion());
          const inverse = worldQuat.clone().invert();
          const direction = new THREE.Vector3(1, 0, 0).applyQuaternion(worldQuat).normalize();
          const curlAxis = new THREE.Vector3()
            .crossVectors(direction, normal)
            .normalize()
            .applyQuaternion(inverse);
          const normalAxis = normal.clone().applyQuaternion(inverse);
          this.handRigs[side].push({
            bone,
            rest: bone.quaternion.clone(),
            curlAxis,
            normalAxis,
          });
        }
      }
    }
  }

  /** Surowy odczyt obu dłoni z kamerki (kąty, nie gesty). */
  setHandPose(pair: HandPosePair): void {
    this.handTargets = pair;
  }

  private applyHandPose(dt: number): void {
    const active = this.handTargets.L.present || this.handTargets.R.present;
    if (!active) {
      // Bez dłoni w kadrze kości wracają pod kontrolę animacji idle/walk/emote.
      this.handOverride = false;
      return;
    }
    const k = 1 - Math.exp(-dt * 18);
    blendPose(this.handCurrent.L, this.handTargets.L, k);
    blendPose(this.handCurrent.R, this.handTargets.R, k);
    this.handOverride = true;

    for (const side of ['L', 'R'] as const) {
      const pose = this.handCurrent[side];
      const rigs = this.handRigs[side];
      for (let f = 0; f < 5; f += 1) {
        for (let j = 0; j < 3; j += 1) {
          const rig = rigs[f * 3 + j];
          if (!rig) continue;
          const curl = rig.rest.clone().multiply(
            new THREE.Quaternion().setFromAxisAngle(rig.curlAxis, pose.curl[f][j]),
          );
          if (j === 0) {
            curl.multiply(
              new THREE.Quaternion().setFromAxisAngle(rig.normalAxis, -pose.spread[f] * 0.7),
            );
          }
          rig.bone.quaternion.copy(curl);
        }
      }
    }
  }

  setColor(hex: string): void {
    this.accentMaterial.color.set(hex);
    this.accentMaterial.emissive.set(hex);
  }

  setAppearance(appearance: Appearance): void {
    const outfit = getOutfit(appearance.outfit);
    const body = this.assets.bodyLooks.get(outfit.body);
    const headMap = this.assets.headTexture(this.modelName, appearance.skin, appearance.hair);

    for (const material of this.bodyMaterials) {
      if (body) {
        material.map = body.color;
        material.normalMap = body.normal;
      }
      material.color.set(0xffffff);
      material.needsUpdate = true;
    }
    for (const material of this.headMaterials) {
      material.map = headMap;
      material.color.set(0xffffff);
      material.needsUpdate = true;
    }
    for (const material of this.hairMaterials) {
      material.color.set(appearance.hair);
      material.emissive.set(appearance.hair);
      material.emissiveIntensity = 0.12;
      material.needsUpdate = true;
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
    this.playEmote('wave');
  }

  isWaving(): boolean {
    return this.lastElapsed - this.waveStart < this.waveDuration;
  }

  update(elapsed: number, intensity: number): void {
    const dt = THREE.MathUtils.clamp(elapsed - this.lastElapsed, 0, 0.05);
    this.lastElapsed = elapsed;
    const desired: State = this.isWaving() ? 'emote' : intensity > 0.12 ? 'walk' : 'idle';
    this.state = desired;
    const target: Record<State, number> = { idle: 0, walk: 0, emote: 0 };
    target[desired] = 1;
    const k = 1 - Math.exp(-dt * 9);
    for (const key of ['idle', 'walk', 'emote'] as const) {
      this.weights[key] += (target[key] - this.weights[key]) * k;
    }
    this.idle.setEffectiveWeight(this.weights.idle);
    this.walk.setEffectiveWeight(this.weights.walk);
    for (const action of this.emoteActions.values()) {
      action.setEffectiveWeight(action === this.currentEmote ? this.weights.emote : 0);
    }
    this.mixer.update(dt);
    this.applyHandPose(dt);
  }

  dispose(): void {
    // Tekstury są współdzielone i cache'owane w HumanAssets.
  }
}
