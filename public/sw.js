// Lets the app open without a connection (registered by app/components/InstallApp.tsx).
// The page itself is fetched fresh whenever possible and kept for when it cannot
// be; its scripts and styles (named by their content, so they never change) are
// kept once loaded. Everything else, the API included, goes to the network.

const PAGES = "pages-v1";
const ASSETS = "assets-v1";
const SHELL = "/";
const ASSET_PATH = "/_next/static/";

// The scripts and styles a page's HTML loads
function assetsIn(html) {
  return [...new Set(html.match(/\/_next\/static\/[^"'\s)<>\\]+/g) || [])];
}

// Keeps the page and what it loads, once every one of its scripts and styles
// is stored: until then the previous version stays the one opened offline.
// Then drops the assets the kept page does not use. One at a time.
let shellQueue = Promise.resolve();
function keepShell(response) {
  shellQueue = shellQueue.then(() => storeShell(response)).catch(() => {});
  return shellQueue;
}

async function storeShell(response) {
  const html = await response.clone().text();
  const assets = await caches.open(ASSETS);
  const wanted = assetsIn(html);
  const stored = await Promise.all(
    wanted.map(async (path) => {
      if (await assets.match(path)) return true;
      try {
        const res = await fetch(path);
        if (!res.ok) return false;
        await assets.put(path, res);
        return true;
      } catch {
        return false;
      }
    })
  );
  if (stored.includes(false)) return;
  const pages = await caches.open(PAGES);
  await pages.put(SHELL, response);
  // Another worker (a newer version installing) may have kept its page
  // meanwhile: what the kept page uses stays
  const kept = await pages.match(SHELL);
  const keep = new Set(kept ? assetsIn(await kept.text()) : wanted);
  for (const request of await assets.keys()) {
    if (!keep.has(new URL(request.url).pathname)) await assets.delete(request);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    fetch(SHELL)
      .then((res) => (res.ok ? keepShell(res) : undefined))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== PAGES && name !== ASSETS).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && url.pathname === SHELL) event.waitUntil(keepShell(res.clone()));
          return res;
        })
        // Offline: the app (any of its pages opens the reader)
        .catch(async () => (await caches.match(SHELL, { cacheName: PAGES })) || Response.error())
    );
    return;
  }

  if (url.pathname.startsWith(ASSET_PATH)) {
    event.respondWith(
      caches.match(request, { cacheName: ASSETS }).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              event.waitUntil(caches.open(ASSETS).then((assets) => assets.put(request, copy)));
            }
            return res;
          })
      )
    );
  }
});
