import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticServer } from "./network/httpServer";
import { WsServer } from "./network/wsServer";
import { RoomManager } from "./rooms/roomManager";
import { GameLoop } from "./simulation/gameLoop";

const PORT = Number(process.env.PORT ?? 8080);

/**
 * A kliens buildjenek helye.
 *
 * Fejlesztes kozben nincs build (a Vite dev-szerver adja a klienst az
 * 5173-on) -- ilyenkor ez a konyvtar egyszeruen nem letezik, es a
 * szerver csak a WebSocketet szolgalja ki. Elesben a Docker-kep ide
 * masolja a `vite build` kimenetet.
 */
const CLIENT_DIR =
  process.env.CLIENT_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../client/dist");

const rooms = new RoomManager();
const loop = new GameLoop(rooms);

// EGY folyamat, EGY port: statikus fajlok + WebSocket ugyanott.
const http = createStaticServer(CLIENT_DIR);
const server = new WsServer(rooms, http);

// 0.0.0.0: kontenerben a localhost-ra kotott szerver kivulrol nem
// erheto el.
http.listen(PORT, "0.0.0.0", () => {
  loop.start();
  console.log(`Car Combat Arena szerver fut a ${PORT} porton`);
  console.log(`Kliens: ${CLIENT_DIR}`);
});

function shutdown(): void {
  console.log("\nLeallitas...");
  loop.stop();
  server.close();
  http.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
