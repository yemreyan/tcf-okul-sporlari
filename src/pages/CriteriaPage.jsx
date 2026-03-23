import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/firebase';
import { ref, onValue, set, get } from 'firebase/database';
import { useAuth } from '../lib/AuthContext';
import { DEFAULT_CRITERIA } from '../data/criteriaDefaults.js';
import './CriteriaPage.css';

const APPARATUS_ICONS = {
    'yer': 'accessibility_new',
    'atlama': 'directions_run',
    'halka': 'radio_button_unchecked',
    'kulplu': 'sports',
    'paralel': 'drag_handle',
    'barfiks': 'horizontal_rule',
    'asimetrik': 'format_align_center',
    'denge': 'minimize',
    'mantar': 'lens'
};

const APPARATUS_NAMES = {
    'yer': 'Yer Hareketleri',
    'atlama': 'Atlama Masası',
    'halka': 'Halka',
    'kulplu': 'Kulplu Beygir',
    'paralel': 'Paralel Bar',
    'barfiks': 'Barfiks',
    'asimetrik': 'Asimetrik Paralel',
    'denge': 'Denge Aleti',
    'mantar': 'Mantar'
};

const CATEGORY_LABELS = {
    'genc_erkek': 'Genç Erkek',
    'genc_kiz': 'Genç Kız',
    'kucuk_erkek': 'Küçük Erkek',
    'kucuk_kiz': 'Küçük Kız',
    'minik_a_erkek': 'Minik A Erkek',
    'minik_a_kiz': 'Minik A Kız',
    'minik_b_erkek': 'Minik B Erkek',
    'minik_b_kiz': 'Minik B Kız',
    'yildiz_erkek': 'Yıldız Erkek',
    'yildiz_kiz': 'Yıldız Kız'
};

const EMPTY_HAREKET = () => ({
    id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    isim: '',
    dValues: '',
    puansiz: false
});

export default function CriteriaPage() {
    const navigate = useNavigate();
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('criteria', 'duzenle');

    // Data
    const [availableYears, setAvailableYears] = useState([]);
    const [selectedYear, setSelectedYear] = useState(null);
    const [activeYear, setActiveYear] = useState(null); // Geçerli (aktif) yıl
    const [yearData, setYearData] = useState(null);
    const [loading, setLoading] = useState(true);

    // UI
    const [viewingCriteria, setViewingCriteria] = useState(null);
    const [editData, setEditData] = useState(null); // Working copy for editing
    const [saveStatus, setSaveStatus] = useState(null);
    const [showNewYearModal, setShowNewYearModal] = useState(false);
    const [newYearValue, setNewYearValue] = useState(new Date().getFullYear() + 1);
    const [copyFromYear, setCopyFromYear] = useState('');
    const [copyEnabled, setCopyEnabled] = useState(true);
    const [newYearSaving, setNewYearSaving] = useState(false);

    // Toast auto-dismiss
    useEffect(() => {
        if (saveStatus === 'saved' || saveStatus === 'error' || saveStatus === 'yearCreated' || saveStatus === 'activeYearSet') {
            const timer = setTimeout(() => setSaveStatus(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [saveStatus]);

    // Fetch available years + activeYear from Firebase
    useEffect(() => {
        const criteriaRef = ref(db, 'criteria');
        const unsubscribe = onValue(criteriaRef, async (snapshot) => {
            const data = snapshot.val();
            if (data) {
                // activeYear is stored at criteria/activeYear
                const storedActiveYear = data.activeYear ? Number(data.activeYear) : null;
                const years = Object.keys(data).filter(k => k !== 'activeYear' && !isNaN(k)).map(Number).sort((a, b) => b - a);
                setAvailableYears(years);
                setActiveYear(storedActiveYear || years[0] || null);
                if (!selectedYear || !years.includes(selectedYear)) {
                    setSelectedYear(storedActiveYear || years[0]);
                }
            } else {
                // No data in Firebase — seed with DEFAULT_CRITERIA as 2026
                try {
                    await set(ref(db, 'criteria/2026'), DEFAULT_CRITERIA);
                    await set(ref(db, 'criteria/activeYear'), 2026);
                    setAvailableYears([2026]);
                    setActiveYear(2026);
                    setSelectedYear(2026);
                } catch (err) {
                    console.error('Seed hatası:', err);
                    setAvailableYears([2026]);
                    setActiveYear(2026);
                    setSelectedYear(2026);
                }
            }
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    // Fetch selected year's data
    useEffect(() => {
        if (!selectedYear) return;
        const yearRef = ref(db, `criteria/${selectedYear}`);
        const unsubscribe = onValue(yearRef, (snapshot) => {
            setYearData(snapshot.val() || DEFAULT_CRITERIA);
        });
        return () => unsubscribe();
    }, [selectedYear]);

    // Build categories from yearData
    const categories = useMemo(() => {
        if (!yearData) return [];
        return Object.keys(yearData).map(catKey => {
            const catData = yearData[catKey];
            if (!catData || typeof catData !== 'object') return null;
            const aletler = Object.keys(catData).filter(k => k !== 'metadata');
            return {
                id: catKey,
                name: CATEGORY_LABELS[catKey] || catKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
                isActive: catData.metadata?.isActive !== false,
                aletler: aletler.map(a => ({
                    id: a,
                    name: APPARATUS_NAMES[a] || a,
                    icon: APPARATUS_ICONS[a] || 'fitness_center',
                    details: catData[a]
                }))
            };
        }).filter(Boolean);
    }, [yearData]);

    // Open criteria modal (view or edit)
    const openCriteria = useCallback((catId, catName, appId, appName, details) => {
        const viewing = { catId, catName, appId, appName, details };
        setViewingCriteria(viewing);
        // Deep clone for editing
        setEditData(JSON.parse(JSON.stringify(details || {
            hakemSayisi: 4,
            isActive: true,
            bonus: { maxE: 10, requiredD: 0, value: 0 },
            hareketler: [],
        })));
    }, []);

    const closeCriteria = () => {
        setViewingCriteria(null);
        setEditData(null);
    };

    // Save criteria for a specific apparatus
    const handleSaveCriteria = async () => {
        if (!viewingCriteria || !editData) return;
        setSaveStatus('saving');
        try {
            const path = `criteria/${selectedYear}/${viewingCriteria.catId}/${viewingCriteria.appId}`;
            await set(ref(db, path), editData);
            setSaveStatus('saved');
            closeCriteria();
        } catch {
            setSaveStatus('error');
        }
    };

    // Toggle category active/inactive
    const toggleCategoryActive = async (catId, currentActive) => {
        try {
            await set(ref(db, `criteria/${selectedYear}/${catId}/metadata/isActive`), !currentActive);
        } catch (err) {
            console.error('Toggle hatası:', err);
        }
    };

    // Set active year
    const handleSetActiveYear = async (year) => {
        try {
            await set(ref(db, 'criteria/activeYear'), year);
            setActiveYear(year);
            setSaveStatus('activeYearSet');
        } catch {
            setSaveStatus('error');
        }
    };

    // Create new year
    const handleCreateYear = async () => {
        if (!newYearValue || availableYears.includes(Number(newYearValue))) return;
        setNewYearSaving(true);
        try {
            let sourceData;
            if (copyEnabled && copyFromYear) {
                const snap = await get(ref(db, `criteria/${copyFromYear}`));
                sourceData = snap.val() || DEFAULT_CRITERIA;
            } else {
                // Create empty structure from DEFAULT_CRITERIA keys
                sourceData = {};
                Object.keys(DEFAULT_CRITERIA).forEach(catKey => {
                    sourceData[catKey] = { metadata: { isActive: true } };
                    const catData = DEFAULT_CRITERIA[catKey];
                    Object.keys(catData).forEach(appKey => {
                        if (appKey === 'metadata') return;
                        sourceData[catKey][appKey] = {
                            hakemSayisi: 4,
                            bonus: { maxE: 10, requiredD: 0, value: 0 },
                        };
                    });
                });
            }
            await set(ref(db, `criteria/${newYearValue}`), sourceData);
            setSelectedYear(Number(newYearValue));
            setSaveStatus('yearCreated');
            setShowNewYearModal(false);
            setNewYearValue(new Date().getFullYear() + 1);
            setCopyFromYear('');
        } catch {
            setSaveStatus('error');
        }
        setNewYearSaving(false);
    };

    // Edit data helpers
    const updateEditField = (field, value) => setEditData(prev => ({ ...prev, [field]: value }));
    const updateBonus = (field, value) => setEditData(prev => ({
        ...prev,
        bonus: { ...prev.bonus, [field]: Number(value) || 0 }
    }));

    const addHareket = () => {
        setEditData(prev => ({
            ...prev,
            hareketler: [...(prev.hareketler || []), EMPTY_HAREKET()]
        }));
    };

    const removeHareket = (idx) => {
        setEditData(prev => ({
            ...prev,
            hareketler: prev.hareketler.filter((_, i) => i !== idx)
        }));
    };

    const updateHareket = (idx, field, value) => {
        setEditData(prev => ({
            ...prev,
            hareketler: prev.hareketler.map((h, i) => i === idx ? { ...h, [field]: value } : h)
        }));
    };

    const moveHareket = (idx, direction) => {
        setEditData(prev => {
            const arr = [...prev.hareketler];
            const newIdx = idx + direction;
            if (newIdx < 0 || newIdx >= arr.length) return prev;
            [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
            return { ...prev, hareketler: arr };
        });
    };

    // Eksik kesinti helpers — normalize to object format for editing
    const getEksikTiers = () => {
        if (!editData?.eksikKesintiTiers) return [];
        const tiers = editData.eksikKesintiTiers;
        if (Array.isArray(tiers)) {
            const result = [];
            tiers.forEach((val, idx) => {
                if (val !== null && val !== undefined) {
                    result.push({ count: idx, penalty: val });
                }
            });
            return result;
        }
        // Object format
        return Object.entries(tiers).map(([count, penalty]) => ({
            count: Number(count),
            penalty: Number(penalty)
        }));
    };

    const setEksikTiers = (tiers) => {
        // Save as object format
        const obj = {};
        tiers.forEach(t => {
            if (t.count >= 0 && t.penalty >= 0) {
                obj[String(t.count)] = t.penalty;
            }
        });
        setEditData(prev => ({
            ...prev,
            eksikKesintiTiers: Object.keys(obj).length > 0 ? obj : null
        }));
    };

    if (loading) {
        return (
            <div className="criteria-page rulebook-page">
                <div className="criteria-loading">
                    <i className="material-icons-round spin">sync</i>
                    <span>Kriterler yükleniyor...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="criteria-page rulebook-page">
            {/* Toast */}
            {saveStatus && (
                <div className={`criteria-toast criteria-toast--${saveStatus === 'activeYearSet' ? 'saved' : saveStatus}`}>
                    <i className="material-icons-round">
                        {saveStatus === 'saving' ? 'sync' : saveStatus === 'error' ? 'error' : 'check_circle'}
                    </i>
                    <span>
                        {saveStatus === 'saving' ? 'Kaydediliyor...' : saveStatus === 'saved' ? 'Kriter kaydedildi!' : saveStatus === 'yearCreated' ? 'Yeni yıl oluşturuldu!' : saveStatus === 'activeYearSet' ? 'Geçerli yıl güncellendi!' : 'Bir hata oluştu!'}
                    </span>
                </div>
            )}

            {/* Header */}
            <header className="page-header page-header--rulebook no-print">
                <div className="page-header__left">
                    <button className="back-btn back-btn--light" onClick={() => navigate('/artistik')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div className="header-title-wrapper">
                        <h1 className="page-title text-white">Yarışma Kriterleri</h1>
                        <p className="page-subtitle text-white-50">Tüm kategoriler için alet bazlı değerlendirme kriterleri ve hareket tabloları.</p>
                    </div>
                </div>
                <div className="page-header__right">
                    <div className="year-selector">
                        <i className="material-icons-round">calendar_today</i>
                        <select value={selectedYear || ''} onChange={e => setSelectedYear(Number(e.target.value))}>
                            {availableYears.map(y => (
                                <option key={y} value={y}>{y} Sezonu {y === activeYear ? '✓ GEÇERLİ' : ''}</option>
                            ))}
                        </select>
                    </div>
                    {canEdit && selectedYear !== activeYear && (
                        <button className="set-active-year-btn" onClick={() => handleSetActiveYear(selectedYear)}>
                            <i className="material-icons-round">verified</i>
                            <span>Geçerli Yıl Yap</span>
                        </button>
                    )}
                    {selectedYear === activeYear && (
                        <div className="active-year-badge">
                            <i className="material-icons-round">check_circle</i>
                            <span>Geçerli Yıl</span>
                        </div>
                    )}
                    {canEdit && (
                        <button className="new-year-btn" onClick={() => { setShowNewYearModal(true); setCopyFromYear(String(selectedYear || '')); }}>
                            <i className="material-icons-round">add</i>
                            <span>Yeni Yıl</span>
                        </button>
                    )}
                </div>
            </header>

            {/* Category Grid */}
            <main className="page-content rulebook-content">
                <div className="rulebook-grid">
                    {categories.map(cat => (
                        <div key={cat.id} className={`rule-card ${!cat.isActive ? 'rule-card--inactive' : ''}`}>
                            <div className="rule-card__header">
                                <div className="rule-card__icon">
                                    <i className="material-icons-round">emoji_events</i>
                                </div>
                                <h2>{cat.name}</h2>
                                {canEdit && (
                                    <label className="category-toggle" title={cat.isActive ? 'Kategoriyi pasif yap' : 'Kategoriyi aktif yap'}>
                                        <input
                                            type="checkbox"
                                            checked={cat.isActive}
                                            onChange={() => toggleCategoryActive(cat.id, cat.isActive)}
                                        />
                                        <span className="toggle-slider"></span>
                                    </label>
                                )}
                                {!cat.isActive && <span className="inactive-badge">Pasif</span>}
                            </div>
                            <div className="rule-card__apparatuses">
                                {cat.aletler.map(app => (
                                    <button
                                        key={app.id}
                                        className={`app-pill ${app.details?.isActive === false ? 'app-pill--inactive' : ''}`}
                                        style={app.details?.isActive === false ? { opacity: 0.5, filter: 'grayscale(1)' } : {}}
                                        onClick={() => openCriteria(cat.id, cat.name, app.id, app.name, app.details)}
                                        title={app.details?.isActive === false ? `${app.name} Kriterleri (Pasif)` : `${app.name} Kriterlerini İncele`}
                                    >
                                        <i className="material-icons-round">{app.icon}</i>
                                        <span>{app.name}</span>
                                        {app.details?.hareketler?.length > 0 && (
                                            <span className="pill-count" style={app.details?.isActive === false ? { background: '#94a3b8', color: '#fff' } : {}}>{app.details.hareketler.length}</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </main>

            {/* Criteria Detail/Edit Modal */}
            {viewingCriteria && editData && (
                <div className="modal-overlay" onClick={closeCriteria}>
                    <div className="modal modal--criteria" onClick={e => e.stopPropagation()}>
                        <div className="modal__header">
                            <div className="modal__header-left">
                                <h2>{viewingCriteria.catName} — {viewingCriteria.appName}</h2>
                                <span className="modal-year-badge">{selectedYear}</span>
                            </div>
                            <button className="modal__close" onClick={closeCriteria}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>

                        <div className="modal__content criteria-details">
                            {/* General Settings */}
                            <div className="criteria-section">
                                <h3><i className="material-icons-round">settings</i> Genel Ayarlar</h3>
                                <div className="criteria-settings-grid">
                                    <div className="setting-field">
                                        <label>Alet Aktif mi?</label>
                                        {canEdit ? (
                                            <label className="checkbox-label" style={{ marginTop: '0.4rem', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                <input type="checkbox" checked={editData.isActive !== false} onChange={e => updateEditField('isActive', e.target.checked)} style={{ width: '18px', height: '18px' }} />
                                                <span style={{ fontWeight: 500 }}>{editData.isActive !== false ? 'Evet' : 'Hayır'}</span>
                                            </label>
                                        ) : (
                                            <span className="setting-value">{editData.isActive !== false ? 'Evet' : 'Hayır'}</span>
                                        )}
                                    </div>
                                    <div className="setting-field">
                                        <label>Hakem Sayısı</label>
                                        {canEdit ? (
                                            <input type="number" min="1" max="10" value={editData.hakemSayisi || 4} onChange={e => updateEditField('hakemSayisi', Number(e.target.value))} />
                                        ) : (
                                            <span className="setting-value">{editData.hakemSayisi || 4}</span>
                                        )}
                                    </div>
                                    <div className="setting-field">
                                        <label>Max E Puanı</label>
                                        {canEdit ? (
                                            <input type="number" min="0" max="20" step="0.5" value={editData.bonus?.maxE ?? 10} onChange={e => updateBonus('maxE', e.target.value)} />
                                        ) : (
                                            <span className="setting-value">{editData.bonus?.maxE ?? 10}</span>
                                        )}
                                    </div>
                                    <div className="setting-field">
                                        <label>Gerekli D Puanı</label>
                                        {canEdit ? (
                                            <input type="number" min="0" step="0.5" value={editData.bonus?.requiredD ?? 0} onChange={e => updateBonus('requiredD', e.target.value)} />
                                        ) : (
                                            <span className="setting-value">{editData.bonus?.requiredD ?? 0}</span>
                                        )}
                                    </div>
                                    <div className="setting-field">
                                        <label>Bonus Değeri</label>
                                        {canEdit ? (
                                            <input type="number" min="0" step="0.5" value={editData.bonus?.value ?? 0} onChange={e => updateBonus('value', e.target.value)} />
                                        ) : (
                                            <span className="setting-value">{editData.bonus?.value ?? 0}</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Movement Table */}
                            <div className="criteria-section">
                                <div className="section-header-row">
                                    <h3><i className="material-icons-round">format_list_numbered</i> Hareket Tablosu</h3>
                                    {canEdit && (
                                        <button className="add-row-btn" onClick={addHareket}>
                                            <i className="material-icons-round">add</i>
                                            Hareket Ekle
                                        </button>
                                    )}
                                </div>
                                {(!editData.hareketler || editData.hareketler.length === 0) ? (
                                    <div className="empty-state empty-state--small">
                                        <p>Bu alet için hareket tablosu tanımlanmamış. {canEdit ? 'Hareket eklemek için yukarıdaki butonu kullanın.' : ''}</p>
                                    </div>
                                ) : (
                                    <div className="table-responsive">
                                        <table className="criteria-table criteria-table--editable">
                                            <thead>
                                                <tr>
                                                    <th style={{ width: '40px' }}>#</th>
                                                    <th>Hareket İsmi</th>
                                                    <th>D Değerleri</th>
                                                    <th style={{ width: '80px' }}>Puansız</th>
                                                    {canEdit && <th style={{ width: '100px' }}>İşlem</th>}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {editData.hareketler.map((h, i) => (
                                                    <tr key={h.id || i}>
                                                        <td className="row-num">{i + 1}</td>
                                                        <td>
                                                            {canEdit ? (
                                                                <input type="text" className="table-input" value={h.isim} onChange={e => updateHareket(i, 'isim', e.target.value)} placeholder="D1, D2..." />
                                                            ) : (
                                                                <strong>{h.isim || `H${i + 1}`}</strong>
                                                            )}
                                                        </td>
                                                        <td>
                                                            {canEdit ? (
                                                                <input type="text" className="table-input" value={h.dValues} onChange={e => updateHareket(i, 'dValues', e.target.value)} placeholder="0.5,1,1.5" />
                                                            ) : (
                                                                <div className="d-value-pills">
                                                                    {h.dValues ? h.dValues.split(',').map((val, vi) => (
                                                                        <span key={vi} className="d-pill">{val.trim()}</span>
                                                                    )) : '—'}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td>
                                                            {canEdit ? (
                                                                <label className="checkbox-inline">
                                                                    <input type="checkbox" checked={!!h.puansiz} onChange={e => updateHareket(i, 'puansiz', e.target.checked)} />
                                                                </label>
                                                            ) : (
                                                                h.puansiz ? <span className="badge badge--warning">Evet</span> : '—'
                                                            )}
                                                        </td>
                                                        {canEdit && (
                                                            <td className="action-cell">
                                                                <button className="icon-btn icon-btn--sm" onClick={() => moveHareket(i, -1)} disabled={i === 0} title="Yukarı">
                                                                    <i className="material-icons-round">arrow_upward</i>
                                                                </button>
                                                                <button className="icon-btn icon-btn--sm" onClick={() => moveHareket(i, 1)} disabled={i === editData.hareketler.length - 1} title="Aşağı">
                                                                    <i className="material-icons-round">arrow_downward</i>
                                                                </button>
                                                                <button className="icon-btn icon-btn--sm icon-btn--danger" onClick={() => removeHareket(i)} title="Sil">
                                                                    <i className="material-icons-round">delete</i>
                                                                </button>
                                                            </td>
                                                        )}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            {/* Eksik Kesinti Table */}
                            <div className="criteria-section">
                                <div className="section-header-row">
                                    <h3><i className="material-icons-round">remove_circle_outline</i> Eksik Hareket Kesintileri</h3>
                                    {canEdit && (
                                        <button className="add-row-btn" onClick={() => {
                                            const tiers = getEksikTiers();
                                            const nextCount = tiers.length > 0 ? Math.max(...tiers.map(t => t.count)) + 1 : 5;
                                            setEksikTiers([...tiers, { count: nextCount, penalty: 0 }]);
                                        }}>
                                            <i className="material-icons-round">add</i>
                                            Kesinti Ekle
                                        </button>
                                    )}
                                </div>
                                {(() => {
                                    const tiers = getEksikTiers();
                                    if (tiers.length === 0) {
                                        return (
                                            <div className="empty-state empty-state--small">
                                                <p>Eksik hareket kesintisi tanımlanmamış.</p>
                                            </div>
                                        );
                                    }
                                    return (
                                        <div className="table-responsive">
                                            <table className="criteria-table criteria-table--editable">
                                                <thead>
                                                    <tr>
                                                        <th>Eksik Hareket Sayısı</th>
                                                        <th>Kesinti (Puan)</th>
                                                        {canEdit && <th style={{ width: '60px' }}>Sil</th>}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {tiers.map((tier, i) => (
                                                        <tr key={i}>
                                                            <td>
                                                                {canEdit ? (
                                                                    <input type="number" className="table-input table-input--sm" min="0" value={tier.count} onChange={e => {
                                                                        const newTiers = [...tiers];
                                                                        newTiers[i] = { ...newTiers[i], count: Number(e.target.value) };
                                                                        setEksikTiers(newTiers);
                                                                    }} />
                                                                ) : (
                                                                    <span>{tier.count} Hareket</span>
                                                                )}
                                                            </td>
                                                            <td>
                                                                {canEdit ? (
                                                                    <input type="number" className="table-input table-input--sm" min="0" step="0.5" value={tier.penalty} onChange={e => {
                                                                        const newTiers = [...tiers];
                                                                        newTiers[i] = { ...newTiers[i], penalty: Number(e.target.value) };
                                                                        setEksikTiers(newTiers);
                                                                    }} />
                                                                ) : (
                                                                    <span className="score-loss">-{tier.penalty} Puan</span>
                                                                )}
                                                            </td>
                                                            {canEdit && (
                                                                <td>
                                                                    <button className="icon-btn icon-btn--sm icon-btn--danger" onClick={() => {
                                                                        setEksikTiers(tiers.filter((_, ti) => ti !== i));
                                                                    }}>
                                                                        <i className="material-icons-round">delete</i>
                                                                    </button>
                                                                </td>
                                                            )}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>

                        {/* Modal Footer */}
                        {canEdit && (
                            <div className="modal__footer">
                                <button className="modal-btn modal-btn--cancel" onClick={closeCriteria}>
                                    İptal
                                </button>
                                <button className="modal-btn modal-btn--save" onClick={handleSaveCriteria} disabled={saveStatus === 'saving'}>
                                    <i className="material-icons-round">{saveStatus === 'saving' ? 'sync' : 'save'}</i>
                                    {saveStatus === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* New Year Modal */}
            {showNewYearModal && (
                <div className="modal-overlay" onClick={() => setShowNewYearModal(false)}>
                    <div className="modal modal--new-year" onClick={e => e.stopPropagation()}>
                        <div className="modal__header">
                            <h2>Yeni Yıl Oluştur</h2>
                            <button className="modal__close" onClick={() => setShowNewYearModal(false)}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>
                        <div className="modal__content">
                            <div className="new-year-form">
                                <div className="form-field">
                                    <label>Yıl</label>
                                    <input
                                        type="number"
                                        min="2020"
                                        max="2050"
                                        value={newYearValue}
                                        onChange={e => setNewYearValue(e.target.value)}
                                    />
                                    {availableYears.includes(Number(newYearValue)) && (
                                        <span className="field-error">Bu yıl zaten mevcut!</span>
                                    )}
                                </div>
                                <div className="form-field">
                                    <label className="checkbox-label">
                                        <input type="checkbox" checked={copyEnabled} onChange={e => setCopyEnabled(e.target.checked)} />
                                        <span>Önceki yıldan kopyala</span>
                                    </label>
                                </div>
                                {copyEnabled && (
                                    <div className="form-field">
                                        <label>Kaynak Yıl</label>
                                        <select value={copyFromYear} onChange={e => setCopyFromYear(e.target.value)}>
                                            <option value="">Seçiniz...</option>
                                            {availableYears.map(y => (
                                                <option key={y} value={y}>{y}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="modal__footer">
                            <button className="modal-btn modal-btn--cancel" onClick={() => setShowNewYearModal(false)}>
                                İptal
                            </button>
                            <button
                                className="modal-btn modal-btn--save"
                                onClick={handleCreateYear}
                                disabled={newYearSaving || availableYears.includes(Number(newYearValue)) || (copyEnabled && !copyFromYear)}
                            >
                                <i className="material-icons-round">{newYearSaving ? 'sync' : 'add_circle'}</i>
                                {newYearSaving ? 'Oluşturuluyor...' : 'Oluştur'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
