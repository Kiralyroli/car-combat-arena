/**
 * SEBZES-SZAMOK szabalya: mikor villan fel egy szam, es mikor NEM.
 *
 * A szam a HP KULONBSEGEBOL all elo (lasd hpLoss). Ez a valasztas
 * MINDEN sebzes-utat lefed egyszerre -- de cserebe harom olyan
 * helyzetet is "veszteseg"-nek latna, ami nem az: az elso latast, a
 * gyogyulast es az ujraszuletest. Eppen ezeket meri ez a teszt.
 *
 * Futtatas: npm run check:damage-numbers
 */
import {
  DAMAGE_NUMBER_FADE_MS,
  DAMAGE_NUMBER_MS,
  DAMAGE_NUMBER_RISE,
  damageNumberOpacity,
  damageNumberRise,
  hpLoss,
  MAX_HP,
} from "../src/index";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

function main(): void {
  console.log("=== Sebzes-szamok ===\n");

  // --- A rendes eset ---
  check(
    "a talalat merteke a ket HP kulonbsege",
    hpLoss(100, 76) === 24,
    `100 -> 76 = -${hpLoss(100, 76)}`,
  );
  check(
    "a HALALOS talalat is szam",
    hpLoss(30, 0) === 30,
    `30 -> 0 = -${hpLoss(30, 0)} (ez a legfontosabb szam a parharcban)`,
  );

  // --- Amikor NINCS szam ---
  //
  // Mindharom eset a HP-kulonbseg valasztasabol kovetkezik, es
  // mindharom LATHATO hiba lenne a kepernyon.
  check(
    "elso latasra nincs szam",
    hpLoss(null, 40) === 0 && hpLoss(undefined, 40) === 0,
    "egy mar megtepazott ellenfel folott kulonben azonnal felvillanna egy sosem tortent talalat",
  );
  check(
    "gyogyulasra nincs szam",
    hpLoss(40, 80) === 0,
    "40 -> 80: ott nem vesztes tortent",
  );
  check(
    "ujraszuletesre nincs szam",
    hpLoss(0, MAX_HP) === 0,
    `0 -> ${MAX_HP}: halottbol lesz teli elet`,
  );
  check(
    "valtozatlan HP-nal nincs szam",
    hpLoss(55, 55) === 0,
    "55 -> 55",
  );

  // --- Elhalvanyulas ---
  //
  // A szam a TALALAT visszajelzese: vegig olvashato marad, es csak a
  // vegen tunik el. Egy vegig halvanyulo szam a felenel mar alig
  // latszana -- pont akkor, amikor a jatekos odanez.
  check(
    "indulaskor teljesen latszik",
    damageNumberOpacity(0) === 1,
    "1.00",
  );
  const felut = damageNumberOpacity(DAMAGE_NUMBER_MS / 2);
  check(
    "a felenel meg teljesen latszik",
    felut === 1,
    `${felut.toFixed(2)} (a halvanyulas csak az utolso ${DAMAGE_NUMBER_FADE_MS} ms)`,
  );
  check(
    "a halvanyulas kozben mar nem teljes",
    damageNumberOpacity(DAMAGE_NUMBER_MS - DAMAGE_NUMBER_FADE_MS / 2) < 1 &&
      damageNumberOpacity(DAMAGE_NUMBER_MS - DAMAGE_NUMBER_FADE_MS / 2) > 0,
    `${damageNumberOpacity(DAMAGE_NUMBER_MS - DAMAGE_NUMBER_FADE_MS / 2).toFixed(2)}`,
  );
  check(
    "a vegen eltunik (a hivo ebbol tudja, hogy elveheti)",
    damageNumberOpacity(DAMAGE_NUMBER_MS) === 0 &&
      damageNumberOpacity(DAMAGE_NUMBER_MS + 500) === 0,
    "0.00",
  );

  // --- Emelkedes ---
  check(
    "a szam felfele indul, es a vegere er a tetejere",
    damageNumberRise(0) === 0 &&
      damageNumberRise(DAMAGE_NUMBER_MS) === DAMAGE_NUMBER_RISE,
    `0 -> ${DAMAGE_NUMBER_RISE} m`,
  );
  check(
    "az emelkedes monoton",
    damageNumberRise(200) < damageNumberRise(600) &&
      damageNumberRise(600) < damageNumberRise(1000),
    `${damageNumberRise(200).toFixed(2)} < ${damageNumberRise(600).toFixed(2)} < ${damageNumberRise(1000).toFixed(2)} m`,
  );

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
