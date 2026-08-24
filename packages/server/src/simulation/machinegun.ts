import {
  ARENA,
  MACHINEGUN,
  segmentBoxEntry,
  segmentCarEntry,
} from "@cca/shared";

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
 * Minden arena-elem megallitja a lovest -- a talajt es a falakat is
 * beleertve.
 *
 * A raketanal a talaj es a falak kulon voltak kezelve (a rakéta felettuk
 * repul, illetve a palya hataran kifut). Itt viszont a nyomjelzo VEGET
 * kell megtalalni, es ahhoz mindenre szukseg van, aminek nekimehet.
 */
const BLOCKERS = ARENA;

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
  let blockAt = 1;
  for (const box of BLOCKERS) {
    const t = segmentBoxEntry(
      from,
      far,
      [box.position.x, box.position.y, box.position.z],
      [box.halfExtents.x, box.halfExtents.y, box.halfExtents.z],
    );
    // A 0 azt jelentene, hogy a csotorkolat MAR a dobozban van (pl. az
    // auto eppen falhoz szorult). Ilyenkor ne nullazzuk le a lovest,
    // kulonben a falnak tamaszkodva egyaltalan nem lehetne tuzelni.
    if (t !== null && t > 1e-4 && t < blockAt) blockAt = t;
  }

  // 2. A legkozelebbi auto -- de csak az akadaly ELOTT.
  let hitId: string | null = null;
  let hitAt = blockAt;
  for (const target of targets) {
    if (target.id === excludeId) continue;
    // A gepfegyver goly6ja pontszeru: nincs sugar-felfujas, mint a
    // raketanal. A talalathoz tenylegesen el kell talalni az autot.
    const t = segmentCarEntry(from, far, target.position, target.rotation, 0);
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
