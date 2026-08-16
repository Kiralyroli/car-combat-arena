import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import {
  checkPlausibility,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from "@cca/shared";
import { MAX_PLAYERS_PER_ROOM } from "../rooms/room";
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

interface Connection {
  socket: WebSocket;
  playerId: string | null;
  room: Room | null;
}

export class WsServer {
  private readonly wss: WebSocketServer;
  private readonly rooms: RoomManager;

  constructor(rooms: RoomManager, port: number) {
    this.rooms = rooms;
    this.wss = new WebSocketServer({ port });
    this.wss.on("connection", (socket) => this.handleConnection(socket));
  }

  close(): void {
    this.wss.close();
  }

  private handleConnection(socket: WebSocket): void {
    const conn: Connection = { socket, playerId: null, room: null };

    socket.on("message", (raw) => {
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

    socket.on("close", () => this.handleDisconnect(conn));
    // Halozati hiba eseten is le kell bontani, kulonben "szellem" auto
    // maradna a szobaban.
    socket.on("error", () => this.handleDisconnect(conn));
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
        message: `Protokoll-verzio eltero (szerver: ${PROTOCOL_VERSION}, kliens: ${message.protocol})`,
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
      room = this.rooms.create();
    }

    const playerId = randomUUID();
    // A szoba nem ismeri a WebSocketet -- csak egy kuldo fuggvenyt kap.
    const player = room.add(
      playerId,
      (msg) => send(conn.socket, msg),
      message.name,
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
    room.broadcast({ type: "playerJoined", playerId }, playerId);

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
