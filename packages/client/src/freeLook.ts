/**
 * KORULNEZES: a KOZEPSO EGERGOMB kapcsolja at, az eger forgatja a kamerat.
 *
 * A szabaly a kozos csomagban van (freeLook.ts); itt az esemenyek es az
 * allapot.
 *
 * KAPCSOLO, NEM NYOMVA TARTAS. Korabban a C nyomva tartasa kellett
 * hozza; a korulnezes viszont nem egy pillanatnyi mozdulat, hanem egy
 * MOD, amiben a jatekos kanyarodik es lo is -- azalatt vegig egy
 * lenyomott gombot tartani a masik kezzel folosleges teher volt. A
 * kozepso gomb ezen kivul ott van a kez alatt, ahol amugy is celzunk.
 *
 * POINTER LOCK: belepeskor a bongeszo elkapja az egeret. Enelkul a
 * kurzor elobb-utobb a kepernyo szelenek utkozne, es a forgatas ott
 * megallna -- eppen a leggyakoribb hasznalat (nezz hatra) valna
 * lehetetlenne. Ha a bongeszo nem adja meg (a pointer lock felhasznaloi
 * gesztust kivan, es meg is tagadhato), a mod attol meg mukodik: a
 * mousemove `movementX` mezoje zaras nelkul is jon, csak a kepernyo
 * szelenel elfogy.
 */
import {
  FREELOOK,
  freeLookAdd,
  freeLookEase,
  freeLookFromAim,
  freeLookParkNdcY,
} from "@cca/shared";

/** A MouseEvent.button szamozasa: 0 bal, 1 kozepso, 2 jobb. */
const KOZEPSO_GOMB = 1;

export class FreeLook {
  private aktiv = false;
  /** A kamera CEL-szoge fokban (az eger ezt allitja). */
  private cel = { yaw: 0, pitch: 0 };
  /** A kamera SIMITOTT szoge fokban -- ez megy a jelenetnek. */
  private yawFok = 0;
  private pitchFok = 0;

  private listeners: Array<(aktiv: boolean) => void> = [];

  /**
   * Honnan tudjuk, hol all a celkereszt a belepes pillanataban.
   *
   * A kamera ODA fordul, tehat a celzas a jatekos szamara nem valtozik
   * -- csak a kep fordul ala.
   */
  private belepesSzog: (() => { yaw: number; pitch: number }) | null = null;

  constructor(
    /** A palya vaszna -- ezen keri a bongeszotol az eger elkapasat. */
    private readonly elem: HTMLElement | null = document.querySelector("canvas"),
  ) {
    window.addEventListener("mousedown", this.onMouseDown);
    // A kozepso gomb bongeszo-alapertelmezese a GORGETO MOD (Windowson
    // a korkoros nyil): az elnyomna a jatekot, ezert le kell tiltani.
    // Ket helyen, mert a ket bongeszo-csalad mashol inditja: a Chrome
    // az `auxclick`-nel, a tobbi a `mousedown`-nal.
    window.addEventListener("auxclick", this.onAuxClick);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("blur", this.onBlur);
    // Ha a felhasznalo Esc-cel kilep a zarasbol, a mod is alljon le --
    // kulonben az eger megint mozogna, de a kamera meg forogna.
    document.addEventListener("pointerlockchange", this.onLockChange);
  }

  /** A belepes szogenek forrasa (a celkereszt helye + a kamera latoszoge). */
  setBelepesSzog(fn: () => { yaw: number; pitch: number }): void {
    this.belepesSzog = fn;
  }

  onValtozas(fn: (aktiv: boolean) => void): void {
    this.listeners.push(fn);
  }

  get isActive(): boolean {
    return this.aktiv;
  }

  get yaw(): number {
    return this.yawFok;
  }

  /**
   * A NYERS cel-szog, simitas nelkul (fok) -- meresre.
   *
   * A `yaw` a kamerahoz hasznalt, esetleg simitott ertek. Ha a teszt
   * AHHOZ merne a kamerat, egy visszacsempeszett simitast NEM venne
   * eszre: a ketto egyutt kesne, tehat vegig egyezne. (Az elso
   * valtozat pontosan igy tevedett.) A nyers celhoz merve viszont
   * barmilyen kesleltetes kiderul.
   */
  get celSzog(): { yaw: number; pitch: number } {
    return { ...this.cel };
  }

  get pitch(): number {
    return this.pitchFok;
  }

  /**
   * Kepkockankenti frissites.
   *
   * AKTIV modban NINCS simitas: a kamera pontosan ott all, ahova az
   * eger allitotta. Simitassal a kep lathatoan lemarad az egertol --
   * celzas kozben ez azonnal zavaro, mert a jatekos a kepet koveti, nem
   * a kezet.
   *
   * ELENGEDES utan viszont kell: 180 fokrol visszaugorva a kamera
   * atsopörne az auton. Olyankor a cel nulla, es oda simitunk vissza.
   */
  update(dt: number): void {
    if (this.aktiv) {
      this.yawFok = this.cel.yaw;
      this.pitchFok = this.cel.pitch;
      return;
    }
    this.yawFok = freeLookEase(this.yawFok, 0, dt);
    this.pitchFok = freeLookEase(this.pitchFok, 0, dt);
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button !== KOZEPSO_GOMB) return;
    // A gorgeto mod itt is: Chromeban a mousedown megallitasa fogja meg.
    e.preventDefault();

    if (this.aktiv) {
      this.kilep();
      return;
    }
    // CSAK A PALYA FOLOTT lep be. A lobbyban es a paneleken (szobakod,
    // fejlesztoi csuszkak) a kozepso gomb ne rantsa el a kamerat egy
    // olyan jatekban, ami meg el sem indult.
    if ((e.target as Element | null)?.tagName !== "CANVAS") return;

    this.aktiv = true;
    // A kamera ODA UGRIK, ahol a celkereszt allt. A simitas miatt nem
    // egy kepkocka alatt, de a jatekos ugyanoda celoz tovabb.
    this.cel = this.belepesSzog?.() ?? { yaw: 0, pitch: 0 };
    this.elem?.requestPointerLock?.();
    for (const fn of this.listeners) fn(true);
  };

  private onAuxClick = (e: MouseEvent): void => {
    if (e.button === KOZEPSO_GOMB) e.preventDefault();
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.aktiv) return;
    this.cel = freeLookAdd(this.cel, e.movementX ?? 0, e.movementY ?? 0);
  };

  private onLockChange = (): void => {
    // Csak a KILEPES erdekel: ha a zaras megszunt, de a mod meg fut
    // (pl. Esc), allitsuk le.
    if (this.aktiv && document.pointerLockElement === null) this.kilep();
  };

  private onBlur = (): void => {
    this.kilep();
  };

  private kilep(): void {
    if (!this.aktiv) return;
    this.aktiv = false;
    if (document.pointerLockElement) document.exitPointerLock?.();
    for (const fn of this.listeners) fn(false);
  }
}

export { FREELOOK, freeLookFromAim, freeLookParkNdcY };
