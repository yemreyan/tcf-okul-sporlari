import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { validateEPanelToken } from '../lib/epanelToken';
import { useNotification } from '../lib/NotificationContext';
import { useDiscipline } from '../lib/DisciplineContext';
import './EPanelPage.css';
import './AerobikLPanelPage.css';

export default function AerobikLPanelPage() {
    const { toast } = useNotification();
    // aerobik pages always use aerobik_yarismalar
    useDiscipline(); // keep hook call for context subscription
    const firebasePath = 'aerobik_yarismalar';

    const [searchParams] = useSearchParams();
    const compId = searchParams.get('competitionId');
    const catId = searchParams.get('catId');
    const urlToken = searchParams.get('token');

    // Auth
    const [tokenVerified, setTokenVerified] = useState(false);
    const [tokenChecking, setTokenChecking] = useState(true);

    // Athlete
    const [activeAthleteId, setActiveAthleteId] = useState(null);
    const [athleteInfo, setAthleteInfo] = useState(null);

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
            setTokenChecking(false);
            setTokenVerified(false);
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

    // ── Main listeners ──────────────────────────────────────────────────────
    useEffect(() => {
        if (!compId || !catId || !tokenVerified) return;

        // Competition name
        const compRef = ref(db, `${firebasePath}/${compId}`);
        const unsubComp = onValue(compRef, (snap) => {
            const data = snap.val();
            if (data) setCompName(data.isim || 'Yarışma');
        });

        // Active athlete (aerobik: category-level, no aletId)
        const activeRef = ref(db, `${firebasePath}/${compId}/aktifSporcu/${catId}`);
        const unsubActive = onValue(activeRef, (snap) => {
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

        return () => {
            unsubComp();
            unsubActive();
        };
    }, [compId, catId, tokenVerified]);

    // ── Athlete info fetch (legacy: only when listener gave plain string id) ──
    useEffect(() => {
        if (!activeAthleteId || !compId || !catId || !tokenVerified) return;
        if (athleteInfo) return; // already set by aktifSporcu object listener

        (async () => {
            const localRef = ref(db, `${firebasePath}/${compId}/sporcular/${catId}/${activeAthleteId}`);
            const snap = await get(localRef);
            let ath = snap.val();
            if (!ath) {
                const bilgiSnap = await get(ref(db, `${firebasePath}/${compId}/aktifSporcuBilgi/${catId}`));
                const bilgi = bilgiSnap.val();
                if (bilgi && bilgi.id === activeAthleteId) ath = bilgi;
            }
            setAthleteInfo(ath || { ad: 'Bilinmeyen', soyad: 'Sporcu', kulup: '' });
        })();
    }, [activeAthleteId, compId, catId, tokenVerified]);

    // ── Score / lock listener ───────────────────────────────────────────────
    useEffect(() => {
        if (!compId || !catId || !activeAthleteId || !tokenVerified) return;

        // Reset counter when athlete changes
        setCalls(0);

        const scoreRef = ref(
            db,
            `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}`
        );
        const unsub = onValue(scoreRef, (snap) => {
            const scores = snap.val() || {};
            const isLocked = scores.kilitli === true;
            const lPanel = scores.lPanel;

            setServerData(lPanel || null);

            if (isLocked) {
                setStatus('locked');
            } else if (lPanel !== undefined && lPanel !== null) {
                setStatus('sent');
            } else {
                setStatus('scoring');
            }
        });

        return () => unsub();
    }, [activeAthleteId, compId, catId, tokenVerified]);

    // ── Submit ──────────────────────────────────────────────────────────────
    const handleSubmit = async () => {
        if (status !== 'scoring' || !activeAthleteId) return;

        const totalDeduction = Math.round(calls * 0.1 * 10) / 10;
        const payload = {
            calls,
            totalDeduction,
            timestamp: Date.now(),
        };

        try {
            const path = `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}`;
            await update(ref(db, path), { lPanel: payload });
        } catch {
            toast('Hata oluştu. Lütfen tekrar deneyin.', 'error');
        }
    };

    const requestEdit = () => {
        setStatus('scoring');
    };

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

    // ── Render ──────────────────────────────────────────────────────────────
    return (
        <div className="epanel-wrapper">
            <div className="epanel-header">
                <div>
                    <div className="header-sub">{compName}</div>
                    <div className="header-title">ÇİZGİ HAKEMİ</div>
                </div>
                <div className="panel-badge">L</div>
            </div>

            <div className="epanel-main">

                {/* WAITING */}
                {status === 'waiting' && (
                    <div className="view-section active waiting-view">
                        <span className="material-icons-round waiting-icon">hourglass_empty</span>
                        <div className="waiting-text">Sporcu Bekleniyor...</div>
                        <p className="waiting-subtext">
                            Başhakem tarafından sporcu çağrıldığında ekranınız açılacaktır.
                        </p>
                    </div>
                )}

                {/* SCORING */}
                {status === 'scoring' && athleteInfo && (
                    <div className="view-section active scoring-view">
                        <div className="athlete-card">
                            <div className="athlete-name">
                                {athleteInfo.ad} {athleteInfo.soyad}
                            </div>
                            <div className="athlete-club">{athleteInfo.kulup || '-'}</div>
                        </div>

                        <div className="scoring-card">
                            <div className="input-label">ÇİZGİ İHLALİ (call)</div>

                            {/* Big counter display */}
                            <div className="lpanel-counter-display">{calls}</div>

                            {/* +/− controls */}
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

                            <button
                                className="lpanel-reset-btn"
                                onClick={() => setCalls(0)}
                            >
                                <span className="material-icons-round">replay</span>
                                Sıfırla
                            </button>

                            {/* Deduction preview */}
                            <div className="lpanel-deduction-preview">
                                <span className="lpanel-deduction-label">Toplam Kesinti:</span>
                                <span
                                    className="lpanel-deduction-value"
                                    style={{
                                        color: totalDeduction > 0 ? 'var(--danger)' : 'var(--neon-green)',
                                    }}
                                >
                                    {totalDeduction > 0 ? `−${totalDeduction.toFixed(1)}` : '0.0'}
                                </span>
                            </div>

                            <div className="lpanel-formula-hint">
                                Her call için −0.1 kesinti uygulanır.
                            </div>

                            <button className="send-btn" onClick={handleSubmit}>
                                <span className="material-icons-round">send</span>
                                GÖNDER
                            </button>
                        </div>
                    </div>
                )}

                {/* SENT / LOCKED */}
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
                                    <span>Çizgi İhlali (call)</span>
                                    <strong style={{ color: 'var(--primary)', fontSize: '1.6rem' }}>
                                        {serverData.calls ?? 0}
                                    </strong>
                                </div>
                                <div className="lpanel-sent-row">
                                    <span>Toplam Kesinti</span>
                                    <strong
                                        style={{
                                            color:
                                                (serverData.totalDeduction ?? 0) > 0
                                                    ? 'var(--danger)'
                                                    : 'var(--neon-green)',
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
