import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { QualityProfile } from './performance';

/**
 * Wystrój „Demonofobii”. Wszystkie tekstury powstają w canvas w locie — nie
 * ma tu żadnych generowanych plików graficznych ani assetów z zewnątrz.
 * Geometria mebli używa zaokrąglonych krawędzi, toczenia i wypukłych map,
 * żeby nie wyglądać jak zestaw surowych sześcianów.
 */

function makeCanvas(size = 512): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true })! };
}

/** Mapa wypukłości z jasności kolorowej tekstury (fałdy, słoje, gruz). */
function bumpFrom(source: HTMLCanvasElement, scale: number): { map: THREE.CanvasTexture; scale: number } {
  const { canvas, ctx } = makeCanvas(source.width);
  ctx.drawImage(source, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = luma;
  }
  ctx.putImageData(pixels, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return { map, scale };
}

function asTexture(canvas: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  return map;
}

function woodCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(512);
  ctx.fillStyle = '#463426';
  ctx.fillRect(0, 0, 512, 512);
  for (let board = 0; board < 8; board += 1) {
    const y = board * 64;
    const tone = 54 + Math.floor(Math.random() * 26);
    ctx.fillStyle = `rgb(${tone + 20}, ${tone + 4}, ${tone - 12})`;
    ctx.fillRect(0, y + 2, 512, 60);
    // Słoje: cienkie, lekko falujące linie.
    for (let g = 0; g < 34; g += 1) {
      const gy = y + 4 + Math.random() * 56;
      ctx.strokeStyle = `rgba(${28 + Math.random() * 30}, ${18 + Math.random() * 18}, 10, ${0.06 + Math.random() * 0.14})`;
      ctx.lineWidth = 0.6 + Math.random() * 1.4;
      ctx.beginPath();
      const phase = Math.random() * 6;
      for (let x = 0; x <= 512; x += 16) {
        const yy = gy + Math.sin(x * 0.018 + phase) * 2.2;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    // Sęki.
    if (Math.random() > 0.35) {
      const kx = 40 + Math.random() * 430;
      const ky = y + 12 + Math.random() * 38;
      for (let r = 14; r > 2; r -= 3) {
        ctx.strokeStyle = `rgba(30, 18, 10, ${0.1 + (14 - r) * 0.012})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(kx, ky, r * 1.8, r * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(0, y, 512, 2);
    ctx.fillStyle = 'rgba(255,235,205,0.05)';
    ctx.fillRect(0, y + 2, 512, 1);
  }
  return canvas;
}

function wallpaperCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(512);
  ctx.fillStyle = '#77705f';
  ctx.fillRect(0, 0, 512, 512);
  // Pionowe pasy starej tapety.
  for (let x = 0; x < 512; x += 48) {
    ctx.fillStyle = 'rgba(30, 26, 20, 0.075)';
    ctx.fillRect(x, 0, 3, 512);
    ctx.fillStyle = 'rgba(225, 214, 188, 0.045)';
    ctx.fillRect(x + 5, 0, 14, 512);
  }
  // Zatarty wzór i kurz.
  for (let i = 0; i < 9000; i += 1) {
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.075)';
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 1.5);
  }
  // Zacieki od góry.
  for (let i = 0; i < 14; i += 1) {
    const x = Math.random() * 512;
    const w = 6 + Math.random() * 26;
    const h = 40 + Math.random() * 190;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(28, 25, 20, 0.24)');
    grad.addColorStop(1, 'rgba(28, 25, 20, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, w, h);
  }
  // Odparzenia tapety: jaśniejszy tynk pod spodem.
  for (let i = 0; i < 7; i += 1) {
    const x = 20 + Math.random() * 470;
    const y = 120 + Math.random() * 330;
    ctx.fillStyle = 'rgba(140, 133, 116, 0.55)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let a = 0; a < 9; a += 1) {
      const ang = (a / 9) * Math.PI * 2;
      const r = 7 + Math.random() * 13;
      ctx.lineTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r * 1.1);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,34,28,0.18)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // Pęknięcia.
  ctx.strokeStyle = 'rgba(25,22,18,0.4)';
  for (let i = 0; i < 9; i += 1) {
    ctx.lineWidth = 0.8 + Math.random();
    let x = Math.random() * 512;
    let y = Math.random() * 512;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 6; s += 1) {
      x += (Math.random() - 0.5) * 26;
      y += 10 + Math.random() * 24;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Brud przy podłodze.
  const grime = ctx.createLinearGradient(0, 380, 0, 512);
  grime.addColorStop(0, 'rgba(24, 20, 16, 0)');
  grime.addColorStop(1, 'rgba(24, 20, 16, 0.42)');
  ctx.fillStyle = grime;
  ctx.fillRect(0, 380, 512, 132);
  return canvas;
}

function fabricCanvas(base: string, thread: string): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = thread;
  ctx.lineWidth = 1;
  for (let i = 0; i < 256; i += 4) {
    ctx.globalAlpha = 0.18;
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 4200; i += 1) {
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.09)';
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  return canvas;
}

function tileCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(256);
  ctx.fillStyle = '#4a4a44';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 64) {
    for (let x = 0; x < 256; x += 64) {
      const shade = 150 + Math.floor(Math.random() * 22);
      ctx.fillStyle = `rgb(${shade}, ${shade - 3}, ${shade - 12})`;
      ctx.fillRect(x + 3, y + 3, 58, 58);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x + 3, y + 3, 58, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(x + 3, y + 56, 58, 5);
    }
  }
  return canvas;
}

function rugCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(256);
  ctx.fillStyle = '#5a3b33';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#8c6a4c';
  ctx.lineWidth = 8;
  ctx.strokeRect(14, 14, 228, 228);
  ctx.lineWidth = 3;
  ctx.strokeRect(28, 28, 200, 200);
  ctx.strokeStyle = 'rgba(196, 158, 108, 0.55)';
  for (let i = 0; i < 6; i += 1) {
    for (let j = 0; j < 6; j += 1) {
      const x = 40 + i * 36;
      const y = 40 + j * 36;
      ctx.beginPath();
      ctx.moveTo(x, y - 11); ctx.lineTo(x + 11, y); ctx.lineTo(x, y + 11); ctx.lineTo(x - 11, y);
      ctx.closePath(); ctx.stroke();
    }
  }
  for (let i = 0; i < 6000; i += 1) {
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.1)';
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  return canvas;
}

interface DecorMaterials {
  wood: THREE.MeshStandardMaterial;
  darkWood: THREE.MeshStandardMaterial;
  painted: THREE.MeshStandardMaterial;
  fabric: THREE.MeshStandardMaterial;
  cloth: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  ceramic: THREE.MeshStandardMaterial;
  paper: THREE.MeshStandardMaterial;
  wallbase: THREE.CanvasTexture;
  wallBump: THREE.CanvasTexture;
  rug: THREE.CanvasTexture;
  tile: THREE.CanvasTexture;
  plaster: THREE.MeshStandardMaterial;
}

function makeMaterials(): DecorMaterials {
  const woodCanvasEl = woodCanvas();
  const woodBump = bumpFrom(woodCanvasEl, 0.014);
  const woodMap = asTexture(woodCanvasEl);
  woodMap.repeat.set(3, 3);
  const wallCanvasEl = wallpaperCanvas();
  const wallBump = bumpFrom(wallCanvasEl, 0.02);
  const fabricEl = fabricCanvas('#4e4a42', '#c9bda6');
  const fabricBump = bumpFrom(fabricEl, 0.01);
  const clothEl = fabricCanvas('#6b6358', '#d8cbb4');

  return {
    wood: new THREE.MeshStandardMaterial({
      map: woodMap, bumpMap: woodBump.map, bumpScale: woodBump.scale,
      color: 0xc4ad92, roughness: 0.68, metalness: 0.02,
    }),
    darkWood: new THREE.MeshStandardMaterial({
      map: woodMap, bumpMap: woodBump.map, bumpScale: woodBump.scale,
      color: 0x6d5844, roughness: 0.74,
    }),
    painted: new THREE.MeshStandardMaterial({ color: 0x8a887c, roughness: 0.78 }),
    fabric: new THREE.MeshStandardMaterial({
      map: asTexture(fabricEl), bumpMap: fabricBump.map, bumpScale: fabricBump.scale,
      color: 0xc8c0b2, roughness: 0.98,
    }),
    cloth: new THREE.MeshStandardMaterial({
      map: asTexture(clothEl), bumpMap: fabricBump.map, bumpScale: fabricBump.scale,
      color: 0xb6aa98, roughness: 1,
    }),
    metal: new THREE.MeshStandardMaterial({ color: 0x7d8285, roughness: 0.34, metalness: 0.78 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb08d52, roughness: 0.32, metalness: 0.85 }),
    // Zwykłe półprzezroczyste szkło: `transmission` wymuszałoby dodatkowy
    // pełny przebieg renderu sceny (bardzo drogie na słabszych GPU).
    glass: new THREE.MeshStandardMaterial({
      color: 0x7d9eac, roughness: 0.18, metalness: 0.08, transparent: true,
      opacity: 0.34, side: THREE.DoubleSide, depthWrite: false,
    }),
    ceramic: new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.28 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xc9bfa8, roughness: 0.95, side: THREE.DoubleSide }),
    wallbase: asTexture(wallCanvasEl),
    wallBump: wallBump.map,
    rug: asTexture(rugCanvas()),
    tile: asTexture(tileCanvas()),
    plaster: new THREE.MeshStandardMaterial({ color: 0x8c8574, roughness: 0.98 }),
  };
}

class Builder {
  private readonly group = new THREE.Group();
  private readonly materials: DecorMaterials;
  readonly lights: THREE.PointLight[] = [];

  constructor(private readonly scene: THREE.Scene, materials: DecorMaterials) {
    this.materials = materials;
    this.scene.add(this.group);
  }

  private add(mesh: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Object3D {
    mesh.position.set(x, y, z);
    mesh.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    this.group.add(mesh);
    return mesh;
  }

  rounded(w: number, h: number, d: number, radius: number, mat: THREE.Material): THREE.Mesh {
    return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 2.1, h / 2.1, d / 2.1)), mat);
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, r = 0.01): void {
    const mesh = this.rounded(w, h, d, r, mat);
    this.add(mesh, x, y, z);
  }

  lathe(profile: Array<[number, number]>, mat: THREE.Material, segments = 20): THREE.Mesh {
    const points = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y));
    return new THREE.Mesh(new THREE.LatheGeometry(points, segments), mat);
  }

  cylinder(rt: number, rb: number, h: number, mat: THREE.Material, segments = 12): THREE.Mesh {
    return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segments), mat);
  }

  private wallMaterial(length: number): THREE.MeshStandardMaterial {
    const map = this.materials.wallbase.clone();
    map.repeat.set(Math.max(1, length / 2.6), 1);
    map.needsUpdate = true;
    const bump = this.materials.wallBump.clone();
    bump.repeat.copy(map.repeat);
    bump.needsUpdate = true;
    return new THREE.MeshStandardMaterial({
      map, bumpMap: bump, bumpScale: 0.022, color: 0xb0a998, roughness: 0.97,
    });
  }

  buildWalls(segments: Array<[number, number, number, number]>): void {
    const m = this.materials;
    const floorMap = (m.wood.map as THREE.CanvasTexture).clone();
    floorMap.repeat.set(7, 7);
    floorMap.needsUpdate = true;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18),
      new THREE.MeshStandardMaterial({
        map: floorMap, bumpMap: m.wood.bumpMap, bumpScale: 0.012,
        color: 0xa79c8c, roughness: 0.88,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18),
      new THREE.MeshStandardMaterial({ color: 0x302c27, roughness: 1, side: THREE.DoubleSide }),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 3.2;
    ceiling.receiveShadow = true;
    this.group.add(ceiling);

    // Belki stropowe.
    for (let z = -8; z <= 8; z += 2.6) {
      this.box(18, 0.12, 0.16, 0, 3.12, z, m.darkWood, 0.02);
    }

    for (const [x1, z1, x2, z2] of segments) {
      const length = Math.hypot(x2 - x1, z2 - z1);
      const angle = -Math.atan2(z2 - z1, x2 - x1);
      const cx = (x1 + x2) / 2;
      const cz = (z1 + z2) / 2;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(length, 3.2, 0.16), this.wallMaterial(length));
      wall.position.set(cx, 1.6, cz);
      wall.rotation.y = angle;
      wall.receiveShadow = true;
      wall.castShadow = true;
      this.group.add(wall);

      // Listwa przypodłogowa, gzyms i szyna na obrazy.
      for (const [h, hh, mat] of [
        [0.11, 0.16, m.darkWood],
        [3.06, 0.1, m.painted],
        [2.35, 0.045, m.darkWood],
      ] as Array<[number, number, THREE.Material]>) {
        const trim = this.rounded(length, hh, 0.2, 0.012, mat);
        trim.position.set(cx, h, cz);
        trim.rotation.y = angle;
        trim.receiveShadow = true;
        this.group.add(trim);
      }
    }
  }

  private windowFrame(x: number, y: number, z: number, rotY: number): void {
    const m = this.materials;
    const frame = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 1.08), m.glass);
    glass.position.z = 0.005;
    frame.add(glass);
    for (const [w, h, px, py] of [
      [1.34, 0.09, 0, 0.59], [1.34, 0.09, 0, -0.59],
      [0.09, 1.18, -0.63, 0], [0.09, 1.18, 0.63, 0],
      [0.05, 1.08, 0, 0], [1.18, 0.05, 0, 0],
    ] as Array<[number, number, number, number]>) {
      const bar = this.rounded(w, h, 0.1, 0.012, m.darkWood);
      bar.position.set(px, py, 0.02);
      frame.add(bar);
    }
    // Firanka z marszczeniem.
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 1.16, 6, 1), m.cloth);
    const pos = curtain.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      pos.setZ(i, Math.sin(pos.getX(i) * 22) * 0.035);
    }
    curtain.geometry.computeVertexNormals();
    curtain.position.set(0.44, 0, 0.06);
    frame.add(curtain);
    frame.position.set(x, y, z);
    frame.rotation.y = rotY;
    this.group.add(frame);

    const light = new THREE.PointLight(0x82a2bb, 4.2, 8, 2);
    light.position.set(x + (x < 0 ? 0.7 : -0.7), y, z + (z < 0 ? 0.7 : -0.3));
    this.scene.add(light);
  }

  buildWindows(): void {
    this.windowFrame(-8.88, 1.85, -4.5, Math.PI / 2);
    this.windowFrame(8.88, 1.85, 4.5, -Math.PI / 2);
    this.windowFrame(-4.5, 1.85, -8.88, 0);
  }

  buildDoor(): void {
    const m = this.materials;
    const frame = new THREE.Group();
    for (const [w, h, x, y] of [
      [0.16, 2.5, -1.3, 1.25], [0.16, 2.5, 1.3, 1.25], [2.76, 0.18, 0, 2.5],
    ] as Array<[number, number, number, number]>) {
      const part = this.rounded(w, h, 0.24, 0.02, m.darkWood);
      part.position.set(x, y, 0);
      frame.add(part);
    }
    frame.position.set(0, 0, 8.94);
    this.group.add(frame);

    // Uchylone skrzydło — wyjście musi pozostać przejezdne.
    const leaf = new THREE.Group();
    const panel = this.rounded(1.15, 2.32, 0.075, 0.02, m.darkWood);
    leaf.add(panel);
    for (const py of [0.62, -0.55]) {
      const inset = this.rounded(0.86, 0.82, 0.02, 0.03, m.painted);
      inset.position.set(0, py, 0.05);
      leaf.add(inset);
    }
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), m.brass);
    knob.position.set(0.44, 0, 0.09);
    leaf.add(knob);
    // v0.9: skrzydło stało dotąd w samej osi wejścia (x = −0.62) i wyglądało
    // jak deska zagradzająca przejście — gracz był pewien, że nie może ruszyć.
    // Otwieramy je do końca, płasko przy lewej ścianie, POZA światłem drzwi.
    leaf.position.set(-1.92, 1.18, 8.55);
    leaf.rotation.y = -1.45;
    leaf.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.add(leaf);
  }

  private turnedLeg(mat: THREE.Material): THREE.Mesh {
    return this.lathe([
      [0.055, 0], [0.05, 0.04], [0.032, 0.12], [0.042, 0.2],
      [0.028, 0.34], [0.038, 0.48], [0.052, 0.62], [0.058, 0.72],
    ], mat, 14);
  }

  private chair(x: number, z: number, rotY: number): void {
    const m = this.materials;
    const g = new THREE.Group();
    const seat = this.rounded(0.52, 0.075, 0.5, 0.035, m.wood);
    seat.position.y = 0.47;
    g.add(seat);
    const cushion = this.rounded(0.46, 0.055, 0.44, 0.025, m.fabric);
    cushion.position.y = 0.53;
    g.add(cushion);
    for (const dx of [-0.21, 0.21]) {
      for (const dz of [-0.2, 0.2]) {
        const leg = this.cylinder(0.024, 0.032, 0.46, m.darkWood, 10);
        leg.position.set(dx, 0.23, dz);
        g.add(leg);
      }
    }
    for (const dx of [-0.21, 0.21]) {
      const post = this.cylinder(0.026, 0.03, 0.58, m.darkWood, 10);
      post.position.set(dx, 0.76, 0.22);
      g.add(post);
    }
    for (let i = 0; i < 3; i += 1) {
      const slat = this.rounded(0.46, 0.075, 0.035, 0.012, m.wood);
      slat.position.set(0, 0.72 + i * 0.16, 0.22);
      g.add(slat);
    }
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.add(g);
  }

  private readonly bookMaterials = [
    0x6b3b34, 0x3f5147, 0x655a44, 0x384251, 0x775c3c, 0x4b4048,
  ].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.88 }));

  private books(shelfX: number, shelfY: number, shelfZ: number): void {
    let x = shelfX - 0.82;
    while (x < shelfX + 0.75) {
      const w = 0.035 + Math.random() * 0.05;
      const h = 0.24 + Math.random() * 0.14;
      const mat = this.bookMaterials[Math.floor(Math.random() * this.bookMaterials.length)];
      const book = this.rounded(w, h, 0.19, 0.006, mat);
      book.position.set(x + w / 2, shelfY + h / 2, shelfZ);
      book.rotation.z = (Math.random() - 0.5) * 0.09;
      this.group.add(book);
      book.castShadow = true;
      x += w + 0.008;
    }
  }

  private picture(x: number, y: number, z: number, rotY: number, w: number, h: number): void {
    const m = this.materials;
    const g = new THREE.Group();
    const frame = this.rounded(w + 0.1, h + 0.1, 0.06, 0.015, m.darkWood);
    g.add(frame);
    const canvasEl = makeCanvas(128).canvas;
    const ctx = canvasEl.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, '#4b4b45');
    grad.addColorStop(1, '#22262a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = 'rgba(170, 155, 122, 0.45)';
    ctx.beginPath(); ctx.ellipse(64, 74, 30, 22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(20, 24, 26, 0.6)';
    ctx.beginPath(); ctx.ellipse(64, 82, 9, 15, 0, 0, Math.PI * 2); ctx.fill();
    const art = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: asTexture(canvasEl), roughness: 0.9 }),
    );
    art.position.z = 0.035;
    g.add(art);
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    this.group.add(g);
  }

  private floorLamp(x: number, z: number): void {
    const m = this.materials;
    const g = new THREE.Group();
    const base = this.lathe([[0.16, 0], [0.14, 0.04], [0.06, 0.08], [0.03, 0.12]], m.brass, 16);
    g.add(base);
    const pole = this.cylinder(0.016, 0.02, 1.35, m.brass, 12);
    pole.position.y = 0.77;
    g.add(pole);
    const shade = this.lathe([[0.12, 0], [0.22, 0.28], [0.19, 0.3]], m.cloth, 20);
    shade.position.y = 1.32;
    g.add(shade);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xffd6a0, emissive: 0xffae5c, emissiveIntensity: 1.4 }),
    );
    bulb.position.y = 1.44;
    g.add(bulb);
    g.position.set(x, 0, z);
    g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    this.group.add(g);
    const light = new THREE.PointLight(0xffbb78, 7, 6.5, 2);
    light.position.set(x, 1.48, z);
    this.scene.add(light);
    this.lights.push(light);
  }

  buildLivingRoom(): void {
    const m = this.materials;
    // Dywan z wzorem.
    const rugMap = m.rug.clone();
    rugMap.repeat.set(1, 1);
    rugMap.needsUpdate = true;
    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 2.4),
      new THREE.MeshStandardMaterial({ map: rugMap, roughness: 1, side: THREE.DoubleSide }),
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-5.1, 0.012, -5.1);
    rug.receiveShadow = true;
    this.group.add(rug);

    // Stół z toczonymi nogami.
    const top = this.rounded(2.0, 0.09, 1.12, 0.035, m.wood);
    this.add(top, -5.0, 0.78, -5.4);
    for (const dx of [-0.82, 0.82]) {
      for (const dz of [-0.42, 0.42]) {
        const leg = this.turnedLeg(m.darkWood);
        this.add(leg, -5.0 + dx, 0, -5.4 + dz);
      }
    }
    this.chair(-5.0, -4.35, 0);
    this.chair(-5.0, -6.45, Math.PI);
    this.chair(-6.35, -5.4, -Math.PI / 2);

    // Regał z książkami.
    this.box(1.9, 2.15, 0.34, -8.45, 1.08, -6.6, m.darkWood, 0.02);
    for (let i = 0; i < 4; i += 1) {
      this.box(1.74, 0.055, 0.3, -8.45, 0.36 + i * 0.5, -6.38, m.wood, 0.01);
      this.books(-8.45, 0.39 + i * 0.5, -6.3);
    }
    const vase = this.lathe([[0.09, 0], [0.12, 0.06], [0.07, 0.18], [0.085, 0.24], [0.08, 0.26]], m.ceramic, 18);
    this.add(vase, -5.0, 0.83, -5.4);
    for (let i = 0; i < 3; i += 1) {
      const stem = this.cylinder(0.004, 0.004, 0.24, m.painted, 6);
      this.add(stem, -5.0 + (i - 1) * 0.02, 1.2, -5.4);
    }

    // Fotel z poduszkami i podłokietnikami.
    this.box(0.9, 0.28, 0.9, -6.1, 0.32, -3.3, m.darkWood, 0.05);
    this.box(0.84, 0.16, 0.82, -6.1, 0.53, -3.3, m.fabric, 0.07);
    this.box(0.9, 0.75, 0.18, -6.1, 0.78, -3.72, m.fabric, 0.07);
    for (const dx of [-0.42, 0.42]) this.box(0.14, 0.34, 0.86, -6.1 + dx, 0.62, -3.3, m.fabric, 0.06);

    this.floorLamp(-8.0, -3.0);
    this.picture(-8.88, 1.85, -5.2, Math.PI / 2, 0.7, 0.9);
    this.picture(-4.0, 1.9, -8.88, 0, 0.85, 0.65);
  }

  buildBedroom(): void {
    const m = this.materials;
    this.box(2.2, 0.32, 1.6, 5.4, 0.3, -6.2, m.darkWood, 0.035);
    this.box(2.1, 0.2, 1.5, 5.4, 0.56, -6.2, m.ceramic, 0.06);
    // Zagłowie z listew.
    this.box(2.24, 1.05, 0.12, 5.4, 0.75, -7.02, m.wood, 0.03);
    for (let i = -2; i <= 2; i += 1) {
      this.box(0.06, 0.8, 0.05, 5.4 + i * 0.4, 0.78, -6.94, m.darkWood, 0.02);
    }
    // Kołdra z fałdami i poduszki.
    const duvet = this.rounded(2.05, 0.12, 1.05, 0.06, m.cloth);
    this.add(duvet, 5.4, 0.72, -5.85);
    for (let i = 0; i < 3; i += 1) {
      const fold = this.rounded(1.9, 0.018, 0.035, 0.008, m.fabric);
      this.add(fold, 5.4, 0.785, -6.15 + i * 0.28);
    }
    for (const dx of [-0.55, 0.55]) {
      const pillow = this.rounded(0.8, 0.14, 0.42, 0.07, m.ceramic);
      this.add(pillow, 5.4 + dx, 0.72, -6.72);
    }
    // Szafka z szufladą i lampką.
    this.box(0.66, 0.62, 0.52, 7.7, 0.34, -7.3, m.wood, 0.02);
    this.box(0.6, 0.2, 0.02, 7.7, 0.45, -7.03, m.painted, 0.008);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), m.brass);
    this.add(knob, 7.7, 0.45, -7.0);
    const lampBase = this.lathe([[0.09, 0], [0.05, 0.05], [0.03, 0.16]], m.brass, 14);
    this.add(lampBase, 7.7, 0.66, -7.3);
    const shade = this.lathe([[0.1, 0], [0.16, 0.16]], m.cloth, 16);
    this.add(shade, 7.7, 0.82, -7.3);
    const light = new THREE.PointLight(0xffc489, 3.4, 4, 2);
    light.position.set(7.7, 0.95, -7.3);
    this.scene.add(light);
    this.lights.push(light);
    this.picture(8.88, 1.9, -5.0, -Math.PI / 2, 0.7, 0.9);
  }

  buildKitchen(): void {
    const m = this.materials;
    // Szafki z frontami i blat.
    this.box(3.4, 0.86, 0.62, -5.6, 0.44, 8.3, m.painted, 0.02);
    for (let i = 0; i < 4; i += 1) {
      this.box(0.78, 0.66, 0.02, -6.87 + i * 0.85, 0.44, 7.98, m.darkWood, 0.015);
      const handle = this.cylinder(0.012, 0.012, 0.16, m.brass, 8);
      handle.rotation.z = Math.PI / 2;
      this.add(handle, -6.87 + i * 0.85, 0.62, 7.95);
    }
    const counter = this.rounded(3.5, 0.07, 0.7, 0.012, m.metal);
    this.add(counter, -5.6, 0.91, 8.3);
    // Glazura.
    const tileMap = m.tile.clone();
    tileMap.repeat.set(5, 1.4);
    tileMap.needsUpdate = true;
    const backsplash = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.62),
      new THREE.MeshStandardMaterial({ map: tileMap, roughness: 0.35, metalness: 0.05 }),
    );
    backsplash.position.set(-5.6, 1.28, 8.94);
    backsplash.rotation.y = Math.PI;
    this.group.add(backsplash);
    // Zlew i kran.
    const sink = this.rounded(0.62, 0.02, 0.42, 0.02, m.metal);
    this.add(sink, -6.1, 0.95, 8.3);
    for (let i = 0; i < 3; i += 1) {
      const pipe = this.cylinder(0.012, 0.012, 0.22 - i * 0.05, m.brass, 10);
      if (i === 2) pipe.rotation.z = Math.PI / 2;
      this.add(pipe, -6.1 + (i === 2 ? 0.08 : 0), 1.06 + i * 0.11, 8.52);
    }
    // Czajnik, butelki, miska.
    const kettle = this.lathe([[0.11, 0], [0.14, 0.08], [0.12, 0.19], [0.05, 0.24]], m.metal, 18);
    this.add(kettle, -4.5, 0.95, 8.3);
    for (let i = 0; i < 3; i += 1) {
      const bottle = this.lathe([[0.045, 0], [0.05, 0.05], [0.045, 0.2], [0.018, 0.25], [0.018, 0.29]], m.glass, 14);
      this.add(bottle, -3.5 + i * 0.18, 0.95, 8.55);
    }
    const bowl = this.lathe([[0.1, 0], [0.16, 0.06], [0.17, 0.09]], m.ceramic, 16);
    this.add(bowl, -5.0, 0.95, 8.05);
    // Skrzynie z listewek.
    for (let i = 0; i < 2; i += 1) {
      const y = 0.4 + i * 0.68;
      this.box(0.78, 0.64, 0.74, -2.7, y, 6.9, m.wood, 0.015);
      for (let s = 0; s < 3; s += 1) {
        this.box(0.8, 0.05, 0.02, -2.7, y - 0.22 + s * 0.2, 6.52, m.darkWood, 0.008);
      }
    }
    this.picture(-8.88, 1.9, 5.2, Math.PI / 2, 0.62, 0.8);
  }

  buildHall(): void {
    const m = this.materials;
    // Wieszak z hakami i płaszczem.
    const pole = this.cylinder(0.045, 0.06, 1.9, m.darkWood, 12);
    this.add(pole, 7.7, 0.95, 6.9);
    const foot = this.lathe([[0.24, 0], [0.1, 0.06]], m.darkWood, 14);
    this.add(foot, 7.7, 0, 6.9);
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2;
      const hook = this.cylinder(0.012, 0.012, 0.16, m.brass, 8);
      hook.rotation.z = Math.PI / 2;
      this.add(hook, 7.7 + Math.cos(a) * 0.1, 1.85, 6.9 + Math.sin(a) * 0.1);
    }
    const coat = this.rounded(0.42, 0.9, 0.16, 0.07, m.fabric);
    this.add(coat, 7.45, 1.35, 6.9);
    // Konsole, lustro, zegar.
    this.box(1.35, 0.07, 0.36, 4.6, 0.8, 8.7, m.wood, 0.02);
    for (const dx of [-0.58, 0.58]) this.box(0.07, 0.78, 0.3, 4.6 + dx, 0.4, 8.7, m.darkWood, 0.015);
    const mirror = new THREE.Group();
    const mirrorFrame = this.rounded(0.78, 1.05, 0.06, 0.03, m.brass);
    mirror.add(mirrorFrame);
    const mirrorGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.68, 0.94),
      new THREE.MeshStandardMaterial({ color: 0x303a3d, roughness: 0.08, metalness: 0.85 }),
    );
    mirrorGlass.position.z = 0.035;
    mirror.add(mirrorGlass);
    mirror.position.set(4.6, 1.75, 8.9);
    mirror.rotation.y = Math.PI;
    this.group.add(mirror);
    // Zegar ścienny.
    const clock = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 24), m.darkWood);
    clock.rotation.x = Math.PI / 2;
    clock.position.set(8.86, 2.2, 2.6);
    this.group.add(clock);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.21, 24), m.ceramic);
    face.position.set(8.82, 2.2, 2.6);
    face.rotation.y = -Math.PI / 2;
    this.group.add(face);
    for (const [len, angle] of [[0.13, 0.6], [0.17, 2.4]] as Array<[number, number]>) {
      const hand = this.rounded(len, 0.012, 0.01, 0.004, m.metal);
      hand.position.set(8.8, 2.2 + Math.cos(angle) * len / 2, 2.6 + Math.sin(angle) * len / 2);
      hand.rotation.x = -angle;
      this.group.add(hand);
    }
    // Dywanik i para butów.
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3), new THREE.MeshStandardMaterial({ map: m.rug, roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(4.6, 0.012, 5.4);
    this.group.add(rug);
    for (const dx of [-0.12, 0.12]) {
      this.box(0.14, 0.11, 0.29, 7.1 + dx, 0.06, 7.75, m.darkWood, 0.05);
    }
    // Lampa sufitowa.
    const shade = this.lathe([[0.22, 0], [0.3, 0.18], [0.12, 0.28]], m.painted, 20);
    shade.position.set(0, 2.9, 0);
    this.group.add(shade);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffb96b, emissiveIntensity: 0.9 }),
    );
    bulb.position.set(0, 2.82, 0);
    this.group.add(bulb);
    const light = new THREE.PointLight(0xffc98c, 2.6, 7, 2);
    light.position.set(0, 2.78, 0);
    this.scene.add(light);
    this.lights.push(light);
  }

  /** Łączymy statyczne meble wg materiału: ~300 draw calli → kilkanaście. */
  finalize(): void {
    this.group.updateMatrixWorld(true);
    const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const meshes: THREE.Mesh[] = [];
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
      // RoundedBoxGeometry jest nieindeksowany, a np. LatheGeometry indeksowany
      // — ujednolicamy do wersji nieindeksowanej, żeby merge nie odrzucił grupy.
      const geometry = object.geometry.index
        ? object.geometry.toNonIndexed()
        : object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      const list = byMaterial.get(object.material) ?? [];
      list.push(geometry);
      byMaterial.set(object.material, list);
      meshes.push(object);
    });
    for (const mesh of meshes) mesh.parent?.remove(mesh);
    for (const [material, geometries] of byMaterial) {
      const merged = mergeGeometries(geometries, false);
      if (merged) {
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);
      } else {
        // Awaryjnie zachowujemy osobne obiekty, jeśli atrybuty się różnią.
        for (const geometry of geometries) {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.group.add(mesh);
          continue;
        }
      }
      if (merged) geometries.forEach((geometry) => geometry.dispose());
    }
  }

  buildDust(): THREE.Points {
    const count = 180;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 17;
      positions[i * 3 + 1] = Math.random() * 3;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 17;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const dust = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xd8cfb8, size: 0.018, transparent: true, opacity: 0.32,
        depthWrite: false, sizeAttenuation: true,
      }),
    );
    this.group.add(dust);
    return dust;
  }
}

export interface Decor {
  update(dt: number, elapsed: number, flicker: number): void;
  setQuality(profile: QualityProfile): void;
}

/** Buduje całą scenę i zwraca lekką animację kurzu / świateł. */
export function buildDecor(
  scene: THREE.Scene,
  wallSegments: Array<[number, number, number, number]>,
): Decor {
  const materials = makeMaterials();
  const builder = new Builder(scene, materials);
  builder.buildWalls(wallSegments);
  builder.buildWindows();
  builder.buildDoor();
  builder.buildLivingRoom();
  builder.buildBedroom();
  builder.buildKitchen();
  builder.buildHall();
  builder.finalize();
  const dust = builder.buildDust();
  const lights = builder.lights;
  const position = dust.geometry.attributes.position as THREE.BufferAttribute;
  // Kurz aktualizujemy maks. 30 razy na sekundę zamiast przy każdej klatce —
  // oszczędza CPU i przegryzanie bufora na telefonach z ekranem 120 Hz.
  let dustTimer = 0;
  let lastFlicker = 0;
  const lightBase = lights.map((_, i) => (i === 0 ? 7 : 3.4));

  return {
    update(dt: number, elapsed: number, flicker: number): void {
      if (dust.visible) {
        dustTimer += dt;
        if (dustTimer >= 1 / 30) {
          const step = dustTimer;
          dustTimer = 0;
          for (let i = 0; i < position.count; i += 1) {
            let y = position.getY(i) + step * (0.05 + (i % 5) * 0.008);
            if (y > 3.05) y = 0.05;
            position.setY(i, y);
            position.setX(i, position.getX(i) + Math.sin(elapsed * 0.3 + i) * step * 0.006);
          }
          position.needsUpdate = true;
        }
      }
      // Intensywność świateł ruszamy tylko wtedy, gdy naprawdę migoczą —
      // inaczej co klatkę wysyłalibyśmy niezmienione wartości do GPU.
      if (flicker > 0) {
        for (let i = 0; i < lights.length; i += 1) {
          lights[i].intensity = lightBase[i] * (Math.random() > 0.5 ? 0.45 : 1);
        }
      } else if (lastFlicker > 0) {
        for (let i = 0; i < lights.length; i += 1) lights[i].intensity = lightBase[i];
      }
      lastFlicker = flicker;
    },
    setQuality(profile: QualityProfile): void {
      dust.visible = profile.dust;
      if (!profile.dust) dustTimer = 0;
    },
  };
}
