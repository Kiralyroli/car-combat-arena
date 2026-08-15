/**
 * Eger-celzas es celkereszt.
 *
 * A kamera a kocsit koveti (nem szabadon forgathato), ezert a celzas
 * NEM kamera-forgatas: a jatekos egy kepernyon mozgo celkeresztet vezet,
 * es a rakéta oda repul, ahova az mutat. A vilagbeli celpontot a
 * SceneView szamolja ki sugar-vetitéssel (lasd aimPointAt).
 */
export class Aim {
  private readonly element: HTMLElement;
  private readonly debugPanel: HTMLElement | null;

  /** Kepernyo-koordinata pixelben. */
  private x = window.innerWidth / 2;
  private y = window.innerHeight / 2;
  /** A kurzor a debug panel folott van-e (ott a rendszer-kurzor kell). */
  private overPanel = false;

  private fireHandler: (() => void) | null = null;

  constructor() {
    const element = document.getElementById("crosshair");
    if (!element) throw new Error("#crosshair nem talalhato");
    this.element = element;
    this.debugPanel = document.getElementById("debug-panel");

    this.element.hidden = false;
    this.render();

    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    // Jobb gombbal ne jojjon fel a bongeszo menuje a palya felett.
    window.addEventListener("contextmenu", this.onContextMenu);
  }

  /** Bal egergombra hivodik (a debug panel folott nem). */
  onFire(handler: () => void): void {
    this.fireHandler = handler;
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
    this.overPanel = this.debugPanel?.contains(e.target as Node) ?? false;
    this.render();
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    // A csuszkak huzasa ne suljon el lovesnek.
    if (this.debugPanel?.contains(e.target as Node)) return;
    this.fireHandler?.();
  };

  private onContextMenu = (e: MouseEvent): void => {
    if (this.debugPanel?.contains(e.target as Node)) return;
    e.preventDefault();
  };

  private render(): void {
    this.element.hidden = this.overPanel;
    this.element.style.left = `${this.x}px`;
    this.element.style.top = `${this.y}px`;
  }

  dispose(): void {
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("contextmenu", this.onContextMenu);
  }
}
