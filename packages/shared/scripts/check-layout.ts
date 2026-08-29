/**
 * A palya ELRENDEZESE: elfer-e egyaltalan, amit leirtunk?
 *
 * Az epuleteket kezzel helyezzuk el (arenaLayout.ts), a meretuk viszont
 * a MODELLBOL jon. A ketto egyutt konnyen ad olyan eredmenyt, ami
 * papiron jonak tunik, a jatekban viszont hasznalhatatlan: egy raktar
 * pont egy spawn-pontra kerul, ket epulet egymasba lóg, vagy a palya
 * szele ele.
 *
 * Ez a teszt EZEKET zarja ki. Nem a szepseget iteli meg -- azt
 * kepernyokeppel nezzuk --, hanem azt, ami szamokkal eldontheto.
 *
 * Futtatas: npm run check:layout
 */
import { LARGEST_CAR_HALF } from "../src/carSizes";
import {
  ARENA_HALF,
  PROP_MERETEK,
  PROP_TALPAK,
  LAYOUT,
  PICKUP_POINTS,
  PICKUP_RADIUS,
  SCENERY,
  SPAWN_POINTS,
  layoutBoxes,
  perimeterPlacements,
  placementFootprint,
  type ArenaBox,
} from "../src/index";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

/** Egy doboz vizszintes hatarai. */
function hatarok(b: ArenaBox): { x0: number; x1: number; z0: number; z1: number } {
  return {
    x0: b.position.x - b.halfExtents.x,
    x1: b.position.x + b.halfExtents.x,
    z0: b.position.z - b.halfExtents.z,
    z1: b.position.z + b.halfExtents.z,
  };
}

/** Egy pont tavolsaga a doboztol (0, ha benne van). */
function tavolsag(b: ArenaBox, x: number, z: number): number {
  const h = hatarok(b);
  const dx = Math.max(h.x0 - x, 0, x - h.x1);
  const dz = Math.max(h.z0 - z, 0, z - h.z1);
  return Math.hypot(dx, dz);
}

function main(): void {
  console.log("=== Palya-elrendezes ===\n");

  const boxes = layoutBoxes();
  console.log(
    `  (${LAYOUT.length} epulet -> ${boxes.length} utkozo doboz, ` +
      `es ${SCENERY.length} latkep-elem a falon kivul)\n`,
  );

  // --- A forgatas csak derekszog lehet ---
  //
  // Ez nem stilus-kerdes: a loves sugarkovetese tengely-parhuzamos
  // dobozzal szamol, tehat ferde epuletnel a lovedek a levegoben allna
  // meg (lasd arenaLayout.ts).
  {
    const rossz = [...LAYOUT, ...SCENERY].filter(
      (p) => p.yaw !== undefined && p.yaw % 90 !== 0,
    );
    check(
      "minden epulet derekszogben all",
      rossz.length === 0,
      rossz.length === 0
        ? "0/90/180/270 fok"
        : rossz.map((p) => `${p.prop}: ${p.yaw}°`).join(", "),
    );
  }

  // --- A palyan belul van-e minden? ---
  {
    const kilog = boxes.filter((b) => {
      const h = hatarok(b);
      return (
        Math.abs(h.x0) > ARENA_HALF ||
        Math.abs(h.x1) > ARENA_HALF ||
        Math.abs(h.z0) > ARENA_HALF ||
        Math.abs(h.z1) > ARENA_HALF
      );
    });
    check(
      "egyetlen epulet sem log ki a palyarol",
      kilog.length === 0,
      kilog.length === 0
        ? `mind a ${ARENA_HALF} m-es hataron belul`
        : kilog.map((b) => b.name).join(", "),
    );
  }

  // --- Epuletek nem lóghatnak egymasba ---
  {
    const utkozok: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        // A nyitott szin ket oszlopsora szandekosan egy epulethez
        // tartozik -- azok nem erintkeznek, de ne is vizsgaljuk oket
        // egymas ellen.
        const a = hatarok(boxes[i]);
        const b = hatarok(boxes[j]);
        if (a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0) {
          utkozok.push(`${boxes[i].name} <-> ${boxes[j].name}`);
        }
      }
    }
    check(
      "az epuletek nem lognak egymasba",
      utkozok.length === 0,
      utkozok.length === 0 ? "nincs atfedes" : utkozok.slice(0, 4).join("; "),
    );
  }

  // --- SPAWN-pontok szabadon ---
  //
  // Egy epuletbe szuletett jatekos beszorul, vagy a palya ala esik. Az
  // auto fel-atlojanal nagyobb tavolsag kell, plusz rahagyas.
  {
    // A LEGNAGYOBB autoval: a szuletesi hely mindenkinek szabad kell
    // legyen, nem csak a sedannak.
    const kell = Math.hypot(LARGEST_CAR_HALF.x, LARGEST_CAR_HALF.z) + 1.5;
    const bajos: string[] = [];
    for (const s of SPAWN_POINTS) {
      for (const b of boxes) {
        const t = tavolsag(b, s.x, s.z);
        if (t < kell) bajos.push(`(${s.x},${s.z}) <- ${b.name}: ${t.toFixed(1)} m`);
      }
    }
    check(
      "minden spawn-pont szabadon all",
      bajos.length === 0,
      bajos.length === 0
        ? `mind a ${SPAWN_POINTS.length} pont legalabb ${kell.toFixed(1)} m-re`
        : bajos.slice(0, 4).join("; "),
    );
  }

  // --- PICKUP-ok elerhetok ---
  //
  // A pickup a talaj felett lebeg: ha egy epuletbe kerul, oda nem lehet
  // odahajtani, es a palyarol gyakorlatilag eltunik.
  {
    const kell = PICKUP_RADIUS + LARGEST_CAR_HALF.z;
    const bajos: string[] = [];
    for (const p of PICKUP_POINTS) {
      for (const b of boxes) {
        const t = tavolsag(b, p.x, p.z);
        if (t < kell) bajos.push(`${p.kind}(${p.x},${p.z}) <- ${b.name}: ${t.toFixed(1)} m`);
      }
    }
    check(
      "minden pickup megkozelitheto",
      bajos.length === 0,
      bajos.length === 0
        ? `mind a ${PICKUP_POINTS.length} pont legalabb ${kell.toFixed(1)} m-re`
        : bajos.slice(0, 4).join("; "),
    );
  }

  // --- A KOZEP nyitott marad ---
  //
  // Ez a valasztott palya-jelleg lenyege: a kozepen lehessen uldozni.
  // Ha ide nagy epulet kerulne, a palya utcakra esne szet.
  {
    const KOZEP_R = 12;
    const bent = boxes.filter((b) => {
      const h = hatarok(b);
      const dx = Math.max(h.x0, 0, -h.x1);
      const dz = Math.max(h.z0, 0, -h.z1);
      return Math.hypot(dx, dz) < KOZEP_R;
    });
    const nagy = bent.filter(
      (b) => b.halfExtents.x > 4 || b.halfExtents.z > 4,
    );
    check(
      "a palya kozepe nyitott marad",
      nagy.length === 0,
      nagy.length === 0
        ? `a ${KOZEP_R} m-es korben csak apro fedezek van (${bent.length} db)`
        : nagy.map((b) => b.name).join(", "),
    );
  }

  // --- A PALYAHATAR zart-e? ---
  //
  // A hatart mostantol epuletek adjak, nem egy sima fal. Ha ket epulet
  // kozott res marad, az auto egyszeruen kihajt a palyarol -- es ez a
  // fajta hiba nem latszik ranezesre, csak jatek kozben derul ki.
  {
    const hatarBoxok = layoutBoxes(perimeterPlacements(ARENA_HALF));

    // Minden oldalon vegigmegyunk, es megnezzuk, van-e olyan pont, ahol
    // egyetlen hataroló epulet sem all.
    const AUTO = LARGEST_CAR_HALF.x;
    const resek: string[] = [];
    const oldalak: [string, "x" | "z", number][] = [
      ["eszak", "z", -ARENA_HALF],
      ["del", "z", ARENA_HALF],
      ["nyugat", "x", -ARENA_HALF],
      ["kelet", "x", ARENA_HALF],
    ];
    for (const [nev, tengely, hol] of oldalak) {
      let leghosszabbRes = 0;
      let futoRes = 0;
      for (let t = -ARENA_HALF; t <= ARENA_HALF; t += 0.5) {
        const x = tengely === "z" ? t : hol;
        const z = tengely === "z" ? hol : t;
        // A hatar KIFELE esik: fel meterrel kintebb nezunk.
        const kx = tengely === "z" ? x : hol * 1.01;
        const kz = tengely === "z" ? hol * 1.01 : z;
        const fedve = hatarBoxok.some((b) => tavolsag(b, kx, kz) < 0.01);
        futoRes = fedve ? 0 : futoRes + 0.5;
        leghosszabbRes = Math.max(leghosszabbRes, futoRes);
      }
      if (leghosszabbRes > AUTO) {
        resek.push(`${nev}: ${leghosszabbRes.toFixed(1)} m res`);
      }
    }
    check(
      "a palyahatar zart -- nincs olyan res, amin kifer az auto",
      resek.length === 0,
      resek.length === 0
        ? `${hatarBoxok.length} hataroló epulet, mind a negy oldal fedve`
        : resek.join("; "),
    );
  }

  // --- A hataroló epuletek NEM vesznek el jatekteruletet ---
  //
  // A belso lapjuk a palyahataron all, a testuk kifele lóg. Ha
  // befele lognanak, eszrevetlenul szukitenek a palyat.
  {
    const hatarBoxok = layoutBoxes(perimeterPlacements(ARENA_HALF));
    const befele = hatarBoxok.filter((b) => {
      const h = hatarok(b);
      return (
        h.x0 < ARENA_HALF - 0.01 &&
        h.x1 > -ARENA_HALF + 0.01 &&
        h.z0 < ARENA_HALF - 0.01 &&
        h.z1 > -ARENA_HALF + 0.01
      );
    });
    check(
      "a hataroló epuletek nem lognak be a palyara",
      befele.length === 0,
      befele.length === 0
        ? "mind kifele all"
        : befele.map((b) => b.name).join(", "),
    );
  }

  // --- A mert alaprajz a MODELLEN BELUL marad ---
  //
  // A talp-teglalapok a modell alaprajzabol jonnek (kit-meret.ts). Ha
  // egy elcsuszna, utkozes lenne ott, ahol a modellnek nyoma sincs --
  // vagyis lathatatlan fal, csak eppen egy epulet MELLETT.
  {
    const kilog: string[] = [];
    for (const [nev, talpak] of Object.entries(PROP_TALPAK)) {
      const m = PROP_MERETEK[nev as keyof typeof PROP_MERETEK];
      if (!m) continue;
      for (const t of talpak) {
        // Fel cella rahagyas: a racs FELFELE kerekit (lasd kit-meret).
        if (
          Math.abs(t.dx) + t.szelesseg / 2 > m.szelesseg / 2 + 1 ||
          Math.abs(t.dz) + t.melyseg / 2 > m.melyseg / 2 + 1 ||
          t.magassag > m.magassag + 0.01
        ) {
          kilog.push(
            `${nev}: ${t.dx},${t.dz} (${t.szelesseg}x${t.melyseg}x${t.magassag})`,
          );
        }
      }
    }
    const db = Object.values(PROP_TALPAK).reduce((s, t) => s + t.length, 0);
    check(
      "minden talp-teglalap a modellen belul van",
      kilog.length === 0,
      kilog.length === 0
        ? `${db} teglalap ${Object.keys(PROP_TALPAK).length} modellre`
        : kilog.slice(0, 3).join("; "),
    );
  }

  // --- A dobozok MAGASSAGA koveti a modellt ---
  //
  // Minden doboz addig er fel, ameddig felette a modell tart -- nem a
  // modell teljes magassagaig. Ha a magassag-terkep csendben elromlik,
  // minden doboz a teljes magassagot kapja: a jatek ettol meg megy, de
  // a lovesek hazudnak, egy 1,4 m-es rakodoperon nyolcmeteres falkent
  // allitja meg a lovedeket. Merve: 165 dobozbol 123 alacsonyabb.
  {
    let alacsonyabb = 0;
    let osszes = 0;
    for (const [nev, talpak] of Object.entries(PROP_TALPAK)) {
      const m = PROP_MERETEK[nev as keyof typeof PROP_MERETEK];
      if (!m) continue;
      for (const t of talpak) {
        osszes++;
        if (t.magassag < m.magassag - 1) alacsonyabb++;
      }
    }
    // A FELE csak egy also korlat: a lenyeg, hogy ne EGYETLEN doboz
    // magassaga legyen a modell teteje.
    check(
      "a dobozok magassaga koveti a modellt",
      alacsonyabb > osszes / 2,
      `${alacsonyabb} / ${osszes} doboz alacsonyabb a modell tetejenel`,
    );
  }

  // --- Az ATHAJTHATO epuletek athajthatok maradnak ---
  //
  // Ez a talp-meres egesz ertelme. Ha a generalas elromlik es egyetlen
  // tomor dobozt ad vissza, a palya CSENDBEN visszaalakul: minden
  // jatszik tovabb, csak a viztorony megint tomor hasab lesz, es a
  // rakodoszinbe nem lehet behajtani. Ezert nezzuk meg konkretan.
  {
    const AUTO = LARGEST_CAR_HALF.x * 2;
    const bajos: string[] = [];
    for (const nev of ["Watertower_1", "Railroad_Loadbay_Shed_1"] as const) {
      const talpak = PROP_TALPAK[nev];
      const m = PROP_MERETEK[nev];
      // Vegighaladunk a kozepvonalon (z = 0), es megnezzuk, van-e
      // legalabb egy auto szelessegu szabad savja.
      let legjobb = 0;
      let futo = 0;
      for (let x = -m.szelesseg / 2; x <= m.szelesseg / 2; x += 0.1) {
        const utban = talpak.some(
          (t) =>
            Math.abs(x - t.dx) < t.szelesseg / 2 &&
            Math.abs(0 - t.dz) < t.melyseg / 2,
        );
        futo = utban ? 0 : futo + 0.1;
        legjobb = Math.max(legjobb, futo);
      }
      if (legjobb < AUTO) {
        bajos.push(`${nev}: ${legjobb.toFixed(1)} m (kell ${AUTO.toFixed(1)})`);
      }
    }
    check(
      "az athajthato epuletekben elfer az auto",
      bajos.length === 0,
      bajos.length === 0
        ? `a viztorony labai es a rakodoszin kozott van ${AUTO.toFixed(1)} m-nel szelesebb sav`
        : bajos.join("; "),
    );
  }

  // --- A latkep tenyleg a falon KIVUL van ---
  {
    const bent = SCENERY.filter((p) => {
      const f = placementFootprint(p);
      return (
        Math.abs(p.x) - f.szelesseg / 2 < ARENA_HALF &&
        Math.abs(p.z) - f.melyseg / 2 < ARENA_HALF
      );
    });
    check(
      "a latkep-elemek a falon kivul allnak",
      bent.length === 0,
      bent.length === 0
        ? "egyik sem er a palyara"
        : bent.map((p) => p.prop).join(", "),
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
