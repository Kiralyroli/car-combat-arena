/**
 * A valaszthato AUTOK es a SKINJEIK.
 *
 * KET SZINT: eloszor a KAROSSZERIAT valasztja a jatekos (negy
 * kulonbozo forma), azon belul a FESTEST (skin). A ketto nem
 * ugyanolyan sulyu: a forma messzirol is felismerheto -- egy izomauto
 * es egy terepjaro sziluettje nem osszekeverheto --, a festes viszont
 * kozelrol donti el, hogy ket ugyanolyan kocsi kozul melyik kicsoda.
 *
 * A SZERVER OSZTJA KI a paros egyediseget: o latja az egesz szobat,
 * tehat o tudja biztositani, hogy ne legyen ket teljesen egyforma auto.
 * Ha a fogado kliens dontene, ugyanaz a jatekos MAS kocsival jelenne
 * meg minden kepernyon, es nem lehetne rola beszelni ("a rendorauto
 * kempel").
 *
 * A GEOMETRIA a MODELLHEZ tartozik, nem a skinhez: egy forma osszes
 * festese ugyanazt a testet, ugyanazokat a kerekeket es ugyanazt a
 * talalati alakot hasznalja (lasd carGeometry.ts). A skin tisztan
 * latvany -- nem ad elonyt.
 */

export type CarId = "Muscle" | "Jeep" | "Crossover" | "Rescue";

export interface CarModel {
  id: CarId;
  /** Megjelenitheto nev a valasztoban. */
  label: string;
  /** Egy soros jellemzes -- a valasztoban segit donteni. */
  leiras: string;
  /**
   * A valaszthato festesek, ELSO az alapertelmezett.
   *
   * A kulcs a generalt textura-terkep kulcsa (lasd carSkins.ts), a
   * label a jatekosnak szol.
   */
  skins: { id: string; label: string }[];
}

/**
 * A negy karosszeria.
 *
 * A FIZIKA lenyegeben azonos: a meretek elternek (4,1 m-tol 4,9 m-ig),
 * de a vezetes, a tomeg es a sebzes ugyanaz -- kulonben a valasztas
 * nem izles kerdese lenne, hanem elony. A leirasok ezert a kinezetrol
 * szolnak, nem kepessegekrol.
 */
export const CAR_MODELS: CarModel[] = [
  {
    id: "Muscle",
    label: "Izomautó",
    leiras: "Alacsony, hosszú orrú",
    skins: [
      { id: "Sarga", label: "Sárga csík" },
      { id: "Feher", label: "Fehér" },
      { id: "Kek", label: "Kék" },
      { id: "Piros", label: "Piros" },
    ],
  },
  {
    id: "Jeep",
    label: "Terepjáró",
    leiras: "Szögletes, pótkerekes",
    skins: [
      { id: "Fekete", label: "Fekete" },
      { id: "Feher", label: "Fehér" },
      { id: "Kek", label: "Kék" },
      { id: "Piros", label: "Piros" },
    ],
  },
  {
    id: "Crossover",
    label: "Crossover",
    leiras: "Modern, lekerekített",
    skins: [
      { id: "Fekete", label: "Fekete" },
      { id: "Zold", label: "Zöld" },
      { id: "Narancs", label: "Narancs" },
      { id: "Rozsdas", label: "Rozsdás" },
      { id: "Terep", label: "Terepmintás" },
    ],
  },
  {
    id: "Rescue",
    label: "Rohamkocsi",
    leiras: "Magas, villogós",
    skins: [
      { id: "Rendor", label: "Rendőr" },
      { id: "Mento", label: "Mentő" },
      { id: "Szerviz", label: "Szerviz" },
    ],
  },
];

export const DEFAULT_CAR: CarId = "Muscle";
export const DEFAULT_SKIN: string = CAR_MODELS[0].skins[0].id;

/**
 * Halozatrol erkezo ertek ellenorzese.
 *
 * Az autot a kliens valasztja, tehat barmit kuldhet: ismeretlen
 * erteknel az alapertelmezetthez esunk vissza, nem dobunk hibat.
 */
export function isCarId(value: unknown): value is CarId {
  return typeof value === "string" && CAR_MODELS.some((c) => c.id === value);
}

export function toCarId(value: unknown): CarId {
  return isCarId(value) ? value : DEFAULT_CAR;
}

export function carModel(id: CarId): CarModel {
  return CAR_MODELS.find((c) => c.id === id) ?? CAR_MODELS[0];
}

export function carLabel(id: CarId): string {
  return carModel(id).label;
}

/** Az adott autohoz tartozo skinek azonositoi. */
export function skinsOf(car: CarId): string[] {
  return carModel(car).skins.map((s) => s.id);
}

/** Egy skin ervenyes-e EZEN az auton (a skinek autonkent masok). */
export function isSkinOf(car: CarId, skin: unknown): boolean {
  return typeof skin === "string" && skinsOf(car).includes(skin);
}

export function toSkin(car: CarId, skin: unknown): string {
  return isSkinOf(car, skin) ? (skin as string) : skinsOf(car)[0];
}

export function skinLabel(car: CarId, skin: string): string {
  return carModel(car).skins.find((s) => s.id === skin)?.label ?? skin;
}

/** Egy jatekos kinezete: karosszeria + festes. */
export interface CarLook {
  car: CarId;
  skin: string;
}

/**
 * Egyedi kinezet kiosztasa a szobaban.
 *
 * A KERT parost adja, ha meg szabad. Ha foglalt, eloszor UGYANAZON a
 * karosszerian keres masik festest -- a jatekos valasztott formaja igy
 * megmarad --, es csak ha az osszes festese elfogyott, akkor valt masik
 * kocsira.
 *
 * MIERT NEM eleg a karosszeriat egyedive tenni: negy forma van, egy
 * szobaba viszont nyolc jatekos fer. A festessel egyutt 16 kombinacio
 * van, ami boven eleg -- de a sorrend szamit, mert egy azonos formaju,
 * mas szinu par tavolrol nehezebben kulonboztetheto meg, mint ket
 * kulonbozo forma.
 */
export function assignCar(
  kert: CarLook,
  foglaltak: readonly CarLook[],
): CarLook {
  const foglalt = new Set(foglaltak.map((f) => `${f.car}|${f.skin}`));
  const szabad = (l: CarLook) => !foglalt.has(`${l.car}|${l.skin}`);

  const car = toCarId(kert.car);
  const skin = toSkin(car, kert.skin);
  if (szabad({ car, skin })) return { car, skin };

  for (const s of skinsOf(car)) {
    if (szabad({ car, skin: s })) return { car, skin: s };
  }
  for (const m of CAR_MODELS) {
    for (const s of skinsOf(m.id)) {
      if (szabad({ car: m.id, skin: s })) return { car: m.id, skin: s };
    }
  }
  // Ha minden elfogyott (tobb jatekos, mint kombinacio), a kertet
  // adjuk: inkabb ket egyforma auto, mint hibas allapot.
  return { car, skin };
}
