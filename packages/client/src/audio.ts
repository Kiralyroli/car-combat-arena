/**
 * Hangok.
 *
 * Valodi felvetelek (lasd CREDITS.md), a bongeszo Web Audio retegen
 * keresztul. A TERBELI keveres nem a Web Audio PannerNode-jabol jon,
 * hanem a kozos audioMix()-bol: igy a szabalyai bongeszo nelkul is
 * merhetok (check:audio), es nem tunnek el egy fekete dobozban.
 *
 * KET DOLOG, amit a bongeszok kikenyszeritenek:
 *
 *  1. Az AudioContext CSAK felhasznaloi gesztus utan indulhat el.
 *     Ezert a jatek nem inditja magatol: az elso kattintasra vagy
 *     billentyure ebred fel (lasd ebreszt).
 *  2. A betoltes aszinkron. A hangoknak NEM szabad feltartaniuk a
 *     jatekot -- ha meg nincsenek kesz (vagy nem toltodtek be), a
 *     lejatszas egyszeruen nem csinal semmit.
 */
import { audioMix, engineTone } from "@cca/shared";

/** A hangok a public/audio alatt vannak, a prepare-audio.ts keszíti oket. */
const HANGOK = {
  motor: "/audio/motor.wav",
  gepfegyver: "/audio/gepfegyver.wav",
  agyu: "/audio/agyu.wav",
  robbanas: "/audio/robbanas.wav",
  tulmelegedes: "/audio/tulmelegedes.wav",
} as const;

export type HangNev = keyof typeof HANGOK;

/** Hangonkenti alapszint -- ez adja a jatekbeli aranyokat. */
const SZINTEK: Record<HangNev, number> = {
  // A motor allandoan szol, tehat halkabban kell, mint az esemenyek:
  // nem tortenes, hanem hatter. Az elso ket hangolas (0.22, majd 0.34)
  // viszont tul halk volt -- alig lehetett hallani, hogy jar az auto.
  // JATEK KOZBEN hangolva, nem elmeletben.
  motor: 0.5,
  // Masodpercenkent 11-szer szolal meg -- egyenkent halkan.
  gepfegyver: 0.3,
  // Ritka es fontos: ez a jatek legnagyobb hangja.
  agyu: 0.85,
  // A robbanas ugyanezen a szinten: a ketto egymas utan szol (loves,
  // majd becsapodas), es a masodiknak nem szabad halkabbnak lennie --
  // az a talalat pillanata.
  robbanas: 0.85,
  // A tulmelegedes halkabb: ez egy ALLAPOT jelzese (a fegyver lefulladt),
  // nem esemeny -- eppen akkor szol, amikor a jatekos mar amugy sem lo,
  // tehat nem kell tulkiabalnia a harcot.
  tulmelegedes: 0.5,
};

/** A hangero a jatekos beallitasa szerint; a kulcs a localStorage-ben. */
const TAROLO_KULCS = "cca-hang";

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private pufferek = new Map<HangNev, AudioBuffer>();
  private motorok = new Map<string, MotorHang>();
  private bekapcsolva = true;
  private ebredesreVar = true;
  /**
   * Hany egyszeri hang indult el eddig.
   *
   * MONOTON szamlalo, nem pillanatnyi allapot: egy loves hangja par
   * szaz ms alatt lecseng, tehat egy kesobbi mintavetel mar semmit nem
   * latna belole. (Ugyanez a csapda a robbanas-effekteknel is megvolt.)
   */
  private inditottak = 0;
  /** Ugyanez HANGONKENT -- igy merheto, hogy a robbanas szolt-e, nem csak "valami". */
  private inditottakNev = new Map<HangNev, number>();

  constructor() {
    // A korabbi valasztast megjegyezzuk: aki lehalkitotta, annak ne
    // szoljon bele ujra minden ujratoltesnel.
    try {
      const mentett = localStorage.getItem(TAROLO_KULCS);
      if (mentett !== null) this.bekapcsolva = mentett === "be";
    } catch {
      // Privat modban a localStorage dobhat -- a hang ettol meg mehet.
    }
  }

  get enabled(): boolean {
    return this.bekapcsolva;
  }

  /**
   * Felebresztes az elso felhasznaloi gesztusra.
   *
   * A bongeszok tiltjak, hogy egy oldal magatol szolaljon meg. Ez nem
   * megkerulheto es nem is akarjuk megkerulni -- csak azt kell elerni,
   * hogy az elso kattintas UTAN mar szoljon, kulon "engedd meg a hangot"
   * gomb nelkul.
   */
  ebreszt(): void {
    if (!this.ebredesreVar) return;
    this.ebredesreVar = false;
    void this.indit();
  }

  private async indit(): Promise<void> {
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.bekapcsolva ? 1 : 0;
      this.master.connect(this.ctx.destination);
      await this.ctx.resume();
      await this.tolt();
    } catch (hiba) {
      // A hang SOSEM allithatja meg a jatekot. Ha nincs Web Audio (vagy
      // a betoltes elbukik), a tobbi resz valtozatlanul megy tovabb.
      console.warn("A hang nem indult el:", hiba);
      this.ctx = null;
    }
  }

  private async tolt(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all(
      (Object.keys(HANGOK) as HangNev[]).map(async (nev) => {
        try {
          const valasz = await fetch(HANGOK[nev]);
          const adat = await valasz.arrayBuffer();
          this.pufferek.set(nev, await ctx.decodeAudioData(adat));
        } catch (hiba) {
          console.warn("Hang nem toltodott be: " + nev, hiba);
        }
      }),
    );
  }

  setEnabled(be: boolean): void {
    this.bekapcsolva = be;
    if (this.master) this.master.gain.value = be ? 1 : 0;
    try {
      localStorage.setItem(TAROLO_KULCS, be ? "be" : "ki");
    } catch {
      // lasd a konstruktort
    }
  }

  toggle(): boolean {
    this.setEnabled(!this.bekapcsolva);
    return this.bekapcsolva;
  }

  // --- Merheto allapot ---
  //
  // A hangot magat nem lehet automatikusan megitelni, de azt igen, hogy
  // a gepezet mukodik-e: felebredt-e a hangkartya, betoltottek-e a
  // felvetelek, es indul-e toluk hang. E nelkul a jatek NEMAN futna, es
  // semmi nem jelezne (lasd check:sound).

  /** Hany felvetel toltodott be es dekodolodott. */
  get pufferSzam(): number {
    return this.pufferek.size;
  }

  /** Az AudioContext allapota, vagy null, ha meg el sem indult. */
  get ctxAllapot(): string | null {
    return this.ctx?.state ?? null;
  }

  /** Hany egyszeri hang indult eddig -- monoton szamlalo. */
  get inditottHangok(): number {
    return this.inditottak;
  }

  /** Hany hang indult egy adott fajtabol -- szinten monoton. */
  inditottEbbol(nev: HangNev): number {
    return this.inditottakNev.get(nev) ?? 0;
  }

  /** Hany hurkolt motorhang szol eppen. */
  get motorSzam(): number {
    return this.motorok.size;
  }

  /**
   * Egyszeri hang egy vilagbeli pontrol.
   *
   * A hallgato a SAJAT AUTONK -- nem a kamera (lasd audioMix).
   */
  playAt(
    nev: HangNev,
    forras: readonly number[],
    hallgato: readonly number[],
    hallgatoYaw: number,
  ): void {
    const ctx = this.ctx;
    const puffer = this.pufferek.get(nev);
    if (!ctx || !this.master || !puffer) return;

    const { gain, pan } = audioMix(hallgato, hallgatoYaw, forras);
    // A hatotavon kivuli hangokat el sem inditjuk: nyolc jatekosnal
    // percenkent tobb szaz nema forras jonne letre feleslegesen.
    if (gain <= 0) return;

    const source = ctx.createBufferSource();
    source.buffer = puffer;
    const erosito = ctx.createGain();
    erosito.gain.value = gain * SZINTEK[nev];
    source.connect(erosito);
    this.kotPanoramaval(erosito, pan).connect(this.master);
    source.start();
    this.inditottak++;
    this.inditottakNev.set(nev, (this.inditottakNev.get(nev) ?? 0) + 1);
  }

  /**
   * Motorhang egy autohoz (sajat vagy tavoli).
   *
   * Autonkent EGY hurkolt forras el, es azt hangoljuk -- nem inditunk
   * ujat kepkockankent. Egy motor folyamatos hang: ujrainditva
   * darabosan szolna, es a hangolas sem lenne folyamatos.
   */
  updateEngine(
    id: string,
    forras: readonly number[],
    hallgato: readonly number[],
    hallgatoYaw: number,
    speedKmh: number,
    throttle: number,
    topSpeedKmh: number,
  ): void {
    const ctx = this.ctx;
    const puffer = this.pufferek.get("motor");
    if (!ctx || !this.master || !puffer) return;

    const { gain, pan } = audioMix(hallgato, hallgatoYaw, forras);

    // A HALLOTAVON KIVULI autok motorja el sem indul.
    //
    // Egy hurkolt forras akkor is dolgozik, ha nulla hangeron szol: a
    // hangkartya minden mintajat kiszamolja. Nyolc jatekosnal ez nyolc
    // folyamatos, jórészt hallhatatlan hang -- feleslegesen. Igy viszont
    // csak azok szolnak, amiket tenyleg hallani lehet.
    if (gain <= 0) {
      this.stopEngine(id);
      return;
    }

    let motor = this.motorok.get(id);
    if (!motor) {
      motor = new MotorHang(ctx, puffer, this.master);
      this.motorok.set(id, motor);
    }
    const tone = engineTone(speedKmh, throttle, topSpeedKmh);
    motor.allit(tone.rate, gain * tone.gain * SZINTEK.motor, pan);
  }

  /** Egy auto motorjanak leallitasa (kiesett vagy kilepett). */
  stopEngine(id: string): void {
    this.motorok.get(id)?.leallit();
    this.motorok.delete(id);
  }

  /**
   * Panorama, ott is, ahol nincs StereoPannerNode.
   *
   * A regebbi Safari nem ismeri a StereoPannerNode-ot. Olyankor inkabb
   * kozepen szoljon a hang, mint sehogy -- a tavolsag-alapu hangero
   * (ami a lenyegesebb) ettol fuggetlenul mukodik.
   */
  private kotPanoramaval(be: GainNode, pan: number): AudioNode {
    const ctx = this.ctx;
    if (!ctx || typeof ctx.createStereoPanner !== "function") return be;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    be.connect(panner);
    return panner;
  }
}

/**
 * Egyetlen auto hurkolt motorhangja.
 *
 * A valtozasokat SIMITVA visszuk at (setTargetAtTime), nem ugrasszeruen:
 * a hangero es a hangmagassag kepkockankenti atallitasa hallhato
 * kattogast ad, kulonben pedig a halozati snapshotok ugralasa is
 * atszurodne a hangba.
 */
class MotorHang {
  private readonly source: AudioBufferSourceNode;
  private readonly erosito: GainNode;
  private readonly panner: StereoPannerNode | null;
  private readonly ctx: AudioContext;

  constructor(ctx: AudioContext, puffer: AudioBuffer, cel: AudioNode) {
    this.ctx = ctx;
    this.source = ctx.createBufferSource();
    this.source.buffer = puffer;
    this.source.loop = true;
    this.erosito = ctx.createGain();
    this.erosito.gain.value = 0;
    this.source.connect(this.erosito);
    if (typeof ctx.createStereoPanner === "function") {
      this.panner = ctx.createStereoPanner();
      this.erosito.connect(this.panner);
      this.panner.connect(cel);
    } else {
      this.panner = null;
      this.erosito.connect(cel);
    }
    this.source.start();
  }

  allit(rate: number, gain: number, pan: number): void {
    const most = this.ctx.currentTime;
    // 60 ms idoallando: eleg gyors ahhoz, hogy a gazadas azonnalinak
    // erzodjon, es eleg lassu ahhoz, hogy ne kattogjon.
    this.source.playbackRate.setTargetAtTime(rate, most, 0.06);
    this.erosito.gain.setTargetAtTime(gain, most, 0.06);
    this.panner?.pan.setTargetAtTime(pan, most, 0.06);
  }

  leallit(): void {
    try {
      this.erosito.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      this.source.stop(this.ctx.currentTime + 0.3);
    } catch {
      // Mar leallt -- nincs teendo.
    }
  }
}
