/**
 * Autoszinek a teljes lancon.
 *
 * A MEGOLDANDO HIBA: korabban a tavoli autok szinet a FOGADO kliens
 * osztotta ki a sajat listaja szerint, ezert ugyanaz a jatekos MAS
 * SZINU volt minden kepernyon. Harom jatekosnal A ugy latta B-t keknek,
 * mint ahogy B latta A-t -- vagyis a jatekosok nem tudtak egymasrol
 * beszelni ("a piros kempel").
 *
 * Ez a teszt pontosan azt meri, amit a szabalyok (check:colors a
 * sharedben) NEM tudnak: hogy KET KULON KLIENS ugyanazt latja-e.
 *
 * Futtatas: npm run check:car-colors
 */
import { chromium, type Browser, type Page } from "playwright";
import { carColorHex, type CarColorId } from "@cca/shared";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function open(
  name: string,
  color: string,
  hash: string,
): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  [oldal-hiba: ${name}] ${e.message}`));
  await page.goto(`${CLIENT_URL}?name=${name}&color=${color}${hash}`);
  await page.waitForFunction(() => !!(window as any).__spike?.net?.playerId, null, {
    timeout: 20000,
  });
  return { browser, page };
}

/** Ahogy EZ a kliens latja a megadott jatekos autojanak szinet. */
async function seenColor(page: Page, playerId: string): Promise<number | null> {
  return (await page.evaluate(
    (id: string) => (window as any).__spike.view.remoteCarColor(id) ?? null,
    playerId,
  )) as number | null;
}

const idOf = (page: Page) => page.evaluate("window.__spike.net.playerId") as Promise<string>;

async function main(): Promise<void> {
  console.log("=== Autoszinek (vegponttol vegpontig) ===\n");

  const A = await open("Piros", "red", "");
  const room = A.page.url().substring(A.page.url().indexOf("#") + 1);
  const B = await open("Kek", "blue", `#${room}`);
  const C = await open("Zold", "green", `#${room}`);
  await sleep(2500);

  const [idA, idB, idC] = [await idOf(A.page), await idOf(B.page), await idOf(C.page)];

  // --- Mindenki a KERT szint kapta (nem utkoztek) ---
  const ownA = (await A.page.evaluate("window.__spike.net.ownColor")) as CarColorId;
  const ownB = (await B.page.evaluate("window.__spike.net.ownColor")) as CarColorId;
  const ownC = (await C.page.evaluate("window.__spike.net.ownColor")) as CarColorId;
  check(
    "mindenki a kert szint kapta",
    ownA === "red" && ownB === "blue" && ownC === "green",
    `${ownA}, ${ownB}, ${ownC}`,
  );

  // --- EZ A LENYEG: B ugyanolyan szinu A es C kepernyojen is ---
  const bOnA = await seenColor(A.page, idB);
  const bOnC = await seenColor(C.page, idB);
  check(
    "ugyanaz a jatekos MINDKET masik kliensen egyforma",
    bOnA !== null && bOnA === bOnC,
    `B szine A-nal: ${bOnA?.toString(16)}, C-nel: ${bOnC?.toString(16)}`,
  );

  // ...es tenylegesen az, amit valasztott.
  check(
    "a latott szin a jatekos valasztasa",
    bOnA === carColorHex("blue"),
    `latott: ${bOnA?.toString(16)}, valasztott (kek): ${carColorHex("blue").toString(16)}`,
  );

  // --- A tobbiek is kulonboznek egymastol ---
  const aOnB = await seenColor(B.page, idA);
  const cOnB = await seenColor(B.page, idC);
  check(
    "a ket ellenfel B kepernyojen kulonbozik",
    aOnB !== null && cOnB !== null && aOnB !== cOnB,
    `A: ${aOnB?.toString(16)}, C: ${cOnB?.toString(16)}`,
  );

  // --- UTKOZES: aki foglalt szint ker, mast kap ---
  const D = await open("Masodik-piros", "red", `#${room}`);
  await sleep(2000);
  const ownD = (await D.page.evaluate("window.__spike.net.ownColor")) as CarColorId;
  check(
    "foglalt szin helyett mast kap",
    ownD !== "red",
    `pirosat kert, kapott: ${ownD}`,
  );

  // A negy jatekos szine paronkent kulonbozik -- kulonben a jatek
  // kozbeni azonositas hasznalhatatlan lenne.
  const all = [ownA, ownB, ownC, ownD];
  check(
    "negy jatekos negy kulonbozo szinnel",
    new Set(all).size === 4,
    all.join(", "),
  );

  for (const client of [A, B, C, D]) await client.browser.close();

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
