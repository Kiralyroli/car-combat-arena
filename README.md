# Car Combat Arena

3D-s, böngészőben futó multiplayer autós harci játék. 2--8 játékos
egy arénában, arcade vezetéssel, fizikai ütközésekkel, fegyverekkel
és sérülés-rendszerrel.

> Ne az nyerjen, aki a leggyorsabban körbemegy, hanem aki a legjobban
> használja az autóját, a fizikát, a fegyvereket és az arénát.

## Állapot

**Tervezési fázis.** Kód még nincs -- a következő lépés a 0. lépcső
technikai spike (lásd a tervben).

## Dokumentáció

-   [projekt-terv.md](projekt-terv.md) -- teljes projektterv: koncepció,
    játékmenet, autó- és damage-rendszer, arénák, asset stratégia,
    technológiai terv és a fejlesztési lépcsők sorrendje

## Tervezett technológia

| Terület | Választás |
|---|---|
| Renderelés | Three.js (WebGL), TypeScript, Vite |
| Fizika | Rapier vagy Jolt -- a 0. lépcső spike dönti el |
| Szerver | Node.js, authoritative game state |
| Hálózat | WebSocket cserélhető `Transport` interfész mögött |
| Modellek | GLB / GLTF, stylized low-poly |

## Következő lépés

**0. lépcső -- technikai spike:** doboz + 4 raycast kerék, két fizikai
motorral összehasonlítva, mielőtt bármilyen asset- vagy tartalom-döntés
születne. Részletek a [projekt-tervben](projekt-terv.md#0-lépcső--technikai-spike-24-nap-tartalom-nélkül).
