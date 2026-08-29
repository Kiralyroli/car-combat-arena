import type { CarId } from "./carModels";
import type { WheelId } from "./config";

export interface DriveInput {
  /** -1 (tolatas) .. 1 (gaz) */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 (balra) .. 1 (jobbra) */
  steer: number;
  handbrake: boolean;
  /**
   * Boost aktiv-e ebben a lepesben.
   *
   * A boost KORLATOS eroforras: a hivo csak akkor allitja true-ra, ha
   * van meg a tartalyban (lasd BoostTank a kliensen). A fizika maga
   * nem ismeri a tartalyt -- itt csak a "most boostol" tenye latszik.
   */
  boost: boolean;
}

export const NEUTRAL_INPUT: DriveInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  boost: false,
};

/**
 * Egy kerek serules-allapota.
 * Ez a projekt-terv 8.1 fejezetenek adatmodellje, itt eloszor
 * kizarolag annak igazolasara, hogy futasidoben ervenyesitheto.
 */
export interface WheelDamage {
  /** 0..100 */
  hp: number;
  broken: boolean;
  /** 0..1 -- a tapadas szorzoja */
  gripMultiplier: number;
}

export const HEALTHY_WHEEL: WheelDamage = {
  hp: 100,
  broken: false,
  gripMultiplier: 1,
};

export interface Transform {
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

export interface WheelReadout extends Transform {
  id: WheelId;
  inContact: boolean;
  suspensionLength: number;
  /**
   * A kerek aktualis kormanyszoge radianban. NEM azonos a nyers
   * inputtal: a fizika simitja (steerSpeed / steerReturnSpeed), es a
   * sebesseg is csokkenti (steerFalloff). A halozati latvany-
   * szinkronhoz ez a tenyleges ertek kell.
   */
  steering: number;
  /** Aktualis sugar -- serules eseten csokkenhet (defekt / felni). */
  radius: number;
  damage: WheelDamage;
}

export interface Telemetry {
  speedKmh: number;
  wheelsOnGround: number;
  /** Egy fizikai lepes idotartama ms-ban (gordulo atlag). */
  stepMs: number;
  /** Hany fizikai lepes futott az utolso frame-ben. */
  stepsLastFrame: number;
}

/**
 * A cserelheto fizikai backend interfesze.
 *
 * A spike celja, hogy ezt tobb motorral is implementaljuk (Rapier, Jolt),
 * es azonos jelenetben, azonos inputtal hasonlitsuk ossze oket.
 */
export interface VehicleBackend {
  readonly name: string;
  readonly version: string;

  init(): Promise<void>;

  /** Egy FIX lepeskozu fizikai lepes. */
  step(dt: number, input: DriveInput): void;

  /**
   * A palya dobozainak csereje a modellek HAROMSZOGEIRE.
   *
   * Opcionalis: a modellek aszinkron erkeznek, es lehet, hogy sosem
   * (?dekor=0, vagy sikertelen betoltes). Olyankor a dobozok maradnak,
   * es a palya jatszhato -- csak durvabb.
   *
   * A visszateresi ertek a tenylegesen lecserelt epuletek szama.
   */
  swapArenaToMeshes?(
    meshek: readonly {
      csoport: string;
      vertices: Float32Array;
      indices: Uint32Array;
    }[],
  ): number;

  getChassis(): Transform;
  /** Linearis sebesseg (m/s) vilagkoordinatakban -- a halozati snapshothoz. */
  getVelocity(): [number, number, number];
  getWheels(): WheelReadout[];
  getTelemetry(): Telemetry;

  /**
   * Kilepesi feltetel #6: futasidoben, kerekenkent kulon allithato-e a
   * tapadas es a felfuggesztes. Ha ez nem megy, a per-kerek serules
   * csak sajat jarmu-fizikaval valosithato meg.
   */
  setWheelDamage(index: number, damage: WheelDamage): void;

  /** Visszaallitas a spawn pontra, vagy a megadott poziciora. */
  reset(position?: { x: number; y: number; z: number }): void;

  /**
   * Tavoli (halozati) jatekos autojanak fizikai teste.
   *
   * A hibrid authority modellben (terv 15.4) minden kliens a SAJAT
   * autojat szimulalja, a tobbiek pozicioja a halozatrol erkezik.
   * Ahhoz viszont, hogy neki lehessen menni egy masik autonak, a
   * tobbieknek is kell test a mi vilagunkban -- ezek KINEMATIKUS
   * testek: minket ellokhetnek, de oket mi nem mozdithatjuk el
   * (a mozgasukat a tulajdonosuk szimulacioja hatarozza meg).
   */
  /**
   * A mert halozati oda-vissza ut (ms). Az utkozes-joslat idozitese
   * EBBOL szarmazik: a joslatot addig kell tartani, amig a masik kliens
   * allapota vissza nem er -- ez pedig egyenesen a kesleltetestol fugg.
   * 0 = nincs halozat (egyjatekos).
   */
  setNetworkLatency(ms: number): void;

  /**
   * Robbanas lokese a SAJAT autonkra.
   *
   * A szerver csak azt mondja meg, hol es mekkora volt a robbanas -- a
   * fizikai hatast mindenki a sajat autojara szamolja, mert a hibrid
   * modellben a sajat mozgas a klienshez tartozik (terv 15.4).
   */
  applyExplosion(
    position: [number, number, number],
    radius: number,
    maxPush: number,
  ): void;

  /**
   * Tavoli jatekos fizikai teste.
   *
   * Az AUTOJA is szamit: a kocsik merete elter, es egy hosszabb auto
   * nagyobb testtel utkozik.
   */
  addRemoteBody(id: string, car?: CarId): void;

  /**
   * A sajat autonk cseréje (a szerver osztja ki belepeskor).
   *
   * Opcionalis: a merő tesztek egy resze sajat, egyszerusitett
   * backendet hasznal.
   */
  setCar?(car: CarId): void;
  /**
   * Melyik autoval epult egy tavoli jatekos teste -- vagy null.
   *
   * A TESZTEK olvassak: enelkul kivulrol nem lehetne megnezni, hogy a
   * meret tenyleg atjutott-e a halozaton. A jatek maga nem hasznalja.
   */
  remoteCarOf?(id: string): CarId | null;
  removeRemoteBody(id: string): void;
  /**
   * A tavoli auto fizikai testenek allapota, vagy null.
   *
   * A megjelenites EZT hasznalja a nyers halozati pozicio helyett: az
   * utkozes lokese igy azonnal latszik, nem csak azutan, hogy a masik
   * kliens allapota megjarta a szervert oda-vissza.
   */
  getRemoteBody(id: string): Transform | null;
  updateRemoteBody(
    id: string,
    position: [number, number, number],
    quaternion: [number, number, number, number],
    velocity: [number, number, number],
  ): void;

  dispose(): void;
}
