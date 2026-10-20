/* =========================================================
   Estimations objectives : ventes DVF et lieux OpenStreetMap
   (données préparées par scripts/donnees/build.py, mêmes formules)
   ========================================================= */
const KXm = 111320 * Math.cos(48.86 * Math.PI / 180), KYm = 110540;
const GROUPS = {
  commerces: [[1, 2, 3, 4, 5], 300], vie_sociale: [[10, 11, 12], 400], nuit: [[12, 13], 400],
  culture: [[20, 21, 22, 23, 24], 800], ecoles: [[30, 31, 32, 33, 35], 500], sante: [[4, 40, 41, 42, 43], 500], velo: [[50], 400]
};
const EST_IDS = new Set([...Object.keys(GROUPS), "transports", "verts", "prix"]);
const dataStore = {meta: null, metaP: null, tiles: new Map(), busy: new Map()};
function loadMeta() {
  if (!dataStore.metaP) dataStore.metaP = fetch("data/meta.json", {cache: "no-cache"}).then(r => r.ok ? r.json() : null)
    .then(m => (dataStore.meta = m)).catch(() => null);
  return dataStore.metaP;
}
function loadTile(key) {
  if (!dataStore.tiles.has(key)) {
    const g = dataStore.meta.grid, [i, j] = key.split("_").map(Number);
    const la0 = g.s + i * g.dlat, ln0 = g.w + j * g.dlng;
    dataStore.tiles.set(key, fetch(`data/t/${key}.json?v=${dataStore.meta.version}`).then(r => r.ok ? r.json() : null).then(t => {
      const out = {pois: [], parks: [], sales: []};
      if (!t) return out;
      for (let k = 0; k < t.p.length; k += 3) out.pois.push({lat: la0 + t.p[k] / 1e5, lng: ln0 + t.p[k + 1] / 1e5, c: t.p[k + 2], name: ""});
      for (const s of t.s) out.pois.push({lat: la0 + s[0] / 1e5, lng: ln0 + s[1] / 1e5, c: s[2], name: s[3]});
      for (let k = 0; k < t.g.length; k += 3) out.parks.push({lat: la0 + t.g[k] / 1e5, lng: ln0 + t.g[k + 1] / 1e5, k: t.g[k + 2]});
      const st = dataStore.meta.index ? 8 : 6;
      for (let k = 0; k < t.v.length; k += st) out.sales.push({lat: la0 + t.v[k] / 1e5, lng: ln0 + t.v[k + 1] / 1e5, p: t.v[k + 2], m: t.v[k + 3], s: t.v[k + 4], t: t.v[k + 5],
        f: st === 8 ? t.v[k + 6] : 0, c: st === 8 ? t.v[k + 7] : -1});
      return out;
    }).catch(() => ({pois: [], parks: [], sales: []})));
  }
  return dataStore.tiles.get(key);
}
const distM = (a, b) => Math.hypot((a.lat - b.lat) * KYm, (a.lng - b.lng) * KXm);
function inPoly(lat, lng, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [yi, xi] = pts[i], [yj, xj] = pts[j];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const geomKey = pts => { let h = 0; const s = pts.map(p => p[0].toFixed(5) + "," + p[1].toFixed(5)).join(";"); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const fmtDist = d => d < 15 ? "dans la zone" : "à " + (d < 1000 ? fmtInt(Math.round(d / 10) * 10) + " m" : (d / 1000).toLocaleString("fr-FR", {maximumFractionDigits: 1}) + " km");
const plural = (n, one, many) => `${fmtInt(n)} ${n > 1 ? many : one}`;
const monthLabel = m => new Date(2000 + Math.floor(m / 12), m % 12, 1).toLocaleDateString("fr-FR", {month: "short", year: "numeric"});
function quant(sorted, q) { const i = (sorted.length - 1) * q, a = Math.floor(i), b = Math.ceil(i); return sorted[a] + (sorted[b] - sorted[a]) * (i - a); }

async function estimate(points) {
  const meta = await loadMeta();
  if (!meta || !points || points.length < 3) return null;
  const g = meta.grid, cc = polyCenter(points), c = {lat: cc[0], lng: cc[1]};
  if (c.lat < g.s || c.lat > g.n || c.lng < g.w || c.lng > g.e) return null;
  const req = Math.min(300, Math.sqrt(polyArea(points) / Math.PI));
  const R = 1000 + req, have = new Set(meta.tiles), keys = [];
  const i0 = Math.floor((c.lat - R / KYm - g.s) / g.dlat), i1 = Math.floor((c.lat + R / KYm - g.s) / g.dlat);
  const j0 = Math.floor((c.lng - R / KXm - g.w) / g.dlng), j1 = Math.floor((c.lng + R / KXm - g.w) / g.dlng);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (have.has(i + "_" + j)) keys.push(i + "_" + j);
  const tiles = await Promise.all(keys.map(loadTile));
  const pois = [], parkPts = [], sales = [];
  tiles.forEach(t => { pois.push(...t.pois); parkPts.push(...t.parks); sales.push(...t.sales); });

  // Lieux
  const n = {}, near = {};
  Object.keys(GROUPS).forEach(k => n[k] = 0);
  let tr = 0; const stations = [];
  for (const p of pois) {
    const d = distM(c, p); if (d > R) continue;
    for (const [k, [codes, r]] of Object.entries(GROUPS)) if (codes.includes(p.c) && d <= r + req) n[k]++;
    const dd = Math.max(0, d - req);
    if (!near[p.c] || dd < near[p.c].d) near[p.c] = {d: dd, name: p.name};
    if (p.c >= 60 && p.c <= 62) {
      if (dd <= 800) { tr += (p.c === 61 ? 1.5 : 1) * (1 - dd / 800); stations.push({d: dd, name: p.name, c: p.c}); }
    }
  }
  const cntIn = (codes, r) => pois.filter(p => codes.includes(p.c) && distM(c, p) <= r + req).length;
  const m = {};
  for (const [k, [, r]] of Object.entries(GROUPS)) m[k] = n[k] * (r / (r + req)) ** 2;
  m.transports = tr;
  const best = {};
  for (const p of parkPts) { const dd = Math.max(0, distM(c, p) - req); if (dd <= 800 && (best[p.k] === undefined || dd < best[p.k])) best[p.k] = dd; }
  m.verts = Object.entries(best).reduce((a, [k, dd]) => a + Math.sqrt(meta.parks[k][1] / 10000) * (1 - dd / 800), 0);
  const s = {};
  for (const k of Object.keys(m)) if (meta.q[k]) s[k] = meta.q[k].filter(t => m[k] > t).length;
  /* une station toute proche suffit à bien noter les transports, même sur une seule ligne */
  const dmin = stations.reduce((a, x) => Math.min(a, x.d), Infinity);
  if (s.transports !== undefined) s.transports = Math.max(s.transports, dmin <= 200 ? 4 : dmin <= 400 ? 3 : dmin <= 600 ? 2 : dmin <= 800 ? 1 : 0);

  // Explications
  const why = {};
  const st = stations.sort((a, b) => a.d - b.d).filter((x, i, a) => a.findIndex(y => y.name === x.name) === i);
  const MODE = {60: "Métro", 61: "Gare", 62: "Tram"};
  why.transports = st.length
    ? st.slice(0, 2).map(x => `${MODE[x.c]} ${x.name} ${fmtDist(x.d)}`).join(", ") + (st.length > 2 ? `, ${st.length} stations à moins de 800 m` : "")
    : "Aucune station de métro, RER ou tram à moins de 800 m";
  const nr = (code, label) => near[code] && near[code].d <= 800 ? `${label} ${fmtDist(near[code].d)}` : null;
  why.commerces = [`${plural(n.commerces, "commerce du quotidien", "commerces du quotidien")} à moins de 300 m`,
    nr(1, "boulangerie"), nr(2, "supermarché"), nr(4, "pharmacie"), near[5] && near[5].d <= 800 ? `${/^march/i.test(near[5].name) ? near[5].name : "marché" + (near[5].name ? " " + near[5].name : "")} ${fmtDist(near[5].d)}` : null].filter(Boolean).join(", ");
  why.vie_sociale = `${plural(n.vie_sociale, "restaurant, café ou bar", "restaurants, cafés et bars")} à moins de 400 m`;
  why.nuit = `${plural(n.nuit, "bar ou boîte de nuit", "bars et boîtes de nuit")} à moins de 400 m`;
  why.culture = `${plural(n.culture, "lieu culturel", "lieux culturels")} à moins de 800 m (cinémas, théâtres, musées, bibliothèques, librairies)`;
  const cr = cntIn([30], 500), ec = cntIn([31, 32, 35], 500), co = cntIn([33], 500);
  why.ecoles = (cr + ec + co) ? [cr && plural(cr, "crèche", "crèches"), ec && plural(ec, "école", "écoles"), co && plural(co, "collège", "collèges")].filter(Boolean).join(", ") + " à moins de 500 m"
    : "Aucune crèche ni école à moins de 500 m";
  why.sante = `${plural(n.sante, "médecin, dentiste, laboratoire ou pharmacie", "médecins, dentistes, laboratoires et pharmacies")} à moins de 500 m` + (near[44] && near[44].d <= 1000 ? `, ${near[44].name || "hôpital"} ${fmtDist(near[44].d)}` : "");
  why.velo = `${plural(n.velo, "station de vélos en libre-service", "stations de vélos en libre-service")} à moins de 400 m`;
  const pk = Object.entries(best).map(([k, d]) => ({d, name: meta.parks[k][0], a: meta.parks[k][1]})).sort((a, b) => a.d - b.d);
  const parkTxt = p => `${p.name || "Espace vert"} ${fmtDist(p.d)} (${fmtArea(p.a)})`;
  const big = pk.filter(p => p.a >= 30000).sort((a, b) => b.a - a.a)[0];
  why.verts = pk.length ? [parkTxt(pk[0]), big && big !== pk[0] ? parkTxt(big) : null].filter(Boolean).join(", ") : "Aucun parc ni square à moins de 800 m";

  // Prix des ventes d'appartements sur les 24 derniers mois, ramenés au niveau du dernier trimestre
  let prix = null;
  const last = meta.dvf.last, apps = sales.filter(x => x.t === 0 && x.m > last - 24);
  const pools = [[0, x => inPoly(x.lat, x.lng, points)], [150, x => distM(c, x) <= req + 150], [300, x => distM(c, x) <= req + 300], [500, x => distM(c, x) <= req + 500]];
  let pick = null;
  for (const [r, test] of pools) {
    const all = apps.filter(test), clean = all.filter(x => !(x.f & 1));
    if (clean.length >= 12) { pick = {r, sel: clean, dep: false}; break; }
    if (all.length >= 12) { pick = {r, sel: all, dep: true}; break; }
  }
  if (pick) {
    const ps = pick.sel.map(x => x.p * adjFactor(meta, x)).sort((a, b) => a - b), n = ps.length;
    const r10 = v => Math.round(v / 10) * 10;
    const counts = {}; pick.sel.forEach(x => { if (x.c >= 0) counts[x.c] = (counts[x.c] || 0) + 1; });
    const ci = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const com = ci !== undefined && meta.communes ? meta.communes[ci] : null;
    const med = r10(quant(ps, .5));
    const sect = com ? sectorTrend(meta, com[0].slice(0, 2)) : null;
    let conf = n >= 30 ? 2 : n >= 15 ? 1 : 0;
    if (pick.r >= 300) conf = Math.min(conf, 1);
    prix = {med, q1: r10(quant(ps, .25)), q3: r10(quant(ps, .75)), p10: r10(quant(ps, .1)), p90: r10(quant(ps, .9)),
      n, r: pick.r, from: last - 23, to: last, conf, dep: pick.dep, adj: !!meta.index,
      carrez: Math.round(pick.sel.filter(x => x.f & 2).length / n * 100),
      com: com && com[2] ? {name: com[1], med: com[2], delta: Math.round((med / com[2] - 1) * 100)} : null, sect};
  }
  return {v: meta.version, g: geomKey(points), s, why, prix};
}
const SECTORS = {"75": "Paris", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne"};
function adjFactor(meta, x) {
  if (!meta.index || !meta.communes || x.c < 0) return 1;
  const ix = meta.index[String(meta.communes[x.c][0]).slice(0, 2)]; if (!ix) return 1;
  const k = Math.min(Math.max(Math.floor(x.m / 3) - ix.q0, 0), ix.v.length - 1);
  return 1 / ix.v[k];
}
function sectorTrend(meta, dept) {
  const ix = meta.index && meta.index[dept]; if (!ix || ix.v.length < 5) return null;
  return {name: SECTORS[dept] || dept, trend: Math.round((1 / ix.v[ix.v.length - 5] - 1) * 100)};
}
const CONF = [["Peu de ventes", "conf--0"], ["Indicatif", "conf--1"], ["Fiable", "conf--2"]];
function estScore(z, id, budget = zoneBudget()) {
  const e = z.est; if (!e && !(id === "prix" && isRent())) return undefined;
  if (id === "prix") {
    const b = budget, p = isRent() ? (zoneRent(z) || {}).cc : e.prix && e.prix.med;
    if (!(b > 0) || !p) return undefined;
    const r = p / b;
    return r <= .85 ? 5 : r <= .92 ? 4 : r <= .98 ? 3 : r <= 1.04 ? 2 : r <= 1.10 ? 1 : 0;
  }
  return e.s ? e.s[id] : undefined;
}
function estWhy(z, id) {
  const e = z.est; if (!e) return "";
  if (id === "prix" && isRent()) {
    const r = zoneRent(z), b = zoneBudget(); if (!r) return "";
    return `Loyers autour de ${fmt1(r.cc)} €/m² par mois, charges comprises` + (b > 0 ? `, pour un loyer maximum de ${fmt1(b)} €/m²` : ". Indiquez votre loyer maximum dans Profil pour estimer ce critère");
  }
  if (id === "prix") {
    if (!e.prix) return "";
    const b = state.profile.budget;
    return `Ventes récentes autour de ${fmtInt(e.prix.med)} €/m²` + (b > 0 ? `, pour un budget de ${fmtInt(b)} €/m²` : ". Indiquez votre budget dans Profil pour estimer ce critère");
  }
  return e.why ? e.why[id] || "" : "";
}
const estFresh = z => z.est && dataStore.meta && z.est.v === dataStore.meta.version && z.est.g === geomKey(z.points);
/* Calcule (ou recalcule) l'estimation d'une zone ; onDone n'est appelé que si elle a changé */
function ensureEstimate(z, onDone) {
  if (!z || !Array.isArray(z.points) || z.points.length < 3) return;
  return loadMeta().then(meta => {
    if (!meta || estFresh(z)) return;
    const key = geomKey(z.points);
    if (dataStore.busy.get(z.id || "draft") === key) return;
    dataStore.busy.set(z.id || "draft", key);
    return estimate(z.points).then(e => {
      dataStore.busy.delete(z.id || "draft");
      if (!e || geomKey(z.points) !== key) return;
      z.est = e; onDone && onDone(z);
    }).catch(err => { dataStore.busy.delete(z.id || "draft"); console.warn("Heden : estimation", err); });
  });
}
function refreshEstimates() {
  let changed = false;
  const jobs = state.zones.map(z => ensureEstimate(z, () => { changed = true; }));
  Promise.all(jobs).then(() => { if (changed) { save(); rerenderAll(); } });
}
