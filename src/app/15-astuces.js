/* =========================================================
   Guide : au premier lancement, une visite pas à pas des écrans principaux (Carte, Annonces, Favoris, Profil).
   Chaque étape éclaire un élément et dit à quoi il sert. « Passer le guide » est toujours là ; Profil, Compte le relance.
   ========================================================= */
var TIPS_KEY = "heden.tips", tipsSt = null, tipCur = null, tipRaf = 0, tourI = -1;
const TOUR = [
  {tab: "map", sel: ["#newZone"], titre: "Vos zones", txt: "Tracez le coin que vous visitez, point par point, ou partez d’une zone prédéfinie. Puis notez-le, critère par critère."},
  {tab: "map", sel: ["#walkBtn"], titre: "En balade", txt: "Lancez le suivi en marchant : Heden propose la zone d’après votre parcours."},
  {tab: "map", sel: ["#mapfBtn"], titre: "Ce que montre la carte", txt: "Vos zones et vos annonces favorites. Masquez l’un ou l’autre pour y voir plus clair."},
  {tab: "annonces", sel: [".feeds"], titre: "Deux flux d’annonces", txt: "Explorer : les annonces des sites immobiliers, notées pour vous. Mes ajouts : celles que vous ajoutez vous-même."},
  {tab: "annonces", sel: ["#addListing"], titre: "Ajouter une annonce", txt: "Collez son texte, ou installez le bouton + Heden : sur la page d’une annonce, un clic suffit, photos comprises."},
  {tab: "favoris", sel: [".tabbar [data-tab=favoris]", ".tabs [data-tab=favoris]"], titre: "Vos favoris", txt: "Touchez le cœur d’une annonce : elle se range ici et apparaît sur la carte, avec sa note."},
  {tab: "profile", sel: [".ptabs"], titre: "Vos critères", txt: "Ce qui compte pour vous se règle ici : quelques questions, et Heden note chaque annonce selon vous. Le poids du logement, du quartier et du prix est dans Note ; le compte et ce guide, dans Compte."}
];
function tipsState() {
  if (tipsSt) return tipsSt;
  try { tipsSt = JSON.parse(localStorage.getItem(TIPS_KEY) || "{}"); } catch (e) { tipsSt = {}; }
  if (tipsSt.off == null && navigator.webdriver && !localStorage.getItem("__tips")) tipsSt.off = true;
  return tipsSt;
}
function tipsSave() { try { localStorage.setItem(TIPS_KEY, JSON.stringify({off: !!tipsSt.off, done: !!tipsSt.done})); } catch (e) {} }
function tipVisible(el) {
  if (!el || el.closest("[hidden]")) return false;
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  return r.width > 4 && r.height > 4 && r.bottom > 8 && r.top < innerHeight - 8 && cs.visibility !== "hidden" && +cs.opacity > .3;
}
function tipOverlay() { return !!document.querySelector("#quiz.is-open, .ask, .auth.is-open, #mapf.is-open") || ($("#lsheet") && !$("#lsheet").hidden && $("#lsheet").classList.contains("is-open")); }
function tipBlocked() { return tipOverlay() || isTextField(document.activeElement) || !$("#toast").hidden || document.body.classList.contains("walking") || sheetDrag || !!document.getElementById("splash"); }
/* appelé au fil de l'app : lance le guide une fois, au premier lancement, dès que rien d'autre n'est ouvert */
function tipsKick(delay) {
  try {
    const st = tipsState(); if (st.off || st.done || tourI >= 0) return;
    clearTimeout(tipsKick.t);
    tipsKick.t = setTimeout(() => { if (tourI >= 0) return; if (tipBlocked() || currentTab !== "map") return tipsKick(1600); tourStart(); }, delay ?? 1400);
  } catch (e) {}
}
function tourStart() { tipHide(); tourI = 0; tourShow(); }
async function tourShow() {
  const step = TOUR[tourI]; if (!step) return tourEnd(true);
  if (step.tab && currentTab !== step.tab) { lui.openId = null; setTab(step.tab); }
  let target = null;
  for (let k = 0; k < 25 && !target; k++) { target = step.sel.map(x => $(x)).find(tipVisible) || null; if (!target) await new Promise(r => setTimeout(r, 120)); }
  if (tourI < 0) return;
  if (!target) { tourI++; return tourShow(); }                 // élément absent sur cet écran : étape suivante
  tourVoir(target);
  tipHide();
  const veil = document.createElement("div"); veil.className = "tipveil";
  const halo = document.createElement("div"); halo.className = "tiphalo tiphalo--tour"; halo.setAttribute("aria-hidden", "true");
  const el = document.createElement("div"); el.className = "tip tip--tour"; el.setAttribute("role", "dialog"); el.setAttribute("aria-labelledby", "tipT"); el.setAttribute("aria-describedby", "tipX");
  const last = tourI === TOUR.length - 1;
  el.innerHTML = `<p class="tip__titre" id="tipT">${esc(step.titre)}</p><p class="tip__txt" id="tipX">${esc(step.txt)}</p>
    <div class="tip__acts"><button type="button" class="tip__skip">Passer le guide</button><span class="tip__n num">${tourI + 1} / ${TOUR.length}</span><button type="button" class="tip__ok">${last ? (quizDue() ? "Définir mon profil" : "C’est parti") : "Suivant"}</button></div>`;
  document.body.append(veil, halo, el);
  tipCur = {tip: {when: () => true, sel: step.sel[0]}, target, el, halo, veil};
  tipPlace();
  requestAnimationFrame(() => { el.classList.add("is-in"); halo.classList.add("is-in"); veil.classList.add("is-in"); });
  cancelAnimationFrame(tipRaf); tipRaf = requestAnimationFrame(tipLoop);
  el.querySelector(".tip__ok").onclick = () => { tourI++; tourShow(); };
  el.querySelector(".tip__skip").onclick = () => tourEnd(false);
  setTimeout(() => { const b = el.querySelector(".tip__ok"); if (b && document.contains(b)) b.focus({preventScroll: true}); }, 60);
}
/* Amène l'élément à l'écran en faisant défiler sa vue seulement : scrollIntoView ferait glisser toute la page sur iPhone (app sur l'écran d'accueil) */
function tourVoir(t) {
  try { if (window.scrollY || document.documentElement.scrollTop) window.scrollTo(0, 0); } catch (e) {}
  let sc = t.parentElement;
  while (sc && sc !== document.body) { const o = getComputedStyle(sc).overflowY; if ((o === "auto" || o === "scroll") && sc.scrollHeight > sc.clientHeight) break; sc = sc.parentElement; }
  if (!sc || sc === document.body) return;
  const r = t.getBoundingClientRect(), b = tourBornes();
  if (r.top < b.haut + 8 || r.bottom > b.bas - 8) sc.scrollTop += r.top - (b.haut + 24);
}
/* Haut et bas utiles de l'écran : sous la barre du haut, au-dessus de la barre d'onglets (encoches comprises) */
function tourBornes() {
  const vh = window.visualViewport ? visualViewport.height : innerHeight, tb = $(".tabbar"), top = $(".topbar");
  const bas = tb && tb.offsetParent ? tb.getBoundingClientRect().top : vh;
  let sa = tourBornes.sa;   // encoche (app sur l'écran d'accueil de l'iPhone) : env(safe-area-inset-top), mesurée une fois
  if (sa == null) { const p = document.createElement("div"); p.style.cssText = "position:fixed;top:0;height:0;padding-top:env(safe-area-inset-top,0px);visibility:hidden"; document.body.appendChild(p); sa = tourBornes.sa = p.offsetHeight || 0; p.remove(); }
  const tr = top && top.offsetParent ? top.getBoundingClientRect() : null;
  return {haut: Math.max(sa, tr && tr.bottom > 0 ? tr.bottom : 0), bas: Math.min(vh, bas), vh};
}
function tourEnd(fini) {
  tourI = -1; tipHide();
  const st = tipsState(); st.done = true; tipsSave();
  if (currentTab !== "map") setTab("map");
  if (quizDue()) return setTimeout(() => openQuiz(), 260);   // le profil d'abord : sans lui, les notes sont celles d'un inconnu
  toast(fini ? "Bonne recherche ! Le guide reste dans Profil, Compte." : "Guide passé : il reste dans Profil, Compte.");
}
function tipPlace() {
  if (!tipCur) return;
  const {el, halo, target} = tipCur;
  if (!document.contains(target)) return;
  const r = target.getBoundingClientRect(), vw = innerWidth, vh = (window.visualViewport ? visualViewport.height : innerHeight);
  const pad = 6, rad = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 12;
  // le halo reste dans l'écran (une barre d'onglets avec la marge de l'encoche dépasserait en bas)
  const hl = Math.max(2, r.left - pad), ht = Math.max(2, r.top - pad), hr = Math.min(vw - 2, r.right + pad), hb = Math.min(vh - 2, r.bottom + pad);
  halo.style.cssText = `left:${hl}px;top:${ht}px;width:${hr - hl}px;height:${hb - ht}px;border-radius:${Math.min(rad + pad, (hb - ht) / 2)}px`;
  /* Téléphone : la bulle du guide se pose en bas, au-dessus des onglets, ou en haut si l'élément est dans la moitié basse ;
     toute la largeur, jamais à cheval sur l'élément ni coupée par l'écran */
  if (el.classList.contains("tip--tour") && !isDesktop()) {
    const b = tourBornes(), inBar = !!target.closest(".tabbar"), h = el.offsetHeight, w = Math.min(vw - 24, 440);
    const enHaut = !inBar && (r.top + r.bottom) / 2 > (b.haut + b.bas) / 2;
    const y = enHaut ? Math.max(b.haut + 12, Math.min(r.top - pad - 14 - h, b.haut + 12)) : Math.max(b.haut + 12, b.bas - h - 14);
    el.classList.add("is-dock"); el.style.width = w + "px"; el.style.left = Math.round((vw - w) / 2) + "px"; el.style.top = Math.round(y) + "px";
    const colle = inBar || (enHaut ? false : Math.abs(y + h - (r.top - pad)) < 40);   // la flèche seulement quand la bulle touche l'élément
    el.dataset.side = colle ? "haut" : "dock";
    el.style.setProperty("--ax", Math.round(Math.max(22, Math.min(r.left + r.width / 2 - (vw - w) / 2, w - 22))) + "px");
    return;
  }
  el.classList.remove("is-dock"); el.style.width = "";
  const w = el.offsetWidth, h = el.offsetHeight, gap = 14;
  const below = r.bottom + pad + gap + h <= vh - 8, above = r.top - pad - gap - h >= 8;
  const down = below && (!above || r.top + r.height / 2 < vh * 0.55);
  const y = down ? r.bottom + pad + gap : above ? r.top - pad - gap - h : Math.max(8, vh - h - 8);
  const cx = r.left + r.width / 2, x = Math.round(Math.max(12, Math.min(cx - w / 2, vw - w - 12)));
  el.style.left = x + "px"; el.style.top = Math.round(y) + "px";
  el.dataset.side = down ? "bas" : "haut";
  el.style.setProperty("--ax", Math.round(Math.max(18, Math.min(cx - x, w - 18))) + "px");
}
function tipLoop() { tipPlace(); if (tipCur) tipRaf = requestAnimationFrame(tipLoop); }
function tipHide() {
  if (!tipCur) return;
  const {el, halo, veil} = tipCur; tipCur = null; cancelAnimationFrame(tipRaf);
  [el, halo, veil].forEach(x => { if (!x) return; x.classList.remove("is-in"); x.classList.add("is-out"); setTimeout(() => x.remove(), 260); });
}
document.addEventListener("keydown", e => { if (e.key === "Escape" && tourI >= 0) { e.preventDefault(); tourEnd(false); } });
window.addEventListener("resize", () => tipPlace());
document.addEventListener("focusin", e => {
  if (isDesktop() || !isTextField(e.target)) return;
  document.body.classList.add("kbd");
  const inPanel = !!e.target.closest("#panel");
  document.body.classList.toggle("kbd-panel", inPanel);
  if (inPanel) { ui.sheet = "open"; applySheet(); }
  setTimeout(() => { try { e.target.scrollIntoView({block: "center", behavior: "smooth"}); } catch (err) {} }, 280);
});
document.addEventListener("focusout", () => {
  setTimeout(() => {
    if (isTextField(document.activeElement)) return;
    document.body.classList.remove("kbd", "kbd-panel");
    if (!sheetDrag) applySheet();
  }, 150);
});

/* La carte change de taille quand les barres apparaissent ou disparaissent */
try { new ResizeObserver(() => map.invalidateSize({pan: false})).observe(document.getElementById("map")); } catch (e) {}
