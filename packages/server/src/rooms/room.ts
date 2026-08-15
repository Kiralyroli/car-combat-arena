import {
  SPAWN_POINTS,
  type ClientState,
  type PlayerSnapshot,
  type ServerMessage,
} from "@cca/shared";

/** Terv 3. fejezet: minimum 2, idealis 4--8 jatekos. */
export const MAX_PLAYERS_PER_ROOM = 8;

/** Kezdo HP. A sebzes-rendszer a 4. lepcsoben jon (terv 8. fejezet). */
const START_HP = 100;

/**
 * Egy jatekos a szerver oldalan.
 *
 * A `send` fuggveny absztrakcio: a szoba NEM ismeri a WebSocketet
 * (lasd terv 15.5 -- a transport rteg cserelheto kell legyen).
 */
export interface ServerPlayer {
  id: string;
  send: (message: ServerMessage) => void;
  state: ClientState;
  /** Melyik SPAWN_POINTS elemet foglalja -- kilepeskor felszabadul. */
  spawnIndex: number;
  hp: number;
  /** Az utoljara elfogadott allapot sorszama -- a kesve erkezok eldobasahoz. */
  lastSeq: number;
  /**
   * Mikor erkezett utoljara allapot-uzenete (performance.now) --
   * FUGGETLENUL attol, hogy elfogadtuk-e.
   *
   * Szandekosan nem az utolso ELFOGADAS ideje: abbol a megengedett
   * elmozdulas az elutasitasok alatt magatol nőne, tehat elég lenne
   * varni egy keveset, es a teleport atmenne.
   */
  lastStateAt: number;
  /** Hany allapotot utasitottunk el osszesen (plauzibilitas). */
  rejectedCount: number;
  /** Hany allapotot utasitottunk el egymas utan -- lasd resync. */
  consecutiveRejects: number;
}

const ORIGIN_STATE: ClientState = {
  position: [0, 2.5, 0],
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0],
  steer: 0,
  susp: [0, 0, 0, 0],
  grip: [1, 1, 1, 1],
  brokenMask: 0,
};

export class Room {
  readonly code: string;
  private readonly players = new Map<string, ServerPlayer>();

  constructor(code: string) {
    this.code = code;
  }

  get playerCount(): number {
    return this.players.size;
  }

  get isEmpty(): boolean {
    return this.players.size === 0;
  }

  get isFull(): boolean {
    return this.players.size >= MAX_PLAYERS_PER_ROOM;
  }

  playerIds(): string[] {
    return [...this.players.keys()];
  }

  add(id: string, send: (message: ServerMessage) => void): ServerPlayer {
    const spawn = this.allocateSpawn();
    const player: ServerPlayer = {
      id,
      send,
      state: spawn.state,
      spawnIndex: spawn.index,
      hp: START_HP,
      lastSeq: -1,
      lastStateAt: performance.now(),
      rejectedCount: 0,
      consecutiveRejects: 0,
    };
    this.players.set(id, player);
    return player;
  }

  remove(id: string): boolean {
    return this.players.delete(id);
  }

  get(id: string): ServerPlayer | undefined {
    return this.players.get(id);
  }

  /**
   * Uzenet minden jatekosnak, kiveve (opcionalisan) egyet -- pl. a
   * "csatlakozott" ertesitest nem kell visszakuldeni annak, aki epp
   * csatlakozott.
   */
  broadcast(message: ServerMessage, exceptId?: string): void {
    for (const player of this.players.values()) {
      if (player.id === exceptId) continue;
      player.send(message);
    }
  }

  /**
   * A snapshot MINDEN jatekost tartalmaz, a cimzettet is -- a kliens
   * sajat magat szuri ki. Igy egyetlen kozos uzenet mehet mindenkinek,
   * nem kell jatekosonkent kulon osszeallitani.
   */
  buildSnapshot(): PlayerSnapshot[] {
    const snapshot: PlayerSnapshot[] = [];
    for (const player of this.players.values()) {
      snapshot.push({
        id: player.id,
        position: player.state.position,
        rotation: player.state.rotation,
        velocity: player.state.velocity,
        steer: player.state.steer,
        susp: player.state.susp,
        grip: player.state.grip,
        brokenMask: player.state.brokenMask,
        hp: player.hp,
      });
    }
    return snapshot;
  }

  /**
   * A legelso olyan spawn-pont, amit meg senki nem foglal.
   *
   * A pontok az arena akadalyait elkerulve, kezzel vannak megadva
   * (lasd SPAWN_POINTS a config.ts-ben) -- egy szamitott kor nem
   * mukodne, mert az akadalyok nem szimmetrikusak. Kilepes utan a
   * felszabadult pont ujra kiadhato, ezert a FOGLALTSAGOT nezzuk, nem
   * a jatekosok szamat: kulonben egy kilepes-belepes utan ketten
   * kaphatnak ugyanazt a helyet.
   */
  private allocateSpawn(): { index: number; state: ClientState } {
    const taken = new Set<number>();
    for (const player of this.players.values()) taken.add(player.spawnIndex);

    let index = SPAWN_POINTS.findIndex((_, i) => !taken.has(i));
    if (index < 0) index = this.players.size % SPAWN_POINTS.length;

    const point = SPAWN_POINTS[index];
    return {
      index,
      state: { ...ORIGIN_STATE, position: [point.x, point.y, point.z] },
    };
  }
}
