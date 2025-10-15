self.addEventListener('install', event => {
  event.waitUntil(
    caches.open('premierpredic-cache').then(cache => {
      return cache.addAll(['/', '/index.html', '/manifest.json', '/logo.png']);
    })
  );
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // ✅ Do NOT cache API responses (always fetch fresh)
  if (url.includes("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache everything else (HTML, JS, CSS, images)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        const cloned = response.clone();
        caches.open("premierpredict-v1").then((cache) => cache.put(event.request, cloned));
        return response;
      });
    })
  );
});
