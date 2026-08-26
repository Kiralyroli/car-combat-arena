/**
 * Visszatekeres (lag-kompenzacio) az azonnali talalatu fegyverhez.
 *
 * EZ a gepfegyver legfontosabb -- es leginkabb lathatatlan -- resze.
 *
 * A lovo mindig a MULTAT latja: a halozati uton felul a kliens
 * szandekosan INTERP_DELAY_MS-mal korabbi allapotot rajzol, hogy a
 * mozgas sima legyen. Egy 30 m/s-os auto ezalatt tobb metert tesz meg,
 * tobbet, mint amilyen szeles. Ha a szerver a JELENLEGI helyen keresne
 * a celpontot, a jatekos hiaba celozna pontosan: a talalatok tobbsege
 * elveszne, es semmi nem jelezne, miert.
 *
 * A teszt ezert KET iranybol szorit:
 *  1. ahova a lovo LATTA a celpontot, ott talalni kell,
 *  2. ahol a celpont MOST van, ott NEM -- kulonben a visszatekeres
 *     valojaban nem is fut, es az elso pont csak veletlenul teljesul.
 *
 * SZANDEKOSAN bongeszo nelkul: a kettot csak igy lehet elkulonitve,
 * ingadozas nelkul merni. (Bongeszos meressel probaltam eloszor -- ott
 * a teszt sajat kovetesi kesese nagyobb hibat okozott, mint a merni
 * kivant hatas.)
 *
 * Futtatas: npm run check:rewind
 */
import {
  FIXED_DT,
  INTERP_DELAY_MS,
  MACHINEGUN,
  weaponPivot,
} from "@cca/shared";
import { Room } from "../src/rooms/room";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

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

const TICK_MS = FIXED_DT * 1000;

/**
 * Egy menet: a celpont egyenesen halad, a lovo pedig a megadott
 * (regi vagy jelenlegi) helyre cel.
 *
 * @param aimAtPast A multbeli helyre celozzunk-e (ahol a lovo LATTA).
 * @returns mennyit sebzodott a celpont
 */
function run(aimAtPast: boolean): { damage: number; offset: number } {
  const room = new Room("TEST");
  const noop = () => {};

  const shooter = room.add("shooter", noop, "Lovo", "machinegun");
  const target = room.add("target", noop, "Celpont", "cannon");

  // A lovo all, a celpont elotte halad keresztbe (+X iranyba).
  const SPEED = 30;
  const shooterPos: [number, number, number] = [0, 1, 20];
  shooter.state = { ...shooter.state, position: shooterPos, velocity: [0, 0, 0] };

  // Kb. fel masodpercnyi elozmeny felepitese: a celpont vegig halad.
  let now = 10_000;
  let tick = 1000;
  const startX = -8;
  const targetZ = 0;

  const positionAt = (t: number): [number, number, number] => [
    startX + (SPEED * (t - 10_000)) / 1000,
    1,
    targetZ,
  ];

  for (let i = 0; i < 40; i++) {
    target.state = { ...target.state, position: positionAt(now), velocity: [SPEED, 0, 0] };
    room.recordPoses(now);
    now += TICK_MS;
    tick++;
  }

  // A lovo kesese: halozati ut + interpolacios puffer.
  const NETWORK_MS = 120;
  const ackTick = Math.round(tick - NETWORK_MS / TICK_MS);
  room.noteAck("shooter", ackTick);

  const currentPos = positionAt(now);
  const seenPos = positionAt(now - NETWORK_MS - INTERP_DELAY_MS);
  const offset = Math.abs(currentPos[0] - seenPos[0]);

  const aimTarget = aimAtPast ? seenPos : currentPos;
  // A celzas a FEGYVER forgaspontjabol indul -- ugyanugy, ahogy a
  // kliens is szamolja (lasd main.ts currentAim). Ha itt az auto
  // kozeppontjabol szamolnank, a teszt olyat merne, ami a jatekban
  // nem tortenik.
  const angles = aimAngles(
    weaponPivot(shooterPos, [0, 0, 0, 1], "machinegun"),
    aimTarget,
  );
  shooter.state = {
    ...shooter.state,
    position: shooterPos,
    aimYaw: angles.yaw,
    aimPitch: angles.pitch,
    firing: true,
  };
  // A celpont tovabb halad, mikozben a lovo tuzel.
  target.state = { ...target.state, position: currentPos };
  room.recordPoses(now);

  const hpBefore = target.hp;
  // Annyi tick, hogy biztosan legyen loves (a tuzgyorsasag 90 ms).
  for (let i = 0; i < 12; i++) {
    room.stepWeapons(FIXED_DT, now, tick);
    now += TICK_MS;
    tick++;
    room.recordPoses(now);
  }

  return { damage: hpBefore - target.hp, offset };
}

function main(): void {
  console.log("=== Visszatekeres (lag-kompenzacio) ===\n");

  const past = run(true);
  const present = run(false);

  check(
    "a keses erdemi eltolast okoz",
    past.offset > 2,
    `${past.offset.toFixed(1)} m a celpont latott es valodi helye kozott`,
  );
  check(
    "ahova a lovo LATTA a celpontot, ott talal",
    past.damage >= MACHINEGUN.damage,
    `${past.damage} sebzes`,
  );
  check(
    "ahol a celpont MOST van, ott nem talal",
    present.damage === 0,
    `${present.damage} sebzes -- e nelkul a visszatekeres nem is futna`,
  );

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
