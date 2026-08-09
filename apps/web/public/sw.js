/* PersonAI OS service worker — network-first shell, offline fallback */
const CACHE = "personai-shell-v5";
const SHELL = [
  "/",
  "/profiles/",
  "/dashboard/",
  "/manifest.webmanifest",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api") || url.pathname === "/sw.js") {
    event.respondWith(fetch(event.request));
    return;
  }
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then((cached) => cached || caches.match("/profiles/") || caches.match("/")),
      ),
  );
});
