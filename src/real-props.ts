import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Gotowe, fotorealistyczne rekwizyty CC0 (Poly Haven) dołożone do domu.
 *
 * Źródło: https://polyhaven.com , licencja CC0 1.0 (public domain).
 * Kopie w `public/assets/props/` pochodzą z repozytorium GridFall
 * (KunalSiyag/gridfall, models/real/props), które w modelach osadza tekstury
 * 1K. Nota licencyjna: public/assets/LICENSE-polyhaven-cc0.txt
 *
 * Modele są w skali „miejskiej” (1 jednostka ≈ 20 m), stąd mnożnik ~15–18.
 * Ładują się asynchronicznie i nie blokują startu rozgrywki.
 */

const BASE = import.meta.env.BASE_URL;

interface Prop {
  file: string;
  scale: number;
  position: [number, number, number];
  rotation?: number;
}

const PROPS: Prop[] = [
  // Wnętrze: ławka w salonie, donica z paprocią, stół w jadalni, kosz.
  { file: 'bench_park', scale: 17, position: [-3.3, 0, -8.15], rotation: Math.PI },
  { file: 'planter_box', scale: 16, position: [-8.0, 0, -1.6] },
  { file: 'tree_fern', scale: 3.6, position: [-8.0, 0.62, -1.6] },
  { file: 'picnic_table', scale: 16, position: [6.1, 0, 2.1], rotation: Math.PI / 2 },
  { file: 'trash_bin', scale: 13, position: [8.15, 0, 1.0] },
  // Podwórko przed frontowymi drzwiami (widoczne w świetle latarki).
  { file: 'mailbox', scale: 12, position: [2.25, 0, 10.15], rotation: -Math.PI / 2 },
  { file: 'lamp_classic', scale: 12, position: [-3.4, 0, 10.6] },
  { file: 'rock_boulder', scale: 10, position: [5.4, 0, 10.5] },
];

export async function loadRealProps(scene: THREE.Scene): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const group = new THREE.Group();
  group.name = 'real-props-cc0';
  // Równolegle: 8 małych plików nie może układać się w 8 następujących po
  // sobie round-tripów. Kolejność w grupie jest stała dzięki Promise.all.
  const roots = await Promise.all(PROPS.map(async (prop) => {
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
          material.roughness = Math.min(1, Math.max(0.55, material.roughness));
          material.envMapIntensity = 0.7;
          material.needsUpdate = true;
        }
      });
      return root;
    } catch {
      // Pojedynczy brakujący plik nie może zatrzymać całej gry.
      return null;
    }
  }));
  for (const root of roots) if (root) group.add(root);
  scene.add(group);
  return group;
}
