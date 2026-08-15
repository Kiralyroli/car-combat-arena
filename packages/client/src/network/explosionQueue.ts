import { INTERP_DELAY_MS } from "./remotePlayers";

/**
 * Robbanasok varosora -- a KESLELTETETT idovonalra igazitva.
 *
 * A szerver akkor kuld `explosion` uzenetet, amikor a lovedek az O
 * idejeben becsapodott. A kliens viszont minden halozati entitast --
 * autokat es rakétakat egyarant -- INTERP_DELAY_MS-szel korabbrol
 * rajzol. Ha a villanas erkezeskor azonnal megjelenne, MEGELOZNE a
 * lovedeket: a jatekos eloszor a robbanast latna, es csak utana erne
 * oda a rakéta -- 55 m/s-nal 5.5 m-rel odebb.
 *
 * A LOKES is innen indul, nem az uzenet beerkezesekor: kulonben a
 * jatekost ellokne, mielott barmit latna belole. Ok es okozat egyben.
 *
 * SZANDEKOSAN kulon, apro osztaly: igy a kesleltetes determinisztikusan
 * tesztelheto. Bongeszoben ugyanez nem merheto megbizhatoan -- ott a
 * megjelenest a render-ciklus utemezi, ami headlessben ~9 fps, azaz
 * ~110 ms felbontasu; eppen azt a 100 ms-ot mosna el, amit ellenorizni
 * akarunk. (Egy ilyen e2e ellenorzes valoban at is ment a HIBAS,
 * kesleltetes nelkuli valtozaton.)
 */
export class ExplosionQueue {
  private readonly pending: {
    position: [number, number, number];
    dueAt: number;
  }[] = [];

  /** Beerkezett robbanas felvetele. `now` a beerkezes lokalis ideje. */
  push(position: [number, number, number], now: number): void {
    this.pending.push({ position, dueAt: now + INTERP_DELAY_MS });
  }

  /**
   * A most esedekesse valt robbanasok, es egyben eltavolitasuk.
   * A render-ciklusbol hivando.
   */
  due(now: number): [number, number, number][] {
    const ready: [number, number, number][] = [];
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i].dueAt > now) continue;
      ready.push(this.pending.splice(i, 1)[0].position);
    }
    return ready;
  }

  get waiting(): number {
    return this.pending.length;
  }

  clear(): void {
    this.pending.length = 0;
  }
}
