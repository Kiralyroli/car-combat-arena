import { WsServer } from "./network/wsServer";
import { RoomManager } from "./rooms/roomManager";
import { GameLoop } from "./simulation/gameLoop";

const PORT = Number(process.env.PORT ?? 8080);

const rooms = new RoomManager();
const loop = new GameLoop(rooms);
const server = new WsServer(rooms, PORT);

loop.start();
console.log(`Car Combat Arena szerver fut: ws://localhost:${PORT}`);

function shutdown(): void {
  console.log("\nLeallitas...");
  loop.stop();
  server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
