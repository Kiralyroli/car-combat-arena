import { RapierBackend } from "./backends/rapier";
import { FIXED_DT, MAX_STEPS_PER_FRAME } from "./config";
import { initDebugPanel } from "./debugPanel";
import { hideLoading, Hud, showError } from "./hud";
import { Input } from "./input";
import { SceneView } from "./scene";
import {
  HEALTHY_WHEEL,
  NEUTRAL_INPUT as NEUTRAL_DRIVE,
  type VehicleBackend,
  type WheelDamage,
} from "./types";

const BROKEN_WHEEL: WheelDamage = {
  hp: 0,
  broken: true,
  gripMultiplier: 0,
};

async function main(): Promise<void> {
  const backend: VehicleBackend = new RapierBackend();
  await backend.init();

  const view = await SceneView.create();
  const input = new Input();
  const hud = new Hud(backend.name, backend.version);
  initDebugPanel();

  input.onAction((action) => {
    if (action === "reset") {
      backend.reset();
      for (let i = 0; i < 4; i++) {
        backend.setWheelDamage(i, { ...HEALTHY_WHEEL });
      }
      return;
    }
    if (action === "repairWheels") {
      for (let i = 0; i < 4; i++) {
        backend.setWheelDamage(i, { ...HEALTHY_WHEEL });
      }
      return;
    }
    const match = /^breakWheel(\d)$/.exec(action);
    if (match) {
      backend.setWheelDamage(Number(match[1]), { ...BROKEN_WHEEL });
    }
  });

  hideLoading();

  let last = performance.now();
  let accumulator = 0;
  let fps = 60;
  let frameCount = 0;

  // Elozo/jelenlegi fizikai allapot -- a renderelesi interpolaciohoz
  // kell (lasd scene.ts syncVehicle dokumentacioja).
  let prevChassis = backend.getChassis();
  let prevWheels = backend.getWheels();
  let currChassis = prevChassis;
  let currWheels = prevWheels;

  // Debug-hook: konzolbol es automatizalt ellenorzesbol is elerheto.
  (window as unknown as Record<string, unknown>).__spike = {
    backend,
    view,
    stats: () => ({
      frameCount,
      fps,
      telemetry: backend.getTelemetry(),
      chassis: backend.getChassis(),
      wheels: backend.getWheels(),
    }),
    /** Fizika leptetese renderelestol fuggetlenul (rejtett panelnel is). */
    tick: (steps: number, input: Partial<typeof NEUTRAL_DRIVE> = {}) => {
      for (let i = 0; i < steps; i++) {
        backend.step(FIXED_DT, { ...NEUTRAL_DRIVE, ...input });
      }
      return backend.getChassis();
    },
  };

  function frame(now: number): void {
    frameCount++;
    const frameDt = Math.min((now - last) / 1000, 0.25);
    last = now;
    fps = fps * 0.9 + (1 / Math.max(frameDt, 1e-4)) * 0.1;

    // Fix lepeskozu fizika, a rendereleskol fuggetlenul (projekt-terv 15.3).
    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      backend.step(FIXED_DT, input.read());
      accumulator -= FIXED_DT;
      steps++;
      // Az uj "jelenlegi" allapot elotti allapot lesz a kovetkezo
      // interpolacio kiindulopontja.
      prevChassis = currChassis;
      prevWheels = currWheels;
      currChassis = backend.getChassis();
      currWheels = backend.getWheels();
    }
    if (steps === MAX_STEPS_PER_FRAME) {
      // Ne halmozodjon fel a lemarada, kulonben spiralba megy.
      accumulator = 0;
    }

    // 0..1: hol tartunk idoben a ket legutobbi fizikai lepes kozott
    // (fuggetlenul attol, hogy futott-e lepes EBBEN a frame-ben --
    // a maradek accumulator ekkor is a "curr" utani eltelt idot jelenti).
    // Enelkul a renderelt kep csak 60 Hz-es "ugrasokban" frissulne,
    // ami a monitor frissitesi utemetol fuggoen akadozasnak latszik.
    const alpha = Math.min(accumulator / FIXED_DT, 1);

    const interpolatedChassis = view.syncVehicle(
      prevChassis,
      currChassis,
      prevWheels,
      currWheels,
      alpha,
    );
    view.updateCamera(interpolatedChassis);
    view.render();

    hud.update(backend.getTelemetry(), currWheels, fps);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main().catch((err: unknown) => {
  console.error(err);
  showError(`Hiba az inditaskor: ${err instanceof Error ? err.message : String(err)}`);
});
