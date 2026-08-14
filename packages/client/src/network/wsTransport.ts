import type { ClientMessage, ServerMessage, Transport } from "@cca/shared";

/**
 * WebSocket-alapu Transport implementacio (terv 15.5).
 *
 * A jatiklogika CSAK a Transport interfeszt ismeri, ezt az osztalyt
 * nem -- igy a szallitasi rteg kesobb WebRTC DataChannelre vagy
 * WebTransportra cserelheto anelkul, hogy a jatiklogikahoz hozza
 * kellene nyulni.
 */
export class WsTransport implements Transport {
  private socket: WebSocket;
  private messageHandler: ((message: ServerMessage) => void) | null = null;
  private closeHandler: (() => void) | null = null;

  private constructor(socket: WebSocket) {
    this.socket = socket;

    socket.addEventListener("message", (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        console.warn("Ertelmezhetetlen szerver-uzenet:", event.data);
        return;
      }
      this.messageHandler?.(message);
    });

    socket.addEventListener("close", () => this.closeHandler?.());
    socket.addEventListener("error", () => this.closeHandler?.());
  }

  /** Megnyit egy kapcsolatot, es csak a sikeres felepules utan ad vissza peldanyt. */
  static connect(url: string): Promise<WsTransport> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => resolve(new WsTransport(socket)), {
        once: true,
      });
      socket.addEventListener(
        "error",
        () => reject(new Error(`Nem sikerult csatlakozni: ${url}`)),
        { once: true },
      );
    });
  }

  get connected(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  send(message: ClientMessage): void {
    if (!this.connected) return;
    this.socket.send(JSON.stringify(message));
  }

  onMessage(handler: (message: ServerMessage) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  close(): void {
    this.socket.close();
  }
}
