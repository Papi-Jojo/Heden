/* =========================================================
   Données de référence
   ========================================================= */
const LIB = {
  transports:  {name:"Transports", desc:"Métro, RER, bus à pied ; temps de trajet vers les lieux clés"},
  prix:        {name:"Prix au m² / budget", desc:"5 = nettement sous le budget, 0 = hors budget"},
  vie_sociale: {name:"Vie sociale", desc:"Bars, restaurants, culture à quelques minutes à pied"},
  securite:    {name:"Sécurité et ambiance", desc:"Ressenti de jour comme de soir, rue fréquentée et éclairée"},
  commerces:   {name:"Commerces du quotidien", desc:"Supermarché, boulangerie, pharmacie, marché à moins de 5 min"},
  nuisances:   {name:"Nuisances", desc:"5 = calme le soir, rue propre, peu de circulation"},
  verts:       {name:"Espaces verts et sport", desc:"Parc ou square proche, salle de sport, parcours de running"},
  bati:        {name:"Bâti et qualité de la rue", desc:"Immeubles entretenus, trottoirs larges, rue agréable"},
  ecoles:      {name:"Écoles et crèches", desc:"Crèche, maternelle, élémentaire et collège à distance de marche"},
  sante:       {name:"Santé", desc:"Médecins, laboratoires, hôpital accessibles"},
  revente:     {name:"Potentiel de revente", desc:"Dynamique des prix, projets de transport, demande"},
  velo:        {name:"Vélo", desc:"Pistes cyclables, stations Vélib’, stationnement vélo"},
  nuit:        {name:"Vie nocturne", desc:"Bars et sorties ouverts tard"},
  culture:     {name:"Culture", desc:"Cinémas, théâtres, musées, librairies"}
};
const PRESETS = [
  {id:"jeunes", name:"Jeunes actifs", tagline:"Premier achat à deux : vie de quartier, trajets courts, rue agréable",
   w:{transports:10,prix:15,vie_sociale:15,securite:15,commerces:10,nuisances:15,verts:5,bati:15}},
  {id:"famille", name:"Famille", tagline:"Écoles à pied, calme et espaces verts",
   w:{ecoles:20,securite:15,verts:15,nuisances:15,commerces:10,transports:10,prix:10,sante:5}},
  {id:"budget", name:"Budget serré", tagline:"Le meilleur rapport prix, accessibilité et revente",
   w:{prix:25,transports:20,revente:15,commerces:10,securite:10,vie_sociale:10,nuisances:10}},
  {id:"teletravail", name:"Télétravail", tagline:"On vit le quartier en journée : calme, cafés, verdure",
   w:{nuisances:20,verts:15,bati:15,commerces:15,securite:15,vie_sociale:10,prix:10}},
  {id:"invest", name:"Investissement locatif", tagline:"Demande locative et valeur à la revente",
   w:{prix:25,revente:25,transports:20,securite:10,commerces:10,vie_sociale:10}}
];
const MOMENTS = ["Semaine, journée","Semaine, soir","Week-end"];
/* Échelle des notes (DA Heden) : aplats et contours, du brique au vert des squares */
const STOPS = [[0,[224,142,114]],[25,[231,166,108]],[50,[224,192,104]],[75,[182,198,108]],[100,[124,176,108]]];
const TRAIT_JOUR = [[0,[150,62,40]],[25,[148,84,34]],[50,[122,98,22]],[75,[84,108,40]],[100,[44,92,46]]];
const TRAIT_NUIT = [[0,[232,146,118]],[25,[236,170,112]],[50,[232,204,114]],[75,[198,214,120]],[100,[150,204,128]]];
const BOUNDS = [[48.72,2.13],[48.99,2.57]];
const KEY = "ilot.v1";
