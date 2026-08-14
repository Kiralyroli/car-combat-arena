import {
  PING_INTERVAL_MS,
  PROTOCOL_VERSION,
  SNAPSHOT_HZ,
  type ClientState,
  type ServerMessage,
  type Transport,
} from "@cca/shared";
import { RemotePlayers } from "./remotePlayers";
import { WsTransport } from "./wsTransport";

/**
 * A kliens halozati rtege: csatlakozas, szoba, sajat allapot kuldese,
 * tavoli jatekosok pufferelese.
 *
 * A hibrid authority modell (terv 15.4) szerint a sajat autonkat MI
 * szimulaljuk teljes fizikaval -- ez a rteg csak KIKULDI az igy
 * kiszamolt allapotot, es nem varja meg a szerver valaszat. Ezert
 * erzodik a vezetes nulla input laggel.
 */

const SEND_INTERVAL_MS = 1000 / SNAPSHOT_HZ;

export interface NetworkEvents {
  onJoined?: (
    playerId: string,
    roomCode: string,
    spawn: [number, number, number],
  ) => void;
  onPlayerJoined?: (playerId: string) => void;
  onPlayerLeft?: (playerId: string) => void;
  onError?: (code: string, message: string) => void;
  onClose?: () => void;
}

export class NetworkClient {
  readonly remotes = new RemotePlayers();

  private transport: Transport | null = null;
  private events: NetworkEvents = {};
  private seq = 0;
  private lastSendAt = 0;
  private lastPingAt = 0;
  /** Simitott oda-vissza ut (RTT) ms-ban; null, amig nincs meres. */
  private rttMs: number | null = null;
  /** Hany snapshot erkezett -- a "el-e meg a kapcsolat" kijelzeshez. */
  private snapshotCount = 0;

  playerId: string | null = null;
  roomCode: string | null = null;

  get connected(): boolean {
    return this.transport?.connected ?? false;
  }

  /**
   * Oda-vissza kesleltetes (RTT) ms-ban, vagy null, ha meg nincs meres.
   *
   * A jatekban erzekelheto kesleltetes ennek KB. A FELE (egy irany),
   * plusz a szerver snapshot-utemenek fele es az interpolacios puffer
   * (100 ms) -- lasd remotePlayers.ts.
   */
  get ping(): number | null {
    return this.rttMs;
  }

  get receivedSnapshots(): number {
    return this.snapshotCount;
  }

  on(events: NetworkEvents): void {
    this.events = { ...this.events, ...events };
  }

  /**
   * Csatlakozas es szobaba lepes. `roomCode` nelkul a szerver uj szobat
   * nyit, es a kodot a `joined` uzenetben kuldi vissza.
   */
  async connect(url: string, roomCode?: string): Promise<void> {
    const transport = await WsTransport.connect(url);
    this.transport = transport;

    transport.onMessage((message) => this.handleMessage(message));
    transport.onClose(() => {
      this.remotes.clear();
      // A regi kes-ertek megtevesztő lenne bontott kapcsolatnal.
      this.rttMs = null;
      this.events.onClose?.();
    });

    transport.send({ type: "join", protocol: PROTOCOL_VERSION, roomCode });
  }

  disconnect(): void {
    this.transport?.close();
    this.transport = null;
  }

  /**
   * A sajat, mar kiszamolt allapot kuldese -- ratakorlatozva, hogy ne
   * minden renderelt frame-ben menjen ki (a szerver ugyis 20 Hz-en
   * dolgozza fel).
   */
  sendState(state: ClientState, now: number): void {
    if (!this.transport?.connected || !this.playerId) return;

    // A kes-meres ritkabb, mint az allapotkuldes, ezert kulon utemben.
    if (now - this.lastPingAt >= PING_INTERVAL_MS) {
      this.lastPingAt = now;
      this.transport.send({ type: "ping", t: now });
    }

    if (now - this.lastSendAt < SEND_INTERVAL_MS) return;
    this.lastSendAt = now;
    this.transport.send({ type: "state", seq: ++this.seq, state });
  }

  private handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case "joined":
        this.playerId = message.playerId;
        this.roomCode = message.roomCode;
        for (const id of message.players) this.events.onPlayerJoined?.(id);
        this.events.onJoined?.(message.playerId, message.roomCode, message.spawn);
        return;

      case "snapshot": {
        // A sajat autonkat kiszurjuk: azt lokalisan szimulaljuk, a
        // szerver visszakuldott valtozata csak visszarantana.
        this.snapshotCount++;
        const others = message.players.filter((p) => p.id !== this.playerId);
        this.remotes.ingest(others, performance.now());
        return;
      }

      case "pong": {
        // A `t` a MI orank szerinti kuldesi ido, valtozatlanul vissza --
        // a kulonbseg tehat tiszta oda-vissza ut, ora-szinkron nelkul.
        const rtt = performance.now() - message.t;
        // Exponencialis simitas: egyetlen kiugro csomag ne ugraltassa a
        // kijelzest, de a tartos valtozast azert kovesse.
        this.rttMs = this.rttMs === null ? rtt : this.rttMs * 0.7 + rtt * 0.3;
        return;
      }

      case "playerJoined":
        this.events.onPlayerJoined?.(message.playerId);
        return;

      case "playerLeft":
        this.remotes.remove(message.playerId);
        this.events.onPlayerLeft?.(message.playerId);
        return;

      case "error":
        this.events.onError?.(message.code, message.message);
        return;
    }
  }
}
