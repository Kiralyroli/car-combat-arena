import { CAR_COLORS, toCarColorId, type CarColorId } from "@cca/shared";

/**
 * Autoszin-valaszto a lobbyban.
 *
 * A gombokat KODBOL epitjuk, a kozos CAR_COLORS listabol -- nem kezzel
 * irjuk be a HTML-be. Igy egy uj szin hozzaadasa egyetlen helyen
 * tortenik, es a lobby nem tud elcsuszni attol, amit a jatek valojaban
 * ismer.
 *
 * A kivalasztott allapotot az `aria-pressed` hordozza, mint a
 * fegyvervalasztonal (lasd WeaponPicker): igy a kepernyoolvaso is
 * helyesen mondja be, es a stilus egy forrasbol jon.
 */
export class ColorPicker {
  private readonly buttons = new Map<CarColorId, HTMLButtonElement>();
  private current: CarColorId;
  private readonly onChange: (color: CarColorId) => void;

  constructor(
    containerId: string,
    initial: CarColorId,
    onChange: (color: CarColorId) => void,
  ) {
    const root = document.getElementById(containerId);
    if (!root) throw new Error(`#${containerId} nem talalhato`);

    this.current = toCarColorId(initial);
    this.onChange = onChange;

    for (const color of CAR_COLORS) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.color = color.id;
      // A szin maga adja a jelentest, de a nev is kell: szin nelkul (pl.
      // kepernyoolvasoval, vagy szinvakon) a kor onmagaban nem mond
      // semmit.
      button.title = color.label;
      button.setAttribute("aria-label", color.label);
      button.style.background = `#${color.hex.toString(16).padStart(6, "0")}`;
      button.addEventListener("click", () => {
        this.set(color.id);
        this.onChange(this.current);
      });
      root.appendChild(button);
      this.buttons.set(color.id, button);
    }

    this.render();
  }

  get value(): CarColorId {
    return this.current;
  }

  /** Beallitas ERTESITES NELKUL -- pl. amikor a szerver mast adott. */
  set(color: CarColorId): void {
    this.current = toCarColorId(color);
    this.render();
  }

  private render(): void {
    for (const [id, button] of this.buttons) {
      button.setAttribute("aria-pressed", id === this.current ? "true" : "false");
    }
  }
}
