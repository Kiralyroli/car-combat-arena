/**
 * KORULNEZES: a C nyomva tartasa alatt az eger a kamerat forgatja.
 *
 * A MOD LENYEGE: a celkereszt egy ROGZITETT helyre ugrik, a kamera
 * pedig oda fordul, amerre eddig celoztal. Onnantol az eger a kamerat
 * forgatja, a celkereszt pedig helyben marad -- amerre nezel, arra
 * celzol.
 *
 * A rogzitett hely NEM a kep kozepe: oda eppen a SAJAT AUTONK esik,
 * hiszen a kamera ra nez. Kozepre kotve a jatekos a sajat kocsijat
 * venne celba. A helyes hely feljebb van, ott, ahol egy tavoli ellenfel
 * latszik -- ezt a kamera geometriajabol szamoljuk (freeLookParkNdcY).
 *
 * A ket resz KET KULON szamitas:
 *
 *  1. A BELEPES ugrasa. A celkereszt a rogzitett helytol valamennyire
 *     allt; ez a tavolsag a kamera latoszogeben egy SZOGET jelent.
 *     Ezzel a szoggel forditjuk el a kamerat, es akkor a celzott pont
 *     pontosan a rogzitett helyre kerul -- a jatekos szamara a celzas
 *     nem valtozik, csak a kamera fordul oda.
 *
 *  2. A FORGATAS. Onnantol az eger elmozdulasa (pointer lock) adja
 *     hozza a szoget, kepernyo-hatar nelkul: korbe lehet nezni.
 *
 * MIERT ITT, a kozos csomagban: ez tiszta szamtan, DOM es Three.js
 * nelkul -- tehat Node alatt merheto (lasd check:freelook).
 */
import { CAMERA } from "./config";

export const FREELOOK = {
  /**
   * Egerhuzas erzekenysege (fok / pixel).
   *
   * A 0,15 nagyjabol azt jelenti, hogy egy 1200 pixeles huzas fordit
   * egy fel kort -- vagyis hatranezeshez egy hatarozott mozdulat kell,
   * de nem kell tobbszor "utanakapni".
   */
  degPerPixel: 0.15,
  /**
   * A fuggoleges kitéres hatarai (fok).
   *
   * Felfele tobb: onnan latni a palyat es az ellenfeleket. Lefele
   * kevesebb, mert a kamera hamar a talajba erne -- az utolso par fokot
   * ugyis levagna a kamera-utkozes (lasd cameraCollision).
   */
  minPitchDeg: -25,
  maxPitchDeg: 60,
  /**
   * Elengedes utan ennyi ido alatt tér vissza a kamera (mp).
   *
   * NEM azonnal: 180 fokrol visszaugorva a kamera atsopörne az auton,
   * ami zavaro. A simitas a SZOGRE hat, nem a helyre -- igy a kamera
   * korbefordul az auto korul, nem pedig atszalad rajta.
   */
  returnTime: 0.35,
  /**
   * Milyen TAVOLI celpontra allitjuk a celkeresztet (m).
   *
   * A celkereszt a mod alatt egy rogzitett helyen all, es NEM a kep
   * kozepen. A kozep ugyanis eppen a SAJAT AUTONKRA esik: a kamera az
   * autora nez (CAMERA.lookAtHeight), tehat kozepre celozva a sajat
   * kocsinkat vennenk celba.
   *
   * A helyes hely az, ahol egy tipikus tavolsagu ellenfel latszik. A 40
   * m a palya meretehez igazodik (120 x 120 m): ennyi egy szokasos
   * harci tavolsag, nem szemben allo autok, nem a palya atloja.
   */
  celTavolsag: 40,
};

/**
 * Hol alljon a celkereszt a mod alatt, a kep kozepehez kepest (NDC).
 *
 * SZAMOLT ertek, nem beirt: a kamera az auto FOLE nez es kicsit
 * felulrol, ezert egy tavoli, auto-magassagu celpont a kep kozepe
 * FOLOTT latszik. Ha ezt kezzel irnank be, a kamera barmelyik
 * allitasakor (magassag, tavolsag, latoszog) csendben elcsuszna.
 */
export function freeLookParkNdcY(fovFok: number): number {
  // A kamera nezesiranyanak lejtese: az autora nez, ami alatta van.
  const magassag = CAMERA.offset.y - CAMERA.lookAtHeight;
  const lejtes = Math.atan2(magassag, CAMERA.offset.z);
  // Ugyanez egy TAVOLI celpontra: alig lejt.
  const tavoliLejtes = Math.atan2(
    magassag,
    CAMERA.offset.z + FREELOOK.celTavolsag,
  );
  // A ketto kulonbsege a kep kozepe folotti szog.
  const szog = lejtes - tavoliLejtes;
  return Math.tan(szog) / Math.tan((fovFok * Math.PI) / 360);
}

function clamp(ertek: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, ertek));
}

/**
 * A BELEPES szoge: hova nezzen a kamera, hogy a celzott pont a
 * celkereszt ROGZITETT helyere essen.
 *
 * A celkereszt kepernyo-helyet NDC-ben kapjuk (-1..1, a kozep a nulla),
 * es a kamera latoszogebol szamoljuk a valodi szoget. Egy sima
 * "szorozd meg a fel latoszoggel" kozelites a kep szelen erezhetoen
 * tevedne: a perspektiva nem linearis.
 *
 * @param ndcX -1 (bal szel) .. 1 (jobb szel)
 * @param ndcY -1 (also szel) .. 1 (felso szel)
 * @param fovFok A kamera FUGGOLEGES latoszoge fokban.
 * @param aspect szelesseg / magassag
 */
export function freeLookFromAim(
  ndcX: number,
  ndcY: number,
  fovFok: number,
  aspect: number,
): { yaw: number; pitch: number } {
  const felFov = (fovFok * Math.PI) / 360;
  const tanFel = Math.tan(felFov);

  // A celkereszt NEM a kep kozepere all, hanem feljebb (lasd
  // freeLookParkNdcY). A kamera tehat annyit fordul, amennyi a KETTO
  // KULONBSEGE -- kulonben a celzott pont a kozepre kerulne, oda, ahol
  // a sajat autonk van.
  const park = freeLookParkNdcY(fovFok);

  const yaw = (Math.atan(ndcX * tanFel * aspect) * 180) / Math.PI;
  const pitch =
    ((Math.atan(ndcY * tanFel) - Math.atan(park * tanFel)) * 180) / Math.PI;

  return {
    yaw,
    pitch: clamp(pitch, FREELOOK.minPitchDeg, FREELOOK.maxPitchDeg),
  };
}

/**
 * Egerelmozdulas hozzaadasa a szoghoz.
 *
 * A VIZSZINTES szog SZANDEKOSAN nincs korlatozva: korbe lehet nezni. A
 * fuggoleges viszont igen, kulonben a kamera atbukfencezne az auto
 * folott.
 *
 * A kepernyo Y-a lefele no, a kamera emelese felfele -- ezert a
 * fuggoleges elojel forditott. E nelkul az egeret felfele huzva a
 * kamera lefele fordulna, ami minden jatekban forditva van.
 */
export function freeLookAdd(
  jelenlegi: { yaw: number; pitch: number },
  dx: number,
  dy: number,
): { yaw: number; pitch: number } {
  return {
    yaw: jelenlegi.yaw + dx * FREELOOK.degPerPixel,
    pitch: clamp(
      jelenlegi.pitch - dy * FREELOOK.degPerPixel,
      FREELOOK.minPitchDeg,
      FREELOOK.maxPitchDeg,
    ),
  };
}

/**
 * A jelenlegi szog kozelitese a celhoz (exponencialis).
 *
 * Elengedeskor a cel nulla, es a kamera ezzel fordul vissza az auto
 * moge. A lepeskoz-fuggetlenseg SZANDEKOS: egy sima "szorozd
 * 0,8-cal" kepkockankent a lassabb gepen lassabban terne vissza.
 */
export function freeLookEase(
  jelenlegi: number,
  cel: number,
  dt: number,
): number {
  if (FREELOOK.returnTime <= 0) return cel;
  const k = 1 - Math.exp(-dt / FREELOOK.returnTime);
  return jelenlegi + (cel - jelenlegi) * k;
}
