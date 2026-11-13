/**
 * Smoke-test całej warstwy UI w jsdom (bez przeglądarki, bez plików assetów).
 *
 * Celem nie jest sprawdzanie pikseli, lecz wyłapanie błędów wykonania:
 * każda gra musi się zamontować, przeliczyć kilka klatek, przyjąć wejście,
 * wyrenderować panele i oddać wynik bez wyjątku.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

type Any = any;

function fakeContext(): Any {
  return new Proxy({}, {
    get: () => () => {},
    set: () => true,
  });
}

function setup(): { dom: JSDOM; w: Any; doc: Any; tick: (n?: number) => void } {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: 'https://gabinet.test/', pretendToBeVisual: true,
  });
  const w = dom.window as Any;
  const doc = w.document as Any;
  const g = globalThis as Any;

  g.window = w;
  g.document = doc;
  g.localStorage = w.localStorage;
  g.Node = w.Node;
  g.Element = w.Element;
  g.HTMLElement = w.HTMLElement;
  g.SVGElement = w.SVGElement;
  g.MouseEvent = w.MouseEvent;
  g.KeyboardEvent = w.KeyboardEvent;
  g.Event = w.Event;
  Object.defineProperty(g, 'location', {
    value: w.location, configurable: true, writable: true,
  });
  Object.defineProperty(g, 'navigator', {
    value: w.navigator, configurable: true,
  });

  // Timery i rAF pod pełną kontrolą testu — żadnego żywego procesu po teście.
  w.setInterval = () => 0;
  w.clearInterval = () => {};
  w.setTimeout = () => 0;
  w.clearTimeout = () => {};
  w.scrollTo = () => {};
  delete w.AudioContext;
  delete w.webkitAudioContext;
  w.HTMLCanvasElement.prototype.getContext = () => fakeContext();
  w.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 960, bottom: 600, width: 960, height: 600, x: 0, y: 0,
  });
  w.Element.prototype.scrollIntoView = () => {};
  doc.elementFromPoint = () => null;

  const pending = new Map<number, Any>();
  let nextId = 1;
  let now = 1000;
  g.requestAnimationFrame = (cb: Any): number => {
    const id = nextId;
    nextId += 1;
    pending.set(id, cb);
    return id;
  };
  g.cancelAnimationFrame = (id: number): void => { pending.delete(id); };
  const tick = (n = 3): void => {
    for (let i = 0; i < n; i += 1) {
      const batch = [...pending.values()];
      pending.clear();
      now += 16;
      for (const cb of batch) cb(now);
    }
  };
  return { dom, w, doc, tick };
}

const click = (w: Any, node: Any): void => {
  assert.ok(node, 'oczekiwano elementu do kliknięcia');
  node.dispatchEvent(new w.MouseEvent('click', { bubbles: true, clientX: 40, clientY: 40 }));
};

test('UI: Centrala montuje tablicę, przyjmuje przepięcia i składa raport', async () => {
  const { w, doc, tick } = setup();
  const { AudioEngine } = await import('../src/core/audio');
  const { Store } = await import('../src/core/save');
  const { CentralaGame } = await import('../src/games/centrala');
  const root = doc.createElement('div');
  doc.body.append(root);
  let finished = 0;
  const game = new CentralaGame();
  game.mount({ root, audio: new AudioEngine(), save: new Store(), onFinish: () => { finished += 1; } });

  assert.equal(doc.querySelectorAll('.jack').length, 12);
  assert.equal(doc.querySelectorAll('.system').length, 4);
  assert.ok(doc.querySelector('.teleprinter'));
  // Przeciągnięcie kabla między gniazdami (pointerdown + pointerup).
  const jack = doc.querySelector('.jack');
  jack.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
  jack.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
  click(w, doc.querySelector('.lever'));
  click(w, doc.querySelector('.system'));
  tick(4);
  assert.ok(doc.querySelector('.game-bar__status').textContent.length > 0);
  click(w, doc.querySelector('.panel--report .btn--primary'));
  assert.ok(doc.querySelector('.ending'), 'po raporcie pojawia się zakończenie');
  click(w, doc.querySelector('.ending .btn--primary'));
  assert.equal(finished, 1);
  assert.equal(doc.querySelectorAll('.game-shell').length, 0, 'dispose sprząta widok');
  game.dispose();
});

test('UI: Pasożyt rysuje tkankę, buduje i pokazuje bilans', async () => {
  const { w, doc, tick } = setup();
  const { AudioEngine } = await import('../src/core/audio');
  const { Store } = await import('../src/core/save');
  const { PasozytGame } = await import('../src/games/pasozyt');
  const root = doc.createElement('div');
  doc.body.append(root);
  const game = new PasozytGame();
  game.mount({ root, audio: new AudioEngine(), save: new Store(), onFinish: () => {} });
  assert.equal(doc.querySelectorAll('.palette__item').length, 8);
  assert.equal(doc.querySelectorAll('.res').length, 5);
  click(w, doc.querySelector('.palette__item:nth-child(2)'));
  click(w, doc.querySelector('.tissue'));
  tick(3);
  assert.ok(doc.querySelector('.sim-stats').textContent.includes('cykl'));
  assert.ok(doc.querySelector('.host__note').textContent.length > 10);
  game.dispose();
});

test('UI: Głuchy Świat startuje w ciemności i reaguje na pstryknięcie', async () => {
  const { w, doc, tick } = setup();
  const { AudioEngine } = await import('../src/core/audio');
  const { Store } = await import('../src/core/save');
  const { GluchySwiatGame } = await import('../src/games/gluchy-swiat');
  const root = doc.createElement('div');
  doc.body.append(root);
  const game = new GluchySwiatGame();
  game.mount({ root, audio: new AudioEngine(), save: new Store(), onFinish: () => {} });
  assert.equal(doc.querySelectorAll('.tool').length, 7);
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { code: 'Digit4', bubbles: true }));
  click(w, doc.querySelector('.deaf__canvas'));
  tick(4);
  assert.ok(doc.querySelector('.deaf__hud').textContent.includes('POZIOM'));
  assert.ok(doc.querySelector('.deaf__noise').textContent.includes('HAŁAS'));
  assert.ok(doc.querySelector('.deaf__log').children.length > 0);
  game.dispose();
});

test('UI: Amnezja Pojęciowa renderuje pokój i zmienia reguły po ubytku', async () => {
  const { w, doc } = setup();
  const { AudioEngine } = await import('../src/core/audio');
  const { Store } = await import('../src/core/save');
  const { AmnezjaGame } = await import('../src/games/amnezja');
  const root = doc.createElement('div');
  doc.body.append(root);
  const game = new AmnezjaGame();
  game.mount({ root, audio: new AudioEngine(), save: new Store(), onFinish: () => {} });
  assert.equal(doc.querySelectorAll('.concept').length, 10);
  assert.equal(doc.querySelectorAll('.room__exits .exit').length >= 2, true);
  click(w, doc.querySelector('.object__verbs .btn'));
  const shell = doc.querySelector('.game-shell--amnezja');
  assert.ok(shell);
  assert.equal(shell.classList.contains('lost-doors'), false);
  game.dispose();
});

test('UI: hub main.ts nawiguje do wszystkich czterech gier i z powrotem', async () => {
  const { w, doc, tick } = setup();
  await import('../src/main');
  assert.equal(doc.querySelectorAll('.card').length, 4);
  assert.equal(doc.title, 'RejPlay · Gabinet Osobliwości');
  for (const id of ['centrala', 'pasozyt', 'gluchy-swiat', 'amnezja']) {
    w.location.hash = `/${id}`;
    w.dispatchEvent(new w.Event('hashchange'));
    assert.ok(doc.querySelector(`.game-shell--${id}`), `brak widoku gry ${id}`);
    assert.equal(doc.querySelector('.hub').hidden, true);
    tick(2);
    w.location.hash = '';
    w.dispatchEvent(new w.Event('hashchange'));
    assert.equal(doc.querySelectorAll('.game-shell').length, 0);
    assert.equal(doc.querySelector('.hub').hidden, false);
  }
  // Esc z wnętrza gry wraca na półkę.
  w.location.hash = '/centrala';
  w.dispatchEvent(new w.Event('hashchange'));
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(w.location.hash, '');
  w.dispatchEvent(new w.Event('hashchange'));
  assert.equal(doc.querySelectorAll('.game-shell').length, 0);
});
