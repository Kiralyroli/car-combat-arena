/**
 * A loves utkozo geometriaja: a MODELLEK haromszogei.
 *
 * A talalatot a szerver donti el. Eddig tengely-parhuzamos dobozokkal
 * szamolt, azok viszont nem tudnak lyukasak lenni: egy nyilason nem
 * lehetett atlonni, pedig a jatekos latta. Ez a modul allitja ossze a
 * palya valodi haromszog-halojat a generalt adatbol (collisionData.ts),
 * es epit ra gyorsito fat (BVH).
 *
 * Ket halo van:
 *
 *  - a PALYA, vilag-koordinatakban. Az elhelyezes a kozos LAYOUT-bol
 *    jon, tehat ugyanabbol, amibol a kliens is kirakja a modelleket.
 *  - az AUTO, a sajat rendszereben. A lovest ebbe a rendszerbe
 *    forgatjuk at, es igy egyetlen fa eleg minden jatekoshoz.
 *
 * A fak a szerver indulasakor egyszer epulnek fel (merve: a palyara
 * nehany szaz ezredmasodperc), utana csak lekerdezes van.
 */
import {
  ARENA,
  ARENA_HALF,
  LAYOUT,
  buildBVH,
  perimeterPlacements,
  type BVH,
  type PropPlacement,
  type Trimesh,
} from "@cca/shared";
import { UTKOZO_HALOK } from "./collisionData";

/** base64 -> Float32Array (a generalt adat igy fer el a forrasban). */
function dekodolF32(s: string): Float32Array {
  const buf = Buffer.from(s, "base64");
  return new Float32Array(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
}

function dekodolU32(s: string): Uint32Array {
  const buf = Buffer.from(s, "base64");
  return new Uint32Array(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
}

function halo(nev: string): Trimesh | null {
  const kodolt = UTKOZO_HALOK[nev];
  if (!kodolt) return null;
  return { vertices: dekodolF32(kodolt.v), indices: dekodolU32(kodolt.i) };
}

/**
 * Egy elhelyezett epulet haromszogei VILAG-koordinatakban.
 *
 * A forgatas csak derekszogu lehet (lasd arenaLayout.ts), tehat elég a
 * koordinatakat felcserelni -- nincs szogfuggveny, es nem csuszik el
 * kerekitessel sem.
 */
function elhelyez(
  p: PropPlacement,
  csucsok: number[],
  indexek: number[],
): boolean {
  const m = halo(p.prop);
  if (!m) return false;

  const eltolas = csucsok.length / 3;
  const yaw = ((p.yaw ?? 0) % 360 + 360) % 360;
  for (let i = 0; i < m.vertices.length; i += 3) {
    const x = m.vertices[i];
    const y = m.vertices[i + 1];
    const z = m.vertices[i + 2];
    let fx = x;
    let fz = z;
    if (yaw === 90) {
      fx = -z;
      fz = x;
    } else if (yaw === 180) {
      fx = -x;
      fz = -z;
    } else if (yaw === 270) {
      fx = z;
      fz = -x;
    }
    csucsok.push(p.x + fx, y, p.z + fz);
  }
  for (let i = 0; i < m.indices.length; i++) {
    indexek.push(eltolas + m.indices[i]);
  }
  return true;
}

let arenaFa: BVH | null = null;
let arenaFaTalajNelkul: BVH | null = null;
let autoFa: BVH | null = null;

/**
 * A palya haromszog-faja TALAJ NELKUL.
 *
 * A raketa a talajt kulon kezeli (a becsapodas helye es a robbanas
 * sugara mas szabaly szerint szamolodik), ezert neki olyan fa kell,
 * amiben a talaj nincs benne -- kulonben minden raketa azonnal a
 * talajnak utkozne, amint lefele indul.
 */
export function arenaBVHTalajNelkul(): BVH {
  if (arenaFaTalajNelkul) return arenaFaTalajNelkul;
  const csucsok: number[] = [];
  const indexek: number[] = [];
  for (const p of [...LAYOUT, ...perimeterPlacements(ARENA_HALF)]) {
    elhelyez(p, csucsok, indexek);
  }
  arenaFaTalajNelkul = buildBVH({
    vertices: new Float32Array(csucsok),
    indices: new Uint32Array(indexek),
  });
  return arenaFaTalajNelkul;
}

/**
 * A palya haromszog-faja (elso hivaskor epul fel).
 *
 * A TALAJ is benne van, ket haromszogkent: enelkul a talajba celzott
 * loves a hatotav vegeig repulne, es a nyomjelzo csik a semmibe mutatna.
 */
export function arenaBVH(): BVH {
  if (arenaFa) return arenaFa;

  const csucsok: number[] = [];
  const indexek: number[] = [];

  // A talaj felszine az ARENA "ground" dobozanak teteje.
  const ground = ARENA.find((b) => b.name === "ground");
  if (ground) {
    const y = ground.position.y + ground.halfExtents.y;
    const hx = ground.halfExtents.x;
    const hz = ground.halfExtents.z;
    const alap = csucsok.length / 3;
    csucsok.push(-hx, y, -hz, hx, y, -hz, hx, y, hz, -hx, y, hz);
    indexek.push(alap, alap + 1, alap + 2, alap, alap + 2, alap + 3);
  }

  let kimaradt = 0;
  for (const p of [...LAYOUT, ...perimeterPlacements(ARENA_HALF)]) {
    if (!elhelyez(p, csucsok, indexek)) kimaradt++;
  }
  if (kimaradt > 0) {
    // NEM csendben: egy hianyzo halo azt jelentene, hogy az adott
    // epuleten AT LEHET LONI -- pont az ellenkezoje annak, amit akarunk.
    console.warn(
      `[utkozes] ${kimaradt} epulethez nincs haromszog-halo; futtasd: npm run utkozes-meret`,
    );
  }

  arenaFa = buildBVH({
    vertices: new Float32Array(csucsok),
    indices: new Uint32Array(indexek),
  });
  return arenaFa;
}

/**
 * Az AUTO haromszog-faja, a jarmu sajat rendszereben.
 *
 * Egyetlen fa minden jatekoshoz: a lovest forgatjuk at az auto
 * rendszerebe, nem a halot a vilagba (lasd segmentCarEntryMesh).
 */
export function autoBVH(): BVH | null {
  if (autoFa) return autoFa;
  const m = halo("__auto");
  if (!m) {
    // NEM csendben: enelkul a talalat a doboz-kozelitesre esik vissza,
    // ami a kabin magassagaban jóval bőkezűbb. A jatek menne tovabb,
    // csak masok lennenek a talalatok -- eppen a fajta csendes elteres,
    // ami ellen az egesz keszult.
    console.warn(
      "[utkozes] az auto haromszog-haloja hianyzik; a talalat a dobozokra esik vissza. Futtasd: npm run utkozes-meret",
    );
    return null;
  }
  autoFa = buildBVH(m);
  return autoFa;
}

/** Diagnosztika: hany haromszogbol all a palya. */
export function arenaHaromszogek(): number {
  return arenaBVH().mesh.indices.length / 3;
}
