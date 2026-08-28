/**
 * A RESET csak ot masodperces nyomva tartasra sul el.
 *
 * A JATEKOS PANASZA mogotti helyzet: a reset a helyere teszi az autot
 * es megjavitja a kerekeket -- vagyis egy elrontott helyzetbol azonnal
 * kihoz. Egy vegigfutó gombra ez VELETLENUL is elsult.
 *
 * Ket iranyba lehet elrontani, es mindketto csendes:
 *
 *  - ha a koccintas is elsuti, a valtozas ertelmet veszti,
 *  - ha a nyomva tartas SEM suti el, a beszorult jatekosnak nincs
 *    kiutja. Ez a rosszabbik: onnan csak kilepni lehet.
 *
 * Futtatas: npm run check:reset-hold
 */
import { CHASSIS, RECOVERY } from "@cca/shared";
import { chromium, type Page } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

/** Az auto helye -- a reset a spawn-pontra teszi vissza. */
async function hol(page: Page): Promise<[number, number, number]> {
  return (await page.evaluate(() => {
    const a = (window as any).__spike.backend.getChassis().position;
    return [a[0], a[1], a[2]];
  })) as [number, number, number];
}

async function tavolsag(page: Page, tol: number[]): Promise<number> {
  const a = await hol(page);
  return Math.hypot(a[0] - tol[0], a[2] - tol[2]);
}

/** A visszaszamlalas jelzoje: latszik-e, es hol tart. */
async function jelzo(page: Page): Promise<{ latszik: boolean; szazalek: number }> {
  return (await page.evaluate(() => {
    const el = document.getElementById("reset-hold");
    const sav = el?.querySelector("i") as HTMLElement | null;
    return {
      latszik: !!el && !el.hidden,
      szazalek: sav ? parseFloat(sav.style.width || "0") : 0,
    };
  })) as { latszik: boolean; szazalek: number };
}

async function main(): Promise<void> {
  console.log("=== Reset: nyomva tartas ===\n");
  console.log(`  (a beallitott ido: ${RECOVERY.holdMs} ms)\n`);

  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => console.log(`  [oldal-hiba] ${e.message}`));
  await page.goto(`${CLIENT_URL}?dekor=0&name=Reset`);
  await page.waitForFunction(() => !!(window as any).__spike?.net?.playerId, null, {
    timeout: 30000,
  });
  await sleep(2500);

  // ELHAJTUNK a spawn-pontrol, es MEGALLUNK.
  //
  // A megallas nem reszletkerdes: a reset a CHASSIS.spawn-ra teszi az
  // autot, es ha kozben gurulunk, az elmozdulas nem a resettol van. Az
  // elso valtozat igy merte, es a "koccintas nem inditja ujra" allitas
  // 22,7 m elmozdulast latott -- pusztan a kigurulasbol.
  await page.keyboard.down("w");
  await sleep(2000);
  await page.keyboard.up("w");
  await page.keyboard.down("s");
  await sleep(1500);
  await page.keyboard.up("s");
  let sebesseg = 99;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    sebesseg = (await page.evaluate(() => {
      const v = (window as any).__spike.backend.getVelocity();
      return Math.hypot(v[0], v[1], v[2]);
    })) as number;
    if (sebesseg < 0.05) break;
  }

  const all = await hol(page);
  const spawnTav = Math.hypot(all[0] - CHASSIS.spawn.x, all[2] - CHASSIS.spawn.z);
  check(
    "elhajtottunk a spawn-pontrol es megalltunk",
    spawnTav > 15 && sebesseg < 0.05,
    `${spawnTav.toFixed(1)} m-re a spawn-tol, ${sebesseg.toFixed(3)} m/s`,
  );

  // --- KOCCINTASRA nem tortenik semmi ---
  //
  // Ez a valtozas erteke. Regen egyetlen leutes visszatette az autot.
  {
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("r");
      await sleep(150);
    }
    await sleep(500);
    const t = await tavolsag(page, all);
    check(
      "negy koccintas nem inditja ujra az autot",
      t < 1,
      `az auto ${t.toFixed(2)} m-re van attol, ahol volt`,
    );
  }

  // --- FELUTON elengedve sem ---
  //
  // A visszaszamlalas ne "gyuljon ossze" tobb reszletbol: minden
  // lenyomas nullarol indul.
  {
    const fel = RECOVERY.holdMs / 2;
    for (let i = 0; i < 2; i++) {
      await page.keyboard.down("r");
      await sleep(fel);
      await page.keyboard.up("r");
      await sleep(300);
    }
    const t = await tavolsag(page, all);
    check(
      "ketszer feluton elengedve sem indul ujra",
      t < 1,
      `2 x ${(fel / 1000).toFixed(1)} mp nyomva tartas -> ${t.toFixed(2)} m elmozdulas`,
    );
  }

  // --- A VISSZASZAMLALAS latszik ---
  //
  // Ot masodpercig nyomni egy gombot visszajelzes nelkul torottnek
  // tunik: a jatekos elengedne.
  {
    await page.keyboard.down("r");
    await sleep(RECOVERY.holdMs * 0.4);
    const kozben = await jelzo(page);
    check(
      "nyomva tartas kozben latszik a visszaszamlalas",
      kozben.latszik && kozben.szazalek > 15 && kozben.szazalek < 85,
      `latszik: ${kozben.latszik}, a sav ${kozben.szazalek.toFixed(0)}%-on`,
    );

    // --- ...es a vegen TENYLEG ujraindul ---
    //
    // A reset a CHASSIS.spawn-ra tesz vissza -- ahhoz merunk, nem a
    // teszt kiindulo helyehez: a jatekost a szerver mashova is
    // szulethette.
    await sleep(RECOVERY.holdMs * 0.9);
    const most = await hol(page);
    const t = Math.hypot(
      most[0] - CHASSIS.spawn.x,
      most[2] - CHASSIS.spawn.z,
    );
    check(
      "a teljes ido letelte utan az auto a spawn-pontra kerul",
      t < 3,
      `${t.toFixed(2)} m-re a spawn-tol (elotte ${spawnTav.toFixed(1)} m-re volt)`,
    );
    await page.keyboard.up("r");
  }

  // --- Elengedve eltunik a jelzo ---
  {
    await sleep(400);
    const utana = await jelzo(page);
    check(
      "elengedve eltunik a visszaszamlalas",
      !utana.latszik,
      `latszik: ${utana.latszik}`,
    );
  }

  await browser.close();

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
