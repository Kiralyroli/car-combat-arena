/**
 * A kamera ne kerulhessen falba.
 *
 * A kovetokamera az auto MOGOTT all, hat meterrel. A palya szelen ez a
 * hat meter a hataroló epulet TULOLDALARA esik: a jatekos a fal
 * belsejebol nezi a sajat autojat, vagy egyaltalan nem latja. Ugyanez
 * tortenik a nyitott rakodoszinben es ket epulet kozott is.
 *
 * A megoldas a szokasos: a kamera nem ragaszkodik a tavolsagahoz,
 * hanem BEHUZODIK az elso akadalyig.
 *
 * MIERT ITT, a kozos csomagban: ez tiszta szamtan, Three.js nelkul --
 * tehat Node alatt merheto (lasd check-camera.ts). A bongeszoben csak
 * annyi tortenik, hogy a kiszamolt pontra tesszuk a kamerat.
 */
import type { ArenaBox } from "./config";
import { segmentBoxEntry } from "./rocket";

/**
 * Ekkora tavolsagot tartunk az akadalytol (m).
 *
 * Nem nulla: a kamera vagosikja (near plane) 0.1 m-nel kezdodik, es egy
 * pontosan a falra tett kamera meg mindig belelatna. Fel meterrel a
 * fal MINDIG a kep szelen marad, nem a kozepen.
 */
export const CAMERA_CLEARANCE = 0.5;

/**
 * Ennel kozelebb a kamera SOSEM jon az autohoz (m).
 *
 * SZANDEKOS kompromisszum, es merve allitva. A tiszta "allj meg az
 * elso akadalynal" szabaly egy raktar mellett 1.4 m-re huzta be a
 * kamerat: onnan a jatekos a sajat autojat sem latja, mert a vagosik
 * levagja. Negy meterrol viszont mar rendes kep van.
 *
 * Az ara: egy KOZELI, MAGAS epuletnel a kamera belelog a falba. Ez
 * kisebb rossz, mint a hasznalhatatlan nezet -- es a lenyeget (hogy ne
 * a fal TULOLDALAROL nezzunk vissza) tovabbra is megoldjuk.
 */
export const CAMERA_MIN_DISTANCE = 4;

/**
 * Behuzodaskor a kamera ENNYIVEL emelkedik (m, teljes behuzodasnal).
 *
 * A puszta behuzodas nem eleg: egy nagy raktar mellett a kamera a
 * minimum-tavolsagon is az EPULET BELSEJEBEN maradt (merve). Ha viszont
 * kozeledes kozben emelkedik is, akkor felulrol nez az autora -- az
 * akadaly folott, nem benne. Ez a szokasos megoldas a kovetokameraknal,
 * es a jatekos szamara is ertheto: minel szorosabb a hely, annal
 * inkabb felulnezetbol lat.
 */
export const CAMERA_LIFT = 3.5;

/**
 * A kamera helye egy ADOTT irany menten, akadalyokat figyelembe veve.
 *
 * A `target` az a pont, AHONNAN nezunk (az auto folott) -- ez sosem
 * lehet falban, mert az autoval egyutt mozog.
 */
function iranyMenten(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  boxes: readonly ArenaBox[],
): { pont: [number, number, number]; tav: number } {
  let closest = 1;
  for (const box of boxes) {
    const t = segmentBoxEntry(from, to, [box.position.x, box.position.y, box.position.z], [
      box.halfExtents.x + CAMERA_CLEARANCE,
      box.halfExtents.y + CAMERA_CLEARANCE,
      box.halfExtents.z + CAMERA_CLEARANCE,
    ]);
    // A 0 azt jelenti, hogy MAGA A CELPONT van a dobozban (pl. az auto
    // beszorult). Olyankor nincs jobb hely, ne huzzuk be nullara.
    if (t !== null && t > 1e-4 && t < closest) closest = t;
  }

  const hely: [number, number, number] = [
    from[0] + (to[0] - from[0]) * closest,
    from[1] + (to[1] - from[1]) * closest,
    from[2] + (to[2] - from[2]) * closest,
  ];

  // EMELKEDES: minel jobban behuzodtunk, annal magasabbra -- igy alacsony
  // akadaly (lada, tartaly) folott atlatunk, nem elotte allunk meg.
  if (closest < 1) {
    hely[1] += (1 - closest) * CAMERA_LIFT;
    let masodik = 1;
    for (const box of boxes) {
      const t = segmentBoxEntry(from, hely, [box.position.x, box.position.y, box.position.z], [
        box.halfExtents.x + CAMERA_CLEARANCE,
        box.halfExtents.y + CAMERA_CLEARANCE,
        box.halfExtents.z + CAMERA_CLEARANCE,
      ]);
      if (t !== null && t > 1e-4 && t < masodik) masodik = t;
    }
    hely[0] = from[0] + (hely[0] - from[0]) * masodik;
    hely[1] = from[1] + (hely[1] - from[1]) * masodik;
    hely[2] = from[2] + (hely[2] - from[2]) * masodik;
  }

  return {
    pont: hely,
    tav: Math.hypot(hely[0] - from[0], hely[1] - from[1], hely[2] - from[2]),
  };
}

/**
 * A kamera helye, akadalyokat figyelembe veve.
 *
 * Ha az auto MOGOTT nincs hely (fal mellett all), a kamera nem az
 * autora tapad, hanem MASFELE kerul korulotte. Ezt a lepest a
 * legegyszerubb megoldasok kihagyjak -- es akkor egy raktar mellett a
 * kamera a minimum-tavolsagon is az EPULET BELSEJEBEN marad (merve:
 * 4.4 m-re az autotol, a falon belul). Az irany valtasa a jatekosnak is
 * ertheto: ha hatrafele nincs kilatas, oldalrol latja magat.
 */
export function cameraClamp(
  target: readonly number[],
  desired: readonly number[],
  boxes: readonly ArenaBox[],
): [number, number, number] {
  const from: [number, number, number] = [target[0], target[1], target[2]];
  const to: [number, number, number] = [desired[0], desired[1], desired[2]];

  let legjobb = iranyMenten(from, to, boxes);
  if (legjobb.tav >= CAMERA_MIN_DISTANCE) return legjobb.pont;

  // Nincs hely hatrafele: korbeprobaljuk az autot. Kifele haladva
  // keresunk, hogy a lehető LEGKISEBB elfordulassal talaljunk helyet --
  // egy 180 fokos ugras zavarobb, mint egy 30 fokos elmozdulas.
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  for (const fok of [25, -25, 50, -50, 75, -75, 100, -100, 130, -130, 160, -160, 180]) {
    const r = (fok * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const forgatott: [number, number, number] = [
      from[0] + dx * cos - dz * sin,
      to[1],
      from[2] + dx * sin + dz * cos,
    ];
    const jelolt = iranyMenten(from, forgatott, boxes);
    if (jelolt.tav > legjobb.tav) legjobb = jelolt;
    if (legjobb.tav >= CAMERA_MIN_DISTANCE) break;
  }

  return legjobb.pont;
}
