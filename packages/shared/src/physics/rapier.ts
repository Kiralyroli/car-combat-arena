import RAPIER from "@dimforge/rapier3d-compat";
import {
  ARCADE,
  ARENA,
  type ArenaBox,
  CHASSIS,
  GRAVITY,
  RECOVERY,
  WHEEL,
  WHEEL_LAYOUT,
} from "../config";
import {
  clamp,
  cross,
  dot,
  eulerToQuat,
  length,
  lerp,
  rotateVec,
  type Vec3,
} from "../math";
import { wheelRadiusFor } from "../wheelVisuals";
import { explosionFalloff } from "../rocket";
import { approach, stepArcade, type ArcadeMotion } from "./arcade";
import {
  HEALTHY_WHEEL,
  type DriveInput,
  type Telemetry,
  type Transform,
  type VehicleBackend,
  type WheelDamage,
  type WheelReadout,
} from "../types";

/**
 * Egy kerek talaj-kapcsolata, a sajat raycastunkbol.
 *
 * A regi valtozatban ezt a Rapier jarmu-kontrollere tartotta nyilvan;
 * mivel az arkad modellben nincs jarmu-kontroller, magunk vezetjuk.
 */
interface WheelContact {
  inContact: boolean;
  /** A rugo aktualis hossza (m): 0 = teljesen osszenyomva. */
  suspensionLength: number;
}


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
 * Ez csak az ALAP: a tenyleges tartas ehhez hozzaadja a mert halozati
 * kesleltetest (lasd holdDurationMs). Rogzitett ertek nem mukodne, mert
 * a tartas EPPEN a kesleltetest hivatott athidalni. Meresek szerint az
 * utkozes utan a halozat ennyi ido alatt eri utol az esemenyt:
 *   ping  80 ms ->  458-687 ms
 *   ping 300 ms ->  837-948 ms
 *   ping 530 ms -> 1192-1410 ms
 * Vagyis nagyjabol "ping + 600..880 ms". A 600 ms-os FIX ertek 200 ms-os
 * halozaton mar joval a halozat utolerese elott visszarantotta a
 * kocsit -- ez volt a kesleltetett tesztelés elso valodi talalata.
 * Az alap ezert a felso becslesbol jon.
 */
const REMOTE_COLLISION_HOLD_BASE_MS = 600;

/**
 * Egy erintkezes-sorozat alatt legfeljebb ennyi ideig (ms) tartjuk a
 * joslatot -- akkor is, ha az utkozes folytatodik.
 *
 * Enelkul a tartas vegtelen: ha a jatekos NEKITAMASZKODIK a masik
 * autonak, minden lepesben uj utkozest eszlelunk, a tartas ujraindul,
 * es a test SOHA nem all vissza a hiteles pozicioba. Meresben igy 5 m-es
 * tartos elteres alakult ki, es a ket auto egymasba csuszott.
 *
 * Ez is a tartas fole szamolodik, tehat szinten kesleltetes-fuggo.
 */
const REMOTE_COLLISION_MAX_HOLD_EXTRA_MS = 600;

/**
 * A tartas utan ennyi ido alatt (ms) er vissza a korrekcio a teljes
 * erejere.
 *
 * Nem mindegy, milyen GYORSAN: ha a tartas azelott jar le, hogy a
 * halozat utolerte volna az utkozest, a korrekcio visszahuzza a kocsit,
 * es a jatekos ezt latja "rugozasnak". Hosszabb visszateressel ez a
 * visszahuzas lassu es eszrevehetetlen marad. 400 ms-nal meresben ~0.9 m
 * lathato visszahuzas jelentkezett 100 ms-os halozaton.
 */
const REMOTE_COLLISION_BLEND_MS = 900;

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
  /**
   * Az arkad modell allapota: az auto sajat rendszereben ertelmezett
   * sebessegek. Minden lepesben a TENYLEGES testbol toltjuk ujra, hogy
   * az utkozesek es a robbanasok hatasa benne legyen.
   */
  private motion: ArcadeMotion = { forward: 0, lateral: 0, yawRate: 0 };

  /** Kerekenkenti talaj-kapcsolat a sajat raycastjainkbol. */
  private contacts: WheelContact[] = WHEEL_LAYOUT.map(() => ({
    inContact: false,
    suspensionLength: WHEEL.suspensionRestLength,
  }));

  /**
   * A kerekek elfordulasa (rad) -- KIZAROLAG megjelenites.
   *
   * A kanyarodast a yawRate vegzi, nem a kerekek szoge; ez csak azert
   * kell, hogy a fordulo auto ne nezzen ki hamisan.
   */
  private steerVisual = 0;
  /** A kerekek gordulesi szoge (rad) -- szinten csak megjelenites. */
  private wheelRoll: number[] = WHEEL_LAYOUT.map(() => 0);

  /** Ujrahasznositott sugar a felfuggesztes-raycasthez. */
  private ray!: RAPIER.Ray;

  /** Tavoli jatekosok testei es a hozzajuk tartozo jóslat-allapot. */
  private remoteBodies = new Map<string, RemoteBody>();

  /** Mert halozati oda-vissza ut (ms) -- lasd setNetworkLatency. */
  private networkLatencyMs = 0;

  private damage: WheelDamage[] = WHEEL_LAYOUT.map(() => ({ ...HEALTHY_WHEEL }));
  private stepMsAvg = 0;
  private stepsLastFrame = 0;

  /**
   * @param options.arena Melyik palyat epitse fel. Alapertelmezetten a
   *   teljes ARENA; a vezetes-meresek a BARE_ARENA-t adjak at, mert azok
   *   a fizikat merik, nem a palya elrendezeset.
   */
  async init(options?: { arena?: readonly ArenaBox[] }): Promise<void> {
    await RAPIER.init();

    this.world = new RAPIER.World(GRAVITY);
    // Fix lepeskoz -- lasd projekt-terv 15.3.
    this.world.timestep = 1 / 60;

    this.buildArena(options?.arena ?? ARENA);
    this.buildVehicle();
  }

  private buildArena(boxes: readonly ArenaBox[]): void {
    for (const box of boxes) {
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
    this.chassis = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      CHASSIS.halfExtents.x,
      CHASSIS.halfExtents.y,
      CHASSIS.halfExtents.z,
    )
      .setMass(CHASSIS.mass)
      // ALACSONY surlodas (0.4 -> 0.2). A karosszeria csak akkor er
      // talajt vagy falat, ha a felfuggesztes kifogyott, vagy ha az
      // auto felborult -- ilyenkor a magas surlodas BEAKASZTANA a
      // kocsit. Sikos karosszerianal inkabb lecsuszik a falrol, ami
      // arkad jatekban sokkal kevesbe frusztralo.
      .setFriction(0.2)
      .setRestitution(0.15)
      .setCollisionGroups(COLLISION_LOCAL);
    this.world.createCollider(colliderDesc, this.chassis);

    // Egyetlen sugarat hozunk letre es hasznaljuk ujra: 4 kerek * 60 Hz
    // felesleges szemetet jelentene lepesenkent.
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  setWheelDamage(index: number, damage: WheelDamage): void {
    if (index < 0 || index >= WHEEL_LAYOUT.length) return;
    this.damage[index] = damage;
  }

  /**
   * A kerekek allapotabol szarmazo tapadas (0..1).
   *
   * A regi modellben a serules kerekenkent kulon tapadasi gorbeket
   * allitott a jarmu-kontrolleren. Az arkad modellben a tapadas
   * EGYETLEN szam, ezert a negy kerek atlagat adjuk at. A kerekek
   * egyedi hatasa igy sem vesz el: a tort kerek nem tart, tehat az
   * auto tenylegesen ledol arra a sarkara (lasd updateSuspension).
   */
  private gripScale(): number {
    let sum = 0;
    for (const d of this.damage) sum += d.broken ? 0 : d.gripMultiplier;
    return sum / WHEEL_LAYOUT.length;
  }

  step(dt: number, input: DriveInput): void {
    const t0 = performance.now();

    // A dev-panel csuszkai kozvetlenul a config objektumot mutaljak,
    // ezert a testre hato ket erteket minden lepesben ujra beallitjuk.
    this.chassis.setLinearDamping(CHASSIS.linearDamping);
    this.chassis.setAngularDamping(CHASSIS.angularDamping);

    const quat = this.chassis.rotation();
    // Az auto sajat, ORTONORMALT bazisa. A sebesseget EBBEN bontjuk
    // szet, nem vizszintes vetuletben: igy a rampan a hajtoero a rampa
    // mente hat, nem a levegobe.
    const forwardAxis = rotateVec(quat, { x: 0, y: 0, z: FORWARD_SIGN });
    const rightAxis = rotateVec(quat, { x: 1, y: 0, z: 0 });
    const upAxis = rotateVec(quat, { x: 0, y: 1, z: 0 });

    // 1. Kerek-raycastok: talajkontaktus es a felfuggesztes ereje.
    const grounded = this.updateSuspension(dt, quat, upAxis);

    // 2. A TENYLEGES sebesseget bontjuk szet -- benne van minden, amit
    //    az utkozesek es a robbanasok csinaltak vele.
    const v = this.chassis.linvel();
    const vertical = dot(v, upAxis);
    this.motion = {
      forward: dot(v, forwardAxis),
      lateral: dot(v, rightAxis),
      yawRate: this.chassis.angvel().y,
    };

    // 3. A vezetes-modell lepese (lasd arcade.ts).
    const next = stepArcade(this.motion, input, dt, {
      grounded,
      grip: this.gripScale(),
    });
    this.motion = next;

    // 4. Vissza vilagkoordinatakba. A FUGGOLEGES osszetevo valtozatlan
    //    marad: az a gravitacioe, a rugoke es az utkozeseke.
    this.chassis.setLinvel(
      {
        x:
          forwardAxis.x * next.forward +
          rightAxis.x * next.lateral +
          upAxis.x * vertical,
        y:
          forwardAxis.y * next.forward +
          rightAxis.y * next.lateral +
          upAxis.y * vertical,
        z:
          forwardAxis.z * next.forward +
          rightAxis.z * next.lateral +
          upAxis.z * vertical,
      },
      true,
    );

    // A bukdacsolast (X) es az oldaldolest (Z) NEM irjuk felul: azok a
    // rugoke es az utkozeseke. Csak a fuggoleges tengely koruli
    // fordulas a mienk.
    const av = this.chassis.angvel();
    this.chassis.setAngvel({ x: av.x, y: next.yawRate, z: av.z }, true);

    // 5. Talpra allas, ha felborult.
    this.applyRighting(dt, upAxis);

    // 6. Kerek-latvany (kormanyszog, gordules) -- a fizikat nem erinti.
    this.updateWheelVisuals(dt, input, next.forward);

    // A tavoli testeknel feljegyezzuk, hova kerulnenek PUSZTAN a
    // beallitott sebessegtol -- a lepes utan ebbol derul ki, hogy erte-e
    // oket kulso ero (azaz nekunk mentek, vagy mi nekik).
    for (const entry of this.remoteBodies.values()) {
      const p = entry.body.translation();
      const bv = entry.body.linvel();
      entry.expected = { x: p.x + bv.x * dt, z: p.z + bv.z * dt };
    }

    this.world.step();
    this.detectRemoteCollisions();

    const elapsed = performance.now() - t0;
    this.stepMsAvg = this.stepMsAvg * 0.9 + elapsed * 0.1;
    this.stepsLastFrame++;
  }

  /**
   * Kerek-raycastok es a felfuggesztes ereje.
   *
   * Ez potolja a Rapier jarmu-kontrolleret. Minden kerek csatlakozasi
   * pontjabol egy sugarat lovunk az auto "lefele" iranyaba; ha az a
   * rugo hosszan belul talalatot ad, rugoerot fejtunk ki A KEREK
   * HELYEN. Az ero TAMADASPONTJA a lenyeg: ettol dol be a kocsi
   * kanyarban es ettol bukik elore fekezeskor, magatol. A regi
   * modellben ugyanezt kulon stabilizacios kodnak kellett eloallitania,
   * majd utana csillapitania.
   *
   * @returns er-e legalabb egy kerek a talajt
   */
  private updateSuspension(
    dt: number,
    quat: { x: number; y: number; z: number; w: number },
    upAxis: Vec3,
  ): boolean {
    // FONTOS: a Rapierben az addForce/addForceAtPoint TARTOS erot ad
    // hozza, ami resetForces()-ig ervenyben marad -- nem lepesenkent
    // torlodik, mint egy impulzus. E nelkul a rugoerok lepesrol lepesre
    // osszeadodnak: merve az auto a foldet erintve felgyulemlett 4 x 60
    // kN-nal orokre felfele gyorsult (240 m/s^2), meg a levegoben is.
    this.chassis.resetForces(false);
    this.chassis.resetTorques(false);

    const p = this.chassis.translation();
    const down = { x: -upAxis.x, y: -upAxis.y, z: -upAxis.z };
    const rest = WHEEL.suspensionRestLength;
    let grounded = false;

    for (let i = 0; i < WHEEL_LAYOUT.length; i++) {
      const contact = this.contacts[i];
      const previous = contact.suspensionLength;

      if (this.damage[i].broken) {
        // Tort kerek nem tart semmit: az auto ledol arra a sarkara, es
        // a karosszeria fogja fel a sulyt.
        contact.inContact = false;
        contact.suspensionLength = rest;
        continue;
      }

      const offset = rotateVec(quat, WHEEL_LAYOUT[i].position);
      const origin = {
        x: p.x + offset.x,
        y: p.y + offset.y,
        z: p.z + offset.z,
      };
      const radius = wheelRadiusFor(this.damage[i]);

      this.ray.origin = origin;
      this.ray.dir = down;
      const hit = this.world.castRay(
        this.ray,
        rest + radius,
        true,
        undefined,
        COLLISION_LOCAL,
        undefined,
        this.chassis,
      );

      if (!hit) {
        contact.inContact = false;
        contact.suspensionLength = rest;
        continue;
      }

      grounded = true;
      contact.inContact = true;
      contact.suspensionLength = clamp(hit.timeOfImpact - radius, 0, rest);

      // Rugo + lengescsillapito. A csillapitas a rugo hosszanak
      // VALTOZASI utemebol jon: e nelkul a rugo tisztan tarolna es
      // visszaadna az energiat, azaz az auto trambulinkent pattogna
      // landolaskor.
      const compression = rest - contact.suspensionLength;
      const rate = (previous - contact.suspensionLength) / Math.max(dt, 1e-4);
      const force = clamp(
        WHEEL.suspensionStiffness * compression + WHEEL.suspensionDamping * rate,
        0,
        WHEEL.maxSuspensionForce,
      );

      this.chassis.addForceAtPoint(
        { x: upAxis.x * force, y: upAxis.y * force, z: upAxis.z * force },
        origin,
        true,
      );
    }

    return grounded;
  }

  /**
   * Talpra allitas borulas utan.
   *
   * Nem nyomatekkal dolgozik, hanem a karosszeria elfordulasat igazitja
   * vissza fuggoleges ala, lepesenkent a hatralevo szog egy hanyadaval.
   * Igy MINDIG sikerul, es mindig ugyanannyi ideig tart -- lasd RECOVERY.
   *
   * @returns az aktualis dolesszog (radian)
   */
  private applyRighting(dt: number, upAxis: Vec3): number {
    // Szog az auto sajat "felfele" iranya es a valodi fuggoleges kozott.
    const tilt = Math.acos(clamp(upAxis.y, -1, 1));
    const start = (RECOVERY.startAngleDeg * Math.PI) / 180;
    if (tilt <= start) return tilt;

    // A tengely, ami az auto "fel" iranyat a vilag "fel" iranyaba viszi.
    let axis = cross(upAxis, { x: 0, y: 1, z: 0 });
    let len = length(axis);
    if (len < 1e-4) {
      // Pontosan fejen allo auto: a kereszt-szorzat nulla hosszu, tehat
      // nincs belole ertelmes irany. Barmelyik VIZSZINTES tengely jo --
      // csak valasztani kell egyet, kulonben a kocsi beragadna a fejen
      // allo, instabil egyensulyi helyzetben.
      axis = { x: 1, y: 0, z: 0 };
      len = 1;
    }
    const nx = axis.x / len;
    const ny = axis.y / len;
    const nz = axis.z / len;

    const fraction = clamp(dt / RECOVERY.rightingTime, 0, 1);
    // Vilag-rendszerbeli forgatas: delta * jelenlegi.
    const rotated = quatMul(
      quatAxisAngle(nx, ny, nz, tilt * fraction),
      toQ(this.chassis.rotation()),
    );
    this.chassis.setRotation(rotated, true);

    // A megmarado porges atlenditene a fuggolegesen, es a kocsi a masik
    // oldalara dolne. A FUGGOLEGES tengely koruli forgast (y) nem
    // bantjuk: az a kormany dolga.
    const av = this.chassis.angvel();
    this.chassis.setAngvel(
      {
        x: av.x * RECOVERY.spinDamping,
        y: av.y,
        z: av.z * RECOVERY.spinDamping,
      },
      true,
    );

    return tilt;
  }

  /**
   * A kerekek LATVANYA: kormanyszog es gordules.
   *
   * Egyik sem hat vissza a fizikara -- a kanyart a yawRate vegzi.
   * Azert kell megis, mert elfordulatlan kerekkel kanyarodo (vagy allo
   * kerekkel szaguldo) auto azonnal hamisnak latszik.
   */
  private updateWheelVisuals(
    dt: number,
    input: DriveInput,
    forwardSpeed: number,
  ): void {
    const target =
      FORWARD_SIGN * clamp(input.steer, -1, 1) * ARCADE.visualSteerAngle;
    const rate =
      Math.abs(input.steer) > 0.01 ? ARCADE.steerSpeed : ARCADE.steerReturnSpeed;
    this.steerVisual = approach(
      this.steerVisual,
      target,
      rate * ARCADE.visualSteerAngle * dt,
    );

    for (let i = 0; i < WHEEL_LAYOUT.length; i++) {
      if (this.damage[i].broken) continue;
      const radius = Math.max(0.05, wheelRadiusFor(this.damage[i]));
      this.wheelRoll[i] += (forwardSpeed * dt) / radius;
    }
  }

  private speedMs(): number {
    const v = this.chassis.linvel();
    return Math.hypot(v.x, v.y, v.z);
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
    const p = this.chassis.translation();
    const dirWorld = rotateVec(chassisQuat, SUSPENSION_DIR);
    const out: WheelReadout[] = [];

    for (let i = 0; i < WHEEL_LAYOUT.length; i++) {
      const layout = WHEEL_LAYOUT[i];
      const contact = this.contacts[i];
      const damage = this.damage[i];
      const radius = wheelRadiusFor(damage);
      const suspLen = contact.suspensionLength;

      // A kerek kozeppontja: a csatlakozasi pontbol a felfuggesztes
      // iranyaba, a rugo AKTUALIS hossza szerint.
      const offset = rotateVec(chassisQuat, layout.position);
      const cx = p.x + offset.x + dirWorld.x * suspLen;
      const cy = p.y + offset.y + dirWorld.y * suspLen;
      const cz = p.z + offset.z + dirWorld.z * suspLen;

      // Tort kerek nem kormanyoz -- ez latszik is rajta.
      const steering = layout.steered && !damage.broken ? this.steerVisual : 0;

      // chassis * kormanyszog(Y) * gordules(tengely)
      const qSteer = quatAxisAngle(0, 1, 0, steering);
      const qRoll = quatAxisAngle(AXLE.x, AXLE.y, AXLE.z, this.wheelRoll[i]);
      const q = quatMul(quatMul(toQ(chassisQuat), qSteer), qRoll);

      out.push({
        id: layout.id,
        position: [cx, cy, cz],
        quaternion: [q.x, q.y, q.z, q.w],
        inContact: contact.inContact,
        suspensionLength: suspLen,
        steering,
        radius,
        damage,
      });
    }
    return out;
  }

  getTelemetry(): Telemetry {
    let onGround = 0;
    for (const contact of this.contacts) {
      if (contact.inContact) onGround++;
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

  applyExplosion(
    position: [number, number, number],
    radius: number,
    maxPush: number,
  ): void {
    const p = this.chassis.translation();
    const dx = p.x - position[0];
    const dy = p.y - position[1];
    const dz = p.z - position[2];
    const distance = Math.hypot(dx, dy, dz);
    if (distance >= radius) return;

    const strength = maxPush * explosionFalloff(distance, radius);
    // Ha pontosan a robbanas kozeppontjaban allunk, nincs ertelmes
    // irany -- ilyenkor felfele lokjuk.
    const nx = distance > 0.01 ? dx / distance : 0;
    const ny = distance > 0.01 ? dy / distance : 1;
    const nz = distance > 0.01 ? dz / distance : 0;

    const v = this.chassis.linvel();
    this.chassis.setLinvel(
      {
        x: v.x + nx * strength,
        // Egy kis felfele-osszetevo mindig jar: igy a robbanas
        // "felkapja" az autot, nem csak oldalra csusztatja.
        y: v.y + ny * strength + strength * 0.35,
        z: v.z + nz * strength,
      },
      true,
    );
  }

  setNetworkLatency(ms: number): void {
    // Vedelem a kiugro ertekek ellen: egy-egy kesve erkezo csomag ne
    // huzza fel percekre a tartast.
    const value = clamp(ms, 0, 1000);

    // Felfele AZONNAL kovet, lefele csak lassan.
    //
    // A ping meresrol meresre ingadozik. Ha a pillanatnyi erteket
    // hasznalnank, egy lefele kilengés kozben megrovidulne a tartas --
    // eppen egy utkozes kellos kozepen --, es a kocsi lathatoan
    // visszaszivodna. A rovid tartas latvanyos hiba, a tul hosszu
    // viszont csak kesobbi osszesimulast jelent, ezert erdemes a
    // biztonsagosabb (hosszabb) irany fele tevedni.
    this.networkLatencyMs =
      value > this.networkLatencyMs
        ? value
        : this.networkLatencyMs * 0.99 + value * 0.01;
  }

  /**
   * Mennyi ideig tartsuk a lokalis utkozes-joslatot (ms).
   *
   * A tartasnak addig kell tartania, amig a masik kliens allapota
   * vissza nem er -- ez pedig egyenesen a kesleltetestol fugg, ezert
   * NEM lehet rogzitett szam (lasd REMOTE_COLLISION_HOLD_BASE_MS).
   */
  private holdDurationMs(): number {
    return REMOTE_COLLISION_HOLD_BASE_MS + this.networkLatencyMs;
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
        // lasd REMOTE_COLLISION_MAX_HOLD_EXTRA_MS.
        const maxHold =
          this.holdDurationMs() + REMOTE_COLLISION_MAX_HOLD_EXTRA_MS;
        if (now - entry.holdStartedAt < maxHold) {
          entry.holdUntil = now + this.holdDurationMs();
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
    // Az arkad modell allapota is nullazodik, kulonben az ujraszuletett
    // auto orokolne az elozo elet lendueletet es porgeset.
    this.motion = { forward: 0, lateral: 0, yawRate: 0 };
    for (const contact of this.contacts) {
      contact.inContact = false;
      contact.suspensionLength = WHEEL.suspensionRestLength;
    }
    this.steerVisual = 0;
    this.wheelRoll.fill(0);
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
