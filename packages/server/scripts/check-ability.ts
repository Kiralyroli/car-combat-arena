/**
 * KEPESSEGEK a szerveren: gyogyitas es pajzs.
 *
 * A kepessegeket a SZERVER donti el, mert mindketto a sebzes
 * kimenetelet valtoztatja. Amit itt vedunk:
 *
 *  1. A PAJZS MINDEN sebzes-utvonalon hat. Ugyanaz a kockazat, mint a
 *     spawn-vedelemnel: ha egy utvonal kimaradna, a jatekos vedettnek
 *     latszana, kozben megis meghalna.
 *  2. A pajzs NEM tunik el a sajat lovestol. A spawn-vedelmet
 *     szandekosan torli a tuzeles ("aki lo, az mar nem menekul"), a
 *     pajzs viszont eppen azert van, hogy mogotte lehessen harcolni.
 *     Ez a ketto ugyanazon a mezon konnyen osszekeveredik.
 *  3. Elve nem lehet kepesseget valtani -- kulonben menekules kozben
 *     at lehetne allni arra, ami eppen jobban jonne.
 *  4. A visszatoltes tenyleg visszafog.
 *
 * SZANDEKOSAN bongeszo nelkul: az idozitest csak igy lehet pontosan,
 * ingadozas nelkul merni.
 *
 * Futtatas: npm run check:ability
 */
import {
  ABILITIES,
  FIXED_DT,
  IMPACT_COOLDOWN_MS,
  maxHpOf,
  type ClientState,
  type ServerMessage,
} from "@cca/shared";
import { Room, type ServerPlayer } from "../src/rooms/room";

/**
 * EGY JATEKOS teli eletereje.
 *
 * Nem kozos konstans: az eletero autonkent 80 es 130 kozott van
 * (carStats.ts), es a szobat a szerver osztja ki -- a teszt tehat nem
 * tudja elore, ki mivel jatszik. A kozos 100-zal ez a meres csendben
 * ertelmetlenne valt: a 80 HP-s izomautonak "95 HP-t" allitottunk be,
 * amit a gyogyulas mar nem tudott novelni, es a teszt ugy bukott el,
 * hogy a gyogyitassal semmi baj nem volt.
 */
const teli = (p: ServerPlayer): number => maxHpOf(p.car);

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

interface Fixture {
  room: Room;
  a: ReturnType<Room["add"]>;
  b: ReturnType<Room["add"]>;
}

/** Elindult meccs ket jatekossal, megadott kepessegekkel. */
function startedMatch(startedAt: number, aAbility: string, bAbility: string): Fixture {
  const room = new Room("TEST");
  const nyeld = (_m: ServerMessage) => {};
  const a = room.add("a", nyeld, "A", "cannon", undefined, aAbility as never);
  const b = room.add("b", nyeld, "B", "machinegun", undefined, bAbility as never);
  room.stepMatch(startedAt);
  return { room, a, b };
}

/** Ket egymasnak hajto auto -- biztos utkozes, biztos sebzes. */
function collide(f: Fixture, now: number): void {
  const a: Partial<ClientState> = { position: [0, 1, 2], velocity: [0, 0, -25] };
  const b: Partial<ClientState> = { position: [0, 1, -2], velocity: [0, 0, 25] };
  f.a.state = { ...f.a.state, ...a };
  f.b.state = { ...f.b.state, ...b };
  f.room.resolveCollisions(now);
}

/**
 * A gyogyulas vegiglepetese.
 *
 * A gyogyitas FOKOZATOS: a szerver tickenkent ad vissza egy tortnyi
 * eletet (lasd stepHealing). Egy egyszeri hivas tehat alig valtoztat
 * -- a hatast csak a teljes idotartam vegiglepetesevel lehet merni.
 */
function gyogyulasVegig(f: Fixture, from: number): number {
  let now = from;
  const lepesek = Math.ceil(ABILITIES.heal.durationMs / (FIXED_DT * 1000)) + 2;
  for (let i = 0; i < lepesek; i++) {
    f.room.stepHealing(FIXED_DT, now);
    now += FIXED_DT * 1000;
  }
  return now;
}

/**
 * A spawn-vedelem lejarta utani idopont.
 *
 * A meccs indulasakor mindenki vedett; ha ezt nem varnank ki, a
 * "pajzs vedett" allitas akkor is teljesulne, ha a pajzs egyaltalan nem
 * mukodne. A meres igy semmit nem erne.
 */
function vedelemUtan(startedAt: number): number {
  return startedAt + 10_000;
}

function main(): void {
  console.log("=== Kepessegek a szerveren ===\n");

  const T0 = 10_000;

  // --- A PAJZS elnyeli a sebzest ---
  {
    const f = startedMatch(T0, "shield", "shield");
    const now = vedelemUtan(T0);

    // ELOSZOR pajzs nelkul: enelkul nem tudnank, hogy az utkozes
    // egyaltalan sebez-e ebben a felallasban.
    collide(f, now);
    const pajzsNelkul = teli(f.b) - f.b.hp;
    check(
      "pajzs nelkul az utkozes sebez",
      pajzsNelkul > 0,
      `${pajzsNelkul} HP -- e nelkul a pajzs-meres semmit nem erne`,
    );

    // A KOVETKEZO utkozes csak az utkozes SAJAT visszatoltese utan
    // sebez (IMPACT_COOLDOWN_MS). Enelkul a "pajzs alatt nincs sebzes"
    // allitas vakon menne at: a masodik utkozes amugy sem sebzett
    // volna. Merve: a pajzsot kivéve a kodbol a teszt tovabbra is
    // atment -- vagyis semmit nem ert.
    const pajzsKor = now + IMPACT_COOLDOWN_MS + 100;
    f.b.hp = teli(f.b);
    f.a.hp = teli(f.a);
    const sikerult = f.room.useAbility("b", pajzsKor);
    check("a pajzs elsul", sikerult, "useAbility -> true");

    collide(f, pajzsKor + 10);
    check(
      "a pajzs alatt nincs sebzes",
      f.b.hp === teli(f.b),
      `${f.b.hp} / ${teli(f.b)} HP (${IMPACT_COOLDOWN_MS} ms-mal a korabbi utkozes utan)`,
    );

    // ...es a LEJARTA utan megint sebzodik.
    const utana = pajzsKor + ABILITIES.shield.durationMs + IMPACT_COOLDOWN_MS + 100;
    f.b.hp = teli(f.b);
    collide(f, utana);
    check(
      "a pajzs lejarta utan megint sebzodik",
      f.b.hp < teli(f.b),
      `${f.b.hp} / ${teli(f.b)} HP`,
    );
  }

  // --- A pajzs a SNAPSHOTBAN is latszik ---
  //
  // A tamadonak latnia kell, miert tunik el a lovese -- kulonben
  // szamara ok nelkul nem tortenik semmi.
  {
    const f = startedMatch(T0, "shield", "shield");
    const now = vedelemUtan(T0);
    f.room.useAbility("b", now);
    const snap = f.room.buildSnapshot(now + 100);
    const b = snap.find((p) => p.id === "b");
    check(
      "a pajzs latszik a snapshotban",
      b?.abilityActive === true && b?.protected === true,
      `abilityActive: ${b?.abilityActive}, protected: ${b?.protected}`,
    );
  }

  // --- A pajzsot a SAJAT LOVES nem oltja ki ---
  //
  // A spawn-vedelmet szandekosan torli a tuzeles. A pajzs viszont
  // eppen azert van, hogy mogotte lehessen harcolni -- ha a ket
  // allapot ugyanazon a mezon lakna, az elso sajat loves eltuntetne.
  {
    const f = startedMatch(T0, "shield", "shield");
    const now = vedelemUtan(T0);
    f.room.useAbility("b", now);
    // B tuzel (a fire a sajat vedelmet torli).
    f.room.tryFire("b", [0, 1, -50], now + 50);
    const snap = f.room.buildSnapshot(now + 100);
    const b = snap.find((p) => p.id === "b");
    check(
      "a sajat loves nem oltja ki a pajzsot",
      b?.abilityActive === true,
      `abilityActive: ${b?.abilityActive}`,
    );
  }

  // --- A GYOGYITAS visszaad eletet, de nem tobbet a maximumnal ---
  {
    const f = startedMatch(T0, "heal", "heal");
    const now = vedelemUtan(T0);

    f.b.hp = 30;
    f.room.useAbility("b", now);

    // AZONNAL alig valtozik: ez a lenyeg -- a gyogyitas nem mentogomb.
    f.room.stepHealing(FIXED_DT, now);
    check(
      "a gyogyitas NEM azonnal tortenik",
      f.b.hp < 30 + ABILITIES.heal.heal / 2,
      `egy tick utan ${f.b.hp} (a teljes ${30 + ABILITIES.heal.heal} lenne)`,
    );

    const vege = gyogyulasVegig(f, now);
    check(
      "a teljes idotartam alatt visszaadja az eletet",
      f.b.hp === 30 + ABILITIES.heal.heal,
      `30 -> ${f.b.hp} (+${ABILITIES.heal.heal}) ${ABILITIES.heal.durationMs} ms alatt`,
    );

    // TELI elettel sem megy a maximum foles.
    f.a.hp = teli(f.a) - 5;
    f.room.useAbility("a", vege);
    gyogyulasVegig(f, vege);
    check(
      "a gyogyitas nem lep a maximum fole",
      f.a.hp === teli(f.a),
      `${teli(f.a) - 5} -> ${f.a.hp}`,
    );
  }

  // --- A VISSZATOLTES visszafog ---
  {
    const f = startedMatch(T0, "heal", "heal");
    const now = vedelemUtan(T0);
    f.b.hp = 10;
    f.room.useAbility("b", now);
    gyogyulasVegig(f, now);
    const elso = f.b.hp;

    const megint = f.room.useAbility("b", now + 100);
    check(
      "a visszatoltes alatt nem sul el ujra",
      !megint && f.b.hp === elso,
      `masodik keres: ${megint}, HP: ${f.b.hp}`,
    );

    const ujra = now + ABILITIES.heal.cooldownMs + 1;
    const kesobb = f.room.useAbility("b", ujra);
    gyogyulasVegig(f, ujra);
    check(
      "a visszatoltes utan viszont igen",
      kesobb && f.b.hp > elso,
      `${elso} -> ${f.b.hp}`,
    );
  }

  // --- ELVE nem lehet valtani ---
  {
    const f = startedMatch(T0, "shield", "shield");
    const elutasitva = f.room.setAbility("b", "heal");
    check(
      "elve nem lehet kepesseget valtani",
      !elutasitva && f.b.ability === "shield",
      `setAbility -> ${elutasitva}, a kepesseg: ${f.b.ability}`,
    );
  }

  // --- A HALAL megszakitja a gyogyulast ---
  //
  // Kulonben a halott jatekos HP-ja tovabb nőne a halal-kepernyo
  // alatt, es az ujraszuletes utan ertelmetlen allapotbol indulna.
  {
    const f = startedMatch(T0, "heal", "heal");
    const now = vedelemUtan(T0);
    f.b.hp = 20;
    f.room.useAbility("b", now);
    f.room.stepHealing(FIXED_DT, now);
    const kozben = f.b.hp;

    f.b.deadSince = now + 100;
    gyogyulasVegig(f, now + 100);
    check(
      "a halal megszakitja a gyogyulast",
      f.b.hp === kozben,
      `${kozben} HP-nal allt meg`,
    );
  }

  // --- MECCS ELOTT is elsul ---
  //
  // A kepesseg eloszor csak elindult meccsen mukodott. Egy jatekos
  // egyedul viszont sosem lat elindult meccset (ketto kell hozza), es
  // szamara a Q egyszeruen nem csinalt semmit -- magyarazat nelkul.
  // Ez a legvalosziubb elso elmeny, tehat kulon merjuk.
  {
    const room = new Room("TEST");
    const a = room.add("a", () => {}, "A", "cannon", undefined, "shield" as never);
    // NINCS stepMatch: egyetlen jatekossal a meccs el sem indul.
    check(
      "egyetlen jatekosnal is elsul a kepesseg",
      room.useAbility("a", 1000),
      `a jatekos kepessege: ${a.ability}`,
    );
  }

  // --- HALOTTAN nem sul el ---
  //
  // A kepesseg az eletben tart, nem feltamaszt. Egy halott jatekos
  // gyogyitasa a halal-kepernyon ertelmetlen allapotot adna.
  {
    const f = startedMatch(T0, "heal", "heal");
    let now = vedelemUtan(T0);
    for (let i = 0; i < 40 && f.b.hp > 0; i++) {
      collide(f, now);
      f.a.hp = teli(f.a);
      now += 400;
    }
    f.room.stepMatch(now);
    check(
      "sikerult kiutni B-t",
      f.b.deadSince !== null,
      `HP: ${f.b.hp}, halott: ${f.b.deadSince !== null}`,
    );
    check(
      "halottan nem sul el a kepesseg",
      !f.room.useAbility("b", now + 100),
      "useAbility -> false",
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
