import { ARCADE } from "../config";
import { clamp, lerp } from "../math";
import type { DriveInput } from "../types";

/**
 * Az arkad vezetes-modell MAGJA -- tiszta szamtan, motor nelkul.
 *
 * SZANDEKOSAN nem ismeri sem a Rapiert, sem a vilagot: csak skalar
 * sebessegekkel dolgozik az auto sajat rendszereben. Igy a vezetes
 * erzete Node alatt, fizikai motor es bongeszo nelkul is merheto (lasd
 * scripts/check-arcade.ts) -- a regi modellnel ez lehetetlen volt, mert
 * minden a jarmu-kontroller belsejeben tortent.
 *
 * A hivo (lasd rapier.ts) dolga, hogy a vilagbeli sebesseget ide
 * lebontsa, majd az eredmenyt visszaforditsa.
 */

/**
 * Sebessegallapot az AUTO sajat rendszereben.
 *
 * A fuggoleges sebesseg szandekosan hianyzik: azt a gravitacio es az
 * utkozesek intezik, a vezetes-modell nem nyul hozza.
 */
export interface ArcadeMotion {
  /** Sebesseg az orr iranyaban (m/s). Negativ = tolat. */
  forward: number;
  /** Oldalirányu sebesseg (m/s). Pozitiv = jobbra csuszik. */
  lateral: number;
  /**
   * Fordulas a FUGGOLEGES tengely korul (rad/s).
   *
   * Elojel: a pozitiv ertek a vilag +Y tengelye koruli forgas, ami a
   * -Z = elore konvencioban BALRA forditja az orrot. Jobbra kormanyzas
   * tehat negativ yawRate -- lasd stepArcade.
   */
  yawRate: number;
}

export interface ArcadeContext {
  /** Er-e legalabb egy kerek a talajt. */
  grounded: boolean;
  /**
   * A kerekek allapotabol szarmazo tapadas (0..1).
   * 1 = mind a negy kerek ep, 0 = egy hasznalhato sincs.
   */
  grip: number;
}

/**
 * Korlatozott valtozas: `current` legfeljebb `maxDelta`-t lephet
 * `target` fele.
 *
 * A modell MINDEN mennyiseget ezen keresztul allit -- soha nem
 * ertekadassal. Ez tartja meg az utkozeseket es a robbanasok lokeset:
 * amit a fizikai motor csinalt a sebesseggel, azt csak fokozatosan
 * hozzuk vissza, nem toroljuk egy lepesben.
 */
export function approach(
  current: number,
  target: number,
  maxDelta: number,
): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

/**
 * Mennyire hatekony a kormany ekkora sebessegnel (0..1).
 *
 * Allo helyzetben nulla (a kocsi nem pordul meg a helyben), majd
 * `turnRampSpeed`-ig felfut a teljes ertekre, csucssebessegnel pedig
 * `turnFactorAtTopSpeed`-re esik vissza.
 */
export function turnFactor(forwardSpeed: number): number {
  const speed = Math.abs(forwardSpeed);
  const ramp = clamp(speed / ARCADE.turnRampSpeed, 0, 1);
  const span = Math.max(1e-3, ARCADE.maxSpeed - ARCADE.turnRampSpeed);
  const over = clamp((speed - ARCADE.turnRampSpeed) / span, 0, 1);
  return ramp * lerp(1, ARCADE.turnFactorAtTopSpeed, over);
}

/** Celsebesseg az orr iranyaban, a gaz allasabol (m/s). */
export function targetForwardSpeed(input: DriveInput): number {
  if (input.throttle > 0) {
    const top = input.boost ? ARCADE.boostMaxSpeed : ARCADE.maxSpeed;
    return top * Math.min(1, input.throttle);
  }
  if (input.throttle < 0) {
    return -ARCADE.maxReverseSpeed * Math.min(1, -input.throttle);
  }
  return 0;
}

/**
 * Milyen utemben valtozhat a hosszanti sebesseg ebben a lepesben
 * (m/s^2).
 */
function longitudinalRate(
  forward: number,
  target: number,
  input: DriveInput,
): number {
  if (input.throttle === 0) return ARCADE.coastDecel;

  // A holtsav (0.2 m/s) nelkul allo helyzet kozeleben a "fekezunk vagy
  // gyorsitunk?" dontes lepesenkent atbillenne ide-oda.
  const movingForward = forward > 0.2;
  const movingBack = forward < -0.2;
  if ((input.throttle > 0 && movingBack) || (input.throttle < 0 && movingForward)) {
    return ARCADE.brakeDecel;
  }

  // Mar gyorsabban megyunk, mint amit a gaz kerne (rampa, robbanas,
  // masik auto lokese). Ilyenkor NEM rantjuk vissza a csucssebessegre,
  // csak hagyjuk lecsengeni -- kulonben minden lokes azonnal eltunne.
  if (Math.abs(forward) > Math.abs(target)) return ARCADE.coastDecel;

  return input.boost && input.throttle > 0 ? ARCADE.boostAccel : ARCADE.accel;
}

/**
 * Egy vezetesi lepes.
 *
 * Harom fuggetlen mennyiseget mozgat a celertek fele, mindegyiket
 * korlatozott utemben (lasd approach).
 */
export function stepArcade(
  motion: ArcadeMotion,
  input: DriveInput,
  dt: number,
  ctx: ArcadeContext,
): ArcadeMotion {
  const grip = clamp(ctx.grip, 0, 1);

  // --- 1. Hosszanti: gaz es fek ---
  // Levegoben nincs mibe kapaszkodni, a lendulet valtozatlan marad.
  let forward = motion.forward;
  if (ctx.grounded) {
    // A serules a CSUCSSEBESSEGET is levagja, nem csak a gyorsulast.
    //
    // E nelkul a kerek-serules majdnem hatastalan volt: meresben egy
    // tort kerek 0.03 km/h veszteseget okozott, mert a modell ugyanazt
    // a celsebesseget erte el, csak kicsit lassabban. Egy raketatalalat
    // igy nem jelentett volna semmit -- pedig a kerek kilovese a jatek
    // egyik alapmechanikaja.
    const target = targetForwardSpeed(input) * lerp(0.45, 1, grip);
    const rate = longitudinalRate(forward, target, input) * lerp(0.25, 1, grip);
    forward = approach(forward, target, rate * dt);
  }

  // --- 2. Oldalirányu: tapadas ---
  // Ez az egyetlen hely, ahol a "tapadas" letezik a modellben.
  let lateral = motion.lateral;
  if (ctx.grounded) {
    const limit = input.handbrake ? ARCADE.driftLateralGrip : ARCADE.lateralGrip;
    lateral = approach(lateral, 0, limit * grip * dt);
  }

  // --- 3. Fordulas: kormany ---
  const authority = ctx.grounded ? grip : ARCADE.airSteerAuthority;
  // Tolatasnal megfordul a kormany erteme: a jatekos azt varja, hogy a
  // kocsi arra menjen HATRAFELE, amerre a gombot nyomja.
  const direction = forward < 0 ? -1 : 1;
  const drift = input.handbrake ? ARCADE.driftYawBoost : 1;
  // A negativ elojel a -Z = elore konvenciobol jon: a +Y koruli pozitiv
  // forgas BALRA viszi az orrot, tehat a "jobbra" input negativ yaw.
  const targetYaw =
    -input.steer *
    ARCADE.maxYawRate *
    turnFactor(forward) *
    direction *
    drift *
    authority;

  const yawRate = approach(motion.yawRate, targetYaw, ARCADE.yawAccel * dt);

  return { forward, lateral, yawRate };
}
