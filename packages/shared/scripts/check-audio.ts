/**
 * Terbeli hangkeveres -- bongeszo nelkul.
 *
 * A hangot magat nem lehet automatikusan megitelni, de azt igen, hogy
 * a KEVERES szabalyai teljesulnek-e: a tavolabbi halkabb, a jobbrol
 * jovo jobbra szol, es a palya tuloldalarol semmi nem hallatszik. Ezek
 * a szabalyok azok, amiket egy kesobbi atirasnal csendben el lehetne
 * rontani.
 *
 * Futtatas: npm run check:audio
 */
import {
  AUDIO_MAX_M,
  AUDIO_REFERENCE_M,
  audioMix,
  engineTone,
  ARCADE,
} from "../src/index";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const ORIGO = [0, 0, 0] as const;
/** A jatek -Z fele "elore" konvencioja szerint eszaknak nezve. */
const ELORE = 0;

function main(): void {
  console.log("=== Terbeli hangkeveres ===\n");

  // --- Tavolsag ---
  {
    const kozel = audioMix(ORIGO, ELORE, [0, 0, -5]);
    const kozepes = audioMix(ORIGO, ELORE, [0, 0, -30]);
    const tavol = audioMix(ORIGO, ELORE, [0, 0, -80]);
    check(
      "a tavolabbi hang halkabb",
      kozel.gain > kozepes.gain && kozepes.gain > tavol.gain,
      `5 m: ${kozel.gain.toFixed(2)}, 30 m: ${kozepes.gain.toFixed(2)}, 80 m: ${tavol.gain.toFixed(2)}`,
    );
    check(
      "a referencia-tavolsagon belul teljes a hangero",
      audioMix(ORIGO, ELORE, [0, 0, -1]).gain > 0.95,
      `1 m-en ${audioMix(ORIGO, ELORE, [0, 0, -1]).gain.toFixed(3)} (referencia: ${AUDIO_REFERENCE_M} m)`,
    );
  }

  // --- A hatarnal tenylegesen elhal ---
  //
  // Ez nem szorszalhasogatas: puszta 1/d mellett a palya tuloldalarol is
  // maradna egy halk maradek MINDEN lovesbol, es nyolc jatekosnal ez
  // allando zajja allna ossze.
  {
    const hataron = audioMix(ORIGO, ELORE, [0, 0, -AUDIO_MAX_M]);
    const tul = audioMix(ORIGO, ELORE, [0, 0, -(AUDIO_MAX_M + 20)]);
    const elotte = audioMix(ORIGO, ELORE, [0, 0, -(AUDIO_MAX_M - 5)]);
    check(
      "a hatartavolsagon tul nem hallatszik",
      hataron.gain === 0 && tul.gain === 0,
      `${AUDIO_MAX_M} m-en es tul: 0`,
    );
    check(
      "a hatar elott mar szinte nema (nincs ugras)",
      elotte.gain > 0 && elotte.gain < 0.02,
      `${(AUDIO_MAX_M - 5)} m-en ${elotte.gain.toFixed(4)}`,
    );
  }

  // --- Panorama ---
  {
    // A jatek konvencioja: -Z az elore, tehat a +X a JOBB kez felol van.
    const jobbra = audioMix(ORIGO, ELORE, [20, 0, 0]);
    const balra = audioMix(ORIGO, ELORE, [-20, 0, 0]);
    const elottunk = audioMix(ORIGO, ELORE, [0, 0, -20]);
    check(
      "a jobbrol jovo hang jobbra szol",
      jobbra.pan > 0.9,
      `pan = ${jobbra.pan.toFixed(2)}`,
    );
    check(
      "a balrol jovo hang balra szol",
      balra.pan < -0.9,
      `pan = ${balra.pan.toFixed(2)}`,
    );
    check(
      "az elottunk levo hang kozepen szol",
      Math.abs(elottunk.pan) < 0.01,
      `pan = ${elottunk.pan.toFixed(3)}`,
    );

    // A jatekos ELFORDUL: ugyanaz a hangforras atkerul a masik fulbe.
    // E nelkul a panorama a vilaghoz lenne rogzitve, nem a jatekoshoz.
    const forditva = audioMix(ORIGO, Math.PI, [20, 0, 0]);
    check(
      "elfordulaskor a panorama is fordul",
      forditva.pan < -0.9,
      `180 fokkal elfordulva: ${forditva.pan.toFixed(2)} (elotte ${jobbra.pan.toFixed(2)})`,
    );
  }

  // --- Kozel nincs csattogas ---
  //
  // A sajat autonk kozvetlen kornyeken egy centimeteres elmozdulas is
  // atbillentene a hangot az egyik fulbol a masikba.
  {
    const alig = audioMix(ORIGO, ELORE, [0.3, 0, 0]);
    check(
      "kozvetlen kozelrol nem ugrik szelso panoramara",
      Math.abs(alig.pan) < 0.1,
      `0.3 m-re oldalt: pan = ${alig.pan.toFixed(3)}`,
    );
  }

  // --- Motorhang ---
  {
    // A BOOSTOLT vegsebesseg a viszonyitas, nem a sima: boostolva is
    // szol a motor, es nem szabad, hogy ott szaladjon el a hangolas.
    const top = ARCADE.boostMaxSpeed * 3.6;
    const allo = engineTone(0, 0, top);
    const felut = engineTone(top / 2, 1, top);
    const vegen = engineTone(top, 1, top);
    check(
      "a motor a sebesseggel egyre magasabb",
      allo.rate < felut.rate && felut.rate < vegen.rate,
      `${allo.rate.toFixed(2)} -> ${felut.rate.toFixed(2)} -> ${vegen.rate.toFixed(2)}`,
    );
    check(
      "allo autonal is szol az alapjarat",
      allo.gain > 0.2,
      `${allo.gain.toFixed(2)} hangero gaz nelkul`,
    );
    check(
      "a gaz hallhatoan hozzatesz",
      engineTone(20, 1, top).gain > engineTone(20, 0, top).gain + 0.2,
      `20 km/h-nal gazzal ${engineTone(20, 1, top).gain.toFixed(2)}, anelkul ${engineTone(20, 0, top).gain.toFixed(2)}`,
    );
    // A hangolas felso hatara: a lemez-analogia csak addig all, amig a
    // felvetel nem valik nevetsegesse. Ketszeres sebesseg folott mar egy
    // oktavval magasabb -- az nem motor, hanem darazs.
    check(
      "a hangolas nem szalad el",
      vegen.rate < 2,
      `vegsebessegnel ${vegen.rate.toFixed(2)}-szoros lejatszasi sebesseg`,
    );
  }

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
