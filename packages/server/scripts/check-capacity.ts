/**
 * Terheles: birja-e a szerver a TELI szobat?
 *
 * MIERT: eddig minden teszt 2-4 klienssel futott, a szoba viszont
 * nyolcat enged (MAX_PLAYERS_PER_ROOM). Ha hatnal-nyolcnal esik szet --
 * akadozo snapshotok, novekvo kesleltetes, elszallo savszelesseg --, az
 * pont az elso kozos jatek kozben derulne ki, amikor a legdragabb.
 *
 * SZANDEKOSAN bongeszo nelkul: nyolc valodi kliens WebGL-lel a MERO
 * gepet terhelne, nem a szervert, es a szam a sajat gepunkrol szolna.
 * Igy viszont a szerver a szuk keresztmetszet, ahogy elesben is.
 *
 * A kliensek ugy viselkednek, mint a valodiak: 30 Hz-en kuldenek
 * allapotot, es a gepfegyveresek folyamatosan tuzelnek (ez a
 * legterhelobb eset -- nyomjelzo minden snapshotban).
 *
 * FIGYELMEZTETES TAVOLI MERESHEZ (SERVER_URL=wss://...):
 *
 * Nyolc TLS-kapcsolat EGY folyamatban a MERO gepet fogja ki, nem a
 * szervert. Merve: igy 1.9 Hz es tobb masodperces akadas jott ki az
 * eles szerverrol -- ugyanakkor nyolc KULON folyamatbol futtatva
 * ugyanaz a szerver 6/8 kliensnek hibatlan 20 Hz-et adott, a maradek
 * ketto pedig a mero gep terheltsegen mulott. Egy kliens tavolrol
 * szinten tiszta 20 Hz.
 *
 * Vagyis: HELYBEN ez a meres a szerverrol szol, TAVOLROL viszont
 * konnyen a sajat gepunkrol. Eles szamhoz kulon gepekrol (vagy
 * legalabb kulon folyamatokbol) kell merni.
 *
 * Futtatas (a szervernek futnia kell): npm run check:capacity
 */
import { WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  SNAPSHOT_HZ,
  type ClientMessage,
  type ServerMessage,
} from "@cca/shared";

const URL = process.env.SERVER_URL ?? "ws://localhost:8080";
const PLAYERS = Number(process.argv.find((a) => a.startsWith("--players="))?.split("=")[1] ?? 8);
const SECONDS = Number(process.argv.find((a) => a.startsWith("--seconds="))?.split("=")[1] ?? 12);
/**
 * Protokoll-verzio felulirasa.
 *
 * AZERT van ra szukseg, mert a merest gyakran olyan szerver ellen
 * akarjuk futtatni, amire meg nem ment ki az aktualis kod (pl. az eles
 * gep egy korabbi verziot futtat). A TERHELES ilyenkor is ervenyes: a
 * belepes es az allapotkuldes alakja nem valtozott.
 *
 * Ha nincs megadva, a sajat verzionkat kuldjuk.
 */
const PROTOCOL = Number(
  process.argv.find((a) => a.startsWith("--protocol="))?.split("=")[1] ??
    PROTOCOL_VERSION,
);

/** Ilyen surun kuld allapotot egy valodi kliens is. */
const SEND_HZ = 30;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Load {
  name: string;
  socket: WebSocket;
  playerId: string | null;
  roomCode: string | null;
  snapshots: number;
  bytes: number;
  /** Snapshotok beerkezese kozotti idok (ms) -- ebbol jon az akadozas. */
  gaps: number[];
  lastSnapshotAt: number;
}

function connect(name: string, weapon: "cannon" | "machinegun"): Promise<Load> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(URL);
    const load: Load = {
      name,
      socket,
      playerId: null,
      roomCode: null,
      snapshots: 0,
      bytes: 0,
      gaps: [],
      lastSnapshotAt: 0,
    };
    socket.on("open", () => resolve(load));
    socket.on("error", reject);
    socket.on("message", (data) => {
      const buffer = data as Buffer;
      load.bytes += buffer.length;

      // SZANDEKOSAN nem elemezzuk a snapshotokat.
      //
      // Nyolc kliens 20 Hz-en kb. 560 kB/mp JSON-t jelent EGY
      // folyamatban. A teljes JSON.parse ennyit nem gyoz, es akkor a
      // meres a SAJAT lassusagat mutatna szerver-akadozaskent --
      // eloszor pontosan ez tortent (2.9 Hz "merve", mikozben a
      // beerkezo bajtok szama vegig a teljes utemnek felelt meg).
      //
      // A tipus az uzenet elejen all, tehat egy rovid szelet is eldonti.
      const head = buffer.subarray(0, 24).toString("latin1");
      if (head.startsWith('{"type":"snapshot"')) {
        const arrived = performance.now();
        if (load.lastSnapshotAt > 0) load.gaps.push(arrived - load.lastSnapshotAt);
        load.lastSnapshotAt = arrived;
        load.snapshots++;
        return;
      }

      // Minden mas ritka (belepes, hiba) -- azt mar megeri elemezni.
      const msg = JSON.parse(buffer.toString("utf8")) as ServerMessage;
      if (msg.type === "error") {
        console.log("  [szerver-hiba] " + msg.code + ": " + msg.message);
      } else if (msg.type === "joined") {
        load.playerId = msg.playerId;
        load.roomCode = msg.roomCode;
      }
    });
    void weapon;
  });
}

const send = (load: Load, message: ClientMessage): void => {
  if (load.socket.readyState === WebSocket.OPEN) {
    load.socket.send(JSON.stringify(message));
  }
};

async function main(): Promise<void> {
  console.log(`=== Terheles: ${PLAYERS} jatekos, ${SECONDS} mp ===\n`);

  const loads: Load[] = [];
  let room: string | undefined;

  for (let i = 0; i < PLAYERS; i++) {
    // Fele gepfegyveres: ok terhelik legjobban a fegyver-agat.
    const weapon = i % 2 === 0 ? "machinegun" : "cannon";
    const load = await connect(`T${i}`, weapon);
    send(load, {
      type: "join",
      protocol: PROTOCOL,
      roomCode: room,
      name: `Teszt${i}`,
      weapon,
    });
    // Megvarjuk a szobakodot, hogy a tobbiek ugyanoda lepjenek be.
    for (let w = 0; w < 50 && !load.roomCode; w++) await sleep(40);
    room ??= load.roomCode ?? undefined;
    loads.push(load);
  }

  const joined = loads.filter((l) => l.playerId !== null).length;
  check(
    "mindenki bejutott ugyanabba a szobaba",
    joined === PLAYERS && new Set(loads.map((l) => l.roomCode)).size === 1,
    `${joined} / ${PLAYERS} jatekos, szoba: ${room}`,
  );

  // A meres a csatlakozas utan indul: a beallas ne szamitson bele.
  await sleep(1000);
  for (const load of loads) {
    load.snapshots = 0;
    load.bytes = 0;
    load.gaps.length = 0;
    load.lastSnapshotAt = 0;
  }

  // Mozgas + folyamatos tuz: a legterhelobb eset.
  const started = performance.now();
  const timer = setInterval(() => {
    const t = (performance.now() - started) / 1000;
    for (let i = 0; i < loads.length; i++) {
      const load = loads[i];
      // Korben jarnak az arenaban, hogy a poziciok tenyleg valtozzanak.
      const angle = t * 0.8 + (i * Math.PI * 2) / loads.length;
      send(load, {
        type: "state",
        seq: Math.floor(t * SEND_HZ),
        ackTick: 0,
        state: {
          position: [Math.cos(angle) * 18, 1, Math.sin(angle) * 18],
          rotation: [0, 0, 0, 1],
          velocity: [-Math.sin(angle) * 14, 0, Math.cos(angle) * 14],
          aimYaw: angle,
          aimPitch: 0,
          firing: i % 2 === 0,
          steer: 0,
          susp: [0.3, 0.3, 0.3, 0.3],
        },
      });
    }
  }, 1000 / SEND_HZ);

  await sleep(SECONDS * 1000);
  clearInterval(timer);

  const elapsed = (performance.now() - started) / 1000;

  // --- Erkeznek-e a snapshotok a beallitott utemben? ---
  const rates = loads.map((l) => l.snapshots / elapsed);
  const worstRate = Math.min(...rates);
  check(
    "a snapshot-utem tartja a beallitott erteket",
    worstRate > SNAPSHOT_HZ * 0.9,
    `leggyengebb kliens: ${worstRate.toFixed(1)} Hz (beallitva: ${SNAPSHOT_HZ} Hz)`,
  );

  // --- Akadozas: a legnagyobb szunet ket snapshot kozott ---
  //
  // Az atlag elrejtene a megakadast: ha a szerver felmasodpercre
  // megall, az atlagos utem meg jonak latszik, a jatek viszont ugrik.
  const allGaps = loads.flatMap((l) => l.gaps).sort((a, b) => a - b);
  const p99 = allGaps[Math.floor(allGaps.length * 0.99)] ?? 0;
  const worstGap = allGaps[allGaps.length - 1] ?? 0;
  const expected = 1000 / SNAPSHOT_HZ;
  check(
    "nincs erdemi megakadas",
    p99 < expected * 3,
    `p99: ${p99.toFixed(0)} ms, legrosszabb: ${worstGap.toFixed(0)} ms (varhato: ${expected.toFixed(0)} ms)`,
  );

  // --- Savszelesseg jatekosonkent ---
  //
  // Ez donti el, hogy egy gyengebb halozaton is jatszhato-e. A szam
  // magaban keveset mond, ezert kimondjuk a teljes kimeno forgalmat is.
  const perClient = loads.map((l) => l.bytes / elapsed);
  const worstClient = Math.max(...perClient);
  const total = perClient.reduce((a, b) => a + b, 0);
  check(
    "a savszelesseg jatekosonkent ertelmes hataron belul",
    worstClient < 250_000,
    `${(worstClient / 1024).toFixed(0)} kB/s jatekosonkent, osszesen ${(total / 1024).toFixed(0)} kB/s`,
  );

  for (const load of loads) load.socket.close();
  await sleep(300);

  console.log(
    failures === 0
      ? "\n=== Minden teszt OK ==="
      : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
