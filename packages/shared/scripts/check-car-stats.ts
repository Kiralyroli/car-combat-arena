/**
 * AUTONKENTI TULAJDONSAGOK merese.
 *
 * A negy karosszeria mostantol nem csak masmilyen, hanem MAS IS:
 * gyorsabb/lassabb, torekenyebb/strapabb, nehezebb/konnyebb
 * (carStats.ts). Ez a meres azt kerdezi, hogy amit a tablazat IGER, az
 * a tenyleges vezetesben is megtortenik-e.
 *
 * A MERES A VEZETETT EREDMENYT NEZI, NEM A TABLAZATOT. Egy olyan
 * teszt, ami a `carStats(car).speed`-et olvassa vissza es osszehasonlitja
 * a `carStats(car).speed`-del, SEMMIT nem orizne: atmenne akkor is, ha a
 * szorzo sehol nem hat a fizikara. Ezert minden szam itt egy
 * VEGIGVEZETETT szakaszbol jon (RapierBackend, ugyanaz a motor, mint a
 * jatekban) -- kiveve a HP-t es a tomeget, amik nem "vezetheto"
 * mennyisegek: azokat a HASZNALATI helyukon merjuk (sebzes-elosztas),
 * nem a definiciojuk visszaolvasasaval.
 *
 * MEROSAV. Ugyanaz a csapda, mint a check-arcade-ben: ha a kocsi
 * nekimegy valaminek, a "mert csucssebesseg" ertelmetlen lesz -- es
 * csendben. Ezert minden szakasz utan ellenorizzuk, hogy a kocsi
 * tenyleg vegigment-e a savon.
 *
 * Futtatas: npm run check:car-stats
 */
import { RapierBackend } from "../src/physics/rapier";
import { BARE_ARENA, FIXED_DT } from "../src/config";
import { NEUTRAL_INPUT } from "../src/types";
import {
  CAR_MODELS,
  carStats,
  carTuning,
  carStars,
  starRow,
  STAR_COUNT,
  maxHpOf,
  splitCollisionDamage,
  statPower,
  type CarId,
  type ClientState,
} from "../src/index";

/** Ugyanazok a szabad merosavok, mint a check-arcade-ben. */
const LANE = { x: 30, y: 2.5, z: 35 };
const CIRCLE = { x: 25, y: 2.5, z: 20 };

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

function yawOf(q: readonly number[]): number {
  const [x, y, z, w] = q;
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z));
}

async function fresh(
  car: CarId,
  at: { x: number; y: number; z: number },
): Promise<RapierBackend> {
  const backend = new RapierBackend();
  await backend.init({ arena: BARE_ARENA });
  backend.setCar(car);
  backend.reset(at);
  for (let i = 0; i < 90; i++) backend.step(FIXED_DT, NEUTRAL_INPUT);
  return backend;
}

const speedMs = (b: RapierBackend) => b.getTelemetry().speedKmh / 3.6;

/** Egy auto MERT jellemzoi -- mind vegigvezetett szakaszbol. */
interface Mert {
  /** Csucssebesseg gazzal (m/s). */
  csucs: number;
  /** Mennyi ido 0-tol 80 km/h-ig (mp), vagy null, ha el sem erte. */
  nyolcvanig: number | null;
  /** Kanyarsugar (m) allando sebessegen, gaz nelkul. */
  sugar: number;
  /** A legkisebb sebesseg a kanyarban -- utkozes-or. */
  kanyarMin: number;
}

async function merd(car: CarId): Promise<Mert> {
  // --- Csucssebesseg es gyorsulas ---
  const gyors = await fresh(car, LANE);
  let nyolcvanAt: number | null = null;
  for (let i = 0; i < 150; i++) {
    gyors.step(FIXED_DT, { ...NEUTRAL_INPUT, throttle: 1 });
    if (nyolcvanAt === null && gyors.getTelemetry().speedKmh >= 80) {
      nyolcvanAt = (i + 1) * FIXED_DT;
    }
  }
  const csucs = speedMs(gyors);
  gyors.dispose();

  // --- Kanyarsugar ---
  //
  // 80 km/h-ig, NEM a csucsig: a kanyarsugar egyenesen aranyos a
  // sebesseggel, tehat ha mindegyik auto a sajat csucsan kanyarodna, a
  // gyorsabb kocsi nagyobb ivet irna le akkor is, ha a kormanya
  // ugyanolyan. Kozos sebessegen viszont tisztan a fordulas latszik.
  const kanyar = await fresh(car, CIRCLE);
  for (let i = 0; i < 300 && kanyar.getTelemetry().speedKmh < 80; i++) {
    kanyar.step(FIXED_DT, { ...NEUTRAL_INPUT, throttle: 1 });
  }
  let elozoYaw = yawOf(kanyar.getChassis().quaternion);
  let yawSum = 0;
  let kanyarMin = Infinity;
  const lepesek = 30;
  for (let i = 0; i < lepesek; i++) {
    kanyar.step(FIXED_DT, { ...NEUTRAL_INPUT, steer: 1 });
    kanyarMin = Math.min(kanyarMin, speedMs(kanyar));
    const yaw = yawOf(kanyar.getChassis().quaternion);
    let d = yaw - elozoYaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    yawSum += d;
    elozoYaw = yaw;
  }
  const yawRate = Math.abs(yawSum) / (lepesek * FIXED_DT);
  const sugar = speedMs(kanyar) / yawRate;
  kanyar.dispose();

  return { csucs, nyolcvanig: nyolcvanAt, sugar, kanyarMin };
}

/** Ket auto szembe-utkozese azonos sebesseggel -- ki jar jobban. */
function szembeUtkozes(a: CarId, b: CarId): { a: number; b: number } {
  const allapot = (z: number, vz: number): ClientState =>
    ({
      position: [0, 1, z],
      rotation: [0, 0, 0, 1],
      velocity: [0, 0, vz],
    }) as ClientState;
  // Pontosan szimmetrikus felallas: az egyetlen kulonbseg a TOMEG.
  return splitCollisionDamage(
    allapot(2, -20),
    allapot(-2, 20),
    carStats(a).mass,
    carStats(b).mass,
  );
}

async function main(): Promise<void> {
  console.log("=== Autonkenti tulajdonsagok ===\n");

  const mert = new Map<CarId, Mert>();
  console.log("Mert jellemzok (vegigvezetett szakaszokbol):\n");
  for (const m of CAR_MODELS) {
    const r = await merd(m.id);
    mert.set(m.id, r);
    console.log(
      `  ${m.label.padEnd(12)} ${(r.csucs * 3.6).toFixed(0).padStart(3)} km/h · ` +
        `0-80 ${r.nyolcvanig === null ? " -- " : `${r.nyolcvanig.toFixed(2)} mp`} · ` +
        `kanyar ${r.sugar.toFixed(1)} m · ${maxHpOf(m.id)} HP`,
    );
  }
  console.log("");

  // --- 1. A meres ervenyes-e egyaltalan ---
  {
    const utkozott = CAR_MODELS.filter(
      (m) => mert.get(m.id)!.kanyarMin < 10,
    );
    check(
      "egyik meres sem utkozott akadalyba",
      utkozott.length === 0,
      utkozott.length === 0
        ? "mind a negy auto vegigment a savon"
        : `${utkozott.map((m) => m.label).join(", ")} lelassult -- a szamai ertelmetlenek`,
    );
    const nemErteEl = CAR_MODELS.filter(
      (m) => mert.get(m.id)!.nyolcvanig === null,
    );
    check(
      "mind a negy auto eleri a 80 km/h-t",
      nemErteEl.length === 0,
      nemErteEl.length === 0
        ? "a gyorsulas-meres mindegyikre ertelmes"
        : `${nemErteEl.map((m) => m.label).join(", ")} el sem erte`,
    );
  }

  // --- 2. A tenyleges csucssebesseg azt adja, amit a tablazat iger ---
  //
  // EZ a lenyeg: a szorzo nem egy szam a fajlban, hanem a vezetesben is
  // megtortenik. Ha valaki kiveszi a `tuning`-ot a stepArcade-bol,
  // MIND A NEGY auto ugyanazt a csucsot merne -- es ez a sor bukna el.
  for (const m of CAR_MODELS) {
    const varhato = carTuning(m.id).maxSpeed;
    const tenyleges = mert.get(m.id)!.csucs;
    check(
      `${m.label}: a mert csucssebesseg a sajat szamait koveti`,
      Math.abs(tenyleges - varhato) < 0.5,
      `${(tenyleges * 3.6).toFixed(1)} km/h (varhato: ${(varhato * 3.6).toFixed(1)})`,
    );
  }

  // --- 3. A SORREND ---
  //
  // A konkret szamok hangolhatok, a SORREND viszont maga a terv: az
  // izomauto a leggyorsabb es a legtorekenyebb, a rohamkocsi a
  // legszivosabb es a leglassabb. Ha ez megfordul, az nem hangolas,
  // hanem elirás.
  {
    const gyorsSorrend = [...CAR_MODELS]
      .sort((a, b) => mert.get(b.id)!.csucs - mert.get(a.id)!.csucs)
      .map((m) => m.id);
    check(
      "a leggyorsabb auto az izomauto, a leglassabb a rohamkocsi",
      gyorsSorrend[0] === "Muscle" && gyorsSorrend[3] === "Rescue",
      gyorsSorrend.join(" > "),
    );

    const hpSorrend = [...CAR_MODELS]
      .sort((a, b) => maxHpOf(b.id) - maxHpOf(a.id))
      .map((m) => m.id);
    check(
      "az eletero SORRENDJE forditott a sebesseghez kepest",
      hpSorrend[0] === "Rescue" && hpSorrend[3] === "Muscle",
      hpSorrend.map((id) => `${id} ${maxHpOf(id)}`).join(" > "),
    );

    // A kanyar: a nehez kocsi lomhabb, tehat NAGYOBB ivet ir le.
    check(
      "a rohamkocsi tagabb ivben fordul, mint az izomauto",
      mert.get("Rescue")!.sugar > mert.get("Muscle")!.sugar,
      `${mert.get("Rescue")!.sugar.toFixed(1)} m vs ${mert.get("Muscle")!.sugar.toFixed(1)} m`,
    );
  }

  // --- 4. A TOMEG a sebzes-elosztasban is megjelenik ---
  //
  // A fizikai lokest a Rapier adja (nagyobb tomeg -> nagyobb lendulet),
  // azt itt nem merjuk. Amit igen: a szimmetrikus szembe-utkozesnel,
  // ahol MINDEN mas azonos, a nehezebb auto kevesebbet kapjon.
  {
    const { a: nehez, b: konnyu } = szembeUtkozes("Rescue", "Muscle");
    check(
      "szembe-utkozesnel a nehezebb auto kevesebbet kap",
      nehez < konnyu,
      `rohamkocsi -${nehez} HP, izomauto -${konnyu} HP`,
    );

    // ...de NEM annyival, hogy a rammeles legyen a nyilvanvalo
    // strategia. A tomeg-szorzo korlatozott (lasd combat.ts).
    check(
      "a tomeg elonye mersekelt, nem dönto",
      konnyu < nehez * 2,
      `${(konnyu / nehez).toFixed(2)}-szeres kulonbseg (a korlat 2x alatt tart)`,
    );

    const azonos = szembeUtkozes("Crossover", "Crossover");
    check(
      "azonos autok szembe-utkozese tovabbra is szimmetrikus",
      azonos.a === azonos.b,
      `${azonos.a} vs ${azonos.b} HP`,
    );
  }

  // --- 5. A CSILLAGOK azt mondjak, amit a kocsi CSINAL ---
  //
  // A valasztonal a jatekos MAR CSAK a csillagokat latja, szamokat nem.
  // Ez tehat nem dekoracio: ha a csillagsor nem koveti a tenyleges
  // vezetest, akkor a jatek HAZUDIK a valasztaskor -- es a jatekos
  // pontosan az ellenkezojet viszi annak, amit akart.
  //
  // Ezert a MERT sorrendhez hasonlitjuk, nem a tablazathoz.
  {
    console.log("");
    for (const m of CAR_MODELS) {
      const cs = carStars(m.id);
      console.log(
        `  ${m.label.padEnd(12)} sebesség ${starRow(cs.speed)}  élet ${starRow(cs.hp)}`,
      );
    }
    console.log("");

    const mertSorrend = [...CAR_MODELS].sort(
      (a, b) => mert.get(b.id)!.csucs - mert.get(a.id)!.csucs,
    );
    const csillagSorrend = [...CAR_MODELS].sort(
      (a, b) => carStars(b.id).speed - carStars(a.id).speed,
    );
    check(
      "a sebesseg-csillagok a MERT sorrendet koveti",
      mertSorrend.every((m, i) => carStars(m.id).speed >= carStars(csillagSorrend[i].id).speed),
      `mert: ${mertSorrend.map((m) => m.id).join(" > ")}`,
    );

    const leggyorsabb = mertSorrend[0];
    const leglassabb = mertSorrend[mertSorrend.length - 1];
    check(
      "a leggyorsabb ot csillagot kap, a leglassabb egyet",
      carStars(leggyorsabb.id).speed === STAR_COUNT &&
        carStars(leglassabb.id).speed === 1,
      `${leggyorsabb.label} ${carStars(leggyorsabb.id).speed}/${STAR_COUNT}, ${leglassabb.label} ${carStars(leglassabb.id).speed}/${STAR_COUNT}`,
    );

    const legszivosabb = [...CAR_MODELS].sort(
      (a, b) => maxHpOf(b.id) - maxHpOf(a.id),
    );
    check(
      "az elet-csillagok az eletero sorrendjet koveti",
      carStars(legszivosabb[0].id).hp === STAR_COUNT &&
        carStars(legszivosabb[legszivosabb.length - 1].id).hp === 1,
      `${legszivosabb[0].label} ${maxHpOf(legszivosabb[0].id)} HP = ${carStars(legszivosabb[0].id).hp}/${STAR_COUNT}`,
    );
  }

  // --- 6. BALANSZ-OR: nincs mindenben legjobb auto ---
  //
  // Ez a sor nem egy erzetet ellenoriz, hanem egy elirast fog meg: ha
  // valaki egy autonak minden tengelyen felfele huzza a szamait, az
  // tobbe nem valasztas, hanem helyes valasz. A "eronlet" a
  // tengelyek atlaga (statPower).
  {
    const eronletek = CAR_MODELS.map((m) => ({
      id: m.id,
      ero: statPower(m.id),
    }));
    const legjobb = Math.max(...eronletek.map((e) => e.ero));
    const leggyengebb = Math.min(...eronletek.map((e) => e.ero));
    check(
      "egyik auto sem no a mezony fole",
      legjobb - leggyengebb < 0.2,
      eronletek
        .map((e) => `${e.id} ${(e.ero * 100).toFixed(0)}%`)
        .join(", "),
    );

    // ...es konkretan: senki nem legjobb MINDEN tengelyen.
    const tengelyek = ["mass", "speed", "accel", "turn"] as const;
    const mindenbenLegjobb = CAR_MODELS.filter((m) =>
      tengelyek.every((t) =>
        CAR_MODELS.every((masik) => carStats(m.id)[t] >= carStats(masik.id)[t]),
      ) && CAR_MODELS.every((masik) => maxHpOf(m.id) >= maxHpOf(masik.id)),
    );
    check(
      "nincs olyan auto, ami minden tengelyen a legjobb",
      mindenbenLegjobb.length === 0,
      mindenbenLegjobb.length === 0
        ? "minden valasztasnak van ara"
        : `${mindenbenLegjobb.map((m) => m.label).join(", ")} mindenben nyer`,
    );
  }

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
