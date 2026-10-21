"""Banc de lecture des annonces : chaque champ attendu est comparé à ce que Heden lit.
  python3 tests/lecture.py        → tableau par champ et liste des erreurs (après npm run build)
Utilisé aussi par l'essai « lecture » de tests/essais.py."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outils import Essai, demarrer, sync_playwright
from annonces.fiches import FICHES, CARTES, EMAILS, CONTROLE


def egal(a, b):
    if isinstance(b, float) or isinstance(a, float): return a is not None and b is not None and abs(a - b) < 0.05
    if isinstance(b, str) and isinstance(a, str): return a.strip().lower().replace(" ", "-") == b.strip().lower().replace(" ", "-")
    return a == b


def mesurer(pg):
    champs, erreurs = {}, []
    for groupe, cas in (("fiche", FICHES), ("carte", CARTES), ("contrôle", CONTROLE)):
        for c in cas:
            src = {"url": c["url"], "title": c.get("title", ""), "text": c["text"], "meta": {}, "ld": c.get("ld", []), "imgs": [], "hints": c.get("hints", {})}
            f = pg.evaluate("s => __heden.parseListing(s)", src)
            for k, v in c["attendu"].items():
                ok = egal(f.get(k), v); t = champs.setdefault(k, [0, 0]); t[0] += ok; t[1] += 1
                if not ok: erreurs.append(f"{groupe} « {c['nom']} » · {k} : lu {f.get(k)!r}, attendu {v!r}")
    for m in EMAILS:
        r = pg.evaluate("h => __heden.extractCards(new DOMParser().parseFromString(h, 'text/html').body).map(c => [c.url, __heden.parseListing({url: c.url, text: c.text}).price])", m["html"])
        ok = len(r) == m["n"] and [x[1] for x in r] == m["prix"]; t = champs.setdefault("e-mail", [0, 0]); t[0] += ok; t[1] += 1
        if not ok: erreurs.append(f"e-mail « {m['nom']} » : lu {r}")
    return champs, erreurs


if __name__ == "__main__":
    srv = demarrer()
    with sync_playwright() as pw:
        e = Essai(pw); pg = e.page(); champs, erreurs = mesurer(pg); e.fermer()
    srv.shutdown()
    tot = sum(v[1] for v in champs.values()); bon = sum(v[0] for v in champs.values())
    for k, (a, n) in sorted(champs.items(), key=lambda x: x[1][0] / x[1][1]): print(f"{k:14} {a:>2}/{n:<2} {'█' * round(10 * a / n):10}")
    print(f"\n{bon}/{tot} valeurs justes ({100 * bon / tot:.0f} %)\n"); print("\n".join(erreurs))
