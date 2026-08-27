/**
 * A kezelofelulet es a vezerles NEM zavarhatja egymast.
 *
 * A vezerles (billentyu es eger) az ABLAKON figyel, ezert alapbol minden
 * esemeny eljut hozza -- a lobby mezoibe es gombjaira is. Ket iranyban
 * romlott el:
 *
 *  - Billentyu: a `KEY_MAP` elemeire `preventDefault()` fut, ezert a nev
 *    mezobe a w/a/s/d betut es a szokozt egyaltalan nem lehetett beirni;
 *    az `ACTION_MAP` miatt pedig az "r" ujraszuletest, az "f" raketat,
 *    az 1-4 kerektorest valtott ki gepeles kozben.
 *  - Eger: a celkereszt a lobby folott is latszott, es a lobby gombjara
 *    kattintva elsult a loves-kezelo -- vagyis belepes utan a rakéta mar
 *    hutes alatt allt.
 *
 * MIERT NEM DERULT KI KORABBAN: a check-lobby.ts a `page.fill()`-t
 * hasznalja, ami a mezo erteket KOZVETLENUL allitja be, billentyu-
 * esemeny nelkul. Egy ilyen teszt sosem talal ra erre a hibara -- ezert
 * itt `pressSequentially()` es valodi kattintas van.
 *
 * Futtatas: npm run check:input
 */
import { chromium, type Browser, type Page } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

/** Minden gyanus billentyut tartalmaz: WASD, szokoz, r, f, szamok. */
const TRICKY_NAME = "Wasd Rf 1234";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function main(): Promise<void> {
  console.log("=== Felulet es vezerles ===\n");

  const { browser, page } = await openLobby();

  const hidden = (id: string) =>
    page.evaluate(`document.getElementById('${id}').hidden`);

  // --- 0. A lobbyban nincs celzas ---
  check(
    "a lobbyban nem latszik a celkereszt",
    (await hidden("crosshair")) === true,
    "rejtve",
  );

  // --- 1. A nev mezo minden karaktert elfogad ---
  await page.click("#name-input");
  await page.locator("#name-input").pressSequentially(TRICKY_NAME, { delay: 25 });
  const typed = await page.inputValue("#name-input");
  check(
    "a nev mezobe minden karakter beirhato",
    typed === TRICKY_NAME,
    `"${typed}" (vart: "${TRICKY_NAME}")`,
  );

  // Kulon is kimondjuk, mert ez volt a bejelentett hiba.
  check(
    "a w/a/s/d betuk is bekerulnek",
    /w/i.test(typed) && /a/i.test(typed) && /s/i.test(typed) && /d/i.test(typed),
    `"${typed}"`,
  );

  // --- 2. A szobakod mezo is ---
  await page.click("#room-input");
  await page.locator("#room-input").pressSequentially("WASD", { delay: 25 });
  const code = await page.inputValue("#room-input");
  check(
    "a szobakod mezobe is beirhato a WASD",
    code.toUpperCase() === "WASD",
    `"${code}"`,
  );
  await page.fill("#room-input", "");

  // --- 3. A vezerles JATEK KOZBEN valtozatlanul mukodik ---
  // Ez a javitas parja: konnyu lenne ugy elnemitani a mezoket, hogy
  // kozben a vezetes is elnemul.
  await page.click("#lobby-create");
  await page.waitForFunction(() => !!(window as any).__spike?.net?.playerId, null, {
    timeout: 20000,
  });
  await sleep(600);

  // A belepes egy KATTINTAS volt a lobby gombjan. Ha az lovesnek szamit,
  // a rakéta itt mar hutes alatt allna -- ezert ez a legjobb bizonyitek
  // arra, hogy a kattintas nem szivargott at a jatekba.
  const weapon = await page.textContent("#weapon-state");
  check(
    "a lobby gombjara kattintva nem sult el a rakéta",
    (weapon ?? "").trim() === "KESZ",
    `a fegyver allapota: "${(weapon ?? "").trim()}"`,
  );

  check(
    "belepes utan megjelenik a celkereszt",
    (await hidden("crosshair")) === false,
    "lathato",
  );

  const position = () =>
    page.evaluate("window.__spike.stats().chassis.position") as Promise<
      [number, number, number]
    >;

  const before = await position();

  // 3 masodperc, mert allo helyzetbol lassan indul.
  //
  // A KUSZOB SZANDEKOSAN ALACSONY. Ez a teszt azt meri, hogy a
  // BILLENTYU ELJUT-E a vezerleshez a szovegbeirás utan -- nem azt,
  // hogy milyen gyorsan gyorsul az auto. A ket eset kozott nem
  // fokozat, hanem szakadek van: ha az input elveszne, az elmozdulas
  // PONTOSAN 0 lenne.
  //
  // A korabbi 5 m-es kuszob a jelenet akkori (jóval olcsobb)
  // renderelesehez volt merve -- "3 masodperc alatt ~22 m". A
  // homok-textura, a panorama-eg es a kornyezeti feny utan a szoftveres
  // renderelo (SwiftShader) annyira lelassult, hogy a fizika lemarad, es
  // ugyanez a 3 masodperc 2.4-5.3 m-t ad. Ez a TESZTKORNYEZET
  // tulajdonsaga, nem a jateke -- valodi videokartyan a texturak
  // koltsege elhanyagolhato. A kuszobot ezert a merni kivant
  // kulonbseghez igazitottuk, nem a renderelo sebessegehez.
  await page.keyboard.down("KeyW");

  // KOZVETLEN meres: eljut-e a billentyu a vezerlesig?
  //
  // Ez a teszt lenyege, es ez NEM fugg a renderelo sebessegetol. Az
  // elmozdulas onmagaban megteveszto merce: a szoftveres rendereloben
  // a fizika lemarad, es ugyanaz a 3 masodperc hol 5 m-t, hol 0.3 m-t
  // ad -- utobbi mar nem kulonboztetheto meg az "input elveszett"
  // esettol.
  await sleep(300);
  const gaz = (await page.evaluate(
    () => (window as any).__spike.input.read().throttle as number,
  )) as number;
  check(
    "a W eljut a vezerlesig (gaz allasa)",
    gaz > 0.9,
    `throttle = ${gaz}`,
  );

  await sleep(3000);
  await page.keyboard.up("KeyW");

  const after = await position();
  const moved = Math.hypot(after[0] - before[0], after[2] - before[2]);
  // Es az auto TENYLEG el is indul. A kuszob csak a nulla ellen ved: a
  // pontos ertek a renderelo sebessegetol fugg (lasd fentebb).
  check(
    "az auto tenylegesen el is indul",
    moved > 0.1,
    `${moved.toFixed(2)} m elmozdulas`,
  );

  await browser.close();

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
