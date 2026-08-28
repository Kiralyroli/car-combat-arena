import * as THREE from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  WEAPON_MOUNT_HEIGHT,
  SPAWN_POINTS,
  ARENA_HALF,
  type ArenaBox,
  cameraClamp,
  SCENERY,
  PROP_MERETEK,
  ARENA,
  CAMERA,
  CAR_HULL_POINTS,
  CHASSIS,
  DEFAULT_WEAPON,
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
  type WeaponId,
  type WheelDamage,
  type WheelReadout,
} from "@cca/shared";

/** A jarmu-modell utvonala. Lasd EREDMENYEK.md: Sedan (generic-passenger-car-pack). */
const VEHICLE_MODEL_URL = "/models/sedan.glb";

/**
 * A tetőn ülő fegyverek modelljei -- FEGYVERENKENT MAS.
 *
 * Mindketto atdolgozott Sketchfab-modell: kb. 14 ezer haromszogre
 * ritkitva, 256-os texturakkal, es kettevagva forgo talpra
 * (Turret_Base) es bolinto fegyverre (Turret_Gun). A ket csomopont
 * neve SZANDEKOSAN azonos: a jatek ugyanugy kezeli oket, csak a
 * meretek ternek el (lasd WEAPON_MOUNTS). A forras es a feltuntetes a
 * CREDITS.md-ben.
 */
/** Az ipari epuletek egy fajlban, epuletenkent egy csomoponttal. */
const PROP_MODEL_URL = "/models/epuletek.glb";

const WEAPON_MODEL_URLS: Record<WeaponId, string> = {
  cannon: "/models/flak.glb",
  machinegun: "/models/turret.glb",
};

/**
 * Diszites nelkuli mod: `?dekor=0`.
 *
 * MIERT VAN: a panorama-eg es a texturazott talaj a kep MINDEN pixelen
 * dolgozik. Valodi videokartyan ez elhanyagolhato, a bongeszos tesztek
 * viszont szoftveres renderelovel (SwiftShader) futnak, ahol annyira
 * lelassult tole a lap, hogy a FIZIKA maradt le: az auto 3 masodperc
 * alatt 22 m helyett 2 m-t tett meg, es a rammeles-tesztek egyszeruen
 * nem tudtak osszehozni az utkozest.
 *
 * Ugyanaz a megfontolas, mint a BARE_ARENA-nal (config.ts): ami a
 * meresben nem szamit, az ne is befolyasolja a merest. A tesztek a
 * jatekmenetet es a halozatot vizsgaljak -- azoknak a talaj SZINE
 * kozombos. A latvanyt kulon, kepernyokepekkel ellenorizzuk.
 *
 * A jatekosok soha nem latjak ezt: kizarolag a tesztek adjak meg.
 */
function dekoracioBe(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("dekor") !== "0";
  } catch {
    return true;
  }
}

const WHEEL_NODE_NAMES = ["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"] as const;

/** Milyen magasan lebegjen a HP-sav az auto kozeppontja felett (m). */
const HP_BAR_HEIGHT = CHASSIS.halfExtents.y + 1.4;

/** A nevtabla a HP-sav FOLE kerul, hogy a ketto ne fedje egymast. */
const NAME_TAG_HEIGHT = HP_BAR_HEIGHT + 0.7;

/**
 * A fegyver meretei a KOZOS forrasbol jonnek (WEAPON_MOUNT_HEIGHT).
 *
 * Korabban itt sajat szamok alltak, a loves kiindulopontja pedig
 * mashonnan szamolodott -- ezert jott a loves a lokharito magassagabol
 * a tetőn ülő cso helyett. Egy forras, ket felhasznalo.
 */
const LAUNCHER_HEIGHT = WEAPON_MOUNT_HEIGHT;

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
  /**
   * A karosszeria jelenlegi szine.
   *
   * Azert taroljuk, hogy a kepkockankenti igazitas (setRemoteColor)
   * felesleges anyag-klonozas nelkul tudjon nemleges valaszt adni.
   */
  colorHex: number;
  /** Kerek-node-ok FL, FR, RL, RR sorrendben (= WHEEL_LAYOUT). */
  wheels: THREE.Object3D[];
  /** Kerekenkent a szinezendo mesh -- sajat anyag-peldannyal. */
  wheelMeshes: THREE.Mesh[];
  /** A kerekek nyugalmi lokalis Y-koordinataja (a rugo-elmozdulas ehhez kepest hat). */
  wheelRestY: number[];
  /** Fegyver a tetőn -- a celzas iranyaba fordul. */
  launcher: { root: THREE.Group; tube: THREE.Object3D };
  /**
   * Melyik fegyver modellje all rajta most.
   *
   * A jatekos ujraszuleteskor valthat fegyvert, tehat a modellt menet
   * kozben ki kell tudni cserelni -- ehhez tudni kell, mi van kint.
   */
  weapon: WeaponId;
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
  /** Fegyverenkenti torony-sablon -- minden auto ebbol kap egy klont. */
  private weaponTemplates = {} as Record<WeaponId, THREE.Object3D>;
  /** Epulet-sablonok nev szerint -- minden elhelyezes ezek klonja. */
  private propTemplates = new Map<string, THREE.Object3D>();
  /** A palya doboz-meshei nev szerint -- a modellre csereleshez. */
  private arenaBoxMeshes = new Map<string, THREE.Mesh>();
  private remoteCars = new Map<string, RemoteCar>();
  /** A sajat autonk fegyvere (a tetőn). */
  private launcher!: { root: THREE.Group; tube: THREE.Object3D };
  /** Melyik fegyver modellje all most a sajat autonkon. */
  private ownWeapon: WeaponId = DEFAULT_WEAPON;

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
    // NAPPALI, poros ipari udvar.
    //
    // A korabbi majdnem-fekete (0x0d1117) egy sotet, semleges dobozos
    // arenahoz keszult. A homok-talajjal az nem all ossze: vilagos
    // foldon sotet eg csak akkor van, ha vihar jon.
    //
    // A KOD SZINE megegyezik az egevel: igy a tavoli targyak nem egy
    // masik szinbe olvadnak bele, hanem eltunni latszanak a porban.
    // Kezdete 70 m -- azon tul mar amugy sem lehet eltalalni senkit
    // (a gepfegyver hatotava 70 m), tehat a kod nem rejt el olyat,
    // amire lonel.
    // A KOD SZINE a panorama-eg HORIZONTJAROL van mintaveve (0xabb1c1),
    // nem talalgatva: igy a tavoli targyak nem egy masik szinbe olvadnak
    // bele, hanem eltunni latszanak a porban.
    //
    // A hatter ELOSZOR sima szin -- ha a panorama betolt, az veszi at
    // (lasd loadSky). Ha nem tolt be, ez marad, es a jatek megy tovabb.
    this.scene.background = new THREE.Color(0xabb1c1);
    // LATOTAVOLSAG.
    //
    // A kod korabban 70 m-nel kezdodott -- azzal a megfontolassal, hogy
    // azon tul ugysem lehet eltalalni senkit. Csakhogy a palyat
    // mostantol epuletek hatarolják, mogottuk pedig egy ipari negyed
    // all: azt latni AKARJUK. A koddal igy csak a legtavolabbi hattert
    // lagyitjuk, nem a jatekteret.
    this.scene.fog = new THREE.Fog(0xabb1c1, 220, 700);
    if (dekoracioBe()) this.loadSky();

    this.camera = new THREE.PerspectiveCamera(
      62,
      Math.max(window.innerWidth, 1) / Math.max(window.innerHeight, 1),
      0.1,
      // A tavoli latkep (eromu, gyarepuletek) 300 m-en tul is all.
      1200,
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

    // MINDKET fegyver modelljet ugyanitt toltjuk be: mire az elso auto
    // felepul, keszen kell allniuk, kulonben fegyver nelkuli autok
    // jelennenek meg. Parhuzamosan toltjuk -- a ket keres egymastol
    // fuggetlen, sorban varakozva feleslegesen lassitana az inditast.
    const weapons = Object.keys(WEAPON_MODEL_URLS) as WeaponId[];
    const loaded = await Promise.all(
      weapons.map((w) => loader.loadAsync(WEAPON_MODEL_URLS[w])),
    );
    // A DISZITES nelkuli modban (?dekor=0) az epuletek is kimaradnak.
    //
    // Az UTKOZO DOBOZOK ugyanazok maradnak -- a jatekmenet betu szerint
    // azonos --, csak szurke teglakent latszanak. A teszteknek pont ez
    // kell: 17 texturazott epulet a szoftveres rendereloben ujra annyira
    // lelassitotta a lapot, hogy a rammeles-tesztek nem tudtak
    // osszehozni az utkozest.
    if (dekoracioBe()) {
      this.buildOuterGround();
      await this.loadProps(loader);
      this.swapProps();
      this.buildScenery();
    }

    weapons.forEach((weapon, i) => {
      const url = WEAPON_MODEL_URLS[weapon];
      const base = loaded[i].scene.getObjectByName("Turret_Base");
      if (!base) {
        throw new Error(`Turret_Base csomopont nem talalhato: ${url}`);
      }
      this.weaponTemplates[weapon] = base;
    });

    // Wrapper: a fizika ezt mozgatja/forgatja. A Body sajat origoja a
    // modellben talajszinten van, a fizika viszont a doboz KOZEPPONTJAT
    // szamolja -- ezert a Body -halfExtents.y lokalis eltolassal kerul
    // a wrapperbe.
    const chassisWrapper = new THREE.Group();
    body.position.y -= CHASSIS.halfExtents.y;
    chassisWrapper.add(body);

    // Fegyver a tetőre. A jarmu GYEREKE, tehat egyutt mozog es dol
    // vele -- csak a celzas-irany szamolodik le rola (lasd aimLauncher).
    this.launcher = this.createLauncher(this.ownWeapon);
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
   * A tetőn ülő fegyver egy peldanya.
   *
   * MINDKET modell (turret.glb, flak.glb) ugyanabbol a KET csomopontbol
   * all, es pontosan azt a szerkezetet hozza, amire a celzas epul:
   *   Turret_Base -- forgo talp (yaw),
   *   Turret_Gun  -- benne bolinto fegyver (pitch), a talp gyereke.
   *
   * A meretek a WEAPON_MOUNTS-ban vannak, fegyverenkent MERVE a
   * modellbol. Ha egy modell cserelodik, azokat ujra kell merni --
   * kulonben a loves nem a csobol indulna.
   */
  private createLauncher(
    weapon: WeaponId,
  ): { root: THREE.Group; tube: THREE.Object3D } {
    // clone(true): a geometriak es anyagok kozosek maradnak, csak az
    // objektum-graf masolodik -- nyolc jatekosnal ez szamit.
    const root = this.weaponTemplates[weapon].clone(true) as THREE.Group;
    const tube = root.getObjectByName("Turret_Gun");
    if (!tube) {
      throw new Error(
        `Turret_Gun csomopont nem talalhato: ${WEAPON_MODEL_URLS[weapon]}`,
      );
    }
    this.enableShadows(root);
    return { root, tube };
  }


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

  /**
   * Amire a celzas vetit: a palya feluletei.
   *
   * Object3D es nem Mesh: a doboz-elemek meshek, az EPULETEK viszont
   * tobb reszbol allo csomopontok (falak, homlokzat kulon anyaggal).
   */
  private readonly arenaMeshes: THREE.Object3D[] = [];
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

  // Object3D, nem Mesh: az elet-pickup kereszt alaku, tehat CSOPORT
  // (ket hasabbol), a boost viszont egyetlen oktaeder.
  private pickupMeshes: THREE.Object3D[] = [];

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
      const boostGeometry = new THREE.OctahedronGeometry(0.7);
      // Az ELET keresztet formaz, es zold. KET jelzes egyszerre (alak
      // ES szin): a szin magaban szinvakoknak nem elegendo, az alak
      // pedig messzirol, apró meretben mosodik el.
      const armLong = new THREE.BoxGeometry(1.5, 0.45, 0.45);
      const armShort = new THREE.BoxGeometry(0.45, 1.5, 0.45);

      for (const point of PICKUP_POINTS) {
        const health = point.kind === "health";
        const material = new THREE.MeshStandardMaterial({
          color: health ? 0x3fb950 : 0x39d0ff,
          emissive: health ? 0x1d5c2a : 0x1a6a8a,
          roughness: 0.3,
        });

        const object: THREE.Object3D = health
          ? new THREE.Group()
          : new THREE.Mesh(boostGeometry, material);
        if (health) {
          object.add(new THREE.Mesh(armLong, material));
          object.add(new THREE.Mesh(armShort, material));
        }

        object.position.set(point.x, point.y, point.z);
        this.enableShadows(object);
        this.scene.add(object);
        this.pickupMeshes.push(object);
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

  // --- Ujraszuletesi pajzs ---
  //
  // A frissen szuletett jatekos rovid ideig serthetetlen (lasd
  // SPAWN_PROTECTION_MS). Ezt LATNI kell -- kulonben a tamado csak
  // annyit tapasztalna, hogy a talalatai nem fognak, es azt hinne,
  // hibas a jatek.
  //
  // SZANDEKOSAN kulon buborek, es nem az auto attetszove tetele: az
  // autok kozos anyagokon osztoznak (csak a karosszeria-szin sajat),
  // tehat az atlatszosag atterjedne a tobbi autora is.

  private shieldGeometry: THREE.SphereGeometry | null = null;

  private readonly shields = new Map<
    string,
    { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial }
  >();

  /** A sajat autonk pajzsa; a kulcs SZANDEKOSAN nem lehet jatekos-id. */
  private static readonly OWN_SHIELD = "#own";

  setOwnProtected(active: boolean): void {
    this.setShield(SceneView.OWN_SHIELD, this.chassisMesh, active);
  }

  setRemoteProtected(id: string, active: boolean): void {
    const car = this.remoteCars.get(id);
    if (!car) return;
    this.setShield(id, car.wrapper, active);
  }

  /** Hany pajzs lathato eppen -- a tesztek ezt olvassak. */
  get shieldsActive(): number {
    return this.shields.size;
  }

  private setShield(key: string, parent: THREE.Object3D, active: boolean): void {
    const existing = this.shields.get(key);
    if (!active) {
      if (!existing) return;
      existing.mesh.removeFromParent();
      existing.material.dispose();
      this.shields.delete(key);
      return;
    }
    if (existing) {
      // Mar van, de gazdat valthatott (ujra hozzaadott tavoli auto).
      if (existing.mesh.parent !== parent) parent.add(existing.mesh);
      return;
    }

    if (!this.shieldGeometry) {
      // Akkora, hogy az egesz autot befedje (a kocsi kb. 4.9 m hosszu).
      this.shieldGeometry = new THREE.SphereGeometry(3, 20, 14);
    }
    const material = new THREE.MeshBasicMaterial({
      color: 0x6fd3ff,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.shieldGeometry, material);
    mesh.position.y = CHASSIS.halfExtents.y;
    parent.add(mesh);
    this.shields.set(key, { mesh, material });
  }

  /**
   * A pajzsok lüktetese.
   *
   * Nem diszites: a mozgo feluletet a szem akkor is eszreveszi, ha a
   * kocsi eppen all -- egy statikus, halvany gomb konnyen elveszne a
   * jelenetben.
   */
  updateShields(now: number): void {
    const pulse = 0.14 + 0.07 * Math.sin(now / 120);
    for (const shield of this.shields.values()) {
      shield.material.opacity = pulse;
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

  /**
   * A karosszeria atszinezese.
   *
   * Az anyag SAJAT PELDANYT kap: a betoltott modell anyagain minden
   * auto osztozik (a clone(true) csak az objektum-grafot masolja), tehat
   * a helyben valo atszinezes az OSSZES tobbi autora atterjedne.
   *
   * Csak a "Body" nevu anyagokat erinti -- a lampak, uveg es gumik
   * maradnak eredetiben.
   */
  private tintBody(root: THREE.Object3D, hex: number): void {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material;
      if (Array.isArray(material)) return; // lampak: hagyjuk eredetiben
      if (!(material as THREE.MeshStandardMaterial).name.startsWith("Body")) return;
      const tinted = (material as THREE.MeshStandardMaterial).clone();
      tinted.color.setHex(hex);
      // A karosszeria-textura (SedanYellow) elnyomna a szinezest.
      tinted.map = null;
      mesh.material = tinted;
    });
  }

  /**
   * Egy tavoli auto szinenek igazitasa a szerverhez.
   *
   * Kepkockankent hivhato: ha nem valtozott, azonnal visszater. AZERT
   * fut folyamatosan, mert a szin tobb uton is megerkezhet (playerJoined
   * uzenet vagy snapshot), es a "joined" uzenet a mar bent levokrol meg
   * nem hozza -- igy barmelyik ut is marad el, a szin helyreall.
   */
  setRemoteColor(id: string, hex: number): void {
    const car = this.remoteCars.get(id);
    if (!car || car.colorHex === hex) return;
    car.colorHex = hex;
    this.tintBody(car.wrapper, hex);
  }

  /**
   * A tavoli auto fegyver-modelljenek csereje.
   *
   * A jatekos ujraszuleteskor valthat fegyvert, tehat a torony nem
   * allando: ki kell cserelni, kulonben az agyus ellenfel tovabbra is
   * gepfegyverrel latszana -- es a jatekos abbol olvassa ki, mire
   * szamitson tole.
   */
  setRemoteWeapon(id: string, weapon: WeaponId): void {
    const car = this.remoteCars.get(id);
    if (!car || car.weapon === weapon) return;
    // A regi torony geometriait/anyagait NEM szabaditjuk fel: a klon
    // OSZTOZIK rajtuk a sablonnal es a tobbi autoval (clone(true)) --
    // eldobva a tobbiek modellje tunne el. Csak a jelenetbol vesszuk ki.
    car.wrapper.remove(car.launcher.root);
    car.launcher = this.createLauncher(weapon);
    car.launcher.root.position.y = LAUNCHER_HEIGHT;
    car.wrapper.add(car.launcher.root);
    car.weapon = weapon;
  }

  /** Ugyanez a SAJAT autonkra. */
  setOwnWeapon(weapon: WeaponId): void {
    if (this.ownWeapon === weapon) return;
    this.ownWeapon = weapon;
    if (!this.chassisMesh) return;
    this.chassisMesh.remove(this.launcher.root);
    this.launcher = this.createLauncher(weapon);
    this.launcher.root.position.y = LAUNCHER_HEIGHT;
    this.chassisMesh.add(this.launcher.root);
  }

  /**
   * Ahogy EZ a kliens latja egy tavoli auto szinet -- vagy null.
   *
   * A tesztek ebbol ellenorzik, hogy ket kulon kliens ugyanazt latja-e;
   * a jatek maga nem hasznalja.
   */
  remoteCarColor(id: string): number | null {
    return this.remoteCars.get(id)?.colorHex ?? null;
  }

  private ownColorHex: number | null = null;

  /**
   * A SAJAT autonk szine.
   *
   * A szerver dönti el (lasd assignCarColor), tehat csak a belepes utan
   * derul ki -- az auto viszont mar a betolteskor felepul. Ezert kesobb
   * szinezzuk at, es csak akkor, ha tenylegesen valtozott: minden hivas
   * uj anyag-peldanyt keszitene.
   */
  setOwnColor(hex: number): void {
    if (hex === this.ownColorHex) return;
    this.ownColorHex = hex;
    this.tintBody(this.chassisMesh, hex);
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
  addRemoteCar(id: string, colorHex: number): void {
    if (this.remoteCars.has(id)) return;

    const car = this.remoteTemplate.clone(true);
    car.position.y -= CHASSIS.halfExtents.y;

    this.tintBody(car, colorHex);

    const wrapper = new THREE.Group();
    wrapper.add(car);
    this.enableShadows(wrapper);

    // Fegyver a tavoli autora is: igy latszik, ha rank celoznak. A
    // fegyver fajtajat a snapshotbol tudjuk meg (setRemoteWeapon), addig
    // az alapertelmezettel indul.
    const launcher = this.createLauncher(DEFAULT_WEAPON);
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
      colorHex,
      wheels,
      wheelMeshes,
      wheelRestY,
      launcher,
      weapon: DEFAULT_WEAPON,
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
    this.setShield(id, this.scene, false);

    // A hitbox is menjen vele, kulonben egy kilepett jatekos doboza
    // ottmaradna a palyan.
    const hb = this.carHitboxes.get(id);
    if (hb) {
      this.hitboxGroup?.remove(hb);
      for (const gy of hb.children) {
        const l = gy as THREE.LineSegments;
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      }
      this.carHitboxes.delete(id);
    }
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

    this.syncCarHitbox(id, state.position.toArray(), state.quaternion.toArray());

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
    // Eg + a TALAJROL visszaverodo feny. A also szin mostantol a
    // homok melegebb tonusa, nem a regi sotetszurke: a homokos udvaron
    // az arnyekban levo felulet alulrol is meleg fenyt kap.
    // A felgomb-feny MERSEKELVE, mert a panorama-eg (scene.environment)
    // maga is szort fenyt ad: a ketto egyutt kimosna a feluleteket. Ami
    // marad, az a TALAJROL visszaverodo meleg feny -- azt a panorama nem
    // tudja, mert nem a palyan keszult.
    this.scene.add(new THREE.HemisphereLight(0xcfe0f0, 0x8a7a63, 1.0));

    const sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
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

  /**
   * Panorama-eg hatternek ES kornyezeti fenynek.
   *
   * KET dolgot ad egyszerre:
   *  - HATTER: a fal folott eg latszik, nem egy sima szin. Nappali
   *    palyan ez a kulonbseg azonnal latszik.
   *  - KORNYEZETI FENY (scene.environment): a fem-jellegu feluletek --
   *    a fegyvertorony, a Flak -- eddig kornyezeti kep NELKUL
   *    vilagitottak, ezert laposan szurkek voltak. Ettol kapnak
   *    visszaverodest.
   *
   * A betoltes NEM allithatja meg a jatekot: hiba eseten marad a sima
   * szinu hatter, amit a konstruktor mar beallitott.
   */
  private loadSky(): void {
    new THREE.TextureLoader().load(
      "/textures/eg.webp",
      (tex) => {
        // Panorama (equirektangularis) kep: a Three.js ebbol tudja
        // gombbe hajlitani, kulon geometria nelkul.
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        // A Poly Haven panoramai a szokasos allasban vannak (a zenit a
        // kep tetejen), tehat NEM kell forditani. Az elozo, gomb-modellbe
        // csomagolt eg forditva allt -- es a horizont-savja ures volt,
        // ami epp az a resz, amit a jatekban latunk.
        this.scene.background = tex;

        // A KORNYEZETI FENYHEZ eloszurt valtozat kell, nem a nyers kep.
        //
        // A nyers panoramat kornyezetnek hasznalva minden felulet
        // minden kepkockan a teljes 2048-as textural mintavesz --
        // merve: a lap annyira lelassult tole, hogy a fizika lemaradt
        // (a check:ui-input szerint az auto 3 masodperc alatt 22 m
        // helyett 2.7 m-t tett meg). A PMREM egyszer, elore keszit
        // belole egy kicsi, elmosott valtozatot -- ez az, amire a
        // szort feny es a homalyos tukrozodes valojaban szuksege van.
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmrem.fromEquirectangular(tex).texture;
        pmrem.dispose();
      },
      undefined,
      () => {
        // Marad a sima szin -- lasd a konstruktort.
      },
    );
  }

  /**
   * A TALAJ anyaga: ismetelt homok-textura.
   *
   * Kulon kezeljuk a tobbi arena-elemtol, mert a talaj mas: egyetlen,
   * hatalmas (120 x 120 m) felulet, amin a jatekos vegig hajt. Egy sima
   * szinnel nem latszik rajta a sebesseg -- eddig ezt egy racs potolta.
   *
   * A textura ISMETLODIK (RepeatWrapping): egy 1024-es kep felbontasa
   * 120 m-en 8.5 pixel/meter lenne, ami elmosodott massza. Igy viszont
   * a mintazat 8 m-enkent ujraindul, ami autobol nezve reszletes marad.
   *
   * A betoltes NEM allithatja meg a jatekot: ha a textura nem jon meg,
   * a talaj a korabbi sima szinevel marad.
   */
  private groundMaterial(box: ArenaBox): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
    });

    if (!dekoracioBe()) {
      mat.color.setHex(box.color);
      return mat;
    }

    const loader = new THREE.TextureLoader();
    // Hany meterenkent ismetlodjon a mintazat.
    const METERENKENT = 8;
    const ismetles = (box.halfExtents.x * 2) / METERENKENT;

    loader.load(
      "/textures/homok-alap.webp",
      (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(ismetles, ismetles);
        tex.colorSpace = THREE.SRGBColorSpace;
        // Anizotrop szures: a talajt nagyon lapos szogbol latjuk, es
        // enelkul a tavolabbi resz csikos masszava mosodik.
        // Anizotrop szures: a talajt nagyon lapos szogbol latjuk, es
        // enelkul a tavolabbi resz csikos masszava mosodik.
        tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        mat.map = tex;
        mat.needsUpdate = true;
      },
      undefined,
      () => {
        // Nincs textura -- marad a sima szin, a jatek megy tovabb.
        mat.color.setHex(box.color);
        mat.needsUpdate = true;
      },
    );

    // NORMAL MAP SZANDEKOSAN NINCS.
    //
    // Kiprobaltam: a homok szemcseje autobol nezve nem latszik (a
    // kamera 6 m-rel a kocsi mogott es folott van, a talajt lapos
    // szogbol latjuk), viszont MINDEN talaj-pixelen egy plusz
    // texturamintat jelentene -- a talaj pedig a kep nagy reszet
    // kitolti. A kicsomagolt kep megmaradt a textures/ alatt, ha
    // kesobb megis kellene.

    return mat;
  }

/**
   * Az EPULET-MODELLEK betoltese.
   *
   * Egy fajlban all mind a 17 epulet, mindegyik a sajat nevu
   * csomopontkent, az origoba allitva (a talpa a nullan). A palya
   * ebbol epul: minden elhelyezes egy KLON, tehat a geometria es az
   * anyag kozos -- huszonket epulet is egyetlen keszlet memoriajaba fer.
   *
   * A betoltes NEM allithatja meg a jatekot: ha nem jon meg, a palya a
   * szurke dobozaival marad jatszhato.
   */
  private async loadProps(loader: GLTFLoader): Promise<void> {
    try {
      const gltf = await loader.loadAsync(PROP_MODEL_URL);
      // NEV SZERINT keresunk, nem a gyerekek kozott: az exportalo
      // beleteheti a csomopontokat egy burokba (a Sketchfab-modelleknel
      // igy is volt), es akkor a kozvetlen gyerekek kozott csak a burok
      // allna.
      gltf.scene.traverse((o) => {
        const nev = o.name.replace(/.d+$/, "");
        if (nev in PROP_MERETEK && !this.propTemplates.has(nev)) {
          this.propTemplates.set(nev, o);
        }
      });
    } catch (hiba) {
      console.warn("Az epulet-modellek nem toltodtek be:", hiba);
    }
  }

  /**
   * Egy epulet-peldany a palyara.
   *
   * A modell a doboz HELYETT kerul ki, nem melle: a doboz merete a
   * modellbol szarmazik (arenaProps.ts), tehat pontosan fedik egymast.
   * A modell a TALPAN all, ezert a doboz aljara kell tenni, nem a
   * kozeppontjara.
   */
  /**
   * A kirakott epuletek EPULETENKENT -- a fizikanak.
   *
   * A doboz-kozelites autómagassagban jo, de a fizika ennel pontosabbat
   * is tud: a modell sajat haromszogeit. Ehhez kell tudni, melyik
   * modell melyik utkozo-csoportot valtja ki.
   */
  private propBodies = new Map<string, THREE.Object3D>();

  /**
   * A kirakott epuletek haromszogei VILAG-koordinatakban.
   *
   * A fizika ebbol epit haromszog-testet a dobozok helyett (lasd
   * RapierBackend.swapArenaToMeshes). Vilagkoordinatakban adjuk at,
   * mert igy a test az origoban all: nincs kulon eltolas vagy forgatas,
   * ami elcsuszhatna a latvanytol.
   */
  arenaTrimeshes(): { csoport: string; vertices: Float32Array; indices: Uint32Array }[] {
    const ki: { csoport: string; vertices: Float32Array; indices: Uint32Array }[] = [];
    const pont = new THREE.Vector3();

    for (const [csoport, gyoker] of this.propBodies) {
      const csucsok: number[] = [];
      const indexek: number[] = [];
      gyoker.updateWorldMatrix(true, true);
      gyoker.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
        const geo = mesh.geometry;
        const poz = geo.attributes.position;
        const eltolas = csucsok.length / 3;
        for (let i = 0; i < poz.count; i++) {
          pont.set(poz.getX(i), poz.getY(i), poz.getZ(i));
          mesh.localToWorld(pont);
          csucsok.push(pont.x, pont.y, pont.z);
        }
        const idx = geo.index;
        if (idx) {
          for (let i = 0; i < idx.count; i++) indexek.push(eltolas + idx.getX(i));
        } else {
          for (let i = 0; i < poz.count; i++) indexek.push(eltolas + i);
        }
      });
      if (indexek.length === 0) continue;
      ki.push({
        csoport,
        vertices: new Float32Array(csucsok),
        indices: new Uint32Array(indexek),
      });
    }
    return ki;
  }

  private createProp(box: ArenaBox): THREE.Object3D | null {
    const sablon = box.prop ? this.propTemplates.get(box.prop) : undefined;
    if (!sablon) return null;
    const mesh = sablon.clone(true);
    // A modell a TALPAN all, ezert a doboz aljara kerul. A vizszintes
    // helyet a propAt adja meg, ha az elter a doboz kozeppontjatol
    // (nyitott szin: az oszlopsorok oldalra tolva allnak).
    mesh.position.set(
      box.propAt?.x ?? box.position.x,
      box.position.y - box.halfExtents.y,
      box.propAt?.z ?? box.position.z,
    );
    mesh.rotation.y = ((box.propYaw ?? 0) * Math.PI) / 180;
    this.enableShadows(mesh);
    return mesh;
  }

  /**
   * A szurke dobozok lecserelese a betoltott EPULET-MODELLEKRE.
   *
   * MIERT UTOLAG: a palya a konstruktorban felepul (a fizika es a
   * celzas azonnal szamol vele), a modellek viszont aszinkron
   * erkeznek. Igy a jatek nem var rajuk -- es ha a betoltes elbukik, a
   * palya a dobozaival marad jatszhato, csak csunyabban.
   */
  private swapProps(): void {
    for (const box of ARENA) {
      if (!box.prop) continue;
      const prop = this.createProp(box);
      if (!prop) continue;

      const regi = this.arenaBoxMeshes.get(box.name);
      if (regi) {
        this.scene.remove(regi);
        const i = this.arenaMeshes.indexOf(regi);
        if (i >= 0) this.arenaMeshes.splice(i, 1);
        regi.geometry.dispose();
        (regi.material as THREE.Material).dispose();
        this.arenaBoxMeshes.delete(box.name);
      }

      this.scene.add(prop);
      // A celzas mostantol a MODELLRE vetit, nem a lecserelt dobozra.
      this.arenaMeshes.push(prop);
      // A HATART kihagyjuk: annak dobozkent kell maradnia (lasd
      // ArenaBox.tomor), tehat a haromszogeit sem adjuk at.
      if (box.csoport !== undefined && box.tomor !== true) {
        this.propBodies.set(box.csoport, prop);
      }
    }
  }

  /**
   * A palyan KIVULI latkep: epuletek a fal mogott, utkozes nelkul.
   *
   * Ezek sosem erhetok el, tehat nincs fizikai testuk, es a celzas sem
   * vetit rajuk -- kulonben a falon TULRA lehetne celozni.
   */
  private buildScenery(): void {
    for (const p of SCENERY) {
      const sablon = this.propTemplates.get(p.prop);
      if (!sablon) continue;
      const mesh = sablon.clone(true);
      mesh.position.set(p.x, 0, p.z);
      mesh.rotation.y = ((p.yaw ?? 0) * Math.PI) / 180;
      // Arnyekot nem vetnek: messze vannak, es a napunk arnyek-kameraja
      // csak a palyat fedi le.
      this.scene.add(mesh);
    }
  }

/**
   * KULSO TALAJ: homok a palyan tul is.
   *
   * A jatek talaja pontosan akkora, mint a palya (120 x 120 m) -- es ez
   * NEM csak latvany: a raketa-hatar es a plauzibilitas-ellenorzes is
   * ebbol a dobozbol szamol (lasd rockets.ts ARENA_LIMIT). Ezert nem
   * lehet egyszeruen megnoveleni.
   *
   * A hataroló epuletek viszont a palyan KIVUL allnak, es a latkep meg
   * tavolabb: alattuk es kozottuk a semmibe lehetett latni -- a jatekos
   * ugy latta, hogy "az epuletek alatt hianyzik a homok".
   *
   * Ez a felulet CSAK LATVANY: nincs teste, nem celozhato, es a
   * jatekmenetrol semmit nem mond. Kicsivel a palya talaja ALATT all,
   * hogy a ketto ne villogjon egymason.
   */
  private buildOuterGround(): void {
    const MERET = 900;
    const geo = new THREE.PlaneGeometry(MERET, MERET);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
    });

    const loader = new THREE.TextureLoader();
    loader.load(
      "/textures/homok-alap.webp",
      (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        // UGYANAZ a leptek, mint a palya talajan (8 meterenkent): igy a
        // ketto hatara nem latszik.
        tex.repeat.set(MERET / 8, MERET / 8);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(
          8,
          this.renderer.capabilities.getMaxAnisotropy(),
        );
        mat.map = tex;
        mat.needsUpdate = true;
      },
      undefined,
      () => {
        mat.color.setHex(0x9c8f78);
        mat.needsUpdate = true;
      },
    );

    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.05;
    mesh.receiveShadow = true;
    // SZANDEKOSAN nem kerul az arenaMeshes koze: a celzas ne vetithessen
    // a palyan kivulre.
    this.scene.add(mesh);
  }

  private buildArena(): void {
    for (const box of ARENA) {
      const geo = new THREE.BoxGeometry(
        box.halfExtents.x * 2,
        box.halfExtents.y * 2,
        box.halfExtents.z * 2,
      );
      const mat =
        box.name === "ground"
          ? this.groundMaterial(box)
          : new THREE.MeshStandardMaterial({
              color: box.color,
              roughness: 0.9,
              metalness: 0.05,
            });
      // A REJTETT dobozokat nem rajzoljuk: azokat egy masik elem
      // modellje takarja. Diszites nelkuli modban viszont igen, mert ott
      // egyaltalan nincs modell, es a puszta utkozes lathatatlan lenne.
      if (box.hidden && dekoracioBe()) continue;

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
      // Megjegyezzuk, hogy a modellek megerkezesekor le tudjuk cserelni
      // (lasd swapProps) -- a betoltes aszinkron, a palya viszont mar
      // itt kesz kell legyen.
      this.arenaBoxMeshes.set(box.name, mesh);
    }

    // RACS NINCS.
    //
    // Sotet, semleges palyan a racs volt az egyetlen fogodzo a
    // sebesseghez es a tavolsaghoz. Azt a szerepet mostantol a
    // homok-textura (8 meterenkent ismetlodo mintazat) es a korbe allo
    // epuletek latjak el -- a racs mellettuk mar csak kockas papirnak
    // latszott a homokon.
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

    this.syncCarHitbox(
      "sajat",
      interpolatedChassis.position,
      interpolatedChassis.quaternion,
    );

    return interpolatedChassis;
  }

  // --- Hitboxok (dev mod) ---

  /**
   * Az UTKOZO TESTEK kirajzolasa dratvazkent.
   *
   * MIERT KELL: a latvany es az utkozes KULON forrasbol jon, es a ketto
   * eszrevetlenul elcsuszhat. A kovetkezmeny csendes: a jatekos
   * nekimegy a semminek, vagy athajt azon, amit lat.
   *
   * AMIT MUTAT, es amit NEM:
   *
   *  - a HAROMSZOG-TESTEK nincsenek kirajzolva. Nem is kell: azok
   *    PONTOSAN a modellek, tehat a jatekos mar latja oket. (A belso
   *    epuletek fizikai teste es minden loves ezekkel szamol.)
   *  - ki van rajzolva minden, ami MEG DOBOZ, mert az elter a
   *    latvanytol: a palyahatar epuletei (ott szandekosan doboz maradt,
   *    kulonben a lyukas modelleken kihajtana az auto), es az autó
   *    fizikai teste, ami konvex burok.
   *
   * A SZINEK szerepet jelolnek, nem stilust -- lasd lentebb.
   */
  private hitboxGroup: THREE.Group | null = null;
  private carHitboxes = new Map<string, THREE.Group>();

  /**
   * Szinek szerep szerint.
   *
   * Enelkul a kep ugyanolyan hazugsag lenne, mint amit keresunk: egy
   * doboz, ami mar semmit nem dont, ugyanugy nezne ki, mint az, ami
   * igen. (Ez tenylegesen igy volt egy ideig: a belso epuletek
   * dobozait meg akkor is zolden rajzoltuk, amikor mar a
   * haromszog-testuk dontott mindenrol.)
   */
  private static readonly HITBOX_SZIN = {
    /** MEG DOBOZ: a vezetes ezzel utkozik (palyahatar, talaj). */
    fizikaiDoboz: 0x3fb950,
    /** CSAK a kamera hasznalja: se fizika, se loves nem szamol vele. */
    csakKamera: 0xd29922,
    /** Az AUTO fizikai teste: a modell konvex burka. */
    autoBurok: 0x39d0ff,
  };

  /** egy dratvaz-doboz a megadott fel-meretekkel. */
  private makeHitbox(
    halfX: number,
    halfY: number,
    halfZ: number,
    color: number,
  ): THREE.LineSegments {
    const geo = new THREE.BoxGeometry(halfX * 2, halfY * 2, halfZ * 2);
    const lines = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color, depthTest: false }),
    );
    geo.dispose();
    // A dobozok MINDEN mas fole rajzolodnak: kulonben eppen az a fal
    // takarna el a sajat hitboxat, amit ellenorizni akarunk.
    lines.renderOrder = 999;
    return lines;
  }

  /** Latszanak-e eppen a hitboxok. */
  get hitboxesVisible(): boolean {
    return this.hitboxGroup !== null && this.hitboxGroup.visible;
  }

  setHitboxesVisible(visible: boolean): void {
    if (!this.hitboxGroup) {
      if (!visible) return;
      this.hitboxGroup = new THREE.Group();
      for (const box of ARENA) {
        if (box.name === "ground") continue;
        // A BELSO epuletek dobozait a betoltes utan lecsereltuk a
        // modell haromszogeire (lasd swapArenaToMeshes), a lovest pedig
        // a szerver szamolja -- szinten haromszogekkel. Ezek a dobozok
        // tehat mar CSAK a kamera behuzodasat vezerlik.
        const csakKamera = box.tomor !== true;
        const lines = this.makeHitbox(
          box.halfExtents.x,
          box.halfExtents.y,
          box.halfExtents.z,
          csakKamera
            ? SceneView.HITBOX_SZIN.csakKamera
            : SceneView.HITBOX_SZIN.fizikaiDoboz,
        );
        lines.position.set(box.position.x, box.position.y, box.position.z);
        if (box.rotation) {
          lines.rotation.set(box.rotation.x, box.rotation.y, box.rotation.z);
        }
        this.hitboxGroup.add(lines);
      }
      this.scene.add(this.hitboxGroup);
    }
    this.hitboxGroup.visible = visible;
    for (const l of this.carHitboxes.values()) l.visible = visible;
  }

  /**
   * Egy auto hitboxanak igazitasa.
   *
   * Az autoke MOZOG, tehat kepkockankent kell allitani -- az arenae nem.
   */
  private syncCarHitbox(
    id: string,
    position: readonly number[],
    quaternion: readonly number[],
  ): void {
    if (!this.hitboxGroup?.visible) return;
    let csoport = this.carHitboxes.get(id);
    if (!csoport) {
      // A KONVEX BUROK: ez az auto fizikai teste (lasd carHull.ts).
      //
      // NEM a talalati dobozok: azok mar csak tartalek arra az esetre,
      // ha a generalt haromszog-halo hianyozna. A talalatot a szerver a
      // modell haromszogeivel szamolja -- vagyis pontosan azzal, amit a
      // jatekos lat, tehat azt nincs mit kulon kirajzolni.
      csoport = new THREE.Group();
      const pontok: THREE.Vector3[] = [];
      for (let i = 0; i < CAR_HULL_POINTS.length; i += 3) {
        pontok.push(
          new THREE.Vector3(
            CAR_HULL_POINTS[i],
            CAR_HULL_POINTS[i + 1],
            CAR_HULL_POINTS[i + 2],
          ),
        );
      }
      const burokGeo = new ConvexGeometry(pontok);
      const burok = new THREE.LineSegments(
        new THREE.EdgesGeometry(burokGeo, 15),
        new THREE.LineBasicMaterial({
          color: SceneView.HITBOX_SZIN.autoBurok,
          depthTest: false,
        }),
      );
      burokGeo.dispose();
      burok.renderOrder = 999;
      csoport.add(burok);
      this.carHitboxes.set(id, csoport);
      this.hitboxGroup.add(csoport);
    }
    csoport.visible = true;
    csoport.position.set(position[0], position[1], position[2]);
    csoport.quaternion.set(
      quaternion[0],
      quaternion[1],
      quaternion[2],
      quaternion[3],
    );
  }

  /**
   * @param korulnezes A KORULNEZES szoge fokban (C gomb, lasd
   *   freeLook.ts). A yaw a fuggoleges tengely koruli elfordulas, a
   *   pitch az emeles. Alapesetben mindketto nulla, es a kamera ugy
   *   viselkedik, mint eddig.
   */
  updateCamera(
    chassis: Transform,
    korulnezes: { yaw: number; pitch: number; aktiv?: boolean } = {
      yaw: 0,
      pitch: 0,
    },
  ): void {
    this.tmpQuat.set(...chassis.quaternion);

    // Az offsetet csak a fuggoleges tengely koruli forgatas erdekli,
    // kulonben a kamera egyutt bukfencezik az autoval.
    const forward = this.tmpVec.set(0, 0, 1).applyQuaternion(this.tmpQuat);
    const yaw = Math.atan2(forward.x, forward.z);
    const flatQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      yaw,
    );

    const offset = new THREE.Vector3(
      CAMERA.offset.x,
      CAMERA.offset.y,
      CAMERA.offset.z,
    );

    // KORULNEZES: az offsetet elforgatjuk az auto korul.
    //
    // A KAPOTT SZOG a nezesirany valtozasa (jobbra nezni = pozitiv
    // yaw), az offset viszont a kamera HELYE az autohoz kepest -- es a
    // kamera az autora nez vissza. A ketto viszonya tengelyenkent MAS,
    // ezert nem eleg egyseges elojellel dolgozni:
    //
    //  - VIZSZINTESEN forditott: a kamerat jobbra tolva onnan balra
    //    lat, tehat a yaw-ot negalni kell.
    //  - FUGGOLEGESEN nem: az emeles tengelye (offset.z, 0, -offset.x)
    //    koruli pozitiv forgatas LEJJEBB viszi a kamerat, onnan pedig
    //    FELFELE nez -- ami eppen a kivant irany.
    //
    // Az elso valtozatban mindketto negalva volt, es a fel-le nezes
    // forditva mukodott.
    //
    // A sorrend szamit. Eloszor a FUGGOLEGES tengely korul (yaw), utana
    // az igy kapott iranyra merolegesen emelunk (pitch). Forditva a
    // fel-le nezes egy megdolt tengely korul tortenne, es a kep
    // eldolne oldalra.
    if (korulnezes.yaw !== 0 || korulnezes.pitch !== 0) {
      const yawRad = (-korulnezes.yaw * Math.PI) / 180;
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yawRad);
      if (korulnezes.pitch !== 0) {
        const tengely = new THREE.Vector3(offset.z, 0, -offset.x).normalize();
        offset.applyAxisAngle(tengely, (korulnezes.pitch * Math.PI) / 180);
      }
    }

    const desired = offset
      .applyQuaternion(flatQuat)
      .add(new THREE.Vector3(...chassis.position));

    const lookTarget = new THREE.Vector3(...chassis.position);
    lookTarget.y += CAMERA.lookAtHeight;

    // A kamera ne kerulhessen falba (lasd cameraClamp).
    //
    // KETSZER szamolunk: eloszor a KIVANT helyre, hogy a simitas mar a
    // behuzott pont fele tartson (kulonben a kamera lassan usznak be a
    // falba), aztan a SIMITOTT helyre is, hogy egyetlen kepkockara se
    // kerulhessen at a tuloldalra.
    const szabad = cameraClamp(
      [lookTarget.x, lookTarget.y, lookTarget.z],
      [desired.x, desired.y, desired.z],
      ARENA,
    );
    desired.set(szabad[0], szabad[1], szabad[2]);

    // KORULNEZES kozben NINCS kovetesi simitas.
    //
    // A CAMERA.positionLerp kepkockankent kozelit a kivant helyhez,
    // ami vezetes kozben kellemes -- korulnezeskor viszont a kep
    // lathatoan lemarad az egertol. A jatekos a kepet koveti, nem a
    // kezet, tehat ez azonnal zavaro. A kivant hely ilyenkor is az auto
    // SIMITOTT allasabol jon, tehat nem lesz tole rangatos.
    if (korulnezes.aktiv) {
      this.camPos.copy(desired);
    } else {
      this.camPos.lerp(desired, CAMERA.positionLerp);
    }
    const simitott = cameraClamp(
      [lookTarget.x, lookTarget.y, lookTarget.z],
      [this.camPos.x, this.camPos.y, this.camPos.z],
      ARENA,
    );
    this.camera.position.set(simitott[0], simitott[1], simitott[2]);

    this.camLook.lerp(lookTarget, CAMERA.lookAtLerp);
    this.camera.lookAt(this.camLook);
  }

  // --- Valaszthato ujraszuletesi helyek ---
  //
  // A halal varakozasa alatt a jatekos az EGESZ palyat latja felulrol,
  // rajta minden szabad spawn-ponttal. A sajate kiemelve; a tobbire rá
  // lehet kattintani, ha mashova szeretne.
  //
  // CSAK a sajat kliensen letezik: hogy hova szuletunk, es mibol
  // valaszthatunk, szemelyes informacio (lasd RespawnPlanMessage) -- az
  // ellenfel nem lathatja.

  private choiceGeometry: {
    ring: THREE.RingGeometry;
    beam: THREE.CylinderGeometry;
    hit: THREE.CircleGeometry;
  } | null = null;

  private readonly spawnChoices = new Map<
    number,
    { group: THREE.Group; ring: THREE.MeshBasicMaterial; beam: THREE.MeshBasicMaterial }
  >();

  private selectedSpawn: number | null = null;

  /** Hany valaszthato hely latszik -- a tesztek ezt olvassak. */
  get spawnChoiceCount(): number {
    return this.spawnChoices.size;
  }

  /** Melyik hely van kiemelve -- a tesztek ezt olvassak. */
  get selectedSpawnIndex(): number | null {
    return this.selectedSpawn;
  }

  /**
   * A valaszthato helyek megjelenitese.
   *
   * @param options  A szabad spawn-pontok sorszamai (a szervertol).
   * @param selected Amelyikre eppen szuletnenk.
   */
  showSpawnChoices(options: readonly number[], selected: number | null): void {
    for (const [index, marker] of this.spawnChoices) {
      if (options.includes(index)) continue;
      this.scene.remove(marker.group);
      marker.ring.dispose();
      marker.beam.dispose();
      this.spawnChoices.delete(index);
    }
    this.selectedSpawn = selected;

    for (const index of options) {
      if (this.spawnChoices.has(index)) continue;
      const point = SPAWN_POINTS[index];
      if (!point) continue;

      if (!this.choiceGeometry) {
        this.choiceGeometry = {
          ring: new THREE.RingGeometry(2.6, 3.3, 40),
          beam: new THREE.CylinderGeometry(2.6, 2.6, 9, 24, 1, true),
          // Nagyobb, LATHATATLAN korlap a kattintashoz: a gyuru maga
          // vekony, es a felulnezetbol nagyon apronak latszik.
          hit: new THREE.CircleGeometry(5, 24),
        };
      }
      const geometry = this.choiceGeometry;

      const group = new THREE.Group();
      group.position.set(point.x, 0, point.z);

      const ringMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(geometry.ring, ringMaterial);
      ring.rotateX(-Math.PI / 2);
      ring.position.y = 0.06;
      group.add(ring);

      const beamMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const beam = new THREE.Mesh(geometry.beam, beamMaterial);
      beam.position.y = 4.5;
      group.add(beam);

      // A kattintas-felulet: opacity 0, de NEM visible=false -- a
      // rejtett objektumot a sugarkoveto atugorja.
      const hit = new THREE.Mesh(
        geometry.hit,
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      hit.rotateX(-Math.PI / 2);
      hit.position.y = 0.04;
      hit.userData.spawnIndex = index;
      group.add(hit);

      this.scene.add(group);
      this.spawnChoices.set(index, { group, ring: ringMaterial, beam: beamMaterial });
    }
  }

  /**
   * Egy valaszthato hely vilagbeli poziciója -- vagy null.
   *
   * A tesztek ebbol vetitik ki a kepernyore, hogy oda tudjanak
   * kattintani; a jatek maga nem hasznalja.
   */
  spawnChoicePosition(index: number): [number, number, number] | null {
    const marker = this.spawnChoices.get(index);
    if (!marker) return null;
    const p = marker.group.position;
    return [p.x, p.y, p.z];
  }

  /** Minden jelolo eltuntetese (ujraszuletes utan). */
  clearSpawnChoices(): void {
    this.showSpawnChoices([], null);
  }

  /**
   * Melyik helyre mutat a celkereszt -- vagy null.
   *
   * A halal alatt a kattintas nem loves, hanem helyvalasztas
   * (lasd main.ts).
   */
  spawnChoiceAt(ndcX: number, ndcY: number): number | null {
    if (this.spawnChoices.size === 0) return null;
    this.ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndc, this.camera);

    const groups = [...this.spawnChoices.values()].map((m) => m.group);
    for (const hit of this.raycaster.intersectObjects(groups, true)) {
      const index = hit.object.userData.spawnIndex;
      if (typeof index === "number") return index;
    }
    return null;
  }

  /**
   * A jelolok lüktetese es szinezese.
   *
   * A kivalasztott arany es hatarozott, a tobbi halvany kek: igy egy
   * pillantasbol latszik, hova kerulunk -- es hogy van mibol valasztani.
   */
  updateSpawnChoices(now: number): void {
    const pulse = 0.5 + 0.25 * Math.sin(now / 260);
    for (const [index, marker] of this.spawnChoices) {
      const chosen = index === this.selectedSpawn;
      marker.ring.color.setHex(chosen ? 0xe3b341 : 0x6fd3ff);
      marker.beam.color.setHex(chosen ? 0xe3b341 : 0x6fd3ff);
      marker.ring.opacity = chosen ? pulse : 0.3;
      marker.beam.opacity = chosen ? pulse * 0.25 : 0.07;
    }
  }

  /**
   * Kamera a LEENDO ujraszuletesi hely fole, a halal varakozasa alatt.
   *
   * Az ot masodperc kulonben teljesen ures ido: a jatekos a sajat
   * roncsat nezi, es semmit nem tud meg arrol, hova kerul, sem arrol,
   * hol vannak a tobbiek. Innen viszont MINDKETTOT latja -- az
   * ellenfeleket is, mert azok amugy is ki vannak rajzolva.
   *
   * SZANDEKOSAN ugyanazt a simito allapotot (camPos, camLook) hasznalja,
   * mint az updateCamera: igy a halalba es a szuletesbe valo atmenet
   * folyamatos, nem ugras.
   */
  previewArena(): void {
    // Az EGESZ arena latszik, nem csak a spawn kornyeke: igy derul ki,
    // hol all az ellenfel, es melyik szabad hely van tole tavol.
    //
    // A tavolsag szamitott, nem talalgatott: 62 fokos fuggoleges
    // latoszognel a 80 m-es palya befoglalasahoz kb. 67 m kell -- a
    // dontott nezet miatt ennel bovebben merunk.
    const desired = new THREE.Vector3(0, ARENA_HALF * 1.75, ARENA_HALF * 1.45);
    // GYORSABB atmenet, mint a jatek kozbeni kamerakovetes.
    //
    // A halal ablaka mindossze ot masodperc, es ez alatt kell attekinteni
    // a palyat es helyet valasztani. A megszokott, lagy kovetessel
    // (0.12) az odaerkezes maga elvinne kozel harom masodpercet -- a
    // rendelkezesre allo ido tobb mint felet.
    const PREVIEW_LERP = 0.32;
    this.camPos.lerp(desired, PREVIEW_LERP);
    this.camera.position.copy(this.camPos);

    this.camLook.lerp(new THREE.Vector3(0, 0, 0), PREVIEW_LERP);
    this.camera.lookAt(this.camLook);
  }

  /** A kamera fuggoleges latoszoge fokban (a korulnezes belepesehez). */
  get cameraFov(): number {
    return this.camera.fov;
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
