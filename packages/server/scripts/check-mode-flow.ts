/**
 * JATEKMODOK a szerveren: mitol er veget a meccs, es mi kerul a
 * kilovés-listara.
 *
 * A tiszta szabalyokat a check:modes meri; itt az ALLAPOTGEP a targy --
 * az, ami csak a szoba allapotaval egyutt ertelmes:
 *
 *  - Last Car Standing: fogy az elet, es a mezony fogyasa zar,
 *  - Kiloves (deathmatch): NEM fogy elet, es az IDO zar,
 *  - a kilovés-lista minden modban feltoltodik, es a kiolvasas uriti,
 *  - a kiloves ahhoz kerul, aki utoljara sebzett -- es csak akkor, ha
 *    tenylegesen o volt.
 *
 * SZANDEKOSAN bongeszo nelkul: az idozites igy pontosan merheto.
 *
 * Futtatas: npm run check:mode-flow
 */
import {
  DEATHMATCH_DURATION_MS,
  LIVES_PER_PLAYER,
  MACHINEGUN,
  MAX_HP,
  type ServerMessage,
} from "@cca/shared";
import { Room } from "../src/rooms/room";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const nyeld = (_m: ServerMessage) => {};

/** Elindult meccs ket jatekossal, a megadott modban. */
function startedMatch(mode: "lastCarStanding" | "deathmatch", startedAt: number) {
  const room = new Room("TEST", mode);
  const a = room.add("a", nyeld, "A", "machinegun");
  const b = room.add("b", nyeld, "B", "machinegun");
  room.stepMatch(startedAt);
  return { room, a, b };
}

/**
 * "A" kiloszi "B"-t -- a HP-t kozvetlenul nullazzuk, de a tamadot a
 * rendes uton konyveljuk el.
 *
 * A SEBZES UTJAT nem itt merjuk (azt a check:ability es a
 * check:pointblank teszi): itt a KOVETKEZMENY a kerdes -- kie a
 * kiloves, es mi kerul a listara.
 */
function killedBy(
  room: Room,
  victim: ReturnType<Room["add"]>,
  attackerId: string,
  now: number,
): void {
  victim.hp = 0;
  victim.lastAttacker = { id: attackerId, cause: "machinegun", at: now };
  room.markDeadIfDestroyed(victim, now);
}

function main(): void {
  console.log("=== Jatekmodok a szerveren ===\n");

  const T0 = 10_000;

  // --- LAST CAR STANDING: fogy az elet ---
  {
    const { room, a, b } = startedMatch("lastCarStanding", T0);
    check(
      "a meccs elindul ket jatekossal",
      room.matchSnapshot(T0).phase === "playing",
      room.matchSnapshot(T0).phase,
    );
    killedBy(room, b, a.id, T0 + 1000);
    check(
      "a megsemmisules eletbe kerul",
      b.lives === LIVES_PER_PLAYER - 1,
      `${LIVES_PER_PLAYER} -> ${b.lives}`,
    );
    check(
      "es a kiloves a tamadohoz kerul",
      a.kills === 1,
      `A kilovesei: ${a.kills}`,
    );
    check(
      "a modban nincs visszaszamlalo",
      room.matchSnapshot(T0).timeLeftMs === 0,
      "timeLeftMs = 0",
    );
  }

  // --- DEATHMATCH: NEM fogy az elet ---
  //
  // Ez a mod lenyege: a halal ara par masodperc, nem a kieses. Ha az
  // elet fogyna, a mezony harom halal utan elfogyna a 3 perc alatt.
  {
    const { room, a, b } = startedMatch("deathmatch", T0);
    for (let i = 0; i < LIVES_PER_PLAYER + 2; i++) {
      killedBy(room, b, a.id, T0 + 1000 * (i + 1));
      // A kovetkezo halalhoz ujra elonek kell lennie.
      b.deadSince = null;
      b.hp = MAX_HP;
    }
    check(
      "a deathmatchben nem fogy elet",
      b.lives === LIVES_PER_PLAYER,
      `${LIVES_PER_PLAYER + 2} halal utan is ${b.lives} elet`,
    );
    check(
      "a kilovesek viszont gyulnek",
      a.kills === LIVES_PER_PLAYER + 2,
      `A kilovesei: ${a.kills}`,
    );
    check(
      "a meccs meg NEM ert veget (nem a mezony fogyasa zar)",
      room.matchSnapshot(T0 + 9000).phase === "playing",
      room.matchSnapshot(T0 + 9000).phase,
    );
  }

  // --- DEATHMATCH: az IDO zar, es a legtobb kiloves nyer ---
  {
    const { room, a, b } = startedMatch("deathmatch", T0);
    killedBy(room, b, a.id, T0 + 1000);

    const felut = T0 + DEATHMATCH_DURATION_MS / 2;
    const hatra = room.matchSnapshot(felut).timeLeftMs;
    check(
      "a visszaszamlalo a hatralevo idot mutatja",
      Math.abs(hatra - DEATHMATCH_DURATION_MS / 2) < 50,
      `${(hatra / 1000).toFixed(1)} mp a felutnal`,
    );

    room.stepMatch(felut);
    check(
      "feluton meg megy a meccs",
      room.matchSnapshot(felut).phase === "playing",
      room.matchSnapshot(felut).phase,
    );

    const vege = T0 + DEATHMATCH_DURATION_MS + 10;
    room.stepMatch(vege);
    const snap = room.matchSnapshot(vege);
    check(
      "az ido lejartaval veget er",
      snap.phase === "ended",
      `${snap.phase}, hatralevo ido: ${snap.timeLeftMs}`,
    );
    check(
      "a legtobb kilovest szerzo a gyoztes",
      snap.winnerId === a.id,
      `gyoztes: ${snap.winnerId}`,
    );
    void b;
  }

  // --- DEATHMATCH: holtversenynel dontetlen ---
  {
    const { room, a, b } = startedMatch("deathmatch", T0);
    a.kills = 2;
    b.kills = 2;
    room.stepMatch(T0 + DEATHMATCH_DURATION_MS + 10);
    check(
      "azonos kilovesnel nincs gyoztes",
      room.matchSnapshot(T0 + DEATHMATCH_DURATION_MS + 10).winnerId === null,
      "dontetlen",
    );
  }

  // --- KILOVES-LISTA: minden modban, es a kiolvasas uriti ---
  {
    const { room, a, b } = startedMatch("lastCarStanding", T0);
    room.drainKills(); // a meccs-indulas maga is uriti -- induljunk tisztan
    killedBy(room, b, a.id, T0 + 1000);

    const feed = room.drainKills();
    check(
      "a kiloves felkerul a listara, nevekkel egyutt",
      feed.length === 1 &&
        feed[0].killerId === a.id &&
        feed[0].victimId === b.id &&
        feed[0].killerName === "A" &&
        feed[0].victimName === "B" &&
        feed[0].cause === "machinegun",
      feed.length === 1
        ? `${feed[0].killerName} -- ${feed[0].cause} -> ${feed[0].victimName}`
        : `${feed.length} elem`,
    );
    check(
      "a kiolvasas uriti a listat (nem ismetlodik)",
      room.drainKills().length === 0,
      "masodszorra ures",
    );
  }

  // --- SAJAT HIBA: nincs tamado, nincs pont, de a listan ott van ---
  //
  // A "megsemmisult" sor nelkul a mezonybol csendben tunne el valaki.
  {
    const { room, a, b } = startedMatch("deathmatch", T0);
    room.drainKills();
    b.hp = 0;
    b.lastAttacker = null;
    room.markDeadIfDestroyed(b, T0 + 1000);
    const feed = room.drainKills();
    check(
      "tamado nelkuli halal is felkerul a listara",
      feed.length === 1 && feed[0].killerId === null && feed[0].cause === null,
      feed.length === 1 ? `killerId: ${feed[0].killerId}` : `${feed.length} elem`,
    );
    check(
      "de senki nem kap erte pontot",
      a.kills === 0,
      `A kilovesei: ${a.kills}`,
    );
  }

  // --- REGI talalat: nem jar erte kiloves ---
  {
    const { room, a, b } = startedMatch("deathmatch", T0);
    b.hp = 0;
    // Bőven az ablakon kivul (lasd KILL_CREDIT_MS).
    b.lastAttacker = { id: a.id, cause: "ram", at: T0 };
    room.markDeadIfDestroyed(b, T0 + 60_000);
    check(
      "egy perccel korabbi talalatert nem jar kiloves",
      a.kills === 0,
      `A kilovesei: ${a.kills}`,
    );
  }

  // --- UJ MECCS: nullarol indul az allas ---
  {
    const { room, a, b } = startedMatch("deathmatch", T0);
    a.kills = 5;
    b.kills = 3;
    // Az uj meccs a startMatch-en keresztul indul (ido lejart -> ended,
    // majd a visszaszamlalas utan ujra playing).
    room.stepMatch(T0 + DEATHMATCH_DURATION_MS + 10);
    room.stepMatch(T0 + DEATHMATCH_DURATION_MS + 60_000);
    check(
      "uj meccsben nullarol indul mindenki",
      a.kills === 0 && b.kills === 0,
      `A: ${a.kills}, B: ${b.kills}`,
    );
  }

  void MACHINEGUN;

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
