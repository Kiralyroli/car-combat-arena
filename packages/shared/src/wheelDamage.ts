import { CAR_GEOMETRY } from "./carGeometry";
import { DEFAULT_CAR, type CarId } from "./carModels";
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
  /**
   * Melyik auto: a kerekek helye modellenkent mas.
   *
   * Egy kozos elrendezessel a robbanas a rossz helyen keresne a
   * kereket -- a jatekos azt latna, hogy a talalat mellette csapodott
   * be, megis letort a gumija (vagy forditva).
   */
  car: CarId = DEFAULT_CAR,
): [number, number, number] {
  const offset = CAR_GEOMETRY[car].wheels[wheelIndex];
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

/**
 * Kerek-regeneralodas HARCON KIVUL.
 *
 * A PROBLEMA, amit megold: a kerek-serules korabban visszafordithatatlan
 * volt egy eleten belul -- a kerekek CSAK ujraszuleteskor gyogyultak.
 * Merve: ket letort kerekkel a vegsebesseg 108-rol 78 km/h-ra esik, a
 * gyorsulas 62%-ra. Egy igy megsérult jatekos se menekulni, se uldozni
 * nem tud, es semmi utja nincs vissza -- a legjobb lepese az, hogy
 * SZANDEKOSAN meghal (friss auto, ep kerekek, vedelem), egyetlen elet
 * araban. A jatek igy a feladast jutalmazta.
 *
 * A gyogyulasnak ARA van, ket ertelemben is:
 *  - csak sebzes NELKUL indul (WHEEL_REGEN_DELAY_MS), tehat ki kell
 *    szallni a harcbol -- kozben nem lősz es nem szerzel elonyt,
 *  - a letort kerek nem all vissza azonnal hasznalhato allapotba:
 *    WHEEL_REMOUNT_HP-ig NULLA a tapadasa. A rakéta hatasa igy
 *    erezheto marad, csak nem vegleges.
 */

/**
 * Sebzes utan ennyi ideig NEM regeneralodik (ms).
 *
 * Eleg hosszu ahhoz, hogy harc kozben ne induljon el: hat masodperc
 * serules nelkul mar valodi kiszallas, nem egy szerencses masodperc.
 */
export const WHEEL_REGEN_DELAY_MS = 6000;

/** Ennyi kerek-eletero ter vissza masodpercenkent. */
export const WHEEL_REGEN_PER_SECOND = 10;

/**
 * A letort kerek ennyi eletero folott all vissza.
 *
 * Addig a tapadasa NULLA marad -- vagyis a leszakadt kerek nem attol
 * mukodik ujra, hogy elkezdett gyogyulni. Nullarol ez ~4 masodperc, a
 * teljes helyreallas ~10.
 */
export const WHEEL_REMOUNT_HP = 40;

/**
 * Egy kerek regeneralodasa `dtMs` ido alatt.
 *
 * SZANDEKOSAN tiszta fuggveny: a gyogyulas uteme a jatek egyensulyanak
 * resze, tehat szerver es halozat nelkul is merhetonek kell lennie
 * (lasd scripts/check-wheels.ts).
 */
export function regenerateWheel(
  current: WheelDamage,
  dtMs: number,
): WheelDamage {
  if (current.hp >= WHEEL_MAX_HP && !current.broken) return current;

  const hp = Math.min(
    WHEEL_MAX_HP,
    current.hp + (WHEEL_REGEN_PER_SECOND * dtMs) / 1000,
  );
  const broken = current.broken && hp < WHEEL_REMOUNT_HP;

  return {
    hp,
    broken,
    // A meg vissza nem allt kerek nem tart: a gyogyulas onmagaban
    // nem adja vissza a tapadast.
    gripMultiplier: broken ? 0 : hp / WHEEL_MAX_HP,
  };
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
