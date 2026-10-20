# Heden

Carte interactive pour noter les coins de Paris et de la petite couronne visités lors d'une recherche d'appartement.

- **Carte** : dessiner une zone point par point, la modeler en tirant ses sommets, la noter selon ses critères. La zone prend une couleur du rouge (0) au vert (100).
- **Profil** : profils types ou critères personnalisés et pondérés.

Site statique construit avec Vite (Leaflet, fonds OpenFreeMap et Esri, géocodage Nominatim, comptes Supabase).

## Développer

```
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/, mis en ligne par le workflow « Site » à chaque push sur main
```

- `src/app/` : le code de l'app, découpé par domaine. Les fichiers partagent une seule portée et sont assemblés dans l'ordre du fichier `ORDRE`.
- `src/styles/` : les styles, dans l'ordre de `index.css`.
- `i18n/` : traduction anglaise à l'affichage (`scripts/i18n/LISEZMOI.md`).
- `data/`, `config.js`, `v2/` : servis tels quels, copiés dans `dist/` à la construction.

Direction artistique : design system « Heden » (Claude Design) — pierre, émail, laiton.

## Essais

`npm run build && python tests/essais.py` : parcours réels dans Chromium (carte, zones, cartes de groupe, annonces, synchronisation, accessibilité, cas extrêmes), avec un faux Supabase et les bibliothèques de carte servies depuis `node_modules`, sans réseau. Le workflow « Site » les lance avant chaque mise en ligne : un échec bloque le déploiement.

## Dépendances : décisions connues

- MapLibre reste en 5.24 : la faille signalée (GHSA-jrc7-96c5-q579) touche son nettoyage de HTML pour les fenêtres et l'attribution, où Heden ne passe que du contenu à lui. La version 6 n'existe qu'en module ES avec un worker qui doit être servi depuis le même domaine : à reprendre si on héberge MapLibre nous-mêmes.
