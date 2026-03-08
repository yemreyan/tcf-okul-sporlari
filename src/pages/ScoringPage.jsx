import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, update } from 'firebase/database';
import { db } from '../lib/firebase';
import { DEFAULT_CRITERIA } from '../data/criteriaDefaults';
import './ScoringPage.css';

export default function ScoringPage() {
    const navigate = useNavigate();
    const [competitions, setCompetitions] = useState({});

    // Selections
    const [selectedCompId, setSelectedCompId] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('');
    const [selectedApparatus, setSelectedApparatus] = useState('');

    // Athlete State
    const [selectedAthlete, setSelectedAthlete] = useState(null);
    const [isAthleteCalled, setIsAthleteCalled] = useState(false); // Controls the "Call Athlete" vs "Scoring Form" view

    // Data mapped from Firebase
    const [athletesByRotation, setAthletesByRotation] = useState([]);
    const [existingScores, setExistingScores] = useState({});

    // Active Scoring State
    const [dScore, setDScore] = useState(0); // Custom dynamic
    const [skillScores, setSkillScores] = useState({}); // Skill-based D-scoring
    const [eDeductions, setEDeductions] = useState([]); // Local fallback
    const [neutralDeductions, setNeutralDeductions] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // 1. Load Competitions
    useEffect(() => {
        const compsRef = ref(db, 'competitions');
        const unsubscribe = onValue(compsRef, (snap) => {
            const data = snap.val() || {};
            setCompetitions(data);
        });
        return () => unsubscribe();
    }, []);

    // 2. Load Start Order and Scores
    useEffect(() => {
        if (!selectedCompId || !selectedCategory || !selectedApparatus) {
            setAthletesByRotation([]);
            setExistingScores({});
            setSelectedAthlete(null);
            setIsAthleteCalled(false);
            return;
        }

        const orderRef = ref(db, `competitions/${selectedCompId}/siralama/${selectedCategory}`);
        const unsubOrder = onValue(orderRef, (orderSnap) => {
            const orderData = orderSnap.val();
            const formattedRotations = [];

            if (orderData) {
                const maxRots = Math.max(...Object.keys(orderData).map(k => parseInt(k.replace('rotation_', ''))).filter(n => !isNaN(n)));

                for (let i = 0; i <= maxRots; i++) {
                    const rotData = orderData[`rotation_${i}`];
                    if (rotData) {
                        const athArr = Object.keys(rotData).map(id => ({
                            id,
                            ...rotData[id]
                        })).sort((a, b) => a.sirasi - b.sirasi);
                        formattedRotations.push(athArr);
                    } else {
                        formattedRotations.push([]);
                    }
                }
            } else {
                // Fallback if no rotations, fetch directly from sporcular
                const fallbackRef = ref(db, `competitions/${selectedCompId}/sporcular/${selectedCategory}`);
                onValue(fallbackRef, (fbSnap) => {
                    const fbData = fbSnap.val();
                    if (fbData) {
                        const arr = Object.keys(fbData).map(id => ({ id, ...fbData[id] }));
                        // Sort by cikisSirasi or name if missing
                        arr.sort((a, b) => (a.cikisSirasi || 999) - (b.cikisSirasi || 999));
                        setAthletesByRotation([arr]);
                    }
                }, { onlyOnce: true });
            }
            if (orderData) setAthletesByRotation(formattedRotations);
        });

        const scoresRef = ref(db, `competitions/${selectedCompId}/puanlar/${selectedCategory}/${selectedApparatus}`);
        const unsubScores = onValue(scoresRef, (scoreSnap) => {
            setExistingScores(scoreSnap.val() || {});
        });

        return () => {
            unsubOrder();
            unsubScores();
        };

    }, [selectedCompId, selectedCategory, selectedApparatus]);

    // Dropdown Data & Criteria Options
    const compOptions = Object.entries(competitions).sort((a, b) => new Date(b[1].tarih) - new Date(a[1].tarih));

    let categoryOptions = [];
    if (selectedCompId && competitions[selectedCompId]?.sporcular) {
        categoryOptions = Object.keys(competitions[selectedCompId].sporcular);
    } else if (selectedCompId && competitions[selectedCompId]?.kategoriler) {
        categoryOptions = Object.keys(competitions[selectedCompId].kategoriler);
    }

    let apparatusOptions = [];
    let currentCriteria = null;
    if (selectedCategory) {
        const criteriaCat = DEFAULT_CRITERIA[selectedCategory];
        if (criteriaCat) {
            apparatusOptions = Object.keys(criteriaCat)
                .filter(key => key !== 'metadata' && key !== 'eksikKesintiTiers')
                .map(key => ({ id: key, name: key.charAt(0).toUpperCase() + key.slice(1) }));
            if (selectedApparatus) {
                currentCriteria = criteriaCat[selectedApparatus];
            }
        }
    }

    // Computed Values
    const getActiveAthleteScores = () => {
        if (!selectedAthlete) return {};
        return existingScores[selectedAthlete.id] || {};
    };

    const activeScores = getActiveAthleteScores();

    // D-Score Calculation
    const hasDynamicSkills = currentCriteria?.hareketler && currentCriteria.hareketler.length > 0;

    let calculatedDScore = 0;
    if (hasDynamicSkills) {
        calculatedDScore = Object.values(skillScores).reduce((sum, val) => sum + (parseFloat(val) || 0), 0);
    } else {
        calculatedDScore = parseFloat(dScore) || 0;
    }

    // Missing penalty (Eksik) for dynamic D-Score
    let missingPenalty = 0;
    if (hasDynamicSkills && currentCriteria?.eksikKesintiTiers) {
        const validSkillCount = Object.values(skillScores).filter(val => (parseFloat(val) || 0) > 0).length;
        const tiers = currentCriteria.eksikKesintiTiers;

        let targetTierKey = validSkillCount.toString();
        // If skill count is lower than the lowest tier, apply the highest penalty possible inside tiers
        const tierKeys = Object.keys(tiers).map(Number).sort((a, b) => a - b);
        if (tierKeys.length > 0) {
            if (validSkillCount < tierKeys[0]) {
                missingPenalty = tiers[tierKeys[0].toString()]; // worst case penalty
            } else if (tiers[targetTierKey] !== undefined) {
                missingPenalty = tiers[targetTierKey];
            } else {
                missingPenalty = 0; // count is strictly higher than max penalized tier
            }
        }
    }

    // E-Score Calculation
    const renderEPanels = () => {
        if (!currentCriteria) return [];
        const panels = [];
        for (let i = 1; i <= (currentCriteria.hakemSayisi || 4); i++) {
            panels.push(`e${i}`);
        }
        return panels;
    };

    const ePanels = renderEPanels();
    const calculateAvgEDeduction = () => {
        const remoteScores = ePanels.map(p => activeScores[p]).filter(val => val !== undefined && val !== null && val !== '');
        if (remoteScores.length > 0) {
            const sum = remoteScores.reduce((acc, val) => acc + parseFloat(val), 0);
            return sum / remoteScores.length;
        }
        // Fallback to local E deductions if remote not used
        return eDeductions.reduce((sum, val) => sum + parseFloat(val), 0);
    };

    const E_SCORE_BASE = 10.0;
    const avgEDeduction = calculateAvgEDeduction();
    const currentEScore = Math.max(0, E_SCORE_BASE - avgEDeduction);

    // Neutral Penalties: Missing Penalty + Tarafsiz
    const totalNeutral = (parseFloat(neutralDeductions) || 0) + missingPenalty;
    const finalScore = Math.max(0, calculatedDScore + currentEScore - totalNeutral).toFixed(3);

    // Handlers
    const handleSelectAthlete = (athlete) => {
        if (selectedAthlete?.id === athlete.id) return;

        setSelectedAthlete(athlete);
        setIsAthleteCalled(false); // Reset to wait state when selected

        // Remove active marker if we switch without finishing
        if (selectedAthlete && isAthleteCalled) {
            update(ref(db, `competitions/${selectedCompId}/aktifSporcu/${selectedCategory}/${selectedApparatus}`), null);
        }

        const prevScore = existingScores[athlete.id];
        if (prevScore) {
            setDScore(prevScore.dScore || prevScore.calc_D || 0);
            setEDeductions(prevScore.eDeductionsList || []);
            setNeutralDeductions(prevScore.neutralDeductions || (prevScore.calc_MissingPen && !hasDynamicSkills ? prevScore.calc_MissingPen : 0));
            setSkillScores(prevScore.hareketler || {});
        } else {
            resetScoringPanel();
        }
    };

    const resetScoringPanel = () => {
        setDScore(0);
        setSkillScores({});
        setEDeductions([]);
        setNeutralDeductions(0);
    };

    const handleCallAthlete = async () => {
        setIsAthleteCalled(true);
        // Set this athlete as active in Firebase to wake up the E-Panels
        try {
            await update(ref(db), {
                [`competitions/${selectedCompId}/aktifSporcu/${selectedCategory}/${selectedApparatus}`]: selectedAthlete.id
            });
        } catch (e) { console.error("Could not set active athlete", e); }
    };

    const addEDeduction = (val) => {
        setEDeductions(prev => [...prev, val]);
    };

    const removeLastEDeduction = () => {
        setEDeductions(prev => {
            const newArr = [...prev];
            newArr.pop();
            return newArr;
        });
    };

    const clearEDeductions = () => {
        if (window.confirm("Tüm E (Uygulama) kesintilerini sıfırlamak istiyor musunuz?")) {
            setEDeductions([]);
        }
    };

    const handleSubmitScore = async () => {
        if (!selectedAthlete) return alert("Lütfen puanlamak için bir sporcu seçin.");

        const confirmMsg = `${selectedAthlete.ad} ${selectedAthlete.soyad} için Final Puanı: ${finalScore} kaydedilecek. Emin misiniz?`;
        if (!window.confirm(confirmMsg)) return;

        setIsSubmitting(true);
        try {
            const scorePath = `competitions/${selectedCompId}/puanlar/${selectedCategory}/${selectedApparatus}/${selectedAthlete.id}`;
            const activePath = `competitions/${selectedCompId}/aktifSporcu/${selectedCategory}/${selectedApparatus}`;
            const flashPath = `competitions/${selectedCompId}/flashTrigger`;
            const ts = new Date().toISOString();

            await update(ref(db), {
                [scorePath + '/calc_D']: calculatedDScore,
                [scorePath + '/eDeductionsList']: eDeductions,
                [scorePath + '/calc_E']: currentEScore,
                [scorePath + '/calc_MissingPen']: missingPenalty > 0 ? missingPenalty : parseFloat(neutralDeductions) || 0,
                [scorePath + '/neutralDeductions']: parseFloat(neutralDeductions) || 0,
                [scorePath + '/sonuc']: parseFloat(finalScore),
                [scorePath + '/timestamp']: ts,
                [scorePath + '/durum']: "tamamlandi",
                [scorePath + '/hareketler']: skillScores,
                [activePath]: null, // Clear active athlete to put E-panels to sleep
                [flashPath]: {
                    adSoyad: `${selectedAthlete.ad} ${selectedAthlete.soyad}`,
                    kulup: selectedAthlete.okul || selectedAthlete.kulup,
                    aletAd: apparatusOptions.find(a => a.id === selectedApparatus)?.name || selectedApparatus,
                    d: calculatedDScore,
                    e: currentEScore,
                    pen: missingPenalty > 0 ? missingPenalty : parseFloat(neutralDeductions) || 0,
                    total: finalScore,
                    timestamp: Date.now()
                }
            });

            // Keep athlete selected to view final state, but indicate save success
            // setSelectedAthlete(null);
            // setIsAthleteCalled(false);
            // resetScoringPanel();

            // Optionally blink the screen or show a brief success message
        } catch (error) {
            console.error(error);
            alert("Puan kaydedilirken bir hata oluştu.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="scoring-page dark-vibrant-theme">
            <header className="scoring-header neon-border">
                <div className="sh-left">
                    <button className="back-btn neon-glow" onClick={() => navigate('/')}>
                        <i className="material-icons-round">home</i>
                    </button>
                    <div>
                        <h1>HAKEM PUANLAMA TERMİNALİ</h1>
                        <p className="subtitle text-cyber">Canlı Veri Giriş Sistemi</p>
                    </div>
                </div>
                {selectedAthlete && isAthleteCalled && (
                    <div className="live-indicator">
                        <div className="pulse-dot"></div>
                        <span>CANLI PUANLAMA</span>
                    </div>
                )}
            </header>

            <div className="scoring-layout">
                {/* Left Sidebar: Controls & Roster */}
                <aside className="scoring-sidebar neon-panel">
                    <div className="sidebar-controls">
                        <select className="score-select cyber-input" value={selectedCompId} onChange={e => { setSelectedCompId(e.target.value); setSelectedCategory(''); setSelectedApparatus(''); setSelectedAthlete(null); }}>
                            <option value="">Yarışma Seçin</option>
                            {compOptions.map(([id, comp]) => <option key={id} value={id}>{comp.isim}</option>)}
                        </select>
                        <select className="score-select cyber-input" value={selectedCategory} onChange={e => { setSelectedCategory(e.target.value); setSelectedApparatus(''); setSelectedAthlete(null); }} disabled={!selectedCompId}>
                            <option value="">Kategori Seçin</option>
                            {categoryOptions.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                        <select className="score-select cyber-input" value={selectedApparatus} onChange={e => { setSelectedApparatus(e.target.value); setSelectedAthlete(null); }} disabled={!selectedCategory}>
                            <option value="">Alet Seçin</option>
                            {apparatusOptions.map(app => <option key={app.id} value={app.id}>{app.name}</option>)}
                        </select>
                    </div>

                    <div className="roster-container">
                        {!selectedApparatus ? (
                            <div className="roster-empty">
                                <i className="material-icons-round">touch_app</i>
                                <p>Lütfen puanlanacak yarışma, kategori ve aleti seçin.</p>
                            </div>
                        ) : (
                            <div className="roster-list">
                                <h3 className="section-title text-cyber">ÇIKIŞ SIRASI (ROTASYONLAR)</h3>
                                {athletesByRotation.length === 0 && <p className="text-muted">Bu kategori için çıkış sırası bulunamadı.</p>}

                                {athletesByRotation.map((rotation, rIdx) => (
                                    rotation.length > 0 && (
                                        <div key={rIdx} className="roster-group">
                                            <div className="rg-title">Rotasyon {rIdx + 1}</div>
                                            {rotation.map(ath => {
                                                const isSelected = selectedAthlete?.id === ath.id;
                                                const scoreData = existingScores[ath.id];
                                                const hasScore = scoreData && (scoreData.sonuc !== undefined || scoreData.finalScore !== undefined || scoreData.durum === 'tamamlandi');
                                                const finalDisplay = scoreData ? parseFloat(scoreData.sonuc ?? scoreData.finalScore ?? 0).toFixed(3) : "0.000";

                                                return (
                                                    <div
                                                        key={ath.id}
                                                        className={`roster-athlete ${isSelected ? 'selected' : ''} ${hasScore ? 'scored' : ''}`}
                                                        onClick={() => handleSelectAthlete(ath)}
                                                    >
                                                        <div className="ra-info">
                                                            <span className="ra-order">{ath.sirasi || ath.cikisSirasi}.</span>
                                                            <span className="ra-name">{ath.ad} {ath.soyad}</span>
                                                        </div>
                                                        {hasScore ? (
                                                            <div className="ra-score-badge success-glow">
                                                                {finalDisplay}
                                                            </div>
                                                        ) : (
                                                            <div className="ra-status-badge pending">Bekliyor</div>
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

                {/* Right Area: Active Scoring Panel */}
                <main className="scoring-main terminal-bg">
                    {!selectedAthlete ? (
                        <div className="main-empty">
                            <div className="me-icon cyber-pulse"><i className="material-icons-round">sensors</i></div>
                            <h2>SİSTEM HAZIR</h2>
                            <p>Puanlamaya başlamak için sol taraftaki listeden sıradaki sporcuyu seçin.</p>
                        </div>
                    ) : !isAthleteCalled ? (
                        /* CALL ATHLETE STATE */
                        <div className="call-athlete-view animate-zoom-in">
                            <div className="ca-athlete-card">
                                <h3>SIRADAKİ SPORCU</h3>
                                <h1>{selectedAthlete.ad} {selectedAthlete.soyad}</h1>
                                <p className="ca-club">{selectedAthlete.okul || selectedAthlete.kulup || '{Kulüp Bilgisi Yok}'}</p>
                                <div className="ca-meta">
                                    <span className="ca-badge">Sıra: {selectedAthlete.sirasi || selectedAthlete.cikisSirasi}</span>
                                    <span className="ca-badge">Alet: {apparatusOptions.find(a => a.id === selectedApparatus)?.name}</span>
                                </div>
                            </div>
                            <button className="btn-massive-call pulse-glow" onClick={handleCallAthlete}>
                                <i className="material-icons-round">campaign</i>
                                SPORCUYU ÇAĞIR VE PUANLA
                            </button>
                        </div>
                    ) : (
                        /* ACTIVE SCORING STATE */
                        <div className="active-scoring-panel animate-slide-up">

                            <div className="active-athlete-header floating-panel">
                                <div className="aah-avatar cyber-gradient">{selectedAthlete.ad.charAt(0)}{selectedAthlete.soyad.charAt(0)}</div>
                                <div className="aah-details">
                                    <h2>{selectedAthlete.ad} {selectedAthlete.soyad}</h2>
                                    <p className="text-cyber">{selectedAthlete.okul || selectedAthlete.kulup} • Alet: {apparatusOptions.find(a => a.id === selectedApparatus)?.name}</p>
                                </div>
                                {existingScores[selectedAthlete.id] && (
                                    <div className="aah-status score-override-warning">
                                        <i className="material-icons-round">warning</i> Önceki Puan Değiştiriliyor
                                    </div>
                                )}
                            </div>

                            <div className="scoring-grid">
                                {/* D-Score Panel - NEON BLUE */}
                                <div className="score-card d-panel neon-border-blue">
                                    <div className="sc-header bg-dark-blue">
                                        <h3>D-PUANI (ZORLUK)</h3>
                                        <i className="material-icons-round text-neon-blue">emoji_events</i>
                                    </div>
                                    <div className="sc-body">
                                        {hasDynamicSkills ? (
                                            <div className="dynamic-skills-list">
                                                {currentCriteria.hareketler.map(skill => {
                                                    const dVals = String(skill.dValues).split(',').map(v => v.trim()).filter(v => v !== '');
                                                    return (
                                                        <div key={skill.id} className="skill-row cyber-input">
                                                            <div className="skill-name">{skill.isim || 'Hareket'}</div>
                                                            <div className="skill-btn-group">
                                                                <button
                                                                    className={`skill-val-btn ${(!skillScores[skill.id] || skillScores[skill.id] == 0) ? 'selected' : ''}`}
                                                                    onClick={() => setSkillScores(prev => ({ ...prev, [skill.id]: 0 }))}
                                                                >
                                                                    0.0
                                                                </button>
                                                                {dVals.map(v => (
                                                                    <button
                                                                        key={v}
                                                                        className={`skill-val-btn ${skillScores[skill.id] == v ? 'selected' : ''}`}
                                                                        onClick={() => setSkillScores(prev => ({ ...prev, [skill.id]: v }))}
                                                                    >
                                                                        {v}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                <div className="dynamic-score-display text-neon-blue">
                                                    TOPLAM D: {calculatedDScore.toFixed(2)}
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="d-input-wrapper">
                                                    <input
                                                        type="number"
                                                        step="0.1"
                                                        min="0"
                                                        value={dScore}
                                                        onChange={e => setDScore(e.target.value)}
                                                        className="giant-num-input input-neon-blue"
                                                    />
                                                </div>
                                                <div className="quick-d-buttons">
                                                    {[2.0, 2.5, 3.0, 3.5, 4.0, 4.5].map(val => (
                                                        <button key={val} className="btn-quick-val cyber-btn-blue" onClick={() => setDScore(val)}>
                                                            {val.toFixed(1)}
                                                        </button>
                                                    ))}
                                                    <button className="btn-quick-val clear-btn" onClick={() => setDScore(0)}>Sıfırla</button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* E-Score Panel - NEON GREEN (Collaborative) */}
                                <div className="score-card e-panel neon-border-green">
                                    <div className="sc-header bg-dark-green">
                                        <h3>E-PUANI YÖNETİMİ</h3>
                                    </div>
                                    <div className="sc-body e-panel-body">
                                        <div className="collaborative-panels">
                                            {ePanels.map(panelId => {
                                                const rawVal = activeScores[panelId];
                                                const hasVal = rawVal !== undefined && rawVal !== null && rawVal !== '';
                                                return (
                                                    <div key={panelId} className={`ref-panel-status ${hasVal ? 'status-ready' : 'status-waiting'}`}>
                                                        <div className="rp-name">{panelId.toUpperCase()}</div>
                                                        <div className="rp-val">{hasVal ? `-${rawVal}` : 'Bekliyor...'}</div>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        <div className="e-summary cyber-summary">
                                            <span className="sum-label">Ort. Kesinti: <strong className="text-neon-orange">-{avgEDeduction.toFixed(2)}</strong></span>
                                            <span className="sum-label">Net E-Puanı: <strong className="text-neon-green">{currentEScore.toFixed(3)}</strong></span>
                                        </div>

                                        <div className="local-override-section">
                                            <p className="local-title">Lokal Manuel Giriş (Opsiyonel)</p>
                                            <div className="deduction-log led-display small-led">
                                                {eDeductions.length === 0 ? (
                                                    <span className="text-muted blink-cursor">_Fallback_Modu</span>
                                                ) : (
                                                    eDeductions.map((d, i) => (
                                                        <span key={i} className="deduction-pill tech-pill">-{d}</span>
                                                    ))
                                                )}
                                            </div>
                                            <div className="huge-deduction-buttons mini">
                                                <button className="btn-deduct hover-glow-red" onClick={() => addEDeduction(0.1)}>-0.1</button>
                                                <button className="btn-deduct hover-glow-red" onClick={() => addEDeduction(0.3)}>-0.3</button>
                                                <button className="btn-icon hover-glow-orange" onClick={removeLastEDeduction} title="Geri Al"><i className="material-icons-round">undo</i></button>
                                                <button className="btn-icon hover-glow-orange" onClick={clearEDeductions} title="Sıfırla"><i className="material-icons-round">delete_sweep</i></button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Neutral Deductions - NEON ORANGE */}
                                <div className="score-card nd-panel span-full neon-border-orange">
                                    <div className="sc-header bg-dark-orange">
                                        <h3>NÖTR KESİNTİLER (Çizgi, Süre vb.)</h3>
                                    </div>
                                    <div className="sc-body horizontal">
                                        <input
                                            type="number"
                                            step="0.1"
                                            min="0"
                                            value={neutralDeductions}
                                            onChange={e => setNeutralDeductions(e.target.value)}
                                            className="med-num-input input-neon-orange"
                                        />
                                        <div className="nd-quick">
                                            <button className="btn-cyber-outline orange" onClick={() => setNeutralDeductions(prev => (parseFloat(prev || 0) + 0.1).toFixed(1))}>+0.1</button>
                                            <button className="btn-cyber-outline orange" onClick={() => setNeutralDeductions(prev => (parseFloat(prev || 0) + 0.3).toFixed(1))}>+0.3</button>
                                            <button className="btn-cyber-outline gray" onClick={() => setNeutralDeductions(0)}>Sıfırla</button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="final-score-bar ultra-glow">
                                <div className="fs-calc">
                                    <span className="fs-part bg-cyber-blue">D: {calculatedDScore.toFixed(3)}</span>
                                    <span className="fs-math">+</span>
                                    <span className="fs-part bg-cyber-green">E: {currentEScore.toFixed(3)}</span>
                                    {totalNeutral > 0 && (
                                        <>
                                            <span className="fs-math">-</span>
                                            <span className="fs-part bg-cyber-orange">ND: {totalNeutral.toFixed(3)}</span>
                                        </>
                                    )}
                                    <span className="fs-math">=</span>
                                </div>
                                <div className="fs-total text-hero">
                                    {finalScore}
                                </div>
                                <button
                                    className="btn-submit-score shadow-massive cyber-save"
                                    onClick={handleSubmitScore}
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? <div className="spinner-small"></div> : <i className="material-icons-round">publish</i>}
                                    <span>PUANI KAYDET</span>
                                </button>
                            </div>

                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
