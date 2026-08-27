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
