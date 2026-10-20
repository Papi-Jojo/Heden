"""Ajoute ou met à jour des traductions anglaises dans i18n/en.json.

Usage : python3 scripts/i18n/ajouter.py "Texte français" "English text" [...paires]

Clés : le texte français tel qu'affiché, espaces regroupés.
  #  un nombre (repris dans l'ordre, ou #1, #2… dans la traduction)
  *  un morceau variable (nom, phrase), traduit à son tour s'il est connu (*1, *2… pour réordonner)
  Un * collé à un mot singulier (« zone* ») sert au pluriel : il ne capte que « s ».
Les nombres écrits en dur dans le texte français deviennent # automatiquement.
"""
import json, os, re, sys

PATH = os.path.join(os.path.dirname(__file__), "..", "..", "i18n", "en.json")
NUM = re.compile(r"\d(?:[\d    .,]*\d)?")
EXC = {"quartier", "étage", "commune", "corrigée", "distance", "oiseau", "tracé", "analyse", "min"}


def plural(k):
    out = []
    for i, c in enumerate(k):
        if c == "*":
            w = re.search(r"([a-zà-ÿ]+)$", k[:i]); nx = k[i + 1:i + 2]
            if w and w.group(1)[-1] not in "sx" and w.group(1) not in EXC and (nx == "" or nx in " *.,):"): c = "§"
        out.append(c)
    return "".join(out)


def main(pairs):
    d = json.load(open(PATH, encoding="utf-8"))
    for fr, en in pairs:
        k = NUM.sub("#", re.sub(r"\s+", " ", fr).strip())
        if "*" in k: d["pat"][plural(k)] = en
        else: d["exact"][k] = en
        print(("motif " if "*" in k else "exact ") + k, "→", en)
    json.dump(d, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or len(a) % 2: sys.exit(__doc__)
    main(list(zip(a[::2], a[1::2])))
