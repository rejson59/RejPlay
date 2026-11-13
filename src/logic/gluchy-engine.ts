/**
 * „Głuchy Świat" — geometria i fizyka dźwięku. Czysty moduł, bez canvasu.
 *
 * Ekran jest czarny. Każdy punkt, który gracz zobaczy, musi najpierw
 * „wrócić" jako echo: opóźnienie rośnie z odległością, a barwa i czas wygasania
 * zależą od materiału. Dźwięk, który daje widzenie, jest jednocześnie sygnałem
 * dla Słuchaczy — nie da się zobaczyć bez zdradzenia pozycji.
 */
import { Rng, clamp } from '../core/random';

export const EMPTY = 0;
export const CONCRETE = 1;
export const METAL = 2;
export const WATER = 3;
export const GLASS = 4;
export const CARPET = 5;
export const EXIT = 6;

export interface EchoMaterial {
  id: number;
  name: string;
  /** Jak długo widać punkt po odbiorze echa (sekundy). */
  decay: number;
  /** Jasność odbicia. */
  gain: number;
  /** Głośność kroków na tym podłożu. */
  stepNoise: number;
  sfx: string;
  color: string;
}

export const MATERIALS: Record<number, EchoMaterial> = {
  1: { id: 1, name: 'beton', decay: 1.9, gain: 0.72, stepNoise: 1, sfx: 'concrete', color: '#9aa4ad' },
  2: { id: 2, name: 'mosiądz', decay: 3.6, gain: 1, stepNoise: 1.35, sfx: 'metal', color: '#c9b47f' },
  3: { id: 3, name: 'woda', decay: 2.5, gain: 0.55, stepNoise: 2.1, sfx: 'water', color: '#7fa6bb' },
  4: { id: 4, name: 'szkło', decay: 1.2, gain: 0.9, stepNoise: 3, sfx: 'glass', color: '#b6c4c9' },
  5: { id: 5, name: 'dywan', decay: 0.45, gain: 0.16, stepNoise: 0.05, sfx: 'concrete', color: '#6d6068' },
  6: { id: 6, name: 'wyjście', decay: 4, gain: 0.85, stepNoise: 1, sfx: 'metal', color: '#8fd0b4' },
};

export interface Cavern {
  w: number;
  h: number;
  cells: Uint8Array;
  spawn: { x: number; y: number };
  exit: { x: number; y: number };
  /** Rozpoznane podłoża do statystyk / testów. */
  floorKinds: Record<string, number>;
}

export const isWall = (map: Cavern, x: number, y: number): boolean => {
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= map.w || iy >= map.h) return true;
  return map.cells[iy * map.w + ix] === CONCRETE || map.cells[iy * map.w + ix] === METAL;
};

const set = (map: Cavern, x: number, y: number, v: number): void => {
  if (x < 1 || y < 1 || x >= map.w - 1 || y >= map.h - 1) return;
  map.cells[y * map.w + x] = v;
};

/** Generuje brutalistyczne jaskinie: korytarze, sale, podłoża o różnej akustyce. */
export function generateCavern(seed: number, w = 34, h = 26): Cavern {
  const rng = new Rng(seed);
  const cells = new Uint8Array(w * h).fill(CONCRETE);
  const map: Cavern = {
    w, h, cells,
    spawn: { x: 2.5, y: h - 3.5 },
    exit: { x: w - 3.5, y: 3.5 },
    floorKinds: {},
  };
  const carve = (x: number, y: number, radius = 1): void => {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) set(map, x + dx, y + dy, EMPTY);
    }
  };
  // Kręty korytarz od spawnu do wyjścia (z odchyleniem w stronę celu).
  let cx = Math.round(map.spawn.x), cy = Math.round(map.spawn.y);
  carve(cx, cy, 1);
  for (let step = 0; step < 220; step += 1) {
    const tx = map.exit.x - cx, ty = map.exit.y - cy;
    const towards = rng.chance(0.62);
    let dx = 0, dy = 0;
    if (towards) { if (Math.abs(tx) > Math.abs(ty)) dx = Math.sign(tx); else dy = Math.sign(ty); }
    else { const d = rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]); dx = d[0]; dy = d[1]; }
    cx = clamp(cx + dx, 2, w - 3);
    cy = clamp(cy + dy, 2, h - 3);
    carve(cx, cy, rng.chance(0.35) ? 2 : 1);
    if (Math.hypot(cx - map.exit.x, cy - map.exit.y) < 2) break;
  }
  // Sale o zróżnicowanych ścianach.
  for (let i = 0; i < 9; i += 1) {
    const rx = rng.int(4, w - 6), ry = rng.int(4, h - 6);
    const rw = rng.int(2, 4), rh = rng.int(2, 3);
    const wall = rng.chance(0.45) ? METAL : CONCRETE;
    for (let y = ry - rh; y <= ry + rh; y += 1) {
      for (let x = rx - rw; x <= rx + rw; x += 1) {
        const edge = Math.abs(x - rx) === rw || Math.abs(y - ry) === rh;
        set(map, x, y, edge ? wall : EMPTY);
      }
    }
    // Podłogi akustyczne wewnątrz sali.
    for (let y = ry - rh + 1; y < ry + rh; y += 1) {
      for (let x = rx - rw + 1; x < rx + rw; x += 1) {
        if (rng.chance(0.32)) set(map, x, y, rng.pick([WATER, GLASS, CARPET, WATER]));
      }
    }
  }
  carve(Math.round(map.spawn.x), Math.round(map.spawn.y), 2);
  carve(Math.round(map.exit.x), Math.round(map.exit.y), 2);
  set(map, Math.round(map.exit.x), Math.round(map.exit.y), EXIT);
  // Gwarancja przejścia: jeśli losowy korytarz się urwał, dorysuj prosty.
  if (!reachable(map)) forceCorridor(map);
  for (const v of [WATER, GLASS, CARPET, METAL]) {
    map.floorKinds[String(v)] = cells.reduce((a, c) => a + (c === v ? 1 : 0), 0);
  }
  return map;
}

/** BFS po polach niebędących ścianą. */
export function reachable(map: Cavern): boolean {
  const start = [Math.round(map.spawn.x), Math.round(map.spawn.y)];
  const goal = [Math.round(map.exit.x), Math.round(map.exit.y)];
  const seen = new Uint8Array(map.w * map.h);
  const queue: number[][] = [start];
  seen[start[1] * map.w + start[0]] = 1;
  while (queue.length) {
    const [x, y] = queue.shift()!;
    if (Math.abs(x - goal[0]) <= 1 && Math.abs(y - goal[1]) <= 1) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= map.w - 1 || ny >= map.h - 1) continue;
      const i = ny * map.w + nx;
      if (seen[i] || isWall(map, nx, ny)) continue;
      seen[i] = 1;
      queue.push([nx, ny]);
    }
  }
  return false;
}

function forceCorridor(map: Cavern): void {
  let x = Math.round(map.spawn.x), y = Math.round(map.spawn.y);
  const gx = Math.round(map.exit.x), gy = Math.round(map.exit.y);
  while (x !== gx || y !== gy) {
    carve3(map, x, y);
    if (x !== gx) x += Math.sign(gx - x); else y += Math.sign(gy - y);
  }
  carve3(map, gx, gy);
}
function carve3(map: Cavern, x: number, y: number): void {
  for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
    const ix = x + dx, iy = y + dy;
    if (ix > 0 && iy > 0 && ix < map.w - 1 && iy < map.h - 1) map.cells[iy * map.w + ix] = EMPTY;
  }
}

export interface EchoHit {
  x: number;
  y: number;
  dist: number;
  material: number;
  angle: number;
  intensity: number;
  /** true = odbicie od podłogi, nie od ściany (słabsze, ziarniste). */
  floor: boolean;
}

/**
 * Prosty ray-marcher: 0,09 komórki na krok. Zapisuje zarówno trafienia w ścianę,
 * jak i rzadkie, słabe odbicia od podłoża — to one rysują „fakturę" zamiast
 * gładkiego, neonowego sonaru.
 */
export function castRays(
  map: Cavern, px: number, py: number, yaw: number,
  fov = Math.PI / 2, rays = 130, maxDist = 15,
): EchoHit[] {
  const hits: EchoHit[] = [];
  const stepSize = 0.09;
  for (let r = 0; r < rays; r += 1) {
    const angle = yaw - fov / 2 + (r / Math.max(1, rays - 1)) * fov;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let x = px, y = py, dist = 0, nextFloor = 0.55;
    while (dist < maxDist) {
      dist += stepSize;
      x = px + dx * dist;
      y = py + dy * dist;
      const ix = Math.floor(x), iy = Math.floor(y);
      if (ix < 0 || iy < 0 || ix >= map.w || iy >= map.h) break;
      const cell = map.cells[iy * map.w + ix];
      if (cell === CONCRETE || cell === METAL) {
        const mat = MATERIALS[cell];
        hits.push({
          x, y, dist, material: cell, angle,
          intensity: mat.gain / (1 + dist * 0.19), floor: false,
        });
        break;
      }
      if (dist >= nextFloor && cell !== EMPTY) {
        const mat = MATERIALS[cell] ?? MATERIALS[CONCRETE];
        hits.push({
          x, y, dist, material: cell, angle,
          intensity: mat.gain * 0.42 / (1 + dist * 0.28), floor: true,
        });
        nextFloor += 0.6;
      }
    }
  }
  return hits;
}

export const castOmni = (map: Cavern, x: number, y: number, rays = 200, maxDist = 15): EchoHit[] =>
  castRays(map, x, y, 0, Math.PI * 2, rays, maxDist);

export type ToolKind = 'click' | 'stone' | 'fork' | 'mic' | 'carpet' | 'decoy' | 'jammer';

export interface Pulse {
  id: number;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  power: number;
  kind: ToolKind;
  hits: EchoHit[];
  age: number;
}

export interface Listener {
  x: number;
  y: number;
  state: 'idle' | 'investigate' | 'hunt';
  target: { x: number; y: number };
  stun: number;
  wander: number;
  heard: number;
}

export interface WorldInput {
  forward: number;
  strafe: number;
  turn: number;
  sneak: boolean;
}

export interface StepResult { caught: boolean; escaped: boolean; events: string[] }

export const SOUND_SPEED = 9; // komórki / sekundę

export class SoundWorld {
  readonly map: Cavern;
  readonly listeners: Listener[] = [];
  readonly pulses: Pulse[] = [];
  readonly tools: Record<ToolKind, number> = {
    click: 999, stone: 5, fork: 3, mic: 4, carpet: 3, decoy: 2, jammer: 1,
  };
  player = { x: 0, y: 0, yaw: -Math.PI / 2 };
  noise = 0;
  heard = 0;
  steps = 0;
  caught = false;
  escaped = false;
  time = 0;
  decoys: { x: number; y: number; until: number; next: number }[] = [];
  private pulseId = 1;
  private rng: Rng;
  private stepAccum = 0;
  private events: string[] = [];

  constructor(seed: number, difficulty = 1) {
    this.rng = new Rng(seed);
    this.map = generateCavern(seed);
    this.player.x = this.map.spawn.x;
    this.player.y = this.map.spawn.y;
    const count = Math.min(7, 3 + Math.floor(difficulty));
    for (let i = 0; i < count; i += 1) {
      const spot = this.findFloorFarFrom(this.map.spawn, 7 + i * 1.5);
      this.listeners.push({
        x: spot.x, y: spot.y, state: 'idle', target: { x: spot.x, y: spot.y },
        stun: 0, wander: this.rng.float(0, 6), heard: 0,
      });
    }
  }

  private findFloorFarFrom(origin: { x: number; y: number }, minDist: number): { x: number; y: number } {
    for (let i = 0; i < 400; i += 1) {
      const x = this.rng.int(2, this.map.w - 3) + 0.5;
      const y = this.rng.int(2, this.map.h - 3) + 0.5;
      if (!isWall(this.map, x, y) && Math.hypot(x - origin.x, y - origin.y) > minDist) return { x, y };
    }
    return { x: this.map.exit.x, y: this.map.exit.y };
  }

  private say(text: string): void { this.events.push(text); }

  drain(): string[] { const out = this.events; this.events = []; return out; }

  /** Emisja dźwięku. Zwraca `false`, gdy zabrakło narzędzia. */
  emit(kind: ToolKind, atX?: number, atY?: number): { ok: boolean; text: string; sfx: string } {
    if (this.tools[kind] <= 0) return { ok: false, text: 'Zabrakło: ' + kind, sfx: '' };
    const spec: Record<ToolKind, { power: number; max: number; sfx: string; label: string }> = {
      click: { power: 5, max: 7, sfx: 'click', label: 'Pstryknięcie' },
      stone: { power: 7, max: 10, sfx: 'concrete', label: 'Kamień' },
      fork: { power: 12, max: 15, sfx: 'metal', label: 'Kamerton' },
      mic: { power: 2, max: 12, sfx: 'ping', label: 'Mikrofon kierunkowy' },
      carpet: { power: 0.5, max: 2, sfx: 'concrete', label: 'Dywan' },
      decoy: { power: 3, max: 5, sfx: 'glass', label: 'Zabawka' },
      jammer: { power: 14, max: 9, sfx: 'alarm', label: 'Zagłuszacz' },
    };
    const s = spec[kind];
    if (kind !== 'click') this.tools[kind] -= 1;
    const x = atX ?? this.player.x;
    const y = atY ?? this.player.y;

    if (kind === 'carpet') {
      const ix = Math.floor(this.player.x), iy = Math.floor(this.player.y);
      if (ix > 0 && iy > 0 && ix < this.map.w - 1 && iy < this.map.h - 1) {
        this.map.cells[iy * this.map.w + ix] = CARPET;
      }
      this.say('Rozłożyłeś dywan. Kroki na tym polu są prawie bezszelestne.');
      return { ok: true, text: 'Dywan rozłożony.', sfx: s.sfx };
    }
    if (kind === 'decoy') {
      const spot = this.findDecoySpot();
      this.decoys.push({ x: spot.x, y: spot.y, until: this.time + 7, next: this.time });
      this.say(`Mechaniczna zabawka tyka w innym korytarzu (${spot.x.toFixed(1)}, ${spot.y.toFixed(1)}).`);
      return { ok: true, text: 'Zabawka ustawiona w innym korytarzu.', sfx: s.sfx };
    }
    if (kind === 'mic') {
      // Mikrofon kierunkowy: wąski stożek zamiast kuli, prawie bezszelestny.
      this.emitPulse(kind, x, y, s.power, s.max);
      this.noise = Math.max(this.noise, 0.12);
      this.attract(x, y, 1.2, 3.2);
      this.say('Mikrofon kierunkowy: cienki stożek echa przed Tobą, prawie niesłyszalny.');
      return { ok: true, text: 'Mikrofon kierunkowy', sfx: s.sfx };
    }
    if (kind === 'jammer') {
      let stunned = 0;
      for (const l of this.listeners) {
        if (Math.hypot(l.x - x, l.y - y) < s.max) { l.stun = 4.5; l.state = 'idle'; stunned += 1; }
      }
      this.noise = Math.max(this.noise, 1);
      this.say(`Zagłuszacz ogłuszył ${stunned} Słuchaczy na 4,5 s.`);
      this.emitPulse(kind, x, y, s.power, s.max);
      return { ok: true, text: `Ogłuszono ${stunned}.`, sfx: s.sfx };
    }

    this.emitPulse(kind, x, y, s.power, s.max);
    this.noise = Math.max(this.noise, clamp(s.power / 12, 0.2, 1));
    this.attract(x, y, s.power, s.max);
    this.say(`${s.label}: fala dźwięku ruszyła z (${x.toFixed(1)}, ${y.toFixed(1)}).`);
    return { ok: true, text: s.label, sfx: s.sfx };
  }

  /** Zabawki muszą hałasować GDZIE INDZIEJ, inaczej sprowadzają wrogów na gracza. */
  private findDecoySpot(): { x: number; y: number } {
    for (const offset of [Math.PI / 2, -Math.PI / 2, Math.PI, Math.PI / 4, -Math.PI / 4]) {
      const angle = this.player.yaw + offset;
      for (const distance of [5.5, 4.5, 3.5]) {
        const x = this.player.x + Math.cos(angle) * distance;
        const y = this.player.y + Math.sin(angle) * distance;
        if (!isWall(this.map, x, y)) return { x, y };
      }
    }
    return { x: this.player.x, y: this.player.y };
  }

  private emitPulse(kind: ToolKind, x: number, y: number, power: number, max: number): void {
    const hits = kind === 'mic'
      ? castRays(this.map, x, y, this.player.yaw, 0.46, 90, max)
      : kind === 'stone' || kind === 'decoy'
        ? castOmni(this.map, x, y, 180, max)
        : castOmni(this.map, x, y, 200, max);
    // Kolejność według odległości: fala ma docierać do BLISKICH punktów
    // najpierw, niezależnie od kąta, pod którym zostały wyśledzone.
    hits.sort((a, b) => a.dist - b.dist);
    this.pulses.push({ id: this.pulseId++, x, y, radius: 0, maxRadius: max, power, kind, hits, age: 0 });
    if (this.pulses.length > 6) this.pulses.shift();
  }

  /** Słuchacze słyszą dźwięk proporcjonalnie do głośności i odległości. */
  private attract(x: number, y: number, power: number, max: number): void {
    let heardBy = 0;
    for (const l of this.listeners) {
      if (l.stun > 0) continue;
      const d = Math.hypot(l.x - x, l.y - y);
      const hearingRange = max * (0.55 + power / 24);
      if (d < hearingRange) {
        l.target = { x, y };
        l.state = d < hearingRange * 0.5 ? 'hunt' : 'investigate';
        l.heard += 1;
        heardBy += 1;
      }
    }
    if (heardBy > 0) {
      this.heard += 1;
      this.say(`Usłyszano Cię (${heardBy}).`);
    }
  }

  private moveWithCollision(actor: { x: number; y: number }, dx: number, dy: number, radius = 0.24): void {
    if (!isWall(this.map, actor.x + dx + Math.sign(dx) * radius, actor.y)) actor.x += dx;
    if (!isWall(this.map, actor.x, actor.y + dy + Math.sign(dy) * radius)) actor.y += dy;
  }

  step(dt: number, input: WorldInput): StepResult {
    const d = clamp(dt, 0.001, 0.06);
    this.time += d;
    this.player.yaw += input.turn * d * 2.4;
    const speed = (input.sneak ? 1.15 : 2.35) * d;
    const fx = Math.cos(this.player.yaw), fy = Math.sin(this.player.yaw);
    const dx = (fx * input.forward - fy * input.strafe) * speed;
    const dy = (fy * input.forward + fx * input.strafe) * speed;
    const moving = Math.abs(dx) + Math.abs(dy) > 0.0001;
    if (moving) {
      this.moveWithCollision(this.player, dx, dy);
      this.stepAccum += Math.hypot(dx, dy);
      const floor = this.map.cells[Math.floor(this.player.y) * this.map.w + Math.floor(this.player.x)]
        ?? CONCRETE;
      const mat = MATERIALS[floor] ?? MATERIALS[CONCRETE];
      if (this.stepAccum > (input.sneak ? 0.85 : 0.62)) {
        this.stepAccum = 0;
        this.steps += 1;
        const loudness = mat.stepNoise * (input.sneak ? 0.35 : 1);
        if (loudness > 0.3) {
          this.noise = Math.max(this.noise, clamp(loudness / 3, 0, 1));
          this.attract(this.player.x, this.player.y, loudness * 2.2, input.sneak ? 2.4 : 4.6);
          this.emitPulse('click', this.player.x, this.player.y, 0.6, 2.2);
        }
      }
    }
    this.noise = Math.max(0, this.noise - d * 0.42);

    // Fale echa rosną z prędkością dźwięku; po przebyciu drogi gasną.
    for (const p of this.pulses) { p.age += d; p.radius = Math.min(p.maxRadius, p.radius + SOUND_SPEED * d); }
    for (let i = this.pulses.length - 1; i >= 0; i -= 1) {
      if (this.pulses[i].radius >= this.pulses[i].maxRadius && this.pulses[i].age > 5.5) {
        this.pulses.splice(i, 1);
      }
    }

    // Zabawki powtarzają cichy dźwięk w innym miejscu.
    for (const decoy of this.decoys) {
      if (this.time > decoy.until) continue;
      if (this.time >= decoy.next) {
        decoy.next = this.time + 1.15;
        this.emitPulse('decoy', decoy.x, decoy.y, 2.4, 5);
        this.attract(decoy.x, decoy.y, 4, 6);
      }
    }
    this.decoys = this.decoys.filter((v) => v.until >= this.time);

    // Słuchacze: ogłuszenie, wędrówka, pościg, złapanie.
    for (const l of this.listeners) {
      if (l.stun > 0) { l.stun -= d; continue; }
      const dPlayer = Math.hypot(l.x - this.player.x, l.y - this.player.y);
      if (dPlayer < 2.2 && !input.sneak) { l.target = { x: this.player.x, y: this.player.y }; l.state = 'hunt'; }
      let tx = l.target.x, ty = l.target.y;
      if (l.state === 'idle') {
        l.wander -= d;
        if (l.wander <= 0) {
          l.wander = this.rng.float(1.5, 4);
          const spot = this.findFloorFarFrom({ x: l.x, y: l.y }, 2);
          l.target = spot;
        }
        tx = l.target.x; ty = l.target.y;
      } else if (Math.hypot(l.x - tx, l.y - ty) < 0.6) {
        l.state = 'idle';
        l.wander = this.rng.float(1, 3);
      }
      const vx = tx - l.x, vy = ty - l.y;
      const len = Math.hypot(vx, vy) || 1;
      const pace = (l.state === 'hunt' ? 1.35 : 0.85) * d;
      this.moveWithCollision(l, (vx / len) * pace, (vy / len) * pace, 0.2);
      if (dPlayer < 0.66) {
        this.caught = true;
        this.say('Słuchacz Cię dotknął.');
      }
    }

    if (Math.hypot(this.player.x - this.map.exit.x, this.player.y - this.map.exit.y) < 0.85) {
      this.escaped = true;
    }
    return { caught: this.caught, escaped: this.escaped, events: this.drain() };
  }

  get score(): number {
    return Math.max(0, Math.round(1000 - this.time * 4 - this.heard * 45 - this.steps * 2
      + this.listeners.reduce((a, l) => a + l.heard, 0) * -3));
  }

  /** Kierunek do najbliższego Słuchacza — mikrofon kierunkowy. */
  nearestListenerAngle(): number | null {
    if (this.listeners.length === 0) return null;
    let best = Infinity, angle = 0;
    for (const l of this.listeners) {
      const d = Math.hypot(l.x - this.player.x, l.y - this.player.y);
      if (d < best) { best = d; angle = Math.atan2(l.y - this.player.y, l.x - this.player.x); }
    }
    return best < 12 ? angle : null;
  }
}
