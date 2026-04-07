import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import {
    TRAMPOLIN_CATEGORIES,
    DIFFICULTY_PRESETS,
    HD_OPTIONS,
    TRAMPOLIN_PENALTY_TYPES,
} from '../data/trampolinCriteriaDefaults';
import { useAuth } from '../lib/AuthContext';
import { useDiscipline } from '../lib/DisciplineContext';
import { useOffline } from '../lib/OfflineContext';
import { useNotification } from '../lib/NotificationContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { logAction } from '../lib/auditLogger';
import './TrampolinScoringPage.css';

export default function TrampolinScoringPage() {
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

    // ─── Scoring ───
    const [ePanelLocal, setEPanelLocal]   = useState({});    // E: icra kesintileri (4 hakem)
    const [skillValues, setSkillValues]   = useState([]);    // D: her hareketin zorluk değeri
    const [tScore, setTScore]             = useState('');    // T: uçuş süresi (saniye)
    const [hdScore, setHdScore]           = useState(0);     // HD: yatay kesinti
    const [penalties, setPenalties]       = useState({});    // Cezalar
    // Senkron ek puan
    const [sPanel, setSPanel]             = useState({});    // S: senkron kesintileri (2 hakem)

    // ─── Lock ───
    const [scoreLocked, setScoreLocked]           = useState(false);
    const [unlockModal, setUnlockModal]           = useState(null);
    const [unlockPassword, setUnlockPassword]     = useState('');
    const [unlockError, setUnlockError]           = useState('');
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

    // ─── Sync lock state ───
    useEffect(() => {
        if (!selectedAthlete) return;
        setScoreLocked(existingScores[selectedAthlete.id]?.kilitli === true);
    }, [existingScores, selectedAthlete?.id]);

    // Puan verisi geç geldiğinde formu doldur (kullanıcı henüz dokunmadıysa)
    useEffect(() => {
        if (!selectedAthlete || scoringFieldsTouched) return;
        const scores = existingScores[selectedAthlete.id];
        if (!scores) return;
        const sc = TRAMPOLIN_CATEGORIES[selectedCategory]?.skillCount || 10;
        setEPanelLocal(scores.ePanel || {});
        setSkillValues(scores.skillValues || Array(sc).fill(''));
        setTScore(scores.tScore ?? '');
        setHdScore(scores.hdScore ?? 0);
        setPenalties(scores.penalties || {});
        setSPanel(scores.sPanel || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [existingScores, selectedAthlete?.id]);

    // ─── Derived ───
    const catConfig   = TRAMPOLIN_CATEGORIES[selectedCategory] || {};
    const skillCount  = catConfig.skillCount  || 10;
    const judgeCount  = catConfig.judgeCount  || 4;
    const hasToF      = catConfig.hasToF      !== false;
    const isSenkron   = false; // Okul sporlarında senkron yok (2025-2026 talimatnamesi)

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

    // E: 4 hakem, en yüksek/düşük kesinti atılır, kalan 2 ortalanır → E = 10 − avg
    const calcEScore = () => {
        const vals = [];
        for (let i = 1; i <= judgeCount; i++) {
            const v = parseFloat(ePanelLocal[`j${i}`]);
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

    // D: hareket zorluk değerlerinin toplamı
    const calcDScore = () =>
        skillValues.slice(0, skillCount).reduce((sum, v) => sum + (parseFloat(v) || 0), 0);

    // S: senkron kesintileri (2 hakem ortalaması) → S = 10 − avg
    const calcSScore = () => {
        if (!isSenkron) return 0;
        const vals = [parseFloat(sPanel.j1), parseFloat(sPanel.j2)].filter(v => !isNaN(v));
        if (vals.length === 0) return 0;
        return Math.max(0, 10 - vals.reduce((s, v) => s + v, 0) / vals.length);
    };

    const dScore = calcDScore();
    const eScore = calcEScore();
    const tVal   = parseFloat(tScore) || 0;
    const sScore = calcSScore();
    const totalPenalties = Object.values(penalties).reduce((sum, v) => sum + (parseFloat(v) || 0), 0);

    // Uçuş süresi gerektiren kategorilerde T girilmemişse 0 olarak bırak
    const effectiveT = hasToF ? tVal : 0;

    // D=0 → final=0 kuralı
    const finalScore = dScore === 0
        ? '0.000'
        : Math.max(0, dScore + eScore + effectiveT + sScore - (parseFloat(hdScore) || 0) - totalPenalties).toFixed(3);

    // ─── Handlers ───
    const resetPanel = useCallback(() => {
        setEPanelLocal({});
        setSkillValues(Array(skillCount).fill(''));
        setTScore('');
        setHdScore(0);
        setPenalties({});
        setSPanel({});
        setScoringFieldsTouched(false);
    }, [skillCount]);

    const handleSelectAthlete = (athlete) => {
        if (selectedAthlete?.id === athlete.id) return;
        const prev = existingScores[athlete.id];
        setSelectedAthlete(athlete);
        setIsAthleteCalled(false);
        setScoreLocked(prev?.kilitli === true);
        setScoringFieldsTouched(false);
        if (prev) {
            setEPanelLocal(prev.ePanel || {});
            setSkillValues(prev.skillValues || Array(skillCount).fill(''));
            setTScore(prev.tScore ?? '');
            setHdScore(prev.hdScore ?? 0);
            setPenalties(prev.penalties || {});
            setSPanel(prev.sPanel || {});
        } else {
            resetPanel();
        }
    };

    const handleCallAthlete = async () => {
        setIsAthleteCalled(true);
        try {
            await update(ref(db), {
                [`${firebasePath}/${selectedCompId}/aktifSporcu/${selectedCategory}`]: selectedAthlete.id
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

    const handleSubmitScore = () => {
        if (!selectedAthlete) return toast('Lütfen bir sporcu seçin.', 'warning');
        if (scoreLocked)       return toast('Bu sporcunun puanı kilitli. Kilidi açmak için kilit ikonuna tıklayın.', 'warning');

        const filledE = Object.values(ePanelLocal).filter(v => v !== '' && !isNaN(parseFloat(v)));
        if (filledE.length === 0) return toast('E puanı girilmeden kayıt yapılamaz.', 'warning');

        if (dScore === 0) return toast('D puanı 0 — zorluk değerleri girilmemiş. Sporcu puanı 0 olarak kaydedilecek.', 'warning');

        if (hasToF && tVal === 0) return toast('Uçuş süresi (T) girilmeden kayıt yapılamaz.', 'warning');

        const fVal = parseFloat(finalScore);
        if (isNaN(fVal)) return toast('Final puanı hesaplanamadı.', 'error');

        setConfirmModal({
            athlete: selectedAthlete,
            dScore, eScore, tVal: effectiveT, hdScore: parseFloat(hdScore) || 0,
            sScore, totalPenalties, finalScore, fVal,
        });
    };

    const handleConfirmSubmit = async () => {
        if (!confirmModal) return;
        setIsSubmitting(true);
        try {
            const scoreData = {
                ePanel:      ePanelLocal,
                skillValues: skillValues,
                tScore:      effectiveT,
                hdScore:     parseFloat(hdScore) || 0,
                penalties:   penalties,
                sPanel:      sPanel,
                dScore:      parseFloat(dScore.toFixed(3)),
                eScore:      parseFloat(eScore.toFixed(3)),
                sScore:      parseFloat(sScore.toFixed(3)),
                // sonuc: sayısal final puan (FinalsPage/ScoreboardPage/AnalyticsPage ile uyumlu)
                sonuc:       parseFloat(confirmModal.finalScore),
                durum:       'tamamlandi',
                kilitli:     true,  // kayıt sonrası otomatik kilitle
                ad:          selectedAthlete.ad || selectedAthlete.name || '',
                soyad:       selectedAthlete.soyad || '',
                okul:        selectedAthlete.okul || '',
                timestamp:   Date.now(),
                hakem:       currentUser?.adSoyad || currentUser?.kullaniciAdi || '',
            };

            await offlineWrite({
                [`${firebasePath}/${selectedCompId}/puanlar/${selectedCategory}/${selectedAthlete.id}`]: scoreData
            });

            await logAction('score_submitted', {
                competitionId: selectedCompId,
                category: selectedCategory,
                athleteId: selectedAthlete.id,
                finalScore: confirmModal.finalScore,
                discipline: 'trampolin',
            });

            const next = getNextAthlete();
            setSuccessModal({ athlete: selectedAthlete, finalScore: confirmModal.finalScore, next });
            setConfirmModal(null);
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

            // Komite şifresi: yarışmaya özel veya global ayardan
            const compKomiteSnap = await get(ref(db, `${firebasePath}/${selectedCompId}/komiteSifresi`));
            const globalKomiteSnap = await get(ref(db, 'ayarlar/komiteSifresi'));
            const komiteSifre = compKomiteSnap.val() || globalKomiteSnap.val();
            const isKomiteMatch = komiteSifre && inputPwd === komiteSifre;

            // Kullanıcı şifresi (hash veya düz metin)
            let isUserMatch = false;
            const usersSnap = await get(ref(db, 'kullanicilar'));
            const usersData = usersSnap.val() || {};
            for (const [, userData] of Object.entries(usersData)) {
                if (userData.sifreHash && inputHash === userData.sifreHash) { isUserMatch = true; break; }
                if (userData.sifre && inputPwd === userData.sifre) { isUserMatch = true; break; }
            }

            if (isKomiteMatch || isUserMatch) {
                await offlineWrite({
                    [`${firebasePath}/${selectedCompId}/puanlar/${selectedCategory}/${unlockModal.athleteId}/kilitli`]: false
                });
                setScoreLocked(false);
                setUnlockModal(null);
                setUnlockPassword('');
                toast('Puan kilidi kaldırıldı. Düzenleme yapabilirsiniz.', 'success');
                logAction('score_unlock', `[Trampolin] ${unlockModal.athleteId} — puan kilidi kaldırıldı`, {
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

    const handleLock = async () => {
        if (!selectedAthlete) return;
        await offlineWrite({
            [`${firebasePath}/${selectedCompId}/puanlar/${selectedCategory}/${selectedAthlete.id}/kilitli`]: true
        });
        setScoreLocked(true);
        toast('Puan kilitlendi.', 'success');
    };

    // ─── Skill Value Handler ───
    const handleSkillChange = (idx, val) => {
        setSkillValues(prev => {
            const next = [...prev];
            next[idx] = val;
            return next;
        });
    };

    // Ensure skillValues array has right length when category changes
    useEffect(() => {
        setSkillValues(Array(skillCount).fill(''));
    }, [skillCount, selectedCategory]);

    // ─── Score Status ───
    const getAthleteStatus = (athlete) => {
        const score = existingScores[athlete.id];
        if (!score) return 'bekliyor';
        if (score.kilitli) return 'kilitli';
        return 'tamamlandi';
    };

    return (
        <div className={`tra-page${sidebarOpen ? '' : ' tra-page--collapsed'}`}>

            {/* ── Sidebar Toggle ── */}
            <button
                className="tra-sidebar-toggle"
                onClick={() => setSidebarOpen(p => !p)}
                title={sidebarOpen ? 'Kenar çubuğunu kapat' : 'Kenar çubuğunu aç'}
            >
                <i className="material-icons-round">{sidebarOpen ? 'chevron_left' : 'menu'}</i>
            </button>

            {/* ── Left Sidebar ── */}
            <aside className={`tra-sidebar${sidebarOpen ? '' : ' tra-sidebar--collapsed'}`}>
                <div className="tra-sidebar-inner">

                    {/* Header */}
                    <div className="tra-sidebar-header">
                        <button className="tra-back-btn" onClick={() => navigate('/trampolin')}>
                            <i className="material-icons-round">arrow_back</i>
                        </button>
                        <div>
                            <div className="tra-sidebar-title">Trampolin Puanlama</div>
                            <div className="tra-sidebar-sub">TCF Okul Sporları</div>
                        </div>
                    </div>

                    {/* Seçimler */}
                    <div className="tra-filters">
                        <div className="tra-filter-group">
                            <label>İl</label>
                            <select value={selectedCity} onChange={e => { setSelectedCity(e.target.value); setSelectedCompId(''); setSelectedCategory(''); }}>
                                <option value="">Tüm İller</option>
                                {availableCities.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div className="tra-filter-group">
                            <label>Yarışma</label>
                            <select value={selectedCompId} onChange={e => { setSelectedCompId(e.target.value); setSelectedCategory(''); setSelectedAthlete(null); }}>
                                <option value="">Yarışma Seçin</option>
                                {compOptions.map(([id, comp]) => (
                                    <option key={id} value={id}>{comp.isim || comp.name || id}</option>
                                ))}
                            </select>
                        </div>
                        <div className="tra-filter-group">
                            <label>Kategori</label>
                            <select value={selectedCategory} onChange={e => { setSelectedCategory(e.target.value); setSelectedAthlete(null); resetPanel(); }}>
                                <option value="">Kategori Seçin</option>
                                {categoryOptions.map(c => (
                                    <option key={c} value={c}>
                                        {TRAMPOLIN_CATEGORIES[c]?.label || c}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Sporcu Listesi */}
                    {selectedCategory && (
                        <div className="tra-athlete-list">
                            <div className="tra-athlete-list-title">
                                <i className="material-icons-round">format_list_numbered</i>
                                Sporcular
                            </div>
                            {athletesByRotation.flat().length === 0 ? (
                                <div className="tra-empty">Bu kategoride sporcu yok.</div>
                            ) : (
                                athletesByRotation.map((rot, ri) => (
                                    <div key={ri} className="tra-rotation-group">
                                        {athletesByRotation.length > 1 && (
                                            <div className="tra-rotation-label">Rotasyon {ri + 1}</div>
                                        )}
                                        {rot.map((ath, ai) => {
                                            const status  = getAthleteStatus(ath);
                                            const isActive = selectedAthlete?.id === ath.id;
                                            return (
                                                <button
                                                    key={ath.id}
                                                    className={`tra-athlete-item${isActive ? ' tra-athlete-item--active' : ''} tra-athlete-item--${status}`}
                                                    onClick={() => handleSelectAthlete(ath)}
                                                >
                                                    <span className="tra-ath-num">{ai + 1}</span>
                                                    <span className="tra-ath-name">
                                                        {ath.soyad ? `${ath.soyad} ${ath.ad || ''}` : ath.name || ath.ad || 'İsimsiz'}
                                                    </span>
                                                    <span className={`tra-ath-badge tra-ath-badge--${status}`}>
                                                        {status === 'kilitli' ? <i className="material-icons-round">lock</i>
                                                            : status === 'tamamlandi' ? <i className="material-icons-round">check_circle</i>
                                                            : <i className="material-icons-round">radio_button_unchecked</i>}
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
            <main className="tra-main">
                {!selectedAthlete ? (
                    <div className="tra-empty-state">
                        <i className="material-icons-round">sports_gymnastics</i>
                        <p>Puanlamak için sol listeden bir sporcu seçin.</p>
                        {!selectedCategory && <p className="tra-empty-sub">Önce yarışma ve kategori seçmelisiniz.</p>}
                    </div>
                ) : (
                    <div className="tra-scoring-wrap">

                        {/* ── Sporcu Başlık ── */}
                        <div className="tra-athlete-header">
                            <div className="tra-athlete-info">
                                <div className="tra-athlete-name">
                                    {selectedAthlete.soyad
                                        ? `${selectedAthlete.soyad} ${selectedAthlete.ad || ''}`
                                        : selectedAthlete.name || selectedAthlete.ad || 'İsimsiz Sporcu'}
                                </div>
                                <div className="tra-athlete-meta">
                                    {selectedAthlete.okul && <span><i className="material-icons-round">school</i>{selectedAthlete.okul}</span>}
                                    {selectedAthlete.il && <span><i className="material-icons-round">location_on</i>{selectedAthlete.il}</span>}
                                    <span><i className="material-icons-round">category</i>{TRAMPOLIN_CATEGORIES[selectedCategory]?.label || selectedCategory}</span>
                                </div>
                            </div>
                            <div className="tra-athlete-actions">
                                {!isAthleteCalled ? (
                                    <button className="tra-btn tra-btn--call" onClick={handleCallAthlete}>
                                        <i className="material-icons-round">campaign</i> Sporcu Çağır
                                    </button>
                                ) : (
                                    <span className="tra-called-badge"><i className="material-icons-round">campaign</i> Çağrıldı</span>
                                )}
                                {scoreLocked ? (
                                    <button className="tra-btn tra-btn--unlock" onClick={() => setUnlockModal({ athleteId: selectedAthlete.id })}>
                                        <i className="material-icons-round">lock</i> Kilitli
                                    </button>
                                ) : existingScores[selectedAthlete.id] ? (
                                    <button className="tra-btn tra-btn--lock" onClick={handleLock}>
                                        <i className="material-icons-round">lock_open</i> Kilitle
                                    </button>
                                ) : null}
                            </div>
                        </div>

                        {scoreLocked && (
                            <div className="tra-locked-banner">
                                <i className="material-icons-round">lock</i>
                                Bu sporcunun puanı kilitlenmiştir. Düzenlemek için kilidi açın.
                            </div>
                        )}

                        {/* ── D Puanı — Hareket Zorlukları ── */}
                        <div className="tra-card">
                            <div className="tra-card-header">
                                <span className="tra-card-label tra-card-label--d">D</span>
                                <span className="tra-card-title">Zorluk Puanı</span>
                                <span className="tra-card-desc">{skillCount} hareket · toplam {dScore.toFixed(1)}</span>
                                <span className="tra-score-chip tra-score-chip--d">{dScore.toFixed(3)}</span>
                            </div>
                            <div className="tra-skills-grid">
                                {Array.from({ length: skillCount }, (_, i) => (
                                    <div key={i} className="tra-skill-cell">
                                        <span className="tra-skill-num">{i + 1}</span>
                                        <select
                                            className="tra-skill-select"
                                            value={skillValues[i] ?? ''}
                                            disabled={scoreLocked}
                                            onChange={e => handleSkillChange(i, e.target.value)}
                                        >
                                            <option value="">—</option>
                                            {DIFFICULTY_PRESETS.map(v => (
                                                <option key={v} value={v}>{v.toFixed(1)}</option>
                                            ))}
                                        </select>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* ── E Puanı — İcra Hakemi ── */}
                        <div className="tra-card">
                            <div className="tra-card-header">
                                <span className="tra-card-label tra-card-label--e">E</span>
                                <span className="tra-card-title">İcra Puanı</span>
                                <span className="tra-card-desc">{judgeCount} hakem · kesinti girişi (en yük/düşük atılır)</span>
                                <span className="tra-score-chip tra-score-chip--e">{eScore.toFixed(3)}</span>
                            </div>
                            <div className="tra-judges-row">
                                {Array.from({ length: judgeCount }, (_, i) => {
                                    const key = `j${i + 1}`;
                                    const val = ePanelLocal[key] ?? '';
                                    const num = parseFloat(val);
                                    return (
                                        <div key={key} className="tra-judge-cell">
                                            <label>H{i + 1}</label>
                                            <input
                                                type="number"
                                                min="0" max="10" step="0.1"
                                                placeholder="0.0"
                                                value={val}
                                                disabled={scoreLocked}
                                                onChange={e => setEPanelLocal(p => ({ ...p, [key]: e.target.value }))}
                                            />
                                            {!isNaN(num) && val !== '' && (
                                                <span className="tra-judge-result">{Math.max(0, 10 - num).toFixed(1)}</span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* ── T Puanı — Uçuş Süresi ── */}
                        {hasToF && (
                            <div className="tra-card">
                                <div className="tra-card-header">
                                    <span className="tra-card-label tra-card-label--t">T</span>
                                    <span className="tra-card-title">Uçuş Süresi (ToF)</span>
                                    <span className="tra-card-desc">Saniye cinsinden manuel giriş</span>
                                    <span className="tra-score-chip tra-score-chip--t">{tVal.toFixed(3)}</span>
                                </div>
                                <div className="tra-tof-row">
                                    <input
                                        type="number"
                                        min="0" max="30" step="0.001"
                                        placeholder="ör: 15.245"
                                        value={tScore}
                                        disabled={scoreLocked}
                                        className="tra-tof-input"
                                        onChange={e => setTScore(e.target.value)}
                                    />
                                    <span className="tra-tof-unit">saniye</span>
                                </div>
                            </div>
                        )}

                        {/* ── Senkron Puanı ── */}
                        {isSenkron && (
                            <div className="tra-card">
                                <div className="tra-card-header">
                                    <span className="tra-card-label tra-card-label--s">S</span>
                                    <span className="tra-card-title">Senkronizasyon</span>
                                    <span className="tra-card-desc">2 hakem kesinti girişi</span>
                                    <span className="tra-score-chip tra-score-chip--s">{sScore.toFixed(3)}</span>
                                </div>
                                <div className="tra-judges-row">
                                    {['j1', 'j2'].map((key, i) => (
                                        <div key={key} className="tra-judge-cell">
                                            <label>SH{i + 1}</label>
                                            <input
                                                type="number" min="0" max="10" step="0.1"
                                                placeholder="0.0"
                                                value={sPanel[key] ?? ''}
                                                disabled={scoreLocked}
                                                onChange={e => setSPanel(p => ({ ...p, [key]: e.target.value }))}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── Kesintiler ── */}
                        <div className="tra-card">
                            <div className="tra-card-header">
                                <span className="tra-card-label tra-card-label--ded">−</span>
                                <span className="tra-card-title">Kesintiler</span>
                                <span className="tra-card-desc">HD + cezalar</span>
                                <span className="tra-score-chip tra-score-chip--ded">
                                    −{((parseFloat(hdScore) || 0) + totalPenalties).toFixed(3)}
                                </span>
                            </div>

                            {/* HD */}
                            <div className="tra-ded-section">
                                <div className="tra-ded-label">
                                    <i className="material-icons-round">swap_horiz</i>
                                    Yatay Yer Değiştirme (HD)
                                </div>
                                <div className="tra-hd-options">
                                    {HD_OPTIONS.map(opt => (
                                        <button
                                            key={opt.value}
                                            className={`tra-hd-btn${parseFloat(hdScore) === opt.value ? ' tra-hd-btn--active' : ''}`}
                                            disabled={scoreLocked}
                                            onClick={() => setHdScore(opt.value)}
                                        >
                                            {opt.value.toFixed(1)}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Cezalar */}
                            <div className="tra-ded-section">
                                <div className="tra-ded-label">
                                    <i className="material-icons-round">report_problem</i>
                                    Cezalar
                                </div>
                                <div className="tra-penalties-grid">
                                    {Object.entries(TRAMPOLIN_PENALTY_TYPES).map(([key, pt]) => (
                                        <div key={key} className="tra-penalty-item">
                                            <label>{pt.label}</label>
                                            <div className="tra-penalty-options">
                                                {pt.options.map(v => (
                                                    <button
                                                        key={v}
                                                        className={`tra-pen-btn${parseFloat(penalties[key] || 0) === v ? ' tra-pen-btn--active' : ''}`}
                                                        disabled={scoreLocked}
                                                        onClick={() => setPenalties(p => ({ ...p, [key]: v }))}
                                                    >
                                                        {v.toFixed(1)}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* ── Final Skor Bar ── */}
                        <div className="tra-final-bar">
                            <div className="tra-final-breakdown">
                                <span>D <strong>{dScore.toFixed(3)}</strong></span>
                                <span>+</span>
                                <span>E <strong>{eScore.toFixed(3)}</strong></span>
                                {hasToF && <><span>+</span><span>T <strong>{tVal.toFixed(3)}</strong></span></>}
                                {isSenkron && <><span>+</span><span>S <strong>{sScore.toFixed(3)}</strong></span></>}
                                <span>−</span>
                                <span>HD <strong>{(parseFloat(hdScore) || 0).toFixed(3)}</strong></span>
                                <span>−</span>
                                <span>Ceza <strong>{totalPenalties.toFixed(3)}</strong></span>
                            </div>
                            <div className="tra-final-score">{finalScore}</div>
                            <button
                                className="tra-btn tra-btn--submit"
                                disabled={scoreLocked || isSubmitting}
                                onClick={handleSubmitScore}
                            >
                                <i className="material-icons-round">save</i>
                                {isSubmitting ? 'Kaydediliyor…' : 'Kaydet'}
                            </button>
                        </div>

                    </div>
                )}
            </main>

            {/* ── Confirm Modal ── */}
            {confirmModal && (
                <div className="tra-modal-overlay" onClick={() => setConfirmModal(null)}>
                    <div className="tra-modal" onClick={e => e.stopPropagation()}>
                        <div className="tra-modal-title">Puanı Onayla</div>
                        <div className="tra-modal-athlete">
                            {confirmModal.athlete.soyad
                                ? `${confirmModal.athlete.soyad} ${confirmModal.athlete.ad || ''}`
                                : confirmModal.athlete.name || ''}
                        </div>
                        <div className="tra-modal-breakdown">
                            <div><span>D (Zorluk)</span><strong>{confirmModal.dScore.toFixed(3)}</strong></div>
                            <div><span>E (İcra)</span><strong>{confirmModal.eScore.toFixed(3)}</strong></div>
                            {hasToF && <div><span>T (Uçuş Süresi)</span><strong>{confirmModal.tVal.toFixed(3)}</strong></div>}
                            {isSenkron && <div><span>S (Senkron)</span><strong>{confirmModal.sScore.toFixed(3)}</strong></div>}
                            <div><span>HD Kesinti</span><strong>−{confirmModal.hdScore.toFixed(3)}</strong></div>
                            <div><span>Ceza</span><strong>−{confirmModal.totalPenalties.toFixed(3)}</strong></div>
                        </div>
                        <div className="tra-modal-final">{confirmModal.finalScore}</div>
                        <div className="tra-modal-actions">
                            <button className="tra-btn tra-btn--cancel" onClick={() => setConfirmModal(null)}>İptal</button>
                            <button className="tra-btn tra-btn--confirm" onClick={handleConfirmSubmit} disabled={isSubmitting}>
                                {isSubmitting ? 'Kaydediliyor…' : 'Onayla & Kaydet'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Success Modal ── */}
            {successModal && (
                <div className="tra-modal-overlay" onClick={() => setSuccessModal(null)}>
                    <div className="tra-modal tra-modal--success" onClick={e => e.stopPropagation()}>
                        <i className="material-icons-round tra-modal-icon">check_circle</i>
                        <div className="tra-modal-title">Puan Kaydedildi</div>
                        <div className="tra-modal-athlete">
                            {successModal.athlete.soyad
                                ? `${successModal.athlete.soyad} ${successModal.athlete.ad || ''}`
                                : successModal.athlete.name || ''}
                        </div>
                        <div className="tra-modal-final">{successModal.finalScore}</div>
                        <div className="tra-modal-actions">
                            {successModal.next && (
                                <button
                                    className="tra-btn tra-btn--next"
                                    onClick={() => { handleSelectAthlete(successModal.next); setSuccessModal(null); }}
                                >
                                    <i className="material-icons-round">skip_next</i>
                                    Sonraki: {successModal.next.soyad || successModal.next.name || ''}
                                </button>
                            )}
                            <button className="tra-btn tra-btn--cancel" onClick={() => setSuccessModal(null)}>Kapat</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Unlock Modal ── */}
            {unlockModal && (
                <div className="tra-modal-overlay" onClick={() => setUnlockModal(null)}>
                    <div className="tra-modal" onClick={e => e.stopPropagation()}>
                        <div className="tra-modal-title">Kilidi Aç</div>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', textAlign: 'center' }}>
                            Komite şifresini girin.
                        </p>
                        <input
                            type="password"
                            className="tra-unlock-input"
                            placeholder="Şifre"
                            value={unlockPassword}
                            onChange={e => setUnlockPassword(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                            autoFocus
                        />
                        {unlockError && <div className="tra-unlock-error">{unlockError}</div>}
                        <div className="tra-modal-actions">
                            <button className="tra-btn tra-btn--cancel" onClick={() => { setUnlockModal(null); setUnlockPassword(''); setUnlockError(''); }}>İptal</button>
                            <button className="tra-btn tra-btn--confirm" onClick={handleUnlock} disabled={unlockingInProgress}>
                                {unlockingInProgress ? 'Kontrol…' : 'Kilidi Aç'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
