/**
 * A ket fejlesztoi szerver inditasa EGY paranccsal.
 *
 * A jatekhoz KETTO kell, es ez konnyu elrontani:
 *
 *   - jatekszerver (Node, 8080)  -- szobak, fizika, sebzes,
 *   - kliens (Vite, 5173)        -- a bongeszoben futo resz.
 *
 * Ha csak a masodik megy, a lap betolt, de a lobby nem talal szervert;
 * ha csak az elso, nincs mit megnyitni. Ez a script mindkettot
 * elinditja, egyben allitja le oket, es kiirja, melyik cimet kell
 * megnyitni.
 *
 * NODE-ban, nem .ps1-ben vagy .sh-ban: igy ugyanaz a fajl fut
 * PowerShellbol, Git Bashbol es duplakattintasra is (lasd inditas.cmd),
 * es nem kell ExecutionPolicyval bajlodni.
 *
 * Hasznalat:
 *   npm run dev:all          -- inditas
 *   npm run dev:all -- --stop   -- a portokat foglalo folyamatok leallitasa
 *   npm run dev:all -- --force  -- eloszor leallit, aztan indit
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GYOKER = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const WINDOWS = process.platform === "win32";
const NPM = WINDOWS ? "npm.cmd" : "npm";

/**
 * A ket folyamat.
 *
 * A portok SZANDEKOSAN itt is le vannak irva, hogy a foglaltsag-
 * ellenorzes tudjon rola. Ha valamelyik megvaltozik, ez a lista is
 * javitasra szorul -- ezert all mellette, honnan jon.
 */
const SZERVEREK = [
  {
    nev: "szerver",
    // Honnan: packages/server/src/index.ts (PORT kornyezeti valtozo).
    port: 8080,
    parancs: "run dev --workspace @cca/server",
    szin: "\x1b[36m", // cian
  },
  {
    nev: "kliens ",
    // Honnan: .claude/launch.json, illetve a Vite alapertelmezese.
    port: 5173,
    parancs: "run dev --workspace @cca/client",
    szin: "\x1b[35m", // bibor
  },
];

const ALAP = "\x1b[0m";
const SZURKE = "\x1b[90m";

/**
 * Figyel-e valaki ezen a porton?
 *
 * Windowson NETSTAT alapjan, nem probafoglalassal. Merve: a
 * probafoglalas 127.0.0.1-re SIKERULT, holott a jatekszerver eppen
 * futott -- az ugyanis 0.0.0.0-ra kot, es a Windows ezt a ket kotest
 * nem tekinti utkozonek. A "szabad a port" valasz igy hazug volt, es a
 * script vidaman elinditotta a masodik peldanyt.
 *
 * Mashol marad a probafoglalas: ott nincs netstat ilyen formaban, es a
 * kotesek utkoznek is rendesen.
 */
function foglalt(port) {
  if (WINDOWS) return Promise.resolve(figyelokPortra(port).length > 0);
  return new Promise((kesz) => {
    const proba = createServer();
    proba.once("error", (hiba) => kesz(hiba.code === "EADDRINUSE"));
    proba.once("listening", () => proba.close(() => kesz(false)));
    proba.listen(port, "127.0.0.1");
  });
}

/** A porton FIGYELO folyamatok azonositoi (Windows, netstat alapjan). */
function figyelokPortra(port) {
  const netstat = spawnSync("netstat", ["-ano"], { encoding: "utf8" });
  if (netstat.status !== 0 || typeof netstat.stdout !== "string") return [];

  const pidek = new Set();
  for (const sor of netstat.stdout.split("\n")) {
    // Csak a FIGYELO bejegyzes erdekes: a kifele iranyulo kapcsolatok
    // ugyanezt a portot mutathatjak tavoli cimkent.
    if (!sor.includes("LISTENING")) continue;
    const mezok = sor.trim().split(/\s+/);
    const cim = mezok[1] ?? "";
    if (!cim.endsWith(`:${port}`)) continue;
    const pid = Number(mezok[mezok.length - 1]);
    if (Number.isInteger(pid) && pid > 0) pidek.add(pid);
  }
  return [...pidek];
}

/**
 * A portot foglalo folyamat leallitasa.
 *
 * SZANDEKOSAN port szerint, nem "minden node.exe" alapon: a gepen
 * futhat mas Node-projekt is, es azt nem a mi dolgunk lelonni.
 *
 * A megvalositas WINDOWS-SPECIFIKUS (netstat + taskkill) -- ez a
 * projekt fejlesztoi gepe. Mashol inkabb NE csinaljunk semmit, mint
 * hogy egy nem tesztelt uton loljunk le folyamatokat: a sima inditas
 * (es a Ctrl+C) ott is mukodik.
 */
function portotFoglaloLeallitasa(port) {
  if (!WINDOWS) return [];
  const leallitva = [];
  for (const pid of figyelokPortra(port)) {
    const eredmeny = spawnSync("taskkill", ["/F", "/PID", String(pid), "/T"], {
      encoding: "utf8",
    });
    if (eredmeny.status === 0) leallitva.push(pid);
  }
  return leallitva;
}

/**
 * Melyik PID tartozik EHHEZ a projekthez?
 *
 * MIERT KELL MEGKULONBOZTETNI: a 8080 kozkedvelt port, es a script nem
 * loheti le vaktaban azt, ami rajta ul -- lehet az a felhasznalo mas
 * munkaja is. A sajat, bent ragadt folyamatunkat viszont felesleges
 * kezzel keresgelni: azt eppen ezert irtuk.
 *
 * A dontes a PARANCSSORBOL jon: a mi folyamataink a projekt
 * konyvtarabol indulnak.
 *
 * @returns a megadottak kozul azok, amelyek a mi projektunkhoz tartoznak
 */
function sajatFolyamatok(pidek) {
  if (!WINDOWS || pidek.length === 0) return [];
  const szuro = pidek.map((p) => `ProcessId=${p}`).join(" or ");
  const ps = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "${szuro}" | ` +
        `ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }`,
    ],
    { encoding: "utf8" },
  );
  if (ps.status !== 0 || typeof ps.stdout !== "string") return [];

  const mienk = [];
  // Kisbetusen hasonlitunk: a Windows utvonalak kis-nagybetu-kozombosek.
  const gyokerKicsi = GYOKER.toLowerCase();
  for (const sor of ps.stdout.split("\n")) {
    const [pidSzoveg, ...maradek] = sor.trim().split("|");
    const parancssor = maradek.join("|").toLowerCase();
    const pid = Number(pidSzoveg);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (parancssor.includes(gyokerKicsi)) mienk.push(pid);
  }
  return mienk;
}

/** Minden kimeneti sor ele odaírjuk, MELYIK szervertol jon. */
function elotagolvaKiir(szoveg, nev, szin) {
  for (const sor of szoveg.split("\n")) {
    if (sor.trim() === "") continue;
    process.stdout.write(`${szin}[${nev}]${ALAP} ${sor}\n`);
  }
}

async function leallitas() {
  if (!WINDOWS) {
    console.log(
      "A --stop / --force csak Windowson mukodik (netstat + taskkill).\n" +
        "Mashol allitsd le a futo peldanyt Ctrl+C-vel.",
    );
    return;
  }
  let volt = false;
  for (const { nev, port } of SZERVEREK) {
    const pidek = portotFoglaloLeallitasa(port);
    if (pidek.length > 0) {
      volt = true;
      console.log(`Leallitva: ${nev.trim()} (${port}) -- PID ${pidek.join(", ")}`);
    }
  }
  if (!volt) console.log("Nem futott egyik szerver sem.");
}

async function inditas() {
  // ELOSZOR a portokat nezzuk meg. E nelkul a Vite csendben atlepne egy
  // masik portra (5174), a jatek pedig tovabbra is a regi, mar nem
  // frissulo peldanyt szolgalna ki -- olyan hiba, amit nehez eszrevenni.
  const idegen = [];
  for (const szerver of SZERVEREK) {
    if (!(await foglalt(szerver.port))) continue;

    // A SAJAT, bent ragadt folyamatunkat magunktol takaritjuk el. Ez a
    // gyakori eset: egy Ctrl+C nem mindig er el a gyerekfolyamatokig,
    // es ilyenkor a felhasznalonak semmi dolga nem kellene legyen.
    const figyelok = figyelokPortra(szerver.port);
    const mienk = sajatFolyamatok(figyelok);
    if (mienk.length === figyelok.length && mienk.length > 0) {
      for (const pid of mienk) {
        spawnSync("taskkill", ["/F", "/PID", String(pid), "/T"]);
      }
      console.log(
        `${SZURKE}Elozo peldany eltakaritva: ${szerver.nev.trim()} ` +
          `(${szerver.port}, PID ${mienk.join(", ")})${ALAP}`,
      );
      continue;
    }

    // IDEGEN folyamat: ezt nem loljuk le. A 8080 kozkedvelt port, es a
    // felhasznalo mas munkaja is ulhet rajta.
    idegen.push(szerver);
  }

  if (idegen.length > 0) {
    console.error("\nMas program hasznalja ezeket a portokat:");
    for (const { nev, port } of idegen) {
      console.error(`  ${port}  (ide kellene a ${nev.trim()})`);
    }
    console.error(
      "\nEzeket nem allitom le magamtol -- nem ehhez a projekthez tartoznak." +
        "\nHa megis ezt akarod:  npm run dev:all -- --force\n",
    );
    process.exit(1);
  }

  // A portok felszabadulasa nem azonnali.
  await new Promise((k) => setTimeout(k, 400));

  const gyerekek = [];
  // A jelzo es a leallito a SPAWN ELOTT all: az `exit` kezelo mar az
  // elso pillanatban elsulhet (pl. hianyzo npm), es akkor egy meg nem
  // inicializalt valtozora hivatkozna.
  let leall = false;
  function mindentLeallit() {
    if (leall) return;
    leall = true;
    for (const gyerek of gyerekek) {
      if (!gyerek.pid) continue;
      // /T: a gyerekfolyamatokat is. Az npm csak egy kozbeiktatott
      // reteg -- a valodi szerver az O gyereke, es nelkule arvan
      // maradna, tovabb tartva a portot.
      if (WINDOWS) spawnSync("taskkill", ["/F", "/PID", String(gyerek.pid), "/T"]);
      else gyerek.kill("SIGTERM");
    }
    process.exit(0);
  }

  process.on("SIGINT", mindentLeallit);
  process.on("SIGTERM", mindentLeallit);

  for (const { nev, parancs, szin } of SZERVEREK) {
    // EGY parancs-szoveg, kulon argumentum-lista NELKUL.
    //
    // Ket dolog kenyszeriti ki: Windowson az "npm" egy .cmd, amit a
    // Node 24 mar nem indit el `shell: true` nelkul (EINVAL) -- shell
    // mellett viszont a KULON atadott argumentumokra figyelmeztet
    // (DEP0190), mert azokat csak osszefuzne. Egyben adva at a
    // parancsot mindketto megoldodik. Injekcio nem fenyeget: a szoveg
    // itt fentebb all allandokent, nem kivulrol jon.
    const gyerek = spawn(`${NPM} ${parancs}`, { cwd: GYOKER, shell: true });
    gyerek.stdout.on("data", (d) => elotagolvaKiir(String(d), nev, szin));
    gyerek.stderr.on("data", (d) => elotagolvaKiir(String(d), nev, szin));
    gyerek.on("exit", (kod) => {
      // Ha az EGYIK elszall, a masik onmagaban hasznalhatatlan -- inkabb
      // alljon le mindketto, mint hogy a jatekos egy fel rendszert
      // probaljon hasznalni.
      if (!leall) {
        console.error(`\n[${nev.trim()}] varatlanul leallt (kod ${kod}).`);
        mindentLeallit();
      }
    });
    gyerekek.push(gyerek);
  }

  console.log(
    `\n${SZURKE}Ket szerver indul. Nyisd meg:${ALAP}  http://localhost:5173\n` +
      `${SZURKE}Leallitas: Ctrl+C${ALAP}\n`,
  );
}

const parancs = process.argv.slice(2);
if (parancs.includes("--stop")) {
  await leallitas();
} else if (parancs.includes("--force")) {
  await leallitas();
  // Rovid varakozas: a portok felszabadulasa nem azonnali.
  await new Promise((k) => setTimeout(k, 800));
  await inditas();
} else {
  await inditas();
}
