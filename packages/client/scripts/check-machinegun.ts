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
  await page.goto(`${CLIENT_URL}?name=${name}&weapon=${weapon}${lag}${hash}`);
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
  // kozeppontja mellett. Egy auto kb. 2 m szeles, tehat 0.8 m biztos
  // talalat.
  const TOLERANCE_M = 0.8;

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
const heatOf = (page: Page) => page.evaluate("window.__spike.net.heat") as Promise<number>;
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
): Promise<{ peakHeat: number }> {
  await page.mouse.down();
  let peakHeat = 0;
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await sleep(120);
    peakHeat = Math.max(peakHeat, await heatOf(page));
  }
  await page.mouse.up();
  return { peakHeat };
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
    const bOk = b !== null && Math.hypot(b[0] - 25, b[2] - 8) < 1.2;
    const aOk = a !== null && Math.hypot(a[0] - 25, a[2] - 20) < 1.2;
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

  await fireFor(A.page, 1500);
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
  const burst = await fireFor(A.page, 4000);
  // A hoszint PONTOS gorbejet a check:weapons meri, determinisztikusan.
  // Itt az ATVITEL a kerdes: eljut-e a szerver altal szamolt hoszint a
  // kliensig. Egy szoros kuszob itt csak ingatagga tenne a tesztet --
  // a mintavetel (120 ms) es a tulmelegedes utani azonnali hules miatt
  // a csucs koruli ertekek elcsuszhatnak.
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
  await aimAt(A.page, seen);
  for (let round = 0; round < 4; round++) {
    if ((await hpOf(B.page)) <= 0) break;
    const at = await seenPosition(A.page);
    if (at) await aimAt(A.page, at);
    await fireFor(A.page, 2200);
    await sleep(1400);
  }

  const killed = (await hpOf(B.page)) <= 0;
  check(
    "a gepfegyver ki tudja loni az ellenfelet",
    killed,
    `B HP: ${await hpOf(B.page)}`,
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
