/**
 * Kozvetlen kozelrol (falnak, ladanak) leadott agyu-loves.
 *
 * A JATEKOS PANASZA: "ha teljesen fal mellett vagyok es ralovok a
 * falra, akkor nem jelenik meg a lovedek es a hang sem". Vagyis a
 * loves NYOMTALANUL eltunik: a visszatoltes elfogy, es semmi nem
 * tortenik -- a jatekos nem tudja, mi lett a lovesevel.
 *
 * Ez a teszt a szerver oldalarol meri ugyanezt, bongeszo nelkul.
 *
 * Futtatas: npm run check:pointblank
 */
import {
  ARENA,
  ARENA_HALF,
  CAR_GEOMETRY,

  DEFAULT_CAR,
  EXPLOSION_MAX_DAMAGE,
  explosionFalloff,
  raycastBVH,
  type ClientState,
} from "@cca/shared";
import { arenaBVH } from "../src/simulation/collisionMesh";
import { RocketSimulation } from "../src/simulation/rockets";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const DT = 1 / 60;

function allapot(
  position: [number, number, number],
  aim: [number, number, number],
): ClientState {
  return {
    position,
    rotation: [0, 0, 0, 1],
    velocity: [0, 0, 0],
    aimYaw: 0,
    aimPitch: 0,
    firing: false,
    steer: 0,
    susp: [0, 0, 0, 0],
    seq: 0,
    ackTick: 0,
  } as unknown as ClientState;
}

/**
 * Egy loves lefuttatasa: hany kepkockan at LATSZOTT a raketa, es
 * volt-e robbanas.
 */
function loves(
  shooterPos: [number, number, number],
  target: [number, number, number],
): { lathato: number; robbanas: boolean; hol: number[] | null } {
  const sim = new RocketSimulation();
  const shooter = allapot(shooterPos, target);
  const raketa = sim.spawn("a", shooter, target, 1000);
  if (!raketa) return { lathato: 0, robbanas: false, hol: null };

  let lathato = 0;
  let robbanas = false;
  let hol: number[] | null = null;
  for (let i = 0; i < 120; i++) {
    // A snapshot a LEPES UTAN megy ki: ami ugyanabban a lepesben
    // szuletik es hal meg, azt a kliens sosem latja.
    const robbanasok = sim.step(DT, 1000 + i * DT * 1000, []);
    if (robbanasok.length > 0) {
      robbanas = true;
      hol = robbanasok[0].position;
      break;
    }
    if (sim.toSnapshot().length > 0) lathato++;
  }
  return { lathato, robbanas, hol };
}

function main(): void {
  console.log("=== Kozvetlen kozelrol leadott loves ===\n");

  // A DELI fal (wall_s) belso felulete. A kocsi nekitolatva all,
  // fel-hosszal a fal elott.
  const fal = ARENA.find((b) => b.name.startsWith("wall_"));
  console.log(
    `  (a palya fel-szelessege ${ARENA_HALF} m, fal: ${fal ? fal.name : "nincs"})\n`,
  );

  // --- 1. Szabad terepen minden rendben (viszonyitasi alap) ---
  {
    const eredmeny = loves([0, 1, 0], [0, 1.5, -40]);
    check(
      "szabad terepen latszik a lovedek",
      eredmeny.lathato > 3,
      `${eredmeny.lathato} kepkockan at`,
    );
  }

  // --- 2. Falhoz tolatva, a falra celozva ---
  //
  // A kocsi eleje EPP a falnal: a kozeppontja fel-hossznyira all tole.
  //
  // A LOVEDEK maga itt NEM fog latszani, es ez rendben van: 20 cm utat
  // tesz meg, ami egyetlen szerver-lepesnel is rovidebb. Ami szamit: a
  // lovesnek legyen LATHATO kovetkezmenye, a helyen -- vagyis robbanjon,
  // a palyan BELUL, a jatekos ELOTT. (A loves sajat hangjat a kliens
  // adja, a kattintaskor -- lasd main.ts fireAtCrosshair.)
  const falX = ARENA_HALF - CAR_GEOMETRY[DEFAULT_CAR].halfExtents.z;
  {
    const eredmeny = loves([0, 1, -falX], [0, 1.5, -ARENA_HALF]);
    check(
      "falhoz szorulva is elsul a loves",
      eredmeny.robbanas,
      eredmeny.robbanas
        ? "van robbanas"
        : "SEMMI nem tortent -- a loves nyomtalanul eltunt",
    );
    check(
      "a robbanas a PALYAN BELUL tortenik",
      eredmeny.hol !== null && Math.abs(eredmeny.hol[2]) <= ARENA_HALF + 1e-6,
      eredmeny.hol
        ? `z = ${eredmeny.hol[2].toFixed(2)} (a fal: ${-ARENA_HALF})`
        : "nem volt robbanas",
    );
    // ONSEBZES: a falnak lovo jatekos megkapja a sajat robbanasat.
    //
    // Ez SZANDEKOS, es a javitas kovetkezmenye: korabban a robbanas a
    // falon TUL tortent (4.35 m-re, 6 HP), most a fal LATHATO oldalan
    // (2.45 m, 15 HP). Vagyis a falnak loves mostantol tenyleges arral
    // jar -- de a jatekos LATJA is, mi tortent, es a robbanas helyebol
    // erti is. A korabbi allapot ennel rosszabb volt: sebzodott, es
    // semmi nem mutatta, miert.
    {
      const tav = ARENA_HALF - falX;
      const sebzes = Math.round(EXPLOSION_MAX_DAMAGE * explosionFalloff(tav));
      check(
        "a falnak loves onsebzest ad, de nem vegzeteset",
        sebzes > 0 && sebzes < 40,
        `${tav.toFixed(2)} m-rol ${sebzes} HP`,
      );
    }

    check(
      "a robbanas a jatekos ELOTT van, nem mogotte",
      eredmeny.hol !== null && eredmeny.hol[2] < -falX,
      eredmeny.hol
        ? `robbanas z = ${eredmeny.hol[2].toFixed(2)}, auto z = ${(-falX).toFixed(2)}`
        : "nem volt robbanas",
    );
  }

  // --- 3. Ladanak allva ---
  //
  // Nem csak a fal: barmelyik akadaly ugyanezt okozhatja, es azok a
  // palya kozepen vannak, ahol tenyleg harc folyik.
  {
    const lada = ARENA.find(
      (b) =>
        b.name !== "ground" &&
        !b.name.startsWith("wall_") &&
        b.position.y + b.halfExtents.y > 1.5,
    );
    if (!lada) {
      console.log("  (nincs eleg magas akadaly a teszthez)");
    } else {
      const elotte =
        lada.position.z +
        lada.halfExtents.z +
        CAR_GEOMETRY[DEFAULT_CAR].halfExtents.z;
      const eredmeny = loves(
        [lada.position.x, 1, elotte],
        [lada.position.x, 1.5, lada.position.z + lada.halfExtents.z],
      );
      check(
        "akadalynak allva is elsul a loves",
        eredmeny.robbanas,
        eredmeny.robbanas ? `van robbanas (${lada.name})` : `SEMMI (${lada.name})`,
      );
      // A robbanas az akadaly LATHATO felszinen legyen, ne mogotte.
      //
      // A VISZONYITAS a modell elso haromszoge, nem a doboz szele: a
      // loves mostantol a valodi alakkal utkozik, es a doboz ennel
      // BŐKEZŰBB. Merve: a hataroló epulet doboza z = -60-nal kezdodik,
      // a fala viszont csak -60,34 es -61,26 kozott -- vagyis a doboz
      // egy meterrel a fal ELOTT allitotta meg a raketat.
      //
      // Ez tovabbra sem tautologia: azt zarja ki, hogy a raketa
      // ATHALADJON a falon es mogotte robbanjon.
      const honnan: [number, number, number] = [lada.position.x, 1.5, elotte];
      const meddig: [number, number, number] = [lada.position.x, 1.5, elotte - 30];
      const elsoTalalat = raycastBVH(arenaBVH(), honnan, meddig, 0);
      const felszinZ =
        elsoTalalat === null ? lada.position.z + lada.halfExtents.z : elotte - 30 * elsoTalalat;
      // Fel meter rahagyas: a raketa sugara (0,6 m) miatt a becsapodas
      // pontja kicsit a felszin elott is lehet.
      const kivul =
        eredmeny.hol !== null && eredmeny.hol[2] >= felszinZ - 0.5;
      check(
        "a robbanas az akadaly LATHATO oldalan van",
        kivul,
        eredmeny.hol
          ? `robbanas z = ${eredmeny.hol[2].toFixed(2)}, a modell felszine ${felszinZ.toFixed(2)} (a doboz szele ${(lada.position.z + lada.halfExtents.z).toFixed(2)})`
          : "nem volt robbanas",
      );
    }
  }

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
