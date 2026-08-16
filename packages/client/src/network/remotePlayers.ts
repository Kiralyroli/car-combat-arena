import * as THREE from "three";
import type { PlayerSnapshot } from "@cca/shared";

/**
 * Tavoli jatekosok allapotanak pufferelese es interpolacioja.
 *
 * A szerver 20 Hz-en kuld snapshotokat, a kepernyo viszont 60+ Hz-en
 * frissul -- ha a tavoli autokat egyszeruen a legutobbi snapshotra
 * ugratnank, lathatoan szaggatnanak. Ezert egy kis puffert tartunk, es
 * a jelenlegi idonel INTERP_DELAY_MS-szel KORABBI allapotot
 * jelenitjuk meg, ket snapshot kozott interpolalva. Ez a szokasos
 * kompromisszum: kis (allando) kesleltetes aran sima mozgas.
 *
 * FONTOS: a mintak idobelyege a LOKALIS beerkezesi ido, nem a
 * szerver-ido. Igy nem kell orajel-szinkronizacio a szerverrel (ami
 * sajat maga is hibaforras lenne); a valtozo halozati kesleltetest a
 * puffer nyeli el.
 */

/**
 * Mennyivel a jelen mogott renderelunk. 20 Hz-nel 2 snapshot-nyi tartalek.
 *
 * EXPORTALT, mert a rakétak ugyanezt a kesleltetest hasznaljak
 * (lasd remoteRockets.ts). A ketto NEM terhet el: ha a lovedek a
 * jelenbol, a celpont pedig 100 ms-mal korabbrol rajzolodna, akkor a
 * rakéta a kepernyon 100 ms-szal a celpont ELOTT jarna -- 55 m/s-nal
 * 5.5 m --, es a jatekos olyan talalatot latna, ami nem tortent meg
 * (vagy forditva). Egy timeline legyen, egy konstanssal.
 */
export const INTERP_DELAY_MS = 100;

/** Ennel regebbi mintakra mar nincs szukseg. */
const BUFFER_KEEP_MS = 1000;

/**
 * Szogek kozotti interpolacio a ROVIDEBB iranyba.
 *
 * A celzasi szog korbeer: -179 fok es +179 fok kozott a naiv atlagolas
 * az egesz koron atvinne a vetot (358 fokot fordulna 2 helyett), ami
 * lathato porgesnek latszana minden alkalommal, amikor a jatekos
 * athalad a hatso iranyon.
 */
function lerpAngle(a: number, b: number, t: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

interface Sample {
  /** Lokalis beerkezesi ido (performance.now()). */
  time: number;
  position: [number, number, number];
  rotation: [number, number, number, number];
  velocity: [number, number, number];
  steer: number;
  susp: [number, number, number, number];
  grip: [number, number, number, number];
  brokenMask: number;
  aimYaw: number;
  aimPitch: number;
  hp: number;
}

export interface InterpolatedState {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  steer: number;
  susp: [number, number, number, number];
  grip: [number, number, number, number];
  brokenMask: number;
  aimYaw: number;
  aimPitch: number;
  /**
   * A megjelenitett idopillanathoz tartozo HP.
   *
   * SZANDEKOSAN a mintaban van, nem kulon (mindig friss) ertekkent: a
   * tavoli autot INTERP_DELAY_MS-szel korabbrol rajzoljuk, tehat a
   * halalnak is ott kell bekovetkeznie. A legfrissebb HP-t hasznalva az
   * auto ~100 ms-mal AZELOTT tunt el, hogy a latott allapota meghalt
   * volna -- a jatekos ezt "egyszeruen eltunt"-kent latta.
   */
  hp: number;
}

export class RemotePlayers {
  private readonly buffers = new Map<string, Sample[]>();

  /** Ujrahasznositott objektumok -- ne allokaljunk minden frame-ben. */
  private readonly outPos = new THREE.Vector3();
  private readonly outQuat = new THREE.Quaternion();

  /**
   * Tavoli jatekosok HP-ja. SZANDEKOSAN nem interpolaljuk: a HP
   * diszkret, szerver altal eldontott ertek, nem folytonos mozgas --
   * a koztes ertekek megjelenitese csak felrevezetne.
   */
  private readonly hp = new Map<string, number>();

  /** Jatekosonkenti nev a legutobbi snapshotbol. */
  private readonly names = new Map<string, string>();

  /** Jatekosonkenti eletszam a legutobbi snapshotbol (eredmenyjelzo). */
  private readonly lives = new Map<string, number>();

  hpOf(id: string): number | null {
    return this.hp.get(id) ?? null;
  }

  nameOf(id: string): string {
    return this.names.get(id) ?? "";
  }

  livesOf(id: string): number {
    return this.lives.get(id) ?? 0;
  }

  ids(): string[] {
    return [...this.buffers.keys()];
  }

  has(id: string): boolean {
    return this.buffers.has(id);
  }

  remove(id: string): void {
    this.buffers.delete(id);
    this.hp.delete(id);
    this.names.delete(id);
    this.lives.delete(id);
  }

  clear(): void {
    this.buffers.clear();
    this.hp.clear();
    this.names.clear();
    this.lives.clear();
  }

  /** Egy beerkezett snapshot feldolgozasa (a sajat jatekos mar ki van szurve). */
  ingest(players: PlayerSnapshot[], receivedAt: number): void {
    for (const player of players) {
      this.hp.set(player.id, player.hp);
      this.names.set(player.id, player.name);
      this.lives.set(player.id, player.lives);

      let buffer = this.buffers.get(player.id);
      if (!buffer) {
        buffer = [];
        this.buffers.set(player.id, buffer);
      }
      buffer.push({
        time: receivedAt,
        position: player.position,
        rotation: player.rotation,
        velocity: player.velocity,
        steer: player.steer,
        susp: player.susp,
        grip: player.grip,
        brokenMask: player.brokenMask,
        aimYaw: player.aimYaw,
        aimPitch: player.aimPitch,
        hp: player.hp,
      });

      // Regi mintak eldobasa.
      const cutoff = receivedAt - BUFFER_KEEP_MS;
      while (buffer.length > 2 && buffer[0].time < cutoff) buffer.shift();
    }
  }

  /**
   * A megjelenitendo allapot egy adott jatekosra, `now` (lokalis ido)
   * pillanataban. `null`, ha meg nincs eleg adat.
   *
   * A visszaadott objektumok UJRAHASZNOSITOTTAK -- a hivo masolja ki
   * beloluk az erteket, ne tarolja el a referenciat.
   */
  sample(id: string, now: number): InterpolatedState | null {
    const buffer = this.buffers.get(id);
    if (!buffer || buffer.length === 0) return null;

    const renderTime = now - INTERP_DELAY_MS;

    // A renderTime-ot kozrefogo ket minta megkeresese (hatulrol elore,
    // mert szinte mindig a puffer vegen vagyunk).
    let older: Sample | null = null;
    let newer: Sample | null = null;
    for (let i = buffer.length - 1; i >= 0; i--) {
      if (buffer[i].time <= renderTime) {
        older = buffer[i];
        newer = buffer[i + 1] ?? null;
        break;
      }
    }

    if (!older) {
      // A renderTime meg a puffer eleje elott van (frissen csatlakozott
      // jatekos): a legregebbi ismert allapotot mutatjuk.
      return this.emit(buffer[0], buffer[0], 0);
    }
    if (!newer) {
      // Nincs ujabb minta (csomagvesztes vagy megallt a kuldes):
      // megtartjuk az utolso ismert allapotot. Extrapolalni
      // kockazatosabb lenne -- utkozeskor lathatoan "atcsuszna" a
      // falon, majd visszarantana.
      return this.emit(older, older, 0);
    }

    const span = newer.time - older.time;
    const t = span > 0 ? (renderTime - older.time) / span : 0;
    return this.emit(older, newer, Math.min(Math.max(t, 0), 1));
  }

  private emit(a: Sample, b: Sample, t: number): InterpolatedState {
    this.outPos.set(
      a.position[0] + (b.position[0] - a.position[0]) * t,
      a.position[1] + (b.position[1] - a.position[1]) * t,
      a.position[2] + (b.position[2] - a.position[2]) * t,
    );
    this.outVel.set(
      a.velocity[0] + (b.velocity[0] - a.velocity[0]) * t,
      a.velocity[1] + (b.velocity[1] - a.velocity[1]) * t,
      a.velocity[2] + (b.velocity[2] - a.velocity[2]) * t,
    );
    THREE.Quaternion.slerpFlat(
      this.outQuatArray,
      0,
      a.rotation,
      0,
      b.rotation,
      0,
      t,
    );
    this.outQuat.fromArray(this.outQuatArray);

    for (let i = 0; i < 4; i++) {
      this.outSusp[i] = a.susp[i] + (b.susp[i] - a.susp[i]) * t;
      this.outGrip[i] = a.grip[i] + (b.grip[i] - a.grip[i]) * t;
    }

    return {
      position: this.outPos,
      quaternion: this.outQuat,
      velocity: this.outVel,
      steer: a.steer + (b.steer - a.steer) * t,
      susp: this.outSusp,
      grip: this.outGrip,
      // A "tort" allapot diszkret: nincs koztes ertek ket kerek-allapot
      // kozott, ezert NEM interpolaljuk. A megjelenitett idopillanathoz
      // tartozo (regebbi) mintat vesszuk at valtozatlanul.
      brokenMask: a.brokenMask,
      aimYaw: lerpAngle(a.aimYaw, b.aimYaw, t),
      aimPitch: a.aimPitch + (b.aimPitch - a.aimPitch) * t,
      // A HP diszkret (a szerver dönti el, nincs koztes ertek), ezert
      // a brokenMask-hoz hasonloan a REGEBBI mintabol vesszuk at.
      hp: a.hp,
    };
  }

  private readonly outQuatArray = new Array<number>(4);
  private readonly outVel = new THREE.Vector3();
  private readonly outSusp: [number, number, number, number] = [0, 0, 0, 0];
  private readonly outGrip: [number, number, number, number] = [1, 1, 1, 1];
}
