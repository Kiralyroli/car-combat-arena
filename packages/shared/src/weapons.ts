import { CHASSIS } from "./config";
import { clamp, rotateVec } from "./math";

/**
 * Fegyverek.
 *
 * Ketfele fegyver van, SZANDEKOSAN elteroen mukodo elvvel -- nem
 * ugyanaz mas szamokkal:
 *
 *  - AGYU (cannon): lassu, repulo raketa, robbanassal. Terulet-sebzes,
 *    kerek-serules es fizikai lokes. A horzsolt talalat is ér valamit,
 *    tehat megbocsatobb, viszont ritkan tuzel (1.2 mp).
 *  - GEPFEGYVER (machinegun): AZONNALI talalat (hitscan), egyetlen
 *    celpontra, kis sebzessel de surun. Nincs robbanas, nincs lokes es
 *    nem tor kereket -- cserebe pontos celzassal tartos nyomast ad.
 *
 * Igy a valasztasnak tenyleges tetje van: az agyu a kaosz es a
 * tomegharc fegyvere, a gepfegyver az uldozese.
 */

export type WeaponId = "cannon" | "machinegun";

export const WEAPON_IDS: readonly WeaponId[] = ["cannon", "machinegun"];

/** Aki nem valaszt, agyut kap -- ez a jatek eddigi (ismert) fegyvere. */
export const DEFAULT_WEAPON: WeaponId = "cannon";

/**
 * A tetőn ülő fegyver geometriaja, a karosszeria KOZEPPONTJAHOZ kepest.
 *
 * EGY forrasbol dolgozik a megjelenites (scene.ts ebbol allitja be a
 * modellt) es a fizika (innen szamolodik a loves kiindulopontja). Ez
 * nem szepitkezes: kulon szamokkal a ket oldal eszrevetlenul elcsuszna,
 * es a jatekos azt latna, hogy a loves nem a csobol jon.
 *
 * FEGYVERENKENT KULON: a ket fegyvernek sajat modellje van (turret.glb
 * es flak.glb), mas-mas csohosszal. Egy kozos szam valamelyiket
 * elrontana -- vagy az agyu lone a cso kozepebol, vagy a gepfegyver a
 * cso vege ELOTTI levegobol.
 */

/**
 * A fegyver talpanak magassaga a karosszeria kozeppontja folott (m).
 *
 * Ez KOZOS: mindket fegyver ugyanarra a tetőre kerul. A modell tetőteje
 * kb. 1.45 m-re van a talajtol, a chassis kozeppontja pedig
 * halfExtents.y magasan -- a kettő kulonbsege adja a tetőszintet.
 */
export const WEAPON_MOUNT_HEIGHT = 1.45 - CHASSIS.halfExtents.y;

export interface WeaponMount {
  /**
   * A BOLINTAS tengelye, a talp folott (m).
   *
   * A modellbol MERVE: a Turret_Gun csomopont eltolasa a Turret_Base-hez
   * kepest. Nem talalgatott ertek -- ha a modell cserelodik, ujra kell
   * merni, kulonben a loves nem a csobol indul.
   */
  pitchPivot: number;
  /**
   * A csotorkolat tavolsaga a bolintas tengelyetol, elore (m).
   *
   * Szinten MERVE, es a modell keszitesenel KIKENYSZERITVE: a cso
   * pontosan a bolintas tengelyenek magassagaban all vizszintesen, tehat
   * a bolintas a torkolatot ekkora sugaron forgatja. Ha a cso a tengely
   * folott vagy alatt lenne, ez az egy szam nem irna le a torkolatot.
   */
  muzzleForward: number;
}

/**
 * Fegyverenkenti rogzites-geometria, mindketto a sajat modelljebol merve.
 */
export const WEAPON_MOUNTS: Record<WeaponId, WeaponMount> = {
  // flak.glb -- Flak 18/36 88 mm, 2.6 m hosszura meretezve.
  cannon: { pitchPivot: 0.59, muzzleForward: 1.779 },
  // turret.glb -- 2.2 m hosszu gepagyu-torony.
  machinegun: { pitchPivot: 0.534, muzzleForward: 1.421 },
};

export function weaponMount(weapon: WeaponId): WeaponMount {
  return WEAPON_MOUNTS[weapon];
}

/** A csotorkolat tavolsaga a fegyver forgaspontjatol, elore. */
export function muzzleForwardOf(weapon: WeaponId): number {
  return WEAPON_MOUNTS[weapon].muzzleForward;
}

/**
 * A csotorkolat vilagbeli helye.
 *
 * A fuggoleges eltolas az AUTOVAL fordul (a fegyver a tetőre van
 * rogzitve), az elore-eltolas viszont a CELZAS iranyaba mutat (a cso
 * arra bolint). Ezert nem eleg egyetlen eltolas-vektor.
 *
 * A forward parameter alapertelmezesben a fegyver sajat csotorkolata; a
 * raketa ennel tovabb indul, hogy ne a sajat autoban szulessen meg
 * (lasd ROCKET_SPAWN_OFFSET).
 */
export function muzzleWorldPosition(
  carPosition: readonly number[],
  carRotation: readonly number[],
  direction: readonly [number, number, number],
  weapon: WeaponId,
  forward: number = muzzleForwardOf(weapon),
): [number, number, number] {
  const pivot = weaponPivot(carPosition, carRotation, weapon);
  return [
    pivot[0] + direction[0] * forward,
    pivot[1] + direction[1] * forward,
    pivot[2] + direction[2] * forward,
  ];
}

/**
 * A fegyver FORGASPONTJA vilagkoordinatakban.
 *
 * Innen kell szamolni a celzas iranyat is -- nem az auto kozeppontjabol.
 *
 * MIERT: a torkolat majdnem egy meterrel a kozeppont FOLOTT van. Ha a
 * szoget a kozeppontbol szamolnank, de a lovest a torkolatbol
 * inditanank, a ketto parhuzamos lenne, es a loves pont ennyivel a
 * celpont FOLE menne -- egy 1.51 m magas autonal ez a tetőt is
 * elkerulne. Merve: a visszatekeres-teszt azonnal nullara esett, amikor
 * a torkolatot feljebb vittem, de a celzas origoja a kozeppont maradt.
 *
 * A forgaspont SZANDEKOSAN nem fugg a celzas iranyatol (csak a cso
 * elore-nyulasa fugg tole), kulonben korkorös lenne a szamitas.
 */
export function weaponPivot(
  carPosition: readonly number[],
  carRotation: readonly number[],
  weapon: WeaponId,
): [number, number, number] {
  const rise = rotateVec(
    {
      x: carRotation[0],
      y: carRotation[1],
      z: carRotation[2],
      w: carRotation[3],
    },
    { x: 0, y: WEAPON_MOUNT_HEIGHT + WEAPON_MOUNTS[weapon].pitchPivot, z: 0 },
  );
  return [
    carPosition[0] + rise.x,
    carPosition[1] + rise.y,
    carPosition[2] + rise.z,
  ];
}

/**
 * Halozatrol erkezo ertek ellenorzese.
 *
 * A fegyvert a kliens valasztja, tehat barmit kuldhet: ismeretlen
 * erteknel az alapertelmezetthez esunk vissza, nem dobunk hibat.
 */
export function isWeaponId(value: unknown): value is WeaponId {
  return typeof value === "string" && (WEAPON_IDS as readonly string[]).includes(value);
}

export function toWeaponId(value: unknown): WeaponId {
  return isWeaponId(value) ? value : DEFAULT_WEAPON;
}

/** Megjelenitheto nev (magyarul) -- a lobbyhoz es a HUD-hoz. */
export function weaponLabel(weapon: WeaponId): string {
  return weapon === "machinegun" ? "Gépfegyver" : "Ágyú";
}

export const MACHINEGUN = {
  /**
   * Hatotav (m).
   *
   * Az arena 80 m szeles, tehat ez nem "vegtelen": a palya tuloldalara
   * nem er el, kozelre kell menni. Ez adja a fegyver jelleget az agyuval
   * szemben, ami az egesz palyat behuzza.
   */
  range: 70,

  /** Sebzes talalatonkent. */
  damage: 4,

  /**
   * Ket loves kozott eltelo ido (ms). 90 ms = 11.1 loves/mp, azaz
   * 44 sebzes/mp -- az agyu kb. 50/mp csucsahoz kepest kevesebb, de
   * folyamatos. Egy 100 HP-s auto kb. 2.3 mp tartos talalat alatt esik.
   */
  fireIntervalMs: 90,

  /**
   * Szoras (radian). 70 m-en kb. 0.84 m oldalirányu bizonytalansag --
   * kevesebb, mint egy auto szelessege, tehat a pontos celzas kifizetodo,
   * de a nagy tavolsagu tuzeles nem garantalt.
   */
  spreadRad: 0.012,


  // --- Tulmelegedes ---
  //
  // Ez fogja vissza a fegyvert az agyu ujratoltese helyett. Folyamatos
  // tuzzel a hoszint 36/mp utemben no (66 be, 30 ki), tehat kb. 2.8
  // masodperc utan fullad le. Utana a resumeHeat szintig kell hulnie,
  // ami kb. 2.3 masodperc.
  //
  // MIERT ENNYI: egy sorozat kb. 31 lovest, azaz 124 sebzest ad -- eleg
  // egy teli auto kilovesehez es egy kis rahagyasra, de nem tobbre.
  // Elso hangolasra 4.9 masodpercig birta, ami 216 sebzes: ket teli
  // autonal is tobb, egyetlen gombnyomva tartasbol.
  maxHeat: 100,
  heatPerShot: 6,
  coolPerSecond: 30,
  /** Tulmelegedes utan eddig kell lehulnie, mielott ujra tuzelhet. */
  resumeHeat: 30,
};

/**
 * A gepfegyver allapota egy jatekosnal.
 *
 * A SZERVERE tartja nyilvan (a tuzeles kovetkezmenye szerver-oldali),
 * a kliens csak megjeleniti a hoszintet.
 */
export interface MachinegunState {
  /** 0..MACHINEGUN.maxHeat */
  heat: number;
  /** Tulmelegedett-e -- ilyenkor `resumeHeat` ala kell hulnie. */
  overheated: boolean;
  /** Mikor lott utoljara (szerver-ora, ms). */
  lastShotAt: number;
}

export function idleMachinegun(): MachinegunState {
  return { heat: 0, overheated: false, lastShotAt: Number.NEGATIVE_INFINITY };
}

/**
 * Egy szerver-tick a gepfegyverre.
 *
 * SZANDEKOSAN tiszta fuggveny: a hoszint es a tuzgyorsasag a jatek
 * egyensulyanak resze, ezert motor es halozat nelkul is merhetonek kell
 * lennie (lasd scripts/check-weapons.ts).
 *
 * Tobb lovest is adhat egy hivasban: a szerver tickje hosszabb lehet,
 * mint a `fireIntervalMs`, es enelkul a fegyver csendben lassabban
 * tuzelne a beallitottnal.
 *
 * @param wantsToFire A jatekos nyomva tartja-e a gombot.
 * @param now Szerver-ido (ms).
 * @param dtMs Az elozo tick ota eltelt ido.
 */
export function stepMachinegun(
  state: MachinegunState,
  wantsToFire: boolean,
  now: number,
  dtMs: number,
): { state: MachinegunState; shots: number } {
  // Hules MINDIG fut, tuzeles kozben is -- csak lassabban, mint ahogy a
  // lovesek melegitenek.
  let heat = clamp(
    state.heat - (MACHINEGUN.coolPerSecond * dtMs) / 1000,
    0,
    MACHINEGUN.maxHeat,
  );
  let overheated = state.overheated;
  let lastShotAt = state.lastShotAt;

  if (overheated && heat <= MACHINEGUN.resumeHeat) overheated = false;

  let shots = 0;
  if (wantsToFire && !overheated) {
    // CSAK az ebben a tickben esedekes lovesek johetnek szoba.
    //
    // E nelkul egy hosszabb szunet utan a "le nem adott" lovesek
    // felhalmozodnak, es a kovetkezo gombnyomas azonnal kiad egy egesz
    // sorozatot: merve negy lovest EGY tickben. Gyors kattintgatassal
    // igy majdnem duplazhato lett volna a tuzgyorsasag -- vagyis a
    // nyomva tartas, amire a fegyver keszult, rosszabb lett volna a
    // kattintgatasnal.
    const earliest = now - dtMs - MACHINEGUN.fireIntervalMs;
    if (lastShotAt < earliest) lastShotAt = earliest;

    // Egy tickben ennyi loves fer bele. Csak akkor szamit, ha a szerver
    // tickje hosszabb volt a szokasosnal (terheles alatt).
    const maxShots = 4;
    while (
      shots < maxShots &&
      now - lastShotAt >= MACHINEGUN.fireIntervalMs &&
      !overheated
    ) {
      shots++;
      // Nem `now`-ra allitjuk: igy a tuzgyorsasag akkor sem csuszik el,
      // ha a tick nem pontosan a lovesek utemere esik.
      lastShotAt =
        lastShotAt === Number.NEGATIVE_INFINITY
          ? now
          : lastShotAt + MACHINEGUN.fireIntervalMs;
      heat = clamp(heat + MACHINEGUN.heatPerShot, 0, MACHINEGUN.maxHeat);
      if (heat >= MACHINEGUN.maxHeat) overheated = true;
    }
    // Ha regota nem lott, a fenti korrekcio elmaradhat a jelentol --
    // ilyenkor a kovetkezo loves azonnal esedekes lenne. Behozzuk.
    if (now - lastShotAt > MACHINEGUN.fireIntervalMs) lastShotAt = now;
  }

  return { state: { heat, overheated, lastShotAt }, shots };
}

/**
 * A celzas szogeibol egysegvektor.
 *
 * A szogek konvenciojat a kliens adja (lasd main.ts currentAim): a
 * `yaw` az az Y-forgatas, amivel egy -Z fele nezo objektum ebbe az
 * iranyba fordul. Ezert:  yaw = atan2(-dx, -dz),  pitch = atan2(dy, h).
 * Ennek a MEGFORDITASA all itt -- ha a ketto elcsuszik, a gepfegyver a
 * celkereszttel ellentetes iranyba lo.
 */
export function aimDirection(
  aimYaw: number,
  aimPitch: number,
): [number, number, number] {
  const horizontal = Math.cos(aimPitch);
  return [
    -Math.sin(aimYaw) * horizontal,
    Math.sin(aimPitch),
    -Math.cos(aimYaw) * horizontal,
  ];
}

/**
 * Szoras hozzaadasa egy iranyhoz.
 *
 * A veletlen szamokat a HIVO adja (0..1), hogy a fuggveny tesztelheto
 * maradjon -- a szoras hatarait igy pontosan meg lehet merni.
 */
export function applySpread(
  direction: readonly [number, number, number],
  spreadRad: number,
  random1: number,
  random2: number,
): [number, number, number] {
  if (spreadRad <= 0) return [direction[0], direction[1], direction[2]];

  // Merolegess bazis az iranyra: igy a szoras kor alaku, nem tengelyfuggo.
  const [dx, dy, dz] = direction;
  // Olyan segedvektor, ami biztosan nem parhuzamos az iranyval.
  const helper: [number, number, number] =
    Math.abs(dy) < 0.9 ? [0, 1, 0] : [1, 0, 0];

  const ux = dy * helper[2] - dz * helper[1];
  const uy = dz * helper[0] - dx * helper[2];
  const uz = dx * helper[1] - dy * helper[0];
  const ul = Math.hypot(ux, uy, uz) || 1;

  const vx = dy * (uz / ul) - dz * (uy / ul);
  const vy = dz * (ux / ul) - dx * (uz / ul);
  const vz = dx * (uy / ul) - dy * (ux / ul);

  // Egyenletes eloszlas a korlapon: a sugarnak gyok szerint kell nonie,
  // kulonben a talalatok a kozeppont kore surusodnenek.
  const angle = random1 * Math.PI * 2;
  const radius = Math.sqrt(random2) * spreadRad;
  const ox = Math.cos(angle) * radius;
  const oy = Math.sin(angle) * radius;

  const rx = dx + (ux / ul) * ox + vx * oy;
  const ry = dy + (uy / ul) * ox + vy * oy;
  const rz = dz + (uz / ul) * ox + vz * oy;
  const length = Math.hypot(rx, ry, rz) || 1;
  return [rx / length, ry / length, rz / length];
}
