/**
 * Terbeli hangkeveres: mennyire hangos es merrol szol egy hang.
 *
 * MIERT ITT, a kozos csomagban: ez tiszta szamtan, DOM es Web Audio
 * nelkul -- tehat Node alatt merheto (lasd check-audio.ts). A
 * bongeszoben csak annyi tortenik, hogy a kiszamolt ket szamot
 * ratesszuk egy erositore es egy panoramazora.
 *
 * SZANDEKOSAN nem a Web Audio sajat PannerNode-jat hasznaljuk. Az a
 * HRTF-ig el, amihez itt semmi szukseg -- cserebe eltemetne a
 * hangeronket egy fekete dobozba, ahol nem lehet megmerni, hogy a
 * palya tuloldalarol jovo loves tenyleg halkabb-e a szomszedosnal.
 */

/**
 * Eddig a tavolsagig (m) szol teljes hangeron.
 *
 * Nagyjabol egy autohossz plusz rahagyas: ami ennel kozelebb van, az
 * "itt tortenik", es nem akarjuk, hogy a sajat autonk hangja a legkisebb
 * elmozdulastol ingadozzon.
 */
export const AUDIO_REFERENCE_M = 10;

/**
 * Ezen tul mar egyaltalan nem hallatszik (m).
 *
 * A gepfegyver hatotava 70 m, az arena atloja viszont 170 m. A 100 m
 * azt jelenti: amit MEG el lehet talalni, azt meg hallani is lehet --
 * de a palya tuloldalan zajlo harc nem szol bele a sajatunkba.
 */
export const AUDIO_MAX_M = 100;

/**
 * Az auto vizszintes elfordulasa (yaw) a kvaternióbol.
 *
 * Ugyanaz a konvencio, mint a celzasnal es a fegyver-modell
 * beallitasanal (lasd weapons.ts, scene.ts aimLauncher): az az
 * Y-forgatas, amivel egy -Z fele nezo objektum ebbe az iranyba fordul.
 *
 * ITT van, es nem a kliensben, mert a hang-panorama EGESZE ezen all
 * vagy bukik: egy elojel-hiba a teljes hangkepet tukrozne, amit
 * hallgatva nehez eszrevenni, merve viszont trivialis (check:audio).
 */
export function yawOf(rotation: readonly number[]): number {
  const [x, y, z, w] = rotation;
  // A (0,0,-1) elforgatva; csak a vizszintes resze kell.
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
}

export interface AudioMix {
  /** Hangero-szorzo, 0..1. */
  gain: number;
  /** Panorama: -1 = balra, 0 = kozepen, +1 = jobbra. */
  pan: number;
}

/**
 * Egy hangforras keverese a hallgato helyzetehez kepest.
 *
 * A hallgato a SAJAT AUTONK (nem a kamera): a jatekos az autoban ul, a
 * kamera csak nezi. Kameraval szamolva a hatunk mogott zajlo esemenyek
 * kozelebbrol szolnanak, mint amilyen kozel valojaban vannak.
 */
export function audioMix(
  listener: readonly number[],
  listenerYaw: number,
  source: readonly number[],
): AudioMix {
  const dx = source[0] - listener[0];
  const dy = source[1] - listener[1];
  const dz = source[2] - listener[2];
  const distance = Math.hypot(dx, dy, dz);

  if (distance >= AUDIO_MAX_M) return { gain: 0, pan: 0 };

  // Forditott tavolsag-torveny, a hatarnal nullara futtatva.
  //
  // A puszta 1/d sosem er nullat, tehat a palya szelen is maradna egy
  // halk maradek minden lovesbol -- nyolc jatekosnal ez alland zajja
  // allna ossze. A vegso szorzo ezt viszi le simán nullara.
  const inverse = AUDIO_REFERENCE_M / Math.max(AUDIO_REFERENCE_M, distance);
  const fade = 1 - distance / AUDIO_MAX_M;
  const gain = inverse * fade;

  // A panorama a hallgato JOBB iranyara vetitve.
  //
  // A yaw ugyanaz a konveció, mint a celzasnal (lasd weapons.ts): az az
  // Y-forgatas, amivel egy -Z fele nezo objektum ebbe az iranyba fordul.
  // Ebbol a jobb irany (sin(yaw+90), cos(yaw+90)) -- azaz (cos, -sin)
  // eloadva a -Z konvencioban.
  const rightX = Math.cos(listenerYaw);
  const rightZ = -Math.sin(listenerYaw);
  const horizontal = Math.hypot(dx, dz);

  // KOZEL a panorama visszaall kozepre: a sajat autonk kozvetlen
  // kornyeken egy centimeteres elmozdulas is atbillentene a hangot az
  // egyik fulbol a masikba, ami zavaro csattogas lenne.
  const spread = Math.min(1, horizontal / AUDIO_REFERENCE_M);
  const pan =
    horizontal < 1e-4
      ? 0
      : ((dx * rightX + dz * rightZ) / horizontal) * spread;

  return { gain, pan: Math.max(-1, Math.min(1, pan)) };
}

/**
 * A motorhang lejatszasi sebessege es hangereje a sebessegbol.
 *
 * A felvetel EGY allando fordulatszamon keszult; a jatekban ezt
 * hangoljuk el. Ez nem hangszintezis: a valodi felvetel szol, csak
 * gyorsabban vagy lassabban -- ugyanaz, mint amikor egy lemezt mas
 * fordulaton jatszunk le.
 *
 * A hangolas SZANDEKOSAN nem lineáris a sebesseggel: egy valodi auto
 * valt, tehat a fordulatszam nem no egyenletesen a vegsebessegig.
 * Enelkul a 100 km/h-s hang nevetsegesen magas lenne.
 */
export function engineTone(
  speedKmh: number,
  throttle: number,
  topSpeedKmh: number,
): { rate: number; gain: number } {
  const t = Math.min(1, Math.abs(speedKmh) / topSpeedKmh);
  // Negyzetgyok: alacsony sebessegnel gyorsan emelkedik (ott erezzuk a
  // gyorsulast), fent viszont lelaposodik.
  const rate = 0.75 + Math.sqrt(t) * 0.95;
  // Alapjarat is hallatszik, de a gaz erdemben hozzatesz.
  const gain = 0.35 + Math.min(1, Math.abs(throttle)) * 0.4 + t * 0.25;
  return { rate, gain: Math.min(1, gain) };
}
