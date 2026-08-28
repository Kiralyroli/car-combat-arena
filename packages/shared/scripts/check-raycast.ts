/**
 * A haromszog-metszes es a gyorsito fa (BVH).
 *
 * Ez a modul donti el, hol akad meg a loves. Egy hibaja CSENDES: nem
 * dob kivetelt, a jatek megy tovabb, csak nehany loves athalad a falon
 * vagy megall a levegoben -- es kozben a jatekos nem erti, mi tortent.
 *
 * A fő eszkoz a NYERS ERO: ugyanazt a kerdest a fa nelkul is
 * megvalaszoljuk, es a kettonek egyeznie kell. Igy a fa barmelyik
 * hibaja (rossz vagas, elveszett haromszog, elrontott hatarolo doboz)
 * kiderul, es nem kell "helyes" valaszokat kezzel beirni.
 *
 * Futtatas: npm run check:raycast
 */
import { buildBVH, raycastBVH, type Trimesh } from "../src/index";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

/** Determinisztikus alveletlen: a teszt futasrol futasra ugyanaz. */
function rng(mag: number): () => number {
  let s = mag;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/** Doboz alaku halo -- ismert valaszokkal. */
function dobozHalo(
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number,
): Trimesh {
  const v: number[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        v.push(cx + sx * hx, cy + sy * hy, cz + sz * hz);
      }
    }
  }
  // A 12 haromszog a 8 csucsbol (a sorrend: x fő, y kozep, z legbelso).
  const i = [
    0, 1, 3, 0, 3, 2, // x-
    4, 7, 5, 4, 6, 7, // x+
    0, 5, 1, 0, 4, 5, // y-
    2, 3, 7, 2, 7, 6, // y+
    0, 2, 6, 0, 6, 4, // z-
    1, 5, 7, 1, 7, 3, // z+
  ];
  return { vertices: new Float32Array(v), indices: new Uint32Array(i) };
}

/** Nyers ero: ugyanaz a kerdes fa nelkul. */
function nyersEro(
  mesh: Trimesh,
  from: number[],
  to: number[],
): number | null {
  const egy = buildBVH({
    vertices: mesh.vertices,
    indices: mesh.indices,
  });
  // A "nyers ero" itt azt jelenti, hogy MINDEN haromszogre kulon fat
  // epitunk (egy haromszog = egy level), tehat a fa vagasi logikaja
  // nem befolyasolja az eredmenyt.
  let legjobb: number | null = null;
  const db = mesh.indices.length / 3;
  for (let t = 0; t < db; t++) {
    const egyetlen: Trimesh = {
      vertices: mesh.vertices,
      indices: mesh.indices.slice(t * 3, t * 3 + 3),
    };
    const r = raycastBVH(buildBVH(egyetlen), from, to);
    if (r !== null && (legjobb === null || r < legjobb)) legjobb = r;
  }
  void egy;
  return legjobb;
}

function main(): void {
  console.log("=== Haromszog-metszes ===\n");

  // --- Ismert valaszok egy dobozon ---
  //
  // Elobb olyan esetek, ahol fejben is tudjuk a valaszt: ha ezek
  // elbuknak, a nyers ero osszehasonlitas is ertelmetlen lenne (mindket
  // oldal ugyanazt a hibas metszest hasznalna).
  {
    const halo = dobozHalo(0, 0, 0, 1, 1, 1);
    const bvh = buildBVH(halo);

    const szemben = raycastBVH(bvh, [-5, 0, 0], [5, 0, 0]);
    check(
      "szemben erkezo sugar a doboz falan all meg",
      szemben !== null && Math.abs(szemben * 10 - 4) < 1e-6,
      `t = ${szemben?.toFixed(4)} -> ${((szemben ?? 0) * 10).toFixed(2)} m (vart: 4 m)`,
    );

    const mellette = raycastBVH(bvh, [-5, 3, 0], [5, 3, 0]);
    check(
      "a doboz FOLOTT elhalado sugar nem talal",
      mellette === null,
      "nincs metszes",
    );

    const surol = raycastBVH(bvh, [-5, 1.4, 0], [5, 1.4, 0], 0.6);
    check(
      "sugarral a surloas mar talalat",
      surol !== null,
      `0,6 m sugar, 0,4 m-re a doboz folott -> ${surol === null ? "nincs" : "van"} metszes`,
    );

    const surolPont = raycastBVH(bvh, [-5, 1.4, 0], [5, 1.4, 0], 0);
    check(
      "ugyanaz pontszeruen NEM talalat",
      surolPont === null,
      "a sugar nelkuli loves elmegy mellette",
    );
  }

  // --- A NYILAS: ezert keszult az egesz ---
  //
  // Ket kulonallo doboz, kozottuk res. A dobozokra celzott loves
  // megall, a res kozott athalad. Egyetlen befoglalo dobozzal ez
  // lehetetlen lenne -- eppen ez a kulonbseg a regi megoldashoz kepest.
  {
    const bal = dobozHalo(-2, 0, 0, 0.5, 2, 0.5);
    const jobb = dobozHalo(2, 0, 0, 0.5, 2, 0.5);
    const egyesitett: Trimesh = {
      vertices: new Float32Array([...bal.vertices, ...jobb.vertices]),
      indices: new Uint32Array([
        ...bal.indices,
        ...Array.from(jobb.indices, (i) => i + bal.vertices.length / 3),
      ]),
    };
    const bvh = buildBVH(egyesitett);

    check(
      "a NYILASON athalad a loves",
      raycastBVH(bvh, [0, 0, -10], [0, 0, 10]) === null,
      "a ket oszlop kozott (x = 0) nincs metszes",
    );
    check(
      "az oszlopon viszont megall",
      raycastBVH(bvh, [-2, 0, -10], [-2, 0, 10]) !== null,
      "a bal oszlopra celozva (x = -2) van metszes",
    );
    // A REGI viselkedes: a ket oszlop kozos befoglaloja -2.5..2.5,
    // vagyis a nyilast is lefedte volna.
    check(
      "a kozos befoglalo doboz elfedne a nyilast",
      Math.min(-2 - 0.5, 2 - 0.5) < 0 && Math.max(-2 + 0.5, 2 + 0.5) > 0,
      "a -2,5..2,5 befoglalo tartalmazza az x = 0 vonalat",
    );
  }

  // --- A FA egyezik a nyers eroveel ---
  //
  // Ez a fő ellenorzes. Sok veletlen sugar egy zavaros halora, es
  // minden valasznak egyeznie kell a fa nelkul szamolttal.
  {
    // Tobb, kulonbozo meretu es helyzetu doboz: a fanak lesz mit vagnia.
    const r = rng(12345);
    const csucsok: number[] = [];
    const indexek: number[] = [];
    for (let d = 0; d < 24; d++) {
      const doboz = dobozHalo(
        (r() - 0.5) * 40, (r() - 0.5) * 10, (r() - 0.5) * 40,
        0.3 + r() * 3, 0.3 + r() * 3, 0.3 + r() * 3,
      );
      const eltolas = csucsok.length / 3;
      csucsok.push(...doboz.vertices);
      indexek.push(...Array.from(doboz.indices, (i) => i + eltolas));
    }
    const halo: Trimesh = {
      vertices: new Float32Array(csucsok),
      indices: new Uint32Array(indexek),
    };
    const bvh = buildBVH(halo);

    let elteres = 0;
    let talalatok = 0;
    let peldа = "";
    const rr = rng(999);
    for (let i = 0; i < 400; i++) {
      const from = [(rr() - 0.5) * 60, (rr() - 0.5) * 16, (rr() - 0.5) * 60];
      const to = [(rr() - 0.5) * 60, (rr() - 0.5) * 16, (rr() - 0.5) * 60];
      const fabol = raycastBVH(bvh, from, to);
      const nyers = nyersEro(halo, from, to);
      if (fabol !== null) talalatok++;
      const egyezik =
        (fabol === null && nyers === null) ||
        (fabol !== null && nyers !== null && Math.abs(fabol - nyers) < 1e-6);
      if (!egyezik) {
        elteres++;
        if (peldа === "") peldа = `fa: ${fabol}, nyers: ${nyers}`;
      }
    }
    check(
      "a fa ugyanazt adja, mint a nyers ero",
      elteres === 0,
      elteres === 0
        ? `400 veletlen sugar, ${talalatok} talalat, 0 elteres (${halo.indices.length / 3} haromszog)`
        : `${elteres} elteres, pl. ${peldа}`,
    );
  }

  // --- SEBESSEG ---
  //
  // A palya 25 ezer haromszogbol all, es minden loves (plusz minden
  // lag-kompenzacios visszatekeres) lekerdez. Ha ez lassu, a szerver
  // akad -- amit egy jatekban nem lehet "eszrevenni", csak merni.
  {
    const r = rng(777);
    const csucsok: number[] = [];
    const indexek: number[] = [];
    for (let d = 0; d < 2000; d++) {
      const doboz = dobozHalo(
        (r() - 0.5) * 120, r() * 20, (r() - 0.5) * 120,
        0.2 + r() * 2, 0.2 + r() * 6, 0.2 + r() * 2,
      );
      const eltolas = csucsok.length / 3;
      csucsok.push(...doboz.vertices);
      indexek.push(...Array.from(doboz.indices, (i) => i + eltolas));
    }
    const halo: Trimesh = {
      vertices: new Float32Array(csucsok),
      indices: new Uint32Array(indexek),
    };

    const epitesKezd = performance.now();
    const bvh = buildBVH(halo);
    const epitesMs = performance.now() - epitesKezd;

    const rr = rng(31337);
    const sugarak: number[][][] = [];
    for (let i = 0; i < 200; i++) {
      sugarak.push([
        [(rr() - 0.5) * 120, 1 + rr() * 3, (rr() - 0.5) * 120],
        [(rr() - 0.5) * 120, 1 + rr() * 3, (rr() - 0.5) * 120],
      ]);
    }
    for (let i = 0; i < 2000; i++) {
      raycastBVH(bvh, sugarak[i % 200][0], sugarak[i % 200][1]);
    }
    const N = 20000;
    const kezd = performance.now();
    for (let i = 0; i < N; i++) {
      raycastBVH(bvh, sugarak[i % 200][0], sugarak[i % 200][1]);
    }
    const us = ((performance.now() - kezd) / N) * 1000;

    check(
      "egy lekerdezes gyors",
      us < 20,
      `${us.toFixed(1)} us / sugar (${halo.indices.length / 3} haromszog, ${bvh.nodeCount} csomopont)`,
    );
    check(
      "a fa felepitese elfogadhato",
      epitesMs < 2000,
      `${epitesMs.toFixed(0)} ms (a szerver indulasakor egyszer fut)`,
    );
  }

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
