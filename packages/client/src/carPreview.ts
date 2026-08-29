import * as THREE from "three";
import type { CarId, WeaponId } from "@cca/shared";

/**
 * AUTO-ELONEZET a lobby valasztojahoz.
 *
 * MIERT ELO 3D, es nem elore keszitett kepek: a valasztoban PONTOSAN
 * annak kell latszania, amivel a jatekos jatszani fog. Egy kulon
 * kep-keszlet kulon karbantartast jelentene, es a legelso
 * modell-frissiteskor csendben elcsuszna a jatektol -- a jatekos egy
 * masik autot valasztana, mint amit lat. A modellek amugy is be vannak
 * mar toltve, mire a lobby megnyilik.
 *
 * KET dolgot csinal:
 *
 *  - NAGY elonezet: a kivalasztott auto lassan fordul egy vasznon.
 *  - BELYEGKEPEK: a gombokra egy-egy allokep, ugyanebbol a modellbol.
 *
 * SAJAT renderelot hasznal, nem a jatekbelit: az a teljes ablakra van
 * meretezve, es a lobby alatt eppen nem is jar. A lobby bezarasakor
 * eldobjuk (lasd dispose), hogy ne tartsunk egy felesleges WebGL
 * kontextust a meccs alatt.
 */
export class CarPreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  /** A most mutatott auto -- forgatas kozben ezt pörgetjük. */
  private jelenlegi: THREE.Object3D | null = null;
  /** Melyik autot/festest mutatja EPPEN a nagy elonezet. */
  private eloCar: CarId | null = null;
  private eloSkin = "";
  private vaszon: HTMLCanvasElement | null = null;
  private futAnimacio = false;
  /**
   * A KEZDO szog: haromnegyed elolnezet.
   *
   * A modell orra a -Z fele all, a kamera a +Z-n ul: nulla szognel a
   * hatuljat latnank. A jatekos elso pillantasa az autora legyen a
   * legbeszedesebb nezet.
   */
  private szog = Math.PI * 0.75;
  private utolsoIdo = 0;

  /** A NAGY elonezeten latszo fegyver (a belyegkepeken nincs). */
  private weapon: WeaponId | null = null;

  /**
   * A most mutatott peldany MERT merete (a kamerahoz).
   *
   * MIERT mert, es nem a carGeometry adata: a tetőn ott ul a fegyver
   * is, ami autonkent mas magassagra kerul, es a fegyver-modellek is
   * kulonboznek. Az elso valtozat a karosszeria dobozabol szamolt --
   * az agyu csove igy kilogott a kep tetejen.
   */
  private meretek = { felMagas: 1, sugar: 3 };

  constructor(
    /** Innen jonnek a modellek -- a jatek sajat jelenetebol. */
    private readonly epito: (
      car: CarId,
      skin: string,
      weapon?: WeaponId,
    ) => THREE.Object3D | null,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearAlpha(0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

    // VILAGITAS: egy fo fenyforras elolrol-felulrol, plusz eleg eros
    // kornyezeti feny, hogy a sotet festesek (fekete izomauto,
    // fekete terepjaro) is olvashatoak legyenek. A jatekban a nap
    // erosebb, de ott a kocsi mozog -- itt allokep van, azt nem
    // szabad talalgatni.
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const nap = new THREE.DirectionalLight(0xffffff, 2.2);
    nap.position.set(4, 6, 5);
    this.scene.add(nap);
    const kitolto = new THREE.DirectionalLight(0xffffff, 0.6);
    kitolto.position.set(-5, 2, -4);
    this.scene.add(kitolto);
  }

  /**
   * A kamera beallitasa egy autora.
   *
   * A tavolsag az auto MERETEBOL jon (nem beirt szam): a rohamkocsi
   * fel meterrel magasabb az izomautonal, es egy kozos tavolsagnal az
   * egyik kilogna a kepbol, a masik elveszne benne.
   */
  private kameratAllit(aspect: number): void {
    const { felMagas, sugar } = this.meretek;
    // KET iranybol kell elfernie, es a KISEBBIK tavolsag nem eleg:
    //  - fuggolegesen a jarmu magassaga a korlat (a fegyverrel egyutt,
    //    es kicsit felulrol nezunk ra -- innen a szorzo),
    //  - vizszintesen a forgas kozbeni legnagyobb kiterjedes.
    // A szeles vaszon fuggolegesen a szuk irany; a keskeny vagy a
    // belyegkep vizszintesen. Egyetlen "burkolo gomb" helyett igy
    // tolti ki a jarmu a kepet, es nem lebeg elveszve a kozepen.
    const tg = Math.tan((this.camera.fov * Math.PI) / 360);
    const fuggoleges = (felMagas * 1.35) / tg;
    const vizszintes = sugar / (tg * aspect);
    const tav = Math.max(fuggoleges, vizszintes) * 1.2;
    this.camera.aspect = aspect;
    this.camera.position.set(0, felMagas * 0.7, tav);
    // Kicsit a kozeppont ALA nezunk: igy a jarmu a kep felso reszebe
    // kerul, es nem takarjak a bal also sarokban ulo festes-kockak.
    this.camera.lookAt(0, -felMagas * 0.3, 0);
    this.camera.updateProjectionMatrix();
  }

  /** A jelenetbe egyetlen auto kerul; a regit eldobjuk. */
  private betesz(
    car: CarId,
    skin: string,
    weapon?: WeaponId,
  ): THREE.Object3D | null {
    if (this.jelenlegi) {
      this.scene.remove(this.jelenlegi);
      this.jelenlegi = null;
    }
    const auto = this.epito(car, skin, weapon);
    if (!auto) return null;
    this.scene.add(auto);

    // MEGMERJUK a kesz peldanyt (fegyverestul), meg a forgatas elott.
    // A modell origoja a TALAJ; a kamera a nulla szint kore rendez,
    // ezert a doboz kozepet tesszuk a nullaba.
    const doboz = new THREE.Box3().setFromObject(auto);
    const kozep = doboz.getCenter(new THREE.Vector3());
    const meret = doboz.getSize(new THREE.Vector3());
    auto.position.y = -kozep.y;
    this.meretek = {
      felMagas: meret.y / 2,
      // Forgas kozben a legnagyobb vizszintes kiterjedes az ATLO --
      // oldalra fordulva a hossza latszik, nem a szelessege.
      sugar: Math.hypot(meret.x, meret.z) / 2,
    };

    this.jelenlegi = auto;
    return auto;
  }

  /**
   * BELYEGKEP egy autorol: egyszeri renderelés, PNG data-URL.
   *
   * A gombokra ez kerul. Nem elo 3D: negy-ot apro, folyamatosan pörgo
   * nezet feleslegesen enne a gepet, es a valasztast nem segitene.
   */
  thumbnail(car: CarId, skin: string, szeles: number, magas: number): string {
    const auto = this.betesz(car, skin);
    if (!auto) return "";
    // Haromnegyed nezet: igy latszik az orr es az oldal is.
    auto.rotation.y = Math.PI * 0.75;
    this.renderer.setSize(szeles, magas, false);
    this.kameratAllit(szeles / magas);
    this.renderer.render(this.scene, this.camera);
    const kep = this.renderer.domElement.toDataURL("image/png");
    // A NAGY elonezet allapotat visszaallitjuk: a belyegkep-keszites
    // ugyanazt a jelenetet hasznalja, es enelkul a nagy kepen az
    // utolsonak rajzolt belyegkep autoja maradna.
    if (this.eloCar) this.show(this.eloCar, this.eloSkin);
    return kep;
  }

  /**
   * A NAGY elonezet: a megadott vaszonra rajzol, es lassan forgat.
   *
   * A vaszon a lobbyban van; mi a sajat renderelonk kepet masoljuk ra
   * kepkockankent. Igy a lobby HTML-je nem fugg a renderelotol.
   */
  live(vaszon: HTMLCanvasElement, car: CarId, skin: string): void {
    this.vaszon = vaszon;
    this.show(car, skin);
    if (!this.futAnimacio) {
      this.futAnimacio = true;
      this.utolsoIdo = performance.now();
      requestAnimationFrame(this.kepkocka);
    }
  }

  private readonly kepkocka = (most: number): void => {
    if (!this.futAnimacio) return;
    requestAnimationFrame(this.kepkocka);
    const vaszon = this.vaszon;
    if (!vaszon || !this.jelenlegi) return;

    const dt = Math.min((most - this.utolsoIdo) / 1000, 0.1);
    this.utolsoIdo = most;
    // Lassu, egyenletes fordulas: korbeer kb. 12 masodperc alatt.
    this.szog += dt * 0.52;
    this.jelenlegi.rotation.y = this.szog;

    const szeles = vaszon.clientWidth || 320;
    const magas = vaszon.clientHeight || 200;
    const arany = Math.min(window.devicePixelRatio, 2);
    const px = Math.round(szeles * arany);
    const py = Math.round(magas * arany);
    if (vaszon.width !== px || vaszon.height !== py) {
      vaszon.width = px;
      vaszon.height = py;
    }
    this.renderer.setSize(px, py, false);
    this.kameraFrissit(szeles / magas);
    this.renderer.render(this.scene, this.camera);

    const ctx = vaszon.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, px, py);
      ctx.drawImage(this.renderer.domElement, 0, 0, px, py);
    }
  };

  /** A kamera az EPPEN mutatott jarmuhoz igazodik. */
  private kameraFrissit(aspect: number): void {
    if (this.eloCar) this.kameratAllit(aspect);
  }

  /** Valtas masik autora vagy festesre -- a forgas szoge megmarad. */
  show(car: CarId, skin: string): void {
    this.eloCar = car;
    this.eloSkin = skin;
    // A belyegkepekre SZANDEKOSAN nem kerul fegyver: ott az auto
    // formaja es szine a kerdes, a torony csak takarna.
    const auto = this.betesz(car, skin, this.weapon ?? undefined);
    if (auto) auto.rotation.y = this.szog;
  }

  /** A NAGY elonezeten latszo fegyver csereje. */
  setWeapon(weapon: WeaponId): void {
    this.weapon = weapon;
    if (this.eloCar) this.show(this.eloCar, this.eloSkin);
  }

  /**
   * A lobby bezarasakor: leallitjuk a forgatast es eldobjuk a WebGL
   * kontextust. Egy meccs alatt semmi szukseg ra.
   */
  dispose(): void {
    this.futAnimacio = false;
    this.vaszon = null;
    if (this.jelenlegi) {
      this.scene.remove(this.jelenlegi);
      this.jelenlegi = null;
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
