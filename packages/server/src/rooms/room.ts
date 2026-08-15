import { RocketSimulation, explosionDamageFor } from "../simulation/rockets";
import {
  carsOverlap,
  IMPACT_COOLDOWN_MS,
  RESPAWN_DELAY_MS,
  ROCKET_COOLDOWN_MS,
  splitCollisionDamage,
  brokenMaskOf,
  damageWheel,
  gripsOf,
  healthyWheels,
  wheelExplosionDamage,
  wheelWorldPosition,
  MAX_HP,
  SPAWN_POINTS,
  type ClientState,
  type PlayerSnapshot,
  type ServerMessage,
  type WheelDamage,
} from "@cca/shared";

/** Terv 3. fejezet: minimum 2, idealis 4--8 jatekos. */
export const MAX_PLAYERS_PER_ROOM = 8;

/** Kezdo HP. A sebzes-rendszer a 4. lepcsoben jon (terv 8. fejezet). */
const START_HP = MAX_HP;

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
  /**
   * Kerekenkenti serules -- a SZERVER birtokolja (terv 4.6).
   * Sorrend: FL, FR, RL, RR (= WHEEL_LAYOUT).
   */
  wheels: WheelDamage[];
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
  /** Mikor lott utoljara rakétat (performance.now) -- lasd ROCKET_COOLDOWN_MS. */
  lastFiredAt: number;
  /**
   * Mikor semmisult meg (performance.now), vagy null, ha el.
   * A HP onmagaban nem eleg: az ujraszuletes pillanataban tudni kell,
   * mikor jart le a varakozas.
   */
  deadSince: number | null;
}

/** Rendezett parkulcs, hogy (a,b) es (b,a) ugyanaz legyen. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const ORIGIN_STATE: ClientState = {
  position: [0, 2.5, 0],
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0],
  steer: 0,
  susp: [0, 0, 0, 0],
  aimYaw: 0,
  aimPitch: 0,
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
      wheels: healthyWheels(),
      lastSeq: -1,
      lastStateAt: performance.now(),
      rejectedCount: 0,
      consecutiveRejects: 0,
      lastFiredAt: 0,
      deadSince: null,
    };
    this.players.set(id, player);
    return player;
  }

  remove(id: string): boolean {
    // Az utkozes-hutesek kozul a hozza tartozokat is eldobjuk, kulonben
    // a map hosszu uzemidon at folyamatosan nőne.
    for (const key of this.lastImpactAt.keys()) {
      if (key.includes(id)) this.lastImpactAt.delete(key);
    }
    // A mar uton levo rakétai is eltunnek: kulonben gazdatlanul
    // repulnenek tovabb, es meg sebeznenek is valakit.
    this.rockets.removeOwnedBy(id);
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
   * Utkozesek kiertekelese es sebzes (terv 4. lepcso 2. pont).
   *
   * A szerver SAJAT MAGA vizsgalja meg, hogy ket auto osszeert-e -- nem
   * fogad el "eltalaltak" bejelentest a klienstol (terv 15.4: a sebzest
   * kizarolag a szerver szamolja). Az alapadat a mar plauzibilitas-
   * ellenorzott pozicio es sebesseg.
   *
   * Mindket auto ugyanannyi sebzest kap: a body HP ebben a lepcsoben
   * meg szandekosan egyszeru es NEM iranyfuggo (terv 4. lepcso 1. pont).
   */
  resolveCollisions(now: number): void {
    const players = [...this.players.values()];

    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i];
        const b = players[j];
        // Megsemmisult auto nem sebez es nem sebzodik: a roncs nincs
        // jelen a palyan (a kliensek is elrejtik).
        if (a.deadSince !== null || b.deadSince !== null) continue;

        const key = pairKey(a.id, b.id);
        const lastImpact = this.lastImpactAt.get(key) ?? 0;
        if (now - lastImpact < IMPACT_COOLDOWN_MS) continue;

        if (!carsOverlap(a.state, b.state)) continue;

        // Aki nekiment a masiknak, kevesebbet kap -- lasd splitCollisionDamage.
        const damage = splitCollisionDamage(a.state, b.state);
        if (damage.a <= 0 && damage.b <= 0) continue;

        a.hp = Math.max(0, a.hp - damage.a);
        b.hp = Math.max(0, b.hp - damage.b);
        this.lastImpactAt.set(key, now);

        console.log(
          `[room ${this.code}] utkozes: ${a.id.slice(0, 8)} -${damage.a} HP (${a.hp}) <-> ` +
            `${b.id.slice(0, 8)} -${damage.b} HP (${b.hp})`,
        );

        this.markDeadIfDestroyed(a, now);
        this.markDeadIfDestroyed(b, now);
      }
    }
  }

  /**
   * Parokent az utolso sebzo utkozes ideje -- lasd IMPACT_COOLDOWN_MS.
   * Kilepeskor takaritjuk, kulonben idovel nőne a memoriaban.
   */
  private readonly lastImpactAt = new Map<string, number>();

  private markDeadIfDestroyed(player: ServerPlayer, now: number): void {
    if (player.hp > 0 || player.deadSince !== null) return;
    player.deadSince = now;
    console.log(`[room ${this.code}] ${player.id.slice(0, 8)} megsemmisult`);
  }

  /**
   * Lejart varakozasu jatekosok ujraszuletese.
   *
   * A szerver nem tudja "athelyezni" a kliens autojat -- a hibrid
   * modellben a kliens birtokolja a sajat mozgasat --, ezert MEGKERI ra
   * egy `respawn` uzenettel, es a sajat oldalan is odaallitja az
   * allapotot. Igy a ket oldal nem csuszik szet, es a kliens kovetkezo
   * allapota mar a spawn-pontrol jon (amit a plauzibilitas-ellenorzes
   * ervenyesnek fogad el).
   */
  respawnExpired(now: number): void {
    for (const player of this.players.values()) {
      if (player.deadSince === null) continue;
      if (now - player.deadSince < RESPAWN_DELAY_MS) continue;

      const spawn = this.allocateSpawn();
      player.spawnIndex = spawn.index;
      player.state = spawn.state;
      player.hp = MAX_HP;
      // Uj auto, uj esely: a kerekek is javulnak.
      player.wheels = healthyWheels();
      player.deadSince = null;
      // Az ujraszuletes nagy ugras: ne szamitson teleportnak a kovetkezo
      // ellenorzesnel sem, es a hutes se hozza magaval a regi parokat.
      player.consecutiveRejects = 0;

      player.send({ type: "respawn", position: spawn.state.position });
      console.log(
        `[room ${this.code}] ${player.id.slice(0, 8)} ujraszuletett (spawn ${spawn.index})`,
      );
    }
  }

  /**
   * Egy robbanas hatasa a jatekos NEGY KEREKERE, kulon-kulon.
   *
   * Miert kerekenkent, es nem egyetlen tavolsaggal az auto
   * kozeppontjatol: az auto 4.9 m hosszu, a robbanas hatosugara 7 m --
   * az orr elott felrobbano rakéta igy az elso kerekeket viszi le, a
   * hatsokat alig karositja. Ez lathato es taktikailag ertelmes
   * kulonbseg; kozeppontbol szamolva mind a negy kerek egyszerre tornek
   * le, ami a jatekosnak veletlenszerunek tunne.
   */
  private damageWheelsFrom(
    position: readonly number[],
    player: ServerPlayer,
  ): void {
    for (let i = 0; i < player.wheels.length; i++) {
      if (player.wheels[i].broken) continue;

      const wheel = wheelWorldPosition(
        player.state.position,
        player.state.rotation,
        i,
      );
      const distance = Math.hypot(
        wheel[0] - position[0],
        wheel[1] - position[1],
        wheel[2] - position[2],
      );

      const amount = wheelExplosionDamage(distance);
      if (amount <= 0) continue;

      const before = player.wheels[i];
      player.wheels[i] = damageWheel(before, amount);
      if (!before.broken && player.wheels[i].broken) {
        console.log(
          `[room ${this.code}] ${player.id.slice(0, 8)} ${i}. kereke letort`,
        );
      }
    }
  }

  /** El-e a jatekos (a kliens allapot-frissiteseinek szureshez). */
  isAlive(id: string): boolean {
    const player = this.players.get(id);
    return player !== undefined && player.deadSince === null;
  }

  // --- Rakétak (terv 4. lepcso 3. pont) ---

  readonly rockets = new RocketSimulation();

  /**
   * Kiloves-keres feldolgozasa.
   *
   * A szerver ellenorzi a hutest es azt, hogy a jatekos el -- a kliens
   * sem az iranyt, sem a poziciot nem adhatja meg (lasd FireMessage).
   */
  tryFire(id: string, target: [number, number, number], now: number): boolean {
    const player = this.players.get(id);
    if (!player || player.deadSince !== null) return false;
    if (now - player.lastFiredAt < ROCKET_COOLDOWN_MS) return false;
    // Hibas celpont (NaN, vegtelen) ne jusson a szimulacioba.
    if (!target.every((v) => Number.isFinite(v))) return false;

    const rocket = this.rockets.spawn(id, player.state, target, now);
    if (!rocket) return false;

    player.lastFiredAt = now;
    return true;
  }

  /**
   * Rakétak leptetese, es a robbanasok kiertekelese.
   *
   * A sebzest ITT alkalmazzuk (a szerver dolga), a LOKEST viszont a
   * kliensek szamoljak a sajat autojukra -- ezert megy ki minden
   * robbanas esemenykent is.
   */
  stepRockets(dt: number, now: number): void {
    const targets = [...this.players.values()]
      .filter((p) => p.deadSince === null)
      .map((p) => ({ id: p.id, state: p.state }));

    for (const explosion of this.rockets.step(dt, now, targets)) {
      for (const player of this.players.values()) {
        if (player.deadSince !== null) continue;
        // A KEREKEK kulon sebzodnek, kerekenkenti tavolsag szerint
        // (terv 4.6). Ezt a body-sebzes ELOTT vegezzuk el, hogy a
        // megsemmisulessel egy tickben letort kerek is bekeruljon az
        // utolso snapshotba -- kulonben a roncs ep kerekekkel allna meg.
        this.damageWheelsFrom(explosion.position, player);

        const damage = explosionDamageFor(explosion, player.id, player.state);
        if (damage <= 0) continue;

        player.hp = Math.max(0, player.hp - damage);
        console.log(
          `[room ${this.code}] robbanas: ${player.id.slice(0, 8)} -${damage} HP (${player.hp})`,
        );
        this.markDeadIfDestroyed(player, now);
      }

      this.broadcast({
        type: "explosion",
        position: explosion.position,
        ownerId: explosion.ownerId,
      });
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
        grip: gripsOf(player.wheels),
        brokenMask: brokenMaskOf(player.wheels),
        aimYaw: player.state.aimYaw,
        aimPitch: player.state.aimPitch,
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
