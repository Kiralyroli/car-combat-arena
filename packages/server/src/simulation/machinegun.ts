import {
  MACHINEGUN,
  type CarId,
  raycastBVH,
  segmentCarEntry,
  segmentCarEntryMesh,
} from "@cca/shared";
import { arenaBVH, autoBVH } from "./collisionMesh";

/**
 * A gepfegyver AZONNALI talalatanak kiertekelese (hitscan).
 *
 * A raketaval ellentetben itt nincs repulo lovedek: a loves
 * pillanataban eldol, mit talalt el. Ezert a kiertekelesnek meg kell
 * mondania, MELYIK celpont van a legkozelebb -- egy sima "eltalalja-e"
 * kerdes nem eleg, mert ket auto egymas mogott is allhat, es a
 * hatsonak nem szabad sebzodnie.
 *
 * A fal es az akadalyok is megallitjak a lovest. Ez nem csak
 * igazsagossag: e nelkul a nyomjelzo csik atmenne a falon, ami azonnal
 * hamisnak latszik.
 */

export interface HitscanTarget {
  id: string;
  position: readonly number[];
  rotation: readonly number[];
  /**
   * A celpont karosszeriaja.
   *
   * A talalati alak ebbol jon: a kocsik 3,7 es 5,8 m kozott vannak,
   * tehat egy kozos alakkal a pickup platojan at lehetne loni, a
   * kisauto korul pedig a levego is talalat lenne.
   */
  car?: CarId;
}

export interface HitscanResult {
  /** Csotorkolat. */
  from: [number, number, number];
  /** Ahol vege lett: auto, akadaly, vagy a hatotav vege. */
  to: [number, number, number];
  /** Kit talalt el, vagy null. */
  hitId: string | null;
}

/**
 * Mi allitja meg a lovest: a palya HAROMSZOG-haloja.
 *
 * Korabban a tengely-parhuzamos dobozok. Azok viszont nem tudnak
 * lyukasak lenni: egy nyilason nem lehetett atlonni, pedig a jatekos
 * latta -- a celkereszt a nyilason volt, a loves megis elakadt. A
 * haromszog-halo pontosan az, amit a jatekos lat (lasd collisionMesh).
 *
 * A talaj is benne van: enelkul a fold fele celzott loves a hatotav
 * vegeig repulne, es a nyomjelzo a semmibe mutatna.
 */

export function resolveHitscan(
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  targets: readonly HitscanTarget[],
  excludeId: string,
  range: number = MACHINEGUN.range,
): HitscanResult {
  const from: [number, number, number] = [origin[0], origin[1], origin[2]];
  const far: [number, number, number] = [
    origin[0] + direction[0] * range,
    origin[1] + direction[1] * range,
    origin[2] + direction[2] * range,
  ];

  // 1. A legkozelebbi akadaly: ennel tovabb a loves nem juthat.
  //
  // A 0 kozeli talalatot kihagyjuk: az azt jelentene, hogy a csotorkolat
  // MAR a geometriaban van (pl. az auto falhoz szorult). Ilyenkor ne
  // nullazzuk le a lovest, kulonben a falnak tamaszkodva egyaltalan nem
  // lehetne tuzelni.
  const fal = raycastBVH(arenaBVH(), from, far);
  const blockAt = fal !== null && fal > 1e-4 ? fal : 1;

  // 2. A legkozelebbi auto -- de csak az akadaly ELOTT.
  let hitId: string | null = null;
  let hitAt = blockAt;
  for (const target of targets) {
    if (target.id === excludeId) continue;
    // A gepfegyver goly6ja pontszeru: nincs sugar-felfujas, mint a
    // raketanal. A talalathoz tenylegesen el kell talalni az autot.
    //
    // A jarmu HAROMSZOG-halojaval, ha megvan: a doboz-kozelites a kabin
    // magassagaban jóval nagyobb az autonal. Ha a halo hianyzik (nem
    // futott a generalas), a dobozokra esunk vissza -- inkabb bőkezű
    // talalat, mint semmi.
    const halo = autoBVH(target.car);
    const t = halo
      ? segmentCarEntryMesh(halo, from, far, target.position, target.rotation, 0)
      : segmentCarEntry(
          from,
          far,
          target.position,
          target.rotation,
          0,
          target.car,
        );
    if (t !== null && t > 1e-4 && t < hitAt) {
      hitAt = t;
      hitId = target.id;
    }
  }

  return {
    from,
    to: [
      from[0] + (far[0] - from[0]) * hitAt,
      from[1] + (far[1] - from[1]) * hitAt,
      from[2] + (far[2] - from[2]) * hitAt,
    ],
    hitId,
  };
}
