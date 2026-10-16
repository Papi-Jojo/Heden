"""Heden : préparation des données objectives par tuile.

Télécharge
  - les ventes immobilières DVF géolocalisées (Etalab, data.gouv.fr) de Paris et de la petite couronne,
  - les lieux du quotidien d'OpenStreetMap (commerces, écoles, stations, parcs...),
puis écrit dans data/ :
  - meta.json : grille, périodes, seuils de notation (calibrés sur les lieux où des appartements se vendent), parcs ;
  - t/<i>_<j>.json : une tuile d'environ 1,1 km de côté.

Usage : python build.py <dossier_sortie>
Variables facultatives : HEDEN_DVF_DIR (CSV déjà téléchargés), HEDEN_OSM_POI / HEDEN_OSM_PARKS (JSON Overpass déjà téléchargés).
"""
import csv, gzip, io, json, math, os, random, re, sys, time, urllib.parse, urllib.request
from collections import defaultdict
from datetime import date

S, W, N, E = 48.72, 2.13, 48.99, 2.57
DLAT, DLNG = 0.01, 0.015
NI, NJ = math.ceil((N - S) / DLAT), math.ceil((E - W) / DLNG)
KX, KY = 111320 * math.cos(math.radians(48.86)), 110540   # mètres par degré (identique dans l'appli)
DEPTS = ["75", "92", "93", "94"]
UA = {"User-Agent": "Heden/1.0 (https://github.com/Papi-Jojo/Heden)"}
OUT = sys.argv[1] if len(sys.argv) > 1 else "data"

def log(*a): print(*a, flush=True)

def get(url, data=None, tries=4, timeout=900):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            log(f"  échec {url} ({e}), nouvel essai")
            time.sleep(20 * (k + 1))
    raise RuntimeError("téléchargement impossible : " + url)

def tile_of(lat, lng):
    i, j = int((lat - S) // DLAT), int((lng - W) // DLNG)
    return (i, j) if 0 <= i < NI and 0 <= j < NJ else None

def offs(lat, lng, t):
    return round((lat - S - t[0] * DLAT) * 1e5), round((lng - W - t[1] * DLNG) * 1e5)

def month_idx(y, m): return (y - 2000) * 12 + (m - 1)

# =====================================================================
# 1. DVF
# =====================================================================
def dvf_sales():
    base = "https://files.data.gouv.fr/geo-dvf/latest/csv/"
    local = os.environ.get("HEDEN_DVF_DIR")
    if local:
        files = sorted(os.path.join(local, f) for f in os.listdir(local) if f.endswith((".csv", ".csv.gz")))
        sources = [(f, lambda f=f: open(f, "rb").read()) for f in files]
    else:
        years = sorted(set(int(y) for y in re.findall(r'href="(\d{4})/"', get(base).decode())))
        years = years[-3:]
        log("DVF, années :", years)
        sources = [(f"{y}/{d}", lambda y=y, d=d: get(f"{base}{y}/departements/{d}.csv.gz")) for y in years for d in DEPTS]
    muts = {}
    for name, fetch in sources:
        raw = fetch()
        if raw[:2] == b"\x1f\x8b": raw = gzip.decompress(raw)
        rows = csv.DictReader(io.StringIO(raw.decode("utf-8")))
        n = 0
        for r in rows:
            n += 1
            mid = r["id_mutation"]
            m = muts.get(mid)
            if m is None:
                m = muts[mid] = {"nature": r["nature_mutation"], "val": r["valeur_fonciere"], "date": r["date_mutation"],
                                 "locs": set(), "other": False, "parc": set(), "lat": None, "lng": None}
            m["parc"].add(r["id_parcelle"])
            t = r["type_local"]
            if t in ("Appartement", "Maison"):
                m["locs"].add((t, r["surface_reelle_bati"], r["id_parcelle"], r["lot1_numero"]))
                if r["latitude"] and r["longitude"]:
                    m["lat"], m["lng"] = float(r["latitude"]), float(r["longitude"])
            elif t == "Local industriel. commercial ou assimilé":
                m["other"] = True
        log(f"  {name} : {n} lignes")
    out = []
    for m in muts.values():
        if m["nature"] != "Vente" or m["other"] or len(m["locs"]) != 1 or len(m["parc"]) > 2 or m["lat"] is None:
            continue
        t, surf, _, _ = next(iter(m["locs"]))
        try: surf, val = float(surf), float(m["val"])
        except ValueError: continue
        if surf < 9 or val <= 0: continue
        ppm = val / surf
        if not 1000 <= ppm <= 35000: continue
        y, mo = int(m["date"][:4]), int(m["date"][5:7])
        out.append((m["lat"], m["lng"], round(ppm), month_idx(y, mo), round(surf), 0 if t == "Appartement" else 1))
    log("DVF : ventes retenues", len(out))
    return out

# =====================================================================
# 2. OpenStreetMap
# =====================================================================
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
BB = f"({S},{W},{N},{E})"
Q_POI = f"""[out:json][timeout:900][maxsize:2000000000];
(
 nwr["shop"~"^(bakery|pastry|supermarket|convenience|greengrocer|butcher|cheese|deli|seafood|organic|books)$"]{BB};
 nwr["amenity"~"^(pharmacy|marketplace|restaurant|cafe|bar|pub|biergarten|nightclub|fast_food|cinema|theatre|arts_centre|music_venue|library|kindergarten|childcare|school|doctors|dentist|clinic|hospital|bicycle_rental)$"]{BB};
 nwr["tourism"~"^(museum|gallery)$"]{BB};
 nwr["healthcare"~"^(laboratory|centre)$"]{BB};
 nwr["leisure"~"^(fitness_centre|sports_centre|swimming_pool)$"]{BB};
 node["railway"~"^(station|halt|tram_stop)$"]{BB};
);
out center tags;"""
Q_PARKS = f"""[out:json][timeout:900][maxsize:2000000000];
(
 way["leisure"~"^(park|garden|nature_reserve)$"]{BB};
 relation["leisure"~"^(park|garden|nature_reserve)$"]{BB};
 way["landuse"~"^(forest|recreation_ground)$"]["name"]{BB};
 relation["landuse"="forest"]["name"]{BB};
);
out geom;"""

def overpass(q, env):
    if os.environ.get(env):
        return json.load(open(os.environ[env]))
    last = None
    for k in range(6):
        url = OVERPASS[k % len(OVERPASS)]
        try:
            log("Overpass :", url)
            return json.loads(get(url, urllib.parse.urlencode({"data": q}).encode(), tries=1))
        except Exception as e:
            last = e; time.sleep(30)
    raise RuntimeError(f"Overpass indisponible : {last}")

SCHOOL = [(r"coll[eè]ge", 33), (r"lyc[eé]e", 34), (r"maternelle", 31), (r"[eé]l[eé]mentaire|primaire", 32)]
SHOP = {"bakery": 1, "pastry": 1, "supermarket": 2, "convenience": 2, "greengrocer": 3, "butcher": 3, "cheese": 3,
        "deli": 3, "seafood": 3, "organic": 3, "books": 24}
AMEN = {"pharmacy": 4, "marketplace": 5, "restaurant": 10, "cafe": 11, "bar": 12, "pub": 12, "biergarten": 12,
        "nightclub": 13, "fast_food": 14, "cinema": 20, "theatre": 21, "arts_centre": 21, "music_venue": 21,
        "library": 23, "doctors": 40, "dentist": 41, "clinic": 43, "hospital": 44, "bicycle_rental": 50}
NAMED = {5, 44, 60, 61, 62}

def classify(tg):
    if tg.get("access") in ("private", "no", "customers"): return None
    a, s = tg.get("amenity"), tg.get("shop")
    name = tg.get("name", "")
    if s in SHOP: return SHOP[s]
    if a == "childcare": return 30
    if a == "kindergarten":
        return 30 if re.search(r"cr[eè]che|multi|halte|micro|jardin d", name, re.I) else 31
    if a == "school":
        fr = (tg.get("school:FR") or "") + " " + name
        for rx, c in SCHOOL:
            if re.search(rx, fr, re.I): return c
        return 35
    if a in AMEN: return AMEN[a]
    if tg.get("tourism") in ("museum", "gallery"): return 22
    if tg.get("healthcare") == "laboratory": return 42
    if tg.get("healthcare") == "centre": return 43
    l = tg.get("leisure")
    if l in ("fitness_centre", "sports_centre"): return 55
    if l == "swimming_pool": return 55 if name else None
    r = tg.get("railway")
    if r == "tram_stop": return 62
    if r in ("station", "halt"):
        st = tg.get("station", "")
        if st == "subway" or tg.get("subway") == "yes": return 60
        if st == "light_rail" or tg.get("light_rail") == "yes" or tg.get("tram") == "yes": return 62
        if st in ("", "train") or tg.get("train") == "yes": return 61
    return None

def osm_pois():
    d = overpass(Q_POI, "HEDEN_OSM_POI")
    out, seen = [], {}
    for el in d["elements"]:
        tg = el.get("tags", {})
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lng = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None: continue
        c = classify(tg)
        if c is None: continue
        name = tg.get("name", "")
        if c in (60, 61, 62):   # une station par nom et par mode
            key = (c, name.lower())
            if any(abs(lat - a) * KY < 250 and abs(lng - b) * KX < 250 for a, b in seen.get(key, [])): continue
            seen.setdefault(key, []).append((lat, lng))
        out.append((lat, lng, c, name if c in NAMED else ""))
    log("OSM : lieux", len(out))
    return out

def ring_area(pts):
    xy = [(p[1] * KX, p[0] * KY) for p in pts]
    return abs(sum(xy[i][0] * xy[i - 1][1] - xy[i - 1][0] * xy[i][1] for i in range(len(xy)))) / 2

def assemble(ways):
    """Relie des morceaux de contour bout à bout ; renvoie les anneaux fermés."""
    ways = [w[:] for w in ways if len(w) >= 2]
    rings = []
    while ways:
        cur = ways.pop(0)
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for k, w in enumerate(ways):
                if w[0] == cur[-1]: cur += w[1:]
                elif w[-1] == cur[-1]: cur += w[::-1][1:]
                elif w[-1] == cur[0]: cur = w + cur[1:]
                elif w[0] == cur[0]: cur = w[::-1] + cur[1:]
                else: continue
                ways.pop(k); changed = True; break
        if cur[0] == cur[-1] and len(cur) >= 4: rings.append(cur)
    return rings

def osm_parks():
    d = overpass(Q_PARKS, "HEDEN_OSM_PARKS")
    parks = []
    for el in d["elements"]:
        tg = el.get("tags", {})
        if tg.get("access") in ("private", "no", "customers"): continue
        if tg.get("leisure") == "garden" and not tg.get("name"): continue
        if el["type"] == "way":
            g = [(p["lat"], p["lon"]) for p in el.get("geometry", [])]
            if len(g) < 4 or g[0] != g[-1]: continue
            outer, inner = [g], []
        else:
            mem = [m for m in el.get("members", []) if m.get("type") == "way" and m.get("geometry")]
            outer = assemble([[(p["lat"], p["lon"]) for p in m["geometry"]] for m in mem if m.get("role") != "inner"])
            inner = assemble([[(p["lat"], p["lon"]) for p in m["geometry"]] for m in mem if m.get("role") == "inner"])
            if not outer: continue
        area = sum(ring_area(r) for r in outer) - sum(ring_area(r) for r in inner)
        if area < 1000: continue
        parks.append({"name": tg.get("name", ""), "area": round(area), "rings": outer})
    # un parc tracé deux fois (way + relation) : garder le plus grand
    parks.sort(key=lambda p: -p["area"])
    kept = []
    for p in parks:
        c = p["rings"][0][0]
        if any(q["name"] == p["name"] and q["area"] < p["area"] * 1.15 and
               min(math.hypot((c[0] - r[0]) * KY, (c[1] - r[1]) * KX) for r in q["rings"][0][::5]) < 300 for q in kept[-50:]):
            continue
        kept.append(p)
    log("OSM : parcs", len(kept))
    return kept

def resample(ring, step=40):
    pts = []
    for (a, b), (c, d) in zip(ring, ring[1:]):
        L = math.hypot((d - b) * KX, (c - a) * KY)
        n = max(1, int(L // step))
        for k in range(n): pts.append((a + (c - a) * k / n, b + (d - b) * k / n))
    return pts

# =====================================================================
# 3. Indicateurs (même formule que dans l'appli, fonction estimate())
# =====================================================================
GROUPS = {
    "commerces": ({1, 2, 3, 4, 5}, 300),
    "vie_sociale": ({10, 11, 12}, 400),
    "nuit": ({12, 13}, 400),
    "culture": ({20, 21, 22, 23, 24}, 800),
    "ecoles": ({30, 31, 32, 33}, 500),
    "sante": ({4, 40, 41, 42, 43}, 500),
    "velo": ({50}, 400),
}
STATION_R = 800
PARK_R = 800

class Index:
    def __init__(self, items):
        self.cells = defaultdict(list)
        for it in items: self.cells[(int(it[0] / 0.005), int(it[1] / 0.0075))].append(it)
    def near(self, lat, lng, r):
        ci, cj = int(lat / 0.005), int(lng / 0.0075)
        k = int(r / 550) + 1
        for a in range(ci - k, ci + k + 1):
            for b in range(cj - k, cj + k + 1):
                for it in self.cells.get((a, b), ()):
                    d = math.hypot((it[0] - lat) * KY, (it[1] - lng) * KX)
                    if d <= r: yield d, it

CODE_GROUPS = defaultdict(list)
for _k, (_codes, _r) in GROUPS.items():
    for _c in _codes: CODE_GROUPS[_c].append((_k, _r))

def metrics(lat, lng, pidx, gidx, parks, req=0.0):
    """Densités de lieux autour d'un point. req = rayon équivalent de la zone (0 pour un point)."""
    n = defaultdict(int)
    t = 0.0
    for d, it in pidx.near(lat, lng, max(800, STATION_R) + req):
        c = it[2]
        for key, r in CODE_GROUPS.get(c, ()):
            if d <= r + req: n[key] += 1
        if c in (60, 61, 62):
            dd = max(0.0, d - req)
            t += (1.5 if c == 61 else 1.0) * max(0.0, 1 - dd / STATION_R)
    m = {key: n[key] * (r / (r + req)) ** 2 for key, (_, r) in GROUPS.items()}
    m["transports"] = t
    best = {}
    for d, it in gidx.near(lat, lng, PARK_R + req):
        dd = max(0.0, d - req)
        if dd < best.get(it[2], 1e9): best[it[2]] = dd
    m["verts"] = sum(math.sqrt(parks[k]["area"] / 10000) * (1 - dd / PARK_R) for k, dd in best.items())
    return m

def quantiles(vals, qs=(0.1, 0.3, 0.5, 0.7, 0.9)):
    v = sorted(vals)
    return [round(v[min(len(v) - 1, int(q * len(v)))], 3) for q in qs]

# =====================================================================
def main():
    sales = dvf_sales()
    pois = osm_pois()
    parks = osm_parks()

    tiles = defaultdict(lambda: {"p": [], "s": [], "g": [], "v": []})
    for lat, lng, c, name in pois:
        t = tile_of(lat, lng)
        if not t: continue
        a, b = offs(lat, lng, t)
        if name: tiles[t]["s"].append([a, b, c, name])
        else: tiles[t]["p"] += [a, b, c]
    park_pts = []
    for k, p in enumerate(parks):
        for ring in p["rings"]:
            for lat, lng in resample(ring):
                park_pts.append((lat, lng, k))
                t = tile_of(lat, lng)
                if t:
                    a, b = offs(lat, lng, t); tiles[t]["g"] += [a, b, k]
    for lat, lng, ppm, mi, surf, typ in sales:
        t = tile_of(lat, lng)
        if t:
            a, b = offs(lat, lng, t); tiles[t]["v"] += [a, b, ppm, mi, surf, typ]

    # Calibration : indicateurs mesurés là où des appartements se vendent
    pidx = Index([(lat, lng, c) for lat, lng, c, _ in pois])
    gidx = Index(park_pts)
    last = max(s[3] for s in sales)
    recent = [s for s in sales if s[3] > last - 24 and s[5] == 0 and tile_of(s[0], s[1])]
    random.seed(7)
    sample = random.sample(recent, min(6000, len(recent)))
    ms = [metrics(s[0], s[1], pidx, gidx, parks) for s in sample]
    q = {k: quantiles([m[k] for m in ms]) for k in ms[0]}
    log("Seuils :", json.dumps(q))

    os.makedirs(os.path.join(OUT, "t"), exist_ok=True)
    for f in os.listdir(os.path.join(OUT, "t")): os.remove(os.path.join(OUT, "t", f))
    for (i, j), t in tiles.items():
        with open(os.path.join(OUT, "t", f"{i}_{j}.json"), "w") as fh:
            json.dump(t, fh, separators=(",", ":"), ensure_ascii=False)
    first = min(s[3] for s in sales)
    meta = {
        "version": date.today().isoformat(),
        "grid": {"s": S, "w": W, "n": N, "e": E, "dlat": DLAT, "dlng": DLNG, "ni": NI, "nj": NJ},
        "tiles": sorted(f"{i}_{j}" for i, j in tiles),
        "dvf": {"first": first, "last": last},
        "q": q,
        "parks": [[p["name"], p["area"]] for p in parks],
        "sources": {"dvf": "Demandes de valeurs foncières géolocalisées, Etalab", "osm": "© contributeurs OpenStreetMap"},
    }
    with open(os.path.join(OUT, "meta.json"), "w") as fh:
        json.dump(meta, fh, separators=(",", ":"), ensure_ascii=False)
    size = sum(os.path.getsize(os.path.join(OUT, "t", f)) for f in os.listdir(os.path.join(OUT, "t")))
    log(f"Écrit : {len(tiles)} tuiles, {size / 1e6:.1f} Mo, période DVF {first}-{last}")

if __name__ == "__main__":
    main()
