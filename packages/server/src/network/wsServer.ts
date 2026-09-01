import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";
import {
  checkPlausibility,
  PING_INTERVAL_MS,
  PROTOCOL_VERSION,
  toGameModeId,
  type ClientMessage,
  type ServerMessage,
} from "@cca/shared";
import { RateLimiter } from "./rateLimit";
import { MAX_PLAYERS_PER_ROOM, type KickCode } from "../rooms/room";
import type { Room } from "../rooms/room";
import type { RoomManager } from "../rooms/roomManager";

/**
 * WebSocket transport a szerver oldalon (terv 15.5).
 *
 * A WebSocket TCP felett fut, tehat head-of-line blocking van; a terv
 * szerint ez tudatos MVP-kompromisszum, es a jatiklogika a Transport
 * absztrakcio mogott van, hogy kesobb WebRTC DataChannelre lehessen
 * valtani a jatiklogika erintese nelkul. Ezert ez a fajl CSAK
 * szallitassal foglalkozik -- szoba- es jatiklogika nincs benne, azt a
 * Room / RoomManager vegzi.
 */

/**
 * Ennyi EGYMAS UTANI elutasitas utan atvesszuk a kliens allapotat.
 *
 * 20 Hz-es kuldesnel ez kb. fel masodperc: eleg rovid ahhoz, hogy egy
 * valodi deszinkronizacio ne fagyassza be tartosan a jatekost, es eleg
 * hosszu ahhoz, hogy egy teleport-hack ne legyen kenyelmes (minden
 * ugrashoz fel masodperc "beragadast" kellene elviselnie).
 */
const MAX_CONSECUTIVE_REJECTS = 10;

/**
 * A leghosszabb elfogadott uzenet (bajt).
 *
 * A legnagyobb valodi uzenet az allapot-frissites, az is csak par szaz
 * bajt. A `ws` a ennel nagyobb kereteket mar a JSON.parse ELOTT
 * eldobja (1009-es kod), tehat egy nagy csomagokkal terhelo kliens nem
 * jut el a szerver CPU-jaig. Bőven a valodi meret fole tesszuk, hogy a
 * protokoll novekedese ne fusson bele csendben.
 */
const MAX_MESSAGE_BYTES = 16 * 1024;

/**
 * Ennyi eldobott uzenet utan bontjuk a kapcsolatot.
 *
 * Nehany eldobas lehet ideiglenes torlodas is, ezert nem az elso
 * tullepesnel bontunk. A tartos aradat viszont mar nem ugy nez ki, mint
 * egy jatszo kliens.
 */
const MAX_DROPPED_MESSAGES = 200;

interface Connection {
  socket: WebSocket;
  playerId: string | null;
  room: Room | null;
  /** Uzenet-ratakorlat -- lasd rateLimit.ts. */
  limiter: RateLimiter;
  /**
   * Elindult-e mar a bontas (ratakorlat miatt).
   *
   * A `close()` csak KEZDEMENYEZI a bontast; a mar uton levo uzenetek
   * meg megerkeznek. E nelkul a jelzo nelkul azokat is szamoltuk es
   * naplaztuk volna -- a naplo tele lett tobb ezres szamokkal egyetlen
   * mar lekapcsolt kapcsolatrol.
   */
  closing: boolean;
  /**
   * Mikor ment ki a legutobbi keses-meres (performance.now), vagy null,
   * ha eppen nincs valaszra varo meres.
   */
  pingSentAt: number | null;
}

export class WsServer {
  private readonly wss: WebSocketServer;
  private readonly rooms: RoomManager;
  /** Az elo kapcsolatok -- a keses-meres jar rajtuk vegig. */
  private readonly connections = new Set<Connection>();
  private readonly pingTimer: NodeJS.Timeout;

  /**
   * A WebSocket egy MEGLEVO HTTP-szerverre csatlakozik, nem sajat
   * portra: igy a kliens statikus fajljai es a jatek-kapcsolat ugyanazon
   * a cimen erhetok el (terv 15.7, lasd httpServer.ts).
   */
  constructor(rooms: RoomManager, server: Server) {
    this.rooms = rooms;
    this.wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });
    this.wss.on("connection", (socket) => this.handleConnection(socket));

    // A meres onmagaban ne tartsa eletben a folyamatot: a szerver
    // tetlensegkor felfuggesztheti magat, es egy jaro timer ezt
    // csendben megakadalyozna.
    this.pingTimer = setInterval(() => this.measureLatency(), PING_INTERVAL_MS);
    this.pingTimer.unref?.();
  }

  close(): void {
    clearInterval(this.pingTimer);
    this.wss.close();
  }

  /**
   * Keses-meres minden kapcsolaton -- a visszatekereshez.
   *
   * SZANDEKOSAN a WebSocket sajat ping/pong KERETEIT hasznaljuk, nem a
   * jatek-protokoll ping uzenetet: a keretekre a bongeszo halozati
   * retege valaszol, a lap JavaScriptje nem lat bele es nem is
   * kesleltetheti. Igy a mert ertek olyan szam, amit a modositott
   * jatek-kliens nem tud felfele hazudni -- eppen ezert alkalmas arra,
   * hogy a bevallott kesest vele vagjuk (lasd Room.rewindMsFor).
   *
   * Egyszerre EGY meres fut kapcsolatonkent: ha az elozore meg nem
   * erkezett valasz, nem inditunk ujat -- kulonben nem lehetne tudni,
   * melyik pong melyik pinghez tartozik.
   */
  private measureLatency(): void {
    for (const conn of this.connections) {
      if (conn.socket.readyState !== conn.socket.OPEN) continue;
      if (conn.pingSentAt !== null) continue;
      conn.pingSentAt = performance.now();
      try {
        conn.socket.ping();
      } catch {
        conn.pingSentAt = null;
      }
    }
  }

  /**
   * Egy jatekos kapcsolatanak bontasa, indoklassal.
   *
   * A SORREND szamit: eloszor megy ki a hibauzenet, es csak utana
   * zarunk. Forditva a kliens csak egy magyarazat nelkuli bontast
   * latna, es nem tudna, miert repult ki -- se a kirugott, se az, akit
   * a halozata dobott ki.
   *
   * A szoba takaritasat (playerLeft, ures szoba) nem itt vegezzuk: a
   * `close` amugy is kivaltja a handleDisconnect-et, es ket helyen
   * karbantartani ugyanazt elobb-utobb elcsuszik.
   */
  private kick(playerId: string, code: KickCode, message: string): void {
    for (const conn of this.connections) {
      if (conn.playerId !== playerId) continue;
      conn.closing = true;
      send(conn.socket, { type: "error", code, message });
      conn.socket.close();
      return;
    }
  }

  private handleConnection(socket: WebSocket): void {
    const conn: Connection = {
      socket,
      playerId: null,
      room: null,
      limiter: new RateLimiter(performance.now()),
      closing: false,
      pingSentAt: null,
    };
    this.connections.add(conn);

    socket.on("message", (raw) => {
      // Ratakorlat MEG a JSON.parse ELOTT: eppen az a koltseg, amitol
      // vedeni akarjuk a szervert.
      if (!this.allow(conn)) return;

      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        send(socket, {
          type: "error",
          code: "bad_message",
          message: "Ervenytelen JSON",
        });
        return;
      }
      this.handleMessage(conn, message);
    });

    // A keres-valasz par a kesest adja. A jatekos meg nem biztos, hogy
    // szobaban van (a lobbyban is megy a meres) -- ezert kell a
    // letezes-ellenorzes.
    socket.on("pong", () => {
      if (conn.pingSentAt === null) return;
      const rtt = performance.now() - conn.pingSentAt;
      conn.pingSentAt = null;
      if (conn.room && conn.playerId) conn.room.noteRtt(conn.playerId, rtt);
    });

    socket.on("close", () => this.handleDisconnect(conn));
    // Halozati hiba eseten is le kell bontani, kulonben "szellem" auto
    // maradna a szobaban.
    socket.on("error", () => this.handleDisconnect(conn));
  }

  /**
   * Belefer-e meg egy uzenet a kapcsolat keretebe?
   *
   * A dontest a RateLimiter hozza; itt csak a KOVETKEZMENY van --
   * naplozas, es tartos aradatnal a kapcsolat bontasa.
   */
  private allow(conn: Connection): boolean {
    // Mar bontas alatt: a meg befuto uzenetekkel nincs dolgunk.
    if (conn.closing) return false;
    if (conn.limiter.take(performance.now())) return true;

    const dropped = conn.limiter.dropped;
    if (dropped === 1 || dropped % 100 === 0) {
      console.warn(
        `[ws] ${conn.playerId?.slice(0, 8) ?? "ismeretlen"} ratakorlat ` +
          `(${dropped} eldobott uzenet)`,
      );
    }
    if (dropped >= MAX_DROPPED_MESSAGES) {
      conn.closing = true;
      send(conn.socket, {
        type: "error",
        code: "rate_limit",
        message: "Tul sok uzenet",
      });
      conn.socket.close();
    }
    return false;
  }

  private handleMessage(conn: Connection, message: ClientMessage): void {
    switch (message.type) {
      case "listRooms":
        // A lobbybol jon, MEG csatlakozas elott -- ezert nem kell
        // hozza sem szoba, sem playerId.
        send(conn.socket, {
          type: "roomList",
          rooms: this.rooms.listings(MAX_PLAYERS_PER_ROOM),
        });
        return;

      case "join":
        this.handleJoin(conn, message);
        return;
      case "selectWeapon":
        // Fegyvervaltas. A szerver dönti el, hogy SZABAD-e eppen (csak
        // ujraszuleteskor vagy meccs elott) -- lasd Room.setWeapon.
        if (conn.room && conn.playerId) {
          conn.room.setWeapon(conn.playerId, message.weapon);
        }
        return;

      case "selectAbility":
        // Ugyanaz a szabaly, mint a fegyvernel: a szerver dönti el,
        // hogy szabad-e eppen (lasd Room.setAbility).
        if (conn.room && conn.playerId) {
          conn.room.setAbility(conn.playerId, message.ability);
        }
        return;

      case "useAbility":
        // A kliens csak KERI; hogy elsul-e, azt a visszatoltes es az
        // eletben letel donti el (lasd Room.useAbility).
        if (conn.room && conn.playerId) {
          // performance.now(), NEM Date.now(): a szoba minden idobelyege
          // ebbol az orabol jon (gameLoop, tryFire, spawn-vedelem). A ket
          // ora kulon jar, es a kevereskbol a visszatoltes egy
          // idobelyeg-kulonbseg lenne -- merve 1 787 931 411 546 ms
          // "hatralevo ido" jelent meg a HUD-on.
          conn.room.useAbility(conn.playerId, performance.now());
        }
        return;

      case "chooseSpawn":
        // A jatekos maga valasztja meg az ujraszuletesi helyet. A szerver
        // ellenorzi, hogy varakozik-e egyaltalan, es hogy a pont szabad-e
        // -- lasd Room.chooseSpawn.
        if (conn.room && conn.playerId) {
          conn.room.chooseSpawn(conn.playerId, message.index);
        }
        return;

      case "kick":
        // CSAK a host rughat ki, es nem sajat magat -- a szerver dönti
        // el, nem a kliens (lasd Room.canKick). E nelkul barki
        // kirughatna barkit, ami rosszabb lenne, mint a csalas.
        if (conn.room && conn.playerId) {
          if (conn.room.canKick(conn.playerId, message.playerId)) {
            console.log(
              `[room ${conn.room.code}] ${conn.playerId.slice(0, 8)} (host) ` +
                `kirugta: ${message.playerId.slice(0, 8)}`,
            );
            this.kick(
              message.playerId,
              "kicked",
              "A szoba nyitoja kirugott a jatekbol.",
            );
          } else {
            // NEM naplozzuk hangosan: egy elkesett kereseben (a celpont
            // kozben kilepett) nincs semmi gyanus.
            send(conn.socket, {
              type: "error",
              code: "bad_message",
              message: "Nincs jogod kirugni ezt a jatekost",
            });
          }
        }
        return;

      case "fire":
        // A kiloves iranyat es helyet a SZERVER szamolja a jatekos
        // allapotabol -- a kliens csak kerni tud (lasd FireMessage).
        if (conn.room && conn.playerId) {
          conn.room.tryFire(conn.playerId, message.target, performance.now());
        }
        return;

      case "state":
        this.handleState(conn, message);
        return;
      case "ping":
        // Valtozatlanul visszhangozzuk: a kliens a SAJAT orajaval
        // szamol kulonbseget, igy nem kell orat szinkronizalni.
        send(conn.socket, { type: "pong", t: message.t });
        return;
      default:
        send(conn.socket, {
          type: "error",
          code: "bad_message",
          message: "Ismeretlen uzenettipus",
        });
    }
  }

  private handleJoin(
    conn: Connection,
    message: Extract<ClientMessage, { type: "join" }>,
  ): void {
    if (message.protocol !== PROTOCOL_VERSION) {
      send(conn.socket, {
        type: "error",
        code: "bad_protocol",
        // A jatekos nem tud mit kezdeni a verziószamokkal -- azt kell
        // megmondani, MIT TEGYEN. A szamok a vegen maradnak, mert a
        // hibajelentesben hasznosak.
        message:
          "Uj verzio erkezett -- toltsd ujra az oldalt. " +
          `(szerver: ${PROTOCOL_VERSION}, kliens: ${message.protocol})`,
      });
      conn.socket.close();
      return;
    }

    let room: Room;
    if (message.roomCode) {
      const found = this.rooms.find(message.roomCode);
      if (!found) {
        send(conn.socket, {
          type: "error",
          code: "room_not_found",
          message: `Nincs ilyen szoba: ${message.roomCode}`,
        });
        return;
      }
      if (found.isFull) {
        send(conn.socket, {
          type: "error",
          code: "room_full",
          message: "A szoba megtelt",
        });
        return;
      }
      room = found;
    } else {
      // A JATEKMOD csak UJ szoba nyitasakor szamit. Meglevo szobaba
      // lepve a szoba modja marad ervenyben -- egy meccs kozben nem
      // valthat modot a jatek a bent levok alatt.
      room = this.rooms.create(toGameModeId(message.mode));
    }

    const playerId = randomUUID();
    // A szoba nem ismeri a WebSocketet -- csak egy kuldo fuggvenyt kap,
    // es egy KIDOBAS-varratot. A kidobas a kapcsolat bontasa, amit csak
    // a transport tud elvegezni; a dontes viszont a szobae.
    //
    // Minden belepesnel ujra beallitjuk (ugyanarra): egy szoba tobb
    // kapcsolatot szolgal ki, es igy nem kell kulon eletciklust
    // kovetni.
    room.onKick = (id, code, text) => this.kick(id, code, text);
    const player = room.add(
      playerId,
      (msg) => send(conn.socket, msg),
      message.name,
      message.weapon,
      message.car,
      message.ability,
      message.skin,
    );

    conn.playerId = playerId;
    conn.room = room;

    send(conn.socket, {
      type: "joined",
      playerId,
      roomCode: room.code,
      players: room.playerIds().filter((id) => id !== playerId),
      spawn: player.state.position,
    });
    room.broadcast(
      { type: "playerJoined", playerId, car: player.car, skin: player.skin },
      playerId,
    );

    console.log(
      `[room ${room.code}] csatlakozott ${playerId.slice(0, 8)} (${room.playerCount} jatekos)`,
    );
  }

  private handleState(
    conn: Connection,
    message: Extract<ClientMessage, { type: "state" }>,
  ): void {
    if (!conn.room || !conn.playerId) return;
    const player = conn.room.get(conn.playerId);
    if (!player) return;

    // Kesve vagy rossz sorrendben erkezo csomag eldobasa. A WebSocket
    // ugyan sorrendtarto, de a Transport kesobb unreliable/unordered
    // WebRTC DataChannelre valthat -- ez a vedelme mar most a helyen van.
    if (message.seq <= player.lastSeq) return;
    player.lastSeq = message.seq;

    // A visszajelzett snapshot-tick a MOZGASTOL FUGGETLENUL erdekes: a
    // plauzibilitas-ellenorzes eldobhatja az allapotot, de attol a
    // jatekos meg ugyanazt a (regi) vilagot latja, es a gepfegyver
    // visszatekereseshez ez kell.
    if (message.ackTick !== undefined) {
      conn.room.noteAck(conn.playerId, message.ackTick);
    }

    // Megsemmisult auto allapotat nem vesszuk at: a roncs maradjon ott,
    // ahol kidőlt. Az ujraszuletest a szerver kezdemenyezi (respawn).
    if (player.deadSince !== null) return;

    // Plauzibilitas-ellenorzes (terv 15.4, 3. lepcso 5. pont).
    //
    // A kliens birtokolja a sajat mozgasat, tehat egy modositott kliens
    // barmit allithat magarol. Ujraszimulalni nem tudjuk (az a teljes
    // authoritative fizika lenne), de a fizikailag lehetetlent eldobjuk.
    const now = performance.now();
    const dtSeconds = (now - player.lastStateAt) / 1000;
    player.lastStateAt = now;

    const verdict = checkPlausibility(player.state, message.state, dtSeconds);

    if (!verdict.ok) {
      player.rejectedCount++;
      player.consecutiveRejects++;

      // Kiut a tartos elakadasbol: ha SOK allapot bukik el egymas utan,
      // az valoszinuleg nem csalas, hanem deszinkronizacio (pl. hosszu
      // halozati kimaradas). Ilyenkor egyszer atvesszuk az allapotot,
      // kulonben a jatekos VEGLEG beragadna a tobbiek kepernyojen.
      // Ez inkabb legyen ritka es NAPLOZOTT, mint csendes.
      if (player.consecutiveRejects >= MAX_CONSECUTIVE_REJECTS) {
        console.warn(
          `[room ${conn.room.code}] ${conn.playerId.slice(0, 8)} ujraszinkronizalva ` +
            `${player.consecutiveRejects} elutasitas utan (${verdict.reason})`,
        );
        player.state = message.state;
        player.consecutiveRejects = 0;
        // A KIUT-nak ara van: aki folyamatosan ebben az allapotban van,
        // annak elobb-utobb betelik a pohara (lasd cheatMonitor.ts).
        // Ez a leggyengebb jel a haromból -- egy szakado kapcsolat is
        // eloallitja --, ezert er a legkevesebbet, es ezert cseng le.
        conn.room.noteViolation(conn.playerId, "resync", now);
        return;
      }

      // ELDOBJUK: a jatekos az utoljara elfogadott helyen marad. Igy a
      // hamis allapot nem jut el a tobbi klienshez -- a csalo legfeljebb
      // a sajat kepernyojen "repul".
      if (player.rejectedCount <= 3 || player.rejectedCount % 50 === 0) {
        console.warn(
          `[room ${conn.room.code}] ${conn.playerId.slice(0, 8)} allapota elutasitva ` +
            `(${verdict.reason}: ${verdict.detail}) -- osszesen ${player.rejectedCount}`,
        );
      }
      return;
    }

    player.state = message.state;
    player.consecutiveRejects = 0;
  }

  private handleDisconnect(conn: Connection): void {
    // FELTETEL NELKUL, es a korai visszateres ELOTT: a lobbyban ragadt
    // (szobahoz sosem tartozo) kapcsolat kulonben orokre bent maradna a
    // halmazban, es a keses-meres vegtelenul jarna rajta.
    this.connections.delete(conn);

    if (!conn.room || !conn.playerId) return;

    const { room, playerId } = conn;
    if (!room.remove(playerId)) return;

    room.broadcast({ type: "playerLeft", playerId });
    console.log(
      `[room ${room.code}] kilepett ${playerId.slice(0, 8)} (${room.playerCount} jatekos)`,
    );

    if (this.rooms.removeIfEmpty(room)) {
      console.log(`[room ${room.code}] ures, torolve`);
    }

    conn.room = null;
    conn.playerId = null;
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(message));
}
