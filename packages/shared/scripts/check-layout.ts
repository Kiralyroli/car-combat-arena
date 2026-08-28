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
import {
  ARENA_HALF,
  CHASSIS,
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
    const kell = Math.hypot(CHASSIS.halfExtents.x, CHASSIS.halfExtents.z) + 1.5;
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
    const kell = PICKUP_RADIUS + CHASSIS.halfExtents.z;
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
    const AUTO = CHASSIS.halfExtents.x;
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
