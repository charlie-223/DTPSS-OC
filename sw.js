"use strict";

const CACHE_NAME = "one-cainta-shell-v21";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./vendor/supabase.js",
  "./pwa.js",
  "./manifest.webmanifest",
  "./terms-and-conditions.html",
  "./cainta-municipal-seal.png",
  "./one-cainta-app-logo.png",
  "./one-cainta-logo.jpg",
  "./one-cainta-wordmark.png",
  "./cainta-login-background.jpg",
  "./icons/app-192.png",
  "./icons/app-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames
          .filter(cacheName => cacheName.startsWith("one-cainta-shell-") && cacheName !== CACHE_NAME)
          .map(cacheName => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  if (request.method !== "GET" || requestUrl.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const responseCopy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put("./index.html", responseCopy));
          }
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  if (request.destination === "script" || request.destination === "style") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok && response.type === "basic") {
            const responseCopy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, responseCopy));
          }
          return response;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) return cachedResponse;
          throw new Error(`Offline asset unavailable: ${request.url}`);
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (cachedResponse) return cachedResponse;
      return fetch(request).then(response => {
        if (response.ok && response.type === "basic") {
          const responseCopy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, responseCopy));
        }
        return response;
      });
    })
  );
});
