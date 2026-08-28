/**
 * A LOVES utkozo geometriaja -> packages/server/src/simulation/collisionData.ts
 *
 * MIERT: a talalatot a SZERVER donti el, es eddig tengely-parhuzamos
 * dobozokkal szamolt. A doboz nem tud lyukas lenni: ha egy epuleten
 * nyilas van, a jatekos latja, de nem tud atlonni rajta. A jatekos
 * szamara ez megmagyarazhatatlan -- a celkereszt a nyilason van, a
 * loves megis elakad.
 *
 * A szerver viszont NEM tolt be modellt: csak a kozos csomag tiszta
 * TypeScript-konstansait ismeri. Ezert a modellek haromszogeit ide
 * generaljuk ki, a szerver sajat forrasfajljaba.
 *
 * MIERT NEM a kozos csomagba: azt a KLIENS is behuzza, es ez az adat
 * kb. egy megabajt. A kliensnek nincs ra szuksege -- o a betoltott
 * modellekkel celoz (lasd aimPointAt).
 *
 * MIERT NEM kulon adatfajl: a szerver egyetlen fajlba bundle-olodik
 * (esbuild), es egy futasidoben beolvasott fajl uj deploy-lepes lenne.
 * Igy viszont a geometria egyszeruen kod.
 *
 * A KETTO EGYEZESET a check:shotmesh meri: ha a modell cserelodik es ez
 * a generalas elmarad, a szerver a REGI alakkal szamolna -- a jatekos
 * pedig ott kapna talalatot, ahol nem lat semmit.
 *
 * Futtatas (fusson a kliens dev szerver): npm run utkozes-meret
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const KIMENET = "../../server/src/simulation/collisionData.ts";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Halo {
  nev: string;
  vertices: number[];
  indices: number[];
}

/** Float32/Uint32 tomb -> base64, hogy a forrasfajl kezelheto maradjon. */
function b64(tomb: Float32Array | Uint32Array): string {
  return Buffer.from(tomb.buffer, tomb.byteOffset, tomb.byteLength).toString(
    "base64",
  );
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
    { timeout: 40000 },
  );
  await sleep(3000);

  // SEGEDFUGGVENY NELKUL: a tsx a megnevezett fuggvenyeket __name()
  // burokba teszi, az viszont a LAPON nem letezik.
  const halok = (await page.evaluate(() => {
    const v = (window as any).__spike.view;
    const ki: any[] = [];

    // --- Az epulet-modellek, SAJAT rendszerukben ---
    //
    // Ugy, ahogy a jatek kirakja oket: sajat pozicio nullazva, yaw
    // nulla. Az elhelyezes (eltolas + derekszogu forgatas) a szerveren
    // tortenik, a kozos LAYOUT-bol -- igy egy modellhez egy adat
    // tartozik, akkor is, ha tobbszor szerepel a palyan.
    const gyokerek: [string, any][] = [];
    for (const [nev, sablon] of v.propTemplates as Map<string, any>) {
      const klon = sablon.clone(true);
      klon.position.set(0, 0, 0);
      klon.rotation.y = 0;
      gyokerek.push([nev, klon]);
    }
    // --- Az AUTO, a fizikai test rendszereben ---
    //
    // A fegyver KIMARAD: celzaskor elfordul, tehat egy auto-rogzitett
    // alak vagy nem fedne, vagy a teljes soport teruletet lefoglalna.
    // A KEREKEK viszont benne vannak: sebzodnek, es celozni lehet rajuk.
    const w = v.chassisMesh;
    const launcher = v.launcher?.root ?? null;
    const autoGyoker = w.clone(true);
    // A klon a wrapper masolata; a fegyvert kivesszuk belole.
    for (const gy of [...autoGyoker.children]) {
      if (launcher !== null && gy.name === launcher.name) {
        autoGyoker.remove(gy);
      }
    }
    autoGyoker.position.set(0, 0, 0);
    autoGyoker.rotation.set(0, 0, 0);
    autoGyoker.quaternion.set(0, 0, 0, 1);
    for (const kerek of v.wheelGroups ?? []) {
      // A kerekek a JELENETBEN allnak, nem a wrapperben. A klonjukat a
      // wrapper rendszerebe kell vinni.
      const kk = kerek.clone(true);
      w.updateWorldMatrix(true, true);
      kerek.updateWorldMatrix(true, true);
      const rel = w.matrixWorld.clone().invert().multiply(kerek.matrixWorld);
      kk.matrix.copy(rel);
      kk.matrix.decompose(kk.position, kk.quaternion, kk.scale);
      autoGyoker.add(kk);
    }
    gyokerek.push(["__auto", autoGyoker]);

    for (const [nev, gyoker] of gyokerek) {
      gyoker.updateWorldMatrix(true, true);
      const inv = gyoker.matrixWorld.clone().invert();
      const vertices: number[] = [];
      const indices: number[] = [];
      gyoker.traverse((o: any) => {
        if (!o.isMesh || !o.geometry?.attributes?.position) return;
        const g = o.geometry;
        const a = g.attributes.position;
        const eltolas = vertices.length / 3;
        for (let i = 0; i < a.count; i++) {
          const e = new o.position.constructor(a.getX(i), a.getY(i), a.getZ(i));
          o.localToWorld(e);
          e.applyMatrix4(inv);
          vertices.push(e.x, e.y, e.z);
        }
        const idx = g.index;
        if (idx) {
          for (let i = 0; i < idx.count; i++) indices.push(eltolas + idx.getX(i));
        } else {
          for (let i = 0; i < a.count; i++) indices.push(eltolas + i);
        }
      });
      if (indices.length > 0) ki.push({ nev, vertices, indices });
    }
    return ki;
  })) as Halo[];

  await browser.close();

  if (halok.length === 0) {
    console.log("HIBA: egyetlen halot sem sikerult kimerni.");
    process.exitCode = 1;
    return;
  }

  halok.sort((a, b) => a.nev.localeCompare(b.nev));
  const sorok = halok
    .map((h) => {
      const v = b64(new Float32Array(h.vertices));
      const i = b64(new Uint32Array(h.indices));
      return (
        `  // ${h.indices.length / 3} haromszog\n` +
        `  ${JSON.stringify(h.nev)}: { v: "${v}", i: "${i}" },`
      );
    })
    .join("\n");

  const osszes = halok.reduce((s, h) => s + h.indices.length / 3, 0);
  const tartalom = `/**
 * A LOVES utkozo geometriaja -- MERT, GENERALT adat.
 *
 * GENERALT FAJL -- ne szerkeszd kezzel. A
 * packages/client/scripts/utkozes-meret.ts allitja elo a modellekbol
 * (npm run utkozes-meret).
 *
 * MIERT VAN: a talalatot a szerver donti el, es eddig tengely-parhuzamos
 * dobozokkal szamolt. A doboz nem tud lyukas lenni -- egy nyilason nem
 * lehetett atlonni, pedig a jatekos latta. Itt a modellek valodi
 * haromszogei vannak, ugyanabbol a fajlbol, amit a jatekos lat.
 *
 * A modellek a SAJAT rendszerukben allnak (eltolas nelkul, yaw = 0); az
 * elhelyezes a kozos LAYOUT-bol tortenik, futasidoben.
 *
 * ${halok.length} halo, osszesen ${osszes} haromszog.
 *
 * Az adat base64: egy tizezres szamlista forraskodkent olvashatatlan
 * lenne, es a fordito is megsinylene.
 */

export interface KodoltHalo {
  /** Float32 csucsok (x/y/z), base64. */
  v: string;
  /** Uint32 haromszog-indexek, base64. */
  i: string;
}

/** Kulcs: a modell neve; "__auto" a jarmu. */
export const UTKOZO_HALOK: Record<string, KodoltHalo> = {
${sorok}
};
`;

  writeFileSync(new URL(KIMENET, import.meta.url), tartalom, "utf8");
  console.log(`=== ${halok.length} halo -> ${KIMENET}\n`);
  for (const h of halok) {
    console.log(
      `  ${h.nev.padEnd(26)} ${String(h.indices.length / 3).padStart(6)} haromszog`,
    );
  }
  console.log(`\n  osszesen ${osszes} haromszog`);
}

main();
