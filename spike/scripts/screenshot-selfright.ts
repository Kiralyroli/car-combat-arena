import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

async function main(): Promise<void> {
  const outDir = resolve("out");
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
  await page.waitForSelector("#loading", { state: "detached", timeout: 15000 });
  await page.waitForTimeout(300);

  // Az autot fejre allitjuk (180 fok X korul), 3m magasan, majd hagyjuk esni.
  await page.evaluate(`
    (() => {
      const s = window.__spike;
      const chassis = s.backend.chassis;
      chassis.setTranslation({ x: 0, y: 3, z: 0 }, true);
      chassis.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true); // 180 fok X korul
      chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
      chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
    })()
  `);
  await page.waitForTimeout(50);
  await page.screenshot({ path: resolve(outDir, "selfright-1-flipped.png") });
  console.log("1. kep (fejen all) mentve");

  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(outDir, "selfright-2-mid.png") });
  console.log("2. kep (forgas kozben) mentve");

  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(outDir, "selfright-3-recovered.png") });
  console.log("3. kep (visszaallt) mentve");

  await browser.close();
}

main().catch((err: unknown) => {
  console.error("HIBA:", err);
  process.exit(1);
});
