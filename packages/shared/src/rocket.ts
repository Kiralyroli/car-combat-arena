import { CAR_BOXES } from "./carHitbox";
import { raycastBVH, type BVH } from "./raycast";
import { CHASSIS } from "./config";

/**
 * Rakéta -- az elso SZERVER ALTAL SZIMULALT entitas (terv 4. lepcso 3.).
 *
 * Eddig a szerver csak kiertekelt (utkozes, sebzes) a kliensektol kapott
 * allapotokbol. A lovedek maskepp mukodik: a szerver SAJAT MAGA lepteti,
 * es a kliensek csak megjelenitik. Ez azert fontos, mert a talalat
 * kovetkezmenyei (sebzes, kill) kizarolag a szerverre tartoznak
 * (terv 15.4) -- ha a kliens szimulalna, o mondhatna meg, mit talalt el.
 *
 * A ROBBANAS LOKESE viszont a kliensen szamolodik: a hibrid modellben a
 * sajat auto mozgasa a klienshez tartozik, a szerver nem tudja
 * "ellokni". A szerver az esemenyt (hol es mekkora) mondja meg, a
 * fizikai lokest mindenki a SAJAT autojara alkalmazza.
 */

/** A lovedek sebessege (m/s) -- a kilovo auto sebessegehez adodik. */
export const ROCKET_SPEED = 55;

/** Ennyi ido utan (ms) magatol felrobban, ha nem talalt el semmit. */
export const ROCKET_LIFETIME_MS = 4000;

/** Ket loves kozott ennyi ideig (ms) nem lehet ujra tuzelni. */
export const ROCKET_COOLDOWN_MS = 1200;

/**
 * A lovedek ekkora sugaru gombkent utkozik (m).
 *
 * Nem pontszeru: a halozati snapshotok kozott a lovedek nagyot ugrik
 * (55 m/s mellett 20 Hz-en ~2.75 m), es egy pontszeru talalat igy
 * konnyen "atsiklana" az autokon.
 */
export const ROCKET_RADIUS = 0.6;

/**
 * Ilyen tavol (m) szuletik a kilovo auto kozeppontja elott.
 *
 * Az auto fel-hossza + rahagyas: kulonben azonnal onmagaba utkozne.
 */
export const ROCKET_SPAWN_OFFSET = CHASSIS.halfExtents.z + 1.2;

/** A robbanas hatosugara (m). */
export const EXPLOSION_RADIUS = 7;

/** Kozvetlen talalat sebzese (a robbanas-sebzes ehhez adodik hozza). */
export const ROCKET_DIRECT_DAMAGE = 25;

/** A robbanas sebzese a kozeppontban; a szelen nullaba fut ki. */
export const EXPLOSION_MAX_DAMAGE = 35;

/** A robbanas lokesenek erossege a kozeppontban (m/s sebesseg-valtozas). */
export const EXPLOSION_MAX_PUSH = 18;

/**
 * Egy vektor elforgatasa a quaternion INVERZEVEL (vilag -> lokalis).
 *
 * A konjugalt (x,y,z -> -x,-y,-z) egysegnyi quaternionnal az inverz. A
 * beerkezo forgast a plauzibilitas-ellenorzes mar egysegnyi kozelinek
 * hitelesitette, tehat itt nem normalizalunk ujra.
 */
function toLocal(
  v: readonly [number, number, number],
  q: readonly number[],
): [number, number, number] {
  const [qx, qy, qz, qw] = [-q[0], -q[1], -q[2], q[3]];
  const [x, y, z] = v;
  // t = 2 * (q_vec x v)
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
}

/**
 * Eltalalja-e a lovedek AZ EGESZ LEPESE SORAN az autot?
 *
 * Ket korabbi pontatlansagot valt ki egyszerre:
 *
 *  1. GOMB HELYETT DOBOZ. Korabban az autot egy 2.80 m sugaru gomb
 *     kozelitette. A karosszeria sarka pont 2.79 m-re van a
 *     kozepponttol, tehat a gomb korbeirta a dobozt: valodi talalatot
 *     nem hagyott ki, viszont az auto MELLETT akar 1.7 m-rel elhuzo
 *     rakéta is kozvetlen talalatnak szamitott (fel-szelesseg 1.09 m).
 *     Ez volt a jatek kozben legfeltunobb hiba.
 *
 *  2. PONTMINTA HELYETT SZAKASZ. Korabban csak a lepes VEGPONTJAT
 *     neztuk. A rakéta tickenkent 0.92 m-t tesz meg, es a doboz-teszt
 *     (a gombbel ellentetben) mar nem ad nagy tartalekot, tehat a
 *     vekonyabb iranyokban at tudna siklani a celon. Ezert a teljes
 *     megtett SZAKASZT vizsgaljuk.
 *
 * Modszer: a szakaszt az auto sajat koordinatarendszerebe visszuk (igy
 * a doboz tengely-parhuzamos lesz), a felmereteket megnoveljuk a
 * lovedek sugaraval, es szokvanyos slab-tesztet futtatunk.
 *
 * A sugarral valo felfujas a sarkoknal kisse tulbecsul (a gomb-sopres
 * lekerekitett sarkait dobozzal helyettesiti, legfeljebb ~0.44 m-rel a
 * nyolc sarokpontban). Ez nagysagrendekkel kisebb, mint az 1.7 m-es
 * korabbi hiba, es SZANDEKOSAN a talalat javara doltunk el: egy
 * horzsolo talalat inkabb szamitson be, mint hogy elvesszen.
 */
export function rocketHitsCar(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  carPosition: readonly number[],
  carRotation: readonly number[],
  radius: number = ROCKET_RADIUS,
): boolean {
  return segmentCarEntry(from, to, carPosition, carRotation, radius) !== null;
}

/**
 * Ugyanaz, mint a rocketHitsCar, de a BELEPESI PONTOT is megadja: hol
 * er a szakaszra (0..1), vagy null, ha nincs talalat.
 *
 * Az azonnali talalatu fegyvernek (gepfegyver) ez kell, ket okbol is:
 * tobb celpont kozul a LEGKOZELEBBIT kell eltalalni, es a nyomjelzo
 * csiknak is a becsapodasnal kell vegzodnie, nem a hatotav vegen.
 */
export function segmentCarEntry(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  carPosition: readonly number[],
  carRotation: readonly number[],
  radius: number = ROCKET_RADIUS,
): number | null {
  // Az auto sajat koordinatarendszereben a doboz tengely-parhuzamos,
  // tehat a kozos slab-teszt hasznalhato.
  const start = toLocal(
    [from[0] - carPosition[0], from[1] - carPosition[1], from[2] - carPosition[2]],
    carRotation,
  );
  const end = toLocal(
    [to[0] - carPosition[0], to[1] - carPosition[1], to[2] - carPosition[2]],
    carRotation,
  );

  // TOBB DOBOZ, nem egy: a modell teljes befoglaloja a kabin
  // magassagaban haromszor akkora, mint maga az auto -- a
  // motorhaztetö es a csomagtarto FOLOTTI levego is talalatnak
  // szamitana. A dobozok mertek (carHitbox.ts), es mind a regi
  // befoglalon BELUL vannak: senki nem lett eltalalhatobb, csak a
  // hamis talalatok tuntek el.
  //
  // A LEGKOZELEBBI talalat kell, nem az elso: a nyomjelzo csiknak es a
  // robbanasnak a becsapodas helyen kell vegzodnie.
  let legkozelebbi: number | null = null;
  for (const b of CAR_BOXES) {
    const t = segmentBoxEntry(start, end, [b.dx, b.dy, b.dz], [
      b.hx + radius,
      b.hy + radius,
      b.hz + radius,
    ]);
    if (t !== null && (legkozelebbi === null || t < legkozelebbi)) {
      legkozelebbi = t;
    }
  }
  return legkozelebbi;
}

/**
 * A szakasz elso talalata az auto HAROMSZOG-halojan.
 *
 * Ugyanaz, mint a segmentCarEntry, csak a doboz-kozelites helyett a
 * modell valodi alakjaval. A halot a hivo adja (a szerveren all ossze),
 * mert a kozos csomag nem tolt be modellt.
 *
 * A SUGARAT itt is atadjuk: a raketa nem pontszeru, es a surloasnak is
 * talalatnak kell lennie -- kulonben a jarmu mellett elhalado raketa
 * athaladna, ahelyett hogy felrobbanna.
 */
export function segmentCarEntryMesh(
  bvh: BVH,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  carPosition: readonly number[],
  carRotation: readonly number[],
  radius: number = ROCKET_RADIUS,
): number | null {
  // Az AUTO rendszerebe visszuk a szakaszt, nem a halot a vilagba: igy
  // egyetlen fa eleg minden jatekoshoz, es a lag-kompenzacios
  // visszatekeresnel sem kell ujraepiteni semmit.
  const start = toLocal(
    [from[0] - carPosition[0], from[1] - carPosition[1], from[2] - carPosition[2]],
    carRotation,
  );
  const end = toLocal(
    [to[0] - carPosition[0], to[1] - carPosition[1], to[2] - carPosition[2]],
    carRotation,
  );
  return raycastBVH(bvh, start, end, radius);
}

/**
 * Metszi-e a szakasz a tengely-parhuzamos dobozt?
 *
 * Szokvanyos slab-teszt: tengelyenkent kiszamoljuk azt a [t0, t1]
 * intervallumot, amelyben a szakasz a doboz savjaban van; ha a harom
 * metszete nem ures, van metszes. A hivo dolga, hogy a felmereteket
 * elore megnovelje a lovedek sugaraval.
 */
export function segmentHitsBox(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  center: readonly [number, number, number],
  half: readonly [number, number, number],
): boolean {
  return segmentBoxEntry(from, to, center, half) !== null;
}

/**
 * A slab-teszt, ami a BELEPESI pontot is visszaadja.
 *
 * A szamitas maga valtozatlan; korabban a `t0` erteket eldobtuk, pedig
 * ott volt. Az azonnali talalatu fegyvernek szuksege van ra, hogy a
 * legkozelebbi celpontot valassza ki.
 *
 * @returns 0..1 a szakaszon, vagy null, ha nincs metszes. A 0 azt
 *   jelenti, hogy a szakasz mar a dobozon BELUL indult.
 */
export function segmentBoxEntry(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  center: readonly [number, number, number],
  half: readonly [number, number, number],
): number | null {
  let t0 = 0;
  let t1 = 1;

  for (let axis = 0; axis < 3; axis++) {
    const p = from[axis] - center[axis];
    const d = to[axis] - from[axis];

    if (Math.abs(d) < 1e-9) {
      // A szakasz parhuzamos ezzel a sikparral: ha kivul indul, sosem er be.
      if (Math.abs(p) > half[axis]) return null;
      continue;
    }

    let near = (-half[axis] - p) / d;
    let far = (half[axis] - p) / d;
    if (near > far) [near, far] = [far, near];

    if (near > t0) t0 = near;
    if (far < t1) t1 = far;
    if (t0 > t1) return null;
  }

  return t0;
}

/**
 * A robbanas hatasa a tavolsag fuggvenyeben (1 a kozeppontban, 0 a
 * hatosugar szelen).
 *
 * Negyzetes kifutas: a kozelben erezhetoen erosebb, a szelen pedig nem
 * "vagodik el" hirtelen, ami igazsagtalannak hatna.
 */
export function explosionFalloff(
  distance: number,
  radius: number = EXPLOSION_RADIUS,
): number {
  if (distance >= radius) return 0;
  const t = 1 - distance / radius;
  return t * t;
}
