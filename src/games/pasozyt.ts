import { Shell } from '../core/shell';
import { el, clear, bar } from '../core/dom';
import { clamp, round2 } from '../core/random';
import type { Game, GameContext } from '../core/types';
import {
  Colony, BUILDINGS, type BuildingKind, type TileKind, type SimEvent,
} from '../logic/pasozyt-engine';

const CELL = 42;
const TILE_NAMES: Record<TileKind, string> = {
  tissue: 'tkanka', bone: 'kość', vessel: 'naczynie', nerve: 'węzeł nerwowy',
  organ: 'narząd', wound: 'RANA',
};
const RESOURCE_LABELS: Record<string, string> = {
  calcium: 'Wapń', oxygen: 'Tlen', hormone: 'Hormony', biomass: 'Biomasa', suppressant: 'Immunosupresant',
};
const RESOURCE_GLYPHS: Record<string, string> = {
  calcium: '◈', oxygen: '◉', hormone: '❈', biomass: '✿', suppressant: '✳',
};

export class PasozytGame implements Game {
  private shell: Shell | null = null;
  private colony: Colony | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private selected: BuildingKind = 'mine';
  private speed = 1;
  private paused = false;
  private raf = 0;
  private timer = 0;
  private phase = 0;
  private ended = false;
  private resourcesEl: HTMLElement | null = null;
  private hostEl: HTMLElement | null = null;
  private paletteEl: HTMLElement | null = null;
  private logEl: HTMLElement | null = null;
  private eventEl: HTMLElement | null = null;
  private statsEl: HTMLElement | null = null;
  private hover: { x: number; y: number } | null = null;

  mount(ctx: GameContext): void {
    const seed = Date.now() % 1000000;
    this.colony = new Colony(seed);
    const shell = new Shell(ctx.root, {
      id: 'pasozyt', number: 'II', title: 'Pasożyt', subtitle: 'Biologiczny city-builder',
      genre: '', hook: '', features: [], accent: '#a8d5b5', glyph: '❋',
    }, ctx.audio, () => this.finish(ctx, false));
    this.shell = shell;
    ctx.audio.startDrone('pasozyt');
    shell.showHelp('Wewnątrz gospodarza', [
      'Wybierz strukturę w palecie i kliknij pole. Kopalnia tylko na kości, pompa na naczyniu, gruczoł na narządzie, łata na ranie, węzeł na węźle nerwowym.',
      'Prawy przycisk myszy (albo przycisk „Rozwiąż") usuwa strukturę i pozwala tkance odetchnąć.',
      'Każdy budynek daje zasób, ale podnosi ZAPALENIE. Zapalenie rozlewa się na sąsiednie pola i wywołuje gorączkę.',
      'Wieże immunosupresyjne wyciszają zapalenie i zabijają leukocyty w promieniu 2. Węzły termoregulacji zbijają temperaturę.',
      'Co 22 cykle gospodarz przechodzi zdarzenie. Łataj rany, lecz gorączkę, nie zabijaj żywiciela: jego śmierć to Twoja śmierć.',
      'Cel: przetrwać 240 cykli w symbiozie. Przyciski ⏸ / 1× / 2× / 4× zmieniają tempo.',
    ]);

    const wrap = el('div', { class: 'pasozyt' });
    const left = el('div', { class: 'pasozyt__left' });
    const right = el('div', { class: 'pasozyt__right' });

    this.canvas = el('canvas', {
      class: 'tissue', width: String(this.colony.w * CELL), height: String(this.colony.h * CELL),
      'aria-label': 'Mapa tkanki gospodarza',
    }) as HTMLCanvasElement;
    this.ctx2d = this.canvas.getContext('2d');
    this.attachCanvas(ctx);
    const legend = el('div', { class: 'tissue-legend' });
    for (const [kind, label] of Object.entries(TILE_NAMES)) {
      legend.append(el('span', { class: `legend legend--${kind}` }, el('i'), label));
    }
    const boardPanel = el('section', { class: 'panel panel--tissue' },
      el('div', { class: 'panel__head' },
        el('h3', { text: 'Tkanka · 16 × 11' }),
        el('span', { class: 'panel__hint', text: 'kliknij = buduj · prawy przycisk = rozwiąż' })),
      this.canvas, legend);

    this.logEl = el('div', { class: 'sim-log', role: 'log' });
    left.append(boardPanel, el('section', { class: 'panel' },
      el('div', { class: 'panel__head' }, el('h3', { text: 'Dziennik kolonii' })), this.logEl));

    this.resourcesEl = el('div', { class: 'resources' });
    this.hostEl = el('div', { class: 'host' });
    this.paletteEl = el('div', { class: 'palette' });
    this.statsEl = el('div', { class: 'sim-stats' });
    this.eventEl = el('div', { class: 'event-slot' });

    const speedRow = el('div', { class: 'speed-row' });
    const pauseBtn = el('button', { type: 'button', class: 'btn btn--tiny', text: '⏸ Pauza' });
    pauseBtn.addEventListener('click', () => {
      this.paused = !this.paused;
      pauseBtn.textContent = this.paused ? '▶ Wznów' : '⏸ Pauza';
      ctx.audio.play('ui');
    });
    speedRow.append(pauseBtn);
    for (const s of [1, 2, 4]) {
      const b = el('button', { type: 'button', class: `btn btn--tiny${s === 1 ? ' is-active' : ''}`, text: `${s}×` });
      b.addEventListener('click', () => {
        this.speed = s;
        for (const other of speedRow.querySelectorAll('.btn')) other.classList.remove('is-active');
        b.classList.add('is-active');
        ctx.audio.play('ui');
      });
      speedRow.append(b);
    }
    const demolishBtn = el('button', { type: 'button', class: 'btn btn--tiny', text: '✕ Rozwiąż zaznaczone' });
    demolishBtn.addEventListener('click', () => {
      if (!this.hover) return;
      const res = this.colony!.demolish(this.hover.x, this.hover.y);
      this.shell!.toast(res.text);
      ctx.audio.play('squelch');
      this.refreshPanels();
    });

    right.append(
      el('section', { class: 'panel' },
        el('div', { class: 'panel__head' }, el('h3', { text: 'Zasoby kolonii' })), this.resourcesEl),
      el('section', { class: 'panel' },
        el('div', { class: 'panel__head' }, el('h3', { text: 'Gospodarz' })), this.hostEl),
      el('section', { class: 'panel' },
        el('div', { class: 'panel__head' }, el('h3', { text: 'Tempo' })), speedRow, demolishBtn),
      el('section', { class: 'panel' },
        el('div', { class: 'panel__head' }, el('h3', { text: 'Struktury' }),
          el('span', { class: 'panel__hint', text: 'wybierz, potem kliknij pole' })), this.paletteEl),
      this.eventEl,
      el('section', { class: 'panel' },
        el('div', { class: 'panel__head' }, el('h3', { text: 'Bilans' })), this.statsEl));
    wrap.append(left, right);
    shell.body.append(wrap);

    this.buildPalette(ctx);
    this.refreshPanels();
    this.draw(0);

    // Jeden cykl na sekundę (skalowany przez tempo), rysowanie w rAF.
    let acc = 0;
    let last = performance.now();
    const loop = (now: number): void => {
      const dt = Math.min(0.2, (now - last) / 1000);
      last = now;
      this.phase += dt;
      if (!this.paused && !this.ended && !this.colony!.pending) {
        acc += dt * this.speed;
        while (acc >= 1) { acc -= 1; this.stepTick(ctx); }
      }
      this.draw(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    shell.onCleanup(() => cancelAnimationFrame(this.raf));
    this.timer = window.setInterval(() => {
      if (!this.paused && !this.ended && this.colony!.host.fever > 38.6) ctx.audio.play('heart', { gain: 0.5 });
    }, 3000);
    shell.onCleanup(() => window.clearInterval(this.timer));
  }

  private attachCanvas(ctx: GameContext): void {
    const canvas = this.canvas!;
    const pos = (event: MouseEvent | PointerEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: clamp(Math.floor(((event.clientX - rect.left) / rect.width) * this.colony!.w), 0, this.colony!.w - 1),
        y: clamp(Math.floor(((event.clientY - rect.top) / rect.height) * this.colony!.h), 0, this.colony!.h - 1),
      };
    };
    canvas.addEventListener('pointermove', (event) => { this.hover = pos(event); });
    canvas.addEventListener('pointerleave', () => { this.hover = null; });
    canvas.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const p = pos(event);
      const res = this.colony!.demolish(p.x, p.y);
      this.shell!.toast(res.text);
      ctx.audio.play('squelch');
      this.refreshPanels();
    });
    canvas.addEventListener('click', (event) => {
      const p = pos(event);
      this.hover = p;
      const res = this.colony!.build(p.x, p.y, this.selected);
      this.shell!.toast(res.text, res.ok ? 'good' : 'bad');
      ctx.audio.play(res.ok ? 'squelch' : 'click');
      this.refreshPanels();
    });
  }

  private buildPalette(ctx: GameContext): void {
    clear(this.paletteEl!);
    for (const def of Object.values(BUILDINGS)) {
      const cost = Object.entries(def.cost).map(([k, v]) => `${RESOURCE_GLYPHS[k]} ${v}`).join('  ');
      const button = el('button', {
        type: 'button',
        class: `palette__item${this.selected === def.key ? ' is-active' : ''}`,
        'data-kind': def.key,
      },
      el('span', { class: 'palette__glyph', text: def.glyph }),
      el('span', { class: 'palette__body' },
        el('b', { text: def.name }),
        el('small', { text: def.desc }),
        el('em', { text: `${cost} · ${def.needs === 'any' ? 'dowolne pole' : TILE_NAMES[def.needs as TileKind]}` })));
      button.addEventListener('click', () => {
        this.selected = def.key;
        ctx.audio.play('ui');
        for (const other of this.paletteEl!.querySelectorAll('.palette__item')) other.classList.remove('is-active');
        button.classList.add('is-active');
      });
      this.paletteEl!.append(button);
    }
  }

  private stepTick(ctx: GameContext): void {
    const events = this.colony!.tick();
    this.handleEvents(events, ctx);
    this.refreshPanels();
    if (this.colony!.pending) this.showEvent(ctx);
    if (this.colony!.status !== 'playing') this.showEnding(ctx);
  }

  private handleEvents(events: SimEvent[], ctx: GameContext): void {
    for (const e of events) {
      this.logEl!.prepend(el('div', { class: `sim-line sim-line--${e.kind}`, text: e.text }));
      while (this.logEl!.children.length > 80) this.logEl!.lastElementChild?.remove();
      if (e.kind === 'destroy') ctx.audio.play('fail', { gain: 0.6 });
      else if (e.kind === 'event') ctx.audio.play('alarm', { gain: 0.5 });
      else if (e.kind === 'win') ctx.audio.play('success');
      else if (e.kind === 'lose') ctx.audio.play('fail');
    }
  }

  private refreshPanels(): void {
    const c = this.colony!;
    clear(this.resourcesEl!);
    for (const [key, label] of Object.entries(RESOURCE_LABELS)) {
      const value = c.resources[key as keyof typeof c.resources];
      this.resourcesEl!.append(el('div', { class: 'res' },
        el('span', { class: 'res__glyph', text: RESOURCE_GLYPHS[key] }),
        el('div', {}, el('b', { text: String(round2(value)) }), el('small', { text: label }))));
    }
    clear(this.hostEl!);
    const rows: [string, number, number, string][] = [
      ['Zdrowie', c.host.health, 100, c.host.health > 60 ? '#8fd0a8' : '#e08070'],
      ['Gorączka', (c.host.fever - 36.5) / 6 * 100, 100, c.host.fever > 39 ? '#e08070' : '#8fbfa8'],
      ['Odporność', c.host.immune, 100, '#c9a3d6'],
      ['Populacja', c.host.population, 40, '#9ab6d5'],
    ];
    for (const [label, value, max, color] of rows) {
      this.hostEl!.append(el('div', { class: 'host-row' },
        el('span', { text: label }), bar(value, max, color),
        el('b', { text: label === 'Gorączka' ? `${c.host.fever.toFixed(1)}°C` : String(Math.round(value)) })));
    }
    this.hostEl!.append(el('p', { class: 'host__note', text: c.host.fever > 39
      ? 'GORĄCZKA ZABIJA GOSPODARZA — postaw węzeł termoregulacji albo wycisz zapalenie.'
      : c.host.immune > 55 ? 'Układ odpornościowy jest pobudzony — dołóż wież immunosupresyjnych.'
        : 'Gospodarz toleruje kolonię. Uważaj na tempo rozbudowy.' }));
    clear(this.statsEl!);
    this.statsEl!.append(
      el('div', {}, el('b', { text: String(c.tickCount) }), el('small', { text: 'cykl / 240' })),
      el('div', {}, el('b', { text: String(c.buildingCount) }), el('small', { text: 'struktury' })),
      el('div', {}, el('b', { text: String(c.averageInflammation.toFixed(2)) }), el('small', { text: 'śr. zapalenie' })),
      el('div', {}, el('b', { text: String(c.leukocytes.length) }), el('small', { text: 'leukocyty' })),
      el('div', {}, el('b', { text: String(c.score) }), el('small', { text: 'wynik' })));
    this.shell!.setStatus(`cykl ${c.tickCount}/240 · ${c.host.health.toFixed(0)}% zdrowia · ${c.host.fever.toFixed(1)}°C`);
    for (const item of this.paletteEl!.querySelectorAll<HTMLElement>('.palette__item')) {
      const kind = item.dataset.kind as BuildingKind;
      item.classList.toggle('is-poor', !c.canAfford(kind));
    }
  }

  private showEvent(ctx: GameContext): void {
    const pending = this.colony!.pending;
    if (!pending) return;
    clear(this.eventEl!);
    const card = el('div', { class: 'event-card' },
      el('span', { class: 'event-card__kicker', text: 'ZDARZENIE · SYMULACJA WSTRZYMANA' }),
      el('h3', { text: pending.title }),
      el('p', { text: pending.text }));
    for (let i = 0; i < pending.choices.length; i += 1) {
      const choice = pending.choices[i];
      const b = el('button', { type: 'button', class: 'btn btn--tiny' },
        el('b', { text: choice.label }), el('small', { text: choice.detail }));
      b.addEventListener('click', () => {
        const res = this.colony!.resolveEvent(i);
        ctx.audio.play('ui');
        this.shell!.toast(res.text);
        clear(this.eventEl!);
        this.refreshPanels();
      });
      card.append(b);
    }
    this.eventEl!.append(card);
    this.eventEl!.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // --------------------------------------------------------------- rysowanie
  private draw(dt: number): void {
    const c = this.colony!;
    const g = this.ctx2d;
    if (!g) return;
    const W = c.w * CELL, H = c.h * CELL;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#0d1214';
    g.fillRect(0, 0, W, H);
    const pulse = 0.5 + 0.5 * Math.sin(this.phase * 2.1);
    for (let y = 0; y < c.h; y += 1) {
      for (let x = 0; x < c.w; x += 1) {
        const tile = c.at(x, y);
        const px = x * CELL, py = y * CELL;
        const base: Record<TileKind, string> = {
          tissue: '#21302c', bone: '#2c302b', vessel: '#31242a',
          nerve: '#242c35', organ: '#2b2430', wound: '#45252b',
        };
        g.fillStyle = base[tile.kind];
        g.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
        // Żyły i tętno.
        if (tile.kind === 'vessel') {
          g.strokeStyle = `rgba(190, 86, 92, ${0.22 + pulse * 0.2})`;
          g.lineWidth = 3;
          g.beginPath(); g.moveTo(px + 4, py + CELL / 2); g.lineTo(px + CELL - 4, py + CELL / 2); g.stroke();
        }
        if (tile.kind === 'bone') {
          g.strokeStyle = 'rgba(206, 198, 160, 0.16)';
          g.lineWidth = 2;
          g.beginPath(); g.moveTo(px + 6, py + 8); g.lineTo(px + CELL - 8, py + CELL - 8); g.stroke();
        }
        // Zapalenie: ciepła poświata narastająca wraz z wartością.
        if (tile.inflammation > 0.05) {
          const a = clamp(tile.inflammation / 5, 0, 0.72);
          g.fillStyle = `rgba(226, 106, 72, ${a * (0.55 + pulse * 0.25)})`;
          g.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
        }
        if (tile.kind === 'wound') {
          g.strokeStyle = '#e08a7a';
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(px + 8, py + 8); g.lineTo(px + CELL - 10, py + CELL - 9);
          g.moveTo(px + CELL - 9, py + 8); g.lineTo(px + 9, py + CELL - 9);
          g.stroke();
        }
        if (tile.building) {
          const def = BUILDINGS[tile.building];
          g.fillStyle = 'rgba(8, 14, 12, 0.66)';
          g.beginPath(); g.arc(px + CELL / 2, py + CELL / 2, 15, 0, Math.PI * 2); g.fill();
          g.strokeStyle = tile.hp < def.hp * 0.4 ? '#e08070' : 'rgba(168, 213, 181, 0.55)';
          g.lineWidth = 1.5;
          g.beginPath(); g.arc(px + CELL / 2, py + CELL / 2, 15, 0, Math.PI * 2); g.stroke();
          g.fillStyle = '#dce8dd';
          g.font = '17px Georgia, serif';
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(def.glyph, px + CELL / 2, py + CELL / 2 + 1);
        }
      }
    }
    // Wieże: delikatny pierścień zasięgu.
    for (let y = 0; y < c.h; y += 1) {
      for (let x = 0; x < c.w; x += 1) {
        if (c.at(x, y).building !== 'tower') continue;
        g.strokeStyle = `rgba(143, 208, 168, ${0.1 + pulse * 0.07})`;
        g.lineWidth = 1;
        g.beginPath(); g.arc(x * CELL + CELL / 2, y * CELL + CELL / 2, CELL * 2, 0, Math.PI * 2); g.stroke();
      }
    }
    // Leukocyty.
    for (const cell of c.leukocytes) {
      const cx = cell.x * CELL + CELL / 2, cy = cell.y * CELL + CELL / 2;
      g.fillStyle = 'rgba(232, 236, 224, 0.85)';
      g.beginPath(); g.arc(cx, cy, 5 + Math.sin(this.phase * 6 + cx) * 1.2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(210, 220, 230, 0.28)';
      g.lineWidth = 1;
      g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.stroke();
    }
    // Zaznaczenie kursora.
    if (this.hover) {
      g.strokeStyle = 'rgba(220, 232, 221, 0.8)';
      g.lineWidth = 2;
      g.strokeRect(this.hover.x * CELL + 2, this.hover.y * CELL + 2, CELL - 4, CELL - 4);
    }
    // Oddech całej tkanki.
    g.fillStyle = `rgba(168, 213, 181, ${0.012 + pulse * 0.016})`;
    g.fillRect(0, 0, W, H);
    void dt;
  }

  private showEnding(ctx: GameContext): void {
    if (this.ended) return;
    this.ended = true;
    const c = this.colony!;
    const won = c.status === 'won';
    ctx.audio.play(won ? 'success' : 'fail');
    ctx.audio.stopDrone();
    const overlay = el('div', { class: 'ending' },
      el('div', { class: 'ending__card' },
        el('span', { class: 'ending__kicker', text: won ? 'SYMBIOZA' : 'ZGON GOSPODARZA' }),
        el('h2', { text: won ? 'Bestia żyje. Ty też.' : 'Mapa przestała oddychać' }),
        el('p', { text: won
          ? '240 cykli bez śmiertelnej gorączki. Kolonia nauczyła się nie zabijać żywiciela.'
          : 'Zachłanność wywołała gorączkę nie do opanowania. Gdy umiera gospodarz, nie ma już gdzie budować.' }),
        el('div', { class: 'ending__stats' },
          el('div', {}, el('b', { text: String(c.score) }), el('small', { text: 'wynik' })),
          el('div', {}, el('b', { text: String(c.tickCount) }), el('small', { text: 'cykli' })),
          el('div', {}, el('b', { text: String(c.host.population) }), el('small', { text: 'populacja' })),
          el('div', {}, el('b', { text: `${c.host.health.toFixed(0)}%` }), el('small', { text: 'zdrowie' }))),
        el('button', { type: 'button', class: 'btn btn--primary', text: 'Wróć do Gabinetu',
          onclick: () => this.finish(ctx, won, c.score, won ? 'Symbioza wytrzymała 240 cykli.' : 'Gospodarz zmarł.') })));
    this.shell!.body.append(overlay);
  }

  private finish(ctx: GameContext, won: boolean, score = 0, summary = ''): void {
    if (score > 0 || summary) ctx.onFinish({ won, score, summary });
    else ctx.onFinish({ won: false, score: 0, summary: 'Symulacja przerwana.' });
    this.dispose();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.clearInterval(this.timer);
    this.shell?.dispose();
    this.shell = null;
    this.colony = null;
  }
}
