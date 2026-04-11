/**
 * sw.js — TCF Cimnastik Service Worker
 *
 * Görevler:
 *  1. Uygulama kabuğunu (HTML/CSS/JS) cache'le → internet olmadan açılsın
 *  2. Bilinmeyen isteklerde cache-first strateji uygula
 *  3. Firebase RTDB WebSocket isteklerine dokunma (sadece cache değil)
 *
 * NOT: Firebase RTDB WebSocket bağlantısını service worker yönetemez.
 *      Offline puan kuyruğu IndexedDB tabanlı OfflineContext tarafından yönetilir.
 *      Bu service worker yalnızca uygulama shell cache'ini üstlenir.
 */

const CACHE_NAME    = 'tcf-app-v2';
const CACHE_TIMEOUT = 3000; // 3 saniye — cevap gelmezse cache'e dön

/* ── Önbelleğe alınacak kaynaklar (uygulama kabuğu) ─────────── */
const PRECACHE_URLS = [
    '/',
    '/index.html',
];

/* ── Firebase & WebSocket URL'lerini atla ──────────────────────
   Bu URL'ler WebSocket veya CORS kısıtlı olduğu için cache'lenmez. */
function shouldBypass(url) {
    return (
        url.includes('firebaseio.com')   ||
        url.includes('googleapis.com')   ||
        url.includes('firebase.com')     ||
        url.includes('firebasestorage')  ||
        url.startsWith('ws://')          ||
        url.startsWith('wss://')         ||
        url.includes('chrome-extension') ||
        url.includes('/__/')
    );
}

/* ══════════════════════════════════════════════════════════════
   INSTALL — uygulama kabuğunu cache'e al
   ══════════════════════════════════════════════════════════════ */
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(PRECACHE_URLS).catch((err) => {
                console.warn('[SW] Precache failed (non-critical):', err);
            });
        }).then(() => self.skipWaiting())
    );
});

/* ══════════════════════════════════════════════════════════════
   ACTIVATE — eski cache sürümlerini temizle
   ══════════════════════════════════════════════════════════════ */
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

/* ══════════════════════════════════════════════════════════════
   FETCH — Network-first, cache fallback
   ══════════════════════════════════════════════════════════════ */
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = request.url;

    // Firebase, WebSocket vb. → service worker'ı atla
    if (shouldBypass(url)) return;

    // Sadece GET istekleri cache'lenir
    if (request.method !== 'GET') return;

    event.respondWith(
        networkFirstWithTimeout(request)
    );
});

async function networkFirstWithTimeout(request) {
    // 1. Önce ağdan dene (zaman aşımıyla)
    try {
        const networkResponse = await fetchWithTimeout(request, CACHE_TIMEOUT);
        if (networkResponse && networkResponse.ok) {
            // Başarılıysa cache'e kaydet
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResponse.clone()).catch(() => {});
            return networkResponse;
        }
    } catch {
        // Ağ başarısız → cache'e bak
    }

    // 2. Cache'den dön
    const cached = await caches.match(request);
    if (cached) return cached;

    // 3. Ne ağ ne cache → index.html (SPA fallback)
    const indexCached = await caches.match('/index.html');
    if (indexCached) return indexCached;

    // 4. Hiçbir şey yok → basit offline sayfası
    return new Response(
        '<html><body style="font-family:sans-serif;text-align:center;padding:3rem">' +
        '<h2>📴 Çevrimdışı</h2>' +
        '<p>Uygulama yüklenemiyor. İnternet bağlantısı gerekiyor.</p>' +
        '</body></html>',
        { headers: { 'Content-Type': 'text/html' } }
    );
}

function fetchWithTimeout(request, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        fetch(request)
            .then((res) => { clearTimeout(timer); resolve(res); })
            .catch((err) => { clearTimeout(timer); reject(err); });
    });
}
