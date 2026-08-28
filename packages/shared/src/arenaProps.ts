/**
 * Az epulet-modellek MERT meretei es TALAJSZINTI alaprajza.
 *
 * GENERALT FAJL -- ne szerkeszd kezzel. A
 * packages/client/scripts/kit-meret.ts allitja elo a modellbol
 * (epuletek.glb), ugy, ahogy a jatek betolti (npm run kit-meret).
 *
 * MIERT GENERALT: az utkozo doboznak PONTOSAN azt kell fednie, amit a
 * jatekos lat. Kezzel beirt szamoknal a ketto eszrevetlenul elcsuszna
 * -- a jatekos a falnak menne ott, ahol nincs fal, vagy athajtana egy
 * epuleten. Igy viszont a szam a modellbol jon, es a modell csereje
 * automatikusan atvezetodik.
 *
 * A meretek a JATEK tengelyeire vannak szamolva: szelesseg = X,
 * melyseg = Z, magassag = Y (a modellben a Blender Z-je a magassag).
 */

export interface PropMeret {
  szelesseg: number;
  melyseg: number;
  magassag: number;
}

/**
 * Egy utkozo teglalap a modell alaprajzabol.
 *
 * A dx/dz a teglalap kozeppontja a MODELL sajat origojahoz kepest (az
 * origo a talpon all, vizszintesen a modell kozepen).
 */
export interface PropTalp {
  dx: number;
  dz: number;
  szelesseg: number;
  melyseg: number;
  /**
   * A doboz magassaga: ameddig e folott a modell tart.
   *
   * NEM a modell teljes magassaga. Egy 1,4 m-es rakodoperon kulonben
   * nyolcmeteres falkent allitana meg a lovedeket.
   */
  magassag: number;
}

export const PROP_MERETEK = {
  Building_1: { szelesseg: 27.018, melyseg: 47.545, magassag: 16.633 },
  Building_10: { szelesseg: 43.499, melyseg: 83.266, magassag: 25.825 },
  Duplex_1: { szelesseg: 20.891, melyseg: 9.474, magassag: 8.764 },
  FactoryPlant_1: { szelesseg: 46.535, melyseg: 95.302, magassag: 24.73 },
  FactoryPlant_2: { szelesseg: 33, melyseg: 135.8, magassag: 18.266 },
  GenericBuilding_4: { szelesseg: 35.14, melyseg: 14.966, magassag: 5.88 },
  Hangar_2: { szelesseg: 49.784, melyseg: 59.957, magassag: 12.886 },
  LogisticTerminal_1: { szelesseg: 53.434, melyseg: 15.844, magassag: 7.882 },
  Powerplant_1: { szelesseg: 99.295, melyseg: 191.093, magassag: 89.077 },
  Radiotower_1: { szelesseg: 4.648, melyseg: 4.31, magassag: 24.065 },
  Railroad_Loadbay_Shed_1: { szelesseg: 14.854, melyseg: 27.766, magassag: 9.751 },
  SiloTank_1: { szelesseg: 3.05, melyseg: 3.192, magassag: 8.896 },
  Tank_3: { szelesseg: 5.955, melyseg: 6.75, magassag: 7.324 },
  Tank_4: { szelesseg: 4.581, melyseg: 4.6, magassag: 18.651 },
  Warehouse_1: { szelesseg: 33.833, melyseg: 13.36, magassag: 11.123 },
  Warehouse_4: { szelesseg: 42.076, melyseg: 13.589, magassag: 9.383 },
  Warehouse_5: { szelesseg: 33, melyseg: 54.938, magassag: 11.684 },
  WarehouseSmall_4: { szelesseg: 7.478, melyseg: 10.457, magassag: 5.04 },
  Watertower_1: { szelesseg: 9.794, melyseg: 9.751, magassag: 24.261 },
} as const;

/**
 * A modellek alaprajza 2.5 m magassagig, teglalapokkal fedve.
 *
 * MIERT NEM a teljes befoglalo doboz: egy nyitott acelszerkezetnel vagy
 * egy negy labon allo viztoronynal az durvan hazudna. Merve: a
 * Watertower_1 befoglalo dobozanak 17%-a tomor talajszinten -- a tobbi
 * helyen at kellene lehessen hajtani.
 *
 * Minden teglalap TELJESEN a modell alaprajzan belul van, tehat nincs
 * utkozes ott, ahol a modellnek nyoma sincs.
 */
export const PROP_TALPAK: Record<string, PropTalp[]> = {
  // 15 doboz; a befoglalo 92%-a tomor talajszinten
  Building_1: [
    { dx: 0.25, dz: 0, szelesseg: 26.5, melyseg: 46, magassag: 16.633 },
    { dx: -13.25, dz: -22.25, szelesseg: 0.5, melyseg: 2.5, magassag: 12.626 },
    { dx: -13.25, dz: 22.25, szelesseg: 0.5, melyseg: 2.5, magassag: 12.626 },
    { dx: -13.25, dz: -13, szelesseg: 0.5, melyseg: 2, magassag: 12.626 },
    { dx: -13.25, dz: -4, szelesseg: 0.5, melyseg: 2, magassag: 12.626 },
    { dx: -13.25, dz: 4, szelesseg: 0.5, melyseg: 2, magassag: 12.626 },
    { dx: -13.25, dz: 13, szelesseg: 0.5, melyseg: 2, magassag: 12.626 },
    { dx: -12, dz: -23.25, szelesseg: 2, melyseg: 0.5, magassag: 12.626 },
    { dx: -12, dz: 23.25, szelesseg: 2, melyseg: 0.5, magassag: 12.626 },
    { dx: -4.5, dz: -23.25, szelesseg: 2, melyseg: 0.5, magassag: 12.626 },
    { dx: -4.5, dz: 23.25, szelesseg: 2, melyseg: 0.5, magassag: 12.626 },
    { dx: 4.5, dz: -23.25, szelesseg: 2, melyseg: 0.5, magassag: 12.626 },
    { dx: 4.5, dz: 23.25, szelesseg: 2, melyseg: 0.5, magassag: 12.626 },
    { dx: 12.5, dz: -23.25, szelesseg: 2, melyseg: 0.5, magassag: 12.626 },
    { dx: 12.5, dz: 23.25, szelesseg: 2, melyseg: 0.5, magassag: 12.626 },
  ],
  // 31 doboz; a befoglalo 85%-a tomor talajszinten
  Building_10: [
    { dx: 0, dz: 0, szelesseg: 38, melyseg: 76, magassag: 25.825 },
    { dx: -14.25, dz: -40, szelesseg: 6.5, melyseg: 4, magassag: 23.066 },
    { dx: 14.25, dz: 40, szelesseg: 6.5, melyseg: 4, magassag: 23.066 },
    { dx: -19.5, dz: -38, szelesseg: 1, melyseg: 2, magassag: 23.066 },
    { dx: -19.5, dz: 38, szelesseg: 1, melyseg: 2, magassag: 23.066 },
    { dx: 19, dz: -38.5, szelesseg: 2, melyseg: 1, magassag: 23.066 },
    { dx: 19, dz: 38.5, szelesseg: 2, melyseg: 1, magassag: 23.066 },
    { dx: -19.25, dz: -28.5, szelesseg: 0.5, melyseg: 2, magassag: 23.066 },
    { dx: -19.25, dz: -19, szelesseg: 0.5, melyseg: 2, magassag: 23.066 },
    { dx: -19.25, dz: -9.5, szelesseg: 0.5, melyseg: 2, magassag: 23.066 },
    { dx: -19.25, dz: 0, szelesseg: 0.5, melyseg: 2, magassag: 23.066 },
    { dx: -19.25, dz: 9.5, szelesseg: 0.5, melyseg: 2, magassag: 23.066 },
    { dx: -19.25, dz: 19, szelesseg: 0.5, melyseg: 2, magassag: 23.066 },
    { dx: -19.25, dz: 28.5, szelesseg: 0.5, melyseg: 2, magassag: 23.066 },
    { dx: -18.5, dz: -38.5, szelesseg: 1, melyseg: 1, magassag: 23.066 },
    { dx: -18.5, dz: 38.5, szelesseg: 1, melyseg: 1, magassag: 23.066 },
    { dx: -9.5, dz: -38.25, szelesseg: 2, melyseg: 0.5, magassag: 24.987 },
    { dx: -9.5, dz: 38.25, szelesseg: 2, melyseg: 0.5, magassag: 24.987 },
    { dx: 0, dz: -38.25, szelesseg: 2, melyseg: 0.5, magassag: 25.825 },
    { dx: 0, dz: 38.25, szelesseg: 2, melyseg: 0.5, magassag: 25.825 },
    { dx: 9.5, dz: -38.25, szelesseg: 2, melyseg: 0.5, magassag: 24.987 },
    { dx: 9.5, dz: 38.25, szelesseg: 2, melyseg: 0.5, magassag: 24.987 },
    { dx: 19.5, dz: -37.5, szelesseg: 1, melyseg: 1, magassag: 23.066 },
    { dx: 19.25, dz: -28.5, szelesseg: 0.5, melyseg: 2, magassag: 23.066 },
    { dx: 19.25, dz: -19, szelesseg: 0.5, melyseg: 2, magassag: 23.066 },
    { dx: 19.25, dz: -9.5, szelesseg: 0.5, melyseg: 2, magassag: 23.066 },
    { dx: 19.25, dz: 0, szelesseg: 0.5, melyseg: 2, magassag: 23.066 },
    { dx: 19.25, dz: 9.5, szelesseg: 0.5, melyseg: 2, magassag: 23.066 },
    { dx: 19.25, dz: 19, szelesseg: 0.5, melyseg: 2, magassag: 23.066 },
    { dx: 19.25, dz: 28.5, szelesseg: 0.5, melyseg: 2, magassag: 23.066 },
    { dx: 19.5, dz: 37.5, szelesseg: 1, melyseg: 1, magassag: 23.066 },
  ],
  // 11 doboz; a befoglalo 78%-a tomor talajszinten
  Duplex_1: [
    { dx: 0, dz: -0.5, szelesseg: 20, melyseg: 8, magassag: 8.764 },
    { dx: 6.75, dz: 3.75, szelesseg: 7.5, melyseg: 0.5, magassag: 7.924 },
    { dx: -2.5, dz: 3.75, szelesseg: 4, melyseg: 0.5, magassag: 7.924 },
    { dx: -9.25, dz: 3.75, szelesseg: 2.5, melyseg: 0.5, magassag: 7.924 },
    { dx: 10.25, dz: -2.25, szelesseg: 0.5, melyseg: 1.5, magassag: 3.928 },
    { dx: -10.25, dz: -4, szelesseg: 0.5, melyseg: 1, magassag: 7.924 },
    { dx: -10, dz: 4.25, szelesseg: 1, melyseg: 0.5, magassag: 7.924 },
    { dx: -2.5, dz: 4.25, szelesseg: 1, melyseg: 0.5, magassag: 7.924 },
    { dx: 5, dz: 4.25, szelesseg: 1, melyseg: 0.5, magassag: 7.924 },
    { dx: 10.25, dz: -4, szelesseg: 0.5, melyseg: 1, magassag: 3.928 },
    { dx: -10.25, dz: 3.25, szelesseg: 0.5, melyseg: 0.5, magassag: 7.924 },
  ],
  // 51 doboz; a befoglalo 94%-a tomor talajszinten
  FactoryPlant_1: [
    { dx: 0, dz: -0.25, szelesseg: 43, melyseg: 90.5, magassag: 24.73 },
    { dx: -21.75, dz: 0, szelesseg: 0.5, melyseg: 20, magassag: 16.563 },
    { dx: 21.75, dz: 0, szelesseg: 0.5, melyseg: 20, magassag: 16.563 },
    { dx: -21.75, dz: -36.25, szelesseg: 0.5, melyseg: 19.5, magassag: 16.563 },
    { dx: -21.75, dz: 36.25, szelesseg: 0.5, melyseg: 19.5, magassag: 16.563 },
    { dx: 21.75, dz: -36.25, szelesseg: 0.5, melyseg: 19.5, magassag: 16.563 },
    { dx: 21.75, dz: 36.25, szelesseg: 0.5, melyseg: 19.5, magassag: 16.563 },
    { dx: 0, dz: 45.5, szelesseg: 8, melyseg: 1, magassag: 24.73 },
    { dx: -14.5, dz: -45.75, szelesseg: 8, melyseg: 0.5, magassag: 24.73 },
    { dx: 0, dz: -45.75, szelesseg: 8, melyseg: 0.5, magassag: 24.73 },
    { dx: 14.5, dz: -45.75, szelesseg: 8, melyseg: 0.5, magassag: 24.73 },
    { dx: -22.25, dz: -43, szelesseg: 0.5, melyseg: 6, magassag: 16.563 },
    { dx: 22.25, dz: 43, szelesseg: 0.5, melyseg: 6, magassag: 16.563 },
    { dx: -22.25, dz: 7.25, szelesseg: 0.5, melyseg: 4.5, magassag: 16.563 },
    { dx: -22.25, dz: 43.75, szelesseg: 0.5, melyseg: 4.5, magassag: 16.563 },
    { dx: 22.25, dz: -43.75, szelesseg: 0.5, melyseg: 4.5, magassag: 16.563 },
    { dx: 22.25, dz: -7.25, szelesseg: 0.5, melyseg: 4.5, magassag: 16.563 },
    { dx: -16.5, dz: 45.25, szelesseg: 3, melyseg: 0.5, magassag: 16.563 },
    { dx: -11, dz: 45.25, szelesseg: 3, melyseg: 0.5, magassag: 24.73 },
    { dx: -5.5, dz: 45.25, szelesseg: 3, melyseg: 0.5, magassag: 24.73 },
    { dx: 5.5, dz: 45.25, szelesseg: 3, melyseg: 0.5, magassag: 24.73 },
    { dx: 11, dz: 45.25, szelesseg: 3, melyseg: 0.5, magassag: 24.73 },
    { dx: 16.5, dz: 45.25, szelesseg: 3, melyseg: 0.5, magassag: 16.563 },
    { dx: -22.25, dz: -8.25, szelesseg: 0.5, melyseg: 2.5, magassag: 16.563 },
    { dx: -22.25, dz: 28.25, szelesseg: 0.5, melyseg: 2.5, magassag: 16.563 },
    { dx: 22.25, dz: -28.25, szelesseg: 0.5, melyseg: 2.5, magassag: 16.563 },
    { dx: 22.25, dz: 8.25, szelesseg: 0.5, melyseg: 2.5, magassag: 16.563 },
    { dx: -22.25, dz: -36.25, szelesseg: 0.5, melyseg: 1.5, magassag: 16.563 },
    { dx: -22.25, dz: -31.75, szelesseg: 0.5, melyseg: 1.5, magassag: 16.563 },
    { dx: -22.25, dz: -3.25, szelesseg: 0.5, melyseg: 1.5, magassag: 16.563 },
    { dx: -22.25, dz: 1.25, szelesseg: 0.5, melyseg: 1.5, magassag: 16.563 },
    { dx: -22.25, dz: 33.25, szelesseg: 0.5, melyseg: 1.5, magassag: 16.563 },
    { dx: -22.25, dz: 37.75, szelesseg: 0.5, melyseg: 1.5, magassag: 16.563 },
    { dx: -16.75, dz: 45.75, szelesseg: 1.5, melyseg: 0.5, magassag: 16.563 },
    { dx: -7.25, dz: -45.75, szelesseg: 1.5, melyseg: 0.5, magassag: 24.73 },
    { dx: 7.25, dz: -45.75, szelesseg: 1.5, melyseg: 0.5, magassag: 24.73 },
    { dx: 16.75, dz: 45.75, szelesseg: 1.5, melyseg: 0.5, magassag: 16.563 },
    { dx: 22.25, dz: -37.75, szelesseg: 0.5, melyseg: 1.5, magassag: 16.563 },
    { dx: 22.25, dz: -33.25, szelesseg: 0.5, melyseg: 1.5, magassag: 16.563 },
    { dx: 22.25, dz: -1.25, szelesseg: 0.5, melyseg: 1.5, magassag: 16.563 },
    { dx: 22.25, dz: 3.25, szelesseg: 0.5, melyseg: 1.5, magassag: 16.563 },
    { dx: 22.25, dz: 31.75, szelesseg: 0.5, melyseg: 1.5, magassag: 16.563 },
    { dx: 22.25, dz: 36.25, szelesseg: 0.5, melyseg: 1.5, magassag: 16.563 },
    { dx: -22.25, dz: -27.5, szelesseg: 0.5, melyseg: 1, magassag: 16.563 },
    { dx: -21, dz: 45.25, szelesseg: 1, melyseg: 0.5, magassag: 16.563 },
    { dx: -11, dz: 45.75, szelesseg: 1, melyseg: 0.5, magassag: 24.73 },
    { dx: -5.5, dz: 45.75, szelesseg: 1, melyseg: 0.5, magassag: 24.73 },
    { dx: 5.5, dz: 45.75, szelesseg: 1, melyseg: 0.5, magassag: 24.73 },
    { dx: 11, dz: 45.75, szelesseg: 1, melyseg: 0.5, magassag: 24.73 },
    { dx: 21, dz: 45.25, szelesseg: 1, melyseg: 0.5, magassag: 16.563 },
    { dx: 22.25, dz: 27.5, szelesseg: 0.5, melyseg: 1, magassag: 16.563 },
  ],
  // 15 doboz; a befoglalo 94%-a tomor talajszinten
  FactoryPlant_2: [
    { dx: 0, dz: 0, szelesseg: 32, melyseg: 134, magassag: 18.266 },
    { dx: -2.75, dz: 67.25, szelesseg: 23.5, melyseg: 0.5, magassag: 15.508 },
    { dx: 2.75, dz: -67.25, szelesseg: 23.5, melyseg: 0.5, magassag: 15.508 },
    { dx: -16.25, dz: -34.25, szelesseg: 0.5, melyseg: 7.5, magassag: 11.755 },
    { dx: -16.25, dz: 33.75, szelesseg: 0.5, melyseg: 7.5, magassag: 11.755 },
    { dx: 16.25, dz: -33.75, szelesseg: 0.5, melyseg: 7.5, magassag: 11.755 },
    { dx: 16.25, dz: 34.25, szelesseg: 0.5, melyseg: 7.5, magassag: 11.755 },
    { dx: -16.25, dz: -56, szelesseg: 0.5, melyseg: 5, magassag: 11.755 },
    { dx: -16.25, dz: -12, szelesseg: 0.5, melyseg: 5, magassag: 11.755 },
    { dx: -16.25, dz: 12, szelesseg: 0.5, melyseg: 5, magassag: 11.755 },
    { dx: -16.25, dz: 56, szelesseg: 0.5, melyseg: 5, magassag: 11.755 },
    { dx: 16.25, dz: -56, szelesseg: 0.5, melyseg: 5, magassag: 11.755 },
    { dx: 16.25, dz: -12, szelesseg: 0.5, melyseg: 5, magassag: 11.755 },
    { dx: 16.25, dz: 12, szelesseg: 0.5, melyseg: 5, magassag: 11.755 },
    { dx: 16.25, dz: 56, szelesseg: 0.5, melyseg: 5, magassag: 11.755 },
  ],
  // 1 doboz; a befoglalo 91%-a tomor talajszinten
  GenericBuilding_4: [
    { dx: 0, dz: 0, szelesseg: 35, melyseg: 15, magassag: 5.88 },
  ],
  // 27 doboz; a befoglalo 15%-a tomor talajszinten
  Hangar_2: [
    { dx: -22.75, dz: 0, szelesseg: 2.5, melyseg: 60, magassag: 11.498 },
    { dx: 22.75, dz: 0, szelesseg: 2.5, melyseg: 60, magassag: 11.498 },
    { dx: -15.25, dz: -28.5, szelesseg: 12.5, melyseg: 1, magassag: 12.886 },
    { dx: 15.25, dz: 28.5, szelesseg: 12.5, melyseg: 1, magassag: 12.886 },
    { dx: -19.5, dz: 28.5, szelesseg: 4, melyseg: 3, magassag: 11.498 },
    { dx: 15.5, dz: -28.5, szelesseg: 12, melyseg: 1, magassag: 12.886 },
    { dx: -24.25, dz: 19.5, szelesseg: 0.5, melyseg: 21, magassag: 11.498 },
    { dx: -12, dz: -14.25, szelesseg: 1, melyseg: 10.5, magassag: 12.389 },
    { dx: -12, dz: 14.25, szelesseg: 1, melyseg: 10.5, magassag: 12.389 },
    { dx: 12, dz: -14.25, szelesseg: 1, melyseg: 10.5, magassag: 12.389 },
    { dx: 12, dz: 14.25, szelesseg: 1, melyseg: 10.5, magassag: 12.389 },
    { dx: 24.25, dz: -19.5, szelesseg: 0.5, melyseg: 21, magassag: 11.498 },
    { dx: -13.5, dz: 28.5, szelesseg: 8, melyseg: 1, magassag: 12.886 },
    { dx: -19.5, dz: -29.5, szelesseg: 4, melyseg: 1, magassag: 11.498 },
    { dx: -19.5, dz: -27.5, szelesseg: 4, melyseg: 1, magassag: 11.498 },
    { dx: 19.5, dz: -29.5, szelesseg: 4, melyseg: 1, magassag: 11.498 },
    { dx: 19.5, dz: -27.5, szelesseg: 4, melyseg: 1, magassag: 11.498 },
    { dx: 19.5, dz: 27.5, szelesseg: 4, melyseg: 1, magassag: 11.498 },
    { dx: 19.5, dz: 29.5, szelesseg: 4, melyseg: 1, magassag: 11.498 },
    { dx: -24.5, dz: -28.5, szelesseg: 1, melyseg: 3, magassag: 11.498 },
    { dx: 24.5, dz: 28.5, szelesseg: 1, melyseg: 3, magassag: 11.498 },
    { dx: -24.75, dz: 28.5, szelesseg: 0.5, melyseg: 3, magassag: 11.498 },
    { dx: 24.75, dz: -28.5, szelesseg: 0.5, melyseg: 3, magassag: 11.498 },
    { dx: -11.25, dz: -9.75, szelesseg: 0.5, melyseg: 1.5, magassag: 12.389 },
    { dx: -11.25, dz: -19, szelesseg: 0.5, melyseg: 1, magassag: 12.389 },
    { dx: -11.25, dz: 9.5, szelesseg: 0.5, melyseg: 1, magassag: 12.389 },
    { dx: -11.25, dz: 19, szelesseg: 0.5, melyseg: 1, magassag: 12.389 },
  ],
  // 11 doboz; a befoglalo 83%-a tomor talajszinten
  LogisticTerminal_1: [
    { dx: 0, dz: -1, szelesseg: 54, melyseg: 14, magassag: 7.882 },
    { dx: -20.75, dz: 6.75, szelesseg: 2.5, melyseg: 1.5, magassag: 2.059 },
    { dx: -9, dz: 6.25, szelesseg: 5, melyseg: 0.5, magassag: 1.372 },
    { dx: 2.5, dz: 6.25, szelesseg: 5, melyseg: 0.5, magassag: 5.11 },
    { dx: 14, dz: 6.25, szelesseg: 5, melyseg: 0.5, magassag: 5.162 },
    { dx: -14.75, dz: 6.25, szelesseg: 4.5, melyseg: 0.5, magassag: 1.372 },
    { dx: -3.25, dz: 6.25, szelesseg: 4.5, melyseg: 0.5, magassag: 1.372 },
    { dx: 8.25, dz: 6.25, szelesseg: 4.5, melyseg: 0.5, magassag: 1.372 },
    { dx: 19.75, dz: 6.25, szelesseg: 4.5, melyseg: 0.5, magassag: 5.75 },
    { dx: -21.5, dz: 7.75, szelesseg: 1, melyseg: 0.5, magassag: 2.059 },
    { dx: -20, dz: 7.75, szelesseg: 1, melyseg: 0.5, magassag: 2.059 },
  ],
  // 24 doboz; a befoglalo 86%-a tomor talajszinten
  Powerplant_1: [
    { dx: -6.25, dz: 0, szelesseg: 71.5, melyseg: 189, magassag: 89.077 },
    { dx: 39.5, dz: 46.75, szelesseg: 20, melyseg: 96.5, magassag: 20.512 },
    { dx: -45.75, dz: -0.75, szelesseg: 7.5, melyseg: 134.5, magassag: 35.564 },
    { dx: 5.5, dz: 94.75, szelesseg: 48, melyseg: 0.5, magassag: 35.564 },
    { dx: -21.75, dz: -94.75, szelesseg: 40.5, melyseg: 0.5, magassag: 40.59 },
    { dx: -42.25, dz: 78.75, szelesseg: 0.5, melyseg: 24.5, magassag: 35.564 },
    { dx: -33.5, dz: -95.25, szelesseg: 17, melyseg: 0.5, magassag: 35.564 },
    { dx: -49.75, dz: -34.5, szelesseg: 0.5, melyseg: 14, magassag: 10.063 },
    { dx: -49.75, dz: -0.5, szelesseg: 0.5, melyseg: 14, magassag: 10.063 },
    { dx: -49.75, dz: 33, szelesseg: 0.5, melyseg: 14, magassag: 10.063 },
    { dx: -36.75, dz: 94.75, szelesseg: 10.5, melyseg: 0.5, magassag: 40.59 },
    { dx: -6.75, dz: -95.25, szelesseg: 10.5, melyseg: 0.5, magassag: 40.59 },
    { dx: -42.25, dz: -89, szelesseg: 0.5, melyseg: 5, magassag: 35.564 },
    { dx: 29.75, dz: -50.5, szelesseg: 0.5, melyseg: 5, magassag: 9.252 },
    { dx: 49.75, dz: 65.5, szelesseg: 0.5, melyseg: 5, magassag: 9.252 },
    { dx: 29.75, dz: -72.25, szelesseg: 0.5, melyseg: 4.5, magassag: 9.252 },
    { dx: 29.75, dz: -29.25, szelesseg: 0.5, melyseg: 4.5, magassag: 9.252 },
    { dx: 29.75, dz: -7.25, szelesseg: 0.5, melyseg: 4.5, magassag: 9.252 },
    { dx: 49.75, dz: 88.25, szelesseg: 0.5, melyseg: 4.5, magassag: 9.252 },
    { dx: -42.75, dz: 69.25, szelesseg: 0.5, melyseg: 2.5, magassag: 9.514 },
    { dx: -42.75, dz: 84.75, szelesseg: 0.5, melyseg: 2.5, magassag: 9.514 },
    { dx: -25.5, dz: 94.75, szelesseg: 1, melyseg: 0.5, magassag: 35.564 },
    { dx: -18, dz: -95.25, szelesseg: 1, melyseg: 0.5, magassag: 35.564 },
    { dx: -42.25, dz: -68.25, szelesseg: 0.5, melyseg: 0.5, magassag: 35.564 },
  ],
  // 5 doboz; a befoglalo 69%-a tomor talajszinten
  Radiotower_1: [
    { dx: 0, dz: -0.125, szelesseg: 4, melyseg: 3.75, magassag: 24.065 },
    { dx: -1.75, dz: -2.125, szelesseg: 1, melyseg: 0.25, magassag: 1.547 },
    { dx: -1.75, dz: 1.875, szelesseg: 1, melyseg: 0.25, magassag: 1.547 },
    { dx: 1.75, dz: -2.125, szelesseg: 1, melyseg: 0.25, magassag: 11.439 },
    { dx: 1.75, dz: 1.875, szelesseg: 1, melyseg: 0.25, magassag: 6.879 },
  ],
  // 2 doboz; a befoglalo 12%-a tomor talajszinten
  Railroad_Loadbay_Shed_1: [
    { dx: -7, dz: 0, szelesseg: 1, melyseg: 28, magassag: 9.751 },
    { dx: 7, dz: 0, szelesseg: 1, melyseg: 28, magassag: 9.751 },
  ],
  // 5 doboz; a befoglalo 50%-a tomor talajszinten
  SiloTank_1: [
    { dx: -0.25, dz: -0.25, szelesseg: 2.5, melyseg: 2.5, magassag: 8.896 },
    { dx: -0.25, dz: -1.625, szelesseg: 1.5, melyseg: 0.25, magassag: 7.18 },
    { dx: 1.125, dz: -0.25, szelesseg: 0.25, melyseg: 1.5, magassag: 8.74 },
    { dx: -0.25, dz: 1.5, szelesseg: 0.5, melyseg: 0.5, magassag: 6.124 },
    { dx: 1.5, dz: -0.25, szelesseg: 0.5, melyseg: 0.5, magassag: 8.43 },
  ],
  // 4 doboz; a befoglalo 72%-a tomor talajszinten
  Tank_3: [
    { dx: 0, dz: -0.375, szelesseg: 6, melyseg: 5.25, magassag: 7.324 },
    { dx: 0, dz: -3.25, szelesseg: 3, melyseg: 0.5, magassag: 1.428 },
    { dx: 0, dz: 2.5, szelesseg: 3, melyseg: 0.5, magassag: 4.944 },
    { dx: 0, dz: 3.125, szelesseg: 0.5, melyseg: 0.75, magassag: 4.944 },
  ],
  // 7 doboz; a befoglalo 43%-a tomor talajszinten
  Tank_4: [
    { dx: -0.125, dz: -0.125, szelesseg: 2.75, melyseg: 2.75, magassag: 18.651 },
    { dx: -1.625, dz: -0.125, szelesseg: 0.25, melyseg: 1.75, magassag: 17.515 },
    { dx: -0.125, dz: -1.625, szelesseg: 1.75, melyseg: 0.25, magassag: 17.515 },
    { dx: -0.125, dz: 1.375, szelesseg: 1.75, melyseg: 0.25, magassag: 17.515 },
    { dx: 1.375, dz: -0.125, szelesseg: 0.25, melyseg: 1.75, magassag: 18.651 },
    { dx: 0, dz: 2.25, szelesseg: 0.5, melyseg: 0.5, magassag: 12.398 },
    { dx: 2.25, dz: -0.25, szelesseg: 0.5, melyseg: 0.5, magassag: 18.459 },
  ],
  // 8 doboz; a befoglalo 87%-a tomor talajszinten
  Warehouse_1: [
    { dx: 0, dz: 0, szelesseg: 33, melyseg: 12, magassag: 11.123 },
    { dx: -12.25, dz: -6.25, szelesseg: 9.5, melyseg: 0.5, magassag: 9.643 },
    { dx: 12.5, dz: -6.25, szelesseg: 9, melyseg: 0.5, magassag: 9.643 },
    { dx: 0, dz: -6.25, szelesseg: 7, melyseg: 0.5, magassag: 9.643 },
    { dx: -16.75, dz: -5.25, szelesseg: 0.5, melyseg: 1.5, magassag: 9.643 },
    { dx: -16.75, dz: 5.25, szelesseg: 0.5, melyseg: 1.5, magassag: 9.643 },
    { dx: 16.75, dz: -5.25, szelesseg: 0.5, melyseg: 1.5, magassag: 9.643 },
    { dx: 16.75, dz: 5.25, szelesseg: 0.5, melyseg: 1.5, magassag: 9.643 },
  ],
  // 10 doboz; a befoglalo 79%-a tomor talajszinten
  Warehouse_4: [
    { dx: 0, dz: -0.25, szelesseg: 42, melyseg: 10.5, magassag: 9.383 },
    { dx: 14.75, dz: 5.75, szelesseg: 12.5, melyseg: 1.5, magassag: 7.254 },
    { dx: -13.5, dz: 5.5, szelesseg: 15, melyseg: 1, magassag: 7.254 },
    { dx: 14.75, dz: -6, szelesseg: 12.5, melyseg: 1, magassag: 7.254 },
    { dx: -17, dz: 6.25, szelesseg: 8, melyseg: 0.5, magassag: 7.254 },
    { dx: -8.25, dz: 6.25, szelesseg: 4.5, melyseg: 0.5, magassag: 7.254 },
    { dx: -20.5, dz: 6.75, szelesseg: 1, melyseg: 0.5, magassag: 7.254 },
    { dx: 20.5, dz: 6.75, szelesseg: 1, melyseg: 0.5, magassag: 7.254 },
    { dx: -17.75, dz: 6.75, szelesseg: 0.5, melyseg: 0.5, magassag: 6.977 },
    { dx: -16.25, dz: 6.75, szelesseg: 0.5, melyseg: 0.5, magassag: 6.977 },
  ],
  // 5 doboz; a befoglalo 95%-a tomor talajszinten
  Warehouse_5: [
    { dx: 0, dz: 0, szelesseg: 34, melyseg: 53, magassag: 11.684 },
    { dx: -11.25, dz: -26.75, szelesseg: 11.5, melyseg: 0.5, magassag: 11.684 },
    { dx: -11.25, dz: 26.75, szelesseg: 11.5, melyseg: 0.5, magassag: 11.684 },
    { dx: 11.25, dz: -26.75, szelesseg: 11.5, melyseg: 0.5, magassag: 11.684 },
    { dx: 11.25, dz: 26.75, szelesseg: 11.5, melyseg: 0.5, magassag: 11.684 },
  ],
  // 3 doboz; a befoglalo 89%-a tomor talajszinten
  WarehouseSmall_4: [
    { dx: 0, dz: -0.125, szelesseg: 7.5, melyseg: 10.25, magassag: 5.04 },
    { dx: -2.5, dz: 5.125, szelesseg: 2.5, melyseg: 0.25, magassag: 5.037 },
    { dx: 2.5, dz: 5.125, szelesseg: 2.5, melyseg: 0.25, magassag: 5.037 },
  ],
  // 6 doboz; a befoglalo 10%-a tomor talajszinten
  Watertower_1: [
    { dx: -3.75, dz: -2.75, szelesseg: 1.5, melyseg: 1.5, magassag: 22.593 },
    { dx: -3.75, dz: 2.75, szelesseg: 1.5, melyseg: 1.5, magassag: 22.593 },
    { dx: 1.375, dz: -4.25, szelesseg: 1.25, melyseg: 1.5, magassag: 22.593 },
    { dx: 1.375, dz: 4.25, szelesseg: 1.25, melyseg: 1.5, magassag: 22.593 },
    { dx: 4.375, dz: 0, szelesseg: 1.25, melyseg: 1, magassag: 22.154 },
    { dx: -0.125, dz: 0, szelesseg: 0.75, melyseg: 1, magassag: 24.261 },
  ],
};

/** A keszletben letezo modellek neve. */
export type PropNev = keyof typeof PROP_MERETEK;
