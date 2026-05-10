import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { validateEPanelToken } from '../lib/epanelToken';
import { useNotification } from '../lib/NotificationContext';
import { useDiscipline } from '../lib/DisciplineContext';
import RitmikLockedSummary from '../components/RitmikLockedSummary';
import '../components/RitmikLockedSummary.css';
import './EPanelPage.css';

export default function EPanelPage() {
    const { toast } = useNotification();
    const { firebasePath, id: disciplineId } = useDiscipline();
    const isRitmik = disciplineId === 'ritmik';
    const isAerobik = disciplineId === 'aerobik';
    const [searchParams] = useSearchParams();
    const compId = searchParams.get('competitionId');
    const catId = searchParams.get('catId');
    const aletId = searchParams.get('aletId'); // Ritmik için opsiyonel: yoksa activeAlet kullanılır
    // Ritmik için yeni "alet bağımsız" QR'lar URL'de aletId taşımaz; eski QR'lar geriye uyumlu
    const ritmikAletDynamic = isRitmik && !aletId;
    const panelId = searchParams.get('panelId'); // E1..E4 | A1..A4
    const panelType = searchParams.get('panelType') || 'e'; // 'a' | 'e' — Ritmik only
    const urlToken = searchParams.get('token'); // Güvenlik token'ı

    const [activeAthleteId, setActiveAthleteId] = useState(null);
    const [activeAlet, setActiveAlet] = useState(null); // Ritmik: tracks aktifAlet
    const [athleteInfo, setAthleteInfo] = useState(null);

    // Ritmik dinamik moddaysa (URL'de aletId yok) → activeAlet'i kullan
    // Aksi halde URL'deki aletId'i kullan (eski uyumluluk + artistik)
    const currentAlet = ritmikAletDynamic ? activeAlet : aletId;

    // Status: 'waiting', 'scoring', 'sent', 'locked', 'unauthorized'
    const [status, setStatus] = useState('waiting');
    const [tokenVerified, setTokenVerified] = useState(false);
    const [tokenChecking, setTokenChecking] = useState(true);

    const [scoreInput, setScoreInput] = useState('');
    const [serverScore, setServerScore] = useState(null);
    // Tüm scores objesi (kilit sonrası özet kart için — ritmik)
    const [serverScores, setServerScores] = useState(null);
    const [fieldOverridden, setFieldOverridden] = useState(false);

    const [compName, setCompName] = useState('...');
    const [refereeName, setRefereeName] = useState('...');

    // Hakem Çağrısı (SJA → A panel / SJE → E panel) flash card durumu
    const [calledFlash, setCalledFlash] = useState(null);
    const callTimerRef  = useRef(null);
    const callTickRef   = useRef(null);
    const lastSeenTsRef = useRef(0);
    const CALL_DURATION_MS = 10000;

    // Token doğrulama
    useEffect(() => {
        if (!compId || !urlToken) {
            setTokenChecking(false);
            setTokenVerified(false);
            return;
        }

        const tokenRef = ref(db, `${firebasePath}/${compId}/epanelToken`);
        get(tokenRef).then((snap) => {
            const dbToken = snap.val();
            if (dbToken && validateEPanelToken(urlToken, dbToken)) {
                setTokenVerified(true);
            } else {
                setTokenVerified(false);
            }
            setTokenChecking(false);
        }).catch(() => {
            setTokenVerified(false);
            setTokenChecking(false);
        });
    }, [compId, urlToken]);

    useEffect(() => {
        if (!compId || !catId || (!aletId && !isRitmik && !isAerobik) || !panelId || !tokenVerified) return;

        // Fetch Comp Name
        const compRef = ref(db, `${firebasePath}/${compId}`);
        const unsubComp = onValue(compRef, (snap) => {
            const data = snap.val();
            if (data) setCompName(data.isim || 'Yarışma');
            // Check if there is a specific name registered for this panel
            const hakemVal = isAerobik
                ? data?.hakemler?.[catId]?.[panelId]
                : data?.hakemler?.[catId]?.[aletId]?.[panelId];
            if (hakemVal) {
                const displayName = typeof hakemVal === 'object' && hakemVal.name ? hakemVal.name : String(hakemVal);
                setRefereeName(displayName);
            } else {
                const prefix = isRitmik ? (panelType === 'a' ? 'A HAKEMİ' : 'E HAKEMİ') : 'HAKEM';
                setRefereeName(`${prefix} ${panelId.toUpperCase()}`);
            }
        });

        let unsubActive, unsubAlet;

        if (isRitmik) {
            // Ritmik: aktifSporcu is category-level (no aletId sub-key)
            // Yeni format: object {id, ad, soyad, okul}; eski format: plain string id
            const activeRef = ref(db, `${firebasePath}/${compId}/aktifSporcu/${catId}`);
            unsubActive = onValue(activeRef, (snap) => {
                const val = snap.val();
                if (val) {
                    if (typeof val === 'object' && val.id) {
                        // New format: object with id + name info
                        setActiveAthleteId(val.id);
                        setAthleteInfo({ ad: val.ad || '', soyad: val.soyad || '', okul: val.okul || '' });
                    } else {
                        // Legacy format: plain string id
                        setActiveAthleteId(String(val));
                        fetchAthleteData(String(val));
                    }
                } else {
                    setActiveAthleteId(null);
                    setAthleteInfo(null);
                    setStatus('waiting');
                    setScoreInput('');
                    setServerScore(null);
                }
            });
            // Also track which alet is currently active
            const aletRef = ref(db, `${firebasePath}/${compId}/aktifAlet/${catId}`);
            unsubAlet = onValue(aletRef, (snap) => {
                setActiveAlet(snap.val());
            });
        } else if (isAerobik) {
            // Aerobik: aktifSporcu is category-level (no apparatus)
            const activeRef = ref(db, `${firebasePath}/${compId}/aktifSporcu/${catId}`);
            unsubActive = onValue(activeRef, (snap) => {
                const val = snap.val();
                if (val) {
                    if (typeof val === 'object' && val.id) {
                        // New format: object with id + name info
                        setActiveAthleteId(val.id);
                        setAthleteInfo({ ad: val.ad || '', soyad: val.soyad || '', okul: val.okul || '' });
                    } else {
                        // Legacy format: plain string id
                        setActiveAthleteId(String(val));
                        fetchAthleteData(String(val));
                    }
                } else {
                    setActiveAthleteId(null);
                    setAthleteInfo(null);
                    setStatus('waiting');
                    setScoreInput('');
                    setServerScore(null);
                }
            });
        } else {
            // Artistik: aktifSporcu is per apparatus
            const activeRef = ref(db, `${firebasePath}/${compId}/aktifSporcu/${catId}/${aletId}`);
            unsubActive = onValue(activeRef, (snap) => {
                const newId = snap.val();
                if (newId) {
                    setActiveAthleteId(String(newId));
                    fetchAthleteData(String(newId));
                } else {
                    setActiveAthleteId(null);
                    setAthleteInfo(null);
                    setStatus('waiting');
                    setScoreInput('');
                    setServerScore(null);
                }
            });
        }

        return () => {
            unsubComp();
            if (unsubActive) unsubActive();
            if (unsubAlet) unsubAlet();
        };
    }, [compId, catId, aletId, panelId, panelType, tokenVerified, isRitmik, isAerobik]);

    const fetchAthleteData = async (id) => {
        // Try local sporcular first, then globals fallback
        const localRef = ref(db, `${firebasePath}/${compId}/sporcular/${catId}/${id}`);
        const snap = await get(localRef);
        let ath = snap.val();

        if (!ath) {
            const globalRef = ref(db, `globalSporcular/${id}`);
            const gSnap = await get(globalRef);
            ath = gSnap.val();
        }

        if (!ath && isAerobik) {
            // Fallback: aktifSporcuBilgi (covers step aerobik team ids)
            const bilgiSnap = await get(ref(db, `${firebasePath}/${compId}/aktifSporcuBilgi/${catId}`));
            const bilgi = bilgiSnap.val();
            if (bilgi && bilgi.id === id) ath = bilgi;
        }

        if (ath) {
            setAthleteInfo(ath);
        } else {
            setAthleteInfo({ ad: 'Bilinmeyen', soyad: 'Sporcu', kulup: '' });
        }
    };

    // Listen to specific score for this athlete
    useEffect(() => {
        if (!compId || !catId || (!currentAlet && !isAerobik) || !activeAthleteId || !panelId || !tokenVerified) return;

        let scoreRef;
        if (isRitmik) {
            // Ritmik: athlete-first — puanlar/catId/athleteId/aletId
            scoreRef = ref(db, `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}/${currentAlet}`);
        } else if (isAerobik) {
            // Aerobik: puanlar/catId/athleteId (ePanel is a sub-object)
            scoreRef = ref(db, `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}`);
        } else {
            // Artistik: apparatus-first — puanlar/catId/aletId/athleteId
            scoreRef = ref(db, `${firebasePath}/${compId}/puanlar/${catId}/${aletId}/${activeAthleteId}`);
        }

        const unsubScore = onValue(scoreRef, (snap) => {
            const scores = snap.val() || {};
            let myScore, isLocked;
            let fieldOverridden = false; // başhakem bu alanı değiştirip kilitledi mi

            if (isRitmik) {
                // Ritmik: scores = { aPanel: {j1:..., j2:...}, ePanel: {j1:...}, kilitli:true, ... }
                const panelKey = panelType === 'a' ? 'aPanel' : 'ePanel';
                const judgeKey = panelId.toLowerCase().replace(/^[ae]/, 'j'); // 'a1'→'j1', 'e1'→'j1'
                myScore = scores[panelKey]?.[judgeKey];
                isLocked = scores.kilitli === true;
                // Başhakem override kilidi (alan-bazlı)
                const lockKey = `${panelKey}__${judgeKey}`;
                fieldOverridden = scores.lockedFields?.[lockKey] === true;
            } else if (isAerobik) {
                // Aerobik: scores = { ePanel: {j1:..., j2:...}, aPanel: {j1:...}, kilitli:true, ... }
                const judgeKey = panelId.toLowerCase().replace(/^e/, 'j'); // 'e1'→'j1'
                myScore = scores.ePanel?.[judgeKey];
                isLocked = scores.kilitli === true;
            } else {
                // Artistik: scores = { e1: val, durum: 'tamamlandi', ... }
                myScore = scores[panelId.toLowerCase()];
                isLocked = scores.durum === 'tamamlandi';
            }

            setServerScore(myScore);
            setServerScores(scores);
            setFieldOverridden(fieldOverridden);

            if (isLocked) {
                setStatus('locked');
            } else if (fieldOverridden) {
                // Başhakem bu alanı kilitledi → 'sj_locked' özel durumu
                setStatus('sj_locked');
            } else if (myScore !== undefined && myScore !== null && myScore !== '') {
                setStatus('sent');
            } else {
                setStatus('scoring');
            }
        });

        return () => unsubScore();
    }, [compId, catId, currentAlet, activeAthleteId, panelId, panelType, tokenVerified, isRitmik, isAerobik]);

    // ── Hakem Çağrısı listener (sadece Ritmik A/E hakem panelleri) ──
    // SJA → A panel hakemleri  ·  SJE → E panel hakemleri
    useEffect(() => {
        if (!isRitmik) return;
        if (!compId || !catId || !currentAlet || !tokenVerified) return;
        const sjRole = panelType === 'a' ? 'sja' : panelType === 'e' ? 'sje' : null;
        if (!sjRole) return;

        const callRef = ref(db, `${firebasePath}/${compId}/refereeCalls/${catId}/${currentAlet}/${sjRole}`);
        const unsub = onValue(callRef, (snap) => {
            const data = snap.val();
            if (!data || !data.ts) return;
            const ts = Number(data.ts);
            if (ts <= lastSeenTsRef.current) return;
            const elapsed = Date.now() - ts;
            if (elapsed >= CALL_DURATION_MS) { lastSeenTsRef.current = ts; return; }
            lastSeenTsRef.current = ts;
            const remaining = CALL_DURATION_MS - elapsed;
            setCalledFlash({ remainingMs: remaining, total: CALL_DURATION_MS });

            if (callTimerRef.current) clearTimeout(callTimerRef.current);
            if (callTickRef.current)  clearInterval(callTickRef.current);

            callTimerRef.current = setTimeout(() => {
                setCalledFlash(null); callTimerRef.current = null;
            }, remaining);
            callTickRef.current = setInterval(() => {
                setCalledFlash((prev) => {
                    if (!prev) return prev;
                    const newRem = prev.remainingMs - 200;
                    if (newRem <= 0) return null;
                    return { ...prev, remainingMs: newRem };
                });
            }, 200);
        });
        return () => {
            unsub();
            if (callTimerRef.current) { clearTimeout(callTimerRef.current); callTimerRef.current = null; }
            if (callTickRef.current)  { clearInterval(callTickRef.current); callTickRef.current = null; }
        };
    }, [isRitmik, compId, catId, currentAlet, tokenVerified, panelType, firebasePath]);

    const handleSendScore = async () => {
        if (!activeAthleteId || scoreInput === '') return;
        if (fieldOverridden) {
            toast("Başhakem bu notu değiştirdi. Yeni not gönderemezsiniz.", "warning");
            return;
        }

        let valStr = String(scoreInput).replace(',', '.');
        const val = parseFloat(valStr);

        if (isNaN(val) || val < 0 || val > 10) {
            toast("Geçersiz Puan! Lütfen geçerli bir kesinti/puan girin (0-10).", "warning");
            return;
        }

        try {
            if (isRitmik) {
                // Ritmik: puanlar/catId/athleteId/aletId/aPanel|ePanel → j1, j2...
                const panelKey = panelType === 'a' ? 'aPanel' : 'ePanel';
                const judgeKey = panelId.toLowerCase().replace(/^[ae]/, 'j'); // 'a1'→'j1'
                const path = `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}/${currentAlet}/${panelKey}`;
                await update(ref(db, path), { [judgeKey]: val });
            } else if (isAerobik) {
                // Aerobik: puanlar/catId/athleteId/ePanel → { j1: val }
                const judgeKey = panelId.toLowerCase().replace(/^e/, 'j'); // 'e1'→'j1'
                const path = `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}/ePanel`;
                await update(ref(db, path), { [judgeKey]: val });
            } else {
                // Artistik: puanlar/catId/aletId/athleteId → { e1: val }
                const path = `${firebasePath}/${compId}/puanlar/${catId}/${aletId}/${activeAthleteId}`;
                const field = panelId.toLowerCase();
                await update(ref(db, path), { [field]: val });
            }
            setScoreInput('');
        } catch (e) {
            toast("Hata oluştu. Lütfen tekrar deneyin.", "error");
        }
    };

    const requestEdit = () => {
        setStatus('scoring');
        setScoreInput(serverScore !== null ? String(serverScore) : '');
    };

    // Validation: aerobik için aletId gerekmez; ritmik dinamik modda aletId yokken activeAlet gelene kadar
    // "alet bekleniyor" göstereceğiz, hata değil. Sadece artistik için aletId şart.
    if (!compId || !catId || !panelId || (!aletId && !isAerobik && !isRitmik)) {
        return (
            <div className="epanel-wrapper epanel-error">
                <h2>Hatalı Link!</h2>
                <p>Lütfen Başhakeminizden size iletilen tam linke (Karekod vb.) tıklayın veya sayfayı yenileyin.</p>
            </div>
        );
    }

    // Token kontrol ediliyor
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

    // Token geçersiz
    if (!tokenVerified) {
        return (
            <div className="epanel-wrapper epanel-error">
                <h2>Yetkisiz Erişim</h2>
                <p>Bu bağlantı geçersiz veya süresi dolmuş. Lütfen Başhakeminizden yeni bir QR kod/link alın.</p>
            </div>
        );
    }

    // Ritmik: waiting for the correct apparatus to be active
    const ritmikAletLabels = { top: 'Top', kurdele: 'Kurdele' };
    // Eski (alet-bazlı) QR'larda: activeAlet, URL'deki aletId ile uyuşmuyorsa bekle
    // Yeni (alet-bağımsız) QR'larda: activeAlet null ise bekle (henüz alet seçilmemiş)
    const waitingForAlet = isRitmik && (
        ritmikAletDynamic
            ? !activeAlet                                // dinamik mod: alet seçimi bekleniyor
            : (activeAlet !== null && activeAlet !== aletId)   // sabit alet modu: yanlış alet
    );

    return (
        <div className="epanel-wrapper">
            <div className="epanel-header">
                <div>
                    <div className="header-sub">{compName}</div>
                    <div className="header-title">{refereeName}</div>
                    {isRitmik && (
                        <div className="header-alet">
                            {currentAlet ? (ritmikAletLabels[currentAlet] || currentAlet) : '— Alet Bekleniyor —'} · {panelType === 'a' ? 'Artistlik' : 'İcra'}
                        </div>
                    )}
                </div>
                <div className="panel-badge">{panelId.toUpperCase()}</div>
            </div>

            <div className="epanel-main">
                {waitingForAlet && (
                    <div className="view-section active waiting-view">
                        <span className="material-icons-round waiting-icon">{ritmikAletDynamic ? 'hourglass_empty' : 'swap_horiz'}</span>
                        <div className="waiting-text">
                            {ritmikAletDynamic
                                ? 'Alet Bekleniyor...'
                                : `${ritmikAletLabels[activeAlet] || activeAlet} Değerlendiriliyor`}
                        </div>
                        <p className="waiting-subtext">
                            {ritmikAletDynamic
                                ? 'Başhakem alet seçtiğinde ekranınız otomatik açılacaktır.'
                                : `${ritmikAletLabels[aletId] || aletId} değerlendirmesi başladığında ekranınız açılacaktır.`}
                        </p>
                    </div>
                )}

                {!waitingForAlet && status === 'waiting' && (
                    <div className="view-section active waiting-view">
                        <span className="material-icons-round waiting-icon">hourglass_empty</span>
                        <div className="waiting-text">Sporcu Bekleniyor...</div>
                        <p className="waiting-subtext">Başhakem tarafından sporcu çağrıldığında ekranınız açılacaktır.</p>
                    </div>
                )}

                {!waitingForAlet && status === 'scoring' && athleteInfo && (
                    <div className="view-section active scoring-view">
                        <div className="athlete-card">
                            <div className="athlete-name">{athleteInfo.ad} {athleteInfo.soyad}</div>
                            <div className="athlete-club">{athleteInfo.kulup || '-'}</div>
                        </div>

                        <div className="scoring-card">
                            <div className="input-label">
                                {isRitmik && panelType === 'a' ? 'Artistlik Kesintisi / A Puanı' : 'Uygulama Kesintisi / E Puanı'}
                            </div>
                            <input
                                type="number"
                                className="score-input"
                                placeholder="-"
                                step="0.1"
                                min="0"
                                max="10"
                                value={scoreInput}
                                onChange={(e) => setScoreInput(e.target.value)}
                                autoFocus
                            />
                            <div className="quick-buttons">
                                <button type="button" onClick={() => setScoreInput('0.1')}>-0.1</button>
                                <button type="button" onClick={() => setScoreInput('0.3')}>-0.3</button>
                                <button type="button" onClick={() => setScoreInput('0.5')}>-0.5</button>
                                <button type="button" onClick={() => setScoreInput('1.0')}>-1.0</button>
                            </div>
                            <button className="send-btn" onClick={handleSendScore}>
                                <span className="material-icons-round">send</span> GÖNDER
                            </button>
                        </div>
                    </div>
                )}

                {/* Başhakem alanı kilitledi — yeni not gönderilemez */}
                {!waitingForAlet && status === 'sj_locked' && athleteInfo && (
                    <div className="view-section active sent-view">
                        <span className="material-icons-round sent-icon" style={{ color: '#f59e0b', fontSize: 64 }}>
                            gavel
                        </span>
                        <h2 className="sent-title" style={{ color: '#fbbf24' }}>Başhakem Kararı</h2>
                        <p className="sent-desc" style={{ marginTop: 8 }}>
                            Başhakem bu notu <strong>{serverScore != null ? Number(serverScore).toFixed(3) : '—'}</strong> olarak değiştirdi.<br/>
                            Yeni not gönderemezsiniz. Düzeltme istiyorsanız Başhakem ile görüşün.
                        </p>
                        <div style={{
                            marginTop: 16, padding: '0.75rem 1rem',
                            background: 'rgba(245, 158, 11, 0.12)',
                            border: '1px solid rgba(245, 158, 11, 0.3)',
                            borderRadius: '0.5rem',
                            fontSize: '0.8rem',
                            color: 'rgba(255,255,255,0.7)',
                            textAlign: 'center',
                        }}>
                            Sporcu: <strong>{athleteInfo.ad} {athleteInfo.soyad}</strong>
                        </div>
                    </div>
                )}

                {!waitingForAlet && (status === 'sent' || status === 'locked') && (
                    <div className="view-section active sent-view">
                        {/* Ritmik + kilit → tüm panel özeti göster (sporcu adı + DA/DB/A/E + Total) */}
                        {isRitmik && status === 'locked' ? (
                            <RitmikLockedSummary
                                athleteName={athleteInfo ? `${athleteInfo.ad || ''} ${athleteInfo.soyad || ''}`.trim() : ''}
                                aletLabel={ritmikAletLabels[currentAlet] || currentAlet}
                                scores={serverScores}
                            />
                        ) : (
                            <>
                                <span className="material-icons-round sent-icon" style={{ color: status === 'locked' ? '#6b7280' : 'var(--success)' }}>
                                    {status === 'locked' ? 'lock' : 'check_circle'}
                                </span>
                                <h2 className="sent-title">{status === 'locked' ? 'Puan Kilitlendi' : 'İletildi'}</h2>

                                {athleteInfo && (
                                    <div style={{
                                        margin: '4px 0 12px',
                                        padding: '0.55rem 1rem',
                                        background: 'rgba(255,255,255,0.06)',
                                        border: '1px solid rgba(255,255,255,0.12)',
                                        borderRadius: '0.55rem',
                                        textAlign: 'center',
                                    }}>
                                        <div style={{ fontSize: '1rem', fontWeight: 800, color: '#fff' }}>
                                            {athleteInfo.ad} {athleteInfo.soyad}
                                        </div>
                                        {(athleteInfo.kulup || athleteInfo.okul) && (
                                            <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>
                                                {athleteInfo.kulup || athleteInfo.okul}
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="sent-score-display" style={{ color: status === 'locked' ? '#9ca3af' : 'var(--neon-green)' }}>
                                    {serverScore !== null ? Number(serverScore).toFixed(2) : ''}
                                </div>

                                <p className="sent-desc">
                                    {status === 'locked'
                                        ? 'Başhakem puanı onayladı. Artık değişiklik yapılamaz.'
                                        : 'Puanınız Başhakem ekranına ulaştı. Onay bekleniyor.'}
                                </p>

                                {status !== 'locked' && (
                                    <button className="edit-btn" onClick={requestEdit}>Düzeltme Yap</button>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Hakem Çağrısı Flash Card — SJA → A hakemleri / SJE → E hakemleri */}
            {calledFlash && (
                <div style={{
                    position: 'fixed', inset: 0,
                    background: 'rgba(15, 23, 42, 0.92)',
                    backdropFilter: 'blur(8px)',
                    zIndex: 99999,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    gap: '1.5rem', padding: '2rem',
                    textAlign: 'center',
                    animation: 'pulse-call 1.5s ease-in-out infinite',
                }}>
                    <style>{`
                        @keyframes pulse-call {
                            0%, 100% { background: rgba(15,23,42,0.92); }
                            50% { background: rgba(220,38,38,0.85); }
                        }
                        @keyframes shake-icon {
                            0%, 100% { transform: rotate(0deg); }
                            25% { transform: rotate(-15deg); }
                            75% { transform: rotate(15deg); }
                        }
                    `}</style>
                    <div style={{ fontSize: 96, animation: 'shake-icon 0.5s ease-in-out infinite' }}>📢</div>
                    <div style={{
                        fontSize: '2.4rem', fontWeight: 900,
                        color: '#fbbf24', letterSpacing: '0.04em',
                        textShadow: '0 4px 20px rgba(251,191,36,0.5)',
                    }}>
                        SJ PANELİNE GİDİNİZ
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', opacity: 0.9 }}>
                        {(panelType === 'a' ? 'A' : 'E')}{panelId ? panelId.replace(/^[ae]/i, '') : ''} Hakemi
                    </div>
                    <div style={{
                        width: '70%', maxWidth: 360, height: 8,
                        background: 'rgba(255,255,255,0.15)', borderRadius: 4, overflow: 'hidden',
                        marginTop: '0.5rem',
                    }}>
                        <div style={{
                            height: '100%',
                            width: `${(calledFlash.remainingMs / calledFlash.total) * 100}%`,
                            background: 'linear-gradient(90deg, #fbbf24, #ef4444)',
                            transition: 'width 0.2s linear',
                        }} />
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)' }}>
                        {Math.ceil(calledFlash.remainingMs / 1000)} saniye
                    </div>
                </div>
            )}
        </div>
    );
}
