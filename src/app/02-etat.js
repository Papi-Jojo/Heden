/* =========================================================
   État et stockage local
   ========================================================= */
function presetCriteria(p) {
  return Object.entries(p.w).map(([id, w]) => ({id, name: LIB[id].name, desc: LIB[id].desc, weight: w}));
}
function defaultState() {
  return {version: 1, profile: {name: "", presetId: "jeunes", modified: false, budget: null, criteria: presetCriteria(PRESETS[0])}, zones: []};
}
let storageOk = true;
function load() {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; }
  catch (e) { storageOk = false; return null; }
}
function saveState() { return save(); }
function save() {
  try {
    if (cloud.user) localStorage.setItem("heden.cache." + cloud.user.id, JSON.stringify({state, synced: cloud.synced, mapId: cloud.mapId}));
    else localStorage.setItem(KEY, JSON.stringify(state));
    storageOk = true;
  } catch (e) { storageOk = false; }
  if (cloud.user) scheduleSync();
}
/* état de la synchronisation : rempli par le module Supabase plus bas */
let cloud = {client: null, user: null, mapId: null, personalMapId: null, maps: [], people: {}, channel: null, invite: null, twins: {}, unseen: {}, names: {}, synced: null, status: "local", timer: null, busy: false, again: false, lastSync: null, error: "", pendingEmail: "", step: "email"};
let state = load() || defaultState();
if (!state.profile || !Array.isArray(state.zones)) state = defaultState();

/* Critères de zone selon le projet affiché : en location, la revente ne compte pas et le prix devient le loyer */
const modeCrit = cs => !isRent() ? cs : (cs || []).filter(c => c.id !== "revente").map(c => c.id === "prix" ? Object.assign({}, c, {name: "Loyer au m² / budget", desc: "5 = nettement sous votre loyer maximum, 0 = au-dessus"}) : c);
const crit = () => mergeCrit(modeCrit(state.profile.criteria), groupCrit());

/* Géométrie des zones : projection locale en mètres (suffisante à l'échelle d'un quartier) */
function toXY(p, lat0) { return [p[1] * 111320 * Math.cos(lat0 * Math.PI / 180), p[0] * 110540]; }
function polyArea(pts) {
  if (!pts || pts.length < 3) return 0;
  const xy = pts.map(p => toXY(p, pts[0][0])); let a = 0;
  for (let i = 0; i < xy.length; i++) { const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a / 2);
}
function polyPerimeter(pts, closed = true) {
  if (!pts || pts.length < 2) return 0;
  const xy = pts.map(p => toXY(p, pts[0][0])); let d = 0;
  const n = closed ? xy.length : xy.length - 1;
  for (let i = 0; i < n; i++) { const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length]; d += Math.hypot(x2 - x1, y2 - y1); }
  return d;
}
function polyCenter(pts) {
  const lat0 = pts[0][0], k = 111320 * Math.cos(lat0 * Math.PI / 180);
  const xy = pts.map(p => toXY(p, lat0)); let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < xy.length; i++) { const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length]; const f = x1 * y2 - x2 * y1; a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f; }
  if (Math.abs(a) < 1e-6) { const m = pts.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]); return [m[0] / pts.length, m[1] / pts.length]; }
  return [cy / (3 * a) / 110540, cx / (3 * a) / k];
}
function circlePoints(lat, lng, r, n = 12) {
  const out = [];
  for (let i = 0; i < n; i++) { const t = 2 * Math.PI * i / n; out.push([lat + r * Math.sin(t) / 110540, lng + r * Math.cos(t) / (111320 * Math.cos(lat * Math.PI / 180))]); }
  return out;
}
function finishZoneGeometry(z) {
  if (!Array.isArray(z.points) && typeof z.lat === "number" && typeof z.radius === "number") z.points = circlePoints(z.lat, z.lng, z.radius);
  if (Array.isArray(z.points) && z.points.length >= 3) { const c = polyCenter(z.points); z.lat = c[0]; z.lng = c[1]; z.area = polyArea(z.points); z.perimeter = polyPerimeter(z.points); }
  delete z.radius;
  return z;
}
const fmtArea = m2 => m2 >= 10000 ? (m2 / 10000).toLocaleString("fr-FR", {maximumFractionDigits: 1}) + " ha" : fmtInt(m2) + " m²";
const walkAround = per => Math.max(1, Math.round(per / 80));
state.zones.forEach(finishZoneGeometry);
let draft = null, draftLayers = null;
let ui = {mode: "list", sheet: "peek", sort: (() => { try { return localStorage.getItem("heden.sort") || "note"; } catch (e) { return "note"; } })()};
let selectedId = null;
