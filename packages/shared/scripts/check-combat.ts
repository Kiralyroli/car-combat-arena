/**
 * Utkozesi sebzes-szabalyok (terv 4. lepcso 1-2. pont).
 *
 * Ket iranyba mer, es a MASODIK a fontosabb:
 *  1. Ami valodi becsapodas, az sebezzen, a sebesseggel aranyosan.
 *  2. Ami NEM az, az ne sebezzen. Egy tulzottan erzekeny szabaly
 *     csendben teszi tonkre a jatekot: a jatekosok egymas mellett
 *     elhaladva vagy egymasnak tamaszkodva veszitenenek HP-t, amit
 *     senki nem ert -- ez rosszabb, mint ha nehany koccanas kimaradna.
 *
 * Futtatas: npm run check:combat
 */
import { CHASSIS } from "../src/config";
import {
  approachSpeed,
  carsOverlap,
  collisionDamage,
  MAX_HP,
  MIN_DAMAGING_IMPACT,
  splitCollisionDamage,
} from "../src/combat";
import type { ClientState } from "../src/net/protocol";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

/** Auto adott helyen, adott sebesseggel, `yawDeg` fokkal elfordulva. */
function car(
  position: [number, number, number],
  velocity: [number, number, number] = [0, 0, 0],
  yawDeg = 0,
): ClientState {
  const half = ((yawDeg * Math.PI) / 180) / 2;
  return {
    position,
    rotation: [0, Math.sin(half), 0, Math.cos(half)],
    velocity,
    steer: 0,
    susp: [0.3, 0.3, 0.3, 0.3],

    aimYaw: 0,
    aimPitch: 0,
  };
}

const LENGTH = CHASSIS.halfExtents.z * 2; // 4.91 m
const WIDTH = CHASSIS.halfExtents.x * 2; // 2.18 m

function main(): void {
  console.log("=== Utkozesi sebzes ===\n");

  console.log("Geometria -- mi szamit erintkezesnek:");

  check(
    "orr-orr erintkezes eszlelve",
    carsOverlap(car([0, 1, 0]), car([0, 1, LENGTH - 0.2])),
    `${(LENGTH - 0.2).toFixed(2)} m tavolsag (hossz ${LENGTH.toFixed(2)} m)`,
  );
  check(
    "orr-orr hezag NEM erintkezes",
    !carsOverlap(car([0, 1, 0]), car([0, 1, LENGTH + 0.5])),
    `${(LENGTH + 0.5).toFixed(2)} m tavolsag`,
  );

  // EZ a lenyeg a gomb-kozelites ellen: az auto hosszu es keskeny, egy
  // kozos sugarral (2.7 m) az egymas mellett elhalado autok is
  // "utkoznenek", holott 3 m-re vannak egymastol oldalirányban.
  check(
    "egymas mellett elhalado autok NEM utkoznek",
    !carsOverlap(car([0, 1, 0]), car([WIDTH + 0.8, 1, 0])),
    `${(WIDTH + 0.8).toFixed(2)} m oldaltavolsag (szelesseg ${WIDTH.toFixed(2)} m)`,
  );
  check(
    "oldalso surlodas eszlelve",
    carsOverlap(car([0, 1, 0]), car([WIDTH - 0.2, 1, 0])),
    `${(WIDTH - 0.2).toFixed(2)} m oldaltavolsag`,
  );

  check(
    "egymas felett atrepulo auto NEM utkozik",
    !carsOverlap(car([0, 1, 0]), car([0, 6, 0])),
    "5 m magassagkulonbseg",
  );

  // Elforgatott auto: T-alakban nekimenve a hosszanti oldal szamit.
  check(
    "keresztbe allo auto erintkezese eszlelve",
    carsOverlap(car([0, 1, 0]), car([0, 1, CHASSIS.halfExtents.z + 0.5], [0, 0, 0], 90)),
    "T-alaku utkozes",
  );

  console.log("\nKozeledesi sebesseg:");

  // "a" a z=0-nal +Z fele halad, "b" a z=10-nel -Z fele: EGYMAS FELE.
  const headOn = approachSpeed(
    car([0, 1, 0], [0, 0, 20]),
    car([0, 1, 10], [0, 0, -20]),
  );
  check(
    "szembe-becsapodasnal a sebessegek osszeadodnak",
    Math.abs(headOn - 40) < 0.1,
    `${headOn.toFixed(1)} m/s (20 + 20)`,
  );

  const separating = approachSpeed(
    car([0, 1, 0], [0, 0, 20]),
    car([0, 1, 10], [0, 0, 30]),
  );
  check(
    "tavolodo autoknal negativ (nincs ujabb sebzes)",
    separating < 0,
    `${separating.toFixed(1)} m/s`,
  );

  console.log("\nSebzes:");

  check(
    "lassu koccanas nem sebez",
    collisionDamage(MIN_DAMAGING_IMPACT - 1) === 0,
    `${MIN_DAMAGING_IMPACT - 1} m/s`,
  );
  check(
    "egymasnak tamaszkodas nem sebez",
    collisionDamage(0.4) === 0,
    "0.4 m/s",
  );

  const medium = collisionDamage(20);
  check(
    "kozepes becsapodas erezheto sebzes",
    medium > 10 && medium < MAX_HP,
    `20 m/s -> ${medium} HP`,
  );

  const hard = collisionDamage(40);
  check(
    "erosebb becsapodas tobbet sebez",
    hard > medium,
    `40 m/s -> ${hard} HP (20 m/s -> ${medium})`,
  );

  // Szembe-becsapodasnal a kozeledesi sebesseg akar 90 m/s is lehet.
  // Egyetlen utkozes ne vegezzen ki egy teljes eletu jatekost.
  const extreme = collisionDamage(90);
  check(
    "egyetlen utkozes nem oli meg a teljes eletu jatekost",
    extreme < MAX_HP,
    `90 m/s -> ${extreme} HP (max ${MAX_HP})`,
  );

  console.log("\nKi ment neki kinek (sebzes-elosztas):");

  // "a" all, "b" hatulrol belerohan. A tamado jarjon jobban.
  const rammed = splitCollisionDamage(
    car([0, 1, 0], [0, 0, 0]),
    car([0, 1, 4], [0, 0, -25]),
  );
  check(
    "aki nekiment, kevesebbet kap",
    rammed.b < rammed.a && rammed.b > 0,
    `allo auto -${rammed.a} HP, nekimeno -${rammed.b} HP`,
  );

  // A korlatnak a FELOSZTAS UTAN is ervenyesnek kell lennie: az
  // aldozat-szorzo kulonben tullepne rajta, es egyetlen becsapodas
  // kivegezne a teljes eletu jatekost.
  const brutal = splitCollisionDamage(
    car([0, 1, 0], [0, 0, 0]),
    car([0, 1, 4], [0, 0, -45]),
  );
  check(
    "a felosztas utan sem lepi tul a korlatot",
    brutal.a < MAX_HP && brutal.b < MAX_HP,
    `legerosebb rammeles: -${brutal.a} / -${brutal.b} HP (max ${MAX_HP})`,
  );

  // Szembe, egyforman: nincs "tamado", tehat egyenlo.
  const symmetric = splitCollisionDamage(
    car([0, 1, 0], [0, 0, 20]),
    car([0, 1, 4], [0, 0, -20]),
  );
  check(
    "szembe-utkozesnel egyenlo a sebzes",
    symmetric.a === symmetric.b && symmetric.a > 0,
    `${symmetric.a} vs ${symmetric.b} HP`,
  );

  // A ket eset kozott SIMA az atmenet: egy alig gyorsabb auto ne
  // forditsa at hirtelen az egesz sebzest.
  const slight = splitCollisionDamage(
    car([0, 1, 0], [0, 0, 19]),
    car([0, 1, 4], [0, 0, -21]),
  );
  check(
    "kis sebessegkulonbseg csak kis elteres",
    Math.abs(slight.a - slight.b) <= 6,
    `19 vs 21 m/s -> ${slight.a} / ${slight.b} HP`,
  );

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
