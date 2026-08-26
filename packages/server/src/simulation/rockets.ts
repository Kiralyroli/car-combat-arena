import {
  ARENA,
  EXPLOSION_MAX_DAMAGE,
  EXPLOSION_RADIUS,
  explosionFalloff,
  ROCKET_DIRECT_DAMAGE,
  ROCKET_LIFETIME_MS,
  ROCKET_RADIUS,
  ROCKET_SPAWN_OFFSET,
  ROCKET_SPEED,
  muzzleWorldPosition,
  weaponPivot,
  rocketHitsCar,
  segmentHitsBox,
  type ClientState,
  type RocketSnapshot,
} from "@cca/shared";

/**
 * A szerver altal szimulalt rakétak egy szobaban (terv 4. lepcso 3.).
 *
 * A lovedeket VEGIG a szerver lepteti: a kliens csak kiloves-kerest
 * kuld, es a snapshotbol rajzolja a repulo rakétat. Igy a talalat
 * kizarolag a szerveren dol el (terv 15.4) -- egy modositott kliens sem
 * allithatja, hogy eltalalt valakit.
 */

export interface Rocket {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spawnedAt: number;
}

/** Egy robbanas, amit a szoba kikuld a klienseknek. */
export interface Explosion {
  position: [number, number, number];
  ownerId: string;
  /** Kit talalt el kozvetlenul (a tobbi csak a robbanast kapja). */
  directHitId: string | null;
}

/** A palya hatarai a talaj-elembol -- nem masolt konstans. */
const ARENA_LIMIT =
  ARENA.find((box) => box.name === "ground")?.halfExtents.x ?? 40;

/**
 * Az akadalyok, amikbe a rakéta becsapodhat. A talaj es a falak kulon
 * kezelendok (a rakéta felettuk repul, illetve nekik utkozik).
 */
const OBSTACLES = ARENA.filter(
  (box) => box.name !== "ground" && !box.name.startsWith("wall_"),
);

export class RocketSimulation {
  private readonly rockets: Rocket[] = [];
  private nextId = 1;

  get count(): number {
    return this.rockets.length;
  }

  /**
   * Uj rakéta a jatekos allapotabol es a megcelzott pontbol.
   *
   * A KIINDULOPONTOT a szerver hatarozza meg (a jatekos hiteles
   * pozicioja), a celpontot a kliens adja -- eger-celzasnal a szerver
   * nem tudhatja, hova mutatott a jatekos. Lasd FireMessage.
   */
  spawn(
    ownerId: string,
    shooter: ClientState,
    target: [number, number, number],
    now: number,
  ): Rocket | null {
    // Az IRANY a FEGYVER forgaspontja es a celzott pont kozott all elo
    // -- a kliens csak a celpontot adja. A forgaspont (nem az auto
    // kozeppontja) azert kell, mert a lovedek is onnan indul: kulonben a
    // ket egyenes parhuzamos lenne, es a raketa a celpont folott menne el.
    const pivot = weaponPivot(shooter.position, shooter.rotation, "cannon");
    let dx = target[0] - pivot[0];
    let dy = target[1] - pivot[1];
    let dz = target[2] - pivot[2];
    const distance = Math.hypot(dx, dy, dz);

    // Ertelmetlen celzas (sajat magara, vagy hibas adat) eseten nem
    // lovunk -- egy nulla hosszu irany NaN-t vinne a szimulacioba.
    if (!Number.isFinite(distance) || distance < 0.5) return null;

    dx /= distance;
    dy /= distance;
    dz /= distance;

    // A FEGYVER vonalabol indul, nem az auto kozeppontjabol: igy a
    // raketa is a tetőn ülő vetőből jon ki, ugyanugy, mint a gepfegyver
    // nyomjelzoje. Az elore-eltolas viszont nagyobb marad a
    // csotorkolatnal (ROCKET_SPAWN_OFFSET): a raketanak sugara van es
    // robban, tehat kozvetlenul az auto folott szuletve egy falhoz
    // szorult jatekos sajat magat robbantana fel.
    const spawn = muzzleWorldPosition(
      shooter.position,
      shooter.rotation,
      [dx, dy, dz],
      "cannon",
      ROCKET_SPAWN_OFFSET,
    );

    const rocket: Rocket = {
      id: this.nextId++,
      ownerId,
      x: spawn[0],
      y: spawn[1],
      z: spawn[2],
      // A kilovo auto sebessege HOZZAADODIK: kulonben a sajat rakétank
      // "leszakadna" rolunk, ha gyorsabban megyunk, mint a lovedek.
      vx: shooter.velocity[0] + dx * ROCKET_SPEED,
      vy: shooter.velocity[1] + dy * ROCKET_SPEED,
      vz: shooter.velocity[2] + dz * ROCKET_SPEED,
      spawnedAt: now,
    };
    this.rockets.push(rocket);
    return rocket;
  }

  /**
   * Egy fizikai lepes: mozgatas, utkozes-vizsgalat, lejarat.
   *
   * @param targets A lehetseges celpontok (elo jatekosok allapota).
   * @returns A most bekovetkezett robbanasok.
   */
  step(
    dt: number,
    now: number,
    targets: { id: string; state: ClientState }[],
  ): Explosion[] {
    const explosions: Explosion[] = [];

    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const rocket = this.rockets[i];

      // A lepes ELOTTI pontot megjegyezzuk: a talalat-vizsgalat a teljes
      // megtett szakaszra megy, nem csak a vegpontra (lasd rocketHitsCar).
      const from: [number, number, number] = [rocket.x, rocket.y, rocket.z];

      rocket.x += rocket.vx * dt;
      rocket.y += rocket.vy * dt;
      rocket.z += rocket.vz * dt;

      const to: [number, number, number] = [rocket.x, rocket.y, rocket.z];

      const hit = this.findHit(rocket, from, to, targets);
      const expired = now - rocket.spawnedAt > ROCKET_LIFETIME_MS;
      const outside =
        Math.abs(rocket.x) > ARENA_LIMIT ||
        Math.abs(rocket.z) > ARENA_LIMIT ||
        rocket.y < 0;

      if (!hit && !expired && !outside && !this.hitsObstacle(from, to)) continue;

      this.rockets.splice(i, 1);
      explosions.push({
        position: [rocket.x, rocket.y, rocket.z],
        ownerId: rocket.ownerId,
        directHitId: hit,
      });
    }

    return explosions;
  }

  /** Melyik jatekost talalta el kozvetlenul (vagy null). */
  private findHit(
    rocket: Rocket,
    from: [number, number, number],
    to: [number, number, number],
    targets: { id: string; state: ClientState }[],
  ): string | null {
    for (const target of targets) {
      // A sajat rakétank nem talal el minket: kilovesnel az auto orra
      // elott szuletik, de egy eles kanyarban utolerhetne magat.
      if (target.id === rocket.ownerId) continue;

      // Valodi (elforgatott) doboz, a teljes megtett szakaszra vizsgalva.
      if (
        rocketHitsCar(from, to, target.state.position, target.state.rotation)
      ) {
        return target.id;
      }
    }
    return null;
  }

  /**
   * Nekiment-e az akadalynak a lepes SORAN?
   *
   * Az akadalyok tengely-parhuzamosak, ezert ugyanaz a slab-teszt jo
   * rajuk, mint az autokra -- csak forgatas nelkul (egysegquaternion).
   * A korabbi verzio csak a lepes vegpontjat nezte: a legvekonyabb elem
   * (ramp_main, 0.3 m fel-vastagsag) eseten a 0.92 m-es lepes mellett ez
   * mar csak szuk tartalekkal mukodott.
   */
  private hitsObstacle(
    from: [number, number, number],
    to: [number, number, number],
  ): boolean {
    for (const box of OBSTACLES) {
      if (
        segmentHitsBox(
          from,
          to,
          [box.position.x, box.position.y, box.position.z],
          [
            box.halfExtents.x + ROCKET_RADIUS,
            box.halfExtents.y + ROCKET_RADIUS,
            box.halfExtents.z + ROCKET_RADIUS,
          ],
        )
      ) {
        return true;
      }
    }
    return false;
  }

  /** Az osszes rakéta a halozati snapshothoz. */
  toSnapshot(): RocketSnapshot[] {
    return this.rockets.map((r) => {
      const speed = Math.hypot(r.vx, r.vy, r.vz) || 1;
      return {
        id: r.id,
        ownerId: r.ownerId,
        position: [r.x, r.y, r.z] as [number, number, number],
        direction: [r.vx / speed, r.vy / speed, r.vz / speed] as [
          number,
          number,
          number,
        ],
      };
    });
  }

  /** Egy jatekos osszes rakétaja eltunik (kilepes, megsemmisules). */
  removeOwnedBy(ownerId: string): void {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      if (this.rockets[i].ownerId === ownerId) this.rockets.splice(i, 1);
    }
  }
}

/**
 * Mennyi sebzest kap egy jatekos egy robbanastol.
 *
 * A kozvetlen talalat kulon sebzest ad a robbanas fole -- igy a pontos
 * celzas jobban jar, mint a "kore lovok".
 */
export function explosionDamageFor(
  explosion: Explosion,
  playerId: string,
  state: ClientState,
): number {
  const distance = Math.hypot(
    state.position[0] - explosion.position[0],
    state.position[1] - explosion.position[1],
    state.position[2] - explosion.position[2],
  );
  if (distance >= EXPLOSION_RADIUS) return 0;

  let damage = EXPLOSION_MAX_DAMAGE * explosionFalloff(distance);
  if (explosion.directHitId === playerId) damage += ROCKET_DIRECT_DAMAGE;
  return Math.round(damage);
}
