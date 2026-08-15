/**
 * Megsemmisules es ujraszuletes, vegponttol vegpontig (terv 4. lepcso 5. pont).
 *
 * A szerver oldalat a fust-teszt fedi (check:net); ez a KLIENS oldalat
 * meri, amire mashonnan nincs fedezet:
 *  - a megsemmisult auto eltunik,
 *  - es a FIZIKAI TESTE is megszunik (kulonben egy lathatatlan
 *    akadallyal lehetne utkozni),
 *  - ujraszuletes utan mindketto visszaall, teli HP-val.
 *
 * Lassu teszt (tobb rammeles kell a kivegzeshez), ezert nem resze a
 * check:collision-nek.
 *
 * Futtatas (a vite dev-szervernek ES a jatekszervernek futnia kell):
 *   npx tsx scripts/check-death.ts
 */
import { chromium, type Browser, type Page } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RemoteView {
  ownHp: number | null;
  otherHp: number | null;
  otherVisible: boolean | null;
  otherHasBody: boolean | null;
  ownZ: number;
}

const viewOf = (page: Page): Promise<RemoteView> =>
  page.evaluate(`(function () {
    var s = window.__spike;
    var ids = s.view.remoteCarIds();
    var car = ids.length ? s.view.remoteCars.get(ids[0]) : null;
    return {
      ownHp: s.net.hp,
      otherHp: ids.length ? s.net.remotes.hpOf(ids[0]) : null,
      otherVisible: car ? car.wrapper.visible : null,
      otherHasBody: ids.length ? s.backend.getRemoteBody(ids[0]) !== null : null,
      ownZ: s.backend.getChassis().position[2],
    };
  })()`) as Promise<RemoteView>;

/** Megvarja, amig a jatekos el (HP > 0), azaz lezajlott az ujraszuletes. */
async function waitUntilAlive(page: Page, timeoutMs = 10000): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const hp = (window as any).__spike?.net?.hp;
        return hp !== null && hp > 0;
      },
      null,
      { timeout: timeoutMs, polling: 150 },
    );
  } catch {
    // Idotullepesnel hagyjuk tovabbmenni: az ellenorzesek ugyis
    // kimutatjak, ha valami nem stimmel.
  }
}

async function openClient(hash: string): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  [oldal-hiba] ${e.message}`));
  await page.goto(`${CLIENT_URL}${hash}`);
  await page.waitForFunction(() => !!(window as any).__spike, null, { timeout: 20000 });
  await page.waitForFunction(
    () => !!(window as any).__spike?.net?.playerId,
    null,
    { timeout: 20000 },
  );
  return { browser, page };
}

async function main(): Promise<void> {
  console.log("=== Megsemmisules es ujraszuletes ===\n");

  const clientA = await openClient("");
  const a = clientA.page;
  await sleep(1500);
  const room = a.url().substring(a.url().indexOf("#"));

  const clientB = await openClient(room);
  const b = clientB.page;
  await sleep(2500);

  // Ismetelt rammeles, amig B ki nem esik. Egy becsapodas nem eleg
  // (szandekosan: a sebzes felso korlata ezt kizarja).
  // A rammelesek szama szandekosan bőven meretezett: a headless
  // renderelo sebessege ingadozik, ezert a becsapodasi sebesseg -- es
  // vele a sebzes -- futasonkent elter. Szoros hatarnal a teszt neha
  // 1 HP-nal megallt volna.
  let destroyed = false;
  let rams = 0;
  for (; rams < 12 && !destroyed; rams++) {
    // MINDKETTONEK elnie kell, mielott ujra nekifutunk. A becsapodo
    // auto is sebzodik, tehat kozben O is kieshet -- olyankor a szerver
    // nem veszi at az allapotat, es a kovetkezo rammeles a semmibe
    // menne. (Elsore pontosan ez tortent: a teszt osszezavarodott.)
    await waitUntilAlive(a);
    await waitUntilAlive(b);

    await a.evaluate("window.__spike.backend.reset({ x: 0, y: 1.0, z: 34 })");
    await b.evaluate("window.__spike.backend.reset({ x: 0, y: 1.0, z: 0 })");
    await sleep(2500);

    await a.keyboard.down("w");
    await sleep(4000);
    await a.keyboard.up("w");
    await sleep(800);

    destroyed = (await viewOf(a)).otherHp === 0;
  }

  const dead = await viewOf(a);
  check("eleg rammeles utan megsemmisul az auto", destroyed, `${rams} rammeles utan`);
  check(
    "a megsemmisult auto eltunik",
    dead.otherVisible === false,
    `lathato = ${dead.otherVisible}`,
  );
  check(
    "a megsemmisult autonak nincs fizikai teste",
    dead.otherHasBody === false,
    "kulonben lathatatlan akadaly maradna",
  );

  // Ujraszuletes: a szerver kuldi a helyet, a kliens odaall.
  const bBefore = await viewOf(b);
  await sleep(4500);
  const after = await viewOf(a);
  const bAfter = await viewOf(b);

  check(
    "ujraszuletes utan teli a HP",
    bAfter.ownHp === 100 && after.otherHp === 100,
    `sajat: ${bBefore.ownHp} -> ${bAfter.ownHp}, a masik oldalon: ${after.otherHp}`,
  );
  check(
    "ujraszuletes utan ujra lathato es van teste",
    after.otherVisible === true && after.otherHasBody === true,
    `lathato=${after.otherVisible}, test=${after.otherHasBody}`,
  );
  check(
    "a kliens tenylegesen athelyezte a sajat autojat",
    Math.abs(bAfter.ownZ - bBefore.ownZ) > 5,
    `z ${bBefore.ownZ.toFixed(1)} -> ${bAfter.ownZ.toFixed(1)}`,
  );

  await clientA.browser.close();
  await clientB.browser.close();

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error("A teszt osszeomlott:", err);
  process.exitCode = 1;
});
