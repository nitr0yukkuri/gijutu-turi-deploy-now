const CACHE_NAME = "gijutu-turi-exhibition-v1";
const BASE_URL = new URL("./", self.registration.scope);
const APP_SHELL = ["", "index.html", "manifest.webmanifest"].map((path) => new URL(path, BASE_URL).toString());

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("gijutu-turi-exhibition-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.startsWith("/assets/")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(requestUrl.toString(), response.clone())));
          return response;
        })
        .catch(() => caches.match(requestUrl.toString()).then((cached) => cached ?? Response.error())),
    );
  }
});

