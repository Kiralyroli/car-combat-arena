/**
 * A gepfegyver hoszintjenek MEGJELENITESE.
 *
 * Ugyanaz a megfontolas, mint a wheelVisuals.ts-nel: a szabaly egy
 * helyen all, es tiszta fuggveny -- tehat bongeszo nelkul is merheto
 * (lasd check-weapons.ts), nem csak ranezesre iteltheto meg.
 *
 * MIERT SZIN, es nem csak szam: a jatekos a harc kozben nem olvas
 * szazalekot. A szin perifériasan is latszik -- azt akarjuk, hogy
 * ranezes nelkul is erezze, mikor kozeledik a lefulladas.
 */

/** A skala vegpontjai HSL-ben, a jatek meglevo paletajabol. */
const HIDEG = { h: 127, s: 48, l: 47 }; // #3fb950 -- ugyanaz a zold, mint a HP-savon
const FORRO = { h: 2, s: 92, l: 63 }; //  #f85149 -- ugyanaz a piros, mint a kritikus HP

/**
 * A hoszint szine (CSS), 0..100 kozott.
 *
 * A skala NEM lineáris: a negyzetes gorbe miatt az also felen alig
 * valtozik, a felso harmadban viszont gyorsan pirosodik. Ez felel meg
 * annak, amit a szam jelent -- 40%-nal meg bátran lehet tuzelni,
 * 85%-nal viszont mar szamolni kell a lefulladassal.
 */
export function heatColor(percent: number): string {
  const t = Math.max(0, Math.min(1, percent / 100)) ** 2;
  const h = Math.round(HIDEG.h + (FORRO.h - HIDEG.h) * t);
  const s = Math.round(HIDEG.s + (FORRO.s - HIDEG.s) * t);
  const l = Math.round(HIDEG.l + (FORRO.l - HIDEG.l) * t);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/**
 * Meddig villogjon a kijelzo a lefulladas utan (ms).
 *
 * ROVID: a villogas figyelmeztetes, nem allapot-jelzes. A lefulladas
 * maga masodpercekig tart (a hulesig), es ha vegig villogna, a jatekos
 * a sajat HUD-jat nezne a harc helyett. Ket villanas eleg ahhoz, hogy
 * elkapja a szem.
 */
export const OVERHEAT_FLASH_MS = 900;
