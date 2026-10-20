/* =========================================================
   Feuille mobile glissante : on la tire vers le bas pour voir la carte,
   on la remonte (ou on touche son titre) pour la rouvrir.
   ========================================================= */
let sheetDrag = null, suppressClick = false;
function peekHeight() { const h = panel.querySelector(".panel__head"); return h ? h.offsetTop + h.offsetHeight : 76; }
/* Liste des zones : trois crans. Ouvert, intermédiaire (titre), réduit (cartes et + Zone seulement). */
function miniHeight() {
  const top = panel.getBoundingClientRect().top;
  const els = [panel.querySelector(".panel__head .phead__acts"), panel.querySelector(".panel__head .mapsw")].filter(Boolean);
  if (!els.length) return peekHeight();
  const sw = !!panel.querySelector(".panel__head .mapsw");
  if (!sw) { const h2 = panel.querySelector(".panel__head h2"); if (h2) els.push(h2); }
  return Math.min(peekHeight(), Math.max(...els.map(el => el.getBoundingClientRect().bottom - top)) + (sw ? 14 : 12));
}
const hasMini = () => ui.mode === "list";
function sheetStops() {
  const h = panel.offsetHeight, st = [["open", 0], ["peek", Math.max(0, h - peekHeight())]];
  if (hasMini()) st.push(["mini", Math.max(0, h - miniHeight())]);
  return st;
}
function sheetMax() { const st = sheetStops(); return st[st.length - 1][1]; }
function sheetOffset() { if (ui.sheet === "mini" && !hasMini()) ui.sheet = "peek"; const f = sheetStops().find(([k]) => k === ui.sheet); return f ? f[1] : 0; }
function setSheetVar(off) {
  const visible = isDesktop() ? 0 : panel.offsetHeight - off;
  document.getElementById("map").style.setProperty("--sheet-h", visible + "px");
}
function applySheet() {
  if (isDesktop()) { panel.style.transform = ""; panel.removeAttribute("data-sheet"); setSheetVar(0); return; }
  const off = sheetOffset();
  panel.dataset.sheet = ui.sheet;
  panel.style.transform = off ? `translateY(${off}px)` : "";
  setSheetVar(off);
}
panel.addEventListener("pointerdown", e => {
  if (isDesktop() || !e.target.closest(".panel__head, .grip")) return;
  sheetDrag = {id: e.pointerId, y0: e.clientY, off0: sheetOffset(), max: sheetMax(), off: sheetOffset(), t0: performance.now(), moved: false};
});
window.addEventListener("pointermove", e => {
  const d = sheetDrag; if (!d || e.pointerId !== d.id) return;
  const dy = e.clientY - d.y0;
  if (!d.moved) {
    if (Math.abs(dy) < 6) return;
    d.moved = true; panel.classList.add("dragging");
    try { panel.setPointerCapture(d.id); } catch (err) {}
  }
  const raw = d.off0 + dy; // au-delà du plus bas cran, le panneau freine au lieu de buter
  d.off = raw > d.max ? d.max + Math.sqrt(raw - d.max) * 4 : Math.max(0, raw);
  panel.style.transform = `translateY(${d.off}px)`;
  setSheetVar(d.off);
}, {passive: true});
function endSheetDrag(e) {
  const d = sheetDrag; if (!d || e.pointerId !== d.id) return;
  sheetDrag = null; panel.classList.remove("dragging");
  if (!d.moved) {
    if (e.type === "pointerup" && !e.target.closest("button, a, input, select, textarea")) { ui.sheet = ui.sheet === "open" ? "peek" : ui.sheet === "mini" ? "peek" : "open"; applySheet(); }
    return;
  }
  const v = (e.clientY - d.y0) / Math.max(1, performance.now() - d.t0);
  const st = sheetStops();
  let i = st.reduce((bi, s2, k) => Math.abs(s2[1] - d.off) < Math.abs(st[bi][1] - d.off) ? k : bi, 0);
  if (Math.abs(v) > 0.35) {
    const cur = st.findIndex(([k]) => k === ui.sheet);
    const dir = v > 0 ? 1 : -1;
    const next = st.findIndex(([, o]) => dir > 0 ? o > d.off + 4 : false);
    if (dir > 0) i = next >= 0 ? next : st.length - 1;
    else { let j = -1; st.forEach(([, o], k) => { if (o < d.off - 4) j = k; }); i = j >= 0 ? j : 0; }
    if (cur >= 0 && Math.abs(i - cur) > 1 && Math.abs(v) < 1.2) i = cur + dir;
  }
  ui.sheet = st[Math.max(0, Math.min(st.length - 1, i))][0];
  suppressClick = true; setTimeout(() => { suppressClick = false; }, 60);
  applySheet();
}
window.addEventListener("pointerup", endSheetDrag);
window.addEventListener("pointercancel", endSheetDrag);
panel.addEventListener("click", e => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);

/* Tri de la liste : note, prix, ou note rapportée au prix */
const SORTS = [["note", "Note"], ["prix", "Prix"], ["qp", "Note / prix"]];
const valueOf = (s, pr) => s.score != null && pr ? s.score / (pr / 10000) : null;
function sortedZones() {
  const mode = ui.sort || "note";
  return state.zones.map(z => ({z, s: zoneScore(z), pr: zonePrice(z)})).sort((a, b) => {
    if (mode === "prix") return (a.pr ?? Infinity) - (b.pr ?? Infinity);
    if (mode === "qp") return (valueOf(b.s, b.pr) ?? -1) - (valueOf(a.s, a.pr) ?? -1);
    const oa = overBudget(a.z), ob = overBudget(b.z);
    if (oa !== ob) return oa ? 1 : -1;
    return (b.s.score ?? -1) - (a.s.score ?? -1);
  });
}

function renderList() {
  const items = sortedZones();
  const n = items.length;
  const best = items.find(i => i.s.score != null && !overBudget(i.z));
  const p = state.profile;
  const presetName = (PRESETS.find(x => x.id === p.presetId) || {}).name;
  const profileLine = p.modified || !presetName ? "Profil personnalisé" : `Profil ${presetName}`;
  panel.innerHTML = `
    <div class="grip"></div>
    <div class="panel__head" id="phead">
      <div class="grow">
        ${mapSwitchHTML()}
        <h2>${n ? `${n} zone${n > 1 ? "s" : ""} notée${n > 1 ? "s" : ""}` : "Aucune zone pour l’instant"}</h2>
        <div class="sub">${best ? `En tête : ${esc(best.z.name || "Sans nom")}, ${best.s.score}/100` : esc(profileLine) + `, ${crit().filter(c => c.weight > 0).length} critères`}</div>
        ${cloudReady ? `<button type="button" class="acct-line ${cloud.user ? (cloud.status === "error" ? "err" : "on") : ""}" data-auth><i></i><span>${cloud.user ? esc(accountShort()) : "Sur cet appareil"}</span>${cloud.user ? "" : `<b>Se connecter</b>`}</button>` : ""}
      </div>
      <div class="phead__acts"><button class="btn btn--sm btn--clair btn--ico" id="pickZone" type="button" aria-label="Choisir un lieu connu" title="Choisir un lieu connu"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.5-5.4-6.5-11a6.5 6.5 0 0 1 13 0c0 5.6-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/></svg></button><button class="btn btn--primary btn--sm" id="newZone" type="button">+ Zone</button></div>
    </div>
    <div class="panel__body">
      ${!storageOk ? `<div class="banner">Ce navigateur bloque le stockage local : vos zones seront perdues à la fermeture. Exportez-les depuis l’onglet Profil.</div>` : ""}
      ${n ? `
        <div class="legend">
          <div class="legend__bar"></div>
          <div class="legend__ticks num"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
        </div>
        ${n > 1 ? `<div class="sortrow" role="group" aria-label="Trier les zones"><span>Trier par</span>${SORTS.map(([k, l]) => `<button type="button" class="chip chip--sm" data-sort="${k}" aria-pressed="${(ui.sort || "note") === k}">${l}</button>`).join("")}</div>` : ""}
        <div class="zlist">
          ${items.map(({z, s, pr}) => `
            <button class="zrow" type="button" data-id="${z.id}">
              <span class="score-chip ${s.score == null ? "none" : ""}" style="--c:${colorFor(s.score)}">${s.score == null ? "–" : s.score}</span>
              <div>
                <div class="t">${esc(z.name || "Sans nom")}</div>
                <div class="m">${pr ? `<span class="zprice num">${fmtInt(pr)}&#8239;€/m²</span>${placeLabel(z) ? ", " : ""}` : ""}${esc(placeLabel(z))}${z.author ? `, par ${esc(z.author)}` : ""}${isShared() ? esc(duoLine(z)) : ""}</div>
              </div>
              <span class="tags">
                ${coverOf(z) && photoUrl(coverOf(z).thumb) ? `<img class="zrow__ph" src="${esc(photoUrl(coverOf(z).thumb))}" alt="">` : ""}
                ${isNew(z) ? `<span class="tag tag--new">Nouveau</span>` : ""}
                ${anyFav(z) ? `<span class="heart" title="Coup de cœur">${HEART}</span>` : ""}
                ${overBudget(z) ? `<span class="tag tag--alerte">Hors budget</span>` : ""}
                
              </span>
            </button>`).join("")}
        </div>
        ${state.zones.some(z => z.example) ? `<div><button class="link" id="dropEx" type="button">Retirer les zones d’exemple</button></div>` : ""}
      ` : isShared() ? `
        <div class="empty">
          <p>Rien encore sur cette carte commune. Tracez une zone avec <b>+ Zone</b>, ou ouvrez une zone de votre carte et touchez <b>Copier sur la carte commune</b>.</p>
        </div>
      ` : `
        <div class="empty">
          ${GALETS}
          <ol>
            <li><span>Répondez aux six questions de l’onglet <b>Profil</b> : Heden règle vos critères tout seul.</span></li>
            <li><span>Touchez la carte pour poser le premier point d’une zone, puis continuez point par point autour du morceau de quartier visité.</span></li>
            <li><span>Notez chaque critère de 0 à 5 : la zone prend sa couleur, du rouge au vert.</span></li>
          </ol>
          <div><button class="link" id="loadEx" type="button">Voir 3 zones d’exemple</button></div>
        </div>
      `}
    </div>`;
  $("#newZone").onclick = e => { e.stopPropagation(); startNew(); };
  $("#pickZone").onclick = e => { e.stopPropagation(); openLieux(); };
  $$("[data-map]", panel).forEach(b => b.onclick = e => { e.stopPropagation(); switchMap(b.dataset.map); });
  const gl = $("#goLogin"); if (gl) gl.onclick = e => { e.stopPropagation(); openAuth(); };
  bindAccount(panel);
  $$(".zrow", panel).forEach(r => r.onclick = () => openDetail(r.dataset.id, true));
  $$("[data-sort]", panel).forEach(b => b.onclick = () => { ui.sort = b.dataset.sort; try { localStorage.setItem("heden.sort", ui.sort); } catch (e) {} renderList(); applySheet(); });
  const ex = $("#loadEx"); if (ex) ex.onclick = loadExamples;
  const dx = $("#dropEx"); if (dx) dx.onclick = () => { state.zones = state.zones.filter(z => !z.example); save(); renderZones(); renderPanel(); };
}

function startNew() {
  selectedId = null;
  draft = {id: null, points: [], closed: false, name: "", place: "", date: today(), moment: "", ratings: {}, price: null, fav: false, comment: ""};
  ui.mode = "placing";
  selVertex = null;
  setHint("Touchez la carte pour poser les points du contour");
  renderZones(); renderPanel();
}

function renderPlacing() {
  const n = draft.points.length, closed = draft.closed;
  const area = n >= 3 ? polyArea(draft.points) : 0;
  const per = polyPerimeter(draft.points, closed || n >= 3);
  const sub = closed ? "Glissez un point pour modeler la zone. Tirez un point bleu pour en ajouter un. Clic droit ou appui long sur un point pour le retirer."
    : n < 3 ? "Touchez la carte pour poser les points du contour, dans l’ordre."
    : "Touchez le premier point pour fermer la zone, ou validez directement.";
  panel.innerHTML = `
    <div class="grip"></div>
    <div class="panel__head">
      <div class="grow">
        <h2>${draft.id ? "Ajuster la zone" : draft.walk ? "Zone de votre balade" : "Nouvelle zone"}</h2>
        <div class="sub sub--long">${sub}</div>
        <div class="sub sub--court num">${n} point${n > 1 ? "s" : ""}${area ? ", " + fmtArea(area) : ""}${n && n < 3 ? ", encore " + (3 - n) + " au minimum" : ""}</div>
      </div>
    </div>
    <div class="panel__body">
      <div class="draw-stats">
        <div><b class="num">${n}</b><span>point${n > 1 ? "s" : ""}</span></div>
        <div><b class="num">${area ? fmtArea(area) : "–"}</b><span>surface</span></div>
        <div><b class="num">${n >= 2 ? "≈ " + walkAround(per) + " min" : "–"}</b><span>pour en faire le tour</span></div>
      </div>
      ${draft.walk ? `<p class="hint2 num">Tracée d’après ${draft.walk.len < 1000 ? fmtInt(Math.round(draft.walk.len / 10) * 10) + " m" : (draft.walk.len / 1000).toLocaleString("fr-FR", {maximumFractionDigits: 1}) + " km"} de marche en ${draft.walk.min} min${draft.pendingPhotos && draft.pendingPhotos.length ? `, avec ${draft.pendingPhotos.length} photo${draft.pendingPhotos.length > 1 ? "s" : ""} qui seront ajoutées à la zone` : ""}${draft.walk.rec ? ", dont une partie reconstituée (tirets gris) pendant une coupure du suivi" : ""}. Le parcours reste affiché pour vous aider à ajuster.</p>` : ""}
      <div class="liveprice" id="livePrice" hidden></div>
      <div class="draw-actions">
        ${closed
          ? `<button class="btn btn--sm" id="delPt" type="button" ${selVertex == null || n <= 3 ? "disabled" : ""}>Retirer le point sélectionné</button>`
          : `<button class="btn btn--sm" id="undoPt" type="button" ${n ? "" : "disabled"}>Annuler le dernier point</button>`}
        <button class="btn btn--sm btn--clair" id="resetPt" type="button" ${n ? "" : "disabled"}>Recommencer</button>
      </div>
    </div>
    <div class="panel__foot">
      <button class="btn btn--clair" id="cancel" type="button">Annuler</button>
      <button class="btn btn--primary btn--block" id="confirm" type="button" ${n >= 3 ? "" : "disabled"}>Valider la zone</button>
    </div>`;
  const u = $("#undoPt"); if (u) u.onclick = () => { draft.points.pop(); setHint(draft.points.length ? "Continuez à poser les points du contour" : "Touchez la carte pour poser les points du contour"); drawDraft(); renderPanel(); };
  const d = $("#delPt"); if (d) d.onclick = () => { if (selVertex != null) removeVertex(selVertex); };
  $("#resetPt").onclick = async () => {
    if (draft.points.length > 2 && !(await askConfirm({title: "Recommencer le tracé ?", text: "Tous les points posés seront effacés.", ok: "Recommencer", cancel: "Garder le tracé", abandon: true}))) return;
    draft.points = []; draft.closed = false; selVertex = null; setHint("Touchez la carte pour poser les points du contour"); drawDraft(); renderPanel(); };
  $("#cancel").onclick = confirmCancelDraft;
  $("#confirm").onclick = () => {
    if (draft.points.length < 3) return;
    draft.closed = true; selVertex = null;
    finishZoneGeometry(draft);
    setHint(null);
    ui.mode = "rating";
    drawDraft();
    if (!draft.place || !draft.name) reverseGeocode(draft);
    renderPanel();
    requestAnimationFrame(fitDraft);
  };
  paintLivePrice();
  if (n >= 3) ensureEstimate(draft, () => { if (ui.mode === "placing") paintLivePrice(); });
}
function paintLivePrice() {
  const el = $("#livePrice"); if (!el || !draft) return;
  if (draft.points.length < 3) { el.hidden = true; return; }
  el.hidden = false;
  if (isRent()) {
    const r = zoneRent(draft);
    el.innerHTML = r ? `<span class="label">Loyers ici</span><b class="num">${fmt1(r.cc)}&#8239;€/m²</b><span class="conf ${r.zone === "paris" ? "conf--2" : "conf--1"}">${r.zone === "paris" ? "Officiel" : "Indicatif"}</span>` : `<span class="label">Loyers ici</span><span class="hint2">${LOY.data ? "Pas de référence ici" : "…"}</span>`;
    if (!LOY.data) loadLoyers().then(() => paintLivePrice());
    return;
  }
  const fresh = draft.est && draft.est.g === geomKey(draft.points);
  const p = fresh && draft.est.prix;
  el.innerHTML = !fresh ? `<span class="label">Prix des ventes ici</span><b>…</b>`
    : p ? `<span class="label">Prix des ventes ici</span><b class="num">${fmtInt(p.med)}&#8239;€/m²</b><span class="conf ${CONF[p.conf][1]}">${CONF[p.conf][0]}</span>`
    : `<span class="label">Prix des ventes ici</span><span class="hint2">Trop peu de ventes autour</span>`;
}

function cancelDraft() {
  const back = draft && draft.id;
  const hadWalk = draft && draft.walk;
  draft = null; selVertex = null; clearDraftLayers(); clearWalkTrace(); setHint(null);
  if (hadWalk) walkPhotosClear();
  if (back) { ui.mode = "detail"; selectedId = back; } else ui.mode = "list";
  renderZones(); renderPanel();
}
function fitDraft() {
  const b = L.latLngBounds(draft.points).pad(0.25);
  map.fitBounds(b, {paddingTopLeft: [0, isDesktop() ? 0 : 70], paddingBottomRight: [0, isDesktop() ? 0 : panel.offsetHeight], maxZoom: 17});
}

function renderRating() {
  const s = scoreOf(draft);
  const cs = crit().filter(c => c.weight > 0);
  const wsum = cs.reduce((a, c) => a + c.weight, 0) || 1;
  panel.innerHTML = `
    <div class="grip"></div>
    <div class="panel__head">
      <div class="grow">
        <h2>Noter la zone</h2>
        <div class="sub">${draft.area ? fmtArea(draft.area) + ", " : ""}${cs.length} critères de votre profil</div>
      </div>
      <button class="x" id="cancelR" type="button" aria-label="${draft.id ? "Annuler les modifications" : "Annuler la zone"}" title="${draft.id ? "Annuler les modifications" : "Annuler la zone"}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </div>
    <div class="panel__body">
      <div class="scorebox" id="sbox"></div>
      <div class="field">
        <label class="label" for="zname">Nom de la zone</label>
        <input type="text" id="zname" value="${esc(draft.name)}" placeholder="Ex. Haut de la rue des Martyrs" maxlength="80">
      </div>
      <div class="row2">
        <div class="field">
          <label class="label" for="zdate">Visite</label>
          <label class="datebox">
            <span id="zdateTxt" class="num">${draft.date ? esc(fmtDate(draft.date)) : "Choisir"}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>
            <input type="date" id="zdate" value="${esc(draft.date || "")}" aria-label="Date de visite">
          </label>
        </div>
        ${isRent() ? "" : `<div class="field">
          <label class="label" for="zprice">Prix observé €/m²</label>
          <input type="number" id="zprice" inputmode="numeric" min="0" step="100" value="${draft.price ?? ""}" placeholder="Facultatif">
        </div>`}
      </div>
      <div class="field">
        <span class="label">Moment de la visite</span>
        <div class="chips" id="zmoment">${MOMENTS.map(m => `<button class="chip" type="button" data-m="${m}" aria-pressed="${draft.moment === m}">${m}</button>`).join("")}</div>
      </div>
      <div class="field">
        <span class="label">Photos</span>
        <div class="photos__strip" id="draftPhotos"></div>
      </div>
      <div class="field" style="gap:14px">
        <span class="label">Critères, de 0 (rédhibitoire) à 5 (excellent)</span>
        <p class="est-src" id="estSrc" hidden></p>
        ${cs.map(c => `<div class="crit" data-c="${esc(c.id)}">
            <div class="crit__top"><span class="crit__name">${esc(c.name)}${c.group ? `<small class="cgrp">commun</small>` : ""}</span><span class="crit__w num">poids ${Math.round(c.weight / wsum * 100)} %</span></div>
            ${c.desc ? `<div class="crit__desc">${esc(c.desc)}</div>` : ""}
            <div class="scale${state.profile.halfPoints ? " scale--half" : ""}">${[0, 1, 2, 3, 4, 5].map(n => `<button type="button" data-v="${n}" style="--c:${colorFor(n * 20)}">${n}</button>`).join("")}${state.profile.halfPoints ? `<button type="button" class="half" data-half aria-label="Ajouter un demi-point">+½</button>` : ""}</div>
            <div class="crit__est" hidden></div>
          </div>`).join("")}
      </div>
      <div class="field">
        <span class="label">Coup de cœur</span>
        <div class="chips"><button class="chip" id="zfav" type="button" aria-pressed="${!!draft.fav}"><span class="heart">${HEART}</span>&nbsp;On adore ce coin</button></div>
      </div>
      <div class="field">
        <label class="label" for="zcom">Commentaires</label>
        <textarea id="zcom" maxlength="2000" placeholder="Ambiance, bruit le soir, adresse d’un bien vu…">${esc(draft.comment)}</textarea>
      </div>
    </div>
    <div class="panel__foot">
      <button class="btn btn--clair" id="back" type="button">Ajuster le tracé</button>
      <button class="btn btn--primary btn--block" id="saveZ" type="button">Enregistrer</button>
    </div>`;
  updateScoreBox();
  $("#zname").oninput = e => { draft.name = e.target.value; draft.nameTouched = true; };
  const zd = $("#zdate");
  zd.oninput = zd.onchange = e => { draft.date = e.target.value; $("#zdateTxt").textContent = draft.date ? fmtDate(draft.date) : "Choisir"; };
  zd.onclick = () => { try { zd.showPicker && zd.showPicker(); } catch (err) {} };
  if ($("#zprice")) $("#zprice").oninput = e => { const v = parseFloat(e.target.value); draft.price = isFinite(v) && v > 0 ? v : null; updateScoreBox(); };
  $("#zcom").oninput = e => draft.comment = e.target.value;
  $$("#zmoment .chip").forEach(b => b.onclick = () => {
    draft.moment = draft.moment === b.dataset.m ? "" : b.dataset.m;
    $$("#zmoment .chip").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.m === draft.moment)));
  });
  $("#zfav").onclick = e => { draft.fav = !draft.fav; e.currentTarget.setAttribute("aria-pressed", String(draft.fav)); };
  $$(".crit", panel).forEach(row => {
    const id = row.dataset.c;
    $$(".scale button[data-v]", row).forEach(b => b.onclick = () => {
      const n = +b.dataset.v, u = userVal(draft, id);
      if (u !== undefined && Math.floor(u) === n) delete draft.ratings[id]; else draft.ratings[id] = n;
      paintCrits(); updateScoreBox();
    });
    const hb = row.querySelector("[data-half]");
    if (hb) hb.onclick = () => {
      const u = userVal(draft, id), base = u !== undefined ? u : estScore(draft, id);
      if (base === undefined || base >= 5) return;
      draft.ratings[id] = Number.isInteger(base) ? base + .5 : Math.floor(base);
      paintCrits(); updateScoreBox();
    };
    row.querySelector(".crit__est").onclick = e => {
      if (!e.target.closest("[data-reset]")) return;
      delete draft.ratings[id]; paintCrits(); updateScoreBox();
    };
  });
  paintCrits(); paintDraftPhotos();
  ensureEstimate(draft, () => { if (ui.mode === "rating") { paintCrits(); updateScoreBox(); } });
  $("#back").onclick = () => { ui.mode = "placing"; setHint("Glissez un point pour modeler la zone, tirez un point bleu pour en ajouter un"); drawDraft(); renderPanel(); };
  $("#saveZ").onclick = commitDraft;
  $("#cancelR").onclick = confirmCancelDraft;
}
/* Annuler une zone (tracé ou notation) : on demande confirmation dès qu'il y a quelque chose à perdre */
async function confirmCancelDraft() {
  if (!draft) return;
  const orig = draft.id && state.zones.find(x => x.id === draft.id);
  const pick = z => JSON.stringify([z.points, z.ratings || {}, z.comment || "", z.name || "", !!z.fav, z.price || null, z.moment || "", z.date || ""]);
  const lose = orig ? pick(orig) !== pick(draft) : draft.points.length > 0;
  if (lose && !(await askConfirm(orig
    ? {title: "Annuler vos modifications ?", text: "Le tracé, les notes et les commentaires modifiés ne seront pas enregistrés. La zone reste comme avant.", ok: "Annuler les modifications", cancel: "Continuer", abandon: true}
    : draft.walk
      ? {title: "Abandonner la zone de votre balade ?", text: draft.pendingPhotos && draft.pendingPhotos.length ? "La zone proposée, le parcours et les photos de la balade seront effacés." : "La zone proposée et le parcours seront effacés.", ok: "Abandonner", cancel: "Continuer", abandon: true}
      : {title: "Abandonner cette zone ?", text: ui.mode === "rating" ? `Le tracé${draft.pendingPhotos && draft.pendingPhotos.length ? ", les photos" : ""} et les notes saisies seront perdus.` : "Les points déjà posés seront effacés.", ok: "Abandonner", cancel: "Continuer", abandon: true}))) return;
  const wasNew = !orig;
  cancelDraft();
}

/* État des échelles : note donnée, ou estimation proposée (modifiable) */
function paintCrits() {
  if (!draft) return;
  let any = false;
  $$(".crit", panel).forEach(row => {
    const id = row.dataset.c, u = userVal(draft, id), e = estScore(draft, id), why = estWhy(draft, id);
    const sel = u === undefined ? undefined : Math.floor(u);
    $$(".scale button[data-v]", row).forEach(b => {
      const n = +b.dataset.v, on = sel === n;
      b.setAttribute("aria-pressed", String(on));
      b.textContent = on && u !== n ? fmtNote(u) : n;
      b.style.setProperty("--c", colorFor((on ? u : n) * 20));
      b.classList.toggle("is-est", u === undefined && e === n);
      b.classList.toggle("est-mark", u !== undefined && e === n && u !== n);
    });
    const hb = row.querySelector("[data-half]");
    if (hb) {
      const base = u !== undefined ? u : e;
      hb.disabled = base === undefined || base >= 5;
      hb.setAttribute("aria-pressed", String(u !== undefined && !Number.isInteger(u)));
    }
    const box = row.querySelector(".crit__est");
    if (e === undefined && !why) { box.hidden = true; return; }
    any = any || e !== undefined;
    box.hidden = false;
    box.innerHTML = e === undefined ? esc(why)
      : u === undefined ? `<b>Estimé à ${e}</b> : ${esc(why)}.`
      : u === e ? `Comme l’estimation : ${esc(why)}.`
      : `Estimation ${e} : ${esc(why)}. <button type="button" class="linkbtn" data-reset>Revenir à l’estimation</button>`;
  });
  const zp = $("#zprice");
  if (zp && draft.est && draft.est.prix) zp.placeholder = "Médiane " + fmtInt(draft.est.prix.med);
  const src = $("#estSrc");
  if (src) { src.hidden = !any; src.textContent = "Les notes en pointillés sont estimées d’après les ventes DVF et OpenStreetMap, en comparant ce coin aux autres quartiers de Paris et de la petite couronne. Elles comptent dans la note tant que vous ne les changez pas : touchez une autre note pour la remplacer."; }
}
function updateScoreBox() {
  const box = $("#sbox"); if (!box) return;
  const s = scoreOf(draft);
  const col = colorFor(s.score);
  box.innerHTML = `
    <div class="big ${s.score == null ? "none" : ""}" style="--c:${col}">${s.score == null ? "–" : s.score}</div>
    <div><strong>${s.score == null ? "Pas encore de note" : "Note sur 100"}</strong>
    <p class="num">${s.rated} sur ${s.total} critères notés${s.estimated ? `, dont ${s.estimated} estimé${s.estimated > 1 ? "s" : ""}` : ""}${overBudget(draft) ? ", au-dessus de votre budget" : ""}</p></div>`;
  if (draftShape) {
    if (s.score == null) draftShape.setStyle({color: draftColor(), fillColor: draftColor(), fillOpacity: .24});
    else draftShape.setStyle({color: traitMap(s.score), fillColor: col, fillOpacity: .34});
  }
}

function commitDraft() {
  const pendRaw = draft.pendingPhotos || []; delete draft.pendingPhotos; delete draft.preparing;
  const z = finishZoneGeometry(clone(draft)); delete z.nameTouched; delete z.closed; delete z.walk;
  z.name = (z.name || "").trim() || z.place || "Zone sans nom";
  z.updatedAt = Date.now();
  if (z.id) {
    const i = state.zones.findIndex(x => x.id === z.id);
    if (i >= 0) state.zones[i] = Object.assign({}, state.zones[i], z, {example: false});
  } else {
    z.id = zoneId(); z.createdAt = Date.now(); z.author = state.profile.name || "";
    if (cloud.user) { z.mapId = cloud.mapId; z.createdBy = cloud.user.id; }
    state.zones.push(z);
  }
  save();
  draft = null; clearDraftLayers(); clearWalkTrace();
  selectedId = z.id; ui.mode = "detail";
  justSaved = z.id; setTimeout(() => { if (justSaved === z.id) justSaved = null; }, 1600);
  renderZones(); renderPanel();
  const pend = pendRaw;
  const saved = state.zones.find(x => x.id === z.id);
  if (!storageOk) toast("Zone non sauvegardée : ce navigateur bloque le stockage");
  refreshEstimates();
  if (pend.length && saved && cloud.user) uploadPhotos(saved, pend, {done: pend.length > 1 ? `Zone enregistrée avec ses ${pend.length} photos` : "Zone enregistrée avec sa photo"}).then(() => walkPhotosClear());
  else if (pend.length) walkPhotosClear();
}

function openDetail(id, fly) {
  const z = state.zones.find(x => x.id === id); if (!z) return;
  selectedId = id; ui.mode = "detail";
  if (isNew(z)) markSeen(z.id);
  if (fly) map.flyToBounds(L.latLngBounds(z.points).pad(0.4), {maxZoom: 17, duration: .6, paddingBottomRight: [0, isDesktop() ? 0 : Math.round(innerHeight * .45)]});
  renderZones(); renderPanel();
}

function renderDetail() {
  const z = state.zones.find(x => x.id === selectedId);
  if (!z) { ui.mode = "list"; return renderPanel(); }
  const s = scoreOf(z), zs = zoneScore(z), duo = isShared();
  const cs = crit().filter(c => c.weight > 0);
  const wsum = cs.reduce((a, c) => a + c.weight, 0) || 1;
  const big = duo ? zs : s;
  const members = duo ? memberScores(z) : [];
  const partners = members.filter(x => !x.me && !x.est);
  const copyTargets = !duo && cloud.user && !z.link && !z.example ? cloud.maps.filter(m => m.kind === "partagee") : [];
  const linkedMap = !duo && z.link ? cloud.maps.find(m => m.kind === "partagee") : null;
  panel.innerHTML = `
    <div class="grip"></div>
    <div class="panel__head">
      <div class="grow">
        <span class="plaque" title="${esc(z.name || "Sans nom")}"><span>${z.place ? `<small>${esc(z.place)}</small>` : ""}${esc(z.name || "Sans nom")}</span></span>
        ${z.area ? `<div class="sub num" style="margin-top:8px">${fmtArea(z.area)}</div>` : ""}
      </div>
      <button class="x x--del" id="del" type="button" aria-label="${duo ? "Supprimer la zone pour tout le groupe" : "Supprimer la zone"}" title="Supprimer"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></button>
      <button class="x" id="close" type="button" aria-label="Fermer"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </div>
    <div class="panel__body">
      <div class="scorebox">
        <div class="big ${big.score == null ? "none" : ""}" style="--c:${colorFor(big.score)}" ${big.score != null ? `data-count="${big.score}"` : ""}>${big.score == null ? "–" : big.score}</div>
        <div><strong>${big.score == null ? "Pas encore de note" : verdict(big.score)}</strong>
        <p class="num">${duo ? groupLine(zs) : `${s.rated} sur ${s.total} critères notés${s.estimated ? `, dont ${s.estimated} estimé${s.estimated > 1 ? "s" : ""}` : ""}`}</p>${z.fav ? `<p style="color:var(--laiton);font-weight:600;margin-top:2px"><span class="heart">${HEART}</span> Coup de cœur</p>` : ""}</div>
      </div>
      ${photosHTML(z)}
      ${overBudget(z) ? `<div class="banner banner--alerte">${isRent() ? `Loyers autour de ${fmt1(zonePrice(z))} €/m², au-dessus de votre loyer maximum de ${fmt1(zoneBudget())} €/m².` : `${z.price > 0 ? "Prix observé" : "Prix estimé"} de ${fmtInt(zonePrice(z))} €/m², au-dessus de votre budget de ${fmtInt(state.profile.budget)} €/m².`}</div>` : ""}
      ${duo ? `<div class="duo">
        ${zs.vetoes && zs.vetoes.length ? `<p class="duo__veto">${zs.vetoes.map(v => `${v.me ? "Rédhibitoire pour vous" : `Rédhibitoire pour ${esc(v.name)}`} : ${esc(v.crit.join(", "))}`).join(". ")}. La note du groupe est plafonnée à ${VETO_CAP}.</p>` : ""}
        ${members.map(m => `<div class="duo__row${m.est ? " duo__row--est" : ""}"><span>${esc(m.name)}</span>${m.s.score == null ? `<em>Pas encore noté</em>` : `<b class="num" style="--c:${colorFor(m.s.score)}"><i></i>${m.s.score}</b>${m.est ? `<em>estimée</em>` : ""}`}${m.veto.length ? `<em class="duo__x">rédhibitoire</em>` : ""}${m.fav ? `<span class="heart">${HEART}</span>` : ""}</div>
          ${!m.me && m.comment ? `<p class="duo__c">${esc(m.name)} : ${esc(m.comment)}</p>` : ""}`).join("")}
        ${members.length > 1 ? `<button type="button" class="link duo__more" id="duoMore" aria-expanded="false">Voir les notes de chacun, critère par critère</button><div class="duo__tbl" id="duoTbl" hidden>${duoTable(z, members)}</div>` : ""}
        <p class="duo__h">${twinOf(z) ? "Vos notes, commentaires et photos sont aussi sur votre carte perso. " : ""}Chacun note avec ses critères, plus ceux du groupe.</p>
      </div>` : ""}
      ${priceHTML(z)}
      ${!s.complete && s.total ? `<div class="banner">Note partielle : ${s.total - s.rated} critère${s.total - s.rated > 1 ? "s" : ""} de votre profil n’${s.total - s.rated > 1 ? "ont" : "a"} pas encore été noté${s.total - s.rated > 1 ? "s" : ""}.</div>` : ""}
      <div class="breakdown">
        ${cs.map(c => {
          const {v, est} = critVal(z, c.id);
          return `<div class="bd${est ? " bd--est" : ""}${c.group ? " bd--grp" : ""}"${est ? ` title="${esc(estWhy(z, c.id))}"` : ""}>
            <span class="n">${esc(c.name)}<small class="num">${Math.round(c.weight / wsum * 100)} %</small></span>
            <span class="bar"><i style="width:${typeof v === "number" ? v * 20 : 0}%;--c:${traitFor(typeof v === "number" ? v * 20 : null)}"></i></span>
            <span class="v num">${typeof v === "number" ? fmtNote(v) : "–"}</span></div>`;
        }).join("")}
      </div>
      ${s.estimated ? `<p class="bd-leg"><i></i>Valeurs estimées d’après les données du quartier, à confirmer en notant la zone</p>` : ""}
      ${cs.some(c => c.group) ? `<p class="bd-leg bd-leg--grp"><i></i>Critère commun à la carte</p>` : ""}
      <dl class="meta">
        ${z.date ? `<dt>Visite</dt><dd>${esc(fmtDate(z.date))}${z.moment ? ", " + esc(z.moment.toLowerCase()) : ""}</dd>` : ""}
        ${!isRent() && z.price && !(z.est && z.est.prix) ? `<dt>Prix observé</dt><dd class="num">${fmtInt(z.price)} €/m²</dd>` : ""}
        <dt>Surface</dt><dd class="num">${fmtArea(z.area || polyArea(z.points))}, environ ${walkAround(z.perimeter || polyPerimeter(z.points))} min pour en faire le tour à pied</dd>
        ${z.author ? `<dt>Notée par</dt><dd>${esc(z.author)}</dd>` : ""}
      </dl>
      ${z.comment ? `<div class="note">${esc(z.comment)}</div>` : ""}
      ${linkedMap || z.link ? `<div class="twin"><span>Aussi sur la carte commune${linkedMap ? ` « ${esc(linkedMap.name)} »` : ""}, avec les mêmes notes et photos.</span><button class="link" type="button" id="openTwin">Voir</button></div>` : ""}
      ${copyTargets.length ? `<div class="datarow">${copyTargets.map(m => `<button class="btn btn--sm" data-copy="${m.id}" type="button">Ajouter à « ${esc(m.name)} »</button>`).join("")}</div>` : ""}
    </div>
    <div class="panel__foot">
      <button class="btn" id="adj" type="button">Ajuster le tracé</button>
      <button class="btn btn--primary btn--block" id="edit" type="button">${duo && !hasRated(z) ? "Ajouter ma note" : "Modifier les notes"}</button>
    </div>`;
  $("#close").onclick = () => { selectedId = null; ui.mode = "list"; renderZones(); renderPanel(); };
  $("#edit").onclick = () => { draft = Object.assign(clone(z), {closed: true}); ui.mode = "rating"; renderZones(); drawDraft(); renderPanel(); updateScoreBox(); };
  $("#adj").onclick = () => { draft = Object.assign(clone(z), {closed: true}); selVertex = null; ui.mode = "placing"; setHint("Glissez un point pour modeler la zone, tirez un point bleu pour en ajouter un"); renderZones(); drawDraft(); renderPanel(); };
  $$("[data-copy]", panel).forEach(b => b.onclick = () => copyToMap(z, b.dataset.copy, b));
  const ot = $("#openTwin"); if (ot) ot.onclick = () => openTwin(z);
  const dm = $("#duoMore");
  if (dm) dm.onclick = () => { const t = $("#duoTbl"), open = t.hidden; t.hidden = !open; dm.setAttribute("aria-expanded", String(open)); dm.textContent = open ? "Masquer le détail" : "Voir les notes de chacun, critère par critère"; };
  paintPhotos(); bindAccount(panel);
  const del = $("#del");
  del.onclick = async () => {
    if (!(await askConfirm({title: `Supprimer « ${z.name || "cette zone"} » ?`, text: duo ? "La zone disparaît pour tout le groupe, avec les notes et les photos de chacun." : "La zone, ses notes et ses photos seront effacées.", ok: "Supprimer", danger: true}))) return;
    const mine = cloud.user ? (z.photos || []).filter(p => p.userId === cloud.user.id && (p.zoneId || z.id) === z.id) : [];
    if (mine.length) cloud.client.storage.from("photos").remove(mine.flatMap(p => [p.path, p.thumb])).catch(() => {});
    state.zones = state.zones.filter(x => x.id !== z.id); save();
    selectedId = null; ui.mode = "list"; renderZones(); renderPanel();
  };
}
/* Notes de chacun, critère par critère (critères du groupe en tête, puis ceux de chacun) */
function duoTable(z, members) {
  const people = members.map(m => {
    const o = m.me ? z : ((z.others || []).find(x => x.userId === m.userId) || {}), pp = m.me ? null : cloud.people[m.userId] || {};
    return {name: m.name, ratings: o.ratings || {}, criteria: m.me ? crit() : memberCrit(m.userId) || [], budget: m.me ? zoneBudget() : pp.budget};
  });
  const rows = [];
  groupCrit().forEach(c => rows.push({id: c.id, name: c.name, group: true}));
  people.forEach(pe => pe.criteria.forEach(c => { if (c.weight > 0 && !rows.some(r => r.id === c.id)) rows.push({id: c.id, name: c.name}); }));
  const cell = (pe, id) => {
    if (!pe.criteria.some(c => c.id === id && c.weight > 0)) return `<td class="na">·</td>`;
    const {v, est} = critValFor(z, id, pe.ratings, pe.budget);
    return typeof v === "number" ? `<td class="num${est ? " est" : ""}${v === 0 && !est ? " veto" : ""}"><i style="--c:${colorFor(v * 20)}"></i>${fmtNote(v)}</td>` : `<td class="na">–</td>`;
  };
  return `<table><thead><tr><th>Critère</th>${people.map(pe => `<th>${esc(pe.name)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(r => `<tr${r.group ? ` class="grp"` : ""}><td>${esc(r.name)}${r.group ? ` <small>commun</small>` : ""}</td>${people.map(pe => cell(pe, r.id)).join("")}</tr>`).join("")}</tbody></table>
    <p class="duo__leg">En gris : valeur estimée, pas encore notée. Point : critère absent de ce profil.</p>`;
}
function groupLine(zs) {
  if (!zs.group) return "Estimation, personne n’a encore noté";
  const n = zs.members, e = zs.estMembers;
  const base = n > 1 ? `Note du groupe, moyenne de ${n} membres` : "Une seule note pour l’instant";
  return base + (e ? `, dont ${e} estimée${e > 1 ? "s" : ""}` : "") + (zs.vetoes && zs.vetoes.length ? `, plafonnée (rédhibitoire)` : "");
}
/* Loyers d'une zone : loyer de référence du quartier (Paris) ou loyers d'annonce de la commune */
function rentHTML(z) {
  const r = zoneRent(z), b = zoneBudget();
  if (!r) return LOY.data ? `<div class="price"><span class="label">Loyers</span><p class="price__sub">Pas de loyer de référence pour ce lieu.</p></div>` : "";
  const facts = [];
  if (r.zone === "paris") {
    facts.push(`Quartier ${esc(r.name)} : loyer de référence ${fmt1(r.ref)}&#8239;€/m² hors charges pour un ${r.rooms === 1 ? "studio" : r.rooms + " pièces"} ${r.mb ? "meublé" : "vide"}, ${r.annee}`);
    facts.push(`Plafond légal (référence majorée) : ${fmt1(r.maxLo)}${r.maxHi - r.maxLo >= .1 ? ` à ${fmt1(r.maxHi)}` : ""}&#8239;€/m² selon l’année de construction`);
  } else facts.push(`${esc(r.name)} : loyers d’annonce de ${fmt1(r.lo)} à ${fmt1(r.hi)}&#8239;€/m², ${r.annee}${r.encadre ? " · loyers encadrés dans cette commune" : ""}`);
  if (b > 0) facts.push(`Votre loyer maximum revient à ${fmt1(b)}&#8239;€/m² : ${b >= r.cc * 1.08 ? "confortable ici" : b >= r.cc * .97 ? "juste dans la moyenne" : "en dessous des loyers du coin"}`);
  return `<div class="price">
    <div class="price__top"><span class="label">Loyers ${r.zone === "paris" ? "du quartier" : "de la commune"}</span><span class="conf ${r.zone === "paris" ? "conf--2" : "conf--1"}">${r.zone === "paris" ? "Officiel" : "Indicatif"}</span></div>
    <div class="price__big num">${fmt1(r.cc)}&#8239;€/m²<small class="permo"> par mois</small></div>
    <p class="price__sub">${r.zone === "paris" ? "Loyer de référence de l’encadrement, plus les charges moyennes." : "Loyers des annonces de la commune, charges comprises."}</p>
    <ul class="price__facts">${facts.map(x => `<li>${x}</li>`).join("")}</ul>
  </div>`;
}
function priceHTML(z) {
  if (isRent()) return rentHTML(z);
  const p = z.est && z.est.prix;
  if (!p) return z.est ? `<div class="price"><span class="label">Prix des ventes</span><p class="price__sub">Trop peu de ventes d’appartements autour de cette zone pour estimer un prix.</p></div>` : "";
  const where = p.r ? `à moins de ${p.r} m de la zone` : "dans la zone";
  const b = state.profile.budget, seen = z.price > 0 ? z.price : null;
  const conf = CONF[p.conf ?? (p.n >= 30 ? 2 : p.n >= 15 ? 1 : 0)];
  const lo0 = p.p10 ?? p.q1, hi0 = p.p90 ?? p.q3;
  const lo = Math.min(lo0, b > 0 ? b : Infinity, seen || Infinity) * .97, hi = Math.max(hi0, b > 0 ? b : 0, seen || 0) * 1.03;
  const pos = v => ((v - lo) / (hi - lo) * 100).toFixed(1) + "%";
  const facts = [];
  if (p.com) facts.push(`${esc(p.com.name)} : ${fmtInt(p.com.med)}&#8239;€/m², ${Math.abs(p.com.delta) < 3 ? "la zone est dans la moyenne" : `la zone est ${Math.abs(p.com.delta)} % plus ${p.com.delta > 0 ? "chère" : "abordable"}`}`);
  if (p.sect && p.sect.trend != null) facts.push(`${esc(p.sect.name)} : ${Math.abs(p.sect.trend) < 1 ? "prix stables" : `${p.sect.trend > 0 ? "+" : "−"}${Math.abs(p.sect.trend)} %`} sur un an`);
  if (b > 0) facts.push(`Votre budget de ${fmtInt(b)}&#8239;€/m² couvre ${b >= p.q3 ? "plus des trois quarts" : b >= p.med ? "plus de la moitié" : b >= p.q1 ? "entre un quart et la moitié" : "moins d’un quart"} des ventes`);
  if (seen) facts.push(`Prix observé : ${fmtInt(seen)}&#8239;€/m², ${Math.round((seen / p.med - 1) * 100) >= 0 ? "+" : "−"}${Math.abs(Math.round((seen / p.med - 1) * 100))} % par rapport à la médiane`);
  return `<div class="price">
    <div class="price__top"><span class="label">Prix des ventes d’appartements</span><span class="conf ${conf[1]}">${conf[0]}</span></div>
    <div class="price__big num">${fmtInt(p.med)}&#8239;€/m²</div>
    <p class="price__sub num">Médiane de ${plural(p.n, "vente", "ventes")} ${where}${p.adj ? ", ramenées aux prix de " + monthLabel(p.to) : ""}.</p>
    <div class="pbar" aria-hidden="true">
      <span class="pbar__rng" style="left:${pos(lo0)};right:calc(100% - ${pos(hi0)})"></span>
      <span class="pbar__iqr" style="left:${pos(p.q1)};right:calc(100% - ${pos(p.q3)})"></span>
      <span class="pbar__med" style="left:${pos(p.med)}"></span>
      ${b > 0 ? `<span class="pbar__bud" style="left:${pos(b)}"></span>` : ""}
      ${seen ? `<span class="pbar__seen" style="left:${pos(seen)}"></span>` : ""}
    </div>
    <div class="pbar__leg num"><span>${fmtInt(lo0)}</span><span>la moitié des ventes entre ${fmtInt(p.q1)} et ${fmtInt(p.q3)}</span><span>${fmtInt(hi0)}</span></div>
    ${b > 0 || seen ? `<div class="pbar__keys">${b > 0 ? `<span><i class="k-bud"></i>votre budget</span>` : ""}${seen ? `<span><i class="k-seen"></i>prix observé</span>` : ""}</div>` : ""}
    ${facts.length ? `<ul class="price__facts">${facts.map(f => `<li>${f}</li>`).join("")}</ul>` : ""}
    <p class="price__src num">DVF, ventes signées de ${monthLabel(p.from)} à ${monthLabel(p.to)}${p.adj && p.carrez != null ? `. Surface Carrez pour ${p.carrez} % d’entre elles` : ""}${p.dep ? `. Comprend des ventes avec cave ou parking` : ""}.</p>
  </div>`;
}
function verdict(s) {
  if (s >= 80) return "Excellent coin";
  if (s >= 65) return "Très bon coin";
  if (s >= 50) return "Correct, avec des réserves";
  if (s >= 35) return "Peu convaincant";
  return "À éviter";
}
