/**
 * „Pasożyt" — czysty symulator kolonii. Mapa nie jest terenem: to tkanka,
 * która reaguje zapaleniem, gorączką i układem odpornościowym.
 *
 * Zasada projektowa: każdy budynek daje zasób ORAZ koszt biologiczny. Nie ma
 * „darmowego" wzrostu — agresywna rozbudowa zabija gospodarza, czyli Ciebie.
 */
import { Rng, clamp, round2 } from '../core/random';

export type TileKind = 'tissue' | 'bone' | 'vessel' | 'nerve' | 'organ' | 'wound';
export type BuildingKind = 'mine' | 'pump' | 'gland' | 'farm' | 'tower' | 'patch' | 'nest' | 'cooler';
export type Resource = 'calcium' | 'oxygen' | 'hormone' | 'biomass' | 'suppressant';

export interface BuildingDef {
  key: BuildingKind;
  name: string;
  desc: string;
  cost: Partial<Record<Resource, number>>;
  upkeep: Partial<Record<Resource, number>>;
  output: Partial<Record<Resource, number>>;
  inflammation: number;
  needs: TileKind | 'any' | 'wound';
  hp: number;
  glyph: string;
}

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  mine: {
    key: 'mine', name: 'Kopalnia wapnia', glyph: '⛏', needs: 'bone', hp: 34,
    desc: 'Wydobywa wapń z kości gospodarza. Silnie drażni tkankę.',
    cost: { biomass: 8, oxygen: 4 }, upkeep: {}, output: { calcium: 3.2 }, inflammation: 1.05,
  },
  pump: {
    key: 'pump', name: 'Pompa krwi', glyph: '◍', needs: 'vessel', hp: 30,
    desc: 'Pompuje natlenioną krew. Bez tlenu kolonia dusi się w trzy cykle.',
    cost: { calcium: 6, biomass: 5 }, upkeep: {}, output: { oxygen: 4.1, biomass: 0.5 }, inflammation: 0.6,
  },
  gland: {
    key: 'gland', name: 'Gruczoł hormonalny', glyph: '❈', needs: 'organ', hp: 28,
    desc: 'Hormony usypiają układ odpornościowy i karmią gniazda.',
    cost: { oxygen: 8, calcium: 6 }, upkeep: { oxygen: 1 }, output: { hormone: 2.2 }, inflammation: 0.7,
  },
  farm: {
    key: 'farm', name: 'Farma biomasy', glyph: '✿', needs: 'tissue', hp: 24,
    desc: 'Najtańszy przyrost masy. Delikatna, szybko pada od leukocytów.',
    cost: { oxygen: 5, calcium: 2 }, upkeep: {}, output: { biomass: 4.4 }, inflammation: 0.35,
  },
  tower: {
    key: 'tower', name: 'Wieża immunosupresyjna', glyph: '⌂', needs: 'any', hp: 40,
    desc: 'Rozpyla immunosupresant: wycisza zapalenie i unieszkodliwia leukocyty w promieniu 2.',
    cost: { hormone: 4, calcium: 8 }, upkeep: { hormone: 0.8 }, output: { suppressant: 1.7 }, inflammation: -0.5,
  },
  patch: {
    key: 'patch', name: 'Łata tkankowa', glyph: '✚', needs: 'wound', hp: 26,
    desc: 'Zaszywa ranę od wewnątrz. Przywraca zdrowie gospodarza i gasi zapalenie.',
    cost: { biomass: 12, calcium: 6 }, upkeep: {}, output: {}, inflammation: -1.4,
  },
  nest: {
    key: 'nest', name: 'Komora lęgowa', glyph: '⬡', needs: 'tissue', hp: 36,
    desc: 'Rośnie populacja. Im więcej gniazd, tym większe zapotrzebowanie na tlen.',
    cost: { biomass: 14, hormone: 3 }, upkeep: { oxygen: 1.4 }, output: { biomass: 1.2 }, inflammation: 0.95,
  },
  cooler: {
    key: 'cooler', name: 'Węzeł termoregulacji', glyph: '✳', needs: 'nerve', hp: 32,
    desc: 'Zbija gorączkę, zanim zabije gospodarza. Wymaga immunosupresantu.',
    cost: { calcium: 10, suppressant: 5 }, upkeep: { suppressant: 0.6 }, output: {}, inflammation: -0.2,
  },
};

export interface Tile { kind: TileKind; inflammation: number; building: BuildingKind | null; hp: number }
export interface Leukocyte { x: number; y: number; hp: number; target: string }
export interface SimEvent { kind: 'build' | 'destroy' | 'warn' | 'event' | 'info' | 'win' | 'lose'; text: string }
export interface PendingEvent {
  id: number;
  title: string;
  text: string;
  choices: { label: string; detail: string }[];
}

export class Colony {
  readonly w = 16;
  readonly h = 11;
  tiles: Tile[] = [];
  resources: Record<Resource, number> = { calcium: 18, oxygen: 16, hormone: 5, biomass: 22, suppressant: 3 };
  host = { health: 100, fever: 36.8, immune: 8, population: 4 };
  leukocytes: Leukocyte[] = [];
  tickCount = 0;
  status: 'playing' | 'won' | 'lost' = 'playing';
  pending: PendingEvent | null = null;
  log: string[] = [];
  private rng: Rng;
  private events: SimEvent[] = [];
  private eventCounter = 0;
  private wounded = 0;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.generate();
  }

  at(x: number, y: number): Tile {
    return this.tiles[clamp(y, 0, this.h - 1) * this.w + clamp(x, 0, this.w - 1)];
  }

  private set(x: number, y: number, kind: TileKind): void {
    this.tiles[y * this.w + x] = { kind, inflammation: 0, building: null, hp: 0 };
  }

  private generate(): void {
    for (let y = 0; y < this.h; y += 1) {
      for (let x = 0; x < this.w; x += 1) this.set(x, y, 'tissue');
    }
    // Żyły kości i naczyń: kilka krętych linii, żeby mapa nie była szachownicą.
    for (let i = 0; i < 3; i += 1) {
      const x0 = this.rng.int(1, 4);
      for (let y = 0; y < this.h; y += 1) {
        const x = clamp(x0 + i * 4 + Math.round(Math.sin(y * 0.8 + i) * 1.3), 0, this.w - 1);
        if (this.at(x, y).kind === 'tissue') this.set(x, y, i === 1 ? 'vessel' : 'bone');
      }
    }
    for (let i = 0; i < 8; i += 1) {
      const x = this.rng.int(1, this.w - 2), y = this.rng.int(1, this.h - 2);
      if (this.at(x, y).kind === 'tissue') this.set(x, y, i % 2 ? 'organ' : 'nerve');
    }
    // Start: jedna rana (po ataku drapieżnika) i dwa wolne źródła.
    const wx = this.rng.int(3, this.w - 4), wy = this.rng.int(2, this.h - 3);
    this.set(wx, wy, 'wound');
    this.at(wx, wy).inflammation = 1.4;
    this.wounded += 1;
    this.log.unshift('Kolonia wszczepiona. Gospodarz ma jedną otwartą ranę.');
  }

  private say(kind: SimEvent['kind'], text: string): void {
    this.events.push({ kind, text });
    this.log.unshift(text);
    if (this.log.length > 70) this.log.length = 70;
  }

  drain(): SimEvent[] { const out = this.events; this.events = []; return out; }

  canAfford(kind: BuildingKind): boolean {
    const def = BUILDINGS[kind];
    return Object.entries(def.cost).every(([k, v]) => this.resources[k as Resource] >= (v ?? 0));
  }

  build(x: number, y: number, kind: BuildingKind): { ok: boolean; text: string } {
    if (this.status !== 'playing') return { ok: false, text: 'Symulacja zakończona.' };
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return { ok: false, text: 'Pole poza tkanką.' };
    const tile = this.at(x, y);
    const def = BUILDINGS[kind];
    if (tile.building) return { ok: false, text: 'To pole jest już zajęte.' };
    if (def.needs === 'wound' && tile.kind !== 'wound') return { ok: false, text: 'Łatę można położyć tylko na ranie.' };
    if (def.needs !== 'any' && def.needs !== 'wound' && tile.kind !== def.needs) {
      const names: Record<TileKind, string> = {
        tissue: 'tkance', bone: 'kości', vessel: 'naczyniu', nerve: 'węźle nerwowym',
        organ: 'narządzie', wound: 'ranie',
      };
      return { ok: false, text: `${def.name} wymaga posadowienia na ${names[def.needs as TileKind]}.` };
    }
    if (!this.canAfford(kind)) return { ok: false, text: 'Za mało zasobów.' };
    for (const [k, v] of Object.entries(def.cost)) this.resources[k as Resource] -= v ?? 0;
    tile.building = kind;
    tile.hp = def.hp;
    if (kind === 'patch') {
      tile.kind = 'tissue';
      tile.inflammation = Math.max(0, tile.inflammation - 2);
      this.wounded = Math.max(0, this.wounded - 1);
      this.host.health = clamp(this.host.health + 9, 0, 100);
      this.say('build', `Zaszyto ranę na (${x}, ${y}). Gospodarz odetchnął.`);
    } else {
      this.say('build', `Postawiono ${def.name} na (${x}, ${y}).`);
    }
    return { ok: true, text: `Postawiono ${def.name}.` };
  }

  demolish(x: number, y: number): { ok: boolean; text: string } {
    const tile = this.at(x, y);
    if (!tile.building) return { ok: false, text: 'Tu nic nie stoi.' };
    const name = BUILDINGS[tile.building].name;
    tile.building = null;
    tile.hp = 0;
    tile.inflammation = Math.max(0, tile.inflammation - 0.6);
    this.say('info', `Rozwiązano ${name}. Tkanka zaczyna się goić.`);
    return { ok: true, text: `Usunięto ${name}.` };
  }

  /** Jeden cykl: produkcja → zapalenie → odporność → zdrowie → zdarzenia. */
  tick(): SimEvent[] {
    if (this.status !== 'playing') return this.drain();
    // Oczekująca decyzja gracza zamraża cykl: bez tego zdarzenie dałoby się
    // po prostu przeczekać, a gospodarz umarłby w tle otwartego okna.
    if (this.pending) return this.drain();
    this.tickCount += 1;
    const t = this.tickCount;

    // 1. Produkcja i utrzymanie.
    let towers = 0, nests = 0, coolers = 0, mines = 0;
    const gain: Record<Resource, number> = { calcium: 0, oxygen: 0, hormone: 0, biomass: 0, suppressant: 0 };
    for (let y = 0; y < this.h; y += 1) {
      for (let x = 0; x < this.w; x += 1) {
        const tile = this.at(x, y);
        if (!tile.building) continue;
        const def = BUILDINGS[tile.building];
        let shortage = false;
        for (const [k, v] of Object.entries(def.upkeep)) {
          if (this.resources[k as Resource] < (v ?? 0)) { shortage = true; break; }
        }
        if (shortage) {
          tile.inflammation += 0.25;
          if (t % 6 === 0) this.say('warn', `${def.name} nie ma surowca do utrzymania — tkanka cierpi.`);
          continue;
        }
        for (const [k, v] of Object.entries(def.upkeep)) this.resources[k as Resource] -= v ?? 0;
        for (const [k, v] of Object.entries(def.output)) gain[k as Resource] += v ?? 0;
        if (tile.building === 'tower') towers += 1;
        if (tile.building === 'nest') nests += 1;
        if (tile.building === 'cooler') coolers += 1;
        if (tile.building === 'mine') mines += 1;
      }
    }
    // Populacja konsumuje tlen; bez niej ginie.
    const demand = 0.35 + this.host.population * 0.12;
    if (this.resources.oxygen + gain.oxygen >= demand) {
      gain.oxygen -= demand;
      if (t % 5 === 0 && nests > 0) this.host.population = Math.min(40, this.host.population + 1);
    } else {
      this.host.population = Math.max(0, this.host.population - 1);
      this.host.health = clamp(this.host.health - 2, 0, 100);
      this.say('warn', 'Kolonia się dusi: za mało tlenu dla gniazd.');
    }
    for (const k of Object.keys(gain) as Resource[]) {
      this.resources[k] = round2(clamp(this.resources[k] + gain[k], 0, 999));
    }

    // 2. Zapalenie: źródła + dyfuzja + tłumienie wież.
    const next = this.tiles.map((tile) => tile.inflammation);
    for (let y = 0; y < this.h; y += 1) {
      for (let x = 0; x < this.w; x += 1) {
        const i = y * this.w + x;
        const tile = this.tiles[i];
        if (tile.building) next[i] += BUILDINGS[tile.building].inflammation * 0.16;
        if (tile.kind === 'wound') next[i] += 0.22;
        // Wieże w promieniu 2 wyciszają stan zapalny.
        let suppress = 0;
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            if (Math.abs(dx) + Math.abs(dy) > 2) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
            if (this.at(nx, ny).building === 'tower') suppress += 0.22;
          }
        }
        next[i] -= suppress;
        // Naturalna regeneracja tkanki.
        next[i] *= 0.94;
      }
    }
    // Prosta dyfuzja do sąsiadów (średnia z 4 pól).
    const spread = next.slice();
    for (let y = 0; y < this.h; y += 1) {
      for (let x = 0; x < this.w; x += 1) {
        const i = y * this.w + x;
        let sum = 0, count = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
          sum += next[ny * this.w + nx]; count += 1;
        }
        spread[i] = clamp(next[i] * 0.85 + (count ? sum / count : 0) * 0.15, 0, 6);
      }
    }
    for (let i = 0; i < this.tiles.length; i += 1) this.tiles[i].inflammation = round2(spread[i]);

    // 3. Gorączka i zdrowie.
    const peak = this.tiles.reduce((a, t2) => a + t2.inflammation, 0) / this.tiles.length;
    const cooling = coolers * 0.55;
    const targetFever = clamp(36.8 + peak * 2.6 + mines * 0.035 - cooling, 36.5, 42.5);
    this.host.fever = round2(this.host.fever + (targetFever - this.host.fever) * 0.28);
    if (this.host.fever > 39) {
      const damage = (this.host.fever - 39) * 1.15;
      this.host.health = clamp(this.host.health - damage, 0, 100);
      if (t % 4 === 0) this.say('warn', `Gorączka ${this.host.fever.toFixed(1)}°C osłabia gospodarza.`);
    }
    const openWounds = this.tiles.filter((tile) => tile.kind === 'wound').length;
    if (openWounds > 0) this.host.health = clamp(this.host.health - openWounds * 0.9, 0, 100);
    if (this.host.health > 82 && this.host.fever < 38.2 && t % 8 === 0) {
      this.host.health = clamp(this.host.health + 1.2, 0, 100);
    }
    this.wounded = openWounds;

    // 4. Układ odpornościowy: leukocyty rodzą się, idą po najbliższy budynek.
    this.host.immune = round2(clamp(this.host.immune + peak * 1.7 - towers * 1.4 - 1.1, 0, 100));
    if (this.rng.chance(clamp(this.host.immune / 260, 0, 0.4)) && this.leukocytes.length < 14) {
      const edge = this.rng.int(0, 3);
      const x = edge < 2 ? (edge === 0 ? 0 : this.w - 1) : this.rng.int(0, this.w - 1);
      const y = edge >= 2 ? (edge === 2 ? 0 : this.h - 1) : this.rng.int(0, this.h - 1);
      this.leukocytes.push({ x, y, hp: 6, target: '' });
      if (t % 3 === 0) this.say('warn', 'Wykryto leukocyt na granicy tkanki.');
    }
    for (const cell of this.leukocytes) {
      let bx = -1, by = -1, best = Infinity;
      for (let y = 0; y < this.h; y += 1) {
        for (let x = 0; x < this.w; x += 1) {
          if (!this.at(x, y).building) continue;
          const d = Math.hypot(cell.x - x, cell.y - y);
          if (d < best) { best = d; bx = x; by = y; }
        }
      }
      // Wieże zabijają krwinki w promieniu 2.
      let underTower = false;
      for (const dy of [-2, -1, 0, 1, 2]) {
        for (const dx of [-2, -1, 0, 1, 2]) {
          if (Math.abs(dx) + Math.abs(dy) > 2) continue;
          if (this.at(Math.round(cell.x) + dx, Math.round(cell.y) + dy).building === 'tower') underTower = true;
        }
      }
      if (underTower) { cell.hp -= 3.2; continue; }
      if (bx < 0) { cell.hp -= 0.4; continue; }
      if (best < 0.7) {
        const tile = this.at(bx, by);
        tile.hp -= 3.4;
        if (tile.hp <= 0) {
          const name = BUILDINGS[tile.building!].name;
          tile.building = null;
          tile.inflammation = clamp(tile.inflammation + 0.8, 0, 6);
          this.say('destroy', `Leukocyt zniszczył ${name} na (${bx}, ${by}).`);
        }
      } else {
        cell.x += clamp(bx - cell.x, -0.55, 0.55);
        cell.y += clamp(by - cell.y, -0.55, 0.55);
      }
    }
    this.leukocytes = this.leukocytes.filter((c) => c.hp > 0);

    // 5. Zdarzenia zewnętrzne co 22 cykle.
    if (t % 22 === 0 && !this.pending) this.raiseEvent();

    // 6. Warunki końca.
    if (this.host.health <= 0) {
      this.status = 'lost';
      this.say('lose', 'Gospodarz zmarł. Kolonia zginęła razem z nim.');
    } else if (t >= 240) {
      this.status = 'won';
      this.say('win', `Symbioza wytrzymała 240 cykli. Populacja ${this.host.population}, zdrowie ${Math.round(this.host.health)}%.`);
    }
    return this.drain();
  }

  private raiseEvent(): void {
    this.eventCounter += 1;
    const roll = this.rng.int(0, 2);
    const templates: Omit<PendingEvent, 'id'>[] = [
      {
        title: 'Drapieżnik z zewnątrz',
        text: 'Coś uderzyło w ścianę ciała. Pojawiła się nowa, głęboka rana i fala zapalenia.',
        choices: [
          { label: 'Zaszyj od wewnątrz', detail: '−14 biomasy · rana znika · +6 zdrowia' },
          { label: 'Zostaw, oszczędź zasoby', detail: 'rana zostaje · +2 zapalenia w okolicy' },
        ],
      },
      {
        title: 'Skok odporności',
        text: 'Gospodarz rozpoznaje kolonię jako infekcję. Nadchodzi fala leukocytów.',
        choices: [
          { label: 'Użyj immunosupresantu', detail: '−6 zapasu · fala wyciszona' },
          { label: 'Przeczekaj', detail: '+3 leukocyty · +18 odporności' },
        ],
      },
      {
        title: 'Gorączka nocna',
        text: 'Temperatura ciała rośnie. Tkanki zaczynają się gotować.',
        choices: [
          { label: 'Schłodź hormonami', detail: '−5 hormonu · −1,2°C' },
          { label: 'Nie ingeruj', detail: '+0,8°C · −5 zdrowia' },
        ],
      },
    ];
    this.pending = { id: this.eventCounter, ...templates[roll] };
    this.say('event', `Zdarzenie: ${this.pending.title}`);
  }

  resolveEvent(index: number): { ok: boolean; text: string } {
    if (!this.pending) return { ok: false, text: 'Brak oczekującego zdarzenia.' };
    const kind = this.pending.title;
    let text = '';
    if (kind === 'Drapieżnik z zewnątrz') {
      if (index === 0) {
        if (this.resources.biomass >= 14) {
          this.resources.biomass -= 14;
          this.host.health = clamp(this.host.health + 6, 0, 100);
          text = 'Rana zaszyta. Gospodarz przetrwał atak.';
        } else {
          text = 'Za mało biomasy — rana pozostała otwarta.';
          this.addWound();
        }
      } else { this.addWound(); text = 'Rana została. Zapalenie rośnie.'; }
    } else if (kind === 'Skok odporności') {
      if (index === 0 && this.resources.suppressant >= 6) {
        this.resources.suppressant -= 6;
        this.host.immune = clamp(this.host.immune - 20, 0, 100);
        text = 'Fala wyciszona immunosupresantem.';
      } else {
        this.host.immune = clamp(this.host.immune + 18, 0, 100);
        for (let i = 0; i < 3; i += 1) {
          this.leukocytes.push({ x: this.rng.int(0, this.w - 1), y: this.rng.int(0, this.h - 1), hp: 6, target: '' });
        }
        text = 'Nie zareagowano. Trzy leukocyty są już w tkance.';
      }
    } else {
      if (index === 0 && this.resources.hormone >= 5) {
        this.resources.hormone -= 5;
        this.host.fever = round2(Math.max(36.5, this.host.fever - 1.2));
        text = 'Gorączka opadła.';
      } else {
        this.host.fever = round2(this.host.fever + 0.8);
        this.host.health = clamp(this.host.health - 5, 0, 100);
        text = 'Gorączka urosła, gospodarz osłabł.';
      }
    }
    this.pending = null;
    this.say('info', text);
    return { ok: true, text };
  }

  private addWound(): void {
    const free: [number, number][] = [];
    for (let y = 0; y < this.h; y += 1) {
      for (let x = 0; x < this.w; x += 1) {
        if (!this.at(x, y).building && this.at(x, y).kind === 'tissue') free.push([x, y]);
      }
    }
    if (free.length === 0) return;
    const [x, y] = this.rng.pick(free);
    this.set(x, y, 'wound');
    this.at(x, y).inflammation = 2.2;
    this.wounded += 1;
  }

  get averageInflammation(): number {
    return round2(this.tiles.reduce((a, t) => a + t.inflammation, 0) / this.tiles.length);
  }

  get buildingCount(): number { return this.tiles.filter((t) => t.building).length; }

  get score(): number {
    return Math.max(0, Math.round(
      this.host.population * 4 + this.host.health * 1.2 + this.buildingCount * 3
      + this.tickCount * 0.4 - this.leukocytes.length * 2,
    ));
  }
}
