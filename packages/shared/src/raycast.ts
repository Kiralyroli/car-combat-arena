/**
 * Sugar-metszes HAROMSZOG-HALOVAL, gyorsitó fastruktúraval (BVH).
 *
 * MIERT KELL: a loves eddig tengely-parhuzamos DOBOZOKKAL szamolt. A
 * doboz viszont nem tud lyukas lenni -- ha egy epuleten nyilas van, a
 * jatekos latja, de nem tud atlonni rajta, mert a doboz eltakarja. A
 * haromszog-halo pont az, amit a jatekos lat.
 *
 * MIERT ITT, a kozos csomagban: ez tiszta szamtan, Three.js es Rapier
 * nelkul. Igy a SZERVER is hasznalhatja (o donti el a talalatot), es
 * Node alatt merheto -- lasd check:raycast.
 *
 * A BVH ket okbol kell. A palya 25 ezer haromszogbol all; naivan
 * vegigmenni rajtuk minden lovesnel (es minden lag-kompenzacios
 * visszatekeresnel) nagysagrendekkel dragabb lenne. A fa ezt
 * logaritmikussa teszi.
 */

/** Haromszog-halo: csucsok x/y/z harmasokban, plusz haromszog-indexek. */
export interface Trimesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

/**
 * Felepitett gyorsitó fa.
 *
 * LAPOS TOMBOKBEN, nem objektum-fakent: egy 25 ezer haromszogos palyanal
 * az objektum-fa tobb tizezer apro objektumot jelentene, es a
 * bejarasnal minden lepes egy mutato-koveto ugras lenne. Igy a
 * szamok egymas mellett vannak a memoriaban.
 */
export interface BVH {
  /** Csomoponti hatarolo dobozok: 6 szam csomopontonkent. */
  bounds: Float32Array;
  /**
   * Csomopontonkent 2 szam.
   *
   * Belso csomopont: [jobb gyerek indexe, -1].
   * Level: [az elso haromszog helye, a haromszogek szama].
   *
   * A BAL gyerek mindig a kovetkezo csomopont -- azt nem kell tarolni.
   */
  nodes: Int32Array;
  /** A haromszogek sorrendje (a fa atrendezi oket). */
  order: Uint32Array;
  mesh: Trimesh;
  /** Csomopontok szama -- diagnosztikahoz es teszthez. */
  nodeCount: number;
}

/** Ennyi haromszog alatt mar nem vagunk tovabb. */
const LEVEL_MERET = 4;

/**
 * BVH epitese egy haromszog-halora.
 *
 * A vagas a legszelesebb tengely menten, a haromszog-kozeppontok
 * MEDIANJANAL. Nem a legjobb heurisztika (a SAH jobb fat ad), de
 * egyszeru, gyorsan epul, es a mi meretunknel a kulonbseg nem szamit --
 * merve a palya fajanak felepitese 25 ezer haromszogre nehany tized
 * masodperc, ami a szerver indulasakor egyszer fut le.
 */
export function buildBVH(mesh: Trimesh): BVH {
  const haromszogek = mesh.indices.length / 3;
  const order = new Uint32Array(haromszogek);
  for (let i = 0; i < haromszogek; i++) order[i] = i;

  // Haromszogenkent a hatarolo doboz es a kozeppont: a vagas ezekkel
  // dolgozik, es kar lenne minden lepesben ujraszamolni.
  const tmin = new Float32Array(haromszogek * 3);
  const tmax = new Float32Array(haromszogek * 3);
  const kozep = new Float32Array(haromszogek * 3);
  for (let t = 0; t < haromszogek; t++) {
    for (let k = 0; k < 3; k++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let v = 0; v < 3; v++) {
        const ertek = mesh.vertices[mesh.indices[t * 3 + v] * 3 + k];
        if (ertek < lo) lo = ertek;
        if (ertek > hi) hi = ertek;
      }
      tmin[t * 3 + k] = lo;
      tmax[t * 3 + k] = hi;
      kozep[t * 3 + k] = (lo + hi) / 2;
    }
  }

  // A csomopontok szama elore nem ismert.
  //
  // A LEVEL_MERET alapjan becsulni HIBA: egy 5 haromszogos csomopont
  // 2 + 3-ra vagodik, tehat a levelek akar ketelemuek is lehetnek --
  // vagyis a levelek szama n/2-ig mehet, a csomopontoke n-ig.
  //
  // Ez tenylegesen megtortent: az elso valtozat n/2-re becsult, es a
  // tulcsordulo irasok CSENDBEN eldobodtak (a tipizalt tomb nem hibaz).
  // A fa nem szallt el, csak nehany csomopont hatarolo doboza nulla
  // maradt -- es a mogottuk levo haromszogeket egyetlen loves sem
  // talalta el. Merve: 400 veletlen sugarbol 51 tevedett.
  const maxCsomopont = 2 * haromszogek + 1;
  const bounds = new Float32Array(maxCsomopont * 6);
  const nodes = new Int32Array(maxCsomopont * 2);
  let csomopontDb = 0;

  // Rekurzio helyett SAJAT VEREM: 25 ezer haromszognel a rekurzio
  // melysege meg belefér, de a verem mérhető és nem tud tulcsordulni.
  const verem: number[][] = [[0, haromszogek, -1]];
  while (verem.length > 0) {
    const [kezd, veg, szuloJobbHely] = verem.pop() as number[];
    const sajat = csomopontDb++;
    // Or a becsles ellen: inkabb szalljon el hangosan, mint hogy
    // csendben rossz fat epitsen.
    if (sajat >= maxCsomopont) {
      throw new Error(
        `BVH: tobb csomopont kell (${sajat} >= ${maxCsomopont}, ${haromszogek} haromszog)`,
      );
    }

    // A csomopont hatarolo doboza.
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    for (let i = kezd; i < veg; i++) {
      const t = order[i];
      if (tmin[t * 3] < x0) x0 = tmin[t * 3];
      if (tmin[t * 3 + 1] < y0) y0 = tmin[t * 3 + 1];
      if (tmin[t * 3 + 2] < z0) z0 = tmin[t * 3 + 2];
      if (tmax[t * 3] > x1) x1 = tmax[t * 3];
      if (tmax[t * 3 + 1] > y1) y1 = tmax[t * 3 + 1];
      if (tmax[t * 3 + 2] > z1) z1 = tmax[t * 3 + 2];
    }
    bounds[sajat * 6] = x0;
    bounds[sajat * 6 + 1] = y0;
    bounds[sajat * 6 + 2] = z0;
    bounds[sajat * 6 + 3] = x1;
    bounds[sajat * 6 + 4] = y1;
    bounds[sajat * 6 + 5] = z1;

    // A szulo most tudja meg, hova kerult a JOBB gyereke.
    if (szuloJobbHely >= 0) nodes[szuloJobbHely] = sajat;

    const db = veg - kezd;
    if (db <= LEVEL_MERET) {
      nodes[sajat * 2] = kezd;
      nodes[sajat * 2 + 1] = db;
      continue;
    }

    // A LEGSZELESEBB tengely menten vagunk: igy lesznek a gyerekek
    // hataroló dobozai a leginkabb kulonvalok.
    const szelesseg = [x1 - x0, y1 - y0, z1 - z0];
    let tengely = 0;
    if (szelesseg[1] > szelesseg[tengely]) tengely = 1;
    if (szelesseg[2] > szelesseg[tengely]) tengely = 2;

    const szelet = order.subarray(kezd, veg);
    const rendezett = Array.from(szelet).sort(
      (a, b) => kozep[a * 3 + tengely] - kozep[b * 3 + tengely],
    );
    szelet.set(rendezett);
    const kozepe = kezd + (db >> 1);

    nodes[sajat * 2 + 1] = -1;
    // A BAL gyerek a kovetkezo csomopont lesz, tehat utoljara kerul a
    // veremre (LIFO). A jobb a helyet a sajat epitesekor irja be.
    verem.push([kozepe, veg, sajat * 2]);
    verem.push([kezd, kozepe, -1]);
  }

  return { bounds, nodes, order, mesh, nodeCount: csomopontDb };
}

/** Metszi-e a szakasz a hatarolo dobozt (felfujva `sugar`-ral)? */
function dobozMetszes(
  bounds: Float32Array,
  csomopont: number,
  from: readonly number[],
  irany: readonly number[],
  maxT: number,
  sugar: number,
): boolean {
  let t0 = 0;
  let t1 = maxT;
  for (let k = 0; k < 3; k++) {
    const lo = bounds[csomopont * 6 + k] - sugar;
    const hi = bounds[csomopont * 6 + 3 + k] + sugar;
    const d = irany[k];
    if (Math.abs(d) < 1e-12) {
      if (from[k] < lo || from[k] > hi) return false;
      continue;
    }
    let a = (lo - from[k]) / d;
    let b = (hi - from[k]) / d;
    if (a > b) {
      const csere = a;
      a = b;
      b = csere;
    }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Szakasz-haromszog metszes (Möller-Trumbore).
 *
 * @returns a metszes parametere [0,1]-ben, vagy null
 */
function haromszogMetszes(
  from: readonly number[],
  irany: readonly number[],
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  maxT: number,
): number | null {
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;

  const px = irany[1] * e2z - irany[2] * e2y;
  const py = irany[2] * e2x - irany[0] * e2z;
  const pz = irany[0] * e2y - irany[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  // KETOLDALAS metszes: az epulet-modellek lapjainak iranyitasa nem
  // megbizhato (importalt keszlet), es egy "csak kivulrol talal"
  // szabalynal a belulrol jovo loves atmenne a falon.
  if (Math.abs(det) < 1e-12) return null;

  const inv = 1 / det;
  const tx = from[0] - ax;
  const ty = from[1] - ay;
  const tz = from[2] - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return null;

  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (irany[0] * qx + irany[1] * qy + irany[2] * qz) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;

  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  if (t < 0 || t > maxT) return null;
  return t;
}

/** Ket szakasz legkisebb tavolsaganak negyzete. */
function szakaszTavSq(
  p0: readonly number[], p1: readonly number[],
  q0: readonly number[], q1: readonly number[],
): number {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  const ex = q1[0] - q0[0], ey = q1[1] - q0[1], ez = q1[2] - q0[2];
  const rx = p0[0] - q0[0], ry = p0[1] - q0[1], rz = p0[2] - q0[2];
  const a = dx * dx + dy * dy + dz * dz;
  const e = ex * ex + ey * ey + ez * ez;
  const f = ex * rx + ey * ry + ez * rz;
  let s = 0;
  let t = 0;
  if (a <= 1e-12 && e <= 1e-12) {
    return rx * rx + ry * ry + rz * rz;
  }
  if (a <= 1e-12) {
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = dx * rx + dy * ry + dz * rz;
    if (e <= 1e-12) {
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = dx * ex + dy * ey + dz * ez;
      const denom = a * e - b * b;
      s = denom > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const cx = p0[0] + dx * s - (q0[0] + ex * t);
  const cy = p0[1] + dy * s - (q0[1] + ey * t);
  const cz = p0[2] + dz * s - (q0[2] + ez * t);
  return cx * cx + cy * cy + cz * cz;
}

/**
 * Metszi-e a SUGARRAL vastagitott szakasz a haromszoget?
 *
 * A raketa nem pontszeru (ROCKET_RADIUS = 0,6 m): nem eleg a
 * kozepvonalat vizsgalni, kulonben a fal mellett elsurolo raketa
 * athaladna a falon ahelyett, hogy felrobbanna.
 *
 * A vizsgalat: a szakasz tavolsaga a haromszog HAROM ELETOL es a ket
 * vegpont tavolsaga a haromszogtol. A lap belsejere eso eset a
 * kozepvonal-metszessel mar el van intezve (a hivo elobb azt probalja).
 */
function haromszogKozelseg(
  p0: readonly number[], p1: readonly number[],
  a: readonly number[], b: readonly number[], c: readonly number[],
  sugarSq: number,
): boolean {
  if (szakaszTavSq(p0, p1, a, b) <= sugarSq) return true;
  if (szakaszTavSq(p0, p1, b, c) <= sugarSq) return true;
  if (szakaszTavSq(p0, p1, c, a) <= sugarSq) return true;
  return false;
}

/**
 * A szakasz elso metszese a halóval.
 *
 * @param sugar A lovedek sugara (0 = pontszeru). Nem nulla ertek eseten
 *   a surloas is talalat -- lasd haromszogKozelseg.
 * @returns a metszes parametere [0,1]-ben (0 = a szakasz eleje), vagy
 *   null, ha nincs metszes.
 */
export function raycastBVH(
  bvh: BVH,
  from: readonly number[],
  to: readonly number[],
  sugar = 0,
): number | null {
  const irany = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const hossz = Math.hypot(irany[0], irany[1], irany[2]);
  if (hossz < 1e-9) return null;

  const { bounds, nodes, order, mesh } = bvh;
  const sugarSq = sugar * sugar;
  let legkozelebbi = 1;
  let talalt = false;

  // Sajat verem, hogy a bejaras is merheto es korlatos legyen.
  const verem: number[] = [0];
  const p0 = [from[0], from[1], from[2]];
  const p1 = [to[0], to[1], to[2]];
  const a: number[] = [0, 0, 0];
  const b: number[] = [0, 0, 0];
  const c: number[] = [0, 0, 0];

  while (verem.length > 0) {
    const csomopont = verem.pop() as number;
    if (!dobozMetszes(bounds, csomopont, from, irany, legkozelebbi, sugar)) {
      continue;
    }

    const db = nodes[csomopont * 2 + 1];
    if (db < 0) {
      // Belso csomopont: a bal gyerek a kovetkezo, a jobb tarolva van.
      verem.push(nodes[csomopont * 2]);
      verem.push(csomopont + 1);
      continue;
    }

    const kezd = nodes[csomopont * 2];
    for (let i = kezd; i < kezd + db; i++) {
      const t3 = order[i] * 3;
      const i0 = mesh.indices[t3] * 3;
      const i1 = mesh.indices[t3 + 1] * 3;
      const i2 = mesh.indices[t3 + 2] * 3;

      const t = haromszogMetszes(
        from, irany,
        mesh.vertices[i0], mesh.vertices[i0 + 1], mesh.vertices[i0 + 2],
        mesh.vertices[i1], mesh.vertices[i1 + 1], mesh.vertices[i1 + 2],
        mesh.vertices[i2], mesh.vertices[i2 + 1], mesh.vertices[i2 + 2],
        legkozelebbi,
      );
      if (t !== null) {
        legkozelebbi = t;
        talalt = true;
        continue;
      }
      if (sugarSq > 0) {
        a[0] = mesh.vertices[i0]; a[1] = mesh.vertices[i0 + 1]; a[2] = mesh.vertices[i0 + 2];
        b[0] = mesh.vertices[i1]; b[1] = mesh.vertices[i1 + 1]; b[2] = mesh.vertices[i1 + 2];
        c[0] = mesh.vertices[i2]; c[1] = mesh.vertices[i2 + 1]; c[2] = mesh.vertices[i2 + 2];
        if (haromszogKozelseg(p0, p1, a, b, c, sugarSq)) {
          // A SURLOASNAK nincs pontos parametere; a doboz-metszes
          // hataraval kozelitjuk, ami sosem kesobbi a valodinal.
          const kozelit = dobozMetszesParameter(from, irany, a, b, c, sugar);
          if (kozelit !== null && kozelit < legkozelebbi) {
            legkozelebbi = kozelit;
            talalt = true;
          }
        }
      }
    }
  }

  return talalt ? legkozelebbi : null;
}

/**
 * Hol lep be a szakasz a haromszog FELFUJT hatarolo dobozaba?
 *
 * Csak a surloas eseteben kell, becslesnek: a pontos "hol er hozza a
 * gomb a haromszoghoz" szamitas ennel jóval dragabb, es a raketa
 * robbanasi sugarahoz (6 m) kepest a kulonbseg elhanyagolhato.
 */
function dobozMetszesParameter(
  from: readonly number[],
  irany: readonly number[],
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
  sugar: number,
): number | null {
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 3; k++) {
    const lo = Math.min(a[k], b[k], c[k]) - sugar;
    const hi = Math.max(a[k], b[k], c[k]) + sugar;
    const d = irany[k];
    if (Math.abs(d) < 1e-12) {
      if (from[k] < lo || from[k] > hi) return null;
      continue;
    }
    let x = (lo - from[k]) / d;
    let y = (hi - from[k]) / d;
    if (x > y) {
      const csere = x;
      x = y;
      y = csere;
    }
    if (x > t0) t0 = x;
    if (y < t1) t1 = y;
    if (t0 > t1) return null;
  }
  return t0;
}
