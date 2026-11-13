/**
 * „Amnezja Pojęciowa" — reguły świata. Czysty moduł, bez DOM.
 *
 * Nie ma paska zdrowia. Obrażenia usuwają POJĘCIA, a pojęcia są jednocześnie
 * zasobem, warunkiem dostępu do akcji i parametrem renderowania. Utrata
 * „drzwi" nie blokuje przejścia: zmienia je w zagadkę (zostaje okno).
 */
import { Rng } from '../core/random';

export type ConceptId =
  | 'red' | 'numbers' | 'doors' | 'keys' | 'names'
  | 'writing' | 'light' | 'time' | 'fear' | 'water';

export interface Concept {
  id: ConceptId;
  label: string;
  /** Co dokładnie psuje się po utracie. */
  consequence: string;
  glyph: string;
}

export const CONCEPTS: Concept[] = [
  { id: 'red', label: 'czerwień', consequence: 'Czerwone rzeczy stają się szare, giną tropy w kolorze.', glyph: '●' },
  { id: 'numbers', label: 'liczby', consequence: 'Cyfry i ilości zamieniają się w bełkot.', glyph: '№' },
  { id: 'doors', label: 'drzwi', consequence: 'Nie wiesz, czym są drzwi — nie ma akcji „Otwórz".', glyph: '⌐' },
  { id: 'keys', label: 'klucze', consequence: 'Klucze są niezrozumiałymi przedmiotami, zamki trzeba obejść.', glyph: '⚿' },
  { id: 'names', label: 'imiona', consequence: 'Nazwy postaci znikają; nie zwrócisz się do nikogo.', glyph: '✎' },
  { id: 'writing', label: 'pismo', consequence: 'Napisy są nieczytelne — trzeba ich posłuchać.', glyph: '¶' },
  { id: 'light', label: 'światło', consequence: 'Pokoje ciemnieją, ale Cenzorzy też gorzej widzą.', glyph: '☀' },
  { id: 'time', label: 'czas', consequence: 'Zegary pokazują „—", nie da się odczytać godzin.', glyph: '◷' },
  { id: 'fear', label: 'strach', consequence: 'Przestajesz się bać — możesz wejść do Sali bez pojedynku.', glyph: '⚡' },
  { id: 'water', label: 'woda', consequence: 'Woda to „przezroczysta substancja" o nieznanym działaniu.', glyph: '≈' },
];

export const CONCEPT_MAP: Record<ConceptId, Concept> =
  Object.fromEntries(CONCEPTS.map((c) => [c.id, c])) as Record<ConceptId, Concept>;

export interface Verb {
  id: string;
  label: string;
  requires?: ConceptId[];
  needs?: string[];
  text: string;
  give?: string;
  set?: Record<string, boolean>;
  move?: string;
  lose?: ConceptId;
  gain?: ConceptId;
  duel?: boolean;
  trade?: boolean;
  /** Kradzież cudzego pojęcia — odzyskuje jedno z utraconych. */
  steal?: boolean;
  win?: boolean;
}

export interface GameObject {
  id: string;
  name: string;
  /** Opis bazowy; `describe()` może go zniekształcić. */
  desc: string;
  /** Jeśli brakuje tego pojęcia, opis zastępuje `blindDesc`. */
  blind?: ConceptId;
  blindDesc?: string;
  verbs: Verb[];
}

export interface Exit {
  to: string;
  via: string;
  requires?: ConceptId[];
  needs?: string[];
  label?: string;
}

export interface Room {
  id: string;
  name: string;
  desc: string;
  objects: GameObject[];
  exits: Record<string, Exit>;
}

export interface ActionResult {
  ok: boolean;
  text: string;
  moved: boolean;
  lost: ConceptId | null;
  gained: ConceptId | null;
  ended: boolean;
  won: boolean;
}

export interface Duel {
  question: string;
  options: { label: string; concept: ConceptId; correct: boolean }[];
}

const DUELS: Duel[] = [
  {
    question: '„Czym nazywasz to, co znika, gdy przestajesz liczyć?"',
    options: [
      { label: 'liczby', concept: 'numbers', correct: true },
      { label: 'czerwień', concept: 'red', correct: false },
      { label: 'pismo', concept: 'writing', correct: false },
    ],
  },
  {
    question: '„Co musisz zapomnieć, żeby przestać wiedzieć, jak wejść?"',
    options: [
      { label: 'klucze', concept: 'keys', correct: false },
      { label: 'drzwi', concept: 'doors', correct: true },
      { label: 'woda', concept: 'water', correct: false },
    ],
  },
  {
    question: '„Które pojęcie czyni Cię bezpiecznym, bo pozwala uciec przede mną?"',
    options: [
      { label: 'strach', concept: 'fear', correct: true },
      { label: 'czas', concept: 'time', correct: false },
      { label: 'imiona', concept: 'names', correct: false },
    ],
  },
];

function makeRooms(): Record<string, Room> {
  const V = (id: string, label: string, text: string, extra: Partial<Verb> = {}): Verb =>
    ({ id, label, text, ...extra });
  return {
    westybul: {
      id: 'westybul', name: 'Westybul',
      desc: 'Wysoka sień z czerwonym dywanem, mosiężnymi lampami i tablicą numerów pokoi. Za oknem gęsty, szary deszcz.',
      exits: {
        północ: { to: 'korytarz', via: 'drzwi', requires: ['doors'] },
        wschód: { to: 'salon', via: 'łuk', label: 'Przejdź pod łukiem' },
      },
      objects: [
        {
          id: 'drzwi', name: 'Dębowe drzwi', desc: 'Ciężkie, z mosiężną klamką.',
          blind: 'doors', blindDesc: 'Gładka, dziwnie znajoma część ściany. Nie wiesz, do czego służy.',
          verbs: [
            V('open', 'Otwórz', 'Drzwi ustępują bez oporu.', { requires: ['doors'], move: 'korytarz' }),
          ],
        },
        {
          id: 'okno', name: 'Witrażowe okno', desc: 'Czerwone i niebieskie szybki w ołowianej ramie.',
          blind: 'red', blindDesc: 'Szare szybki w ołowianej ramie. Jedna jest pęknięta.',
          verbs: [
            V('break', 'Wybij szybę', 'Szkło dźwięczy. W dłoni zostaje ostry odłamek.', { give: 'odłamek' }),
            V('climb', 'Wejdź przez okno', 'Przeciskasz się do korytarza od wschodniej strony.', { move: 'korytarz' }),
          ],
        },
        {
          id: 'tablica', name: 'Tablica numerów', desc: 'Rzędy mosiężnych cyfr.',
          blind: 'writing', blindDesc: 'Rzędy zawijasów, które nic Ci nie mówią.',
          verbs: [
            V('read', 'Odczytaj', 'Zapisujesz plan piętra: skarbiec jest za kaplicą.',
              { requires: ['writing', 'numbers'], set: { plan: true } }),
          ],
        },
      ],
    },
    korytarz: {
      id: 'korytarz', name: 'Korytarz z zegarem',
      desc: 'Długa galeria portretów. Zegar z wahadłem odmierza coś, czego nie potrafisz nazwać.',
      exits: {
        południe: { to: 'westybul', via: 'drzwi', requires: ['doors'], label: 'Wróć' },
        zachód: { to: 'biblioteka', via: 'łuk' },
        północ: { to: 'gabinet', via: 'drzwi', requires: ['doors'] },
        wschód: { to: 'salon', via: 'łuk' },
      },
      objects: [
        {
          id: 'zegar', name: 'Zegar wahadłowy', desc: 'Wskazówki stoją na 23:40.',
          blind: 'time', blindDesc: 'Wskazówki stoją na „—".',
          verbs: [
            V('read-clock', 'Odczytaj godzinę', '23:40. To godzina z testamentu.',
              { requires: ['time'], set: { godzina: true } }),
            V('listen-clock', 'Przyłóż ucho', 'Wahadło wybija rytm: trzy, jeden, dwa.', { set: { rytm: true } }),
          ],
        },
        {
          id: 'szafa', name: 'Szafa z kluczami', desc: 'Rząd haczyków i mosiężnych kluczy.',
          blind: 'keys', blindDesc: 'Rząd haczyków z podłużnymi, niezrozumiałymi przedmiotami.',
          verbs: [
            V('take-key', 'Weź klucz', 'Klucz do skarbca jest ciężki i zimny.',
              { requires: ['keys'], give: 'klucz' }),
            V('pry', 'Podważ szafę odłamkiem', 'Zamek puszcza. Zabierasz pierwszy klucz.',
              { needs: ['odłamek'], give: 'klucz' }),
          ],
        },
        {
          id: 'dywan', name: 'Czerwony dywan', desc: 'W materiale widać cienką czerwoną nitkę.',
          blind: 'red', blindDesc: 'Szary dywan. Coś w nim się odstaje, ale nie wiesz co.',
          verbs: [
            V('pull', 'Pociągnij nitkę', 'Nitka prowadzi do portretu z podpisem.',
              { requires: ['red'], set: { nitka: true } }),
          ],
        },
      ],
    },
    biblioteka: {
      id: 'biblioteka', name: 'Biblioteka',
      desc: 'Regały do sufitu. Pachnie kurzem i woskiem. Na pulpicie leży rozłożony akt notarialny.',
      exits: { wschód: { to: 'korytarz', via: 'łuk' }, północ: { to: 'kaplica', via: 'krypta' } },
      objects: [
        {
          id: 'akt', name: 'Akt notarialny', desc: 'Staranny, czytelny zapis.',
          blind: 'writing', blindDesc: 'Kartka pełna zawijasów. Nie potrafisz jej odczytać.',
          verbs: [
            V('read-act', 'Przeczytaj', 'Akt wymienia właściciela sejfu i miejsce ukrycia dowodu.',
              { requires: ['writing'], set: { akt: true } }),
            V('listen-act', 'Odsłuchaj przez gramofon', 'Ktoś czyta akt na głos. Treść trafia do Ciebie uchem.',
              { needs: ['gramofon'], set: { akt: true } }),
          ],
        },
        {
          id: 'cenzor1', name: 'Cenzor w szarym płaszczu', desc: 'Siedzi nieruchomo. Nie ma twarzy, tylko puste miejsce po imieniu.',
          blind: 'names', blindDesc: 'Siedzi nieruchomo. Nie potrafisz go nazwać ani zawołać.',
          verbs: [
            V('duel1', 'Zagraj w pojęcia', 'Cenzor zadaje pytanie.', { duel: true }),
            V('ask-name', 'Zapytaj o imię', 'Cenzor podaje Ci imię, którego sam nie pamięta.',
              { requires: ['names'], gain: 'names', text: 'Odzyskujesz pojęcie imion.' }),
          ],
        },
        {
          id: 'polka', name: 'Półka z księgami', desc: 'Księgi o pojęciach, których nikt już nie używa.',
          verbs: [
            V('take-book', 'Weź księgę', 'Księga waży więcej, niż powinna.', { give: 'księga' }),
            V('study', 'Studiuj', 'Księga przypomina Ci jedno zapomniane pojęcie.',
              { needs: ['księga'], gain: 'writing' }),
          ],
        },
      ],
    },
    salon: {
      id: 'salon', name: 'Salon z gramofonem',
      desc: 'Pluszowe fotele, zgaszony kominek i gramofon z wielką tubą. Przy stoliku siedzi Handlarz.',
      exits: { zachód: { to: 'westybul', via: 'łuk' }, północ: { to: 'korytarz', via: 'łuk' } },
      objects: [
        {
          id: 'gramofon', name: 'Gramofon', desc: 'Igła drży nad płytą.',
          verbs: [
            V('take-gram', 'Zabierz płytę', 'Płyta nagrana jest czyimś głosem.', { give: 'gramofon' }),
            V('play', 'Odtwórz', 'Głos czyta napis z aktu. Pismo staje się zbędne.', { needs: ['gramofon'], set: { słyszane: true } }),
          ],
        },
        {
          id: 'handlarz', name: 'Handlarz pojęciami', desc: 'Układa na stoliku małe, przezroczyste słoiki.',
          blind: 'names', blindDesc: 'Ktoś układa słoiki. Nie wiesz, jak go zawołać.',
          verbs: [
            V('trade', 'Zaproponuj wymianę', 'Handlarz otwiera słoik i czeka na Twoją ofertę.', { trade: true }),
            V('steal-jar', 'Podważ słoik odłamkiem', 'Ostrze szkła otwiera wieko. W dłoni zostaje cudze pojęcie.',
              { needs: ['odłamek'], steal: true }),
          ],
        },
        {
          id: 'portret', name: 'Portret damy', desc: 'Czerwona wstęga i podpis u dołu.',
          blind: 'red', blindDesc: 'Szara wstęga i podpis u dołu.',
          verbs: [
            V('read-portrait', 'Odczytaj podpis', 'To Twoje imię. Wracają wspomnienia.',
              { requires: ['red', 'writing'], set: { imię: true } }),
          ],
        },
      ],
    },
    gabinet: {
      id: 'gabinet', name: 'Gabinet',
      desc: 'Ciężkie biurko, sejf z pokrętłem i popielniczka z jednym, wciąż czerwonym żarem.',
      exits: { południe: { to: 'korytarz', via: 'drzwi', requires: ['doors'] }, dół: { to: 'piwnica', via: 'klapa' } },
      objects: [
        {
          id: 'sejf', name: 'Sejf z pokrętłem', desc: 'Trzy obroty w lewo, dwa w prawo.',
          blind: 'numbers', blindDesc: 'Pokrętło bez oznaczeń. Liczby przestały cokolwiek znaczyć.',
          verbs: [
            V('open-safe', 'Ustaw szyfr', 'Sejf klika. W środku mikrofilm.',
              { requires: ['numbers'], needs: ['akt'], give: 'mikrofilm' }),
            V('force-safe', 'Rozbij zamek', 'Uderzasz odłamkiem, aż zamek pęka.',
              { needs: ['odłamek'], give: 'mikrofilm' }),
          ],
        },
        {
          id: 'zar', name: 'Żar w popielniczce', desc: 'Czerwony punkcik w popiele.',
          blind: 'red', blindDesc: 'Szary punkcik w popiele.',
          verbs: [
            V('touch', 'Dotknij', 'Parzy. Cenzor lubi ten zapach.', { requires: ['fear'], lose: 'fear' }),
          ],
        },
      ],
    },
    piwnica: {
      id: 'piwnica', name: 'Zalana piwnica',
      desc: 'Po kostki w przezroczystej substancji. W rogu coś pluska.',
      exits: { góra: { to: 'gabinet', via: 'klapa' }, północ: { to: 'skarbiec', via: 'studnia' } },
      objects: [
        {
          id: 'woda', name: 'Przezroczysta substancja', desc: 'Sięga do kostek.',
          blind: 'water', blindDesc: 'Coś sięga do kostek. Nie masz pojęcia co.',
          verbs: [
            V('drink', 'Zaczerpnij', 'Woda odbiera Ci strach, ale zostawia pustkę.',
              { requires: ['water'], lose: 'fear', set: { ochłodzony: true } }),
            V('wade', 'Przejdź w bród', 'Dno jest śliskie, ale przejście jest drożne.', { move: 'skarbiec' }),
          ],
        },
        {
          id: 'lampa', name: 'Naftowa lampa', desc: 'Jedyna rzecz, która tu świeci.',
          verbs: [
            V('take-lamp', 'Weź lampę', 'Lampa oświetli Ci drogę, ale Cenzorzy zobaczą Cię wcześniej.',
              { give: 'lampa', gain: 'light' }),
            V('break-lamp', 'Zgaś ją', 'Ciemność jest bezpieczniejsza.', { lose: 'light' }),
          ],
        },
      ],
    },
    kaplica: {
      id: 'kaplica', name: 'Kaplica bez okien',
      desc: 'Zimno. Drugi Cenzor stoi przed zamkniętą kratą.',
      exits: { południe: { to: 'biblioteka', via: 'krypta' }, wschód: { to: 'skarbiec', via: 'krata', needs: ['klucz'] } },
      objects: [
        {
          id: 'cenzor2', name: 'Drugi Cenzor', desc: 'Trzyma w dłoni słoik z czyimś pojęciem.',
          verbs: [
            V('duel2', 'Zagraj w pojęcia', 'Drugie pytanie wisi w powietrzu.', { duel: true }),
            V('bribe', 'Wręcz mikrofilm', 'Cenzor przyjmuje dar i oddaje jedno pojęcie.',
              { needs: ['mikrofilm'], gain: 'doors' }),
            V('snatch', 'Wyrwij słoik z dłoni', 'Księga odwraca jego uwagę. Zabierasz jedno pojęcie.',
              { needs: ['księga'], steal: true }),
          ],
        },
        {
          id: 'krata', name: 'Kraty', desc: 'Zamek na klucz.',
          blind: 'keys', blindDesc: 'Metalowa przeszkoda bez zrozumiałego mechanizmu.',
          verbs: [
            V('unlock', 'Otwórz kluczem', 'Krata ustępuje.', { requires: ['keys'], needs: ['klucz'], move: 'skarbiec' }),
            V('bend', 'Wygnij odłamkiem', 'Pręt pęka. Przeciskasz się bokiem.', { needs: ['odłamek'], move: 'skarbiec' }),
          ],
        },
      ],
    },
    skarbiec: {
      id: 'skarbiec', name: 'Skarbiec',
      desc: 'Półki z aktami. Na środku leży dowód, po który tu przyszedłeś.',
      exits: { południe: { to: 'kaplica', via: 'krata' }, północ: { to: 'sala', via: 'drzwi', requires: ['doors'] } },
      objects: [
        {
          id: 'dowod', name: 'Dowód', desc: 'Zapieczętowana koperta z czerwoną lakową pieczęcią.',
          blind: 'red', blindDesc: 'Zapieczętowana koperta z szarą pieczęcią.',
          verbs: [
            V('take-proof', 'Zabierz', 'Koperta jest Twoja.', { give: 'dowód', set: { dowód: true } }),
          ],
        },
        {
          id: 'okno-skarbiec', name: 'Wąski świetlik', desc: 'Prowadzi prosto do Sali Pojęć.',
          verbs: [
            V('squeeze', 'Przeciśnij się', 'Rezygnujesz z drzwi. Świetlik prowadzi dalej.', { move: 'sala' }),
          ],
        },
      ],
    },
    sala: {
      id: 'sala', name: 'Sala Pojęć',
      desc: 'Okrągłe pomieszczenie pełne pustych słoików. Pośrodku stoi pulpit z Twoim imieniem.',
      exits: { południe: { to: 'skarbiec', via: 'drzwi', requires: ['doors'] } },
      objects: [
        {
          id: 'pulpit', name: 'Pulpit z imieniem', desc: 'Napis czeka na odczytanie.',
          blind: 'names', blindDesc: 'Pulpit. Nie wiesz, co powinno na nim być.',
          verbs: [
            V('restore', 'Wypowiedz swoje imię', 'Świat przypomina sobie Ciebie.',
              { requires: ['names'], needs: ['dowód'], win: true, set: { pelne: true } }),
            V('restore-blind', 'Połóż dowód bez imienia', 'Słoiki zamykają się. Wychodzisz, ale nikt Cię nie zapamięta.',
              { needs: ['dowód'], win: true, set: { pelne: false } }),
          ],
        },
        {
          id: 'cenzor3', name: 'Trzeci Cenzor', desc: 'Ostatni strażnik.',
          verbs: [V('duel3', 'Zagraj w pojęcia', 'Ostatnie pytanie.', { duel: true })],
        },
      ],
    },
  };
}

export class ConceptWorld {
  readonly rooms: Record<string, Room>;
  owned: Set<ConceptId>;
  inventory: string[] = [];
  flags: Record<string, boolean> = {};
  current = 'westybul';
  losses = 0;
  duelsWon = 0;
  ended = false;
  won = false;
  endingText = '';
  log: string[] = [];
  private rng: Rng;
  private duelIndex = 0;
  activeDuel: Duel | null = null;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.rooms = makeRooms();
    this.owned = new Set(CONCEPTS.map((c) => c.id));
    this.note('Plaga Pojęć dotknęła dwór. Masz dziesięć pojęć i ani jednego punktu zdrowia.');
  }

  get room(): Room { return this.rooms[this.current]; }
  get lost(): ConceptId[] { return CONCEPTS.map((c) => c.id).filter((c) => !this.owned.has(c)); }

  private note(text: string): void {
    this.log.unshift(text);
    if (this.log.length > 60) this.log.length = 60;
  }

  has(id: ConceptId): boolean { return this.owned.has(id); }

  /** Zniekształca tekst zgodnie z utraconymi pojęciami. */
  render(text: string): string {
    let out = text;
    if (!this.owned.has('numbers')) {
      out = out.replace(/\d+/g, (m) => '§'.repeat(Math.min(5, m.length)));
      out = out.replace(/\b(trzy|dwa|jedn[ae]|cztery|pięć|dziesięć)\b/gi, 'bełkot');
    }
    if (!this.owned.has('names')) {
      for (const name of ['Handlarz', 'Cenzor', 'Bartel', 'Kreft']) {
        out = out.split(name).join('______');
      }
    }
    if (!this.owned.has('doors')) out = out.replace(/drzwi/gi, 'gładka część ściany');
    if (!this.owned.has('keys')) out = out.replace(/klucz\w*/gi, 'podłużny przedmiot');
    if (!this.owned.has('water')) out = out.replace(/wod\w*/gi, 'przezroczysta substancja');
    if (!this.owned.has('time')) out = out.replace(/\d{1,2}:\d{2}/g, '—');
    if (!this.owned.has('red')) out = out.replace(/czerwon\w*/gi, 'szare');
    if (!this.owned.has('writing')) out = out.replace(/«([^»]+)»/g, '«…bełkot…»');
    return out;
  }

  describe(object: GameObject): string {
    const base = object.blind && !this.owned.has(object.blind)
      ? (object.blindDesc ?? object.desc) : object.desc;
    return this.render(base);
  }

  private available(v: Verb): boolean {
    if (v.requires?.some((c) => !this.owned.has(c))) return false;
    if (v.needs?.some((item) => !this.inventory.includes(item))) return false;
    return true;
  }

  /** Akcje, które w tej chwili DOSŁOWNIE istnieją. Brakujące pojęcie = brak przycisku. */
  verbs(objectId: string): Verb[] {
    const obj = this.room.objects.find((o) => o.id === objectId);
    if (!obj) return [];
    return obj.verbs.filter((v) => this.available(v));
  }

  exits(): { dir: string; exit: Exit; open: boolean }[] {
    return Object.entries(this.room.exits).map(([dir, exit]) => ({
      dir, exit,
      open: !(exit.requires?.some((c) => !this.owned.has(c)))
        && !(exit.needs?.some((item) => !this.inventory.includes(item))),
    }));
  }

  lose(id: ConceptId): string {
    if (!this.owned.has(id)) return `${CONCEPT_MAP[id].label} już dawno zniknęło.`;
    this.owned.delete(id);
    this.losses += 1;
    const msg = `TRACISZ POJĘCIE: ${CONCEPT_MAP[id].label}. ${CONCEPT_MAP[id].consequence}`;
    this.note(msg);
    if (this.owned.size <= 2) {
      this.ended = true;
      this.won = false;
      this.endingText = 'Zostały Ci mniej niż trzy pojęcia. Dwór zapomniał Cię pierwszy.';
    }
    return msg;
  }

  gain(id: ConceptId): string {
    this.owned.add(id);
    this.note(`ODZYSKANO POJĘCIE: ${CONCEPT_MAP[id].label}.`);
    return `Odzyskujesz pojęcie „${CONCEPT_MAP[id].label}".`;
  }

  act(objectId: string, verbId: string): ActionResult {
    const fail = (text: string): ActionResult =>
      ({ ok: false, text, moved: false, lost: null, gained: null, ended: this.ended, won: this.won });
    if (this.ended) return fail('Gra już się zakończyła.');
    const obj = this.room.objects.find((o) => o.id === objectId);
    if (!obj) return fail('Nie ma tu takiego przedmiotu.');
    const verb = obj.verbs.find((v) => v.id === verbId);
    if (!verb || !this.available(verb)) return fail('Ta czynność w tej chwili nie istnieje.');

    if (verb.trade) { this.note('Handlarz czeka na wybór pojęć.'); return { ...this.ok(verb.text), text: verb.text }; }
    if (verb.duel) {
      this.activeDuel = DUELS[this.duelIndex % DUELS.length];
      this.duelIndex += 1;
      this.note(`Pojedynek: ${this.activeDuel.question}`);
      return { ...this.ok(verb.text), text: `${verb.text} ${this.activeDuel.question}` };
    }

    if (verb.steal) {
      const pool: ConceptId[] = this.lost.length > 0
        ? this.lost : CONCEPTS.map((c) => c.id);
      const stolen = this.rng.pick(pool);
      const text = `${this.render(verb.text)} ${this.gain(stolen)}`;
      return {
        ok: true, text, moved: false, lost: null, gained: stolen,
        ended: this.ended, won: this.won,
      };
    }

    let extra = '';
    if (verb.give && !this.inventory.includes(verb.give)) this.inventory.push(verb.give);
    if (verb.set) Object.assign(this.flags, verb.set);
    if (verb.lose) extra += ` ${this.lose(verb.lose)}`;
    if (verb.gain) extra += ` ${this.gain(verb.gain)}`;
    let moved = false;
    if (verb.move && this.rooms[verb.move]) { this.current = verb.move; moved = true; }
    let text = this.render(verb.text) + (extra ? ` ${this.render(extra)}` : '');
    if (moved) text += ` Przechodzisz: ${this.render(this.room.name)}.`;
    this.note(text);
    if (verb.win) {
      this.ended = true;
      this.won = true;
      this.endingText = this.flags.pelne
        ? 'Wypowiadasz swoje imię. Dwór przypomina sobie wszystkie pojęcia naraz.'
        : 'Wychodzisz z dowodem, ale bez imienia. Nikt nie potrafi Cię zapisać.';
      text += ` ${this.endingText}`;
      this.note(this.endingText);
    }
    return { ok: true, text, moved, lost: verb.lose ?? null, gained: verb.gain ?? null,
      ended: this.ended, won: this.won };
  }

  private ok(text: string): ActionResult {
    this.note(text);
    return { ok: true, text, moved: false, lost: null, gained: null, ended: this.ended, won: this.won };
  }

  go(dir: string): ActionResult {
    const entry = Object.entries(this.room.exits).find(([d]) => d === dir);
    if (!entry) return { ok: false, text: 'Nie ma takiego przejścia.', moved: false,
      lost: null, gained: null, ended: this.ended, won: this.won };
    const exit = entry[1];
    const missing = exit.requires?.find((c) => !this.owned.has(c));
    if (missing) return {
      ok: false, text: `Nie potrafisz skorzystać z tego przejścia: brakuje pojęcia „${CONCEPT_MAP[missing].label}".`,
      moved: false, lost: null, gained: null, ended: this.ended, won: this.won,
    };
    const item = exit.needs?.find((i) => !this.inventory.includes(i));
    if (item) return { ok: false, text: `Przejście wymaga przedmiotu: ${this.render(item)}.`,
      moved: false, lost: null, gained: null, ended: this.ended, won: this.won };
    this.current = exit.to;
    const text = `Przechodzisz: ${this.render(this.room.name)}.`;
    this.note(text);
    return { ok: true, text, moved: true, lost: null, gained: null, ended: this.ended, won: this.won };
  }

  /** Odpowiedź w pojedynku z Cenzorem. Błąd = utrata wskazanego pojęcia. */
  answerDuel(optionIndex: number): ActionResult {
    if (!this.activeDuel) return { ok: false, text: 'Nie trwa żaden pojedynek.', moved: false,
      lost: null, gained: null, ended: this.ended, won: this.won };
    const option = this.activeDuel.options[optionIndex];
    this.activeDuel = null;
    if (!option) return { ok: false, text: 'Nie ma takiej odpowiedzi.', moved: false,
      lost: null, gained: null, ended: this.ended, won: this.won };
    if (!option.correct) {
      const text = `Błędna odpowiedź. ${this.lose(option.concept)}`;
      return { ok: true, text, moved: false, lost: option.concept, gained: null,
        ended: this.ended, won: this.won };
    }
    this.duelsWon += 1;
    const missing = this.lost;
    let text = 'Cenzor milknie. Zabierasz mu jedno pojęcie.';
    if (missing.length > 0) {
      const gained = this.rng.pick(missing);
      text += ` ${this.gain(gained)}`;
      return { ok: true, text, moved: false, lost: null, gained, ended: this.ended, won: this.won };
    }
    this.flags.cenzor = true;
    return { ok: true, text, moved: false, lost: null, gained: null, ended: this.ended, won: this.won };
  }

  /** Handel: oddaj posiadane pojęcie, odbierz jedno z utraconych. */
  trade(give: ConceptId, receive: ConceptId): ActionResult {
    const base = { moved: false, ended: this.ended, won: this.won };
    if (!this.owned.has(give)) return { ...base, ok: false, text: 'Nie masz już tego pojęcia.', lost: null, gained: null };
    if (this.owned.has(receive)) return { ...base, ok: false, text: 'To pojęcie już posiadasz.', lost: null, gained: null };
    this.owned.delete(give);
    this.owned.add(receive);
    this.losses += 1;
    const text = `Oddajesz „${CONCEPT_MAP[give].label}", dostajesz „${CONCEPT_MAP[receive].label}". ` +
      `${CONCEPT_MAP[receive].consequence}`;
    this.note(text);
    return { ...base, ok: true, text, lost: give, gained: receive };
  }

  get score(): number {
    const kept = this.owned.size * 12;
    const flags = Object.values(this.flags).filter(Boolean).length * 8;
    const duels = this.duelsWon * 20;
    const win = this.won ? (this.flags.pelne ? 120 : 60) : 0;
    return Math.max(0, kept + flags + duels + win - this.losses * 4);
  }
}
