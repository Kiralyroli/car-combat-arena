/**
 * Kozos konfiguracio. Mindket fizikai backend UGYANEZEKET az ertekeket
 * hasznalja -- ez teszi az osszehasonlitast ervényesse.
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
  linearDamping: 0.05,
  /**
   * Tovabb csokkentve (0.16 -> 0.1) -- meg kevesebb ellenallas az
   * iranyvaltasnal. Az onfelegyenesedes (RECOVERY) sajat, kulon
   * csillapitast hasznal borulaskor, tehat ez itt nem az utolso
   * biztonsagi tenyezo tobbe.
   */
  angularDamping: 0.1,
};

export const WHEEL = {
  /** A Sedan modell kerekeinek tenyleges sugara (~0.345 m, kerekitve). */
  radius: 0.35,
  suspensionRestLength: 0.25,
  suspensionStiffness: 24,
  /**
   * FONTOS: a relaxation (visszaengedeskori csillapitas) NE legyen
   * nagyobb 1-nel -- 1 feletti ertek energiat ad hozza landolaskor,
   * ami pattogast (trambulin-hatas) okoz. Korabban 1.2 volt, ez okozta
   * az "akadozo" mozgast (lasd EREDMENYEK.md).
   */
  suspensionCompression: 0.82,
  suspensionRelaxation: 0.88,
  maxSuspensionForce: 60_000,
  maxSuspensionTravel: 0.35,
  /** Hosszanti tapadas. Ez a fo "grip" ertek, amit a serules csokkent. */
  frictionSlip: 3.5,
  /**
   * Oldalirányu tapadas szorzo -- magasabb = feszesebb kanyarodas, de
   * tobb oldalirányu G-ero is (borulas kockazat). Eredeti: 1.0.
   * Tovabb emelve (2.3 -> 2.8) a fürgebb kanyarodas erdekeben -- az
   * onfelegyenesedes fedezi a borulas kockazatat.
   */
  sideFrictionStiffness: 3.5,
  /**
   * Kulon szorzo az elso (kormanyzott) es hatso (hajto) kerekek
   * tapadasara -- a frictionSlip es sideFrictionStiffness ertekere
   * hat MEG EGYSZER, tengelyenkent. 1.0 = nincs elteres. Magasabb
   * elso ertek = kevesebb alkormanyzas (understeer), magasabb hatso
   * ertek = stabilabb hatso resz (kevesebb kicsuszas/oversteer).
   * Debug-panelen allithato (lasd debugPanel.ts).
   */
  frontGripMultiplier: 1.0,
  rearGripMultiplier: 1.0,
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
  // FL/FR z-je egyseges (-1.495, a modell -1.49/-1.50 atlaga) -- a nagy
  // sideFrictionStiffness mellett mar az eredeti 0.01 m-es aszimmetria
  // is erezheto oldalirányu huzast/csuszast okozott egyenes vezetesnel.
  { id: "FL", position: { x: -0.79, y: -0.405, z: -1.495 }, steered: true, driven: false },
  { id: "FR", position: { x: 0.79, y: -0.405, z: -1.495 }, steered: true, driven: false },
  // Hatso (hajto) kerekek: pozitiv Z. X szinten szimmetrizalva (-0.78 -> -0.79).
  { id: "RL", position: { x: -0.79, y: -0.405, z: 1.45 }, steered: false, driven: true },
  { id: "RR", position: { x: 0.79, y: -0.405, z: 1.45 }, steered: false, driven: true },
];

export const DRIVE = {
  /**
   * Hajtoero kerekenkent (N). Tovabb emelve 5200 -> 7500 -- altalanos
   * fürgeseg-keres miatt (gyorsulas, tolatas, fordulas mind erintett).
   */
  engineForce: 7500,
  /** Boost szorzo. */
  boostMultiplier: 1.9,
  /** Tolatas ereje a hajtoero aranyaban. Emelve 0.55 -> 0.75. */
  reverseFactor: 0.75,
  /** Fekero kerekenkent. Emelve 78 -> 105: meg fürgebb fekezes. */
  brakeForce: 105,
  /** Kezifek (csak hatso kerekek). */
  handbrakeForce: 150,
  /** Maximalis kormanyszog radianban (~54 fok). Tovabb emelve 0.78 -> 0.95. */
  maxSteer: 0.95,
  /** Kormany elforditasi sebesseg (rad/s). Tovabb emelve 7.5 -> 10. */
  steerSpeed: 10,
  /** Kormany visszaallasi sebesseg (rad/s). Emelve 6.5 -> 8.5. */
  steerReturnSpeed: 8.5,
  /**
   * Nagy sebessegnel csokkentett kormanyszog -- realis viselkedes es
   * borulas elleni biztonsag, de mivel mostantol van onfelegyenesedes
   * biztonsagi halokent (RECOVERY), ERŐSEN tovabb puhithato (44/0.55 ->
   * 70/0.75) anelkul, hogy tartos felfordulast okozna -- legrosszabb
   * esetben az onfelegyenesedes helyrehozza. Ez kozvetlenul azt a
   * panaszt cimzi, hogy nagy sebessegnel az auto "szinte nem is
   * kanyarodik".
   */
  steerFalloffSpeed: 70,
  steerFalloffMin: 0.75,
  /**
   * "Friction circle": teljes kormanynal (input.steer = 1) a hajtoero
   * ennyiszeresere csokken (0..1). VISSZAVETTUK (0.3 -> 0.55) -- tul
   * agresszivan vagta vissza a sebesseget, ami miatt a kanyarodashoz
   * szukseges oldalirányu tapadasi ero is elveszett (alacsony
   * sebessegnel alig van kanyarodo-ero), ez okozta azt az erzetet,
   * hogy "alig fordul" -- inkabb a nagyobb sideFrictionStiffness
   * es maxSteer vegzci a munkat, nem a sebesseg-elvetel.
   */
  corneringPowerMin: 0.55,
  /**
   * Ez alatt a sebesseg alatt (m/s) a fenti korlatozas NEM (meg nem
   * teljes mertekben) hat -- allo helyzetben/inditaskor kormanyozva
   * is teljes hajtoero jar, mert nincs meg valodi "tapadasi koltsegvetes"-
   * konfliktus alacsony sebessegnel. E felett linearisan felfut a teljes
   * korlatozasig. Enelkul kormanyozva inditaskor az auto alig indult el,
   * mert a hajtoero azonnal corneringPowerMin-re esett, meg 0 km/h-nal is.
   */
  corneringPowerRampSpeed: 8,
  /**
   * KOZVETLEN, sebessegtol fuggetlen kanyarsugar-celzas. A valodi
   * gumitapadas fizikailag korlatozza, mennyire szorithato a
   * kanyarsugar nagy sebessegnel (v^2/r osszefugges) -- barmennyire is
   * emeljuk a sideFrictionStiffness-t, ez a korlat nem tuszamlelheto
   * at csak a tapadassal, es mellekhatasokat (egyenes-vezetesi
   * csuszas) is okoz. Ehelyett a kormanyzas iranyaba mutato
   * szogsebesseget KOZVETLENUL a celsugarhoz igazitjuk minden lepesben
   * (lasd rapier.ts applyTurnRadiusAssist) -- ez garantalja, hogy a
   * kocsi kb. ekkora sugarban fordul, FUGGETLENUL a sebessegtol.
   */
  targetTurnRadius: 6,
  /** Milyen gyorsan kozelit a tenyleges szogsebesseg a celsugarhoz (1/s). */
  turnRadiusBlendRate: 9,
  /**
   * Ez alatt a sebesseg alatt (m/s) az asszisztens teljesen KIKAPCSOL,
   * a termeszetes (gumitapadas-alapu) forgast semmi nem korlatozza.
   * Enelkul, mivel a celzott szogsebesseg egyenesen aranyos a
   * sebesseggel (targetYawRate = v / targetTurnRadius), inditaskor
   * (v approx 0) az asszisztens szinte nullara huzta volna a
   * szogsebesseget MEG AKKOR IS, ha a kormany mar teljesen be volt
   * fordulva -- ez okozta, hogy inditaskor kormanyozva alig fordult
   * az auto.
   */
  turnRadiusMinSpeed: 2.5,
  /**
   * Milyen gyorsan igazitja a tenyleges mozgas iranyat (linearis
   * sebesseg-vektor) az orr iranyahoz kanyarodas kozben (1/s). A
   * fenti szogsebesseg-celzas CSAK a karosszeria FORGASAT allitja be
   * kozvetlenul -- a linearis lendulet (merre HALAD a kocsi) magatol
   * nem kovetne ezt, mert ahhoz valodi oldalirányu gumitapadasi ero
   * kellene, ami nagy sebessegnel/eles kormanynal fizikailag nem eleg
   * gyors. Enelkul az orr gyorsan az uj irany fele fordul, de a kocsi
   * meg a REGI iranyba csuszik tovabb -- ez nezett ki ugy, mintha
   * "keresztbe csuszna" eles kanyarban, nagy sebessegnel. 0 = kikapcsolva
   * (csak a karosszeria fordul, a csuszas erzete visszater).
   *
   * FONTOS: legalabb akkora legyen, mint turnRadiusBlendRate -- ha az
   * iranyitas lassabban kovetne, mint ahogy az orr fordul, az atmeneti
   * fazisban meg mindig keresztbe allna a kocsi minden eles kanyar
   * elejen. Emelve 4 -> 12, mert a 4 nem tudta lekovetni a 9-es
   * turnRadiusBlendRate-et, es meg mindig erezhetoen "keresztbe allt"
   * az auto eles kanyarban.
   */
  velocityAlignRate: 12,
};

export const RECOVERY = {
  /**
   * Ez alatt a dolesszog alatt (fok) NULLA a felegyenesito nyomatek --
   * ez fedezi a normal kanyar-dolest es a kerek-serules vizualis
   * dolesét is, hogy azok szabadon, korrekcio nelkul jelenjenek meg.
   * Csak ezen tul (kb. oldalra dolt/tetejere allt allapot) lep eletbe.
   */
  startAngleDeg: 60,
  /**
   * Ennel a dolesszognel (fok) mar a maximalis nyomatek hat -- NEM
   * 180-nal, mert egy oldalara dolt auto (kb. 90 fok, a legszelesebb
   * lapjan pihen) legalabb annyira stabil/nehezen billentheto, mint a
   * fejen allo (180 fok), a kisebb tehetetlensegi nyomatek miatt a
   * korrekcios tengely korul.
   */
  maxSeverityAngleDeg: 115,
  /**
   * A felegyenesito nyomatek alap-maximuma (N*m). A Sedan modellre valo
   * atallaskor a nagyobb/magasabb karosszeria kb. 1.8x-ára novelte a
   * forgasi tehetetlensegi nyomatekot a borulas-tengelyek koruk --
   * ezert 6000 -> 11500-ra emelve (lasd EREDMENYEK.md).
   */
  torque: 11500,
  /**
   * Extra szogsebesseg-csillapitas felegyenesedes kozben (0-1, 1 =
   * nincs csillapitas). Tiszta nyomatek (csillapitas nelkul)
   * tullenditene a celon a konnyen mozdithato eseteknel (pl. sik
   * talajrol fejre alitva) -- ez fekezi azt anelkul, hogy a nagy,
   * stabil lapjan pihenő autonal "elnyelne" a korrekciot (ott a
   * kontaktus-szolver ugyis eros ellenallast ad).
   */
  angularDampingDuringRecovery: 0.93,
  /**
   * Ha a dolesszog ENNYI IDEIG (mp) folyamatosan a kuszob felett marad
   * (pl. az auto egy nagy, stabil lapjan pihen, ahol a kontaktus-
   * szolver ellenall a gyenge korrekcionak), a nyomatek fokozatosan,
   * legfeljebb escalationMax-szorosara no. Ez garantalja, hogy MINDIG
   * legyen eleg ero a kitoreshez, barmilyen stabil pihenő helyzetbol.
   */
  escalationTime: 1.5,
  escalationMax: 3,
  /**
   * A 180 fokos (pontosan fejen allo) allapot instabil egyensuly --
   * ott a termeszetes (kereszt-szorzat alapu) korrekcios irany majdnem
   * nulla hosszusagu, tehat gyakorlatilag nem inditana el a forgast.
   * Ilyenkor egy rogzitett tartalek-tengely körül adunk egy kezdo
   * loketet, hogy mindig el tudjon indulni valamelyik iranyba.
   */
  fallbackAxis: { x: 0, y: 0, z: 1 },
};

export const STABILIZATION = {
  /**
   * Kulon, EXTRA csillapitas a bukdacsolas (pitch, X tengely) es a
   * dontes (roll, Z tengely) iranyaban -- FUGGETLENUL a kanyarodastol
   * (yaw, Y tengely), amit nem erint. Enelkul az agilis-hangolashoz
   * lecsokkentett CHASSIS.angularDamping (lasd fent) azt is
   * eredmenyezte, hogy gyorsulasnal az auto orra felallt (a hatso
   * kerekekre hato hajtoero dontonyomateka nem csillapodott le), es
   * folyamatosan oldalra dülöngélt. 0..1, 1 = nincs extra hatas,
   * kisebb ertek = erosebb csillapitas. Csak akkor hat, ha az auto
   * NEM az onfelegyenesedesi kuszob felett van (RECOVERY.startAngleDeg)
   * -- borulas utani felallasnal a RECOVERY sajat csillapitasa dontsa el.
   */
  pitchRollDamping: 0.65,
  /**
   * Csak EZ ALATT a dolesszog (fok) alatt lep eletbe a fenti
   * csillapitas -- szandekosan JOKKAL a RECOVERY.startAngleDeg (60 fok)
   * kuszob alatt, biztonsagi savval. Enelkul, ha pontosan a kuszobon
   * lepne at hatasba, elfojtana a felegyenesedeshez meg szukseges
   * lendületet, es az auto elakadna kb. 60 fok korul, sosem erve el a
   * teljesen felallo helyzetet.
   */
  skipAboveDeg: 30,
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
