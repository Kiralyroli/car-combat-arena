import { ARCADE, CHASSIS, RECOVERY, WHEEL } from "@cca/shared";

/**
 * Elo, csuszkas debug-panel a fizikai parameterek probalgatasahoz.
 *
 * FONTOS: a csuszkak KOZVETLENUL mutaljak a config.ts export const
 * objektumait (pl. `ARCADE.maxSpeed = ertek`). Ez azert mukodik
 * valtoztatas nelkul a tobbi kodon, mert a `const` csak az objektum-
 * referenciat zarolja, a tulajdonsagait nem -- es az arkad modell
 * (arcade.ts) minden lepesben frissen olvassa ki ezeket az ertekeket,
 * nem gyorsitotarazza oket.
 *
 * Amit NEM lehet igy elo csuszkaval allitani: a karosszeria merete
 * (CHASSIS.halfExtents) es a kerekek elhelyezkedese (WHEEL_LAYOUT) a
 * vilag felepitesekor rogzul, ezeket csak az oldal frissitesevel
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
      { label: "Csúcssebesség", path: "ARCADE.maxSpeed", hint: "Meddig gyorsul gázzal. Az autó ezt a sebességet célozza meg, nem egy hajtóerőt -- ezért kiszámítható.", get: () => ARCADE.maxSpeed, set: (v) => (ARCADE.maxSpeed = v), min: 10, max: 60, step: 1, format: (v) => `${v.toFixed(0)} m/s (${(v * 3.6).toFixed(0)} km/h)` },
      { label: "Csúcssebesség boosttal", path: "ARCADE.boostMaxSpeed", hint: "Ugyanaz, Shift lenyomva.", get: () => ARCADE.boostMaxSpeed, set: (v) => (ARCADE.boostMaxSpeed = v), min: 10, max: 80, step: 1, format: (v) => `${v.toFixed(0)} m/s (${(v * 3.6).toFixed(0)} km/h)` },
      { label: "Tolatási csúcssebesség", path: "ARCADE.maxReverseSpeed", hint: "Meddig gyorsul hátrafelé.", get: () => ARCADE.maxReverseSpeed, set: (v) => (ARCADE.maxReverseSpeed = v), min: 3, max: 30, step: 1, format: (v) => `${v.toFixed(0)} m/s` },
      { label: "Gyorsulás", path: "ARCADE.accel", hint: "Milyen gyorsan éri el a csúcssebességet. 20 m/s² mellett kb. 1,5 mp.", get: () => ARCADE.accel, set: (v) => (ARCADE.accel = v), min: 5, max: 60, step: 1, format: (v) => `${v.toFixed(0)} m/s²` },
      { label: "Gyorsulás boosttal", path: "ARCADE.boostAccel", hint: "Ebből jön a boost 'lökés' érzete -- nem csak a végsebesség számít.", get: () => ARCADE.boostAccel, set: (v) => (ARCADE.boostAccel = v), min: 5, max: 80, step: 1, format: (v) => `${v.toFixed(0)} m/s²` },
      { label: "Fékezés", path: "ARCADE.brakeDecel", hint: "Amikor a gáz a haladással SZEMBE hat (S menet közben). Magasabb = rövidebb féktáv.", get: () => ARCADE.brakeDecel, set: (v) => (ARCADE.brakeDecel = v), min: 5, max: 80, step: 1, format: (v) => `${v.toFixed(0)} m/s²` },
      { label: "Motorfék", path: "ARCADE.coastDecel", hint: "Lassulás gáz nélkül. Ez cseng le a robbanások és ütközések lökése is -- alacsony érték = tovább repül az autó.", get: () => ARCADE.coastDecel, set: (v) => (ARCADE.coastDecel = v), min: 0, max: 30, step: 0.5, format: (v) => `${v.toFixed(1)} m/s²` },
    ],
  },
  {
    title: "Kanyarodás",
    sliders: [
      { label: "Max fordulási sebesség", path: "ARCADE.maxYawRate", hint: "Ez a fő 'mennyire éles a kanyar' csúszka. A kanyarsugár ebből jön: sugár = sebesség / fordulási sebesség.", get: () => ARCADE.maxYawRate, set: (v) => (ARCADE.maxYawRate = v), min: 0.5, max: 6, step: 0.1, format: (v) => `${v.toFixed(1)} rad/s (${deg(v).toFixed(0)}°/s)` },
      { label: "Teljes fordulás sebessége", path: "ARCADE.turnRampSpeed", hint: "Ekkora sebességnél éri el a kormány a teljes hatását. Ez alatt arányosan kevesebb -- álló helyzetben az autó nem pördül meg helyben.", get: () => ARCADE.turnRampSpeed, set: (v) => (ARCADE.turnRampSpeed = v), min: 1, max: 20, step: 0.5, format: (v) => `${v.toFixed(1)} m/s` },
      { label: "Fordulás csúcssebességnél", path: "ARCADE.turnFactorAtTopSpeed", hint: "Csúcssebességnél a fordulásnak ennyi hányada marad. Alacsonyabb = nagy sebességnél nyugodtabb, de lomhább.", get: () => ARCADE.turnFactorAtTopSpeed, set: (v) => (ARCADE.turnFactorAtTopSpeed = v), min: 0.1, max: 1, step: 0.05 },
      { label: "Kormány válaszideje", path: "ARCADE.yawAccel", hint: "Milyen gyorsan éri el a fordulás a célértékét. Magasabb = azonnalibb, de rángósabb; ebből cseng le az ütközés okozta pörgés is.", get: () => ARCADE.yawAccel, set: (v) => (ARCADE.yawAccel = v), min: 2, max: 40, step: 0.5, format: (v) => `${v.toFixed(1)} rad/s²` },
      { label: "Kormányzás levegőben", path: "ARCADE.airSteerAuthority", hint: "Ugratás közben a kormány ennyied része hat -- ennyivel lehet igazítani a landolás irányát.", get: () => ARCADE.airSteerAuthority, set: (v) => (ARCADE.airSteerAuthority = v), min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: "Tapadás / drift",
    sliders: [
      { label: "Oldaltapadás", path: "ARCADE.lateralGrip", hint: "A modell EGYETLEN tapadás-értéke: ilyen ütemben húzza nullába az oldalirányú csúszást. Magas = az autó oda megy, amerre az orra néz.", get: () => ARCADE.lateralGrip, set: (v) => (ARCADE.lateralGrip = v), min: 2, max: 80, step: 1, format: (v) => `${v.toFixed(0)} m/s²` },
      { label: "Oldaltapadás kézifékkel", path: "ARCADE.driftLateralGrip", hint: "Space lenyomva ennyire esik vissza -- innen jön a drift. Alacsonyabb = hosszabb csúszás.", get: () => ARCADE.driftLateralGrip, set: (v) => (ARCADE.driftLateralGrip = v), min: 0, max: 30, step: 0.5, format: (v) => `${v.toFixed(1)} m/s²` },
      { label: "Drift fordulás-szorzó", path: "ARCADE.driftYawBoost", hint: "Kézifékkel ennyivel élesebben fordul.", get: () => ARCADE.driftYawBoost, set: (v) => (ARCADE.driftYawBoost = v), min: 1, max: 2.5, step: 0.05 },
    ],
  },
  {
    title: "Felfüggesztés",
    sliders: [
      { label: "Rugóállandó", path: "WHEEL.suspensionStiffness", hint: "Kerekenként. Túl alacsony = az autó leül a talajra; túl magas = merev, pattogós.", get: () => WHEEL.suspensionStiffness, set: (v) => (WHEEL.suspensionStiffness = v), min: 5000, max: 80000, step: 1000, format: (v) => `${(v / 1000).toFixed(0)}k N/m` },
      { label: "Lengéscsillapítás", path: "WHEEL.suspensionDamping", hint: "E nélkül az autó trambulinként pattogna landoláskor. Túl magas = merev, döccenős.", get: () => WHEEL.suspensionDamping, set: (v) => (WHEEL.suspensionDamping = v), min: 500, max: 12000, step: 100, format: (v) => `${v.toFixed(0)} Ns/m` },
      { label: "Nyugalmi hossz", path: "WHEEL.suspensionRestLength", hint: "A rugó kinyújtott hossza -- ez adja a menetmagasságot.", get: () => WHEEL.suspensionRestLength, set: (v) => (WHEEL.suspensionRestLength = v), min: 0.1, max: 0.6, step: 0.01, format: (v) => `${v.toFixed(2)} m` },
      { label: "Max felfüggesztési erő", path: "WHEEL.maxSuspensionForce", hint: "Egy kerék legnagyobb kifejthető ereje. Túl alacsony = nagy eséskor átüt a talajon.", get: () => WHEEL.maxSuspensionForce, set: (v) => (WHEEL.maxSuspensionForce = v), min: 10000, max: 150000, step: 1000 },
    ],
  },
  {
    title: "Karosszéria / talpra állás",
    sliders: [
      { label: "Szögcsillapítás", path: "CHASSIS.angularDamping", hint: "Csak a bukdácsolást és az oldaldőlést érinti (a kanyarodást a modell közvetlenül állítja). Magasabb = kevesebb imbolygás landolás után.", get: () => CHASSIS.angularDamping, set: (v) => (CHASSIS.angularDamping = v), min: 0, max: 5, step: 0.1 },
      { label: "Talpra állás ideje", path: "RECOVERY.rightingTime", hint: "Ennyi idő alatt áll vissza a kerekeire egy felborult autó. Garantáltan sikerül.", get: () => RECOVERY.rightingTime, set: (v) => (RECOVERY.rightingTime = v), min: 0.1, max: 3, step: 0.1, format: (v) => `${v.toFixed(1)} mp` },
      { label: "Talpra állás küszöge", path: "RECOVERY.startAngleDeg", hint: "E fölötti dőlésszögnél indul a visszaállítás. Ez alatt szabadon dőlhet (kanyar, sérült kerék).", get: () => RECOVERY.startAngleDeg, set: (v) => (RECOVERY.startAngleDeg = v), min: 20, max: 120, step: 5, format: (v) => `${v.toFixed(0)}°` },
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

/**
 * A hitbox-kapcsolo, hogy kivulrol is vissza lehessen allitani.
 *
 * KELL: dev modbol kilepve a hitboxokat kenyszeritve kikapcsoljuk, es
 * olyankor a pipa ne maradjon bent -- kulonben legkozelebb bekapcsolt
 * allapotot mutatna, kikapcsolt dobozok mellett.
 */
let hitboxCheckbox: HTMLInputElement | null = null;

export function setHitboxesChecked(checked: boolean): void {
  if (hitboxCheckbox) hitboxCheckbox.checked = checked;
}

export function initDebugPanel(
  opts: { onHitboxes?: (visible: boolean) => void } = {},
): void {
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

  // HITBOXOK: az UTKOZO dobozok kirajzolasa.
  //
  // Nem szepsegkerdes: a latvany es az utkozes ket kulon forrasbol jon
  // (a modell, illetve az ArenaBox-ok), es az elcsuszasuk CSENDES -- a
  // jatekos nekimegy a semminek, vagy athajt azon, amit lat. Ez a
  // kapcsolo ranezesre megmutatja, hol van tenylegesen a fal.
  const hitboxLabel = document.createElement("label");
  hitboxLabel.className = "debug-toggle";
  hitboxLabel.title = "Az ütköző dobozok kirajzolása";
  const hitboxInput = document.createElement("input");
  hitboxInput.type = "checkbox";
  hitboxInput.addEventListener("change", () => {
    opts.onHitboxes?.(hitboxInput.checked);
  });
  hitboxLabel.append(hitboxInput, document.createTextNode("hitboxok"));
  hitboxCheckbox = hitboxInput;

  buttons.append(resetBtn, exportBtn, hitboxLabel);
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
