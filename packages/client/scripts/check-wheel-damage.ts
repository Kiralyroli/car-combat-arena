/**
 * Kerek-serules a SZERVERTOL (terv 4. lepcso 6. pont).
 *
 * A teljes lancot merjuk, nem a szabalyokat (azt a check-wheels.ts
 * teszi headlessen): rakéta -> szerver dont -> a kerek letorik -> a
 * SERULT jatekos fizikaja is megvaltozik -> a MASIK jatekos is latja.
 *
 * A lenyeg a ket utolso pont. Korabban a serules kliens-oldali volt
 * (1-4 gombok), tehat sem a szerver, sem a masik jatekos nem tudott
 * rola semmit azon kivul, amit a serult kliens ONMAGAROL allitott.
 *
 * Futtatas: npx tsx scripts/check-wheel-damage.ts [--lag=200 --jitter=60]
 */
import { chromium, type Browser, type Page } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

/** A tesztkliensek neve -- a ?name= egyben atugorja a nev-parbeszedet. */
const testName = "Kerek";

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

const ownPos = (page: Page): Promise<number[]> =>
  page.evaluate(() => (window as any).__spike.backend.getChassis().position as number[]);

/** A SAJAT kerekeink allapota a fizikabol -- ezt hajtja a szerver. */
const ownWheels = (page: Page): Promise<{ broken: boolean; grip: number }[]> =>
  page.evaluate(() =>
    ((window as any).__spike.backend.getWheels() as any[]).map((w) => ({
      broken: w.damage.broken as boolean,
      grip: w.damage.gripMultiplier as number,
    })),
  );

async function main(): Promise<void> {
  console.log("=== Kerek-serules a szervertol ===\n");

  const clientA = await openClient("");
  const a = clientA.page;
  await sleep(1500);
  const room = a.url().substring(a.url().indexOf("#"));
  const clientB = await openClient(room);
  const b = clientB.page;
  await sleep(2000);

  // A lo, B a cel. Szembe allitjuk oket, hogy a rakéta B ORRA elott
  // robbanjon -- igy az ELSO kerekeknek kell serulniuk, a hatsoknak
  // alig (ez a kerekenkenti tavolsag lenyege).
  await a.evaluate(() => (window as any).__spike.backend.reset({ x: 0, y: 1.0, z: 25 }));
  await b.evaluate(() => (window as any).__spike.backend.reset({ x: 0, y: 1.0, z: 0 }));
  await sleep(600);

  const bodyError = async (viewer: Page, subject: Page): Promise<number> => {
    const real = await ownPos(subject);
    const body: number[] = await viewer.evaluate(() => {
      const s = (window as any).__spike;
      const ids = s.view.remoteCarIds();
      if (ids.length === 0) return [NaN, NaN, NaN];
      const t = s.backend.getRemoteBody(ids[0]);
      return t ? t.position : [NaN, NaN, NaN];
    });
    return Math.hypot(body[0] - real[0], body[1] - real[1], body[2] - real[2]);
  };

  let synced = false;
  for (let i = 0; i < 40; i++) {
    if ((await bodyError(a, b)) < 1 && (await bodyError(b, a)) < 1) {
      synced = true;
      break;
    }
    await sleep(300);
  }
  check("a felallas utan mindket auto szinkronban van", synced, `${synced}`);

  const before = await ownWheels(b);
  check(
    "B kerekei indulaskor epek",
    before.every((w) => !w.broken && w.grip > 0.99),
    before.map((w) => w.grip.toFixed(2)).join(" / "),
  );

  // A rakéta B orra ele. B a z=0-ban all, orral -Z fele (A fele nez),
  // tehat az ORRA a +Z... nem: mindketto -Z fele nez, B tehat A-tol
  // ELFELE. A rakéta igy B HATULJANAK csapodik -- eleg, hogy legyen
  // aszimmetria; a lenyeg, hogy nem mind a negy kerek egyformán serul.
  for (let shot = 0; shot < 2; shot++) {
    await a.evaluate(() => (window as any).__spike.net.fire([0, 1, -30]));
    await sleep(1800);
  }

  const after = await ownWheels(b);
  check(
    "B kerekei serultek a robbanastol",
    after.some((w) => w.grip < before[0].grip - 0.01 || w.broken),
    after.map((w) => (w.broken ? "TORT" : w.grip.toFixed(2))).join(" / "),
  );

  // A SZERVER dontott, nem B: B sajat fizikaja csak KOVETI a
  // snapshotot. Ha a kerekek serultek, a szerver kuldte igy.
  const spread = Math.max(...after.map((w) => w.grip)) -
    Math.min(...after.map((w) => w.grip));
  check(
    "a kerekek KULONBOZO mertekben serultek (szamit a robbanas helye)",
    spread > 0.01,
    `tapadas-szoras ${spread.toFixed(2)} -- kozeppontbol szamolva 0 lenne`,
  );

  // A MASIK jatekos is latja: A-nal a tavoli auto latvany-allapota a
  // snapshotbol jon, tehat ugyanazt kell mutatnia.
  const seenByA: { broken: boolean; grip: number }[] = await a.evaluate(() => {
    const s = (window as any).__spike;
    const ids = s.view.remoteCarIds();
    const state = s.net.remotes.sample(ids[0], performance.now());
    if (!state) return [];
    return state.grip.map((g: number, i: number) => ({
      broken: (state.brokenMask & (1 << i)) !== 0,
      grip: g,
    }));
  });

  check(
    "A ugyanazt a kerek-allapotot latja B-rol",
    seenByA.length === 4 &&
      seenByA.every(
        (w, i) => w.broken === after[i].broken && Math.abs(w.grip - after[i].grip) < 0.05,
      ),
    seenByA.map((w) => (w.broken ? "TORT" : w.grip.toFixed(2))).join(" / "),
  );

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;

  await clientA.browser.close();
  await clientB.browser.close();
}

main();
