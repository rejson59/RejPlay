import './style.css';
import { AudioEngine } from './core/audio';
import { Store } from './core/save';
import { el, clear } from './core/dom';
import {
  GAMES, type Game, type GameId, type GameContext, type GameResult,
} from './core/types';
import { CentralaGame } from './games/centrala';
import { PasozytGame } from './games/pasozyt';
import { GluchySwiatGame } from './games/gluchy-swiat';
import { AmnezjaGame } from './games/amnezja';

const audio = new AudioEngine();
const store = new Store();
const app = document.getElementById('app')!;
const hub = el('main', { class: 'hub' });
const host = el('div', { class: 'game-host', hidden: true });
app.append(hub, host);

let current: Game | null = null;
let lastResult: { id: GameId; result: GameResult } | null = null;

const isGameId = (v: string): v is GameId => GAMES.some((g) => g.id === v);
const makeGame = (id: GameId): Game => {
  if (id === 'centrala') return new CentralaGame();
  if (id === 'pasozyt') return new PasozytGame();
  if (id === 'gluchy-swiat') return new GluchySwiatGame();
  return new AmnezjaGame();
};

function renderHub(): void {
  clear(hub);
  const bestTotal = GAMES.reduce((sum, g) => sum + (store.best(g.id)?.score ?? 0), 0);
  const header = el('header', { class: 'hub__head' },
    el('div', { class: 'brand' },
      el('span', { class: 'brand__mark', text: '✧' }),
      el('div', {}, el('b', { text: 'RejPlay' }), el('small', { text: 'Gabinet Osobliwości' }))),
    el('div', { class: 'hub__head-right' },
      el('span', { class: 'hub__meta', text: `4 gry · ${bestTotal} pkt łącznie · zero assetów` }),
      (() => {
        const b = el('button', { type: 'button', class: 'btn btn--ghost btn--sm',
          text: audio.muted ? '🔇 Dźwięk wyłączony' : '🔊 Dźwięk włączony' });
        b.addEventListener('click', () => {
          audio.setMuted(!audio.muted);
          b.textContent = audio.muted ? '🔇 Dźwięk wyłączony' : '🔊 Dźwięk włączony';
          if (!audio.muted) audio.play('ui');
        });
        return b;
      })()));

  const hero = el('section', { class: 'hero' },
    el('span', { class: 'hero__kicker', text: 'ANTOLOGIA GIER · WYDANIE I' }),
    el('h1', {}, 'Cztery światy, ', el('em', { text: 'ani jednego pliku grafiki' }), '.'),
    el('p', { class: 'hero__lead', text: 'Każda z tych gier powstała od zera: geometria, dźwięk, światło i zasady są liczone w przeglądarce. Nie ma tekstur, modeli, kont ani serwera. Wybierz pozycję z półki i wejdź do środka.' }),
    el('div', { class: 'hero__facts' },
      el('span', {}, el('b', { text: 'I' }), ' jedno pomieszczenie, dwanaście kabli'),
      el('span', {}, el('b', { text: 'II' }), ' mapa, która ma tętno'),
      el('span', {}, el('b', { text: 'III' }), ' dźwięk zamiast światła'),
      el('span', {}, el('b', { text: 'IV' }), ' obrażenia usuwają reguły')));

  const resultBanner = lastResult
    ? el('div', { class: `result-banner ${lastResult.result.won ? 'is-good' : ''}` },
      el('span', { class: 'result-banner__kicker', text: lastResult.result.won ? 'UKOŃCZONO' : 'PARTIA ZAKOŃCZONA' }),
      el('b', { text: `${GAMES.find((g) => g.id === lastResult!.id)?.title} · ${lastResult.result.score} pkt` }),
      el('p', { text: lastResult.result.summary }),
      el('button', { type: 'button', class: 'btn btn--tiny', text: 'Ukryj',
        onclick: () => { lastResult = null; renderHub(); } }))
    : null;

  const shelf = el('div', { class: 'shelf' });
  GAMES.forEach((meta, index) => {
    const best = store.best(meta.id);
    const plays = store.plays(meta.id);
    const card = el('article', { class: 'card', style: { '--accent': meta.accent } },
      el('div', { class: 'card__top' },
        el('span', { class: 'card__glyph', text: meta.glyph }),
        el('span', { class: 'card__number', text: meta.number })),
      el('span', { class: 'card__genre', text: meta.genre }),
      el('h2', { class: 'card__title', text: meta.title }),
      el('p', { class: 'card__sub', text: meta.subtitle }),
      el('p', { class: 'card__hook', text: meta.hook }),
      el('ul', { class: 'card__features' },
        ...meta.features.map((f) => el('li', { text: f }))),
      el('div', { class: 'card__foot' },
        el('div', { class: 'card__record' },
          el('b', { text: best ? String(best.score) : '—' }),
          el('small', { text: best ? 'najlepszy wynik' : 'jeszcze nie grano' }),
          el('em', { text: plays ? `${plays} ${plays === 1 ? 'partia' : 'partii'}` : '' })),
        (() => {
          const b = el('button', { type: 'button', class: 'btn btn--primary', text: 'Wejdź do gry →' });
          b.addEventListener('click', () => { audio.play('ui'); location.hash = `/${meta.id}`; });
          return b;
        })()));
    card.style.setProperty('--delay', `${index * 70}ms`);
    shelf.append(card);
  });

  const footer = el('footer', { class: 'hub__foot' },
    el('p', { text: 'Działa w całości po stronie przeglądarki: Canvas 2D, SVG, CSS i WebAudio. Postęp zapisuje się lokalnie na tym urządzeniu.' }),
    el('p', { text: 'W grze: ← wstęp w prawym górnym rogu każdej pozycji; klawisz Esc zawsze wraca na półkę.' }));

  hub.append(header, hero, ...(resultBanner ? [resultBanner] : []), shelf, footer);
}

function context(id: GameId): GameContext {
  return {
    root: host,
    audio,
    save: store,
    onFinish: (result) => {
      store.record(id, result);
      lastResult = { id, result };
      location.hash = '';
      window.setTimeout(renderHub, 0);
    },
  };
}

function route(): void {
  const id = location.hash.replace(/^#\/?/, '');
  if (current) { current.dispose(); current = null; }
  audio.stopDrone();
  if (isGameId(id)) {
    hub.hidden = true;
    host.hidden = false;
    current = makeGame(id);
    current.mount(context(id));
    document.title = `${GAMES.find((g) => g.id === id)?.title} · RejPlay`;
  } else {
    host.hidden = true;
    hub.hidden = false;
    renderHub();
    document.title = 'RejPlay · Gabinet Osobliwości';
  }
  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', route);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && location.hash) { event.preventDefault(); location.hash = ''; }
});
// Pierwszy gest odblokowuje WebAudio (polityka przeglądarek).
document.addEventListener('pointerdown', () => audio.unlock(), { once: true });

renderHub();
route();
