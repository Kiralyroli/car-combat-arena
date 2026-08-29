import {
  DEFAULT_ABILITY,
  toAbilityId,
  type AbilityId,
  DEFAULT_CAR,
  DEFAULT_SKIN,
  DEFAULT_WEAPON,
  MAX_NAME_LENGTH,
  sanitizePlayerName,
  toWeaponId,
  type RoomListing,
  toCarId,
  toSkin,
  type CarId,
  type CarLook,
  type WeaponId,
} from "@cca/shared";
import { CarPreview } from "./carPreview";
import { AbilityPicker, CarSkinPicker, WeaponPicker } from "./weaponPicker";

/**
 * Lobby: nev megadasa es szoba-valasztas (terv 5. lepcso 1. pont).
 *
 * Harom ut vezet a palyara:
 *  - UJ SZOBA: a szerver nyit egyet, a kodot utana meg lehet osztani,
 *  - LISTA: a nyitott szobak kozul valasztva -- ehhez semmit nem kell
 *    tudni elore, ez a legfontosabb ut egy uj jatekosnak,
 *  - KEZI KOD: ha valaki linket vagy kodot kapott.
 *
 * A lista a szervertol jon, es amig a lobby nyitva van, RENDSZERESEN
 * frissul: kulonben egy kozben nyitott szoba nem jelenne meg, es a
 * jatekosnak ujra kellene toltenie az oldalt.
 */

const STORAGE_KEY = "cca.playerName";
const WEAPON_STORAGE_KEY = "cca.weapon";
const ABILITY_STORAGE_KEY = "cca.ability";
const CAR_STORAGE_KEY = "cca.car";

/** Milyen surun kerjuk ujra a szoba-listat, amig a lobby nyitva van. */
const REFRESH_MS = 2000;

export interface LobbyChoice {
  name: string;
  /** Undefined = uj szobat nyitunk. */
  roomCode?: string;
  weapon: WeaponId;
  ability: AbilityId;
  car: CarId;
  /** A valasztott festes a kocsin. */
  skin: string;
}

export class Lobby {
  private readonly root: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly roomInput: HTMLInputElement;
  private readonly createBtn: HTMLButtonElement;
  private readonly joinBtn: HTMLButtonElement;
  private readonly list: HTMLElement;
  private readonly error: HTMLElement;
  private readonly weapons: WeaponPicker;
  private readonly abilities: AbilityPicker;
  private readonly cars: CarSkinPicker;

  /**
   * A NAGY elonezet vaszna es a rajzolo.
   *
   * A rajzolo csak akkor keszul el, ha a hivo ad modell-epitot (lasd
   * setCarPreview): a mero szkriptek es a tesztek egy resze modellek
   * nelkul is megnyitja a lobbyt, es attol meg mukodnie kell.
   */
  private readonly previewCanvas: HTMLCanvasElement;
  private preview: CarPreview | null = null;
  private previewEpito:
    | ((
        car: CarId,
        skin: string,
        weapon?: WeaponId,
      ) => import("three").Object3D | null)
    | null = null;
  /** A festes-texturak bevarasa (a jatek jelenetebol). */
  private previewKesz: (() => Promise<number>) | null = null;
  /** Epp fut-e a belyegkep-frissito hurok (ne induljon ketto). */
  private belyegkepFut = false;

  private resolve: ((choice: LobbyChoice) => void) | null = null;
  private refreshTimer: number | null = null;
  private onRefresh: (() => void) | null = null;

  constructor() {
    this.root = must("lobby");
    this.nameInput = must("name-input") as HTMLInputElement;
    this.roomInput = must("room-input") as HTMLInputElement;
    this.createBtn = must("lobby-create") as HTMLButtonElement;
    this.joinBtn = must("lobby-join") as HTMLButtonElement;
    this.list = must("room-list");
    this.error = must("lobby-error");
    this.previewCanvas = must("car-preview") as HTMLCanvasElement;
    // A valasztas megmarad a kovetkezo meccsre is: aki egyszer eldontotte,
    // ne kelljen minden belepesnel ujra rakattintania.
    this.weapons = new WeaponPicker("weapon-pick", readStoredWeapon(), (weapon) => {
      storeWeapon(weapon);
      // A fegyver is a KINEZET resze: a forgo auton azonnal latszik,
      // mi kerul a tetejere.
      this.preview?.setWeapon(weapon);
    });
    this.abilities = new AbilityPicker(
      "ability-pick",
      readStoredAbility(),
      (ability) => storeAbility(ability),
    );
    this.cars = new CarSkinPicker(
      "car-pick",
      "skin-pick",
      readStoredCar(),
      (look) => {
        storeCar(look);
        // A nagy elonezet AZONNAL koveti a valasztast -- ez az egesz
        // valaszto lenyege: a jatekos lassa, mit valaszt.
        this.preview?.show(look.car, look.skin);
        // Masik autora valtva UJ festesek kellenek: a most kirajzolt
        // belyegkepek meg a modell alap texturajaval keszultek.
        void this.belyegkepeketFrissit();
      },
    );

    // Ugyanaz a korlat, mint a szerveren -- igy a jatekos nem gepel be
    // olyan nevet, amit a szerver utana csendben levag.
    this.nameInput.maxLength = MAX_NAME_LENGTH;

    this.createBtn.addEventListener("click", () => this.choose(undefined));
    this.joinBtn.addEventListener("click", () => this.chooseTypedCode());
    this.roomInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.chooseTypedCode();
    });
  }

  /**
   * Az AUTO-ELONEZET bekapcsolasa.
   *
   * A hivo adja at a modell-epitot (a jatek jelenetebol), mert a lobby
   * nem ismeri a 3D reteget. Enelkul a valaszto nev szerint mukodik
   * tovabb -- kepek nelkul.
   */
  setCarPreview(
    epito: (
      car: CarId,
      skin: string,
      weapon?: WeaponId,
    ) => import("three").Object3D | null,
    kesz?: () => Promise<number>,
  ): void {
    this.previewEpito = epito;
    this.previewKesz = kesz ?? null;
  }

  /** A gombok belyegkepeinek ujrarajzolasa a jelenlegi rajzoloval. */
  private belyegkepeketRajzol(): void {
    this.cars.setThumbnailer((car, skin, w, h) =>
      this.preview ? this.preview.thumbnail(car, skin, w, h) : "",
    );
  }

  /**
   * A belyegkepek KESZRE rajzolasa.
   *
   * A festes-texturak halozatrol jonnek: az elso rajzolaskor meg
   * nincsenek meg, es minden gombon a modell alap (fekete) texturaja
   * latszana. Ezert megvarjuk a folyamatban levo betolteseket, es
   * ujrarajzolunk -- addig ismetelve, amig egy kor mar nem kert ujabb
   * texturat (a masodik auto festesei csak az elso rajzolaskor
   * indulnak el).
   */
  private async belyegkepeketFrissit(): Promise<void> {
    if (!this.previewKesz || this.belyegkepFut) return;
    this.belyegkepFut = true;
    try {
      let elozo = -1;
      // A felso hatar csak biztositek: harom kor alatt minden gomb
      // texturaja megerkezik. Vegtelen hurok igy sem lehet belole.
      for (let kor = 0; kor < 4; kor++) {
        const db = await this.previewKesz();
        if (!this.preview || db === elozo) return;
        elozo = db;
        this.belyegkepeketRajzol();
      }
    } finally {
      this.belyegkepFut = false;
    }
  }

  /** A lista frissiteset a hivo vegzi (o ismeri a halozatot). */
  setRefreshHandler(handler: () => void): void {
    this.onRefresh = handler;
  }

  /**
   * Megnyitja a lobbyt, es a valasztassal ter vissza.
   *
   * @param message Hibauzenet az elozo probalkozasrol, ha volt.
   */
  /** A jelenleg valasztott fegyver -- a halal-kepernyo is ezt mutatja. */
  get weapon(): WeaponId {
    return this.weapons.value;
  }

  open(message?: string): Promise<LobbyChoice> {
    this.nameInput.value = readStoredName();
    this.weapons.set(readStoredWeapon());
    this.abilities.set(readStoredAbility());
    this.cars.set(readStoredCar());
    this.error.hidden = message === undefined;
    this.error.textContent = message ?? "";
    this.root.hidden = false;
    this.nameInput.focus();
    this.nameInput.select();

    // Az elonezet a MEGNYITASKOR epul fel, es a bezarasnal all le: egy
    // meccs alatt semmi szukseg egy forgo autora (es egy WebGL
    // kontextusra). A lobby tobbszor is megnyilhat -- sikertelen
    // belepes utan --, ezert kell ujra felepiteni.
    if (this.previewEpito && !this.preview) {
      this.preview = new CarPreview(this.previewEpito);
      this.preview.setWeapon(this.weapons.value);
      this.belyegkepeketRajzol();
      void this.belyegkepeketFrissit();
    }
    const valasztott = this.cars.value;
    this.preview?.live(this.previewCanvas, valasztott.car, valasztott.skin);

    // Azonnal kerunk egy listat, utana rendszeresen.
    this.onRefresh?.();
    this.refreshTimer = window.setInterval(() => this.onRefresh?.(), REFRESH_MS);

    return new Promise<LobbyChoice>((resolve) => {
      this.resolve = resolve;
    });
  }

  /** A szervertol kapott szoba-lista megjelenitese. */
  showRooms(rooms: RoomListing[]): void {
    if (this.root.hidden) return;

    this.list.textContent = "";
    if (rooms.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Nincs nyitott szoba -- nyiss egyet!";
      this.list.appendChild(empty);
      return;
    }

    for (const room of rooms) {
      const full = room.players >= room.maxPlayers;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "room";
      button.disabled = full;

      const code = document.createElement("span");
      code.className = "code";
      code.textContent = room.code;

      const meta = document.createElement("span");
      meta.className = "meta";
      const phase =
        room.phase === "playing"
          ? "megy a meccs"
          : room.phase === "ended"
            ? "meccs vege"
            : "varakozik";
      meta.textContent = full
        ? `TELE (${room.players}/${room.maxPlayers})`
        : `${room.players}/${room.maxPlayers} - ${phase}`;

      button.append(code, meta);
      if (!full) button.addEventListener("click", () => this.choose(room.code));
      this.list.appendChild(button);
    }
  }

  private chooseTypedCode(): void {
    const code = this.roomInput.value.trim().toUpperCase();
    if (code.length === 0) {
      this.error.hidden = false;
      this.error.textContent = "Adj meg egy szobakodot, vagy nyiss uj szobat.";
      return;
    }
    this.choose(code);
  }

  private choose(roomCode: string | undefined): void {
    const name = sanitizePlayerName(this.nameInput.value, "HELYI");
    storeName(name);
    this.close();
    this.resolve?.({
      name,
      roomCode,
      weapon: this.weapons.value,
      ability: this.abilities.value,
      car: this.cars.value.car,
      skin: this.cars.value.skin,
    });
    this.resolve = null;
  }

  private close(): void {
    this.root.hidden = true;
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    // Az elonezet WebGL kontextusa nem kell tovabb: a meccs alatt egy
    // felesleges renderelo futna a hatterben.
    this.preview?.dispose();
    this.preview = null;
  }
}

/**
 * A szobakod megjelenitese jatek kozben, megoszthato linkkel.
 *
 * E nelkul a jatekos csak az URL-bol tudna kimasolni a kodot -- egy
 * tesztelonek ezt nem lehet elmagyarazni.
 */
export class RoomBadge {
  private readonly root: HTMLElement;
  private readonly code: HTMLElement;
  private readonly copy: HTMLButtonElement;

  constructor() {
    this.root = must("room-badge");
    this.code = must("room-code");
    this.copy = must("room-copy") as HTMLButtonElement;

    this.copy.addEventListener("click", () => {
      const link = `${location.origin}${location.pathname}#${this.code.textContent ?? ""}`;
      navigator.clipboard?.writeText(link).then(
        () => {
          this.copy.textContent = "masolva";
          window.setTimeout(() => (this.copy.textContent = "link masolasa"), 1500);
        },
        () => {
          // A vagolap engedelyhez kotott lehet -- ilyenkor a kod
          // legalabb lathato marad, kezzel is atadhato.
          this.copy.textContent = "nem sikerult";
        },
      );
    });
  }

  show(roomCode: string): void {
    this.code.textContent = roomCode;
    this.root.hidden = false;
  }
}

/**
 * A korabban valasztott kinezet: "<auto>|<festes>".
 *
 * EGY kulcsban a ketto, mert egyutt ervenyesek: a festesek autonkent
 * masok, tehat kulon tarolva egy auto-valtas utan ervenytelen festes
 * maradna bent.
 */
function readStoredCar(): CarLook {
  try {
    const tarolt = localStorage.getItem(CAR_STORAGE_KEY) ?? "";
    const [auto, festes] = tarolt.split("|");
    const car = toCarId(auto);
    return { car, skin: toSkin(car, festes) };
  } catch {
    return { car: DEFAULT_CAR, skin: DEFAULT_SKIN };
  }
}

function storeCar(look: CarLook): void {
  try {
    localStorage.setItem(CAR_STORAGE_KEY, `${look.car}|${look.skin}`);
  } catch {
    // Privat mod vagy letiltott tarolas: a valasztas csak erre a
    // menetre ervenyes. Nem hiba, nem allitjuk meg.
  }
}

function readStoredWeapon(): WeaponId {
  try {
    return toWeaponId(localStorage.getItem(WEAPON_STORAGE_KEY) ?? DEFAULT_WEAPON);
  } catch {
    return DEFAULT_WEAPON;
  }
}

function storeWeapon(weapon: WeaponId): void {
  try {
    localStorage.setItem(WEAPON_STORAGE_KEY, weapon);
  } catch {
    // Privat mod vagy letiltott tarolas: a valasztas csak erre a
    // menetre ervenyes. Nem hiba, nem allitjuk meg.
  }
}

/**
 * A valasztott KEPESSEG megjegyzese -- ugyanugy, mint a fegyvere.
 *
 * Aki egyszer eldontotte, ne kelljen minden belepesnel ujra
 * rakattintania.
 */
function readStoredAbility(): AbilityId {
  try {
    return toAbilityId(
      localStorage.getItem(ABILITY_STORAGE_KEY) ?? DEFAULT_ABILITY,
    );
  } catch {
    return DEFAULT_ABILITY;
  }
}

function storeAbility(ability: AbilityId): void {
  try {
    localStorage.setItem(ABILITY_STORAGE_KEY, ability);
  } catch {
    // Privat mod vagy letiltott tarolas -- lasd storeWeapon.
  }
}

function readStoredName(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeName(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // Privat mod vagy letiltott tarolas: a nev csak erre a menetre
    // ervenyes. Nem hiba.
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} nem talalhato`);
  return el;
}
