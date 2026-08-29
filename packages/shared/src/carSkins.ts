/**
 * A skinek texturai -- GENERALT FAJL, ne szerkeszd kezzel.
 *
 * A tools/autok-export.py allitja elo a forras-csomagokbol
 * (npm run autok-export). Minden bejegyzes azt mondja meg, hogy egy
 * skin melyik ANYAG-SZEREPRE melyik texturat teszi: a modell anyagai
 * a szerepuk szerint vannak elnevezve (pl. Rescue_body,
 * Rescue_light), es a skin-valtas ezeket cereli ki.
 *
 * A GEOMETRIA KOZOS a skinek kozott: egy forma negy valtozata ezert
 * alig kerul tobbe, mint egy.
 */

/** A skin-texturak konyvtara a kliensben. */
export const SKIN_URL = "/models/skins/";

/** Egy skin: anyag-szerep -> textura-fajl. */
export type SkinTexturak = Partial<
  Record<"body" | "other" | "glass" | "light", string>
>;

export const CAR_SKIN_TEXTURES: Record<
  string,
  Record<string, SkinTexturak>
> = {
  Crossover: {
    Fekete: { body: "crossover_fekete_body.webp", other: "crossover_fekete_other.webp" },
    Zold: { body: "crossover_zold_body.webp", other: "crossover_zold_other.webp" },
    Narancs: { body: "crossover_narancs_body.webp", other: "crossover_narancs_other.webp" },
    Rozsdas: { body: "crossover_rozsdas_body.webp", other: "crossover_rozsdas_other.webp" },
    Terep: { body: "crossover_terep_body.webp", other: "crossover_terep_other.webp" },
  },
  Jeep: {
    Fekete: { body: "jeep_fekete_body.webp" },
    Feher: { body: "jeep_feher_body.webp" },
    Kek: { body: "jeep_kek_body.webp" },
    Piros: { body: "jeep_piros_body.webp" },
  },
  Muscle: {
    Sarga: { body: "muscle_sarga_body.webp" },
    Feher: { body: "muscle_feher_body.webp" },
    Kek: { body: "muscle_kek_body.webp" },
    Piros: { body: "muscle_piros_body.webp" },
  },
  Rescue: {
    Rendor: { body: "rescue_rendor_body.webp", light: "rescue_rendor_light.webp" },
    Mento: { body: "rescue_mento_body.webp", light: "rescue_mento_light.webp" },
    Szerviz: { body: "rescue_szerviz_body.webp", light: "rescue_szerviz_light.webp" },
  },
};
