# Felhasznált anyagok

## 3D modellek

### Fegyvertorony — `packages/client/public/models/turret.glb`

**„Science Fiction Machine Gun [The expanse]"** — készítette **Suryxin**

- Forrás: <https://sketchfab.com/3d-models/science-fiction-machine-gun-the-expanse-115af5f738ca47fda420b9019c200b3c>
- Licenc: [CC Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)

**Módosítva.** Az eredeti modell 18,1 MB és 247 828 háromszög volt; a
játékban használt változat:

- 14 000 háromszögre ritkítva (Blender, Decimate),
- az 58 különálló objektum egybevonva, majd kettévágva forgó talpra
  (`Turret_Base`) és bólintó fegyverre (`Turret_Gun`),
- a 17 textúra 1024×1024-ről 256×256-ra kicsinyítve, WEBP formátumban,
- 17,1 m-ről 2,2 m-re méretezve, és a játék előre-irányához forgatva.

Az eredmény 914 kB.

### Ágyú — `packages/client/public/models/flak.glb`

**„Flak 18-36 88mm Anti-Aircraft cannon"** — készítette **bear17**

- Forrás: <https://sketchfab.com/3d-models/flak-18-36-88mm-anti-aircraft-cannon-95b1335520714a78b83f67a1c04a75da>
- Licenc: [CC Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)

**Módosítva.** Az eredeti egy földre álló löveg, egyetlen 46 500
háromszögből álló objektumként; a játékban használt változat:

- a kereszt alakú lövegtalp levágva (az autó teteje veszi át a szerepét),
- kettévágva forgó talpra (`Turret_Base`) és bólintó ágyúra
  (`Turret_Gun`), a bólintási tengely a cső magasságában,
- 14 000 háromszögre ritkítva (Blender, Decimate),
- a textúrák 1024×1024-ről 256×256-ra kicsinyítve, WEBP formátumban,
- 3,45 m-ről 2,6 m-re méretezve, és a játék előre-irányához forgatva.

Az eredmény 1,36 MB.

### Járművek — `packages/client/public/models/autok.glb`

**„Low Poly Vehicle Mini Pack"** — készítette **Vladek**
(@vladek27). A sorozat három tagjából használunk járműveket:

- **Pack 2** (izomautó, szögletes terepjáró):
  <https://sketchfab.com/3d-models/low-poly-vehicle-mini-pack-2-36b9cd0d2e19467cbe76d0fbd4182e53>
- **Pack 5** (modern crossover):
  <https://sketchfab.com/3d-models/low-poly-vehicle-mini-pack-5-8deab9d97646487fbe6390012775a4ba>
- **Pack 4.1** (3-ajtós terepjáró, rendőr/mentő/szerviz festéssel):
  <https://sketchfab.com/3d-models/low-poly-vehicle-mini-pack-41-b49688ffec6943c7b77cafdb1286e079>

Licenc: **Free Standard** (Sketchfab Standard licenc,
<https://sketchfab.com/licenses>) — mindhárom modellnél ez szerepel.
Ez NEM Creative Commons, szemben a projekt többi modelljével.

**A feltüntetés itt is kötelező**, éppen a mi helyzetünkben: a licenc
3.2 pontja szerint ha a mű más licencelt anyagok szerzőit feltünteti,
akkor ezt is fel kell tüntetni — „in equal size and comparable
placement". Mivel a lobbyban a CC-BY anyagok szerzői ki vannak írva,
Vladek neve is ott van, ugyanúgy.

Amit a licenc tilt, és ránk vonatkozik: a modellt **önálló fájlként**
nem adhatjuk tovább (a játék részeként igen), és nem adhatjuk el vagy
licencelhetjük tovább. A játék eredeti mű, a modellek beépített
elemek — ez a licenc szerint rendben van.

**Módosítva.** A `tools/autok-export.py` állítja elő a játék
változatát (`npm run autok-export`), és mindent SZKRIPTBŐL, hogy egy
csomagfrissítés után újra lefuttatható legyen:

- a négy használt karosszéria kiválasztva, mindegyikhez a **saját négy
  kereke** — a csomagokban ezek részben egyetlen összevont hálóban
  vannak (a terepjáró négy kereke egy 43 000 háromszöges objektum),
  ezért laza részek szerint szét vannak szedve és a helyük szerint
  négy kerékké összevonva,
- ritkítva a webhez: karosszéria legfeljebb 8 000, kerék 1 200
  háromszög (az eredetiben egyetlen kerék 11 500 volt),
- egységes állásba forgatva (orr a `-Z` felé), vízszintesen középre,
  a **kerekek alja** a nulla szintre,
- a textúrák 4096×4096-ról 512×512-re, WEBP formátumban; a festések
  külön fájlokban (`models/skins/`), mert a geometria közös.

Az eredmény 3,1 MB + 0,8 MB festés (16 festés, négy karosszérián).

**A méretek nem kézzel vannak beírva:** a modellből származnak
(`packages/shared/src/carGeometry.ts`, generált fájl), és ebből épül az
ütköző test, a találati test, a kerekek helye és mérete is. Így amit a
játékos lát, és amivel a játék számol, ugyanaz.

### Ipari épületek — `packages/client/public/models/epuletek.glb`

**„Industrial Buildings Set - Low poly models"** — készítette
**Daniel Zhabotinsky** (@DanielZhabotinsky)

- Forrás: <https://sketchfab.com/3d-models/industrial-buildings-set-low-poly-models-e0b0d0342be24e6c923319991a2a4d3d>
- Licenc: [CC Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)

**Módosítva.** Az eredetiben 49 objektum van, de valójában 30 épület: a
falak, a homlokzat és a díszítmények külön objektumok ugyanahhoz az
épülethez (más anyagot használnak). A játékban használt változat:

- épületenként egybevonva, és mindegyik az **origóba állítva** — a
  talpa a nulla szinten, vízszintesen középre —, hogy a pályán elég
  legyen egy pozíció és egy elfordulás,
- a Sketchfab-hierarchia (`Sketchfab_model` burok) eldobva, a
  transzformációt megtartva: enélkül a belőle kiemelt épület eldőlne,
- csak a **ténylegesen felhasznált 17 épület** került be (20 367
  háromszög) — a többi textúrája is helyet foglalna a letöltésben,
- a textúrák 2048×2048-ról 512×512-re, WEBP formátumban.

Az eredmény 2,3 MB.

**A méretek nem kézzel vannak beírva:** a modell saját határoló
dobozából származnak (`packages/shared/src/arenaProps.ts`, generált
fájl), és az ütköző dobozok is ebből épülnek. Így amit a játékos lát,
és aminek nekimegy, ugyanaz.

## Hangok

A hangok a `packages/client/public/audio/` alatt vannak. Mind valódi
felvétel; a játékba készítésük (mono, csendvágás, újramintavételezés,
loop-varrat, szintezés) a `packages/client/scripts/prepare-audio.ts`
szkripttel megismételhető — az írja le egy helyen, melyik hang milyen
kezelést kap.

### Gépfegyver — `gepfegyver.wav`

**„Assault Rifle Loop"** — készítette **ryanconway**

- Forrás: <https://freesound.org/people/ryanconway/sounds/200277/>
- Licenc: [CC Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)

**Módosítva:** monóvá keverve, egyenáramú eltolás eltávolítva, rövid
be- és kiúsztatás (hogy a sorozat vége ne kattanjon), szintezve.

A felvétel SZÁNDÉKOSAN lapos burkolójú: egy folyamatos sorozatból
kivágott, ismételhető szelet. A játék pontosan így használja — a
gépfegyver 90 ms-onként tüzel, a minta 92 ms hosszú.

### A többi hang — CC0

Ezekhez **nem kötelező a feltüntetés** (Creative Commons Zero,
közkincs), de a rend kedvéért itt is szerepelnek:

| Fájl | Mi | Licenc |
| --- | --- | --- |
| `motor.wav` | motorhang (hurkolt, sebességgel hangolva) | CC0 |
| `agyu.wav` | ágyúlövés | CC0 |
| `robbanas.wav` | robbanás | CC0 |
| `tulmelegedes.wav` | fegyver-túlmelegedés — [„lavaburn" / memerunknown](https://freesound.org/people/memerunknown/sounds/670075/) | CC0 |

## Textúrák

### Talaj — `packages/client/public/textures/homok-*.webp`

**„Fine Sand Material"** — készítette **chrisg4919**

- Forrás: <https://sketchfab.com/3d-models/fine-sand-material-6e54464d405a4c1e8bdb0f81e8d74db2>
- Licenc: [CC Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)

**Módosítva.** Az eredeti egy anyagminta: három előnézeti gömb 261 ezer
háromszöggel és 4096×4096-os textúrákkal, 86 MB-ban. A geometriája a
játékban nem használható; csak a textúrák kellettek:

- alapszín 1024×1024-re kicsinyítve, WEBP formátumban (17 kB),
- a normálmap 512×512-re (26 kB) — jelenleg nincs használatban, mert
  autóból nézve a homok szemcséje nem látszik, viszont minden
  talaj-képponton egy plusz textúramintát jelentene,
- a talajon 8 méterenként ismétlődik, anizotrop szűréssel.

### Égbolt — `packages/client/public/textures/eg.webp`

**„Kloofendal 48d Partly Cloudy (Pure Sky)"** — Greg Zaal (eredeti) és
Jarod Guest (ég-változat), [Poly Haven](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky)

- Licenc: **CC0** (közkincs) — feltüntetés nem kötelező, de illik

**Módosítva.** A 4K-s HDR (EXR, 75 MB) tónus-leképezve WebP-be
(4096×2048, 278 kB), „Standard" nézet-transzformációval — a Filmic/AgX
kimosta volna az eget. A játékban két dolgot ad: hátteret, és a
`PMREMGenerator`-on át környezeti fényt (ettől lettek a fémes felületek
— a fegyvertorony, a Flak — életszerűek a korábbi lapos szürke helyett).

Az első próbálkozás egy gömb-modellbe csomagolt égbolt volt; azt
elvetettük, mert a **horizont-sávja üres** volt — épp az a rész, amit a
játékban látni lehet.
