export type GameId = 'centrala' | 'pasozyt' | 'gluchy-swiat' | 'amnezja';

export interface GameMeta {
  id: GameId;
  number: string;
  title: string;
  subtitle: string;
  genre: string;
  hook: string;
  features: string[];
  accent: string;
  glyph: string;
}

export const GAMES: GameMeta[] = [
  {
    id: 'centrala', number: 'I', title: 'Centrala',
    subtitle: 'Analogowy thriller szpiegowski',
    genre: 'Immersive sim · jedno pomieszczenie · dedukcja',
    hook: 'Lawina odcięła kurort. Na poddaszu masz tylko tablicę z wtyczkami. Morderca jest na linii.',
    features: [
      'Przepinaj kable między 12 abonentami hotelu',
      'Podsłuchuj — ale złe przełączenie zostawia klik i podejrzenia',
      'Nagrywaj szpule, montuj taśmy i skłócaj gości',
      'Odcinaj prąd, blokuj windę, zmieniaj bieg nocy',
    ],
    accent: '#d9a441', glyph: '⌁',
  },
  {
    id: 'pasozyt', number: 'II', title: 'Pasożyt',
    subtitle: 'Biologiczny city-builder',
    genre: 'Strategia · żywa mapa · balans chciwości',
    hook: 'Twoje miasto rośnie wewnątrz stworzenia wielkości kontynentu. Mapa ma tętno i może umrzeć.',
    features: [
      'Wapń z kości, tlen z krwi, hormony z gruczołów',
      'Zapalenie rozlewa się po tkance i wywołuje gorączkę',
      'Leukocyty atakują struktury — wieżyczki je oszukują',
      'Łataj rany gospodarza, bo inaczej zginiesz razem z nim',
    ],
    accent: '#a8d5b5', glyph: '❋',
  },
  {
    id: 'gluchy-swiat', number: 'III', title: 'Głuchy Świat',
    subtitle: 'Skrytobójstwo oparte na fizyce dźwięku',
    genre: 'Stealth · echolokacja · first person',
    hook: 'Ekran jest czarny. Widzisz tylko to, od czego odbije się dźwięk — a każdy dźwięk zdradza Cię w ciemności.',
    features: [
      'Pstryknięcie, kamień, kamerton: trzy zakresy „światła"',
      'Beton, metal, woda i szkło brzmią i gasną inaczej',
      'Dywan na szkle, mechaniczna zabawka jako wabik',
      'Zagłuszacz oślepia Słuchaczy hałasem',
    ],
    accent: '#9aa8cf', glyph: '◉',
  },
  {
    id: 'amnezja', number: 'IV', title: 'Amnezja Pojęciowa',
    subtitle: 'Surrealistyczna przygoda logiczna',
    genre: 'Puzzle RPG · obrażenia zmieniają zasady',
    hook: 'Nie masz HP. Masz pojęcia. Gdy je tracisz, gra dosłownie zapomina, czym są drzwi, liczby albo czerwień.',
    features: [
      'Utrata „drzwi" kasuje akcję Otwórz — zostaje okno',
      'Utrata „liczb" zamienia cyfry w bełkot',
      'Utrata „czerwieni" wygasza kolor w całym świecie',
      'Kradnij, handluj i odzyskuj pojęcia od Cenzorów',
    ],
    accent: '#d69a9a', glyph: '✧',
  },
];

export interface GameContext {
  root: HTMLElement;
  audio: AudioEngineLike;
  save: SaveLike;
  onFinish(result: GameResult): void;
}

export interface GameResult {
  won: boolean;
  score: number;
  summary: string;
}

export interface AudioEngineLike {
  play(name: string, options?: Record<string, number | string>): void;
  startDrone(kind: string): void;
  stopDrone(): void;
  get muted(): boolean;
  setMuted(value: boolean): void;
}

export interface SaveLike {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
  record(game: GameId, result: GameResult): void;
  best(game: GameId): GameResult | null;
}

export interface Game {
  mount(ctx: GameContext): void;
  dispose(): void;
}
