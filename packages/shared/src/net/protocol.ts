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

import type { MatchPhase } from "../match";
import type { CarColorId } from "../carColors";
import type { WeaponId } from "../weapons";
/** Halozati snapshot-rata (Hz). A fizika ettol fuggetlenul 60 Hz -- lasd 15.3. */
export const SNAPSHOT_HZ = 20;

/**
 * Mennyivel a jelen mogott rendereli a kliens a TOBBI jatekost.
 * 20 Hz-nel 2 snapshot-nyi tartalek.
 *
 * A KLIENS es a SZERVER is hasznalja, ezert van itt, a protokoll
 * mellett -- ez a ketto kozott megosztott idozites resze:
 *
 *  - a kliensen a tavoli autok es a raketak ugyanebbol az egy
 *    idovonalbol rajzolodnak (kulonben a lovedek a celpont elott
 *    jarna a kepernyon),
 *  - a szerveren pedig ennyivel (plusz a halozati uttal) kell
 *    visszatekerni a celpontokat az azonnali talalatu fegyvernel,
 *    kulonben a jatekos oda lo, ahol a masikot LATJA, a szerver meg
 *    ott keresi, ahol AKKOR van.
 */
export const INTERP_DELAY_MS = 100;

/** Protokoll-verzio: eltero verzioju kliens/szerver nem beszelget. */
/**
 * Protokoll-verzio.
 *
 * 2: fegyvervalasztas (agyu / gepfegyver), a hozza tartozo mezokkel --
 * a regi kliens nem tudna se fegyvert kuldeni, se nyomjelzot rajzolni,
 * ezert inkabb egyertelmu hibaval alljon meg, mint fura jatekkal.
 */
export const PROTOCOL_VERSION = 6;

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
  /**
   * A jatekos megjelenitett neve (mar tisztitva -- lasd
   * sanitizePlayerName). Minden snapshotban ott van, mert az
   * eredmenyjelzo es az auto folotti felirat is ebbol epul: igy egy
   * kesobb csatlakozo kliensnek sem kell kulon nev-lekerdezes.
   */
  name: string;
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
  /**
   * Hany elete van meg (Last Car Standing). 0 = kiesett, nezokent van
   * jelen -- nem szuletik ujra, es nem is sebezheto.
   */
  lives: number;
  /** Melyik fegyverrel jatszik -- a HUD es az eredmenyjelzo mutatja. */
  weapon: WeaponId;
  /**
   * A gepfegyver hoszintje (0..100), agyunal mindig 0.
   *
   * A SZERVER tartja nyilvan, mert a tuzeles kovetkezmenye szerver-
   * oldali; a kliens csak kirajzolja. Minden snapshotban ott van, tehat
   * egy elveszett csomag sem csusztatja el tartosan.
   */
  heat: number;
  /**
   * Serthetetlen-e eppen (ujraszuletes utani rovid vedelem).
   *
   * MINDENKI latja, nem csak az erintett: az ellenfelnek is tudnia
   * kell, hogy most hiaba lo -- ezert a kliens attetszove teszi a
   * vedett autot. Egy rejtett vedelem csak ertelmetlen "miert nem fogy
   * a HP-ja" elmenyt adna.
   */
  protected: boolean;
  /**
   * Az auto szine -- a SZERVER dontese szerint.
   *
   * Azert utazik a snapshotban, hogy MINDEN kliens ugyanazt lassa.
   * Korabban a fogado kliens osztotta ki a sajat listaja szerint, es
   * ugyanaz a jatekos mas szinu volt minden kepernyon.
   */
  color: CarColorId;
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
  /**
   * Nyomva tartja-e a jatekos a tuz gombot.
   *
   * A GEPFEGYVERHEZ kell: az azonnali talalatu fegyver a SZERVER
   * tickjen tuzel, a mar amugy is atmeno celzasi szogek (aimYaw,
   * aimPitch) iranyaba. Igy 11 loves/mp mellett sem kell lovesenkent
   * kulon uzenet -- ez maradek nelkul elferne a meglevo allapot-
   * folyamban.
   *
   * Az agyu tovabbra is kulon fire uzenettel sul el, mert az egyszeri
   * esemeny, es a celpontot pontosan a kattintas pillanataban kell
   * rogziteni.
   */
  firing: boolean;
}

// --- Kliens -> szerver ---

export interface JoinMessage {
  type: "join";
  protocol: number;
  /** Szobakod; ha nincs megadva, a szerver nyit egy ujat. */
  roomCode?: string;
  name?: string;
  /** Valasztott fegyver; hianyzo vagy ismeretlen ertek eseten agyu. */
  weapon?: WeaponId;
  /**
   * Valasztott autoszin; hianyzo vagy ismeretlen ertek eseten sarga.
   *
   * KERES, nem dontes: ha a szobaban mar hasznalja valaki, a szerver
   * mast ad (lasd assignCarColor). A vegleges szin a snapshotbol derul
   * ki -- igy nincs ket forras ugyanarra az adatra.
   */
  color?: CarColorId;
}

/**
 * Fegyvervaltas.
 *
 * A szerver CSAK akkor fogadja el, ha a jatekos eppen nem el (a
 * megsemmisules es az ujraszuletes kozotti idoben), vagy a meccs meg el
 * sem kezdodott. Igy a valasztasnak tetje van: menekules kozben nem
 * lehet atvaltani arra, ami eppen jobban jonne.
 */
export interface SelectWeaponMessage {
  type: "selectWeapon";
  weapon: WeaponId;
}

export interface StateMessage {
  type: "state";
  /** Novekvo sorszam -- a kesve/rossz sorrendben erkezo csomagok eldobasahoz. */
  seq: number;
  state: ClientState;
  /**
   * A legutobb FELDOLGOZOTT szerver-tick sorszama.
   *
   * Ebbol tudja meg a szerver, mennyire regi vilagot lat a jatekos, es
   * ennyivel tekeri vissza a celpontokat az azonnali talalat
   * kiertekelesekor (lasd a szerver oldalan a pozicio-elozmenyt).
   *
   * MIERT KELL: a kliens ket okbol is a multat latja -- a halozati ut
   * miatt, es mert szandekosan INTERP_DELAY_MS-mal korabbi allapotot
   * jelenit meg, hogy a mozgas sima legyen. 30 m/s-nal ez egyutt tobb
   * mint negy meter, azaz tobb egy auto szelessegenel: visszatekeres
   * nelkul a gepfegyver rendszeresen melle lone, HOLOTT a jatekos
   * pontosan celzott.
   *
   * A szerver a SAJAT feljegyzesebol nezi meg, mikor kuldte ki ezt a
   * ticket -- a kliens nem allithat magarol tetszoleges kesest.
   */
  ackTick?: number;
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

/**
 * Nyitott szobak lekerdezese -- a lobbybol, MEG csatlakozas elott.
 *
 * Kulon uzenet, mert a kapcsolat ilyenkor meg nem tartozik szobahoz:
 * a jatekos eppen azt valasztja ki, hova lepjen be.
 */
export interface ListRoomsMessage {
  type: "listRooms";
}

export type ClientMessage =
  | ListRoomsMessage
  | JoinMessage
  | StateMessage
  | PingMessage
  | SelectWeaponMessage
  | ChooseSpawnMessage
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

/**
 * A meccs allapota a snapshotban (Last Car Standing).
 *
 * A fazist es a gyoztest a SZERVER dönti el; a kliens csak megjeleniti.
 * A visszaszamlalasokat HATRALEVO idokent kuldjuk, nem idopontkent --
 * igy nem kell orajel-szinkron a szerverrel (ugyanaz az elv, mint az
 * interpolacios puffernel).
 */
export interface MatchSnapshot {
  phase: MatchPhase;
  /** Hany jatekos van meg talpon (eletben levo eletekkel). */
  survivors: number;
  /** A gyoztes azonositoja, vagy null (meg megy a meccs, vagy dontetlen). */
  winnerId: string | null;
  /** Mennyi van meg az uj meccsig (ms); 0, ha nem `ended` a fazis. */
  restartInMs: number;
}

/**
 * Egy leadott gepfegyver-loves, a LATVANYERT.
 *
 * A talalat mar eldolt a szerveren (a sebzes a HP-ban jon vissza); ez a
 * nyomjelzo csik kirajzolasahoz kell. A snapshotba csomagolva megy ki,
 * nem kulon uzenetkent: 11 loves/mp mellett nyolc jatekosnal az
 * uzenetenkenti kuldes masodpercenkent kozel szaz kulon csomag lenne.
 */
export interface TracerSnapshot {
  ownerId: string;
  /** Csotorkolat. */
  from: [number, number, number];
  /** Ahol vege lett: becsapodas vagy a hatotav vege. */
  to: [number, number, number];
  /** Talalt-e autot -- ebbol jon a becsapodas-jelzes. */
  hit: boolean;
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

/** Egy szoba a lobby listajaban. */
export interface RoomListing {
  code: string;
  players: number;
  maxPlayers: number;
  /** A meccs allapota -- lathato legyen, hogy epp megy-e a jatek. */
  phase: MatchPhase;
}

export interface RoomListMessage {
  type: "roomList";
  rooms: RoomListing[];
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
   * A legutobbi snapshot ota leadott gepfegyver-lovesek (latvany).
   *
   * ESEMENY-lista, nem allapot: minden snapshotban csak az azota
   * tortentek vannak benne, es a kliens kirajzolas utan elfelejti.
   */
  tracers: TracerSnapshot[];
  /**
   * A pickupok allapota, INDEX SZERINT a PICKUP_POINTS-hoz igazitva.
   * Csak azt kuldjuk, hogy eppen felveheto-e -- a pozicio allando, azt
   * a kliens a config-bol ismeri.
   */
  pickupsAvailable: boolean[];
  /** A meccs allapota (Last Car Standing) -- lasd match.ts. */
  match: MatchSnapshot;
}

export interface PlayerJoinedMessage {
  type: "playerJoined";
  playerId: string;
  /**
   * Az uj jatekos szine.
   *
   * Azert megy MAR ITT, hogy az auto rogton a vegleges szinevel
   * epuljon fel. A snapshotbol is kiderulne, de akkor egy pillanatra
   * rossz szinnel villanna fel.
   */
  color: CarColorId;
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

/**
 * A leendo ujraszuletesi hely -- CSAK az erintett jatekosnak.
 *
 * SZANDEKOSAN nem a snapshotban megy: azt mindenki megkapja, tehat az
 * ellenfel megtudna, hova fogsz megjelenni, es odaallhatna varni. Pont
 * az ellen vedekezunk, amit az ilyen szivargas okozna.
 *
 * A halal ot masodperce alatt tobbszor is erkezhet: a szerver ujra-
 * ertekeli a tervet, ahogy a harc mozog (lasd Room.updateRespawnPlans).
 * A kliens ide viszi a kamerat, igy a jatekos MAR A SZULETES ELOTT
 * latja a helyet es a kornyeken levo ellenfeleket.
 */
export interface RespawnPlanMessage {
  type: "respawnPlan";
  position: [number, number, number];
  /** A valasztott spawn-pont sorszama (SPAWN_POINTS indexe). */
  index: number;
  /**
   * Amibol valaszthat a jatekos -- a szabad spawn-pontok sorszamai.
   *
   * A koordinatak nem kellenek: a kliens ugyanabbol a SPAWN_POINTS
   * listabol dolgozik. A foglaltsag NEM arulja el senki helyzetet: egy
   * pontot az tart foglalva, aki ODA szuletett -- akar percekkel
   * korabban, tovabbhajtva azota.
   */
  options: number[];
}

/**
 * A jatekos MAGA valasztja meg, hova szulessen ujja.
 *
 * Opcionalis: aki nem valaszt, azt a szerver ajanlata viszi (az
 * ellenfelektol legtavolabbi szabad pont). Aki viszont valaszt, annak a
 * dontese ALL -- a szerver ilyenkor nem irja felul, meg akkor sem, ha
 * kozben veszelyesebbe valik. A sajat dontest nem vesszuk el a
 * jatekostol; a kockazat is az ove.
 */
export interface ChooseSpawnMessage {
  type: "chooseSpawn";
  index: number;
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
  | RoomListMessage
  | JoinedMessage
  | SnapshotMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | RespawnMessage
  | RespawnPlanMessage
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
