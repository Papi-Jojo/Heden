/* Dans l'onglet Heden : transmet à l'app les pages lues par l'extension, et rend la réponse (combien d'annonces sont parties). */
(() => {
  if (window.__hedenPont) return; window.__hedenPont = 1;
  const V = chrome.runtime.getManifest().version;
  const annonce = () => window.postMessage({type: "heden-ext-ready", v: V}, location.origin);
  annonce(); setTimeout(annonce, 2000);
  try { chrome.runtime.sendMessage({type: "langue", lang: localStorage.getItem("heden.lang") || "fr"}); } catch (e) {}
  chrome.runtime.onMessage.addListener((m, s, rep) => {
    if (m.type !== "page") return;
    window.postMessage({type: "heden-ext-page", id: m.id, d: m.d}, location.origin);
    rep({ok: true});
  });
  window.addEventListener("message", e => {
    if (e.source !== window || !e.data) return;
    if (e.data.type === "heden-app-pret") { try { chrome.runtime.sendMessage({type: "langue", lang: localStorage.getItem("heden.lang") || "fr"}); } catch (er) {} return; }   // connecté : ce qui attendait peut partir
    if (e.data.type !== "heden-ext-ack") return;
    try { chrome.runtime.sendMessage(Object.assign({}, e.data, {type: "ack"})); } catch (er) {}
  });
})();
