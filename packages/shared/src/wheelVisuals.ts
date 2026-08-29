import { WHEEL } from "./config";
import { lerp } from "./math";
import type { WheelDamage } from "./types";

/**
 * A kerek-serules VIZUALIS es FIZIKAI kovetkezmenyei -- egy helyen.
 *
 * Ezek a szabalyok harom helyen kellenek: a fizikaban (a tenyleges
 * kerek-sugar allitasa), a sajat autonk renderelesekor, es a HALOZATI
 * tavoli autoknal. Ha kulon-kulon lennenek leirva, eleg lenne az egyiket
 * modositani ahhoz, hogy a sajat es a tavoli auto MASHOGY nezzen ki
 * ugyanabban az allapotban -- ezert van mindharom fogyaszto szamara
 * ugyanez az egy forras.
 */

/** Tort kerek: csak a felni marad, jol lathatoan kisebb. */
const BROKEN_RADIUS_SCALE = 0.55;

/** Serult (de nem tort) kereknel a gumi lapul -- 0.85..1.0 kozott. */
const WORN_RADIUS_MIN_SCALE = 0.85;

export const WHEEL_TINT = {
  ok: 0x1f2429,
  hurt: 0x6b4a1f,
  broken: 0x8b2f2a,
} as const;

/**
 * A kerek tenyleges sugara az adott serules-allapotban.
 *
 * Az ALAPSUGAR autonkent mas (a negy kocsi kereke 0,72 es 0,92 m
 * kozott van), ezert parameter -- a serules csak SZORZOKENT hat ra. Ha
 * ez egyetlen kozos szam lenne, a nagy kerekű kocsi kereke a
 * karosszeriaba erne, a kicsie meg lebegne.
 */
export function wheelRadiusFor(
  damage: WheelDamage,
  alapSugar: number = WHEEL.radius,
): number {
  if (damage.broken) return alapSugar * BROKEN_RADIUS_SCALE;
  return alapSugar * lerp(WORN_RADIUS_MIN_SCALE, 1, damage.gripMultiplier);
}

/** A kerek szine az adott serules-allapotban. */
export function wheelTintFor(damage: WheelDamage): number {
  if (damage.broken) return WHEEL_TINT.broken;
  if (damage.gripMultiplier < 0.99) return WHEEL_TINT.hurt;
  return WHEEL_TINT.ok;
}
