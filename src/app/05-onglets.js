/* =========================================================
   Onglets
   ========================================================= */
let currentTab = "map";
function countUp(root = document) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  $$("[data-count]", root).forEach(el => {
    const to = +el.dataset.count; el.removeAttribute("data-count");
    if (reduce || !isFinite(to) || to <= 0) return;
    const t0 = performance.now(), d = 520;
    const step = t => { const k = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(to * e); if (k < 1) requestAnimationFrame(step); };
    el.textContent = "0"; requestAnimationFrame(step);
  });
}
function setTab(t) { setTimeout(() => tipsKick(), 0);
  currentTab = t;
  document.body.dataset.tab = t;
  $$("[data-tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  $("#view-map").hidden = t !== "map";
  $("#view-profile").hidden = t !== "profile";
  $("#view-annonces").hidden = t !== "annonces";
  if (t === "map") { setTimeout(() => map.invalidateSize(), 0); renderZones(); renderPanel(); renderListingPins(); }
  else if (t === "annonces") renderListings();
  else renderProfile();
  const vw = $(t === "annonces" ? "#view-annonces" : t === "profile" ? "#view-profile" : "#view-map");
  if (vw) { vw.classList.remove("view--in"); void vw.offsetWidth; vw.classList.add("view--in"); setTimeout(() => vw.classList.remove("view--in"), 400); }
  try { if (!/(access_token|error_description|error_code|import)=/.test(location.hash)) history.replaceState(null, "", t === "profile" ? "#profil" : t === "annonces" ? "#annonces" : "#carte"); } catch (e) {}
}
$$("[data-tab]").forEach(b => b.addEventListener("click", () => b.dataset.tab === currentTab ? tabHome(b.dataset.tab) : setTab(b.dataset.tab)));
/* Onglet déjà ouvert : on revient à son menu (liste des annonces, liste des zones, haut du profil) */
function tabHome(t) {
  const smooth = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  if (t === "annonces") {
    if (lui.openId) { lui.openId = null; renderListings(); }
    else $("#view-annonces").scrollTo({top: 0, behavior: smooth});
  } else if (t === "map") {
    if (ui.mode === "detail") { selectedId = null; ui.mode = "list"; renderZones(); renderPanel(); const pn = $(".panel"); if (pn) { pn.classList.remove("swap-in"); void pn.offsetWidth; pn.classList.add("swap-in"); setTimeout(() => pn.classList.remove("swap-in"), 300); } }
  } else $("#view-profile").scrollTo({top: 0, behavior: smooth});
}
