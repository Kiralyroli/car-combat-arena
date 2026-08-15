/**
 * A szerver-oldali plauzibilitas-ellenorzes tesztje (terv 3. lepcso 5. pont).
 *
 * Ket iranyba kell mernie, es a MASODIK a fontosabb:
 *  1. A fizikailag lehetetlen allapotokat dobja el.
 *  2. A SZABALYOS jatekot ne akadalyozza. Egy tul szoros ellenorzes
 *     nemán rontja el a jatekot: a jatekos a sajat kepernyojen normalisan
 *     mozog, a tobbiek viszont beragadva latjak. Ez sokkal rosszabb,
 *     mint ha atengednenk nehany csalast -- a terv szerint a cel is az,
 *     hogy a csalas "legfeljebb bosszanto" legyen, nem a tokeletes vedelem.
 *
 * Futtatas: npm run check:plausibility
 */
import { CHASSIS, SPAWN_POINTS } from "../src/config";
import { checkPlausibility, MAX_PLAUSIBLE_SPEED } from "../src/net/plausibility";
import type { ClientState } from "../src/net/protocol";
import { RapierBackend } from "../src/physics/rapier";
import { FIXED_DT } from "../src/config";
import { NEUTRAL_INPUT } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

function state(
  position: [number, number, number],
  velocity: [number, number, number] = [0, 0, 0],
): ClientState {
  return {
    position,
    rotation: [0, 0, 0, 1],
    velocity,
    steer: 0,
    susp: [0.3, 0.3, 0.3, 0.3],

    aimYaw: 0,
    aimPitch: 0,
  };
}

async function main(): Promise<void> {
  console.log("=== Plauzibilitas-ellenorzes ===\n");

  const origin = state([0, 1, 0]);

  // --- 1. Amit el KELL utasitani ---
  console.log("Lehetetlen allapotok:");

  const nan = state([NaN, 1, 0]);
  check(
    "NaN pozicio elutasitva",
    !checkPlausibility(origin, nan, 0.05).ok,
    "NaN vegigterjedne a tobbi kliens fizikajan is",
  );

  const farOutside = state([500, 1, 0]);
  check(
    "palyan kivuli pozicio elutasitva",
    !checkPlausibility(null, farOutside, 0.05).ok,
    "x=500",
  );

  const underground = state([0, -50, 0]);
  check(
    "talaj alatti pozicio elutasitva",
    !checkPlausibility(null, underground, 0.05).ok,
    "y=-50",
  );

  const tooFast = state([0, 1, 0], [MAX_PLAUSIBLE_SPEED * 3, 0, 0]);
  check(
    "tulzott sebesseg elutasitva",
    !checkPlausibility(null, tooFast, 0.05).ok,
    `${MAX_PLAUSIBLE_SPEED * 3} m/s`,
  );

  const teleport = state([35, 1, 35]);
  check(
    "teleport elutasitva",
    !checkPlausibility(origin, teleport, 0.05).ok,
    "~49 m egyetlen snapshot alatt",
  );

  const badRotation: ClientState = { ...state([0, 1, 0]), rotation: [5, 5, 5, 5] };
  check(
    "ervenytelen forgas elutasitva",
    !checkPlausibility(origin, badRotation, 0.05).ok,
    "nem egysegnyi quaternion",
  );

  // --- 2. Amit el KELL fogadni ---
  console.log("\nSzabalyos jatek:");

  const respawn = state([SPAWN_POINTS[3].x, SPAWN_POINTS[3].y, SPAWN_POINTS[3].z]);
  check(
    "ujraszuletes spawn-pontra elfogadva",
    checkPlausibility(origin, respawn, 0.05).ok,
    "az R gomb es a csatlakozas is igy mukodik",
  );
  const defaultSpawn = state([CHASSIS.spawn.x, CHASSIS.spawn.y, CHASSIS.spawn.z]);
  check(
    "ujraszuletes az alap spawn-pontra elfogadva",
    checkPlausibility(state([30, 1, -30]), defaultSpawn, 0.05).ok,
    "R gomb halozat nelkuli spawn-ra",
  );

  // Kesve erkezo csomag: nagyobb szunet, aranyosan nagyobb ugras.
  const afterGap = state([0, 1, -25]);
  check(
    "hosszabb szunet utani nagyobb elmozdulas elfogadva",
    checkPlausibility(origin, afterGap, 0.6).ok,
    "25 m 0.6 s alatt (halozati akadas)",
  );

  // --- 3. A LEGFONTOSABB: valodi vezetes vegig atmegy ---
  console.log("\nValodi vezetes (a fizikabol, nem kitalalt ertekekbol):");

  const backend = new RapierBackend();
  await backend.init();
  backend.reset({ x: -30, y: 2.5, z: 30 });

  let previous: ClientState | null = null;
  let rejected = 0;
  let firstReason = "";
  let peakSpeed = 0;

  // 12 masodperc teljes gaz + boost + kanyarodas, 20 Hz-en mintavetelezve
  // (ugyanaz a rata, amivel a kliens kuldi az allapotat).
  const stepsPerSample = 3; // 60 Hz / 20 Hz
  for (let i = 0; i < 12 * 60; i++) {
    const steer = Math.sin(i / 90);
    backend.step(FIXED_DT, { ...NEUTRAL_INPUT, throttle: 1, boost: true, steer });

    if (i % stepsPerSample !== 0) continue;
    const chassis = backend.getChassis();
    const velocity = backend.getVelocity();
    peakSpeed = Math.max(peakSpeed, Math.hypot(...velocity));

    const sample: ClientState = {
      position: chassis.position,
      rotation: chassis.quaternion,
      velocity,
      steer: 0,
      susp: [0.3, 0.3, 0.3, 0.3],

      aimYaw: 0,
      aimPitch: 0,
    };
    const verdict = checkPlausibility(previous, sample, (stepsPerSample * 1) / 60);
    if (!verdict.ok) {
      rejected++;
      if (!firstReason) firstReason = `${verdict.reason}: ${verdict.detail}`;
    } else {
      previous = sample;
    }
  }

  check(
    "12 s valodi vezetes egyetlen allapota sem lett elutasitva",
    rejected === 0,
    rejected === 0
      ? `csucssebesseg ${peakSpeed.toFixed(1)} m/s (hatar ${MAX_PLAUSIBLE_SPEED})`
      : `${rejected} elutasitas, elso: ${firstReason}`,
  );

  // A fizikai vilagot fel kell szabaditani, es NEM hasznalunk
  // process.exit()-et: a kettо egyutt azt okozta, hogy a folyamat a
  // Rapier WASM leallitasa kozben megszakadt (libuv assert, 127-es
  // kilepesi kod) -- a teszt igy akkor is "hibasnak" latszott, amikor
  // minden ellenorzes atment.
  backend.dispose();

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error("A teszt osszeomlott:", err);
  process.exitCode = 1;
});
