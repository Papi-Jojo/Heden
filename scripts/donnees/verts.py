"""Espaces verts de Paris et de la petite couronne, d'après OpenStreetMap, pour le filtre « Espaces verts » de la carte.

Ce qu'on garde : parcs, jardins publics, squares, bois et forêts, cimetières, terrains de loisirs, grandes pelouses.
Ce qu'on écarte : les jardins privés (access=private), les pelouses et friches (talus du périphérique, des voies ferrées,
des aéroports) et toute bande étroite (un talus boisé n'est pas un bois). Les contours sont réunis, simplifiés à 4 m près ; chaque espace reçoit des arbres posés en semis régulier légèrement
décalé (un arbre tous les 45 à 80 m selon la taille), à l'écart des bords, pour être dessinés en petits pictogrammes.

Sortie : data/verts.json = {"v": date, "p": [[[ [lng, lat], ... ], trous...], ...], "a": [[lng, lat, variante], ...]}
Usage : python scripts/donnees/verts.py data   (ou : data brut.json pour rejouer sans Overpass)
"""
import json, math, sys, time, urllib.request, urllib.parse, datetime, hashlib
from shapely.geometry import Polygon, MultiPolygon, LineString, Point
from shapely.ops import polygonize, unary_union

OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
BBOX = "48.72,2.13,48.99,2.57"   # Paris et petite couronne (BOUNDS de l'app)
Q = f"""[out:json][timeout:300][bbox:{BBOX}];
(way["leisure"~"^(park|garden|nature_reserve|recreation_ground|village_green)$"];
 relation["leisure"~"^(park|garden|nature_reserve|recreation_ground)$"];
 way["landuse"~"^(forest|cemetery|recreation_ground|village_green)$"];
 relation["landuse"~"^(forest|cemetery|recreation_ground)$"];
 way["natural"="wood"];
 relation["natural"="wood"];);
out geom;"""
LAT0 = 48.8566
KX, KY = 111320 * math.cos(math.radians(LAT0)), 110540
xy = lambda lat, lng: (lng * KX, lat * KY)
lnglat = lambda x, y: [round(x / KX, 5), round(y / KY, 5)]
ETROIT = .12   # compacité minimale (4πA/P²) d'un espace de moins de 5 ha : écarte les talus et les bandes le long des voies


def fetch():
    body = urllib.parse.urlencode({"data": Q}).encode()
    for k in range(6):
        url = OVERPASS[k % len(OVERPASS)]
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": "heden-verts/1 (github.com/Papi-Jojo/Heden)"})
            with urllib.request.urlopen(req, timeout=320) as r:
                return json.load(r)
        except Exception as e:
            print("Overpass", url, e); time.sleep(20 * (k + 1))
    raise SystemExit("Overpass injoignable")


def geom(el):
    if el["type"] == "way":
        g = el.get("geometry") or []
        if len(g) < 4 or (g[0]["lat"], g[0]["lon"]) != (g[-1]["lat"], g[-1]["lon"]): return None
        p = Polygon([xy(q["lat"], q["lon"]) for q in g])
        return p if p.is_valid else p.buffer(0)
    outer, inner = [], []
    for m in el.get("members", []):
        if m.get("type") != "way" or len(m.get("geometry") or []) < 2: continue
        (inner if m.get("role") == "inner" else outer).append(LineString([xy(q["lat"], q["lon"]) for q in m["geometry"]]))
    out = [p for p in polygonize(unary_union(outer)) if p.area > 1] if outer else []
    if not out: return None
    g = unary_union(out)
    if inner:
        holes = [p for p in polygonize(unary_union(inner)) if p.area > 1]
        if holes: g = g.difference(unary_union(holes))
    return g if g.is_valid else g.buffer(0)


def garder(t, g):
    if t.get("access") in ("private", "no") or t.get("garden:type") in ("residential", "private"): return False
    if g.area < 250: return False
    return g.area >= 50000 or 4 * math.pi * g.area / max(1, g.length) ** 2 >= ETROIT


def arbres(poly, n_max):
    """Semis décalé (quinconce + léger tremblement déterministe), à l'écart des bords ; un arbre au moins pour un square."""
    a = poly.area
    pas = 45 if a < 20000 else 60 if a < 200000 else 90 if a < 2e6 else 130
    dedans = poly.buffer(-min(10, pas / 4))
    if dedans.is_empty: dedans = poly
    x0, y0, x1, y1 = dedans.bounds
    pts = []
    j = 0
    y = y0 + pas / 2
    while y < y1 and len(pts) < n_max:
        x = x0 + (pas / 2 if j % 2 else pas / 4)
        while x < x1 and len(pts) < n_max:
            h = hashlib.md5(f"{round(x)},{round(y)}".encode()).digest()
            px, py = x + (h[0] / 255 - .5) * pas * .45, y + (h[1] / 255 - .5) * pas * .45
            if dedans.contains(Point(px, py)): pts.append(lnglat(px, py) + [h[2] % 3])
            x += pas
        y += pas * .87; j += 1
    if not pts and a >= 400:
        r = poly.representative_point(); h = hashlib.md5(f"{round(r.x)},{round(r.y)}".encode()).digest()
        pts.append(lnglat(r.x, r.y) + [h[2] % 3])
    return pts


def build(raw):
    gs = []
    for el in raw.get("elements", []):
        t = el.get("tags") or {}
        g = geom(el)
        if g is None or g.is_empty or not garder(t, g): continue
        gs.append(g)
    print(len(gs), "espaces lus")
    u = unary_union(gs).simplify(4, preserve_topology=True)
    parts = list(u.geoms) if isinstance(u, MultiPolygon) else [u]
    parts = [p for p in parts if isinstance(p, Polygon) and p.area >= 250 and (p.area >= 50000 or 4 * math.pi * p.area / p.length ** 2 >= ETROIT)]
    polys, trees = [], []
    for p in sorted(parts, key=lambda q: -q.area):
        rings = [[lnglat(x, y) for x, y in p.exterior.coords]] + [[lnglat(x, y) for x, y in r.coords] for r in p.interiors if Polygon(r).area >= 400]
        polys.append(rings)
        trees += arbres(p, 2500)
    print(len(polys), "espaces,", len(trees), "arbres,", round(sum(p.area for p in parts) / 1e4), "ha")
    return {"v": datetime.date.today().isoformat(), "p": polys, "a": trees}


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "data"
    raw = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else fetch()
    d = build(raw)
    with open(f"{out}/verts.json", "w") as f: json.dump(d, f, separators=(",", ":"))
    import os; print("verts.json :", round(os.path.getsize(f"{out}/verts.json") / 1024), "Ko")
