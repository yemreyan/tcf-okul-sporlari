/**
 * RitmikModernLayout — Kart tabanlı modern tasarım (mevcut)
 */
import { useOffline } from '../lib/OfflineContext';
import { useDiscipline } from '../lib/DisciplineContext';
import './RitmikScoringPage.css';

export default function RitmikModernLayout({ s, onSwitchLayout }) {
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
        aPanelLocal, setAPanelLocal,
        ePanelLocal, setEPanelLocal,
        dbScoreInput, setDbScoreInput,
        daScoreInput, setDaScoreInput,
        penaltyInput, setPenaltyInput,
        aScore, eScore, dbScore, daScoreNum, totalPenalties, modernFinalScore,
        // Classic alt alanlar
        classicDA, setClassicDA,
        classicDB, setClassicDB,
        sjaInput, setSjaInput,
        sjeInput, setSjeInput,
        classicPenalty, setClassicPenalty,
        daGap, daGapOk, dbGap, dbGapOk,
        classicAResult, classicEResult,
        unlockModal, setUnlockModal,
        unlockPassword, setUnlockPassword,
        unlockError,
        unlockingInProgress,
        scoringFieldsTouched, setScoringFieldsTouched,
        sidebarOpen, setSidebarOpen,
        isSubmitting, confirmModal, setConfirmModal,
        successModal, setSuccessModal,
        catConfig, judgeCount, scoreLocked,
        availableCities, compOptions, categoryOptions,
        resetPanel,
        handleSelectAthlete, handleSelectAlet,
        handleCallAthlete,
        handleModernSubmit,
        handleConfirmSubmit, handleUnlock,
        getAthleteStatus, getAletStatus,
        RITMIK_CATEGORIES, RITMIK_ALETLER,
    } = s;

    const { toast } = { toast: () => {} }; // Notification context layout içinden erişilemez, parent'ta

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

            {/* ── Layout Switch ── */}
            <button
                className="rtm-layout-switch"
                onClick={onSwitchLayout}
                title="Klasik tablo tasarımına geç"
            >
                <i className="material-icons-round">table_chart</i>
                <span>Klasik</span>
            </button>

            {/* ── Sol Kenar Çubuğu ── */}
            <aside className={`rtm-sidebar${sidebarOpen ? '' : ' rtm-sidebar--collapsed'}`}>
                <div className="rtm-sidebar-inner">
                    <div className="rtm-sidebar-header">
                        <button className="rtm-back-btn" onClick={() => navigate('/ritmik')}>
                            <i className="material-icons-round">arrow_back</i>
                        </button>
                        <div>
                            <div className="rtm-sidebar-title">Ritmik Puanlama</div>
                            <div className="rtm-sidebar-sub">TCF Okul Sporları</div>
                        </div>
                    </div>

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
                            <select value={selectedCompId} onChange={e => { setSelectedCompId(e.target.value); setSelectedCategory(''); }}>
                                <option value="">Yarışma Seçin</option>
                                {compOptions.map(([id, comp]) => (
                                    <option key={id} value={id}>{comp.isim || comp.name || id}</option>
                                ))}
                            </select>
                        </div>
                        <div className="rtm-filter-group">
                            <label>Kategori</label>
                            <select value={selectedCategory} onChange={e => { setSelectedCategory(e.target.value); resetPanel(); }}>
                                <option value="">Kategori Seçin</option>
                                {categoryOptions.map(c => (
                                    <option key={c} value={c}>{RITMIK_CATEGORIES[c]?.label || c}</option>
                                ))}
                            </select>
                        </div>
                    </div>

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
                                            const status = getAthleteStatus(ath);
                                            const isActive = selectedAthlete?.id === ath.id;
                                            const topSt  = getAletStatus(ath, 'top');
                                            const kurdSt = getAletStatus(ath, 'kurdele');
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

            {/* ── Ana İçerik ── */}
            <main className="rtm-main">
                {!selectedAthlete ? (
                    <div className="rtm-empty-state">
                        <i className="material-icons-round">self_improvement</i>
                        <p>Puanlamak için sol listeden bir sporcu seçin.</p>
                        {!selectedCategory && <p className="rtm-empty-sub">Önce yarışma ve kategori seçmelisiniz.</p>}
                    </div>
                ) : (
                    <div className="rtm-scoring-wrap">
                        {/* Sporcu Başlık */}
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
                                    }}>
                                        <i className="material-icons-round">lock_open</i> Kilitle
                                    </button>
                                ) : null}
                            </div>
                        </div>

                        {/* Alet Sekmeleri */}
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
                                {RITMIK_ALETLER[selectedAlet]?.label} puanı kilitlenmiştir.
                            </div>
                        )}

                        {/* DA */}
                        <div className="rtm-card">
                            <div className="rtm-card-header">
                                <span className="rtm-card-label rtm-card-label--d">DA</span>
                                <span className="rtm-card-title">Alet Zorluğu</span>
                                <span className="rtm-card-desc">DA Kesin + alt notlar</span>
                                <span className="rtm-score-chip rtm-score-chip--d">{daScoreNum.toFixed(3)}</span>
                            </div>
                            {/* DA Kesin — hesaba katılan skor */}
                            <div className="rtm-da-input-row">
                                <label className="rtm-sub-label">DA ★ Kesin</label>
                                <input type="number" className="rtm-da-input" min="0" step="0.1" placeholder="0.000"
                                    value={daScoreInput} disabled={scoreLocked}
                                    onChange={e => {
                                        setDaScoreInput(e.target.value);
                                        setClassicDA(p => ({ ...p, da: e.target.value }));
                                        setScoringFieldsTouched(true);
                                    }} />
                            </div>
                            {/* DA Alt Notlar — bilgi amaçlı */}
                            <div className="rtm-sub-row">
                                <div className="rtm-sub-cell">
                                    <label>DA1</label>
                                    <input type="number" min="0" step="0.1" placeholder="0.000"
                                        value={classicDA.da1} disabled={scoreLocked}
                                        onChange={e => { setClassicDA(p => ({ ...p, da1: e.target.value })); setScoringFieldsTouched(true); }} />
                                </div>
                                <div className="rtm-sub-cell">
                                    <label>DA2</label>
                                    <input type="number" min="0" step="0.1" placeholder="0.000"
                                        value={classicDA.da2} disabled={scoreLocked}
                                        onChange={e => { setClassicDA(p => ({ ...p, da2: e.target.value })); setScoringFieldsTouched(true); }} />
                                </div>
                                <div className="rtm-sub-cell">
                                    <label>SJDA</label>
                                    <input type="number" min="0" step="0.1" placeholder="0.000"
                                        value={classicDA.sjda} disabled={scoreLocked}
                                        onChange={e => { setClassicDA(p => ({ ...p, sjda: e.target.value })); setScoringFieldsTouched(true); }} />
                                </div>
                                {classicDA.da1 !== '' && classicDA.da2 !== '' && (
                                    <div className={`rtm-gap-badge${daGapOk ? '' : ' rtm-gap-badge--warn'}`}>
                                        Fark: {daGap.toFixed(3)} {daGapOk ? '✓' : '⚠'}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* DB */}
                        <div className="rtm-card">
                            <div className="rtm-card-header">
                                <span className="rtm-card-label rtm-card-label--d">DB</span>
                                <span className="rtm-card-title">Vücut Zorluğu</span>
                                <span className="rtm-card-desc">DB Kesin + alt notlar</span>
                                <span className="rtm-score-chip rtm-score-chip--d">{dbScore.toFixed(3)}</span>
                            </div>
                            {/* DB Kesin */}
                            <div className="rtm-da-input-row">
                                <label className="rtm-sub-label">DB ★ Kesin</label>
                                <input type="number" className="rtm-da-input" min="0" step="0.1" placeholder="0.000"
                                    value={dbScoreInput} disabled={scoreLocked}
                                    onChange={e => {
                                        setDbScoreInput(e.target.value);
                                        setClassicDB(p => ({ ...p, db: e.target.value }));
                                        setScoringFieldsTouched(true);
                                    }} />
                            </div>
                            {/* DB Alt Notlar */}
                            <div className="rtm-sub-row">
                                <div className="rtm-sub-cell">
                                    <label>DB1</label>
                                    <input type="number" min="0" step="0.1" placeholder="0.000"
                                        value={classicDB.db1} disabled={scoreLocked}
                                        onChange={e => { setClassicDB(p => ({ ...p, db1: e.target.value })); setScoringFieldsTouched(true); }} />
                                </div>
                                <div className="rtm-sub-cell">
                                    <label>DB2</label>
                                    <input type="number" min="0" step="0.1" placeholder="0.000"
                                        value={classicDB.db2} disabled={scoreLocked}
                                        onChange={e => { setClassicDB(p => ({ ...p, db2: e.target.value })); setScoringFieldsTouched(true); }} />
                                </div>
                                <div className="rtm-sub-cell">
                                    <label>SJDB</label>
                                    <input type="number" min="0" step="0.1" placeholder="0.000"
                                        value={classicDB.sjdb} disabled={scoreLocked}
                                        onChange={e => { setClassicDB(p => ({ ...p, sjdb: e.target.value })); setScoringFieldsTouched(true); }} />
                                </div>
                                {classicDB.db1 !== '' && classicDB.db2 !== '' && (
                                    <div className={`rtm-gap-badge${dbGapOk ? '' : ' rtm-gap-badge--warn'}`}>
                                        Fark: {dbGap.toFixed(3)} {dbGapOk ? '✓' : '⚠'}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* A Paneli */}
                        <div className="rtm-card">
                            <div className="rtm-card-header">
                                <span className="rtm-card-label rtm-card-label--a">A</span>
                                <span className="rtm-card-title">Artistlik Puanı</span>
                                <span className="rtm-card-desc">{judgeCount} hakem · kesinti girişi</span>
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
                                            <input type="number" min="0" max="10" step="0.1" placeholder="0.0"
                                                value={val} disabled={scoreLocked}
                                                onChange={e => { setAPanelLocal(p => ({ ...p, [key]: e.target.value })); setScoringFieldsTouched(true); }} />
                                            {!isNaN(num) && val !== '' && (
                                                <span className="rtm-judge-result">{Math.max(0, 10 - num).toFixed(1)}</span>
                                            )}
                                        </div>
                                    );
                                })}
                                {/* SJA — bilgi amaçlı */}
                                <div className="rtm-judge-cell rtm-judge-cell--sj">
                                    <label>SJA</label>
                                    <input type="number" min="0" max="10" step="0.1" placeholder="0.0"
                                        value={sjaInput} disabled={scoreLocked}
                                        onChange={e => { setSjaInput(e.target.value); setScoringFieldsTouched(true); }} />
                                    <span className="rtm-sj-hint">bilgi</span>
                                </div>
                            </div>
                            {classicAResult.gap > 0 && (
                                <div className={`rtm-gap-badge${classicAResult.gapOk ? '' : ' rtm-gap-badge--warn'}`} style={{ margin: '4px 0 0' }}>
                                    A Fark: {classicAResult.gap.toFixed(3)} {classicAResult.gapOk ? '✓' : '⚠'}
                                </div>
                            )}
                        </div>

                        {/* E Paneli */}
                        <div className="rtm-card">
                            <div className="rtm-card-header">
                                <span className="rtm-card-label rtm-card-label--e">E</span>
                                <span className="rtm-card-title">İcra Puanı</span>
                                <span className="rtm-card-desc">{judgeCount} hakem · kesinti girişi</span>
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
                                            <input type="number" min="0" max="10" step="0.1" placeholder="0.0"
                                                value={val} disabled={scoreLocked}
                                                onChange={e => { setEPanelLocal(p => ({ ...p, [key]: e.target.value })); setScoringFieldsTouched(true); }} />
                                            {!isNaN(num) && val !== '' && (
                                                <span className="rtm-judge-result">{Math.max(0, 10 - num).toFixed(1)}</span>
                                            )}
                                        </div>
                                    );
                                })}
                                {/* SJE — bilgi amaçlı */}
                                <div className="rtm-judge-cell rtm-judge-cell--sj">
                                    <label>SJE</label>
                                    <input type="number" min="0" max="10" step="0.1" placeholder="0.0"
                                        value={sjeInput} disabled={scoreLocked}
                                        onChange={e => { setSjeInput(e.target.value); setScoringFieldsTouched(true); }} />
                                    <span className="rtm-sj-hint">bilgi</span>
                                </div>
                            </div>
                            {classicEResult.gap > 0 && (
                                <div className={`rtm-gap-badge${classicEResult.gapOk ? '' : ' rtm-gap-badge--warn'}`} style={{ margin: '4px 0 0' }}>
                                    E Fark: {classicEResult.gap.toFixed(3)} {classicEResult.gapOk ? '✓' : '⚠'}
                                </div>
                            )}
                        </div>

                        {/* Ceza */}
                        <div className="rtm-card">
                            <div className="rtm-card-header">
                                <span className="rtm-card-label rtm-card-label--ded">−</span>
                                <span className="rtm-card-title">Ceza Kesintisi</span>
                                <span className="rtm-card-desc">Koordinatör · Çizgi · Zaman</span>
                                <span className="rtm-score-chip rtm-score-chip--ded">−{totalPenalties.toFixed(3)}</span>
                            </div>
                            <div className="rtm-sub-row">
                                {[
                                    { key: 'koordinator', label: 'Koordinatör' },
                                    { key: 'cizgi1',      label: 'Çizgi 1' },
                                    { key: 'cizgi2',      label: 'Çizgi 2' },
                                    { key: 'zaman',       label: 'Zaman' },
                                ].map(({ key, label }) => (
                                    <div key={key} className="rtm-sub-cell">
                                        <label>{label}</label>
                                        <input type="number" min="0" step="0.1" placeholder="0.0"
                                            value={classicPenalty[key]} disabled={scoreLocked}
                                            onChange={e => {
                                                const newPen = { ...classicPenalty, [key]: e.target.value };
                                                setClassicPenalty(newPen);
                                                const sum = ['koordinator','cizgi1','cizgi2','zaman']
                                                    .reduce((s, k) => s + (parseFloat(newPen[k]) || 0), 0);
                                                setPenaltyInput(String(sum));
                                                setScoringFieldsTouched(true);
                                            }} />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Final Bar */}
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
                            <div className="rtm-final-score">{modernFinalScore}</div>
                            {(() => {
                                const other = selectedAlet === 'top' ? 'kurdele' : 'top';
                                const otherSonuc = existingScores[selectedAthlete.id]?.[other]?.sonuc;
                                if (otherSonuc != null) {
                                    const toplam = parseFloat(modernFinalScore) + parseFloat(otherSonuc);
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
                                onClick={handleModernSubmit}
                            >
                                <i className="material-icons-round">save</i>
                                {isSubmitting ? 'Kaydediliyor…' : `${RITMIK_ALETLER[selectedAlet]?.label} Kaydet`}
                            </button>
                        </div>
                    </div>
                )}
            </main>

            {/* ── Onay Modal ── */}
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
                            <div><span>DA</span><strong>{confirmModal.scoreData.daScore?.toFixed(3)}</strong></div>
                            <div><span>DB</span><strong>{confirmModal.scoreData.dbScore?.toFixed(3)}</strong></div>
                            <div><span>A</span><strong>{confirmModal.scoreData.aScore?.toFixed(3)}</strong></div>
                            <div><span>E</span><strong>{confirmModal.scoreData.eScore?.toFixed(3)}</strong></div>
                            <div><span>Ceza</span><strong>−{confirmModal.scoreData.penaltyTotal?.toFixed(3)}</strong></div>
                        </div>
                        <div className="rtm-modal-final">{confirmModal.finalScore}</div>
                        <div className="rtm-modal-actions">
                            <button className="rtm-btn rtm-btn--cancel" onClick={() => setConfirmModal(null)}>İptal</button>
                            <button className="rtm-btn rtm-btn--confirm" onClick={() => handleConfirmSubmit(confirmModal.scoreData)} disabled={isSubmitting}>
                                {isSubmitting ? 'Kaydediliyor…' : 'Onayla & Kaydet'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Başarı Modal ── */}
            {successModal && (
                <div className="rtm-modal-overlay" onClick={() => setSuccessModal(null)}>
                    <div className="rtm-modal rtm-modal--success" onClick={e => e.stopPropagation()}>
                        <i className="material-icons-round rtm-modal-icon">check_circle</i>
                        <div className="rtm-modal-title">{successModal.aletLabel} Kaydedildi</div>
                        <div className="rtm-modal-athlete">
                            {successModal.athlete.soyad
                                ? `${successModal.athlete.soyad} ${successModal.athlete.ad || ''}`
                                : successModal.athlete.name || ''}
                        </div>
                        <div className="rtm-modal-final">{successModal.finalScore}</div>
                        <div className="rtm-modal-actions">
                            {successModal.next && (
                                <button className="rtm-btn rtm-btn--next"
                                    onClick={() => { handleSelectAthlete(successModal.next); setSuccessModal(null); }}>
                                    <i className="material-icons-round">skip_next</i>
                                    Sonraki: {successModal.next.soyad || successModal.next.name || ''}
                                </button>
                            )}
                            <button className="rtm-btn rtm-btn--cancel" onClick={() => setSuccessModal(null)}>Kapat</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Kilit Açma Modal ── */}
            {unlockModal && (
                <div className="rtm-modal-overlay" onClick={() => setUnlockModal(null)}>
                    <div className="rtm-modal" onClick={e => e.stopPropagation()}>
                        <div className="rtm-modal-title">Kilidi Aç — {RITMIK_ALETLER[unlockModal.aletKey]?.label}</div>
                        <input type="password" className="rtm-unlock-input" placeholder="Şifre"
                            value={unlockPassword}
                            onChange={e => setUnlockPassword(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                            autoFocus />
                        {unlockError && <div className="rtm-unlock-error">{unlockError}</div>}
                        <div className="rtm-modal-actions">
                            <button className="rtm-btn rtm-btn--cancel"
                                onClick={() => { setUnlockModal(null); setUnlockPassword(''); }}>İptal</button>
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
