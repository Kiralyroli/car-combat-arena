import {
  ABILITIES,
  abilityActive,
  abilityActiveLeft,
  abilityCooldownLeft,
  healPerMs,
  activateAbility,
  idleAbility,
  toAbilityId,
  type AbilityId,
  type AbilityState,
} from "@cca/shared";
import { RocketSimulation, explosionDamageFor } from "../simulation/rockets";
import { resolveHitscan } from "../simulation/machinegun";
import {
  carsOverlap,
  IMPACT_COOLDOWN_MS,
  RESPAWN_DELAY_MS,
  ROCKET_COOLDOWN_MS,
  splitCollisionDamage,
  brokenMaskOf,
  damageWheel,
  regenerateWheel,
  WHEEL_REGEN_DELAY_MS,
  gripsOf,
  healthyWheels,
  wheelExplosionDamage,
  wheelWorldPosition,
  MAX_HP,
  SPAWN_POINTS,
  SPAWN_PROTECTION_MS,
  pickSpawnIndex,
  shouldRepickSpawn,
  spawnSafety,
  type SpawnThreat,
  PICKUP_POINTS,
  pickupRespawnMs,
  HEALTH_RESTORE,
  withinPickupRange,
  LIVES_PER_PLAYER,
  MATCH_RESTART_DELAY_MS,
  canStart,
  isMatchOver,
  survivorsOf,
  winnerOf,
  DEFAULT_GAME_MODE,
  GAME_MODES,
  isTimed,
  isTimeUp,
  killCredited,
  killLeader,
  losesLife,
  type GameModeId,
  type KillCause,
  type KillEvent,
  sanitizePlayerName,
  aimDirection,
  applySpread,
  idleMachinegun,
  stepMachinegun,
  toWeaponId,
  assignCar,
  toCarId,
  toSkin,
  type CarId,
  FIXED_DT,
  INTERP_DELAY_MS,
  MACHINEGUN,
  muzzleWorldPosition,
  type MachinegunState,
  type TracerSnapshot,
  type WeaponId,
  type ClientState,
  type PlayerSnapshot,
  type MatchPhase,
  type MatchSnapshot,
  type ServerMessage,
  type WheelDamage,
} from "@cca/shared";

/** Terv 3. fejezet: minimum 2, idealis 4--8 jatekos. */
export const MAX_PLAYERS_PER_ROOM = 8;

/** Kezdo HP. A sebzes-rendszer a 4. lepcsoben jon (terv 8. fejezet). */
const START_HP = MAX_HP;

/**
 * Egy jatekos a szerver oldalan.
 *
 * A `send` fuggveny absztrakcio: a szoba NEM ismeri a WebSocketet
 * (lasd terv 15.5 -- a transport rteg cserelheto kell legyen).
 */
export interface ServerPlayer {
  id: string;
  /** Megjelenitett nev (mar tisztitva -- lasd sanitizePlayerName). */
  name: string;
  send: (message: ServerMessage) => void;
  state: ClientState;
  /** Melyik SPAWN_POINTS elemet foglalja -- kilepeskor felszabadul. */
  spawnIndex: number;
  /**
   * Meddig serthetetlen (performance.now); 0 = nem az.
   *
   * Az ujraszuletes utani rovid vedelem. AZERT kell, mert az arena
   * geometriaja miatt nincs biztonsagos spawn-pont: mind a 8 pont
   * lotavolsagon belul van egymastol (lasd spawn.ts).
   */
  protectedUntil: number;
  /**
   * Mikor sebzodott utoljara (performance.now); 0 = meg soha.
   *
   * A KEREK-REGENERALODAS orajat inditja ujra (lasd stepWheelRepair):
   * gyogyulni csak harcon kivul lehet. MINDEN sebzes-utvonalnak
   * frissitenie kell -- ha egy kimaradna, ott a jatekos tuz alatt is
   * javulna.
   */
  lastDamagedAt: number;
  /**
   * A kivalasztott ujraszuletesi hely, amig halott -- vagy null.
   *
   * Mar a HALAL PILLANATABAN eldol, hogy a jatekos a varakozas alatt
   * lathassa (a kliens odaviszi a kamerat). A harc mozgasat kovetve
   * frissulhet, lasd updateRespawnPlans.
   */
  pendingSpawnIndex: number | null;
  /**
   * Hol semmisult meg -- vagy null, ha el.
   *
   * A valasztas ezt bunteti: aki megolt, jo esellyel meg ott van, tehat
   * oda visszaszuletni a legrosszabb, ami tortenhet.
   */
  deathPosition: [number, number, number] | null;
  /**
   * A jatekos MAGA valasztotta-e a helyet.
   *
   * Ilyenkor a szerver NEM irja felul az ajanlataval, meg akkor sem, ha
   * kozben veszelyesebbe valik: a sajat dontest nem vesszuk el tole.
   */
  /**
   * Az auto szine.
   *
   * A jatekos KERI a belepeskor, a szoba dönti el (lasd assignCar):
   * ket jatekos nem kaphat ugyanolyat, kulonben pont a
   * megkulonboztethetoseg veszne el, amiert az egesz keszult.
   */
  car: CarId;
  /**
   * A festes a karosszerian.
   *
   * A KAROSSZERIA + FESTES paros az, ami egyedi: negy forma nem lenne
   * eleg nyolc jatekosra.
   */
  skin: string;
  spawnChosenManually: boolean;
  /**
   * A legutobb ELKULDOTT terv lenyomata.
   *
   * Enelkul minden tickben mennne egy uzenet (60/mp, jatekosonkent),
   * pedig a terv masodpercekig valtozatlan.
   */
  planKey: string;
  hp: number;
  /**
   * Kerekenkenti serules -- a SZERVER birtokolja (terv 4.6).
   * Sorrend: FL, FR, RL, RR (= WHEEL_LAYOUT).
   */
  wheels: WheelDamage[];
  /** Az utoljara elfogadott allapot sorszama -- a kesve erkezok eldobasahoz. */
  lastSeq: number;
  /**
   * Mikor erkezett utoljara allapot-uzenete (performance.now) --
   * FUGGETLENUL attol, hogy elfogadtuk-e.
   *
   * Szandekosan nem az utolso ELFOGADAS ideje: abbol a megengedett
   * elmozdulas az elutasitasok alatt magatol nőne, tehat elég lenne
   * varni egy keveset, es a teleport atmenne.
   */
  lastStateAt: number;
  /** Hany allapotot utasitottunk el osszesen (plauzibilitas). */
  rejectedCount: number;
  /** Hany allapotot utasitottunk el egymas utan -- lasd resync. */
  consecutiveRejects: number;
  /** Mikor lott utoljara rakétat (performance.now) -- lasd ROCKET_COOLDOWN_MS. */
  lastFiredAt: number;
  /**
   * Mikor semmisult meg (performance.now), vagy null, ha el.
   * A HP onmagaban nem eleg: az ujraszuletes pillanataban tudni kell,
   * mikor jart le a varakozas.
   */
  deadSince: number | null;
  /**
   * Hany boost-visszatoltest kapott eddig (monoton no).
   *
   * A tartaly maga a kliensnel van (lasd BoostTank), a szerver csak a
   * KIOSZTOTT visszatoltesek szamat tartja -- ebbol a kliens
   * onkorrekcios modon tudja, mennyit kell toltenie.
   */
  boostGrants: number;
  /**
   * Hany elete van meg (Last Car Standing). 0 = kiesett, nezokent van
   * jelen. A megsemmisules ebbol von le egyet.
   */
  lives: number;
  /**
   * A valasztott fegyver.
   *
   * A lobbyban all be, es CSAK ujraszuleteskor valtoztathato (lasd
   * setWeapon) -- menekules kozben nem lehet atvaltani arra, ami eppen
   * jobban jonne.
   */
  weapon: WeaponId;
  /**
   * A valasztott KEPESSEG es annak allapota.
   *
   * Ugyanaz a szabaly, mint a fegyvernel: elve nem valthato (lasd
   * setAbility).
   */
  ability: AbilityId;
  abilityState: AbilityState;
  /**
   * Hany jatekost lott ki EBBEN a meccsben.
   *
   * A meccs indulasakor nullazodik (lasd startMatch): egy uj meccs uj
   * eredmennyel indul, kulonben a deathmatch elso masodpercetol az
   * elozo meccs allasa latszana.
   */
  kills: number;
  /**
   * Ki sebezte utoljara, mivel, es mikor -- a KILOVES beszamitasahoz.
   *
   * A halal pillanataban ebbol dol el, kie az erdem. Idokorlattal (lasd
   * killCredited): egy perccel korabbi koccanas mar nem szamit.
   */
  lastAttacker: { id: string; cause: KillCause; at: number } | null;
  /**
   * Mennyi eletet kell MEG visszaadni a folyamatban levo gyogyitasbol.
   *
   * A gyogyitas harom masodperc alatt tortenik, tehat tickenkent egy
   * TORT eletet ad. A HP viszont egesz szam (a HUD is azt mutatja),
   * ezert a maradekot itt gyujtjuk, es csak a teljes eleteket adjuk at.
   * E nelkul a kerekites minden tickben elnyelne a nyereseget, es a
   * gyogyitas csendben nem csinalna semmit.
   */
  healLeft: number;
  healAcc: number;
  /** A gepfegyver hoszintje es tuzeles-utemezese. */
  mg: MachinegunState;
  /**
   * A legutobb feldolgozott szerver-tick, amit a kliens visszajelzett;
   * null, amig nem jelzett vissza semmit.
   *
   * Ebbol szamoljuk, mennyire regi vilagot lat -- lasd rewindMs.
   */
  ackTick: number | null;
  /**
   * A szerver altal MERT kesesek (ms), a legutobbi mintak.
   *
   * Miert kell, ha az `ackTick` is a kesest irja le? Mert az `ackTick`-et
   * a KLIENS kuldi: aki egyszeruen nem novelte, annak a visszatekerese
   * felkuszott a MAX_REWIND_MS-ig, es 400 ms-mal korabbi celpontokra
   * lohetett -- oda, ahonnan a masik mar rég elment, es ahol kiterni
   * sem tudott. Ez a mezo a szerver sajat merese (WebSocket ping/pong,
   * a bongeszo halozati retege valaszol ra), tehat a jatek-kliens nem
   * tudja felfele hazudni; ezzel a mert ertekkel VAGJUK a bevallott
   * kesest (lasd rewindMsFor).
   *
   * Ures tomb = meg nincs meres (a kapcsolat elso pillanatai).
   */
  rttSamples: number[];
  /** Pozicio-elozmeny a visszatekereshez (legregibb elol). */
  history: PoseSample[];
}

/** Egy korabbi allapot a visszatekereshez. */
interface PoseSample {
  t: number;
  position: [number, number, number];
  rotation: [number, number, number, number];
}

/**
 * Ennel tovabb NEM tekerunk vissza (ms).
 *
 * Ket okbol kell felso hatar. Egyreszt egy nagyon rossz kapcsolatu
 * jatekos kulonben masodperces regi allapotokra lohetne, ami a
 * celpontnak eselytelen ("a sarkon mar rég befordultam, megis
 * eltalalt"). Masreszt ez korlatozza, mennyit nyerhet valaki azzal, ha
 * szandekosan keslelteti a visszajelzeset.
 */
const MAX_REWIND_MS = 400;

/** Ennyi ideig tartjuk a pozicio-elozmenyt (ms). */
const HISTORY_MS = 600;

/**
 * Ennyi legutobbi RTT-mintabol vesszuk a LEGNAGYOBBAT.
 *
 * Nem atlagot: a halozati keses ingadozik, es egy szerencsesen alacsony
 * minta miatt nem szabad szuk visszatekeressel bunteti a becsuletes
 * jatekost -- az abbol eredo melle-lovesnek semmi jele nem lenne.
 * A maximum "megbocsato" irany, es egy csalot igy is a valos keseshez
 * kot. Masodpercenkent egy minta, tehat ez kb. negy masodperc ablak.
 */
const RTT_SAMPLES = 4;

/**
 * Rahagyas a mert kesesre (ms).
 *
 * A meres (WebSocket ping/pong) es a jatek-uzenetek utja nem pontosan
 * ugyanaz -- kulon sorban allhatnak --, ezert a mert erteket nem
 * szigoruan, hanem ezzel a rahagyassal hasznaljuk felso korlatnak.
 */
const RTT_TOLERANCE_MS = 40;

/** Rendezett parkulcs, hogy (a,b) es (b,a) ugyanaz legyen. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const ORIGIN_STATE: ClientState = {
  position: [0, 2.5, 0],
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0],
  steer: 0,
  susp: [0, 0, 0, 0],
  aimYaw: 0,
  aimPitch: 0,
  firing: false,
};

export class Room {
  readonly code: string;
  /**
   * A szoba JATEKMODJA -- a nyitasakor dol el, es utana nem valtozik.
   *
   * Meccs kozben nem valthato: a mod nem beallitas, hanem a jatek
   * kerdese (ki el a legtovabb / ki ut ki tobbet). Aki mas modot akar,
   * uj szobat nyit -- igy senki alatt nem valtozik meg a jatek, amibe
   * belepett.
   */
  readonly mode: GameModeId;
  private readonly players = new Map<string, ServerPlayer>();

  constructor(code: string, mode: GameModeId = DEFAULT_GAME_MODE) {
    this.code = code;
    this.mode = mode;
  }

  get playerCount(): number {
    return this.players.size;
  }

  get isEmpty(): boolean {
    return this.players.size === 0;
  }

  get isFull(): boolean {
    return this.players.size >= MAX_PLAYERS_PER_ROOM;
  }

  playerIds(): string[] {
    return [...this.players.keys()];
  }

  add(
    id: string,
    send: (message: ServerMessage) => void,
    name?: string,
    weapon?: WeaponId,
    car?: CarId,
    ability?: AbilityId,
    skin?: string,
  ): ServerPlayer {
    const spawn = this.allocateSpawn(null);
    const player: ServerPlayer = {
      id,
      // A nevet a SZERVER tisztitja: a kliens barmit kuldhet.
      name: sanitizePlayerName(name, id),
      send,
      state: spawn.state,
      spawnIndex: spawn.index,
      // A KINEZETET a SZOBA osztja: a kliens keresebol csak akkor lesz
      // valosag, ha a paros (karosszeria + festes) meg szabad.
      ...assignCar({ car: toCarId(car), skin: toSkin(toCarId(car), skin) }, [
        ...this.players.values(),
      ]),
      protectedUntil: 0,
      // A kepesseget is a SZERVER ellenorzi: ismeretlen ertek eseten
      // az alapertelmezett.
      ability: toAbilityId(ability),
      abilityState: idleAbility(),
      kills: 0,
      lastAttacker: null,
      healLeft: 0,
      healAcc: 0,
      lastDamagedAt: 0,
      pendingSpawnIndex: null,
      deathPosition: null,
      spawnChosenManually: false,
      planKey: "",
      hp: START_HP,
      wheels: healthyWheels(),
      lastSeq: -1,
      lastStateAt: performance.now(),
      rejectedCount: 0,
      consecutiveRejects: 0,
      lastFiredAt: 0,
      deadSince: null,
      boostGrants: 0,
      lives: LIVES_PER_PLAYER,
      // A fegyvert is a SZERVER ellenorzi: ismeretlen ertek eseten agyu.
      weapon: toWeaponId(weapon),
      mg: idleMachinegun(),
      ackTick: null,
      rttSamples: [],
      history: [],
    };
    this.players.set(id, player);
    return player;
  }

  remove(id: string): boolean {
    // Az utkozes-hutesek kozul a hozza tartozokat is eldobjuk, kulonben
    // a map hosszu uzemidon at folyamatosan nőne.
    for (const key of this.lastImpactAt.keys()) {
      if (key.includes(id)) this.lastImpactAt.delete(key);
    }
    // A mar uton levo rakétai is eltunnek: kulonben gazdatlanul
    // repulnenek tovabb, es meg sebeznenek is valakit.
    this.rockets.removeOwnedBy(id);
    return this.players.delete(id);
  }

  get(id: string): ServerPlayer | undefined {
    return this.players.get(id);
  }

  /**
   * Uzenet minden jatekosnak, kiveve (opcionalisan) egyet -- pl. a
   * "csatlakozott" ertesitest nem kell visszakuldeni annak, aki epp
   * csatlakozott.
   */
  broadcast(message: ServerMessage, exceptId?: string): void {
    for (const player of this.players.values()) {
      if (player.id === exceptId) continue;
      player.send(message);
    }
  }

  /**
   * Utkozesek kiertekelese es sebzes (terv 4. lepcso 2. pont).
   *
   * A szerver SAJAT MAGA vizsgalja meg, hogy ket auto osszeert-e -- nem
   * fogad el "eltalaltak" bejelentest a klienstol (terv 15.4: a sebzest
   * kizarolag a szerver szamolja). Az alapadat a mar plauzibilitas-
   * ellenorzott pozicio es sebesseg.
   *
   * Mindket auto ugyanannyi sebzest kap: a body HP ebben a lepcsoben
   * meg szandekosan egyszeru es NEM iranyfuggo (terv 4. lepcso 1. pont).
   */
  resolveCollisions(now: number): void {
    const players = [...this.players.values()];

    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i];
        const b = players[j];
        // Megsemmisult auto nem sebez es nem sebzodik: a roncs nincs
        // jelen a palyan (a kliensek is elrejtik).
        if (a.deadSince !== null || b.deadSince !== null) continue;
        // A frissen szuletett sem -- SEM KAP, SEM AD sebzest.
        //
        // A "sem ad" nem reszletkerdes: enelkul a vedelem fegyverre
        // valna, es a serthetetlen jatekos bunteten kosolhatna szet a
        // mezonyt. Igy viszont a talalkozas egyszeruen nem tortenik meg.
        if (this.isProtected(a, now) || this.isProtected(b, now)) continue;

        const key = pairKey(a.id, b.id);
        const lastImpact = this.lastImpactAt.get(key) ?? 0;
        if (now - lastImpact < IMPACT_COOLDOWN_MS) continue;

        // Az AUTOJUKKAL: a kocsik 3,7 es 5,8 m kozott vannak, tehat
        // egy kozos merettel a hosszu kocsi ugy is koccanna, hogy meg
        // egy meterre van a masiktol.
        if (!carsOverlap(a.state, b.state, a.car, b.car)) continue;

        // Aki nekiment a masiknak, kevesebbet kap -- lasd splitCollisionDamage.
        const damage = splitCollisionDamage(a.state, b.state);
        if (damage.a <= 0 && damage.b <= 0) continue;

        a.hp = Math.max(0, a.hp - damage.a);
        b.hp = Math.max(0, b.hp - damage.b);
        if (damage.a > 0) {
          a.lastDamagedAt = now;
          this.creditAttacker(a, b.id, "ram", now);
        }
        if (damage.b > 0) {
          b.lastDamagedAt = now;
          this.creditAttacker(b, a.id, "ram", now);
        }
        this.lastImpactAt.set(key, now);

        console.log(
          `[room ${this.code}] utkozes: ${a.id.slice(0, 8)} -${damage.a} HP (${a.hp}) <-> ` +
            `${b.id.slice(0, 8)} -${damage.b} HP (${b.hp})`,
        );

        this.markDeadIfDestroyed(a, now);
        this.markDeadIfDestroyed(b, now);
      }
    }
  }

  /**
   * Mikor bukkan fel ujra az adott pickup (performance.now); 0 = most
   * is felveheto. PICKUP_POINTS-szal azonos indexeles.
   */
  private readonly pickupReadyAt: number[] = PICKUP_POINTS.map(() => 0);

  /** Eppen felveheto-e mindegyik pickup -- a snapshothoz. */
  pickupsAvailable(now: number): boolean[] {
    return this.pickupReadyAt.map((readyAt) => readyAt <= now);
  }

  /**
   * Pickupok felvetele (terv 4. lepcso 4. pont).
   *
   * A SZERVER dönti el, ki vette fel: e nelkul ket jatekos ugyanazt a
   * pickupot venne fel a sajat kepernyojen, es mindketto jogosnak
   * erezne. Aki eloszor ideer a szerver szerint, azé.
   */
  collectPickups(now: number): void {
    for (const player of this.players.values()) {
      if (player.deadSince !== null) continue;

      for (let i = 0; i < PICKUP_POINTS.length; i++) {
        const pickup = PICKUP_POINTS[i];
        if (this.pickupReadyAt[i] > now) continue;
        if (!withinPickupRange(player.state.position, pickup)) continue;

        // TELI eletnel nem vesszuk fel: kulonben a mellette elhajto,
        // sertetlen jatekos elvinne azt, amire masnak tenyleg szuksege
        // van -- ugy, hogy neki semmit nem er.
        //
        // A MAR UTON LEVO gyogyulas is beleszamit (healLeft): mostantol
        // a pickup fokozatosan hat, tehat a HP LEMARAD attol, amit a
        // jatekos mar megkapott. Enelkul a frissen felvett elet mellett
        // a masodikat is fel lehetne szedni ugy, hogy a nagyobb resze
        // karba vesszen.
        //
        // A boostnal ez nem tehetó meg: a tartaly a KLIENSNEL van (terv
        // 15.4), a szerver nem tudja, mennyi van benne.
        if (pickup.kind === "health" && player.hp + player.healLeft >= MAX_HP) {
          continue;
        }

        this.pickupReadyAt[i] = now + pickupRespawnMs(pickup.kind);

        if (pickup.kind === "health") {
          // FOKOZATOS, ugyanugy, mint a gyogyito kepesseg (stepHealing).
          //
          // Azonnali gyogyitassal a pickup egy "mentogomb" volt: a
          // halalos loves elott athajtva rajta a jatekos egy pillanat
          // alatt eltuntette az addigi sebzest, es a tamadonak semmi
          // esélye nem volt reagálni. Ugyanaz a megfontolas, ami miatt
          // a kepesseg is harom masodperc alatt gyogyit -- a ket ut
          // most mar UGYANAZON a lepesen (es ugyanazon a sebessegen,
          // healPerMs) megy at.
          //
          // OSSZEADODIK egy futo gyogyulassal (+=, nem =): ket forras
          // egymastol fuggetlen, es a felvett eletnek nem szabad
          // eltuntetnie a kepessegbol meg hatralevo reszt.
          player.healLeft += HEALTH_RESTORE;
          console.log(
            `[room ${this.code}] ${player.id.slice(0, 8)} felvette a ${i}. eletet ` +
              `(${player.hp} HP, gyogyul: +${Math.round(player.healLeft)})`,
          );
          continue;
        }

        // A visszatoltest a KLIENS vegzi el (nala van a tartaly); a
        // szerver csak konyveli, hogy jar neki egy.
        player.boostGrants++;
        console.log(
          `[room ${this.code}] ${player.id.slice(0, 8)} felvette a ${i}. boostot`,
        );
      }
    }
  }

  /**
   * Parokent az utolso sebzo utkozes ideje -- lasd IMPACT_COOLDOWN_MS.
   * Kilepeskor takaritjuk, kulonben idovel nőne a memoriaban.
   */
  private readonly lastImpactAt = new Map<string, number>();

  /**
   * "Ot sebezte X, ezzel a fegyverrel, ekkor."
   *
   * MINDEN sebzes-utvonalnak meg kell hivnia -- ha egy kimaradna, az
   * azzal a fegyverrel szerzett kiloves senkihez nem tartozna, es
   * csendben hianyozna a kilovés-listarol es a pontszambol is.
   *
   * A SAJAT sebzest is konyveljuk (a sajat robbanasunk elerhet minket):
   * a killCredited szuri ki, hogy ne kapjunk erte pontot -- igy viszont
   * egy korabbi tamado erdeme sem marad meg, ha kozben magunkat sebeztuk
   * halalra.
   */
  private creditAttacker(
    victim: ServerPlayer,
    attackerId: string,
    cause: KillCause,
    now: number,
  ): void {
    victim.lastAttacker = { id: attackerId, cause, at: now };
  }

  /**
   * A meccs KILOVESEI a legutobbi snapshot ota -- lasd KillEvent.
   *
   * A nyomjelzokkel azonos minta: a szerver gyujti, a snapshot elviszi,
   * es a lista kiurul. Igy egy kesobb erkezo kliens nem kap ra ugy
   * ertesitest, mintha most tortent volna.
   */
  private killFeed: KillEvent[] = [];

  drainKills(): KillEvent[] {
    if (this.killFeed.length === 0) return [];
    const ki = this.killFeed;
    this.killFeed = [];
    return ki;
  }

  /**
   * A megsemmisules konyvelese: elet, kiloves, kilovés-lista.
   *
   * NYILVANOS, mert a meresek kozvetlenul hivjak (lasd
   * check:mode-flow): a sebzes UTJAT mar mas tesztek merik, itt a
   * KOVETKEZMENY a kerdes -- kie a kiloves, es mi kerul a listara.
   */
  markDeadIfDestroyed(player: ServerPlayer, now: number): void {
    if (player.hp > 0 || player.deadSince !== null) return;
    player.deadSince = now;
    player.deathPosition = [...player.state.position];
    player.protectedUntil = 0;
    // Uj halal, uj dontes: a korabbi kezi valasztas nem oroklodik.
    player.spawnChosenManually = false;
    player.planKey = "";

    // A KILOVES konyvelese: kie az erdem, es mi vitte el.
    //
    // A fazistol FUGGETLENUL megy a kilovés-listara: a meccs elotti
    // szabad vezetesben is tortenik harc, es ott is tudni akarja a
    // jatekos, mi tortent. A PONT viszont csak futo meccsben jar --
    // kulonben a meccs elotti percekben elore lehetne gyujteni.
    const tamado = killCredited(player.lastAttacker, player.id, now)
      ? this.players.get(player.lastAttacker!.id) ?? null
      : null;
    this.killFeed.push({
      killerId: tamado?.id ?? null,
      killerName: tamado?.name ?? "",
      victimId: player.id,
      victimName: player.name,
      cause: tamado ? player.lastAttacker!.cause : null,
    });
    if (tamado && this.phase === "playing") tamado.kills++;
    // Uj elet, uj szamla: a kovetkezo halalt ne az elozo elet tamadoja
    // irja a javara.
    player.lastAttacker = null;

    // Elet csak FUTO meccsben, es csak a TULELESRE meno modban fogy.
    // Deathmatchben az ujraszuletes korlatlan -- ott a halal ara par
    // masodperc, nem a kieses. Varakozo (egyjatekos) vagy mar lezart
    // meccsben szinten nem fogy: kulonben az egyedul gyakorlo jatekos
    // harom halal utan kiesne egy olyan meccsbol, ami el sem indult.
    if (this.phase === "playing" && losesLife(this.mode)) {
      player.lives = Math.max(0, player.lives - 1);
    }

    console.log(
      `[room ${this.code}] ${player.id.slice(0, 8)} megsemmisult ` +
        `(${player.lives} elet maradt)`,
    );

    if (this.phase === "playing" && player.lives === 0) {
      console.log(`[room ${this.code}] ${player.id.slice(0, 8)} KIESETT`);
    }
  }

  // --- Meccs-allapot (Last Car Standing, terv 5. lepcso 2. pont) ---

  private phase: MatchPhase = "waiting";
  private winnerId: string | null = null;
  /** Mikor indul az uj meccs (performance.now); 0, ha nem `ended`. */
  private restartAt = 0;
  /**
   * Mikor indult a FUTO meccs (performance.now); 0, ha nem fut.
   *
   * Az IDORE meno modok visszaszamlaloja ebbol all elo. Kezdo idopont,
   * nem visszaszamlalo: egy tickenkent csokkentett szam a szerver
   * lepteteseben felhalmozott hibaval csuszna el.
   */
  private startedAt = 0;

  /** A meccs fazisa -- a lobby listajahoz. */
  get matchPhase(): MatchPhase {
    return this.phase;
  }

  matchSnapshot(now: number): MatchSnapshot {
    return {
      phase: this.phase,
      mode: this.mode,
      survivors: survivorsOf([...this.players.values()]).length,
      winnerId: this.winnerId,
      timeLeftMs: this.timeLeftMs(now),
      restartInMs:
        this.phase === "ended" ? Math.max(0, Math.round(this.restartAt - now)) : 0,
    };
  }

  /**
   * Mennyi van hatra a meccsbol (ms); 0, ha a mod nem idore megy.
   *
   * A meccs ELOTT is a teljes hosszt mutatja, nem nullat: a jatekos igy
   * mar a varakozasban latja, mekkora meccs kovetkezik.
   */
  private timeLeftMs(now: number): number {
    if (!isTimed(this.mode)) return 0;
    const hossz = GAME_MODES[this.mode].hosszMs;
    if (this.phase !== "playing") return hossz;
    return Math.max(0, Math.round(hossz - (now - this.startedAt)));
  }

  /**
   * A meccs-allapotgep egy lepese.
   *
   * Harom atmenet van:
   *   waiting -> playing : osszejott a letszam
   *   playing -> ended   : legfeljebb egy jatekos maradt talpon
   *   ended   -> playing : lejart a visszaszamlalas (uj meccs)
   *
   * A `waiting` fazisban SZANDEKOSAN lehet vezetni es lőni: igy a
   * korabban erkezo jatekos nem egy ures kepernyot bamul, csak az
   * eletei nem fogynak.
   */
  stepMatch(now: number): void {
    const players = [...this.players.values()];

    if (this.phase === "waiting") {
      if (canStart(players.length)) this.startMatch(now);
      return;
    }

    if (this.phase === "playing") {
      // Ha annyian kilepnek, hogy egyedul maradunk, a meccsnek nincs
      // ertelme tovabb -- de gyoztest sem hirdetunk ilyenkor
      // (visszaesunk varakozasba).
      if (!canStart(players.length)) {
        this.phase = "waiting";
        this.winnerId = null;
        console.log(`[room ${this.code}] keves jatekos -- a meccs varakozik`);
        return;
      }
      // KET vegfeltetel, modonkent MAS. Az idore meno modban a
      // tulelés-szabaly nem ervenyes (ott korlatlan az ujraszuletes,
      // tehat sosem fogyna el a mezony), az idokorlat viszont igen.
      if (isTimed(this.mode)) {
        if (isTimeUp(this.mode, now - this.startedAt)) this.endMatch(now, players);
        return;
      }
      if (isMatchOver(players)) this.endMatch(now, players);
      return;
    }

    if (this.phase === "ended" && now >= this.restartAt) {
      if (canStart(players.length)) this.startMatch(now);
      else {
        this.phase = "waiting";
        this.winnerId = null;
      }
    }
  }

  private startMatch(now: number): void {
    for (const player of this.players.values()) {
      player.lives = LIVES_PER_PLAYER;
      // UJ MECCS, UJ EREDMENY: kulonben a deathmatch elso pillanatatol
      // az elozo meccs allasa latszana az eredmenyjelzon.
      player.kills = 0;
      player.lastAttacker = null;
      // A meccs kezdetekor MINDENKI AZONNAL jatekban van, a kiesettek is
      // (kulonben nezok maradnanak az uj meccsben is).
      this.respawnNow(player, now);
    }
    this.phase = "playing";
    this.winnerId = null;
    this.restartAt = 0;
    this.startedAt = now;
    // A kilovés-listat is uritjuk: a meccs elotti szabad vezetes
    // esemenyei nem az uj meccshez tartoznak.
    this.killFeed = [];
    console.log(
      `[room ${this.code}] MECCS INDUL -- ${GAME_MODES[this.mode].nev} ` +
        `(${this.players.size} jatekos)`,
    );
  }

  /**
   * A meccs lezarasa -- a GYOZTES modonkent mas kerdesre valasz.
   *
   * Tulelés-modban az utolso talpon marado (winnerOf), idore meno
   * modban a legtobb kilovest szerzo (killLeader). Mindketto adhat
   * dontetlent, es mindkettonel ugyanaz a jelentese: nincs egyertelmu
   * gyoztes.
   */
  private endMatch(now: number, players: ServerPlayer[]): void {
    const winner = isTimed(this.mode)
      ? killLeader(players.map((p) => ({ id: p.id, kills: p.kills })))
      : winnerOf(players);
    this.phase = "ended";
    this.winnerId = winner?.id ?? null;
    this.startedAt = 0;
    this.restartAt = now + MATCH_RESTART_DELAY_MS;
    console.log(
      `[room ${this.code}] MECCS VEGE (${GAME_MODES[this.mode].nev}) -- ` +
        (winner ? `gyoztes: ${winner.id.slice(0, 8)}` : "dontetlen"),
    );
  }

  /**
   * Kerek-regeneralodas HARCON KIVUL.
   *
   * A serules igy nem vegleges egy eleten belul: aki kiszall es kibirja
   * sebzes nelkul, visszakapja a kerekeit. A szabalyt (utem, kuszob) a
   * shared regenerateWheel tartalmazza -- itt csak az dol el, KINEK jar.
   *
   * A megsemmisult jatekos kimarad: neki ugyis uj autoja lesz.
   */
  /**
   * A FOLYAMATOS GYOGYULAS lepese.
   *
   * KET forras tolti a `healLeft`-et, es mindketto ugyanezen a lepesen
   * megy at: a gyogyito kepesseg (useAbility) es a palyan felvett elet
   * (collectPickups). Azonnali gyogyitassal barmelyik egy "mentogomb"
   * lenne -- a halalos loves elott elsutve semmisse tenne az addigi
   * sebzest. Igy viszont a tamado ki tudja lonni a gyogyulot.
   *
   * Egy utem, egy fuggveny: ha a ketto kulon szamolna, eloBb-utobb
   * elcsusznanak egymastol.
   */
  stepHealing(dt: number, now: number): void {
    for (const player of this.players.values()) {
      if (player.healLeft <= 0) continue;
      // HALALKOR abbamarad: a gyogyulas nem folytatodik a halal utan.
      if (player.deadSince !== null) {
        player.healLeft = 0;
        player.healAcc = 0;
        continue;
      }
      // TELI eletnel megall. A maradek elvesz -- de a jelzes (healing)
      // is elalszik vele, kulonben az auto tovabb villogna zolden ugy,
      // hogy kozben mar semmi nem tortenik.
      if (player.hp >= MAX_HP) {
        player.healLeft = 0;
        player.healAcc = 0;
        continue;
      }

      const adhato = Math.min(player.healLeft, healPerMs() * dt * 1000);
      player.healLeft -= adhato;
      player.healAcc += adhato;

      // Csak EGESZ eleteket adunk at: a HP egesz szam, a HUD is azt
      // mutatja. A tort resz a kovetkezo tickig var.
      const egesz = Math.floor(player.healAcc);
      if (egesz > 0) {
        player.healAcc -= egesz;
        player.hp = Math.min(MAX_HP, player.hp + egesz);
      }
      void now;
    }
  }

  stepWheelRepair(dt: number, now: number): void {
    for (const player of this.players.values()) {
      if (player.deadSince !== null) continue;
      if (now - player.lastDamagedAt < WHEEL_REGEN_DELAY_MS) continue;

      for (let i = 0; i < player.wheels.length; i++) {
        player.wheels[i] = regenerateWheel(player.wheels[i], dt * 1000);
      }
    }
  }

  /**
   * Lejart varakozasu jatekosok ujraszuletese.
   *
   * A szerver nem tudja "athelyezni" a kliens autojat -- a hibrid
   * modellben a kliens birtokolja a sajat mozgasat --, ezert MEGKERI ra
   * egy `respawn` uzenettel, es a sajat oldalan is odaallitja az
   * allapotot. Igy a ket oldal nem csuszik szet, es a kliens kovetkezo
   * allapota mar a spawn-pontrol jon (amit a plauzibilitas-ellenorzes
   * ervenyesnek fogad el).
   */
  respawnExpired(now: number): void {
    for (const player of this.players.values()) {
      if (player.deadSince === null) continue;

      // KIESETT jatekos nem szuletik ujra: nezokent van jelen, amig a
      // meccs le nem zarul. (A `deadSince` szandekosan marad beallitva,
      // igy a kliensek tovabbra is elrejtik az autojat, es a szerver
      // sem vesz at tole allapotot.)
      if (player.lives <= 0 && this.phase === "playing") continue;

      if (now - player.deadSince < RESPAWN_DELAY_MS) continue;

      this.respawnNow(player, now);
    }
  }

  /**
   * Azonnali ujraszuletes: uj spawn-pont, teli HP, ep kerekek.
   *
   * Kozos a lejart varakozas utani ujraszuleteshez ES a meccs
   * indulasahoz. Eloszor a meccs-indulasnal csak `deadSince = now`-t
   * allitottam ("majd ujraszuletnek"), de attol MINDENKI halott volt az
   * elso ot masodpercben: nem sebzodtek, es a kliensek elrejtettek az
   * autojukat. A meccs kezdetekor azonnal jatekban kell lenni.
   */
  private respawnNow(player: ServerPlayer, now: number): void {
    const spawn = this.allocateSpawn(player);
    player.spawnIndex = spawn.index;
    player.state = spawn.state;
    player.hp = MAX_HP;
    // Rovid serthetetlenseg. Nem kenyelmi funkcio: az arenaban nincs
    // biztonsagos spawn-pont (mind lotavon belul van), tehat enelkul a
    // frissen szuletett jatekos vedtelen -- es itt minden halal egy
    // ELETBE kerul, nem csak bosszusag.
    player.protectedUntil = now + SPAWN_PROTECTION_MS;
    player.pendingSpawnIndex = null;
    player.deathPosition = null;
    player.spawnChosenManually = false;
    player.planKey = "";
    // Uj auto, uj esely: a kerekek is javulnak.
    player.wheels = healthyWheels();
    // ...es a kepesseg is kesz all. A visszatoltes az ELETHEZ tartozik,
    // nem viszi at magaval a halal.
    player.abilityState = idleAbility();
    player.healLeft = 0;
    player.healAcc = 0;
    player.lastDamagedAt = 0;
    player.deadSince = null;
    // Uj auto, hideg cso: a halal elotti melegedes ne kovesse at.
    player.mg = idleMachinegun();
    // A regi helyekre mar ne lehessen visszatekerve talalni: az
    // ujraszuletes nagy ugras, es a kozbeeso "utvonal" nem letezett.
    player.history = [];
    // Az ujraszuletes nagy ugras: ne szamitson teleportnak a kovetkezo
    // ellenorzesnel sem, es a hutes se hozza magaval a regi parokat.
    player.consecutiveRejects = 0;

    player.send({ type: "respawn", position: spawn.state.position });
    console.log(
      `[room ${this.code}] ${player.id.slice(0, 8)} ujraszuletett (spawn ${spawn.index})`,
    );
  }

  /**
   * Egy robbanas hatasa a jatekos NEGY KEREKERE, kulon-kulon.
   *
   * Miert kerekenkent, es nem egyetlen tavolsaggal az auto
   * kozeppontjatol: az auto 4.9 m hosszu, a robbanas hatosugara 7 m --
   * az orr elott felrobbano rakéta igy az elso kerekeket viszi le, a
   * hatsokat alig karositja. Ez lathato es taktikailag ertelmes
   * kulonbseg; kozeppontbol szamolva mind a negy kerek egyszerre tornek
   * le, ami a jatekosnak veletlenszerunek tunne.
   */
  private damageWheelsFrom(
    position: readonly number[],
    player: ServerPlayer,
    now: number,
  ): void {
    for (let i = 0; i < player.wheels.length; i++) {
      if (player.wheels[i].broken) continue;

      const wheel = wheelWorldPosition(
        player.state.position,
        player.state.rotation,
        i,
        // A SAJAT autojanak kerekhelye: modellenkent mas.
        player.car,
      );
      const distance = Math.hypot(
        wheel[0] - position[0],
        wheel[1] - position[1],
        wheel[2] - position[2],
      );

      const amount = wheelExplosionDamage(distance);
      if (amount <= 0) continue;

      const before = player.wheels[i];
      player.wheels[i] = damageWheel(before, amount);
      // A KEREK-sebzes is sebzes: enelkul egy olyan robbanas, ami csak a
      // kerekeket erte (a karosszeriat mar nem), nem inditana ujra a
      // regeneralodas orajat -- a jatekos tuz alatt gyogyulna.
      player.lastDamagedAt = now;
      if (!before.broken && player.wheels[i].broken) {
        console.log(
          `[room ${this.code}] ${player.id.slice(0, 8)} ${i}. kereke letort`,
        );
      }
    }
  }

  /** El-e a jatekos (a kliens allapot-frissiteseinek szureshez). */
  isAlive(id: string): boolean {
    const player = this.players.get(id);
    return player !== undefined && player.deadSince === null;
  }

  // --- Rakétak (terv 4. lepcso 3. pont) ---

  readonly rockets = new RocketSimulation();

  /**
   * Kiloves-keres feldolgozasa.
   *
   * A szerver ellenorzi a FEGYVERT, a hutest es azt, hogy a jatekos el
   * -- a kliens sem az iranyt, sem a poziciot nem adhatja meg (lasd
   * FireMessage).
   */
  tryFire(id: string, target: [number, number, number], now: number): boolean {
    const player = this.players.get(id);
    if (!player || player.deadSince !== null) return false;
    // A RAKETA az AGYU fegyvere, es a jatekos egyszerre egyet valaszt.
    //
    // E nelkul az ellenorzes nelkul egy modositott kliens gepfegyverrel
    // csatlakozhatott (folyamatos, szerver-utemezett hitscan), es
    // KOZBEN raketat is lohetett, mert a `fire` uzenetnek nem volt
    // fegyver-feltetele. A ket fegyver kozotti valasztas igy nem
    // valasztas volt, hanem a becsuletes jatekos hatranya.
    if (player.weapon !== "cannon") return false;
    if (now - player.lastFiredAt < ROCKET_COOLDOWN_MS) return false;
    // Hibas celpont (NaN, vegtelen) ne jusson a szimulacioba.
    if (!target.every((v) => Number.isFinite(v))) return false;

    const rocket = this.rockets.spawn(id, player.state, target, now, player.car);
    if (!rocket) return false;

    player.lastFiredAt = now;
    // Aki lo, az mar nem menekul, hanem harcol.
    player.protectedUntil = 0;
    return true;
  }

  /**
   * Rakétak leptetese, es a robbanasok kiertekelese.
   *
   * A sebzest ITT alkalmazzuk (a szerver dolga), a LOKEST viszont a
   * kliensek szamoljak a sajat autojukra -- ezert megy ki minden
   * robbanas esemenykent is.
   */
  stepRockets(dt: number, now: number): void {
    const targets = [...this.players.values()]
      .filter((p) => p.deadSince === null)
      .map((p) => ({ id: p.id, state: p.state, car: p.car }));

    for (const explosion of this.rockets.step(dt, now, targets)) {
      for (const player of this.players.values()) {
        if (player.deadSince !== null) continue;
        if (this.isProtected(player, now)) continue;
        // A KEREKEK kulon sebzodnek, kerekenkenti tavolsag szerint
        // (terv 4.6). Ezt a body-sebzes ELOTT vegezzuk el, hogy a
        // megsemmisulessel egy tickben letort kerek is bekeruljon az
        // utolso snapshotba -- kulonben a roncs ep kerekekkel allna meg.
        this.damageWheelsFrom(explosion.position, player, now);

        const damage = explosionDamageFor(explosion, player.id, player.state);
        if (damage <= 0) continue;

        player.hp = Math.max(0, player.hp - damage);
        player.lastDamagedAt = now;
        this.creditAttacker(player, explosion.ownerId, "cannon", now);
        console.log(
          `[room ${this.code}] robbanas: ${player.id.slice(0, 8)} -${damage} HP (${player.hp})`,
        );
        this.markDeadIfDestroyed(player, now);
      }

      this.broadcast({
        type: "explosion",
        position: explosion.position,
        ownerId: explosion.ownerId,
      });
    }
  }

  // --- Gepfegyver (azonnali talalat) ---

  /** A legutobbi snapshot ota leadott lovesek -- latvanyhoz. */
  private tracers: TracerSnapshot[] = [];

  /** A nyomjelzok atadasa a snapshotnak; utana torlodnek. */
  drainTracers(): TracerSnapshot[] {
    if (this.tracers.length === 0) return [];
    const out = this.tracers;
    this.tracers = [];
    return out;
  }

  /**
   * Fegyvervaltas.
   *
   * CSAK akkor engedjuk, ha a jatekos eppen nem el, vagy a meccs meg el
   * sem kezdodott. Igy a valasztasnak tetje van: harc kozben nem lehet
   * atvaltani arra, ami eppen jobban jonne.
   *
   * @returns sikerult-e
   */
  /**
   * Kepesseg-valasztas -- ugyanaz a szabaly, mint a fegyvernel.
   *
   * Elve nem valthato: menekules kozben nem lehet atvaltani arra, ami
   * eppen jobban jonne.
   */
  setAbility(id: string, ability: AbilityId): boolean {
    const player = this.players.get(id);
    if (!player) return false;
    const allowed = player.deadSince !== null || this.phase !== "playing";
    if (!allowed) return false;

    player.ability = toAbilityId(ability);
    // UJ kepesseg, tiszta lap: a regi visszatoltese ne oroklodjon at.
    player.abilityState = idleAbility();
    return true;
  }

  /**
   * A kepesseg elsutese. A szerver dont, nem a kliens.
   *
   * @returns sikerult-e (a hivo ebbol tudja, kell-e visszajelzes)
   */
  useAbility(id: string, now: number): boolean {
    const player = this.players.get(id);
    if (!player) return false;
    // HALOTTAN nem: a kepesseg az eletben tart, nem feltamaszt.
    //
    // A MECCS FAZISAT viszont SZANDEKOSAN nem nezzuk. Eloszor csak
    // "playing" alatt engedtem, es a jatekos egyedul probalva azt latta,
    // hogy a Q egyszeruen nem csinal semmit -- magyarazat nelkul, mert
    // a meccs ket jatekos nelkul el sem indul. A meccs elotti hasznalat
    // amugy is kovetkezmeny nelkuli: ott senki nem sebez senkit, es az
    // indulaskor mindenki ujraszuletik, ami a visszatoltest is nullazza.
    if (player.deadSince !== null) return false;

    const uj = activateAbility(player.ability, player.abilityState, now);
    if (!uj) return false;
    player.abilityState = uj;

    // A GYOGYITAS nem azonnal tortenik, hanem az idotartama alatt
    // fokozatosan (lasd stepHealing). Itt csak a "meg ennyi jar"
    // szamot allitjuk be.
    if (player.ability === "heal") {
      player.healLeft = ABILITIES.heal.heal;
      player.healAcc = 0;
    }
    return true;
  }

  setWeapon(id: string, weapon: WeaponId): boolean {
    const player = this.players.get(id);
    if (!player) return false;
    const allowed = player.deadSince !== null || this.phase !== "playing";
    if (!allowed) return false;

    player.weapon = toWeaponId(weapon);
    player.mg = idleMachinegun();
    return true;
  }

  /**
   * A kliens visszajelzese arrol, melyik snapshotot dolgozta fel.
   *
   * Ebbol tudjuk, mennyire regi vilagot lat -- lasd stepWeapons.
   */
  noteAck(id: string, tick: number): void {
    const player = this.players.get(id);
    if (!player || !Number.isFinite(tick)) return;
    // Csak elorefele: egy kesve erkezo csomag ne huzza vissza.
    if (player.ackTick === null || tick > player.ackTick) {
      player.ackTick = tick;
    }
  }

  /**
   * A szerver altal MERT kesés feljegyzese (ms).
   *
   * A meres a szallitasi retegben tortenik (lasd wsServer), mert ott van
   * a kapcsolat; a szoba csak tarolja es hasznalja -- igy a
   * visszatekeres headless tesztelheto marad.
   */
  noteRtt(id: string, rttMs: number): void {
    const player = this.players.get(id);
    if (!player || !Number.isFinite(rttMs) || rttMs < 0) return;
    player.rttSamples.push(rttMs);
    while (player.rttSamples.length > RTT_SAMPLES) player.rttSamples.shift();
  }

  /**
   * Pozicio-elozmeny rogzitese -- minden tickben, minden jatekosra.
   *
   * Ez az alapja a visszatekeresnek: ide jegyezzuk fel, mit HITT a
   * szerver a jatekosok helyerol az egyes idopontokban. Pontosan ezt
   * latta a tobbi kliens is, hiszen a snapshotok ebbol epultek.
   */
  recordPoses(now: number): void {
    for (const player of this.players.values()) {
      player.history.push({
        t: now,
        position: player.state.position,
        rotation: player.state.rotation,
      });
      while (
        player.history.length > 1 &&
        now - player.history[0].t > HISTORY_MS
      ) {
        player.history.shift();
      }
    }
  }

  /**
   * Hol volt a jatekos a megadott idopontban?
   *
   * A ket szomszedos minta kozott LINEARISAN interpolalunk. A
   * legkozelebbi minta onmagaban nem lenne eleg: 60 Hz-es mintavetel
   * mellett 30 m/s-nal ez fel meter hibat jelentene, ami egy 2.2 m
   * szeles autonal mar szamit.
   *
   * A forgast a kesobbi mintabol vesszuk: 16 ms alatt a kocsi
   * legfeljebb kb. 2.5 fokot fordul, ami a talalat szempontjabol nem
   * merheto -- egy quaternion-interpolacio itt felesleges bonyolitas.
   */
  private poseAt(
    player: ServerPlayer,
    time: number,
  ): { position: readonly number[]; rotation: readonly number[] } {
    const history = player.history;
    if (history.length === 0) {
      return { position: player.state.position, rotation: player.state.rotation };
    }
    if (time >= history[history.length - 1].t) {
      const last = history[history.length - 1];
      return { position: last.position, rotation: last.rotation };
    }
    if (time <= history[0].t) {
      return { position: history[0].position, rotation: history[0].rotation };
    }

    for (let i = history.length - 1; i > 0; i--) {
      const later = history[i];
      const earlier = history[i - 1];
      if (earlier.t <= time && time <= later.t) {
        const span = later.t - earlier.t;
        const k = span > 0 ? (time - earlier.t) / span : 0;
        return {
          position: [
            earlier.position[0] + (later.position[0] - earlier.position[0]) * k,
            earlier.position[1] + (later.position[1] - earlier.position[1]) * k,
            earlier.position[2] + (later.position[2] - earlier.position[2]) * k,
          ],
          rotation: later.rotation,
        };
      }
    }
    return { position: history[0].position, rotation: history[0].rotation };
  }

  /**
   * Mennyivel latja a jatekos a multat (ms)?
   *
   * Ket resze van: a halozati ut, es az interpolacios kesleltetes,
   * amivel a kliens szandekosan a jelen mogott rendereli a tobbieket.
   *
   * A halozati utat KET forrasbol vesszuk, es a SZUKEBBET hasznaljuk:
   *
   *  - amit a kliens vall be (`ackTick`): melyik snapshotot dolgozta
   *    fel utoljara. Ez a pontosabb szam -- de a kliens kuldi.
   *  - amit a szerver MER (`rttSamples`): a valodi oda-vissza ut.
   *
   * A ketto normalis esetben egyutt mozog. Aki viszont szandekosan REGI
   * tickre hivatkozik ("lag switch"), annal a bevallott keses elszalad
   * a mert mellol, es a jatekos a MAX_REWIND_MS-ig, 400 ms-mal korabbi
   * celpontokra lohetne -- oda, ahol a masik mar nem tud kiterni. A
   * vagas ezt zarja le: legfeljebb annyit tekerunk vissza, amennyi
   * keses tenyleg van.
   *
   * Ha meg NINCS meres (a kapcsolat elso masodperce), a bevallott
   * ertek marad. Szuk ablak, es a szigorubb valasztas -- a nulla
   * visszatekeres -- ott melle-loveseket okozna a becsuletes jatekosnak
   * is, eppen csatlakozas utan.
   */
  private rewindMsFor(player: ServerPlayer, tick: number): number {
    const staleTicks =
      player.ackTick === null ? 0 : Math.max(0, tick - player.ackTick);
    let networkMs = staleTicks * FIXED_DT * 1000;

    if (player.rttSamples.length > 0) {
      const measured = Math.max(...player.rttSamples);
      networkMs = Math.min(networkMs, measured + RTT_TOLERANCE_MS);
    }

    return Math.min(MAX_REWIND_MS, networkMs + INTERP_DELAY_MS);
  }

  /**
   * Gepfegyver-tuzeles: hoszint, tuzgyorsasag, talalat, sebzes.
   *
   * A raketaval ellentetben itt NINCS kulon kiloves-uzenet: a kliens az
   * amugy is atmeno allapotaban jelzi, hogy nyomva tartja a gombot
   * (ClientState.firing), a lovesek utemet pedig a szerver adja. Igy 11
   * loves/mp mellett sem keletkezik uzenet-aradat, es a tuzgyorsasagot
   * sem a kliens szabja meg.
   */
  stepWeapons(dt: number, now: number, tick: number): void {
    const dtMs = dt * 1000;
    const alive = [...this.players.values()].filter(
      (p) => p.deadSince === null,
    );

    for (const player of this.players.values()) {
      if (player.weapon !== "machinegun") {
        // Agyunal nincs hoszint. Ha valaki visszavalt gepfegyverre, ne
        // orokolje a korabbi melegedest.
        if (player.mg.heat !== 0) player.mg = idleMachinegun();
        continue;
      }

      const wantsToFire = player.deadSince === null && player.state.firing;
      const result = stepMachinegun(player.mg, wantsToFire, now, dtMs);
      player.mg = result.state;
      if (result.shots === 0) continue;
      // Aki lo, az mar nem menekul, hanem harcol.
      player.protectedUntil = 0;

      // A jatekos oda lo, ahol a tobbieket LATJA -- tehat a multban.
      const viewTime = now - this.rewindMsFor(player, tick);
      const targets = alive
        .filter((p) => p.id !== player.id)
        .map((p) => ({ id: p.id, car: p.car, ...this.poseAt(p, viewTime) }));

      const direction = aimDirection(
        player.state.aimYaw,
        player.state.aimPitch,
      );
      // A loves a CSOBOL indul, nem az auto kozeppontjabol. Korabban
      // az utobbi volt, es a nyomjelzo lathatoan a lokharito magassagabol
      // jott -- nem a tetőn ülő fegyverbol.
      const origin = muzzleWorldPosition(
        player.state.position,
        player.state.rotation,
        direction,
        "machinegun",
        undefined,
        // A TETEJEN ul a fegyver: magasabb autonal magasabban van a
        // csotorkolat is.
        player.car,
      );

      for (let i = 0; i < result.shots; i++) {
        const spread = applySpread(
          direction,
          MACHINEGUN.spreadRad,
          Math.random(),
          Math.random(),
        );
        const shot = resolveHitscan(origin, spread, targets, player.id);

        this.tracers.push({
          ownerId: player.id,
          from: shot.from,
          to: shot.to,
          hit: shot.hitId !== null,
        });

        if (shot.hitId === null) continue;
        const victim = this.players.get(shot.hitId);
        if (!victim || victim.deadSince !== null) continue;
        // A nyomjelzo SZANDEKOSAN talalatnak latszik: geometriailag az
        // is volt. Hogy miert nem fogy a HP, azt az attetszo auto
        // mutatja meg -- lasd PlayerSnapshot.protected.
        if (this.isProtected(victim, now)) continue;

        victim.hp = Math.max(0, victim.hp - MACHINEGUN.damage);
        victim.lastDamagedAt = now;
        this.creditAttacker(victim, player.id, "machinegun", now);
        this.markDeadIfDestroyed(victim, now);
      }
    }
  }

  /**
   * A snapshot MINDEN jatekost tartalmaz, a cimzettet is -- a kliens
   * sajat magat szuri ki. Igy egyetlen kozos uzenet mehet mindenkinek,
   * nem kell jatekosonkent kulon osszeallitani.
   */
  buildSnapshot(now: number): PlayerSnapshot[] {
    const snapshot: PlayerSnapshot[] = [];
    for (const player of this.players.values()) {
      snapshot.push({
        id: player.id,
        name: player.name,
        position: player.state.position,
        rotation: player.state.rotation,
        velocity: player.state.velocity,
        steer: player.state.steer,
        susp: player.state.susp,
        grip: gripsOf(player.wheels),
        brokenMask: brokenMaskOf(player.wheels),
        aimYaw: player.state.aimYaw,
        aimPitch: player.state.aimPitch,
        hp: player.hp,
        boostGrants: player.boostGrants,
        lives: player.lives,
        weapon: player.weapon,
        kills: player.kills,
        ability: player.ability,
        abilityActive: abilityActive(player.abilityState, now),
        abilityCooldownMs: abilityCooldownLeft(player.abilityState, now),
        abilityActiveMs: abilityActiveLeft(player.abilityState, now),
        // A GYOGYULAS forrasa kozombos (kepesseg vagy felvett elet): a
        // kliens azt rajzolja ki, hogy tolti-e vissza az eletet.
        healing: player.healLeft > 0,
        heat: player.mg.heat,
        overheated: player.mg.overheated,
        protected: this.isProtected(player, now),
        car: player.car,
        skin: player.skin,
      });
    }
    return snapshot;
  }

  /**
   * Serthetetlen-e eppen a jatekos.
   *
   * Egy helyen definialva, mert MINDEN sebzes-utvonalnak ugyanazt kell
   * kerdeznie -- utkozes, robbanas, gepfegyver. Ha az egyik kimaradna,
   * a vedelem csendben lyukas lenne.
   */
  private isProtected(player: ServerPlayer, now: number): boolean {
    // A PAJZS ugyanezen a kapun jon be -- igy egyetlen sebzes-utvonal
    // sem maradhat ki belole.
    //
    // KULON MEZOBEN, nem a protectedUntil-ban: a spawn-vedelmet a sajat
    // loves torli ("aki lo, az mar nem menekul"). A pajzs viszont eppen
    // azert van, hogy MOGOTTE lehessen harcolni -- kozos mezovel az
    // elso sajat loves oltana ki.
    if (player.ability === "shield" && abilityActive(player.abilityState, now)) {
      return true;
    }
    return now < player.protectedUntil;
  }

  /**
   * Azok a spawn-pontok, amiket MAS jatekos nem foglal.
   *
   * Az elo jatekos a sajat pontjat foglalja, a halott pedig a
   * TERVEZETTET -- kulonben ketten ugyanoda szuletnenek, ami pont
   * annak a bajnak a sulyosbitasa lenne, amit meg akarunk oldani.
   *
   * A pontok kezzel vannak megadva (lasd SPAWN_POINTS a config.ts-ben);
   * egy szamitott kor nem mukodne, mert az akadalyok nem szimmetrikusak.
   */
  private freeSpawnIndices(self: ServerPlayer | null): number[] {
    const taken = new Set<number>();
    for (const player of this.players.values()) {
      if (player === self) continue;
      taken.add(
        player.deadSince === null
          ? player.spawnIndex
          : (player.pendingSpawnIndex ?? player.spawnIndex),
      );
    }
    const free = SPAWN_POINTS.map((_, i) => i).filter((i) => !taken.has(i));
    // Nyolc jatekosnal elfogyhatnak; ilyenkor inkabb utkozzon a
    // valasztas, mint hogy ne legyen hova szuletni.
    return free.length > 0 ? free : SPAWN_POINTS.map((_, i) => i);
  }

  /** Az ELO ellenfelek, a valasztas szamara: hol vannak, merre celoznak. */
  private threatsAgainst(self: ServerPlayer | null): SpawnThreat[] {
    const threats: SpawnThreat[] = [];
    for (const player of this.players.values()) {
      if (player === self || player.deadSince !== null) continue;
      threats.push({
        position: player.state.position,
        aimYaw: player.state.aimYaw,
        aimPitch: player.state.aimPitch,
      });
    }
    return threats;
  }

  /**
   * A halott jatekosok ujraszuletesi tervenek karbantartasa.
   *
   * Minden tickben fut, mert a harc mozog: egy 5 masodperccel korabban
   * biztonsagos pont kozben halalossa valhat. A csere viszont csak
   * ERDEMI romlasnal tortenik (shouldRepickSpawn) -- kulonben a
   * jatekos egy villogo, kiszamithatatlan elonezetet latna.
   */
  updateRespawnPlans(): void {
    for (const player of this.players.values()) {
      if (player.deadSince === null) continue;
      // Kiesett jatekos nem szuletik ujra: neki nincs mit tervezni.
      if (player.lives <= 0 && this.phase === "playing") continue;
      this.planRespawn(player);
    }
  }

  private planRespawn(player: ServerPlayer): void {
    const free = this.freeSpawnIndices(player);
    const current = player.pendingSpawnIndex;
    const currentValid = current !== null && free.includes(current);

    // A KEZI valasztas all. Ha kozben mas foglalta el a pontot, viszont
    // vissza kell venni az ajanlast -- kulonben a jatekos egy olyan
    // helyre keszulne, ahova nem kerulhet.
    if (player.spawnChosenManually) {
      if (currentValid) {
        this.sendRespawnPlan(player);
        return;
      }
      player.spawnChosenManually = false;
    }

    const threats = this.threatsAgainst(player);
    const safetyOf = (index: number): number =>
      spawnSafety(SPAWN_POINTS[index], threats, player.deathPosition);

    if (currentValid) {
      const best = Math.max(...free.map(safetyOf));
      if (!shouldRepickSpawn(safetyOf(current), best)) {
        this.sendRespawnPlan(player);
        return;
      }
    }

    player.pendingSpawnIndex = pickSpawnIndex(free, threats, player.deathPosition);
    this.sendRespawnPlan(player);
  }

  /**
   * A jatekos SAJAT valasztasa arrol, hova szulessen ujja.
   *
   * Opcionalis: aki nem valaszt, azt az ajanlat viszi. A szerver
   * ellenorzi, hogy egyaltalan varakozik-e, es hogy a pont szabad-e --
   * a kliens barmit kuldhet.
   */
  chooseSpawn(id: string, index: number): void {
    const player = this.players.get(id);
    if (!player || player.deadSince === null) return;
    if (!Number.isInteger(index)) return;
    if (index < 0 || index >= SPAWN_POINTS.length) return;
    if (!this.freeSpawnIndices(player).includes(index)) return;

    player.pendingSpawnIndex = index;
    player.spawnChosenManually = true;
    this.sendRespawnPlan(player);
  }

  /**
   * A terv kikuldese -- CSAK az erintettnek, es csak ha valtozott.
   *
   * A snapshot mindenkihez eljut, tehat abban nem mehet: az ellenfel
   * megtudna, hova varjon (lasd RespawnPlanMessage).
   */
  private sendRespawnPlan(player: ServerPlayer): void {
    const index = player.pendingSpawnIndex;
    if (index === null) return;

    const options = this.freeSpawnIndices(player);
    const key = `${index}|${options.join(",")}`;
    if (key === player.planKey) return;
    player.planKey = key;

    const point = SPAWN_POINTS[index];
    player.send({
      type: "respawnPlan",
      position: [point.x, point.y, point.z],
      index,
      options,
    });
  }

  /**
   * A jatekos ujraszuletesi helye -- lehetoleg a mar megtervezett.
   *
   * A tervet azert tartjuk meg, mert a jatekos a halal-kepernyon MAR
   * AZT NEZTE: oda vitte a kamerat, es a kornyeket felmerte. Mashova
   * ejteni pont azt a felkeszulest dobna el, amiert az egesz keszult.
   */
  private allocateSpawn(self: ServerPlayer | null): { index: number; state: ClientState } {
    const free = this.freeSpawnIndices(self);
    // Belepeskor (self = null) meg nincs terv -- de a valasztas ilyenkor
    // is nezi az ellenfeleket: senki ne csatlakozzon egy celkeresztbe.
    const planned = self?.pendingSpawnIndex ?? null;
    const index =
      planned !== null && free.includes(planned)
        ? planned
        : pickSpawnIndex(free, this.threatsAgainst(self), self?.deathPosition ?? null);

    const point = SPAWN_POINTS[index];
    return {
      index,
      state: { ...ORIGIN_STATE, position: [point.x, point.y, point.z] },
    };
  }
}
