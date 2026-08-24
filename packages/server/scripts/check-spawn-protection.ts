/**
 * Ujraszuletes a szerveren: serthetetlenseg es a spawn-terv titkossaga.
 *
 * Ket dolgot ved, amit kulon-kulon konnyu elrontani:
 *
 *  1. A VEDELEM MINDEN sebzes-utvonalon hat -- utkozes, robbanas,
 *     gepfegyver. Ha egy kimaradna, a vedelem csendben lyukas lenne:
 *     a jatekos vedettnek latszana, kozben mégis meghalna.
 *  2. A leendo spawn-hely CSAK az erintetthez jut el. Ha beszivarogna a
 *     mindenkinek kimeno snapshotba, az ellenfel odaallhatna varni --
 *     vagyis pont azt a bajt okoznank, ami ellen az egesz keszult.
 *
 * SZANDEKOSAN bongeszo nelkul: az idozitest (mikor jar le a vedelem)
 * csak igy lehet pontosan, ingadozas nelkul merni.
 *
 * Futtatas: npm run check:spawn-protection
 */
import {
  MAX_HP,
  SPAWN_POINTS,
  RESPAWN_DELAY_MS,
  SPAWN_PROTECTION_MS,
  type ClientState,
  type ServerMessage,
} from "@cca/shared";
import { Room } from "../src/rooms/room";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

/** Ket egymasnak hajto auto, azonos helyen -- biztos utkozes. */
function crashingPair(): { a: Partial<ClientState>; b: Partial<ClientState> } {
  return {
    a: { position: [0, 1, 2], velocity: [0, 0, -25] },
    b: { position: [0, 1, -2], velocity: [0, 0, 25] },
  };
}

interface Fixture {
  room: Room;
  a: ReturnType<Room["add"]>;
  b: ReturnType<Room["add"]>;
  toA: ServerMessage[];
  toB: ServerMessage[];
}

/** Elindult meccs ket jatekossal; a `startedAt` a meccs indulasanak ideje. */
function startedMatch(startedAt: number): Fixture {
  const room = new Room("TEST");
  const toA: ServerMessage[] = [];
  const toB: ServerMessage[] = [];
  const a = room.add("a", (m) => toA.push(m), "A", "cannon");
  const b = room.add("b", (m) => toB.push(m), "B", "machinegun");
  room.stepMatch(startedAt);
  return { room, a, b, toA, toB };
}

function collide(f: Fixture, now: number): void {
  const pair = crashingPair();
  f.a.state = { ...f.a.state, ...pair.a };
  f.b.state = { ...f.b.state, ...pair.b };
  f.room.resolveCollisions(now);
}

/**
 * A-t kiutjuk, B-t kozben eletben tartva.
 *
 * Az utkozes MINDKET autot sebzi, tehat magatol B is meghalna -- es
 * akkor sajat (teljesen jogos) ujraszuletesi tervet kapna, ami elfedne
 * a szivargas-tesztet. Merve: eloszor pontosan ez tortent, es a teszt
 * ugy bukott el, mintha a szerver szivarogtatna.
 */
function killA(f: Fixture, from: number): number {
  let now = from;
  for (let i = 0; i < 40 && f.a.hp > 0; i++) {
    collide(f, now);
    f.b.hp = MAX_HP;
    now += 400;
  }
  return now;
}

function main(): void {
  console.log("=== Ujraszuletesi vedelem ===\n");

  const T0 = 10_000;

  // --- A meccs indulasa vedelmet ad ---
  {
    const f = startedMatch(T0);
    const during = f.room.buildSnapshot(T0 + 500);
    const after = f.room.buildSnapshot(T0 + SPAWN_PROTECTION_MS + 100);

    check(
      "a meccs indulasakor mindenki vedett",
      during.every((p) => p.protected),
      `${during.filter((p) => p.protected).length} / ${during.length} jatekos`,
    );
    check(
      "a vedelem lejar",
      after.every((p) => !p.protected),
      `${SPAWN_PROTECTION_MS} ms utan mar egyik sem vedett`,
    );
  }

  // --- Utkozes: vedett auto nem sebzodik, es NEM IS SEBEZ ---
  {
    const f = startedMatch(T0);
    collide(f, T0 + 500);
    check(
      "vedett autok utkozese nem sebez",
      f.a.hp === MAX_HP && f.b.hp === MAX_HP,
      `A: ${f.a.hp} HP, B: ${f.b.hp} HP`,
    );

    // Ugyanaz a helyzet a vedelem lejarta utan mar sebez -- kulonben a
    // fenti "OK" azt is jelenthetne, hogy az utkozes egyaltalan nem mukodik.
    collide(f, T0 + SPAWN_PROTECTION_MS + 500);
    check(
      "a vedelem lejarta utan viszont sebez",
      f.a.hp < MAX_HP && f.b.hp < MAX_HP,
      `A: ${f.a.hp} HP, B: ${f.b.hp} HP`,
    );
  }

  // --- Tuzeles megtori a sajat vedelmet ---
  {
    const f = startedMatch(T0);
    const fired = f.room.tryFire("a", [0, 1, -30], T0 + 500);
    check("a kiloves sikerul", fired, "tryFire = true");

    const snapshot = f.room.buildSnapshot(T0 + 600);
    const shooter = snapshot.find((p) => p.id === "a");
    check(
      "aki lo, elveszti a vedelmet",
      shooter !== undefined && !shooter.protected,
      `A vedett: ${shooter?.protected}`,
    );
    // A masik jatekose viszont MEGMARAD -- a vedelem szemelyes.
    const other = snapshot.find((p) => p.id === "b");
    check(
      "a masik jatekos vedelme ettol nem szunik meg",
      other !== undefined && other.protected,
      `B vedett: ${other?.protected}`,
    );
  }

  // --- Halalkor terv keszul, es CSAK az erintett kapja meg ---
  {
    const f = startedMatch(T0);
    // Kiutjuk A-t: a vedelem lejarta utan, ismetelt utkozessel.
    const now = killA(f, T0 + SPAWN_PROTECTION_MS + 500);
    check("a celpont megsemmisul", f.a.hp === 0, `A: ${f.a.hp} HP`);
    check("az ellenfel kozben eletben maradt", f.b.hp > 0, `B: ${f.b.hp} HP`);

    f.toA.length = 0;
    f.toB.length = 0;
    f.room.updateRespawnPlans();

    const plans = f.toA.filter((m) => m.type === "respawnPlan");
    check(
      "a halott jatekos megkapja a leendo helyet",
      plans.length === 1,
      `${plans.length} respawnPlan uzenet`,
    );

    // EZ a lenyeg: az ellenfel NEM tudhatja meg, hova fog szuletni.
    check(
      "az ELLENFEL nem kapja meg a tervet",
      f.toB.every((m) => m.type !== "respawnPlan"),
      `B ${f.toB.filter((m) => m.type === "respawnPlan").length} tervet kapott`,
    );

    const planned = plans[0] as { position: [number, number, number] } | undefined;
    const leaked = JSON.stringify(f.room.buildSnapshot(now)).includes(
      JSON.stringify(planned?.position ?? "nincs"),
    );
    check(
      "a terv a kozos snapshotba sem szivarog be",
      !leaked,
      leaked ? "a pozicio megjelent a snapshotban" : "a snapshot nem tartalmazza",
    );

    // --- A megtervezett helyre szuletik ujja, vedetten ---
    const respawnAt = now + RESPAWN_DELAY_MS;
    f.room.respawnExpired(respawnAt);
    check(
      "a megtervezett helyre szuletik ujja",
      planned !== undefined &&
        f.a.state.position.every((v, i) => Math.abs(v - planned.position[i]) < 1e-6),
      `terv: ${planned?.position.join(", ")} -- valos: ${f.a.state.position.join(", ")}`,
    );

    const born = f.room.buildSnapshot(respawnAt + 100).find((p) => p.id === "a");
    check(
      "az ujraszuletett jatekos vedett",
      born !== undefined && born.protected,
      `A vedett: ${born?.protected}, HP: ${born?.hp}`,
    );
  }

  // --- A terv KERULI az ellenfelet ---
  {
    const f = startedMatch(T0);
    killA(f, T0 + SPAWN_PROTECTION_MS + 500);

    // B odaall a (22, 0) spawn-pont melle, es arra is nez.
    f.b.state = {
      ...f.b.state,
      position: [22, 1, 0],
      aimYaw: 0,
      aimPitch: 0,
      velocity: [0, 0, 0],
    };

    f.toA.length = 0;
    f.room.updateRespawnPlans();
    const plan = f.toA.find((m) => m.type === "respawnPlan") as
      | { position: [number, number, number] }
      | undefined;

    const distance =
      plan === undefined
        ? 0
        : Math.hypot(plan.position[0] - 22, plan.position[2] - 0);
    check(
      "a terv tavol kerul az elo ellenfeltol",
      distance > 20,
      `${distance.toFixed(1)} m-re a lestol`,
    );
  }

  // --- KEZI valasztas: a jatekos dontese all ---
  {
    const f = startedMatch(T0);
    killA(f, T0 + SPAWN_PROTECTION_MS + 500);
    f.room.updateRespawnPlans();

    const offered = f.toA
      .filter((m) => m.type === "respawnPlan")
      .pop() as { index: number; options: number[] } | undefined;
    check(
      "az ajanlat mellett a valaszthato pontok is atmennek",
      offered !== undefined && offered.options.length > 1,
      `${offered?.options.length ?? 0} valaszthato pont`,
    );

    if (offered) {
      // Valasszunk mast, mint amit a szerver ajanlott.
      const wanted = offered.options.find((i) => i !== offered.index);
      if (wanted !== undefined) {
        f.toA.length = 0;
        f.room.chooseSpawn("a", wanted);

        const confirmed = f.toA.find((m) => m.type === "respawnPlan") as
          | { index: number }
          | undefined;
        check(
          "a valasztast a szerver visszaigazolja",
          confirmed?.index === wanted,
          `kert: ${wanted}, visszaigazolt: ${confirmed?.index}`,
        );

        // EZ a lenyeg: a periodikus ujratervezes NEM irhatja felul.
        // Az ellenfelet odaallitjuk a valasztott pont melle, hogy az
        // ajanlat biztosan mashova mutatna.
        const point = SPAWN_POINTS[wanted];
        f.b.state = {
          ...f.b.state,
          position: [point.x, 1, point.z],
          aimYaw: 0,
          aimPitch: 0,
        };
        for (let i = 0; i < 5; i++) f.room.updateRespawnPlans();

        const respawnAt = T0 + SPAWN_PROTECTION_MS + 500 + RESPAWN_DELAY_MS + 20_000;
        f.room.respawnExpired(respawnAt);
        check(
          "a szerver nem irja felul a jatekos valasztasat",
          Math.abs(f.a.state.position[0] - point.x) < 1e-6 &&
            Math.abs(f.a.state.position[2] - point.z) < 1e-6,
          `valasztott: (${point.x}, ${point.z}) -- valos: (${f.a.state.position[0]}, ${f.a.state.position[2]})`,
        );
      }
    }
  }

  // --- Ervenytelen keres nem valtoztat semmit ---
  {
    const f = startedMatch(T0);
    killA(f, T0 + SPAWN_PROTECTION_MS + 500);
    f.room.updateRespawnPlans();
    const before = f.a.pendingSpawnIndex;

    f.room.chooseSpawn("a", 999);
    f.room.chooseSpawn("a", -1);
    f.room.chooseSpawn("a", 1.5);
    check(
      "ervenytelen sorszamot nem fogad el",
      f.a.pendingSpawnIndex === before,
      `terv valtozatlan: ${before}`,
    );

    // A MASIK jatekos altal foglalt pont sem valaszthato.
    f.room.chooseSpawn("a", f.b.spawnIndex);
    check(
      "foglalt pontot nem lehet valasztani",
      f.a.pendingSpawnIndex !== f.b.spawnIndex,
      `B pontja: ${f.b.spawnIndex}, A terve: ${f.a.pendingSpawnIndex}`,
    );
  }

  // --- Elo jatekos nem valaszthat ---
  {
    const f = startedMatch(T0);
    const before = f.a.pendingSpawnIndex;
    f.room.chooseSpawn("a", 5);
    check(
      "elve nem lehet spawn-helyet valasztani",
      f.a.pendingSpawnIndex === before,
      "a keres figyelmen kivul maradt",
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
