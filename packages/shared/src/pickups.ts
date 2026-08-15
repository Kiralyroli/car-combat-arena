/**
 * Boost pickup a palyan (terv 4. lepcso 4. pont).
 *
 * A pickupot a SZERVER birtokolja (terv 15.4): o dönti el, ki vette
 * fel es mikor bukkan fel ujra. E nelkul ket jatekos ugyanazt a
 * pickupot venne fel a sajat kepernyojen, es mindketto jogosnak
 * erezne.
 *
 * MIERT IDOZITETT EXTRA, es nem maga a boost:
 * a Shift-boost mar letezik es KORLATLAN (DRIVE.boostMultiplier). Egy
 * olyan pickup, ami "boostot ad", ezert semmit nem jelentene. A pickup
 * helyette egy erosebb, IDOZITETT tullokest ad a normal boost fole --
 * igy van ertelme erte elmenni, es az alap vezetes valtozatlan marad.
 * (Ha a boost kesobb korlatozott eroforras lesz, ez a modul a
 * termeszetes helye annak is.)
 */

/** Ekkora sugaron belul (m) veszi fel az auto. */
export const PICKUP_RADIUS = 3;

/** Meddig hat a felvett tullokes (ms). */
export const BOOST_PICKUP_DURATION_MS = 4000;

/**
 * A tullokes szorzoja a NORMAL boost fole.
 *
 * A ketto osszeszorzodik: 1.9 * 1.5 = 2.85-szoros hajtoero teljes
 * gazzal. Erezheto, de nem uralja a merkozest.
 */
export const BOOST_PICKUP_MULTIPLIER = 1.5;

/** Felvetel utan ennyi ido mulva (ms) bukkan fel ujra ugyanott. */
export const PICKUP_RESPAWN_MS = 12000;

/** Milyen magasan lebeg a talaj felett (m). */
export const PICKUP_HEIGHT = 1.2;

/**
 * A pickupok helye a palyan.
 *
 * KEZZEL valasztott pontok, mint a SPAWN_POINTS: az arena kozepe fele
 * huznak, hogy erte menni kockazattal jarjon, es egyik se essen
 * akadalyba. (A check-pickups.ts ellenorzi, hogy tenyleg szabadok.)
 */
export const PICKUP_POINTS: { x: number; y: number; z: number }[] = [
  // FIGYELEM: egyik pont sem eshet spawn-pontra. A (0, 0) kezenfekvő
  // valasztas lenne (az arena kozepe), de az EPPEN a CHASSIS.spawn --
  // igy minden csatlakozo jatekos azonnal felszedte volna, meg mielott
  // a szerver a sajat spawn-pontjara allitja. A check-pickups.ts ezt
  // most kulon ellenorzi.
  { x: 0, y: PICKUP_HEIGHT, z: 8 },
  { x: 16, y: PICKUP_HEIGHT, z: 16 },
  { x: -8, y: PICKUP_HEIGHT, z: 12 },
  { x: 12, y: PICKUP_HEIGHT, z: -12 },
  { x: -16, y: PICKUP_HEIGHT, z: -12 },
];

/**
 * Felveheto-e a pickup ebbol a poziciobol?
 *
 * Vizszintes tavolsagot merunk: a pickup a talaj felett lebeg, az auto
 * kozeppontja pedig alatta van -- fuggoleges kulonbseggel egyutt merve
 * at lehetne hajtani alatta felvetel nelkul.
 */
export function withinPickupRange(
  carPosition: readonly number[],
  pickup: { x: number; z: number },
): boolean {
  const dx = carPosition[0] - pickup.x;
  const dz = carPosition[2] - pickup.z;
  return dx * dx + dz * dz <= PICKUP_RADIUS * PICKUP_RADIUS;
}
