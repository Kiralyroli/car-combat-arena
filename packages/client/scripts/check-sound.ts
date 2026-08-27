/**
 * Hang -- vegponttol vegpontig, ket klienssel.
 *
 * MAGAT A HANGOT nem lehet automatikusan megitelni; a keveres szabalyait
 * a check:audio meri, bongeszo nelkul. Ami CSAK itt derul ki:
 *
 *  - a hangfajlok tenylegesen letoltodnek es dekodolhatok,
 *  - az AudioContext felebred a felhasznaloi gesztusra (e nelkul a
 *    jatek nemán futna, es semmi nem jelezne),
 *  - a nemitas mukodik es TULELI az ujratoltest,
 *  - a lovesek tenyleg inditanak hangot.
 *
 * Futtatas: npm run check:sound
 */
import { chromium, type Browser, type Page } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

async function openClient(
  name: string,
  weapon: string,
  hash: string,
): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({
    // A --autoplay-policy nelkul a headless Chrome ugyanugy blokkolja a
    // hangot, mint egy valodi bongeszo -- de MI EPP AZT akarjuk merni,
    // hogy a gesztus-alapu ebresztes mukodik, ezert NEM kapcsoljuk ki.
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  [oldal-hiba: ${name}] ${e.message}`));
  await page.goto(`${CLIENT_URL}?name=${name}&weapon=${weapon}${hash}`);
  await page.waitForFunction(() => !!(window as any).__spike?.net?.playerId, null, {
    timeout: 20000,
  });

  // GESZTUS a hang felebresztesehez.
  //
  // A teszt URL-parameterrel lep be, es ezzel KIHAGYJA a lobbyt --
  // vagyis azt a kattintast is, amivel egy valodi jatekos elinditja a
  // meccset. A bongeszo pedig gesztus nelkul nem enged hangot. Enelkul
  // a teszt azt merne, hogy nincs kattintas, nem azt, hogy szol-e a
  // hang. (Elsore pontosan ez tortent: 5 hiba ugy, hogy a termekben
  // semmi baj nem volt.)
  await page.keyboard.press("KeyR");
  return { browser, page };
}

const robbanasHangok = (page: Page) =>
  page.evaluate(
    () => (window as any).__spike.audio.inditottEbbol("robbanas") as number,
  ) as Promise<number>;

const allapot = (page: Page) =>
  page.evaluate(() => {
    const a = (window as any).__spike.audio;
    return {
      pufferek: a.pufferSzam,
      ctx: a.ctxAllapot,
      bekapcsolva: a.enabled,
      inditottak: a.inditottHangok,
    };
  }) as Promise<{
    pufferek: number;
    ctx: string | null;
    bekapcsolva: boolean;
    inditottak: number;
  }>;

async function main(): Promise<void> {
  console.log("=== Hang ===\n");

  const A = await openClient("Lovo", "machinegun", "");
  const roomCode = A.page.url().substring(A.page.url().indexOf("#") + 1);
  const B = await openClient("Celpont", "cannon", `#${roomCode}`);
  await sleep(1200);

  // --- Ebredes a gesztusra ---
  //
  // A lobbybol a belepes mar kattintas volt, tehat a hangnak ekkorra
  // fel kell ebrednie. Ha ez elromlik, a jatek NEMAN fut, es semmi nem
  // jelzi -- pont ezert kell megmerni.
  let allap = await allapot(A.page);
  for (let i = 0; i < 40 && (allap.ctx !== "running" || allap.pufferek < 5); i++) {
    await sleep(250);
    allap = await allapot(A.page);
  }
  check(
    "az AudioContext felebredt a felhasznaloi gesztusra",
    allap.ctx === "running",
    `allapot: ${allap.ctx}`,
  );
  check(
    "minden hang betoltodott es dekodolhato",
    allap.pufferek === 5,
    `${allap.pufferek} / 5 puffer`,
  );

  // --- A motor magatol szol ---
  //
  // Nem esemenyre indul, hanem folyamatosan megy -- tehat mar most
  // kell lennie egy hurkolt forrasnak.
  check(
    "a motorhang elindult magatol",
    (await A.page.evaluate(() => (window as any).__spike.audio.motorSzam)) > 0,
    "hurkolt forras a sajat autora",
  );

  // --- Tuzeles hangot indit ---
  await A.page.waitForFunction(
    () => (window as any).__spike?.net?.match?.phase === "playing",
    null,
    { timeout: 20000 },
  );
  await sleep(600);
  const elotte = (await allapot(A.page)).inditottak;
  await A.page.mouse.down();
  await sleep(900);
  await A.page.mouse.up();
  await sleep(500);
  const utana = (await allapot(A.page)).inditottak;
  check(
    "a gepfegyver-tuz hangot indit",
    utana > elotte + 3,
    `${utana - elotte} hang egy rovid sorozatra`,
  );

  // --- A MASIK jatekos is hallja ---
  //
  // Ez a lenyeg egy tobbjatekos jatekban: nem a sajat lovesunket kell
  // hallani, hanem azt, hogy valaki mas lo.
  const masikHallotta =
    (await allapot(B.page)).inditottak > 0;
  check(
    "a masik jatekos is hallja a lovest",
    masikHallotta,
    `${(await allapot(B.page)).inditottak} hang B-nel`,
  );

// --- A TULMELEGEDES egyszer szol, nem folyamatosan ---
  //
  // A hoszint minden snapshotban erkezik, tehat a tulmelegedes egy
  // ALLAPOT, ami masodpercekig tart. Ha arra jatszanank hangot, a
  // fegyver lefulladasa utan folyamatosan sisteregne. Az esemeny a
  // FELFUTO EL: az a pillanat, amikor lefullad.
  {
    const tulmelegedesHangok = () =>
      A.page.evaluate(
        () =>
          (window as any).__spike.audio.inditottEbbol("tulmelegedes") as number,
      ) as Promise<number>;

    const elotte = await tulmelegedesHangok();
    // Vegig nyomva tartjuk: a fegyver biztosan lefullad (a check:weapons
    // szerint kb. 2.6 mp folyamatos tuz utan).
    await A.page.mouse.move(640, 330);
    await A.page.mouse.down();
    await sleep(4000);
    await A.page.mouse.up();
    await sleep(500);
    const lefulladas = await tulmelegedesHangok();
    check(
      "a fegyver lefulladasa hallhato",
      lefulladas > elotte,
      `${lefulladas - elotte} hang`,
    );
    check(
      "de csak EGYSZER szol, nem vegig amig forro",
      lefulladas - elotte === 1,
      `${lefulladas - elotte} hang egy lefulladasra`,
    );

    // Es a hules alatt sem szol ujra magatol.
    await sleep(1500);
    check(
      "hules kozben nem szolal meg ujra",
      (await tulmelegedesHangok()) === lefulladas,
      "a hoszint csokkenese nem esemeny",
    );
  }

  // --- A ROBBANAS is szol ---
  //
  // Nem eleg, hogy "valamilyen hang" indult: a robbanas a jatek
  // legfontosabb visszajelzese (talalat, megsemmisules), es kulon
  // uton jut el a lejatszasig, mint a lovesek -- kesleltetve, a
  // latvannyal egyutt (explosionQueue).
  //
  // A falnak lovunk: az biztos robbanas, es nem fugg attol, hogy
  // eltalaljuk-e a masikat.
  //
  // A B KLIENSSEL, mert az az agyus. (A-t nem lehet atvaltani: elve a
  // szerver elutasitja a fegyvervaltast -- ez szandekos szabaly, lasd
  // check:mg.)
  {
    await B.page.evaluate(() => {
      // A fal ele, hozza kozel -- a loves biztosan becsapodik.
      (window as any).__spike.backend.reset({ x: 0, y: 1.2, z: -50 });
    });
    await sleep(2500);

    const elotte = await robbanasHangok(B.page);
    // Elore, a falra celzunk.
    await B.page.mouse.move(640, 330);
    await sleep(400);
    await B.page.mouse.down();
    await B.page.mouse.up();
    await sleep(2500);
    const utana = await robbanasHangok(B.page);
    check(
      "a robbanasnak van hangja",
      utana > elotte,
      `${utana - elotte} robbanas-hang`,
    );
  }

  // --- Nemitas ---
  await A.page.keyboard.press("KeyM");
  await sleep(300);
  check(
    "az M lenemitja",
    (await allapot(A.page)).bekapcsolva === false,
    "a fo hangero nullan",
  );
  check(
    "a gomb felirata is valtozik",
    (await A.page.evaluate(
      () => document.getElementById("sound-state")?.textContent,
    )) === "néma",
    "néma",
  );

  // --- A nemitas TULELI az ujratoltest ---
  //
  // Aki lehalkitotta, annak ne szoljon bele ujra minden ujratoltesnel.
  await A.page.reload();
  await A.page.waitForFunction(() => !!(window as any).__spike?.net?.playerId, null, {
    timeout: 20000,
  });
  await sleep(1500);
  check(
    "a nemitas tuleli az ujratoltest",
    (await allapot(A.page)).bekapcsolva === false,
    "a beallitas megmaradt",
  );

  await A.browser.close();
  await B.browser.close();

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
