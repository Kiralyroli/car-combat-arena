import { ARCADE, FIXED_DT, RECOVERY, type DriveInput } from "@cca/shared";

const KEY_MAP: Record<string, string> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  Space: "handbrake",
  ShiftLeft: "boost",
  ShiftRight: "boost",
};

export type ActionKey =
  | "reset"
  | "repairWheels"
  | "fire"
  | `breakWheel${0 | 1 | 2 | 3}`;

const ACTION_MAP: Record<string, ActionKey> = {
  // A KeyR SZANDEKOSAN nincs itt: a reset nem egy koccintasra sul el,
  // hanem ot masodperces nyomva tartasra (lasd pollReset).
  KeyF: "fire",
  Digit0: "repairWheels",
  Digit1: "breakWheel0",
  Digit2: "breakWheel1",
  Digit3: "breakWheel2",
  Digit4: "breakWheel3",
};

/** Szoveges bevitelre valo input tipusok. A `range` (dev csuszkak) NEM az. */
const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  "number",
]);

/**
 * Szovegbeviteli mezoben all-e a fokusz?
 *
 * A vezerles az ABLAKON figyel, ezert minden billentyu hozza is eljut --
 * a nev- es szobakod-mezobe gepelve is. A `KEY_MAP` elemeire ráadásul
 * `preventDefault()` fut (hogy a szokoz ne gorgesse az oldalt), ami azt
 * jelentette, hogy a w/a/s/d betut es a szokozt egyaltalan nem lehetett
 * beirni a nevbe. Az `ACTION_MAP` meg ennel is zavarobb: gepeles kozben
 * az "r" ujraszuletest, az "f" raketat, az 1-4 kerektorest valtott ki.
 *
 * SZANDEKOSAN duck-typing (nem `instanceof`): igy a fuggveny sima
 * objektumokkal is tesztelheto, DOM nelkul.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  const el = target as (HTMLElement & { type?: string }) | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.isContentEditable) return true;

  const tag = el.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag !== "input") return false;

  return TEXT_INPUT_TYPES.has((el.type ?? "text").toLowerCase());
}

export class Input {
  private held = new Set<string>();
  /**
   * Mikor kezdtek nyomni az R-t (performance.now), vagy null.
   *
   * A reset NYOMVA TARTASRA sul el, nem lenyomasra: egy vegigfutó gomb
   * veletlenul is elsutotte, es a jatekos elvesztette a felepitett
   * helyzetet.
   */
  private resetSince: number | null = null;
  /** Elsult-e mar ebben a lenyomasban (hogy ne ismetlodjon). */
  private resetKesz = false;
  /** Simitott kormanyallas, hogy a billentyus vezetes ne legyen kapcsolgatos. */
  private steerValue = 0;
  private listeners: Array<(action: ActionKey) => void> = [];

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("focusin", this.onFocusIn);
  }

  onAction(fn: (action: ActionKey) => void): void {
    this.listeners.push(fn);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // Gepeles kozben a vezerles nem nyul a billentyukhoz (lasd isTextEntry).
    if (isTextEntry(e.target)) return;

    // A RESET nyomva tartasra sul el. Az ismetlodo esemenyeket
    // kihagyjuk: a kezdo idopont a LENYOMASE, nem az utolso ismetlese.
    if (e.code === "KeyR") {
      if (this.resetSince === null) {
        this.resetSince = performance.now();
        this.resetKesz = false;
      }
      e.preventDefault();
    }

    const action = ACTION_MAP[e.code];
    if (action && !e.repeat) {
      for (const fn of this.listeners) fn(action);
    }
    const key = KEY_MAP[e.code];
    if (key) {
      this.held.add(key);
      e.preventDefault();
    }
  };

  /**
   * A felengedest SZANDEKOSAN nem szurjuk: ha egy billentyut a palyan
   * nyomtak le, de a fokusz kozben mezobe kerult, a felengedesnek akkor
   * is torolnie kell -- kulonben beragadna a gaz.
   */
  private onKeyUp = (e: KeyboardEvent): void => {
    // ELENGEDVE a visszaszamlalas nullarol indul ujra: a reset SZANDEKOS
    // legyen, ne osszegyujtott fel-fel masodpercekbol alljon ossze.
    if (e.code === "KeyR") this.resetSince = null;
    const key = KEY_MAP[e.code];
    if (key) this.held.delete(key);
  };

  /** Mezobe kattintva se maradjon nyomva semmi. */
  private onFocusIn = (e: FocusEvent): void => {
    if (isTextEntry(e.target)) {
      this.held.clear();
      this.resetSince = null;
    }
  };

  /**
   * Mennyire telt le a reset nyomva tartasa (0..1).
   *
   * A fo ciklus hivja kepkockankent: itt sul el a reset, es innen jon a
   * kijelzes is. Az IDOBOL szamol, nem kepkockakbol -- kulonben lassabb
   * gepen tovabb tartana.
   */
  pollReset(now: number = performance.now()): number {
    if (this.resetSince === null) return 0;
    const arany = Math.min(1, (now - this.resetSince) / RECOVERY.holdMs);
    if (arany >= 1 && !this.resetKesz) {
      this.resetKesz = true;
      for (const fn of this.listeners) fn("reset");
    }
    return arany;
  }

  /** Fokuszvesztesnel ne ragadjon be a gaz. */
  private onBlur = (): void => {
    this.held.clear();
    // Ablakot valtva a visszaszamlalas is alljon le: kulonben a jatekos
    // visszaterve azonnal ujraindulna.
    this.resetSince = null;
  };

  /**
   * Az aktualis input allapot. A kormanyt fix lepeskozzel simitjuk,
   * hogy frame-rate fuggetlen legyen.
   */
  read(): DriveInput {
    const forward = this.held.has("forward");
    const back = this.held.has("back");
    const left = this.held.has("left");
    const right = this.held.has("right");

    const steerTarget = (left ? -1 : 0) + (right ? 1 : 0);
    if (steerTarget === 0) {
      // Visszaall kozepre
      const delta = ARCADE.steerReturnSpeed * FIXED_DT;
      if (Math.abs(this.steerValue) <= delta) this.steerValue = 0;
      else this.steerValue -= Math.sign(this.steerValue) * delta;
    } else {
      this.steerValue += steerTarget * ARCADE.steerSpeed * FIXED_DT;
      this.steerValue = Math.max(-1, Math.min(1, this.steerValue));
    }

    return {
      throttle: forward ? 1 : back ? -1 : 0,
      brake: 0,
      steer: this.steerValue,
      handbrake: this.held.has("handbrake"),
      // A Shift SZANDEKA; hogy tenylegesen hat-e, a boost-tartalytol
      // fugg (lasd BoostTank) -- azt a fo ciklus dönti el.
      boost: this.held.has("boost"),
    };
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("focusin", this.onFocusIn);
    this.listeners = [];
  }
}
