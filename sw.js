// EchoVera Service Worker v3
// Must pass Chrome PWA installability audit:
// ✓ Responds with 200 for start_url /
// ✓ fetch handler present
// ✓ Correct scope /
// ✓ HTTPS (enforced by Vercel)

const CACHE_NAME = 'echovera-v3'
const STATIC_CACHE = 'echovera-static-v3'
const TILE_CACHE = 'echovera-tiles-v3'
const CDN_CACHE = 'echovera-cdn-v3'

// Core app shell — cached on install
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-192-maskable.png',
  '/icons/icon-512-maskable.png'
]

// ── INSTALL ────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(APP_SHELL).catch(err => {
        // Don't fail install if some files missing — log and continue
        // suppressed
      }))
      .then(() => {
        return self.skipWaiting()
      })
  )
})

// ── ACTIVATE ──────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith('echovera-') &&
                       k !== CACHE_NAME &&
                       k !== STATIC_CACHE &&
                       k !== TILE_CACHE &&
                       k !== CDN_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  )
})

// ── FETCH ──────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e
  const url = new URL(request.url)

  // Non-GET: always go to network (Supabase API calls etc.)
  if (request.method !== 'GET') return

  // Supabase REST + Realtime: always network, never cache
  if (url.hostname.includes('supabase.co')) return

  // WebSockets (Supabase Realtime): skip
  if (request.url.startsWith('ws://') || request.url.startsWith('wss://')) return

  // blob: URLs: skip
  if (request.url.startsWith('blob:')) return

  // ── Map tiles: cache-first, long TTL ──────────────────
  if (url.hostname.includes('openstreetmap.org') ||
      url.hostname.includes('tile.openstreetmap')) {
    e.respondWith(tileStrategy(request))
    return
  }

  // ── CDN assets (fonts, Leaflet, Supabase SDK): cache-first ──
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com') ||
      url.hostname.includes('unpkg.com') ||
      url.hostname.includes('jsdelivr.net') ||
      url.hostname.includes('cdnjs.cloudflare.com')) {
    e.respondWith(cdnStrategy(request))
    return
  }

  // ── Our own icons/static files: cache-first ────────────
  if (url.pathname.startsWith('/icons/') ||
      url.pathname === '/manifest.json' ||
      url.pathname === '/sw.js') {
    e.respondWith(staticStrategy(request))
    return
  }

  // ── App shell (index.html, /): network-first ──
  // Network-first ensures users always get updates, with cache fallback
  e.respondWith(appShellStrategy(request))
})

// ── Strategies ─────────────────────────────────────────────

async function tileStrategy(request) {
  const cache = await caches.open(TILE_CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  try {
    const res = await fetch(request)
    if (res.ok) cache.put(request, res.clone())
    return res
  } catch {
    return hit || new Response('', { status: 503 })
  }
}

async function cdnStrategy(request) {
  const cache = await caches.open(CDN_CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  try {
    const res = await fetch(request)
    if (res.ok) cache.put(request, res.clone())
    return res
  } catch {
    return hit || new Response('', { status: 503 })
  }
}

async function staticStrategy(request) {
  const cache = await caches.open(STATIC_CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  try {
    const res = await fetch(request)
    if (res.ok) cache.put(request, res.clone())
    return res
  } catch {
    return hit || new Response('', { status: 503 })
  }
}

async function appShellStrategy(request) {
  const cache = await caches.open(STATIC_CACHE)
  try {
    const res = await fetch(request)
    if (res.ok) cache.put(request, res.clone())
    return res
  } catch {
    // Offline fallback — serve cached index.html
    const hit = await cache.match(request) ||
                await cache.match('/') ||
                await cache.match('/')
    if (hit) return hit
    // Last resort offline page
    return new Response(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EchoVera — Offline</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#09090f;color:#f4f0ff;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px}.logo{font-size:48px;font-weight:800;background:linear-gradient(135deg,#c4b5fd,#8b5cf6,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:12px}p{color:#9d9bc0;font-size:15px;line-height:1.6;margin-bottom:24px}.btn{background:linear-gradient(135deg,#8b5cf6,#7c3aed);border:none;border-radius:14px;padding:14px 28px;color:#fff;font-size:15px;font-weight:700;cursor:pointer}</style></head>
<body><div><div class="logo">EchoVera</div><p>You're offline.<br>Connect to the internet to use EchoVera.</p><button class="btn" onclick="location.reload()">Try Again</button></div></body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
}

// ── Push Notifications ─────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return
  let d
  try { d = e.data.json() } catch { d = { title: 'EchoVera', body: e.data.text() } }
  e.waitUntil(self.registration.showNotification(d.title || 'EchoVera', {
    body: d.body || 'New notification',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    vibrate: [100, 50, 100],
    tag: 'echovera',
    renotify: true,
    data: { url: d.url || '/' }
  }))
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const target = e.notification.data?.url || '/'
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && 'focus' in c) return c.focus()
      }
      if (clients.openWindow) return clients.openWindow(target)
    })
  )
})

// ── Messages from app ──────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

