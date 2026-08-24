import type { WeaponId } from "@cca/shared";
import { WeaponPicker } from "./weaponPicker";

/**
 * Fegyvervalasztas a halal-kepernyon.
 *
 * A valasztas a lobbyban dol el, de minden megsemmisules utan --
 * amig az ujraszuletesre varunk -- meg lehet valtoztatni. Igy lehet
 * alkalmazkodni ahhoz, ami a meccsen tortenik, de menekules kozben nem.
 *
 * A szerver ugyanezt a szabalyt ervenyesiti (lasd Room.setWeapon): ez a
 * panel csak a KERES helye, nem a dontese. Ha a szerver elutasitja, a
 * kovetkezo snapshot visszahozza a regi fegyvert, es a valaszto is arra
 * all vissza -- nincs ket forras ugyanarra az adatra.
 */
export class RespawnWeaponPick {
  private readonly root: HTMLElement;
  private readonly picker: WeaponPicker;
  private readonly countdown: HTMLElement;
  private visible = false;
  private lastShownSecond = -1;

  constructor(onSelect: (weapon: WeaponId) => void) {
    const root = document.getElementById("respawn-pick");
    if (!root) throw new Error("#respawn-pick nem talalhato");
    this.root = root;
    const countdown = document.getElementById("respawn-in");
    if (!countdown) throw new Error("#respawn-in nem talalhato");
    this.countdown = countdown;
    this.picker = new WeaponPicker("respawn-weapons", "cannon", onSelect);
    this.root.hidden = true;
  }

  /**
   * @param dead        Varunk-e eppen ujraszuletesre.
   * @param weapon      A fegyver a SZERVER szerint.
   * @param remainingMs Mennyi van meg hatra a varakozasbol.
   */
  update(dead: boolean, weapon: WeaponId, remainingMs = 0): void {
    if (dead !== this.visible) {
      this.visible = dead;
      this.root.hidden = !dead;
      this.lastShownSecond = -1;
    }
    if (!dead) return;

    // Csak egesz masodpercenkent nyulunk a DOM-hoz: a panel minden
    // frame-ben frissulne, pedig ertelmesen csak ilyen ritkan valtozik.
    const seconds = Math.ceil(remainingMs / 1000);
    if (seconds !== this.lastShownSecond) {
      this.lastShownSecond = seconds;
      this.countdown.textContent = seconds > 0 ? `${seconds} mp` : "";
    }
    // A szerver a mervado: ha elutasitotta a valtast, ide all vissza.
    if (this.picker.value !== weapon) this.picker.set(weapon);
  }
}
