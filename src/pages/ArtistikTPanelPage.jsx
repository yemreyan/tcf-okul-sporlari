/**
 * Artistik Zaman Hakemi Paneli (denge & yer)
 *
 * URL: /artistik/tpanel?competitionId=X&catId=Y&aletId=Z&token=T
 *
 * Veri kaynağı:
 *   - aktifSporcu/{catId}/{aletId} → o aletteki aktif sporcu
 *   - puanlar/{catId}/{aletId}/{ath}/tarafsiz → Tarafsız Kesinti toplamı
 *
 * Davranış:
 *   - Aktif sporcu/aleti dinler, sporcu çağrılınca ekran açılır
 *   - Stopwatch (Başlat / Durdur / Sıfırla)
 *   - "-0.1 SÜRE AŞIMI" ve "-0.3 SÜRE AŞIMI" butonları
 *   - Her tıklama: mevcut tarafsız kesintiye DELTA ekler (read-modify-write)
 *   - Audit log'a her tıklama yazılır
 *   - Skor kilitliyse (durum=tamamlandi) butonlar disabled
 */
import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { validateEPanelToken } from '../lib/epanelToken';
import { useNotification } from '../lib/NotificationContext';
import { useDiscipline } from '../lib/DisciplineContext';
import { logAction } from '../lib/auditLogger';
import './EPanelPage.css';

const ALET_LABELS = {
    yer: 'Yer (FX)', atlama: 'Atlama (VT)', paralel: 'Paralel (PB)',
    barfiks: 'Barfiks (HB)', halka: 'Halka (SR)', kulplu: 'Kulplu (PH)',
    denge: 'Denge (BB)', asimetrik: 'Asimetrik (UB)',
};

export default function ArtistikTPanelPage() {
    const { toast } = useNotification();
    const { firebasePath } = useDiscipline();
    const [searchParams] = useSearchParams();

    const compId = searchParams.get('competitionId');
    const catId  = searchParams.get('catId');
    const aletId = searchParams.get('aletId');
    const urlToken = searchParams.get('token');

    const [activeAthleteId, setActiveAthleteId] = useState(null);
    const [athleteInfo, setAthleteInfo] = useState(null);
    const [status, setStatus] = useState('waiting'); // waiting | scoring | locked
    const [tokenChecking, setTokenChecking] = useState(true);
    const [tokenVerified, setTokenVerified] = useState(false);
    const [serverDeduction, setServerDeduction] = useState(0);
    const [sessionDeduction, setSessionDeduction] = useState(0);
    const [compName, setCompName] = useState('...');

    // Stopwatch state
    const [running, setRunning] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const startRef = useRef(null);
    const tickRef  = useRef(null);

    // Token doğrulama
    useEffect(() => {
        if (!compId || !urlToken) { setTokenChecking(false); setTokenVerified(false); return; }
        get(ref(db, `${firebasePath}/${compId}/epanelToken`)).then(snap => {
            setTokenVerified(!!(snap.val() && validateEPanelToken(urlToken, snap.val())));
            setTokenChecking(false);
        }).catch(() => { setTokenChecking(false); setTokenVerified(false); });
    }, [compId, urlToken, firebasePath]);

    // Yarışma ismi
    useEffect(() => {
        if (!compId || !tokenVerified) return;
        const unsub = onValue(ref(db, `${firebasePath}/${compId}/isim`), s => s.val() && setCompName(s.val()));
        return () => unsub();
    }, [compId, tokenVerified, firebasePath]);

    // Aktif sporcu listener
    useEffect(() => {
        if (!compId || !catId || !aletId || !tokenVerified) return;
        const activeRef = ref(db, `${firebasePath}/${compId}/aktifSporcu/${catId}/${aletId}`);
        const unsub = onValue(activeRef, async snap => {
            const val = snap.val();
            if (!val) {
                setActiveAthleteId(null);
                setAthleteInfo(null);
                setStatus('waiting');
                setSessionDeduction(0);
                resetTimer();
                return;
            }
            const athId = typeof val === 'object' ? val.id : String(val);
            setActiveAthleteId(athId);
            setSessionDeduction(0);
            resetTimer();
            try {
                const athSnap = await get(ref(db, `${firebasePath}/${compId}/sporcular/${catId}/${athId}`));
                setAthleteInfo(athSnap.val() || null);
            } catch { /* noop */ }
        });
        return () => unsub();
    }, [compId, catId, aletId, tokenVerified, firebasePath]);

    // Skor listener (locked / scoring + mevcut tarafsiz)
    useEffect(() => {
        if (!activeAthleteId || !aletId) return;
        const scoreRef = ref(db, `${firebasePath}/${compId}/puanlar/${catId}/${aletId}/${activeAthleteId}`);
        const unsub = onValue(scoreRef, snap => {
            const data = snap.val() || {};
            const isLocked = data.durum === 'tamamlandi' || data.kilitli === true;
            const ded = parseFloat(data.tarafsiz ?? data.neutralDeductions ?? 0) || 0;
            setServerDeduction(ded);
            setStatus(isLocked ? 'locked' : 'scoring');
        });
        return () => unsub();
    }, [activeAthleteId, compId, catId, aletId, firebasePath]);

    // Stopwatch
    const startTimer = () => {
        if (running) return;
        startRef.current = Date.now() - elapsed * 1000;
        tickRef.current = setInterval(() => {
            setElapsed(Math.floor((Date.now() - startRef.current) / 100) / 10);
        }, 100);
        setRunning(true);
    };
    const stopTimer = () => {
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
        setRunning(false);
    };
    const resetTimer = () => {
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
        setRunning(false);
        setElapsed(0);
    };

    // Kesinti ekle (read-modify-write)
    const handleAddDeduction = async (amount) => {
        if (status !== 'scoring' || !activeAthleteId) return;
        const newTotal = +(serverDeduction + amount).toFixed(2);
        try {
            await update(ref(db, `${firebasePath}/${compId}/puanlar/${catId}/${aletId}/${activeAthleteId}`), {
                tarafsiz: newTotal,
            });
            setSessionDeduction(s => +(s + amount).toFixed(2));
            try {
                await logAction('judge_score_submit', `ZAMAN hakemi → ${aletId} kesinti +${amount.toFixed(1)} (toplam ${newTotal.toFixed(2)})`, {
                    user: 'panel:zaman',
                    competitionId: compId,
                    category: catId,
                    athleteId: activeAthleteId,
                    athleteName: athleteInfo ? `${athleteInfo.ad || ''} ${athleteInfo.soyad || ''}`.trim() : '',
                    alet: aletId,
                    field: 'tarafsiz',
                    oldValue: serverDeduction,
                    newValue: newTotal,
                    discipline: 'artistik',
                    data: { source: 'hakem', panel: 'zaman', delta: amount, sureSn: elapsed },
                });
            } catch { /* noop */ }
        } catch {
            toast('Kesinti kaydedilemedi.', 'error');
        }
    };

    if (!compId || !catId || !aletId) {
        return <div className="epanel-wrapper epanel-error"><h2>Hatalı Link</h2><p>competitionId, catId ve aletId parametreleri gereklidir.</p></div>;
    }
    if (tokenChecking) {
        return <div className="epanel-wrapper"><div className="epanel-main"><div className="view-section active waiting-view"><span className="material-icons-round waiting-icon">hourglass_empty</span><div className="waiting-text">Doğrulanıyor...</div></div></div></div>;
    }
    if (!tokenVerified) {
        return <div className="epanel-wrapper epanel-error"><h2>Yetkisiz Erişim</h2><p>Bu bağlantı geçersiz veya süresi dolmuş. Başhakeminizden yeni QR/link alın.</p></div>;
    }

    const aletLabel = ALET_LABELS[aletId] || aletId;

    return (
        <div className="epanel-wrapper">
            <div className="epanel-header">
                <div>
                    <div className="header-sub">{compName}</div>
                    <div className="header-title">ZAMAN HAKEMİ — {aletLabel}</div>
                </div>
                <div className="panel-badge" style={{ background: 'linear-gradient(135deg,#f97316,#ea580c)' }}>T</div>
            </div>

            <div className="epanel-main">
                {status === 'waiting' && (
                    <div className="view-section active waiting-view">
                        <span className="material-icons-round waiting-icon">hourglass_empty</span>
                        <div className="waiting-text">Sporcu Bekleniyor...</div>
                        <p className="waiting-subtext">Başhakem sporcu çağırdığında ekran açılır.</p>
                    </div>
                )}

                {(status === 'scoring' || status === 'locked') && athleteInfo && (
                    <div className="view-section active scoring-view">
                        <div className="athlete-card">
                            <div className="athlete-name">{athleteInfo.ad} {athleteInfo.soyad}</div>
                            <div className="athlete-club">{athleteInfo.okul || athleteInfo.kulup || '-'}</div>
                        </div>

                        {/* Kronometre */}
                        <div style={{
                            margin: '1rem 0', textAlign: 'center',
                            background: 'rgba(0,0,0,0.3)', borderRadius: 12,
                            border: '1px solid rgba(255,255,255,0.1)',
                            padding: '1.25rem 1rem',
                        }}>
                            <div style={{
                                fontSize: '3.6rem', fontWeight: 900, color: running ? '#22c55e' : '#fff',
                                fontVariantNumeric: 'tabular-nums', letterSpacing: '-1px', lineHeight: 1,
                                transition: 'color 0.2s',
                            }}>
                                {elapsed.toFixed(1)}<span style={{ fontSize: '1.3rem', color: '#94a3b8', marginLeft: 4 }}>sn</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 14 }}>
                                {!running ? (
                                    <button onClick={startTimer} style={timerBtnStyle('#16a34a')}>
                                        <span className="material-icons-round" style={{ fontSize: 18 }}>play_arrow</span> Başlat
                                    </button>
                                ) : (
                                    <button onClick={stopTimer} style={timerBtnStyle('#dc2626')}>
                                        <span className="material-icons-round" style={{ fontSize: 18 }}>stop</span> Durdur
                                    </button>
                                )}
                                <button onClick={resetTimer} style={timerBtnStyle('#475569')}>
                                    <span className="material-icons-round" style={{ fontSize: 18 }}>refresh</span> Sıfırla
                                </button>
                            </div>
                        </div>

                        {/* Mevcut tarafsız kesinti */}
                        <div style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)',
                            borderRadius: 10, padding: '0.7rem 1rem', marginBottom: '0.85rem',
                        }}>
                            <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem' }}>Toplam Tarafsız Kesinti</span>
                            <strong style={{ color: '#fbbf24', fontSize: '1.4rem', fontVariantNumeric: 'tabular-nums' }}>
                                -{serverDeduction.toFixed(2)}
                            </strong>
                        </div>
                        {sessionDeduction > 0 && (
                            <div style={{
                                fontSize: '0.78rem', color: '#86efac',
                                textAlign: 'center', marginBottom: '0.7rem',
                            }}>
                                ✓ Bu sporcuda eklediğiniz: -{sessionDeduction.toFixed(2)}
                            </div>
                        )}

                        {status === 'scoring' ? (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <button onClick={() => handleAddDeduction(0.1)} style={dedBtnStyle('linear-gradient(135deg,#f59e0b,#d97706)')}>
                                    <div style={{ fontSize: '0.72rem', opacity: 0.9, letterSpacing: 1.5 }}>SÜRE AŞIMI</div>
                                    <div style={{ fontSize: '2.4rem', fontWeight: 900, marginTop: 2 }}>-0.1</div>
                                </button>
                                <button onClick={() => handleAddDeduction(0.3)} style={dedBtnStyle('linear-gradient(135deg,#ef4444,#b91c1c)')}>
                                    <div style={{ fontSize: '0.72rem', opacity: 0.9, letterSpacing: 1.5 }}>SÜRE AŞIMI</div>
                                    <div style={{ fontSize: '2.4rem', fontWeight: 900, marginTop: 2 }}>-0.3</div>
                                </button>
                            </div>
                        ) : (
                            <div style={{
                                padding: '1rem', textAlign: 'center',
                                background: 'rgba(107,114,128,0.2)', borderRadius: 10,
                                color: '#94a3b8', fontSize: '0.9rem',
                            }}>
                                <span className="material-icons-round" style={{ fontSize: 28 }}>lock</span>
                                <div style={{ marginTop: 4 }}>Puan kilitlendi — yeni kesinti eklenemez</div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

const timerBtnStyle = (color) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '0.55rem 1rem', background: color, color: '#fff',
    border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '0.85rem',
    cursor: 'pointer',
});
const dedBtnStyle = (bg) => ({
    padding: '1.1rem 0.5rem', background: bg, color: '#fff',
    border: 'none', borderRadius: 12, cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    transition: 'transform 0.1s',
});
