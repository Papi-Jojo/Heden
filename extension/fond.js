/* Heden : relais entre les pages immobilières ouvertes (lecteur.js) et l'onglet Heden (pont.js).
   Aucune page n'est ouverte ni lue en dehors de celles que l'utilisateur consulte : seul l'onglet Heden est ouvert si besoin. */
const HEDEN = "__HEDEN__", HEDENM = __HEDENM__;   // l'adresse de Heden, avec ou sans « / » final, quelle que soit la casse du chemin
const attente = new Map();   // envoi → onglet d'origine, pour lui rendre la réponse
async function ongletHeden() {
  const ts = await chrome.tabs.query({url: HEDENM});
  if (ts.length) return ts.find(t => t.status === "complete") || ts[0];
  return chrome.tabs.create({url: HEDEN + "#annonces", active: false});
}
const joindre = async (id, msg) => { try { const r = await chrome.tabs.sendMessage(id, msg); return !!(r && r.ok); } catch (e) { return false; } };
// onglet Heden ouvert avant l'installation (ou la mise à jour) de l'extension : on y ajoute le pont
const brancher = id => chrome.scripting.executeScript({target: {tabId: id}, files: ["pont.js"]}).catch(() => {});
async function envoyer(msg) {
  let t = await ongletHeden();
  if (t.discarded) await chrome.tabs.reload(t.id).catch(() => {});   // onglet mis en veille par le navigateur
  for (let k = 0; k < 40; k++) {   // l'onglet Heden peut être en train de se charger
    if (await joindre(t.id, msg)) return true;
    if (k === 1 || k === 8) await brancher(t.id);
    if (k === 16) { t = await ongletHeden(); if (t.discarded) await chrome.tabs.reload(t.id).catch(() => {}); }
    await new Promise(r => setTimeout(r, 750));
  }
  return false;
}
async function compter(m) {
  const auj = new Date().toISOString().slice(0, 10);
  const {stats} = await chrome.storage.local.get({stats: {}});
  const s = stats.jour === auj ? stats : {jour: auj, nouvelles: 0, revues: 0, fiches: 0};
  s.nouvelles += m.nouvelles || 0; s.revues += m.revues || 0; if (m.liste === false && m.n) s.fiches += 1;
  s.dernier = Date.now(); s.err = m.err || null;
  await chrome.storage.local.set({stats: s});
}
chrome.runtime.onMessage.addListener((m, s) => {
  if (m.type === "page" && s.tab) {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36); attente.set(id, s.tab.id);
    envoyer({type: "page", id, d: m.d}).then(ok => { if (!ok) { attente.delete(id); chrome.tabs.sendMessage(s.tab.id, {type: "ack", err: "heden"}).catch(() => {}); } });
  } else if (m.type === "ack") {
    const src = attente.get(m.id); attente.delete(m.id); compter(m);
    if (src != null) {
      chrome.tabs.sendMessage(src, m).catch(() => {});
      if (m.nouvelles) chrome.action.setBadgeText({tabId: src, text: String(Math.min(999, m.nouvelles))}).catch(() => {});
    }
  } else if (m.type === "langue" && m.lang) chrome.storage.local.set({lang: m.lang});
});
chrome.runtime.onInstalled.addListener(async () => {
  chrome.action.setBadgeBackgroundColor({color: "#7F5539"});
  for (const t of await chrome.tabs.query({url: HEDENM})) brancher(t.id);   // onglets Heden déjà ouverts
});
