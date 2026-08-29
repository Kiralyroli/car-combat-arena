"""A REGI (generic-passenger-car-pack) autok exportalasa -- MEGORZOTT.

Ezt a szkriptet a tiz szedan-jellegu karosszeria exportalasahoz irtuk,
mielott a jatek atallt a low-poly vehicle pack negy jarmuvere. Nincs
mar a lancban (lasd tools/autok-export.py), de a csomag megvan, es ha
valaha vissza kellene hozni valamelyik regi kocsit, ez a lepes nem
kitalalando ujra.

Futtatas:
  blender -b --python tools/regi-autok-export.py -- <fbx> <texturak> <kimenet.glb>
"""

import os
import sys

import bpy
import numpy as np

# A "--" utani argumentumok a mieink.
argv = sys.argv[sys.argv.index("--") + 1 :]
FBX, TEXTURAK, KIMENET = argv[0], argv[1], argv[2]

# A jatekban hasznalt karosszeriak. A csomagban tobb objektum is van
# (kerekek, segedek); csak ezeket visszuk at.
# Ezek a kocsik HATTAL allnak a menetiranynak a kiegyenesites utan.
#
# MIERT LISTA, es nem szamitas: az orr iranyat automatikusan a kabin
# helyzetebol lehetne becsulni (a legmagasabb csucsok a kocsi melyik
# felere esnek), de ez KET esetben biztosan teved. A sportkocsinal a
# kabin HATUL van, a pickupnal pedig ELOL -- mindketto forditva jonne
# ki. Merve: a heurisztika a Sportot es a Pickupot rontotta el.
#
# A lista ezert RENDERBOL szarmazik (oldalnezet, lasd a munkamenetet).
# Ha a csomag frissul, ujra meg kell nezni -- de tiz kocsira ez
# megbizhatobb, mint egy sosem pontos becsles.
FORDITVA = {"Coupe", "Hatchback", "Minivan", "Pickup", "SUV"}

# KOZOS meretezes minden autora.
#
# A kocsik a VALODI aranyaikat tartjak: a pickup hosszabb, a kisauto
# rovidebb -- ahogy a valosagban is. Egy ideig autonkent nyujtottam
# oket egyforma hosszura (hogy egyetlen utkozo doboz mindenkire
# passzoljon), de attol a kisauto magas, nyujtott dobozza valt, a
# pickup pedig osszenyomott lett. A jatek helyette az AUTOK
# MERETEHEZ igazodik.
#
# Ez a szam AZONOS mindegyikre: ha a csomag merete elterne a jatek
# lepteketol, itt lehet egyben allitani.
KOZOS_ARANY = 1.0

AUTOK = [
    "Compact",
    "Coupe",
    "Hatchback",
    "Minivan",
    "Offroad",
    "Pickup",
    "SUV",
    "Sedan",
    "Sport",
    "Wagon",
]


def rgba_kep(kep):
    """A kepet RGBA-va alakitja, ha egycsatornas.

    MIERT KELL: a csomagban van szurkearnyalatos (1 csatornas) PNG, es a
    WEBP-export azon elhasal -- "webp does not support 1-channel images".
    A hiba CSENDES a vegeredmenyben: az adott auto egyszeruen textura
    nelkul, szurken kerul a jatekba. Merve: tizbol az SUV maradt ki.

    A keppontok a memoriaban mindig RGBA float-ok, tehat eleg egy uj,
    alfas kepbe atmasolni oket.
    """
    if kep.depth > 8:
        return kep
    uj = bpy.data.images.new(
        f"{kep.name}_rgba", kep.size[0], kep.size[1], alpha=True
    )
    puffer = np.empty(len(kep.pixels), dtype=np.float32)
    kep.pixels.foreach_get(puffer)
    uj.pixels.foreach_set(puffer)
    print(f"[autok] {kep.name}: egycsatornas volt, RGBA-va alakitva")
    return uj


def igazit(auto, obj):
    """Egysegesiti az auto allasat es a helyet.

    KET dolgot rendez, es mindketto CSENDES hiba lenne:

    1. IRANY. A csomagban a kocsik egy sorban allnak, kulonbozo
       szogben: a Sedan hosszaban Y menten fekszik (helyes), a Coupe
       viszont X menten -- exportalva 4,73 m "szeles" es 2,82 m "hosszu"
       autot adna. A jatek fix meretu utkozo dobozzal szamol, tehat egy
       keresztben allo kocsi eleve rosszul allna benne.

    2. HELY. Vizszintesen kozepre kell kerulnie, FUGGOLEGESEN VISZONT
       NEM: a magassagat a kerekekhez kepest kell megtartani. A jatek
       sajat kerek-modelleket rak ala rogzitett helyre (WHEEL_LAYOUT);
       ha a karosszeriat a talajra ejtenenk, a kerekek kilognanak
       folotte. (Merve: a Sedan karosszeriaja 0,17 m-rel a kerekek
       erintkezesi sikja folott kezdodik.)
    """
    pontok = np.array(
        [(obj.matrix_world @ v.co)[:2] for v in obj.data.vertices], dtype=np.float64
    )

    # A LEGKISEBB TERULETU befoglalo iranya, nem fotengely-illesztes.
    #
    # A csomagban a kocsik tetszoleges szogben allnak (felulnezetbol
    # dolten), nem csak keresztben. Egy 90 fokos igazitas ezt nem
    # rendezi: a Compact 2,99 m "szelesnek" latszott, ami egy kisautotol
    # lehetetlen.
    #
    # Fotengely-illesztessel (PCA) probaltam eloszor, es ROSSZABB lett:
    # a PCA a CSUCSOK SURUSEGET koveti, nem az alakot -- a surun
    # halozott kerekjarat es tetovonal elhuzza az iranyt. Merve: a
    # Compact 3,68 x 2,21 m lett, vagyis keresztbe fordult.
    #
    # A befoglalo terulete viszont az ALAKTOL fugg: a legkisebb
    # teruletu allas az, amelyikben a kocsi "egyenesen" all.
    legjobb_szog = 0.0
    legjobb_terulet = None
    for fok in range(180):
        szog = np.radians(fok)
        c, s = np.cos(szog), np.sin(szog)
        forgatott = pontok @ np.array([[c, -s], [s, c]])
        meret = forgatott.max(axis=0) - forgatott.min(axis=0)
        terulet = meret[0] * meret[1]
        if legjobb_terulet is None or terulet < legjobb_terulet:
            legjobb_terulet = terulet
            legjobb_szog = szog
            legjobb_meret = meret

    # AZ ELOJEL. A meresnel a pontokat forgatjuk (sorvektor * matrix),
    # ami -szog szerinti forgatas; az objektumot tehat ugyanezzel a
    # -szoggel kell forditani. Eloszor +szoggel probaltam, es a kocsik
    # keresztbe fordultak: a Compact 3,69 m "szeles" lett 2,07 m
    # "hossz" mellett.
    alkalmaz = -legjobb_szog

    # A HOSSZABB oldal alljon az Y tengelyen (abbol lesz a jatek
    # hossz-iranya): ha forditva jott ki, meg egy negyed fordulat.
    if legjobb_meret[0] > legjobb_meret[1]:
        alkalmaz += np.pi / 2

    if abs(alkalmaz) > 1e-4:
        obj.rotation_euler = (0.0, 0.0, float(alkalmaz))
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.transform_apply(rotation=True)
        obj.select_set(False)
        print(f"[autok] {auto}: {np.degrees(alkalmaz):.1f} fokkal elforgatva")

    if auto in FORDITVA:
        obj.rotation_euler = (0.0, 0.0, 3.14159265)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.transform_apply(rotation=True)
        obj.select_set(False)
        print(f"[autok] {auto}: hattal allt, megforditva")

    csucsok = [obj.matrix_world @ v.co for v in obj.data.vertices]
    x = [c.x for c in csucsok]
    y = [c.y for c in csucsok]
    # KOZOS meretezes (lasd KOZOS_ARANY) -- autonkent NEM torzitunk.
    if abs(KOZOS_ARANY - 1.0) > 1e-6:
        for v in obj.data.vertices:
            v.co *= KOZOS_ARANY
        csucsok = [obj.matrix_world @ v.co for v in obj.data.vertices]
        x = [c.x for c in csucsok]
        y = [c.y for c in csucsok]

    kozepX = (max(x) + min(x)) / 2
    kozepY = (max(y) + min(y)) / 2
    for v in obj.data.vertices:
        v.co.x -= kozepX
        v.co.y -= kozepY


def tiszta_szin():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def texturak_elotag_szerint():
    """{"Sedan": ".../SedanYellow.png", ...} -- elotag szerinti parositas."""
    talalt = {}
    for fajl in sorted(os.listdir(TEXTURAK)):
        if not fajl.lower().endswith(".png"):
            continue
        alap = os.path.splitext(fajl)[0]
        for auto in AUTOK:
            # A SUV rovidebb, mint a SUVBlack; az elotag-egyezes eleg.
            if alap.startswith(auto):
                # A leghosszabb egyezo elotag nyer: kulonben a "Sport"
                # elvinne a "SportRed"-et is meg mast is.
                elozo = talalt.get(auto)
                if elozo is None:
                    talalt[auto] = os.path.join(TEXTURAK, fajl)
    return talalt


def main():
    tiszta_szin()
    bpy.ops.import_scene.fbx(filepath=FBX)

    kepek = texturak_elotag_szerint()
    hianyzo = [a for a in AUTOK if a not in kepek]
    if hianyzo:
        print(f"[autok] FIGYELEM: nincs textura ehhez: {hianyzo}")

    # Csak a karosszeriakat tartjuk meg, es a nevuket a jatek szerint
    # egysegesitjuk (a csomag nevei valtozhatnak).
    megtartott = {}
    for obj in list(bpy.data.objects):
        if obj.type != "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        nev = obj.name
        auto = None
        for a in AUTOK:
            if nev.lower().startswith(a.lower()):
                auto = a
                break
        if auto is None or auto in megtartott:
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        obj.name = auto
        megtartott[auto] = obj

    print(f"[autok] megtartva: {sorted(megtartott)}")

    # Minden autonak SAJAT anyag, a hozza tartozo texturaval.
    for auto, obj in megtartott.items():
        obj.data.materials.clear()
        mat = bpy.data.materials.new(name=f"Body_{auto}")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        kep_ut = kepek.get(auto)
        if kep_ut:
            tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
            # check_existing: az FBX importja mar betolthette ugyanezt a
            # fajlt. Ujra betoltve "SUVBlack.png.001" nevu masolat jon
            # letre, es a WEBP-re konvertalas azon elhasal -- merve:
            # tizbol kilenc textura ment at, az SUV-e nem.
            tex.image = rgba_kep(bpy.data.images.load(kep_ut, check_existing=True))
            mat.node_tree.links.new(bsdf.inputs["Base Color"], tex.outputs["Color"])
        # A karosszeria fenyes, de nem tukor: a jatek fenyeihez ez all jol.
        bsdf.inputs["Roughness"].default_value = 0.35
        bsdf.inputs["Metallic"].default_value = 0.0
        obj.data.materials.append(mat)

        # A modell TALPON alljon, vizszintesen kozepen -- ugyanaz a
        # konvencio, mint a tobbi modellnel (lasd kit-meret.ts).
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        obj.select_set(False)

    for auto, obj in megtartott.items():
        igazit(auto, obj)

    # WEBP a texturaknak: tiz darab 2048-as PNG tizenegy megabajt lenne,
    # amit egy webes jatek indulaskor nem tolthet le. A karosszeria nagy,
    # egyszinu feluletekbol all, tehat jol tomorodik.
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
