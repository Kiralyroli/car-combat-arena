/**
 * Valaszthato autok: KAROSSZERIA + FESTES, es a kiosztas szabalyai.
 *
 * A MEGOLDANDO HIBA: ha ket jatekos teljesen egyformán nez ki, a
 * "kit lattam" kerdes eldonthetetlen -- nem lehet egymasrol beszelni
 * ("a rendorauto kempel"). Ezert a szerver osztja ki a kinezetet, es
 * gondoskodik rola, hogy a KAROSSZERIA + FESTES paros egyedi legyen.
 *
 * A masik irany is hiba volna: ha a kiosztas ok nelkul MAS FORMAT adna,
 * a jatekos nem azzal jatszana, amit valasztott. A szabaly ezert: a
 * kert paros, ha szabad; kulonben ugyanazon a kocsin masik festes; es
 * csak vegso esetben masik kocsi.
 *
 * Futtatas: npm run check:cars
 */
import { CAR_GEOMETRY } from "../src/carGeometry";
import { cameraScaleFor } from "../src/carSizes";
import { CAMERA } from "../src/config";
import { weaponMountHeight } from "../src/weapons";
import {
  CAR_MODELS,
  DEFAULT_CAR,
  DEFAULT_SKIN,
  assignCar,
  carLabel,
  isCarId,
  isSkinOf,
  skinsOf,
  toCarId,
  toSkin,
  type CarId,
  type CarLook,
} from "../src/carModels";
import { CAR_SKIN_TEXTURES } from "../src/carSkins";

/** A szoba merete -- lasd MAX_PLAYERS_PER_ROOM a szerveren. */
const MAX_PLAYERS_PER_ROOM = 8;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

function main(): void {
  console.log("=== Valaszthato autok ===\n");

  const parosok: CarLook[] = CAR_MODELS.flatMap((m) =>
    m.skins.map((s) => ({ car: m.id, skin: s.id })),
  );

  // --- Eleg KOMBINACIO van egy teli szobara ---
  //
  // Negy karosszeria van, egy szobaba viszont nyolc jatekos fer: a
  // festesek nelkul ketten biztosan egyforman neznenek ki. Ha a szoba
  // merete no, vagy egy modell festesei fogynak, ez a teszt szol.
  {
    check(
      "van annyi kinezet, ahany jatekos egy szobaba fer",
      parosok.length >= MAX_PLAYERS_PER_ROOM,
      `${CAR_MODELS.length} karosszeria, osszesen ${parosok.length} kinezet`,
    );
  }

  // --- Nincs ketszer ugyanaz ---
  {
    const idk = CAR_MODELS.map((c) => c.id);
    const nevek = CAR_MODELS.map((c) => c.label);
    check(
      "minden auto-azonosito egyedi",
      new Set(idk).size === idk.length,
      idk.join(", "),
    );
    check(
      "minden nev egyedi",
      new Set(nevek).size === nevek.length,
      nevek.join(", "),
    );
    const rossz = CAR_MODELS.filter(
      (m) => new Set(m.skins.map((s) => s.id)).size !== m.skins.length,
    );
    check(
      "minden autonak egyedi festesei vannak",
      rossz.length === 0,
      CAR_MODELS.map((m) => `${m.id}: ${m.skins.length}`).join(", "),
    );
  }

  // --- Minden festeshez VAN TEXTURA ---
  //
  // A lista es a generalt textura-terkep kulon fajlban all: ha
  // elcsusznak, a jatekos olyan festest valaszthatna, ami nem letezik,
  // es az auto az alap-skinnel jelenne meg. Csendes hiba -- pont ezert
  // merjuk.
  {
    const hianyzo: string[] = [];
    for (const m of CAR_MODELS) {
      const terkep = CAR_SKIN_TEXTURES[m.id] ?? {};
      for (const s of m.skins) {
        const t = terkep[s.id];
        if (!t || !t.body) hianyzo.push(`${m.id}/${s.id}`);
      }
    }
    check(
      "minden festeshez tartozik textura",
      hianyzo.length === 0,
      hianyzo.length === 0
        ? `${Object.values(CAR_SKIN_TEXTURES).reduce((s, m) => s + Object.keys(m).length, 0)} festes`
        : `hianyzik: ${hianyzo.join(", ")}`,
    );
  }

  // --- ISMERETLEN ertek nem tori el a jatekot ---
  //
  // Az autot es a festest a kliens kuldi, tehat barmit kuldhet.
  {
    check(
      "ismeretlen auto az alapertelmezettre esik",
      toCarId("Ferrari") === DEFAULT_CAR &&
        toCarId(undefined) === DEFAULT_CAR &&
        toCarId(42) === DEFAULT_CAR &&
        toCarId("Jeep") === "Jeep",
      `ismeretlen -> ${DEFAULT_CAR} (${carLabel(DEFAULT_CAR)})`,
    );
    check(
      "ismeretlen festes az auto elso festesere esik",
      toSkin("Rescue", "Sarga") === skinsOf("Rescue")[0] &&
        toSkin("Rescue", undefined) === skinsOf("Rescue")[0] &&
        toSkin("Rescue", "Mento") === "Mento",
      `Rescue/Sarga -> ${toSkin("Rescue", "Sarga")}`,
    );
    // A festesek AUTONKENT masok: egy masik kocsi festese nem ervenyes.
    check(
      "egy masik auto festese nem ervenyes",
      !isSkinOf("Rescue", "Sarga") && isSkinOf("Muscle", "Sarga"),
      "a Muscle 'Sarga' festese a Rescue-n nem ervenyes",
    );
    check(
      "az alapertelmezett paros ervenyes",
      isCarId(DEFAULT_CAR) && isSkinOf(DEFAULT_CAR, DEFAULT_SKIN),
      `${DEFAULT_CAR}/${DEFAULT_SKIN}`,
    );
  }

  // --- A KERT kinezetet kapja, ha szabad ---
  {
    const kapott = assignCar({ car: "Jeep", skin: "Kek" }, [
      { car: "Muscle", skin: "Sarga" },
    ]);
    check(
      "a kert kinezet jar, ha meg szabad",
      kapott.car === "Jeep" && kapott.skin === "Kek",
      `${kapott.car}/${kapott.skin}`,
    );
  }

  // --- FOGLALT festes helyett UGYANAZON a kocsin masikat kap ---
  //
  // Ez a lenyeg: a jatekos valasztott FORMAJA megmarad, csak a festes
  // valtozik. Ha ilyenkor masik kocsit adnank, a valasztas ertelmet
  // vesztene.
  {
    const kapott = assignCar({ car: "Jeep", skin: "Kek" }, [
      { car: "Jeep", skin: "Kek" },
    ]);
    check(
      "foglalt festes helyett ugyanazon a kocsin masik festes",
      kapott.car === "Jeep" && kapott.skin !== "Kek",
      `Jeep/Kek foglalt -> ${kapott.car}/${kapott.skin}`,
    );
  }

  // --- Ha az EGESZ kocsi elfogyott, masik kocsi jon ---
  {
    const mindenJeep = skinsOf("Jeep").map((s) => ({ car: "Jeep" as CarId, skin: s }));
    const kapott = assignCar({ car: "Jeep", skin: "Kek" }, mindenJeep);
    check(
      "ha a kocsi minden festese foglalt, masik kocsi jon",
      kapott.car !== "Jeep",
      `mind a ${mindenJeep.length} Jeep-festes foglalt -> ${kapott.car}/${kapott.skin}`,
    );
  }

  // --- TELI szoba: mindenki mas ---
  //
  // Nem egyenkent nezzuk, hanem vegigjatsszuk a belepest: igy az is
  // kiderul, ha a kiosztas csak az elso par jatekosnal mukodik.
  {
    const kiosztott: CarLook[] = [];
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++) {
      // MINDENKI ugyanazt keri: ez a legrosszabb eset.
      kiosztott.push(
        assignCar({ car: DEFAULT_CAR, skin: DEFAULT_SKIN }, kiosztott),
      );
    }
    const kulcsok = new Set(kiosztott.map((k) => `${k.car}|${k.skin}`));
    check(
      "teli szobaban mindenki mas kinezetet kap",
      kulcsok.size === MAX_PLAYERS_PER_ROOM,
      kiosztott.map((k) => `${k.car}/${k.skin}`).join(", "),
    );
  }

  // --- A FEGYVER minden auto TETEJEN ul ---
  //
  // A torony helye korabban egyetlen, rogzitett szam volt. Negy
  // kulonbozo magassagu kocsinal ez lathato hiba: a rohamkocsi
  // tetejebe sullyedne, az izomauto folott a levegoben allna. Es nem
  // csak latvany -- a LOVES is innen indul (weaponPivot).
  {
    const bajos = CAR_MODELS.filter((m) => {
      const felY = CAR_GEOMETRY[m.id].halfExtents.y;
      const talp = weaponMountHeight(m.id);
      return talp > felY || talp < felY - 0.35;
    });
    check(
      "a fegyver talpa minden auto tetejen ul",
      bajos.length === 0,
      bajos.length === 0
        ? CAR_MODELS.map(
            (m) => `${m.id}: ${weaponMountHeight(m.id).toFixed(2)} m`,
          ).join(", ")
        : bajos.map((m) => m.id).join(", "),
    );
  }

  // --- A KAMERA minden auto MOGE fer ---
  //
  // A koveto kamera helye korabban egyetlen, rogzitett eltolas volt.
  // Egy magas rohamkocsinal ez azt jelentene, hogy a kamera a tetobe
  // er: a kocsi kitolti a kepernyot, es a jatekos nem latja, mi van
  // elotte.
  {
    const bajos: string[] = [];
    for (const m of CAR_MODELS) {
      const g = CAR_GEOMETRY[m.id].halfExtents;
      const arany = cameraScaleFor(m.id);
      const mogotte = CAMERA.offset.z * arany - g.z;
      const folotte = CAMERA.offset.y * arany - g.y;
      if (mogotte < 5 || folotte < 2) {
        bajos.push(
          `${m.id}: ${mogotte.toFixed(2)} m mogotte, ${folotte.toFixed(2)} m folotte`,
        );
      }
    }
    check(
      "a kamera minden auto mogott es folott elfer",
      bajos.length === 0,
      bajos.length === 0
        ? "legalabb 5 m a far mogott es 2 m a teto folott"
        : bajos.join("; "),
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
