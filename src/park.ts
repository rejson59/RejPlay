import * as THREE from 'three';

/**
 * Sceneria Lobby: jasny, zielony park w świetle dnia.
 *
 * Wszystko jest geometrią proceduralną i teksturami z canvasu — zero
 * zewnętrznych plików, zero pobierania. Gotowe modele GLB (drzewa, ławki,
 * latarnie, fontanna, stojaki, znaki) dokłada `real-scenery.ts`.
 *
 * Układ: okrągła alejka wokół trawnika z altaną, cztery dojścia do bram gier,
 * klomby, oczko wodne i drewniana tablica z nazwą Lobby. Środek układu (0,0,0)
 * jest wspólny z pozycją graczy i Presence, więc nic nie trzeba przeliczać.
 */

const GRASS = '#6d9c58';
const GRAVEL = '#d8cbb1';
const WOOD = 0x8b6440;
const WOOD_DARK = 0x684a30;
const STONE = 0xc9c3b4;

function makeTexture(paint: (ctx: CanvasRenderingContext2D, size: number) => void, repeat: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  paint(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  return texture;
}

function grassTexture(): THREE.CanvasTexture {
  return makeTexture((ctx, s) => {
    ctx.fillStyle = GRASS;
    ctx.fillRect(0, 0, s, s);
    // Dwie warstwy źdźbeł: ciemniejsze tło i jaśniejsze końcówki.
    for (let i = 0; i < 9000; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const light = Math.random() > 0.55;
      ctx.strokeStyle = light ? 'rgba(190,220,140,0.30)' : 'rgba(40,80,38,0.22)';
      ctx.lineWidth = 0.8 + Math.random();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 3, y - 2 - Math.random() * 4);
      ctx.stroke();
    }
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = 'rgba(244,224,140,0.18)';
      ctx.beginPath();
      ctx.arc(Math.random() * s, Math.random() * s, 1 + Math.random() * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 7);
}

function gravelTexture(): THREE.CanvasTexture {
  return makeTexture((ctx, s) => {
    ctx.fillStyle = GRAVEL;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 12000; i++) {
      const v = Math.random();
      ctx.fillStyle = v > 0.6 ? 'rgba(255,255,255,0.22)' : v > 0.3 ? 'rgba(120,105,80,0.20)' : 'rgba(90,80,62,0.12)';
      const r = 0.6 + Math.random() * 1.8;
      ctx.fillRect(Math.random() * s, Math.random() * s, r, r);
    }
  }, 4);
}

function signTexture(title: string, sub: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#6b4d31';
  ctx.fillRect(0, 0, 1024, 320);
  ctx.strokeStyle = 'rgba(255,236,200,0.35)';
  ctx.lineWidth = 8;
  ctx.strokeRect(18, 18, 988, 284);
  ctx.fillStyle = '#f4e6c8';
  ctx.textAlign = 'center';
  ctx.font = '600 128px Georgia, serif';
  ctx.fillText(title, 512, 160);
  ctx.font = '400 40px ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = '#e0cba4';
  ctx.fillText(sub, 512, 240);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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

function disc(radius: number, material: THREE.Material, y: number, segments = 72): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, segments), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.receiveShadow = true;
  return mesh;
}

function mat(color: number, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

/** Altana: sześć drewnianych słupów, dach i podest. */
function buildGazebo(scene: THREE.Scene): void {
  const group = new THREE.Group();
  group.name = 'park-gazebo';

  const floor = new THREE.Mesh(new THREE.CylinderGeometry(2.75, 2.85, 0.16, 6), mat(WOOD, 0.85));
  floor.position.y = 0.1;
  floor.rotation.y = Math.PI / 6;
  floor.castShadow = true;
  floor.receiveShadow = true;
  group.add(floor);

  const postGeo = new THREE.CylinderGeometry(0.11, 0.14, 2.8, 10);
  const postMat = mat(WOOD_DARK, 0.82);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(Math.sin(a) * 2.5, 1.5, Math.cos(a) * 2.5);
    post.castShadow = true;
    group.add(post);
    // Poprzeczka między słupami.
    const next = ((i + 1) / 6) * Math.PI * 2 + Math.PI / 6;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 2.5), postMat);
    beam.position.set((Math.sin(a) + Math.sin(next)) * 1.25, 2.86, (Math.cos(a) + Math.cos(next)) * 1.25);
    beam.rotation.y = a + Math.PI / 6;
    beam.castShadow = true;
    group.add(beam);
  }

  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.25, 1.5, 6), mat(0x5f6b4b, 0.95));
  roof.position.y = 3.55;
  roof.rotation.y = Math.PI / 6;
  roof.castShadow = true;
  group.add(roof);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), mat(0xc9a468, 0.45));
  finial.position.y = 4.38;
  group.add(finial);

  scene.add(group);
}

/** Klomb z kolorowymi kwiatami — lekki, powtarzalny akcent. */
function buildFlowerBed(scene: THREE.Scene, x: number, z: number, seed: number): void {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const soil = disc(0.92, mat(0x59452f, 1), 0.03, 24);
  group.add(soil);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.075, 6, 28), mat(STONE, 0.95));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.05;
  group.add(rim);
  const palette = [0xf3d06a, 0xe58f9b, 0xf2f0dc, 0xa98bd0, 0xf0a35e];
  const petalGeo = new THREE.SphereGeometry(0.11, 7, 6);
  const stemGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.3, 5);
  const stemMat = mat(0x3f6d38, 1);
  for (let i = 0; i < 15; i++) {
    const a = (i / 15) * Math.PI * 2 + seed;
    const r = 0.2 + ((i * 37 + seed * 13) % 10) / 18;
    const px = Math.sin(a) * r;
    const pz = Math.cos(a) * r;
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.set(px, 0.19, pz);
    group.add(stem);
    const petal = new THREE.Mesh(petalGeo, mat(palette[(i + seed) % palette.length], 0.8));
    petal.position.set(px, 0.36, pz);
    petal.scale.setScalar(0.8 + (i % 3) * 0.15);
    group.add(petal);
  }
  scene.add(group);
}

/** Oczko wodne z kamiennym brzegiem i liliami. */
function buildPond(scene: THREE.Scene): void {
  const group = new THREE.Group();
  group.position.set(-7.35, 0, 0.6);
  const water = disc(1.55, new THREE.MeshStandardMaterial({
    color: 0x5b9bb5, roughness: 0.16, metalness: 0.25, transparent: true, opacity: 0.92,
  }), 0.035, 48);
  group.add(water);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.58, 0.16, 8, 48), mat(STONE, 1));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.06;
  rim.castShadow = true;
  group.add(rim);
  const lily = mat(0x4e8546, 0.9);
  for (const [x, z, r] of [[-0.6, 0.3, 0.24], [0.5, -0.4, 0.2], [0.2, 0.75, 0.18]] as const) {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 14), lily);
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = x;
    pad.position.set(x, 0.055, z);
    group.add(pad);
  }
  scene.add(group);
}

/** Drewniana tablica przy wejściu do parku. */
function buildWelcomeSign(scene: THREE.Scene): void {
  const group = new THREE.Group();
  group.position.set(-6.0, 0, 4.6);
  group.rotation.y = 1.05;
  group.scale.setScalar(0.86);
  const postMat = mat(WOOD_DARK, 0.85);
  for (const x of [-1.5, 1.5]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 2.2, 8), postMat);
    post.position.set(x, 1.1, 0);
    post.castShadow = true;
    group.add(post);
  }
  const board = new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.1, 0.12),
    new THREE.MeshStandardMaterial({ map: signTexture('Lobby', 'RejPlay · park dla graczy'), roughness: 0.85 }));
  board.position.set(0, 1.75, 0.01);
  board.castShadow = true;
  group.add(board);
  scene.add(group);
}

/**
 * Buduje cały park. `centerpiece` to mosiężny zegar słoneczny w altanie —
 * jedyny element, który wolno delikatnie obracać w pętli animacji.
 */
export function buildPark(scene: THREE.Scene, centerpiece: THREE.Group): void {
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

  // Trawnik rozciąga się poza wyspę, żeby nie było widać krawędzi świata.
  const meadow = disc(46, new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 }), -0.42, 64);
  scene.add(meadow);

  const soil = new THREE.Mesh(new THREE.CylinderGeometry(12, 12.35, 0.45, 72), mat(0x594a36, 1));
  soil.position.y = -0.25;
  soil.receiveShadow = true;
  scene.add(soil);
  scene.add(disc(11.95, new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 }), 0.005));
  const kerb = new THREE.Mesh(new THREE.TorusGeometry(11.9, 0.16, 8, 96), mat(STONE, 0.95));
  kerb.rotation.x = Math.PI / 2;
  kerb.position.y = 0.03;
  scene.add(kerb);

  // Okrągła alejka (3,5–4,6 m) i cztery dojścia od brzegów parku.
  const gravel = new THREE.MeshStandardMaterial({ map: gravelTexture(), roughness: 1 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.5, 4.6, 72), gravel);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.018;
  ring.receiveShadow = true;
  scene.add(ring);
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Group();
    spoke.rotation.y = (i / 4) * Math.PI * 2;
    const path = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 7.4), gravel);
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 0.018, 7.9);
    path.receiveShadow = true;
    spoke.add(path);
    scene.add(spoke);
  }
  // Środkowy trawnik z altaną.
  scene.add(disc(3.48, new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 }), 0.024));
  buildGazebo(scene);

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    buildFlowerBed(scene, Math.sin(a) * 6.5, Math.cos(a) * 6.5, i);
  }
  buildPond(scene);
  buildWelcomeSign(scene);

  // Zegar słoneczny: jedyny obracany element, zamiast neonowej kuli.
  const stone = mat(0x9b9a8c, 0.95);
  const brass = new THREE.MeshStandardMaterial({ color: 0xb49455, roughness: 0.42, metalness: 0.72 });
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 0.75, 12), stone);
  plinth.position.y = 0.5;
  plinth.castShadow = true;
  centerpiece.add(plinth);
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.07, 24), brass);
  dial.position.y = 0.92;
  dial.castShadow = true;
  centerpiece.add(dial);
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.035, 8, 32), brass);
  ringA.rotation.x = Math.PI / 2.6;
  ringA.position.y = 1.22;
  centerpiece.add(ringA);
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.03, 8, 32), brass);
  ringB.rotation.y = Math.PI / 2;
  ringB.position.y = 1.22;
  centerpiece.add(ringB);
  const needle = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.7, 8), brass);
  needle.rotation.z = -0.5;
  needle.position.y = 1.22;
  centerpiece.add(needle);
  centerpiece.position.set(0, 0, 0);
  scene.add(centerpiece);
}
