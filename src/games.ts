export interface GameInfo {
  id: string;
  title: string;
  description: string;
  tag: string;
  players: string;
  color: string;
  accent: string;
  ready: boolean;
}

/** Katalog gierek. Na etapie prototypu dane są statyczne — później przyjdzie tu Supabase. */
export const GAMES: GameInfo[] = [
  {
    id: 'plaza',
    title: 'Plaza Kulki',
    description: 'Główne lobby. Spotykaj się z innymi, biegaj i wybieraj kolejne gierki przez portale.',
    tag: '3D · Social',
    players: 'do 12 graczy',
    color: '#7c5cff',
    accent: '#42e8b4',
    ready: true,
  },
  {
    id: 'wyscig',
    title: 'Kulkowy Wyścig',
    description: 'Tocz się po torze, zbieraj przyspieszenia i wyprzedzaj znajomych na ostatniej prostej.',
    tag: '3D · Wyścigi',
    players: 'do 8 graczy',
    color: '#ff7a6b',
    accent: '#ffd166',
    ready: false,
  },
  {
    id: 'skok',
    title: 'Skok nad Kropkami',
    description: 'Platformówka z jedną zasadą: skacz od kulki do kulki i nie spadnij z plazy.',
    tag: '3D · Platformer',
    players: '1–6 graczy',
    color: '#42e8b4',
    accent: '#7c5cff',
    ready: false,
  },
  {
    id: 'kolory',
    title: 'Kolorowa Gra',
    description: 'Zbieraj kulki w swoim kolorze i zamieniaj plazę na swoją barwę, zanim skończy się czas.',
    tag: '3D · Party',
    players: 'do 10 graczy',
    color: '#ffd166',
    accent: '#ff7a6b',
    ready: false,
  },
];

export const PALETTE = [
  { name: 'Fiolet', value: '#7c5cff' },
  { name: 'Mięta', value: '#42e8b4' },
  { name: 'Koral', value: '#ff7a6b' },
  { name: 'Słońce', value: '#ffd166' },
  { name: 'Błękit', value: '#5aa9ff' },
  { name: 'Róż', value: '#ff8fd0' },
];

/** Boty w lobby. Docelowo zastąpią ich gracze z Colyseusa. */
export const BOTS = [
  { name: 'Bąbel', color: '#42e8b4' },
  { name: 'Sferka', color: '#ff8fd0' },
  { name: 'Kulka_07', color: '#ffd166' },
  { name: 'Miki', color: '#5aa9ff' },
];
