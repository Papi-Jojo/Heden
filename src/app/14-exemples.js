/* =========================================================
   Exemples (clairement marqués) et divers
   ========================================================= */
function loadExamples() {
  const mk = (name, place, points, r, extra) => finishZoneGeometry(Object.assign({
    id: zoneId(), example: true, name, place, points, date: today(), moment: "Semaine, soir",
    ratings: r, price: null, fav: false, comment: "Zone d’exemple, à supprimer.", author: "", createdAt: Date.now(), updatedAt: 0
  }, extra || {}));
  state.zones.push(
    mk("Canal Saint-Martin (exemple)", "Paris 10e", [[48.8737,2.3628],[48.8728,2.3690],[48.8689,2.3672],[48.8694,2.3619]], {transports:4,prix:3,vie_sociale:5,securite:4,commerces:5,nuisances:2,verts:3,bati:4}, {fav: true}),
    mk("Batignolles (exemple)", "Paris 17e", [[48.8900,2.3154],[48.8897,2.3221],[48.8866,2.3236],[48.8846,2.3192],[48.8861,2.3146]], {transports:4,prix:3,vie_sociale:4,securite:5,commerces:4,nuisances:4,verts:5,bati:4}),
    mk("Porte de la Chapelle (exemple)", "Paris 18e", [[48.8996,2.3561],[48.8992,2.3627],[48.8956,2.3622],[48.8958,2.3565]], {transports:3,prix:4,vie_sociale:1,securite:1,commerces:2,nuisances:1,verts:1,bati:1})
  );
  save(); ui.sheet = "open";
  map.flyToBounds(L.latLngBounds(state.zones.filter(z => z.example).flatMap(z => z.points)).pad(0.3), {duration: .6});
  renderZones(); renderPanel();
}

let toastT = null;
/* La notification cherche une place libre : sous les barres et consignes du haut, sinon au-dessus
   de la feuille ou de la barre du bas. Elle ne recouvre jamais une barre de balade, une consigne
   de tracé, la recherche, les boutons de carte ou une fenêtre ouverte. */
const TOAST_AVOID = ".tip.is-in, .topbar, .tabbar, .map-top, .walkbar, .mapmode, .hint, .fab-col, #mapf.is-open .mapf__opt, .panel, .ask__card, .auth__card, .lsheet, .quiz, .leaflet-control-attribution";
function placeToast(t) {
  const vv = window.visualViewport, vh = vv ? vv.height : innerHeight, vw = innerWidth, gap = 10;
  t.style.top = "0px";
  const r = t.getBoundingClientRect(), h = r.height, x0 = r.left, x1 = r.right;
  const safeTop = parseFloat(getComputedStyle($("#app")).paddingTop) || 0;
  const boxes = $$(TOAST_AVOID).filter(el => el !== t && !el.closest("[hidden]") && getComputedStyle(el).visibility !== "hidden" && +getComputedStyle(el).opacity > 0.05)
    .flatMap(el => [...el.getClientRects()]).filter(b => b.width > 1 && b.height > 1 && b.bottom > 0 && b.top < vh && b.right > x0 - 4 && b.left < x1 + 4);
  const free = y => y >= 0 && y + h <= vh && !boxes.some(b => y < b.bottom + gap / 2 && y + h > b.top - gap / 2);
  const tall = b => b.height > vh * 0.55;
  const yt = Math.max(safeTop + 12, ...boxes.filter(b => !tall(b) && b.top + b.height / 2 < vh / 2).map(b => b.bottom + gap));
  const yb = Math.min(vh - 16, ...boxes.filter(b => b.top + b.height / 2 >= vh / 2).map(b => b.top - gap)) - h;
  /* Carte : en haut, la feuille occupe le bas. Pages et fenêtres : en bas, loin des titres. */
  const onMap = document.body.dataset.tab === "map" && !document.querySelector(".ask.is-open, .auth.is-open");
  let y = [onMap ? yt : yb, onMap ? yb : yt].find(free);
  if (y == null) { const ys = [...boxes.map(b => b.bottom + gap), ...boxes.map(b => b.top - gap - h)].filter(free).sort((a, b) => a - b); y = ys.length ? ys[0] : yt; }
  const top = Math.round(Math.max(8, Math.min(y, vh - h - 8)));
  t.style.top = top + "px"; t.style.setProperty("--ty", top + h / 2 < vh / 2 ? "-10px" : "10px");
}
/* Notifications : rares, courtes, avec une icône selon le cas (fait, erreur, info) et, si utile, une action */
const TOAST_ICO = {
  ok: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  err: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 6v7.5M12 18h.01"/></svg>',
  info: '<svg width="12" height="10" viewBox="0 0 12 10"><path d="M1.2 5.4C1.6 2.2 4 .6 6.6 1c2.7.4 4.6 2.3 4.2 4.6-.5 2.6-3 3.8-5.4 3.4C3 8.6.9 7.6 1.2 5.4z" fill="currentColor"/></svg>'
};
const TOAST_ERR = /impossible|refusée|incorrect|introuvable|invalide|bloqué|illisible|trop de demandes|pas encore (enregistrée|envoyées)|non enregistrés|indisponible|hors de la zone|au moins/i;
function toast(msg, action, kind) {
  const t = $("#toast");
  kind = kind || (TOAST_ERR.test(msg) ? "err" : action || /copié|ajouté|gardée|enregistr|connecté|importée|à jour|rejoint|reprise/i.test(msg) ? "ok" : "info");
  t.dataset.kind = kind;
  t.innerHTML = `<span class="toast__i" aria-hidden="true">${TOAST_ICO[kind] || TOAST_ICO.info}</span><span class="toast__m">${esc(msg)}</span>${action ? `<button class="toast__act" type="button">${esc(action.label)}</button>` : ""}`;
  const hide = () => { t.classList.remove("is-in"); t.classList.add("is-out"); clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; t.classList.remove("is-out"); }, 210); };
  if (action) t.querySelector(".toast__act").onclick = () => { clearTimeout(toastT); hide(); action.fn(); };
  clearTimeout(t._h); t.classList.remove("is-out", "is-in"); t.hidden = false;
  placeToast(t); void t.offsetWidth; t.classList.add("is-in");
  requestAnimationFrame(() => placeToast(t)); setTimeout(() => !t.hidden && placeToast(t), 160);
  const ms = action ? 5000 : kind === "err" ? 5200 : kind === "ok" ? Math.min(3600, Math.max(2000, String(msg).length * 45)) : Math.min(5200, Math.max(2600, String(msg).length * 50));
  clearTimeout(toastT); toastT = setTimeout(hide, ms);
}
document.addEventListener("keydown", e => { if (e.key === "Escape" && ui.mode === "placing" && !document.querySelector(".ask")) confirmCancelDraft(); });
window.addEventListener("resize", () => { if (!sheetDrag) applySheet(); });

/* L'attribution de la carte reste visible au-dessus de la feuille mobile */
try {
  new ResizeObserver(() => { if (!sheetDrag) applySheet(); }).observe(panel);
} catch (e) {}

/* Clavier ouvert (mobile) : on masque tout ce qui ne sert pas à la saisie */
const isTextField = el => !!el && (el.tagName === "TEXTAREA" || el.tagName === "SELECT" ||
  (el.tagName === "INPUT" && !/^(range|checkbox|radio|button|submit|file|color|hidden)$/.test(el.type)));
