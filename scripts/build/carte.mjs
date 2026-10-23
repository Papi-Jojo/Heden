// Style du fond de carte Heden (tuiles Protomaps hébergées avec le site : carte/paris.pmtiles, polices carte/fonts/).
// Teintes de la direction artistique : pierre, enduit, café. Ni icônes de commerces ni flèches de sens unique : la carte reste un fond.
//   Sortie : dist/carte/style.json (les tuiles et les polices sont posées par scripts/build/carte-donnees.sh, en intégration continue).
import fs from "node:fs";
import {layers, namedFlavor} from "@protomaps/basemaps";

const T = {fond: "#EEE4D9", terre: "#EEE4D9", rue: "#FAF5EF", rueFine: "#F5EEE6", bord: "#DCCBB9", bati: "#E5D7C8", eau: "#C9D2D8",
  vert: "#DDDCC3", vertFonce: "#D3D4B6", libelle: "#664530", libelleDoux: "#8A6A50", halo: "#F5EEE6", limite: "#BFA58C", rail: "#CDB8A3"};
const base = namedFlavor("light");
const flavor = Object.assign({}, base, {
  background: T.fond, earth: T.terre,
  park_a: T.vert, park_b: T.vertFonce, wood_a: T.vert, wood_b: T.vertFonce, scrub_a: T.vert, scrub_b: T.vertFonce, zoo: T.vert,
  hospital: T.terre, industrial: T.terre, school: T.terre, pedestrian: "#F1E8DE", aerodrome: T.terre, runway: T.bati, military: T.terre,
  glacier: T.terre, sand: T.terre, beach: T.terre, water: T.eau, pier: T.bati, buildings: T.bati,
  tunnel_other_casing: T.bord, tunnel_minor_casing: T.bord, tunnel_link_casing: T.bord, tunnel_major_casing: T.bord, tunnel_highway_casing: T.bord,
  tunnel_other: T.rueFine, tunnel_minor: T.rueFine, tunnel_link: T.rueFine, tunnel_major: T.rueFine, tunnel_highway: T.rueFine,
  minor_service_casing: T.bord, minor_casing: T.bord, link_casing: T.bord, major_casing_late: T.bord, highway_casing_late: T.bord,
  other: T.rueFine, minor_service: T.rueFine, minor_a: T.rueFine, minor_b: T.rue, link: T.rue,
  major_casing_early: T.bord, major: T.rue, highway_casing_early: T.bord, highway: T.rue, railway: T.rail, boundaries: T.limite,
  bridges_other_casing: T.bord, bridges_minor_casing: T.bord, bridges_link_casing: T.bord, bridges_major_casing: T.bord, bridges_highway_casing: T.bord,
  bridges_other: T.rueFine, bridges_minor: T.rue, bridges_link: T.rue, bridges_major: T.rue, bridges_highway: T.rue,
  roads_label_minor: T.libelleDoux, roads_label_minor_halo: T.halo, roads_label_major: T.libelle, roads_label_major_halo: T.halo,
  ocean_label: T.libelleDoux, subplace_label: T.libelleDoux, subplace_label_halo: T.halo, city_label: T.libelle, city_label_halo: T.halo,
  state_label: T.libelleDoux, state_label_halo: T.halo, country_label: T.libelleDoux, address_label: T.libelleDoux, address_label_halo: T.halo,
  landcover: {grassland: T.vert, barren: T.terre, urban_area: T.terre, farmland: T.vert, glacier: T.terre, scrub: T.vert, forest: T.vertFonce}
});
const SANS = new Set(["pois", "roads_shields", "roads_oneway"]);   // icônes : pas de planche d'images, la carte reste sobre
const ls = layers("protomaps", flavor, {lang: "fr"}).filter(l => !SANS.has(l.id)).map(l => {
  if (l.layout && l.layout["icon-image"]) { const lay = Object.assign({}, l.layout); for (const k of Object.keys(lay)) if (k.startsWith("icon-")) delete lay[k]; return Object.assign({}, l, {layout: lay}); }
  return l;
});
const style = {
  version: 8, name: "Heden",
  glyphs: "carte/fonts/{fontstack}/{range}.pbf",
  sources: {protomaps: {type: "vector", url: "pmtiles://carte/paris.pmtiles", attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> · <a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a>'}},
  layers: ls
};
fs.mkdirSync("dist/carte", {recursive: true});
fs.writeFileSync("dist/carte/style.json", JSON.stringify(style));
// la bibliothèque PMTiles, servie avec le site
fs.copyFileSync("node_modules/pmtiles/dist/pmtiles.js", "dist/carte/pmtiles.js");
console.log(`Style de carte : ${ls.length} couches`);
