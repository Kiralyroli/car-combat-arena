import { INTERP_DELAY_MS } from "@cca/shared";

/**
 * Halozati ESEMENYEK varosora -- a kesleltetett idovonalra igazitva.
 *
 * A kliens minden halozati entitast (autok, raketak) INTERP_DELAY_MS-szel
 * korabbrol rajzol, hogy a mozgas sima legyen. Az esemenyeknek --
 * robbanas, gepfegyver-nyomjelzo -- UGYANEBBE az idovonalba kell
 * esniuk, kulonben megelozik az okukat: eloszor latszana a villanas, es
 * csak utana erne oda a lovedek.
 *
 * SZANDEKOSAN kulon, apro osztaly: igy a kesleltetes determinisztikusan
 * tesztelheto. Bongeszoben ugyanez nem merheto megbizhatoan -- ott a
 * megjelenest a render-ciklus utemezi, ami headlessben ~9 fps, azaz
 * ~110 ms felbontasu; eppen azt a 100 ms-ot mosna el, amit ellenorizni
 * akarunk. (Egy ilyen e2e ellenorzes valoban at is ment a HIBAS,
 * kesleltetes nelkuli valtozaton.)
 */
export class DelayedQueue<T> {
  private readonly pending: { item: T; dueAt: number }[] = [];

  /** Beerkezett esemeny felvetele. `now` a beerkezes LOKALIS ideje. */
  push(item: T, now: number): void {
    this.pending.push({ item, dueAt: now + INTERP_DELAY_MS });
  }

  /**
   * A most esedekesse valt esemenyek, es egyben eltavolitasuk.
   * A render-ciklusbol hivando.
   */
  due(now: number): T[] {
    const ready: T[] = [];
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i].dueAt > now) continue;
      ready.push(this.pending.splice(i, 1)[0].item);
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
