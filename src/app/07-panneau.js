/* =========================================================
   Panneau latéral / feuille mobile
   ========================================================= */
const panel = $("#panel");

function setHint(t) { const h = $("#hint"); h.hidden = !t; if (t) h.textContent = t; }
function placeLabel(z) { return [z.place, z.area ? fmtArea(z.area) : ""].filter(Boolean).join(", "); }

let lastMode = null;
function renderPanel() { setTimeout(() => tipsKick(), 0);
  panel.dataset.mode = ui.mode;
  document.body.dataset.mode = ui.mode;
  /* chaque nouveau mode ouvre la feuille ; la liste démarre repliée sur mobile */
  if (ui.mode !== lastMode) { ui.sheet = ui.mode === "list" ? "mini" : "open"; lastMode = ui.mode; }
  if (ui.mode === "list") renderList();
  else if (ui.mode === "placing") renderPlacing();
  else if (ui.mode === "rating") renderRating();
  else if (ui.mode === "detail") renderDetail();
  applySheet();
}
