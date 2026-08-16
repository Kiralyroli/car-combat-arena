/**
 * Last Car Standing a teljes lancon (terv 5. lepcso 2. pont).
 *
 * A szabalyokat a check-match.ts meri headlessen; itt az a kerdes,
 * hogy a lanc osszeall-e ket valodi klienssel:
 *   - ket jatekossal ELINDUL a meccs (egyedul nem),
 *   - halalonkent EGY elet fogy, es 5 mp mulva ujraszuletes van,
 *   - a harmadik halal utan a jatekos KIESIK: nem szuletik ujra,
 *   - ilyenkor a meccs VEGET er, es a masik a gyoztes,
 *   - a kiesett jatekos NEZO lesz (sajat autoja rejtve, a kamera
 *     egy elo jatekost kovet).
 *
 * Lassu teszt (harom kivegzes + 5 mp-es ujraszuletesek), ezert nem
 * resze a gyors koroknek.
 *
 * Futtatas: npx tsx scripts/check-match-flow.ts [--lag=200 --jitter=60]
 */
import { chromium, type Browser, type Page } from "playwright";
import { LIVES_PER_PLAYER } from "@cca/shared";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

/** A tesztkliensek neve -- a ?name= egyben atugorja a nev-parbeszedet. */
const testName = "Meccs";

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

interface MatchView {
  phase: string;
  survivors: number;
  winnerId: string | null;
  lives: number | null;
  ownId: string | null;
  ownVisible: boolean;
}

const matchOf = (page: Page): Promise<MatchView> =>
  page.evaluate(`(function () {
    var s = window.__spike;
    return {
      phase: s.net.match.phase,
      survivors: s.net.match.survivors,
      winnerId: s.net.match.winnerId,
      lives: s.net.lives,
      ownId: s.net.playerId,
      ownVisible: s.view.ownCarVisible,
    };
  })()`) as Promise<MatchView>;

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

/** A ket auto szerver-oldali allapota utolerte-e a teleportot. */
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

/**
 * Egy kivegzes: A nekihajt B-nek, amig B el nem veszit egy eletet.
 *
 * Az ELETSZAM csokkeneset figyeljuk, nem azt, hogy egy adott
 * pillanatban nulla-e B HP-ja. A HP visszaall az ujraszuletessel,
 * tehat egyetlen minta konnyen lecsuszik rola -- 200 ms kesleltetesnel
 * a teszt tenylegesen "nem tudta kivegezni"-t jelentett olyan
 * futasban, ahol a kovetkezo sor mar 3 -> 2 eletet mutatott. Az
 * eletszam viszont monoton csokken, azon nincs mit lecsuszni.
 */
async function ramUntilKill(a: Page, b: Page): Promise<boolean> {
  const livesBefore: number = await b.evaluate(
    () => ((window as any).__spike.net.lives ?? 0) as number,
  );
  for (let attempt = 0; attempt < 8; attempt++) {
    // Mindketto eljen, mielott ujra nekifutunk (A is sebzodik).
    await a.waitForFunction(() => ((window as any).__spike.net.hp ?? 0) > 0, null, {
      timeout: 15000,
    }).catch(() => undefined);
    await b.waitForFunction(() => ((window as any).__spike.net.hp ?? 0) > 0, null, {
      timeout: 15000,
    }).catch(() => undefined);

    await a.evaluate("window.__spike.backend.reset({ x: 0, y: 1.0, z: 34 })");
    await b.evaluate("window.__spike.backend.reset({ x: 0, y: 1.0, z: 0 })");

    // A teleportot a plauzibilitas-ellenorzes elutasitja, amig a resync
    // be nem indul -- addig a szerver szerint a ket auto nem is er ossze.
    for (let i = 0; i < 30; i++) {
      if (await bothSynced(a, b)) break;
      await sleep(300);
    }

    await a.keyboard.down("w");
    await sleep(4000);
    await a.keyboard.up("w");
    await sleep(800);

    const lives: number = await b.evaluate(
      () => ((window as any).__spike.net.lives ?? 0) as number,
    );
    if (lives < livesBefore) return true;
  }
  return false;
}

async function main(): Promise<void> {
  console.log("=== Last Car Standing (teljes lanc) ===\n");

  const clientA = await openClient("");
  const a = clientA.page;
  await sleep(1500);
  const room = a.url().substring(a.url().indexOf("#"));

  // EGYEDUL: a meccs meg nem indulhat el.
  const alone = await matchOf(a);
  check(
    "egy jatekossal a meccs varakozik",
    alone.phase === "waiting",
    `fazis: ${alone.phase}`,
  );

  const clientB = await openClient(room);
  const b = clientB.page;
  await sleep(2500);

  const started = await matchOf(a);
  check(
    "ket jatekossal elindul a meccs",
    started.phase === "playing",
    `fazis: ${started.phase}, ${started.survivors} talpon`,
  );
  check(
    "mindenki 3 elettel indul",
    started.lives === LIVES_PER_PLAYER,
    `${started.lives} elet`,
  );

  // Elso kivegzes: egy elet fogy, de a jatekos visszater.
  const killed = await ramUntilKill(a, b);
  check("A ki tudja vegezni B-t", killed, `${killed}`);

  await sleep(1200);
  const afterFirst = await matchOf(b);
  check(
    "egy halal egy eletbe kerul",
    afterFirst.lives === LIVES_PER_PLAYER - 1,
    `${LIVES_PER_PLAYER} -> ${afterFirst.lives}`,
  );

  // 5 mp-es ujraszuletes utan B ismet jatekban van.
  await b.waitForFunction(() => ((window as any).__spike.net.hp ?? 0) > 0, null, {
    timeout: 15000,
  }).catch(() => undefined);
  const respawned = await matchOf(b);
  check(
    "ujraszuletes utan B ismet jatszik",
    respawned.lives === LIVES_PER_PLAYER - 1 && respawned.ownVisible,
    `${respawned.lives} elet, auto lathato: ${respawned.ownVisible}`,
  );

  // Meg ket kivegzes: B kiesik.
  for (let i = 0; i < LIVES_PER_PLAYER - 1; i++) {
    await ramUntilKill(a, b);
    await sleep(1200);
  }

  const eliminated = await matchOf(b);
  check(
    "harom halal utan B kiesik",
    eliminated.lives === 0,
    `${eliminated.lives} elet`,
  );

  // A kiesett jatekos NEZO: a sajat autoja rejtve marad, es NEM
  // szuletik ujra (ez a kulonbseg a sima halalhoz kepest).
  await sleep(6000);
  const spectating = await matchOf(b);
  check(
    "a kiesett jatekos nem szuletik ujra",
    spectating.lives === 0,
    `${spectating.lives} elet a respawn-ido lejarta utan is`,
  );
  check(
    "a kiesett jatekos autoja rejtve van (nezomod)",
    spectating.ownVisible === false,
    `lathato: ${spectating.ownVisible}`,
  );

  // A meccsnek vegel kell ernie, es A a gyoztes.
  const ended = await matchOf(a);
  check(
    "a meccs veget ert",
    ended.phase === "ended",
    `fazis: ${ended.phase}`,
  );
  check(
    "A a gyoztes",
    ended.winnerId !== null && ended.winnerId === ended.ownId,
    ended.winnerId === ended.ownId ? "sajat magat jeloli gyoztesnek" : `${ended.winnerId}`,
  );
  const endedOnB = await matchOf(b);
  check(
    "B ugyanazt a gyoztest latja",
    endedOnB.winnerId === ended.winnerId,
    `${endedOnB.winnerId}`,
  );

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;

  await clientA.browser.close();
  await clientB.browser.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
