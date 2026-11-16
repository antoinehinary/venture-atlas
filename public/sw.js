// Service worker: lets the installed app open with no network. It caches the app itself (HTML, scripts, styles, icons,
// the built-in data snapshot). It never touches /api/ calls: live data always comes straight from your server.
const SHELL = 'atlas-shell-v1'
const KEEP = new Set([SHELL, 'atlas-data-v1']) // atlas-data-v1: the copy of the data the app saves (src/lib/api.ts)

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL)
    // Scripts and styles have content-hashed names, so read them from the current index.html.
    const html = await (await fetch('./', { cache: 'no-store' })).text()
    const assets = [...html.matchAll(/(?:src|href)="(\.?\/?assets\/[^"]+)"/g)].map((m) => m[1])
    const files = ['./', './manifest.webmanifest', './snapshot.json', './favicon.svg', './icon-192.png', './apple-touch-icon.png', ...assets]
    await cache.put('./', new Response(html, { headers: { 'Content-Type': 'text/html' } }))
    await Promise.all(files.slice(1).map((f) => cache.add(f).catch(() => {})))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!KEEP.has(k)) await caches.delete(k)
    await self.clients.claim()
  })())
})

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return
  // The page itself: network first so updates arrive, the cached copy when offline or on a bad connection.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL)
      try {
        const res = await Promise.race([fetch(req), timeout(5000)])
        if (res.ok) { cache.put('./', res.clone()); return res }
        // e.g. 502 from `tailscale serve` while the server is stopped: the saved app is more useful than an error page
        return (await cache.match('./')) || res
      } catch { return (await cache.match('./')) || Response.error() }
    })())
    return
  }
  // Hashed scripts and styles never change: cache first. Everything else (snapshot, icons): cached copy now, refreshed in the background.
  e.respondWith((async () => {
    const cache = await caches.open(SHELL)
    const hit = await cache.match(req)
    const fromNet = () => fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res })
    if (!hit) return fromNet()
    if (!url.pathname.includes('/assets/')) fromNet().catch(() => {})
    return hit
  })())
})
