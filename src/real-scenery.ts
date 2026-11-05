import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { lowPowerDevice } from './performance';

/**
 * Gotowe, darmowe assety 3D (CC0 / CC-BY 4.0 / MIT) dla całej platformy.
 *
 * v0.8: park nie zawiera już żadnych prymitywów — altana, klomby, oczko
 * wodne, tablica i zegar słoneczny zostały zastąpione gotowymi modelami GLB.
 * `park.ts` odpowiada wyłącznie za teksturowany teren, niebo i światła.
 *
 * v0.7: biblioteka jest wielogrowa. `public/assets/props/` to rekwizyty
 * parkowe używane też w Demonofobii, a `public/assets/library/` zawiera
 * meble, postacie, zwierzęta, pojazdy, budynki i przedmioty dla kolejnych
 * światów. Pełny katalog z licencjami: public/assets/ASSETS.json,
 * public/assets/LICENSE-*.txt, src/asset-catalog.ts.
 *
 * GridFall (MIT) + tekstury Poly Haven (CC0); Khronos glTF Sample Assets
 * (CC0 / CC-BY 4.0, tekstury zmniejszone do 512 px, bufory meshopt).
 * Wszystkie pliki mają tekstury OSADZONE — działają bez CDN i offline.
 */

const BASE = import.meta.env.BASE_URL;

interface SceneryProp {
  /** Ścieżka względem public/assets/ — jedno źródło prawdy dla obu katalogów. */
  file: string;
  scale: number;
  position: [number, number, number];
  rotation?: number;
  /** Podmienia plakat w gotowym modelu (tablica „Lobby"). */
  poster?: string;
  /** Ładujemy także na słabszych urządzeniach, gdzie bierzemy tylko podzbiór. */
  essential?: boolean;
}

/**
 * Układ parku: alejki i trawniki są w `park.ts`, a KAŻDY widoczny obiekt to
 * gotowy model GLB. Kolejność ma znaczenie: początek listy to elementy, bez
 * których park wyglądałby pusto nawet na słabym urządzeniu.
 */
const LOBBY_PROPS: SceneryProp[] = [
  // Fontanna na środku, wiata, tablica i ławki — dawne „bryły" zastąpione GLB.
  { file: 'props/fountain.glb', scale: 9, position: [0, 0, 0], essential: true },
  { file: 'library/ulica/billboard.glb', scale: 7, position: [-7.8, 0, 0.8], rotation: 1.2, poster: 'Lobby', essential: true },
  { file: 'library/ulica/bus_shelter.glb', scale: 16, position: [6.6, 0, -4.4], rotation: 0.5, essential: true },
  { file: 'props/bench_park.glb', scale: 16, position: [-3.2, 0, 5.8], rotation: -0.5, essential: true },
  { file: 'props/bench_park.glb', scale: 16, position: [3.2, 0, 5.8], rotation: 0.5 },
  { file: 'props/bench_park.glb', scale: 16, position: [-5.4, 0, -3.4], rotation: 1.1 },
  { file: 'props/bench_park.glb', scale: 16, position: [5.4, 0, -3.4], rotation: -1.1 },
  { file: 'props/planter_round.glb', scale: 15, position: [-4.4, 0, 2.4] },
  { file: 'props/planter_round.glb', scale: 15, position: [4.4, 0, -2.4] },
  { file: 'library/przedmioty/DiffuseTransmissionPlant.glb', scale: 1.5, position: [7.5, 0, -2.2] },
  { file: 'library/przedmioty/GlassVaseFlowers.glb', scale: 2.6, position: [-8.9, 0, 2.1] },
  { file: 'library/przedmioty/Lantern.glb', scale: 2.2, position: [-2.7, 0, 2.7] },
  { file: 'library/przedmioty/Lantern.glb', scale: 2.2, position: [2.7, 0, -2.7] },
  { file: 'props/rock_boulder.glb', scale: 16, position: [-7.4, 0, 0.7], rotation: 0.3 },
  { file: 'props/rock_boulder.glb', scale: 14, position: [-8.1, 0, 1.5], rotation: 1.2 },
  { file: 'props/rock_boulder.glb', scale: 12, position: [-6.7, 0, 1.6], rotation: 2.1 },
  { file: 'props/picnic_table.glb', scale: 14, position: [-8.8, 0, 3.9], rotation: 0.4 },
  { file: 'props/picnic_table.glb', scale: 14, position: [8.6, 0, 3.6], rotation: -0.4 },
  // Korony drzew wokół polany.
  { file: 'props/tree_oak.glb', scale: 15, position: [-9.4, 0, -2.6], essential: true },
  { file: 'props/tree_birch.glb', scale: 14, position: [9.6, 0, 1.8], essential: true },
  { file: 'props/tree_round.glb', scale: 13, position: [-6.4, 0, 8.4] },
  { file: 'library/roslinnosc/tree_conifer.glb', scale: 14, position: [7.6, 0, -7.8] },
  { file: 'library/roslinnosc/tree_poplar.glb', scale: 13, position: [-9.8, 0, 6.8] },
  { file: 'library/roslinnosc/tree_small.glb', scale: 15, position: [9.8, 0, 8.0] },
  { file: 'props/tree_bush.glb', scale: 15, position: [4.4, 0, -4.8] },
  { file: 'props/tree_bush.glb', scale: 15, position: [-4.2, 0, -8.6] },
  { file: 'library/roslinnosc/tree_hedge.glb', scale: 15, position: [-8.4, 0, -7.4], rotation: 0.4 },
  { file: 'library/roslinnosc/tree_hedge.glb', scale: 15, position: [8.6, 0, 5.8], rotation: 1.2 },
  // Woda, ławki i donice.
  { file: 'props/fountain.glb', scale: 12, position: [-6.8, 0, -5.6] },
  { file: 'props/bench_modern.glb', scale: 16, position: [-5.6, 0, 3.4], rotation: -0.5 },
  { file: 'props/bench_modern.glb', scale: 16, position: [5.7, 0, 6.0], rotation: 2.7 },
  { file: 'props/planter_round.glb', scale: 16, position: [-4.7, 0, 4.4] },
  { file: 'props/planter_round.glb', scale: 16, position: [4.7, 0, -4.4] },
  // Światła i mała architektura miejska.
  { file: 'props/lamp_double.glb', scale: 11, position: [-10.0, 0, 1.2], rotation: 0.3 },
  { file: 'props/lamp_street.glb', scale: 11, position: [10.0, 0, -6.2], rotation: -0.4 },
  { file: 'props/lamp_classic.glb', scale: 11, position: [3.4, 0, 9.4] },
  { file: 'library/ulica/bike_rack.glb', scale: 16, position: [-2.9, 0, 9.6] },
  { file: 'library/ulica/street_sign.glb', scale: 16, position: [2.9, 0, 9.4], rotation: -0.5 },
  { file: 'library/ulica/parking_meter.glb', scale: 16, position: [9.4, 0, 4.6] },
  { file: 'props/trash_bin.glb', scale: 14, position: [-7.2, 0, 6.4] },
  { file: 'props/bollard.glb', scale: 16, position: [-2.2, 0, 6.7] },
  { file: 'props/bollard.glb', scale: 16, position: [2.2, 0, 6.7] },
];

/** Podwórko Demonofobii pozostaje nocne i ciasne — to osobny świat gry. */
const YARD_PROPS: SceneryProp[] = [
  { file: 'props/lamp_street.glb', scale: 11, position: [-3.3, 0, 11.2], rotation: Math.PI / 2 },
  { file: 'props/tree_birch.glb', scale: 13, position: [-3.5, 0, 16.4] },
  { file: 'props/tree_bush.glb', scale: 16, position: [-2.9, 0, 10.6] },
  { file: 'props/tree_bush.glb', scale: 16, position: [3.3, 0, 16.9] },
  { file: 'props/barrier_concrete.glb', scale: 13, position: [-3.4, 0, 17.4], rotation: Math.PI / 2 },
  { file: 'props/cone.glb', scale: 16, position: [-1.9, 0, 10.1] },
  { file: 'props/cone.glb', scale: 16, position: [1.9, 0, 10.1] },
  { file: 'props/trash_bin_wheelie.glb', scale: 14, position: [3.3, 0, 10.4] },
  { file: 'props/aircon_unit.glb', scale: 13, position: [7.9, 0.9, 8.6], rotation: Math.PI },
  { file: 'props/hydrant.glb', scale: 16, position: [-3.4, 0, 13.4] },
];

/**
 * Jeden odczyt każdego pliku GLB dla całej aplikacji. Ten sam model bywa
 * użyty wielokrotnie (ławki, donice, latarnie, głazy, billboard, postumenty),
 * więc cache oszczędza parsowanie i pamięć — każdy egzemplarz jest klonem.
 * Błąd usuwa wpis, aby po ponownym połączeniu można było spróbować znowu.
 */
const modelCache = new Map<string, Promise<THREE.Group>>();
function sharedModel(file: string): Promise<THREE.Group> {
  let pending = modelCache.get(file);
  if (!pending) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    pending = loader.loadAsync(`${BASE}assets/${file}`).then((gltf) => gltf.scene);
    modelCache.set(file, pending);
    void pending.catch(() => { modelCache.delete(file); });
  }
  return pending;
}

/** `clone(true)` nie odtwarza kości — dla rigowanych modeli używamy SkeletonUtils. */
function cloneModel(source: THREE.Group): THREE.Group {
  let skinned = false;
  source.traverse((object) => {
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
  });
  return (skinned ? cloneSkeleton(source) : source.clone(true)) as THREE.Group;
}

async function mount(scene: THREE.Scene, props: SceneryProp[], name: string): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = name;
  const list = lowPowerDevice() ? props.filter((prop) => prop.essential) : props;
  const roots = await Promise.all(
    list.map(async (prop) => {
      try {
        const root = cloneModel(await sharedModel(prop.file));
        root.scale.setScalar(prop.scale);
        root.position.set(...prop.position);
        root.rotation.y = prop.rotation ?? 0;
        root.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = true;
          object.receiveShadow = true;
          if (prop.poster && /poster/i.test(object.name)) {
            // Gotowy billboard ma własny plakat; podmieniamy tylko jego mapę,
            // żeby konstrukcja (słupy, oświetlenie,rama) została realnym GLB.
            const map = signTexture(prop.poster, 'RejPlay · park dla graczy');
            // UV w glTF mają początek w dole; CanvasTexture domyślnie odwraca
            // obraz (flipY = true). Bez tego napis lądował do góry nogami.
            map.flipY = false;
            object.material = new THREE.MeshStandardMaterial({
              map, roughness: 0.85, side: THREE.FrontSide,
            });
            return;
          }
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

/**
 * Portal gry w parku: gotowy billboard GLB z własnymi słupami, ramą i
 * oświetleniem. Plakat podmieniamy na okładkę gry — w scenie nie ma już
 * czterech prostopadłościanów udających drewnianą bramę.
 */
export function loadPortalFrame(group: THREE.Group, art: string | undefined): void {
  void sharedModel('library/ulica/billboard.glb').then((source) => {
    const root = cloneModel(source);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = 3.1 / (size.y || 1);
    root.scale.setScalar(scale);
    root.position.set(-center.x * scale, 1.55 - center.y * scale, -center.z * scale);
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      if (art && /poster/i.test(object.name)) {
        const texture = new THREE.TextureLoader().load(
          art,
          undefined,
          undefined,
          () => { /* brak okładki: zostaje neutralny plakat z GLB */ },
        );
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
        object.material = new THREE.MeshStandardMaterial({
          map: texture, roughness: 0.88, side: THREE.FrontSide,
        });
      }
    });
    group.add(root);
  }).catch(() => { /* brak pliku nie może zablokować wejścia do gry */ });
}

let lobbyPromise: Promise<THREE.Group> | null = null;
export function loadLobbyScenery(scene: THREE.Scene): Promise<THREE.Group> {
  lobbyPromise ??= mount(scene, LOBBY_PROPS, 'lobby-park-assets');
  return lobbyPromise;
}

let yardPromise: Promise<THREE.Group> | null = null;
export function loadYardScenery(scene: THREE.Scene): Promise<THREE.Group> {
  yardPromise ??= mount(scene, YARD_PROPS, 'yard-scenery-cc0');
  return yardPromise;
}

/* ------------------------------------------------------- galeria assetów 3D
   Trzy prawdziwe modele z nowej biblioteki stoją na postumentach w altanie.
   To podgląd katalogu w silniku gry, nie osobna minigra. Modele Khronos są
   kompresowane EXT_meshopt_compression — stąd dekoder w loaderze. */

interface GalleryPiece {
  file: string;
  position: [number, number, number];
}

/**
 * Postumenty galerii też są gotowym modelem GLB, a nie walcem z kodu.
 * Jeden plik parsujemy raz, a każdy postument jest niezależnym klonem
 * (własna widoczność liści, pozycja i cienie).
 */
function loadPlinth(position: [number, number, number], group: THREE.Group): void {
  void sharedModel('props/planter_round.glb').then((source) => {
    const root = cloneModel(source);
    root.scale.setScalar(13);
    root.position.set(position[0], 0, position[2]);
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      // `planter_round` ma własny krzew: na postumencie eksponatu zostawiamy
      // sam beton, żeby model nie wyglądał jak wyrastający z krzaka.
      if (/foliage/i.test(object.name)) {
        object.visible = false;
        return;
      }
      object.castShadow = true;
      object.receiveShadow = true;
    });
    group.add(root);
  }).catch(() => { /* brakujący postument nie może zatrzymać Lobby */ });
}

const GALLERY: GalleryPiece[] = [
  // Trzy postumenty w altanie — przedmioty i meble z nowej biblioteki.
  { file: 'library/przedmioty/AntiqueCamera.glb', position: [-1.75, 0, -0.9] },
  { file: 'library/przedmioty/BoomBox.glb', position: [1.75, 0, -0.9] },
  { file: 'library/meble/GlamVelvetSofa.glb', position: [0, 0, 2.05] },
];

const gallerySpinners: THREE.Object3D[] = [];

export function loadLobbyGallery(scene: THREE.Scene): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'lobby-asset-gallery';
  for (const piece of GALLERY) loadPlinth(piece.position, group);
  scene.add(group);
  return Promise.all(GALLERY.map(async (piece) => {
    try {
      const root = cloneModel(await sharedModel(piece.file));
      // Normalizacja skali: modele Khronos mają bardzo różne jednostki.
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const max = Math.max(size.x, size.y, size.z) || 1;
      root.scale.setScalar(0.92 / max);
      const center = box.getCenter(new THREE.Vector3()).multiplyScalar(root.scale.x);
      const holder = new THREE.Group();
      holder.position.set(piece.position[0], 1.42, piece.position[2]);
      root.position.set(-center.x, -size.y * root.scale.x / 2, -center.z);
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      holder.add(root);
      group.add(holder);
      gallerySpinners.push(holder);
    } catch {
      // Brakujący model nie może zatrzymać Lobby.
    }
  })).then(() => group);
}

export function updateLobbyGallery(elapsed: number): void {
  for (let i = 0; i < gallerySpinners.length; i++) {
    gallerySpinners[i].rotation.y = elapsed * 0.24 + i * 0.8;
  }
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
