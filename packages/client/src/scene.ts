import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  WEAPON_MOUNT,
  ARENA,
  CAMERA,
  CHASSIS,
  EXPLOSION_RADIUS,
  PICKUP_HEIGHT,
  PICKUP_POINTS,
  MAX_HP,
  WHEEL,
  WHEEL_LAYOUT,
  wheelRadiusFor,
  wheelTintFor,
  type RocketSnapshot,
  type Transform,
  type WheelDamage,
  type WheelReadout,
} from "@cca/shared";

/** A jarmu-modell utvonala. Lasd EREDMENYEK.md: Sedan (generic-passenger-car-pack). */
const VEHICLE_MODEL_URL = "/models/sedan.glb";

const WHEEL_NODE_NAMES = ["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"] as const;

/** Milyen magasan lebegjen a HP-sav az auto kozeppontja felett (m). */
const HP_BAR_HEIGHT = CHASSIS.halfExtents.y + 1.4;

/** A nevtabla a HP-sav FOLE kerul, hogy a ketto ne fedje egymast. */
const NAME_TAG_HEIGHT = HP_BAR_HEIGHT + 0.7;

/**
 * A fegyver meretei a KOZOS forrasbol jonnek (WEAPON_MOUNT).
 *
 * Korabban itt sajat szamok alltak, a loves kiindulopontja pedig
 * mashonnan szamolodott -- ezert jott a loves a lokharito magassagabol
 * a tetőn ülő cso helyett. Egy forras, ket felhasznalo.
 */
const LAUNCHER_HEIGHT = WEAPON_MOUNT.height;

/**
 * Egy tavoli (halozati) jatekos autoja.
 *
 * A kerekek NEM a fizikabol kapjak a helyuket (tavoli autot nem
 * szimulalunk lokalisan), hanem a snapshotbol erkezo latvany-
 * allapotbol -- lasd WheelVisualState a protokollban.
 */
/** Amit egy tavoli auto latvanyahoz a halozati rtegtol kapunk. */
export interface RemoteVisualState {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  steer: number;
  susp: [number, number, number, number];
  grip: [number, number, number, number];
  brokenMask: number;
  aimYaw: number;
  aimPitch: number;
}

interface RemoteCar {
  /** A fizikai chassis-transzformot ez kapja. */
  wrapper: THREE.Object3D;
  /** Kerek-node-ok FL, FR, RL, RR sorrendben (= WHEEL_LAYOUT). */
  wheels: THREE.Object3D[];
  /** Kerekenkent a szinezendo mesh -- sajat anyag-peldannyal. */
  wheelMeshes: THREE.Mesh[];
  /** A kerekek nyugalmi lokalis Y-koordinataja (a rugo-elmozdulas ehhez kepest hat). */
  wheelRestY: number[];
  /** Rakétaveto a tetőn -- a celzas iranyaba fordul. */
  launcher: { root: THREE.Group; tube: THREE.Object3D };
  /** HP-sav az auto felett (billboard sprite). */
  hpBar: THREE.Sprite;
  /** Nevtabla a HP-sav felett. */
  nameTag: THREE.Sprite;
  /** Az utoljara KIRAJZOLT nev -- csak valtozaskor rajzolunk ujra. */
  shownName: string;
  /** Az utoljara KIRAJZOLT HP -- csak valtozaskor rajzolunk ujra. */
  shownHp: number;
  /** Mikor semmisult meg (a KIRAJZOLT idovonalon); null, ha el. */
  diedAt: number | null;
  /** Halmozott gordulesi szog radianban -- a megtett utbol szamolva. */
  rollAngle: number;
  /** Elozo pozicio a megtett ut merésehez; null az elso frame-ig. */
  prevPos: THREE.Vector3 | null;
}

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

  /**
   * Osszeszerelt auto-modell, amibol a tavoli jatekosok autoi klonozodnak.
   * A klonok kozos geometriat es (a karosszeria-szin kivetelevel) kozos
   * anyagokat hasznalnak, tehat olcsok.
   */
  private remoteTemplate!: THREE.Object3D;
  private remoteCars = new Map<string, RemoteCar>();
  /** A sajat autonk rakétavetője (a tetőn). */
  private launcher!: { root: THREE.Group; tube: THREE.Object3D };

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
    // SZANDEKOSAN nincs tonelekepezes (ACES).
    //
    // Kiprobaltam, es rontott: a jelenetet nem HDR-fenyek vilagitjak
    // (hemisphere + egy nap), ezert az ACES nem a csucsfenyeket szeliditi,
    // hanem az egesz kepet sotetiti -- meg a `scene.background` szinet is,
    // tehat a megadott eg-szin helyett egy sokkal sotetebb valtozat
    // jelent meg. Pont az ellenkezoje annak, amit el akartunk erni.
    // A szinek igy pontosan ugy jelennek meg, ahogy meg vannak adva.
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

    // A sablon a taillight-bontas UTAN keszul (hogy a tavoli autoknak is
    // piros legyen a hatso lampajuk), de MIELOTT a lokalis auto node-jait
    // kiemeljuk a jelenetbol -- ekkor meg egyben van a teljes auto.
    // A clone(true) megosztja a geometriakat es anyagokat, csak az
    // objektum-grafot masolja, tehat olcso.
    this.remoteTemplate = gltf.scene.clone(true);

    // Wrapper: a fizika ezt mozgatja/forgatja. A Body sajat origoja a
    // modellben talajszinten van, a fizika viszont a doboz KOZEPPONTJAT
    // szamolja -- ezert a Body -halfExtents.y lokalis eltolassal kerul
    // a wrapperbe.
    const chassisWrapper = new THREE.Group();
    body.position.y -= CHASSIS.halfExtents.y;
    chassisWrapper.add(body);

    // Rakétaveto a tetőre. A jarmu GYEREKE, tehat egyutt mozog es dol
    // vele -- csak a celzas-irany szamolodik le rola (lasd aimLauncher).
    this.launcher = this.createLauncher();
    this.launcher.root.position.y = LAUNCHER_HEIGHT;
    chassisWrapper.add(this.launcher.root);

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

  // --- Rakétaveto (a tetőn) ---

  /**
   * Egyszeru rakétaveto primitivekbol.
   *
   * SZANDEKOSAN nem letoltott modell: a terv az asset-munkat az MVP
   * utanra uteemezi (5. lepcso: eloszb tesztelok, csak utana tartalom),
   * es a fegyverkeszlet sincs meg lezarva. Ez a placeholder viszont
   * megoldja azt, ami most valoban hianyzik: latszik, hogy az auto fel
   * van fegyverkezve, es hogy MERRE celoz.
   *
   * A felepites keszakarva ugyanaz, mint egy kesobbi valodi modellnel
   * lenne: egy forgo alap (yaw) es egy benne bolintó cső (pitch) --
   * igy a csere egyetlen `WeaponPoint_Roof` csomoponttal megoldhato
   * lesz (terv 6. fejezet).
   */
  private createLauncher(): { root: THREE.Group; tube: THREE.Object3D } {
    if (!this.launcherParts) {
      this.launcherParts = {
        base: new THREE.BoxGeometry(0.5, 0.16, 0.5),
        tube: new THREE.CylinderGeometry(0.11, 0.13, WEAPON_MOUNT.tubeLength, 10),
        material: new THREE.MeshStandardMaterial({
          color: 0x3a4048,
          roughness: 0.6,
          metalness: 0.3,
        }),
      };
      // A cső alapertelmezetten +Y fele all -- forgassuk -Z fele, hogy
      // az "elore" a modell orr-iranya legyen (lasd config.ts).
      this.launcherParts.tube.rotateX(Math.PI / 2);
    }
    const parts = this.launcherParts;

    const root = new THREE.Group();
    const base = new THREE.Mesh(parts.base, parts.material);
    base.castShadow = true;
    root.add(base);

    // A cső kicsit fentebb es elorebb ul az alapon.
    const tube = new THREE.Mesh(parts.tube, parts.material);
    tube.position.set(0, WEAPON_MOUNT.tubeRise, -WEAPON_MOUNT.tubeForward);
    tube.castShadow = true;
    root.add(tube);

    return { root, tube };
  }

  private launcherParts: {
    base: THREE.BoxGeometry;
    tube: THREE.CylinderGeometry;
    material: THREE.MeshStandardMaterial;
  } | null = null;

  /**
   * A veto beallitasa a celzas szerint.
   *
   * Az alap VILAG-iranyba fordul, ezert a kocsi sajat elfordulasat le
   * kell vonni: a veto a jarmu gyereke, tehat a lokalis szoge a ketto
   * kulonbsege. Enelkul kanyarodas kozben egyutt fordulna az autoval,
   * es nem oda mutatna, ahova celzunk.
   */
  private aimLauncher(
    launcher: { root: THREE.Group; tube: THREE.Object3D },
    carQuaternion: THREE.Quaternion,
    aimYaw: number,
    aimPitch: number,
  ): void {
    // Ugyanaz a konvencio, mint a celzasnal (lasd main.ts currentAim):
    // az az Y-forgatas, amivel egy -Z fele nezo objektum ebbe az iranyba
    // fordul.
    const forward = this.tmpVec.set(0, 0, -1).applyQuaternion(carQuaternion);
    const carYaw = Math.atan2(-forward.x, -forward.z);
    launcher.root.rotation.set(0, aimYaw - carYaw, 0);
    // A cső geometriaja mar -Z fele all (lasd createLauncher), ezert itt
    // csak a bolintás jon ra: +X korul forgatva a -Z irany felfele mozdul.
    launcher.tube.rotation.x = aimPitch;
  }

  // --- Celzas ---

  private readonly arenaMeshes: THREE.Mesh[] = [];
  /** Ujrahasznositott lista a celzas-sugarhoz -- ne allokaljunk lovesenkent. */
  private readonly aimTargets: THREE.Object3D[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  /** A talaj sikja: ha a sugar nem talal el semmit, ide vetitunk. */
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly aimPoint = new THREE.Vector3();

  /**
   * Hova mutat a celkereszt a vilagban.
   *
   * A kepernyo-koordinatabol sugarat inditunk a kamerabol, es az ARENA
   * feluleteire vetitunk. Ha a sugar nem talal el semmit (pl. az eg
   * fele nez), a talaj sikjara esunk vissza; ha meg az sem metszi
   * (felfele mutato sugar), egy tavoli pontot adunk vissza a sugar
   * menten -- igy a celzas mindig ad ertelmes iranyt, sosem "akad meg".
   *
   * @param ndcX -1..1 kepernyo-koordinata (bal..jobb)
   * @param ndcY -1..1 (lent..fent)
   */
  aimPointAt(ndcX: number, ndcY: number): [number, number, number] {
    this.ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndc, this.camera);

    // A TAVOLI AUTOKRA is celozni kell tudni, nem csak a palyara.
    // Nelkuluk a sugar athatolna rajtuk, es a mogottuk levo talajra
    // celoznank -- vagyis egy ellenfelre celozva a rakéta enyhen lefele
    // indulna, es a labai elott csapodna be.
    this.aimTargets.length = 0;
    this.aimTargets.push(...this.arenaMeshes);
    for (const car of this.remoteCars.values()) {
      if (car.wrapper.visible) this.aimTargets.push(car.wrapper);
    }

    const hits = this.raycaster.intersectObjects(this.aimTargets, true);
    if (hits.length > 0) {
      const p = hits[0].point;
      return [p.x, p.y, p.z];
    }

    if (this.raycaster.ray.intersectPlane(this.groundPlane, this.aimPoint)) {
      return [this.aimPoint.x, this.aimPoint.y, this.aimPoint.z];
    }

    this.raycaster.ray.at(200, this.aimPoint);
    return [this.aimPoint.x, this.aimPoint.y, this.aimPoint.z];
  }

  // --- Rakétak (a szerver lepteti, mi csak rajzoljuk) ---

  private rocketMeshes = new Map<number, THREE.Object3D>();
  private rocketGeometry: THREE.CylinderGeometry | null = null;
  private rocketMaterial: THREE.MeshStandardMaterial | null = null;

  /**
   * A repulo rakétak szinkronizalasa a szerver snapshotjaval.
   *
   * A lovedeket NEM mi szimulaljuk (terv 15.4: a talalat a szerveren
   * dol el), ezert egyszeruen a kapott listahoz igazitjuk a jelenetet:
   * ami uj, azt letrehozzuk, ami eltunt, azt toroljuk.
   */
  /**
   * A KIRAJZOLT rakétak helyzete -- a tesztek ezt merik.
   *
   * Szandekosan a jelenetbol olvas, nem a halozati pufferbol: a jatekos
   * is ezt latja, es epp az volt a hiba, hogy a kirajzolt lovedek mas
   * idovonalon jart, mint a kirajzolt autok.
   */
  drawnRocketPositions(): [number, number, number][] {
    return [...this.rocketMeshes.values()].map((m) => [
      m.position.x,
      m.position.y,
      m.position.z,
    ]);
  }

  syncRockets(rockets: RocketSnapshot[]): void {
    if (!this.rocketGeometry) {
      // Kozos geometria es anyag minden rakétahoz -- olcso.
      this.rocketGeometry = new THREE.CylinderGeometry(0.12, 0.18, 1.1, 8);
      // A henger alapertelmezetten +Y fele all; forgassuk -Z fele, hogy
      // a "haladasi irany" a modell elore-tengelye legyen.
      this.rocketGeometry.rotateX(Math.PI / 2);
      this.rocketMaterial = new THREE.MeshStandardMaterial({
        color: 0xf0a020,
        emissive: 0x803000,
        roughness: 0.5,
      });
    }

    const seen = new Set<number>();
    for (const rocket of rockets) {
      seen.add(rocket.id);
      let mesh = this.rocketMeshes.get(rocket.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.rocketGeometry, this.rocketMaterial!);
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.rocketMeshes.set(rocket.id, mesh);
      }
      mesh.position.set(...rocket.position);
      // A modell -Z tengelyet forditjuk a halado iranyba.
      this.tmpVec.set(...rocket.direction);
      mesh.quaternion.setFromUnitVectors(SceneView.MODEL_FORWARD, this.tmpVec);
    }

    for (const [id, mesh] of this.rocketMeshes) {
      if (seen.has(id)) continue;
      this.scene.remove(mesh);
      this.rocketMeshes.delete(id);
    }
  }

  /** A modell elore-tengelye (lasd config.ts orr-konvencio). */
  private static readonly MODEL_FORWARD = new THREE.Vector3(0, 0, -1);

  /** A SAJAT autonk vetőjenek beallitasa a celzas szerint. */
  setOwnAim(aimYaw: number, aimPitch: number): void {
    this.aimLauncher(this.launcher, this.chassisMesh.quaternion, aimYaw, aimPitch);
  }

  // --- Boost pickupok ---

  private pickupMeshes: THREE.Mesh[] = [];

  /**
   * A pickupok letrehozasa (egyszer) es allapotuk frissitese.
   *
   * A POZICIO nem a halozatrol jon: az allando, a config-bol ismerjuk.
   * Csak azt kapjuk meg, hogy eppen felveheto-e melyik -- igy egy
   * snapshot nehany bit, nem ot pozicio.
   */
  syncPickups(available: boolean[], now: number): void {
    if (this.pickupMeshes.length === 0) {
      // Oktaeder: jol lathatoan "nem a palya resze", es olcso.
      const geometry = new THREE.OctahedronGeometry(0.7);
      for (const point of PICKUP_POINTS) {
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: 0x39d0ff,
            emissive: 0x1a6a8a,
            roughness: 0.3,
          }),
        );
        mesh.position.set(point.x, point.y, point.z);
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.pickupMeshes.push(mesh);
      }
    }

    for (let i = 0; i < this.pickupMeshes.length; i++) {
      const mesh = this.pickupMeshes[i];
      // Amig nincs snapshot, mutassuk felvehetőnek: igy offline es
      // csatlakozas elott sem tunik el a palya fele.
      mesh.visible = available[i] ?? true;
      if (!mesh.visible) continue;

      // Lassu forgas es lebegés -- IDOFUGGO, nem kepkocka-fuggo.
      mesh.rotation.y = (now / 1000) * 1.2;
      mesh.position.y = PICKUP_HEIGHT + Math.sin(now / 400) * 0.15;
    }
  }

  // --- Robbanas-effekt ---

  /**
   * Mennyi ideig (ms) tart a robbanas latvanya.
   *
   * Rovid: a jatekos a talalatot akarja latni, nem egy hosszan alldogalo
   * felhot. A lokes (EXPLOSION_MAX_PUSH) ennel is gyorsabban lezajlik.
   */
  private static readonly EXPLOSION_VFX_MS = 650;

  private readonly explosions: {
    group: THREE.Group;
    core: THREE.Mesh;
    shock: THREE.Mesh;
    startedAt: number;
  }[] = [];

  private explosionGeometry: {
    core: THREE.SphereGeometry;
    shock: THREE.RingGeometry;
  } | null = null;

  /**
   * Robbanas a megadott pontban.
   *
   * A meret a VALODI hatosugarhoz (EXPLOSION_RADIUS) igazodik, nem egy
   * kulon "latvany-merethez": igy a jatekos abbol, amit lat, meg tudja
   * itelni, mi esett bele a robbanasba es mi nem. Egy tetszolegesen
   * valasztott sugar itt aktivan felrevezetne.
   */
  spawnExplosion(position: [number, number, number], now: number): void {
    if (!this.explosionGeometry) {
      this.explosionGeometry = {
        core: new THREE.SphereGeometry(1, 16, 12),
        // A lokeshullam a talajon terjed szet -- vizszintes gyuru.
        shock: new THREE.RingGeometry(0.86, 1, 32),
      };
    }

    const group = new THREE.Group();
    group.position.set(...position);

    // Kulon anyag effektenkent: az atlatszosagot es a szint egyedileg
    // animaljuk, tehat nem lehet kozos (az osztott anyag minden
    // egyidejuleg futo robbanast egyszerre halvanyitana).
    const core = new THREE.Mesh(
      this.explosionGeometry.core,
      new THREE.MeshBasicMaterial({
        color: 0xffb040,
        transparent: true,
        opacity: 1,
        depthWrite: false,
      }),
    );
    group.add(core);

    const shock = new THREE.Mesh(
      this.explosionGeometry.shock,
      new THREE.MeshBasicMaterial({
        color: 0xffd890,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    shock.rotation.x = -Math.PI / 2;
    group.add(shock);

    this.scene.add(group);
    this.explosions.push({ group, core, shock, startedAt: now });
    this.explosionTotal++;
  }

  /** Hany robbanas-effekt fut eppen. */
  explosionCount(): number {
    return this.explosions.length;
  }

  /**
   * Hany robbanas indult el OSSZESEN (monoton no).
   *
   * A tesztek ezt figyeljek, ne a fenti pillanatnyi darabszamot: egy
   * effekt csak 650 ms-ig el, tehat egy kesobbi mintavetel mar nem
   * latja. Pontosan ez tortent -- a teszt "nem volt robbanas"-t
   * jelentett olyan futasban, ahol a robbanas rendben lezajlott.
   */
  get explosionsSpawned(): number {
    return this.explosionTotal;
  }

  private explosionTotal = 0;

  /**
   * A futo robbanasok leptetese. A render-ciklusbol hivando.
   *
   * IDOFUGGO, nem kepkocka-fuggo: a headless teszt ~9 fps-en fut, a
   * jatek 60+ fps-en -- kepkockankenti lepessel a kettő teljesen mas
   * hosszu robbanast adna.
   */
  /**
   * Nyomjelzo csik elettartama (ms).
   *
   * SZANDEKOSAN nagyon rovid: 11 loves/mp mellett igy egyszerre kb. egy
   * csik latszik lovonkent, ami surun villano vonalsorozatnak olvasodik.
   * Hosszabb elettartamnal folytonos, vastag gerenda lenne belole.
   */
  private static readonly TRACER_MS = 70;

  private readonly tracers: {
    line: THREE.Line;
    material: THREE.LineBasicMaterial;
    startedAt: number;
  }[] = [];

  private tracerTotal = 0;

  /** Osszesen hany nyomjelzo indult -- MONOTON, a tesztek ebbol merik. */
  get tracersSpawned(): number {
    return this.tracerTotal;
  }

  /**
   * Gepfegyver-loves kirajzolasa.
   *
   * A ket vegpontot a SZERVER adja: a csotorkolatot es azt a pontot,
   * ahol a loves veget ert (auto, fal vagy a hatotav vege). Igy a csik
   * pontosan addig tart, ameddig a talalat is szamitott -- nem a kliens
   * talalgat.
   */
  spawnTracer(
    from: [number, number, number],
    to: [number, number, number],
    hit: boolean,
    now: number,
  ): void {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...from),
      new THREE.Vector3(...to),
    ]);
    const material = new THREE.LineBasicMaterial({
      // Talalatnal melegebb szin: a visszajelzes fontosabb, mint a
      // realizmus -- lovoldozes kozben ebbol latni, hogy fog-e a celzas.
      color: hit ? 0xffd070 : 0x9fd0ff,
      transparent: true,
      opacity: hit ? 1 : 0.7,
      depthWrite: false,
    });

    const line = new THREE.Line(geometry, material);
    this.scene.add(line);
    this.tracers.push({ line, material, startedAt: now });
    this.tracerTotal++;
  }

  /** A nyomjelzok halvanyitasa es eltakaritasa. */
  updateTracers(now: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i];
      const t = (now - tracer.startedAt) / SceneView.TRACER_MS;

      if (t >= 1) {
        this.scene.remove(tracer.line);
        tracer.line.geometry.dispose();
        tracer.material.dispose();
        this.tracers.splice(i, 1);
        continue;
      }
      tracer.material.opacity = (1 - t) * (tracer.material.color.r > 0.9 ? 1 : 0.7);
    }
  }

  updateExplosions(now: number): void {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const fx = this.explosions[i];
      const t = (now - fx.startedAt) / SceneView.EXPLOSION_VFX_MS;

      if (t >= 1) {
        this.scene.remove(fx.group);
        (fx.core.material as THREE.Material).dispose();
        (fx.shock.material as THREE.Material).dispose();
        this.explosions.splice(i, 1);
        continue;
      }

      // A mag gyorsan felfujodik, majd elhal: a felfutas az elso
      // negyedben tortenik, hogy a becsapodas pillanata legyen a
      // leghangsulyosabb.
      const coreGrow = Math.min(t / 0.25, 1);
      const coreRadius = EXPLOSION_RADIUS * (0.25 + 0.35 * coreGrow);
      fx.core.scale.setScalar(coreRadius);
      (fx.core.material as THREE.MeshBasicMaterial).opacity = (1 - t) * (1 - t);

      // A lokeshullam vegig a TELJES hatosugarig fut ki -- ez mutatja
      // meg, meddig ert el a sebzes.
      fx.shock.scale.setScalar(EXPLOSION_RADIUS * t);
      (fx.shock.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
    }
  }

  // --- Tavoli (halozati) jatekosok autoi ---

  /**
   * Szinek a tavoli autokhoz, hogy megkulonboztethetok legyenek a
   * sajatunktol (ami a modell eredeti sarga szinet tartja meg).
   */
  private static readonly REMOTE_COLORS = [
    0x3b82f6, 0xef4444, 0x22c55e, 0xa855f7, 0xf97316, 0x14b8a6, 0xec4899,
  ];

  /**
   * HP-sav egy tavoli auto fole.
   *
   * Sprite (billboard): mindig a kamera fele nez, tehat barhonnan
   * olvashato. A tartalmat egy kis vaszonra rajzoljuk, es CSAK akkor
   * frissitjuk, ha valtozott a HP -- kepkockankent ujrarajzolni
   * feleslegesen terhelne a GPU-t (textura-feltoltes minden frame-ben).
   */
  private createHpBar(): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 32;

    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        // Ne takarja el a palya: a HP mindig legyen lathato, akkor is,
        // ha az auto egy lada mogott van.
        depthTest: false,
      }),
    );
    sprite.scale.set(2.2, 0.55, 1);
    sprite.renderOrder = 999;
    return sprite;
  }

  /**
   * Nevtabla az auto folott.
   *
   * Ugyanaz a billboard-technika, mint a HP-savnal: vaszonra rajzolt
   * szoveg sprite-kent. A nev igy mindig a kamera fele nez, es nem kell
   * kulon HTML-reteget pozicionalni a 3D-s jelenet fole.
   *
   * A szoveget SZOVEGKENT rajzoljuk (fillText), nem HTML-be szurjuk --
   * egy masik jatekos neve tehat nem tud jelolest injektalni.
   */
  private createNameTag(): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 48;

    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
    );
    sprite.scale.set(3.4, 0.64, 1);
    sprite.renderOrder = 999;
    return sprite;
  }

  private drawNameTag(sprite: THREE.Sprite, name: string): void {
    const texture = (sprite.material as THREE.SpriteMaterial).map;
    if (!texture) return;
    const canvas = texture.image as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = "bold 26px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Sotet korvonal: a nev vilagos es sotet hattér elott is olvashato
    // marad, kulon hatterdoboz nelkul (az takarna a palyat).
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(1, 4, 9, 0.9)";
    ctx.strokeText(name, canvas.width / 2, canvas.height / 2);
    ctx.fillStyle = "#e6edf3";
    ctx.fillText(name, canvas.width / 2, canvas.height / 2);

    texture.needsUpdate = true;
  }

  private drawHpBar(sprite: THREE.Sprite, hp: number): void {
    const texture = (sprite.material as THREE.SpriteMaterial).map;
    if (!texture) return;
    const canvas = texture.image as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ratio = Math.max(0, Math.min(1, hp / MAX_HP));
    const pad = 3;
    const w = canvas.width - pad * 2;
    const h = canvas.height - pad * 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Hatter + keret, hogy vilagos hattér elott is olvashato legyen.
    ctx.fillStyle = "rgba(13, 17, 23, 0.75)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

    // Ugyanaz a harom sav, mint a HUD-on (zold / sarga / piros).
    ctx.fillStyle = ratio > 0.6 ? "#3fb950" : ratio > 0.25 ? "#d29922" : "#f85149";
    ctx.fillRect(pad, pad, w * ratio, h);

    ctx.font = "bold 18px ui-monospace, Consolas, monospace";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.round(hp)}`, canvas.width / 2, canvas.height / 2 + 1);

    texture.needsUpdate = true;
  }

  /**
   * A tavoli auto HP-savjanak frissitese (csak valtozaskor rajzol), es
   * a megsemmisult auto elrejtese.
   *
   * 0 HP-nal a kocsi eltunik a palyarol -- ugyanugy, ahogy a szerver is
   * kiveszi az utkozes-kiertekelesbol. Enelkul egy "roncs" maradna a
   * palyan, aminek se sebzese, se utkozese nincs, de latszik.
   */
  /** A tavoli auto folotti nevtabla szovege. */
  setRemoteName(id: string, name: string): void {
    const car = this.remoteCars.get(id);
    if (!car || car.shownName === name) return;
    car.shownName = name;
    this.drawNameTag(car.nameTag, name);
  }

  setRemoteHp(id: string, hp: number | null, now: number): void {
    const car = this.remoteCars.get(id);
    if (!car || hp === null) return;

    if (hp > 0) {
      // Elo (vagy ujraszuletett) auto.
      car.diedAt = null;
      car.wrapper.visible = true;
      car.hpBar.visible = true;
      car.nameTag.visible = true;
      if (car.shownHp !== hp) {
        car.shownHp = hp;
        this.drawHpBar(car.hpBar, hp);
      }
      return;
    }

    // Megsemmisult. A HP-sav azonnal eltunik (a 0 HP-t nem kell
    // kirajzolni), a RONCS viszont marad meg egy pillanatra.
    if (car.diedAt === null) {
      car.diedAt = now;
      car.shownHp = 0;
      car.hpBar.visible = false;
      car.nameTag.visible = false;
    }
    // A roncs csak a robbanas utan tunik el. Enelkul a kocsi ugyanabban
    // a kepkockaban pattant ki a vilagbol, amelyikben meghalt -- a
    // jatekos ezt "egyszeruen eltunt"-kent latta, nem megsemmisulesnek.
    car.wrapper.visible = now - car.diedAt < SceneView.WRECK_LINGER_MS;
  }

  /**
   * Meddig marad meg a roncs a megsemmisules utan (ms).
   *
   * A robbanas 650 ms; a roncs valamivel tovabb marad, hogy a
   * jatekosnak legyen ideje osszekapcsolni a kettot. A FIZIKAI teste
   * viszont AZONNAL megszunik -- azon a rovid szakaszon at lehet hajtani
   * rajta, ami sokkal kevesbe zavaro, mint egy lathatatlan akadaly.
   */
  private static readonly WRECK_LINGER_MS = 900;

  /** Megsemmisult-e a tavoli auto (a fizikai teste ilyenkor nem kell). */
  isRemoteCarAlive(id: string): boolean {
    const car = this.remoteCars.get(id);
    return car === undefined || car.shownHp !== 0;
  }

  hasRemoteCar(id: string): boolean {
    return this.remoteCars.has(id);
  }

  get remoteCarCount(): number {
    return this.remoteCars.size;
  }

  /**
   * Egy tavoli auto KIRAJZOLT transzformja -- a nezomodhoz.
   *
   * Kiesett jatekosnal a kamera egy meg elo jatekost kovet, es ehhez
   * ugyanaz az `updateCamera` hasznalhato, mint sajat autonal: a
   * kamera nem tudja, kit kovet.
   */
  remoteCarTransform(id: string): Transform | null {
    const car = this.remoteCars.get(id);
    if (!car) return null;
    return {
      position: [car.wrapper.position.x, car.wrapper.position.y, car.wrapper.position.z],
      quaternion: [
        car.wrapper.quaternion.x,
        car.wrapper.quaternion.y,
        car.wrapper.quaternion.z,
        car.wrapper.quaternion.w,
      ],
    };
  }

  /**
   * A SAJAT autonk lathatosaga.
   *
   * Kieses utan elrejtjuk: a jatekos nezo lesz, es a sajat roncsa csak
   * takarna a kilatast. (A tobbiek amugy is elrejtettek mar, mert a
   * szerver megsemmisultkent kuldi.)
   */
  setOwnCarVisible(visible: boolean): void {
    this.chassisMesh.visible = visible;
    for (const wheel of this.wheelGroups) wheel.visible = visible;
  }

  /** Latszik-e a sajat autonk -- a tesztek ezt olvassak. */
  get ownCarVisible(): boolean {
    return this.chassisMesh.visible;
  }

  remoteCarIds(): string[] {
    return [...this.remoteCars.keys()];
  }

  /**
   * Letrehoz egy tavoli autot. A modell origoja talajszinten van, a
   * halozaton viszont a chassis-doboz KOZEPPONTJA erkezik -- ezert a
   * teljes klon egy wrapperbe kerul, -halfExtents.y eltolassal
   * (ugyanaz a korrekcio, mint a sajat autonknal).
   */
  addRemoteCar(id: string): void {
    if (this.remoteCars.has(id)) return;

    const car = this.remoteTemplate.clone(true);
    car.position.y -= CHASSIS.halfExtents.y;

    // A karosszeria-anyag sajat peldanya kell, kulonben az atszinezes
    // az osszes tobbi autora (es a sajatunkra) is atterjedne.
    const colorIndex = this.remoteCars.size % SceneView.REMOTE_COLORS.length;
    const color = SceneView.REMOTE_COLORS[colorIndex];
    car.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material;
      if (Array.isArray(material)) return; // lampak: hagyjuk eredetiben
      if (!(material as THREE.MeshStandardMaterial).name.startsWith("Body")) return;
      const tinted = (material as THREE.MeshStandardMaterial).clone();
      tinted.color.setHex(color);
      // A karosszeria-textura (SedanYellow) elnyomna a szinezest.
      tinted.map = null;
      mesh.material = tinted;
    });

    const wrapper = new THREE.Group();
    wrapper.add(car);
    this.enableShadows(wrapper);

    // Rakétaveto a tavoli autora is: igy latszik, ha ranK celoznak.
    const launcher = this.createLauncher();
    launcher.root.position.y = LAUNCHER_HEIGHT;
    wrapper.add(launcher.root);

    this.scene.add(wrapper);

    // A kerek-node-ok a klonon belul ugyanazokat a neveket viselik.
    // A nyugalmi Y-t elmentjuk: a rugo-elmozdulast EHHEZ KEPEST
    // alkalmazzuk, igy nyugalomban pontosan a modell eredeti (vizualisan
    // mar ellenorzott) poziciojat kapjuk vissza, es nem kell a fizika
    // abszolut felfuggesztes-geometriajat rekonstrualni.
    const wheels: THREE.Object3D[] = [];
    const wheelRestY: number[] = [];
    const wheelMeshes: THREE.Mesh[] = [];
    for (const name of WHEEL_NODE_NAMES) {
      const node = car.getObjectByName(name);
      if (!node) continue;
      wheels.push(node);
      wheelRestY.push(node.position.y);

      // Sajat anyag-peldany kerekenkent: a serules-szinezes kulonben
      // atterjedne a tobbi kerekre, sot a tobbi auto kerekeire is (a
      // klonok kozos anyagot hasznalnak).
      const mesh = this.findFirstMesh(node);
      if (mesh) {
        mesh.material = (mesh.material as THREE.MeshStandardMaterial).clone();
        wheelMeshes.push(mesh);
      }
    }

    // A HP-sav NEM a wrapper gyereke: az egyutt forogna az autoval, es
    // felborulaskor a kocsi ALA kerulne. Kulon all a jelenetben, es
    // minden frame-ben az auto fole visszuk (lasd updateRemoteCar).
    const hpBar = this.createHpBar();
    this.scene.add(hpBar);
    // Nevtabla a HP-sav folott, ugyanezzel a logikaval.
    const nameTag = this.createNameTag();
    this.scene.add(nameTag);

    this.remoteCars.set(id, {
      wrapper,
      wheels,
      wheelMeshes,
      wheelRestY,
      launcher,
      hpBar,
      nameTag,
      shownName: "",
      shownHp: -1,
      diedAt: null,
      rollAngle: 0,
      prevPos: null,
    });
    this.drawHpBar(hpBar, MAX_HP);
  }

  removeRemoteCar(id: string): void {
    const car = this.remoteCars.get(id);
    if (!car) return;
    this.scene.remove(car.wrapper);
    // A HP-sav kulon all a jelenetben, ezert kulon is kell eltavolitani,
    // es a sajat texturajat/anyagat felszabaditani.
    for (const sprite of [car.hpBar, car.nameTag]) {
      this.scene.remove(sprite);
      const material = sprite.material as THREE.SpriteMaterial;
      material.map?.dispose();
      material.dispose();
    }
    this.remoteCars.delete(id);
  }

  /**
   * Egy tavoli auto latvanyanak frissitese.
   *
   * A kerekek harom dolgot csinalnak, ugyanazzal a konvencioval, mint a
   * sajat autonknal (lasd rapier.ts getWheels): kormanyoznak (Y tengely),
   * gordulnek (AXLE tengely), es a rugo mozgatja oket fuggolegesen.
   * A gordulesi szoget NEM a halozatbol kapjuk, hanem a TENYLEGESEN
   * MEGTETT UTBOL szamoljuk -- lasd WheelVisualState a protokollban.
   */
  updateRemoteCar(id: string, state: RemoteVisualState): void {
    const car = this.remoteCars.get(id);
    if (!car) return;

    // Gordules: a ket frame kozotti elmozdulas vetulete az orr iranyara,
    // osztva a kerek sugaraval (r sugaru kerek d utat megteve d/r
    // radiant fordul). SZANDEKOSAN nem "sebesseg * dt" integralas: az
    // elveszitene az idot, ha a lap hattérbe kerul vagy akad (a frameDt
    // felso hataron vagva van), es a kerekek lathatoan alulporognenek.
    // A pozicio-kulonbseg viszont kepkockaszamtol FUGGETLENUL pontos.
    if (car.prevPos) {
      const delta = this.tmpVec2.subVectors(state.position, car.prevPos);
      const forward = this.tmpVec.set(0, 0, -1).applyQuaternion(state.quaternion);
      const travelled = forward.dot(delta);
      // Ujraszuletes/teleportalas eseten az ugras nem valodi gordules.
      if (Math.abs(travelled) < 5) {
        car.rollAngle += travelled / WHEEL.radius;
      }
      car.prevPos.copy(state.position);
    } else {
      car.prevPos = state.position.clone();
    }

    car.wrapper.position.copy(state.position);
    car.wrapper.quaternion.copy(state.quaternion);
    this.aimLauncher(car.launcher, state.quaternion, state.aimYaw, state.aimPitch);

    // A HP-sav az auto FOLE kerul, fuggolegesen -- fuggetlenul attol,
    // hogy a kocsi eppen hogyan all (lasd a letrehozasnal).
    car.hpBar.position.set(
      state.position.x,
      state.position.y + HP_BAR_HEIGHT,
      state.position.z,
    );
    car.nameTag.position.set(
      state.position.x,
      state.position.y + NAME_TAG_HEIGHT,
      state.position.z,
    );

    for (let i = 0; i < car.wheels.length; i++) {
      const wheel = car.wheels[i];
      const steered = WHEEL_LAYOUT[i]?.steered ?? false;

      // Rugo: nagyobb hossz = lejjebb allo kerek (a felfuggesztes lefele
      // mutat). A nyugalmi hosszhoz kepesti elteres hat.
      const travel = state.susp[i] - WHEEL.suspensionRestLength;
      wheel.position.y = car.wheelRestY[i] - travel;

      this.tmpQuat.setFromAxisAngle(SceneView.UP, steered ? state.steer : 0);
      this.tmpRollQuat.setFromAxisAngle(SceneView.AXLE, car.rollAngle);
      wheel.quaternion.copy(this.tmpQuat).multiply(this.tmpRollQuat);

      // Serules: pontosan ugyanazok a szabalyok, mint a sajat autonknal
      // (kozos forras: wheelVisuals.ts).
      const mesh = car.wheelMeshes[i];
      if (!mesh) continue;
      const damage: WheelDamage = {
        hp: 0,
        broken: (state.brokenMask & (1 << i)) !== 0,
        gripMultiplier: state.grip[i],
      };
      const scale = wheelRadiusFor(damage) / WHEEL.radius;
      mesh.scale.set(1, scale, scale);
      (mesh.material as THREE.MeshStandardMaterial).color.setHex(
        wheelTintFor(damage),
      );
    }
  }

  /** A kerek forgastengelye a modell lokalis rendszereben (lasd rapier.ts AXLE). */
  private static readonly AXLE = new THREE.Vector3(-1, 0, 0);
  private static readonly UP = new THREE.Vector3(0, 1, 0);
  private tmpRollQuat = new THREE.Quaternion();
  private tmpVec2 = new THREE.Vector3();

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
      // A celzas ezekre a felszinekre vetit (lasd aimPointAt) -- a
      // jelenet tobbi eleme (autok, rakétak, HP-savok) nem lehet celpont.
      this.arenaMeshes.push(mesh);
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
      // A sugar valtozhat (defekt / letort gumi). A szabalyok kozosek a
      // tavoli autokkal -- lasd wheelVisuals.ts.
      const scale = w.radius / WHEEL.radius;
      mesh.scale.set(1, scale, scale);
      (mesh.material as THREE.MeshStandardMaterial).color.setHex(
        wheelTintFor(w.damage),
      );
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
