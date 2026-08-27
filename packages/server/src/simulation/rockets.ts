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
  segmentBoxEntry,
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

    // A raketa a FEGYVER vonalabol indul, nem az auto kozeppontjabol:
    // igy a lovedek is a tetőn ülő csobol jon ki, ugyanugy, mint a
    // gepfegyver nyomjelzoje. Az elore-eltolas viszont nagyobb a
    // csotorkolatnal (ROCKET_SPAWN_OFFSET): a raketanak sugara van es
    // robban, tehat kozvetlenul az auto folott szuletve a lovo sajat
    // magat robbantana fel.
    //
    // DE: ez az eltolas nem vihet AKADALYON TULRA. Falhoz tolatva a
    // 3.4 m mar a falon KIVUL van, es a raketa ott szuletett meg -- a
    // palya hataran kivul, tehat a kovetkezo lepesben azonnal meg is
    // szunt, MIELOTT egyetlen snapshotba bekerult volna. A jatekos
    // szempontjabol a loves nyomtalanul eltunt: a visszatoltes elfogyott,
    // lovedeket nem latott, es a robbanas is a falon BELUL tortent, ahol
    // szinten nem latszik. (Merve: z = -61.90, a fal -60-nal.) Ezert a
    // szuletesi pontot az elso akadalyig vagjuk vissza.
    const spawn = this.safeSpawn(shooter, [dx, dy, dz]);

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
   * A raketa szuletesi pontja: elore, de akadalyon TUL soha.
   *
   * A kiindulopont a CSOTORKOLAT, ami mindig az auto sajat helyen
   * belul van -- tehat sosem eshet egy falba, amihez az auto hozzaer
   * (az auto maga sem lóghat bele). Innen haladunk elore a kivant
   * eltolasig, es ha kozben barmilyen arena-elem az utba esik, ott
   * allunk meg, kicsivel a felulete ELOTT.
   *
   * A talaj es a falak is szamitanak, nem csak az akadalyok (a repulo
   * raketanal azok kulon vannak kezelve): a szuletes ELOTT epp ezek a
   * legfontosabbak -- a palya hatarat epp a fal jelenti.
   */
  private safeSpawn(
    shooter: ClientState,
    direction: [number, number, number],
  ): [number, number, number] {
    const muzzle = muzzleWorldPosition(
      shooter.position,
      shooter.rotation,
      direction,
      "cannon",
    );
    const wanted = muzzleWorldPosition(
      shooter.position,
      shooter.rotation,
      direction,
      "cannon",
      ROCKET_SPAWN_OFFSET,
    );

    let closest = 1;
    for (const box of ARENA) {
      const t = segmentBoxEntry(
        muzzle,
        wanted,
        [box.position.x, box.position.y, box.position.z],
        [
          box.halfExtents.x + ROCKET_RADIUS,
          box.halfExtents.y + ROCKET_RADIUS,
          box.halfExtents.z + ROCKET_RADIUS,
        ],
      );
      // A 0 azt jelentene, hogy a csotorkolat MAR a dobozban van. Olyankor
      // nincs jobb hely a torkolatnal -- ugyanaz a megfontolas, mint a
      // gepfegyver hitscanjenel.
      if (t !== null && t < closest) closest = Math.max(0, t);
    }

    // Egy kicsivel a felulet elott: igy a raketa a szabadban szuletik,
    // es a kovetkezo lepesben a felulet LATHATO oldalan robban.
    const eltolas = Math.max(0, closest - 0.08);
    return [
      muzzle[0] + (wanted[0] - muzzle[0]) * eltolas,
      muzzle[1] + (wanted[1] - muzzle[1]) * eltolas,
      muzzle[2] + (wanted[2] - muzzle[2]) * eltolas,
    ];
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
      const obstacleAt = this.obstacleEntry(from, to);

      if (!hit && !expired && !outside && obstacleAt === null) continue;

      this.rockets.splice(i, 1);
      explosions.push({
        // A robbanas a BECSAPODAS pontjan tortenik, nem a lepes
        // vegpontjan.
        //
        // Korabban a vegpont volt: a rakéta egy lepesben 0.7 m-t tesz
        // meg, tehat a fal MOGOTT robbant, ahol a jatekos nem latja --
        // es ugyanez volt igaz minden akadalyra. Falhoz szorulva ez
        // adta azt, hogy a loves nyomtalanul eltunt.
        position: this.impactPoint(from, to, obstacleAt),
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
   * HOL ment neki az akadalynak a lepes soran? (0..1, vagy null.)
   *
   * Az akadalyok tengely-parhuzamosak, ezert ugyanaz a slab-teszt jo
   * rajuk, mint az autokra -- csak forgatas nelkul (egysegquaternion).
   * A korabbi verzio csak a lepes vegpontjat nezte: a legvekonyabb elem
   * (ramp_main, 0.3 m fel-vastagsag) eseten a 0.92 m-es lepes mellett ez
   * mar csak szuk tartalekkal mukodott.
   *
   * A "hol" nem reszletkerdes: a robbanas EZEN a ponton tortenik. A
   * lepes vegpontja mar az akadaly BELSEJEBEN van, ahol a jatekos nem
   * latja -- pontosan ettol tunt el nyomtalanul a falhoz szorulva
   * leadott loves.
   */
  private obstacleEntry(
    from: [number, number, number],
    to: [number, number, number],
  ): number | null {
    let closest: number | null = null;
    for (const box of OBSTACLES) {
      const t = segmentBoxEntry(
        from,
        to,
        [box.position.x, box.position.y, box.position.z],
        [
          box.halfExtents.x + ROCKET_RADIUS,
          box.halfExtents.y + ROCKET_RADIUS,
          box.halfExtents.z + ROCKET_RADIUS,
        ],
      );
      if (t !== null && (closest === null || t < closest)) closest = t;
    }
    return closest;
  }

/**
   * HOL hagyja el a palyat a lepes soran? (0..1, vagy null.)
   *
   * A falak SZANDEKOSAN nincsenek az OBSTACLES kozott (a rakéta a
   * palya hatarat lepi at, nem egy targynak megy neki), de a
   * ROBBANAS HELYE itt is szamit: a lepes vegpontja mar a falon KIVUL
   * van, ahol a jatekos nem latja. Falhoz szorulva epp ez tuntette el
   * a lovest nyomtalanul -- merve: z = -61.90, majd -60.11, a fal
   * -60-nal.
   */
  private arenaExit(
    from: [number, number, number],
    to: [number, number, number],
  ): number | null {
    let closest: number | null = null;
    const vegye = (t: number): void => {
      if (t >= 0 && t <= 1 && (closest === null || t < closest)) closest = t;
    };
    for (const tengely of [0, 2]) {
      for (const hatar of [ARENA_LIMIT, -ARENA_LIMIT]) {
        const a = from[tengely];
        const b = to[tengely];
        if (a === b) continue;
        // Csak az a metszes szamit, ahol tenylegesen KIFELE haladunk.
        if (Math.abs(b) <= ARENA_LIMIT) continue;
        vegye((hatar - a) / (b - a));
      }
    }
    // A talaj: a rakéta alulrol nem bujhat ki a palya alol.
    if (to[1] < 0 && from[1] !== to[1]) vegye((0 - from[1]) / (to[1] - from[1]));
    return closest;
  }


  /**
   * A becsapodas pontja a megtett szakaszon.
   *
   * A legkorabbi hatar szamit: akadaly VAGY a palya szele. Ha egyik sem
   * all utban (auto-talalat vagy lejarat), a lepes vegpontja a helyes --
   * ott tenylegesen odaig jutott.
   */
  private impactPoint(
    from: [number, number, number],
    to: [number, number, number],
    obstacleAt: number | null,
  ): [number, number, number] {
    const kijarat = this.arenaExit(from, to);
    const t =
      obstacleAt === null
        ? kijarat
        : kijarat === null
          ? obstacleAt
          : Math.min(obstacleAt, kijarat);
    if (t === null) return [to[0], to[1], to[2]];
    return [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    ];
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
