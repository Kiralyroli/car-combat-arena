/**
 * Ujraszuletes: hova kerul a jatekos, es mennyire biztonsagos az.
 *
 * A regi valasztas az elso szabad pontot adta, es az ellenfelek helyet
 * egyaltalan nem nezte -- ket jatekosnal kiszamithatoan oszcillalt, tehat
 * par halal utan az ellenfel megtanulta, hol fogsz megjelenni. Ez a
 * teszt pontosan azt vedi, ami ezt megszunteti.
 *
 * SZANDEKOSAN tiszta szamtan: a valasztas szabalyait motor es halozat
 * nelkul kell tudni merni, kulonben minden hangolashoz ket bongeszot
 * kellene inditani.
 *
 * Futtatas: npm run check:spawn
 */
import { SPAWN_POINTS } from "../src/config";
import { MACHINEGUN } from "../src/weapons";
import { RESPAWN_DELAY_MS } from "../src/match";
import {
  SPAWN_PROTECTION_MS,
  pickSpawnIndex,
  shouldRepickSpawn,
  spawnSafety,
  type SpawnThreat,
} from "../src/spawn";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

/** A kliens szog-konvencioja: yaw = atan2(-dx, -dz). */
function aimingAt(
  from: readonly [number, number, number],
  to: { x: number; y: number; z: number },
): SpawnThreat {
  const dx = to.x - from[0];
  const dz = to.z - from[2];
  return {
    position: from,
    aimYaw: Math.atan2(-dx, -dz),
    aimPitch: 0,
  };
}

const all = SPAWN_POINTS.map((_, i) => i);

function main(): void {
  console.log("=== Ujraszuletes ===\n");

  // --- A palya-geometria, ami az egesz tervezest meghatarozza ---
  //
  // Ezt kulon kimondjuk: ha valaki kesobb atmeretezi az arenat vagy a
  // spawn-gyurut, itt derul ki, hogy a "szulessen tavolabb" strategia
  // mikor kezd egyaltalan mukodni.
  {
    let max = 0;
    for (let i = 0; i < SPAWN_POINTS.length; i++) {
      for (let j = i + 1; j < SPAWN_POINTS.length; j++) {
        max = Math.max(
          max,
          Math.hypot(
            SPAWN_POINTS[i].x - SPAWN_POINTS[j].x,
            SPAWN_POINTS[i].z - SPAWN_POINTS[j].z,
          ),
        );
      }
    }
    check(
      "minden spawn-pont lotavolsagon belul van (ezert kell a vedelem)",
      max < MACHINEGUN.range,
      `legtavolabbi ket pont: ${max.toFixed(1)} m, gepfegyver: ${MACHINEGUN.range} m`,
    );
  }

  // --- A tavolsag szamit ---
  {
    // Egy ellenfel a (22, 0) spawn-pont mellett all, es arra is nez.
    const threat = aimingAt([22, 1, 0], SPAWN_POINTS[0]);
    const chosen = pickSpawnIndex(all, [threat], null, () => 0);
    const distance = Math.hypot(
      SPAWN_POINTS[chosen].x - 22,
      SPAWN_POINTS[chosen].z - 0,
    );
    check(
      "nem szuletunk ujja az ellenfel oleben",
      distance > 25,
      `a valasztott pont ${distance.toFixed(1)} m-re van tole`,
    );
  }

  // --- A CELZAS iranya szamit, nem csak a tavolsag ---
  //
  // Ez a lenyeg ezen a palyan: mivel minden pont lotavon belul van, a
  // "merre nez" kulonbozteti meg a biztonsagosat a halalosstol.
  {
    const point = SPAWN_POINTS[0];
    const from: [number, number, number] = [0, 1, 0];

    const looking = spawnSafety(point, [aimingAt(from, point)]);
    const away = spawnSafety(point, [
      { position: from, aimYaw: aimingAt(from, point).aimYaw + Math.PI, aimPitch: 0 },
    ]);

    check(
      "a rad celzo ellenfel veszelyesebb, mint az elfordulo",
      away - looking > 15,
      `elfordulva ${away.toFixed(1)} m, rad celozva ${looking.toFixed(1)} m`,
    );
  }

  // --- Ahol meghaltunk, oda ne ---
  {
    const deathAt = SPAWN_POINTS[3];
    const withoutDeath = spawnSafety(deathAt, []);
    const withDeath = spawnSafety(deathAt, [], [deathAt.x, deathAt.y, deathAt.z]);
    check(
      "a sajat halalunk helye buntetest kap",
      withoutDeath - withDeath > 20,
      `${withoutDeath.toFixed(1)} m -> ${withDeath.toFixed(1)} m`,
    );

    // Es tenylegesen mashova is kerulunk.
    const chosen = pickSpawnIndex(all, [], [deathAt.x, deathAt.y, deathAt.z], () => 0);
    check(
      "nem a halalunk helyere szuletunk vissza",
      chosen !== 3,
      `valasztott: ${chosen}, meghaltunk: 3`,
    );
  }

  // --- Csak szabad pontot ad ---
  {
    const free = [5, 6];
    for (let i = 0; i < 20; i++) {
      const chosen = pickSpawnIndex(free, [], null, Math.random);
      if (!free.includes(chosen)) {
        check("csak szabad pontot ad", false, `${chosen} nem volt szabad`);
        return;
      }
    }
    check("csak szabad pontot ad", true, "20 sorsolas mind a szabadok kozul");
  }

  // --- NEM kiszamithato ---
  //
  // Ez az eredeti panasz: "lehet tudni, hol lesz a respawn". Ha a
  // valasztas mindig ugyanaz lenne, az ellenfel odaallhatna varni.
  {
    const threat = aimingAt([22, 1, 0], SPAWN_POINTS[0]);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(pickSpawnIndex(all, [threat], null));
    check(
      "a valasztas nem kiszamithato",
      seen.size > 1,
      `${seen.size} kulonbozo pont fordult elo 200 sorsolasbol`,
    );

    // ...de a sorsolas nem mehet a biztonsag rovasara: a fenyegetes
    // melletti pont SOHA nem johet ki.
    check(
      "a sorsolas nem valaszt veszelyes pontot",
      !seen.has(0),
      `a fenyegetes melletti 0-as pont ${seen.has(0) ? "kijott" : "sosem jott ki"}`,
    );
  }

  // --- A terv nem ugral feleslegesen ---
  {
    check(
      "kis kulonbsegert nem cserelunk tervet",
      !shouldRepickSpawn(40, 45),
      "5 m javulas nem eleg",
    );
    check(
      "erdemi romlasnal cserelunk",
      shouldRepickSpawn(10, 45),
      "35 m kulonbseg mar igen",
    );
  }

  // --- A vedelem hossza ---
  //
  // Ket iranybol szoritjuk. ALULROL: legyen eleg elindulni es kiterni
  // (0-100 km/h: ~1400 ms). FELULROL: ne tartson tovabb, mint maga a
  // varakozas -- kulonben a vedettseg tovabb tartana, mint amennyi
  // idobe a halal kerult, es a megsemmisules jutalommá valna.
  {
    check(
      "a serthetetlenseg eleg hosszu az elinduláshoz",
      SPAWN_PROTECTION_MS >= 1500,
      `${SPAWN_PROTECTION_MS} ms (0-100 km/h: ~1400 ms)`,
    );
    check(
      "a vedelem nem tart tovabb a varakozasnal",
      SPAWN_PROTECTION_MS <= RESPAWN_DELAY_MS,
      `vedelem ${SPAWN_PROTECTION_MS} ms, varakozas ${RESPAWN_DELAY_MS} ms`,
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
