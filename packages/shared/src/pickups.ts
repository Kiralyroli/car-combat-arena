/**
 * Boost pickup a palyan (terv 4. lepcso 4. pont).
 *
 * A pickupot a SZERVER birtokolja (terv 15.4): o dönti el, ki vette
 * fel es mikor bukkan fel ujra. E nelkul ket jatekos ugyanazt a
 * pickupot venne fel a sajat kepernyojen, es mindketto jogosnak
 * erezne.
 *
 * A BOOST KORLATOS EROFORRAS: a Shift addig hat, amig van a
 * tartalyban, es a pickup tolti vissza. Korabban a boost korlatlan
 * volt, es a pickup egy kulon "tullokest" adott fole -- de korlatlan
 * boost mellett a visszatoltesnek nincs ertelme, ezert a ketto egyben
 * valtozott meg.
 *
 * A TARTALY a kliensnel van, a VISSZATOLTES a szervernel: a boost
 * fogyasztasa a vezetes resze (terv 15.4: a sajat mozgas a kliense,
 * nulla input laggel), a felvetel viszont kozos eroforras, amirol
 * csak a szerver dönthet.
 */

/** Ekkora sugaron belul (m) veszi fel az auto. */
export const PICKUP_RADIUS = 3;

/**
 * Mennyi boost fer a tartalyba, BOOSTOLASSAL TOLTOTT idoben merve (ms).
 *
 * A boost korlatos eroforras: a Shift addig hat, amig van benne. 5 s
 * folyamatos boost eleg egy elozeshez vagy egy menekuleshez, de nem
 * lehet vegig nyomva tartani -- e nelkul a pickupnak nem lenne
 * ertelme, mert a boost amugy is mindig rendelkezesre allna.
 */
export const BOOST_CAPACITY_MS = 5000;

/** A felvett pickup ennyit tolt vissza a tartalybol (0..1). */
export const BOOST_REFILL_FRACTION = 0.5;

/** Egy pickup ennyi ms boostot ad vissza. */
export const BOOST_REFILL_MS = BOOST_CAPACITY_MS * BOOST_REFILL_FRACTION;

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
