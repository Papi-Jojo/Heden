# Langues

Le code et l’interface sont écrits en français. L’anglais est appliqué à l’affichage par une petite couche de traduction (en tête de `index.html`) à partir de `i18n/en.json`, quand l’utilisateur choisit English dans Profil > Compte (`localStorage heden.lang`).

**Règle : tout texte ajouté ou modifié dans l’interface reçoit sa traduction anglaise dans le même commit.**

```
python3 scripts/i18n/ajouter.py "Zone enregistrée" "Area saved" "Supprimer « * » ?" "Delete “*”?"
```

- `#` : un nombre ; `*` : un morceau variable, traduit à son tour s’il est connu ; `*2`, `#2` pour réordonner.
- Les listes « a, b, c » et « a · b » sont traduites élément par élément.
- Ne pas traduire : les textes saisis par l’utilisateur, les annonces elles-mêmes, le message de visite envoyé aux agences.
- Contrôle : ouvrir l’app avec `localStorage.heden.i18ndebug = "1"` : la console liste les textes restés en français (`I18NMISS`).
- Un texte que le code relit dans le DOM (comparaison de `textContent`) doit passer par un `data-*` : la traduction change le texte affiché.
