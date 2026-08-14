import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from "@cca/shared";
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
      case "join":
        this.handleJoin(conn, message);
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
    const player = room.add(playerId, (msg) => send(conn.socket, msg));

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

    // TODO (3. lepcso 5. pont): plauzibilitas-ellenorzes -- max sebesseg,
    // pozicio-delta es palya-hatarok vizsgalata, mielott elfogadjuk.
    player.state = message.state;
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
