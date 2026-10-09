// ============================================
// BeeEarn Service Worker
// Handles offline functionality and asset caching
// ============================================

const CACHE_NAME = 'beeearn-v1.3';
const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './paypal.png',
    './bitcoin.png',
    './usdc.png'
];

const GOOGLE_FONTS_CACHE = 'google-fonts-v1';
const GOOGLE_FONTS_URLS = [
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .catch((error) => {
                console.error('[Service Worker] Install error:', error);
            })
    );
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME && cacheName !== GOOGLE_FONTS_CACHE) {
                        console.log('[Service Worker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch event - cache strategies
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Handle Google Fonts separately
    if (GOOGLE_FONTS_URLS.some(gfUrl => url.href.includes(gfUrl))) {
        event.respondWith(
            caches.open(GOOGLE_FONTS_CACHE).then((cache) => {
                return cache.match(request).then((cached) => {
                    if (cached) return cached;
                    
                    return fetch(request).then((response) => {
                        if (response.ok) {
                            cache.put(request, response.clone());
                        }
                        return response;
                    }).catch(() => {
                        // Return cached version if offline
                        return cached || new Response('Google Fonts unavailable', { status: 503 });
                    });
                });
            })
        );
        return;
    }

    // Network first strategy for API/external calls
    if (request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE') {
        event.respondWith(
            fetch(request)
                .then((response) => response)
                .catch(() => new Response('Offline - Cannot complete this action', { status: 503 }))
        );
        return;
    }

    // Cache first strategy for static assets
    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) {
                return cached;
            }

            return fetch(request)
                .then((response) => {
                    // Don't cache non-2xx responses
                    if (!response || response.status !== 200 || response.type === 'error') {
                        return response;
                    }

                    // Clone response before caching
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseClone);
                    });

                    return response;
                })
                .catch(() => {
                    // Return cached version or offline page
                    return caches.match(request)
                        .then((cached) => cached || new Response('Offline - Asset not cached', { status: 503 }));
                });
        })
    );
});

// Handle background sync (future use for withdrawal requests)
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-withdrawals') {
        event.waitUntil(syncWithdrawals());
    }
});

async function syncWithdrawals() {
    try {
        // Placeholder for future offline withdrawal queue sync
        console.log('[Service Worker] Syncing withdrawals...');
    } catch (error) {
        console.error('[Service Worker] Sync error:', error);
    }
}

// Handle push notifications (future use)
self.addEventListener('push', (event) => {
    if (!event.data) return;

    const options = {
        body: event.data.text(),
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect fill="%23FFD700" width="192" height="192"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="120" fill="%23000">🐝</text></svg>',
        badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect fill="%23FFD700" width="96" height="96"/></svg>',
        tag: 'beeearn-notification',
        requireInteraction: false
    };

    event.waitUntil(
        self.registration.showNotification('BeeEarn', options)
    );
});

console.log('[Service Worker] Loaded and ready');
