import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { lowPowerDevice } from './performance';

/**
 * Gotowe, darmowe assety 3D (CC0 / MIT) w realisticznym stylu postaci.
 *
 * Źródło: repozytorium GridFall (KunalSiyag/gridfall, MIT), katalog
 * `models/real/`. Tekstury pochodzą z Poly Haven (CC0 1.0), a geometria
 * pojazdów i małych rekwizytów jest proceduralna autorów GridFall.
 * Wszystkie pliki .glb mają tekstury OSADZONE — działają bez CDN i offline.
 * Noty: public/assets/LICENSE-polyhaven-cc0.txt,
 *       public/assets/LICENSE-gridfall-MIT.txt.
 *
 * Modele są w skali „miejskiej” (1 jednostka ≈ 20 m), stąd mnożnik 11–18.
 */

const BASE = import.meta.env.BASE_URL;

interface SceneryProp {
  file: string;
  scale: number;
  position: [number, number, number];
  rotation?: number;
}

const LOBBY_PROPS: SceneryProp[] = [
  { file: 'tree_oak', scale: 15, position: [-9.4, 0, -2.6] },
  { file: 'tree_birch', scale: 14, position: [9.6, 0, 1.8] },
  { file: 'tree_round', scale: 13, position: [-6.4, 0, 8.4] },
  { file: 'fountain', scale: 12, position: [-6.8, 0, -5.6] },
  { file: 'bench_modern', scale: 16, position: [-6.0, 0, 3.4], rotation: -0.5 },
  { file: 'bench_modern', scale: 16, position: [6.1, 0, 6.0], rotation: 2.7 },
  { file: 'lamp_double', scale: 11, position: [-10.0, 0, 1.2], rotation: 0.3 },
  { file: 'lamp_street', scale: 11, position: [10.0, 0, -6.2], rotation: -0.4 },
  { file: 'planter_round', scale: 16, position: [-4.7, 0, 4.4] },
  { file: 'tree_bush', scale: 16, position: [4.4, 0, -4.8] },
  { file: 'utility_box', scale: 14, position: [9.6, 0, 4.6], rotation: 1.2 },
  { file: 'bollard', scale: 16, position: [-2.2, 0, 6.7] },
  { file: 'bollard', scale: 16, position: [2.2, 0, 6.7] },
];

const YARD_PROPS: SceneryProp[] = [
  { file: 'lamp_street', scale: 11, position: [-3.3, 0, 11.2], rotation: Math.PI / 2 },
  { file: 'tree_birch', scale: 13, position: [-3.5, 0, 16.4] },
  { file: 'tree_bush', scale: 16, position: [-2.9, 0, 10.6] },
  { file: 'tree_bush', scale: 16, position: [3.3, 0, 16.9] },
  { file: 'barrier_concrete', scale: 13, position: [-3.4, 0, 17.4], rotation: Math.PI / 2 },
  { file: 'cone', scale: 16, position: [-1.9, 0, 10.1] },
  { file: 'cone', scale: 16, position: [1.9, 0, 10.1] },
  { file: 'trash_bin_wheelie', scale: 14, position: [3.3, 0, 10.4] },
  { file: 'aircon_unit', scale: 13, position: [7.9, 0.9, 8.6], rotation: Math.PI },
  { file: 'hydrant', scale: 16, position: [-3.4, 0, 13.4] },
];

/** Jeden loader dla wszystkich plików: parsowanie GLB jest współdzielone. */
async function mount(scene: THREE.Scene, props: SceneryProp[], name: string): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const group = new THREE.Group();
  group.name = name;
  const list = lowPowerDevice() ? props.slice(0, 6) : props;
  const roots = await Promise.all(
    list.map(async (prop) => {
      try {
        const gltf = await loader.loadAsync(`${BASE}assets/props/${prop.file}.glb`);
        const root = gltf.scene;
        root.scale.setScalar(prop.scale);
        root.position.set(...prop.position);
        root.rotation.y = prop.rotation ?? 0;
        root.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = true;
          object.receiveShadow = true;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (!(material instanceof THREE.MeshStandardMaterial)) continue;
            material.roughness = Math.min(1, Math.max(0.6, material.roughness));
            material.envMapIntensity = 0.65;
            material.needsUpdate = true;
          }
        });
        return root;
      } catch {
        return null;
      }
    }),
  );
  for (const root of roots) if (root) group.add(root);
  scene.add(group);
  return group;
}

let lobbyPromise: Promise<THREE.Group> | null = null;
export function loadLobbyScenery(scene: THREE.Scene): Promise<THREE.Group> {
  lobbyPromise ??= mount(scene, LOBBY_PROPS, 'lobby-scenery-cc0');
  return lobbyPromise;
}

let yardPromise: Promise<THREE.Group> | null = null;
export function loadYardScenery(scene: THREE.Scene): Promise<THREE.Group> {
  yardPromise ??= mount(scene, YARD_PROPS, 'yard-scenery-cc0');
  return yardPromise;
}

function signTexture(text: string, sub: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0d1412';
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#9ad8c4';
  ctx.lineWidth = 6;
  ctx.strokeRect(14, 14, 484, 228);
  ctx.fillStyle = '#d9f2e8';
  ctx.font = '600 62px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, 256, 120);
  ctx.fillStyle = '#8fb7aa';
  ctx.font = '400 27px ui-monospace, monospace';
  ctx.fillText(sub, 256, 176);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function gravelTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#2a2b28';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i += 1) {
    const v = 30 + Math.floor(Math.random() * 55);
    ctx.fillStyle = `rgba(${v},${v + 3},${v - 2},${0.25 + Math.random() * 0.5})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(4, 5);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

/**
 * Baza na podwórku: samochód (CC0/MIT), stanowisko monitoringu, ogrodzenie,
 * reflektor. Zbudowane w współrzędnych świata gry — dom kończy się na z=9,
 * podwórko biegnie do z≈17.4, a samochód stoi po prawej stronie dojazdu.
 */
export function buildBaseCamp(scene: THREE.Scene): THREE.Group {
  const camp = new THREE.Group();
  camp.name = 'base-camp';

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(8.4, 9.2),
    new THREE.MeshStandardMaterial({ map: gravelTexture(), color: 0x9c9b94, roughness: 0.98 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0.012, 13.2);
  ground.receiveShadow = true;
  camp.add(ground);

  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x31383a, roughness: 0.85, metalness: 0.35 });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 9; i += 1) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.65, 0.09), fenceMat);
      post.position.set(side * 4.05, 0.82, 9.0 + i * 1.05);
      post.castShadow = true;
      camp.add(post);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 8.6), fenceMat);
    rail.position.set(side * 4.05, 1.25, 13.2);
    camp.add(rail);
  }
  for (let i = 0; i < 8; i += 1) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.65, 0.09), fenceMat);
    post.position.set(-4.05 + i * 1.16, 0.82, 17.6);
    camp.add(post);
  }

  const flood = new THREE.PointLight(0xffd8a4, 26, 15, 2);
  flood.position.set(-2.4, 3.1, 11.4);
  camp.add(flood);
  const vanLight = new THREE.PointLight(0x9ad8c4, 12, 7, 2);
  vanLight.position.set(1.0, 1.6, 13.4);
  camp.add(vanLight);

  // Stanowisko monitoringu: trzy ekrany + blat, zwrócone w stronę dojazdu.
  const deskMat = new THREE.MeshStandardMaterial({ color: 0x20282a, roughness: 0.7, metalness: 0.25 });
  const desk = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.6), deskMat);
  desk.position.set(1.0, 0.95, 13.0);
  desk.castShadow = true;
  camp.add(desk);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), deskMat);
    leg.position.set(1.0 + side * 0.66, 0.45, 13.0);
    camp.add(leg);
  }
  const screenMat = new THREE.MeshStandardMaterial({
    map: signTexture('BAZA', 'MONITORING · WRZOSOWA 12'),
    emissive: 0x6fd4b0, emissiveMap: signTexture('BAZA', 'MONITORING · WRZOSOWA 12'),
    emissiveIntensity: 0.65, roughness: 0.4,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.62), screenMat);
  screen.position.set(1.0, 1.38, 13.0);
  screen.rotation.x = -0.16;
  camp.add(screen);

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.75),
    new THREE.MeshStandardMaterial({
      map: signTexture('BAZA', 'WRZOSOWA 12'), emissiveMap: signTexture('BAZA', 'WRZOSOWA 12'),
      emissive: 0x88c9b4, emissiveIntensity: 0.5, side: THREE.DoubleSide,
    }),
  );
  sign.position.set(2.7, 2.35, 11.15);
  sign.rotation.y = Math.PI;
  camp.add(sign);

  // Samochód ładujemy asynchronicznie: brak pliku nie blokuje rozgrywki.
  void new GLTFLoader().loadAsync(`${BASE}assets/props/van_white.glb`)
    .then((gltf) => {
      const van = gltf.scene;
      van.scale.setScalar(18);
      van.position.set(2.7, 0, 13.9);
      van.rotation.y = 0;
      van.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = true;
        object.receiveShadow = true;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.roughness = Math.min(1, Math.max(0.5, material.roughness));
            material.needsUpdate = true;
          }
        }
      });
      camp.add(van);
    })
    .catch(() => undefined);

  void loadYardScenery(scene);
  scene.add(camp);
  return camp;
}
