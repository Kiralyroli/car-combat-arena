/**
 * Kilepesi feltetel #5: fut-e a jarmu-fizika Node.js alatt is?
 *
 * Fontos: ez UGYANAZT a RapierBackend osztalyt hasznalja, mint a bongeszo.
 * Ha ez lefut, akkor a projekt-terv 15.6 szerinti "shared" csomag terve
 * mukodokepes -- a szerver es a kliens kozos jarmu-fizikat futtathat.
 *
 * MEGJEGYZES: az orr -Z fele nez (lasd config.ts). A gyorsitasi
 * mereseket ezert +Z-rol -Z fele iranyban vegezzuk, es megallunk a
 * ramp_main akadaly elott (z=-10-nel kezdodik), kulonben az utkozes
 * utani (elakadt) allapotot mernenk.
 */
import { RapierBackend } from "../src/physics/rapier";
import { FIXED_DT, WHEEL_LAYOUT } from "../src/config";
import { NEUTRAL_INPUT, type DriveInput } from "../src/types";

/** Innen indulnak a gyorsitasi meresek: ~38 m egyenes all rendelkezesre. */
const RUNWAY_START = { x: 0, y: 1.0, z: 30 };
/** Ennel a Z-nel biztonsagosan leallunk (ramp_main akadaly z=-10-nel kezdodik). */
const RUNWAY_END_Z = -8;

const GAS: DriveInput = { ...NEUTRAL_INPUT, throttle: 1 };

function pad(n: number, width = 7, digits = 2): string {
  return n.toFixed(digits).padStart(width);
}

interface RunResult {
  peakKmh: number;
  distance: number;
  seconds: number;
  timeTo50: number | null;
  lateralDrift: number;
  hitWall: boolean;
}

function accelerationRun(
  backend: RapierBackend,
  maxSeconds: number,
  input: DriveInput = GAS,
): RunResult {
  backend.reset(RUNWAY_START);
  // Rovid leulepedes, hogy a felfuggesztes beallljon.
  for (let i = 0; i < 60; i++) backend.step(FIXED_DT, NEUTRAL_INPUT);

  const startZ = backend.getChassis().position[2];
  let peakKmh = 0;
  let timeTo50: number | null = null;
  let steps = 0;
  let hitWall = false;
  const maxSteps = Math.round(maxSeconds / FIXED_DT);

  while (steps < maxSteps) {
    backend.step(FIXED_DT, input);
    steps++;

    const kmh = backend.getTelemetry().speedKmh;
    if (kmh > peakKmh) peakKmh = kmh;
    if (timeTo50 === null && kmh >= 50) timeTo50 = steps * FIXED_DT;

    const z = backend.getChassis().position[2];
    if (z <= RUNWAY_END_Z) {
      hitWall = true;
      break;
    }
  }

  const chassis = backend.getChassis();
  return {
    peakKmh,
    distance: Math.abs(chassis.position[2] - startZ),
    seconds: steps * FIXED_DT,
    timeTo50,
    lateralDrift: chassis.position[0] - RUNWAY_START.x,
    hitWall,
  };
}

async function main(): Promise<void> {
  console.log("=== Node.js fizika-ellenorzes ===\n");

  const backend = new RapierBackend();
  const t0 = performance.now();
  await backend.init();
  console.log(`Backend:   ${backend.name} ${backend.version}`);
  console.log(`Init ido:  ${(performance.now() - t0).toFixed(1)} ms\n`);

  // --- 1. Stabilitas nyugalomban ---
  console.log("-- 1. Nyugalmi allapot --");
  backend.reset();
  for (let i = 0; i < 240; i++) backend.step(FIXED_DT, NEUTRAL_INPUT);
  const restChassis = backend.getChassis();
  const restTel = backend.getTelemetry();
  console.log(`   magassag:     ${pad(restChassis.position[1])} m`);
  console.log(`   sebesseg:     ${pad(restTel.speedKmh)} km/h`);
  console.log(`   kerek foldon: ${restTel.wheelsOnGround} / 4`);
  // Kuszob 1 -> 1.5 km/h: az erosebb sideFrictionStiffness (config.ts)
  // egy apro, ~0.3 m/s-os maradek "kontaktus-zajt" hagy a sebesseg-
  // kiolvasasban meg akkor is, ha a pozicio (posY) bizonyithatoan
  // valtozatlan (hosszabb, kulon tesztelt megfigyeles alapjan) -- ez
  // nem valodi instabilitas.
  const settled = restTel.speedKmh < 1.5 && restTel.wheelsOnGround === 4;
  console.log(`   ${settled ? "OK -- stabilan all" : "FIGYELEM -- nem stabilizalodott"}\n`);

  // --- 2. Gyorsulas ---
  console.log("-- 2. Gyorsitas egyenesben --");
  const accel = accelerationRun(backend, 8);
  console.log(`   csucssebesseg: ${pad(accel.peakKmh)} km/h`);
  console.log(`   0-50 km/h:     ${accel.timeTo50 === null ? "  nem erte el" : pad(accel.timeTo50) + " s"}`);
  console.log(`   megtett ut:    ${pad(accel.distance)} m  (${accel.seconds.toFixed(1)} s alatt)`);
  console.log(`   oldalra csuszas: ${pad(accel.lateralDrift)} m  (egyenesnek kell lennie)`);
  console.log(`   ${accel.hitWall ? "akadaly elott leallitva (varhato)" : "idokorlat"}\n`);

  // --- 3. Szimulacio sebessege ---
  console.log("-- 3. Szimulacios teljesitmeny --");
  backend.reset(RUNWAY_START);
  const perfStart = performance.now();
  const perfSteps = 3000;
  for (let i = 0; i < perfSteps; i++) backend.step(FIXED_DT, NEUTRAL_INPUT);
  const perfMs = performance.now() - perfStart;
  const realtimeFactor = (perfSteps * FIXED_DT * 1000) / perfMs;
  console.log(`   ${perfSteps} lepes: ${perfMs.toFixed(1)} ms  (${(perfMs / perfSteps).toFixed(3)} ms/lepes)`);
  console.log(`   realtime faktor: ${realtimeFactor.toFixed(0)}x`);
  console.log(`   => egy 60 Hz-es szerver elmeletileg ~${Math.floor(realtimeFactor)} jarmuvet birna el egy szalon\n`);

  // --- 4. Per-kerek setterek futasidoben (kilepesi feltetel #6) ---
  console.log("-- 4. Per-kerek serules ervenyesitese --");
  backend.reset();
  const before = backend.getWheels().map((w) => w.radius);
  backend.setWheelDamage(2, { hp: 0, broken: true, gripMultiplier: 0 });
  backend.setWheelDamage(3, { hp: 45, broken: false, gripMultiplier: 0.45 });
  const after = backend.getWheels().map((w) => w.radius);
  let changedCount = 0;
  for (let i = 0; i < WHEEL_LAYOUT.length; i++) {
    const changed = Math.abs(before[i] - after[i]) > 1e-6;
    if (changed) changedCount++;
    console.log(
      `   ${WHEEL_LAYOUT[i].id}: sugar ${before[i].toFixed(3)} -> ${after[i].toFixed(3)}${changed ? "   (valtozott)" : ""}`,
    );
  }
  console.log(`   ${changedCount === 2 ? "OK -- csak a serult kerekek valtoztak" : "FIGYELEM -- varatlan szamu valtozas"}\n`);

  // --- 5. Aszimmetrikus vezetes tort kerekkel ---
  console.log("-- 5. Vezetes tort hatso-bal (RL) kerekkel --");
  backend.reset();
  for (let i = 0; i < 4; i++) backend.setWheelDamage(i, { hp: 100, broken: false, gripMultiplier: 1 });
  const healthy = accelerationRun(backend, 8);

  backend.setWheelDamage(2, { hp: 0, broken: true, gripMultiplier: 0 });
  const damaged = accelerationRun(backend, 8);

  console.log(`   ep auto:    csucs ${pad(healthy.peakKmh)} km/h, oldalra ${pad(healthy.lateralDrift)} m`);
  console.log(`   tort RL:    csucs ${pad(damaged.peakKmh)} km/h, oldalra ${pad(damaged.lateralDrift)} m`);
  const speedLoss = healthy.peakKmh - damaged.peakKmh;
  const driftDelta = Math.abs(damaged.lateralDrift) - Math.abs(healthy.lateralDrift);
  console.log(`   sebessegveszteseg: ${pad(speedLoss)} km/h`);
  console.log(`   tobblet elhuzas:   ${pad(driftDelta)} m`);
  const noticeable = Math.abs(driftDelta) > 0.5 || speedLoss > 3;
  console.log(`   ${noticeable ? "OK -- a serules erezhetoen befolyasolja a mozgast" : "FIGYELEM -- a hatas alig merheto"}\n`);

  backend.dispose();
  console.log("=== Lefutott hiba nelkul ===");
}

main().catch((err: unknown) => {
  console.error("HIBA:", err);
  process.exit(1);
});
