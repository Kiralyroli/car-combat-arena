/**
 * JATEKMODOK szabalyai: mikor er veget a meccs, es ki nyeri.
 *
 * A ket mod MAS KERDESRE valaszol, es eppen ezeket a kulonbsegeket
 * merjuk: hol fogy elet, hol jar le az ido, es kit hirdetunk gyoztesnek.
 * A meccs-allapotgepet (a szerveren) a check:mode-flow meri; itt a
 * tiszta szabalyok vannak, bongeszo es halozat nelkul.
 *
 * Futtatas: npm run check:modes
 */
import {
  DEATHMATCH_DURATION_MS,
  DEFAULT_GAME_MODE,
  GAME_MODES,
  GAME_MODE_IDS,
  isTimed,
  isTimeUp,
  killCredited,
  killLeader,
  KILL_CAUSE_LABEL,
  KILL_CREDIT_MS,
  losesLife,
  toGameModeId,
} from "../src/index";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

function main(): void {
  console.log("=== Jatekmodok ===\n");

  // --- A KET MOD tenylegesen MAS ---
  //
  // Enelkul a "tobb jatekmod" csak ket nev lenne ugyanarra a jatekra.
  check(
    "a tulelés-mod eletet fogyaszt, az idore meno nem",
    losesLife("lastCarStanding") && !losesLife("deathmatch"),
    "lastCarStanding: fogy, deathmatch: korlatlan ujraszuletes",
  );
  check(
    "az idore meno modnak van hossza, a tulelés-modnak nincs",
    !isTimed("lastCarStanding") && isTimed("deathmatch"),
    `deathmatch: ${DEATHMATCH_DURATION_MS / 1000} mp`,
  );
  check(
    "minden modnak van neve es leirasa a valasztohoz",
    GAME_MODE_IDS.every(
      (id) => GAME_MODES[id].nev.length > 0 && GAME_MODES[id].leiras.length > 0,
    ),
    GAME_MODE_IDS.map((id) => GAME_MODES[id].nev).join(", "),
  );

  // --- Ismeretlen ertek: a szerver a klienstol BARMIT kaphat ---
  check(
    "ismeretlen mod eseten az alapertelmezett",
    toGameModeId("nincs-ilyen") === DEFAULT_GAME_MODE &&
      toGameModeId(undefined) === DEFAULT_GAME_MODE &&
      toGameModeId(42) === DEFAULT_GAME_MODE,
    DEFAULT_GAME_MODE,
  );
  check(
    "az ervenyes ertek valtozatlan marad",
    toGameModeId("deathmatch") === "deathmatch",
    "deathmatch",
  );

  // --- Az IDO lejarta ---
  {
    const hossz = DEATHMATCH_DURATION_MS;
    check(
      "az ido a hossz elerésekor jar le, elotte nem",
      !isTimeUp("deathmatch", hossz - 1) && isTimeUp("deathmatch", hossz),
      `${hossz} ms`,
    );
    // A tulelés-mod ORAJA sosem jar le: ott a mezony fogyasa dönt. Egy
    // kozos idokorlat elvagna a meccset a dontés elott.
    check(
      "a tulelés-mod nem jar le idore",
      !isTimeUp("lastCarStanding", 10 * 60 * 1000),
      "tiz perc utan sem",
    );
  }

  // --- A GYOZTES az idore meno modban ---
  {
    const mezony = [
      { id: "a", kills: 3 },
      { id: "b", kills: 7 },
      { id: "c", kills: 5 },
    ];
    check(
      "a legtobb kilovest szerzo nyer",
      killLeader(mezony)?.id === "b",
      "b (7 kiloves)",
    );
    // DONTETLEN holtversenynel: masodlagos szempont (ki halt kevesebbet)
    // a kepernyon nem latszik, tehat a jatekos szamara onkenyes lenne.
    check(
      "holtversenynel dontetlen",
      killLeader([
        { id: "a", kills: 4 },
        { id: "b", kills: 4 },
      ]) === null,
      "nincs gyoztes",
    );
    check(
      "nulla kilovessel is lehet dontetlen",
      killLeader([
        { id: "a", kills: 0 },
        { id: "b", kills: 0 },
      ]) === null,
      "senki nem lott ki senkit",
    );
    check(
      "egyetlen jatekos onmagaban gyoztes",
      killLeader([{ id: "a", kills: 0 }])?.id === "a",
      "a",
    );
    check("ures mezonynel nincs gyoztes", killLeader([]) === null, "null");
  }

  // --- KINEK jar a kiloves ---
  {
    const most = 100_000;
    check(
      "a friss talalat beszamit",
      killCredited({ id: "tamado", at: most - 1000 }, "aldozat", most),
      "1 mp-vel korabbi talalat",
    );
    // Ablak nelkul egy perccel korabbi koccanas is kilovest erne.
    check(
      "a regi talalat mar nem szamit be",
      !killCredited(
        { id: "tamado", at: most - KILL_CREDIT_MS - 1 },
        "aldozat",
        most,
      ),
      `${KILL_CREDIT_MS} ms az ablak`,
    );
    check(
      "a hatarpont MEG beleszamit",
      killCredited({ id: "tamado", at: most - KILL_CREDIT_MS }, "aldozat", most),
      "pontosan az ablak szelen",
    );
    check(
      "tamado nelkul nincs kiloves (sajat hiba)",
      !killCredited(null, "aldozat", most),
      "null tamado",
    );
    check(
      "onmagunk kilovese nem szamit kilovesnek",
      !killCredited({ id: "aldozat", at: most }, "aldozat", most),
      "sajat robbanas",
    );
  }

  // --- A kilovés-lista feliratai ---
  check(
    "minden kiloves-oknak van magyar neve",
    Object.values(KILL_CAUSE_LABEL).every((s) => s.length > 0),
    Object.values(KILL_CAUSE_LABEL).join(", "),
  );

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
