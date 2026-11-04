export interface GameInfo {
  id: string;
  title: string;
  description: string;
  tag: string;
  players: string;
  color: string;
  accent: string;
  art: string;
  ready: boolean;
  /** Krótki claim na banerze strony głównej. */
  claim: string;
}

/** Jeden grywalny świat. Katalog nie zawiera zapowiedzi ani placeholderów. */
export const GAMES: GameInfo[] = [
  {
    id: 'demonofobia',
    title: 'Demonofobia',
    description:
      'Dom przy Wrzosowej 12. Wejdź z latarką, zbierz sześć śladów i rozpoznaj zjawę, zanim skończą Ci się nerwy.',
    tag: 'Horror · Dochodzenie',
    players: 'Dochodzenie solo · Lobby online',
    color: '#8b7355',
    accent: '#3f4a4a',
    art: `${import.meta.env.BASE_URL}art/house.jpg`,
    ready: true,
    claim: 'Nocne dochodzenie w opuszczonym domu. Samochód-baza, pas z sześcioma narzędziami, dziesięć zjaw i nalot.',
  },
];

/** Nazwa Lobby (to nie jest osobna gra). */
export const LOBBY_NAME = 'Lobby';

export const PALETTE = [
  { name: 'Bursztyn', value: '#c8a06a' },
  { name: 'Szary błękit', value: '#6f8a86' },
  { name: 'Rdza', value: '#a4654c' },
  { name: 'Piasek', value: '#b9a37d' },
  { name: 'Stal', value: '#7d8791' },
  { name: 'Śliwka', value: '#8a6b78' },
];

/**
 * Gotowe, rigowane postacie Microsoft Rocketbox (MIT). Każdy plik ma już
 * własną fryzurę, twarz i ubranie — 9 sylwetek męskich i 4 żeńskie.
 * `file` to nazwa GLB w public/characters/ (jedno źródło prawdy dla UI i 3D).
 */
export interface CharacterModel {
  name: string;
  female: boolean;
  file: string;
  look: string;
}

export const CHARACTER_MODELS: CharacterModel[] = [
  { name: 'Marek', female: false, file: 'Male_Adult_01', look: 'polo w paski i szorty' },
  { name: 'Tomek', female: false, file: 'Male_Adult_02', look: 'jasna koszula' },
  { name: 'Adam', female: false, file: 'Male_Adult_03', look: 'wełniany komplet' },
  { name: 'Bruno', female: false, file: 'Male_Adult_04', look: 'kamizelka taktyczna' },
  { name: 'Czesław', female: false, file: 'Male_Adult_06', look: 'czerwone polo i dżinsy' },
  { name: 'Damian', female: false, file: 'Male_Adult_08', look: 'niebieska koszula' },
  { name: 'Eryk', female: false, file: 'Business_Male_01', look: 'czarny garnitur' },
  { name: 'Filip', female: false, file: 'Gardener_Male_01', look: 'brązowa kurtka robocza' },
  { name: 'Gustaw', female: false, file: 'Medical_Male_02', look: 'kurtka ratownika' },
  { name: 'Alicja', female: true, file: 'Female_Adult_01', look: 'blond, polo i dżinsy' },
  { name: 'Ewa', female: true, file: 'Business_Female_01', look: 'czarny żakiet i spódnica' },
  { name: 'Nina', female: true, file: 'Female_Adult_03', look: 'fioletowa bluzka' },
  { name: 'Iza', female: true, file: 'Female_Adult_05', look: 'różowa koszula i dżinsy' },
];

export const SKIN_TONES = [
  { name: 'Bardzo jasna', value: '#f2d9bd' },
  { name: 'Jasna', value: '#e6c39f' },
  { name: 'Średnia', value: '#d3a377' },
  { name: 'Oliwkowa', value: '#bf9169' },
  { name: 'Brązowa', value: '#9c6a45' },
  { name: 'Ciemna', value: '#714630' },
];

export const HAIR_COLORS = [
  { name: 'Czarny', value: '#241c17' },
  { name: 'Ciemny brąz', value: '#4b3020' },
  { name: 'Brąz', value: '#8a5c33' },
  { name: 'Blond', value: '#e0c48a' },
  { name: 'Rudy', value: '#a9502c' },
  { name: 'Siwy', value: '#d5d3cd' },
];

/**
 * Gotowe ubrania z TEJ SAMEJ paczki Rocketbox. Zamiast dorabiać geometrię,
 * podmieniamy wyłącznie teksturę korpusu (body) na inną, już gotową wersję
 * z profesjonalnymi strojami: garniturem, fartuchem, mundurem itd. Szkielet,
 * UV, głowa i fryzura zostają nietknięte, więc nie ma z-fightingu ani
 * "kartonowych" nakładek. Zero własnych meshów ubrań.
 */
export interface OutfitDef {
  id: string;
  value: string;
  name: string;
  description: string;
  color: string;
  /** Nazwa pliku, z którego bierzemy *_body_color.jpg i *_body_normal.jpg. */
  body: string;
  /**
   * Modele żeńskie mają INNY układ UV korpusu (ręce u góry, nogi na dole),
   * więc tekstura męska na damskim szkielecie daje „pończochy z rękawów”.
   * Każdy strój ma więc własny, gotowy wariant damski z tej samej paczki.
   */
  bodyFemale: string;
}

export const OUTFITS: OutfitDef[] = [
  { id: 'casual', value: 'casual', name: 'Polo i szorty', description: 'Koszulka w paski i krótkie spodnie.', color: '#b7ada0', body: 'Male_Adult_01', bodyFemale: 'Female_Adult_01' },
  { id: 'shirt', value: 'shirt', name: 'Koszula', description: 'Klasyczna koszula i spodnie.', color: '#8f9aa6', body: 'Male_Adult_02', bodyFemale: 'Female_Adult_05' },
  { id: 'sweater', value: 'sweater', name: 'Wełniany komplet', description: 'Marynarka, kamizelka i bordowy krawat.', color: '#7d7266', body: 'Male_Adult_03', bodyFemale: 'Female_Adult_03' },
  { id: 'city', value: 'city', name: 'Taktyczny', description: 'Czarna kamizelka z niebieskimi wstawkami.', color: '#59636c', body: 'Male_Adult_04', bodyFemale: 'Business_Female_01' },
  { id: 'suit', value: 'suit', name: 'Garnitur', description: 'Marynarka, krawat, eleganckie spodnie.', color: '#3b424b', body: 'Business_Male_01', bodyFemale: 'Business_Female_01' },
  { id: 'workwear', value: 'workwear', name: 'Roboczy', description: 'Koszula robocza i spodnie z kieszeniami.', color: '#6f7a5c', body: 'Gardener_Male_01', bodyFemale: 'Female_Adult_05' },
  { id: 'medical', value: 'medical', name: 'Ratownik', description: 'Niebieska kurtka z odblaskami.', color: '#4a70b8', body: 'Medical_Male_02', bodyFemale: 'Female_Adult_03' },
  { id: 'office', value: 'office', name: 'Biurowy', description: 'Żakiet i elegancka bluzka.', color: '#8b6d78', body: 'Business_Male_01', bodyFemale: 'Business_Female_01' },
];

/** Klucz tekstury korpusu właściwy dla płci wybranego modelu. */
export function outfitBody(outfit: OutfitDef, female: boolean): string {
  return female ? outfit.bodyFemale : outfit.body;
}

export function getOutfit(id: string): OutfitDef {
  return OUTFITS.find((entry) => entry.id === id) ?? OUTFITS[0];
}
