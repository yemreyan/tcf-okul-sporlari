import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { validateEPanelToken } from '../lib/epanelToken';
import { useNotification } from '../lib/NotificationContext';
import { useDiscipline } from '../lib/DisciplineContext';
import './EPanelPage.css';

export default function EPanelPage() {
    const { toast } = useNotification();
    const { firebasePath, id: disciplineId } = useDiscipline();
    const isRitmik = disciplineId === 'ritmik';
    const [searchParams] = useSearchParams();
    const compId = searchParams.get('competitionId');
    const catId = searchParams.get('catId');
    const aletId = searchParams.get('aletId');
    const panelId = searchParams.get('panelId'); // E1..E4 | A1..A4
    const panelType = searchParams.get('panelType') || 'e'; // 'a' | 'e' — Ritmik only
    const urlToken = searchParams.get('token'); // Güvenlik token'ı

    const [activeAthleteId, setActiveAthleteId] = useState(null);
    const [activeAlet, setActiveAlet] = useState(null); // Ritmik: tracks aktifAlet
    const [athleteInfo, setAthleteInfo] = useState(null);

    // Status: 'waiting', 'scoring', 'sent', 'locked', 'unauthorized'
    const [status, setStatus] = useState('waiting');
    const [tokenVerified, setTokenVerified] = useState(false);
    const [tokenChecking, setTokenChecking] = useState(true);

    const [scoreInput, setScoreInput] = useState('');
    const [serverScore, setServerScore] = useState(null);

    const [compName, setCompName] = useState('...');
    const [refereeName, setRefereeName] = useState('...');

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
        if (!compId || !catId || !aletId || !panelId || !tokenVerified) return;

        // Fetch Comp Name
        const compRef = ref(db, `${firebasePath}/${compId}`);
        const unsubComp = onValue(compRef, (snap) => {
            const data = snap.val();
            if (data) setCompName(data.isim || 'Yarışma');
            // Check if there is a specific name registered for this panel
            const hakemVal = data?.hakemler?.[catId]?.[aletId]?.[panelId];
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
            const activeRef = ref(db, `${firebasePath}/${compId}/aktifSporcu/${catId}`);
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
            // Also track which alet is currently active
            const aletRef = ref(db, `${firebasePath}/${compId}/aktifAlet/${catId}`);
            unsubAlet = onValue(aletRef, (snap) => {
                setActiveAlet(snap.val());
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
    }, [compId, catId, aletId, panelId, panelType, tokenVerified, isRitmik]);

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

        if (ath) {
            setAthleteInfo(ath);
        } else {
            setAthleteInfo({ ad: 'Bilinmeyen', soyad: 'Sporcu', kulup: '' });
        }
    };

    // Listen to specific score for this athlete
    useEffect(() => {
        if (!compId || !catId || !aletId || !activeAthleteId || !panelId || !tokenVerified) return;

        let scoreRef;
        if (isRitmik) {
            // Ritmik: athlete-first — puanlar/catId/athleteId/aletId
            scoreRef = ref(db, `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}/${aletId}`);
        } else {
            // Artistik: apparatus-first — puanlar/catId/aletId/athleteId
            scoreRef = ref(db, `${firebasePath}/${compId}/puanlar/${catId}/${aletId}/${activeAthleteId}`);
        }

        const unsubScore = onValue(scoreRef, (snap) => {
            const scores = snap.val() || {};
            let myScore, isLocked;

            if (isRitmik) {
                // Ritmik: scores = { aPanel: {j1:..., j2:...}, ePanel: {j1:...}, kilitli:true, ... }
                const panelKey = panelType === 'a' ? 'aPanel' : 'ePanel';
                const judgeKey = panelId.toLowerCase().replace(/^[ae]/, 'j'); // 'a1'→'j1', 'e1'→'j1'
                myScore = scores[panelKey]?.[judgeKey];
                isLocked = scores.kilitli === true;
            } else {
                // Artistik: scores = { e1: val, durum: 'tamamlandi', ... }
                myScore = scores[panelId.toLowerCase()];
                isLocked = scores.durum === 'tamamlandi';
            }

            setServerScore(myScore);

            if (isLocked) {
                setStatus('locked');
            } else if (myScore !== undefined && myScore !== null && myScore !== '') {
                setStatus('sent');
            } else {
                setStatus('scoring');
            }
        });

        return () => unsubScore();
    }, [compId, catId, aletId, activeAthleteId, panelId, panelType, tokenVerified, isRitmik]);

    const handleSendScore = async () => {
        if (!activeAthleteId || scoreInput === '') return;

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
                const path = `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}/${aletId}/${panelKey}`;
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

    if (!compId || !catId || !aletId || !panelId) {
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
    const waitingForAlet = isRitmik && activeAlet !== null && activeAlet !== aletId;

    return (
        <div className="epanel-wrapper">
            <div className="epanel-header">
                <div>
                    <div className="header-sub">{compName}</div>
                    <div className="header-title">{refereeName}</div>
                    {isRitmik && (
                        <div className="header-alet">{ritmikAletLabels[aletId] || aletId} · {panelType === 'a' ? 'Artistlik' : 'İcra'}</div>
                    )}
                </div>
                <div className="panel-badge">{panelId.toUpperCase()}</div>
            </div>

            <div className="epanel-main">
                {waitingForAlet && (
                    <div className="view-section active waiting-view">
                        <span className="material-icons-round waiting-icon">swap_horiz</span>
                        <div className="waiting-text">{ritmikAletLabels[activeAlet] || activeAlet} Değerlendiriliyor</div>
                        <p className="waiting-subtext">{ritmikAletLabels[aletId] || aletId} değerlendirmesi başladığında ekranınız açılacaktır.</p>
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

                {!waitingForAlet && (status === 'sent' || status === 'locked') && (
                    <div className="view-section active sent-view">
                        <span className="material-icons-round sent-icon" style={{ color: status === 'locked' ? '#6b7280' : 'var(--success)' }}>
                            {status === 'locked' ? 'lock' : 'check_circle'}
                        </span>
                        <h2 className="sent-title">{status === 'locked' ? 'Puan Kilitlendi' : 'İletildi'}</h2>

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
                    </div>
                )}
            </div>
        </div>
    );
}
