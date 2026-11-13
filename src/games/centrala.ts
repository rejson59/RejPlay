import { Shell } from '../core/shell';
import { el, clear, $, svg, bar } from '../core/dom';
import { clamp } from '../core/random';
import type { Game, GameContext } from '../core/types';
import {
  Switchboard, SYSTEM_LABELS, type Call, type SystemKey, type NightEvent,
} from '../logic/centrala-engine';

const JACK_POS: { id: string; x: number; y: number }[] = [
  { id: 'recepcja', x: 60, y: 62 }, { id: 'policja', x: 160, y: 62 },
  { id: 'kuchnia', x: 260, y: 62 }, { id: 'arden', x: 360, y: 62 },
  { id: 'rozanska', x: 460, y: 62 }, { id: 'szeliga', x: 560, y: 62 },
  { id: 'moss', x: 60, y: 196 }, { id: 'lili', x: 160, y: 196 },
  { id: 'konsul', x: 260, y: 196 }, { id: 'biblioteka', x: 360, y: 196 },
  { id: 'garaz', x: 460, y: 196 }, { id: 'wieza', x: 560, y: 196 },
];

export class CentralaGame implements Game {
  private shell: Shell | null = null;
  private board: Switchboard | null = null;
  private timer = 0;
  private raf = 0;
  private lastAt = 0;
  private paused = false;
  private selected: string | null = null;
  private dragFrom: string | null = null;
  private cables: { a: string; b: string }[] = [];
  private boardSvg: SVGSVGElement | null = null;
  private clockEl: HTMLElement | null = null;
  private actEl: HTMLElement | null = null;
  private suspicionEl: HTMLElement | null = null;
  private linesEl: HTMLElement | null = null;
  private notesEl: HTMLElement | null = null;
  private tapesEl: HTMLElement | null = null;
  private logEl: HTMLElement | null = null;
  private wiretapBtn: HTMLButtonElement | null = null;
  private systemEls: Partial<Record<SystemKey, HTMLElement>> = {};
  private reportEl: HTMLElement | null = null;
  private lastLineSignature = '';
  private lastNotes = -1;
  private lastTapes = -1;
  private lastCableSignature = '';
  private ended = false;

  mount(ctx: GameContext): void {
    const seed = Date.now() % 1000000;
    this.board = new Switchboard(seed);
    const shell = new Shell(ctx.root, {
      id: 'centrala', number: 'I', title: 'Centrala', subtitle: 'Analogowy thriller szpiegowski',
      genre: '', hook: '', features: [], accent: '#d9a441', glyph: '⌁',
    }, ctx.audio, () => this.finish(ctx, false));
    this.shell = shell;
    ctx.audio.startDrone('centrala');
    shell.showHelp('Nocny dyżur', [
      'Dzwoniący abonent ma pulsującą lampkę. Kliknij dwa gniazda (albo przeciągnij między nimi kabel), by odebrać rozmowę. Możesz też zmostkować DOWOLNĄ parę — wtedy wymuszasz nową rozmowę, np. sprawcę z policją albo z kolejną ofiarą.',
      'Podsłuch musi być WŁĄCZONY, żeby czytać zdania i zbierać tropy. Każde przełączenie dźwigni może zostawić słyszalny klik.',
      'Nagrywaj aktywne rozmowy na szpulę, montuj dwie taśmy i puszczaj je wybranym gościom, by zmienić bieg nocy.',
      'Wyłącz windę albo prąd na III piętrze, by uratować drugą ofiarę. Uważaj na podejrzenia: 100% kończy dyżur.',
      'O świcie (lub wcześniej, przyciskiem „Złóż raport") wskaż sprawcę, motyw i dowód.',
    ]);

    const wrap = el('div', { class: 'centrala' });
    const left = el('div', { class: 'centrala__left' });
    const right = el('div', { class: 'centrala__right' });

    // ---------- tablica rozdzielcza
    this.boardSvg = svg('svg', {
      class: 'switchboard', viewBox: '0 0 620 268', 'aria-label': 'Tablica rozdzielcza z dwunastoma gniazdami',
    });
    this.renderBoard();
    const boardPanel = el('section', { class: 'panel panel--board' },
      el('div', { class: 'panel__head' },
        el('h3', { text: 'Tablica · 12 abonentów' }),
        el('span', { class: 'panel__hint', text: 'kliknij dwa gniazda lub przeciągnij kabel' })),
      this.boardSvg);
    this.attachBoardPointer(ctx);

    // ---------- teleprinter
    this.logEl = el('div', { class: 'teleprinter', role: 'log', 'aria-live': 'polite' });
    const logPanel = el('section', { class: 'panel panel--log' },
      el('div', { class: 'panel__head' }, el('h3', { text: 'Dziennik linii' }),
        el('span', { class: 'panel__hint', text: 'wszystko, co słyszysz' })),
      this.logEl);
    left.append(boardPanel, logPanel);

    // ---------- pasek stanu
    this.clockEl = el('b', { class: 'clock__time', text: '22:00' });
    this.actEl = el('span', { class: 'clock__act', text: 'Akt I' });
    this.suspicionEl = el('div', { class: 'suspicion' });
    const pauseBtn = el('button', { type: 'button', class: 'btn btn--tiny', text: '⏸ Pauza' });
    pauseBtn.addEventListener('click', () => {
      this.paused = !this.paused;
      pauseBtn.textContent = this.paused ? '▶ Wznów' : '⏸ Pauza';
      ctx.audio.play('ui');
    });
    const clockPanel = el('section', { class: 'panel panel--clock' },
      el('div', { class: 'clock' }, this.clockEl, this.actEl, pauseBtn),
      el('div', { class: 'suspicion__label' }, el('span', { text: 'Podejrzenia' }),
        el('b', { id: 'susp-value', text: '6%' })),
      this.suspicionEl);

    // ---------- dźwignia podsłuchu
    this.wiretapBtn = el('button', {
      type: 'button', class: 'lever', 'aria-pressed': 'false',
      'aria-label': 'Dźwignia podsłuchu',
    }, el('span', { class: 'lever__knob' }), el('span', { class: 'lever__text', text: 'PODSŁUCH · WYŁ.' }));
    this.wiretapBtn.addEventListener('click', () => {
      const res = this.board!.setWiretap(!this.board!.state.wiretap);
      ctx.audio.play(res.clicked ? 'relay' : 'click');
      shell.toast(res.text, res.clicked ? 'bad' : 'info');
      this.syncWiretap();
    });

    // ---------- systemy hotelu
    const systems = el('div', { class: 'systems' });
    for (const key of Object.keys(SYSTEM_LABELS) as SystemKey[]) {
      const button = el('button', { type: 'button', class: 'system is-on' },
        el('span', { class: 'system__lamp' }),
        el('span', { text: SYSTEM_LABELS[key] }),
        el('b', { text: 'WŁ.' }));
      button.addEventListener('click', () => {
        const res = this.board!.toggleSystem(key);
        ctx.audio.play('relay');
        shell.toast(res.text);
        this.syncSystems();
      });
      this.systemEls[key] = button;
      systems.append(button);
    }

    // ---------- linie
    this.linesEl = el('div', { class: 'lines' });
    const linesPanel = el('section', { class: 'panel' },
      el('div', { class: 'panel__head' }, el('h3', { text: 'Linie' }),
        el('span', { class: 'panel__hint', text: 'dzwoni / na linii' })),
      this.linesEl);

    // ---------- nagrania
    this.tapesEl = el('div', { class: 'tapes' });
    const tapesPanel = el('section', { class: 'panel' },
      el('div', { class: 'panel__head' }, el('h3', { text: 'Magnetofon szpulowy' }),
        el('span', { class: 'panel__hint', text: 'nagraj · zmontuj · puść' })),
      this.tapesEl);

    // ---------- notes
    this.notesEl = el('div', { class: 'notes' });
    const notesPanel = el('section', { class: 'panel' },
      el('div', { class: 'panel__head' }, el('h3', { text: 'Notes operatora' })),
      this.notesEl);

    // ---------- raport
    this.reportEl = el('div', { class: 'report' });
    const reportPanel = el('section', { class: 'panel panel--report' },
      el('div', { class: 'panel__head' }, el('h3', { text: 'Raport dla sierż. Krefta' }),
        el('span', { class: 'panel__hint', text: 'możesz złożyć w każdej chwili' })),
      this.reportEl);

    right.append(clockPanel, this.wiretapBtn,
      el('section', { class: 'panel' },
        el('div', { class: 'panel__head' }, el('h3', { text: 'Systemy hotelu' })), systems),
      linesPanel, tapesPanel, notesPanel, reportPanel);

    wrap.append(left, right);
    shell.body.append(wrap);
    this.buildReport(ctx);
    this.syncWiretap();
    this.syncSystems();
    this.refresh(true, ctx);
    shell.setStatus(`Noc ${this.board.timeLabel} · sprawca ukryty wśród 12 gniazd`);

    // Jeden rAF napędza czas i odświeżanie co ~200 ms.
    this.lastAt = performance.now();
    let acc = 0;
    const loop = (now: number): void => {
      const dt = Math.min(0.25, (now - this.lastAt) / 1000);
      this.lastAt = now;
      if (!this.paused && !this.ended) {
        const events = this.board!.tick(dt);
        this.handleEvents(events, ctx);
        acc += dt;
        if (acc > 0.22) { acc = 0; this.refresh(false, ctx); }
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    shell.onCleanup(() => cancelAnimationFrame(this.raf));
    this.timer = window.setInterval(() => { if (!this.paused) ctx.audio.play('tape', { gain: 0.12 }); }, 9000);
    shell.onCleanup(() => window.clearInterval(this.timer));
  }

  // ------------------------------------------------------------- tablica SVG
  private renderBoard(): void {
    const boardSvg = this.boardSvg;
    if (!boardSvg) return;
    clear(boardSvg);
    boardSvg.append(svg('rect', { x: 0, y: 0, width: 620, height: 268, rx: 10, class: 'switchboard__case' }));
    boardSvg.append(svg('text', { x: 310, y: 24, class: 'switchboard__stamp', 'text-anchor': 'middle' }));
    boardSvg.lastChild!.textContent = 'HOTEL ALPENROSE · CENTRALA · NOC';
    // Kable aktywnych połączeń.
    for (const cable of this.cables) {
      const a = JACK_POS.find((p) => p.id === cable.a), b = JACK_POS.find((p) => p.id === cable.b);
      if (!a || !b) continue;
      const mid = (a.y + b.y) / 2 + (a.y === b.y ? 42 : 0);
      boardSvg.append(svg('path', {
        class: 'switchboard__cable',
        d: `M ${a.x} ${a.y} C ${a.x} ${mid}, ${b.x} ${mid}, ${b.x} ${b.y}`,
      }));
    }
    if (this.dragFrom) {
      const a = JACK_POS.find((p) => p.id === this.dragFrom);
      if (a) boardSvg.append(svg('path', {
        class: 'switchboard__cable is-drag',
        d: `M ${a.x} ${a.y} q 30 60 0 90`,
      }));
    }
    for (const pos of JACK_POS) {
      const jack = this.board!.jack(pos.id);
      const ringing = this.board!.calls.some((c) => c.state === 'ringing' && (c.from === pos.id || c.to === pos.id));
      const live = this.board!.calls.some((c) => c.state === 'live' && (c.from === pos.id || c.to === pos.id));
      const g = svg('g', {
        class: `jack${ringing ? ' is-ringing' : ''}${live ? ' is-live' : ''}`
          + `${this.selected === pos.id ? ' is-selected' : ''}`,
        'data-jack': pos.id, tabindex: '0', role: 'button',
        'aria-label': jack?.name ?? pos.id,
      });
      g.append(svg('circle', { cx: pos.x, cy: pos.y, r: 17, class: 'jack__ring' }));
      g.append(svg('circle', { cx: pos.x, cy: pos.y, r: 9, class: 'jack__hole' }));
      g.append(svg('circle', { cx: pos.x, cy: pos.y - 26, r: 3.5, class: 'jack__lamp' }));
      const label = svg('text', {
        x: pos.x, y: pos.y + 34, class: 'jack__label', 'text-anchor': 'middle',
      });
      label.textContent = (jack?.name ?? pos.id).split(' · ')[0];
      g.append(label);
      const room = svg('text', {
        x: pos.x, y: pos.y + 46, class: 'jack__room', 'text-anchor': 'middle',
      });
      room.textContent = jack?.room ?? '';
      g.append(room);
      boardSvg.append(g);
    }
  }

  private attachBoardPointer(ctx: GameContext): void {
    const boardSvg = this.boardSvg!;
    const jackAt = (target: EventTarget | null): string | null => {
      if (!(target instanceof Element)) return null;
      const g = target.closest('[data-jack]');
      return g ? g.getAttribute('data-jack') : null;
    };
    boardSvg.addEventListener('pointerdown', (event) => {
      const id = jackAt(event.target);
      if (!id) return;
      this.dragFrom = id;
      ctx.audio.play('click');
      this.renderBoard();
    });
    boardSvg.addEventListener('pointerup', (event) => {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const id = jackAt(target);
      const from = this.dragFrom;
      this.dragFrom = null;
      if (from && id && id !== from) {
        this.doConnect(from, id, ctx);
        this.selected = null;
      } else if (from && (!id || id === from)) {
        // Zwykłe kliknięcie: pierwsze wybiera gniazdo, drugie przepina kabel.
        if (this.selected && this.selected !== from) this.doConnect(this.selected, from, ctx);
        this.selected = this.selected === from ? null : from;
      }
      this.renderBoard();
    });
    boardSvg.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const id = jackAt(event.target);
      if (!id) return;
      event.preventDefault();
      if (this.selected && this.selected !== id) { this.doConnect(this.selected, id, ctx); this.selected = null; }
      else this.selected = id;
      this.renderBoard();
    });
  }

  private doConnect(a: string, b: string, ctx: GameContext): void {
    const res = this.board!.connect(a, b);
    ctx.audio.play(res.ok ? 'relay' : 'click');
    this.shell!.toast(res.text, res.ok ? 'good' : 'bad');
    if (res.ok) {
      this.cables.push({ a, b });
      const call = this.board!.calls.find((c) => c.state === 'live' && (
        (c.from === a && c.to === b) || (c.from === b && c.to === a)));
      if (call) this.lastLineSignature = '';
    }
    this.lastCableSignature = '';
    this.renderBoard();
    this.refresh(true, ctx);
  }

  // ------------------------------------------------------------- panele
  private handleEvents(events: NightEvent[], ctx: GameContext): void {
    if (!this.logEl) return;
    for (const e of events) {
      const line = el('div', { class: `tp-line tp-line--${e.kind}` },
        el('span', { class: 'tp-line__time', text: this.board!.timeLabel }),
        el('span', { text: e.text }));
      this.logEl.prepend(line);
      while (this.logEl.children.length > 90) this.logEl.lastElementChild?.remove();
      if (e.kind === 'ring') ctx.audio.play('bell');
      else if (e.kind === 'click') ctx.audio.play('relay');
      else if (e.kind === 'clue') ctx.audio.play('paper');
      else if (e.kind === 'murder') ctx.audio.play('fail');
      else if (e.kind === 'saved') ctx.audio.play('success');
      else if (e.kind === 'line') ctx.audio.play('dial', { gain: 0.4 });
      else if (e.kind === 'gameover') {
        ctx.audio.play('bell');
        this.shell!.toast(e.text, 'info');
        this.showDawn(ctx);
      }
    }
  }

  private syncWiretap(): void {
    const on = this.board!.state.wiretap;
    this.wiretapBtn!.classList.toggle('is-on', on);
    this.wiretapBtn!.setAttribute('aria-pressed', String(on));
    $('.lever__text', this.wiretapBtn!).textContent = on ? 'PODSŁUCH · WŁ.' : 'PODSŁUCH · WYŁ.';
  }

  private syncSystems(): void {
    for (const [key, node] of Object.entries(this.systemEls)) {
      const on = this.board!.state.systems[key as SystemKey];
      node?.classList.toggle('is-on', on);
      const b = node?.querySelector('b');
      if (b) b.textContent = on ? 'WŁ.' : 'WYŁ.';
    }
  }

  private refresh(force: boolean, ctx: GameContext): void {
    const b = this.board!;
    this.clockEl!.textContent = b.timeLabel;
    this.actEl!.textContent = `Akt ${['I', 'I', 'II', 'III'][b.act]}`;
    clear(this.suspicionEl!);
    this.suspicionEl!.append(bar(b.state.suspicion, 100,
      b.state.suspicion > 70 ? '#e08070' : b.state.suspicion > 40 ? '#d9a441' : '#8fbfa8'));
    const sv = document.getElementById('susp-value');
    if (sv) sv.textContent = `${Math.round(b.state.suspicion)}%`;
    this.shell!.setStatus(`${b.timeLabel} · akt ${b.act} · szpul ${b.state.tapes.length} · tropów ${b.state.clues.length}`);

    const lineSig = b.calls.filter((c) => c.state === 'ringing' || c.state === 'live')
      .map((c) => `${c.id}:${c.state}:${c.revealed}`).join('|');
    if (force || lineSig !== this.lastLineSignature) {
      this.lastLineSignature = lineSig;
      this.renderLines(ctx);
    }
    if (force || b.state.clues.length !== this.lastNotes) {
      this.lastNotes = b.state.clues.length;
      clear(this.notesEl!);
      if (b.state.clues.length === 0) this.notesEl!.append(el('p', { class: 'empty', text: 'Jeszcze nic. Włącz podsłuch i odbierz rozmowę.' }));
      for (const clue of b.state.clues) this.notesEl!.append(el('div', { class: 'note', text: clue }));
    }
    if (force || b.state.tapes.length !== this.lastTapes) {
      this.lastTapes = b.state.tapes.length;
      this.renderTapes(ctx);
    }
    const cableSig = this.cables.map((c) => `${c.a}-${c.b}`).join('|');
    if (force || cableSig !== this.lastCableSignature) {
      this.lastCableSignature = cableSig;
      this.renderBoard();
    }
  }

  private renderLines(ctx: GameContext): void {
    const b = this.board!;
    clear(this.linesEl!);
    const relevant = b.calls.filter((c) => c.state === 'ringing' || c.state === 'live');
    if (relevant.length === 0) {
      this.linesEl!.append(el('p', { class: 'empty', text: 'Cisza na linii. Czekaj na dzwonek — albo sam połącz dwa gniazda.' }));
    }
    for (const call of relevant) {
      const from = b.jack(call.from)?.name ?? call.from;
      const to = b.jack(call.to)?.name ?? call.to;
      const card = el('div', { class: `line ${call.state === 'ringing' ? 'is-ringing' : 'is-live'}` },
        el('div', { class: 'line__head' },
          el('b', { text: call.tag }),
          el('span', { text: call.state === 'ringing' ? 'DZWONI' : `${call.revealed}/${call.lines.length} zdań` })),
        el('small', { text: `${from}  ⇄  ${to}` }));
      if (call.state === 'ringing') {
        const connect = el('button', { type: 'button', class: 'btn btn--tiny btn--primary', text: 'Przepnij kable' });
        connect.addEventListener('click', () => this.doConnect(call.from, call.to, ctx));
        card.append(connect);
      } else {
        const read = el('div', { class: 'line__text' });
        for (let i = 0; i < call.revealed; i += 1) {
          const line = call.lines[i];
          read.append(el('p', { text: b.state.wiretap
            ? `${line.who}: „${line.text}"` : `${line.who}: «szum — włącz podsłuch»` }));
        }
        card.append(read);
        const row = el('div', { class: 'line__actions' });
        const cut = el('button', { type: 'button', class: 'btn btn--tiny', text: 'Rozłącz' });
        cut.addEventListener('click', () => {
          const res = b.disconnect(call.id);
          ctx.audio.play('relay');
          this.shell!.toast(res.text, 'bad');
          this.cables = this.cables.filter((c) => !(
            (c.a === call.from && c.b === call.to) || (c.a === call.to && c.b === call.from)));
          this.lastLineSignature = ''; this.lastCableSignature = '';
          this.refresh(true, ctx);
        });
        const rec = el('button', { type: 'button', class: 'btn btn--tiny', text: '● Nagraj szpulę' });
        rec.addEventListener('click', () => {
          const res = b.record(call.id);
          ctx.audio.play('tape');
          this.shell!.toast(res.text, res.ok ? 'good' : 'bad');
          this.lastTapes = -1;
          this.refresh(false, ctx);
        });
        row.append(cut, rec);
        card.append(row);
      }
      this.linesEl!.append(card);
    }
  }

  private renderTapes(ctx: GameContext): void {
    const b = this.board!;
    clear(this.tapesEl!);
    if (b.state.tapes.length === 0) {
      this.tapesEl!.append(el('p', { class: 'empty', text: 'Brak szpul. Nagraj aktywną rozmowę przyciskiem „● Nagraj szpulę".' }));
      return;
    }
    const list = el('div', { class: 'tape-list' });
    for (const tape of b.state.tapes) {
      const item = el('div', { class: 'tape' },
        el('div', { class: 'tape__reel' }, el('i'), el('i')),
        el('div', {}, el('b', { text: tape.label }),
          el('small', { text: tape.lines.map((l) => l.split(':')[0]).join(' · ') })));
      list.append(item);
    }
    this.tapesEl!.append(list);

    if (b.state.tapes.length >= 2) {
      const aSel = el('select', { class: 'field', 'aria-label': 'Szpula A' }) as HTMLSelectElement;
      const bSel = el('select', { class: 'field', 'aria-label': 'Szpula B' }) as HTMLSelectElement;
      for (const tape of b.state.tapes) {
        aSel.append(el('option', { value: tape.id, text: tape.label }));
        bSel.append(el('option', { value: tape.id, text: tape.label }));
      }
      if (bSel.options.length > 1) bSel.selectedIndex = 1;
      const cutA = el('input', { type: 'range', min: 0, max: 4, value: 1, class: 'field' }) as HTMLInputElement;
      const cutB = el('input', { type: 'range', min: 0, max: 4, value: 1, class: 'field' }) as HTMLInputElement;
      const spliceBtn = el('button', { type: 'button', class: 'btn btn--tiny', text: '✂ Zmontuj A + B' });
      spliceBtn.addEventListener('click', () => {
        const res = b.splice(aSel.value, bSel.value, Number(cutA.value), Number(cutB.value));
        ctx.audio.play('tape');
        this.shell!.toast(res.text, res.ok ? 'good' : 'bad');
        this.lastTapes = -1;
        this.refresh(false, ctx);
      });
      this.tapesEl!.append(el('div', { class: 'tape-editor' },
        el('label', {}, 'Szpula A', aSel), el('label', {}, 'Szpula B', bSel),
        el('label', {}, 'Cięcie A', cutA), el('label', {}, 'Cięcie B', cutB), spliceBtn));
    }

    const tapeSel = el('select', { class: 'field', 'aria-label': 'Taśma do odtworzenia' }) as HTMLSelectElement;
    for (const tape of b.state.tapes) tapeSel.append(el('option', { value: tape.id, text: tape.label }));
    const jackSel = el('select', { class: 'field', 'aria-label': 'Odbiorca taśmy' }) as HTMLSelectElement;
    for (const jack of b.mystery.jacks) jackSel.append(el('option', { value: jack.id, text: jack.name }));
    const playBtn = el('button', { type: 'button', class: 'btn btn--tiny btn--primary', text: '▶ Puść gościowi' });
    playBtn.addEventListener('click', () => {
      const res = b.playTape(tapeSel.value, jackSel.value);
      ctx.audio.play(res.ok ? 'tape' : 'click');
      this.shell!.toast(res.text, res.ok ? 'good' : 'bad');
      this.refresh(true, ctx);
    });
    this.tapesEl!.append(el('div', { class: 'tape-editor' },
      el('label', {}, 'Taśma', tapeSel), el('label', {}, 'Gniazdo', jackSel), playBtn));
  }

  private buildReport(ctx: GameContext): void {
    const b = this.board!;
    clear(this.reportEl!);
    const suspects = b.mystery.jacks.filter((j) => !['police', 'staff'].includes(j.role));
    const killer = el('select', { class: 'field', 'aria-label': 'Sprawca' }) as HTMLSelectElement;
    for (const j of suspects) killer.append(el('option', { value: j.id, text: j.name }));
    const motive = el('select', { class: 'field', 'aria-label': 'Motyw' }) as HTMLSelectElement;
    for (const m of b.mystery.motives) motive.append(el('option', { value: m, text: m }));
    const evidence = el('select', { class: 'field', 'aria-label': 'Dowód' }) as HTMLSelectElement;
    for (const e of b.mystery.evidences) evidence.append(el('option', { value: e, text: e }));
    const submit = el('button', { type: 'button', class: 'btn btn--primary', text: 'Złóż raport i zakończ noc' });
    submit.addEventListener('click', () => {
      const result = b.accuse(killer.value, motive.value, evidence.value);
      this.paused = true;
      this.ended = true;
      ctx.audio.play(result.correct ? 'success' : 'fail');
      this.showResult(ctx, result.correct, result.score, result.summary);
    });
    this.reportEl!.append(
      el('label', {}, 'Sprawca', killer),
      el('label', {}, 'Motyw', motive),
      el('label', {}, 'Dowód rzeczowy', evidence),
      submit,
      el('p', { class: 'report__hint', text: `Tropów w notesie: 0 · im mniej klików, tym wyższa nota.` }));
  }

  private showDawn(ctx: GameContext): void {
    if (this.ended) return;
    this.paused = true;
    // Świt bez raportu: traktujemy jako pusty raport, ale bez kary za błąd.
    const b = this.board!;
    const result = b.accuse('', '', '');
    this.showResult(ctx, false, Math.max(0, result.score - 20),
      'Świt zastał Cię bez raportu. ' + result.summary);
  }

  private showResult(ctx: GameContext, won: boolean, score: number, summary: string): void {
    this.ended = true;
    ctx.audio.stopDrone();
    const b = this.board!;
    const overlay = el('div', { class: 'ending' },
      el('div', { class: 'ending__card' },
        el('span', { class: 'ending__kicker', text: won ? 'RAPORT PRZYJĘTY' : 'NOC ZAKOŃCZONA' }),
        el('h2', { text: won ? 'Sprawa zamknięta' : 'Akta pozostają otwarte' }),
        el('p', { text: summary }),
        el('div', { class: 'ending__stats' },
          el('div', {}, el('b', { text: String(score) }), el('small', { text: 'punkty' })),
          el('div', {}, el('b', { text: String(b.state.clues.length) }), el('small', { text: 'tropy' })),
          el('div', {}, el('b', { text: `${Math.round(b.state.suspicion)}%` }), el('small', { text: 'podejrzenia' })),
          el('div', {}, el('b', { text: b.jack(b.mystery.secondVictimId)?.alive === false ? 'zginęła' : 'przeżyła' }),
            el('small', { text: 'druga ofiara' }))),
        el('p', { class: 'ending__truth', text: `Sprawca: ${b.jack(b.mystery.killerId)?.name}. ` +
          `Motyw: ${b.mystery.motive}. Dowód: ${b.mystery.evidence}.` }),
        el('button', { type: 'button', class: 'btn btn--primary', text: 'Wróć do Gabinetu',
          onclick: () => this.finish(ctx, won, score, summary) })));
    this.shell!.body.append(overlay);
  }

  private finish(ctx: GameContext, won: boolean, score = 0, summary = ''): void {
    if (!this.ended && this.board && score === 0) {
      ctx.onFinish({ won: false, score: 0, summary: 'Dyżur przerwany.' });
    } else if (score > 0 || summary) {
      ctx.onFinish({ won, score, summary });
    }
    this.dispose();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.clearInterval(this.timer);
    this.shell?.dispose();
    this.shell = null;
    this.board = null;
  }
}
