/* Khata Sathi service worker.
   Network-first for the shell: the shop must never run last week's
   JavaScript (stale-code bugs look like magic). The cache is only the
   offline fallback. New version deploys -> skipWaiting + clients.claim ->
   app.js hears "controllerchange" and reloads the page once. */
const CACHE = "khatasathi-shell-v9";
const SHELL = ["/", "/style.css", "/util.js", "/api.js", "/manifest.json", "/favicon.svg",
  "/views/dashboard.js", "/views/people.js", "/views/bill.js", "/views/billmaker.js", "/views/ledger.js",
  "/views/galla.js", "/views/payment.js", "/views/activity.js", "/views/settings.js",
  "/app.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/photo")) return; // always live
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return resp;
    }).catch(() => caches.match(e.request))
  );
});
