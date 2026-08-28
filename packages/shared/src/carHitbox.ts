/**
 * Az AUTO utkozo dobozai -- MERT ertekek.
 *
 * GENERALT FAJL -- ne szerkeszd kezzel. A
 * packages/client/scripts/auto-meret.ts allitja elo a jarmu-modellbol
 * (npm run auto-meret).
 *
 * MIERT TOBB DOBOZ: a talalatot korabban egyetlen doboz dontotte el, a
 * modell teljes befoglaloja. Az also felen ez jo, a KABIN magassagaban
 * viszont az auto 1,4-1,8 m szeles es 2-2,8 m hosszu, a doboz meg vegig
 * 2,18 x 4,91 -- a motorhaztetö es a csomagtarto FOLOTTI levego is
 * talalatnak szamitott.
 *
 * Merve: a regi doboz 16.2 m3, ez a 6 doboz 11.6 m3
 * (72%), es MINDEGYIK a regi dobozon belul van -- tehat
 * senki nem lett eltalalhatobb, csak a hamis talalatok tuntek el.
 *
 * A koordinatak az auto sajat rendszereben ertendok, az origo a fizikai
 * doboz kozeppontja (+Z hatra, +Y felfele).
 *
 * A FEGYVER NINCS benne: az celzaskor elfordul, tehat egy
 * auto-rogzitett doboz vagy nem fedne, vagy a teljes soport teruletet
 * lefoglalna.
 */

export interface CarBox {
  /** Kozeppont az auto sajat rendszereben. */
  dx: number;
  dy: number;
  dz: number;
  /** Fel-meretek. */
  hx: number;
  hy: number;
  hz: number;
}

export const CAR_BOXES: CarBox[] = [
  { dx: 0, hx: 0.918, dy: -0.627, hy: 0.128, dz: 0.264, hz: 2.137 },
  { dx: 0.002, hx: 0.948, dy: -0.175, hy: 0.325, dz: -0.006, hz: 2.449 },
  { dx: 0, hx: 1.09, dy: 0.225, hy: 0.075, dz: 0.074, hz: 2.311 },
  { dx: 0, hx: 1.09, dy: 0.35, hy: 0.05, dz: 0.192, hz: 1.448 },
  { dx: 0.002, hx: 0.873, dy: 0.475, hy: 0.075, dz: 0.227, hz: 1.369 },
  { dx: 0.002, hx: 0.781, dy: 0.653, hy: 0.102, dz: 0.375, hz: 1.051 },
];
