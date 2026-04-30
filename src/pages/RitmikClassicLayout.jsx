/**
 * RitmikClassicLayout — Masaüstü tablo/panel tasarımı
 * Ekran görüntüsündeki D/A/E/Kesintiler yapısını birebir kurgular.
 */
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
        daGap, daGapOk,
        dbGap, dbGapOk,
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
        getAthleteStatus, getAletStatus,
        RITMIK_CATEGORIES, RITMIK_ALETLER,
    } = s;

    // ── SİL yardımcıları ──
    const silDA   = () => { setClassicDA(p => ({ ...p, da: '' }));   setScoringFieldsTouched(true); };
    const silDA1  = () => { setClassicDA(p => ({ ...p, da1: '' })); setScoringFieldsTouched(true); };
    const silDA2  = () => { setClassicDA(p => ({ ...p, da2: '' })); setScoringFieldsTouched(true); };
    const silSJDA = () => { setClassicDA(p => ({ ...p, sjda: '' })); setScoringFieldsTouched(true); };
    const silDB   = () => { setClassicDB(p => ({ ...p, db: '' }));   setScoringFieldsTouched(true); };
    const silDB1  = () => { setClassicDB(p => ({ ...p, db1: '' })); setScoringFieldsTouched(true); };
    const silDB2  = () => { setClassicDB(p => ({ ...p, db2: '' })); setScoringFieldsTouched(true); };
    const silSJDB = () => { setClassicDB(p => ({ ...p, sjdb: '' })); setScoringFieldsTouched(true); };
    const silA = (k) => { setAPanelLocal(p => { const n = { ...p }; delete n[k]; return n; }); setScoringFieldsTouched(true); };
    const silE = (k) => { setEPanelLocal(p => { const n = { ...p }; delete n[k]; return n; }); setScoringFieldsTouched(true); };
    const silSJA = () => { setSjaInput(''); setScoringFieldsTouched(true); };
    const silSJE = () => { setSjeInput(''); setScoringFieldsTouched(true); };
    const silKes = (k) => { setClassicPenalty(p => ({ ...p, [k]: '' })); setScoringFieldsTouched(true); };

    const fmt = (v, def = '0.000') => v != null && v !== '' && !isNaN(parseFloat(v))
        ? parseFloat(v).toFixed(3) : def;

    // SİL satırı verisi
    const silRowD = [
        { label: 'DA SİL (Kesin)',  val: fmt(classicDA.da),    action: () => { silDA(); } },
        { label: 'DA1 SİL (Bilgi)', val: fmt(classicDA.da1),   action: silDA1 },
        { label: 'DA2 SİL (Bilgi)', val: fmt(classicDA.da2),   action: silDA2 },
        { label: 'SJDA SİL (Bilgi)',val: fmt(classicDA.sjda),  action: silSJDA },
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

            {/* ── Alet Sekmeleri ── */}
            {selectedAthlete && (
                <div className="cl-alet-bar">
                    {Object.values(RITMIK_ALETLER).map(alet => {
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

            {scoreLocked && (
                <div className="cl-locked-banner">
                    <i className="material-icons-round">lock</i>
                    {RITMIK_ALETLER[selectedAlet]?.label} puanı kilitlenmiştir. Düzenlemek için kilidi açın.
                </div>
            )}

            {/* ── SİL Butonları ── */}
            {selectedAthlete && (
                <div className="cl-sil-section">
                    <div className="cl-sil-row">
                        {silRowD.map((item, i) => (
                            <div key={i} className="cl-sil-cell">
                                <button className="cl-sil-btn" onClick={item.action} disabled={scoreLocked}>
                                    {item.label}
                                </button>
                                <span className="cl-sil-val">{item.val}</span>
                            </div>
                        ))}
                    </div>
                    <div className="cl-sil-row">
                        {silRowAE.map((item, i) => (
                            <div key={i} className="cl-sil-cell">
                                <button className="cl-sil-btn" onClick={item.action} disabled={scoreLocked}>
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

                                        {/* ── DA tarafı ── */}
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
                                                    value={classicDA.da} disabled={scoreLocked}
                                                    onChange={e => { setClassicDA(p => ({ ...p, da: e.target.value })); setScoringFieldsTouched(true); }} />
                                            </div>
                                            {/* DA1, DA2 — bilgi amaçlı */}
                                            <div className="cl-d-cell">
                                                <label style={{ fontSize: 10, color: '#888' }}>DA1 <span style={{ fontSize: 8, color: '#aaa' }}>(bilgi)</span></label>
                                                <input type="number" min="0" step="0.1" placeholder="0.0"
                                                    style={{ opacity: 0.75 }}
                                                    value={classicDA.da1} disabled={scoreLocked}
                                                    onChange={e => { setClassicDA(p => ({ ...p, da1: e.target.value })); setScoringFieldsTouched(true); }} />
                                            </div>
                                            <div className="cl-d-cell">
                                                <label style={{ fontSize: 10, color: '#888' }}>DA2 <span style={{ fontSize: 8, color: '#aaa' }}>(bilgi)</span></label>
                                                <input type="number" min="0" step="0.1" placeholder="0.0"
                                                    style={{ opacity: 0.75 }}
                                                    value={classicDA.da2} disabled={scoreLocked}
                                                    onChange={e => { setClassicDA(p => ({ ...p, da2: e.target.value })); setScoringFieldsTouched(true); }} />
                                            </div>
                                            {/* SJDA — bilgi amaçlı */}
                                            <div className="cl-d-cell">
                                                <label style={{ fontSize: 10, color: '#888' }}>SJDA <span style={{ fontSize: 8, color: '#aaa' }}>(bilgi)</span></label>
                                                <input type="number" min="0" step="0.1" placeholder="0.0"
                                                    style={{ opacity: 0.75, width: 72 }}
                                                    value={classicDA.sjda} disabled={scoreLocked}
                                                    onChange={e => { setClassicDA(p => ({ ...p, sjda: e.target.value })); setScoringFieldsTouched(true); }} />
                                            </div>
                                            {/* GAP DA — bilgi */}
                                            <div className="cl-d-cell">
                                                <label style={{ fontSize: 10, color: '#888' }}>GAP DA <span style={{ fontSize: 8, color: '#aaa' }}>(bilgi)</span></label>
                                                <div className="cl-gap-row" style={{ marginTop: 2 }}>
                                                    <span className={`cl-gap-val ${daGapOk ? 'ok' : 'err'}`} style={{ fontSize: 12 }}>{daGap.toFixed(3)}</span>
                                                    <i className={`material-icons-round cl-gap-check ${daGapOk ? 'ok' : 'err'}`} style={{ fontSize: 13 }}>
                                                        {daGapOk ? 'check_circle' : 'warning'}
                                                    </i>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="cl-d-separator" />

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
                                                    value={classicDB.db} disabled={scoreLocked}
                                                    onChange={e => { setClassicDB(p => ({ ...p, db: e.target.value })); setScoringFieldsTouched(true); }} />
                                            </div>
                                            {/* DB1, DB2 — bilgi amaçlı */}
                                            <div className="cl-d-cell">
                                                <label style={{ fontSize: 10, color: '#888' }}>DB1 <span style={{ fontSize: 8, color: '#aaa' }}>(bilgi)</span></label>
                                                <input type="number" min="0" step="0.1" placeholder="0.0"
                                                    style={{ opacity: 0.75 }}
                                                    value={classicDB.db1} disabled={scoreLocked}
                                                    onChange={e => { setClassicDB(p => ({ ...p, db1: e.target.value })); setScoringFieldsTouched(true); }} />
                                            </div>
                                            <div className="cl-d-cell">
                                                <label style={{ fontSize: 10, color: '#888' }}>DB2 <span style={{ fontSize: 8, color: '#aaa' }}>(bilgi)</span></label>
                                                <input type="number" min="0" step="0.1" placeholder="0.0"
                                                    style={{ opacity: 0.75 }}
                                                    value={classicDB.db2} disabled={scoreLocked}
                                                    onChange={e => { setClassicDB(p => ({ ...p, db2: e.target.value })); setScoringFieldsTouched(true); }} />
                                            </div>
                                            {/* SJDB — bilgi amaçlı */}
                                            <div className="cl-d-cell">
                                                <label style={{ fontSize: 10, color: '#888' }}>SJDB <span style={{ fontSize: 8, color: '#aaa' }}>(bilgi)</span></label>
                                                <input type="number" min="0" step="0.1" placeholder="0.0"
                                                    style={{ opacity: 0.75, width: 72 }}
                                                    value={classicDB.sjdb} disabled={scoreLocked}
                                                    onChange={e => { setClassicDB(p => ({ ...p, sjdb: e.target.value })); setScoringFieldsTouched(true); }} />
                                            </div>
                                            {/* GAP DB — bilgi */}
                                            <div className="cl-d-cell">
                                                <label style={{ fontSize: 10, color: '#888' }}>GAP DB <span style={{ fontSize: 8, color: '#aaa' }}>(bilgi)</span></label>
                                                <div className="cl-gap-row" style={{ marginTop: 2 }}>
                                                    <span className={`cl-gap-val ${dbGapOk ? 'ok' : 'err'}`} style={{ fontSize: 12 }}>{dbGap.toFixed(3)}</span>
                                                    <i className={`material-icons-round cl-gap-check ${dbGapOk ? 'ok' : 'err'}`} style={{ fontSize: 13 }}>
                                                        {dbGapOk ? 'check_circle' : 'warning'}
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
                                                            value={val} disabled={scoreLocked}
                                                            onChange={e => { setAPanelLocal(p => ({ ...p, [key]: e.target.value })); setScoringFieldsTouched(true); }} />
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
                                                    value={sjaInput} disabled={scoreLocked}
                                                    onChange={e => { setSjaInput(e.target.value); setScoringFieldsTouched(true); }} />
                                            </div>
                                        </div>
                                        <div className="cl-ae-stats">
                                            <div className="cl-ae-stat">
                                                <label>A Ortalama</label>
                                                <span className="cl-stat-val">{classicAResult.avg.toFixed(3)}</span>
                                            </div>
                                            <div className="cl-ae-stat">
                                                <label>GAP</label>
                                                <span className={`cl-stat-val ${classicAResult.gapOk ? '' : 'err'}`}>
                                                    {classicAResult.gap.toFixed(3)}
                                                </span>
                                                <i className="material-icons-round" style={{ fontSize: 13, color: classicAResult.gapOk ? 'var(--cl-gap-ok)' : 'var(--cl-gap-err)', marginLeft: 2 }}>
                                                    {classicAResult.gapOk ? 'check_circle' : 'warning'}
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
                                                            value={val} disabled={scoreLocked}
                                                            onChange={e => { setEPanelLocal(p => ({ ...p, [key]: e.target.value })); setScoringFieldsTouched(true); }} />
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
                                                    value={sjeInput} disabled={scoreLocked}
                                                    onChange={e => { setSjeInput(e.target.value); setScoringFieldsTouched(true); }} />
                                            </div>
                                        </div>
                                        <div className="cl-ae-stats">
                                            <div className="cl-ae-stat">
                                                <label>E Ortalama</label>
                                                <span className="cl-stat-val">{classicEResult.avg.toFixed(3)}</span>
                                            </div>
                                            <div className="cl-ae-stat">
                                                <label>GAP</label>
                                                <span className={`cl-stat-val ${classicEResult.gapOk ? '' : 'err'}`}>
                                                    {classicEResult.gap.toFixed(3)}
                                                </span>
                                                <i className="material-icons-round" style={{ fontSize: 13, color: classicEResult.gapOk ? 'var(--cl-gap-ok)' : 'var(--cl-gap-err)', marginLeft: 2 }}>
                                                    {classicEResult.gapOk ? 'check_circle' : 'warning'}
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
                                                        value={item.val} disabled={scoreLocked}
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

                            {/* Aksiyon + Güncelle */}
                            <div className="cl-action-row">
                                <button
                                    className="cl-btn cl-btn--save"
                                    disabled={scoreLocked || isSubmitting}
                                    onClick={handleClassicSubmit}
                                >
                                    <i className="material-icons-round" style={{ fontSize: 14 }}>save</i>
                                    {isSubmitting ? 'KAYDEDİLİYOR…' : 'GÜNCELLE'}
                                </button>
                                <span className="cl-action-label">PUAN GİRİŞ EKRANI — {RITMIK_ALETLER[selectedAlet]?.label?.toLocaleUpperCase('tr-TR')}</span>
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
                                            <td title={athleteName(ath)}>{
                                                ath.soyad ? `${ath.soyad} ${(ath.ad || '').charAt(0)}.` : (ath.name || ath.ad || '?')
                                            }</td>
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
                    </div>
                </div>{/* /cl-scoring-area */}

                {/* ── Toplam Puan — sadece sporcu seçilince ── */}
                {selectedAthlete && (
                    <div className="cl-total-bar">
                        <span className="cl-total-label">TOPLAM PUAN</span>
                        <span className="cl-total-score">{classicFinalScore}</span>
                        <div className="cl-total-breakdown">
                            <span>DA <strong>{classicDaScore.toFixed(3)}</strong></span>
                            <span>+ DB <strong>{classicDbScore.toFixed(3)}</strong></span>
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
