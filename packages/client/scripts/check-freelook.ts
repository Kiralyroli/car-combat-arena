/**
 * KORULNEZES a bongeszoben: a C gomb + eger tenyleg forgatja-e a kamerat.
 *
 * A szabalyt (szog a celkereszt helyebol es az egerbol) a
 * check:freelook meri, bongeszo nelkul. Itt az UTJA a merheto: eljut-e
 * a billentyu es az eger a kameraig, kozepre ugrik-e a celkereszt, es
 * all-e vissza minden elengedeskor.
 *
 * Ez a lanc tobb helyen tud csendben elszakadni -- egy elmaradt
 * esemenykezelo, egy at nem adott parameter --, es a jatek attol meg
 * hibatlanul fut, csak a C nem csinal semmit.
 *
 * Futtatas: npm run check:freelook-ui
 */
import { freeLookParkNdcY } from "@cca/shared";
import { chromium, type Page } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

/**
 * A celkereszt helye pixelben, ES hogy latszik-e.
 *
 * A LATHATOSAG kulon kerdes: a celkereszt lehet a jo helyen ugy is,
 * hogy kozben rejtve van (a rajzolasa a "palya folott" jelzestol is
 * fugg, azt pedig a kozepre ugras felulirja). Hely nelkuli
 * lathatosag-vizsgalat eppen ezt a hibat engedne at.
 */
async function celkereszt(
  page: Page,
): Promise<{ x: number; y: number; latszik: boolean }> {
  return (await page.evaluate(() => {
    const el = document.getElementById("crosshair");
    if (!el) return { x: 0, y: 0, latszik: false };
    const st = getComputedStyle(el);
    return {
      x: parseFloat(el.style.left || "0"),
      y: parseFloat(el.style.top || "0"),
      latszik: !el.hidden && st.display !== "none" && Number(st.opacity) > 0,
    };
  })) as { x: number; y: number; latszik: boolean };
}

/**
 * A kamera NEZESIRANYA fokban (vizszintes).
 *
 * NEM egy vilagbeli pont kepernyo-helyet merunk: az elso valtozat azt
 * tette, es a referenciapont a kepen KIVULRE esett -- a vetites ott
 * hasznalhatatlan szamokat ad (a kamera mogotti pontnal elojelet is
 * valt). A nezesirany viszont mindig ertelmes.
 *
 * ELOJEL: JOBBRA fordulva ez az ertek CSOKKEN. (-Z fele nezve pi, +X
 * fele nezve pi/2 -- lasd atan2(x, z).)
 */
async function kameraIrany(page: Page): Promise<number> {
  return (await page.evaluate(() => {
    const v = (window as any).__spike.view;
    const d = new v.camera.position.constructor();
    v.camera.getWorldDirection(d);
    return (Math.atan2(d.x, d.z) * 180) / Math.PI;
  })) as number;
}

/**
 * A kamera FUGGOLEGES nezesiranya (a vizszinteshez kepest, fokban).
 *
 * Pozitiv = felfele nez. Ezzel derul ki, hogy a fel-le nezes IRANYA
 * jo-e -- az elso valtozatban forditva volt, es a szog nagysagat
 * merve ez nem latszott volna.
 */
async function kameraEmeles(page: Page): Promise<number> {
  return (await page.evaluate(() => {
    const v = (window as any).__spike.view;
    const d = new v.camera.position.constructor();
    v.camera.getWorldDirection(d);
    return (Math.asin(Math.max(-1, Math.min(1, d.y))) * 180) / Math.PI;
  })) as number;
}

/** Ket szog kulonbsege -180..180 kozott. */
function szogKulonbseg(a: number, b: number): number {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

async function main(): Promise<void> {
  console.log("=== Korulnezes a bongeszoben ===\n");

  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => console.log(`  [oldal-hiba] ${e.message}`));
  // Diszites nelkul: itt a kamera szoge a lenyeg, nem a latvany.
  await page.goto(`${CLIENT_URL}?dekor=0&name=Nezes`);
  await page.waitForFunction(() => !!(window as any).__spike?.net?.playerId, null, {
    timeout: 30000,
  });
  await sleep(2500);

  // A celkeresztet a kozeptol JOBBRA visszuk: igy a belepes ugrasa is
  // merheto lesz.
  await page.mouse.move(900, 360);
  await sleep(400);

  const kezdoIrany = await kameraIrany(page);
  const kezdoEmeles = await kameraEmeles(page);
  const kezdoKereszt = await celkereszt(page);

  // A celkereszt ROGZITETT helye a kamera geometriajabol (nem beirt szam).
  const fov = (await page.evaluate(
    () => (window as any).__spike.view.cameraFov,
  )) as number;
  const parkY = ((1 - freeLookParkNdcY(fov)) / 2) * 720;

  // --- A C NELKUL az eger nem forgat ---
  //
  // Enelkul a teszt akkor is atmenne, ha a kamera barmilyen
  // egermozgasra fordulna -- vagyis a gomb szerepet nem mernenk.
  {
    await page.mouse.move(1100, 360);
    await sleep(600);
    const most = await kameraIrany(page);
    check(
      "a C nelkul az eger nem forgatja a kamerat",
      Math.abs(szogKulonbseg(most, kezdoIrany)) < 3,
      `${szogKulonbseg(most, kezdoIrany).toFixed(1)}° elfordulas`,
    );
    await page.mouse.move(900, 360);
    await sleep(400);
  }

  // --- Belepeskor a celkereszt KOZEPRE ugrik ---
  {
    await page.keyboard.down("c");
    await sleep(300);
    const kozepen = await celkereszt(page);
    check(
      "belepeskor a celkereszt a rogzitett helyre ugrik",
      Math.abs(kozepen.x - 640) < 2 && Math.abs(kozepen.y - parkY) < 2,
      `(${kozepen.x}, ${kozepen.y}) -- a szamolt hely (640, ${parkY.toFixed(0)})`,
    );
    // NEM a kep kozepere: oda a sajat autonk esik.
    check(
      "a celkereszt a kep kozepe FOLOTT all",
      kozepen.y < 360 - 40,
      `y = ${kozepen.y.toFixed(0)} (a kep kozepe 360, ott az autonk van)`,
    );
    check(
      "es kozben LATSZIK is",
      kozepen.latszik,
      kozepen.latszik ? "kirajzolva" : "a jo helyen van, de rejtve",
    );
    check(
      "a celkereszt tenylegesen elmozdult",
      Math.abs(kozepen.x - kezdoKereszt.x) > 100,
      `${kezdoKereszt.x} -> ${kozepen.x}`,
    );
  }

  // --- A kamera ODA fordul, ahol a celkereszt allt ---
  //
  // A celkereszt a kozeptol JOBBRA allt, tehat a kameranak jobbra kell
  // fordulnia -- vagyis a tole jobbra levo pont a kep KOZEPE fele
  // mozdul. Ezt a referenciapont NDC-jevel merjuk, nem a kamera
  // szogevel: igy az IRANY is kiderul, nem csak az, hogy tortent valami.
  {
    await sleep(1200);
    const most = await kameraIrany(page);
    const d = szogKulonbseg(most, kezdoIrany);
    // A celkereszt a kozeptol JOBBRA allt (900 px a 640 helyett), tehat
    // a kameranak JOBBRA kell fordulnia -- vagyis az ertek CSOKKEN.
    check(
      "a kamera a celkereszt IRANYABA fordul",
      d < -5,
      `${d.toFixed(1)}° (negativ = jobbra, ahol a celkereszt allt)`,
    );
  }

  // --- Az eger tovabb forgat ---
  {
    const elotte = await kameraIrany(page);
    await page.mouse.move(1200, 360);
    await sleep(1200);
    const utana = await kameraIrany(page);
    const d = szogKulonbseg(utana, elotte);
    check(
      "C nyomva az eger tovabb forgatja a kamerat, jo iranyba",
      d < -5,
      `${d.toFixed(1)}° tovabb jobbra (az egeret is jobbra huztuk)`,
    );
    // A celkereszt KOZBEN is helyben marad, es latszik.
    const k = await celkereszt(page);
    check(
      "a celkereszt vegig helyben marad",
      Math.abs(k.x - 640) < 2 && Math.abs(k.y - parkY) < 2 && k.latszik,
      `(${k.x}, ${k.y}), latszik: ${k.latszik}`,
    );

    // --- A KAMERA NEM MARAD LE az egertol ---
    //
    // A modul szoge (korulnezes.yaw) es a kamera TENYLEGES iranya
    // ugyanaz kell legyen. Ha barhol simitas kerul a lancba -- a
    // szogre vagy a kamera kovetesere --, a ketto szetvalik, es a kep
    // lathatoan kesik az eger utan.
    //
    // Ez volt az elso valtozat hibaja: a szog is simitva volt (0,35 mp
    // idoallandoval), es a kamera kovetese is (CAMERA.positionLerp).
    //
    // KET dolgon mulik, hogy a meres eszreveszi-e:
    //
    //  - a NYERS celszoghoz merunk, nem a modul kifele adott (esetleg
    //    simitott) szogehez. Ahhoz merve a ketto egyutt kesne, tehat
    //    vegig egyezne -- a teszt elso valtozata igy engedte at a
    //    visszatett simitast.
    //  - ROVIDDEL a mozgatas utan merunk. Egy 0,35 mp idoallandoju
    //    simitas egy masodperc alatt mar beer, tehat keson merve
    //    ugyanugy nem latszana.
    {
      await page.mouse.move(900, 360);
      await sleep(300);
      const modulSzog = (
        (await page.evaluate(
          () => (window as any).__spike.korulnezes.celSzog,
        )) as { yaw: number }
      ).yaw;
      const kameraSzog = await kameraIrany(page);
      // A modul szoge az auto MOGOTTI iranyhoz kepest ertendo, a
      // kezdoIrany pedig eppen az. A ketto kulonbsegenek egyeznie kell
      // a modul szogevel (ellenkezo elojellel: jobbra nezni = csokkeno
      // atan2, lasd kameraIrany).
      const tenyleges = -szogKulonbseg(kameraSzog, kezdoIrany);
      check(
        "a kamera nem marad le az egertol",
        Math.abs(tenyleges - modulSzog) < 4,
        `a NYERS cel ${modulSzog.toFixed(1)}°, a kamera ${tenyleges.toFixed(1)}° (elteres ${Math.abs(tenyleges - modulSzog).toFixed(2)}°)`,
      );
    }

    // --- A FEL-LE nezes IRANYA ---
    //
    // Ez volt forditva az elso valtozatban: a szog nagysagat merve nem
    // latszott volna, csak az iranyat merve.
    const emelesElotte = await kameraEmeles(page);
    await page.mouse.move(1200, 160);
    await sleep(1200);
    const emelesUtana = await kameraEmeles(page);
    check(
      "az egeret FELFELE huzva a kamera is felfele nez",
      emelesUtana > emelesElotte + 3,
      `${emelesElotte.toFixed(1)}° -> ${emelesUtana.toFixed(1)}° (felfele = pozitiv)`,
    );
    await page.mouse.move(1200, 560);
    await sleep(1400);
    const lefele = await kameraEmeles(page);
    check(
      "lefele huzva lefele nez",
      lefele < emelesUtana - 3,
      `${emelesUtana.toFixed(1)}° -> ${lefele.toFixed(1)}°`,
    );

    await page.keyboard.up("c");
  }

  // --- Elengedve minden visszaall ---
  {
    // VARUNK, amig visszaall -- nem fix ideig.
    //
    // A korulnezes sajat simitasa lepeskoz-fuggetlen (lasd
    // freeLookEase), a kamera KOVETESE viszont kepkockankent dolgozik
    // (CAMERA.positionLerp), es a fejetlen bongeszo lassan renderel.
    // Fix ket masodperccel merve 6,8 fok maradt -- ami nem hiba, csak a
    // lassu kep.
    let elteres = 999;
    for (let i = 0; i < 32; i++) {
      await sleep(250);
      elteres = Math.abs(szogKulonbseg(await kameraIrany(page), kezdoIrany));
      if (elteres < 5) break;
    }
    check(
      "elengedve visszaall a kamera az auto moge",
      elteres < 5,
      `${elteres.toFixed(1)}° elteres az alaphelyzettol`,
    );

    const emeles = await kameraEmeles(page);
    check(
      "a fuggoleges nezes is visszaall",
      Math.abs(emeles - kezdoEmeles) < 4,
      `${emeles.toFixed(1)}° (indulaskor ${kezdoEmeles.toFixed(1)}°)`,
    );

    const k = await celkereszt(page);
    check(
      "a celkereszt visszakerul oda, ahol volt",
      Math.abs(k.x - kezdoKereszt.x) < 2 && Math.abs(k.y - kezdoKereszt.y) < 2,
      `(${k.x}, ${k.y}) -- belepes elott (${kezdoKereszt.x}, ${kezdoKereszt.y})`,
    );

    // ...es megint koveti az egeret.
    await page.mouse.move(500, 300);
    await sleep(300);
    const mozgo = await celkereszt(page);
    check(
      "elengedes utan a celkereszt megint kovet",
      Math.abs(mozgo.x - 500) < 2,
      `(${mozgo.x}, ${mozgo.y})`,
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
