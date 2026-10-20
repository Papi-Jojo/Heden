/* =========================================================
   Astuces : une bulle au premier usage de chaque écran, ancrée sur l’élément.
   Rien ne bloque : on peut continuer à utiliser l’app, ou tout passer.
   ========================================================= */
var TIPS_KEY = "heden.tips", tipsSt = null, tipCur = null, tipTimer = null, tipRaf = 0;
const TIPS = [
  {id: "carte-zone", sel: "#newZone", when: () => currentTab === "map" && ui.mode === "list", txt: "Tracez le coin que vous visitez, point par point, puis notez-le."},
  {id: "carte-balade", sel: "#walkBtn", when: () => currentTab === "map" && ui.mode === "list", txt: "En balade, lancez le suivi : Heden propose la zone d’après votre parcours."},
  {id: "carte-projet", sel: "#mapMode", when: () => currentTab === "map" && ui.mode === "list", txt: "Passez de l’achat à la location, sur la carte comme dans les annonces."},
  {id: "carte-filtres", sel: "#mapfBtn", when: () => currentTab === "map" && ui.mode === "list" && state.listings && state.listings.length > 0, txt: "Masquez les zones ou les annonces pour y voir plus clair."},
  {id: "zone-notes", sel: ".panel .crit", when: () => currentTab === "map" && ui.mode === "rating", txt: "Notez chaque critère de 0 à 5. En pointillés : l’estimation de Heden, à remplacer par votre ressenti."},
  {id: "annonces-ajout", sel: "#addListing", when: () => currentTab === "annonces" && !lui.openId, txt: "Collez une annonce, ou installez le bouton + Heden pour l’importer en un clic."},
  {id: "annonces-tri", sel: ".lrow .lqa", when: () => currentTab === "annonces" && !lui.openId, txt: "Gardez ou écartez d’un geste. Rien n’est perdu : chaque annonce reste dans sa pile."},
  {id: "annonce-avis", sel: ".feel", when: () => currentTab === "annonces" && !!lui.openId, txt: "La note ne vous semble pas juste ? Dites-le : Heden ajuste vos priorités."},
  {id: "profil-onglets", sel: ".ptabs", when: () => currentTab === "profile", txt: "Vos critères se règlent ici. Les cartes de groupe et la langue sont dans Compte."}
];
function tipsState() {
  if (tipsSt) return tipsSt;
  try { tipsSt = JSON.parse(localStorage.getItem(TIPS_KEY) || "{}"); } catch (e) { tipsSt = {}; }
  tipsSt.seen = tipsSt.seen || [];
  if (tipsSt.off == null && navigator.webdriver && !localStorage.getItem("__tips")) tipsSt.off = true;
  return tipsSt;
}
function tipsSave() { try { localStorage.setItem(TIPS_KEY, JSON.stringify({off: !!tipsSt.off, seen: tipsSt.seen})); } catch (e) {} }
function tipVisible(el) {
  if (!el || el.closest("[hidden]")) return false;
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  return r.width > 4 && r.height > 4 && r.bottom > 8 && r.top < innerHeight - 8 && cs.visibility !== "hidden" && +cs.opacity > .3;
}
function tipOverlay() { return !!document.querySelector("#quiz.is-open, .ask, .auth.is-open, #mapf.is-open") || ($("#lsheet") && !$("#lsheet").hidden && $("#lsheet").classList.contains("is-open")); }
function tipBlocked() {
  return tipOverlay() ||
    isTextField(document.activeElement) || !$("#toast").hidden || document.body.classList.contains("walking") || sheetDrag;
}
function tipsKick(delay) {
  try {
    const st = tipsState(); if (st.off) return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      if (tipCur) { if (!tipCur.tip.when() || !document.contains(tipCur.target)) tipHide(false); else return; }
      if (tipBlocked()) return tipsKick(1600);
      const t = TIPS.find(t => !st.seen.includes(t.id) && t.when() && tipVisible($(t.sel)));
      if (t) tipShow(t);
    }, delay ?? 900);
  } catch (e) {}
}
function tipPlace() {
  if (!tipCur) return;
  const {el, halo, tip} = tipCur;
  let target = tipCur.target;
  if (!document.contains(target)) { const nt = $(tip.sel); if (nt) tipCur.target = target = nt; }
  if (!tipVisible(target) || !tip.when() || tipOverlay()) { tipHide(false); return tipsKick(1600); }
  const r = target.getBoundingClientRect(), vw = innerWidth, vh = (window.visualViewport ? visualViewport.height : innerHeight);
  const pad = 5, rad = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 12;
  halo.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;border-radius:${Math.min(rad + pad, (r.height + pad * 2) / 2)}px`;
  const w = el.offsetWidth, h = el.offsetHeight, gap = 14;
  const bar = $(".tabbar"), bottomLimit = bar && tipVisible(bar) ? bar.getBoundingClientRect().top : vh;
  const below = r.bottom + pad + gap + h <= bottomLimit - 8, above = r.top - pad - gap - h >= 8;
  const down = below && (!above || r.top + r.height / 2 < vh * 0.55);
  const y = down ? r.bottom + pad + gap : r.top - pad - gap - h;
  const cx = r.left + r.width / 2, x = Math.round(Math.max(12, Math.min(cx - w / 2, vw - w - 12)));
  el.style.left = x + "px"; el.style.top = Math.round(y) + "px";
  el.dataset.side = down ? "bas" : "haut";
  el.style.setProperty("--ax", Math.round(Math.max(18, Math.min(cx - x, w - 18))) + "px");
}
function tipLoop() { tipPlace(); if (tipCur) tipRaf = requestAnimationFrame(tipLoop); }
function tipShow(tip) {
  const target = $(tip.sel); if (!target) return;
  const halo = document.createElement("div"); halo.className = "tiphalo"; halo.setAttribute("aria-hidden", "true");
  const el = document.createElement("div"); el.className = "tip"; el.setAttribute("role", "dialog"); el.setAttribute("aria-live", "polite");
  const n = TIPS.filter(t => !tipsState().seen.includes(t.id)).length;
  el.innerHTML = `<p class="tip__txt">${esc(tip.txt)}</p><div class="tip__acts"><button type="button" class="tip__skip">Passer les astuces</button><button type="button" class="tip__ok">Compris</button></div>`;
  document.body.append(halo, el);
  tipCur = {tip, target, el, halo};
  tipPlace();
  requestAnimationFrame(() => { el.classList.add("is-in"); halo.classList.add("is-in"); });
  cancelAnimationFrame(tipRaf); tipRaf = requestAnimationFrame(tipLoop);
  el.querySelector(".tip__ok").onclick = () => tipHide(true);
  el.querySelector(".tip__skip").onclick = () => { tipsState().off = true; tipsSave(); tipHide(true); if (currentTab === "profile") renderProfile(); toast("Astuces désactivées : réactivez-les dans Profil, Compte"); };
}
function tipHide(seen) {
  if (!tipCur) return;
  const {tip, el, halo} = tipCur; tipCur = null; cancelAnimationFrame(tipRaf);
  if (seen && !tipsState().seen.includes(tip.id)) { tipsSt.seen.push(tip.id); tipsSave(); }
  el.classList.remove("is-in"); el.classList.add("is-out"); halo.classList.remove("is-in"); halo.classList.add("is-out");
  setTimeout(() => { el.remove(); halo.remove(); }, 260);
  if (seen) tipsKick(1100);
}
document.addEventListener("pointerdown", e => { if (tipCur && !tipCur.el.contains(e.target) && tipCur.target.contains(e.target)) tipHide(true); }, true);
document.addEventListener("keydown", e => { if (e.key === "Escape" && tipCur) tipHide(true); });
window.addEventListener("resize", () => tipPlace());
document.addEventListener("scroll", () => { if (!tipCur && tipsSt && !tipsSt.off) tipsKick(700); }, true);
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
