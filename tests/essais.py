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
    assert pg.locator(".zrow").count() == 1, "une zone attendue dans la liste"
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
def zones_pretes(pw):
    """« + Zone » propose des zones prêtes ; la recherche les trouve ; un tracé à la main qui leur ressemble se voit proposer leur forme."""
    e = Essai(pw); pg = e.page()
    pg.evaluate("__heden.map.setView([48.8848, 2.3387], 15, {animate: false})")
    pg.click("#newZone"); pg.wait_for_timeout(600)
    chips = pg.locator("#prets [data-pret]")
    assert chips.count() >= 2, "pas de zone prête proposée au départ du tracé"
    chips.first.click(); pg.wait_for_timeout(600)
    assert pg.evaluate("__heden.state && document.body.dataset.mode") == "placing" and pg.locator(".leaflet-marker-icon").count() >= 3
    pg.click("#cancel"); pg.wait_for_timeout(300)
    if pg.locator(".ask [data-yes]").count(): pg.locator(".ask [data-yes]").click(); pg.wait_for_timeout(300)
    pg.fill("#q", "Batignol"); pg.wait_for_timeout(1500)
    assert pg.locator("#results .res--pret").count() >= 1, "la recherche ne propose pas la zone prête"
    pg.locator("#results .res--pret").first.click(); pg.wait_for_timeout(600)
    assert pg.evaluate("document.body.dataset.mode") == "placing"
    pts = pg.evaluate("(async () => { const r = await fetch('data/lieux.json').then(r => r.json()); return r.arr['18'].find(x => x.k === 'lieu').p; })()")
    pg.click("#cancel"); pg.wait_for_timeout(300)
    if pg.locator(".ask [data-yes]").count(): pg.locator(".ask [data-yes]").click(); pg.wait_for_timeout(300)
    pg.evaluate("p => { __heden.startNew(); p.forEach((q, i) => __heden.addPoint(L.latLng(q[0] + (i % 2 ? 1 : -1) * 1e-4, q[1] + 1e-4))); }", pts); pg.wait_for_timeout(900)
    assert "Utiliser" in pg.locator("#prets").inner_text(), "pas de suggestion pour un tracé qui ressemble à une zone prête"
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
    M.fill("#joinCode", code); M.click("#joinForm button"); M.wait_for_timeout(3500)
    assert not M.locator(".ask").count(), "rejoindre ne doit plus demander : les zones suivent"
    db = M.evaluate(DBQ); shared = next(m["id"] for m in db["maps"] if m["kind"] == "partagee")
    assert [z["name"] for z in db["zones"] if z["map_id"] == shared] == ["Bastille"], db["zones"]
    # de retour sur la carte perso : une nouvelle zone apparaît aussi sur la carte commune, sans rien ressaisir
    perso = M.evaluate("__heden.cloud().personalMapId")
    e.onglet(M, "map"); M.click(f".mapsw [data-map='{perso}']"); M.wait_for_timeout(2500)
    e.zone(M, "Nation", 48.848, 2.396); M.wait_for_timeout(3000)
    db = M.evaluate(DBQ)
    assert sorted(z["name"] for z in db["zones"] if z["map_id"] == shared) == ["Bastille", "Nation"], [z["name"] for z in db["zones"] if z["map_id"] == shared]
    nation = next(z for z in db["zones"] if z["map_id"] == perso and z["name"] == "Nation")
    assert nation.get("link_zone"), "la zone perso n'est pas reliée à sa jumelle"
    # Johan trace sur sa carte perso la même zone que Nation : elle est reliée à celle de la carte commune, pas recopiée
    J.reload(); J.wait_for_timeout(2500)
    jperso = J.evaluate("__heden.cloud().personalMapId")
    assert J.evaluate("__heden.cloud().mapId") == jperso
    e.onglet(J, "map"); e.zone(J, "Nation", 48.848, 2.396); J.wait_for_timeout(3000)
    db = J.evaluate(DBQ); sh = [z for z in db["zones"] if z["map_id"] == shared]
    assert sorted(z["name"] for z in sh) == ["Bastille", "Nation"], [z["name"] for z in sh]
    jn = next(z for z in db["zones"] if z["map_id"] == jperso and z["name"] == "Nation")
    assert jn.get("link_zone") == next(z["id"] for z in sh if z["name"] == "Nation"), jn
    # Max retrace Bastille sur sa carte perso : elle est déjà sur la carte commune, rien n'est recopié
    e.zone(M, "Bastille", 48.855, 2.37); M.wait_for_timeout(3000)
    assert len([z for z in M.evaluate(DBQ)["zones"] if z["map_id"] == shared]) == 2
    assert not e.erreurs, e.erreurs; e.fermer()


@essai
def exclusion_partagee(pw):
    """Sur une carte de groupe, un membre qui exclut une zone l'exclut pour tous : les autres la voient exclue, avec son nom."""
    e = Essai(pw); J = e.page()
    e.connexion(J, "johan@x.fr", "Johan"); e.onglet(J, "profile"); J.fill("#newMapName", "Notre recherche"); J.click("#newMapForm button"); J.wait_for_timeout(800)
    code = J.locator(".invite__code").inner_text().strip()
    M = e.page(); e.connexion(M, "max@x.fr", "Max"); e.onglet(M, "map"); e.zone(M, "Bastille", 48.855, 2.37)
    e.onglet(M, "profile"); M.click("[data-ptab='compte']"); M.wait_for_timeout(200)
    M.fill("#joinCode", code); M.click("#joinForm button"); M.wait_for_timeout(3500)
    db = M.evaluate(DBQ); shared = next(m["id"] for m in db["maps"] if m["kind"] == "partagee")
    e.onglet(M, "map"); M.click(f".mapsw [data-map='{shared}']"); M.wait_for_timeout(2500)
    M.evaluate("document.querySelector('.zrow').click()"); M.wait_for_timeout(500)
    M.evaluate("document.querySelector('#zexcl').click()"); M.wait_for_timeout(3500)
    db = M.evaluate(DBQ); bz = next(z["id"] for z in db["zones"] if z["map_id"] == shared and z["name"] == "Bastille")
    assert any(r["zone_id"] == bz and (r.get("ratings") or {}).get("_x") == 1 for r in db["ratings"]), "exclusion non enregistrée sur la carte commune"
    J.reload(); J.wait_for_timeout(2500)
    e.onglet(J, "map"); J.click(f".mapsw [data-map='{shared}']"); J.wait_for_timeout(2500)
    assert J.locator(".zrow .score-chip--excl").count() == 1, "Johan ne voit pas la zone exclue par Max"
    J.evaluate("document.querySelector('.zrow').click()"); J.wait_for_timeout(500)
    assert "Exclue par Max" in J.inner_text(".zexcl"), J.inner_text(".zexcl")
    assert J.get_attribute("#zexcl", "aria-pressed") == "false"
    assert not e.erreurs, e.erreurs; e.fermer()


def importer(pg, d):
    pg.goto(B + "?importer=1#import=" + urllib.parse.quote(json.dumps(d))); pg.wait_for_timeout(2600)


@essai
def annonces(pw):
    e = Essai(pw); pg = e.page()
    importer(pg, {"v": 5, "url": "https://ex.fr/annonce-viager-1.htm", "title": "Viager occupé 3 pièces 65 m² Paris 15e", "meta": {}, "ld": [], "imgs": [],
                  "text": "Viager occupé, 3 pièces de 65 m², Paris 15ème. Bouquet de 180 000 € et rente mensuelle de 1 150 €."})
    pg.locator("#lsave").click(); pg.wait_for_timeout(800)
    f = pg.evaluate("__heden.state().listings[0]")
    assert (f["viager"], f["price"], f["rente"]) == ("occupe", 180000, 1150), f
    importer(pg, {"v": 5, "url": "https://ex.fr/annonce-2.htm", "title": "2 pièces 45 m² Paris 7e", "meta": {}, "ld": [], "imgs": [],
                  "text": "Vente 2 pièces 45 m² Paris 7ème, 590 000 €. Je suis actuellement à l'étranger, les clés vous seront envoyées par la poste. Home staging virtuel."})
    pg.locator("#lsave").click(); pg.wait_for_timeout(800)
    s = pg.evaluate("__heden.state().listings.find(f => f.url.includes('annonce-2'))")
    assert "clés envoyées par la poste" in s["scam"] and s["aiPhoto"] == ["home staging virtuel"], s
    cards = [{"url": f"https://ex.fr/annonce-l{i}.htm", "img": f"https://img.ex.fr/{i}-a.jpg", "imgs": [f"https://img.ex.fr/{i}-{k}.jpg" for k in "abc"],
              "text": f"{2 + i % 3} pièces {40 + i * 5} m² {'Paris 17ème' if i % 2 else '18e arrondissement'} {500000 + i * 20000} €"} for i in range(4)]
    importer(pg, {"v": 5, "url": "https://ex.fr/liste?page=1", "title": "Résultats", "meta": {}, "ld": [], "imgs": [], "text": "", "items": cards})
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


@essai
def annuler(pw):
    """« Annuler » dans la notification remet l'annonce, même après une synchronisation entre-temps."""
    e = Essai(pw); pg = e.page(); e.connexion(pg, "johan@x.fr", "Johan")
    pg.evaluate("() => { const s = __heden.state(); s.listings = [{id: crypto.randomUUID(), title: 'T', price: 500000, surface: 50, rooms: 3, postcode: '75017', status: 'nouvelle', mapId: __heden.cloud().mapId, createdBy: __heden.cloud().user.id, photos: [], addedAt: Date.now(), firstSeen: Date.now()}]; __heden.save(); }")
    pg.wait_for_timeout(1500); e.onglet(pg, "annonces"); pg.wait_for_timeout(500)
    pg.locator("[data-feed=mes]").click(); pg.wait_for_timeout(400)   # Explorer s'ouvre d'abord ; l'annonce ajoutée est dans « Mes ajouts »
    pg.locator(".hero .hero__fav").first.click(); pg.wait_for_timeout(2200)   # la synchro passe pendant que la notification est affichée
    assert pg.evaluate("__heden.state().listings[0].status") == "gardee", "le cœur n'a pas mis l'annonce en favori"
    pg.locator("#toast .toast__act").click(); pg.wait_for_timeout(600)
    assert pg.evaluate("__heden.state().listings[0].status") == "nouvelle", "Annuler n'a rien fait"
    pg.wait_for_timeout(1500)
    assert pg.evaluate(DBQ + ".listings[0].status") == "nouvelle", "l'annulation n'est pas partie au serveur"
    assert not e.erreurs, e.erreurs; e.fermer()


@essai
def zones_superposees(pw):
    """Une annonce dans deux zones superposées : la plus petite prime critère par critère, la grande complète ce qu'elle ne note pas."""
    e = Essai(pw); pg = e.page()
    r = pg.evaluate("""() => { const s = __heden.state(), cs = s.profile.criteria.filter(c => c.weight > 0).map(c => c.id);
      const carre = (lat, lng, d) => [[lat - d, lng - d], [lat - d, lng + d], [lat + d, lng + d], [lat + d, lng - d]];
      const grande = {id: 'g', name: 'Montmartre', points: carre(48.886, 2.34, .006), ratings: Object.fromEntries(cs.map(id => [id, 1])), example: false};
      const petite = {id: 'p', name: 'Rue Lepic', points: carre(48.886, 2.34, .001), ratings: {[cs[0]]: 5}, example: false};
      s.zones = [grande, petite];   // la grande d'abord : avant, c'était elle qui comptait
      const f = {id: 'a1', price: 500000, surface: 50, rooms: 2, postcode: '75018', lat: 48.886, lng: 2.34, precise: true, placeLevel: 'adresse', status: 'nouvelle', photos: []};
      s.listings = [f]; __heden.save();
      const a = __heden.score(f).area, attendu = __heden.scoreOf({ratings: Object.assign({}, grande.ratings, petite.ratings)}).score;
      const hors = __heden.score(Object.assign({}, f, {lat: 48.8905, lng: 2.3445})).area;   // dans la grande seulement
      return {zone: a.zone.name, pile: (a.stack || []).map(z => z.name), score: a.score, attendu, seule: __heden.scoreOf(grande).score, hors: [hors.zone.name, hors.stack]}; }""")
    assert r["zone"] == "Rue Lepic" and r["pile"] == ["Rue Lepic", "Montmartre"], r
    assert r["score"] == r["attendu"] and r["score"] != r["seule"], r
    assert r["hors"] == ["Montmartre", None], r
    assert not e.erreurs, e.erreurs; e.fermer()


@essai
def zones_exclues(pw):
    """Une zone exclue : ses annonces sortent de Mes ajouts (rangées dans Masquées), le reste du flux ne bouge pas."""
    e = Essai(pw); pg = e.page()
    e.zone(pg, "Pigalle")
    pg.evaluate("""() => { const s = __heden.state(), m = (id, lat, lng) => ({id, price: 500000, surface: 50, rooms: 2, postcode: '75018', lat, lng, precise: true, placeLevel: 'adresse', status: 'nouvelle', photos: [], addedAt: Date.now()});
      s.listings = [m('dedans', 48.8846, 2.3384), m('dehors', 48.8905, 2.3500)]; __heden.save(); }""")
    pg.evaluate("document.querySelector('.zrow').click()"); pg.wait_for_timeout(500)   # feuille réduite : la liste est sous la barre d'onglets
    pg.evaluate("document.querySelector('#zexcl').click()"); pg.wait_for_timeout(300)
    assert pg.get_attribute("#zexcl", "aria-pressed") == "true", "interrupteur non activé"
    assert pg.evaluate("__heden.state().zones[0].ratings._x") == 1, "zone exclue non enregistrée"
    pg.evaluate("document.querySelector('#close').click()"); pg.wait_for_timeout(300)
    assert pg.locator(".score-chip--excl").count() == 1, "pictogramme absent de la liste des zones"
    e.onglet(pg, "annonces"); pg.click("[data-feed='mes']"); pg.wait_for_timeout(500)
    ids = pg.eval_on_selector_all(".ann__feed .hero", "els => els.map(x => x.dataset.id)")
    assert ids == ["dehors"], ids
    pg.click("[data-filter='masquees']"); pg.wait_for_timeout(400)
    assert pg.eval_on_selector_all(".ann__feed .hero", "els => els.map(x => x.dataset.id)") == ["dedans"], "annonce de la zone exclue absente de Masquées"
    assert "Pigalle" in pg.inner_text(".ann__feed .hero .hero__k"), pg.inner_text(".ann__feed .hero .hero__k")
    assert not e.erreurs, e.erreurs; e.fermer()


@essai
def filtres(pw):
    """Filtres des Favoris : ce qui répond d'abord, ce dont l'info manque ensuite (« À vérifier »), le reste écarté ; « Seulement les infos connues » retire les incomplètes."""
    e = Essai(pw); pg = e.page()
    pg.evaluate("""() => { const s = __heden.state(), m = (id, o) => Object.assign({id, surface: 50, rooms: 2, postcode: '75011', lat: 48.86, lng: 2.38, placeLevel: 'adresse', status: 'gardee', photos: [], addedAt: Date.now()}, o);
      s.listings = [m('ok', {price: 400000, floor: 3}), m('cher', {price: 900000, floor: 3}), m('sansprix', {floor: 3}), m('rdc', {price: 300000, floor: 0})]; __heden.save(); }""")
    e.onglet(pg, "favoris"); pg.wait_for_timeout(400)
    pg.click("#fltOpen"); pg.wait_for_timeout(300)
    pg.fill("#flt-prixMax", "500000"); pg.click("[data-f1='etage'][data-v='1']")
    assert "1 annonce" in pg.inner_text("#fltGo") and "1 à vérifier" in pg.inner_text("#fltGo"), pg.inner_text("#fltGo")
    pg.click("#fltGo"); pg.wait_for_timeout(500)
    ids = pg.eval_on_selector_all(".ann__feed .hero", "els => els.map(x => x.dataset.id)")
    assert ids == ["ok", "sansprix"], ids
    assert pg.locator(".feed__sep").count() == 1 and "prix" in pg.inner_text(".hero[data-id='sansprix'] .hero__k"), "annonce à vérifier mal signalée"
    assert pg.locator(".ann__fltn").inner_text() == "2" and pg.locator(".fltc").count() == 2
    pg.click("#fltOpen"); pg.click("[data-ft='strict']"); pg.click("#fltGo"); pg.wait_for_timeout(400)
    assert pg.eval_on_selector_all(".ann__feed .hero", "els => els.map(x => x.dataset.id)") == ["ok"]
    pg.locator(".fltc").first.click(); pg.wait_for_timeout(300)
    assert pg.locator(".fltc").count() == 1, "pastille non retirée"
    assert not e.erreurs, e.erreurs; e.fermer()


@essai
def epingles(pw):
    """Carte : seuls les favoris ; regroupés au loin, séparés de près ; plusieurs au même point → liste ; clic → popup photos + note."""
    e = Essai(pw, 1280, 860); pg = e.page()
    pg.evaluate("""() => { const s = __heden.state(); s.listings = [];
      for (let i = 0; i < 40; i++) s.listings.push({id: 'l' + i, title: 'T' + i, price: 400000 + i * 9000, surface: 50, rooms: 3, postcode: '75017', status: i < 36 ? 'gardee' : 'nouvelle', lat: 48.876 + (i % 8) * .0012, lng: 2.30 + Math.floor(i / 8) * .0015, photos: ['https://img.ex.fr/' + i + 'a.jpg', 'https://img.ex.fr/' + i + 'b.jpg'], addedAt: Date.now(), firstSeen: Date.now(), precise: true});
      for (let i = 0; i < 3; i++) s.listings.push({id: 'm' + i, title: 'Même point ' + i, price: 500000, surface: 40 + i, rooms: 2, postcode: '75018', status: 'gardee', lat: 48.892, lng: 2.345, photos: [], addedAt: Date.now(), firstSeen: Date.now()});
      __heden.save(); }""")
    e.onglet(pg, "annonces"); e.onglet(pg, "map")
    pg.evaluate("__heden.map.setView([48.879, 2.306], 13, {animate: false})"); pg.wait_for_timeout(800)
    g = pg.evaluate("document.querySelectorAll('.lpin--grp').length")
    assert 1 <= g <= 5, f"{g} pastilles au zoom 13"
    pg.evaluate("__heden.map.setView([48.879, 2.306], 16, {animate: false})"); pg.wait_for_timeout(800)
    singles = pg.evaluate("document.querySelectorAll('.lpin:not(.lpin--grp)').length")
    assert singles == 36 and pg.evaluate("document.querySelectorAll('[data-pin=l38]').length") == 0, f"{singles} favoris seuls, ou une annonce non favorite sur la carte"
    pg.locator("[data-pin=l3]").click(); pg.wait_for_timeout(500)
    assert pg.locator(".mpop[data-id=l3] .mpop__track").count() == 1 and "/2" in pg.locator(".mpop__n").inner_text() and pg.locator(".mpop__s").count() == 1, "popup sans photos ou sans note"
    pg.evaluate("__heden.map.closePopup(); __heden.map.setView([48.892, 2.345], 17, {animate: false})"); pg.wait_for_timeout(800)
    pg.locator(".lpin--grp").first.click(); pg.wait_for_timeout(500)
    assert pg.locator(".mpop--grp [data-pick]").count() == 3, "trois favoris au même point : pas de liste"
    pg.locator("[data-pick=m1]").click(); pg.wait_for_timeout(400)
    assert pg.locator(".mpop[data-id=m1]").count() == 1 and pg.evaluate("document.body.dataset.mode") != "placing", "le clic dans le popup a commencé une zone"
    pg.locator("[data-open]").click(); pg.wait_for_timeout(700)
    assert pg.evaluate("document.body.dataset.tab") == "favoris" and pg.locator(".ldet__head").count() == 1, "« Voir la fiche » n'ouvre pas la fiche"
    assert not e.erreurs, e.erreurs; e.fermer()


@essai
def hors_connexion(pw):
    """Après une première visite, l'app s'ouvre sans réseau (service worker)."""
    b = pw.chromium.launch(); ctx = b.new_context(); pg = ctx.new_page()
    pg.goto(B); pg.wait_for_timeout(1500)
    assert pg.evaluate("Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise(r => setTimeout(() => r(false), 8000))])"), "service worker non installé"
    pg.reload(); pg.wait_for_timeout(1000); ctx.set_offline(True); pg.reload(); pg.wait_for_timeout(800)
    assert pg.title() == "Heden" and pg.locator("#app").count() == 1, "page vide hors connexion"
    m = pg.evaluate("fetch('manifest.webmanifest').then(r => r.json())")
    assert m["display"] == "standalone" and len(m["icons"]) == 3, m
    b.close()


@essai
def lecture(pw):
    """Banc de lecture (tests/annonces/fiches.py) : toutes les valeurs attendues sont lues ; une annonce incohérente est signalée."""
    from lecture import mesurer
    e = Essai(pw); pg = e.page(); champs, erreurs = mesurer(pg)
    assert not erreurs, "\n".join(erreurs[:12])
    importer(pg, {"v": 5, "url": "https://ex.fr/annonce-bizarre.htm", "title": "Studio 85 m² Paris 11e", "meta": {}, "ld": [], "imgs": [],
                  "text": "Studio 58 m² Paris 11ème, 3 pièces dont 3 chambres, 9e étage sur 6. Prix : 98 000 €."})
    assert pg.locator(".lf__doubt").count() >= 3, "champs douteux non signalés dans le formulaire"
    pg.locator("#lsave").click(); pg.wait_for_timeout(900)
    box = pg.locator(".trust--check")
    assert box.count() == 1 and box.locator("li").count() >= 3, "pas d’encadré « Infos à vérifier »"
    box.locator("[data-checkfix]").click(); pg.wait_for_timeout(400)
    pg.locator("#lsave").click(); pg.wait_for_timeout(900)
    assert pg.locator(".trust--check").count() == 0, "l’encadré reste après vérification"
    assert not e.erreurs, e.erreurs; e.fermer()


@essai
def dpe_officiel(pw):
    """Rue lue → Base Adresse Nationale ; consommation lue → DPE officiel retrouvé (position de l'immeuble) ; sinon choix parmi les logements possibles."""
    e = Essai(pw); pg = e.page()
    importer(pg, {"v": 5, "url": "https://ex.fr/annonce-dpe-1.htm", "title": "3 pièces 68 m² Paris 11e", "meta": {}, "ld": [], "imgs": [],
                  "text": "Appartement 3 pièces 68 m², Paris 11ème (75011), 725 000 €. Rue Oberkampf, 4e étage. DPE : C (212 kWh/m²/an)."})
    pg.locator("#lsave").click(); pg.wait_for_timeout(1500)
    f = pg.evaluate("__heden.state().listings.find(x => x.url.includes('dpe-1'))")
    assert f["street"] == "rue Oberkampf" and f["dpeKwh"] == 212, f
    assert f.get("ademe", {}).get("sure") and f["precise"] and abs(f["lat"] - 48.8667) < 1e-4, f
    assert "DPE annoncé C, DPE officiel D" in pg.locator(".trust--check").inner_text(), "écart de DPE non signalé"
    importer(pg, {"v": 5, "url": "https://ex.fr/annonce-dpe-2.htm", "title": "2 pièces 41 m² Paris 18e", "meta": {}, "ld": [], "imgs": [],
                  "text": "2 pièces 41 m², Paris 18ème, 389 000 €, rue Caulaincourt, DPE D."})
    pg.locator("#lsave").click(); pg.wait_for_timeout(1500)
    assert pg.locator("[data-ademe]").count() == 2, "pas de choix parmi les DPE possibles"
    pg.locator("[data-ademe]").first.click(); pg.wait_for_timeout(1200)
    g = pg.evaluate("__heden.state().listings.find(x => x.url.includes('dpe-2'))")
    assert g["ademe"]["sure"] and g["placeLevel"] == "dpe" and pg.locator(".ademe").count() == 0, g
    assert not e.erreurs, e.erreurs; e.fermer()


@essai
def vivier(pw):
    """Un e-mail d'alerte arrivé dans le vivier est lu par l'appareil connecté ; ses annonces sont proposées à chacun selon ses critères."""
    e = Essai(pw); pg = e.page()
    html = "<table>" + "".join(f'<tr><td><a href="https://www.seloger.com/annonces/achat/appartement/paris-11eme-75/{i}.htm"><img src="https://img.ex.fr/{i}.jpg" width="280" height="180"></a></td><td>Appartement {2 + i % 2} pièces<br>{40 + i * 6} m² · Paris 11ème<br>{480000 + i * 30000} €</td></tr>' for i in range(3)) + "</table>"
    pg.evaluate("h => { const db = JSON.parse(localStorage.getItem('__mockdb2') || JSON.stringify({profiles: [], maps: [], map_members: [], map_invites: [], zones: [], ratings: [], zone_photos: [], calls: []})); db.vivier_courrier = [{id: 'c1', sender: 'alertes@seloger.com', subject: 'Nouvelles annonces', html: h}]; localStorage.setItem('__mockdb2', JSON.stringify(db)); }", html)
    e.connexion(pg, "johan@x.fr", "Johan"); pg.wait_for_timeout(1500)
    db = pg.evaluate(DBQ)
    assert len(db.get("vivier", [])) == 3 and not db.get("vivier_courrier"), [c for c in db["calls"] if "vivier" in c or "rpc" in c][-8:]
    e.onglet(pg, "annonces"); pg.wait_for_timeout(800)
    assert pg.locator(".feed--explorer").get_attribute("aria-selected") == "true", "Explorer n'est pas le flux ouvert d'abord"
    assert "3" in pg.locator(".feed--explorer .feed__n").inner_text(), "Explorer n'annonce pas ses annonces"
    pg.locator("[data-feed=explorer]").click(); pg.wait_for_timeout(800)
    assert pg.locator(".hero--ex").count() == 3, "Explorer ne montre pas les annonces du flux Heden"
    pg.locator(".hero--ex .hero__fav").first.click(); pg.wait_for_timeout(1400)   # la carte file vers l'onglet Favoris
    got = pg.evaluate("__heden.state().listings.filter(f => f.origin === 'vivier').map(f => [f.source, f.status])")
    assert got == [["SeLoger", "gardee"]], got
    assert pg.locator(".hero--ex").count() == 2 and not pg.locator(".hero--fly").count(), "le favori reste dans Explorer"
    pg.locator(".hero--ex .hero__hide").nth(1).click(); pg.wait_for_timeout(900)
    assert pg.locator(".hero--ex").count() == 1, "l'annonce masquée reste dans Explorer"
    pg.locator("[data-feed=mes]").click(); pg.wait_for_timeout(500)
    assert pg.locator(".hero").count() == 0, "une annonce d'Explorer apparaît dans Mes annonces"
    e.onglet(pg, "favoris"); pg.wait_for_timeout(500)
    assert pg.locator(".hero").count() == 1, ("le favori d'Explorer n'est pas dans Favoris", pg.evaluate("__heden.state().listings.map(f => [f.origin, f.status, f.kind, f.price])"), pg.locator("#annonces").inner_text()[:300])
    # un membre ouvre l'une d'elles avec le bouton + Heden : la copie du vivier reçoit toutes les photos et la fiche complète
    importer(pg, {"v": 6, "url": "https://www.seloger.com/annonces/achat/appartement/paris-11eme-75/1.htm", "title": "Appartement 3 pièces 46 m² Paris 11e", "meta": {}, "ld": [],
                  "imgs": [f"https://img.ex.fr/1-{k}.jpg" for k in range(8)], "text": "Appartement 3 pièces 46 m², Paris 11ème (75011), 510 000 €. 5e étage avec ascenseur, DPE C."})
    v1 = next(x for x in pg.evaluate(DBQ)["vivier"] if x["surface"] == 46)
    assert v1["data"].get("complet") and v1["data"].get("floor") == 5 and len(v1["carte"]["imgs"]) == 8, v1
    assert not e.erreurs, e.erreurs; e.fermer()


@essai
def bouton_photos(pw):
    """Le bouton + Heden récupère toute la galerie : photos affichées et photos pas encore chargées du carrousel."""
    import struct, zlib
    def png(w, h):
        raw = b"".join(b"\x00" + b"\x80\x80\x80" * w for _ in range(h))
        ch = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
        return b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw)) + ch(b"IEND", b"")
    e = Essai(pw, largeur=1280); pg = e.page()
    code = pg.evaluate("__heden.bookmarkletCode()")
    gal = "".join(f'<img src="https://photos.ex.fr/{i}.jpg">' for i in range(2)) + "".join(f'<img data-src="https://photos.ex.fr/{i}.jpg" src="https://photos.ex.fr/vide.gif">' for i in range(2, 14))
    site = e.ctx.new_page()
    site.route("https://photos.ex.fr/**", lambda r: r.fulfill(body=png(1, 1) if "vide" in r.request.url else png(800, 600), content_type="image/png"))
    site.route("https://www.agence-ex.fr/**", lambda r: r.fulfill(body=f"<html><body><h1>3 pièces 60 m² Paris 11e</h1><div class=gal><div>{gal}</div></div><p>450 000 €</p><img src='https://photos.ex.fr/logo.png' width=40></body></html>", content_type="text/html"))
    site.goto("https://www.agence-ex.fr/annonce/1"); site.wait_for_timeout(800)
    d = site.evaluate("c => { let got = null; window.open = (u) => { got = JSON.parse(decodeURIComponent(u.split('#import=')[1])); return null; }; eval(decodeURIComponent(c.slice(11))); return got; }", code)
    assert d and d["v"] == 6 and len(d["imgs"]) == 14, (d or {}).get("imgs")
    assert not any("logo" in u or "vide" in u for u in d["imgs"]), d["imgs"]
    # galerie complète dans les données de la page (comme SeLoger) : 11 photos et le plan, pas le logo de l'agence affiché en grand
    etat = {"app": {"data": {"classified": {"medias": {"images": [{"url": f"https://mms.ex.fr/{i}.jpg?ci_seal=x"} for i in range(11)], "floorplans": [{"url": "https://mms.ex.fr/plan.jpg"}]},
            "contact": {"agencyLogo": {"logoUrl": "https://mms.ex.fr/agence.jpg"}}, "description": "Bel appartement au 3e étage avec ascenseur, entièrement rénové, cave. " * 5}}}}
    site.route("https://www.agence-deux.fr/**", lambda r: r.fulfill(body=f"<html><body><h1>2 pièces 47 m² Paris 7e</h1><img src='https://photos.ex.fr/agence.jpg'><img src='https://photos.ex.fr/0.jpg'><p>596 850 €</p><p>Bel appartement…</p><script>window.__ETAT__ = {json.dumps(etat)};</script></body></html>", content_type="text/html"))
    site.goto("https://www.agence-deux.fr/annonce/2"); site.wait_for_timeout(800)
    d = site.evaluate("c => { let got = null; window.open = (u) => { got = JSON.parse(decodeURIComponent(u.split('#import=')[1])); return null; }; eval(decodeURIComponent(c.slice(11))); return got; }", code)
    assert len(d["imgs"]) == 12 and d["imgs"][-1].endswith("plan.jpg") and not any("agence" in u for u in d["imgs"]), d["imgs"]
    assert "entièrement rénové" in d["text"], "description complète absente"
    e.fermer()


@essai
def guide(pw):
    """Premier lancement : le guide parcourt Carte, Annonces, Favoris, Profil ; « Passer » l'arrête ; Profil le relance."""
    e = Essai(pw); e.ctx.add_init_script("localStorage.setItem('__tips', '1')")
    pg = e.page(); pg.wait_for_timeout(2600)
    assert pg.locator(".tip--tour").count() == 1, "pas de guide au premier lancement"
    vus = []
    for _ in range(3): vus.append(pg.evaluate("document.body.dataset.tab")); pg.locator(".tip__ok").click(); pg.wait_for_timeout(700)
    vus.append(pg.evaluate("document.body.dataset.tab"))
    assert vus == ["map", "map", "map", "annonces"], vus
    pg.locator(".tip__skip").click(); pg.wait_for_timeout(600)
    assert pg.locator(".tip--tour").count() == 0 and pg.evaluate("document.body.dataset.tab") == "map", "« Passer le guide » ne l'arrête pas"
    assert pg.evaluate("JSON.parse(localStorage.getItem('heden.tips')).done") is True
    pg.reload(); pg.wait_for_timeout(2600)
    assert pg.locator(".tip--tour").count() == 0, "le guide revient après avoir été passé"
    e.onglet(pg, "profile"); pg.click("[data-ptab='compte']"); pg.wait_for_timeout(300)
    pg.click("#tourGo"); pg.wait_for_timeout(1500)
    assert pg.locator(".tip--tour").count() == 1 and pg.evaluate("document.body.dataset.tab") == "map", "« Revoir le guide » ne le relance pas"
    pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
    assert pg.locator(".tip--tour").count() == 0, "Échap ne ferme pas le guide"
    assert not e.erreurs, e.erreurs; e.fermer()



@essai
def questionnaire(pw):
    """Après le guide, le questionnaire (secteurs, arbitrages) ; une annonce mal renseignée n'est pas notée mais invitée à l'être."""
    e = Essai(pw); e.ctx.add_init_script("localStorage.setItem('__tips', '1'); localStorage.setItem('__allowquiz', '1'); if (!localStorage.getItem('__q')) { localStorage.removeItem('heden.quiz.later'); localStorage.setItem('__q', '1'); }")
    pg = e.page(); pg.wait_for_timeout(2600)
    assert pg.locator(".tip--tour").count() == 1 and not pg.locator("#quiz.is-open").count(), "le questionnaire passe avant le guide"
    for _ in range(6): pg.locator(".tip__ok").click(); pg.wait_for_timeout(700)
    assert pg.locator(".tip__ok").inner_text() == "Définir mon profil", pg.locator(".tip__ok").inner_text()
    pg.locator(".tip__ok").click(); pg.wait_for_timeout(900)
    assert pg.locator("#quiz.is-open").count() == 1 and "1 / 9" in pg.locator(".quiz__n").inner_text(), "la fin du guide n'ouvre pas le questionnaire"
    pg.click("[data-pj=achat]"); pg.click("[data-who=deux]"); pg.click("[data-bud='650000']"); pg.click("#qzNext")
    pg.click("[data-rooms='3']"); pg.click("#qzNext"); pg.wait_for_timeout(900)
    assert pg.locator("#quiz .qarr").count() == 20, "carte des arrondissements absente"
    assert pg.locator("#quiz .qarr[aria-pressed='true']").count() == 20, "tout Paris n'est pas choisi d'emblée"
    for n in range(1, 21):   # toucher un arrondissement l'exclut : on garde le 11e et le 18e
        if n not in (11, 18): pg.locator(f"#quiz [data-arr='{n}']").dispatch_event("click")
    assert "18 exclus" in pg.locator(".qmap__sel").inner_text(), pg.locator(".qmap__sel").inner_text()
    pg.click("#qzNext"); pg.click("#qzSkip")
    pg.click("[data-prio=anime]"); pg.click("[data-prio=lumiere]"); pg.click("#qzNext")
    pg.click("[data-arb=lq][data-v=quartier]"); pg.click("#qzNext"); pg.click("#qzNext"); pg.wait_for_timeout(400)
    h = pg.evaluate("__heden.state().profile.home")
    assert h["arrs"] == [11, 18] and sum(h["mix"].values()) == 100 and h["mix"]["quartier"] > h["mix"]["logement"], (h["arrs"], h["mix"])
    pg.click("#qzDone"); pg.wait_for_timeout(600)
    assert pg.evaluate("document.body.dataset.tab") == "annonces"
    # une annonce complète dans un secteur choisi est notée ; une annonce ailleurs est hors critères ; une annonce vague attend des infos
    for i, txt in enumerate(["Appartement 3 pièces 68 m², 12 rue Oberkampf, Paris 11ème (75011), 615 000 €. 4e étage avec ascenseur, traversant, lumineux, balcon, parquet. Bon état. DPE C. Charges 2 400 € par an. Cave.",
                             "3 pièces 60 m², Paris 15ème (75015), 600 000 €.", "3 pièces 64 m², Paris 18ème (75018), 590 000 €."]):
        importer(pg, {"v": 6, "url": f"https://ex.fr/q-{i}.htm", "title": f"Annonce {i}", "meta": {}, "ld": [], "imgs": [], "text": txt})
        pg.locator("#lsave").click(); pg.wait_for_timeout(1500)
    s = pg.evaluate("__heden.state().listings.map(f => { const s = __heden.score(f); return [f.url.slice(-6, -4), s.reliable, s.fails, s.need]; })")
    d = {x[0]: x for x in s}
    assert d["-0"][1] is True, d["-0"]
    assert "dans le 15e" in d["-1"][2], d["-1"]
    assert d["-2"][1] is False and d["-2"][3], d["-2"]
    e.onglet(pg, "annonces")
    if pg.locator("#lback").count(): pg.click("#lback"); pg.wait_for_timeout(500)
    card = pg.locator(f".hero[data-id='{pg.evaluate("__heden.state().listings.find(f => f.url.includes('q-2')).id")}']")
    assert card.locator(".hero__s").inner_text() == "?", card.locator(".hero__s").inner_text()
    card.click(); pg.wait_for_timeout(700)
    assert pg.locator(".lask").count() == 1 and pg.locator(".ldet__score b").inner_text() == "?"
    pg.click("#laskRate"); pg.wait_for_timeout(500)
    assert pg.locator("#lsTitle").inner_text() == "Noter l’annonce"
    pg.click("#fxT"); pg.click("#fxSave"); pg.wait_for_timeout(500)
    assert pg.locator(".lask").count() == 0 and pg.locator(".ldet__score b").inner_text() != "?", "la note donnée ne remplace pas le « ? »"
    # une seule question depuis le profil : les secteurs, sans refaire tout le questionnaire
    pg.evaluate("__heden.openQuiz({step: 'secteurs'})"); pg.wait_for_timeout(600)
    assert pg.locator("#qzNext").inner_text() == "Enregistrer" and not pg.locator("#qzBack").count()
    pg.click("#quiz [data-arr='15']"); pg.click("#qzNext"); pg.wait_for_timeout(500)
    assert pg.evaluate("__heden.state().profile.home.arrs") == [11, 15, 18]
    assert not pg.evaluate("__heden.score(__heden.state().listings.find(f => f.url.includes('q-1'))).fails.length"), "le 15e reste hors critères"
    assert not e.erreurs, e.erreurs; e.fermer()



@essai
def extension(pw):
    """L'extension lit la liste de résultats et la fiche que l'utilisateur ouvre et les envoie dans Explorer ;
    une annonce revue rafraîchit son prix (historique), une fiche complète apporte toutes ses photos, une fiche retirée sort du flux."""
    import subprocess, tempfile
    from outils import RACINE, routes, INIT
    out = tempfile.mkdtemp() + "/extension/"
    r = subprocess.run(["node", "scripts/build/extension.mjs"], cwd=RACINE, capture_output=True, text=True,
                       env=dict(os.environ, HEDEN_URL=B.rsplit("/", 1)[0] + "/", HEDEN_EXT_OUT=out))
    assert r.returncode == 0, r.stderr[-800:]
    ctx = pw.chromium.launch_persistent_context(tempfile.mkdtemp(), headless=True, channel="chromium", viewport={"width": 1280, "height": 900}, service_workers="block",
                                                args=[f"--disable-extensions-except={out}", f"--load-extension={out}"])
    prix = {"b": 580000}
    carte = lambda i, p, s, a: f'<li><a href="https://www.seloger.com/annonces/achat/appartement/paris-{a}eme-75/{900000 + i}.htm"><img src="https://photos.ex.fr/c{i}.jpg"><p>Appartement 3 pièces {s} m² Paris {a}e {p:,} €</p></a></li>'.replace(",", " ")
    def portail(rt):
        u = rt.request.url
        if "photos.ex.fr" in u: return rt.fulfill(body=b"", content_type="image/jpeg")
        if "seloger.com" in u and "/recherche" in u:
            cs = [carte(1, 615000, 64, 11), carte(2, prix["b"], 58, 18), carte(3, 720000, 70, 17), carte(4, 499000, 45, 10)]
            return rt.fulfill(body=f"<html><head><title>Achat Paris</title></head><body><h1>1 234 annonces</h1><ul>{''.join(cs)}</ul><a rel=next href='https://www.seloger.com/recherche?page=2'>Suivant</a></body></html>", content_type="text/html; charset=utf-8")
        if "/900001.htm" in u:
            etat = {"classified": {"medias": {"images": [{"url": f"https://photos.ex.fr/g{k}.jpg"} for k in range(9)]}, "description": "Appartement traversant au 4e étage avec ascenseur, balcon, DPE C, 12 rue Oberkampf."}}
            return rt.fulfill(body=f"<html><head><title>Appartement 3 pièces 64 m² Paris 11e</title></head><body><h1>Appartement 3 pièces 64 m²</h1><p>Paris 11e (75011) · 615 000 €</p><p>4e étage avec ascenseur, balcon, traversant. DPE C. 12 rue Oberkampf.</p><script>window.__ETAT__ = {json.dumps(etat)};</script></body></html>", content_type="text/html; charset=utf-8")
        if "distributionTypes=Rent" in u:
            cs = "".join(f'<li><a href="https://www.seloger.com/annonce/location/ile-de-france/paris-75/paris-75000/LOC{i}?serp_view=list"><img src="https://photos.ex.fr/r{i}.jpg"></a><div><span>{p} €/mois</span></div><div>Appartement à louer</div><div>{r} pièces · {s_} m² · 2ème étage</div><div>Paris {a}ème arrondissement (750{a:02d})</div></li>' for i, (p, r, s_, a) in enumerate([("2 900", 3, 65, 7), ("1 450", 2, 38, 11), ("4 000", 3, 93, 16)]))
            return rt.fulfill(body=f"<html><head><title>Louer Paris</title></head><body><ul>{cs}</ul></body></html>", content_type="text/html; charset=utf-8")
        if "bienici.com/realEstateAds.json" in u:   # les résultats arrivent en JSON, la page les dessine ensuite
            ads = [{"id": f"apimo-7700{i}", "price": p, "surfaceArea": s_, "roomsQuantity": r, "postalCode": "750" + a, "floor": fl, "floorQuantity": 6, "hasElevator": True, "energyClassification": "C",
                    "exposition": "Sud", "hasCaretaker": True, "district": {"id": 100500 + i, "libelle": q}, "blurInfo": {"type": "disk", "radius": 50, "position": {"lat": 48.865 + i / 1000, "lon": 2.37}},
                    "description": "Bel appartement familial, séjour et chambres sur cour, parquet, moulures. " * 12, "photos": [{"url": f"https://photos.ex.fr/bi{i}-{k}.jpg"} for k in range(5)]}
                   for i, (p, s_, r, a, fl, q) in enumerate([(640000, 61, 3, "11", 4, "Folie-Méricourt"), (455000, 42, 2, "18", 2, "Montmartre"), (980000, 88, 4, "15", 5, "Saint-Lambert")])]
            return rt.fulfill(body=json.dumps({"total": 3, "realEstateAds": ads}), content_type="application/json; charset=utf-8")
        if "bienici.com/recherche" in u:
            js = """fetch('/realEstateAds.json?filters=x').then(r => r.json()).then(j => { document.querySelector('ul').innerHTML = j.realEstateAds.map(a => `<li><a href="https://www.bienici.com/annonce/vente/paris/appartement/${a.roomsQuantity}pieces/${a.id}?q=x"><img src="https://photos.ex.fr/c.jpg"></a><div>Appartement ${a.roomsQuantity} pièces ${a.surfaceArea} m²</div><div>${a.postalCode} Paris</div><div>${a.price.toLocaleString('fr-FR')} €</div></li>`).join(''); });"""
            return rt.fulfill(body=f"<html><head><title>Achat Paris - Bien'ici</title></head><body><ul></ul><script>{js}</script></body></html>", content_type="text/html; charset=utf-8")
        if "/900004.htm" in u:
            return rt.fulfill(body="<html><head><title>Annonce expirée</title></head><body><h1>Cette annonce n’est plus disponible</h1><p>Appartement 3 pièces 45 m² Paris 10e 499 000 €</p></body></html>", content_type="text/html; charset=utf-8")
        return rt.abort()
    ctx.add_init_script(INIT)
    ctx.route("**/*", lambda rt: portail(rt) if any(h in rt.request.url for h in ("seloger.com", "bienici.com", "photos.ex.fr")) else routes(rt))
    e = Essai.__new__(Essai); e.b = ctx; e.ctx = ctx; e.erreurs = []; e.mobile = False
    H = e.page()
    viv = lambda: H.evaluate(DBQ).get("vivier") or []
    bulle = lambda pg: pg.evaluate("() => { const h = [...document.documentElement.children].find(x => x.shadowRoot); return h ? h.shadowRoot.querySelector('.t').textContent : ''; }")
    # pas encore connecté : la liste de locations attend, puis part après la connexion (« 2 900 €/mois » est bien un loyer)
    R = ctx.new_page(); R.goto("https://www.seloger.com/classified-search?distributionTypes=Rent&locations=paris"); R.wait_for_timeout(6000)
    assert not viv() and "Connectez-vous" in bulle(R), (len(viv()), bulle(R))
    e.connexion(H, "johan@x.fr", "Johan"); H.wait_for_timeout(8000)
    loc = [v for v in viv() if v["kind"] == "location"]
    assert sorted(v["price"] for v in loc) == [1450, 2900, 4000], [(v["kind"], v["price"]) for v in viv()]
    R.close()
    S = ctx.new_page(); S.goto("https://www.seloger.com/recherche?tri=date"); S.wait_for_timeout(7000)
    assert len(viv()) == 7, [v.get("url") for v in viv()]
    assert "4 nouvelles annonces" in bulle(S), bulle(S)
    assert S.evaluate("() => !![...document.documentElement.children].find(x => x.shadowRoot).shadowRoot.querySelector('a')"), "pas de lien vers la page suivante"
    # le lendemain : la même liste, un prix a baissé → rien de nouveau, prix à jour avec son historique
    prix["b"] = 549000
    S.reload(); S.wait_for_timeout(7000)
    b = next(v for v in viv() if v["url"].endswith("900002.htm"))
    assert len(viv()) == 7 and b["price"] == 549000 and b["prix_hist"][-1]["price"] == 580000, b
    assert "Rien de nouveau" in bulle(S), bulle(S)
    # la fiche complète : toutes les photos, l'étage, la rue
    S.goto("https://www.seloger.com/annonces/achat/appartement/paris-11eme-75/900001.htm"); S.wait_for_timeout(7000)
    a = next(v for v in viv() if v["url"].endswith("900001.htm"))
    assert len(a["carte"]["imgs"]) == 9 and a["data"].get("complet") and a["data"].get("floor") == 4, (len(a["carte"]["imgs"]), a["data"])
    # une liste dont les résultats arrivent en JSON (Bien'ici) : chaque annonce part avec sa fiche (étage, DPE, quartier, position approchée, description)
    Bi = ctx.new_page(); Bi.goto("https://www.bienici.com/recherche/achat/paris-75000/appartement"); Bi.wait_for_timeout(7000)
    bi = [v for v in viv() if "bienici" in v["url"]]
    assert len(bi) == 3, [v["url"] for v in viv()]
    d = next(v for v in bi if v["price"] == 640000)["data"]
    assert (d.get("floor"), d.get("elevator"), d.get("dpe"), d.get("exposure"), d.get("building"), d.get("quartier"), d.get("placeLevel")) == (4, True, "C", "sud", "gardien", "Folie-Méricourt", "rue") and d.get("descLen", 0) > 600 and d.get("cachet"), d
    Bi.close()
    # une fiche retirée sort d'Explorer
    S.goto("https://www.seloger.com/annonces/achat/appartement/paris-10eme-75/900004.htm"); S.wait_for_timeout(7000)
    assert next(v for v in viv() if v["url"].endswith("900004.htm"))["gone_at"], "annonce retirée toujours dans le flux"
    assert not e.erreurs, e.erreurs; ctx.close()


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
