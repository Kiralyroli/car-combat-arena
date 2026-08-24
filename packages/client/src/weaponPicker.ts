import { toWeaponId, type WeaponId } from "@cca/shared";

/**
 * Fegyvervalaszto gombpar.
 *
 * KET helyen jelenik meg, ugyanazzal a viselkedessel: a lobbyban
 * belepes elott, es a halal-kepernyon az ujraszuletesre varva. Ezert
 * kulon osztaly -- a ket helyen kulon megirt valtozat elobb-utobb
 * elcsuszna egymastol.
 *
 * A kivalasztott allapotot az `aria-pressed` hordozza, nem egy sajat
 * CSS-osztaly: igy a kepernyoolvaso is helyesen mondja be, es a stilus
 * ugyanabbol az egy forrasbol jon.
 */
export class WeaponPicker {
  private readonly buttons: HTMLButtonElement[];
  private current: WeaponId;
  private readonly onChange: (weapon: WeaponId) => void;

  constructor(
    containerId: string,
    initial: WeaponId,
    onChange: (weapon: WeaponId) => void,
  ) {
    const root = document.getElementById(containerId);
    if (!root) throw new Error(`#${containerId} nem talalhato`);

    this.current = toWeaponId(initial);
    this.onChange = onChange;
    this.buttons = [...root.querySelectorAll<HTMLButtonElement>("button[data-weapon]")];

    for (const button of this.buttons) {
      button.addEventListener("click", () => {
        this.set(toWeaponId(button.dataset.weapon));
        this.onChange(this.current);
      });
    }
    this.render();
  }

  get value(): WeaponId {
    return this.current;
  }

  /** Beallitas ERTESITES NELKUL -- pl. amikor a szerver mond ellent. */
  set(weapon: WeaponId): void {
    this.current = toWeaponId(weapon);
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
      const selected = button.dataset.weapon === this.current;
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
  }
}
