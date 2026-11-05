/**
 * Układ gotowych modeli GLB w parku Lobby i na podwórku Demonofobii.
 *
 * v0.9: dane wydzielone z `real-scenery.ts` do czystego modułu bez THREE i
 * `import.meta.env`, żeby test mógł przeliczyć REALNY rozmiar każdego obiektu
 * z nagłówka GLB. To ważne: `Lantern.glb` z Khronos ma 25,66 m wysokości
 * w jednostkach pliku, a zwykły mnożnik `scale: 2.2` dawał 56-metrową lampę
 * w parku o promieniu 12 m — zasłaniała całe Lobby. Od teraz każdy model
 * albo ma jawną `height` w metrach, albo podlega twardemu limitowi.
 */

export interface SceneryProp {
  /** Ścieżka względem public/assets/ — jedno źródło prawdy dla katalogu. */
  file: string;
  /** Mnożnik skali dla modeli w jednostkach „miejskich" (GridFall). */
  scale: number;
  position: [number, number, number];
  rotation?: number;
  /** Podmienia plakat w gotowym modelu (tablica „Lobby"). */
  poster?: string;
  /** Ładujemy także na słabszych urządzeniach, gdzie bierzemy tylko podzbiór. */
  essential?: boolean;
  /** Docelowa wysokość w METRACH — ignoruje `scale`, liczy się z bbox GLB. */
  height?: number;
}

/** Najwyższy pojedynczy obiekt w parku: korona dębu ma 6,4 m. */
export const MAX_PROP_HEIGHT = 7;

/**
 * Układ parku: alejki i trawniki są w `park.ts`, a KAŻDY widoczny obiekt to
 * gotowy model GLB. Kolejność ma znaczenie: początek listy to elementy, bez
 * których park wyglądałby pusto nawet na słabym urządzeniu.
 */
export const LOBBY_PROPS: readonly SceneryProp[] = Object.freeze([
  // Fontanna na środku, wiata, tablica i ławki — dawne „bryły" zastąpione GLB.
  { file: 'props/fountain.glb', scale: 9, position: [0, 0, 0], essential: true },
  { file: 'library/ulica/billboard.glb', scale: 7, position: [-7.8, 0, 0.8], rotation: 1.2, poster: 'Lobby', essential: true },
  { file: 'library/ulica/bus_shelter.glb', scale: 16, position: [6.6, 0, -4.4], rotation: 0.5, essential: true },
  { file: 'props/bench_park.glb', scale: 16, position: [-3.2, 0, 5.8], rotation: -0.5, essential: true },
  { file: 'props/bench_park.glb', scale: 16, position: [3.2, 0, 5.8], rotation: 0.5 },
  { file: 'props/bench_park.glb', scale: 16, position: [-5.4, 0, -3.4], rotation: 1.1 },
  { file: 'props/bench_park.glb', scale: 16, position: [5.4, 0, -3.4], rotation: -1.1 },
  { file: 'props/planter_round.glb', scale: 15, position: [-4.4, 0, 2.4] },
  { file: 'props/planter_round.glb', scale: 15, position: [4.4, 0, -2.4] },
  { file: 'library/przedmioty/DiffuseTransmissionPlant.glb', scale: 1.5, position: [7.5, 0, -2.2] },
  { file: 'library/przedmioty/GlassVaseFlowers.glb', scale: 2.6, position: [-8.9, 0, 2.1] },
  // Khronos trzyma ten model w jednostkach 25× większych niż metr. Bez
  // `height` lampa miała 56 m i zasłaniała cały park (v0.8).
  { file: 'library/przedmioty/Lantern.glb', scale: 2.2, height: 1.6, position: [-2.7, 0, 2.7] },
  { file: 'library/przedmioty/Lantern.glb', scale: 2.2, height: 1.6, position: [2.7, 0, -2.7] },
  { file: 'props/rock_boulder.glb', scale: 16, position: [-7.4, 0, 0.7], rotation: 0.3 },
  { file: 'props/rock_boulder.glb', scale: 14, position: [-8.1, 0, 1.5], rotation: 1.2 },
  { file: 'props/rock_boulder.glb', scale: 12, position: [-6.7, 0, 1.6], rotation: 2.1 },
  { file: 'props/picnic_table.glb', scale: 14, position: [-8.8, 0, 3.9], rotation: 0.4 },
  { file: 'props/picnic_table.glb', scale: 14, position: [8.6, 0, 3.6], rotation: -0.4 },
  // Korony drzew wokół polany.
  { file: 'props/tree_oak.glb', scale: 15, position: [-9.4, 0, -2.6], essential: true },
  { file: 'props/tree_birch.glb', scale: 14, position: [9.6, 0, 1.8], essential: true },
  { file: 'props/tree_round.glb', scale: 13, position: [-6.4, 0, 8.4] },
  { file: 'library/roslinnosc/tree_conifer.glb', scale: 14, position: [7.6, 0, -7.8] },
  { file: 'library/roslinnosc/tree_poplar.glb', scale: 13, position: [-9.8, 0, 6.8] },
  { file: 'library/roslinnosc/tree_small.glb', scale: 15, position: [9.8, 0, 8.0] },
  { file: 'props/tree_bush.glb', scale: 15, position: [4.4, 0, -4.8] },
  { file: 'props/tree_bush.glb', scale: 15, position: [-4.2, 0, -8.6] },
  { file: 'library/roslinnosc/tree_hedge.glb', scale: 15, position: [-8.4, 0, -7.4], rotation: 0.4 },
  { file: 'library/roslinnosc/tree_hedge.glb', scale: 15, position: [8.6, 0, 5.8], rotation: 1.2 },
  // Woda, ławki i donice.
  { file: 'props/fountain.glb', scale: 12, position: [-6.8, 0, -5.6] },
  { file: 'props/bench_modern.glb', scale: 16, position: [-5.6, 0, 3.4], rotation: -0.5 },
  { file: 'props/bench_modern.glb', scale: 16, position: [5.7, 0, 6.0], rotation: 2.7 },
  { file: 'props/planter_round.glb', scale: 16, position: [-4.7, 0, 4.4] },
  { file: 'props/planter_round.glb', scale: 16, position: [4.7, 0, -4.4] },
  // Światła i mała architektura miejska.
  { file: 'props/lamp_double.glb', scale: 11, position: [-10.0, 0, 1.2], rotation: 0.3 },
  { file: 'props/lamp_street.glb', scale: 11, position: [10.0, 0, -6.2], rotation: -0.4 },
  { file: 'props/lamp_classic.glb', scale: 11, position: [3.4, 0, 9.4] },
  { file: 'library/ulica/bike_rack.glb', scale: 16, position: [-2.9, 0, 9.6] },
  { file: 'library/ulica/street_sign.glb', scale: 16, position: [2.9, 0, 9.4], rotation: -0.5 },
  { file: 'library/ulica/parking_meter.glb', scale: 16, position: [9.4, 0, 4.6] },
  { file: 'props/trash_bin.glb', scale: 14, position: [-7.2, 0, 6.4] },
  { file: 'props/bollard.glb', scale: 16, position: [-2.2, 0, 6.7] },
  { file: 'props/bollard.glb', scale: 16, position: [2.2, 0, 6.7] },
]);

/** Podwórko Demonofobii pozostaje nocne i ciasne — to osobny świat gry. */
export const YARD_PROPS: readonly SceneryProp[] = Object.freeze([
  { file: 'props/lamp_street.glb', scale: 11, position: [-3.3, 0, 11.2], rotation: Math.PI / 2 },
  { file: 'props/tree_birch.glb', scale: 13, position: [-3.5, 0, 16.4] },
  { file: 'props/tree_bush.glb', scale: 16, position: [-2.9, 0, 10.6] },
  { file: 'props/tree_bush.glb', scale: 16, position: [3.3, 0, 16.9] },
  { file: 'props/barrier_concrete.glb', scale: 13, position: [-3.4, 0, 17.4], rotation: Math.PI / 2 },
  { file: 'props/cone.glb', scale: 16, position: [-1.9, 0, 10.1] },
  { file: 'props/cone.glb', scale: 16, position: [1.9, 0, 10.1] },
  { file: 'props/trash_bin_wheelie.glb', scale: 14, position: [3.3, 0, 10.4] },
  { file: 'props/aircon_unit.glb', scale: 13, position: [7.9, 0.9, 8.6], rotation: Math.PI },
  { file: 'props/hydrant.glb', scale: 16, position: [-3.4, 0, 13.4] },
]);

/** Pliki, które wchodzą do testu rozmiaru (bez duplikatów). */
export function allSceneryFiles(): string[] {
  return [...new Set([...LOBBY_PROPS, ...YARD_PROPS].map((p) => p.file))].sort();
}
