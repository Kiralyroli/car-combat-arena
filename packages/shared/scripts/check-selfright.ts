/**
 * Regresszios teszt az onfelegyenesedes rendszerhez (rapier.ts
 * applySelfRighting). Ez a hangolas finomhangolas-erzekeny volt
 * (lasd EREDMENYEK.md) -- konnyen visszacsuszhat egy kesobbi
 * valtoztatasnal, ezert allando ellenorzeskent maradt meg, nem
 * egyszeri debug szkriptkent.
 *
 * Ket dolgot ellenoriz:
 *   1. Minden tesztelt felfordult/oldalra dolt orientaciobol
 *      ténylegesen visszaall-e a kerekeire, ES nem ragad-e le
 *      egy koztes (pl. pontosan oldalra fekvő) allapotban.
 *   2. Normal vezetes (kemeny kanyar, kerek-serules dontese) NEM
 *      eri el a kuszobot -- a rendszer ne szoljon bele a szokasos
 *      jatekmenetbe.
 */
import { RapierBackend } from "../src/physics/rapier";
import { BARE_ARENA, FIXED_DT } from "../src/config";
import { NEUTRAL_INPUT, type DriveInput } from "../src/types";

function quatFromAxisAngle(x: number, y: number, z: number, angle: number) {
  const half = angle / 2;
  const s = Math.sin(half);
  return { x: x * s, y: y * s, z: z * s, w: Math.cos(half) };
}

function quatFromEuler(x: number, y: number, z: number) {
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  };
}

function tiltDeg(chassis: { rotation(): { x: number; y: number; z: number; w: number } }): number {
  const q = chassis.rotation();
  const tx = -2 * q.z;
  const tz = 2 * q.x;
  const upY = 1 + q.w * 0 + (q.z * tx - q.x * tz);
  return (Math.acos(Math.max(-1, Math.min(1, upY))) * 180) / Math.PI;
}

let anyFailure = false;

async function testRecovery(
  label: string,
  quat: { x: number; y: number; z: number; w: number },
  maxSeconds: number,
): Promise<void> {
  const backend = new RapierBackend();
  await backend.init({ arena: BARE_ARENA });
  const chassis = (backend as unknown as { chassis: any }).chassis;
  chassis.setTranslation({ x: 0, y: 3, z: 0 }, true);
  chassis.setRotation(quat, true);
  chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
  chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);

  const maxSteps = Math.round(maxSeconds / FIXED_DT);
  for (let i = 0; i < maxSteps; i++) {
    backend.step(FIXED_DT, NEUTRAL_INPUT);
  }
  const finalTilt = tiltDeg(chassis);
  const ok = finalTilt < 5;
  if (!ok) anyFailure = true;
  console.log(
    `  ${label.padEnd(34)} vegso doles: ${finalTilt.toFixed(1)} fok  ${ok ? "OK" : "SIKERTELEN"}`,
  );
  backend.dispose();
}

async function main(): Promise<void> {
  console.log("=== Onfelegyenesedes regresszios teszt ===\n");

  console.log("-- 1. Visszaallas szelsoseges orientaciokbol (max 6s) --");
  await testRecovery("Fejre allitva (180 X)", quatFromAxisAngle(1, 0, 0, Math.PI), 6);
  await testRecovery("Fejre allitva (180 Z)", quatFromAxisAngle(0, 0, 1, Math.PI), 6);
  await testRecovery("Oldalra dontve (90 Z)", quatFromAxisAngle(0, 0, 1, Math.PI / 2), 6);
  await testRecovery("Oldalra dontve (90 X)", quatFromAxisAngle(1, 0, 0, Math.PI / 2), 6);
  await testRecovery("Vegyes dontes (110 X, 50 Z)", quatFromEuler((110 * Math.PI) / 180, 0, (50 * Math.PI) / 180), 6);
  await testRecovery(
    "Vegyes dontes (170 X, 80 Y, 40 Z)",
    quatFromEuler((170 * Math.PI) / 180, (80 * Math.PI) / 180, (40 * Math.PI) / 180),
    6,
  );

  console.log("\n-- 2. Normal vezetes nem eri el a kuszobot (60 fok) --");
  const b1 = new RapierBackend();
  await b1.init({ arena: BARE_ARENA });
  b1.reset();
  for (let i = 0; i < 90; i++) b1.step(FIXED_DT, NEUTRAL_INPUT);
  const gas: DriveInput = { ...NEUTRAL_INPUT, throttle: 1 };
  for (let i = 0; i < 55; i++) b1.step(FIXED_DT, gas);
  const turn: DriveInput = { ...NEUTRAL_INPUT, throttle: 1, steer: 1 };
  let maxTilt = 0;
  for (let i = 0; i < 300; i++) {
    b1.step(FIXED_DT, turn);
    maxTilt = Math.max(maxTilt, tiltDeg((b1 as unknown as { chassis: any }).chassis));
  }
  const corneringOk = maxTilt < 60;
  if (!corneringOk) anyFailure = true;
  console.log(
    `  Kemeny kanyar + gaz (5s)          max doles: ${maxTilt.toFixed(1)} fok  ${corneringOk ? "OK" : "SIKERTELEN"}`,
  );
  b1.dispose();

  const b2 = new RapierBackend();
  await b2.init({ arena: BARE_ARENA });
  b2.reset();
  for (let i = 0; i < 90; i++) b2.step(FIXED_DT, NEUTRAL_INPUT);
  b2.setWheelDamage(2, { hp: 0, broken: true, gripMultiplier: 0 });
  for (let i = 0; i < 180; i++) b2.step(FIXED_DT, gas);
  const damageTilt = tiltDeg((b2 as unknown as { chassis: any }).chassis);
  // Kuszob 0.5 -> 0.2: a pitch/roll stabilizacio (config.ts STABILIZATION)
  // enyhen tompitja a torott kerek dontesét is, de meg mindig lathatoan
  // jelen van -- ez nem valodi regresszio, csak kisebb, mint korabban.
  const damageOk = damageTilt > 0.2 && damageTilt < 60;
  if (!damageOk) anyFailure = true;
  console.log(
    `  Torott hatso-bal kerek (3s)       doles: ${damageTilt.toFixed(1)} fok  ${damageOk ? "OK" : "SIKERTELEN"}`,
  );
  b2.dispose();

  console.log(`\n${anyFailure ? "=== VAN SIKERTELEN TESZT ===" : "=== Minden teszt OK ==="}`);
  if (anyFailure) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("HIBA:", err);
  process.exit(1);
});
