/**
 * Vezerles-sugo a JATEKOSNAK.
 *
 * KULON a #help-tol: az a FEJLESZTOI sugo (kerek-kiloves, dev mod
 * kapcsolo), es dev modhoz van kotve. Egy eloszor jatszo barat viszont
 * a lobby utan egybol az arenaban talalja magat, es sehol nem latna,
 * hogy mivel gyorsit vagy lo.
 *
 * CSAK KERESRE nyilik (H vagy a sugo-gomb) -- magatol nem ugrik fel.
 * Hogy egyaltalan TUDNI lehessen rola, a bal felso sarokban all egy
 * allando "H sugo" gomb: az hirdeti a letezeset, es kattintasra
 * ugyanazt teszi.
 *
 * Nincs automatikus elhalvanyulas sem: amit a jatekos maga nyitott ki,
 * azt ne csukjuk be helyette -- lehet, hogy eppen olvassa. A panel
 * amugy sem fogja el a vezerlest (pointer-events: none), tehat nyitva
 * hagyva sem akadalyoz.
 */

export class ControlsHelp {
  private readonly root: HTMLElement;
  private timer: number | null = null;

  constructor() {
    const root = document.getElementById("controls");
    if (!root) throw new Error("#controls nem talalhato");
    this.root = root;

    window.addEventListener("keydown", this.onKeyDown);

    // A gomb ugyanazt teszi, mint a H: aki nem tudja a gyorsbillentyut,
    // rakattinthat -- aki tudja, annak a gomb emlekezteto.
    const button = document.getElementById("help-toggle");
    button?.addEventListener("click", () => this.toggle());
  }

  show(): void {
    this.clearTimer();
    this.root.hidden = false;
    // Egy kepkockat varunk az atmenet miatt: ha a `hidden` levetele es
    // az osztaly torlese ugyanabban a kepkockaban tortenik, a bongeszo
    // nem animal, csak ugrik.
    requestAnimationFrame(() => this.root.classList.remove("faded"));
  }

  hide(): void {
    this.clearTimer();
    this.root.classList.add("faded");
    // A `hidden`-t csak az atmenet UTAN tesszuk vissza, kulonben az
    // elem azonnal eltunne, halvanyulas nelkul.
    this.timer = window.setTimeout(() => {
      this.root.hidden = true;
      this.timer = null;
    }, 700);
  }

  /** Latszik-e eppen -- a tesztek ezt olvassak. */
  get visible(): boolean {
    return !this.root.hidden && !this.root.classList.contains("faded");
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== "KeyH") return;
    // Gepeles kozben (pl. nev a lobbyban) ne kapcsolgasson.
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

    this.toggle();
  };

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.clearTimer();
  }
}
