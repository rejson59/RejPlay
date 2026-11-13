import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/random';
import { Switchboard, SYSTEM_LABELS } from '../src/logic/centrala-engine';
import { Colony, BUILDINGS } from '../src/logic/pasozyt-engine';
import { SoundWorld, reachable, MATERIALS } from '../src/logic/gluchy-engine';
import { ConceptWorld, CONCEPTS } from '../src/logic/amnezja-engine';

/** 1 sekunda = 2 minuty gry; tickujemy małymi krokami jak prawdziwy rAF. */
const toMinute = (b: Switchboard, minute: number): void => {
  let guard = 0;
  while (b.state.minute < minute && guard++ < 1000) b.tick(0.5);
};

test('Centrala: losowa tajemnica ma spójnego sprawcę, motyw i dowód', () => {
  for (const seed of [1, 2, 77, 9999]) {
    const m = new Switchboard(seed).mystery;
    assert.ok(m.jacks.some((j) => j.id === m.killerId));
    assert.ok(m.motives.includes(m.motive));
    assert.ok(m.evidences.includes(m.evidence));
    assert.notEqual(m.killerId, m.secondVictimId);
    assert.equal(m.jacks.length, 12);
    assert.equal(m.jacks.filter((j) => j.role === 'police').length, 1);
    assert.equal(m.jacks.filter((j) => j.role === 'spy').length, 1);
  }
});

test('Centrala: podsłuch ujawnia zdania, klik bywa słyszalny', () => {
  const b = new Switchboard(12);
  assert.equal(b.state.wiretap, false);
  const tap = b.setWiretap(true);
  assert.equal(tap.ok, true);
  assert.equal(b.state.wiretap, true);
  assert.equal(typeof tap.clicked, 'boolean');
  const before = b.state.suspicion;

  const call = b.calls[0];
  toMinute(b, call.minute);
  assert.ok(b.calls.some((c) => c.state === 'ringing'));
  assert.equal(b.connect(call.from, call.to).ok, true);
  assert.equal(call.state, 'live');
  toMinute(b, call.minute + 24);
  assert.ok(call.revealed > 0, 'rozmowa musi odsłaniać kolejne zdania');
  assert.ok(b.state.clues.length > 0, 'zapisano trop w notesie');
  assert.ok(b.state.log.some((line) => line.includes('Zapisano w notesie')));

  b.setWiretap(false);
  b.setWiretap(true);
  assert.ok(b.state.suspicion >= before);
  assert.ok(b.state.suspicion <= 100);
  assert.match(b.timeLabel, /^\d{2}:\d{2}$/);
});

test('Centrala: rozłączenie, systemy, szpule i raport zamykają noc', () => {
  const b = new Switchboard(31);
  assert.match(b.toggleSystem('elevator').text, /Winda/);
  assert.equal(b.state.systems.elevator, false);
  assert.equal(b.state.systems.power3, true);
  assert.equal(b.state.secondMurderPrevented, true, 'zablokowana winda ratuje ofiarę');
  assert.equal(Object.keys(SYSTEM_LABELS).length, 4);

  const call = b.calls[0];
  toMinute(b, call.minute);
  assert.equal(b.connect(call.from, call.to).ok, true);
  toMinute(b, call.minute + 2);
  assert.equal(b.disconnect(call.id).ok, true);
  assert.notEqual(call.state, 'live');
  assert.equal(b.record(call.id).ok, true);
  assert.equal(b.state.tapes.length, 1);
  assert.equal(b.splice('t1', 't1', 1, 0).ok, true);
  assert.equal(b.state.tapes.length, 2);
  assert.equal(b.playTape('t1', 'policja').ok, true);
  assert.equal(b.state.policeAlerted, true);

  const res = b.accuse(b.mystery.killerId, b.mystery.motive, b.mystery.evidence);
  assert.equal(res.correct, true);
  assert.ok(res.score > 0);
  assert.equal(b.state.gameOver, true);
});

test('Centrala: wymuszony mostek tworzy nową rozmowę i ma konsekwencje', () => {
  const b = new Switchboard(55);
  const m = b.mystery;
  const before = b.calls.length;
  const res = b.connect(m.killerId, 'policja');
  assert.equal(res.ok, true);
  assert.equal(b.calls.length, before + 1, 'operator wymusił rozmowę spoza scenariusza');
  assert.equal(b.state.policeAlerted, true);
  assert.equal(b.state.killerExposed, true);
  assert.equal(b.state.secondMurderPrevented, true);
  assert.match(res.text, /Mostek/);
  const forced = b.calls[b.calls.length - 1];
  assert.equal(forced.state, 'live');
  assert.ok(forced.clue);
  assert.equal(b.connect(m.killerId, 'policja').ok, false, 'nie można dwa razy zmostkować tej samej pary');
  assert.ok(b.state.suspicion > 6, 'każdy mostek zostawia klik');
  b.setWiretap(true);
  toMinute(b, b.state.minute + 18);
  assert.ok(b.state.clues.some((c) => c.includes('motyw')), 'podsłuch mostka daje trop');
  assert.equal(b.record(forced.id).ok, true, 'wymuszoną rozmowę też można nagrać');
});

test('Pasożyt: budowa kosztuje zasoby i nie pozwala na błędne podłoże', () => {
  const c = new Colony(9);
  const bone = c.tiles.findIndex((t) => t.kind === 'bone' && !t.building);
  const tissue = c.tiles.findIndex((t) => t.kind === 'tissue' && !t.building);
  assert.ok(bone >= 0 && tissue >= 0);
  const x = bone % c.w, y = Math.floor(bone / c.w);
  const before = c.resources.biomass;
  assert.equal(c.build(x, y, 'mine').ok, true);
  assert.ok(c.resources.biomass < before);
  assert.equal(c.build(x, y, 'mine').ok, false, 'jedno pole = jedna struktura');
  const tx = tissue % c.w, ty = Math.floor(tissue / c.w);
  assert.equal(c.build(tx, ty, 'mine').ok, false, 'kopalni nie stawiamy na tkance');
  assert.equal(Object.keys(BUILDINGS).length, 8);
  assert.equal(c.demolish(x, y).ok, true);
  assert.equal(c.at(x, y).building, null);
});

test('Pasożyt: zapalenie, leukocyty i gorączka ewoluują bez NaN', () => {
  const c = new Colony(44);
  for (let i = 0; i < 80; i += 1) c.tick();
  for (const value of Object.values(c.resources)) assert.ok(Number.isFinite(value));
  assert.ok(Number.isFinite(c.host.health) && Number.isFinite(c.host.fever));
  assert.ok(c.host.fever >= 36);
  assert.ok(c.averageInflammation >= 0);
  assert.ok(c.tickCount > 0);
  assert.ok(c.leukocytes.length >= 0);
  assert.ok(Number.isFinite(c.score));
});

test('Pasożyt: zdarzenie z wyborem zamraża symulację i daje się rozstrzygnąć', () => {
  const c = new Colony(5);
  for (let i = 0; i < 80 && !c.pending; i += 1) c.tick();
  assert.ok(c.pending, 'po 22 cyklach musi pojawić się zdarzenie');
  assert.equal(c.tickCount, 22);
  const snapshot = c.tickCount;
  c.tick();
  assert.equal(c.tickCount, snapshot, 'okno decyzji nie może zabijać gospodarza w tle');
  assert.equal(c.resolveEvent(0).ok, true);
  assert.equal(c.pending, null);
  c.tick();
  assert.equal(c.tickCount, snapshot + 1);
});

test('Głuchy Świat: wyjście jest zawsze osiągalne z pozycji startowej', () => {
  for (const seed of [2, 30, 12345]) {
    const w = new SoundWorld(seed, 1);
    assert.equal(reachable(w.map), true);
    assert.ok(w.listeners.length > 0);
    assert.equal(w.emit('click').ok, true);
    assert.ok(w.pulses.length > 0, 'pierwsza fala daje graczowi obraz');
    assert.equal(w.caught, false);
    assert.equal(w.escaped, false);
    assert.ok(Object.keys(MATERIALS).length >= 6);
  }
});

test('Głuchy Świat: fala rośnie, odbicia są posortowane i hałas jest liczony', () => {
  const w = new SoundWorld(88, 2);
  w.emit('click');
  const pulse = w.pulses[0];
  const before = pulse.radius;
  const hits = pulse.hits;
  assert.ok(hits.length > 10);
  for (let i = 1; i < hits.length; i += 1) {
    assert.ok(hits[i].dist >= hits[i - 1].dist, 'echo wraca od najbliższych punktów');
  }
  w.step(0.05, { forward: 0, strafe: 0, turn: 0, sneak: false });
  assert.ok(pulse.radius > before);
  assert.equal(w.emit('fork').ok, true);
  assert.ok(w.noise > 0);
  assert.equal(w.tools.fork, 2);
  assert.equal(w.emit('click').ok, true, 'pstryknięcie jest nieskończone');
  assert.equal(w.tools.click, 999);

  // Mikrofon kierunkowy: wąski stożek i prawie zerowy hałas.
  const quiet = new SoundWorld(5, 1);
  assert.equal(quiet.emit('mic').ok, true);
  assert.equal(quiet.tools.mic, 3);
  const micPulse = quiet.pulses[quiet.pulses.length - 1];
  assert.equal(micPulse.kind, 'mic');
  assert.ok(micPulse.hits.length > 0);
  assert.ok(micPulse.hits.every((hit) => Math.abs(hit.angle - quiet.player.yaw) <= 0.24),
    'mikrofon widzi tylko przed sobą');
  assert.ok(quiet.noise <= 0.13, 'mikrofon prawie nie zdradza pozycji');

  // Zabawka ląduje w innym korytarzu, nie pod nogami gracza.
  assert.equal(w.emit('decoy').ok, true);
  const decoy = w.decoys[0];
  assert.ok(decoy);
  assert.ok(Math.hypot(decoy.x - w.player.x, decoy.y - w.player.y) >= 3,
    'pułapka dźwiękowa nie może sprowadzać wrogów na gracza');
  assert.ok(Number.isFinite(w.score));
});

test('Amnezja: utrata pojęcia zmienia tekst, czasowniki i reguły', () => {
  const w = new ConceptWorld(3);
  assert.equal(w.owned.size, CONCEPTS.length);
  assert.match(w.render('czerwony dywan'), /czerwon/);
  assert.match(w.lose('red'), /TRACISZ POJĘCIE/);
  assert.equal(w.owned.has('red'), false);
  assert.match(w.render('czerwony dywan'), /szare/);
  w.lose('numbers');
  assert.ok(!w.render('numer 7').includes('7'), 'bez liczb cyfry znikają');
  const namesBefore = w.verbs('drzwi').length;
  w.lose('doors');
  assert.ok(w.verbs('drzwi').length < namesBefore, 'bez Drzwi „Otwórz" znika');
  assert.match(w.lose('doors'), /już dawno zniknęło/, 'nie traci się dwa razy tego samego');
  assert.equal(w.losses, 3);
  assert.equal(w.exits().some((e) => !e.open), true);
  assert.equal(w.go('północ').ok, false);
  assert.equal(w.go('wschód').ok, true, 'zostaje alternatywna droga');
});

test('Amnezja: handel, pojedynek i odzyskiwanie pojęć są spójne', () => {
  const w = new ConceptWorld(21);
  assert.equal(w.trade('red', 'red').ok, false);
  w.lose('red');
  assert.equal(w.trade('numbers', 'red').ok, true);
  assert.equal(w.owned.has('red'), true);
  assert.equal(w.owned.has('numbers'), false);

  w.current = 'biblioteka';
  assert.equal(w.act('cenzor1', 'duel1').ok, true);
  assert.ok(w.activeDuel);
  const correct = w.activeDuel!.options.findIndex((o) => o.correct);
  assert.ok(correct >= 0);
  const res = w.answerDuel(correct);
  assert.equal(res.ok, true);
  assert.equal(res.lost, null);
  assert.equal(w.activeDuel, null);
  assert.equal(w.duelsWon, 1);
  assert.equal(w.owned.has('numbers'), true, 'trafna odpowiedź zwraca utracone pojęcie');
  assert.ok(w.score >= 0);
});

test('Amnezja: odłamek z okna pozwala ukraść cudze pojęcie', () => {
  const w = new ConceptWorld(8);
  w.lose('doors');
  assert.equal(w.verbs('drzwi').length, 0, 'bez Drzwi nie ma akcji „Otwórz"');
  assert.equal(w.act('okno', 'break').ok, true);
  assert.ok(w.inventory.includes('odłamek'), 'wybite okno daje narzędzie do obejścia zasady');
  assert.equal(w.go('wschód').ok, true);
  const stolen = w.act('handlarz', 'steal-jar');
  assert.equal(stolen.ok, true);
  assert.ok(stolen.gained);
  assert.equal(w.owned.has(stolen.gained!), true);
  assert.equal(w.owned.has('doors'), true, 'kradzież przywraca utracone pojęcie');
  w.current = 'westybul';
  assert.equal(w.verbs('drzwi').length, 1, 'reguła wraca razem z pojęciem');
});

test('Amnezja: każdy pokój i wyjście mają poprawne odnośniki', () => {
  const w = new ConceptWorld(101);
  const names = new Set(Object.keys(w.rooms));
  assert.ok(names.size >= 8);
  for (const [id, room] of Object.entries(w.rooms)) {
    assert.ok(room.name, id);
    for (const [dir, exit] of Object.entries(room.exits)) {
      assert.ok(names.has(exit.to), `${id} → ${dir} → ${exit.to}`);
    }
  }
  assert.equal(w.go('nie-ma-takiego-kierunku').ok, false);
  assert.equal(new Rng(1).int(1, 1), 1);
});
