/**
 * Ket auto fizikai utkozese (terv 15.4: az utkozes latvanyat a kliens
 * szamolja lokalisan).
 *
 * B nekihajt A-nak; A-nak (aki all es NEM ad gazt) el kell mozdulnia.
 * Ez azt bizonyitja, hogy a tavoli auto valodi fizikai testkent van
 * jelen A vilagaban -- korabban athajtottak volna egymason.
 *
 * Futtatas (a vite dev-szervernek ES a jatekszervernek futnia kell):
 *   npx tsx scripts/check-collision.ts
 */
import { chromium, type Browser, type Page } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

/**
 * Mesterseges halozati kesleltetes (oda-vissza ut, ms).
 *   LAG=200 npx tsx scripts/check-collision.ts
 * Lasd terv 3. lepcso 6. pont.
 */
function argOrEnv(name: string, envName: string): number {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (arg) return Number(arg.split("=")[1]);
  return Number(process.env[envName] ?? 0);
}

const LAG_MS = argOrEnv("lag", "LAG");
const JITTER_MS = argOrEnv("jitter", "JITTER");

/** A query a hash ELE kerul: .../?lag=200#ABCD */
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

const ownPos = (page: Page): Promise<number[]> =>
  page.evaluate(() => (window as any).__spike.backend.getChassis().position as number[]);

const ownSpeed = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).__spike.backend.getTelemetry().speedKmh as number);

/** Minden kliens sajat bongeszot kap -- lasd check-multiplayer.ts. */
async function openClient(hash: string): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  [oldal-hiba] ${e.message}`));
  await page.goto(clientUrl(hash));
  await page.waitForFunction(() => !!(window as any).__spike, null, { timeout: 20000 });
  // Meg kell varni a TENYLEGES csatlakozast is, nem eleg a betoltes.
  // A `joined` uzenet hatasara a kliens a szerver altal kiosztott
  // spawn-pontra teleportal -- ha a teszt ez elott allitja be a
  // jelenetet, a csatlakozas visszarantja a kocsit, es az utkozes meg
  // sem tortenik. Kesleltetes mellett ez konnyen becsuszik.
  await page.waitForFunction(
    () => !!(window as any).__spike?.net?.playerId,
    null,
    { timeout: 20000 },
  );
  return { browser, page };
}

async function waitForSettled(page: Page, timeoutMs = 8000): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => {
        const s = (window as any).__spike;
        return s.backend.getTelemetry().wheelsOnGround === 4 &&
          Math.abs(s.backend.getVelocity()[1]) < 0.3;
      },
      null,
      { timeout: timeoutMs, polling: 100 },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * A ket autot egymas mele allitjuk, hogy az utkozes biztosan
 * bekovetkezzen: a spawn-pontok tul tavol vannak ahhoz, hogy a
 * headless (lassu) szimulacioban ossze tudjanak erni.
 */
/**
 * A a nekifuto, B az allo cel.
 *
 * SZANDEKOSAN A vezet: a jatekos panasza pont az volt, hogy amikor O
 * megy neki valakinek, a MASIK auto csak kesve mozdul a kepernyojen.
 * Ezt csak akkor lehet merni, ha a becsapodo auto az, amelyiket
 * figyeljuk.
 *
 * Hosszu (30 m) nekifuto kell: a headless (szoftveres) renderelo
 * lassabban szimulal, rovid tavon a kocsi meg alig gyorsul fel, es az
 * utkozes erotlen lenne -- nem a fizika, hanem a teszt miatt.
 */
async function placeFacing(a: Page, b: Page): Promise<void> {
  await a.evaluate(() => {
    (window as any).__spike.backend.reset({ x: 0, y: 1.0, z: 30 });
  });
  await b.evaluate(() => {
    (window as any).__spike.backend.reset({ x: 0, y: 1.0, z: 0 });
  });
}

async function main(): Promise<void> {
  console.log("=== Ket auto utkozese ===\n");

  const clientA = await openClient("");
  const a = clientA.page;
  await sleep(1500);
  const room = a.url().substring(a.url().indexOf("#"));

  const clientB = await openClient(room);
  const b = clientB.page;
  await sleep(2000);

  await placeFacing(a, b);
  await sleep(500);
  const settledA = await waitForSettled(a);
  const settledB = await waitForSettled(b);
  check(
    "mindket auto leert",
    settledA && settledB,
    `A=${settledA ? "ok" : "idotullepes"}, B=${settledB ? "ok" : "idotullepes"}`,
  );

  // A tavoli test letrejott-e A vilagaban?
  const hasBody = await a.evaluate(() => {
    const s = (window as any).__spike;
    const ids = s.view.remoteCarIds();
    return ids.length > 0 && s.backend.getRemoteBody(ids[0]) !== null;
  });
  check("B autojanak van fizikai teste A vilagaban", hasBody, `${hasBody}`);

  // A tavoli test kovesse B-t drift nelkul. Ezt kulon merjuk, mert a
  // test DINAMIKUS: ha az utkozesi csoportjai rosszak, beleakad az
  // arenaba, es a fizikai teste elvalik a kirajzolt autotol -- onnantol
  // egy lathatatlan akadallyal lehetne utkozni. (Ez tenylegesen
  // megtortent: egy lada mogott ragadt.)
  const trackError = async (): Promise<number> => {
    const bReal = await ownPos(b);
    // A publikus getRemoteBody-t hasznaljuk, nem a belso adatszerkezetet:
    // az utobbi valtozhat (es valtozott is), amitol a teszt eltorne
    // anelkul, hogy a termekben barmi baj lenne.
    const bodyPos: number[] = await a.evaluate(() => {
      const s = (window as any).__spike;
      const t = s.backend.getRemoteBody(s.view.remoteCarIds()[0]);
      return t ? t.position : [NaN, NaN, NaN];
    });
    return Math.hypot(
      bodyPos[0] - bReal[0],
      bodyPos[1] - bReal[1],
      bodyPos[2] - bReal[2],
    );
  };

  // A jelenet felallitasa (placeFacing) TELEPORTALJA az autokat egy
  // tetszoleges helyre. A szerver plauzibilitas-ellenorzese ezt --
  // helyesen -- elutasitja, es csak nehany uzenet utan szinkronizal
  // ujra; kesleltetes es jitter mellett ez tovabb tart. Valodi jatekban
  // ilyen ugras nincs (az ujraszuletes engedelyezett), tehat ez a teszt
  // sajat felallasi koltsege -- megvarjuk, nem pedig alszunk ra.
  for (let i = 0; i < 30; i++) {
    if ((await trackError()) < 1) break;
    await sleep(300);
  }

  let maxIdleError = 0;
  for (let i = 0; i < 5; i++) {
    await sleep(600);
    maxIdleError = Math.max(maxIdleError, await trackError());
  }
  check(
    "a tavoli test kovetl B-t (nem ragad be az arenaba)",
    maxIdleError < 1,
    `legnagyobb elteres ${maxIdleError.toFixed(3)} m`,
  );

  // A becsapodas utani nehany szaz ms-ot kulon figyeljuk. Ket hibat
  // kell kizarni, amit csak igy lehet eszrevenni:
  //  1. VISSZASZIVODAS: a lokalis lokes lathato, de a halozati
  //     korrekcio visszahuzza, mielott a hiteles allapot beerne --
  //     a jatekos ezt kesleltetesnek latja.
  //  2. VISSZAUGRAS: a lokalis joslat tul messzire szalad, es amikor a
  //     korrekcio (vagy az athelyezes) beavatkozik, a kocsi ugrik.
  await a.evaluate(`
    (function () {
      var s = window.__spike;
      var view = s.view;
      var car = view.remoteCars.get(view.remoteCarIds()[0]);
      // A kiindulopontot a BECSAPODAS pillanataban rogzitjuk, nem a
      // figyelo inditasakor -- kulonben a masik auto teljes nekifutasat
      // mernenk, nem a lokest.
      var id = view.remoteCarIds()[0];
      window.__imp = { impactAt: 0, prevSpeed: 0, startZ: 0,
                       maxAway: 0, worstPullback: 0, maxLead: 0 };
      function tick() {
        var d = window.__imp;
        var sp = s.backend.getTelemetry().speedKmh;
        var z = car.wrapper.position.z;

        // Mennyivel jar a KIRAJZOLT auto a hiteles (halozati) pozicio
        // elott. EZT szabalyozzuk kozvetlenul (a joslat elteres-korlatja),
        // ezert ez a stabil mutatoja annak, hogy a joslat mukodik-e --
        // szemben a 700 ms alatt megtett uttal, ami a kepkockasebesseg
        // es a becsapodasi sebesseg ingadozasatol fuggoen szelesen szor.
        if (d.impactAt) {
          var net = null;
          try { net = s.net.remotes.sample(id, performance.now()); } catch (e) {}
          if (net) {
            var lead = Math.abs(z - net.position.z);
            if (lead > d.maxLead) d.maxLead = lead;
          }
        }
        if (!d.impactAt && d.prevSpeed > 25 && sp < d.prevSpeed - 8) {
          d.impactAt = performance.now();
          d.startZ = z;
        }
        d.prevSpeed = sp;
        if (d.impactAt && performance.now() - d.impactAt < 700) {
          var away = Math.abs(z - d.startZ);
          if (away > d.maxAway) d.maxAway = away;
          // A "visszahuzas" a csucstol valo visszalepes: EZ az a
          // muterme, amit ki akarunk zarni (visszaszivodas vagy ugras).
          var pullback = d.maxAway - away;
          if (pullback > d.worstPullback) d.worstPullback = pullback;
        }
        requestAnimationFrame(tick);
      }
      tick();
    })()
  `);

  const bBefore = await ownPos(b);

  // A teljes gazzal nekihajt B-nek. B NEM ad gazt -- ha elmozdul, azt
  // csak az utkozes okozhatta.
  await a.keyboard.down("w");

  // Megvarjuk, amig A tenylegesen odaer (vagy lejar az ido), es kozben
  // feljegyezzuk a becsapodas elotti sebesseget -- ez mutatja, hogy az
  // utkozes egyaltalan erdemi sebesseggel tortent-e.
  let impactSpeed = 0;
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    const [ap, as] = await Promise.all([ownPos(a), ownSpeed(a)]);
    const distance = Math.abs(ap[2] - bBefore[2]);
    if (distance > 6) impactSpeed = as;
    if (distance < 5.2) break;
  }
  await sleep(1500);
  await a.keyboard.up("w");
  await sleep(500);

  check(
    "A erdemi sebesseggel csapodott be",
    impactSpeed > 15,
    `${impactSpeed.toFixed(0)} km/h a becsapodas elott`,
  );

  const bAfter = await ownPos(b);
  const bMoved = Math.hypot(bAfter[0] - bBefore[0], bAfter[2] - bBefore[2]);

  check(
    "az allo autot ellokte az utkozes",
    bMoved > 0.5,
    `B elmozdult ${bMoved.toFixed(2)} m-t (gaz nelkul)`,
  );

  // Az atcsuszast MINDKET jatekos SAJAT kepernyojen merjuk.
  //
  // FONTOS, hogy miert nem a ket hiteles poziciot hasonlitjuk ossze:
  // azt EGYIK jatekos sem latja. A hibrid modellben (terv 15.4) minden
  // kliens a sajat autojat szimulalja, a masikat pedig a halozatrol
  // kapott (es utkozeskor lokalisan tovabbjosolt) allapotbol rajzolja --
  // a ket nezet az utkozes korul szukszegszeruen eltér. Egy ilyen meres
  // "atcsuszast" jelezne olyankor is, amikor mindket jatekos tokeletesen
  // rendben levo utkozest lat. A jatekelmeny szempontjabol az szamit,
  // hogy a SAJAT kepernyojen egyik jatekos se lasson atfedest.
  const drawnGap = (page: Page): Promise<number> =>
    page.evaluate(() => {
      const s = (window as any).__spike;
      const own = s.backend.getChassis().position as number[];
      const ids = s.view.remoteCarIds();
      if (ids.length === 0) return Infinity;
      const other = s.backend.getRemoteBody(ids[0]);
      if (!other) return Infinity;
      return Math.hypot(own[0] - other.position[0], own[2] - other.position[2]);
    });

  // A ket karosszeria fel-hossza 2.455, tehat orr-orr utkozesnel a
  // kozeppontok kozott ~4.9 m marad.
  const gapOnA = await drawnGap(a);
  const gapOnB = await drawnGap(b);
  check(
    "A nem csuszott at a masik auton (sajat kepernyojen)",
    gapOnA > 3.5,
    `${gapOnA.toFixed(2)} m`,
  );
  check(
    "B nem csuszott at a masik auton (sajat kepernyojen)",
    gapOnB > 3.5,
    `${gapOnB.toFixed(2)} m`,
  );

  const imp: {
    impactAt: number;
    maxAway: number;
    worstPullback: number;
    maxLead: number;
  } = await a.evaluate("window.__imp");

  // A lokes ne csak "valamennyire" latszodjon: a becsapodas utani rovid
  // ablakban a KIRAJZOLT elmozdulasnak a VALODI elmozdulas erdemi
  // reszet ki kell tennie. Fix kis kuszob (pl. 0.3 m) megtevesztő
  // lenne -- azt egy alig lathato lokes is teljesitene, kozben a
  // jatekos tovabbra is kesleltetest erezne.
  const bTotalMoved = Math.hypot(
    bAfter[0] - bBefore[0],
    bAfter[2] - bBefore[2],
  );
  // A joslat mukodesenek STABIL mutatoja: mennyivel jart a kirajzolt
  // auto a hiteles pozicio elott. Ez az, amit kozvetlenul szabalyozunk
  // (REMOTE_PREDICTION_MAX_OFFSET = 2.5 m), tehat kesleltetestol
  // fuggetlenul el kell erni egy erdemi reszet.
  //
  // Korabban a becsapodas utani 700 ms-ban megtett utat mertuk, de az
  // a kepkockasebesseg es a becsapodasi sebesseg ingadozasatol fuggoen
  // 2.5 es 6.6 m kozott szort UGYANAZON a beallitason -- alkalmatlan
  // volt kuszobot huzni ra.
  check(
    "a joslat erdemi elonyt epit a hiteles poziciohoz kepest",
    imp.impactAt > 0 && imp.maxLead > 1.0,
    `${imp.maxLead.toFixed(2)} m elony (korlat 2.5 m), a becsapodas utani 700 ms-ban ${imp.maxAway.toFixed(2)} m latszott a teljes ${bTotalMoved.toFixed(2)} m-bol`,
  );
  // Ez a ket muterme jelenne meg "keslelteteskent" a jatekosnak: vagy
  // a lokes szivodik vissza, mielott a halozat beerne, vagy a tul
  // messzire szaladt joslat ugrik vissza.
  check(
    "a lokes nem szivodik vissza es nem ugrik",
    imp.worstPullback < 0.4,
    `legnagyobb visszahuzas ${imp.worstPullback.toFixed(2)} m`,
  );

  // Az ERINTKEZES UTAN a testnek vissza kell allnia a hiteles
  // poziciora -- kulonben a szolver es a halozat "harcolna" egymassal,
  // es a test tartosan elcsuszna a kirajzolt autotol.
  //
  // Eloszor SZETVALASZTJUK a ket autot. Amig egymasnak feszulnek, a
  // joglat jogosan tart (ez a lokes lathatosaganak ara), tehat ott meg
  // nem is szabadna teljes egyezest varni -- e nelkul a lepes nelkul a
  // meres neha 1.5 m-es "hibat" jelzett, holott csak azt latta, hogy a
  // ket auto meg mindig osszeer.
  await a.keyboard.down("s");
  await sleep(900);
  await a.keyboard.up("s");
  await sleep(1800);
  const recoveredError = await trackError();
  check(
    "utkozes utan visszaall a hiteles poziciora",
    recoveredError < 1,
    `${recoveredError.toFixed(3)} m elteres`,
  );

  await a.screenshot({ path: "out/collision.png" });

  await clientA.browser.close();
  await clientB.browser.close();

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("A teszt osszeomlott:", err);
  process.exit(1);
});
