/**
 * Osszevetes: egyezik-e a KERT loves iranya a BEVALLOTT celzassal?
 *
 * MIERT VAN ERRE SZUKSEG
 *
 * Az agyu lovese egy CELPONTOT kuld (FireMessage.target), a celzas
 * szoge (aimYaw, aimPitch) viszont teljesen kulon utazik, az
 * allapot-folyamban. A szerver a kettot sokaig nem vetette ossze --
 * pedig a kliensen ugyanabbol az EGY pontbol szarmazik mindketto (lasd
 * main.ts: `view.aimPointAt` -> `net.fire`, illetve `currentAim`).
 *
 * A hianyzo ellenorzes ket dolgot engedett meg:
 *
 *  1. A csalo a rakétát pontosan a celpontra kuldhette, mikozben a
 *     tetőn levő vetot barmerre forditotta. A protokoll sajat kommentje
 *     mondja ki, hogy a celzas azert megy at, mert TAKTIKAI informacio
 *     -- "latni, hogy az ellenfel eppen rad celoz-e". Ez az informacio
 *     igy hazudhato volt, sot a csalonak erdeke volt hazudni.
 *  2. Az agyus aimbot a szerver szamara teljesen lathatatlan maradt:
 *     nem volt olyan adat, amiben a "tokeletes celzas" meglatszott
 *     volna.
 *
 * MIT NEM CSINAL
 *
 * Ez NEM aimbot-detektalas. Egy csalo tovabbra is tokeletesen celozhat
 * -- csak mar a celzas-folyamban is meg kell tennie. Cserebe: a
 * tobbiek LATJAK, hogy rajuk cel, es a celzas bekerul abba az adatba,
 * amit a szerver merni tud (lasd aimStats.ts).
 *
 * SZANDEKOSAN tiszta fuggveny a shared csomagban: headless tesztelheto,
 * es ugyanaz a szog-konvencio vonatkozik ra, mint a fegyverekre.
 */

import { aimDirection } from "../weapons";

/**
 * Ekkora szogeltérésig fogadjuk el (radian, kb. 45 fok).
 *
 * MIERT ENNYIRE LAZA? Mert a ket adat KET KULONBOZO PILLANATBAN
 * keletkezik. A celzas 20 Hz-en megy at (SNAPSHOT_HZ), a kattintas
 * viszont barmikor johet -- legrosszabb esetben 25 ms-mal a legkozelebbi
 * mintavetel utan. Egy gyors egerrantasnal (nagysagrendileg 1200 fok/s)
 * ennyi ido alatt is 30 fokot fordul a celzas. Egy szorosabb hatar
 * tehat a BECSULETES jatekost buntetne, ott, ahol a leggyorsabban
 * reagal -- es a lovese magyarazat nelkul veszne el.
 *
 * A laza hatar is elzarja viszont azt, amirol szol: hatrafele lőni,
 * mikozben elore celzunk (90 fok folott), mar nem megy.
 */
export const MAX_AIM_MISMATCH_RAD = Math.PI / 4;

/** Ket egysegvektor kozotti szog (radian). */
function angleBetween(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // A lebegopontos hiba kivihetne a tartomanybol, es az acos NaN-t adna
  // -- egy NaN pedig itt csendben "nem gyanus" eredmenyt jelentene.
  return Math.acos(Math.min(1, Math.max(-1, dot)));
}

/**
 * Mekkora a szogeltérés a kert loves iranya es a bevallott celzas
 * kozott?
 *
 * @param origin A fegyver forgaspontja (innen indul a loves).
 * @param target A kliens altal kert celpont.
 * @returns A szog radianban, vagy null, ha a celpont ertelmezhetetlen
 *          (nem szam, vagy egybeesik a forgasponttal).
 */
export function aimMismatchRad(
  origin: readonly [number, number, number],
  target: readonly number[],
  aimYaw: number,
  aimPitch: number,
): number | null {
  if (!target.every((v) => Number.isFinite(v))) return null;
  if (!Number.isFinite(aimYaw) || !Number.isFinite(aimPitch)) return null;

  const dx = target[0] - origin[0];
  const dy = target[1] - origin[1];
  const dz = target[2] - origin[2];
  const len = Math.hypot(dx, dy, dz);
  // Kozvetlenul a forgasponton: nincs ertelmes irany. Ilyenkor nem
  // dontunk -- a hivo dolga, hogy ezt ne tekintse bizonyiteknak.
  if (len < 1e-3) return null;

  return angleBetween(
    [dx / len, dy / len, dz / len],
    aimDirection(aimYaw, aimPitch),
  );
}
