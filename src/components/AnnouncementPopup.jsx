import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import './AnnouncementPopup.css';

const CATEGORY_ICONS = {
    genel: 'campaign', bilgi: 'info', uyari: 'warning',
    degisiklik: 'swap_horiz', iptal: 'cancel', sonuc: 'emoji_events',
};
const CATEGORY_LABELS = {
    genel: 'Genel', bilgi: 'Bilgilendirme', uyari: 'Uyari',
    degisiklik: 'Degisiklik', iptal: 'Iptal', sonuc: 'Sonuc',
};
const CATEGORY_COLORS = {
    genel: '#6366F1', bilgi: '#2563EB', uyari: '#EA580C',
    degisiklik: '#8B5CF6', iptal: '#DC2626', sonuc: '#16A34A',
};

export default function AnnouncementPopup() {
    const { isAuthenticated, currentUser } = useAuth();
    const [queue, setQueue] = useState([]);
    const [currentAnn, setCurrentAnn] = useState(null);
    const [visible, setVisible] = useState(false);
    const [animating, setAnimating] = useState(false);

    useEffect(() => {
        if (!isAuthenticated) {
            // Oturumu kapandiginda read bilgisini temizle
            sessionStorage.removeItem('ann_popup_read');
            setQueue([]);
            setCurrentAnn(null);
            setVisible(false);
            return;
        }

        const unsub = onValue(ref(db, 'broadcasts'), (snap) => {
            const data = snap.val();
            if (!data) return;

            const now = Date.now();
            const readIds = JSON.parse(sessionStorage.getItem('ann_popup_read') || '[]');

            // Aktif (suresi dolmamis) ve okunmamis duyurular
            const unread = Object.entries(data)
                .map(([id, a]) => ({ id, ...a }))
                .filter(a => {
                    // Suresi dolmus mu?
                    if (a.expiresAt && now > a.expiresAt) return false;
                    // Zaten okunmus mu?
                    if (readIds.includes(a.id)) return false;
                    return true;
                })
                .sort((a, b) => {
                    // Yuksek oncelikli olanlar once
                    if (a.oncelik === 'yuksek' && b.oncelik !== 'yuksek') return -1;
                    if (b.oncelik === 'yuksek' && a.oncelik !== 'yuksek') return 1;
                    return (b.createdAt || 0) - (a.createdAt || 0);
                });

            if (unread.length > 0) {
                setQueue(unread);
                if (!currentAnn) {
                    setCurrentAnn(unread[0]);
                    setTimeout(() => setVisible(true), 300);
                }
            }
        });

        return () => unsub();
    }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

    const markAsRead = () => {
        if (!currentAnn) return;
        setAnimating(true);

        // Read listesine ekle
        const readIds = JSON.parse(sessionStorage.getItem('ann_popup_read') || '[]');
        readIds.push(currentAnn.id);
        sessionStorage.setItem('ann_popup_read', JSON.stringify(readIds));

        // Animasyonlu kapat
        setTimeout(() => {
            setVisible(false);
            setTimeout(() => {
                setAnimating(false);
                const remaining = queue.filter(a => a.id !== currentAnn.id);
                setQueue(remaining);
                if (remaining.length > 0) {
                    setCurrentAnn(remaining[0]);
                    setTimeout(() => setVisible(true), 200);
                } else {
                    setCurrentAnn(null);
                }
            }, 300);
        }, 100);
    };

    if (!currentAnn || !isAuthenticated) return null;

    const cat = currentAnn.kategori || 'genel';
    const isUrgent = currentAnn.oncelik === 'yuksek';
    const remaining = queue.length;

    return (
        <div className={`annpop-overlay ${visible && !animating ? 'annpop-overlay--visible' : ''}`}>
            <div className={`annpop-modal ${visible && !animating ? 'annpop-modal--visible' : ''} ${isUrgent ? 'annpop-modal--urgent' : ''}`}>
                {/* Header */}
                <div className="annpop-header" style={{ background: CATEGORY_COLORS[cat] || '#6366F1' }}>
                    <div className="annpop-header__icon">
                        <i className="material-icons-round">{CATEGORY_ICONS[cat] || 'campaign'}</i>
                    </div>
                    <div className="annpop-header__info">
                        <span className="annpop-header__cat">{CATEGORY_LABELS[cat] || 'Duyuru'}</span>
                        {isUrgent && <span className="annpop-header__urgent">ONEMLI</span>}
                    </div>
                    {remaining > 1 && (
                        <span className="annpop-header__count">{remaining} duyuru</span>
                    )}
                </div>

                {/* Body */}
                <div className="annpop-body">
                    <h2 className="annpop-title">{currentAnn.baslik || 'Duyuru'}</h2>
                    <p className="annpop-message">{currentAnn.mesaj || currentAnn.message}</p>

                    {currentAnn.competitionId && (
                        <div className="annpop-comp">
                            <i className="material-icons-round">emoji_events</i>
                            Yarisma Duyurusu
                        </div>
                    )}

                    <div className="annpop-meta">
                        {currentAnn.createdBy && (
                            <span><i className="material-icons-round">person</i> {currentAnn.createdBy}</span>
                        )}
                        {currentAnn.createdAt && (
                            <span><i className="material-icons-round">schedule</i> {new Date(currentAnn.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="annpop-footer">
                    <button className="annpop-btn" onClick={markAsRead}>
                        <i className="material-icons-round">check_circle</i>
                        Okudum
                        {remaining > 1 && <span className="annpop-btn__next">({remaining - 1} duyuru daha)</span>}
                    </button>
                </div>
            </div>
        </div>
    );
}
