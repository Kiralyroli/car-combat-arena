import { generateRoomCode } from "@cca/shared";
import { Room } from "./room";

/**
 * Szobak nyilvantartasa MEMORIABAN (terv 15.7: MVP-ben egyetlen Node
 * process eleg, a szobak memoriaban elnek -- nincs adatbazis).
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  get roomCount(): number {
    return this.rooms.size;
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }

  find(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  create(): Room {
    // Nagyon valoszinutlen, de a kod-utkozest kezelni kell: addig
    // generalunk, amig szabadot nem talalunk.
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();

    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  /** Ures szoba torlese -- kulonben a memoria idovel tele futna. */
  removeIfEmpty(room: Room): boolean {
    if (!room.isEmpty) return false;
    return this.rooms.delete(room.code);
  }
}
