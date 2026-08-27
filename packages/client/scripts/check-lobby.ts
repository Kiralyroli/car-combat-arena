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

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
