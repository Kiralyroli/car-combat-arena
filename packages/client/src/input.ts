import { DRIVE, FIXED_DT, type DriveInput } from "@cca/shared";

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
  KeyR: "reset",
  KeyF: "fire",
  Digit0: "repairWheels",
  Digit1: "breakWheel0",
  Digit2: "breakWheel1",
  Digit3: "breakWheel2",
  Digit4: "breakWheel3",
};

export class Input {
  private held = new Set<string>();
  /** Simitott kormanyallas, hogy a billentyus vezetes ne legyen kapcsolgatos. */
  private steerValue = 0;
  private listeners: Array<(action: ActionKey) => void> = [];

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  onAction(fn: (action: ActionKey) => void): void {
    this.listeners.push(fn);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
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

  private onKeyUp = (e: KeyboardEvent): void => {
    const key = KEY_MAP[e.code];
    if (key) this.held.delete(key);
  };

  /** Fokuszvesztesnel ne ragadjon be a gaz. */
  private onBlur = (): void => {
    this.held.clear();
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
      const delta = DRIVE.steerReturnSpeed * FIXED_DT;
      if (Math.abs(this.steerValue) <= delta) this.steerValue = 0;
      else this.steerValue -= Math.sign(this.steerValue) * delta;
    } else {
      this.steerValue += steerTarget * DRIVE.steerSpeed * FIXED_DT;
      this.steerValue = Math.max(-1, Math.min(1, this.steerValue));
    }

    return {
      throttle: forward ? 1 : back ? -1 : 0,
      brake: 0,
      steer: this.steerValue,
      handbrake: this.held.has("handbrake"),
      boost: this.held.has("boost"),
      // A tullokest a SZERVER adja (pickup) -- a billentyuzet nem
      // allithatja be. A fo ciklus irja felul a snapshot alapjan.
      superBoost: false,
    };
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.listeners = [];
  }
}
