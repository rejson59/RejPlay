/**
 * „Centrala" — czysty silnik nocy. Nie zna DOM ani dźwięku.
 *
 * Jedno pomieszczenie, dwanaście gniazd, trzy akty. Gracz nie „wybiera
 * dialogów": on decyduje, KTÓRE rozmowy w ogóle się odbędą, kiedy je przerwie
 * i komu puści zmontowaną taśmę. Stąd każda partia ma inny układ dowodów.
 */
import { Rng, clamp } from '../core/random';

export type Role = 'killer' | 'victim' | 'spy' | 'police' | 'witness' | 'guest' | 'staff';
export type SystemKey = 'power3' | 'elevator' | 'lights' | 'boiler';

export interface Jack {
  id: string;
  name: string;
  room: string;
  role: Role;
  /** Jak łatwo słyszy klik przekaźnika (szpieg = najczulszy). */
  ear: number;
  alive: boolean;
  manipulated: boolean;
}

export interface Call {
  id: string;
  from: string;
  to: string;
  minute: number;
  act: number;
  lines: { who: string; text: string }[];
  clue: string | null;
  tag: string;
  /** Ile minut gry trwa jedna linia. */
  pace: number;
  state: 'waiting' | 'ringing' | 'live' | 'ended' | 'missed';
  revealed: number;
  connectedAt: number;
}

export interface Tape {
  id: string;
  label: string;
  lines: string[];
  source: string;
}

export interface NightEvent {
  kind: 'ring' | 'line' | 'clue' | 'click' | 'system' | 'murder' | 'saved' | 'info' | 'gameover';
  text: string;
}

export interface Mystery {
  seed: number;
  killerId: string;
  victimId: string;
  secondVictimId: string;
  motive: string;
  evidence: string;
  motives: string[];
  evidences: string[];
  jacks: Jack[];
  truth: string[];
}

export interface BoardState {
  minute: number;
  suspicion: number;
  wiretap: boolean;
  systems: Record<SystemKey, boolean>;
  secondMurderPrevented: boolean;
  policeAlerted: boolean;
  killerExposed: boolean;
  gameOver: boolean;
  overReason: string;
  clues: string[];
  tapes: Tape[];
  log: string[];
  score: number;
}

const MOTIVES = [
  'szantaż dotyczący dokumentów z wagonu pocztowego',
  'podział majątku po cichym rozwodzie',
  'kradzież mikrofilmu z sejfu konsula',
  'dług z gry w bakarata w salonie „Alpenrose"',
  'zdrada wojskowego szyfru na rzecz obcego wywiadu',
];
const EVIDENCES = [
  'złamany mankietyk z monogramem w popielniczce',
  'szpula z nagraniem kroków o 23:40',
  'klucz recepcyjny z odciskiem sadzy',
  'rachunek za telegram nadany o północy',
  'zapalniczka z wgniecionym denkiem',
];

const CAST: Omit<Jack, 'role' | 'alive' | 'manipulated'>[] = [
  { id: 'recepcja', name: 'p. Bartel · recepcja', room: 'parter', ear: 0.25 },
  { id: 'policja', name: 'posterunek · sierż. Kreft', room: 'miasteczko', ear: 0.3 },
  { id: 'kuchnia', name: 'kuchnia · siostry Voss', room: 'podziemie', ear: 0.2 },
  { id: 'arden', name: 'hr. von Arden', room: 'apartament 301', ear: 0.55 },
  { id: 'rozanska', name: 'p. Różańska', room: 'pokój 217', ear: 0.4 },
  { id: 'szeliga', name: 'dr Szeliga', room: 'gabinet', ear: 0.35 },
  { id: 'moss', name: 'kpt. Moss', room: 'pokój 118', ear: 0.7 },
  { id: 'lili', name: 'Lili Voss', room: 'pokój 204', ear: 0.45 },
  { id: 'konsul', name: 'konsul Iberti', room: 'apartament 305', ear: 0.65 },
  { id: 'biblioteka', name: 'biblioteka · nocny czytelnik', room: 'skrzydło wsch.', ear: 0.3 },
  { id: 'garaz', name: 'garaż · mechanik', room: 'podwórze', ear: 0.2 },
  { id: 'wieza', name: 'wieża · dzwonnik', room: 'poddasze', ear: 0.25 },
];

export const SYSTEM_LABELS: Record<SystemKey, string> = {
  power3: 'Prąd · III piętro',
  elevator: 'Winda',
  lights: 'Światła · hol',
  boiler: 'Kocioł · ogrzewanie',
};

export function generateMystery(seed: number): Mystery {
  const rng = new Rng(seed);
  const suspects = ['arden', 'rozanska', 'szeliga', 'moss', 'lili', 'konsul'];
  const shuffled = rng.shuffle(suspects);
  const killerId = shuffled[0];
  const victimId = shuffled[1];
  const secondVictimId = shuffled[2];
  const spyId = shuffled[3];
  const witnessId = shuffled[4];
  const motive = rng.pick(MOTIVES);
  const evidence = rng.pick(EVIDENCES);

  const jacks: Jack[] = CAST.map((base) => {
    let role: Role = 'guest';
    if (base.id === 'policja') role = 'police';
    else if (['recepcja', 'kuchnia', 'garaz', 'wieza', 'biblioteka'].includes(base.id)) role = 'staff';
    if (base.id === killerId) role = 'killer';
    else if (base.id === victimId) role = 'victim';
    else if (base.id === spyId) role = 'spy';
    else if (base.id === witnessId) role = 'witness';
    return { ...base, role, ear: role === 'spy' ? 0.92 : base.ear, alive: true, manipulated: false };
  });

  return {
    seed, killerId, victimId, secondVictimId, motive, evidence,
    motives: MOTIVES.slice(), evidences: EVIDENCES.slice(), jacks,
    truth: [],
  };
}

const nameOf = (m: Mystery, id: string): string =>
  m.jacks.find((j) => j.id === id)?.name ?? id;

export class Switchboard {
  readonly mystery: Mystery;
  readonly calls: Call[];
  state: BoardState;
  private rng: Rng;
  private pending: NightEvent[] = [];
  private tapeCounter = 0;
  private forcedCounter = 0;
  private lastTapAt = -999;

  constructor(seed: number) {
    this.mystery = generateMystery(seed);
    this.rng = new Rng(seed ^ 0x9e3779b9);
    // Rozmówcy w szablonach muszą znać role, więc podmieniamy je po generacji.
    this.calls = buildCallsFor(this.mystery);
    this.state = {
      minute: 1320, suspicion: 6, wiretap: false,
      systems: { power3: true, elevator: true, lights: true, boiler: true },
      secondMurderPrevented: false, policeAlerted: false, killerExposed: false,
      gameOver: false, overReason: '', clues: [], tapes: [], log: [], score: 0,
    };
  }

  get act(): number { return this.state.minute < 1380 ? 1 : this.state.minute < 1450 ? 2 : 3; }
  get timeLabel(): string {
    const m = Math.floor(this.state.minute) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  get ringing(): Call[] { return this.calls.filter((c) => c.state === 'ringing'); }
  get live(): Call[] { return this.calls.filter((c) => c.state === 'live'); }

  jack(id: string): Jack | undefined { return this.mystery.jacks.find((j) => j.id === id); }

  private push(kind: NightEvent['kind'], text: string): void {
    this.pending.push({ kind, text });
    this.state.log.unshift(`[${this.timeLabel}] ${text}`);
    if (this.state.log.length > 60) this.state.log.length = 60;
  }

  /** Zwraca zdarzenia od ostatniego wywołania (UI je konsumuje). */
  drain(): NightEvent[] { const out = this.pending; this.pending = []; return out; }

  /** `dt` w sekundach: 1 s = 2 minuty gry. Noc trwa 120 s. */
  tick(dt: number): NightEvent[] {
    if (this.state.gameOver) return this.drain();
    const before = this.state.minute;
    this.state.minute = Math.min(1560, this.state.minute + Math.max(0, dt) * 2);
    const now = this.state.minute;

    for (const call of this.calls) {
      if (call.state === 'waiting' && now >= call.minute) {
        call.state = 'ringing';
        this.push('ring', `Dzwoni ${call.tag}: ${nameOf(this.mystery, call.from)} → ${nameOf(this.mystery, call.to)}.`);
      }
      if (call.state === 'ringing' && now - call.minute > 26) {
        call.state = 'missed';
        this.push('info', `Nie odebrano: ${call.tag}. Rozmówcy się rozeszli.`);
      }
      if (call.state === 'live') {
        const shouldReveal = Math.floor((now - call.connectedAt) / call.pace) + 1;
        while (call.revealed < Math.min(call.lines.length, shouldReveal)) {
          const line = call.lines[call.revealed];
          call.revealed += 1;
          const readable = this.state.wiretap;
          this.push('line', readable
            ? `${line.who}: „${line.text}"`
            : `${line.who}: «szum na linii — włącz podsłuch»`);
          if (readable && call.clue && call.revealed === call.lines.length) {
            if (!this.state.clues.includes(call.clue)) {
              this.state.clues.push(call.clue);
              this.push('clue', `Zapisano w notesie: ${call.clue}`);
            }
          }
        }
        if (call.revealed >= call.lines.length) call.state = 'ended';
      }
    }

    // Zdarzenia osi czasu.
    if (before < 1380 && now >= 1380) this.push('info', 'Akt II · północ mija. Ktoś wchodzi na schody przeciwpożarowe.');
    if (before < 1450 && now >= 1450) this.push('info', 'Akt III · hotel cichnie. Zostało kilka minut do raportu.');
    if (before < 1478 && now >= 1478 && !this.state.secondMurderPrevented) {
      const victim = this.jack(this.mystery.secondVictimId);
      if (victim) victim.alive = false;
      this.push('murder', `${nameOf(this.mystery, this.mystery.secondVictimId)} nie odpowiada. Druga ofiara.`);
      this.state.score -= 30;
    } else if (before < 1478 && now >= 1478) {
      this.push('saved', 'Na III piętrze nikogo nie było. Druga ofiara przeżyła dzięki Twoim przełączeniom.');
      this.state.score += 25;
    }
    if (now >= 1560 && !this.state.gameOver) {
      this.state.gameOver = true;
      this.state.overReason = 'Świt. Lawina ustąpiła, policja wchodzi do hotelu — czas na raport.';
      this.push('gameover', this.state.overReason);
    }
    return this.drain();
  }

  /** Przepięcie kabla. Zwraca opis rezultatu (UI pokazuje go jako toast). */
  connect(from: string, to: string): { ok: boolean; text: string } {
    if (this.state.gameOver) return { ok: false, text: 'Noc się skończyła.' };
    if (from === to) return { ok: false, text: 'Nie możesz połączyć gniazda z sobą.' };
    if (!this.jack(from) || !this.jack(to)) return { ok: false, text: 'Nieznane gniazdo.' };
    const already = this.calls.find((c) => c.state === 'live'
      && ((c.from === from && c.to === to) || (c.from === to && c.to === from)));
    if (already) return { ok: false, text: 'Te gniazda są już połączone.' };

    const call = this.calls.find((c) => c.state === 'ringing'
      && ((c.from === from && c.to === to) || (c.from === to && c.to === from)));
    if (call) {
      call.state = 'live';
      call.connectedAt = this.state.minute;
      call.revealed = 0;
      this.push('info', `Połączono: ${call.tag}.`);
      return { ok: true, text: `Połączono ${call.tag}. Włącz podsłuch, by czytać rozmowę.` };
    }

    // To nie jest „pusta linia": operator może WYMUSIĆ rozmowę między dowolną
    // parą gości. To właśnie czyni go bogiem pociągającym za sznurki — ale każdy
    // taki mostek zostawia klik, a sprawca zaczyna się domyślać, że ktoś słucha.
    const bridge = this.improvise(from, to);
    this.forcedCounter += 1;
    const improvised: Call = {
      id: `x${this.forcedCounter}`, from, to, minute: this.state.minute, act: this.act,
      lines: bridge.lines, clue: bridge.clue, tag: bridge.tag, pace: 6,
      state: 'live', revealed: 0, connectedAt: this.state.minute,
    };
    this.calls.push(improvised);
    this.state.suspicion = clamp(this.state.suspicion + bridge.risk, 0, 100);
    this.push('click', `Wymuszony mostek ${bridge.tag}: słyszalny klik przekaźnika (+${bridge.risk} podejrzeń).`);
    this.push('info', bridge.effect);
    this.checkSuspicion();
    return { ok: true, text: `${bridge.tag}. ${bridge.effect}` };
  }

  /** Generuje rozmowę, która nie była w scenariuszu, i jej konsekwencje. */
  private improvise(from: string, to: string):
    { lines: { who: string; text: string }[]; clue: string | null; tag: string; effect: string; risk: number } {
    const m = this.mystery;
    const ja = this.jack(from)!, jb = this.jack(to)!;
    const a = ja.name.split(' · ')[0], b = jb.name.split(' · ')[0];
    const killerIn = ja.role === 'killer' || jb.role === 'killer';
    const policeIn = ja.role === 'police' || jb.role === 'police';
    const spyIn = ja.role === 'spy' || jb.role === 'spy';
    const witnessIn = ja.role === 'witness' || jb.role === 'witness';
    const victimIn = from === m.secondVictimId || to === m.secondVictimId;
    const tag = `Mostek ${a} ↔ ${b}`;
    let clue: string | null = null;
    let effect = `${a} i ${b} słyszą się po raz pierwszy tej nocy.`;
    let risk = 2;
    const lines: { who: string; text: string }[] = [
      { who: a, text: 'Centrala? Nie prosiłem o połączenie. Kto nas teraz zmostkował?' },
      { who: b, text: 'Słyszę trzask przekaźnika. Mów szybko, zanim ktoś odłoży słuchawkę.' },
    ];
    if (killerIn && policeIn) {
      lines[0] = { who: a, text: `Posterunku? To pomyłka. Ja tylko… chciałem zgłosić ${m.evidence}.` };
      lines[1] = { who: b, text: `Kreft. Znamy tę zapalniczkę. Proszę zostać w pokoju, wyślę patrol.` };
      clue = `Wymuszona rozmowa sprawcy z policją: padł motyw „${m.motive}".`;
      effect = 'Sprawca sam odezwał się do Krefta. Patrol blokuje III piętro, a w aktach przybywa motyw.';
      this.state.policeAlerted = true;
      this.state.secondMurderPrevented = true;
      this.state.killerExposed = true;
      this.state.score += 12;
      risk = 8;
    } else if (killerIn && victimIn) {
      lines[0] = { who: a, text: 'Przyjdź na górę, musimy wyjaśnić jedno nieporozumienie. Natychmiast.' };
      lines[1] = { who: b, text: 'Poznaję ten głos. Zostaję w holu przy recepcji, nigdzie nie idę.' };
      clue = `${nameOf(m, m.secondVictimId)} rozpoznała głos sprawcy i nie poszła na spotkanie.`;
      effect = 'Druga ofiara usłyszała sprawcę w słuchawce i zrezygnowała ze schodów. Przeżyje.';
      this.state.secondMurderPrevented = true;
      this.state.score += 10;
      risk = 6;
    } else if (killerIn) {
      lines[0] = { who: a, text: `Nikt nie może wiedzieć o „${m.motive}". Zrozumiano?` };
      lines[1] = { who: b, text: 'Ktoś jeszcze jest na tej linii. Słyszę oddech w centrali.' };
      clue = `Sprawca zdradził motyw w wymuszonej rozmowie: ${m.motive}.`;
      effect = 'Sprawca powiedział o motywie, ale zorientował się, że linia jest podsłuchiwana.';
      this.state.killerExposed = true;
      risk = 7;
    } else if (spyIn && policeIn) {
      lines[0] = { who: a, text: 'Nie podam nazwiska. W skrzydle wschodnim zniknął mikrofilm.' };
      lines[1] = { who: b, text: 'Przyjąłem. Jeśli dostanę szpulę, wyślę patrol.' };
      clue = 'W hotelu działa obcy wywiad: zniknął mikrofilm z sejfu konsula.';
      effect = 'Donos trafił prosto na posterunek. Kreft czeka na nagranie.';
      this.state.policeAlerted = true;
      risk = 4;
    } else if (witnessIn) {
      lines[0] = { who: a, text: 'Słyszałam kroki na schodach, nie w windzie. Ktoś gasił światło.' };
      lines[1] = { who: b, text: 'To samo słyszałam. Operatorze, dlaczego nas połączono?' };
      clue = 'Dwoje świadków potwierdziło: sprawca szedł schodami przeciwpożarowymi.';
      effect = 'Zestawienie dwóch świadków daje nowy trop, ale goście zaczynają mówić o centrali.';
      risk = 5;
    }
    return { lines, clue, tag, effect, risk };
  }

  disconnect(callId: string): { ok: boolean; text: string } {
    const call = this.calls.find((c) => c.id === callId);
    if (!call || call.state !== 'live') return { ok: false, text: 'Ta linia już nie jest aktywna.' };
    call.state = 'ended';
    const lost = call.lines.length - call.revealed;
    this.push('click', `Rozłączono ${call.tag}${lost > 0 ? ` — urwano ${lost} zdań` : ''}. Rozmówcy słyszą trzask.`);
    this.state.suspicion = clamp(this.state.suspicion + 4, 0, 100);
    this.checkSuspicion();
    return { ok: true, text: `Rozłączono. Urwano ${lost} zdań; klik podniósł podejrzenia.` };
  }

  setWiretap(on: boolean): { ok: boolean; text: string; clicked: boolean } {
    if (this.state.wiretap === on) return { ok: true, text: on ? 'Podsłuch włączony.' : 'Podsłuch wyłączony.', clicked: false };
    this.state.wiretap = on;
    // Samo przełączenie dźwigni generuje klik — im częściej, tym łatwiej go usłyszeć.
    const gap = this.state.minute - this.lastTapAt;
    this.lastTapAt = this.state.minute;
    const ears = this.mystery.jacks.reduce((a, j) => Math.max(a, j.ear), 0);
    const risk = gap < 12 ? 0.85 : on ? 0.4 + ears * 0.35 : 0.22;
    const clicked = this.rng.chance(risk);
    if (clicked) {
      const rise = on ? 9 : 5;
      this.state.suspicion = clamp(this.state.suspicion + rise, 0, 100);
      this.push('click', `KLIK. Dźwignia podsłuchu zdradziła Cię (+${rise} podejrzeń).`);
      this.checkSuspicion();
    } else {
      this.push('info', on ? 'Podsłuch włączony, tym razem bez kliku.' : 'Podsłuch odłożony, bez kliku.');
    }
    return { ok: true, clicked, text: clicked ? 'Klik! Ktoś na linii zamilkł.' : 'Przełączono czysto.' };
  }

  private checkSuspicion(): void {
    if (this.state.suspicion >= 100 && !this.state.gameOver) {
      this.state.gameOver = true;
      this.state.overReason = 'Podejrzenia sięgnęły 100%. Goście odcięli centralę i wezwali nocnego portiera.';
      this.push('gameover', this.state.overReason);
    }
  }

  toggleSystem(key: SystemKey): { ok: boolean; text: string } {
    const s = this.state.systems;
    s[key] = !s[key];
    const on = s[key];
    let extra = '';
    if (key === 'elevator' && !on) {
      this.state.secondMurderPrevented = true;
      extra = ' Morderca nie dotrze na III piętro.';
    }
    if (key === 'power3' && !on) {
      extra = ' W ciemności nikt nie wejdzie do apartamentu 301.';
    }
    if (key === 'lights' && !on) {
      this.state.suspicion = clamp(this.state.suspicion + 6, 0, 100);
      extra = ' Goście zaczęli dzwonić do recepcji.';
      this.checkSuspicion();
    }
    if (key === 'boiler' && !on) {
      extra = ' Rury ucichły — teraz słychać każdy klik przekaźnika.';
      for (const j of this.mystery.jacks) j.ear = Math.min(1, j.ear + 0.12);
    }
    this.push('system', `${SYSTEM_LABELS[key]}: ${on ? 'WŁ.' : 'WYŁ.'}.${extra}`);
    return { ok: true, text: `${SYSTEM_LABELS[key]} → ${on ? 'włączone' : 'wyłączone'}.${extra}` };
  }

  record(callId: string): { ok: boolean; text: string } {
    const call = this.calls.find((c) => c.id === callId);
    if (!call) return { ok: false, text: 'Brak rozmowy do nagrania.' };
    const lines = call.lines.slice(0, call.revealed).map((l) => `${l.who}: ${l.text}`);
    if (lines.length === 0) return { ok: false, text: 'Szpula pusta — najpierw włącz podsłuch i poczekaj na zdania.' };
    this.tapeCounter += 1;
    this.state.tapes.push({
      id: `t${this.tapeCounter}`, label: `Szpula ${String(this.tapeCounter).padStart(2, '0')} · ${call.tag}`,
      lines, source: call.tag,
    });
    this.push('info', `Nagrano ${lines.length} zdań z „${call.tag}" na szpulę.`);
    return { ok: true, text: `Nagrano szpulę (${lines.length} zdań).` };
  }

  /** Klasyczny montaż: A do `cutA` + B od `cutB`. */
  splice(aId: string, bId: string, cutA: number, cutB: number): { ok: boolean; text: string } {
    const a = this.state.tapes.find((t) => t.id === aId);
    const b = this.state.tapes.find((t) => t.id === bId);
    if (!a || !b) return { ok: false, text: 'Potrzebne są dwie szpule.' };
    const lines = [...a.lines.slice(0, clamp(cutA, 0, a.lines.length)),
      ...b.lines.slice(clamp(cutB, 0, b.lines.length))];
    if (lines.length === 0) return { ok: false, text: 'Taśma wyszła pusta.' };
    this.tapeCounter += 1;
    this.state.tapes.push({
      id: `t${this.tapeCounter}`, label: `Montaż ${String(this.tapeCounter).padStart(2, '0')} · ${a.source}+${b.source}`,
      lines, source: 'montaż',
    });
    this.push('info', `Zmontowano taśmę z ${lines.length} zdaniami.`);
    return { ok: true, text: `Zmontowano taśmę: ${lines.length} zdań.` };
  }

  playTape(tapeId: string, jackId: string): { ok: boolean; text: string } {
    const tape = this.state.tapes.find((t) => t.id === tapeId);
    const jack = this.jack(jackId);
    if (!tape || !jack) return { ok: false, text: 'Wybierz szpulę i gniazdo.' };
    if (jack.manipulated) return { ok: false, text: `${jack.name} już dostał taśmę — więcej nie uwierzy.` };
    jack.manipulated = true;
    let effect = `${jack.name} wysłuchał taśmy i zmienił zdanie o współgościach.`;
    if (jack.role === 'police') {
      this.state.policeAlerted = true;
      this.state.secondMurderPrevented = true;
      effect = 'Kreft dostał nagranie. Patrol blokuje III piętro — druga ofiara jest bezpieczna.';
    } else if (jack.role === 'killer') {
      this.state.killerExposed = true;
      this.state.clues.push('Morderca usłyszał własny głos i zaczął niszczyć dowody.');
      effect = 'Morderca rozpoznał własny głos. Zdemaskowany, ale teraz wie, że go nagrałeś (+14 podejrzeń).';
      this.state.suspicion = clamp(this.state.suspicion + 14, 0, 100);
      this.checkSuspicion();
    } else if (jack.id === this.mystery.secondVictimId) {
      this.state.secondMurderPrevented = true;
      effect = 'Ostrzeżony gość nie poszedł na spotkanie. Druga ofiara żyje.';
    } else if (jack.role === 'spy') {
      this.state.clues.push('Szpieg usłyszał cudzy głos i przestał ufać wspólnikowi.');
      this.state.score += 4;
      this.state.suspicion = clamp(this.state.suspicion + 4, 0, 100);
      effect = 'Szpieg rozpoznał cudze zdanie. Skłócony z konsulem, zaczyna szukać podsłuchu (+4 podejrzeń).';
      this.checkSuspicion();
    } else if (jack.role === 'witness') {
      this.state.clues.push('Świadek rozpoznał głos z taśmy i dopisał go do zeznań.');
      this.state.score += 4;
      effect = 'Świadek dopasował głos z taśmy do twarzy z korytarza. Nowy trop w notesie.';
    } else {
      this.state.suspicion = clamp(this.state.suspicion + 3, 0, 100);
      effect = `${jack.name} puścił taśmę dalej. Hotel szepcze o operatorze (+3 podejrzeń).`;
      this.checkSuspicion();
    }
    this.state.score += 6;
    this.push('info', `Puszczono „${tape.label}" → ${jack.name}. ${effect}`);
    return { ok: true, text: effect };
  }

  accuse(killerId: string, motive: string, evidence: string):
    { correct: boolean; score: number; summary: string } {
    const m = this.mystery;
    const correct = killerId === m.killerId;
    const motiveOk = motive === m.motive;
    const evidenceOk = evidence === m.evidence;
    const alive = this.jack(m.secondVictimId)?.alive !== false;
    let score = this.state.score;
    score += correct ? 60 : -20;
    score += motiveOk ? 20 : 0;
    score += evidenceOk ? 20 : 0;
    score += this.state.clues.length * 4;
    score += alive ? 15 : 0;
    score += Math.round((100 - this.state.suspicion) * 0.25);
    score += this.state.killerExposed ? 10 : 0;
    score = Math.max(0, Math.round(score));
    const summary = correct
      ? `Trafnie wskazano ${nameOf(m, m.killerId)}. Motyw ${motiveOk ? 'potwierdzony' : 'niepotwierdzony'}, ` +
        `dowód ${evidenceOk ? 'zgodny' : 'niezgodny'}, druga ofiara ${alive ? 'przeżyła' : 'zginęła'}.`
      : `Raport błędny. Sprawcą był ${nameOf(m, m.killerId)}; motyw: ${m.motive}; dowód: ${m.evidence}.`;
    this.state.score = score;
    this.state.gameOver = true;
    return { correct, score, summary };
  }
}

/** Szablony potrzebują ról wygenerowanych w mystery — budujemy je z dostępem do listy. */
function buildCallsFor(m: Mystery): Call[] {
  const spyId = m.jacks.find((j) => j.role === 'spy')?.id ?? 'konsul';
  const witnessId = m.jacks.find((j) => j.role === 'witness')?.id ?? 'lili';
  const other = (exclude: string[]): string =>
    m.jacks.find((j) => !exclude.includes(j.id) && j.role !== 'police')?.id ?? 'arden';
  const K = m.killerId, V = m.victimId, S = m.secondVictimId;
  const n = (id: string): string => (m.jacks.find((j) => j.id === id)?.name ?? id).split(' · ')[0];
  const nameK = n(K), nameV = n(V), nameS = n(S);
  const mk = (
    id: string, from: string, to: string, minute: number, act: number, tag: string,
    clue: string | null, pace: number, lines: { who: string; text: string }[],
  ): Call => ({
    id, from, to, minute, act, tag, clue, pace, lines,
    state: 'waiting', revealed: 0, connectedAt: 0,
  });
  return [
    mk('c01', 'recepcja', 'policja', 1322, 1, 'Zgłoszenie', 'Godzina zgłoszenia: 22:02.', 7, [
      { who: 'Bartel', text: 'Centrala, proszę z posterunkiem. Lawina zniosła most — jesteśmy odcięci.' },
      { who: 'Kreft', text: `Przyjęte. Ktoś zostawił przy drodze: ${m.evidence}.` },
      { who: 'Bartel', text: 'W hotelu dziś komplet gości. Nikt nie wyjdzie do rana.' },
    ]),
    mk('c02', V, 'recepcja', 1330, 1, 'Skarga', `${nameV} bał się kogoś z III piętra.`, 6, [
      { who: nameV, text: 'Ktoś chodził pod moimi drzwiami. Nie łącz mnie z górnym skrzydłem.' },
      { who: 'Bartel', text: 'Winda i tak stoi, proszę państwa. O 23:00 wyłączamy kocioł.' },
    ]),
    mk('c03', K, spyId, 1340, 1, 'Szept', null, 5, [
      { who: nameK, text: 'Nie przy telefonie. Spotkajmy się w bibliotece, gdy zgasną światła.' },
      { who: n(spyId), text: 'Mam papiery. Jeśli ktoś podsłuchuje, usłyszymy klik.' },
    ]),
    mk('c04', K, 'biblioteka', 1352, 1, 'Umówienie', `${nameK} umówił się w bibliotece o 22:32.`, 6, [
      { who: nameK, text: `Zostawię klucz pod donicą. Chcę, żeby ${nameV} tam był sam.` },
      { who: 'Czytelnik', text: 'W holu gaśnie światło o dwudziestej trzeciej. Nikogo nie będzie.' },
    ]),
    mk('c05', witnessId, 'kuchnia', 1364, 1, 'Plotka', null, 6, [
      { who: n(witnessId), text: 'Słyszałam kroki na schodach przeciwpożarowych, nie w windzie.' },
      { who: 'Voss', text: 'Woda w kotle hałasuje, trudno cokolwiek usłyszeć.' },
    ]),
    mk('c06', 'policja', 'recepcja', 1382, 2, 'Dochodzenie', `Motyw: ${m.motive}.`, 7, [
      { who: 'Kreft', text: `Pierwszy trop: ktoś wysłał telegram w sprawie „${m.motive}".` },
      { who: 'Bartel', text: 'Telegram nadałem o północy. Centrala wszystko słyszy, ale nie widzi nadawcy.' },
    ]),
    mk('c07', K, S, 1398, 2, 'Zaproszenie', `${nameK} wabi ${nameS} na III piętro.`, 5, [
      { who: nameK, text: 'Przyjdź na trzecie piętro po północy. Mam coś, co zmieni twoje zeznanie.' },
      { who: nameS, text: 'Jeśli winda nie działa, zejdę schodami. Będę za kwadrans.' },
    ]),
    mk('c08', spyId, 'policja', 1412, 2, 'Donos', 'W hotelu działa obcy wywiad.', 6, [
      { who: n(spyId), text: 'Nie podawajcie mojego nazwiska. W pokojach 3xx ktoś grzebał w papierach.' },
      { who: 'Kreft', text: 'Jeśli dostanę nagranie, wyślę patrol, zanim lawina ustąpi.' },
    ]),
    mk('c09', V, K, 1430, 2, 'Konfrontacja', `${nameV} nazwał sprawcę po imieniu.`, 5, [
      { who: nameV, text: `Wiem, że to ty, ${nameK}. Oddaj to, albo powiem Kreftowi.` },
      { who: nameK, text: 'Nie powiesz nikomu. Telefon jest jedynym świadkiem, a ja go odetnę.' },
    ]),
    mk('c10', S, 'recepcja', 1450, 3, 'Prośba', null, 6, [
      { who: nameS, text: 'Na trzecim piętrze zgasło światło. Proszę o kogoś z latarką.' },
      { who: 'Bartel', text: 'Winda zablokowana przez centralę. Zejdę po schodach.' },
    ]),
    mk('c11', K, other([K, V, S, spyId]), 1468, 3, 'Wyznanie', `Dowód: ${m.evidence}.`, 5, [
      { who: nameK, text: `Zostawiłem ${m.evidence}. Nie mogłem zabrać, Bartel patrzył.` },
      { who: 'Rozmówca', text: 'A więc to naprawdę byłeś ty. Zniszcz szpulę w centrali.' },
    ]),
    mk('c12', 'policja', 'recepcja', 1490, 3, 'Wezwanie', null, 7, [
      { who: 'Kreft', text: 'Centralo, podaj nazwisko. Mamy jedną noc, potem śnieg zasypie tropy.' },
      { who: 'Bartel', text: 'Operatorze, decyduj. Ja tylko trzymam słuchawkę.' },
    ]),
  ];
}
