import { MAX_NAME_LENGTH, sanitizePlayerName } from "@cca/shared";

/**
 * Nev bekerese indulaskor.
 *
 * A valasztott nev a localStorage-ban marad meg, tehat masodszorra mar
 * elore ki van toltve -- de a parbeszed AKKOR IS megjelenik, hogy meg
 * lehessen valtoztatni. (Egy egyszer beirt, majd sosem modosithato nev
 * bosszanto lenne; a lobby UI a terv 5. lepcso 1. pontja, ez annak az
 * elso, minimalis darabja.)
 *
 * A csatlakozas MEGVARJA a nevet: a szerver a `join` uzenetben kapja
 * meg, es a nevet o tisztitja (lasd sanitizePlayerName). Ha kesobb
 * lehet majd menet kozben nevet valtani, az kulon uzenet lesz.
 */

const STORAGE_KEY = "cca.playerName";

export class NameGate {
  private readonly root: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly button: HTMLButtonElement;

  constructor() {
    this.root = must("name-gate");
    this.input = must("name-input") as HTMLInputElement;
    this.button = must("name-go") as HTMLButtonElement;
    // Ugyanaz a korlat, mint a szerveren -- igy a jatekos nem gepel be
    // olyan nevet, amit a szerver utana csendben levag.
    this.input.maxLength = MAX_NAME_LENGTH;
  }

  /**
   * Megjeleniti a parbeszedet, es a beirt nevvel ter vissza.
   *
   * A `?name=` URL-parameterrel ATUGORHATO -- ez kell az automatizalt
   * teszteknek, kulonben minden e2e futas itt allna meg.
   */
  async ask(): Promise<string> {
    const fromUrl = new URLSearchParams(location.search).get("name");
    if (fromUrl !== null) {
      const name = sanitizePlayerName(fromUrl, "URL");
      store(name);
      return name;
    }

    this.input.value = readStored();
    this.root.hidden = false;
    this.input.focus();
    this.input.select();

    return new Promise<string>((resolve) => {
      const done = (): void => {
        const name = sanitizePlayerName(this.input.value, "HELYI");
        store(name);
        this.root.hidden = true;
        resolve(name);
      };

      this.button.addEventListener("click", done);
      this.input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") done();
      });
    });
  }
}

function readStored(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function store(name: string): void {
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
