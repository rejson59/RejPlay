import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { getOutfit, outfitBody } from './games';
import type { HumanAssets, HumanTemplate } from './human';
import type { Appearance } from './character';
import {
  HandAnimator,
  type HandMotion,
  type HandPose,
} from './hand-pose';

/**
 * Dłonie first-person to PRAWDZIWE dłonie wybranego awatara.
 *
 * Nie budujemy tu żadnego osobnego „viewmodelu” z kapsułek. Bierzemy oryginalny,
 * rigowany i teksturowany szkielet Rocketbox, wycinamy z niego tylko trójkąty
 * przypisane do kości przedramienia/nadgarstka/palców i wstawiamy ten sam
 * SkinnedMesh przed kamerę. Skóra, paznokcie, rękawy i proporcje palców są
 * więc identyczne z postacią w lobby — zmieniają się razem z edytorem.
 *
 * Te same 15 kątów z src/hand-pose.ts steruje palcami awatara i tym widokiem.
 */

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Wąski ekran w pionie ma małe pole widzenia w poziomie — poszerzamy FOV. */
export function viewmodelFov(aspect: number): number {
  return THREE.MathUtils.clamp(60 + Math.max(0, 0.9 - aspect) * 34, 60, 78);
}

/**
 * Objętość śledzenia: kadr kamerki (znormalizowany −1..1) odwzorowany na
 * przestrzeń przed kamerą viewmodelu. Dzięki temu przesunięcie dłoni o 10%
 * szerokości kadru przesuwa dłoń w grze o 10% szerokości ekranu — nie o 3 px.
 */
interface HandSpace {
  halfW: number;
  halfH: number;
  restX: number;
  restY: number;
  restZ: number;
  scale: number;
  /** Skala w trakcie śledzenia (na wąskim ekranie nie zmniejszamy już dłoni). */
  trackedScale: number;
}

function makeHandSpace(aspect: number, fov: number, side: 'L' | 'R'): HandSpace {
  const halfH = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * 0.62;
  const halfW = halfH * Math.max(0.3, aspect);
  const portrait = aspect < 0.85;
  const x = portrait ? halfW * 0.78 : THREE.MathUtils.clamp(halfW * 0.60, 0.10, 0.33);
  const y = portrait ? -halfH * 0.80 : -THREE.MathUtils.clamp(halfH * 1.12, 0.26, 0.40);
  // W pionie dłoń musi być wyraźnie mniejsza, inaczej zasłania pół ekranu.
  const scale = portrait ? 0.34 : THREE.MathUtils.clamp(aspect / 1.45, 0.6, 1);
  return {
    halfW,
    halfH,
    restX: side === 'L' ? -x : x,
    restY: y,
    restZ: -0.62,
    scale,
    trackedScale: portrait ? scale : scale * 0.7,
  };
}

/** Pozycja 1:1 z kamerki + miękki powrót do spoczynku, gdy dłoń znika. */
function applyTrackedPosition(
  out: THREE.Vector3,
  pose: HandPose,
  space: HandSpace,
  motion: HandMotion,
): THREE.Vector3 {
  const p = pose.presence;
  // 0.94 = lekki margines, żeby dłoń przy samej krawędzi kadru nie wjechała
  // całkiem poza ekran. Poza tym skala jest liniowa w całym kadrze.
  const tx = THREE.MathUtils.clamp(
    pose.wrist.x * space.halfW * 0.94,
    -space.halfW * 1.08,
    space.halfW * 1.08,
  );
  // W pionie zostawiamy dłoniom dolną połowę ekranu: przy pełnym 1:1 w górę
  // do kadru wjeżdżałoby całe przedramię awatara i zasłaniało widok. Zakres
  // nadal jest duży (ponad połowa wysokości ekranu względem spoczynku), a w
  // poziomie odwzorowanie jest w pełni liniowe w całym kadrze kamerki.
  const ty = -space.halfH * 0.42 + pose.wrist.y * space.halfH * 0.30;
  const tz = space.restZ + pose.wrist.z * 0.17;
  // Kołysanie i opóźnienie przy skręcie głowy słabną, gdy dłoń jest śledzona:
  // wtedy ma być wierna ruchowi, a nie animacji postaci.
  const turn = THREE.MathUtils.clamp(motion.turn * 0.016, -0.045, 0.045) * (1 - p * 0.65);
  const sway = Math.abs(motion.sway) * 0.006 * (1 - p * 0.6);
  return out.set(
    THREE.MathUtils.lerp(space.restX, tx, p) + turn,
    THREE.MathUtils.lerp(space.restY, ty, p) + sway,
    THREE.MathUtils.lerp(space.restZ, tz, p),
  );
}

/** Delikatny przechył: dłoń prowadzona w bok nie jedzie jak na szynach. */
function travelRoll(x: number, presence: number): number {
  return THREE.MathUtils.clamp(-x * 0.13, -0.17, 0.17) * presence;
}

function findBone(root: THREE.Object3D, side: 'L' | 'R', name: string): THREE.Object3D | undefined {
  return (
    root.getObjectByName(`Bip01 ${side} ${name}`) ??
    root.getObjectByName(`Bip01_${side}_${name}`)
  );
}

interface FingerRig {
  bone: THREE.Object3D;
  rest: THREE.Quaternion;
  curlAxis: THREE.Vector3;
  normalAxis: THREE.Vector3;
}

interface WristRig {
  bone: THREE.Object3D;
  rest: THREE.Quaternion;
  pitchAxis: THREE.Vector3;
  yawAxis: THREE.Vector3;
  rollAxis: THREE.Vector3;
  /** Kierunek palców w lokalnej przestrzeni kości — oś skrętu nadgarstka. */
  twistAxis: THREE.Vector3;
}

interface ViewHandRig {
  fingers: FingerRig[];
  wrist: WristRig | null;
}

/**
 * v0.6.1: osie zgięcia wyznaczamy GEOMETRYCZNIE z restowej pozycji kości.
 *
 * Wcześniej w tym pliku (first-person) została stara wersja z `cross(dir,
 * normal)` i ujemnym znakiem rozstawienia. Naprawa trafiła tylko do rigu
 * third-person w src/human.ts, więc użytkownik wciąż widział palce jednej
 * dłoni wyginające się na zewnątrz. Testujemy znak na konkretnej kości:
 * dodatni kąt ma przybliżać opuszkę do wnętrza dłoni i oddalać palec od
 * palca środkowego — dla obu rigów i obu stron, bez ręcznych stałych.
 */
function buildViewHandRig(model: THREE.Object3D, side: 'L' | 'R'): ViewHandRig {
  model.updateMatrixWorld(true);
  const wrist = findBone(model, side, 'Hand');
  const indexBase = findBone(model, side, 'Finger1');
  const pinkyBase = findBone(model, side, 'Finger4');
  const middleBase = findBone(model, side, 'Finger2');
  if (!wrist || !indexBase || !pinkyBase || !middleBase) return { fingers: [], wrist: null };

  const wristPos = wrist.getWorldPosition(new THREE.Vector3());
  const indexPos = indexBase.getWorldPosition(new THREE.Vector3());
  const pinkyPos = pinkyBase.getWorldPosition(new THREE.Vector3());
  const normal = new THREE.Vector3()
    .crossVectors(indexPos.clone().sub(wristPos), pinkyPos.clone().sub(wristPos))
    .normalize();
  if (normal.lengthSq() < 0.5) normal.set(0, 0, 1);
  const middleDirWorld = middleBase.getWorldPosition(new THREE.Vector3()).sub(wristPos).normalize();

  // Obrót nadgarstka dokładamy na KOŚCI Hand, a nie tylko na całym viewmodelu.
  // Dzięki temu skręt widać na samych palcach (pronacja / supinacja), nawet
  // gdy dłoń stoi nieruchomo w jednym miejscu kadru.
  const wristWorldQuat = wrist.getWorldQuaternion(new THREE.Quaternion());
  const wristInverse = wristWorldQuat.clone().invert();
  const wristRig: WristRig = {
    bone: wrist,
    rest: wrist.quaternion.clone(),
    pitchAxis: new THREE.Vector3(1, 0, 0).applyQuaternion(wristInverse),
    yawAxis: new THREE.Vector3(0, 1, 0).applyQuaternion(wristInverse),
    rollAxis: new THREE.Vector3(0, 0, 1).applyQuaternion(wristInverse),
    twistAxis: middleDirWorld.clone().applyQuaternion(wristInverse).normalize(),
  };

  const rigs: FingerRig[] = [];
  for (let f = 0; f < 5; f += 1) {
    for (let j = 0; j < 3; j += 1) {
      const bone = findBone(model, side, `Finger${f}${j === 0 ? '' : j}`);
      if (!bone) {
        rigs.push(null as unknown as FingerRig);
        continue;
      }
      const worldQuat = bone.getWorldQuaternion(new THREE.Quaternion());
      const inverse = worldQuat.clone().invert();
      const direction = V(1, 0, 0).applyQuaternion(worldQuat).normalize();
      const bonePos = bone.getWorldPosition(new THREE.Vector3());

      const worldCurl = new THREE.Vector3().crossVectors(direction, normal).normalize();
      const towardPalm = wristPos.clone().sub(bonePos).normalize();
      const before = direction.dot(towardPalm);
      const after = direction.clone().applyAxisAngle(worldCurl, 0.3).dot(towardPalm);
      if (after < before) worldCurl.negate();
      const curlAxis = worldCurl.clone().applyQuaternion(inverse);

      const worldSpread = normal.clone();
      if (j === 0) {
        const radial = bonePos.clone().sub(wristPos).normalize();
        const beforeSpread = radial.dot(middleDirWorld);
        const afterSpread = radial.clone().applyAxisAngle(worldSpread, 0.3).dot(middleDirWorld);
        if (afterSpread > beforeSpread) worldSpread.negate();
      }
      rigs.push({
        bone,
        rest: bone.quaternion.clone(),
        curlAxis,
        normalAxis: worldSpread.applyQuaternion(inverse),
      });
    }
  }
  return { fingers: rigs, wrist: wristRig };
}

/** Zostawiamy tylko trójkąty, których wierzchołki są skinowane do dłoni. */
function cropHandGeometry(mesh: THREE.SkinnedMesh, side: 'L' | 'R'): THREE.BufferGeometry | null {
  const geometry = mesh.geometry;
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  const index = geometry.getIndex();
  if (!skinIndex || !skinWeight) return null;

  const prefix = `Bip01_${side}_`;
  const wanted = new Set<number>();
  mesh.skeleton.bones.forEach((bone, i) => {
    const name = bone.name.replace(/\s+/g, '_');
    if (!name.startsWith(prefix)) return;
    const tail = name.slice(prefix.length);
    if (tail === 'Hand' || tail === 'Forearm' || tail.startsWith('Finger')) wanted.add(i);
  });
  if (!wanted.size) return null;

  const vertexCount = skinIndex.count;
  const triangleCount = Math.floor((index ? index.count : vertexCount) / 3);
  const kept: number[] = [];
  const vertexOf = (n: number): number => (index ? index.getX(n) : n);
  for (let t = 0; t < triangleCount; t += 1) {
    const a = vertexOf(t * 3);
    const b = vertexOf(t * 3 + 1);
    const c = vertexOf(t * 3 + 2);
    let keep = false;
    for (const v of [a, b, c]) {
      let best = -1;
      let bestWeight = 0;
      for (let k = 0; k < 4; k += 1) {
        const w = skinWeight.getComponent(v, k);
        if (w > bestWeight) {
          bestWeight = w;
          best = skinIndex.getComponent(v, k);
        }
      }
      if (wanted.has(best)) {
        keep = true;
        break;
      }
    }
    if (keep) kept.push(a, b, c);
  }
  if (!kept.length) return null;
  const cropped = geometry.clone();
  cropped.setIndex(kept);
  cropped.computeBoundingSphere();
  return cropped;
}

export interface AvatarViewHandOptions {
  template: HumanTemplate;
  female: boolean;
  side: 'L' | 'R';
  assets: HumanAssets;
  appearance: Appearance;
  /** Pozycja bazowa w przestrzeni kamery. */
  base: THREE.Vector3;
}

export class AvatarViewHand {
  readonly root = new THREE.Group();

  private readonly base: THREE.Vector3;
  private readonly side: 'L' | 'R';
  private readonly assets: HumanAssets;
  private space: HandSpace;
  private readonly animator = new HandAnimator({ idle: true });
  // Scratch — 15 stawów × 2 dłonie nie może alokować 60 kwaternionów co klatkę.
  private readonly qRest = new THREE.Quaternion();
  private readonly qCurl = new THREE.Quaternion();
  private readonly qSpread = new THREE.Quaternion();
  private readonly qWristRest = new THREE.Quaternion();
  private readonly qWrist = new THREE.Quaternion();
  private model: THREE.Group | null = null;
  private rigs: FingerRig[] = [];
  private wristRig: WristRig | null = null;
  private material: THREE.MeshStandardMaterial | null = null;

  constructor(private options: AvatarViewHandOptions) {
    this.base = options.base.clone();
    this.side = options.side;
    this.assets = options.assets;
    this.space = makeHandSpace(16 / 9, 60, this.side);
    this.root.position.copy(this.base);
    this.rebuild();
  }

  /**
   * Na wąskim ekranie w pionie kamera ma znacznie mniejsze pole widzenia
   * w poziomie — dłonie z x = ±0.33 znikały poza kadrem. Przesuwamy je
   * proporcjonalnie do aspectu i zmniejszamy cały viewmodel.
   */
  setViewport(aspect: number, fov = 60): void {
    this.space = makeHandSpace(aspect, fov, this.side);
    this.base.set(this.space.restX, this.space.restY, this.space.restZ);
    this.root.scale.setScalar(this.space.scale);
    this.root.position.copy(this.base);
  }

  private rebuild(): void {
    const { template, female, assets, appearance, side } = this.options;
    const clone = cloneSkeleton(template.scene) as THREE.Group;
    let body: THREE.SkinnedMesh | null = null;
    clone.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return;
      const label = (object.material as THREE.Material).name.toLowerCase();
      if (label.includes('body')) body = object;
      else object.visible = false;
    });
    if (!body) return;

    const skinned = body as THREE.SkinnedMesh;
    const cropped = cropHandGeometry(skinned, side);
    if (!cropped) return;

    const material = (skinned.material as THREE.MeshStandardMaterial).clone();
    material.map = assets.bodyTexture(outfitBody(getOutfit(appearance.outfit), female), appearance.skin);
    material.normalMap = assets.bodyNormal(outfitBody(getOutfit(appearance.outfit), female));
    material.normalScale.set(0.4, 0.4);
    material.color.set(0xffffff);
    material.side = THREE.DoubleSide;
    material.roughness = 0.78;
    material.needsUpdate = true;
    skinned.material = material;
    skinned.geometry = cropped;
    skinned.frustumCulled = false;
    this.material = material;

    // Obracamy CAŁY wycinek szkieletu (nie pojedyncze kości), żeby palce
    // wskazywały w górę ekranu, a wnętrze dłoni było zwrócone do kamery.
    // Anatomia przedramienia pozostaje nienaruszona.
    clone.position.set(0, 0, 0);
    clone.quaternion.identity();
    clone.scale.setScalar(1);
    clone.updateMatrixWorld(true);
    const wrist = findBone(clone, side, 'Hand');
    const middle = findBone(clone, side, 'Finger2');
    const indexBase = findBone(clone, side, 'Finger1');
    const pinkyBase = findBone(clone, side, 'Finger4');
    if (!wrist || !middle || !indexBase || !pinkyBase) return;

    const wristPos = wrist.getWorldPosition(V(0, 0, 0));
    const fingerDir = middle.getWorldPosition(V(0, 0, 0)).sub(wristPos).normalize();
    const normal = new THREE.Vector3()
      .crossVectors(
        indexBase.getWorldPosition(V(0, 0, 0)).sub(wristPos),
        pinkyBase.getWorldPosition(V(0, 0, 0)).sub(wristPos),
      )
      .normalize();
    if (normal.lengthSq() < 0.5) normal.set(0, 0, 1);

    const align = new THREE.Quaternion().setFromUnitVectors(fingerDir, V(0, 1, 0));
    const rotatedNormal = normal.clone().applyQuaternion(align);
    const yaw = Math.atan2(rotatedNormal.x, rotatedNormal.z);
    const turn = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -yaw);
    clone.quaternion.copy(turn.multiply(align));
    clone.updateMatrixWorld(true);

    // Nadgarstek ląduje dokładnie w początku układu `root`.
    const scale = 1.72;
    const rotated = wrist.getWorldPosition(V(0, 0, 0));
    clone.scale.setScalar(scale);
    clone.position.copy(rotated).multiplyScalar(-scale);
    clone.updateMatrixWorld(true);
    this.root.add(clone);
    this.model = clone;
    const rig = buildViewHandRig(clone, side);
    this.rigs = rig.fingers;
    this.wristRig = rig.wrist;
  }

  setAppearance(appearance: Appearance, female: boolean, template?: HumanTemplate): void {
    this.options.appearance = appearance;
    this.options.female = female;
    if (template && template !== this.options.template) {
      this.options.template = template;
      if (this.model) this.root.remove(this.model);
      this.model = null;
      this.rebuild();
      return;
    }
    if (!this.material) return;
    const key = outfitBody(getOutfit(appearance.outfit), female);
    this.material.map = this.assets.bodyTexture(key, appearance.skin);
    this.material.normalMap = this.assets.bodyNormal(key);
    this.material.needsUpdate = true;
  }

  /**
   * 15 stawów + pozycja nadgarstka w 3D. Sprężyna daje bezwładność, a kontekst
   * ruchu (krok, obrót kamery, chwyt, skan) dokłada opóźnienie i mikro-ruch.
   */
  apply(target: HandPose, dt: number, motion: HandMotion): void {
    const pose = this.animator.step(target, dt, motion);

    for (let f = 0; f < 5; f += 1) {
      for (let j = 0; j < 3; j += 1) {
        const rig = this.rigs[f * 3 + j];
        if (!rig) continue;
        this.qRest.copy(rig.rest);
        this.qRest.multiply(this.qCurl.setFromAxisAngle(rig.curlAxis, pose.curl[f][j]));
        if (j === 0) {
          this.qRest.multiply(this.qSpread.setFromAxisAngle(rig.normalAxis, pose.spread[f] * 0.7));
        }
        rig.bone.quaternion.copy(this.qRest);
      }
    }

    // Skręt nadgarstka na samej kości Hand + wspomaganie na całym viewmodelu.
    // `pose.roll` jest teraz ciągłym kątem (v0.6.1), więc obrót dłoni widać
    // od razu, bez martwego zakresu i bez clampu do stałej wartości.
    if (this.wristRig) {
      const fade = pose.presence;
      this.qWristRest.copy(this.wristRig.rest);
      this.qWristRest.multiply(this.qWrist.setFromAxisAngle(this.wristRig.twistAxis, pose.roll * 0.95 * fade));
      this.qWristRest.multiply(this.qWrist.setFromAxisAngle(this.wristRig.pitchAxis, pose.pitch * 0.55 * fade));
      this.qWristRest.multiply(this.qWrist.setFromAxisAngle(this.wristRig.yawAxis, pose.yaw * 0.45 * fade));
      this.wristRig.bone.quaternion.copy(this.qWristRest);
    }

    // Pełne pozycjonowanie 3D: kadr kamerki = kadr gry. Gdy dłoni nie ma,
    // obecność wygasa i dłoń wraca do spoczynku przy dolnej krawędzi ekranu.
    applyTrackedPosition(this.root.position, pose, this.space, motion);
    // Śledzona dłoń wędruje po całym ekranie, więc lekko ją oddalamy: krótsze
    // przedramię nie zasłania widoku przy uniesieniu ręki nad głowę.
    this.root.scale.setScalar(THREE.MathUtils.lerp(this.space.scale, this.space.trackedScale, pose.presence));
    const turn = THREE.MathUtils.clamp(motion.turn * 0.016, -0.045, 0.045);
    this.root.rotation.set(
      pose.pitch * 0.34 + turn * 0.08,
      pose.yaw * 0.62 + motion.sway * 0.04 - turn * 0.55,
      pose.roll * 0.38 + turn * 0.22 + travelRoll(pose.wrist.x, pose.presence),
    );
  }
}

/**
 * Awaryjny widok, gdy GLB nie wczytały się wcale. Używany wyłącznie jako
 * fallback — w normalnym działaniu first-person korzysta z AvatarViewHand.
 */
export class FallbackViewHand {
  readonly root = new THREE.Group();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly joints: THREE.Group[][] = [];
  private readonly bases: THREE.Group[] = [];
  private readonly side: number;
  private readonly base: THREE.Vector3;
  private space: HandSpace;
  private readonly animator = new HandAnimator({ idle: true });

  constructor(side: 'L' | 'R', skin: string, base: THREE.Vector3) {
    this.side = side === 'L' ? 1 : -1;
    this.base = base.clone();
    this.space = makeHandSpace(16 / 9, 60, side);
    this.root.position.copy(this.base);
    this.material = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.84 });
    const segment = (radius: number, length: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), this.material);
      mesh.position.y = length / 2;
      return mesh;
    };
    const forearm = segment(0.039, 0.12);
    forearm.position.y = -0.075;
    this.root.add(forearm);
    const palm = new THREE.Mesh(new RoundedBoxGeometry(0.132, 0.145, 0.05, 3, 0.038), this.material);
    palm.position.y = 0.055;
    this.root.add(palm);
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
      const chain: THREE.Group[] = [];
      let pivot: THREE.Object3D = base;
      for (let j = 0; j < 3; j += 1) {
        const radius = (thumb ? 0.0165 : 0.0135) - j * 0.0018;
        const joint = new THREE.Group();
        joint.add(segment(radius, 0.04 - j * 0.008));
        pivot.add(joint);
        if (j > 0) joint.position.y = 0.04 - (j - 1) * 0.008;
        chain.push(joint);
        pivot = joint;
      }
      this.joints.push(chain);
    }
  }

  setViewport(aspect: number, fov = 60): void {
    const side: 'L' | 'R' = this.side > 0 ? 'L' : 'R';
    this.space = makeHandSpace(aspect, fov, side);
    this.base.set(this.space.restX, this.space.restY, this.space.restZ);
    this.root.scale.setScalar(this.space.scale);
    this.root.position.copy(this.base);
  }

  setSkin(hex: string): void {
    this.material.color.set(hex);
  }

  apply(target: HandPose, dt: number, motion: HandMotion): void {
    const pose = this.animator.step(target, dt, motion);
    for (let f = 0; f < 5; f += 1) {
      for (let j = 0; j < 3; j += 1) {
        this.joints[f][j].rotation.x = pose.curl[f][j] * (j === 0 ? 0.85 : 1);
      }
      this.bases[f].rotation.z =
        (f === 0 ? -this.side * 0.92 : 0) - this.side * pose.spread[f] * 0.7;
    }
    const turn = THREE.MathUtils.clamp(motion.turn * 0.016, -0.045, 0.045);
    applyTrackedPosition(this.root.position, pose, this.space, motion);
    this.root.scale.setScalar(THREE.MathUtils.lerp(this.space.scale, this.space.trackedScale, pose.presence));
    this.root.rotation.y = pose.yaw * 0.55 + motion.sway * 0.04 - turn * 0.55;
    this.root.rotation.x = pose.pitch * 0.4;
    this.root.rotation.z = pose.roll * 0.42 + turn * 0.22 + travelRoll(pose.wrist.x, pose.presence);
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
  private readonly labels = ['TERMOMETR', 'MIERNIK POLA', 'REJESTRATOR', 'LATARKA UV', 'CZUJNIK RUCHU', 'KAMERA NOCNA'];
  private readonly lens: THREE.Group = new THREE.Group();
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

    // Optyka dla trzech nowych narzędzi: UV, czujnik ruchu, kamera nocna.
    const lensShell = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.045, 16), shell);
    lensShell.rotation.x = Math.PI / 2;
    lensShell.position.set(0, 0.15, 0.012);
    this.lens.add(lensShell);
    const lensGlass = new THREE.Mesh(
      new THREE.CircleGeometry(0.016, 16),
      new THREE.MeshStandardMaterial({ color: 0x1a2a33, emissive: 0x2d6f8a, emissiveIntensity: 0.7, roughness: 0.25 }),
    );
    lensGlass.position.set(0, 0.15, 0.036);
    this.lens.add(lensGlass);
    this.root.add(this.lens);

    this.setTool(0);
  }

  setTool(index: number): void {
    this.toolIndex = index;
    this.probe.visible = index === 0;
    this.antenna.visible = index === 1;
    this.microphone.visible = index === 2;
    this.lens.visible = index >= 3;
    const colors = [0x9ad8c4, 0xb7a4e8, 0xe0b678, 0x9f86e0, 0x95c9e8, 0xd08f92];
    const glows = [0x4fb79a, 0x7b63c4, 0xb8863c, 0x6544b8, 0x3f83ad, 0xa34e58];
    this.accent.color.set(colors[index] ?? colors[0]);
    this.accent.emissive.set(glows[index] ?? glows[0]);
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
