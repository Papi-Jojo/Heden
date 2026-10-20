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

const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
const OFM = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> ' + OSM;
const STYLE_PLAN = "https://tiles.openfreemap.org/styles/positron";
function supportsGL() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; }
}
const tiles = {
  osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom: 19, attribution: OSM}),
  sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {maxZoom: 19, attribution: "Imagerie &copy; Esri, Maxar, Earthstar Geographics"}),
  satLabels: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {maxZoom: 19, pane: "shadowPane", attribution: "&copy; Esri"})
};
/* Fond « Plan » : tuiles vectorielles OpenFreeMap (gratuites, sans clé). Repli sur OpenStreetMap si WebGL est indisponible. */
let planLayer = null;
function getPlan() {
  if (planLayer) return planLayer;
  try {
    if (L.maplibreGL && window.maplibregl && supportsGL()) {
      planLayer = L.maplibreGL({style: STYLE_PLAN, attribution: OFM, maxZoom: 19});
      return planLayer;
    }
  } catch (e) {}
  planLayer = tiles.osm;
  return planLayer;
}
/* La carte reste en beige clair dans les deux thèmes : c'est elle qu'on regarde. */
const MAPTONES = {fond: "#EEE4D9", rue: "#FAF5EF", bord: "#DCCBB9", bati: "#E5D7C8", eau: "#C9D2D8", vert: "#DDD6C1", libelle: "#664530", halo: "#F5EEE6", limite: "#BFA58C"};
function tintPlan() {
  if (!planLayer || typeof planLayer.getMaplibreMap !== "function") return;
  const m = planLayer.getMaplibreMap(); if (!m) return;
  const apply = () => {
    const t = MAPTONES, st = m.getStyle(); if (!st || !st.layers) return;
    const set = (id, k, v) => { try { m.setPaintProperty(id, k, v); } catch (e) {} };
    for (const l of st.layers) {
      const id = l.id;
      /* voies ferrées, métro aérien, ferries et pistes : masqués, ils brouillent la lecture des îlots */
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
let base = "plan";
function applyBase() {
  [tiles.osm, tiles.sat, tiles.satLabels, planLayer].forEach(t => { if (t && map.hasLayer(t)) map.removeLayer(t); });
  if (base === "sat") { tiles.sat.addTo(map); tiles.satLabels.addTo(map); }
  else { getPlan().addTo(map); tintPlan(); }
  $$("#basemap button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.base === base)));
  if (draft) drawDraft();
}
$$("#basemap button").forEach(b => b.addEventListener("click", () => { base = b.dataset.base; applyBase(); }));
dark.addEventListener?.("change", () => { renderZones(); if (draft) drawDraft(); });
applyBase();

/* Les contrôles posés sur la carte (recherche, Plan/Satellite, position, consigne) ne doivent jamais poser de point */
document.querySelectorAll("#map .map-top, #map .fab-col, #map .hint, #map .walkbar, #map .mapmode").forEach(el => { L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el); });
function updateFar() { const zm = map.getZoom(); map.getContainer().classList.toggle("map--far", zm < 13); map.getContainer().classList.toggle("map--near", zm >= 15); }
map.on("zoomend", updateFar); updateFar();

/* Zones enregistrées */
const zoneLayer = L.layerGroup().addTo(map);
const mapFilter = (() => { try { return Object.assign({zones: true, annonces: true}, JSON.parse(localStorage.getItem("heden.mapf") || "{}")); } catch (e) { return {zones: true, annonces: true}; } })();
let justSaved = null;
function renderZones() {
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
const draftColor = () => base === "sat" ? "#F8F5F0" : "#1F3A6E";
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
