"""A jatek autoinak exportalasa a beszerzett GLB-csomagokbol.

MIT CSINAL: harom kulonbozo forras-csomagbol kiszedi a NEGY hasznalt
karosszeriat, mindegyikhez a SAJAT kerekeit, egysegesiti az allasukat
es a meretuket, ritkitja a tul reszletes reszeket, es egyetlen
autok.glb-be exportalja. A skinek texturait kulon WEBP fajlokba menti,
es kiirja a hozzajuk tartozo TypeScript terkepet.

MIERT SZKRIPT, es nem kezi munka:

 1. A csomagokban a jarmuvek EGYMAS MELLETT allnak, tetszoleges
    iranyban es magassagban. A jatek fix konvenciot var (orr -Z fele,
    vizszintesen kozepen, kerekek alja a nulla szinten).
 2. A KEREKEK tobb csomagban egyetlen osszevont haloban vannak (a Jeep
    negy kereke egy 43 000 haromszoges objektum). A jateknak kulon
    kell mind a negy: a felfuggesztes egyenkent mozgatja, es a
    kerek-serules egyenkent szinezi oket.
 3. A csomagok reszletessege a webhez sok (11 500 haromszog EGY
    kerekre). Ritkitas nelkul nyolc jatekos 500 ezer haromszoget
    jelentene.
 4. Egy karosszeriahoz TOBB SKIN tartozik, ugyanazzal a geometriaval.
    A geometriat egyszer visszuk at, a skinek csak texturak -- igy egy
    forma negy valtozata alig kerul tobbe, mint egy.

Ha barmelyik lepes elmarad, a hiba CSENDES: az auto oldalra fordulva,
a talaj alatt, vagy kerek nelkul jelenik meg a jatekban.

Futtatas:
  blender -b --python tools/autok-export.py --
    <csomagok> <autok.glb> <skin-mappa> <carSkins.ts> [--csak Modell]
"""

import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
CSOMAGOK, KIMENET, SKIN_MAPPA, TS_KIMENET = argv[0], argv[1], argv[2], argv[3]
CSAK = None
if "--csak" in argv:
    CSAK = argv[argv.index("--csak") + 1]

# --- A negy hasznalt jarmu ---
#
# A "reszek" a KAROSSZERIAT alkotjak (a jatek egyben cereli oket), a
# "kerek" a gorgo kerekeket. A "potkerek" a karosszeria resze marad: a
# hatso ajton ul, nem forog.
#
# Az anyagnevek a FORRAS-csomagbol valok; ezek kotik ossze a
# jarmureszeket a skinjeikkel.
MODELLEK = {
    "Muscle": {
        "csomag": "low_poly_vehicle_mini_pack_2.glb",
        # PONTOS OBJEKTUMNEVEK, nem elotag: a csomagban minden jarmubol
        # tobb peldany all egymas mellett (skinenkent egy), es a nevek
        # csak a vegukon ternek el. Elotaggal az osszes skin beleesne a
        # valogatasba -- merve: a crossover teste 9 272 helyett 21 190
        # haromszog lett, mert harom peldany kerult egybe.
        # HATTAL all a csomagban (oldalnezeti renderbol ellenorizve).
        "forditva": True,
        "test": ["muscle_body_muscle_0"],
        "kerek": ["muscle_wheel_front_muscle_0", "muscle_wheel_rear_muscle_0"],
        # A skin-nevek RENDERBOL valok: a forras-anyagok neve nem mondja
        # meg, mi latszik (a crossover "body" nevu alapja fekete, nem
        # zold; a Rescue alap-skinje rendorauto, nem mento).
        "skinek": {
            "Sarga": {"body": "muscle"},
            "Feher": {"body": "muscle_white"},
            "Kek": {"body": "muscle_blue"},
            "Piros": {"body": "muscle_red"},
        },
        "szerepek": {"muscle": "body"},
        "budget_test": 6000,
        "budget_kerek": 1200,
    },
    "Jeep": {
        "csomag": "low_poly_vehicle_mini_pack_2.glb",
        # A POTKEREK a hatso ajton ul: a karosszeria resze, nem forog.
        "forditva": True,
        "test": ["suv_body_suv_0", "suv_spare_wheel_suv_0"],
        # A POTKEREK ugyanolyan apro blokkokbol all, mint a gorgo
        # kerekek: tisztitas nelkul a test ritkitasa szilankokka
        # morzsolna (a jatekban szoges csillag logott a kocsi hatan).
        "tisztitando": ["suv_spare_wheel_suv_0"],
        "kerek": ["suv_wheel_suv_0"],
        "skinek": {
            "Fekete": {"body": "material"},
            "Feher": {"body": "suv_white"},
            "Kek": {"body": "suv_blue"},
            "Piros": {"body": "suv_red"},
        },
        "szerepek": {"material": "body"},
        "budget_test": 8000,
        "budget_kerek": 1200,
    },
    "Crossover": {
        "csomag": "low_poly_vehicle_mini_pack_5.glb",
        "forditva": True,
        "test": [
            "modern_suv.050_low_orher_0",
            "modern_suv.050_low_body_0",
            "modern_suv.050_low_gl_0",
        ],
        "kerek": [
            "modern_suv.035_low_orher_0",
            "modern_suv.035_low.001_orher_0",
            "modern_suv.035_low.002_orher_0",
            "modern_suv.035_low.003_orher_0",
        ],
        "skinek": {
            "Fekete": {"body": "body", "other": "orher"},
            "Zold": {"body": "body.004", "other": "orher.002"},
            "Narancs": {"body": "body.001", "other": "orher.004"},
            "Rozsdas": {"body": "body.002", "other": "orher.004"},
            "Terep": {"body": "body.003", "other": "orher.004"},
        },
        "szerepek": {"body": "body", "orher": "other", "material": "glass"},
        "budget_test": 8000,
        "budget_kerek": 1000,
    },
    "Rescue": {
        "csomag": "low_poly_vehicle_mini_pack_4.1.glb",
        "forditva": True,
        # A POTKEREK (car_t_w_br.001) a hatso ajton ul, 1,06 m
        # magasan: a KAROSSZERIA resze, nem gorgo kerek. Elsore
        # kimaradt a listabol, es a jatekban csak a texturaba festett
        # arnyeka latszott a helyen.
        "test": [
            "car_t_body_t.009_0",
            "car_t_other_T.009_0",
            "car_t_window_t.010_0",
            "car_t_light_t.009_0",
            "car_t_w_br.001_other_T.009_0",
        ],
        "tisztitando": ["car_t_w_br.001_other_T.009_0"],
        "kerek": [
            "car_t_w_bl_other_T.009_0",
            "car_t_w_br_other_T.009_0",
            "car_t_w_fl_other_T.009_0",
            "car_t_w_fr_other_T.009_0",
        ],
        "skinek": {
            "Rendor": {"body": "body_t.009", "light": "light_t.009"},
            "Mento": {"body": "body_t.010", "light": "light_t.010"},
            "Szerviz": {"body": "body_t.011", "light": "light_t.011"},
        },
        "szerepek": {
            "body_t.009": "body",
            "other_T.009": "other",
            "window_t.010": "glass",
            "light_t.009": "light",
        },
        "budget_test": 8000,
        "budget_kerek": 1200,
    },
}

# A kerek-nevek a jatek konvencioja szerint (lasd WHEEL_LAYOUT).
KEREK_NEVEK = ["FL", "FR", "RL", "RR"]

# Amit mar kiszedtunk: a kovetkezo csomag importja utan minden mast
# torlunk, hogy a vegen csak a negy jarmu maradjon a jelenetben.
MEGTARTOTT = set()


def tiszta():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def kijelol(objektumok):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objektumok:
        o.select_set(True)
    if objektumok:
        bpy.context.view_layer.objects.active = objektumok[0]


def hatarok(objektumok):
    p = []
    for o in objektumok:
        o.data.calc_loop_triangles()
        for v in o.data.vertices:
            p.append(o.matrix_world @ v.co)
    kicsi = Vector((min(q.x for q in p), min(q.y for q in p), min(q.z for q in p)))
    nagy = Vector((max(q.x for q in p), max(q.y for q in p), max(q.z for q in p)))
    return kicsi, nagy


def haromszog(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


def ritkit(o, budget):
    """Ritkitas a megadott haromszog-keretre.

    A csomagok webhez tul reszletesek. A Decimate a format tartja, csak
    a felesleges felosztast veszi el -- egy 11 500 haromszoges kerek 1
    200-bol is ugyanugy nez ki a jatek tavolsagabol.
    """
    jelen = haromszog(o)
    if jelen <= budget:
        return jelen
    mod = o.modifiers.new(name="ritkit", type="DECIMATE")
    mod.ratio = budget / jelen
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return haromszog(o)


def apro_darabokat_eldob(tagok, mi):
    """A FUTOFELULET apro blokkjait dobja el egy kerekbol.

    MIERT: a csomagok kerekei tobb ezer kulonallo, par haromszoges
    darabbol allnak (a Jeepe 11 794-bol), es ezek adjak a haromszogek
    73-95%-at. A Decimate ezeken nem tud osszevonni -- nincs mit --,
    ezert szilankokka morzsolja oket: a jatekban gumi helyett "szoges
    csillag" latszott.

    CSAK A KULSO PEREMEN dobunk. Elso valtozatban minden apro darabot
    kidobtam, es ezzel a FELNI KULLOI is eltuntek: a jatekos azt latta,
    hogy "ures a kerek belseje". A futofelulet a kerek kulso savjaban
    van, a felni a kozepen -- a sugar alapjan a ketto biztonsagosan
    szetvalaszthato.
    """
    kicsi, nagy = hatarok(tagok)
    kozep = (kicsi + nagy) / 2
    meret = nagy - kicsi
    # A kerek TENGELYE a legvekonyabb irany; a masik ketto a korlap.
    tengely = min(range(3), key=lambda i: meret[i])
    siktengelyek = [i for i in range(3) if i != tengely]
    sugar = max(meret[i] for i in siktengelyek) / 2
    if sugar <= 0:
        return tagok

    def kulso(d):
        k, n = hatarok([d])
        c = (k + n) / 2
        tav = math.hypot(*(c[i] - kozep[i] for i in siktengelyek))
        return tav > 0.78 * sugar

    aprok = [d for d in tagok if haromszog(d) < 40 and kulso(d)]
    maradek = [d for d in tagok if d not in aprok]
    ossz = sum(haromszog(d) for d in tagok)
    maradek_ossz = sum(haromszog(d) for d in maradek)
    # Ha a maradek nem ad ertelmes kereket, inkabb nem nyulunk hozza.
    if not aprok or maradek_ossz < 300:
        return tagok
    for d in aprok:
        bpy.data.objects.remove(d, do_unlink=True)
    megmaradt = sorted((haromszog(d) for d in maradek), reverse=True)[:6]
    print(
        f"[autok] {mi}: {len(aprok)} apro futofelulet-darab eldobva "
        f"({ossz} -> {maradek_ossz} haromszog), legnagyobbak: {megmaradt}"
    )
    return maradek


def kereket_potol(rossz, donor, kozepvonal, mi):
    """Egy elrontott kerek geometriajat a TESTVERE masolatara cereli.

    MIERT KELL: a csomagokban egy-egy kerek mas topologiaval jon --
    a Jeep egyik kereke egyetlen, osszehegesztett halo (10 256
    haromszog), a masik harom viszont kulonallo darabokbol all. A
    hegesztetten a futofelulet-tisztitas nem fog, es a ritkitas
    szilankokka morzsolja: a jatekban tuskes gyuru maradt a kerekbol,
    gumi es felni nelkul.

    Egy autonak amugy is NEGY EGYFORMA kereke van, tehat a testver
    masolata nem kompromisszum, hanem a helyes valasz. A masolat a
    rossz kerek HELYERE kerul, es ha a masik oldalon all, tukrozzuk --
    kulonben a felni kifele fordulna az egyik oldalon.
    """
    rk, rn = hatarok([rossz])
    dk, dn = hatarok([donor])
    rkozep = (rk + rn) / 2
    dkozep = (dk + dn) / 2
    rossz.data = donor.data.copy()
    # Az OLDALT a jarmu kozepvonalahoz kepest nezzuk, nem a vilag
    # origojahoz: a kocsi ilyenkor meg ott all, ahol a csomagban volt
    # (a Jeep kerekei mind pozitiv x-en), tehat az origohoz merve soha
    # nem lenne tukrozes -- a potolt kerek befele nezo oldalaval
    # latszott, felni nelkul.
    tukroz = (rkozep.x < kozepvonal) != (dkozep.x < kozepvonal)
    for v in rossz.data.vertices:
        p = v.co - dkozep
        if tukroz:
            p.x = -p.x
        v.co = rkozep + p
    if tukroz:
        # A tukrozes megforditja a lapok korbejarasat: enelkul a kerek
        # kifordulna (belulrol latszana).
        rossz.data.flip_normals()
    print(f"[autok] {mi}: a kerek geometriaja a testverebol potolva")


def darabokra_bont_es_tisztit(o, mi):
    """Egy objektum apro darabjait dobja el (pl. a POTKEREK).

    A Jeep potkereke a hatso ajton ul, tehat a KAROSSZERIA resze -- a
    karosszeriat viszont ritkitjuk, es a potkerek is tobb ezer apro
    futofelulet-blokkbol all: a ritkitas szilankokka morzsolta, es a
    jatekban egy szoges csillag logott a kocsi hatan (a jatekos
    jelentette). Ugyanaz a tisztitas kell ra, mint a gorgo kerekekre --
    utana mar ritkitas nelkul is belefer a keretbe.
    """
    kijelol([o])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    darabok = [d for d in bpy.context.selected_objects if d.type == "MESH"]
    maradek = apro_darabokat_eldob(darabok, mi)
    kijelol(maradek)
    if len(maradek) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def kerekeket_szetszed(objektumok, nev_elotag):
    """A kerekeket NEGY kulon objektumra bontja.

    MIERT KELL: tobb csomagban egyetlen halo tartalmazza az osszes
    kereket (a Jeep negy kereke egy 43 000 haromszoges objektum). A
    jateknak kulon kell mind a negy: a felfuggesztes egyenkent mozgatja
    oket, es a kerek-serules egyenkent szinezi.

    A szetvalasztas "laza reszek" szerint tortenik, majd a darabokat a
    HELYUK szerint soroljuk a negy kerekhez -- a nevekre nem lehet
    epiteni, mert a szetvalasztas utan mind ugyanazt a nevet kapja.
    """
    kijelol(objektumok)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objektumok:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objektumok[0]
    if len(objektumok) > 1:
        bpy.ops.object.join()
    egyben = bpy.context.view_layer.objects.active

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    darabok = [o for o in bpy.context.selected_objects if o.type == "MESH"]

    # NEGY csoport a VIZSZINTES hely szerint. A Blender Z-fel-fele
    # rendszereben ez az X (bal/jobb) es az Y (elol/hatul) -- a
    # fuggoleges tengely a Z, azt itt nem nezzuk.
    #
    # K-KOZEP, nem felezovonal. Elso valtozatban a min/max felenel
    # vagtam ketté a darabokat: a terepjaronal ettol egy kerek gumija
    # a SZOMSZED kerekhez csuszott at (12 299 / 10 256 / 12 344 / 8 228
    # haromszog negy egyforma kerek helyett), es a jatekban az egyik
    # kerekbol csak a felni maradt. A darabok a NEGY kozeppont KOZUL a
    # legkozelebbihez tartoznak -- ez akkor is jol dont, ha a kerekek
    # nem szimmetrikusan allnak.
    kozepek = {}
    for d in darabok:
        k, n = hatarok([d])
        kozepek[d.name] = (k + n) / 2

    xk = sorted(k.x for k in kozepek.values())
    yk = sorted(k.y for k in kozepek.values())
    # Kiindulas: a negy sarok fele. Innen mar konvergal.
    magok = {
        "FL": Vector((xk[0], yk[-1], 0.0)),
        "FR": Vector((xk[-1], yk[-1], 0.0)),
        "RL": Vector((xk[0], yk[0], 0.0)),
        "RR": Vector((xk[-1], yk[0], 0.0)),
    }

    csoportok = {n: [] for n in KEREK_NEVEK}
    for _ in range(20):
        csoportok = {n: [] for n in KEREK_NEVEK}
        for d in darabok:
            k = kozepek[d.name]
            nev = min(
                KEREK_NEVEK,
                key=lambda n: (k.x - magok[n].x) ** 2 + (k.y - magok[n].y) ** 2,
            )
            csoportok[nev].append(d)
        ujak = {}
        for nev, tagok in csoportok.items():
            if not tagok:
                ujak[nev] = magok[nev]
                continue
            atlag = Vector((0.0, 0.0, 0.0))
            for d in tagok:
                atlag += kozepek[d.name]
            ujak[nev] = atlag / len(tagok)
        if all((ujak[n] - magok[n]).length < 1e-4 for n in KEREK_NEVEK):
            magok = ujak
            break
        magok = ujak

    kerekek = []
    for nev, tagok in csoportok.items():
        if not tagok:
            raise SystemExit(f"[autok] {nev_elotag}: ures {nev} kerek")
        tagok = apro_darabokat_eldob(tagok, f"{nev_elotag} {nev}")
        kijelol(tagok)
        if len(tagok) > 1:
            bpy.ops.object.join()
        o = bpy.context.view_layer.objects.active
        # A vegleges NEV csak az IGAZITAS UTAN dol el (lasd
        # kerekeket_elnevez): a jarmuvek fele hattal all a csomagban, es
        # a megforditas felcsereli a bal es a jobb oldalt.
        o.name = f"{nev_elotag}_wheel_{nev}_ideiglenes"
        kerekek.append(o)

    # NEGY EGYFORMA KEREK.
    #
    # Ha valamelyik kerek geometriaja lenyegesen surubb a tobbinel, az
    # nem reszletesseg, hanem MAS TOPOLOGIA (a Jeep egyik kereke
    # osszehegesztett halo): a tisztitas nem fog rajta, a ritkitas
    # pedig szilankokka morzsolja. Ilyenkor a testvere masolatat
    # hasznaljuk -- a meret egyezeset ellenorizve, mert van auto, ahol
    # az elso es a hatso kerek szandekosan mas (az izomautoe).
    szamok = [haromszog(o) for o in kerekek]
    kozepso = sorted(szamok)[len(szamok) // 2]
    for i, o in enumerate(kerekek):
        if szamok[i] <= 2 * kozepso:
            continue
        k, n = hatarok([o])
        sajat = max((n - k)[j] for j in range(3))
        donor = None
        for j, masik in enumerate(kerekek):
            if j == i or szamok[j] > 2 * kozepso:
                continue
            mk, mn = hatarok([masik])
            if abs(max((mn - mk)[q] for q in range(3)) - sajat) < 0.05 * sajat:
                donor = masik
                break
        if donor is None:
            raise SystemExit(
                f"[autok] {nev_elotag}: a(z) {i}. kerek eltero "
                f"({szamok[i]} haromszog), es nincs hozza illo testver"
            )
        kozepvonal = sum(
            ((hatarok([k])[0] + hatarok([k])[1]) / 2).x for k in kerekek
        ) / len(kerekek)
        kereket_potol(o, donor, kozepvonal, f"{nev_elotag} {i}.")

    # A NEGY KEREK EGYFORMA MERETU -- ha nem, a szetvalasztas rontott.
    #
    # A HAROMSZOGSZAMUK nem feltetlenul egyezik (a Jeep negy kereke a
    # forrasban 8 228 es 12 344 kozott van, mert a futofelulet
    # surusege elter), a MERETUK viszont igen: mind a negy ugyanaz a
    # kerek. Ha az egyikbol kimarad a gumi, a befoglaloja azonnal
    # osszemegy -- ezt a jatekban csak akkor vennenk eszre, amikor mar
    # egy szoges csillag porog a kocsi alatt.
    atmerok = []
    for o in kerekek:
        kicsi, nagy = hatarok([o])
        m = nagy - kicsi
        atmerok.append(max(m.x, m.y, m.z))
    if max(atmerok) - min(atmerok) > 0.1 * max(atmerok):
        raise SystemExit(
            f"[autok] {nev_elotag}: a negy kerek merete elter: "
            + ", ".join(f"{a:.2f} m" for a in atmerok)
        )
    return kerekek


def kerekeket_elnevez(kerekek, nev_elotag):
    """A negy kerek elnevezese a VEGLEGES allasuk szerint.

    A jatek konvencioja: az orr a -Z fele nez, a BAL oldal a -X. A
    Blenderben (Y-up export elott) ez +Y = elore, -X = bal.

    MIERT ITT: a nevet csak az igazitas UTAN szabad kiosztani. A
    csomagokban a jarmuvek fele hattal all, es a megforditas
    felcsereli a bal es a jobb oldalt -- merve: a "FL" nevu kerek a
    kesz modellben a jobb oldalon allt, tehat a kormanyzas es a
    kerek-serules a rossz kereket mozgatta volna.
    """
    kozepek = []
    for o in kerekek:
        k, n = hatarok([o])
        kozepek.append(((k + n) / 2, o))
    x_valaszto = sum(k.x for k, _ in kozepek) / len(kozepek)
    y_valaszto = sum(k.y for k, _ in kozepek) / len(kozepek)

    nevesitett = {}
    for k, o in kozepek:
        nev = ("F" if k.y > y_valaszto else "R") + ("L" if k.x < x_valaszto else "R")
        o.name = f"{nev_elotag}_wheel_{nev}"
        nevesitett[nev] = o
    hianyzo = [n for n in KEREK_NEVEK if n not in nevesitett]
    if hianyzo:
        raise SystemExit(f"[autok] {nev_elotag}: hianyzo kerek: {hianyzo}")
    return nevesitett


def tomorre(anyag, mi):
    """A KAROSSZERIAT tomorre allitja (nem atlatszo).

    MIERT KELL: a pack-2 ket jarmuve EGYETLEN anyagot hasznal az egesz
    kocsira (az ablakokkal egyutt), es ez az anyag atlatszora van
    allitva -- a Jeepe raadasul "transmission"-re, vagyis uvegre. A
    jatekban ettol a karosszeria felig atlatszo lett, es a melysegiras
    hianyaban egesz elemek tuntek el a kocsirol (a jatekos jelentette).

    Az atlatszosag HAROM helyrol johet, es mindharmat le kell venni: az
    anyag alfa-bemenetérol, a transmission-rol es a renderelesi
    modjarol. Az UVEGET es a LAMPAKAT nem erinti -- azoknak sajat
    szerepuk van, es ott az atlatszosag helyes.
    """
    if not anyag.use_nodes:
        return
    bsdf = next(
        (n for n in anyag.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None
    )
    if bsdf is not None:
        for nev, ertek in (("Alpha", 1.0), ("Transmission Weight", 0.0)):
            be = bsdf.inputs.get(nev)
            if be is None:
                continue
            for link in list(be.links):
                anyag.node_tree.links.remove(link)
            be.default_value = ertek
    # A renderelesi mod neve verziofuggo: ami van, azt allitjuk.
    if hasattr(anyag, "surface_render_method"):
        anyag.surface_render_method = "DITHERED"
    if hasattr(anyag, "blend_method"):
        anyag.blend_method = "OPAQUE"
    print(f"[autok] {mi}: tomorre allitva (nem atlatszo)")


def alap_szin_kep(anyag):
    """Egy anyag alapszin-texturaja (vagy None)."""
    if not anyag or not anyag.node_tree:
        return None
    bsdf = next(
        (n for n in anyag.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None
    )
    if bsdf is None:
        return None
    be = bsdf.inputs["Base Color"]
    if not be.links:
        return None
    csomo = be.links[0].from_node
    while csomo and csomo.type != "TEX_IMAGE":
        # Sketchfab neha kever egy szorzot koze; kovessuk vissza.
        kovetkezo = None
        for b in csomo.inputs:
            if b.links:
                kovetkezo = b.links[0].from_node
                break
        csomo = kovetkezo
    return csomo.image if csomo and csomo.type == "TEX_IMAGE" else None


def alapnev(nev):
    """A Blender ".001" utotagja nelkuli nev.

    A csomagokat egymas utan importaljuk, es az azonos nevu anyagok
    utotagot kapnak ("material" -> "material.001"). A szerepeket az
    EREDETI nevekhez kotottuk, tehat az utotagot le kell vagni --
    kulonben a crossover uvege "body" szerepet kapna, es a skin-csere a
    szelvedot festene at.
    """
    resz = nev.rsplit(".", 1)
    if len(resz) == 2 and resz[1].isdigit():
        return resz[0]
    return nev


def lapit():
    """A frissen importalt objektumok VILAG-terbe lapitasa.

    MIERT KELL: a glTF-import szulo-hierarchiat epit (gyoker-node,
    forgatas, meretezes), es a jarmureszek KULONBOZO szulok alatt
    lehetnek. Ha ilyenkor a helyuket kozos eltolassal igazitjuk, a
    relativ helyzetuk elromlik -- merve: a Muscle kerekei elvaltak a
    kocsitol, es a levegoben lebegtek mellette.

    Szulok nelkul, alkalmazott transzformmal minden objektum ugyanabban
    a rendszerben all, es a kesobbi lepesek (osszevonas, szetszedes,
    eltolas) egyertelmuek.
    """
    # CSAK a most importalt objektumok: a mar kesz jarmuveket nem
    # szabad ujra lapitani. A transform_apply beegetne a kerekek
    # helyet a csucsokba, es nullazna az origojukat -- merve: negybol
    # haromnal a kerek-origok visszaugrottak a modell kozeppontjaba,
    # es csak az utolso jarmu maradt jo.
    meshek = [o for o in bpy.data.objects if o.type == "MESH" and o not in MEGTARTOTT]
    if not meshek:
        return
    kijelol(meshek)
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    # Tobb objektum osztozhat egy halon: az applikalas azon elhasalna.
    bpy.ops.object.make_single_user(object=True, obdata=True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # A szulo-uresek (Empty) mar nem kellenek.
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)


def objektumok_nev(nevek, mi):
    """A megadott NEVU mesh-ek -- pontos egyezessel.

    Elotaggal nem lehet: a csomagban minden jarmubol tobb peldany all
    egymas mellett (skinenkent egy), es a nevek csak a vegukon ternek
    el. Ha valamelyik hianyzik, HANGOSAN elszallunk: egy csendben
    kimaradt kerek vagy karosszeria-resz a jatekban csak akkor tunne
    fel, amikor a kocsi mar hianyosan gurul.
    """
    talalt = []
    for nev in nevek:
        o = bpy.data.objects.get(nev)
        if o is None or o.type != "MESH":
            raise SystemExit(f"[autok] {mi}: nincs ilyen objektum: {nev}")
        talalt.append(o)
    return talalt


def tetopont_y(objektumok):
    """A legmagasabb pont Y-koordinataja -- a forditas ellenorzesehez."""
    legjobb = None
    for o in objektumok:
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            if legjobb is None or p.z > legjobb[0]:
                legjobb = (p.z, p.y)
    return legjobb[1]


def igazit(objektumok, forditva, kerekek):
    """Az orr -Z fele (a jatek iranya), vizszintesen kozepen, talpon.

    A forras-csomagokban a jarmuvek egy sorban allnak, tetszoleges
    iranyban. A jatek fix konvenciot var: az orr a -Z fele nez (ez a
    Blender +Y-jabol lesz, mert az export Y-up-ra valt), a kerekek alja
    a nulla szinten van, es a kocsi vizszintesen kozepen all.

    A CSUCSOKAT mozgatjuk, nem az objektum-transzformot: a
    transform_apply operator csendben hatastalan maradt (merve: a
    "forditas" utan a teto Y-koordinataja valtozatlanul -2.38 volt),
    es egy nem forditott kocsi a jatekban hatrafele szaguldana.
    """

    def mind(fuggveny):
        for o in objektumok:
            for v in o.data.vertices:
                v.co = fuggveny(v.co)

    kicsi, nagy = hatarok(objektumok)
    meret = nagy - kicsi
    # A HOSSZABB vizszintes oldal legyen az Y tengelyen.
    if meret.x > meret.y:
        mind(lambda c: Vector((-c.y, c.x, c.z)))
        kicsi, nagy = hatarok(objektumok)

    if forditva:
        # Fel fordulat a fuggoleges tengely korul.
        mind(lambda c: Vector((-c.x, -c.y, c.z)))
        kicsi, nagy = hatarok(objektumok)

    kozep = (kicsi + nagy) / 2
    # A TALAJSZINT a KEREKEK alja, nem a legalso pont: az izomautonal a
    # kuszob es a legterelo 5 cm-rel a kerekek ala nyulik, es ha ahhoz
    # igazitanank, a kocsi a kerekei helyett a hasan allna -- a kerekek
    # a levegoben logtak volna.
    kerek_kicsi, _ = hatarok(kerekek)
    also = kerek_kicsi.z
    mind(lambda c: Vector((c.x - kozep.x, c.y - kozep.y, c.z - also)))


def modell_feldolgoz(modell, beallitas):
    """Egy jarmu kiszedese, ritkitasa es elnevezese."""
    forras = os.path.join(CSOMAGOK, beallitas["csomag"])
    bpy.ops.import_scene.gltf(filepath=forras)
    lapit()

    testreszek = objektumok_nev(beallitas["test"], f"{modell} test")
    tisztitando = set(beallitas.get("tisztitando", []))
    if tisztitando:
        testreszek = [
            darabokra_bont_es_tisztit(o, f"{modell} {o.name}")
            if o.name in tisztitando
            else o
            for o in testreszek
        ]
    kerekreszek = objektumok_nev(beallitas["kerek"], f"{modell} kerek")

    # A SKIN-texturakat meg az importalt anyagokrol szedjuk le, mielott
    # a felesleges peldanyokat kidobjuk.
    print("[autok] anyagok a csomagban:", sorted(m.name for m in bpy.data.materials))
    skin_kepek = {}
    for skin, szerepek in beallitas["skinek"].items():
        skin_kepek[skin] = {}
        for szerep, anyagnev in szerepek.items():
            anyag = bpy.data.materials.get(anyagnev)
            if anyag is None:
                # A masodik importbol jott: ".001" utotaggal all bent.
                anyag = next(
                    (m for m in bpy.data.materials if alapnev(m.name) == anyagnev),
                    None,
                )
            kep = alap_szin_kep(anyag)
            if kep is None:
                print(f"[autok] {modell}/{skin}: nincs kep ehhez: {anyagnev}")
                continue
            skin_kepek[skin][szerep] = kep

    kerekek = kerekeket_szetszed(kerekreszek, modell)

    # A KAROSSZERIA egyetlen objektum, tobb anyag-hellyel: a jatek
    # egyben cereli (lasd swapBody).
    kijelol(testreszek)
    if len(testreszek) > 1:
        bpy.ops.object.join()
    test = bpy.context.view_layer.objects.active
    test.name = modell

    # RITKITAS. A kis reszeket (uveg, lampa) nem bantjuk: azok
    # egyebkent is olcsok, es a ritkitas eppen rajtuk latszik.
    ossz = haromszog(test)
    if ossz > beallitas["budget_test"]:
        uj = ritkit(test, beallitas["budget_test"])
        print(f"[autok] {modell}: test {ossz} -> {uj} haromszog")
    for o in kerekek:
        elotte = haromszog(o)
        utana = ritkit(o, beallitas["budget_kerek"])
        if elotte != utana:
            print(f"[autok] {modell}: kerek {elotte} -> {utana} haromszog")

    igazit([test] + kerekek, beallitas.get("forditva", False), kerekek)
    # A kerekek NEVE csak most dol el: a megforditas felcsereli a bal
    # es a jobb oldalt.
    kerekek = kerekeket_elnevez(kerekek, modell)

    # Az ANYAGOK neve a SZEREPUKET mondja meg: ebbol tudja a jatek,
    # melyik skin-texturat hova kell tenni.
    #
    # MINDEN modell SAJAT MASOLATOT kap az anyagbol. Ket jarmu ugyanis
    # osztozhat egy forras-anyagon (a pack-2-ben a Jeep es a Muscle is
    # a "material" nevut hasznalja), es akkor az atnevezes a masikat is
    # elviszi -- merve: a Jeep karosszeriaja "Jeep_wheel" nevu anyagot
    # kapott, a crossover uvege pedig "material.001"-et.
    masolatok = {}

    def sajat_anyag(anyag):
        if anyag is None:
            return None
        if anyag.name in masolatok:
            return masolatok[anyag.name]
        # ELOSZOR a teljes nevvel: a Rescue anyagai maguk is szamra
        # vegzodnek ("body_t.009"), tehat a levagas ott ROSSZ valaszt
        # adna -- merve: mind a negy resze "body" szerepet kapott.
        szerep = beallitas["szerepek"].get(anyag.name)
        if szerep is None:
            szerep = beallitas["szerepek"].get(alapnev(anyag.name), "body")
        uj = anyag.copy()
        uj.name = f"{modell}_{szerep}"
        if szerep in ("body", "other"):
            tomorre(uj, f"{modell}_{szerep}")
        masolatok[anyag.name] = uj
        return uj

    for o in [test, *kerekek.values()]:
        for i, anyag in enumerate(list(o.data.materials)):
            o.data.materials[i] = sajat_anyag(anyag)

    # Ami ebbol a csomagbol nem kell (a tobbi skin peldanya, a talaj, a
    # masik jarmu), az mehet.
    #
    # A MOST ELO listat jarjuk be, nem az importalaskor felvettet: a
    # kerek-szetszedes kozben objektumok szunnek meg (az osszevonas
    # felemeszti oket), es egy megszunt objektumra hivatkozva a Blender
    # kivetelt dob ("StructRNA ... has been removed").
    # A KEREK ORIGOJA a sajat kozeppontjaba kerul.
    #
    # A csucsok az igazitas utan a jarmu rendszereben allnak, az
    # objektum origoja viszont a modell origojaban maradna. A jatek a
    # kerekeket FORGATJA (gordules, kormanyzas) es fuggolegesen mozgatja
    # (rugozas) -- mindketto az origo korul tortenik. Kozepre allitott
    # origo nelkul a kerek nem a helyen porogne, hanem korpalyan
    # keringene az auto kozeppontja korul.
    for o in kerekek.values():
        kicsi, nagy = hatarok([o])
        kozep = (kicsi + nagy) / 2
        # KEZZEL, nem az origin_set operatorral: azzal a kesz GLB-ben a
        # kerekek 4-5 cm-rel feljebb kerultek, mint a Blenderben (a
        # csucsok es az origo kulon-kulon jok voltak, egyutt megsem) --
        # a kocsi igy a levegoben allt volna. Igy a szamitas
        # atlathato: a csucsokat a kozeppontjukhoz visszuk, az
        # objektum helye pedig maga a kozeppont.
        for v in o.data.vertices:
            v.co -= kozep
        o.location = kozep

    MEGTARTOTT.add(test)
    MEGTARTOTT.update(kerekek.values())
    for o in list(bpy.data.objects):
        if o not in MEGTARTOTT:
            bpy.data.objects.remove(o, do_unlink=True)

    kicsi, nagy = hatarok([test] + list(kerekek.values()))
    meret = nagy - kicsi
    print(
        f"[autok] {modell}: {meret.x:.2f} x {meret.y:.2f} x {meret.z:.2f} m, "
        f"test {haromszog(test)} + kerek {sum(haromszog(o) for o in kerekek.values())} haromszog"
    )
    return skin_kepek


def skinek_mentese(minden_skin):
    """A skin-texturak WEBP-be, es a hozzajuk tarozo TS terkep."""
    os.makedirs(SKIN_MAPPA, exist_ok=True)
    sorok = []
    for modell in sorted(minden_skin):
        skinek = minden_skin[modell]
        bejegyzesek = []
        for skin in skinek:
            szerepek = []
            for szerep, kep in skinek[skin].items():
                fajl = f"{modell}_{skin}_{szerep}.webp".lower()
                masolat = kep.copy()
                # 512 eleg: a kocsi a jatekban nehany meterre latszik.
                if masolat.size[0] > 512:
                    masolat.scale(512, 512)
                # A KAROSSZERIA texturaja NE vigyen alfat.
                #
                # A forras-kepekben van alfa-csatorna. Az anyag ugyan
                # mar tomor (lasd tomorre), de egy alfas kep barmikor
                # visszahozhatja az atlatszosagot -- es kisebb is a
                # fajl nelkule. A LAMPAK es az UVEG maradnak alfasan:
                # ott az atlatszosag a lenyeg.
                #
                # Minden keppont alfaja EGY lesz. A Blender a WEBP-be
                # igy is beir egy alfa-csatornat (par tized kB), de az
                # vegig atlatszatlan -- tehat semmi nem tud tole
                # kilyukadni.
                if szerep in ("body", "other"):
                    tomor = bpy.data.images.new(
                        f"{fajl}_rgb",
                        masolat.size[0],
                        masolat.size[1],
                        alpha=False,
                    )
                    puffer = np.empty(len(masolat.pixels), dtype=np.float32)
                    masolat.pixels.foreach_get(puffer)
                    puffer[3::4] = 1.0
                    tomor.pixels.foreach_set(puffer)
                    bpy.data.images.remove(masolat)
                    masolat = tomor
                    masolat.alpha_mode = "NONE"
                masolat.file_format = "WEBP"
                masolat.filepath_raw = os.path.join(SKIN_MAPPA, fajl)
                masolat.save()
                szerepek.append(f'{szerep}: "{fajl}"')
                bpy.data.images.remove(masolat)
            bejegyzesek.append(f'    {skin}: {{ {", ".join(szerepek)} }},')
        sorok.append(f"  {modell}: {{\n" + "\n".join(bejegyzesek) + "\n  },")

    # A TERKEPET a szkript irja ki, nem kezzel masoljuk at: a fajlnevek
    # a modell- es skin-nevekbol allnak ossze, es egy elgepeles CSENDES
    # hiba lenne -- a jatek a hianyzo textura helyett az alap-skint
    # mutatna, es a jatekos nem azt latna, amit valasztott.
    fejlec = [
        "/**",
        " * A skinek texturai -- GENERALT FAJL, ne szerkeszd kezzel.",
        " *",
        " * A tools/autok-export.py allitja elo a forras-csomagokbol",
        " * (npm run autok-export). Minden bejegyzes azt mondja meg, hogy egy",
        " * skin melyik ANYAG-SZEREPRE melyik texturat teszi: a modell anyagai",
        " * a szerepuk szerint vannak elnevezve (pl. Rescue_body,",
        " * Rescue_light), es a skin-valtas ezeket cereli ki.",
        " *",
        " * A GEOMETRIA KOZOS a skinek kozott: egy forma negy valtozata ezert",
        " * alig kerul tobbe, mint egy.",
        " */",
        "",
        "/** A skin-texturak konyvtara a kliensben. */",
        'export const SKIN_URL = "/models/skins/";',
        "",
        "/** Egy skin: anyag-szerep -> textura-fajl. */",
        "export type SkinTexturak = Partial<",
        '  Record<"body" | "other" | "glass" | "light", string>',
        ">;",
        "",
        "export const CAR_SKIN_TEXTURES: Record<",
        "  string,",
        "  Record<string, SkinTexturak>",
        "> = {",
    ]
    tartalom = "\n".join(fejlec) + "\n" + "\n".join(sorok) + "\n};\n"
    with open(TS_KIMENET, "w", encoding="utf-8") as f:
        f.write(tartalom)
    print(f"[autok] skin-terkep -> {TS_KIMENET}")
    return sorok


def main():
    tiszta()
    minden_skin = {}
    for modell, beallitas in MODELLEK.items():
        if CSAK and modell != CSAK:
            continue
        minden_skin[modell] = modell_feldolgoz(modell, beallitas)

    skinek_mentese(minden_skin)

    for o in bpy.data.objects:
        if o.type == "MESH" and "_wheel_FL" in o.name:
            k, n = hatarok([o])
            print(
                f"[debug] {o.name}: loc={tuple(round(x,3) for x in o.location)}"
                f" scale={tuple(round(x,3) for x in o.scale)}"
                f" rot={tuple(round(x,3) for x in o.rotation_euler)}"
                f" vilag alja={k.z:.3f} teteje={n.z:.3f}"
                f" lokal alja={min(v.co.z for v in o.data.vertices):.3f}"
            )

    # A GLB-be agyazott texturak 512-re. A csomagok 1024-esek (az
    # eredetiben 4096-osak voltak), es a modellhez normal- meg
    # AO-terkep is tartozik -- 1024-en ez negy jarmure 4,2 MB, amit egy
    # webes jatek indulaskor nem tolthet le. A kocsi a jatekban nehany
    # meterre latszik: 512-en nem lehet kulonbseget latni.
    for kep in bpy.data.images:
        if kep.size[0] > 512:
            kep.scale(512, 512)

    bpy.ops.export_scene.gltf(
        filepath=KIMENET,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_image_format="WEBP",
        export_image_quality=80,
    )
    print(f"[autok] kesz: {KIMENET}")


main()
