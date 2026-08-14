import type { WheelId } from "./config";

export interface DriveInput {
  /** -1 (tolatas) .. 1 (gaz) */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 (balra) .. 1 (jobbra) */
  steer: number;
  handbrake: boolean;
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
  addRemoteBody(id: string): void;
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
