import { SPAWN_POINTS } from "./config";
import { aimDirection } from "./weapons";

/**
 * Ujraszuletes: hova, es mennyi ideig vedve.
 *
 * A PROBLEMA, amit ez megold: a regi valasztas az elso szabad
 * spawn-pontot adta, es az ellenfelek helyet EGYALTALAN nem nezte. Ket
 * jatekosnal ez kiszamithatoan oszcillalt (2 -> 0 -> 2 -> 0), tehat par
 * halal utan az ellenfel megtanulta, hol fogsz megjelenni.
 *
 * GEOMETRIA. Amikor ez a modul keszult, az arena 80x80 m volt, es a ket
 * legtavolabbi spawn-pont kozott is csak 62 m -- a gepfegyver hatotava
 * viszont 70. Vagyis MINDEN spawn lotavolsagon belul volt minden
 * masikbol, es a "szulessen tavolabb" strategia egyszeruen nem
 * mukodott.
 *
 * A palya azota 120x120 m: a legtavolabbi par mar a hatotavon KIVUL
 * van, a legkozelebbi (33 m) viszont bőven belul. A tavolsag tehat
 * ismet valodi tenyezo -- de a kozeli parok miatt a celzas iranya
 * (lasd lentebb) es a serthetetlenseg (SPAWN_PROTECTION_MS) tovabbra is
 * kell. A pontos szamokat a check:spawn tartja naprakeszen.
 */

/**
 * Meddig serthetetlen az ujraszuletett jatekos (ms).
 *
 * Ot masodperc -- ugyanannyi, mint maga a varakozas (RESPAWN_DELAY_MS).
 * Bo ido: az auto 1.4 mp alatt gyorsul 100 km/h-ra. SZANDEKOSAN ilyen
 * hosszu: itt minden halal egy ELETBE kerul, es a kozeli spawn-parok
 * (33 m) bőven a gepfegyver hatotavan belul vannak.
 *
 * A vedelem TUZELESRE megszunik (lasd Room.stepWeapons es tryFire): aki
 * lo, az mar nem menekul, hanem harcol. Ez a fek tartja egyensulyban a
 * hosszu idot -- e nelkul a vedett jatekos bunteten tamadhatna.
 *
 * TUDOTT KOMPROMISSZUM: az UTKOZES nem tori meg. A vedett auto nem
 * sebez es nem sebzodik, de fizikailag meg mindig lokdos -- ot
 * masodpercig lehet vele akadalyoskodni. Kar nem szarmazik belole (a
 * palyan nincs szakadek vagy hasonlo), de ha zavaronak bizonyul, az
 * utkozes is megtorheti majd a vedelmet.
 */
export const SPAWN_PROTECTION_MS = 5000;

/**
 * Egy fenyeges ellenfel: hol van, es merre cel.
 *
 * A celzas iranya azert kell, mert a puszta tavolsag ezen a palyan
 * keveset mond (lasd fent) -- az szamit, hogy a celkeresztje eppen
 * arrafele all-e.
 */
export interface SpawnThreat {
  position: readonly [number, number, number];
  aimYaw: number;
  aimPitch: number;
}

/**
 * Mennyivel szamit kozelebbinek egy spawn-pont, ha valaki EPP ARRA cel.
 *
 * Szandekosan nagy: egy 40 m-re levo, rad celzo ellenfel veszelyesebb,
 * mint egy 20 m-re levo, masfele nezo.
 */
const AIM_PENALTY_M = 30;

/** Ekkora fel-kupon belul szamit ugy, hogy "arra cel" (radian, ~34 fok). */
const AIM_CONE_RAD = 0.6;

/** Ilyen kozel a sajat halalunk helyehez mar buntetjuk a pontot. */
const DEATH_RADIUS_M = 20;

/**
 * Mennyit von le a sajat halalunk kozelsege.
 *
 * Aki megolt, jo esellyel meg ott van -- oda visszaszuletni a
 * legrosszabb, ami tortenhet.
 */
const DEATH_PENALTY_M = 25;

/**
 * Ennyivel jobbnak kell lennie egy masik pontnak, hogy a mar kivalasztott
 * tervet lecsereljuk.
 *
 * Enelkul a terv minden tickben ugralna, ahogy az ellenfelek mozognak --
 * a halal-kepernyon pedig a jatekos egy villogo, kiszamithatatlan
 * elonezetet latna.
 */
const REPICK_MARGIN_M = 10;

/**
 * Ennyivel rosszabb pontok kozul meg valaszthatunk veletlenszeruen.
 *
 * Ha mindig a matematikailag legjobbat vennenk, a valasztas ismet
 * kiszamithato lenne -- csak bonyolultabb szabaly szerint. A "jo eleg"
 * jeloltek kozotti sorsolas ezt megtori, ugy, hogy a biztonsagbol
 * erdemben nem enged.
 */
const NEAR_BEST_M = 8;

/**
 * Egy spawn-pont "effektiv biztonsaga" METERBEN.
 *
 * A kiindulas a legkozelebbi ellenfel tavolsaga, amibol levonjuk a
 * kockazatokat. Azert meterben tartjuk (es nem absztrakt pontszamban),
 * mert igy a kuszobok (REPICK_MARGIN_M, NEAR_BEST_M) is ertelmezhetok:
 * "8 meternyi biztonsagot feladunk a kiszamithatatlansagert".
 */
export function spawnSafety(
  point: { x: number; y: number; z: number },
  threats: readonly SpawnThreat[],
  deathPosition?: readonly [number, number, number] | null,
): number {
  // Ellenfel nelkul minden pont egyformán biztonsagos; a halal helye
  // ilyenkor is szamit (pl. falnak menve haltunk meg).
  let safety = threats.length === 0 ? 1000 : Number.POSITIVE_INFINITY;

  for (const threat of threats) {
    const dx = point.x - threat.position[0];
    const dy = point.y - threat.position[1];
    const dz = point.z - threat.position[2];
    const distance = Math.hypot(dx, dy, dz);

    let effective = distance;

    // Arra cel-e? A celzas iranya es a spawn-pont iranya kozotti szog.
    if (distance > 1e-3) {
      const aim = aimDirection(threat.aimYaw, threat.aimPitch);
      const dot = (aim[0] * dx + aim[1] * dy + aim[2] * dz) / distance;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (angle < AIM_CONE_RAD) {
        // Minel pontosabban arra cel, annal nagyobb a levonas.
        effective -= AIM_PENALTY_M * (1 - angle / AIM_CONE_RAD);
      }
    }

    safety = Math.min(safety, effective);
  }

  if (deathPosition) {
    const distance = Math.hypot(
      point.x - deathPosition[0],
      point.y - deathPosition[1],
      point.z - deathPosition[2],
    );
    if (distance < DEATH_RADIUS_M) {
      safety -= DEATH_PENALTY_M * (1 - distance / DEATH_RADIUS_M);
    }
  }

  return safety;
}

/**
 * A legbiztonsagosabb szabad spawn-pont -- a "jo eleg" jeloltek kozul
 * sorsolva.
 *
 * @param freeIndices Amit MAS jatekos nem foglal (elve vagy tervkent).
 * @param random      Injektalhato, hogy a valasztas tesztelheto legyen.
 */
export function pickSpawnIndex(
  freeIndices: readonly number[],
  threats: readonly SpawnThreat[],
  deathPosition?: readonly [number, number, number] | null,
  random: () => number = Math.random,
): number {
  if (freeIndices.length === 0) return 0;

  const scored = freeIndices.map((index) => ({
    index,
    safety: spawnSafety(SPAWN_POINTS[index], threats, deathPosition),
  }));

  const best = Math.max(...scored.map((s) => s.safety));
  const goodEnough = scored.filter((s) => s.safety >= best - NEAR_BEST_M);

  return goodEnough[Math.floor(random() * goodEnough.length) % goodEnough.length].index;
}

/**
 * Le kell-e cserelni a mar kivalasztott tervet?
 *
 * A halal-kepernyon a jatekos EZT a pontot nezi, tehat csak akkor
 * mozdulunk, ha a helyzet erdemben romlott -- kulonben az elonezet
 * ugralna.
 */
export function shouldRepickSpawn(
  currentSafety: number,
  bestSafety: number,
): boolean {
  return bestSafety - currentSafety > REPICK_MARGIN_M;
}
