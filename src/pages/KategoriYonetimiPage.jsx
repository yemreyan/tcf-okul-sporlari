import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, set } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import './KategoriYonetimiPage.css';

const TURKISH_MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

const DISCIPLINES = [
    { key: 'artistik',  label: 'Artistik' },
    { key: 'ritmik',    label: 'Ritmik' },
    { key: 'aerobik',   label: 'Aerobik' },
    { key: 'trampolin', label: 'Trampolin' },
    { key: 'parkur',    label: 'Parkur' },
];

const OKUL_LABELS = { ilkokul: 'İlkokul', ortaokul: 'Ortaokul', lise: 'Lise' };

const DEFAULT_CATEGORY_CONFIGS = {
    artistik: {
        minik_b_kiz:   { label: 'Minik B Kız',   cinsiyet: 'kız',   dobRules: [], okulTurleri: ['ilkokul'] },
        minik_a_kiz:   { label: 'Minik A Kız',   cinsiyet: 'kız',   dobRules: [], okulTurleri: ['ilkokul'] },
        kucuk_kiz:     { label: 'Küçük Kız',     cinsiyet: 'kız',   dobRules: [], okulTurleri: ['ilkokul', 'ortaokul'] },
        yildiz_kiz:    { label: 'Yıldız Kız',    cinsiyet: 'kız',   dobRules: [], okulTurleri: ['ortaokul'] },
        genc_kiz:      { label: 'Genç Kız',      cinsiyet: 'kız',   dobRules: [], okulTurleri: ['ortaokul', 'lise'] },
        minik_b_erkek: { label: 'Minik B Erkek', cinsiyet: 'erkek', dobRules: [], okulTurleri: ['ilkokul'] },
        minik_a_erkek: { label: 'Minik A Erkek', cinsiyet: 'erkek', dobRules: [], okulTurleri: ['ilkokul'] },
        kucuk_erkek:   { label: 'Küçük Erkek',   cinsiyet: 'erkek', dobRules: [], okulTurleri: ['ilkokul', 'ortaokul'] },
        yildiz_erkek:  { label: 'Yıldız Erkek',  cinsiyet: 'erkek', dobRules: [], okulTurleri: ['ortaokul'] },
        genc_erkek:    { label: 'Genç Erkek',     cinsiyet: 'erkek', dobRules: [], okulTurleri: ['ortaokul', 'lise'] },
    },
    ritmik: {
        minik_b_kiz: { label: 'Minik B Kız', cinsiyet: 'kız', dobRules: [], okulTurleri: ['ilkokul'] },
        minik_a_kiz: { label: 'Minik A Kız', cinsiyet: 'kız', dobRules: [], okulTurleri: ['ilkokul'] },
        kucuk_kiz:   { label: 'Küçük Kız',   cinsiyet: 'kız', dobRules: [], okulTurleri: ['ilkokul', 'ortaokul'] },
        yildiz_kiz:  { label: 'Yıldız Kız',  cinsiyet: 'kız', dobRules: [], okulTurleri: ['ortaokul'] },
        genc_kiz:    { label: 'Genç Kız',    cinsiyet: 'kız', dobRules: [], okulTurleri: ['ortaokul', 'lise'] },
    },
    aerobik: {
        minik_b_karma:  { label: 'Minik B Karma',  cinsiyet: 'karma', dobRules: [], okulTurleri: ['ilkokul'] },
        minik_a_karma:  { label: 'Minik A Karma',  cinsiyet: 'karma', dobRules: [], okulTurleri: ['ilkokul'] },
        kucuk_karma:    { label: 'Küçük Karma',    cinsiyet: 'karma', dobRules: [], okulTurleri: ['ilkokul', 'ortaokul'] },
        yildiz_karma:   { label: 'Yıldız Karma',   cinsiyet: 'karma', dobRules: [], okulTurleri: ['ortaokul'] },
        genc_karma:     { label: 'Genç Karma',     cinsiyet: 'karma', dobRules: [], okulTurleri: ['ortaokul', 'lise'] },
        minik_b_kiz:    { label: 'Minik B Kız',    cinsiyet: 'kız',   dobRules: [], okulTurleri: ['ilkokul'] },
        minik_a_kiz:    { label: 'Minik A Kız',    cinsiyet: 'kız',   dobRules: [], okulTurleri: ['ilkokul'] },
        kucuk_kiz:      { label: 'Küçük Kız',      cinsiyet: 'kız',   dobRules: [], okulTurleri: ['ilkokul', 'ortaokul'] },
        yildiz_kiz:     { label: 'Yıldız Kız',     cinsiyet: 'kız',   dobRules: [], okulTurleri: ['ortaokul'] },
        minik_b_erkek:  { label: 'Minik B Erkek',  cinsiyet: 'erkek', dobRules: [], okulTurleri: ['ilkokul'] },
        minik_a_erkek:  { label: 'Minik A Erkek',  cinsiyet: 'erkek', dobRules: [], okulTurleri: ['ilkokul'] },
        kucuk_erkek:    { label: 'Küçük Erkek',    cinsiyet: 'erkek', dobRules: [], okulTurleri: ['ilkokul', 'ortaokul'] },
        yildiz_erkek:   { label: 'Yıldız Erkek',   cinsiyet: 'erkek', dobRules: [], okulTurleri: ['ortaokul'] },
    },
    trampolin: {
        minik_kiz:    { label: 'Minik Kız',    cinsiyet: 'kız',   dobRules: [], okulTurleri: ['ilkokul'] },
        kucuk_kiz:    { label: 'Küçük Kız',    cinsiyet: 'kız',   dobRules: [], okulTurleri: ['ilkokul', 'ortaokul'] },
        yildiz_kiz:   { label: 'Yıldız Kız',   cinsiyet: 'kız',   dobRules: [], okulTurleri: ['ortaokul'] },
        genc_kiz:     { label: 'Genç Kız',     cinsiyet: 'kız',   dobRules: [], okulTurleri: ['ortaokul', 'lise'] },
        minik_erkek:  { label: 'Minik Erkek',  cinsiyet: 'erkek', dobRules: [], okulTurleri: ['ilkokul'] },
        kucuk_erkek:  { label: 'Küçük Erkek',  cinsiyet: 'erkek', dobRules: [], okulTurleri: ['ilkokul', 'ortaokul'] },
        yildiz_erkek: { label: 'Yıldız Erkek', cinsiyet: 'erkek', dobRules: [], okulTurleri: ['ortaokul'] },
        genc_erkek:   { label: 'Genç Erkek',   cinsiyet: 'erkek', dobRules: [], okulTurleri: ['ortaokul', 'lise'] },
    },
    parkur: {
        minik_kiz:    { label: 'Minik Kız',    cinsiyet: 'kız',   dobRules: [], okulTurleri: ['ilkokul'] },
        kucuk_kiz:    { label: 'Küçük Kız',    cinsiyet: 'kız',   dobRules: [], okulTurleri: ['ilkokul', 'ortaokul'] },
        yildiz_kiz:   { label: 'Yıldız Kız',   cinsiyet: 'kız',   dobRules: [], okulTurleri: ['ortaokul'] },
        genc_kiz:     { label: 'Genç Kız',     cinsiyet: 'kız',   dobRules: [], okulTurleri: ['ortaokul', 'lise'] },
        minik_erkek:  { label: 'Minik Erkek',  cinsiyet: 'erkek', dobRules: [], okulTurleri: ['ilkokul'] },
        kucuk_erkek:  { label: 'Küçük Erkek',  cinsiyet: 'erkek', dobRules: [], okulTurleri: ['ilkokul', 'ortaokul'] },
        yildiz_erkek: { label: 'Yıldız Erkek', cinsiyet: 'erkek', dobRules: [], okulTurleri: ['ortaokul'] },
        genc_erkek:   { label: 'Genç Erkek',   cinsiyet: 'erkek', dobRules: [], okulTurleri: ['ortaokul', 'lise'] },
    },
};

function formatDobRule(rule) {
    const { year, monthMin, monthMax } = rule;
    if (!monthMin && !monthMax) return String(year);
    const start = monthMin ? TURKISH_MONTHS[monthMin - 1] : 'Oca';
    const end   = monthMax ? TURKISH_MONTHS[monthMax - 1] : 'Ara';
    return `${year} (${start}–${end})`;
}

function emptyEditForm() {
    return { cinsiyet: 'kız', dobRules: [], okulTurleri: [] };
}

export default function KategoriYonetimiPage() {
    const navigate = useNavigate();
    const { isSuperAdmin, hasPermission } = useAuth();

    const [selectedDiscipline, setSelectedDiscipline] = useState('artistik');
    const [firebaseData, setFirebaseData] = useState({});
    const [editModal, setEditModal] = useState(null); // null | { catId, catData }
    const [editForm, setEditForm] = useState(emptyEditForm());
    const [saving, setSaving] = useState(false);
    const [loadingDefaults, setLoadingDefaults] = useState(false);
    const [toast, setToast] = useState(null);

    const canAccess = isSuperAdmin() || hasPermission('criteria');

    // Load from Firebase when discipline changes
    useEffect(() => {
        const dbRef = ref(db, `kategoriYonetimi/${selectedDiscipline}`);
        const unsub = onValue(dbRef, (snap) => {
            setFirebaseData(snap.val() || {});
        });
        return () => unsub();
    }, [selectedDiscipline]);

    // Show toast helper
    function showToast(message, type = 'success') {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    }

    // Merge defaults with Firebase data
    const defaults = DEFAULT_CATEGORY_CONFIGS[selectedDiscipline] || {};
    const mergedCategories = Object.entries(defaults).map(([catId, defData]) => {
        const fbData = firebaseData[catId];
        return [catId, fbData ? { ...defData, ...fbData } : defData];
    });

    // Also include any Firebase-only categories not in defaults
    Object.entries(firebaseData).forEach(([catId, catData]) => {
        if (!defaults[catId]) {
            mergedCategories.push([catId, catData]);
        }
    });

    function openEditModal(catId, catData) {
        setEditForm({
            cinsiyet: catData.cinsiyet || 'kız',
            dobRules: (catData.dobRules || []).map(r => ({ ...r })),
            okulTurleri: [...(catData.okulTurleri || [])],
        });
        setEditModal({ catId, catData });
    }

    function closeEditModal() {
        setEditModal(null);
        setEditForm(emptyEditForm());
    }

    async function handleSaveCategory() {
        if (!editModal) return;
        setSaving(true);
        try {
            const catRef = ref(db, `kategoriYonetimi/${selectedDiscipline}/${editModal.catId}`);
            const dataToSave = {
                label: editModal.catData.label,
                cinsiyet: editForm.cinsiyet,
                dobRules: editForm.dobRules.filter(r => r.year),
                okulTurleri: editForm.okulTurleri,
            };
            await set(catRef, dataToSave);
            showToast('Kategori kaydedildi.');
            closeEditModal();
        } catch (err) {
            console.error(err);
            showToast('Kayıt sırasında hata oluştu.', 'error');
        } finally {
            setSaving(false);
        }
    }

    async function handleLoadDefaults() {
        if (!window.confirm(`"${DISCIPLINES.find(d => d.key === selectedDiscipline)?.label}" için varsayılan kategoriler Firebase'e yazılacak. Devam edilsin mi?`)) return;
        setLoadingDefaults(true);
        try {
            const disciplineRef = ref(db, `kategoriYonetimi/${selectedDiscipline}`);
            await set(disciplineRef, DEFAULT_CATEGORY_CONFIGS[selectedDiscipline]);
            showToast('Varsayılan kategoriler yüklendi.');
        } catch (err) {
            console.error(err);
            showToast('Yükleme sırasında hata oluştu.', 'error');
        } finally {
            setLoadingDefaults(false);
        }
    }

    // dobRules editing helpers
    function addDobRule() {
        setEditForm(f => ({ ...f, dobRules: [...f.dobRules, { year: new Date().getFullYear() - 10 }] }));
    }

    function removeDobRule(idx) {
        setEditForm(f => ({ ...f, dobRules: f.dobRules.filter((_, i) => i !== idx) }));
    }

    function updateDobRule(idx, field, value) {
        setEditForm(f => {
            const updated = f.dobRules.map((r, i) => {
                if (i !== idx) return r;
                const newRule = { ...r };
                if (value === '' || value === null || value === undefined) {
                    delete newRule[field];
                } else {
                    newRule[field] = Number(value);
                }
                return newRule;
            });
            return { ...f, dobRules: updated };
        });
    }

    function toggleOkulTuru(key) {
        setEditForm(f => {
            const has = f.okulTurleri.includes(key);
            return {
                ...f,
                okulTurleri: has ? f.okulTurleri.filter(k => k !== key) : [...f.okulTurleri, key],
            };
        });
    }

    if (!canAccess) {
        return (
            <div className="kyp-page">
                <div className="kyp-access-denied">
                    <span className="material-icons">lock</span>
                    <p>Bu sayfaya erişim yetkiniz bulunmamaktadır.</p>
                    <button className="kyp-btn kyp-btn--primary" onClick={() => navigate(-1)}>Geri Dön</button>
                </div>
            </div>
        );
    }

    return (
        <div className="kyp-page">
            {/* Header */}
            <div className="kyp-header">
                <div className="kyp-header__left">
                    <button className="kyp-back-btn" onClick={() => navigate(-1)}>
                        <span className="material-icons">arrow_back</span>
                    </button>
                    <div>
                        <h1 className="kyp-title">Kategori Yönetimi</h1>
                        <p className="kyp-subtitle">Branş başına kategori kurallarını yapılandırın</p>
                    </div>
                </div>
                <button
                    className="kyp-btn kyp-btn--secondary"
                    onClick={handleLoadDefaults}
                    disabled={loadingDefaults}
                >
                    <span className="material-icons">{loadingDefaults ? 'hourglass_empty' : 'restore'}</span>
                    {loadingDefaults ? 'Yükleniyor…' : 'Varsayılanları Yükle'}
                </button>
            </div>

            {/* Discipline Tabs */}
            <div className="kyp-disc-tabs">
                {DISCIPLINES.map(d => (
                    <button
                        key={d.key}
                        className={`kyp-disc-tab${selectedDiscipline === d.key ? ' kyp-disc-tab--active' : ''}`}
                        onClick={() => setSelectedDiscipline(d.key)}
                    >
                        {d.label}
                    </button>
                ))}
            </div>

            {/* Category Table */}
            <div className="kyp-content">
                <div className="kyp-cat-table">
                    <div className="kyp-cat-table__head">
                        <span>Kategori</span>
                        <span>Cinsiyet</span>
                        <span>Doğum Yılı Kuralları</span>
                        <span>Okul Türleri</span>
                        <span></span>
                    </div>
                    {mergedCategories.length === 0 && (
                        <div className="kyp-empty">Bu branş için henüz kategori tanımlanmamış.</div>
                    )}
                    {mergedCategories.map(([catId, catData]) => (
                        <div key={catId} className="kyp-cat-row">
                            <span className="kyp-cat-label">{catData.label || catId}</span>
                            <span>
                                <span className={`kyp-badge kyp-badge--${catData.cinsiyet}`}>
                                    {catData.cinsiyet === 'kız' ? 'Kız' : catData.cinsiyet === 'erkek' ? 'Erkek' : 'Karma'}
                                </span>
                            </span>
                            <span className="kyp-dob-chips">
                                {(catData.dobRules || []).length === 0
                                    ? <span className="kyp-no-rule">—</span>
                                    : (catData.dobRules || []).map((r, i) => (
                                        <span key={i} className="kyp-dob-chip">{formatDobRule(r)}</span>
                                    ))
                                }
                            </span>
                            <span className="kyp-okul-chips">
                                {(catData.okulTurleri || []).map(k => (
                                    <span key={k} className={`kyp-okul-chip kyp-okul-chip--${k}`}>{OKUL_LABELS[k] || k}</span>
                                ))}
                            </span>
                            <span className="kyp-cat-actions">
                                <button
                                    className="kyp-btn kyp-btn--edit"
                                    onClick={() => openEditModal(catId, catData)}
                                >
                                    <span className="material-icons">edit</span>
                                    Düzenle
                                </button>
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Edit Modal */}
            {editModal && (
                <div className="kyp-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeEditModal(); }}>
                    <div className="kyp-modal">
                        <div className="kyp-modal__header">
                            <h2 className="kyp-modal__title">
                                <span className="material-icons">edit</span>
                                {editModal.catData.label || editModal.catId} — Düzenle
                            </h2>
                            <button className="kyp-modal__close" onClick={closeEditModal}>
                                <span className="material-icons">close</span>
                            </button>
                        </div>

                        <div className="kyp-modal__body">
                            {/* Cinsiyet */}
                            <div className="kyp-edit-section">
                                <label className="kyp-edit-label">Cinsiyet</label>
                                <div className="kyp-cinsiyet-btns">
                                    {['kız', 'erkek', 'karma'].map(c => (
                                        <button
                                            key={c}
                                            className={`kyp-cinsiyet-btn kyp-cinsiyet-btn--${c}${editForm.cinsiyet === c ? ' kyp-cinsiyet-btn--active' : ''}`}
                                            onClick={() => setEditForm(f => ({ ...f, cinsiyet: c }))}
                                        >
                                            {c === 'kız' ? 'Kız' : c === 'erkek' ? 'Erkek' : 'Karma'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Okul Türleri */}
                            <div className="kyp-edit-section">
                                <label className="kyp-edit-label">Okul Türleri</label>
                                <div className="kyp-okul-checkboxes">
                                    {['ilkokul', 'ortaokul', 'lise'].map(k => (
                                        <label key={k} className="kyp-okul-check-label">
                                            <input
                                                type="checkbox"
                                                checked={editForm.okulTurleri.includes(k)}
                                                onChange={() => toggleOkulTuru(k)}
                                            />
                                            <span>{OKUL_LABELS[k]}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* DOB Rules */}
                            <div className="kyp-edit-section">
                                <div className="kyp-edit-section__header">
                                    <label className="kyp-edit-label">Doğum Yılı Kuralları</label>
                                    <button className="kyp-btn kyp-btn--ghost kyp-btn--sm" onClick={addDobRule}>
                                        <span className="material-icons">add</span>
                                        Kural Ekle
                                    </button>
                                </div>
                                {editForm.dobRules.length === 0 && (
                                    <p className="kyp-dob-empty">Kural yok — tüm doğum yılları kabul edilir.</p>
                                )}
                                {editForm.dobRules.map((rule, idx) => (
                                    <div key={idx} className="kyp-dob-rule-row">
                                        <div className="kyp-dob-field">
                                            <label>Yıl</label>
                                            <input
                                                type="number"
                                                className="kyp-input"
                                                value={rule.year || ''}
                                                min={2000}
                                                max={2030}
                                                onChange={e => updateDobRule(idx, 'year', e.target.value)}
                                                placeholder="Yıl"
                                            />
                                        </div>
                                        <div className="kyp-dob-field">
                                            <label>Ay (Min)</label>
                                            <select
                                                className="kyp-input"
                                                value={rule.monthMin || ''}
                                                onChange={e => updateDobRule(idx, 'monthMin', e.target.value || null)}
                                            >
                                                <option value="">—</option>
                                                {TURKISH_MONTHS.map((m, i) => (
                                                    <option key={i} value={i + 1}>{m} ({i + 1})</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="kyp-dob-field">
                                            <label>Ay (Max)</label>
                                            <select
                                                className="kyp-input"
                                                value={rule.monthMax || ''}
                                                onChange={e => updateDobRule(idx, 'monthMax', e.target.value || null)}
                                            >
                                                <option value="">—</option>
                                                {TURKISH_MONTHS.map((m, i) => (
                                                    <option key={i} value={i + 1}>{m} ({i + 1})</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="kyp-dob-preview">
                                            <span className="kyp-dob-chip">{formatDobRule(rule)}</span>
                                        </div>
                                        <button
                                            className="kyp-btn kyp-btn--danger-ghost kyp-btn--icon"
                                            onClick={() => removeDobRule(idx)}
                                            title="Kuralı sil"
                                        >
                                            <span className="material-icons">delete_outline</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="kyp-modal__footer">
                            <button className="kyp-btn kyp-btn--ghost" onClick={closeEditModal} disabled={saving}>
                                İptal
                            </button>
                            <button className="kyp-btn kyp-btn--primary" onClick={handleSaveCategory} disabled={saving}>
                                {saving
                                    ? <><span className="material-icons kyp-spin">hourglass_empty</span> Kaydediliyor…</>
                                    : <><span className="material-icons">save</span> Kaydet</>
                                }
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div className={`kyp-toast kyp-toast--${toast.type}`}>
                    <span className="material-icons">{toast.type === 'error' ? 'error_outline' : 'check_circle_outline'}</span>
                    {toast.message}
                </div>
            )}
        </div>
    );
}
