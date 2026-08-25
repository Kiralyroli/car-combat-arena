import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

/**
 * A kliens statikus fajljainak kiszolgalasa -- UGYANAZON a porton, mint
 * a WebSocket (terv 15.7).
 *
 * MIERT egy folyamat: a kliens kulon hostingja eseten a szerver cimet
 * BE KELLENE EGETNI a buildbe (VITE_SERVER_URL), HTTPS-rol a `ws://`
 * blokkolt (mixed content), es ket origin kozott CORS is kellene. Egy
 * origin mellett egyik sem letezik: a kliens a sajat cimebol szarmaztatja
 * a WebSocket URL-t.
 *
 * SZANDEKOSAN nincs hozza uj fuggoseg (express, sirv): a feladat egy
 * konyvtar kiszolgalasa, az alabbi ~60 sor. Egy jatekszervernel minden
 * extra fuggoseg tovabbi karbantartas es tamadasi felulet.
 */

/** Kiterjesztes -> MIME tipus. Ami nincs benne, azt binarisnak vesszuk. */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".glb": "model/gltf-binary",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon",
};

/**
 * Gyorsitotar-fejlec egy kiszolgalt fajlhoz.
 *
 * KET, ELLENTETES igenyt kell kiszolgalni:
 *
 *  - Az /assets/ alatti fajlok neveben TARTALOM-HASH van (a Vite igy
 *    epiti: index-U6xQ5-n7.js). Uj tartalom = UJ NEV, tehat a regit
 *    OROKRE el lehet tenni. E nelkul a 3.4 MB-os csomag MINDEN
 *    betolteskor ujra letoltodik -- lassu indulas, felesleges forgalom.
 *
 *  - Az index.html neve viszont allando, es EZ hivatkozik a hasitott
 *    nevekre. Ha a bongeszo eltenne, egy deploy utan a REGI oldalt
 *    tartana meg, ami a REGI csomagra mutat -- a jatekos pedig
 *    protokoll-eltereskent talalkozna vele. Ezert mindig ellenorizni
 *    kell.
 *
 * A no-cache NEM azt jelenti, hogy ne tarold: azt, hogy hasznalat
 * elott kerdezz ra. Valtozatlan fajlnal igy is 304 johet, tehat nem
 * dragabb -- csak nem lehet elavult.
 */
function cacheControlFor(requested: string): string {
  return requested.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}
/**
 * HTTP-szerver, ami a `rootDir` tartalmat adja ki.
 *
 * A WebSocket ugyanerre a szerverre csatlakozik (lasd WsServer), tehat
 * az `upgrade` keresekhez itt nem kell nyulni.
 */
export function createStaticServer(rootDir: string): Server {
  const root = resolve(rootDir);

  return createServer((req, res) => {
    // Egeszseg-ellenorzes: a hosting (Fly.io) HTTP-n nezi, el-e a
    // folyamat. A WebSocket-szerver egy sima GET-re nem valaszolna.
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }

    serveFile(root, req, res).catch(() => {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("hiba");
    });
  });
}

async function serveFile(
  root: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const requested = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");

  // KITORES-VEDELEM: a feloldott utvonalnak a gyokeren BELUL kell
  // maradnia. E nelkul egy `../../etc/passwd` alaku keres kiolvashatna
  // a fajlrendszer barmely reszet. A `normalize` maga nem eleg -- azt
  // is ellenorizni kell, hogy az eredmeny a gyokerbol indul.
  const target = resolve(root, normalize(relative));
  if (target !== root && !target.startsWith(root + sep)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("tiltott utvonal");
    return;
  }

  let file = target;
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, "index.html");
  } catch {
    // Nincs ilyen fajl: az index.html-t adjuk vissza. A kliens egyetlen
    // oldal, es a szobakod a hash-ben van (#ABCD) -- azt a bongeszo el
    // sem kuldi --, de egy elgepelt utvonal igy sem ad 404-et a
    // jatekosnak.
    file = join(root, "index.html");
  }

  try {
    await stat(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("nincs ilyen fajl");
    return;
  }

  res.writeHead(200, {
    "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
    "cache-control": cacheControlFor(requested),
  });
  createReadStream(file).pipe(res);
}
