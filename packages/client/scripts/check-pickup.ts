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
import { MAX_HP, PICKUP_POINTS } from "@cca/shared";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

/** A tesztkliensek neve -- a ?name= egyben atugorja a nev-parbeszedet. */
const testName = "Pickup";

function argOrEnv(name: string, envName: string): number {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (arg) return Number(arg.split("=")[1]);
  return Number(process.env[envName] ?? 0);
}

const LAG_MS = argOrEnv("lag", "LAG");
const JITTER_MS = argOrEnv("jitter", "JITTER");

function clientUrl(hash: string): string {
  const lag =
    LAG_MS > 0 ? `&lag=${LAG_MS}${JITTER_MS > 0 ? `&jitter=${JITTER_MS}` : ""}` : "";
  // A ?name= ATUGORJA a nev-parbeszedet -- kulonben minden e2e futas
  // ott allna meg, a csatlakozasra varva.
  // A ?dekor=0 kikapcsolja a texturazott talajt es a panorama-eget:
  // azok a JATEKMENETBEN nem szamitanak, a szoftveres rendereloben
  // viszont annyira lelassitjak a lapot, hogy a fizika lemarad (lasd
  // scene.ts dekoracioBe).
  return `${CLIENT_URL}?name=${encodeURIComponent(testName)}${lag}&dekor=0${hash}`;
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

/** A boost-tartaly telitettsege (0..1) a SAJAT kliensen. */
const boostFraction = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).__spike.boostTank.fraction as number);

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

  const full = await boostFraction(a);
  check("A teli tartallyal indul", full > 0.99, ((full*100).toFixed(0))+"%");

  const availableBefore = await available(b, 0);
  check(
    "a pickup kezdetben felveheto (B is igy latja)",
    availableBefore === true,
    String(availableBefore),
  );

  // A LEURITI a tartalyt: Shiftet tartva, allo helyzetben. (Gaz nem
  // kell hozza -- a boost a Shiftbol fogy, nem a sebessegbol.)
  //
  // A tartas HOSSZABB, mint amennyi a tartaly kiuritesehez elegendo
  // lenne valos idoben: a boost SZIMULALT idohoz kotodik (a fizikai
  // lepesekhez), a headless renderelo pedig lassabban szimulal a valos
  // idonel -- 3.5 s falioran csak ~1.9 s szimulalt idot jelentett, es a
  // tartaly 62%-on maradt. A pontos aranyt a check-boost-tank.ts meri
  // determinisztikusan; itt csak az a kerdes, hogy FOGY-e.
  await a.keyboard.down("Shift");
  await sleep(7000);
  await a.keyboard.up("Shift");
  const drained = await boostFraction(a);
  check(
    "a Shift fogyasztja a tartalyt",
    drained < full - 0.25,
    ((full*100).toFixed(0))+"% -> "+((drained*100).toFixed(0))+"%",
  );

  // A a pickupra hajt (8 m elore).
  await a.keyboard.down("w");
  let refilled = drained;
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    refilled = await boostFraction(a);
    if (refilled > drained + 0.1) break;
  }
  await a.keyboard.up("w");

  // A pontos 50%-ot a check-boost-tank.ts meri determinisztikusan; itt
  // az a kerdes, hogy a LANC mukodik-e, ezert laza a hatar (a felvetel
  // es a meres kozott is telik ido, es a Shift mar nincs nyomva).
  check(
    "a pickup visszatolti a tartalyt",
    refilled > drained + 0.3,
    ((drained*100).toFixed(0))+"% -> "+((refilled*100).toFixed(0))+"%",
  );

  // A SZERVER dontott: B-nek is el kell tunnie a pickupnak. Ha a
  // felvetel kliens-oldali lenne, B tovabbra is felvehetonek latna.
  let availableAfter = true;
  for (let i = 0; i < 15; i++) {
    availableAfter = (await available(b, 0)) === true;
    if (!availableAfter) break;
    await sleep(200);
  }
  check(
    "a pickup B szemszogebol is eltunt",
    !availableAfter,
    "a szerver dontott, nem A kliense",
  );

  // --- ELET-PICKUP: teli elettel NEM tunik el ---
  //
  // A szerver ismeri a HP-t, tehat vissza tudja tartani a felvetelt --
  // kulonben a sertetlen jatekos elvinne azt, amire masnak tenyleg
  // szuksege van. A szabalyt a check:pickup-effects meri pontosan; itt
  // az a kerdes, hogy a teljes lancon at is igy viselkedik-e.
  //
  // (A boostnal ez nem tehetó meg: a tartaly a kliensnel van.)
  const healthIndex = PICKUP_POINTS.findIndex((point) => point.kind === "health");
  if (healthIndex >= 0) {
    const point = PICKUP_POINTS[healthIndex];
    await a.evaluate(
      ([x, z]) => (window as any).__spike.backend.reset({ x, y: 1.0, z }),
      [point.x, point.z],
    );
    await sleep(1500);

    const hp = (await a.evaluate("window.__spike.net.hp")) as number;
    const stillThere = (await available(b, healthIndex)) === true;
    check(
      "teli elettel az elet-pickup a helyen marad",
      hp === MAX_HP && stillThere,
      `${hp} HP-val athajtva, a pickup ${stillThere ? "megvan" : "eltunt"}`,
    );
  }

  let respawned = false;
  for (let i = 0; i < 40; i++) {
    if ((await available(b, 0)) === true) { respawned = true; break; }
    await sleep(500);
  }
  check("a felvett pickup kesobb ujra felbukkan", respawned, String(respawned));

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;

  await clientA.browser.close();
  await clientB.browser.close();
}

main();
