import {
  EXPLOSION_MAX_PUSH,
  EXPLOSION_RADIUS,
  FIXED_DT,
  HEALTHY_WHEEL,
  MAX_STEPS_PER_FRAME,
  ROCKET_COOLDOWN_MS,
  NEUTRAL_INPUT as NEUTRAL_DRIVE,
  RapierBackend,
  type VehicleBackend,
  type WheelDamage,
  DEFAULT_WEAPON,
  RESPAWN_DELAY_MS,
  toWeaponId,
  carColorHex,
  toCarColorId,
  DEFAULT_CAR_COLOR,
  type CarColorId,
  weaponPivot,
  type TracerSnapshot,
  type WeaponId,
} from "@cca/shared";
import { Aim } from "./aim";
import { ControlsHelp } from "./controlsHelp";
import { initDebugPanel, setDebugPanelVisible } from "./debugPanel";
import { DevMode } from "./devMode";
import {
  hideLoading,
  Hud,
  MatchHud,
  NetStat,
  PlayerHud,
  Scoreboard,
  showError,
} from "./hud";
import { Lobby, RoomBadge } from "./lobby";
import { Input } from "./input";
import { NetworkClient } from "./network/networkClient";
import { ExplosionQueue } from "./network/explosionQueue";
import { DelayedQueue } from "./network/delayedQueue";
import { RespawnWeaponPick } from "./respawnPick";
import { BoostTank } from "./boostTank";
import { SceneView } from "./scene";

/**
 * A jatekszerver cime.
 *
 * ELESBEN a SAJAT cimunkbol szarmazik: ugyanaz a folyamat szolgalja ki
 * a klienst es a WebSocketet (terv 15.7). Igy nem kell a szerver cimet
 * a buildbe egetni, es nincs mixed-content gond sem -- HTTPS-en a
 * "ws://" blokkolt, "wss://"-t viszont automatikusan kapunk.
 *
 * FEJLESZTESBEN ket kulon szerver fut (Vite az 5173-on, jatekszerver a
 * 8080-on), ezert ott a localhost az alapertelmezes.
 *
 * A VITE_SERVER_URL mindkettot felulirja -- ezzel lehet kulon hostolt
 * szerverre mutatni, ha a ket resz kesobb szetvalik.
 */
function defaultServerUrl(): string {
  if (import.meta.env.DEV) return "ws://localhost:8080";
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}`;
}

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? defaultServerUrl();

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
  const aim = new Aim();

  /**
   * Kiloves a celkereszt ala.
   *
   * A kepernyo-koordinatabol a jelenet szamolja ki a vilagbeli
   * celpontot (sugar-vetites), es AZT kuldjuk a szervernek -- az irany
   * a szerver hiteles pozicioja es a celpont kozott all elo.
   */
  /**
   * Mikor kertunk utoljara kilovest (performance.now).
   *
   * A hutes kijelzese ebbol indul, nem a szerver valaszabol: igy a
   * visszajelzes AZONNALI. A szerver ugyanezt a ROCKET_COOLDOWN_MS-t
   * ervenyesiti, tehat a ketto nem csuszik szet -- legfeljebb egy
   * elutasitott loves eseten mutatunk rovid hutest folosen.
   */
  let lastFireAt = -Infinity;

  /**
   * Kattintas a halal alatt: HELYVALASZTAS, nem loves.
   *
   * Ugyanaz a gomb, mas jelentes -- de a ketto sosem eshet egybe: halott
   * autoval nem lehet tuzelni. Igy nem kell kulon kezelot bekotni, es a
   * jatekosnak sem kell mas gombot keresnie.
   *
   * @returns Elnyelte-e a kattintast.
   */
  function pickSpawnAtCrosshair(): boolean {
    if (net.pendingSpawn === null) return false;
    const [ndcX, ndcY] = aim.ndc();
    const index = view.spawnChoiceAt(ndcX, ndcY);
    if (index === null) return false;
    net.chooseSpawn(index);
    return true;
  }

  function fireAtCrosshair(): void {
    if (pickSpawnAtCrosshair()) return;
    // CSAK az agyu sul el kattintasra. A gepfegyver a nyomva tartast
    // jelzi az allapotaban (ClientState.firing), es a lovesek utemet a
    // szerver adja -- lasd Room.stepWeapons. Ha itt is lonenk, minden
    // kattintas egy EXTRA lovest adna a sorozathoz.
    if (net.ownWeapon !== "cannon") return;
    const [ndcX, ndcY] = aim.ndc();
    net.fire(view.aimPointAt(ndcX, ndcY));
    lastFireAt = performance.now();
  }
  aim.onFire(fireAtCrosshair);

  /**
   * A celzas iranya szogekben, a SAJAT autonk kozeppontjabol nezve.
   *
   * Ebbol all be a tetőn levő rakétaveto, es ez megy at a halozaton is,
   * hogy a tobbiek lassak, merre celzunk.
   */
  function currentAim(chassis: {
    position: [number, number, number];
    quaternion: [number, number, number, number];
  }): {
    yaw: number;
    pitch: number;
  } {
    const [ndcX, ndcY] = aim.ndc();
    const target = view.aimPointAt(ndcX, ndcY);
    // A FEGYVER forgaspontjabol, nem az auto kozeppontjabol: a loves is
    // onnan indul (lasd weaponPivot). Ha a ketto elter, a loves
    // parhuzamosan elmegy a celpont mellett.
    //
    // A SAJAT fegyverunkkel: a ket fegyver forgaspontja mas magassagban
    // van (kulon modell), tehat ugyanaz a celkereszt mas szoget jelent.
    const origin = weaponPivot(
      chassis.position,
      chassis.quaternion,
      net.ownWeapon,
    );
    const dx = target[0] - origin[0];
    const dy = target[1] - origin[1];
    const dz = target[2] - origin[2];
    const horizontal = Math.hypot(dx, dz);
    return {
      // A szog KONVENCIOJA: az az Y-forgatas, amivel egy -Z fele nezo
      // objektum ebbe az iranyba fordul. A "kezenfekvo" atan2(dx, -dz)
      // ennek pont az ELLENTETTJE -- azzal a veto a celzassal ellenkezo
      // oldalra mutatott (a kepen jol lathatoan).
      yaw: Math.atan2(-dx, -dz),
      pitch: Math.atan2(dy, horizontal || 1e-4),
    };
  }
  const hud = new Hud(backend.name, backend.version);
  const matchHud = new MatchHud();
  const playerHud = new PlayerHud();
  const scoreboard = new Scoreboard();
  const netStat = new NetStat();
  // A peldanyositas maga koti be a H billentyut es a sugo-gombot; a
  // sugo CSAK keresre nyilik, tehat innen nem hivunk rajta semmit.
  new ControlsHelp();
  initDebugPanel();

  // Dev mod: a fizika-csuszkak es a technikai panel CSAK itt latszik.
  // A jatekosnak a PlayerHud marad (HP, boost, sebesseg, fegyver).
  const dev = new DevMode();
  dev.onChange((enabled) => {
    setDebugPanelVisible(enabled);
    hud.setVisible(enabled);
    // A CSS ebbol tudja kikerulni a csuszka-panelt (lasd body.dev).
    document.body.classList.toggle("dev", enabled);
  });

  input.onAction((action) => {
    if (action === "reset") {
      backend.reset();
      for (let i = 0; i < 4; i++) {
        backend.setWheelDamage(i, { ...HEALTHY_WHEEL });
      }
      return;
    }
    if (action === "fire") {
      fireAtCrosshair();
      return;
    }
    // A kerek-serules debug-gombjai (1-4 es javitas) CSAK OFFLINE
    // hatnak. Csatlakozva a szerver birtokolja a kerekek allapotat
    // (terv 4.6), es a kovetkezo snapshot ugyis visszairna a helyi
    // valtoztatast -- a gomb latszolag "nem mukodne". Inkabb mondjuk
    // meg, mint hogy a jatekos egy villano kereket lasson.
    if (action === "repairWheels" || /^breakWheel\d$/.test(action)) {
      if (net.connected) {
        console.warn(
          "A kerek-serulest a szerver kezeli -- a debug-gombok csak offline hatnak.",
        );
        return;
      }
      if (action === "repairWheels") {
        for (let i = 0; i < 4; i++) {
          backend.setWheelDamage(i, { ...HEALTHY_WHEEL });
        }
        return;
      }
      const index = Number(/^breakWheel(\d)$/.exec(action)![1]);
      backend.setWheelDamage(index, { ...BROKEN_WHEEL });
    }
  });

  // --- Halozat ---
  // A szobakod az URL hash-ebol jon (#ABCD). Ha nincs, a szerver nyit
  // egy ujat, es a kodot visszairjuk a hash-be -- igy a link
  // megoszthato a tobbi jatekossal.
  const net = new NetworkClient();

  /**
   * A folyamatban levo belepes -- a "joined" vagy "error" esemeny
   * oldja fel.
   *
   * A "join" uzenetre a valasz KESOBB erkezik, es lehet siker vagy hiba
   * (nincs ilyen szoba, tele van). A lobbynak meg kell varnia, hogy
   * hiba eseten a jatekos ott, LATHATOAN kapja meg az uzenetet -- ne
   * csak a konzolon.
   */
  let pendingJoin: ((error: string | null) => void) | null = null;

  function joinAndWait(
    roomCode: string | undefined,
    name: string,
    weapon?: WeaponId,
    color?: CarColorId,
  ): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      pendingJoin = resolve;
      net.join(roomCode, name, weapon, color);
    });
  }

  /**
   * Robbanasok, amik a KESLELTETETT idovonalon meg nem jottek el --
   * a latvany es a lokes egyszerre, a rakéta megjelenitesevel egy
   * idoben tortenik. Lasd ExplosionQueue.
   */
  const explosionQueue = new ExplosionQueue();

  /**
   * Gepfegyver-nyomjelzok, UGYANARRA a kesleltetett idovonalra igazitva,
   * mint a robbanasok es az autok.
   *
   * A szerver a sajat idejeben szamolja a lovest, a kliens viszont a
   * tobbieket 100 ms-mal korabbrol rajzolja. Kesleltetes nelkul a csik
   * OTT jelenne meg, ahol a celpont MOST van -- a kepernyon viszont
   * meg korabbi helyen all --, tehat a talalatok rendszeresen melle
   * mutatnanak.
   */
  const tracerQueue = new DelayedQueue<TracerSnapshot>();

  /** Fegyvervalaszto a halal-kepernyon (ujraszuletesig hasznalhato). */
  const respawnPick = new RespawnWeaponPick((weapon) => net.selectWeapon(weapon));

  /** Mikor haltunk meg (lokalis ora) -- a visszaszamlalashoz. */
  let diedAt: number | null = null;

  /** A boost-tartaly: a Shift ebbol fogy, a pickup ezt tolti. */
  const boostTank = new BoostTank();

  /**
   * Tavoli jatekosonkent az utoljara KIRAJZOLT HP.
   *
   * Ebbol latszik a megsemmisules PILLANATA (elo -> 0 atmenet), amire
   * robbanast inditunk. Sima allapotbol ez nem derulne ki: a 0 HP
   * onmagaban csak annyit mond, hogy a kocsi mar halott.
   */
  const lastDrawnHp = new Map<string, number>();
  net.on({
    onJoined: (_playerId, roomCode, spawn) => {
      // Sikeres belepes: a verzio rendben van. Toroljuk az
      // ujratoltes-jelzot, hogy egy KESOBBI deploy is tudjon
      // automatikusan frissiteni (lasd onError / bad_protocol).
      sessionStorage.removeItem("cca.reloadedForVersion");
      location.hash = roomCode;
      // A szerver altal kiosztott helyre allunk, kulonben minden
      // jatekos a kozos config-spawnra (egymasba) szuletne.
      backend.reset({ x: spawn[0], y: spawn[1], z: spawn[2] });
      // A mar bent levo jatekosok autoi ekkorra letrejottek (a `joined`
      // uzenet eloszor `onPlayerJoined`-ot valt ki mindegyikre), ezert a
      // JELENETBOL olvassuk a szamot. A halozati puffer meg ures --
      // az csak az elso snapshottol tolodik fel --, abbol nezve
      // csatlakozaskor mindig 0 tarsat mutatnank.
      hud.setNetworkStatus(`szoba ${roomCode}`, view.remoteCarCount);
      // A lobby erre var: sikeres belepes.
      pendingJoin?.(null);
      pendingJoin = null;
    },
    onPlayerJoined: (id, color) => {
      view.addRemoteCar(id, carColorHex(color));
      // Fizikai test is kell hozza, kulonben athajtanank rajta.
      backend.addRemoteBody(id);
      hud.setNetworkStatus(`szoba ${net.roomCode}`, view.remoteCarCount);
    },
    onPlayerLeft: (id) => {
      view.removeRemoteCar(id);
      backend.removeRemoteBody(id);
      hud.setNetworkStatus(`szoba ${net.roomCode}`, view.remoteCarCount);
    },
    onExplosion: (position) => {
      // A robbanas a szerver JELENEBEN tortent, a rakétat viszont --
      // mint minden halozati entitast -- INTERP_DELAY_MS-szel korabbrol
      // rajzoljuk. Ha a villanas azonnal megjelenne, a lovedek elott
      // robbanna fel: 55 m/s-nal 5.5 m-rel korabban. Ezert a
      // MEGJELENITEST a rakéta idovonalara toljuk.
      //
      // A LOKES is ekkor hat, nem hamarabb: kulonben a jatekost
      // ellokne, mielott barmit latna belole. Egyben tartjuk az okot es
      // az okozatot.
      explosionQueue.push(position, performance.now());
    },
    onTracers: (tracers) => {
      const now = performance.now();
      for (const tracer of tracers) tracerQueue.push(tracer, now);
    },
    onRespawn: (position) => {
      // A szerver altal kiosztott helyre allunk, teli HP-val. A serult
      // kerekeket is javitjuk: uj auto, uj esely.
      backend.reset({ x: position[0], y: position[1], z: position[2] });
      for (let i = 0; i < 4; i++) {
        backend.setWheelDamage(i, { ...HEALTHY_WHEEL });
      }
      // Teli tartallyal indulunk ujra -- kulonben a halalt koveto kor
      // ott folytatodna, ahol az elozo abbamaradt, es a mar amugy is
      // hatranyban levo jatekos meg boost nelkul is maradna.
      boostTank.reset();
    },
    onError: (code, message) => {
      console.warn(`Halozati hiba (${code}): ${message}`);

      // ELAVULT KLIENS: a betoltott csomag regebbi, mint a szerver.
      //
      // Ez minden visszatero jatekost erint egy deploy utan, es kezzel
      // nem nyilvanvalo, mit kellene tenni -- ezert magunk toltunk
      // ujra. CSAK EGYSZER: ha az ujratoltes utan is elavult marad (pl.
      // a bongeszo makacsul a regi oldalt adja), a vegtelen ujratoltes
      // rosszabb lenne a hibauzenetnel.
      if (code === "bad_protocol") {
        const KEY = "cca.reloadedForVersion";
        if (sessionStorage.getItem(KEY) === null) {
          sessionStorage.setItem(KEY, "1");
          location.reload();
          return;
        }
      }
      hud.setNetworkStatus(`hiba: ${code}`, 0);
      if (code === "room_not_found") location.hash = "";
      // Ha eppen belepni probaltunk, a LOBBY kapja meg a hibat --
      // lathatoan, nem csak a konzolon.
      pendingJoin?.(message);
      pendingJoin = null;
    },
    onClose: () => {
      for (const id of view.remoteCarIds()) {
        view.removeRemoteCar(id);
        backend.removeRemoteBody(id);
      }
      hud.setNetworkStatus("kapcsolat bontva", 0);
    },
  });

  const roomFromUrl = location.hash.replace("#", "").trim();

  // Mesterseges halozati kesleltetes fejlesztoi teszteleshez:
  //   ?lag=200        -> 200 ms oda-vissza ut
  //   ?lag=200&jitter=40
  // Lasd terv 3. lepcso 6. pont: 150-200 ms mellett is simanak kell lennie.
  const params = new URLSearchParams(location.search);
  const lagMs = Number(params.get("lag") ?? 0);
  const jitterMs = Number(params.get("jitter") ?? 0);
  if (lagMs > 0) {
    console.log(`Mesterseges kesleltetes: ${lagMs} ms (jitter ${jitterMs} ms)`);
  }

  hideLoading();

  // --- Lobby: nev + szoba-valasztas ---
  //
  // A KAPCSOLATOT nyitjuk meg eloszor, belepes nelkul: igy a lobby le
  // tudja kerdezni a nyitott szobakat, mielott a jatekos valasztana.
  const lobby = new Lobby();
  const roomBadge = new RoomBadge();
  lobby.setRefreshHandler(() => net.requestRoomList());
  net.on({ onRoomList: (rooms) => lobby.showRooms(rooms) });

  /**
   * A "?name=" MEGKERULI a lobbyt (a hash-ben megadott szobaba lep be).
   * Ez kell az automatizalt teszteknek -- kulonben minden e2e futas a
   * lobbyban allna meg --, es a kozvetlen meghivo-linkkel erkezoknek is
   * kenyelmes.
   */
  const directName = params.get("name");
  /**
   * Fegyver az URL-bol, a lobby MEGKERULESEVEL.
   *
   * Ugyanaz a minta, mint a "?name=" -- a kozvetlen meghivo-linkkel
   * erkezoknek kenyelmes, es enelkul az automatizalt teszt sem tudna
   * gepfegyverrel indulni: a meccs kozbeni valtast a szerver
   * (helyesen) elutasitja.
   */
  const directWeapon = toWeaponId(params.get("weapon") ?? DEFAULT_WEAPON);
  /** Autoszin az URL-bol -- ugyanaz a minta, mint a "?weapon=". */
  const directColor = toCarColorId(params.get("color") ?? DEFAULT_CAR_COLOR);

  try {
    await net.open(SERVER_URL, lagMs, jitterMs);
  } catch (err: unknown) {
    // A halozat hianya NEM allitja meg a jatekot: egyjatekos modban
    // tovabb lehet vezetni (ez a fejlesztes kozben is kenyelmesebb).
    console.warn("Nem sikerult csatlakozni a szerverhez:", err);
    hud.setNetworkStatus("offline", 0);
  }

  if (net.connected) {
    if (directName !== null) {
      await joinAndWait(roomFromUrl || undefined, directName, directWeapon, directColor);
    } else {
      // Amig a belepes nem sikerul, visszaterunk a lobbyba a hibaval.
      let message: string | undefined;
      for (;;) {
        const choice = await lobby.open(message);
        const failure = await joinAndWait(
          choice.roomCode,
          choice.name,
          choice.weapon,
          choice.color,
        );
        if (failure === null) break;
        message = failure;
      }
    }
    if (net.roomCode) roomBadge.show(net.roomCode);
  }

  // A jatekos-HUD es a celkereszt csak a lobby utan jelenik meg. Offline
  // modban is ide jutunk, csak lobby nelkul -- ott is jar a celzas.
  playerHud.show();
  netStat.show();
  aim.setActive(true);

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
    // A celzas is elerheto: enelkul nem lehet megmerni, hogy a
    // nyomva tartott gomb eljut-e a halozati allapotig.
    aim,
    boostTank,
    view,
    net,
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

    // Az utkozes-joslat idozitese a MERT kesleltetesbol szarmazik
    // (lasd rapier.ts holdDurationMs) -- ezert kell a fizikanak
    // ismernie a pinget.
    backend.setNetworkLatency(net.ping ?? 0);

    // A tavoli autok fizikai testeit a LEPTETES ELOTT kell a helyukre
    // vinni, kulonben egy lepessel elmaradnanak, es az utkozes
    // "atcsuszasnak" latszana. Ugyanabbol az interpolalt allapotbol
    // dolgozunk, mint a megjelenites, igy amit latunk, azzal utkozunk.
    for (const id of net.remotes.ids()) {
      // Megsemmisult autonak nincs teste -- lasd lentebb.
      if (net.remotes.hpOf(id) === 0) continue;
      view.setRemoteProtected(id, net.remotes.isProtected(id));

      // A szin a SZERVERE: minden kepkockaban ellenorizzuk, hogy a
      // kirajzolt auto egyezik-e vele. Igy barmelyik uton is erkezett
      // (playerJoined vagy snapshot), a vege ugyanaz -- es minden
      // kliens ugyanazt a jatekost ugyanolyannak latja.
      view.setRemoteColor(id, carColorHex(net.remotes.colorOf(id)));
      // A FEGYVER ugyanigy: ujraszuleteskor valthat, es a tetőn ülő
      // modellbol kell latszania, mire szamitsunk az ellenfeltol.
      view.setRemoteWeapon(id, net.remotes.weaponOf(id));

      const state = net.remotes.sample(id, now);
      if (!state) continue;
      backend.updateRemoteBody(
        id,
        [state.position.x, state.position.y, state.position.z],
        [
          state.quaternion.x,
          state.quaternion.y,
          state.quaternion.z,
          state.quaternion.w,
        ],
        [state.velocity.x, state.velocity.y, state.velocity.z],
      );
    }

    // A pickupokat a szerver konyveli: a kiosztott visszatoltesek
    // szamabol a tartaly magatol utolerheto allapotba kerul.
    boostTank.syncGrants(net.boostGrants);

    // Fix lepeskozu fizika, a rendereleskol fuggetlenul (projekt-terv 15.3).
    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      const raw = input.read();
      // A boost a TARTALYBOL fogy, es csak akkor hat, ha van meg benne.
      // A fogyasztas a fizikai lepeshez kotodik (nem a kepkockahoz),
      // kulonben lassabb gepen mas ideig tartana ugyanannyi boost.
      const boost = boostTank.consume(raw.boost, FIXED_DT * 1000);
      backend.step(FIXED_DT, { ...raw, boost });
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
    // NEZOMOD: ha elfogytak az eleteink, a sajat autonk elrejtve marad,
    // es a kamera egy meg talpon levo jatekost kovet.
    //
    // A kamerat SZANDEKOSAN nem kell atalakitani ehhez: ugyanazt a
    // transzform-alaku adatot kapja, csak nem a sajat autonktol. Igy a
    // kovetes, a simitas es a dolesszog kezelese valtozatlan.
    const spectating = net.lives !== null && net.lives <= 0;
    view.setOwnCarVisible(!spectating);

    let cameraTarget = interpolatedChassis;
    if (spectating) {
      const alive = net.remotes
        .ids()
        .find((id) => (net.remotes.hpOf(id) ?? 0) > 0);
      const target = alive ? view.remoteCarTransform(alive) : null;
      // Ha senkit nem talalunk (mindenki kiesett, vagy meg nincs adat),
      // marad a sajat -- rejtett -- autonk nezopontja: igy a kamera nem
      // ugrik a vilag kozepere.
      if (target) cameraTarget = target;
    }
    // Ujraszuletesre varva a kamera a LEENDO helyre nez: ott derul ki,
    // hova kerulunk, es kik vannak a kozelben. Kiesett jatekosnal
    // (nincs tobb elet) ez ertelmetlen -- o vegleg nezo.
    const awaitingRespawn =
      !spectating && net.hp !== null && net.hp <= 0 && net.pendingSpawn !== null;

    if (awaitingRespawn) {
      view.previewArena();
      view.showSpawnChoices(net.spawnOptions, net.pendingSpawnIndex);
    } else {
      view.updateCamera(cameraTarget);
      if (view.spawnChoiceCount > 0) view.clearSpawnChoices();
    }

    // Ujraszuletesi pajzs (a tavoli autoke a lentebbi ciklusban).
    view.setOwnProtected(net.ownProtected);

    // --- Halozat: sajat allapot kuldese, tavoli autok interpolacioja ---
    // A sajat autot NEM a szervertol kapjuk vissza (hibrid authority,
    // terv 15.4) -- csak kikuldjuk a mar kiszamolt allapotot.
    // A celzas iranya: a sajat vetőnk beallitasahoz ES a halozathoz.
    const ownAim = currentAim(currChassis);
    view.setOwnAim(ownAim.yaw, ownAim.pitch);
    view.setOwnColor(carColorHex(net.ownColor));
    // A sajat fegyverunk modellje is a halozati allapotbol jon: a
    // valasztast a SZERVER hagyja jova (elve nem lehet valtani), tehat
    // amit kirajzolunk, az a tenylegesen ervenyes fegyver.
    view.setOwnWeapon(net.ownWeapon);

    net.sendState(
      {
        position: currChassis.position,
        rotation: currChassis.quaternion,
        velocity: backend.getVelocity(),
        aimYaw: ownAim.yaw,
        aimPitch: ownAim.pitch,
        // CSAK a gepfegyvernel van ertelme: az agyu kulon uzenettel sul
        // el. Igy egy agyus jatekos nyomva tartott gombja nem terheli a
        // szerver fegyver-agat.
        firing: net.ownWeapon === "machinegun" && aim.isFiring,
        // Latvany-allapot a tavoli kerekekhez: a kormanyszog a
        // kormanyzott (elso) kerekrol, a rugohosszak mind a negyrol.
        steer: currWheels[0].steering,
        susp: [
          currWheels[0].suspensionLength,
          currWheels[1].suspensionLength,
          currWheels[2].suspensionLength,
          currWheels[3].suspensionLength,
        ],
        // A KEREK-SERULEST mar NEM kuldjuk: azt a szerver birtokolja
        // (terv 15.4, 4. lepcso 6. pont), es a snapshotban kapjuk vissza.
        // Korabban a kliens jelentette be, vagyis egy modositott kliens
        // egyszeruen letagadhatta volna a letort kereket.
      },
      now,
    );

    for (const id of net.remotes.ids()) {
      // Uj jatekos is felbukkanhat pusztan a snapshotbol (pl. ha a
      // playerJoined ertesites elveszne) -- ilyenkor itt potoljuk.
      if (!view.hasRemoteCar(id)) {
        view.addRemoteCar(id, carColorHex(net.remotes.colorOf(id)));
        backend.addRemoteBody(id);
      }

      const state = net.remotes.sample(id, now);
      if (!state) continue;

      // A HP a KIRAJZOLT idopillanatbol jon (state.hp), nem a legfrissebb
      // snapshotbol. A tavoli autot INTERP_DELAY_MS-szel korabbrol
      // rajzoljuk, tehat a halalnak is ott kell bekovetkeznie -- a friss
      // HP-val az auto ~100 ms-mal a latott halala ELOTT tunt el, es a
      // jatekos ezt "egyszeruen eltunt"-kent latta.
      const remoteHp = state.hp;
      const wasAlive = (lastDrawnHp.get(id) ?? remoteHp) > 0;
      lastDrawnHp.set(id, remoteHp);

      // Megsemmisules: robbanas ott, ahol a jatekos az autot LATJA.
      // Enelkul a kocsi nyomtalanul eltunt.
      if (wasAlive && remoteHp === 0) {
        const body = backend.getRemoteBody(id);
        const at: [number, number, number] = body
          ? [body.position[0], body.position[1], body.position[2]]
          : [state.position.x, state.position.y, state.position.z];
        view.spawnExplosion(at, now);
      }

      // Megsemmisult auto: eltunik, es a FIZIKAI TESTE is megszunik --
      // kulonben egy lathatatlan akadallyal lehetne utkozni. A test a
      // LATVANNYAL egyutt tunik el, hogy ne lehessen egy mar nem lathato
      // roncsnak utkozni (es forditva).
      view.setRemoteName(id, net.remotes.nameOf(id));
      view.setRemoteHp(id, remoteHp, now);
      if (remoteHp === 0) {
        backend.removeRemoteBody(id);
        continue;
      }
      // Ujraszuletes utan visszakerul a teste.
      if (!backend.getRemoteBody(id)) backend.addRemoteBody(id);

      // A HELYET a fizikai testrol vesszuk, nem kozvetlenul a halozati
      // mintabol. A test ugyanoda van vezerelve, DE az utkozes lokeset
      // mar a becsapodas pillanataban megkapja -- mig a halozati pozicio
      // csak azutan mozdul, hogy a masik kliens allapota megjarta a
      // szervert oda-vissza (meresben ~580 ms). A kerekek latvany-
      // allapota tovabbra is a halozatbol jon: azt lokalisan nem tudjuk
      // megjosolni.
      const body = backend.getRemoteBody(id);
      if (body) {
        state.position.set(body.position[0], body.position[1], body.position[2]);
        state.quaternion.set(
          body.quaternion[0],
          body.quaternion[1],
          body.quaternion[2],
          body.quaternion[3],
        );
      }
      view.updateRemoteCar(id, state);
    }

    // A rakétakat a szerver lepteti -- mi csak a legutobbi snapshothoz
    // igazitjuk a jelenetet.
    const renderNow = performance.now();

    // A kerek-serulest a SZERVER birtokolja (terv 4.6): a snapshotbol
    // kapott allapotot rakjuk at a sajat fizikankba. Csak VALTOZASKOR,
    // mert a setWheelDamage a kerek-sugarat is ujraszamolja.
    const serverWheels = net.ownWheels;
    if (serverWheels) {
      for (let i = 0; i < 4; i++) {
        const now = currWheels[i].damage;
        const next = serverWheels[i];
        if (now.broken === next.broken && now.gripMultiplier === next.gripMultiplier) {
          continue;
        }
        backend.setWheelDamage(i, { ...next });
      }
    }

    view.syncRockets(net.rockets.sample(renderNow));
    view.syncPickups(net.pickupsAvailable, renderNow);

    // Az esedekesse valt robbanasok: latvany ES lokes egyszerre.
    for (const position of explosionQueue.due(renderNow)) {
      view.spawnExplosion(position, renderNow);
      // A SEBZEST a szerver mar alkalmazta (a HP-ban jon vissza); itt a
      // FIZIKAI LOKES tortenik. Azert a kliensen, mert a hibrid
      // modellben a sajat auto mozgasa hozza tartozik -- a szerver nem
      // tudja ellokni, csak megmondani, hogy volt robbanas.
      backend.applyExplosion(position, EXPLOSION_RADIUS, EXPLOSION_MAX_PUSH);
    }
    view.updateExplosions(renderNow);

    for (const tracer of tracerQueue.due(renderNow)) {
      view.spawnTracer(tracer.from, tracer.to, tracer.hit, renderNow);
    }
    view.updateTracers(renderNow);
    view.updateShields(renderNow);
    view.updateSpawnChoices(renderNow);

    view.render();

    playerHud.update(
      backend.getTelemetry(),
      currWheels,
      net.hp,
      boostTank.fraction,
      Math.max(0, ROCKET_COOLDOWN_MS - (renderNow - lastFireAt)),
      net.ownWeapon,
      net.heat,
    );

    // A halal-kepernyo fegyvervalasztoja: csak amig varunk az
    // ujraszuletesre. Kiesett jatekosnak (nincs tobb elete) mar nincs
    // ertelme, ezert ott sem latszik.
    // A varakozas hatralevo ideje. A kliens a SAJAT halalanak
    // idopontjabol szamolja: enelkul kulon protokoll-mezo kellene egy
    // olyan szamhoz, amit a kliens amugy is tud (a HP-jat latja).
    const dead = net.hp !== null && net.hp <= 0;
    if (!dead) diedAt = null;
    else if (diedAt === null) diedAt = renderNow;

    respawnPick.update(
      dead && (net.lives ?? 0) > 0,
      net.ownWeapon,
      diedAt === null ? 0 : Math.max(0, RESPAWN_DELAY_MS - (renderNow - diedAt)),
    );
    hud.update(backend.getTelemetry(), currWheels, fps, net.ping, net.hp, boostTank.fraction);
    netStat.update(fps, net.ping);
    scoreboard.update(
      [
        // A SAJAT sorunk a halozati rtegbol jon (a szerver tisztitott
        // neve es a szerver szerinti eletszam).
        ...(net.playerId && net.ownName
          ? [
              {
                id: net.playerId,
                name: net.ownName,
                lives: net.lives ?? 0,
                color: net.ownColor,
              },
            ]
          : []),
        ...net.remotes.ids().map((id) => ({
          id,
          name: net.remotes.nameOf(id),
          lives: net.remotes.livesOf(id),
          color: net.remotes.colorOf(id),
        })),
      ],
      net.playerId,
    );
    matchHud.update(
      net.match,
      net.lives,
      net.match.winnerId === null ? null : net.match.winnerId === net.playerId,
    );

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main().catch((err: unknown) => {
  console.error(err);
  showError(`Hiba az inditaskor: ${err instanceof Error ? err.message : String(err)}`);
});
