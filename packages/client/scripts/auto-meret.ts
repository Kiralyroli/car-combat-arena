/**
 * Az AUTO kimerese -> packages/shared/src/carHitbox.ts
 *
 * MIERT: a talalatot eddig egyetlen doboz dontotte el, a modell teljes
 * befoglaloja (2,18 x 1,51 x 4,91 m). Ez a karosszeria also feleben jo,
 * a KABIN magassagaban viszont durvan hazudik: ott az auto 1,4-1,8 m
 * szeles es 2-2,8 m hosszu, a doboz meg vegig 2,18 x 4,91. A
 * motorhaztetö es a csomagtarto FOLOTTI levego is talalatnak szamit.
 * (Merve: a doboz terfogatanak 38%-a auto.)
 *
 * Ugyanaz a megoldas, mint az epuleteknel (kit-meret.ts), csak
 * FUGGOLEGES iranyban: vekony magassag-szeletekre bontjuk a modellt,
 * szeletenkent vesszuk a vizszintes befoglalot, majd a hasonlo
 * szeleteket osszevonjuk. Az auto vizszintes metszete minden
 * magassagban egyetlen osszefuggo folt, ezert itt eleg szeletenkent EGY
 * doboz -- nem kell teglalap-fedes.
 *
 * KET SZABALY, amit a generalas betart:
 *
 *  1. A doboz-halmaz mindig RESZE a regi, teljes befoglalonak. Igy
 *     senki nem valik eltalalhatova ott, ahol eddig nem volt az -- a
 *     valtozas csak elvesz a hamis talalatokbol.
 *  2. A legalso szelet leer a KEREKEKIG (a modell karosszeriaja 0,16
 *     m-rel a kerekek alja folott vegzodik). Kulonben a kerekre adott
 *     talalat elszallna az auto alatt.
 *
 * Futtatas (fusson a kliens dev szerver): npm run auto-meret
 */
import { writeFileSync } from "node:fs";
import { CHASSIS } from "@cca/shared";
import { chromium } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const KIMENET = "../../shared/src/carHitbox.ts";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A szeletek vastagsaga a meresnel (m).
 *
 * Ennel finomabb nem er semmit: a modell tetövonala maga is ilyen
 * lepcsokben valtozik, es a szeletek ugyis osszevonodnak.
 */
const SZELET = 0.05;

/**
 * Mennyivel terhet el ket szomszedos szelet, hogy meg osszevonjuk (m).
 *
 * SZANDEKOS kompromisszum. Nullaval minden szelet kulon dobozt kapna
 * (30 doboz autonkent), egy nagy ertekkel visszakapnank az egyetlen
 * dobozt. A 0,2 m nagyjabol a karosszeria "lepcsoit" koveti: a
 * motorhaztetö, a szelvedo tövé es a tetö kulon dobozt kap.
 */
const OSSZEVONAS = 0.2;

interface Szelet {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  [oldal-hiba] ${e.message}`));
  // Diszites nelkul: a palya modelljei ehhez a mereshez nem kellenek.
  await page.goto(`${CLIENT_URL}?dekor=0&name=Meres`);
  await page.waitForFunction(
    () => !!(window as any).__spike?.net?.playerId,
    null,
    { timeout: 30000 },
  );
  await sleep(2000);

  // SEGEDFUGGVENY NELKUL, egyetlen kiertekelesben: a tsx a megnevezett
  // fuggvenyeket __name() burokba teszi, az viszont a LAPON nem letezik
  // ("__name is not defined"), es az egesz kiertekeles elszall rajta.
  const nyers = (await page.evaluate((h: number) => {
    const v = (window as any).__spike.view;
    const w = v.chassisMesh;
    w.updateWorldMatrix(true, true);
    // A wrapper LOKALIS rendszereben merunk: annak origoja pontosan a
    // fizikai doboz kozeppontja (a modell -halfExtents.y eltolassal ul
    // benne), tehat a kapott szamok kozvetlenul hasznalhatok.
    const inv = w.matrixWorld.clone().invert();
    // A FEGYVER kimarad: az celzaskor elfordul, tehat egy auto-rogzitett
    // doboz vagy nem fedne, vagy a teljes soport teruletet lefoglalna.
    const launcher = v.launcher?.root ?? null;

    // A KEREKEK kulon allnak a jelenetben (nem a wrapper gyerekei), de
    // ugyanugy az autohoz tartoznak: sebzodnek, es a rajuk celzott
    // lovesnek talalnia kell. Nelkuluk az also szeletek 1,39 m
    // szelesek lennenek a valos 2,0 helyett -- vagyis oldalrol a
    // kerekre adott loves elszallna az auto alatt.
    const gyokerek = [...w.children, ...(v.wheelGroups ?? [])];
    const szeletek: Record<number, number[]> = {};
    for (const gyerek of gyokerek) {
      if (launcher !== null && gyerek === launcher) continue;
      gyerek.traverse((o: any) => {
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
            e.applyMatrix4(inv);
            t.push([e.x, e.y, e.z]);
          }
          const bx0 = Math.min(t[0][0], t[1][0], t[2][0]);
          const bx1 = Math.max(t[0][0], t[1][0], t[2][0]);
          const by0 = Math.min(t[0][1], t[1][1], t[2][1]);
          const by1 = Math.max(t[0][1], t[1][1], t[2][1]);
          const bz0 = Math.min(t[0][2], t[1][2], t[2][2]);
          const bz1 = Math.max(t[0][2], t[1][2], t[2][2]);
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
    }
    return szeletek;
  }, SZELET)) as Record<string, number[]>;

  await browser.close();

  const kulcsok = Object.keys(nyers)
    .map(Number)
    .sort((a, b) => a - b);
  if (kulcsok.length === 0) {
    console.log("HIBA: nem sikerult kimerni az autot.");
    process.exitCode = 1;
    return;
  }

  const H = CHASSIS.halfExtents;
  const szeletek: Szelet[] = kulcsok.map((s) => {
    const r = nyers[String(s)];
    return {
      y0: s * SZELET,
      y1: (s + 1) * SZELET,
      x0: r[0],
      x1: r[1],
      z0: r[2],
      z1: r[3],
    };
  });

  // A LEGALSO szelet leer a kerekekig: a karosszeria alja folott
  // meg ott vannak a kerekek, es a rajuk adott talalat kulonben
  // elszallna az auto alatt.
  szeletek[0].y0 = -H.y;
  // A LEGFELSO a tetoig, de a regi dobozon belul marad.
  szeletek[szeletek.length - 1].y1 = Math.min(szeletek[szeletek.length - 1].y1, H.y);

  // --- Hasonlo szeletek osszevonasa ---
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

  // --- SZILANKOK osszevonasa ---
  //
  // A tetö korul a vagas (H.y) egy-ket centis dobozt hagy. Az ilyen
  // nem er kulon dobozt: a lovedek gyakorlatilag sosem talalja el
  // pontosan, a listat viszont hosszabbitja.
  for (let i = dobozok.length - 1; i > 0; i--) {
    if (dobozok[i].y1 - dobozok[i].y0 >= 0.06) continue;
    const elozo = dobozok[i - 1];
    elozo.y1 = dobozok[i].y1;
    elozo.x0 = Math.min(elozo.x0, dobozok[i].x0);
    elozo.x1 = Math.max(elozo.x1, dobozok[i].x1);
    elozo.z0 = Math.min(elozo.z0, dobozok[i].z0);
    elozo.z1 = Math.max(elozo.z1, dobozok[i].z1);
    dobozok.splice(i, 1);
  }

  // --- A REGI dobozon belul maradunk ---
  //
  // Igy senki nem valik eltalalhatova ott, ahol eddig nem volt az: a
  // valtozas CSAK elvesz a hamis talalatokbol. Ez fontos a
  // kiegyensulyozottsag miatt is -- egy "nagyobb lett a hitbox" nem
  // csusszhat be eszrevetlenul.
  for (const d of dobozok) {
    d.x0 = Math.max(d.x0, -H.x);
    d.x1 = Math.min(d.x1, H.x);
    d.y0 = Math.max(d.y0, -H.y);
    d.y1 = Math.min(d.y1, H.y);
    d.z0 = Math.max(d.z0, -H.z);
    d.z1 = Math.min(d.z1, H.z);
  }

  const k = (n: number) => Number(n.toFixed(3));
  const sorok = dobozok
    .map(
      (d) =>
        `  { dx: ${k((d.x0 + d.x1) / 2)}, hx: ${k((d.x1 - d.x0) / 2)}` +
        `, dy: ${k((d.y0 + d.y1) / 2)}, hy: ${k((d.y1 - d.y0) / 2)}` +
        `, dz: ${k((d.z0 + d.z1) / 2)}, hz: ${k((d.z1 - d.z0) / 2)} },`,
    )
    .join("\n");

  const terfogat = dobozok.reduce(
    (s, d) => s + (d.x1 - d.x0) * (d.y1 - d.y0) * (d.z1 - d.z0),
    0,
  );
  const regi = H.x * 2 * H.y * 2 * H.z * 2;

  const tartalom = `/**
 * Az AUTO utkozo dobozai -- MERT ertekek.
 *
 * GENERALT FAJL -- ne szerkeszd kezzel. A
 * packages/client/scripts/auto-meret.ts allitja elo a jarmu-modellbol
 * (npm run auto-meret).
 *
 * MIERT TOBB DOBOZ: a talalatot korabban egyetlen doboz dontotte el, a
 * modell teljes befoglaloja. Az also felen ez jo, a KABIN magassagaban
 * viszont az auto 1,4-1,8 m szeles es 2-2,8 m hosszu, a doboz meg vegig
 * 2,18 x 4,91 -- a motorhaztetö es a csomagtarto FOLOTTI levego is
 * talalatnak szamitott.
 *
 * Merve: a regi doboz ${(regi).toFixed(1)} m3, ez a ${dobozok.length} doboz ${terfogat.toFixed(1)} m3
 * (${Math.round((100 * terfogat) / regi)}%), es MINDEGYIK a regi dobozon belul van -- tehat
 * senki nem lett eltalalhatobb, csak a hamis talalatok tuntek el.
 *
 * A koordinatak az auto sajat rendszereben ertendok, az origo a fizikai
 * doboz kozeppontja (+Z hatra, +Y felfele).
 *
 * A FEGYVER NINCS benne: az celzaskor elfordul, tehat egy
 * auto-rogzitett doboz vagy nem fedne, vagy a teljes soport teruletet
 * lefoglalna.
 */

export interface CarBox {
  /** Kozeppont az auto sajat rendszereben. */
  dx: number;
  dy: number;
  dz: number;
  /** Fel-meretek. */
  hx: number;
  hy: number;
  hz: number;
}

export const CAR_BOXES: CarBox[] = [
${sorok}
];
`;

  writeFileSync(new URL(KIMENET, import.meta.url), tartalom, "utf8");
  console.log(`=== Az auto kimerve -> ${KIMENET}\n`);
  console.log("  y-tol   y-ig  szelesseg   hossz");
  for (const d of dobozok) {
    console.log(
      `  ${d.y0.toFixed(2).padStart(5)}  ${d.y1.toFixed(2).padStart(5)}` +
        `  ${(d.x1 - d.x0).toFixed(2).padStart(9)}  ${(d.z1 - d.z0).toFixed(2).padStart(6)}`,
    );
  }
  console.log(
    `\n  ${dobozok.length} doboz, ${terfogat.toFixed(1)} m3 ` +
      `(a regi egyetlen doboz ${regi.toFixed(1)} m3 volt -- ${Math.round((100 * terfogat) / regi)}%)`,
  );
}

main();
