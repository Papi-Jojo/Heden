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
    pg.locator(".hero .hero__fav").first.click(); pg.wait_for_timeout(2200)   # la synchro passe pendant que la notification est affichée
    assert pg.evaluate("__heden.state().listings[0].status") == "gardee", "le cœur n'a pas mis l'annonce en favori"
    pg.locator("#toast .toast__act").click(); pg.wait_for_timeout(600)
    assert pg.evaluate("__heden.state().listings[0].status") == "nouvelle", "Annuler n'a rien fait"
    pg.wait_for_timeout(1500)
    assert pg.evaluate(DBQ + ".listings[0].status") == "nouvelle", "l'annulation n'est pas partie au serveur"
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
    assert "3 nouvelles" in pg.locator(".feed--explorer .feed__n").inner_text(), "Explorer n'annonce pas les nouveautés"
    pg.locator("[data-feed=explorer]").click(); pg.wait_for_timeout(800)
    assert pg.locator(".hero--ex").count() == 3, "Explorer ne montre pas les annonces du flux Heden"
    pg.locator(".hero--ex .hero__fav").first.click(); pg.wait_for_timeout(900)
    got = pg.evaluate("__heden.state().listings.filter(f => f.origin === 'vivier').map(f => [f.source, f.status])")
    assert got == [["SeLoger", "gardee"]], got
    pg.locator(".hero--ex .hero__drop").nth(1).click(); pg.wait_for_timeout(900)
    assert pg.locator(".hero--ex").count() == 2, "l'annonce masquée reste dans Explorer"
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
