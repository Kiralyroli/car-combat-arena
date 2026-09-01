import { ARCADE, CHASSIS } from "./config";
import { CAR_MODELS, DEFAULT_CAR, type CarId } from "./carModels";

/**
 * AUTONKENTI TULAJDONSAGOK.
 *
 * KORABBAN a negy karosszeria kizarolag latvanyban tert el: a meretek
 * masok voltak (azok mertek), de a HP, a tomeg es a vezetes azonos.
 * A valasztas igy izles kerdese volt, nem donteé.
 *
 * MOSTANTOL NEM AZ. Az auto MOZGAST es TARTOSSAGOT ad -- gyorsabb de
 * torekenyebb, vagy lassabb de strapabb --, es ez a valasztas
 * kovetkezmenyekkel jar.
 *
 * HAROM TENGELY, HAROM RENDSZER -- ez a felosztas tartja ertelmesen
 * kulon a jatekos harom dontését:
 *
 *   - AUTO: hogyan mozogsz, es meddig birod.
 *   - FEGYVER (weapons.ts): hogyan sebzel.
 *   - KEPESSEG (abilities.ts): hogyan eled tul a kovetkezo ot masodpercet.
 *
 * Ezert NINCS itt sebzes-szorzo. Ha az auto is a sebzest allitana, a
 * fegyver-valasztas tetje csokkenne -- ket rendszer versenyezne
 * ugyanazert a szerepert.
 *
 * MIERT SZORZOK, ES NEM AUTONKENTI TELJES PARAMETERKESZLET
 *
 * A vezetes-modell alapertekeit (ARCADE, config.ts) kezzel, meresekkel
 * hangoltuk be (lasd EREDMENYEK.md), es a debugPanel FUTASIDOBEN irja
 * oket (`ARCADE.maxSpeed = ertek`) -- ez a hangolas eszkoze. Ha minden
 * autonak sajat, teljes keszlete lenne, ket dolog romlana el: a
 * futasideju hangolas csak az egyik autora hatna, es negy kulon
 * behangolando vezetes-modellunk lenne egy helyett.
 *
 * Igy viszont az alapmodell marad az IGAZSAG, az autok pedig ELTERESEK
 * attol. A `carTuning()` ezert MINDIG az elo ARCADE-bol szamol, nem
 * modul-betolteskor dermed meg.
 *
 * A CROSSOVER MINDENBEN PONTOSAN 1,0. Nem veletlen: igy a jatek eddigi,
 * behangolt vezetese nem tunik el, hanem tovabbra is elerheto -- es a
 * meglevo meresek (check-arcade.ts) kapnak egy autot, amire valtozatlanul
 * igazak.
 */

export interface CarStats {
  /**
   * Karosszeria-eletero (abszolut szam, nem szorzo).
   *
   * Azert abszolut, mert a jatekos EZT latja a HUD-on es a HP-savon --
   * egy "1,3-as szorzo" nem jelent semmit annak, aki jatszik.
   */
  hp: number;
  /**
   * Szorzo a CHASSIS.mass-ra. Ebbol jon az utkozes lokese es a
   * sebzes-arany.
   *
   * A combat.ts SZANDEKOSAN nem importalja ezt a modult, hanem SZAMKENT
   * kapja a ket tomeg-szorzot: kulonben kor alakulna ki (carStats ->
   * combat -> carStats), es a modulok betoltesi sorrendjetol fuggne,
   * hogy melyik konstans letezik mar.
   */
  mass: number;
  /** Szorzo a csucs-, boost- es tolatasi sebessegre. */
  speed: number;
  /** Szorzo a gyorsulasra (gazzal es boosttal). */
  accel: number;
  /** Szorzo a fordulasra es az oldaltapadasra. */
  turn: number;
}

/**
 * A negy auto.
 *
 * A szamok a MEGLEVO sziluetthez igazodnak, nem forditva: az izomauto
 * alacsony es hosszu orru (gyors, torekeny), a rohamkocsi magas es
 * nehez (lassu, strapabiro). Igy a jatekos messzirol, a formabol tudja,
 * mivel all szemben -- egy kis ikon a HUD-on ezt nem potolna.
 */
export const CAR_STATS: Record<CarId, CarStats> = {
  Muscle: { hp: 80, mass: 0.95, speed: 1.15, accel: 1.1, turn: 1.0 },
  Crossover: { hp: 100, mass: 1.0, speed: 1.0, accel: 1.0, turn: 1.0 },
  Jeep: { hp: 115, mass: 1.15, speed: 0.94, accel: 0.9, turn: 0.92 },
  Rescue: { hp: 130, mass: 1.3, speed: 0.86, accel: 0.8, turn: 0.85 },
};

export function carStats(car: CarId): CarStats {
  return CAR_STATS[car] ?? CAR_STATS[DEFAULT_CAR];
}

/** Egy auto maximalis (es kezdo) karosszeria-eletereje. */
export function maxHpOf(car: CarId): number {
  return carStats(car).hp;
}

/** Egy auto tomege (kg) -- a kozos alaptomeg szorozva. */
export function carMass(car: CarId): number {
  return CHASSIS.mass * carStats(car).mass;
}

/**
 * A LEGNAGYOBB eletero a mezonyben.
 *
 * Szamolt, nem beirt szam: aki uj autot vesz fel a tablazatba, annak
 * nem kell tudnia, hogy ez a konstans letezik. Ott hasznaljuk, ahol
 * egy hatarnak MINDEN autora igaznak kell lennie (pl. HP-sav skalaja
 * ismeretlen autonal).
 */
export const MAX_CAR_HP = Math.max(...CAR_MODELS.map((m) => maxHpOf(m.id)));

/**
 * A leggyorsabb auto sebesseg-szorzoja.
 *
 * A plauzibilitas-ellenorzes hasznalja: a globalis sebesseg-hatarnak a
 * leggyorsabb autora is igaznak kell lennie, kulonben a jatek a
 * leggyorsabb kocsit csalasnak latna (lasd net/plausibility.ts).
 */
export const MAX_SPEED_MULTIPLIER = Math.max(
  ...CAR_MODELS.map((m) => carStats(m.id).speed),
);

/**
 * A vezetes-modell SZAMAI egy adott autora.
 *
 * Csak azok a mezok vannak itt, amiket az auto modosit. Ami hianyzik
 * (fekezes, motorfek, kormany valaszideje, levegobeli iranyitas), az
 * SZANDEKOSAN kozos:
 *
 *  - a fektav es a motorfek egy NEGYEDIK, lathatatlan tengely lenne
 *    (a jatekos nem latja a valasztoban, megis dontene a parbajokat),
 *  - a lokes lecsengeset a coastDecel intezi, es ha az autonkent
 *    kulonbozne, ugyanaz a robbanas mas tavolsagra vinne a kocsikat --
 *    a jatekos szamara kiszamithatatlanul.
 */
export interface CarTuning {
  maxSpeed: number;
  boostMaxSpeed: number;
  maxReverseSpeed: number;
  accel: number;
  boostAccel: number;
  maxYawRate: number;
  turnRampSpeed: number;
  turnFactorAtTopSpeed: number;
  lateralGrip: number;
  driftLateralGrip: number;
}

/**
 * SEMLEGES szorzok: pontosan a hangolt alapmodell.
 *
 * NEM a DEFAULT_CAR szorzoi! Az alapertelmezett auto az izomauto, ami
 * gyorsabb az atlagnal -- ha a "nem tudom, melyik auto" eset azt
 * kapna, minden auto nelkuli meres es minden regi hivo eszrevetlenul
 * gyorsabb kocsit merne, mint amit az ARCADE leir.
 */
const SEMLEGES: Omit<CarStats, "hp"> = {
  mass: 1,
  speed: 1,
  accel: 1,
  turn: 1,
};

/**
 * Egy auto vezetesi szamai, az ELO ARCADE-bol.
 *
 * Auto nelkul hivva pontosan az ARCADE ertekeit adja vissza (lasd
 * SEMLEGES).
 *
 * Minden hivasnal ujraszamol -- ez szandekos, lasd a fenti indoklast a
 * debugPanel futasideju hangolasarol. Tiz szorzas kepkockankent, ez
 * nem melheto koltseg.
 */
export function carTuning(car?: CarId): CarTuning {
  const s = car ? carStats(car) : SEMLEGES;
  return {
    maxSpeed: ARCADE.maxSpeed * s.speed,
    boostMaxSpeed: ARCADE.boostMaxSpeed * s.speed,
    maxReverseSpeed: ARCADE.maxReverseSpeed * s.speed,
    accel: ARCADE.accel * s.accel,
    boostAccel: ARCADE.boostAccel * s.accel,
    maxYawRate: ARCADE.maxYawRate * s.turn,
    // A felfutasi sebesseg NEM szorzodik: ez az a sebesseg, ahol a
    // kormany teljes ereju lesz. Ha a lassabb autonal is feljebb
    // kerulne, a nehez kocsi a sajat csucssebessegehez kepest KESOBB
    // kapna kormanyt -- duplan buntetve ugyanazert.
    turnRampSpeed: ARCADE.turnRampSpeed,
    turnFactorAtTopSpeed: ARCADE.turnFactorAtTopSpeed,
    lateralGrip: ARCADE.lateralGrip * s.turn,
    driftLateralGrip: ARCADE.driftLateralGrip * s.turn,
  };
}

/**
 * Egy auto "eronlete" 0..1 kozott, tengelyenkent atlagolva.
 *
 * NEM a jatekmenet hasznalja, hanem a BALANSZ-MERES (check-car-stats):
 * ha egy auto minden tengelyen a legjobb, ez azonnal latszik rajta. A
 * HP-t a mezony HP-tartomanyahoz, a tobbit az 1,0-hoz kepest merjuk.
 */
export function statPower(car: CarId): number {
  const s = carStats(car);
  const hpMin = Math.min(...CAR_MODELS.map((m) => maxHpOf(m.id)));
  const hpMax = Math.max(...CAR_MODELS.map((m) => maxHpOf(m.id)));
  const hpNorm = hpMax > hpMin ? (s.hp - hpMin) / (hpMax - hpMin) : 0.5;
  // A tomeg elony (lokes es sebzes-arany), ezert ugyanugy szamit, mint
  // a tobbi: a 0,8--1,3 savot kepezzuk le 0..1-re.
  const norm = (ertek: number, also: number, felso: number) =>
    (ertek - also) / (felso - also);
  return (
    (hpNorm +
      norm(s.mass, 0.8, 1.35) +
      norm(s.speed, 0.8, 1.2) +
      norm(s.accel, 0.75, 1.15) +
      norm(s.turn, 0.8, 1.05)) /
    5
  );
}

/** Hany csillagbol all egy ertekeles. */
export const STAR_COUNT = 5;

/**
 * KET ertekeles, csillagban -- ennyit lat a jatekos a valasztonal.
 *
 * A REJTETT STAT TISZTESSEGTELEN STAT: ha az auto elonyt ad, azt a
 * valasztasnal latni kell, nem harom meccs utan kikovetkeztetni.
 *
 * MIERT CSAK KETTO, amikor ot tengely van. A valasztonal a kerdes nem
 * az, hogy "pontosan mennyi", hanem hogy "melyiket vigyem". Erre ket
 * tengely valaszol -- gyors vagy szivos --, es a masik harom UGYANEZT
 * a ket iranyt erositi: a nehezebb auto lassabb es lomhabb is. Ot
 * csillagsor ugyanazt mondana negyszer, es kozben olvashatatlan lenne
 * egy 240 px szeles gombon.
 *
 * A tomeg es a kanyar tehat nem tunt el a jatekbol, csak a KIJELZOROL:
 * a szamok valtozatlanul a CAR_STATS-ban vannak.
 *
 * A SKALA A MEZONYHOZ IGAZODIK, nem rogzitett hatarokhoz: a leggyorsabb
 * auto mindig ot csillag, a leglassabb mindig egy. Igy a csillagok
 * OSSZEHASONLITAST mondanak (ez gyorsabb annal), nem egy abszolut
 * mercet, amirol a jatekos ugysem tudna, mihez kepest ertse. Uj auto
 * felvetelekor a sorok maguktol igazodnak -- nincs mit karbantartani.
 */
export interface CarStars {
  /** Csucssebesseg, 1..STAR_COUNT. */
  speed: number;
  /** Eletero, 1..STAR_COUNT. */
  hp: number;
}

function csillagok(ertek: number, mind: readonly number[]): number {
  const also = Math.min(...mind);
  const felso = Math.max(...mind);
  // Ha a mezony egyforma (elmeleti eset), mindenki a kozepet kapja --
  // a nulla-osztas helyett, ami NaN csillagot adna.
  if (felso <= also) return Math.ceil(STAR_COUNT / 2);
  const arany = (ertek - also) / (felso - also);
  return Math.round(1 + arany * (STAR_COUNT - 1));
}

export function carStars(car: CarId): CarStars {
  const sebessegek = CAR_MODELS.map((m) => carStats(m.id).speed);
  const eletek = CAR_MODELS.map((m) => maxHpOf(m.id));
  return {
    speed: csillagok(carStats(car).speed, sebessegek),
    hp: csillagok(maxHpOf(car), eletek),
  };
}

/** Egy ertekeles csillag-soza: "★★★☆☆". */
export function starRow(count: number): string {
  const tele = Math.max(0, Math.min(STAR_COUNT, Math.round(count)));
  return "★".repeat(tele) + "☆".repeat(STAR_COUNT - tele);
}

/**
 * Szoveges alak -- oda, ahol a csillagok nem olvashatok fel.
 *
 * A gomb `title`-jehez es a kepernyoolvasonak: a "★★★★★" karaktereket
 * a felolvaso "fekete csillag, fekete csillag..." alakban mondana be.
 */
export function statText(car: CarId): string {
  const s = carStars(car);
  return `sebesség ${s.speed}/${STAR_COUNT}, élet ${s.hp}/${STAR_COUNT}`;
}
