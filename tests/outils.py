"""Outils des essais : petit serveur sur dist/, faux Supabase, bibliothèques de carte servies depuis node_modules (aucun réseau)."""
import http.server, json, os, threading, urllib.parse
from playwright.sync_api import sync_playwright  # noqa: F401  (réexporté pour les essais)

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NM = os.path.join(RACINE, "node_modules")
PORT = int(os.environ.get("HEDEN_PORT", "8766"))
B = f"http://127.0.0.1:{PORT}/index.html"
lire = lambda p: open(os.path.join(NM, p), "rb").read()
CDN = {  # adresse publique → fichier local (mêmes versions que index.html)
    "maplibre-gl.js": ("maplibre-gl/dist/maplibre-gl.js", "application/javascript"),
    "maplibre-gl.css": ("maplibre-gl/dist/maplibre-gl.css", "text/css"),
    "leaflet-maplibre-gl.js": ("@maplibre/maplibre-gl-leaflet/dist/leaflet-maplibre-gl.js", "application/javascript"),
    "leaflet.min.js": ("leaflet/dist/leaflet.js", "application/javascript"),
    "leaflet.min.css": ("leaflet/dist/leaflet.css", "text/css"),
    "turf.min.js": ("@turf/turf/turf.min.js", "application/javascript"),
}
MOCK = open(os.path.join(RACINE, "tests", "faux-supabase.js")).read()
AXE = lire("axe-core/axe.min.js").decode()
CONFIG = 'window.HEDEN_CONFIG={supabaseUrl:"https://x.supabase.co",supabaseAnonKey:"k",codeParEmail:true};'


class Serveur(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = urllib.parse.unquote(path.split("?")[0])
        return os.path.join(RACINE, "dist", p.lstrip("/"))
    def do_GET(self):
        if self.path.startswith("/config.js"):
            self.send_response(200); self.send_header("Content-Type", "application/javascript"); self.end_headers(); self.wfile.write(CONFIG.encode()); return
        return super().do_GET()
    def log_message(self, *a): pass


def demarrer():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Serveur)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def routes(r):
    u = r.request.url
    if "supabase-js" in u: return r.fulfill(body=MOCK, content_type="application/javascript")
    if "127.0.0.1" in u: return r.continue_()
    for k, (f, t) in CDN.items():
        if u.split("?")[0].endswith(k): return r.fulfill(body=lire(f), content_type=t)
    if "nominatim" in u:  # géocodage : un point fixe dans Paris
        return r.fulfill(body=json.dumps([{"lat": "48.8840", "lon": "2.3375", "display_name": "Paris"}]), content_type="application/json", headers={"access-control-allow-origin": "*"})
    if "data.geopf.fr/geocodage" in u:  # Base Adresse Nationale : la rue demandée, au code postal demandé
        q = urllib.parse.parse_qs(urllib.parse.urlparse(u).query); cp = q.get("postcode", ["75011"])[0]
        f = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [2.3700, 48.8650]}, "properties": {"score": 0.9, "type": "street", "postcode": cp, "label": q["q"][0] + " " + cp + " Paris"}}
        return r.fulfill(body=json.dumps({"features": [f]}), content_type="application/json", headers={"access-control-allow-origin": "*"})
    if "data.ademe.fr" in u:  # DPE officiels : un logement si la consommation est donnée, deux possibles sinon
        q = urllib.parse.parse_qs(urllib.parse.urlparse(u).query); qs = q.get("qs", [""])[0]
        import re
        lo, hi = map(float, re.search(r"surface_habitable_logement:\[([\d.]+) TO ([\d.]+)\]", qs).groups()); mid = (lo + hi) / 2
        cp = re.search(r"code_postal_ban:(\d+)", qs).group(1); kw = re.search(r"conso_5_usages_par_m2_ep:\[([\d.]+) TO", qs)
        rue = "Rue " + q.get("q", ["Oberkampf"])[0].title()
        rec = lambda n, s, k, ad, pt: {"numero_dpe": f"2375E00000{n}", "adresse_ban": f"{ad} {cp} Paris", "nom_rue_ban": rue, "etiquette_dpe": "D", "surface_habitable_logement": s,
                                       "conso_5_usages_par_m2_ep": k, "date_etablissement_dpe": "2023-01-13", "numero_etage_appartement": None, "annee_construction": 1930, "_geopoint": pt}
        rs = [rec(1, round(mid, 1), float(kw.group(1)) + 0.5, "147 " + rue, "48.8667,2.3814")] if kw else [rec(2, round(mid, 1), 190, "3 " + rue, "48.8885,2.3359"), rec(3, round(mid + .3, 1), 240, "41 " + rue, "48.8890,2.3370")]
        return r.fulfill(body=json.dumps({"total": len(rs), "results": rs}), content_type="application/json", headers={"access-control-allow-origin": "*"})
    return r.abort()  # tuiles, polices, photos : hors ligne


INIT = "localStorage.setItem('heden.quiz.later', String(Date.now())); sessionStorage.setItem('heden.intro','1'); localStorage.setItem('heden.tips.off','1')"


class Essai:
    """Un navigateur, des pages qui partagent la fausse base (comme plusieurs appareils), une session chacune."""
    def __init__(self, pw, largeur=390, hauteur=844, langue="fr", **kw):
        self.b = pw.chromium.launch()
        self.ctx = self.b.new_context(viewport={"width": largeur, "height": hauteur}, service_workers="block", **kw)  # le service worker contournerait les routes de test
        self.ctx.add_init_script(INIT + (";localStorage.setItem('heden.lang','en')" if langue == "en" else ""))
        self.ctx.route("**/*", routes)
        self.erreurs = []
        self.mobile = largeur < 900

    def page(self, url=B):
        pg = self.ctx.new_page()
        pg.on("pageerror", lambda e: self.erreurs.append(str(e)[:300]))
        pg.goto(url); pg.wait_for_timeout(1200)
        return pg

    def onglet(self, pg, t):
        pg.locator((".tabbar" if self.mobile else ".tabs") + f" [data-tab='{t}']").click(); pg.wait_for_timeout(300)

    def connexion(self, pg, mail, nom):
        self.onglet(pg, "profile"); pg.click("[data-ptab='compte']"); pg.wait_for_timeout(200)
        pg.locator(".acctrow [data-auth]").click(); pg.wait_for_timeout(300)
        pg.fill("#loginMail", mail); pg.click("#mailForm button[type=submit]"); pg.wait_for_timeout(200)
        pg.fill("#loginCode", "123456"); pg.wait_for_timeout(2000)
        if pg.locator(".ask [data-no]").count(): pg.locator(".ask [data-no]").last.click(); pg.wait_for_timeout(300)
        pg.evaluate("document.activeElement && document.activeElement.blur()")
        self.onglet(pg, "profile"); pg.click("[data-ptab='compte']"); pg.wait_for_timeout(200)
        pg.fill("#pname", nom); pg.locator("#pname").dispatch_event("input"); pg.evaluate("document.activeElement.blur()"); pg.wait_for_timeout(1200)

    def zone(self, pg, nom, lat=48.884, lng=2.3375):
        pg.evaluate(f"() => {{ __heden.startNew(); const d = 0.0012; [[{lat},{lng}],[{lat}+d,{lng}],[{lat}+d,{lng}+d*1.4],[{lat},{lng}+d*1.4]].forEach(p => __heden.addPoint(L.latLng(p[0], p[1]))); }}")
        pg.wait_for_timeout(300); pg.click("#confirm"); pg.wait_for_timeout(800)
        pg.fill("#zname", nom); pg.evaluate("document.activeElement.blur()"); pg.click("#saveZ"); pg.wait_for_timeout(900)
        pg.click("#close"); pg.wait_for_timeout(300)

    def axe(self, pg):
        pg.add_script_tag(content=AXE)
        return pg.evaluate("async () => (await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations.map(v => v.id + ' ×' + v.nodes.length)")

    def fermer(self):
        self.b.close()
