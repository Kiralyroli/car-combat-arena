/**
 * Kliens <-> szerver uzenet-protokoll.
 *
 * A hibrid authority modell szerint (projekt-terv 15.4) a KLIENS
 * birtokolja a sajat autoja mozgasat -- teljes fizikaval, lokalisan
 * szimulalva, nulla input laggel --, a SZERVER pedig minden
 * kovetkezmenyt (sebzes, HP, pickup, meccs-allapot). Ezert a kliens
 * nem "input"-ot kuld, amibol a szerver szamolna a mozgast, hanem a
 * mar kiszamolt sajat allapotat; a szerver ezt plauzibilitas-
 * ellenorzes utan tovabbitja a tobbieknek.
 *
 * Ez a fajl SZANDEKOSAN csak tipusokat es tiszta fuggvenyeket
 * tartalmaz -- se WebSocket, se Node-specifikus kod --, hogy a
 * transport rteg (15.5) kesobb cserelheto legyen a jatiklogika
 * erintese nelkul.
 */

/** Halozati snapshot-rata (Hz). A fizika ettol fuggetlenul 60 Hz -- lasd 15.3. */
export const SNAPSHOT_HZ = 20;

/** Protokoll-verzio: eltero verzioju kliens/szerver nem beszelget. */
export const PROTOCOL_VERSION = 1;

/**
 * A kerekek LATVANY-allapota.
 *
 * Szandekosan tomor: NEM a negy kerek teljes transzformja megy at
 * (az 4 x 7 = 28 szam lenne jatekosonkent), csak az a ket dolog, amit
 * a fogado kliens nem tud magatol kiszamolni:
 *
 *  - `steer`: a kormanyzott kerekek szoge (radian)
 *  - `susp`:  a negy rugo aktualis hossza (FL, FR, RL, RR sorrendben)
 *
 * A kerekek GORDULESET nem kuldjuk: azt a fogado oldal a sebessegbol
 * szamolja (elfordulas = elorehaladasi sebesseg / kereksugar). Igy
 * nemcsak savszelesseget sporolunk, hanem simabb is lesz, mert nincs
 * korbefordulasi (2*PI -> 0) ugras a ket snapshot kozotti
 * interpolacioban.
 */
export interface WheelVisualState {
  steer: number;
  susp: [number, number, number, number];
  /**
   * Kerekenkenti tapadas-szorzo (0..1). Ebbol jon a kerek merete es
   * szine is -- lasd wheelVisuals.ts.
   */
  grip: [number, number, number, number];
  /**
   * Tort kerekek BITMASZKJA (0. bit = FL, 1. = FR, 2. = RL, 3. = RR).
   *
   * Miert bitmaszk es nem negy logikai ertek? Mert a "tort" allapotot
   * NEM szabad interpolalni: egy kerek vagy letort, vagy nem. Egyetlen
   * egesz szamkent atmegy a halozaton, es a fogado oldal a megjelenitett
   * idopillanathoz tartozo mintabol veszi at valtozatlanul.
   */
  brokenMask: number;
}

/** Egy jatekos allapota egy adott szerver-tickben (lasd 15.4). */
export interface PlayerSnapshot extends WheelVisualState {
  id: string;
  position: [number, number, number];
  /** Quaternion (x, y, z, w). */
  rotation: [number, number, number, number];
  velocity: [number, number, number];
  hp: number;
}

/** A kliens sajat, mar lokalisan kiszamolt allapota. */
export interface ClientState extends WheelVisualState {
  position: [number, number, number];
  rotation: [number, number, number, number];
  velocity: [number, number, number];
}

// --- Kliens -> szerver ---

export interface JoinMessage {
  type: "join";
  protocol: number;
  /** Szobakod; ha nincs megadva, a szerver nyit egy ujat. */
  roomCode?: string;
  name?: string;
}

export interface StateMessage {
  type: "state";
  /** Novekvo sorszam -- a kesve/rossz sorrendben erkezo csomagok eldobasahoz. */
  seq: number;
  state: ClientState;
}

/**
 * Kes-meres (RTT). A kliens sajat orajanak aktualis erteket kuldi el,
 * a szerver valtozatlanul visszakuldi -- igy a kliens a sajat orajaval
 * tud kulonbseget szamolni, es NINCS szukseg a ket ora
 * szinkronizalasara (ami sajat maga is hibaforras lenne).
 */
export interface PingMessage {
  type: "ping";
  t: number;
}

export type ClientMessage = JoinMessage | StateMessage | PingMessage;

// --- Szerver -> kliens ---

export interface JoinedMessage {
  type: "joined";
  playerId: string;
  roomCode: string;
  /** A mar bent levo tobbi jatekos (a sajat ID nelkul). */
  players: string[];
  /**
   * A szerver altal kiosztott spawn-pozicio. A kliensnek IDE kell
   * helyeznie a sajat autojat -- kulonben minden jatekos a config.ts
   * szerinti kozos spawn-pontra szuletne, tehat egymasba.
   */
  spawn: [number, number, number];
}

export interface SnapshotMessage {
  type: "snapshot";
  /** Szerver-tick sorszam -- a kliens-oldali interpolaciohoz. */
  tick: number;
  /** Szerver-ido ms-ban (performance.now alapu), az interpolacios puffer meretezesehez. */
  time: number;
  /** MINDEN jatekos, a cimzettet is beleertve (az sajat magat kiszurja). */
  players: PlayerSnapshot[];
}

export interface PlayerJoinedMessage {
  type: "playerJoined";
  playerId: string;
}

export interface PlayerLeftMessage {
  type: "playerLeft";
  playerId: string;
}

export interface ErrorMessage {
  type: "error";
  code: "bad_protocol" | "room_full" | "room_not_found" | "bad_message";
  message: string;
}

/** A `ping` valtozatlan visszhangja -- lasd PingMessage. */
export interface PongMessage {
  type: "pong";
  t: number;
}

export type ServerMessage =
  | JoinedMessage
  | SnapshotMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | PongMessage
  | ErrorMessage;

/** Milyen surun mer a kliens kest (ms). */
export const PING_INTERVAL_MS = 1000;

// --- Transport absztrakcio (15.5) ---

/**
 * A halozati rteg a jatiklogika fele EZEN a felulet keresztul
 * latszik. Most WebSocket implementalja; kesobb WebRTC DataChannel
 * vagy WebTransport valthatja le anelkul, hogy a jatiklogikahoz
 * hozza kellene nyulni.
 */
export interface Transport {
  send(message: ClientMessage): void;
  onMessage(handler: (message: ServerMessage) => void): void;
  onClose(handler: () => void): void;
  close(): void;
  readonly connected: boolean;
}

/** Szobakod: 4 karakter, konnyen felolvashato (nincs 0/O, 1/I). */
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}
