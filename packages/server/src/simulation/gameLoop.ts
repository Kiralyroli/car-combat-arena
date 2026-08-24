import { FIXED_DT, SNAPSHOT_HZ } from "@cca/shared";
import type { RoomManager } from "../rooms/roomManager";

/**
 * Szerver game loop.
 *
 * Harom, egymastol FUGGETLEN rata (terv 15.3) -- itt kettő jelenik meg:
 *  - szimulacios tick: fix 60 Hz (FIXED_DT), ugyanaz, mint a kliensen
 *  - halozati snapshot: 20 Hz, tehat minden N. tickben megy ki
 *
 * Miert kell fix 60 Hz-es tick akkor is, ha a szerver EGYELORE nem
 * szimulal jarmuvet? Mert a hibrid modellben (15.4) a szerver fogja
 * szamolni az utkozes-kiertekelest, sebzest es a pickupokat -- azok
 * determinisztikus, fix lepeskozu tickben kell hogy fussanak. Ha ezt
 * utolag vezetnenk be, az egesz idozitest ujra kellene irni.
 *
 * A `setInterval` sodrodasat (drift) egy akkumulatorral kezeljuk:
 * ha egy tick keslekedik, a kovetkezo korben tobb tick fut le --
 * ugyanaz a mintazat, mint a kliens fo ciklusaban.
 */

/** Hany szimulacios tick jut egy halozati snapshotra (60 / 20 = 3). */
const TICKS_PER_SNAPSHOT = Math.max(1, Math.round(1 / FIXED_DT / SNAPSHOT_HZ));

/** Spiral-vedelem: egy korben legfeljebb ennyi tickt hozunk be. */
const MAX_TICKS_PER_ROUND = 5;

export class GameLoop {
  private readonly rooms: RoomManager;
  private timer: NodeJS.Timeout | null = null;
  private accumulator = 0;
  private lastTime = 0;
  private tick = 0;

  constructor(rooms: RoomManager) {
    this.rooms = rooms;
  }

  start(): void {
    if (this.timer) return;
    this.lastTime = performance.now();
    // Kicsit surubben ebredunk, mint a tick-rata, hogy az akkumulator
    // egyenletesen tudjon dolgozni.
    this.timer = setInterval(() => this.update(), (FIXED_DT * 1000) / 2);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private update(): void {
    const now = performance.now();
    const elapsed = Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;
    this.accumulator += elapsed;

    let ticks = 0;
    while (this.accumulator >= FIXED_DT && ticks < MAX_TICKS_PER_ROUND) {
      this.accumulator -= FIXED_DT;
      ticks++;
      this.tick++;

      // Utkozes-kiertekeles es sebzes -- a szerver donti el (terv 15.4).
      // Fix lepeskozu tickben fut, hogy determinisztikus legyen.
      for (const room of this.rooms.all()) {
        if (room.playerCount > 1) room.resolveCollisions(now);
        // A rakétak leptetese ITT tortenik, a fix lepeskozu tickben --
        // a lovedek palyaja igy fuggetlen a szerver terheltsegetol.
        room.stepRockets(FIXED_DT, now);
        // A pozicio-elozmenyt a tuzeles ELOTT rogzitjuk: az azonnali
        // talalatu fegyver ebbol tekeri vissza a celpontokat.
        room.recordPoses(now);
        room.stepWeapons(FIXED_DT, now, this.tick);
        room.updateRespawnPlans();
        room.respawnExpired(now);
        room.collectPickups(now);
        room.stepMatch(now);
      }

      // Ide kerul majd: lovedekek leptetese, pickupok, meccs-allapot.

      if (this.tick % TICKS_PER_SNAPSHOT === 0) {
        this.broadcastSnapshots(now);
      }
    }

    if (ticks === MAX_TICKS_PER_ROUND) {
      // Ne halmozodjon a lemaradas, kulonben spiralba menne.
      this.accumulator = 0;
    }
  }

  private broadcastSnapshots(now: number): void {
    for (const room of this.rooms.all()) {
      if (room.isEmpty) continue;
      room.broadcast({
        type: "snapshot",
        tick: this.tick,
        time: now,
        players: room.buildSnapshot(now),
        rockets: room.rockets.toSnapshot(),
        tracers: room.drainTracers(),
        pickupsAvailable: room.pickupsAvailable(now),
        match: room.matchSnapshot(now),
      });
    }
  }
}
