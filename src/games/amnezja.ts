import { Shell } from '../core/shell';
import { el, clear } from '../core/dom';
import type { Game, GameContext } from '../core/types';
import {
  ConceptWorld, CONCEPTS, CONCEPT_MAP, type ConceptId, type Verb,
} from '../logic/amnezja-engine';

export class AmnezjaGame implements Game {
  private shell: Shell | null = null;
  private world: ConceptWorld | null = null;
  private roomEl: HTMLElement | null = null;
  private conceptsEl: HTMLElement | null = null;
  private inventoryEl: HTMLElement | null = null;
  private logEl: HTMLElement | null = null;
  private modalEl: HTMLElement | null = null;
  private tradeOpen = false;
  private ended = false;

  mount(ctx: GameContext): void {
    const world = new ConceptWorld(Date.now() % 1000000);
    this.world = world;
    const shell = new Shell(ctx.root, {
      id: 'amnezja', number: 'IV', title: 'Amnezja Pojęciowa',
      subtitle: 'Surrealistyczna przygoda logiczna',
      genre: '', hook: '', features: [], accent: '#d69a9a', glyph: '✧',
    }, ctx.audio, () => this.finish(ctx, false));
    this.shell = shell;
    ctx.audio.startDrone('amnezja');
    shell.showHelp('Plaga Pojęć', [
      'Nie masz punktów zdrowia. Masz dziesięć POJĘĆ. Błąd w pojedynku z Cenzorem usuwa jedno z nich — na zawsze (chyba że je odzyskasz).',
      'Utracone pojęcie zmienia zasady: znika przycisk „Otwórz", cyfry zamieniają się w bełkot, czerwień szarzeje, imiona znikają.',
      'Świat ma zawsze alternatywną drogę: wybij okno, podważ szafę odłamkiem, przeciśnij się świetlikiem. Brak pojęcia to zagadka, nie mur.',
      'Handlarz w salonie wymienia pojęcia, ale odłamek z witrażu podważa też jego słoiki — można KRAŚĆ pojęcia. Cenzorzy oddają jedno po trafnej odpowiedzi.',
      'Cel: dotrzeć do Sali Pojęć z dowodem i wypowiedzieć swoje imię. Zakończenie zależy od tego, ile pojęć zachowałeś.',
    ]);

    const wrap = el('div', { class: 'amnezja' });
    const left = el('div', { class: 'amnezja__left' });
    const right = el('div', { class: 'amnezja__right' });
    this.roomEl = el('div', { class: 'room' });
    this.conceptsEl = el('div', { class: 'concepts' });
    this.inventoryEl = el('div', { class: 'inventory' });
    this.logEl = el('div', { class: 'concept-log', role: 'log' });
    this.modalEl = el('div', { class: 'concept-modal' });

    left.append(el('section', { class: 'panel panel--room' }, this.roomEl),
      el('section', { class: 'panel' },
        el('div', { class: 'panel__head' }, el('h3', { text: 'Kronika ubytków' })), this.logEl));
    right.append(
      el('section', { class: 'panel' },
        el('div', { class: 'panel__head' }, el('h3', { text: 'Pojęcia' }),
          el('span', { class: 'panel__hint', text: 'szare = utracone' })), this.conceptsEl),
      el('section', { class: 'panel' },
        el('div', { class: 'panel__head' }, el('h3', { text: 'Kieszenie' })), this.inventoryEl),
      this.modalEl,
      el('section', { class: 'panel' },
        el('div', { class: 'panel__head' }, el('h3', { text: 'Stan umysłu' })),
        el('div', { class: 'mind' },
          el('div', { id: 'mind-count' }), el('div', { id: 'mind-score' }))));
    wrap.append(left, right);
    shell.body.append(wrap);
    this.refresh(ctx);
    this.log('Dwór pamięta więcej niż Ty. Zacznij od westybulu.');
  }

  private log(text: string): void {
    this.logEl!.prepend(el('div', { class: 'concept-line', text }));
    while (this.logEl!.children.length > 40) this.logEl!.lastElementChild?.remove();
  }

  private applyConceptClasses(): void {
    const node = this.shell!.node;
    for (const c of CONCEPTS) node.classList.toggle(`lost-${c.id}`, !this.world!.owned.has(c.id));
  }

  private refresh(ctx: GameContext): void {
    const w = this.world!;
    this.applyConceptClasses();
    this.renderRoom(ctx);
    this.renderConcepts(ctx);
    this.renderInventory();
    this.renderModal(ctx);
    const count = document.getElementById('mind-count');
    const score = document.getElementById('mind-score');
    if (count) count.textContent = w.render(`${w.owned.size}/10 pojęć · ubytki: ${w.losses}`);
    if (score) score.textContent = w.render(`wynik: ${w.score}`);
    this.shell!.setStatus(w.render(`${w.owned.size}/10 pojęć · ${w.room.name} · wynik ${w.score}`));
  }

  private renderRoom(ctx: GameContext): void {
    const w = this.world!;
    clear(this.roomEl!);
    this.roomEl!.append(
      el('span', { class: 'room__kicker', text: w.render('DWÓR POD PLAGĄ POJĘĆ') }),
      el('h2', { class: 'room__title', text: w.render(w.room.name) }),
      el('p', { class: 'room__desc', text: w.render(w.room.desc) }));

    const exits = el('div', { class: 'room__exits' });
    for (const { dir, exit, open } of w.exits()) {
      const b = el('button', { type: 'button', class: `exit${open ? '' : ' is-locked'}` },
        el('b', { text: w.render(dir) }),
        el('small', { text: w.render(exit.label ?? exit.via) }));
      if (open) b.addEventListener('click', () => this.act(() => w.go(dir), ctx));
      else b.addEventListener('click', () => {
        ctx.audio.play('click');
        this.shell!.toast(w.render(w.go(dir).text), 'bad');
      });
      exits.append(b);
    }
    this.roomEl!.append(el('h3', { class: 'room__sub', text: w.render('Przejścia') }), exits);

    this.roomEl!.append(el('h3', { class: 'room__sub', text: w.render('W tym pokoju') }));
    const objects = el('div', { class: 'objects' });
    for (const obj of w.room.objects) {
      const card = el('div', { class: 'object' },
        el('b', { class: 'object__name', text: w.render(obj.name) }),
        el('p', { class: 'object__desc', text: w.describe(obj) }));
      const verbs = w.verbs(obj.id);
      const row = el('div', { class: 'object__verbs' });
      if (verbs.length === 0) {
        row.append(el('span', { class: 'object__void', text: w.render('…nie wiesz, co z tym zrobić') }));
      }
      for (const verb of verbs) {
        const b = el('button', { type: 'button', class: 'btn btn--tiny', text: w.render(verb.label) });
        b.addEventListener('click', () => {
          if (verb.trade) { this.tradeOpen = true; ctx.audio.play('paper'); this.renderModal(ctx); return; }
          this.act(() => w.act(obj.id, verb.id), ctx);
        });
        row.append(b);
      }
      card.append(row);
      objects.append(card);
    }
    this.roomEl!.append(objects);
  }

  private act(fn: () => { ok: boolean; text: string; ended?: boolean; won?: boolean },
    ctx: GameContext): void {
    const result = fn();
    ctx.audio.play(result.ok ? (String(result.text).includes('TRACISZ') ? 'fail' : 'paper') : 'click');
    this.log(result.text);
    this.shell!.toast(result.text, result.ok && !String(result.text).includes('TRACISZ') ? 'good' : 'bad');
    if (result.won || result.ended) {
      this.showEnding(ctx);
      return;
    }
    this.refresh(ctx);
  }

  private renderConcepts(ctx: GameContext): void {
    const w = this.world!;
    clear(this.conceptsEl!);
    for (const c of CONCEPTS) {
      const owned = w.owned.has(c.id);
      const node = el('div', { class: `concept${owned ? '' : ' is-lost'}` },
        el('span', { class: 'concept__glyph tint-red', text: c.glyph }),
        el('div', {},
          el('b', { text: owned ? w.render(c.label) : '§§§§' }),
          el('small', { text: owned ? 'posiadasz' : w.render(c.consequence) })));
      this.conceptsEl!.append(node);
    }
    void ctx;
  }

  private renderInventory(): void {
    const w = this.world!;
    clear(this.inventoryEl!);
    if (w.inventory.length === 0) {
      this.inventoryEl!.append(el('p', { class: 'empty', text: 'Puste kieszenie.' }));
      return;
    }
    for (const item of w.inventory) {
      this.inventoryEl!.append(el('span', { class: 'inv-item', text: w.render(item) }));
    }
    for (const [key, value] of Object.entries(w.flags)) {
      if (value) this.inventoryEl!.append(el('span', { class: 'inv-item is-fact', text: w.render(key) }));
    }
  }

  private renderModal(ctx: GameContext): void {
    const w = this.world!;
    clear(this.modalEl!);
    if (w.activeDuel) {
      const card = el('div', { class: 'duel' },
        el('span', { class: 'duel__kicker', text: 'POJEDYNEK Z CENZOREM' }),
        el('h3', { text: w.render(w.activeDuel.question) }),
        el('p', { class: 'duel__warn', text: 'Błędna odpowiedź usuwa wybrane pojęcie. Trafna odbiera jedno Cenzorowi.' }));
      w.activeDuel.options.forEach((option, i) => {
        const b = el('button', { type: 'button', class: 'btn btn--tiny', text: w.render(option.label) });
        b.addEventListener('click', () => {
          const res = w.answerDuel(i);
          ctx.audio.play(res.lost ? 'fail' : 'success');
          this.log(res.text);
          this.shell!.toast(res.text, res.lost ? 'bad' : 'good');
          if (res.ended) this.showEnding(ctx);
          else this.refresh(ctx);
        });
        card.append(b);
      });
      this.modalEl!.append(card);
      return;
    }
    if (this.tradeOpen) {
      const owned = CONCEPTS.filter((c) => w.owned.has(c.id));
      const lost = CONCEPTS.filter((c) => !w.owned.has(c.id));
      const card = el('div', { class: 'trade' },
        el('span', { class: 'duel__kicker', text: 'HANDLARZ POJĘCIAMI' }),
        el('h3', { text: 'Co oddasz, co zabierzesz?' }),
        el('p', { text: 'Wymiana jest ostateczna. Możesz odzyskać „imiona" tylko, jeśli masz jeszcze coś do oddania.' }));
      if (lost.length === 0 || owned.length <= 3) {
        card.append(el('p', { class: 'empty', text: 'Handlarz kręci głową: nic nie może Ci dziś zaoferować.' }));
      } else {
        const give = el('select', { class: 'field' }) as HTMLSelectElement;
        const take = el('select', { class: 'field' }) as HTMLSelectElement;
        for (const c of owned) give.append(el('option', { value: c.id, text: c.label }));
        for (const c of lost) take.append(el('option', { value: c.id, text: c.label }));
        const b = el('button', { type: 'button', class: 'btn btn--tiny btn--primary', text: 'Dokonaj wymiany' });
        b.addEventListener('click', () => {
          const res = w.trade(give.value as ConceptId, take.value as ConceptId);
          ctx.audio.play(res.ok ? 'paper' : 'click');
          this.log(res.text);
          this.shell!.toast(res.text, res.ok ? 'good' : 'bad');
          this.tradeOpen = false;
          this.refresh(ctx);
        });
        card.append(el('label', {}, 'Oddaj', give), el('label', {}, 'Odbierz', take), b);
      }
      const close = el('button', { type: 'button', class: 'btn btn--tiny', text: 'Odstęp' });
      close.addEventListener('click', () => { this.tradeOpen = false; this.renderModal(ctx); });
      card.append(close);
      this.modalEl!.append(card);
    }
  }

  private showEnding(ctx: GameContext): void {
    if (this.ended) return;
    this.ended = true;
    const w = this.world!;
    ctx.audio.play(w.won ? 'success' : 'fail');
    ctx.audio.stopDrone();
    const overlay = el('div', { class: 'ending' },
      el('div', { class: 'ending__card' },
        el('span', { class: 'ending__kicker', text: w.won ? 'KONIEC PLAGI' : 'ROZPAD UMYSŁU' }),
        el('h2', { text: w.won ? (w.flags.pelne ? 'Wypowiedziano imię' : 'Wyszedłeś bez imienia')
          : 'Dwór zapomniał pierwszy' }),
        el('p', { text: w.endingText || 'Zabrakło pojęć, by opisać choćby jedno pomieszczenie.' }),
        el('div', { class: 'ending__stats' },
          el('div', {}, el('b', { text: String(w.score) }), el('small', { text: 'wynik' })),
          el('div', {}, el('b', { text: `${w.owned.size}/10` }), el('small', { text: 'pojęć' })),
          el('div', {}, el('b', { text: String(w.losses) }), el('small', { text: 'ubytki' })),
          el('div', {}, el('b', { text: String(w.duelsWon) }), el('small', { text: 'pojedynki' }))),
        el('p', { class: 'ending__truth', text: 'Pozostałe pojęcia: '
          + (w.owned.size ? CONCEPTS.filter((c) => w.owned.has(c.id)).map((c) => c.label).join(', ') : 'żadne') + '.' }),
        el('button', { type: 'button', class: 'btn btn--primary', text: 'Wróć do Gabinetu',
          onclick: () => this.finish(ctx, w.won, w.score, w.endingText) })));
    this.shell!.body.append(overlay);
  }

  private finish(ctx: GameContext, won: boolean, score = 0, summary = ''): void {
    if (score > 0 || summary) ctx.onFinish({ won, score, summary });
    else ctx.onFinish({ won: false, score: 0, summary: 'Przerwano wędrówkę po dworze.' });
    this.dispose();
  }

  dispose(): void {
    this.shell?.dispose();
    this.shell = null;
    this.world = null;
  }
}
