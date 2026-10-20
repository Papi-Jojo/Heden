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
import json, math, re, sys, time, urllib.request, urllib.parse, datetime
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
# Lieux que tout le monde cite, absents d'OSM comme « place » : on les situe par leur station, leur parc, leur rue ou leur place
CONNUS = {1: ["Les Halles", "Palais-Royal", "Place Vendôme", "Île de la Cité"], 2: ["Montorgueil", "Sentier", "Bourse", "Grands Boulevards"],
  3: ["Haut Marais", "Arts et Métiers", "Square du Temple", "Rue de Bretagne"], 4: ["Le Marais", "Saint-Paul", "Île Saint-Louis", "Hôtel de Ville", "Place des Vosges"],
  5: ["Quartier latin", "Rue Mouffetard", "Panthéon", "Jardin des Plantes", "Maubert"], 6: ["Odéon", "Jardin du Luxembourg", "Saint-Sulpice", "Notre-Dame-des-Champs"],
  7: ["Rue Cler", "Champ-de-Mars"], 8: ["Madeleine", "Parc Monceau", "Europe"], 9: ["Pigalle", "Rue des Martyrs", "Saint-Georges", "Square Montholon"],
  10: ["Canal Saint-Martin", "Faubourg Saint-Denis", "Gare de l'Est", "Château d'Eau"], 11: ["Oberkampf", "Bastille", "Roquette", "Folie-Méricourt", "Charonne", "Parmentier"],
  12: ["Aligre", "Bercy Village", "Nation", "Daumesnil"], 13: ["Place d'Italie", "Bibliothèque François Mitterrand", "Maison Blanche"],
  14: ["Montparnasse", "Denfert-Rochereau", "Alésia", "Pernety", "Parc Montsouris", "Mouton-Duvernet", "Cité Universitaire"],
  15: ["Commerce", "Convention", "Vaugirard", "Beaugrenelle", "Cambronne", "Parc Georges Brassens"], 16: ["Passy", "Auteuil", "Trocadéro", "La Muette", "Porte Dauphine"],
  17: ["Batignolles", "Ternes", "Épinettes", "Rue de Lévis", "Plaine Monceau"], 18: ["Abbesses", "Montmartre", "Lamarck - Caulaincourt", "Goutte d'Or", "Jules Joffrin"],
  19: ["Buttes-Chaumont", "Bassin de la Villette", "Jourdain", "Place des Fêtes", "Parc de la Villette"],
  20: ["Belleville", "Ménilmontant", "Gambetta", "Père Lachaise", "Pyrénées", "Martin Nadaud"]}
ARR_DE = {n: a for a, ns in CONNUS.items() for n in ns}
norm = lambda s: s.lower().replace("’", "'").replace("-", " ").replace("  ", " ").strip()
# « Quartier de l'Odéon » et « Odéon » sont le même lieu
base = lambda s: re.sub(r"^(?:quartier (?:de la |de l'|du |des |de )?|le |la |les |l')", "", norm(s))
LAT0 = 48.8566
KX, KY = 111320 * math.cos(math.radians(LAT0)), 110540  # mètres par degré, à la latitude de Paris
xy = lambda lat, lng: (lng * KX, lat * KY)
ll = lambda x, y: [round(y / KY, 5), round(x / KX, 5)]
RAYON, MAX_PTS, MIN_HA = 650, 18, 2


def q_connus():
    pat = lambda n: re.sub(r"[- ]+", "[- ]+", re.sub(r"([.^$*+?()\[\]{}|\\])", r"\\\1", n.replace("’", "'"))).replace("'", "['’]")
    alt = "|".join(sorted({pat(n) for n in ARR_DE}))
    return f"""[out:json][timeout:240];
area["boundary"="administrative"]["admin_level"="8"]["name"="Paris"]->.p;
nwr["name"~"^({alt})$",i](area.p);
out center tags;"""


def fetch(q=Q):
    body = urllib.parse.urlencode({"data": q}).encode()
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


def rang(t):
    """Le meilleur repère pour situer un lieu connu : son nom de lieu, sa station, son parc, sa place, sa rue."""
    if t.get("place"): return 0
    if t.get("railway") == "station" or t.get("station") == "subway" or t.get("public_transport") == "station": return 1
    if t.get("leisure") in ("park", "garden") or t.get("place") == "square": return 2
    if t.get("highway") == "pedestrian" or t.get("highway") in ("residential", "secondary", "tertiary", "primary", "living_street", "unclassified"): return 3
    if t.get("waterway") or t.get("natural") == "water": return 3
    return 4


def build(raw, connus=None):
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
    # lieux connus : un repère par nom (le meilleur rang ; pour une rue ou un canal, le centre de ses morceaux)
    best = {}
    for el in (connus or {}).get("elements", []):
        t = el.get("tags", {}); nm = t.get("name", ""); c = el.get("center") or ({"lat": el["lat"], "lon": el["lon"]} if "lat" in el else None)
        if not nm or not c: continue
        key = next((n for n in ARR_DE if norm(n) == norm(nm)), None)
        if not key or arr_of(Point(*xy(c["lat"], c["lon"]))) not in (ARR_DE[key], None): continue  # homonyme dans un autre arrondissement
        r = rang(t); cur = best.get(key)
        if cur is None or r < cur[0]: best[key] = [r, [(c["lat"], c["lon"])]]
        elif r == cur[0] and r >= 3: cur[1].append((c["lat"], c["lon"]))
    have = {base(n) for n, _, _ in lieux} | {base(n) for n, _ in quartiers}  # déjà là sous un autre statut
    for key, (r, cs) in best.items():
        if base(key) in have: continue
        la, lo = sum(c[0] for c in cs) / len(cs), sum(c[1] for c in cs) / len(cs)
        lieux.append((key, Point(*xy(la, lo)), None))
    out = {str(n): [] for n in range(1, 21)}
    # quartiers administratifs : la forme officielle
    for name, g in quartiers:
        n = arr_of(g.representative_point())
        p = small(g)
        if n and p and name: out[str(n)].append({"n": name, "k": "quartier", "p": p})
    # lieux : un seul par nom, dans Paris
    seen, pts = set(), []
    for name, pt, g in lieux:
        key = base(name)
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
        else:
            # bornée par ses voisins (Voronoï), son arrondissement et son quartier administratif (dont les limites suivent les rues),
            # le quartier élargi de 120 m pour ne pas couper net un lieu posé sur sa limite ; le disque n'est qu'un garde-fou
            q = next((g2 for _, g2 in quartiers if g2.contains(pt)), None)
            shape = by_pt.get(i, pt.buffer(RAYON)).intersection(arrs[n]).intersection(pt.buffer(RAYON, 32))
            if q is not None: shape = shape.intersection(q.buffer(120))
        if shape.is_empty or shape.area < MIN_HA * 1e4: continue
        p = small(shape)
        if p: out[str(n)].append({"n": name, "k": "lieu", "p": p})
    for k in out: out[k].sort(key=lambda x: (x["k"] != "lieu", x["n"].lower()))
    return {"v": datetime.date.today().isoformat(), "arr": out}


if __name__ == "__main__":
    dest = sys.argv[1] if len(sys.argv) > 1 else "data"
    raw = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else fetch()
    connus = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else fetch(q_connus())
    res = build(raw, connus)
    print("lieux connus situés :", sum(1 for v in res["arr"].values() for x in v if x["k"] == "lieu" and x["n"] in ARR_DE), "/", len(ARR_DE))
    n_l = sum(1 for v in res["arr"].values() for x in v if x["k"] == "lieu")
    n_q = sum(1 for v in res["arr"].values() for x in v if x["k"] == "quartier")
    print(f"{n_l} lieux, {n_q} quartiers administratifs")
    for k, v in res["arr"].items(): print(k, len(v), ", ".join(x["n"] for x in v if x["k"] == "lieu")[:160])
    if n_q < 60 or n_l < 40: raise SystemExit("trop peu de lieux : fichier non écrit")
    with open(f"{dest}/lieux.json", "w", encoding="utf-8") as f: json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
