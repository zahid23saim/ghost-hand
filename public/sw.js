// Ghost Hand service worker: keeps the app shell close by, never touches the game's live traffic.
//
//  - Static assets (js, css, svg, png, fonts ...): cache-first from a cache named after the
//    deployed build (public/js/build.js, stamped on deploy), filled at install and on use.
//  - Navigations: network-first. While online, each navigation also re-reads build.js; when the
//    build changed, the old static cache is dropped so the page never mixes two deploys.
//    Offline, navigations get a small "Hush needs the internet" page.
//  - /api/* and /ws/* are never cached or answered here.
//
// Register with a stable URL: navigator.serviceWorker.register("/sw.js").

const SW_VERSION = 1;                 // bump when this file's logic changes
const STATIC = "gh-static-";          // + build id
const FONTS = "gh-fonts-v1";

const SHELL = [
  "/",
  "/css/app.css",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/vendor/qrcode.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/js/app.js",
  "/js/attract.js",
  "/js/audio.js",
  "/js/build.js",
  "/js/captions.js",
  "/js/cover.js",
  "/js/doodles.js",
  "/js/gifreplay.js",
  "/js/hush-director.js",
  "/js/hush.js",
  "/js/i18n.js",
  "/js/input.js",
  "/js/net.js",
  "/js/render.js",
  "/js/scrapbook.js",
  "/js/seatstrip.js",
  "/js/settings.js",
  "/js/sharecard.js",
  "/js/wardrobe.js",
  "/js/shared/board.js",
  "/js/shared/bots.js",
  "/js/shared/config.js",
  "/js/shared/physics.js",
  "/js/shared/protocol.js",
  "/js/shared/rng.js",
  "/js/shared/content/blocked-codes.js",
  "/js/shared/content/hush-lines.js",
  "/js/shared/content/names.js",
  "/js/shared/content/questions.js",
  "/js/shared/content/words.js",
];

const STATIC_RE = /\.(?:js|mjs|css|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|otf|json|webmanifest|mp3|ogg|wav|m4a)$/i;
const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

const OFFLINE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#14122B">
<title>Ghost Hand - offline</title>
<style>
  html, body { margin: 0; height: 100%; background: #14122B; color: #F3E9D2; }
  body { display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box;
    font: 700 18px/1.45 Nunito, system-ui, -apple-system, "Segoe UI", sans-serif; text-align: center;
    background: radial-gradient(60% 40% at 50% 0%, rgba(94,242,208,0.12), rgba(94,242,208,0) 70%), #14122B; }
  main { max-width: 420px; }
  .ghost { width: 96px; height: 84px; margin: 0 auto 18px; border-radius: 48px 48px 14px 14px; background: #fff;
    position: relative; box-shadow: 0 0 34px rgba(94,242,208,0.45); }
  .ghost::before, .ghost::after { content: ""; position: absolute; top: 30px; width: 9px; height: 12px; border-radius: 50%; background: #3B2F5C; }
  .ghost::before { left: 30px; } .ghost::after { right: 30px; }
  h1 { margin: 0 0 10px; font: 800 30px/1.15 Fraunces, Georgia, serif; }
  p { margin: 0 0 22px; color: #A9A3C9; }
  button { font: 800 17px Nunito, system-ui, sans-serif; color: #14122B; background: #FFC94D; border: 0;
    border-radius: 999px; padding: 12px 26px; cursor: pointer; box-shadow: 0 3px 0 rgba(0,0,0,0.35); }
</style></head>
<body><main>
  <div class="ghost" aria-hidden="true"></div>
  <h1>You're offline</h1>
  <p>Hush needs the internet to join a table. Try solo when you're back online.</p>
  <button type="button" onclick="location.reload()">Try again</button>
</main></body></html>`;

let active = null; // the static cache name in use

// The host answers unknown paths with index.html (single-page fallback): never keep that as an asset.
const isHtml = (res) => /text\/html/i.test(res.headers.get("Content-Type") || "");

async function readBuild() {
  const res = await fetch("/js/build.js", { cache: "no-store" });
  if (!res.ok) throw new Error("build.js " + res.status);
  const m = (await res.text()).match(/BUILD\s*=\s*["']([^"']+)["']/);
  return m ? m[1] : "unknown";
}

async function activeCache() {
  if (active) return active;
  const keys = (await caches.keys()).filter((k) => k.startsWith(STATIC));
  active = keys.length ? keys[keys.length - 1] : null;
  return active;
}

// Fill a cache with the shell; one missing file never fails the rest.
async function precache(name) {
  const cache = await caches.open(name);
  await Promise.all(SHELL.map(async (url) => {
    try {
      const res = await fetch(new Request(url, { cache: "reload" }));
      if (res.ok && !res.redirected && (url === "/" || !isHtml(res))) await cache.put(url, res);
    } catch {}
  }));
}

async function dropOthers(keep) {
  for (const k of await caches.keys()) {
    if (k.startsWith(STATIC) && k !== keep) await caches.delete(k);
  }
}

// Online: make sure the static cache matches the deployed build.
let syncing = null;
function syncBuild() {
  if (syncing) return syncing;
  syncing = (async () => {
    const id = await readBuild();
    const name = STATIC + id;
    if (name !== (await activeCache())) {
      await caches.open(name);
      active = name;
      await dropOthers(name);
      precache(name); // fills in the background; misses go to the network meanwhile
    }
  })().catch(() => {}).finally(() => { syncing = null; });
  return syncing;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    let id = "unknown";
    try { id = await readBuild(); } catch {}
    active = STATIC + id;
    await precache(active);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = await activeCache();
    await dropOthers(keep);
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch {} }
    await self.clients.claim();
  })());
});

const offline = () => new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

async function navigate(event) {
  try {
    const net = (async () => (await event.preloadResponse) || fetch(event.request))();
    const [res] = await Promise.all([net, withTimeout(syncBuild(), 3000)]);
    return res;
  } catch {
    return offline();
  }
}

async function cacheFirst(req) {
  const name = await activeCache();
  if (name) {
    const hit = await caches.match(req, { cacheName: name });
    if (hit) return hit;
  }
  const res = await fetch(req);
  if (res.ok && name && res.type === "basic" && !res.redirected && !isHtml(res)) {
    const copy = res.clone();
    caches.open(name).then((c) => c.put(req, copy)).catch(() => {});
  }
  return res;
}

async function fontFirst(req) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone()).catch(() => {});
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/") || url.pathname === "/api" || url.pathname === "/ws") return;
    if (req.mode === "navigate") { event.respondWith(navigate(event)); return; }
    if (url.pathname === "/sw.js") return;
    if (url.pathname === "/js/build.js") { // network first: it names the deploy
      event.respondWith(fetch(req, { cache: "no-store" }).catch(async () => (await caches.match(req)) || Response.error()));
      return;
    }
    if (STATIC_RE.test(url.pathname)) event.respondWith(cacheFirst(req));
    return;
  }
  if (FONT_HOSTS.has(url.hostname)) event.respondWith(fontFirst(req));
});

self.addEventListener("message", (event) => {
  if (event.data === "gh-sw-version" && event.source) event.source.postMessage({ sw: SW_VERSION, cache: active });
});
