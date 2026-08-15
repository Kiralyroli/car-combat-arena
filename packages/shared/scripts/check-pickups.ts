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
  BOOST_PICKUP_DURATION_MS,
  BOOST_PICKUP_MULTIPLIER,
  PICKUP_POINTS,
  PICKUP_RADIUS,
  PICKUP_RESPAWN_MS,
  withinPickupRange,
} from "../src/pickups";
import { ARENA, CHASSIS, DRIVE, FIXED_DT, SPAWN_POINTS } from "../src/config";
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
    "a tullokes a normal boost FOLE szorzodik",
    BOOST_PICKUP_MULTIPLIER > 1,
    `${DRIVE.boostMultiplier} * ${BOOST_PICKUP_MULTIPLIER} = ${(DRIVE.boostMultiplier * BOOST_PICKUP_MULTIPLIER).toFixed(2)}-szoros hajtoero`,
  );
  check(
    "az ujra-felbukkanas hosszabb, mint a hatas",
    PICKUP_RESPAWN_MS > BOOST_PICKUP_DURATION_MS,
    `${PICKUP_RESPAWN_MS} ms varakozas / ${BOOST_PICKUP_DURATION_MS} ms hatas -- kulonben folyamatosan boostolni lehetne`,
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

  console.log("\nA tullokes valodi hatasa (mert gyorsulas):");

  // SZANDEKOSAN itt merjuk, nem a bongeszos e2e-ben.
  //
  // Ott ugyanis a palya rontja el: a mereshez ket futast kell
  // osszehasonlitani, es a savok akadalyai (ladak) tobb kulonbseget
  // okoznak, mint maga a boost -- meressel 94 vs 55 km/h ket
  // AKADALYMENTESNEK hitt savon, illetve 49 vs 47 km/h ugyanazon a
  // savon, ahol mindket futas ladaba utkozott. Headlessen a meres
  // determinisztikus es pontosan azt meri, ami a kerdes.
  const plain = await accelerate(false, false);
  const boosted = await accelerate(true, false);

  check(
    "a tullokes erdemben gyorsit",
    boosted > plain * 1.2,
    `${plain.toFixed(0)} -> ${boosted.toFixed(0)} km/h (${(((boosted - plain) / plain) * 100).toFixed(0)}%)`,
  );

  const withShift = await accelerate(false, true);
  check(
    "a Shift-boost tovabbra is onmagaban is hat",
    withShift > plain * 1.2,
    `${withShift.toFixed(0)} km/h -- a pickup NEM valtja ki a normal boostot`,
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
async function accelerate(superBoost: boolean, boost: boolean): Promise<number> {
  const backend = new RapierBackend();
  await backend.init();
  backend.reset({ x: 25, y: 2.5, z: 25 });
  // Leeres es megnyugvas, mielott gazt adnank.
  for (let i = 0; i < 90; i++) backend.step(FIXED_DT, NEUTRAL_INPUT);
  for (let i = 0; i < 150; i++) {
    backend.step(FIXED_DT, { ...NEUTRAL_INPUT, throttle: 1, boost, superBoost });
  }
  return backend.getTelemetry().speedKmh;
}

main();
