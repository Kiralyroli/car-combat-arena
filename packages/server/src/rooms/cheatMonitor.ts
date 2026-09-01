/**
 * Automatikus kidobas: LECSENGO pontszam, nem szamlalo.
 *
 * A NEHEZSEG, amit meg kell oldani: a szerver nem tud kulonbseget tenni
 * a csalo es a szakado kapcsolatu becsuletes jatekos kozott. Mindketto
 * olyan adatot kuld, amit a szerver eldob. Egy egyszeru szamlalo
 * ("harom hiba es repulsz") ezert elobb-utobb ARTATLANT dobna ki: eleg
 * egy rossz wifi, es a hibak eleg hosszu ido alatt osszegyulnek.
 *
 * A MEGOLDAS: a pontok masodpercenkent lecsengenek. Igy nem a hibak
 * SZAMA dont, hanem a SEBESSEGUK:
 *
 *  - alkalmi hiba (csomagvesztes, rovid kimaradas): a lecsenges
 *    elviszi, sosem gyulik fel -- barmeddig jatszhat,
 *  - folyamatos hazugsag: gyorsabban gyulik, mint ahogy csengene, es
 *    kiszamithato ido alatt eleri a kuszobot.
 *
 * A SULYOK a BIZONYITO EREJUKET tukrozik, nem a bosszantobb voltukat:
 * amit becsuletes kliens SOSEM tehet, az sokat er; amit rossz halozat
 * is eloallithat, az keveset.
 *
 * SZANDEKOSAN tiszta modul: az idot a hivo adja, nincs benne se socket,
 * se szoba -- headless tesztelheto.
 */

export type ViolationKind = "wrongWeapon" | "aimMismatch" | "resync";

/**
 * Melyik szabalyszeges hany pontot er.
 *
 * `wrongWeapon` -- raketa-keres gepfegyverrel. A becsuletes kliens ezt
 * SOSEM kuldi: a fegyver ellenorzese ott van a kattintas-kezelojeben
 * (main.ts fireAtCrosshair: `if (net.ownWeapon !== "cannon") return`).
 * Ez tehat nem gyanu, hanem bizonyitek modositott kliensre -- harom
 * ilyen eleg a kidobashoz.
 *
 * `aimMismatch` -- a loves iranya nem egyezik a bevallott celzassal.
 * Erős jel, de NEM bizonyitek: csomagvesztesnel a szerver lemaradhat
 * egy celzas-frissitesrol, es akkor egy becsuletes loves is elteronek
 * latszik. Ezert kell belole tobb, es gyorsan egymas utan.
 *
 * `resync` -- a mozgas-ellenorzes tiz egymas utani elutasitas utan
 * kenytelen atvenni a kliens allapotat. Ez lehet teleport-hack, de
 * lehet egyszeruen szakado kapcsolat is -- a legbizonytalanabb jel a
 * haromból. Aki viszont folyamatosan ebben az allapotban van, az ugysem
 * jatszik: a tobbiek kepernyojen amugy is ugral.
 */
export const VIOLATION_POINTS: Record<ViolationKind, number> = {
  wrongWeapon: 40,
  aimMismatch: 12,
  resync: 15,
};

/** Ennyi pontnal dobjuk ki a jatekost. */
export const KICK_THRESHOLD = 100;

/**
 * Ennyi pont cseng le masodpercenkent.
 *
 * EZ a szam donti el, mi szamit "folyamatosnak". Peldak:
 *
 *  - celzas-elteres MINDEN raketanal (1200 ms hutes = 0.83/s) 10 pont/s
 *    -- 5 pont/s lecsengessel a marad 5 pont/s, tehat kb. 20 masodperc
 *    alatt kidobas,
 *  - celzas-elteres haromszaz masodpercenkent egyszer: 0.04 pont/s --
 *    sosem gyulik fel.
 */
export const DECAY_PER_SEC = 5;

export class CheatMonitor {
  private points = 0;
  private lastAt: number;
  /** Melyik szabalyszegesbol mennyi volt -- a naplo indoklasahoz. */
  private readonly counts: Record<ViolationKind, number> = {
    wrongWeapon: 0,
    aimMismatch: 0,
    resync: 0,
  };

  constructor(now: number) {
    this.lastAt = now;
  }

  /**
   * Egy szabalyszeges konyvelese.
   *
   * @returns true, ha EZZEL lepte at a kuszobot (a hivo dolga a kidobas)
   */
  note(kind: ViolationKind, now: number): boolean {
    this.decay(now);
    this.points += VIOLATION_POINTS[kind];
    this.counts[kind]++;
    if (this.points < KICK_THRESHOLD) return false;

    // CSAK EGYSZER jelzunk. A kapcsolat bontasa nem pillanatszeru: a
    // mar uton levo uzenetek meg befuthatnak, es a pontszam kozben a
    // kuszob folott marad -- e nelkul minden egyes befuto uzenet ujabb
    // kidobas-kerest es naplosort szulne ugyanarrol a jatekosrol.
    if (this.kicked) return false;
    this.kicked = true;
    return true;
  }

  private kicked = false;

  /** Az aktualis pontszam (lecsengetve) -- teszthez es naplohoz. */
  score(now: number): number {
    this.decay(now);
    return this.points;
  }

  /** Rovid indoklas a naplaba: mibol mennyi volt. */
  summary(): string {
    return (Object.keys(this.counts) as ViolationKind[])
      .filter((k) => this.counts[k] > 0)
      .map((k) => `${k}=${this.counts[k]}`)
      .join(" ");
  }

  private decay(now: number): void {
    const elapsed = Math.max(0, (now - this.lastAt) / 1000);
    this.lastAt = now;
    this.points = Math.max(0, this.points - elapsed * DECAY_PER_SEC);
  }
}
