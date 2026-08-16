import {
  PING_INTERVAL_MS,
  PROTOCOL_VERSION,
  SNAPSHOT_HZ,
  wheelsFromNetwork,
  type ClientState,
  type WheelDamage,
  type MatchSnapshot,
  type RoomListing,
  type ServerMessage,
  type Transport,
} from "@cca/shared";
import { LatencyTransport } from "./latencyTransport";
import { RemotePlayers } from "./remotePlayers";
import { RemoteRockets } from "./remoteRockets";
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
  onRespawn?: (position: [number, number, number]) => void;
  onExplosion?: (position: [number, number, number], ownerId: string) => void;
  onRoomList?: (rooms: RoomListing[]) => void;
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
  /** A sajat karosszeria-HP-nk a szerver szerint; null, amig nincs snapshot. */
  hp: number | null = null;
  /**
   * A sajat kerekeink serulese a szerver szerint; null, amig nincs
   * snapshot. A hivo ebbol allitja be a jarmu FIZIKAJAT -- a kerek-
   * serules nem csak latvany (tapadas es kerek-sugar is fugg tole).
   */
  ownWheels: WheelDamage[] | null = null;
  /**
   * Hany boost-visszatoltest osztott ki nekunk eddig a szerver.
   * A tartaly ebbol tolt (lasd BoostTank.syncGrants).
   */
  boostGrants = 0;
  /**
   * A repulo rakétak pufferelve -- UGYANAZON az idovonalon, mint a
   * tavoli autok (lasd remoteRockets.ts).
   */
  readonly rockets = new RemoteRockets();

  /**
   * Eppen felveheto-e az egyes pickupok (PICKUP_POINTS indexeles).
   * A poziciot a kliens a config-bol ismeri, csak az allapot jon at.
   */
  pickupsAvailable: boolean[] = [];

  /**
   * A meccs allapota a szerver szerint (Last Car Standing).
   * Csatlakozas elott varakozonak tekintjuk.
   */
  match: MatchSnapshot = {
    phase: "waiting",
    survivors: 0,
    winnerId: null,
    restartInMs: 0,
  };

  /** Hany eletunk van meg; null, amig nincs snapshot. */
  lives: number | null = null;

  /**
   * A SAJAT nevunk a szerver szerint.
   *
   * A snapshotbol vesszuk at, nem a beirt szoveget hasznaljuk: a
   * szerver tisztitja a nevet (hossz, vezerlokarakterek), tehat amit
   * kirajzolunk, az legyen ugyanaz, amit a tobbiek latnak.
   */
  ownName = "";

  /**
   * Rakéta-kiloves kerese a megcelzott vilagbeli pontra.
   * A kiindulopontot, a huteset es a talalatot a szerver donti el.
   */
  fire(target: [number, number, number]): void {
    this.transport?.send({ type: "fire", target });
  }

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
   *
   * `lagMs` > 0 eseten mesterseges kesleltetes kerul a Transport ele --
   * fejlesztoi teszteleshez (terv 3. lepcso 6. pont).
   */
  /**
   * Csak a KAPCSOLAT megnyitasa -- belepes nelkul.
   *
   * A lobby igy meg tudja kerdezni a nyitott szobakat, MIELOTT a
   * jatekos valasztana. Belepni utana a  hivassal lehet.
   */
  async open(url: string, lagMs = 0, jitterMs = 0): Promise<void> {
    const socket = await WsTransport.connect(url);
    const transport: Transport =
      lagMs > 0 ? new LatencyTransport(socket, lagMs, jitterMs) : socket;
    this.transport = transport;

    transport.onMessage((message) => this.handleMessage(message));
    transport.onClose(() => {
      this.remotes.clear();
      // A repulo rakétak is tunjenek el: kapcsolat nelkul nem erkezik
      // tobb minta, es a puffer utolso allapotukban "megfagyasztana" oket.
      this.rockets.clear();
      // A regi kes-ertek megtevesztő lenne bontott kapcsolatnal.
      this.rttMs = null;
      this.events.onClose?.();
    });
  }

  /** Nyitott szobak lekerdezese (a valasz az onRoomList esemenyben jon). */
  requestRoomList(): void {
    this.transport?.send({ type: "listRooms" });
  }

  /** Belepes egy szobaba; kod nelkul a szerver ujat nyit. */
  join(roomCode: string | undefined, name: string): void {
    this.transport?.send({ type: "join", protocol: PROTOCOL_VERSION, roomCode, name });
  }

  /**
   * Kapcsolat + azonnali belepes egy lepesben.
   *
   * A lobby a ket lepest kulon hasznalja (elobb listaz, aztan lep be);
   * ez a rovid ut a teszteknek es a kozvetlen linkkel erkezoknek szol.
   */
  async connect(
    url: string,
    roomCode?: string,
    lagMs = 0,
    jitterMs = 0,
    name?: string,
  ): Promise<void> {
    await this.open(url, lagMs, jitterMs);
    this.join(roomCode, name ?? "");
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

  /**
   * Frissen kilepett jatekosok, es mikor lepett ki (performance.now).
   *
   * Egy `playerLeft` utan meg erkezhetnek olyan snapshotok, amelyek meg
   * TARTALMAZZAK a kilepett jatekost -- azok mar uton voltak, amikor
   * kilepett. Ezek nelkul a szuro nelkul ujra letrehoznank az autojat,
   * es az orokre ott ragadna, mert masodik `playerLeft` nem jon.
   * Halozati ingadozas mellett ez rendszeresen elofordul; a jitteres
   * teszt pontosan ezt produkalta.
   */
  private readonly recentlyLeft = new Map<string, number>();

  /** Ennyi ideig (ms) tiltjuk a kilepett jatekos ujra-felvetelet. */
  private static readonly RECENTLY_LEFT_MS = 3000;

  private hasRecentlyLeft(id: string, now: number): boolean {
    const at = this.recentlyLeft.get(id);
    if (at === undefined) return false;
    if (now - at > NetworkClient.RECENTLY_LEFT_MS) {
      this.recentlyLeft.delete(id);
      return false;
    }
    return true;
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
        // Amig nem tudjuk a SAJAT azonositonkat, a snapshotot eldobjuk.
        //
        // Kulonben nem tudnank kiszurni magunkat belole, es a sajat
        // autonk MASODIK, "tavoli" autokent jelenne meg -- ami sosem
        // tunne el, mert magunkra nem jon `playerLeft`. Nem elmeleti
        // eset: halozati ingadozas mellett a `snapshot` megelozheti a
        // `joined` uzenetet, es a jitteres teszt pontosan ezt produkalta
        // (2 tavoli auto ket jatekosnal).
        if (!this.playerId) return;

        // A sajat autonkat kiszurjuk: azt lokalisan szimulaljuk, a
        // szerver visszakuldott valtozata csak visszarantana. A frissen
        // kilepett jatekosokat is (lasd recentlyLeft).
        this.snapshotCount++;
        const now = performance.now();

        // A sajat HP-nkat a szerver mondja meg (o donti el a sebzest --
        // terv 15.4), ezert a snapshotbol vesszuk ki, mielott kiszurnenk
        // magunkat belole.
        const own = message.players.find((p) => p.id === this.playerId);
        if (own) {
          this.hp = own.hp;
          this.boostGrants = own.boostGrants;
          this.lives = own.lives;
          this.ownName = own.name;
          // A KEREK-SERULES is a szerveré: nem csak latvany, hanem
          // FIZIKAI hatas is (tapadas, kerek-sugar), ezert a hivo
          // beallitja a sajat jarmuvunkon. SZANDEKOSAN nem
          // interpolaljuk -- a "tort" allapot diszkret.
          this.ownWheels = wheelsFromNetwork(own.grip, own.brokenMask);
        }

        const others = message.players.filter(
          (p) => p.id !== this.playerId && !this.hasRecentlyLeft(p.id, now),
        );
        this.remotes.ingest(others, now);

        // A rakétakat a szerver lepteti; mi pufferelunk es a tavoli
        // autokkal AZONOS kesleltetessel rajzolunk. (Korabban a
        // legfrissebb snapshotbol rajzoltuk azonnal, amitol a lovedek
        // ~100 ms-szal -- 5.5 m-rel -- a celpont elott jart.)
        this.rockets.ingest(message.rockets, now);
        this.pickupsAvailable = message.pickupsAvailable;
        this.match = message.match;
        return;
      }

      case "roomList":
        this.events.onRoomList?.(message.rooms);
        return;

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

      case "explosion":
        // A sebzest a szerver mar alkalmazta; ez a latvanyert es a
        // fizikai lokesert jon (a lokest mi szamoljuk a sajat autonkra).
        this.events.onExplosion?.(message.position, message.ownerId);
        return;

      case "respawn":
        // A szerver megmondja, hova szuletunk ujra -- a sajat autonkat
        // csak mi tudjuk athelyezni (hibrid modell, terv 15.4).
        this.events.onRespawn?.(message.position);
        return;

      case "playerLeft":
        this.recentlyLeft.set(message.playerId, performance.now());
        this.remotes.remove(message.playerId);
        this.events.onPlayerLeft?.(message.playerId);
        return;

      case "error":
        this.events.onError?.(message.code, message.message);
        return;
    }
  }
}
