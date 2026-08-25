/**
 * Autoszinek.
 *
 * MIERT KELL: korabban a tavoli autok szinet a FOGADO kliens osztotta
 * ki, a sajat listaja szerint (`remoteCars.size % COLORS.length`). Ebbol
 * az kovetkezett, hogy ugyanaz a jatekos MAS SZINU volt minden
 * kepernyon -- harom jatekosnal A ugy latta B-t keknek, mint ahogy B
 * latta A-t. Igy a jatekosok nem tudtak egymasrol beszelni ("a piros
 * kempel"), es a visszajelzes is pontatlan lett volna.
 *
 * Most a szint a JATEKOS valasztja, a SZERVER osztja ki (o latja az
 * egesz szobat), es mindenki ugyanazt latja.
 *
 * PONTOSAN annyi szin van, ahany jatekos egy szobaba fer: igy az
 * egyediseg mindig teljesitheto, es nem kell "elfogyott a szin" agat
 * irni. Ha a szoba merete no, ITT is bovulnie kell -- ezt a
 * check:colors ellenorzi.
 */

export type CarColorId =
  | "yellow"
  | "blue"
  | "red"
  | "green"
  | "purple"
  | "orange"
  | "teal"
  | "pink";

export interface CarColor {
  id: CarColorId;
  /** Three.js szin (0xRRGGBB). */
  hex: number;
  /** Megjelenitheto nev a lobbynak. */
  label: string;
}

/**
 * A valaszthato szinek.
 *
 * A sarga all elol, mert az a modell EREDETI szine: aki nem valaszt,
 * pontosan azt az autot kapja, ami eddig is volt.
 */
export const CAR_COLORS: CarColor[] = [
  { id: "yellow", hex: 0xd6b83c, label: "Sárga" },
  { id: "blue", hex: 0x3b82f6, label: "Kék" },
  { id: "red", hex: 0xef4444, label: "Piros" },
  { id: "green", hex: 0x22c55e, label: "Zöld" },
  { id: "purple", hex: 0xa855f7, label: "Lila" },
  { id: "orange", hex: 0xf97316, label: "Narancs" },
  { id: "teal", hex: 0x14b8a6, label: "Türkiz" },
  { id: "pink", hex: 0xec4899, label: "Rózsaszín" },
];

export const DEFAULT_CAR_COLOR: CarColorId = "yellow";

/**
 * Halozatrol erkezo ertek ellenorzese.
 *
 * A szint a kliens valasztja, tehat barmit kuldhet: ismeretlen erteknel
 * az alapertelmezetthez esunk vissza, nem dobunk hibat.
 */
export function isCarColorId(value: unknown): value is CarColorId {
  return (
    typeof value === "string" && CAR_COLORS.some((color) => color.id === value)
  );
}

export function toCarColorId(value: unknown): CarColorId {
  return isCarColorId(value) ? value : DEFAULT_CAR_COLOR;
}

export function carColorHex(id: CarColorId): number {
  return (CAR_COLORS.find((color) => color.id === id) ?? CAR_COLORS[0]).hex;
}

export function carColorLabel(id: CarColorId): string {
  return (CAR_COLORS.find((color) => color.id === id) ?? CAR_COLORS[0]).label;
}

/**
 * Egy szabad szin kiosztasa.
 *
 * A kert szin akkor jar, ha meg senkie a szobaban -- kulonben a
 * legelso szabadot adjuk. NEM utasitjuk el a belepest: a szin
 * kenyelmi kerdes, nem allhat a jatek utjaba.
 *
 * @param taken Amit a szoba tobbi jatekosa mar hasznal.
 */
export function assignCarColor(
  requested: CarColorId,
  taken: readonly CarColorId[],
): CarColorId {
  if (!taken.includes(requested)) return requested;
  const free = CAR_COLORS.find((color) => !taken.includes(color.id));
  // Ha minden szin foglalt (tobb jatekos, mint szin), marad a kert --
  // ilyenkor az egyediseg amugy sem tarthato.
  return free?.id ?? requested;
}
