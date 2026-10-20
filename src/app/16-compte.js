/* =========================================================
   Compte et synchronisation (Supabase)
   - connexion par e-mail : lien magique ou code à 6 chiffres
   - la carte perso est créée au premier passage
   - les zones déjà saisies sur l'appareil sont reprises une seule fois
   - chaque modification est envoyée par différence (zone, note, profil)
   ========================================================= */
const CFG = window.HEDEN_CONFIG || {};
const cloudReady = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase && window.supabase.createClient);
const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || "");

function zoneRow(z) {
  return {id: z.id, map_id: z.mapId || cloud.mapId, created_by: z.createdBy || cloud.user.id, name: z.name || "", place: z.place || "",
    points: z.points, lat: z.lat ?? null, lng: z.lng ?? null, area: z.area ?? null, perimeter: z.perimeter ?? null, estimates: z.est || null, cover_photo: z.cover || null};
}
function ratingRow(z) {
  return {zone_id: z.id, user_id: cloud.user.id, ratings: z.ratings || {}, fav: !!z.fav, comment: z.comment || "",
    visit_date: z.date || null, moment: z.moment || "", price: z.price ?? null};
}
// Base pas encore migrée (supabase/annonces.sql) : on garde annonces et critères sur l'appareil
const schemaMissing = e => !!e && (/^(PGRST20[45]|42P01|42703)$/.test(e.code || "") || /schema cache|does not exist/i.test(e.message || ""));
function profileRow() {
  const p = state.profile;
  const row = {id: cloud.user.id, display_name: p.name || "", preset_id: p.presetId || null, modified: !!p.modified, budget: p.budget ?? null, criteria: p.criteria || [], half_points: !!p.halfPoints};
  if (!cloud.noHome) row.home = p.home || null;
  return row;
}
function listingRow(f) {
  const data = {}; Object.keys(f).forEach(k => { if (!["id", "status", "lat", "lng", "mapId", "createdBy", "url"].includes(k)) data[k] = f[k]; });
  return {id: f.id, map_id: f.mapId || cloud.mapId, created_by: f.createdBy || cloud.user.id, url: f.url || "", status: f.status || "nouvelle", lat: f.lat ?? null, lng: f.lng ?? null, data};
}
const listingFromRow = r => Object.assign({}, r.data || {}, {id: r.id, mapId: r.map_id, createdBy: r.created_by, url: r.url, status: r.status, lat: r.lat, lng: r.lng});
function snapshot() {
  const zones = {}, lst = {};
  if (!cloud.noListings) for (const f of state.listings || []) if (isUuid(f.id)) lst[f.id] = JSON.stringify(listingRow(f));
  for (const z of state.zones) {
    if (z.example || !isUuid(z.id) || !Array.isArray(z.points)) continue;
    zones[z.id] = {zone: JSON.stringify(zoneRow(z)), rating: JSON.stringify(ratingRow(z))};
  }
  return {zones, listings: lst, profile: JSON.stringify(profileRow())};
}
/* Fusion à trois : base (dernier état synchronisé), local, serveur. Les champs changés ici gagnent, les autres suivent le serveur :
   deux personnes qui modifient la même annonce (l'une la garde, l'autre la note) ne s'écrasent plus. */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function merge3(base, mine, srv) {
  const out = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(srv)])) {
    const v = k === "data" && mine.data && srv.data ? merge3(base.data || {}, mine.data, srv.data) : !same(mine[k], base[k]) ? mine[k] : srv[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}
// lignes à envoyer, fusionnées avec ce qui a changé sur le serveur depuis la dernière synchro ; les lignes supprimées ailleurs restent supprimées
async function mergeWithServer(table, rows, baseOf) {
  const based = rows.filter(r => baseOf(r.id));
  if (!based.length) return {rows, gone: []};
  const {data, error} = await cloud.client.from(table).select("*").in("id", based.map(r => r.id));
  if (error) throw error;
  const srv = new Map((data || []).map(r => [r.id, r])), gone = [];
  const out = rows.flatMap(r => {
    const b = baseOf(r.id); if (!b) return [r];
    const sv = srv.get(r.id); if (!sv) { gone.push(r.id); return []; }
    const m = merge3(b, r, sv); delete m.created_at; return [m];
  });
  return {rows: out, gone};
}

function hasPending() {
  if (!cloud.user) return false;
  const cur = snapshot(), prev = cloud.synced || {zones: {}, profile: null};
  if (cur.profile !== prev.profile) return true;
  if (Object.keys(prev.zones).some(id => !cur.zones[id])) return true;
  const pl = prev.listings || {};
  if (Object.keys(pl).some(id => !cur.listings[id]) || Object.entries(cur.listings).some(([id, v]) => pl[id] !== v)) return true;
  return Object.entries(cur.zones).some(([id, v]) => !prev.zones[id] || prev.zones[id].zone !== v.zone || prev.zones[id].rating !== v.rating);
}
function setCloudStatus(st, err) {
  cloud.status = st; cloud.error = err ? (err.message || String(err)) : "";
  const el = document.getElementById("syncState"); if (el) el.textContent = syncLabel();
  const el2 = document.getElementById("syncState2"); if (el2) el2.textContent = syncLabel();
  renderAccountChip();
  const al = document.querySelector(".acct-line"); if (al && cloud.user) { al.className = "acct-line " + (st === "error" ? "err" : "on"); al.querySelector("span").textContent = accountShort(); }
}
function accountShort() {
  if (!cloud.user) return "";
  if (cloud.status === "sync") return "Synchronisation…";
  if (cloud.status === "error") return "Connecté, synchronisation en attente";
  return "Connecté, " + (cloud.user.email || "");
}
function renderAccountChip() {
  const b = document.getElementById("acct"); if (!b) return;
  if (!cloudReady) { b.hidden = true; return; }
  b.hidden = false;
  b.className = "acct" + (cloud.user ? (cloud.status === "error" ? " err" : " on") : "");
  b.innerHTML = `<i></i><span>${cloud.user ? esc(cloud.user.email || "Connecté") : "Se connecter"}</span>`;
  b.title = cloud.user ? "Compte connecté : vos zones sont synchronisées" : "Se connecter pour retrouver ses zones sur tous ses appareils";
}
function syncLabel() {
  if (!cloud.user) return "";
  if (cloud.status === "sync") return "Synchronisation…";
  if (cloud.status === "error") return navigator.onLine === false ? "Hors ligne : vos modifications seront envoyées au retour du réseau." : "Synchronisation interrompue, nouvel essai dans quelques secondes.";
  if (cloud.lastSync) return "Synchronisé à " + cloud.lastSync.toLocaleTimeString("fr-FR", {hour: "2-digit", minute: "2-digit"}) + ".";
  return "Connecté.";
}
function scheduleSync(delay = 700) {
  if (!cloud.user) return;
  clearTimeout(cloud.timer);
  cloud.timer = setTimeout(syncNow, delay);
}
async function syncNow() {
  if (!cloud.user) return;
  if (cloud.busy) { cloud.again = true; return; }
  cloud.busy = true; setCloudStatus("sync");
  const c = cloud.client, cur = snapshot();
  const prev = cloud.synced ? JSON.parse(JSON.stringify(cloud.synced)) : {zones: {}, profile: null};
  try {
    if (cur.profile !== prev.profile) {
      let {error} = await c.from("profiles").upsert(Object.assign(JSON.parse(cur.profile), {updated_at: new Date().toISOString()}));
      if (error && !cloud.noHome && schemaMissing(error)) {
        cloud.noHome = true; cur.profile = JSON.stringify(profileRow());
        ({error} = await c.from("profiles").upsert(Object.assign(JSON.parse(cur.profile), {updated_at: new Date().toISOString()})));
      }
      if (error) throw error;
      prev.profile = cur.profile;
    }
    const zUp = [], rUp = [];
    for (const [id, v] of Object.entries(cur.zones)) {
      const old = prev.zones[id] || {};
      if (v.zone !== old.zone) zUp.push(JSON.parse(v.zone));
      if (v.rating !== old.rating) rUp.push(Object.assign(JSON.parse(v.rating), {updated_at: new Date().toISOString()}));
    }
    const dels = Object.keys(prev.zones).filter(id => !cur.zones[id]);
    if (zUp.length) {
      const mz = await mergeWithServer("zones", zUp, id => prev.zones[id] && JSON.parse(prev.zones[id].zone));
      mz.gone.forEach(id => { state.zones = state.zones.filter(z => z.id !== id); delete cur.zones[id]; });
      const now = new Date().toISOString();
      const {error} = mz.rows.length ? await c.from("zones").upsert(mz.rows.map(r => Object.assign(r, {updated_at: now}))) : {}; if (error) throw error;
      mz.rows.forEach(r => { const z = state.zones.find(x => x.id === r.id); if (!z) return;
        Object.assign(z, {name: r.name, place: r.place, points: r.points, est: r.estimates || null, cover: r.cover_photo || null}); finishZoneGeometry(z);
        cur.zones[r.id].zone = JSON.stringify(zoneRow(z)); });
      if (mz.gone.length) { rerenderAll(); renderPanel(); }
    }
    if (rUp.length) { const {error} = await c.from("ratings").upsert(rUp); if (error) throw error; }
    await syncTwins(rUp);
    if (dels.length) { const {error} = await c.from("zones").delete().in("id", dels); if (error) throw error; }
    const pl = prev.listings || {}, lDel = Object.keys(pl).filter(id => !cur.listings[id]);
    let lUp = Object.entries(cur.listings).filter(([id, v]) => pl[id] !== v).map(([, v]) => JSON.parse(v));
    if (lUp.length && !cloud.noListings) {
      const ml = await mergeWithServer("listings", lUp, id => pl[id] && JSON.parse(pl[id]));
      ml.gone.forEach(id => { state.listings = listings().filter(f => f.id !== id); delete cur.listings[id]; });
      const now = new Date().toISOString();
      lUp = ml.rows.map(r => Object.assign(r, {updated_at: now}));
      lUp.forEach(r => { const i = listings().findIndex(f => f.id === r.id); if (i < 0) return;
        const f = Object.assign(listingFromRow(r), {updatedAt: listings()[i].updatedAt}); state.listings[i] = f; cur.listings[r.id] = JSON.stringify(listingRow(f)); });
      if (ml.gone.length && currentTab === "annonces") renderListings();
    }
    if (lUp.length) {
      const {error} = await c.from("listings").upsert(lUp);
      if (error && schemaMissing(error)) { cloud.noListings = true; cur.listings = {}; }
      else if (error) throw error;
    }
    if (lDel.length) { const {error} = await c.from("listings").delete().in("id", lDel); if (error) throw error; }
    cloud.synced = cur; cloud.lastSync = new Date();
    try { localStorage.setItem("heden.cache." + cloud.user.id, JSON.stringify({state, synced: cloud.synced, mapId: cloud.mapId})); } catch (e) {}
    setCloudStatus("ok");
  } catch (err) {
    console.warn("Heden : synchronisation", err);
    setCloudStatus("error", err);
    clearTimeout(cloud.timer); cloud.timer = setTimeout(syncNow, 15000);
  } finally {
    cloud.busy = false;
    if (cloud.again) { cloud.again = false; scheduleSync(200); }
  }
}

function zoneFromRow(row) {
  const me = cloud.user.id;
  const rs = row.ratings || [];
  const mine = rs.find(r => r.user_id === me) || {};
  return finishZoneGeometry({
    id: row.id, mapId: row.map_id, createdBy: row.created_by, name: row.name, place: row.place, points: row.points, est: row.estimates || null, cover: row.cover_photo || null, link: row.link_zone || null,
    ratings: mine.ratings || {}, fav: !!mine.fav, comment: mine.comment || "", date: mine.visit_date || "", moment: mine.moment || "",
    price: mine.price == null ? null : Number(mine.price),
    author: row.created_by === me ? (state.profile.name || "") : (cloud.names[row.created_by] || ""),
    others: rs.filter(r => r.user_id !== me).map(r => ({userId: r.user_id, name: cloud.names[r.user_id] || "", ratings: r.ratings || {}, fav: !!r.fav, comment: r.comment || ""})),
    createdAt: Date.parse(row.created_at) || Date.now(), updatedAt: Date.parse(row.updated_at) || Date.now()
  });
}

async function cloudLoad() {
  const c = cloud.client, me = cloud.user.id;
  setCloudStatus("sync");
  // 1. affichage immédiat depuis le cache de ce compte
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem("heden.cache." + me) || "null"); } catch (e) {}
  const localState = state;
  if (cached && cached.state) { state = cached.state; cloud.synced = cached.synced || null; state.zones.forEach(finishZoneGeometry); }
  rerenderAll();
  try {
    // 2. carte perso
    const {data: mapId, error: e1} = await c.rpc("ensure_personal_map"); if (e1) throw e1;
    cloud.personalMapId = mapId;
    await loadMaps();
    const known = id => cloud.maps.some(m => m.id === id);
    cloud.mapId = cached && known(cached.mapId) ? cached.mapId : mapId;
    if (cloud.mapId !== mapId && !known(cloud.mapId)) cloud.mapId = mapId;
    // 3. reprise, une seule fois, des zones saisies sur cet appareil avant la connexion
    const flag = "heden.migrated." + me;
    let migrated = false;
    try { migrated = !!localStorage.getItem(flag); } catch (e) {}
    if (!migrated) {
      const toMove = (localState.zones || []).filter(z => !z.example && Array.isArray(z.points) && !z.mapId);
      for (const z of toMove) {
        const copy = Object.assign({}, z, {id: isUuid(z.id) ? z.id : zoneId(), mapId, createdBy: me});
        if (!state.zones.some(x => x.id === copy.id)) state.zones.push(copy);
      }
      const lMove = (localState.listings || []).filter(f => !f.mapId);
      lMove.forEach(f => { f.mapId = mapId; f.createdBy = me; if (!(state.listings || []).some(x => x.id === f.id)) (state.listings = state.listings || []).push(f); });
      if (!cached) state.profile = localState.profile;
      try {
        localStorage.setItem(flag, "1");
        if (toMove.length) { localStorage.setItem(KEY + ".sauvegarde", JSON.stringify(localState)); localStorage.setItem(KEY, JSON.stringify(Object.assign({}, localState, {zones: []}))); }
      } catch (e) {}
      if (toMove.length) toast(`${toMove.length} zone${toMove.length > 1 ? "s" : ""} de cet appareil ajoutée${toMove.length > 1 ? "s" : ""} à votre compte`);
    }
    // 4. envoyer d'abord ce qui attend, puis afficher la carte choisie la dernière fois
    if (hasPending()) await syncNow();
    let pref = null;
    try { pref = localStorage.getItem("heden.map." + me); } catch (e) {}
    if (pref && pref !== cloud.mapId && known(pref)) resetForMap(pref);
    setupRealtime();
    await cloudRefresh(true);
    // 5. invitation reçue par lien
    let inv = null;
    try { inv = localStorage.getItem("heden.invite"); } catch (e) {}
    if (inv) { try { localStorage.removeItem("heden.invite"); } catch (e) {} await joinWithCode(inv); }
  } catch (err) {
    console.warn("Heden : chargement du compte", err);
    setCloudStatus("error", err);
    toast("Hors connexion : vos zones restent sur cet appareil");
  }
}

/* ---------- Photos des zones (stockage privé, liens signés) ---------- */
const photoUrls = new Map();
const coverOf = z => { const ps = z.photos || []; return ps.find(p => p.id === z.cover) || ps[0] || null; };
const photoUrl = path => { const u = photoUrls.get(path); return u && u.exp > Date.now() ? u.url : null; };
async function signUrls(paths) {
  const need = [...new Set(paths.filter(p => p && !photoUrl(p)))];
  if (!need.length || !cloud.user) return false;
  const {data, error} = await cloud.client.storage.from("photos").createSignedUrls(need, 6 * 3600);
  if (error) { console.warn("Heden : photos", error); return false; }
  (data || []).forEach(d => { if (d.signedUrl) photoUrls.set(d.path, {url: d.signedUrl, exp: Date.now() + 5.5 * 3600e3}); });
  return true;
}
async function signCovers() {
  const paths = state.zones.map(coverOf).filter(Boolean).map(p => p.thumb);
  if (await signUrls(paths)) { renderZones(); if (ui.mode === "detail") paintPhotos(); }
}
async function compressImage(file, max, q) {
  let img;
  try { img = await createImageBitmap(file, {imageOrientation: "from-image"}); }
  catch (e) { img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", q));
  return {blob, w: cv.width, h: cv.height};
}
const uploads = new Map();   // zone id -> nombre de photos en cours d'envoi
/* Photo prête à envoyer : version 1600 px et vignette 360 px, préparées sur le téléphone */
async function preparePhoto(f) {
  const [full, th] = await Promise.all([compressImage(f, 1600, .82), compressImage(f, 360, .72)]);
  return {full, th, url: URL.createObjectURL(th.blob)};
}
const isImage = f => /^image\//.test(f.type) || /\.(jpe?g|png|heic|webp)$/i.test(f.name || "");
async function uploadPhotos(z, items, opts = {}) {
  items = [...items].filter(it => it.full || isImage(it));
  if (!items.length || !cloud.user) return 0;
  if (hasPending()) await syncNow();
  const target = photoZoneId(z);
  if (!z.link && (!cloud.synced || !cloud.synced.zones[z.id])) { toast("Zone pas encore enregistrée : réessayez dans un instant"); return 0; }
  uploads.set(z.id, (uploads.get(z.id) || 0) + items.length); paintPhotos();
  const st = cloud.client.storage.from("photos"); let ok = 0;
  for (const it of items) {
    let row = null;
    try {
      const {full, th} = it.full ? it : await preparePhoto(it);
      const id = zoneId(), base = `${cloud.user.id}/${target}/${id}`;
      row = {id, zone_id: target, user_id: cloud.user.id, path: base + ".jpg", thumb: base + "_t.jpg", width: full.w, height: full.h};
      let r = await cloud.client.from("zone_photos").insert(row); if (r.error) { row = null; throw r.error; }
      r = await st.upload(row.path, full.blob, {contentType: "image/jpeg", upsert: false}); if (r.error) throw r.error;
      r = await st.upload(row.thumb, th.blob, {contentType: "image/jpeg", upsert: false}); if (r.error) throw r.error;
      photoUrls.set(row.thumb, {url: URL.createObjectURL(th.blob), exp: Date.now() + 5 * 3600e3});
      photoUrls.set(row.path, {url: URL.createObjectURL(full.blob), exp: Date.now() + 5 * 3600e3});
      (z.photos = z.photos || []).push({id, zoneId: target, path: row.path, thumb: row.thumb, userId: cloud.user.id, w: full.w, h: full.h, at: new Date().toISOString()});
      ok++;
    } catch (err) {
      console.warn("Heden : envoi photo", err);
      if (row) { cloud.client.from("zone_photos").delete().eq("id", row.id).then(() => {}, () => {}); }
    }
    uploads.set(z.id, uploads.get(z.id) - 1); paintPhotos();
  }
  uploads.delete(z.id);
  save(); renderZones(); paintPhotos(); if (ui.mode === "list") renderList();
  const n = items.length;
  toast(ok === n ? (opts.done || (ok > 1 ? `${ok} photos ajoutées` : "Photo ajoutée")) : ok ? `${ok} photo${ok > 1 ? "s" : ""} sur ${n} ajoutée${ok > 1 ? "s" : ""}` : "Envoi des photos impossible pour le moment");
  return ok;
}
async function deletePhoto(z, ph) {
  try {
    await cloud.client.storage.from("photos").remove([ph.path, ph.thumb]);
    const {error} = await cloud.client.from("zone_photos").delete().eq("id", ph.id); if (error) throw error;
    z.photos = (z.photos || []).filter(p => p.id !== ph.id);
    if (z.cover === ph.id) z.cover = null;
    save(); renderZones(); paintPhotos();
    return true;
  } catch (err) { console.warn(err); toast("Suppression impossible pour le moment"); return false; }
}
function photosHTML(z) {
  if (z.example) return "";
  if (!cloudReady) return "";
  if (!cloud.user) return `<div class="photos"><span class="label">Photos</span><p class="hint2"><button class="link" type="button" data-auth>Connectez-vous</button> pour garder des photos de vos visites.</p></div>`;
  return `<div class="photos" id="photos" data-z="${z.id}"></div>`;
}
function paintPhotos() {
  const box = $("#photos"); if (!box) return;
  const z = state.zones.find(x => x.id === box.dataset.z); if (!z) return;
  const ps = z.photos || [], pending = uploads.get(z.id) || 0, cover = coverOf(z);
  box.innerHTML = `<div class="photos__head"><span class="label">Photos</span>${ps.length ? `<span class="num">${ps.length}</span>` : ""}</div>
    <div class="photos__strip">
      ${ps.map((p, i) => { const u = photoUrl(p.thumb); return `<button type="button" class="ph${cover && cover.id === p.id ? " ph--cover" : ""}" data-i="${i}" aria-label="Voir la photo ${i + 1}">${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : ""}</button>`; }).join("")}
      ${Array.from({length: pending}, () => `<span class="ph ph--wait"><i></i></span>`).join("")}
      ${ps.length || pending ? `<label class="ph ph--add"><input type="file" accept="image/*" multiple hidden><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg><span>Ajouter</span></label>` : `<label class="ph-empty"><input type="file" accept="image/*" multiple hidden><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg><span><b>Ajouter des photos du coin</b><small>Façades, rue, square : de quoi vous souvenir de l’ambiance</small></span></label>`}
    </div>`;
  box.querySelector("input").onchange = e => { const f = e.target.files; if (f && f.length) uploadPhotos(z, f); e.target.value = ""; };
  $$("[data-i]", box).forEach(b => b.onclick = () => openViewer(z, +b.dataset.i));
  const miss = ps.map(p => p.thumb).filter(t => !photoUrl(t));
  if (miss.length) signUrls(miss).then(okk => { if (okk) paintPhotos(); });
}
/* Photos dans le panneau de notation : envoyées tout de suite pour une zone existante, gardées en attente pour une nouvelle */
function paintDraftPhotos() {
  const box = $("#draftPhotos"); if (!box || !draft) return;
  if (!cloudReady) { box.closest(".field").hidden = true; return; }
  if (!cloud.user) { box.innerHTML = `<p class="hint2"><button class="link" type="button" data-auth>Connectez-vous</button> pour garder des photos de vos visites.</p>`; bindAccount(box); return; }
  const zone = draft.id && state.zones.find(x => x.id === draft.id);
  const have = zone ? (zone.photos || []) : [], pend = draft.pendingPhotos || [], wait = zone ? uploads.get(zone.id) || 0 : 0;
  box.innerHTML = `${have.map(p => { const u = photoUrl(p.thumb); return `<span class="ph">${u ? `<img src="${esc(u)}" alt="">` : ""}</span>`; }).join("")}
    ${pend.map((p, i) => `<span class="ph"><img src="${esc(p.url)}" alt=""><button class="ph__x" type="button" data-rm="${i}" aria-label="Retirer cette photo">×</button></span>`).join("")}
    ${Array.from({length: wait + (draft.preparing || 0)}, () => `<span class="ph ph--wait"><i></i></span>`).join("")}
    <label class="ph ph--add"><input type="file" accept="image/*" multiple hidden><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg><span>Ajouter</span></label>`;
  box.querySelector("input").onchange = async e => {
    const files = [...e.target.files].filter(isImage); e.target.value = "";
    if (!files.length) return;
    if (zone) { await uploadPhotos(zone, files); paintDraftPhotos(); return; }
    draft.preparing = (draft.preparing || 0) + files.length; paintDraftPhotos();
    for (const f of files) { try { (draft.pendingPhotos = draft.pendingPhotos || []).push(await preparePhoto(f)); } catch (err) { console.warn(err); } draft.preparing--; paintDraftPhotos(); }
  };
  $$("[data-rm]", box).forEach(b => b.onclick = () => { draft.pendingPhotos.splice(+b.dataset.rm, 1); paintDraftPhotos(); });
}

/* Visionneuse plein écran */
const viewer = {z: null, i: 0};
function openViewer(z, i) {
  viewer.z = z; viewer.i = i;
  let el = $("#viewer");
  if (!el) {
    el = document.createElement("div"); el.id = "viewer"; el.className = "viewer"; el.hidden = true;
    el.innerHTML = `<div class="viewer__top"><span class="viewer__n num"></span><button class="viewer__x" type="button" data-vclose aria-label="Fermer"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="viewer__stage"><img alt=""><button class="viewer__nav viewer__prev" type="button" data-vnav="-1" aria-label="Photo précédente">‹</button><button class="viewer__nav viewer__next" type="button" data-vnav="1" aria-label="Photo suivante">›</button></div>
      <div class="viewer__bar"><span class="viewer__meta"></span><span class="viewer__acts"></span></div>`;
    document.body.appendChild(el);
    el.addEventListener("click", e => {
      if (e.target.closest("[data-vclose]")) closeViewer();
      const n = e.target.closest("[data-vnav]"); if (n) stepViewer(+n.dataset.vnav);
    });
    document.addEventListener("keydown", e => { if (el.hidden) return; if (e.key === "Escape") closeViewer(); if (e.key === "ArrowLeft") stepViewer(-1); if (e.key === "ArrowRight") stepViewer(1); });
    let x0 = null;
    el.querySelector(".viewer__stage").addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, {passive: true});
    el.querySelector(".viewer__stage").addEventListener("touchend", e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) stepViewer(dx < 0 ? 1 : -1); });
  }
  el.hidden = false; paintViewer();
}
function closeViewer() { const el = $("#viewer"); if (el) el.hidden = true; viewer.z = null; }
function stepViewer(d) { const n = (viewer.z.photos || []).length; if (n < 2) return; viewer.i = (viewer.i + d + n) % n; paintViewer(); }
async function paintViewer() {
  const el = $("#viewer"), z = viewer.z; if (!el || !z) return;
  const ps = z.photos || []; if (!ps.length) return closeViewer();
  viewer.i = Math.min(viewer.i, ps.length - 1);
  const p = ps[viewer.i], img = el.querySelector("img");
  img.src = photoUrl(p.path) || photoUrl(p.thumb) || "";
  el.querySelector(".viewer__n").textContent = `${viewer.i + 1} / ${ps.length}`;
  el.querySelectorAll(".viewer__nav").forEach(b => b.hidden = ps.length < 2);
  const who = p.userId === (cloud.user && cloud.user.id) ? "Vous" : personName(p.userId);
  el.querySelector(".viewer__meta").textContent = `${who}${p.at ? ", " + fmtDate(String(p.at).slice(0, 10)) : ""}`;
  const isCover = coverOf(z) && coverOf(z).id === p.id, mine = cloud.user && p.userId === cloud.user.id;
  el.querySelector(".viewer__acts").innerHTML = `${ps.length > 1 ? `<button type="button" class="vbtn" data-vcover ${isCover ? "disabled" : ""}>${isCover ? "Photo de couverture" : "Mettre en couverture"}</button>` : ""}${mine ? `<button type="button" class="vbtn vbtn--del" data-vdel>Supprimer</button>` : ""}`;
  const cv = el.querySelector("[data-vcover]");
  if (cv) cv.onclick = () => { z.cover = p.id; save(); renderZones(); paintPhotos(); paintViewer(); };
  const dl = el.querySelector("[data-vdel]");
  if (dl) dl.onclick = async () => {
    if (!(await askConfirm({title: "Supprimer cette photo ?", ok: "Supprimer", danger: true}))) return;
    if (await deletePhoto(z, p)) paintViewer();
  };
  if (!photoUrl(p.path)) { await signUrls([p.path]); if (viewer.z === z && z.photos[viewer.i] === p) img.src = photoUrl(p.path) || img.src; }
}

/* ---------- Zones jumelles : une zone notée sur la carte commune existe aussi sur la carte perso ----------
   Même note, même commentaire, mêmes photos des deux côtés. La forme de chaque zone reste modifiable séparément. */
const twinOf = z => z.link || cloud.twins[z.id] || null;
const photoZoneId = z => z.link || z.id;        // les photos d'une zone jumelle sont rangées sur la zone commune
async function loadTwins() {
  if (!cloud.personalMapId) return;
  const {data} = await cloud.client.from("zones").select("id, link_zone").eq("map_id", cloud.personalMapId);
  cloud.twins = {};
  (data || []).forEach(r => { if (r.link_zone) cloud.twins[r.link_zone] = r.id; });
}
async function syncTwins(rUp) {
  const c = cloud.client, me = cloud.user.id, now = new Date().toISOString();
  const mirror = [];
  for (const r of rUp) {
    const z = state.zones.find(x => x.id === r.zone_id), t = z && twinOf(z);
    if (t) mirror.push(Object.assign({}, r, {zone_id: t}));
  }
  if (mirror.length) { const {error} = await c.from("ratings").upsert(mirror); if (error) console.warn("Heden : note jumelle", error); }
  if (!isShared() || !cloud.personalMapId) return;
  for (const z of state.zones) {               // noter une zone de la carte commune la fait apparaître sur la carte perso
    if (z.example || !(hasRated(z) || z.createdBy === me) || cloud.twins[z.id] || !(cloud.synced && cloud.synced.zones[z.id]) && !rUp.some(r => r.zone_id === z.id)) continue;
    const id = zoneId();
    const row = Object.assign(zoneRow(z), {id, map_id: cloud.personalMapId, created_by: me, link_zone: z.id, updated_at: now});
    let {error} = await c.from("zones").upsert(row);
    if (!error) ({error} = await c.from("ratings").upsert(Object.assign(ratingRow(z), {zone_id: id, updated_at: now})));
    if (error) { console.warn("Heden : zone jumelle", error); continue; }
    cloud.twins[z.id] = id;
  }
}
/* Nouveautés : zones ajoutées par les autres membres et pas encore ouvertes (mémorisé sur cet appareil) */
const seenKey = () => "heden.seen." + cloud.user.id;
function seenSet() { try { return new Set(JSON.parse(localStorage.getItem(seenKey()) || "[]")); } catch (e) { return new Set(); } }
function markSeen(id) {
  const st = seenSet(); if (st.has(id)) return;
  st.add(id); try { localStorage.setItem(seenKey(), JSON.stringify([...st].slice(-2000))); } catch (e) {}
  Object.values(cloud.unseen).forEach(u => u.delete(id));
}
async function loadUnseen() {
  const shared = cloud.maps.filter(m => m.kind === "partagee"); cloud.unseen = {};
  if (!shared.length) return;
  const {data} = await cloud.client.from("zones").select("id, map_id, created_by").in("map_id", shared.map(m => m.id));
  const st = seenSet();
  (data || []).forEach(r => { if (r.created_by !== cloud.user.id && !st.has(r.id)) (cloud.unseen[r.map_id] = cloud.unseen[r.map_id] || new Set()).add(r.id); });
}
const isNew = z => isShared() && !!(cloud.unseen[cloud.mapId] && cloud.unseen[cloud.mapId].has(z.id));
async function openTwin(z) {
  const t = z.link; const m = cloud.maps.find(x => x.kind === "partagee" && x.id !== cloud.mapId) ;
  const {data} = await cloud.client.from("zones").select("id, map_id").eq("id", t).maybeSingle();
  if (!data) return toast("Cette zone n’est plus sur la carte commune");
  await switchMap(data.map_id);
  if (state.zones.some(x => x.id === t)) openDetail(t, true);
}

/* ---------- Cartes : perso et partagées ---------- */
async function loadPeople(ids) {
  const {data: ps} = await cloud.client.from("profiles").select("id, display_name, criteria, budget, half_points").in("id", ids);
  (ps || []).forEach(x => {
    cloud.names[x.id] = x.display_name || "";
    cloud.people[x.id] = {name: x.display_name || "", criteria: Array.isArray(x.criteria) ? x.criteria : [], budget: x.budget == null ? null : Number(x.budget)};
  });
}
async function loadMaps() {
  const me = cloud.user.id;
  let {data, error} = await cloud.client.from("maps").select("id, name, kind, owner, created_at, criteria, map_members(user_id, role)");
  cloud.groupCritOk = !error;
  if (error) ({data, error} = await cloud.client.from("maps").select("id, name, kind, owner, created_at, map_members(user_id, role)"));
  if (error) throw error;
  cloud.maps = (data || []).map(m => ({id: m.id, name: m.name, kind: m.kind, owner: m.owner, createdAt: m.created_at,
      criteria: Array.isArray(m.criteria) ? m.criteria : [],
      members: (m.map_members || []).map(x => ({userId: x.user_id, role: x.role}))}))
    .sort((a, b) => (a.kind === "perso" ? 0 : 1) - (b.kind === "perso" ? 0 : 1) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const ids = [...new Set(cloud.maps.flatMap(m => m.members.map(x => x.userId)))].filter(id => id !== me);
  if (ids.length) await loadPeople(ids);
  await Promise.all([loadTwins(), loadUnseen()]);
}
/* Critères communs d'une carte de groupe : enregistrés pour tous les membres */
let groupCritT = null;
function saveGroupCrit(m) {
  clearTimeout(groupCritT);
  groupCritT = setTimeout(async () => {
    const {error} = await cloud.client.rpc("set_map_criteria", {m: m.id, c: m.criteria});
    if (error) toast("Critères communs non enregistrés : réessayez dans un instant");
  }, 600);
}
const mapLabel = m => m.kind === "perso" ? "Ma carte" : m.name;
function membersLabel(m) {
  const others = m.members.filter(x => x.userId !== cloud.user.id).map(x => personName(x.userId));
  return others.length ? "Vous et " + others.join(", ") : "Vous seul pour l’instant : invitez les autres membres";
}
function duoLine(z) {
  const ms = memberScores(z).filter(m => !m.est), zs = zoneScore(z);
  const parts = ms.map(m => `${m.me ? "vous" : m.name} ${m.s.score ?? "–"}`);
  return (parts.length ? " · " + parts.join(", ") : " · pas encore notée") + (zs.vetoes && zs.vetoes.length ? " · rédhibitoire" : "");
}
function mapSwitchHTML() {
  if (!cloud.user || cloud.maps.length < 2) return "";
  return `<div class="mapsw" role="group" aria-label="Carte affichée">${cloud.maps.map(m =>
    `<button type="button" data-map="${m.id}" aria-pressed="${m.id === cloud.mapId}">${esc(mapLabel(m))}${cloud.unseen[m.id] && cloud.unseen[m.id].size ? `<b class="mapsw__n num" aria-label="${cloud.unseen[m.id].size} nouvelle${cloud.unseen[m.id].size > 1 ? "s" : ""} zone${cloud.unseen[m.id].size > 1 ? "s" : ""}">${cloud.unseen[m.id].size}</b>` : ""}</button>`).join("")}</div>`;
}
let stashedExamples = [];
function resetForMap(id) {
  if (cloud.mapId === cloud.personalMapId) stashedExamples = state.zones.filter(z => z.example);
  cloud.mapId = id;
  state.zones = id === cloud.personalMapId ? stashedExamples : [];
  cloud.synced = {zones: {}, listings: {}, profile: cloud.synced ? cloud.synced.profile : null};
  state.listings = [];
  try { localStorage.setItem("heden.map." + cloud.user.id, id); } catch (e) {}
}
async function switchMap(id) {
  if (!cloud.user || id === cloud.mapId || !cloud.maps.some(m => m.id === id)) return;
  clearTimeout(cloud.timer);
  for (let k = 0; cloud.busy && k < 100; k++) await new Promise(r => setTimeout(r, 100));
  if (hasPending()) await syncNow();
  if (hasPending()) { toast("Modifications pas encore envoyées : réessayez dans un instant"); return; }
  if (draft) { draft = null; selVertex = null; clearDraftLayers(); clearWalkTrace(); setHint(null); }
  resetForMap(id);
  selectedId = null; ui.mode = "list";
  if (currentTab !== "map") setTab("map");
  renderZones(); renderPanel();
  setupRealtime();
  await cloudRefresh(true);
  const pts = state.zones.flatMap(z => z.points || []);
  if (pts.length) setTimeout(() => { try { map.invalidateSize(); map.fitBounds(L.latLngBounds(pts).pad(0.2), {maxZoom: 16}); } catch (e) {} }, 80);
}
function setupRealtime() {
  const c = cloud.client;
  if (cloud.channel) { try { c.removeChannel(cloud.channel); } catch (e) {} cloud.channel = null; }
  if (!cloud.mapId || typeof c.channel !== "function") return;
  let t = null;
  /* on attend un moment calme : pas de tracé en cours, pas de saisie, pas de fenêtre ouverte */
  const busy = () => !(ui.mode === "list" || ui.mode === "detail") || document.querySelector(".auth.is-open, .ask") || (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
  const later = () => { clearTimeout(t); t = setTimeout(() => { if (busy()) later(); else cloudRefresh(true).catch(() => {}); }, 900); };
  try {
    let ch = c.channel("carte-" + cloud.mapId + "-" + cloud.user.id)
      .on("postgres_changes", {event: "*", schema: "public", table: "zones", filter: "map_id=eq." + cloud.mapId}, later)
      .on("postgres_changes", {event: "*", schema: "public", table: "listings", filter: "map_id=in.(" + myMapIds().join(",") + ")"}, later);
    if (isShared()) ch = ch.on("postgres_changes", {event: "*", schema: "public", table: "ratings"}, later);
    cloud.channel = ch.subscribe();
  } catch (e) { console.warn("Heden : temps réel", e); }
}
async function copyToMap(z, mapId, btn, quiet) {
  const m = cloud.maps.find(x => x.id === mapId); if (!m) return;
  if (btn) btn.disabled = true;
  try {
    const id = zoneId(), now = new Date().toISOString();
    const row = Object.assign(zoneRow(z), {id, map_id: mapId, created_by: cloud.user.id, updated_at: now});
    if (hasPending()) await syncNow();
    let {error} = await cloud.client.from("zones").upsert(row); if (error) throw error;
    ({error} = await cloud.client.from("ratings").upsert(Object.assign(ratingRow(z), {zone_id: id, updated_at: now}))); if (error) throw error;
    const mine = (z.photos || []).filter(p => p.userId === cloud.user.id && (p.zoneId || z.id) === z.id);
    if (mine.length) { const r = await cloud.client.from("zone_photos").update({zone_id: id}).in("id", mine.map(p => p.id)); if (!r.error) mine.forEach(p => p.zoneId = id); }
    await cloud.client.from("zones").update({link_zone: id}).eq("id", z.id);
    z.link = id; cloud.twins[id] = z.id; save();
    if (ui.mode === "detail" && selectedId === z.id) renderPanel();
    if (!quiet) toast(`Ajoutée à « ${m.name} »`);
    if (btn) btn.disabled = false;
    return true;
  } catch (err) { console.warn(err); if (!quiet) toast("Copie impossible pour l’instant"); }
  if (btn) btn.disabled = false;
  return false;
}
const inviteLink = code => location.origin + location.pathname + "?rejoindre=" + encodeURIComponent(code);
async function createSharedMap(name) {
  const {data, error} = await cloud.client.rpc("create_shared_map", {map_name: name || "Notre carte"});
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  await loadMaps();
  cloud.invite = {mapId: row.map_id, code: row.code};
  return row;
}
async function newInvite(mapId) {
  const {data, error} = await cloud.client.rpc("new_invite", {m: mapId});
  if (error) throw error;
  cloud.invite = {mapId, code: data};
}
async function joinWithCode(code) {
  code = String(code || "").trim().toUpperCase();
  if (!code) return;
  const {data, error} = await cloud.client.rpc("join_map", {invite_code: code});
  if (error) { toast(/invalide|expir/i.test(error.message || "") ? "Ce code est invalide ou a expiré : demandez-en un nouveau" : "Impossible de rejoindre la carte pour le moment"); return false; }
  await loadMaps();
  const m = cloud.maps.find(x => x.id === data), nm = m ? m.name : "la carte";
  // les zones perso ne suivent pas toutes seules : on propose de les apporter (elles restent aussi sur la carte perso)
  const mine = cloud.mapId === cloud.personalMapId ? state.zones.filter(z => !z.example && !z.link && Array.isArray(z.points)) : [];
  await switchMap(data);
  if (cloud.mapId !== data) return false;
  if (mine.length && await askConfirm({title: `Ajouter ${mine.length > 1 ? `vos ${mine.length} zones` : "votre zone"} à « ${nm} » ?`,
      text: "Elles restent aussi sur votre carte perso, avec vos notes. Les autres membres les verront et pourront les noter.",
      ok: mine.length > 1 ? "Ajouter mes zones" : "Ajouter ma zone", cancel: "Plus tard"})) {
    let n = 0;
    for (const z of mine) if (await copyToMap(z, data, null, true)) n++;
    await cloudRefresh(true);
    toast(n === mine.length ? `Vous avez rejoint « ${nm} » avec ${plural(n, "zone", "zones")}` : `${n} zone${n > 1 ? "s" : ""} sur ${mine.length} ajoutée${n > 1 ? "s" : ""} : réessayez pour les autres depuis leur fiche`);
  } else toast(`Vous avez rejoint « ${nm} »`);
  return true;
}
async function unlinkMap(mapId) {
  const c = cloud.client, me = cloud.user.id;
  const {data} = await c.from("zones").select("id").eq("map_id", mapId);
  const pairs = (data || []).map(r => [r.id, cloud.twins[r.id]]).filter(([, t]) => t);
  for (const [sh, pe] of pairs) {
    await c.from("zone_photos").update({zone_id: pe}).eq("zone_id", sh).eq("user_id", me);
    await c.from("zones").update({link_zone: null}).eq("id", pe);
    delete cloud.twins[sh];
    const local = state.zones.find(z => z.id === pe); if (local) local.link = null;
  }
}
async function leaveSharedMap(mapId) {
  if (cloud.mapId === mapId) await switchMap(cloud.personalMapId);
  try { await unlinkMap(mapId); } catch (e) { console.warn(e); }
  const {error} = await cloud.client.rpc("leave_map", {m: mapId});
  if (error) { toast("Impossible de quitter la carte pour le moment"); return; }
  await loadMaps();
  if (cloud.invite && cloud.invite.mapId === mapId) cloud.invite = null;
  rerenderAll();
}
async function deleteSharedMap(mapId) {
  if (cloud.mapId === mapId) await switchMap(cloud.personalMapId);
  try { await unlinkMap(mapId); } catch (e) { console.warn(e); }
  const {error} = await cloud.client.from("maps").delete().eq("id", mapId);
  if (error) { toast("Impossible de supprimer la carte pour le moment"); return; }
  await loadMaps();
  if (cloud.invite && cloud.invite.mapId === mapId) cloud.invite = null;
  rerenderAll();
}
function inviteHTML(inv) {
  return `<div class="invite">
    <span class="label">Invitation, valable 14 jours</span>
    <div class="invite__code num">${esc(inv.code)}</div>
    <p class="hint2">Chaque membre se connecte avec son e-mail et arrive sur la carte.</p>
    <div class="datarow"><button class="btn btn--sm btn--primary" type="button" data-act="share">${navigator.share ? "Envoyer le lien" : "Copier le lien"}</button>${navigator.share ? `<button class="btn btn--sm" type="button" data-act="copy">Copier le lien</button>` : ""}</div>
  </div>`;
}
function sharedHTML() {
  if (!cloudReady) return "";
  let pending = null;
  try { pending = localStorage.getItem("heden.invite"); } catch (e) {}
  if (!cloud.user) return `<section class="sec">
      <h2>Carte de groupe</h2>
      <p class="hint2">${pending ? `<b>Vous avez reçu une invitation.</b> <button class="link" type="button" data-auth>Connectez-vous</button> avec votre e-mail : vous rejoindrez la carte automatiquement.` : `<button class="link" type="button" data-auth>Connectez-vous</button> pour créer une carte commune avec vos proches ou vos colocataires. Chacun y note les zones avec son propre profil, et la couleur montre votre note commune.`}</p>
    </section>`;
  const shared = cloud.maps.filter(m => m.kind === "partagee");
  return `<section class="sec" id="duoSec">
    <h2>Carte de groupe</h2>
    <p class="hint2">À deux, en colocation ou en famille : chacun note avec son profil, plus des critères communs.</p>
    ${shared.map(m => `<div class="mapcard" data-m="${m.id}">
      <div><b>${esc(m.name)}</b><p class="hint2">${esc(membersLabel(m))}</p></div>
      ${cloud.invite && cloud.invite.mapId === m.id ? inviteHTML(cloud.invite) : ""}
      <div class="datarow">
        <button class="btn btn--sm" type="button" data-act="open" ${cloud.mapId === m.id ? "disabled" : ""}>${cloud.mapId === m.id ? "Carte affichée" : "Ouvrir la carte"}</button>
        <button class="btn btn--sm" type="button" data-act="invite">Inviter</button>
      </div>
      <div class="mapcard__danger">
        <button class="link link--danger" type="button" data-act="leave">Quitter la carte</button>
        ${m.owner === cloud.user.id ? `<button class="link link--danger" type="button" data-act="delete">Supprimer la carte</button>` : ""}
      </div>
    </div>`).join("")}
    <form class="inline-form" id="newMapForm">
      <div class="field"><label class="label" for="newMapName">${shared.length ? "Créer une autre carte commune" : "Créer une carte commune"}</label>
        <input type="text" id="newMapName" placeholder="Ex. Notre recherche" maxlength="40"></div>
      <button class="btn ${shared.length ? "" : "btn--primary"}" type="submit">Créer</button>
    </form>
    <form class="inline-form" id="joinForm">
      <div class="field"><label class="label" for="joinCode">Rejoindre avec un code</label>
        <input type="text" id="joinCode" placeholder="Ex. 7F3A9C21" maxlength="12" autocapitalize="characters" autocomplete="off"></div>
      <button class="btn" type="submit">Rejoindre</button>
    </form>
  </section>`;
}
function bindShared() {
  const sec = $("#duoSec"); if (!sec) return;
  $("#newMapForm").onsubmit = async e => {
    e.preventDefault();
    const b = e.target.querySelector("button"); b.disabled = true;
    try { await createSharedMap($("#newMapName").value.trim()); }
    catch (err) { console.warn(err); toast("Création impossible pour le moment"); }
    renderProfile();
  };
  $("#joinForm").onsubmit = async e => {
    e.preventDefault();
    const code = $("#joinCode").value; if (!code.trim()) return;
    const b = e.target.querySelector("button"); b.disabled = true;
    const ok = await joinWithCode(code);
    if (!ok) { b.disabled = false; }
  };
  $$(".mapcard", sec).forEach(card => {
    const id = card.dataset.m;
    card.onclick = async e => {
      const b = e.target.closest("[data-act]"); if (!b) return;
      const act = b.dataset.act;
      if (act === "open") switchMap(id);
      else if (act === "invite") { b.disabled = true; try { await newInvite(id); } catch (err) { toast("Invitation impossible pour le moment"); } renderProfile(); }
      else if (act === "share" || act === "copy") {
        const link = inviteLink(cloud.invite.code);
        if (act === "share" && navigator.share) { try { await navigator.share({title: "Heden", text: "Rejoignez ma carte sur Heden pour noter les quartiers ensemble.", url: link}); } catch (err) {} return; }
        try { await navigator.clipboard.writeText(link); toast("Lien copié"); } catch (err) { window.prompt("Copiez ce lien :", link); }
      } else if (act === "leave" || act === "delete") {
        const m = cloud.maps.find(x => x.id === id), nm = m ? m.name : "cette carte";
        const okk = await askConfirm(act === "leave"
          ? {title: `Quitter « ${nm} » ?`, text: "Vous ne verrez plus cette carte. Elle reste aux autres membres, avec vos notes.", ok: "Quitter la carte", danger: true}
          : {title: `Supprimer « ${nm} » ?`, text: "La carte, ses zones, les notes et les photos de chacun seront effacées pour tout le groupe.", ok: "Supprimer pour tous", danger: true});
        if (!okk) return;
        if (act === "leave") leaveSharedMap(id); else deleteSharedMap(id);
      }
    };
  });
}

async function cloudRefresh(force) {
  if (!cloud.user || !cloud.mapId) return;
  if (!force && (Date.now() - (cloud.lastRefresh || 0) < 45000)) return;
  if (hasPending()) { await syncNow(); if (hasPending()) return; }
  const c = cloud.client, me = cloud.user.id;
  const [{data: prof, error: e1}, {data: rows, error: e2}, {data: lrows, error: e3}] = await Promise.all([
    c.from("profiles").select("*").eq("id", me).maybeSingle(),
    c.from("zones").select("*, ratings(*)").eq("map_id", cloud.mapId),
    c.from("listings").select("*").in("map_id", myMapIds())
  ]);
  if (e1 || e2) { setCloudStatus("error", e1 || e2); return; }
  cloud.noListings = schemaMissing(e3);
  if (prof) cloud.noHome = !("home" in prof);
  const ids = new Set();
  (rows || []).forEach(r => { ids.add(r.created_by); (r.ratings || []).forEach(x => ids.add(x.user_id)); });
  (curMap() ? curMap().members : []).forEach(m => ids.add(m.userId));
  ids.delete(me);
  if (ids.size) await loadPeople([...ids]);
  let pushProfile = false;
  if (prof && Array.isArray(prof.criteria) && prof.criteria.length) {
    state.profile = {name: prof.display_name || "", presetId: prof.preset_id || null, modified: !!prof.modified, budget: prof.budget == null ? null : Number(prof.budget), criteria: prof.criteria, halfPoints: !!prof.half_points, home: cloud.noHome ? (state.profile && state.profile.home) : (prof.home || (state.profile && state.profile.home) || undefined)};
  } else pushProfile = true;   // compte neuf : on garde le profil de l'appareil
  const examples = cloud.mapId === cloud.personalMapId ? state.zones.filter(z => z.example) : [];
  const zoneIds = [...new Set((rows || []).flatMap(r => r.link_zone ? [r.id, r.link_zone] : [r.id]))], byZone = {};
  if (zoneIds.length) {
    const {data: ph} = await c.from("zone_photos").select("*").in("zone_id", zoneIds);
    (ph || []).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .forEach(x => (byZone[x.zone_id] = byZone[x.zone_id] || []).push({id: x.id, zoneId: x.zone_id, path: x.path, thumb: x.thumb, userId: x.user_id, w: x.width, h: x.height, at: x.created_at}));
  }
  const before = new Set(state.zones.map(z => z.id));
  state.zones = (rows || []).map(r => Object.assign(zoneFromRow(r), {photos: [...(byZone[r.id] || []), ...(r.link_zone ? byZone[r.link_zone] || [] : [])]})).concat(examples);
  if (lrows) {
    // les annonces locales jamais envoyées (ajoutées hors ligne ou avant la migration) sont gardées
    const known = (cloud.synced && cloud.synced.listings) || {}, srv = new Set(lrows.map(r => r.id));
    const ids = myMapIds(), local = (state.listings || []).filter(f => !srv.has(f.id) && !known[f.id] && (!f.mapId || ids.includes(f.mapId)));
    // une même annonce enregistrée sur deux cartes n'apparaît qu'une fois : celle de la carte affichée d'abord
    const all = lrows.map(listingFromRow).concat(local).sort((a, b) => (b.mapId === cloud.mapId) - (a.mapId === cloud.mapId));
    const uniq = [];
    for (const f of all) if (!uniq.some(x => x.mapId !== f.mapId && sameListing(x, f))) uniq.push(f);
    state.listings = uniq.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  }
  if (isShared()) {
    const st = seenSet(), u = cloud.unseen[cloud.mapId] = new Set();
    state.zones.forEach(z => { if (z.createdBy && z.createdBy !== me && !st.has(z.id)) u.add(z.id); });
    const fresh = before.size ? state.zones.filter(z => !before.has(z.id) && u.has(z.id)) : [];
    if (fresh.length) setTimeout(() => toast(fresh.length > 1 ? `${fresh.length} nouvelles zones de ${personName(fresh[0].createdBy)}` : `${personName(fresh[0].createdBy)} a ajouté « ${fresh[0].name || "une zone"} »`), 300);
  }
  signCovers();
  cloud.synced = snapshot();
  if (pushProfile) cloud.synced.profile = null;
  cloud.lastRefresh = Date.now(); cloud.lastSync = new Date();
  save();
  setCloudStatus("ok");
  rerenderAll();
  processInbox();
}

function rerenderAll() {
  if (typeof renderZones !== "function") return;
  paintModeSel();
  renderZones(); renderListingPins();
  if (currentTab === "annonces") renderListings();
  else if (currentTab === "map") { if (ui.mode === "list" || ui.mode === "detail") renderPanel(); }
  else renderProfile();
  refreshEstimates();
}

async function sendLoginEmail(email) {
  const {error} = await cloud.client.auth.signInWithOtp({email, options: {emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true}});
  if (error) throw error;
}
async function verifyLoginCode(email, code) {
  const {error} = await cloud.client.auth.verifyOtp({email, token: code.replace(/\s/g, ""), type: "email"});
  if (error) throw error;
}
async function signOut() {
  if (hasPending()) await syncNow();
  try { await cloud.client.auth.signOut(); } catch (e) {}
  cloud.alert = undefined; cloud.noInbox = false;
}

function cloudInit() {
  if (!cloudReady) return;
  cloud.client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: {flowType: "implicit", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}
  });
  cloud.client.auth.onAuthStateChange((event, session) => {
    const u = session && session.user ? session.user : null;
    if (u && (!cloud.user || cloud.user.id !== u.id)) {
      cloud.user = u; cloud.step = "email"; cloud.synced = null; cloud.names = {};
      renderAccountChip();
      if (event === "SIGNED_IN") toast("Connecté");
      cloud.pendingEmail = ""; clearInterval(auth.timer); auth.cooldown = 0;
      if (auth.open) closeAuth();
      try { if (/(access_token|error)=/.test(location.hash)) history.replaceState(null, "", currentTab === "profile" ? "#profil" : "#carte"); } catch (e) {}
      setTimeout(cloudLoad, 0);
    } else if (!u && cloud.user) {
      if (cloud.channel) { try { cloud.client.removeChannel(cloud.channel); } catch (e) {} }
      Object.assign(cloud, {user: null, mapId: null, personalMapId: null, maps: [], people: {}, channel: null, invite: null, synced: null});
      setCloudStatus("local"); renderAccountChip();
      state = load() || defaultState(); state.zones.forEach(finishZoneGeometry);
      selectedId = null; ui.mode = "list";
      rerenderAll(); renderPanel();
      toast("Déconnecté");
    } else if (u) cloud.user = u;
  });
  window.addEventListener("online", () => scheduleSync(300));
  /* lien d'invitation : ?rejoindre=CODE */
  try {
    const sp = new URLSearchParams(location.search), inv = sp.get("rejoindre");
    if (inv) {
      localStorage.setItem("heden.invite", inv.trim().toUpperCase());
      history.replaceState(null, "", location.pathname + location.hash);
      setTimeout(() => { if (!cloud.user) openAuth("On vous invite sur une carte de groupe : connectez-vous pour la rejoindre."); }, 1200);
    }
  } catch (e) {}
  const hp = new URLSearchParams(location.hash.slice(1));
  if (hp.get("error_description") || hp.get("error_code")) {
    const code = hp.get("error_code") || "";
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    openAuth(/expired/.test(code) ? "Ce lien a expiré ou a déjà servi." : "Connexion impossible avec ce lien.");
  }
  const ab = document.getElementById("acct"); if (ab) ab.onclick = () => openAuth();
  renderAccountChip();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && cloud.user) cloudRefresh(false).catch(() => {}); });
}
