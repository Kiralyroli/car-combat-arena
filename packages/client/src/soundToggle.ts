/**
 * Hang ki/be kapcsolo (M vagy a HUD-gomb).
 *
 * MIERT KELL: a jatek egy bongeszofulon fut, gyakran mas mellett. A
 * nemitas nem kenyelmi funkcio, hanem alapkovetelmeny -- e nelkul a
 * jatekos a fulet zarna be a hang miatt.
 *
 * A valasztas MEGMARAD (localStorage, lasd GameAudio): aki lehalkitotta,
 * annak ne szoljon bele ujra minden ujratoltesnel.
 *
 * Ugyanaz a minta, mint a ControlsHelp-nel: a gyorsbillentyu es a gomb
 * ugyanazt teszi, es a gomb egyben hirdeti is, hogy van ilyen.
 */
import type { GameAudio } from "./audio";

export class SoundToggle {
  private readonly button: HTMLElement | null;
  private readonly label: HTMLElement | null;

  constructor(private readonly audio: GameAudio) {
    this.button = document.getElementById("sound-toggle");
    this.label = document.getElementById("sound-state");
    this.button?.addEventListener("click", () => this.toggle());
    window.addEventListener("keydown", this.onKeyDown);
    this.render();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // Gepeles kozben (nev, szobakod) az M betu a mezobe valo, nem
    // nemitas -- ugyanaz a szabaly, mint a tobbi gyorsbillentyunel.
    if (e.code !== "KeyM" || e.repeat) return;
    const el = e.target as (HTMLElement & { type?: string }) | null;
    const tag = typeof el?.tagName === "string" ? el.tagName : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
    this.toggle();
  };

  toggle(): void {
    this.audio.toggle();
    this.render();
  }

  /** Be van-e kapcsolva a hang -- a tesztek ezt olvassak. */
  get enabled(): boolean {
    return this.audio.enabled;
  }

  private render(): void {
    const be = this.audio.enabled;
    if (this.label) this.label.textContent = be ? "hang" : "néma";
    this.button?.classList.toggle("ki", !be);
    this.button?.setAttribute(
      "title",
      be ? "Hang kikapcsolása (M)" : "Hang bekapcsolása (M)",
    );
  }
}
