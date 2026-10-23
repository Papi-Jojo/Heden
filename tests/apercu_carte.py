"""Aperçu du fond de carte servi avec le site (tuiles Protomaps de dist/carte/), pour le relire avant la mise en ligne.
Captures dans apercu-carte/ : Paris, un quartier, une rue, les espaces verts, les crédits ouverts ; téléphone et ordinateur.
Lancé en intégration continue après les essais (python tests/apercu_carte.py) ; sans dist/carte/paris.pmtiles, il ne fait rien."""
import http.server, os, re, sys, threading
from playwright.sync_api import sync_playwright

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST, OUT, PORT = os.path.join(RACINE, "dist"), os.path.join(RACINE, "apercu-carte"), 8791
if not os.path.exists(os.path.join(DIST, "carte", "paris.pmtiles")): sys.exit("pas de tuiles : rien à montrer")
os.makedirs(OUT, exist_ok=True)


class Serveur(http.server.SimpleHTTPRequestHandler):
    """Serveur de fichiers qui sait répondre aux requêtes partielles (Range), comme GitHub Pages."""
    def __init__(self, *a, **k): super().__init__(*a, directory=DIST, **k)
    def log_message(self, *a): pass
    def do_GET(self):
        rg = self.headers.get("Range"); p = self.translate_path(self.path.split("?")[0])
        if not rg or not os.path.isfile(p): return super().do_GET()
        m = re.match(r"bytes=(\d+)-(\d*)", rg); n = os.path.getsize(p)
        a = int(m.group(1)); b = min(int(m.group(2)) if m.group(2) else n - 1, n - 1)
        with open(p, "rb") as f: f.seek(a); body = f.read(b - a + 1)
        self.send_response(206); self.send_header("Content-Type", "application/octet-stream"); self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {a}-{b}/{n}"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)


srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Serveur)
threading.Thread(target=srv.serve_forever, daemon=True).start()
NM = os.path.join(RACINE, "node_modules")
LIBS = {"maplibre-gl.js": "maplibre-gl/dist/maplibre-gl.js", "maplibre-gl.css": "maplibre-gl/dist/maplibre-gl.css", "leaflet-maplibre-gl.js": "@maplibre/maplibre-gl-leaflet/leaflet-maplibre-gl.js",
        "leaflet.min.js": "leaflet/dist/leaflet.js", "leaflet.min.css": "leaflet/dist/leaflet.css", "turf.min.js": "@turf/turf/turf.min.js"}
VUES = [("paris", 48.858, 2.345, 12), ("quartier", 48.8845, 2.3400, 15), ("rue", 48.8590, 2.3620, 17), ("verts", 48.8800, 2.3830, 15.5)]
import traceback
JOURNAL = os.path.join(OUT, "journal.txt"); open(JOURNAL, "w").close()
def note(t):
    with open(JOURNAL, "a") as j: j.write(t + "\n")
with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    for w, h in [(390, 844), (1280, 860)]:
        ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, service_workers="block")
        ctx.add_init_script("localStorage.setItem('heden.quiz.later', String(Date.now())); sessionStorage.setItem('heden.intro','1'); localStorage.setItem('heden.tips.off','1')")
        def route(r):
            u = r.request.url.split("?")[0]
            for k, f in LIBS.items():
                if u.endswith(k): return r.fulfill(path=os.path.join(NM, f), content_type="text/css" if k.endswith(".css") else "application/javascript")
            if "127.0.0.1" in u: return r.continue_()
            return r.abort()   # aucun service tiers : le fond doit venir du site
        ctx.route("**/*", route)
        pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text[:200]}") if m.type in ("error", "warning") and len(errs) < 40 else None)
        pg.on("requestfailed", lambda r: errs.append(f"échec {r.url[:120]}") if "127.0.0.1" in r.url and len(errs) < 40 else None)
        pg.goto(f"http://127.0.0.1:{PORT}/index.html"); pg.wait_for_timeout(2500)
        note(f"{w} px, au chargement : " + str(pg.evaluate("(() => { try { const p = __heden.plan(), m = p && p.getMaplibreMap ? p.getMaplibreMap() : null; return m ? [m.getStyle() && m.getStyle().name, m.isStyleLoaded(), Object.keys(m.getStyle().sources)] : 'repli'; } catch (e) { return String(e); } })()")))
        for nom, lat, lng, z in VUES:
            if nom == "verts": pg.evaluate("localStorage.setItem('heden.vert','1')"); pg.reload(); pg.wait_for_timeout(2500)
            pg.evaluate(f"__heden.map.setView([{lat}, {lng}], {z}, {{animate: false}})"); pg.wait_for_timeout(3500)
            pg.screenshot(path=os.path.join(OUT, f"{nom}-{w}.png"))
        try:
            pg.locator(".credits__i").first.click(timeout=5000); pg.wait_for_timeout(400)
            pg.screenshot(path=os.path.join(OUT, f"credits-{w}.png"))
        except Exception as e: note("crédits : " + str(e)[:200])
        note("\n".join(errs[:40]))
        info = pg.evaluate("(() => { try { const p = __heden.plan(), m = p && p.getMaplibreMap ? p.getMaplibreMap() : null; return m ? [m.getStyle().name, m.isStyleLoaded(), m.queryRenderedFeatures().length, m.getZoom()] : 'repli'; } catch (e) { return String(e); } })()")
        with open(os.path.join(OUT, "journal.txt"), "a") as j: j.write(f"{w} px : fond {info}\n" + "\n".join(errs) + "\n\n")
        print(w, "fond :", info, errs[:10])
        ctx.close()
    b.close()
srv.shutdown()
