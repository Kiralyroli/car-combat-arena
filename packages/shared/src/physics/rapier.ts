import RAPIER from "@dimforge/rapier3d-compat";
import {
  ARENA,
  CHASSIS,
  DRIVE,
  GRAVITY,
  RECOVERY,
  STABILIZATION,
  WHEEL,
  WHEEL_LAYOUT,
} from "../config";
import { clamp, cross, dot, eulerToQuat, length, lerp, rotateVec } from "../math";
import { wheelRadiusFor } from "../wheelVisuals";
import {
  HEALTHY_WHEEL,
  type DriveInput,
  type Telemetry,
  type Transform,
  type VehicleBackend,
  type WheelDamage,
  type WheelReadout,
} from "../types";

/** A felfuggesztes iranya a chassis lokalis rendszereben (lefele). */
const SUSPENSION_DIR = { x: 0, y: -1, z: 0 };
/** A kerek tengelye a chassis lokalis rendszereben. */
const AXLE = { x: -1, y: 0, z: 0 };

/**
 * A Rapier DynamicRayCastVehicleController belsoleg a chassis lokalis
 * +Z tengelyet tekinti "elorenek" (currentVehicleSpeed elojele es az
 * engineForce hatasa is ehhez kepest ertelmezett), FUGGETLENUL attol,
 * hogy mi hova helyezzuk a kerekeket. A projekt orr-konvencioja viszont
 * -Z (lasd config.ts) -- ezert kell itt elojelet valtani minden olyan
 * helyen, ahol "az orr fele" iranyt szeretnenk kifejezni.
 */
const FORWARD_SIGN = -1;

/**
 * Milyen erosen huzza vissza a tavoli autot a hiteles halozati
 * poziciojara (1/s). Magasabb = feszesebb kovetes, de utkozeskor
 * merevebb (kevesbe engedi meg a rovid, latvanyos elmozdulast).
 */
const REMOTE_BODY_CORRECTION_RATE = 8;

/**
 * Ekkora poziciohiba felett (m) a tavoli testet ATHELYEZZUK, nem
 * sebesseggel korrigaljuk. Ez kell a letrehozashoz (a test kulonben az
 * origobol indulna es "odarepulne"), ujraszuletesnel, es akkor is, ha
 * egy hosszabb csomagkieses utan nagyot kell ugrani.
 */
const REMOTE_BODY_SNAP_DISTANCE = 12;

/**
 * Utkozes utan ennyi ideig (ms) NEM huzzuk vissza a tavoli autot a
 * halozati poziciojara.
 *
 * Enelkul a lokalisan kiszamolt lokes lathato, de azonnal vissza is
 * szivodik: meresben a becsapodaskor 0.64 m-t mozdult az auto, majd a
 * korrekcio 550 ms alatt visszahuzta 0.12 m-re -- epp mire a halozati
 * pozicio vegre kovetni kezdte. A jatekos ezt "megugrik, aztan megis
 * csak kesobb mozdul" erzetkent latja. A tartas alatt csak a halozati
 * SEBESSEG hat (elorecsatolas), poziciohiba-korrekcio nem, igy a lokes
 * megmarad addig, amig a hiteles allapot be nem eri.
 *
 * Az ertek nagysagrendje: oda-vissza ut + snapshot-utem + interpolacios
 * puffer. Bougyan halozaton ennel tobb is lehet; a tartas vege utan a
 * korrekcio fokozatosan (BLEND) ter vissza, tehat a tulzas nem ugrik.
 */
const REMOTE_COLLISION_HOLD_MS = 600;

/**
 * Egy erintkezes-sorozat alatt legfeljebb ennyi ideig (ms) tartjuk a
 * joslatot -- akkor is, ha az utkozes folytatodik.
 *
 * Enelkul a tartas vegtelen: ha a jatekos NEKITAMASZKODIK a masik
 * autonak, minden lepesben uj utkozest eszlelunk, a tartas ujraindul,
 * es a test SOHA nem all vissza a hiteles pozicioba. Meresben igy 5 m-es
 * tartos elteres alakult ki, es a ket auto egymasba csuszott.
 */
const REMOTE_COLLISION_MAX_HOLD_MS = 1000;

/** A tartas utan ennyi ido alatt (ms) er vissza a korrekcio a teljes erejere. */
const REMOTE_COLLISION_BLEND_MS = 400;

/**
 * A tartas alatt a lokalis joslat legfeljebb ennyivel (m) terhet el a
 * hiteles poziciotol.
 *
 * Korlat nelkul a joslat elszalad: ha a jatekos folyamatosan tolja a
 * masik autot, a lokalisan szamolt test messzebb kerul, mint amennyit a
 * halozat visszaigazol. Meresben 575 ms alatt 4.5 m-re nott az elteres,
 * ami atlepte az athelyezesi kuszobot, es a kocsi 3.8 m-t UGROTT vissza
 * -- ez sokkal zavarobb, mint az eredeti problema. Ezzel a korlattal a
 * lokes azonnal lathato, de az elteres nem nohet ellenorizhetetlenul.
 *
 * Az ertek NEM lehet szoros: egy 80 km/h-s becsapodas a valosagban is
 * tobb metert lok a masik autoon, es a joslatnak EZT kell megmutatnia.
 * 1.5 m-rel probalva a lokes lathatoan elenyeszo maradt (700 ms alatt
 * 0.74 m a tenyleges 9 m-bol).
 *
 * De tul nagy sem lehet: az elteres akkora URES helyet hagy a masik
 * auto hiteles pozicioja korul, ahova a sajat kocsink behajthat. 4 m-rel
 * a ket auto tenylegesen egymasba csuszott. 2.5 m meg lathato lokest ad,
 * de mar nem fer be koze egy auto.
 */
const REMOTE_PREDICTION_MAX_OFFSET = 2.5;

/**
 * Ekkora VIZSZINTES elteres (m) felett tekintjuk ugy, hogy a testet
 * kulso ero (utkozes) mozditotta el, nem a mi sebesseg-vezerlesunk.
 * Csak vizszintesen nezzuk, mert fuggolegesen a gravitacio is elter
 * egy kicsit minden lepesben.
 */
const REMOTE_COLLISION_DEVIATION = 0.02;

/** Egy tavoli auto teste es a lokalis utkozes-joslat allapota. */
interface RemoteBody {
  body: RAPIER.RigidBody;
  /**
   * Hova kerult volna a test PUSZTAN a beallitott sebessegtol. Ha a
   * fizikai lepes utan ettol erdemben eltert, kulso ero (utkozes) erte.
   */
  expected: { x: number; z: number } | null;
  /** Eddig az idopontig (performance.now) tartjuk a lokalis joslatot. */
  holdUntil: number;
  /** Mikor kezdodott a mostani erintkezes-sorozat (performance.now). */
  holdStartedAt: number;
}

/**
 * Utkozesi csoportok (memberships << 16 | filter).
 *
 * A tavoli autok testenek CSAK a sajat autonkkal szabad utkoznie:
 *  - Az arenaval nem, mert dinamikus testkent beleakadna a ladakba/
 *    rampaba. Meresben tenylegesen beragadt egy lada mogott, mikozben a
 *    latvany (a halozati poziciora rajzolt auto) tovabbment -- onnantol
 *    egy lathatatlan testtel lehetett volna utkozni.
 *  - Egymassal sem, mert ket tavoli auto utkozeset MINDKETTO sajat
 *    kliense mar kiszamolta; itt csak zavart okozna.
 */
const GROUP_ARENA = 0x0001;
const GROUP_LOCAL = 0x0002;
const GROUP_REMOTE = 0x0004;

const COLLISION_ARENA = (GROUP_ARENA << 16) | GROUP_LOCAL;
const COLLISION_LOCAL = (GROUP_LOCAL << 16) | (GROUP_ARENA | GROUP_REMOTE);
const COLLISION_REMOTE = (GROUP_REMOTE << 16) | GROUP_LOCAL;

export class RapierBackend implements VehicleBackend {
  readonly name = "Rapier";
  readonly version = "0.20.0 (rapier3d-compat)";

  private world!: RAPIER.World;
  private chassis!: RAPIER.RigidBody;
  private controller!: RAPIER.DynamicRayCastVehicleController;

  /** Tavoli jatekosok testei es a hozzajuk tartozo jóslat-allapot. */
  private remoteBodies = new Map<string, RemoteBody>();

  private damage: WheelDamage[] = WHEEL_LAYOUT.map(() => ({ ...HEALTHY_WHEEL }));
  private stepMsAvg = 0;
  private stepsLastFrame = 0;
  /** Mennyi ideje van folyamatosan a felegyenesedesi kuszob felett (mp), vagy null. */
  private tiltedSince: number | null = null;

  async init(): Promise<void> {
    await RAPIER.init();

    this.world = new RAPIER.World(GRAVITY);
    // Fix lepeskoz -- lasd projekt-terv 15.3.
    this.world.timestep = 1 / 60;

    this.buildArena();
    this.buildVehicle();
  }

  private buildArena(): void {
    for (const box of ARENA) {
      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
        box.position.x,
        box.position.y,
        box.position.z,
      );
      if (box.rotation) {
        const q = eulerToQuat(box.rotation.x, box.rotation.y, box.rotation.z);
        bodyDesc.setRotation(q);
      }
      const body = this.world.createRigidBody(bodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.cuboid(
        box.halfExtents.x,
        box.halfExtents.y,
        box.halfExtents.z,
      )
        .setFriction(1.0)
        .setCollisionGroups(COLLISION_ARENA);
      this.world.createCollider(colliderDesc, body);
    }
  }

  private buildVehicle(): void {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(CHASSIS.spawn.x, CHASSIS.spawn.y, CHASSIS.spawn.z)
      .setLinearDamping(CHASSIS.linearDamping)
      .setAngularDamping(CHASSIS.angularDamping)
      // Az auto ne aludjon el allo helyzetben, kulonben nem indul ujra.
      .setCanSleep(false);
    // A karosszeria szabadon dolhet/bukdacsolhat (nincs tengelyzaras) --
    // ez kell a realisztikus erzethez es a kerek-serules lathato
    // dolesehez. A borulas ellen a steerFalloff (lasd config.ts) es a
    // mertekletes sideFrictionStiffness ad vedelmet szelsoseges,
    // tartos, teljes kormanyos kanyaroknal.
    this.chassis = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      CHASSIS.halfExtents.x,
      CHASSIS.halfExtents.y,
      CHASSIS.halfExtents.z,
    )
      .setMass(CHASSIS.mass)
      .setFriction(0.4)
      .setRestitution(0.1)
      .setCollisionGroups(COLLISION_LOCAL);
    this.world.createCollider(colliderDesc, this.chassis);

    this.controller = this.world.createVehicleController(this.chassis);
    this.controller.indexUpAxis = 1;
    // FIGYELEM: a rapier3d tipusdefinicioban a forward tengely settere
    // "setIndexForwardAxis" nevu SETTER (nem metodus) -- ezert ertekadas.
    this.controller.setIndexForwardAxis = 2;

    for (const layout of WHEEL_LAYOUT) {
      this.controller.addWheel(
        layout.position,
        SUSPENSION_DIR,
        AXLE,
        WHEEL.suspensionRestLength,
        WHEEL.radius,
      );
    }

    for (let i = 0; i < WHEEL_LAYOUT.length; i++) {
      this.applyWheelTuning(i);
    }
  }

  /**
   * A kerek parametereinek beallitasa a serules-allapot alapjan.
   *
   * Ez a spike egyik fo kerdese: minden itt hasznalt setter FUTASIDOBEN,
   * KEREKENKENT hivhato -- ez teszi lehetove a per-kerek serulest sajat
   * jarmu-fizika irasa nelkul.
   */
  private applyWheelTuning(i: number): void {
    const d = this.damage[i];
    const c = this.controller;
    const grip = d.broken ? 0 : d.gripMultiplier;
    // Tengelyenkenti (elso/hatso) tapadas-szorzo -- lasd config.ts.
    const axleGrip = WHEEL_LAYOUT[i].steered
      ? WHEEL.frontGripMultiplier
      : WHEEL.rearGripMultiplier;

    c.setWheelFrictionSlip(
      i,
      Math.max(0.08, WHEEL.frictionSlip * grip * axleGrip),
    );
    c.setWheelSideFrictionStiffness(
      i,
      Math.max(0.02, WHEEL.sideFrictionStiffness * grip * axleGrip),
    );
    c.setWheelSuspensionCompression(i, WHEEL.suspensionCompression);
    c.setWheelSuspensionRelaxation(i, WHEEL.suspensionRelaxation);
    c.setWheelMaxSuspensionTravel(i, WHEEL.maxSuspensionTravel);
    c.setWheelSuspensionRestLength(i, WHEEL.suspensionRestLength);

    if (d.broken) {
      // Nincs felfuggesztesi ero -> az auto ledol erre a sarokra.
      c.setWheelSuspensionStiffness(i, 0);
      c.setWheelMaxSuspensionForce(i, 0);
    } else {
      // Serult (de nem tort) kereknel a rugo is gyengul kicsit.
      c.setWheelSuspensionStiffness(
        i,
        WHEEL.suspensionStiffness * lerp(0.6, 1, d.gripMultiplier),
      );
      c.setWheelMaxSuspensionForce(i, WHEEL.maxSuspensionForce);
    }
    // A sugar szabalya kozos a rendereléssel (sajat ES tavoli auto) --
    // lasd wheelVisuals.ts.
    c.setWheelRadius(i, wheelRadiusFor(d));
  }

  setWheelDamage(index: number, damage: WheelDamage): void {
    if (index < 0 || index >= WHEEL_LAYOUT.length) return;
    this.damage[index] = damage;
    this.applyWheelTuning(index);
  }

  step(dt: number, input: DriveInput): void {
    const t0 = performance.now();

    // A debug-panel csuszkai kozvetlenul a config objektumokat
    // mutaljak -- ezert minden lepesben ujra kell alkalmazni a
    // kerek- es karosszeria-parametereket, kulonben csak a kovetkezo
    // serules-valtozaskor ervenyesulnenek. Olcso (4 kerek, nehany
    // setter hivas + 2 chassis setter), nem szamit a teljesitmenyben.
    for (let i = 0; i < WHEEL_LAYOUT.length; i++) this.applyWheelTuning(i);
    this.chassis.setAngularDamping(CHASSIS.angularDamping);
    this.chassis.setLinearDamping(CHASSIS.linearDamping);

    const speed = this.speedMs();
    // Pozitiv = az orr fele halad (lasd FORWARD_SIGN).
    const forwardSpeed = this.controller.currentVehicleSpeed() * FORWARD_SIGN;

    // --- Kanyar kozbeni hajtoero-korlatozas (friction circle) ---
    // Valodi gumiabroncsnak veges a tapadasi "koltsegvetese": minel
    // tobbet hasznal belole oldalirányu (kanyar-) eronek, annal
    // kevesebb marad hosszanti (gyorsitasi) eronek. Enelkul a sebesseg
    // gazzal kanyarban is szabadon novekedhetett, ami eltero (nagyobb)
    // kanyarsugarat eredmenyezett gazzal, mint gaz nelkul -- ez volt a
    // zavaro "hirtelen befordul, ha elveszem a gazt" erzet oka. A
    // hajtoero most a kormanyzas mertekevel aranyosan csokken.
    // Ha mindket kormanyzott (elso) kerek torott, a kormanyzas fizikailag
    // amugy sem hat (steerAngle nullazva ott lejjebb) -- ilyenkor a
    // hajtoero-korlatozas felesleges dupla buntetes lenne a mar amugy is
    // egyenesbe kenyszeritett autonak.
    const steeredWheelsHealthy = WHEEL_LAYOUT.some(
      (w, i) => w.steered && !this.damage[i].broken,
    );
    // Alacsony sebessegnel (pl. induraskor) meg nincs valodi tapadasi
    // konfliktus -- a korlatozas csak corneringPowerRampSpeed felett
    // fut fel fokozatosan a teljes mertekere.
    const speedRamp = clamp(speed / DRIVE.corneringPowerRampSpeed, 0, 1);
    const corneringDemand = steeredWheelsHealthy
      ? Math.abs(input.steer) * speedRamp
      : 0;
    const enginePowerScale = lerp(1, DRIVE.corneringPowerMin, corneringDemand);

    // --- Hajtoero es fek ---
    // engineMagnitude: pozitiv = az orr fele tolja.
    let engineMagnitude = 0;
    let brakeForce = 0;

    if (input.throttle > 0) {
      if (forwardSpeed < -0.5) {
        brakeForce = DRIVE.brakeForce;
      } else {
        engineMagnitude =
          DRIVE.engineForce *
          (input.boost ? DRIVE.boostMultiplier : 1) *
          enginePowerScale;
      }
    } else if (input.throttle < 0) {
      if (forwardSpeed > 0.5) {
        brakeForce = DRIVE.brakeForce;
      } else {
        engineMagnitude =
          -DRIVE.engineForce * DRIVE.reverseFactor * enginePowerScale;
      }
    } else {
      // Motorfek
      brakeForce = DRIVE.brakeForce * 0.06;
    }

    // Vissza a controller nyers (chassis +Z) tengelyere.
    const engineForce = engineMagnitude * FORWARD_SIGN;

    // --- Kormanyzas sebessegfuggo csillapitassal ---
    const falloff = lerp(
      1,
      DRIVE.steerFalloffMin,
      clamp(speed / DRIVE.steerFalloffSpeed, 0, 1),
    );
    // FORWARD_SIGN: a kormanyzott kerekek most a -Z (orr) oldalon vannak,
    // ami a forgatonyomatek elojelet is megforditja a raycast vehicle
    // controllerben -- enelkul a "jobbra" input a vilag -X iranyaba
    // forditana a kocsit, ami a kamera nezeteben screen-balra esne.
    const steerAngle = FORWARD_SIGN * input.steer * DRIVE.maxSteer * falloff;

    for (let i = 0; i < WHEEL_LAYOUT.length; i++) {
      const layout = WHEEL_LAYOUT[i];
      const broken = this.damage[i].broken;

      // Tort kerek nem hajt es nem kormanyoz.
      this.controller.setWheelEngineForce(
        i,
        layout.driven && !broken ? engineForce : 0,
      );
      this.controller.setWheelSteering(
        i,
        layout.steered && !broken ? steerAngle : 0,
      );

      let brake = brakeForce;
      if (input.handbrake) {
        brake = layout.driven ? DRIVE.handbrakeForce : DRIVE.brakeForce * 0.5;
      }
      this.controller.setWheelBrake(i, broken ? 0 : brake);
    }

    const tiltAngle = this.applySelfRighting(dt);

    this.controller.updateVehicle(dt);

    // A tavoli testeknel feljegyezzuk, hova kerulnenek PUSZTAN a
    // beallitott sebessegtol -- a lepes utan ebbol derul ki, hogy erte-e
    // oket kulso ero (azaz nekunk mentek, vagy mi nekik).
    for (const entry of this.remoteBodies.values()) {
      const p = entry.body.translation();
      const v = entry.body.linvel();
      entry.expected = { x: p.x + v.x * dt, z: p.z + v.z * dt };
    }

    this.world.step();
    this.detectRemoteCollisions();

    let wheelsOnGround = 0;
    for (let i = 0; i < WHEEL_LAYOUT.length; i++) {
      if (this.controller.wheelIsInContact(i)) wheelsOnGround++;
    }

    const skipAbove = (STABILIZATION.skipAboveDeg * Math.PI) / 180;
    if (tiltAngle < skipAbove) {
      this.applyPitchRollStabilization();
      // Levegoben (egy kerek sincs a talajon) a kanyarsugar-asszisztens
      // kikapcsol -- kormanyzassal amugy sem lehetne forgatni a kocsit,
      // ha egyik kerek sem er talajt, ez csak reala kene juttatna.
      if (wheelsOnGround > 0) {
        // A haladasi irany igazitasa (applyVelocityAlignment) az
        // applyTurnRadiusAssist BELSEJEBOL fut, ugyanazon feltetelek
        // mellett (steer/sebesseg-kuszob) -- lasd ott a dokumentaciot.
        // ELOJELES sebesseg: tolatasnal negativ (lasd ott).
        this.applyTurnRadiusAssist(dt, forwardSpeed, input.steer);
      }
    }

    const elapsed = performance.now() - t0;
    this.stepMsAvg = this.stepMsAvg * 0.9 + elapsed * 0.1;
    this.stepsLastFrame++;
  }

  private speedMs(): number {
    const v = this.chassis.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  /**
   * Onfelegyenesites: ha az auto oldalra dolt vagy fejre allt, egy
   * fokozatosan erosodo forgatonyomatek mindig visszaforgatja a
   * kerekeire, ahelyett hogy stabilan megallna az oldalan/tetejen.
   *
   * Kuszobbol indul (RECOVERY.startAngleDeg), hogy a normal
   * vezetesi dolest (kanyar, kerek-serules) ne erintse -- azok
   * jellemzoen jokkal a kuszob alatt maradnak.
   */
  /** @returns az aktualis dolesszog (radian) -- lasd applyPitchRollStabilization. */
  private applySelfRighting(dt: number): number {
    const q = this.chassis.rotation();
    const localUpWorld = rotateVec(q, { x: 0, y: 1, z: 0 });
    const worldUp = { x: 0, y: 1, z: 0 };

    const cosTilt = clamp(dot(localUpWorld, worldUp), -1, 1);
    const tiltAngle = Math.acos(cosTilt);

    const startAngle = (RECOVERY.startAngleDeg * Math.PI) / 180;
    if (tiltAngle <= startAngle) {
      this.tiltedSince = null;
      return tiltAngle;
    }

    // Idobeli eszkalacio: minel tovabb ragad a dolesszog a kuszob
    // felett (pl. egy nagy, stabil lapjan pihen, ahol a kontaktus-
    // szolver ellenall a gyenge korrekcionak), annal erosebb nyomatek
    // hat -- igy MINDIG van eleg ero a vegso kitoreshez.
    this.tiltedSince = (this.tiltedSince ?? 0) + dt;
    const escalation = lerp(
      1,
      RECOVERY.escalationMax,
      clamp(this.tiltedSince / RECOVERY.escalationTime, 0, 1),
    );

    const maxSeverityAngle = (RECOVERY.maxSeverityAngleDeg * Math.PI) / 180;
    const severity = clamp(
      (tiltAngle - startAngle) / (maxSeverityAngle - startAngle),
      0,
      1,
    );

    let axis = cross(localUpWorld, worldUp);
    const axisLen = length(axis);
    if (axisLen < 1e-3) {
      // Kozel pontosan fejen all (instabil egyensuly) -- a termeszetes
      // korrekcios irany majdnem nulla hosszu, rogzitett tengellyel
      // inditjuk el a forgast.
      axis = RECOVERY.fallbackAxis;
    } else {
      axis = { x: axis.x / axisLen, y: axis.y / axisLen, z: axis.z / axisLen };
    }

    const torqueMag = RECOVERY.torque * severity * escalation;
    this.chassis.applyTorqueImpulse(
      {
        x: axis.x * torqueMag * dt,
        y: axis.y * torqueMag * dt,
        z: axis.z * torqueMag * dt,
      },
      true,
    );

    // Mertekletes extra csillapitas, hogy a konnyen mozdithato
    // esetekben (pl. sik talajrol fejre allitva) ne lendüljön at a
    // celon -- a nagy, stabil lapjan pihenő esetnel ugyis a kontaktus-
    // szolver adja a domans ellenallast, ott ez alig szamit.
    const av = this.chassis.angvel();
    this.chassis.setAngvel(
      {
        x: av.x * RECOVERY.angularDampingDuringRecovery,
        y: av.y * RECOVERY.angularDampingDuringRecovery,
        z: av.z * RECOVERY.angularDampingDuringRecovery,
      },
      true,
    );
    return tiltAngle;
  }

  /**
   * Extra csillapitas a bukdacsolas (X) es dontes (Z) tengelyeken,
   * FUGGETLENUL a kanyarodastol (Y) -- lasd STABILIZATION.pitchRollDamping
   * dokumentacioja config.ts-ben. Csak akkor hat, ha a doles jokkal a
   * felegyenesedesi kuszob (RECOVERY.startAngleDeg) ALATT van -- egy
   * biztonsagi savval (STABILIZATION.skipAboveDeg), kulonben pontosan
   * a kuszobon atlepve elfojtana a felegyenesedeshez meg szukseges
   * lenduletet, es az auto elakadna a kuszob kozeleben.
   */
  private applyPitchRollStabilization(): void {
    const av = this.chassis.angvel();
    this.chassis.setAngvel(
      {
        x: av.x * STABILIZATION.pitchRollDamping,
        y: av.y,
        z: av.z * STABILIZATION.pitchRollDamping,
      },
      true,
    );
  }

  /**
   * Kozvetlen, sebessegtol fuggetlen kanyarsugar-celzas -- lasd
   * DRIVE.targetTurnRadius dokumentacioja config.ts-ben. A valos
   * gumitapadas-alapu kanyarodas fizikailag korlatozott nagy
   * sebessegnel (v^2/r); ez a mechanizmus felulirja azt egy kozvetlen
   * celzott szogsebesseggel, hogy a kanyarsugar kb. allando maradjon
   * barmilyen sebessegnel.
   *
   * A cel-szogsebesseget SIMITVA kozelitjuk meg (nem egyszeri
   * impulzussal), hogy ne lokjön/rango be a kormanyzas kezdetekor --
   * ugyanaz a mintazat, mint az onfelegyenesedesnel korabban bevalt.
   */
  private applyTurnRadiusAssist(
    dt: number,
    forwardSpeed: number,
    steerInput: number,
  ): void {
    if (Math.abs(steerInput) < 0.01) return;
    // Alacsony sebessegnel (pl. inditaskor) kikapcsol, ne fojtsa el a
    // termeszetes, gumitapadas-alapu forgast -- lasd config.ts.
    if (Math.abs(forwardSpeed) < DRIVE.turnRadiusMinSpeed) return;

    // FONTOS: ELOJELES haladasi sebesseg, nem a sebesseg nagysaga.
    // Tolatasnal negativ, igy a celzott forgas iranya magatol
    // megfordul -- ahogy egy valodi autonal is (hatramenetben ugyanaz a
    // kormanyallas az ellenkezo iranyba forgatja a kocsit). Elojel
    // nelkul az asszisztens tolatas kozben a ROSSZ iranyba eroltette a
    // forgast, es a termeszetes fizika ellen dolgozva lefekezte az
    // autot: meresben 42.6 km/h helyett csak 9.3 km/h maradt.
    //
    // FORWARD_SIGN: ugyanaz az elojel-logika, mint a kormanyszognel
    // (lasd fent) -- igy a celzott forgas a tenyleges kormanyzas
    // iranyaba mutat, nem ellene.
    const targetYawRate =
      (FORWARD_SIGN * steerInput * forwardSpeed) / DRIVE.targetTurnRadius;

    const av = this.chassis.angvel();

    // Az asszisztens CSAK HOZZAADHAT forgast, elvenni nem.
    //
    // A feladata az volt, hogy NAGY sebessegnel megszoritsa a kanyart,
    // ahol a gumitapadas fizikailag korlatoz (v^2/r). Alacsony
    // sebessegen -- es kulonosen TOLATASNAL -- a termeszetes fordulas
    // amugy is elesebb a celzottnal (meresben 1.11 vs 0.83 rad/s), ott
    // tehat csak visszafogna, mikozben az iranyigazitas a gumik ellen
    // dolgozna: a tolatas + kormanyzas igy 19.4 km/h helyett 10.6-ra
    // esett vissza. Ez volt a "beakadas".
    if (
      Math.sign(targetYawRate) === Math.sign(av.y) &&
      Math.abs(av.y) >= Math.abs(targetYawRate)
    ) {
      return;
    }

    const blend = clamp(DRIVE.turnRadiusBlendRate * dt, 0, 1);
    const newYawRate = lerp(av.y, targetYawRate, blend);
    this.chassis.setAngvel({ x: av.x, y: newYawRate, z: av.z }, true);

    this.applyVelocityAlignment(dt, steerInput, forwardSpeed);
  }

  /**
   * A fenti szogsebesseg-celzas CSAK a karosszeria FORGASAT allitja be
   * -- a linearis lendulet (a kocsi tenyleges HALADASI iranya) magatol
   * nem kovetne ezt gyorsan, mert ahhoz valodi oldalirányu gumitapadasi
   * ero kellene. Enelkul nagy sebessegnel/eles kormanynal az orr gyorsan
   * az uj irany fele fordul, de a kocsi meg a REGI iranyba csuszik tovabb
   * -- ez "keresztbe csuszasnak" tunt eles kanyarban. Itt a linearis
   * sebesseg-vektor iranyat SIMITVA az orr vilagkoordinata-iranyahoz
   * igazitjuk (a nagysagat valtozatlanul hagyva), hogy a mozgas iranya
   * kovesse a kanyarodast.
   *
   * KIPROBALVA, DE ELVETVE: a tomegkozeppont helyett a HATSO TENGELY
   * sebesseget igazitani (merevtest-kinematikaval visszaszamolva a
   * tomegkozeppontra) fizikailag pontosabb lenne (a fordulas a hatso
   * tengely korul pivotalna, nem a karosszeria kozepen -- ez adna a
   * valodi "elso kerekek huznak be" erzetet). A gyakorlatban viszont
   * MEG KIS (0.3-0.5 kozotti) reszleges hatso-eltolassal is kaotikusan
   * instabil volt: a rakenyszeritett oldalirányu tomegkozeppont-sebesseg
   * tulzott csuszast okoz az ELSO kerekeknel, amit a Rapier sajat
   * gumitapadas-modellje (DynamicRayCastVehicleController) minden
   * lepesben ellensulyozni probal -- ez a ket rendszer egymassal
   * "harcolva" energiat pumpal a rendszerbe. A legrosszabb resz: a
   * stabilitasi hatar KESNYES volt -- pusztan 5 extra fizikai lepes
   * (0.08 mp tobblet kanyarodas) egy addig stabilnak tuno beallitast
   * hirtelen osszeomlasba vitt. Ez jatszhato jatekban (valtozo
   * kormanyzasi idotartammal) elfogadhatatlanul kiszamithatatlan lenne.
   * A "kerekek forditsak be, ne a test" erzetet ezert INKABB a valodi
   * gumitapadas-fizikan keresztul erjuk el -- lasd WHEEL.frontGripMultiplier
   * / rearGripMultiplier config.ts-ben -- ami nem kenyszerit semmit,
   * csak a mar amugy is stabil Rapier-szimulaciot allitja arrebb.
   */
  private applyVelocityAlignment(
    dt: number,
    steerInput: number,
    forwardSpeed: number,
  ): void {
    if (Math.abs(steerInput) < 0.01) return;

    const lv = this.chassis.linvel();
    const horizSpeedSq = lv.x * lv.x + lv.z * lv.z;
    if (horizSpeedSq < 0.25) return;
    const horizSpeed = Math.sqrt(horizSpeedSq);

    // A HALADAS iranya, nem feltetlenul az orre: tolatasnal a kocsi a
    // farka fele megy. Enelkul az igazitas tolatas kozben 180 fokkal
    // vissza akarna forditani a mozgast, tehat kozvetlenul a tolatas
    // ellen dolgozna -- ez okozta a "beakadast".
    const travelSign = forwardSpeed < 0 ? -1 : 1;
    const nose = rotateVec(this.chassis.rotation(), { x: 0, y: 0, z: -1 });
    const noseLen = Math.hypot(nose.x, nose.z) || 1;
    const noseX = (nose.x / noseLen) * travelSign;
    const noseZ = (nose.z / noseLen) * travelSign;

    const dirX = lv.x / horizSpeed;
    const dirZ = lv.z / horizSpeed;

    const blend = clamp(DRIVE.velocityAlignRate * dt, 0, 1);
    const newDirX = lerp(dirX, noseX, blend);
    const newDirZ = lerp(dirZ, noseZ, blend);
    const newLen = Math.hypot(newDirX, newDirZ) || 1;

    this.chassis.setLinvel(
      {
        x: (newDirX / newLen) * horizSpeed,
        y: lv.y,
        z: (newDirZ / newLen) * horizSpeed,
      },
      true,
    );
  }

  getChassis(): Transform {
    const p = this.chassis.translation();
    const q = this.chassis.rotation();
    return {
      position: [p.x, p.y, p.z],
      quaternion: [q.x, q.y, q.z, q.w],
    };
  }

  getVelocity(): [number, number, number] {
    const v = this.chassis.linvel();
    return [v.x, v.y, v.z];
  }

  getWheels(): WheelReadout[] {
    const chassisQuat = this.chassis.rotation();
    const dirWorld = rotateVec(chassisQuat, SUSPENSION_DIR);
    const out: WheelReadout[] = [];

    for (let i = 0; i < WHEEL_LAYOUT.length; i++) {
      const hardPoint = this.controller.wheelHardPoint(i);
      const suspLen = this.controller.wheelSuspensionLength(i) ?? 0;
      const steering = this.controller.wheelSteering(i) ?? 0;
      // FORWARD_SIGN: a Rapier a wheelRotation-t is a chassis nyers
      // (+Z) "elore" tengelyehez kepest konyveli el, nem a mi -Z orr-
      // konvenciunkhoz -- enelkul a kerekek vizualisan hatrafele
      // pergnek forditva, holott az auto elorehalad.
      const roll = FORWARD_SIGN * (this.controller.wheelRotation(i) ?? 0);
      const radius = this.controller.wheelRadius(i) ?? WHEEL.radius;

      // A kerek kozeppontja: a raycast kiindulopontjabol a felfuggesztes
      // iranyaba, a rugo aktualis hossza szerint.
      const cx = (hardPoint?.x ?? 0) + dirWorld.x * suspLen;
      const cy = (hardPoint?.y ?? 0) + dirWorld.y * suspLen;
      const cz = (hardPoint?.z ?? 0) + dirWorld.z * suspLen;

      // chassis * kormanyszog(Y) * gordules(tengely)
      const qSteer = quatAxisAngle(0, 1, 0, steering);
      const qRoll = quatAxisAngle(AXLE.x, AXLE.y, AXLE.z, roll);
      const q = quatMul(quatMul(toQ(chassisQuat), qSteer), qRoll);

      out.push({
        id: WHEEL_LAYOUT[i].id,
        position: [cx, cy, cz],
        quaternion: [q.x, q.y, q.z, q.w],
        inContact: this.controller.wheelIsInContact(i),
        suspensionLength: suspLen,
        steering,
        radius,
        damage: this.damage[i],
      });
    }
    return out;
  }

  getTelemetry(): Telemetry {
    let onGround = 0;
    for (let i = 0; i < WHEEL_LAYOUT.length; i++) {
      if (this.controller.wheelIsInContact(i)) onGround++;
    }
    const t: Telemetry = {
      speedKmh: this.speedMs() * 3.6,
      wheelsOnGround: onGround,
      stepMs: this.stepMsAvg,
      stepsLastFrame: this.stepsLastFrame,
    };
    this.stepsLastFrame = 0;
    return t;
  }

  /**
   * Tavoli jatekos autojanak teste a mi vilagunkban.
   *
   * DINAMIKUS test, aminek a SEBESSEGET vezereljuk a halozatrol (lasd
   * updateRemoteBody) -- nem kinematikus.
   *
   * Miert nem kinematikus? Azzal kezdtuk, es nem mukodott: kinematikus
   * testet semmi nem tud elmozditani, tehat MINDKET kliens vilagaban a
   * MASIK auto elmozdithatatlan fal. Igy mindket auto megall, mielott
   * egymasba erne (a sajat vilagaban blokkolja a masik "fala"), tehat
   * egyik sem hatol bele a masikba -- es lokes sem keletkezik. Meresben
   * 75 km/h-s becsapodas is csak 0.24 m elmozdulast okozott. A terv
   * viszont alapmechanikakent irja le a kilokest (3. fejezet).
   *
   * Dinamikus testtel a szolver valodi impulzust szamol mindket testre:
   * a MI autonk megkapja a rendes lokest. A tavoli test a sajat
   * lendületét a kovetkezo lepesben ugyis visszakapja a halozatrol,
   * tehat az o mozgasa tovabbra is a tulajdonosanal dol el (terv 15.4).
   */
  addRemoteBody(id: string): void {
    if (this.remoteBodies.has(id)) return;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      // Ne aludjon el: a halozati frissitest ebren kell fogadnia.
      .setCanSleep(false)
      // A sebesseget minden lepesben mi diktaljuk, igy a csillapitas
      // csak zavarna.
      .setLinearDamping(0)
      .setAngularDamping(0);
    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      CHASSIS.halfExtents.x,
      CHASSIS.halfExtents.y,
      CHASSIS.halfExtents.z,
    )
      // Ugyanaz a tomeg, mint a sajat autonknak -- igy az utkozes
      // lendulet-atadasa realis aranyu.
      .setMass(CHASSIS.mass)
      .setFriction(0.4)
      .setRestitution(0.1)
      .setCollisionGroups(COLLISION_REMOTE);
    this.world.createCollider(colliderDesc, body);

    this.remoteBodies.set(id, {
      body,
      expected: null,
      holdUntil: 0,
      holdStartedAt: 0,
    });
  }

  getRemoteBody(id: string): Transform | null {
    const entry = this.remoteBodies.get(id);
    if (!entry) return null;
    const p = entry.body.translation();
    const q = entry.body.rotation();
    return {
      position: [p.x, p.y, p.z],
      quaternion: [q.x, q.y, q.z, q.w],
    };
  }

  removeRemoteBody(id: string): void {
    const entry = this.remoteBodies.get(id);
    if (!entry) return;
    // A collidereket a Rapier a testtel egyutt takaritja.
    this.world.removeRigidBody(entry.body);
    this.remoteBodies.delete(id);
  }

  /**
   * A tavoli test rakotese a halozati allapotra.
   *
   * A SEBESSEGET allitjuk be, nem a poziciot -- ez a kulonbseg lenyege:
   * a szolver igy egy valodi tomegu, valodi sebesseggel mozgo testet
   * lat, es rendes utkozesi impulzust szamol a mi autonkra. Ha a
   * poziciot irnank felul, a test "teleportalna", es vagy atcsuszna
   * rajtunk, vagy megmagyarazhatatlanul kilokne.
   *
   * A halozati sebesseg melle egy poziciohiba-aranyos tag is kerul: ez
   * huzza vissza a testet a hiteles helyere, ha egy utkozes elsodorta,
   * vagy ha a csomagok kesnek. Mivel a korrekcio SEBESSEGEN keresztul
   * hat (nem teleportalassal), nem harcol a szolverrel -- ez a projekt
   * korabbi tanulsaga a kanyar-asszisztensbol (lasd EREDMENYEK.md).
   */
  updateRemoteBody(
    id: string,
    position: [number, number, number],
    quaternion: [number, number, number, number],
    velocity: [number, number, number],
  ): void {
    const entry = this.remoteBodies.get(id);
    if (!entry) return;
    const body = entry.body;

    const current = body.translation();
    const dx = position[0] - current.x;
    const dy = position[1] - current.y;
    const dz = position[2] - current.z;

    if (Math.hypot(dx, dy, dz) > REMOTE_BODY_SNAP_DISTANCE) {
      // Tul nagy a kulonbseg ahhoz, hogy sebesseggel hozzuk be: ilyenkor
      // athelyezzuk. Enelkul a test a letrehozasa utan az origobol
      // indulva "atrepulne" a palyan -- utkozve mindennel utkozben.
      body.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
      body.setLinvel({ x: velocity[0], y: velocity[1], z: velocity[2] }, true);
      entry.holdUntil = 0;
    } else {
      const scale = this.correctionScale(entry);

      // FUGGOLEGESEN mindig mi vezerlunk. A tavoli test szandekosan nem
      // utkozik az arenaval (lasd COLLISION_REMOTE), tehat ha elengednenk,
      // a gravitacio egyszeruen atejtene a talajon.
      const vy = velocity[1] + dy * REMOTE_BODY_CORRECTION_RATE;

      if (scale >= 1) {
        // Nincs friss utkozes: teljes kovetes.
        const k = REMOTE_BODY_CORRECTION_RATE;
        body.setLinvel(
          { x: velocity[0] + dx * k, y: vy, z: velocity[2] + dz * k },
          true,
        );
      } else {
        // Friss utkozes: VIZSZINTESEN hagyjuk elni a fizikat. Ez a
        // lenyeg -- ha itt is rakenyszeritenenk a halozati sebesseget
        // (ami a meg allo autonal ~0), az utkozesi impulzust minden
        // kepkockaban kitorolnenk, es a lokes gyakorlatilag lathatatlan
        // maradna. Csak akkor nyulunk bele, ha a joslat tul messzire
        // szaladt (lasd REMOTE_PREDICTION_MAX_OFFSET), plusz a tartas
        // lejarta utan fokozatosan visszavesszuk az iranyitast.
        const current = body.linvel();
        const error = Math.hypot(dx, dy, dz);
        const excess =
          error > REMOTE_PREDICTION_MAX_OFFSET
            ? (error - REMOTE_PREDICTION_MAX_OFFSET) / error
            : 0;
        const k = REMOTE_BODY_CORRECTION_RATE * Math.max(scale, excess);

        body.setLinvel(
          {
            x: lerp(current.x, velocity[0] + dx * k, Math.max(scale, excess)),
            y: vy,
            z: lerp(current.z, velocity[2] + dz * k, Math.max(scale, excess)),
          },
          true,
        );

        // KIPROBALVA, ELVETVE: a poziciot itt KEMENYEN a megengedett
        // elteresre vetiteni (setTranslation). Elvben garantalna a
        // korlatot, gyakorlatban a szolver ellen dolgozik: a test
        // beleteleportal a sajat autonkba, a szolver nem tudja
        // feloldani (mert a kovetkezo lepesben ujra odarakjuk), es a
        // ket auto EGYMASBAN ragad -- meresben 0.65 m-re kerultek a
        // kozeppontok a jatekos sajat kepernyojen. A puha (sebesseg-
        // alapu) korlatozas kevesbe szoros, de stabil.
      }
    }

    // Az iranyt kozvetlenul vesszuk at: a karosszeria allasa hatarozza
    // meg az utkozesi feluletet, es a sajat forgasanak nincs onallo
    // jelentosege a mi vilagunkban.
    body.setRotation(
      { x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3] },
      true,
    );
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /**
   * 0..1: mennyire hasson most a poziciohiba-korrekcio.
   * 0 = friss utkozes, teljesen a lokalis joslatra hagyatkozunk;
   * 1 = nincs utkozes, teljes korrekcio.
   */
  /**
   * Utkozes-eszleles a tavoli testeken.
   *
   * Nem utkozes-esemenyekre iratkozunk fel, hanem azt nezzuk, hogy a
   * test elmozdult-e mashova, mint amit a beallitott sebessege
   * indokolna. Ez egyszerubb es motorfuggetlen, es pontosan azt meri,
   * ami szamit: erte-e kulso ero a testet. Csak vizszintesen nezzuk,
   * mert fuggolegesen a gravitacio is elter minden lepesben.
   */
  private detectRemoteCollisions(): void {
    for (const entry of this.remoteBodies.values()) {
      if (!entry.expected) continue;
      const p = entry.body.translation();
      const deviation = Math.hypot(
        p.x - entry.expected.x,
        p.z - entry.expected.z,
      );
      if (deviation > REMOTE_COLLISION_DEVIATION) {
        const now = performance.now();
        // Uj erintkezes-sorozat kezdete?
        if (entry.holdUntil === 0) entry.holdStartedAt = now;
        // Tartos nekitamaszkodasnal NEM hosszabbitunk a vegtelensegig --
        // lasd REMOTE_COLLISION_MAX_HOLD_MS.
        if (now - entry.holdStartedAt < REMOTE_COLLISION_MAX_HOLD_MS) {
          entry.holdUntil = now + REMOTE_COLLISION_HOLD_MS;
        }
      }
    }
  }

  private correctionScale(entry: RemoteBody): number {
    if (entry.holdUntil === 0) return 1;
    const sinceHoldEnd = performance.now() - entry.holdUntil;
    if (sinceHoldEnd < 0) return 0;
    if (sinceHoldEnd >= REMOTE_COLLISION_BLEND_MS) {
      entry.holdUntil = 0;
      return 1;
    }
    return sinceHoldEnd / REMOTE_COLLISION_BLEND_MS;
  }

  reset(position?: { x: number; y: number; z: number }): void {
    this.chassis.setTranslation(position ?? CHASSIS.spawn, true);
    this.chassis.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.tiltedSince = null;
  }

  dispose(): void {
    this.world.free();
  }
}

// --- quaternion segedek (csak itt kellenek) ---

type Q = { x: number; y: number; z: number; w: number };

function toQ(q: { x: number; y: number; z: number; w: number }): Q {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

function quatAxisAngle(x: number, y: number, z: number, angle: number): Q {
  const half = angle / 2;
  const s = Math.sin(half);
  return { x: x * s, y: y * s, z: z * s, w: Math.cos(half) };
}

function quatMul(a: Q, b: Q): Q {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
