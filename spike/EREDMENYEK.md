# 0. lépcső — technikai spike eredményei

Mérés dátuma: 2026-08-12
Környezet: Windows 11, Node v24.18.0, Chromium (Vite dev szerver)

A spike célja a [projekt-terv.md](../projekt-terv.md) 16. fejezetének
0. lépcsője: **kiderüljön, hogy a vezetés jól érződik-e, mielőtt bármi
más készül.**

------------------------------------------------------------------------

## Összefoglalás

| # | Kilépési feltétel | Állapot |
|---|---|---|
| 1 | Vite + TS + Three.js váz | ✅ |
| 2 | Fizikai motor betöltése, smoke test | ✅ |
| 3 | Doboz + 4 raycast kerék, vezetés | ✅ |
| 4 | Rapier ↔ Jolt összehasonlítás | ⬜ **nincs kész** (lásd lentebb) |
| 5 | Futtatható Node.js alatt is | ✅ |
| 6 | Futásidejű, kerekenkénti paraméterezés | ✅ |
| — | *Jól érződik-e a vezetés* | 🔶 **emberi megítélés kell** |

------------------------------------------------------------------------

## Mit építettünk

Egy Vite + TypeScript + Three.js alkalmazás, amelyben a fizikai motor
**cserélhető backend** mögött van ([src/types.ts](src/types.ts) →
`VehicleBackend`). Ugyanaz a jelenet, ugyanaz az input, ugyanazok a
konstansok ([src/config.ts](src/config.ts)) — így két motor
összehasonlítása azonos körülmények közt történhet, nem két külön
demóban.

```
src/
├── config.ts          # kozos konstansok (mindket backend ezt hasznalja)
├── types.ts           # VehicleBackend interfesz
├── math.ts            # three.js-mentes matek (Node-kompatibilitas miatt)
├── backends/rapier.ts # Rapier implementacio
├── scene.ts           # Three.js megjelenites
├── input.ts           # billentyuzet
├── hud.ts             # telemetria overlay
└── main.ts            # fix 60 Hz akkumulator + render ciklus
```

Vezérlés: `W/S` gáz-fék, `A/D` kormány, `Space` kézifék, `Shift` boost,
`R` reset, **`1 2 3 4` kerék kilövése**, `0` javítás.

------------------------------------------------------------------------

## Mérési eredmények

### Stabilitás nyugalomban
| Mérték | Érték |
|---|---|
| Karosszéria magasság | 0,77 m |
| Maradék sebesség | 0,15 km/h |
| Földet érő kerék | 4 / 4 |

Nem remeg, nem csúszik el, nem esik át a talajon.

### Gyorsulás (Node, a bal-jobb javítás után)
| Mérték | Érték |
|---|---|
| 0–50 km/h | **1,73 s** |
| Csúcssebesség | 86,4 km/h (a 38 m-es szabad szakasz korlátozza) |
| Oldalirányú elcsúszás 38 m-en | 0,00 m |

Az utolsó sor a lényeg: a jármű **egyenesen megy**, nincs
aszimmetria a felfüggesztésben vagy a hajtásban.

### Teljesítmény
| Környezet | Lépésidő | Realtime faktor |
|---|---|---|
| Node.js | 0,026 ms | 642× |
| Böngésző | ~0,05 ms | ~300--350× |

Ez bőven elég: egy 60 Hz-es szerver elméletileg több száz járművet
bír el egy szálon, tehát a szoba-alapú architektúra nem ütközik
CPU-korlátba.

### Per-kerék sérülés
A hátsó-bal kerék kilövése után, azonos gázzal:

| Mérték | Ép autó | Törött RL |
|---|---|---|
| Csúcssebesség | 86,4 km/h | 54,6 km/h |
| Oldalirányú elhúzás | 0,00 m | −37,5 m |

**−31,7 km/h sebességveszteség és drámai elhúzás.** A hatás inkább
túl erős, mint túl gyenge — ez tuning kérdése, nem architektúráé.
(A mérés kormányzás nélkül készült; a játékos ellenkormányzással
részben kompenzálhatna.)

------------------------------------------------------------------------

## Fontos technikai megállapítások

### 1. A Rapier jármű-kontroller alkalmas a per-kerék sérüléshez

Ez volt a legfontosabb nyitott kérdés. A `DynamicRayCastVehicleController`
**minden releváns paramétert futásidőben, kerekenként** enged állítani:

-   `setWheelFrictionSlip` — hosszanti tapadás
-   `setWheelSideFrictionStiffness` — oldalirányú tapadás
-   `setWheelSuspensionStiffness` / `setWheelMaxSuspensionForce` —
    a felfüggesztés kinullázható, ekkor az autó ledől arra a sarokra
-   `setWheelRadius` — defekt / letört gumi
-   `setWheelEngineForce` / `setWheelSteering` / `setWheelBrake`

**Következmény:** a projekt-terv 8.1 fejezete szerinti per-kerék
sérülés nem igényel saját jármű-fizika írását.

### 2. API-buktató: a forward tengely settere

A `rapier3d-compat` típusdefinícióban a forward tengely settere
`setIndexForwardAxis` **néven futó setter** (nem metódus), miközben a
getter `indexForwardAxis`. Az up tengelynél viszont mindkettő
`indexUpAxis`. Tehát:

```ts
controller.indexUpAxis = 1;            // getter/setter azonos nevu
controller.setIndexForwardAxis = 2;    // ertekadas egy "set" nevu setternek
```

**Az alapértelmezett forward tengely `0` (X).** Ha ezt elfelejtjük
beállítani, a hajtóerő oldalirányban hat, és az autó látszólag „nem
gyorsul" — miközben oldalra csúszik. Ez a hiba könnyen fél napot
elvisz, ezért került külön kommentbe a kódban.

### 3. Tanulság a mérésről

Az első mérés azt mutatta, hogy az autó „nem gyorsul" (5 s teljes gáz
után 0,24 km/h). Valójában 0-ról 84 km/h-ra gyorsult, majd
**nekiment az aréna falának**, és a teszt az ütközés utáni sebességet
mérte. A mérésnek a pálya geometriáját is figyelembe kell vennie —
ezt a `RUNWAY_START` / `RUNWAY_END_Z` konstansok kezelik.

------------------------------------------------------------------------

## Utólagos javítás: bal-jobb kormányzás felcserélve

A felhasználói teszt során kiderült, hogy a kormányzás fel volt
cserélve (`D`/jobbra gomb a képernyőn balra fordította az autót).

**Ok:** az autó orra `+Z` irányba nézett, a kamera pedig mögötte,
ugyanabba az irányba nézve követte. Egy jobbkezes, Y-fel
koordináta-rendszerben viszont **ha a kamera `+Z` felé néz, a
képernyő jobb oldala matematikailag a világ `-X` irányának felel
meg** -- ez pont ellentétes azzal, amit a `config.ts` eredeti
kommentje feltételezett ("X = jobb"). A three.js/gLTF-ökoszisztéma
ezért egyezményesen `-Z`-t használ "előre" iránynak; ettől a projekt
eredetileg eltért.

**Igazolás:** egy kamera-vetítéses teszt (`chassis.position.project(camera)`)
megmutatta, hogy `steer=+1` ("jobbra") hatására a világban `+X`
irányba mozduló autó a képernyőn **negatív NDC-x-nél**, azaz a bal
oldalon jelent meg -- ez a fizikai szimulációs tesztekben nem látszott,
mert azok nem vetítettek kamerán keresztül.

**Javítás** (három összefüggő változás, mert egyik önmagában nem elég):

1.  Az orr és a `WHEEL_LAYOUT` első/hátsó kerekei `-Z`-re kerültek
    (three.js/gLTF konvenció).
2.  A `CAMERA.offset.z` előjele megfordult (a kamerának a `+Z`
    oldalon kell lennie, hogy az új orr mögött maradjon).
3.  A `rapier.ts`-ben egy `FORWARD_SIGN = -1` konstans kompenzálja,
    hogy a Rapier `DynamicRayCastVehicleController`-je belsőleg
    továbbra is a chassis lokális `+Z` tengelyét tekinti "előre"-nek
    -- ez érinti a hajtóerő előjelét ÉS a kormányszög előjelét is
    (a kormányzott kerekek új, `-Z` oldali pozíciója megfordítja a
    forgatónyomaték karját, `r × F`).

Mindhárom változtatás után újra lefuttatott regressziós teszt
(`npm run check:node`) és egy célzott kamera-vetítéses teszt
igazolta, hogy `D` (jobbra) most a képernyő jobb oldalán, `A` (balra)
a bal oldalán jelenik meg, mind Node.js, mind böngésző környezetben.

**Tanulság:** a fizikai szimuláció önmagában helyesnek tűnhet
(egyenes gyorsulás, várt sebesség), miközben a *megjelenítés* mégis
hibás érzetet kelt -- ezt csak kamera-vetítésen át lehet ellenőrizni,
nem elég a nyers world-koordinátákat nézni.

## Utólagos javítás: akadozó mozgás és gyenge kanyarodás

**Akadozás oka:** ejtés-teszttel (4 m magasból) kimutatható volt, hogy
az autó földet érés után **visszapattant** (`velY` +3,2 m/s a
becsapódás után), és 3 másodperc alatt sem csillapodott le teljesen.
A hibás érték a `WHEEL.suspensionRelaxation: 1.2` volt -- **1,0 fölötti
relaxáció energiát ad hozzá** a felfüggesztés visszaengedésekor
ahelyett, hogy elnyelné, ami trambulin-szerű pattogást okoz minden
gyorsításnál, fékezésnél és egyenetlenségnél.

**Javítás:**
-   `suspensionStiffness`: 32 → 24
-   `suspensionCompression`: 0,85 → 0,82
-   `suspensionRelaxation`: **1,2 → 0,88** (a lényegi javítás)
-   `angularDamping` (karosszéria): 0,6 → 0,25 -- ez a magas érték a
    kanyarodást is fékezte, nem csak a pörgést

Gyorsítás közbeni földkontakt-váltások száma (150 lépéses teszt):
**sok, folyamatos oszcilláció → 2 váltás**, utána stabilan 4/4.

**Fordulékonyság javítása:**
-   `maxSteer`: 0,52 rad (~30°) → 0,66 rad (~38°)
-   `steerSpeed`: 3,2 → 3,6 rad/s
-   `sideFrictionStiffness`: 1,0 → 1,4 (feszesebb oldalirányú tapadás)

Mért fordulási sebesség (27 km/h-ról, teljes kormánnyal): ~1,0--1,5
rad/s (57--86°/s) 0,75 s alatt.

A teljes regressziós teszt (`npm run check:node`) a hangolás után is
hibamentesen fut, az egyenes gyorsulás és a per-kerék sérülés
viselkedése változatlanul helyes.

## Utólagos javítás: grafikai akadozás + vizuális tesztelés megoldva

**Probléma:** a felhasználó szerint az autó grafikailag akadozott,
"mintha laggolna" -- ez a fizikai hangolástól függetlenül jelentkezett.

**Ok:** a `main.ts` render-ciklusa a fizikát fix 60 Hz-en léptette, de a
renderelést mindig a *legutóbb kiszámolt fizikai állapotból* rajzolta
ki, interpoláció nélkül. Mivel a képernyő frissítési üteme (pl. 144 Hz)
ritkán esik egybe a fizika 60 Hz-es lépéseivel, sok renderelt képkocka
*ugyanazt* az állapotot mutatta (a jármű "megállt" a képen), majd a
következő fizikai lépésnél egyszerre nagyot ugrott -- ez a klasszikus
"akadozás" jelenség fix időlépéses fizikánál, interpoláció nélkül.

**Javítás** (Glenn Fiedler "Fix Your Timestep" mintája):
-   a `main.ts` mostantól minden fizikai lépés előtt elmenti az előző
    állapotot (`prevChassis`/`prevWheels`), és a lépés után az újat
    (`currChassis`/`currWheels`)
-   minden RENDERELT képkockánál kiszámol egy `alpha` (0..1) törtet,
    ami azt fejezi ki, hol tartunk időben a két legutóbbi fizikai
    állapot között (`accumulator / FIXED_DT`), **függetlenül attól,
    hogy futott-e fizikai lépés EBBEN a képkockában**
-   a `scene.ts` `syncVehicle` metódusa a karosszéria és minden kerék
    pozícióját lerp-eli, forgását slerp-eli e két állapot között
-   a kamera is az interpolált (nem a nyers) karosszéria-pozíciót
    követi, hogy ne "csússzon el" a modelltől

**Számszerű igazolás:** mivel a headless Chromium szoftveres
renderelése maga sem egyenletes ütemű, a nyers pozíció-delta önmagában
félrevezető metrika (a keret-idő ingadozása és a gyorsuló jármű is
szórást okoz, az interpolációtól függetlenül). A helyes mérőszám az
implikált sebesség (`delta / dt`), ami kiszűri a frame-idő hatását:

```
40 mintavett képkocka, gyorsítás közben:
  keret-ido szoras:        16.5 -- 66.8 ms (eros ingadozas)
  allo kepkockak (v=0):    0 / 39
  sebesseg-visszaesesek:   0 / 38
  implikalt sebesseg:      monoton no, 0.68 -> 3.83 m/s
```

Egyetlen álló vagy visszaugró képkocka sem fordult elő annak
ellenére, hogy a frame-idő közel négyszeresen ingadozott -- ez pont
azt igazolja, amit az interpolációnak biztosítania kell.

## Vizuális tesztelés megoldva: valódi (headless) Chromium screenshotok

A `Claude_Browser` eszköz pane-je ebben a környezetben nem
kompozitál frame-eket (`screenshot` időtúllépéssel elszáll), ezért
eddig a vizuális megjelenítést nem lehetett ellenőrizni, csak a nyers
fizikai állapotot. Ezt a `playwright` csomaggal oldottuk meg: egy
**valódi, teljes WebGL-t támogató Chromium binárist** telepítettünk
(`npx playwright install chromium`), amit egy Node.js szkript
headless módban indít, navigál a dev szerverre, szimulál
billentyű-inputot, és PNG screenshotot ment.

```bash
npm run screenshot -- out/idle.png
npm run screenshot -- out/driving.png --drive=2000
npm run screenshot -- out/broken-wheel.png --drive=800 --break-wheel
```

Ez ténylegesen igazolta:
-   a WebGL context létrejön, valódi renderelt kép készül (nem
    fekete/üres canvas)
-   a kamera-irány javítás után a `D` (jobbra) valóban jobbra
    fordítja a kocsit a képen
-   a kerék-sérülés vizuálisan is működik: a törött kerék pirosan,
    áthúzva jelenik meg a HUD-on, **és a karosszéria látványosan
    megdől** afelé, mert a felfüggesztési erő megszűnt azon a ponton
-   nincs konzol-hiba renderelés közben

A `scripts/verify-smoothness.ts` hasonlóan valódi böngészőben méri a
renderelt mozgás simaságát (lásd fent).

## Utólagos javítás: gyengébb kanyarodás, főleg gázadás közben

**Ok:** mértük, hogy azonos kormányszög és tapadás mellett a
kanyarsugár a sebességgel nő -- ez fizikailag helyes, de mivel gázadás
gyorsan növeli a sebességet, a kocsi kanyarban "nem akar fordulni"
érzetet keltett. Mért kanyarsugár (27 km/h-ról indulva, teljes
kormánnyal, 1,5 s alatt):

| | Sugár (javítás előtt) |
|---|---|
| Gázzal (gyorsulva) | ~9,5 m |
| Gáz nélkül (gördülve) | ~2,7 m |

**Javítás 1 -- puhább kormányszög-lecsengés sebességgel:**
`steerFalloffSpeed` 28→45 m/s, `steerFalloffMin` 0,35→0,55 (kevesebb
kormányszög-csökkenés nagy sebességnél).

**Javítás 2 -- arcade kanyarodás-segítő nyomaték:** minden fizikai
lépésben egy kis, a kormányzás irányába ható, sebességgel arányosan
erősödő forgatónyomatékot adunk a karosszériához (`rapier.ts`
`step()`, `DRIVE.steerAssistTorque`/`steerAssistSpeedRef`). Ez direkt
ellensúlyozza, hogy a valós tapadási modellben a sugár nő a
sebességgel.

**Közben talált és javított hiba:** a Rapier `addTorque()` metódusa
**kumulatívan összegződik** minden hívásnál, amíg nincs
`resetTorques()`-szal nullázva. Mivel minden fizikai lépésben
hívtuk, a nyomaték lépésről lépésre halmozódott, és pillanatok
alatt **385 rad/s-os kontrollálhatatlan pörgésbe** vitte az autót.
Megoldás: `applyTorqueImpulse()`-ra váltottunk (`nyomaték * dt`),
ami egyszeri, önmagát nem halmozó hatás -- pontosan azt adja át egy
lépésben, amit egy állandó nyomaték `dt` idő alatt adna, de nem
gyűlik a következő lépésekre.

**Közben talált és javított második hiba -- borulás:** a puhább
kormányszög-lecsengés + a szorosabb kanyarsugár miatt egy hosszan
tartott, teljes kormányos kanyar ~50+ km/h-nál **felborította** az
autót (kb. `3G` oldalirányú gyorsulás egy keskeny nyomtávú dobozon --
`v²/r` ekkora sugárnál és sebességnél irreálisan magas). Megoldás:
a karosszéria **pitch (bukdácsolás) és roll (borulás) tengelye
zárolva** (`RigidBodyDesc.enabledRotations(false, true, false)`),
csak a kanyarodáshoz szükséges yaw (függőleges) tengely forog
szabadon. Ez a legtöbb arcade jármű-alapú játékban (nem csak
versenyszimulációkban) szándékosan így van megoldva -- a borulás itt
nem kívánt mechanika.

**Mellékhatás, tudatos döntés:** a rotáció-zárolás miatt a korábban
látványos "karosszéria-dőlés" törött keréknél **megszűnt** -- a
karosszéria szinten marad. A sérülés hatása számszerűen továbbra is
erős (lásd lent), csak a vizuális megjelenés visszafogottabb.
Szükség esetén később pótolható tisztán kozmetikai (nem fizikai)
dőléssel, ami a kerék `damage` állapotából számolt, a mesh-re
alkalmazott extra forgatás lenne -- ez nem befolyásolná a stabilitást.

**Eredmény gázadás közbeni kanyarban (1,5 s, 27 km/h-ról):**

| | Sugár (javítás előtt) | Sugár (javítás után) |
|---|---|---|
| Gázzal (gyorsulva) | ~9,5 m | **~7,2 m** |
| Gáz nélkül (gördülve) | ~2,7 m | ~2,8 m |

A teljes regressziós teszt (`npm run check:node`) és egy 4 másodperces
folyamatos, teljes kormányos + gázos kanyar-stabilitási teszt is
hibamentes: a magasság mindvégig stabil `0,75 m`, a kerekek mindvégig
`4/4` a földön -- nincs borulás.

## Utólagos frissítés: Rapier 0.14 → 0.20.0

A telepített `@dimforge/rapier3d-compat@0.14.0` 2024 júliusi kiadás
volt (két évnél régebbi), miközben az aktuális stabil `0.20.0`
2026-08-08-án jelent meg. Frissítettünk.

**Kompatibilitás:** teljes -- a `tsc --noEmit` hibátlanul lefordul, a
teljes regressziós teszt (`npm run check:node`) azonos eredményeket ad
(0-50 km/h ugyanaz az 1,73 s, egyenes futásnál 0,00 m elcsúszás,
per-kerék sérülés ugyanúgy működik). Az API-hívásaink (
`DynamicRayCastVehicleController`, `enabledRotations`,
`applyTorqueImpulse` stb.) mind változatlanul működnek.

**Váratlan bónusz -- jelentős teljesítményjavulás:**

| | Rapier 0.14 | Rapier 0.20.0 |
|---|---|---|
| Lépésidő | 0,025 ms | **0,017 ms** |
| Realtime faktor | 661× | **985×** |

Ez ~49%-os gyorsulás azonos hardveren, minden kódmódosítás nélkül --
tisztán a WASM build optimalizációinak köszönhető.

## Utólagos javítás: a kerekek hátrafelé forogtak

A felhasználó észrevette, hogy a kerekek vizuálisan hátrafelé
pörögnek, miközben az autó előrehalad.

**Ok:** ugyanaz a `FORWARD_SIGN` probléma, mint a hajtóerőnél és a
kormányzásnál (lásd fentebb), csak egy újabb helyen. A Rapier a
`wheelRotation()` (a kerék tényleges elfordulási szöge) értékét is a
chassis nyers, belső `+Z` "előre" tengelyéhez képest könyveli el --
ezt a vizuális kirajzolásnál (`getWheels()` a `rapier.ts`-ben)
elfelejtettük korrigálni, holott a hajtóerőnél és a kormányzásnál már
megtettük.

**Javítás:** `roll = FORWARD_SIGN * wheelRotation(i)`.

**Igazolás:** mivel a helyes irány itt nem magától értetődő (a
"kanyarodás bal-jobb" hibánál használt kamera-vetítéses módszer itt
nem alkalmazható közvetlenül), egy fizikai pontot követtünk a kerék
tetején: forgás közben ennek a pontnak -Z (előre) irányba kell
elindulnia, ha az autó ténylegesen előre halad. A mérés ezt igazolta
-- a pont Z-koordinátája 0-ról indulva azonnal negatív irányba mozdult,
ahogy az autó -Z felé gyorsult.

## Utólagos finomítás: gáz és gáz nélküli kanyarsugár közelítése

**Panasz:** a gázas és a gáz nélküli kanyarsugár nagyon eltért (a
mérésünkkel: 11,1 m vs 4,8 m, ~2,3×), ezért ha vezetés közben elvette
a játékos a gázt, az autó hirtelen sokkal élesebben fordult be --
zavaró, kiszámíthatatlan érzés.

**Megoldás -- "friction circle" (tapadási kör):** valódi gumiabroncsnak
véges a tapadási "költségvetése" -- minél többet használ belőle
oldalirányú (kanyar-) erőnek, annál kevesebb marad hosszanti
(gyorsítási) erőnek. Ezt eddig nem modelleztük: a hajtóerő kanyarban
is 100%-on maradt, ezért tudott a sebesség (és ezzel a kanyarsugár)
elszabadulni gázzal.

Új szabály (`rapier.ts` `step()`): a hajtóerő a kormányzás mértékével
arányosan csökken, teljes kormánynál `DRIVE.corneringPowerMin`
(0,4 = 40%) szorzóra esik vissza. Egyenes vezetésnél (`steer = 0`)
nincs hatása -- ezt a regressziós teszt is igazolja (0-50 km/h
változatlanul 1,73 s).

**Eredmény** (2 s, 27 km/h-ról, teljes kormánnyal):

| | Gázzal | Gáz nélkül | Arány |
|---|---|---|---|
| Javítás előtt | 11,1 m | 4,8 m | 2,3× |
| Javítás után | **5,6 m** | 5,0 m | **1,11×** |

Bónuszként a gázas kanyar önmagában is jóval szorosabb lett, mert a
sebesség nem szalad el annyira kanyar közben (34 km/h a korábbi
62 km/h helyett).

**Stabilitás:** egy 5 másodperces, folyamatos teljes kormányos + gázos
kanyarban a magasság `0,71--0,78 m` között maradt, nincs borulásra
utaló jel (max. `46 km/h` a kanyarban, ami jóval biztonságosabb
oldalirányú G-erőt jelent, mint a korábbi, elszabadt sebességű esetben).

## Új funkció: önfelegyenesedés (nem tud tartósan felborulva maradni)

**Igény:** ha az autó a tetejére vagy az oldalára borul, mindig
tudjon tovább fordulni/visszadőlni, amíg vissza nem áll a kerekeire
-- ne tudjon stabilan megragadni fejjel lefelé vagy oldalt fekve.

### A végleges megoldás

`rapier.ts` `applySelfRighting()`, minden fizikai lépésben:

1.  Kiszámoljuk a karosszéria "fel" irányának eltérését a világ
    "fel" irányától (`tiltAngle`, fokban).
2.  **60° alatt semmi nem történik** -- ez fedezi a normál
    kanyar-dőlést (mérve: max. 3,1°) és a kerék-sérülés dőlését
    (mérve: 4,4°), hogy azok szabadon, korrekció nélkül jelenjenek meg.
3.  60° fölött egy, a dőlés mértékével arányosan erősödő
    forgatónyomatékot (`applyTorqueImpulse`) adunk a helyes tengely
    körül (`cross(fel_irány, világ_fel)`), 115°-nál éri el a
    maximumot.
4.  **Időbeli eszkaláció:** ha a dőlés X másodpercnél tovább a
    küszöb fölött marad (pl. az autó egy nagy, stabil lapján
    pihen, ahol az ütközés-szolver ellenáll a gyenge korrekciónak),
    a nyomaték fokozatosan, legfeljebb háromszorosára nő -- ez
    garantálja, hogy **mindig** legyen elég erő a kitöréshez,
    bármilyen stabil pihenő helyzetből.
5.  Mértékletes extra szögsebesség-csillapítás felegyenesedés közben,
    hogy a könnyű esetek (pl. sík talajról fejre állítva) ne
    lendüljenek túl a célon.
6.  A pontosan 180°-os (fejtetőn álló) eset instabil egyensúly, ahol
    a természetes korrekciós irány majdnem nulla hosszúságú --
    ilyenkor egy rögzített tartalék-tengely ad kezdő lökést.

### Két zsákutca útközben (tanulságos)

-   **Túl gyenge, csak arányos nyomaték:** a `90°`-os (oldalára
    dőlt, legszélesebb lapján pihenő) eset nem állt vissza --
    ilyenkor a kocsi legalább annyira stabil, mint fejtetőn állva, a
    kisebb tehetetlenségi nyomaték miatt a korrekciós tengely körül.
-   **Túl erős nyomaték, csillapítás nélkül:** a `180°`-os esetek
    visszafordultak, de **túllendültek** a felálló helyzeten, és a
    másik oldalra dőltek át -- klasszikus szabályozástechnikai hiba
    (tiszta arányos vezérlés, deriváló/csillapító tag nélkül).
-   **Közvetlen szögsebesség-célzás** (nem impulzus, hanem
    `setAngvel` a cél felé simítva): elméletileg tiszta megoldás,
    de a gyakorlatban "elnyelte" az ütközés-szolver, amikor a kocsi
    már egy nagy, stabil lapon nyugodott -- a kényszeresen beállított
    sebességet a kontaktus-feloldás azonnal visszafogta.

A végleges kombináció (impulzus + mértékletes csillapítás + időbeli
eszkaláció) mind a 6 tesztelt szélsőséges orientációból (fejtetőn
mindkét vízszintes tengely körül, oldalra dőlve mindkét tengely
körül, és két vegyes, nem tengely-igazított dőlés) sikeresen
visszaállítja az autót, 0,5--2,5 másodperc alatt.

### Ellenőrzés

```bash
npm --prefix spike run check:selfright
```

Numerikus regresszió (6 szélsőséges orientáció + 2 normál vezetési
forgatókönyv) és vizuális screenshot-sorozat (`scripts/screenshot-
selfright.ts`) is igazolta -- lásd a mellékelt képeket: fejtetőre
állítva → forgás közben → ~1,5 s alatt magától visszaállva.

## Utólagos hangolás: fürgébb, kevésbé "tank-szerű" érzet

**Panasz:** az autó nehéznek, "tankosnak" érződött vezetés közben --
lassú válaszidő gyorsításnál, fékezésnél és kormányzásnál.

Mivel a tömeghez (`CHASSIS.mass`) sok más, korábban gondosan hangolt
rendszer kötődik (felfüggesztés pattogás-mentessége, önfelegyenesedés
nyomatéka), azt szándékosan nem érintettük -- helyette a válaszidőt
és az erőket emeltük:

| Paraméter | Előtte | Utána |
|---|---|---|
| `engineForce` | 4200 N | **5200 N** |
| `reverseFactor` | 0,45 | **0,55** |
| `brakeForce` | 55 | **78** |
| `steerSpeed` | 3,6 rad/s | **5,0 rad/s** |
| `steerReturnSpeed` | 5,0 rad/s | **6,5 rad/s** |
| `angularDamping` (karosszéria) | 0,25 | **0,16** |

**Eredmény:** 0-50 km/h `1,73 s → 1,38 s` (~20%-kal gyorsabb).
Kanyarban a dőlés `3,1° → 16°`-ra nőtt (élénkebb, dinamikusabb
érzet), de messze a `60°`-os önfelegyenesedési küszöb alatt marad.

**Regresszió:** a teljes `check:node` és `check:selfright` teszt is
hibamentes marad. A felfüggesztés viselkedése (`WHEEL` paraméterek)
nem változott -- egy 4 méteres ejtés-teszt ugyanazt a korábban már
elfogadott, szélsőséges-eset maradék visszapattanást mutatja
(`velY ~2,7 m/s` landolás után), mint a felfüggesztés-javítás után
korábban, nem új regresszió.

## Ami nincs kész

### Jolt összehasonlítás (4. kilépési feltétel)

A `VehicleBackend` interfész és a közös konfiguráció készen áll rá —
egy `backends/jolt.ts` beilleszthető anélkül, hogy a jelenethez, az
inputhoz vagy a HUD-hoz hozzá kellene nyúlni.

Nem készült el, mert a Rapier **minden mérhető feltételt teljesített**,
és a döntő kérdés (jól érződik-e a vezetés) emberi megítélést igényel.
Ha a Rapier vezetése jónak bizonyul, a Jolt-implementáció megspórolható;
ha nem, akkor van értelme befektetni.

### A vezetés érzésének megítélése

Ez a 0. lépcső tényleges kilépési feltétele, és nem automatizálható.

```bash
npm --prefix spike run dev
```

Ellenőrizendő: kanyarodás nagy sebességnél, borulás-hajlam, ugratás a
rámpán, ütközés a ládákkal, illetve az `1`–`4` billentyűkkel kilőtt
kerék hatása.

------------------------------------------------------------------------

## Hasznos parancsok

```bash
npm --prefix spike run dev
```

```bash
npm --prefix spike run check:node
```

```bash
npm --prefix spike run screenshot -- out/idle.png
npm --prefix spike run screenshot -- out/driving.png --drive=2000
npm --prefix spike run screenshot -- out/broken-wheel.png --drive=800 --break-wheel
```

```bash
npx tsx spike/scripts/verify-smoothness.ts
```
