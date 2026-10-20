/* =========================================================
   Projet : acheter, louer, ou les deux. Un seul mode visible à la fois.
   ========================================================= */
const homeRaw = () => (state.profile && state.profile.home) || {};
const projet = () => { const h = homeRaw(); return h.projet || (h.setup && h.setup.projet) || "achat"; };
let modeSel = (() => { try { return localStorage.getItem("heden.mode") === "location" ? "location" : "achat"; } catch (e) { return "achat"; } })();
const curMode = () => projet() === "deux" ? modeSel : projet();
const isRent = () => curMode() === "location";
const kindOf = f => f && f.kind === "location" ? "location" : "achat";
const modeListings = () => listings().filter(f => kindOf(f) === curMode());
const fmt1 = v => (Math.round(v * 10) / 10).toLocaleString("fr-FR", {maximumFractionDigits: 1});
const priceTxt = f => f.price ? fmtInt(f.price) + "&#8239;€" + (kindOf(f) === "location" ? `<small class="permo">/mois</small>` : "") : (kindOf(f) === "location" ? "Loyer ?" : "Prix ?");
const ppmTxt = f => f.price && f.surface ? (kindOf(f) === "location" ? fmt1(f.price / f.surface) : fmtInt(f.price / f.surface)) + "&#8239;€/m²" : "";
function setMode(m) {
  if (m === modeSel && projet() === "deux") return;
  modeSel = m; try { localStorage.setItem("heden.mode", m); } catch (e) {}
  paintModeSel(); lui.openId = null; rerenderAll();
}
function modeSelHTML(cls = "") {
  if (projet() !== "deux") return "";
  return `<div class="seg seg--sm modesel ${cls}" role="group" aria-label="Projet affiché"><button type="button" data-proj="achat" aria-pressed="${curMode() === "achat"}">Achat</button><button type="button" data-proj="location" aria-pressed="${curMode() === "location"}">Location</button></div>`;
}
function bindModeSel(root = document) { $$("[data-proj]", root).forEach(b => b.onclick = () => setMode(b.dataset.proj)); }
function paintModeSel() {
  $$("[data-proj]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.proj === curMode())));
  const mm = $("#mapMode"); if (mm) { mm.hidden = projet() !== "deux"; mm.classList.toggle("is-loc", curMode() === "location"); }
}
/* budget de zone en €/m² : prix de vente pour l'achat, loyer par mois pour la location */
function rentPpmBudget() {
  const h = homeRaw(), l = h.loc || {}; if (!(l.loyerMax > 0)) return null;
  const surf = h.surfaceMin || {1: 25, 2: 40, 3: 58, 4: 75, 5: 95}[Math.min(5, h.roomsMin || 2)];
  return Math.round(l.loyerMax / surf * 10) / 10;
}
const zoneBudget = () => isRent() ? rentPpmBudget() : state.profile.budget;

/* ---------- Loyers de référence (data/loyers.json, préparé par scripts/donnees/loyers.py) ---------- */
const LOY = {data: null, p: null, names: null};
const ENCADRE = new Set(["93001", "93031", "93039", "93027", "93059", "93066", "93070", "93072", "93079", "93006", "93008", "93010", "93045", "93048", "93053", "93055", "93061", "93063"]);
const SIMU_LOYER = "https://www.referenceloyer.drihl.ile-de-france.developpement-durable.gouv.fr/";
const CHARGES_M2 = 2.5;   // charges locatives moyennes, pour passer d'un loyer hors charges à charges comprises
const EPOQUES = {a: "Avant 1946", b: "1946 à 1970", c: "1971 à 1990", d: "Après 1990"};
function loadLoyers() {
  if (!LOY.p) LOY.p = fetch("data/loyers.json", {cache: "no-cache"}).then(r => r.ok ? r.json() : null).catch(() => null)
    .then(d => { if (d && d.paris) d.paris.q.forEach(q => { q.bb = q.p.flat().reduce((b, [y, x]) => [Math.min(b[0], y), Math.min(b[1], x), Math.max(b[2], y), Math.max(b[3], x)], [90, 180, -90, -180]); }); LOY.data = d; if (d && isRent()) rerenderAll(); return d; });
  return LOY.p;
}
function inRing(lat, lng, r) {
  let ins = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [yi, xi] = r[i], [yj, xj] = r[j]; if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) ins = !ins; }
  return ins;
}
function parisQuartier(lat, lng) {
  const d = LOY.data && LOY.data.paris; if (!d) return null;
  return d.q.find(q => q.bb && lat >= q.bb[0] && lat <= q.bb[2] && lng >= q.bb[1] && lng <= q.bb[3] && q.p.some(r => inRing(lat, lng, r))) || null;
}
const normName = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/arrondissement/g, "").replace(/[^a-z0-9]+/g, " ").trim();
function inseeOf(o) {
  const pc = String(o.postcode || "");
  if (/^750\d\d$/.test(pc)) return "751" + pc.slice(3);
  const d = LOY.data && LOY.data.communes; if (!d) return null;
  if (!LOY.names) { LOY.names = {}; for (const [code, c] of Object.entries(d.c)) LOY.names[normName(c.n)] = code; }
  for (const n of [o.city, o.comName]) { const k = normName(n); if (k && LOY.names[k]) return LOY.names[k]; }
  return null;
}
function refOf(q, rooms, meuble, ep) {
  const m = meuble ? "m" : "v";
  if (ep) { const v = q.r[`${rooms}${ep}${m}`]; return v ? {ref: v[0], max: v[1], min: v[2], maxLo: v[1], maxHi: v[1]} : null; }
  const W = {a: .55, b: .15, c: .15, d: .15}; let w = 0, ref = 0, mx = 0, mn = 0, lo = Infinity, hi = 0;
  for (const e of "abcd") { const v = q.r[`${rooms}${e}${m}`]; if (!v) continue; w += W[e]; ref += v[0] * W[e]; mx += v[1] * W[e]; mn += (v[2] || 0) * W[e]; lo = Math.min(lo, v[1]); hi = Math.max(hi, v[1]); }
  return w ? {ref: ref / w, max: mx / w, min: mn / w, maxLo: lo, maxHi: hi} : null;
}
/* Loyer de référence d'un lieu : quartier parisien (encadrement), sinon loyers d'annonce de la commune */
function rentAt(o, rooms, meuble, ep) {
  const d = LOY.data; if (!d) { loadLoyers(); return null; }
  const h = homeRaw();
  rooms = Math.max(1, Math.min(4, rooms || h.roomsMin || 2));
  const mb = meuble != null ? !!meuble : (h.loc || {}).meuble === "meuble";
  if (o.lat && d.paris) {
    const q = parisQuartier(o.lat, o.lng);
    if (q) { const r = refOf(q, rooms, mb, ep); if (r) return Object.assign({zone: "paris", name: q.n, cc: r.ref + CHARGES_M2, ep: ep || null, mb, rooms, annee: d.paris.annee}, r); }
  }
  const code = inseeOf(o), c = code && d.communes && d.communes.c[code];
  if (c) { const v = (rooms <= 2 ? c.app12 : c.app3) || c.app; if (v && v[0]) return {zone: "commune", code, name: c.n.replace(/ Arrondissement$/, ""), cc: v[0], lo: v[1], hi: v[2], encadre: ENCADRE.has(code) || code.startsWith("751"), annee: d.communes.annee}; }
  return null;
}
function zoneCenter(pts) { const n = pts.length; return {lat: pts.reduce((a, p) => a + p[0], 0) / n, lng: pts.reduce((a, p) => a + p[1], 0) / n}; }
const zoneRent = z => z && Array.isArray(z.points) && z.points.length >= 3 ? rentAt(Object.assign(zoneCenter(z.points), {comName: z.est && z.est.prix && z.est.prix.com && z.est.prix.com.name})) : null;
const rentFor = f => f.lat || f.postcode || f.city ? rentAt({lat: f.lat, lng: f.lng, postcode: f.postcode, city: f.city}, f.rooms, f.furnished, f.epoque) : null;

/* Note d'un critère : celle de la personne si elle l'a donnée, sinon l'estimation */
const userVal = (z, id) => z.ratings && typeof z.ratings[id] === "number" ? z.ratings[id] : undefined;
function critValFor(z, id, ratings, budget) {
  const u = ratings && typeof ratings[id] === "number" ? ratings[id] : undefined;
  if (u !== undefined) return {v: u, est: false};
  const e = estScore(z, id, budget);
  return e === undefined ? {v: undefined, est: false} : {v: e, est: true};
}
const critVal = (z, id) => critValFor(z, id, z.ratings, zoneBudget());
function scoreWith(z, ratings, criteria, budget) {
  let wsum = 0, acc = 0, rated = 0, total = 0, estimated = 0;
  for (const c of criteria) {
    if (!(c.weight > 0)) continue;
    total++;
    const {v, est} = critValFor(z, c.id, ratings, budget);
    if (typeof v === "number") { wsum += c.weight; acc += c.weight * v / 5; rated++; if (est) estimated++; }
  }
  return {score: wsum ? Math.round(acc / wsum * 100) : null, rated, total, estimated, complete: total > 0 && rated === total};
}
const scoreOf = z => scoreWith(z, z.ratings, crit(), zoneBudget());

/* Carte à deux : chacun note avec son profil, la carte montre la note commune */
const curMap = () => cloud.user ? cloud.maps.find(m => m.id === cloud.mapId) : null;
const isShared = () => { const m = curMap(); return !!(m && m.kind === "partagee"); };
/* toutes les cartes du compte : les annonces suivent la personne d'un appareil à l'autre, quelle que soit la carte affichée */
const myMapIds = () => [...new Set([cloud.mapId, cloud.personalMapId, ...(cloud.maps || []).map(m => m.id)].filter(Boolean))];
const hasRated = r => !!r && (Object.keys(r.ratings || {}).length > 0 || !!r.fav || !!r.comment);
const personName = id => (cloud.people[id] && cloud.people[id].name) || cloud.names[id] || "Votre binôme";
function partnerScores(z) {
  return (z.others || []).filter(hasRated).map(o => {
    const p = cloud.people[o.userId] || {};
    const cs = Array.isArray(p.criteria) && p.criteria.length ? modeCrit(p.criteria) : crit();
    return {userId: o.userId, name: personName(o.userId), fav: o.fav, comment: o.comment, s: scoreWith(z, o.ratings, cs, p.budget)};
  });
}
function zoneScore(z) {
  const mine = scoreOf(z);
  if (!isShared()) return mine;
  const vals = [hasRated(z) ? mine.score : null, ...partnerScores(z).map(p => p.s.score)].filter(v => v != null);
  if (!vals.length) return mine;
  return Object.assign({}, mine, {score: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), joint: vals.length > 1});
}
const anyFav = z => !!z.fav || (isShared() && (z.others || []).some(o => o.fav));
const zonePrice = z => { if (isRent()) { const r = zoneRent(z); return r ? Math.round(r.cc * 10) / 10 : null; } return z.price > 0 ? z.price : (z.est && z.est.prix ? z.est.prix.med : null); };
const overBudget = z => zoneBudget() > 0 && zonePrice(z) > zoneBudget();
