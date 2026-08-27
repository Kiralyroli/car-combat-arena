/**
 * Agyu: kattintgatas es ujratoltes.
 *
 * A JATEKOS PANASZA: "ha folyamatosan kattintgatok, akkor folyamatosan
 * elindul a visszaszamlalas, de nem lo, csak idokozonkent es nincs
 * hang". Az ok: a kliens MINDEN kattintasra elorelepette az
 * ujratoltes-orat, holott a szerver csak minden ROCKET_COOLDOWN_MS-edik
 * lovest fogadja el -- igy a HUD visszaszamlaloja ujraindult egy meg
 * nem tortent lovesre, es (mivel a hang is ehhez az orahoz volt kotve)
 * a hang is elmaradt.
 *
 * Amit ez a teszt ellenoriz:
 *  - kattintgatva is annyi loves megy ki, amennyit a hutes enged,
 *  - MINDEN elsult loveshez tartozik hang,
 *  - a HUD visszaszamlaloja nem indul ujra a hiabavalo kattintasokra.
 *
 * Futtatas: npm run check:cannon
 */
import { ROCKET_COOLDOWN_MS } from "@cca/shared";
import { chromium, type Browser, type Page } from "playwright";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

async function openClient(
  name: string,
  hash: string,
): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  [oldal-hiba: ${name}] ${e.message}`));
  await page.goto(`${CLIENT_URL}?name=${name}&weapon=cannon${hash}`);
  await page.waitForFunction(() => !!(window as any).__spike?.net?.playerId, null, {
    timeout: 20000,
  });
  // Gesztus a hanghoz (a teszt kihagyja a lobbyt -- lasd check-sound.ts).
  await page.keyboard.press("KeyR");
  return { browser, page };
}

/**
 * Hany AGYU-loves szolt eddig.
 *
 * SZANDEKOSAN nem az osszes hang: minden lovest kovet egy becsapodas
 * is, tehat az osszesitett szamlalo ketszer annyit mutatna, es a teszt
 * a hutes megsertesenek latna. (Pontosan ez tortent, amikor a
 * robbanas-hang bekerult.)
 */
const hangok = (page: Page) =>
  page.evaluate(
    () => (window as any).__spike.audio.inditottEbbol("agyu") as number,
  ) as Promise<number>;
async function main(): Promise<void> {
  console.log("=== Agyu: kattintgatas ===\n");

  const A = await openClient("Agyus", "");
  const roomCode = A.page.url().substring(A.page.url().indexOf("#") + 1);
  const B = await openClient("Masik", `#${roomCode}`);
  await A.page.waitForFunction(
    () => (window as any).__spike?.net?.match?.phase === "playing",
    null,
    { timeout: 20000 },
  );
  await sleep(1500);

  // MEGVARJUK a hangok betolteset.
  //
  // A teszt a HANGOK szamabol tudja meg, hogy elsult-e a loves. Amig a
  // felvetelek toltodnek, a loves elsul ugyan, de nem szol -- a teszt
  // ezt "nem volt loves"-nek olvasna, es a visszaszamlalo jogos
  // ujraindulasat hibanak jelentene. (Pontosan ez tortent: 23-bol 1
  // ilyen par, minden futasban.)
  await A.page.waitForFunction(
    () => (window as any).__spike.audio.pufferSzam >= 5,
    null,
    { timeout: 20000 },
  );

  // Elore celzunk, hogy a loves ne a sajat spawn-valasztasunkra menjen.
  await A.page.mouse.move(640, 330);
  await sleep(400);

  // --- Kattintgatas ---
  //
  // 3 masodperc alatt 30 kattintas. A hutes 1.2 mp, tehat legfeljebb
  // 3 loves fer bele -- de MINDEGYIKHEZ tartoznia kell hangnak.
  const hangElotte = await hangok(A.page);
  // Az OLDAL sajat orajaval merunk, nem a sajatunkkal: a headless lap
  // lassu, egy kattintas oda-vissza akar szaz ms is lehet, tehat a
  // "3 masodpercig kattintgatunk" valojaban tobb. A hutesbol
  // megengedett lovesszamot a TENYLEGESEN eltelt idobol kell szamolni,
  // kulonben a teszt sajat kesese latszik tobbletlovesnek.
  const oldalIdo = (): Promise<number> =>
    A.page.evaluate(() => performance.now()) as Promise<number>;
  const tKezdet = await oldalIdo();
  const IDO_MS = 3000;
  const kattintasok = 30;
  const kezdet = Date.now();
  let n = 0;
  while (Date.now() - kezdet < IDO_MS && n < kattintasok) {
    await A.page.mouse.down();
    await A.page.mouse.up();
    n++;
    await sleep(IDO_MS / kattintasok);
  }
  const tVeg = await oldalIdo();
  await sleep(400);
  const hangUtana = await hangok(A.page);
  const szolt = hangUtana - hangElotte;

  const eltelt = tVeg - tKezdet;
  const varhato = Math.floor(eltelt / ROCKET_COOLDOWN_MS) + 1;
  check(
    "a kattintgatas nem ad tobb lovest a hutesnel",
    szolt <= varhato,
    `${n} kattintas ${(eltelt / 1000).toFixed(1)} mp alatt -> ${szolt} loves (a hutesbol legfeljebb ${varhato} fer bele)`,
  );
  check(
    "de a hutes ALTAL ENGEDETT loveseket leadja",
    szolt >= varhato - 1,
    `${szolt} loves ${(eltelt / 1000).toFixed(1)} mp alatt`,
  );
  // EZ a lenyeg: a jatekos azt latta, hogy "nem lo es nincs hang".
  check(
    "kattintgatva is szol a hang",
    szolt > 0,
    szolt > 0 ? `${szolt} hang` : "EGY hang sem szolt",
  );

  // --- A visszaszamlalo NEM indulhat ujra loves nelkul ---
  //
  // Ez a panasz lenyege. Az ellenorzes SZANDEKOSAN nem fix idozitesre
  // epul: a headless lap ~10 fps-en fut, tehat egy "varj 200 ms-ot"
  // valojaban felmasodperc is lehet, es abbol barmit ki lehetne olvasni.
  // Ehelyett egy IDOZITES-FUGGETLEN allitast merunk: ket mintavetel
  // kozott, ha NEM sult el loves, a hatralevo ido nem nohet.
  {
    const minta = async (): Promise<{
      hatra: number;
      hangok: number;
      kepkocka: number;
    }> =>
      A.page.evaluate(() => {
        const szoveg =
          document.getElementById("weapon-state")?.textContent?.trim() ?? "";
        return {
          // "KESZ" = nincs hatralevo ido.
          hatra: /[0-9]/.test(szoveg) ? Number(szoveg.replace(/[^0-9.]/g, "")) : 0,
          hangok: (window as any).__spike.audio.inditottEbbol("agyu") as number,
          kepkocka: (window as any).__spike.stats().frameCount as number,
        };
      });

    let elozo = await minta();
    let ujraindult = 0;
    let paros = 0;
    // A loves KEPKOCKAJA kimarad a merésbol.
    //
    // A HUD szoveget a renderelo frissiti, a lap viszont ~10 fps-en
    // fut, mikozben mintavenni ennel sokkal gyorsabban lehet: egyetlen
    // kepkockaba tobb mintavetel is beleeshet. A loves utani elso
    // mintak igy meg a REGI (majdnem nulla) erteket mutatjak, aztan
    // ugranak a teljes hutesre -- ami novekedesnek latszik, holott csak
    // a kijelzo ert utol. Ezert nem MINTAT hagyunk ki, hanem addig nem
    // merunk, amig a renderelo tul nem lepett a loves kepkockajan.
    let lovesKepkocka = -1;
    for (let i = 0; i < 25; i++) {
      await A.page.mouse.down();
      await A.page.mouse.up();
      const most = await minta();
      if (most.hangok !== elozo.hangok) {
        lovesKepkocka = most.kepkocka;
      } else if (most.kepkocka > lovesKepkocka + 1) {
        paros++;
        // 0.05 mp tures a kijelzo kerekitesere.
        if (most.hatra > elozo.hatra + 0.05) ujraindult++;
      }
      elozo = most;
    }
    check(
      "a hiabavalo kattintas nem inditja ujra a visszaszamlalast",
      ujraindult === 0,
      `${paros} olyan mintavetel-par, ahol nem sult el loves -- ${ujraindult} esetben nott a hatralevo ido`,
    );
  }

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
