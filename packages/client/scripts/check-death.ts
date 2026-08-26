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
import {
  LANE_FAR_Z,
  LANE_NEAR_Z,
  LANE_X,
  laneIsClear,
  laneLabel,
} from "./arenaLane";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

/** A tesztkliensek neve -- a ?name= egyben atugorja a nev-parbeszedet. */
const testName = "Halal";

/**
 * Mesterseges halozati kesleltetes -- ugyanaz a kapcsolo, mint a tobbi
 * e2e tesztnel. KORABBAN HIANYZOTT: a --lag/--jitter argumentumokat a
 * szkript elfogadta, de figyelmen kivul hagyta, tehat a "kesleltetett"
 * futasok valojaban 0 ms-on mentek.
 */
function argOrEnv(name: string, envName: string): number {
  const arg = process.argv.find((x) => x.startsWith(`--${name}=`));
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
  return `${CLIENT_URL}?name=${encodeURIComponent(testName)}${lag}${hash}`;
}

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

/**
 * Megvarja, amig MINDKET auto szerver-oldali allapota utolerte a
 * teleportot -- azaz a masik kliensnel a tavoli test a valos helyen van.
 *
 * Mindket iranyban merunk: eleg, ha az egyik fel meg elutasitott
 * allapotban van, es a szerver mar nem latja osszeerni a ket autot.
 */
async function bothSynced(a: Page, b: Page): Promise<boolean> {
  const error = async (viewer: Page, subject: Page): Promise<number> => {
    const real: number[] = await subject.evaluate(
      () => (window as any).__spike.backend.getChassis().position as number[],
    );
    const body: number[] = await viewer.evaluate(() => {
      const s = (window as any).__spike;
      const ids = s.view.remoteCarIds();
      if (ids.length === 0) return [NaN, NaN, NaN];
      const t = s.backend.getRemoteBody(ids[0]);
      return t ? t.position : [NaN, NaN, NaN];
    });
    return Math.hypot(body[0] - real[0], body[1] - real[1], body[2] - real[2]);
  };
  return (await error(a, b)) < 1 && (await error(b, a)) < 1;
}

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
  await page.goto(clientUrl(hash));
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
  // MONOTON szamlalo: egy robbanas-effekt csak 650 ms-ig el, tehat egy
  // kesobbi pillanatfelvetel mar nem latna. (Eloszor pont igy mertem,
  // es a teszt "nem volt robbanas"-t jelentett rendben lezajlott
  // robbanas mellett.)
  const explosionsBefore = (await a.evaluate(
    "window.__spike.view.explosionsSpawned",
  )) as number;

  check(
    "a teszt savja szabad az arenaban",
    laneIsClear(),
    `${laneLabel()} -- e nelkul nem a sebzest mernenk`,
  );

  let destroyed = false;
  let rams = 0;
  for (; rams < 12 && !destroyed; rams++) {
    // MINDKETTONEK elnie kell, mielott ujra nekifutunk. A becsapodo
    // auto is sebzodik, tehat kozben O is kieshet -- olyankor a szerver
    // nem veszi at az allapotat, es a kovetkezo rammeles a semmibe
    // menne. (Elsore pontosan ez tortent: a teszt osszezavarodott.)
    await waitUntilAlive(a);
    await waitUntilAlive(b);

    // SZABAD SAVBAN futunk neki (arenaLane.ts). Korabban x=0 volt, es
    // a 120 m-es palyan EPPEN oda kerult egy konteneres fedezek: az
    // auto egy meter utan annak ment, a 12 rammelesbol egy sem ert el
    // B-ig, es a teszt ugy bukott, mintha a sebzes romlott volna el.
    await a.evaluate(
      ([x, z]) => (window as any).__spike.backend.reset({ x, y: 1.0, z }),
      [LANE_X, LANE_FAR_Z],
    );
    await b.evaluate(
      ([x, z]) => (window as any).__spike.backend.reset({ x, y: 1.0, z }),
      [LANE_X, LANE_NEAR_Z],
    );

    // MEGVARJUK a szerver-oldali ujraszinkront, nem alszunk fix ideig.
    //
    // A `reset` teleport, amit a plauzibilitas-ellenorzes -- helyesen --
    // elutasit, amig a resync be nem indul. Amig ez tart, a szerver a
    // REGI helyen tudja az autot, tehat a rammeles a szerver szerint
    // meg sem tortenik, es nem ad sebzest. 200 ms + jitter mellett a
    // fix 2500 ms neha kevesnek bizonyult: a 12 rammelesbol egy sem
    // szamitott, es a teszt 5 hibaval bukott el ugy, hogy a termekben
    // semmi baj nem volt. (Ugyanez a hiba a check-collision.ts-ben is
    // megvolt, ott mar javitva.)
    let synced = false;
    for (let i = 0; i < 30; i++) {
      if (await bothSynced(a, b)) { synced = true; break; }
      await sleep(300);
    }
    if (!synced) console.log("  [figyelem] a felallas nem szinkronizalt idoben");

    await a.keyboard.down("w");
    await sleep(4000);
    await a.keyboard.up("w");
    await sleep(800);

    destroyed = (await viewOf(a)).otherHp === 0;
  }

  // ROBBANAS a megsemmisuleskor. Enelkul a masik auto "nyomtalanul
  // eltunt" a jatekos szemszogebol -- pontosan ez volt a panasz.
  const explosionsAfter = (await a.evaluate(
    "window.__spike.view.explosionsSpawned",
  )) as number;
  const explosionSeen = explosionsAfter > explosionsBefore;

  const dead = await viewOf(a);
  check(
    "a megsemmisulest robbanas kiseri",
    explosionSeen === true,
    `${explosionsBefore} -> ${explosionsAfter} robbanas`,
  );
  check("eleg rammeles utan megsemmisul az auto", destroyed, `${rams} rammeles utan`);
  // A RONCS meg egy pillanatig latszik (WRECK_LINGER_MS), csak utana
  // tunik el. Korabban ugyanabban a kepkockaban pattant ki a vilagbol,
  // amelyikben meghalt -- a jatekos ezt "egyszeruen eltunt"-kent latta.
  // Ezert VARUNK az eltunesre, nem egy pillanatot mintazunk.
  let vanished = false;
  for (let i = 0; i < 20; i++) {
    if ((await viewOf(a)).otherVisible === false) { vanished = true; break; }
    await sleep(200);
  }
  check(
    "a megsemmisult auto vegul eltunik",
    vanished,
    vanished ? "a roncs utan" : "lathato maradt",
  );
  check(
    "a megsemmisult autonak nincs fizikai teste",
    dead.otherHasBody === false,
    "kulonben lathatatlan akadaly maradna",
  );

  // A MECCS kozbeszolhat: az eletek bevezetese ota (Last Car Standing)
  // egy hosszabb futasban a jatekos KIESHET, es akkor -- helyesen --
  // nem szuletik ujra. Ilyenkor a lenti ellenorzesek nem a
  // ujraszuletest merik, hanem a meccs-szabalyt; ezt kulon mondjuk ki,
  // hogy ne "elromlott ujraszuletes"-kent jelenjen meg.
  const matchState = (await b.evaluate(`(function () {
    var s = window.__spike;
    return { lives: s.net.lives, phase: s.net.match.phase };
  })()`)) as { lives: number | null; phase: string };
  check(
    "a meccs nem szolt kozbe (van meg elete, fut a meccs)",
    (matchState.lives ?? 0) > 0 && matchState.phase === "playing",
    `${matchState.lives} elet, fazis: ${matchState.phase}`,
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
