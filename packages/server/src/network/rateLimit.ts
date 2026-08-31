/**
 * Uzenet-ratakorlat kapcsolatonkent (token bucket).
 *
 * MIERT KELL: a hibrid authority modellben a szerver minden
 * kovetkezmenyt maga szamol, de a BEERKEZO uzenetek koltseget semmi nem
 * fogta. A `fire` uzenetet ugyan a raketa hutese eldobja, a
 * `JSON.parse`-ot viszont mar lefuttattuk -- egy szoba nyolc kapcsolata
 * igy egyetlen gepbol tetszolegesen terhelheto volt.
 *
 * SZANDEKOSAN kulon, tiszta egyseg: nincs benne se socket, se szoba,
 * tehat headless tesztelheto valodi idozites nelkul (a `now`-t a hivo
 * adja) -- lasd scripts/check-cheat.ts.
 */

/**
 * Hany uzenetet kuldhet egy kapcsolat masodpercenkent, tartosan.
 *
 * A becsuletes kliens kb. 22-t kuld: 20 Hz allapot (SNAPSHOT_HZ),
 * masodpercenkent egy ping, es alkalmankent egy loves vagy valasztas.
 * A hatart ennek a haromszorosara tesszuk -- eleg laza ahhoz, hogy egy
 * megugro kliens-frame-rata vagy egy osszetorlodott csomag-sorozat ne
 * akadjon fenn rajta, es eleg szoros ahhoz, hogy egy uzenet-aradat ne
 * kosse le a szervert.
 */
export const MESSAGES_PER_SECOND = 60;

/**
 * Mennyi tokent gyujthet ossze egy csendesebb kliens (burst).
 *
 * Ez adja a "megbocsatas" merteket: egy masodpercnyi csend utan egy
 * torlodott csomag-sorozat egyben atmehet, anelkul hogy barmit
 * elveszitenenk belole.
 */
export const MESSAGE_BURST = 90;

export class RateLimiter {
  private tokens = MESSAGE_BURST;
  private lastRefillAt: number;
  /** Hany uzenetet dobtunk el eddig -- a hivo ebbol dont a bontasrol. */
  dropped = 0;

  constructor(now: number) {
    this.lastRefillAt = now;
  }

  /**
   * Belefer-e meg egy uzenet?
   *
   * A tokenek FOLYAMATOSAN toltodnek vissza, nem masodperces
   * ablakokban: igy a hatar kozeleben jatszo, de becsuletes kliens sem
   * veszit el egy egesz ablaknyi uzenetet egyetlen megugras miatt.
   */
  take(now: number): boolean {
    const elapsed = Math.max(0, (now - this.lastRefillAt) / 1000);
    this.lastRefillAt = now;
    this.tokens = Math.min(
      MESSAGE_BURST,
      this.tokens + elapsed * MESSAGES_PER_SECOND,
    );

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    this.dropped++;
    return false;
  }
}
