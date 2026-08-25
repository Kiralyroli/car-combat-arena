/**
 * Az eredmenyjelzo SORRENDJE.
 *
 * A szabaly: legfelul az all, akinek a legtobb elete van, legalul, akinek
 * a legkevesebb -- es a sorrend mindig aktualis.
 *
 * SZANDEKOSAN egysegteszt: a sorrend tiszta fuggveny (sortScoreRows),
 * tehat DOM es bongeszo nelkul, determinisztikusan merheto. Bongeszos
 * e2e-vel csak azt lehetne latni, hogy EGY adott allasnal jo a sorrend,
 * a hataresetek (azonos eletszam, kiesett jatekos) pedig nehezen
 * allithatok elo.
 *
 * Futtatas: npm run check:scoreboard
 */
import { sortScoreRows, type ScoreRow } from "../src/hud";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const row = (name: string, lives: number): ScoreRow => ({
  id: name,
  name,
  lives,
  // A szin a sorrendet nem befolyasolja -- ez a teszt a rendezest meri.
  color: "blue",
});
const order = (rows: ScoreRow[]): string =>
  sortScoreRows(rows)
    .map((r) => `${r.name}(${r.lives})`)
    .join(" > ");

function main(): void {
  console.log("=== Eredmenyjelzo sorrendje ===\n");

  const mixed = [row("Anna", 1), row("Bela", 3), row("Cili", 2)];
  check(
    "a legtobb elettel allo van legfelul",
    sortScoreRows(mixed)[0].name === "Bela",
    order(mixed),
  );
  check(
    "a legkevesebbel allo van legalul",
    sortScoreRows(mixed)[2].name === "Anna",
    order(mixed),
  );

  // A bemenet sorrendje NE szamitson: a halozati bejaras sorrendje nem
  // garantalt, es a listanak akkor is ugyanugy kell allnia.
  const reversed = [row("Cili", 2), row("Bela", 3), row("Anna", 1)];
  check(
    "a bemeneti sorrend nem szamit",
    order(mixed) === order(reversed),
    order(reversed),
  );

  // Azonos eletszamnal a nev dönt. Enelkul ket egyforma allasu jatekos
  // sorrendje frame-rol frame-re valtozhatna, es a lista ugralna.
  const tied = [row("Zoli", 2), row("Anna", 2), row("Mate", 2)];
  check(
    "azonos eletszamnal a nev dönt (stabil sorrend)",
    order(tied) === "Anna(2) > Mate(2) > Zoli(2)",
    order(tied),
  );
  check(
    "azonos allas mellett a sorrend nem valtozik ujraszamolaskor",
    order(tied) === order([...tied].reverse()),
    "ketszer ugyanaz",
  );

  // A kiesett (0 elet) jatekos a lista aljara kerul, de NEM tunik el --
  // a jatekosnak latnia kell, ki esett mar ki.
  const withOut = [row("Anna", 0), row("Bela", 2), row("Cili", 0)];
  const sortedOut = sortScoreRows(withOut);
  check(
    "a kiesettek legalul vannak, de a listan maradnak",
    sortedOut.length === 3 &&
      sortedOut[0].name === "Bela" &&
      sortedOut[1].lives === 0 &&
      sortedOut[2].lives === 0,
    order(withOut),
  );

  check(
    "ures lista nem okoz hibat",
    sortScoreRows([]).length === 0,
    "0 sor",
  );

  // A rendezes NE modositsa a bemenetet: a hivo ugyanazt a tombot adja
  // at minden frame-ben.
  const original = [row("Anna", 1), row("Bela", 3)];
  sortScoreRows(original);
  check(
    "a rendezes nem irja at a bemenetet",
    original[0].name === "Anna" && original[1].name === "Bela",
    "valtozatlan",
  );

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
