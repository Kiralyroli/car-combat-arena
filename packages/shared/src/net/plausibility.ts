import { ARENA, CHASSIS, SPAWN_POINTS } from "../config";
import type { ClientState } from "./protocol";

/**
 * Szerver-oldali plauzibilitas-ellenorzes (terv 15.4, 3. lepcso 5. pont).
 *
 * A hibrid authority modellben a KLIENS kuldi a sajat pozicioját -- ez
 * adja a nulla input laget, de azt is jelenti, hogy egy modositott
 * kliens barmit allithat magarol. A szerver ezert nem szimulalja ujra a
 * mozgast (az a teljes authoritative fizika lenne, ami a terv szerint
 * nem MVP-feladat), hanem JOZANSAGI hatarokat huz: amit fizikailag
 * lehetetlen, azt eldobja.
 *
 * A cel nem a tokeletes csalasvedelem, hanem hogy a csalas "legfeljebb
 * bosszanto, ne jatekrombolo" legyen (terv 15.4). A sebzest, a talalatot
 * es a pontokat ugyis a szerver szamolja.
 *
 * SZANDEKOSAN tiszta fuggveny, a shared csomagban: igy headless
 * tesztelheto, es a hatarok ugyanabbol a config-bol jonnek, mint a
 * fizika -- kulon masolt konstansok elobb-utobb elcsusznanak.
 */

/**
 * Legnagyobb hihető sebesseg (m/s).
 *
 * Meres szerint a kocsi csucssebessege boosttal 44.6 m/s (160 km/h).
 * A hatart bőven fole tesszuk, mert legitim modon is gyorsulhat ennel
 * jobban: rampárol leugorva, vagy ha egy masik auto nagy sebesseggel
 * meglöki. Egy sebesseg-hack ennel nagysagrendekkel tobbet allitana,
 * tehat a laza hatar is kiszuri -- a szoros hatar viszont jatszhato
 * helyzetekben adna hamis riasztast.
 */
export const MAX_PLAUSIBLE_SPEED = 60;

/**
 * Extra rahagyas a pozicio-ugrasra (m).
 *
 * A ket allapot kozotti eltelt idot a szerver a SAJAT orajaval meri,
 * ami a halozati ingadozas miatt pontatlan. E nelkul a rahagyas nelkul
 * egy kesve erkezo csomag hamisan "teleportnak" latszana.
 */
const POSITION_JUMP_TOLERANCE = 6;

/** Ket allapot kozott ennel hosszabb szunetet nem szamolunk bele. */
const MAX_GAP_SECONDS = 2;

/** Fuggoleges hatarok: ala esni vagy fole jutni egyarant lehetetlen. */
const MIN_Y = -10;
const MAX_Y = 80;

/** Az arena felmerete a talaj-elembol -- nem masolt konstans. */
const ARENA_LIMIT =
  (ARENA.find((box) => box.name === "ground")?.halfExtents.x ?? 40) + 5;

/**
 * Ekkora sugaron belul (m) egy spawn-ponthoz erkezes NEM teleportnak
 * szamit.
 *
 * Az ujraszuletes (R gomb, illetve a csatlakozaskori spawn) jogos,
 * NAGY ugras: a kocsi barhonnan a spawn-pontra kerul. E nelkul a
 * kivetel nelkul a szerver ezt csalasnak latna, es a jatekos a tobbiek
 * kepernyojen a REGI helyen ragadna -- lathatoan elromlott jatek egy
 * teljesen szabalyos muvelet utan.
 */
const SPAWN_SNAP_RADIUS = 4;

/** Minden ervenyes ujraszuletesi pont (szerver-kiosztott + alapertelmezett). */
const RESPAWN_POINTS = [...SPAWN_POINTS, CHASSIS.spawn];

function isAtRespawnPoint(position: readonly number[]): boolean {
  return RESPAWN_POINTS.some(
    (p) =>
      Math.hypot(position[0] - p.x, position[1] - p.y, position[2] - p.z) <
      SPAWN_SNAP_RADIUS,
  );
}

export type PlausibilityResult =
  | { ok: true }
  | { ok: false; reason: string; detail: string };

function isFiniteVec(v: readonly number[]): boolean {
  return v.every((n) => Number.isFinite(n));
}

/**
 * Elfogadhato-e a kliens altal kuldott allapot?
 *
 * @param previous Az utoljara ELFOGADOTT allapot, vagy null (elso uzenet).
 * @param next     A most erkezett allapot.
 * @param dtSeconds Az elozo elfogadott allapot ota eltelt ido.
 */
export function checkPlausibility(
  previous: ClientState | null,
  next: ClientState,
  dtSeconds: number,
): PlausibilityResult {
  // 1. Ertelmes szamok. Egy NaN vegigterjedne a szerveren es a tobbi
  //    kliens fizikajan is, ezert ez az elso szuro.
  if (
    !isFiniteVec(next.position) ||
    !isFiniteVec(next.rotation) ||
    !isFiniteVec(next.velocity)
  ) {
    return {
      ok: false,
      reason: "nem_szam",
      detail: "NaN vagy vegtelen ertek az allapotban",
    };
  }

  // 2. A forgas legyen kozel egysegnyi quaternion -- kulonben a
  //    renderelesnel es az utkozes-geometrianal is torzulast okozna.
  const qLen = Math.hypot(...next.rotation);
  if (Math.abs(qLen - 1) > 0.1) {
    return {
      ok: false,
      reason: "rossz_forgas",
      detail: `quaternion hossza ${qLen.toFixed(3)}`,
    };
  }

  // 3. Palya-hatarok.
  const [x, y, z] = next.position;
  if (Math.abs(x) > ARENA_LIMIT || Math.abs(z) > ARENA_LIMIT) {
    return {
      ok: false,
      reason: "palyan_kivul",
      detail: `x=${x.toFixed(1)} z=${z.toFixed(1)} (hatar ${ARENA_LIMIT})`,
    };
  }
  if (y < MIN_Y || y > MAX_Y) {
    return {
      ok: false,
      reason: "fuggoleges_hatar",
      detail: `y=${y.toFixed(1)} (hatar ${MIN_Y}..${MAX_Y})`,
    };
  }

  // 4. Sebesseg.
  const speed = Math.hypot(...next.velocity);
  if (speed > MAX_PLAUSIBLE_SPEED) {
    return {
      ok: false,
      reason: "tul_gyors",
      detail: `${speed.toFixed(1)} m/s (hatar ${MAX_PLAUSIBLE_SPEED})`,
    };
  }

  // 5. Pozicio-ugras: az eltelt ido alatt fizikailag megtehető tavolsag.
  //    Az ujraszuletes kivetel -- lasd SPAWN_SNAP_RADIUS.
  if (previous && !isAtRespawnPoint(next.position)) {
    const gap = Math.min(Math.max(dtSeconds, 0), MAX_GAP_SECONDS);
    const jump = Math.hypot(
      next.position[0] - previous.position[0],
      next.position[1] - previous.position[1],
      next.position[2] - previous.position[2],
    );
    const allowed = MAX_PLAUSIBLE_SPEED * gap + POSITION_JUMP_TOLERANCE;
    if (jump > allowed) {
      return {
        ok: false,
        reason: "teleport",
        detail: `${jump.toFixed(1)} m ${gap.toFixed(2)} s alatt (megengedett ${allowed.toFixed(1)} m)`,
      };
    }
  }

  return { ok: true };
}
