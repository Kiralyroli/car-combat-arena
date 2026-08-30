/**
 * GYOGYULAS es SEBZES-VISSZAJELZES vegponttol vegpontig: a felvett
 * elet fokozatosan hat, es LATSZIK is -- a masik kliensen is.
 *
 * Ket dolgot mer, amit kulon-kulon egyik oldal sem tud:
 *
 *  - a palyan felvett elet NEM azonnal gyogyit, hanem az ido alatt
 *    (a szabalyt a check:pickup-effects meri, itt az UTJA a lenyeg:
 *    eljut-e a "gyogyulok" jelzes a szervertol a masik kepernyore),
 *  - a gyogyulo autot a TOBBI jatekos is felismeri: a karosszeriaja
 *    zoldbe huz, es zold kereszt jelenik meg folotte,
 *  - a sebzes-szam ("-12") mindket kepernyore kijut: a lovo a celpont
 *    folott latja, a celpont a sajat HP-savja folott.
 *
 * A jelzes SAJAT mezo a snapshotban (PlayerSnapshot.healing), nem a
 * kepesseg allapotabol kikovetkeztetve -- eppen azert, mert a pickup
 * olyan jatekosnal is gyogyit, aki pajzsot valasztott. A teszt ezert
 * SZANDEKOSAN a pickup utjat jarja vegig, nem a Q-t nyomja meg.
 *
 * Futtatas: npm run check:heal
 */
import { chromium, type Browser, type Page } from "playwright";
import {
  HEALTH_RESTORE,
  MAX_HP,
  PICKUP_POINTS,
  pickupIndicesOf,
} from "@cca/shared";
import {
  SHOOT_FAR_Z,
  SHOOT_NEAR_Z,
  SHOOT_X,
  shootLabel,
  shootLineIsClear,
} from "./arenaLane";

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
  await page.goto(`${CLIENT_URL}?name=${name}&weapon=machinegun&dekor=0${hash}`);
  await page.waitForFunction(() => !!(window as any).__spike?.net?.playerId, null, {
    timeout: 20000,
  });
  return { browser, page };
}

const hpOf = (page: Page) => page.evaluate("window.__spike.net.hp") as Promise<number>;

async function placeAt(page: Page, x: number, z: number): Promise<void> {
  await page.evaluate(
    ([px, pz]) => {
      (window as any).__spike.backend.reset({ x: px, y: 1.2, z: pz });
    },
    [x, z],
  );
}

/** Ahol a NEZO latja az ellenfelet (interpolalt kep). */
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

/** Amit a NEZO lat a gyogyulo autobol: kereszt + a karosszeria zoldje. */
async function healVisuals(
  page: Page,
): Promise<{ tags: number; green: number; flag: boolean | null; ids: number }> {
  return (await page.evaluate(() => {
    const spike = (window as any).__spike;
    const ids = spike.net.remotes.ids();
    return {
      tags: spike.view.healTagsVisible as number,
      flag: ids.length > 0 ? spike.net.remotes.isHealing(ids[0]) : null,
      ids: ids.length,
      green: ids.length > 0 ? (spike.view.remoteBodyGreenBias(ids[0]) ?? 0) : 0,
    };
  })) as { tags: number; green: number; flag: boolean | null; ids: number };
}

async function main(): Promise<void> {
  console.log("=== Gyogyulas es sebzes-visszajelzes ===\n");

  const A = await openClient("Nezo", "");
  const room = A.page.url().substring(A.page.url().indexOf("#") + 1);
  const B = await openClient("Gyogyul", `#${room}`);

  // A spawn-vedelem alatt a sebzes nem fogna -- kivarjuk.
  await sleep(5300);

  check(
    "a teszt lo-vonala szabad az arenaban",
    shootLineIsClear(),
    `${shootLabel()} -- e nelkul nem a sebzest mernenk`,
  );

  // --- SEBZES: gyogyulni csak sebzetten lehet ---
  //
  // Teli elettel a pickupot fel sem lehet venni, tehat sebzes nelkul a
  // teszt semmit nem merne. Gepfegyverrel lovunk (nem rammelunk): az
  // utkozes-sebzest a hutes visszafogja.
  //
  // TOBB NEKIFUTAS: a celzas a teleport utan lassan all be (a kamera
  // meg mozog, a szerver eloszor elutasitja a helyet), es egy-egy
  // sorozat igy siman melle mehet. A meres targya nem a lovesunk
  // pontossaga -- ha nem sikerult, ujra allunk fel es ujra probaljuk.
  // Ennyire kell levinni: maradjon hely a teljes +40-nek, es a
  // celpont ELJEN -- egy halott jatekos teli elettel szuletik ujra.
  const KELL_HP = MAX_HP - HEALTH_RESTORE;
  let sebzettHp = MAX_HP;
  // A SEBZES-SZAMOK legutobb latott alakja a ket kepernyon (ures = sosem).
  let lattSzam = "";
  let lattSajat = "";
  let seen: [number, number, number] | null = null;
  for (let kor = 0; kor < 3 && sebzettHp > KELL_HP; kor++) {
    await placeAt(A.page, SHOOT_X, SHOOT_FAR_Z);
    await placeAt(B.page, SHOOT_X, SHOOT_NEAR_Z);

    // A teleportot a plauzibilitas-ellenorzes eloszor elutasitja; amig
    // ez tart, a lovo mashonnan lone, mint ahonnan celoz.
    seen = null;
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      seen = await seenPosition(A.page);
      if (seen && Math.hypot(seen[0] - SHOOT_X, seen[2] - SHOOT_NEAR_Z) < 1.2) break;
    }
    if (!seen) continue;

    await aimAt(A.page, seen);
    await sleep(500);

    // ROVID SOROZATOK, nem egy hosszu: a gepfegyver egy masodperc alatt
    // is kiuti a celpontot, es egy HALOTT jatekos ujraszuletve TELI
    // elettel all fel -- vagyis a tulzasba vitt sebzes pont a merest
    // teszi lehetetlenne. Ket sorozat kozott megnezzuk a HP-t.
    for (let i = 0; i < 60 && sebzettHp > KELL_HP; i++) {
      // UJRACELZAS minden korben: a celkereszt KEPERNYO-pozicio, es ha
      // a kamera kozben meg mozog, a celzas elcsuszik alola.
      const at = await seenPosition(A.page);
      if (at) await aimAt(A.page, at);
      await A.page.mouse.down();
      await sleep(100);
      await A.page.mouse.up();
      sebzettHp = await hpOf(B.page);

      // --- SEBZES-SZAMOK: ugyanaz az esemeny ket kepernyon ---
      //
      // A sebzes-fazis itt amugy is lefut, ezert itt merjuk: a lovo a
      // celpont folott latja a szamot, a celpont pedig a sajat HUD-jan.
      // (A szabalyt kulon a check:damage-numbers meri, Node alatt.)
      const szamok = (await A.page.evaluate(
        "window.__spike.view.damageNumbers",
      )) as string[];
      if (szamok.length > 0) lattSzam = szamok[0];
      const sajat = (await B.page.evaluate(() => {
        const el = document.getElementById("hp-damage");
        return {
          szoveg: el?.textContent ?? "",
          fut: !!el?.classList.contains("uj"),
        };
      })) as { szoveg: string; fut: boolean };
      if (sajat.szoveg && sajat.fut) lattSajat = sajat.szoveg;

      // Ha kozben meghalt, ennek a kornek vege: a kovetkezo nekifutas
      // ujra felallitja mindkettot.
      if (sebzettHp <= 0) break;
    }

    // TULLOTTUNK: a celpont megsemmisult. Megvarjuk, amig ujraszuletik
    // (teli elettel es rovid vedelemmel), es ujra nekifutunk -- a
    // kovetkezo kor feltetele igy ujra igaz lesz.
    if (sebzettHp <= 0) {
      await B.page
        .waitForFunction(() => ((window as any).__spike.net.hp as number) > 0, null, {
          timeout: 20000,
        })
        .catch(() => {});
      await sleep(5500);
      sebzettHp = await hpOf(B.page);
    }
  }

  check(
    "a szerver a helyen tudja a celpontot",
    seen !== null && Math.hypot(seen[0] - SHOOT_X, seen[2] - SHOOT_NEAR_Z) < 1.2,
    seen ? `(${seen[0].toFixed(1)}, ${seen[2].toFixed(1)})` : "nem lat autot",
  );
  check(
    "a lovo latja a sebzes szamat a celpont folott",
    /^-\d+$/.test(lattSzam),
    lattSzam ? `"${lattSzam}"` : "egyetlen szam sem jelent meg",
  );
  check(
    "a celpont a sajat HUD-jan is latja",
    /^-\d+$/.test(lattSajat),
    lattSajat ? `"${lattSajat}" a HP-sav folott` : "a #hp-damage ures maradt",
  );
  check(
    "a celpont megserult, de el",
    sebzettHp > 0 && sebzettHp <= KELL_HP,
    `${sebzettHp} HP (kellett: legfeljebb ${KELL_HP})`,
  );

  // --- ELET FELVETELE: a celpontot az elet-pickup tetejere tesszuk ---
  const healthIndex = pickupIndicesOf("health")[0];
  const point = PICKUP_POINTS[healthIndex];
  await placeAt(B.page, point.x, point.z);

  const felvetelElott = await hpOf(B.page);

  // EGYETLEN figyelo hurok, ket kepernyore.
  //
  // A gyogyulas harom masodperc; ha eloszor megvarnank a vegét a
  // gyogyulon, es CSAK AZUTAN neznenk meg a masik kepernyot, a jelzes
  // mar rég lement volna rola. Ezert kepenkent egyszerre mintavetelezunk
  // -- es a MAXIMUMOT tartjuk meg: egy jel, ami barmikor lathato volt,
  // lathato volt.
  let indult = false;
  let veget = false;
  let kozben = felvetelElott;
  let maxTags = 0;
  let maxGreen = 0;
  let utolso = { tags: 0, green: 0, flag: null as boolean | null, ids: 0 };
  for (let i = 0; i < 150; i++) {
    const gyogyulE = (await B.page.evaluate(
      "window.__spike.net.ownHealing",
    )) as boolean;
    if (gyogyulE) {
      if (!indult) {
        indult = true;
        // Az ELSO pillanat HP-ja: ha a pickup egyben adna oda a 40
        // eletet, itt mar a vegleges ertek allna.
        kozben = await hpOf(B.page);
      }
      utolso = await healVisuals(A.page);
      maxTags = Math.max(maxTags, utolso.tags);
      maxGreen = Math.max(maxGreen, utolso.green);
    } else if (indult) {
      veget = true;
      break;
    }
    await sleep(100);
  }

  check(
    "a felvett elet gyogyulast indit",
    indult,
    indult ? "ownHealing = true" : "15 mp alatt nem indult el",
  );
  check(
    "a gyogyulas fokozatos, nem egy ugras",
    indult && kozben < felvetelElott + HEALTH_RESTORE,
    `${felvetelElott} -> ${kozben} HP (a teljes: +${HEALTH_RESTORE})`,
  );

  // --- A MASIK KLIENS latja, hogy a celpont gyogyul ---
  //
  // Ket kulon jel: a karosszeria zoldbe huz (kozelrol), es zold kereszt
  // all az auto folott (tavolrol is). Mindkettonek meg kell jelennie.
  check(
    "a masik kliens folott megjelenik a gyogyulas-jel",
    maxTags === 1,
    `${maxTags} jel (utolso halozati jelzes: ${utolso.flag}, autok: ${utolso.ids})`,
  );
  check(
    "es a karosszeriaja is zoldbe huz",
    maxGreen > 0.02,
    `zold tulsuly: ${maxGreen.toFixed(3)}`,
  );

  check(
    "a gyogyulas magatol veget er",
    veget,
    veget ? "ownHealing = false" : "15 mp utan is fut",
  );

  const vegHp = await hpOf(B.page);
  check(
    "a teljes eletet visszakapta",
    vegHp === Math.min(MAX_HP, felvetelElott + HEALTH_RESTORE),
    `${felvetelElott} -> ${vegHp} HP`,
  );

  // A jelzesnek EL is kell tunnie: egy bent ragadt jel tartosan hazudna
  // a tamadonak. A kepernyo egy kepkockaval kesobb koveti a halozatot.
  await sleep(400);
  const utana = await healVisuals(A.page);
  check(
    "a jel es a zold szinezes is eltunik",
    utana.tags === 0 && utana.green < 0.01,
    `${utana.tags} jel, zold tulsuly: ${utana.green.toFixed(3)}`,
  );

  await A.browser.close();
  await B.browser.close();

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
