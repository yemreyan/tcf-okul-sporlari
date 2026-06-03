/**
 * RitmikClassicLayout — Masaüstü tablo/panel tasarımı
 * Ekran görüntüsündeki D/A/E/Kesintiler yapısını birebir kurgular.
 */
import { useState, useEffect } from 'react';
import { useOffline } from '../lib/OfflineContext';
import { useDiscipline } from '../lib/DisciplineContext';
import { DA_GAP_THRESHOLD, DB_GAP_THRESHOLD } from '../hooks/useRitmikScoring';
import './RitmikClassicLayout.css';

export default function RitmikClassicLayout({ s, onSwitchLayout }) {
    const { offlineWrite } = useOffline();
    const { firebasePath } = useDiscipline();

    const {
        navigate,
        selectedCity, setSelectedCity,
        selectedCompId, setSelectedCompId,
        selectedCategory, setSelectedCategory,
        athletesByRotation, existingScores,
        selectedAthlete, isAthleteCalled,
        selectedAlet,
        // A/E panel
        aPanelLocal, setAPanelLocal,
        ePanelLocal, setEPanelLocal,
        // Classic D
        classicDA, setClassicDA,
        classicDB, setClassicDB,
        classicDaScore, classicDbScore, classicDTotal,
        daGap, daGapOk, daGapLevel,
        dbGap, dbGapOk, dbGapLevel,
        // Classic A/E
        sjaInput, setSjaInput,
        sjeInput, setSjeInput,
        classicAResult, classicEResult,
        // Classic penalty
        classicPenalty, setClassicPenalty,
        cKoord, cCizgi1, cCizgi2, cZaman, classicTotalPenalty,
        // Final
        classicFinalScore,
        // Lock
        scoreLocked,
        unlockModal, setUnlockModal,
        unlockPassword, setUnlockPassword,
        unlockError,
        unlockingInProgress,
        scoringFieldsTouched, setScoringFieldsTouched,
        isSubmitting, confirmModal, setConfirmModal,
        successModal, setSuccessModal,
        // Derived
        judgeCount,
        availableCities, compOptions, categoryOptions,
        // Handlers
        resetPanel,
        handleSelectAthlete, handleSelectAlet,
        handleCallAthlete,
        handleClassicSubmit,
        handleConfirmSubmit, handleUnlock,
        refreshScores,
        writeFieldOverride, clearFieldOverride,
        transferToOtherAlet,
        getAthleteStatus, getAletStatus,
        RITMIK_CATEGORIES, RITMIK_ALETLER,
        availableAletler,
        hasDA,
    } = s;

    // ── Per-field unlock: skor kilitliyken bile "X SİL" ile sadece o alan açılır ──
    const [unlockedFields, setUnlockedFields] = useState(new Set());
    const unlock = (key) => setUnlockedFields(s => { const n = new Set(s); n.add(key); return n; });
    const isLocked = (key) => scoreLocked && !unlockedFields.has(key);
    const hasUnlocked = unlockedFields.size > 0;
    // Sporcu/alet değişince veya skor durumunu yeniden yüklerken unlock'ları temizle
    useEffect(() => {
        setUnlockedFields(new Set());
    }, [selectedAthlete?.id, selectedAlet]);

    // ── SİL yardımcıları (her biri kendi field-key'ini unlock eder) ──
    // Penalty alan adları (Firebase'deki anahtar)
    const PENALTY_FB = { koordinator: 'penaltyKoordinatör', cizgi1: 'penaltyCizgi1', cizgi2: 'penaltyCizgi2', zaman: 'penaltyZaman' };
    const silDA   = () => { setClassicDA(p => ({ ...p, da: '' }));   unlock('da');   setScoringFieldsTouched(true); clearFieldOverride('da');   clearFieldOverride('daScore'); };
    const silDA1  = () => { setClassicDA(p => ({ ...p, da1: '' })); unlock('da1');  setScoringFieldsTouched(true); clearFieldOverride('da1'); };
    const silDA2  = () => { setClassicDA(p => ({ ...p, da2: '' })); unlock('da2');  setScoringFieldsTouched(true); clearFieldOverride('da2'); };
    const silSJDA = () => { setClassicDA(p => ({ ...p, sjda: '' })); unlock('sjda'); setScoringFieldsTouched(true); clearFieldOverride('sjda'); };
    const silDB   = () => { setClassicDB(p => ({ ...p, db: '' }));   unlock('db');   setScoringFieldsTouched(true); clearFieldOverride('db');   clearFieldOverride('dbScore'); };
    const silDB1  = () => { setClassicDB(p => ({ ...p, db1: '' })); unlock('db1');  setScoringFieldsTouched(true); clearFieldOverride('db1'); };
    const silDB2  = () => { setClassicDB(p => ({ ...p, db2: '' })); unlock('db2');  setScoringFieldsTouched(true); clearFieldOverride('db2'); };
    const silSJDB = () => { setClassicDB(p => ({ ...p, sjdb: '' })); unlock('sjdb'); setScoringFieldsTouched(true); clearFieldOverride('sjdb'); };
    const silA = (k) => { setAPanelLocal(p => { const n = { ...p }; delete n[k]; return n; }); unlock(`a_${k}`); setScoringFieldsTouched(true); clearFieldOverride(`aPanel.${k}`); };
    const silE = (k) => { setEPanelLocal(p => { const n = { ...p }; delete n[k]; return n; }); unlock(`e_${k}`); setScoringFieldsTouched(true); clearFieldOverride(`ePanel.${k}`); };
    const silSJA = () => { setSjaInput(''); unlock('sja'); setScoringFieldsTouched(true); clearFieldOverride('sja'); };
    const silSJE = () => { setSjeInput(''); unlock('sje'); setScoringFieldsTouched(true); clearFieldOverride('sje'); };
    const silKes = (k) => { setClassicPenalty(p => ({ ...p, [k]: '' })); unlock(`pen_${k}`); setScoringFieldsTouched(true); clearFieldOverride(PENALTY_FB[k]); };

    // Submit sonrası unlock'ları temizle
    const handleSubmitAndReset = async () => {
        await handleClassicSubmit();
        setUnlockedFields(new Set());
    };

    const fmt = (v, def = '0.000') => v != null && v !== '' && !isNaN(parseFloat(v))
        ? parseFloat(v).toFixed(3) : def;

    // SİL satırı verisi — serbest seride DA satırları yok
    const silRowD = [
        ...(hasDA ? [
            { label: 'DA SİL (Kesin)',  val: fmt(classicDA.da),    action: () => { silDA(); } },
            { label: 'DA1 SİL (Bilgi)', val: fmt(classicDA.da1),   action: silDA1 },
            { label: 'DA2 SİL (Bilgi)', val: fmt(classicDA.da2),   action: silDA2 },
            { label: 'SJDA SİL (Bilgi)',val: fmt(classicDA.sjda),  action: silSJDA },
        ] : []),
        { label: 'DB SİL (Kesin)',  val: fmt(classicDB.db),    action: () => { silDB(); } },
        { label: 'DB1 SİL (Bilgi)', val: fmt(classicDB.db1),   action: silDB1 },
        { label: 'DB2 SİL (Bilgi)', val: fmt(classicDB.db2),   action: silDB2 },
        { label: 'SJDB SİL (Bilgi)',val: fmt(classicDB.sjdb),  action: silSJDB },
        { label: 'ÇİZGİ 1 SİL', val: fmt(classicPenalty.cizgi1), action: () => silKes('cizgi1') },
        { label: 'ÇİZGİ 2 SİL', val: fmt(classicPenalty.cizgi2), action: () => silKes('cizgi2') },
        { label: 'ZAMAN SİL',   val: fmt(classicPenalty.zaman),   action: () => silKes('zaman') },
    ];

    const silRowAE = [
        ...Array.from({ length: judgeCount }, (_, i) => ({
            label: `E${i + 1} SİL`, val: fmt(ePanelLocal[`j${i + 1}`]),
            action: () => silE(`j${i + 1}`),
        })),
        { label: 'SJE SİL', val: fmt(sjeInput), action: silSJE },
        ...Array.from({ length: judgeCount }, (_, i) => ({
            label: `A${i + 1} SİL`, val: fmt(aPanelLocal[`j${i + 1}`]),
            action: () => silA(`j${i + 1}`),
        })),
        { label: 'SJA SİL', val: fmt(sjaInput), action: silSJA },
    ];

    // Alet durumu
    const aletStatus = (key) => selectedAthlete ? getAletStatus(selectedAthlete, key) : 'bekliyor';

    // Tam sporcu adı
    const athleteName = (ath) => ath
        ? (ath.soyad ? `${ath.soyad} ${ath.ad || ''}` : ath.name || ath.ad || 'İsimsiz')
        : '';

    return (
        <div className="cl-page">

            {/* ── Üst Bar ── */}
            <div className="cl-topbar">
                <button className="cl-back-btn" onClick={() => navigate('/ritmik')}>
                    <i className="material-icons-round" style={{ fontSize: 14 }}>arrow_back</i>
                    GERİ
                </button>
                <span className="cl-topbar-title">RİTMİK PUANLAMA</span>
                <div className="cl-topbar-filters">
                    <select value={selectedCity}
                        onChange={e => { setSelectedCity(e.target.value); setSelectedCompId(''); setSelectedCategory(''); }}>
                        <option value="">Tüm İller</option>
                        {availableCities.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select value={selectedCompId}
                        onChange={e => { setSelectedCompId(e.target.value); setSelectedCategory(''); }}>
                        <option value="">Yarışma Seçin</option>
                        {compOptions.map(([id, comp]) => (
                            <option key={id} value={id}>{comp.isim || comp.name || id}</option>
                        ))}
                    </select>
                    <select value={selectedCategory}
                        onChange={e => { setSelectedCategory(e.target.value); resetPanel(); }}>
                        <option value="">Kategori Seçin</option>
                        {categoryOptions.map(c => (
                            <option key={c} value={c}>{RITMIK_CATEGORIES[c]?.label || c}</option>
                        ))}
                    </select>
                </div>
                <div className="cl-topbar-right">
                    <button className="cl-layout-switch" onClick={onSwitchLayout} title="Modern kart tasarımına geç">
                        <i className="material-icons-round" style={{ fontSize: 14 }}>view_agenda</i>
                        Modern
                    </button>
                </div>
            </div>

            {/* ── Alet Sekmeleri — sadece bu kategorinin aletleri ── */}
            {selectedAthlete && (
                <div className="cl-alet-bar">
                    {(availableAletler || Object.keys(RITMIK_ALETLER))
                        .map(k => RITMIK_ALETLER[k])
                        .filter(Boolean)
                        .map(alet => {
                        const st = aletStatus(alet.key);
                        return (
                            <button
                                key={alet.key}
                                className={`cl-alet-tab${selectedAlet === alet.key ? ' active' : ''}`}
                                onClick={() => handleSelectAlet(alet.key)}
                            >
                                <span className={`status-dot${st === 'tamamlandi' || st === 'kilitli' ? ` ${st === 'kilitli' ? 'locked' : 'done'}` : ''}`} />
                                <i className="material-icons-round" style={{ fontSize: 14 }}>{alet.icon}</i>
                                {alet.label.toLocaleUpperCase('tr-TR')}
                                {st === 'tamamlandi' && <i className="material-icons-round" style={{ fontSize: 12, color: '#1a7a1a', marginLeft: 4 }}>check_circle</i>}
                                {st === 'kilitli'    && <i className="material-icons-round" style={{ fontSize: 12, color: '#555', marginLeft: 4 }}>lock</i>}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* ── Sporcu Başlık ── */}
            {selectedAthlete ? (
                <div className="cl-athlete-bar">
                    <div>
                        <div className="cl-athlete-bar-name">{athleteName(selectedAthlete)}</div>
                        <div className="cl-athlete-bar-meta">
                            {selectedAthlete.okul && `${selectedAthlete.okul} · `}
                            {selectedAthlete.il && `${selectedAthlete.il} · `}
                            {RITMIK_CATEGORIES[selectedCategory]?.label || selectedCategory}
                            {' · '}
                            <strong>ID: {selectedAthlete.id}</strong>
                        </div>
                    </div>
                    <div className="cl-athlete-bar-actions">
                        {!isAthleteCalled ? (
                            <button className="cl-btn cl-btn--call" onClick={handleCallAthlete}>
                                <i className="material-icons-round" style={{ fontSize: 13 }}>campaign</i> Sporcu Çağır
                            </button>
                        ) : (
                            <span className="cl-called-badge">
                                <i className="material-icons-round" style={{ fontSize: 13 }}>campaign</i> Çağrıldı
                            </span>
                        )}
                        {/* Yanlış alet seçildiyse → diğer alete tüm notları taşı */}
                        {!scoreLocked && existingScores[selectedAthlete.id]?.[selectedAlet] && (
                            <button
                                className="cl-btn cl-btn--transfer"
                                style={{
                                    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                                    color: '#fff', border: 'none',
                                    padding: '0.4rem 0.85rem', borderRadius: '0.4rem',
                                    fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer',
                                    display: 'inline-flex', alignItems: 'center', gap: 4,
                                }}
                                onClick={() => {
                                    const otherAlet = selectedAlet === 'top' ? 'kurdele' : 'top';
                                    const otherLabel = RITMIK_ALETLER[otherAlet]?.label || otherAlet;
                                    const currentLabel = RITMIK_ALETLER[selectedAlet]?.label || selectedAlet;
                                    if (window.confirm(`Tüm notlar "${currentLabel}" → "${otherLabel}" aletine taşınsın mı?\n\n${currentLabel} aleti boşalacak ve sporcu o alette yarışmamış sayılacak.`)) {
                                        transferToOtherAlet();
                                    }
                                }}
                                title="Yanlış alet seçildiyse, tüm notları diğer alete taşı"
                            >
                                <i className="material-icons-round" style={{ fontSize: 14 }}>swap_horiz</i>
                                Diğer Alete Taşı
                            </button>
                        )}
                        {scoreLocked ? (
                            <button className="cl-btn cl-btn--unlock"
                                onClick={() => setUnlockModal({ athleteId: selectedAthlete.id, aletKey: selectedAlet })}>
                                <i className="material-icons-round" style={{ fontSize: 13 }}>lock</i> Kilitli
                            </button>
                        ) : existingScores[selectedAthlete.id]?.[selectedAlet] ? (
                            <button className="cl-btn cl-btn--lock" onClick={async () => {
                                await offlineWrite({
                                    [`${firebasePath}/${selectedCompId}/puanlar/${selectedCategory}/${selectedAthlete.id}/${selectedAlet}/kilitli`]: true
                                });
                            }}>
                                <i className="material-icons-round" style={{ fontSize: 13 }}>lock_open</i> Kilitle
                            </button>
                        ) : null}
                    </div>
                </div>
            ) : (
                !selectedCategory && (
                    <div className="cl-empty">
                        <i className="material-icons-round">self_improvement</i>
                        <p>Yarışma ve kategori seçtikten sonra sağdaki listeden sporcu seçin.</p>
                    </div>
                )
            )}

            {scoreLocked && selectedAthlete && (
                <div className="cl-summary-card">
                    <div className="cl-summary-header">
                        <i className="material-icons-round cl-summary-icon">verified</i>
                        <div className="cl-summary-titles">
                            <div className="cl-summary-athlete">{athleteName(selectedAthlete)}</div>
                            <div className="cl-summary-meta">
                                {RITMIK_ALETLER[selectedAlet]?.label?.toLocaleUpperCase('tr-TR')} · {RITMIK_CATEGORIES[selectedCategory]?.label || selectedCategory}
                            </div>
                        </div>
                        <div className="cl-summary-total">
                            <label>TOPLAM</label>
                            <span>{classicFinalScore}</span>
                        </div>
                    </div>
                    <div className="cl-summary-grid">
                        {hasDA && (
                        <div className="cl-summary-cell cl-summary-cell--da">
                            <label>DA KESİN</label>
                            <span>{fmt(classicDaScore)}</span>
                        </div>
                        )}
                        <div className="cl-summary-cell cl-summary-cell--db">
                            <label>DB KESİN</label>
                            <span>{fmt(classicDbScore)}</span>
                        </div>
                        <div className="cl-summary-cell cl-summary-cell--a">
                            <label>A KESİNTİ ORT.</label>
                            <span>{classicAResult.trimmedAvg.toFixed(3)}</span>
                        </div>
                        <div className="cl-summary-cell cl-summary-cell--e">
                            <label>E KESİNTİ ORT.</label>
                            <span>{classicEResult.trimmedAvg.toFixed(3)}</span>
                        </div>
                        {classicTotalPenalty > 0 && (
                            <div className="cl-summary-cell cl-summary-cell--pen">
                                <label>CEZA</label>
                                <span>−{classicTotalPenalty.toFixed(3)}</span>
                            </div>
                        )}
                    </div>
                    <div className="cl-summary-footer">
                        <i className="material-icons-round" style={{ fontSize: 14 }}>info</i>
                        <span>Puan ilan edildi · Sonraki sporcu çağrılana kadar gösterilir · Kilidi açmak için yukarıdaki "DÜZENLE" butonunu kullanın</span>
                    </div>
                </div>
            )}

            {/* ── SİL Butonları ── */}
            {selectedAthlete && (
                <div className="cl-sil-section">
                    <div className="cl-sil-row">
                        {silRowD.map((item, i) => (
                            <div key={i} className="cl-sil-cell">
                                <button className="cl-sil-btn" onClick={item.action}
                                    title={scoreLocked ? 'Tıkla → bu alanı düzenlemeye aç' : 'Alanı temizle'}>
                                    {item.label}
                                </button>
                                <span className="cl-sil-val">{item.val}</span>
                            </div>
                        ))}
                    </div>
                    <div className="cl-sil-row">
                        {silRowAE.map((item, i) => (
                            <div key={i} className="cl-sil-cell">
                                <button className="cl-sil-btn" onClick={item.action}
                                    title={scoreLocked ? 'Tıkla → bu alanı düzenlemeye aç' : 'Alanı temizle'}>
                                    {item.label}
                                </button>
                                <span className="cl-sil-val">{item.val}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Ana Alan ── */}
            {selectedCategory && (
                <>
                <div className="cl-scoring-area">
                    {/* Sol: Paneller veya boş mesaj */}
                    <div className="cl-panels-col">
                    {selectedAthlete ? (<>

                            {/* Üst sıra: D Panel + A Panel */}
                            <div className="cl-panels-row">

                                {/* D PANELİ */}
                                <div className="cl-panel cl-panel--d">
                                    <div className="cl-panel-title">D PANELİ</div>
                                    <div className="cl-panel-body">

                                        {/* ── DA tarafı — serbest seride (Minik B Kız) yok ── */}
                                        {hasDA && (<>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: '#555', minWidth: 32 }}>DA</span>
                                            <span style={{ fontSize: 9, color: '#888', fontStyle: 'italic' }}>(DA1 hakemi kesin skor)</span>
                                        </div>
                                        <div className="cl-d-grid" style={{ marginBottom: 6 }}>
                                            {/* DA — kesin skor input (hesaba katılan) */}
                                            <div className="cl-d-cell" style={{ gridColumn: '1 / -1' }}>
                                                <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--cl-d-border)' }}>DA ★ Kesin</label>
                                                <input type="number" min="0" step="0.1" placeholder="0.0"
                                                    style={{ fontWeight: 800, fontSize: 15, borderColor: 'var(--cl-d-border)', borderWidth: 2 }}
                                                    value={classicDA.da} disabled={isLocked('da')}
                                                    onChange={e => { setClassicDA(p => ({ ...p, da: e.target.value })); setScoringFieldsTouched(true); }} />
                                            </div>
                                            {/* DA1, DA2 — bilgi amaçlı */}
                                            <div className="cl-d-cell">
                                                <label style={{ fontSize: 10, color: '#888' }}>DA1 <span style={{ fontSize: 8, color: '#aaa' }}>(bilgi)</span></label>
                                                <input type="number" min="0" step="0.1" placeholder="0.0"
                                                    style={{ opacity: 0.75 }}
                                                    value={classicDA.da1} disabled={isLocked('da1')}
                                                    onChange={e => { setClassicDA(p => ({ ...p, da1: e.target.value })); setScoringFieldsTouched(true); }} />
                                            </div>
                                            <div className="cl-d-cell">
                                                <label style={{ fontSize: 10, color: '#888' }}>DA2 <span style={{ fontSize: 8, color: '#aaa' }}>(bilgi)</span></label>
                                                <input type="number" min="0" step="0.1" placeholder="0.0"
                                                    style={{ opacity: 0.75 }}
                                                    value={classicDA.da2} disabled={isLocked('da2')}
                                                    onChange={e => { setClassicDA(p => ({ ...p, da2: e.target.value })); setScoringFieldsTouched(true); }} />
                                            </div>
                                            {/* SJDA — bilgi amaçlı */}
                                            <div className="cl-d-cell">
                                                <label style={{ fontSize: 10, color: '#888' }}>SJDA <span style={{ fontSize: 8, color: '#aaa' }}>(bilgi)</span></label>
                                                <input type="number" min="0" step="0.1" placeholder="0.0"
                                                    style={{ opacity: 0.75, width: 72 }}
                                                    value={classicDA.sjda} disabled={isLocked('sjda')}
                                                    onChange={e => { setClassicDA(p => ({ ...p, sjda: e.target.value })); setScoringFieldsTouched(true); }} />
                                            </div>
                                            {/* GAP DA — DA kesin ↔ SJDA (3 seviyeli renk) */}
                                            <div className="cl-d-cell">
                                                <label style={{ fontSize: 10, color: '#888' }}>GAP DA <span style={{ fontSize: 8, color: '#aaa' }}>(bilgi)</span></label>
                                                <div className="cl-gap-row" style={{ marginTop: 2 }}>
                                                    <span className={`cl-gap-val ${daGapLevel}`} style={{ fontSize: 12 }}>{daGap.toFixed(3)}</span>
                                                    <i className={`material-icons-round cl-gap-check ${daGapLevel}`} style={{ fontSize: 13 }}>
                                                        {daGapLevel === 'ok' ? 'check_circle' : daGapLevel === 'warn' ? 'error_outline' : 'warning'}
                                                    </i>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="cl-d-separator" />
                                        </>)}

                                        {/* ── DB tarafı ── */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, marginBottom: 4 }}>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: '#555', minWidth: 32 }}>DB</span>
                                            <span style={{ fontSize: 9, color: '#888', fontStyle: 'italic' }}>(DB1 hakemi kesin skor)</span>
                                        </div>
                                        <div className="cl-d-grid" style={{ marginBottom: 6 }}>
                                            {/* DB — kesin skor input (hesaba katılan) */}
                                            <div className="cl-d-cell" style={{ gridColumn: '1 / -1' }}>
                                                <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--cl-d-border)' }}>DB ★ Kesin</label>
                                                <input type="number" min="0" step="0.1" placeholder="0.0"
                                                    style={{ fontWeight: 800, fontSize: 15, borderColor: 'var(--cl-d-border)', borderWidth: 2 }}
                                                    value={classicDB.db} disabled={isLocked('db')}
                                                    onChange={e => { setClassicDB(p => ({ ...p, db: e.target.value })); setScoringFieldsTouched(true); }} />
                                            </div>
                                            {/* DB1, DB2 — bilgi amaçlı */}
                                            <div className="cl-d-cell">
                                                <label style={{ fontSize: 10, color: '#888' }}>DB1 <span style={{ fontSize: 8, color: '#aaa' }}>(bilgi)</span></label>
                                                <input type="number" min="0" step="0.1" placeholder="0.0"
                                                    style={{ opacity: 0.75 }}
                                                    value={classicDB.db1} disabled={isLocked('db1')}
                                                    onChange={e => { setClassicDB(p => ({ ...p, db1: e.target.value })); setScoringFieldsTouched(true); }} />
                                            </div>
                                            <div className="cl-d-cell">
                                                <label style={{ fontSize: 10, color: '#888' }}>DB2 <span style={{ fontSize: 8, color: '#aaa' }}>(bilgi)</span></label>
                                                <input type="number" min="0" step="0.1" placeholder="0.0"
                                                    style={{ opacity: 0.75 }}
                                                    value={classicDB.db2} disabled={isLocked('db2')}
                                                    onChange={e => { setClassicDB(p => ({ ...p, db2: e.target.value })); setScoringFieldsTouched(true); }} />
                                            </div>
                                            {/* SJDB — bilgi amaçlı */}
                                            <div className="cl-d-cell">
                                                <label style={{ fontSize: 10, color: '#888' }}>SJDB <span style={{ fontSize: 8, color: '#aaa' }}>(bilgi)</span></label>
                                                <input type="number" min="0" step="0.1" placeholder="0.0"
                                                    style={{ opacity: 0.75, width: 72 }}
                                                    value={classicDB.sjdb} disabled={isLocked('sjdb')}
                                                    onChange={e => { setClassicDB(p => ({ ...p, sjdb: e.target.value })); setScoringFieldsTouched(true); }} />
                                            </div>
                                            {/* GAP DB — bilgi */}
                                            <div className="cl-d-cell">
                                                <label style={{ fontSize: 10, color: '#888' }}>GAP DB <span style={{ fontSize: 8, color: '#aaa' }}>(bilgi)</span></label>
                                                <div className="cl-gap-row" style={{ marginTop: 2 }}>
                                                    <span className={`cl-gap-val ${dbGapLevel}`} style={{ fontSize: 12 }}>{dbGap.toFixed(3)}</span>
                                                    <i className={`material-icons-round cl-gap-check ${dbGapLevel}`} style={{ fontSize: 13 }}>
                                                        {dbGapLevel === 'ok' ? 'check_circle' : dbGapLevel === 'warn' ? 'error_outline' : 'warning'}
                                                    </i>
                                                </div>
                                            </div>
                                        </div>

                                        {/* D Toplamı */}
                                        <div className="cl-d-totals">
                                            <div className="cl-d-total-item">
                                                <label>D TOPLAM</label>
                                                <span className="cl-total-val">{classicDTotal.toFixed(3)}</span>
                                            </div>
                                            <div className="cl-d-total-item">
                                                <label style={{ fontSize: 9, color: '#888' }}>DA Kesin</label>
                                                <span className="cl-total-val" style={{ fontSize: 12 }}>{fmt(classicDA.da)}</span>
                                            </div>
                                            <div className="cl-d-total-item">
                                                <label style={{ fontSize: 9, color: '#888' }}>DB Kesin</label>
                                                <span className="cl-total-val" style={{ fontSize: 12 }}>{fmt(classicDB.db)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* A PANELİ */}
                                <div className="cl-panel cl-panel--a">
                                    <div className="cl-panel-title">A PANELİ</div>
                                    <div className="cl-panel-body">
                                        <div className="cl-ae-grid">
                                            {Array.from({ length: judgeCount }, (_, i) => {
                                                const key = `j${i + 1}`;
                                                const val = aPanelLocal[key] ?? '';
                                                const num = parseFloat(val);
                                                return (
                                                    <div key={key} className="cl-ae-cell">
                                                        <label>A{i + 1}</label>
                                                        <input type="number" min="0" max="10" step="0.1" placeholder="0.0"
                                                            value={val} disabled={isLocked(`a_${key}`)}
                                                            onChange={e => { const v = e.target.value; setAPanelLocal(p => ({ ...p, [key]: v })); setScoringFieldsTouched(true); writeFieldOverride(`aPanel.${key}`, v); }} />
                                                        {!isNaN(num) && val !== '' && (
                                                            <span className="cl-ae-result">{(10 - num).toFixed(1)}</span>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                            <div className="cl-ae-separator" />
                                            <div className="cl-ae-cell sj">
                                                <label>SJA <span style={{ fontSize: 8, color: '#aaa', fontWeight: 400 }}>(bilgi)</span></label>
                                                <input type="number" min="0" max="10" step="0.1" placeholder="0.0"
                                                    style={{ opacity: 0.75 }}
                                                    value={sjaInput} disabled={isLocked('sja')}
                                                    onChange={e => { setSjaInput(e.target.value); setScoringFieldsTouched(true); }} />
                                            </div>
                                        </div>
                                        <div className="cl-ae-stats">
                                            <div className="cl-ae-stat">
                                                <label>A Ortalama</label>
                                                <span className="cl-stat-val">{classicAResult.trimmedAvg.toFixed(3)}</span>
                                            </div>
                                            <div className="cl-ae-stat">
                                                <label>GAP</label>
                                                <span className={`cl-stat-val cl-gap-val ${classicAResult.gapLevel}`}>
                                                    {classicAResult.gap.toFixed(3)}
                                                </span>
                                                <i className={`material-icons-round cl-gap-check ${classicAResult.gapLevel}`} style={{ fontSize: 13, marginLeft: 2 }}>
                                                    {classicAResult.gapLevel === 'ok' ? 'check_circle' : classicAResult.gapLevel === 'warn' ? 'error_outline' : 'warning'}
                                                </i>
                                            </div>
                                            <div className="cl-ae-stat result a">
                                                <label>A Sonuç</label>
                                                <span className="cl-stat-val">{classicAResult.score.toFixed(3)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Alt sıra: E Panel + Kesintiler */}
                            <div className="cl-panels-row">

                                {/* E PANELİ */}
                                <div className="cl-panel cl-panel--e">
                                    <div className="cl-panel-title">E PANELİ</div>
                                    <div className="cl-panel-body">
                                        <div className="cl-ae-grid">
                                            {Array.from({ length: judgeCount }, (_, i) => {
                                                const key = `j${i + 1}`;
                                                const val = ePanelLocal[key] ?? '';
                                                const num = parseFloat(val);
                                                return (
                                                    <div key={key} className="cl-ae-cell">
                                                        <label>E{i + 1}</label>
                                                        <input type="number" min="0" max="10" step="0.1" placeholder="0.0"
                                                            value={val} disabled={isLocked(`e_${key}`)}
                                                            onChange={e => { const v = e.target.value; setEPanelLocal(p => ({ ...p, [key]: v })); setScoringFieldsTouched(true); writeFieldOverride(`ePanel.${key}`, v); }} />
                                                        {!isNaN(num) && val !== '' && (
                                                            <span className="cl-ae-result">{(10 - num).toFixed(1)}</span>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                            <div className="cl-ae-separator" />
                                            <div className="cl-ae-cell sj">
                                                <label>SJE <span style={{ fontSize: 8, color: '#aaa', fontWeight: 400 }}>(bilgi)</span></label>
                                                <input type="number" min="0" max="10" step="0.1" placeholder="0.0"
                                                    style={{ opacity: 0.75 }}
                                                    value={sjeInput} disabled={isLocked('sje')}
                                                    onChange={e => { setSjeInput(e.target.value); setScoringFieldsTouched(true); }} />
                                            </div>
                                        </div>
                                        <div className="cl-ae-stats">
                                            <div className="cl-ae-stat">
                                                <label>E Ortalama</label>
                                                <span className="cl-stat-val">{classicEResult.trimmedAvg.toFixed(3)}</span>
                                            </div>
                                            <div className="cl-ae-stat">
                                                <label>GAP</label>
                                                <span className={`cl-stat-val cl-gap-val ${classicEResult.gapLevel}`}>
                                                    {classicEResult.gap.toFixed(3)}
                                                </span>
                                                <i className={`material-icons-round cl-gap-check ${classicEResult.gapLevel}`} style={{ fontSize: 13, marginLeft: 2 }}>
                                                    {classicEResult.gapLevel === 'ok' ? 'check_circle' : classicEResult.gapLevel === 'warn' ? 'error_outline' : 'warning'}
                                                </i>
                                            </div>
                                            <div className="cl-ae-stat result e">
                                                <label>E Sonuç</label>
                                                <span className="cl-stat-val">{classicEResult.score.toFixed(3)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* KESİNTİLER */}
                                <div className="cl-panel cl-panel--k">
                                    <div className="cl-panel-title">KESİNTİLER</div>
                                    <div className="cl-panel-body">
                                        <div className="cl-k-grid">
                                            {[
                                                { key: 'koordinator', label: 'Koordinatör', val: classicPenalty.koordinator },
                                                { key: 'cizgi1',      label: 'Çizgi 1',     val: classicPenalty.cizgi1 },
                                                { key: 'cizgi2',      label: 'Çizgi 2',     val: classicPenalty.cizgi2 },
                                                { key: 'zaman',       label: 'Zaman',       val: classicPenalty.zaman },
                                            ].map(item => (
                                                <div key={item.key} className="cl-k-cell">
                                                    <label>{item.label}</label>
                                                    <input type="number" min="0" step="0.1" placeholder="0.0"
                                                        value={item.val} disabled={isLocked(`pen_${item.key}`)}
                                                        onChange={e => { setClassicPenalty(p => ({ ...p, [item.key]: e.target.value })); setScoringFieldsTouched(true); }} />
                                                </div>
                                            ))}
                                        </div>
                                        <div className="cl-k-total">
                                            <span>Toplam Kesinti</span>
                                            <span className="cl-total-val">{classicTotalPenalty.toFixed(3)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Aksiyon + Güncelle + Refresh */}
                            <div className="cl-action-row">
                                <button
                                    className="cl-btn cl-btn--save"
                                    disabled={(scoreLocked && !hasUnlocked) || isSubmitting}
                                    onClick={handleSubmitAndReset}
                                >
                                    <i className="material-icons-round" style={{ fontSize: 14 }}>save</i>
                                    {isSubmitting ? 'KAYDEDİLİYOR…' : (scoreLocked && hasUnlocked ? `${unlockedFields.size} ALAN GÜNCELLE` : 'GÜNCELLE')}
                                </button>
                                <span className="cl-action-label">PUAN GİRİŞ EKRANI — {RITMIK_ALETLER[selectedAlet]?.label?.toLocaleUpperCase('tr-TR')}</span>
                                {refreshScores && (
                                    <button
                                        type="button"
                                        className="cl-btn cl-btn--refresh"
                                        onClick={refreshScores}
                                        title="Hakem panellerinden gelen son notları zorla çek"
                                    >
                                        <i className="material-icons-round" style={{ fontSize: 14 }}>sync</i>
                                        GÜNCEL VERİLERİ AL
                                    </button>
                                )}
                            </div>
                    </> ) : (
                        /* Sporcu seçilmemişse sol tarafta boş mesaj */
                        <div className="cl-empty">
                            <i className="material-icons-round">person_search</i>
                            <p>Sağdaki listeden bir sporcu seçin.</p>
                        </div>
                    )}
                    </div>{/* /cl-panels-col */}

                    {/* Sağ: Sporcu Listesi — kategori seçili olduğu sürece her zaman görünür */}
                    <div className="cl-athlete-panel">
                        <div className="cl-athlete-panel-title">SPORCU LİSTESİ</div>
                        <div className="cl-athlete-table-wrap">
                        <table className="cl-athlete-table">
                            <thead>
                                <tr>
                                    <th>Sıra</th>
                                    <th>Sporcu</th>
                                    <th>T</th>
                                    <th>K</th>
                                    <th>Sonuç</th>
                                </tr>
                            </thead>
                            <tbody>
                                {athletesByRotation.flat().map((ath, idx) => {
                                    const status = getAthleteStatus(ath);
                                    const topSt  = getAletStatus(ath, 'top');
                                    const kurdSt = getAletStatus(ath, 'kurdele');
                                    const sonuc  = existingScores[ath.id]?.sonuc;
                                    const isActive = selectedAthlete?.id === ath.id;
                                    return (
                                        <tr key={ath.id}
                                            className={`${isActive ? 'active' : ''} ${status}`}
                                            onClick={() => handleSelectAthlete(ath)}
                                            title={ath.okul || ''}
                                        >
                                            <td style={{ textAlign: 'center', fontWeight: 700 }}>{idx + 1}</td>
                                            <td title={ath.okul || ''}>
                                                <div className="cl-athlete-name-cell">
                                                    {ath.soyad ? `${ath.soyad} ${ath.ad || ''}` : (ath.name || ath.ad || '?')}
                                                </div>
                                                {ath.okul && (
                                                    <div className="cl-athlete-school-cell">{ath.okul}</div>
                                                )}
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                {topSt === 'tamamlandi' && '✓'}
                                                {topSt === 'kilitli'    && '🔒'}
                                                {topSt === 'bekliyor'   && '–'}
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                {kurdSt === 'tamamlandi' && '✓'}
                                                {kurdSt === 'kilitli'    && '🔒'}
                                                {kurdSt === 'bekliyor'   && '–'}
                                            </td>
                                            <td style={{ textAlign: 'right', fontWeight: 700 }}>
                                                {sonuc != null ? parseFloat(sonuc).toFixed(3) : '–'}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {athletesByRotation.flat().length === 0 && (
                                    <tr><td colSpan={5} style={{ textAlign: 'center', color: '#888', padding: 12 }}>Sporcu yok</td></tr>
                                )}
                            </tbody>
                        </table>
                        </div>{/* /cl-athlete-table-wrap */}
                    </div>
                </div>{/* /cl-scoring-area */}

                {/* ── Toplam Puan — sadece sporcu seçilince ── */}
                {selectedAthlete && (
                    <div className="cl-total-bar">
                        <span className="cl-total-label">TOPLAM PUAN</span>
                        <span className="cl-total-score">{classicFinalScore}</span>
                        <div className="cl-total-breakdown">
                            {hasDA && <span>DA <strong>{classicDaScore.toFixed(3)}</strong></span>}
                            <span>{hasDA ? '+ ' : ''}DB <strong>{classicDbScore.toFixed(3)}</strong></span>
                            <span>+ A <strong>{classicAResult.score.toFixed(3)}</strong></span>
                            <span>+ E <strong>{classicEResult.score.toFixed(3)}</strong></span>
                            <span>− Ceza <strong>{classicTotalPenalty.toFixed(3)}</strong></span>
                        </div>
                    </div>
                )}
            </>
                )}

            {/* ── Onay Modal ── */}
            {confirmModal && (
                <div className="cl-modal-overlay" onClick={() => setConfirmModal(null)}>
                    <div className="cl-modal" onClick={e => e.stopPropagation()}>
                        <div className="cl-modal-title">Puanı Onayla — {confirmModal.aletLabel}</div>
                        <div className="cl-modal-athlete">{athleteName(confirmModal.athlete)}</div>
                        <div className="cl-modal-breakdown">
                            <div><span>DA</span><strong>{confirmModal.scoreData.daScore?.toFixed(3)}</strong></div>
                            <div><span>DB</span><strong>{confirmModal.scoreData.dbScore?.toFixed(3)}</strong></div>
                            <div><span>A Sonuç</span><strong>{confirmModal.scoreData.aScore?.toFixed(3)}</strong></div>
                            <div><span>E Sonuç</span><strong>{confirmModal.scoreData.eScore?.toFixed(3)}</strong></div>
                            <div><span>Toplam Kesinti</span><strong>−{confirmModal.scoreData.penaltyTotal?.toFixed(3)}</strong></div>
                        </div>
                        <div className="cl-modal-final">{confirmModal.finalScore}</div>
                        <div className="cl-modal-actions">
                            <button className="cl-btn" onClick={() => setConfirmModal(null)}>İptal</button>
                            <button className="cl-btn cl-btn--save"
                                onClick={() => handleConfirmSubmit(confirmModal.scoreData)}
                                disabled={isSubmitting}>
                                {isSubmitting ? 'Kaydediliyor…' : 'Onayla & Kaydet'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Başarı Modal ── */}
            {successModal && (
                <div className="cl-modal-overlay" onClick={() => setSuccessModal(null)}>
                    <div className="cl-modal" onClick={e => e.stopPropagation()}>
                        <i className="material-icons-round cl-modal-icon">check_circle</i>
                        <div className="cl-modal-title">{successModal.aletLabel} Kaydedildi</div>
                        <div className="cl-modal-athlete">{athleteName(successModal.athlete)}</div>
                        <div className="cl-modal-final">{successModal.finalScore}</div>
                        <div className="cl-modal-actions">
                            {successModal.next && (
                                <button className="cl-btn cl-btn--save"
                                    onClick={() => { handleSelectAthlete(successModal.next); setSuccessModal(null); }}>
                                    <i className="material-icons-round" style={{ fontSize: 13 }}>skip_next</i>
                                    Sonraki
                                </button>
                            )}
                            <button className="cl-btn" onClick={() => setSuccessModal(null)}>Kapat</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Kilit Açma Modal ── */}
            {unlockModal && (
                <div className="cl-modal-overlay" onClick={() => setUnlockModal(null)}>
                    <div className="cl-modal" onClick={e => e.stopPropagation()}>
                        <div className="cl-modal-title">Kilidi Aç — {RITMIK_ALETLER[unlockModal.aletKey]?.label}</div>
                        <input type="password" placeholder="Komite / Admin şifresi"
                            value={unlockPassword}
                            onChange={e => setUnlockPassword(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                            autoFocus />
                        {unlockError && <div className="cl-modal-error">{unlockError}</div>}
                        <div className="cl-modal-actions">
                            <button className="cl-btn"
                                onClick={() => { setUnlockModal(null); setUnlockPassword(''); }}>İptal</button>
                            <button className="cl-btn cl-btn--save" onClick={handleUnlock} disabled={unlockingInProgress}>
                                {unlockingInProgress ? 'Kontrol…' : 'Kilidi Aç'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
