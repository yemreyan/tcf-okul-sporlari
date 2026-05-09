import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { validateEPanelToken } from '../lib/epanelToken';
import { useNotification } from '../lib/NotificationContext';
import RitmikLockedSummary from '../components/RitmikLockedSummary';
import '../components/RitmikLockedSummary.css';
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
    const aletId   = searchParams.get('aletId'); // Opsiyonel: yoksa activeAlet kullanılır
    const urlToken = searchParams.get('token');
    const aletDynamic = !aletId;

    // Auth
    const [tokenVerified, setTokenVerified] = useState(false);
    const [tokenChecking, setTokenChecking] = useState(true);

    const [activeAletKey,   setActiveAletKey]   = useState(null);
    const [activeAthleteId, setActiveAthleteId] = useState(null);
    const [athleteInfo,     setAthleteInfo]     = useState(null);

    // currentAletKey: URL'de aletId varsa onu, yoksa Firebase'den activeAlet
    const currentAletKey = aletDynamic ? activeAletKey : aletId;

    const [status, setStatus] = useState('waiting');
    const [serverData, setServerData] = useState(null);
    const [serverScores, setServerScores] = useState(null);  // Tüm puanlar (özet kart için)

    const [compName, setCompName] = useState('...');

    // Seçilen kesinti değeri (hızlı butonlar veya manuel input)
    const [selectedDeduction, setSelectedDeduction] = useState(null);
    const [manualInput,       setManualInput]       = useState('');
    const DEDUCTION_OPTIONS = [
        { value: 0,    label: '0.00',  desc: 'İhlal yok' },
        { value: 0.05, label: '−0.05', desc: 'Küçük süre ihlali' },
        { value: 0.10, label: '−0.10', desc: 'Büyük süre ihlali' },
    ];

    // Hızlı buton seçilince manuel input temizlenir; manuel input yazılınca buton seçimi kalkar
    const pickQuick = (val) => { setSelectedDeduction(val); setManualInput(''); };
    const onManualChange = (e) => {
        const raw = e.target.value;
        setManualInput(raw);
        const num = parseFloat(String(raw).replace(',', '.'));
        if (!isNaN(num) && num >= 0) setSelectedDeduction(num);
        else setSelectedDeduction(null);
    };

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
                setManualInput('');
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
        if (!compId || !catId || !activeAthleteId || !currentAletKey || !tokenVerified) return;

        setSelectedDeduction(null);
        setManualInput('');

        const scoreRef = ref(
            db,
            `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}/${currentAletKey}`
        );
        const unsub = onValue(scoreRef, (snap) => {
            const scores = snap.val() || {};
            setServerScores(scores);
            const isLocked = scores.kilitli === true;
            const tPanel   = scores.tPanel  || null;
            const tMeta    = tPanel?.zaman_meta || null;

            setServerData(tMeta);

            if (isLocked) setStatus('locked');
            else if (tPanel?.zaman != null) setStatus('sent');
            else setStatus('scoring');
        });

        return () => unsub();
    }, [activeAthleteId, currentAletKey, compId, catId, tokenVerified]);

    const handleSubmit = async () => {
        if (status !== 'scoring' || !activeAthleteId || !currentAletKey) return;
        if (selectedDeduction == null) {
            toast('Lütfen bir kesinti seçeneği seçin.', 'warning');
            return;
        }
        const path = `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}/${currentAletKey}/tPanel`;
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

    const aletAd = currentAletKey === 'top' ? 'TOP' : currentAletKey === 'kurdele' ? 'KURDELE' : '';
    const waitingForWrongAlet = !aletDynamic && activeAletKey !== null && activeAletKey !== aletId;

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

                {!waitingForWrongAlet && status === 'scoring' && athleteInfo && currentAletKey && (
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

                            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.85rem', marginBottom: '0.4rem', fontWeight: 600 }}>
                                Hızlı Seçim
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {DEDUCTION_OPTIONS.map(opt => {
                                    const isActive = !manualInput && selectedDeduction === opt.value;
                                    return (
                                        <button
                                            key={opt.value}
                                            onClick={() => pickQuick(opt.value)}
                                            style={{
                                                padding: '0.75rem 1rem',
                                                borderRadius: '0.6rem',
                                                border: isActive
                                                    ? '2px solid var(--primary)'
                                                    : '2px solid #e2e8f0',
                                                background: isActive
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
                                                fontSize: '1.35rem',
                                                fontWeight: 800,
                                                color: opt.value === 0 ? 'var(--neon-green)' : 'var(--danger)',
                                                minWidth: 70,
                                            }}>
                                                {opt.label}
                                            </span>
                                            <span style={{ flex: 1, color: '#64748b', fontSize: '0.85rem' }}>
                                                {opt.desc}
                                            </span>
                                            {isActive && (
                                                <span className="material-icons-round" style={{ color: 'var(--primary)' }}>check_circle</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Ayraç */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', margin: '1rem 0 0.5rem' }}>
                                <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
                                <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.05em' }}>
                                    VEYA MANUEL GİR
                                </span>
                                <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
                            </div>

                            {/* Manuel kesinti input */}
                            <div style={{
                                border: manualInput ? '2px solid var(--primary)' : '2px solid #e2e8f0',
                                borderRadius: '0.6rem',
                                background: manualInput ? 'rgba(99, 102, 241, 0.05)' : '#fff',
                                padding: '0.65rem 0.85rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.6rem',
                                transition: 'all 0.15s',
                            }}>
                                <span style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--danger)' }}>−</span>
                                <input
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={manualInput}
                                    onChange={onManualChange}
                                    style={{
                                        flex: 1,
                                        border: 'none',
                                        outline: 'none',
                                        fontSize: '1.4rem',
                                        fontWeight: 800,
                                        color: '#1e293b',
                                        background: 'transparent',
                                        fontFamily: 'inherit',
                                        width: '100%',
                                    }}
                                />
                                <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>puan</span>
                                {manualInput && (
                                    <button
                                        onClick={() => { setManualInput(''); setSelectedDeduction(null); }}
                                        title="Temizle"
                                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
                                    >
                                        <span className="material-icons-round" style={{ fontSize: '1.1rem' }}>close</span>
                                    </button>
                                )}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.35rem', textAlign: 'center' }}>
                                Örn: 0.05, 0.15, 0.30 …
                            </div>

                            {/* Aktif seçim özeti */}
                            <div style={{
                                marginTop: '1rem',
                                padding: '0.6rem 0.85rem',
                                borderRadius: '0.5rem',
                                background: '#F1F5F9',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                            }}>
                                <span style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 600 }}>
                                    Gönderilecek Kesinti:
                                </span>
                                <span style={{
                                    fontSize: '1.2rem',
                                    fontWeight: 900,
                                    color: selectedDeduction == null
                                        ? '#94a3b8'
                                        : selectedDeduction === 0 ? 'var(--neon-green)' : 'var(--danger)',
                                }}>
                                    {selectedDeduction == null
                                        ? '—'
                                        : selectedDeduction === 0
                                            ? '0.00'
                                            : `−${selectedDeduction.toFixed(2)}`}
                                </span>
                            </div>

                            <button
                                className="send-btn"
                                onClick={handleSubmit}
                                disabled={selectedDeduction == null}
                                style={{ marginTop: '0.85rem', opacity: selectedDeduction == null ? 0.5 : 1 }}
                            >
                                <span className="material-icons-round">send</span>
                                GÖNDER
                            </button>
                        </div>
                    </div>
                )}

                {!waitingForWrongAlet && (status === 'sent' || status === 'locked') && (
                    <div className="view-section active sent-view">
                        {status === 'locked' ? (
                            <RitmikLockedSummary
                                athleteName={athleteInfo ? `${athleteInfo.ad || ''} ${athleteInfo.soyad || ''}`.trim() : ''}
                                aletLabel={activeAletKey === 'top' ? 'Top' : activeAletKey === 'kurdele' ? 'Kurdele' : activeAletKey}
                                scores={serverScores}
                            />
                        ) : (
                            <>
                                <span className="material-icons-round sent-icon" style={{ color: 'var(--success)' }}>check_circle</span>
                                <h2 className="sent-title">İletildi</h2>

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

                                <p className="sent-desc">Verileriniz Başhakem ekranına ulaştı. Onay bekleniyor.</p>
                                <button className="edit-btn" onClick={requestEdit}>Düzeltme Yap</button>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
