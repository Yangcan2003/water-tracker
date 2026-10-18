// Service Worker for 每日健康追踪 — offline support
const CACHE_NAME = "health-tracker-v70";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./toilet.css?v=1",
  "./meals.css?v=7",
  "./revamp.css",
  "./workout.css?v=1",
  "./meta.css",
  "./history.css?v=1",
  "./app.js",
  "./assistant.css?v=11",
  "./intake.css?v=4",
  "./themes.css?v=1",
  "./icons/themes/coral/icon-192.svg",
  "./icons/themes/coral/icon-192.png",
  "./icons/themes/coral/icon-512.png",
  "./icons/themes/coral/apple-touch-icon.png",
  "./icons/themes/cherry/icon-192.svg",
  "./icons/themes/cherry/icon-192.png",
  "./icons/themes/cherry/icon-512.png",
  "./icons/themes/cherry/apple-touch-icon.png",
  "./icons/themes/iris/icon-192.svg",
  "./icons/themes/iris/icon-192.png",
  "./icons/themes/iris/icon-512.png",
  "./icons/themes/iris/apple-touch-icon.png",
  "./icons/themes/jade/icon-192.svg",
  "./icons/themes/jade/icon-192.png",
  "./icons/themes/jade/icon-512.png",
  "./icons/themes/jade/apple-touch-icon.png",
  "./icons/themes/lilac/icon-192.svg",
  "./icons/themes/lilac/icon-192.png",
  "./icons/themes/lilac/icon-512.png",
  "./icons/themes/lilac/apple-touch-icon.png",
  "./icons/themes/midnight/icon-192.svg",
  "./icons/themes/midnight/icon-192.png",
  "./icons/themes/midnight/icon-512.png",
  "./icons/themes/midnight/apple-touch-icon.png",
  "./icons/themes/graphite/icon-192.svg",
  "./icons/themes/graphite/icon-192.png",
  "./icons/themes/graphite/icon-512.png",
  "./icons/themes/graphite/apple-touch-icon.png",
  "./manifest.json",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg",
  "./icons/icon-192.svg?v=4",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png?v=4",
];

// Install: precache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch((err) => {
        // Some files may not exist yet — that's ok
        console.warn("SW precache partial:", err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: cache-first for app shell, network-first for API/data
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests and Firebase/CDN requests
  if (event.request.method !== "GET") return;
  // AI connection metadata and replies must never be served from the offline cache.
  if (url.pathname === "/api/ai") return;
  if (url.hostname.includes("googleapis.com") || url.hostname.includes("gstatic.com") || url.hostname.includes("firebase")) {
    // Firebase/CDN: network-first (they have their own caching)
    return;
  }

  // App shell: cache-first with network fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Stale-while-revalidate: update cache in background
        fetch(event.request).then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, response);
            });
          }
        }).catch(() => {});
        return cached;
      }
      // Not in cache: fetch from network, cache for later
      return fetch(event.request).then((response) => {
        if (!response.ok) return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, clone);
        });
        return response;
      }).catch(() => {
        // Offline fallback: return index.html for navigation requests
        if (event.request.mode === "navigate") {
          return caches.match("./index.html");
        }
        return new Response("Offline", { status: 503 });
      });
    })
  );
});
