/**
 * Valos (headless, de teljes WebGL-t tamogato) Chromiummal keszit
 * screenshotot a spike-rol. Ez oldja meg, hogy a vizualis
 * megjelenitest tenylegesen ellenorizni lehessen, ne csak a nyers
 * fizikai allapotot -- a Claude_Browser eszkoz pane-je ebben a
 * kornyezetben nem kompozital frame-eket, ezert screenshot sem
 * kesziithetu vele.
 *
 * Hasznalat:
 *   npx tsx scripts/screenshot.ts [kimeneti_fajl] [--drive=Wms] [--wait=Xms]
 *
 * Peldak:
 *   npx tsx scripts/screenshot.ts out/idle.png
 *   npx tsx scripts/screenshot.ts out/driving.png --drive=2000
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEV_SERVER_URL = "http://localhost:5173";

function parseArgs(): { out: string; driveMs: number; waitMs: number } {
  const args = process.argv.slice(2);
  const out = args.find((a) => !a.startsWith("--")) ?? "out/screenshot.png";
  const driveArg = args.find((a) => a.startsWith("--drive="));
  const waitArg = args.find((a) => a.startsWith("--wait="));
  return {
    out,
    driveMs: driveArg ? Number(driveArg.split("=")[1]) : 0,
    waitMs: waitArg ? Number(waitArg.split("=")[1]) : 800,
  };
}

async function main(): Promise<void> {
  const { out, driveMs, waitMs } = parseArgs();
  const outPath = resolve(out);
  mkdirSync(dirname(outPath), { recursive: true });

  console.log(`Chromium inditasa (headless)...`);
  const browser = await chromium.launch({
    headless: true,
    // SwiftShader szoftveres GL rendereles -- headless kornyezetben
    // altalaban nincs valodi GPU, enelkul a WebGL context null lenne.
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

    console.log(`Navigalas: ${DEV_SERVER_URL}`);
    await page.goto(DEV_SERVER_URL, { waitUntil: "networkidle", timeout: 30_000 });

    // Megvarjuk, hogy a fizikai motor betoltodjon (a #loading eltunik).
    await page.waitForSelector("#loading", { state: "detached", timeout: 15_000 });
    console.log("Fizika betoltve.");

    if (driveMs > 0) {
      console.log(`Vezetes szimulalasa ${driveMs} ms-ig (W + D lenyomva)...`);
      await page.keyboard.down("KeyW");
      await page.keyboard.down("KeyD");
      await page.waitForTimeout(driveMs);
      await page.keyboard.up("KeyW");
      await page.keyboard.up("KeyD");
    }

    if (process.argv.includes("--break-wheel")) {
      console.log("Hatso-bal kerek kilovese (2)...");
      await page.keyboard.press("Digit2");
      await page.waitForTimeout(300);
    }

    await page.waitForTimeout(waitMs);

    // WebGL ellenorzes -- ha a context nem jott letre, a canvas fekete lenne.
    const glCheck = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return { ok: false, reason: "nincs canvas" };
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!gl) return { ok: false, reason: "nincs webgl context" };
      return {
        ok: true,
        renderer: gl.getParameter(gl.RENDERER) as string,
        size: `${canvas.width}x${canvas.height}`,
      };
    });
    console.log("WebGL:", JSON.stringify(glCheck));

    await page.screenshot({ path: outPath });
    console.log(`Screenshot mentve: ${outPath}`);

    if (consoleErrors.length > 0) {
      console.log("\nKonzol hibak:");
      for (const e of consoleErrors) console.log("  " + e);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  console.error("HIBA:", err);
  process.exit(1);
});
