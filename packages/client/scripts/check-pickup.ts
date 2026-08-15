/**
 * Boost pickup a teljes lancon (terv 4. lepcso 4. pont).
 *
 * A szabalyokat a check-pickups.ts meri headlessen; itt az a kerdes,
 * hogy a lanc osszeall-e: az auto odaer -> a SZERVER konyveli a
 * felvetelt -> a kliens megkapja a hatralevo idot -> a fizikaban
 * tenylegesen nagyobb lesz a hajtoero -> a pickup eltunik MINDENKINEK,
 * es kesobb visszajon.
 *
 * A legfontosabb az utolso elotti pont: ha a felvetel kliens-oldali
 * lenne, ket jatekos ugyanazt a pickupot venne fel, es mindketto
 * jogosnak erezne.
 *
 * Futtatas: npx tsx scripts/check-pickup.ts [--lag=200 --jitter=60]
 */
import { chromium, type Browser, type Page } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

function argOrEnv(name: string, envName: string): number {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (arg) return Number(arg.split("=")[1]);
  return Number(process.env[envName] ?? 0);
}

const LAG_MS = argOrEnv("lag", "LAG");
const JITTER_MS = argOrEnv("jitter", "JITTER");

function clientUrl(hash: string): string {
  const query =
    LAG_MS > 0 ? `?lag=${LAG_MS}${JITTER_MS > 0 ? `&jitter=${JITTER_MS}` : ""}` : "";
  return `${CLIENT_URL}${query}${hash}`;
}

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openClient(hash: string): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  [oldal-hiba] ${e.message}`));
  await page.goto(clientUrl(hash));
  await page.waitForFunction(() => !!(window as any).__spike, null, { timeout: 20000 });
  await page.waitForFunction(
    () => !!(window as any).__spike?.net?.playerId,
    null,
    { timeout: 20000 },
  );
  return { browser, page };
}

const boostMs = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).__spike.net.boostMs as number);

/** Eppen felveheto-e az adott indexu pickup, a kliens szerint. */
const available = (page: Page, index: number): Promise<boolean | undefined> =>
  page.evaluate(
    (i) => ((window as any).__spike.net.pickupsAvailable as boolean[])[i],
    index,
  );

async function main(): Promise<void> {
  console.log("=== Boost pickup ===\n");

  const clientA = await openClient("");
  const a = clientA.page;
  await sleep(1500);
  const room = a.url().substring(a.url().indexOf("#"));
  const clientB = await openClient(room);
  const b = clientB.page;
  await sleep(2000);

  // A 0. pickup a (0, 8) pontban van. A-t KOZVETLENUL melle
  // tesszuk, hogy ne kelljen odavezetni (headlessben lassu es
  // megbizhatatlan lenne), B-t pedig messze.
  await a.evaluate(() => (window as any).__spike.backend.reset({ x: 0, y: 1.0, z: 16 }));
  // B MESSZE, es NEM a kesobbi meresi savokban (x = 24 es x = 16):
  // eloszor pont ide tettem, es A a viszonyitasi futasnal beleszuletett
  // B autojaba -- nem tudott elindulni, igy a "tullokes nelkuli"
  // alapertek 2 km/h lett, es a teszt egy TORT alaphoz hasonlitott.
  await b.evaluate(() => (window as any).__spike.backend.reset({ x: -24, y: 1.0, z: -24 }));
  await sleep(3000);

  const beforeA = await boostMs(a);
  check("A-nak indulaskor nincs tullokese", beforeA === 0, `${beforeA} ms`);

  const availableBefore = await available(b, 0);
  check(
    "a pickup kezdetben felveheto (B is igy latja)",
    availableBefore === true,
    `${availableBefore}`,
  );

  // A a pickupra hajt. Csak elore kell mennie 8 m-t.
  await a.keyboard.down("w");
  let picked = 0;
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    picked = await boostMs(a);
    if (picked > 0) break;
  }
  await a.keyboard.up("w");

  check("A felvette a boostot", picked > 0, `${picked} ms hatralevo`);

  // A SZERVER dontott: B-nek is el kell tunnie a pickupnak. Ha a
  // felvetel kliens-oldali lenne, B tovabbra is felvehetőnek latna.
  let availableAfter: boolean | undefined = true;
  for (let i = 0; i < 15; i++) {
    availableAfter = await available(b, 0);
    if (availableAfter === false) break;
    await sleep(200);
  }
  check(
    "a pickup B szemszogebol is eltunt",
    availableAfter === false,
    `${availableAfter} -- a szerver dontott, nem A kliense`,
  );

  // A tullokes MERT hatasat (gyorsulas) SZANDEKOSAN nem itt merjuk,
  // hanem a check-pickups.ts-ben, headlessen.
  //
  // Itt ugyanis a palya rontja el a merest: ket futast kell
  // osszehasonlitani, es a savok akadalyai (ladak) nagyobb kulonbseget
  // okoznak, mint maga a boost. Meressel 94 vs 55 km/h ket, akadaly-
  // mentesnek hitt savon, es 49 vs 47 km/h ugyanazon a savon, ahol
  // mindket futas ladaba utkozott -- vagyis a szam nem a boostrol
  // szolt. Egy alkalommal ugy is "atment", hogy a viszonyitasi futas
  // volt tort (2 vs 50 km/h, mert A beleszuletett B autojaba); egy
  // ilyen ellenorzes rosszabb a semminel.
  //
  // Amit ITT lehet ertelmesen merni, az a LANC: a szerver konyveli-e a
  // felvetelt, latja-e a masik jatekos, es visszajon-e a pickup.
  const remaining = await boostMs(a);
  check(
    "a tullokes a felvetel utan is tart",
    remaining > 0,
    `${remaining.toFixed(0)} ms van hatra`,
  );

  let respawned = false;
  for (let i = 0; i < 40; i++) {
    if ((await available(b, 0)) === true) {
      respawned = true;
      break;
    }
    await sleep(500);
  }
  check("a felvett pickup kesobb ujra felbukkan", respawned, `${respawned}`);

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;

  await clientA.browser.close();
  await clientB.browser.close();
}

main();
