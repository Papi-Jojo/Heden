/* Heden — traduction à l’affichage (anglais). Le français reste la langue du code. */
(function () {
  var lang = "fr";
  try { lang = localStorage.getItem("heden.lang") === "en" ? "en" : "fr"; } catch (e) {}
  window.HEDEN_LANG = lang;
  if (lang !== "en") return;
  var root = document.documentElement;
  root.lang = "en"; root.classList.add("i18n-wait");
  var reveal = function () { root.classList.remove("i18n-wait"); };
  setTimeout(reveal, 1500);
  var NUM = /\d(?:[\d    .,]*\d)?/g;
  var MO = {"janv.": "Jan", "févr.": "Feb", "mars": "Mar", "avr.": "Apr", "mai": "May", "juin": "Jun", "juil.": "Jul", "août": "Aug", "sept.": "Sep", "oct.": "Oct", "nov.": "Nov", "déc.": "Dec"};
  var MORE = /(\d) (janv\.|févr\.|mars|avr\.|mai|juin|juil\.|août|sept\.|oct\.|nov\.|déc\.)(?=[\s,.)]|$)/g;
  var MOY = /(^|[\s(])(janv\.|févr\.|mars|avr\.|mai|juin|juil\.|août|sept\.|oct\.|nov\.|déc\.)(?= \d{4})/g;
  var EX = null, BK = {}, GEN = [], memo = new Map();
  var esc = function (c) { return c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); };
  function compile(k, v) {
    var re = "^", kinds = [], lit = 0;
    for (var i = 0; i < k.length; i++) {
      var c = k[i];
      if (c === "*") { re += "([\\s\\S]*?)"; kinds.push("*"); }
      else if (c === "§") { re += "(s?)"; kinds.push("*"); }
      else if (c === "#") { re += "(\\d(?:[\\d\\u00a0\\u202f\\u2009 .,]*\\d)?)"; kinds.push("#"); }
      else { re += esc(c); lit++; }
    }
    return {re: new RegExp(re + "$"), kinds: kinds, v: v, lit: lit, nw: kinds.filter(function (x) { return x === "*"; }).length};
  }
  function byLit(a, b) { return b.lit - a.lit || a.nw - b.nw; }
  function ordinal(s) {
    return s.replace(/\b(\d+)th\b/g, function (m, n) { var x = +n % 100, y = +n % 10; return n + (x > 10 && x < 14 ? "th" : y === 1 ? "st" : y === 2 ? "nd" : y === 3 ? "rd" : "th"); });
  }
  function fill(v, nums, wild, depth) {
    var ni = 0, wi = 0;
    return ordinal(v.replace(/([*#])([1-9])?/g, function (m, t, ix) {
      if (t === "#") { var n = ix ? nums[ix - 1] : nums[ni++]; return n == null ? "" : n; }
      var w = ix ? wild[ix - 1] : wild[wi++]; return w == null ? "" : tr(w, depth + 1);
    }));
  }
  function tr(s, depth, free) {
    depth = depth || 0;
    if (!s || depth > 8 || !/[A-Za-zÀ-ÿ]/.test(s)) return s;
    if (!depth && memo.has(s)) return memo.get(s);
    var lead = s.match(/^\s*/)[0], trail = s.slice(lead.length).match(/\s*$/)[0];
    var core = s.slice(lead.length, s.length - trail.length).replace(/\s+/g, " ");
    var c2 = core.replace(MORE, function (m, d, mo) { return d + " " + MO[mo]; }).replace(MOY, function (m, d, mo) { return d + MO[mo]; });
    var out = null, nums = [];
    var k = c2.replace(NUM, function (m) { nums.push(m); return "#"; });
    var v = EX[k];
    if (v != null) out = fill(v, nums, [], depth);
    else {
      var list = (BK[c2.slice(0, 2)] || []).concat(/^\d/.test(c2) ? BK["#"] || [] : [], GEN).sort(byLit);
      var cm = depth && !free && c2.indexOf(", ") >= 0;
      for (var i = 0; i < list.length && out == null; i++) {
        var p = list[i]; if (cm && p.k.indexOf(",") < 0) continue;
        var m = p.re.exec(c2);
        if (!m) continue;
        var ns = [], ws = [], bad = false;
        for (var j = 0; j < p.kinds.length; j++) (p.kinds[j] === "#" ? ns : ws).push(m[j + 1]);
        for (var q2 = 0; q2 < ws.length && !bad; q2++) { var w0 = ws[q2] || "", dp = 0; for (var q3 = 0; q3 < w0.length && dp >= 0; q3++) dp += w0[q3] === "(" ? 1 : w0[q3] === ")" ? -1 : 0; bad = dp !== 0; }
        if (bad) continue;
        out = fill(p.v, ns, ws, depth);
      }
      if (out == null && /\.$/.test(c2) && c2.length > 3) { var t0 = tr(c2.slice(0, -1), depth + 1, free); if (t0 !== c2.slice(0, -1)) out = t0 + "."; }
      if (out == null && / ·$/.test(c2)) { var t3 = tr(c2.slice(0, -2), depth + 1, free); if (t3 !== c2.slice(0, -2)) out = t3 + " ·"; }
      if (out == null && !free && c2.indexOf(" · ") > 0) {
        var t1 = c2.split(" · ").map(function (x) { return tr(x, depth + 1); }).join(" · ");
        if (t1 !== c2) out = t1;
      }
      if (out == null && !free && c2.indexOf(", ") >= 0) {
        var parts = c2.split(", "), acc = [];
        for (var q = 0; q < parts.length; q++) {
          var two = q + 1 < parts.length && parts[q] && parts[q + 1] ? parts[q] + ", " + parts[q + 1] : null;
          if (two && EX[two.replace(NUM, "#")] != null) { acc.push(tr(two, depth + 1, true)); q++; } else acc.push(tr(parts[q], depth + 1));
        }
        var t2 = acc.join(", "); if (t2 !== c2) out = t2;
      }
      if (out == null) out = c2 === core ? null : c2;
    }
    var res = out == null ? s : lead + out + trail;
    if (!depth) { if (memo.size > 6000) memo.clear(); memo.set(s, res); }
    return res;
  }
  window.__t = function (s) { return EX ? tr(String(s)) : String(s); };
  var SKIP = "script,style,textarea,noscript,[data-i18n-skip],.leaflet-tile-pane,.maplibregl-map,.leaflet-control-attribution";
  var ATTRS = ["placeholder", "aria-label", "title", "alt"];
  var seen = new WeakMap();
  var FIL = {acceptNode: function (n) { if (n.nodeType === 1 && n.matches(SKIP)) { if (n.matches("textarea")) doAttrs(n); return 2; } return 1; }};
  var DBG = false; try { DBG = localStorage.getItem("heden.i18ndebug") === "1"; } catch (e) {}
  var FRW = /[éèêàùçâîôœ]|\b(le|la|les|des|du|une?|et|vos|votre|pour|sur|dans|avec|pas|est|au|aux|sans|par|cette|ce|à|zone|annonce|loyer|prix|carte|note)\b/i;
  function miss(v, t) { if (DBG && FRW.test(t)) console.log("I18NMISS|" + v.replace(/\s+/g, " ").trim() + "|" + t.replace(/\s+/g, " ").trim()); }
  function doText(n, known) {
    var v = n.nodeValue;
    if (!v || seen.get(n) === v) return;
    if (!known) { var p = n.parentElement; if (!p || p.closest(SKIP)) return; }
    var t = tr(v); seen.set(n, t); miss(v, t);
    if (t !== v) n.nodeValue = t;
  }
  function doAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute(a);
      if (!v || el.__i18n && el.__i18n[a] === v) continue;
      if (el.closest("[data-i18n-skip],script,style")) return;
      var t = tr(v); (el.__i18n = el.__i18n || {})[a] = t; miss(v, t);
      if (t !== v) el.setAttribute(a, t);
    }
  }
  function doVal(el) {
    if (el.__i18nv || el.tagName !== "INPUT" || !el.hasAttribute("data-i18n-val")) return;
    el.__i18nv = 1; var tv = tr(el.value); miss(el.value, tv); if (tv !== el.value) el.value = tv;
  }
  function doTree(node) {
    if (node.nodeType === 3) return doText(node);
    if (node.nodeType !== 1) return;
    if (node.closest(SKIP)) { if (node.matches("textarea")) doAttrs(node); return; }
    doAttrs(node);
    var w = document.createTreeWalker(node, 5, FIL), n;
    doVal(node);
    while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n, true); else { doAttrs(n); doVal(n); } }
  }
  var mo = new MutationObserver(function (recs) {
    if (!EX) return;
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      if (r.type === "childList") for (var j = 0; j < r.addedNodes.length; j++) doTree(r.addedNodes[j]);
      else if (r.type === "characterData") doText(r.target);
      else if (r.type === "attributes" && r.target.nodeType === 1) doAttrs(r.target);
    }
  });
  mo.observe(root, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS});
  fetch("i18n/en.json?v=9").then(function (r) { return r.json(); }).then(function (d) {
    EX = d.exact;
    var ps = Object.keys(d.pat).map(function (k) { var p = compile(k, d.pat[k]); p.k = k; return p; });
    ps.sort(byLit);
    ps.forEach(function (p) { var h = p.k.slice(0, 2); if (/[*#]/.test(h[0])) { if (h[0] === "#") (BK["#"] = BK["#"] || []).push(p); else GEN.push(p); } else if (/[*#]/.test(h[1])) GEN.push(p); else (BK[h] = BK[h] || []).push(p); });
    var go = function () { document.title = tr(document.title); if (document.body) doTree(document.body); reveal(); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
  }).catch(reveal);
})();
