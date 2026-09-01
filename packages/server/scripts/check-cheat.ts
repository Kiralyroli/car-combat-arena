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
import { CheatMonitor, KICK_THRESHOLD } from "../src/rooms/cheatMonitor";
import {
  bucketIndex,
  DISTANCE_EDGES,
  intendedTarget,
  newAimStats,
  recordShot,
  totalShots,
} from "../src/rooms/aimStats";

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

// --- 4. A loves iranya egyezzen a bevallott celzassal --------------
//
// Korabban a `fire` celpontja es az aimYaw/aimPitch teljesen kulon
// utazott, es a szerver sosem vetette ossze oket: a rakéta pontosan a
// celpontra ment, mikozben a tetőn levő veto barmerre nezett.

function testAimConsistency(): void {
  console.log("\n=== 4. Loves-irany es bevallott celzas ===\n");

  /** Egy szoba egy jatekossal, adott celzassal. */
  function room(aimYaw: number, aimPitch = 0): Room {
    const r = new Room("TEST");
    const p = r.add("lovo", noop, "Lovo", "cannon");
    p.state = {
      ...p.state,
      position: [0, 1, 0],
      rotation: [0, 0, 0, 1],
      aimYaw,
      aimPitch,
    };
    return r;
  }

  const now = 10_000;
  // A -Z irany a yaw = 0 (lasd aimDirection es main.ts currentAim).
  const elore: [number, number, number] = [0, 1, -30];
  const hatra: [number, number, number] = [0, 1, 30];
  const oldalra: [number, number, number] = [30, 1, 0];

  check(
    "elore celozva elore lehet loni",
    room(0).tryFire("lovo", elore, now) === true,
    "elfogadva",
  );
  check(
    "elore celozva HATRAFELE nem lehet loni",
    room(0).tryFire("lovo", hatra, now) === false,
    "elutasitva -- e nelkul a veto hazudhatott az iranyrol",
  );
  check(
    "elore celozva OLDALRA sem lehet loni",
    room(0).tryFire("lovo", oldalra, now) === false,
    "elutasitva (90 fok elteres)",
  );
  check(
    "hatrafele celozva hatrafele lehet loni",
    room(Math.PI).tryFire("lovo", hatra, now) === true,
    "elfogadva -- a szabaly az EGYEZEST kéri, nem egy irányt",
  );

  // A hatarhoz kozeli, de meg emberi elteres MENJEN AT. Ez a fontosabb
  // fele: egy tul szoros hatar a becsuletes jatekost buntetne, es a
  // lovese magyarazat nelkul veszne el.
  const harmincFok = (30 * Math.PI) / 180;
  check(
    "30 fokos elteres meg atmegy (gyors egerrantas)",
    room(harmincFok).tryFire("lovo", elore, now) === true,
    "elfogadva -- a celzas 20 Hz-en megy at, a kattintas barmikor johet",
  );

  // ELOZMENY: ha a celzas MOST mashova nez, de a kozelmultban arra
  // nezett, a loves ervenyes. E nelkul a mintavetel es a kattintas
  // kozotti sodrodas hamis riasztast adna.
  const r = new Room("TEST");
  const p = r.add("lovo", noop, "Lovo", "cannon");
  p.state = { ...p.state, position: [0, 1, 0], aimYaw: 0, aimPitch: 0 };
  r.recordPoses(now);
  // A jatekos elfordul, majd 60 ms mulva erkezik meg a kattintas.
  p.state = { ...p.state, aimYaw: Math.PI / 2 };
  check(
    "a kozelmultbeli celzas is ervenyes",
    r.tryFire("lovo", elore, now + 60) === true,
    "elfogadva a 150 ms-os ablakbol",
  );

  // ...de egy REGI celzas mar nem: kulonben eleg lenne egyszer arra
  // nezni, es utana fel masodpercig barhova loni.
  const r2 = new Room("TEST");
  const p2 = r2.add("lovo", noop, "Lovo", "cannon");
  p2.state = { ...p2.state, position: [0, 1, 0], aimYaw: 0, aimPitch: 0 };
  r2.recordPoses(now);
  p2.state = { ...p2.state, aimYaw: Math.PI / 2 };
  check(
    "a REGI celzas mar nem ervenyes",
    r2.tryFire("lovo", elore, now + 400) === false,
    "elutasitva -- az ablakon kivul esik",
  );
}

// --- 5. Loves-merleg: leadott es talalo lovesek --------------------

function testShotCounters(): void {
  console.log("\n=== 5. Loves-merleg (talalati arany alapja) ===\n");

  const room = new Room("TEST");
  const shooter = room.add("shooter", noop, "Lovo", "machinegun");
  const target = room.add("target", noop, "Celpont", "cannon");

  const shooterPos: [number, number, number] = [0, 1, 20];
  const targetPos: [number, number, number] = [0, 1, 0];
  shooter.state = { ...shooter.state, position: shooterPos };
  target.state = { ...target.state, position: targetPos };

  const angles = aimAngles(
    weaponPivot(shooterPos, [0, 0, 0, 1], "machinegun"),
    targetPos,
  );
  shooter.state = {
    ...shooter.state,
    aimYaw: angles.yaw,
    aimPitch: angles.pitch,
    firing: true,
  };

  let now = 10_000;
  let tick = 1000;
  room.recordPoses(now);
  for (let i = 0; i < 60; i++) {
    room.stepWeapons(FIXED_DT, now, tick);
    now += TICK_MS;
    tick++;
    room.recordPoses(now);
  }

  check(
    "a leadott lovesek szamolodnak",
    shooter.shotsFired > 0,
    `${shooter.shotsFired} loves`,
  );
  check(
    "a talalatok szamolodnak",
    shooter.shotsHit > 0,
    `${shooter.shotsHit} talalat`,
  );
  check(
    "talalat nem lehet tobb, mint leadott loves",
    shooter.shotsHit <= shooter.shotsFired,
    `${shooter.shotsHit} / ${shooter.shotsFired}`,
  );
  // Aki nem lott, annak ne legyen merlege -- kulonben a nulla lovesu
  // jatekos "0%"-kal allna az eredmenyjelzon, mintha melle lott volna.
  check(
    "aki nem lott, annak nincs merlege",
    target.shotsFired === 0 && target.shotsHit === 0,
    `${target.shotsHit} / ${target.shotsFired}`,
  );

  // A bontott statisztika is gyult, es a celpont a KOZELI savba esett.
  check(
    "a bontott statisztika is gyult",
    totalShots(shooter.aimStats) > 0,
    `${totalShots(shooter.aimStats)} minta`,
  );
}

// --- 6. Bontott statisztika: savok es celpont-valasztas ------------

function testAimStats(): void {
  console.log("\n=== 6. Celzas-statisztika savjai ===\n");

  check(
    "a tavolsag-savok hatarai helyesen valasztanak",
    bucketIndex(DISTANCE_EDGES, 5) === 0 &&
      bucketIndex(DISTANCE_EDGES, 15) === 1 &&
      bucketIndex(DISTANCE_EDGES, 60) === DISTANCE_EDGES.length,
    "5m -> elso, 15m -> masodik, 60m -> utolso sav",
  );

  const stats = newAimStats();
  recordShot(stats, 5, 0.1, true);
  recordShot(stats, 5, 0.1, false);
  check(
    "a savok a talalatot es a lovest kulon konyvelik",
    stats.byDistance[0].shots === 2 && stats.byDistance[0].hits === 1,
    `${stats.byDistance[0].hits}/${stats.byDistance[0].shots}`,
  );

  // A SZOGSEBESSEG a lenyeg: ugyanaz a sebesseg kozelrol nagyobb
  // szogsebesseget jelent, tehat nehezebb loves.
  const origin: [number, number, number] = [0, 1, 0];
  const elore: [number, number, number] = [0, 0, -1];
  const kozeli = intendedTarget(
    origin,
    elore,
    [{ state: { position: [0, 1, -10], velocity: [30, 0, 0] } }],
    [0, 0, 0],
  );
  const tavoli = intendedTarget(
    origin,
    elore,
    [{ state: { position: [0, 1, -40], velocity: [30, 0, 0] } }],
    [0, 0, 0],
  );
  check(
    "ugyanaz a sebesseg kozelebbrol nagyobb szogsebesseg",
    kozeli !== null &&
      tavoli !== null &&
      kozeli.angularSpeed > tavoli.angularSpeed,
    `${kozeli?.angularSpeed.toFixed(2)} vs ${tavoli?.angularSpeed.toFixed(2)} rad/s`,
  );

  // Aki EGYUTT halad a celponttal, annak az all a celkeresztben.
  const egyutt = intendedTarget(
    origin,
    elore,
    [{ state: { position: [0, 1, -10], velocity: [30, 0, 0] } }],
    [30, 0, 0],
  );
  check(
    "a celponttal egyutt haladva a szogsebesseg nulla",
    egyutt !== null && egyutt.angularSpeed < 1e-6,
    `${egyutt?.angularSpeed.toFixed(4)} rad/s -- a RELATIV sebesseg szamit`,
  );

  // Aki a semmibe szor, arrol ne keletkezzen "pontossag" minta.
  const oldalt = intendedTarget(
    origin,
    elore,
    [{ state: { position: [40, 1, 0], velocity: [0, 0, 0] } }],
    [0, 0, 0],
  );
  check(
    "a celkeresztol tavoli jatekos nem szamit celpontnak",
    oldalt === null,
    "nincs minta -- a szoras nem celzas",
  );
}

// --- 7. Automatikus kidobas: lecsengo pontszam --------------------
//
// A LEGFONTOSABB itt nem az, hogy a csalot kidobja, hanem hogy a
// szakado kapcsolatu BECSULETES jatekost NE dobja ki. A szerver a
// kettot nem tudja megkulonboztetni; ami elvalasztja oket, az a
// szabalyszegesek SEBESSEGE.

function testCheatMonitor(): void {
  console.log("\n=== 7. Automatikus kidobas (lecsengo pontszam) ===\n");

  // ALKALMI hiba: haromszaz masodpercen at percenkent egy celzas-
  // elteres (rossz halozat). Sosem szabad kidobni.
  const alkalmi = new CheatMonitor(0);
  let alkalmiKidobas = false;
  for (let t = 0; t < 300_000; t += 60_000) {
    if (alkalmi.note("aimMismatch", t)) alkalmiKidobas = true;
  }
  check(
    "az alkalmi hiba SOSEM gyulik fel",
    !alkalmiKidobas && alkalmi.score(300_000) < KICK_THRESHOLD,
    `${alkalmi.score(300_000).toFixed(0)} pont ot perc utan (kuszob ${KICK_THRESHOLD})`,
  );

  // FOLYAMATOS celzas-elteres: minden raketanal (1200 ms hutes).
  const folyamatos = new CheatMonitor(0);
  let mikorDobtaKi: number | null = null;
  for (let t = 0; t < 120_000 && mikorDobtaKi === null; t += 1200) {
    if (folyamatos.note("aimMismatch", t)) mikorDobtaKi = t;
  }
  check(
    "a folyamatos hazugsag belathato idon belul kidobas",
    mikorDobtaKi !== null && mikorDobtaKi < 60_000,
    `${((mikorDobtaKi ?? 0) / 1000).toFixed(0)} masodperc utan`,
  );

  // BIZONYITEK: raketa-keres gepfegyverrel. A becsuletes kliens ezt
  // sosem kuldi, ezert keves is elég belole.
  const bizonyitek = new CheatMonitor(0);
  let hanyadik = 0;
  for (let i = 1; i <= 10; i++) {
    if (bizonyitek.note("wrongWeapon", i * 100)) { hanyadik = i; break; }
  }
  check(
    "a cafolhatatlan jel gyorsan kidobashoz vezet",
    hanyadik > 0 && hanyadik <= 3,
    `${hanyadik}. alkalomnal`,
  );

  // A LECSENGES tenyleg fogy: ket szabalyszeges kozott hosszu szunet.
  const szunet = new CheatMonitor(0);
  szunet.note("wrongWeapon", 0);
  check(
    "a pontok idovel lecsengenek",
    szunet.score(30_000) === 0,
    `${szunet.score(30_000)} pont 30 masodperc szunet utan`,
  );

  // A kidobas INDOKA naplozhato -- egy indoklas nelkuli kidobas nem
  // felulvizsgalhato.
  const indok = new CheatMonitor(0);
  indok.note("wrongWeapon", 0);
  indok.note("aimMismatch", 100);
  check(
    "a kidobas indoka osszefoglalhato",
    indok.summary().includes("wrongWeapon=1") &&
      indok.summary().includes("aimMismatch=1"),
    indok.summary(),
  );
}

// --- 8. Host-kirugas: ki rughat ki kit ----------------------------

function testHostKick(): void {
  console.log("\n=== 8. Host-kirugas ===\n");

  const room = new Room("TEST");
  room.add("elso", noop, "Elso", "cannon");
  room.add("masodik", noop, "Masodik", "cannon");
  room.add("harmadik", noop, "Harmadik", "cannon");

  check(
    "a host az elsonek belepett jatekos",
    room.hostId === "elso",
    `host: ${room.hostId}`,
  );
  check(
    "a host kirughat mast",
    room.canKick("elso", "masodik") === true,
    "engedelyezve",
  );
  check(
    "aki NEM host, nem rughat ki senkit",
    room.canKick("masodik", "harmadik") === false,
    "elutasitva -- e nelkul barki kirughatna barkit",
  );
  check(
    "a host nem rughatja ki sajat magat",
    room.canKick("elso", "elso") === false,
    "elutasitva",
  );
  check(
    "nem letezo jatekost nem lehet kirugni",
    room.canKick("elso", "nincs-ilyen") === false,
    "elutasitva",
  );

  // A HOST TAVOZASA: a jog a kovetkezo legregebbi jatekosra szall.
  room.remove("elso");
  check(
    "a host tavozasaval a jog atszall",
    room.hostId === "masodik" && room.canKick("masodik", "harmadik"),
    `uj host: ${room.hostId}`,
  );

  // A KIDOBAS a szallitasi rtegen keresztul megy -- a szoba csak
  // megmondja, kit es miert.
  const room2 = new Room("TEST2");
  room2.add("csalo", noop, "Csalo", "machinegun");
  const kirugottak: string[] = [];
  room2.onKick = (id, code) => kirugottak.push(`${id}:${code}`);
  // Annyi cafolhatatlan jel, hogy biztosan atlepje a kuszobot.
  for (let i = 0; i < 5; i++) {
    room2.tryFire("csalo", [0, 1, -20], 10_000 + i * 2000);
  }
  check(
    "a kuszob atlepese kidobas-kerest valt ki",
    kirugottak.length > 0 && kirugottak[0] === "csalo:invalid_data",
    kirugottak[0] ?? "nem tortent kidobas",
  );
  // EGYSZER, nem minden tovabbi uzenetre: a bontas nem pillanatszeru,
  // es a mar uton levo uzenetek kulonben ujabb kereseket szulnenek.
  check(
    "a kidobas CSAK EGYSZER indul el",
    kirugottak.length === 1,
    `${kirugottak.length} keres ot szabalyszegesre`,
  );
}

function main(): void {
  testWeaponGating();
  testLagSwitch();
  testRateLimit();
  testAimConsistency();
  testShotCounters();
  testAimStats();
  testCheatMonitor();
  testHostKick();

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
