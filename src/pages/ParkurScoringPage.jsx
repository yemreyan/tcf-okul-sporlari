import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import {
    PARKUR_CATEGORIES,
    PARKUR_ELEMENT_FAMILIES,
    PARKUR_DIFFICULTY_VALUES,
    PARKUR_PENALTY_TYPES,
    FAMILY_CONSTRAINTS,
} from '../data/parkurCriteriaDefaults';
import { useAuth } from '../lib/AuthContext';
import { useDiscipline } from '../lib/DisciplineContext';
import { useOffline } from '../lib/OfflineContext';
import { useNotification } from '../lib/NotificationContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { logAction } from '../lib/auditLogger';
import './ParkurScoringPage.css';

export default function ParkurScoringPage() {
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
    const [ePanelLocal, setEPanelLocal]         = useState({});         // E: icra kesintileri (4 hakem)
    const [selectedElements, setSelectedElements] = useState([]);       // D: element listesi (family + value)
    const [penalties, setPenalties]             = useState({});         // Cezalar

    // ─── Lock ───
    const [scoreLocked, setScoreLocked]               = useState(false);
    const [unlockModal, setUnlockModal]               = useState(null);
    const [unlockPassword, setUnlockPassword]         = useState('');
    const [unlockError, setUnlockError]               = useState('');
    const [unlockingInProgress, setUnlockingInProgress] = useState(false);
    const [scoringFieldsTouched, setScoringFieldsTouched] = useState(false);

    // ─── UI ───
    const [sidebarOpen, setSidebarOpen]       = useState(true);
    const [isSubmitting, setIsSubmitting]     = useState(false);
    const [confirmModal, setConfirmModal]     = useState(null);
    const [successModal, setSuccessModal]     = useState(null);
    const [showElementPicker, setShowElementPicker] = useState(false);

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
        setEPanelLocal(scores.ePanel || {});
        setSelectedElements(scores.dElements || []);
        setPenalties(scores.penalties || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [existingScores, selectedAthlete?.id]);

    // ─── Derived ───
    const catConfig   = PARKUR_CATEGORIES[selectedCategory] || {};
    const maxElements = catConfig.maxElements  || 10;
    const judgeCount  = catConfig.judgeCount   || 4;

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

    // D: element değerlerinin toplamı (bölme yok, doğrudan toplam)
    const calcDScore = () =>
        selectedElements.reduce((sum, el) => sum + (parseFloat(el.value) || 0), 0);

    const dScore = calcDScore();
    const eScore = calcEScore();
    const totalPenalties = Object.values(penalties).reduce((sum, v) => sum + (parseFloat(v) || 0), 0);

    // D=0 → final=0 kuralı
    const finalScore = dScore === 0
        ? '0.000'
        : Math.max(0, dScore + eScore - totalPenalties).toFixed(3);

    // ─── Handlers ───
    const resetPanel = useCallback(() => {
        setEPanelLocal({});
        setSelectedElements([]);
        setPenalties({});
        setScoringFieldsTouched(false);
    }, []);

    const handleSelectAthlete = (athlete) => {
        if (selectedAthlete?.id === athlete.id) return;
        const prev = existingScores[athlete.id];
        setSelectedAthlete(athlete);
        setIsAthleteCalled(false);
        setScoreLocked(prev?.kilitli === true);
        setScoringFieldsTouched(false);
        if (prev) {
            setEPanelLocal(prev.ePanel || {});
            setSelectedElements(prev.dElements || []);
            setPenalties(prev.penalties || {});
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
        } catch (e) { console.error('aktifSporcu error', e); }
    };

    const getNextAthlete = () => {
        if (!selectedAthlete || athletesByRotation.length === 0) return null;
        const all = athletesByRotation.flat();
        const idx = all.findIndex(a => a.id === selectedAthlete.id);
        if (idx === -1 || idx >= all.length - 1) return null;
        return all[idx + 1];
    };

    // ─── Element Picker ───
    const addElement = (family, value) => {
        if (selectedElements.length >= maxElements) {
            return toast(`Bu kategoride en fazla ${maxElements} element eklenebilir.`, 'warning');
        }
        const familyCount = selectedElements.filter(el => el.familyId === family.id).length;
        if (familyCount >= FAMILY_CONSTRAINTS.maxPerFamily) {
            return toast(`Aynı aileden en fazla ${FAMILY_CONSTRAINTS.maxPerFamily} element eklenebilir (${family.name}).`, 'warning');
        }
        setSelectedElements(prev => [...prev, {
            id: Date.now(),
            group: family.group,
            groupLabel: family.groupLabel,
            familyId: family.id,
            familyName: family.name,
            value: parseFloat(value),
        }]);
        setShowElementPicker(false);
    };

    const removeElement = (id) => {
        setSelectedElements(prev => prev.filter(el => el.id !== id));
    };

    // ─── Submit ───
    const handleSubmitScore = () => {
        if (!selectedAthlete) return toast('Lütfen bir sporcu seçin.', 'warning');
        if (scoreLocked)       return toast('Bu sporcunun puanı kilitli. Kilidi açmak için kilit ikonuna tıklayın.', 'warning');

        const filledE = Object.values(ePanelLocal).filter(v => v !== '' && !isNaN(parseFloat(v)));
        if (filledE.length === 0) return toast('E puanı girilmeden kayıt yapılamaz. En az bir hakem notu giriniz.', 'warning');

        if (dScore === 0 || selectedElements.length === 0) {
            return toast('D puanı 0 — hiç element eklenmemiş. Sporcu puanı 0.000 olarak kaydedilecektir. Devam etmek için element ekleyiniz.', 'warning');
        }

        // Min 2 farklı family zorunluluğu
        const uniqueFamilies = new Set(selectedElements.map(el => el.familyId));
        if (uniqueFamilies.size < FAMILY_CONSTRAINTS.minFamilies) {
            return toast(`En az ${FAMILY_CONSTRAINTS.minFamilies} farklı element ailesi kullanılmalıdır (şu an: ${uniqueFamilies.size}).`, 'warning');
        }

        const fVal = parseFloat(finalScore);
        if (isNaN(fVal)) return toast('Final puanı hesaplanamadı.', 'error');

        setConfirmModal({
            athlete: selectedAthlete,
            dScore, eScore, totalPenalties, finalScore, fVal,
        });
    };

    const handleConfirmSubmit = async () => {
        if (!confirmModal) return;
        setIsSubmitting(true);
        try {
            const scoreData = {
                ePanel:      ePanelLocal,
                dElements:   selectedElements,
                penalties:   penalties,
                dScore:      parseFloat(dScore.toFixed(3)),
                eScore:      parseFloat(eScore.toFixed(3)),
                sonuc:       parseFloat(confirmModal.finalScore),
                durum:       'tamamlandi',
                kilitli:     true,
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
                discipline: 'parkur',
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

            const compKomiteSnap = await get(ref(db, `${firebasePath}/${selectedCompId}/komiteSifresi`));
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
                await offlineWrite({
                    [`${firebasePath}/${selectedCompId}/puanlar/${selectedCategory}/${unlockModal.athleteId}/kilitli`]: false
                });
                setScoreLocked(false);
                setUnlockModal(null);
                setUnlockPassword('');
                toast('Puan kilidi kaldırıldı. Düzenleme yapabilirsiniz.', 'success');
                logAction('score_unlock', `[Parkur] ${unlockModal.athleteId} — puan kilidi kaldırıldı`, {
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

    // ─── Score Status ───
    const getAthleteStatus = (athlete) => {
        const score = existingScores[athlete.id];
        if (!score) return 'bekliyor';
        if (score.kilitli) return 'kilitli';
        return 'tamamlandi';
    };

    // ─── Render ───
    return (
        <div className={`prk-page${sidebarOpen ? '' : ' prk-page--collapsed'}`}>

            {/* ── Sidebar Toggle ── */}
            <button
                className="prk-sidebar-toggle"
                onClick={() => setSidebarOpen(p => !p)}
                title={sidebarOpen ? 'Kenar çubuğunu kapat' : 'Kenar çubuğunu aç'}
            >
                <i className="material-icons-round">{sidebarOpen ? 'chevron_left' : 'menu'}</i>
            </button>

            {/* ── Left Sidebar ── */}
            <aside className={`prk-sidebar${sidebarOpen ? '' : ' prk-sidebar--collapsed'}`}>
                <div className="prk-sidebar-inner">

                    {/* Header */}
                    <div className="prk-sidebar-header">
                        <button className="prk-back-btn" onClick={() => navigate('/parkur')}>
                            <i className="material-icons-round">arrow_back</i>
                        </button>
                        <div>
                            <div className="prk-sidebar-title">Parkur Puanlama</div>
                            <div className="prk-sidebar-sub">TCF Okul Sporları</div>
                        </div>
                    </div>

                    {/* Seçimler */}
                    <div className="prk-filters">
                        <div className="prk-filter-group">
                            <label>İl</label>
                            <select value={selectedCity} onChange={e => { setSelectedCity(e.target.value); setSelectedCompId(''); setSelectedCategory(''); }}>
                                <option value="">Tüm İller</option>
                                {availableCities.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div className="prk-filter-group">
                            <label>Yarışma</label>
                            <select value={selectedCompId} onChange={e => { setSelectedCompId(e.target.value); setSelectedCategory(''); setSelectedAthlete(null); }}>
                                <option value="">Yarışma Seçin</option>
                                {compOptions.map(([id, comp]) => (
                                    <option key={id} value={id}>{comp.isim || comp.name || id}</option>
                                ))}
                            </select>
                        </div>
                        <div className="prk-filter-group">
                            <label>Kategori</label>
                            <select value={selectedCategory} onChange={e => { setSelectedCategory(e.target.value); setSelectedAthlete(null); resetPanel(); }}>
                                <option value="">Kategori Seçin</option>
                                {categoryOptions.map(c => (
                                    <option key={c} value={c}>
                                        {PARKUR_CATEGORIES[c]?.label || c}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Sporcu Listesi */}
                    {selectedCategory && (
                        <div className="prk-athlete-list">
                            <div className="prk-athlete-list-title">
                                <i className="material-icons-round">format_list_numbered</i>
                                Sporcular
                            </div>
                            {athletesByRotation.flat().length === 0 ? (
                                <div className="prk-empty">Bu kategoride sporcu yok.</div>
                            ) : (
                                athletesByRotation.map((rot, ri) => (
                                    <div key={ri} className="prk-rotation-group">
                                        {athletesByRotation.length > 1 && (
                                            <div className="prk-rotation-label">Rotasyon {ri + 1}</div>
                                        )}
                                        {rot.map((ath, ai) => {
                                            const status   = getAthleteStatus(ath);
                                            const isActive = selectedAthlete?.id === ath.id;
                                            return (
                                                <button
                                                    key={ath.id}
                                                    className={`prk-athlete-item${isActive ? ' prk-athlete-item--active' : ''} prk-athlete-item--${status}`}
                                                    onClick={() => handleSelectAthlete(ath)}
                                                >
                                                    <span className="prk-ath-num">{ai + 1}</span>
                                                    <span className="prk-ath-name">
                                                        {ath.soyad ? `${ath.soyad} ${ath.ad || ''}` : ath.name || ath.ad || 'İsimsiz'}
                                                    </span>
                                                    <span className={`prk-ath-badge prk-ath-badge--${status}`}>
                                                        {status === 'kilitli'    ? <i className="material-icons-round">lock</i>
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
            <main className="prk-main">
                {!selectedAthlete ? (
                    <div className="prk-empty-state">
                        <i className="material-icons-round">directions_run</i>
                        <p>Puanlamak için sol listeden bir sporcu seçin.</p>
                        {!selectedCategory && <p className="prk-empty-sub">Önce yarışma ve kategori seçmelisiniz.</p>}
                    </div>
                ) : (
                    <div className="prk-scoring-wrap">

                        {/* ── Sporcu Başlık ── */}
                        <div className="prk-athlete-header">
                            <div className="prk-athlete-info">
                                <div className="prk-athlete-name">
                                    {selectedAthlete.soyad
                                        ? `${selectedAthlete.soyad} ${selectedAthlete.ad || ''}`
                                        : selectedAthlete.name || selectedAthlete.ad || 'İsimsiz Sporcu'}
                                </div>
                                <div className="prk-athlete-meta">
                                    {selectedAthlete.okul && <span><i className="material-icons-round">school</i>{selectedAthlete.okul}</span>}
                                    {selectedAthlete.il   && <span><i className="material-icons-round">location_on</i>{selectedAthlete.il}</span>}
                                    <span><i className="material-icons-round">category</i>{PARKUR_CATEGORIES[selectedCategory]?.label || selectedCategory}</span>
                                </div>
                            </div>
                            <div className="prk-athlete-actions">
                                {!isAthleteCalled ? (
                                    <button className="prk-btn prk-btn--call" onClick={handleCallAthlete}>
                                        <i className="material-icons-round">campaign</i> Sporcu Çağır
                                    </button>
                                ) : (
                                    <span className="prk-called-badge"><i className="material-icons-round">campaign</i> Çağrıldı</span>
                                )}
                                {scoreLocked ? (
                                    <button className="prk-btn prk-btn--unlock" onClick={() => setUnlockModal({ athleteId: selectedAthlete.id })}>
                                        <i className="material-icons-round">lock</i> Kilitli
                                    </button>
                                ) : existingScores[selectedAthlete.id] ? (
                                    <button className="prk-btn prk-btn--lock" onClick={handleLock}>
                                        <i className="material-icons-round">lock_open</i> Kilitle
                                    </button>
                                ) : null}
                            </div>
                        </div>

                        {scoreLocked && (
                            <div className="prk-locked-banner">
                                <i className="material-icons-round">lock</i>
                                Bu sporcunun puanı kilitlenmiştir. Düzenlemek için kilidi açın.
                            </div>
                        )}

                        {/* ── D Puanı — Element Seçimi ── */}
                        <div className="prk-card">
                            <div className="prk-card-header">
                                <span className="prk-card-label prk-card-label--d">D</span>
                                <span className="prk-card-title">Zorluk Puanı</span>
                                <span className="prk-card-desc">
                                    {selectedElements.length}/{maxElements} element · toplam {dScore.toFixed(2)}
                                </span>
                                <span className="prk-score-chip prk-score-chip--d">{dScore.toFixed(3)}</span>
                            </div>
                            <div className="prk-element-body">
                                {/* Element listesi */}
                                <div className="prk-element-list">
                                    {selectedElements.length === 0 && (
                                        <p className="prk-element-hint">Henüz element eklenmedi. Aşağıdaki butona tıklayarak ekleyin.</p>
                                    )}
                                    {selectedElements.map((el, idx) => (
                                        <div key={el.id} className="prk-element-row">
                                            <span className="prk-el-num">{idx + 1}</span>
                                            <span className={`prk-group-badge prk-group-${el.group}`}>{el.group}</span>
                                            <span className="prk-el-family">{el.familyName}</span>
                                            <span className="prk-el-value">{el.value.toFixed(1)}</span>
                                            {!scoreLocked && (
                                                <button className="prk-el-remove" onClick={() => removeElement(el.id)}>
                                                    <i className="material-icons-round">close</i>
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                {!scoreLocked && selectedElements.length < maxElements && (
                                    <button className="prk-btn-add-element" onClick={() => setShowElementPicker(true)}>
                                        <i className="material-icons-round">add_circle</i>
                                        Element Ekle
                                    </button>
                                )}
                                {selectedElements.length > 0 && (
                                    <div className="prk-d-summary">
                                        <span>{selectedElements.length} element</span>
                                        <strong className="prk-d-total">= {dScore.toFixed(3)}</strong>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* ── E Puanı — İcra Hakemi ── */}
                        <div className="prk-card">
                            <div className="prk-card-header">
                                <span className="prk-card-label prk-card-label--e">E</span>
                                <span className="prk-card-title">İcra Puanı</span>
                                <span className="prk-card-desc">{judgeCount} hakem · kesinti girişi (en yük/düşük atılır)</span>
                                <span className="prk-score-chip prk-score-chip--e">{eScore.toFixed(3)}</span>
                            </div>
                            <div className="prk-judges-row">
                                {Array.from({ length: judgeCount }, (_, i) => {
                                    const key = `j${i + 1}`;
                                    const val = ePanelLocal[key] ?? '';
                                    const num = parseFloat(val);
                                    return (
                                        <div key={key} className="prk-judge-cell">
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
                                                <span className="prk-judge-result">{Math.max(0, 10 - num).toFixed(1)}</span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* ── Cezalar ── */}
                        <div className="prk-card">
                            <div className="prk-card-header">
                                <span className="prk-card-label prk-card-label--ded">−</span>
                                <span className="prk-card-title">Ceza Kesintileri</span>
                                <span className="prk-card-desc">Teknik ihlaller</span>
                                <span className="prk-score-chip prk-score-chip--ded">
                                    −{totalPenalties.toFixed(3)}
                                </span>
                            </div>
                            <div className="prk-ded-section">
                                <div className="prk-penalties-grid">
                                    {Object.entries(PARKUR_PENALTY_TYPES).map(([key, pt]) => (
                                        <div key={key} className="prk-penalty-item">
                                            <label>{pt.label}</label>
                                            <div className="prk-penalty-options">
                                                {pt.options.map(v => (
                                                    <button
                                                        key={v}
                                                        className={`prk-pen-btn${parseFloat(penalties[key] || 0) === v ? ' prk-pen-btn--active' : ''}`}
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
                        <div className="prk-final-bar">
                            <div className="prk-final-breakdown">
                                <span>D <strong>{dScore.toFixed(3)}</strong></span>
                                <span>+</span>
                                <span>E <strong>{eScore.toFixed(3)}</strong></span>
                                <span>−</span>
                                <span>Ceza <strong>{totalPenalties.toFixed(3)}</strong></span>
                            </div>
                            <div className="prk-final-score">{finalScore}</div>
                            <button
                                className="prk-btn prk-btn--submit"
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

            {/* ── Element Picker Modal ── */}
            {showElementPicker && (
                <div className="prk-modal-overlay" onClick={() => setShowElementPicker(false)}>
                    <div className="prk-element-picker" onClick={e => e.stopPropagation()}>
                        <div className="prk-picker-header">
                            <i className="material-icons-round">add_circle</i>
                            <h2>Element Seç ({selectedElements.length}/{maxElements})</h2>
                        </div>
                        <div className="prk-picker-body">
                            {PARKUR_ELEMENT_FAMILIES.map(family => {
                                const familyCount  = selectedElements.filter(el => el.familyId === family.id).length;
                                const isFamilyFull = familyCount >= FAMILY_CONSTRAINTS.maxPerFamily;
                                return (
                                    <div key={family.id} className={`prk-family-section${isFamilyFull ? ' prk-family-full' : ''}`}>
                                        <div className="prk-family-header">
                                            <span className={`prk-group-badge prk-group-${family.group}`}>{family.group}</span>
                                            <strong>{family.name}</strong>
                                            <span className="prk-family-desc">{family.description}</span>
                                            {isFamilyFull && (
                                                <span className="prk-family-limit-badge">
                                                    Dolu ({familyCount}/{FAMILY_CONSTRAINTS.maxPerFamily})
                                                </span>
                                            )}
                                        </div>
                                        <div className="prk-value-btns">
                                            {PARKUR_DIFFICULTY_VALUES.map(v => (
                                                <button
                                                    key={v}
                                                    className="prk-value-btn"
                                                    onClick={() => addElement(family, v)}
                                                    disabled={isFamilyFull}
                                                >
                                                    {v.toFixed(1)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="prk-picker-actions">
                            <button className="prk-btn prk-btn--cancel" onClick={() => setShowElementPicker(false)}>
                                Kapat
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Confirm Modal ── */}
            {confirmModal && (
                <div className="prk-modal-overlay" onClick={() => setConfirmModal(null)}>
                    <div className="prk-modal" onClick={e => e.stopPropagation()}>
                        <div className="prk-modal-title">Puanı Onayla</div>
                        <div className="prk-modal-athlete">
                            {confirmModal.athlete.soyad
                                ? `${confirmModal.athlete.soyad} ${confirmModal.athlete.ad || ''}`
                                : confirmModal.athlete.name || ''}
                        </div>
                        <div className="prk-modal-breakdown">
                            <div><span>D (Zorluk)</span><strong>{confirmModal.dScore.toFixed(3)}</strong></div>
                            <div><span>E (İcra)</span><strong>{confirmModal.eScore.toFixed(3)}</strong></div>
                            <div><span>Ceza</span><strong>−{confirmModal.totalPenalties.toFixed(3)}</strong></div>
                        </div>
                        <div className="prk-modal-final">{confirmModal.finalScore}</div>
                        <div className="prk-modal-actions">
                            <button className="prk-btn prk-btn--cancel" onClick={() => setConfirmModal(null)}>İptal</button>
                            <button className="prk-btn prk-btn--confirm" onClick={handleConfirmSubmit} disabled={isSubmitting}>
                                {isSubmitting ? 'Kaydediliyor…' : 'Onayla & Kaydet'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Success Modal ── */}
            {successModal && (
                <div className="prk-modal-overlay" onClick={() => setSuccessModal(null)}>
                    <div className="prk-modal prk-modal--success" onClick={e => e.stopPropagation()}>
                        <i className="material-icons-round prk-modal-icon">check_circle</i>
                        <div className="prk-modal-title">Puan Kaydedildi</div>
                        <div className="prk-modal-athlete">
                            {successModal.athlete.soyad
                                ? `${successModal.athlete.soyad} ${successModal.athlete.ad || ''}`
                                : successModal.athlete.name || ''}
                        </div>
                        <div className="prk-modal-final">{successModal.finalScore}</div>
                        <div className="prk-modal-actions">
                            {successModal.next && (
                                <button
                                    className="prk-btn prk-btn--next"
                                    onClick={() => { handleSelectAthlete(successModal.next); setSuccessModal(null); }}
                                >
                                    <i className="material-icons-round">skip_next</i>
                                    Sonraki: {successModal.next.soyad || successModal.next.name || ''}
                                </button>
                            )}
                            <button className="prk-btn prk-btn--cancel" onClick={() => setSuccessModal(null)}>Kapat</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Unlock Modal ── */}
            {unlockModal && (
                <div className="prk-modal-overlay" onClick={() => setUnlockModal(null)}>
                    <div className="prk-modal" onClick={e => e.stopPropagation()}>
                        <div className="prk-modal-title">Kilidi Aç</div>
                        <p style={{ color: 'var(--prk-text-sec)', marginBottom: '1rem', textAlign: 'center' }}>
                            Komite şifresini girin.
                        </p>
                        <input
                            type="password"
                            className="prk-unlock-input"
                            placeholder="Şifre"
                            value={unlockPassword}
                            onChange={e => setUnlockPassword(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                            autoFocus
                        />
                        {unlockError && <div className="prk-unlock-error">{unlockError}</div>}
                        <div className="prk-modal-actions">
                            <button className="prk-btn prk-btn--cancel" onClick={() => { setUnlockModal(null); setUnlockPassword(''); setUnlockError(''); }}>İptal</button>
                            <button className="prk-btn prk-btn--confirm" onClick={handleUnlock} disabled={unlockingInProgress}>
                                {unlockingInProgress ? 'Kontrol…' : 'Kilidi Aç'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
