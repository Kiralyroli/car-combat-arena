/**
 * Jatekos-nevek szabalyai.
 *
 * SZANDEKOSAN a shared csomagban: a szerver ezt ervenyesiti (o az
 * egyetlen hiteles forras), a kliens pedig ugyanezt hasznalja a
 * beviteli mezo korlatozasahoz -- igy a jatekos nem gepel be olyan
 * nevet, amit a szerver utana csendben levag.
 */

/** Ennel hosszabb nevet levagunk. */
export const MAX_NAME_LENGTH = 16;

/** Ha nincs (ertelmes) nev, ezzel a prefixszel keszul egy alapertelmezett. */
const DEFAULT_PREFIX = "Jatekos";

/**
 * Vezerlo- es formazo karakterek.
 *
 * Ki KELL szurni oket: nelkuluk egy nev eltorhetne a kirajzolast
 * (sortores a sprite-on), vagy a jobbrol-balra vezerlokkel
 * osszekeverhetne az eredmenyjelzo tobbi sorat.
 *
 * A HTML-be szurast NEM ez oldja meg -- azt a megjelenites vegzi,
 * szoveg-csomopontkent (lasd a scoreboard rajzolasat). Ez csak azt
 * garantalja, hogy a LATHATO tartalom ertelmes, egysoros szoveg legyen.
 */
const CONTROL_CHARS = new RegExp(
  "[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\ufeff]",
  "g",
);

/** Nev tisztitasa: korlatozott hossz, csak lathato karakterek. */
export function sanitizePlayerName(
  raw: string | undefined,
  fallbackSeed: string,
): string {
  const cleaned = (raw ?? "")
    .replace(CONTROL_CHARS, "")
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();

  if (cleaned.length > 0) return cleaned;

  // Ures nev helyett stabil, felismerheto alapertelmezett: a jatekos
  // azonositojanak elso karakterei. Igy ket nevtelen jatekos sem lesz
  // megkulonboztethetetlen egymastol.
  return `${DEFAULT_PREFIX}-${fallbackSeed.slice(0, 4).toUpperCase()}`;
}
