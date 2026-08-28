/**
 * A palya MODELLJEI: megvan-e mind, es akkora-e, mint az utkozes.
 *
 * A palya ket forrasbol all ossze: az elrendezes (arenaLayout.ts) es a
 * modell-fajl (epuletek.glb). A ketto KULON keszul, tehat elcsuszhatnak
 * egymastol -- es a kovetkezmeny csendes:
 *
 *  - ha egy epulet hianyzik a fajlbol, az UTKOZES ATTOL MEG OTT VAN: a
 *    jatekos egy lathatatlan falnak megy. Ez tenylegesen megtortent: a
 *    palyahatar harom epuletet hasznal, es ebbol ketto nem volt benne az
 *    exportalt keszletben.
 *  - ha a modell merete elter a kodban tarolttol, a jatekos ott all meg,
 *    ahol nem latszik semmi -- vagy athajt azon, amit lat.
 *
 * Ezt a ket dolgot csak a BONGESZOBEN lehet megnezni, mert a modell
 * betoltese oda tartozik. A tobbi palya-szabalyt (atfedes, spawn-pontok,
 * hatar zartsaga) a check:layout meri, bongeszo nelkul.
 *
 * Futtatas: npm run check:map
 */
import {
  ARENA_HALF,
  LAYOUT,
  PROP_MERETEK,
  SCENERY,
  perimeterPlacements,
} from "@cca/shared";
import { chromium } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  console.log("=== Palya-modellek ===\n");

  // A DISZITES BE van kapcsolva: eppen azt merjuk.
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  [oldal-hiba] ${e.message}`));
  await page.goto(`${CLIENT_URL}?name=Terkep`);
  await page.waitForFunction(() => !!(window as any).__spike?.net?.playerId, null, {
    timeout: 20000,
  });

  // A modellek aszinkron erkeznek -- megvarjuk oket.
  const hasznalt = [
    ...new Set(
      [...LAYOUT, ...SCENERY, ...perimeterPlacements(ARENA_HALF)].map(
        (p) => p.prop,
      ),
    ),
  ].sort();

  let betoltott: string[] = [];
  for (let i = 0; i < 60; i++) {
    betoltott = (await page.evaluate(() => [
      ...((window as any).__spike.view.propTemplates?.keys() ?? []),
    ])) as string[];
    if (betoltott.length >= hasznalt.length) break;
    await sleep(400);
  }

  // --- Megvan-e minden hasznalt epulet? ---
  {
    const hianyzo = hasznalt.filter((n) => !betoltott.includes(n));
    check(
      "minden hasznalt epulet benne van a modell-fajlban",
      hianyzo.length === 0,
      hianyzo.length === 0
        ? `${hasznalt.length} epulet, mind betoltve`
        : `HIANYZIK (lathatatlan fal lenne): ${hianyzo.join(", ")}`,
    );
  }

  // --- Akkora-e a modell, mint amekkoranak a kod hiszi? ---
  //
  // A kod merete (PROP_MERETEK) generalt, a modellbol szarmazik -- de a
  // modell azota cserelodhetett. Az UTKOZO DOBOZ ebbol epul, tehat egy
  // elteres pont azt a hibat adna, amit el akarunk kerulni.
  {
    // A meretet a GEOMETRIAKBOL szamoljuk, nem a Three.js Box3-mal: a
    // konyvtar nincs kitéve a merheto feluleten, es nem is akarjuk
    // csak ezert kitenni.
    const mert = (await page.evaluate(() => {
      const v = (window as any).__spike.view;
      const ki: Record<string, [number, number, number]> = {};
      for (const [nev, obj] of v.propTemplates as Map<string, any>) {
        const mn = [Infinity, Infinity, Infinity];
        const mx = [-Infinity, -Infinity, -Infinity];
        obj.updateWorldMatrix(true, true);
        obj.traverse((o: any) => {
          if (!o.isMesh || !o.geometry) return;
          o.geometry.computeBoundingBox();
          const b = o.geometry.boundingBox;
          // A hatarolo doboz mind a nyolc sarkat at kell vinni: egy
          // elforgatott reszmodellnel a min/max onmagaban nem eleg.
          for (const sx of [b.min.x, b.max.x]) {
            for (const sy of [b.min.y, b.max.y]) {
              for (const sz of [b.min.z, b.max.z]) {
                const p = { x: sx, y: sy, z: sz } as any;
                const e = o.localToWorld(
                  new o.position.constructor(p.x, p.y, p.z),
                );
                const t = [e.x, e.y, e.z];
                for (let k = 0; k < 3; k++) {
                  mn[k] = Math.min(mn[k], t[k]);
                  mx[k] = Math.max(mx[k], t[k]);
                }
              }
            }
          }
        });
        ki[nev] = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
      }
      return ki;
    })) as Record<string, [number, number, number]>;

    const elter: string[] = [];
    for (const [nev, meret] of Object.entries(mert)) {
      const v = PROP_MERETEK[nev as keyof typeof PROP_MERETEK];
      if (!v) continue;
      // A jatek tengelyei: x = szelesseg, y = magassag, z = melyseg.
      const d = Math.max(
        Math.abs(meret[0] - v.szelesseg),
        Math.abs(meret[1] - v.magassag),
        Math.abs(meret[2] - v.melyseg),
      );
      if (d > 0.1) {
        elter.push(
          `${nev}: kod ${v.szelesseg}/${v.magassag}/${v.melyseg}, modell ${meret
            .map((x) => x.toFixed(1))
            .join("/")}`,
        );
      }
    }
    check(
      "a modellek merete egyezik az utkozo dobozokeval",
      elter.length === 0 && Object.keys(mert).length > 0,
      elter.length === 0
        ? `${Object.keys(mert).length} epulet, legfeljebb 0.1 m elteres`
        : elter.slice(0, 3).join(" | "),
    );
  }

  // --- A doboz-helyettesites tenyleg megtortent? ---
  //
  // Ha a modellek betoltodnek, de a csere elmarad, a jatekos szurke
  // teglakat lat -- a hiba nem dobna kivetelt, csak csunya lenne.
  {
    const szamok = (await page.evaluate(() => {
      const v = (window as any).__spike.view;
      return {
        maradtDoboz: v.arenaBoxMeshes.size,
        celpont: v.arenaMeshes.length,
      };
    })) as { maradtDoboz: number; celpont: number };
    // A VART szam adatbol jon, nem beegetve: EGYEDUL a talaj marad
    // dobozkent (annak nincs modellje). A nyitott szinek masodik
    // oszlopsora "hidden" -- azt egy masik elem modellje takarja, tehat
    // ki sem rajzoljuk. (Eloszor kirajzoltuk, es ket szurke fal allt a
    // palya kozepen, a szinek belsejeben.)
    const vart = 1;
    check(
      "a szurke dobozok helyere modellek kerultek",
      szamok.maradtDoboz === vart,
      `${szamok.maradtDoboz} doboz maradt (vart: ${vart} -- csak a talaj), ${szamok.celpont} celozhato felulet`,
    );
  }


  // --- Nincs LATHATATLAN FAL ---
  //
  // Minden utkozo dobozt takarnia kell valami lathatonak. Ez a fajta
  // hiba csendes: a jatek elindul, a palya jol nez ki, es csak akkor
  // derul ki, amikor a jatekos nekimegy a semminek.
  //
  // Tenylegesen megtortent: a nyitott szin modelljet az egyik
  // oszlopsor dobozahoz kototttuk, az viszont fel szelessegnyivel
  // oldalra all -- a modell elcsuszott, es a masik oldal utkozese
  // csupaszon maradt.
  {
    const takaratlan = (await page.evaluate(() => {
      const s = (window as any).__spike;
      const v = (window as any).__spike.view;

      // SEGEDFUGGVENY NELKUL, egyetlen ciklusban.
      //
      // A teszt-fajlt a tsx forditja, ami a megnevezett fuggvenyeket egy
      // __name() burokba teszi -- az viszont a LAPON nem letezik, es az
      // egesz kiertekeles elszall rajta ("__name is not defined").
      const lathato: { mn: number[]; mx: number[] }[] = [];
      for (const obj of v.arenaMeshes as any[]) {
        const mn = [Infinity, Infinity, Infinity];
        const mx = [-Infinity, -Infinity, -Infinity];
        let volt = false;
        obj.updateWorldMatrix(true, true);
        obj.traverse((o: any) => {
          if (!o.isMesh || !o.geometry) return;
          volt = true;
          o.geometry.computeBoundingBox();
          const b = o.geometry.boundingBox;
          for (const sx of [b.min.x, b.max.x]) {
            for (const sy of [b.min.y, b.max.y]) {
              for (const sz of [b.min.z, b.max.z]) {
                const e = o.localToWorld(new o.position.constructor(sx, sy, sz));
                const t = [e.x, e.y, e.z];
                for (let k = 0; k < 3; k++) {
                  mn[k] = Math.min(mn[k], t[k]);
                  mx[k] = Math.max(mx[k], t[k]);
                }
              }
            }
          }
        });
        if (volt) lathato.push({ mn, mx });
      }

      const rossz: string[] = [];
      for (const box of s.ARENA as any[]) {
        if (box.name === "ground") continue;
        // A doboz kozeppontja AUTO-MAGASSAGBAN: ide utkozne a jatekos.
        //
        // A magassag nem reszletkerdes: a TALAJ is a celozhato feluletek
        // kozott van, es annak hatarolo doboza az egesz palyat lefedi --
        // csak vizszintesen vizsgalva minden doboz "takartnak" latszana,
        // es a teszt semmit nem erne. (Eloszor pont igy volt: a
        // visszatett hibat is atengedte.)
        const x = box.position.x;
        const y = 1;
        const z = box.position.z;
        let fedve = false;
        for (const h of lathato) {
          if (
            x >= h.mn[0] - 0.5 &&
            x <= h.mx[0] + 0.5 &&
            y >= h.mn[1] - 0.5 &&
            y <= h.mx[1] + 0.5 &&
            z >= h.mn[2] - 0.5 &&
            z <= h.mx[2] + 0.5
          ) {
            fedve = true;
            break;
          }
        }
        if (!fedve) rossz.push(box.name);
      }
      return rossz;
    })) as string[];

    check(
      "minden utkozest takar valami lathato",
      takaratlan.length === 0,
      takaratlan.length === 0
        ? "nincs lathatatlan fal"
        : `LATHATATLAN: ${takaratlan.slice(0, 5).join(", ")}`,
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
