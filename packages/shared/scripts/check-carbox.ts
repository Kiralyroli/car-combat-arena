/**
 * Az AUTO talalati dobozai.
 *
 * A talalatot korabban egyetlen doboz dontotte el, a modell teljes
 * befoglaloja. Most tobb, mert szeletbol all (carHitbox.ts), es ez
 * kozvetlenul a jatekmenetet valtoztatja: ami eddig talalat volt a
 * motorhaztetö FOLOTT, az mar nem az.
 *
 * Ket iranyba is el lehet rontani, es MINDKETTO csendes:
 *
 *  - ha a dobozok tul kicsik, a jatekos rendre "atlo" az ellenfelen,
 *  - ha valamelyik kilog a regibol, valaki eszrevetlenul
 *    eltalalhatobb lesz, mint volt.
 *
 * Futtatas: npm run check:carbox
 */
import { CAR_BOXES, CHASSIS, segmentCarEntry } from "../src/index";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

/** Az auto a vilag kozeppontjaban all, orral -Z fele (egyseg-forgatas). */
const ALL: [number, number, number] = [0, 0, 0];
const FORGATAS: [number, number, number, number] = [0, 0, 0, 1];

/**
 * Eltalal-e egy adott ponton ATMENO, oldalirányu loves?
 *
 * Kivulrol indul es kivul vegzodik, tehat tenylegesen a dobozokon kell
 * athaladnia. A gepfegyver golyoja pontszeru: sugar nelkul merunk.
 */
function talalOldalrol(y: number, z: number): boolean {
  return (
    segmentCarEntry([-20, y, z], [20, y, z], ALL, FORGATAS, 0) !== null
  );
}

/** Ugyanez elolrol-hatulrol (Z menten). */
function talalHosszaban(x: number, y: number): boolean {
  return (
    segmentCarEntry([x, y, -20], [x, y, 20], ALL, FORGATAS, 0) !== null
  );
}

function main(): void {
  console.log("=== Auto talalati dobozok ===\n");
  const H = CHASSIS.halfExtents;

  // --- Egyik doboz sem lóg ki a REGIBOL ---
  //
  // Ez a valtozas alapszabalya: csak elvenni szabad a hamis
  // talalatokbol, hozzaadni nem. Kulonben eszrevetlenul kerulne be egy
  // "nagyobb lett a hitbox" valtozas.
  {
    const kilog = CAR_BOXES.filter(
      (b) =>
        Math.abs(b.dx) + b.hx > H.x + 1e-6 ||
        Math.abs(b.dy) + b.hy > H.y + 1e-6 ||
        Math.abs(b.dz) + b.hz > H.z + 1e-6,
    );
    check(
      "egyik doboz sem lóg ki a regi befoglalobol",
      kilog.length === 0,
      kilog.length === 0
        ? `${CAR_BOXES.length} doboz, mind a ${(H.x * 2).toFixed(2)} x ${(H.y * 2).toFixed(2)} x ${(H.z * 2).toFixed(2)} m-en belul`
        : `${kilog.length} doboz kilog`,
    );
  }

  // --- A KAROSSZERIA magassagaban vegig talalhato ---
  //
  // Az auto also fele tomor: ott egy oldalirányu lovesnek a hossz
  // szinte teljes egeszen talalnia kell. Ha itt lyuk marad, a jatekos
  // rendre "atlo" az ellenfelen -- ez a rosszabbik hiba a kettobol.
  //
  // LEFEDETTSEGET merunk, nem "minden ponton talal"-t: az auto orra es
  // fara lejt, tehat a legalso magassagban a lokharito csucse alatt
  // TENYLEG nincs semmi. Az a helyes viselkedes, nem lyuk.
  {
    const bajos: string[] = [];
    for (const y of [-0.5, -0.3, 0, 0.1]) {
      let talalt = 0;
      let ossz = 0;
      for (let z = -H.z; z <= H.z; z += 0.05) {
        ossz++;
        if (talalOldalrol(y, z)) talalt++;
      }
      const arany = talalt / ossz;
      if (arany < 0.95) bajos.push(`y=${y}: ${Math.round(100 * arany)}%`);
    }
    check(
      "a karosszeria magassagaban vegig talalhato",
      bajos.length === 0,
      bajos.length === 0
        ? "az auto hosszanak legalabb 95%-a talalhato minden test-magassagban"
        : bajos.join(", "),
    );
  }

  // --- MINDEN IRANYBOL eltalalhato ---
  //
  // A kozeppontra celzott lovesnek talalnia kell, barhonnan jon. Ez a
  // "tul kicsi lett a hitbox" hiba legegyszerubb kizarasa.
  {
    const rossz: string[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const t = segmentCarEntry(
        [Math.cos(a) * 30, 0, Math.sin(a) * 30],
        [-Math.cos(a) * 30, 0, -Math.sin(a) * 30],
        ALL,
        FORGATAS,
        0,
      );
      if (t === null) rossz.push(`${Math.round((a * 180) / Math.PI)}°`);
    }
    check(
      "a kozeppontra celozva minden iranybol talal",
      rossz.length === 0,
      rossz.length === 0 ? "mind a 16 irany" : rossz.join(", "),
    );
  }

  // --- A KEREKEK eltalalhatok ---
  //
  // A kerekek kulon sebzodnek, tehat celozni lehet rajuk. A
  // karosszeria alja 0,16 m-rel a kerekek alja folott vegzodik: ha a
  // meres csak a karosszeriat nezne, az also szelet 1,39 m szeles
  // lenne a valos 2,0 helyett, es az oldalrol a kerekre adott loves
  // elszallna az auto alatt.
  {
    // A kerekek az auto negy sarka fele allnak; a legalso magassagban
    // merunk, kozvetlenul a talaj folott.
    const kerekMagassag = -H.y + 0.15;
    const jo = [-1.5, 1.4].every((z) => talalOldalrol(kerekMagassag, z));
    check(
      "a kerekek magassagaban oldalrol talal",
      jo,
      `y = ${kerekMagassag.toFixed(2)} m (a doboz alja ${(-H.y).toFixed(2)})`,
    );
  }

  // --- A TETO eltalalhato ---
  {
    check(
      "a teton is talal",
      talalOldalrol(H.y - 0.1, 0),
      `y = ${(H.y - 0.1).toFixed(2)} m, az auto kozepen`,
    );
  }

  // --- A MOTORHAZTETÖ FOLOTTI levego MAR NEM talalat ---
  //
  // Ez a valtozas erteke. A regi, egyetlen doboz vegig 4,91 m hosszu
  // volt a teto magassagaban is, tehat az orr folotti ures teren
  // athalado loves talalatnak szamitott.
  {
    const magas = H.y - 0.1;
    const hamisak: string[] = [];
    for (const z of [-H.z + 0.3, -H.z + 0.8, H.z - 0.3, H.z - 0.8]) {
      if (talalOldalrol(magas, z)) hamisak.push(`z=${z.toFixed(1)}`);
    }
    check(
      "az orr es a csomagtarto FOLOTT mar nem talal",
      hamisak.length === 0,
      hamisak.length === 0
        ? `a teto magassagaban (y=${magas.toFixed(2)}) csak a kabin talal`
        : `meg mindig talal itt: ${hamisak.join(", ")}`,
    );
  }

  // --- A KABIN MELLETTI levego sem talalat ---
  //
  // Ugyanez oldalirányban: a teto 1,56 m szeles, a doboz 2,18 volt.
  {
    const magas = H.y - 0.1;
    const oldalt = H.x - 0.1;
    check(
      "a teto MELLETT sem talal",
      !talalHosszaban(oldalt, magas) && !talalHosszaban(-oldalt, magas),
      `x = ±${oldalt.toFixed(2)} m (a teto fele szelessege ennel kisebb)`,
    );
  }

  // --- A RAKETA sugara tovabbra is szamit ---
  //
  // A raketa nem pontszeru: a felmereteket a sugaraval noveljuk. Ha ez
  // a tobb dobozra atirt valtozatbol kimaradna, a raketa surloasa
  // csendben nem robbanna.
  {
    const KICSIT_MELLE = H.x + 0.2;
    check(
      "a raketa sugara szamit (surlas is talalat)",
      segmentCarEntry([-20, 0, 0], [20, 0, 0], ALL, FORGATAS, 0) !== null &&
        segmentCarEntry(
          [KICSIT_MELLE, 0, -20],
          [KICSIT_MELLE, 0, 20],
          ALL,
          FORGATAS,
          0.5,
        ) !== null &&
        segmentCarEntry(
          [KICSIT_MELLE, 0, -20],
          [KICSIT_MELLE, 0, 20],
          ALL,
          FORGATAS,
          0,
        ) === null,
      `${KICSIT_MELLE.toFixed(2)} m-re elhaladva: 0,5 m sugarral talalat, pontszeruen nem`,
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
