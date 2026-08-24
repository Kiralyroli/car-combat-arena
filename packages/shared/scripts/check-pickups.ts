/**
 * Boost pickup szabalyok es elhelyezes (terv 4. lepcso 4. pont).
 *
 * Ket dolgot ellenorzunk:
 *  1. A szabalyokat (hatosugar, idotartam, szorzo).
 *  2. Hogy a pickupok TENYLEG elerhetok-e a palyan -- ne essenek
 *     akadalyba vagy falba. Ez ugyanaz a hiba-osztaly, mint a
 *     spawn-pontoknal (lasd check-spawns.ts): kezzel valasztott
 *     koordinatak konnyen kerulnek rossz helyre, es csak jatek kozben
 *     derulne ki, hogy egy pickupot nem lehet felvenni.
 *
 * Futtatas: npm run check:pickups
 */
import {
  BOOST_CAPACITY_MS,
  BOOST_REFILL_MS,
  PICKUP_POINTS,
  PICKUP_RADIUS,
  PICKUP_RESPAWN_MS,
  withinPickupRange,
} from "../src/pickups";
import { ARCADE, ARENA, CHASSIS, FIXED_DT, SPAWN_POINTS } from "../src/config";
import { NEUTRAL_INPUT } from "../src/types";
import { RapierBackend } from "../src/physics/rapier";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

/** Az arena talajon kivuli, szilard elemei -- ezekbe nem eshet pickup. */
const OBSTACLES = ARENA.filter((box) => box.name !== "ground");

async function main(): Promise<void> {
  console.log("=== Boost pickup ===\n");

  console.log("Szabalyok:");

  check(
    "a pickup a kapacitas felet tolti vissza",
    Math.abs(BOOST_REFILL_MS - BOOST_CAPACITY_MS * 0.5) < 1,
    `${BOOST_CAPACITY_MS} ms tartaly, ${BOOST_REFILL_MS} ms visszatoltes`,
  );
  check(
    "ket pickup teletolti az ures tartalyt",
    BOOST_REFILL_MS * 2 >= BOOST_CAPACITY_MS,
    "50% + 50% = 100%",
  );
  // Ha a pickup hamarabb jonne vissza, mint amennyi ido alatt a teljes
  // tartaly elfogy, egy pickup korul korozve VEGTELEN boost lenne.
  check(
    "az ujra-felbukkanas hosszabb, mint egy teljes tartaly elhasznalasa",
    PICKUP_RESPAWN_MS > BOOST_CAPACITY_MS,
    `${PICKUP_RESPAWN_MS} ms varakozas / ${BOOST_CAPACITY_MS} ms boost`,
  );

  console.log("\nFelvetel:");

  const point = PICKUP_POINTS[0];
  check(
    "a pickup helyen allva felveheto",
    withinPickupRange([point.x, point.y, point.z], point),
    "kozeppontban",
  );
  check(
    "a hatosugar szelen belul meg felveheto",
    withinPickupRange([point.x + PICKUP_RADIUS - 0.1, 1, point.z], point),
    `${(PICKUP_RADIUS - 0.1).toFixed(1)} m-rol`,
  );
  check(
    "a hatosugaron kivul mar nem",
    !withinPickupRange([point.x + PICKUP_RADIUS + 0.5, 1, point.z], point),
    `${(PICKUP_RADIUS + 0.5).toFixed(1)} m-rol`,
  );
  // A pickup a talaj felett lebeg, az auto kozeppontja alatta van. Ha a
  // fuggoleges kulonbseget is beleszamitanank, at lehetne hajtani
  // alatta felvetel nelkul.
  check(
    "a magassagkulonbseg nem akadalyozza a felvetelt",
    withinPickupRange([point.x, 0.5, point.z], point),
    "az auto a lebego pickup ALATT is felveszi",
  );

  console.log("\nElhelyezes a palyan:");

  // Az autonak oda kell ferni: a pickup kozeppontja korul legalabb egy
  // fel autonyi (2.46 m) szabad hely kell vizszintesen.
  const clearance = CHASSIS.halfExtents.z;
  const blocked: string[] = [];
  for (let i = 0; i < PICKUP_POINTS.length; i++) {
    const p = PICKUP_POINTS[i];
    for (const box of OBSTACLES) {
      const overlapX =
        Math.abs(p.x - box.position.x) < box.halfExtents.x + clearance;
      const overlapZ =
        Math.abs(p.z - box.position.z) < box.halfExtents.z + clearance;
      // Csak azok az elemek szamitanak, amik a pickup magassagaban is
      // ott vannak -- egy lapos rampa alatta elfer.
      const overlapY =
        Math.abs(p.y - box.position.y) < box.halfExtents.y + 0.5;
      if (overlapX && overlapZ && overlapY) {
        blocked.push(`${i}. (${p.x}, ${p.z}) <- ${box.name}`);
      }
    }
  }
  check(
    "egyik pickup sem esik akadalyba",
    blocked.length === 0,
    blocked.length === 0 ? `mind a ${PICKUP_POINTS.length} szabad` : blocked.join("; "),
  );

  // SPAWN-PONTOK. Ha egy pickup spawn-ponton all, az ott szuleto
  // jatekos AZONNAL felszedi, anelkul hogy erte ment volna -- es a
  // tobbiek elol is elviszi. Ez tenylegesen megtortent: a (0, 0) pont
  // (az arena kozepe) egybeesett a CHASSIS.spawn-nal, igy minden
  // csatlakozo jatekos rogton elvitte a kozepso boostot.
  const onSpawn: string[] = [];
  const allSpawns = [...SPAWN_POINTS, CHASSIS.spawn];
  for (let i = 0; i < PICKUP_POINTS.length; i++) {
    const p = PICKUP_POINTS[i];
    for (const spawn of allSpawns) {
      const distance = Math.hypot(p.x - spawn.x, p.z - spawn.z);
      if (distance < PICKUP_RADIUS + clearance) {
        onSpawn.push(`${i}. (${p.x}, ${p.z}) <- spawn (${spawn.x}, ${spawn.z})`);
      }
    }
  }
  check(
    "egyik pickup sem all spawn-ponton",
    onSpawn.length === 0,
    onSpawn.length === 0
      ? `mind a ${PICKUP_POINTS.length} tavol van a ${allSpawns.length} spawn-ponttol`
      : onSpawn.join("; "),
  );

  // Ne fedjek at egymast: kulonben egy athajtassal tobbet is fel
  // lehetne venni, es a hatas ujraindulna.
  const tooClose: string[] = [];
  for (let i = 0; i < PICKUP_POINTS.length; i++) {
    for (let j = i + 1; j < PICKUP_POINTS.length; j++) {
      const a = PICKUP_POINTS[i];
      const b = PICKUP_POINTS[j];
      const distance = Math.hypot(a.x - b.x, a.z - b.z);
      if (distance < PICKUP_RADIUS * 2) {
        tooClose.push(`${i}-${j}: ${distance.toFixed(1)} m`);
      }
    }
  }
  check(
    "a pickupok nem fedik at egymast",
    tooClose.length === 0,
    tooClose.length === 0
      ? `a legkozelebbi par is tavolabb van ${(PICKUP_RADIUS * 2).toFixed(0)} m-nel`
      : tooClose.join("; "),
  );

  console.log("\nA boost valodi hatasa (mert gyorsulas):");

  // SZANDEKOSAN itt merjuk, nem a bongeszos e2e-ben.
  //
  // Ott ugyanis a palya rontja el: a mereshez ket futast kell
  // osszehasonlitani, es a savok akadalyai (ladak) tobb kulonbseget
  // okoznak, mint maga a boost -- meressel 94 vs 55 km/h ket
  // AKADALYMENTESNEK hitt savon, illetve 49 vs 47 km/h ugyanazon a
  // savon, ahol mindket futas ladaba utkozott. Headlessen a meres
  // determinisztikus es pontosan azt meri, ami a kerdes.
  const plain = await accelerate(false);
  const boosted = await accelerate(true);

  check(
    "a boost erdemben gyorsit",
    boosted.peakKmh > plain.peakKmh * 1.2,
    `${plain.peakKmh.toFixed(0)} -> ${boosted.peakKmh.toFixed(0)} km/h (${(((boosted.peakKmh - plain.peakKmh) / plain.peakKmh) * 100).toFixed(0)}%, beallitott csucs ${(ARCADE.boostMaxSpeed * 3.6).toFixed(0)} km/h)`,
  );

  // OR: ha egy kesobbi hangolas gyorsabbra veszi az autot, a futas
  // kifuthat a savbol es a falnak utkozhet. Enelkul az elozo meres
  // CSENDBEN hamis lenne -- pontosan ez tortent korabban.
  const furthest = Math.max(plain.travelled, boosted.travelled);
  check(
    "a meres nem futott ki a savbol",
    furthest < LANE_LENGTH,
    `${furthest.toFixed(1)} m a szabad ${LANE_LENGTH} m-bol`,
  );

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

/**
 * Allo helyzetbol 2.5 s teljes gaz utani sebesseg (km/h).
 *
 * A spawn ugyanaz a szabad sarok, amit a tobbi headless meres hasznal
 * (lasd check-turning.ts) -- az arena kozepen a kocsi akadalyba erne.
 */
/** Egy gyorsitasi futas eredmenye. */
interface Run {
  peakKmh: number;
  /** Meddig jutott el a merosavban (m) -- az utkozes kiszurésehez. */
  travelled: number;
}

/**
 * Merosav: a (25, 25) pontbol a -Z iranyba kb. 62 m szabad hely van az
 * eszaki falig.
 *
 * A meresi ablak SZANDEKOSAN rovid (1.6 mp), es a VEGSEBESSEG helyett a
 * CSUCSOT nezzuk. Korabban 2.5 mp-ig gyorsitott, es a boostos futas --
 * eppen mert gyorsabb -- kifutott a savbol es NEKIMENT A FALNAK: a
 * mert "vegsebesseg" 1 km/h lett. A lassabb futas belefert, tehat a
 * teszt nem a boostot merte, hanem azt, melyik auto er elobb a falhoz.
 */
const LANE_START_Z = 25;
const LANE_LENGTH = 62;

async function accelerate(boost: boolean): Promise<Run> {
  const backend = new RapierBackend();
  await backend.init();
  backend.reset({ x: 25, y: 2.5, z: LANE_START_Z });
  // Leeres es megnyugvas, mielott gazt adnank.
  for (let i = 0; i < 90; i++) backend.step(FIXED_DT, NEUTRAL_INPUT);

  let peakKmh = 0;
  for (let i = 0; i < 96; i++) {
    backend.step(FIXED_DT, { ...NEUTRAL_INPUT, throttle: 1, boost });
    peakKmh = Math.max(peakKmh, backend.getTelemetry().speedKmh);
  }
  const z = backend.getChassis().position[2];
  return { peakKmh, travelled: LANE_START_Z - z };
}

main();
