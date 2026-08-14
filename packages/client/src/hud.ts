import type { Telemetry, WheelReadout } from "@cca/shared";

export class Hud {
  private el: HTMLElement;
  private lastRender = 0;
  private networkStatus = "csatlakozas...";
  private remoteCount = 0;

  constructor(private backendName: string, private backendVersion: string) {
    const el = document.getElementById("hud");
    if (!el) throw new Error("#hud nem talalhato");
    this.el = el;
    this.el.hidden = false;
    const help = document.getElementById("help");
    if (help) help.hidden = false;
  }

  /**
   * Halozati allapot kijelzese. Nem rajzol azonnal -- a kovetkezo
   * `update` hivasnal jelenik meg, hogy ne legyen ket kulon DOM-iras.
   */
  setNetworkStatus(status: string, remoteCount: number): void {
    this.networkStatus = status;
    this.remoteCount = remoteCount;
    // A kovetkezo update azonnal rajzoljon, ne varjon a 10 Hz-es utemre.
    this.lastRender = 0;
  }

  update(
    t: Telemetry,
    wheels: WheelReadout[],
    fps: number,
    pingMs: number | null,
  ): void {
    // 10 Hz eleg a HUD-nak, ne terhelje a fo ciklust.
    const now = performance.now();
    if (now - this.lastRender < 100) return;
    this.lastRender = now;

    // A ping es az fps szinezese: zold = jo, sarga = erezheto, piros =
    // zavaro. A hatarok arcade akciojatekhoz igazodnak -- 100 ms felett
    // a tobbi auto mozgasa mar lathatoan "kesik", 60 fps alatt pedig a
    // sajat vezetes kezd akadozni.
    const pingText = pingMs === null ? "--" : `${pingMs.toFixed(0)} ms`;
    const pingClass =
      pingMs === null ? "" : pingMs < 60 ? "good" : pingMs < 120 ? "warn" : "bad";
    const fpsClass = fps >= 55 ? "good" : fps >= 30 ? "warn" : "bad";

    const wheelHtml = wheels
      .map((w) => {
        const cls = w.damage.broken
          ? "broken"
          : w.damage.gripMultiplier < 0.99
            ? "hurt"
            : "ok";
        const air = w.inContact ? "" : " air";
        const grip = Math.round(w.damage.gripMultiplier * 100);
        return `<div class="wheel ${cls}${air}">${w.id} ${grip}%</div>`;
      })
      .join("");

    this.el.innerHTML = `
      <h2>${this.backendName}</h2>
      <div class="row"><span class="label">verzio</span><span class="val">${this.backendVersion}</span></div>
      <hr />
      <div class="row"><span class="label">sebesseg</span><span class="val">${t.speedKmh.toFixed(0)} km/h</span></div>
      <div class="row"><span class="label">kerek foldon</span><span class="val">${t.wheelsOnGround} / 4</span></div>
      <hr />
      <div class="row"><span class="label">fps</span><span class="val ${fpsClass}">${fps.toFixed(0)}</span></div>
      <div class="row"><span class="label">ping</span><span class="val ${pingClass}">${pingText}</span></div>
      <hr />
      <div class="row"><span class="label">fizika lepes</span><span class="val">${t.stepMs.toFixed(2)} ms</span></div>
      <div class="row"><span class="label">lepes / frame</span><span class="val">${t.stepsLastFrame}</span></div>
      <hr />
      <div class="row"><span class="label">halozat</span><span class="val">${this.networkStatus}</span></div>
      <div class="row"><span class="label">tobbi jatekos</span><span class="val">${this.remoteCount}</span></div>
      <hr />
      <div class="label">kerekek (tapadas)</div>
      <div class="wheel-grid">${wheelHtml}</div>
    `;
  }
}

export function hideLoading(): void {
  const el = document.getElementById("loading");
  if (el) el.remove();
}

export function showError(message: string): void {
  const el = document.getElementById("loading");
  if (el) {
    el.style.color = "#f85149";
    el.style.padding = "24px";
    el.style.textAlign = "center";
    el.textContent = message;
  }
}
