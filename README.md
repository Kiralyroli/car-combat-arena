# Car Combat Arena

3D-s, böngészőben futó multiplayer autós harci játék. 2--8 játékos
egy arénában, arcade vezetéssel, fizikai ütközésekkel, fegyverekkel
és sérülés-rendszerrel.

> Ne az nyerjen, aki a leggyorsabban körbemegy, hanem aki a legjobban
> használja az autóját, a fizikát, a fegyvereket és az arénát.

## Állapot

**3. lépcső -- hálózati alapok, folyamatban.**

-   **0. lépcső kész:** jármű-fizika (Rapier raycast kerekek),
    irányítás, önfelegyenesedés, per-kerék sérülés, élő hangoló panel
-   **1--2. lépcső kész:** Sedan modell, követő kamera, aréna
    rámpákkal, boost
-   **3. lépcső kész:** szerver, szobák, snapshot-szinkronizáció,
    interpoláció, autók közti ütközés, szerver-oldali
    plauzibilitás-ellenőrzés és késleltetéssel való tesztelés

## Játékmódok

A szobát nyitó játékos választja ki a módot; aki egy meglévő szobába
lép be, annak a szoba módja az érvényes (a lobby listájában ott áll,
melyik szoba melyik módban megy).

-   **Utolsó túlélő** -- 3 élet fejenként, aki elfogyasztja, kiesik. A
    meccs addig tart, amíg egy játékos marad talpon.
-   **Kilövés** -- 3 perc, korlátlan újraszületés. A legtöbb kilövéssel
    rendelkező játékos nyer; holtversenynél döntetlen.

Mindkét módban a jobb felső sarokban fut a **kilövés-lista**: ki, mivel,
kit lőtt ki.

## Autók

A négy karosszéria nem csak másképp néz ki, hanem **másképp is vezet**.
Az autó a *mozgást* és a *tartósságot* adja; a sebzést a fegyver, a
pillanatnyi túlélést a képesség -- így a három választás nem
versenyez egymással.

| Autó | Élet | Sebesség | Kanyar | Tömeg |
|---|---|---|---|---|
| Izomautó | 80 | +15% | ±0% | −5% |
| Crossover | 100 | ±0% | ±0% | ±0% |
| Terepjáró | 115 | −6% | −8% | +15% |
| Rohamkocsi | 130 | −14% | −15% | +30% |

A választóban **nem ezek a számok** állnak, hanem két csillagsor:
*sebesség* és *élet*. A skála a mezőnyhöz igazodik (a leggyorsabb autó
mindig öt csillag, a leglassabb egy), tehát a csillagok
összehasonlítást mondanak, nem abszolút mércét -- és új autó
felvételekor maguktól igazodnak. A tömeg és a kanyar a játékban
változatlanul számít, csak a kijelzőre nem kerül fel: ugyanazt a két
irányt erősítik, és öt csillagsor olvashatatlan lenne egy gombon.

A táblázat egy
helyen él (`packages/shared/src/carStats.ts`), és **szorzókat** ad a
közös, behangolt vezetés-modellre (`ARCADE`) -- nem autónkénti külön
paraméterkészletet. A Crossover mindenben pontosan 1,0, tehát a játék
eddigi vezetése változatlanul elérhető.

A tömeg két helyen hat: a fizikai lökésben (a nehéz autó lelöki a
könnyűt -- ezt a Rapier adja) és mérsékelten az ütközés
sebzés-elosztásában.

## Indítás

```bash
npm install
```

A játékhoz **két** szerver kell: a játékszerver (8080) és a kliens
(5173). Ha csak a második megy, a lap betölt, de a lobby nem talál
szervert; ha csak az első, nincs mit megnyitni. Egy paranccsal
mindkettő:

```bash
npm run dev:all
```

Windowson duplakattintásra is: **`inditas.cmd`** a projekt gyökerében.

Leállítás: `Ctrl+C`. Ha egy korábbi indítás bent ragadt (a Ctrl+C nem
mindig ér el a gyerekfolyamatokig), a következő `dev:all` **magától
eltakarítja** -- de csak a saját folyamatait; egy idegen programot a
8080-on nem áll le, hanem szól. Kézzel:

```bash
npm run dev:stop
```

A kettő külön is indítható (`npm run dev:server`, illetve `npm run dev`),
ha egyenként akarod nézni a kimenetüket.

A kliens ezután a <http://localhost:5173> címen érhető el. Az első lap
nyit egy szobát, és a szobakódot beírja az URL-be (`#ABCD`) -- ezt a
linket megosztva csatlakoznak a többiek ugyanabba a szobába.

## Struktúra

Monorepo, npm workspace-ekkel (részletek a tervben, 15.6):

| Csomag | Tartalom |
|---|---|
| `packages/shared` | fizika, típusok, konstansok, hálózati protokoll |
| `packages/client` | Three.js böngésző-kliens |
| `packages/server` | Node.js authoritative játékszerver |

A `shared` a kulcs: a fizikai konstansoknak egy helyen kell lenniük,
különben a kliens és a szerver eltérően számolna. Szándékosan
DOM- és Three.js-mentes, hogy Node alatt is futtatható legyen -- ezt a
`tsconfig.json` a `lib` beállításával ki is kényszeríti.

## Ellenőrzések

```bash
npm run typecheck
```

```bash
npm run check:all
```

Fizikai regressziós tesztek (gyorsulás, stabilitás, sérülés,
önfelegyenesedés, kanyarodás, tolatás), a spawn-pontok ellenőrzése és a
szerver-oldali plauzibilitás-ellenőrzés -- headless, Node alatt futnak.

```bash
npm run check:car-stats
```

Az autónkénti tulajdonságok (lásd fent) **végigvezetett** mérése:
csúcssebesség, 0--80 km/h, kanyarsugár autónként, plusz a tömeg hatása
az ütközés sebzés-elosztására. A mérés a vezetett eredményt nézi, nem a
táblázatot olvassa vissza -- és van benne egy balansz-őr is, ami elkapja,
ha egy autó minden tengelyen a legjobbá válna.

```bash
npm run check:net
```

Szerver füst-teszt: két kliens, szoba, snapshot-ráta, lecsatlakozás.
Futó szervert igényel.

```bash
npm run check:mp
```

Végponttól végpontig teszt két böngészővel. Futó szervert **és**
klienst igényel.

```bash
npm run check:collision
```

Két autó fizikai ütközése: valódi lökés, azonnal látható visszajelzés,
nincs átcsúszás.

```bash
npm run check:heal
```

Gyógyulás végponttól végpontig, két böngészővel: a pályán felvett élet
fokozatosan tölt vissza, és a másik játékos is látja rajta -- zöld
kereszt az autó fölött, a karosszéria zöldbe húz. Futó szervert **és**
klienst igényel.

```bash
npm run check:lag
```

Ugyanezek **200 ms mesterséges késleltetéssel**. A hálózati késleltetés
a `Transport` réteg mögé kerül, és a böngészőben is bekapcsolható:
`http://localhost:5173/?lag=200&jitter=40`.

Ez nem opcionális extra: az ütközés-előrejelzés időzítése a
késleltetéstől függ, és 0 ms-on hangolva élesben rossz lenne.

## Dokumentáció

-   [projekt-terv.md](projekt-terv.md) -- teljes projektterv: koncepció,
    játékmenet, autó- és damage-rendszer, arénák, asset stratégia,
    technológiai terv és a fejlesztési lépcsők sorrendje
-   [EREDMENYEK.md](EREDMENYEK.md) -- a fizikai hangolás mérési
    eredményei és a meghozott döntések indoklása

## Technológia

| Terület | Választás |
|---|---|
| Renderelés | Three.js (WebGL), TypeScript, Vite |
| Fizika | Rapier 0.20 (`DynamicRayCastVehicleController`) |
| Szerver | Node.js, authoritative game state, fix 60 Hz |
| Hálózat | WebSocket cserélhető `Transport` interfész mögött, 20 Hz snapshot |
| Modellek | GLB / GLTF |
