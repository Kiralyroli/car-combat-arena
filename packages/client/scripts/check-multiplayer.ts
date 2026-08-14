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

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

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
 * Megvarja, amig a kocsi leert es megallapodott.
 *
 * A spawn 2.5 m magasrol ejti be az autot (CHASSIS.spawn), es a
 * szerverhez csatlakozaskor is odateleportalunk. Ha a teszt mar ez
 * alatt "vezetni" kezd, a kocsi valojaban ZUHAN es oldalra csuszik --
 * a gazadasnak alig van hatasa, es a kerekek helyesen NEM gordulnek
 * (csuszo kerek nem gordul). Ilyenkor a merés a fizikat hibaztatna a
 * sajat rossz idozitese helyett.
 */
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
  await page.goto(`${CLIENT_URL}${hash}`);
  // Meg kell varni a fizika + modell betoltest.
  await page.waitForFunction(() => !!(window as any).__spike, null, { timeout: 20000 });
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
  await sleep(600);

  const bTruth = await ownPos(b);
  const after = (await remoteCars(a)).positions[0] ?? [];
  const moved = Math.hypot(after[0] - before[0], after[2] - before[2]);

  check(
    "B tenylegesen elmozdult (input megerkezett)",
    moved > 0.5,
    `${moved.toFixed(2)} m elmozdulas A nezopontjabol`,
  );

  const trackErr = Math.hypot(
    after[0] - bTruth[0],
    after[1] - bTruth[1],
    after[2] - bTruth[2],
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
  await sleep(400);
  const wsBefore = await wheelState(a);
  const posBefore = await ownPos(b);

  await b.keyboard.down("w");
  await sleep(2000);
  await b.keyboard.up("w");
  await waitForStopped(b);
  await sleep(400);
  const wsDuring = await wheelState(a);
  const posDuring = await ownPos(b);

  const distance = Math.hypot(
    posDuring[0] - posBefore[0],
    posDuring[2] - posBefore[2],
  );
  const rollDelta = wsBefore && wsDuring ? Math.abs(wsDuring.roll - wsBefore.roll) : 0;
  const expectedRoll = distance / 0.35; // WHEEL.radius
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
  await sleep(600);

  const bSusp: number[] = await b.evaluate(() =>
    (window as any).__spike.backend
      .getWheels()
      .map((w: any) => w.suspensionLength as number),
  );
  const wsNow = await wheelState(a);
  const REST = 0.25; // WHEEL.suspensionRestLength
  const suspErrors: number[] =
    wsNow?.wheelY.map((y: number, i: number) => {
      const expected = wsNow.restY[i] - (bSusp[i] - REST);
      return Math.abs(y - expected);
    }) ?? [];
  check(
    "tavoli rugohosszak egyeznek B valos ertekeivel",
    suspErrors.length === 4 && suspErrors.every((e: number) => e < 0.03),
    `elteresek: ${suspErrors.map((e: number) => e.toFixed(4)).join(", ")} m`,
  );

  // 3c. Kerek-serules szinkronja: ha B-nek kilovik a kereket, azt A-nak
  //     is latnia kell (kisebb, sotetvoros kerek).
  const beforeDamage = await wheelState(a);
  // A "2" gomb toRi le az FR (jobb elso) kereket -- lasd main.ts.
  await b.keyboard.press("2");
  await sleep(900);
  const afterDamage = await wheelState(a);

  check(
    "tort kerek kisebb lesz A oldalan is",
    !!beforeDamage &&
      !!afterDamage &&
      afterDamage.wheelScaleY[1] < beforeDamage.wheelScaleY[1] * 0.8,
    beforeDamage && afterDamage
      ? `FR meret ${beforeDamage.wheelScaleY[1].toFixed(2)} -> ${afterDamage.wheelScaleY[1].toFixed(2)}`
      : "nincs adat",
  );
  check(
    "tort kerek szine atvalt A oldalan is",
    !!afterDamage && afterDamage.wheelColor[1] === "8b2f2a",
    afterDamage ? `FR szin = #${afterDamage.wheelColor[1]}` : "nincs adat",
  );
  check(
    "a tobbi kerek valtozatlan marad",
    !!afterDamage &&
      afterDamage.wheelColor[0] !== "8b2f2a" &&
      afterDamage.wheelColor[2] !== "8b2f2a" &&
      afterDamage.wheelColor[3] !== "8b2f2a",
    afterDamage ? `szinek: ${afterDamage.wheelColor.join(", ")}` : "nincs adat",
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
