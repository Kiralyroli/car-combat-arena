import { WHEEL_LAYOUT } from "./config";
import { explosionFalloff, EXPLOSION_RADIUS } from "./rocket";
import { HEALTHY_WHEEL, type WheelDamage } from "./types";

/**
 * Kerek-serules szabalyok (terv 4. lepcso 6. pont).
 *
 * A per-kerek serules eddig KLIENS-oldali volt (1-4 gombok), es csak
 * latvanykent ment at a halozaton -- vagyis mindenki maga dontotte el,
 * letort-e a kereke. A terv 15.4 szerint viszont MINDEN kovetkezmeny a
 * szerverre tartozik, ugyanugy, ahogy a body HP.
 *
 * Ez a modul a szabalyokat tartalmazza, a shared csomagban:
 *  - a szerver ebbol szamol sebzest,
 *  - a kliens ebbol vezeti le a fizikai hatast (tapadas, sugar),
 *  - a teszt ugyanezt hivja, tehat nem egy masolt szabaly ellen mer.
 */

/** Egy kerek maximalis eletereje. */
export const WHEEL_MAX_HP = 100;

/**
 * Ennyi sebzest kap kozvetlenul a robbanas kozeppontjaban levő kerek.
 *
 * Erosen tavolsagfuggo (lasd explosionFalloff): a kozeli robbanas
 * leviszi a kereket, a hatosugar szelen mar alig karositja. Igy a
 * pontos talalat jutalmazott, de egy tavoli robbanas nem szereli le
 * veletlenszeruen az auto felet.
 */
export const WHEEL_EXPLOSION_DAMAGE = 70;

/**
 * A kerek vilagbeli kozeppontja.
 *
 * A felfuggesztes aktualis osszenyomodasat NEM vesszuk figyelembe: azt
 * a szerver nem szimulalja, es a kulonbseg (nehany cm) elenyeszik a
 * robbanas 7 m-es hatosugarahoz kepest. A kerek-pozicio azert kell
 * egyaltalan, mert e nelkul a robbanas mind a negy kereket egyformán
 * sebezne -- az auto ala gurulo rakéta ugyanugy hatna, mint egy oldalt
 * robbano, pedig a jatekos mast lat.
 */
export function wheelWorldPosition(
  carPosition: readonly number[],
  carRotation: readonly number[],
  wheelIndex: number,
): [number, number, number] {
  const offset = WHEEL_LAYOUT[wheelIndex].position;
  const [qx, qy, qz, qw] = carRotation;
  const { x, y, z } = offset;

  // v' = v + 2 * q_vec x (q_vec x v + w * v)
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);

  return [
    carPosition[0] + x + qw * tx + (qy * tz - qz * ty),
    carPosition[1] + y + qw * ty + (qz * tx - qx * tz),
    carPosition[2] + z + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Mennyi sebzest kap egy kerek egy adott tavolsagu robbanastol. */
export function wheelExplosionDamage(distance: number): number {
  return Math.round(WHEEL_EXPLOSION_DAMAGE * explosionFalloff(distance, EXPLOSION_RADIUS));
}

/**
 * Uj kerek-allapot a kapott sebzes utan.
 *
 * A tapadas-szorzo AZ ELETEROBOL kovetkezik, nem kulon tarolt ertek:
 * igy nem tud a ketto elcsuszni egymastol. A tort kereknek nincs
 * tapadasa -- a felnin csuszik.
 */
export function damageWheel(current: WheelDamage, amount: number): WheelDamage {
  if (amount <= 0 || current.broken) return current;

  const hp = Math.max(0, current.hp - amount);
  if (hp <= 0) {
    return { hp: 0, broken: true, gripMultiplier: 0 };
  }
  return { hp, broken: false, gripMultiplier: hp / WHEEL_MAX_HP };
}

/** Negy ep kerek -- uj jatekosnak es ujraszuleteskor. */
export function healthyWheels(): WheelDamage[] {
  return WHEEL_LAYOUT.map(() => ({ ...HEALTHY_WHEEL }));
}

/**
 * A "tort" allapotok bitmaszkja a halozati atvitelhez.
 * 0. bit = FL, 1. = FR, 2. = RL, 3. = RR (lasd WHEEL_LAYOUT sorrend).
 */
export function brokenMaskOf(wheels: readonly WheelDamage[]): number {
  let mask = 0;
  for (let i = 0; i < wheels.length; i++) {
    if (wheels[i].broken) mask |= 1 << i;
  }
  return mask;
}

/** A tapadas-szorzok a halozati atvitelhez. */
export function gripsOf(
  wheels: readonly WheelDamage[],
): [number, number, number, number] {
  return [
    wheels[0].gripMultiplier,
    wheels[1].gripMultiplier,
    wheels[2].gripMultiplier,
    wheels[3].gripMultiplier,
  ];
}

/**
 * A halozatrol kapott (szerver-hiteles) allapot visszafejtese
 * kerekenkenti WheelDamage-re -- ezt allitja be a kliens a sajat
 * fizikajaban es a tavoli autok latvanyaban.
 */
export function wheelsFromNetwork(
  grip: readonly number[],
  brokenMask: number,
): WheelDamage[] {
  return WHEEL_LAYOUT.map((_, i) => {
    const broken = (brokenMask & (1 << i)) !== 0;
    if (broken) return { hp: 0, broken: true, gripMultiplier: 0 };
    const gripMultiplier = grip[i] ?? 1;
    return {
      hp: Math.round(gripMultiplier * WHEEL_MAX_HP),
      broken: false,
      gripMultiplier,
    };
  });
}
