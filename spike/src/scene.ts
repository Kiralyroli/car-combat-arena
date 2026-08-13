import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARENA, CAMERA, CHASSIS, WHEEL } from "./config";
import type { Transform, WheelReadout } from "./types";

/** A jarmu-modell utvonala. Lasd EREDMENYEK.md: Sedan (generic-passenger-car-pack). */
const VEHICLE_MODEL_URL = "/models/sedan.glb";

const WHEEL_NODE_NAMES = ["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"] as const;

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  /**
   * A chassis-t egy "wrapper" csoport kepviseli, amit a fizika mozgat --
   * a betoltott Body mesh sajat origoja a modellben a talajszinten van
   * (nem a doboz kozeppontjaban, ahogy a fizika szamolja), ezert a Body
   * -CHASSIS.halfExtents.y lokalis eltolassal van a wrapperbe helyezve.
   */
  private chassisMesh!: THREE.Object3D;
  /** Kerekenkent az elso talalt Mesh, amin a serules-tintet allitjuk. */
  private wheelTintMeshes: THREE.Mesh[] = [];
  private wheelGroups: THREE.Object3D[] = [];

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

    window.addEventListener("resize", this.onResize);
  }

  /**
   * A SceneView letrehozasa es a jarmu-modell aszinkron betoltese egy
   * lepesben -- a hivo csak akkor kap kesz peldanyt, ha a chassis/kerek
   * mesh-ek mar keszen allnak, igy a fo render ciklusnak nem kell
   * kulon "meg nincs modell" allapotot kezelnie.
   */
  static async create(): Promise<SceneView> {
    const view = new SceneView();
    await view.loadVehicleModel();
    return view;
  }

  /**
   * Betolti a jarmu GLB modelljet, es a "Body"/"Wheel_FL" stb. nevu
   * node-okat kiemeli sajat jelenet-gyokerbe, hogy a fizika kozvetlenul
   * mozgathassa oket (lasd syncVehicle). Lasd EREDMENYEK.md a modell
   * es a fizikai meretek osszehangolasarol.
   */
  private async loadVehicleModel(): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(VEHICLE_MODEL_URL);
    gltf.scene.updateMatrixWorld(true);
    this.normalizeMaterials(gltf.scene);

    const body = gltf.scene.getObjectByName("Body");
    if (!body) {
      throw new Error(`"Body" node nem talalhato a modellben: ${VEHICLE_MODEL_URL}`);
    }
    this.splitTaillights(body);
    this.enableShadows(body);

    // Wrapper: a fizika ezt mozgatja/forgatja. A Body sajat origoja a
    // modellben talajszinten van, a fizika viszont a doboz KOZEPPONTJAT
    // szamolja -- ezert a Body -halfExtents.y lokalis eltolassal kerul
    // a wrapperbe.
    const chassisWrapper = new THREE.Group();
    body.position.y -= CHASSIS.halfExtents.y;
    chassisWrapper.add(body);
    this.scene.add(chassisWrapper);
    this.chassisMesh = chassisWrapper;

    for (const name of WHEEL_NODE_NAMES) {
      const wheelNode = gltf.scene.getObjectByName(name);
      if (!wheelNode) {
        throw new Error(`"${name}" node nem talalhato a modellben: ${VEHICLE_MODEL_URL}`);
      }
      this.enableShadows(wheelNode);
      // A serules-tinthez kell egy konkret Mesh referencia -- a kerek
      // node maga vagy mesh, vagy egy azt tartalmazo csoport.
      const tintMesh = this.findFirstMesh(wheelNode);
      if (!tintMesh) {
        throw new Error(`"${name}" node nem tartalmaz mesh-t: ${VEHICLE_MODEL_URL}`);
      }
      // Sajat, a tobbi kerekkel meg nem osztott anyag-peldany kell,
      // kulonben egy kerek serules-szine az osszes tobbit is befestene.
      tintMesh.material = (tintMesh.material as THREE.MeshStandardMaterial).clone();

      this.scene.add(wheelNode);
      this.wheelGroups.push(wheelNode);
      this.wheelTintMeshes.push(tintMesh);
    }
  }

  private findFirstMesh(root: THREE.Object3D): THREE.Mesh | null {
    if ((root as THREE.Mesh).isMesh) return root as THREE.Mesh;
    for (const child of root.children) {
      const found = this.findFirstMesh(child);
      if (found) return found;
    }
    return null;
  }

  /**
   * A forras modellben a fej- es hatso lampak (index, hatralampa,
   * hatso index) UGYANAZT az "Optics" anyagot hasznaljak (feher,
   * textura nelkul), tehat nem lehet oket kulon szinezni pusztan a
   * meglevo anyag modositasaval -- az az elso lampakat is befeste.
   *
   * Ehelyett a haromszogeket a lokalis Z-koordinatajuk elojele alapjan
   * ket csoportra bontjuk (negativ Z = orr/elso lampak, pozitiv Z =
   * hatso lampak -- lasd config.ts orr-konvencio), es a hatso
   * csoportnak egy piros klonjat adjuk az eredeti "Optics" anyagnak.
   */
  private splitTaillights(body: THREE.Object3D): void {
    const opticsMesh = body.children.find(
      (child) =>
        (child as THREE.Mesh).isMesh &&
        ((child as THREE.Mesh).material as THREE.Material).name.startsWith(
          "Optics",
        ),
    ) as THREE.Mesh | undefined;
    if (!opticsMesh) return;

    const geometry = opticsMesh.geometry;
    const index = geometry.getIndex();
    const position = geometry.attributes.position;
    if (!index) return;

    const frontIndices: number[] = [];
    const rearIndices: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      const avgZ = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
      (avgZ > 0 ? rearIndices : frontIndices).push(a, b, c);
    }
    if (rearIndices.length === 0) return;

    const rearMaterial = (
      opticsMesh.material as THREE.MeshStandardMaterial
    ).clone();
    rearMaterial.name = "Optics.rear";
    rearMaterial.color.setHex(0xcc1414);
    rearMaterial.emissive = new THREE.Color(0x330000);

    type TypedArrayCtor = new (length: number) => Uint16Array | Uint32Array;
    const IndexArrayCtor = index.array.constructor as TypedArrayCtor;
    const newIndex = new IndexArrayCtor(frontIndices.length + rearIndices.length);
    newIndex.set(frontIndices, 0);
    newIndex.set(rearIndices, frontIndices.length);
    geometry.setIndex(new THREE.BufferAttribute(newIndex, 1));

    geometry.clearGroups();
    geometry.addGroup(0, frontIndices.length, 0);
    geometry.addGroup(frontIndices.length, rearIndices.length, 1);
    opticsMesh.material = [opticsMesh.material as THREE.Material, rearMaterial];
  }

  private enableShadows(root: THREE.Object3D): void {
    root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }

  /**
   * A forras csomag anyagai metalness=1-gyel exportalodtak, de nincs
   * hozzajuk metalness/roughness terkep, es a jelenetben nincs
   * kornyezeti fenykep (environment map) sem, amirol egy tiszta femes
   * feluletnek visszatukrozodnie kellene -- ezert a betoltott auto
   * majdnem feketenek latszott. Sajat festett-fem ertekekre allitjuk
   * at azokat az anyagokat, amelyeknek nincs sajat metalness/roughness
   * terkepuk (tehat a nyers exportalt skalar ertek amugy is csak
   * placeholder volt).
   */
  private normalizeMaterials(root: THREE.Object3D): void {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat.metalnessMap || mat.roughnessMap) return; // van sajat terkep, hagyjuk
      mat.metalness = 0.2;
      mat.roughness = 0.55;
    });
  }

  private setupLights(): void {
    // Emelve (1.1 -> 1.6), hogy a fem-jellegu PBR anyagok kornyezeti
    // fenykep nelkul is jol lathatoak legyenek (lasd normalizeMaterials).
    this.scene.add(new THREE.HemisphereLight(0x9fb4d0, 0x2a2f38, 1.6));

    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
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

      const mesh = this.wheelTintMeshes[i];
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
