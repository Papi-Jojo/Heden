"""Zones toutes prêtes pour Paris (bouton « Choisir un lieu », recherche, suggestion pendant le tracé).

Comment on découpe : les quartiers de Paris se lisent par leurs grandes rues. Les 80 quartiers administratifs (1860)
et les îlots IRIS de l'INSEE sont délimités par des voies ; on fait de même avec le réseau d'OpenStreetMap :
  1. les grands axes (autoroutes, voies principales, secondaires, tertiaires), les voies ferrées et les limites
     d'arrondissement découpent Paris en îlots ;
  2. chaque îlot rejoint le lieu connu le plus proche dans son arrondissement (station, place, parc, nom de quartier) ;
  3. la zone d'un lieu est la réunion de ses îlots : ses bords suivent des rues, et les zones voisines se touchent
     sans se chevaucher, sur tout Paris (hors bois de Boulogne et de Vincennes).
Les quartiers administratifs sont gardés tels quels, comme choix plus larges.
Sortie : data/lieux.json = {"v": date, "arr": {"1": [{"n": nom, "k": "lieu"|"quartier", "p": [[lat, lng], ...]}, ...], ...}}

Usage : python scripts/donnees/lieux.py data   (ou : data brut.json connus.json rues.json bois.json pour rejouer)
"""
import json, math, re, sys, time, urllib.request, urllib.parse, datetime
from shapely.geometry import Point, Polygon, MultiPolygon, LineString, MultiPoint
from shapely.ops import polygonize, unary_union
import shapely

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
MAX_PTS, MIN_HA, ECART = 24, 2, 280   # sommets au plus, surface minimale (ha), distance minimale entre deux lieux (m)
Q_RUES = """[out:json][timeout:300];
area["boundary"="administrative"]["admin_level"="8"]["name"="Paris"]->.p;
(way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](area.p);
 way["railway"="rail"]["service"!~"."](area.p););
out geom;"""
Q_BOIS = """[out:json][timeout:120];
area["boundary"="administrative"]["admin_level"="8"]["name"="Paris"]->.p;
nwr["name"~"^Bois de (Boulogne|Vincennes)$"]["boundary"!="administrative"](area.p);
out geom;"""
# petits lieux nommés d'OSM qui ne sont pas des quartiers (une impasse, une cité, une villa)
PETIT = re.compile(r"^(cité|villa|hameau|impasse|passage|cour|allée|résidence|square|les orgues|îlot)\b", re.I)


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


def build(raw, connus=None, rues=None, bois=None):
    els = raw["elements"]
    arrs, quartiers, places = {}, [], []
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
        elif t.get("place") in ("neighbourhood", "quarter") and t.get("name") and not PETIT.match(t["name"].strip()):
            if el["type"] == "node": places.append((t["name"].strip(), Point(*xy(el["lat"], el["lon"]))))
            else:
                g = poly_of(el)
                if g is not None and g.area > 1: places.append((t["name"].strip(), g.representative_point()))
    if len(arrs) < 20: raise SystemExit(f"arrondissements incomplets : {sorted(arrs)}")
    paris = unary_union(list(arrs.values()))
    arr_of = lambda pt: next((n for n, g in arrs.items() if g.contains(pt)), None)
    # 1. les lieux : d'abord ceux que tout le monde cite, puis les noms de quartier d'OSM, enfin un par quartier administratif resté vide
    best = {}
    for el in (connus or {}).get("elements", []):
        t = el.get("tags", {}); nm = t.get("name", ""); c = el.get("center") or ({"lat": el["lat"], "lon": el["lon"]} if "lat" in el else None)
        if not nm or not c: continue
        key = next((n for n in ARR_DE if norm(n) == norm(nm)), None)
        if not key or arr_of(Point(*xy(c["lat"], c["lon"]))) != ARR_DE[key]: continue  # homonyme dans un autre arrondissement
        r = rang(t); cur = best.get(key)
        if cur is None or r < cur[0]: best[key] = [r, [(c["lat"], c["lon"])]]
        elif r == cur[0] and r >= 3: cur[1].append((c["lat"], c["lon"]))
    cands = [(k, Point(*xy(sum(c[0] for c in cs) / len(cs), sum(c[1] for c in cs) / len(cs)))) for k, (r, cs) in best.items()]
    cands += places
    seeds = []
    def ajoute(name, pt):
        if not paris.contains(pt) or any(base(n) in base(name) or base(name) in base(n) for n, p in seeds if p.distance(pt) < 900): return   # « Square des Batignolles » près de « Batignolles »
        if any(p.distance(pt) < ECART for _, p in seeds): return   # deux lieux trop proches : une seule zone
        seeds.append((name, pt))
    for name, pt in cands: ajoute(name, pt)
    for name, g in quartiers:
        if not any(g.contains(p) for _, p in seeds): ajoute(name, g.representative_point())
    # 2. les îlots : Paris découpé par ses grands axes, ses voies ferrées et les limites d'arrondissement
    lines = [LineString([xy(p["lat"], p["lon"]) for p in w["geometry"]]) for w in (rues or {}).get("elements", []) if len(w.get("geometry") or []) >= 2]
    lines += [g.exterior if isinstance(g, Polygon) else unary_union([x.exterior for x in g.geoms]) for g in arrs.values()]
    exclus = unary_union([g for g in (poly_of(el) for el in (bois or {}).get("elements", []) if el["type"] != "node") if g is not None]) if bois else Polygon()
    ilots = [f for f in polygonize(unary_union(lines)) if f.area > 50]
    print(f"{len(ilots)} îlots, {len(seeds)} lieux")
    # 3. chaque îlot rejoint le lieu le plus proche de son arrondissement ; la zone est la réunion de ses îlots
    by_arr = {n: [i for i, (_, p) in enumerate(seeds) if arr_of(p) == n] for n in arrs}
    parts = {i: [] for i in range(len(seeds))}
    for f in ilots:
        c = f.representative_point()
        if not paris.contains(c) or exclus.contains(c): continue
        n = arr_of(c); cand = by_arr.get(n) or list(range(len(seeds)))
        parts[min(cand, key=lambda i: seeds[i][1].distance(c))].append(f)
    zones = []
    for i, fs in parts.items():
        if not fs: continue
        g = unary_union(fs).buffer(4).buffer(-4)   # referme les fentes laissées par les voies à double sens
        if isinstance(g, MultiPolygon): g = max(g.geoms, key=lambda x: x.area)
        if g.area < MIN_HA * 1e4: continue
        zones.append((seeds[i][0], arr_of(seeds[i][1]), Polygon(g.exterior)))
    # bords communs simplifiés ensemble : les zones voisines restent jointives
    simp = list(shapely.coverage_simplify([z[2] for z in zones], 10)) if hasattr(shapely, "coverage_simplify") else [z[2].simplify(10) for z in zones]
    out = {str(n): [] for n in range(1, 21)}
    for (name, n, _), g in zip(zones, simp):
        p = small(g)
        if n and p: out[str(n)].append({"n": name, "k": "lieu", "p": p})
    for name, g in quartiers:
        n = arr_of(g.representative_point()); p = small(g)
        if n and p and name: out[str(n)].append({"n": name, "k": "quartier", "p": p})
    for k in out: out[k].sort(key=lambda x: (x["k"] != "lieu", x["n"].lower()))
    return {"v": datetime.date.today().isoformat(), "arr": out}


if __name__ == "__main__":
    dest = sys.argv[1] if len(sys.argv) > 1 else "data"
    raw = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else fetch()
    connus = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else fetch(q_connus())
    rues = json.load(open(sys.argv[4])) if len(sys.argv) > 4 else fetch(Q_RUES)
    bois = json.load(open(sys.argv[5])) if len(sys.argv) > 5 else fetch(Q_BOIS)
    res = build(raw, connus, rues, bois)
    print("lieux connus situés :", sum(1 for v in res["arr"].values() for x in v if x["k"] == "lieu" and x["n"] in ARR_DE), "/", len(ARR_DE))
    n_l = sum(1 for v in res["arr"].values() for x in v if x["k"] == "lieu")
    n_q = sum(1 for v in res["arr"].values() for x in v if x["k"] == "quartier")
    print(f"{n_l} lieux, {n_q} quartiers administratifs")
    for k, v in res["arr"].items(): print(k, len(v), ", ".join(x["n"] for x in v if x["k"] == "lieu")[:160])
    if n_q < 60 or n_l < 40: raise SystemExit("trop peu de lieux : fichier non écrit")
    with open(f"{dest}/lieux.json", "w", encoding="utf-8") as f: json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
