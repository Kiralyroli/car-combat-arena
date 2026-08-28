/**
 * Szabad sav az arenaban, a rammeles-teszteknek.
 *
 * MIERT KULON FAJL: a check:collision es a check:death is egymasnak
 * hajtja a ket autot, tehat mindkettonek kell egy akadalymentes sav --
 * es ugyanaz a csapda varja oket. A sav korabban x=0 volt, aztan a
 * palya 120 m-esre nott, es EPPEN oda kerult egy konteneres fedezek
 * (container_n, x=0, z=25.5). Ettol mindket teszt ugy bukott, mintha
 * az utkozes-kezeles vagy a sebzes romlott volna el: az auto egy meter
 * utan nekiment a ladanak, a becsapodasi sebesseg 0 lett, a masik auto
 * meg sem mozdult. A sav EGY helyen van leirva, es a tesztek
 * ELLENORZIK is a szabadsagat -- igy a kovetkezo palya-atrendezes
 * hangosan bukik el, nem csendesen felrevezet.
 */
import { ARENA, CHASSIS } from "@cca/shared";

/** A sav kozepvonala (x). */
export const LANE_X = -12;

/** A nekifuto auto helye a savban (z). */
export const LANE_FAR_Z = 18;

/** Az allo (celpont) auto helye a savban (z). */
export const LANE_NEAR_Z = -18;

/**
 * Szabad-e a sav a ket auto kozott?
 *
 * A talaj es a lapos elemek (pl. a rampa alja) nem szamitanak: azokon
 * az auto athajt. Az auto felszelessegevel es fel-hosszaval szamolunk,
 * mert nem egy pont halad a savban.
 */
export function laneIsClear(): boolean {
  return blockersInLane().length === 0;
}

/** Mi all a savban -- a hibauzenethez, hogy ne kelljen talalgatni. */
export function blockersInLane(): string[] {
  return blockersBetween(LANE_X, LANE_NEAR_Z, LANE_FAR_Z);
}

/** Mi all utban egy adott x-sav adott z-szakaszan. */
function blockersBetween(x: number, z0: number, z1: number): string[] {
  const margin = CHASSIS.halfExtents.x + 0.5;
  const also = Math.min(z0, z1);
  const felso = Math.max(z0, z1);
  return ARENA.filter((box) => {
    if (box.position.y + box.halfExtents.y < 0.3) return false;
    if (Math.abs(box.position.x - x) - box.halfExtents.x - margin >= 0) {
      return false;
    }
    const b0 = box.position.z - box.halfExtents.z - CHASSIS.halfExtents.z;
    const b1 = box.position.z + box.halfExtents.z + CHASSIS.halfExtents.z;
    return b1 > also && b0 < felso;
  }).map((box) => box.name);
}

/**
 * LOALLASOK: ket pont egymassal szemben, kozottuk szabad lo-vonallal.
 *
 * A fegyver-tesztek korabban kezzel beirt koordinatakat hasznaltak
 * (25, 20) es (25, 8). Amikor a palyara valodi epuletek kerultek, az
 * egyik EPP egy nyitott rakodoszin oszlopsora moge esett: a celzas jo
 * volt, a lovedek megis a szin gerendajaba csapodott, es a tesztek ugy
 * bukottak, mintha a fegyver romlott volna el. Ezert vannak itt, egy
 * helyen -- es ezert ellenorzi a lo-vonalat is a laneIsClear parja.
 */
export const SHOOT_X = -41;
/** A lovo helye. */
export const SHOOT_FAR_Z = 23;
/** A celpont helye -- 12 m-re, ami a gepfegyver kenyelmes tavolsaga. */
export const SHOOT_NEAR_Z = 11;

/** Szabad-e a LO-VONAL a ket loallas kozott? */
export function shootLineIsClear(): boolean {
  return blockersBetween(SHOOT_X, SHOOT_NEAR_Z, SHOOT_FAR_Z).length === 0;
}

/** A loallasok leirasa a teszt-uzenetekhez. */
export function shootLabel(): string {
  const b = blockersBetween(SHOOT_X, SHOOT_NEAR_Z, SHOOT_FAR_Z);
  return b.length === 0
    ? `x=${SHOOT_X}, z ${SHOOT_NEAR_Z} -> ${SHOOT_FAR_Z}`
    : `x=${SHOOT_X}: utban van ${b.join(", ")}`;
}

/** A sav leirasa a teszt-uzenetekhez. */
export function laneLabel(): string {
  const blockers = blockersInLane();
  return blockers.length === 0
    ? `x=${LANE_X}, z ${LANE_NEAR_Z}..${LANE_FAR_Z}`
    : `x=${LANE_X}: utban van ${blockers.join(", ")}`;
}
