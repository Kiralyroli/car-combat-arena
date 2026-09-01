/**
 * Az arkad vezetes-modell merese.
 *
 * Ez a teszt nem a "mukodik-e" kerdesre valaszol, hanem arra, hogy
 * MILYEN a vezetes: mennyi a csucssebesseg, milyen eles a kanyar,
 * mekkora a fektav, csuszik-e egyenesben, mit csinal a kezifek. Ezek a
 * szamok adjak az erzetet -- es ezeket kell megvedeni, ha kesobb valaki
 * hozzanyul a hangolashoz.
 *
 * A kuszobok a config-bol szarmaznak, nem beegetett ertekek: a teszt
 * azt allitja, hogy a kocsi AZT csinalja, amit az ARCADE blokk iger --
 * nem azt, hogy egy adott hangolas orokre all.
 *
 * MELYIK AUTOVAL MERUNK: a CROSSOVERREL. Az autok tulajdonsagai
 * elternek (carStats.ts), es a crossover az, aminek MINDEN szorzoja
 * pontosan 1,0 -- vagyis egyedul rajta igaz, hogy az ARCADE szamai a
 * tenyleges vezetest irjak le. Az alapertelmezett autoval (izomauto,
 * +15% sebesseg) ugyanez a meres 124 km/h-t mutatna a beallitott 108
 * helyett, es a teszt hibat jelezne ott, ahol nincs.
 *
 * A TOBBI auto elteresét a check-car-stats.ts meri, kulon.
 *
 * MEROSAVOK. Minden meres szabad terepet igenyel, es ezt KULON
 * ELLENORIZZUK is (lasd `Run.minSpeed`). Elso nekifutasra ugyanis
 * pontosan ez romlott el: a gyorsulas-meres nekiment az eszaki falnak,
 * a kanyarmeres pedig a rampanak, es a teszt 108 km/h helyett 0.1
 * km/h-t "mert". Egy utkozes csendben ertelmetlenne tesz minden szamot,
 * ezert inkabb hangosan bukjon el.
 *
 * Futtatas: npm run check:arcade
 */
import { RapierBackend } from "../src/physics/rapier";
import { ARCADE, BARE_ARENA, FIXED_DT } from "../src/config";
import { NEUTRAL_INPUT, type DriveInput } from "../src/types";
import type { CarId } from "../src/index";

/**
 * Hosszu, akadalymentes sav: x = 30 mellett minden akadaly elkerul
 * (ladak x=10..13, oszlop x=-12, rampa x=+-4, ferde felulet x=-18),
 * es z = 35-tol -40-ig 75 m szabad ut van.
 */
const LANE = { x: 30, y: 2.5, z: 35 };

/**
 * Szabad folt a kanyarmereshez. Egy kb. 9 m sugaru kor elfér ide anelkul,
 * hogy a falat vagy a ladakat elerne.
 */
const CIRCLE = { x: 25, y: 2.5, z: 20 };

/** Az az auto, amelynek minden stat-szorzoja pontosan 1,0. */
const MERO_AUTO: CarId = "Crossover";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

function yawOf(q: readonly number[]): number {
  const [x, y, z, w] = q;
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z));
}

async function fresh(at: { x: number; y: number; z: number }): Promise<RapierBackend> {
  const backend = new RapierBackend();
  await backend.init({ arena: BARE_ARENA });
  // A MERO-AUTO: minden szorzoja 1,0 (lasd a fajl fejlecet).
  backend.setCar(MERO_AUTO);
  backend.reset(at);
  // Leeres es megnyugvas, mielott barmit mernenk.
  for (let i = 0; i < 90; i++) backend.step(FIXED_DT, NEUTRAL_INPUT);
  return backend;
}

const speedMs = (b: RapierBackend) => b.getTelemetry().speedKmh / 3.6;

/**
 * Egy meresi szakasz lefuttatasa.
 *
 * A `minSpeed` az UTKOZES-OR: ha a kocsi menet kozben hirtelen lelassul,
 * az nem a modell viselkedese, hanem az, hogy nekiment valaminek.
 */
interface Run {
  peak: number;
  minSpeed: number;
  yawSum: number;
}

function segment(
  b: RapierBackend,
  input: Partial<DriveInput>,
  steps: number,
): Run {
  let previousYaw = yawOf(b.getChassis().quaternion);
  let peak = 0;
  let minSpeed = Infinity;
  let yawSum = 0;

  for (let i = 0; i < steps; i++) {
    b.step(FIXED_DT, { ...NEUTRAL_INPUT, ...input });
    const speed = speedMs(b);
    peak = Math.max(peak, speed);
    minSpeed = Math.min(minSpeed, speed);

    const yaw = yawOf(b.getChassis().quaternion);
    let d = yaw - previousYaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    yawSum += d;
    previousYaw = yaw;
  }
  return { peak, minSpeed, yawSum };
}

/** A haladasi irany es az orr iranya kozotti szog (fok) -- a csuszas merteke. */
function slipAngleDeg(b: RapierBackend): number {
  const v = b.getVelocity();
  if (Math.hypot(v[0], v[2]) < 1) return 0;
  // FONTOS az elojel: a -Z = elore konvencioban egy (dx, dz) irany
  // szoge atan2(-dx, -dz). A -dz elhagyasa 180 fokkal tolna el minden
  // erteket -- elso nekifutasra pontosan ez tortent, es a tapado
  // kanyart is 61 fokos csuszasnak mutatta.
  const heading = Math.atan2(-v[0], -v[2]);
  let delta = heading - yawOf(b.getChassis().quaternion);
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return Math.abs((delta * 180) / Math.PI);
}

async function main(): Promise<void> {
  console.log("=== Arkad vezetes: mert jellemzok ===\n");

  // --- Csucssebesseg es gyorsulas ---
  {
    const b = await fresh(LANE);
    let hundredAt: number | null = null;
    // 2.5 mp: a csucshoz kb. 1.5 mp kell, es igy kb. 52 m-t tesz meg a
    // 75 m-es savbol.
    for (let i = 0; i < 150; i++) {
      b.step(FIXED_DT, { ...NEUTRAL_INPUT, throttle: 1 });
      if (hundredAt === null && b.getTelemetry().speedKmh >= 100) {
        hundredAt = (i + 1) * FIXED_DT;
      }
    }
    const top = speedMs(b);
    check(
      "eleri a beallitott csucssebesseget",
      Math.abs(top - ARCADE.maxSpeed) < 0.5,
      `${(top * 3.6).toFixed(1)} km/h (beallitva: ${(ARCADE.maxSpeed * 3.6).toFixed(1)})`,
    );
    check(
      "0-100 km/h ket masodpercen belul",
      hundredAt !== null && hundredAt < 2,
      hundredAt === null ? "nem erte el a 100-at" : `${hundredAt.toFixed(2)} mp`,
    );
    b.dispose();
  }

  // --- Egyenes menet: nincs oldalra huzas ---
  {
    const b = await fresh(LANE);
    const startX = b.getChassis().position[0];
    segment(b, { throttle: 1 }, 120);
    const drift = Math.abs(b.getChassis().position[0] - startX);
    check(
      "egyenesben nem huz oldalra",
      drift < 0.1,
      `${drift.toFixed(3)} m elteres 2 masodperc alatt`,
    );
    b.dispose();
  }

  // --- Kanyarsugar ---
  // A modell igerete: sugar = sebesseg / fordulasi sebesseg. Ezt a
  // TENYLEGES palyaivbol merjuk vissza, nem a beallitott szamokbol.
  {
    const b = await fresh(CIRCLE);
    const straight = segment(b, { throttle: 1 }, 60);
    const beforeTurn = speedMs(b);

    // A kanyart GAZ NELKUL merjuk. Gazzal a kocsi menet kozben tovabb
    // gyorsult (72 -> 112 km/h), tehat a sugar nem allandosult
    // allapotot mert volna -- a sugar pedig egyenesen aranyos a
    // sebesseggel, ezert ez ertelmetlen atlagot adott.
    const steps = 30;
    const turn = segment(b, { steer: 1 }, steps);
    const yawRate = Math.abs(turn.yawSum) / (steps * FIXED_DT);
    const radius = speedMs(b) / yawRate;

    check(
      "a kanyarmeres nem utkozott",
      turn.minSpeed > beforeTurn * 0.6 && straight.minSpeed > 0,
      `legkisebb sebesseg a kanyarban: ${(turn.minSpeed * 3.6).toFixed(0)} km/h`,
    );
    check(
      "a kanyarsugar a modell igeretet koveti",
      radius > 3 && radius < 12,
      `${radius.toFixed(1)} m ${(speedMs(b) * 3.6).toFixed(0)} km/h-nal (${yawRate.toFixed(2)} rad/s)`,
    );
    check(
      "kanyarban is halad, nem akad be",
      speedMs(b) > beforeTurn * 0.6,
      `${(speedMs(b) * 3.6).toFixed(0)} km/h a kanyar elotti ${(beforeTurn * 3.6).toFixed(0)} km/h-bol (gaz nelkul)`,
    );
    b.dispose();
  }

  // --- Tapadas: kanyarban nem csuszik, kezifekkel igen ---
  {
    const gripped = await fresh(CIRCLE);
    segment(gripped, { throttle: 1 }, 60);
    segment(gripped, { steer: 1 }, 30);
    const gripSlip = slipAngleDeg(gripped);
    gripped.dispose();

    const drifting = await fresh(CIRCLE);
    segment(drifting, { throttle: 1 }, 60);
    segment(drifting, { steer: 1, handbrake: true }, 30);
    const driftSlip = slipAngleDeg(drifting);
    drifting.dispose();

    check(
      "normal kanyarban alig csuszik",
      gripSlip < 10,
      `${gripSlip.toFixed(1)} fok csuszasi szog`,
    );
    check(
      "kezifekkel erdemben megcsuszik",
      driftSlip > gripSlip + 8,
      `${driftSlip.toFixed(1)} fok kezifekkel a ${gripSlip.toFixed(1)} fokhoz kepest`,
    );
  }

  // --- Fektav ---
  {
    const b = await fresh(LANE);
    segment(b, { throttle: 1 }, 120);
    const from = speedMs(b);
    const start = b.getChassis().position;
    let steps = 0;
    while (speedMs(b) > 1 && steps < 180) {
      b.step(FIXED_DT, { ...NEUTRAL_INPUT, throttle: -1 });
      steps++;
    }
    const end = b.getChassis().position;
    const distance = Math.hypot(end[0] - start[0], end[2] - start[2]);
    check(
      "csucssebessegrol egy masodpercen belul megall",
      steps * FIXED_DT < 1.2,
      `${(steps * FIXED_DT).toFixed(2)} mp, ${distance.toFixed(1)} m (${(from * 3.6).toFixed(0)} km/h-rol)`,
    );
    b.dispose();
  }

  // A talpra allast a check-selfright meri -- itt nem duplikaljuk.

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("A teszt osszeomlott:", err);
  process.exit(1);
});
