/**
 * A LEGNAGYOBB auto merete.
 *
 * Amikor azt kerdezzuk, "elfer-e itt egy auto" -- szabad-e a sav, van-e
 * hely a szuletesi ponton, fedezek-e ez az epulet --, a valasz nem
 * lehet a Sedané. Tiz kocsi kozul lehet valasztani, 3,7 es 5,8 m kozott:
 * ami a Sedannak atjaro, az a pickupnak fal.
 *
 * Ezert MINDEN ilyen kerdesnel a legnagyobbal szamolunk. Igy a valasz
 * MINDEN autora igaz -- es nem csak arra az egyre, amivel eppen
 * merunk.
 *
 * Tengelyenkent kulon maximum: nem egy konkret auto merete, hanem egy
 * burkolo doboz. Igy nem kell azt eldonteni, "melyik a legnagyobb"
 * (a Pickup a leghosszabb, a SUV a legmagasabb).
 */
import { CAR_GEOMETRY } from "./carGeometry";
import { CAR_MODELS, DEFAULT_CAR, type CarId } from "./carModels";

function maxFel(tengely: "x" | "y" | "z"): number {
  return Math.max(
    ...CAR_MODELS.map((m) => CAR_GEOMETRY[m.id].halfExtents[tengely]),
  );
}

/** A legnagyobb auto fel-meretei tengelyenkent. */
export const LARGEST_CAR_HALF = {
  x: maxFel("x"),
  y: maxFel("y"),
  z: maxFel("z"),
} as const;

/**
 * A KAMERA-tavolsag szorzoja egy autohoz.
 *
 * A koveto kamera helye eddig egyetlen, rogzitett eltolas volt (a
 * sedanhoz beallitva). Egy 5,8 m-es pickupnal ez azt jelenti, hogy a
 * kamera majdnem a csomagteroben ul: a kocsi kitolti a kepernyot, es a
 * jatekos nem latja, mi van elotte -- egy alacsony sportkocsinal pedig
 * feleslegesen tavol van.
 *
 * EGYETLEN, kozos szorzo (nem tengelyenkent kulon): igy a kamera SZOGE
 * valtozatlan marad, csak a tavolsaga no. Ha a magassagot es a
 * tavolsagot kulon aranyositanank, minden autonal mas lenne a
 * ranezes szoge -- es a korulnezes celkereszt-helye is elcsuszna.
 *
 * A HOSSZ es a MAGASSAG kozul a nagyobbik arany szamit: a pickup a
 * hossza miatt kell tavolabb, a SUV a magassaga miatt.
 *
 * A Sedanra pontosan 1 -- vagyis a jatek eddigi kameraja valtozatlan.
 */
export function cameraScaleFor(car: CarId): number {
  const alap = CAR_GEOMETRY[DEFAULT_CAR].halfExtents;
  const sajat = CAR_GEOMETRY[car].halfExtents;
  return Math.max(sajat.z / alap.z, sajat.y / alap.y);
}
