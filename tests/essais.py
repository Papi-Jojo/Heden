"""Essais de bout en bout de Heden (navigateur réel, faux Supabase, hors ligne).

    npm run build && python tests/essais.py          # tous
    python tests/essais.py synchro groupe            # quelques-uns

Lancés par le workflow « Site » avant chaque mise en ligne : un échec bloque le déploiement.
"""
import json, os, sys, time, traceback, urllib.parse
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from outils import B, Essai, demarrer, sync_playwright

ESSAIS = []
essai = lambda f: ESSAIS.append(f) or f
DBQ = "JSON.parse(localStorage.getItem('__mockdb2') || '{}')"


@essai
def demarrage(pw):
    for larg, langue, attendu in ((390, "fr", "Carte"), (1280, "en", "Map")):
        e = Essai(pw, larg, 860, langue); pg = e.page()
        for t in ("annonces", "profile", "map"): e.onglet(pg, t)
        onglets = pg.locator(".tabbar [data-tab='map']" if larg < 900 else ".tabs [data-tab='map']").inner_text()
        assert attendu in onglets, f"onglet carte : {onglets!r}"
        assert not e.erreurs, e.erreurs
        e.fermer()


@essai
def zone(pw):
    e = Essai(pw); pg = e.page()
    e.zone(pg, "Abbesses")
    assert "Abbesses" in " ".join(pg.locator(".zrow").all_inner_texts()), "zone absente de la liste"
    assert "1 zone" in pg.locator(".panel__head h2").inner_text()
    assert not e.erreurs, e.erreurs; e.fermer()


@essai
def lieux(pw):
    e = Essai(pw); pg = e.page()
    pg.click("#pickZone"); pg.wait_for_timeout(500)
    assert pg.locator("#lieux [data-arr]").count() == 20
    pg.click("#lieux [data-arr='18']"); pg.wait_for_timeout(300)
    pg.locator("#lieux [data-i]").first.click(); pg.wait_for_timeout(800)
    n = pg.evaluate("document.querySelectorAll('.leaflet-marker-icon').length")
    assert pg.evaluate("document.body.dataset.mode") == "placing" and n >= 3, f"zone proposée : mode {pg.evaluate('document.body.dataset.mode')}, {n} points"
    assert not e.erreurs, e.erreurs; e.fermer()


@essai
def groupe(pw):
    e = Essai(pw); J = e.page()
    e.connexion(J, "johan@x.fr", "Johan"); e.onglet(J, "map"); e.zone(J, "Abbesses")
    e.onglet(J, "profile"); J.fill("#newMapName", "Notre recherche"); J.click("#newMapForm button"); J.wait_for_timeout(800)
    code = J.locator(".invite__code").inner_text().strip()
    # Léa suit le lien d'invitation : la fenêtre de connexion s'ouvre d'elle-même
    L = e.page(B + "?rejoindre=" + code)
    L.fill("#loginMail", "lea@x.fr"); L.click("#mailForm button[type=submit]"); L.wait_for_timeout(200)
    L.fill("#loginCode", "123456"); L.wait_for_timeout(3500)
    db = L.evaluate(DBQ)
    shared = next(m["id"] for m in db["maps"] if m["kind"] == "partagee")
    assert any(x["map_id"] == shared and x["user_id"].startswith("3333") for x in db["map_members"]), "Léa n'a pas rejoint"
    assert L.evaluate("__heden.cloud().mapId") == shared, "Léa n'est pas sur la carte commune"
    assert not e.erreurs, e.erreurs; e.fermer()


@essai
def apporter_ses_zones(pw):
    e = Essai(pw); J = e.page()
    e.connexion(J, "johan@x.fr", "Johan"); e.onglet(J, "profile"); J.fill("#newMapName", "Notre recherche"); J.click("#newMapForm button"); J.wait_for_timeout(800)
    code = J.locator(".invite__code").inner_text().strip()
    M = e.page(); e.connexion(M, "max@x.fr", "Max"); e.onglet(M, "map"); e.zone(M, "Bastille", 48.855, 2.37)
    e.onglet(M, "profile"); M.click("[data-ptab='compte']"); M.wait_for_timeout(200)
    M.fill("#joinCode", code); M.click("#joinForm button"); M.wait_for_timeout(2500)
    assert "votre zone" in M.locator(".ask h2").inner_text(), "pas de proposition d'apporter ses zones"
    M.locator(".ask [data-yes]").click(); M.wait_for_timeout(2000)
    db = M.evaluate(DBQ); shared = next(m["id"] for m in db["maps"] if m["kind"] == "partagee")
    assert [z["name"] for z in db["zones"] if z["map_id"] == shared] == ["Bastille"], db["zones"]
    assert not e.erreurs, e.erreurs; e.fermer()


def importer(pg, d):
    pg.goto(B + "?importer=1#import=" + urllib.parse.quote(json.dumps(d))); pg.wait_for_timeout(2600)


@essai
def annonces(pw):
    e = Essai(pw); pg = e.page()
    importer(pg, {"v": 4, "url": "https://ex.fr/annonce-viager-1.htm", "title": "Viager occupé 3 pièces 65 m² Paris 15e", "meta": {}, "ld": [], "imgs": [],
                  "text": "Viager occupé, 3 pièces de 65 m², Paris 15ème. Bouquet de 180 000 € et rente mensuelle de 1 150 €."})
    pg.locator("#lsave").click(); pg.wait_for_timeout(800)
    f = pg.evaluate("__heden.state().listings[0]")
    assert (f["viager"], f["price"], f["rente"]) == ("occupe", 180000, 1150), f
    importer(pg, {"v": 4, "url": "https://ex.fr/annonce-2.htm", "title": "2 pièces 45 m² Paris 7e", "meta": {}, "ld": [], "imgs": [],
                  "text": "Vente 2 pièces 45 m² Paris 7ème, 590 000 €. Je suis actuellement à l'étranger, les clés vous seront envoyées par la poste. Home staging virtuel."})
    pg.locator("#lsave").click(); pg.wait_for_timeout(800)
    s = pg.evaluate("__heden.state().listings.find(f => f.url.includes('annonce-2'))")
    assert "clés envoyées par la poste" in s["scam"] and s["aiPhoto"] == ["home staging virtuel"], s
    cards = [{"url": f"https://ex.fr/annonce-l{i}.htm", "img": f"https://img.ex.fr/{i}-a.jpg", "imgs": [f"https://img.ex.fr/{i}-{k}.jpg" for k in "abc"],
              "text": f"{2 + i % 3} pièces {40 + i * 5} m² {'Paris 17ème' if i % 2 else '18e arrondissement'} {500000 + i * 20000} €"} for i in range(4)]
    importer(pg, {"v": 4, "url": "https://ex.fr/liste?page=1", "title": "Résultats", "meta": {}, "ld": [], "imgs": [], "text": "", "items": cards})
    pg.click("#bgo"); pg.wait_for_timeout(7000)
    lot = pg.evaluate("__heden.state().listings.filter(f => /annonce-l/.test(f.url)).map(f => [f.postcode, !!f.lat, (f.photos || []).length])")
    assert len(lot) == 4 and all(x[1] and x[2] == 3 for x in lot), lot
    assert not e.erreurs, e.erreurs; e.fermer()


@essai
def synchro(pw):
    """Deux appareils du même compte modifient la même annonce : aucun des deux changements n'est perdu."""
    e = Essai(pw); A = e.page(); e.connexion(A, "johan@x.fr", "Johan")
    A.evaluate("() => { const s = __heden.state(); s.listings = s.listings || []; s.listings.push({id: crypto.randomUUID(), title: '3 pièces', price: 590000, surface: 60, rooms: 3, postcode: '75011', status: 'nouvelle', mapId: __heden.cloud().mapId, createdBy: __heden.cloud().user.id, addedAt: Date.now(), firstSeen: Date.now()}); __heden.save(); }")
    A.wait_for_timeout(2000)
    P = e.page(); e.connexion(P, "johan@x.fr", "Johan"); P.wait_for_timeout(1500)
    A.evaluate("() => { __heden.state().listings[0].status = 'gardee'; __heden.save(); }"); A.wait_for_timeout(2000)
    P.evaluate("() => { __heden.state().listings[0].note = 'Belle lumière'; __heden.save(); }"); P.wait_for_timeout(2500)
    r = A.evaluate(DBQ + ".listings[0]")
    assert r["status"] == "gardee" and r["data"].get("note") == "Belle lumière", r
    A.evaluate("() => { __heden.state().listings.splice(0, 1); __heden.save(); }"); A.wait_for_timeout(2000)
    P.evaluate("() => { __heden.state().listings[0].note = 'encore'; __heden.save(); }"); P.wait_for_timeout(2500)
    assert A.evaluate(DBQ + ".listings.length") == 0, "une annonce supprimée ailleurs est revenue"
    assert not e.erreurs, e.erreurs; e.fermer()


@essai
def import_reserve_au_bouton(pw):
    e = Essai(pw); pg = e.page()
    pg.evaluate("() => window.postMessage({type: 'heden-import', data: {url: 'https://ex.fr/a.htm', text: 'Vente 3 pièces 60 m² Paris 11e 590 000 €'}}, '*')"); pg.wait_for_timeout(1500)
    assert not pg.locator("#lsTitle").count(), "une page quelconque a pu envoyer une annonce"
    e.fermer()


@essai
def accessibilite(pw):
    for larg, schema in ((390, "light"), (390, "dark"), (1280, "light")):
        e = Essai(pw, larg, 860, color_scheme=schema, reduced_motion="reduce"); pg = e.page()
        for t in ("map", "annonces", "profile"):
            e.onglet(pg, t); v = e.axe(pg)
            assert not v, f"{larg} {schema} {t} : {v}"
        e.fermer()


@essai
def cas_extremes(pw):
    e = Essai(pw, 360, 740); pg = e.page()
    e.zone(pg, "Haut de la rue des Martyrs, entre Pigalle et Notre-Dame-de-Lorette, côté square d’Anvers")
    pg.evaluate("() => { const s = __heden.state(); s.listings = [{id: crypto.randomUUID(), title: 'Magnifique appartement familial entièrement rénové par architecte avec double séjour, quatre chambres, cave, parking et vue dégagée sur tout Paris', price: 12345678, surface: 287, rooms: 9, status: 'nouvelle', addedAt: Date.now(), firstSeen: Date.now()}]; __heden.save(); }")
    for t in ("annonces", "profile", "map"):
        e.onglet(pg, t)
        o = pg.evaluate("() => [...document.querySelectorAll('#app *')].filter(x => { const r = x.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && x.offsetParent && !x.closest('.leaflet-container'); }).map(x => x.className).slice(0, 4)")
        assert not o, f"débordement sur {t} : {o}"
    assert not e.erreurs, e.erreurs; e.fermer()


if __name__ == "__main__":
    voulus = sys.argv[1:]
    srv = demarrer(); echecs = 0
    with sync_playwright() as pw:
        for f in ESSAIS:
            if voulus and f.__name__ not in voulus: continue
            t0 = time.time()
            try: f(pw); print(f"✓ {f.__name__}  ({time.time() - t0:.1f} s)")
            except Exception as err:
                echecs += 1; print(f"✗ {f.__name__} : {err}")
                if os.environ.get("GITHUB_ACTIONS"): print(f"::error title=Essai {f.__name__}::{str(err)[:900]}".replace("\n", " "))
                if not isinstance(err, AssertionError): traceback.print_exc()
    srv.shutdown()
    print("Tout est bon." if not echecs else f"{echecs} essai(s) en échec.")
    sys.exit(1 if echecs else 0)
