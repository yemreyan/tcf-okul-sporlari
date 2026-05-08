import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { validateEPanelToken } from '../lib/epanelToken';
import { useNotification } from '../lib/NotificationContext';
import './EPanelPage.css';
import './AerobikLPanelPage.css';

/**
 * RitmikTPanelPage — Ritmik Zaman Hakemi paneli
 *
 * URL: /ritmik/tpanel?competitionId=X&catId=Y&token=Z
 *
 * Aktif aleti ve aktif sporcuyu Firebase'den dinler.
 * Yazma: puanlar/{catId}/{athId}/{aletKey}/tPanel/zaman
 *
 * Kullanıcı önceden tanımlı kesinti seçeneklerinden birini seçer:
 *   - 0.0 (ihlal yok)
 *   - 0.05 (küçük süre ihlali)
 *   - 0.10 (büyük süre ihlali)
 */
export default function RitmikTPanelPage() {
    const { toast } = useNotification();
    const firebasePath = 'ritmik_yarismalar';

    const [searchParams] = useSearchParams();
    const compId   = searchParams.get('competitionId');
    const catId    = searchParams.get('catId');
    const urlToken = searchParams.get('token');

    // Auth
    const [tokenVerified, setTokenVerified] = useState(false);
    const [tokenChecking, setTokenChecking] = useState(true);

    const [activeAletKey,   setActiveAletKey]   = useState(null);
    const [activeAthleteId, setActiveAthleteId] = useState(null);
    const [athleteInfo,     setAthleteInfo]     = useState(null);

    const [status, setStatus] = useState('waiting');
    const [serverData, setServerData] = useState(null);

    const [compName, setCompName] = useState('...');

    // Seçilen kesinti değeri
    const [selectedDeduction, setSelectedDeduction] = useState(null);
    const DEDUCTION_OPTIONS = [
        { value: 0,    label: '0.00', desc: 'İhlal yok' },
        { value: 0.05, label: '−0.05', desc: 'Küçük süre ihlali' },
        { value: 0.10, label: '−0.10', desc: 'Büyük süre ihlali' },
    ];

    // ── Token validation ────────────────────────────────────────────────────
    useEffect(() => {
        if (!compId || !urlToken) {
            setTokenChecking(false); setTokenVerified(false);
            return;
        }
        get(ref(db, `${firebasePath}/${compId}/epanelToken`))
            .then((snap) => {
                const dbToken = snap.val();
                setTokenVerified(dbToken ? validateEPanelToken(urlToken, dbToken) : false);
            })
            .catch(() => setTokenVerified(false))
            .finally(() => setTokenChecking(false));
    }, [compId, urlToken]);

    // ── Listeners (alet + sporcu + comp adı) ────────────────────────────────
    useEffect(() => {
        if (!compId || !catId || !tokenVerified) return;

        const unsubComp = onValue(ref(db, `${firebasePath}/${compId}`), (snap) => {
            const data = snap.val();
            if (data) setCompName(data.isim || 'Yarışma');
        });

        const unsubAlet = onValue(ref(db, `${firebasePath}/${compId}/aktifAlet/${catId}`), (snap) => {
            setActiveAletKey(snap.val() || null);
        });

        const unsubAth = onValue(ref(db, `${firebasePath}/${compId}/aktifSporcu/${catId}`), (snap) => {
            const val = snap.val();
            if (val) {
                if (typeof val === 'object' && val.id) {
                    setActiveAthleteId(val.id);
                    setAthleteInfo({ ad: val.ad || '', soyad: val.soyad || '', okul: val.okul || '' });
                } else {
                    setActiveAthleteId(String(val));
                }
            } else {
                setActiveAthleteId(null);
                setAthleteInfo(null);
                setStatus('waiting');
                setSelectedDeduction(null);
                setServerData(null);
            }
        });

        return () => { unsubComp(); unsubAlet(); unsubAth(); };
    }, [compId, catId, tokenVerified]);

    useEffect(() => {
        if (!activeAthleteId || !compId || !catId || !tokenVerified) return;
        if (athleteInfo) return;
        (async () => {
            const localRef = ref(db, `${firebasePath}/${compId}/sporcular/${catId}/${activeAthleteId}`);
            const snap = await get(localRef);
            const ath = snap.val();
            setAthleteInfo(ath || { ad: 'Bilinmeyen', soyad: 'Sporcu', okul: '' });
        })();
    }, [activeAthleteId, compId, catId, tokenVerified, athleteInfo]);

    // ── Skor listener ───────────────────────────────────────────────────────
    useEffect(() => {
        if (!compId || !catId || !activeAthleteId || !activeAletKey || !tokenVerified) return;

        setSelectedDeduction(null);

        const scoreRef = ref(
            db,
            `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}/${activeAletKey}`
        );
        const unsub = onValue(scoreRef, (snap) => {
            const scores = snap.val() || {};
            const isLocked = scores.kilitli === true;
            const tPanel   = scores.tPanel  || null;
            const tMeta    = tPanel?.zaman_meta || null;

            setServerData(tMeta);

            if (isLocked) setStatus('locked');
            else if (tPanel?.zaman != null) setStatus('sent');
            else setStatus('scoring');
        });

        return () => unsub();
    }, [activeAthleteId, activeAletKey, compId, catId, tokenVerified]);

    const handleSubmit = async () => {
        if (status !== 'scoring' || !activeAthleteId || !activeAletKey) return;
        if (selectedDeduction == null) {
            toast('Lütfen bir kesinti seçeneği seçin.', 'warning');
            return;
        }
        const path = `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}/${activeAletKey}/tPanel`;
        try {
            await update(ref(db, path), {
                zaman: selectedDeduction,
                zaman_meta: { value: selectedDeduction, timestamp: Date.now() },
            });
        } catch {
            toast('Hata oluştu. Lütfen tekrar deneyin.', 'error');
        }
    };

    const requestEdit = () => setStatus('scoring');

    // ── Guards ──────────────────────────────────────────────────────────────
    if (!compId || !catId) {
        return (
            <div className="epanel-wrapper epanel-error">
                <h2>Hatalı Link!</h2>
                <p>Lütfen Başhakeminizden size iletilen tam linke tıklayın veya sayfayı yenileyin.</p>
            </div>
        );
    }
    if (tokenChecking) {
        return (
            <div className="epanel-wrapper">
                <div className="epanel-main">
                    <div className="view-section active waiting-view">
                        <span className="material-icons-round waiting-icon">hourglass_empty</span>
                        <div className="waiting-text">Doğrulanıyor...</div>
                    </div>
                </div>
            </div>
        );
    }
    if (!tokenVerified) {
        return (
            <div className="epanel-wrapper epanel-error">
                <h2>Yetkisiz Erişim</h2>
                <p>Bu bağlantı geçersiz veya süresi dolmuş. Lütfen Başhakeminizden yeni bir QR kod / link alın.</p>
            </div>
        );
    }

    const aletAd = activeAletKey === 'top' ? 'TOP' : activeAletKey === 'kurdele' ? 'KURDELE' : '';

    return (
        <div className="epanel-wrapper">
            <div className="epanel-header">
                <div>
                    <div className="header-sub">{compName}</div>
                    <div className="header-title">ZAMAN HAKEMİ</div>
                    {aletAd && <div className="header-sub" style={{ marginTop: 2, fontWeight: 700, color: '#10b981' }}>Aktif: {aletAd}</div>}
                </div>
                <div className="panel-badge">T</div>
            </div>

            <div className="epanel-main">

                {(status === 'waiting' || !activeAletKey) && (
                    <div className="view-section active waiting-view">
                        <span className="material-icons-round waiting-icon">hourglass_empty</span>
                        <div className="waiting-text">
                            {!activeAletKey ? 'Alet Bekleniyor...' : 'Sporcu Bekleniyor...'}
                        </div>
                        <p className="waiting-subtext">
                            Başhakem alet ve sporcu seçtiğinde ekranınız otomatik açılacaktır.
                        </p>
                    </div>
                )}

                {status === 'scoring' && athleteInfo && activeAletKey && (
                    <div className="view-section active scoring-view">
                        <div className="athlete-card">
                            <div className="athlete-name">{athleteInfo.ad} {athleteInfo.soyad}</div>
                            <div className="athlete-club">{athleteInfo.okul || athleteInfo.kulup || '-'}</div>
                            <div className="athlete-club" style={{ marginTop: 4, color: '#0ea5e9', fontWeight: 700 }}>
                                {aletAd}
                            </div>
                        </div>

                        <div className="scoring-card">
                            <div className="input-label">SÜRE İHLALİ KESİNTİSİ</div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '1rem' }}>
                                {DEDUCTION_OPTIONS.map(opt => (
                                    <button
                                        key={opt.value}
                                        onClick={() => setSelectedDeduction(opt.value)}
                                        style={{
                                            padding: '0.85rem 1rem',
                                            borderRadius: '0.6rem',
                                            border: selectedDeduction === opt.value
                                                ? '2px solid var(--primary)'
                                                : '2px solid #e2e8f0',
                                            background: selectedDeduction === opt.value
                                                ? 'rgba(99, 102, 241, 0.08)'
                                                : '#fff',
                                            color: '#1e293b',
                                            cursor: 'pointer',
                                            fontSize: '0.95rem',
                                            fontWeight: 600,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.75rem',
                                            transition: 'all 0.15s',
                                            textAlign: 'left',
                                        }}
                                    >
                                        <span style={{
                                            fontSize: '1.4rem',
                                            fontWeight: 800,
                                            color: opt.value === 0 ? 'var(--neon-green)' : 'var(--danger)',
                                            minWidth: 70,
                                        }}>
                                            {opt.label}
                                        </span>
                                        <span style={{ flex: 1, color: '#64748b', fontSize: '0.85rem' }}>
                                            {opt.desc}
                                        </span>
                                        {selectedDeduction === opt.value && (
                                            <span className="material-icons-round" style={{ color: 'var(--primary)' }}>check_circle</span>
                                        )}
                                    </button>
                                ))}
                            </div>

                            <button
                                className="send-btn"
                                onClick={handleSubmit}
                                disabled={selectedDeduction == null}
                                style={{ marginTop: '1.25rem', opacity: selectedDeduction == null ? 0.5 : 1 }}
                            >
                                <span className="material-icons-round">send</span>
                                GÖNDER
                            </button>
                        </div>
                    </div>
                )}

                {(status === 'sent' || status === 'locked') && (
                    <div className="view-section active sent-view">
                        <span
                            className="material-icons-round sent-icon"
                            style={{ color: status === 'locked' ? '#6b7280' : 'var(--success)' }}
                        >
                            {status === 'locked' ? 'lock' : 'check_circle'}
                        </span>
                        <h2 className="sent-title">
                            {status === 'locked' ? 'Puan Kilitlendi' : 'İletildi'}
                        </h2>

                        {serverData && (
                            <div className="lpanel-sent-details">
                                <div className="lpanel-sent-row">
                                    <span>Süre Kesintisi</span>
                                    <strong
                                        style={{
                                            color: (serverData.value ?? 0) > 0 ? 'var(--danger)' : 'var(--neon-green)',
                                            fontSize: '1.6rem',
                                        }}
                                    >
                                        {(serverData.value ?? 0) > 0
                                            ? `−${Number(serverData.value).toFixed(2)}`
                                            : '0.00'}
                                    </strong>
                                </div>
                            </div>
                        )}

                        <p className="sent-desc">
                            {status === 'locked'
                                ? 'Başhakem puanı onayladı. Artık değişiklik yapılamaz.'
                                : 'Verileriniz Başhakem ekranına ulaştı. Onay bekleniyor.'}
                        </p>

                        {status !== 'locked' && (
                            <button className="edit-btn" onClick={requestEdit}>
                                Düzeltme Yap
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
