/**
 * JATEKMODOK: mitol er veget a meccs, es ki nyeri.
 *
 * Ket mod van, es a KETTO KERDESE MAS:
 *
 *  - `lastCarStanding` -- ki el a legtovabb. Harom elet, aki elfogyasztja,
 *    kiesik; az utolso talpon marado nyer. A meccs addig tart, amig egy
 *    jatekos marad.
 *  - `deathmatch` -- ki uti ki a legtobbet. Rogzitett ido (3 perc),
 *    korlatlan ujraszuletes, a legtobb kilovessel rendelkezo nyer.
 *
 * A KETTO NEM CSAK "beallitas": mast jutalmaz. A Last Car Standingben a
 * TULELES a nyeres (kivarni is lehet), a deathmatchben a TAMADAS -- ott
 * a halalnak alig van ara, tehat a kockazatvallalas kifizetodik.
 *
 * A modul TISZTA FUGGVENYEKET ad, mint a match.ts: a szabalyok
 * headlessen, bongeszo nelkul merhetoek (lasd check:modes), es nem a
 * szerver belso allapotan keresztul kell kovetkeztetni rajuk.
 */

export type GameModeId = "lastCarStanding" | "deathmatch";

export const GAME_MODE_IDS: readonly GameModeId[] = [
  "lastCarStanding",
  "deathmatch",
] as const;

export interface GameModeDef {
  /** Magyar nev a lobbyhoz es a HUD-hoz. */
  nev: string;
  /** Egy soros magyarazat a valasztoban. */
  leiras: string;
  /**
   * Fogy-e elet a megsemmisuleskor.
   *
   * Deathmatchben nem: ott az ujraszuletes korlatlan, es eppen ez adja
   * a mod ritmusat -- a halal ara par masodperc, nem a kiesés.
   */
  fogyElet: boolean;
  /**
   * Meddig tart a meccs (ms); 0 = nincs idokorlat.
   *
   * A Last Car Standing addig tart, amig egy jatekos marad -- ott egy
   * ora csak elvagna a meccset a dontes elott.
   */
  hosszMs: number;
}

/**
 * HAROM PERC a deathmatch hossza.
 *
 * Eleg hosszu ahhoz, hogy egy rossz kezdes utan meg legyen ido
 * visszajonni (par ujraszuletes belefer), es eleg rovid ahhoz, hogy a
 * hatralevo ido vegig szamitson -- egy tizperces meccs elso fele
 * kovetkezmeny nelkuli lenne.
 */
export const DEATHMATCH_DURATION_MS = 3 * 60 * 1000;

export const GAME_MODES: Record<GameModeId, GameModeDef> = {
  lastCarStanding: {
    nev: "Utolsó túlélő",
    leiras: "3 élet, aki a végén talpon marad, nyer.",
    fogyElet: true,
    hosszMs: 0,
  },
  deathmatch: {
    nev: "Kilövés",
    leiras: "3 perc, korlátlan újraszületés — a legtöbb kilövés nyer.",
    fogyElet: false,
    hosszMs: DEATHMATCH_DURATION_MS,
  },
};

export const DEFAULT_GAME_MODE: GameModeId = "lastCarStanding";

export function isGameModeId(ertek: unknown): ertek is GameModeId {
  return GAME_MODE_IDS.includes(ertek as GameModeId);
}

/** Ervenyes mod-azonosito, vagy az alapertelmezett. */
export function toGameModeId(ertek: unknown): GameModeId {
  return isGameModeId(ertek) ? ertek : DEFAULT_GAME_MODE;
}

/** Idore megy-e a mod (van-e visszaszamlalo). */
export function isTimed(mode: GameModeId): boolean {
  return GAME_MODES[mode].hosszMs > 0;
}

/** Fogy-e elet a megsemmisuleskor ebben a modban. */
export function losesLife(mode: GameModeId): boolean {
  return GAME_MODES[mode].fogyElet;
}

/** Egy jatekos a KILOVES-alapu ertekeleshez. */
export interface ScoredPlayer {
  id: string;
  kills: number;
}

/**
 * A deathmatch gyoztese, vagy null dontetlennel.
 *
 * DONTETLEN, ha a legjobb eredmenyt tobben is elertek -- akar nulla
 * kilovessel is. SZANDEKOSAN nem torunk holtversenyt masodlagos
 * szemponttal (ki halt meg kevesebbszer, ki ert el elobb oda): egy
 * kitalalt sorrend a jatekos szamara onkenyesnek latszana, mert a
 * kepernyon csak a kilovesek szama latszik.
 */
export function killLeader(players: readonly ScoredPlayer[]): ScoredPlayer | null {
  if (players.length === 0) return null;
  let legjobb = players[0];
  for (const p of players) if (p.kills > legjobb.kills) legjobb = p;
  const holtverseny = players.filter((p) => p.kills === legjobb.kills);
  return holtverseny.length === 1 ? legjobb : null;
}

/**
 * Veget ert-e egy IDORE meno meccs?
 *
 * Kulon fuggveny, hogy a "mikor van vege" kerdesre modonkent EGY hely
 * valaszoljon: az idozites es a Last Car Standing tulelés-szabalya
 * kulonben ket helyen kevereden.
 */
export function isTimeUp(mode: GameModeId, elteltMs: number): boolean {
  return isTimed(mode) && elteltMs >= GAME_MODES[mode].hosszMs;
}

/**
 * KILOVES-OKOK: mi vitte el a jatekost.
 *
 * A kilovés-listan ez valik a ket nev kozotti jellé -- ebbol latszik,
 * hogy lovessel vagy rammelessel esett ki valaki. A `null` killer
 * (sajat hiba, lezuhanas) kulon eset, nem ok.
 */
export type KillCause = "cannon" | "machinegun" | "ram";

/** A kilovés-okok rovid, kiirhato neve (kilovés-lista). */
export const KILL_CAUSE_LABEL: Record<KillCause, string> = {
  cannon: "ágyú",
  machinegun: "gépfegyver",
  ram: "rammelés",
};

/**
 * Meddig szamit egy talalat "o olte meg" cimen (ms).
 *
 * Enelkul ket rossz vege lenne. Ablak nelkul egy perccel korabbi
 * koccanas is kilovést erne; tul rovid ablakkal viszont a menekulo,
 * megtepazott jatekos halala senkihez nem tartozna -- pedig eppen az a
 * tamado erdeme.
 */
export const KILL_CREDIT_MS = 10_000;

/**
 * Jar-e a kiloves a tamadonak?
 *
 * Nem jar, ha (a) nem volt tamado, (b) a jatekos sajat maga sebezte
 * utoljara, vagy (c) mar tul reg volt -- lasd KILL_CREDIT_MS.
 */
export function killCredited(
  tamado: { id: string; at: number } | null,
  aldozatId: string,
  now: number,
): boolean {
  if (!tamado) return false;
  if (tamado.id === aldozatId) return false;
  return now - tamado.at <= KILL_CREDIT_MS;
}
