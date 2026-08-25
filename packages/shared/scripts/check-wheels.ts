/**
 * Kerek-serules szabalyok (terv 4. lepcso 6. pont).
 *
 * A serules eddig KLIENS-oldali volt (1-4 gombok), es csak latvanykent
 * ment at a halozaton -- vagyis mindenki maga dontotte el, letort-e a
 * kereke. Most a szerver birtokolja, ugyanugy, mint a body HP-t.
 *
 * A meresek kozul a masodik csoport a fontosabb: hogy a robbanas HELYE
 * szamit-e. Ha kozeppontbol szamolnank a tavolsagot, mind a negy kerek
 * egyszerre tornek le -- a jatekosnak veletlenszerunek tunne, es a
 * pontos celzasnak nem lenne jutalma.
 *
 * Futtatas: npm run check:wheels
 */
import {
  brokenMaskOf,
  damageWheel,
  gripsOf,
  healthyWheels,
  wheelExplosionDamage,
  wheelsFromNetwork,
  wheelWorldPosition,
  regenerateWheel,
  WHEEL_MAX_HP,
  WHEEL_REGEN_DELAY_MS,
  WHEEL_REMOUNT_HP,
} from "../src/wheelDamage";
import { HEALTHY_WHEEL, type WheelDamage } from "../src/types";
import { EXPLOSION_RADIUS } from "../src/rocket";
import { WHEEL_LAYOUT } from "../src/config";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

/** Egy robbanas hatasa mind a negy kerekre, allo (0 fokos) autonal. */
function damageAll(
  carPosition: [number, number, number],
  explosion: [number, number, number],
): number[] {
  return WHEEL_LAYOUT.map((_, i) => {
    const wheel = wheelWorldPosition(carPosition, [0, 0, 0, 1], i);
    return wheelExplosionDamage(
      Math.hypot(
        wheel[0] - explosion[0],
        wheel[1] - explosion[1],
        wheel[2] - explosion[2],
      ),
    );
  });
}

function main(): void {
  console.log("=== Kerek-serules ===\n");

  console.log("Sebzes es tapadas:");

  const healthy = healthyWheels();
  check(
    "az uj auto negy kereke ep",
    healthy.length === 4 &&
      healthy.every((w) => !w.broken && w.gripMultiplier === 1),
    `${healthy.length} kerek, mind ep`,
  );

  const hurt = damageWheel(healthy[0], 40);
  check(
    "a serules aranyosan csokkenti a tapadast",
    !hurt.broken && Math.abs(hurt.gripMultiplier - 0.6) < 0.01,
    `${WHEEL_MAX_HP} -> ${hurt.hp} HP, tapadas ${hurt.gripMultiplier.toFixed(2)}`,
  );

  const broken = damageWheel(hurt, 100);
  check(
    "eleg sebzes eseten letorik, es nincs tapadasa",
    broken.broken && broken.gripMultiplier === 0 && broken.hp === 0,
    `tort: ${broken.broken}, tapadas: ${broken.gripMultiplier}`,
  );
  check(
    "a mar letort kereket nem sebzi tovabb",
    damageWheel(broken, 50) === broken,
    "valtozatlan marad",
  );

  console.log("\nA robbanas HELYE szamit:");

  // Az auto a kezdopontban all, orral -Z fele. A robbanas kozvetlenul
  // az ORR elott van: az elso kerekeket kell levinnie, a hatsokat alig.
  const car: [number, number, number] = [0, 0, 0];
  const front = damageAll(car, [0, 0, -2.5]);

  check(
    "az orr elotti robbanas az ELSO kerekeket sebzi jobban",
    Math.min(front[0], front[1]) > Math.max(front[2], front[3]),
    `elso: ${front[0]}/${front[1]}, hatso: ${front[2]}/${front[3]}`,
  );

  // Oldalso robbanas: a BAL oldali kerekeket kell jobban sebeznie.
  const left = damageAll(car, [-2.5, 0, 0]);
  check(
    "az oldalso robbanas a KOZELEBBI oldalt sebzi jobban",
    Math.min(left[0], left[2]) > Math.max(left[1], left[3]),
    `bal: ${left[0]}/${left[2]}, jobb: ${left[1]}/${left[3]}`,
  );

  check(
    "a hatosugaron kivuli robbanas egy kereket sem sebez",
    damageAll(car, [0, 0, -(EXPLOSION_RADIUS + 10)]).every((d) => d === 0),
    `${EXPLOSION_RADIUS + 10} m-rol nulla`,
  );

  // A forgatas nelkuli valtozat kiszurese: 90 fokra fordult autonal az
  // "orr elotti" pont mar OLDALT van, tehat mas kerekeket kell erintenie.
  const turnedFront = WHEEL_LAYOUT.map((_, i) => {
    const half = (90 * Math.PI) / 180 / 2;
    const wheel = wheelWorldPosition(car, [0, Math.sin(half), 0, Math.cos(half)], i);
    return wheelExplosionDamage(
      Math.hypot(wheel[0] - 0, wheel[1] - 0, wheel[2] - -2.5),
    );
  });
  check(
    "az auto elfordulasaval a kerekek is fordulnak",
    Math.abs(turnedFront[0] - front[0]) > 1,
    `allo autonal ${front[0]}, 90 fokra fordulva ${turnedFront[0]} (FL kerek)`,
  );

  console.log("\nHalozati atvitel:");

  const wheels = healthyWheels();
  wheels[1] = damageWheel(wheels[1], 100);
  wheels[2] = damageWheel(wheels[2], 30);

  const mask = brokenMaskOf(wheels);
  const grips = gripsOf(wheels);
  check(
    "a bitmaszk a tort kerekeket jeloli",
    mask === 0b0010,
    `maszk = ${mask.toString(2).padStart(4, "0")} (csak az FR tort)`,
  );

  const restored = wheelsFromNetwork(grips, mask);
  check(
    "a visszafejtes ugyanazt az allapotot adja",
    restored.every(
      (w, i) =>
        w.broken === wheels[i].broken &&
        Math.abs(w.gripMultiplier - wheels[i].gripMultiplier) < 0.01,
    ),
    "mind a negy kerek egyezik",
  );

  // --- REGENERALODAS harcon kivul ---
  //
  // A serules korabban visszafordithatatlan volt egy eleten belul: a
  // kerekek csak ujraszuleteskor gyogyultak. Ez a jatekost arra
  // osztonozte, hogy szandekosan meghaljon.
  {
    const step = (w: WheelDamage, seconds: number): WheelDamage =>
      regenerateWheel(w, seconds * 1000);

    // Ep kerek nem valtozik -- felesleges munkat sem vegzunk.
    const healthy = { ...HEALTHY_WHEEL };
    check(
      "az ep kerek valtozatlan marad",
      step(healthy, 1) === healthy,
      "ugyanaz a peldany ter vissza",
    );

    // Serult (de nem tort) kerek gyogyul, es a tapadasa is no.
    const hurt: WheelDamage = { hp: 50, broken: false, gripMultiplier: 0.5 };
    const healed = step(hurt, 2);
    check(
      "a serult kerek gyogyul, a tapadasaval egyutt",
      healed.hp > hurt.hp && healed.gripMultiplier > hurt.gripMultiplier,
      `${hurt.hp} -> ${healed.hp.toFixed(0)} HP, tapadas ${healed.gripMultiplier.toFixed(2)}`,
    );

    // A LETORT kerek nem attol mukodik ujra, hogy elkezdett gyogyulni:
    // a kuszob alatt a tapadasa NULLA marad. Enelkul a rakéta hatasa
    // egy pillanat alatt semmive valna.
    let broken: WheelDamage = { hp: 0, broken: true, gripMultiplier: 0 };
    const early = step(broken, 1);
    check(
      "a letort kerek nem all vissza azonnal",
      early.broken && early.gripMultiplier === 0,
      `${early.hp.toFixed(0)} HP-nal meg tort (kuszob: ${WHEEL_REMOUNT_HP})`,
    );

    // ...de vegul visszaall.
    let seconds = 0;
    while (broken.broken && seconds < 30) {
      broken = step(broken, 0.5);
      seconds += 0.5;
    }
    check(
      "a letort kerek vegul visszaall",
      !broken.broken && seconds < 10,
      `${seconds.toFixed(1)} mp alatt`,
    );

    // A teljes helyreallas erezhetoen tovabb tart -- kulonben a
    // kiszallas kockazata nem allna aranyban a nyereseggel.
    let full: WheelDamage = { hp: 0, broken: true, gripMultiplier: 0 };
    let total = 0;
    while (full.hp < WHEEL_MAX_HP && total < 60) {
      full = step(full, 0.5);
      total += 0.5;
    }
    check(
      "a teljes helyreallas erdemi idot vesz igenybe",
      total >= 8 && total <= 20,
      `${total.toFixed(1)} mp nullarol, plusz ${WHEEL_REGEN_DELAY_MS / 1000} mp varakozas`,
    );

    // A gyogyulas nem lephet a maximum fole.
    check(
      "a gyogyulas nem lepi tul a maximumot",
      full.hp === WHEEL_MAX_HP && full.gripMultiplier === 1,
      `${full.hp} HP, tapadas ${full.gripMultiplier}`,
    );
  }
  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
