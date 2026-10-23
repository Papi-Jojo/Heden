/* =========================================================
   Carte
   ========================================================= */
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const isDesktop = () => window.matchMedia("(min-width: 900px)").matches;
const map = L.map("map", {
  zoomControl: false, minZoom: 11, maxZoom: 19,
  maxBounds: L.latLngBounds(BOUNDS).pad(0.25), maxBoundsViscosity: 0.9
}).setView([48.8575, 2.3450], isDesktop() ? 13 : 12);
L.control.zoom({position: "bottomright"}).addTo(map);
map.attributionControl.setPrefix(false);
/* Crédits de la carte : un petit « i » dans le coin ; on le touche pour lire la source (exigée par la licence d'OpenStreetMap) */
function creditsDiscrets(m, pos = "bottomleft") {
  const box = m.getContainer(); if (box.__credits) return; box.__credits = true;
  box.classList.add("has-credits");
  if (m.attributionControl) m.attributionControl.setPosition(pos);   // à gauche : la droite porte déjà les boutons de la carte
  const Btn = L.Control.extend({options: {position: pos}, onAdd() {
    const b = L.DomUtil.create("button", "credits__i"); b.type = "button"; b.textContent = "i";
    b.setAttribute("aria-label", "Sources de la carte"); b.title = "Sources de la carte"; b.setAttribute("aria-expanded", "false");
    L.DomEvent.disableClickPropagation(b);
    b.onclick = () => { const o = box.classList.toggle("credits-open"); b.setAttribute("aria-expanded", String(o)); };
    return b; }});
  new Btn().addTo(m);
}
creditsDiscrets(map, isDesktop() ? "bottomleft" : "topleft");   // téléphone : sous la recherche, la feuille des zones couvre le bas

const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
const OFM = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> ' + OSM;
/* Fond de carte Heden : tuiles et polices servies avec le site (carte/, scripts/build/carte.mjs et carte-donnees.sh), aucun service tiers ;
   repli sur OpenFreeMap seulement si les tuiles manquent (site local sans les données de carte) */
const STYLE_HEDEN = "carte/style.json", STYLE_OFM = "https://tiles.openfreemap.org/styles/positron";
let STYLE_PLAN = STYLE_OFM, planHeden = false;
const SITE = new URL(".", location.href).href;   // adresses absolues : MapLibre lit les tuiles et les polices hors de la page
try { if (window.pmtiles && window.maplibregl) {
  const P = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", (q, ac) => P.tile(Object.assign({}, q, {url: q.url.replace(/^pmtiles:\/\/(?![a-z]+:)/i, "pmtiles://" + SITE)}), ac));
  STYLE_PLAN = SITE + STYLE_HEDEN; planHeden = true;
} } catch (e) {}
const planRequete = (url, type) => !/^[a-z]+:/i.test(url) ? {url: new URL(url, SITE).href} : {url};
const planAttrib = () => planHeden ? OSM + ' · <a href="https://protomaps.com" target="_blank">Protomaps</a>' : OFM;
const planPret = planHeden ? fetch("carte/paris.pmtiles", {method: "HEAD"}).then(r => r.ok).catch(() => false) : Promise.resolve(false);
planPret.then(ok => { if (ok || !planHeden) return;
  if (map.attributionControl) map.attributionControl.removeAttribution(planAttrib());
  planHeden = false; STYLE_PLAN = STYLE_OFM;   // pas de tuiles ici : le fond public
  if (map.attributionControl && planLayer && planLayer !== tiles.osm) map.attributionControl.addAttribution(planAttrib());
  if (planLayer && typeof planLayer.getMaplibreMap === "function") { const m = planLayer.getMaplibreMap(); if (m) { m.setStyle(STYLE_OFM); tintPlan(); } } });
function supportsGL() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; }
}
const tiles = {osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom: 19, attribution: OSM})};
/* Fond « Plan » : tuiles vectorielles OpenFreeMap (gratuites, sans clé). Repli sur OpenStreetMap si WebGL est indisponible. */
let planLayer = null;
function getPlan() {
  if (planLayer) return planLayer;
  try {
    if (L.maplibreGL && window.maplibregl && supportsGL()) {
      planLayer = L.maplibreGL({style: STYLE_PLAN, attribution: planAttrib(), maxZoom: 19, transformRequest: planRequete});
      return planLayer;
    }
  } catch (e) {}
  planLayer = tiles.osm;
  return planLayer;
}
/* La carte reste en beige clair dans les deux thèmes : c'est elle qu'on regarde. */
const MAPTONES = {fond: "#EEE4D9", rue: "#FAF5EF", bord: "#DCCBB9", bati: "#E5D7C8", eau: "#C9D2D8", vert: "#DDD6C1", libelle: "#664530", halo: "#F5EEE6", limite: "#BFA58C"};
function tintPlan(layer = planLayer) {
  if (planHeden || !layer || typeof layer.getMaplibreMap !== "function") return;   // le fond Heden a déjà ses teintes
  const m = layer.getMaplibreMap(); if (!m) return;
  const apply = () => {
    const t = MAPTONES, st = m.getStyle(); if (!st || !st.layers) return;
    const set = (id, k, v) => { try { m.setPaintProperty(id, k, v); } catch (e) {} };
    for (const l of st.layers) {
      const id = l.id;
      /* voies ferrées, métro aérien, ferries et pistes : masqués, ils brouillent la lecture des îlots */
      if (/heden/.test(id)) continue;
      if (/rail|transit|ferry|aeroway|aerialway/.test(id)) { try { m.setLayoutProperty(id, "visibility", "none"); } catch (e) {} continue; }
      if (l.type === "background") set(id, "background-color", t.fond);
      else if (l.type === "fill") {
        if (/water/.test(id)) set(id, "fill-color", t.eau);
        else if (/park|wood|grass|landcover|cemetery|pitch|garden|forest|golf/.test(id)) set(id, "fill-color", t.vert);
        else if (/building/.test(id)) { set(id, "fill-color", t.bati); set(id, "fill-outline-color", t.bord); }
        else set(id, "fill-color", t.fond);
      } else if (l.type === "line") {
        if (/water|river|canal|stream/.test(id)) set(id, "line-color", t.eau);
        else if (/boundary|admin/.test(id)) set(id, "line-color", t.limite);
        else if (/casing/.test(id)) set(id, "line-color", t.bord);
        else if (/highway|road|street|bridge|tunnel|path|minor|major|motorway|service|track|primary|secondary/.test(id)) set(id, "line-color", t.rue);
      } else if (l.type === "symbol" && l.layout && l.layout["text-field"]) {
        set(id, "text-color", t.libelle); set(id, "text-halo-color", t.halo); set(id, "text-halo-width", 1.4);
      }
    }
  };
  if (!m.__hedenTint) { m.__hedenTint = apply; m.on("style.load", apply); }
  if (m.isStyleLoaded && m.isStyleLoaded()) apply(); else m.once("load", apply);
}
function applyBase() { const p = getPlan(); p.addTo(map); if (p !== tiles.osm && map.attributionControl) map.attributionControl.addAttribution(planAttrib()); tintPlan(); vertApply(); }
dark.addEventListener?.("change", () => { renderZones(); if (draft) drawDraft(); });

/* ---------- Espaces verts : les parcs, jardins, squares, bois et cimetières d'OpenStreetMap (data/verts.json, scripts/donnees/verts.py) ----------
   Un aplat sauge, un liseré, et de petits arbres posés en semis à partir du zoom de quartier ; sous les noms de rues.
   Sans WebGL : les mêmes contours, sans arbres. */
const VERT = {fond: "#D2DAB8", bord: "#A7B58A", cime: "#8A9C66", clair: "#A9B98A", tronc: "#7A6A50"};
let vertOn = (() => { try { return localStorage.getItem("heden.vert") === "1"; } catch (e) { return false; } })();
let vertData = null, vertLeaf = null;
const vertDispo = () => true;
function vertCharger() {
  return vertData ? Promise.resolve(vertData) : fetch("data/verts.json?v=" + Math.floor(Date.now() / 864e5)).then(r => r.ok ? r.json() : null).then(d => (vertData = d)).catch(() => null);
}
/* Un arbre minimaliste : une cime ronde (ou ovale), un reflet, un tronc fin, une ombre au sol. Trois variantes, dessinées une fois. */
function vertArbre(k) {
  const W = 44, H = 56, c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  const cx = W / 2, rx = [13, 10.5, 11.5][k], ry = [13, 16, 11.5][k], cy = H - 14 - ry;
  g.fillStyle = "rgba(62,72,38,.16)"; g.beginPath(); g.ellipse(cx + 3, H - 6, rx * .9, 3.2, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = VERT.tronc; g.lineWidth = 2.6; g.lineCap = "round"; g.beginPath(); g.moveTo(cx, H - 7); g.lineTo(cx, cy + ry * .4); g.stroke();
  g.fillStyle = VERT.cime; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
  if (k === 2) { g.beginPath(); g.ellipse(cx - 7, cy + 4, 7.5, 7.5, 0, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = VERT.clair; g.beginPath(); g.ellipse(cx - rx * .32, cy - ry * .34, rx * .42, ry * .3, -.5, 0, Math.PI * 2); g.fill();
  return g.getImageData(0, 0, W, H);
}
const vertGeo = d => ({type: "FeatureCollection", features: d.p.map(r => ({type: "Feature", properties: {}, geometry: {type: "Polygon", coordinates: r}}))});
const arbresGeo = d => ({type: "FeatureCollection", features: d.a.map(([x, y, k]) => ({type: "Feature", properties: {k}, geometry: {type: "Point", coordinates: [x, y]}}))});
async function vertApply() {
  const gl = planLayer && typeof planLayer.getMaplibreMap === "function" ? planLayer.getMaplibreMap() : null;
  if (!vertOn) {
    if (vertLeaf) { map.removeLayer(vertLeaf); vertLeaf = null; }
    if (gl) ["heden-arbres", "heden-verts-bord", "heden-verts-fond"].forEach(id => { try { if (gl.getLayer(id)) gl.removeLayer(id); } catch (e) {} });
    return;
  }
  const d = await vertCharger();
  if (!d || !vertOn) { if (!d) toast("Les espaces verts ne sont pas encore prêts"); return; }
  if (!gl) {   // repli sans WebGL : contours seulement
    if (!vertLeaf) vertLeaf = L.geoJSON(vertGeo(d), {interactive: false, style: {color: VERT.bord, weight: 1, fillColor: VERT.fond, fillOpacity: .85}}).addTo(map);
    return;
  }
  const go = () => {
    if (!vertOn) return;
    const st = gl.getStyle(); if (!st || !st.layers) return;
    try {
      if (!gl.getSource("heden-verts")) gl.addSource("heden-verts", {type: "geojson", data: vertGeo(d), tolerance: .5});
      if (!gl.getSource("heden-arbres")) gl.addSource("heden-arbres", {type: "geojson", data: arbresGeo(d)});
      [0, 1, 2].forEach(k => { if (!gl.hasImage("heden-arbre-" + k)) gl.addImage("heden-arbre-" + k, vertArbre(k), {pixelRatio: 2}); });
      const avant = (st.layers.find(l => l.type === "symbol") || {}).id;   // sous les noms de rues et de lieux
      if (!gl.getLayer("heden-verts-fond")) gl.addLayer({id: "heden-verts-fond", type: "fill", source: "heden-verts", paint: {"fill-color": VERT.fond, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 11, .75, 15, .92]}}, avant);
      if (!gl.getLayer("heden-verts-bord")) gl.addLayer({id: "heden-verts-bord", type: "line", source: "heden-verts", paint: {"line-color": VERT.bord, "line-width": ["interpolate", ["linear"], ["zoom"], 12, .5, 16, 1.3]}}, avant);
      if (!gl.getLayer("heden-arbres")) gl.addLayer({id: "heden-arbres", type: "symbol", source: "heden-arbres", minzoom: 13.5,
        layout: {"icon-image": ["concat", "heden-arbre-", ["to-string", ["get", "k"]]], "icon-anchor": "bottom", "icon-allow-overlap": true, "icon-ignore-placement": true, "symbol-z-order": "viewport-y",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 13.5, .4, 15, .7, 17, 1.1]},
        paint: {"icon-opacity": ["interpolate", ["linear"], ["zoom"], 13.5, 0, 14.2, 1]}}, avant);
    } catch (e) { console.warn("Heden : espaces verts", e); }
  };
  if (!gl.__hedenVert) { gl.__hedenVert = true; gl.on("style.load", () => vertOn && go()); }
  if (gl.isStyleLoaded && gl.isStyleLoaded()) go(); else gl.once("load", go);
}
applyBase();

/* Les contrôles posés sur la carte (recherche, filtres, position, consigne) ne doivent jamais poser de point */
document.querySelectorAll("#map .map-top, #map .fab-col, #map .hint, #map .walkbar, #map .mapmode").forEach(el => { L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el); });
function updateFar() { const zm = map.getZoom(); map.getContainer().classList.toggle("map--far", zm < 13); map.getContainer().classList.toggle("map--near", zm >= 15); }
map.on("zoomend", updateFar); updateFar();

/* Zones enregistrées */
const zoneLayer = L.layerGroup().addTo(map);
const mapFilter = (() => { try { return Object.assign({zones: true, annonces: true}, JSON.parse(localStorage.getItem("heden.mapf") || "{}")); } catch (e) { return {zones: true, annonces: true}; } })();
let justSaved = null;
function renderZones() {
  // une zone notée ou modifiée change la note des favoris autour : leurs pastilles suivent
  clearTimeout(renderZones.pins); renderZones.pins = setTimeout(() => { if (typeof renderListingPins === "function") renderListingPins(); }, 150);
  zoneLayer.clearLayers();
  for (const z of state.zones) {
    if (draft && draft.id === z.id) continue;
    if (mapFilter.zones === false && z.id !== selectedId) continue;
    const {score} = zoneScore(z);
    const col = colorFor(score);
    const out = overBudget(z);
    const circle = L.polygon(z.points, {
      color: traitMap(score), weight: selectedId === z.id ? 3 : 2, opacity: 1, className: justSaved === z.id ? "zone-new" : "",
      fillColor: col, fillOpacity: out ? .12 : (selectedId === z.id ? .45 : .3),
      dashArray: out ? "5 6" : null, bubblingMouseEvents: false
    });
    const badge = L.marker([z.lat, z.lng], {
      icon: L.divIcon({className: "", iconSize: null,
        html: `<span class="zone-badge" style="--c:${col}">${coverOf(z) && photoUrl(coverOf(z).thumb) ? `<img class="zb-img" src="${esc(photoUrl(coverOf(z).thumb))}" alt="">` : ""}<i></i>${score == null ? "–" : score}${anyFav(z) ? HEART : ""}${zonePrice(z) ? `<em class="zb-p">${fmtInt(zonePrice(z))}&#8239;€/m²</em>` : ""}</span>`}),
      keyboard: false
    });
    const onClick = e => { if (ui.mode === "placing") { addPoint(e.latlng); return; } openDetail(z.id); };
    circle.on("click", onClick); badge.on("click", onClick);
    circle.addTo(zoneLayer); badge.addTo(zoneLayer);
    if (justSaved === z.id && circle._path && circle._path.getTotalLength) circle._path.style.setProperty("--len", Math.ceil(circle._path.getTotalLength()));
  }
}

/* Zone en cours de tracé : sommets, poignées de milieu, aperçu rempli */
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const draftColor = () => "#1F3A6E";
let draftShape = null, selVertex = null;
function clearDraftLayers() { clearGhost(); if (draftLayers) { draftLayers.forEach(l => map.removeLayer(l)); draftLayers = null; draftShape = null; } }
function handleIcon(cls, size) { return L.divIcon({className: "handle " + cls, iconSize: [size, size]}); }
function drawDraft() {
  clearDraftLayers();
  if (!draft) return;
  const pts = draft.points, c = draftColor(), editing = ui.mode === "placing", layers = [];
  if (pts.length >= 2) {
    const style = {color: c, weight: editing ? 2.5 : 3, dashArray: editing ? "7 6" : null, interactive: false};
    draftShape = (pts.length >= 3 || !editing) ? L.polygon(pts, Object.assign({fillColor: c, fillOpacity: editing ? .2 : .24}, style)) : L.polyline(pts, style);
    layers.push(draftShape.addTo(map));
  }
  if (editing && draft.closed) {
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      const m = L.marker([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], {draggable: true, keyboard: false, icon: handleIcon("handle--mid", 14), title: "Tirer pour ajouter un point"}).addTo(map);
      let idx = null;
      m.on("dragstart", () => { idx = i + 1; const ll = m.getLatLng(); draft.points.splice(idx, 0, [ll.lat, ll.lng]); });
      m.on("drag", () => { const ll = m.getLatLng(); draft.points[idx] = [ll.lat, ll.lng]; draftShape && draftShape.setLatLngs(draft.points); });
      m.on("dragend", () => { selVertex = idx; drawDraft(); renderPanel(); });
      m.on("click", () => { const ll = m.getLatLng(); draft.points.splice(i + 1, 0, [ll.lat, ll.lng]); selVertex = i + 1; drawDraft(); renderPanel(); });
      layers.push(m);
    });
  }
  if (editing) {
    pts.forEach((p, i) => {
      const first = i === 0 && !draft.closed && pts.length >= 3;
      const v = L.marker(p, {draggable: true, keyboard: false, title: first ? "Fermer la zone" : "Déplacer ce point",
        icon: handleIcon("handle--vertex" + (first ? " handle--first" : "") + (selVertex === i ? " handle--sel" : ""), first ? 24 : 20)}).addTo(map);
      v.on("drag", () => { const ll = v.getLatLng(); draft.points[i] = [ll.lat, ll.lng]; draftShape && draftShape.setLatLngs(draft.points); });
      v.on("dragend", () => { selVertex = i; drawDraft(); renderPanel(); });
      v.on("click", () => { if (first) { closeShape(); return; } selVertex = selVertex === i ? null : i; drawDraft(); renderPanel(); });
      v.on("contextmenu", e => { if (e.originalEvent) L.DomEvent.preventDefault(e.originalEvent); removeVertex(i); });
      layers.push(v);
    });
  }
  draftLayers = layers;
}
let ghost = null;
function clearGhost() { if (ghost) { map.removeLayer(ghost); ghost = null; } }
map.on("mousemove", e => {
  if (ui.mode !== "placing" || !draft || draft.closed || !draft.points.length) return clearGhost();
  const pts = draft.points.concat([[e.latlng.lat, e.latlng.lng]]);
  const c = draftColor();
  if (!ghost || (pts.length >= 3) !== (ghost instanceof L.Polygon)) {
    clearGhost();
    ghost = pts.length >= 3 ? L.polygon(pts, {color: c, weight: 1.5, opacity: .6, dashArray: "2 6", fillColor: c, fillOpacity: .1, interactive: false})
                            : L.polyline(pts, {color: c, weight: 1.5, opacity: .6, dashArray: "2 6", interactive: false});
    ghost.addTo(map);
  } else ghost.setLatLngs(pts);
});
map.on("mouseout", clearGhost);
function addPoint(latlng) {
  if (!draft) return;
  if (draft.closed) { selVertex = null; drawDraft(); renderPanel(); return; }
  if (!draft.points.length && map.getZoom() < 15) map.setView(latlng, 15, {animate: true});
  draft.points.push([latlng.lat, latlng.lng]);
  setHint(draft.points.length < 3 ? "Continuez à poser les points du contour" : "Touchez le premier point pour fermer la zone");
  drawDraft(); renderPanel();
}
function closeShape() {
  if (!draft || draft.points.length < 3) return;
  draft.closed = true; selVertex = null;
  setHint("Glissez un point pour modeler la zone, tirez un point bleu pour en ajouter un");
  drawDraft(); renderPanel();
}
function removeVertex(i) {
  if (!draft) return;
  if (draft.closed && draft.points.length <= 3) return toast("Une zone garde au moins 3 points");
  draft.points.splice(i, 1); selVertex = null;
  drawDraft(); renderPanel();
}
map.on("click", e => {
  if (ui.mode === "placing") addPoint(e.latlng);
  /* un clic sur la carte, hors zone existante, commence une nouvelle zone */
  else if (ui.mode === "list" || ui.mode === "detail") { startNew(); addPoint(e.latlng); }
});
