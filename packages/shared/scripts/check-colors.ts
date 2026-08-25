/**
 * Autoszinek: egyediseg es kiosztas.
 *
 * A MEGOLDANDO HIBA: korabban a tavoli autok szinet a FOGADO kliens
 * osztotta ki a sajat listaja szerint, ezert ugyanaz a jatekos MAS
 * SZINU volt minden kepernyon. A jatekosok igy nem tudtak egymasrol
 * beszelni ("a piros kempel"), es a tesztvisszajelzes is pontatlan lett
 * volna.
 *
 * Futtatas: npm run check:colors
 */
import {
  CAR_COLORS,
  DEFAULT_CAR_COLOR,
  assignCarColor,
  carColorHex,
  isCarColorId,
  toCarColorId,
  type CarColorId,
} from "../src/carColors";

/** A szoba merete -- lasd MAX_PLAYERS_PER_ROOM a szerveren. */
const MAX_PLAYERS_PER_ROOM = 8;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

function main(): void {
  console.log("=== Autoszinek ===\n");

  // --- Eleg szin van MINDENKINEK ---
  //
  // Ha kevesebb szin lenne, mint ahany jatekos befer, ketten ugyanazt
  // kapnak -- es pont a megkulonboztethetoseg veszne el. Ez a teszt
  // akkor szol, ha valaki megnoveli a szoba meretet.
  check(
    "legalabb annyi szin van, ahany jatekos egy szobaba fer",
    CAR_COLORS.length >= MAX_PLAYERS_PER_ROOM,
    `${CAR_COLORS.length} szin / ${MAX_PLAYERS_PER_ROOM} jatekos`,
  );

  // --- Nincs ketszer ugyanaz ---
  const ids = new Set(CAR_COLORS.map((c) => c.id));
  const hexes = new Set(CAR_COLORS.map((c) => c.hex));
  check(
    "minden szin egyedi (azonosito es ertek szerint is)",
    ids.size === CAR_COLORS.length && hexes.size === CAR_COLORS.length,
    `${ids.size} azonosito, ${hexes.size} kulonbozo ertek`,
  );

  // --- Halozatrol barmi jöhet ---
  check(
    "ismeretlen szinnel az alapertelmezettre esunk vissza",
    toCarColorId("magenta") === DEFAULT_CAR_COLOR &&
      toCarColorId(undefined) === DEFAULT_CAR_COLOR &&
      toCarColorId(7) === DEFAULT_CAR_COLOR,
    "hibat nem dobunk",
  );
  check(
    "az ervenyes szinek atmennek",
    CAR_COLORS.every((c) => isCarColorId(c.id)),
    CAR_COLORS.map((c) => c.id).join(", "),
  );

  // --- Kiosztas: a szabad kerest megkapja ---
  check(
    "a szabad szint megkapja, aki keri",
    assignCarColor("red", ["blue", "green"]) === "red",
    "piros szabad volt",
  );

  // --- Foglalt keresnel mast kap, de kap ---
  {
    const given = assignCarColor("blue", ["blue"]);
    check(
      "foglalt szin helyett szabadot kap",
      given !== "blue" && isCarColorId(given),
      `kert: blue, kapott: ${given}`,
    );
  }

  // --- Egy TELI szoba is kiosztható utkozes nelkul ---
  //
  // A legrosszabb eset: mindenki UGYANAZT keri. Ha ilyenkor ketten
  // ugyanazt kapnak, a jatek kozbeni azonositas hasznalhatatlan.
  {
    const taken: CarColorId[] = [];
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++) {
      taken.push(assignCarColor("blue", taken));
    }
    check(
      "teli szobaban is mindenki kulonbozo szint kap",
      new Set(taken).size === MAX_PLAYERS_PER_ROOM,
      `${new Set(taken).size} kulonbozo szin ${MAX_PLAYERS_PER_ROOM} jatekosnak`,
    );
  }

  // --- A szin-ertek kikeresese ---
  check(
    "minden szinhez tartozik ervenyes ertek",
    CAR_COLORS.every((c) => carColorHex(c.id) === c.hex),
    "az azonositobol visszakaphato a szin",
  );

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
