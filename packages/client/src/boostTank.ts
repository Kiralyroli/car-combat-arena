import { BOOST_CAPACITY_MS, BOOST_REFILL_MS } from "@cca/shared";

/**
 * A boost-tartaly: mennyi boost van meg, es mi fogyasztja.
 *
 * MIERT A KLIENSNEL van a tartaly, ha a pickup a szerveré?
 *
 * A boost fogyasztasa a VEZETES resze: a jatekos lenyomja a Shiftet, es
 * azonnal gyorsulnia kell -- ugyanaz a nulla input lag, amiert a sajat
 * auto mozgasa is a kliense (terv 15.4). Ha a tartalyt a szerver
 * vezetne, minden boost-inditas egy teljes pinggel kesne.
 *
 * A VISSZATOLTES viszont kozos eroforrasbol jon (a palyan levo pickup),
 * arrol csak a szerver dönthet -- kulonben ketten is felvennek
 * ugyanazt. A szerver ezert nem a tartaly allapotat kuldi, hanem azt,
 * HANY visszatoltest kapott eddig a jatekos; a kliens a szam
 * novekedesebol tudja, hogy tolteni kell.
 *
 * Miert szamlalo, es nem esemeny: egy elveszett vagy megkettozott
 * esemeny eseten a tartaly tartosan elcsuszna. A szamlalo
 * ONKORREKCIOS -- barmelyik snapshot helyreallitja a helyes allapotot.
 */
export class BoostTank {
  /** Mennyi boost van meg (ms). Teli tartallyal indulunk. */
  private remainingMs = BOOST_CAPACITY_MS;

  /** Hany visszatoltest lattunk eddig a szervertol. */
  private seenGrants = 0;

  /** Elso snapshot elott meg nem tudjuk, hany granttal indulunk. */
  private initialized = false;

  get remaining(): number {
    return this.remainingMs;
  }

  /** A tartaly telitettsege 0..1 -- a kijelzeshez. */
  get fraction(): number {
    return this.remainingMs / BOOST_CAPACITY_MS;
  }

  get isEmpty(): boolean {
    return this.remainingMs <= 0;
  }

  /**
   * A szerver altal eddig kiosztott visszatoltesek szama. A novekmenyt
   * toltjuk vissza; ha tobb pickup gyult ossze egy snapshot ala, minden
   * darab szamit.
   */
  syncGrants(grants: number): void {
    if (!this.initialized) {
      // Csatlakozaskor a szerver szamlaloja nem feltetlenul nullarol
      // indul (ujracsatlakozas). Az elso ertek csak a KIINDULOPONT --
      // abbol meg nem jar visszatoltes.
      this.seenGrants = grants;
      this.initialized = true;
      return;
    }
    while (this.seenGrants < grants) {
      this.seenGrants++;
      this.refill();
    }
  }

  /** Egy pickup ertekenyi visszatoltes, a kapacitasra vagva. */
  refill(): void {
    this.remainingMs = Math.min(BOOST_CAPACITY_MS, this.remainingMs + BOOST_REFILL_MS);
  }

  /**
   * Egy frame fogyasztasa. Visszaadja, hogy a boost TENYLEGESEN hat-e:
   * ures tartallyal a Shift hatastalan.
   */
  consume(wantBoost: boolean, dtMs: number): boolean {
    if (!wantBoost || this.remainingMs <= 0) return false;
    this.remainingMs = Math.max(0, this.remainingMs - dtMs);
    return true;
  }

  /** Ujraszuletes: teli tartaly. */
  reset(): void {
    this.remainingMs = BOOST_CAPACITY_MS;
  }
}
