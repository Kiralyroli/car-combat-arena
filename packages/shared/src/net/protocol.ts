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
/**
 * A tavoli autok kirajzolasahoz szukseges teljes kerek-allapot.
 *
 * Ket forrasbol all ossze a szerveren: a poz (steer, susp) a
 * jatekostol erkezik, a SERULES (grip, brokenMask) viszont a szerver
 * sajat, hiteles adata -- lasd WheelPoseState.
 */
export interface WheelVisualState extends WheelPoseState {
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

/**
 * Merre celoz a jatekos.
 *
 * Latvany-adat: ebbol all be a rakétaveto a tetőn. Azert megy at a
 * halozaton, mert TAKTIKAI informacio is -- latni, hogy az ellenfel
 * eppen rad celoz-e. Ket szam, tehat olcso.
 */
export interface AimState {
  /** Vizszintes celzasi szog (radian, vilag-koordinatarendszerben). */
  aimYaw: number;
  /** Fuggoleges celzasi szog (radian). Pozitiv = felfele. */
  aimPitch: number;
}

/** Egy jatekos allapota egy adott szerver-tickben (lasd 15.4). */
export interface PlayerSnapshot extends WheelVisualState, AimState {
  id: string;
  position: [number, number, number];
  /** Quaternion (x, y, z, w). */
  rotation: [number, number, number, number];
  velocity: [number, number, number];
  hp: number;
  /**
   * Hany boost-visszatoltest kapott eddig a jatekos (monoton no).
   *
   * SZAMLALO, nem esemeny: a tartaly a kliensnel van (lasd BoostTank),
   * es igy egy elveszett vagy megkettozott uzenet sem csusztatja el
   * tartosan -- barmelyik snapshot helyreallitja a helyes allapotot.
   */
  boostGrants: number;
}

/**
 * A kerek-latvany azon resze, amit a KLIENS birtokol.
 *
 * A kormanyszog es a felfuggesztes-osszenyomodas a lokalis fizikabol
 * jon: a szerver nem szimulalja a jarmuvet, tehat nem is tudhatja
 * oket. A SERULES (grip, brokenMask) viszont NEM tartozik ide -- azt a
 * szerver dönti el (terv 15.4), kulonben mindenki maga mondhatna meg,
 * letort-e a kereke.
 */
export interface WheelPoseState {
  steer: number;
  susp: [number, number, number, number];
}

/** A kliens sajat, mar lokalisan kiszamolt allapota. */
export interface ClientState extends WheelPoseState, AimState {
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

/**
 * Rakéta kiloves keres.
 *
 * A `target` a vilagbeli pont, ahova a jatekos celzott (a celkereszt
 * alatti felszin). SZANDEKOSAN pontot kuldunk, nem IRANYT: a kiindulo
 * poziciot a szerver a jatekos sajat, mar plauzibilitas-ellenorzott
 * allapotabol veszi, es az iranyt ebbol a ket pontbol szamolja. Igy a
 * kliens nem hatarozhatja meg, HONNAN indul a lovedek.
 *
 * A celzas iranyat viszont szuksegkeppen a kliens adja -- eger-celzasnal
 * a szerver nem tudhatja, hova mutatott a jatekos. Ez elvi hatar: egy
 * modositott kliens tokeletesen celozhat. A terv szerint (15.4) ez
 * elfogadhato, mert a talalatot es a sebzest tovabbra is a szerver
 * donti el.
 */
export interface FireMessage {
  type: "fire";
  target: [number, number, number];
}

export type ClientMessage =
  | JoinMessage
  | StateMessage
  | PingMessage
  | FireMessage;

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

/** Egy repulo rakéta allapota a snapshotban. */
export interface RocketSnapshot {
  id: number;
  ownerId: string;
  position: [number, number, number];
  /** Halado irany (egysegvektor) -- ebbol all be a modell forgasa. */
  direction: [number, number, number];
}

/**
 * Robbanas -- ESEMENY, nem allapot.
 *
 * A sebzest a szerver mar alkalmazta (az a HP-ban jon vissza); ez az
 * uzenet a LATVANYERT es a FIZIKAI LOKESERT megy ki. A lokest minden
 * kliens a sajat autojara szamolja, mert a hibrid modellben a sajat
 * mozgas a klienshez tartozik (terv 15.4).
 */
export interface ExplosionMessage {
  type: "explosion";
  position: [number, number, number];
  /** Ki lotte ki -- a talalat visszajelzesehez. */
  ownerId: string;
}

export interface SnapshotMessage {
  type: "snapshot";
  /** Szerver-tick sorszam -- a kliens-oldali interpolaciohoz. */
  tick: number;
  /** Szerver-ido ms-ban (performance.now alapu), az interpolacios puffer meretezesehez. */
  time: number;
  /** MINDEN jatekos, a cimzettet is beleertve (az sajat magat kiszurja). */
  players: PlayerSnapshot[];
  /**
   * A repulo rakétak. A szerver lepteti oket, a kliens csak rajzolja --
   * ezert itt nincs sebesseg: a kliens ket snapshot kozott interpolal.
   */
  rockets: RocketSnapshot[];
  /**
   * A pickupok allapota, INDEX SZERINT a PICKUP_POINTS-hoz igazitva.
   * Csak azt kuldjuk, hogy eppen felveheto-e -- a pozicio allando, azt
   * a kliens a config-bol ismeri.
   */
  pickupsAvailable: boolean[];
}

export interface PlayerJoinedMessage {
  type: "playerJoined";
  playerId: string;
}

export interface PlayerLeftMessage {
  type: "playerLeft";
  playerId: string;
}

/**
 * Ujraszuletes: a szerver mondja meg, HOVA.
 *
 * A hibrid modellben a kliens birtokolja a sajat mozgasat, tehat a
 * szerver nem tudja "athelyezni" az autojat -- csak megkerni ra. A
 * kliens ezt a poziciot allitja be, es a plauzibilitas-ellenorzes
 * atengedi, mert ervenyes spawn-pont (lasd plausibility.ts).
 */
export interface RespawnMessage {
  type: "respawn";
  position: [number, number, number];
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
  | RespawnMessage
  | ExplosionMessage
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
