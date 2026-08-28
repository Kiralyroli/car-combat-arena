/**
 * Az epulet-modellek KIMERESE -> packages/shared/src/arenaProps.ts
 *
 * MIT MER, ES MIERT:
 *
 * 1. A teljes befoglalo meretet. Ebbol jon a modell magassaga, es ebbol
 *    szamol a palyahatar elhelyezese (perimeterPlacements).
 *
 * 2. A TALAJSZINTI ALAPRAJZOT -- ez a lenyeg. Az utkozo dobozt korabban
 *    a teljes befoglalo doboz adta, ami egy nyitott acelszerkezetnel
 *    vagy egy negy labon allo viztoronynal durvan hazudik: a jatekos
 *    egy 9,8 x 9,8 m-es tomor hasabnak megy neki ott, ahol negy lab all,
 *    es kozottuk at kellene lehessen hajtani. (Merve: a Watertower_1
 *    dobozanak 17%-a tomor talajszinten.)
 *
 *    Ezert a modell UTKOZES_MAGASSAG alatti geometriajat egy racsra
 *    vetitjuk, a zart belsoket kitoltjuk, es a kapott alaprajzot
 *    lefedjuk nehany teglalappal. Ezekbol lesznek az utkozo dobozok.
 *
 * A MERES A BONGESZOBEN tortenik, mert a modellt a GLTFLoader tolti be
 * -- pontosan ugyanaz a kod, ami a jatekban is fut. Egy kulon,
 * Node-oldali GLB-ertelmezo mashogy tevedhetne, mint a jatek, es akkor
 * eppen azt a csuszast vinnenk be, ami ellen az egesz keszult.
 *
 * Futtatas (fusson a kliens dev szerver): npm run kit-meret
 */
import { writeFileSync } from "node:fs";
import { UTKOZES_MAGASSAG } from "@cca/shared";
import { chromium } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const KIMENET = "../../shared/src/arenaProps.ts";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Meres {
  nev: string;
  szelesseg: number;
  melyseg: number;
  magassag: number;
  talpak: {
    dx: number;
    dz: number;
    szelesseg: number;
    melyseg: number;
    magassag: number;
  }[];
  cellak: number;
  racsCellak: number;
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  [oldal-hiba] ${e.message}`));
  await page.goto(`${CLIENT_URL}?name=Meres`);
  await page.waitForFunction(
    () => !!(window as any).__spike?.view?.propTemplates?.size,
    null,
    { timeout: 30000 },
  );
  // A GLB egyben erkezik, de a sablonok a betoltes utan kerulnek be.
  await sleep(3000);

  const meresek = (await page.evaluate((MAG: number) => {
    const v = (window as any).__spike.view;
    const ki: any[] = [];

    for (const [nev, sablon] of v.propTemplates as Map<string, any>) {
      // UGY meressuk, AHOGY A JATEK KIRAKJA: klon, sajat pozicio
      // nullazva, yaw nulla (a forgatas a palyan tortenik).
      const klon = sablon.clone(true);
      klon.position.set(0, 0, 0);
      klon.rotation.y = 0;
      klon.updateWorldMatrix(true, true);

      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      // A talaj-kozeli haromszogek befoglaloi (kesobb a racsra kerulnek).
      const also: number[][] = [];
      // MINDEN haromszog befoglaloja + a teteje: ebbol lesz a
      // magassag-terkep (lasd lentebb).
      const mind: number[][] = [];
      let tx0 = Infinity;
      let tx1 = -Infinity;
      let tz0 = Infinity;
      let tz1 = -Infinity;

      klon.traverse((o: any) => {
        if (!o.isMesh || !o.geometry?.attributes?.position) return;
        const g = o.geometry;
        const a = g.attributes.position;
        const idx = g.index;
        const n = idx ? idx.count : a.count;
        for (let i = 0; i < n; i += 3) {
          const p: number[][] = [];
          for (let k = 0; k < 3; k++) {
            const j = idx ? idx.getX(i + k) : i + k;
            const e = new o.position.constructor(a.getX(j), a.getY(j), a.getZ(j));
            o.localToWorld(e);
            p.push([e.x, e.y, e.z]);
          }
          const ax0 = Math.min(p[0][0], p[1][0], p[2][0]);
          const ax1 = Math.max(p[0][0], p[1][0], p[2][0]);
          const ay0 = Math.min(p[0][1], p[1][1], p[2][1]);
          const ay1 = Math.max(p[0][1], p[1][1], p[2][1]);
          const az0 = Math.min(p[0][2], p[1][2], p[2][2]);
          const az1 = Math.max(p[0][2], p[1][2], p[2][2]);
          if (ax0 < x0) x0 = ax0;
          if (ax1 > x1) x1 = ax1;
          if (ay0 < y0) y0 = ay0;
          if (ay1 > y1) y1 = ay1;
          if (az0 < z0) z0 = az0;
          if (az1 > z1) z1 = az1;
          mind.push([ax0, ax1, az0, az1, ay1]);
          // A HAROMSZOG ALJA szamit: egy ferde tetolap alja meg lehet
          // automagassagban akkor is, ha a teteje jóval felette van.
          if (ay0 <= MAG) {
            also.push([ax0, ax1, az0, az1]);
            if (ax0 < tx0) tx0 = ax0;
            if (ax1 > tx1) tx1 = ax1;
            if (az0 < tz0) tz0 = az0;
            if (az1 > tz1) tz1 = az1;
          }
        }
      });
      if (!also.length) continue;

      // --- Racs ---
      //
      // A cella merete a modellhez igazodik: egy 3 m-es tartalynal a
      // durva cella maga tenne negyzetesse a hengert (eppen azt a hibat,
      // amit javitani akarunk), egy 190 m-es eromunel viszont a finom
      // racs feleslegesen sok dobozt adna.
      //
      // Merve: 1 / 0,5 m-rol 0,5 / 0,25 m-re valtva a rakodoszin
      // oszlopai 2 m helyett 1 m vastagok (112 -> 56 m2 folos utkozes),
      // a Hangar_2 21%-kal szorosabb -- 165 helyett 241 doboz aran.
      const CELLA = Math.max(x1 - x0, z1 - z0) > 20 ? 0.5 : 0.25;
      const gx0 = Math.floor(tx0 / CELLA) - 1;
      const gx1 = Math.floor(tx1 / CELLA) + 1;
      const gz0 = Math.floor(tz0 / CELLA) - 1;
      const gz1 = Math.floor(tz1 / CELLA) + 1;
      const W = gx1 - gx0 + 1;
      const H = gz1 - gz0 + 1;

      // A haromszog BEFOGLALOJA jeloli meg a cellakat, nem a csucsai:
      // egy nagy lap kozepe kulonben kimaradna. Ez FELFELE kerekit --
      // inkabb mond tomornek valamit, mint uresnek. Szandekos: az
      // utkozes legyen inkabb kicsit nagyobb a modellnel, mint kisebb
      // (kisebbnel a jatekos BELELATNA a falba).
      const tomor: boolean[] = new Array(W * H).fill(false);
      for (const t of also) {
        for (let x = Math.floor(t[0] / CELLA); x <= Math.floor(t[1] / CELLA); x++) {
          for (let z = Math.floor(t[2] / CELLA); z <= Math.floor(t[3] / CELLA); z++) {
            tomor[(x - gx0) * H + (z - gz0)] = true;
          }
        }
      }

      // --- MAGASSAG-TERKEP ---
      //
      // Cellankent a folotte allo geometria teteje. Enelkul minden
      // doboz a modell TELJES magassagat kapna, ami a loveseknel
      // hazudik: egy 1,4 m-es rakodoperon nyolcmeteres falkent allitana
      // meg a lovedeket. (Merve: 165 dobozbol 123 lehet alacsonyabb.)
      //
      // Itt MINDEN geometria szamit, nem csak az automagassag alatti: a
      // doboznak addig kell felernie, ameddig a modell tart.
      const magassagTerkep: number[] = new Array(W * H).fill(0);
      for (const t of mind) {
        for (let x = Math.floor(t[0] / CELLA); x <= Math.floor(t[1] / CELLA); x++) {
          for (let z = Math.floor(t[2] / CELLA); z <= Math.floor(t[3] / CELLA); z++) {
            const i = (x - gx0) * H + (z - gz0);
            if (i >= 0 && i < W * H && t[4] > magassagTerkep[i]) {
              magassagTerkep[i] = t[4];
            }
          }
        }
      }

      // --- ZART BELSO kitoltese ---
      //
      // Egy csarnoknak csak a FALA ad geometriat, a belseje ures --
      // pedig oda nem lehet behajtani. Amit a keret felol nem erunk el,
      // az belul van, tehat tomor. (Ha a falon nyilas van, a kitoltes
      // oda "beszivarog" -- az viszont helyes: ott tenyleg be lehet
      // hajtani.)
      const kint: boolean[] = new Array(W * H).fill(false);
      const verem = [0];
      kint[0] = true;
      while (verem.length) {
        const i = verem.pop() as number;
        const cx = Math.floor(i / H);
        const cz = i % H;
        const szomszedok = [
          [cx + 1, cz],
          [cx - 1, cz],
          [cx, cz + 1],
          [cx, cz - 1],
        ];
        for (const [nx, nz] of szomszedok) {
          if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
          const j = nx * H + nz;
          if (kint[j] || tomor[j]) continue;
          kint[j] = true;
          verem.push(j);
        }
      }
      const maszk = tomor.map((t, i) => t || !kint[i]);

      // --- FEDES teglalapokkal ---
      //
      // Mindig a legnagyobb, teljesen foglalt teglalapot vesszuk ki. Nem
      // optimalis fedes, de keves dobozt ad, es minden doboz TELJESEN a
      // maszkon belul van -- vagyis sosem lesz utkozes ott, ahol a
      // modellnek nyoma sincs.
      const maradek = [...maszk];
      const talpak: any[] = [];
      for (let kor = 0; kor < 400; kor++) {
        let jo: number[] | null = null;
        let joTerulet = 0;
        for (let ax = 0; ax < W; ax++) {
          for (let az = 0; az < H; az++) {
            if (!maradek[ax * H + az]) continue;
            let maxZ = H;
            for (let bx = ax; bx < W; bx++) {
              let z = az;
              while (z < maxZ && maradek[bx * H + z]) z++;
              maxZ = z;
              if (maxZ === az) break;
              const ter = (bx - ax + 1) * (maxZ - az);
              if (ter > joTerulet) {
                joTerulet = ter;
                jo = [ax, az, bx, maxZ - 1];
              }
            }
          }
        }
        // A negyed negyzetmeternel kisebb folt mar nem er dobozt: az
        // auto ugyse akad fel rajta, a lista viszont tele lenne veluk.
        // (A kuszob TERULETBEN van, nem cellaban -- kulonben a finomabb
        // racs csendben egyre apróbb dobozokat engedne at.)
        if (!jo || joTerulet * CELLA * CELLA < 0.25) break;
        for (let x = jo[0]; x <= jo[2]; x++) {
          for (let z = jo[1]; z <= jo[3]; z++) maradek[x * H + z] = false;
        }
        // A doboz magassaga a LEGMAGASABB cellaja: igy sosem lesz
        // alacsonyabb a modellnel, csak esetleg magasabb.
        let magassag = 0;
        for (let x = jo[0]; x <= jo[2]; x++) {
          for (let z = jo[1]; z <= jo[3]; z++) {
            const h = magassagTerkep[x * H + z];
            if (h > magassag) magassag = h;
          }
        }
        const vx0 = (gx0 + jo[0]) * CELLA;
        const vx1 = (gx0 + jo[2] + 1) * CELLA;
        const vz0 = (gz0 + jo[1]) * CELLA;
        const vz1 = (gz0 + jo[3] + 1) * CELLA;
        talpak.push({
          dx: (vx0 + vx1) / 2,
          dz: (vz0 + vz1) / 2,
          szelesseg: vx1 - vx0,
          melyseg: vz1 - vz0,
          magassag,
        });
      }

      ki.push({
        nev,
        szelesseg: x1 - x0,
        melyseg: z1 - z0,
        magassag: y1 - y0,
        talpak,
        cellak: maszk.filter(Boolean).length,
        racsCellak: W * H,
      });
    }
    return ki;
  }, UTKOZES_MAGASSAG)) as Meres[];

  await browser.close();

  if (meresek.length === 0) {
    console.log("HIBA: egyetlen modellt sem sikerult kimerni.");
    process.exitCode = 1;
    return;
  }

  meresek.sort((a, b) => a.nev.localeCompare(b.nev));
  const k = (n: number) => Number(n.toFixed(3));

  const sorok = meresek
    .map(
      (m) =>
        `  ${m.nev}: { szelesseg: ${k(m.szelesseg)}, melyseg: ${k(m.melyseg)}, magassag: ${k(m.magassag)} },`,
    )
    .join("\n");

  const talpSorok = meresek
    .map((m) => {
      const t = m.talpak
        .map(
          (x) =>
            `    { dx: ${k(x.dx)}, dz: ${k(x.dz)}, szelesseg: ${k(x.szelesseg)}, melyseg: ${k(x.melyseg)}, magassag: ${k(x.magassag)} },`,
        )
        .join("\n");
      const arany = Math.round((100 * m.cellak) / m.racsCellak);
      return `  // ${m.talpak.length} doboz; a befoglalo ${arany}%-a tomor talajszinten\n  ${m.nev}: [\n${t}\n  ],`;
    })
    .join("\n");

  const tartalom = `/**
 * Az epulet-modellek MERT meretei es TALAJSZINTI alaprajza.
 *
 * GENERALT FAJL -- ne szerkeszd kezzel. A
 * packages/client/scripts/kit-meret.ts allitja elo a modellbol
 * (epuletek.glb), ugy, ahogy a jatek betolti (npm run kit-meret).
 *
 * MIERT GENERALT: az utkozo doboznak PONTOSAN azt kell fednie, amit a
 * jatekos lat. Kezzel beirt szamoknal a ketto eszrevetlenul elcsuszna
 * -- a jatekos a falnak menne ott, ahol nincs fal, vagy athajtana egy
 * epuleten. Igy viszont a szam a modellbol jon, es a modell csereje
 * automatikusan atvezetodik.
 *
 * A meretek a JATEK tengelyeire vannak szamolva: szelesseg = X,
 * melyseg = Z, magassag = Y (a modellben a Blender Z-je a magassag).
 */

export interface PropMeret {
  szelesseg: number;
  melyseg: number;
  magassag: number;
}

/**
 * Egy utkozo teglalap a modell alaprajzabol.
 *
 * A dx/dz a teglalap kozeppontja a MODELL sajat origojahoz kepest (az
 * origo a talpon all, vizszintesen a modell kozepen).
 */
export interface PropTalp {
  dx: number;
  dz: number;
  szelesseg: number;
  melyseg: number;
  /**
   * A doboz magassaga: ameddig e folott a modell tart.
   *
   * NEM a modell teljes magassaga. Egy 1,4 m-es rakodoperon kulonben
   * nyolcmeteres falkent allitana meg a lovedeket.
   */
  magassag: number;
}

export const PROP_MERETEK = {
${sorok}
} as const;

/**
 * A modellek alaprajza ${UTKOZES_MAGASSAG} m magassagig, teglalapokkal fedve.
 *
 * MIERT NEM a teljes befoglalo doboz: egy nyitott acelszerkezetnel vagy
 * egy negy labon allo viztoronynal az durvan hazudna. Merve: a
 * Watertower_1 befoglalo dobozanak 17%-a tomor talajszinten -- a tobbi
 * helyen at kellene lehessen hajtani.
 *
 * Minden teglalap TELJESEN a modell alaprajzan belul van, tehat nincs
 * utkozes ott, ahol a modellnek nyoma sincs.
 */
export const PROP_TALPAK: Record<string, PropTalp[]> = {
${talpSorok}
};

/** A keszletben letezo modellek neve. */
export type PropNev = keyof typeof PROP_MERETEK;
`;

  writeFileSync(new URL(KIMENET, import.meta.url), tartalom, "utf8");
  console.log(`=== ${meresek.length} modell kimerve -> ${KIMENET}\n`);
  for (const m of meresek) {
    console.log(
      `  ${m.nev.padEnd(26)} ${m.szelesseg.toFixed(1)}x${m.melyseg.toFixed(1)}x${m.magassag.toFixed(1)} -> ${m.talpak.length} doboz`,
    );
  }
  console.log(
    `\n  osszesen ${meresek.reduce((s, m) => s + m.talpak.length, 0)} talp-doboz`,
  );
}

main();
