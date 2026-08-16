/**
 * Last Car Standing meccs-logika (terv 5. lepcso 2. pont).
 *
 * Minden jatekos 3 elettel indul. Megsemmisuleskor egy elet elvesz;
 * amig van meg, 5 masodperc mulva ujraszuletik. Ha elfogyott, KIESIK --
 * nem szuletik ujra, hanem nezokent kovetheti a meccset. Az utolso
 * talpon marado jatekos nyer.
 *
 * A meccs-allapotot a SZERVER birtokolja (terv 15.4: minden
 * kovetkezmeny a szerveré). Ez a modul viszont TISZTA FUGGVENYEKET ad
 * hozza, a shared csomagban: igy a szabalyok headlessen, bongeszo
 * nelkul tesztelhetok, es nem a szerver belso allapotan keresztul kell
 * kovetkeztetni rajuk.
 */

/** Hany elettel indul mindenki. */
export const LIVES_PER_PLAYER = 3;

/**
 * Megsemmisules utan ennyi ido mulva szuletik ujra (ms) -- ha van meg
 * elete. Eleg hosszu ahhoz, hogy a halalnak sulya legyen, de nem annyi,
 * hogy a jatekos kiessen a meccs ritmusabol.
 */
export const RESPAWN_DELAY_MS = 5000;

/** A meccs vege utan ennyivel indul az uj meccs (ms). */
export const MATCH_RESTART_DELAY_MS = 10000;

/**
 * Ennyi jatekos kell a meccs elinditasahoz.
 *
 * Egy jatekossal nincs ertelme: azonnal "gyoztes" lenne. Amig egyedul
 * van valaki a szobaban, a meccs VARAKOZIK -- vezetni lehet, de eletek
 * nem fogynak, es nincs gyoztes-hirdetes.
 */
export const MIN_PLAYERS_TO_START = 2;

export type MatchPhase =
  /** Keves jatekos: szabad vezetes, a meccs meg nem indult el. */
  | "waiting"
  /** Fut a meccs, fogynak az eletek. */
  | "playing"
  /** Vege: van gyoztes (vagy dontetlen), es az eredmenyjelzo latszik. */
  | "ended";

/** Egy jatekos allapota a meccs szempontjabol. */
export interface MatchParticipant {
  id: string;
  lives: number;
}

/** Kiesett-e a jatekos (elfogytak az eletei)? */
export function isEliminated(player: MatchParticipant): boolean {
  return player.lives <= 0;
}

/** Hany jatekos van meg talpon. */
export function survivorsOf(players: readonly MatchParticipant[]): MatchParticipant[] {
  return players.filter((p) => !isEliminated(p));
}

/**
 * Veget ert-e a meccs?
 *
 * Akkor ER VEGET, ha legfeljebb egy jatekos maradt talpon. A nulla is
 * ide tartozik: ha az utolso ketto egyszerre semmisul meg (fejtalalkozas
 * vagy kozos robbanas), a meccsnek akkor is le kell zarulnia --
 * kulonben a szoba orokre "playing" allapotban ragadna.
 */
export function isMatchOver(players: readonly MatchParticipant[]): boolean {
  return survivorsOf(players).length <= 1;
}

/**
 * A gyoztes, vagy null dontetlennel.
 *
 * Dontetlen akkor van, ha senki nem maradt talpon (lasd isMatchOver).
 */
export function winnerOf(
  players: readonly MatchParticipant[],
): MatchParticipant | null {
  const survivors = survivorsOf(players);
  return survivors.length === 1 ? survivors[0] : null;
}

/**
 * Elindulhat-e a meccs ennyi jatekossal?
 *
 * Kulon fuggveny, mert ket helyen kell: a szoba indulasakor es akkor is,
 * amikor valaki csatlakozik egy varakozo szobahoz.
 */
export function canStart(playerCount: number): boolean {
  return playerCount >= MIN_PLAYERS_TO_START;
}
