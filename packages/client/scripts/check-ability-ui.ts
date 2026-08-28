/**
 * KEPESSEG a bongeszoben: valasztas, Q gomb, HUD.
 *
 * A szabalyokat a check:abilities es a check:ability meri (bongeszo
 * nelkul, pontosan). Itt az UT a merheto: eljut-e a Q a szerverig,
 * visszajon-e a snapshotban, es azt mutatja-e a HUD, ami szerint a
 * szerver dont.
 *
 * Ez a lanc tobb helyen tud csendben elszakadni -- egy elmaradt
 * esemenykezelo, egy at nem adott mezo --, es a jatek attol meg
 * hibatlanul fut, csak a Q nem csinal semmit.
 *
 * Futtatas: npm run check:ability-ui
 */
import { ABILITIES } from "@cca/shared";
import { chromium, type Page } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

/** A sajat kepesseg allapota a SZERVER szerint (a snapshotbol). */
async function allapot(page: Page): Promise<{
  ability: string;
  aktiv: boolean;
  cooldownMs: number;
  activeMs: number;
  hp: number;
}> {
  return (await page.evaluate(() => {
    const n = (window as any).__spike.net;
    return {
      ability: n.ownAbility,
      aktiv: n.ownAbilityActive,
      cooldownMs: n.ownAbilityCooldownMs,
      activeMs: n.ownAbilityActiveMs,
      hp: n.hp,
    };
  })) as {
    ability: string;
    aktiv: boolean;
    cooldownMs: number;
    activeMs: number;
    hp: number;
  };
}

/**
 * A SAJAT auto karosszeria-szine (hex).
 *
 * A gyogyulas ezt szinezi zold fele. Egy "zolden ragadt" auto csendes
 * hiba lenne: a jatek megy tovabb, csak a jatekos szine hazudik --
 * pedig az azonositasra kell a harcban.
 */
async function karosszeriaSzin(page: Page): Promise<number> {
  return (await page.evaluate(() => {
    const v = (window as any).__spike.view;
    let hex = -1;
    v.chassisMesh.traverse((o: any) => {
      if (hex >= 0 || !o.isMesh || Array.isArray(o.material)) return;
      if (!o.material?.name?.startsWith("Body")) return;
      hex = o.material.color.getHex();
    });
    return hex;
  })) as number;
}

/** Amit a HUD kiir. */
async function hud(page: Page): Promise<{ nev: string; allapot: string }> {
  return (await page.evaluate(() => ({
    nev: document.getElementById("ability-name")?.textContent ?? "",
    allapot: document.getElementById("ability-state")?.textContent ?? "",
  }))) as { nev: string; allapot: string };
}

async function main(): Promise<void> {
  console.log("=== Kepesseg a bongeszoben ===\n");

  // EGYETLEN kliens, SZANDEKOSAN.
  //
  // Ez a jatekos leggyakoribb helyzete: belep, es kiprobalja a gombot.
  // A kepesseg eloszor csak elindult meccsen mukodott, ket jatekos
  // nelkul viszont a meccs el sem indul -- a jatekos szamara a Q
  // egyszeruen "nem csinalt semmit", magyarazat nelkul. A teszt akkor
  // ket klienssel futott, es eppen ezt a helyzetet nem merte.
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => console.log(`  [oldal-hiba] ${e.message}`));
  await page.goto(`${CLIENT_URL}?dekor=0&name=Kepesseg`);
  await page.waitForFunction(() => !!(window as any).__spike?.net?.playerId, null, {
    timeout: 30000,
  });
  await sleep(2500);

  // --- A VALASZTOK ott vannak ---
  //
  // Ket helyen kell lennie: a lobbyban es a halal-kepernyon. Ha az
  // egyik hianyozna, a jatekos nem tudna valtani -- es ez ranezesre nem
  // hianyzik, mert a masik megvan.
  {
    const db = (await page.evaluate(() => ({
      lobby: document.querySelectorAll("#ability-pick button[data-ability]").length,
      halal: document.querySelectorAll(
        "#respawn-abilities button[data-ability]",
      ).length,
    }))) as { lobby: number; halal: number };
    check(
      "a kepessegvalaszto mindket helyen ott van",
      db.lobby >= 2 && db.halal >= 2,
      `lobby: ${db.lobby} gomb, halal-kepernyo: ${db.halal} gomb`,
    );
  }

  // --- Indulaskor KESZ ---
  {
    const a = await allapot(page);
    const h = await hud(page);
    check(
      "indulaskor a kepesseg kesz",
      !a.aktiv && a.cooldownMs === 0,
      `${a.ability}: aktiv ${a.aktiv}, visszatoltes ${a.cooldownMs} ms`,
    );
    check(
      "a HUD a kepesseg nevet mutatja",
      h.nev.length > 0 && h.allapot.toUpperCase().includes("KESZ"),
      `"${h.nev}" / "${h.allapot}"`,
    );
  }

  // --- A Q ELSUTI ---
  //
  // A visszajelzes a SZERVERTOL jon: ha a Q sehova nem jutna el, a
  // visszatoltes nullan maradna.
  {
    const elotte = await allapot(page);
    await page.keyboard.press("q");
    await sleep(700);
    const utana = await allapot(page);
    const def = ABILITIES[utana.ability as keyof typeof ABILITIES];

    check(
      "a Q elsuti a kepesseget",
      utana.cooldownMs > 0,
      `visszatoltes: ${elotte.cooldownMs} -> ${Math.round(utana.cooldownMs)} ms`,
    );
    check(
      "a visszatoltes a beallitott ideig tart",
      utana.cooldownMs <= def.cooldownMs &&
        utana.cooldownMs > def.cooldownMs - 3000,
      `${Math.round(utana.cooldownMs)} ms a beallitott ${def.cooldownMs} ms-bol`,
    );
    // A PAJZS aktiv is: ez a jatekos szamara a lenyeg.
    if (utana.ability === "shield") {
      check(
        "a pajzs aktiv lett",
        utana.aktiv,
        `abilityActive: ${utana.aktiv}`,
      );
    }

    // A HATRALEVO IDO is jon: enelkul a jatekos csak annyit tudna,
    // hogy "tortenik valami", azt nem, hogy meddig.
    const def2 = ABILITIES[utana.ability as keyof typeof ABILITIES];
    check(
      "a hatralevo hatas is atjon a szervertol",
      utana.activeMs > 0 && utana.activeMs <= def2.durationMs,
      `${Math.round(utana.activeMs)} ms a ${def2.durationMs} ms-bol`,
    );

    // ...es a HUD ezt mutatja, nem csak annyit, hogy "AKTIV".
    const hAktiv = await hud(page);
    check(
      "a HUD a hatralevo idot mutatja",
      /[0-9]/.test(hAktiv.allapot) && hAktiv.allapot.includes("s"),
      `"${hAktiv.allapot}"`,
    );
  }

  // --- A GYOGYULAS szinezi az autot, es utana visszaall ---
  //
  // Kulon kepesseggel, mert a pajzs mast csinal (burok). A szint a
  // MODELLBOL olvassuk, nem a kodbol: igy az is kiderul, ha a
  // szinezes eljut a jelenetig, de nem all vissza.
  {
    // Meg kell varni a pajzs visszatolteset, kulonben a valtas utan
    // sem sulne el semmi.
    await page.evaluate(() => (window as any).__spike.net.selectAbility("heal"));
    await sleep(500);
    const valtott = await allapot(page);
    if (valtott.ability !== "heal") {
      // ELVE nem lehet valtani -- ez a helyes viselkedes, tehat itt a
      // meres nem vegezheto el. Ne allitsunk semmit, de mondjuk ki.
      console.log(
        "  (a kepesseg elve nem valthato -- a szinezest a kovetkezo eletben lehet merni)",
      );
    } else {
      const alap = await karosszeriaSzin(page);
      await page.waitForFunction(
        () => (window as any).__spike.net.ownAbilityCooldownMs === 0,
        null,
        { timeout: 40000 },
      );
      await page.keyboard.press("q");
      await sleep(600);
      const kozben = await karosszeriaSzin(page);
      check(
        "gyogyulas kozben zold fele valt az auto szine",
        kozben !== alap,
        `alap: #${alap.toString(16)}, gyogyulas kozben: #${kozben.toString(16)}`,
      );

      await sleep(ABILITIES.heal.durationMs + 900);
      const utana = await karosszeriaSzin(page);
      check(
        "a gyogyulas vegen visszaall az eredeti szin",
        utana === alap,
        `#${utana.toString(16)} (az eredeti #${alap.toString(16)})`,
      );
    }
  }

  // --- A hatas LEJAR ---
  //
  // Enelkul a "hatralevo ido" allitas akkor is teljesulne, ha a
  // kepesseg orokke aktiv maradna.
  {
    await sleep(ABILITIES.shield.durationMs + 700);
    const a = await allapot(page);
    check(
      "a hatas lejar",
      !a.aktiv && a.activeMs === 0,
      `aktiv: ${a.aktiv}, hatralevo: ${Math.round(a.activeMs)} ms`,
    );
  }

  // --- A HUD a visszatoltest mutatja ---
  //
  // Enelkul a jatekos nem tudna, mikor hasznalhatja ujra: a gomb
  // egyszeruen "nem csinal semmit".
  {
    const h = await hud(page);
    check(
      "a HUD a visszatoltest mutatja",
      h.allapot.includes("s") || h.allapot.toUpperCase().includes("AKT"),
      `"${h.allapot}"`,
    );
  }

  // --- Visszatoltes alatt a masodik Q nem tesz semmit ---
  {
    const elotte = await allapot(page);
    await page.keyboard.press("q");
    await sleep(600);
    const utana = await allapot(page);
    // A visszatoltes CSOKKEN az ido mulasaval; ha a masodik keres
    // elsult volna, ujraindulna -- vagyis NONE.
    check(
      "visszatoltes alatt a Q nem inditja ujra",
      utana.cooldownMs < elotte.cooldownMs,
      `${Math.round(elotte.cooldownMs)} -> ${Math.round(utana.cooldownMs)} ms (csokken, tehat nem sult el ujra)`,
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
