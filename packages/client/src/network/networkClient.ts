import {
  DEFAULT_CAR,
  DEFAULT_SKIN,
  DEFAULT_ABILITY,
  DEFAULT_WEAPON,
  DEFAULT_GAME_MODE,
  hpLoss,
  type KillEvent,
  type GameModeId,
  PING_INTERVAL_MS,
  PROTOCOL_VERSION,
  SNAPSHOT_HZ,
  wheelsFromNetwork,
  type ClientState,
  type WheelDamage,
  type MatchSnapshot,
  type RoomListing,
  type CarId,
  type TracerSnapshot,
  type AbilityId,
  type WeaponId,
  type ServerMessage,
  type Transport,
} from "@cca/shared";
import { LatencyTransport } from "./latencyTransport";
import { RemotePlayers } from "./remotePlayers";
import { RemoteRockets } from "./remoteRockets";
import { WsTransport } from "./wsTransport";

/**
 * A kliens halozati rtege: csatlakozas, szoba, sajat allapot kuldese,
 * tavoli jatekosok pufferelese.
 *
 * A hibrid authority modell (terv 15.4) szerint a sajat autonkat MI
 * szimulaljuk teljes fizikaval -- ez a rteg csak KIKULDI az igy
 * kiszamolt allapotot, es nem varja meg a szerver valaszat. Ezert
 * erzodik a vezetes nulla input laggel.
 */

const SEND_INTERVAL_MS = 1000 / SNAPSHOT_HZ;

export interface NetworkEvents {
  onJoined?: (
    playerId: string,
    roomCode: string,
    spawn: [number, number, number],
  ) => void;
  onPlayerJoined?: (playerId: string, car: CarId, skin: string) => void;
  onPlayerLeft?: (playerId: string) => void;
  onRespawn?: (position: [number, number, number]) => void;
  onExplosion?: (position: [number, number, number], ownerId: string) => void;
  onRoomList?: (rooms: RoomListing[]) => void;
  /**
   * Gepfegyver-lovesek a legutobbi snapshotbol.
   *
   * A snapshotba csomagolva erkeznek, nem kulon uzenetkent: 11 loves/mp
   * mellett nyolc jatekosnal az kozel szaz csomag lenne masodpercenkent.
   */
  onTracers?: (tracers: TracerSnapshot[]) => void;
  /**
   * KILOVESEK a legutobbi snapshotbol -- a kilovés-lista epul beloluk.
   *
   * Ugyanugy a snapshotba csomagolva jonnek, mint a nyomjelzok:
   * esemenyek, nem allapot. A kliens kirajzolja es elfelejti oket.
   */
  onKills?: (kills: KillEvent[]) => void;
  onError?: (code: string, message: string) => void;
  onClose?: () => void;
}

export class NetworkClient {
  readonly remotes = new RemotePlayers();

  private transport: Transport | null = null;
  private events: NetworkEvents = {};
  private seq = 0;
  private lastSendAt = 0;
  private lastPingAt = 0;
  /** Simitott oda-vissza ut (RTT) ms-ban; null, amig nincs meres. */
  private rttMs: number | null = null;
  /** Hany snapshot erkezett -- a "el-e meg a kapcsolat" kijelzeshez. */
  private snapshotCount = 0;

  playerId: string | null = null;
  roomCode: string | null = null;
  /** A sajat karosszeria-HP-nk a szerver szerint; null, amig nincs snapshot. */
  hp: number | null = null;
  /**
   * A sajat kerekeink serulese a szerver szerint; null, amig nincs
   * snapshot. A hivo ebbol allitja be a jarmu FIZIKAJAT -- a kerek-
   * serules nem csak latvany (tapadas es kerek-sugar is fugg tole).
   */
  ownWheels: WheelDamage[] | null = null;
  /**
   * Hany boost-visszatoltest osztott ki nekunk eddig a szerver.
   * A tartaly ebbol tolt (lasd BoostTank.syncGrants).
   */
  boostGrants = 0;

  /**
   * A SAJAT fegyverunk a szerver szerint.
   *
   * Nem a beallitott erteket hasznaljuk: a szerver dönti el, elfogadja-e
   * a valasztast (harc kozben nem lehet valtani), tehat a HUD azt
   * mutassa, amivel tenylegesen jatszunk.
   */
  ownWeapon: WeaponId = DEFAULT_WEAPON;
  /**
   * A sajat KEPESSEG es allapota -- a SZERVER szerint.
   *
   * Nem tartunk rola kulon helyi allapotot: a HUD ebbol rajzol, es igy
   * pontosan azt latja a jatekos, ami szerint a szerver dont.
   */
  ownAbility: AbilityId = DEFAULT_ABILITY;
  ownAbilityActive = false;
  ownAbilityCooldownMs = 0;
  /** Mennyi van meg a hatasbol (ms) -- a HUD ezt mutatja. */
  ownAbilityActiveMs = 0;

  /** A gepfegyver hoszintje (0..100) a szerver szerint. */
  heat = 0;

  /**
   * Lefulladt-e a fegyver (tulmelegedes).
   *
   * A hoszintbol NEM allapithato meg: a szerver a lefulladas
   * pillanataban mar hul is, tehat a snapshotba szinte sosem esik bele
   * a pontos maximum (lasd PlayerSnapshot.overheated).
   */
  overheated = false;

  /** Serthetetlenek vagyunk-e eppen (ujraszuletes utan). */
  ownProtected = false;

  /**
   * Gyogyulunk-e eppen -- a SZERVER szerint.
   *
   * NEM az ownAbility/ownAbilityActive parosbol kovetkeztetve:
   * gyogyulast a palyan felvett elet is indit, olyan jatekosnal is, aki
   * pajzsot valasztott (lasd PlayerSnapshot.healing).
   */
  ownHealing = false;

  /** Hany jatekost lottunk ki EBBEN a meccsben (a szerver szerint). */
  ownKills = 0;

  /**
   * A sajat lovesink merlege ebben a meccsben (a szerver szerint).
   *
   * A meccs vegi eredmenyjelzo talalati aranyahoz -- lasd
   * PlayerSnapshot.shotsFired.
   */
  ownShotsFired = 0;
  ownShotsHit = 0;

  /**
   * Mennyi eletet vesztettunk a legutobbi kiolvasas ota.
   *
   * Ugyanabbol a szabalybol, mint a tavoli autok folotti szam (lasd
   * hpLoss): a HUD ezt mutatja a sajat HP-savunk folott. A hivo
   * KIOLVASSA es nullazza -- lasd consumeOwnDamage.
   */
  private ownDamageAcc = 0;

  /** Mennyit sebzodtunk a legutobbi lekerdezes ota (0 = semmit). */
  consumeOwnDamage(): number {
    const mennyi = this.ownDamageAcc;
    this.ownDamageAcc = 0;
    return mennyi;
  }

  /**
   * A SAJAT autonk a szerver szerint.
   *
   * Nem a beallitott ertek: a szerver mast adhat, ha a kert kocsit a
   * szobaban mar hasznalja valaki (lasd assignCar).
   */
  ownCar: CarId = DEFAULT_CAR;

  /** A SAJAT autonk festese a szerver szerint (lasd assignCar). */
  ownSkin: string = DEFAULT_SKIN;

  /**
   * Hova fogunk ujraszuletni -- vagy null, ha elunk.
   *
   * KULON uzenetben jon (nem a snapshotban), mert csak rank tartozik:
   * a snapshotot mindenki megkapja, tehat abbol az ellenfel megtudna,
   * hol varjon rank. Lasd RespawnPlanMessage.
   */
  pendingSpawn: [number, number, number] | null = null;

  /** A leendo hely sorszama (SPAWN_POINTS indexe), vagy null. */
  pendingSpawnIndex: number | null = null;

  /** Amibol valaszthatunk -- a szabad spawn-pontok sorszamai. */
  spawnOptions: number[] = [];

  /**
   * A legutobb FELDOLGOZOTT szerver-tick.
   *
   * Ezt kuldjuk vissza minden allapottal: ebbol tudja a szerver,
   * mennyire regi vilagot latunk, es ennyivel tekeri vissza a
   * celpontokat az azonnali talalatu fegyvernel.
   */
  private lastTick = 0;
  /**
   * A repulo rakétak pufferelve -- UGYANAZON az idovonalon, mint a
   * tavoli autok (lasd remoteRockets.ts).
   */
  readonly rockets = new RemoteRockets();

  /**
   * Eppen felveheto-e az egyes pickupok (PICKUP_POINTS indexeles).
   * A poziciot a kliens a config-bol ismeri, csak az allapot jon at.
   */
  pickupsAvailable: boolean[] = [];

  /**
   * A meccs allapota a szerver szerint (fazis, mod, allas).
   * Csatlakozas elott varakozonak tekintjuk.
   */
  match: MatchSnapshot = {
    phase: "waiting",
    mode: DEFAULT_GAME_MODE,
    // Meg nem tudjuk, ki a host -- csatlakozas elott nincs is szoba.
    hostId: null,
    survivors: 0,
    winnerId: null,
    timeLeftMs: 0,
    restartInMs: 0,
  };

  /** Hany eletunk van meg; null, amig nincs snapshot. */
  lives: number | null = null;

  /**
   * A SAJAT nevunk a szerver szerint.
   *
   * A snapshotbol vesszuk at, nem a beirt szoveget hasznaljuk: a
   * szerver tisztitja a nevet (hossz, vezerlokarakterek), tehat amit
   * kirajzolunk, az legyen ugyanaz, amit a tobbiek latnak.
   */
  ownName = "";

  /**
   * Rakéta-kiloves kerese a megcelzott vilagbeli pontra.
   * A kiindulopontot, a huteset es a talalatot a szerver donti el.
   */
  fire(target: [number, number, number]): void {
    this.transport?.send({ type: "fire", target });
  }

  /**
   * Jatekos kirugasa -- KERES, nem tény.
   *
   * A jogosultsagot a szerver ellenorzi (csak a host rughat ki, es nem
   * sajat magat). A kliens azert rejti el a gombot masnal, hogy ne
   * kinaljon fel olyat, ami ugyis elbukna -- de a szabalyt nem ez
   * tartatja be.
   */
  kick(playerId: string): void {
    this.transport?.send({ type: "kick", playerId });
  }

  /** A szoba nyitoja vagyunk-e (nekunk latszanak a kirugo gombok). */
  get isHost(): boolean {
    return this.playerId !== null && this.match.hostId === this.playerId;
  }

  get connected(): boolean {
    return this.transport?.connected ?? false;
  }

  /**
   * Oda-vissza kesleltetes (RTT) ms-ban, vagy null, ha meg nincs meres.
   *
   * A jatekban erzekelheto kesleltetes ennek KB. A FELE (egy irany),
   * plusz a szerver snapshot-utemenek fele es az interpolacios puffer
   * (100 ms) -- lasd remotePlayers.ts.
   */
  get ping(): number | null {
    return this.rttMs;
  }

  get receivedSnapshots(): number {
    return this.snapshotCount;
  }

  on(events: NetworkEvents): void {
    this.events = { ...this.events, ...events };
  }

  /**
   * Csatlakozas es szobaba lepes. `roomCode` nelkul a szerver uj szobat
   * nyit, es a kodot a `joined` uzenetben kuldi vissza.
   *
   * `lagMs` > 0 eseten mesterseges kesleltetes kerul a Transport ele --
   * fejlesztoi teszteleshez (terv 3. lepcso 6. pont).
   */
  /**
   * Csak a KAPCSOLAT megnyitasa -- belepes nelkul.
   *
   * A lobby igy meg tudja kerdezni a nyitott szobakat, MIELOTT a
   * jatekos valasztana. Belepni utana a  hivassal lehet.
   */
  async open(url: string, lagMs = 0, jitterMs = 0): Promise<void> {
    const socket = await WsTransport.connect(url);
    const transport: Transport =
      lagMs > 0 ? new LatencyTransport(socket, lagMs, jitterMs) : socket;
    this.transport = transport;

    transport.onMessage((message) => this.handleMessage(message));
    transport.onClose(() => {
      this.remotes.clear();
      // A repulo rakétak is tunjenek el: kapcsolat nelkul nem erkezik
      // tobb minta, es a puffer utolso allapotukban "megfagyasztana" oket.
      this.rockets.clear();
      // A regi kes-ertek megtevesztő lenne bontott kapcsolatnal.
      this.rttMs = null;
      this.events.onClose?.();
    });
  }

  /** Nyitott szobak lekerdezese (a valasz az onRoomList esemenyben jon). */
  requestRoomList(): void {
    this.transport?.send({ type: "listRooms" });
  }

  /**
   * Belepes egy szobaba; kod nelkul a szerver ujat nyit.
   *
   * A JATEKMOD csak az UJ szobara vonatkozik: meglevo szobaba lepve a
   * szoba modja marad ervenyben (lasd JoinMessage.mode).
   */
  join(
    roomCode: string | undefined,
    name: string,
    weapon?: WeaponId,
    car?: CarId,
    ability?: AbilityId,
    skin?: string,
    mode?: GameModeId,
  ): void {
    this.transport?.send({
      type: "join",
      protocol: PROTOCOL_VERSION,
      roomCode,
      name,
      weapon,
      car,
      ability,
      skin,
      mode,
    });
  }

  /**
   * Fegyvervaltas kerese.
   *
   * A szerver dönti el, hogy szabad-e eppen: csak ujraszuleteskor vagy
   * meccs elott. Elutasitas eseten nem jon hibauzenet -- a kovetkezo
   * snapshot egyszeruen a REGI fegyvert hozza vissza, es a HUD is azt
   * mutatja. Igy nincs ket forras ugyanarra az adatra.
   */
  selectWeapon(weapon: WeaponId): void {
    this.transport?.send({ type: "selectWeapon", weapon });
  }

  /**
   * Kepesseg-valasztas -- ugyanaz a szabaly, mint a fegyvernel.
   *
   * Nem tartunk rola helyi allapotot: a kovetkezo snapshot hozza vissza,
   * amit a szerver elfogadott. Igy nincs ket forras ugyanarra az adatra.
   */
  selectAbility(ability: AbilityId): void {
    this.transport?.send({ type: "selectAbility", ability });
  }

  /**
   * A kepesseg elsutese -- KERES.
   *
   * Hogy tenylegesen elsult-e, azt a snapshotbol tudjuk meg (aktiv-e,
   * mennyi a visszatoltes). A kliens nem dontheti el: mindket kepesseg
   * a sebzes kimenetelet valtoztatja.
   */
  useAbility(): void {
    this.transport?.send({ type: "useAbility" });
  }

  /**
   * Ujraszuletesi hely kerese.
   *
   * Mint a fegyvervaltasnal: a szerver dönti el, elfogadja-e (csak
   * varakozas kozben, csak szabad pontra). Elutasitasnal nem jon
   * hibauzenet -- egyszeruen nem erkezik uj terv, es a jelolo a regin
   * marad. Igy nincs ket forras ugyanarra az adatra.
   */
  chooseSpawn(index: number): void {
    this.transport?.send({ type: "chooseSpawn", index });
  }

  /**
   * Kapcsolat + azonnali belepes egy lepesben.
   *
   * A lobby a ket lepest kulon hasznalja (elobb listaz, aztan lep be);
   * ez a rovid ut a teszteknek es a kozvetlen linkkel erkezoknek szol.
   */
  async connect(
    url: string,
    roomCode?: string,
    lagMs = 0,
    jitterMs = 0,
    name?: string,
  ): Promise<void> {
    await this.open(url, lagMs, jitterMs);
    this.join(roomCode, name ?? "");
  }

  disconnect(): void {
    this.transport?.close();
    this.transport = null;
  }

  /**
   * A sajat, mar kiszamolt allapot kuldese -- ratakorlatozva, hogy ne
   * minden renderelt frame-ben menjen ki (a szerver ugyis 20 Hz-en
   * dolgozza fel).
   */
  sendState(state: ClientState, now: number): void {
    if (!this.transport?.connected || !this.playerId) return;

    // A kes-meres ritkabb, mint az allapotkuldes, ezert kulon utemben.
    if (now - this.lastPingAt >= PING_INTERVAL_MS) {
      this.lastPingAt = now;
      this.transport.send({ type: "ping", t: now });
    }

    if (now - this.lastSendAt < SEND_INTERVAL_MS) return;
    this.lastSendAt = now;
    this.transport.send({
      type: "state",
      seq: ++this.seq,
      state,
      ackTick: this.lastTick,
    });
  }

  /**
   * Frissen kilepett jatekosok, es mikor lepett ki (performance.now).
   *
   * Egy `playerLeft` utan meg erkezhetnek olyan snapshotok, amelyek meg
   * TARTALMAZZAK a kilepett jatekost -- azok mar uton voltak, amikor
   * kilepett. Ezek nelkul a szuro nelkul ujra letrehoznank az autojat,
   * es az orokre ott ragadna, mert masodik `playerLeft` nem jon.
   * Halozati ingadozas mellett ez rendszeresen elofordul; a jitteres
   * teszt pontosan ezt produkalta.
   */
  private readonly recentlyLeft = new Map<string, number>();

  /** Ennyi ideig (ms) tiltjuk a kilepett jatekos ujra-felvetelet. */
  private static readonly RECENTLY_LEFT_MS = 3000;

  private hasRecentlyLeft(id: string, now: number): boolean {
    const at = this.recentlyLeft.get(id);
    if (at === undefined) return false;
    if (now - at > NetworkClient.RECENTLY_LEFT_MS) {
      this.recentlyLeft.delete(id);
      return false;
    }
    return true;
  }

  private handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case "joined":
        this.playerId = message.playerId;
        this.roomCode = message.roomCode;
        // A mar bent levok szinet a "joined" uzenet nem hozza -- az az
        // elso snapshotbol derul ki, es a kliens ott igazitja
        // (lasd SceneView.setRemoteColor).
        for (const id of message.players) {
          this.events.onPlayerJoined?.(id, DEFAULT_CAR, DEFAULT_SKIN);
        }
        this.events.onJoined?.(message.playerId, message.roomCode, message.spawn);
        return;

      case "snapshot": {
        // Amig nem tudjuk a SAJAT azonositonkat, a snapshotot eldobjuk.
        //
        // Kulonben nem tudnank kiszurni magunkat belole, es a sajat
        // autonk MASODIK, "tavoli" autokent jelenne meg -- ami sosem
        // tunne el, mert magunkra nem jon `playerLeft`. Nem elmeleti
        // eset: halozati ingadozas mellett a `snapshot` megelozheti a
        // `joined` uzenetet, es a jitteres teszt pontosan ezt produkalta
        // (2 tavoli auto ket jatekosnal).
        if (!this.playerId) return;

        // A sajat autonkat kiszurjuk: azt lokalisan szimulaljuk, a
        // szerver visszakuldott valtozata csak visszarantana. A frissen
        // kilepett jatekosokat is (lasd recentlyLeft).
        this.snapshotCount++;
        this.lastTick = message.tick;
        const now = performance.now();

        if (message.tracers.length > 0) {
          this.events.onTracers?.(message.tracers);
        }
        if (message.kills.length > 0) {
          this.events.onKills?.(message.kills);
        }

        // A sajat HP-nkat a szerver mondja meg (o donti el a sebzest --
        // terv 15.4), ezert a snapshotbol vesszuk ki, mielott kiszurnenk
        // magunkat belole.
        const own = message.players.find((p) => p.id === this.playerId);
        if (own) {
          // A SEBZES-SZAM a valtozasbol all elo, tehat a regi ertek
          // meg kell ide -- ezert az ertekadas ELOTT.
          this.ownDamageAcc += hpLoss(this.hp, own.hp);
          this.hp = own.hp;
          this.boostGrants = own.boostGrants;
          this.ownWeapon = own.weapon;
          this.ownAbility = own.ability;
          this.ownAbilityActive = own.abilityActive;
          this.ownAbilityCooldownMs = own.abilityCooldownMs;
          this.ownAbilityActiveMs = own.abilityActiveMs;
          this.heat = own.heat;
          this.overheated = own.overheated;
          this.ownProtected = own.protected;
          this.ownHealing = own.healing;
          this.ownKills = own.kills;
          this.ownShotsFired = own.shotsFired;
          this.ownShotsHit = own.shotsHit;
          this.ownCar = own.car;
          this.ownSkin = own.skin;
          this.lives = own.lives;
          this.ownName = own.name;
          // A KEREK-SERULES is a szerveré: nem csak latvany, hanem
          // FIZIKAI hatas is (tapadas, kerek-sugar), ezert a hivo
          // beallitja a sajat jarmuvunkon. SZANDEKOSAN nem
          // interpolaljuk -- a "tort" allapot diszkret.
          this.ownWheels = wheelsFromNetwork(own.grip, own.brokenMask);
        }

        const others = message.players.filter(
          (p) => p.id !== this.playerId && !this.hasRecentlyLeft(p.id, now),
        );
        this.remotes.ingest(others, now);

        // A rakétakat a szerver lepteti; mi pufferelunk es a tavoli
        // autokkal AZONOS kesleltetessel rajzolunk. (Korabban a
        // legfrissebb snapshotbol rajzoltuk azonnal, amitol a lovedek
        // ~100 ms-szal -- 5.5 m-rel -- a celpont elott jart.)
        this.rockets.ingest(message.rockets, now);
        this.pickupsAvailable = message.pickupsAvailable;
        this.match = message.match;
        return;
      }

      case "roomList":
        this.events.onRoomList?.(message.rooms);
        return;

      case "pong": {
        // A `t` a MI orank szerinti kuldesi ido, valtozatlanul vissza --
        // a kulonbseg tehat tiszta oda-vissza ut, ora-szinkron nelkul.
        const rtt = performance.now() - message.t;
        // Exponencialis simitas: egyetlen kiugro csomag ne ugraltassa a
        // kijelzest, de a tartos valtozast azert kovesse.
        this.rttMs = this.rttMs === null ? rtt : this.rttMs * 0.7 + rtt * 0.3;
        return;
      }

      case "playerJoined":
        this.events.onPlayerJoined?.(
          message.playerId,
          message.car,
          message.skin,
        );
        return;

      case "explosion":
        // A sebzest a szerver mar alkalmazta; ez a latvanyert es a
        // fizikai lokesert jon (a lokest mi szamoljuk a sajat autonkra).
        this.events.onExplosion?.(message.position, message.ownerId);
        return;

      case "respawn":
        // A szerver megmondja, hova szuletunk ujra -- a sajat autonkat
        // csak mi tudjuk athelyezni (hibrid modell, terv 15.4).
        // Megszulettunk: a terv betoltott, mar nincs mire varni.
        this.pendingSpawn = null;
        this.pendingSpawnIndex = null;
        this.spawnOptions = [];
        this.events.onRespawn?.(message.position);
        return;

      case "respawnPlan":
        // Hova fogunk szuletni. A halal-kepernyo ide viszi a kamerat,
        // hogy a jatekos MAR A SZULETES ELOTT lassa a helyet es a
        // kornyeken levo ellenfeleket.
        this.pendingSpawn = message.position;
        this.pendingSpawnIndex = message.index;
        this.spawnOptions = message.options;
        return;

      case "playerLeft":
        this.recentlyLeft.set(message.playerId, performance.now());
        this.remotes.remove(message.playerId);
        this.events.onPlayerLeft?.(message.playerId);
        return;

      case "error":
        this.events.onError?.(message.code, message.message);
        return;
    }
  }
}
