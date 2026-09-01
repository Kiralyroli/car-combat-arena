/**
 * Celzas-statisztika: nem a pontossag, hanem hogy MITOL NEM ROMLIK.
 *
 * A puszta talalati arany felrevezeto -- egy jo jatekos is lehet
 * tartosan 60%-os. Amit viszont ember nem tud utanozni, az az, hogy a
 * pontossaga nem fugg a nehezsegtol:
 *
 *  - TAVOLSAG szerint: embernel meredeken esik a talalati arany, botnal
 *    lapos marad.
 *  - A celpont SZOGSEBESSEGE szerint (milyen gyorsan huz el elottunk):
 *    ez az, ami az emberi kovetest igazan megtori. Botnal ez sem szamit.
 *
 * A minta a szerveren AMUGY IS eloall: minden azonnali talalatu lovest
 * itt ertekelunk ki. A gyujtes tehat gyakorlatilag ingyen van.
 *
 * MIT NEM CSINAL: nem hoz dontest, es nem buntet. Csak a szerver
 * naplojaba ir a meccs vegen. Egy alacsony mintaszamu sor semmit nem
 * bizonyit -- ezert megy ki a darabszam is, nem csak a szazalek.
 *
 * SZANDEKOSAN tiszta modul: nincs benne se szoba, se ido, se naplozas
 * -- headless tesztelheto.
 */

/** Egy sav merlege. */
export interface Bucket {
  shots: number;
  hits: number;
}

export interface AimStats {
  /** Talalati arany a CELTAVOLSAG szerint. */
  byDistance: Bucket[];
  /** Talalati arany a celpont SZOGSEBESSEGE szerint. */
  byAngularSpeed: Bucket[];
}

/**
 * Tavolsag-savok hatarai (m).
 *
 * Az arena kb. 80 m atmeroju, a gepfegyver hatotava 70 m -- a savok
 * ezt a tartomanyt osztjak fel ugy, hogy a kozeli harc (ahol mindenki
 * talal) elkulonuljon a tavolitol (ahol csak a bot).
 */
export const DISTANCE_EDGES = [10, 20, 35, 50];

/**
 * Szogsebesseg-savok hatarai (rad/s).
 *
 * Nagysagrend: egy 30 m/s-mal keresztben huzo auto 20 m-rol 1.5 rad/s,
 * 10 m-rol 3 rad/s. A felso sav tehat a "kozel, gyorsan elhuz" eset --
 * ez az, amit ember a legnehezebben kovet.
 */
export const ANGULAR_SPEED_EDGES = [0.2, 0.5, 1, 2];

function emptyBuckets(edges: readonly number[]): Bucket[] {
  return Array.from({ length: edges.length + 1 }, () => ({ shots: 0, hits: 0 }));
}

export function newAimStats(): AimStats {
  return {
    byDistance: emptyBuckets(DISTANCE_EDGES),
    byAngularSpeed: emptyBuckets(ANGULAR_SPEED_EDGES),
  };
}

/** Melyik savba esik az ertek? */
export function bucketIndex(edges: readonly number[], value: number): number {
  for (let i = 0; i < edges.length; i++) {
    if (value < edges[i]) return i;
  }
  return edges.length;
}

/**
 * Egy leadott loves konyvelese.
 *
 * @param distance      A CELZOTT jatekos tavolsaga (m).
 * @param angularSpeed  Milyen gyorsan huz el a celpont (rad/s).
 * @param hit           Talalt-e a loves.
 */
export function recordShot(
  stats: AimStats,
  distance: number,
  angularSpeed: number,
  hit: boolean,
): void {
  // Ertelmetlen minta ne rontsa el a statisztikat -- inkabb ne legyen
  // adat, mint hamis adat.
  if (!Number.isFinite(distance) || !Number.isFinite(angularSpeed)) return;

  for (const [edges, buckets, value] of [
    [DISTANCE_EDGES, stats.byDistance, distance],
    [ANGULAR_SPEED_EDGES, stats.byAngularSpeed, angularSpeed],
  ] as const) {
    const bucket = buckets[bucketIndex(edges, value)];
    bucket.shots++;
    if (hit) bucket.hits++;
  }
}

/**
 * Ezen a szogon belul tekintjuk ugy, hogy a jatekos VALAKIRE celzott
 * (radian, kb. 15 fok).
 *
 * Miert kell egyaltalan kor: mert aki a semmibe szor, az nem "melle
 * lott" -- nem is celzott. Az ilyen lovesek beszamitasa a bontott
 * sorokat felhigitana, es eppen a keresett kulonbseget mosna el.
 */
export const AIM_CONE_RAD = 0.26;

/** Egy lehetseges celpont -- csak az kell belole, ami a geometriahoz. */
export interface AimCandidate {
  state: {
    position: [number, number, number];
    velocity: [number, number, number];
  };
}

/**
 * Kire celzott a jatekos, es mennyire volt NEHEZ a loves?
 *
 * A legkisebb szogtavolsagu celpontot valasztjuk -- azt, amelyik a
 * celkereszthez a legkozelebb van --, es csak akkor, ha az AIM_CONE_RAD
 * koron belul van.
 *
 * A SZOGSEBESSEG a lenyeg: nem az szamit, milyen gyorsan megy a
 * celpont, hanem milyen gyorsan huz el A LATOMEZONKBEN. Egy tavoli,
 * gyors auto konnyebb celpont, mint egy kozeli, lassu, ha az utobbi
 * keresztben halad. Ezert osztunk a tavolsaggal, es ezert a RELATIV
 * sebesseget vesszuk: ha egyutt haladunk vele, all a celkeresztben.
 */
export function intendedTarget(
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  candidates: readonly AimCandidate[],
  shooterVelocity: readonly number[],
): { distance: number; angularSpeed: number } | null {
  let best: { distance: number; angularSpeed: number } | null = null;
  let bestAngle = AIM_CONE_RAD;

  for (const c of candidates) {
    const dx = c.state.position[0] - origin[0];
    const dy = c.state.position[1] - origin[1];
    const dz = c.state.position[2] - origin[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) continue;

    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;
    const dot = ux * direction[0] + uy * direction[1] + uz * direction[2];
    const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
    if (angle >= bestAngle) continue;

    const vx = c.state.velocity[0] - shooterVelocity[0];
    const vy = c.state.velocity[1] - shooterVelocity[1];
    const vz = c.state.velocity[2] - shooterVelocity[2];
    // A latoirannyal PARHUZAMOS resz nem forgatja a celkeresztet
    // (kozeledik vagy tavolodik), csak a meroleges.
    const along = vx * ux + vy * uy + vz * uz;
    const perp = Math.hypot(vx - along * ux, vy - along * uy, vz - along * uz);

    bestAngle = angle;
    best = { distance: len, angularSpeed: perp / len };
  }

  return best;
}

/** Osszes minta -- ebbol latszik, van-e ertelme egyaltalan ranezni. */
export function totalShots(stats: AimStats): number {
  return stats.byDistance.reduce((sum, b) => sum + b.shots, 0);
}

function bucketLabel(
  edges: readonly number[],
  i: number,
  unit: string,
): string {
  if (i === 0) return `<${edges[0]}${unit}`;
  if (i === edges.length) return `${edges[edges.length - 1]}${unit}+`;
  return `${edges[i - 1]}-${edges[i]}${unit}`;
}

function line(
  edges: readonly number[],
  buckets: readonly Bucket[],
  unit: string,
): string {
  return buckets
    .map((b, i) => {
      const label = bucketLabel(edges, i, unit);
      // A DARABSZAM is kimegy, nem csak a szazalek: harom lovesbol
      // szamolt 100% semmit nem jelent, es e nelkul ugy nezne ki,
      // mintha jelentene.
      if (b.shots === 0) return `${label}: -`;
      return `${label}: ${Math.round((100 * b.hits) / b.shots)}% (${b.shots})`;
    })
    .join("  ");
}

/**
 * Ket sor, emberi olvasasra.
 *
 * Amit keresunk: LAPOS sorokat. Ha a talalati arany a tavolsaggal es a
 * celpont szogsebessegevel sem romlik, az nem emberi teljesitmeny-gorbe.
 */
export function formatAimStats(stats: AimStats): string[] {
  return [
    `  tavolsag:    ${line(DISTANCE_EDGES, stats.byDistance, "m")}`,
    `  szogsebesseg:${line(ANGULAR_SPEED_EDGES, stats.byAngularSpeed, "r/s")}`,
  ];
}
