const HEDEN = "__HEDEN__";
const EN = {tA: "Automatic reading", tAs: "Every listings page you open goes to Explore.", tJ: "Today", lN: "new", lR: "seen again", lF: "full listings", relire: "Read page again", ouvrir: "Open Heden", tP: "Heden only reads the pages you open."};
chrome.storage.local.get({auto: true, stats: {}, lang: "fr"}, ({auto, stats, lang}) => {
  if (lang === "en") { document.documentElement.lang = "en"; Object.entries(EN).forEach(([id, t]) => { const e = document.getElementById(id); if (e) e.textContent = t; }); }
  const sw = document.getElementById("auto"); sw.setAttribute("aria-checked", String(auto !== false));
  sw.onclick = () => { const on = sw.getAttribute("aria-checked") !== "true"; sw.setAttribute("aria-checked", String(on)); chrome.storage.local.set({auto: on}); };
  const auj = new Date().toISOString().slice(0, 10), s = stats.jour === auj ? stats : {};
  document.getElementById("nN").textContent = s.nouvelles || 0; document.getElementById("nR").textContent = s.revues || 0; document.getElementById("nF").textContent = s.fiches || 0;
});
document.getElementById("ouvrir").onclick = async () => {
  const ts = await chrome.tabs.query({url: HEDEN + "*"});
  if (ts.length) { await chrome.tabs.update(ts[0].id, {active: true}); await chrome.windows.update(ts[0].windowId, {focused: true}); }
  else await chrome.tabs.create({url: HEDEN + "#annonces"});
  window.close();
};
document.getElementById("relire").onclick = async () => {
  const [t] = await chrome.tabs.query({active: true, currentWindow: true});
  if (t) chrome.tabs.sendMessage(t.id, {type: "relire"}).catch(() => {});
  window.close();
};
