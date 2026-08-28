/**
 * Az ipari arena ELRENDEZESE.
 *
 * Ez a fajl mondja meg, MELYIK epulet HOVA kerul; a meretek nem itt
 * vannak, hanem a modellbol mert PROP_MERETEK-ben. Igy az utkozo doboz
 * pontosan akkora, mint amit a jatekos lat -- kezzel beirt meretnel a
 * ketto eszrevetlenul elcsuszna, es a jatekos falnak menne ott, ahol
 * nincs fal.
 *
 * A FORGATAS CSAK 0/90/180/270 lehet.
 *
 * A fizika (Rapier) kezelne tetszoleges szoget, DE a loves nem: a
 * gepfegyver sugarkovetese es a raketa utkozese tengely-parhuzamos
 * dobozzal szamol (segmentBoxEntry). Egy 45 fokban elforditott 34 m-es
 * raktar hatarolo doboza 33x33 m lenne -- a lovedekek a levegoben
 * allnanak meg. Derekszogben viszont a doboz PONTOS: eleg a szelesseget
 * es a melyseget megcserelni. Ipari udvarnal ez amugy is termeszetes.
 * (A check:layout kulon ellenorzi.)
 */
import { PROP_MERETEK, PROP_TALPAK, type PropNev } from "./arenaProps";
import type { ArenaBox } from "./config";

/** Megengedett elfordulasok fokban -- lasd a fenti indoklast. */
export type PropYaw = 0 | 90 | 180 | 270;

export interface PropPlacement {
  prop: PropNev;
  /** A talp kozeppontja a palyan. */
  x: number;
  z: number;
  yaw?: PropYaw;
  /**
   * TOMOR test, a modell alaprajza helyett.
   *
   * A palyahataron allo epuleteknek ez kell. Nekik nem az a dolguk,
   * hogy hihetoen alljanak, hanem hogy ZARJAK a palyat -- a mert
   * alaprajzuk viszont lyukas (kapuk, oszlopok kozotti resek), es
   * azokon az auto egyszeruen kihajtana. Merve: az alaprajzukkal a
   * hatar eszaki oldalan 45,5 m res maradt.
   *
   * A jatekos ebbol semmit nem vesz eszre: a hatar epulete kifele lóg,
   * belulrol csak a falat latja.
   */
  tomor?: boolean;
}

/**
 * Meddig szamit a modell alakja az UTKOZESNEL (m).
 *
 * Ez alatt merjuk ki a modell alaprajzat (lasd kit-meret.ts), es ebbol
 * lesznek az utkozo dobozok. Ami e FOLOTT van, az nem befolyasolja az
 * alaprajzot: oda az auto ugysem er fel.
 *
 * A 2,5 m az auto magassaga (1,51 m) plusz rahagyas ugrasra es
 * bukkenore. Feljebb vinni ertelmetlen -- a magas epuletek attol csak
 * visszakapnak a valodinal nagyobb alaprajzot.
 */
export const UTKOZES_MAGASSAG = 2.5;

/**
 * A palyan allo, UTKOZO epuletek.
 *
 * Az elrendezes elve (a valasztott "vegyes" jelleg):
 *  - a KOZEP nyitott marad, csak apro fedezekekkel -- ott lehet
 *    uldozni es agyuval dolgozni,
 *  - a nagy epuletek a SZELEKRE kerulnek, a spawn-pontok kozotti
 *    resekbe,
 *  - a nyitott rakodoszin adja az egyetlen athajthato epuletet.
 */
export const LAYOUT: PropPlacement[] = [
  // --- Epuletek a SZELEKEN, a spawn-pontok kozotti resekben ---
  //
  // A POZICIOKAT nem kezzel hangoltuk: egy kereso allitotta be oket a
  // legkozelebbi olyan helyre, ahol egyik sem er spawn-pontot,
  // pickupot, masik epuletet vagy a palya szelet (lasd check:layout).
  //
  // A DARABSZAM viszont merve van: minden akadaly az auto
  // fel-hosszaval NAGYOBB teruletet zar el, mint amekkora -- egy
  // 34 x 13 m-es raktar valojaban 39 x 18 m-t. Az elso valtozatban 26
  // epulet allt a palyan, es a jarhato terulet 78%-rol 42%-ra esett:
  // az mar nem "nyitott kozep", hanem utcak. (A check:arena meri.)
  { prop: "Warehouse_1", x: 50, z: 20, yaw: 90 },
  { prop: "Warehouse_1", x: -50, z: -20, yaw: 90 },
  { prop: "Duplex_1", x: -50, z: 20, yaw: 90 },
  { prop: "Duplex_1", x: 50, z: -20, yaw: 90 },
  { prop: "Duplex_1", x: -20, z: 52 },
  { prop: "Duplex_1", x: 20, z: 52 },
  { prop: "WarehouseSmall_4", x: -26, z: -53 },
  { prop: "WarehouseSmall_4", x: 26, z: -53 },

  // --- Fuggoleges tajekozodasi pontok a sarkokban ---
  //
  // Magasak es keskenyek: messzirol latszanak (tehat lehet hozzajuk
  // igazodni), de alig vesznek el helyet a palyabol.
  { prop: "Watertower_1", x: 45, z: 45 },
  { prop: "Radiotower_1", x: -46, z: -44 },
  { prop: "SiloTank_1", x: -46, z: 46 },
  { prop: "Tank_4", x: 45, z: -45 },

  // --- A NYITOTT rakodoszinek: at lehet hajtani ---
  //
  // A keszletben ez az egyetlen igazan nyitott epulet -- a raktarak
  // zart tombok. Az utkozese csak a ket oszlopsor, kozotte szabad az ut.
  { prop: "Railroad_Loadbay_Shed_1", x: 27, z: 0, yaw: 90 },
  { prop: "Railroad_Loadbay_Shed_1", x: -29, z: -1, yaw: 90 },

  // --- Nehany fedezek a nyitott kozepen ---
  //
  // Ezek NEM zarjak el a kozepet, csak megtorik a belatast: egy autonyi
  // takaras eleg ahhoz, hogy ne lehessen a palya egyik vegebol
  // vegigsopörni a masikat.
  { prop: "SiloTank_1", x: 8, z: -8 },
  { prop: "SiloTank_1", x: -8, z: 8 },
  { prop: "Tank_3", x: -18, z: -26 },
  { prop: "Tank_3", x: 15, z: 19 },

  // MAGAS es KESKENY elemek: a belatast megtorik, de alig vesznek el
  // helyet. Merve: negy ilyen tartaly 2 szazalekponttal csokkenti a
  // jarhato teruletet, a takarast viszont erdemben emeli -- egy
  // ugyanilyen takarast ado raktar 5-6 szazalekpontba kerulne.
  { prop: "Tank_4", x: 26, z: 38 },
  { prop: "Tank_4", x: -26, z: -38 },
  { prop: "Tank_4", x: -26, z: 34 },
  { prop: "Tank_4", x: 26, z: -34 },
];

/**
 * A PALYAHATAR epuletekbol.
 *
 * Korabban negy sima doboz ("wall_north" es tarsai) hatarolta a palyat.
 * Azok sajat gyartmanyu elemek voltak; itt mostantol VALODI epuletek
 * allnak korbe, ugyanabbol a keszletbol, mint a palya tobbi resze.
 *
 * Az elhelyezes kulcsa: minden hataroló epulet BELSO LAPJA pontosan a
 * palyahataron all, a teste pedig KIFELE lóg. Igy
 *  - az auto ugyanott all meg, ahol eddig (nem valtozik a jatekter),
 *  - a hataroló epuletek nem vesznek el jatekteruletet,
 *  - es nincs lathatatlan fal: amibe utkozol, azt latod is.
 *
 * A sarkok kulon epuletet kapnak: a negy oldal egymast nem fedi (az
 * eszaki oldal x >= -hatar, a nyugati x <= -hatar), tehat a sarkokban
 * egy negyzetnyi res maradna, amin at kilatni a semmibe.
 */
export function perimeterPlacements(hatar: number): PropPlacement[] {
  /**
   * Egy oldal epuletei, sorban.
   *
   * Egyutt hosszabbak, mint a 120 m-es oldal -- ez SZANDEKOS: a
   * tulnyulo darab a sarok fele lóg ki, ahol nincs mit utkoznie, es igy
   * biztosan nem marad res ket epulet kozott.
   */
  const OLDAL: PropNev[] = [
    "LogisticTerminal_1",
    "Warehouse_4",
    "GenericBuilding_4",
  ];
  /** A sarkokat kitolto epulet. */
  const SAROK: PropNev = "Building_1";

  const ki: PropPlacement[] = [];

  // Negy oldal, oramutato jarasa szerint. A "kifele" irany az, amerre
  // az epulet teste lóg; a "hosszanti" az, amerre sorakoznak.
  const oldalak = [
    { yaw: 0 as PropYaw, kifele: [0, -1], hossz: [1, 0] }, // eszak (z = -hatar)
    { yaw: 90 as PropYaw, kifele: [1, 0], hossz: [0, 1] }, // kelet (x = +hatar)
    { yaw: 0 as PropYaw, kifele: [0, 1], hossz: [-1, 0] }, // del  (z = +hatar)
    { yaw: 90 as PropYaw, kifele: [-1, 0], hossz: [0, -1] }, // nyugat (x = -hatar)
  ];

  for (const oldal of oldalak) {
    // A sor a -hatar vegetol indul, es tulnyulik a +hatar-on.
    let eddig = -hatar;
    for (const prop of OLDAL) {
      // A yaw EPPEN azert van, hogy a modell hosszanti oldala a fal
      // menten fusson -- tehat a fal menti meret mindig a szelesseg, a
      // kifele valo pedig mindig a melyseg. (Eloszor megcsereltem oket a
      // forgatott oldalakon, es a kelet-nyugati hatar teljesen nyitva
      // maradt: 119.5 m res mindket oldalon.)
      const m = PROP_MERETEK[prop];
      const hosszuMeret = m.szelesseg;
      const melyMeret = m.melyseg;

      const kozepHossz = eddig + hosszuMeret / 2;
      const kozepMely = hatar + melyMeret / 2;
      ki.push({
        prop,
        x: oldal.hossz[0] * kozepHossz + oldal.kifele[0] * kozepMely,
        z: oldal.hossz[1] * kozepHossz + oldal.kifele[1] * kozepMely,
        yaw: oldal.yaw,
        tomor: true,
      });
      eddig += hosszuMeret;
    }
  }

  // A negy sarok: az oldalak kozott maradt negyzet.
  const sarokMeret = PROP_MERETEK[SAROK];
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    ki.push({
      prop: SAROK,
      x: sx * (hatar + sarokMeret.szelesseg / 2),
      z: sz * (hatar + sarokMeret.melyseg / 2),
      tomor: true,
    });
  }

  return ki;
}

// A hatart PARAMETERKENT kapja, nem importalva: a config.ts tolti be
// ezt a modult, tehat egy innen indulo config-import a betoltes
// sorrendjetol fuggne ("Cannot access ARENA_HALF before initialization").

/**
 * LATKEP: a hataroló epuletek MOGOTT allo epuletek, utkozes nelkul.
 *
 * Ezek sosem erhetok el, tehat nincs ertelme fizikai testet adni nekik.
 * A dolguk annyi, hogy a palya ne egy ures sikba vesszen: a hatar folott
 * egy ipari negyed folytatodik. A keszlet legnagyobb darabjai (eromu,
 * gyarepuletek) pont erre valok -- a palyan belul elfernenek.
 *
 * TAVOLABB allnak, mint a regi valtozatban: a hataroló epuletek kb.
 * 93 m-ig ernek kifele, tehat a latkepnek azon TUL kell kezdodnie,
 * kulonben egymasba lognanak.
 */
export const SCENERY: PropPlacement[] = [
  { prop: "Powerplant_1", x: -40, z: -230 },
  { prop: "FactoryPlant_1", x: 175, z: 40, yaw: 90 },
  { prop: "FactoryPlant_2", x: -170, z: 10 },
  { prop: "Building_10", x: 60, z: 190 },
  { prop: "Hangar_2", x: -140, z: 160 },
  { prop: "Warehouse_5", x: 170, z: -110 },
];

/** Az elhelyezes vizszintes merete, a forgatast figyelembe veve. */
export function placementFootprint(p: PropPlacement): {
  szelesseg: number;
  melyseg: number;
  magassag: number;
} {
  const m = PROP_MERETEK[p.prop];
  const forgatott = (p.yaw ?? 0) % 180 !== 0;
  return {
    szelesseg: forgatott ? m.melyseg : m.szelesseg,
    melyseg: forgatott ? m.szelesseg : m.melyseg,
    magassag: m.magassag,
  };
}

/**
 * Az elhelyezesek atszamolasa UTKOZO DOBOZOKRA.
 *
 * Egy epulet ANNYI dobozt ad, ahany teglalappal a talajszinti
 * alaprajza le van fedve (PROP_TALPAK, generalt). Ez tobbnyire egy
 * doboz -- a raktarak tomorek --, de egy nyitott rakodoszinbol ket
 * oszlopsor lesz, egy viztoronybol pedig negy lab, kozottuk szabad
 * uttal.
 *
 * A MODELL viszont egyetlen peldany marad: az ELSO dobozhoz kotjuk,
 * propAt-tal az epulet kozeppontjara allitva. A tobbi doboz "hidden",
 * kulonben ugyanaz az epulet tobbszor rajzolodna ki egymasra.
 */
export function layoutBoxes(layout: PropPlacement[] = LAYOUT): ArenaBox[] {
  const boxes: ArenaBox[] = [];

  for (let i = 0; i < layout.length; i++) {
    const p = layout[i];
    const m = PROP_MERETEK[p.prop];
    const yaw = p.yaw ?? 0;
    // A modell szine a texturajabol jon; a doboz szine csak akkor
    // latszik, ha a modell nem toltodne be.
    const color = 0x8a8f98;

    // Ha egy modellhez nincs mert alaprajz (uj modell, meg nem futott a
    // kit-meret), a teljes befoglalo doboz az ESES IRANYA: inkabb
    // legyen az utkozes tul nagy, mint hogy egy epulet athajthato
    // legyen.
    // A TELJES befoglalo doboz -- a hatarnak ez kell, es ez a
    // tartalek is, ha egy modellhez meg nincs mert alaprajz.
    const egesz = [
      {
        dx: 0,
        dz: 0,
        szelesseg: m.szelesseg,
        melyseg: m.melyseg,
        magassag: m.magassag,
      },
    ];
    const talpak =
      p.tomor === true ? egesz : PROP_TALPAK[p.prop] ?? egesz;

    for (let j = 0; j < talpak.length; j++) {
      const t = talpak[j];
      // A FORGATAS derekszogu (lasd a fajl elejen), tehat eleg a
      // koordinatakat felcserelni -- nincs szuksege szogfuggvenyre, es
      // nem is csuszik el kerekitessel.
      let dx = t.dx;
      let dz = t.dz;
      let szelesseg = t.szelesseg;
      let melyseg = t.melyseg;
      if (yaw === 90) {
        dx = -t.dz;
        dz = t.dx;
        szelesseg = t.melyseg;
        melyseg = t.szelesseg;
      } else if (yaw === 180) {
        dx = -t.dx;
        dz = -t.dz;
      } else if (yaw === 270) {
        dx = t.dz;
        dz = -t.dx;
        szelesseg = t.melyseg;
        melyseg = t.szelesseg;
      }

      // A MAGASSAG dobozonkent kulon jon: addig er fel, ameddig a
      // modell felette tart. Ha mindegyik a teljes magassagot kapna, a
      // lovesek hazudnanak -- egy 1,4 m-es rakodoperon nyolcmeteres
      // falkent allitana meg a lovedeket.
      const felMagas = t.magassag / 2;

      boxes.push({
        // A MODELL csak az elso dobozhoz tartozik; a helye az epulet
        // kozeppontja, nem a doboze.
        prop: j === 0 ? p.prop : undefined,
        propYaw: j === 0 ? yaw : undefined,
        propAt: j === 0 ? { x: p.x, z: p.z } : undefined,
        hidden: j > 0,
        // Az egy epulethez tartozo dobozok kozos csoportot kapnak: a
        // kliens ez alapjan csereli le mindet a modell haromszogeire.
        csoport: `${p.prop}_${i}`,
        tomor: p.tomor === true,
        name: talpak.length > 1 ? `${p.prop}_${i}_${j}` : `${p.prop}_${i}`,
        halfExtents: { x: szelesseg / 2, y: felMagas, z: melyseg / 2 },
        position: { x: p.x + dx, y: felMagas, z: p.z + dz },
        color,
      });
    }
  }

  return boxes;
}
