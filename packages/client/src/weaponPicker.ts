import {
  CAR_MODELS,
  carModel,
  skinsOf,
  toAbilityId,
  toCarId,
  toSkin,
  toWeaponId,
  type AbilityId,
  type CarId,
  type CarLook,
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

/**
 * AUTOVALASZTO: karosszeria ES festes, ket sorban.
 *
 * MIERT KET SZINT: negy karosszeria van, mindegyikhez harom-ot festes.
 * Egyetlen listaban tizenhat gomb allna, amiben a FORMA -- a fontosabb
 * valasztas -- elveszne. Igy eloszor a kocsit valasztja a jatekos,
 * utana a festeset.
 *
 * A gombokat a KOZOS autolistabol (CAR_MODELS) rajzoljuk, nem kezzel
 * irt HTML-bol: a festesek autonkent masok, tehat a masodik sor a
 * valasztassal EGYUTT valtozik -- kezzel karbantartva ez elobb-utobb
 * elcsuszna a jatek adataitol.
 */
export class CarSkinPicker {
  private readonly carRoot: HTMLElement;
  private readonly skinRoot: HTMLElement;
  private readonly onChange: (look: CarLook) => void;
  private car: CarId;
  private skin: string;
  private enabled = true;

  constructor(
    carContainerId: string,
    skinContainerId: string,
    initial: CarLook,
    onChange: (look: CarLook) => void,
    /**
     * BELYEGKEP-keszito: egy auto+festes kis kepe (data-URL).
     *
     * Opcionalis: ha nincs (pl. a modellek meg nem alltak fel), a
     * gombokon csak a nev latszik. A valasztas igy is mukodik --
     * kepek nelkul csak kevesbe kenyelmes.
     */
    private belyegkep?: (
      car: CarId,
      skin: string,
      szeles: number,
      magas: number,
    ) => string,
  ) {
    const carRoot = document.getElementById(carContainerId);
    const skinRoot = document.getElementById(skinContainerId);
    if (!carRoot) throw new Error(`#${carContainerId} nem talalhato`);
    if (!skinRoot) throw new Error(`#${skinContainerId} nem talalhato`);
    this.carRoot = carRoot;
    this.skinRoot = skinRoot;
    this.onChange = onChange;
    this.car = toCarId(initial.car);
    this.skin = toSkin(this.car, initial.skin);
    this.renderCars();
    this.renderSkins();
  }

  get value(): CarLook {
    return { car: this.car, skin: this.skin };
  }

  /**
   * A belyegkep-keszito UTOLAG is beallithato.
   *
   * A lobby a megnyitaskor keszit uj rajzolot (a bezarasnal eldobja a
   * WebGL kontextust), a valaszto viszont a lobbyval egyutt jon
   * letre. Beallitaskor ujrarajzoljuk a gombokat, kulonben a kepek
   * csak a kovetkezo valasztasnal jelennenek meg.
   */
  setThumbnailer(
    keszito: (car: CarId, skin: string, szeles: number, magas: number) => string,
  ): void {
    this.belyegkep = keszito;
    this.renderCars();
    this.renderSkins();
  }

  /** Beallitas ERTESITES NELKUL -- pl. amikor a szerver mond ellent. */
  set(look: CarLook): void {
    this.car = toCarId(look.car);
    this.skin = toSkin(this.car, look.skin);
    this.renderCars();
    this.renderSkins();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    for (const b of this.carRoot.querySelectorAll("button")) {
      b.disabled = !enabled;
    }
    for (const b of this.skinRoot.querySelectorAll("button")) {
      b.disabled = !enabled;
    }
  }

  private gomb(
    nev: string,
    leiras: string,
    kivalasztott: boolean,
    kattintas: () => void,
    kep?: string,
  ): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = kep ? "weapon carbtn" : "weapon";
    b.disabled = !this.enabled;
    // Az allapotot az aria-pressed hordozza, nem sajat CSS-osztaly:
    // igy a kepernyoolvaso is helyesen mondja be.
    b.setAttribute("aria-pressed", kivalasztott ? "true" : "false");
    if (kep) {
      const img = document.createElement("img");
      img.src = kep;
      img.alt = "";
      img.className = "carthumb";
      b.append(img);
    }
    const cim = document.createElement("span");
    cim.className = "wname";
    cim.textContent = nev;
    b.append(cim);
    if (leiras) {
      const d = document.createElement("span");
      d.className = "wdesc";
      d.textContent = leiras;
      b.append(d);
    }
    // A festes-kockakon a felirat rejtve van: a "title" mondja meg,
    // mit valasztunk, ha valaki raviszi az egeret.
    b.title = nev;
    b.addEventListener("click", kattintas);
    return b;
  }

  private renderCars(): void {
    this.carRoot.replaceChildren(
      ...CAR_MODELS.map((m) =>
        this.gomb(
          m.label,
          m.leiras,
          m.id === this.car,
          () => {
            if (m.id === this.car) return;
            this.car = m.id;
            // A festesek AUTONKENT masok: uj kocsinal az elsore allunk.
            this.skin = skinsOf(m.id)[0];
            this.renderCars();
            this.renderSkins();
            this.onChange(this.value);
          },
          // A KIVALASZTOTT auto a sajat festesevel latszik, a tobbi
          // az elsovel: igy az auto-sorban is latszik, mit valasztott
          // a jatekos a festes-sorban.
          this.belyegkep?.(
            m.id,
            m.id === this.car ? this.skin : skinsOf(m.id)[0],
            240,
            150,
          ),
        ),
      ),
    );
  }

  private renderSkins(): void {
    const modell = carModel(this.car);
    this.skinRoot.replaceChildren(
      ...modell.skins.map((s) =>
        this.gomb(
          s.label,
          "",
          s.id === this.skin,
          () => {
            if (s.id === this.skin) return;
            this.skin = s.id;
            this.renderSkins();
            // Az auto-gomb kepe is a friss festest mutatja.
            this.renderCars();
            this.onChange(this.value);
          },
          // A festes-gombon a KIVALASZTOTT auto latszik, azzal a
          // festessel: igy a jatekos azt latja, amit valaszt.
          this.belyegkep?.(this.car, s.id, 96, 64),
        ),
      ),
    );
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
