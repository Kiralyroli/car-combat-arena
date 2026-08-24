import { DelayedQueue } from "./delayedQueue";

/**
 * Robbanasok varosora.
 *
 * A szerver akkor kuld `explosion` uzenetet, amikor a lovedek az O
 * idejeben becsapodott. A kliens viszont minden halozati entitast --
 * autokat es rakétakat egyarant -- kesleltetve rajzol, ezert a
 * villanasnak is varnia kell: kulonben MEGELOZNE a lovedeket, azaz a
 * jatekos eloszor a robbanast latna, es csak utana erne oda a rakéta --
 * 55 m/s-nal 5.5 m-rel odebb.
 *
 * A LOKES is innen indul, nem az uzenet beerkezesekor: kulonben a
 * jatekost ellokne, mielott barmit latna belole. Ok es okozat egyben.
 *
 * A kesleltetes maga a kozos DelayedQueue-ban van -- ugyanaz kezeli a
 * gepfegyver nyomjelzoit is.
 */
export class ExplosionQueue {
  private readonly queue = new DelayedQueue<[number, number, number]>();

  /** Beerkezett robbanas felvetele. `now` a beerkezes lokalis ideje. */
  push(position: [number, number, number], now: number): void {
    this.queue.push(position, now);
  }

  /** A most esedekesse valt robbanasok, es egyben eltavolitasuk. */
  due(now: number): [number, number, number][] {
    return this.queue.due(now);
  }

  get waiting(): number {
    return this.queue.waiting;
  }

  clear(): void {
    this.queue.clear();
  }
}
