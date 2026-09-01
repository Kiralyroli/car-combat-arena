/**
 * Pickupok hatasa a szerveren: mit ad, mikor fogy el, mikor jon vissza.
 *
 * A check:pickups a SZAMOKAT es a palyan elfoglalt helyeket meri; ez
 * azt, ami csak a szoba allapotaval egyutt ertelmes:
 *
 *  - az elet-pickup tenylegesen gyogyit, es nem tobbet a kelletenel,
 *  - TELI elettel nem tunik el (kulonben a sertetlen jatekos elvinne
 *    azt, amire masnak tenyleg szuksege van),
 *  - a ket fajta kulon utemben tolodik vissza.
 *
 * Futtatas: npm run check:pickup-effects
 */
import {
  BOOST_RESPAWN_MS,
  FIXED_DT,
  healPerMs,
  HEALTH_RESPAWN_MS,
  HEALTH_RESTORE,
  maxHpOf,
  type CarId,
  PICKUP_POINTS,
  pickupIndicesOf,
} from "@cca/shared";
import { Room } from "../src/rooms/room";

/**
 * A felvett elet vegiglepetese.
 *
 * A pickup FOKOZATOSAN gyogyit, ugyanabban az utemben, mint a
 * kepesseg (lasd stepHealing): egyetlen tick alig valtoztat, a hatast
 * csak a teljes idotartam vegiglepetesevel lehet merni.
 */
function gyogyulasVegig(room: Room, from: number, hp: number): number {
  let now = from;
  const tartamMs = hp / healPerMs();
  const lepesek = Math.ceil(tartamMs / (FIXED_DT * 1000)) + 2;
  for (let i = 0; i < lepesek; i++) {
    room.stepHealing(FIXED_DT, now);
    now += FIXED_DT * 1000;
  }
  return now;
}

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const HEALTH = pickupIndicesOf("health")[0];
const BOOST = pickupIndicesOf("boost")[0];

/** Egy jatekos, a megadott pickup tetejere allitva. */
/**
 * A HP FUGGVENYKENT is megadhato.
 *
 * Az eletero autonkent mas (carStats.ts, 80-tol 130-ig), es azt, hogy
 * a szoba melyik autot osztja ki, a teszt nem donti el. A "teli mínusz
 * ot" tehat csak a KIOSZTAS UTAN szamolhato ki -- egy kozos 100-as
 * konstanssal ez a meres csendben ertelmetlenne valt (a 80 HP-s
 * izomautonak "95 HP-t" allitottunk be, amit a gyogyulas mar nem
 * novelhetett).
 */
function playerOn(
  index: number,
  hp: number | ((teli: number) => number),
): { room: Room; player: ReturnType<Room["add"]> } {
  const room = new Room("TEST");
  const player = room.add("a", () => {}, "A", "cannon");
  const point = PICKUP_POINTS[index];
  player.state = { ...player.state, position: [point.x, 1, point.z] };
  player.hp = typeof hp === "function" ? hp(maxHpOf(player.car)) : hp;
  return { room, player };
}

/** Egy jatekos teli eletereje -- a SAJAT autoja szerint. */
const teli = (p: { car: CarId }): number => maxHpOf(p.car);

function main(): void {
  console.log("=== Pickupok hatasa ===\n");

  const T0 = 10_000;

  // --- Az elet-pickup gyogyit, de NEM AZONNAL ---
  //
  // Az azonnali gyogyulas egy "mentogomb" volt: a halalos loves elott
  // athajtva rajta a jatekos egy pillanat alatt eltuntette az addigi
  // sebzest. A pickup ugyanugy fokozatos, mint a kepesseg -- tehat a
  // felvetel PILLANATABAN meg nem tortenhet semmi a HP-val.
  {
    const { room, player } = playerOn(HEALTH, 30);
    room.collectPickups(T0);
    check(
      "a felvetel pillanataban meg nem no a HP",
      player.hp === 30,
      `${player.hp} HP, es ${Math.round(player.healLeft)} gyogyulas uton`,
    );
    check(
      "a felvett pickup eltunik",
      room.pickupsAvailable(T0)[HEALTH] === false,
      "mar nem felveheto",
    );

    // FELUTON: a gyogyulasnak MERHETOEN el kell indulnia, de meg nem
    // lehet kesz. Enelkul egy "vegen egyben odaadom" megoldas is
    // atmenne a teszten -- pedig az ugyanugy mentogomb lenne.
    const felut = gyogyulasVegig(room, T0, HEALTH_RESTORE / 2);
    check(
      "feluton mar tobb, de meg nem a teljes",
      player.hp > 30 && player.hp < 30 + HEALTH_RESTORE,
      `${player.hp} HP (30 es ${30 + HEALTH_RESTORE} kozott)`,
    );

    gyogyulasVegig(room, felut, HEALTH_RESTORE);
    check(
      "a vegere a teljes eletet visszatolti",
      player.hp === 30 + HEALTH_RESTORE,
      `30 -> ${player.hp} HP (+${HEALTH_RESTORE})`,
    );
    check(
      "es utana megall (nincs vegtelen gyogyulas)",
      player.healLeft === 0,
      `${player.healLeft} maradek`,
    );
  }

  // --- De nem tobbet a maximumnal ---
  {
    const { room, player } = playerOn(HEALTH, (t) => t - 5);
    room.collectPickups(T0);
    gyogyulasVegig(room, T0, HEALTH_RESTORE);
    check(
      "a gyogyulas nem lepi tul a maximumot",
      player.hp === teli(player),
      `${teli(player) - 5} -> ${player.hp} HP`,
    );
  }

  // --- MAR UTON LEVO gyogyulassal nem szedjuk fel a masodikat ---
  //
  // A HP lemarad attol, amit a jatekos mar megkapott: enelkul a frissen
  // felvett elet mellett a masodik is elfogyna ugy, hogy a nagyobb
  // resze karba vesz.
  {
    const { room, player } = playerOn(HEALTH, (t) => t - 5);
    room.collectPickups(T0);
    const masodik = pickupIndicesOf("health")[1];
    const point = PICKUP_POINTS[masodik];
    player.state = { ...player.state, position: [point.x, 1, point.z] };
    room.collectPickups(T0 + 100);
    check(
      "a mar gyogyulo jatekos nem viszi el a masodik eletet",
      room.pickupsAvailable(T0 + 100)[masodik] === true,
      `${player.hp} HP + ${Math.round(player.healLeft)} uton`,
    );
  }

  // --- TELI elettel nem vesszuk fel ---
  //
  // Ez a lenyeges kulonbseg a boosthoz kepest: a szerver ismeri a HP-t,
  // tehat meg tudja allapitani, hogy a felvetel ertelmetlen lenne.
  {
    const { room, player } = playerOn(HEALTH, (t) => t);
    room.collectPickups(T0);
    check(
      "teli elettel a pickup a palyan marad",
      room.pickupsAvailable(T0)[HEALTH] === true,
      `a jatekos ${player.hp} HP-val hajtott at rajta`,
    );
  }

  // --- A boost viszont teli tartallyal is elfogy ---
  //
  // NEM feledekenyseg: a tartaly a KLIENSNEL van (terv 15.4), a szerver
  // nem tudja, mennyi van benne -- tehat nem is dönthet helyette.
  {
    const { room, player } = playerOn(BOOST, (t) => t);
    room.collectPickups(T0);
    check(
      "a boostot a szerver nem tudja visszatartani",
      room.pickupsAvailable(T0)[BOOST] === false && player.boostGrants === 1,
      "a tartaly allapota csak a kliensnel ismert",
    );
  }

  // --- A ket fajta kulon utemben jon vissza ---
  {
    const { room } = playerOn(HEALTH, 20);
    room.collectPickups(T0);

    const justBefore = room.pickupsAvailable(T0 + HEALTH_RESPAWN_MS - 100)[HEALTH];
    const justAfter = room.pickupsAvailable(T0 + HEALTH_RESPAWN_MS + 100)[HEALTH];
    check(
      "az elet a sajat, hosszabb utemeben jon vissza",
      justBefore === false && justAfter === true,
      `${HEALTH_RESPAWN_MS} ms utan (a boost: ${BOOST_RESPAWN_MS} ms)`,
    );

    // Es a boost utemevel MEG NEM jonne vissza -- kulonben a "ritkabb"
    // csak a konfigban lenne igaz, a jatekban nem.
    check(
      "a boost utemere meg nem terne vissza",
      room.pickupsAvailable(T0 + BOOST_RESPAWN_MS + 100)[HEALTH] === false,
      `${BOOST_RESPAWN_MS} ms-nal meg nincs ott`,
    );
  }

  // --- Halott jatekos nem szed fel semmit ---
  {
    const { room, player } = playerOn(HEALTH, 10);
    player.deadSince = T0;
    room.collectPickups(T0);
    check(
      "megsemmisult auto nem vesz fel pickupot",
      player.hp === 10 && room.pickupsAvailable(T0)[HEALTH] === true,
      `${player.hp} HP, a pickup a helyen maradt`,
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
