import { CHASSIS } from "./config";
import { rotateVec } from "./math";
import type { ClientState } from "./net/protocol";

/**
 * Utkozesi sebzes -- a SZERVER dontese (terv 4. lepcso 1-2. pont).
 *
 * A hibrid modellben a kliens birtokolja a sajat mozgasat, de a
 * kovetkezmenyeket (sebzes, HP, talalat) kizarolag a szerver szamolja
 * (terv 15.4). Ezert a szerver NEM fogad el "eltalaltak" bejelentest a
 * klienstol: sajat maga vizsgalja meg a mar plauzibilitas-ellenorzott
 * allapotokbol, hogy ket auto osszeert-e, es mekkora sebesseggel.
 *
 * SZANDEKOSAN tiszta fuggvenyek a shared csomagban: headless
 * tesztelhetok, es a meretek ugyanabbol a configbol jonnek, mint a
 * fizika.
 */

/** Kezdo (es maximalis) karosszeria-HP. */
export const MAX_HP = 100;

/**
 * Ez alatt a kozeledesi sebesseg (m/s) alatt nincs sebzes.
 *
 * Kell egy holtsav: a jatekosok surlodhatnak, egymas mellett allhatnak,
 * es a halozati ingadozas is okoz apro atfedeseket. E nelkul az
 * egymasnak tamaszkodas is folyamatosan HP-t vonna le.
 */
export const MIN_DAMAGING_IMPACT = 6;

/** Mennyi sebzes jut egy m/s kozeledesi sebessegre a holtsav felett. */
const DAMAGE_PER_MPS = 2.2;

/**
 * Egy utkozes legfeljebb ennyi sebzest okoz.
 *
 * Szembe-becsapodasnal a kozeledesi sebesseg a ket auto sebessegenek az
 * OSSZEGE (akar 90 m/s), ami korlat nelkul azonnal kivegezne a teljes
 * eletu jatekost is. A rammeles legyen erős, de ne egy-loveses.
 */
const MAX_DAMAGE_PER_IMPACT = 55;

/**
 * Ket utkozes kozott ennyi ideig (ms) nem sebzunk ugyanazt a part.
 *
 * Az erintkezes tobb ticken at tart; e nelkul egyetlen koccanas is
 * masodpercenkent tucatnyi sebzest okozna.
 */
export const IMPACT_COOLDOWN_MS = 600;

/**
 * Ennyi ideig (ms) marad megsemmisulve az auto, mielott ujraszuletne.
 *
 * Legyen erezheto buntetes, de ne unalmas varakozas -- a Last Car
 * Standing modban (terv 5. lepcso) ez ugyis eletekre valt at.
 */
export const RESPAWN_DELAY_MS = 3000;

/** Fuggoleges atfedes: egymas felett atrepulo autok ne sebezzenek. */
const VERTICAL_OVERLAP = CHASSIS.halfExtents.y * 2;

interface Footprint {
  x: number;
  z: number;
  /** Elore (orr) irany a vizszintes sikban, egysegvektor. */
  fx: number;
  fz: number;
  /** Fel-meret az orr iranyaban es arra merolegesen. */
  halfLength: number;
  halfWidth: number;
}

function footprintOf(state: ClientState): Footprint {
  const [qx, qy, qz, qw] = state.rotation;
  const nose = rotateVec({ x: qx, y: qy, z: qz, w: qw }, { x: 0, y: 0, z: -1 });
  const len = Math.hypot(nose.x, nose.z) || 1;
  return {
    x: state.position[0],
    z: state.position[2],
    fx: nose.x / len,
    fz: nose.z / len,
    halfLength: CHASSIS.halfExtents.z,
    halfWidth: CHASSIS.halfExtents.x,
  };
}

/** A teglalap kiterjedese egy adott irany menten (szeparalo tengely teszt). */
function projectionRadius(f: Footprint, nx: number, nz: number): number {
  // Az orrra meroleges irany a vizszintes sikban: (-fz, fx).
  const alongLength = Math.abs(f.fx * nx + f.fz * nz) * f.halfLength;
  const alongWidth = Math.abs(-f.fz * nx + f.fx * nz) * f.halfWidth;
  return alongLength + alongWidth;
}

/**
 * Osszeer-e a ket auto?
 *
 * Vizszintesen SZEPARALO TENGELY teszt ket elforgatott teglalapra --
 * nem gombokkel kozelitunk, mert az auto hosszu es keskeny (4.9 x 2.2 m):
 * egy kozos sugarral az egymas mellett elhalado autok is "utkoznenek".
 */
export function carsOverlap(a: ClientState, b: ClientState): boolean {
  if (Math.abs(a.position[1] - b.position[1]) > VERTICAL_OVERLAP) return false;

  const fa = footprintOf(a);
  const fb = footprintOf(b);
  const dx = fb.x - fa.x;
  const dz = fb.z - fa.z;

  // Negy tengely: mindket teglalap ket iranya.
  const axes: [number, number][] = [
    [fa.fx, fa.fz],
    [-fa.fz, fa.fx],
    [fb.fx, fb.fz],
    [-fb.fz, fb.fx],
  ];

  for (const [nx, nz] of axes) {
    const distance = Math.abs(dx * nx + dz * nz);
    if (distance > projectionRadius(fa, nx, nz) + projectionRadius(fb, nx, nz)) {
      // Talaltunk olyan tengelyt, amin szetvalnak -> nincs atfedes.
      return false;
    }
  }
  return true;
}

/**
 * Milyen gyorsan kozelednek egymashoz (m/s).
 *
 * A KOZEPPONTOKAT osszekoto tengelyre vetitett relativ sebesseg.
 * Pozitiv = kozelednek. A tavolodo (mar szetvalo) autok igy nem kapnak
 * ujabb sebzest, ami kulonben egy koccanas utan meg egyszer levonodna.
 */
export function approachSpeed(a: ClientState, b: ClientState): number {
  const dx = b.position[0] - a.position[0];
  const dy = b.position[1] - a.position[1];
  const dz = b.position[2] - a.position[2];
  const distance = Math.hypot(dx, dy, dz) || 1;

  const rvx = a.velocity[0] - b.velocity[0];
  const rvy = a.velocity[1] - b.velocity[1];
  const rvz = a.velocity[2] - b.velocity[2];

  return (rvx * dx + rvy * dy + rvz * dz) / distance;
}

/** Mennyi sebzest okoz egy adott kozeledesi sebessegu becsapodas. */
export function collisionDamage(approach: number): number {
  if (approach <= MIN_DAMAGING_IMPACT) return 0;
  const raw = (approach - MIN_DAMAGING_IMPACT) * DAMAGE_PER_MPS;
  return Math.min(Math.round(raw), MAX_DAMAGE_PER_IMPACT);
}

/**
 * A tamado ennyiszeresét kapja az alap sebzesnek, az elszenvedo ennyit.
 *
 * Aki nekimegy a masiknak, jarjon jobban -- ez teszi a rammelest
 * ertelmes tamado eszkozze (terv 3. fejezet: "oldalrol kilokni az
 * ellenfelet, nagy sebesseggel nekimenni"). A ketto atlaga 1, igy a
 * szimmetrikus (szembe) utkozes ugyanannyit sebez, mint korabban.
 */
const ATTACKER_DAMAGE_FACTOR = 0.5;
const VICTIM_DAMAGE_FACTOR = 1.5;

export interface DamageSplit {
  a: number;
  b: number;
}

/**
 * Az utkozes sebzesenek elosztasa a ket auto kozott.
 *
 * Azt nezzuk, KI HALAD A MASIK FELE: mindket auto sebessegenek az
 * erintkezesi tengelyre eso, kozeledo osszetevojet. Akinek ez nagyobb,
 * az a tamado, es aranyosan KEVESEBB sebzest kap.
 *
 * A megoszlas SIMA, nem "vagy tamado, vagy aldozat": ha ketten
 * egyforman mennek egymasnak (szembe-utkozes), a ket resz egyenlo, es
 * ugyanoda jutunk, mint az iranyfuggetlen valtozatnal. Igy nincs
 * ugras a ket eset kozott -- egy hajszallal nagyobb sebesseg nem
 * fordithatja at hirtelen az egesz sebzest.
 */
export function splitCollisionDamage(a: ClientState, b: ClientState): DamageSplit {
  const total = collisionDamage(approachSpeed(a, b));
  if (total <= 0) return { a: 0, b: 0 };

  // Erintkezesi tengely: A-tol B fele.
  const dx = b.position[0] - a.position[0];
  const dy = b.position[1] - a.position[1];
  const dz = b.position[2] - a.position[2];
  const distance = Math.hypot(dx, dy, dz) || 1;
  const nx = dx / distance;
  const ny = dy / distance;
  const nz = dz / distance;

  // Ki mennyivel halad a masik fele (a negativ = tavolodik, nem szamit).
  const towardB = Math.max(
    0,
    a.velocity[0] * nx + a.velocity[1] * ny + a.velocity[2] * nz,
  );
  const towardA = Math.max(
    0,
    -(b.velocity[0] * nx + b.velocity[1] * ny + b.velocity[2] * nz),
  );

  const sum = towardB + towardA;
  // Ha egyik sem halad a masik fele (pl. oldalra sodrodas), maradjon
  // az egyenlo elosztas.
  const aggressionA = sum > 0 ? towardB / sum : 0.5;

  // A korlat a FELOSZTAS UTAN hat, kulonben az aldozat-szorzoval
  // tullephetne: 55 * 1.5 = 82 HP egyetlen becsapodasbol, ami egy
  // teljes eletu jatekost majdnem kivegezne. A merés ezt meg is
  // mutatta (egyetlen rammeles 100 HP-t vitt).
  return {
    a: capDamage(total * damageFactorFor(aggressionA)),
    b: capDamage(total * damageFactorFor(1 - aggressionA)),
  };
}

function capDamage(value: number): number {
  return Math.min(Math.round(value), MAX_DAMAGE_PER_IMPACT);
}

/** 0 = tiszta aldozat, 1 = tiszta tamado. */
function damageFactorFor(aggression: number): number {
  return (
    VICTIM_DAMAGE_FACTOR +
    (ATTACKER_DAMAGE_FACTOR - VICTIM_DAMAGE_FACTOR) * aggression
  );
}
