/**
 * KORULNEZES: a kamera szoge belepeskor es forgatas kozben.
 *
 * A mod ket kulon szamitasbol all, es MINDKETTO tud csendesen elromlani:
 *
 *  - a BELEPES ugrasa. A kamera oda fordul, ahol a celkereszt allt.
 *    Ha ez elteved, a jatekos ugy nyom C-t, hogy celoz valamire, es
 *    utana valami mast lat a kep kozepen -- vagyis a mod pont azt
 *    rontja el, amiert van.
 *  - a FORGATAS. Forditott elojel, rossz erzekenyseg: a kamera
 *    hasznalhatatlan, de kivetelt semmi nem dob.
 *
 * Futtatas: npm run check:freelook
 */
import {
  FREELOOK,
  freeLookAdd,
  freeLookEase,
  freeLookFromAim,
  freeLookParkNdcY,
} from "../src/index";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

/** A jatek kamerajahoz kozeli ertekek. */
const FOV = 62;
const ASPECT = 16 / 9;

function main(): void {
  console.log("=== Korulnezes (C gomb) ===\n");

  // --- A CELKERESZT HELYE nem a kep kozepe ---
  //
  // A kozep eppen a SAJAT AUTONKRA esik (a kamera ra nez), tehat oda
  // kotve a jatekos a sajat kocsijat venne celba. A helynek FELJEBB
  // kell lennie, ott, ahol egy tavoli ellenfel latszik.
  {
    const park = freeLookParkNdcY(FOV);
    check(
      "a celkereszt a kep kozepe FOLOTT all",
      park > 0.15 && park < 0.6,
      `NDC y = ${park.toFixed(3)} (720 px-es kepen ${(((1 - park) / 2) * 720).toFixed(0)} px)`,
    );
    // A hely SZAMOLT: ha a kamera magassaga valtozik, kovetnie kell.
    // Egy beirt szam itt csendben elcsuszna.
    const szukebb = freeLookParkNdcY(FOV * 2);
    check(
      "a hely a latoszogbol jon, nem beirt szam",
      Math.abs(szukebb - park) > 1e-6,
      `${FOV}° -> ${park.toFixed(3)}, ${FOV * 2}° -> ${szukebb.toFixed(3)}`,
    );
  }

  // --- BELEPES: a ROGZITETT helyen allo celkereszt nem mozdit semmit ---
  {
    const a = freeLookFromAim(0, freeLookParkNdcY(FOV), FOV, ASPECT);
    check(
      "a rogzitett helyen allo celkeresztnel nem fordul a kamera",
      Math.abs(a.yaw) < 1e-9 && Math.abs(a.pitch) < 1e-9,
      "a celzas mar ott van, ahova kerulnie kell",
    );
  }

  // --- BELEPES: a celkereszt IRANYABA fordul ---
  {
    const jobbra = freeLookFromAim(0.5, 0, FOV, ASPECT);
    const balra = freeLookFromAim(-0.5, 0, FOV, ASPECT);
    check(
      "jobbra allo celkeresztnel jobbra fordul",
      jobbra.yaw > 0 && balra.yaw < 0,
      `jobb: ${jobbra.yaw.toFixed(1)}°, bal: ${balra.yaw.toFixed(1)}°`,
    );
    // A viszonyitas a ROGZITETT hely, nem a kep kozepe.
    const park = freeLookParkNdcY(FOV);
    const fent = freeLookFromAim(0, park + 0.3, FOV, ASPECT);
    const lent = freeLookFromAim(0, park - 0.3, FOV, ASPECT);
    check(
      "a rogzitett hely FOLOTT allo celkeresztnel felfele fordul",
      fent.pitch > 0 && lent.pitch < 0,
      `fent: ${fent.pitch.toFixed(1)}°, lent: ${lent.pitch.toFixed(1)}°`,
    );
  }

  // --- BELEPES: a szog a LATOSZOGBOL jon ---
  //
  // Ez a mod lenyege: a celzott pont pontosan a kep kozepere kerul. A
  // kep SZELEN allo celkereszt tehat eppen a fel latoszognyit fordit --
  // se tobbet, se kevesebbet. Egy "szorozzuk meg a fel latoszoggel"
  // kozelites itt tobb fokot tevedne, mert a perspektiva nem linearis.
  {
    const felFovFugg = FOV / 2;
    const felFovVizsz =
      (Math.atan(Math.tan((FOV * Math.PI) / 360) * ASPECT) * 180) / Math.PI;

    const szel = freeLookFromAim(1, 0, FOV, ASPECT);
    const teteje = freeLookFromAim(0, 1, FOV, ASPECT);
    const parkSzog =
      (Math.atan(freeLookParkNdcY(FOV) * Math.tan((FOV * Math.PI) / 360)) *
        180) /
      Math.PI;
    check(
      "a kep szelen allo celkereszt a fel latoszoget fordit",
      Math.abs(szel.yaw - felFovVizsz) < 1e-6,
      `${szel.yaw.toFixed(2)}° (a vizszintes fel latoszog ${felFovVizsz.toFixed(2)}°)`,
    );
    check(
      "fuggolegesen ugyanez, a rogzitett helyhez merve",
      Math.abs(teteje.pitch - (felFovFugg - parkSzog)) < 1e-6,
      `${teteje.pitch.toFixed(2)}° (fel latoszog ${felFovFugg.toFixed(2)}° - a rogzitett hely ${parkSzog.toFixed(2)}°)`,
    );
    // A LINEARIS kozelites tevedese -- ezert szamolunk arkusz tangenssel.
    const linearis = 1 * felFovVizsz;
    check(
      "a perspektiva nem linearis (ezert kell az arkusz tangens)",
      Math.abs(freeLookFromAim(0.5, 0, FOV, ASPECT).yaw - linearis / 2) > 1,
      `fel uton: ${freeLookFromAim(0.5, 0, FOV, ASPECT).yaw.toFixed(2)}° a linearis ${(linearis / 2).toFixed(2)}° helyett`,
    );
  }

  // --- FORGATAS: az irany jo ---
  {
    const jobbra = freeLookAdd({ yaw: 0, pitch: 0 }, 100, 0);
    const fel = freeLookAdd({ yaw: 0, pitch: 0 }, 0, -100);
    check(
      "az egeret jobbra huzva jobbra fordul",
      jobbra.yaw > 0,
      `+100 px -> ${jobbra.yaw.toFixed(1)}°`,
    );
    check(
      "felfele huzva felfele nez",
      fel.pitch > 0,
      `felfele 100 px -> ${fel.pitch.toFixed(1)}°`,
    );
  }

  // --- FORGATAS: vizszintesen KORBE lehet menni ---
  //
  // Ez a mod hasznalhatosaganak felteteles: hatra kell tudni nezni. Ha
  // valaki korlatot tenne a vizszintes szogre, ez fogja.
  {
    let szog = { yaw: 0, pitch: 0 };
    for (let i = 0; i < 20; i++) szog = freeLookAdd(szog, 200, 0);
    check(
      "vizszintesen nincs korlat (korbe lehet nezni)",
      Math.abs(szog.yaw) > 360,
      `20 x 200 px -> ${szog.yaw.toFixed(0)}°`,
    );
    const kellPixel = 180 / FREELOOK.degPerPixel;
    check(
      "hatranezeshez egy hatarozott mozdulat eleg",
      kellPixel > 400 && kellPixel < 2000,
      `${kellPixel.toFixed(0)} px a fel korhoz`,
    );
  }

  // --- FORGATAS: fuggolegesen VAN korlat ---
  //
  // Korlat nelkul a kamera atbukfencezne az auto folott, es a kep
  // fejre allna.
  {
    let fel = { yaw: 0, pitch: 0 };
    let le = { yaw: 0, pitch: 0 };
    for (let i = 0; i < 50; i++) {
      fel = freeLookAdd(fel, 0, -200);
      le = freeLookAdd(le, 0, 200);
    }
    check(
      "fuggolegesen a kamera nem bukfencezik at",
      fel.pitch === FREELOOK.maxPitchDeg && le.pitch === FREELOOK.minPitchDeg,
      `${le.pitch}° .. ${fel.pitch}°`,
    );
  }

  // --- A VISSZATERES megtortenik, es idoben ---
  {
    let szog = 180;
    let ido = 0;
    const dt = 1 / 60;
    while (Math.abs(szog) > 1 && ido < 5) {
      szog = freeLookEase(szog, 0, dt);
      ido += dt;
    }
    check(
      "elengedes utan visszaall a kamera",
      Math.abs(szog) <= 1,
      `180 fokrol 1 fok ala ${ido.toFixed(2)} mp alatt`,
    );
    check(
      "a visszateres nem huzodik el",
      ido < 2,
      `${ido.toFixed(2)} mp (a simitas ideje ${FREELOOK.returnTime} mp)`,
    );
  }

  // --- A SIMITAS lepeskoz-fuggetlen ---
  {
    let a = 90;
    for (let i = 0; i < 60; i++) a = freeLookEase(a, 0, 1 / 60);
    let b = 90;
    for (let i = 0; i < 15; i++) b = freeLookEase(b, 0, 1 / 15);
    check(
      "a simitas nem fugg a kepkockaszamtol",
      Math.abs(a - b) < 0.5,
      `60 Hz: ${a.toFixed(2)}°, 15 Hz: ${b.toFixed(2)}° egy masodperc utan`,
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
