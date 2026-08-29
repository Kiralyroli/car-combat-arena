/**
 * Az AUTOK talalati dobozai -- MIND A TIZE.
 *
 * A talalatot korabban egyetlen doboz dontotte el, ES ugyanaz a doboz
 * minden jatekosnal (a Sedane). Most autonkent mert, szeletekbol allo
 * test van (carGeometry.ts), es ez kozvetlenul a jatekmenetet
 * valtoztatja: ami eddig talalat volt a motorhaztetö FOLOTT, az mar
 * nem az -- a pickup platoja folott sem.
 *
 * Ket iranyba is el lehet rontani, es MINDKETTO csendes:
 *
 *  - ha a dobozok tul kicsik, a jatekos rendre "atlo" az ellenfelen,
 *  - ha valamelyik kilog a sajat autojabol, valaki eszrevetlenul
 *    eltalalhatobb lesz, mint amekkorat lat.
 *
 * A harmadik csendes hiba a generalasban van: ha az auto-meret nem fut
 * le, minden kocsi a Sedan meretet kapja, es a kulonbseg eltunik. Az
 * ELSO teszt eppen ezt zarja ki.
 *
 * Futtatas: npm run check:carbox
 */
import {
  CAR_GEOMETRY,
  CAR_MODELS,
  WHEEL,
  segmentCarEntry,
  type CarId,
} from "../src/index";

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
function talalOldalrol(car: CarId, y: number, z: number): boolean {
  return (
    segmentCarEntry([-20, y, z], [20, y, z], ALL, FORGATAS, 0, car) !== null
  );
}

/** A tesztek egy autora. Ami itt bukik, azt az autoval jeloljuk. */
function autotEllenoriz(car: CarId): void {
  const g = CAR_GEOMETRY[car];
  const H = g.halfExtents;
  const cimke = (s: string) => `[${car}] ${s}`;

  // --- Egyik doboz sem lóg ki az UTKOZO dobozbol ---
  //
  // Ez a valtozas alapszabalya: csak elvenni szabad a hamis
  // talalatokbol, hozzaadni nem. Kulonben eszrevetlenul kerulne be egy
  // "nagyobb lett a hitbox" valtozas -- amit a jatekos csak annyibol
  // erzekelne, hogy a semmibe leadott loves talal.
  {
    const kilog = g.hitBoxes.filter(
      (b) =>
        Math.abs(b.dx) + b.hx > H.x + 1e-6 ||
        Math.abs(b.dy) + b.hy > H.y + 1e-6 ||
        Math.abs(b.dz) + b.hz > H.z + 1e-6,
    );
    check(
      cimke("egyik doboz sem lóg ki az utkozo dobozbol"),
      kilog.length === 0,
      kilog.length === 0
        ? `${g.hitBoxes.length} doboz, mind a ${(H.x * 2).toFixed(2)} x ${(H.y * 2).toFixed(2)} x ${(H.z * 2).toFixed(2)} m-en belul`
        : `${kilog.length} doboz kilog`,
    );
  }

  // --- Az autoban NINCS LYUK ---
  //
  // Ez a rosszabbik hiba a kettobol: ha a szeletek osszevonasa lyukat
  // hagy, a jatekos rendre "atlo" az ellenfelen, es ezt semmi nem
  // jelzi. Az ellenorzes: minden magassagban EGYETLEN, osszefuggo
  // szakasz talalhato -- ket szakasz kozott ugyanis at lehetne loni.
  //
  // NEM lefedettseget merunk minden magassagban: az orr es a far lejt,
  // a teto rovid, tehat felfele haladva egyre kevesebb az auto. Az a
  // helyes viselkedes, nem lyuk. A lyuk attol lyuk, hogy a talalat
  // KETTEVALIK.
  //
  // A magassagok az auto SAJAT meretebol jonnek: a sportkocsi 1,17 m, a
  // SUV 1,95 -- egy fix y-lista az egyiknel a tetot, a masiknal a
  // kerekeket merne.
  {
    const kerekTeteje = g.wheels[0].y + WHEEL.radius;
    const bajos: string[] = [];
    for (let i = 0; i < 12; i++) {
      const y = kerekTeteje + ((i + 0.5) / 12) * (H.y - kerekTeteje);
      let futamok = 0;
      let elozo = false;
      for (let z = -H.z; z <= H.z; z += 0.05) {
        const van = talalOldalrol(car, y, z);
        if (van && !elozo) futamok++;
        elozo = van;
      }
      if (futamok > 1) bajos.push(`y=${y.toFixed(2)}: ${futamok} szakasz`);
    }
    check(
      cimke("nincs lyuk az auton, amin at lehetne loni"),
      bajos.length === 0,
      bajos.length === 0
        ? "12 magassagban mindenhol egyetlen osszefuggo szakasz"
        : bajos.join(", "),
    );
  }

  // --- A KEREKEK FOLOTT tomor a karosszeria ---
  //
  // A masik irany: ha a talalati test tul szuk lenne, a hossz java
  // reszen nem lehetne eltalalni az autot. Kozvetlenul a kerekek
  // folott az auto szinte vegig tomor -- ami hianyzik, az a lejto orr
  // es far csucse.
  {
    const y = g.wheels[0].y + WHEEL.radius + 0.05;
    let talalt = 0;
    let ossz = 0;
    for (let z = -H.z; z <= H.z; z += 0.05) {
      ossz++;
      if (talalOldalrol(car, y, z)) talalt++;
    }
    const arany = talalt / ossz;
    check(
      cimke("a kerekek folott vegig talalhato"),
      arany >= 0.9,
      `y = ${y.toFixed(2)} m-en a hossz ${Math.round(100 * arany)}%-a`,
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
        car,
      );
      if (t === null) rossz.push(`${Math.round((a * 180) / Math.PI)}°`);
    }
    check(
      cimke("a kozeppontra celozva minden iranybol talal"),
      rossz.length === 0,
      rossz.length === 0 ? "mind a 16 irany" : rossz.join(", "),
    );
  }

  // --- A KEREKEK eltalalhatok ---
  //
  // A kerekek kulon sebzodnek, tehat celozni lehet rajuk. Ha a meres
  // csak a karosszeriat nezne, az also szelet keskenyebb lenne a
  // valosnal, es az oldalrol a kerekre adott loves elszallna az auto
  // alatt.
  {
    const kerekMagassag = -H.y + 0.15;
    // A kerekek az auto vegei fele allnak -- a sajat kerekhelyeit
    // kerdezzuk meg, nem beirt szamokat.
    const zk = [...new Set(g.wheels.map((w) => w.z))];
    const rossz = zk.filter((z) => !talalOldalrol(car, kerekMagassag, z));
    check(
      cimke("a kerekek magassagaban oldalrol talal"),
      rossz.length === 0,
      `y = ${kerekMagassag.toFixed(2)} m, z = ${zk.map((z) => z.toFixed(2)).join(" / ")}`,
    );
  }

  // --- A TETO eltalalhato ---
  {
    check(
      cimke("a teton is talal"),
      talalOldalrol(car, H.y - 0.1, 0),
      `y = ${(H.y - 0.1).toFixed(2)} m, az auto kozepen`,
    );
  }

  // --- Az ORR es a FAR FOLOTTI levego MAR NEM talalat ---
  //
  // Ez a valtozas erteke. A regi, egyetlen doboz a teto magassagaban is
  // vegig az auto teljes hossza volt, tehat az orr folotti ures teren
  // athalado loves talalatnak szamitott.
  {
    const magas = H.y - 0.1;
    const hamisak: string[] = [];
    for (const z of [-H.z + 0.15, H.z - 0.15]) {
      if (talalOldalrol(car, magas, z)) hamisak.push(`z=${z.toFixed(2)}`);
    }
    check(
      cimke("az orr es a far FOLOTT mar nem talal"),
      hamisak.length === 0,
      hamisak.length === 0
        ? `a teto magassagaban (y=${magas.toFixed(2)}) csak a kabin talal`
        : `meg mindig talal itt: ${hamisak.join(", ")}`,
    );
  }

  // --- A talalati test tenyleg KOVETI az alakot ---
  //
  // Ha a szeletek osszevonasa elromlik, a vegeredmeny egyetlen, teljes
  // doboz lesz -- a tesztek tobbsege ettol meg atmenne, csak eppen
  // visszakapnank a regi, bőkezű talalatot. A kitoltes ezt meri: az
  // autok 68-79% kozott vannak, egyetlen doboz 100% lenne.
  {
    const vol = g.hitBoxes.reduce((s, b) => s + 8 * b.hx * b.hy * b.hz, 0);
    const arany = vol / (8 * H.x * H.y * H.z);
    check(
      cimke("a talalati test szűkebb az utkozo doboznal"),
      arany < 0.85,
      `a doboz terfogatanak ${Math.round(arany * 100)}%-a`,
    );
  }
}

function main(): void {
  console.log("=== Auto talalati dobozok ===\n");

  // --- MINDEN autonak SAJAT merete van ---
  //
  // Ha az auto-meret generalas elmarad vagy felresikerul, a legkonnyebb
  // vegeredmeny az, hogy minden kocsi ugyanazt a dobozt kapja. A jatek
  // menne tovabb, csak a pickup platojan at lehetne loni, a kisauto
  // korul meg a levegobe.
  {
    const meretek = new Set(
      CAR_MODELS.map((m) => {
        const H = CAR_GEOMETRY[m.id].halfExtents;
        return `${H.x}|${H.y}|${H.z}`;
      }),
    );
    check(
      "minden autonak sajat merete van",
      meretek.size === CAR_MODELS.length,
      `${meretek.size} kulonbozo meret ${CAR_MODELS.length} autohoz`,
    );

    // A MERETKULONBSEG valoban szamit: ha a generalas elmaradna, mind a
    // negy kocsi ugyanakkora lenne, es a valasztas csak latvany volna.
    // A negy jarmu 4,1 es 4,9 m kozott van -- fel meternel nagyobb
    // kulonbseg mar erezheto a palya szuk helyein.
    const hosszak = CAR_MODELS.map((m) => CAR_GEOMETRY[m.id].halfExtents.z * 2);
    const magassagok = CAR_MODELS.map((m) => CAR_GEOMETRY[m.id].halfExtents.y * 2);
    check(
      "a meretkulonbseg valoban szamit",
      Math.max(...hosszak) - Math.min(...hosszak) > 0.5 &&
        Math.max(...magassagok) - Math.min(...magassagok) > 0.5,
      `hossz ${Math.min(...hosszak).toFixed(2)}-${Math.max(...hosszak).toFixed(2)} m, ` +
        `magassag ${Math.min(...magassagok).toFixed(2)}-${Math.max(...magassagok).toFixed(2)} m`,
    );
  }

  // --- MINDEN modell SAJAT kereke ---
  //
  // A kerekek merete a modellbol jon: ha egyetlen kozos sugarra
  // esnenek vissza, a nagy kerekű terepjaro kereke a karosszeriaba
  // erne, a kisebbe pedig lebegne a talaj folott.
  {
    const sugarak = CAR_MODELS.map((m) => CAR_GEOMETRY[m.id].wheels[0].radius);
    check(
      "a kerekek merete modellenkent mas",
      new Set(sugarak.map((r) => r.toFixed(3))).size === CAR_MODELS.length,
      sugarak.map((r, i) => `${CAR_MODELS[i].id}: ${(r * 2).toFixed(2)} m`).join(", "),
    );

    // A LEGALSO kerek eri a talajt (a doboz aljat), es EGYIK SEM log
    // ala. Nem mindegyik er le: az izomauto hatso kereke nagyobb az
    // elsonel, tehat a ket tengely nem egy szinten all -- ez a modell
    // sajatja, nem hiba. A hiba az volna, ha az EGESZ kocsi lebegne
    // vagy belesullyedne a talajba.
    const bajos = CAR_MODELS.filter((m) => {
      const g = CAR_GEOMETRY[m.id];
      const aljak = g.wheels.map((w) => w.y - w.radius);
      const legalso = Math.min(...aljak);
      return (
        Math.abs(legalso + g.halfExtents.y) > 0.01 ||
        aljak.some((a) => a < -g.halfExtents.y - 0.01)
      );
    });
    check(
      "a kerekek a talajon allnak",
      bajos.length === 0,
      bajos.length === 0
        ? CAR_MODELS.map((m) => {
            const g = CAR_GEOMETRY[m.id];
            const legalso = Math.min(...g.wheels.map((w) => w.y - w.radius));
            return `${m.id}: ${(legalso + g.halfExtents.y).toFixed(3)} m`;
          }).join(", ")
        : bajos.map((m) => m.id).join(", "),
    );
  }

  console.log("");
  for (const modell of CAR_MODELS) {
    autotEllenoriz(modell.id);
  }

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
