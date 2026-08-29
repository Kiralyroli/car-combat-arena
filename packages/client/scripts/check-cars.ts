/**
 * A valasztott AUTO a teljes lancon (vegponttol vegpontig).
 *
 * A MEGOLDANDO HIBA (meg a szinek koraban): a tavoli autok kulsejet a
 * FOGADO kliens osztotta ki a sajat listaja szerint, ezert ugyanaz a
 * jatekos MASKEPP nezett ki minden kepernyon. Harom jatekosnal A ugy
 * latta B-t, ahogy B latta A-t -- vagyis nem tudtak egymasrol beszelni
 * ("a pickup kempel").
 *
 * Ez a teszt pontosan azt meri, amit a szabalyok (check:cars a
 * sharedben) NEM tudnak: hogy KET KULON KLIENS ugyanazt latja-e.
 *
 * A MERET is szamit, nem csak a latvany: a kocsik 3,7 es 5,8 m kozott
 * vannak, es a tavoli auto fizikai teste ebbol epul. Ha a meret nem
 * jutna at, egy pickupba ugy lehetne belehajtani, hogy meg egy meterre
 * van tole -- vagy forditva.
 *
 * Futtatas (fusson a kliens dev szerver es a jatekszerver):
 *   npm run check:cars-e2e
 */
import { CAR_GEOMETRY, type CarId } from "@cca/shared";
import { chromium, type Browser, type Page } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function open(
  name: string,
  car: CarId,
  skin: string,
  hash: string,
): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) =>
    console.log(`  [oldal-hiba: ${name}] ${e.message}`),
  );
  await page.goto(
    `${CLIENT_URL}?name=${name}&car=${car}&skin=${skin}&dekor=0${hash}`,
  );
  await page.waitForFunction(
    () => !!(window as any).__spike?.net?.playerId,
    null,
    { timeout: 20000 },
  );
  return { browser, page };
}

/** Ahogy EZ a kliens latja a megadott jatekos autojat. */
async function seenCar(page: Page, playerId: string): Promise<string | null> {
  return (await page.evaluate(
    (id: string) => (window as any).__spike.view.remoteCarModel(id) ?? null,
    playerId,
  )) as string | null;
}

/** Melyik autoval epult a tavoli jatekos FIZIKAI teste itt. */
async function seenBodyCar(
  page: Page,
  playerId: string,
): Promise<string | null> {
  return (await page.evaluate(
    (id: string) =>
      (window as any).__spike.backend?.remoteCarOf?.(id) ?? null,
    playerId,
  )) as string | null;
}

async function main(): Promise<void> {
  console.log("=== Valasztott autok (vegponttol vegpontig) ===\n");

  const A = await open("Izomautos", "Muscle", "Sarga", "");
  const room = A.page.url().substring(A.page.url().indexOf("#") + 1);
  const B = await open("Terepjaros", "Jeep", "Kek", `#${room}`);
  const C = await open("Rendor", "Rescue", "Rendor", `#${room}`);
  await sleep(2500);

  const idOf = (page: Page) =>
    page.evaluate("window.__spike.net.playerId") as Promise<string>;
  const [idA, idB, idC] = [
    await idOf(A.page),
    await idOf(B.page),
    await idOf(C.page),
  ];

  // --- Mindenki a KERT autot kapta (nem utkoztek) ---
  const ownA = (await A.page.evaluate("window.__spike.net.ownCar")) as CarId;
  const ownB = (await B.page.evaluate("window.__spike.net.ownCar")) as CarId;
  const ownC = (await C.page.evaluate("window.__spike.net.ownCar")) as CarId;
  const skinA = (await A.page.evaluate("window.__spike.net.ownSkin")) as string;
  const skinB = (await B.page.evaluate("window.__spike.net.ownSkin")) as string;
  const skinC = (await C.page.evaluate("window.__spike.net.ownSkin")) as string;
  check(
    "mindenki a kert autot es festest kapta",
    ownA === "Muscle" &&
      ownB === "Jeep" &&
      ownC === "Rescue" &&
      skinA === "Sarga" &&
      skinB === "Kek" &&
      skinC === "Rendor",
    `${ownA}/${skinA}, ${ownB}/${skinB}, ${ownC}/${skinC}`,
  );

  // --- EZ A LENYEG: B ugyanaz A es C kepernyojen is ---
  const bOnA = await seenCar(A.page, idB);
  const bOnC = await seenCar(C.page, idB);
  check(
    "ugyanaz a jatekos MINDKET masik kliensen egyforma",
    bOnA !== null && bOnA === bOnC,
    `B autoja A-nal: ${bOnA}, C-nel: ${bOnC}`,
  );

  // ...es tenylegesen az, amit valasztott.
  check(
    "a latott auto a jatekos valasztasa",
    bOnA === "Jeep",
    `latott: ${bOnA}, valasztott: Jeep`,
  );

  // --- A tobbiek is kulonboznek egymastol ---
  const aOnB = await seenCar(B.page, idA);
  const cOnB = await seenCar(B.page, idC);
  check(
    "a ket ellenfel B kepernyojen kulonbozik",
    aOnB !== null && cOnB !== null && aOnB !== cOnB,
    `A: ${aOnB}, C: ${cOnB}`,
  );

  // --- A MERET is atjut ---
  //
  // Nem eleg, hogy a modell jo: a tavoli auto FIZIKAI teste is az adott
  // kocsibol epul. A kliens azt konyveli, melyik autoval epitette --
  // ha ez elcsuszna, egy 5,8 m-es pickupba ugy lehetne belehajtani,
  // hogy meg egy meterre van tole.
  const testB = await seenBodyCar(B.page, idA);
  const testA = await seenBodyCar(A.page, idB);
  check(
    "a tavoli auto fizikai teste a HELYES autoval epult",
    testB === ownA && testA === ownB,
    `A teste B-nel: ${testB} (${ownA}), B teste A-nal: ${testA} (${ownB})`,
  );

  // --- UTKOZES: aki foglalt autot ker, mast kap ---
  // UGYANAZT a parost keri, mint B: masik FESTEST kell kapnia --
  // ugyanazon a karosszerian, mert a valasztott forma megmarad.
  const D = await open("Masodik-terepjaro", "Jeep", "Kek", `#${room}`);
  await sleep(2000);
  const ownD = (await D.page.evaluate("window.__spike.net.ownCar")) as CarId;
  const skinD = (await D.page.evaluate("window.__spike.net.ownSkin")) as string;
  check(
    "foglalt festes helyett masik festes, ugyanazon a kocsin",
    ownD === "Jeep" && skinD !== "Kek",
    `Jeep/Kek foglalt -> ${ownD}/${skinD}`,
  );

  // A negy jatekos autoja paronkent kulonbozik -- kulonben a jatek
  // kozbeni azonositas hasznalhatatlan lenne.
  const mind = [
    `${ownA}/${skinA}`,
    `${ownB}/${skinB}`,
    `${ownC}/${skinC}`,
    `${ownD}/${skinD}`,
  ];
  check(
    "negy jatekos negy kulonbozo kinezettel",
    new Set(mind).size === 4,
    mind.join(", "),
  );

  // A MERETEK tenyleg kulonboznek: ha a generalas elmaradna, mind a
  // negy kocsi ugyanakkora lenne, es a valasztas csak latvany volna.
  const hosszak = [ownA, ownB, ownC].map(
    (c) => CAR_GEOMETRY[c].halfExtents.z * 2,
  );
  check(
    "a harom kulonbozo forma merete kulonbozik",
    new Set(hosszak.map((h) => h.toFixed(2))).size === 3,
    hosszak.map((h) => `${h.toFixed(2)} m`).join(", "),
  );

  // --- A lobby elonezeti autoja: rajta a valasztott FEGYVER ---
  //
  // A MEGOLDANDO HIBA: a fegyver magassaga (LAUNCHER_HEIGHT) a fizikai
  // doboz KOZEPPONTJAHOZ mert, az elonezeti csoport viszont a talajrol
  // indul. A ket rendszer osszekeverese nem latvanyos hiba: a torony
  // egyszeruen a karosszeria BELSEJEBE kerul, es a jatekos nem erti,
  // miert nem latja a valasztott fegyverét.
  const veto = await A.page.evaluate((car: string) => {
    const view = (window as unknown as Record<string, any>).__spike.view;
    const fegyveres = view.buildCarPreview(car, "Fekete", "cannon");
    const fegyvertelen = view.buildCarPreview(car, "Fekete");
    fegyveres.updateMatrixWorld(true);
    const cso = fegyveres.getObjectByName("Turret_Gun");
    let ures = true;
    fegyvertelen.traverse((o: { name: string }) => {
      if (o.name === "Turret_Gun") ures = false;
    });
    // A matrixWorld 14. eleme a vilag-beli Y (a modell talajanak
    // rendszereben, mert az elonezeti csoport origoja a talaj).
    return { magassag: cso ? cso.matrixWorld.elements[13] : null, ures };
  }, ownA);

  const tetoA = CAR_GEOMETRY[ownA].halfExtents.y * 2;
  check(
    "az elonezeti auton ott van a valasztott fegyver",
    veto.magassag !== null,
    veto.magassag === null ? "nincs Turret_Gun" : "Turret_Gun megvan",
  );
  check(
    "a fegyver a TETO FOLOTT ul, nem a karosszeriaban",
    veto.magassag !== null &&
      veto.magassag >= tetoA &&
      veto.magassag < tetoA + 1.5,
    `a cso tengelye ${(veto.magassag ?? 0).toFixed(2)} m, a teto ${tetoA.toFixed(2)} m`,
  );
  check(
    "fegyver nelkul kert elonezeten NINCS torony",
    veto.ures,
    "a belyegkepekre nem kerul fegyver",
  );

  for (const client of [A, B, C, D]) await client.browser.close();

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
