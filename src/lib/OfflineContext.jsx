/**
 * OfflineContext.jsx — Firebase bağlantı izleme + offline yazma yönetimi
 *
 * Kullanım:
 *   const { isConnected, pendingCount, offlineWrite } = useOffline();
 *
 *   // Puan kaydederken update(ref(db), updates) yerine:
 *   await offlineWrite(updates);
 *
 * - Online ise: direkt Firebase'e yazar
 * - Offline ise: IndexedDB'ye kuyruğa alır
 * - Yeniden bağlanınca: kuyruktaki tüm kayıtları Firebase'e gönderir
 *
 * Ephemeral (geçici, kaydedilmemesi gereken) path'ler otomatik filtrelenir:
 *   /flashTrigger  — anlık puan gösterimi
 *   /aktifSporcu   — hangi sporcu sahada
 */

import {
    createContext, useContext, useState,
    useEffect, useCallback, useRef,
} from 'react';
import { ref, onValue, update } from 'firebase/database';
import { db } from './firebase';
import {
    enqueue, dequeue, getAllPending,
    getPendingCount, incrementRetry,
} from './offlineQueue';

/* ── Geçici / senkronize edilmemesi gereken path kalıpları ─── */
const EPHEMERAL_PATTERNS = [
    '/flashTrigger',
    '/aktifSporcu',
];

function isEphemeral(path) {
    return EPHEMERAL_PATTERNS.some(p => path.includes(p));
}

/* ── Context ─────────────────────────────────────────────────── */
const OfflineCtx = createContext(null);

export function OfflineProvider({ children }) {
    const [isConnected,  setIsConnected]  = useState(true);
    const [pendingCount, setPendingCount] = useState(0);
    const [isSyncing,    setIsSyncing]    = useState(false);
    const [syncResult,   setSyncResult]   = useState(null); // { count, at }

    // ref ile güncel bağlantı durumunu async callback içinde okuyabiliriz
    const isConnectedRef = useRef(true);

    /* ── Başlangıçta IndexedDB'den bekleyen sayısını yükle ───── */
    useEffect(() => {
        getPendingCount()
            .then(n => setPendingCount(n))
            .catch(() => { });
    }, []);

    /* ── Kuyruğu Firebase'e boşalt ──────────────────────────── */
    const flushQueue = useCallback(async () => {
        const items = await getAllPending();
        if (items.length === 0) return 0;

        setIsSyncing(true);
        let successCount = 0;

        for (const item of items) {
            try {
                // item.data → { "full/firebase/path": value, ... }
                await update(ref(db), item.data);
                await dequeue(item.id);
                successCount++;
            } catch (err) {
                if (import.meta.env.DEV) console.error('[OfflineSync] Sync failed for item', item.id, err);
                await incrementRetry(item.id).catch(() => { });
            }
        }

        setIsSyncing(false);

        if (successCount > 0) {
            setPendingCount(prev => Math.max(0, prev - successCount));
            setSyncResult({ count: successCount, at: Date.now() });
            // 5 saniye sonra başarı mesajını temizle
            setTimeout(() => setSyncResult(null), 5000);
        }

        return successCount;
    }, []);

    /* ── Firebase bağlantısını izle ─────────────────────────── */
    useEffect(() => {
        const connRef = ref(db, '.info/connected');
        const unsub = onValue(connRef, async (snap) => {
            const connected = snap.val() === true;
            isConnectedRef.current = connected;
            setIsConnected(connected);

            if (connected) {
                // Bağlantı geldi → kuyruğu gönder
                await flushQueue();
            }
        });
        return () => unsub();
    }, [flushQueue]);

    /* ── Ana yazma fonksiyonu ────────────────────────────────── */
    /**
     * offlineWrite(updates)
     *
     * update(ref(db), updates) için drop-in replacement.
     * Ephemeral path'leri filtreler.
     *
     * @param {Object} updates  Firebase multi-path update objesi
     *                          { "path/to/node": value, ... }
     */
    const offlineWrite = useCallback(async (updates) => {
        // Ephemeral path'leri filtrele — bunlar kuyruklanmaz
        const persistent = Object.fromEntries(
            Object.entries(updates).filter(([path]) => !isEphemeral(path))
        );

        if (isConnectedRef.current) {
            // ── Online: direkt Firebase yazma ──────────────────
            // Tüm path'ler (ephemeral dahil) Firebase'e gider —
            // flashTrigger gibi gerçek zamanlı özellikler çalışmaya devam eder
            await update(ref(db), updates);
        } else {
            // ── Offline: kalıcı path'leri IndexedDB'ye al ──────
            if (Object.keys(persistent).length > 0) {
                await enqueue(persistent);
                setPendingCount(prev => prev + 1);
            }
            // ephemeral path'ler (flashTrigger vb.) offline'da görmezden gelinir
        }
    }, []);

    const value = {
        isConnected,
        pendingCount,
        isSyncing,
        syncResult,
        offlineWrite,
        flushQueue,
    };

    return (
        <OfflineCtx.Provider value={value}>
            {children}
        </OfflineCtx.Provider>
    );
}

/* ── Hook ────────────────────────────────────────────────────── */
export function useOffline() {
    const ctx = useContext(OfflineCtx);
    if (!ctx) {
        throw new Error('useOffline() — OfflineProvider ile sarmalanmamış');
    }
    return ctx;
}
