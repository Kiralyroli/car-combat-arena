/**
 * Rakéta-szabalyok (terv 4. lepcso 3. pont).
 *
 * A lovedeket a SZERVER szimulalja, ezert a logikaja headless
 * tesztelheto. Ket iranyba merunk, es a masodik itt is fontosabb:
 *  1. A talalat es a robbanas sebezzen.
 *  2. Ne sebezzen ott, ahol nem kell -- kulonosen a KILOVO ne lője
 *     azonnal onmagat, ami egy iranyban tevedő elojellel konnyen
 *     megtortenne, es csak jatek kozben derulne ki.
 *
 * Futtatas: npm run check:rocket
 */
import {
  EXPLOSION_MAX_DAMAGE,
  EXPLOSION_RADIUS,
  explosionFalloff,
  ROCKET_DIRECT_DAMAGE,
  ROCKET_SPAWN_OFFSET,
  ROCKET_SPEED,
  rocketHitsCar,
} from "../src/rocket";
import { FIXED_DT } from "../src/config";
import type { ClientState } from "../src/net/protocol";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

function car(
  position: [number, number, number],
  yawDeg = 0,
  velocity: [number, number, number] = [0, 0, 0],
): ClientState {
  const half = ((yawDeg * Math.PI) / 180) / 2;
  return {
    position,
    rotation: [0, Math.sin(half), 0, Math.cos(half)],
    velocity,
    steer: 0,
    susp: [0.3, 0.3, 0.3, 0.3],
    grip: [1, 1, 1, 1],
    brokenMask: 0,
    aimYaw: 0,
    aimPitch: 0,
  };
}

function main(): void {
  console.log("=== Rakéta ===\n");

  console.log("Kiloves iranya:");

  // Alaphelyzetben (0 fokos forgas) az orr a -Z fele nez -- lasd
  // config.ts orr-konvencio. A rakétanak ERRE kell indulnia.
  const shooter = car([0, 1, 0]);
  const [qx, qy, qz, qw] = shooter.rotation;
  // (0,0,-1) forgatasa a quaternionnal, kezzel (nincs rotateVec import).
  const tx = 2 * (qy * -1);
  const ty = -2 * (qx * -1);
  const noseX = qw * tx + (qy * 0 - qz * ty);
  const noseZ = -1 + (qx * ty - qy * tx);

  check(
    "a rakéta az orr iranyaba indul (-Z)",
    Math.abs(noseX) < 0.01 && noseZ < -0.9,
    `orr = (${noseX.toFixed(2)}, ${noseZ.toFixed(2)})`,
  );
  check(
    "a kiindulopont az auto ELOTT van",
    ROCKET_SPAWN_OFFSET > 2.4,
    `${ROCKET_SPAWN_OFFSET.toFixed(2)} m (fel-hossz 2.46 m) -- kulonben azonnal onmagaba utkozne`,
  );

  console.log("\nTalalat-geometria (doboz + szakasz):");

  const stepPerTick = ROCKET_SPEED * FIXED_DT;
  const target = car([0, 1, 0]);

  // Egy tick-nyi szakaszt hasznalunk mindenhol, hogy a teszt azt merje,
  // ami a szerveren tenylegesen tortenik.
  const seg = (
    x: number,
    y: number,
    z: number,
    dir: [number, number, number] = [0, 0, 1],
  ): boolean =>
    rocketHitsCar(
      [x, y, z],
      [
        x + dir[0] * stepPerTick,
        y + dir[1] * stepPerTick,
        z + dir[2] * stepPerTick,
      ],
      target.position,
      target.rotation,
    );

  check(
    "az orrba erkezo lovedek talal",
    seg(0, 1, -3.2),
    `z = -3.2 -> -${(3.2 - stepPerTick).toFixed(2)}`,
  );
  check(
    "az oldalaba erkezo lovedek talal",
    rocketHitsCar([-2.5, 1, 0], [-2.5 + stepPerTick, 1, 0], target.position, target.rotation),
    "oldalrol, a fel-szelesseg (1.09 m) fele",
  );

  // EZ A REGI HIBA. A korabbi gomb-kozelites 2.80 m sugarral dolgozott,
  // tehat az autotol 2.5 m-re oldalt elhuzo lovedek is KOZVETLEN
  // TALALATNAK szamitott, pedig a karosszeria csak 1.09 m-ig er. A
  // sugarral felfujt doboz hatara oldalt 1.09 + 0.6 = 1.69 m.
  // A pont SZANDEKOSAN az auto hossza mentén kozepen van (z = 0): itt
  // ter el legjobban a doboz a gombtol. A regi, 2.80 m sugaru gomb
  // kozeppontjatol 2.5 m -- azaz KOZVETLEN TALALAT --, pedig a
  // karosszeria oldalt csak 1.09 m-ig er (a sugarral egyutt 1.69 m).
  // (Egy tavolabbi, orr elotti pont nem mutatna ki a hibat: az mar a
  // gombon is kivul esett volna.)
  check(
    "az auto MELLETT elhuzo lovedek NEM talal",
    !seg(2.5, 1, 0) && !seg(-2.5, 1, 0),
    "x = +-2.5 m a hossz kozepen (doboz-hatar 1.69 m) -- a regi 2.80 m-es gomb ezt talalatnak vette",
  );
  check(
    "az auto FOLOTT elhuzo lovedek NEM talal",
    !seg(0, 3.2, -3.2),
    "y = 3.2 m (a doboz hatara 1 + 0.755 + 0.6 = 2.36 m)",
  );

  // Atfurodás: egy teljes tick-lepes barmelyik iranybol erje el a celt.
  // A legvekonyabb irany a szelesseg (1.09 m fel-meret).
  check(
    "egy tick alatt nem furodik at az auton",
    seg(-1.6, 1, 0, [1, 0, 0]) || stepPerTick < 2 * (1.09 + 0.6),
    `${stepPerTick.toFixed(2)} m/tick a ${(2 * (1.09 + 0.6)).toFixed(2)} m-es legvekonyabb atmerohoz`,
  );

  // Elforgatott auto: 90 fokban a hossz es a szelesseg SZEREPET CSEREL.
  // Ha a teszt csak tengely-parhuzamos autoval menne, egy hianyzo
  // forgatas eszrevetlen maradna.
  const turned = car([0, 1, 0], 90);
  const atX3 = (state: ClientState): boolean =>
    rocketHitsCar([3.0, 1, 0], [3.0, 1, stepPerTick], state.position, state.rotation);
  check(
    "elfordulassal a doboz is fordul",
    atX3(turned) && !atX3(target),
    "x = 3.0 m: a 90 fokra fordult autot eltalalja (fel-hossz 2.455 + 0.6), az egyenest allot nem (1.09 + 0.6)",
  );

  console.log("\nRobbanas-kifutas:");

  check(
    "a kozeppontban teljes a hatas",
    explosionFalloff(0) === 1,
    `${explosionFalloff(0)}`,
  );
  check(
    "a hatosugar szelen nulla",
    explosionFalloff(EXPLOSION_RADIUS) === 0,
    `${EXPLOSION_RADIUS} m-nel ${explosionFalloff(EXPLOSION_RADIUS)}`,
  );
  check(
    "a hatosugaron kivul nulla",
    explosionFalloff(EXPLOSION_RADIUS + 5) === 0,
    "nem lehet negativ vagy visszanovo",
  );

  const near = explosionFalloff(1);
  const far = explosionFalloff(EXPLOSION_RADIUS - 1);
  check(
    "kozelebb erosebb, mint tavolabb",
    near > far,
    `1 m: ${near.toFixed(2)} vs ${(EXPLOSION_RADIUS - 1).toFixed(0)} m: ${far.toFixed(2)}`,
  );

  console.log("\nSebzes:");

  const directTotal = EXPLOSION_MAX_DAMAGE + ROCKET_DIRECT_DAMAGE;
  check(
    "a kozvetlen talalat tobbet sebez, mint a puszta robbanas",
    ROCKET_DIRECT_DAMAGE > 0 && directTotal > EXPLOSION_MAX_DAMAGE,
    `kozvetlen: ${directTotal} HP, csak robbanas: ${EXPLOSION_MAX_DAMAGE} HP`,
  );
  check(
    "egy talalat nem oli meg a teljes eletu jatekost",
    directTotal < 100,
    `${directTotal} HP (max 100)`,
  );

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
