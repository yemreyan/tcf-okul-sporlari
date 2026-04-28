import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { validateEPanelToken } from '../lib/epanelToken';
import { useNotification } from '../lib/NotificationContext';
import { useDiscipline } from '../lib/DisciplineContext';
import './EPanelPage.css';

// DA = alet zorluğu (apparatus difficulty), DB = vücut zorluğu (body difficulty)
// panelType = 'da' | 'db'

export default function RitmikDPanelPage() {
    const { toast } = useNotification();
    const { firebasePath } = useDiscipline();
    const [searchParams] = useSearchParams();
    const compId   = searchParams.get('competitionId');
    const catId    = searchParams.get('catId');
    const aletId   = searchParams.get('aletId');   // 'top' | 'kurdele'
    const panelType = searchParams.get('panelType') || 'da'; // 'da' | 'db'
    const urlToken = searchParams.get('token');

    const [activeAthleteId, setActiveAthleteId] = useState(null);
    const [activeAlet, setActiveAlet]           = useState(null);
    const [athleteInfo, setAthleteInfo]         = useState(null);
    const [status, setStatus]                   = useState('waiting'); // 'waiting' | 'scoring' | 'sent' | 'locked'
    const [tokenVerified, setTokenVerified]     = useState(false);
    const [tokenChecking, setTokenChecking]     = useState(true);
    const [scoreInput, setScoreInput]           = useState('');
    const [serverScore, setServerScore]         = useState(null);
    const [compName, setCompName]               = useState('...');

    const ritmikAletLabels = { top: 'Top', kurdele: 'Kurdele' };
    const panelLabel       = panelType === 'da' ? 'DA' : 'DB';
    const panelTitle       = panelType === 'da' ? 'Alet Zorluğu' : 'Vücut Zorluğu';
    const panelDesc        = panelType === 'da' ? 'DA Hakemi — Alet Zorluk Puanı' : 'DB Hakemi — Vücut Zorluk Puanı';
    const aletLabel        = ritmikAletLabels[aletId] || aletId;

    // ── Token doğrulama ──
    useEffect(() => {
        if (!compId || !urlToken) { setTokenChecking(false); setTokenVerified(false); return; }
        get(ref(db, `${firebasePath}/${compId}/epanelToken`)).then((snap) => {
            setTokenVerified(!!(snap.val() && validateEPanelToken(urlToken, snap.val())));
            setTokenChecking(false);
        }).catch(() => { setTokenVerified(false); setTokenChecking(false); });
    }, [compId, urlToken, firebasePath]);

    // ── Yarışma adı + aktif sporcu takibi ──
    useEffect(() => {
        if (!compId || !catId || !tokenVerified) return;

        const unsubComp = onValue(ref(db, `${firebasePath}/${compId}/isim`), (snap) => {
            if (snap.val()) setCompName(snap.val());
        });

        // Aktif sporcu (Ritmik: kategori bazlı)
        const unsubActive = onValue(ref(db, `${firebasePath}/${compId}/aktifSporcu/${catId}`), (snap) => {
            const newId = snap.val() ? String(snap.val()) : null;
            setActiveAthleteId(newId);
            if (newId) fetchAthlete(newId);
            else { setAthleteInfo(null); setStatus('waiting'); setScoreInput(''); setServerScore(null); }
        });

        // Aktif alet takibi
        const unsubAlet = onValue(ref(db, `${firebasePath}/${compId}/aktifAlet/${catId}`), (snap) => {
            setActiveAlet(snap.val());
        });

        return () => { unsubComp(); unsubActive(); unsubAlet(); };
    }, [compId, catId, tokenVerified, firebasePath]);

    const fetchAthlete = async (id) => {
        const snap = await get(ref(db, `${firebasePath}/${compId}/sporcular/${catId}/${id}`));
        let ath = snap.val();
        if (!ath) { const g = await get(ref(db, `globalSporcular/${id}`)); ath = g.val(); }
        setAthleteInfo(ath || { ad: 'Bilinmeyen', soyad: 'Sporcu', kulup: '' });
    };

    // ── Puan dinleme: puanlar/catId/athleteId/aletId/daScore | dbScore ──
    useEffect(() => {
        if (!compId || !catId || !aletId || !activeAthleteId || !tokenVerified) return;
        const scoreRef = ref(db, `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}/${aletId}`);
        const unsub = onValue(scoreRef, (snap) => {
            const data = snap.val() || {};
            const myScore = panelType === 'da' ? data.daScore : data.dbScore;
            const isLocked = data.kilitli === true;
            setServerScore(myScore ?? null);
            if (isLocked)                                        setStatus('locked');
            else if (myScore !== undefined && myScore !== null) setStatus('sent');
            else                                                 setStatus('scoring');
        });
        return () => unsub();
    }, [compId, catId, aletId, activeAthleteId, panelType, tokenVerified, firebasePath]);

    // ── Puan gönder ──
    const handleSendScore = async () => {
        if (!activeAthleteId || scoreInput === '') return;
        const valStr = String(scoreInput).replace(',', '.');
        const val    = parseFloat(valStr);
        if (isNaN(val) || val < 0) {
            toast('Geçersiz puan! Lütfen 0 veya üzeri bir sayı girin.', 'warning');
            return;
        }
        try {
            const path = `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}/${aletId}`;
            const field = panelType === 'da' ? 'daScore' : 'dbScore';
            await update(ref(db, path), { [field]: val });
            setScoreInput('');
        } catch {
            toast('Hata oluştu. Lütfen tekrar deneyin.', 'error');
        }
    };

    const requestEdit = () => { setStatus('scoring'); setScoreInput(serverScore !== null ? String(serverScore) : ''); };

    // ── Guard: eksik URL parametresi ──
    if (!compId || !catId || !aletId) {
        return (
            <div className="epanel-wrapper epanel-error">
                <h2>Hatalı Link!</h2>
                <p>Lütfen Başhakeminizden iletilen tam linke tıklayın veya sayfayı yenileyin.</p>
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
                <p>Bu bağlantı geçersiz veya süresi dolmuş. Lütfen Başhakeminizden yeni bir QR kod/link alın.</p>
            </div>
        );
    }

    // Yanlış alet aktif mi?
    const waitingForAlet = activeAlet !== null && activeAlet !== aletId;

    return (
        <div className="epanel-wrapper">
            <div className="epanel-header">
                <div>
                    <div className="header-sub">{compName}</div>
                    <div className="header-title">{panelDesc}</div>
                    <div className="header-alet">{aletLabel} · {panelTitle}</div>
                </div>
                <div className="panel-badge" style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' }}>
                    {panelLabel}
                </div>
            </div>

            <div className="epanel-main">
                {/* Yanlış alet bekleniyor */}
                {waitingForAlet && (
                    <div className="view-section active waiting-view">
                        <span className="material-icons-round waiting-icon">swap_horiz</span>
                        <div className="waiting-text">{ritmikAletLabels[activeAlet] || activeAlet} Değerlendiriliyor</div>
                        <p className="waiting-subtext">{aletLabel} değerlendirmesi başladığında ekranınız açılacaktır.</p>
                    </div>
                )}

                {/* Sporcu bekleniyor */}
                {!waitingForAlet && status === 'waiting' && (
                    <div className="view-section active waiting-view">
                        <span className="material-icons-round waiting-icon">hourglass_empty</span>
                        <div className="waiting-text">Sporcu Bekleniyor...</div>
                        <p className="waiting-subtext">Başhakem tarafından sporcu çağrıldığında ekranınız açılacaktır.</p>
                    </div>
                )}

                {/* Puan girişi */}
                {!waitingForAlet && status === 'scoring' && athleteInfo && (
                    <div className="view-section active scoring-view">
                        <div className="athlete-card">
                            <div className="athlete-name">{athleteInfo.ad} {athleteInfo.soyad}</div>
                            <div className="athlete-club">{athleteInfo.kulup || athleteInfo.okul || '-'}</div>
                        </div>
                        <div className="scoring-card">
                            <div className="input-label">
                                {panelTitle} / {panelLabel} Puanı
                            </div>
                            <input
                                type="number"
                                className="score-input"
                                placeholder="0.000"
                                step="0.1"
                                min="0"
                                value={scoreInput}
                                onChange={(e) => setScoreInput(e.target.value)}
                                autoFocus
                            />
                            <div className="quick-buttons">
                                <button type="button" onClick={() => setScoreInput('0.1')}>0.1</button>
                                <button type="button" onClick={() => setScoreInput('0.3')}>0.3</button>
                                <button type="button" onClick={() => setScoreInput('0.5')}>0.5</button>
                                <button type="button" onClick={() => setScoreInput('1.0')}>1.0</button>
                            </div>
                            <button className="send-btn" onClick={handleSendScore}>
                                <span className="material-icons-round">send</span> GÖNDER
                            </button>
                        </div>
                    </div>
                )}

                {/* Gönderildi / Kilitli */}
                {!waitingForAlet && (status === 'sent' || status === 'locked') && (
                    <div className="view-section active sent-view">
                        <span
                            className="material-icons-round sent-icon"
                            style={{ color: status === 'locked' ? '#6b7280' : 'var(--success)' }}
                        >
                            {status === 'locked' ? 'lock' : 'check_circle'}
                        </span>
                        <h2 className="sent-title">{status === 'locked' ? 'Puan Kilitlendi' : 'İletildi'}</h2>
                        <div className="sent-score-display" style={{ color: status === 'locked' ? '#9ca3af' : 'var(--neon-green)' }}>
                            {serverScore !== null ? Number(serverScore).toFixed(3) : ''}
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
