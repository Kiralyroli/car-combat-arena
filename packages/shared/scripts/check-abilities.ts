/**
 * KEPESSEGEK: a visszatoltes es az idotartam szabalyai.
 *
 * Ezek a szamok kozvetlenul a jatekmenetet allitjak, es a hibaik
 * CSENDESEK: nem dob kivetelt egy nullara csuszott visszatoltes sem,
 * csak eppen a gyogyitas vegtelenne valik, es a meccs eldonthetetlen
 * lesz. A masik irany ugyanennyire rossz: egy sosem elsulo kepesseg
 * mellett a jatekos azt hiszi, a gomb nem mukodik.
 *
 * Futtatas: npm run check:abilities
 */
import {
  ABILITIES,
  ABILITY_IDS,
  DEFAULT_ABILITY,
  abilityActive,
  abilityActiveLeft,
  abilityCooldownLeft,
  abilityReady,
  activateAbility,
  healPerMs,
  idleAbility,
  toAbilityId,
} from "../src/index";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

function main(): void {
  console.log("=== Kepessegek ===\n");

  // --- Frissen KESZ, de nem aktiv ---
  //
  // Egy uj elet elejen a kepesseg hasznalhato kell legyen: a
  // visszatoltes az ELETHEZ tartozik, nem viszi at magaval a halal.
  {
    const allapot = idleAbility();
    check(
      "uj eletben a kepesseg azonnal kesz",
      abilityReady(allapot, 1000) && !abilityActive(allapot, 1000),
      "kesz, de meg nem fut",
    );
  }

  // --- Elsutes utan NEM sulhet el ujra ---
  {
    const most = 10000;
    const utan = activateAbility("shield", idleAbility(), most);
    if (!utan) {
      check("a pajzs elsul", false, "az aktivalas null-t adott");
    } else {
      check(
        "elsutes utan azonnal nem sulhet el ujra",
        activateAbility("shield", utan, most + 1) === null,
        `a visszatoltes ${ABILITIES.shield.cooldownMs} ms`,
      );
      check(
        "a visszatoltes letelte utan viszont igen",
        activateAbility("shield", utan, most + ABILITIES.shield.cooldownMs) !==
          null,
        "ugyanaz a kepesseg, kesobbi idopont",
      );
    }
  }

  // --- MINDKETTO tart egy ideig ---
  //
  // A pajzs ved, a gyogyitas fokozatosan visszatolt -- de mindketto
  // IDOT vesz igenybe. Ebbol rajzolja a kliens a burkot, es ebbol
  // latszik a HUD-on a hatralevo ido.
  {
    const most = 5000;
    const pajzs = activateAbility("shield", idleAbility(), most);
    const gyogy = activateAbility("heal", idleAbility(), most);
    check(
      "a pajzs a beallitott ideig tart",
      pajzs !== null &&
        abilityActive(pajzs, most + ABILITIES.shield.durationMs - 1) &&
        !abilityActive(pajzs, most + ABILITIES.shield.durationMs + 1),
      `${ABILITIES.shield.durationMs} ms`,
    );
    // A GYOGYITAS is idotartamos: fokozatosan gyogyit, tehat aktiv
    // marad -- ebbol rajzolja a kliens a zold burkot, es ebbol latszik
    // a HUD-on, mennyi van hatra.
    check(
      "a gyogyitas is aktiv marad az idotartama alatt",
      gyogy !== null &&
        abilityActive(gyogy, most + ABILITIES.heal.durationMs - 1) &&
        !abilityActive(gyogy, most + ABILITIES.heal.durationMs + 1),
      `${ABILITIES.heal.durationMs} ms`,
    );
  }

  // --- A VISSZASZAMLALO azt mutatja, amit a szerver szamol ---
  //
  // A HUD ebbol rajzol. Ha ez elcsuszna, a jatekos "kesz"-t latna, es a
  // gomb megsem tenne semmit -- vagy forditva.
  {
    const most = 0;
    const utan = activateAbility("heal", idleAbility(), most);
    if (!utan) {
      check("a gyogyitas elsul", false, "null");
    } else {
      const fele = ABILITIES.heal.cooldownMs / 2;
      check(
        "a visszaszamlalo a hatralevo idot adja",
        Math.abs(abilityCooldownLeft(utan, fele) - fele) < 1e-6,
        `${fele} ms-nal ${abilityCooldownLeft(utan, fele)} ms van hatra`,
      );
      check(
        "a vegen nullara all, nem megy negativba",
        abilityCooldownLeft(utan, ABILITIES.heal.cooldownMs * 2) === 0,
        "0 ms",
      );
    }
  }

  // --- Az ERTEKEK jatszhatoak ---
  //
  // Nem a szepsegukert: egy nullara csuszott visszatoltes vegtelen
  // gyogyitast adna, egy tul hosszu pedig hasznalhatatlan kepesseget.
  {
    const bajos = ABILITY_IDS.filter((id) => {
      const d = ABILITIES[id];
      return d.cooldownMs < 5000 || d.cooldownMs > 60000;
    });
    check(
      "a visszatoltesek jatszhato tartomanyban vannak",
      bajos.length === 0,
      bajos.length === 0
        ? ABILITY_IDS.map((id) => `${id}: ${ABILITIES[id].cooldownMs / 1000} s`).join(", ")
        : bajos.join(", "),
    );
    // A GYOGYITAS ne adjon vissza teljes eletet: az egy masodik eletet
    // jelentene, ami tobb, mint amit egy loadout-valasztas erhet.
    check(
      "a gyogyitas reszleges",
      ABILITIES.heal.heal > 0 && ABILITIES.heal.heal < 100,
      `${ABILITIES.heal.heal} elet a 100-bol`,
    );
    // A gyogyitas visszatoltese legyen a HOSSZABB: az erosebb hatas
    // ritkabban jarjon.
    check(
      "a gyogyitas ritkabban hasznalhato, mint a pajzs",
      ABILITIES.heal.cooldownMs > ABILITIES.shield.cooldownMs,
      `${ABILITIES.heal.cooldownMs} ms > ${ABILITIES.shield.cooldownMs} ms`,
    );
  }

  // --- ISMERETLEN ertek nem tori el a jatekot ---
  //
  // A kliens barmit kuldhet; a szervernek ebbol ervenyes kepesseget
  // kell csinalnia.
  {
    check(
      "ismeretlen kepesseg-nev az alapertelmezettre esik",
      toAbilityId("varazslat") === DEFAULT_ABILITY &&
        toAbilityId(undefined) === DEFAULT_ABILITY &&
        toAbilityId("heal") === "heal",
      `ismeretlen -> ${DEFAULT_ABILITY}`,
    );
  }

  // --- A HATRALEVO ido merheto ---
  //
  // Ebbol rajzol a HUD. Enelkul a jatekos csak annyit latna, hogy
  // "tortenik valami" -- azt nem, hogy meddig, pedig egy pajzsnal
  // eppen az idozites a lenyeg.
  {
    const most = 1000;
    const pajzs = activateAbility("shield", idleAbility(), most);
    if (!pajzs) {
      check("a pajzs elsul", false, "null");
    } else {
      const fele = ABILITIES.shield.durationMs / 2;
      check(
        "a hatralevo hatas merheto",
        Math.abs(abilityActiveLeft(pajzs, most + fele) - fele) < 1e-6,
        `${fele} ms-nal ${abilityActiveLeft(pajzs, most + fele)} ms van hatra`,
      );
      check(
        "lejarat utan nullara all",
        abilityActiveLeft(pajzs, most + ABILITIES.shield.durationMs * 2) === 0,
        "0 ms",
      );
    }
  }

  // --- A gyogyitas UTEME a ket szambol jon ---
  //
  // Ha barmelyiket allitjuk (mennyiseg vagy idotartam), a masik koveti
  // -- nincs kulon beirt sebesseg, ami elcsuszhatna.
  {
    const teljes = healPerMs() * ABILITIES.heal.durationMs;
    check(
      "a gyogyulas uteme a mennyisegbol es az idobol jon",
      Math.abs(teljes - ABILITIES.heal.heal) < 1e-9,
      `${healPerMs().toFixed(4)} elet/ms x ${ABILITIES.heal.durationMs} ms = ${teljes}`,
    );
  }

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
