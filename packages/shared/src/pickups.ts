/**
 * Pickupok a palyan (terv 4. lepcso 4. pont).
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

/**
 * Milyen fajta pickupok vannak.
 *
 * A fajta a KOZOS configban van, nem a halozaton: igy a kliens magatol
 * tudja, mit rajzoljon, es a snapshotban tovabbra is eleg a puszta
 * "felveheto-e" jelzes pickuponkent.
 */
export type PickupKind = "boost" | "health";

export interface PickupPoint {
  x: number;
  y: number;
  z: number;
  kind: PickupKind;
}

/**
 * Mennyi HP-t tolt vissza egy elet-pickup.
 *
 * 40 a 100-bol: SZANDEKOSAN nem teljes gyogyulas. Egy teli visszatoltes
 * eltorolne az egesz addigi parbajt -- aki eppen nyerésre all, ujra
 * kezdhetne. Igy viszont a 20 HP-val menekulo jatekos visszakerul a
 * harcba (60-ra), de tovabbra is serulekeny marad.
 *
 * A KEREKEKET NEM javitja: a kerek-serules az agyu sajat hatasa (terv
 * 4.6), es ha egy pickup eltuntetne, az elvenne a rakéta ertelmet. A
 * pickup a karosszeriat foltozza, nem a futomuvet.
 */
export const HEALTH_RESTORE = 40;

/** Boost-pickup: felvetel utan ennyi ido mulva bukkan fel ujra (ms). */
export const BOOST_RESPAWN_MS = 12000;

/**
 * Elet-pickup: felvetel utan ennyi ido mulva bukkan fel ujra (ms).
 *
 * Jóval hosszabb a boostenal, es kevesebb helyen is van belole: az elet
 * a szukosabb eroforras. Ha ugyanolyan surun allna rendelkezesre, a
 * sebzesnek nem lenne tetje -- mindenki egyszeruen elmenne foltozni
 * magat. A ket szam aranyat a check:pickups kulon ellenorzi.
 */
export const HEALTH_RESPAWN_MS = 32000;

export function pickupRespawnMs(kind: PickupKind): number {
  return kind === "health" ? HEALTH_RESPAWN_MS : BOOST_RESPAWN_MS;
}

/** Milyen magasan lebeg a talaj felett (m). */
export const PICKUP_HEIGHT = 1.2;

/**
 * A pickupok helye a palyan.
 *
 * KEZZEL valasztott pontok, mint a SPAWN_POINTS: az arena kozepe fele
 * huznak, hogy erte menni kockazattal jarjon, es egyik se essen
 * akadalyba. (A check-pickups.ts ellenorzi, hogy tenyleg szabadok.)
 */
export const PICKUP_POINTS: PickupPoint[] = [
  // FIGYELEM: egyik pont sem eshet spawn-pontra. A (0, 0) kezenfekvő
  // valasztas lenne (az arena kozepe), de az EPPEN a CHASSIS.spawn --
  // igy minden csatlakozo jatekos azonnal felszedte volna, meg mielott
  // a szerver a sajat spawn-pontjara allitja. A check-pickups.ts ezt
  // most kulon ellenorzi.
  { x: 0, y: PICKUP_HEIGHT, z: 8, kind: "boost" },
  { x: 16, y: PICKUP_HEIGHT, z: 16, kind: "boost" },
  { x: -8, y: PICKUP_HEIGHT, z: 12, kind: "boost" },
  { x: 12, y: PICKUP_HEIGHT, z: -12, kind: "boost" },
  { x: -16, y: PICKUP_HEIGHT, z: -12, kind: "boost" },

  // ELET: kevesebb es ritkabb, ezert NYITOTT, jol belathato helyen --
  // erte menni dontes legyen, ne utkozben felszedheto apróság.
  //
  // Az arena kozepe korul, szimmetrikusan: mindenkinek nagyjabol
  // ugyanannyit kell kockaztatnia erte. Az elso valasztasom (-4, -2) es
  // (18, -2) volt, de azokat a check:pickups elutasitotta -- tul kozel
  // estek a kezdo spawn-hoz, illetve a (22, 0) spawn-ponthoz.
  { x: -8, y: PICKUP_HEIGHT, z: 0, kind: "health" },
  { x: 8, y: PICKUP_HEIGHT, z: 0, kind: "health" },
];

/** Egy fajta pickupjainak sorszamai -- a rajzolashoz es a meresekhez. */
export function pickupIndicesOf(kind: PickupKind): number[] {
  const indices: number[] = [];
  for (let i = 0; i < PICKUP_POINTS.length; i++) {
    if (PICKUP_POINTS[i].kind === kind) indices.push(i);
  }
  return indices;
}

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
