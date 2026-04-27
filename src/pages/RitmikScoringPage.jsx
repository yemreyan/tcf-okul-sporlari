import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import {
    RITMIK_CATEGORIES,
    RITMIK_ALETLER,
} from '../data/ritmikCriteriaDefaults';
import { useAuth } from '../lib/AuthContext';
import { useDiscipline } from '../lib/DisciplineContext';
import { useOffline } from '../lib/OfflineContext';
import { useNotification } from '../lib/NotificationContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { logAction } from '../lib/auditLogger';
import './RitmikScoringPage.css';

export default function RitmikScoringPage() {
    const navigate = useNavigate();
    const { currentUser, hasPermission, hashPassword } = useAuth();
    const { firebasePath } = useDiscipline();
    const { offlineWrite } = useOffline();
    const { toast } = useNotification();

    // ─── Data ───
    const [competitions, setCompetitions]         = useState({});
    const [selectedCity, setSelectedCity]         = useState('');
    const [selectedCompId, setSelectedCompId]     = useState('');
    const [selectedCategory, setSelectedCategory] = useState('');

    // ─── Athletes ───
    const [athletesByRotation, setAthletesByRotation] = useState([]);
    const [existingScores, setExistingScores]         = useState({});
    const [selectedAthlete, setSelectedAthlete]       = useState(null);
    const [isAthleteCalled, setIsAthleteCalled]       = useState(false);

    // ─── Alet (Top / Kurdele) ───
    const [selectedAlet, setSelectedAlet] = useState('top');

    // ─── Scoring ───
    const [aPanelLocal, setAPanelLocal] = useState({});   // A: artistlik kesintileri (4 hakem)
    const [ePanelLocal, setEPanelLocal] = useState({});   // E: icra kesintileri (4 hakem)
    const [dbScoreInput, setDbScoreInput] = useState(''); // DB: vücut zorluğu (manuel)
    const [daScoreInput, setDaScoreInput] = useState(''); // DA: alet zorluğu (manuel)
    const [penaltyInput, setPenaltyInput] = useState(''); // Toplam ceza (manuel)

    // ─── Lock ───
    const [unlockModal, setUnlockModal]               = useState(null);
    const [unlockPassword, setUnlockPassword]         = useState('');
    const [unlockError, setUnlockError]               = useState('');
    const [unlockingInProgress, setUnlockingInProgress] = useState(false);
    const [scoringFieldsTouched, setScoringFieldsTouched] = useState(false);

    // ─── UI ───
    const [sidebarOpen, setSidebarOpen]   = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [confirmModal, setConfirmModal] = useState(null);
    const [successModal, setSuccessModal] = useState(null);

    // ─── Firebase: Yarışmalar ───
    useEffect(() => {
        const unsub = onValue(ref(db, firebasePath), (snap) => {
            setCompetitions(filterCompetitionsByUser(snap.val() || {}, currentUser));
        });
        return () => unsub();
    }, [currentUser, firebasePath]);

    // ─── Firebase: Sporcular + Puanlar ───
    useEffect(() => {
        if (!selectedCompId || !selectedCategory) {
            setAthletesByRotation([]);
            setExistingScores({});
            setSelectedAthlete(null);
            setIsAthleteCalled(false);
            return;
        }
        const orderRef = ref(db, `${firebasePath}/${selectedCompId}/siralama/${selectedCategory}`);
        const unsubOrder = onValue(orderRef, (snap) => {
            const orderData = snap.val();
            const rotations = [];
            if (orderData) {
                const maxRots = Math.max(...Object.keys(orderData)
                    .map(k => parseInt(k.replace('rotation_', '')))
                    .filter(n => !isNaN(n)));
                for (let i = 0; i <= maxRots; i++) {
                    const rotData = orderData[`rotation_${i}`];
                    if (rotData) {
                        const arr = Object.keys(rotData).map(id => ({ id, ...rotData[id] })).sort((a, b) => a.sirasi - b.sirasi);
                        rotations.push(arr);
                    } else {
                        rotations.push([]);
                    }
                }
                setAthletesByRotation(rotations);
            } else {
                const fbRef = ref(db, `${firebasePath}/${selectedCompId}/sporcular/${selectedCategory}`);
                get(fbRef).then((fbSnap) => {
                    const fbData = fbSnap.val();
                    if (fbData) {
                        const arr = Object.keys(fbData).map((id, idx) => ({ id, ...fbData[id], _kayitSirasi: idx + 1 }));
                        arr.sort((a, b) => {
                            const sa = (a.cikisSirasi !== undefined && a.cikisSirasi !== 999) ? a.cikisSirasi : a._kayitSirasi;
                            const sb = (b.cikisSirasi !== undefined && b.cikisSirasi !== 999) ? b.cikisSirasi : b._kayitSirasi;
                            return sa - sb;
                        });
                        setAthletesByRotation([arr]);
                    }
                });
            }
        });

        const scoresRef = ref(db, `${firebasePath}/${selectedCompId}/puanlar/${selectedCategory}`);
        const unsubScores = onValue(scoresRef, (snap) => {
            setExistingScores(snap.val() || {});
        });

        return () => { unsubOrder(); unsubScores(); };
    }, [selectedCompId, selectedCategory, firebasePath]);

    // ─── Sync panel when athlete or alet changes ───
    useEffect(() => {
        if (!selectedAthlete || scoringFieldsTouched) return;
        const aletScore = existingScores[selectedAthlete.id]?.[selectedAlet];
        if (aletScore) {
            setAPanelLocal(aletScore.aPanel || {});
            setEPanelLocal(aletScore.ePanel || {});
            setDbScoreInput(aletScore.dbScore != null ? String(aletScore.dbScore) : '');
            setDaScoreInput(aletScore.daScore != null ? String(aletScore.daScore) : '');
            setPenaltyInput(aletScore.penaltyTotal != null ? String(aletScore.penaltyTotal) : '');
        } else {
            setAPanelLocal({});
            setEPanelLocal({});
            setDbScoreInput('');
            setDaScoreInput('');
            setPenaltyInput('');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [existingScores, selectedAthlete?.id, selectedAlet]);

    // ─── Derived ───
    const catConfig  = RITMIK_CATEGORIES[selectedCategory] || {};
    const judgeCount = catConfig.judgeCount || 4;

    // Per-alet lock check
    const scoreLocked = existingScores[selectedAthlete?.id]?.[selectedAlet]?.kilitli === true;

    const availableCities = [...new Set(
        Object.values(competitions).map(c => (c.il || c.city || '').toLocaleUpperCase('tr-TR')).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'tr-TR'));

    const compOptions = Object.entries(competitions)
        .filter(([, comp]) => !selectedCity || (comp.il || comp.city || '').toLocaleUpperCase('tr-TR') === selectedCity)
        .sort((a, b) => new Date(b[1].tarih || b[1].baslangicTarihi || 0) - new Date(a[1].tarih || a[1].baslangicTarihi || 0));

    let categoryOptions = [];
    if (selectedCompId && competitions[selectedCompId]?.sporcular) {
        categoryOptions = Object.keys(competitions[selectedCompId].sporcular);
    } else if (selectedCompId && competitions[selectedCompId]?.kategoriler) {
        categoryOptions = Object.keys(competitions[selectedCompId].kategoriler);
    }

    // ─── Score Calculations ───

    const calcPanelScore = (panelLocal) => {
        const vals = [];
        for (let i = 1; i <= judgeCount; i++) {
            const v = parseFloat(panelLocal[`j${i}`]);
            if (!isNaN(v)) vals.push(v);
        }
        if (vals.length === 0) return 0;
        if (vals.length >= 4) {
            vals.sort((a, b) => a - b);
            const trimmed = vals.slice(1, -1);
            const avg = trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
            return Math.max(0, 10 - avg);
        }
        const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
        return Math.max(0, 10 - avg);
    };

    const aScore          = calcPanelScore(aPanelLocal);
    const eScore          = calcPanelScore(ePanelLocal);
    const dbScore         = parseFloat(dbScoreInput) || 0;
    const daScoreNum      = parseFloat(daScoreInput) || 0;
    const totalPenalties  = parseFloat(penaltyInput) || 0;
    const totalDifficulty = daScoreNum + dbScore;

    // Formül: DA + DB + A + E − Ceza
    const finalScore = Math.max(0, totalDifficulty + eScore + aScore - totalPenalties).toFixed(3);

    // ─── Handlers ───
    const resetPanel = useCallback(() => {
        setAPanelLocal({});
        setEPanelLocal({});
        setDbScoreInput('');
        setDaScoreInput('');
        setPenaltyInput('');
        setScoringFieldsTouched(false);
    }, []);

    const handleSelectAthlete = (athlete) => {
        if (selectedAthlete?.id === athlete.id) return;
        setSelectedAthlete(athlete);
        setIsAthleteCalled(false);
        setScoringFieldsTouched(false);
        setSelectedAlet('top'); // alet seçimini sıfırla
        const aletScore = existingScores[athlete.id]?.['top'];
        if (aletScore) {
            setAPanelLocal(aletScore.aPanel || {});
            setEPanelLocal(aletScore.ePanel || {});
            setDbScoreInput(aletScore.dbScore != null ? String(aletScore.dbScore) : '');
            setDaScoreInput(aletScore.daScore != null ? String(aletScore.daScore) : '');
            setPenaltyInput(aletScore.penaltyTotal != null ? String(aletScore.penaltyTotal) : '');
        } else {
            resetPanel();
        }
    };

    const handleSelectAlet = (aletKey) => {
        if (aletKey === selectedAlet) return;
        setSelectedAlet(aletKey);
        setScoringFieldsTouched(false);
        // Sync aktifAlet so A/E panel judges know which apparatus is active
        if (isAthleteCalled && selectedCompId && selectedCategory) {
            update(ref(db), {
                [`${firebasePath}/${selectedCompId}/aktifAlet/${selectedCategory}`]: aletKey,
            }).catch(() => {});
        }
        const aletScore = existingScores[selectedAthlete?.id]?.[aletKey];
        if (aletScore) {
            setAPanelLocal(aletScore.aPanel || {});
            setEPanelLocal(aletScore.ePanel || {});
            setDbScoreInput(aletScore.dbScore != null ? String(aletScore.dbScore) : '');
            setDaScoreInput(aletScore.daScore != null ? String(aletScore.daScore) : '');
            setPenaltyInput(aletScore.penaltyTotal != null ? String(aletScore.penaltyTotal) : '');
        } else {
            resetPanel();
        }
    };

    const handleCallAthlete = async () => {
        setIsAthleteCalled(true);
        try {
            await update(ref(db), {
                [`${firebasePath}/${selectedCompId}/aktifSporcu/${selectedCategory}`]: selectedAthlete.id,
                [`${firebasePath}/${selectedCompId}/aktifAlet/${selectedCategory}`]: selectedAlet,
            });
        } catch (e) { if (import.meta.env.DEV) console.error('aktifSporcu error', e); }
    };

    const getNextAthlete = () => {
        if (!selectedAthlete || athletesByRotation.length === 0) return null;
        const all = athletesByRotation.flat();
        const idx = all.findIndex(a => a.id === selectedAthlete.id);
        if (idx === -1 || idx >= all.length - 1) return null;
        return all[idx + 1];
    };

    // ─── Submit ───
    const handleSubmitScore = () => {
        if (!selectedAthlete) return toast('Lütfen bir sporcu seçin.', 'warning');
        if (scoreLocked)       return toast('Bu aletin puanı kilitli. Kilidi açmak için kilit ikonuna tıklayın.', 'warning');

        const filledA = Object.values(aPanelLocal).filter(v => v !== '' && !isNaN(parseFloat(v)));
        if (filledA.length === 0) return toast('A (Artistlik) puanı girilmeden kayıt yapılamaz.', 'warning');

        const filledE = Object.values(ePanelLocal).filter(v => v !== '' && !isNaN(parseFloat(v)));
        if (filledE.length === 0) return toast('E (İcra) puanı girilmeden kayıt yapılamaz.', 'warning');

        if (dbScoreInput === '' || isNaN(parseFloat(dbScoreInput))) {
            return toast('DB (Vücut Zorluğu) puanı girilmeden kayıt yapılamaz.', 'warning');
        }

        if (daScoreInput === '' || isNaN(parseFloat(daScoreInput))) {
            return toast('DA (Alet Zorluğu) puanı girilmeden kayıt yapılamaz.', 'warning');
        }

        const fVal = parseFloat(finalScore);
        if (isNaN(fVal)) return toast('Final puanı hesaplanamadı.', 'error');

        const aletLabel = RITMIK_ALETLER[selectedAlet]?.label || selectedAlet;
        setConfirmModal({
            athlete: selectedAthlete,
            aletLabel,
            daScore: daScoreNum, dbScore, eScore, aScore, totalPenalties, finalScore, fVal,
        });
    };

    const handleConfirmSubmit = async () => {
        if (!confirmModal) return;
        setIsSubmitting(true);
        const basePath = `${firebasePath}/${selectedCompId}/puanlar/${selectedCategory}/${selectedAthlete.id}`;

        try {
            const aletScoreData = {
                aPanel:       aPanelLocal,
                ePanel:       ePanelLocal,
                dbScore:      parseFloat(dbScore.toFixed(3)),
                daScore:      parseFloat(daScoreNum.toFixed(3)),
                penaltyTotal: parseFloat(totalPenalties.toFixed(3)),
                aScore:       parseFloat(aScore.toFixed(3)),
                eScore:       parseFloat(eScore.toFixed(3)),
                dScore:       parseFloat(totalDifficulty.toFixed(3)),
                sonuc:        parseFloat(confirmModal.finalScore),
                durum:        'tamamlandi',
                kilitli:      true,
                timestamp:    Date.now(),
                hakem:        currentUser?.adSoyad || currentUser?.kullaniciAdi || '',
            };

            // Diğer aletin mevcut puanını oku
            const otherAlet  = selectedAlet === 'top' ? 'kurdele' : 'top';
            const otherScore = existingScores[selectedAthlete.id]?.[otherAlet];
            const otherSonuc = otherScore?.durum === 'tamamlandi' ? (parseFloat(otherScore.sonuc) || 0) : 0;
            const bothDone   = otherScore?.durum === 'tamamlandi';
            const newToplam  = aletScoreData.sonuc + otherSonuc;

            const updates = {
                [`${basePath}/${selectedAlet}`]:  aletScoreData,
                [`${basePath}/sonuc`]:             newToplam,
                [`${basePath}/durum`]:             bothDone ? 'tamamlandi' : 'kismitamamlandi',
                [`${basePath}/ad`]:                selectedAthlete.ad || selectedAthlete.name || '',
                [`${basePath}/soyad`]:             selectedAthlete.soyad || '',
                [`${basePath}/okul`]:              selectedAthlete.okul || '',
                [`${basePath}/timestamp`]:         Date.now(),
                [`${basePath}/hakem`]:             aletScoreData.hakem,
            };

            await offlineWrite(updates);

            await logAction('score_submitted', {
                competitionId: selectedCompId,
                category:      selectedCategory,
                athleteId:     selectedAthlete.id,
                alet:          selectedAlet,
                finalScore:    confirmModal.finalScore,
                discipline:    'ritmik',
            });

            const next = getNextAthlete();
            setSuccessModal({ athlete: selectedAthlete, finalScore: confirmModal.finalScore, aletLabel: confirmModal.aletLabel, next });
            setConfirmModal(null);
            setScoringFieldsTouched(false);
        } catch (err) {
            toast('Kayıt sırasında hata: ' + err.message, 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleUnlock = async () => {
        if (!unlockModal) return;
        setUnlockingInProgress(true);
        setUnlockError('');
        try {
            const inputPwd = unlockPassword.trim();
            const inputHash = await hashPassword(inputPwd);

            const compKomiteSnap  = await get(ref(db, `${firebasePath}/${selectedCompId}/komiteSifresi`));
            const globalKomiteSnap = await get(ref(db, 'ayarlar/komiteSifresi'));
            const komiteSifre = compKomiteSnap.val() || globalKomiteSnap.val();
            const isKomiteMatch = komiteSifre && inputPwd === komiteSifre;

            let isUserMatch = false;
            const usersSnap = await get(ref(db, 'kullanicilar'));
            const usersData = usersSnap.val() || {};
            for (const [, userData] of Object.entries(usersData)) {
                if (userData.sifreHash && inputHash === userData.sifreHash) { isUserMatch = true; break; }
                if (userData.sifre && inputPwd === userData.sifre) { isUserMatch = true; break; }
            }

            if (isKomiteMatch || isUserMatch) {
                const basePath = `${firebasePath}/${selectedCompId}/puanlar/${selectedCategory}/${unlockModal.athleteId}`;
                await offlineWrite({
                    [`${basePath}/${unlockModal.aletKey}/kilitli`]: false,
                });
                setUnlockModal(null);
                setUnlockPassword('');
                toast(`${RITMIK_ALETLER[unlockModal.aletKey]?.label || unlockModal.aletKey} puan kilidi kaldırıldı.`, 'success');
                logAction('score_unlock', `[Ritmik] ${unlockModal.athleteId} ${unlockModal.aletKey} — puan kilidi kaldırıldı`, {
                    user: currentUser?.kullaniciAdi || 'admin',
                    competitionId: selectedCompId,
                });
            } else {
                setUnlockError('Şifre hatalı. Süper Admin veya Komite şifresi gereklidir.');
            }
        } catch (e) {
            setUnlockError('Bir hata oluştu: ' + e.message);
        } finally {
            setUnlockingInProgress(false);
        }
    };

    // ─── Score Status ───
    const getAthleteStatus = (athlete) => {
        const score = existingScores[athlete.id];
        if (!score) return 'bekliyor';
        const topDone     = score.top?.durum     === 'tamamlandi';
        const kurdeleDone = score.kurdele?.durum === 'tamamlandi';
        const topLocked   = score.top?.kilitli     === true;
        const kurdeleLocked = score.kurdele?.kilitli === true;
        if (topLocked && kurdeleLocked) return 'kilitli';
        if (topDone && kurdeleDone) return 'tamamlandi';
        if (topDone || kurdeleDone) return 'kismi';
        return 'bekliyor';
    };

    const getAletStatus = (athlete, aletKey) => {
        const sc = existingScores[athlete?.id]?.[aletKey];
        if (!sc || sc.durum !== 'tamamlandi') return 'bekliyor';
        if (sc.kilitli) return 'kilitli';
        return 'tamamlandi';
    };

    // ─── Render ───
    return (
        <div className={`rtm-page${sidebarOpen ? '' : ' rtm-page--collapsed'}`}>

            {/* ── Sidebar Toggle ── */}
            <button
                className="rtm-sidebar-toggle"
                onClick={() => setSidebarOpen(p => !p)}
                title={sidebarOpen ? 'Kenar çubuğunu kapat' : 'Kenar çubuğunu aç'}
            >
                <i className="material-icons-round">{sidebarOpen ? 'chevron_left' : 'menu'}</i>
            </button>

            {/* ── Left Sidebar ── */}
            <aside className={`rtm-sidebar${sidebarOpen ? '' : ' rtm-sidebar--collapsed'}`}>
                <div className="rtm-sidebar-inner">

                    {/* Header */}
                    <div className="rtm-sidebar-header">
                        <button className="rtm-back-btn" onClick={() => navigate('/ritmik')}>
                            <i className="material-icons-round">arrow_back</i>
                        </button>
                        <div>
                            <div className="rtm-sidebar-title">Ritmik Puanlama</div>
                            <div className="rtm-sidebar-sub">TCF Okul Sporları</div>
                        </div>
                    </div>

                    {/* Seçimler */}
                    <div className="rtm-filters">
                        <div className="rtm-filter-group">
                            <label>İl</label>
                            <select value={selectedCity} onChange={e => { setSelectedCity(e.target.value); setSelectedCompId(''); setSelectedCategory(''); }}>
                                <option value="">Tüm İller</option>
                                {availableCities.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div className="rtm-filter-group">
                            <label>Yarışma</label>
                            <select value={selectedCompId} onChange={e => { setSelectedCompId(e.target.value); setSelectedCategory(''); setSelectedAthlete(null); }}>
                                <option value="">Yarışma Seçin</option>
                                {compOptions.map(([id, comp]) => (
                                    <option key={id} value={id}>{comp.isim || comp.name || id}</option>
                                ))}
                            </select>
                        </div>
                        <div className="rtm-filter-group">
                            <label>Kategori</label>
                            <select value={selectedCategory} onChange={e => { setSelectedCategory(e.target.value); setSelectedAthlete(null); resetPanel(); }}>
                                <option value="">Kategori Seçin</option>
                                {categoryOptions.map(c => (
                                    <option key={c} value={c}>
                                        {RITMIK_CATEGORIES[c]?.label || c}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Sporcu Listesi */}
                    {selectedCategory && (
                        <div className="rtm-athlete-list">
                            <div className="rtm-athlete-list-title">
                                <i className="material-icons-round">format_list_numbered</i>
                                Sporcular
                            </div>
                            {athletesByRotation.flat().length === 0 ? (
                                <div className="rtm-empty">Bu kategoride sporcu yok.</div>
                            ) : (
                                athletesByRotation.map((rot, ri) => (
                                    <div key={ri} className="rtm-rotation-group">
                                        {athletesByRotation.length > 1 && (
                                            <div className="rtm-rotation-label">Rotasyon {ri + 1}</div>
                                        )}
                                        {rot.map((ath, ai) => {
                                            const status   = getAthleteStatus(ath);
                                            const isActive = selectedAthlete?.id === ath.id;
                                            const topSt    = getAletStatus(ath, 'top');
                                            const kurdSt   = getAletStatus(ath, 'kurdele');
                                            return (
                                                <button
                                                    key={ath.id}
                                                    className={`rtm-athlete-item${isActive ? ' rtm-athlete-item--active' : ''} rtm-athlete-item--${status}`}
                                                    onClick={() => handleSelectAthlete(ath)}
                                                >
                                                    <span className="rtm-ath-num">{ai + 1}</span>
                                                    <span className="rtm-ath-name">
                                                        {ath.soyad ? `${ath.soyad} ${ath.ad || ''}` : ath.name || ath.ad || 'İsimsiz'}
                                                    </span>
                                                    <span className="rtm-ath-alet-dots">
                                                        <span className={`rtm-alet-dot rtm-alet-dot--${topSt}`} title="Top">T</span>
                                                        <span className={`rtm-alet-dot rtm-alet-dot--${kurdSt}`} title="Kurdele">K</span>
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            </aside>

            {/* ── Main Content ── */}
            <main className="rtm-main">
                {!selectedAthlete ? (
                    <div className="rtm-empty-state">
                        <i className="material-icons-round">self_improvement</i>
                        <p>Puanlamak için sol listeden bir sporcu seçin.</p>
                        {!selectedCategory && <p className="rtm-empty-sub">Önce yarışma ve kategori seçmelisiniz.</p>}
                    </div>
                ) : (
                    <div className="rtm-scoring-wrap">

                        {/* ── Sporcu Başlık ── */}
                        <div className="rtm-athlete-header">
                            <div className="rtm-athlete-info">
                                <div className="rtm-athlete-name">
                                    {selectedAthlete.soyad
                                        ? `${selectedAthlete.soyad} ${selectedAthlete.ad || ''}`
                                        : selectedAthlete.name || selectedAthlete.ad || 'İsimsiz Sporcu'}
                                </div>
                                <div className="rtm-athlete-meta">
                                    {selectedAthlete.okul && <span><i className="material-icons-round">school</i>{selectedAthlete.okul}</span>}
                                    {selectedAthlete.il   && <span><i className="material-icons-round">location_on</i>{selectedAthlete.il}</span>}
                                    <span><i className="material-icons-round">category</i>{RITMIK_CATEGORIES[selectedCategory]?.label || selectedCategory}</span>
                                </div>
                            </div>
                            <div className="rtm-athlete-actions">
                                {!isAthleteCalled ? (
                                    <button className="rtm-btn rtm-btn--call" onClick={handleCallAthlete}>
                                        <i className="material-icons-round">campaign</i> Sporcu Çağır
                                    </button>
                                ) : (
                                    <span className="rtm-called-badge"><i className="material-icons-round">campaign</i> Çağrıldı</span>
                                )}
                                {scoreLocked ? (
                                    <button className="rtm-btn rtm-btn--unlock" onClick={() => setUnlockModal({ athleteId: selectedAthlete.id, aletKey: selectedAlet })}>
                                        <i className="material-icons-round">lock</i> Kilitli
                                    </button>
                                ) : existingScores[selectedAthlete.id]?.[selectedAlet] ? (
                                    <button className="rtm-btn rtm-btn--lock" onClick={async () => {
                                        await offlineWrite({
                                            [`${firebasePath}/${selectedCompId}/puanlar/${selectedCategory}/${selectedAthlete.id}/${selectedAlet}/kilitli`]: true
                                        });
                                        toast(`${RITMIK_ALETLER[selectedAlet]?.label} puanı kilitlendi.`, 'success');
                                    }}>
                                        <i className="material-icons-round">lock_open</i> Kilitle
                                    </button>
                                ) : null}
                            </div>
                        </div>

                        {/* ── Alet Sekmeleri ── */}
                        <div className="rtm-alet-tabs">
                            {Object.values(RITMIK_ALETLER).map(alet => {
                                const st = getAletStatus(selectedAthlete, alet.key);
                                const isActive = selectedAlet === alet.key;
                                return (
                                    <button
                                        key={alet.key}
                                        className={`rtm-alet-tab${isActive ? ' rtm-alet-tab--active' : ''} rtm-alet-tab--${st}`}
                                        onClick={() => handleSelectAlet(alet.key)}
                                    >
                                        <i className="material-icons-round">{alet.icon}</i>
                                        {alet.label}
                                        {st === 'tamamlandi' && <i className="material-icons-round rtm-alet-tab-check">check_circle</i>}
                                        {st === 'kilitli'    && <i className="material-icons-round rtm-alet-tab-check">lock</i>}
                                    </button>
                                );
                            })}
                        </div>

                        {scoreLocked && (
                            <div className="rtm-locked-banner">
                                <i className="material-icons-round">lock</i>
                                {RITMIK_ALETLER[selectedAlet]?.label} puanı kilitlenmiştir. Düzenlemek için kilidi açın.
                            </div>
                        )}

                        {/* ── DA Puanı — Alet Zorluğu ── */}
                        <div className="rtm-card">
                            <div className="rtm-card-header">
                                <span className="rtm-card-label rtm-card-label--d">DA</span>
                                <span className="rtm-card-title">Alet Zorluğu</span>
                                <span className="rtm-card-desc">2 hakem · mutabık kalınan puanı girin ({RITMIK_ALETLER[selectedAlet]?.label})</span>
                                <span className="rtm-score-chip rtm-score-chip--d">{daScoreNum.toFixed(3)}</span>
                            </div>
                            <div className="rtm-da-input-row">
                                <input
                                    type="number"
                                    className="rtm-da-input"
                                    min="0"
                                    step="0.1"
                                    placeholder="0.0"
                                    value={daScoreInput}
                                    disabled={scoreLocked}
                                    onChange={e => { setDaScoreInput(e.target.value); setScoringFieldsTouched(true); }}
                                />
                                <span className="rtm-da-hint">DA hakemleri değerlendirmelerini karşılaştırarak mutabık kaldıkları alet zorluk puanını giriniz</span>
                            </div>
                        </div>

                        {/* ── DB Puanı — Vücut Zorluğu (manuel giriş) ── */}
                        <div className="rtm-card">
                            <div className="rtm-card-header">
                                <span className="rtm-card-label rtm-card-label--d">DB</span>
                                <span className="rtm-card-title">Vücut Zorluğu</span>
                                <span className="rtm-card-desc">2 hakem · mutabık kalınan vücut zorluk puanını girin</span>
                                <span className="rtm-score-chip rtm-score-chip--d">{dbScore.toFixed(3)}</span>
                            </div>
                            <div className="rtm-da-input-row">
                                <input
                                    type="number"
                                    className="rtm-da-input"
                                    min="0"
                                    step="0.1"
                                    placeholder="0.0"
                                    value={dbScoreInput}
                                    disabled={scoreLocked}
                                    onChange={e => { setDbScoreInput(e.target.value); setScoringFieldsTouched(true); }}
                                />
                                <span className="rtm-da-hint">DB hakemleri değerlendirmelerini karşılaştırarak mutabık kaldıkları vücut zorluk puanını giriniz</span>
                            </div>
                        </div>

                        {/* ── A Puanı — Artistlik Hakemi ── */}
                        <div className="rtm-card">
                            <div className="rtm-card-header">
                                <span className="rtm-card-label rtm-card-label--a">A</span>
                                <span className="rtm-card-title">Artistlik Puanı</span>
                                <span className="rtm-card-desc">{judgeCount} hakem · kesinti girişi (en yük/düşük atılır)</span>
                                <span className="rtm-score-chip rtm-score-chip--a">{aScore.toFixed(3)}</span>
                            </div>
                            <div className="rtm-judges-row">
                                {Array.from({ length: judgeCount }, (_, i) => {
                                    const key = `j${i + 1}`;
                                    const val = aPanelLocal[key] ?? '';
                                    const num = parseFloat(val);
                                    return (
                                        <div key={key} className="rtm-judge-cell">
                                            <label>A{i + 1}</label>
                                            <input
                                                type="number"
                                                min="0" max="10" step="0.1"
                                                placeholder="0.0"
                                                value={val}
                                                disabled={scoreLocked}
                                                onChange={e => { setAPanelLocal(p => ({ ...p, [key]: e.target.value })); setScoringFieldsTouched(true); }}
                                            />
                                            {!isNaN(num) && val !== '' && (
                                                <span className="rtm-judge-result">{Math.max(0, 10 - num).toFixed(1)}</span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* ── E Puanı — İcra Hakemi ── */}
                        <div className="rtm-card">
                            <div className="rtm-card-header">
                                <span className="rtm-card-label rtm-card-label--e">E</span>
                                <span className="rtm-card-title">İcra Puanı</span>
                                <span className="rtm-card-desc">{judgeCount} hakem · kesinti girişi (en yük/düşük atılır)</span>
                                <span className="rtm-score-chip rtm-score-chip--e">{eScore.toFixed(3)}</span>
                            </div>
                            <div className="rtm-judges-row">
                                {Array.from({ length: judgeCount }, (_, i) => {
                                    const key = `j${i + 1}`;
                                    const val = ePanelLocal[key] ?? '';
                                    const num = parseFloat(val);
                                    return (
                                        <div key={key} className="rtm-judge-cell">
                                            <label>E{i + 1}</label>
                                            <input
                                                type="number"
                                                min="0" max="10" step="0.1"
                                                placeholder="0.0"
                                                value={val}
                                                disabled={scoreLocked}
                                                onChange={e => { setEPanelLocal(p => ({ ...p, [key]: e.target.value })); setScoringFieldsTouched(true); }}
                                            />
                                            {!isNaN(num) && val !== '' && (
                                                <span className="rtm-judge-result">{Math.max(0, 10 - num).toFixed(1)}</span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* ── Ceza Kesintileri (manuel giriş) ── */}
                        <div className="rtm-card">
                            <div className="rtm-card-header">
                                <span className="rtm-card-label rtm-card-label--ded">−</span>
                                <span className="rtm-card-title">Ceza Kesintisi</span>
                                <span className="rtm-card-desc">Toplam ceza (alet düşmesi, alan dışı, süre vb.)</span>
                                <span className="rtm-score-chip rtm-score-chip--ded">−{totalPenalties.toFixed(3)}</span>
                            </div>
                            <div className="rtm-da-input-row">
                                <input
                                    type="number"
                                    className="rtm-da-input"
                                    min="0"
                                    step="0.1"
                                    placeholder="0.0"
                                    value={penaltyInput}
                                    disabled={scoreLocked}
                                    onChange={e => { setPenaltyInput(e.target.value); setScoringFieldsTouched(true); }}
                                />
                                <span className="rtm-da-hint">Koordinatör/Baş Hakem tarafından belirlenen toplam ceza kesintisini giriniz</span>
                            </div>
                        </div>

                        {/* ── Final Skor Bar ── */}
                        <div className="rtm-final-bar">
                            <div className="rtm-final-breakdown">
                                <span>DA <strong>{daScoreNum.toFixed(3)}</strong></span>
                                <span>+</span>
                                <span>DB <strong>{dbScore.toFixed(3)}</strong></span>
                                <span>+</span>
                                <span>A <strong>{aScore.toFixed(3)}</strong></span>
                                <span>+</span>
                                <span>E <strong>{eScore.toFixed(3)}</strong></span>
                                <span>−</span>
                                <span>Ceza <strong>{totalPenalties.toFixed(3)}</strong></span>
                                <span className="rtm-final-alet-badge">{RITMIK_ALETLER[selectedAlet]?.label}</span>
                            </div>
                            <div className="rtm-final-score">{finalScore}</div>
                            {/* Toplam (her iki alet) */}
                            {(() => {
                                const otherAlet = selectedAlet === 'top' ? 'kurdele' : 'top';
                                const otherSonuc = existingScores[selectedAthlete.id]?.[otherAlet]?.sonuc;
                                if (otherSonuc != null) {
                                    const toplam = parseFloat(finalScore) + parseFloat(otherSonuc);
                                    return (
                                        <div className="rtm-toplam-bar">
                                            <span>Toplam (Top + Kurdele):</span>
                                            <strong>{toplam.toFixed(3)}</strong>
                                        </div>
                                    );
                                }
                                return null;
                            })()}
                            <button
                                className="rtm-btn rtm-btn--submit"
                                disabled={scoreLocked || isSubmitting}
                                onClick={handleSubmitScore}
                            >
                                <i className="material-icons-round">save</i>
                                {isSubmitting ? 'Kaydediliyor…' : `${RITMIK_ALETLER[selectedAlet]?.label} Kaydet`}
                            </button>
                        </div>

                    </div>
                )}
            </main>

            {/* ── Confirm Modal ── */}
            {confirmModal && (
                <div className="rtm-modal-overlay" onClick={() => setConfirmModal(null)}>
                    <div className="rtm-modal" onClick={e => e.stopPropagation()}>
                        <div className="rtm-modal-title">Puanı Onayla — {confirmModal.aletLabel}</div>
                        <div className="rtm-modal-athlete">
                            {confirmModal.athlete.soyad
                                ? `${confirmModal.athlete.soyad} ${confirmModal.athlete.ad || ''}`
                                : confirmModal.athlete.name || ''}
                        </div>
                        <div className="rtm-modal-breakdown">
                            <div><span>DA (Alet Zorluğu)</span><strong>{confirmModal.daScore.toFixed(3)}</strong></div>
                            <div><span>DB (Vücut Zorluğu)</span><strong>{confirmModal.dbScore.toFixed(3)}</strong></div>
                            <div><span>A (Artistlik)</span><strong>{confirmModal.aScore.toFixed(3)}</strong></div>
                            <div><span>E (İcra)</span><strong>{confirmModal.eScore.toFixed(3)}</strong></div>
                            <div><span>Ceza</span><strong>−{confirmModal.totalPenalties.toFixed(3)}</strong></div>
                        </div>
                        <div className="rtm-modal-final">{confirmModal.finalScore}</div>
                        <div className="rtm-modal-actions">
                            <button className="rtm-btn rtm-btn--cancel" onClick={() => setConfirmModal(null)}>İptal</button>
                            <button className="rtm-btn rtm-btn--confirm" onClick={handleConfirmSubmit} disabled={isSubmitting}>
                                {isSubmitting ? 'Kaydediliyor…' : 'Onayla & Kaydet'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Success Modal ── */}
            {successModal && (
                <div className="rtm-modal-overlay" onClick={() => setSuccessModal(null)}>
                    <div className="rtm-modal rtm-modal--success" onClick={e => e.stopPropagation()}>
                        <i className="material-icons-round rtm-modal-icon">check_circle</i>
                        <div className="rtm-modal-title">{successModal.aletLabel} Puanı Kaydedildi</div>
                        <div className="rtm-modal-athlete">
                            {successModal.athlete.soyad
                                ? `${successModal.athlete.soyad} ${successModal.athlete.ad || ''}`
                                : successModal.athlete.name || ''}
                        </div>
                        <div className="rtm-modal-final">{successModal.finalScore}</div>
                        <div className="rtm-modal-actions">
                            {successModal.next && (
                                <button
                                    className="rtm-btn rtm-btn--next"
                                    onClick={() => { handleSelectAthlete(successModal.next); setSuccessModal(null); }}
                                >
                                    <i className="material-icons-round">skip_next</i>
                                    Sonraki: {successModal.next.soyad || successModal.next.name || ''}
                                </button>
                            )}
                            <button className="rtm-btn rtm-btn--cancel" onClick={() => setSuccessModal(null)}>Kapat</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Unlock Modal ── */}
            {unlockModal && (
                <div className="rtm-modal-overlay" onClick={() => setUnlockModal(null)}>
                    <div className="rtm-modal" onClick={e => e.stopPropagation()}>
                        <div className="rtm-modal-title">Kilidi Aç — {RITMIK_ALETLER[unlockModal.aletKey]?.label}</div>
                        <p style={{ color: 'var(--rtm-text-sec)', marginBottom: '1rem', textAlign: 'center' }}>
                            Komite şifresini girin.
                        </p>
                        <input
                            type="password"
                            className="rtm-unlock-input"
                            placeholder="Şifre"
                            value={unlockPassword}
                            onChange={e => setUnlockPassword(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                            autoFocus
                        />
                        {unlockError && <div className="rtm-unlock-error">{unlockError}</div>}
                        <div className="rtm-modal-actions">
                            <button className="rtm-btn rtm-btn--cancel" onClick={() => { setUnlockModal(null); setUnlockPassword(''); setUnlockError(''); }}>İptal</button>
                            <button className="rtm-btn rtm-btn--confirm" onClick={handleUnlock} disabled={unlockingInProgress}>
                                {unlockingInProgress ? 'Kontrol…' : 'Kilidi Aç'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
