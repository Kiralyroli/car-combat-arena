/**
 * A KIRAJZOLT rakéta es a KIRAJZOLT celpont egy idovonalon van-e?
 *
 * Ez a "amit latok, az tortent" ellenorzese. A rakétat es a tavoli
 * autokat is a szerver kuldi ugyanabban a snapshotban, de a KLIENSEN
 * korabban ketfele bantunk veluk: az autok interpolacios pufferbol
 * (100 ms kesleltetes), a rakéta viszont a legfrissebb snapshotbol
 * rajzolodott azonnal. A lovedek igy ~100 ms-szal a celpont ELOTT jart
 * a kepernyon -- 55 m/s mellett 5.5 m --, tehat a jatekos elhuzni latta
 * a cel mellett olyankor is, amikor a szerver talalatot konyvelt.
 *
 * Ket dolgot merunk, mindkettot A SAJAT KEPERNYOJEROL:
 *   1. a lovedek tenylegesen ELERI-e a kirajzolt celpontot, amikor a
 *      szerver talalatot ad (idovonal-egyezes),
 *   2. simán mozog-e (nem 20 Hz-es, 2.75 m-es ugrasokkal).
 *
 * Futtatas: npx tsx scripts/check-rocket-visual.ts [--lag=200 --jitter=60]
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

const ownPos = (page: Page): Promise<number[]> =>
  page.evaluate(() => (window as any).__spike.backend.getChassis().position as number[]);

const ownHp = (page: Page): Promise<number | null> =>
  page.evaluate(() => (window as any).__spike.net.hp as number | null);

async function main(): Promise<void> {
  console.log("=== Rakéta: latvany es talalat egyezese ===\n");

  const clientA = await openClient("");
  const a = clientA.page;
  await sleep(1500);
  const room = a.url().substring(a.url().indexOf("#"));
  const clientB = await openClient(room);
  const b = clientB.page;
  await sleep(2000);

  // A a lovo, B az allo cel -- egymassal szemben, 25 m-re.
  await a.evaluate(() => (window as any).__spike.backend.reset({ x: 0, y: 1.0, z: 25 }));
  await b.evaluate(() => (window as any).__spike.backend.reset({ x: 0, y: 1.0, z: 0 }));
  await sleep(600);

  // A felallas teleportal, amit a plauzibilitas-ellenorzes elutasit,
  // amig ujra nem szinkronizal. MINDKET iranyban megvarjuk -- lasd a
  // check-collision.ts-ben reszletesen leirt esetet.
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

  // A figyelo SZANDEKOSAN fix utemu setInterval, nem
  // requestAnimationFrame.
  //
  // A headless (szoftveres) renderelo ~9 fps-re esik vissza, es a rAF
  // ezzel egyutt fojtodik: a 0.45 s-os repulesre igy 4 kepkocka jut,
  // amibol a figyelo a lovedeket teljesen kihagyta. (Eloszor pontosan
  // ez tortent -- 0 eszlelt kepkocka, holott a rakéta rendben repult.)
  //
  // Ami minket erdekel, az amugy sem a renderelo sebessege, hanem hogy
  // a kliens EGY IDOVONALON valaszolja-e meg a "hol a rakéta" es a
  // "hol a celpont" kerdest. Mindkettot ugyanabban a pillanatban
  // kerdezzuk le, igy a meres fuggetlen a kepkockasebessegtol.
  await a.evaluate(`
    (function () {
      var s = window.__spike;
      window.__rv = { minGap: Infinity, samples: 0, seen: 0, frozen: 0, moved: 0 };
      var prev = null;
      setInterval(function () {
        var d = window.__rv;
        var now = performance.now();
        d.samples++;

        var rockets = s.net.rockets.sample(now);
        var ids = s.view.remoteCarIds();
        if (rockets.length === 0 || ids.length === 0) { prev = null; return; }

        var car = s.net.remotes.sample(ids[0], now);
        if (!car) { prev = null; return; }

        d.seen++;
        var r = rockets[0].position;
        var gap = Math.sqrt(
          (r[0] - car.position.x) * (r[0] - car.position.x) +
          (r[1] - car.position.y) * (r[1] - car.position.y) +
          (r[2] - car.position.z) * (r[2] - car.position.z)
        );
        if (gap < d.minGap) d.minGap = gap;

        // Simasag: interpolacio NELKUL a lovedek csak snapshotonkent
        // (50 ms) valtozna, tehat az 5 ms-os mintak tobbsege azonos
        // poziciot adna vissza. Interpolacioval szinte mindegyik mozog.
        if (prev) {
          var step = Math.sqrt(
            (r[0] - prev[0]) * (r[0] - prev[0]) +
            (r[1] - prev[1]) * (r[1] - prev[1]) +
            (r[2] - prev[2]) * (r[2] - prev[2])
          );
          if (step < 1e-6) d.frozen++; else d.moved++;
        }
        prev = r;
      }, 5);
    })()
  `);

  const hpBefore = await ownHp(b);

  // KET lovest adunk le, es a legjobban megfigyelt repulest ertekeljuk.
  //
  // Nem a termek miatt: a headless bongeszo idozitoi a szoftveres
  // renderelo terhe alatt idonkent 200 ms-ra megallnak, es egy 0.45 s-os
  // repules igy teljesen kimaradhat a mintavetelbol. Ez egyszer 12 m-es
  // "legkozelebbi tavolsagot" produkalt olyan futasban, ahol a lovedek
  // rendben celba ert. Ket repules mellett annak az eselye, hogy
  // MINDKETTO kimaradjon, elhanyagolhato.
  //
  // Ketto es nem harom: talalatonkent 36 HP fogy, tehat a harmadik
  // lovessel B meghalna es ujraszuletne -- attol a celpont elmozdulna.
  for (let shot = 0; shot < 2; shot++) {
    await a.evaluate(() => (window as any).__spike.net.fire([0, 1, -30]));
    // Repules 25 m-t 55 m/s-mal ~0.45 s, plusz a halozati ut, a puffer
    // es a lovedek 1200 ms-os hutese.
    await sleep(1800);
  }

  const hpAfter = await ownHp(b);
  const rv: {
    minGap: number;
    samples: number;
    seen: number;
    frozen: number;
    moved: number;
  } = await a.evaluate("window.__rv");

  check(
    "a szerver talalatot adott",
    hpBefore !== null && hpAfter !== null && hpAfter < hpBefore,
    `B HP: ${hpBefore} -> ${hpAfter}`,
  );
  // Ez KULON ellenorzes, es szandekosan a tobbi meres ELOTT all: ha a
  // mintavetel ehezett, a tavolsag es a simasag egyarant ertelmetlen,
  // es felrevezető lenne termekhibakent jelenteni.
  //
  // EGY kuszob vonatkozik mindketto merohoz (a lentiek ezt hasznaljak),
  // kulonben az egyik meres sajat, gyengebb feltetellel bukna el olyan
  // futasban, ahol a masik meg ervenyes -- ez tenylegesen megtortent.
  const paired = rv.frozen + rv.moved;
  const enoughSamples = paired >= 5;
  check(
    "eleg minta gyult a repulesekrol",
    enoughSamples,
    `${paired} egymast koveto mintapar (${rv.seen} eszleles, ${rv.samples} osszes minta)`,
  );

  // A kirajzolt lovedeknek el kell ernie a kirajzolt autot, ha a szerver
  // talalatot adott. A talalati pont a kozepponttol 3.06 m (fel-hossz
  // 2.455 + lovedek-sugar 0.6).
  //
  // A kuszob 5.8 m, es ez NEM elnezes: a szerver 20 Hz-en kuld, de
  // 60 Hz-en lepteti a rakétat, tehat az utolso ELKULDOTT pozicio akar
  // egy teljes snapshot-lepessel (2.75 m) a becsapodas elott van. A
  // hianyzo darabot a kliens tovabbvetiti, de a pontos vegpont elvileg
  // sem megfigyelheto -- a merteknek ezert 3.06 + 2.75 a hatara.
  //
  // Az IDOVONAL-egyezest nem ez a meres orzi (allo celpontnal az nem is
  // latszana), hanem a check-interp-timeline.ts egysegteszt.
  check(
    "a kirajzolt rakéta eleri a kirajzolt celpontot",
    enoughSamples && rv.minGap < 5.8,
    `legkozelebbi tavolsag ${rv.minGap.toFixed(2)} m (talalati pont 3.06 m, snapshot-lepes 2.75 m)`,
  );

  // Simasag: interpolacio nelkul a lovedek csak snapshotonkent (50 ms)
  // valtozna, tehat a 15 ms-os mintaknak nagyjabol a ketharmada
  // VALTOZATLAN poziciot adna. Interpolacioval szinte mindegyik mozog.
  const frozenRatio = paired > 0 ? rv.frozen / paired : 1;
  check(
    "a rakéta folyamatosan mozog (nem snapshotonkent ugrik)",
    enoughSamples && frozenRatio < 0.2,
    `a mintak ${(frozenRatio * 100).toFixed(0)}%-a volt valtozatlan (${rv.frozen}/${paired}) -- interpolacio nelkul ~66% lenne`,
  );

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;

  await clientA.browser.close();
  await clientB.browser.close();
}

main();
