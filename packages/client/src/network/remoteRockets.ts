import { SNAPSHOT_HZ, type RocketSnapshot } from "@cca/shared";
import { INTERP_DELAY_MS } from "./remotePlayers";

/** Ket snapshot kozott eltelt nevleges ido (ms). */
const SNAPSHOT_INTERVAL_MS = 1000 / SNAPSHOT_HZ;

/**
 * Rakétak pufferelese es interpolacioja -- UGYANAZON az idovonalon,
 * mint a tavoli autok.
 *
 * Miert kell ez egyaltalan:
 *
 *  1. IDOVONAL-EGYEZES. Korabban a rakéta a LEGFRISSEBB snapshotbol
 *     rajzolodott azonnal, a tavoli autok viszont INTERP_DELAY_MS-szel
 *     kesobb. A lovedek igy ~100 ms-szal a celpont ELOTT jart a
 *     kepernyon: 55 m/s-nal 5.5 m. A jatekos tehat nem azt latta, amit
 *     a szerver szamolt -- a rakéta latszolag elhuzott a cel mellett,
 *     miközben a szerver talalatot konyvelt (vagy forditva). Ez volt a
 *     legnagyobb elteres a latvany es a talalat kozott.
 *
 *  2. SIMASAG. A snapshotok 20 Hz-en jonnek, a kepernyo 60+ Hz-en
 *     frissul. Interpolacio nelkul a rakéta snapshotonkent 2.75 m-t
 *     ugrott, ami gyors lovedeknel lathato szaggatas.
 *
 * A mintak idobelyege itt is a LOKALIS beerkezesi ido -- nem kell
 * orajel-szinkron a szerverrel (lasd remotePlayers.ts).
 */

/** Ennel regebbi mintakra mar nincs szukseg. */
const BUFFER_KEEP_MS = 1000;

/**
 * Az utolso minta utan ennyi ideig (ms) meg TOVABBVETITJUK a lovedeket.
 *
 * A szerver 20 Hz-en kuld snapshotot, de 60 Hz-en lepteti a rakétat.
 * Amikor a lovedek becsapodik, az utolso ELKULDOTT pozicioja akar egy
 * teljes snapshot-lepessel (55 m/s-nal 2.75 m) a talalati pont elott
 * van -- az utolso pillanatai egyszeruen nem kerulnek at a halozaton.
 * E nelkul a kiegeszites nelkul a rakéta lathatoan a cel ELOTT tunik
 * el, es a jatekos nem azt latja, ami tortent. (Meres: a lovedek
 * z = 5.8-nal tunt el, miközben a talalat z = 3.05-nel volt.)
 *
 * A tovabbvetites itt PONTOS, nem talalgatas: a rakétara nem hat
 * gravitacio es nem kormanyozzuk, tehat egyenes vonalu egyenletes
 * mozgast vegez. Egy snapshot-nyi ablak epp a hianyzo darabot fedi le;
 * ennel tovabb mar athajtana a celon.
 */
const EXTRAPOLATE_MS = 55;

interface Sample {
  time: number;
  position: [number, number, number];
  direction: [number, number, number];
}

export interface RenderedRocket {
  id: number;
  ownerId: string;
  position: [number, number, number];
  direction: [number, number, number];
}

export class RemoteRockets {
  private readonly buffers = new Map<number, Sample[]>();
  private readonly owners = new Map<number, string>();

  /** Egy beerkezett snapshot rakéta-listaja. */
  ingest(rockets: RocketSnapshot[], receivedAt: number): void {
    for (const rocket of rockets) {
      this.owners.set(rocket.id, rocket.ownerId);

      let buffer = this.buffers.get(rocket.id);
      if (!buffer) {
        buffer = [];
        this.buffers.set(rocket.id, buffer);
      }
      buffer.push({
        time: receivedAt,
        position: rocket.position,
        direction: rocket.direction,
      });

      const cutoff = receivedAt - BUFFER_KEEP_MS;
      while (buffer.length > 2 && buffer[0].time < cutoff) buffer.shift();
    }
  }

  clear(): void {
    this.buffers.clear();
    this.owners.clear();
  }

  /**
   * A megjelenitendo rakétak `now` (lokalis ido) pillanataban.
   *
   * Egy rakéta akkor tunik el, amikor a megjelenitett idopont TULLEP az
   * utolso ismert mintajan -- vagyis pontosan akkor, amikor a jatekos a
   * kesleltetett idovonalon a robbanast latja. Ha a beerkezeskor
   * torolnenk, a lovedek 100 ms-szal a robbanas elott tunne el.
   */
  sample(now: number): RenderedRocket[] {
    const renderTime = now - INTERP_DELAY_MS;
    const out: RenderedRocket[] = [];

    for (const [id, buffer] of this.buffers) {
      const last = buffer[buffer.length - 1];
      if (renderTime > last.time) {
        // A megjelenitett ido tullepte az utolso mintat: vagy felrobbant,
        // vagy megszakadt az adatfolyam.
        const ahead = renderTime - last.time;

        if (ahead <= EXTRAPOLATE_MS && buffer.length >= 2) {
          // A hianyzo utolso darab kiegeszitese. A sebesseget az utolso
          // KET mintabol olvassuk ki, nem a konstansbol: a kilovo auto
          // sebessege hozzaadodik a lovedekehez, tehat a valodi sebesseg
          // lovesenkent mas.
          const prev = buffer[buffer.length - 2];
          const span = last.time - prev.time;

          // A ket minta kozott ERTELMES ido teljen el.
          //
          // Halozati ingadozas mellett ket snapshot beerkezhet szinte
          // egyszerre (span ~ 1 ms). A sebesseg ilyenkor nem
          // meghatarozhato: az `ahead / span` hanyados a valodi 55 ms-os
          // lepest tizszeresere-szazszorosara nagyitja. Meressel:
          // a lovedek ilyenkor z = -517-re "repult" a z = 3 helyett --
          // vagyis atszallt az egesz palyan. Az also hatar egy
          // snapshot-koz fele; ez alatt inkabb nem vetitunk tovabb.
          if (span >= SNAPSHOT_INTERVAL_MS / 2) {
            const k = ahead / span;
            out.push({
              id,
              ownerId: this.owners.get(id) ?? "",
              position: [
                last.position[0] + (last.position[0] - prev.position[0]) * k,
                last.position[1] + (last.position[1] - prev.position[1]) * k,
                last.position[2] + (last.position[2] - prev.position[2]) * k,
              ],
              direction: last.direction,
            });
            continue;
          }
        }

        if (now - last.time > BUFFER_KEEP_MS) {
          this.buffers.delete(id);
          this.owners.delete(id);
        }
        continue;
      }

      let older: Sample | null = null;
      let newer: Sample | null = null;
      for (let i = buffer.length - 1; i >= 0; i--) {
        if (buffer[i].time <= renderTime) {
          older = buffer[i];
          newer = buffer[i + 1] ?? null;
          break;
        }
      }

      // A renderTime meg az elso minta elott van: a rakéta a
      // kesleltetett idovonalon meg "nem szuletett meg". Ne rajzoljuk --
      // kulonben a kilovesnel egy pillanatra a kiindulopontjan allna.
      if (!older) continue;

      const ownerId = this.owners.get(id) ?? "";
      if (!newer) {
        out.push({ id, ownerId, position: older.position, direction: older.direction });
        continue;
      }

      const span = newer.time - older.time;
      const t = span > 0 ? Math.min(Math.max((renderTime - older.time) / span, 0), 1) : 0;

      out.push({
        id,
        ownerId,
        position: [
          older.position[0] + (newer.position[0] - older.position[0]) * t,
          older.position[1] + (newer.position[1] - older.position[1]) * t,
          older.position[2] + (newer.position[2] - older.position[2]) * t,
        ],
        // Az irany gyakorlatilag allando egy lovedek eleteben (nincs
        // gravitacio a rakétan), ezert eleg a regebbi mintat atvenni --
        // a normalizalast igy nem is kell ujra elvegezni.
        direction: older.direction,
      });
    }

    return out;
  }
}
