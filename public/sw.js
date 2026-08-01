// Offline support.
//
// The whole point of QuantPrep being a browser app rather than a desktop one is
// that it goes where you do — a phone on the tube, a locked-down work laptop.
// That only holds if it runs with no network, which is what this is for.
//
// The caching strategy is chosen so the app can never get STUCK on an old
// build, which is the classic service-worker failure and worse than having no
// service worker at all:
//
//   - Navigations are NETWORK-FIRST. Online, you always get the newest
//     index.html, which references the newest hashed asset URLs. The cache is
//     only consulted when the network actually fails.
//   - Build assets are CACHE-FIRST, which is safe precisely because Vite
//     content-hashes their filenames: a changed file is a different URL, so a
//     cached entry can never be the wrong version of anything.
//
// Nothing cross-origin is touched, so provider API calls always go to the
// network and never end up in a cache.

const CACHE = "quantprep-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

/**
 * Work out what this build's assets are, by reading them out of index.html.
 *
 * They have to be precached rather than left to be cached on first fetch: on
 * the very first visit the page's scripts and styles are already loaded by the
 * time this worker takes control, so nothing ever intercepts them, and the
 * first offline load would find the shell but none of the code. Discovering
 * them here rather than baking a generated list into this file keeps the build
 * a plain `vite build` with no plugin and no list to fall out of date.
 *
 * The stylesheets are read too, for the KaTeX font files they reference — the
 * maths would otherwise render in a fallback font offline.
 */
async function buildAssets() {
  const html = await fetch("./index.html", { cache: "reload" }).then((r) => r.text());
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((url) => /^\.?\/assets\//.test(url));

  const fonts = [];
  for (const sheet of assets.filter((url) => url.endsWith(".css"))) {
    const css = await fetch(sheet).then((r) => r.text()).catch(() => "");
    const base = new URL(sheet, self.location.href);
    for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      const resolved = new URL(match[1], base);
      if (resolved.origin === self.location.origin) fonts.push(resolved.href);
    }
  }
  return [...assets, ...fonts];
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      const assets = await buildAssets().catch(() => []);
      // Added individually, so one 404 can't fail the whole install and leave
      // the app with no worker at all.
      await Promise.all([...SHELL, ...assets].map((url) => cache.add(url).catch(() => undefined)));
    }),
  );
  // Take over as soon as possible. Safe to do mid-session because asset URLs
  // are content-hashed: an entry can never be the wrong version of a file.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never intercept another origin — AI provider calls must always be live.
  if (url.origin !== self.location.origin) return;

  // Navigations: network first, cache as a fallback for offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() =>
          caches.match("./index.html", { ignoreVary: true }).then((hit) => hit ?? Response.error()),
        ),
    );
    return;
  }

  // Everything else same-origin (hashed JS/CSS/fonts, icons): cache first.
  //
  // ignoreVary matters, and its absence is silent: static hosts commonly send
  // `Vary: Origin`, and Vite tags its own assets `crossorigin`, so the page's
  // real request carries an Origin header while the one cache.add() made did
  // not. Vary-matching then refuses the hit, every asset misses, and the app
  // is blank offline while the cache looks perfectly populated. Nothing here
  // is content-negotiated — the URLs are content-hashed — so Vary has no
  // meaning for this cache.
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        // Only store real, complete responses — an opaque or error response
        // cached here would be served forever.
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
