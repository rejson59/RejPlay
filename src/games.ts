export interface GameInfo {
  id: string;
  title: string;
  description: string;
  tag: string;
  players: string;
  color: string;
  accent: string;
  art?: string;
  ready: boolean;
  category: 'horror' | 'social' | 'race' | 'platform';
}

/** Katalog gierek. Na etapie prototypu dane są statyczne — później przyjdzie tu Supabase. */
export const GAMES: GameInfo[] = [
  {
    id: 'zimny-slad',
    title: 'Zimny Ślad',
    description:
      'Dom przy Wrzosowej 12. Wejdź z latarką, zbierz trzy dowody i rozpoznaj zjawę, zanim stracisz nerwy.',
    tag: 'Horror · Dochodzenie',
    players: '1–4 graczy',
    color: '#8b7355',
    accent: '#3f4a4a',
    art: '/art/house.jpg',
    ready: true,
    category: 'horror',
  },
  {
    id: 'plaza',
    title: 'Plaza Kulki',
    description:
      'Spokojne lobby, w którym spotykasz innych graczy, machasz na powitanie i wybierasz kolejną gierkę.',
    tag: '3D · Social',
    players: 'do 12 graczy',
    color: '#7a6a55',
    accent: '#4a5a58',
    art: '/art/plaza.jpg',
    ready: true,
    category: 'social',
  },
  {
    id: 'wyscig',
    title: 'Kulkowy Wyścig',
    description: 'Tocz się po torze, zbieraj przyspieszenia i wyprzedzaj znajomych na ostatniej prostej.',
    tag: '3D · Wyścigi',
    players: 'do 8 graczy',
    color: '#8a5f4c',
    accent: '#a08a5c',
    ready: false,
    category: 'race',
  },
  {
    id: 'skok',
    title: 'Skok nad Kropkami',
    description: 'Platformówka z jedną zasadą: skacz od kulki do kulki i nie spadnij z plazy.',
    tag: '3D · Platformer',
    players: '1–6 graczy',
    color: '#4d6660',
    accent: '#6f6250',
    ready: false,
    category: 'platform',
  },
];

export const PALETTE = [
  { name: 'Bursztyn', value: '#c8a06a' },
  { name: 'Szary błękit', value: '#6f8a86' },
  { name: 'Rdza', value: '#a4654c' },
  { name: 'Piasek', value: '#b9a37d' },
  { name: 'Stal', value: '#7d8791' },
  { name: 'Śliwka', value: '#8a6b78' },
];

/** Wygląd postaci: model ( fryzura / sylwetka ) + barwy nakładane na tekstury. */
export const CHARACTER_MODELS = [
  { name: 'Alicja', female: true },
  { name: 'Marek', female: false },
  { name: 'Ewa', female: true },
  { name: 'Tomek', female: false },
  { name: 'Nina', female: true },
  { name: 'Iza', female: true },
];

export const SKIN_TONES = [
  { name: 'Bardzo jasna', value: '#fff1e4' },
  { name: 'Jasna', value: '#f3ddc3' },
  { name: 'Średnia', value: '#e0bd97' },
  { name: 'Oliwkowa', value: '#c59a70' },
  { name: 'Brązowa', value: '#a57149' },
  { name: 'Ciemna', value: '#7c4d31' },
];

export const HAIR_COLORS = [
  { name: 'Czarny', value: '#241c17' },
  { name: 'Ciemny brąz', value: '#4b3020' },
  { name: 'Brąz', value: '#8a5c33' },
  { name: 'Blond', value: '#c8a562' },
  { name: 'Rudy', value: '#93442a' },
  { name: 'Siwy', value: '#b8b4ac' },
];

export const OUTFIT_COLORS = [
  { name: 'Oryginał', value: '#ffffff' },
  { name: 'Szary', value: '#9aa2a8' },
  { name: 'Oliwka', value: '#7f8c75' },
  { name: 'Granat', value: '#6c7889' },
  { name: 'Rdza', value: '#b27a5f' },
  { name: 'Grafit', value: '#6d7075' },
];

/** Boty w lobby. Docelowo zastąpią ich gracze z Colyseusa. */
export const BOTS = [
  { name: 'Bąbel', color: '#6f8a86' },
  { name: 'Sferka', color: '#a4654c' },
  { name: 'Kulka_07', color: '#b9a37d' },
  { name: 'Miki', color: '#7d8791' },
];
