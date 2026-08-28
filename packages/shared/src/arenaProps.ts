/**
 * Az epulet-modellek MERT meretei.
 *
 * GENERALT FAJL -- ne szerkeszd kezzel. A
 * packages/client/scripts/kit-meret.ts allitja elo a modellbol
 * (epuletek.glb), a modell sajat hatarolo dobozabol.
 *
 * MIERT GENERALT: az utkozo doboz meretenek PONTOSAN egyeznie kell
 * azzal, amit a jatekos lat. Kezzel beirt szamoknal a ketto
 * eszrevetlenul elcsuszna -- a jatekos a falnak menne ott, ahol nincs
 * fal, vagy athajtana egy epuleten. Igy viszont a szam a modellbol
 * jon, es a modell csereje automatikusan atvezetodik.
 *
 * A meretek a JATEK tengelyeire vannak szamolva: szelesseg = X,
 * melyseg = Z, magassag = Y (a modellben a Blender Z-je a magassag).
 */

export interface PropMeret {
  szelesseg: number;
  melyseg: number;
  magassag: number;
}

export const PROP_MERETEK = {
  Building_1: { szelesseg: 27.018, melyseg: 47.545, magassag: 16.633 },
  Building_10: { szelesseg: 43.499, melyseg: 83.266, magassag: 25.825 },
  Duplex_1: { szelesseg: 20.891, melyseg: 9.474, magassag: 8.764 },
  FactoryPlant_1: { szelesseg: 46.535, melyseg: 95.302, magassag: 24.73 },
  FactoryPlant_2: { szelesseg: 33, melyseg: 135.8, magassag: 18.266 },
  GenericBuilding_2: { szelesseg: 4.9, melyseg: 4.619, magassag: 3.935 },
  GenericBuilding_3: { szelesseg: 7.876, melyseg: 9.966, magassag: 4.289 },
  GenericBuilding_4: { szelesseg: 35.14, melyseg: 14.966, magassag: 5.88 },
  Hangar_2: { szelesseg: 49.784, melyseg: 59.957, magassag: 12.886 },
  LogisticTerminal_1: { szelesseg: 53.434, melyseg: 15.844, magassag: 7.882 },
  OfficeTrailer_1: { szelesseg: 11.284, melyseg: 5.803, magassag: 3.927 },
  PortalCrane_2: { szelesseg: 9.428, melyseg: 20.949, magassag: 18.602 },
  Powerplant_1: { szelesseg: 99.295, melyseg: 191.093, magassag: 89.077 },
  Radiotower_1: { szelesseg: 4.648, melyseg: 4.31, magassag: 24.065 },
  Railroad_Loadbay_Shed_1: { szelesseg: 14.854, melyseg: 27.766, magassag: 9.751 },
  SiloTank_1: { szelesseg: 3.05, melyseg: 3.192, magassag: 8.896 },
  Smth_1: { szelesseg: 18.34, melyseg: 11.805, magassag: 15.037 },
  Smth_2: { szelesseg: 28.683, melyseg: 12.206, magassag: 9.708 },
  Tank_1: { szelesseg: 17.736, melyseg: 17.786, magassag: 15.217 },
  Tank_2: { szelesseg: 19.781, melyseg: 19.781, magassag: 17.139 },
  Tank_3: { szelesseg: 5.955, melyseg: 6.75, magassag: 7.324 },
  Tank_4: { szelesseg: 4.581, melyseg: 4.6, magassag: 18.651 },
  Tank_5: { szelesseg: 4.66, melyseg: 4.68, magassag: 19.018 },
  TsrStation_1: { szelesseg: 11.801, melyseg: 4.428, magassag: 4.226 },
  Warehouse_1: { szelesseg: 33.833, melyseg: 13.36, magassag: 11.123 },
  Warehouse_3: { szelesseg: 24.437, melyseg: 25.221, magassag: 12.489 },
  Warehouse_4: { szelesseg: 42.076, melyseg: 13.589, magassag: 9.383 },
  Warehouse_5: { szelesseg: 33, melyseg: 54.938, magassag: 11.684 },
  WarehouseSmall_4: { szelesseg: 7.478, melyseg: 10.457, magassag: 5.04 },
  Watertower_1: { szelesseg: 9.794, melyseg: 9.751, magassag: 24.261 },
} as const satisfies Record<string, PropMeret>;

export type PropNev = keyof typeof PROP_MERETEK;
