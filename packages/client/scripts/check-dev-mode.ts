/**
 * Fejlesztoi ("dev") mod lathatosaga.
 *
 * A jatekosnak CSAK a jatek-HUD-ot szabad latnia; a fizika-csuszkak es
 * a technikai panel dev modhoz kotott (lasd devMode.ts). A csuszkak
 * futasidoben allitjak a jarmu fizikajat -- ha alapertelmezetten
 * latszananak, barmelyik jatekos athangolhatna a sajat autojat.
 *
 * Negy dolgot merunk:
 *   1. alapertelmezetten (friss profil, sima URL) minden fejlesztoi
 *      elem rejtve van,
 *   2. a Ctrl+Shift+D bekapcsolja,
 *   3. a valasztas tulel egy ujratoltest,
 *   4. a `?dev=0` ERŐSEBB a tarolt valasztasnal -- igy egy megosztott
 *      link biztosan tiszta jatekos-nezetet ad.
 *
 * Futtatas: npm run check:dev
 */
import { chromium, type Page } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Visible {
  sliders: boolean;
  tech: boolean;
  help: boolean;
  player: boolean;
  /** Az fps/ping kijelzo -- ez dev modon KIVUL is kell, hogy latszodjon. */
  netstat: boolean;
  /** A JATEKOSNAK szolo vezerles-sugo (nem a fejlesztoi #help). */
  controls: boolean;
  /** A sugo-gomb: ez arulja el, hogy a sugo letezik. */
  helpButton: boolean;
}

const visible = (page: Page): Promise<Visible> =>
  page.evaluate(() => ({
    sliders: !(document.getElementById("debug-panel") as HTMLElement).hidden,
    tech: !(document.getElementById("hud") as HTMLElement).hidden,
    help: !(document.getElementById("help") as HTMLElement).hidden,
    player: !(document.getElementById("player-hud") as HTMLElement).hidden,
    // Nem eleg a "hidden" jelzot nezni: dev modban CSS rejti el
    // (body.dev #netstat), tehat a tenyleges megjelenest kell kerdezni.
    netstat:
      getComputedStyle(document.getElementById("netstat") as HTMLElement)
        .display !== "none",
    controls: !(document.getElementById("controls") as HTMLElement).hidden,
    // offsetParent: akkor null, ha barmelyik ose rejtve van -- a gomb a
    // #meta oszlopban ul, tehat a sajat "hidden" jelzoje nem eleg.
    helpButton:
      (document.getElementById("help-toggle") as HTMLElement).offsetParent !== null,
  }));

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => !!(window as any).__spike, null, { timeout: 20000 });
  await sleep(1200);
}

function devHidden(v: Visible): boolean {
  return !v.sliders && !v.tech && !v.help;
}

function devShown(v: Visible): boolean {
  return v.sliders && v.tech && v.help;
}

async function main(): Promise<void> {
  console.log("=== Fejlesztoi mod ===\n");

  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  // Friss profil: nincs korabbi valasztas a localStorage-ban.
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  [oldal-hiba] ${e.message}`));

  await load(page, `${CLIENT_URL}?name=Dev`);
  const initial = await visible(page);
  check(
    "alapertelmezetten a fejlesztoi elemek rejtve vannak",
    devHidden(initial),
    `csuszkak: ${initial.sliders}, technikai panel: ${initial.tech}, sugo: ${initial.help}`,
  );
  check(
    "a jatekos-HUD viszont latszik",
    initial.player,
    `${initial.player}`,
  );
  // Az fps es a ping a JATEKOSNAK is szol: ebbol tudja, hogy a
  // szaggatas a gepe vagy a kapcsolata miatt van-e. Ezert dev modon
  // KIVUL is latszania kell -- a tobbi technikai szamlalotol elteroen.
  check(
    "az fps/ping dev mod NELKUL is latszik",
    initial.netstat,
    `netstat: ${initial.netstat}`,
  );
  // A vezerles-sugo CSAK keresre nyilik: magatol nem takarhatja el a
  // palyat. Amirol viszont tudni kell, hogy letezik -- ezt a mindig
  // lathato "H sugo" gomb hirdeti.
  check(
    "a vezerles-sugo alapbol NEM latszik",
    !initial.controls,
    `vezerles-sugo: ${initial.controls}`,
  );
  check(
    "a sugo-gomb viszont igen, tehat tudni lehet rola",
    initial.helpButton,
    `sugo-gomb: ${initial.helpButton}`,
  );

  // ...es a H tenylegesen megnyitja. E nelkul a fenti ket allitas
  // ugy is teljesulne, hogy a sugo egyaltalan nem mukodik.
  await page.keyboard.press("KeyH");
  await sleep(500);
  const afterH = await visible(page);
  check(
    "a H megnyitja a sugot",
    afterH.controls,
    `vezerles-sugo H utan: ${afterH.controls}`,
  );
  await page.keyboard.press("KeyH");
  await sleep(900);

  // Ctrl+Shift+D
  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await page.keyboard.press("KeyD");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await sleep(400);

  const toggled = await visible(page);
  check(
    "a Ctrl+Shift+D bekapcsolja a fejlesztoi modot",
    devShown(toggled),
    `csuszkak: ${toggled.sliders}, technikai panel: ${toggled.tech}, sugo: ${toggled.help}`,
  );
  check(
    "a jatekos-HUD dev modban is megmarad",
    toggled.player,
    "a fejlesztonek is latnia kell, amit a jatekos lat",
  );

  await page.reload();
  await page.waitForFunction(() => !!(window as any).__spike, null, { timeout: 20000 });
  await sleep(1200);
  const reloaded = await visible(page);
  check(
    "a valasztas tulel egy ujratoltest",
    devShown(reloaded),
    `csuszkak: ${reloaded.sliders}`,
  );

  // A `?dev=0` felulirja a tarolt valasztast: egy megosztott link
  // biztosan tiszta jatekos-nezetet ad.
  await load(page, `${CLIENT_URL}?name=Dev&dev=0`);
  const forcedOff = await visible(page);
  check(
    "a ?dev=0 erosebb a tarolt valasztasnal",
    devHidden(forcedOff),
    `csuszkak: ${forcedOff.sliders}, technikai panel: ${forcedOff.tech}`,
  );

  // SEMMI ne takarja a jatekot.
  //
  // A "hidden" attributum a bongeszo alap-stiluslapjan keresztul hat,
  // de egy ID-szelektoros display-szabaly ERŐSEBB nala -- olyankor az
  // elem a hidden ellenere kirajzolodik. A #match-result eppen igy
  // borult ra az egesz jatekra (inset: 0, 72%-os sotet hatter), es
  // "kiszurkitett", letiltott hatas latszatat keltette.
  //
  // A SZAMITOTT display-t nezzuk, NEM a hidden tulajdonsagot: elso
  // korben pont az utobbira szurtem, es igy a tettest zartam ki a
  // vizsgalatbol.
  await load(page, `${CLIENT_URL}?name=Dev&dev=0`);
  const covering = (await page.evaluate(`(function () {
    var vw = innerWidth, vh = innerHeight, res = [];
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (e.tagName === "HTML" || e.tagName === "BODY" || e.tagName === "CANVAS") continue;
      var cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      var r = e.getBoundingClientRect();
      if (r.width < vw * 0.8 || r.height < vh * 0.8) continue;
      res.push((e.id || e.tagName) + " (" + cs.backgroundColor + ")");
    }
    return res;
  })()`)) as string[];
  check(
    "semmi nem takarja a jatekot",
    covering.length === 0,
    covering.length === 0 ? "csak a vaszon" : covering.join(", "),
  );

  await load(page, `${CLIENT_URL}?name=Dev&dev=1`);
  const forcedOn = await visible(page);
  check(
    "a ?dev=1 bekapcsolja",
    devShown(forcedOn),
    `csuszkak: ${forcedOn.sliders}`,
  );

  await browser.close();

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
