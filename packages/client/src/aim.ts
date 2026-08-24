/**
 * Eger-celzas es celkereszt.
 *
 * A kamera a kocsit koveti (nem szabadon forgathato), ezert a celzas
 * NEM kamera-forgatas: a jatekos egy kepernyon mozgo celkeresztet vezet,
 * es a rakéta oda repul, ahova az mutat. A vilagbeli celpontot a
 * SceneView szamolja ki sugar-vetitéssel (lasd aimPointAt).
 */

/**
 * A palyara mutat-e az eger?
 *
 * A celzas CSAK a vaszon felett ervenyes. SZANDEKOSAN nem soroljuk fel
 * nev szerint a paneleket: a tisztan tajekoztato retegek (HUD, pontozo,
 * szalag) `pointer-events: none`, ezert az esemenyt a vaszon kapja meg
 * -- folottuk tehat celozni is, loni is lehet. Ami viszont KATTINTHATO
 * (lobby, dev csuszkak, szobakod-gomb), az maga lesz a celpont, es igy
 * magatol kimarad. Uj panel hozzaadasakor nincs mit atirni itt.
 */
function onGameSurface(target: EventTarget | null): boolean {
  return (target as Element | null)?.tagName === "CANVAS";
}

export class Aim {
  private readonly element: HTMLElement;

  /** Kepernyo-koordinata pixelben. */
  private x = window.innerWidth / 2;
  private y = window.innerHeight / 2;
  /** A kurzor a palya folott van-e (mashol a rendszer-kurzor kell). */
  private overField = true;
  /**
   * A lobbyban meg nincs mire celozni: a celkereszt csak a belepes utan
   * jelenik meg, es addig a kattintas sem sul el lovesnek.
   */
  private active = false;

  private fireHandler: (() => void) | null = null;

  /**
   * Nyomva van-e a tuz gomb.
   *
   * Az AGYU egyszeri kattintasra sul el (lasd onFire), a GEPFEGYVER
   * viszont folyamatosan tuzel, amig a gombot tartjak -- a lovesek
   * utemet a szerver adja (lasd ClientState.firing). Ezert kell a
   * ket-allapotu jelzes a puszta esemeny mellett.
   */
  private held = false;

  constructor() {
    const element = document.getElementById("crosshair");
    if (!element) throw new Error("#crosshair nem talalhato");
    this.element = element;

    this.render();

    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    // Ablakot valtva ne ragadjon be a tuz.
    window.addEventListener("blur", this.onBlur);
    // Jobb gombbal ne jojjon fel a bongeszo menuje a palya felett.
    window.addEventListener("contextmenu", this.onContextMenu);
  }

  /** Bal egergombra hivodik -- csak a palya folott, belepes utan. */
  onFire(handler: () => void): void {
    this.fireHandler = handler;
  }

  /** Tuzel-e eppen a jatekos (folyamatos fegyverhez). */
  get isFiring(): boolean {
    return this.active && this.held;
  }

  /** A lobby vege (vagy offline modban a jatek indulasa) kapcsolja be. */
  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.held = false;

    // Bekapcsolaskor UJRA megnezzuk, mi van a kurzor alatt. Az utolso
    // egermozgas ugyanis meg a lobby folott tortent (oda kattintott a
    // jatekos), tehat a "palya folott vagyunk-e" allapot elavult -- a
    // lobby viszont eppen most tunt el alola. Egermozgasra varni nem
    // lehet: addig a celkereszt hianyozna.
    if (active) {
      this.overField = onGameSurface(document.elementFromPoint(this.x, this.y));
    }
    this.render();
  }

  /**
   * A celkereszt helye normalizalt eszkoz-koordinataban (-1..1).
   * Ezt varja a sugar-vetites (lasd SceneView.aimPointAt).
   */
  ndc(): [number, number] {
    return [
      (this.x / window.innerWidth) * 2 - 1,
      -(this.y / window.innerHeight) * 2 + 1,
    ];
  }

  private onMouseMove = (e: MouseEvent): void => {
    this.x = e.clientX;
    this.y = e.clientY;
    this.overField = onGameSurface(e.target);
    this.render();
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    // A lobby gombjai es a dev csuszkak ne suljanak el lovesnek.
    if (!this.active || !onGameSurface(e.target)) return;
    this.held = true;
    this.fireHandler?.();
  };

  private onMouseUp = (e: MouseEvent): void => {
    // A felengedest SZANDEKOSAN nem szurjuk a celpontra: ha a jatekos a
    // palya folott nyomta le, de a HUD folott engedi el, a tuznek akkor
    // is meg kell allnia.
    if (e.button !== 0) return;
    this.held = false;
  };

  private onBlur = (): void => {
    this.held = false;
  };

  private onContextMenu = (e: MouseEvent): void => {
    // A panelek folott maradjon meg a bongeszo sajat menuje (pl. hogy a
    // szobakodot masolni lehessen).
    if (!onGameSurface(e.target)) return;
    e.preventDefault();
  };

  private render(): void {
    this.element.hidden = !this.active || !this.overField;
    this.element.style.left = `${this.x}px`;
    this.element.style.top = `${this.y}px`;
  }

  dispose(): void {
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("contextmenu", this.onContextMenu);
  }
}
