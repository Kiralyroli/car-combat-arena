/**
 * Dev-modu hitbox-megjelenites.
 *
 * MIERT ER TESZTET: ez maga egy MERESI ESZKOZ. Ha csendben elromlik --
 * nem minden dobozt rajzol ki, vagy az autoe nem koveti a jarmuvet --,
 * akkor rosszabb, mint ha nem lenne: a "rendben van" latszatat kelti
 * pont ott, ahol a lathatatlan falakat keressuk.
 *
 * A masik tet: a hitboxok a JATEKOSNAL sose maradjanak bekapcsolva.
 *
 * Futtatas: npm run check:hitbox
 */
import { chromium } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  console.log("=== Hitbox-megjelenites ===\n");

  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  [oldal-hiba] ${e.message}`));
  // Diszites nelkul: a hitboxokhoz nem kell a modell-keszlet, betoltes
  // nelkul viszont sokkal gyorsabb es stabilabb a lap.
  await page.goto(`${CLIENT_URL}?dev=1&dekor=0&name=Hitbox`);
  await page.waitForFunction(() => !!(window as any).__spike?.net?.playerId, null, {
    timeout: 20000,
  });
  await sleep(600);

  // --- Alapallapot: KIKAPCSOLVA ---
  //
  // A dobozok mindent eltakarnanak (szandekosan depthTest nelkul
  // rajzoljuk oket), tehat bekapcsolva indulni jatekthetetlen lenne.
  {
    const be = await page.evaluate(() => (window as any).__spike.view.hitboxesVisible);
    check("indulaskor a hitboxok nem latszanak", be === false, `hitboxesVisible = ${be}`);
  }

  // --- Bekapcsolva: MINDEN utkozo doboz megjelenik ---
  //
  // Nem "sok doboz", hanem PONTOSAN annyi, ahany utkozes van (a talaj
  // kivetelevel). Ha kevesebb, akkor eppen a keresett lathatatlan fal
  // maradna ki a kepbol.
  {
    const eredmeny = (await page.evaluate(() => {
      const s = (window as any).__spike;
      s.view.setHitboxesVisible(true);
      const csoport = s.view.hitboxGroup;
      const dobozok = s.ARENA.filter((b: any) => b.name !== "ground");
      // Minden ARENA-doboz kozeppontjahoz tartozik-e dratvaz?
      const hianyzo: string[] = [];
      for (const b of dobozok) {
        let megvan = false;
        for (const gy of csoport.children) {
          if (
            Math.abs(gy.position.x - b.position.x) < 1e-6 &&
            Math.abs(gy.position.y - b.position.y) < 1e-6 &&
            Math.abs(gy.position.z - b.position.z) < 1e-6
          ) {
            megvan = true;
            break;
          }
        }
        if (!megvan) hianyzo.push(b.name);
      }
      return {
        latszik: s.view.hitboxesVisible,
        gyerekek: csoport.children.length,
        utkozesek: dobozok.length,
        hianyzo,
      };
    })) as {
      latszik: boolean;
      gyerekek: number;
      utkozesek: number;
      hianyzo: string[];
    };

    check("bekapcsolva latszanak", eredmeny.latszik === true, "hitboxesVisible = true");
    check(
      "minden utkozo doboz kap dratvazat",
      eredmeny.hianyzo.length === 0,
      eredmeny.hianyzo.length === 0
        ? `${eredmeny.utkozesek} doboz, mind kirajzolva`
        : `KIMARADT: ${eredmeny.hianyzo.slice(0, 5).join(", ")}`,
    );
    // A talaj NEM kap dobozt: az egesz palyat lefedne, es semmit nem
    // mutatna meg.
    check(
      "a talaj nincs kozottuk",
      eredmeny.gyerekek >= eredmeny.utkozesek &&
        eredmeny.gyerekek <= eredmeny.utkozesek + 8,
      `${eredmeny.gyerekek} dratvaz ${eredmeny.utkozesek} utkozeshez (+ az autoke)`,
    );
  }

  // --- A SAJAT auto hitboxa KOVETI az autot ---
  //
  // Ez a lenyeg: egy allo dobozbol nem derulne ki semmi. Elhajtunk,
  // MEGALLUNK, es csak akkor merunk: menet kozben a rajzolt auto
  // interpolalt helyen all, a fizikae egy lepessel elorebb -- a ketto
  // kozotti tized meteres elteres nem hiba, csak zaj a meresben.
  await page.keyboard.down("w");
  await sleep(1200);
  await page.keyboard.up("w");
  await page.keyboard.down("s");
  await sleep(1200);
  await page.keyboard.up("s");
  await sleep(1000);
  {
    const eredmeny = (await page.evaluate(() => {
      const s = (window as any).__spike;
      const hb = s.view.carHitboxes.get("sajat");
      const auto = s.backend.getChassis();
      return {
        van: !!hb,
        tav: hb
          ? Math.hypot(
              hb.position.x - auto.position[0],
              hb.position.y - auto.position[1],
              hb.position.z - auto.position[2],
            )
          : -1,
        elmozdult: hb ? Math.hypot(hb.position.x, hb.position.z) : 0,
      };
    })) as { van: boolean; tav: number; elmozdult: number };

    check("a sajat autonak is van hitboxa", eredmeny.van, "megvan");
    // Az ELMOZDULAS a meres ervenyessege: ha az auto helyben maradt, egy
    // beragadt doboz is atmenne a teszten.
    check(
      "a hitbox elhagyta a kiindulo helyet",
      eredmeny.elmozdult > 5,
      `${eredmeny.elmozdult.toFixed(1)} m-re a palya kozepetol`,
    );
    check(
      "a sajat hitbox az auton all",
      eredmeny.tav >= 0 && eredmeny.tav < 0.1,
      `${eredmeny.tav.toFixed(3)} m elteres a fizikai helytol`,
    );
  }

  // --- Kikapcsolas ---
  {
    const be = await page.evaluate(() => {
      const v = (window as any).__spike.view;
      v.setHitboxesVisible(false);
      return v.hitboxesVisible;
    });
    check("kikapcsolhato", be === false, `hitboxesVisible = ${be}`);
  }

  // --- DEV MODBOL kilepve kenyszeritve eltunik ---
  //
  // Ez a jatekost vedi: a bekapcsolva hagyott dobozok atlatszo falakkent
  // takarnak el mindent, es elonyt is adnanak (latszik a fedezek mogotti
  // ellenfel dobozanak helye).
  {
    await page.evaluate(() => (window as any).__spike.view.setHitboxesVisible(true));
    await page.keyboard.press("Control+Shift+D");
    await sleep(300);
    const allapot = (await page.evaluate(() => ({
      hitbox: (window as any).__spike.view.hitboxesVisible,
      panel: !!document.getElementById("debug-panel")?.hidden,
    }))) as { hitbox: boolean; panel: boolean };
    check(
      "dev modbol kilepve a hitboxok eltunnek",
      allapot.hitbox === false && allapot.panel === true,
      `hitbox = ${allapot.hitbox}, panel rejtve = ${allapot.panel}`,
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
