/* Heden hors connexion : la page s'ouvre sans réseau avec la dernière version vue.
   - page : réseau d'abord (toujours la dernière version), cache si hors ligne ;
   - fichiers de l'app (noms à empreinte), bibliothèques, polices, données du quartier : cache, mis à jour en arrière-plan ;
   - Supabase, géocodage, itinéraires, photos des annonces : jamais en cache (comptes et données vivantes). */
const CACHE = "heden-v1";
const VIVANT = /supabase\.co|nominatim|routing\.openstreetmap|\/auth\/|\/rest\/|\/storage\//;
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(["./", "./index.html", "./manifest.webmanifest"]).catch(() => {}))); });
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || VIVANT.test(r.url)) return;
  if (r.mode === "navigate") {
    e.respondWith(fetch(r).then(res => { const c = res.clone(); caches.open(CACHE).then(k => k.put("./index.html", c)); return res; })
      .catch(() => caches.match("./index.html")));
    return;
  }
  const local = u.origin === location.origin;
  const statique = local ? /\/(assets|icones|i18n|data)\//.test(u.pathname) || /\.(js|css|webmanifest)$/.test(u.pathname)
    : /unpkg\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(u.host);
  if (!statique) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(r);
    const net = fetch(r).then(res => { if (res.ok || res.type === "opaque") c.put(r, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
