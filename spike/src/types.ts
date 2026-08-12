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
  dispose(): void;
}
