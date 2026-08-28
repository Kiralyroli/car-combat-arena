/**
 * KEPESSEGEK: a fegyver melletti masodik valasztas.
 *
 * A jatekos egy fegyvert ES egy kepesseget visz be egy eletbe. A
 * kepesseg a Q-val sul el, es visszatoltodik.
 *
 * A SZERVER DONT, nem a kliens. Mindket mai kepesseg a sebzes
 * kimenetelet valtoztatja (az egyik eletet ad, a masik elnyeli a
 * talalatot), azt pedig a szerver birtokolja. A kliens csak KERI az
 * aktivalast; hogy szabad-e, az itteni szabalyokbol dol el.
 *
 * MIERT VISSZATOLTES, es nem "eletenkent egy toltet": egy elet percekig
 * is tarthat. Egy elhasznalt egyszeri kepesseg utan a jatekos a
 * maradek idoben szegenyebb jatekot jatszana.
 *
 * MIERT ITT, a kozos csomagban: ez tiszta szabaly, halozat es motor
 * nelkul -- tehat Node alatt merheto (lasd check:abilities), es a
 * kliens ugyanabbol a szambol rajzolja a visszatoltest, amibol a
 * szerver szamol. Ha a ketto kulon elne, a kijelzo csendben hazudna.
 */

export type AbilityId = "heal" | "shield";

export const ABILITY_IDS: readonly AbilityId[] = ["heal", "shield"] as const;

export interface AbilityDef {
  /** Magyar nev a valasztohoz es a HUD-hoz. */
  nev: string;
  /** Egy soros magyarazat a valasztoban. */
  leiras: string;
  /** Mennyi ido mulva sulhet el ujra (ms). */
  cooldownMs: number;
  /**
   * Meddig tart a hatas (ms). Nulla = azonnali, egyszeri hatas.
   */
  durationMs: number;
  /** Mennyi eletet ad (csak a gyogyitasnal). */
  heal: number;
}

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  heal: {
    nev: "gyógyítás",
    leiras: "3 mp alatt visszatölt 40 életet.",
    /**
     * HOSSZU visszatoltes, SZANDEKOSAN.
     *
     * A gyogyitas a legerosebb fajta kepesseg: egy elvesztett parharcot
     * fordit meg. Rovid visszatoltessel ket gyogyito jatekos harca
     * eldonthetetlenne valna -- mindketto gyorsabban toltodne, mint
     * ahogy sebzik egymast. Huszonot masodperc alatt egy parharc
     * lefut, tehat eletenkent inkabb ketto-harom hasznalat.
     */
    cooldownMs: 25000,
    /**
     * FOKOZATOS gyogyitas, nem egy pillanat alatt.
     *
     * Azonnali gyogyitassal a kepesseg egy "mentogomb" lenne: a
     * halalos loves elott elsutve semmissé tenne minden addigi
     * sebzest. Harom masodperc alatt viszont a tamado ki tudja lonni a
     * gyogyulot -- vagyis a kepesseg IDOT kér, nem csak egy gombot.
     *
     * A jatekosnak igy latnia is kell, mennyi van hatra (lasd
     * abilityActiveLeft es a HUD).
     */
    durationMs: 3000,
    /**
     * RESZLEGES gyogyitas: a maximum 40%-a.
     *
     * Teljes gyogyitassal a kepesseg egy masodik eletet adna, ami
     * tobb, mint amit egy loadout-valasztas erhet. Ennyi eleg ahhoz,
     * hogy egy rosszul indult parharcot megforditson, de nem torli el
     * az addigi sebzest.
     */
    heal: 40,
  },
  shield: {
    nev: "pajzs",
    leiras: "3 másodpercig elnyeli a sebzést.",
    /**
     * Rovidebb visszatoltes, mint a gyogyitase.
     *
     * A pajzs nem ad vissza semmit, csak IDOT nyer -- rosszul idozitve
     * el is pazarolhato. Ezert gyakrabban hasznalhato.
     */
    cooldownMs: 18000,
    /**
     * Harom masodperc: eleg egy raketa becsapodasat vagy egy
     * gepfegyver-sorozatot kivedeni, es eleg rovid ahhoz, hogy ne
     * lehessen mogotte harcolni. Az idozites legyen a nehez resz.
     */
    durationMs: 3000,
    heal: 0,
  },
};

/** Ervenyes kepesseg-azonosito, vagy az alapertelmezett. */
export const DEFAULT_ABILITY: AbilityId = "shield";

export function toAbilityId(ertek: unknown): AbilityId {
  return ABILITY_IDS.includes(ertek as AbilityId)
    ? (ertek as AbilityId)
    : DEFAULT_ABILITY;
}

/**
 * A kepesseg allapota egy jatekosnal, a SZERVER oraja szerint.
 *
 * Ket idobelyeg, nem "hatralevo ido": a szerver es a kliens orai kulon
 * jarnak, es egy visszaszamlalot minden lepesben csokkenteni kellene.
 * Az idobelyegbol barmikor kiszamolhato a hatralevo ido.
 */
export interface AbilityState {
  /** Eddig tart a hatas (0 = nem aktiv). */
  activeUntil: number;
  /** Ettol kezdve sulhet el ujra. */
  readyAt: number;
}

export function idleAbility(): AbilityState {
  return { activeUntil: 0, readyAt: 0 };
}

/** Fut-e eppen a hatas. */
export function abilityActive(allapot: AbilityState, now: number): boolean {
  return allapot.activeUntil > now;
}

/** Elsutheto-e eppen. */
export function abilityReady(allapot: AbilityState, now: number): boolean {
  return now >= allapot.readyAt;
}

/**
 * Mennyi van meg a visszatoltesbol (ms). Nulla = kesz.
 *
 * A KIJELZES ebbol dolgozik, es a szerver is ezt kuldi -- igy a jatekos
 * pontosan azt latja, ami szerint a szerver dont.
 */
export function abilityCooldownLeft(
  allapot: AbilityState,
  now: number,
): number {
  return Math.max(0, allapot.readyAt - now);
}

/**
 * Mennyi van meg a HATASBOL (ms). Nulla = nem fut.
 *
 * A jatekosnak latnia kell, meddig ved meg a pajzs, es meddig gyogyul
 * meg -- egy puszta "aktiv" jelzes csak annyit mondana, hogy tortenik
 * valami, azt nem, hogy meddig.
 */
export function abilityActiveLeft(
  allapot: AbilityState,
  now: number,
): number {
  return Math.max(0, allapot.activeUntil - now);
}

/**
 * Mennyi eletet ad a gyogyitas EGY ezredmasodperc alatt.
 *
 * A teljes mennyiseget az idotartamra osztjuk, tehat a ketto nem tud
 * elcsuszni egymastol: ha barmelyiket allitjuk, a masik koveti.
 */
export function healPerMs(): number {
  return ABILITIES.heal.durationMs > 0
    ? ABILITIES.heal.heal / ABILITIES.heal.durationMs
    : ABILITIES.heal.heal;
}

/**
 * Aktivalas: az UJ allapot, vagy null, ha most nem szabad.
 *
 * Tiszta fuggveny: nem modositja a bemenetet. A szerver ebbol dol el,
 * hogy a kerest elfogadja-e -- es ugyanez a szabaly merheto Node alatt.
 */
export function activateAbility(
  id: AbilityId,
  allapot: AbilityState,
  now: number,
): AbilityState | null {
  if (!abilityReady(allapot, now)) return null;
  const def = ABILITIES[id];
  return {
    activeUntil: def.durationMs > 0 ? now + def.durationMs : 0,
    readyAt: now + def.cooldownMs,
  };
}
