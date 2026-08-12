import * as THREE from "three";
import { ARENA, CAMERA, CHASSIS, WHEEL, WHEEL_LAYOUT } from "./config";
import type { Transform, WheelReadout } from "./types";

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private chassisMesh: THREE.Mesh;
  private wheelMeshes: THREE.Mesh[] = [];
  private wheelGroups: THREE.Group[] = [];

  private camPos = new THREE.Vector3(0, 6, -12);
  private camLook = new THREE.Vector3();
  private tmpVec = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();

  // Ujrahasznositott ideiglenes objektumok az interpolaciohoz -- ne
  // allokaljunk minden frame-ben, GC-nyomast okozna.
  private interpPos = new THREE.Vector3();
  private interpQuat = new THREE.Quaternion();
  private prevPos = new THREE.Vector3();
  private prevQuat = new THREE.Quaternion();
  private currPos = new THREE.Vector3();
  private currQuat = new THREE.Quaternion();

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(
      Math.max(window.innerWidth, 1),
      Math.max(window.innerHeight, 1),
    );
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1117);
    this.scene.fog = new THREE.Fog(0x0d1117, 60, 140);

    this.camera = new THREE.PerspectiveCamera(
      62,
      Math.max(window.innerWidth, 1) / Math.max(window.innerHeight, 1),
      0.1,
      500,
    );

    this.setupLights();
    this.buildArena();

    this.chassisMesh = this.buildChassis();
    this.buildWheels();

    window.addEventListener("resize", this.onResize);
  }

  private setupLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x9fb4d0, 0x2a2f38, 1.1));

    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(28, 44, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 55;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.far = 140;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
  }

  private buildArena(): void {
    for (const box of ARENA) {
      const geo = new THREE.BoxGeometry(
        box.halfExtents.x * 2,
        box.halfExtents.y * 2,
        box.halfExtents.z * 2,
      );
      const mat = new THREE.MeshStandardMaterial({
        color: box.color,
        roughness: 0.9,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(box.position.x, box.position.y, box.position.z);
      if (box.rotation) {
        mesh.rotation.set(box.rotation.x, box.rotation.y, box.rotation.z);
      }
      mesh.receiveShadow = true;
      mesh.castShadow = box.name !== "ground";
      this.scene.add(mesh);
    }

    // Racs a talajon, hogy a sebesseg es a csuszas lathato legyen.
    const grid = new THREE.GridHelper(80, 40, 0x4a5568, 0x323a45);
    grid.position.y = 0.02;
    this.scene.add(grid);
  }

  private buildChassis(): THREE.Mesh {
    const geo = new THREE.BoxGeometry(
      CHASSIS.halfExtents.x * 2,
      CHASSIS.halfExtents.y * 2,
      CHASSIS.halfExtents.z * 2,
    );
    const mat = new THREE.MeshStandardMaterial({
      color: 0xd94a3d,
      roughness: 0.45,
      metalness: 0.2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    this.scene.add(mesh);

    // Elore-jelzo, hogy egyertelmu legyen az auto iranya.
    const noseGeo = new THREE.BoxGeometry(0.5, 0.2, 0.5);
    const noseMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5 });
    const nose = new THREE.Mesh(noseGeo, noseMat);
    // Az orr negativ Z fele nez (lasd config.ts).
    nose.position.set(0, CHASSIS.halfExtents.y, -(CHASSIS.halfExtents.z - 0.35));
    mesh.add(nose);

    return mesh;
  }

  private buildWheels(): void {
    const geo = new THREE.CylinderGeometry(WHEEL.radius, WHEEL.radius, 0.3, 20);
    // A henger alapertelmezetten Y tengelyu -- forgassuk X-re (tengely irany).
    geo.rotateZ(Math.PI / 2);

    for (let i = 0; i < WHEEL_LAYOUT.length; i++) {
      const group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        color: 0x1f2429,
        roughness: 0.85,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;

      // Kullo-jelzo, hogy lassuk a kerek forgasat.
      const spokeGeo = new THREE.BoxGeometry(0.34, WHEEL.radius * 1.5, 0.1);
      const spokeMat = new THREE.MeshStandardMaterial({ color: 0xc9d1d9 });
      mesh.add(new THREE.Mesh(spokeGeo, spokeMat));

      group.add(mesh);
      this.scene.add(group);
      this.wheelGroups.push(group);
      this.wheelMeshes.push(mesh);
    }
  }

  /** Poziciot lerp-el, forgast slerp-el, es az eredmenyt egy Object3D-re alkalmazza. */
  private applyInterpolated(
    prev: Transform,
    curr: Transform,
    alpha: number,
    target: THREE.Object3D,
  ): void {
    this.prevPos.set(...prev.position);
    this.currPos.set(...curr.position);
    this.interpPos.lerpVectors(this.prevPos, this.currPos, alpha);

    this.prevQuat.set(...prev.quaternion);
    this.currQuat.set(...curr.quaternion);
    this.interpQuat.slerpQuaternions(this.prevQuat, this.currQuat, alpha);

    target.position.copy(this.interpPos);
    target.quaternion.copy(this.interpQuat);
  }

  /**
   * Interpolalt szinkronizacio a fizika (fix 60 Hz) es a renderelesi
   * frame-rate (a monitorhoz igazodo, valtozo) kozott.
   *
   * A fizika csak diszkret 1/60 s-os lepesekben halad, de a renderelt
   * frame-ek ettol fuggetlen idopontokban keszulnek -- interpolacio
   * nelkul ez lathato akadozast okoz, meg akkor is, ha maga a fizika
   * stabil (lasd projekt-terv 15.3 es EREDMENYEK.md). Az `alpha`
   * (0..1) azt fejezi ki, hogy a ket legutobbi fizikai allapot kozott
   * hol tartunk idoben; `prev` es `curr` ket egymast koveto fizikai
   * lepes eredménye.
   */
  /**
   * @returns az interpolalt chassis transform (a kamera ezt hasznalja,
   * hogy ne szamoljuk ketszer ugyanazt az interpolaciot).
   */
  syncVehicle(
    prevChassis: Transform,
    chassis: Transform,
    prevWheels: WheelReadout[],
    wheels: WheelReadout[],
    alpha: number,
  ): Transform {
    this.applyInterpolated(prevChassis, chassis, alpha, this.chassisMesh);
    const interpolatedChassis: Transform = {
      position: this.interpPos.toArray() as [number, number, number],
      quaternion: this.interpQuat.toArray() as [
        number,
        number,
        number,
        number,
      ],
    };

    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i];
      const pw = prevWheels[i];
      const group = this.wheelGroups[i];
      this.applyInterpolated(pw, w, alpha, group);

      const mesh = this.wheelMeshes[i];
      // A sugar valtozhat (defekt / letort gumi).
      const scale = w.radius / WHEEL.radius;
      mesh.scale.set(1, scale, scale);

      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (w.damage.broken) {
        mat.color.setHex(0x8b2f2a);
      } else if (w.damage.gripMultiplier < 0.99) {
        mat.color.setHex(0x6b4a1f);
      } else {
        mat.color.setHex(0x1f2429);
      }
    }

    return interpolatedChassis;
  }

  updateCamera(chassis: Transform): void {
    this.tmpQuat.set(...chassis.quaternion);

    // Az offsetet csak a fuggoleges tengely koruli forgatas erdekli,
    // kulonben a kamera egyutt bukfencezik az autoval.
    const forward = this.tmpVec.set(0, 0, 1).applyQuaternion(this.tmpQuat);
    const yaw = Math.atan2(forward.x, forward.z);
    const flatQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      yaw,
    );

    const desired = new THREE.Vector3(
      CAMERA.offset.x,
      CAMERA.offset.y,
      CAMERA.offset.z,
    )
      .applyQuaternion(flatQuat)
      .add(new THREE.Vector3(...chassis.position));

    this.camPos.lerp(desired, CAMERA.positionLerp);
    this.camera.position.copy(this.camPos);

    const lookTarget = new THREE.Vector3(...chassis.position);
    lookTarget.y += CAMERA.lookAtHeight;
    this.camLook.lerp(lookTarget, CAMERA.lookAtLerp);
    this.camera.lookAt(this.camLook);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private onResize = (): void => {
    // Rejtett panel eseten a meret 0 lehet -- ilyenkor az aspect NaN lenne.
    const w = Math.max(window.innerWidth, 1);
    const h = Math.max(window.innerHeight, 1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };
}
