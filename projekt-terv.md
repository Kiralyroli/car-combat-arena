# Car Combat Arena -- Teljes projektterv

Ez a dokumentum az eredeti ötletdokumentum
(`D:\Letöltések\car-combat-arena-terv.md`) tartalmát egyesíti a
technikai architektúra tervvel és egy konkrét, sorrendbe rakott
fejlesztési ütemtervvel.

------------------------------------------------------------------------

# 1. Projektötlet

Egy 3D-s, böngészőben futó multiplayer autós harci játék, amelyben 2--8
játékos egy arénában játszik egymás ellen.

A játék központi elemei:

-   arcade autóvezetés
-   fizikai ütközések és kilökés
-   fegyverek és power-upok
-   különböző autótípusok
-   testreszabható autók
-   rövid, intenzív multiplayer meccsek
-   stylized low-poly / toon látvány

A fő koncepció:

> Ne az nyerjen, aki a leggyorsabban körbemegy, hanem aki a legjobban
> használja az autóját, a fizikát, a fegyvereket és az arénát.

------------------------------------------------------------------------

# 2. Vizuális irány

## Stylized Low-Poly / Toon

Nem fotorealisztikus grafikát használunk.

Cél:

-   karakteres, játékos megjelenés
-   jó teljesítmény böngészőben
-   kisebb modellek és textúrák
-   könnyebben készíthető új tartalom
-   egységes vizuális stílus

Vizuális kulcsszavak: stylized, low-poly, toon, arcade, demolition
derby, chunky proportions, exaggerated bumpers, oversized wheels.

------------------------------------------------------------------------

# 3. Alap játékmenet

## Játékosok

-   Minimum: 2, ideális: 4--8
-   Saját lobby / room code
-   Később matchmaking is lehetséges

## Alapmechanikák

Minden játékos vezet, gyorsít, fékez/tolat, kanyarodik, boostol,
fegyvert használ, power-upokat vesz fel, fizikailag ütközik más
autókkal.

A fizikai ütközés a játék egyik fő eleme: oldalról kilökni az
ellenfelet, nagy sebességgel nekimenni, falhoz szorítani, rámpáról az
ellenfélre ugrani, robbanásokkal meglökni az autókat.

------------------------------------------------------------------------

# 4. Kezdő játékmódok

-   **Last Car Standing** -- utolsó életben maradó játékos nyer (MVP mód)
-   **Deathmatch** -- kill alapú pontozás, időlimit vagy killszám
-   **Team Deathmatch** -- 2v2 / 3v3 / 4v4
-   **King of the Hill** -- zóna birtoklásáért jár pont
-   **Coin Rush** -- gyűjthető érmék, lökdösődés és lopás

------------------------------------------------------------------------

# 5. Autórendszer

> Base car + testreszabható alkatrészek.

-   **Racer** -- gyors, jó irányíthatóság, gyenge páncél
-   **Muscle / Rammer** -- nagy sebesség, erős frontális ütközés
-   **SUV** -- kiegyensúlyozott, jó páncél
-   **Buggy** -- gyors, jól ugrik, gyenge páncél
-   **Heavy / Tank** -- lassú, nagyon erős, nehéz meglökni

------------------------------------------------------------------------

# 6. Autó testreszabása

## Szín

Külön material a karosszérián: piros, kék, zöld, sárga, lila stb.
Később komplett skin rendszer.

## Alkatrészek

Front/rear bumper, spoiler, kerekek, páncéllemezek, kipufogó,
tetőelemek.

## Fegyverek (attachment pointok)

`WeaponPoint_Front`, `WeaponPoint_Roof`, `WeaponPoint_Left`,
`WeaponPoint_Right`, `WeaponPoint_Rear` -- dinamikusan csatlakoztatható
fegyverek: machine gun, rocket launcher, tesla cannon, mine launcher,
flamethrower, shield generator. Így nem kell minden fegyverhez külön
autómodell.

------------------------------------------------------------------------

# 7. Fegyverek és power-upok

**Fegyverek:** Rocket (lassú, robbanó), Machine Gun (gyors, gyenge),
Mine (hátradobott), Shockwave (közeli lökés), EMP (lassítás/zavarás).

**Power-upok:** boost, shield, repair, speed boost, weapon ammo,
invisibility/stealth, temporary armor.

## 7.1 Fegyver-sorrend hálózati megfontolásból

Az implementálás sorrendjét nem a fegyverek "egyszerűsége", hanem a
hálózati igényük határozza meg:

-   **Lövedék alapú fegyverek** (Rocket, Mine, Shockwave): a szerver
    elindítja, szimulálja és becsapódáskor kiértékeli. A lövedék
    látható repülés közben, a játékos elé céloz -- **nem igényel lag
    kompenzációt**.
-   **Hitscan fegyverek** (Machine Gun): a szervernek vissza kell
    tekernie az összes ellenfél pozícióját arra az időpontra, amit a
    lövő látott (*lag compensation*), különben nagy latency mellett
    lehetetlen eltalálni bárkit. Ez önálló, nem triviális rendszer.

**Következmény:** az első implementált fegyver a **Rocket** legyen, a
Machine Gun pedig csak később, a lag kompenzációs réteggel együtt.

------------------------------------------------------------------------

# 8. Damage rendszer

Első verzióban egyszerű HP rendszer (pl. 100 HP/autó, ütközés/fegyver/
robbanás sebez).

Később irányfüggő rendszer: front/rear/left/right damage, hatások:
engine damage (sebességcsökkenés), steering damage (rosszabb
irányíthatóság), weapon damage (gyengébb/kiütött fegyver), wheel
damage (csökkent mobilitás).

## 8.1 Per-kerék sérülés

Ha a jármű-fizika raycast-alapú felfüggesztést használ (4 külön
raycast, egy-egy minden keréknél), minden kerék eleve önálló, saját
állapottal rendelkező egység a szimulációban -- a sérülés-rendszer
ennek természetes kiterjesztése, nem külön alrendszer.

```ts
interface WheelState {
  hp: number;              // 0-100
  broken: boolean;         // true, ha teljesen kilőtték
  gripMultiplier: number;  // sérüléssel csökken (1.0 -> 0.0)
}

interface CarDamageState {
  bodyHp: number;
  wheels: {
    frontLeft: WheelState;
    frontRight: WheelState;
    rearLeft: WheelState;
    rearRight: WheelState;
  };
}
```

| Állapot | Hatás |
|---|---|
| Sérült kerék (pl. 50% HP) | csökkentett tapadás, enyhe húzás az adott irányba |
| Teljesen kilőtt kerék | nincs suspension force -> az autó abba az irányba lesüllyed, aszimmetrikus vezetés |
| Mindkét hátsó kerék kilőve | drasztikus sebességvesztés, csúszás |
| Első kerék(ek) kilőve | kormányzás nagyrészt elvész |

**Technikai előfeltétel (a 0. lépcsőben ellenőrizendő):** a választott
jármű-kontroller engedje **futásidőben, kerekenként külön** állítani a
tapadási és felfüggesztési paramétereket. Enélkül a rendszer csak saját
jármű-fizika írásával valósítható meg.

**Modell-oldali feltétel:** a kerekek már eleve külön objektumként
szerepelnek a Blender hierarchy-ban (`Wheel_FL/FR/RL/RR`), ez a
strukturális alap adott. Asset-választásnál ellenőrizendő: van-e
"csupasz tengely" mesh a kerék eltűnésére, illetve külön kezelhető-e
felni és gumi. Ha nincs "sérült" variáns, olcsó megoldás: szikra/füst
VFX + gumi mesh elrejtése, felni megtartásával.

Ez a rész **nem MVP-elem**, ajánlott helye a fejlesztési sorrendben a
Harc fázis vége (lásd 16. fejezet, 4. lépcső).

------------------------------------------------------------------------

# 9. Arénák

## Első pálya: Industrial Arena

Elemek: betonpadló, falak, acélkorlátok, konténerek, hordók,
gumihalmok, raklapok, ládák, csövek, daruk, rámpák.

Gameplay elemek: robbanó hordók, ugrató rámpák, mozgó akadályok,
olajfoltok, pickup spawn pontok, veszélyes zónák.

## Későbbi pályák

-   **Desert Arena** -- homok, sziklák, kanyonok, roncsok, rámpák
-   **City Arena** -- utcák, parkolóház, épületek, felborult járművek
-   **Junkyard** -- autóroncsok, daruk, fémhulladék, présgépek

------------------------------------------------------------------------

# 10. Asset stratégia

> Kész assetekből gyors prototípus, majd szükség esetén Blenderben
> módosítás.

Kiválasztási szempontok: stylized/low-poly stílus, egységes art
style, GLB/GLTF vagy FBX formátum, külön karosszéria material, külön
kerekek, alacsony polygon szám, könnyű Blender import, commercial use
licence, módosíthatóság, attachment pontok hozzáadhatósága.

**Kiegészítés a kerék-sérüléshez:** ellenőrizendő továbbá, hogy a
kerék eltávolítható-e vizuálisan a fizikai raycast pont módosítása
nélkül, van-e alatta tengely-mesh, és külön objektum-e a felni és a
gumi.

------------------------------------------------------------------------

# 11. Vizsgálandó asset források

1.  **Cars for Arcade Demolition Racing Games (Fab)** -- első számú
    jelölt: 10 stylized autó, arcade/demolition jelleg, GLTF/GLB export
2.  **Kenney -- Car Kit** -- ingyenes, CC0, prototípushoz kiváló
3.  **Kenney -- Toy Car Kit** -- játékosabb, toy-like irány esetén
4.  **Synty -- Simple Racer** -- prémium, egységes stílus, derby/
    monster truck/muscle/offroad jellegű modellek
5.  **Vehicles Pack / Vehicles Full Pack (Fab)** -- nagy tartalom,
    NPC/környezeti járművekhez is

------------------------------------------------------------------------

# 12. Környezeti asset stratégia

-   **Kenney City Kit -- Industrial** -- Industrial Arena fő jelöltje
-   **Kenney Factory Kit** -- gépek, csövek, gyárépületek, díszletek

Cél, hogy az aréna moduláris elemekből épüljön.

------------------------------------------------------------------------

# 13. Blender workflow

1.  Modell ellenőrzése
2.  Felesleges objektumok eltávolítása
3.  Polygon szám ellenőrzése
4.  Materialok rendezése
5.  Karosszéria külön materialjának előkészítése
6.  Kerekek pivotjainak ellenőrzése
7.  Scale alkalmazása
8.  Originok ellenőrzése
9.  WeaponPointok létrehozása
10. Collision mesh előkészítése
11. Game object hierarchy létrehozása
12. GLB export

```text
Car
├── Body
├── Wheel_FL
├── Wheel_FR
├── Wheel_RL
├── Wheel_RR
├── WeaponPoint_Front
├── WeaponPoint_Roof
├── BoostPoint
├── CameraTarget
└── Collision
```

------------------------------------------------------------------------

# 14. AI használata asseteknél

**Concept art:** új autó design, skin ötlet, fegyver design, aréna
koncepció.

**Image -> 3D:** concept art -> AI 3D generátor (Meshy, Tripo,
Rodin/Hyper3D) -> Blender cleanup -> optimalizálás -> GLB export.

**Blender AI segítség:** lépésről lépésre instrukciók, Python
scriptek, ismétlődő feladatok automatizálása, átnevezés, attachment
pontok, export workflow.

------------------------------------------------------------------------

# 15. Technológiai terv

## 15.1 Kliens

-   TypeScript, **Three.js**, GLTF/GLB modellek, WebGL alapú
    böngészős 3D renderelés
-   Build: Vite

## 15.2 Fizika

A jármű-fizika a projekt legkockázatosabb technikai eleme, mert a
vezetés érzése maga a játékélmény. Emiatt a motor kiválasztása **nem
előzetes döntés, hanem a 0. lépcső spike eredménye**.

Két jelölt:

-   **Rapier** (Rust -> WASM) -- jó JS dokumentáció, kisebb bundle,
    egyszerűbb integráció, van beépített raycast jármű-kontrollere
-   **Jolt** (C++ -> WASM) -- erősebb, kiforrottabb jármű-támogatás,
    cserébe nagyobb és nehezebben integrálható

Mindkettőnél kötelezően ellenőrizendő a spike során:

1.  jól érződik-e a vezetés arcade jelleggel
2.  futtatható-e Node.js alatt is (szerver-oldali szimulációhoz)
3.  állíthatók-e **futásidőben, kerekenként külön** a tapadási és
    felfüggesztési paraméterek (a per-kerék sérülés előfeltétele,
    lásd 8.1)

Kollíziós modell: nem sima box/capsule collider, hanem **raycast
alapú, per-kerék felfüggesztés** (4 raycast, egy-egy minden keréknél).
Ez adja a reális borulást és oldalirányú lökést.

## 15.3 Szimulációs ütemezés

Három, egymástól **független** ráta:

| Réteg | Ráta | Indoklás |
|---|---|---|
| Fizika (kliens és szerver) | **fix 60 Hz** | a raycast jármű nagyobb lépésköznél instabil: ugrál, átesik a talajon |
| Hálózati snapshot | **20--30 Hz** | ennyi elég, a kliens interpolál a snapshotok között |
| Renderelés | monitor szerint | a fizikától teljesen függetlenül |

Ezt az elválasztást az elejétől így kell megépíteni -- utólagos
bevezetése az egész szinkronizációs réteg újraírását jelentené.

## 15.4 Multiplayer -- hibrid authority modell

A teljes authoritative fizika (szerver számol mindent, a kliens
rewind/replay módszerrel korrigál) rigid body járműveknél azt
jelentené, hogy szerver-korrekciónál a kliensnek vissza kell tekernie
a **teljes fizikai világot** egy korábbi állapotra, és újra le kell
szimulálnia N tick-et. Ez a fizikai világ folyamatos
szerializálását/visszatöltését igényli -- hónapokban mérhető, nehezen
debugolható munka, és nem MVP-szintű feladat.

Helyette **hibrid modell**: a kliens birtokolja a saját autója
mozgását, a szerver birtokolja az összes következményt.

| Mit | Ki számolja |
|---|---|
| Saját autó mozgása | **Kliens** szimulálja lokálisan, teljes fizikával |
| Más autók mozgása | Kliens interpolál a szerver snapshotok között |
| Ütközés két autó közt | Kliens lokálisan (látvány), **szerver** dönt a sebzésről |
| Sebzés, HP, kill, pickup, kerék-sérülés, meccs állapot | **Kizárólag szerver** |
| Mozgás-csalás elleni védelem | Szerver plauzibilitás-ellenőrzés (max sebesség, pozíció-delta, pálya-határok) |

Előny: a vezetés **nulla input laggel** érződik.
Hátrány: elméletileg lehet speedhackelni. Mivel azonban a szerver
minden sebzést, találatot és pontot maga számol, a csalás legfeljebb
bosszantó, nem játékromboló -- casual arcade játéknál ez a helyes
kompromisszum. A szigorúbb modell később ráépíthető.

```text
Browser Clients (saját autó lokális fizika + más autók interpolációja)
       |
       v
Transport réteg (WebSocket, cserélhető)
       |
       v
Authoritative Game Server (Node.js, fix 60 Hz fizika)
       |
       +-- ütközés-kiértékelés és sebzés
       +-- fegyverek és lövedékek
       +-- damage (body + per-kerék)
       +-- pickupok
       +-- meccs-állapot, győztes
       +-- mozgás plauzibilitás-ellenőrzés
```

Snapshot formátum (tömör, nem a teljes fizikai állapot):

```ts
interface PlayerSnapshot {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number, number]; // quaternion
  velocity: [number, number, number];
  hp: number;
  wheels?: CarDamageState["wheels"];
  activeWeapon: WeaponType;
}
```

## 15.5 Hálózati transport

A WebSocket TCP felett fut, ami **head-of-line blocking**-ot jelent:
egy elveszett csomag megakasztja a mögötte érkezőket is. Akciójátéknál
ez rossz hálózaton érezhető akadozás.

Hosszú távon a helyes megoldás **WebRTC DataChannel** (unreliable,
unordered módban) vagy **WebTransport** -- mindkettő jelentős extra
komplexitással jár (signaling szerver, STUN/TURN, illetve korlátozottabb
böngésző-támogatás).

**Döntés:** induljunk WebSockettel, de a hálózati réteg egy
`Transport` interfész mögött legyen, hogy a szállítási réteg később
kicserélhető legyen a játéklogika érintése nélkül.

## 15.6 Projekt-struktúra (monorepo)

```text
car-combat-arena/
├── packages/
│   ├── shared/              # közös típusok + fizika-logika
│   │   ├── physics/         # jármű fizika, ütközés szabályok
│   │   ├── types/           # GameState, PlayerInput, WeaponType, stb.
│   │   └── constants/       # HP, sebességek, cooldownok
│   │
│   ├── client/               # Three.js frontend
│   │   ├── src/
│   │   │   ├── render/       # scene, camera, autó/aréna renderelés
│   │   │   ├── input/        # billentyűzet/gamepad kezelés
│   │   │   ├── network/      # Transport implementáció, interpoláció
│   │   │   ├── ui/           # HUD, lobby, scoreboard
│   │   │   └── assets/
│   │   └── public/models/    # GLB fájlok
│   │
│   └── server/                # Node.js authoritative szerver
│       ├── src/
│       │   ├── rooms/         # room/lobby kezelés
│       │   ├── simulation/    # fő game loop, fix 60 Hz
│       │   ├── weapons/
│       │   └── network/       # Transport szerver oldal, snapshot küldés
│
├── assets-raw/                # Blender források (git-lfs vagy repón kívül)
└── tools/                     # Blender export/scripting segédeszközök
```

A **shared** csomag a kulcs: a jármű-fizika paramétereinek
(gyorsulás, tapadás, tömeg) egy helyen kell léteznie, mert ha kliens
és szerver eltérő konstansokkal számol, a szerver plauzibilitás-
ellenőrzése hamis riasztásokat fog adni. A `shared` legyen
mellékhatás-mentes, hogy headless tesztelhető legyen.

## 15.7 Üzemeltetés

-   **Kliens:** statikus hosting (Cloudflare Pages, Netlify, Vercel)
-   **Szerver:** perzisztens kapcsolatot támogató host --
    Fly.io, Railway vagy VPS. **Serverless nem alkalmas**, mert a
    WebSocket kapcsolat és a folyamatos game loop hosszú életű
    processzt igényel.
-   MVP-ben egyetlen Node process elég, a szobák memóriában élnek,
    adatbázis nem szükséges.

------------------------------------------------------------------------

# 16. Fejlesztési lépcsők

A sorrend elve: **minden lépcső egy kockázatot zár le, a legdrágábban
javíthatót legelöl.** A 0. lépcső azt kérdezi, hogy *jó-e a vezetés*;
a 3. azt, hogy *működik-e hálózaton*; az 5. azt, hogy *szórakoztató-e
egyáltalán*. Ha bármelyikre nem a válasz, azt olcsóbb ott megtudni,
mint három hónapnyi tartalom legyártása után.

## 0. lépcső -- Technikai spike (~2--4 nap, tartalom nélkül)

Cél: kiderüljön, hogy a vezetés jól érződik-e, mielőtt bármi más
készül.

1.  Vite + TypeScript + Three.js váz, üres jelenet
2.  Fizikai motor betöltése, doboz leesik egy síkra (smoke test)
3.  **Doboz + 4 raycast kerék**, billentyűzetes vezetés: gyorsítás,
    fékezés, kanyarodás, ugratás
4.  Ugyanez a második motorral is (Rapier ↔ Jolt összehasonlítás)
5.  Ellenőrzés: futtatható-e a választott motor Node.js alatt is
6.  Ellenőrzés: állíthatók-e futásidőben, kerekenként külön a
    tapadás/felfüggesztés paraméterek (per-kerék sérülés előfeltétele)

**Kilépési feltétel:** egy doboz-autóval jó érzés körbevezetni. Ha
nem, azt itt kell megoldani -- nem assettel, nem grafikával.

## 1. lépcső -- Asset validáció (párhuzamosan futhat a 0-val)

2--3 autó asset letöltése és Blender vizsgálata: licenc, külön
kerekek, külön karosszéria material, polygon szám, hierarchia, GLB
export, WeaponPoint hozzáadhatóság, illetve hogy **eltűnik-e csúnyán a
kerék, ha kilövik** (van-e tengely alatta, külön-e a felni és a gumi).

**Kimenet:** egyetlen kiválasztott Base Car Asset.

## 2. lépcső -- Egyjátékos prototípus

1.  A validált autómodell ráültetése a spike fizikájára (a fizika nem
    változik, csak a látvány)
2.  Követő kamera
3.  Egyszerű, díszítetlen aréna: padló + falak + 1--2 rámpa
4.  Boost mechanika

**Kimenet:** egy játékos élvezetesen vezet egy zárt arénában.

## 3. lépcső -- Hálózati alapok

1.  Node.js szerver, `Transport` interfész mögött WebSocket
2.  Room code alapú csatlakozás, memóriában tárolt szobák
3.  Szerver game loop: fix 60 Hz fizika, 20--30 Hz snapshot
4.  Kliens: saját autó lokális szimuláció, más autók interpolációja
5.  Szerver-oldali plauzibilitás-ellenőrzés a pozíciókra
6.  **Tesztelés mesterséges késleltetéssel (150--200 ms)** -- enélkül
    a probléma csak élesben derülne ki
7.  Lecsatlakozás kezelése (a játékos kikerül a meccsből)

**Kimenet:** 2--4 játékos egy szobában, egymásnak tudnak ütközni,
200 ms latency mellett is sima a vezetés.

## 4. lépcső -- Harc

1.  Body HP (egyszerű, nem irányfüggő)
2.  Ütközési sebzés a relatív sebesség alapján -- **szerver dönti el**
3.  **Rocket** (szerver-szimulált lövedék) + robbanás sebzés és lökés
4.  Boost power-up pickup a pályán
5.  Halál / megsemmisülés kezelése, robbanás VFX
6.  **Per-kerék sérülés** (8.1) -- a body HP után, mert ez a meglévő
    sebzés-pipeline kiterjesztése:
    -   `WheelState { hp, broken, gripMultiplier }` szerver oldalon
    -   kilőtt kerék -> nincs felfüggesztési erő azon a ponton -> az
        autó ledől, aszimmetrikusan húz
    -   két hátsó kerék -> sebességvesztés; első kerék -> kormányzás
        elvesztése
    -   vizuálisan: gumi eltüntetése + szikra/füst VFX

## 5. lépcső -- MVP összeállítás

1.  Lobby UI: room code létrehozás / csatlakozás
2.  Last Car Standing játékmód-logika (életek, meccs vége, győztes)
3.  HUD: HP, kerekek állapota, fegyver, hátralévő játékosok
4.  Scoreboard, új meccs indítása
5.  Deploy (lásd 15.7)

**Kimenet:** első valóban játszható verzió.
**Itt kell külső tesztelőket bevonni**, mielőtt bármi tartalom
készülne.

## 6. lépcső -- Tartalom (csak a tesztvisszajelzések után)

-   Több autótípus: Racer -> Muscle -> SUV -> Buggy -> Heavy
-   Több fegyver: Mine -> Shockwave -> EMP -> Machine Gun
    (ez utóbbi a lag kompenzációs réteggel együtt, lásd 7.1)
-   Több játékmód: Deathmatch -> Team Deathmatch -> King of the Hill
    -> Coin Rush
-   Több pálya: Desert -> City -> Junkyard

## 7. lépcső -- Testreszabás

Szín (legegyszerűbb, külön material) -> kerekek és bumperek cseréje
-> fegyver attachment rendszer UI-ból -> irányfüggő sérülés-
vizualizáció.

## 8. lépcső -- Polish

VFX, hangok, zene, UI csiszolás, teljesítmény-optimalizálás
(instancing, object pooling a lövedékekhez, baked lighting),
statisztikák, leaderboard.

------------------------------------------------------------------------

# 17. MVP tartalom (összefoglalva)

-   **Autó:** 1 modell, színválasztás
-   **Játékosok:** 2--4
-   **Pálya:** 1 Industrial Arena
-   **Mechanikák:** vezetés, kamera, fizikai ütközés, HP, boost,
    1 fegyver (Rocket), 1 power-up (boost)
-   **Multiplayer:** room code, csatlakozás, hibrid authority modell
    (lokális saját autó + interpolált ellenfelek), meccs indítása,
    győztes meghatározása
-   **Játékmód:** Last Car Standing

```text
1 pálya + 1 autó + 2-4 játékos + vezetés + ütközés + boost + 1 fegyver
+ Last Car Standing
= Első játszható Car Combat Arena verzió
```
