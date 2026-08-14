/**
 * Regresszios teszt a kanyarodas erzetehez -- rovid, "gombnyomas-szeru"
 * kormanyzasi impulzusokat mer (nem hosszan tartott, folyamatos
 * kanyart), mert egy hosszabb teszt konnyen nekifuthat az arena
 * targyainak (rampa, ladak, falak) egy fürge autonal -- ez tobbszor
 * felreveszetett a hangolas soran (lasd EREDMENYEK.md).
 *
 * A spawn (25, 2.5, 25) tudatosan valasztott, akadalymentes sarok.
 */
import { RapierBackend } from "../src/physics/rapier";
import { FIXED_DT } from "../src/config";
import { NEUTRAL_INPUT, type DriveInput } from "../src/types";

const SAFE_SPAWN = { x: 25, y: 2.5, z: 25 };

function quatYaw(q: [number, number, number, number]): number {
  const [x, y, z, w] = q;
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x));
}

async function quickTurnTest(
  label: string,
  preSpeedSteps: number,
  turnSteps: number,
): Promise<number> {
  const backend = new RapierBackend();
  await backend.init();
  backend.reset(SAFE_SPAWN);
  for (let i = 0; i < 90; i++) backend.step(FIXED_DT, NEUTRAL_INPUT);
  const gas: DriveInput = { ...NEUTRAL_INPUT, throttle: 1 };
  for (let i = 0; i < preSpeedSteps; i++) backend.step(FIXED_DT, gas);
  const speedBefore = backend.getTelemetry().speedKmh;
  const startYaw = quatYaw(backend.getChassis().quaternion);

  const turn: DriveInput = { ...NEUTRAL_INPUT, throttle: 1, steer: 1 };
  for (let i = 0; i < turnSteps; i++) backend.step(FIXED_DT, turn);

  const endYaw = quatYaw(backend.getChassis().quaternion);
  let yawDelta = Math.abs(endYaw - startYaw);
  if (yawDelta > Math.PI) yawDelta = 2 * Math.PI - yawDelta;
  const speedAfter = backend.getTelemetry().speedKmh;
  const yawDeg = (yawDelta * 180) / Math.PI;
  console.log(
    `  ${label.padEnd(40)} ${(turnSteps * FIXED_DT).toFixed(1)}s -- elfordulas: ${yawDeg.toFixed(0).padStart(3)} fok, seb ${speedBefore.toFixed(0)}->${speedAfter.toFixed(0)} km/h`,
  );
  backend.dispose();
  return yawDeg;
}

async function main(): Promise<void> {
  console.log("=== Kanyarodas regresszios teszt (rovid impulzusok) ===\n");

  const a = await quickTurnTest("1s kormany, alacsony sebessegrol", 30, 60);
  const b = await quickTurnTest("1s kormany, kozepes sebessegrol", 90, 60);
  const c = await quickTurnTest("0.5s kormany, kozepes sebessegrol", 90, 30);

  // Durva, informalis also hatarok -- csak azt jelzik, ha a
  // kanyarodas kepesseg drasztikusan visszaesne egy jovobeli
  // valtoztatasnal, nem szigoru elfogadasi kuszobok.
  const ok = a > 20 && b > 10 && c > 3;
  console.log(`\n${ok ? "OK -- a kanyarodas erezhetoen mukodik minden sebessegen" : "FIGYELEM -- gyenge kanyarodas"}`);
  if (!ok) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("HIBA:", err);
  process.exit(1);
});
