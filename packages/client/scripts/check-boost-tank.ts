/**
 * A boost-tartaly szabalyai.
 *
 * A boost KORLATOS eroforras: fix mennyiseg van belole, a Shift ebbol
 * fogy, es egy felvett pickup 50%-ot tolt vissza.
 *
 * SZANDEKOSAN egysegteszt, nem bongeszos e2e: a fogyas es a
 * visszatoltes pontos aranyait ott nem lehet megbizhatoan merni (a
 * kepkockasebesseg ingadozik, a palya akadalyai pedig elnyomjak a
 * kulonbseget -- lasd check-pickups.ts). Itt viszont determinisztikus.
 *
 * Futtatas: npm run check:boost
 */
import { BOOST_CAPACITY_MS } from "@cca/shared";
import { BoostTank } from "../src/boostTank";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

/** Egy masodperc boostolas 60 Hz-es lepesekben. */
function boostFor(tank: BoostTank, seconds: number): number {
  let effectiveSteps = 0;
  const stepMs = 1000 / 60;
  for (let i = 0; i < seconds * 60; i++) {
    if (tank.consume(true, stepMs)) effectiveSteps++;
  }
  return effectiveSteps;
}

function main(): void {
  console.log("=== Boost-tartaly ===\n");

  console.log("Fogyasztas:");

  const tank = new BoostTank();
  check(
    "teli tartallyal indulunk",
    tank.fraction === 1,
    `${(tank.fraction * 100).toFixed(0)}%`,
  );

  boostFor(tank, 1);
  check(
    "egy masodperc boost a kapacitas aranyos reszet viszi el",
    Math.abs(tank.fraction - (1 - 1000 / BOOST_CAPACITY_MS)) < 0.02,
    `${(tank.fraction * 100).toFixed(0)}% maradt (${BOOST_CAPACITY_MS} ms-bol 1000 ms fogyott)`,
  );

  // Shift NELKUL nem fogyhat: kulonben allva is elszivarogna.
  const idle = new BoostTank();
  for (let i = 0; i < 600; i++) idle.consume(false, 1000 / 60);
  check(
    "boost nelkul nem fogy",
    idle.fraction === 1,
    `${(idle.fraction * 100).toFixed(0)}% 10 masodperc utan`,
  );

  console.log("\nKifogyas:");

  const empty = new BoostTank();
  const effective = boostFor(empty, 20);
  check(
    "a tartaly kifogy",
    empty.isEmpty && empty.fraction === 0,
    `${(empty.fraction * 100).toFixed(0)}%`,
  );
  // A lenyeg: ures tartallyal a Shift HATASTALAN. Ha csak a kijelzes
  // allna nullan, de a hajtoero tovabbra is boostolna, a korlat semmit
  // nem jelentene.
  check(
    "ures tartallyal a boost mar nem hat",
    Math.abs(effective - (BOOST_CAPACITY_MS / 1000) * 60) < 2,
    `${effective} lepesen at hatott (${((BOOST_CAPACITY_MS / 1000) * 60).toFixed(0)} varhato), 20 mp nyomva tartas mellett`,
  );
  check(
    "kifogyott tartalybol tovabb nyomva sem lesz boost",
    !empty.consume(true, 100),
    "false",
  );

  console.log("\nVisszatoltes pickupbol:");

  const refilled = new BoostTank();
  boostFor(refilled, 20); // teljesen kiuriti
  refilled.refill();
  check(
    "egy pickup 50%-ot tolt vissza",
    Math.abs(refilled.fraction - 0.5) < 0.01,
    `${(refilled.fraction * 100).toFixed(0)}%`,
  );

  refilled.refill();
  check(
    "masodik pickup teletolti",
    Math.abs(refilled.fraction - 1) < 0.01,
    `${(refilled.fraction * 100).toFixed(0)}%`,
  );

  refilled.refill();
  check(
    "teli tartaly folott nem halmozodik",
    refilled.fraction === 1 && refilled.remaining === BOOST_CAPACITY_MS,
    `${refilled.remaining} ms (kapacitas ${BOOST_CAPACITY_MS} ms)`,
  );

  console.log("\nSzerver-szinkron (visszatoltes-szamlalo):");

  // A szerver a KIOSZTOTT visszatoltesek szamat kuldi, nem esemenyt.
  // Az elso ertek csak kiindulopont: abbol meg nem jar toltes --
  // kulonben egy ujracsatlakozo jatekos azonnal teli tartalyt kapna.
  const synced = new BoostTank();
  boostFor(synced, 20);
  synced.syncGrants(7);
  check(
    "az elso szinkron nem tolt (csak kiindulopont)",
    synced.fraction === 0,
    `${(synced.fraction * 100).toFixed(0)}% 7-es kezdo szamlalonal`,
  );

  synced.syncGrants(8);
  check(
    "a szamlalo novekedese tolt",
    Math.abs(synced.fraction - 0.5) < 0.01,
    `7 -> 8: ${(synced.fraction * 100).toFixed(0)}%`,
  );

  // Ugyanaz a snapshot tobbszor is megerkezhet (vagy egyszeruen nem
  // valtozik) -- ettol nem szabad ujra tolteni.
  synced.syncGrants(8);
  synced.syncGrants(8);
  check(
    "valtozatlan szamlalo nem tolt ujra",
    Math.abs(synced.fraction - 0.5) < 0.01,
    `${(synced.fraction * 100).toFixed(0)}%`,
  );

  // Csomagvesztes: ha ket pickup kozott kimarad egy snapshot, a
  // szamlalo kettot ugrik -- MINDKETTONEK jarnia kell. Esemeny-alapu
  // megoldasnal ez a toltes elveszne.
  const skipped = new BoostTank();
  boostFor(skipped, 20);
  skipped.syncGrants(0);
  skipped.syncGrants(2);
  check(
    "kihagyott snapshot utan is jar minden visszatoltes",
    Math.abs(skipped.fraction - 1) < 0.01,
    `0 -> 2 egy lepesben: ${(skipped.fraction * 100).toFixed(0)}%`,
  );

  console.log("\nUjraszuletes:");

  const dead = new BoostTank();
  boostFor(dead, 20);
  dead.reset();
  check(
    "ujraszuletesnel teli a tartaly",
    dead.fraction === 1,
    `${(dead.fraction * 100).toFixed(0)}%`,
  );

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
