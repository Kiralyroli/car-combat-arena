import {
  MAX_NAME_LENGTH,
  sanitizePlayerName,
  type RoomListing,
} from "@cca/shared";

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

/** Milyen surun kerjuk ujra a szoba-listat, amig a lobby nyitva van. */
const REFRESH_MS = 2000;

export interface LobbyChoice {
  name: string;
  /** Undefined = uj szobat nyitunk. */
  roomCode?: string;
}

export class Lobby {
  private readonly root: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly roomInput: HTMLInputElement;
  private readonly createBtn: HTMLButtonElement;
  private readonly joinBtn: HTMLButtonElement;
  private readonly list: HTMLElement;
  private readonly error: HTMLElement;

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

    // Ugyanaz a korlat, mint a szerveren -- igy a jatekos nem gepel be
    // olyan nevet, amit a szerver utana csendben levag.
    this.nameInput.maxLength = MAX_NAME_LENGTH;

    this.createBtn.addEventListener("click", () => this.choose(undefined));
    this.joinBtn.addEventListener("click", () => this.chooseTypedCode());
    this.roomInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.chooseTypedCode();
    });
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
  open(message?: string): Promise<LobbyChoice> {
    this.nameInput.value = readStoredName();
    this.error.hidden = message === undefined;
    this.error.textContent = message ?? "";
    this.root.hidden = false;
    this.nameInput.focus();
    this.nameInput.select();

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
    this.resolve?.({ name, roomCode });
    this.resolve = null;
  }

  private close(): void {
    this.root.hidden = true;
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
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
