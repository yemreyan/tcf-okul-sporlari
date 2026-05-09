import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { validateEPanelToken } from '../lib/epanelToken';
import { useNotification } from '../lib/NotificationContext';
import './EPanelPage.css';
import './AerobikLPanelPage.css';

/**
 * RitmikLPanelPage — Ritmik Çizgi Hakemi paneli (L1 veya L2)
 *
 * URL: /ritmik/lpanel?competitionId=X&catId=Y&panelType=cizgi1&token=Z
 *      panelType: 'cizgi1' veya 'cizgi2'
 *
 * Aktif aleti ve aktif sporcuyu Firebase'den dinler:
 *   - aktifAlet/{catId}    (top | kurdele)
 *   - aktifSporcu/{catId}  (object: {id, ad, soyad, okul})
 *
 * Yazma: puanlar/{catId}/{athId}/{aletKey}/lPanel/{panelType}
 */
export default function RitmikLPanelPage() {
    const { toast } = useNotification();
    const firebasePath = 'ritmik_yarismalar';

    const [searchParams] = useSearchParams();
    const compId    = searchParams.get('competitionId');
    const catId     = searchParams.get('catId');
    const aletId    = searchParams.get('aletId'); // Opsiyonel: yoksa activeAlet kullanılır
    const panelType = (searchParams.get('panelType') || 'cizgi1').toLowerCase(); // cizgi1 | cizgi2
    const urlToken  = searchParams.get('token');

    const isCizgi1 = panelType === 'cizgi1';
    const panelLabel = isCizgi1 ? 'ÇİZGİ 1' : 'ÇİZGİ 2';
    const panelBadge = isCizgi1 ? 'L1' : 'L2';
    const aletDynamic = !aletId; // URL'de aletId yoksa dinamik mod

    // Auth
    const [tokenVerified, setTokenVerified] = useState(false);
    const [tokenChecking, setTokenChecking] = useState(true);

    // Active state (Firebase listeners)
    const [activeAletKey,   setActiveAletKey]   = useState(null);
    const [activeAthleteId, setActiveAthleteId] = useState(null);
    const [athleteInfo,     setAthleteInfo]     = useState(null);

    // currentAletKey: URL'de aletId varsa onu kullan, yoksa activeAlet (dinamik)
    const currentAletKey = aletDynamic ? activeAletKey : aletId;

    // Panel status: 'waiting' | 'scoring' | 'sent' | 'locked'
    const [status, setStatus] = useState('waiting');
    const [serverData, setServerData] = useState(null);

    // Competition metadata
    const [compName, setCompName] = useState('...');

    // Counter
    const [calls, setCalls] = useState(0);

    // ── Token validation ────────────────────────────────────────────────────
    useEffect(() => {
        if (!compId || !urlToken) {
            setTokenChecking(false); setTokenVerified(false);
            return;
        }
        const tokenRef = ref(db, `${firebasePath}/${compId}/epanelToken`);
        get(tokenRef)
            .then((snap) => {
                const dbToken = snap.val();
                setTokenVerified(dbToken ? validateEPanelToken(urlToken, dbToken) : false);
            })
            .catch(() => setTokenVerified(false))
            .finally(() => setTokenChecking(false));
    }, [compId, urlToken]);

    // ── Aktif alet + aktif sporcu listener ──────────────────────────────────
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
                setCalls(0);
                setServerData(null);
            }
        });

        return () => { unsubComp(); unsubAlet(); unsubAth(); };
    }, [compId, catId, tokenVerified]);

    // Legacy fallback: aktifSporcu string id geldiyse sporcu bilgisini ayrı çek
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

    // ── Skor (kilit + bu hakemin verisi) listener ───────────────────────────
    useEffect(() => {
        if (!compId || !catId || !activeAthleteId || !currentAletKey || !tokenVerified) return;

        // Sporcu/alet değişince sayaç sıfır
        setCalls(0);

        const scoreRef = ref(
            db,
            `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}/${currentAletKey}`
        );
        const unsub = onValue(scoreRef, (snap) => {
            const scores = snap.val() || {};
            const isLocked = scores.kilitli === true;
            const lPanelData = scores.lPanel?.[`${panelType}_meta`] || null; // {calls, totalDeduction, timestamp}

            setServerData(lPanelData || null);

            if (isLocked) {
                setStatus('locked');
            } else if (lPanelData) {
                setStatus('sent');
            } else {
                setStatus('scoring');
            }
        });

        return () => unsub();
    }, [activeAthleteId, currentAletKey, compId, catId, tokenVerified, panelType]);

    // ── Submit ──────────────────────────────────────────────────────────────
    const handleSubmit = async () => {
        if (status !== 'scoring' || !activeAthleteId || !currentAletKey) return;

        const totalDeduction = Math.round(calls * 0.1 * 10) / 10;
        const path = `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}/${currentAletKey}/lPanel`;

        try {
            // Sayısal değer ana field'a (başhakem ekranı bunu okur), detay meta'ya
            await update(ref(db, path), {
                [panelType]: totalDeduction,
                [`${panelType}_meta`]: {
                    calls,
                    totalDeduction,
                    timestamp: Date.now(),
                },
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

    const totalDeduction = Math.round(calls * 0.1 * 10) / 10;
    const aletAd = currentAletKey === 'top' ? 'TOP' : currentAletKey === 'kurdele' ? 'KURDELE' : '';

    // Sabit alet modunda yanlış alet aktifse bekleme ekranı
    const waitingForWrongAlet = !aletDynamic && activeAletKey !== null && activeAletKey !== aletId;

    // ── Render ──────────────────────────────────────────────────────────────
    return (
        <div className="epanel-wrapper">
            <div className="epanel-header">
                <div>
                    <div className="header-sub">{compName}</div>
                    <div className="header-title">ÇİZGİ HAKEMİ {isCizgi1 ? '1' : '2'}</div>
                    {aletAd && <div className="header-sub" style={{ marginTop: 2, fontWeight: 700, color: '#10b981' }}>Aktif: {aletAd}</div>}
                </div>
                <div className="panel-badge">{panelBadge}</div>
            </div>

            <div className="epanel-main">

                {/* WAITING — sporcu yok veya alet seçilmedi */}
                {!waitingForWrongAlet && (status === 'waiting' || !currentAletKey) && (
                    <div className="view-section active waiting-view">
                        <span className="material-icons-round waiting-icon">hourglass_empty</span>
                        <div className="waiting-text">
                            {!currentAletKey ? 'Alet Bekleniyor...' : 'Sporcu Bekleniyor...'}
                        </div>
                        <p className="waiting-subtext">
                            Başhakem alet ve sporcu seçtiğinde ekranınız otomatik açılacaktır.
                        </p>
                    </div>
                )}

                {/* WAITING — yanlış alet aktif (sabit alet modu) */}
                {waitingForWrongAlet && (
                    <div className="view-section active waiting-view">
                        <span className="material-icons-round waiting-icon">swap_horiz</span>
                        <div className="waiting-text">{activeAletKey === 'top' ? 'TOP' : 'KURDELE'} Değerlendiriliyor</div>
                        <p className="waiting-subtext">
                            {aletAd} değerlendirmesi başladığında ekranınız açılacaktır.
                        </p>
                    </div>
                )}

                {/* SCORING */}
                {!waitingForWrongAlet && status === 'scoring' && athleteInfo && currentAletKey && (
                    <div className="view-section active scoring-view">
                        <div className="athlete-card">
                            <div className="athlete-name">
                                {athleteInfo.ad} {athleteInfo.soyad}
                            </div>
                            <div className="athlete-club">{athleteInfo.okul || athleteInfo.kulup || '-'}</div>
                            <div className="athlete-club" style={{ marginTop: 4, color: '#0ea5e9', fontWeight: 700 }}>
                                {aletAd}
                            </div>
                        </div>

                        <div className="scoring-card">
                            <div className="input-label">{panelLabel} İHLALİ (call)</div>

                            <div className="lpanel-counter-display">{calls}</div>

                            <div className="lpanel-counter-controls">
                                <button
                                    className="lpanel-btn lpanel-btn-minus"
                                    onClick={() => setCalls((c) => Math.max(0, c - 1))}
                                    disabled={calls === 0}
                                >
                                    <span className="material-icons-round">remove</span>
                                </button>
                                <button
                                    className="lpanel-btn lpanel-btn-plus"
                                    onClick={() => setCalls((c) => c + 1)}
                                >
                                    <span className="material-icons-round">add</span>
                                </button>
                            </div>

                            <button className="lpanel-reset-btn" onClick={() => setCalls(0)}>
                                <span className="material-icons-round">replay</span>
                                Sıfırla
                            </button>

                            <div className="lpanel-deduction-preview">
                                <span className="lpanel-deduction-label">Toplam Kesinti:</span>
                                <span
                                    className="lpanel-deduction-value"
                                    style={{ color: totalDeduction > 0 ? 'var(--danger)' : 'var(--neon-green)' }}
                                >
                                    {totalDeduction > 0 ? `−${totalDeduction.toFixed(1)}` : '0.0'}
                                </span>
                            </div>

                            <div className="lpanel-formula-hint">
                                Her çizgi ihlali için −0.1 kesinti uygulanır.
                            </div>

                            <button className="send-btn" onClick={handleSubmit}>
                                <span className="material-icons-round">send</span>
                                GÖNDER
                            </button>
                        </div>
                    </div>
                )}

                {/* SENT / LOCKED */}
                {!waitingForWrongAlet && (status === 'sent' || status === 'locked') && (
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
                                    <span>{panelLabel} İhlali (call)</span>
                                    <strong style={{ color: 'var(--primary)', fontSize: '1.6rem' }}>
                                        {serverData.calls ?? 0}
                                    </strong>
                                </div>
                                <div className="lpanel-sent-row">
                                    <span>Toplam Kesinti</span>
                                    <strong
                                        style={{
                                            color: (serverData.totalDeduction ?? 0) > 0 ? 'var(--danger)' : 'var(--neon-green)',
                                            fontSize: '1.6rem',
                                        }}
                                    >
                                        {(serverData.totalDeduction ?? 0) > 0
                                            ? `−${Number(serverData.totalDeduction).toFixed(1)}`
                                            : '0.0'}
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
