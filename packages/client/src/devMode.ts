/**
 * Fejlesztoi ("dev") mod.
 *
 * A jatek KET arcot mutat:
 *  - Jatekosnak: HP, boost, eletek, meccs-allapot, sebesseg. Semmi mas.
 *  - Fejlesztonek: ezen felul a fizika-csuszkak es a technikai
 *    szamlalok (fps, ping, fizikai lepesido, kerekenkenti tapadas,
 *    backend verzio).
 *
 * MIERT KELL SZETVALASZTANI: a csuszkak futasidoben allitjak a
 * fizikat, tehat egy jatekos kezeben elonyt jelentenenek. A technikai
 * szamlalok pedig egyszeruen zajok -- eltakarjak azt, amit a jatekos
 * nezni akar.
 *
 * BEKAPCSOLAS:
 *   - `?dev=1` az URL-ben (ugyanaz a minta, mint a `?lag=` kapcsolo), vagy
 *   - Ctrl+Shift+D barmikor, futas kozben.
 *
 * A valasztas a localStorage-ban marad meg, hogy fejlesztes kozben ne
 * kelljen minden ujratoltesnel visszakapcsolni.
 *
 * FONTOS, hogy ez NEM biztonsagi hatar: a kliens kodja a jatekosnal
 * fut, tehat aki akarja, ugyis bekapcsolja. A vedelmet nem ez adja,
 * hanem az, hogy minden kovetkezmenyt a szerver szamol (terv 15.4) --
 * a csuszkak csak a SAJAT kliens fizikajat allitjak, es a szerver
 * plauzibilitas-ellenorzese ugyanugy vonatkozik ra.
 */

const STORAGE_KEY = "cca.devMode";

export class DevMode {
  private enabled: boolean;
  private readonly listeners: ((enabled: boolean) => void)[] = [];

  constructor() {
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get("dev");

    if (fromUrl !== null) {
      // Az URL-ben megadott ertek ERŐSEBB a tarolt valasztasnal: igy egy
      // `?dev=0` link biztosan tiszta jatekos-nezetet ad, akkor is, ha a
      // gepen korabban bekapcsoltuk.
      this.enabled = fromUrl !== "0" && fromUrl !== "false";
      this.persist();
    } else {
      this.enabled = readStored();
    }

    window.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.shiftKey && event.code === "KeyD") {
        event.preventDefault();
        this.toggle();
      }
    });
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  toggle(): void {
    this.enabled = !this.enabled;
    this.persist();
    for (const listener of this.listeners) listener(this.enabled);
    console.log(`Dev mod: ${this.enabled ? "BE" : "KI"}`);
  }

  /** Ertesites a valtozasrol; azonnal meghivodik a jelenlegi allapottal. */
  onChange(listener: (enabled: boolean) => void): void {
    this.listeners.push(listener);
    listener(this.enabled);
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, this.enabled ? "1" : "0");
    } catch {
      // Privat mod vagy letiltott tarolas: a dev mod ilyenkor csak a
      // jelenlegi oldalbetoltesre ervenyes. Nem hiba, nem allitjuk meg.
    }
  }
}

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
