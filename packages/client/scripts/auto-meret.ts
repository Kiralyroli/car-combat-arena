/**
 * A NEGY jarmu kimerese -> packages/shared/src/carGeometry.ts
 *
 * MIERT: a jatek minden meretet a MODELLBOL vesz, nem beirt szamokbol.
 * Ha a modell cserelodik, ez a szkript ujra lefut, es a fizika, a
 * talalat es a latvany egyutt kovetik. Kezzel beirva a hiba CSENDES
 * lenne: az auto belelogna a talajba, vagy ott is talalna a loves, ahol
 * nincs semmi.
 *
 * Jarmuvenkent OT dolgot merunk:
 *
 *  1. UTKOZO DOBOZ (fel-meretek). Ebbol lesz a fizikai test merete, es
 *     ehhez kepest all a modell. Az alja a KEREKEK alja (a talaj), a
 *     teteje a tetovonal.
 *  2. TALALATI DOBOZOK. Magassag-szeletekbol: a doboz a kabin
 *     magassagaban jóval nagyobb az autonal, tehat egyetlen dobozzal a
 *     motorhaztetö FOLOTT is talalna a loves.
 *  3. KONVEX BUROK: a fizikai test alakja. Haromszog-halot dinamikus
 *     testre nem lehet hasznalni.
 *  4. KEREKHELYEK es KEREK-SUGARAK. Minden modell a SAJAT kerekevel
 *     jar: a negy kocsi kereke 0,7 es 0,9 m kozott van.
 *  5. KEREK-SZELESSEG: a serules-latvanyhoz (lapos gumi) kell.
 *
 * Futtatas (fusson a kliens dev szerver): npm run auto-meret
 */
import { writeFileSync } from "node:fs";
import { CAR_MODELS } from "@cca/shared";
import { chromium } from "playwright";
import { Vector3 } from "three";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const KIMENET = "../../shared/src/carGeometry.ts";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A szeletek vastagsaga a talalati dobozok meresehez (m).
 *
 * Ennel finomabb nem er semmit: a modell tetövonala maga is ilyen
 * lepcsokben valtozik, es a szeletek ugyis osszevonodnak.
 */
const SZELET = 0.05;

/** Mennyivel terhet el ket szomszedos szelet, hogy meg osszevonjuk (m). */
const OSSZEVONAS = 0.2;

interface Szelet {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

interface KerekMeres {
  kozep: number[];
  meret: number[];
}

interface Meres {
  szeletek: Record<string, number[]>;
  burok: string[];
  /** A KAROSSZERIA befoglaloja a modell sajat rendszereben. */
  bbox: number[];
  /** A negy kerek, FL/FR/RL/RR sorrendben. */
  kerekek: KerekMeres[];
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  [oldal-hiba] ${e.message}`));
  await page.goto(`${CLIENT_URL}?dekor=0&name=Meres`);
  await page.waitForFunction(
    () => !!(window as any).__spike?.view?.carTemplateNames?.().length,
    null,
    { timeout: 40000 },
  );
  await sleep(1500);

  // SEGEDFUGGVENY NELKUL, egyetlen kiertekelesben: a tsx a megnevezett
  // fuggvenyeket __name() burokba teszi, az viszont a LAPON nem letezik.
  const nyers = (await page.evaluate((h: number) => {
    const v = (window as any).__spike.view;
    const ki: Record<string, any> = {};

    for (const [nev, sablon] of v.carTemplates as Map<string, any>) {
      const klon = sablon.clone(true);
      klon.position.set(0, 0, 0);
      klon.rotation.set(0, 0, 0);
      klon.updateWorldMatrix(true, true);

      const szeletek: Record<number, number[]> = {};
      const burokPontok = new Set<string>();
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;

      klon.traverse((o: any) => {
        if (!o.isMesh || !o.geometry?.attributes?.position) return;
        const g = o.geometry;
        const a = g.attributes.position;
        const idx = g.index;
        const n = idx ? idx.count : a.count;
        for (let i = 0; i < n; i += 3) {
          const t: number[][] = [];
          for (let k = 0; k < 3; k++) {
            const j = idx ? idx.getX(i + k) : i + k;
            const e = new o.position.constructor(a.getX(j), a.getY(j), a.getZ(j));
            o.localToWorld(e);
            t.push([e.x, e.y, e.z]);
          }
          const bx0 = Math.min(t[0][0], t[1][0], t[2][0]);
          const bx1 = Math.max(t[0][0], t[1][0], t[2][0]);
          const by0 = Math.min(t[0][1], t[1][1], t[2][1]);
          const by1 = Math.max(t[0][1], t[1][1], t[2][1]);
          const bz0 = Math.min(t[0][2], t[1][2], t[2][2]);
          const bz1 = Math.max(t[0][2], t[1][2], t[2][2]);
          if (bx0 < x0) x0 = bx0;
          if (bx1 > x1) x1 = bx1;
          if (by0 < y0) y0 = by0;
          if (by1 > y1) y1 = by1;
          if (bz0 < z0) z0 = bz0;
          if (bz1 > z1) z1 = bz1;

          for (const q of t) {
            burokPontok.add(
              [
                Math.round(q[0] * 100),
                Math.round(q[1] * 100),
                Math.round(q[2] * 100),
              ].join(","),
            );
          }
          // A haromszog MINDEN altala erintett szeletbe beleszamit: egy
          // ferde tetolap kulonben csak a ket vegen jelenne meg.
          for (let s = Math.floor(by0 / h); s <= Math.floor(by1 / h); s++) {
            const r = szeletek[s] ?? [Infinity, -Infinity, Infinity, -Infinity];
            if (bx0 < r[0]) r[0] = bx0;
            if (bx1 > r[1]) r[1] = bx1;
            if (bz0 < r[2]) r[2] = bz0;
            if (bz1 > r[3]) r[3] = bz1;
            szeletek[s] = r;
          }
        }
      });

      // A KEREKEK kulon: a helyuk es a meretuk a sajat node-jukbol jon.
      const kerekek: any[] = [];
      for (const kerekSablon of (v.carWheelTemplates as Map<string, any[]>).get(
        nev,
      ) ?? []) {
        const kk = kerekSablon.clone(true);
        kk.updateWorldMatrix(true, true);
        let kx0 = Infinity;
        let kx1 = -Infinity;
        let ky0 = Infinity;
        let ky1 = -Infinity;
        let kz0 = Infinity;
        let kz1 = -Infinity;
        kk.traverse((o: any) => {
          if (!o.isMesh || !o.geometry?.attributes?.position) return;
          const a = o.geometry.attributes.position;
          for (let i = 0; i < a.count; i++) {
            const e = new o.position.constructor(a.getX(i), a.getY(i), a.getZ(i));
            // A localToWorld MAR TARTALMAZZA a kerek-node sajat
            // eltolasat is (a matrixWorld resze). Kulon hozzaadva
            // duplan szamolodna -- merve: a kerekek ketszer olyan
            // messze kerultek a kocsi kozeppontjatol, mint valojaban.
            o.localToWorld(e);
            const px = e.x;
            const py = e.y;
            const pz = e.z;
            if (px < kx0) kx0 = px;
            if (px > kx1) kx1 = px;
            if (py < ky0) ky0 = py;
            if (py > ky1) ky1 = py;
            if (pz < kz0) kz0 = pz;
            if (pz > kz1) kz1 = pz;
          }
        });
        kerekek.push({
          kozep: [(kx0 + kx1) / 2, (ky0 + ky1) / 2, (kz0 + kz1) / 2],
          meret: [kx1 - kx0, ky1 - ky0, kz1 - kz0],
        });
      }

      ki[nev] = {
        szeletek,
        burok: [...burokPontok],
        bbox: [x0, x1, y0, y1, z0, z1],
        kerekek,
      };
    }
    return ki;
  }, SZELET)) as Record<string, Meres>;

  await browser.close();

  const k = (n: number) => Number(n.toFixed(3));
  const sorok: string[] = [];
  const naplo: string[] = [];

  for (const modell of CAR_MODELS) {
    const m = nyers[modell.id];
    if (!m) {
      console.log(`HIBA: nincs meres ehhez: ${modell.id}`);
      process.exitCode = 1;
      return;
    }
    if (m.kerekek.length !== 4) {
      console.log(
        `HIBA: ${modell.id}: ${m.kerekek.length} kerek van, negy kellene`,
      );
      process.exitCode = 1;
      return;
    }

    const [bx0, bx1, , by1, bz0, bz1] = m.bbox;

    // --- UTKOZO DOBOZ ---
    //
    // A doboz alja a TALAJ (a modell origoja a kerekek erintkezesi
    // sikja), a teteje a tetövonal. Igy a doboz kozeppontja a fel
    // magassagban van -- ide kerul a fizikai test origoja.
    //
    // A SZELESSEGBE a kerekek is beleszamitanak: tobb kocsinal
    // szelesebbek a karosszerianal, es amivel a jatekos utkozik, azt
    // latnia is kell.
    const kerekX = Math.max(
      ...m.kerekek.map((w) => Math.abs(w.kozep[0]) + w.meret[0] / 2),
    );
    const kerekZ = Math.max(
      ...m.kerekek.map((w) => Math.abs(w.kozep[2]) + w.meret[2] / 2),
    );
    const felX = Math.max((bx1 - bx0) / 2, kerekX);
    const felZ = Math.max((bz1 - bz0) / 2, kerekZ);

    // A TALAJ a KEREKEK alja -- nem a modell nullpontja.
    //
    // A ketto nem feltetlenul egyezik: az exportbol a kerekek nehany
    // centivel a nulla szint FOLE kerulhetnek (merve: az izomautonal
    // 4,6 cm). Ha a modell nullpontjat vennenk talajnak, a kocsi
    // ennyivel a talaj folott lebegne -- lathatoan.
    const talaj = Math.min(
      ...m.kerekek.map((w) => w.kozep[1] - Math.max(w.meret[1], w.meret[2]) / 2),
    );
    const felY = (by1 - talaj) / 2;
    /** A doboz KOZEPPONTJA a modell rendszereben. */
    const kozeppontY = talaj + felY;

    // --- KEREKEK ---
    //
    // A helyuk a MODELLBOL jon (nem aranyositott becslesbol), a sugaruk
    // a kerek fuggoleges meretebol, a szelessegük a tengely mentibol.
    const kerekek = ["FL", "FR", "RL", "RR"].map((id, i) => {
      const w = m.kerekek[i];
      return {
        id,
        // A DOBOZ rendszerebe: az origo a doboz kozeppontja.
        x: k(w.kozep[0]),
        y: k(w.kozep[1] - kozeppontY),
        z: k(w.kozep[2]),
        radius: k(Math.max(w.meret[1], w.meret[2]) / 2),
        width: k(w.meret[0]),
      };
    });

    // --- TALALATI DOBOZOK (magassag-szeletekbol) ---
    //
    // A KEREKEK is beleszamitanak: sebzodnek, es celozni lehet rajuk.
    // Nelkuluk a legalso szelet csak a keskeny alvazat fedne, es az
    // oldalrol a kerekre adott loves elszallna az auto alatt.
    //
    // A kerek NEM tokeletes korong (a ritkitas utan meg kevesbe), a
    // doboza viszont teglalap: par milliméterrel nagyobbra vesszuk,
    // hogy a talalati test biztosan LEFEDJE a halot. Enelkul a
    // haromszog-halo helyenkent kilogna a dobozbol, es a tartalek-ag
    // (amikor a halo hianyzik) szukebb lenne a valosnal.
    const KEREK_RAHAGYAS = 0.03;
    for (const w of kerekek) {
      const wy = w.y + kozeppontY;
      const sugar = w.radius + KEREK_RAHAGYAS;
      const felSzeles = w.width / 2 + KEREK_RAHAGYAS;
      const y0 = wy - sugar;
      const y1 = wy + sugar;
      for (let s = Math.floor(y0 / SZELET); s <= Math.floor(y1 / SZELET); s++) {
        const kulcs = String(s);
        const r = m.szeletek[kulcs] ?? [Infinity, -Infinity, Infinity, -Infinity];
        r[0] = Math.min(r[0], w.x - felSzeles);
        r[1] = Math.max(r[1], w.x + felSzeles);
        r[2] = Math.min(r[2], w.z - sugar);
        r[3] = Math.max(r[3], w.z + sugar);
        m.szeletek[kulcs] = r;
      }
    }

    const kulcsok = Object.keys(m.szeletek)
      .map(Number)
      .sort((a, b) => a - b);
    const szeletek: Szelet[] = kulcsok.map((s) => {
      const r = m.szeletek[String(s)];
      return {
        // A MODELL rendszerebol a DOBOZ rendszerebe: az origo a doboz
        // kozeppontja, tehat fel magassaggal lejjebb.
        y0: s * SZELET - kozeppontY,
        y1: (s + 1) * SZELET - kozeppontY,
        x0: r[0],
        x1: r[1],
        z0: r[2],
        z1: r[3],
      };
    });
    szeletek[0].y0 = -felY;
    szeletek[szeletek.length - 1].y1 = Math.min(
      szeletek[szeletek.length - 1].y1,
      felY,
    );

    const dobozok: Szelet[] = [];
    for (const sz of szeletek) {
      const utolso = dobozok[dobozok.length - 1];
      if (
        utolso &&
        Math.abs(utolso.x0 - sz.x0) <= OSSZEVONAS &&
        Math.abs(utolso.x1 - sz.x1) <= OSSZEVONAS &&
        Math.abs(utolso.z0 - sz.z0) <= OSSZEVONAS &&
        Math.abs(utolso.z1 - sz.z1) <= OSSZEVONAS
      ) {
        utolso.x0 = Math.min(utolso.x0, sz.x0);
        utolso.x1 = Math.max(utolso.x1, sz.x1);
        utolso.z0 = Math.min(utolso.z0, sz.z0);
        utolso.z1 = Math.max(utolso.z1, sz.z1);
        utolso.y1 = sz.y1;
        continue;
      }
      dobozok.push({ ...sz });
    }
    // SZILANKOK osszevonasa: a vagas egy-ket centis dobozt hagyhat.
    for (let i = dobozok.length - 1; i > 0; i--) {
      if (dobozok[i].y1 - dobozok[i].y0 >= 0.06) continue;
      const e = dobozok[i - 1];
      e.y1 = dobozok[i].y1;
      e.x0 = Math.min(e.x0, dobozok[i].x0);
      e.x1 = Math.max(e.x1, dobozok[i].x1);
      e.z0 = Math.min(e.z0, dobozok[i].z0);
      e.z1 = Math.max(e.z1, dobozok[i].z1);
      dobozok.splice(i, 1);
    }
    // A talalati test MINDIG a dobozon belul marad: senki nem valik
    // eltalalhatova ott, ahol nincs auto.
    for (const d of dobozok) {
      d.x0 = Math.max(d.x0, -felX);
      d.x1 = Math.min(d.x1, felX);
      d.y0 = Math.max(d.y0, -felY);
      d.y1 = Math.min(d.y1, felY);
      d.z0 = Math.max(d.z0, -felZ);
      d.z1 = Math.min(d.z1, felZ);
    }

    // --- KONVEX BUROK ---
    //
    // CSAK a karosszeria, kerekek nelkul: a kerekeket a felfuggesztes
    // kezeli (sugarral es rugoval), es ha a burok leerne a talajig, az
    // auto a kerekei helyett a testen csuszna.
    const pontok = m.burok.map((s) => {
      const [x, y, z] = s.split(",").map(Number);
      return new Vector3(x / 100, y / 100 - kozeppontY, z / 100);
    });
    const hull = new ConvexHull().setFromPoints(pontok);
    const burokCsucsok = new Set<string>();
    for (const lap of hull.faces) {
      let el = lap.edge;
      do {
        const p = el.head().point;
        burokCsucsok.add([p.x, p.y, p.z].map((n) => n.toFixed(4)).join(","));
        el = el.next;
      } while (el !== lap.edge);
    }
    const bp = [...burokCsucsok].map((s) => s.split(",").map(Number));

    const dobozSorok = dobozok
      .map(
        (d) =>
          `      { dx: ${k((d.x0 + d.x1) / 2)}, hx: ${k((d.x1 - d.x0) / 2)}` +
          `, dy: ${k((d.y0 + d.y1) / 2)}, hy: ${k((d.y1 - d.y0) / 2)}` +
          `, dz: ${k((d.z0 + d.z1) / 2)}, hz: ${k((d.z1 - d.z0) / 2)} },`,
      )
      .join("\n");

    const burokSorok: string[] = [];
    for (let i = 0; i < bp.length; i += 3) {
      burokSorok.push(
        "      " +
          bp
            .slice(i, i + 3)
            .map((v) => v.map((n) => Number(n.toFixed(4))).join(", "))
            .join(", ") +
          ",",
      );
    }

    const kerekSorok = kerekek
      .map(
        (w) =>
          `      { id: "${w.id}", x: ${w.x}, y: ${w.y}, z: ${w.z}` +
          `, radius: ${w.radius}, width: ${w.width} },`,
      )
      .join("\n");

    sorok.push(
      `  ${modell.id}: {\n` +
        `    halfExtents: { x: ${k(felX)}, y: ${k(felY)}, z: ${k(felZ)} },\n` +
        `    modelOffsetY: ${k(kozeppontY)},
` +
        `    hitBoxes: [\n${dobozSorok}\n    ],\n` +
        `    hull: new Float32Array([\n${burokSorok.join("\n")}\n    ]),\n` +
        `    wheels: [\n${kerekSorok}\n    ],\n` +
        `  },`,
    );

    naplo.push(
      `  ${modell.id.padEnd(10)} ${(felX * 2).toFixed(2)} x ${(felY * 2).toFixed(2)} x ${(felZ * 2).toFixed(2)} m` +
        `  ${String(dobozok.length).padStart(2)} talalati doboz, ${bp.length} burok-csucs` +
        `, kerek ${(kerekek[0].radius * 2).toFixed(2)} m`,
    );
  }

  const tartalom = `/**
 * Az autok MERT geometriaja: utkozo doboz, talalati test, konvex burok
 * es kerekek -- modellenkent.
 *
 * GENERALT FAJL -- ne szerkeszd kezzel. A
 * packages/client/scripts/auto-meret.ts allitja elo a modellekbol
 * (npm run auto-meret).
 *
 * MIERT MODELLENKENT: a negy kocsi merete es alakja elter (4,1 m-tol
 * 4,9 m-ig, 1,3 m-tol 2,0 m magassagig), es MINDEGYIK a sajat
 * kerekevel jar. Egyetlen kozos dobozzal a magas rohamkocsi kilogna
 * belole, az alacsony izomauto korul pedig ott is talalna a loves, ahol
 * nincs semmi.
 *
 * A koordinatak az auto sajat rendszereben ertendok, az origo az
 * UTKOZO DOBOZ kozeppontja (+Z hatra, +Y felfele).
 *
 * A FEGYVER nincs a talalati testben: az celzaskor elfordul, tehat egy
 * auto-rogzitett doboz vagy nem fedne, vagy a teljes soport teruletet
 * lefoglalna.
 */
import type { CarId } from "./carModels";

/** Egy talalati doboz az auto sajat rendszereben. */
export interface CarBox {
  dx: number;
  dy: number;
  dz: number;
  hx: number;
  hy: number;
  hz: number;
}

/**
 * Egy kerek az auto sajat rendszereben.
 *
 * A SUGAR is idetartozik: a kocsik kereke 0,7 es 0,9 m kozott van, es
 * ebbol jon a felfuggesztes tapadasi pontja, a gordules szoge es a
 * kerek latvanya is.
 */
export interface CarWheel {
  id: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  /** A kerek szelessege (a tengely menten) -- a serules-latvanyhoz. */
  width: number;
}

export interface CarGeometry {
  /** Az utkozo doboz fel-meretei. */
  halfExtents: { x: number; y: number; z: number };
  /**
   * Az utkozo doboz KOZEPPONTJA a modell sajat rendszereben (m).
   *
   * Ennyivel kell lejjebb tenni a modellt, hogy a KEREKEI a talajon
   * alljanak. Nem egyenlo a fel magassaggal: a modell nullpontja nem
   * feltetlenul a kerekek alja (merve: az izomautonal 4,6 cm-rel
   * lejjebb van), es ha ezt elneznenk, a kocsi lathatoan lebegne.
   */
  modelOffsetY: number;
  /** A talalati test dobozai (lasd auto-meret.ts). */
  hitBoxes: CarBox[];
  /**
   * A fizikai test konvex burka: x/y/z harmasok.
   *
   * CSAK a karosszeria: a kerekeket a felfuggesztes kezeli, es ha a
   * burok leerne a talajig, az auto a kerekei helyett a testen csuszna.
   */
  hull: Float32Array;
  /** A kerekek -- MINDEN modell a sajatjaval jar. */
  wheels: CarWheel[];
}

export const CAR_GEOMETRY: Record<CarId, CarGeometry> = {
${sorok.join("\n")}
};
`;

  writeFileSync(new URL(KIMENET, import.meta.url), tartalom, "utf8");
  console.log(`=== ${CAR_MODELS.length} auto kimerve -> ${KIMENET}\n`);
  for (const sor of naplo) console.log(sor);
}

main();
