/**
 * Lobby: szoba-lista, letrehozas, csatlakozas (terv 5. lepcso 1. pont).
 *
 * A lenyeg a MASODIK jatekos utja: nem kell tudnia semmilyen kodot --
 * latja a nyitott szobat a listaban, es rakattint. Korabban a szobakodot
 * csak az URL-bol lehetett megosztani, amit egy tesztelonek nem lehet
 * elmagyarazni.
 *
 * Futtatas: npm run check:lobby
 */
import { chromium, type Browser, type Page } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Uj bongeszo, a lobbyig betoltve. SZANDEKOSAN nincs `?name=`. */
async function openLobby(): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  [oldal-hiba] ${e.message}`));
  // A ?dekor=0-rol lasd a scene.ts dekoracioBe fuggvenyet.
  await page.goto(`${CLIENT_URL}?dekor=0`);
  await page.waitForSelector("#lobby:not([hidden])", { timeout: 20000 });
  return { browser, page };
}

const joined = (page: Page): Promise<void> =>
  page.waitForFunction(() => !!(window as any).__spike?.net?.playerId, null, {
    timeout: 20000,
  }) as unknown as Promise<void>;

const roomCodeOf = (page: Page): Promise<string | null> =>
  page.evaluate("window.__spike.net.roomCode") as Promise<string | null>;

/**
 * A #car-preview vaszon ATLAGSZINE -- csak a kirajzolt keppontokbol.
 *
 * A vaszon 2D: a 3D renderelo kepet masoljuk ra, igy egyszeruen
 * kiolvashato. Az atlatszo hatteret kihagyjuk, kulonben minden auto
 * atlaga ugyanaz a hatterszin lenne.
 */
const elonezetSzinKod = (): {
  r: number;
  g: number;
  b: number;
  pontok: number;
} | null => {
  const c = document.getElementById("car-preview") as HTMLCanvasElement | null;
  const ctx = c?.getContext("2d");
  if (!c || !ctx) return null;
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 40) continue;
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
    n++;
  }
  return n
    ? { r: r / n, g: g / n, b: b / n, pontok: n }
    : { r: 0, g: 0, b: 0, pontok: 0 };
};

/** Egy gombsor belyegkepeinek atlagszine, gombonkent. */
const gombSzinekKod = async (valaszto: string): Promise<number[][]> => {
  const kepek = [
    ...document.querySelectorAll(`${valaszto} img`),
  ] as HTMLImageElement[];
  const ki: number[][] = [];
  for (const kep of kepek) {
    await kep.decode();
    const c = document.createElement("canvas");
    c.width = kep.naturalWidth;
    c.height = kep.naturalHeight;
    const ctx = c.getContext("2d");
    if (!ctx) continue;
    ctx.drawImage(kep, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 40) continue;
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
      n++;
    }
    // Egeszre kerekitve: a renderelo apro zaja ne szamitson
    // "kulonbozo" szinnek.
    ki.push(
      n
        ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
        : [0, 0, 0],
    );
  }
  return ki;
};

/** A festes-gombok feliratai. */
const feliratokKod = (): string[] =>
  [...document.querySelectorAll("#skin-pick .wname")].map(
    (e) => e.textContent ?? "",
  );

async function main(): Promise<void> {
  console.log("=== Lobby ===\n");

  // --- A: uj szoba nyitasa ---
  const A = await openLobby();
  check("a lobby megjelenik indulaskor", true, "lathato");

  const emptyList = await A.page.textContent("#room-list");
  check(
    "ures listanal is ertelmes uzenet all",
    (emptyList ?? "").length > 0,
    `"${(emptyList ?? "").trim()}"`,
  );

  await A.page.fill("#name-input", "Roland");
  await A.page.click("#lobby-create");
  await joined(A.page);
  const codeA = await roomCodeOf(A.page);
  check(
    "az uj szoba letrejon es belepunk",
    typeof codeA === "string" && /^[A-Z0-9]{4}$/.test(codeA),
    `${codeA}`,
  );

  const lobbyHiddenA = await A.page.evaluate(
    "document.getElementById('lobby').hidden",
  );
  check("belepes utan a lobby eltunik", lobbyHiddenA === true, `${lobbyHiddenA}`);

  const badge = await A.page.textContent("#room-badge");
  check(
    "a szobakod jatek kozben is lathato (megoszthato)",
    (badge ?? "").includes(codeA ?? "___"),
    `"${(badge ?? "").trim()}"`,
  );

  // --- B: a LISTABOL csatlakozik, kod ismerete nelkul ---
  const B = await openLobby();
  await B.page.fill("#name-input", "Ellenfel");

  // A lista magatol frissul, amig a lobby nyitva van.
  await B.page.waitForSelector("#room-list .room", { timeout: 15000 });
  const listed = await B.page.textContent("#room-list");
  check(
    "A szobaja megjelenik B listajaban",
    (listed ?? "").includes(codeA ?? "___"),
    `"${(listed ?? "").trim()}"`,
  );
  check(
    "a lista mutatja a letszamot is",
    (listed ?? "").includes("1/"),
    "1/8",
  );

  await B.page.click("#room-list .room");
  await joined(B.page);
  const codeB = await roomCodeOf(B.page);
  check(
    "B a listabol ugyanabba a szobaba lep be",
    codeB === codeA,
    `${codeB} === ${codeA}`,
  );

  // Mindketten latjak egymast.
  await sleep(2500);
  const seen = await A.page.evaluate("window.__spike.view.remoteCarCount");
  check("A latja B autojat", seen === 1, `${seen} tavoli auto`);

  await A.browser.close();
  await B.browser.close();

  // --- Hibas kod: a lobbyban, LATHATOAN kell jeleznie ---
  const C = await openLobby();
  await C.page.fill("#name-input", "Teveszto");
  await C.page.fill("#room-input", "ZZZZ");
  await C.page.click("#lobby-join");

  let errorText = "";
  for (let i = 0; i < 30; i++) {
    const hidden = await C.page.evaluate(
      "document.getElementById('lobby-error').hidden",
    );
    if (hidden === false) {
      errorText = (await C.page.textContent("#lobby-error")) ?? "";
      break;
    }
    await sleep(200);
  }
  check(
    "nem letezo szobanal a lobby hibat mutat",
    errorText.length > 0,
    `"${errorText.trim()}"`,
  );

  const stillInLobby = await C.page.evaluate(
    "document.getElementById('lobby').hidden",
  );
  check(
    "hiba utan a jatekos a lobbyban marad",
    stillInLobby === false,
    "ujra probalhatja",
  );

  await C.browser.close();

  // --- D: AUTO-ELONEZET: latszik-e, amit valasztunk? ---
  //
  // A MEGOLDANDO HIBA: a festes-texturak halozatrol jonnek, a
  // belyegkepek viszont EGYSZER keszulnek el. Az elso valtozatban
  // mindegyik gombon a modell alap texturaja maradt: ot fekete auto,
  // "Fekete / Zold / Narancs" felirattal. Ezert nem az a kerdes, hogy
  // van-e kep, hanem hogy KULONBOZNEK-e.
  const D = await openLobby();
  // A modellek es a festesek betoltese halozati keres.
  await D.page.waitForFunction(
    () =>
      document.querySelectorAll("#skin-pick img").length > 1 &&
      [...document.querySelectorAll("#skin-pick img")].every(
        (i) => (i as HTMLImageElement).src.length > 100,
      ),
    null,
    { timeout: 20000 },
  );
  await sleep(1500);

  const elonezetSzin = await D.page.evaluate(elonezetSzinKod);
  check(
    "az elonezet vasznara tenylegesen rajzol valamit",
    elonezetSzin !== null && elonezetSzin.pontok > 500,
    elonezetSzin ? `${elonezetSzin.pontok} rajzolt keppont` : "ures vaszon",
  );

  const szinek = await D.page.evaluate(gombSzinekKod, "#skin-pick");
  check(
    "a festes-gombok belyegkepei KULONBOZNEK",
    new Set(szinek.map((c) => c.join(","))).size === szinek.length,
    `${new Set(szinek.map((c) => c.join(","))).size} kulonbozo / ${szinek.length} gomb`,
  );

  const autoSzinek = await D.page.evaluate(gombSzinekKod, "#car-pick");
  check(
    "az auto-gombok belyegkepei KULONBOZNEK",
    new Set(autoSzinek.map((c) => c.join(","))).size === autoSzinek.length,
    `${autoSzinek.length} auto`,
  );

  // Masik FESTES: a nagy elonezet szinenek valtoznia kell. A kocsi
  // forog, ezert nem keppontot hasonlitunk, hanem atlagszint -- fekete
  // es narancs kozott ez akkor is nagy kulonbseg, ha kozben fordult.
  const elotte = await D.page.evaluate(elonezetSzinKod);
  await D.page.click("#skin-pick button:nth-child(3)");
  await sleep(700);
  const utana = await D.page.evaluate(elonezetSzinKod);
  const tavolsag =
    elotte && utana
      ? Math.abs(elotte.r - utana.r) +
        Math.abs(elotte.g - utana.g) +
        Math.abs(elotte.b - utana.b)
      : 0;
  check(
    "masik festesre a NAGY elonezet szine valtozik",
    tavolsag > 30,
    `szin-tavolsag ${tavolsag.toFixed(0)}`,
  );

  // Masik AUTO: mas festes-lista jar hozza, es azok belyegkepei is
  // felfestve keszulnek (uj texturakat kell megvarni).
  const elsoFestesek = await D.page.evaluate(feliratokKod);
  await D.page.click("#car-pick button:nth-child(2)");
  await sleep(2000);
  const masodikFestesek = await D.page.evaluate(feliratokKod);
  check(
    "masik autonal MAS festesek jelennek meg",
    elsoFestesek.join("|") !== masodikFestesek.join("|"),
    `${elsoFestesek.join(",")} -> ${masodikFestesek.join(",")}`,
  );

  const ujSzinek = await D.page.evaluate(gombSzinekKod, "#skin-pick");
  check(
    "az uj auto belyegkepei is felfestve keszulnek",
    new Set(ujSzinek.map((c) => c.join(","))).size === ujSzinek.length,
    `${ujSzinek.length} festes`,
  );

  // A MENU HATTERE: a palya latszik, es lassan fordul.
  //
  // A MEGOLDANDO HIBA: a jatek kepkocka-hurka csak a BELEPES utan
  // indul, tehat a lobby mogott egy soha ki nem rajzolt, fekete vaszon
  // allt. Egy kepernyokep onmagaban ezt nem fogja meg (a lobby panel
  // ugyanugy latszik) -- azt kell merni, hogy a panelen KIVULI resz
  // ket idopontban mas.
  const sav = { x: 0, y: 0, width: 100, height: 400 };
  const kep1 = await D.page.screenshot({ clip: sav });
  await sleep(2500);
  const kep2 = await D.page.screenshot({ clip: sav });
  check(
    "a menu hattereben a palya MOZOG (nem allokep)",
    !kep1.equals(kep2),
    `${kep1.length} vs ${kep2.length} bajt`,
  );

  await D.browser.close();

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
