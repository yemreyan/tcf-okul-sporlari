import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { AEROBIK_CATEGORIES, ELEMENT_FAMILIES, DIFFICULTY_VALUES, PENALTY_TYPES } from '../data/aerobikCriteriaDefaults';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { logAction } from '../lib/auditLogger';
import './AerobikScoringPage.css';

export default function AerobikScoringPage() {
    const navigate = useNavigate();
    const { currentUser, hasPermission } = useAuth();
    const { toast } = useNotification();

    // Data
    const [competitions, setCompetitions] = useState({});
    const [selectedCompId, setSelectedCompId] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('');

    // Athlete
    const [athletesByRotation, setAthletesByRotation] = useState([]);
    const [existingScores, setExistingScores] = useState({});
    const [selectedAthlete, setSelectedAthlete] = useState(null);
    const [isAthleteCalled, setIsAthleteCalled] = useState(false);

    // A Score (Artistic) — 4 judges, positive 0-10
    const [aPanelLocal, setAPanelLocal] = useState({});
    // E Score (Execution) — 4 judges, deductions from 10
    const [ePanelLocal, setEPanelLocal] = useState({});
    // D Score (Difficulty) — selected elements
    const [selectedElements, setSelectedElements] = useState([]);
    // CJP — Chair of Judges Panel bonus
    const [cjpValue, setCjpValue] = useState(0);
    // Penalties
    const [penalties, setPenalties] = useState({ time: 0, line: 0, music: 0, lift: 0, costume: 0 });

    // UI State
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [confirmModal, setConfirmModal] = useState(null);
    const [successModal, setSuccessModal] = useState(null);
    const [showElementPicker, setShowElementPicker] = useState(false);

    const JUDGE_COUNT = 4;

    // ─── Firebase Listeners ───
    useEffect(() => {
        const unsub = onValue(ref(db, 'aerobik_yarismalar'), (snap) => {
            const data = snap.val() || {};
            setCompetitions(filterCompetitionsByUser(data, currentUser));
        });
        return () => unsub();
    }, [currentUser]);

    useEffect(() => {
        if (!selectedCompId || !selectedCategory) {
            setAthletesByRotation([]);
            setExistingScores({});
            setSelectedAthlete(null);
            setIsAthleteCalled(false);
            return;
        }

        const orderRef = ref(db, `aerobik_yarismalar/${selectedCompId}/siralama/${selectedCategory}`);
        const unsubOrder = onValue(orderRef, (snap) => {
            const orderData = snap.val();
            const rotations = [];
            if (orderData) {
                const maxRots = Math.max(...Object.keys(orderData).map(k => parseInt(k.replace('rotation_', ''))).filter(n => !isNaN(n)));
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
                // Fallback: sporculardan al
                const fbRef = ref(db, `aerobik_yarismalar/${selectedCompId}/sporcular/${selectedCategory}`);
                onValue(fbRef, (fbSnap) => {
                    const fbData = fbSnap.val();
                    if (fbData) {
                        const arr = Object.keys(fbData).map(id => ({ id, ...fbData[id] }));
                        arr.sort((a, b) => (a.cikisSirasi || 999) - (b.cikisSirasi || 999));
                        setAthletesByRotation([arr]);
                    }
                }, { onlyOnce: true });
            }
        });

        const scoresRef = ref(db, `aerobik_yarismalar/${selectedCompId}/puanlar/${selectedCategory}`);
        const unsubScores = onValue(scoresRef, (snap) => {
            setExistingScores(snap.val() || {});
        });

        return () => { unsubOrder(); unsubScores(); };
    }, [selectedCompId, selectedCategory]);

    // ─── Derived Data ───
    const compOptions = Object.entries(competitions)
        .sort((a, b) => new Date(b[1].tarih || b[1].baslangicTarihi || 0) - new Date(a[1].tarih || a[1].baslangicTarihi || 0));

    let categoryOptions = [];
    if (selectedCompId && competitions[selectedCompId]?.sporcular) {
        categoryOptions = Object.keys(competitions[selectedCompId].sporcular);
    } else if (selectedCompId && competitions[selectedCompId]?.kategoriler) {
        categoryOptions = Object.keys(competitions[selectedCompId].kategoriler);
    }

    const categoryConfig = AEROBIK_CATEGORIES[selectedCategory] || AEROBIK_CATEGORIES['IM'];
    const maxElements = categoryConfig?.maxElements || 9;
    const dDivisor = categoryConfig?.dDivisor || 2.0;

    // ─── Score Calculations ───

    // A Score: 4 judges, trim high/low, avg remaining 2
    const calcTrimmedAvg = (panelLocal, count) => {
        const scores = [];
        for (let i = 1; i <= count; i++) {
            const val = panelLocal[`j${i}`];
            if (val !== undefined && val !== null && val !== '' && !isNaN(parseFloat(val))) {
                scores.push(parseFloat(val));
            }
        }
        if (scores.length === 0) return 0;
        if (scores.length >= 4) {
            scores.sort((a, b) => a - b);
            const trimmed = scores.slice(1, -1);
            return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
        }
        return scores.reduce((a, b) => a + b, 0) / scores.length;
    };

    const aScore = calcTrimmedAvg(aPanelLocal, JUDGE_COUNT);

    // E Score: judges enter deductions, E = 10 - trimmed avg deduction
    const avgEDeduction = calcTrimmedAvg(ePanelLocal, JUDGE_COUNT);
    const eScore = Math.max(0, 10.0 - avgEDeduction);

    // D Score: sum of element values / divisor
    const dRawSum = selectedElements.reduce((sum, el) => sum + (parseFloat(el.value) || 0), 0);
    const dScore = dDivisor > 0 ? dRawSum / dDivisor : 0;

    // CJP
    const cjp = parseFloat(cjpValue) || 0;

    // Penalties
    const totalPenalties = Object.values(penalties).reduce((sum, v) => sum + (parseFloat(v) || 0), 0);

    // Final Score
    const finalScore = Math.max(0, aScore + eScore + dScore + cjp - totalPenalties).toFixed(3);

    // ─── Handlers ───
    const handleSelectAthlete = (athlete) => {
        if (selectedAthlete?.id === athlete.id) return;
        setSelectedAthlete(athlete);
        setIsAthleteCalled(false);

        const prev = existingScores[athlete.id];
        if (prev) {
            setAPanelLocal(prev.aPanel || {});
            setEPanelLocal(prev.ePanel || {});
            setSelectedElements(prev.dElements || []);
            setCjpValue(prev.cjp || 0);
            setPenalties(prev.penalties || { time: 0, line: 0, music: 0, lift: 0, costume: 0 });
        } else {
            resetPanel();
        }
    };

    const resetPanel = () => {
        setAPanelLocal({});
        setEPanelLocal({});
        setSelectedElements([]);
        setCjpValue(0);
        setPenalties({ time: 0, line: 0, music: 0, lift: 0, costume: 0 });
    };

    const handleCallAthlete = async () => {
        setIsAthleteCalled(true);
        try {
            await update(ref(db), {
                [`aerobik_yarismalar/${selectedCompId}/aktifSporcu/${selectedCategory}`]: selectedAthlete.id
            });
        } catch (e) { console.error('Could not set active athlete', e); }
    };

    const getNextAthlete = () => {
        if (!selectedAthlete || athletesByRotation.length === 0) return null;
        const all = athletesByRotation.flat();
        const idx = all.findIndex(a => a.id === selectedAthlete.id);
        if (idx === -1 || idx >= all.length - 1) return null;
        return all[idx + 1];
    };

    const addElement = (family, value) => {
        if (selectedElements.length >= maxElements) {
            return toast(`Bu kategoride en fazla ${maxElements} element eklenebilir.`, 'warning');
        }
        setSelectedElements(prev => [...prev, {
            id: Date.now(),
            group: family.group,
            groupLabel: family.groupLabel,
            familyId: family.id,
            familyName: family.name,
            value: parseFloat(value)
        }]);
        setShowElementPicker(false);
    };

    const removeElement = (id) => {
        setSelectedElements(prev => prev.filter(el => el.id !== id));
    };

    const handleSubmitScore = () => {
        if (!selectedAthlete) return toast('Lütfen bir sporcu seçin.', 'warning');
        const fVal = parseFloat(finalScore);
        if (isNaN(fVal) || fVal < 0 || fVal > 30) return toast('Final puanı geçersiz.', 'error');

        setConfirmModal({
            athlete: selectedAthlete,
            aScore, eScore, dScore, cjp, totalPenalties, finalScore,
            category: selectedCategory
        });
    };

    const executeScoreSave = async () => {
        const savedAthlete = confirmModal.athlete;
        setConfirmModal(null);
        setIsSubmitting(true);
        try {
            const scorePath = `aerobik_yarismalar/${selectedCompId}/puanlar/${selectedCategory}/${savedAthlete.id}`;
            const activePath = `aerobik_yarismalar/${selectedCompId}/aktifSporcu/${selectedCategory}`;
            const ts = new Date().toISOString();

            await update(ref(db), {
                [scorePath + '/aScore']: aScore,
                [scorePath + '/eScore']: eScore,
                [scorePath + '/dScore']: dScore,
                [scorePath + '/dRawSum']: dRawSum,
                [scorePath + '/dDivisor']: dDivisor,
                [scorePath + '/cjp']: cjp,
                [scorePath + '/penalties']: penalties,
                [scorePath + '/totalPenalties']: totalPenalties,
                [scorePath + '/aPanel']: aPanelLocal,
                [scorePath + '/ePanel']: ePanelLocal,
                [scorePath + '/dElements']: selectedElements,
                [scorePath + '/sonuc']: parseFloat(finalScore),
                [scorePath + '/timestamp']: ts,
                [scorePath + '/durum']: 'tamamlandi',
                [activePath]: null,
            });

            logAction('score_create', `[Aerobik] ${savedAthlete.ad} ${savedAthlete.soyad} — ${selectedCategory}: ${finalScore}`, {
                user: currentUser?.kullaniciAdi || 'admin',
                competitionId: selectedCompId,
            });

            const nextAth = getNextAthlete();
            setSuccessModal({
                athlete: savedAthlete,
                finalScore, aScore, eScore, dScore,
                category: selectedCategory,
                nextAthlete: nextAth
            });
        } catch (error) {
            console.error('Score save error:', error);
            toast('Puan kaydedilirken bir hata oluştu.', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleNextAthlete = (nextAth) => {
        setSuccessModal(null);
        handleSelectAthlete(nextAth);
    };

    // ─── Render ───
    return (
        <div className="as-page">
            <header className="as-header">
                <div className="as-header-left">
                    <button className="as-btn-back" onClick={() => navigate('/aerobik')}>
                        <i className="material-icons-round">home</i>
                    </button>
                    <div>
                        <h1>Aerobik Puanlama</h1>
                        <p className="as-subtitle">A + E + D + CJP - Ceza</p>
                    </div>
                </div>
                <div className="as-header-right">
                    {selectedAthlete && isAthleteCalled && (
                        <div className="as-live-badge">
                            <div className="as-pulse-dot"></div>
                            <span>CANLI</span>
                        </div>
                    )}
                    <button className="as-btn-toggle" onClick={() => setSidebarOpen(p => !p)}>
                        <i className="material-icons-round">{sidebarOpen ? 'menu_open' : 'menu'}</i>
                    </button>
                </div>
            </header>

            <div className="as-layout">
                {/* Sidebar */}
                <aside className={`as-sidebar ${!sidebarOpen ? 'as-sidebar--collapsed' : ''}`}>
                    <div className="as-sidebar-controls">
                        <select className="as-select" value={selectedCompId} onChange={e => { setSelectedCompId(e.target.value); setSelectedCategory(''); setSelectedAthlete(null); }}>
                            <option value="">Yarışma Seçin</option>
                            {compOptions.map(([id, comp]) => <option key={id} value={id}>{comp.isim}</option>)}
                        </select>
                        <select className="as-select" value={selectedCategory} onChange={e => { setSelectedCategory(e.target.value); setSelectedAthlete(null); }} disabled={!selectedCompId}>
                            <option value="">Kategori Seçin</option>
                            {categoryOptions.map(cat => (
                                <option key={cat} value={cat}>{AEROBIK_CATEGORIES[cat]?.label || cat}</option>
                            ))}
                        </select>
                    </div>

                    <div className="as-roster-container">
                        {!selectedCategory ? (
                            <div className="as-roster-empty">
                                <i className="material-icons-round">touch_app</i>
                                <p>Yarışma ve kategori seçin.</p>
                            </div>
                        ) : (
                            <div className="as-roster-list">
                                <h3 className="as-section-title">Çıkış Sırası</h3>
                                {athletesByRotation.map((rotation, rIdx) => (
                                    rotation.length > 0 && (
                                        <div key={rIdx} className="as-roster-group">
                                            <div className="as-rg-title">Rotasyon {rIdx + 1}</div>
                                            {rotation.map(ath => {
                                                const isSelected = selectedAthlete?.id === ath.id;
                                                const scoreData = existingScores[ath.id];
                                                const hasScore = scoreData && scoreData.durum === 'tamamlandi';
                                                const display = scoreData ? parseFloat(scoreData.sonuc ?? 0).toFixed(3) : '0.000';
                                                return (
                                                    <div key={ath.id}
                                                        className={`as-roster-athlete ${isSelected ? 'selected' : ''} ${hasScore ? 'scored' : ''}`}
                                                        onClick={() => handleSelectAthlete(ath)}>
                                                        <div className="as-ra-info">
                                                            <span className="as-ra-order">{ath.sirasi || ath.cikisSirasi}.</span>
                                                            <span className="as-ra-name">{ath.ad} {ath.soyad}</span>
                                                        </div>
                                                        {hasScore ? (
                                                            <div className="as-ra-score">{display}</div>
                                                        ) : (
                                                            <div className="as-ra-pending">Bekliyor</div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )
                                ))}
                            </div>
                        )}
                    </div>
                </aside>

                {/* Main */}
                <main className="as-main">
                    {!selectedAthlete ? (
                        <div className="as-empty">
                            <i className="material-icons-round" style={{ fontSize: '4rem', color: '#CBD5E1' }}>directions_run</i>
                            <h2>Puanlamaya Hazır</h2>
                            <p>Sol taraftaki listeden bir sporcu seçin.</p>
                        </div>
                    ) : !isAthleteCalled ? (
                        <div className="as-call-view">
                            <div className="as-athlete-card">
                                <h3>Sıradaki Sporcu</h3>
                                <h1>{selectedAthlete.ad} {selectedAthlete.soyad}</h1>
                                <p className="as-club">{selectedAthlete.okul || selectedAthlete.kulup || ''}</p>
                                <div className="as-meta">
                                    <span className="as-badge">Sıra: {selectedAthlete.sirasi || selectedAthlete.cikisSirasi}</span>
                                    <span className="as-badge">Kategori: {AEROBIK_CATEGORIES[selectedCategory]?.label || selectedCategory}</span>
                                </div>
                            </div>
                            <button className="as-btn-call" onClick={handleCallAthlete}>
                                <i className="material-icons-round">campaign</i>
                                Sporcuyu Çağır ve Puanla
                            </button>
                        </div>
                    ) : (
                        <div className="as-scoring-panel">
                            {/* Athlete Header */}
                            <div className="as-athlete-header">
                                <div className="as-avatar">{selectedAthlete.ad.charAt(0)}{selectedAthlete.soyad.charAt(0)}</div>
                                <div className="as-ath-details">
                                    <h2>{selectedAthlete.ad} {selectedAthlete.soyad}</h2>
                                    <p className="as-subtitle">{selectedAthlete.okul || selectedAthlete.kulup} &bull; {AEROBIK_CATEGORIES[selectedCategory]?.label || selectedCategory}</p>
                                </div>
                                {existingScores[selectedAthlete.id] && (
                                    <div className="as-override-warning">
                                        <i className="material-icons-round">warning</i> Önceki Puan Değiştiriliyor
                                    </div>
                                )}
                            </div>

                            <div className="as-scoring-grid">
                                {/* ═══ A SCORE (Artistic) ═══ */}
                                <div className="as-card as-card-purple">
                                    <div className="as-card-header as-header-purple">
                                        <h3>A Puanı (Artistik)</h3>
                                        <i className="material-icons-round">palette</i>
                                    </div>
                                    <div className="as-card-body">
                                        <div className="as-judge-panels">
                                            {[1, 2, 3, 4].map(i => {
                                                const key = `j${i}`;
                                                const val = aPanelLocal[key];
                                                const hasVal = val !== undefined && val !== null && val !== '';
                                                return (
                                                    <div key={i} className={`as-judge-panel ${hasVal ? 'as-judge-ready' : ''}`}>
                                                        <div className="as-judge-label">A{i}</div>
                                                        <input type="number" step="0.1" min="0" max="10"
                                                            value={hasVal ? val : ''} placeholder="—"
                                                            className="as-judge-input"
                                                            onChange={e => setAPanelLocal(p => ({ ...p, [key]: e.target.value }))} />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div className="as-score-summary">
                                            <span>Net A Puanı: <strong className="as-text-purple">{aScore.toFixed(3)}</strong></span>
                                        </div>
                                    </div>
                                </div>

                                {/* ═══ E SCORE (Execution) ═══ */}
                                <div className="as-card as-card-green">
                                    <div className="as-card-header as-header-green">
                                        <h3>E Puanı (Uygulama)</h3>
                                        <i className="material-icons-round">fitness_center</i>
                                    </div>
                                    <div className="as-card-body">
                                        <p className="as-hint">Kesinti miktarını girin (10.0'dan düşülür)</p>
                                        <div className="as-judge-panels">
                                            {[1, 2, 3, 4].map(i => {
                                                const key = `j${i}`;
                                                const val = ePanelLocal[key];
                                                const hasVal = val !== undefined && val !== null && val !== '';
                                                return (
                                                    <div key={i} className={`as-judge-panel ${hasVal ? 'as-judge-ready' : ''}`}>
                                                        <div className="as-judge-label">E{i}</div>
                                                        <input type="number" step="0.1" min="0" max="10"
                                                            value={hasVal ? val : ''} placeholder="—"
                                                            className="as-judge-input"
                                                            onChange={e => setEPanelLocal(p => ({ ...p, [key]: e.target.value }))} />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div className="as-score-summary">
                                            <span>Ort. Kesinti: <strong className="as-text-orange">-{avgEDeduction.toFixed(2)}</strong></span>
                                            <span>Net E Puanı: <strong className="as-text-green">{eScore.toFixed(3)}</strong></span>
                                        </div>
                                    </div>
                                </div>

                                {/* ═══ D SCORE (Difficulty) ═══ */}
                                <div className="as-card as-card-blue as-card-wide">
                                    <div className="as-card-header as-header-blue">
                                        <h3>D Puanı (Zorluk) — {selectedElements.length}/{maxElements} element</h3>
                                        <i className="material-icons-round">emoji_events</i>
                                    </div>
                                    <div className="as-card-body">
                                        {/* Selected elements list */}
                                        <div className="as-element-list">
                                            {selectedElements.length === 0 && (
                                                <p className="as-hint">Henüz element eklenmedi. Aşağıdaki butonla ekleyin.</p>
                                            )}
                                            {selectedElements.map((el, idx) => (
                                                <div key={el.id} className="as-element-row">
                                                    <span className={`as-group-badge as-group-${el.group}`}>{el.group}</span>
                                                    <span className="as-element-family">{el.familyName}</span>
                                                    <span className="as-element-value">{el.value.toFixed(1)}</span>
                                                    <button className="as-element-remove" onClick={() => removeElement(el.id)}>
                                                        <i className="material-icons-round">close</i>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>

                                        {selectedElements.length < maxElements && (
                                            <button className="as-btn-add-element" onClick={() => setShowElementPicker(true)}>
                                                <i className="material-icons-round">add_circle</i>
                                                Element Ekle
                                            </button>
                                        )}

                                        <div className="as-d-summary">
                                            <span>Toplam: {dRawSum.toFixed(1)}</span>
                                            <span>/ {dDivisor.toFixed(1)}</span>
                                            <strong className="as-text-blue">= {dScore.toFixed(3)}</strong>
                                        </div>
                                    </div>
                                </div>

                                {/* ═══ CJP ═══ */}
                                <div className="as-card as-card-indigo">
                                    <div className="as-card-header as-header-indigo">
                                        <h3>CJP (Baş Hakem Bonusu)</h3>
                                        <i className="material-icons-round">star</i>
                                    </div>
                                    <div className="as-card-body">
                                        <div className="as-cjp-btns">
                                            {[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map(v => (
                                                <button key={v}
                                                    className={`as-cjp-btn ${parseFloat(cjpValue) === v ? 'selected' : ''}`}
                                                    onClick={() => setCjpValue(v)}>
                                                    {v.toFixed(1)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* ═══ PENALTIES ═══ */}
                                <div className="as-card as-card-red">
                                    <div className="as-card-header as-header-red">
                                        <h3>Ceza Kesintileri</h3>
                                        <i className="material-icons-round">gavel</i>
                                    </div>
                                    <div className="as-card-body">
                                        {Object.entries(PENALTY_TYPES).map(([key, penType]) => (
                                            <div key={key} className="as-penalty-row">
                                                <span className="as-penalty-label">{penType.label}</span>
                                                <div className="as-penalty-btns">
                                                    {penType.options.map(v => (
                                                        <button key={v}
                                                            className={`as-penalty-btn ${parseFloat(penalties[key]) === v ? 'selected' : ''}`}
                                                            onClick={() => setPenalties(p => ({ ...p, [key]: v }))}>
                                                            {v.toFixed(1)}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                        <div className="as-score-summary">
                                            <span>Toplam Ceza: <strong className="as-text-red">-{totalPenalties.toFixed(1)}</strong></span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Final Score Bar */}
                            <div className="as-final-bar">
                                <div className="as-final-calc">
                                    <span className="as-chip as-chip-purple">A: {aScore.toFixed(3)}</span>
                                    <span className="as-math">+</span>
                                    <span className="as-chip as-chip-green">E: {eScore.toFixed(3)}</span>
                                    <span className="as-math">+</span>
                                    <span className="as-chip as-chip-blue">D: {dScore.toFixed(3)}</span>
                                    {cjp > 0 && (<><span className="as-math">+</span><span className="as-chip as-chip-indigo">CJP: {cjp.toFixed(1)}</span></>)}
                                    {totalPenalties > 0 && (<><span className="as-math">−</span><span className="as-chip as-chip-red">Ceza: {totalPenalties.toFixed(1)}</span></>)}
                                    <span className="as-math">=</span>
                                </div>
                                <div className="as-final-score">{finalScore}</div>
                                {hasPermission('scoring', 'puanla') && (
                                    <button className="as-btn-save" onClick={handleSubmitScore} disabled={isSubmitting}>
                                        {isSubmitting ? <div className="as-spinner"></div> : <i className="material-icons-round">publish</i>}
                                        <span>Kaydet</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </main>
            </div>

            {/* Element Picker Modal */}
            {showElementPicker && (
                <div className="as-modal-overlay" onClick={() => setShowElementPicker(false)}>
                    <div className="as-modal as-modal-wide" onClick={e => e.stopPropagation()}>
                        <div className="as-modal-header as-header-blue">
                            <i className="material-icons-round">add_circle</i>
                            <h2>Element Seç ({selectedElements.length}/{maxElements})</h2>
                        </div>
                        <div className="as-modal-body">
                            {ELEMENT_FAMILIES.map(family => (
                                <div key={family.id} className="as-family-section">
                                    <div className="as-family-header">
                                        <span className={`as-group-badge as-group-${family.group}`}>{family.group}</span>
                                        <strong>{family.name}</strong>
                                        <span className="as-family-desc">{family.description}</span>
                                    </div>
                                    <div className="as-value-btns">
                                        {DIFFICULTY_VALUES.map(v => (
                                            <button key={v} className="as-value-btn" onClick={() => addElement(family, v)}>
                                                {v.toFixed(1)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="as-modal-actions">
                            <button className="as-modal-btn as-modal-cancel" onClick={() => setShowElementPicker(false)}>
                                Kapat
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirm Modal */}
            {confirmModal && (
                <div className="as-modal-overlay" onClick={() => setConfirmModal(null)}>
                    <div className="as-modal" onClick={e => e.stopPropagation()}>
                        <div className="as-modal-header as-header-confirm">
                            <i className="material-icons-round">fact_check</i>
                            <h2>Puan Onayı</h2>
                        </div>
                        <div className="as-modal-body">
                            <div className="as-modal-athlete">
                                <div className="as-modal-avatar">{confirmModal.athlete.ad.charAt(0)}{confirmModal.athlete.soyad.charAt(0)}</div>
                                <div>
                                    <h3>{confirmModal.athlete.ad} {confirmModal.athlete.soyad}</h3>
                                    <p>{confirmModal.athlete.okul || confirmModal.athlete.kulup} &bull; {confirmModal.category}</p>
                                </div>
                            </div>
                            <div className="as-modal-scores">
                                <div className="as-modal-score-item purple"><span>A Puanı</span><strong>{confirmModal.aScore.toFixed(3)}</strong></div>
                                <div className="as-modal-score-item green"><span>E Puanı</span><strong>{confirmModal.eScore.toFixed(3)}</strong></div>
                                <div className="as-modal-score-item blue"><span>D Puanı</span><strong>{confirmModal.dScore.toFixed(3)}</strong></div>
                                {confirmModal.cjp > 0 && <div className="as-modal-score-item indigo"><span>CJP</span><strong>+{confirmModal.cjp.toFixed(1)}</strong></div>}
                                {confirmModal.totalPenalties > 0 && <div className="as-modal-score-item red"><span>Ceza</span><strong>-{confirmModal.totalPenalties.toFixed(1)}</strong></div>}
                            </div>
                            <div className="as-modal-final">
                                <span>Final Puanı</span>
                                <strong>{confirmModal.finalScore}</strong>
                            </div>
                        </div>
                        <div className="as-modal-actions">
                            <button className="as-modal-btn as-modal-cancel" onClick={() => setConfirmModal(null)}>
                                <i className="material-icons-round">close</i> Vazgeç
                            </button>
                            <button className="as-modal-btn as-modal-confirm" onClick={executeScoreSave} disabled={isSubmitting}>
                                {isSubmitting ? <div className="as-spinner"></div> : <i className="material-icons-round">check</i>}
                                Onayla ve Kaydet
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Success Modal */}
            {successModal && (
                <div className="as-modal-overlay">
                    <div className="as-modal">
                        <div className="as-modal-header as-header-success">
                            <i className="material-icons-round">check_circle</i>
                            <h2>Puan Kaydedildi</h2>
                        </div>
                        <div className="as-modal-body">
                            <div className="as-modal-athlete">
                                <div className="as-modal-avatar as-avatar-success">{successModal.athlete.ad.charAt(0)}{successModal.athlete.soyad.charAt(0)}</div>
                                <div>
                                    <h3>{successModal.athlete.ad} {successModal.athlete.soyad}</h3>
                                    <p>{successModal.category}</p>
                                </div>
                                <div className="as-saved-badge">{successModal.finalScore}</div>
                            </div>
                            {successModal.nextAthlete ? (
                                <div className="as-next-section">
                                    <div className="as-next-divider"><span>Sıradaki Sporcu</span></div>
                                    <div className="as-next-card">
                                        <div className="as-next-avatar">{successModal.nextAthlete.ad.charAt(0)}{successModal.nextAthlete.soyad.charAt(0)}</div>
                                        <div className="as-next-info">
                                            <h3>{successModal.nextAthlete.ad} {successModal.nextAthlete.soyad}</h3>
                                            <p>{successModal.nextAthlete.okul || ''}</p>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="as-next-section">
                                    <div className="as-next-divider"><span>Tüm sporcular puanlandı</span></div>
                                </div>
                            )}
                        </div>
                        <div className="as-modal-actions">
                            <button className="as-modal-btn as-modal-cancel" onClick={() => setSuccessModal(null)}>Kapat</button>
                            {successModal.nextAthlete && (
                                <button className="as-modal-btn as-modal-next" onClick={() => handleNextAthlete(successModal.nextAthlete)}>
                                    <i className="material-icons-round">campaign</i> Sporcuyu Çağır
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
