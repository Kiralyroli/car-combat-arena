/**
 * Fust-teszt: ket kliens csatlakozik ugyanabba a szobaba, mozognak, es
 * ellenorizzuk, hogy latjak-e egymast a snapshotokban.
 *
 * Futtatas (a szervernek futnia kell):
 *   npx tsx scripts/smoke-two-clients.ts
 */
import { WebSocket } from "ws";
import {
  IMPACT_COOLDOWN_MS,
  PROTOCOL_VERSION,
  SNAPSHOT_HZ,
  type ClientMessage,
  type ServerMessage,
} from "@cca/shared";

const URL = process.env.SERVER_URL ?? "ws://localhost:8080";

/** Alap allapot, amibol a tesztek a poziciot/sebesseget felulirjak. */
const NEUTRAL_STATE = {
  position: [0, 1, 0] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
  velocity: [0, 0, 0] as [number, number, number],
  steer: 0,
  susp: [0.3, 0.3, 0.3, 0.3] as [number, number, number, number],
  grip: [1, 1, 1, 1] as [number, number, number, number],
  brokenMask: 0,
  aimYaw: 0,
  aimPitch: 0,
};

interface FakeClient {
  name: string;
  socket: WebSocket;
  playerId: string | null;
  roomCode: string | null;
  snapshotCount: number;
  /** A sajat HP-nk a legutobbi snapshot szerint. */
  hp: number;
  /** Az utoljara ELKULDOTT pozicio -- a fokozatos mozgatashoz. */
  lastSent: [number, number, number];
  /** Hova kert minket a szerver ujraszuletni, vagy null. */
  respawnPosition: [number, number, number] | null;
  /** Hany rakéta volt a legutobbi snapshotban. */
  rocketCount: number;
  /** Hany robbanas-esemenyt kaptunk. */
  explosions: number;
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
      hp: 100,
      lastSent: [0, 2.5, 0],
      respawnPosition: null,
      rocketCount: 0,
      explosions: 0,
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
          client.rocketCount = msg.rockets.length;
          for (const p of msg.players) {
            if (p.id === client.playerId) client.hp = p.hp;
            if (p.id !== client.playerId) client.seenOthers.add(p.id);
          }
          break;
        case "playerJoined":
          client.events.push(`playerJoined ${msg.playerId.slice(0, 8)}`);
          break;
        case "playerLeft":
          client.events.push(`playerLeft ${msg.playerId.slice(0, 8)}`);
          break;
        case "explosion":
          client.explosions++;
          break;
        case "respawn":
          client.respawnPosition = msg.position;
          client.events.push("respawn");
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
      state: { ...NEUTRAL_STATE, position: [seq, 2.5, 0], velocity: [10, 0, 0] },
    });
    send(b, {
      type: "state",
      seq,
      state: { ...NEUTRAL_STATE, position: [0, 2.5, seq], velocity: [0, 0, 10] },
    });
    a.lastSent = [seq, 2.5, 0];
    b.lastSent = [0, 2.5, seq];
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
    state: { ...NEUTRAL_STATE, position: [999, 999, 999] },
  });
  await sleep(200);
  const aInB = [...b.seenOthers].includes(a.playerId!);
  check("regi seq nem irta felul az allapotot", aInB, "a jatekos tovabbra is lathato");

  // 4b. Utkozesi sebzes -- a SZERVER donti el (terv 4. lepcso 2. pont).
  //     A kliensek NEM jelentenek be talalatot: a szerver a poziciobol
  //     es a sebessegbol allapitja meg.
  let seq = 100;

  // Eloszor egymas melle visszuk oket. A szerver plauzibilitas-
  // ellenorzese nem enged teleportalni, ezert TOBB LEPESBEN, a
  // megengedett sebesseg-koltsegvetesen belul kozelitunk.
  async function moveTo(
    client: FakeClient,
    target: [number, number, number],
  ): Promise<void> {
    const from = client.lastSent;
    for (let step = 1; step <= 5; step++) {
      const t = step / 5;
      send(client, {
        type: "state",
        seq: seq++,
        state: {
          ...NEUTRAL_STATE,
          position: [
            from[0] + (target[0] - from[0]) * t,
            from[1] + (target[1] - from[1]) * t,
            from[2] + (target[2] - from[2]) * t,
          ],
        },
      });
      await sleep(120);
    }
    client.lastSent = target;
  }

  await moveTo(a, [20, 1, 0]);
  await moveTo(b, [20, 1, 12]);
  await sleep(300);

  const hpBefore = { a: a.hp, b: b.hp };

  // Most osszeer a ket auto, egymas fele 18-18 m/s-mal (36 m/s kozeledes).
  const impactA: [number, number, number] = [20, 1, 0];
  const impactB: [number, number, number] = [20, 1, 4];
  send(a, {
    type: "state",
    seq: seq++,
    state: { ...NEUTRAL_STATE, position: impactA, velocity: [0, 0, 18] },
  });
  send(b, {
    type: "state",
    seq: seq++,
    state: { ...NEUTRAL_STATE, position: impactB, velocity: [0, 0, -18] },
  });

  // A sebzesre VARUNK, nem alszunk ra egy fix ideig: a hutest kesobb
  // csak akkor tudjuk ertelmesen merni, ha tudjuk, mikor tortent az
  // elso talalat. Fix alvassal a meres athuzodhat a hutesi ablakon --
  // ez elsore pontosan igy is tortent.
  const impactAt = performance.now();
  for (let i = 0; i < 20 && a.hp === hpBefore.a; i++) await sleep(25);

  check(
    "a szerver sebzett az utkozesert",
    a.hp < hpBefore.a && b.hp < hpBefore.b,
    `A: ${hpBefore.a} -> ${a.hp}, B: ${hpBefore.b} -> ${b.hp}`,
  );
  check(
    "mindket auto ugyanannyit kapott (nem iranyfuggo)",
    hpBefore.a - a.hp === hpBefore.b - b.hp,
    `${hpBefore.a - a.hp} vs ${hpBefore.b - b.hp} HP`,
  );

  // A hutes miatt a folytatodo erintkezes nem sebez ujra azonnal --
  // kulonben egyetlen koccanas masodpercenkent tucatnyi sebzest okozna.
  // A merest a HUTESI ABLAKON BELUL kell elvegezni.
  const hpAfterFirst = a.hp;
  send(a, {
    type: "state",
    seq: seq++,
    state: { ...NEUTRAL_STATE, position: impactA, velocity: [0, 0, 18] },
  });
  send(b, {
    type: "state",
    seq: seq++,
    state: { ...NEUTRAL_STATE, position: impactB, velocity: [0, 0, -18] },
  });
  await sleep(200);

  const elapsed = performance.now() - impactAt;
  check(
    "a folytatodo erintkezes nem sebez azonnal ujra",
    a.hp === hpAfterFirst && elapsed < IMPACT_COOLDOWN_MS,
    `${hpAfterFirst} -> ${a.hp} HP, ${elapsed.toFixed(0)} ms a hutesi ablakbol (${IMPACT_COOLDOWN_MS} ms)`,
  );

  // 4c. Megsemmisules es ujraszuletes (terv 4. lepcso 5. pont).
  //     Addig utkoztetjuk oket, amig valaki el nem fogy.
  for (let round = 0; round < 6 && a.hp > 0 && b.hp > 0; round++) {
    await sleep(IMPACT_COOLDOWN_MS + 80);
    send(a, {
      type: "state",
      seq: seq++,
      state: { ...NEUTRAL_STATE, position: impactA, velocity: [0, 0, 25] },
    });
    send(b, {
      type: "state",
      seq: seq++,
      state: { ...NEUTRAL_STATE, position: impactB, velocity: [0, 0, -25] },
    });
    await sleep(200);
  }

  const destroyed = a.hp === 0 || b.hp === 0;
  check("eleg utkozes utan megsemmisul az auto", destroyed, `A=${a.hp} B=${b.hp} HP`);

  // A megsemmisult jatekos allapotat a szerver NEM veszi at tobbe.
  const deadClient = a.hp === 0 ? a : b;
  const wreckPos = deadClient === a ? impactA : impactB;
  send(deadClient, {
    type: "state",
    seq: seq++,
    state: { ...NEUTRAL_STATE, position: [10, 1, 10], velocity: [0, 0, 0] },
  });
  await sleep(200);
  const stillAtWreck = [...(deadClient === a ? b : a).seenOthers].length > 0;
  check(
    "a megsemmisult auto allapota nem frissul",
    stillAtWreck,
    `a roncs a helyen maradt (${wreckPos.join(", ")})`,
  );

  // Ujraszuletes: a szerver kuldi meg a helyet, es teli HP-t ad.
  const respawnedAt = performance.now();
  for (let i = 0; i < 40 && deadClient.hp === 0; i++) await sleep(100);

  check(
    "a szerver ujraszuletette a jatekost",
    deadClient.hp === 100,
    `${deadClient.hp} HP ${((performance.now() - respawnedAt) / 1000).toFixed(1)} s mulva`,
  );
  check(
    "a kliens megkapta az ujraszuletesi poziciot",
    deadClient.respawnPosition !== null,
    deadClient.respawnPosition
      ? `[${deadClient.respawnPosition.map((v) => v.toFixed(0)).join(", ")}]`
      : "nem erkezett respawn uzenet",
  );

  // 4d. Rakéta (terv 4. lepcso 3. pont): a szerver szimulalja.
  //     A-t B moge allitjuk, B fele nezve (az orr a -Z fele nez).
  await moveTo(a, [22, 1, 18]);
  await moveTo(b, [22, 1, 0]);
  await sleep(400);

  const hpBeforeRocket = { a: a.hp, b: b.hp };
  const explosionsBefore = a.explosions;

  send(a, { type: "fire", target: [22, 1, 0] });
  await sleep(150);
  check(
    "a kiloves utan repul rakéta",
    a.rocketCount > 0,
    `${a.rocketCount} rakéta a snapshotban`,
  );

  // A hutes miatt kozvetlenul utana nem lehet ujra tuzelni.
  const rocketsAfterFirst = a.rocketCount;
  send(a, { type: "fire", target: [22, 1, 0] });
  await sleep(120);
  check(
    "a hutes miatt nem lehet azonnal ujra tuzelni",
    a.rocketCount <= rocketsAfterFirst,
    `${rocketsAfterFirst} -> ${a.rocketCount} rakéta`,
  );

  // Megvarjuk a becsapodast.
  for (let i = 0; i < 40 && a.explosions === explosionsBefore; i++) await sleep(100);

  check(
    "a becsapodas robbanast valt ki",
    a.explosions > explosionsBefore,
    `${a.explosions - explosionsBefore} robbanas`,
  );
  check(
    "a rakéta a becsapodas utan eltunik",
    a.rocketCount === 0,
    `${a.rocketCount} rakéta maradt`,
  );
  check(
    "a celpont sebzodott",
    b.hp < hpBeforeRocket.b,
    `B: ${hpBeforeRocket.b} -> ${b.hp} HP`,
  );
  // EZ a fontos negativ eset: a sajat rakétank ne sebezzen minket.
  // Az orr elott szuletik, de rossz elojellel azonnal onmagaba csapodna.
  check(
    "a kilovo nem sebezte meg magat",
    a.hp === hpBeforeRocket.a,
    `A: ${hpBeforeRocket.a} -> ${a.hp} HP`,
  );

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
