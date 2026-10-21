"""Annonces types pour mesurer la lecture (textes tels que les rend le bouton + Heden : innerText de la page).
Rédigées d'après la mise en page de chaque site ; les noms, numéros et références sont fictifs.
Chaque cas : url, title, text (et ld / hints au besoin), attendu = champs que la lecture doit trouver.
Un champ attendu à None doit rester vide (piège)."""

FICHES = [
 dict(nom="SeLoger vente", url="https://www.seloger.com/annonces/achat/appartement/paris-11eme-75/folie-mericourt/223344556.htm",
  title="Appartement 3 pièces 68 m² Paris 11ème", text="""Appartement à vendre
3 pièces
2 chambres
68 m²
Étage 4/6
Paris 11ème (75011)
Quartier Folie-Méricourt
725 000 €
10 662 €/m²
Estimer vos mensualités
Description
Rue Oberkampf, au 4ème étage avec ascenseur d'un bel immeuble ancien, appartement traversant de 68 m² comprenant entrée, séjour de 24 m², cuisine séparée, deux chambres, salle d'eau. Cave.
Copropriété de 32 lots. Taxe foncière : 1 150 €.
Montant moyen annuel de la quote-part de charges (budget prévisionnel) : 2 640 €
Prix de vente honoraires inclus : 725 000 € (dont 4,32% honoraires TTC à la charge de l'acquéreur). Prix hors honoraires : 695 000 €.
Diagnostic de performance énergétique
Consommation énergétique : D
Émissions de gaz à effet de serre : B
Agence Oberkampf Immobilier
01 43 55 22 11
Réf. : OBK-2291""",
  attendu=dict(price=725000, surface=68, rooms=3, bedrooms=2, floor=4, floors=6, elevator=True, dpe="D", charges=2640, taxe=1150,
               postcode="75011", quartier="Folie-Méricourt", cave=True, traversant=True, lots=32, agencyPhone="0143552211", ref="OBK-2291", kind=None)),

 dict(nom="PAP vente", url="https://www.pap.fr/annonces/appartement-paris-18e-r467301922",
  title="Vente appartement 2 pièces 41 m² Paris 18E", text="""Vente appartement 2 pièces 41 m²
Paris 18E (75018)
389.000 €
Métro : Lamarck - Caulaincourt (ligne 12), Jules Joffrin (ligne 12)
2 pièces
1 chambre
41 m²
Particulier vend 2 pièces au 3e étage sans ascenseur, rue Caulaincourt. Séjour lumineux exposé sud, cuisine ouverte, chambre sur cour, salle de bains. Parquet, moulures, cheminée. Charges : 180 €/mois. Taxe foncière 820 €.
Classe énergie E
Référence annonce : 467-B-301922""",
  attendu=dict(price=389000, surface=41, rooms=2, bedrooms=1, floor=3, elevator=False, dpe="E", charges=2160, taxe=820, postcode="75018",
               metro="Lamarck-Caulaincourt", exposure="sud", seller="particulier", quiet=True)),

 dict(nom="Leboncoin vente (critères en colonnes)", url="https://www.leboncoin.fr/ad/ventes_immobilieres/2846113377",
  title="Appartement 4 pièces 82 m²", text="""Appartement 4 pièces 82 m²
835 000 €
Paris 75015 Saint-Lambert
Publiée le 14/10/2026 à 09:12
Critères
Type de bien
Appartement
Surface habitable
82 m²
Nombre de pièces
4
Nombre de chambres
3
Étage du bien
2
Nombre d'étages dans l'immeuble
7
Ascenseur
Oui
Charges annuelles
3 200 €
Classe énergie
C
GES
A
Extérieur
Balcon
Description
Appartement familial proche métro Convention, balcon de 6 m², trois chambres, cave et parking en sous-sol.
Pro
Agence du Parc
SIREN 812 345 678""",
  attendu=dict(price=835000, surface=82, rooms=4, bedrooms=3, floor=2, floors=7, elevator=True, dpe="C", charges=3200, postcode="75015",
               quartier="Saint-Lambert", outdoor="balcon", outdoorArea=6, parking=True, cave=True, agencyPhone=None)),

 dict(nom="Bien'ici vente (baisse de prix)", url="https://www.bienici.com/annonce/vente/paris-20e/appartement/3pieces/ag751234-889911",
  title="Appartement 3 pièces 59 m² Paris 20e", text="""Ancien prix : 575 000 €
Appartement 3 pièces 59 m²
Paris 20e (75020)
Quartier Belleville
549 000 €
9 305 €/m²
Le prix a baissé de 26 000 €
Caractéristiques
Bâtiment construit en 1930
3e étage sur 5
Avec ascenseur
2 chambres
1 salle d'eau
Cave
Exposition Sud-Ouest
Diagnostics
DPE : D (212 kWh/m²/an)
GES : D
Charges de copropriété : 2 100 €/an
Nombre de lots : 18
Honoraires à la charge du vendeur""",
  attendu=dict(price=549000, surface=59, rooms=3, bedrooms=2, floor=3, floors=5, elevator=True, dpe="D", charges=2100, postcode="75020",
               quartier="Belleville", exposure="sud-ouest", lots=18, cave=True)),

 dict(nom="Site d'agence, tableau oui/non", url="https://www.agence-exemple.fr/annonce/vente-appartement-paris-16-5-pieces-4471",
  title="Vente Appartement 5 pièces Paris 16e", text="""Vente Appartement 5 pièces Paris 16e
1 450 000 €
Honoraires inclus 3,57 % à la charge de l'acquéreur, soit 1 400 000 € hors honoraires
Surface 118,5 m²
Pièces 5
Chambres 3
Étage 5 / 6
Ascenseur Oui
Balcon Oui
Terrasse Non
Parking Non
Cave Oui
DPE C
Superbe appartement haussmannien de 118,5 m² Carrez au 5ème étage avec balcon filant, vue dégagée.
Frais de notaire estimés : 101 500 €""",
  attendu=dict(price=1450000, surface=118.5, rooms=5, bedrooms=3, floor=5, floors=6, elevator=True, outdoor="balcon", parking=False, cave=True,
               dpe="C", postcode="75016", view=True)),

 dict(nom="SeLoger location", url="https://www.seloger.com/annonces/locations/appartement/paris-10eme-75/224466.htm",
  title="Appartement à louer 2 pièces 38 m² Paris 10ème", text="""Appartement à louer
2 pièces
1 chambre
38 m²
Paris 10ème (75010)
1 390 € CC/mois
Loyer hors charges : 1 290 €
Charges : 100 €/mois
Dépôt de garantie : 1 290 €
Honoraires : 494 €
Meublé
Disponible le 1er novembre
Loyer de référence majoré : 33,8 €/m²
Complément de loyer : 0 €
Immeuble construit en 1900""",
  attendu=dict(kind="location", price=1390, rentHC=1290, rentCharges=100, deposit=1290, agencyFee=494, furnished=True, postcode="75010",
               rooms=2, surface=38, refMaj=33.8, complement=0, epoque="a")),

 dict(nom="Leboncoin location particulier", url="https://www.leboncoin.fr/ad/locations/2847001122",
  title="Studio 22 m²", text="""Studio 22 m²
890 €
Paris 75005 Val-de-Grâce
Critères
Type de bien
Appartement
Meublé / Non meublé
Meublé
Surface habitable
22 m²
Nombre de pièces
1
Charges comprises
Oui
Classe énergie
F
Description
Studio meublé rue Gay-Lussac, 5e étage avec ascenseur, idéal étudiant. Loyer 890 € charges comprises (dont 60 € de charges). Disponible immédiatement.
Particulier""",
  attendu=dict(kind="location", price=890, rentCharges=60, rentHC=830, furnished=True, rooms=1, surface=22, floor=5, elevator=True, dpe="F",
               postcode="75005", seller="particulier")),

 dict(nom="Viager occupé", url="https://www.viager-exemple.fr/annonce-viager-paris-14-889.htm",
  title="Viager occupé - Appartement 3 pièces 70 m² - Paris 14e", text="""Viager occupé - Appartement 3 pièces 70 m² - Paris 14e
Bouquet : 150 000 €
Rente : 980 € / mois
Valeur vénale : 640 000 €
Occupé par une dame de 82 ans""",
  attendu=dict(viager="occupe", price=150000, rente=980, rooms=3, surface=70, postcode="75014", kind=None)),

 dict(nom="Petite couronne", url="https://www.agence-exemple.fr/annonce/vente-appartement-vincennes-3-pieces-2201",
  title="Appartement 3 pièces 63 m² Vincennes", text="""Appartement 3 pièces 63 m² Vincennes
Vincennes (94300)
612 000 €
Proche du Bois, au 1er étage d'une résidence de standing avec gardien, séjour sur balcon, deux chambres. DPE vierge.""",
  attendu=dict(price=612000, surface=63, rooms=3, bedrooms=2, floor=1, postcode="94300", outdoor="balcon", building="gardien", dpe=None)),

 dict(nom="Pièges de surface et d'étage", url="https://www.agence-exemple.fr/annonce/vente-appartement-paris-9-3301",
  title="Appartement Paris 9e", text="""Appartement 3 pièces Paris 9e
Prix : 799 000 €
Surface loi Carrez : 64,2 m² (72 m² au sol)
Situé au dernier étage (7e), sans ascenseur, avec une terrasse de 25 m² et une chambre de service de 9 m².
Lot de deux caves de 8 m².
Performance énergétique : 255 kWh/m².an (classe E)
Copropriété de 12 lots, pas de procédure en cours.""",
  attendu=dict(price=799000, surface=64.2, rooms=3, floor=7, top=True, elevator=False, outdoor="terrasse", outdoorArea=25, dpe="E", lots=12, postcode="75009")),

 dict(nom="Rez-de-jardin", url="https://www.agence-exemple.fr/annonce/vente-appartement-paris-13-1182",
  title="2 pièces en rez-de-jardin, Paris 13", text="""2 pièces de 44 m² en rez-de-jardin avec jardin privatif de 30 m², Paris 13e, quartier Butte-aux-Cailles.
Prix 455 000 € FAI. Charges courantes : 1 300 € par an.""",
  attendu=dict(price=455000, surface=44, rooms=2, floor=0, outdoor="jardin", outdoorArea=30, charges=1300, postcode="75013", quartier="Butte-aux-Cailles")),

 dict(nom="Vente avec mots de location", url="https://www.agence-exemple.fr/annonce/1029",
  title="Investissement locatif 2 pièces", text="""Investissement locatif : 2 pièces 35 m² vendu loué, Paris 19e.
Loyer actuel : 1 050 €/mois charges comprises, bail en cours jusqu'en 2028.
Prix : 329 000 €""",
  attendu=dict(kind=None, price=329000, surface=35, rooms=2, postcode="75019")),

 dict(nom="Annonce retirée", url="https://www.seloger.com/annonces/achat/appartement/paris-3eme-75/99887766.htm",
  title="Annonce expirée", text="Cette annonce n'est plus disponible.\nDécouvrez des biens similaires\n3 pièces 61 m² 690 000 €",
  attendu=dict(gone=True)),

 dict(nom="Données structurées (JSON-LD)", url="https://www.bienici.com/annonce/vente/paris-6e/appartement/2pieces/ld-1",
  title="Appartement 2 pièces", text="Appartement 2 pièces\nVoir le numéro",
  ld=['{"@context":"https://schema.org","@type":"Product","name":"Appartement 2 pièces 48 m²","offers":{"@type":"Offer","price":"742000","priceCurrency":"EUR","seller":{"@type":"RealEstateAgent","name":"Saint-Germain Patrimoine","telephone":"+33 1 45 48 00 00"}},"floorSize":{"@type":"QuantitativeValue","value":48.3,"unitCode":"MTK"},"numberOfRooms":2,"address":{"@type":"PostalAddress","postalCode":"75006","addressLocality":"Paris"}}'],
  attendu=dict(price=742000, surface=48.3, rooms=2, postcode="75006", agencyName="Saint-Germain Patrimoine", agencyPhone="+33145480000")),
]

# Cartes lues dans un e-mail d'alerte ou une page de résultats (texte court)
CARTES = [
 dict(nom="Alerte SeLoger", url="https://www.seloger.com/annonces/achat/appartement/paris-17eme-75/1.htm",
  text="Appartement 2 pièces · 45 m² · Paris 17e (75017) · 495 000 €", attendu=dict(price=495000, surface=45, rooms=2, postcode="75017")),
 dict(nom="Alerte baisse de prix", url="https://www.bienici.com/annonce/vente/paris-17e/appartement/3pieces/2",
  text="Nouveau prix\n610 000 €\n640 000 €\nAppartement 3 p. 60 m²\nBatignolles, Paris 17", attendu=dict(price=610000, surface=60, rooms=3, postcode="75017")),
 dict(nom="Alerte studio", url="https://www.pap.fr/annonces/studio-paris-5e-r400000003",
  text="Studio 19 m² – 245 000 € – Paris 5ème", attendu=dict(price=245000, surface=19, rooms=1, postcode="75005")),
 dict(nom="Alerte location", url="https://www.seloger.com/annonces/locations/appartement/paris-11eme-75/4.htm",
  text="2 pièces 35 m² 1 250 €/mois CC Paris 11e", attendu=dict(kind="location", price=1250, surface=35, rooms=2, postcode="75011")),
 dict(nom="Alerte T3", url="https://www.leboncoin.fr/ad/ventes_immobilieres/5",
  text="T3 lumineux 58m2\n560 000 €\nParis 75012", attendu=dict(price=560000, surface=58, rooms=3, postcode="75012", bright=True)),
]

# E-mails d'alerte (HTML) : combien de cartes, quels liens, quels prix
EMAILS = [
 dict(nom="E-mail en tableaux", n=2, html="""<html><body><table><tr><td><img src="https://img.ex.fr/logo.png" width="120" height="40"></td></tr>
<tr><td><a href="https://click.alertes.ex.fr/c/abc?u=https%3A%2F%2Fwww.seloger.com%2Fannonces%2Fachat%2Fappartement%2Fparis-18eme-75%2F111.htm"><img src="https://img.ex.fr/a1.jpg" width="280" height="180"></a></td>
<td><b>Appartement 3 pièces</b><br>62 m² · Paris 18ème<br><span>598 000 €</span><br><a href="https://click.alertes.ex.fr/c/abc?u=111">Voir l'annonce</a></td></tr>
<tr><td><a href="https://click.alertes.ex.fr/c/def?u=222"><img src="https://img.ex.fr/b1.jpg" width="280" height="180"></a></td>
<td><b>Appartement 2 pièces</b><br>40 m² · Paris 17ème<br><span>455 000 €</span><br><a href="https://click.alertes.ex.fr/c/def?u=222">Voir l'annonce</a></td></tr>
<tr><td>Vous recevez cet e-mail car vous avez créé une alerte. <a href="https://www.ex.fr/desabonnement">Se désabonner</a> · Prix moyen du quartier 10 200 €/m²</td></tr></table></body></html>""",
  prix=[598000, 455000]),
]

# Jeu de contrôle : rédigé après les corrections, sans retouche du code ensuite (mesure honnête de la généralisation)
CONTROLE = [
 dict(nom="Figaro Immobilier", url="https://immobilier.lefigaro.fr/annonces/annonce-71234567.html",
  title="Vente appartement 4 pièces 91 m² Paris 17e", text="""Vente appartement 4 pièces
91 m²
Paris 17ème (75017)
1 120 000 €
12 308 €/m²
Les points forts
Ascenseur
Gardien
Balcon
Parking
Détails du bien
Nombre de chambres : 3
Étage : 3e
Année de construction : 1910
Chauffage : collectif
Diagnostic de performance énergétique (DPE) : D
Charges annuelles : 4 200 €
Description
Plaine Monceau, bel appartement familial de 91 m² au 3e étage d'un immeuble pierre de taille avec gardien.""",
  attendu=dict(price=1120000, surface=91, rooms=4, bedrooms=3, floor=3, elevator=True, building="gardien", outdoor="balcon", parking=True,
               dpe="D", charges=4200, postcode="75017")),
 dict(nom="Logic-immo", url="https://www.logic-immo.com/detail-vente-a1b2c3d4.htm",
  title="Appartement 2 pièces 50 m² Paris 12", text="""Appartement 2 pièces, 50 m²
Paris 12ème (75012) - Bel Air Sud
Prix : 498 000 €
Prix du m² : 9 960 €
Caractéristiques
1 chambre
Étage 6 sur 8
Ascenseur
Balcon 4 m²
Cave
Énergie - consommation conventionnelle : 180 kWh/m²/an - Classe D
Charges prévisionnelles annuelles : 1 900 €""",
  attendu=dict(price=498000, surface=50, rooms=2, bedrooms=1, floor=6, floors=8, elevator=True, outdoor="balcon", cave=True, dpe="D",
               charges=1900, postcode="75012")),
 dict(nom="Century 21", url="https://www.century21.fr/trouver_logement/detail/5512345678/",
  title="Appartement 3 pièces 57,4 m² à vendre Paris 19", text="""Appartement 3 pièces
57,4 m² - Paris 19 (75019)
479 000 €
Honoraires TTC à la charge du vendeur
Description du bien
Au 2ème étage avec ascenseur, appartement de 3 pièces comprenant séjour, 2 chambres, cuisine indépendante. Vue dégagée sur les Buttes-Chaumont. Proche métro Botzaris.
Le bien en détails
Surface habitable : 57,40 m²
Nombre de pièces : 3
Nombre de chambres : 2
DPE : E
GES : B
Copropriété de 64 lots
Charges annuelles : 2 280 €
Pas de procédure en cours
CENTURY 21 Buttes-Chaumont
01 42 00 00 00""",
  attendu=dict(price=479000, surface=57.4, rooms=3, bedrooms=2, floor=2, elevator=True, view=True, dpe="E", lots=64, charges=2280, postcode="75019",
               agencyPhone="0142000000")),
 dict(nom="Location Bien'ici", url="https://www.bienici.com/annonce/location/paris-15e/appartement/2pieces/xyz",
  title="Appartement 2 pièces 42 m² à louer Paris 15e", text="""Location appartement 2 pièces 42 m²
Paris 15e (75015)
1 480 €/mois charges comprises
dont 120 € de charges
Honoraires : 546 €
Dépôt de garantie : 1 360 €
Non meublé
Disponible le 15/11/2026
3e étage, sans ascenseur""",
  attendu=dict(kind="location", price=1480, rentCharges=120, rentHC=1360, agencyFee=546, deposit=1360, furnished=False, floor=3, elevator=False,
               postcode="75015", rooms=2, surface=42)),
 dict(nom="Alerte Jinka", url="https://www.jinka.fr/alert_result?ad=991",
  text="Appartement · 3 pièces · 64 m²\nParis 10e · Canal Saint-Martin\n655 000 €", attendu=dict(price=655000, surface=64, rooms=3, postcode="75010")),
 dict(nom="Alerte Leboncoin", url="https://www.leboncoin.fr/ad/ventes_immobilieres/7",
  text="Appartement 2 pièces 38 m²\n415 000 €\nParis 75020 Gambetta", attendu=dict(price=415000, surface=38, rooms=2, postcode="75020", quartier="Gambetta")),
]
