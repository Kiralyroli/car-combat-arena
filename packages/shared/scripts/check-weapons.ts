/**
 * Fegyverek: tuzgyorsasag, tulmelegedes, celzasi irany, szoras.
 *
 * Mind tiszta szamtan, motor es halozat nelkul -- ezek a szamok adjak a
 * ket fegyver egyensulyat, tehat pontosan ezeket kell megvedeni.
 *
 * Futtatas: npm run check:weapons
 */
import { CHASSIS } from "../src/config";
import {
  MACHINEGUN,
  muzzleForwardOf,
  weaponMount,
  weaponPivot,
  WEAPON_IDS,
  weaponLabel,
  muzzleWorldPosition,
  aimDirection,
  applySpread,
  idleMachinegun,
  isWeaponId,
  stepMachinegun,
  toWeaponId,
} from "../src/weapons";
import { heatColor } from "../src/heatVisuals";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

/** A kliens szog-konvencioja (main.ts currentAim) -- ezt kell megforditani. */
function clientAim(dx: number, dy: number, dz: number): [number, number] {
  const horizontal = Math.hypot(dx, dz);
  return [Math.atan2(-dx, -dz), Math.atan2(dy, horizontal || 1e-4)];
}

/** Folyamatos tuzeles szimulalasa 60 Hz-es tickekkel. */
function fireFor(seconds: number): {
  shots: number;
  overheatedAt: number | null;
  heat: number;
} {
  let state = idleMachinegun();
  let now = 0;
  const dtMs = 1000 / 60;
  let shots = 0;
  let overheatedAt: number | null = null;

  for (let i = 0; i < Math.round(seconds * 60); i++) {
    now += dtMs;
    const result = stepMachinegun(state, true, now, dtMs);
    state = result.state;
    shots += result.shots;
    if (overheatedAt === null && state.overheated) overheatedAt = now / 1000;
  }
  return { shots, overheatedAt, heat: state.heat };
}

function main(): void {
  console.log("=== Fegyverek ===\n");

  // --- Fegyver-azonosito ---
  check(
    "ismeretlen fegyvernel agyura esunk vissza",
    toWeaponId("plazmaagyu") === "cannon" &&
      toWeaponId(undefined) === "cannon" &&
      toWeaponId(42) === "cannon",
    "a halozatrol barmi jöhet, hibat nem dobunk",
  );
  check(
    "a ket ervenyes fegyver atmegy",
    isWeaponId("cannon") && isWeaponId("machinegun"),
    "cannon, machinegun",
  );

  // --- Tuzgyorsasag ---
  {
    const oneSecond = fireFor(1);
    const expected = 1000 / MACHINEGUN.fireIntervalMs;
    check(
      "a tuzgyorsasag a beallitott utemet koveti",
      Math.abs(oneSecond.shots - expected) <= 1,
      `${oneSecond.shots} loves/mp (beallitva: ${expected.toFixed(1)})`,
    );
  }

  // --- Tulmelegedes ---
  {
    const long = fireFor(10);
    check(
      "folyamatos tuz tulmelegedeshez vezet",
      long.overheatedAt !== null,
      long.overheatedAt === null
        ? "sosem fullad le"
        : `${long.overheatedAt.toFixed(1)} mp utan`,
    );
    // Ket iranybol kell szoritani: eleg hosszu sorozatot engedjen ahhoz,
    // hogy a fegyver hasznalhato legyen, de ne annyit, hogy egyetlen
    // gombnyomva tartas ket autot is kiloljon.
    check(
      "a tulmelegedes nem azonnal jon",
      long.overheatedAt !== null && long.overheatedAt > 2,
      `${long.overheatedAt?.toFixed(1)} mp -- eleg hosszu sorozatot enged`,
    );
    const burstDamage =
      (long.overheatedAt ?? 0) * (1000 / MACHINEGUN.fireIntervalMs) * MACHINEGUN.damage;
    check(
      "egy sorozat nem lo ki ket teli autot",
      burstDamage < 200,
      `${burstDamage.toFixed(0)} sebzes egy sorozatban (egy auto: 100)`,
    );

    // A leallas erdemi buntetes legyen: 10 masodperc folyamatos
    // nyomvatartas alatt jocskan kevesebb loves fer bele, mint amennyi
    // korlatlan tuznel jönne.
    const unlimited = (10 * 1000) / MACHINEGUN.fireIntervalMs;
    check(
      "a tulmelegedes erdemben visszafogja a tuzet",
      long.shots < unlimited * 0.75,
      `${long.shots} loves a korlatlan ${unlimited.toFixed(0)} helyett`,
    );
  }

  // --- Kattintgatas nem gyorsabb a nyomva tartasnal ---
  //
  // A fegyver a nyomva tartasra keszult. Ha a le nem adott lovesek
  // felhalmozodnanak, egy szunet utani gombnyomas azonnal kiadna egy
  // egesz sorozatot -- merve NEGY lovest egyetlen tickben --, es a
  // gyors kattintgatas jobb lenne a nyomva tartasnal. Pont a
  // forditottja annak, amit a fegyver iger.
  {
    let state = idleMachinegun();
    let now = 0;
    const dtMs = 1000 / 60;
    let tapShots = 0;
    const taps = 10;

    for (let tap = 0; tap < taps; tap++) {
      // Egyetlen tick nyomva tartas...
      now += dtMs;
      const fired = stepMachinegun(state, true, now, dtMs);
      state = fired.state;
      tapShots += fired.shots;
      // ...majd fel masodperc szunet.
      for (let i = 0; i < 30; i++) {
        now += dtMs;
        state = stepMachinegun(state, false, now, dtMs).state;
      }
    }

    check(
      "kattintgatassal nem lehet tobb lovest kicsikarni",
      tapShots <= taps,
      `${tapShots} loves ${taps} kattintasbol`,
    );
  }
  // --- Hules es ujraindulas ---
  {
    // Felfutunk tulmelegedesig, majd elengedjuk a gombot.
    let state = idleMachinegun();
    let now = 0;
    const dtMs = 1000 / 60;
    while (!state.overheated && now < 20000) {
      now += dtMs;
      state = stepMachinegun(state, true, now, dtMs).state;
    }
    const overheatHeat = state.heat;

    let cooledAt: number | null = null;
    const releasedAt = now;
    while (cooledAt === null && now < releasedAt + 20000) {
      now += dtMs;
      state = stepMachinegun(state, false, now, dtMs).state;
      if (!state.overheated) cooledAt = (now - releasedAt) / 1000;
    }

    check(
      "tulmelegedeskor a hoszint a maximumon all",
      overheatHeat >= MACHINEGUN.maxHeat - 0.01,
      `${overheatHeat.toFixed(1)} / ${MACHINEGUN.maxHeat}`,
    );
    check(
      "tulmelegedes utan ujra tuzelhet, de varni kell ra",
      cooledAt !== null && cooledAt > 1 && cooledAt < 5,
      cooledAt === null ? "sosem hult le" : `${cooledAt.toFixed(1)} mp mulva`,
    );
  }

  // --- Tuz kozben nem indul ujra azonnal ---
  {
    let state = idleMachinegun();
    let now = 0;
    const dtMs = 1000 / 60;
    while (!state.overheated && now < 20000) {
      now += dtMs;
      state = stepMachinegun(state, true, now, dtMs).state;
    }
    // Tovabb nyomva tartva NEM szabad lonie.
    let shotsWhileOverheated = 0;
    for (let i = 0; i < 30; i++) {
      now += dtMs;
      const r = stepMachinegun(state, true, now, dtMs);
      state = r.state;
      shotsWhileOverheated += r.shots;
    }
    check(
      "tulmelegedve nem lo, akkor sem, ha nyomva tartjak",
      shotsWhileOverheated === 0,
      `${shotsWhileOverheated} loves fel masodperc alatt`,
    );
  }

  // --- Celzasi irany: a kliens konvenciojanak MEGFORDITASA ---
  {
    const cases: [number, number, number][] = [
      [0, 0, -10],
      [10, 0, 0],
      [-7, 3, 4],
      [0, 5, -5],
    ];
    let worst = 0;
    for (const [dx, dy, dz] of cases) {
      const length = Math.hypot(dx, dy, dz);
      const [yaw, pitch] = clientAim(dx, dy, dz);
      const dir = aimDirection(yaw, pitch);
      worst = Math.max(
        worst,
        Math.hypot(
          dir[0] - dx / length,
          dir[1] - dy / length,
          dir[2] - dz / length,
        ),
      );
    }
    check(
      "a celzasi irany visszafejtese pontos",
      worst < 1e-9,
      `legnagyobb elteres: ${worst.toExponential(1)}`,
    );

    // Kulon kimondva, mert egy elojel-hiba itt azt jelentene, hogy a
    // gepfegyver a celkereszttel ELLENTETES iranyba lo.
    const forward = aimDirection(0, 0);
    check(
      "nulla szognel elore (-Z) mutat",
      Math.abs(forward[2] + 1) < 1e-9 && Math.abs(forward[0]) < 1e-9,
      `[${forward.map((v) => v.toFixed(2)).join(", ")}]`,
    );
  }

  // --- A loves a FEGYVERBOL indul, nem az autobol ---
  //
  // Ez jatek kozben azonnal lathato hiba volt: a nyomjelzo a
  // lokharito magassagabol jott, nem a tetőn ülő csobol. A szam
  // magaban keveset mond, ezert a KAROSSZERIA TETEJEHEZ merjuk.
  //
  // MINDKET fegyverre kulon: sajat modelljuk van, sajat csohosszal.
  // Egy kozos ellenorzes atengedne azt a hibat, amikor csak az egyik
  // modell meretei csusznak el.
  for (const weapon of WEAPON_IDS) {
    const nev = weaponLabel(weapon);
    const roofAboveCenter = CHASSIS.halfExtents.y;
    const level: [number, number, number, number] = [0, 0, 0, 1];
    const forward: [number, number, number] = [0, 0, -1];

    const muzzle = muzzleWorldPosition([0, 0, 0], level, forward, weapon);
    check(
      `${nev}: a csotorkolat a karosszeria TETEJE folott van`,
      muzzle[1] > roofAboveCenter,
      muzzle[1].toFixed(2) + ' m a kozepponttol, a tetőszint ' + roofAboveCenter.toFixed(2) + ' m',
    );
    check(
      `${nev}: a torkolat elore all a fegyver forgaspontjatol`,
      Math.abs(muzzle[2] + muzzleForwardOf(weapon)) < 1e-9,
      muzzle[2].toFixed(2) + ' m (-Z = elore)',
    );

    // A torkolat a BOLINTASSAL egyutt fordul, es a forgasponttol mert
    // tavolsaga kozben allando marad. Ez az, ami feljogosit arra, hogy
    // a torkolatot EGYETLEN szammal irjuk le: ha a cso nem a tengely
    // magassagaban allna, a bolintas kozelebb-tavolabb vinne.
    const up = aimDirection(0, 0.6);
    const raised = muzzleWorldPosition([0, 0, 0], level, up, weapon);
    const pivot = weaponPivot([0, 0, 0], level, weapon);
    const sugar = Math.hypot(
      raised[0] - pivot[0],
      raised[1] - pivot[1],
      raised[2] - pivot[2],
    );
    check(
      `${nev}: a torkolat a bolintassal allando sugaron mozog`,
      Math.abs(sugar - muzzleForwardOf(weapon)) < 1e-9,
      sugar.toFixed(3) + ' m, varva ' + muzzleForwardOf(weapon).toFixed(3) + ' m',
    );

    // Az auto elfordulasaval a fuggoleges eltolas is fordul: a fegyver
    // a tetőre van rogzitve, nem a vilaghoz. Oldalara dolt autonal
    // tehat OLDALT kell lennie, nem folotte.
    const half = Math.SQRT1_2;
    const rolled: [number, number, number, number] = [0, 0, half, half];
    const tilted = muzzleWorldPosition([0, 0, 0], rolled, forward, weapon);
    check(
      `${nev}: a fegyver az autoval egyutt dol`,
      Math.abs(tilted[1]) < 1e-6 && Math.abs(tilted[0]) > 0.5,
      'oldalara dolve: x=' + tilted[0].toFixed(2) + ', y=' + tilted[1].toFixed(2),
    );
  }

  // --- A ket fegyver geometriaja tenyleg KULONBOZIK ---
  //
  // Ha a ket modell szamai veletlenul egybeesnenek (pl. masolas-hiba
  // miatt), a fenti ellenorzesek mind atmennenek, es eszrevetlen
  // maradna, hogy az egyik fegyver a masik meretei szerint lo.
  {
    const cannon = weaponMount("cannon");
    const mg = weaponMount("machinegun");
    check(
      "a ket fegyver csohossza kulonbozik",
      Math.abs(cannon.muzzleForward - mg.muzzleForward) > 0.1,
      `agyu: ${cannon.muzzleForward} m, gepfegyver: ${mg.muzzleForward} m`,
    );
  }
// --- A hoszint SZINE ---
  //
  // A szam onmagaban keveset mond harc kozben: a jatekos a szinbol
  // erzekeli, mennyire kozeli a lefulladas. A skalanak ezert egyirányban
  // kell haladnia, es a vegen tenyleg pirosnak kell lennie -- ez az,
  // amit egy kesobbi atszinezes csendben el tudna rontani.
  {
    const hue = (szin: string): number =>
      Number(szin.slice(4, szin.indexOf(",")));

    const lepesek = [0, 25, 50, 75, 100].map(heatColor);
    let monoton = true;
    for (let i = 1; i < lepesek.length; i++) {
      if (hue(lepesek[i]) > hue(lepesek[i - 1])) monoton = false;
    }
    check(
      "a hoszinttel egyre pirosabb, visszalepes nelkul",
      monoton,
      lepesek.map((sz, i) => `${i * 25}%: ${hue(sz)}`).join(", ") + " (szinarnyalat-fok)",
    );
    check(
      "nulla hoszinten zold",
      hue(heatColor(0)) > 90,
      heatColor(0),
    );
    check(
      "a maximumon piros",
      hue(heatColor(100)) < 15,
      heatColor(100),
    );
    // A skala SZANDEKOSAN nem lineáris: az also felen alig valtozik.
    // Enelkul a jatekos mar 40%-nal riadot latna, holott ott meg batran
    // tuzelhet.
    check(
      "a felso harmadban valtozik erdemben, nem az alsoban",
      hue(heatColor(50)) > hue(heatColor(100)) + 60 &&
        hue(heatColor(0)) - hue(heatColor(50)) < 40,
      `0%: ${hue(heatColor(0))}, 50%: ${hue(heatColor(50))}, 100%: ${hue(heatColor(100))}`,
    );
    check(
      "a hatarokon kivuli ertek sem torik el",
      heatColor(-20) === heatColor(0) && heatColor(500) === heatColor(100),
      "0 ala es 100 fole is levagva",
    );
  }

  // --- Szoras ---
  {
    const direction: [number, number, number] = [0, 0, -1];
    let maxAngle = 0;
    let sumX = 0;
    let sumY = 0;
    const samples = 4000;
    for (let i = 0; i < samples; i++) {
      const out = applySpread(
        direction,
        MACHINEGUN.spreadRad,
        Math.random(),
        Math.random(),
      );
      const dot = out[0] * direction[0] + out[1] * direction[1] + out[2] * direction[2];
      maxAngle = Math.max(maxAngle, Math.acos(Math.min(1, dot)));
      sumX += out[0];
      sumY += out[1];
    }
    check(
      "a szoras a beallitott kupon belul marad",
      maxAngle <= MACHINEGUN.spreadRad + 1e-6,
      `${(maxAngle * 1000).toFixed(2)} mrad (hatar: ${(MACHINEGUN.spreadRad * 1000).toFixed(2)})`,
    );
    // Ha a szoras elcsuszna egy iranyba, a fegyver rendszeresen melle
    // hordana -- ez halkan rontana a celzast, hiba nelkul.
    const biasX = Math.abs(sumX / samples);
    const biasY = Math.abs(sumY / samples);
    check(
      "a szoras nem huz egy iranyba",
      biasX < 0.001 && biasY < 0.001,
      `atlagos elteres: x=${biasX.toExponential(1)}, y=${biasY.toExponential(1)}`,
    );

    const none = applySpread(direction, 0, 0.7, 0.3);
    check(
      "nulla szorasnal pontosan az eredeti irany marad",
      none[0] === 0 && none[1] === 0 && none[2] === -1,
      `[${none.join(", ")}]`,
    );
  }

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
