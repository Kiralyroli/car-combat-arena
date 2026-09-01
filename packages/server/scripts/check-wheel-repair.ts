/**
 * Kerek-regeneralodas a szerveren: KI gyogyul, es mikor.
 *
 * A szabalyokat (utem, kuszob) a check:wheels meri tisztan; itt az dol
 * el, amit csak a szoba allapotaval egyutt lehet:
 *
 *  1. Sebzes utan NEM indul azonnal -- kulonben harc kozben gyogyulna.
 *  2. MINDEN sebzes-utvonal ujrainditja az orat. Ez a legkonnyebben
 *     elrontható resz: ha egy kimarad, a jatekos tuz alatt javulna, es
 *     ez a jatekban csak "neha furcsa" formaban latszana.
 *  3. A megsemmisult jatekos kimarad (ugyis uj autot kap).
 *
 * Futtatas: npm run check:wheel-repair
 */
import {
  EXPLOSION_RADIUS,
  WHEEL_LAYOUT,
  wheelExplosionDamage,
  wheelWorldPosition,
  WHEEL_MAX_HP,
  maxHpOf,
  WHEEL_REGEN_DELAY_MS,
  damageWheel,
  type ClientState,
} from "@cca/shared";
import { Room } from "../src/rooms/room";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const FIXED_DT = 1 / 60;

/** Egy jatekos, letort elso bal kerékkel. */
function withBrokenWheel(): { room: Room; player: ReturnType<Room["add"]> } {
  const room = new Room("TEST");
  const player = room.add("a", () => {}, "A", "cannon");
  player.state = { ...player.state, position: [0, 1, 0] } as ClientState;
  player.wheels[0] = damageWheel(player.wheels[0], WHEEL_MAX_HP);
  return { room, player };
}

/** `seconds` masodpercnyi regeneralodas, tickenkent. */
function repairFor(room: Room, from: number, seconds: number): number {
  let now = from;
  for (let i = 0; i < seconds * 60; i++) {
    now += FIXED_DT * 1000;
    room.stepWheelRepair(FIXED_DT, now);
  }
  return now;
}

function main(): void {
  console.log("=== Kerek-regeneralodas ===\n");

  const T0 = 10_000;

  // --- Sebzes utan nem indul azonnal ---
  {
    const { room, player } = withBrokenWheel();
    player.lastDamagedAt = T0;
    check("a kerek tenyleg letort", player.wheels[0].broken, "FL kerek");

    // A varakozasi idon BELUL semmi nem tortenik.
    repairFor(room, T0, (WHEEL_REGEN_DELAY_MS - 1000) / 1000);
    check(
      "a varakozasi idon belul nem gyogyul",
      player.wheels[0].hp === 0,
      `${player.wheels[0].hp} HP a ${WHEEL_REGEN_DELAY_MS} ms-os varakozasbol`,
    );

    // Utana viszont igen.
    const later = repairFor(room, T0 + WHEEL_REGEN_DELAY_MS, 12);
    check(
      "a varakozas utan helyreall",
      !player.wheels[0].broken && player.wheels[0].hp === WHEEL_MAX_HP,
      `${player.wheels[0].hp} HP, tort: ${player.wheels[0].broken} (${((later - T0) / 1000).toFixed(0)} mp alatt)`,
    );
  }

  // --- UTKOZES ujrainditja az orat ---
  {
    const room = new Room("TEST");
    const a = room.add("a", () => {}, "A", "cannon");
    const b = room.add("b", () => {}, "B", "cannon");
    a.wheels[0] = damageWheel(a.wheels[0], 60);
    const before = a.wheels[0].hp;

    // Vedelem nelkul (a meccs nem indult el, nincs serthetetlenseg).
    let now = T0 + WHEEL_REGEN_DELAY_MS + 1000;
    a.state = { ...a.state, position: [0, 1, 2], velocity: [0, 0, -25] } as ClientState;
    b.state = { ...b.state, position: [0, 1, -2], velocity: [0, 0, 25] } as ClientState;
    room.resolveCollisions(now);

    check(
      "az utkozes sebez, es jelzi is",
      // A SAJAT maximumahoz merve. A beegetett 100-zal ez az allitas
      // VAKON atment volna: a 80 HP-s izomauto sertetlenul is
      // "kevesebb, mint 100".
      a.hp < maxHpOf(a.car) && a.lastDamagedAt === now,
      `${a.hp} HP, ora: ${a.lastDamagedAt === now ? "ujraindult" : "NEM indult ujra"}`,
    );

    // Az utkozes UTAN kozvetlenul meg nem gyogyulhat.
    repairFor(room, now, 2);
    check(
      "utkozes utan nem gyogyul azonnal",
      a.wheels[0].hp === before,
      `${a.wheels[0].hp} HP (valtozatlan)`,
    );
  }

  // --- CSAK a kerekeket ero robbanas is ujrainditja az orat ---
  //
  // EZ a konnyen kimarado ut. A kerek KOZELEBB lehet a robbanashoz,
  // mint a karosszeria kozeppontja (az auto ~4.9 m hosszu), tehat van
  // olyan tavolsag, ahol a kerek serul, a body viszont mar nem. Ha
  // ilyenkor az ora nem indulna ujra, a jatekos tuz alatt gyogyulna.
  //
  // A robbanas helyet NEM talalgatjuk: a rakéta ERINTESRE robban, tehat
  // a felulete pontjan, nem egy elore tudott koordinatan. Eloszor
  // megmerjuk, hova esik, es csak utana allitjuk oda az aldozatot.
  //
  // Az aldozat a ROPPALYA MELLE kerul, nem ele: ha az utban allna, maga
  // valtoztatna meg, hol robban a rakéta -- vagyis a merest a sajat
  // jelenlete tenne ervenytelenne. (Ez tenylegesen megtortent: a
  // robbanas helye 1.5 m-t mozdult egy fuggetlen javitastol, es a
  // kezzel hangolt eltolas ettol elcsuszott.)
  {
    /** Egy loves; visszaadja, hol robbant. */
    const fireAndLocate = (
      victimAt: [number, number] | null,
      victimRot: [number, number, number, number] = [0, 0, 0, 1],
    ): {
      at: [number, number, number] | null;
      room: Room;
      victim: ReturnType<Room["add"]> | null;
    } => {
      let at: [number, number, number] | null = null;
      const room = new Room("TEST");
      const shooter = room.add("s", () => {}, "Lovo", "cannon");
      const detonator = room.add(
        "d",
        (m) => {
          if (m.type === "explosion") at ??= m.position;
        },
        "Gyujto",
        "cannon",
      );
      shooter.state = { ...shooter.state, position: [0, 1, -30] } as ClientState;
      detonator.state = {
        ...detonator.state,
        position: [0, 1, 0],
        rotation: [0, 0, 0, 1],
      } as ClientState;

      let victim: ReturnType<Room["add"]> | null = null;
      if (victimAt !== null) {
        victim = room.add("v", () => {}, "Aldozat", "cannon");
        victim.state = {
          ...victim.state,
          position: [victimAt[0], 1, victimAt[1]],
          rotation: victimRot,
        } as ClientState;
        victim.lastDamagedAt = 0;
      }

      room.rockets.spawn("s", shooter.state, [0, 1, 0], T0);
      let now = T0;
      for (let i = 0; i < 180; i++) {
        now += FIXED_DT * 1000;
        room.stepRockets(FIXED_DT, now);
      }
      return { at, room, victim };
    };

    // 1. Hol robban? (aldozat nelkul)
    const probe = fireAndLocate(null);
    check(
      "a rakéta felrobban a gyujto auton",
      probe.at !== null,
      probe.at ? `(0, ${probe.at[2].toFixed(1)})` : "nem robbant",
    );

    if (probe.at) {
      // Az aldozat OLDALT all a robbanas mellett, ORRAL FELE fordulva:
      // a kozeppontja a hatosugaron KIVUL, az elso kerekei (1.495 m-rel
      // elorebb) viszont BELUL.
      //
      // A tavolsagot nem kezzel hangoljuk, hanem MEGKERESSUK a
      // konstansokbol -- igy ha a hatosugar, a kerek-sebzes vagy a
      // kerek-geometria valtozik, a teszt egyutt mozdul, vagy hangosan
      // megmondja, hogy igy mar nem all elo a merni kivant helyzet.
      const bumm = probe.at;
      // Orral -X fele: (0,0,-1) elforgatva +90 fokkal az Y korul.
      const fele: [number, number, number, number] = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
      /** A legkozelebbi kerek tavolsaga a robbanastol, adott oldal-tavnal. */
      const legkozelebbiKerek = (oldalTav: number): number => {
        const kozep: [number, number, number] = [bumm[0] + oldalTav, 1, bumm[2]];
        let legkisebb = Infinity;
        for (let i = 0; i < WHEEL_LAYOUT.length; i++) {
          const w = wheelWorldPosition(kozep, fele, i);
          legkisebb = Math.min(
            legkisebb,
            Math.hypot(w[0] - bumm[0], w[1] - bumm[1], w[2] - bumm[2]),
          );
        }
        return legkisebb;
      };

      // A kozeppont a hatosugaron kivul kell legyen (kulonben a
      // karosszeria is serulne), a kerek viszont meg kapjon sebzest.
      let felso: number | null = null;
      for (let d = EXPLOSION_RADIUS; d < EXPLOSION_RADIUS + 5; d += 0.05) {
        if (wheelExplosionDamage(legkozelebbiKerek(d)) > 0) felso = d;
        else break;
      }
      check(
        "van olyan hely, ahol a kerek serul, a karosszeria nem",
        felso !== null && felso > EXPLOSION_RADIUS,
        felso === null
          ? "NINCS ilyen tavolsag -- a merni kivant helyzet nem all elo"
          : `${EXPLOSION_RADIUS} .. ${felso.toFixed(2)} m kozott`,
      );

      if (felso !== null) {
        // A tartomany KOZEPE, hogy egyik hatarhoz se alljunk szorosan.
        const oldalt = (EXPLOSION_RADIUS + felso) / 2;
        const shot = fireAndLocate([bumm[0] + oldalt, bumm[2]], fele);
        const victim = shot.victim!;

        // A SAJAT autoja maximumahoz merve: a "sertetlen" nem 100,
        // hanem autonkent 80 es 130 kozott van (carStats.ts).
        const bodyHurt = victim.hp < maxHpOf(victim.car);
        const wheelHurt = victim.wheels.some((w) => w.hp < WHEEL_MAX_HP);
        check(
          "a robbanas a kerekeket eri, a karosszeriat nem",
          wheelHurt && !bodyHurt,
          `${oldalt.toFixed(2)} m-rol -- kerekek: ${victim.wheels
            .map((w) => w.hp.toFixed(0))
            .join("/")} HP, karosszeria: ${victim.hp} HP`,
        );
        check(
          "a CSAK kerekre eso sebzes is ujrainditja az orat",
          victim.lastDamagedAt > 0,
          victim.lastDamagedAt > 0
            ? "ujraindult"
            : "NEM indult ujra -- tuz alatt gyogyulna",
        );
      }
    }
  }
  // --- Megsemmisult jatekos nem gyogyul ---
  {
    const { room, player } = withBrokenWheel();
    player.lastDamagedAt = 0;
    player.deadSince = T0;
    repairFor(room, T0, 15);
    check(
      "megsemmisult auto kereke nem gyogyul",
      player.wheels[0].broken && player.wheels[0].hp === 0,
      "ugyis uj autot kap",
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
