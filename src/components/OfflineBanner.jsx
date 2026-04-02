/**
 * OfflineBanner.jsx — Bağlantı durumu göstergesi
 *
 * Ekranın altında floating pill olarak gösterilir:
 *   📴  Çevrimdışı mod — 3 bekleyen puan
 *   🔄  Senkronize ediliyor...
 *   ✅  3 puan kaydedildi   (5sn sonra kaybolur)
 *
 * Online + pending yok → görünmez
 */

import { useOffline } from '../lib/OfflineContext';
import './OfflineBanner.css';

export default function OfflineBanner() {
    const { isConnected, pendingCount, isSyncing, syncResult } = useOffline();

    // Hangi durumu gösterelim?
    const showOffline = !isConnected;
    const showSyncing = isConnected && isSyncing;
    const showSuccess = isConnected && !isSyncing && !!syncResult;
    const visible     = showOffline || showSyncing || showSuccess;

    // Tema seçimi
    let theme = '';
    let icon  = '';
    let label = '';

    if (showSyncing) {
        theme = 'offline-banner--syncing';
        icon  = 'sync';
        label = 'Senkronize ediliyor...';
    } else if (showSuccess) {
        theme = 'offline-banner--success';
        icon  = 'check_circle';
        label = `${syncResult.count} puan kaydedildi`;
    } else if (showOffline) {
        theme = 'offline-banner--offline';
        icon  = 'wifi_off';
        label = 'Çevrimdışı mod';
    }

    return (
        <div
            className={`offline-banner ${theme} ${visible ? 'offline-banner--visible' : ''}`}
            role="status"
            aria-live="polite"
        >
            <i className="material-icons-round ob-icon">{icon}</i>
            <span>{label}</span>

            {/* Bekleyen puan sayısı (offline veya syncing iken) */}
            {(showOffline || showSyncing) && pendingCount > 0 && (
                <span className="ob-badge">{pendingCount}</span>
            )}
        </div>
    );
}
