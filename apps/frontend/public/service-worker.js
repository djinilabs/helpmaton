/**
 * Service worker: caches root document and static assets for the SPA.
 * Uses a re-entrancy guard so that when we fetch() from inside the handler,
 * browsers that re-dispatch the fetch event (e.g. Chrome Mobile iOS) don't
 * cause infinite recursion (RangeError: Maximum call stack size exceeded).
 */
const CACHE_VERSION = "v1";
const STATIC_CACHE = `helpmaton-static-${CACHE_VERSION}`;
const ROOT_URL = "/";

/** URLs we're currently fetching from inside our handlers; re-entrant fetch events are skipped. */
const inFlightUrls = new Set();

const STATIC_ASSET_EXTENSIONS = new Set([
  "js",
  "css",
  "mjs",
  "json",
  "map",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "webmanifest",
]);

const isSameOrigin = (url) => url.origin === self.location.origin;

const isVersionedAsset = (url) => {
  const hasVersionParam =
    url.searchParams.has("v") || url.searchParams.has("version");
  const hasHash = /-[a-f0-9]+\./.test(url.pathname);
  return hasVersionParam || hasHash;
};

const isStaticAssetRequest = (request) => {
  if (request.method !== "GET") {
    return false;
  }
  const url = new URL(request.url);
  if (!isSameOrigin(url) || url.pathname.startsWith("/api/")) {
    return false;
  }
  const parts = url.pathname.split(".");
  const extension = parts.length > 1 ? parts.at(-1) : "";
  return STATIC_ASSET_EXTENSIONS.has(extension);
};

const cacheFirst = async (request) => {
  const cache = await caches.open(STATIC_CACHE);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  const url = request.url;
  inFlightUrls.add(url);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } finally {
    inFlightUrls.delete(url);
  }
};

const cacheRootDocument = async () => {
  const cache = await caches.open(STATIC_CACHE);
  const cachedResponse = await cache.match(ROOT_URL);
  if (cachedResponse) {
    return cachedResponse;
  }
  const rootFullUrl = self.location.origin + ROOT_URL;
  inFlightUrls.add(rootFullUrl);
  try {
    const response = await fetch(ROOT_URL, { cache: "reload" });
    if (response.ok) {
      await cache.put(ROOT_URL, response.clone());
    }
    return response;
  } finally {
    inFlightUrls.delete(rootFullUrl);
  }
};

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(cacheRootDocument().catch(() => undefined));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key !== STATIC_CACHE) {
            return caches.delete(key);
          }
          return undefined;
        })
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || message.type !== "INVALIDATE_ROOT") {
    return;
  }
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.delete(ROOT_URL);
      if (event.ports?.[0]) {
        event.ports[0].postMessage({ ok: true });
      }
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (!isSameOrigin(url)) {
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Skip re-entrant fetches (we're already handling this URL from inside a handler).
  if (inFlightUrls.has(request.url)) {
    return;
  }

  // SPA navigation: return cached root HTML; updates via version polling.
  if (request.mode === "navigate" || url.pathname === ROOT_URL) {
    event.respondWith(cacheRootDocument());
    return;
  }

  if (isStaticAssetRequest(request) || isVersionedAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});
