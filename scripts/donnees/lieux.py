"""Lieux connus de Paris, avec une vraie forme, pour proposer une zone (bouton « Choisir un lieu »).

Source : OpenStreetMap (Overpass).
  - les 80 quartiers administratifs (admin_level 10), tels quels ;
  - les lieux nommés (place=neighbourhood / quarter) : leur contour s'il est dessiné,
    sinon la part de Paris la plus proche de ce lieu que de tout autre (cellule de Voronoï),
    coupée aux limites de l'arrondissement et à 450 m autour du lieu.
Sortie : data/lieux.json = {"v": date, "arr": {"1": [{"n": nom, "k": "lieu"|"quartier", "p": [[lat, lng], ...]}, ...], ...}}

Usage : python scripts/donnees/lieux.py data            (télécharge)
        python scripts/donnees/lieux.py data brut.json  (rejoue une réponse Overpass enregistrée)
"""
import json, math, sys, time, urllib.request, urllib.parse, datetime
from shapely.geometry import Point, Polygon, MultiPolygon, LineString, MultiPoint
from shapely.ops import polygonize, unary_union
from shapely import voronoi_polygons

OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
Q = """[out:json][timeout:240];
area["boundary"="administrative"]["admin_level"="8"]["name"="Paris"]->.p;
(relation["boundary"="administrative"]["admin_level"~"^(9|10)$"](area.p);
 node["place"~"^(neighbourhood|quarter)$"]["name"](area.p);
 way["place"~"^(neighbourhood|quarter)$"]["name"](area.p);
 relation["place"~"^(neighbourhood|quarter)$"]["name"](area.p););
out geom;"""
LAT0 = 48.8566
KX, KY = 111320 * math.cos(math.radians(LAT0)), 110540  # mètres par degré, à la latitude de Paris
xy = lambda lat, lng: (lng * KX, lat * KY)
ll = lambda x, y: [round(y / KY, 5), round(x / KX, 5)]
RAYON, MAX_PTS, MIN_HA = 450, 18, 2


def fetch():
    body = urllib.parse.urlencode({"data": Q}).encode()
    for k in range(6):
        url = OVERPASS[k % len(OVERPASS)]
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": "heden-lieux/1 (github.com/Papi-Jojo/Heden)"})
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.load(r)
        except Exception as e:  # serveur occupé : on réessaie ailleurs
            print("Overpass", url, e); time.sleep(20 * (k + 1))
    raise SystemExit("Overpass injoignable")


def poly_of(el):
    """Contour d'une relation ou d'un chemin fermé rendu par « out geom »."""
    if el["type"] == "way":
        g = el.get("geometry") or []
        return Polygon([xy(p["lat"], p["lon"]) for p in g]) if len(g) >= 4 else None
    lines = [LineString([xy(p["lat"], p["lon"]) for p in m["geometry"]]) for m in el.get("members", [])
             if m.get("type") == "way" and m.get("role", "outer") in ("outer", "") and len(m.get("geometry") or []) >= 2]
    ps = [p for p in polygonize(unary_union(lines)) if p.area > 1]
    return unary_union(ps) if ps else None


def small(g):
    """Le plus grand morceau, simplifié jusqu'à MAX_PTS sommets (assez pour se lire, assez peu pour s'ajuster au doigt)."""
    if isinstance(g, MultiPolygon): g = max(g.geoms, key=lambda x: x.area)
    if not isinstance(g, Polygon) or g.is_empty: return None
    tol = 4
    s = g.simplify(tol)
    while len(s.exterior.coords) - 1 > MAX_PTS and tol < 200:
        tol *= 1.4; s = g.simplify(tol)
    return [ll(x, y) for x, y in list(s.exterior.coords)[:-1]]


def build(raw):
    els = raw["elements"]
    arrs, quartiers, lieux = {}, [], []
    for el in els:
        t = el.get("tags", {})
        if t.get("boundary") == "administrative" and t.get("admin_level") == "9":
            ref = t.get("ref:INSEE", "")
            n = int(ref[-2:]) if ref.startswith("751") else None
            g = poly_of(el)
            if n and g is not None: arrs[n] = g
    for el in els:
        t = el.get("tags", {})
        if t.get("boundary") == "administrative" and t.get("admin_level") == "10":
            g = poly_of(el)
            if g is not None: quartiers.append((t.get("name", "").strip(), g))
        elif t.get("place") in ("neighbourhood", "quarter") and t.get("name"):
            if el["type"] == "node": lieux.append((t["name"].strip(), Point(*xy(el["lat"], el["lon"])), None))
            else:
                g = poly_of(el)
                if g is not None and g.area > 1: lieux.append((t["name"].strip(), g.representative_point(), g))
    if len(arrs) < 20: raise SystemExit(f"arrondissements incomplets : {sorted(arrs)}")
    paris = unary_union(list(arrs.values()))
    arr_of = lambda pt: next((n for n, g in arrs.items() if g.contains(pt)), None)
    out = {str(n): [] for n in range(1, 21)}
    # quartiers administratifs : la forme officielle
    for name, g in quartiers:
        n = arr_of(g.representative_point())
        p = small(g)
        if n and p and name: out[str(n)].append({"n": name, "k": "quartier", "p": p})
    # lieux : un seul par nom, dans Paris
    seen, pts = set(), []
    for name, pt, g in lieux:
        key = name.lower()
        if key in seen or not paris.contains(pt): continue
        seen.add(key); pts.append((name, pt, g))
    cells = voronoi_polygons(MultiPoint([p for _, p, _ in pts]), extend_to=paris.envelope)
    by_pt = {}
    for c in cells.geoms:
        for i, (_, p, _) in enumerate(pts):
            if c.contains(p): by_pt[i] = c; break
    for i, (name, pt, g) in enumerate(pts):
        n = arr_of(pt)
        if not n: continue
        if g is not None and g.area < 4e6: shape = g.intersection(paris)          # contour dessiné dans OSM
        else: shape = by_pt.get(i, pt.buffer(RAYON)).intersection(arrs[n]).intersection(pt.buffer(RAYON, 16))
        if shape.is_empty or shape.area < MIN_HA * 1e4: continue
        p = small(shape)
        if p: out[str(n)].append({"n": name, "k": "lieu", "p": p})
    for k in out: out[k].sort(key=lambda x: (x["k"] != "lieu", x["n"].lower()))
    return {"v": datetime.date.today().isoformat(), "arr": out}


if __name__ == "__main__":
    dest = sys.argv[1] if len(sys.argv) > 1 else "data"
    raw = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else fetch()
    res = build(raw)
    n_l = sum(1 for v in res["arr"].values() for x in v if x["k"] == "lieu")
    n_q = sum(1 for v in res["arr"].values() for x in v if x["k"] == "quartier")
    print(f"{n_l} lieux, {n_q} quartiers administratifs")
    for k, v in res["arr"].items(): print(k, len(v), ", ".join(x["n"] for x in v if x["k"] == "lieu")[:160])
    if n_q < 60 or n_l < 40: raise SystemExit("trop peu de lieux : fichier non écrit")
    with open(f"{dest}/lieux.json", "w", encoding="utf-8") as f: json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
