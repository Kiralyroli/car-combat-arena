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
  HEALTH_RESPAWN_MS,
  HEALTH_RESTORE,
  MAX_HP,
  PICKUP_POINTS,
  pickupIndicesOf,
} from "@cca/shared";
import { Room } from "../src/rooms/room";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const HEALTH = pickupIndicesOf("health")[0];
const BOOST = pickupIndicesOf("boost")[0];

/** Egy jatekos, a megadott pickup tetejere allitva. */
function playerOn(index: number, hp: number): { room: Room; player: ReturnType<Room["add"]> } {
  const room = new Room("TEST");
  const player = room.add("a", () => {}, "A", "cannon");
  const point = PICKUP_POINTS[index];
  player.state = { ...player.state, position: [point.x, 1, point.z] };
  player.hp = hp;
  return { room, player };
}

function main(): void {
  console.log("=== Pickupok hatasa ===\n");

  const T0 = 10_000;

  // --- Az elet-pickup gyogyit ---
  {
    const { room, player } = playerOn(HEALTH, 30);
    room.collectPickups(T0);
    check(
      "az elet-pickup visszatolt",
      player.hp === 30 + HEALTH_RESTORE,
      `30 -> ${player.hp} HP (+${HEALTH_RESTORE})`,
    );
    check(
      "a felvett pickup eltunik",
      room.pickupsAvailable(T0)[HEALTH] === false,
      "mar nem felveheto",
    );
  }

  // --- De nem tobbet a maximumnal ---
  {
    const { room, player } = playerOn(HEALTH, MAX_HP - 5);
    room.collectPickups(T0);
    check(
      "a gyogyulas nem lepi tul a maximumot",
      player.hp === MAX_HP,
      `${MAX_HP - 5} -> ${player.hp} HP`,
    );
  }

  // --- TELI elettel nem vesszuk fel ---
  //
  // Ez a lenyeges kulonbseg a boosthoz kepest: a szerver ismeri a HP-t,
  // tehat meg tudja allapitani, hogy a felvetel ertelmetlen lenne.
  {
    const { room, player } = playerOn(HEALTH, MAX_HP);
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
    const { room, player } = playerOn(BOOST, MAX_HP);
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
