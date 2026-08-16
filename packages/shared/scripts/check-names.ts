/**
 * Jatekos-nevek tisztitasa.
 *
 * A nevet a KLIENS kuldi, tehat barmi lehet benne. A szerver az egyetlen
 * hiteles forras: o vagja hosszra es szuri a vezerlokaraktereket -- a
 * kliens ugyanezt a fuggvenyt hasznalja a beviteli mezohoz, hogy ne
 * gepeljen be olyat, amit utana csendben levagunk.
 *
 * Futtatas: npm run check:names
 */
import { MAX_NAME_LENGTH, sanitizePlayerName } from "../src/playerName";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

function main(): void {
  console.log("=== Jatekos-nevek ===\n");

  check(
    "a rendes nev valtozatlan marad",
    sanitizePlayerName("Roland", "abcd") === "Roland",
    sanitizePlayerName("Roland", "abcd"),
  );

  check(
    "a korulotte levo szokozok eltunnek",
    sanitizePlayerName("  Roland  ", "abcd") === "Roland",
    `"${sanitizePlayerName("  Roland  ", "abcd")}"`,
  );

  const long = "a".repeat(MAX_NAME_LENGTH + 20);
  check(
    "a tul hosszu nev levagodik",
    sanitizePlayerName(long, "abcd").length === MAX_NAME_LENGTH,
    `${long.length} -> ${sanitizePlayerName(long, "abcd").length} karakter`,
  );

  // Ures / hianyzo nev helyett stabil, felismerheto alapertelmezett --
  // kulonben ket nevtelen jatekos megkulonboztethetetlen lenne.
  const fallback = sanitizePlayerName("", "9f3a1b2c");
  check(
    "ures nev helyett alapertelmezett all elo",
    fallback.length > 0 && fallback.includes("9F3A"),
    fallback,
  );
  check(
    "hianyzo nev is kap alapertelmezettet",
    sanitizePlayerName(undefined, "9f3a1b2c") === fallback,
    "ugyanaz, mint az ures nevnel",
  );
  check(
    "ket kulonbozo jatekos kulonbozo alapertelmezettet kap",
    sanitizePlayerName("", "aaaa1111") !== sanitizePlayerName("", "bbbb2222"),
    `${sanitizePlayerName("", "aaaa1111")} vs ${sanitizePlayerName("", "bbbb2222")}`,
  );

  console.log("\nVezerlokarakterek:");

  // Sortores: enelkul egy nev ket sorba tordelne a nevtablat es az
  // eredmenyjelzo sorat.
  const multiline = sanitizePlayerName("Ro\nland", "abcd");
  check(
    "a sortores eltunik",
    multiline === "Roland",
    `"${multiline}"`,
  );

  // Jobbrol-balra vezerlo: ezzel a lista tobbi sorat is meg lehetne
  // forditani a kepernyon.
  const rtl = sanitizePlayerName("Ro‮land", "abcd");
  check(
    "az irany-vezerlo eltunik",
    rtl === "Roland",
    `"${rtl}"`,
  );

  // Zero-width karakterek: lathatatlanul kulonbozo, de azonosnak latszo
  // nevek keszithetok veluk.
  const zeroWidth = sanitizePlayerName("Ro​land", "abcd");
  check(
    "a zero-width karakter eltunik",
    zeroWidth === "Roland",
    `"${zeroWidth}"`,
  );

  // CSAK vezerlokarakterekbol allo nev = ures nev.
  const onlyControl = sanitizePlayerName("​​", "abcd");
  check(
    "a csak vezerlokarakterbol allo nev alapertelmezettre valt",
    onlyControl.includes("ABCD"),
    onlyControl,
  );

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
