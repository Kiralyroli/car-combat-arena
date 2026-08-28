import {
  toAbilityId,
  toWeaponId,
  type AbilityId,
  type WeaponId,
} from "@cca/shared";

/**
 * VALASZTO gombsor a loadout egy elemehez (fegyver, kepesseg).
 *
 * KET helyen jelenik meg, ugyanazzal a viselkedessel: a lobbyban
 * belepes elott, es a halal-kepernyon az ujraszuletesre varva. Es KET
 * dologra kell: fegyverre es kepessegre. Negy kulon megirt valtozat
 * elobb-utobb elcsuszna egymastol -- ezert egyetlen osztaly, amit az
 * adat-attributum es az ellenorzo fuggveny parameterez.
 *
 * A kivalasztott allapotot az `aria-pressed` hordozza, nem egy sajat
 * CSS-osztaly: igy a kepernyoolvaso is helyesen mondja be, es a stilus
 * ugyanabbol az egy forrasbol jon.
 */
export class LoadoutPicker<T extends string> {
  private readonly buttons: HTMLButtonElement[];
  private current: T;
  private readonly onChange: (ertek: T) => void;
  private readonly attr: string;
  private readonly normalize: (ertek: unknown) => T;

  constructor(
    containerId: string,
    /** Az adat-attributum neve: "weapon" -> data-weapon. */
    attr: string,
    normalize: (ertek: unknown) => T,
    initial: T,
    onChange: (ertek: T) => void,
  ) {
    const root = document.getElementById(containerId);
    if (!root) throw new Error(`#${containerId} nem talalhato`);

    this.attr = attr;
    this.normalize = normalize;
    this.current = normalize(initial);
    this.onChange = onChange;
    this.buttons = [
      ...root.querySelectorAll<HTMLButtonElement>(`button[data-${attr}]`),
    ];

    for (const button of this.buttons) {
      button.addEventListener("click", () => {
        this.set(this.normalize(button.dataset[this.attr]));
        this.onChange(this.current);
      });
    }
    this.render();
  }

  get value(): T {
    return this.current;
  }

  /** Beallitas ERTESITES NELKUL -- pl. amikor a szerver mond ellent. */
  set(ertek: T): void {
    this.current = this.normalize(ertek);
    this.render();
  }

  /**
   * Hasznalhato-e eppen a valaszto.
   *
   * A halal-kepernyon csak az ujraszuletesig van ertelme; utana a
   * szerver ugyis elutasitana a valtast, es a jatekos hiaba kattintana.
   */
  setEnabled(enabled: boolean): void {
    for (const button of this.buttons) button.disabled = !enabled;
  }

  private render(): void {
    for (const button of this.buttons) {
      const selected = button.dataset[this.attr] === this.current;
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
  }
}

/** Fegyvervalaszto. */
export class WeaponPicker extends LoadoutPicker<WeaponId> {
  constructor(
    containerId: string,
    initial: WeaponId,
    onChange: (weapon: WeaponId) => void,
  ) {
    super(containerId, "weapon", toWeaponId, initial, onChange);
  }
}

/** Kepessegvalaszto -- ugyanaz a viselkedes, mas adat. */
export class AbilityPicker extends LoadoutPicker<AbilityId> {
  constructor(
    containerId: string,
    initial: AbilityId,
    onChange: (ability: AbilityId) => void,
  ) {
    super(containerId, "ability", toAbilityId, initial, onChange);
  }
}
