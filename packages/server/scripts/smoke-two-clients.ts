/**
 * Fust-teszt: ket kliens csatlakozik ugyanabba a szobaba, mozognak, es
 * ellenorizzuk, hogy latjak-e egymast a snapshotokban.
 *
 * Futtatas (a szervernek futnia kell):
 *   npx tsx scripts/smoke-two-clients.ts
 */
import { WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  SNAPSHOT_HZ,
  type ClientMessage,
  type ServerMessage,
} from "@cca/shared";

const URL = process.env.SERVER_URL ?? "ws://localhost:8080";

interface FakeClient {
  name: string;
  socket: WebSocket;
  playerId: string | null;
  roomCode: string | null;
  snapshotCount: number;
  seenOthers: Set<string>;
  events: string[];
  /** Visszakapott `pong`-ok: a kuldesi idobelyeg es a BEERKEZES ideje. */
  pongs: { t: number; arrivedAt: number }[];
}

function connect(name: string): Promise<FakeClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(URL);
    const client: FakeClient = {
      name,
      socket,
      playerId: null,
      roomCode: null,
      snapshotCount: 0,
      seenOthers: new Set(),
      events: [],
      pongs: [],
    };

    socket.on("open", () => resolve(client));
    socket.on("error", reject);
    socket.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      switch (msg.type) {
        case "joined":
          client.playerId = msg.playerId;
          client.roomCode = msg.roomCode;
          client.events.push(`joined room=${msg.roomCode} others=${msg.players.length}`);
          break;
        case "snapshot":
          client.snapshotCount++;
          for (const p of msg.players) {
            if (p.id !== client.playerId) client.seenOthers.add(p.id);
          }
          break;
        case "playerJoined":
          client.events.push(`playerJoined ${msg.playerId.slice(0, 8)}`);
          break;
        case "playerLeft":
          client.events.push(`playerLeft ${msg.playerId.slice(0, 8)}`);
          break;
        case "pong":
          // A beerkezes idejet ITT kell rogziteni. Ha csak kesobb, a
          // fo szalon mernenk, a meres a sajat varakozasunkat adna
          // vissza, nem a halozati kort -- olyan tesztet kapnank, ami
          // akkor is atmegy, ha a ping valojaban borzalmas.
          client.pongs.push({ t: msg.t, arrivedAt: performance.now() });
          break;
        case "error":
          client.events.push(`error ${msg.code}: ${msg.message}`);
          break;
      }
    });
  });
}

function send(client: FakeClient, message: ClientMessage): void {
  client.socket.send(JSON.stringify(message));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  console.log("=== Ket-kliens fust-teszt ===\n");

  // 1. Elso kliens: uj szoba nyitasa
  const a = await connect("A");
  send(a, { type: "join", protocol: PROTOCOL_VERSION });
  await sleep(300);
  check("A szobat nyitott", a.roomCode !== null, `roomCode=${a.roomCode}`);

  // 2. Masodik kliens: csatlakozas ugyanabba a szobaba
  const b = await connect("B");
  send(b, { type: "join", protocol: PROTOCOL_VERSION, roomCode: a.roomCode! });
  await sleep(300);
  check("B ugyanabba a szobaba lepett", b.roomCode === a.roomCode, `${b.roomCode} === ${a.roomCode}`);
  check(
    "A ertesult B csatlakozasarol",
    a.events.some((e) => e.startsWith("playerJoined")),
    a.events.join(" | ") || "(nincs esemeny)",
  );

  // 3. Mozgas: mindket kliens kuldi a sajat allapotat
  const startSnapshots = a.snapshotCount;
  const startedAt = performance.now();
  for (let seq = 1; seq <= 30; seq++) {
    send(a, {
      type: "state",
      seq,
      state: { position: [seq, 2.5, 0], rotation: [0, 0, 0, 1], velocity: [10, 0, 0] },
    });
    send(b, {
      type: "state",
      seq,
      state: { position: [0, 2.5, seq], rotation: [0, 0, 0, 1], velocity: [0, 0, 10] },
    });
    await sleep(16);
  }
  await sleep(300);

  check("A latja B autojat", a.seenOthers.has(b.playerId!), `${a.seenOthers.size} masik jatekos`);
  check("B latja A autojat", b.seenOthers.has(a.playerId!), `${b.seenOthers.size} masik jatekos`);

  const received = a.snapshotCount - startSnapshots;
  // A valos eltelt idot MERJUK, nem a sleep-konstansokbol szamoljuk --
  // a Node timerei felfele kerekitenek, igy a szamitott ertek rendszeresen
  // rovidebb a valosnal, ami hamisan magas ratat mutatna.
  const elapsedSec = (performance.now() - startedAt) / 1000;
  const rate = received / elapsedSec;
  check(
    `snapshot-rata kb. ${SNAPSHOT_HZ} Hz`,
    rate > SNAPSHOT_HZ * 0.75 && rate < SNAPSHOT_HZ * 1.25,
    `${rate.toFixed(1)} Hz (${received} snapshot ${elapsedSec.toFixed(2)}s alatt)`,
  );

  // 3b. Kes-meres: a szervernek VALTOZATLANUL kell visszhangoznia a
  //     kliens idobelyeget, kulonben a szamitott RTT ertelmetlen lenne.
  const sentAt = 123456.75;
  send(a, { type: "ping", t: sentAt });
  await sleep(300);
  const echoed = a.pongs.find((p) => p.t === sentAt);
  check(
    "a szerver visszhangozza a ping idobelyeget",
    !!echoed,
    echoed ? `pong.t = ${echoed.t}` : "nem jott vissza a kuldott idobelyeg",
  );

  const beforePing = performance.now();
  send(a, { type: "ping", t: beforePing });
  await sleep(300);
  const measured = a.pongs.find((p) => p.t === beforePing);
  const rtt = measured ? measured.arrivedAt - measured.t : -1;
  check(
    "az RTT ertelmes tartomanyban van (helyi szerver)",
    rtt >= 0 && rtt < 50,
    measured ? `${rtt.toFixed(1)} ms` : "nem erkezett pong",
  );

  // 4. Regi sorszamu csomag eldobasa
  send(a, {
    type: "state",
    seq: 5,
    state: { position: [999, 999, 999], rotation: [0, 0, 0, 1], velocity: [0, 0, 0] },
  });
  await sleep(200);
  const aInB = [...b.seenOthers].includes(a.playerId!);
  check("regi seq nem irta felul az allapotot", aInB, "a jatekos tovabbra is lathato");

  // 5. Lecsatlakozas
  b.socket.close();
  await sleep(400);
  check(
    "A ertesult B kilepeserol",
    a.events.some((e) => e.startsWith("playerLeft")),
    a.events.join(" | "),
  );

  // 6. Nem letezo szoba
  const c = await connect("C");
  send(c, { type: "join", protocol: PROTOCOL_VERSION, roomCode: "ZZZZ" });
  await sleep(300);
  check(
    "nem letezo szoba hibat ad",
    c.events.some((e) => e.includes("room_not_found")),
    c.events.join(" | ") || "(nincs esemeny)",
  );

  // 7. Rossz protokoll-verzio
  const d = await connect("D");
  send(d, { type: "join", protocol: 999 });
  await sleep(300);
  check(
    "rossz protokoll-verzio hibat ad",
    d.events.some((e) => e.includes("bad_protocol")),
    d.events.join(" | ") || "(nincs esemeny)",
  );

  a.socket.close();
  c.socket.close();
  d.socket.close();

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("A teszt osszeomlott:", err);
  process.exit(1);
});
