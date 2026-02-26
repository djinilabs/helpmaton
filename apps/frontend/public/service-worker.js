/**
 * Service worker: caches root document and static assets for the SPA.
 * When we fetch(ROOT_URL) from inside the handler, browsers like Chrome Mobile iOS
 * may re-dispatch the fetch event. We avoid RangeError (stack overflow) by sharing
 * the in-flight promise: re-entrant requests get the same promise so we never
 * call fetch(ROOT_URL) again from within the handler. Only the root document uses
 * this; a full in-flight URL set was reverted because it caused E2E failures.
 */
const CACHE_VERSION = "v1";
const STATIC_CACHE = `helpmaton-static-${CACHE_VERSION}`;
const ROOT_URL = "/";

/** When we're fetching ROOT_URL from inside the handler, this holds the in-flight promise. */
let rootFetchPromise = null;

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
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
};

const cacheRootDocument = async () => {
  const cache = await caches.open(STATIC_CACHE);
  const cachedResponse = await cache.match(ROOT_URL);
  if (cachedResponse) {
    return cachedResponse;
  }
  // Re-entrant fetch events (e.g. Chrome Mobile iOS) get this same promise so they
  // don't trigger another fetch() and cause stack overflow.
  if (rootFetchPromise) {
    return rootFetchPromise;
  }
  rootFetchPromise = (async () => {
    try {
      const response = await fetch(ROOT_URL, { cache: "reload" });
      if (response.ok) {
        await cache.put(ROOT_URL, response.clone());
      }
      return response;
    } finally {
      rootFetchPromise = null;
    }
  })();
  return rootFetchPromise;
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

  // SPA navigation: return cached root HTML; updates via version polling.
  // Re-entrant fetch events get the same in-flight promise from cacheRootDocument(),
  // so we always respond and avoid stack overflow on Chrome Mobile iOS.
  if (request.mode === "navigate" || url.pathname === ROOT_URL) {
    event.respondWith(cacheRootDocument());
    return;
  }

  if (isStaticAssetRequest(request) || isVersionedAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});
