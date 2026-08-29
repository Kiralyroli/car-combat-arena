/**
 * Arena: fedezek es jarhatosag.
 *
 * A MERT PROBLEMA, amiert ez keszult: az arena 80x80 m, a gepfegyver
 * hatotava 70 m, es a palyan alig volt akadaly -- tizenegy elem, abbol
 * ot a padlo es a negy fal. Vagyis barhonnan barhova el lehetett latni
 * (es lőni). Ez volt az ujraszuletesi problema gyokere is: mind a nyolc
 * spawn-pont lotavolsagon belul van minden masikbol.
 *
 * A terv 9. fejezete az Industrial Arenat ennel jóval gazdagabbnak irja
 * le (konténerek, hordok, csovek, acelkorlatok, gumihalmok, daruk) --
 * ez a meres azt kerdezi, mennyire kozelitjuk meg.
 *
 * KET iranybol szorit, mert kulon-kulon egyik sem eleg:
 *  - legyen ELEG fedezek (kulonben nincs hova bujni),
 *  - maradjon JARHATO (kulonben labirintus lesz, es az arkad vezetesnek
 *    nincs hova gyorsulnia).
 *
 * Futtatas: npm run check:arena
 */
import { ARENA, ARENA_HALF, SPAWN_POINTS } from "../src/config";
import { LARGEST_CAR_HALF } from "../src/carSizes";
import { PICKUP_POINTS } from "../src/pickups";
import { segmentHitsBox } from "../src/rocket";
import { MACHINEGUN } from "../src/weapons";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

/**
 * A LEGMAGASABB auto teljes magassaga -- ennel alacsonyabb targy nem
 * takar el.
 *
 * A legmagasabbal merunk (nem a Sedannal): ami a SUV-ot nem takarja,
 * az nem fedezek. Enelkul a palya a valosagosnal jobbnak latszana.
 */
const CAR_HEIGHT = LARGEST_CAR_HALF.y * 2;

/** Minden akadaly (a padlon es a falakon kivul) -- jarhatosaghoz. */
const OBSTACLES = ARENA.filter(
  (box) => box.name !== "ground" && !box.name.startsWith("wall_"),
);

/**
 * FEDEZEKNEK szamito akadalyok: amelyek MAGASABBAK az autonal.
 *
 * A szures nem finomkodas. Az elso valtozat minden akadalyt beszamitott,
 * es 34%-os takarast "mert" -- abbol viszont 22%-ot EGYEDUL a rampa
 * adott, aminek a tetopontja 1.4 m, vagyis alacsonyabb az autonal.
 * Azon a jatekos ATLAT (es athajt): az nem fedezek, hanem padlo-elem.
 * A szam igy a valosagosnal ketszer jobbnak mutatta a palyat.
 */
const COVER = OBSTACLES.filter(
  (box) => box.position.y + box.halfExtents.y >= CAR_HEIGHT,
);

/** Autotengely-magassag: ezen a szinten szamit a takaras. */
const EYE = 1;

function blocked(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): boolean {
  for (const box of COVER) {
    const center: [number, number, number] = [
      box.position.x,
      box.position.y,
      box.position.z,
    ];
    const half: [number, number, number] = [
      box.halfExtents.x,
      box.halfExtents.y,
      box.halfExtents.z,
    ];
    if (segmentHitsBox(from, to, center, half)) return true;
  }
  return false;
}

/** Determinisztikus veletlen: a meres futasrol futasra ugyanaz legyen. */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** Beleer-e egy AKADALYBA ez a pont (fel autonyi rahagyassal)? */
function insideObstacle(x: number, z: number): boolean {
  // A LEGHOSSZABB autoval: aminel a pickup elakad, az nem szabad hely.
  const margin = LARGEST_CAR_HALF.z;
  for (const box of OBSTACLES) {
    if (
      Math.abs(x - box.position.x) < box.halfExtents.x + margin &&
      Math.abs(z - box.position.z) < box.halfExtents.z + margin &&
      Math.abs(EYE - box.position.y) < box.halfExtents.y + 0.5
    ) {
      return true;
    }
  }
  return false;
}

function main(): void {
  console.log("=== Arena: fedezek es jarhatosag ===\n");

  console.log(`  (${OBSTACLES.length} akadaly, ebbol ${COVER.length} magasabb az autonal)\n`);

  // --- Mennyi HOSSZU ratekintes van takarva? ---
  //
  // Csak a lotavolsagon beluli, hosszu vonalak szamitanak: kozelrol
  // amugy is latni kell egymast, az a harc resze.
  {
    const random = makeRandom(12345);
    let long = 0;
    let covered = 0;
    for (let i = 0; i < 4000; i++) {
      const a: [number, number, number] = [
        (random() * 2 - 1) * (ARENA_HALF - 4),
        EYE,
        (random() * 2 - 1) * (ARENA_HALF - 4),
      ];
      const b: [number, number, number] = [
        (random() * 2 - 1) * (ARENA_HALF - 4),
        EYE,
        (random() * 2 - 1) * (ARENA_HALF - 4),
      ];
      const distance = Math.hypot(a[0] - b[0], a[2] - b[2]);
      if (distance < 25 || distance > MACHINEGUN.range) continue;
      if (insideObstacle(a[0], a[2]) || insideObstacle(b[0], b[2])) continue;
      long++;
      if (blocked(a, b)) covered++;
    }
    const ratio = long === 0 ? 0 : covered / long;
    check(
      "a hosszu ratekintesek erdemi resze takarva van",
      ratio > 0.3,
      `${(ratio * 100).toFixed(0)}% takarva (${covered} / ${long} vonal, 25-${MACHINEGUN.range} m)`,
    );
  }

  // --- A SPAWN-pontok kozotti vonalak ---
  //
  // Ez volt a konkret panasz: "lehet tudni, hol lesz a respawn".
  {
    let pairs = 0;
    let covered = 0;
    for (let i = 0; i < SPAWN_POINTS.length; i++) {
      for (let j = i + 1; j < SPAWN_POINTS.length; j++) {
        const a: [number, number, number] = [SPAWN_POINTS[i].x, EYE, SPAWN_POINTS[i].z];
        const b: [number, number, number] = [SPAWN_POINTS[j].x, EYE, SPAWN_POINTS[j].z];
        pairs++;
        if (blocked(a, b)) covered++;
      }
    }
    check(
      "a spawn-pontok kozott is van takaras",
      covered / pairs > 0.25,
      `${covered} / ${pairs} spawn-par takarva (${((covered / pairs) * 100).toFixed(0)}%)`,
    );
  }

  // --- JARHATOSAG: a palya ne teljen meg akadallyal ---
  //
  // A masik irany. Arkad vezetesnel kell a szabad terulet, kulonben az
  // autonak nincs hova gyorsulnia, es a palya labirintusa valik a
  // fo ellenfelle.
  {
    const random = makeRandom(999);
    let free = 0;
    const samples = 4000;
    for (let i = 0; i < samples; i++) {
      const x = (random() * 2 - 1) * (ARENA_HALF - 4);
      const z = (random() * 2 - 1) * (ARENA_HALF - 4);
      if (!insideObstacle(x, z)) free++;
    }
    const ratio = free / samples;
    check(
      "a palya tulnyomo resze jarhato marad",
      ratio > 0.6,
      `${(ratio * 100).toFixed(0)}% szabad terulet`,
    );
  }

  // --- A spawn- es pickup-pontok szabadok maradnak ---
  //
  // Ezt a check:spawns es a check:pickups is meri, de az UJ akadalyok
  // itt bukhatnak el eloszor -- egy helyen, ahol epp a palyat szerkesztjuk.
  {
    const bad: string[] = [];
    for (const p of SPAWN_POINTS) {
      if (insideObstacle(p.x, p.z)) bad.push(`spawn (${p.x}, ${p.z})`);
    }
    for (const p of PICKUP_POINTS) {
      if (insideObstacle(p.x, p.z)) bad.push(`pickup (${p.x}, ${p.z})`);
    }
    check(
      "egyetlen spawn- vagy pickup-pont sem esik akadalyba",
      bad.length === 0,
      bad.length === 0 ? "mind szabad" : bad.join("; "),
    );
  }

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
