/**
 * SEBZES-SZAMOK: mennyi eletet vesztett most a jatekos.
 *
 * A szam KET helyen jelenik meg, ugyanabbol a szabalybol: a tavoli
 * autok HP-savja folott a palyan, es a sajat HP-savunk folott a HUD bal
 * also sarkaban. Egy szabaly, ket felhasznalo -- ha kulon elnenek, a
 * ketto elobb-utobb mast mutatna ugyanarrol a talalatrol.
 *
 * MIERT A HP-KULONBSEGBOL, es nem egy szerver-oldali sebzes-esemenybol:
 * eletet sokfele dolog visz el (rakéta, gepfegyver, robbanas, utkozes,
 * kerek-serules), es mind mas utvonalon. Egyetlen kimaradt esemeny
 * csendes hiany lenne a kijelzon. A HP viszont MINDEN utat magaba
 * foglal, benne van minden snapshotban, es eppen azt a szamot adja,
 * ami a jatekost erdekli: mennyivel lett kevesebb.
 *
 * MIERT ITT, a kozos csomagban: tiszta szabaly, halozat es motor
 * nelkul -- Node alatt merheto (lasd check:damage-numbers).
 */

/**
 * Mennyi eletet vesztett a jatekos ket mintavetel kozott.
 *
 * Nulla, ha nem vesztett -- es kulonosen nulla harom olyan esetben,
 * amikor a puszta kivonas hazudna:
 *
 *  - ELSO LATAS (`elozo` null): egy most csatlakozo jatekos 100-rol
 *    indulna a mi konyvelesunkben, es egy mar megtepazott ellenfel
 *    folott azonnal felvillanna egy sosem tortent talalat.
 *  - GYOGYULAS (`most` nagyobb): ott nem vesztes tortent. Ugyanez fedi
 *    le az ujraszuletest is (0 -> 100).
 *  - MAR HALOTT volt (`elozo` nulla): halott jatekost nem sebez senki;
 *    ami innen valtozik, az ujraszuletes.
 *
 * A HALALOS talalat viszont BENNE van (pl. 30 -> 0): az az utolso, es
 * a legfontosabb szam a parharcban.
 */
export function hpLoss(elozo: number | null | undefined, most: number): number {
  if (elozo === null || elozo === undefined) return 0;
  if (elozo <= 0) return 0;
  return Math.max(0, elozo - most);
}

/**
 * Meddig latszik egy sebzes-szam (ms).
 *
 * Rovid: a szam a TALALAT visszajelzese, nem allapot-kijelzo. Ha
 * tovabb maradna, egy gepfegyver-sorozat alatt folyamatosan ott ulne, es
 * elvesztene azt, amiert kell -- hogy egy uj talalat feltunjon.
 */
export const DAMAGE_NUMBER_MS = 1100;

/**
 * Az utolso ennyi ezredmasodpercben halvanyul el.
 *
 * Nem az egesz elettartam alatt: egy vegig halvanyulo szam a felenel
 * mar alig olvashato -- pont akkor, amikor a jatekos odanez.
 */
export const DAMAGE_NUMBER_FADE_MS = 450;

/**
 * Mennyit emelkedik kozben a szam a palyan (m).
 *
 * A MOZGAS a lenyeg, nem a tavolsag: egy helyben allo szamot a szem a
 * kep szelen nem veszi eszre, egy elinduloat igen. Ennyi eppen annyi,
 * hogy elvaljon a HP-savtol, de ne usszon el az autotol.
 */
export const DAMAGE_NUMBER_RISE = 0.8;

/**
 * Hol kezd a szam a HP-sav folott (m).
 *
 * A HP-SAVHOZ kotve, nem az autohoz: a jatekos a savot nezi, amikor az
 * elete fogy, es a szamnak ott kell megjelennie, ahol a valtozast latja.
 */
export const DAMAGE_NUMBER_OFFSET = 0.45;

/**
 * Mennyire latszik a szam az eltelt ido alapjan (0..1).
 *
 * Nulla, ha mar lejart -- a hivo ebbol tudja, hogy el is tuntetheti.
 */
export function damageNumberOpacity(eltelt: number): number {
  if (eltelt < 0 || eltelt >= DAMAGE_NUMBER_MS) return 0;
  const hatra = DAMAGE_NUMBER_MS - eltelt;
  if (hatra >= DAMAGE_NUMBER_FADE_MS) return 1;
  return hatra / DAMAGE_NUMBER_FADE_MS;
}

/** Mennyivel all feljebb a szam az eltelt ido alapjan (m). */
export function damageNumberRise(eltelt: number): number {
  const arany = Math.max(0, Math.min(1, eltelt / DAMAGE_NUMBER_MS));
  return DAMAGE_NUMBER_RISE * arany;
}
