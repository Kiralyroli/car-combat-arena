# Deploy

A kliens és a játékszerver **egyetlen Node folyamatban** fut: ugyanaz a
port szolgálja ki a statikus fájlokat és a WebSocketet (terv 15.7).

Miért így: külön hostolt kliensnél a szerver címét be kellene égetni a
buildbe (`VITE_SERVER_URL`), HTTPS-ről a `ws://` blokkolt (mixed
content), és két origin között CORS is kellene. Egy origin mellett
egyik sem létezik — a kliens a saját címéből származtatja a WebSocket
URL-t.

## Helyi próba (éles build)

```bash
npm run build --workspace @cca/client
npm run build --workspace @cca/server
npm run start --workspace @cca/server
```

Ezután a játék a <http://localhost:8080> címen fut. Ellenőrzés:

```bash
curl http://localhost:8080/health          # -> ok
CLIENT_URL=http://localhost:8080 npx tsx packages/client/scripts/check-lobby.ts
```

## Fly.io

```bash
fly launch --no-deploy      # a meglévő fly.toml-t használja
fly deploy
```

A `fly.toml` a lényeges beállításokat tartalmazza; a magyarázatuk ott,
kommentben van.

### Amire figyelni kell

- **Egy példány.** A szobák és a meccsek a szerver MEMÓRIÁJÁBAN élnek
  (terv 15.7: MVP-ben nincs adatbázis). Két példány között a szobák nem
  látszanának, és a lobby listája szakadozna.
- **Nem állhat le tétlenségkor** (`auto_stop_machines = false`). Egy
  leállás minden futó meccset megszakít.
- **Deploy = újraindítás.** Játékidőn kívül érdemes.
- **Régió.** A ping közvetlenül számít: az interpolációs puffer, az
  ütközés-jóslat és a becsapódás visszajelzése mind belőle számol.
  Budapestről Frankfurt (`fra`) ~20-30 ms.

## Környezeti változók

| változó | alapértelmezés | mire jó |
|---|---|---|
| `PORT` | `8080` | melyik porton figyeljen |
| `CLIENT_DIR` | `../../client/dist` a szerver kötegéhez képest | a kliens buildjének helye |
| `VITE_SERVER_URL` | nincs (a kliens a saját címéből származtatja) | csak akkor kell, ha a kliens és a szerver KÜLÖN hostra kerül |

## Ha később mégis szétválna

A kliens statikus hostingra (Cloudflare Pages, Netlify, Vercel), a
szerver marad Fly.io / Railway / VPS. Ekkor a kliens buildjéhez
`VITE_SERVER_URL=wss://<szerver-cim>` kell — a kód ezt már ma is
támogatja, más változtatás nem szükséges.
