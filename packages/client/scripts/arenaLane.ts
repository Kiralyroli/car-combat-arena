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
export const LANE_X = -10;

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
  const margin = CHASSIS.halfExtents.x + 0.5;
  return ARENA.filter((box) => {
    if (box.position.y + box.halfExtents.y < 0.3) return false;
    if (Math.abs(box.position.x - LANE_X) - box.halfExtents.x - margin >= 0) {
      return false;
    }
    const z0 = box.position.z - box.halfExtents.z - CHASSIS.halfExtents.z;
    const z1 = box.position.z + box.halfExtents.z + CHASSIS.halfExtents.z;
    return z1 > LANE_NEAR_Z && z0 < LANE_FAR_Z;
  }).map((box) => box.name);
}

/** A sav leirasa a teszt-uzenetekhez. */
export function laneLabel(): string {
  const blockers = blockersInLane();
  return blockers.length === 0
    ? `x=${LANE_X}, z ${LANE_NEAR_Z}..${LANE_FAR_Z}`
    : `x=${LANE_X}: utban van ${blockers.join(", ")}`;
}
