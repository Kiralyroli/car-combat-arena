import {
  ABILITIES,
  DEFAULT_ABILITY,
  type AbilityId,
  heatColor,
  OVERHEAT_FLASH_MS,
  type CarId,
  carLabel,
  GAME_MODES,
  isTimed,
  type GameModeId,
  KILL_CAUSE_LABEL,
  type KillEvent,
  DAMAGE_NUMBER_MS,
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
/**
 * Hatralevo ido "m:ss" alakban.
 *
 * PERC ES MASODPERC, nem puszta masodpercek: harom percnyi jatekbol a
 * "148 mp" nem mond semmit egy pillantasra, az "2:28" igen. A vegen
 * (egy perc alatt) is megmarad a formatum, hogy a szam ne ugorjon at
 * mas alakba eppen a leszoritasban.
 */
export function formatTime(ms: number): string {
  const osszes = Math.max(0, Math.ceil(ms / 1000));
  const perc = Math.floor(osszes / 60);
  const mp = osszes % 60;
  return `${perc}:${String(mp).padStart(2, "0")}`;
}

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
  private readonly ability: HTMLElement;
  /** A sajat sebzes-szamunk eleme a HP-sav folott. */
  private readonly hpDamage: HTMLElement;
  /** A most mutatott osszeg es a kezdete -- az osszevonashoz. */
  private damageShown = 0;
  private damageShownAt = -Infinity;
  /** A kamera-mod sora es allapot-cimkeje (koveto / szabad). */
  private readonly camera: HTMLElement;
  private readonly cameraState: HTMLElement;
  private readonly abilityName: HTMLElement;
  private readonly abilityState: HTMLElement;
  /** Az utolso kirajzolt kepesseg-allapot -- a folosleges DOM-iras ellen. */
  private lastAbilityKey = "";
  private readonly tyres: HTMLElement;

  private tyreCells: HTMLElement[] = [];
  private lastTyreKey = "";
  private lastWeaponKey = "";
  /** Lefulladt-e a fegyver az ELOZO frissiteskor -- a villogas elehez. */
  private lastOverheated = false;
  private villogasTimer: number | null = null;

  /**
   * Rovid piros villogas a lefulladas pillanataban.
   *
   * Az osztalyt a VEGEN levesszuk, kulonben a kovetkezo lefulladas nem
   * inditana ujra az animaciot (a bongeszo ugyanazt az osztalyt mar
   * lefutottnak tekinti).
   */
  private villogtat(): void {
    if (this.villogasTimer !== null) window.clearTimeout(this.villogasTimer);

    if (this.weapon.classList.contains("tulmeleg")) {
      // Mar villog (ket lefulladas gyorsan egymas utan): egy kepkockat
      // varunk, kulonben az osztaly levetele es visszatetele ugyanabban
      // a kepkockaban tortenne, es a bongeszo nem inditana ujra az
      // animaciot.
      this.weapon.classList.remove("tulmeleg");
      requestAnimationFrame(() => this.weapon.classList.add("tulmeleg"));
    } else {
      // Az ELSO villanas azonnal indul: ez figyelmeztetes, egy
      // kepkockanyi keses is lathatoan kesobb kapja el a szemet.
      this.weapon.classList.add("tulmeleg");
    }
    this.villogasTimer = window.setTimeout(() => {
      this.weapon.classList.remove("tulmeleg");
      this.villogasTimer = null;
    }, OVERHEAT_FLASH_MS);
  }

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
    this.ability = must("ability");
    this.abilityName = must("ability-name");
    this.abilityState = must("ability-state");
    this.hpDamage = must("hp-damage");
    this.camera = must("camera");
    this.cameraState = must("camera-state");
    this.tyres = must("tyres");
    // A lobby alatt REJTVE marad: ures HP- es boost-savokat mutatna,
    // ami a nev-beviteli parbeszed mogott csak zavaro.
  }

  show(): void {
    this.root.hidden = false;
  }

  /**
   * A SAJAT sebzes-szamunk a HP-sav folott ("-24").
   *
   * OSSZEADODIK, amig latszik az elozo: egy gepfegyver-sorozat alatt
   * masodpercenkent tobb talalat is er, es harom egymast tulíro "-4"
   * kevesebbet mond, mint egy novekvo "-12". Ugyanez a szabaly all a
   * palyan levo szamokra is (lasd SceneView.addDamageNumber).
   *
   * Az ANIMACIOT ujra kell inditani minden talalatnal: a CSS csak az
   * osztaly HOZZAADASAKOR indul, tehat elobb le kell venni, es egy
   * kikenyszeritett ujraszamolas utan visszatenni.
   */
  showDamage(mennyi: number, now: number): void {
    if (mennyi <= 0) return;
    const elozo =
      now - this.damageShownAt < DAMAGE_NUMBER_MS ? this.damageShown : 0;
    this.damageShown = elozo + mennyi;
    this.damageShownAt = now;
    this.hpDamage.textContent = `-${Math.round(this.damageShown)}`;
    this.hpDamage.classList.remove("uj");
    // A stilus kiolvasasa kikenyszeriti az ujraszamolast -- e nelkul a
    // bongeszo osszevonna a ket osztaly-valtoztatast, es az animacio
    // nem indulna ujra.
    void this.hpDamage.offsetWidth;
    this.hpDamage.classList.add("uj");
  }

  /**
   * A KAMERA modjanak kijelzese.
   *
   * A korulnezes KAPCSOLO (kozepso egergomb), nem nyomva tartas --
   * tehat a jatekos benne is felejtheti magat. Egy kapcsolt allapot,
   * aminek nincs nyoma a kepernyon, ugy jelentkezik, hogy "elromlott a
   * kamera": nem fordul az autoval, es nem derul ki, miert.
   *
   * Az allapot a FreeLook-tol jon (lasd main.ts), nem itt szamoljuk:
   * egy sajat masolat elcsuszhatna tole.
   */
  setCameraFree(szabad: boolean): void {
    this.camera.classList.toggle("szabad", szabad);
    this.cameraState.textContent = szabad ? "SZABAD" : "KÖVETŐ";
  }

  /**
   * A KEPESSEG allapota.
   *
   * Harom allapot van, es mindharmat MASKENT kell mutatni: kesz,
   * eppen fut, visszatoltodik. Egy kozos szam osszemosna a "most hat"
   * es a "mindjart hasznalhato" esetet -- pedig a jatekos szamara ez a
   * ketto ellentetes.
   *
   * Az adat a SZERVERTOL jon, nem helyi becsles: a kepesseg
   * kimenetelet ugyis a szerver donti el, es egy kulon szamolt
   * visszaszamlalo csendben elcsuszna tole.
   */
  private frissitKepesseg(
    ability: AbilityId,
    aktiv: boolean,
    cooldownMs: number,
    activeMs: number,
  ): void {
    const kesz = !aktiv && cooldownMs <= 0;
    const kulcs = `${ability}|${aktiv}|${Math.ceil(activeMs / 100)}|${kesz ? 0 : Math.ceil(cooldownMs / 100)}`;
    if (kulcs === this.lastAbilityKey) return;
    this.lastAbilityKey = kulcs;

    this.abilityName.textContent = ABILITIES[ability].nev.toUpperCase();
    this.ability.classList.toggle("reloading", !kesz && !aktiv);
    this.ability.classList.toggle("aktiv", aktiv);
    // AKTIV allapotban a HATRALEVO idot mutatjuk, nem csak azt, hogy
    // fut: egy pajzs, amirol nem tudni, mikor jar le, nem hasznalhato
    // idozitesre -- pedig eppen az az ertelme.
    this.abilityState.textContent = aktiv
      ? `${(activeMs / 1000).toFixed(1)} s`
      : kesz
        ? "KESZ"
        : `${(cooldownMs / 1000).toFixed(1)} s`;
    this.abilityState.style.color = aktiv ? "#39d0ff" : "";
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
    /** Lefulladt-e a fegyver (a SZERVER szerint). */
    overheated = false,
    /** A valasztott kepesseg es allapota -- a SZERVER szerint. */
    ability: AbilityId = DEFAULT_ABILITY,
    abilityActive = false,
    abilityCooldownMs = 0,
    /** Mennyi van meg a HATASBOL (ms). */
    abilityActiveMs = 0,
  ): void {
    this.frissitKepesseg(
      ability,
      abilityActive,
      abilityCooldownMs,
      abilityActiveMs,
    );
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

      // VILLOGAS a lefulladas pillanataban -- csak az ELSO kepkockan
      // inditjuk, kulonben az animacio minden frissitesnel ujraindulna,
      // es allando villogas lenne belole.
      if (overheated && !this.lastOverheated) this.villogtat();
      this.lastOverheated = overheated;
      // A LEFULLADAST a szerver mondja meg, nem a hoszintbol tippeljuk.
      //
      // Korabban itt "percent >= 99" allt, ami gyakorlatilag SOHA nem
      // teljesult: a szerver a lefulladas pillanataban mar hulni is
      // kezd, tehat a 20 Hz-es snapshotba nem esik bele a pontos
      // maximum -- a kliens altal latott csucs 94 korul van. A jatekos
      // igy azt latta, hogy a fegyver leall, a kijelzo meg egy
      // szazalekot mutat, minden magyarazat nelkul.
      // A hoszintet egesz szazalekra kerekitve kulcsoljuk: kulonben
      // minden frame-ben a DOM-hoz nyulnank.
      const key = `mg|${Math.round(percent)}|${overheated}`;
      if (key !== this.lastWeaponKey) {
        this.lastWeaponKey = key;
        this.weaponName.textContent = "GEPFEGYVER";
        this.weapon.classList.toggle("reloading", overheated);
        this.weaponState.textContent = overheated
          ? "TULMELEG"
          : `${percent.toFixed(0)}%`;
        // A SZIN a hoszintbol jon (heatColor): a jatekos harc kozben nem
        // olvas szazalekot, a szint viszont perifériasan is erzekeli.
        // Lefulladva a skala vegen allunk, fuggetlenul attol, hogy a
        // hules mar elkezdodott-e.
        this.weaponState.style.color = heatColor(overheated ? 100 : percent);
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

    // Kerekek: allapot ES szazalek.
    //
    // A szazalek a HASZNALHATO tapadast mutatja, nem a javitas
    // elorehaladasat: a letort kerek 0%, amig vissza nem all (akkor is,
    // ha kozben mar gyogyul). A jatekost az erdekli, hogy MOST mennyit
    // er a kerek -- es arra ez a helyes valasz.
    //
    // A kulcs a szazalekot is tartalmazza, kulonben a lassu
    // regeneralodas nem latszana: a harom durva allapot ("tort",
    // "serult", "ep") vegig ugyanaz maradna.
    const percents = wheels.map((w) =>
      w.damage.broken ? 0 : Math.round(w.damage.gripMultiplier * 100),
    );
    const key = wheels
      .map(
        (w, i) =>
          (w.damage.broken ? "b" : w.damage.gripMultiplier < 0.99 ? "h" : "o") +
          percents[i],
      )
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
      const damage = wheels[i].damage;
      const state = damage.broken
        ? "broken"
        : damage.gripMultiplier < 0.99
          ? "hurt"
          : "";
      this.tyreCells[i].className = `tyre ${state}`.trim();
      this.tyreCells[i].textContent = `${percents[i]}%`;
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
    /** Sajat kilovesek -- az idore meno modban ez a sajat allasunk. */
    kills = 0,
  ): void {
    // Csak VALTOZASKOR nyulunk a DOM-hoz: ez a ket elem minden frame-ben
    // frissulne, pedig masodpercenkent legfeljebb egyszer valtozik
    // ertelmesen (a visszaszamlalas is egesz masodpercekben).
    const seconds = Math.ceil(match.restartInMs / 1000);
    // AZ IDORE meno mod visszaszamlaloja masodpercre kerekitve kerul a
    // kulcsba: enelkul minden kepkockaban ujrairnank a DOM-ot.
    const hatra = Math.ceil(match.timeLeftMs / 1000);
    const key =
      `${match.phase}|${match.mode}|${lives}|${kills}|${match.survivors}|` +
      `${match.winnerId}|${seconds}|${hatra}|${isOwnWin}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.banner.hidden = false;
    const idore = isTimed(match.mode);

    // A BAL OLDALON az all, ami a modban a sajat allasunkat jelenti:
    // tulelés-modban a megmaradt eletek, idore meno modban a sajat
    // kilovesunk szama. Ket mod, ket kerdes -- de ugyanaz a hely.
    const eliminated = !idore && lives !== null && lives <= 0;
    const sajatCimke = idore ? "KILOVES" : "ELET";
    const sajatErtek = idore
      ? `<span class="lives">${kills}</span>`
      : lives === null
        ? "--"
        : eliminated
          ? '<span class="out">KIESTEL</span>'
          : `<span class="lives">${"●".repeat(lives)}</span>`;

    const phaseText =
      match.phase === "waiting"
        ? "varakozas jatekosokra"
        : match.phase === "ended"
          ? "meccs vege"
          : idore
            ? formatTime(match.timeLeftMs)
            : `${match.survivors} jatekos talpon`;

    this.banner.innerHTML =
      `<span><span class="cap">${sajatCimke}</span> ${sajatErtek}</span>` +
      `<span class="phase${idore && match.phase === "playing" ? " ido" : ""}">` +
      `${phaseText}</span>` +
      `<span class="mod">${GAME_MODES[match.mode].nev}</span>`;

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
  /** Hany jatekost lott ki ebben a meccsben. */
  kills: number;
  /** Az auto szine -- ez koti a nevsort a palyan latott kocsihoz. */
  car: CarId;
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
export function sortScoreRows(
  rows: readonly ScoreRow[],
  /**
   * KILOVES szerint rendezzunk-e (idore meno mod) az eletek helyett.
   *
   * A rendezes a mod KERDESET koveti: ha az eletek szerint rendeznenk
   * egy deathmatchben, a lista sorrendje semmit nem mondana az
   * allasrol -- ott mindenkinek ugyanannyi elete van vegig.
   */
  byKills = false,
): ScoreRow[] {
  return [...rows].sort((a, b) =>
    byKills
      ? b.kills - a.kills || a.name.localeCompare(b.name)
      : b.lives - a.lives || a.name.localeCompare(b.name),
  );
}

export class Scoreboard {
  private readonly el: HTMLElement;
  private lastKey = "";

  constructor() {
    this.el = must("scoreboard");
  }

  /**
   * @param mode A jatekmod: ez donti el, MI az allas (elet vagy kiloves).
   */
  update(rows: ScoreRow[], ownId: string | null, mode: GameModeId): void {
    const idore = isTimed(mode);
    const sorted = sortScoreRows(rows, idore);

    const key =
      mode +
      "|" +
      sorted.map((r) => `${r.id}:${r.name}:${r.lives}:${r.kills}:${r.car}`).join("|");
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
      // KIESVE csak a tulelés-modban lehet valaki: idore meno modban az
      // ujraszuletes korlatlan, ott az athuzott sor hazudna.
      if (!idore && row.lives <= 0) line.classList.add("out");

      // Az AUTO NEVE a jatekos neve elott: EZ koti ossze a listat a
      // palyan latott kocsival. E nelkul a nevsor csak nevek listaja --
      // a jatekos nem tudja, melyik kocsi kicsoda.
      //
      // Korabban szinpotty allt itt; a szinek helyett most kulonbozo
      // karosszeriak vannak, es azokat a nevuk azonositja.
      const dot = document.createElement("span");
      dot.className = "carnev";
      dot.textContent = carLabel(row.car);

      const name = document.createElement("span");
      name.className = "nm";
      // SZOVEGKENT tesszuk be, nem innerHTML-lel: a nev egy MASIK
      // jatekostol jon, tehat jelolest tartalmazhatna.
      name.textContent = row.name;

      // Az ALLAS oszlopa modonkent MAST mutat: tulelés-modban a
      // megmaradt eleteket, idore meno modban a kilovesek szamat --
      // mert a ket modban mas donti el, ki all jol.
      const allas = document.createElement("span");
      if (idore) {
        allas.className = "kills";
        allas.textContent = String(row.kills);
      } else {
        allas.className = "lv";
        allas.textContent = row.lives > 0 ? "●".repeat(row.lives) : "KIESETT";
      }

      line.append(dot, name, allas);
      this.el.appendChild(line);
    }
  }
}

/**
 * KILOVES-LISTA a jobb felso sarokban: ki, mivel, kit lott ki.
 *
 * MINDEN jatekmodban megy. A deathmatchben ez maga az esemenyfolyam,
 * de a tulelés-modban is fontos: abbol, hogy ki fogy a mezonybol es
 * kinek koszonhetoen, a jatekos eldonti, kitol tartson.
 *
 * A NEVEK az esemenybol jonnek, nem a jelenlegi jatekoslistabol: egy
 * kilepett jatekos neve is helyesen marad a listan.
 */
export class KillFeed {
  private readonly el: HTMLElement;

  /**
   * Ennyi sor latszik egyszerre.
   *
   * Egy hosszabb lista mar a palyat takarna, es a regi sorokkal ugysem
   * kezd semmit a jatekos -- a kilovés-lista a MOSTROL szol. Nyolc
   * jatekosnal egy kaotikus pillanatban is ennyi a hasznos.
   */
  private static readonly MAX = 5;

  /**
   * Meddig marad kint egy sor (ms).
   *
   * Ket rossz vege lenne a szelsoseges ertekeknek: egy villano sort a
   * jatekos harc kozben nem venne eszre, egy allando lista viszont
   * elveszitene az "eppen most tortent" jelenteset.
   */
  private static readonly ELETTARTAM_MS = 7000;

  /** A kint levo sorok, a lejaratukkal -- a legregibb elol. */
  private readonly sorok: { el: HTMLElement; lejar: number }[] = [];

  constructor() {
    this.el = must("kill-feed");
  }

  /**
   * Uj kilovesek felvetele.
   *
   * A SAJAT azonositonk kell hozza: a jatekost elsosorban az erdekli,
   * mi tortent VELE, es az o neve ezert kiemelve latszik.
   */
  add(kills: KillEvent[], ownId: string | null, now: number): void {
    for (const kill of kills) {
      const sor = document.createElement("div");
      sor.className = "sor";

      if (kill.killerId === null || kill.cause === null) {
        // SAJAT HIBA: nincs kilovo. Nem hallgatjuk el -- a mezonybol
        // igy is kiesett valaki, es ezt latni kell.
        sor.append(
          this.nevElem(kill.victimName, kill.victimId === ownId),
          this.szoveg("maga", "megsemmisült"),
        );
      } else {
        sor.append(
          this.nevElem(kill.killerName, kill.killerId === ownId),
          this.szoveg("mivel", KILL_CAUSE_LABEL[kill.cause]),
          this.nevElem(kill.victimName, kill.victimId === ownId),
        );
      }

      this.el.appendChild(sor);
      this.sorok.push({ el: sor, lejar: now + KillFeed.ELETTARTAM_MS });
    }

    // A regi sorok azonnal mennek, ha tullepnenk a keretet: igy egy
    // nagy csata alatt is a LEGUJABB ot esemeny latszik.
    while (this.sorok.length > KillFeed.MAX) this.torolLegregebbi();
    this.el.hidden = this.sorok.length === 0;
  }

  /** Kepkockankent: a lejart sorok eltuntetese. */
  update(now: number): void {
    while (this.sorok.length > 0 && this.sorok[0].lejar <= now) {
      this.torolLegregebbi();
    }
    this.el.hidden = this.sorok.length === 0;
  }

  /** Uj meccsnel tiszta lappal indulunk. */
  clear(): void {
    while (this.sorok.length > 0) this.torolLegregebbi();
    this.el.hidden = true;
  }

  private torolLegregebbi(): void {
    const sor = this.sorok.shift();
    sor?.el.remove();
  }

  /**
   * Egy nev a soron.
   *
   * SZOVEGKENT, nem innerHTML-lel: a nev egy MASIK jatekostol jon,
   * tehat jelolest tartalmazhatna.
   */
  private nevElem(nev: string, sajat: boolean): HTMLElement {
    const el = document.createElement("span");
    el.className = sajat ? "nev en" : "nev";
    el.textContent = nev;
    return el;
  }

  private szoveg(osztaly: string, szoveg: string): HTMLElement {
    const el = document.createElement("span");
    el.className = osztaly;
    el.textContent = szoveg;
    return el;
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
