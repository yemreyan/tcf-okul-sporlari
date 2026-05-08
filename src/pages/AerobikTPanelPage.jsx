import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { validateEPanelToken } from '../lib/epanelToken';
import { useNotification } from '../lib/NotificationContext';
import { useDiscipline } from '../lib/DisciplineContext';
import { AEROBIK_CATEGORIES } from '../data/aerobikCriteriaDefaults';
import './EPanelPage.css';
import './AerobikTPanelPage.css';

// Kategori grubuna göre süre sınırlarını belirle
// Gençler / Büyükler: 79–91 sn  |  Diğerleri: 69–81 sn
function getDurationBounds(catId) {
    const group = AEROBIK_CATEGORIES[catId]?.group || '';
    const isLong = group === 'Gençler' || group === 'Büyükler'
        || (catId || '').includes('genc') || (catId || '').includes('buyuk');
    return isLong
        ? { MIN_DURATION: 79, TARGET_DURATION: 85, MAX_DURATION: 91 }
        : { MIN_DURATION: 69, TARGET_DURATION: 75, MAX_DURATION: 81 };
}

function formatTime(s) {
    if (s < 0) s = 0;
    const minutes = Math.floor(s / 60);
    const remaining = s - minutes * 60;
    const secs = Math.floor(remaining);
    const tenths = Math.round((remaining - secs) * 10);
    return `${minutes}:${String(secs).padStart(2, '0')}.${tenths}`;
}

function calcDeduction(elapsed, interruptionSeconds, lateAppearanceSeconds, minDur, maxDur) {
    let ded = 0;
    if (elapsed > 0 && (elapsed < minDur || elapsed > maxDur)) ded += 0.5;
    if (lateAppearanceSeconds >= 60) {
        // DQ — represented as a special flag in the returned object
        return { deduction: ded, dq: true };
    }
    if (lateAppearanceSeconds >= 20) ded += 0.5;
    if (interruptionSeconds >= 10) ded += 5.0;
    else if (interruptionSeconds >= 2) ded += 0.5;
    return { deduction: ded, dq: false };
}

export default function AerobikTPanelPage() {
    const { toast } = useNotification();
    // aerobik pages always use aerobik_yarismalar — but we still read from
    // useDiscipline so the hook contract is satisfied; the actual path is
    // hardcoded below.
    useDiscipline(); // keep hook call for context subscription
    const firebasePath = 'aerobik_yarismalar';

    const [searchParams] = useSearchParams();
    const compId = searchParams.get('competitionId');
    const catId = searchParams.get('catId');
    const urlToken = searchParams.get('token');

    // Kategori bazlı süre sınırları
    const { MIN_DURATION, TARGET_DURATION, MAX_DURATION } = getDurationBounds(catId);

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

    // Timer
    const [running, setRunning] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const intervalRef = useRef(null);

    // Deduction inputs
    const [interruptionSeconds, setInterruptionSeconds] = useState(0);
    const [lateAppearanceSeconds, setLateAppearanceSeconds] = useState(0);

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
                    // New format: object with id + name — no second lookup needed
                    setActiveAthleteId(val.id);
                    setAthleteInfo({ ad: val.ad || '', soyad: val.soyad || '', okul: val.okul || '' });
                } else {
                    // Legacy format: plain string id
                    setActiveAthleteId(String(val));
                    // athlete info will be fetched by the dedicated useEffect below
                }
            } else {
                setActiveAthleteId(null);
                setAthleteInfo(null);
                setStatus('waiting');
                resetTimer();
                setInterruptionSeconds(0);
                setLateAppearanceSeconds(0);
                setServerData(null);
            }
        });

        return () => {
            unsubComp();
            unsubActive();
        };
    }, [compId, catId, tokenVerified]);

    // ── Athlete info fetch (legacy: only runs when listener gave us a plain string id) ──
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

        // Reset inputs when athlete changes
        resetTimer();
        setInterruptionSeconds(0);
        setLateAppearanceSeconds(0);

        const scoreRef = ref(
            db,
            `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}`
        );
        const unsub = onValue(scoreRef, (snap) => {
            const scores = snap.val() || {};
            const isLocked = scores.kilitli === true;
            const tPanel = scores.tPanel;

            setServerData(tPanel || null);

            if (isLocked) {
                setStatus('locked');
            } else if (tPanel !== undefined && tPanel !== null) {
                setStatus('sent');
            } else {
                setStatus('scoring');
            }
        });

        return () => unsub();
    }, [activeAthleteId, compId, catId, tokenVerified]);

    // ── Timer helpers ───────────────────────────────────────────────────────
    function resetTimer() {
        clearInterval(intervalRef.current);
        setRunning(false);
        setElapsed(0);
    }

    function startTimer() {
        if (running) return;
        setRunning(true);
        intervalRef.current = setInterval(() => {
            setElapsed((prev) => Math.round((prev + 0.1) * 10) / 10);
        }, 100);
    }

    function stopTimer() {
        clearInterval(intervalRef.current);
        setRunning(false);
    }

    // Cleanup interval on unmount
    useEffect(() => {
        return () => clearInterval(intervalRef.current);
    }, []);

    // ── Submit ──────────────────────────────────────────────────────────────
    const handleSubmit = async () => {
        if (status !== 'scoring' || !activeAthleteId) return;

        const { deduction, dq } = calcDeduction(
            elapsed,
            Number(interruptionSeconds),
            Number(lateAppearanceSeconds),
            MIN_DURATION,
            MAX_DURATION
        );

        const payload = {
            deduction,
            dq: dq || false,
            routineDuration: elapsed > 0 ? elapsed : null,
            interruptionSeconds: Number(interruptionSeconds),
            lateAppearanceSeconds: Number(lateAppearanceSeconds),
            timestamp: Date.now(),
        };

        try {
            const path = `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}`;
            await update(ref(db, path), { tPanel: payload });
        } catch {
            toast('Hata oluştu. Lütfen tekrar deneyin.', 'error');
        }
    };

    const requestEdit = () => {
        setStatus('scoring');
    };

    // ── Derived display ─────────────────────────────────────────────────────
    // Süre kesintisini sadece timer durdurulduktan sonra hesapla.
    // Timer çalışırken henüz süreyi bilmiyoruz, bu yüzden elapsed'ı 0 olarak geçiyoruz.
    const elapsedForPreview = running ? 0 : elapsed;
    const { deduction: previewDeduction, dq: previewDq } = calcDeduction(
        elapsedForPreview,
        Number(interruptionSeconds),
        Number(lateAppearanceSeconds),
        MIN_DURATION,
        MAX_DURATION
    );

    const timeColor =
        elapsed === 0
            ? 'var(--text-muted)'
            : running
            ? 'var(--text-main)'
            : elapsed >= MIN_DURATION && elapsed <= MAX_DURATION
            ? 'var(--neon-green)'
            : 'var(--danger)';

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

    // ── Render ──────────────────────────────────────────────────────────────
    return (
        <div className="epanel-wrapper">
            <div className="epanel-header">
                <div>
                    <div className="header-sub">{compName}</div>
                    <div className="header-title">ZAMAN HAKEMİ</div>
                </div>
                <div className="panel-badge">T</div>
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

                            {/* ── Timer ── */}
                            <div className="tpanel-section-label">RUTIN SÜRESİ</div>
                            <div className="tpanel-timer-display" style={{ color: timeColor }}>
                                {formatTime(elapsed)}
                            </div>
                            <div className="tpanel-duration-hint">
                                Min {MIN_DURATION}s · Hedef {TARGET_DURATION}s · Maks {MAX_DURATION}s
                            </div>
                            <div className="tpanel-timer-buttons">
                                <button
                                    className="tpanel-btn tpanel-btn-start"
                                    onClick={startTimer}
                                    disabled={running}
                                >
                                    <span className="material-icons-round">play_arrow</span>
                                    BAŞLAT
                                </button>
                                <button
                                    className="tpanel-btn tpanel-btn-stop"
                                    onClick={stopTimer}
                                    disabled={!running}
                                >
                                    <span className="material-icons-round">stop</span>
                                    DURDUR
                                </button>
                                <button
                                    className="tpanel-btn tpanel-btn-reset"
                                    onClick={resetTimer}
                                >
                                    <span className="material-icons-round">replay</span>
                                    SIFIRLA
                                </button>
                            </div>

                            <div className="tpanel-divider" />

                            {/* ── Interruption ── */}
                            <div className="tpanel-section-label">KESİNTİ SÜRESİ (saniye)</div>
                            <div className="tpanel-deduction-hint">
                                2–10s: −0.5 &nbsp;|&nbsp; 10s+: −5.0
                            </div>
                            <div className="tpanel-preset-row">
                                {[0, 5, 12].map((v) => (
                                    <button
                                        key={v}
                                        className={`tpanel-preset-btn ${interruptionSeconds === v ? 'active' : ''}`}
                                        onClick={() => setInterruptionSeconds(v)}
                                    >
                                        {v}s
                                    </button>
                                ))}
                            </div>
                            <input
                                type="number"
                                className="tpanel-number-input"
                                min="0"
                                step="1"
                                value={interruptionSeconds}
                                onChange={(e) =>
                                    setInterruptionSeconds(Math.max(0, Number(e.target.value)))
                                }
                            />

                            <div className="tpanel-divider" />

                            {/* ── Late appearance ── */}
                            <div className="tpanel-section-label">GEÇ ÇIKIŞ SÜRESİ (saniye)</div>
                            <div className="tpanel-deduction-hint">
                                20s: −0.5 &nbsp;|&nbsp; 60s+: DQ
                            </div>
                            <div className="tpanel-preset-row">
                                {[0, 20, 60].map((v) => (
                                    <button
                                        key={v}
                                        className={`tpanel-preset-btn ${
                                            lateAppearanceSeconds === v ? 'active' : ''
                                        }`}
                                        onClick={() => setLateAppearanceSeconds(v)}
                                    >
                                        {v}s
                                    </button>
                                ))}
                            </div>
                            <input
                                type="number"
                                className="tpanel-number-input"
                                min="0"
                                step="1"
                                value={lateAppearanceSeconds}
                                onChange={(e) =>
                                    setLateAppearanceSeconds(Math.max(0, Number(e.target.value)))
                                }
                            />

                            <div className="tpanel-divider" />

                            {/* ── Preview ── */}
                            <div className="tpanel-preview-row">
                                <span className="tpanel-preview-label">Hesaplanan Kesinti:</span>
                                <span
                                    className="tpanel-preview-value"
                                    style={{ color: previewDq ? 'var(--danger)' : previewDeduction > 0 ? 'var(--danger)' : 'var(--neon-green)' }}
                                >
                                    {previewDq ? 'DQ' : `−${previewDeduction.toFixed(1)}`}
                                </span>
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
                            <div className="tpanel-sent-details">
                                <div className="tpanel-sent-row">
                                    <span>Rutin Süresi</span>
                                    <strong style={{ color: 'var(--primary)' }}>
                                        {serverData.routineDuration != null
                                            ? formatTime(serverData.routineDuration)
                                            : '—'}
                                    </strong>
                                </div>
                                <div className="tpanel-sent-row">
                                    <span>Kesinti</span>
                                    <strong>{serverData.interruptionSeconds ?? 0}s</strong>
                                </div>
                                <div className="tpanel-sent-row">
                                    <span>Geç Çıkış</span>
                                    <strong>{serverData.lateAppearanceSeconds ?? 0}s</strong>
                                </div>
                                <div className="tpanel-sent-row">
                                    <span>Toplam Kesinti</span>
                                    <strong style={{ color: serverData.dq ? 'var(--danger)' : 'var(--neon-green)', fontSize: '1.4rem' }}>
                                        {serverData.dq ? 'DQ' : `−${Number(serverData.deduction).toFixed(1)}`}
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
