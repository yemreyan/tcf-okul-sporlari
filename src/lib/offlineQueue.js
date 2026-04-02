/**
 * offlineQueue.js — IndexedDB tabanlı offline yazma kuyruğu
 *
 * Firebase bağlantısı kesildiğinde puan kayıtlarını tarayıcıya saklar.
 * Bağlantı geldiğinde OfflineContext bu kuyruğu okuyup Firebase'e gönderir.
 *
 * Şema:
 *   Database : "tcf-offline-db"  (version 1)
 *   Store    : "pending_writes"
 *     id        — otomatik artan primary key
 *     data      — { fullPath: value, ... }  (Firebase multi-path update objesi)
 *     createdAt — timestamp (ms)
 *     retries   — kaç kez denendi
 */

const DB_NAME    = 'tcf-offline-db';
const DB_VERSION = 1;
const STORE      = 'pending_writes';

let _db = null;

/* ── Veritabanını aç / oluştur ──────────────────────────────── */
function openDB() {
    if (_db) return Promise.resolve(_db);

    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, {
                    keyPath: 'id',
                    autoIncrement: true,
                });
                store.createIndex('createdAt', 'createdAt', { unique: false });
            }
        };

        req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
        req.onerror   = ()  => reject(req.error);
    });
}

/* ── Kuyruğa ekle ───────────────────────────────────────────── */
export async function enqueue(data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx    = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const req   = store.add({ data, createdAt: Date.now(), retries: 0 });
        req.onsuccess = () => resolve(req.result);   // dönen değer: yeni id
        req.onerror   = () => reject(req.error);
    });
}

/* ── Kuyruktan sil (başarılı senkronizasyon sonrası) ─────────── */
export async function dequeue(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
    });
}

/* ── Retry sayacını artır ───────────────────────────────────── */
export async function incrementRetry(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx    = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const getReq = store.get(id);
        getReq.onsuccess = () => {
            const item = getReq.result;
            if (!item) return resolve();
            item.retries = (item.retries || 0) + 1;
            store.put(item);
        };
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
    });
}

/* ── Tüm bekleyen kayıtları getir (sıralı) ──────────────────── */
export async function getAllPending() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).index('createdAt').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror   = () => reject(req.error);
    });
}

/* ── Bekleyen kayıt sayısı ───────────────────────────────────── */
export async function getPendingCount() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}

/* ── Tüm kuyruğu temizle (acil durum) ──────────────────────── */
export async function clearQueue() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
    });
}
