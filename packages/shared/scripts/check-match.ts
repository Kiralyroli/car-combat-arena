/**
 * Last Car Standing szabalyok (terv 5. lepcso 2. pont).
 *
 * Mindenki 3 elettel indul; megsemmisuleskor egy elvesz, es 5 mp mulva
 * ujraszuletik. Ha elfogytak az eletei, KIESIK (nezo lesz). Az utolso
 * talpon marado nyer.
 *
 * Futtatas: npm run check:match
 */
import {
  canStart,
  isEliminated,
  isMatchOver,
  survivorsOf,
  winnerOf,
  LIVES_PER_PLAYER,
  MATCH_RESTART_DELAY_MS,
  MIN_PLAYERS_TO_START,
  RESPAWN_DELAY_MS,
  type MatchParticipant,
} from "../src/match";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const p = (id: string, lives: number): MatchParticipant => ({ id, lives });

function main(): void {
  console.log("=== Last Car Standing ===\n");

  console.log("Szabalyok:");

  check(
    "mindenki 3 elettel indul",
    LIVES_PER_PLAYER === 3,
    `${LIVES_PER_PLAYER} elet`,
  );
  check(
    "az ujraszuletes 5 masodperc",
    RESPAWN_DELAY_MS === 5000,
    `${RESPAWN_DELAY_MS} ms`,
  );
  check(
    "a meccs legalabb ket jatekossal indul",
    MIN_PLAYERS_TO_START === 2 && !canStart(1) && canStart(2),
    `1 jatekos: ${canStart(1)}, 2 jatekos: ${canStart(2)}`,
  );
  // Az uj meccsnek varnia kell az eredmenyjelzore -- kulonben a
  // gyoztes-hirdetest senki nem latna.
  check(
    "az uj meccs kesobb indul, mint az ujraszuletes",
    MATCH_RESTART_DELAY_MS > RESPAWN_DELAY_MS,
    `${MATCH_RESTART_DELAY_MS} ms eredmenyjelzo / ${RESPAWN_DELAY_MS} ms ujraszuletes`,
  );

  console.log("\nKieses:");

  check("3 elettel nem esett ki", !isEliminated(p("a", 3)), "3 elet");
  check("1 elettel meg nem esett ki", !isEliminated(p("a", 1)), "1 elet");
  check("0 elettel kiesett", isEliminated(p("a", 0)), "0 elet");

  console.log("\nA meccs vege:");

  const three = [p("a", 3), p("b", 2), p("c", 1)];
  check(
    "harom elo jatekossal megy tovabb",
    !isMatchOver(three) && survivorsOf(three).length === 3,
    `${survivorsOf(three).length} talpon`,
  );

  const twoLeft = [p("a", 1), p("b", 0), p("c", 2)];
  check(
    "egy kiesettel is megy tovabb, ha ketten maradtak",
    !isMatchOver(twoLeft),
    `${survivorsOf(twoLeft).length} talpon`,
  );

  const oneLeft = [p("a", 0), p("b", 2), p("c", 0)];
  check(
    "egy talpon maradoval vege",
    isMatchOver(oneLeft),
    `${survivorsOf(oneLeft).length} talpon`,
  );
  check(
    "a gyoztes az utolso talpon marado",
    winnerOf(oneLeft)?.id === "b",
    `${winnerOf(oneLeft)?.id}`,
  );

  // FONTOS HATARESET: ha az utolso ketto EGYSZERRE semmisul meg (fejbe
  // rohanas vagy kozos robbanas), nulla talpon marado lesz. A meccsnek
  // ekkor is le kell zarulnia -- kulonben a szoba orokre "playing"
  // allapotban ragadna, es soha nem indulna uj meccs.
  const noneLeft = [p("a", 0), p("b", 0)];
  check(
    "nulla talpon maradoval is vege (dontetlen)",
    isMatchOver(noneLeft),
    "0 talpon",
  );
  check(
    "dontetlennel nincs gyoztes",
    winnerOf(noneLeft) === null,
    "null",
  );

  // Egyetlen jatekossal a meccs technikailag "vege" lenne, de a szoba
  // ilyenkor varakozik (lasd canStart) -- a ket szabaly egyutt adja ki,
  // hogy egy magaban gyakorlo jatekos nem kap gyoztes-hirdetest.
  const alone = [p("a", 3)];
  check(
    "egyedul nem indul meccs",
    !canStart(alone.length),
    `${alone.length} jatekos`,
  );

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
