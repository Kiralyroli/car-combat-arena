/**
 * Egy idovonalon rajzoljuk-e a tavoli autokat ES a rakétakat?
 *
 * Ez volt a legnagyobb elteres a latvany es a szerver szamitasa kozott:
 * az autok interpolacios pufferbol jottek (100 ms kesleltetes), a
 * rakéta viszont a legfrissebb snapshotbol rajzolodott azonnal. A
 * lovedek igy ~100 ms-szal a celpont ELOTT jart a kepernyon -- 55 m/s
 * mellett 5.5 m --, tehat MOZGO celpontnal a jatekos elhuzni latta a
 * rakétat olyankor is, amikor a szerver talalatot konyvelt.
 *
 * SZANDEKOSAN egysegteszt, nem bongeszos e2e:
 *
 *  - Allo celpontnal a hiba egyaltalan nem merheto (az auto ugyanott van
 *    minden idopillanatban), mozgo celpontra pedig eltalalni egy 0.45 s-os
 *    lovedekkel ingadozo headless kornyezetben megbizhatatlan meres.
 *  - A hiba VALODI helye a ket puffer kesleltetese. Ha valaki az egyiket
 *    elallitja, annak itt kell elbuknia -- azonnal es egyertelmuen.
 *
 * Futtatas: npx tsx scripts/check-interp-timeline.ts
 */
import { INTERP_DELAY_MS, RemotePlayers } from "../src/network/remotePlayers";
import { RemoteRockets } from "../src/network/remoteRockets";
import { ExplosionQueue } from "../src/network/explosionQueue";
import type { PlayerSnapshot, RocketSnapshot } from "@cca/shared";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

/**
 * Mindket entitas ugyanazon a palyan mozog: z = (a minta ideje).
 * Igy a VISSZAKAPOTT z KOZVETLENUL megmondja, melyik idopontot
 * jelenitjuk meg -- nem kell kitalalni a belso kesleltetest.
 */
function player(t: number): PlayerSnapshot {
  return {
    id: "P",
    position: [0, 0, t],
    rotation: [0, 0, 0, 1],
    velocity: [0, 0, 1],
    steer: 0,
    susp: [0.3, 0.3, 0.3, 0.3],
    grip: [1, 1, 1, 1],
    brokenMask: 0,
    aimYaw: 0,
    aimPitch: 0,
    hp: 100,
  };
}

function rocket(t: number): RocketSnapshot {
  return { id: 1, ownerId: "P", position: [0, 0, t], direction: [0, 0, 1] };
}

function main(): void {
  console.log("=== Interpolacios idovonal ===\n");

  const players = new RemotePlayers();
  const rockets = new RemoteRockets();

  // 20 Hz-es snapshotok 0..500 ms kozott, mindketto UGYANAZOKBAN a
  // pillanatokban -- ahogy a valosagban is (egy snapshot tartalmazza
  // mindkettot).
  for (let t = 0; t <= 500; t += 50) {
    players.ingest([player(t)], t);
    rockets.ingest([rocket(t)], t);
  }

  const now = 400;
  const carState = players.sample("P", now);
  const rocketList = rockets.sample(now);

  check(
    "mindket entitas megjelenik",
    carState !== null && rocketList.length === 1,
    `auto: ${carState ? "van" : "nincs"}, rakéta: ${rocketList.length} db`,
  );

  if (!carState || rocketList.length !== 1) {
    console.log("\n=== A tobbi meres ertelmetlen ===");
    process.exitCode = 1;
    return;
  }

  const carTime = carState.position.z;
  const rocketTime = rocketList[0].position[2];

  check(
    "az auto a mult egy pontjat mutatja (nem a jelent)",
    carTime < now - 50,
    `${now} ms-kor a ${carTime.toFixed(0)} ms-os allapotot rajzoljuk`,
  );

  // EZ A LENYEG. Korabban a rakéta a legfrissebb mintat (400 ms) adta
  // volna, az auto pedig a 300 ms-osat -- 100 ms, azaz 55 m/s-nal 5.5 m
  // elteres ugyanabban a kepkockaban.
  check(
    "a rakéta UGYANAZT az idopontot mutatja, mint az auto",
    Math.abs(carTime - rocketTime) < 1,
    `auto: ${carTime.toFixed(0)} ms, rakéta: ${rocketTime.toFixed(0)} ms (elteres ${Math.abs(carTime - rocketTime).toFixed(1)} ms)`,
  );

  // Az eltero kesleltetes tavolsagban kifejezve -- ez az, amit a jatekos
  // latna.
  const driftMeters = (Math.abs(carTime - rocketTime) / 1000) * 55;
  check(
    "nincs latvanybeli elcsuszas a lovedek es a cel kozott",
    driftMeters < 0.1,
    `${driftMeters.toFixed(2)} m (a regi viselkedes 5.5 m volt)`,
  );

  console.log("\nTovabbvetites a becsapodas elotti utolso pillanatokra:");

  // A szerver 60 Hz-en lepteti a rakétat, de 20 Hz-en kuld. Az utolso
  // elkuldott pozicio ezert akar 2.75 m-rel a talalat elott van; a
  // kliens ezt a darabot vetiti tovabb.
  const tail = new RemoteRockets();
  for (let t = 0; t <= 200; t += 50) tail.ingest([rocket(t)], t);

  // 200 ms az utolso minta; 100 ms kesleltetessel a 330 ms-os lekerdezes
  // renderTime-ja 230 ms, azaz 30 ms-szal az utolso minta utan.
  const extrapolated = tail.sample(330);
  check(
    "az utolso minta utan is latszik meg a lovedek",
    extrapolated.length === 1,
    `${extrapolated.length} db`,
  );
  if (extrapolated.length === 1) {
    check(
      "a tovabbvetitett pozicio a repules folytatasa",
      Math.abs(extrapolated[0].position[2] - 230) < 5,
      `${extrapolated[0].position[2].toFixed(0)} ms-nak megfelelo pont (varhato ~230)`,
    );
  }

  // SZUK IDOKOZ. Halozati ingadozas mellett ket snapshot beerkezhet
  // szinte egyszerre. Ha a sebesseget ilyenkor is a ket mintabol
  // szamolnank, a lepes tizszeresere-szazszorosara nagyulna. Ez NEM
  // elmeleti: meressel a lovedek z = -517-re szallt at a palyan a
  // z = 3 helyett.
  const jittered = new RemoteRockets();
  jittered.ingest([rocket(0)], 0);
  jittered.ingest([rocket(50)], 100);
  jittered.ingest([rocket(100)], 101); // 1 ms-re a predecessortol
  const runaway = jittered.sample(230); // renderTime = 130, 29 ms-szal utana
  const far = runaway.length === 1 ? Math.abs(runaway[0].position[2]) : 0;
  check(
    "szuk mintakozzel sem szalad el a tovabbvetites",
    runaway.length === 0 || far < 200,
    runaway.length === 0
      ? "nem vetitunk tovabb (helyes: a sebesseg nem meghatarozhato)"
      : `z = ${runaway[0].position[2].toFixed(0)} (a hibas valtozat tobb szazat adott)`,
  );

  console.log("\nRobbanas-effekt idozitese:");

  // A szerver akkor kuld `explosion` uzenetet, amikor a lovedek AZ O
  // idejeben becsapodott. Ha a villanas beerkezeskor azonnal megjelenne,
  // megelozne a kesleltetve rajzolt rakétat: eloszor a robbanas latszana,
  // es csak utana erne oda a lovedek.
  const queue = new ExplosionQueue();
  queue.push([1, 2, 3], 1000);

  check(
    "a beerkezes pillanataban meg NEM jelenik meg",
    queue.due(1000).length === 0 && queue.waiting === 1,
    "varakozik",
  );
  check(
    "a rakéta idovonala elott meg nem jelenik meg",
    queue.due(1000 + INTERP_DELAY_MS - 10).length === 0,
    `${INTERP_DELAY_MS - 10} ms-mal kesobb meg varakozik`,
  );

  const released = queue.due(1000 + INTERP_DELAY_MS);
  check(
    "pontosan a rakéta idovonalan jelenik meg",
    released.length === 1 && released[0][0] === 1 && released[0][2] === 3,
    `${INTERP_DELAY_MS} ms-mal a beerkezes utan, a kapott pozicioval`,
  );
  check(
    "egyszer jelenik meg, nem ismetlodik",
    queue.due(2000).length === 0 && queue.waiting === 0,
    "a sor kiurult",
  );

  console.log(
    failures === 0 ? "\n=== Minden teszt OK ===" : `\n=== ${failures} teszt ELBUKOTT ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
