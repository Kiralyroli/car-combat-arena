import { CHASSIS, DRIVE, RECOVERY, STABILIZATION, WHEEL } from "@cca/shared";

/**
 * Elo, csuszkas debug-panel a fizikai parameterek probalgatasahoz.
 *
 * FONTOS: a csuszkak KOZVETLENUL mutaljak a config.ts export const
 * objektumait (pl. `DRIVE.engineForce = ertek`). Ez azert mukodik
 * valtoztatas nelkul a tobbi kodon, mert a `const` csak az objektum-
 * referenciat zarolja, a tulajdonsagait nem -- es a fizika (rapier.ts)
 * minden lepesben frissen olvassa ki ezeket az ertekeket, nem
 * gyorsitotarazza oket. A kerek- es karosszeria-parameterek is
 * minden lepesben ujra alkalmazodnak (lasd rapier.ts step()), hogy a
 * csuszka-valtoztatas azonnal ervenyesuljon, ne csak a kovetkezo
 * serules-esemenynel.
 *
 * Amit NEM lehet igy elo csuszkaval allitani: a karosszeria merete
 * (CHASSIS.halfExtents) es a kerek fizikai sugara a jarmu-letrehozaskor
 * rogzul (addWheel), ezeket csak ujrainditassal (oldal frissitese)
 * lehetne valtoztatni -- ezert nincsenek a listaban.
 */

interface SliderDef {
  label: string;
  /** A config.ts-beli elerese utveonal (pl. "DRIVE.engineForce"), export/dokumentacio celjara. */
  path: string;
  /** Rovid, kozerthető magyarazat, hogy mit csinal ez a parameter. */
  hint: string;
  get: () => number;
  set: (v: number) => void;
  min: number;
  max: number;
  step: number;
  /** Megjelenitett mertekegyseg/formazas (pl. fokra valtas radianbol). */
  format?: (v: number) => string;
}

interface Section {
  title: string;
  sliders: SliderDef[];
}

const deg = (rad: number) => (rad * 180) / Math.PI;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

const SECTIONS: Section[] = [
  {
    title: "Gyorsulás / fékezés",
    sliders: [
      { label: "Hajtóerő", path: "DRIVE.engineForce", hint: "Mekkora erővel gyorsul a hajtott kerekeken. Magasabb = gyorsabb felpörgés.", get: () => DRIVE.engineForce, set: (v) => (DRIVE.engineForce = v), min: 1000, max: 15000, step: 100 },
      { label: "Tolatás erő-arány", path: "DRIVE.reverseFactor", hint: "A tolatás ereje a hajtóerőhöz képest. 1,0 = ugyanolyan erős tolatás, mint előre.", get: () => DRIVE.reverseFactor, set: (v) => (DRIVE.reverseFactor = v), min: 0.2, max: 1.5, step: 0.05 },
      { label: "Boost szorzó", path: "DRIVE.boostMultiplier", hint: "Shift lenyomásakor ennyiszeresére nő a hajtóerő.", get: () => DRIVE.boostMultiplier, set: (v) => (DRIVE.boostMultiplier = v), min: 1, max: 3, step: 0.1 },
      { label: "Fékerő", path: "DRIVE.brakeForce", hint: "Milyen erősen fékez az S, ha nem gázolsz épp az ellenkező irányba. Magasabb = rövidebb féktáv.", get: () => DRIVE.brakeForce, set: (v) => (DRIVE.brakeForce = v), min: 20, max: 250, step: 5 },
      { label: "Kézifék erő", path: "DRIVE.handbrakeForce", hint: "A Space (kézifék) ereje a hátsó kerekeken -- csúszáshoz/driftheléshez való.", get: () => DRIVE.handbrakeForce, set: (v) => (DRIVE.handbrakeForce = v), min: 20, max: 300, step: 5 },
    ],
  },
  {
    title: "Kormányzás",
    sliders: [
      { label: "Max kormányszög", path: "DRIVE.maxSteer (rad)", hint: "A kerekek legnagyobb elfordulási szöge teljes kormánynál.", get: () => deg(DRIVE.maxSteer), set: (v) => (DRIVE.maxSteer = rad(v)), min: 20, max: 70, step: 1, format: (v) => `${v.toFixed(0)}°` },
      { label: "Kormány fordulási seb.", path: "DRIVE.steerSpeed", hint: "Milyen gyorsan éri el a kormány a célszöget, amikor lenyomod az A/D-t.", get: () => DRIVE.steerSpeed, set: (v) => (DRIVE.steerSpeed = v), min: 2, max: 20, step: 0.5 },
      { label: "Kormány visszaállás", path: "DRIVE.steerReturnSpeed", hint: "Milyen gyorsan áll vissza egyenesbe a kormány, ha elengeded az A/D-t.", get: () => DRIVE.steerReturnSpeed, set: (v) => (DRIVE.steerReturnSpeed = v), min: 2, max: 20, step: 0.5 },
      { label: "Célzott kanyarsugár", path: "DRIVE.targetTurnRadius", hint: "Ekkora sugarú ívben fordul a kocsi, FÜGGETLENÜL a sebességtől -- ez adja a 'mennyire éles a kanyar' érzetet. Kisebb = élesebb kanyar.", get: () => DRIVE.targetTurnRadius, set: (v) => (DRIVE.targetTurnRadius = v), min: 2, max: 30, step: 0.5, format: (v) => `${v.toFixed(1)} m` },
      { label: "Célsugár-simítás", path: "DRIVE.turnRadiusBlendRate", hint: "Milyen gyorsan áll be a tényleges fordulás a célzott sugárhoz. Magasabb = azonnalibb, de rángósabb.", get: () => DRIVE.turnRadiusBlendRate, set: (v) => (DRIVE.turnRadiusBlendRate = v), min: 1, max: 20, step: 0.5 },
      { label: "Célsugár-asszisztens min. seb.", path: "DRIVE.turnRadiusMinSpeed", hint: "Ez alatt a sebesség alatt az asszisztens teljesen kikapcsol -- indításkor, álló helyzetben kormányozva a természetes fordulás érvényesül, nincs mesterséges lefékezés.", get: () => DRIVE.turnRadiusMinSpeed, set: (v) => (DRIVE.turnRadiusMinSpeed = v), min: 0, max: 10, step: 0.5, format: (v) => `${v.toFixed(1)} m/s` },
      { label: "Haladási irány igazítása", path: "DRIVE.velocityAlignRate", hint: "Milyen gyorsan igazodik a kocsi tényleges haladási iránya az orr irányához kanyarban. Alacsonyabb = inkább keresztbe csúszik éles kanyarban nagy sebességnél, magasabb = inkább folytonosan kanyarodik csúszás nélkül.", get: () => DRIVE.velocityAlignRate, set: (v) => (DRIVE.velocityAlignRate = v), min: 0, max: 15, step: 0.5 },
      { label: "Kanyar-erőkorlát (min)", path: "DRIVE.corneringPowerMin", hint: "Kanyarban a hajtóerő ennyiszeresére csökken teljes kormánynál. Ez fékezi, hogy gázzal ne szaladjon el a sebesség kanyarban.", get: () => DRIVE.corneringPowerMin, set: (v) => (DRIVE.corneringPowerMin = v), min: 0.1, max: 1, step: 0.05 },
      { label: "Kanyar-erőkorlát felfutása", path: "DRIVE.corneringPowerRampSpeed", hint: "Ez alatt a sebesség alatt a fenti korlát még nem (vagy csak részben) hat -- indításkor, alacsony sebességnél kormányozva is teljes hajtóerő jár.", get: () => DRIVE.corneringPowerRampSpeed, set: (v) => (DRIVE.corneringPowerRampSpeed = v), min: 0, max: 20, step: 0.5, format: (v) => `${v.toFixed(1)} m/s` },
      { label: "Sebességi visszavágás kezdete", path: "DRIVE.steerFalloffSpeed", hint: "Ennél a sebességnél éri el a kormányszög-csökkenés a minimumát -- nagy sebességnél nehezebb éles kanyart venni, ha ez alacsony.", get: () => DRIVE.steerFalloffSpeed, set: (v) => (DRIVE.steerFalloffSpeed = v), min: 10, max: 100, step: 5, format: (v) => `${v.toFixed(0)} m/s` },
      { label: "Sebességi visszavágás (min)", path: "DRIVE.steerFalloffMin", hint: "Nagy sebességnél a maximális kormányszögnek ennyi hányada marad meg (borulás elleni védelem).", get: () => DRIVE.steerFalloffMin, set: (v) => (DRIVE.steerFalloffMin = v), min: 0.2, max: 1, step: 0.05 },
    ],
  },
  {
    title: "Tapadás (kerekek)",
    sliders: [
      { label: "Hosszanti tapadás", path: "WHEEL.frictionSlip", hint: "A kerekek tapadása gyorsításkor/fékezéskor. Alacsony = könnyebben megpörög/blokkol a kerék.", get: () => WHEEL.frictionSlip, set: (v) => (WHEEL.frictionSlip = v), min: 0.5, max: 10, step: 0.1 },
      { label: "Oldaltapadás", path: "WHEEL.sideFrictionStiffness", hint: "A kerekek oldalirányú tapadása -- ez határozza meg elsősorban, mennyire 'harap be' a kanyarba.", get: () => WHEEL.sideFrictionStiffness, set: (v) => (WHEEL.sideFrictionStiffness = v), min: 0.5, max: 8, step: 0.1 },
      { label: "Első tengely tapadás-szorzó", path: "WHEEL.frontGripMultiplier", hint: "Extra szorzó csak az első kerekekre. Magasabb = kevesebb alkormányzás (understeer).", get: () => WHEEL.frontGripMultiplier, set: (v) => (WHEEL.frontGripMultiplier = v), min: 0.3, max: 2, step: 0.05 },
      { label: "Hátsó tengely tapadás-szorzó", path: "WHEEL.rearGripMultiplier", hint: "Extra szorzó csak a hátsó kerekekre. Alacsonyabb = könnyebben kicsúszik a far (oversteer/drift).", get: () => WHEEL.rearGripMultiplier, set: (v) => (WHEEL.rearGripMultiplier = v), min: 0.3, max: 2, step: 0.05 },
    ],
  },
  {
    title: "Felfüggesztés",
    sliders: [
      { label: "Merevség", path: "WHEEL.suspensionStiffness", hint: "A felfüggesztés rugómerevsége. Magasabb = feszesebb, kevésbé süllyed be teherre/gyorsulásra.", get: () => WHEEL.suspensionStiffness, set: (v) => (WHEEL.suspensionStiffness = v), min: 5, max: 60, step: 1 },
      { label: "Kompresszió-csillapítás", path: "WHEEL.suspensionCompression", hint: "Csillapítás összenyomódáskor (pl. amikor gödörbe/ütközésbe fut a kerék).", get: () => WHEEL.suspensionCompression, set: (v) => (WHEEL.suspensionCompression = v), min: 0.1, max: 1, step: 0.02 },
      { label: "Visszaengedés-csillapítás", path: "WHEEL.suspensionRelaxation", hint: "Csillapítás a rugó visszaengedésekor. 1,0 fölött pattoghat/imbolyoghat az autó -- óvatosan.", get: () => WHEEL.suspensionRelaxation, set: (v) => (WHEEL.suspensionRelaxation = v), min: 0.1, max: 1.3, step: 0.02 },
      { label: "Max felfüggesztési erő", path: "WHEEL.maxSuspensionForce", hint: "A felfüggesztés által kifejthető legnagyobb erő. Túl alacsony érték átdöfheti a talajt (átesik rajta).", get: () => WHEEL.maxSuspensionForce, set: (v) => (WHEEL.maxSuspensionForce = v), min: 10000, max: 150000, step: 1000 },
      { label: "Nyugalmi hossz", path: "WHEEL.suspensionRestLength", hint: "A felfüggesztés kinyújtott hossza -- ez határozza meg alapvetően a menetmagasságot.", get: () => WHEEL.suspensionRestLength, set: (v) => (WHEEL.suspensionRestLength = v), min: 0.1, max: 0.6, step: 0.01, format: (v) => `${v.toFixed(2)} m` },
    ],
  },
  {
    title: "Karosszéria / stabilizáció",
    sliders: [
      { label: "Szögsebesség-csillapítás", path: "CHASSIS.angularDamping", hint: "Mennyire fékeződik le magától a karosszéria forgása MINDEN irányban (kanyarodás, dőlés, bukdácsolás egyaránt).", get: () => CHASSIS.angularDamping, set: (v) => (CHASSIS.angularDamping = v), min: 0, max: 1, step: 0.02 },
      { label: "Bukdácsolás/dőlés csillapítás", path: "STABILIZATION.pitchRollDamping", hint: "Külön csillapítás CSAK a bukdácsolásra (gyorsuláskori 'felállás') és oldaldőlésre -- a kanyarodást nem érinti.", get: () => STABILIZATION.pitchRollDamping, set: (v) => (STABILIZATION.pitchRollDamping = v), min: 0.3, max: 1, step: 0.02 },
      { label: "Csillapítás felső határa", path: "STABILIZATION.skipAboveDeg", hint: "Ez alatt a dőlésszög alatt hat a fenti csillapítás. E fölött (pl. borulás közben) nem avatkozik be, hogy ne zavarja az önfelegyenesedést.", get: () => STABILIZATION.skipAboveDeg, set: (v) => (STABILIZATION.skipAboveDeg = v), min: 10, max: 50, step: 1, format: (v) => `${v.toFixed(0)}°` },
      { label: "Önfelegyenesítő nyomaték", path: "RECOVERY.torque", hint: "Milyen erős nyomatékkal fordítja vissza az autót a kerekeire, ha felborult vagy oldalára dőlt.", get: () => RECOVERY.torque, set: (v) => (RECOVERY.torque = v), min: 2000, max: 25000, step: 500 },
    ],
  },
];

const DEFAULTS = new Map<SliderDef, number>();
for (const section of SECTIONS) {
  for (const slider of section.sliders) DEFAULTS.set(slider, slider.get());
}

/**
 * A fizika-csuszkak lathatosaga.
 *
 * CSAK DEV MODBAN latszanak (lasd devMode.ts): futasidoben allitjak a
 * jarmu fizikajat, tehat egy jatekos kezeben elonyt jelentenenek.
 */
export function setDebugPanelVisible(visible: boolean): void {
  const root = document.getElementById("debug-panel");
  if (root) root.hidden = !visible;
}

export function initDebugPanel(): void {
  const root = document.getElementById("debug-panel");
  if (!root) return;
  // A lathatosagot a hivo allitja be a dev mod szerint -- itt
  // szandekosan REJTVE hagyjuk, hogy egy pillanatra se villanjon fel
  // jatekos-modban.
  root.hidden = true;

  const header = document.createElement("div");
  header.className = "debug-header";
  const titleRow = document.createElement("div");
  titleRow.innerHTML = `<h2>Fizika hangolás</h2>`;

  const toggleBtn = document.createElement("button");
  toggleBtn.textContent = "‒";
  toggleBtn.type = "button";
  toggleBtn.title = "Összecsukás";

  header.append(titleRow, toggleBtn);
  root.appendChild(header);

  const buttons = document.createElement("div");
  buttons.className = "debug-actions";

  const resetBtn = document.createElement("button");
  resetBtn.textContent = "alapértelmezett";
  resetBtn.type = "button";

  const exportBtn = document.createElement("button");
  exportBtn.textContent = "exportálás";
  exportBtn.type = "button";
  exportBtn.title = "Aktuális beállítások letöltése JSON fájlként";

  buttons.append(resetBtn, exportBtn);
  root.appendChild(buttons);

  const body = document.createElement("div");
  body.className = "debug-body";
  root.appendChild(body);

  const valueEls = new Map<SliderDef, HTMLSpanElement>();
  const inputEls = new Map<SliderDef, HTMLInputElement>();

  function resetSlider(slider: SliderDef): void {
    const defaultValue = DEFAULTS.get(slider);
    if (defaultValue === undefined) return;
    slider.set(defaultValue);
    const input = inputEls.get(slider);
    const valueSpan = valueEls.get(slider);
    if (input) input.value = String(defaultValue);
    if (valueSpan) {
      const fmt = slider.format ?? ((v: number) => v.toFixed(2));
      valueSpan.textContent = fmt(defaultValue);
    }
  }

  for (const section of SECTIONS) {
    const h3 = document.createElement("h3");
    h3.textContent = section.title;
    body.appendChild(h3);

    for (const slider of section.sliders) {
      const row = document.createElement("div");
      row.className = "slider-row";

      const labelRow = document.createElement("div");
      labelRow.className = "slider-label";
      const labelSpan = document.createElement("span");
      labelSpan.textContent = slider.label;
      const valueSpan = document.createElement("span");
      valueSpan.className = "slider-value";
      const fmt = slider.format ?? ((v: number) => v.toFixed(2));
      valueSpan.textContent = fmt(slider.get());

      const resetOneBtn = document.createElement("button");
      resetOneBtn.className = "slider-reset";
      resetOneBtn.type = "button";
      resetOneBtn.textContent = "↺";
      resetOneBtn.title = "Visszaállítás alapértelmezettre";
      resetOneBtn.addEventListener("click", () => resetSlider(slider));

      const rightGroup = document.createElement("span");
      rightGroup.className = "slider-label-right";
      rightGroup.append(resetOneBtn, valueSpan);

      labelRow.append(labelSpan, rightGroup);

      const input = document.createElement("input");
      input.type = "range";
      input.min = String(slider.min);
      input.max = String(slider.max);
      input.step = String(slider.step);
      input.value = String(slider.get());
      input.addEventListener("input", () => {
        const v = Number(input.value);
        slider.set(v);
        valueSpan.textContent = fmt(v);
      });

      const hintP = document.createElement("div");
      hintP.className = "slider-hint";
      hintP.textContent = slider.hint;

      row.append(labelRow, input, hintP);
      body.appendChild(row);

      valueEls.set(slider, valueSpan);
      inputEls.set(slider, input);
    }
  }

  resetBtn.addEventListener("click", () => {
    for (const slider of DEFAULTS.keys()) resetSlider(slider);
  });

  toggleBtn.addEventListener("click", () => {
    const collapsed = root.classList.toggle("collapsed");
    toggleBtn.textContent = collapsed ? "+" : "‒";
  });

  exportBtn.addEventListener("click", () => {
    exportCurrentValues();
  });
}

/**
 * Az aktualis csuszka-ertekeket egy JSON fajlba menti, amit a
 * felhasznalo letolthet es visszaadhat -- a kulcsok pontosan a
 * config.ts export const objektumainak (DRIVE/WHEEL/CHASSIS/
 * STABILIZATION/RECOVERY) tulajdonsag-neveit hasznaljak, hogy
 * kozvetlenul, ertelmezes nelkul atvezethetok legyenek oda.
 *
 * A "Max kormányszög" csuszka fokban jelenik meg, de a config.ts-ben
 * radianban van taroelva -- exportkor visszaalakitjuk radianba, hogy
 * a fajl kozvetlenul masolhato legyen.
 */
function exportCurrentValues(): void {
  const values: Record<string, Record<string, number>> = {};

  for (const section of SECTIONS) {
    for (const slider of section.sliders) {
      const isRadConversion = slider.path.endsWith("(rad)");
      const cleanPath = isRadConversion ? slider.path.replace(" (rad)", "") : slider.path;
      const [objectName, propName] = cleanPath.split(".");
      const rawValue = isRadConversion ? rad(slider.get()) : slider.get();

      values[objectName] ??= {};
      values[objectName][propName] = Math.round(rawValue * 10000) / 10000;
    }
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    note:
      "A Car Combat Arena spike elo debug-paneljerol exportalt fizikai ertekek. " +
      "A kulcsok kozvetlenul a spike/src/config.ts DRIVE/WHEEL/CHASSIS/STABILIZATION/RECOVERY " +
      "objektumainak tulajdonsag-neveivel egyeznek.",
    values,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  a.href = url;
  a.download = `car-combat-arena-tuning-${timestamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
