/**
 * A letoltott hangfelvetelek jatekba keszitese.
 *
 * MIERT SZKRIPT, es nem kezi munka egy hangszerkesztoben: a hangok
 * kulso forrasbol (freesound, Pixabay) jonnek, mindenfele
 * mintavetellel, hosszal es szinttel. Ha a keszitesuk csak "egyszer
 * megcsinaltam" lenne, a kovetkezo hangnal ujra kellene talalgatni,
 * mit is csinaltam az elozovel -- es a jatekban egymas mellett szolo
 * hangok szintje szethuzna. Igy viszont EGY helyen all, hogy melyik
 * hang milyen kezelest kap, es barmikor ujra lefuttathato.
 *
 * A muveletek MIND a felvetelen vegzett igazitasok (vagas, szint,
 * mono, loop) -- a hang vegig a valodi felvetel marad.
 *
 * Futtatas:  npm run audio -- "D:/Letöltések"
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { beolvas, kiir } from "./audio/wav";
import {
  csendetVag,
  dcTelenit,
  loopVarrat,
  monova,
  normalizal,
  ujramintavetel,
  uszat,
} from "./audio/muveletek";

/**
 * A jatek egysegesen 44.1 kHz-en dolgozik.
 *
 * A bongeszo ugyis atmintavetelezi a sajat hangkartya-ratajara, de ha
 * mi kulden-kulon ratakkal toltenenk be, minden hangnal mas minosegu
 * (es mas hibaju) atszamitas tortenne. Egy rata: kiszamithato eredmeny.
 */
const RATE = 44100;

interface Recept {
  /** A forrasfajl neve kiterjesztes nelkul. */
  nev: string;
  /** Loop-e (motor, csikorgas) -- ekkor varratot keszitunk. */
  loop?: boolean;
  /** Be- es kiuszatas (ms). */
  be?: number;
  ki?: number;
  /** Csucs-szint, amire normalizalunk (0..1). */
  szint?: number;
}

/**
 * Hangonkenti kezeles.
 *
 * A SZINTEK szandekosan ternek el, es nem a hangero-beallitast
 * helyettesitik: a normalizalas csak azt biztositja, hogy minden
 * felvetel ugyanarrol a szintrol induljon. A jatekbeli aranyokat
 * (mi szol hangosabban) a lejatszaskor allitjuk.
 */
const RECEPTEK: Recept[] = [
  // A motor FOLYAMATOSAN szol, tehat halkabban kell indulnia:
  // ugyanaz a csucsszint egy allando hangnal jóval tolakodóbb, mint
  // egy fel masodperces durranasnal.
  { nev: "motor", loop: true, szint: 0.7 },

  // A gepfegyver 90 ms-onkent szolal meg, a minta maga 93 ms -- tehat
  // a lovesek egymasba ernek. A kiuszatas rovid, hogy a kovetkezo
  // loves elott vegezzen, de eleg ahhoz, hogy a sorozat VEGE ne
  // kattanjon: a felvetel tele amplitudonal van elvagva.
  { nev: "gepfegyver", be: 1, ki: 4, szint: 0.75 },

  // A tulmelegedes rovid sisterges. A felvetel halk (csucs 0.15), a
  // normalizalas hozza fel -- de nem a lovesek szintjere: ez egy
  // ALLAPOT jelzese, nem esemeny, es nem szabad elnyomnia a harcot.
  { nev: "tulmelegedes", be: 2, ki: 30, szint: 0.8 },

  // A robbanas a jatek legnagyobb hangja, es ritka -- maradhat teljes
  // hosszan. A lecsengeset (a masodik pupot 450 ms korul: hullo
  // tormelek) SZANDEKOSAN megtartjuk: az adja a sulyat.
  { nev: "robbanas", be: 1, ki: 30, szint: 0.98 },

  // Az agyu ritkan szol (1.2 mp), tehat lehet hangos es hosszu. A
  // lecsengeset MEGTARTJUK -- az adja a fegyver sulyat --, csak a
  // mogotte levo néma reszt vagjuk le.
  { nev: "agyu", be: 1, ki: 20, szint: 0.95 },
];

function main(): void {
  const forras = process.argv[2];
  if (!forras) {
    console.error('Hasznalat: npm run audio -- "D:/Letöltések"');
    process.exit(1);
  }

  const cel = join(import.meta.dirname, "..", "public", "audio");
  if (!existsSync(cel)) mkdirSync(cel, { recursive: true });

  console.log("=== Hangok elokeszitese ===\n");
  let keszult = 0;

  for (const recept of RECEPTEK) {
    const be = join(forras, `${recept.nev}.wav`);
    if (!existsSync(be)) {
      console.log(`  KIHAGYVA ${recept.nev} -- nincs meg: ${be}`);
      continue;
    }

    const hang = beolvas(be);
    const eredetiHossz = hang.csatornak[0].length / hang.mintavetel;

    let minta = monova(hang.csatornak);
    minta = dcTelenit(minta);
    minta = csendetVag(minta);
    minta = ujramintavetel(minta, hang.mintavetel, RATE);
    if (recept.loop) minta = loopVarrat(minta, RATE);
    minta = uszat(minta, RATE, recept.be ?? 0, recept.ki ?? 0);
    minta = normalizal(minta, recept.szint ?? 0.89);

    const kiUt = join(cel, `${recept.nev}.wav`);
    kiir(kiUt, minta, RATE);

    const ujHossz = minta.length / RATE;
    console.log(
      `  ${recept.nev.padEnd(12)} ${hang.mintavetel} Hz/${hang.csatornak.length} csat, ` +
        `${eredetiHossz.toFixed(2)} mp  ->  ${RATE} Hz/mono, ${ujHossz.toFixed(2)} mp, ` +
        `${Math.round((minta.length * 2) / 1024)} kB` +
        (recept.loop ? "  [loop]" : ""),
    );
    keszult++;
  }

  console.log(`\n=== ${keszult} hang kesz (${cel}) ===`);
}

main();
