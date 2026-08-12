import type { Telemetry, WheelReadout } from "./types";

export class Hud {
  private el: HTMLElement;
  private lastRender = 0;

  constructor(private backendName: string, private backendVersion: string) {
    const el = document.getElementById("hud");
    if (!el) throw new Error("#hud nem talalhato");
    this.el = el;
    this.el.hidden = false;
    const help = document.getElementById("help");
    if (help) help.hidden = false;
  }

  update(t: Telemetry, wheels: WheelReadout[], fps: number): void {
    // 10 Hz eleg a HUD-nak, ne terhelje a fo ciklust.
    const now = performance.now();
    if (now - this.lastRender < 100) return;
    this.lastRender = now;

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
      <div class="row"><span class="label">fizika lepes</span><span class="val">${t.stepMs.toFixed(2)} ms</span></div>
      <div class="row"><span class="label">lepes / frame</span><span class="val">${t.stepsLastFrame}</span></div>
      <div class="row"><span class="label">fps</span><span class="val">${fps.toFixed(0)}</span></div>
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
