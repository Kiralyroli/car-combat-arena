import type { ClientMessage, ServerMessage, Transport } from "@cca/shared";

/**
 * Mesterseges halozati kesleltetes a fejlesztoi teszteleshez
 * (terv 16., 3. lepcso 6. pont).
 *
 * Ez egy DEKORATOR: egy masik Transportot burkol be, es csak
 * keslelteti az uzeneteket. Pontosan ezert letezik a Transport
 * absztrakcio -- se a jatiklogika, se a WebSocket-kod nem tud rola.
 *
 * Miert kell? Mert a fejlesztes ugyanazon a gepen, gyakorlatilag 0 ms
 * kesleltetessel zajlik, es az utkozes-joslat osszes idozitese (tartas,
 * elteres-korlat, visszateres) EPPEN a kesleltetesehez van meretezve.
 * Ha ezeket csak lokalisan hangoljuk, elesben derulne ki, hogy rosszak.
 */
export class LatencyTransport implements Transport {
  private readonly inner: Transport;
  /** Egyiranyu kesleltetes ms-ban (a teljes oda-vissza ut fele). */
  private readonly oneWayMs: number;
  /** Veletlen ingadozas (+/- ms) -- a valos halozat sem egyenletes. */
  private readonly jitterMs: number;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private closed = false;

  constructor(inner: Transport, roundTripMs: number, jitterMs = 0) {
    this.inner = inner;
    this.oneWayMs = Math.max(0, roundTripMs) / 2;
    this.jitterMs = Math.max(0, jitterMs);
  }

  private delay(): number {
    if (this.jitterMs === 0) return this.oneWayMs;
    return Math.max(0, this.oneWayMs + (Math.random() * 2 - 1) * this.jitterMs);
  }

  private schedule(fn: () => void): void {
    if (this.closed) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.closed) fn();
    }, this.delay());
    this.timers.add(timer);
  }

  get connected(): boolean {
    return this.inner.connected;
  }

  send(message: ClientMessage): void {
    this.schedule(() => this.inner.send(message));
  }

  onMessage(handler: (message: ServerMessage) => void): void {
    this.inner.onMessage((message) => this.schedule(() => handler(message)));
  }

  onClose(handler: () => void): void {
    // A bontast NEM keslejtetjuk: az nem halozati uzenet, hanem a
    // kapcsolat tenyleges megszunese.
    this.inner.onClose(handler);
  }

  close(): void {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.inner.close();
  }
}
