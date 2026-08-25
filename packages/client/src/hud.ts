import {
  carColorHex,
  type CarColorId,
  type MatchSnapshot,
  type Telemetry,
  type WeaponId,
  type WheelReadout,
} from "@cca/shared";

/**
 * FEJLESZTOI panel: technikai szamlalok (fps, ping, fizikai lepesido,
 * kerekenkenti tapadas, backend verzio).
 *
 * Csak DEV MODBAN latszik -- lasd devMode.ts. A jatekosnak ezek zajok:
 * eltakarjak azt, amit valojaban nezni akar, es semmilyen dontest nem
 * hoz beloluk. Amit igen, az a PlayerHud-on van.
 */
export class Hud {
  private el: HTMLElement;
  private lastRender = 0;
  private networkStatus = "csatlakozas...";
  private remoteCount = 0;
  private visible = false;

  constructor(private backendName: string, private backendVersion: string) {
    const el = document.getElementById("hud");
    if (!el) throw new Error("#hud nem talalhato");
    this.el = el;
  }

  /** Dev modban latszik, kulonben rejtve (a sugo-sorral egyutt). */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.el.hidden = !visible;
    const help = document.getElementById("help");
    if (help) help.hidden = !visible;
    // A kovetkezo update azonnal rajzoljon, ne varjon a 10 Hz-es utemre.
    this.lastRender = 0;
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
    hp: number | null,
    /** A boost-tartaly telitettsege (0..1). */
    boostFraction = 1,
  ): void {
    // Rejtett panelnal semmit nem szamolunk: dev mod nelkul ez a
    // teljes blokk kimarad a fo ciklusbol.
    if (!this.visible) return;

    // 10 Hz eleg a HUD-nak, ne terhelje a fo ciklust.
    const now = performance.now();
    if (now - this.lastRender < 100) return;
    this.lastRender = now;

    // A kuszoboket lasd pingQuality / fpsQuality.
    const pingText = pingMs === null ? "--" : `${pingMs.toFixed(0)} ms`;
    const pingClass = pingQuality(pingMs);
    const fpsClass = fpsQuality(fps);

    // A boost-sav MINDIG latszik, nem csak boostolas kozben: a boost
    // korlatos eroforras, tehat a jatekosnak MIELOTT ranyomna kell
    // tudnia, mennyi maradt. Szinezes: kek = bosegesen van, sarga =
    // fogytan, piros = szinte ures.
    const boostPercent = Math.max(0, Math.min(1, boostFraction)) * 100;
    const boostColor =
      boostPercent > 50 ? "#39d0ff" : boostPercent > 20 ? "#e3b341" : "#f85149";

    // A HP a SZERVERTOL jon (o donti el a sebzest), ezert halozat nelkul
    // nincs ertelmes erteke.
    const hpText =
      hp === null ? "--" : hp === 0 ? "MEGSEMMISULT" : `${hp}`;
    const hpClass = hp === null ? "" : hp > 60 ? "good" : hp > 25 ? "warn" : "bad";

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
      <div class="row"><span class="label">HP</span><span class="val ${hpClass}">${hpText}</span></div>
      <div class="row">
        <span class="label">BOOST</span>
        <span class="val">
          <span style="display:inline-block;width:70px;height:8px;background:#22272e;border:1px solid #3a4048;vertical-align:middle">
            <span style="display:block;height:100%;width:${(boostPercent).toFixed(0)}%;background:${boostColor}"></span>
          </span>
          <span style="color:${boostColor};margin-left:6px">${boostPercent.toFixed(0)}%</span>
        </span>
      </div>
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

/**
 * A JATEKOS HUD-ja: a kepernyo also savja.
 *
 * Csak az van rajta, amibol a jatekos dontest hoz: mennyi HP-ja es
 * boostja van, milyen gyorsan megy, kesz-e a rakéta, es allnak-e meg a
 * kerekei. A technikai szamlalok (fps, ping, fizikai lepesido, backend
 * verzio) a FEJLESZTOI panelra kerultek -- lasd devMode.ts.
 *
 * A DOM-elemeket EGYSZER kerdezzuk le, es utana csak a valtozo
 * ertekeket irjuk. A korabbi HUD minden frissitesnel ujraepitette a
 * teljes innerHTML-t; egy 60 Hz-en frissulo savnal ez folosleges
 * ujraparszolas.
 */
/**
 * A ping es az fps szinezese: zold = jo, sarga = erezheto, piros =
 * zavaro. A hatarok arcade akciojatekhoz igazodnak -- 100 ms felett a
 * tobbi auto mozgasa mar lathatoan "kesik", 60 fps alatt pedig a sajat
 * vezetes kezd akadozni.
 *
 * KOZOS fuggveny, mert KET helyen jelenik meg ugyanaz a szam: a
 * fejlesztoi panelon es a mindig lathato kijelzon. Kulon kuszobokkel a
 * ketto eszrevetlenul elcsuszna, es ugyanaz a ping az egyik helyen
 * zold, a masikon sarga lenne.
 */
export function pingQuality(pingMs: number | null): "" | "good" | "warn" | "bad" {
  if (pingMs === null) return "";
  return pingMs < 60 ? "good" : pingMs < 120 ? "warn" : "bad";
}

export function fpsQuality(fps: number): "good" | "warn" | "bad" {
  return fps >= 55 ? "good" : fps >= 30 ? "warn" : "bad";
}

/**
 * MINDIG lathato halozati kijelzo: fps es ping.
 *
 * A tobbi fejlesztoi szamlalotol elteroen ez a KETTO a jatekosnak is
 * szol: ebbol tudja, hogy a szaggatas a sajat gepe vagy a kapcsolata
 * miatt van-e. Enelkul csak annyit tapasztal, hogy "rossz a jatek".
 *
 * Dev modban REJTVE marad (tiszta CSS: body.dev #netstat), mert ott a
 * fejlesztoi panel ugyanezt reszletesebben mutatja -- ket helyen
 * ugyanaz a szam csak zavarna.
 */
export class NetStat {
  private readonly root: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly pingEl: HTMLElement;
  private lastRender = 0;
  private lastKey = "";

  constructor() {
    this.root = must("netstat");
    this.fpsEl = must("netstat-fps");
    this.pingEl = must("netstat-ping");
  }

  show(): void {
    this.root.hidden = false;
    // A befoglalo oszlop is: abban ul a sugo-gomb is.
    const meta = document.getElementById("meta");
    if (meta) meta.hidden = false;
  }

  update(fps: number, pingMs: number | null): void {
    if (this.root.hidden) return;

    // 10 Hz eleg: a szamok gyorsabban valtozva olvashatatlanok, es a
    // fo ciklust sem terheljuk feleslegesen a DOM-mal.
    const now = performance.now();
    if (now - this.lastRender < 100) return;
    this.lastRender = now;

    const pingText = pingMs === null ? "--" : `${pingMs.toFixed(0)} ms`;
    const key = `${fps.toFixed(0)}|${pingText}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.fpsEl.textContent = `${fps.toFixed(0)} fps`;
    this.fpsEl.className = `val ${fpsQuality(fps)}`;
    this.pingEl.textContent = pingText;
    this.pingEl.className = `val ${pingQuality(pingMs)}`;
  }
}
export class PlayerHud {
  private readonly root: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpNum: HTMLElement;
  private readonly boostFill: HTMLElement;
  private readonly boostNum: HTMLElement;
  private readonly speedNum: HTMLElement;
  private readonly weapon: HTMLElement;
  private readonly weaponName: HTMLElement;
  private readonly weaponState: HTMLElement;
  private readonly tyres: HTMLElement;

  private tyreCells: HTMLElement[] = [];
  private lastTyreKey = "";
  private lastWeaponKey = "";

  constructor() {
    this.root = must("player-hud");
    this.hpFill = must("hp-fill");
    this.hpNum = must("hp-num");
    this.boostFill = must("boost-fill");
    this.boostNum = must("boost-num");
    this.speedNum = must("speed-num");
    this.weapon = must("weapon");
    this.weaponName = must("weapon-name");
    this.weaponState = must("weapon-state");
    this.tyres = must("tyres");
    // A lobby alatt REJTVE marad: ures HP- es boost-savokat mutatna,
    // ami a nev-beviteli parbeszed mogott csak zavaro.
  }

  show(): void {
    this.root.hidden = false;
  }

  update(
    t: Telemetry,
    wheels: WheelReadout[],
    hp: number | null,
    boostFraction: number,
    /** Hatralevo rakéta-hutes (ms); 0 = kesz. */
    rocketCooldownMs: number,
    /** Melyik fegyverrel jatszunk (a szerver szerint). */
    weapon: WeaponId = "cannon",
    /** A gepfegyver hoszintje (0..100). */
    heat = 0,
  ): void {
    // HP. Halozat nelkul nincs ertelmes erteke (a szerver dönti el).
    const hpPercent = hp === null ? 0 : Math.max(0, Math.min(100, hp));
    this.hpFill.style.width = `${hpPercent}%`;
    this.hpFill.style.backgroundColor =
      hpPercent > 60 ? "#3fb950" : hpPercent > 25 ? "#d29922" : "#f85149";
    this.hpNum.textContent = hp === null ? "--" : `${hp}`;

    const boostPercent = Math.max(0, Math.min(1, boostFraction)) * 100;
    this.boostFill.style.width = `${boostPercent}%`;
    this.boostFill.style.backgroundColor =
      boostPercent > 50 ? "#39d0ff" : boostPercent > 20 ? "#e3b341" : "#f85149";
    this.boostNum.textContent = `${boostPercent.toFixed(0)}%`;

    this.speedNum.textContent = `${Math.abs(t.speedKmh).toFixed(0)}`;

    // --- Fegyver ---
    //
    // A ket fegyver MAST mutat, mert mas fogja vissza oket: az agyunal
    // a hatralevo ujratoltes, a gepfegyvernel a hoszint. Egy kozos
    // "keszultseg" szam mindkettot felreertheto modon abrazolna.
    if (weapon === "machinegun") {
      const percent = Math.max(0, Math.min(100, heat));
      const overheated = percent >= 99;
      // A hoszintet egesz szazalekra kerekitve kulcsoljuk: kulonben
      // minden frame-ben a DOM-hoz nyulnank.
      const key = `mg|${Math.round(percent)}`;
      if (key !== this.lastWeaponKey) {
        this.lastWeaponKey = key;
        this.weaponName.textContent = "GEPFEGYVER";
        this.weapon.classList.toggle("reloading", overheated);
        this.weaponState.textContent = overheated
          ? "TULMELEG"
          : `${percent.toFixed(0)}%`;
      }
      return;
    }

    // Agyu. A hutes a SAJAT kilovesunktol indul (lokalis joslat), ezert
    // azonnal visszajelez -- a szerver dontese ugyanezt ervenyesiti.
    const ready = rocketCooldownMs <= 0;
    const weaponKey = ready ? "agyu|kesz" : `agyu|${Math.ceil(rocketCooldownMs / 100)}`;
    if (weaponKey !== this.lastWeaponKey) {
      this.lastWeaponKey = weaponKey;
      this.weaponName.textContent = "AGYU";
      this.weapon.classList.toggle("reloading", !ready);
      this.weaponState.textContent = ready
        ? "KESZ"
        : `${(rocketCooldownMs / 1000).toFixed(1)} s`;
    }

    // Kerekek: csak allapotvaltaskor nyulunk a DOM-hoz.
    const key = wheels
      .map((w) => (w.damage.broken ? "b" : w.damage.gripMultiplier < 0.99 ? "h" : "o"))
      .join("");
    if (key === this.lastTyreKey) return;
    this.lastTyreKey = key;

    if (this.tyreCells.length !== wheels.length) {
      this.tyres.innerHTML = "";
      this.tyreCells = wheels.map(() => {
        const cell = document.createElement("div");
        cell.className = "tyre";
        this.tyres.appendChild(cell);
        return cell;
      });
    }
    for (let i = 0; i < wheels.length; i++) {
      this.tyreCells[i].className = `tyre ${
        key[i] === "b" ? "broken" : key[i] === "h" ? "hurt" : ""
      }`.trim();
    }
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} nem talalhato`);
  return el;
}

/**
 * Meccs-allapot: felul a szamlalok, kozepen az eredmenyjelzo.
 *
 * SZANDEKOSAN kulon osztaly a Hud-tol. A Hud a bal felso technikai
 * panel (fps, ping, kerekek); ez viszont a JATEK allapota, amit a
 * kepernyo kozepen kell latni. Egybegyurva az eredmenyjelzo egy
 * telemetria-sor kozott jelenne meg.
 */
export class MatchHud {
  private readonly banner: HTMLElement;
  private readonly result: HTMLElement;
  private lastKey = "";

  constructor() {
    const banner = document.getElementById("match-banner");
    const result = document.getElementById("match-result");
    if (!banner || !result) throw new Error("#match-banner / #match-result nem talalhato");
    this.banner = banner;
    this.result = result;
  }

  /**
   * @param lives     Sajat eletek szama; null, amig nincs snapshot.
   * @param isOwnWin  A gyoztes MI vagyunk-e (null = dontetlen vagy meg megy).
   */
  update(
    match: MatchSnapshot,
    lives: number | null,
    isOwnWin: boolean | null,
  ): void {
    // Csak VALTOZASKOR nyulunk a DOM-hoz: ez a ket elem minden frame-ben
    // frissulne, pedig masodpercenkent legfeljebb egyszer valtozik
    // ertelmesen (a visszaszamlalas is egesz masodpercekben).
    const seconds = Math.ceil(match.restartInMs / 1000);
    const key = `${match.phase}|${lives}|${match.survivors}|${match.winnerId}|${seconds}|${isOwnWin}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.banner.hidden = false;
    const eliminated = lives !== null && lives <= 0;
    const livesText =
      lives === null
        ? "--"
        : eliminated
          ? '<span class="out">KIESTEL</span>'
          : `<span class="lives">${"●".repeat(lives)}</span>`;

    const phaseText =
      match.phase === "waiting"
        ? "varakozas jatekosokra"
        : match.phase === "ended"
          ? "meccs vege"
          : `${match.survivors} jatekos talpon`;

    this.banner.innerHTML =
      `<span><span class="cap">ELET</span> ${livesText}</span>` +
      `<span class="phase">${phaseText}</span>`;

    if (match.phase !== "ended") {
      this.result.hidden = true;
      return;
    }

    // Eredmenyjelzo. A "dontetlen" nem elmeleti eset: ha az utolso ketto
    // egyszerre semmisul meg, senki nem marad talpon.
    const title =
      isOwnWin === null
        ? '<span class="title">DONTETLEN</span>'
        : isOwnWin
          ? '<span class="title win">GYOZTEL</span>'
          : '<span class="title lose">VESZTETTEL</span>';

    this.result.hidden = false;
    this.result.innerHTML =
      `${title}<div class="sub">uj meccs ${seconds} masodperc mulva</div>`;
  }
}

/** Egy sor az eredmenyjelzon. */
export interface ScoreRow {
  id: string;
  name: string;
  lives: number;
  /** Az auto szine -- ez koti a nevsort a palyan latott kocsihoz. */
  color: CarColorId;
}

/**
 * Eredmenyjelzo: ki hany elettel all, ELETSZAM SZERINT rendezve.
 *
 * A legtobb elettel allo van legfelul. Azonos eletszamnal a nev dönt,
 * hogy a sorrend ne ugralljon ertelmetlenul frame-rol frame-re -- egy
 * stabil rendezes nelkul ket egyforma allasu jatekos folyamatosan
 * helyet cserelne.
 */
/**
 * Az eredmenyjelzo SORRENDJE: legtobb elet legfelul.
 *
 * Kulon, tiszta fuggveny, hogy DOM nelkul is tesztelheto legyen -- a
 * sorrend a jatekos szamara lathato szabaly, nem a megjelenites
 * mellekterméke.
 *
 * Azonos eletszamnal a NEV dönt. Enelkul ket egyforma allasu jatekos
 * sorrendje frame-rol frame-re valtozhatna (a bejaras sorrendje nem
 * garantalt), es a lista lathatoan ugralna.
 */
export function sortScoreRows(rows: readonly ScoreRow[]): ScoreRow[] {
  return [...rows].sort(
    (a, b) => b.lives - a.lives || a.name.localeCompare(b.name),
  );
}

export class Scoreboard {
  private readonly el: HTMLElement;
  private lastKey = "";

  constructor() {
    this.el = must("scoreboard");
  }

  update(rows: ScoreRow[], ownId: string | null): void {
    const sorted = sortScoreRows(rows);

    const key = sorted.map((r) => `${r.id}:${r.name}:${r.lives}:${r.color}`).join("|");
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.el.hidden = sorted.length === 0;
    this.el.textContent = "";
    if (sorted.length === 0) return;

    const head = document.createElement("div");
    head.className = "head";
    head.textContent = "ALLAS";
    this.el.appendChild(head);

    for (const row of sorted) {
      const line = document.createElement("div");
      line.className = "row";
      if (row.id === ownId) line.classList.add("self");
      if (row.lives <= 0) line.classList.add("out");

      // Szinpotty a nev elott: EZ koti ossze a listat a palyan latott
      // autoval. E nelkul a nevsor csak nevek listaja -- a jatekos nem
      // tudja, melyik kocsi kicsoda.
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = `#${carColorHex(row.color).toString(16).padStart(6, "0")}`;

      const name = document.createElement("span");
      name.className = "nm";
      // SZOVEGKENT tesszuk be, nem innerHTML-lel: a nev egy MASIK
      // jatekostol jon, tehat jelolest tartalmazhatna.
      name.textContent = row.name;

      const lives = document.createElement("span");
      lives.className = "lv";
      lives.textContent = row.lives > 0 ? "●".repeat(row.lives) : "KIESETT";

      line.append(dot, name, lives);
      this.el.appendChild(line);
    }
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
