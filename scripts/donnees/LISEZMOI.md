# Données objectives de Heden

`build.py` prépare les données qui servent à estimer certains critères d'une zone. Le workflow GitHub « Données objectives » le lance tous les trois mois. On peut aussi le lancer à la main depuis l'onglet Actions.

- **Prix** : ventes DVF géolocalisées (Etalab) de Paris, des Hauts-de-Seine, de la Seine-Saint-Denis et du Val-de-Marne, sur les trois dernières années. Seules les ventes d'un seul appartement ou d'une seule maison sont gardées, avec un prix compris entre 1 000 et 35 000 €/m². L'appli affiche le prix médian des appartements vendus sur 24 mois, d'abord dans la zone, puis dans un rayon de 150, 300 ou 500 m s'il y a moins de 12 ventes.
- **Lieux** : extrait OpenStreetMap d'Île-de-France (Geofabrik) : commerces, restaurants, écoles, santé, stations, Vélib', parcs.
- **Notes estimées** : pour chaque critère, l'indicateur de la zone est comparé à ceux de 6 000 lieux où des appartements se sont vendus. Les seuils sont rangés dans `data/meta.json`, et la formule de l'appli, `estimate()` dans `index.html`, est la même que celle de `metrics()`.

Le résultat va dans `data/` : `meta.json` et des tuiles d'environ 1,1 km de côté, dans `t/`.
