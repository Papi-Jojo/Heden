/* =========================================================
   Balade : on trace le parcours, puis on propose une zone
   ========================================================= */
const WALK_KEY = "heden.walk";
const walkDB = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open("heden", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("walkphotos", {keyPath: "id"});
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const run = (mode, fn) => open().then(db => new Promise((res, rej) => {
    const t = db.transaction("walkphotos", mode), q = fn(t.objectStore("walkphotos"));
    t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error);
  }));
  return {put: v => run("readwrite", st => st.put(v)), all: () => run("readonly", st => st.getAll()), clear: () => run("readwrite", st => st.clear())};
})();
function walkPhotosClear() {
  (walk.photos || []).forEach(p => { try { URL.revokeObjectURL(p.url); } catch (e) {} });
  walk.photos = []; if (walk.photoLayer) { map.removeLayer(walk.photoLayer); walk.photoLayer = null; }
  walkDB.clear().catch(() => {});
}
function drawWalkPhotos() {
  if (!walk.photoLayer) walk.photoLayer = L.layerGroup().addTo(map);
  walk.photoLayer.clearLayers();
  (walk.photos || []).forEach(p => { if (p.lat != null) L.marker([p.lat, p.lng], {icon: L.divIcon({className: "", iconSize: null, html: `<span class="wph"><img src="${esc(p.url)}" alt=""></span>`}), interactive: false, keyboard: false}).addTo(walk.photoLayer); });
}
async function addWalkPhotos(files) {
  files = [...files].filter(isImage); if (!files.length) return;
  walk.preparing = (walk.preparing || 0) + files.length; paintWalk();
  for (const f of files) {
    try {
      const pr = await preparePhoto(f), pos = geo.last || {};
      const item = {id: zoneId(), t: Date.now(), lat: pos.lat ?? null, lng: pos.lng ?? null, full: pr.full, th: pr.th, url: pr.url};
      walk.photos.push(item);
      walkDB.put({id: item.id, t: item.t, lat: item.lat, lng: item.lng, full: item.full, th: item.th}).catch(() => {});
    } catch (err) { console.warn(err); }
    walk.preparing--;
  }
  drawWalkPhotos(); paintWalk();
  toast(files.length > 1 ? `${files.length} photos gardées pour la zone` : "Photo gardée pour la zone");
}
const walk = {on: false, pts: [], start: 0, line: null, wake: null, timer: null, trace: null, photos: [], photoLayer: null, preparing: 0};
const walkLen = pts => pts.reduce((a, p, i) => i ? a + distM({lat: pts[i - 1][0], lng: pts[i - 1][1]}, {lat: p[0], lng: p[1]}) : 0, 0);
function walkSave() { try { localStorage.setItem(WALK_KEY, JSON.stringify({on: walk.on, pts: walk.pts, start: walk.start})); } catch (e) {} }
async function keepAwake() {
  try { if (walk.on && "wakeLock" in navigator && (!walk.wake || walk.wake.released)) walk.wake = await navigator.wakeLock.request("screen"); } catch (e) {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") keepAwake(); });
/* Le tracé est découpé en morceaux : suivis par le GPS (pointillés laiton) ou reconstitués après une coupure (tirets gris) */
function walkRuns(pts) {
  const real = [], rec = []; let cur = null, kind = null;
  for (let i = 1; i < pts.length; i++) {
    const k = pts[i][3] || pts[i - 1][3] ? "rec" : "real";
    if (k !== kind) { cur = [[pts[i - 1][0], pts[i - 1][1]]]; (k === "rec" ? rec : real).push(cur); kind = k; }
    cur.push([pts[i][0], pts[i][1]]);
  }
  return {real, rec};
}
function drawWalk() {
  const {real, rec} = walkRuns(walk.pts);
  if (!walk.line) {
    walk.line = L.layerGroup().addTo(map);
    walk.lineReal = L.polyline([], {color: "#A07B33", weight: 4, opacity: .9, dashArray: "1 8", lineCap: "round", interactive: false}).addTo(walk.line);
    walk.lineRec = L.polyline([], {color: "#857B6E", weight: 3, opacity: .8, dashArray: "7 7", interactive: false}).addTo(walk.line);
  }
  walk.lineReal.setLatLngs(real); walk.lineRec.setLatLngs(rec);
}
/* Coupure du suivi (téléphone en veille, appli fermée) : on reconstitue le chemin probable à pied entre les deux positions */
const GAP_S = 40, GAP_M = 40;
async function fillGap(a, b) {
  let co = null;
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(`https://routing.openstreetmap.de/routed-foot/route/v1/foot/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`, {signal: ctl.signal});
    clearTimeout(tm);
    const j = await r.json();
    if (j.code === "Ok" && j.routes && j.routes[0]) co = j.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
  } catch (e) {}
  if (!co || co.length < 2) {                                   // pas d'itinéraire : ligne droite, un point tous les 25 m
    const d = distM({lat: a[0], lng: a[1]}, {lat: b[0], lng: b[1]}), n = Math.max(1, Math.round(d / 25));
    co = Array.from({length: n + 1}, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  }
  const keep = [co[0]];                                          // un point tous les 10 m au moins
  for (const c of co.slice(1, -1)) { const l = keep[keep.length - 1]; if (distM({lat: l[0], lng: l[1]}, {lat: c[0], lng: c[1]}) >= 10) keep.push(c); }
  const mid = keep.slice(1);
  return mid.map((c, i) => [+c[0].toFixed(6), +c[1].toFixed(6), Math.round(a[2] + (b[2] - a[2]) * (i + 1) / (mid.length + 1)), 1]);
}
async function reconstructGap(a, b) {
  walk.filling = (walk.filling || 0) + 1; paintWalk();
  const mid = await fillGap(a, b);
  walk.filling--;
  if (!walk.on) return;
  const i = walk.pts.indexOf(b); if (i < 0) return;
  b[3] = b[3] || 0;
  walk.pts.splice(i, 0, ...mid);
  walkSave(); drawWalk(); paintWalk();
  const mins = Math.round((b[2] - a[2]) / 60000);
  toast(`Trajet reconstitué sur ${mins >= 1 ? mins + " min" : "quelques instants"} de coupure`);
}
function paintWalk() {
  const bar = $("#walkbar"), btn = $("#walkBtn");
  btn.setAttribute("aria-pressed", String(walk.on));
  document.body.classList.toggle("walking", walk.on);
  if (!walk.on) { bar.hidden = true; return; }
  const min = Math.max(0, Math.round((Date.now() - walk.start) / 60000)), len = walkLen(walk.pts);
  bar.hidden = false;
  const dist = len < 1000 ? fmtInt(Math.round(len / 10) * 10) + " m" : (len / 1000).toLocaleString("fr-FR", {maximumFractionDigits: 1}) + " km";
  bar.innerHTML = `<span class="walkbar__t num">${walk.filling ? "<b>Reconstitution…</b>" : walk.pts.length ? `<b>${dist}</b><small>${min} min de balade</small>` : "<b>Signal GPS…</b>"}</span>
    <label class="walkbar__cam" title="Prendre une photo" aria-label="Prendre une photo">${cloud.user ? `<input type="file" accept="image/*" capture="environment" multiple hidden>` : ""}<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>${walk.photos.length || walk.preparing ? `<b class="num">${walk.photos.length + (walk.preparing || 0)}</b>` : ""}</label>
    <button class="btn btn--sm btn--primary" type="button" id="walkEnd">Terminer</button>
    <button class="x" type="button" id="walkCancel" aria-label="Abandonner la balade"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
  $("#walkEnd").onclick = finishWalk;
  const cam = bar.querySelector(".walkbar__cam"), ci = cam.querySelector("input");
  if (ci) ci.onchange = e => { const f = e.target.files; if (f && f.length) addWalkPhotos(f); e.target.value = ""; };
  else cam.onclick = () => openAuth("Connectez-vous pour prendre des photos pendant vos balades et les garder avec la zone.");
  const cx = $("#walkCancel");
  cx.onclick = async () => {
    if (!(await askConfirm({title: "Abandonner la balade ?", text: walk.photos.length ? `Le parcours et les ${walk.photos.length} photo${walk.photos.length > 1 ? "s" : ""} prise${walk.photos.length > 1 ? "s" : ""} seront effacés.` : "Le parcours enregistré sera effacé, aucune zone ne sera proposée.", ok: "Abandonner", cancel: "Continuer la balade", abandon: true}))) return;
    stopWalk(); walkPhotosClear();
  };
}
function onWalkPos(pt) {
  if (!walk.on || pt.acc > 40) return;                  // position trop imprécise : on attend la suivante
  const last = walk.pts[walk.pts.length - 1];
  const np = [+pt.lat.toFixed(6), +pt.lng.toFixed(6), pt.t];
  if (last) {
    const d = distM({lat: last[0], lng: last[1]}, pt), dt = (pt.t - last[2]) / 1000;
    if (d < 8) return;                                  // on ne bouge pas : pas de nouveau point
    if (dt > GAP_S && d > GAP_M) {                      // le suivi a été coupé : on reprend et on comble le trou
      if (d > 3000) np[3] = 1;                          // trop loin pour l'avoir fait à pied : simple liaison grise
      walk.pts.push(np); walkSave(); drawWalk(); paintWalk();
      if (d <= 3000) reconstructGap(last, np);
      return;
    }
    if (dt > 0 && d / dt > 7) return;                   // saut irréaliste à pied
  }
  walk.pts.push(np);
  walkSave(); drawWalk(); paintWalk();
}
geo.listeners.add(onWalkPos);
function startWalk() {
  if (ui.mode === "placing" || ui.mode === "rating") return toast("Terminez d’abord la zone en cours");
  if (!startGeo(true)) return;
  walkPhotosClear();
  Object.assign(walk, {on: true, pts: [], start: Date.now()});
  walkSave(); keepAwake(); drawWalk(); paintWalk();
  clearInterval(walk.timer); walk.timer = setInterval(paintWalk, 30000);
  (() => { try { if (localStorage.getItem("heden.walkhint")) return; localStorage.setItem("heden.walkhint", "1"); } catch (e) {} toast("Écran éteint ? Le trajet manquant sera reconstitué au retour"); })();
}
function stopWalk(keepTrace) {
  walk.on = false; clearInterval(walk.timer);
  try { walk.wake && walk.wake.release(); } catch (e) {} walk.wake = null;
  try { localStorage.removeItem(WALK_KEY); } catch (e) {}
  if (walk.line) {
    if (keepTrace) { walk.trace = walk.line; walk.lineReal.setStyle({opacity: .55}); walk.lineRec.setStyle({opacity: .5}); }
    else map.removeLayer(walk.line);
    walk.line = walk.lineReal = walk.lineRec = null;
  }
  paintWalk();
}
function clearWalkTrace() { if (walk.trace) { map.removeLayer(walk.trace); walk.trace = null; } }
function loadTurf() {
  if (window.turf) return Promise.resolve(window.turf);
  return new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/@turf/turf@7.1.0/turf.min.js"; sc.onload = () => res(window.turf); sc.onerror = rej; document.head.appendChild(sc); });
}
/* Parcours -> zone : une bande de 60 m autour du chemin (les deux côtés de la rue), les boucles et les pâtés contournés sont remplis */
async function walkToZone(pts) {
  const T = await loadTurf();
  let co = pts.map(p => [p[1], p[0]]);
  co = co.map((c, i) => i === 0 || i === co.length - 1 ? c : [(co[i - 1][0] + c[0] + co[i + 1][0]) / 3, (co[i - 1][1] + c[1] + co[i + 1][1]) / 3]);
  const len = walkLen(pts), a = {lat: co[0][1], lng: co[0][0]}, b = {lat: co[co.length - 1][1], lng: co[co.length - 1][0]};
  if (len > 250 && distM(a, b) < Math.max(80, len * .2)) co.push(co[0]);      // retour près du départ : on ferme la boucle
  const buf = T.buffer(T.lineString(co), 30, {units: "meters"});
  const outers = buf.geometry.type === "MultiPolygon" ? buf.geometry.coordinates.map(p => p[0]) : [buf.geometry.coordinates[0]];
  let shape = T.polygon([outers.sort((x, y) => T.area(T.polygon([y])) - T.area(T.polygon([x])))[0]]);   // sans les trous
  for (const tol of [.00012, .00016, .0002, .0003, .0005]) {     // ≈ 10 m et plus : des coins nets, peu de points à ajuster
    shape = T.simplify(shape, {tolerance: tol, highQuality: true});
    if (shape.geometry.coordinates[0].length - 1 <= 12) break;
  }
  return shape.geometry.coordinates[0].slice(0, -1).map(([x, y]) => [y, x]);
}
async function finishWalk() {
  for (let k = 0; (walk.filling || walk.preparing) && k < 60; k++) await new Promise(r => setTimeout(r, 250));
  const pts = walk.pts, len = walkLen(pts);
  if (pts.length < 4 || len < 120) return toast("Balade trop courte : marchez au moins 150 m");
  const btn = $("#walkEnd"); if (btn) { btn.disabled = true; btn.textContent = "Calcul…"; }
  let poly;
  try { poly = await walkToZone(pts); }
  catch (err) { console.warn(err); if (btn) { btn.disabled = false; btn.textContent = "Terminer"; } return toast("Zone impossible à calculer pour l’instant : réessayez"); }
  const minutes = Math.max(1, Math.round((Date.now() - walk.start) / 60000));
  stopWalk(true);
  startNew();
  draft.points = poly; draft.closed = true; draft.walk = {len: Math.round(len), min: minutes, rec: pts.some(p => p[3])};
  draft.pendingPhotos = walk.photos.map(p => ({full: p.full, th: p.th, url: p.url}));
  finishZoneGeometry(draft);
  setHint("Zone proposée d’après votre balade : ajustez les points, puis validez");
  drawDraft(); renderPanel();
  requestAnimationFrame(fitDraft);
  if (draft.area > 600000) toast("Grande zone : resserrez-la sur le coin visité");
}
$("#walkBtn").onclick = () => walk.on ? finishWalk() : startWalk();
/* reprise d'une balade interrompue (page rechargée, appli rouverte) */
try {
  const w = JSON.parse(localStorage.getItem(WALK_KEY) || "null");
  if (w && w.on && Date.now() - w.start < 6 * 3600e3) {
    Object.assign(walk, {on: true, pts: w.pts || [], start: w.start});
    startGeo(false); keepAwake(); drawWalk(); paintWalk();
    walkDB.all().then(all => { walk.photos = (all || []).sort((a, b) => a.t - b.t).map(p => Object.assign(p, {url: URL.createObjectURL(p.th.blob)})); drawWalkPhotos(); paintWalk(); }).catch(() => {});
    walk.timer = setInterval(paintWalk, 30000);
    setTimeout(() => toast("Balade reprise"), 800);
  }
} catch (e) {}
/* si la position est déjà autorisée, la pastille s'affiche dès l'ouverture, sans rien demander */
try { navigator.permissions && navigator.permissions.query({name: "geolocation"}).then(r => { if (r.state === "granted") startGeo(false); }).catch(() => {}); } catch (e) {}
