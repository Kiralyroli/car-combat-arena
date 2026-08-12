/**
 * Szamszeruen ellenorzi, hogy a renderelt (interpolalt) pozicio
 * SIMAN valtozik-e frame-rol frame-re, nem "ugras-allas-ugras-allas"
 * mintazatban (ez volt az akadozas tunete interpolacio nelkul).
 *
 * Modszer: a __spike.view privat interpPos-at nem tudjuk kivulrol
 * olvasni, ezert a chassisMesh vilag-poziciojat mintavetelezzuk
 * kozvetlenul minden requestAnimationFrame hivasnal.
 */
import { chromium } from "playwright";

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl"],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
    await page.waitForSelector("#loading", { state: "detached", timeout: 15_000 });
    await page.waitForTimeout(300);

    // Gaz + kormany, hogy legyen folyamatos mozgas.
    await page.keyboard.down("KeyW");
    await page.keyboard.down("KeyD");
    await page.waitForTimeout(400);

    // FONTOS: string-kent adjuk at (nem JS fuggvenykent), mert a tsx/esbuild
    // altal injektalt "__name" segedfuggveny-hivasok a page.evaluate altal
    // szo szerint atkuldott fuggveny-forraskodban a bongeszo kontextusban
    // definialatlanok maradnanak.
    const samples = await page.evaluate<Array<{ t: number; x: number; z: number }>>(`
      new Promise((resolve) => {
        const s = window.__spike;
        const out = [];
        let count = 0;
        const tick = (t) => {
          const p = s.view.chassisMesh.position;
          out.push({ t, x: p.x, z: p.z });
          count++;
          if (count < 40) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      })
    `);

    await page.keyboard.up("KeyW");
    await page.keyboard.up("KeyD");

    // FONTOS: a nyers elmozdulas (delta) onmagaban felrevezeto, mert a
    // headless Chromium szoftveres (swiftshader) renderelese maga sem
    // egyenletes utemu (16.7 / 33.3 / 50 ms kozt valtakozik), es a kocsi
    // gyorsul is -- mindket tenyezo termeszetes szorast okoz a nyers
    // deltakban, FUGGETLENUL az interpolaciotol. A valodi kerdes: a
    // delta/dt (= impliakalt sebesseg) SIMAN valtozik-e -- ha az
    // interpolacio hianyzik, ez ugralna (0, 0, nagy ugras, 0, 0, ...),
    // fuggetlenul a frame-idozitestol.
    console.log("frame | dt(ms) | delta (m) | v=delta/dt (m/s)");
    let stalls = 0;
    const velocities: number[] = [];

    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      const dt = b.t - a.t;
      const delta = Math.hypot(b.x - a.x, b.z - a.z);
      const v = dt > 0 ? (delta / dt) * 1000 : 0;
      velocities.push(v);
      if (delta < 1e-5) stalls++;
      if (i <= 15) {
        console.log(
          `${String(i).padStart(5)} | ${dt.toFixed(1).padStart(6)} | ${delta.toFixed(4).padStart(9)} | ${v.toFixed(3).padStart(8)}`,
        );
      }
    }

    // A sebessegnek monoton nonie kellene (a kocsi egyenletesen gyorsul,
    // nincs kormanyzas ebben a tesztben -- csak W+D, de rovid ido alatt
    // domokans a hosszanti gyorsulas). Szamoljuk, hany esetben "ugrik
    // vissza" a sebesseg jelentosen (>25%-kal) az elozohoz kepest -- ez
    // jelezne akadozast, NEM a sima gyorsulast.
    let backJumps = 0;
    for (let i = 2; i < velocities.length; i++) {
      const prev = velocities[i - 1];
      const curr = velocities[i];
      if (prev > 0.3 && curr < prev * 0.75) backJumps++;
    }

    const mean = velocities.reduce((s, v) => s + v, 0) / velocities.length;
    const variance =
      velocities.reduce((s, v) => s + (v - mean) ** 2, 0) / velocities.length;
    const stddev = Math.sqrt(variance);

    console.log("\n--- Ertekeles ---");
    console.log(`Mintak szama:              ${samples.length}`);
    console.log(`Atlagos implikalt sebesseg: ${mean.toFixed(3)} m/s`);
    console.log(`Szoras:                     ${stddev.toFixed(3)} m/s`);
    console.log(`Allo frame-ek (0 mozgas):        ${stalls} / ${velocities.length}`);
    console.log(`Sebesseg-visszaesesek (akadozas jele): ${backJumps} / ${velocities.length - 1}`);

    // Interpolacio nelkul minden olyan frame-ben, ami KET fizikai lepes
    // koze esik, a pozicio nem valtozna (delta=0, tehat v=0) -- ez adna
    // "allo" frame-eket, majd a kovetkezo fizikai lepesnel egy nagy
    // visszaugro/elore-ugro erteket. Ha nincs allo frame ES nincs
    // visszaeses, a renderelt mozgas monoton, tehat sima.
    const smooth = stalls === 0 && backJumps === 0;
    console.log(`\n${smooth ? "OK -- a renderelt sebesseg monoton, nincs akadozasra utalo allo/visszaugro frame" : "FIGYELEM -- akadozasra utalo mintazat"}`);
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  console.error("HIBA:", err);
  process.exit(1);
});
