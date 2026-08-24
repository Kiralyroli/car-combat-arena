/**
 * Ujraszuletes vegponttol vegpontig: elonezet, pajzs, uj hely.
 *
 * A szerver-oldali szabalyokat a check:spawn es a check:spawn-protection
 * meri, determinisztikusan. EZ azt ellenorzi, ami csak egyben derul ki:
 * hogy a jatekos tenylegesen LATJA a leendo helyet a halal alatt, es
 * hogy az ujraszuletett auto korul megjelenik a pajzs -- a masik
 * kliensen is.
 *
 * A kiloves gepfegyverrel tortenik, nem kosolassal: az utkozes-sebzest
 * az utkozes-hutes visszafogja, es merve 30 nekifutasbol sem fogyott el
 * a celpont elete -- a teszt igy a sajat turelmetlenseget merte volna.
 *
 * Futtatas: npm run check:respawn
 */
import { chromium, type Browser, type Page } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openClient(
  name: string,
  hash: string,
): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  [oldal-hiba: ${name}] ${e.message}`));
  await page.goto(`${CLIENT_URL}?name=${name}&weapon=machinegun${hash}`);
  await page.waitForFunction(() => !!(window as any).__spike?.net?.playerId, null, {
    timeout: 20000,
  });
  return { browser, page };
}

const hpOf = (page: Page) => page.evaluate("window.__spike.net.hp") as Promise<number>;
const heatOf = (page: Page) =>
  page.evaluate("window.__spike.net.heat") as Promise<number>;

async function placeAt(page: Page, x: number, z: number): Promise<void> {
  await page.evaluate(
    ([px, pz]) => {
      (window as any).__spike.backend.reset({ x: px, y: 1.2, z: pz });
    },
    [x, z],
  );
}

/** Ahol a LOVO latja az ellenfelet (interpolalt, kesleltetett kep). */
async function seenPosition(page: Page): Promise<[number, number, number] | null> {
  return (await page.evaluate(() => {
    const spike = (window as any).__spike;
    const ids = spike.net.remotes.ids();
    if (ids.length === 0) return null;
    const transform = spike.view.remoteCarTransform(ids[0]);
    return transform ? transform.position : null;
  })) as [number, number, number] | null;
}

async function aimAt(page: Page, target: [number, number, number]): Promise<void> {
  const screen = (await page.evaluate((t: number[]) => {
    const camera = (window as any).__spike.view.camera;
    const point = camera.position.clone();
    point.set(t[0], t[1], t[2]);
    point.project(camera);
    return [
      (point.x * 0.5 + 0.5) * window.innerWidth,
      (-point.y * 0.5 + 0.5) * window.innerHeight,
    ];
  }, target)) as [number, number];
  await page.mouse.move(screen[0], screen[1]);
}

/** A kamera vilagbeli helye -- ebbol latszik, hova nez a jatekos. */
async function cameraAt(page: Page): Promise<[number, number, number]> {
  return (await page.evaluate(() => {
    const c = (window as any).__spike.view.camera;
    return [c.position.x, c.position.y, c.position.z];
  })) as [number, number, number];
}

async function main(): Promise<void> {
  console.log("=== Ujraszuletes (vegponttol vegpontig) ===\n");

  const A = await openClient("Loves", "");
  const room = A.page.url().substring(A.page.url().indexOf("#") + 1);
  const B = await openClient("Aldozat", `#${room}`);

  // --- A meccs indulasa vedelmet ad, es ez LATSZIK is ---
  //
  // A vedelem csak 2 masodperc, ezert AZONNAL elkapjuk, nem egy
  // onkenyesen valasztott pillanatban mintavetelezunk. (Eloszor ugy
  // irtam: a meccs indulasara vartam, majd aludtam egy kicsit -- es a
  // teszt attol ingadozott, hogy a vedelem kozben lejart.)
  //
  // A pajzsra is varunk, nem csak a jelzobitre: a kirajzolashoz kell
  // egy kepkocka, ami headless lapon akar 200 ms is lehet.
  const protectedSeen = await A.page
    .waitForFunction(
      () => {
        const spike = (window as any).__spike;
        return spike?.net?.ownProtected === true && spike?.view?.shieldsActive > 0;
      },
      null,
      { timeout: 25000 },
    )
    .then(() => true)
    .catch(() => false);

  check(
    "a meccs indulasakor pajzs vedi a jatekost",
    protectedSeen,
    protectedSeen ? "vedelem + lathato pajzs" : "nem jelent meg 25 mp alatt",
  );

  // A vedelem 5 masodperc (SPAWN_PROTECTION_MS) -- ennyit kell varni.
  await sleep(5300);
  check(
    "a vedelem magatol lejar",
    (await A.page.evaluate("window.__spike.net.ownProtected")) === false,
    "ownProtected = false",
  );

  // --- Felallas: szabad sav, egymas elott ---
  await placeAt(A.page, 25, 20);
  await placeAt(B.page, 25, 8);

  // Megvarjuk, amig a SZERVER mindket autot a helyen tudja: a teleportot
  // a plauzibilitas-ellenorzes eloszor elutasitja, es amig ez tart, a
  // lovo mashonnan lone, mint ahonnan celoz.
  let seen: [number, number, number] | null = null;
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    seen = await seenPosition(A.page);
    const mirror = await seenPosition(B.page);
    const bOk = seen !== null && Math.hypot(seen[0] - 25, seen[2] - 8) < 1.2;
    const aOk = mirror !== null && Math.hypot(mirror[0] - 25, mirror[2] - 20) < 1.2;
    if (bOk && aOk) break;
  }
  check(
    "a szerver mindket autot a helyen tudja",
    seen !== null && Math.hypot(seen[0] - 25, seen[2] - 8) < 1.2,
    seen ? `az ellenfel: (${seen[0].toFixed(1)}, ${seen[2].toFixed(1)})` : "nem lat autot",
  );

  // --- Kiloves gepfegyverrel ---
  //
  // A LOVO hoszintjet is olvassuk kozben, nem csak a celpont eletet.
  // Ket okbol: (1) a headless lap lelassul, ha nem nyulunk hozza, es
  // akkor a "tuzelek" allapot alig jut ki a szerverhez -- merve igy
  // maradt a celpont serulten 100 HP-n; (2) bukasnal a hoszintbol
  // azonnal latszik, hogy a fegyver egyaltalan elsult-e, vagy csak a
  // celzas ment melle.
  let peakHeat = 0;
  if (seen) {
    await aimAt(A.page, seen);
    await sleep(500);
    await A.page.mouse.down();
    for (let i = 0; i < 40 && (await hpOf(B.page)) > 0; i++) {
      // UJRACELZAS minden korben. A celkereszt KEPERNYO-pozicio, a
      // vilagbeli celpont pedig abbol all elo -- ha a kamera kozben meg
      // mozog (a teleport utan lassan all be), a celzas elcsuszik
      // alola. Merve: egy teli sorozatbol igy jutott el egyetlen
      // talalat a celig, holott a fegyver vegig tuzelt.
      const at = await seenPosition(A.page);
      if (at) await aimAt(A.page, at);
      await sleep(150);
      peakHeat = Math.max(peakHeat, await heatOf(A.page));
    }
    await A.page.mouse.up();
  }

  const victimHp = await hpOf(B.page);
  check(
    "a celpont megsemmisul",
    victimHp <= 0,
    `B HP: ${victimHp} (a lovo csucs-hoszintje: ${peakHeat.toFixed(0)})`,
  );

  if (victimHp <= 0) {
    // A HALAL ABLAKA OT MASODPERC, es ebbe kell beleferni mindennek:
    // a terv megerkezesenek, a valasztasnak es az ellenorzeseknek. Ezert
    // eloszor a KATTINTAST merjuk (az a szoros), es csak utana a kamerat
    // (az kesobb is ervenyes marad).
    await sleep(600);

    // --- A halal alatt latja, HOVA fog szuletni ---
    let plan = (await B.page.evaluate("window.__spike.net.pendingSpawn")) as
      | [number, number, number]
      | null;
    check(
      "a jatekos megkapja a leendo helyet",
      plan !== null,
      plan ? `(${plan[0]}, ${plan[2]})` : "nincs terv",
    );

    // --- A valaszthato helyek latszanak, a sajatunk kiemelve ---
    const choices = (await B.page.evaluate(
      "window.__spike.view.spawnChoiceCount",
    )) as number;
    const selected = (await B.page.evaluate(
      "window.__spike.view.selectedSpawnIndex",
    )) as number | null;
    const planIndex = (await B.page.evaluate(
      "window.__spike.net.pendingSpawnIndex",
    )) as number | null;
    check(
      "a valaszthato helyek megjelennek, a sajatunk kiemelve",
      choices > 1 && selected !== null && selected === planIndex,
      `${choices} jelolo, kiemelve: ${selected}`,
    );

    // --- KEZI valasztas: mas helyre kattintunk ---
    //
    // A kattintast a JATEK utjan adjuk le (celkereszt + eger), nem a
    // halozati hivas kozvetlen meghivasaval: igy a sugarkoveto talalat
    // es a "halal alatt a kattintas nem loves" szabaly is merve van.
    const other = (await B.page.evaluate(
      "window.__spike.net.spawnOptions.find((i) => i !== window.__spike.net.pendingSpawnIndex)",
    )) as number | undefined;

    let chosen: number | null = null;
    if (other !== undefined) {
      // Tobb probalkozas: a kamera meg befele tart a felulnezetbe, tehat
      // a jelolo kepernyo-helye ket kepkocka kozott is elmozdulhat.
      // Ugyanezt tenne egy jatekos is, ha elsore melle kattint.
      for (let attempt = 0; attempt < 5 && chosen !== other; attempt++) {
        const screen = (await B.page.evaluate((index: number) => {
          const spike = (window as any).__spike;
          const marker = spike.view.spawnChoicePosition(index);
          if (!marker) return null;
          const camera = spike.view.camera;
          const point = camera.position.clone();
          point.set(marker[0], marker[1], marker[2]);
          point.project(camera);
          return [
            (point.x * 0.5 + 0.5) * window.innerWidth,
            (-point.y * 0.5 + 0.5) * window.innerHeight,
          ];
        }, other)) as [number, number] | null;
        if (!screen) break;

        await B.page.mouse.move(screen[0], screen[1]);
        await B.page.mouse.down();
        await B.page.mouse.up();
        await sleep(220);
        chosen = (await B.page.evaluate(
          "window.__spike.net.pendingSpawnIndex",
        )) as number | null;
      }
    }

    check(
      "a palyara kattintva atvalaszthato a hely",
      other !== undefined && chosen === other,
      `kert: ${other}, terv: ${chosen}`,
    );
    plan = (await B.page.evaluate("window.__spike.net.pendingSpawn")) as
      | [number, number, number]
      | null;

    // --- A kamera az EGESZ palyat mutatja ---
    //
    // Enelkul a jatekos csak a sajat kornyeket latna, es nem tudna
    // eldonteni, melyik szabad hely van tavol az ellenfeltol.
    const camera = await cameraAt(B.page);
    const fromCentre = Math.hypot(camera[0], camera[2]);
    check(
      "a kamera az egesz palyat mutatja",
      camera[1] > 55 && fromCentre < 70,
      `${camera[1].toFixed(0)} m magasan, ${fromCentre.toFixed(0)} m-re a kozepponttol`,
    );

    // --- Ujraszuletes: a VALASZTOTT helyre, pajzzsal ---
    await B.page.waitForFunction(() => (window as any).__spike.net.hp > 0, null, {
      timeout: 15000,
    });
    await sleep(400);

    const born = (await B.page.evaluate(
      () => (window as any).__spike.backend.getChassis().position,
    )) as [number, number, number];
    check(
      "a valasztott helyre szuletik ujja",
      plan !== null && Math.hypot(born[0] - plan[0], born[2] - plan[2]) < 3,
      `terv: (${plan?.[0]}, ${plan?.[2]}) -- valos: (${born[0].toFixed(1)}, ${born[2].toFixed(1)})`,
    );

    check(
      "az ujraszuletett jatekost pajzs vedi",
      (await B.page.evaluate("window.__spike.net.ownProtected")) === true,
      "ownProtected = true",
    );

    // A MASIK kliensen is latszania kell, kulonben a tamado nem erti,
    // miert nem fognak a talalatai.
    const seenByAttacker = (await A.page.evaluate(
      "window.__spike.view.shieldsActive",
    )) as number;
    check(
      "a pajzs a MASIK kliensen is megjelenik",
      seenByAttacker > 0,
      `${seenByAttacker} pajzs latszik a tamadonal`,
    );

    // A jelolok eltunnek, amint elunk -- kulonben ott maradnanak a
    // palyan, es osszekevernenek a jatek kozbeni latvannyal.
    check(
      "ujraszuletes utan a jelolok eltunnek",
      (await B.page.evaluate("window.__spike.view.spawnChoiceCount")) === 0,
      "nincs tobb jelolo",
    );
  }

  await A.browser.close();
  await B.browser.close();

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
