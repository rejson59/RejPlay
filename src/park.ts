import * as THREE from 'three';

/**
 * Podłoże, niebo i oświetlenie parku **Lobby** (v0.8).
 *
 * To jedyny moduł, w którym wolno używać geometrii proceduralnej — ale
 * wyłącznie płaskich, teksturowanych powierzchni terenu oraz kopuły nieba.
 * Wszystkie widoczne obiekty (fontanna, ławki, donice, kwiaty, głazy, wiata,
 * tablica „Lobby", latarnie, drzewa) to gotowe modele GLB ładowane przez
 * `src/real-scenery.ts`. Wcześniej altana była stożkiem na sześciu walcach,
 * klomby — sferami na patykach, oczko wodne — torusem, a zegar słoneczny —
 * zestawem walców; użytkownik słusznie nazwał to „bryłami". Nie wracamy do
 * tego: nowy obiekt w parku = nowy wpis w `LOBBY_PROPS`, nie nowy `Mesh`.
 */

function makeTexture(paint: (ctx: CanvasRenderingContext2D, size: number) => void, repeat: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  paint(ctx, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function grassTexture(): THREE.CanvasTexture {
  return makeTexture((ctx, size) => {
    ctx.fillStyle = '#4f7a3e';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 5200; i += 1) {
      const shade = 55 + Math.floor(Math.random() * 75);
      ctx.fillStyle = `rgba(${shade * 0.62},${shade},${shade * 0.48},${0.25 + Math.random() * 0.5})`;
      const x = Math.random() * size;
      const y = Math.random() * size;
      ctx.fillRect(x, y, 1 + Math.random() * 2, 2 + Math.random() * 4);
    }
  }, 15);
}

function gravelTexture(): THREE.CanvasTexture {
  return makeTexture((ctx, size) => {
    ctx.fillStyle = '#a89a7e';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 4200; i += 1) {
      const v = 120 + Math.floor(Math.random() * 90);
      ctx.fillStyle = `rgba(${v},${v - 8},${v - 24},${0.3 + Math.random() * 0.5})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
  }, 6);
}

function stoneTexture(): THREE.CanvasTexture {
  return makeTexture((ctx, size) => {
    ctx.fillStyle = '#8d8a7c';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 1800; i += 1) {
      const v = 105 + Math.floor(Math.random() * 65);
      ctx.fillStyle = `rgba(${v},${v},${v - 6},${0.2 + Math.random() * 0.45})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 2 + Math.random() * 5, 1 + Math.random() * 3);
    }
  }, 5);
}

function skyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#6ba5cf');
  gradient.addColorStop(0.5, '#a9d2e8');
  gradient.addColorStop(0.82, '#d9e9dd');
  gradient.addColorStop(1, '#eef2e1');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 8, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Płaski, teksturowany dysk terenu. Nigdy nie tworzy „bryły" w kadrze. */
function disc(radius: number, material: THREE.Material, y: number, segments = 72): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, segments), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.receiveShadow = true;
  return mesh;
}

/** Płaski pierścień terenu (np. alejka) zamiast wystającego torusu. */
function flatRing(inner: number, outer: number, material: THREE.Material, y: number, segments = 96): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, segments), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Buduje wyłącznie tło parku. Obiekty dokłada asynchronicznie
 * `loadLobbyScenery()` — dzięki temu start Lobby nie czeka na 30 plików GLB.
 */
export function buildPark(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0xbcdcea);
  scene.fog = new THREE.Fog(0xc6dfd0, 26, 88);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(60, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  sky.name = 'park-sky';
  scene.add(sky);

  // Dzień: ciepłe słońce + chłodne niebo. Bez nocnych punktowych lamp.
  scene.add(new THREE.HemisphereLight(0xdcefff, 0x78915f, 1.65));
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const sun = new THREE.DirectionalLight(0xffefd0, 2.7);
  sun.position.set(-13, 20, 11);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  const grass = new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 });
  const gravel = new THREE.MeshStandardMaterial({ map: gravelTexture(), roughness: 1 });
  const stone = new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.95 });

  // Trawnik rozciąga się poza wyspę, żeby nie było widać krawędzi świata.
  scene.add(disc(46, grass, -0.42, 64));

  // Podłoże wyspy: niski, teksturowany walec (krawędź terenu, nie obiekt).
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(12, 12.35, 0.45, 72), stone);
  soil.position.y = -0.25;
  soil.receiveShadow = true;
  scene.add(soil);
  scene.add(disc(11.95, grass, 0.005));
  // Płaski, kamienny pierścień zamiast dawnego, wystającego torusu.
  scene.add(flatRing(11.72, 11.95, stone, 0.012));

  // Okrągła alejka (3,5–4,6 m) i cztery dojścia od brzegów parku.
  scene.add(flatRing(3.5, 4.6, gravel, 0.018));
  for (let i = 0; i < 4; i += 1) {
    const spoke = new THREE.Group();
    spoke.rotation.y = (i / 4) * Math.PI * 2;
    const path = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 7.4), gravel);
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 0.018, 7.9);
    path.receiveShadow = true;
    spoke.add(path);
    scene.add(spoke);
  }
  // Środkowy trawnik — na nim stoi gotowa fontanna GLB.
  scene.add(disc(3.48, grass, 0.024));
}
