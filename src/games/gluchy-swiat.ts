import { Shell } from '../core/shell';
import { el, clear } from '../core/dom';
import { clamp } from '../core/random';
import type { Game, GameContext } from '../core/types';
import {
  SoundWorld, MATERIALS, isWall, type ToolKind, type Pulse,
} from '../logic/gluchy-engine';

interface Paint {
  x: number;
  y: number;
  material: number;
  intensity: number;
  born: number;
  life: number;
  floor: boolean;
  seed: number;
}

const TOOLS: { key: ToolKind; label: string; hint: string; glyph: string; hotkey: string }[] = [
  { key: 'click', label: 'Pstryknięcie', hint: 'krótki, tani, zdradza Cię najbliżej', glyph: '·', hotkey: '1' },
  { key: 'stone', label: 'Kamień', hint: 'dźwięk w oddali: widzisz, nie zdradzasz', glyph: '◆', hotkey: '2' },
  { key: 'fork', label: 'Kamerton', hint: 'najdalszy zasięg, najgłośniejszy', glyph: '⌁', hotkey: '3' },
  { key: 'mic', label: 'Mikrofon', hint: 'wąski stożek echa, prawie bezszelestny', glyph: '◁', hotkey: '4' },
  { key: 'carpet', label: 'Dywan', hint: 'wycisza kroki i szkło na jednym polu', glyph: '▤', hotkey: '5' },
  { key: 'decoy', label: 'Zabawka', hint: 'tyka w innym korytarzu przez 7 sekund', glyph: '⚙', hotkey: '6' },
  { key: 'jammer', label: 'Zagłuszacz', hint: 'ogłusza Słuchaczy na 4,5 s', glyph: '✷', hotkey: '7' },
];

const FOV = Math.PI * 0.72;

export class GluchySwiatGame implements Game {
  private shell: Shell | null = null;
  private world: SoundWorld | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private g: CanvasRenderingContext2D | null = null;
  private paints: Paint[] = [];
  private revealed = new Map<number, number>();
  private seenEnemies: number[] = [];
  private keys = new Set<string>();
  private turnPointer = 0;
  private raf = 0;
  private last = 0;
  private time = 0;
  private level = 1;
  private totalScore = 0;
  private ended = false;
  private paused = false;
  private hudEl: HTMLElement | null = null;
  private toolEl: HTMLElement | null = null;
  private noiseEl: HTMLElement | null = null;
  private hintEl: HTMLElement | null = null;
  private compassEl: HTMLElement | null = null;
  private logEl: HTMLElement | null = null;
  private lastSfx = 0;

  mount(ctx: GameContext): void {
    const shell = new Shell(ctx.root, {
      id: 'gluchy-swiat', number: 'III', title: 'Głuchy Świat', subtitle: 'Skrytobójstwo oparte na fizyce dźwięku',
      genre: '', hook: '', features: [], accent: '#9aa8cf', glyph: '◉',
    }, ctx.audio, () => this.finish(ctx, false));
    this.shell = shell;
    ctx.audio.startDrone('gluchy');
    shell.showHelp('Nic tu nie widzi', [
      'Ekran jest czarny. Pstryknięcie (Spacja / 1) wypuszcza falę dźwięku — dopiero gdy wróci, zobaczysz punkty betonu, metalu, wody i szkła.',
      'Każdy dźwięk słyszą Słuchacze. Kamień (2) przenosi hałas w dal: oświetla przestrzeń, ale nie zdradza Twojej pozycji.',
      'Mikrofon kierunkowy (4) widzi wąski stożek przed sobą i prawie nie zdradza pozycji. Dywan (5) wycisza kroki na szkle, zabawka (6) tyka w innym korytarzu, zagłuszacz (7) ogłusza wrogów.',
      'Kamerton (3) widzi najdalej, ale jest najgłośniejszy. Ruch: W/S lub ↑/↓, obrót: A/D lub ←/→ albo mysz, Shift = skradanie.',
      'Idź do wyjścia przez 3 poziomy. Złapanie kończy grę; hałas i czas obniżają wynik.',
    ]);

    const stage = el('div', { class: 'deaf' });
    this.canvas = el('canvas', { class: 'deaf__canvas', width: '960', height: '600',
      'aria-label': 'Czarny widok pierwszoosobowy rozświetlany echem' }) as HTMLCanvasElement;
    this.g = this.canvas.getContext('2d');
    this.hudEl = el('div', { class: 'deaf__hud' });
    this.toolEl = el('div', { class: 'deaf__tools' });
    this.noiseEl = el('div', { class: 'deaf__noise' });
    this.compassEl = el('div', { class: 'deaf__compass' });
    this.logEl = el('div', { class: 'deaf__log', role: 'log' });
    this.hintEl = el('div', { class: 'deaf__hint' });
    stage.append(this.canvas, el('div', { class: 'deaf__vignette' }),
      el('div', { class: 'deaf__crosshair' }), this.compassEl, this.hudEl, this.noiseEl,
      this.logEl, this.toolEl, this.hintEl, this.buildTouch());
    shell.body.append(stage);

    this.startLevel(ctx, Date.now() % 1000000);
    this.buildToolBar(ctx);
    this.attachInput(ctx);

    this.last = performance.now();
    const loop = (now: number): void => {
      const dt = Math.min(0.06, (now - this.last) / 1000);
      this.last = now;
      if (!this.paused && !this.ended) {
        this.time += dt;
        const turn = (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? -1 : 0)
          + (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0)
          + this.turnPointer;
        this.turnPointer *= 0.82;
        const result = this.world!.step(dt, {
          forward: (this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.keys.has('TouchF') ? 1 : 0)
            - (this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.keys.has('TouchB') ? 1 : 0),
          strafe: 0,
          turn,
          sneak: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
        });
        this.handleEvents(result.events, ctx);
        if (result.caught) this.onCaught(ctx);
        else if (result.escaped) this.onEscape(ctx);
      }
      this.collectEcho(ctx);
      this.draw();
      this.updateHud();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    shell.onCleanup(() => cancelAnimationFrame(this.raf));
    shell.onCleanup(() => {
      document.removeEventListener('keydown', this.onKeyDown);
      document.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('blur', this.onBlur);
    });
  }

  private startLevel(ctx: GameContext, seed: number): void {
    this.world = new SoundWorld(seed, this.level);
    this.paints = [];
    this.revealed.clear();
    this.seenEnemies = [];
    this.time = 0;
    this.paused = false;
    this.shell!.setStatus(`poziom ${this.level}/3 · Słuchaczy ${this.world.listeners.length} · wynik ${this.totalScore}`);
    this.log('Poziom ' + this.level + '. Pstryknij palcami (Spacja), żeby cokolwiek zobaczyć.');
    ctx.audio.play('whisper');
    // Pierwsze, darmowe echo — gracz nie może zacząć w totalnej pustce.
    this.emit(ctx, 'click');
  }

  private buildTouch(): HTMLElement {
    const pad = el('div', { class: 'deaf__touch' });
    const mk = (key: string, label: string, hold = true): HTMLButtonElement => {
      const b = el('button', { type: 'button', class: 'touch-btn', text: label,
        'aria-label': label }) as HTMLButtonElement;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (hold) this.keys.add(key);
        else this.touchAction(key);
      });
      b.addEventListener('pointerup', () => { if (hold) this.keys.delete(key); });
      b.addEventListener('pointerleave', () => { if (hold) this.keys.delete(key); });
      return b;
    };
    pad.append(
      mk('TouchTurnL', '↶'), mk('TouchF', '↑'), mk('TouchTurnR', '↷'),
      mk('TouchB', '↓'), mk('Space', '◉ PULS', false), mk('Digit2', '◆ Kamień', false));
    return pad;
  }

  private touchAction(key: string): void {
    if (key === 'Space') this.emit(this.ctxRef!, 'click');
    else if (key === 'Digit2') this.emit(this.ctxRef!, 'stone');
  }

  private ctxRef: GameContext | null = null;

  private buildToolBar(ctx: GameContext): void {
    this.ctxRef = ctx;
    clear(this.toolEl!);
    for (const tool of TOOLS) {
      const b = el('button', { type: 'button', class: 'tool', 'data-tool': tool.key, title: tool.hint },
        el('kbd', { text: tool.hotkey }),
        el('span', { class: 'tool__glyph', text: tool.glyph }),
        el('span', { class: 'tool__label', text: tool.label }),
        el('b', { class: 'tool__count', text: '' }));
      b.addEventListener('click', () => this.emit(ctx, tool.key));
      this.toolEl!.append(b);
    }
  }

  private attachInput(ctx: GameContext): void {
    this.ctxRef = ctx;
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.canvas!.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return;
      const rect = this.canvas!.getBoundingClientRect();
      const nx = (event.clientX - rect.left) / rect.width - 0.5;
      this.turnPointer = clamp(nx * 0.32, -0.35, 0.35);
    });
    this.canvas!.addEventListener('click', () => this.emit(ctx, 'click'));
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const k = event.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) event.preventDefault();
    this.keys.add(k);
    if (!this.ctxRef || this.paused || this.ended) return;
    const byKey: Record<string, ToolKind> = {
      Digit1: 'click', Digit2: 'stone', Digit3: 'fork', Digit4: 'mic',
      Digit5: 'carpet', Digit6: 'decoy', Digit7: 'jammer', Space: 'click',
    };
    if (byKey[k]) this.emit(this.ctxRef, byKey[k]);
  };
  private onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };
  private onBlur = (): void => { this.keys.clear(); };

  private emit(ctx: GameContext, kind: ToolKind): void {
    if (this.paused || this.ended || !this.world) return;
    let x: number | undefined, y: number | undefined;
    if (kind === 'stone') {
      const yaw = this.world.player.yaw;
      let d = 5;
      while (d > 1 && isWall(this.world.map,
        this.world.player.x + Math.cos(yaw) * d,
        this.world.player.y + Math.sin(yaw) * d)) d -= 0.5;
      x = this.world.player.x + Math.cos(yaw) * d;
      y = this.world.player.y + Math.sin(yaw) * d;
    }
    const res = this.world.emit(kind, x, y);
    if (!res.ok) { this.shell!.toast(res.text, 'bad'); return; }
    if (res.sfx) ctx.audio.play(res.sfx, { gain: kind === 'click' ? 0.8 : 1 });
    if (kind === 'fork') ctx.audio.play('metal', { gain: 0.6, delay: 0.08 });
    if (kind === 'jammer') ctx.audio.play('alarm', { gain: 0.7 });
    if (kind === 'stone') this.log('Kamień uderzył w oddali. Echo wraca z innego miejsca niż Ty.');
  }

  private log(text: string): void {
    if (!this.logEl) return;
    this.logEl!.prepend(el('div', { class: 'deaf-line', text }));
    while (this.logEl!.children.length > 5) this.logEl!.lastElementChild?.remove();
  }

  private handleEvents(events: string[], ctx: GameContext): void {
    for (const e of events) {
      if (e.includes('Usłyszano')) {
        ctx.audio.play('whisper', { gain: 0.7 });
        this.log(e);
      } else if (e.includes('dotknął')) ctx.audio.play('fail');
      else if (e.includes('Zagłuszacz') || e.includes('zabawka') || e.includes('Dywan')) this.log(e);
    }
  }

  /** Gdy fala dotrze do punktu odbicia, „malujemy" go na ekranie. */
  private collectEcho(ctx: GameContext): void {
    const w = this.world!;
    for (const pulse of w.pulses) {
      const seen = this.revealed.get(pulse.id) ?? 0;
      let index = seen;
      while (index < pulse.hits.length && pulse.hits[index].dist <= pulse.radius) {
        const hit = pulse.hits[index];
        const mat = MATERIALS[hit.material] ?? MATERIALS[1];
        const boost = clamp(pulse.power / 8, 0.35, 1.5);
        this.paints.push({
          x: hit.x, y: hit.y, material: hit.material,
          intensity: clamp(hit.intensity * boost * (hit.floor ? 0.75 : 1), 0, 1.4),
          born: this.time, life: mat.decay * (0.7 + clamp(pulse.power / 14, 0, 0.7)),
          floor: hit.floor, seed: (hit.x * 131 + hit.y * 977 + index) % 997,
        });
        index += 1;
      }
      if (index > seen) {
        this.revealed.set(pulse.id, index);
        if (index - seen > 8 && this.time - this.lastSfx > 0.28) {
          this.lastSfx = this.time;
          const sample = pulse.hits[Math.min(index - 1, pulse.hits.length - 1)];
          const mat = MATERIALS[sample.material] ?? MATERIALS[1];
          ctx.audio.play(mat.sfx, { gain: 0.35, pitch: 0.85 + (sample.dist % 3) * 0.1,
            delay: sample.dist * 0.012 });
        }
      }
      // Słuchacze widoczni tylko wtedy, gdy dotrze do nich czyjaś fala.
      for (let i = 0; i < w.listeners.length; i += 1) {
        const l = w.listeners[i];
        if (Math.hypot(l.x - pulse.x, l.y - pulse.y) <= pulse.radius) {
          this.seenEnemies[i] = this.time;
        }
      }
    }
    // Wyjście samo „dzwoni", gdy jest blisko.
    if (Math.hypot(w.player.x - w.map.exit.x, w.player.y - w.map.exit.y) < 4) {
      this.paints.push({
        x: w.map.exit.x, y: w.map.exit.y, material: 6, intensity: 1.1,
        born: this.time, life: 2.5, floor: false, seed: 42,
      });
    }
    if (this.paints.length > 2600) this.paints.splice(0, this.paints.length - 2600);
    this.paints = this.paints.filter((p) => this.time - p.born < p.life);
  }

  private draw(): void {
    const g = this.g, w = this.world;
    if (!g || !w) return;
    const W = this.canvas!.width, H = this.canvas!.height;
    g.fillStyle = '#04070a';
    g.fillRect(0, 0, W, H);
    // Bardzo delikatny szum własny (nie jest to obraz świata).
    g.fillStyle = 'rgba(150, 170, 190, 0.018)';
    for (let i = 0; i < 90; i += 1) {
      const x = (i * 7919 + Math.floor(this.time * 13) * 131) % W;
      const y = (i * 104729 + Math.floor(this.time * 7) * 977) % H;
      g.fillRect(x, y, 1, 1);
    }
    const yaw = w.player.yaw;
    for (const p of this.paints) {
      const dx = p.x - w.player.x, dy = p.y - w.player.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.05) continue;
      let diff = Math.atan2(dy, dx) - yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > FOV / 2) continue;
      const age = this.time - p.born;
      const fade = Math.max(0, 1 - age / p.life);
      const mat = MATERIALS[p.material] ?? MATERIALS[1];
      const alpha = clamp(p.intensity * fade * fade * 0.95, 0, 0.9);
      if (alpha < 0.008) continue;
      const sx = W / 2 + (diff / (FOV / 2)) * (W / 2);
      g.fillStyle = mat.color;
      if (p.floor) {
        const sy = H * 0.53 + (H * 0.42) / (1 + dist * 0.34);
        const size = clamp(9 / (1 + dist * 0.7), 0.6, 4);
        g.globalAlpha = alpha * 0.7;
        g.fillRect(sx - size / 2, sy, size, Math.max(0.7, size * 0.4));
      } else {
        const height = (H * 0.82) / (1 + dist * 0.3);
        const top = H / 2 - height / 2;
        g.globalAlpha = alpha;
        const size = clamp(7 / (1 + dist * 0.55), 0.7, 3.2);
        for (let k = 0; k < 3; k += 1) {
          const jitter = ((p.seed * (k + 3) * 37) % 100) / 100;
          const sy = top + height * (0.12 + jitter * 0.78);
          g.fillRect(sx - size / 2, sy, size, size * (0.6 + jitter));
        }
        if (dist < 2.5) {
          g.globalAlpha = alpha * 0.35;
          g.fillRect(sx - 1, top, 2, height);
        }
      }
    }
    g.globalAlpha = 1;
    // Słuchacze: ciemna sylwetka z jasną, drżącą krawędzią.
    for (let i = 0; i < w.listeners.length; i += 1) {
      const seen = this.seenEnemies[i] ?? -99;
      if (this.time - seen > 1.1) continue;
      const l = w.listeners[i];
      const dx = l.x - w.player.x, dy = l.y - w.player.y;
      const dist = Math.hypot(dx, dy);
      let diff = Math.atan2(dy, dx) - yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > FOV / 2) continue;
      const sx = W / 2 + (diff / (FOV / 2)) * (W / 2);
      const h = (H * 0.6) / (1 + dist * 0.35);
      const fade = 1 - (this.time - seen) / 1.1;
      g.fillStyle = `rgba(3, 5, 8, ${0.85 * fade})`;
      g.beginPath(); g.ellipse(sx, H / 2, Math.max(6, h * 0.13), h / 2, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = `rgba(190, 120, 130, ${0.55 * fade})`;
      g.lineWidth = 1.4;
      g.beginPath(); g.ellipse(sx, H / 2, Math.max(6, h * 0.13), h / 2, 0, 0, Math.PI * 2); g.stroke();
    }
    // Wyjście: pulsujący pierścień.
    const ex = w.map.exit.x - w.player.x, ey = w.map.exit.y - w.player.y;
    let ediff = Math.atan2(ey, ex) - yaw;
    while (ediff > Math.PI) ediff -= Math.PI * 2;
    while (ediff < -Math.PI) ediff += Math.PI * 2;
    if (Math.abs(ediff) < FOV / 2 && Math.hypot(ex, ey) < 5) {
      const sx = W / 2 + (ediff / (FOV / 2)) * (W / 2);
      g.strokeStyle = `rgba(143, 208, 180, ${0.25 + 0.2 * Math.sin(this.time * 4)})`;
      g.lineWidth = 2;
      g.beginPath(); g.arc(sx, H / 2, 40, 0, Math.PI * 2); g.stroke();
    }
  }

  private updateHud(): void {
    const w = this.world!;
    clear(this.hudEl!);
    this.hudEl!.append(
      el('div', {}, el('b', { text: `POZIOM ${this.level}/3` })),
      el('div', {}, el('span', { text: `Słuchaczy: ${w.listeners.length}` })),
      el('div', {}, el('span', { text: `Usłyszano: ${w.heard}` })),
      el('div', {}, el('span', { text: `Czas: ${w.time.toFixed(1)}s` })),
      el('div', {}, el('span', { text: `Wynik: ${this.totalScore + w.score}` })));
    clear(this.noiseEl!);
    const pct = clamp(w.noise, 0, 1);
    this.noiseEl!.append(el('span', { text: 'HAŁAS' }),
      el('div', { class: 'noise-bar' }, el('i', { style: { width: `${pct * 100}%` } })),
      el('small', { text: pct > 0.65 ? 'ZDRADZONY' : pct > 0.25 ? 'słyszalny' : 'cisza' }));
    for (const b of this.toolEl!.querySelectorAll<HTMLElement>('.tool')) {
      const key = b.dataset.tool as ToolKind;
      const count = w.tools[key];
      const label = b.querySelector('.tool__count');
      if (label) label.textContent = key === 'click' ? '∞' : String(count);
      b.classList.toggle('is-empty', count <= 0);
    }
    clear(this.compassEl!);
    const angle = w.nearestListenerAngle();
    if (angle !== null) {
      let diff = angle - w.player.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.compassEl!.append(el('span', {
        class: 'compass__arrow',
        text: Math.abs(diff) < 0.4 ? '▲ BLISKO' : diff > 0 ? '▶ PO PRAWEJ' : '◀ PO LEWEJ',
      }));
    }
    if (!this.hintEl!.childElementCount) {
      this.hintEl!.append(el('span', { text: 'Spacja = pstryknięcie · W/S = ruch · A/D = obrót · Shift = skradanie · 1–7 = narzędzia' }));
    }
  }

  private onEscape(ctx: GameContext): void {
    ctx.audio.play('success');
    this.totalScore += this.world!.score;
    if (this.level >= 3) {
      this.showEnding(ctx, true, this.totalScore, 'Trzy poziomy podziemi. Wyszedłeś, nie dając się dotknąć.');
    } else {
      this.level += 1;
      this.shell!.toast(`Wyjście znalezione. Schodzisz głębiej — poziom ${this.level}.`, 'good');
      this.startLevel(ctx, (Date.now() + this.level * 7717) % 1000000);
    }
  }

  private onCaught(ctx: GameContext): void {
    this.showEnding(ctx, false, Math.max(0, this.totalScore),
      'Słuchacz dotknął Twojego ramienia. Dźwięk, który dał Ci widzenie, zaprowadził go prosto do Ciebie.');
  }

  private showEnding(ctx: GameContext, won: boolean, score: number, summary: string): void {
    this.ended = true;
    ctx.audio.stopDrone();
    const w = this.world!;
    const overlay = el('div', { class: 'ending' },
      el('div', { class: 'ending__card' },
        el('span', { class: 'ending__kicker', text: won ? 'WYJŚCIE' : 'ZŁAPANY' }),
        el('h2', { text: won ? 'Cisza za plecami' : 'Ktoś usłyszał echo' }),
        el('p', { text: summary }),
        el('div', { class: 'ending__stats' },
          el('div', {}, el('b', { text: String(score) }), el('small', { text: 'wynik' })),
          el('div', {}, el('b', { text: String(w.heard) }), el('small', { text: 'razy usłyszany' })),
          el('div', {}, el('b', { text: `${w.time.toFixed(0)}s` }), el('small', { text: 'czas' })),
          el('div', {}, el('b', { text: `${this.level}/3` }), el('small', { text: 'poziom' }))),
        el('button', { type: 'button', class: 'btn btn--primary', text: 'Wróć do Gabinetu',
          onclick: () => this.finish(ctx, won, score, summary) })));
    this.shell!.body.append(overlay);
  }

  private finish(ctx: GameContext, won: boolean, score = 0, summary = ''): void {
    if (score > 0 || summary) ctx.onFinish({ won, score, summary });
    else ctx.onFinish({ won: false, score: 0, summary: 'Zebrano echa, przerwano wędrówkę.' });
    this.dispose();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.shell?.dispose();
    this.shell = null;
    this.world = null;
  }
}
