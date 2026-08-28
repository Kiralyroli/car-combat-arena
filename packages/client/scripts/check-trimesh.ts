/**
 * A palya HAROMSZOG-testei.
 *
 * A palya dobozokbol epul fel (a modellek aszinkron erkeznek), es a
 * betoltes utan a belso epuletek dobozait lecsereljuk a modell valodi
 * haromszogeire. Ez a csere CSENDBEN elmaradhat -- hianyzo modell,
 * elcsuszott csoportnev, kimaradt hivas --, es a jatek attol meg menne,
 * csak eppen dobozokkal, ahogy eddig.
 *
 * Amit meg kell orizni:
 *
 *  - a PALYAHATAR dobozokbol marad. A hataroló epuletek modelljei
 *    lyukasak (kapuk, ablakok, oszlopkozok), es egy haromszog-pontos
 *    hataron az auto egyszeruen kitalalna a palyarol.
 *  - az auto tovabbra is NEKIMEGY az epuleteknek. A haromszog-halo
 *    legveszelyesebb hibaja, hogy nincs "belseje": ha valami elromlik,
 *    az auto athajt az epuleten ahelyett, hogy megallna.
 *
 * Futtatas: npm run check:trimesh
 */
import {
  ARENA_HALF,
  LAYOUT,
  PROP_MERETEK,
  perimeterPlacements,
} from "@cca/shared";
import { chromium } from "playwright";
import { UTKOZO_HALOK } from "../../server/src/simulation/collisionData";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  console.log("=== Palya haromszog-testei ===\n");

  // A DISZITES BE van kapcsolva: eppen a modellek a lenyeg.
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  [oldal-hiba] ${e.message}`));
  await page.goto(`${CLIENT_URL}?name=Trimesh`);
  await page.waitForFunction(() => !!(window as any).__spike?.net?.playerId, null, {
    timeout: 30000,
  });
  await sleep(2000);

  // --- Megtortent-e a csere? ---
  //
  // A VART szam adatbol jon, nem beegetve: minden BELSO epulet cserelodik
  // (a hataroló nem), ha a modellje betoltodott.
  {
    const adat = (await page.evaluate(() => {
      const s = (window as any).__spike;
      return {
        cserelt: s.trimeshDb,
        betoltott: [...(s.view.propTemplates?.keys() ?? [])],
      };
    })) as { cserelt: number; betoltott: string[] };

    const vart = LAYOUT.filter((p) => adat.betoltott.includes(p.prop)).length;
    check(
      "a belso epuletek dobozai haromszogekre cserelodtek",
      adat.cserelt === vart && vart > 0,
      `${adat.cserelt} epulet (vart: ${vart})`,
    );
  }

  // --- A PALYAHATAR dobozokbol maradt ---
  //
  // Ha a hatar is cserelodne, a szama nagyobb lenne a belso
  // epuletekenel. Ez a legdragabb hiba a keszletben: a lyukas
  // hatarmodelleken az auto kihajtana a palyarol.
  {
    const cserelt = (await page.evaluate(
      () => (window as any).__spike.trimeshDb,
    )) as number;
    const hatarDb = perimeterPlacements(ARENA_HALF).length;
    check(
      "a palyahatar dobozokbol maradt",
      cserelt <= LAYOUT.length,
      `${cserelt} csere, a ${hatarDb} hataroló epulet nincs kozottuk`,
    );
  }

  // --- A haromszog-test A HELYEN van ---
  //
  // A legdragabb hiba nem az, hogy elmarad a csere, hanem hogy a test
  // ELCSUSZIK a latvanytol: akkor a jatekos a semminek megy neki, vagy
  // athajt azon, amit lat. A csucsokat vilag-koordinatakban adjuk at,
  // tehat egy rossz eltolas vagy forgatas azonnal latszik: a testnek az
  // EPULET mert befoglalojan belul kell lennie, ott, ahova raktuk.
  {
    const kilog = (await page.evaluate(
      ([layout, meretek]: any[]) => {
        const v = (window as any).__spike.view;
        const rossz: string[] = [];
        for (const m of v.arenaTrimeshes()) {
          // A csoportnev "${prop}_${index}" -- innen jon az elhelyezes.
          const i = Number(m.csoport.slice(m.csoport.lastIndexOf("_") + 1));
          const p = layout[i];
          if (!p || `${p.prop}_${i}` !== m.csoport) {
            rossz.push(`${m.csoport}: nincs hozza elhelyezes`);
            continue;
          }
          const meret = meretek[p.prop];
          const forgatott = ((p.yaw ?? 0) % 180) !== 0;
          const felSz = (forgatott ? meret.melyseg : meret.szelesseg) / 2 + 0.5;
          const felMe = (forgatott ? meret.szelesseg : meret.melyseg) / 2 + 0.5;
          for (let k = 0; k < m.vertices.length; k += 3) {
            const dx = m.vertices[k] - p.x;
            const dy = m.vertices[k + 1];
            const dz = m.vertices[k + 2] - p.z;
            if (
              Math.abs(dx) > felSz ||
              Math.abs(dz) > felMe ||
              dy < -0.5 ||
              dy > meret.magassag + 0.5
            ) {
              rossz.push(
                `${m.csoport}: (${dx.toFixed(1)}, ${dy.toFixed(1)}, ${dz.toFixed(1)})`,
              );
              break;
            }
          }
        }
        return rossz;
      },
      [LAYOUT, PROP_MERETEK],
    )) as string[];

    check(
      "a haromszog-testek a sajat epuletukon belul vannak",
      kilog.length === 0,
      kilog.length === 0
        ? "egyik csucs sem lóg ki a mert befoglalobol"
        : kilog.slice(0, 3).join("; "),
    );
  }

  // --- A SZERVER geometriaja egyezik a modellekkel ---
  //
  // A talalatot a szerver donti el, a generalt haromszogekbol
  // (collisionData.ts). Ha a modell cserelodik es a generalas elmarad,
  // a szerver a REGI alakkal szamolna -- es ez CSENDES: a jatek megy, a
  // palya jol nez ki, csak eppen ott is talalat van, ahol a jatekos nem
  // lat semmit (vagy forditva).
  {
    const kliens = (await page.evaluate(() => {
      const v = (window as any).__spike.view;
      const ki: Record<string, number> = {};
      for (const [nev, sablon] of v.propTemplates as Map<string, any>) {
        let n = 0;
        sablon.traverse((o: any) => {
          if (!o.isMesh || !o.geometry?.attributes?.position) return;
          const g = o.geometry;
          n += (g.index ? g.index.count : g.attributes.position.count) / 3;
        });
        ki[nev] = Math.round(n);
      }
      return ki;
    })) as Record<string, number>;

    const elter: string[] = [];
    for (const [nev, db] of Object.entries(kliens)) {
      const kodolt = UTKOZO_HALOK[nev];
      if (!kodolt) {
        elter.push(`${nev}: hianyzik a szerver adatabol`);
        continue;
      }
      // A base64 hossza adja a haromszogek szamat: 3 index * 4 bajt.
      const bajt = Buffer.from(kodolt.i, "base64").byteLength;
      const szerver = bajt / 12;
      if (szerver !== db) {
        elter.push(`${nev}: kliens ${db}, szerver ${szerver}`);
      }
    }
    check(
      "a szerver haromszogei egyeznek a modellekkel",
      elter.length === 0,
      elter.length === 0
        ? `${Object.keys(kliens).length} modell, mind egyezik`
        : `${elter.slice(0, 3).join("; ")} -- futtasd: npm run utkozes-meret`,
    );
  }

  // --- A fizika nem lassult be ---
  //
  // A haromszog-testek dragabbak a dobozoknal. Ha a lepes ideje
  // elszallna, az egesz jatek akadozna -- es ezt egy kepernyokepen nem
  // lehet eszrevenni.
  {
    await sleep(1500);
    const lepes = (await page.evaluate(
      () => (window as any).__spike.stats().telemetry.stepMs,
    )) as number;
    check(
      "a fizikai lepes ideje elfogadhato",
      lepes < 4,
      `${lepes.toFixed(2)} ms/lepes (a 60 Hz-es keret 16,7 ms)`,
    );
  }

  await browser.close();

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
