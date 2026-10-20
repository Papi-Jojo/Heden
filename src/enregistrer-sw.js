// Hors connexion et installation sur l'écran d'accueil (public/sw.js), en production seulement
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  const go = () => navigator.serviceWorker.register("./sw.js").catch(() => {});
  if (document.readyState === "complete") go(); else addEventListener("load", go);
}
