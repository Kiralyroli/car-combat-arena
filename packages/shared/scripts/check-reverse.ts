/**
 * Tolatas-regresszio.
 *
 * Miert kell kulon teszt? Mert a tolatas hibaja CSENDES: az auto
 * elindul, csak eppen alig gyorsul es "beakadva" fordul. Semmi nem
 * dob hibat, a tobbi teszt (gyorsulas, kanyarodas, onfelegyenesedes)
 * mind elorementre merte a kocsit, igy a hiba vegig eszrevetlen maradt.
 *
 * Ket kulon hiba volt:
 *  1. A kanyarsugar-asszisztens a sebesseg NAGYSAGAT hasznalta elojeles
 *     ertek helyett, ezert tolatasnal a ROSSZ iranyba eroltette a
 *     forgast.
 *  2. Az iranyigazitas mindig az ORR iranyahoz igazitotta a mozgast,
 *     tehat tolatas kozben 180 fokkal vissza akarta forditani azt.
 * Ezen felul az asszisztens tolatasban akkor is visszafogta a
 * termeszetes (amugy elesebb) fordulast, amikor nem kellett volna.
 *
 * Futtatas: npm run check:reverse
 */
import { RapierBackend } from "../src/physics/rapier";
import { FIXED_DT } from "../src/config";
import { NEUTRAL_INPUT, type DriveInput } from "../src/types";

/** Szabad terulet: tolatasnal +Z fele halad, itt 60 m-nyi hely van. */
const SPAWN = { x: 30, y: 2.5, z: -30 };

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

function yawOf(q: [number, number, number, number]): number {
  const [x, y, z, w] = q;
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z));
}

interface Result {
  peakKmh: number;
  yawDeg: number;
  minWheelsOnGround: number;
}

async function drive(input: Partial<DriveInput>, seconds: number): Promise<Result> {
  const backend = new RapierBackend();
  await backend.init();
  backend.reset(SPAWN);
  // Leerés/megallapodas.
  for (let i = 0; i < 90; i++) backend.step(FIXED_DT, { ...NEUTRAL_INPUT });

  const startYaw = yawOf(backend.getChassis().quaternion);
  let peakKmh = 0;
  let minWheelsOnGround = 4;

  for (let i = 0; i < Math.round(seconds * 60); i++) {
    backend.step(FIXED_DT, { ...NEUTRAL_INPUT, ...input });
    const t = backend.getTelemetry();
    peakKmh = Math.max(peakKmh, t.speedKmh);
    minWheelsOnGround = Math.min(minWheelsOnGround, t.wheelsOnGround);
  }

  let delta = yawOf(backend.getChassis().quaternion) - startYaw;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;

  return { peakKmh, yawDeg: (delta * 180) / Math.PI, minWheelsOnGround };
}

async function main(): Promise<void> {
  console.log("=== Tolatas regresszios teszt ===\n");

  const straight = await drive({ throttle: -1 }, 3);
  check(
    "tolatas egyenesen felgyorsul",
    straight.peakKmh > 40,
    `${straight.peakKmh.toFixed(1)} km/h 3 masodperc alatt`,
  );

  const turning = await drive({ throttle: -1, steer: 1 }, 3);
  check(
    "tolatas kozben is fordul",
    Math.abs(turning.yawDeg) > 60,
    `${turning.yawDeg.toFixed(0)} fok elfordulas`,
  );

  // EZ a lenyeg: kormanyzas kozben termeszetesen lassabb a tolatas
  // (elesebb ivet ir le), de nem szabad "beakadnia". A hibas
  // valtozatban az egyenes tolatas negyedere esett vissza.
  const ratio = turning.peakKmh / straight.peakKmh;
  check(
    "kormanyzas nem akasztja be a tolatast",
    ratio > 0.25,
    `${turning.peakKmh.toFixed(1)} km/h az egyenes ${straight.peakKmh.toFixed(1)} km/h-hoz kepest (${(ratio * 100).toFixed(0)}%)`,
  );

  // Valodi autonal ugyanaz a kormanyallas hatramenetben az ELLENKEZO
  // iranyba forgatja a kocsit. Ha ez elromlik, a tolatas iranyithatatlan.
  const forward = await drive({ throttle: 1, steer: 1 }, 2);
  const reverseShort = await drive({ throttle: -1, steer: 1 }, 2);
  check(
    "hatramenetben ellenkezo iranyba fordul, mint elore",
    Math.sign(forward.yawDeg) !== Math.sign(reverseShort.yawDeg) &&
      Math.abs(forward.yawDeg) > 10 &&
      Math.abs(reverseShort.yawDeg) > 10,
    `elore ${forward.yawDeg.toFixed(0)} fok, hatra ${reverseShort.yawDeg.toFixed(0)} fok`,
  );

  // Ha a kocsi nekiment valaminek, a meres ertelmet vesztene.
  check(
    "a kocsi vegig a talajon maradt (nem utkozott)",
    straight.minWheelsOnGround === 4 && turning.minWheelsOnGround === 4,
    `egyenes: ${straight.minWheelsOnGround}/4, kanyarodo: ${turning.minWheelsOnGround}/4 kerek`,
  );

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("A teszt osszeomlott:", err);
  process.exit(1);
});
