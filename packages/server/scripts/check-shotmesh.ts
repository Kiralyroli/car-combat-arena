/**
 * A loves a MODELL alakjaval szamol, nem dobozokkal.
 *
 * Ez a valtozas ket iranyba tud csendesen elromlani, es mindketto
 * rosszabb a mai allapotnal:
 *
 *  - ha a halo hianyzik vagy elcsuszik, az epuleteken AT LEHET LONI.
 *    Ekkor a fedezek megszunik fedezek lenni, es a jatekos nem erti,
 *    honnan kapja a talalatot.
 *  - ha a halo tul bőkezű, a nyilasokon megsem lehet atlonni -- vagyis
 *    az egesz valtozas ertelmet veszti.
 *
 * A merest a szerver sajat koddal vegzi (arenaBVH / autoBVH), tehat
 * pontosan azt merjuk, ami a jatekban dont.
 *
 * Futtatas: npm run check:shotmesh
 */
import {
  ARENA,
  ARENA_HALF,
  CHASSIS,
  LAYOUT,
  PROP_MERETEK,
  raycastBVH,
  segmentCarEntry,
  segmentCarEntryMesh,
} from "@cca/shared";
import {
  arenaBVH,
  arenaHaromszogek,
  autoBVH,
} from "../src/simulation/collisionMesh";

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK  " : "HIBA"} ${label} -- ${detail}`);
  if (!ok) failures++;
}

const ALL: [number, number, number] = [0, 0, 0];
const FORGATAS: [number, number, number, number] = [0, 0, 0, 1];

function main(): void {
  console.log("=== A loves utkozo geometriaja ===\n");

  const kezd = performance.now();
  const fa = arenaBVH();
  const epitesMs = performance.now() - kezd;

  // --- Felepult-e egyaltalan? ---
  //
  // Ha a generalt adat hianyzik, a fa ures lenne, es MINDEN loves
  // atmenne mindenen. Ez a legdragabb hiba, ezert all elol.
  {
    check(
      "a palya haromszog-haloja felepult",
      arenaHaromszogek() > 20000,
      `${arenaHaromszogek()} haromszog, ${epitesMs.toFixed(0)} ms alatt`,
    );
  }

  // --- A FAL fal marad ---
  //
  // A palya kozepebol a hataroló epuletek fele minden iranyban lonunk.
  // Egy loves sem juthat ki a palyarol -- kulonben a "fedezek" fogalma
  // szunne meg.
  {
    const HATOTAV = 200;
    let kijutott = 0;
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const t = raycastBVH(
        fa,
        [0, 1.5, 0],
        [Math.cos(a) * HATOTAV, 1.5, Math.sin(a) * HATOTAV],
      );
      // A palya hatara ARENA_HALF; ami ennel tovabb jut, az kiment.
      const tav = t === null ? HATOTAV : t * HATOTAV;
      if (tav > ARENA_HALF + 25) kijutott++;
    }
    check(
      "a palya kozepebol egy loves sem jut ki a palyarol",
      kijutott === 0,
      kijutott === 0
        ? "mind a 72 irany elakad a hataron belul"
        : `${kijutott} / 72 irany kijutott`,
    );
  }

  // --- A NYILAS: ezert keszult az egesz ---
  //
  // A nyitott rakodoszin: ket oszlopsor, kozotte szabad at. A DOBOZ
  // eddig is ket kulon doboz volt, tehat ez a resz mar mukodott -- de
  // most a valodi oszlopokkal, nem 1 m vastag dobozokkal.
  {
    const szin = LAYOUT.find((p) => p.prop === "Railroad_Loadbay_Shed_1");
    if (!szin) {
      check("van rakodoszin a palyan", false, "nincs");
    } else {
      const m = PROP_MERETEK.Railroad_Loadbay_Shed_1;
      // A szin 90 fokban all: a hossza X menten fut, az oszlopsorok
      // Z-ben allnak egymassal szemben.
      const felHossz = m.melyseg / 2;
      // VEGIG a szinen, a kozepvonalon: ennek szabadnak kell lennie.
      const t = raycastBVH(
        fa,
        [szin.x - felHossz - 5, 1.2, szin.z],
        [szin.x + felHossz + 5, 1.2, szin.z],
      );
      check(
        "a nyitott szin KOZEPEN athalad a loves",
        t === null,
        t === null
          ? `a (${szin.x}, ${szin.z}) kozepvonalan nincs akadaly`
          : "elakadt a szin belsejeben",
      );

      // KERESZTBEN a szinen: az oszlopok kozott AT lehet lonni, az
      // oszlopokon NEM. Eppen ez a kulonbseg a dobozokhoz kepest -- a
      // doboz-kozelites egy TOMOR, 1 m vastag oszlopSORT adott, holott a
      // modellen kulonallo oszlopok vannak, kozottuk resekkel.
      //
      // Nem egyetlen sugarat merunk, hanem vegigpasztazzuk a szin
      // hosszat: a helyes viselkedes az, hogy VAN is akadaly meg NEM is.
      let akadt = 0;
      let atment = 0;
      for (let d = -felHossz + 0.5; d <= felHossz - 0.5; d += 0.25) {
        const be = raycastBVH(
          fa,
          [szin.x + d, 1.2, szin.z - m.szelesseg],
          [szin.x + d, 1.2, szin.z + m.szelesseg],
        );
        if (be === null) atment++;
        else akadt++;
      }
      check(
        "a szin oszlopai megallitjak a lovest",
        akadt > 0,
        `${akadt} sugar akadt el az oszlopokon (${akadt + atment} probabol)`,
      );
      check(
        "az oszlopok KOZOTT viszont atmegy",
        atment > 0,
        atment > 0
          ? `${atment} sugar ment at a reseken -- dobozokkal mind a ${akadt + atment} elakadt volna`
          : "egy sugar sem talalt rest",
      );
    }
  }

  // --- A TOMOR epulet TOMOR marad ---
  //
  // A masik irany: egy zart raktar falan NEM szabad atlonni. Ha a halo
  // valamiert hianyos lenne, itt derulne ki.
  {
    const raktar = LAYOUT.find((p) => p.prop === "Warehouse_1");
    if (!raktar) {
      check("van raktar a palyan", false, "nincs");
    } else {
      const m = PROP_MERETEK.Warehouse_1;
      const forgatott = ((raktar.yaw ?? 0) % 180) !== 0;
      const felSz = (forgatott ? m.melyseg : m.szelesseg) / 2;
      const felMe = (forgatott ? m.szelesseg : m.melyseg) / 2;
      let atment = 0;
      let ossz = 0;
      for (let d = -felSz + 1; d <= felSz - 1; d += 0.5) {
        ossz++;
        const be = raycastBVH(
          fa,
          [raktar.x + d, 1.2, raktar.z - felMe - 5],
          [raktar.x + d, 1.2, raktar.z + felMe + 5],
        );
        if (be === null) atment++;
      }
      check(
        "a zart raktar falan nem lehet atlonni",
        atment === 0,
        atment === 0
          ? `${ossz} sugar, mind elakadt`
          : `${atment} / ${ossz} sugar atment a falon`,
      );
    }
  }

  // --- A TALAJ megallitja a lovest ---
  {
    const ground = ARENA.find((b) => b.name === "ground");
    const teteje = (ground?.position.y ?? 0) + (ground?.halfExtents.y ?? 0);
    const t = raycastBVH(fa, [0, 5, 0], [0, -5, 0]);
    const y = t === null ? null : 5 + t * -10;
    check(
      "a foldre celzott loves a talajon all meg",
      t !== null && Math.abs((y ?? 0) - teteje) < 0.01,
      t === null ? "atment a talajon" : `y = ${y?.toFixed(2)} (a talaj ${teteje})`,
    );
  }

  // --- Az AUTO halója ---
  {
    const halo = autoBVH();
    if (!halo) {
      check("az auto halója megvan", false, "hianyzik a generalt adat");
    } else {
      check(
        "az auto haromszog-haloja felepult",
        halo.mesh.indices.length / 3 > 1000,
        `${halo.mesh.indices.length / 3} haromszog`,
      );

      // A kozeppontra celozva minden iranybol talalnia kell.
      let hiba = 0;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const t = segmentCarEntryMesh(
          halo,
          [Math.cos(a) * 30, 0, Math.sin(a) * 30],
          [-Math.cos(a) * 30, 0, -Math.sin(a) * 30],
          ALL,
          FORGATAS,
          0,
        );
        if (t === null) hiba++;
      }
      check(
        "az autot minden iranybol el lehet talalni",
        hiba === 0,
        hiba === 0 ? "mind a 16 irany" : `${hiba} irany nem talal`,
      );

      // A MOTORHAZTETÖ FOLOTT nem szabad talalnia -- ez a nyereseg a
      // dobozokhoz kepest, es a dobozos valtozat is igy viselkedik mar.
      const H = CHASSIS.halfExtents;
      const magas = H.y - 0.1;
      const orrFolott = segmentCarEntryMesh(
        halo,
        [-20, magas, -H.z + 0.3],
        [20, magas, -H.z + 0.3],
        ALL,
        FORGATAS,
        0,
      );
      check(
        "az orr FOLOTT nem talal",
        orrFolott === null,
        `y = ${magas.toFixed(2)}, z = ${(-H.z + 0.3).toFixed(2)}`,
      );

      // A halo SZUKEBB a dobozoknal: ahol a doboz talalt, ott a halo
      // vagy talal, vagy nem -- de forditva nem lehet. Ez a
      // "senki nem lett eltalalhatobb" szabaly.
      let bovebb = 0;
      let ossz = 0;
      for (let i = 0; i < 2000; i++) {
        const a = (i / 2000) * Math.PI * 2 * 7;
        const y = -H.y + ((i * 0.017) % (H.y * 2));
        const z = -H.z + ((i * 0.031) % (H.z * 2));
        const from: [number, number, number] = [-20, y, z];
        const to: [number, number, number] = [20, y, z];
        void a;
        const dobozzal = segmentCarEntry(from, to, ALL, FORGATAS, 0);
        const halóval = segmentCarEntryMesh(halo, from, to, ALL, FORGATAS, 0);
        if (halóval !== null) ossz++;
        if (halóval !== null && dobozzal === null) bovebb++;
      }
      check(
        "a halo nem talal ott, ahol a doboz sem",
        bovebb === 0,
        bovebb === 0
          ? `2000 loves, ${ossz} talalat, egyik sem esik a dobozokon kivulre`
          : `${bovebb} loves talal a dobozokon KIVUL`,
      );
    }
  }

  // --- SEBESSEG ---
  //
  // Minden loves lekerdez, a lag-kompenzacios visszatekeressel egyutt
  // tobbszor is. Ha ez lassu, a szerver akad.
  {
    const sugarak: [number, number, number][][] = [];
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      sugarak.push([
        [Math.cos(a) * 30, 1.5, Math.sin(a) * 30],
        [Math.cos(a + 2) * 60, 1.5, Math.sin(a + 2) * 60],
      ]);
    }
    for (let i = 0; i < 2000; i++) raycastBVH(fa, sugarak[i % 200][0], sugarak[i % 200][1]);
    const N = 20000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) raycastBVH(fa, sugarak[i % 200][0], sugarak[i % 200][1]);
    const us = ((performance.now() - t0) / N) * 1000;
    check(
      "egy loves kiertekelese gyors",
      us < 50,
      `${us.toFixed(1)} us / loves (${arenaHaromszogek()} haromszog)`,
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
