/**
 * Kozos konfiguracio: a kliens es a szerver UGYANEBBOL dolgozik.
 *
 * A vezetes-modell parametereit az ARCADE blokk irja le (lasd lentebb
 * es physics/arcade.ts).
 *
 * Tengely-konvencio (jobbkezes): X = jobb, Y = fel, Z = -1 (negativ) = elore.
 *
 * FONTOS: az orr a NEGATIV Z iranyba nez, nem a pozitivba. Ez a
 * three.js / gLTF alapertelmezett "-Z = elore" konvenciojahoz igazodik.
 * Ha ezt megforditjuk (+Z = elore), egy hatulrol kovetokamera a jobbkezes
 * rendszerben MEGTUKROZI a bal-jobb iranyt a kepernyon -- ezt a hibat a
 * 0. lepcso spike-ja derítette ki (lasd EREDMENYEK.md).
 */

/** Fix fizikai lepeskoz. Lasd projekt-terv 15.3: fizika 60 Hz. */
export const FIXED_DT = 1 / 60;

/** Hany fizikai lepest engedunk egy renderelt frame-ben (spiral-vedelem). */
export const MAX_STEPS_PER_FRAME = 5;

export const GRAVITY = { x: 0, y: -9.81, z: 0 };

export const CHASSIS = {
  /**
   * Fel-meretek: a valodi Sedan modell (spike/public/models/sedan.glb)
   * meretei alapjan -- 2.18 x 1.51 x 4.91 m teljes meret. A tomeg
   * egyelore szandekosan MARADT 1000 kg-on (nem "realis" ~1300 kg),
   * hogy a valtozas kezelheto maradjon -- lasd EREDMENYEK.md.
   */
  halfExtents: { x: 1.09, y: 0.755, z: 2.455 },
  mass: 1000,
  /** Ide kerul vissza reset-nel. */
  spawn: { x: 0, y: 2.5, z: 0 },
  /**
   * NULLA, szandekosan: a lassulast teljes egeszeben az arkad modell
   * intezi (coastDecel / brakeDecel). Egy motor-szintu csillapitas
   * ezekkel PARHUZAMOSAN hatna, tehat a csucssebesseg es a fektav mar
   * nem abbol jonne ki, ami az ARCADE blokkban all -- pont azt a
   * "ket reteg egymas ellen" helyzetet hoznank vissza, ami miatt ez
   * a modell keszult.
   */
  linearDamping: 0,
  /**
   * A fuggoleges tengely koruli fordulast (yaw) a modell kozvetlenul
   * allitja, tehat ezt a csillapitast gyakorlatilag csak a BUKDACSOLAS
   * es az OLDALDOLES erzi. Ott viszont jol jon: e nelkul a kocsi a
   * rugoin sokaig imbolyogna landolas es utkozes utan.
   */
  angularDamping: 1.2,
};

/**
 * Kerek- es felfuggesztes-parameterek.
 *
 * Az arkad modellben a kerek NEM szimulalt gumiabroncs: nincs
 * csuszasi gorbe, nincs tapadasi koltsegvetes. A kerek ket dolgot ad:
 * a felfuggesztes rugoja tartja a karosszeriat a talaj folott (ettol
 * dol be kanyarban es ettol landol rugalmasan), es a sugara adja a
 * gorduleset a megjeleniteshez. A TAPADAST teljes egeszeben az ARCADE
 * blokk irja le, nem ez.
 */
export const WHEEL = {
  /** A Sedan modell kerekeinek tenyleges sugara (~0.345 m, kerekitve). */
  radius: 0.35,
  /** A rugo kinyujtott hossza -- ez adja a menetmagassagot. */
  suspensionRestLength: 0.3,
  /**
   * Rugoallando (N/m) KEREKENKENT.
   *
   * Nyugalomban a negy kereknek egyutt a teljes sulyt kell tartania:
   * 1000 kg * 9.81 / 4 = kb. 2450 N kerekenkent. Ha azt akarjuk, hogy
   * ez kb. feluton (0.15 m benyomodasnal) alljon be, a rugoallando
   * 2450 / 0.15 = kb. 16000 N/m. Ennel feszesebbre vesszuk, hogy az
   * auto ne "ulepedjen" le gyorsulaskor es kanyarban.
   */
  suspensionStiffness: 30_000,
  /**
   * Lengescsillapitas (N per m/s).
   *
   * E nelkul a rugo tisztan energiat tarolna es visszaadna: az auto
   * landolas utan trambulinkent pattogna. A kritikus csillapitas
   * kozelebe lonek (2 * sqrt(k * m/4) = 2 * sqrt(30000 * 250) = kb.
   * 5500), kicsit ala, hogy maradjon egy kis rugalmas erzet.
   */
  suspensionDamping: 4200,
  /** Egy kerek felfuggesztese ennel nagyobb erot nem fejt ki (N). */
  maxSuspensionForce: 60_000,
};

export type WheelId = "FL" | "FR" | "RL" | "RR";

export interface WheelLayout {
  id: WheelId;
  /** Csatlakozasi pont a chassis lokalis rendszereben. */
  position: { x: number; y: number; z: number };
  steered: boolean;
  driven: boolean;
}

// A Sedan modell (Car root) sajat kerek-node pozicioi (glb export):
// Wheel_FL (-0.79, 0.35, -1.49), Wheel_FR (0.79, 0.35, -1.50),
// Wheel_RL (-0.78, 0.35, 1.45), Wheel_RR (0.79, 0.35, 1.45).
// A "0.35" a kerek magassaga a talajtol -- a chassis-kozepponthoz kepesti
// Y-t abbol szamoljuk: talajmagassag - CHASSIS.halfExtents.y = 0.35 - 0.755.
export const WHEEL_LAYOUT: WheelLayout[] = [
  // Elso (kormanyzott) kerekek: negativ Z -- az orr iranyaban.
  // FL/FR z-je egyseges (-1.495, a modell -1.49/-1.50 atlaga). A regi,
  // gumitapadas-alapu modellben mar ez a 0.01 m-es aszimmetria is
  // erezheto elhuzast okozott egyenesben; az arkad modell erre nem
  // erzekeny, de a szimmetria igy is helyesebb.
  { id: "FL", position: { x: -0.79, y: -0.405, z: -1.495 }, steered: true, driven: false },
  { id: "FR", position: { x: 0.79, y: -0.405, z: -1.495 }, steered: true, driven: false },
  // Hatso (hajto) kerekek: pozitiv Z. X szinten szimmetrizalva (-0.78 -> -0.79).
  { id: "RL", position: { x: -0.79, y: -0.405, z: 1.45 }, steered: false, driven: true },
  { id: "RR", position: { x: 0.79, y: -0.405, z: 1.45 }, steered: false, driven: true },
];

/**
 * ARKAD vezetes-modell.
 *
 * Ez a modell SZANDEKOSAN nem szimulal gumiabroncsot. A korabbi
 * valtozat egy raycast-alapu, valodi tapadasi gorbevel dolgozo jarmu-
 * fizika volt, amire kesobb negy kulon asszisztens kerult (celzott
 * kanyarsugar, haladasi irany igazitasa, kanyar-erokorlat, sebessegi
 * kormany-visszavagas), hogy iranyithato legyen. A ket reteg egymas
 * ellen dolgozott: minden hangolas az egyik oldalon elrontott valamit
 * a masikon.
 *
 * Helyette itt HAROM mennyiseget vezerlunk kozvetlenul:
 *
 *   1. az orr iranyaba eso sebesseget (gaz/fek),
 *   2. az oldalirányu sebesseget (tapadas -- nullaba huzzuk),
 *   3. a fuggoleges tengely koruli fordulast (kormany).
 *
 * Mindharmat KORLATOZOTT VALTOZASI SEBESSEGGEL allitjuk, nem
 * ertekadassal. Ez a kulcs: igy az utkozes, a robbanas es a rampa
 * lokese valodi marad (a Rapier valtoztatja a sebesseget, mi csak
 * fokozatosan hozzuk vissza), mikozben az iranyitas kiszamithato.
 * Egy egyszeru "sebesseg = elore * gaz" ertekadas eltuntetne minden
 * utkozest -- ezert nincs olyan sehol.
 */
export const ARCADE = {
  /** Csucssebesseg gazzal (m/s). 30 m/s = 108 km/h. */
  maxSpeed: 30,
  /** Csucssebesseg boosttal (m/s). 44 m/s = 158 km/h. */
  boostMaxSpeed: 44,
  /** Csucssebesseg tolatasnal (m/s). */
  maxReverseSpeed: 11,

  /** Gyorsulas (m/s^2). 20-szal a csucssebesseg kb. 1.5 mp alatt megvan. */
  accel: 20,
  /** Gyorsulas boosttal (m/s^2) -- erezhetoen lokjon egyet. */
  boostAccel: 34,
  /**
   * Lassulas, amikor a gaz a haladassal SZEMBE hat (m/s^2).
   * Ez az "S menet kozben" fek: 30 m/s-rol kb. 0.8 mp alatt all meg.
   */
  brakeDecel: 38,
  /**
   * Lassulas gaz nelkul (m/s^2) -- motorfek.
   *
   * Ez fut akkor is, ha a kocsi a csucssebesseg FOLE kerult (rampa,
   * robbanas, lokes): a tobblet lassan cseng le, nem vagjuk vissza
   * azonnal a maximumra. Igy egy nagy lokes latvanyos marad.
   */
  coastDecel: 7,

  /**
   * Legnagyobb fordulasi szogsebesseg (rad/s). 2.7 rad/s = 155 fok/s.
   *
   * Ebbol jon a kanyarsugar: r = v / yawRate. 20 m/s-nal ez 7.4 m --
   * eles, gokart-szeru iv. A sugar tehat NEM allando (mint a regi
   * "celzott kanyarsugar" asszisztensnel), hanem sebesseggel no, ami
   * termeszetesebb erzet.
   */
  maxYawRate: 2.7,
  /**
   * Ekkora sebessegnel (m/s) er el a fordulas a teljes ereju
   * ertekehez. Ez alatt aranyosan kevesebb -- allo helyzetben a kocsi
   * nem pordul meg a helyben, csak haladas kozben fordul.
   */
  turnRampSpeed: 6,
  /**
   * Csucssebessegnel a fordulasnak ennyi hanyada marad.
   *
   * Nem azert, hogy "realis" legyen, hanem hogy nagy sebessegnel ne
   * legyen rangatos az iranyitas -- teljes erovel fordulva 30 m/s-nal
   * a kocsi 11 m sugaru ivet irna le, ami kezelhetetlenul ideges.
   */
  turnFactorAtTopSpeed: 0.6,
  /**
   * Milyen gyorsan eri el a fordulas a celerteket (rad/s^2).
   *
   * Szinten korlatozott valtozas, nem ertekadas: ha egy utkozes
   * megporgeti a kocsit, a porges lecsengese ebbol adodik -- nem
   * tunik el egyik lepesrol a masikra.
   */
  yawAccel: 12,
  /**
   * Levegoben a kormany ennyied resze hat.
   *
   * Nem nulla: ugratas utan lehessen igazitani a landolas iranyat --
   * ez arkad jatekban alapelvaras. De nem is 1, hogy a levego ne
   * legyen ugyanolyan iranyithato, mint a talaj.
   */
  airSteerAuthority: 0.3,

  /**
   * Oldalirányu tapadas (m/s^2): ekkora "eronek" megfelelo utemben
   * huzzuk nullaba az oldalirányu sebesseget.
   *
   * Ez az EGYETLEN dolog, ami a tapadast leirja. Magas ertek =
   * az auto oda megy, amerre az orra nez. Amiert megis korlatos es
   * nem azonnali: egy oldalrol kapott lokes (masik auto, robbanas)
   * igy latvanyosan elcsusztatja a kocsit, mielott visszaall.
   */
  lateralGrip: 34,
  /** Kezifekkel (Space) ennyire esik vissza -- innen jon a drift. */
  driftLateralGrip: 7,
  /** Kezifekkel ennyivel elesebben fordul. */
  driftYawBoost: 1.3,

  /**
   * A kormany-input simitasa a kliensen (1/s) -- lasd Input.read.
   *
   * Nem a fizika resze: a billentyus vezetes lenne kapcsolgatos
   * nelkule (a gomb 0-rol azonnal 1-re ugrik).
   */
  steerSpeed: 10,
  steerReturnSpeed: 12,

  /**
   * Az ELSO kerekek LATVANY szerinti elfordulasa teljes kormanynal
   * (radian, kb. 30 fok).
   *
   * Kizarolag megjelenites: a fordulast a yawRate vegzi, nem a kerek
   * szoge. Azert kell megis, mert kerek nelkul fordulo auto hamisan
   * nezne ki.
   */
  visualSteerAngle: 0.52,
};

/**
 * Talpra allas borulas utan.
 *
 * A regi valtozat NYOMATEKKAL probalta visszaforditani a kocsit, es
 * mivel egy nagy, lapos oldalan pihenő auto ellenall, kellett hozza
 * fokozatos eszkalacio, kulon csillapitas es egy tartalek tengely a
 * pontosan fejen allo esetre. Sok alkatresz egyetlen garancia nelkul.
 *
 * Itt ehelyett a KAROSSZERIA ELFORDULASAT igazitjuk vissza fuggoleges
 * ala, lepesenkent egy adott hanyaddal. Ez nem "fizikus" megoldas, de
 * arkad jatekban pontosan ez kell: mindig sikerul, mindig ugyanannyi
 * ideig tart, es a jatekos nem esik ki a meccsbol egy szerencsetlen
 * borulas miatt. A fuggoleges tengely koruli iranyt (merre nez az orr)
 * NEM bantjuk -- csak a dolest es a bukdacsolast.
 */
export const RECOVERY = {
  /**
   * Ez alatt a dolesszog (fok) alatt nincs beavatkozas.
   *
   * Bőven a normal kanyar-doles es a kerek-serules miatti megdoles
   * folott: azok igy szabadon, korrekcio nelkul latszanak.
   */
  startAngleDeg: 55,
  /**
   * Ennyi ido alatt all teljesen talpra (mp).
   *
   * A jatekos valasztasa: borulhasson fel, de gyorsan alljon vissza.
   * Fel masodperc eleg ahhoz, hogy a borulas latvanya megmaradjon, es
   * eleg rovid ahhoz, hogy egy robbanas ne vegyen ki a jatekbol.
   */
  rightingTime: 0.5,
  /**
   * Talpra allas kozben a porges visszafogasa (szorzo lepesenkent).
   *
   * E nelkul a kocsi atlendulne a fuggolegesen es a masik oldalara
   * dolne -- a korrekcio ugyanis a forgast is oroksegul kapja.
   */
  spinDamping: 0.85,
};

/** Statikus arena-elem: doboz. Ugyanebbol keszul a mesh es a collider. */
export interface ArenaBox {
  name: string;
  halfExtents: { x: number; y: number; z: number };
  position: { x: number; y: number; z: number };
  /** Euler forgatas radianban (XYZ sorrend). */
  rotation?: { x: number; y: number; z: number };
  color: number;
}

const ARENA_HALF = 40;
const WALL_H = 2;

export const ARENA: ArenaBox[] = [
  {
    name: "ground",
    halfExtents: { x: ARENA_HALF, y: 0.5, z: ARENA_HALF },
    position: { x: 0, y: -0.5, z: 0 },
    color: 0x3d4450,
  },
  {
    name: "wall_north",
    halfExtents: { x: ARENA_HALF, y: WALL_H, z: 0.5 },
    position: { x: 0, y: WALL_H, z: -ARENA_HALF },
    color: 0x565f6e,
  },
  {
    name: "wall_south",
    halfExtents: { x: ARENA_HALF, y: WALL_H, z: 0.5 },
    position: { x: 0, y: WALL_H, z: ARENA_HALF },
    color: 0x565f6e,
  },
  {
    name: "wall_east",
    halfExtents: { x: 0.5, y: WALL_H, z: ARENA_HALF },
    position: { x: ARENA_HALF, y: WALL_H, z: 0 },
    color: 0x565f6e,
  },
  {
    name: "wall_west",
    halfExtents: { x: 0.5, y: WALL_H, z: ARENA_HALF },
    position: { x: -ARENA_HALF, y: WALL_H, z: 0 },
    color: 0x565f6e,
  },
  // Ugrato rampa
  {
    name: "ramp_main",
    halfExtents: { x: 4, y: 0.3, z: 6 },
    position: { x: 0, y: 1.1, z: -16 },
    rotation: { x: -0.22, y: 0, z: 0 },
    color: 0x8b5a2b,
  },
  // Ferde felulet oldalra dolesteszthez
  {
    name: "bank_left",
    halfExtents: { x: 6, y: 0.3, z: 4 },
    position: { x: -18, y: 1.3, z: 8 },
    rotation: { x: 0, y: 0, z: 0.28 },
    color: 0x8b5a2b,
  },
  // Akadalyok
  { name: "crate_a", halfExtents: { x: 1, y: 1, z: 1 }, position: { x: 10, y: 1, z: 6 }, color: 0x6e7681 },
  { name: "crate_b", halfExtents: { x: 1, y: 1, z: 1 }, position: { x: 13, y: 1, z: 6 }, color: 0x6e7681 },
  { name: "crate_c", halfExtents: { x: 1, y: 2, z: 1 }, position: { x: 11.5, y: 2, z: 10 }, color: 0x6e7681 },
  { name: "pillar", halfExtents: { x: 1.5, y: 3, z: 1.5 }, position: { x: -12, y: 3, z: -8 }, color: 0x6e7681 },
];

/**
 * Spawn-pontok a jatekosoknak (max. 8 -- lasd terv 3. fejezet).
 *
 * SZANDEKOSAN kezzel megadott lista, nem szamitott kor: az arena
 * akadalyai (rampa, lada, oszlop, ferde felulet) nem szimmetrikusak,
 * ezert nincs olyan sugaru/elforgatasu kor, amelynek mind a 8 pontja
 * szabadon maradna. Ha valamelyik spawn beleer egy akadalyba, az auto
 * bele-szuletik, egy kereke megszorul, a sarka megemelkedik, es a kocsi
 * azonnal felborul -- ezt a hibat a halozati spawn bevezetesekor
 * tenylegesen produkalta a korives elrendezes.
 *
 * A lista helyesseget a `npm run check:spawns` ellenorzi.
 */
export const SPAWN_POINTS: { x: number; y: number; z: number }[] = [
  { x: 22, y: 2.5, z: 0 },
  { x: 22, y: 2.5, z: 22 },
  { x: 0, y: 2.5, z: 26 },
  { x: -22, y: 2.5, z: 22 },
  { x: -26, y: 2.5, z: 0 },
  { x: -22, y: 2.5, z: -22 },
  { x: 0, y: 2.5, z: -30 },
  { x: 22, y: 2.5, z: -22 },
];

export const CAMERA = {
  /**
   * Kamera pozicio az auto lokalis rendszereben. Pozitiv Z, mert az orr
   * negativ Z fele nez -- a kameranak a MASIK oldalon kell lennie,
   * hogy mogotte kovesse az autot.
   */
  offset: { x: 0, y: 3.4, z: 8.5 },
  /** Hova nez (auto felett). */
  lookAtHeight: 1.2,
  /** Kovetesi simitas (0-1, magasabb = feszesebb). */
  positionLerp: 0.12,
  lookAtLerp: 0.2,
};
