"""Loyers de Heden : écrit data/loyers.json.

- Paris : loyers de référence de l'encadrement (opendata.paris.fr, jeu « logement-encadrement-des-loyers »),
  par quartier administratif, nombre de pièces, époque de construction et type de location (vide ou meublé).
  Valeurs en euros par m² et par mois, hors charges : référence, majorée (plafond légal), minorée.
- Île-de-France : indicateurs de loyers d'annonce par commune (« Carte des loyers », ministère du Logement
  et ANIL, sur data.gouv.fr), charges comprises, pour les appartements.

Lancé par le workflow « Loyers » (une fois par an, après la mise à jour de juillet), ou à la main.
"""
import csv, io, json, os, re, sys, time, urllib.parse, urllib.request
from datetime import date

OUT = sys.argv[1] if len(sys.argv) > 1 else "data"
UA = {"User-Agent": "Heden/1.0 (+https://github.com/Papi-Jojo/Heden)"}
IDF = ("75", "77", "78", "91", "92", "93", "94", "95")


def log(*a): print(*a, flush=True)


def get(url, tries=4, timeout=300):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except Exception as e:
            log("  essai", k + 1, "échoué :", url[:120], e)
            time.sleep(4 * (k + 1))
    raise RuntimeError("téléchargement impossible : " + url)


# ---------- Paris : encadrement ----------
EPOQUE = [(r"avant|1946$|< ?1946", "a"), (r"1946", "b"), (r"1971", "c"), (r"apr", "d")]


def epoque_code(t):
    t = str(t or "").lower()
    if "avant" in t: return "a"
    if "1946" in t and "1970" in t: return "b"
    if "1971" in t: return "c"
    if "apr" in t or "1990" in t: return "d"
    return None


def simplify(pts, tol):
    """Douglas-Peucker sur une liste de [lng, lat]."""
    if len(pts) < 4: return pts
    def d(p, a, b):
        (x, y), (x1, y1), (x2, y2) = p, a, b
        dx, dy = x2 - x1, y2 - y1
        if dx == dy == 0: return ((x - x1) ** 2 + (y - y1) ** 2) ** .5
        t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
        return ((x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2) ** .5
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        best, k = 0, None
        for m in range(i + 1, j):
            v = d(pts[m], pts[i], pts[j])
            if v > best: best, k = v, m
        if k is not None and best > tol:
            keep[k] = True; stack += [(i, k), (k, j)]
    return [p for p, ok in zip(pts, keep) if ok]


def outer_rings(geom):
    if not geom: return []
    t, c = geom.get("type"), geom.get("coordinates") or []
    if t == "Polygon": return [c[0]] if c else []
    if t == "MultiPolygon": return [p[0] for p in c if p]
    return []


def paris():
    base = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/logement-encadrement-des-loyers"
    gj = json.loads(get(base + "/exports/geojson?lang=fr&timezone=Europe%2FParis"))
    feats = gj.get("features") or []
    log("Paris : enregistrements", len(feats))
    if not feats: raise RuntimeError("jeu de l'encadrement vide")
    log("  champs :", sorted((feats[0].get("properties") or {}).keys()))
    P = lambda f, *ks: next((f["properties"].get(k) for k in ks if f["properties"].get(k) not in (None, "")), None)
    years = sorted({int(str(P(f, "annee"))[:4]) for f in feats if P(f, "annee")})
    log("  années :", years)
    y = years[-1]
    out = {}
    for f in feats:
        if int(str(P(f, "annee"))[:4]) != y: continue
        qid = P(f, "id_quartier", "id_zone_quartier", "id_qua")
        if qid is None: continue
        q = out.setdefault(int(qid), {"id": int(qid), "n": P(f, "nom_quartier", "nom_qua", "quartier") or "", "z": P(f, "id_zone"), "r": {}, "geom": None})
        piece = P(f, "piece", "nombre_de_pieces", "nb_pieces")
        try: piece = min(4, int(str(piece)[0]))
        except Exception: continue
        ep = epoque_code(P(f, "epoque", "epoque_construction"))
        meu = P(f, "meuble_txt", "meuble", "type_location")
        meu = "m" if re.search(r"^meubl|^oui|^true|^1$", str(meu).strip().lower()) and "non" not in str(meu).lower() else "v"
        ref, mx, mn = [P(f, k) for k in ("ref", "max", "min")]
        if not ep or ref is None: continue
        q["r"][f"{piece}{ep}{meu}"] = [round(float(ref), 1), round(float(mx), 1) if mx is not None else None, round(float(mn), 1) if mn is not None else None]
        if q["geom"] is None: q["geom"] = f.get("geometry")
    qs = []
    for q in sorted(out.values(), key=lambda q: q["id"]):
        rings = [simplify(r, 0.00025) for r in outer_rings(q.pop("geom"))]
        q["p"] = [[[round(lat, 5), round(lng, 5)] for lng, lat in r] for r in rings if len(r) >= 4]
        qs.append(q)
    log(f"  {len(qs)} quartiers, année {y}, {sum(len(q['r']) for q in qs)} loyers")
    return {"annee": y, "source": "Ville de Paris, encadrement des loyers (arrêté préfectoral)", "q": qs}


# ---------- Île-de-France : carte des loyers ----------
def num(v):
    try: return round(float(str(v).replace(",", ".").strip()), 2)
    except Exception: return None


def read_csv(raw):
    for enc in ("utf-8-sig", "latin-1"):
        try: txt = raw.decode(enc); break
        except Exception: continue
    head = txt.split("\n", 1)[0]
    sep = ";" if head.count(";") > head.count(",") else ","
    return list(csv.DictReader(io.StringIO(txt), delimiter=sep))


def communes():
    api = "https://www.data.gouv.fr/api/1/datasets/?" + urllib.parse.urlencode({"q": "carte des loyers indicateurs de loyers d'annonce par commune", "page_size": 30})
    ds = json.loads(get(api)).get("data") or []
    cand = []
    for d in ds:
        t = d.get("title") or ""
        m = re.search(r"(20\d\d)", t)
        if re.search(r"carte des loyers", t, re.I) and re.search(r"commune", t, re.I) and m: cand.append((int(m.group(1)), d))
    log("Carte des loyers : jeux trouvés", [(y, d["title"]) for y, d in cand])
    if not cand: raise RuntimeError("carte des loyers introuvable sur data.gouv.fr")
    cand.sort(key=lambda x: x[0], reverse=True)
    for y, d in cand:
        res = d.get("resources") or []
        log("  ressources", y, [(r.get("title"), r.get("format")) for r in res])
        def pick(rx):
            for r in res:
                name = ((r.get("title") or "") + " " + (r.get("url") or "")).lower()
                if re.search(rx, name) and str(r.get("format") or "").lower() in ("csv", "") : return r.get("url")
            return None
        u_app = pick(r"pred[-_]?app[-_]?(mef|_|-)(?!12|3)") or pick(r"appartement(?!.*(12|3 ))") or pick(r"pred[-_]app(?![0-9])")
        u_12, u_3 = pick(r"pred[-_]?app12"), pick(r"pred[-_]?app3")
        if not u_app: continue
        tabs = {}
        for key, u in (("app", u_app), ("app12", u_12), ("app3", u_3)):
            if not u: continue
            rows = read_csv(get(u))
            log(f"  {key} : {len(rows)} lignes, colonnes {list(rows[0].keys())[:14] if rows else []}")
            tabs[key] = rows
        c = {}
        def col(row, *names):
            for n in names:
                for k in row:
                    if k and k.strip().lower() == n.lower(): return row[k]
            return None
        for key, rows in tabs.items():
            for row in rows:
                code = str(col(row, "INSEE_C", "INSEE", "code_insee", "insee_com") or "").strip().zfill(5)
                dep = str(col(row, "DEP", "dep") or code[:2]).zfill(2)
                if not code.startswith(IDF) and dep not in IDF: continue
                e = c.setdefault(code, {"n": col(row, "LIBGEO", "libgeo", "nom_commune") or ""})
                e[key] = [num(col(row, "loypredm2")), num(col(row, "lwr.IPm2", "lwr_IPm2")), num(col(row, "upr.IPm2", "upr_IPm2")), int(float(col(row, "nbobs_com") or 0))]
        log(f"  {len(c)} communes d'Île-de-France, année {y}")
        if c: return {"annee": y, "source": "Carte des loyers, ministère du Logement et ANIL (loyers d'annonce, charges comprises)", "c": c}
    raise RuntimeError("aucune ressource lisible dans la carte des loyers")


def main():
    os.makedirs(OUT, exist_ok=True)
    res = {"maj": date.today().isoformat()}
    for key, fn in (("paris", paris), ("communes", communes)):
        try: res[key] = fn()
        except Exception as e: log("ERREUR", key, e)
    if "paris" not in res and "communes" not in res: sys.exit("rien à écrire")
    path = os.path.join(OUT, "loyers.json")
    with open(path, "w") as fh: json.dump(res, fh, separators=(",", ":"), ensure_ascii=False)
    log("Écrit", path, os.path.getsize(path) // 1024, "Ko")


if __name__ == "__main__":
    main()
