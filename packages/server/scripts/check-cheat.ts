/**
 * Csalas-vedelem: fegyver-gating, lag-switch, uzenet-aradat.
 *
 * A hibrid authority modell (terv 15.4) tudatosan a KLIENSNEL hagyja a
 * sajat auto mozgasat, es a szerver csak jozansagi hatarokat huz. Ez a
 * teszt azt a HAROM helyet fogja le, ahol a hatar korabban hianyzott --
 * mindharom kihasznalhato volt egy modositott klienssel.
 *
 * SZANDEKOSAN bongeszo es halozat nelkul: a Room es a RateLimiter is
 * kivulrol kapja az idot, tehat a meres nem fugg a gep terheltsegetol.
 *
 * Futtatas: npm run check:cheat
 */
import { FIXED_DT, INTERP_DELAY_MS, MACHINEGUN, weaponPivot } from "@cca/shared";
import { Room } from "../src/rooms/room";
import {
  MESSAGES_PER_SECOND,
  MESSAGE_BURST,
  RateLimiter,
} from "../src/network/rateLimit";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const TICK_MS = FIXED_DT * 1000;
const noop = () => {};

/** A kliens szog-konvencioja (lasd main.ts currentAim). */
function aimAngles(
  from: readonly number[],
  to: readonly number[],
): { yaw: number; pitch: number } {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  return {
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.atan2(dy, Math.hypot(dx, dz) || 1e-4),
  };
}

// --- 1. A rakéta az AGYU fegyvere ---------------------------------
//
// Korabban a `fire` uzenetnek nem volt fegyver-feltetele: egy
// modositott kliens gepfegyverrel csatlakozott (folyamatos, szerver-
// utemezett hitscan), es KOZBEN raketat is lott.

function testWeaponGating(): void {
  console.log("=== 1. Fegyver-gating: raketa csak agyuval ===\n");

  const room = new Room("TEST");
  const cannon = room.add("cannon", noop, "Agyus", "cannon");
  const mg = room.add("mg", noop, "Gepfegyveres", "machinegun");
  cannon.state = { ...cannon.state, position: [0, 1, 0] };
  mg.state = { ...mg.state, position: [10, 1, 0] };

  const now = 10_000;
  const target: [number, number, number] = [0, 1, -20];

  check(
    "agyuval lehet raketat loni",
    room.tryFire("cannon", target, now) === true,
    "tryFire elfogadta",
  );
  check(
    "gepfegyverrel NEM lehet raketat loni",
    room.tryFire("mg", target, now) === false,
    "tryFire elutasitotta -- e nelkul mindket fegyver egyszerre menne",
  );

  // A hutes tovabbra is szamit: az agyu masodik lovese nem mehet at.
  check(
    "az agyu hutese valtozatlanul fog",
    room.tryFire("cannon", target, now + 10) === false,
    "a masodik loves elutasitva",
  );

  // Es ha a gepfegyveres UJRASZULETESKOR agyura valt, mar lohet.
  room.setWeapon("mg", "cannon");
  check(
    "agyura valtas utan lehet raketat loni",
    room.tryFire("mg", target, now) === true,
    "tryFire elfogadta a valtas utan",
  );
}

// --- 2. Lag switch: a bevallott keses vagasa a merttel -------------
//
// A visszatekeres mertekét a kliens altal kuldott `ackTick` szabta meg.
// Aki egyszeruen nem novelte, annak a visszatekerese felkuszott a felso
// hatarig, es 400 ms-mal korabbi celpontokra lohetett -- oda, ahol a
// masik mar nem tud kiterni.

/**
 * Egy menet: a celpont keresztben halad, a lovo pedig oda cel, ahol a
 * celpont EGY REGI idopontban volt.
 *
 * @param rttMs A szerver altal MERT keses; null = meg nincs meres.
 * @returns mennyit sebzodott a celpont
 */
function lagSwitchRun(rttMs: number | null): {
  damage: number;
  offset: number;
} {
  const room = new Room("TEST");
  const shooter = room.add("shooter", noop, "Lovo", "machinegun");
  const target = room.add("target", noop, "Celpont", "cannon");

  const SPEED = 30;
  const shooterPos: [number, number, number] = [0, 1, 20];
  shooter.state = { ...shooter.state, position: shooterPos, velocity: [0, 0, 0] };

  let now = 10_000;
  let tick = 1000;
  const positionAt = (t: number): [number, number, number] => [
    -14 + (SPEED * (t - 10_000)) / 1000,
    1,
    0,
  ];

  // Bo fel masodpercnyi elozmeny: enelkul nincs mibol visszatekerni.
  for (let i = 0; i < 40; i++) {
    target.state = {
      ...target.state,
      position: positionAt(now),
      velocity: [SPEED, 0, 0],
    };
    room.recordPoses(now);
    now += TICK_MS;
    tick++;
  }

  // A HAZUGSAG: a kliens egy nagyon regi tickre hivatkozik, mintha
  // 250 ms-os halozati uton lenne.
  //
  // Miert nem tobb? Mert a bevallott es a mert ertek vagasa MELLETT ott
  // van a MAX_REWIND_MS = 400 ms felso hatar is. Ha a bevallott keses
  // 250 + INTERP_DELAY_MS fole menne, mar a felso hatar vagna -- es a
  // teszt akkor is atmenne, ha az uj vagas egyaltalan nem futna. Igy
  // viszont a hazudott ertek ONMAGABAN ervenyes lenne, es csak a meres
  // szoritja vissza: pontosan azt merjuk, amit akarunk.
  const CLAIMED_MS = 250;
  room.noteAck("shooter", Math.round(tick - CLAIMED_MS / TICK_MS));

  // A MERES viszont (ha van) egy gyors kapcsolatot mutat.
  if (rttMs !== null) room.noteRtt("shooter", rttMs);

  // Oda celzunk, ahol a celpont a HAZUDOTT idopontban volt.
  const claimedPos = positionAt(now - CLAIMED_MS - INTERP_DELAY_MS);
  const currentPos = positionAt(now);
  const offset = Math.abs(currentPos[0] - claimedPos[0]);

  const angles = aimAngles(
    weaponPivot(shooterPos, [0, 0, 0, 1], "machinegun"),
    claimedPos,
  );
  shooter.state = {
    ...shooter.state,
    position: shooterPos,
    aimYaw: angles.yaw,
    aimPitch: angles.pitch,
    firing: true,
  };
  target.state = { ...target.state, position: currentPos };
  room.recordPoses(now);

  const hpBefore = target.hp;
  for (let i = 0; i < 12; i++) {
    room.stepWeapons(FIXED_DT, now, tick);
    now += TICK_MS;
    tick++;
    room.recordPoses(now);
  }

  return { damage: hpBefore - target.hp, offset };
}

function testLagSwitch(): void {
  console.log("\n=== 2. Lag switch: a mert keses vagja a bevallottat ===\n");

  const unmeasured = lagSwitchRun(null);
  const measured = lagSwitchRun(20);

  check(
    "a hazudott keses erdemi eltolast okoz",
    unmeasured.offset > 2,
    `${unmeasured.offset.toFixed(1)} m a hazudott es a valodi hely kozott`,
  );
  check(
    "meres NELKUL a bevallott keses ervenyes (regi viselkedes)",
    unmeasured.damage >= MACHINEGUN.damage,
    `${unmeasured.damage} sebzes -- a csatlakozas elso masodperceben ez a helyes`,
  );
  check(
    "MERT gyors kapcsolatnal a hazudott keses mar nem hasznal",
    measured.damage === 0,
    `${measured.damage} sebzes 20 ms mert kesessel`,
  );
}

// --- 3. Uzenet-ratakorlat -----------------------------------------

function testRateLimit(): void {
  console.log("\n=== 3. Uzenet-ratakorlat ===\n");

  // Becsuletes kliens: 22 uzenet/mp egy percen at, egyet sem veszit.
  const honest = new RateLimiter(0);
  let honestSent = 0;
  for (let ms = 0; ms < 60_000; ms += 1000 / 22) {
    if (honest.take(ms)) honestSent++;
  }
  check(
    "a becsuletes kliens (22 uzenet/mp) egyet sem veszit",
    honest.dropped === 0,
    `${honestSent} atengedve, ${honest.dropped} eldobva`,
  );

  // Aradat: ezer uzenet egyetlen pillanatban.
  const flood = new RateLimiter(0);
  let passed = 0;
  for (let i = 0; i < 1000; i++) {
    if (flood.take(0)) passed++;
  }
  check(
    "az egy pillanatba surusodo aradatot a burst hatarolja",
    passed === MESSAGE_BURST,
    `${passed} atengedve (burst ${MESSAGE_BURST}), ${flood.dropped} eldobva`,
  );

  // Tartos aradat: egy masodperc alatt legfeljebb a masodperces keret
  // + a felgyult burst mehet at.
  const sustained = new RateLimiter(0);
  let sustainedPassed = 0;
  for (let i = 0; i < 5000; i++) {
    if (sustained.take(i * 0.2)) sustainedPassed++;
  }
  check(
    "tartos aradatnal a masodperces keret fog",
    sustainedPassed <= MESSAGE_BURST + MESSAGES_PER_SECOND + 1,
    `${sustainedPassed} atengedve egy masodperc alatt`,
  );

  // A visszatoltodes FOLYAMATOS: fel masodperc csend utan a fele keret
  // ujra rendelkezesre all.
  const refill = new RateLimiter(0);
  while (refill.take(0)) {
    /* uritsuk ki */
  }
  let afterPause = 0;
  for (let i = 0; i < 100; i++) {
    if (refill.take(500)) afterPause++;
  }
  check(
    "fel masodperc csend utan a keret fele visszatoltodik",
    Math.abs(afterPause - MESSAGES_PER_SECOND / 2) <= 1,
    `${afterPause} uzenet fert bele (varhato ${MESSAGES_PER_SECOND / 2})`,
  );
}

function main(): void {
  testWeaponGating();
  testLagSwitch();
  testRateLimit();

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
