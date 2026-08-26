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
import {
  LANE_FAR_Z,
  LANE_NEAR_Z,
  LANE_X,
  laneIsClear,
  laneLabel,
} from "./arenaLane";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

/** A tesztkliensek neve -- a ?name= egyben atugorja a nev-parbeszedet. */
const testName = "Utkozes";

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
/**
 * A ket auto helye: EGY SZABAD SAVBAN, egymassal szemben.
 *
 * A savot es a szabadsag-ellenorzest az arenaLane.ts tartja -- a
 * check:death ugyanazt hasznalja, mert ugyanaz a csapda varja.
 */
async function placeFacing(a: Page, b: Page): Promise<void> {
  await a.evaluate(
    ([x, z]) => {
      (window as any).__spike.backend.reset({ x, y: 1.0, z });
    },
    [LANE_X, LANE_FAR_Z],
  );
  await b.evaluate(
    ([x, z]) => {
      (window as any).__spike.backend.reset({ x, y: 1.0, z });
    },
    [LANE_X, LANE_NEAR_Z],
  );
}

async function main(): Promise<void> {
  console.log("=== Ket auto utkozese ===\n");

  const clientA = await openClient("");
  const a = clientA.page;
  await sleep(1500);
  const room = a.url().substring(a.url().indexOf("#"));

  const clientB = await openClient(room);
  const b = clientB.page;

  // ELOBB megvarjuk a meccs indulasat, es csak UTANA allitjuk fel a
  // jelenetet.
  //
  // Ket jatekosnal a meccs magatol elindul, es az indulas MINDENKIT
  // ujraszulet -- vagyis a szerver a spawn-pontjara teszi az autokat,
  // felulirva a placeFacing-et. Amig a meccs nem megy, a kocsi nem is
  // indul el: merve, a teljes gaz mellett is 0 km/h maradt, es a ket
  // auto vegig 29 m-re allt egymastol. (Ugyanez a csapda a check:mg-ben
  // is meg van jegyezve.)
  await b.waitForFunction(
    () => (window as any).__spike?.net?.match?.phase === "playing",
    null,
    { timeout: 25000 },
  );
  await sleep(2000);

  check(
    "a teszt savja szabad az arenaban",
    laneIsClear(),
    `${laneLabel()} -- e nelkul nem az utkozest mernenk`,
  );

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
  // MINDKET iranyban meg kell varni, nem csak A szemszogebol!
  //
  // A `trackError` azt meri, hogy A vilagaban jo helyen van-e B teste --
  // vagyis csak azt, hogy a szerver mar ujraszinkronizalta-e B-t. A
  // sajat allapota ettol fuggetlenul meg elutasitott lehet, es akkor a
  // szerver A-t tovabbra is a REGI spawn-pontjan tudja. Ilyenkor a
  // nekifutas kliens-oldalon tokeletesen lezajlik (a lokes latszik), de
  // a szerver ket olyan autot lat, amelyek soha nem ernek ossze, tehat
  // NEM ad sebzest -- a teszt ugy bukott el, hogy a termekben semmi baj
  // nem volt. 200 ms + jitter mellett kb. minden tizedik futasban
  // becsuszott, mert A ujraszinkronja (10 elutasitott allapot utan)
  // neha csak a becsapodas kozben ert oda.
  const errorAtoB = trackError;
  const errorBtoA = async (): Promise<number> => {
    const aReal = await ownPos(a);
    const bodyPos: number[] = await b.evaluate(() => {
      const s = (window as any).__spike;
      const ids = s.view.remoteCarIds();
      if (ids.length === 0) return [NaN, NaN, NaN];
      const t = s.backend.getRemoteBody(ids[0]);
      return t ? t.position : [NaN, NaN, NaN];
    });
    return Math.hypot(
      bodyPos[0] - aReal[0],
      bodyPos[1] - aReal[1],
      bodyPos[2] - aReal[2],
    );
  };

  let syncedAtoB = false;
  let syncedBtoA = false;
  for (let i = 0; i < 40; i++) {
    if (!syncedAtoB && (await errorAtoB()) < 1) syncedAtoB = true;
    if (!syncedBtoA && (await errorBtoA()) < 1) syncedBtoA = true;
    if (syncedAtoB && syncedBtoA) break;
    await sleep(300);
  }
  check(
    "a felallas utan mindket auto ujraszinkronizalodott",
    syncedAtoB && syncedBtoA,
    `A->B ${syncedAtoB ? "ok" : "idotullepes"}, B->A ${syncedBtoA ? "ok" : "idotullepes"}`,
  );

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
      // maxStepBack: a legnagyobb EGY KEPKOCKA alatti visszalepes.
      // A worstPullback osszesitett mutato -- egy lassu, sima
      // visszarendezodes ugyanakkora erteket ad, mint egy hirtelen
      // ugras, pedig a jatekos csak az utobbit latja hibanak. A ketto
      // egyutt mondja meg, melyikrol van szo.
      window.__imp = { impactAt: 0, prevSpeed: 0, startZ: 0, prevZ: 0, hasPrev: false,
                       maxAway: 0, worstPullback: 0, maxLead: 0,
                       maxStepBack: 0 };
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
          // A becsapodas kepkockajaban meg nincs ERVENYES elozo minta az
          // ablakon belul: a prevZ meg a becsapodas ELOTTI kepkockabol
          // valo, ahol az auto ~25 m/s-mal jott, tehat egy ~0.4 m-es
          // "visszalepest" mutatna, ami valojaban a nekifutas. (Pont ezt
          // merte a mutato eloszor, meg 0 ms kesleltetesnel is.)
          d.hasPrev = false;
        }
        d.prevSpeed = sp;
        if (d.impactAt && performance.now() - d.impactAt < 700) {
          var away = Math.abs(z - d.startZ);
          if (away > d.maxAway) d.maxAway = away;
          // A "visszahuzas" a csucstol valo visszalepes: EZ az a
          // muterme, amit ki akarunk zarni (visszaszivodas vagy ugras).
          var pullback = d.maxAway - away;
          if (pullback > d.worstPullback) d.worstPullback = pullback;

          // Visszafele tett lepes ebben a kepkockaban (a lokes iranya a
          // novekvo |z - startZ|, tehat a csokkenes a visszalepes).
          // Kulon jelzo, nem a prevZ igazsagerteke: a cel-auto eppen
          // z ~ 0-nal all, tehat a "prevZ nem nulla" ellenorzes
          // veletlenszeruen kihagyna kepkockakat.
          if (d.hasPrev) {
            var stepBack = Math.abs(d.prevZ - d.startZ) - away;
            if (stepBack > d.maxStepBack) d.maxStepBack = stepBack;
          }
          d.prevZ = z;
          d.hasPrev = true;
        }
        requestAnimationFrame(tick);
      }
      tick();
    })()
  `);

  const bBefore = await ownPos(b);
  const ownHp = (page: Page): Promise<number | null> =>
    page.evaluate(() => (window as any).__spike.net.hp as number | null);
  const hpBefore = { a: await ownHp(a), b: await ownHp(b) };

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
    maxStepBack: number;
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
  // A megengedett visszahuzas a KESLELTETESSEL nő, es ez nem
  // engedmeny: a joslat tartasa es a rakovetkezo osszesimitas merteke
  // a mert pingbol szamolodik (lasd REMOTE_COLLISION_HOLD_BASE_MS es
  // a hozza tartozo burkologorbe a rapier.ts-ben). Ugyanaz a 0.4 m-es
  // korlat 0 ms-on es 200 ms + jitteren nem ugyanazt a kovetelmenyt
  // jelenti -- meressel 0 ms-on mindig 0.00 m, 200/60-on viszont
  // alkalmankent 0.44-0.72 m, valodi termekhiba nelkul.
  const pullbackLimit = 0.4 + LAG_MS * 0.0025;
  check(
    "a lokes nem szivodik vissza es nem ugrik",
    imp.worstPullback < pullbackLimit,
    `legnagyobb visszahuzas ${imp.worstPullback.toFixed(2)} m (korlat ${pullbackLimit.toFixed(2)} m), legnagyobb egy-kepkockas visszalepes ${imp.maxStepBack.toFixed(3)} m`,
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

  // Sebzes: a SZERVER donti el (terv 15.4) -- a kliens nem jelent be
  // talalatot, csak a HP-t kapja vissza a snapshotban.
  const hpAfter = { a: await ownHp(a), b: await ownHp(b) };
  check(
    "az utkozes mindket autonak sebzett",
    hpBefore.a !== null &&
      hpAfter.a !== null &&
      hpBefore.b !== null &&
      hpAfter.b !== null &&
      hpAfter.a < hpBefore.a &&
      hpAfter.b < hpBefore.b,
    `A: ${hpBefore.a} -> ${hpAfter.a}, B: ${hpBefore.b} -> ${hpAfter.b}`,
  );

  // A a nekifuto, B az allo cel -- a tamado jarjon jobban.
  const lostA = (hpBefore.a ?? 0) - (hpAfter.a ?? 0);
  const lostB = (hpBefore.b ?? 0) - (hpAfter.b ?? 0);
  check(
    "a nekimeno auto kevesebb HP-t vesztett",
    lostA < lostB,
    `A (nekiment) -${lostA} HP, B (allt) -${lostB} HP`,
  );

  // A tobbi jatekos HP-ja lathato az autoja felett.
  const remoteHpShown: number | null = await a.evaluate(() => {
    const s = (window as any).__spike;
    const ids = s.view.remoteCarIds();
    if (ids.length === 0) return null;
    return s.net.remotes.hpOf(ids[0]) as number | null;
  });
  check(
    "a masik jatekos HP-ja elerheto a kliensen",
    remoteHpShown !== null && remoteHpShown === hpAfter.b,
    `${remoteHpShown} (B valos HP-ja: ${hpAfter.b})`,
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
