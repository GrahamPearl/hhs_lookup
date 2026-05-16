/**
 * SERVICE WORKER - Offline-First PWA Support
 * 
 * Provides:
 * - Static asset caching
 * - Network fallback
 * - Background sync
 * - Push notifications (optional)
 * 
 * Register in index.html:
 * if ('serviceWorker' in navigator) {
 *   navigator.serviceWorker.register('service-worker.js');
 * }
 */

const CACHE_VERSION = 'v1.0.0';
const CACHE_NAME = `exam-scheduler-${CACHE_VERSION}`;

// Assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/scheduling-engine-part1.js',
  '/scheduling-engine-part2.js',
  '/init-storage.js',
  '/offline-manager.js',
  '/data-sync-api.js',
  '/firebase-setup.js',
  '/core-integration.js',
  '/test-implementation.js',
  '/firebase-config.js',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.min.js'
];

/**
 * Install event - cache static assets
 */
self.addEventListener('install', event => {
  console.log('Service Worker installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log(`Caching ${STATIC_ASSETS.length} assets`);
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      console.log('Service Worker installed');
      self.skipWaiting();
    }).catch(error => {
      console.error('Installation failed:', error);
    })
  );
});

/**
 * Activate event - clean old caches
 */
self.addEventListener('activate', event => {
  console.log('Service Worker activating...');
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name.startsWith('exam-scheduler-') && name !== CACHE_NAME)
          .map(name => {
            console.log(`Deleting old cache: ${name}`);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('Service Worker activated');
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'SW_ACTIVATED' });
        });
      });
    })
  );
});

/**
 * Fetch event - serve from cache, fallback to network
 */
self.addEventListener('fetch', event => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip external APIs
  if (request.url.includes('firebaseapp.com') || request.url.includes('googleapis.com')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response('Offline - Firebase unavailable', { status: 503 });
      })
    );
    return;
  }

  // Cache-first strategy for static assets
  if (isStaticAsset(request.url)) {
    event.respondWith(
      caches.match(request).then(response => {
        if (response) {
          return response;
        }

        return fetch(request).then(response => {
          if (!response || response.status !== 200) {
            return response;
          }

          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseToCache);
          });

          return response;
        });
      }).catch(() => {
        return caches.match(request);
      })
    );
    return;
  }

  // Network-first strategy for dynamic content
  event.respondWith(
    fetch(request)
      .then(response => {
        if (!response || response.status !== 200) {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(request, responseToCache);
        });

        return response;
      })
      .catch(() => {
        return caches.match(request) || new Response('Offline', { status: 503 });
      })
  );
});

/**
 * Background sync - sync offline queue when online
 */
self.addEventListener('sync', event => {
  if (event.tag === 'sync-assignments') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'SYNC_ASSIGNMENTS'
          });
        });
      })
    );
  }
});

/**
 * Handle messages from clients
 */
self.addEventListener('message', event => {
  if (event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      event.ports[0].postMessage({ success: true });
    });
  }

  if (event.data.type === 'GET_CACHE_SIZE') {
    caches.open(CACHE_NAME).then(cache => {
      cache.keys().then(keys => {
        event.ports[0].postMessage({ size: keys.length });
      });
    });
  }
});

/**
 * Check if URL is a static asset
 */
function isStaticAsset(url) {
  return /\.(js|css|html|png|jpg|gif|svg|ico|woff|woff2)$/.test(url) ||
         url.includes('bootstrap') ||
         url.includes('font-awesome') ||
         url.includes('xlsx');
}

console.log('Service Worker loaded');
