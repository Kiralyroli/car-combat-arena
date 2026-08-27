/**
 * Gepfegyver vegponttol vegpontig: talalat, nyomjelzo, tulmelegedes.
 *
 * A check:weapons tiszta szamtant mer. Ez azt ellenorzi, ami CSAK
 * egyben derul ki: a kliens nyomva tartja a gombot, a szerver a sajat
 * tickjen tuzel, eltalalja a masik jatekost, levonja a HP-t, es a
 * nyomjelzo a masik kliensen is megjelenik.
 *
 * A CELZAS SZANDEKOSAN oda tortenik, AHOL A LOVO LATJA az ellenfelet
 * (a kliens interpolalt, kesleltetett kepe alapjan) -- nem a "valodi"
 * szerver-oldali helyre. Pontosan ez a jatekos helyzete is, es ez teszi
 * probara a szerver visszatekereset: a szervernek oda kell
 * visszatekernie, ahol a lovo latta a celpontot.
 *
 * A `--lag=` kapcsoloval a kesleltetes is beallithato.
 *
 * Futtatas: npm run check:mg   (vagy: npm run check:mg -- --lag=200)
 */
import { OVERHEAT_FLASH_MS } from "@cca/shared";
import { chromium, type Browser, type Page } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const lagArg = process.argv.find((a) => a.startsWith("--lag="));
const LAG_MS = lagArg ? Number(lagArg.split("=")[1]) : 0;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openClient(
  name: string,
  weapon: string,
  hash: string,
): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  [oldal-hiba: ${name}] ${e.message}`));
  const lag = LAG_MS > 0 ? `&lag=${LAG_MS}` : "";
  await page.goto(`${CLIENT_URL}?name=${name}&weapon=${weapon}${lag}&dekor=0${hash}`);
  await page.waitForFunction(() => !!(window as any).__spike?.net?.playerId, null, {
    timeout: 20000,
  });
  return { browser, page };
}

/** Az autot adott helyre allitjuk, a fizika sajat resetjevel. */
async function placeAt(page: Page, x: number, z: number): Promise<void> {
  await page.evaluate(
    ([px, pz]) => {
      (window as any).__spike.backend.reset({ x: px, y: 1.2, z: pz });
    },
    [x, z],
  );
}

/** Ahol a LOVO latja az ellenfelet (interpolalt, kesleltetett kep). */
async function seenPosition(
  page: Page,
): Promise<[number, number, number] | null> {
  return (await page.evaluate(() => {
    const spike = (window as any).__spike;
    const ids = spike.net.remotes.ids();
    if (ids.length === 0) return null;
    const transform = spike.view.remoteCarTransform(ids[0]);
    return transform ? transform.position : null;
  })) as [number, number, number] | null;
}

/**
 * Milyen kozel megy el a felezoegyenes a ponthoz (m).
 *
 * A sugar iranyat a ket atadott pont adja meg; a merofuggveny a
 * merőleges tavolsagot adja vissza.
 */
function distanceToRay(
  point: readonly number[],
  from: readonly number[],
  through: readonly number[],
): number {
  const dx = through[0] - from[0];
  const dy = through[1] - from[1];
  const dz = through[2] - from[2];
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1e-9) return Infinity;
  const t =
    ((point[0] - from[0]) * dx +
      (point[1] - from[1]) * dy +
      (point[2] - from[2]) * dz) /
    len2;
  return Math.hypot(
    from[0] + dx * t - point[0],
    from[1] + dy * t - point[1],
    from[2] + dz * t - point[2],
  );
}

/**
 * A celkeresztet a megadott vilagbeli pontra visszuk -- ES MEG IS
 * NEZZUK, hogy tenyleg oda mutat.
 *
 * A vetites onmagaban NEM eleg. A kamera a teleportalas utan meg
 * lerpel: mire az egerkurzor a kiszamolt kepernyopontra er, a kamera
 * mar odebb van, es ugyanaz a pixel egy MASIK vilagbeli iranyt jelent.
 * Igy a teszt "sikeresen celzott", kozben minden loves a celpont ele,
 * a talajba ment -- 0 talalat 19 lovesbol, latszolag ok nelkul.
 *
 * Ezert korbe-visszacsatolunk: a kliens sajat aimPointAt-jevel
 * megkerdezzuk, hova mutat MOST a celkereszt, es addig igazitunk, amig
 * tenyleg a celpontnal nincs. Ugyanezt teszi a jatekos is -- nem egy
 * kepernyopontot jegyez meg, hanem a celponton tartja a keresztet.
 */
async function aimAt(
  page: Page,
  target: [number, number, number],
): Promise<boolean> {
  // A celzas akkor jo, ha a sugar ennyin belul megy el a celpont
  // KOZEPPONTJA mellett.
  //
  // Az elso valasztas 0.8 m volt -- "az auto 2 m szeles, tehat belefer".
  // Csakhogy a fel-szelesseg EPP 1 m: egy 0.8 m-re elmeno sugar mar a
  // karosszeria szelet surolja, es a szorassal a lovesek egy resze
  // mellemegy. A teszt ettol hol 100%-os, hol 31%-os talalati aranyt
  // adott -- ugyanazzal a kóddal, valodi hiba nelkul. 0.35 m-nel a
  // celpont kozepe fele lovunk, ahol a szoras sem szamit.
  const TOLERANCE_M = 0.35;

  for (let attempt = 0; attempt < 40; attempt++) {
    const screen = (await page.evaluate((t: number[]) => {
      const camera = (window as any).__spike.view.camera;
      if (!camera) return null;
      // Vector3-at a kamerabol kolcsonzunk: a THREE nincs kulon kiteve.
      const point = camera.position.clone();
      point.set(t[0], t[1], t[2]);
      point.project(camera);
      return [
        (point.x * 0.5 + 0.5) * window.innerWidth,
        (-point.y * 0.5 + 0.5) * window.innerHeight,
      ];
    }, target)) as [number, number] | null;
    if (!screen) return false;

    await page.mouse.move(screen[0], screen[1]);
    await sleep(120);

    const ray = (await page.evaluate(() => {
      const spike = (window as any).__spike;
      const [x, y] = spike.aim.ndc();
      return {
        from: spike.view.camera.position.toArray(),
        to: spike.view.aimPointAt(x, y),
      };
    })) as { from: number[]; to: number[] };

    // NEM a celkereszt alatti pont es a celpont TAVOLSAGAT merjuk: a
    // sugar az auto FELULETEN all meg, ami a kozepponttol joformán
    // fel autohossznyira van -- egy tokeletes celzas is 2.5 m-t adna.
    // Ehelyett azt kerdezzuk, milyen kozel MEGY EL a sugar a celpont
    // kozeppontja mellett: ez fugg csak a celzas iranyatol.
    const off = distanceToRay(target, ray.from, ray.to);
    if (off <= TOLERANCE_M) return true;
  }
  return false;
}

const hpOf = (page: Page) => page.evaluate("window.__spike.net.hp") as Promise<number>;
const shotsOf = (page: Page) =>
  page.evaluate("window.__spike.view.tracersSpawned") as Promise<number>;

/**
 * Tuzeles, kozben a hoszint CSUCSAT is merve.
 *
 * A pillanatnyi hoszint felrevezet: tulmelegedes utan a fegyver hulni
 * kezd, meg nyomva tartott gombbal is -- egy kesobbi mintavetel igy
 * alacsony erteket mutatna, holott kozben elerte a maximumot.
 */
async function fireFor(
  page: Page,
  ms: number,
  /**
   * Ha meg van adva, tuzeles KOZBEN is a celponton tartjuk a keresztet.
   *
   * Ezt egy jatekos is megteszi. A teszt korabban csak a sorozat ELOTT
   * celzott, es ha a kamera meg befele tartott a helyere, a rogzitett
   * egerpozicio kozben mas vilagbeli iranyt kezdett jelenteni -- innen
   * jott a hol 100%, hol 22% talalati arany. A mozgo celpont kovetese
   * MAS kerdes (lasd lentebb, azt szandekosan nem merjuk itt); ez a
   * celpont all, csak a kamera nem.
   */
  keepOn?: [number, number, number],
): Promise<{ peakHeat: number; sawFlash: boolean; sawLabel: boolean }> {
  await page.mouse.down();
  let peakHeat = 0;
  // A VILLOGAST is menet kozben figyeljuk.
  //
  // Rovid (OVERHEAT_FLASH_MS), es a lefulladas barhol bekovetkezhet a
  // sorozaton belul -- a sorozat UTAN mar rég vege. Eloszor ott mertem,
  // es a teszt ugy bukott, mintha a villogas el sem indult volna.
  let sawFlash = false;
  // A HUD feliratat is MENET KOZBEN nezzuk: a lefulladas allapota a
  // hules soran megszunik, tehat a sorozat utan mar megint szazalek
  // allhat a kijelzon. (Merve: "59%" egy olyan futasban, ahol a fegyver
  // kozben bizonyitottan lefulladt.)
  let sawLabel = false;
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await sleep(120);
    // EGY hivas: igazitas es mintavetel egyszerre. A headless lap 3-6
    // fps-en fut, es minden kulon oda-vissza hivas megvarja a fo szalat.
    const minta = (await page.evaluate((cel: number[] | undefined) => {
      const spike = (window as any).__spike;
      if (cel) {
        const camera = spike.view.camera;
        const pont = camera.position.clone();
        pont.set(cel[0], cel[1], cel[2]);
        pont.project(camera);
        const vaszon = document.querySelector("canvas");
        vaszon?.dispatchEvent(
          new MouseEvent("mousemove", {
            clientX: (pont.x * 0.5 + 0.5) * window.innerWidth,
            clientY: (-pont.y * 0.5 + 0.5) * window.innerHeight,
            bubbles: true,
          }),
        );
      }
      return {
        heat: spike.net.heat as number,
        villog:
          document.getElementById("weapon")?.classList.contains("tulmeleg") ??
          false,
        felirat:
          document.getElementById("weapon-state")?.textContent?.trim() ?? "",
      };
    }, keepOn)) as { heat: number; villog: boolean; felirat: string };
    peakHeat = Math.max(peakHeat, minta.heat);
    if (minta.villog) sawFlash = true;
    if (minta.felirat === "TULMELEG") sawLabel = true;
  }
  await page.mouse.up();
  return { peakHeat, sawFlash, sawLabel };
}

async function main(): Promise<void> {
  console.log(`=== Gepfegyver ===${LAG_MS > 0 ? ` (lag: ${LAG_MS} ms)` : ""}\n`);

  const A = await openClient("Loves", "machinegun", "");
  const roomCode = A.page.url().substring(A.page.url().indexOf("#") + 1);
  const B = await openClient("Celpont", "cannon", `#${roomCode}`);
  await sleep(1500);

  const weapon = await A.page.evaluate("window.__spike.net.ownWeapon");
  check("a szerver elfogadta a gepfegyvert", weapon === "machinegun", `${weapon}`);

  // ELOBB megvarjuk a meccs indulasat.
  //
  // Ket jatekosnal a meccs magatol elindul, es az indulas MINDENKIT
  // ujraszulet -- vagyis a szerver a spawn-pontra teszi az autokat.
  // Ha ez az athelyezes UTAN tortenne, felulirna azt, es a teszt ures
  // helyre celozna. Merve: emiatt bukott el egy futas ugy, hogy a
  // masikban ugyanaz a kod 100%-os talalati aranyt adott.
  await A.page.waitForFunction(
    () => (window as any).__spike?.net?.match?.phase === "playing",
    null,
    { timeout: 20000 },
  );
  await sleep(600);

  // Szabad sav: x = 25 mellett nincs akadaly. A a -Z iranyba nez
  // (reset utan), B 12 m-rel elotte.
  await placeAt(A.page, 25, 20);
  await placeAt(B.page, 25, 8);

  // MEGVARJUK, amig a SZERVER MINDKET autot a helyen tudja.
  //
  // A helyre allitas teleport, amit a plauzibilitas-ellenorzes eloszor
  // elutasit, es csak par elutasitas utan vesz at (resync). Amig ez
  // tart, a szerver MASHOL tudja az autot, mint ahol a kliens.
  //
  // A LOVORE ez a kritikus: a celzas szoget a kliens a SAJAT (uj)
  // pozicioja alapjan szamolja, a szerver viszont a sajat (regi)
  // pozicioja alapjan inditja a sugarat -- az irany igy jo, a
  // KIINDULOPONT nem, es minden loves mellemegy. Merve: emiatt adott
  // ugyanaz a teszt egyszer 100%-os, masszor 0%-os talalati aranyt.
  //
  // A sajat szerver-oldali pozicionkat nem latjuk kozvetlenul (a
  // snapshotbol kiszurjuk magunkat), ezert a MASIK kliens szemevel
  // nezzuk meg: B ugy latja A-t, ahogy a szerver tudja.
  const settled = async (): Promise<{ b: [number, number, number] | null; ok: boolean }> => {
    const b = await seenPosition(A.page);
    const a = await seenPosition(B.page);
    // SZOROS tures.
    //
    // Korabban 1.2 m volt, es a teszt neha 0%-os talalati aranyt adott
    // ugy, hogy a celzas bizonyitottan az ellenfelen volt: 12 m-en egy
    // 1.2 m-es eltolas mar tobb, mint az auto fel-szelessege, tehat a
    // lovo szerver-oldali helye annyira mellecsuszhatott, hogy a sugar
    // elment a celpont mellett. Az ujraszinkron ennel jóval pontosabban
    // beall -- csak meg kell varni.
    const TURES_M = 0.4;
    const bOk = b !== null && Math.hypot(b[0] - 25, b[2] - 8) < TURES_M;
    const aOk = a !== null && Math.hypot(a[0] - 25, a[2] - 20) < TURES_M;
    return { b, ok: bOk && aOk };
  };

  let seen: [number, number, number] | null = null;
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    const state = await settled();
    seen = state.b;
    if (state.ok) break;
  }
  const ready = (await settled()).ok;
  check(
    "a szerver mindket autot a helyen tudja",
    ready,
    seen
      ? `az ellenfel: (${seen[0].toFixed(1)}, ${seen[2].toFixed(1)}), vart: (25, 8)`
      : "nem lat tavoli autot",
  );
  if (!seen) {
    await A.browser.close();
    await B.browser.close();
    process.exitCode = 1;
    return;
  }

  // --- Fegyvervaltas: CSAK ujraszuleteskor ---
  //
  // A valasztasnak tetje van: harc kozben nem lehet atvaltani arra,
  // ami eppen jobban jonne. A szabalyt a SZERVER tartatja be, ezert a
  // kliens keresere adott valaszt merjuk, nem a gomb allapotat.
  //
  // FONTOS, hogy ez MEG A TUZELES ELOTT fusson: eloszor a vegere
  // tettem, es addigra a celpont mar halott volt -- a valtas tehat
  // jogosan ment at, es a teszt sajat elofeltetele volt hibas. Ezert
  // az eletben letet kulon is kimondjuk.
  const aliveBefore = await hpOf(B.page);
  await B.page.evaluate(() =>
    (window as any).__spike.net.selectWeapon("machinegun"),
  );
  await sleep(700);
  check(
    "elve NEM lehet fegyvert valtani",
    aliveBefore > 0 &&
      (await B.page.evaluate("window.__spike.net.ownWeapon")) === "cannon",
    `B HP: ${aliveBefore} -- a szerver elutasitotta a valtast`,
  );
  // ELOSZOR megvarjuk, hogy a kamera beallljon a teleport utan, es
  // csak UTANA celzunk: a celzas visszacsatolt, tehat a legutolso
  // igazitas mar az allo kamerara ervenyes.
  await sleep(400);
  const aimed = await aimAt(A.page, [seen[0], seen[1], seen[2]]);
  check(
    "a celkereszt tenylegesen az ellenfelen van",
    aimed,
    "a kliens sajat celzas-sugara az ellenfelet metszi",
  );

  // --- Sebzes ---
  const hpBefore = await hpOf(B.page);
  const shotsBefore = await shotsOf(A.page);
  const tracersBefore = await shotsOf(B.page);

  await fireFor(A.page, 1500, [seen[0], seen[1], seen[2]]);
  await sleep(900);

  const hpAfter = await hpOf(B.page);
  const shots = (await shotsOf(A.page)) - shotsBefore;
  const damage = hpBefore - hpAfter;
  // 4 sebzes lovesenkent -- ebbol jon vissza, hany loves talalt.
  const hits = damage / 4;

  check(
    "a gepfegyver sebzi a celpontot",
    damage > 0,
    `${hpBefore} -> ${hpAfter} HP`,
  );
  check(
    "a lovesek tobbsege talal",
    shots > 0 && hits / shots > 0.6,
    `${hits} talalat / ${shots} loves (${shots > 0 ? ((hits / shots) * 100).toFixed(0) : "0"}%)`,
  );
  check(
    "a nyomjelzo a MASIK kliensen is megjelenik",
    (await shotsOf(B.page)) > tracersBefore,
    `${(await shotsOf(B.page)) - tracersBefore} csik`,
  );

  // --- Tulmelegedes ---
  await aimAt(A.page, [seen[0], seen[1], seen[2]]);
  // HOSSZU sorozat: a lefulladasnak biztosan be kell kovetkeznie.
  //
  // 4 masodperc kevesnek bizonyult: a hoszint 84 es 99 kozott tetozott,
  // vagyis a fegyver EPP csak nem fulladt le -- a lefulladasra epulo
  // ellenorzesek (HUD-felirat, villogas) igy hol teljesultek, hol nem.
  // A tiszta szamtan szerint 2.7 masodperc eleg lenne, de a headless
  // lapon a tuzeles nem tokeletesen folyamatos. Nem a hatarhoz
  // meretezunk: 7 masodperc alatt akkor is lefullad, ha kozben
  // akadozik.
  const burst = await fireFor(A.page, 7000);
  // A hoszint PONTOS gorbejet a check:weapons meri, determinisztikusan.
  // Itt az ATVITEL a kerdes: eljut-e a szerver altal szamolt hoszint a
  // kliensig. Egy szoros kuszob itt csak ingatagga tenne a tesztet --
  // a mintavetel (120 ms) es a tulmelegedes utani azonnali hules miatt
  // a csucs koruli ertekek elcsuszhatnak.
  // A HUD ki is MONDJA, hogy tulmelegedett.
  //
  // Korabban a kijelzo a hoszintbol tippelt (>= 99%), ami gyakorlatilag
  // sosem teljesult -- a fegyver leallt, a HUD meg egy szazalekot
  // mutatott. A jatekos szamara ez magyarazat nelkuli leallas volt.
  check(
    "a HUD kiirja a tulmelegedest",
    burst.sawLabel,
    burst.sawLabel ? "a kijelzon: TULMELEG" : "a kijelzon vegig szazalek allt",
  );

// A kijelzo VILLOG a lefulladaskor -- es maganak abba is hagyja.
  //
  // A szin folyamatosan valtozik a hoszinttel; a lefulladas viszont
  // kulon figyelmeztetes, mert a jatekos ilyenkor hiaba tartja nyomva a
  // gombot. Rovid: ha a hules vegeig villogna (masodpercek), a jatekos
  // a sajat HUD-jat nezne a harc helyett.
  check(
    "lefulladaskor villog a fegyver-kijelzo",
    burst.sawFlash,
    burst.sawFlash ? "a .tulmeleg osztaly bekapcsolt" : "nem villogott",
  );
  // A villogas ABBAHAGYASA: addig varunk, amig lejar -- de nem tovabb.
  //
  // Nem egy pillanatot mintazunk: a lefulladas a sorozat VEGEN is
  // bekovetkezhet, olyankor a villogas meg jogosan tart. Az allitas az,
  // hogy MAGATOL abbamarad, nem az, hogy egy adott pillanatban all.
  let villogasVege = false;
  for (let i = 0; i < 20 && !villogasVege; i++) {
    villogasVege =
      (await A.page.evaluate(() =>
        document.getElementById("weapon")?.classList.contains("tulmeleg"),
      )) === false;
    if (!villogasVege) await sleep(120);
  }
  check(
    "a villogas maganak abbahagyja",
    villogasVege,
    `${OVERHEAT_FLASH_MS} ms-on belul magatol leall`,
  );

  check(
    "a hoszint tartos tuznel erdemben felfut",
    burst.peakHeat > 60,
    `csucs hoszint: ${burst.peakHeat.toFixed(0)} / 100`,
  );

  // A MOZGO celpontot (visszatekeres) SZANDEKOSAN nem itt merjuk.
  //
  // Megprobaltam: a teszt a celkereszttel koveti a mozgo autot, de a
  // headless lap ~5 fps-en fut, es minden kovetesi lepes egy oda-vissza
  // hivas -- igy a KOVETES kb. felmasodperces kesese nagyobb hibat
  // okozott, mint a merni kivant hatas (20%-os talalati arany, teljesen
  // a harness sebessegetol fuggoen). Egy ilyen szam nem regresszios
  // jelzes, csak zaj.
  //
  // Helyette a szerver oldalan, bongeszo nelkul merjuk, ahol a ket eset
  // tisztan elkulonitheto: npm run check:rewind
  const bWeapon = await B.page.evaluate("window.__spike.net.ownWeapon");
  check("a masik jatekos agyuval maradt", bWeapon === "cannon", `${bWeapon}`);

  // Kiloljuk B-t, hogy a halal-kepernyo megjelenjen.
  //
  // A megsemmisulest MENET KOZBEN jegyezzuk fel, nem a vegen olvassuk
  // ki. B ugyanis ujraszuletik (RESPAWN_DELAY_MS), tehat egy kesobbi
  // mintavetel mar teli eletet lat -- a teszt ilyenkor azt jelentette,
  // hogy "a gepfegyver nem tudja kiloni az ellenfelet -- B HP: 100",
  // holott epp az elobb lotte ki. Az allitas az, hogy KI TUDJA loni:
  // ezt az bizonyitja, hogy az elet valaha nullara esett.
  // MEGVARJUK, hogy a fegyver lehuljon.
  //
  // Az elozo sorozat epp azert volt hosszu, hogy TULMELEGEDJEN -- ha
  // rogton nekiallunk kiloni B-t, az elso menet lefulladt fegyverrel
  // indul, es ures. Negy menetbol egy igy elveszett, es a teszt
  // idonkent ugy bukott, hogy "a gepfegyver nem tudja kiloni az
  // ellenfelet", holott csak varni kellett volna.
  for (let i = 0; i < 40; i++) {
    const forro = await A.page.evaluate(
      () => (window as any).__spike.net.overheated as boolean,
    );
    if (!forro) break;
    await sleep(200);
  }

  let killed = false;
  for (let round = 0; round < 4 && !killed; round++) {
    // ELOSZOR megnezzuk, el-e meg: halott autora celozni ertelmetlen, es
    // draga is -- a visszacsatolt aimAt 40 probalkozason at keresne a
    // mar eltunt kocsit.
    if ((await hpOf(B.page)) <= 0) {
      killed = true;
      break;
    }

    // B-t VISSZATESSZUK a helyere minden menetben.
    //
    // A sebzes-meres alatt B mar meg is halhatott (16 HP-rol indult), es
    // akkor a szerver egy MASIK spawn-pontra szuli ujra -- akar a palya
    // tuloldalara, a gepfegyver 70 m-es hatotavan kivulre. A teszt
    // ilyenkor a REGI helyere lott, es ugy bukott, hogy "a gepfegyver
    // nem tudja kiloni az ellenfelet". Nem a fegyverrol szolt, hanem
    // arrol, hogy a celpont idokozben elkerult.
    await placeAt(B.page, 25, 8);
    let helyen = false;
    for (let i = 0; i < 25 && !helyen; i++) {
      await sleep(200);
      const b = await seenPosition(A.page);
      helyen = b !== null && Math.hypot(b[0] - 25, b[2] - 8) < 0.4;
    }

    const at = await seenPosition(A.page);
    if (at) await aimAt(A.page, at);
    // Tuzeles kozben is a celponton tartjuk a keresztet -- ugyanazert,
    // amiert a sebzes-meresnel (lasd fireFor).
    await fireFor(A.page, 2200, at ?? undefined);
    // A tuz KOZBEN is figyeljuk, nem csak a vegen -- a halal es az
    // ujraszuletes kozott csak nehany masodperc van.
    for (let i = 0; i < 14 && !killed; i++) {
      if ((await hpOf(B.page)) <= 0) killed = true;
      else await sleep(100);
    }
  }

  check(
    "a gepfegyver ki tudja loni az ellenfelet",
    killed,
    killed ? "B elete nullara esett" : `B HP: ${await hpOf(B.page)}`,
  );

  if (killed) {
    const pickVisible = await B.page.evaluate(
      "!document.getElementById('respawn-pick').hidden",
    );
    check(
      "halalkor megjelenik a fegyvervalaszto",
      pickVisible === true,
      "#respawn-pick lathato",
    );

    // A kattintast KIMONDVA ellenorizzuk: ha a gomb nincs meg, a
    // `button?.click()` CSENDBEN nem csinal semmit, es a teszt a vegen
    // egy talalgatos hibauzenettel bukna el.
    const clicked = await B.page.evaluate(() => {
      const button = document.querySelector(
        '#respawn-weapons button[data-weapon="machinegun"]',
      ) as HTMLButtonElement | null;
      if (!button || button.disabled) return false;
      button.click();
      return true;
    });
    check(
      "a halal-kepernyon rakattinthatunk a masik fegyverre",
      clicked,
      clicked ? "gepfegyver kivalasztva" : "a gomb nem elerheto",
    );

    // Meg halva kell lennie, kulonben a szerver joggal utasitja el.
    const stillDead = (await hpOf(B.page)) <= 0;

    // Az ujraszuletes utan mar az UJ fegyverrel kell jatszania.
    let switched = false;
    for (let i = 0; i < 40; i++) {
      await sleep(300);
      if ((await B.page.evaluate("window.__spike.net.ownWeapon")) === "machinegun") {
        switched = true;
        break;
      }
    }
    check(
      "halal utan viszont lehet valtani",
      switched,
      switched
        ? "gepfegyverrel szuletett ujja"
        : `a valtas nem ment at (a kattintaskor halott volt: ${stillDead})`,
    );
  }

  await A.browser.close();
  await B.browser.close();

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
