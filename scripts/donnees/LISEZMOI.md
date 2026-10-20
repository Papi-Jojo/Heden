# Données objectives de Heden

`build.py` prépare les données qui servent à estimer certains critères d'une zone. Le workflow GitHub « Données objectives » le lance tous les trois mois. On peut aussi le lancer à la main depuis l'onglet Actions.

- **Prix** : ventes DVF géolocalisées (Etalab) de Paris, des Hauts-de-Seine, de la Seine-Saint-Denis et du Val-de-Marne, sur les trois dernières années. Seules les ventes d'un seul appartement ou d'une seule maison sont gardées, avec un prix compris entre 1 000 et 35 000 €/m². L'appli affiche le prix médian des appartements vendus sur 24 mois, d'abord dans la zone, puis dans un rayon de 150, 300 ou 500 m s'il y a moins de 12 ventes.
- **Fiabilité du prix** : la surface Carrez (celle des annonces) remplace la surface fiscale quand elle existe et reste cohérente. Les ventes qui incluent une cave ou un parking sont repérées et mises de côté s'il reste assez de ventes sans. Chaque vente est ramenée au niveau du dernier trimestre grâce à un indice trimestriel par département (médiane lissée sur trois trimestres). `meta.json` contient aussi la médiane des 12 derniers mois par commune ou arrondissement. L'appli affiche un niveau de confiance : « Fiable » à partir de 30 ventes, « Indicatif » entre 15 et 29, ou quand il faut chercher à 300 m ou plus, « Peu de ventes » en dessous.
- **Lieux** : extrait OpenStreetMap d'Île-de-France (Geofabrik) : commerces, restaurants, écoles, santé, stations, Vélib', parcs.
- **Notes estimées** : pour chaque critère, l'indicateur de la zone est comparé à ceux de 6 000 lieux où des appartements se sont vendus. Les seuils sont rangés dans `data/meta.json`, et la formule de l'appli, `estimate()` dans `index.html`, est la même que celle de `metrics()`.

Le résultat va dans `data/` : `meta.json` et des tuiles d'environ 1,1 km de côté, dans `t/`.

## Loyers

`loyers.py` écrit `data/loyers.json`, lancé par le workflow « Loyers » (juillet et octobre, ou à la main) :

- **Paris** : loyers de référence de l'encadrement (opendata.paris.fr), par quartier administratif, nombre de pièces, époque de construction et location vide ou meublée. Valeurs hors charges en €/m² par mois : référence, majorée (plafond légal), minorée. Contours des 80 quartiers simplifiés à une trentaine de mètres.
- **Paris et petite couronne** : indicateurs de loyers d'annonce par commune (Carte des loyers, ministère du Logement et ANIL, data.gouv.fr), charges comprises.

L'appli s'en sert en mode location : plafond de l'encadrement d'une annonce, loyers d'une zone, critère « prix » des zones. Les communes encadrées hors Paris (Plaine Commune, Est Ensemble) renvoient vers le simulateur officiel.
