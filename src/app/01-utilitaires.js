/* =========================================================
   Utilitaires
   ========================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const zoneId = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
  : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
const clone = o => JSON.parse(JSON.stringify(o));
const fmtInt = n => Math.round(n).toLocaleString("fr-FR");
const fmtNote = v => Number.isInteger(v) ? String(v) : v.toLocaleString("fr-FR", {maximumFractionDigits: 1});
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = d => { try { return new Date(d + "T12:00:00").toLocaleDateString("fr-FR", {day:"numeric", month:"short", year:"numeric"}); } catch(e) { return d; } };
const GALETS = `<svg class="galets" viewBox="0 0 120 92" aria-hidden="true"><path class="g1" d="M14 50c2-14 18-24 33-20 13 4 18 18 11 29-7 12-25 17-37 11-6-3-8-12-7-20z"/><path class="g2" d="M62 22c6-9 21-11 29-4 7 6 5 17-3 22-9 6-22 5-27-2-3-5-2-11 1-16z"/><path class="g3" d="M70 58c5-8 18-10 26-4 7 6 6 16-2 21-8 6-21 5-25-2-3-4-2-10 1-15z"/><path class="g4" d="M38 12c3-6 12-8 17-4 4 3 4 10-1 13-5 4-13 3-16-1-2-2-1-6 0-8z"/></svg>`;
const HEART = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z"/></svg>';

function interp(stops, score) {
  const s = Math.max(0, Math.min(100, score));
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i - 1], [p2, c2] = stops[i];
    if (s <= p2) { const t = (s - p1) / (p2 - p1); const c = c1.map((v, k) => Math.round(v + (c2[k] - v) * t)); return `rgb(${c[0]},${c[1]},${c[2]})`; }
  }
  const c = stops[stops.length - 1][1]; return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function colorFor(score) { return score == null ? "#A39B90" : interp(STOPS, score); }
function traitMap(score) { return score == null ? "#857B6E" : interp(TRAIT_JOUR, score); }
function traitFor(score) { return score == null ? "#857B6E" : interp(window.matchMedia("(prefers-color-scheme: dark)").matches ? TRAIT_NUIT : TRAIT_JOUR, score); }
const GRADIENT = STOPS.map(([p, c]) => `rgb(${c.join(",")}) ${p}%`).join(",");
document.documentElement.style.setProperty("--g", GRADIENT);
