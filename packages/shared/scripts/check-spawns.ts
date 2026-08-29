/**
 * Ellenorzi, hogy a SPAWN_POINTS egyike sem er bele arena-akadalyba,
 * es hogy egymastol is eleg tavol vannak.
 *
 * Miert kell erre kulon teszt? Mert ha egy spawn beleer egy akadalyba,
 * az auto bele-szuletik: egy kereke megszorul, az a sarok megemelkedik,
 * es a kocsi azonnal felborul -- a jatekos gyakorlatilag hasznalhatatlan
 * allapotban kezd. Ez CSENDES hiba: semmi nem log, a szimulacio "fut",
 * csak epp rossz. A halozati spawn bevezetesekor pontosan ez tortent
 * (korives elrendezes, a 2. jatekos a crate_a ladaba szuletett).
 *
 * Futtatas: npm run check:spawns
 */
import { LARGEST_CAR_HALF } from "../src/carSizes";
import { ARENA, ARENA_HALF, SPAWN_POINTS } from "../src/config";

/**
 * Az auto vizszintes befoglalo sugara. A hosszabb tengellyel szamolunk
 * minden iranyban, mert a spawn utan a kocsi barmerre allhat -- es a
 * LEGNAGYOBB kocsival, mert a hely mindenkinek kell.
 */
const CAR_RADIUS = Math.max(LARGEST_CAR_HALF.x, LARGEST_CAR_HALF.z);

/** Tovabbi rahagyas, hogy a spawn ne legyen "eppen csak" szabad. */
const CLEARANCE = 0.5;

/** Ket jatekos ne szulessen egymasba. */
const MIN_SPAWN_DISTANCE = 6;

let failures = 0;
function fail(message: string): void {
  console.log(`  HIBA ${message}`);
  failures++;
}

console.log("=== Spawn-pontok ellenorzese ===\n");

// 1. Akadaly-mentesseg
for (let i = 0; i < SPAWN_POINTS.length; i++) {
  const s = SPAWN_POINTS[i];
  const hits: string[] = [];

  for (const box of ARENA) {
    if (box.name === "ground") continue;
    const limitX = box.halfExtents.x + CAR_RADIUS + CLEARANCE;
    const limitZ = box.halfExtents.z + CAR_RADIUS + CLEARANCE;
    if (
      Math.abs(s.x - box.position.x) < limitX &&
      Math.abs(s.z - box.position.z) < limitZ
    ) {
      hits.push(box.name);
    }
  }

  if (hits.length > 0) {
    fail(`spawn ${i} (${s.x}, ${s.z}) beleer: ${hits.join(", ")}`);
  } else {
    console.log(`  OK   spawn ${i} (${String(s.x).padStart(4)}, ${String(s.z).padStart(4)}) szabad`);
  }
}

// 2. Palyan belul
//
// A hatar a CONFIGBOL szarmazik, nem beegetve. Korabban itt egy nyers
// 40 allt: amikor a palya 80-rol 120 m-re nott, a teszt tovabbra is a
// regi hatart kerte szamon, es harom ervenyes spawn-pontot "kilogonak"
// jelolt.
const ARENA_LIMIT = ARENA_HALF - CAR_RADIUS - CLEARANCE;
for (let i = 0; i < SPAWN_POINTS.length; i++) {
  const s = SPAWN_POINTS[i];
  if (Math.abs(s.x) > ARENA_LIMIT || Math.abs(s.z) > ARENA_LIMIT) {
    fail(`spawn ${i} (${s.x}, ${s.z}) kilog a palyarol (hatar: ${ARENA_LIMIT.toFixed(1)})`);
  }
}

// 3. Egymastol valo tavolsag
for (let i = 0; i < SPAWN_POINTS.length; i++) {
  for (let j = i + 1; j < SPAWN_POINTS.length; j++) {
    const a = SPAWN_POINTS[i];
    const b = SPAWN_POINTS[j];
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d < MIN_SPAWN_DISTANCE) {
      fail(`spawn ${i} es ${j} tul kozel van egymashoz (${d.toFixed(1)} m)`);
    }
  }
}

// 4. Legyen eleg spawn a maximalis jatekosszamhoz
if (SPAWN_POINTS.length < 8) {
  fail(`csak ${SPAWN_POINTS.length} spawn van, de 8 jatekos is lehet egy szobaban`);
}

console.log(
  failures === 0
    ? "\n=== Minden spawn-pont rendben ==="
    : `\n=== ${failures} hiba ===`,
);
process.exit(failures === 0 ? 0 : 1);
