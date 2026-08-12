import RAPIER from "@dimforge/rapier3d-compat";
import {
  ARENA,
  CHASSIS,
  DRIVE,
  GRAVITY,
  RECOVERY,
  WHEEL,
  WHEEL_LAYOUT,
} from "../config";
import { clamp, cross, dot, eulerToQuat, length, lerp, rotateVec } from "../math";
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

export class RapierBackend implements VehicleBackend {
  readonly name = "Rapier";
  readonly version = "0.20.0 (rapier3d-compat)";

  private world!: RAPIER.World;
  private chassis!: RAPIER.RigidBody;
  private controller!: RAPIER.DynamicRayCastVehicleController;

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
      ).setFriction(1.0);
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
      .setRestitution(0.1);
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

    c.setWheelFrictionSlip(i, Math.max(0.08, WHEEL.frictionSlip * grip));
    c.setWheelSideFrictionStiffness(
      i,
      Math.max(0.02, WHEEL.sideFrictionStiffness * grip),
    );
    c.setWheelSuspensionCompression(i, WHEEL.suspensionCompression);
    c.setWheelSuspensionRelaxation(i, WHEEL.suspensionRelaxation);
    c.setWheelMaxSuspensionTravel(i, WHEEL.maxSuspensionTravel);

    if (d.broken) {
      // Nincs felfuggesztesi ero -> az auto ledol erre a sarokra.
      c.setWheelSuspensionStiffness(i, 0);
      c.setWheelMaxSuspensionForce(i, 0);
      // A gumi "letort", csak a felni marad.
      c.setWheelRadius(i, WHEEL.radius * 0.55);
    } else {
      // Serult (de nem tort) kereknel a rugo is gyengul kicsit.
      c.setWheelSuspensionStiffness(
        i,
        WHEEL.suspensionStiffness * lerp(0.6, 1, d.gripMultiplier),
      );
      c.setWheelMaxSuspensionForce(i, WHEEL.maxSuspensionForce);
      c.setWheelRadius(i, WHEEL.radius * lerp(0.85, 1, d.gripMultiplier));
    }
  }

  setWheelDamage(index: number, damage: WheelDamage): void {
    if (index < 0 || index >= WHEEL_LAYOUT.length) return;
    this.damage[index] = damage;
    this.applyWheelTuning(index);
  }

  step(dt: number, input: DriveInput): void {
    const t0 = performance.now();

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
    const corneringDemand = steeredWheelsHealthy ? Math.abs(input.steer) : 0;
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

    this.applySelfRighting(dt);

    this.controller.updateVehicle(dt);
    this.world.step();

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
  private applySelfRighting(dt: number): void {
    const q = this.chassis.rotation();
    const localUpWorld = rotateVec(q, { x: 0, y: 1, z: 0 });
    const worldUp = { x: 0, y: 1, z: 0 };

    const cosTilt = clamp(dot(localUpWorld, worldUp), -1, 1);
    const tiltAngle = Math.acos(cosTilt);

    const startAngle = (RECOVERY.startAngleDeg * Math.PI) / 180;
    if (tiltAngle <= startAngle) {
      this.tiltedSince = null;
      return;
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
  }

  getChassis(): Transform {
    const p = this.chassis.translation();
    const q = this.chassis.rotation();
    return {
      position: [p.x, p.y, p.z],
      quaternion: [q.x, q.y, q.z, q.w],
    };
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
