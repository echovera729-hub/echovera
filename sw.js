// ═══════════════════════════════════════════════════════════
// EchoVera Service Worker
// Handles: offline caching, asset caching, background sync
// Strategy: Cache-first for assets, Network-first for app
// ═══════════════════════════════════════════════════════════

const VERSION = 'echovera-v1.0.0'

// Assets to cache immediately on install
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  // External CDN resources cached at runtime
]

// CDN origins we want to cache
const CDN_ORIGINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'unpkg.com',
  'cdn.jsdelivr.net',
  'tile.openstreetmap.org',
]

// ─── INSTALL ──────────────────────────────────────────────
// Fires when SW is first registered. Pre-caches core files.
self.addEventListener('install', event => {
  console.log('[SW] Installing EchoVera SW', VERSION)
  event.waitUntil(
    caches.open(VERSION).then(cache => {
      console.log('[SW] Pre-caching core files')
      return cache.addAll(PRECACHE)
    }).then(() => self.skipWaiting()) // Activate immediately
  )
})

// ─── ACTIVATE ─────────────────────────────────────────────
// Fires after install. Cleans up old caches.
self.addEventListener('activate', event => {
  console.log('[SW] Activating EchoVera SW', VERSION)
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== VERSION)
          .map(key => {
            console.log('[SW] Deleting old cache:', key)
            return caches.delete(key)
          })
      )
    ).then(() => self.clients.claim()) // Take control immediately
  )
})

// ─── FETCH ────────────────────────────────────────────────
// Intercepts every network request from the app.
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET requests (POST, etc — these go to Supabase)
  if (request.method !== 'GET') return

  // Skip Supabase API calls — always go to network
  if (url.hostname.includes('supabase.co')) return

  // Skip WebSocket connections (Supabase Realtime)
  if (request.url.startsWith('ws')) return

  // OpenStreetMap tiles — cache-first (tiles don't change)
  if (url.hostname.includes('openstreetmap.org')) {
    event.respondWith(cacheFirst(request, 'osm-tiles'))
    return
  }

  // Google Fonts — cache-first (font files are immutable)
  if (url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirst(request, 'google-fonts'))
    return
  }

  // Google Fonts CSS — stale-while-revalidate
  if (url.hostname.includes('fonts.googleapis.com')) {
    event.respondWith(staleWhileRevalidate(request, 'google-fonts-css'))
    return
  }

  // CDN libraries (Leaflet, Supabase SDK) — cache-first
  if (url.hostname.includes('unpkg.com') || url.hostname.includes('jsdelivr.net')) {
    event.respondWith(cacheFirst(request, 'cdn-libs'))
    return
  }

  // App shell (index.html) — network-first, fallback to cache
  // This ensures users always get the latest version when online
  if (url.pathname === '/' || url.pathname.endsWith('index.html')) {
    event.respondWith(networkFirst(request, VERSION))
    return
  }

  // Everything else — network-first
  event.respondWith(networkFirst(request, VERSION))
})

// ─── CACHING STRATEGIES ───────────────────────────────────

// Cache-first: serve from cache, fall back to network
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return new Response('Offline', { status: 503 })
  }
}

// Network-first: try network, fall back to cache
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    // Return offline page if we have nothing cached
    return caches.match('/index.html')
  }
}

// Stale-while-revalidate: serve cache immediately, update in background
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone())
    return response
  }).catch(() => cached)
  return cached || fetchPromise
}

// ─── PUSH NOTIFICATIONS ───────────────────────────────────
// Handles push notifications from Supabase Edge Functions
self.addEventListener('push', event => {
  if (!event.data) return
  let data
  try { data = event.data.json() }
  catch { data = { title: 'EchoVera', body: event.data.text() } }

  const options = {
    body: data.body || 'You have a new notification',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/' },
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    tag: data.tag || 'echovera-notif',
    renotify: true,
    silent: false
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'EchoVera', options)
  )
})

// Handle notification click
self.addEventListener('notificationclick', event => {
  event.notification.close()
  if (event.action === 'dismiss') return
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // If app is already open, focus it
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus()
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})

// ─── BACKGROUND SYNC ──────────────────────────────────────
// Retries failed message sends when connectivity returns
self.addEventListener('sync', event => {
  if (event.tag === 'sync-messages') {
    event.waitUntil(syncPendingMessages())
  }
})

async function syncPendingMessages() {
  // Messages queued while offline would be synced here
  // In a full implementation this would read from IndexedDB
  console.log('[SW] Background sync: checking pending messages')
}

// ─── MESSAGE FROM APP ─────────────────────────────────────
// App can send messages to SW (e.g. to skip waiting)
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
  if (event.data === 'GET_VERSION') {
    event.ports[0].postMessage(VERSION)
  }
})

console.log('[SW] EchoVera Service Worker loaded', VERSION)
