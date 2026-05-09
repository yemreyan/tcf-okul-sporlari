/**
 * sw.js — Self-destruct Service Worker
 *
 * Önceki versiyonlar agresif cache yapıyordu ve real-time uygulama için
 * sorun çıkarıyordu (eski JS bundle servis ediliyordu).
 *
 * Bu SW kaydolduğu anda:
 *   1. Tüm cache'leri siler
 *   2. Kendini unregister eder
 *   3. Açık sekmeleri yeniler (yeni JS bundle'ı yüklesin)
 *
 * Sonuç: Kullanıcı bir daha SW'siz çalışır, her zaman network'ten en
 * güncel kod gelir. PWA offline desteği kaybolur ama real-time
 * skor/hakem akışı için bu zaten kritik değildi (Firebase WebSocket
 * önceden de SW'yi bypass ediyordu).
 */

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        // 1) Tüm cache'leri sil
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));

        // 2) Bu SW'yi unregister et
        await self.registration.unregister();

        // 3) Kontrol altındaki sayfaları yeniden yükle (yeni JS bundle yüklensin)
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach((client) => {
            try { client.navigate(client.url); } catch { /* navigate desteklenmiyorsa görmezden gel */ }
        });
    })());
});

// Fetch'leri SW'siz olarak browser'a bırak (passthrough yok, bu olay listener bile yok)
