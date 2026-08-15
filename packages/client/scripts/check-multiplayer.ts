/**
 * Vegponttol vegpontig teszt: ket bongeszolap ugyanabban a szobaban.
 *
 * Ellenorzi, hogy (1) a szobakod atadodik az URL hash-en, (2) mindket
 * kliens latja a masik autojat a jelenetben, (3) a masik auto KOVETI a
 * mozgast, es (4) lecsatlakozaskor eltunik.
 *
 * Futtatas (a vite dev-szervernek ES a jatekszervernek futnia kell):
 *   npx tsx scripts/check-multiplayer.ts
 */
import { chromium, type Browser, type Page } from "playwright";
import { WHEEL } from "@cca/shared";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

/**
 * Mesterseges halozati kesleltetes (oda-vissza ut, ms).
 *   LAG=200 npx tsx scripts/check-multiplayer.ts
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

/** A jelenetben levo tavoli autok szama es poziciojuk. */
async function remoteCars(page: Page): Promise<{ count: number; positions: number[][] }> {
  return page.evaluate(() => {
    const view = (window as any).__spike?.view;
    if (!view) return { count: 0, positions: [] };
    const ids: string[] = view.remoteCarIds();
    return {
      count: ids.length,
      positions: ids.map((id: string) => {
        const car = (view as any).remoteCars.get(id);
        if (!car) return [];
        const p = car.wrapper.position;
        return [p.x, p.y, p.z];
      }),
    };
  });
}

/** Egy kliens SAJAT (lokalisan szimulalt) chassis-pozicioja. */
const ownPos = (page: Page): Promise<number[]> =>
  page.evaluate(() => (window as any).__spike.backend.getChassis().position as number[]);

/**
 * Megvarja, amig a `page` altal KIRAJZOLT tavoli auto is megnyugszik.
 *
 * Nem eleg megvarni, hogy a masik jatekos kocsija tenylegesen megalljon:
 * a megjelenites szandekosan le van maradva (interpolacios puffer), es a
 * lemaradas a HALOZATI KESLELTETESSEL no. Fix alvassal ez 0 ms-on meg
 * mukodik, 200 ms-on viszont mar nem -- a teszt olyankor egy meg mozgo
 * kepet hasonlitana a mar allo valosaghoz. Ezert a megfigyelheto
 * allapotra varunk, nem az orara.
 */
async function waitForRemoteStable(page: Page, timeoutMs = 6000): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => {
        const w = window as any;
        const view = w.__spike.view;
        const ids: string[] = view.remoteCarIds();
        if (ids.length === 0) return false;
        const t = w.__spike.backend.getRemoteBody(ids[0]);
        if (!t) return false;
        const prev = w.__prevRemotePos as number[] | undefined;
        w.__prevRemotePos = t.position;
        if (!prev) return false;
        return (
          Math.hypot(
            t.position[0] - prev[0],
            t.position[1] - prev[1],
            t.position[2] - prev[2],
          ) < 0.01
        );
      },
      null,
      { timeout: timeoutMs, polling: 120 },
    );
    return true;
  } catch {
    return false;
  }
}

/** Megvarja, amig a kocsi gyakorlatilag megall. */
async function waitForStopped(page: Page, timeoutMs = 6000): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => (window as any).__spike.backend.getTelemetry().speedKmh < 1.5,
      null,
      { timeout: timeoutMs, polling: 100 },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Megvarja, amig a kocsi leert es megallapodott.
 *
 * A spawn 2.5 m magasrol ejti be az autot (CHASSIS.spawn), es a
 * szerverhez csatlakozaskor is odateleportalunk. Ha a teszt mar ez
 * alatt "vezetni" kezd, a kocsi valojaban ZUHAN es oldalra csuszik --
 * a gazadasnak alig van hatasa, es a kerekek helyesen NEM gordulnek
 * (csuszo kerek nem gordul). Ilyenkor a merés a fizikat hibaztatna a
 * sajat rossz idozitese helyett.
 */
async function waitForSettled(page: Page, timeoutMs = 8000): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => {
        const s = (window as any).__spike;
        const t = s.backend.getTelemetry();
        const v = s.backend.getVelocity();
        return t.wheelsOnGround === 4 && Math.abs(v[1]) < 0.3;
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
 * Minden kliens SAJAT bongeszo-peldanyt kap.
 *
 * Egyetlen bongeszon belul ez a teszt nem mukodne: a hattérbe kerult
 * lap requestAnimationFrame-je fojtodik (tehat a fizikaja es a
 * rendereleses is szinte megall), raadasul a `blur` esemenyre az
 * input.ts szandekosan nullazza a lenyomott billentyuket. Igy mindig
 * csak az eppen elotérben levo kliens elne -- pont azt nem tudnank
 * megnezni, hogy ket EGYSZERRE futo jatekos latja-e egymast.
 */
async function openClient(hash: string): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  [oldal-hiba] ${e.message}`));
  await page.goto(clientUrl(hash));
  // Meg kell varni a fizika + modell betoltest...
  await page.waitForFunction(() => !!(window as any).__spike, null, { timeout: 20000 });
  // ...es a TENYLEGES csatlakozast is: a `joined` uzenet hatasara a
  // kliens a szerver altal kiosztott spawn-pontra teleportal, ami
  // felulirna a teszt altal beallitott allapotot.
  await page.waitForFunction(
    () => !!(window as any).__spike?.net?.playerId,
    null,
    { timeout: 20000 },
  );
  return { browser, page };
}

async function main(): Promise<void> {
  console.log("=== Multiplayer vegponttol vegpontig teszt ===\n");

  // 1. Elso kliens: uj szoba
  const clientA = await openClient("");
  const a = clientA.page;
  await sleep(1500);
  const roomCode = a.url().substring(a.url().indexOf("#") + 1);
  check("A kliens szobat nyitott", /^[A-Z0-9]{4}$/.test(roomCode), `hash=#${roomCode}`);

  // 2. Masodik kliens ugyanabba a szobaba
  const clientB = await openClient(`#${roomCode}`);
  const b = clientB.page;
  await sleep(2000);

  const aCars = await remoteCars(a);
  const bCars = await remoteCars(b);
  check("A latja B autojat", aCars.count === 1, `${aCars.count} tavoli auto`);
  check("B latja A autojat", bCars.count === 1, `${bCars.count} tavoli auto`);

  // A szerver kulon spawn-pontot oszt ki, kulonben a jatekosok
  // egymasba szuletnenek.
  const posA = await ownPos(a);
  const posB = await ownPos(b);
  const spawnGap = Math.hypot(posA[0] - posB[0], posA[2] - posB[2]);
  check(
    "kulon spawn-pontra kerultek",
    spawnGap > 4,
    `${spawnGap.toFixed(1)} m tavolsag`,
  );

  // Mindket kocsinak le kell ernie, mielott vezetni kezdenenk.
  const settledA = await waitForSettled(a);
  const settledB = await waitForSettled(b);
  check(
    "mindket auto leert es megallapodott",
    settledA && settledB,
    `A=${settledA ? "ok" : "idotullepes"}, B=${settledB ? "ok" : "idotullepes"}`,
  );

  // 3. B vezet -- A oldalan kovetnie kell a tavoli autonak.
  //    NEM abszolut elmozdulast varunk (a headless renderelo lassu es
  //    ingadozo, igy az megbizhatatlan kuszob lenne), hanem azt, hogy
  //    amit A rajzol, az EGYEZIK B sajat fizikai allapotaval.
  const before = (await remoteCars(a)).positions[0] ?? [];
  await b.keyboard.down("w");
  await sleep(2500);
  await b.keyboard.up("w");
  await sleep(600);

  // A kocsi megallasa utan hasonlitunk ossze. Menet kozben ez a meres
  // ertelmetlen lenne: a ket allapotot ket KULON bongeszotol kerdezzuk
  // le, egymas utan, es a koztes ido alatt a kocsi tovabbhalad --
  // 45 km/h-nal mar 400 ms csuszas is 5 m "hibat" mutatna, holott a
  // kovetes hibatlan. Allo helyzetben nincs mit elcsuszni, es az
  // interpolacios lemaradas is nulla, tehat szoros hatart szabhatunk.
  await waitForStopped(b);
  await waitForRemoteStable(a);

  // Addig varunk, amig a kirajzolt pozicio TENYLEG be nem er -- nem
  // csak amig meg nem all. A ketto nem ugyanaz: a megjelenites
  // megallhat ugy is, hogy meg 1-2 metert be kell hoznia, es a
  // behozas ideje a kesleltetessel no. Ha nem er be, az utolso mert
  // erteket jelentjuk, es az ellenorzes jogosan bukik.
  let bTruth = await ownPos(b);
  let after = (await remoteCars(a)).positions[0] ?? [];
  let trackErr = Infinity;
  for (let i = 0; i < 15; i++) {
    bTruth = await ownPos(b);
    after = (await remoteCars(a)).positions[0] ?? [];
    trackErr = Math.hypot(
      after[0] - bTruth[0],
      after[1] - bTruth[1],
      after[2] - bTruth[2],
    );
    if (trackErr < 0.3) break;
    await sleep(200);
  }

  const moved = Math.hypot(after[0] - before[0], after[2] - before[2]);
  check(
    "B tenylegesen elmozdult (input megerkezett)",
    moved > 0.5,
    `${moved.toFixed(2)} m elmozdulas A nezopontjabol`,
  );
  check(
    "A altal rajzolt pozicio megallas utan egyezik B valos allapotaval",
    trackErr < 0.5,
    `${trackErr.toFixed(3)} m elteres`,
  );

  // 3b. A tavoli auto kerekeinek animalodniuk kell: gordules, kormanyzas,
  //     rugo-mozgas. Ezek nem a fizikabol jonnek (tavoli autot nem
  //     szimulalunk), hanem a snapshot latvany-allapotabol.
  const wheelState = (page: Page) =>
    page.evaluate(() => {
      const view = (window as any).__spike.view;
      const id = view.remoteCarIds()[0];
      const car = (view as any).remoteCars.get(id);
      if (!car) return null;
      return {
        roll: car.rollAngle as number,
        wheelY: car.wheels.map((w: any) => w.position.y as number),
        restY: car.wheelRestY as number[],
        wheelQuatY: car.wheels.map((w: any) => w.quaternion.y as number),
        wheelScaleY: car.wheelMeshes.map((m: any) => m.scale.y as number),
        wheelColor: car.wheelMeshes.map((m: any) =>
          m.material.color.getHexString(),
        ),
      };
    });

  // Gordules: EGYENESEN vezetunk. Kanyarban a megtett UT hosszabb, mint
  // a legvonalbeli elmozdulas, igy a ketto osszehasonlitasa hamis
  // eltérest mutatna (ez a teszt korabbi verziojaban 1.55x-os
  // "hibat" produkalt, holott a gordules helyes volt).
  // A merest MINDKET vegen ALLO helyzetben vesszuk. Menet kozben a
  // megjelenitett auto szandekosan le van maradva a valos allapotatol
  // (interpolacios puffer), es ez a lemaradas a sebesseggel valtozik --
  // ha az egyik erteket gyorsulas kozben olvasnank ki, a ket oldal
  // mas-mas pillanatot irna le, es a teszt sajat magat merne el. Allo
  // helyzetben a lemaradas nulla, tehat a ket ertek osszevetheto.
  await b.keyboard.up("w");
  await waitForStopped(b);
  await waitForRemoteStable(a);
  const wsBefore = await wheelState(a);
  const posBefore = await ownPos(b);

  await b.keyboard.down("w");
  await sleep(2000);
  await b.keyboard.up("w");
  await waitForStopped(b);
  await waitForRemoteStable(a);
  const wsDuring = await wheelState(a);
  const posDuring = await ownPos(b);

  const distance = Math.hypot(
    posDuring[0] - posBefore[0],
    posDuring[2] - posBefore[2],
  );
  const rollDelta = wsBefore && wsDuring ? Math.abs(wsDuring.roll - wsBefore.roll) : 0;
  const expectedRoll = distance / WHEEL.radius;
  check(
    "tavoli kerekek gordulese aranyos a megtett uttal",
    expectedRoll > 1 && Math.abs(rollDelta - expectedRoll) / expectedRoll < 0.3,
    `${distance.toFixed(2)} m ut -> ${rollDelta.toFixed(2)} rad (elvart kb. ${expectedRoll.toFixed(2)})`,
  );

  // Kormanyzas: MENET KOZBEN merjuk (elengedes utan a kormany
  // visszaall kozepre, tehat utana mar nem lenne mit merni). TOBB
  // mintat veszunk es a maximumot nezzuk: egyetlen pillanatnyi minta
  // toreken, mert eppen a kormanyszog felfutasaba (vagy a headless
  // renderelo egy akadasaba) eshet.
  await b.keyboard.down("w");
  await b.keyboard.down("d");
  let maxFrontSteer = 0;
  let maxRearSteer = 0;
  for (let i = 0; i < 8; i++) {
    await sleep(250);
    const ws = await wheelState(a);
    if (!ws) continue;
    maxFrontSteer = Math.max(maxFrontSteer, Math.abs(ws.wheelQuatY[0]));
    maxRearSteer = Math.max(maxRearSteer, Math.abs(ws.wheelQuatY[2]));
  }
  await b.keyboard.up("d");
  await b.keyboard.up("w");
  await sleep(400);

  check(
    "tavoli elso kerekek kormanyoznak",
    maxFrontSteer > 0.05,
    `elso kerek legnagyobb quat.y = ${maxFrontSteer.toFixed(4)}`,
  );
  check(
    "tavoli hatso kerekek NEM kormanyoznak",
    maxRearSteer < 0.001,
    `hatso kerek legnagyobb quat.y = ${maxRearSteer.toFixed(4)}`,
  );

  // A rugoknal NEM azt merjuk, hogy valtozik-e (sik talajon alig), hanem
  // hogy amit A rajzol, az EGYEZIK-e B valos rugohosszaival.
  //
  // ALLO helyzetben merunk, ugyanazert, amiert a gordulesnel is: menet
  // kozben a megjelenites szandekosan le van maradva a valos allapottol
  // (interpolacios puffer), ezert a ket oldal mas-mas pillanatot irna
  // le, es a teszt a sajat idozitesi csuszasat merne.
  await waitForStopped(b);
  await waitForRemoteStable(a);

  // A KONFIGBOL vesszuk, nem beegetve: korabban itt egy masolt 0.25
  // allt, es amikor a nyugalmi hossz 0.30-ra valtozott, a teszt
  // pontosan 0.05 m-es "hibat" jelzett minden keréknel -- a termekben
  // viszont semmi baj nem volt.
  const REST = WHEEL.suspensionRestLength;

  // Megvarjuk, amig a rugo-ertekek TENYLEG beernek. A test poziciója
  // mar megnyugodhat akkor is, amikor az utolso rugo-frissites meg uton
  // van -- kesleltetes es jitter mellett ez kulon idot vesz igenybe.
  let suspErrors: number[] = [];
  for (let i = 0; i < 15; i++) {
    const bSusp: number[] = await b.evaluate(() =>
      (window as any).__spike.backend
        .getWheels()
        .map((w: any) => w.suspensionLength as number),
    );
    const wsNow = await wheelState(a);
    suspErrors =
      wsNow?.wheelY.map((y: number, j: number) => {
        const expected = wsNow.restY[j] - (bSusp[j] - REST);
        return Math.abs(y - expected);
      }) ?? [];
    if (suspErrors.length === 4 && suspErrors.every((e) => e < 0.03)) break;
    await sleep(200);
  }
  check(
    "tavoli rugohosszak egyeznek B valos ertekeivel",
    suspErrors.length === 4 && suspErrors.every((e: number) => e < 0.03),
    `elteresek: ${suspErrors.map((e: number) => e.toFixed(4)).join(", ")} m`,
  );

  // 3c. Kerek-serules szinkronja: ha B kereke serul, azt A-nak is
  //     latnia kell (kisebb, sotetebb kerek).
  //
  //     A serulest RAKETAVAL valtjuk ki, nem debug-gombbal: a kerek-
  //     serules a szerveré (terv 4.6), a helyi gombok csatlakozva
  //     szandekosan nem hatnak. Korabban a "2" gombot nyomtuk meg, es
  //     a teszt pontosan attol bukott el, hogy a szabaly atkerult a
  //     szerverre -- a termek helyes volt, a teszt merte rosszul.
  const beforeDamage = await wheelState(a);
  await b.evaluate(() => (window as any).__spike.backend.reset({ x: 0, y: 1.0, z: 0 }));
  await a.evaluate(() => (window as any).__spike.backend.reset({ x: 0, y: 1.0, z: 25 }));
  await sleep(2500);
  for (let shot = 0; shot < 2; shot++) {
    await a.evaluate(() => (window as any).__spike.net.fire([0, 1, -30]));
    await sleep(1800);
  }
  const afterDamage = await wheelState(a);

  check(
    "a serult kerek kisebb lesz A oldalan is",
    !!beforeDamage &&
      !!afterDamage &&
      // A rakéta HATULROL erkezik (mindketto -Z fele nez), tehat a
      // hatso kerekek (RL, RR) serulnek jobban.
      afterDamage.wheelScaleY[2] < beforeDamage.wheelScaleY[2] * 0.98,
    beforeDamage && afterDamage
      ? `RL meret ${beforeDamage.wheelScaleY[2].toFixed(2)} -> ${afterDamage.wheelScaleY[2].toFixed(2)}`
      : "nincs adat",
  );
  check(
    "a serult kerek szine atvalt A oldalan is",
    !!afterDamage &&
      (afterDamage.wheelColor[2] === "6b4a1f" || afterDamage.wheelColor[2] === "8b2f2a"),
    afterDamage ? `RL szin = #${afterDamage.wheelColor[2]}` : "nincs adat",
  );
  // A robbanas KEREKENKENTI tavolsaggal sebez: a tavolabbi kerekeknek
  // kevesbe kell serulniuk. Ha mind a negy egyformán valtozna, az azt
  // jelentene, hogy a szerver a kozeppontbol szamol.
  check(
    "a tavolabbi kerekek kevesbe serultek",
    !!afterDamage &&
      afterDamage.wheelScaleY[0] > afterDamage.wheelScaleY[2] + 0.005,
    afterDamage
      ? `elso ${afterDamage.wheelScaleY[0].toFixed(3)} vs hatso ${afterDamage.wheelScaleY[2].toFixed(3)}`
      : "nincs adat",
  );

  // 4. B lecsatlakozik -- az autojanak el kell tunnie A-nal
  await clientB.browser.close();
  await sleep(1200);
  const afterLeave = await remoteCars(a);
  check("B autoja eltunt A-nal", afterLeave.count === 0, `${afterLeave.count} tavoli auto`);

  await a.screenshot({ path: "out/multiplayer.png" });
  await clientA.browser.close();

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("A teszt osszeomlott:", err);
  process.exit(1);
});
