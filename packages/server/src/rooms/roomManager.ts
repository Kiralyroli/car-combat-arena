import { generateRoomCode, type RoomListing } from "@cca/shared";
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

  /**
   * A lobbyban listazando szobak.
   *
   * Az URES szobak kimaradnak: azok csak a letrehozas es az elso
   * belepes kozotti pillanatban leteznek (illetve amig a takaritas
   * el nem tavolitja oket), es egy jatekosnak semmit nem mondanak.
   *
   * A sorrend a jatekosszam szerinti: ahol tobben vannak, az
   * erdekesebb -- ott biztosan van kivel jatszani.
   */
  listings(maxPlayers: number): RoomListing[] {
    return this.all()
      .filter((room) => !room.isEmpty)
      .map((room) => ({
        code: room.code,
        players: room.playerCount,
        maxPlayers,
        phase: room.matchPhase,
      }))
      .sort((a, b) => b.players - a.players || a.code.localeCompare(b.code));
  }

  /** Ures szoba torlese -- kulonben a memoria idovel tele futna. */
  removeIfEmpty(room: Room): boolean {
    if (!room.isEmpty) return false;
    return this.rooms.delete(room.code);
  }
}
