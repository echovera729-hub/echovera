// EchoVera Service Worker — v2
// This file is kept minimal. The main PWA logic lives
// inline inside index.html as a blob: URL SW.
// This file serves as a fallback for browsers that
// reject blob: URL service worker registration.

const VER = 'echovera-v2'

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VER)
      .then(c => c.addAll(['/']))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VER && !k.startsWith('osm') && !k.startsWith('cdn')).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url)
  if (e.request.method !== 'GET') return
  if (u.hostname.includes('supabase.co')) return
  if (e.request.url.startsWith('ws')) return

  // OSM map tiles — cache first
  if (u.hostname.includes('openstreetmap.org')) {
    e.respondWith(
      caches.open('osm').then(async c => {
        const hit = await c.match(e.request)
        if (hit) return hit
        const res = await fetch(e.request).catch(() => null)
        if (res && res.ok) c.put(e.request, res.clone())
        return res || new Response('', { status: 503 })
      })
    )
    return
  }

  // CDN fonts, Leaflet, Supabase SDK — cache first
  if (u.hostname.includes('fonts.') || u.hostname.includes('unpkg.') || u.hostname.includes('jsdelivr.')) {
    e.respondWith(
      caches.open('cdn').then(async c => {
        const hit = await c.match(e.request)
        if (hit) return hit
        const res = await fetch(e.request).catch(() => null)
        if (res && res.ok) c.put(e.request, res.clone())
        return res || new Response('', { status: 503 })
      })
    )
    return
  }

  // App shell — network first, cache fallback (always get latest)
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(VER).then(c => c.put(e.request, clone))
        }
        return res
      })
      .catch(async () => {
        const hit = await caches.match(e.request)
        return hit || caches.match('/')
      })
  )
})

self.addEventListener('push', e => {
  if (!e.data) return
  let d
  try { d = e.data.json() } catch { d = { title: 'EchoVera', body: e.data.text() } }
  e.waitUntil(self.registration.showNotification(d.title || 'EchoVera', {
    body: d.body || 'You have a new notification',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    vibrate: [100, 50, 100],
    tag: 'echovera'
  }))
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(cs => {
      for (const c of cs) if ('focus' in c) return c.focus()
      if (clients.openWindow) return clients.openWindow('/')
    })
  )
})

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting()
})
