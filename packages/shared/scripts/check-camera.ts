/**
 * A kamera behuzodasa akadaly eseten -- bongeszo nelkul.
 *
 * A latvanyt kepernyokeppel iteljuk meg, de a SZABALYT itt merjuk: a
 * kamera akkor es csak akkor jojjon kozelebb, ha valami van kozte es az
 * auto kozott. Egy elrontott elojel vagy egy rossz kuszob csendes: a
 * kamera vagy soha nem huzodik be (marad a falban), vagy mindig behuzva
 * all, es a jatekos nem lat semmit.
 *
 * Futtatas: npm run check:camera
 */
import {
  ARENA,
  CAMERA_CLEARANCE,
  CAMERA_MIN_DISTANCE,
  cameraClamp,
  type ArenaBox,
} from "../src/index";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const tav = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Egy fal a megadott helyen, a probakhoz.
 *
 * KERESZTBEN all a kamera es az auto kozotti vonalra (szeles X-ben,
 * vekony Z-ben). Eloszor forditva irtam meg, es a fal a CELPONTOT is
 * lefedte -- olyankor a szamitas jogosan nem huz be semmit, es a teszt
 * ugy bukott, mintha a behuzodas nem mukodne.
 */
function fal(x: number, z: number): ArenaBox {
  return {
    name: "proba_fal",
    halfExtents: { x: 10, y: 5, z: 1 },
    position: { x, y: 5, z },
    color: 0,
  };
}

function main(): void {
  console.log("=== Kamera-utkozes ===\n");

  const auto: [number, number, number] = [0, 2, 0];
  const kamera: [number, number, number] = [0, 6, 12];

  // --- Szabad terepen NEM valtozik semmi ---
  //
  // Ez a gyakori eset: ha a kamera minden kepkockaban kicsit is
  // behuzodna, az egesz jatek "szuknek" erzodne.
  {
    const hol = cameraClamp(auto, kamera, []);
    check(
      "akadaly nelkul a kamera a helyen marad",
      tav(hol, kamera) < 1e-9,
      `(${hol.map((v) => v.toFixed(1)).join(", ")})`,
    );
  }

  // --- Fal a kamera es az auto kozott: behuzodik ---
  //
  // A fal TAVOLABB all, mint az also korlat (CAMERA_MIN_FRACTION): igy
  // az akadaly a meghatarozo, es azt merjuk, hogy a kamera tenyleg
  // elotte all meg. A kozeli fal esetet kulon nezzuk meg lentebb.
  {
    const boxok = [fal(0, 9)];
    const hol = cameraClamp(auto, kamera, boxok);
    check(
      "fal eseten a kamera kozelebb jon",
      tav(hol, auto) < tav(kamera, auto),
      `${tav(auto, kamera).toFixed(1)} m helyett ${tav(auto, hol).toFixed(1)} m`,
    );
    check(
      "a kamera a fal INNENSO oldalan all",
      hol[2] < 8,
      `z = ${hol[2].toFixed(2)} (a fal 8 es 10 kozott)`,
    );
    check(
      "es tart is tavolsagot a faltol",
      8 - hol[2] >= CAMERA_CLEARANCE - 1e-6,
      `${(8 - hol[2]).toFixed(2)} m a fal elott (elvart: ${CAMERA_CLEARANCE})`,
    );

    // KOZELI fal: a kamera nem tapadhat az autora.
    //
    // Merve: also korlat nelkul egy raktar mellett 1.4 m-re jott be, es
    // onnan a jatekos a sajat autojat sem latta.
    const kozeli = cameraClamp(auto, kamera, [fal(0, 2)]);
    check(
      "kozeli falnal sem tapad a kamera az autora",
      tav(kozeli, auto) >= CAMERA_MIN_DISTANCE - 1e-6,
      `${tav(auto, kozeli).toFixed(1)} m (a minimum ${CAMERA_MIN_DISTANCE} m)`,
    );
  }

  // --- A kamera SOSEM kerul az auto ele ---
  //
  // Ha az auto maga beszorul (a celpont egy dobozban van), a naiv
  // szamitas nullat adna, es a kamera az auto belsejebe ugrana.
  {
    const boxok = [fal(0, 0)];
    const hol = cameraClamp(auto, kamera, boxok);
    check(
      "beszorult autonal sem ugrik a kamera az autoba",
      tav(hol, auto) > 1,
      `${tav(auto, hol).toFixed(1)} m tavolsag`,
    );
  }

  // --- A kamera MOGOTTI fal nem szamit ---
  //
  // Csak az szamit, ami KOZTE es az auto kozott van. Egy fal a kamera
  // mogott nem indokolja a behuzodast.
  {
    const boxok = [fal(0, 20)];
    const hol = cameraClamp(auto, kamera, boxok);
    check(
      "a kamera mogotti fal nem huzza be",
      tav(hol, kamera) < 1e-9,
      "valtozatlan",
    );
  }

  // --- A VALODI palyan: a hataroló epuletek mogul nem lehet nezni ---
  //
  // Ez a tenyleges panasz: a palya szelen a kamera a hataroló epulet
  // tuloldalara esett.
  {
    // Az auto a keleti hatar mellett, a kamera nyugat fele nezne --
    // vagyis a kamera a hataron KIVULRE kerulne.
    const szelen: [number, number, number] = [58, 2, 0];
    const kintrol: [number, number, number] = [70, 6, 0];
    const hol = cameraClamp(szelen, kintrol, ARENA);
    check(
      "a palya szelen a kamera nem kerul a hataroló epuletbe",
      hol[0] < 70 - 1e-6,
      `x = ${hol[0].toFixed(1)} (a hatar 60-nal, a kert hely 70)`,
    );
  }

  // --- A PALYA KOZEPEN semmi nem huzza be ---
  {
    const kozepen: [number, number, number] = [0, 2, 0];
    const mogotte: [number, number, number] = [0, 6, 12];
    const hol = cameraClamp(kozepen, mogotte, ARENA);
    check(
      "a nyitott kozepen a kamera teljes tavolsagra all",
      tav(hol, mogotte) < 1e-9,
      "nem huzodik be feleslegesen",
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
