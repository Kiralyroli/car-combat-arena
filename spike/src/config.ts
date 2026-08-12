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
  /** Fel-meretek: 1.8 x 0.7 x 3.8 m-es doboz. */
  halfExtents: { x: 0.9, y: 0.35, z: 1.9 },
  mass: 1000,
  /** Ide kerul vissza reset-nel. */
  spawn: { x: 0, y: 2.5, z: 0 },
  linearDamping: 0.05,
  /**
   * Tovabb csokkentve (0.25 -> 0.16) a "tank-erzet" ellen -- meg
   * kevesebb ellenallas az iranyvaltasnal, fürgebb forgas.
   */
  angularDamping: 0.16,
};

export const WHEEL = {
  radius: 0.4,
  suspensionRestLength: 0.35,
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
   * tobb oldalirányu G-ero is (borulas kockazat). Eredeti: 1.0. Enyhen
   * emelve, nem drasztikusan.
   */
  sideFrictionStiffness: 1.3,
};

export type WheelId = "FL" | "FR" | "RL" | "RR";

export interface WheelLayout {
  id: WheelId;
  /** Csatlakozasi pont a chassis lokalis rendszereben. */
  position: { x: number; y: number; z: number };
  steered: boolean;
  driven: boolean;
}

export const WHEEL_LAYOUT: WheelLayout[] = [
  // Elso (kormanyzott) kerekek: negativ Z -- az orr iranyaban.
  { id: "FL", position: { x: -0.85, y: -0.1, z: -1.3 }, steered: true, driven: false },
  { id: "FR", position: { x: 0.85, y: -0.1, z: -1.3 }, steered: true, driven: false },
  // Hatso (hajto) kerekek: pozitiv Z.
  { id: "RL", position: { x: -0.85, y: -0.1, z: 1.3 }, steered: false, driven: true },
  { id: "RR", position: { x: 0.85, y: -0.1, z: 1.3 }, steered: false, driven: true },
];

export const DRIVE = {
  /** Hajtoero kerekenkent (N). Emelve 4200 -> 5200: fürgebb gyorsulas. */
  engineForce: 5200,
  /** Boost szorzo. */
  boostMultiplier: 1.9,
  /** Tolatas ereje a hajtoero aranyaban. Emelve 0.45 -> 0.55. */
  reverseFactor: 0.55,
  /** Fekero kerekenkent. Emelve 55 -> 78: fürgebb, kevesbe "tank"-szeru fekezes. */
  brakeForce: 78,
  /** Kezifek (csak hatso kerekek). */
  handbrakeForce: 120,
  /** Maximalis kormanyszog radianban (~34 fok, eredeti: ~30 fok). */
  maxSteer: 0.6,
  /** Kormany elforditasi sebesseg (rad/s). Emelve 3.6 -> 5.0: azonnalibb befordulas. */
  steerSpeed: 5.0,
  /** Kormany visszaallasi sebesseg (rad/s). Emelve 5.0 -> 6.5. */
  steerReturnSpeed: 6.5,
  /**
   * Nagy sebessegnel csokkentett kormanyszog -- ez realis viselkedes
   * (a valodi autok is understeerelnek nagy sebessegnel), es fontos
   * biztonsagi tenyezo is borulas ellen. Eredeti: 28 / 0.35 -- ezt
   * enyhen puhitottuk (34 / 0.42), de NEM az eredeti agresszivitas
   * tobbszorosere, mint egy korabbi (tul eros) kiserletnel.
   */
  steerFalloffSpeed: 34,
  steerFalloffMin: 0.42,
  /**
   * "Friction circle": teljes kormanynal (input.steer = 1) a hajtoero
   * ennyiszeresere csokken (0..1). Azert kell, hogy gazzal ne tudjon a
   * sebesseg (es ezzel a kanyarsugar) elszaladni kanyarban -- a gazas
   * es gaz nelkuli kanyarsugar igy kozelebb marad egymashoz.
   */
  corneringPowerMin: 0.4,
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
  /** A felegyenesito nyomatek alap-maximuma (N*m). */
  torque: 6000,
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
