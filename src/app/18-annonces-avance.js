/* =========================================================
   Annonces, niveau 2 : import en lot, alertes e-mail, analyse, profil automatique
   ========================================================= */


/* ---------- Placement sur la carte : géocodage en file (1 requête par seconde) et mémorisé ---------- */
const GEO_KEY = "heden.geo";
let geoCache = (() => { try { return JSON.parse(localStorage.getItem(GEO_KEY) || "{}"); } catch (e) { return {}; } })();
let geoLast = 0;
async function nominatim(q) {
  if (Object.prototype.hasOwnProperty.call(geoCache, q)) return geoCache[q];
  const waitMs = geoLast + 1100 - Date.now(); if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
  geoLast = Date.now();
  const vb = `${BOUNDS[0][1]},${BOUNDS[1][0]},${BOUNDS[1][1]},${BOUNDS[0][0]}`;
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&viewbox=${vb}&bounded=1&limit=1&countrycodes=fr&accept-language=fr`);
    if (!r.ok) return null;
    const j = await r.json(), res = j[0] ? {lat: +j[0].lat, lng: +j[0].lon} : null;
    return keepGeo(q, res);
  } catch (e) { return null; }
}
function keepGeo(k, res) {
  geoCache[k] = res;
  const keys = Object.keys(geoCache); if (keys.length > 400) delete geoCache[keys[0]];
  try { localStorage.setItem(GEO_KEY, JSON.stringify(geoCache)); } catch (e) {}
  return res;
}
/* Base Adresse Nationale (Géoplateforme de l'IGN) : adresses et rues françaises, 50 requêtes par seconde */
async function banGeo(q, postcode) {
  const k = `ban|${q}|${postcode || ""}`;
  if (Object.prototype.hasOwnProperty.call(geoCache, k)) return geoCache[k];
  try {
    const r = await fetch(`https://data.geopf.fr/geocodage/search/?q=${encodeURIComponent(q)}${postcode ? "&postcode=" + postcode : ""}&limit=1`);
    if (!r.ok) return null;
    const x = ((await r.json()).features || [])[0], p = x && x.properties;
    // une rue ou une adresse, pas une commune entière ; et dans le code postal annoncé
    const ok = p && p.score >= 0.55 && (p.type === "housenumber" || p.type === "street") && (!postcode || p.postcode === postcode);
    return keepGeo(k, ok ? {lat: x.geometry.coordinates[1], lng: x.geometry.coordinates[0], type: p.type, label: p.label} : null);
  } catch (e) { return null; }
}
async function geocodeListing(f) {
  if (f.lat && f.lng) return;
  const city = f.city || (f.postcode && f.postcode.startsWith("75") ? "Paris" : "");
  if (f.street && (f.postcode || city)) {
    const g = await banGeo(`${f.street} ${f.postcode ? "" : city}`.trim(), f.postcode);
    if (g) { Object.assign(f, {lat: g.lat, lng: g.lng, precise: g.type === "housenumber", placedBy: g.label, placeLevel: g.type === "housenumber" ? "adresse" : "rue"}); return; }
  }
  const tries = [[f.metro && `${f.metro}, ${city || "Paris"}`, "metro"], [f.quartier && `${f.quartier}, ${city}`, "quartier"], [f.postcode && `${f.postcode} ${city}`, "cp"], [city, "ville"]].filter(x => x[0]);
  for (const [q, lvl] of tries) {
    const g = await nominatim(q);
    if (g) { f.lat = g.lat; f.lng = g.lng; f.precise = false; f.placedBy = q; f.placeLevel = lvl; return; }
  }
}
async function placeListing(f) {
  await geocodeListing(f);
  await ademeCheck(f);
  if (f.lat && !f.est) { const r = f.precise || /^(?:rue|metro|quartier)$/.test(f.placeLevel) ? 120 : 450; try { f.est = await estimate(circlePoints(f.lat, f.lng, r, 10)); } catch (e) {} }
  f.title = listingTitle(f);
}
const placeQ = {list: [], busy: false, tried: new Set()};
function queuePlace(fs) {
  placeQ.list.push(...fs.filter(f => (!f.lat || !f.est) && !placeQ.tried.has(f.id)).map(f => f.id));
  if (placeQ.busy) return;
  placeQ.busy = true;
  (async () => {
    let n = 0;
    while (placeQ.list.length) {
      // par identifiant : la synchro remplace les objets annonce pendant que la file tourne
      const id = placeQ.list.shift(), f = listings().find(x => x.id === id);
      if (!f || placeQ.tried.has(id)) continue;
      placeQ.tried.add(id);
      await placeListing(f); f.updatedAt = Date.now(); n++;
      if (n % 4 === 0 || !placeQ.list.length) { save(); renderListings(); renderListingPins(); }
    }
    placeQ.busy = false;
  })();
}

/* ---------- Une annonce trouvée (page de résultats, alerte) : nouvelle, déjà connue, ou baisse de prix ---------- */
/* même annonce : même lien (sans paramètres, sauf liens de suivi des e-mails), ou mêmes caractéristiques */
function sameListing(a, b) {
  if (a.url && b.url && normUrl(a.url) === normUrl(b.url)) return true;
  if (kindOf(a) !== kindOf(b)) return false;
  if (!a.price || !b.price || !a.surface || !b.surface) return false;
  if (Math.abs(a.surface - b.surface) > 1.5) return false;
  if (a.rooms && b.rooms && a.rooms !== b.rooms) return false;
  const placeA = a.postcode || a.city, placeB = b.postcode || b.city;
  if (!placeA || placeA !== placeB) return false;
  return Math.abs(a.price - b.price) / Math.max(a.price, b.price) < 0.2;
}
function mergeCard(card, opts = {}) {
  const f = parseListing({url: card.url, text: card.text, imgs: cardImgs(card)});
  if (card.data) Object.assign(f, card.data);                     // vivier : ce que le traitement ou un membre a déjà lu (position, DPE, fiche complète)
  if (card.price > 0) f.price = card.price;                       // vivier : le dernier prix vu, pas celui du premier e-mail
  if (!f.price || !(f.surface || f.rooms)) return {kind: "skip"};
  if (opts.onlyProject && projet() !== "deux" && kindOf(f) !== projet()) return {kind: "skip"};
  const ex = listings().find(x => sameListing(x, f));
  const now = opts.at || Date.now();
  if (ex) {
    if (opts.source && !(ex.sources || []).includes(opts.source)) ex.sources = (ex.sources || [ex.source].filter(Boolean)).concat(opts.source);
    ex.lastSeen = now;
    if ((f.photos || []).length > (ex.photos || []).length) { ex.photos = [...new Set([...(ex.photos || []), ...f.photos])].slice(0, 40); ex.updatedAt = Date.now(); }
    if (f.price !== ex.price) {
      ex.priceHistory = (ex.priceHistory || []).concat({price: ex.price, at: ex.priceAt || ex.addedAt || now});
      const down = f.price < ex.price; ex.price = f.price; ex.priceAt = now; ex.updatedAt = Date.now();
      if (down) { ex.dropped = true; if (ex.status === "ecartee" && opts.revive) ex.status = "nouvelle"; }
      return {kind: down ? "drop" : "change", f: ex};
    }
    return {kind: "seen", f: ex};
  }
  if (opts.dryRun) return {kind: "new", f};
  Object.assign(f, {id: zoneId(), status: "nouvelle", addedAt: Date.now(), firstSeen: now, lastSeen: now, origin: opts.origin || "page",
    source: opts.source || f.source, mapId: cloud.user ? cloud.mapId : null, createdBy: cloud.user ? cloud.user.id : null});
  if (!(f.photos || []).length) f.photos = cardImgs(card);
  f.title = listingTitle(f);
  listings().unshift(f);
  return {kind: "new", f};
}

/* ---------- Annonce déjà connue, rouverte avec le bouton + Heden : on la met à jour ----------
   Prix (avec historique), disponibilité, agence, infos manquantes. Les corrections, notes,
   statut et coordonnées précises restent ceux de l'utilisateur. */
function refreshFromPage(ex, p) {
  const news = applyPage(ex, p);
  lui.openId = ex.id; if (currentTab !== "annonces") setTab("annonces"); else renderListings();
  toast(news.length ? "Mise à jour : " + news.join(", ") : "Rien n’a changé sur le site");
}
function applyPage(ex, p) {
  const now = Date.now(), news = [];
  ex.lastSeen = now; ex.checkedAt = now; ex.fullPage = true;
  if (p.gone) { if (!ex.gone) news.push("plus en ligne sur le site"); ex.gone = ex.gone || now; }
  else {
    if (ex.gone) news.push("de nouveau en ligne");
    delete ex.gone;
    if (p.price && ex.price && p.price !== ex.price) {
      ex.priceHistory = (ex.priceHistory || []).concat({price: ex.price, at: ex.priceAt || ex.addedAt || now});
      news.push(p.price < ex.price ? `prix baissé de ${fmtInt(ex.price - p.price)} €` : `prix monté de ${fmtInt(p.price - ex.price)} €`);
      if (p.price < ex.price) ex.dropped = true;
      ex.price = p.price; ex.priceAt = now;
    }
    const keep = new Set(["id", "status", "lat", "lng", "precise", "mapId", "createdBy", "note", "fix", "addedAt", "firstSeen", "origin", "title", "price", "photos", "found", "url", "source", "sources", "est"]);
    let filled = 0;
    for (const k of Object.keys(p.found || {})) if (!keep.has(k) && (ex[k] == null || ex[k] === "") && p[k] != null) { ex[k] = p[k]; filled++; }
    for (const k of ["agencyName", "agencyPhone", "agencyEmail", "agencyUrl", "agencyAddress", "ref", "seller"]) if (p[k] && p[k] !== ex[k]) { if (!ex[k]) filled++; ex[k] = p[k]; }
    if ((p.photos || []).length > (ex.photos || []).length) { if ((ex.photos || []).length) news.push(`${p.photos.length} photos`); ex.photos = p.photos; }
    if (filled) news.push(`${filled} info${filled > 1 ? "s" : ""} ajoutée${filled > 1 ? "s" : ""}`);
    if (p.url && !ex.url) ex.url = p.url;
  }
  ex.updatedAt = now; save(); renderListingPins();
  return news;
}

/* ---------- Import d'une page de résultats ---------- */
/* Une annonce hors du projet choisi (une location pour un achat, ou l'inverse) : on propose d'ajouter l'autre projet */
async function kindAllowed(k) {
  if (projet() === "deux") { if (curMode() !== k) setMode(k); return true; }
  if (k === projet()) return true;
  const loc = k === "location";
  const ok = await askConfirm({title: loc ? "C’est une annonce de location" : "C’est une annonce de vente", text: `Votre projet dans Heden est ${projet() === "achat" ? "l’achat" : "la location"}. Ajouter aussi ${loc ? "la location" : "l’achat"} ? Vous passerez de l’un à l’autre en un geste, en haut des annonces.`, ok: loc ? "Ajouter la location" : "Ajouter l’achat", cancel: "Ne pas l’importer"});
  if (!ok) return false;
  const h = homeProfile(); h.projet = "deux"; if (h.setup) h.setup.projet = "deux";
  save(); setMode(k); toast(loc ? "Location ajoutée à votre projet" : "Achat ajouté à votre projet");
  return true;
}
async function openBatchImport(items, pageUrl, oldBtn, title) {
  const src = siteName(hostOf(pageUrl));
  let rows = items.map(c => { const f = parseListing({url: c.url, text: c.text, imgs: cardImgs(c)}); if (c.data) Object.assign(f, c.data); if (c.price > 0) f.price = c.price; if (!(f.photos || []).length) f.photos = cardImgs(c); return {c, f}; })
    .filter(r => r.f.price && (r.f.surface || r.f.rooms));
  const nLoc = rows.filter(r => kindOf(r.f) === "location").length, major = nLoc * 2 >= rows.length ? "location" : "achat";
  if (rows.length && !(await kindAllowed(major))) return;
  rows = rows.filter(r => kindOf(r.f) === major);
  const h = homeProfile();
  rows.forEach(r => { r.ex = listings().find(x => sameListing(x, r.f)); r.fails = listingFilters(r.f, h); r.on = !r.ex && !r.fails.length; });
  let el = $("#lsheet");
  if (!el) { el = document.createElement("div"); el.id = "lsheet"; el.className = "auth"; el.innerHTML = `<div class="auth__veil" data-lclose></div><div class="auth__card lsheet" role="dialog" aria-modal="true" aria-labelledby="lsTitle"></div>`; document.body.appendChild(el); }
  const card = el.querySelector(".lsheet");
  const closeSheet = () => { el.classList.remove("is-open"); setTimeout(() => { el.hidden = true; }, 200); };
  el.onclick = e => { if (e.target.closest("[data-lclose]")) closeSheet(); };
  const paint = () => {
    const nOn = rows.filter(r => r.on).length, nNew = rows.filter(r => !r.ex).length;
    card.innerHTML = `<div class="auth__head"><h2 id="lsTitle">${title ? esc(title(rows.length)) : `${rows.length} annonce${rows.length > 1 ? "s" : ""} sur ${esc(src || "cette page")}`}</h2><button class="x" type="button" data-lclose aria-label="Fermer"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <p class="auth__txt">${rows.length ? `${nNew} nouvelle${nNew > 1 ? "s" : ""} pour Heden. Celles hors critères sont décochées.` : "Heden n’a pas trouvé d’annonce lisible sur cette page. Ouvrez une annonce et réessayez, ou collez son texte."}</p>${oldBtn && rows.length ? `<p class="hint2">Votre bouton + Heden est une ancienne version : réinstallez-le depuis Annonces, « Le bouton + Heden », pour récupérer toutes les photos de chaque annonce.</p>` : ""}
      <div class="blist">${rows.map((r, i) => `<label class="brow${r.ex ? " brow--ex" : ""}">
          <input type="checkbox" data-i="${i}" ${r.on ? "checked" : ""} ${r.ex ? "disabled" : ""}>
          <span class="brow__ph">${r.f.photos && r.f.photos[0] ? `<img src="${esc(r.f.photos[0])}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</span>
          <span class="brow__b"><b>${esc(listingTitle(r.f))}</b><span class="num">${priceTxt(r.f)}${r.f.surface ? ` · ${ppmTxt(r.f)}` : ""}</span>
            ${r.ex ? `<em>${r.ex.price !== r.f.price ? "Déjà dans Heden, prix mis à jour" : "Déjà dans Heden"}</em>` : r.fails.length ? `<em class="off">Hors critères : ${esc(r.fails[0])}</em>` : ""}</span>
        </label>`).join("")}</div>
      <div class="auth__foot"><button class="btn btn--primary btn--block" type="button" id="bgo" ${nOn || rows.some(r => r.ex && r.ex.price !== r.f.price) ? "" : "disabled"}>${nOn ? `Importer ${nOn} annonce${nOn > 1 ? "s" : ""}` : "Rien à importer"}</button></div>`;
    $$(".brow input", card).forEach(i => i.onchange = () => { rows[+i.dataset.i].on = i.checked; paint(); });
    $("#bgo").onclick = () => {
      let n = 0, up = 0; const fresh = [];
      rows.forEach(r => {
        if (r.ex) { const m = mergeCard(r.c, {source: r.c.source || src}); if (m.kind === "drop" || m.kind === "change") up++; return; }
        if (!r.on) return;
        const m = mergeCard(r.c, {origin: r.c.origin || "page", source: r.c.source || src}); if (m.kind === "new") { n++; fresh.push(m.f); }
      });
      save(); closeSheet(); lui.openId = null; lui.filter = "atrier"; lui.sort = "reco";
      if (currentTab !== "annonces") setTab("annonces"); else renderListings();
      renderListingPins(); queuePlace(fresh);
      toast(n ? `${n} annonce${n > 1 ? "s" : ""} importée${n > 1 ? "s" : ""}, placement sur la carte en cours` : up ? `${up} prix mis à jour` : "Rien de nouveau");
    };
  };
  paint();
  el.hidden = false; requestAnimationFrame(() => el.classList.add("is-open"));
}

/* ---------- Alertes e-mail : boîte de réception Heden ---------- */
async function processInbox() {
  if (!cloud.user || !cloud.client || cloud.inboxBusy || cloud.noInbox) return;
  const h = homeProfile(), target = (h.alerts && h.alerts.mapId) || cloud.personalMapId;
  if (target && cloud.mapId !== target) return;            // les alertes vont sur la carte choisie : on attend d'y être
  cloud.inboxBusy = true;
  try {
    const {data, error} = await cloud.client.from("inbox").select("id, sender, subject, html, received_at").order("received_at").limit(20);
    if (error) { if (schemaMissing(error)) cloud.noInbox = true; return; }
    if (!data || !data.length) return;
    let added = 0, drops = 0, gone = 0; const fresh = [];
    for (const m of data) {
      let cards = [];
      try { cards = extractCards(new DOMParser().parseFromString(m.html || "", "text/html").body); } catch (e) {}
      const src = siteName((String(m.sender).match(/@([\w.-]+)/) || [])[1]), at = Date.parse(m.received_at) || Date.now();
      let head = "";
      try { head = (new DOMParser().parseFromString(m.html || "", "text/html").body.textContent || "").replace(/\s+/g, " ").slice(0, 400); } catch (e) {}
      if (GONE_RE.test((m.subject || "") + " " + head)) {
        // e-mail de retrait (annonce suivie vendue ou retirée) : on marque, on n'ajoute rien
        for (const c of cards) { const f = parseListing({url: c.url, text: c.text}); const ex = listings().find(x => sameListing(x, f)); if (ex && !ex.gone) { ex.gone = at; ex.updatedAt = Date.now(); gone++; } }
        let doc = null; try { doc = new DOMParser().parseFromString(m.html || "", "text/html"); } catch (e) {}
        if (doc) for (const a of doc.querySelectorAll("a[href]")) { const ex = listings().find(x => x.url && normUrl(x.url) === normUrl(a.getAttribute("href"))); if (ex && !ex.gone) { ex.gone = at; ex.updatedAt = Date.now(); gone++; } }
      } else for (const c of cards) {
        const r = mergeCard(c, {origin: "alerte", source: src, at, revive: true, onlyProject: true});
        if (r.kind === "new") { added++; fresh.push(r.f); } else if (r.kind === "drop") drops++;
        if (r.f && r.f.gone && r.kind !== "new") { delete r.f.gone; r.f.updatedAt = Date.now(); }
      }
      await cloud.client.from("inbox").delete().eq("id", m.id);
    }
    if (added || drops || gone) {
      save(); renderListings(); renderListingPins(); queuePlace(fresh);
      toast([added && `${added} nouvelle${added > 1 ? "s" : ""} annonce${added > 1 ? "s" : ""} de vos alertes`, drops && `${drops} baisse${drops > 1 ? "s" : ""} de prix`, gone && `${gone} annonce${gone > 1 ? "s" : ""} retirée${gone > 1 ? "s" : ""} du site`].filter(Boolean).join(", "));
    }
    if (data.length === 20) setTimeout(processInbox, 500);
  } catch (e) { console.warn("Heden : alertes", e); }
  finally { cloud.inboxBusy = false; }
}
/* ---------- Le vivier : annonces reçues par l'adresse d'alertes de Heden, communes à tous les membres ----------
   Chaque appareil connecté lit quelques e-mails en attente et dépose les annonces ; chacun voit celles qui lui correspondent. */
async function processVivier() {
  if (!cloud.user || !cloud.client || cloud.vivierBusy || cloud.noVivier) return;
  cloud.vivierBusy = true; let done = 0;
  try {
    while (done < 40) {
      const {data, error} = await cloud.client.rpc("vivier_prendre", {n: 5});
      if (error) { if (schemaMissing(error) || /function|PGRST202/i.test((error.code || "") + error.message)) cloud.noVivier = true; break; }
      if (!data || !data.length) break;
      for (const m of data) {
        const {ann, ret} = vivierLire(m);
        await cloud.client.rpc("vivier_poser", {p_courrier: m.id, p_annonces: ann.map(x => x.a), p_retirees: ret});
        done++;
      }
    }
  } catch (e) { console.warn("Heden : vivier", e); }
  finally { cloud.vivierBusy = false; }
  if (done) { cloud.vivierAt = 0; if (currentTab === "annonces" && !lui.openId) loadVivier().then(() => renderListings()); }
}
/* Centre habité de chaque arrondissement (hors bois) : une annonce d'Explorer sans adresse y est placée, pour estimer son quartier */
const ARR_CENTRE = [[48.8625, 2.3364], [48.8683, 2.3428], [48.8630, 2.3600], [48.8543, 2.3576], [48.8445, 2.3497], [48.8491, 2.3327], [48.8562, 2.3122], [48.8727, 2.3125], [48.8770, 2.3375], [48.8761, 2.3608],
  [48.8590, 2.3800], [48.8405, 2.3920], [48.8283, 2.3622], [48.8292, 2.3266], [48.8401, 2.2928], [48.8580, 2.2760], [48.8873, 2.3067], [48.8925, 2.3484], [48.8871, 2.3848], [48.8634, 2.4011]];
const estParCp = {};   // une estimation par point (arrondissement, quartier, rue arrondie à 100 m) : les annonces voisines la partagent
async function estimerExplorer(fs) {
  if (estimerExplorer.busy) return; estimerExplorer.busy = true;
  try {
    let n = 0;
    for (const f of fs) {
      if (f.est || !f.lat || n > 40) continue;
      const cp = f.placeLevel === "cp", k = cp ? f.postcode : `${f.lat.toFixed(3)},${f.lng.toFixed(3)}`, r = cp ? 450 : f.placeLevel === "quartier" ? 350 : f.precise ? 120 : 180;
      if (!(k in estParCp)) { try { estParCp[k] = await estimate(circlePoints(f.lat, f.lng, r, 10)); } catch (e) { estParCp[k] = null; } n++; }
      f.est = estParCp[k] || undefined;
    }
    if (n && currentTab === "annonces" && lui.feed === "explorer" && !lui.openId) { const vw = $("#view-annonces"), y = vw ? vw.scrollTop : 0; renderListings(); if (vw) vw.scrollTop = y; }
  } finally { estimerExplorer.busy = false; }
}
/* Quartier nommé par le site → centre de la zone prédéfinie qui porte ce nom dans l'arrondissement (data/lieux.json) */
const motsQ = s => sansAccent(s || "").replace(/^quartier\s+(?:de la |du |des |de l'|d'|de )?/, "").split(/[^a-z]+/).filter(w => w.length >= 3 && !/^(rue|les|des|sur|saint|sainte|porte|place)$/.test(w));
function quartierPos(lx, arr, nom) {
  const q = motsQ(nom), zs = lx && lx.arr && lx.arr[String(arr)]; if (!q.length || !zs) return null;
  let best = null;
  for (const z of zs) {
    if (!Array.isArray(z.p) || z.p.length < 3) continue;
    const w = motsQ(z.n), hit = q.filter(x => w.includes(x)), sc = hit.length / q.length + (z.k === "quartier" ? 0 : .01);
    if (hit.some(x => x.length >= 4) && sc >= .5 && (!best || sc > best.sc)) best = {sc, z};
  }
  if (!best) return null;
  const c = polyCenter(best.z.p); return [c[0], c[1], best.z.n];
}
/* annonces du vivier vues depuis 30 jours, encore en ligne ; relues au plus toutes les 5 minutes */
async function loadVivier() {
  if (!cloud.user || !cloud.client || cloud.noVivier) return null;
  if (cloud.vivierRows && Date.now() - (cloud.vivierAt || 0) < 300000) return cloud.vivierRows;
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const {data, error} = await cloud.client.from("vivier").select("id, url, source, kind, postcode, price, surface, rooms, carte, data, prix_hist, first_seen, last_seen")
    .is("gone_at", null).gt("last_seen", since).order("first_seen", {ascending: false}).limit(400);
  if (error) { if (schemaMissing(error)) cloud.noVivier = true; return null; }
  cloud.vivierAt = Date.now();
  const lx = await loadLieux();   // quartier nommé par le site (« Montmartre », « Nation-Picpus ») → son centre, plutôt que celui de l'arrondissement
  cloud.vivierRows = (data || []).map(r => {
    const c = r.carte || {}, d = r.data || {}, item = {url: d.url || c.url || r.url, text: c.text || "", imgs: c.imgs || [], price: +r.price, source: r.source, origin: "vivier", data: d, first: Date.parse(r.first_seen) || 0, last: Date.parse(r.last_seen) || 0};
    const hist = (Array.isArray(r.prix_hist) ? r.prix_hist : []).map(x => ({price: +x.price, at: Date.parse(x.at) || 0})).filter(x => x.price > 0), lastH = hist[hist.length - 1];
    const f = Object.assign(parseListing({url: item.url, text: item.text, imgs: item.imgs}), d, {price: item.price, id: "v:" + r.id, status: "nouvelle", origin: "vivier", source: r.source, addedAt: item.first, firstSeen: item.first, lastSeen: item.last,
      priceHistory: hist, dropped: !!(lastH && lastH.price > item.price && Date.now() - lastH.at < 14 * 864e5)});
    if (!(f.photos || []).length) f.photos = item.imgs;
    const ar = !f.lat && /^750(\d\d)$/.exec(f.postcode || ""), qp = ar && quartierPos(lx, +ar[1], f.quartier), ctr = ar && ARR_CENTRE[+ar[1] - 1];
    if (qp) Object.assign(f, {lat: qp[0], lng: qp[1], precise: false, placeLevel: "quartier", placedBy: qp[2], est: estParCp[`${qp[0].toFixed(3)},${qp[1].toFixed(3)}`] || undefined});
    else if (ctr) Object.assign(f, {lat: ctr[0], lng: ctr[1], precise: false, placeLevel: "cp", est: estParCp[f.postcode] || undefined});
    else if (f.lat && !f.est) f.est = estParCp[`${(+f.lat).toFixed(3)},${(+f.lng).toFixed(3)}`] || undefined;
    f.title = listingTitle(f);
    return {id: r.id, item, f};
  });
  // une annonce déjà gardée dont le prix a changé dans le flux Heden : mise à jour (baisse signalée)
  let up = 0;
  for (const r of cloud.vivierRows) { const ex = listings().find(x => x.vivierId === r.id || sameListing(x, r.f)); if (ex && r.item.price && ex.price !== r.item.price && r.item.last >= (ex.priceAt || ex.firstSeen || 0)) { const m = mergeCard(r.item, {source: r.item.source}); if (m.kind === "drop" || m.kind === "change") up++; } }
  // retirée du site (vue par un membre ou annoncée par une alerte) : signalée sur l'annonce gardée
  const ids = listings().filter(x => x.vivierId && !x.gone).map(x => x.vivierId).slice(0, 200);
  if (ids.length) { const {data: g} = await cloud.client.from("vivier").select("id, gone_at").in("id", ids).not("gone_at", "is", null);
    (g || []).forEach(row => { const ex = listings().find(x => x.vivierId === row.id); if (ex && !ex.gone) { ex.gone = Date.parse(row.gone_at) || Date.now(); ex.updatedAt = Date.now(); up++; } }); }
  if (up) { save(); renderListingPins(); }
  return cloud.vivierRows;
}
/* ---------- Extension Heden : les pages lues pendant la navigation arrivent dans l'onglet Heden ----------
   Listes de résultats et fiches vont dans Explorer (vivier commun) ; une annonce déjà dans Mes annonces ou les Favoris
   est mise à jour (prix, photos, disponibilité). L'extension ne lit que les pages que l'utilisateur ouvre. */
const EXT_VERSION = "1.1.0", ext = {v: null};
const EXT_STORE = "https://chromewebstore.google.com/detail/acdbnkkljnflmgiljafgdffldmkabmog";   // fiche Chrome Web Store (non répertoriée) : installation et mises à jour sans dossier à charger
const attendre = async (ok, ms) => { for (let t = 0; !ok() && t < ms; t += 200) await new Promise(r => setTimeout(r, 200)); return ok(); };
async function recevoirPage(raw) {
  const {safe, items} = cleanPage(raw), d = Object.assign({}, safe, {items, liste: !!raw.liste});
  await attendre(() => cloud.authPret || !cloudReady, 8000);
  if (cloud.user) await attendre(() => !!cloud.lastRefresh, 10000);
  const r = vivierDepuisPage(d);
  let maj = 0;
  if (!r.liste && r.f) {
    const ex = listings().find(x => sameListing(x, r.f) || (x.url && normUrl(x.url) === normUrl(d.url)));
    if (ex) { applyPage(ex, r.f); maj = 1; }
  } else for (const x of r.ann) {
    if (!listings().some(y => sameListing(y, x.f))) continue;
    const m = mergeCard({url: x.a.carte.url, text: x.a.carte.text, imgs: x.a.carte.imgs, price: x.f.price}, {source: x.a.source});
    if (m.kind === "drop" || m.kind === "change") maj++;
  }
  if (maj) { save(); renderListingPins(); if ((currentTab === "annonces" || currentTab === "favoris")) renderListings(); }
  if (!cloud.user || !cloud.client) return {liste: r.liste, n: r.ann.length, maj, err: "connexion"};
  if (!r.ann.length && !r.gone.length) return {liste: r.liste, n: 0, maj};
  await Promise.all(r.ann.map(async x => {   // rue → position (en parallèle : une liste arrive d'un bloc)
    await banRue(x.f); if (!r.liste) await ademeCheck(x.f);
    x.a.data = Object.assign(vivierData(x.f), x.a.data.complet ? {complet: true, url: x.a.data.url} : {});
  }));
  // hors du projet (une location pour un achat) : dans Explorer, mais pas affichée tant que le projet ne la comprend pas
  const autre = projet() === "deux" ? 0 : r.ann.filter(x => x.a.kind !== projet()).length;
  const {data, error} = await cloud.client.rpc("vivier_deposer", {p_annonces: r.ann.map(x => x.a), p_retirees: r.gone});
  if (error) return {liste: r.liste, n: 0, maj, err: schemaMissing(error) ? "base" : "envoi"};
  cloud.vivierAt = 0;
  if (currentTab === "annonces" && lui.feed === "explorer" && !lui.openId) loadVivier().then(() => renderListings());
  return {liste: r.liste, n: r.ann.length, nouvelles: (data && data.nouvelles) || 0, revues: (data && data.revues) || 0, gone: r.gone.length, maj, autre, projet: projet()};
}
window.addEventListener("message", e => {
  if (e.source !== window || e.origin !== location.origin) return;
  const m = e.data; if (!m || typeof m !== "object") return;
  if (m.type === "heden-ext-ready") {
    ext.v = String(m.v || "1");
    return;
  }
  if (m.type === "heden-ext-page" && m.d && typeof m.d === "object")
    recevoirPage(m.d).catch(er => { console.warn("Heden : page de l'extension", er); return {n: 0, err: "envoi"}; })
      .then(res => window.postMessage(Object.assign({type: "heden-ext-ack", id: m.id}, res), location.origin));
});
const extInstalled = () => !!ext.v;   // l'extension s'annonce à chaque chargement de Heden : rien de retenu d'une fois sur l'autre
/* une annonce ouverte avec le bouton + Heden enrichit sa copie du vivier (toutes les photos, fiche complète) */
function vivierEnrichir(p) {
  if (!cloud.user || !cloud.client || cloud.noVivier || !p || !p.price || !cleanWeb(p.url)) return;
  cloud.client.rpc("vivier_enrichir", {p_url: normUrl(p.url), p_bien: {price: p.price, surface: p.surface || null, rooms: p.rooms || null, postcode: p.postcode || null, kind: kindOf(p) === "location" ? "location" : "achat"},
    p_data: vivierData(p), p_imgs: (p.photos || []).slice(0, 40)}).then(({data}) => { if (data) cloud.vivierAt = 0; }, () => {});
}
async function loadAlertState() {
  if (!cloud.user || !cloud.client) return null;
  const {data, error} = await cloud.client.from("ingest_tokens").select("token, last_at, received").eq("user_id", cloud.user.id).maybeSingle();
  if (error) { if (schemaMissing(error)) cloud.noInbox = true; return null; }
  return (cloud.alert = data || {token: null});
}
function gmailScript(token) {
  return `// Heden : envoie à Heden les alertes immobilières reçues dans Gmail.
// 1. Collez tout ce texte dans un nouveau projet sur script.google.com, puis Enregistrer.
// 2. En haut, choisissez la fonction « installer », cliquez sur Exécuter et autorisez l'accès.
// Ensuite, toutes les 15 minutes, les nouvelles alertes partent vers Heden. Rien d'autre n'est lu.
const HEDEN_JETON = "${token}";
const HEDEN_URL = "${CFG.supabaseUrl}/rest/v1/rpc/ingest_email";
const HEDEN_CLE = "${CFG.supabaseAnonKey}";
const EXPEDITEURS = "seloger.com OR pap.fr OR leboncoin.fr OR bienici.com OR logic-immo.com OR lefigaro.fr OR orpi.com OR century21.fr OR laforet.com OR guy-hoquet.com OR stephaneplazaimmobilier.com OR avendrealouer.fr OR jinka.fr";

function installer() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("envoyerAHeden").timeBased().everyMinutes(15).create();
  envoyerAHeden();
}

function envoyerAHeden() {
  const props = PropertiesService.getUserProperties();
  const vus = JSON.parse(props.getProperty("heden_vus") || "[]");
  GmailApp.search("from:(" + EXPEDITEURS + ") newer_than:3d", 0, 40).forEach(fil => fil.getMessages().forEach(m => {
    if (vus.indexOf(m.getId()) >= 0) return;
    const r = UrlFetchApp.fetch(HEDEN_URL, {method: "post", contentType: "application/json", muteHttpExceptions: true,
      headers: {apikey: HEDEN_CLE},
      payload: JSON.stringify({p_token: HEDEN_JETON, p_from: m.getFrom(), p_subject: m.getSubject(), p_html: m.getBody()})});
    if (r.getResponseCode() === 200 && r.getContentText() === "true") vus.push(m.getId());
  }));
  props.setProperty("heden_vus", JSON.stringify(vus.slice(-400)));
}
`;
}
const ago = t => { const m = Math.round((Date.now() - new Date(t).getTime()) / 60000); return m < 2 ? "à l’instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`; };

/* ---------- Analyse : juste prix (ventes comparables), négociation, coût par mois, trajets ---------- */
async function comparables(f) {
  const meta = await loadMeta();
  if (!meta || !f.lat || !f.lng) return null;
  const g = meta.grid, c = {lat: f.lat, lng: f.lng}, R = f.precise || /^(?:rue|metro|quartier)$/.test(f.placeLevel) ? 450 : 800;
  if (c.lat < g.s || c.lat > g.n || c.lng < g.w || c.lng > g.e) return null;
  const have = new Set(meta.tiles), keys = [];
  const i0 = Math.floor((c.lat - R / KYm - g.s) / g.dlat), i1 = Math.floor((c.lat + R / KYm - g.s) / g.dlat);
  const j0 = Math.floor((c.lng - R / KXm - g.w) / g.dlng), j1 = Math.floor((c.lng + R / KXm - g.w) / g.dlng);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (have.has(i + "_" + j)) keys.push(i + "_" + j);
  const tiles = await Promise.all(keys.map(loadTile)), last = meta.dvf.last;
  let pool = [];
  tiles.forEach(t => t.sales.forEach(x => { if (x.t === 0 && x.m > last - 36 && !(x.f & 1)) { const d = distM(c, x); if (d <= R) pool.push(Object.assign({d, pa: x.p * adjFactor(meta, x)}, x)); } }));
  if (f.surface) { const like = pool.filter(x => x.s >= f.surface * 0.65 && x.s <= f.surface * 1.5); if (like.length >= 8) pool = like; }
  if (pool.length >= 8) { const m0 = quant(pool.map(x => x.pa).sort((a, b) => a - b), .5); pool = pool.filter(x => x.pa >= m0 * 0.55 && x.pa <= m0 * 1.7); }
  if (pool.length < 5) return null;
  pool.sort((a, b) => a.d - b.d);
  const sel = pool.slice(0, 20), ps = sel.map(x => x.pa).sort((a, b) => a - b), r10 = v => Math.round(v / 10) * 10;
  return {n: sel.length, R: Math.round(sel[sel.length - 1].d), med: r10(quant(ps, .5)), q1: r10(quant(ps, .25)), q3: r10(quant(ps, .75)), lo: ps[0], hi: ps[ps.length - 1], all: sel, near: sel.slice(0, 5), adj: !!meta.index};
}
function negotiation(f, cmp) {
  if (!f.price || f.viager) return null;
  const ppm = f.surface ? f.price / f.surface : null, ref = cmp ? cmp.med : (f.est && f.est.prix ? f.est.prix.med : null);
  const ecart = ppm && ref ? ppm / ref - 1 : null, why = [];
  let m = 0.02;
  if (ecart != null) {
    if (ecart > 0.03) { m += Math.min(0.08, ecart * 0.6); why.push(`${Math.round(ecart * 100)} % au-dessus des ventes comparables`); }
    else if (ecart < -0.05) why.push(`Déjà ${Math.round(-ecart * 100)} % sous les ventes comparables : peu de marge`);
    else why.push("Au prix des ventes comparables");
  }
  if (f.dpe === "G") { m += 0.03; why.push("DPE G : interdit à la location depuis 2025, travaux énergétiques à chiffrer"); }
  else if (f.dpe === "F") { m += 0.025; why.push("DPE F : interdit à la location en 2028, travaux énergétiques à chiffrer"); }
  if (f.works === "travaux") { m += 0.03; why.push("Travaux à prévoir"); } else if (f.works === "rafraichir") { m += 0.01; why.push("À rafraîchir"); }
  if (f.floor === 0) { m += 0.02; why.push("Rez-de-chaussée, moins recherché"); }
  if (f.floor >= 4 && f.elevator === false) { m += 0.02; why.push("Étage élevé sans ascenseur"); }
  const since = f.firstSeen || f.addedAt, days = since ? Math.floor((Date.now() - since) / 864e5) : 0;
  if (days >= 45) { m += 0.02; why.push(`Sur le marché depuis au moins ${days} jours`); }
  const hist = f.priceHistory || [];
  if (hist.length && hist[0].price > f.price) { m += 0.01; why.push(`Prix déjà baissé de ${Math.round((1 - f.price / hist[0].price) * 100)} % : vendeur ouvert à la discussion`); }
  m = Math.min(0.12, Math.max(0.02, m));
  return {m, offer: Math.round(f.price * (1 - m) / 5000) * 5000, why, ecart, fair: ref && f.surface ? Math.round(ref * f.surface / 5000) * 5000 : null};
}
const DPE_KWH = {A: 50, B: 90, C: 145, D: 215, E: 290, F: 375, G: 450};
function finance() { return Object.assign({apport: null, taux: 3.4, duree: 25}, homeProfile().fin || {}); }
function monthlyCost(f) {
  if (!f.price) return null;
  const fin = finance(), notaire = Math.round(f.price * 0.075);
  const apport = fin.apport != null ? fin.apport : Math.round((f.price + notaire) * 0.1);
  const pret = Math.max(0, f.price + notaire - apport), r = fin.taux / 100 / 12, n = fin.duree * 12;
  const credit = pret ? (r ? pret * r / (1 - Math.pow(1 + r, -n)) : pret / n) : 0;
  const assur = pret * 0.003 / 12;
  const charges = f.charges ? f.charges / 12 : null;
  const taxeEst = !f.taxe, taxe = f.taxe ? f.taxe / 12 : f.surface ? f.surface * (String(f.postcode || "").startsWith("75") || f.city === "Paris" ? 17 : 28) / 12 : null;
  const energie = f.dpe && f.surface ? DPE_KWH[f.dpe] * f.surface * 0.21 / 12 : null;
  const parts = [["Crédit", credit, "#3A5A98"], ["Assurance", assur, "#7C93C3"], ["Charges", charges, "#C79B4A"], ["Taxe foncière", taxe, "#B9785E"], ["Énergie", energie, "#6E9F86"]].filter(p => p[1] > 0);
  return {notaire, apport, apportDefault: fin.apport == null, pret, credit, fin, charges, taxe, taxeEst, energie, parts, total: parts.reduce((a, p) => a + p[1], 0)};
}
const MODES = {tc: ["Transports", 25, 12, "transit"], velo: ["Vélo", 15, 3, "bicycling"], pied: ["À pied", 4.8, 0, "walking"], voiture: ["Voiture", 18, 8, "driving"]};
function travelMin(a, b, mode) {
  const d = distM(a, b) / 1000 * 1.3, t = (m) => { const [, v, fixed] = MODES[m]; return fixed + d / v * 60; };
  return Math.round(mode === "tc" ? Math.min(t("tc"), t("pied")) : t(mode in MODES ? mode : "tc"));
}
function commutes(f) {
  const pl = ((homeProfile().setup || {}).places || []).filter(p => p.lat);
  if (!f.lat || !pl.length) return [];
  return pl.map(p => ({p, min: travelMin({lat: f.lat, lng: f.lng}, p, p.mode || "tc")}));
}

/* ---------- Apprentissage : ce que vos choix (Garder / Écarter) disent de vos priorités ---------- */
const LEARN_TXT = {lumiere: "la luminosité", etage: "l’étage", exterieur: "l’extérieur", calme: "le calme", etat: "l’état du logement", energie: "le DPE", charges: "les charges", agencement: "l’agencement", annexes: "la cave et le parking", cachet: "le cachet", vue: "la vue", immeuble: "l’immeuble", trajets: "les trajets"};
let learnMemo = {key: null, val: null};
function learning() {
  const L = listings(), key = L.map(f => f.id + (f.status || "") + (f.updatedAt || "") + (f.feel ? f.feel.v : "")).join("|") + "|" + JSON.stringify(((homeProfile().setup || {}).places || []).map(p => [p.lat, p.mode]));
  if (learnMemo.key === key) return learnMemo.val;
  const feel = f => f.feel && f.feel.v;
  const K = L.filter(f => ((f.status === "gardee" || f.status === "visite") && feel(f) !== "haut") || feel(f) === "bas"), D = L.filter(f => (f.status === "ecartee" && feel(f) !== "bas") || feel(f) === "haut");
  const out = {n: K.length + D.length, k: K.length, d: D.length, f: {}, notes: []};
  if (K.length >= 2 && D.length >= 2) {
    const conf = Math.min(1, out.n / 12), VK = K.map(homeValues), VD = D.map(homeValues), avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    for (const id of Object.keys(HOME_LIB)) {
      const a = VK.filter(x => x.known[id]).map(x => x.v[id]), b = VD.filter(x => x.known[id]).map(x => x.v[id]);
      if (a.length < 2 || b.length < 2) continue;
      const fac = 1 + Math.max(-0.6, Math.min(1, (avg(a) - avg(b)) / 5 * 1.8)) * conf;
      if (Math.abs(fac - 1) >= 0.1) out.f[id] = fac;
    }
    out.notes = Object.entries(out.f).sort((x, y) => Math.abs(y[1] - 1) - Math.abs(x[1] - 1)).slice(0, 3)
      .map(([id, fac]) => ({id, up: fac > 1, txt: fac > 1 ? `Vous gardez surtout des annonces qui marquent des points sur ${LEARN_TXT[id]} : son poids augmente.` : `${LEARN_TXT[id][0].toUpperCase() + LEARN_TXT[id].slice(1)} pèse moins que prévu dans vos choix : son poids baisse.`}));
  }
  learnMemo = {key, val: out};
  return out;
}
function homeWeights() {
  const h = homeProfile(), w = Object.assign({}, h.weights);
  if (h.learn === false) return w;
  const L = learning(); Object.entries(L.f).forEach(([id, fac]) => { if (w[id] > 0) w[id] = w[id] * fac; });
  return w;
}

/* ---------- Questionnaire : Heden règle le profil tout seul ---------- */
const QUIZ_WHO = [["deux", "À deux", "Un premier achat en couple"], ["seul", "Seul·e", "Un achat pour soi"], ["famille", "En famille", "Avec des enfants, ou bientôt"], ["invest", "Pour louer", "Un investissement locatif"]];
const QUIZ_WHO_LOC = [["deux", "À deux", "Emménager en couple"], ["seul", "Seul·e", "Un logement pour soi"], ["famille", "En famille", "Avec des enfants, ou bientôt"], ["coloc", "En colocation", "Partager un logement à plusieurs"]];
const QUIZ_PROJ = [["achat", "Acheter", "Devenir propriétaire"], ["location", "Louer", "Trouver une location pour y habiter"], ["deux", "Les deux", "Comparer achat et location"]];
const PROJ_LABEL = {achat: "Achat", location: "Location", deux: "Achat ou location"};
const WHO_PRESET = {deux: "jeunes", seul: "jeunes", famille: "famille", invest: "invest", coloc: "jeunes"};
const PRIOS = [
  {id: "anime", name: "Quartier vivant", desc: "Cafés, restos, sorties", z: {vie_sociale: 15, culture: 5}},
  {id: "calme", name: "Calme", desc: "Rue tranquille, sur cour", z: {nuisances: 15}, h: {calme: 15}},
  {id: "vert", name: "Verdure", desc: "Un parc à deux pas", z: {verts: 15}},
  {id: "transports", name: "Transports", desc: "Métro tout près", z: {transports: 15}},
  {id: "pied", name: "Tout à pied", desc: "Marché, boulangerie, courses", z: {commerces: 15}},
  {id: "securite", name: "Sécurité", desc: "À l’aise le soir", z: {securite: 15}},
  {id: "ecoles", name: "Écoles", desc: "Crèche, école, collège", z: {ecoles: 15}},
  {id: "lumiere", name: "Lumière", desc: "Clair, traversant", h: {lumiere: 15, etage: 5}},
  {id: "exterieur", name: "Extérieur", desc: "Balcon, terrasse", h: {exterieur: 20}},
  {id: "pret", name: "Prêt à vivre", desc: "Sans travaux, bon DPE", h: {etat: 15, energie: 10}},
  {id: "cachet", name: "Cachet", desc: "Parquet, moulures", h: {cachet: 15}, z: {bati: 5}},
  {id: "espace", name: "De l’espace", desc: "Grandes pièces, rangements", h: {agencement: 15, annexes: 5}},
  {id: "affaire", name: "Bonne affaire", desc: "Sous le prix du quartier", z: {prix: 10, revente: 5}, mix: {prix: 15}}
];
const NOS = [["rdc", "Rez-de-chaussée"], ["ascenseur", "Étage élevé sans ascenseur"], ["passoire", "Passoire thermique (F, G)"], ["sansext", "Pas d’extérieur"], ["travaux", "Gros travaux"]];
const ROOM_SURF = {1: 25, 2: 40, 3: 58, 4: 75, 5: 95};
/* Arbitrages : deux biens possibles, lequel visiteriez-vous ? La réponse règle le poids du logement, du quartier et du prix */
const ARBS = [
  {k: "lq", q: "La surface ou le quartier ?", a: ["logement", "Plus grand", "Dans un quartier qui vous plaît moins"], b: ["quartier", "Mieux placé", "Plus petit, dans un quartier que vous aimez"]},
  {k: "px", q: "Le confort ou le prix ?", a: ["pret", "Prêt à vivre", "Au prix du marché"], b: ["affaire", "Moins cher", "Quitte à faire des travaux"], bLoc: ["affaire", "Moins cher", "Quitte à ce qu’il soit un peu daté"]},
  {k: "vie", q: "Le calme ou l’animation ?", a: ["calme", "Au calme", "Une rue tranquille, un peu à l’écart"], b: ["anime", "En plein cœur", "Cafés et métro au pied, plus de bruit"]}
];
const QORDER = ["projet", "who", "budget", "taille", "secteurs", "trajets", "prios", "arb", "refus"], QSTEPS = QORDER.length;
/* Carte des arrondissements du questionnaire (contours de data/lieux.json, sinon les quartiers administratifs réunis) */
let lieuxCache;   // undefined : pas encore chargé ; null : indisponible
function arrMapHTML(d, sel) {
  if (!arrMapHTML.m) {
    const k = Math.cos(48.8566 * Math.PI / 180), polys = d.c ? Object.entries(d.c).map(([n, p]) => [+n, [p]])
      : Object.entries(d.arr).map(([n, v]) => [+n, v.filter(x => x.k === "quartier").map(x => x.p)]);
    const pts = polys.flatMap(([, ps]) => ps.flat()), x0 = Math.min(...pts.map(q => q[1])), x1 = Math.max(...pts.map(q => q[1])), y0 = Math.min(...pts.map(q => q[0])), y1 = Math.max(...pts.map(q => q[0]));
    const W = 600, sc = W / ((x1 - x0) * k), H = Math.round((y1 - y0) * sc), P = q => `${((q[1] - x0) * k * sc).toFixed(1)},${((y1 - q[0]) * sc).toFixed(1)}`;
    arrMapHTML.m = {W, H, arrs: polys.sort((a, b) => a[0] - b[0]).map(([n, ps]) => { const [lx, ly] = P(ARR_CENTRE[n - 1]).split(","); return [n, ps.map(p => "M" + p.map(P).join("L") + "Z").join(""), lx, ly]; })};
  }
  const {W, H, arrs} = arrMapHTML.m;
  return `<svg class="qmap__svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="Arrondissements de Paris">${arrs.map(([n, dd, lx, ly]) => `<g class="qarr" data-arr="${n}" role="button" tabindex="0" aria-pressed="${sel.includes(n)}" aria-label="Paris ${arrNom(n)}"><path d="${dd}"/><text x="${lx}" y="${ly}" dy=".35em">${n}</text></g>`).join("")}</svg>`;
}
const secteursTxt = s => (s.arrs || []).length ? (s.arrs || []).slice().sort((a, b) => a - b).map(arrNom).concat(s.banlieue ? ["proche banlieue"] : []).join(", ") : "Tout Paris";
function normWeights(obj, keep) {
  let e = Object.entries(obj).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]); if (keep) e = e.slice(0, keep);
  const s = e.reduce((a, [, w]) => a + w, 0) || 1;
  const ex = e.map(([, w]) => w / s * 100);
  let r = e.map(([id], i) => [id, Math.max(5, Math.round(ex[i] / 5) * 5)]);
  // l'écart d'arrondi va aux poids les plus arrondis, jamais d'office au premier : la priorité n° 1 garde son rang
  for (let diff = 100 - r.reduce((a, [, w]) => a + w, 0), n = 0; diff && n < 60; diff = 100 - r.reduce((a, [, w]) => a + w, 0), n++) {
    const st = diff > 0 ? 5 : -5, ok = r.map((x, i) => i).filter(i => st > 0 || r[i][1] > 5); if (!ok.length) break;
    const i = ok.sort((x, y) => st > 0 ? (r[x][1] - ex[x]) - (r[y][1] - ex[y]) : (r[y][1] - ex[y]) - (r[x][1] - ex[x]))[0];
    r[i][1] += st;
  }
  return r;
}
function applySetup(s) {
  const p = state.profile, h = homeProfile();
  const pr = PRESETS.find(x => x.id === WHO_PRESET[s.who]) || PRESETS[0];
  const zw = Object.assign({}, pr.w), hw = {}, mix = {logement: 40, quartier: 40, prix: 20};
  Object.keys(HOME_LIB).forEach(k => hw[k] = (HOME_W[k] || 5) / 2);
  let nz = 0, nh = 0;
  (s.prios || []).forEach(id => {
    const q = PRIOS.find(x => x.id === id); if (!q) return;
    if (q.z) nz++; if (q.h) nh++;
    Object.entries(q.z || {}).forEach(([k, w]) => zw[k] = (zw[k] || 0) + w);
    Object.entries(q.h || {}).forEach(([k, w]) => hw[k] = (hw[k] || 0) + w);
    Object.entries(q.mix || {}).forEach(([k, w]) => mix[k] += w);
  });
  mix.quartier += (nz - nh) * 3; mix.logement += (nh - nz) * 3;
  if (s.who === "invest") mix.prix += 10;
  const arb = s.arb || {};
  if (arb.lq === "logement") mix.logement += 15; else if (arb.lq === "quartier") mix.quartier += 15;
  if (arb.px === "pret") { hw.etat = (hw.etat || 0) + 10; hw.energie = (hw.energie || 0) + 5; } else if (arb.px === "affaire") { mix.prix += 12; hw.etat = (hw.etat || 0) / 2; }
  if (arb.vie === "calme") { zw.nuisances = (zw.nuisances || 0) + 10; hw.calme = (hw.calme || 0) + 8; }
  else if (arb.vie === "anime") { zw.vie_sociale = (zw.vie_sociale || 0) + 10; zw.transports = (zw.transports || 0) + 5; zw.commerces = (zw.commerces || 0) + 5; }
  const places = (s.places || []).filter(x => x.lat);
  hw.trajets = places.length ? 18 : 0;
  p.criteria = normWeights(zw, 8).map(([id, w]) => ({id, name: LIB[id].name, desc: LIB[id].desc, weight: w}));
  p.presetId = pr.id; p.modified = false;
  h.weights = Object.fromEntries(Object.keys(HOME_LIB).map(k => [k, 0]));
  normWeights(hw).forEach(([k, w]) => h.weights[k] = w);
  const ms = mix.logement + mix.quartier + mix.prix;
  h.mix = {logement: Math.round(mix.logement / ms * 20) * 5, quartier: Math.round(mix.quartier / ms * 20) * 5, prix: Math.round(mix.prix / ms * 20) * 5};
  const dm = 100 - h.mix.logement - h.mix.quartier - h.mix.prix; if (dm) h.mix[Object.keys(h.mix).sort((a, b) => h.mix[b] - h.mix[a])[0]] += dm;   // les arrondis font toujours 100 %
  h.budgetMax = s.budget || null; h.roomsMin = s.rooms || null; h.surfaceMin = s.surface || null;
  const coloc = s.who === "coloc" && s.projet === "location", n = coloc ? Math.max(2, s.colocs || 2) : 1;
  h.bedroomsMin = coloc ? n : s.who === "famille" && s.rooms >= 3 ? s.rooms - 1 : null;
  const no = new Set(s.nos || []);
  h.noGround = no.has("rdc"); h.elevatorFrom = no.has("ascenseur") ? 3 : 0; h.dpeMax = no.has("passoire") ? "E" : "G"; h.outdoorReq = no.has("sansext"); h.noWorks = no.has("travaux");
  h.fin = Object.assign({}, h.fin || {}, {apport: s.apport ?? (h.fin && h.fin.apport) ?? null});
  h.projet = s.projet || "achat";
  h.arrs = (s.arrs || []).filter(n => n >= 1 && n <= 20).sort((a, b) => a - b); h.banlieue = !!(s.banlieue && h.arrs.length);
  h.loc = {loyerMax: s.loyer ? s.loyer * n : null, revenus: s.revenus ? s.revenus * n : null, meuble: s.meuble || "indiff", colocs: n};
  if (h.projet === "location" && s.who === "invest") s.who = "seul";
  if (s.budget) { const surf = s.surface || ROOM_SURF[Math.min(5, s.rooms || 3)]; p.budget = Math.round(s.budget / surf / 100) * 100; }
  h.setup = Object.assign({}, s, {at: Date.now()}); h.custom = false;
  save(); learnMemo.key = null;
}
/* Une seule réponse modifiée depuis le profil : les réglages faits à la main (poids, critères) restent, sauf si la question les règle */
function saveOnly(s, key) {
  const p = state.profile, h = homeProfile(), keep = !["prios", "arb"].includes(key) && (p.modified || h.custom);
  const snap = keep && {criteria: clone(p.criteria), presetId: p.presetId, modified: p.modified, weights: clone(h.weights), mix: clone(h.mix), custom: h.custom};
  applySetup(s);
  if (snap) { Object.assign(p, {criteria: snap.criteria, presetId: snap.presetId, modified: snap.modified}); Object.assign(h, {weights: snap.weights, mix: snap.mix, custom: snap.custom}); save(); learnMemo.key = null; }
}
let qz = null;
function openQuiz(opt = {}) {
  const prev = homeProfile().setup || {};
  qz = {step: Math.max(0, QORDER.indexOf(opt.step)), only: !!opt.step && !!prev.at, s: Object.assign({projet: null, who: null, colocs: null, budget: null, apport: null, loyer: null, revenus: null, meuble: "indiff", rooms: null, surface: null, places: [], prios: [], nos: [], arb: {}}, clone(prev))};
  if (!qz.s.projet && prev.at) qz.s.projet = "achat";
  if (!qz.s.places.length) qz.s.places = [{label: "", q: "", mode: "tc"}];
  let el = $("#quiz");
  if (!el) {
    el = document.createElement("div"); el.id = "quiz"; el.className = "auth quizwrap";
    el.innerHTML = `<div class="auth__veil"></div><div class="auth__card quiz" role="dialog" aria-modal="true" aria-labelledby="qzTitle"></div>`;
    document.body.appendChild(el);
  }
  el.hidden = false; requestAnimationFrame(() => el.classList.add("is-open"));
  paintQuiz();
}
function closeQuiz() { const el = $("#quiz"); if (!el) return; setTimeout(() => tipsKick(1200), 0); el.classList.remove("is-open"); setTimeout(() => { el.hidden = true; }, 200); }
function paintQuiz() {
  const card = $("#quiz .quiz"), s = qz.s, st = qz.step, key = QORDER[st], only = qz.only;
  const chips = (items, sel, multi, attr) => items.map(([v, l, d]) => `<button type="button" class="qopt${d ? "" : " qopt--sm"}" data-${attr}="${v}" aria-pressed="${multi ? sel.includes(v) : sel === v}"><b>${l}</b>${d ? `<span>${d}</span>` : ""}</button>`).join("");
  const head = (t, sub) => `<div class="quiz__top"><span class="quiz__n num">${only ? "Votre profil" : `${st + 1} / ${QSTEPS}`}</span><button class="link" type="button" id="qzLater">${homeProfile().setup ? "Fermer" : "Plus tard"}</button></div>
    ${only ? "" : `<div class="quiz__bar"><i style="width:${(st + 1) / QSTEPS * 100}%"></i></div>`}<h2 id="qzTitle">${t}</h2>${sub ? `<p class="auth__txt">${sub}</p>` : ""}`;
  const foot = (ok, label = "Continuer", skip) => `<div class="quiz__foot">${st && !only ? `<button class="btn btn--clair" type="button" id="qzBack">Retour</button>` : "<span></span>"}<span class="quiz__go">${skip && !only ? `<button class="link" type="button" id="qzSkip">Passer</button>` : ""}<button class="btn btn--primary" type="button" id="qzNext" ${ok ? "" : "disabled"}>${only ? "Enregistrer" : label}</button></span></div>`;
  let body = "";
  const replaces = !homeProfile().setup && (state.profile.modified || homeProfile().custom || state.zones.some(z => !z.example));
  const buy = s.projet !== "location", rent = s.projet === "location" || s.projet === "deux", coloc = s.who === "coloc" && s.projet === "location";
  if (key === "projet") body = head("Votre projet", replaces ? "Vos réglages actuels seront remplacés ; vos notes de zones restent." : "") + `<div class="qgrid qgrid--3">${chips(QUIZ_PROJ, s.projet, false, "pj")}</div>` + foot(!!s.projet);
  else if (key === "who") body = head("Vous cherchez…", s.projet === "deux" ? "Pour l’achat comme pour la location." : "") + `<div class="qgrid">${chips(s.projet === "location" ? QUIZ_WHO_LOC : QUIZ_WHO, s.who, false, "who")}</div>` + foot(!!s.who);
  else if (key === "budget") body = head("Votre budget", buy && rent ? "Pour l’achat et pour la location." : rent ? "Le loyer que vous pouvez payer chaque mois." : "Le prix affiché maximum, hors frais de notaire.") + (buy ? `
      ${rent ? `<h3 class="qsub">Achat</h3>` : ""}<div class="field"><label class="label" for="qzBudget">Prix maximum</label><input type="number" id="qzBudget" inputmode="numeric" step="5000" min="0" value="${s.budget ?? ""}" placeholder="Ex. 600 000 €"></div>
      <div class="chips qchips">${[350000, 500000, 650000, 800000, 1000000].map(v => `<button type="button" class="chip" data-bud="${v}" aria-pressed="${s.budget === v}">${v >= 1e6 ? "1 M€" : v / 1000 + " k€"}</button>`).join("")}</div>
      <div class="field"><label class="label" for="qzApport">Apport <span class="opt">facultatif, pour le coût par mois</span></label><input type="number" id="qzApport" inputmode="numeric" step="5000" min="0" value="${s.apport ?? ""}" placeholder="Ex. 80 000 €"></div>` : "") + (rent ? `
      ${buy ? `<h3 class="qsub">Location</h3>` : ""}${coloc ? `<div class="field"><span class="label">Colocataires, vous compris</span><div class="chips qchips">${[2, 3, 4, 5].map(v => `<button type="button" class="chip" data-coc="${v}" aria-pressed="${(s.colocs || 2) === v}">${v}${v === 5 ? " ou plus" : ""}</button>`).join("")}</div></div>` : ""}
      <div class="field"><label class="label" for="qzLoyer">${coloc ? "Loyer maximum par personne, charges comprises" : "Loyer maximum, charges comprises"}</label><input type="number" id="qzLoyer" inputmode="numeric" step="50" min="0" value="${s.loyer ?? ""}" placeholder="${coloc ? "Ex. 750 € par mois" : "Ex. 1 600 € par mois"}"></div>
      <div class="chips qchips">${(coloc ? [500, 650, 800, 1000, 1200] : [900, 1200, 1500, 1800, 2200]).map(v => `<button type="button" class="chip" data-loy="${v}" aria-pressed="${s.loyer === v}">${fmtInt(v)} €</button>`).join("")}</div>
      ${coloc ? `<p class="hint2" id="qzTot"${s.loyer ? "" : " hidden"}>Soit ${fmtInt((s.loyer || 0) * (s.colocs || 2))} € par mois pour le logement entier.</p>` : ""}
      <div class="field"><label class="label" for="qzRev">${coloc ? "Revenus nets par personne" : "Revenus nets du foyer"} <span class="opt">facultatif, pour savoir si votre dossier passe</span></label><input type="number" id="qzRev" inputmode="numeric" step="100" min="0" value="${s.revenus ?? ""}" placeholder="€ par mois"></div>
      <div class="field"><span class="label">Meublé ou vide</span><div class="chips qchips">${[["indiff", "Peu importe"], ["vide", "Vide"], ["meuble", "Meublé"]].map(([v, l]) => `<button type="button" class="chip" data-meu="${v}" aria-pressed="${(s.meuble || "indiff") === v}">${l}</button>`).join("")}</div></div>` : "") + foot(true, s.budget || s.loyer ? "Continuer" : "Je ne sais pas encore");
  else if (key === "taille") body = head("La taille", coloc ? `Une chambre par colocataire, plus une pièce commune&nbsp;: ${(s.colocs || 2) + 1} pièces au moins.` : "Le minimum en dessous duquel vous ne visiterez pas.") + `
      <div class="qgrid qgrid--5">${chips([[1, "Studio"], [2, "2 p."], [3, "3 p."], [4, "4 p."], [5, "5 p. +"]], s.rooms, false, "rooms")}</div>
      <div class="field"><label class="label" for="qzSurf">Surface minimum <span class="opt">facultatif</span></label><input type="number" id="qzSurf" inputmode="numeric" min="0" value="${s.surface ?? ""}" placeholder="m²"></div>` + foot(!!s.rooms, "Continuer", true);
  else if (key === "secteurs") {
    const n = (s.arrs || []).length, map = lieuxCache ? arrMapHTML(lieuxCache, s.arrs || [])
      : lieuxCache === null ? `<div class="qmap__grid">${Array.from({length: 20}, (_, i) => `<button type="button" class="qopt qopt--sm" data-arr="${i + 1}" aria-pressed="${(s.arrs || []).includes(i + 1)}"><b>${arrNom(i + 1)}</b></button>`).join("")}</div>`
      : `<div class="qmap__wait" aria-hidden="true"></div>`;
    body = head("Où cherchez-vous ?", "Touchez les arrondissements qui vous intéressent. Sans choix, Heden cherche dans tout Paris.") + `
      <div class="qmap">${map}</div>
      <div class="qmap__foot"><p class="qmap__sel"><b>${n ? plural(n, "arrondissement", "arrondissements") : "Tout Paris"}</b>${n ? ` · <span>${esc(secteursTxt(s))}</span>` : ""}</p>${n ? `<button class="link" type="button" id="qzArrClr">Tout Paris</button>` : ""}</div>
      ${n ? `<div class="chips qchips"><button type="button" class="chip" id="qzBan" aria-pressed="${!!s.banlieue}">Aussi en proche banlieue</button></div>` : ""}` + foot(true, n ? "Continuer" : "Tout Paris me va");
    if (lieuxCache === undefined) loadLieux().then(d => { lieuxCache = d || null; const el = $("#quiz"); if (qz && QORDER[qz.step] === "secteurs" && el && !el.hidden) paintQuiz(); });
  }
  else if (key === "trajets") body = head("Vos trajets", "Travail, études : Heden calcule le temps depuis chaque annonce.") + `
      <div class="qplaces">${s.places.map((pl, i) => `<div class="qplace" data-i="${i}">
        <div class="row2"><div class="field"><label class="label">Lieu ${i + 1}</label><input type="text" class="qpl-l" value="${esc(pl.label || "")}" placeholder="Ex. Bureau, école" maxlength="30"></div>
          <div class="field"><label class="label">Trajet en</label><select class="qpl-m">${Object.entries(MODES).map(([k, [l]]) => `<option value="${k}" ${pl.mode === k ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
        <div class="field qsearch"><input type="text" class="qpl-q" value="${esc(pl.q || "")}" placeholder="Adresse, station, entreprise…" autocomplete="off">${pl.lat ? `<span class="qok">✓</span>` : ""}<div class="qsugg" hidden></div></div>
      </div>`).join("")}</div>
      ${s.places.length < 2 ? `<button class="link" type="button" id="qzAddPl">+ Un deuxième lieu</button>` : ""}` + foot(true, "Continuer", true);
  else if (key === "prios") body = head("Ce qui compte le plus", `Jusqu’à 5 choix. <span class="num">${s.prios.length} / 5</span>`) + `<div class="qgrid qgrid--3">${chips(PRIOS.map(q => [q.id, q.name, q.desc]), s.prios, true, "prio")}</div>` + foot(s.prios.length > 0);
  else if (key === "arb") body = head("Vos arbitrages", "Entre deux biens, lequel visiteriez-vous ? Sans choix, les deux se valent.") + `<div class="qarbs">${ARBS.map(x => { const b = s.projet === "location" && x.bLoc ? x.bLoc : x.b, cur = (s.arb || {})[x.k];
      return `<div class="qarb" role="group" aria-label="${esc(x.q)}"><h3 class="qsub">${esc(x.q)}</h3><div class="qarb__row">${[x.a, b].map(([v, l, d]) => `<button type="button" class="qopt" data-arb="${x.k}" data-v="${v}" aria-pressed="${cur === v}"><b>${l}</b><span>${d}</span></button>`).join(`<span class="qarb__ou" aria-hidden="true">ou</span>`)}</div></div>`; }).join("")}</div>` + foot(true, Object.values(s.arb || {}).some(Boolean) ? "Continuer" : "Les deux se valent", true);
  else if (key === "refus") body = head("Vos refus", "Ce que vous ne voulez pas voir. Ces annonces restent visibles, avec une note plafonnée.") + `<div class="qgrid qgrid--2">${chips(NOS, s.nos, true, "no")}</div>` + foot(true, "Voir mon profil");
  else body = quizResultHTML();
  card.innerHTML = body;
  const later = $("#qzLater"); if (later) later.onclick = () => { try { localStorage.setItem("heden.quiz.later", "1"); } catch (e) {} closeQuiz(); };
  // une seule question (depuis le profil) : on enregistre et on ferme
  const next = () => { if (only) { saveOnly(s, key); closeQuiz(); rerenderAll(); renderProfile(); toast("Profil mis à jour : les notes suivent"); return; } qz.step++; paintQuiz(); }, back = $("#qzBack"); if (back) back.onclick = () => { qz.step--; paintQuiz(); };
  const nx = $("#qzNext"); if (nx) nx.onclick = () => { if (key === "secteurs") s.arrs = s.arrs || []; if (key === "arb") s.arbVu = true; if (key === "refus" && !only) applySetup(s); next(); };
  const sk = $("#qzSkip"); if (sk) sk.onclick = () => { if (key === "taille") { s.rooms = null; s.surface = null; } if (key === "trajets") s.places = [{label: "", q: "", mode: "tc"}]; if (key === "arb") { s.arb = {}; s.arbVu = true; } next(); };
  const togArr = n => { const a = s.arrs = (s.arrs || []).slice(), i = a.indexOf(n); if (i >= 0) a.splice(i, 1); else a.push(n); paintQuiz(); const g = $(`#quiz [data-arr="${n}"]`); if (g) g.focus({preventScroll: true}); };
  $$("[data-arr]", card).forEach(g => { g.onclick = () => togArr(+g.dataset.arr); g.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togArr(+g.dataset.arr); } }; });
  const ac = $("#qzArrClr"); if (ac) ac.onclick = () => { s.arrs = []; s.banlieue = false; paintQuiz(); };
  const bn = $("#qzBan"); if (bn) bn.onclick = () => { s.banlieue = !s.banlieue; paintQuiz(); };
  $$("[data-arb]", card).forEach(b => b.onclick = () => { s.arb = Object.assign({}, s.arb); s.arb[b.dataset.arb] = s.arb[b.dataset.arb] === b.dataset.v ? null : b.dataset.v; paintQuiz(); });
  $$("[data-pj]", card).forEach(b => b.onclick = () => { s.projet = b.dataset.pj; if ((s.projet === "location" && s.who === "invest") || (s.projet !== "location" && s.who === "coloc")) s.who = null; next(); });
  $$("[data-who]", card).forEach(b => b.onclick = () => { s.who = b.dataset.who; if (s.who === "coloc") { s.colocs = s.colocs || 2; if (!s.rooms) s.rooms = Math.min(5, s.colocs + 1); } next(); });
  $$("[data-coc]", card).forEach(b => b.onclick = () => { s.colocs = +b.dataset.coc; s.rooms = Math.min(5, s.colocs + 1); paintQuiz(); });
  $$("[data-loy]", card).forEach(b => b.onclick = () => { s.loyer = +b.dataset.loy; paintQuiz(); });
  $$("[data-meu]", card).forEach(b => b.onclick = () => { s.meuble = b.dataset.meu; paintQuiz(); });
  $$("[data-rooms]", card).forEach(b => b.onclick = () => { s.rooms = +b.dataset.rooms; paintQuiz(); });
  $$("[data-prio]", card).forEach(b => b.onclick = () => { const id = b.dataset.prio, i = s.prios.indexOf(id); if (i >= 0) s.prios.splice(i, 1); else if (s.prios.length < 5) s.prios.push(id); else return toast("5 choix au maximum"); paintQuiz(); });
  $$("[data-no]", card).forEach(b => b.onclick = () => { const id = b.dataset.no, i = s.nos.indexOf(id); if (i >= 0) s.nos.splice(i, 1); else s.nos.push(id); paintQuiz(); });
  $$("[data-bud]", card).forEach(b => b.onclick = () => { s.budget = +b.dataset.bud; paintQuiz(); });
  const num = (id, k) => { const i = $("#" + id); if (i) i.oninput = () => { const v = parseFloat(i.value); s[k] = isFinite(v) && v > 0 ? v : null; const n2 = $("#qzNext"); if (n2 && st === 2) n2.textContent = s.budget || s.loyer ? "Continuer" : "Je ne sais pas encore"; const tt = $("#qzTot"); if (tt && k === "loyer") { tt.hidden = !s.loyer; tt.textContent = `Soit ${fmtInt((s.loyer || 0) * (s.colocs || 2))} € par mois pour le logement entier.`; } }; };
  num("qzBudget", "budget"); num("qzApport", "apport"); num("qzSurf", "surface"); num("qzLoyer", "loyer"); num("qzRev", "revenus");
  const ap = $("#qzAddPl"); if (ap) ap.onclick = () => { s.places.push({label: "", q: "", mode: "tc"}); paintQuiz(); };
  $$(".qplace", card).forEach(row => {
    const pl = s.places[+row.dataset.i], q = $(".qpl-q", row), sg = $(".qsugg", row); let tm = null;
    $(".qpl-l", row).oninput = e => { pl.label = e.target.value; };
    $(".qpl-m", row).onchange = e => { pl.mode = e.target.value; };
    q.oninput = () => {
      pl.q = q.value; pl.lat = pl.lng = null; const ok = $(".qok", row); if (ok) ok.remove();
      clearTimeout(tm); if (q.value.trim().length < 3) { sg.hidden = true; return; }
      tm = setTimeout(async () => {
        const vb = `${BOUNDS[0][1]},${BOUNDS[1][0]},${BOUNDS[1][1]},${BOUNDS[0][0]}`;
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q.value)}&viewbox=${vb}&bounded=1&limit=4&countrycodes=fr&accept-language=fr`);
          const j = r.ok ? await r.json() : [];
          sg.innerHTML = j.map((x, k) => `<button type="button" data-k="${k}">${esc(x.display_name.split(",").slice(0, 3).join(","))}</button>`).join("") || `<p class="hint2">Aucun résultat</p>`;
          sg.hidden = false;
          $$("button", sg).forEach(b => b.onclick = () => { const x = j[+b.dataset.k]; pl.lat = +x.lat; pl.lng = +x.lon; pl.q = x.display_name.split(",").slice(0, 2).join(","); if (!pl.label) pl.label = x.name || pl.q.split(",")[0]; paintQuiz(); });
        } catch (e) {}
      }, 400);
    };
  });
  const go = $("#qzDone"); if (go) go.onclick = () => { closeQuiz(); lui.openId = null; lui.feed = cloud.user ? "explorer" : "mes"; lui.exf = "pour"; rerenderAll(); setTab("annonces"); };
  const zo = $("#qzZones"); if (zo) zo.onclick = () => { closeQuiz(); rerenderAll(); openLieux(); };
  const adv = $("#qzAdv"); if (adv) adv.onclick = () => { closeQuiz(); rerenderAll(); ptab = "note"; setTab("profile"); showPtab("note"); };
}
function quizResultHTML() {
  const p = state.profile, h = homeProfile(), s = h.setup || qz.s;
  const zs = p.criteria.slice().sort((a, b) => b.weight - a.weight).slice(0, 4), hs = Object.entries(h.weights).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const tot = arr => arr.reduce((a, [, w]) => a + w, 0) || 1;
  const bars = (rows, all) => { const mx = Math.max(...rows.map(r => r[1]), 1); return rows.map(([n, w]) => `<div class="qbar"><span>${esc(n)}</span><i style="--w:${Math.round(w / mx * 100)}%"></i><em class="num">${Math.round(w / all * 100)} %</em></div>`).join(""); };
  const zAll = p.criteria.reduce((a, c) => a + c.weight, 0), hAll = tot(Object.entries(h.weights)), mx = h.mix;
  // ce que Heden peut noter tout de suite parmi les annonces reçues
  const ex = cloud.user && cloud.vivierRows ? explorerItems().map(x => scoreListing(x.f)).filter(x => !x.fails.length) : null;
  const ok = ex ? ex.filter(x => x.reliable).length : 0, mb = ex ? ex.filter(x => x.maybe).length : 0;
  const cell = (n, one, many) => `<span><b class="num">${n}</b>${n > 1 ? many : one}</span>`;
  const exLine = ex && ex.length ? `<p class="qready__h">Dans Explorer, déjà</p><div class="qready__n">${cell(ex.length, "dans vos critères", "dans vos critères")}${cell(ok, "notée pour vous", "notées pour vous")}${cell(mb, "peut vous plaire, à compléter", "peuvent vous plaire, à compléter")}</div>` : "";
  return `<div class="quiz__top"><span class="quiz__n">C’est prêt</span><span></span></div><div class="quiz__bar"><i style="width:100%"></i></div>
    <h2 id="qzTitle">Votre profil Heden</h2>
    <p class="auth__txt">${esc(profileLine(s))}${(s.arrs || []).length ? ` · <span>${esc(secteursTxt(s))}</span>` : ""}</p>
    <div class="qmix"><h3>Ce qui fait la note</h3><div class="qmix__bar" aria-hidden="true"><i style="flex:${mx.logement}"></i><i style="flex:${mx.quartier}"></i><i style="flex:${mx.prix}"></i></div>
      <p class="qmix__leg"><span><b class="num">${mx.logement} %</b> le logement</span><span><b class="num">${mx.quartier} %</b> le quartier</span><span><b class="num">${mx.prix} %</b> le prix</span></p></div>
    <div class="qres"><div><h3>Dans un quartier</h3>${bars(zs.map(c => [c.name, c.weight]), zAll)}</div>
      <div><h3>Dans un logement</h3>${bars(hs.map(([id, w]) => [HOME_LIB[id].name, w]), hAll)}</div></div>
    ${exLine ? `<div class="qready">${exLine}</div>` : ""}
    ${zonesRated() < 2 ? `<div class="qtip"><p><b>Des notes de quartier plus justes</b>Notez deux ou trois coins que vous connaissez : Heden s’en sert pour toutes les annonces autour.</p><button class="btn btn--sm" type="button" id="qzZones">Noter un quartier</button></div>` : ""}
    <p class="hint2">Ensuite, Heden affine vos priorités d’après vos favoris et les annonces que vous masquez.</p>
    <div class="quiz__foot"><button class="btn btn--ghost" type="button" id="qzAdv">Ajuster en détail</button><button class="btn btn--primary" type="button" id="qzDone">Voir les annonces</button></div>`;
}
function profileLine(s) {
  if (!s) return "";
  const lo = homeProfile().loc || {}, pj = s.projet || "achat", nC = s.who === "coloc" ? lo.colocs || s.colocs || 2 : 0;
  const who = nC ? `En colocation à ${nC}` : ([...QUIZ_WHO, ...QUIZ_WHO_LOC].find(x => x[0] === s.who) || [, ""])[1];
  return [PROJ_LABEL[pj], who, pj !== "achat" && (lo.loyerMax || s.loyer) ? `loyer max. ${fmtInt(lo.loyerMax || s.loyer)} €/mois${nC && lo.loyerMax ? ` (${fmtInt(lo.loyerMax / nC)} € par personne)` : ""}` : null, s.rooms ? (s.rooms === 1 ? "studio" : `${s.rooms} pièces${s.rooms >= 5 ? " et plus" : ""} min.`) : null, s.surface ? `${s.surface} m² min.` : null, pj !== "location" && s.budget ? `jusqu’à ${fmtInt(s.budget)} €` : null].filter(Boolean).join(" · ");
}
const zonesRated = () => state.zones.filter(z => !z.example && scoreOf(z).rated > 0).length;
/* Ce qu'il manque au profil pour que Heden note bien : chaque ligne ouvre la question qui la règle */
function readiness() {
  const h = homeProfile(), s = h.setup || {}, rent = (s.projet || h.projet) === "location", zr = zonesRated();
  return [
    {k: "budget", ok: !!(rent ? (h.loc || {}).loyerMax : h.budgetMax), t: rent ? "Votre loyer maximum" : "Votre budget", d: "Les annonces trop chères passent en hors critères."},
    {k: "taille", ok: !!h.roomsMin, t: "La taille minimum", d: "Pièces et surface en dessous desquelles vous ne visitez pas."},
    {k: "secteurs", ok: Array.isArray(s.arrs), t: "Vos secteurs", d: "Les arrondissements où vous cherchez."},
    {k: "prios", ok: (s.prios || []).length > 0, t: "Ce qui compte le plus", d: "Le poids de chaque critère dans la note."},
    {k: "arb", ok: !!s.arbVu, t: "Vos arbitrages", d: "La part du logement, du quartier et du prix."},
    {k: "zones", ok: zr >= 2, t: "Des quartiers notés", d: zr ? `${plural(zr, "zone notée", "zones notées")} : deux ou trois suffisent pour juger les annonces autour.` : "Notez deux ou trois coins que vous connaissez : Heden juge mieux les annonces autour."}
  ];
}
function profileSummaryHTML() {
  const h = homeProfile(), s = h.setup, L = learning();
  if (!s) return `<section class="sec psum psum--new">
      <h2>Réglez Heden en deux minutes</h2>
      <div><button class="btn btn--primary" type="button" id="quizGo">Répondre aux questions</button></div>
    </section>`;
  const prios = (s.prios || []).map(id => (PRIOS.find(q => q.id === id) || {}).name).filter(Boolean);
  const nos = (s.nos || []).map(id => (NOS.find(n => n[0] === id) || [, ""])[1]).filter(Boolean).map((n, i) => i ? n[0].toLowerCase() + n.slice(1) : n);
  const pl = (s.places || []).filter(p => p.lat);
  return `<section class="sec psum">
      <div class="psum__head"><div><h2>Votre recherche</h2><p class="psum__line">${esc(profileLine(s))}</p></div><button class="btn btn--sm" type="button" id="quizGo">Refaire le questionnaire</button></div>
      ${prios.length ? `<div class="chips">${prios.map(n => `<span class="tag">${esc(n)}</span>`).join("")}</div>` : ""}
      <dl class="meta">${Array.isArray(s.arrs) ? `<dt>Secteurs</dt><dd class="psum__secs">${secteursTxt(s).split(/,\s*/).filter(Boolean).map(x => `<span class="tag">${esc(x)}</span>`).join("")}</dd>` : ""}${nos.length ? `<dt>Refus</dt><dd>${esc(nos.join(", "))}</dd>` : ""}${pl.length ? `<dt>Trajets</dt><dd>${esc(pl.map(p => `${p.label || p.q} (${MODES[p.mode || "tc"][0].toLowerCase()})`).join(", "))}</dd>` : ""}</dl>
      ${(() => { const miss = readiness().filter(x => !x.ok); return miss.length ? `<div class="pready"><b>Pour des notes plus fiables</b><ul>${miss.map(x => `<li><span><b>${esc(x.t)}</b></span><button class="btn btn--sm btn--clair" type="button" data-ready="${x.k}">${x.k === "zones" ? "Noter un quartier" : "Répondre"}</button></li>`).join("")}</ul></div>` : ""; })()}
      ${L.n < 4 ? "" : `<div class="plearn">${L.notes.length ? `<b>Appris de vos ${L.n} choix</b><ul>${L.notes.map(n => `<li class="${n.up ? "up" : "down"}">${esc(n.txt)}</li>`).join("")}</ul>` : `<p class="hint2">Vos ${L.n} choix confirment vos priorités : rien à ajuster pour l’instant.</p>`}
        <button class="chip" type="button" id="learnTg" aria-pressed="${h.learn !== false}">Apprendre de mes choix</button></div>`}

    </section>`;
}
function bindProfileSummary() {
  const q = $("#quizGo"); if (q) q.onclick = () => openQuiz();
  $$("[data-ready]").forEach(b => b.onclick = () => b.dataset.ready === "zones" ? openLieux() : openQuiz({step: b.dataset.ready}));
  const t = $("#learnTg"); if (t) t.onclick = () => { const h = homeProfile(); h.learn = h.learn === false; save(); learnMemo.key = null; renderProfile(); rerenderAll(); };
}
/* Premier lancement : le guide d'abord, puis le questionnaire (proposé à sa dernière étape, ou dès qu'on le passe) */
function quizDue() {
  try { if (localStorage.getItem("heden.quiz.later")) return false; } catch (e) {}
  return !(homeProfile().setup || state.profile.modified || state.zones.some(z => !z.example) || listings().length);
}
function maybeAutoQuiz() {
  if (!quizDue()) return;
  const st = tipsState(); if (!st.off && !st.done) return;   // le guide le proposera
  setTimeout(() => { if (quizDue() && !$("#auth.is-open")) openQuiz(); }, 900);
}

/* ---------- Sources d'annonces : alertes e-mail et bouton + Heden ---------- */
const bmkOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) ? "ios" : /Android/.test(navigator.userAgent) ? "android" : "pc";
let srcUI = {os: null, open: null};
function bookmarkletCode() {
  const H = location.origin + location.pathname;
  // lecture : lirePage (01b-lecture.js) ; envoi : une version courte dans l'adresse, la complète par message
  const body = `const sm=Object.assign({},d,{text:d.text.slice(0,9000),ld:d.ld.map(x=>x.slice(0,5000)).slice(0,2),items:d.items.slice(0,30).map(c=>({url:c.url,img:c.img,imgs:(c.imgs||[]).slice(0,4),text:c.text.slice(0,240)})),hints:{tels:d.hints.tels,mails:d.hints.mails,state:d.hints.state.slice(0,6).map(x=>x.slice(0,500))}});const w=window.open(H+'?importer='+Date.now()+'#import='+encodeURIComponent(JSON.stringify(sm)),'heden');let n=0;const t=setInterval(()=>{if(!w||n++>40)return clearInterval(t);try{w.postMessage({type:'heden-import',data:d},'*')}catch(e){}},400);window.addEventListener('message',e=>{if(e.data==='heden-recu')clearInterval(t)});`;
  return "javascript:" + encodeURIComponent(`(()=>{const H=${JSON.stringify(H)};const X=${extractCards.toString()};const d=(${lirePage.toString()})(X);${body}})();`);
}
const bmkInstalled = () => { try { return !!localStorage.getItem("heden.bmk"); } catch (e) { return false; } };
function bmkStepsHTML(os) {
  const copy = `<button class="btn btn--sm" type="button" data-bmkcopy>Copier le code du bouton</button>`;
  const steps = {
    pc: [["Affichez la barre des favoris", "Cmd + Maj + B sur Mac, Ctrl + Maj + B sur PC."],
      ["Glissez ce bouton dans la barre des favoris", `<span class="bmk__drag"><a class="btn btn--sm bmk__link" href="${bookmarkletCode()}" draggable="true">+ Heden</a><span>Maintenez le clic dessus, déposez-le dans la barre, relâchez.</span></span>`],
      ["Sur une annonce, cliquez sur « + Heden »", "Heden s’ouvre avec l’annonce déjà remplie. Sur une page de résultats, il propose d’importer toutes les annonces affichées."]],
    ios: [["Copiez le code du bouton", copy],
      ["Créez un signet dans Safari", "Sur cette page : bouton Partager, Ajouter un signet, Enregistrer."],
      ["Transformez-le en bouton Heden", "Ouvrez les signets (icône livre), Modifier, touchez le signet : nommez-le « + Heden » et collez le code à la place de l’adresse."],
      ["Sur une annonce ouverte dans Safari", "Tapez « + Heden » dans la barre d’adresse et touchez le signet proposé. Depuis les applis SeLoger ou Leboncoin, ouvrez d’abord l’annonce dans Safari."]],
    android: [["Copiez le code du bouton", copy],
      ["Ajoutez cette page aux favoris", "Dans Chrome : menu ⋮, puis l’étoile."],
      ["Transformez-le en bouton Heden", "Menu ⋮, Favoris, crayon sur ce favori : nommez-le « + Heden » et collez le code à la place de l’adresse."],
      ["Sur une annonce ouverte dans Chrome", "Tapez « + Heden » dans la barre d’adresse et touchez le favori proposé."]]
  }[os];
  return `<ol class="steps">${steps.map(([t, d]) => `<li><b>${t}</b><div>${d}</div></li>`).join("")}</ol>`;
}
function sourcesHTML(empty) {
  const os = srcUI.os || bmkOS(), al = cloud.alert, inst = bmkInstalled();
  const pc = os === "pc", extOn = extInstalled(), extOld = extOn && ext.v && ext.v !== EXT_VERSION;
  const open = srcUI.open ?? (empty ? (pc && !extOn ? "extension" : "alertes") : null);
  const alertStatus = !cloud.user ? "Connectez-vous pour les recevoir" : cloud.noInbox ? "Indisponible pour l’instant" : !al ? "…" : !al.token ? "Pas encore activées"
    : al.last_at ? `Actives · ${plural(al.received || 0, "alerte reçue", "alertes reçues")}, la dernière ${ago(al.last_at)}` : "Activées · en attente de la première alerte";
  const maps = cloud.maps || [], h = homeProfile(), target = (h.alerts && h.alerts.mapId) || cloud.personalMapId;
  return `<section class="srcs" id="srcs">
    <h2>${empty ? "Quatre façons de remplir Heden" : "Alimenter Heden"}</h2>
    <div class="src${open === "extension" ? " is-open" : ""}" data-src="extension">
      <button class="src__head" type="button" data-srct="extension"><span class="src__ic">${ICON_EXT}</span><span class="src__t"><b>L’extension Heden</b><span>${extOld ? (EXT_STORE ? `Installée · Chrome passe à la version ${EXT_VERSION} tout seul` : `Mise à jour disponible : version ${EXT_VERSION}`) : extOn ? "Installée · chaque page d’annonces que vous ouvrez part dans Explorer" : "Sur ordinateur : vos recherches remplissent Explorer en naviguant"}</span></span><span class="src__chev"></span></button>
      <div class="src__body">
        <p class="hint2">Sur SeLoger, PAP, Leboncoin, Bien’ici, Jinka et les autres sites, l’extension lit chaque liste de résultats et chaque annonce que vous ouvrez, et les envoie dans Explorer pour tout le groupe : nouvelles annonces, prix qui baissent, annonces retirées. Elle ne lit que les pages que vous ouvrez.</p>
        ${extOn && (!extOld || EXT_STORE) ? `<ol class="steps">
            <li><b>Ouvrez vos recherches, triées par date</b><div>Une bulle en bas de page dit combien d’annonces sont nouvelles. Quand une page n’apporte rien de neuf, inutile d’aller plus loin.</div></li>
            <li><b>Ouvrez les annonces qui vous intéressent</b><div>Leur fiche complète, toutes les photos comprises, arrive dans Explorer. Celles de vos favoris se mettent à jour.</div></li>
            <li><b>Gardez Heden ouvert et connecté</b><div>L’extension se sert de cet onglet pour envoyer les annonces ; elle l’ouvre si besoin.</div></li>
          </ol>
          ${EXT_STORE ? `<p class="hint2"><span>Installée à la main depuis un dossier ? Retirez-la et</span> <a class="link" href="${EXT_STORE}" target="_blank" rel="noopener">reprenez-la sur le Chrome Web Store</a><span> : elle se mettra à jour toute seule.</span></p>` : `<p class="hint2"><a class="link" href="heden-extension.zip" download>Télécharger de nouveau l’extension</a></p>`}` : EXT_STORE ? `<ol class="steps">
            <li><b>Installez l’extension</b><div><a class="btn btn--primary btn--sm steps__btn" href="${EXT_STORE}" target="_blank" rel="noopener">Ouvrir le Chrome Web Store ↗</a><p class="steps__p hint2">Puis « Ajouter à Chrome ». Elle se met à jour toute seule.</p><p class="steps__p hint2">Edge, Brave et Arc l’installent aussi depuis cette page (Edge : acceptez les extensions d’autres boutiques).</p></div></li>
            <li><b>Épinglez Heden</b><div>Icône de pièce de puzzle à droite de la barre d’adresse, puis l’épingle à côté de Heden.</div></li>
          </ol>` : `<ol class="steps">
            <li><b>Téléchargez l’extension</b><div><a class="btn btn--primary btn--sm steps__btn" href="heden-extension.zip" download>Télécharger l’extension</a><p class="steps__p hint2">Puis décompressez le fichier : un dossier « heden-extension » apparaît.</p></div></li>
            <li><b>Ouvrez la page des extensions</b><div><p class="steps__p"><span>Dans la barre d’adresse, tapez</span> <code>chrome://extensions</code> <button class="link" type="button" data-extcopy>Copier l’adresse</button></p><p class="steps__p hint2"><span>Edge :</span> <code>edge://extensions</code> <span>· Brave :</span> <code>brave://extensions</code></p></div></li>
            <li><b>Activez le mode développeur</b><div>L’interrupteur en haut à droite de la page.</div></li>
            <li><b>Chargez le dossier</b><div><span>« Charger l’extension non empaquetée », puis choisissez le dossier « heden-extension ».</span>${extOld ? ` <span>Pour une mise à jour : remplacez le dossier, puis touchez ↻ sur la carte Heden.</span>` : ""}</div></li>
            <li><b>Épinglez Heden</b><div>Icône de pièce de puzzle à droite de la barre d’adresse, puis l’épingle à côté de Heden.</div></li>
          </ol>`}
        ${pc ? "" : `<p class="hint2">Sur téléphone, les extensions ne sont pas disponibles : utilisez le bouton + Heden.</p>`}
      </div>
    </div>
    <div class="src${open === "alertes" ? " is-open" : ""}" data-src="alertes">
      <button class="src__head" type="button" data-srct="alertes"><span class="src__ic">${ICON_MAIL}</span><span class="src__t"><b>Vos alertes arrivent toutes seules</b><span>${esc(alertStatus)}</span></span><span class="src__chev"></span></button>
      <div class="src__body">
        <p class="hint2">Gardez vos alertes SeLoger, PAP, Leboncoin, Bien’ici… sur votre adresse Gmail : chaque nouvelle annonce, et chaque baisse de prix, arrive ici dans le quart d’heure.</p>
        ${!cloud.user ? `<button class="btn btn--primary" type="button" id="alLogin">Se connecter</button>`
          : cloud.noInbox ? `<p class="hint2">La réception des alertes n’est pas encore installée sur le serveur.</p>`
          : `<ol class="steps">
              <li><b>Créez vos alertes sur les sites</b><div>Avec votre adresse Gmail, comme d’habitude. Celles que vous avez déjà comptent aussi.</div></li>
              <li><b>Reliez Gmail à Heden, une seule fois</b><div>${al && al.token ? `<div class="datarow"><button class="btn btn--sm" type="button" id="alCopy">Copier le script</button><a class="btn btn--sm" href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">Ouvrir Google Apps Script ↗</a></div>
                  <p class="hint2">Collez le script dans le projet, Enregistrer, choisissez « installer » en haut puis Exécuter, et autorisez. Le script ne lit que les e-mails des sites immobiliers.</p>`
                : `<button class="btn btn--primary btn--sm" type="button" id="alOn">Créer mon script Gmail</button>`}</div></li>
              <li><b>C’est tout</b><div>Les annonces arrivent dans ${maps.length > 1 ? `<select id="alMap" class="inline-sel">${maps.map(m => `<option value="${m.id}" ${m.id === target ? "selected" : ""}>${esc(m.personal ? "Ma carte" : m.name)}</option>`).join("")}</select>` : "votre carte"}, triées selon votre profil.</div></li>
            </ol>
            ${al && al.token ? `<button class="link" type="button" id="alReset">Changer de script (l’ancien cessera de fonctionner)</button>` : ""}`}
      </div>
    </div>
    <div class="src${open === "bouton" ? " is-open" : ""}" data-src="bouton">
      <button class="src__head" type="button" data-srct="bouton"><span class="src__ic">${ICON_BMK}</span><span class="src__t"><b>Le bouton + Heden</b><span>${inst ? "Installé · une annonce ou toute une page de résultats en un clic" : "Un favori : une annonce ou toute une page de résultats en un clic"}</span></span><span class="src__chev"></span></button>
      <div class="src__body">
        <div class="seg seg--sm" role="group" aria-label="Appareil">${[["pc", "Ordinateur"], ["ios", "iPhone"], ["android", "Android"]].map(([k, l]) => `<button type="button" data-os="${k}" aria-pressed="${os === k}">${l}</button>`).join("")}</div>
        ${bmkStepsHTML(os)}
        <p class="hint2">Le bouton ne lit que la page que vous regardez, rien d’autre.</p>
      </div>
    </div>
    <div class="src" data-src="coller">
      <button class="src__head" type="button" id="srcPaste"><span class="src__ic">${ICON_PASTE}</span><span class="src__t"><b>Coller une annonce</b><span>Son lien et son texte, Heden fait le reste</span></span><span class="src__chev src__chev--go"></span></button>
    </div>
  </section>`;
}
const ICON_MAIL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 7 8.5-7"/></svg>';
const ICON_BMK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M6 3h12v18l-6-4.5L6 21z"/><path d="M12 7.5v6M9 10.5h6" stroke-linecap="round"/></svg>';
const ICON_EXT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M9 4.5a2 2 0 0 1 4 0V6h4a1 1 0 0 1 1 1v4h-1.5a2 2 0 0 0 0 4H18v4a1 1 0 0 1-1 1h-4v-1.5a2 2 0 0 0-4 0V20H5a1 1 0 0 1-1-1v-4h1.5a2 2 0 0 0 0-4H4V7a1 1 0 0 1 1-1h4z"/></svg>';
const ICON_PASTE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" stroke-linecap="round"/></svg>';
function bindSources(box = $("#srcs"), redraw = renderListings) {
  if (!box) return;
  $$("[data-srct]", box).forEach(b => b.onclick = () => { const k = b.dataset.srct; srcUI.open = srcUI.open === k || (srcUI.open == null && box.querySelector(`[data-src="${k}"].is-open`)) ? "" : k; redraw(); });
  $$("[data-os]", box).forEach(b => b.onclick = () => { srcUI.os = b.dataset.os; srcUI.open = "bouton"; redraw(); });
  $$("[data-extcopy]", box).forEach(c => c.onclick = async () => { try { await navigator.clipboard.writeText("chrome://extensions"); toast("Adresse copiée : collez-la dans la barre d’adresse"); } catch (e) { toast("Tapez chrome://extensions dans la barre d’adresse"); } });
  $$("[data-bmkcopy]", box).forEach(c => c.onclick = async () => { try { await navigator.clipboard.writeText(bookmarkletCode()); toast("Code copié : collez-le dans le signet"); } catch (e) { window.prompt("Copiez ce code :", bookmarkletCode()); } });
  const l = $(".bmk__link", box); if (l) l.onclick = e => { e.preventDefault(); l.classList.remove("bmk__link--nudge"); void l.offsetWidth; l.classList.add("bmk__link--nudge"); toast("Ne cliquez pas : glissez-le dans la barre des favoris"); };
  const p = $("#srcPaste"); if (p) p.onclick = () => openAddListing();
  const lg = $("#alLogin"); if (lg) lg.onclick = () => openAuth();
  const on = $("#alOn"), reset = $("#alReset");
  const mk = async btn => {
    btn.disabled = true;
    const {data, error} = await cloud.client.rpc("new_ingest_token");
    if (error || !data) { btn.disabled = false; return toast("Impossible de créer le script pour l’instant"); }
    cloud.alert = {token: data, last_at: null, received: 0}; srcUI.open = "alertes"; redraw();
    try { await navigator.clipboard.writeText(gmailScript(data)); toast("Script copié : collez-le dans Google Apps Script"); } catch (e) {}
  };
  if (on) on.onclick = () => mk(on);
  if (reset) reset.onclick = async () => { if (await askConfirm({title: "Changer de script ?", text: "L’ancien script Gmail cessera d’envoyer vos alertes. Il faudra coller le nouveau.", ok: "Changer"})) mk(reset); };
  const cp = $("#alCopy"); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(gmailScript(cloud.alert.token)); toast("Script copié"); } catch (e) { window.prompt("Copiez ce script :", gmailScript(cloud.alert.token)); } };
  const am = $("#alMap"); if (am) am.onchange = e => { const h = homeProfile(); h.alerts = Object.assign({}, h.alerts, {mapId: e.target.value}); save(); toast("Les alertes iront sur cette carte"); };
}

/* ---------- Ajouter une annonce : trois façons, puis l'étape choisie ---------- */
function openAddFlow(view = "choix", dir = "in") {
  let el = $("#lsheet");
  const closeSheet = () => { el.classList.remove("is-open"); setTimeout(() => { el.hidden = true; }, 200); };
  if (!el) { el = document.createElement("div"); el.id = "lsheet"; el.className = "auth"; el.innerHTML = `<div class="auth__veil" data-lclose></div><div class="auth__card lsheet" role="dialog" aria-modal="true" aria-labelledby="lsTitle"></div>`; document.body.appendChild(el); el.addEventListener("click", e => { if (e.target.closest("[data-lclose]")) closeSheet(); }); }
  if (cloud.user && cloud.alert === undefined && !cloud.noInbox) { cloud.alert = null; loadAlertState().then(() => { const c = $("#lsheet .addf"); if (c && !el.hidden) openAddFlow(c.dataset.v, "same"); }); }
  if (view === "coller") return openAddListing(null, null, {back: () => openAddFlow("choix", "back"), dir});
  const card = el.querySelector(".lsheet");
  const close = `<button class="x" type="button" data-lclose aria-label="Fermer"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
  const back = `<button class="x addf__back" type="button" aria-label="Retour"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5 8 12l7 7"/></svg></button>`;
  const tmp = document.createElement("div"); tmp.innerHTML = sourcesHTML(false);
  const status = k => { const t = tmp.querySelector(`[data-src="${k}"] .src__t span`); return t ? t.textContent : ""; };
  const opt = (k, ic, t, sub) => `<button class="addopt" type="button" data-v="${k}"><span class="src__ic">${ic}</span><span class="addopt__t"><b>${t}</b><small>${esc(sub)}</small></span><span class="src__chev src__chev--go"></span></button>`;
  let body;
  if (view === "choix") body = `<div class="auth__head"><h2 id="lsTitle">Ajouter une annonce</h2>${close}</div>
    <div class="addopts">${bmkOS() === "pc" ? opt("extension", ICON_EXT, "L’extension Heden", extInstalled() ? status("extension") : "Sur ordinateur : vos recherches remplissent Explorer en naviguant") : ""}${opt("coller", ICON_PASTE, "Coller une annonce", "Son lien et son texte, tout de suite")}${opt("bouton", ICON_BMK, "Le bouton + Heden", bmkInstalled() ? "Installé : une annonce ou une page de résultats en un clic" : "À installer une fois, puis un clic sur chaque annonce")}${opt("alertes", ICON_MAIL, "Les alertes e-mail", status("alertes") || "Vos alertes arrivent toutes seules")}</div>`;
  else {
    const src = tmp.querySelector(`[data-src="${view}"] .src__body`);
    body = `<div class="auth__head">${back}<h2 id="lsTitle">${view === "bouton" ? "Le bouton + Heden" : view === "extension" ? "L’extension Heden" : "Les alertes e-mail"}</h2>${close}</div><div class="addf__body" id="srcs">${src ? src.innerHTML : ""}</div>`;
  }
  card.innerHTML = `<div class="addf addf--${dir}" data-v="${view}">${body}</div>`;
  $$(".addopt", card).forEach(b => b.onclick = () => openAddFlow(b.dataset.v, "in"));
  const bk = card.querySelector(".addf__back"); if (bk) bk.onclick = () => openAddFlow("choix", "back");
  if (view !== "choix") bindSources(card.querySelector("#srcs"), () => openAddFlow(view, "same"));
  if (el.hidden || !el.classList.contains("is-open")) { el.hidden = false; requestAnimationFrame(() => el.classList.add("is-open")); }
}

/* ---------- Fiche annonce : sections d'analyse ---------- */
function tripsHTML(f) {
  const com = commutes(f);
  return com.length ? `<section class="lsec"><h2>Vos trajets</h2><div class="trips">${com.map(({p, min}) => `<a class="trip" href="https://www.google.com/maps/dir/?api=1&origin=${f.lat},${f.lng}&destination=${p.lat},${p.lng}&travelmode=${MODES[p.mode || "tc"][3]}" target="_blank" rel="noopener noreferrer">
        <b class="num">${min} min</b><span>${esc(p.label || p.q)} · ${MODES[p.mode || "tc"][0].toLowerCase()}</span><em>Itinéraire ↗</em></a>`).join("")}</div>
      <p class="hint2">Estimation à vol d’oiseau${f.precise ? "" : ", position approximative"}.</p></section>` : "";
}
/* ---------- Location : encadrement, coût d'entrée, taux d'effort, points de vigilance ----------
   Règles en vigueur : dépôt de garantie d'un mois hors charges (vide) ou deux (meublé) ; honoraires du locataire
   plafonnés par m² (zone très tendue : 12,10 € + 3,03 € pour l'état des lieux, baux signés depuis le 1er janvier 2026) ;
   logement classé G non décent, donc non louable, depuis 2025 ; complément de loyer interdit si DPE F ou G. */
const FEE_M2 = 12.10, FEE_EDL_M2 = 3.03;
function rentFacts(f) {
  const r = rentFor(f), surf = f.surface || null, cc = f.price || null;
  const hc = f.rentHC ?? (cc && f.rentCharges != null ? cc - f.rentCharges : null);
  const mb = f.furnished === true, part = f.seller === "particulier";
  const depMax = hc ? hc * (mb ? 2 : 1) : null, feeMax = surf ? surf * (FEE_M2 + FEE_EDL_M2) : null;
  let cap = null, capSrc = null, capLo = null, capHi = null;
  if (f.refMaj && surf) { cap = f.refMaj; capSrc = "annonce"; }
  else if (r && r.zone === "paris") { if (r.ep) { cap = r.max; capSrc = "quartier"; } else { capLo = r.maxLo; capHi = r.maxHi; capSrc = "quartier"; } }
  const ppmHC = hc && surf ? (hc - (f.complement || 0)) / surf : null;
  let verdict = null;
  if (ppmHC != null && cap) verdict = ppmHC <= cap + .05 ? "ok" : "over";
  else if (ppmHC != null && capLo) verdict = ppmHC <= capLo + .05 ? "ok" : ppmHC > capHi + .05 ? "over" : "depend";
  const over = verdict === "over" && surf ? Math.round(hc - (f.complement || 0) - (cap || capHi) * surf) : 0;
  return {r, surf, cc, hc, mb, part, depMax, feeMax, cap, capSrc, capLo, capHi, ppmHC, verdict, over};
}
function rentAnalysisHTML(f) {
  const x = rentFacts(f), h = homeProfile(), lo = h.loc || {}, eur = v => fmtInt(Math.round(v)) + "&#8239;€";
  // Encadrement
  let enc = "";
  if (x.r && (x.r.zone === "paris" || x.r.encadre)) {
    const head = x.verdict === "ok" ? `<div class="rentv rentv--ok"><b>Dans le plafond légal</b><span>${x.cap ? `${fmt1(x.ppmHC)} €/m² hors charges pour un plafond de ${fmt1(x.cap)} €/m²` : `${fmt1(x.ppmHC)} €/m² hors charges, sous le plafond le plus bas du quartier (${fmt1(x.capLo)} €/m²)`}</span></div>`
      : x.verdict === "over" ? `<div class="rentv rentv--over"><b>Au-dessus du plafond légal</b><span>Environ ${eur(x.over)} de trop par mois : ${fmt1(x.ppmHC)} €/m² hors charges${f.complement ? " (complément déduit)" : ""} pour un plafond de ${fmt1(x.cap || x.capHi)} €/m².</span></div>`
      : x.verdict === "depend" ? `<div class="rentv"><b>Selon l’année de construction</b><span>${fmt1(x.ppmHC)} €/m² hors charges. Le plafond du quartier va de ${fmt1(x.capLo)} à ${fmt1(x.capHi)} €/m² selon l’époque de l’immeuble. Indiquez-la dans « Corriger les informations ».</span></div>`
      : `<div class="rentv"><b>${x.r.zone === "paris" ? "Loyers encadrés dans ce quartier" : `Loyers encadrés à ${esc(x.r.name)}`}</b><span>${x.hc ? "" : "Il manque le loyer hors charges ou la surface pour comparer au plafond. "}Vérifiez avec le simulateur officiel.</span></div>`;
    const facts = [];
    if (x.r.zone === "paris") facts.push(`Quartier ${esc(x.r.name)}, ${x.r.rooms === 1 ? "1 pièce" : `${x.r.rooms}${x.r.rooms >= 4 ? " pièces et plus" : " pièces"}`}, ${x.mb ? "meublé" : "vide"}${f.epoque ? `, immeuble ${EPOQUES[f.epoque].toLowerCase()}` : ""} : référence ${fmt1(x.r.ref)} €/m², plafond ${fmt1(x.r.max)} €/m² (${x.r.annee})`);
    if (x.capSrc === "annonce") facts.push(`Plafond indiqué dans l’annonce : ${fmt1(f.refMaj)} €/m²`);
    if (f.complement) facts.push(`Complément de loyer annoncé : ${eur(f.complement)} par mois. Il doit être justifié par des atouts exceptionnels${f.dpe === "F" || f.dpe === "G" ? " et il est interdit ici, le DPE étant " + f.dpe : ""}.`);
    if (x.r.zone === "paris" && f.refMaj == null) facts.push("L’annonce ne cite pas le loyer de référence majoré, pourtant obligatoire à Paris.");
    enc = `<section class="lsec"><h2>Encadrement des loyers</h2>${head}
      ${facts.length ? `<ul class="price__facts">${facts.map(t => `<li>${t}</li>`).join("")}</ul>` : ""}
      ${x.verdict === "over" ? `<p class="hint2">Un loyer au-dessus du plafond se conteste, même après la signature : demandez la mise en conformité au propriétaire, puis saisissez la commission départementale de conciliation.</p>` : ""}
      <p class="hint2"><a class="link" href="${SIMU_LOYER}" target="_blank" rel="noopener noreferrer">Simulateur officiel de l’encadrement ↗</a></p></section>`;
  } else if (x.r) {
    enc = `<section class="lsec"><h2>Le loyer</h2><div class="rentv"><b>${x.ppmHC || f.price && f.surface ? `${fmt1(f.price / f.surface)} €/m² charges comprises` : "Loyer à comparer"}</b><span>Loyers d’annonce à ${esc(x.r.name)} : ${fmt1(x.r.lo)} à ${fmt1(x.r.hi)} €/m², ${x.r.annee}. Pas d’encadrement dans cette commune.</span></div></section>`;
  }
  // Coût d'entrée
  const fee = x.part ? 0 : f.agencyFee != null ? f.agencyFee : x.feeMax, dep = f.deposit != null ? f.deposit : x.depMax;
  const rows = [["Premier loyer", x.cc, "charges comprises"], ["Dépôt de garantie", dep, f.deposit != null ? "indiqué dans l’annonce" : x.depMax ? `au plus ${x.mb ? "deux mois" : "un mois"} hors charges` : "inconnu"],
    ["Frais d’agence", fee, x.part ? "particulier : aucun" : f.agencyFee != null ? "indiqués dans l’annonce" : x.feeMax ? "au plus, plafond légal" : "inconnus"]];
  const tot = rows.reduce((a, [, v]) => a + (v || 0), 0);
  const entry = x.cc ? `<section class="lsec"><h2>Coût d’entrée</h2>
      <div class="cost"><b class="num">${f.deposit == null || (!x.part && f.agencyFee == null) ? "≤ " : ""}${eur(tot)}</b><span>à payer à la signature</span></div>
      <dl class="cost__leg">${rows.map(([n, v, t]) => `<div><dt>${n}<small> · ${t}</small></dt><dd class="num">${v != null ? eur(v) : "–"}</dd></div>`).join("")}</dl>
      ${lo.colocs > 1 ? `<p class="hint2">Partagé entre ${lo.colocs} colocataires : ${eur(x.cc / lo.colocs)} de loyer et ${eur(tot / lo.colocs)} à l’entrée par personne.</p>` : ""}
</section>` : "";
  // Taux d'effort
  let eff = "";
  if (x.cc) {
    const need = x.cc * 3;
    if (lo.revenus > 0) {
      const t = x.cc / lo.revenus, pct = Math.round(t * 100), cls = t <= .33 ? "ok" : t <= .4 ? "mid" : "over";
      eff = `<section class="lsec"><h2>Taux d’effort</h2>
        <div class="effort effort--${cls}"><b class="num">${pct} %</b><span>${cls === "ok" ? "Le loyer fait moins d’un tiers de vos revenus : le dossier passe chez la plupart des propriétaires." : cls === "mid" ? "Un peu au-dessus du tiers : souvent accepté avec un garant ou la garantie Visale." : "Au-delà de 40 % : prévoyez un garant solide, ou la garantie Visale."}</span></div>
        <div class="effort__bar" aria-hidden="true"><i style="width:${Math.min(100, pct / .6)}%"></i><em style="left:${33 / .6}%"></em></div>
        <p class="hint2">Pour ${eur(lo.revenus)} de revenus nets par mois. La règle courante : des revenus d’au moins trois fois le loyer, soit ${eur(need)}.</p></section>`;
    } else eff = `<section class="lsec"><h2>Taux d’effort</h2><p class="hint2">Les propriétaires demandent en général des revenus d’au moins trois fois le loyer, soit ${eur(need)} par mois. <button class="link" type="button" id="revEdit">Indiquez vos revenus</button> pour savoir si votre dossier passe.</p></section>`;
  }
  // Points de vigilance
  const al = [];
  if (f.dpe === "G") al.push(["over", "DPE G : ce logement n’est plus considéré comme décent et ne peut plus être loué depuis 2025."]);
  else if (f.dpe === "F") al.push(["mid", "DPE F : il ne pourra plus être loué à partir de 2028, et son loyer ne peut pas augmenter."]);
  if (x.surf && x.surf < 9) al.push(["over", "Moins de 9 m² : en dessous de la surface minimale d’un logement décent."]);
  if (f.deposit != null && x.depMax && f.deposit > x.depMax + 1) al.push(["over", `Dépôt de garantie de ${eur(f.deposit)} : le maximum légal est ${eur(x.depMax)} (${x.mb ? "deux mois" : "un mois"} de loyer hors charges).`]);
  if (!x.part && f.agencyFee != null && x.feeMax && f.agencyFee > x.feeMax + 1) al.push(["over", `Frais d’agence de ${eur(f.agencyFee)} : le plafond est d’environ ${eur(x.feeMax)} pour ${fmtInt(x.surf)} m².`]);
  if (x.verdict === "over") al.push(["over", `Loyer au-dessus du plafond de l’encadrement, d’environ ${eur(x.over)} par mois.`]);
  if (f.complement && (f.dpe === "F" || f.dpe === "G")) al.push(["over", "Complément de loyer interdit pour un logement classé F ou G."]);
  if (x.mb) al.push(["info", "Meublé : la loi impose un équipement minimum (literie, plaques, four ou micro-ondes, frigo avec congélateur, vaisselle, rangements, luminaires, rideaux dans les chambres). À vérifier à la visite."]);
  if (lo.colocs > 1) al.push(["info", "Colocation : avec un bail unique et une clause de solidarité, chacun répond de tout le loyer, jusqu’à six mois après son départ si personne ne le remplace. Avec des baux séparés, chaque chambre doit faire au moins 9 m²."]);
  const vig = al.length ? `<section class="lsec" data-open><h2>Points de vigilance</h2><ul class="vig">${al.map(([c, t]) => `<li class="vig--${c}">${t}</li>`).join("")}</ul></section>` : "";
  return enc + entry + eff + vig + tripsHTML(f);
}
function analysisHTML(f) {
  if (kindOf(f) === "location") return rentAnalysisHTML(f);
  const c = monthlyCost(f), com = commutes(f);
  const eur = v => fmtInt(Math.round(v)) + "&#8239;€";
  return `<section class="lsec" id="lfair"><h2>Le juste prix</h2><p class="hint2">Recherche des ventes comparables…</p></section>
    ${c ? `<section class="lsec"><h2>Coût réel par mois</h2>
      <div class="cost"><b class="num">≈ ${eur(c.total)}</b><span>par mois, tout compris</span></div>
      <div class="cost__bar">${c.parts.map(([, v, col]) => `<i style="flex:${v};background:${col}"></i>`).join("")}</div>
      <dl class="cost__leg">${c.parts.map(([n, v, col]) => `<div><dt><i style="background:${col}"></i>${n}${n === "Taxe foncière" && c.taxeEst ? " (estimée)" : n === "Énergie" ? " (selon DPE)" : ""}</dt><dd class="num">${eur(v)}</dd></div>`).join("")}</dl>
      <p class="hint2">Prêt de ${eur(c.pret)} sur ${c.fin.duree} ans à ${String(c.fin.taux).replace(".", ",")} %, frais de notaire de ${eur(c.notaire)}, apport ${c.apportDefault ? "supposé de 10 %" : "de " + eur(c.apport)}. <button class="link" type="button" id="finEdit">Modifier</button></p>
    </section>` : ""}
    ${com.length ? `<section class="lsec"><h2>Vos trajets</h2><div class="trips">${com.map(({p, min}) => `<a class="trip" href="https://www.google.com/maps/dir/?api=1&origin=${f.lat},${f.lng}&destination=${p.lat},${p.lng}&travelmode=${MODES[p.mode || "tc"][3]}" target="_blank" rel="noopener noreferrer">
        <b class="num">${min} min</b><span>${esc(p.label || p.q)} · ${MODES[p.mode || "tc"][0].toLowerCase()}</span><em>Itinéraire ↗</em></a>`).join("")}</div>
      <p class="hint2">Estimation d’après la distance${f.precise ? "" : " et une position approximative"}. Touchez un trajet pour l’itinéraire exact.</p></section>` : ""}`;
}
function fairHTML(f, cmp, ng) {
  if (f.viager) return `<h2>Le juste prix</h2><p class="hint2">Viager${f.viager === "occupe" ? " occupé" : f.viager === "libre" ? " libre" : ""} : le prix affiché est le bouquet${f.rente ? `, plus une rente de ${fmtInt(f.rente)} € par mois` : ""}. La comparaison au prix du m² ne s’applique pas.</p>`;
  const ppm = f.price && f.surface ? f.price / f.surface : null;
  if (!cmp) return `<h2>Le juste prix</h2><p class="hint2">${f.lat ? "Pas assez de ventes comparables autour pour juger le prix." : "Placez l’annonce sur la carte (code postal ou métro) pour la comparer aux ventes du quartier."}</p>`;
  const lo = Math.min(cmp.lo, ppm || cmp.lo), hi = Math.max(cmp.hi, ppm || cmp.hi), span = hi - lo || 1, pos = v => ((v - lo) / span * 100).toFixed(1);
  const verdictTxt = ng && ng.ecart != null ? (ng.ecart > 0.08 ? "Au-dessus du marché" : ng.ecart < -0.05 ? "Sous le marché" : "Dans le marché") : "";
  return `<h2>Le juste prix</h2>
    <div class="fair">
      <div><span class="label">Estimation</span><b class="num">${f.surface ? fmtInt(Math.round(cmp.med * f.surface / 5000) * 5) + "&#8239;k€" : fmtInt(cmp.med) + "&#8239;€/m²"}</b><small class="num">${fmtInt(cmp.med)}&#8239;€/m² médian</small></div>
      <div><span class="label">Annonce</span><b class="num">${f.price ? fmtInt(f.price / 1000) + "&#8239;k€" : "–"}</b><small class="num">${ppm ? fmtInt(ppm) + "&#8239;€/m²" : ""}</small>${verdictTxt ? `<em class="verd verd--${ng.ecart > 0.08 ? "haut" : ng.ecart < -0.05 ? "bas" : "ok"}">${verdictTxt}</em>` : ""}</div>
    </div>
    <div class="strip" aria-label="Prix au m² des ventes comparables">
      <span class="strip__iq" style="left:${pos(cmp.q1)}%;width:${(pos(cmp.q3) - pos(cmp.q1)).toFixed(1)}%"></span>
      ${cmp.all.map(x => `<i style="left:${pos(x.pa)}%"></i>`).join("")}
      ${ppm ? `<b class="strip__me${pos(ppm) > 88 ? " strip__me--fin" : pos(ppm) < 12 ? " strip__me--debut" : ""}" style="left:${pos(ppm)}%"><span class="num">${fmtInt(ppm)}</span></b>` : ""}
    </div>
    <div class="strip__ax num"><span>${fmtInt(lo)}</span><span>€/m²</span><span>${fmtInt(hi)}</span></div>
    <p class="hint2">${cmp.n} ventes d’appartements${f.surface ? " de taille proche" : ""} à moins de ${fmtInt(Math.round(cmp.R / 50) * 50)} m, sur 3 ans${cmp.adj ? ", ramenées aux prix d’aujourd’hui" : ""}. La bande montre la moitié centrale.</p>
    <ul class="comps">${cmp.near.map(x => `<li><span class="num">${fmtDist(x.d)}</span><span class="num">${fmtInt(x.s)} m²</span><span>${esc(monthLabel(x.m))}</span><b class="num">${fmtInt(x.pa)}&#8239;€/m²</b></li>`).join("")}</ul>
    ${ng ? `<div class="nego"><div><span class="label">Offre de départ envisageable</span><b class="num">${fmtInt(ng.offer)}&#8239;€</b><small class="num">−${Math.round(ng.m * 100)} % sur le prix affiché</small></div>
      <ul class="lwhy">${ng.why.map(w => `<li>${esc(w)}</li>`).join("")}</ul><p class="hint2">Indicatif.</p></div>` : ""}`;
}
async function paintFair(f) {
  const el = $("#lfair"); if (!el) return;
  let cmp = null; try { cmp = await comparables(f); } catch (e) {}
  const el2 = $("#lfair"); if (!el2 || lui.openId !== f.id) return;
  el2.innerHTML = fairHTML(f, cmp, negotiation(f, cmp));
  foldSections(el2.parentElement);
}
function openFinance() {
  const fin = finance(), h = homeProfile();
  let el = $("#lsheet");
  if (!el) { el = document.createElement("div"); el.id = "lsheet"; el.className = "auth"; el.innerHTML = `<div class="auth__veil" data-lclose></div><div class="auth__card lsheet" role="dialog" aria-modal="true" aria-labelledby="lsTitle"></div>`; document.body.appendChild(el); }
  const card = el.querySelector(".lsheet"), closeSheet = () => { el.classList.remove("is-open"); setTimeout(() => { el.hidden = true; }, 200); };
  el.onclick = e => { if (e.target.closest("[data-lclose]")) closeSheet(); };
  card.innerHTML = `<div class="auth__head"><h2 id="lsTitle">Votre financement</h2><button class="x" type="button" data-lclose aria-label="Fermer"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <form class="lform" id="finF">
      <label class="lf"><span>Apport</span><input name="apport" inputmode="numeric" value="${fin.apport ?? ""}" placeholder="10 % si vide"></label>
      <label class="lf"><span>Taux du prêt (%)</span><input name="taux" inputmode="decimal" value="${String(fin.taux).replace(".", ",")}"></label>
      <label class="lf"><span>Durée (années)</span><input name="duree" inputmode="numeric" value="${fin.duree}"></label>
    </form>
    <div class="auth__foot"><button class="btn btn--primary btn--block" type="button" id="finSave">Enregistrer</button></div>`;
  $("#finSave").onclick = () => {
    const fd = new FormData($("#finF")), a = numFR(fd.get("apport")), t = numFR(fd.get("taux")), d = numFR(fd.get("duree"));
    h.fin = {apport: a > 0 ? a : null, taux: t > 0 && t < 15 ? t : 3.4, duree: d >= 5 && d <= 30 ? Math.round(d) : 25};
    save(); closeSheet(); renderListings();
  };
  el.hidden = false; requestAnimationFrame(() => el.classList.add("is-open"));
}
function openRentSettings() {
  const h = homeProfile(), lo = h.loc;
  let el = $("#lsheet");
  if (!el) { el = document.createElement("div"); el.id = "lsheet"; el.className = "auth"; el.innerHTML = `<div class="auth__veil" data-lclose></div><div class="auth__card lsheet" role="dialog" aria-modal="true" aria-labelledby="lsTitle"></div>`; document.body.appendChild(el); }
  const card = el.querySelector(".lsheet"), closeSheet = () => { el.classList.remove("is-open"); setTimeout(() => { el.hidden = true; }, 200); };
  el.onclick = e => { if (e.target.closest("[data-lclose]")) closeSheet(); };
  card.innerHTML = `<div class="auth__head"><h2 id="lsTitle">Votre location</h2><button class="x" type="button" data-lclose aria-label="Fermer"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <form class="lform" id="locF">
      <label class="lf"><span>Loyer maximum, charges comprises</span><input name="loyerMax" inputmode="numeric" value="${lo.loyerMax ?? ""}" placeholder="€ par mois"></label>
      <label class="lf"><span>Revenus nets du foyer</span><input name="revenus" inputmode="numeric" value="${lo.revenus ?? ""}" placeholder="€ par mois"></label>
      <label class="lf"><span>Colocataires, vous compris</span><select name="colocs">${[1, 2, 3, 4, 5, 6].map(v => `<option value="${v}" ${(lo.colocs || 1) === v ? "selected" : ""}>${v === 1 ? "Pas de colocation" : v}</option>`).join("")}</select></label>
      <label class="lf"><span>Meublé ou vide</span><select name="meuble">${[["indiff", "Peu importe"], ["vide", "Vide"], ["meuble", "Meublé"]].map(([v, l]) => `<option value="${v}" ${lo.meuble === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    </form>
    <div class="auth__foot"><button class="btn btn--primary btn--block" type="button" id="locSave">Enregistrer</button></div>`;
  $("#locSave").onclick = () => {
    const fd = new FormData($("#locF")), m = numFR(fd.get("loyerMax")), r = numFR(fd.get("revenus"));
    h.loc = {loyerMax: m > 0 ? Math.round(m) : null, revenus: r > 0 ? Math.round(r) : null, meuble: fd.get("meuble") || "indiff", colocs: +fd.get("colocs") || 1};
    save(); closeSheet(); rerenderAll(); if (currentTab === "profile") renderProfile();
  };
  el.hidden = false; requestAnimationFrame(() => el.classList.add("is-open"));
}

/* ---------- Annonces sur la carte ---------- */
let listingLayer = null;
function renderListingPins() {
  if (!listingLayer) {
    listingLayer = L.layerGroup().addTo(map);
    map.on("zoomend", () => currentTab === "map" && renderListingPins());
    map.on("popupclose", () => { $$(".lpin.is-on").forEach(x => x.classList.remove("is-on")); });
  }
  listingLayer.clearLayers();
  if (mapFilter.annonces === false) return;
  queuePlace(modeListings().filter(f => !f.lat && f.status !== "ecartee"));
  // seules les annonces en favori sont sur la carte. Proches à l'écran : une pastille groupée (nombre, meilleure note).
  // Même au plus près, deux annonces placées au même point (par leur code postal) restent groupées : la pastille ouvre leur liste.
  const pts = modeListings().filter(f => f.lat && isKept(f)), z = map.getZoom(), near = [];
  for (const f of pts) {
    const p = map.project([f.lat, f.lng], z), g = near.find(([c]) => c.distanceTo(p) < (z < 16 ? 46 : 16));
    if (g) { g[1].push(f); g[0] = g[0].multiplyBy(g[1].length - 1).add(p).divideBy(g[1].length); } else near.push([p, [f]]);
  }
  for (const [, g] of near) {
    const lat = g.reduce((a, f) => a + f.lat, 0) / g.length, lng = g.reduce((a, f) => a + f.lng, 0) / g.length;
    if (g.length > 1) {
      const rel = g.map(f => scoreListing(f)).filter(x => x.reliable), best = rel.length ? Math.max(...rel.map(x => x.total)) : null;
      const mk = L.marker([lat, lng], {zIndexOffset: 600, keyboard: true, title: `${g.length} favoris`,
        icon: L.divIcon({className: "", iconSize: null, html: `<span class="lpin lpin--grp" style="--c:${colorFor(best)}"><b class="num">${g.length}</b></span>`})});
      mk.on("click", () => {
        const b = L.latLngBounds(g.map(f => [f.lat, f.lng])), wide = map.project(b.getNorthEast(), z).distanceTo(map.project(b.getSouthWest(), z));
        // assez écartées pour se séparer en zoomant : on zoome ; sinon (même point, ou déjà au plus près) : la liste
        if (wide > 8 && z < 17) map.flyToBounds(b.pad(0.5), {maxZoom: 17, duration: .5});
        else openPinPopup([lat, lng], g, mk);
      });
      mk.addTo(listingLayer);
    } else {
      const f = g[0], s = scoreListing(f);
      const mk = L.marker([f.lat, f.lng], {zIndexOffset: 500, keyboard: true, title: f.title || listingTitle(f), icon: L.divIcon({className: "", iconSize: null,
        html: `<span class="lpin${f.precise ? "" : " lpin--approx"}${trustSignals(f, s).level === "fort" ? " lpin--scam" : ""}" style="--c:${noteCol(s)}" data-pin="${f.id}">${trustSignals(f, s).level === "fort" ? `<i class="lpin__scam" aria-label="Annonce suspecte">${svgI(PIC.alerte, 14)}</i>` : ""}<b class="lpin__s num">${noteTxt(s)}</b><em class="num">${f.price ? (kindOf(f) === "location" ? fmtInt(f.price) + "&#8239;€" : f.price >= 1e6 ? String(Math.round(f.price / 1e5) / 10).replace(".", ",") + "&#8239;M€" : Math.round(f.price / 1000) + "&#8239;k€") : ""}</em></span>`})});
      mk.on("click", () => openPinPopup([f.lat, f.lng], [f], mk));
      mk.addTo(listingLayer);
    }
  }
}
/* Popup d'une pastille : les photos et la note ; pour un groupe, la liste des favoris à cet endroit */
function pinCardHTML(f, back) {
  const s = scoreListing(f), ph = (f.photos || []).slice(0, 12), why = s.fails.length ? ["Hors critères : " + s.fails[0]] : !s.reliable && s.need.length ? [`À compléter : ${s.need.join(", ")}`] : s.plus.slice(0, 2);
  return `<div class="mpop" data-id="${f.id}">
    ${back ? `<button class="mpop__back" type="button" data-back>‹ ${esc(back)}</button>` : ""}
    <div class="mpop__ph">${ph.length ? `<div class="mpop__track">${ph.map((u, i) => `<img src="${esc(u)}" alt="" ${i > 1 ? 'loading="lazy"' : ""} referrerpolicy="no-referrer" onerror="this.remove()">`).join("")}</div>` : `<div class="mpop__none">${GALETS}</div>`}
      <b class="mpop__s num" style="--c:${noteCol(s)}"${s.reliable ? "" : ` title="Pas assez d’infos pour une note fiable"`}>${noteTxt(s)}</b>
      ${ph.length > 1 ? `<span class="mpop__n num"><span data-i>1</span>/${ph.length}</span><button class="mpop__nav mpop__nav--p" type="button" data-nav="-1" aria-label="Photo précédente">‹</button><button class="mpop__nav mpop__nav--n" type="button" data-nav="1" aria-label="Photo suivante">›</button>` : ""}
    </div>
    <div class="mpop__b">
      <h3>${esc(f.title || listingTitle(f))}</h3>
      <p class="mpop__p num">${f.price ? priceTxt(f) : "Prix ?"}${s.ppm ? ` <small>${ppmTxt(f)}</small>` : ""}</p>
      ${why.length ? `<ul class="mpop__why">${why.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      <div class="mpop__acts"><button class="btn btn--sm btn--primary" type="button" data-open>Voir la fiche</button>${f.status === "visite" ? `<span class="mpop__tag">${ICO.visit}Visite prévue</span>` : ""}<button class="mpop__fav" type="button" data-unfav aria-pressed="true" aria-label="Retirer des favoris" title="Retirer des favoris">${ICO.keep}</button></div>
    </div>
  </div>`;
}
function pinListHTML(fs) {
  return `<div class="mpop mpop--grp"><p class="mpop__h">${plural(fs.length, "favori à cet endroit", "favoris à cet endroit")}</p><ul class="mpop__list">${fs.map(f => { const s = scoreListing(f), ph = (f.photos || [])[0];
    return `<li><button type="button" data-pick="${f.id}"><span class="mpop__th">${ph ? `<img src="${esc(ph)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</span><span class="mpop__lt"><b>${esc(f.title || listingTitle(f))}</b><small class="num">${f.price ? priceTxt(f) : ""}</small></span><i class="num" style="--c:${noteCol(s)}">${noteTxt(s)}</i></button></li>`; }).join("")}</ul></div>`;
}
function openPinPopup(ll, fs, mk) {
  $$(".lpin.is-on").forEach(x => x.classList.remove("is-on"));
  const el = mk && mk.getElement && mk.getElement(), pin = el && el.querySelector(".lpin"); if (pin) pin.classList.add("is-on");
  const pop = L.popup({className: "mpop-wrap", maxWidth: 300, minWidth: 260, autoPanPaddingTopLeft: [16, 84], autoPanPaddingBottomRight: [68, 24], offset: [0, fs.length > 1 ? -18 : -32], closeButton: true})
    .setLatLng(ll).setContent(fs.length > 1 ? pinListHTML(fs) : pinCardHTML(fs[0])).openOn(map);
  const bind = () => {
    const root = pop.getElement(); if (!root) return;
    // un clic dans le popup ne doit jamais atteindre la carte (il y commencerait une zone), même quand le contenu change
    if (!root.__stop) { root.__stop = true; ["click", "pointerdown", "mousedown", "touchstart", "dblclick"].forEach(t => root.addEventListener(t, e => e.stopPropagation())); }
    const tr = root.querySelector(".mpop__track"), ni = root.querySelector("[data-i]");
    if (tr && ni) tr.addEventListener("scroll", () => { ni.textContent = Math.round(tr.scrollLeft / tr.clientWidth) + 1; }, {passive: true});
    root.querySelectorAll("[data-nav]").forEach(b => b.onclick = e => { e.stopPropagation(); tr.scrollBy({left: +b.dataset.nav * tr.clientWidth, behavior: "smooth"}); });
    const card = root.querySelector(".mpop[data-id]"), f = card && listings().find(x => x.id === card.dataset.id);
    const op = root.querySelector("[data-open]"); if (op && f) op.onclick = () => { map.closePopup(); lui.openId = f.id; lui.feed = f.origin === "vivier" ? "explorer" : "mes"; setTab("favoris"); };
    const uf = root.querySelector("[data-unfav]"); if (uf && f) uf.onclick = () => { map.closePopup(); setStatus(f, "nouvelle", () => {}); };
    root.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => { const g = listings().find(x => x.id === b.dataset.pick); if (g) setTimeout(() => { pop.setContent(pinCardHTML(g, plural(fs.length, "favori ici", "favoris ici"))); bind(); }, 0); });
    const bk = root.querySelector("[data-back]"); if (bk) bk.onclick = () => setTimeout(() => { pop.setContent(pinListHTML(fs)); bind(); }, 0);
  };
  bind();
}


/* Démarrage */
renderZones();
setTab(/profil/.test(location.hash) ? "profile" : /favoris/.test(location.hash) ? "favoris" : /annonces|import=/.test(location.hash) ? "annonces" : "map");
cloudInit();
refreshEstimates();
maybeAutoQuiz();
window.__heden = {state: () => state, plan: () => planLayer, parseListing, extractCards, bookmarkletCode, score: f => scoreListing(f), scoreOf, colorFor, cloud: () => cloud, save, startNew, addPoint, estimate, map, toast, openQuiz, applySetup, toastAvoid: TOAST_AVOID};
