import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, push, set, remove, update } from 'firebase/database';
import { db } from '../lib/firebase';
import turkeyData from '../data/turkey_data.json';
import { DEFAULT_CRITERIA } from '../data/criteriaDefaults.js';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { filterCompetitionsArrayByUser } from '../lib/useFilteredCompetitions';
import { generateEPanelToken } from '../lib/epanelToken';
import './CompetitionsPage.css';

function countAthletes(sporcularObj) {
    if (!sporcularObj) return 0;
    let count = 0;
    Object.values(sporcularObj).forEach(category => {
        count += Object.keys(category).length;
    });
    return count;
}

function computeStatus(baslangic, bitis) {
    if (!baslangic) return 'upcoming';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(baslangic);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(bitis || baslangic);
    endDate.setHours(0, 0, 0, 0);
    if (today < startDate) return 'upcoming';
    if (today > endDate) return 'completed';
    return 'active';
}

function daysUntil(dateStr) {
    if (!dateStr) return Infinity;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr);
    target.setHours(0, 0, 0, 0);
    return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function formatDaysLabel(days, status) {
    if (status === 'active') return 'Devam ediyor';
    if (days === 0) return 'Bugün';
    if (days === 1) return 'Yarın';
    if (days > 1) return `${days} gün sonra`;
    return '';
}

function formatDateTR(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function CompetitionsPage() {
    const navigate = useNavigate();
    const { currentUser, hasPermission } = useAuth();
    const { toast, confirm } = useNotification();
    const [competitions, setCompetitions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterCity, setFilterCity] = useState('all');
    const [viewMode, setViewMode] = useState('card'); // 'card' | 'list'
    const [showPast, setShowPast] = useState(false);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingComp, setEditingComp] = useState(null);
    const todayStr = new Date().toISOString().split('T')[0];
    const [formData, setFormData] = useState({
        isim: '',
        baslangicTarihi: todayStr,
        bitisTarihi: todayStr,
        il: '',
        selectedCats: []
    });

    const cities = Object.keys(turkeyData).sort();

    useEffect(() => {
        const compsRef = ref(db, 'competitions');
        const unsubscribe = onValue(compsRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                const compArray = Object.keys(data).map(key => {
                    const compData = data[key];
                    const baslangic = compData.baslangicTarihi || compData.tarih || '';
                    const bitis = compData.bitisTarihi || compData.tarih || '';
                    const status = computeStatus(baslangic, bitis);
                    return {
                        id: key,
                        ...compData,
                        name: compData.isim || 'İsimsiz Yarışma',
                        baslangicTarihi: baslangic,
                        bitisTarihi: bitis,
                        city: compData.il || '',
                        status,
                        daysUntilStart: daysUntil(baslangic),
                        categoryCount: compData.kategoriler ? Object.keys(compData.kategoriler).length : 0,
                        athleteCount: countAthletes(compData.sporcular),
                    };
                });

                const statusOrder = { active: 0, upcoming: 1, completed: 2 };
                compArray.sort((a, b) => {
                    const orderDiff = statusOrder[a.status] - statusOrder[b.status];
                    if (orderDiff !== 0) return orderDiff;
                    if (a.status === 'completed') {
                        return new Date(b.bitisTarihi || 0) - new Date(a.bitisTarihi || 0);
                    }
                    return new Date(a.baslangicTarihi || 0) - new Date(b.baslangicTarihi || 0);
                });

                setCompetitions(filterCompetitionsArrayByUser(compArray, currentUser));
            } else {
                setCompetitions([]);
            }
            setLoading(false);
        }, (error) => {
            if (import.meta.env.DEV) console.error("Firebase fetch error:", error);
            setLoading(false);
        });
        return () => unsubscribe();
    }, [currentUser]);

    // Arama + il filtreleme
    const filtered = useMemo(() => {
        return competitions.filter(comp => {
            if (filterCity !== 'all' && (comp.city || '').toUpperCase() !== filterCity.toUpperCase()) return false;
            if (search.trim()) {
                const s = search.toLocaleLowerCase('tr-TR');
                const nameMatch = (comp.name || '').toLocaleLowerCase('tr-TR').includes(s);
                const cityMatch = (comp.city || '').toLocaleLowerCase('tr-TR').includes(s);
                if (!nameMatch && !cityMatch) return false;
            }
            return true;
        });
    }, [competitions, filterCity, search]);

    const activeComps = filtered.filter(c => c.status === 'active' || c.status === 'upcoming');
    const pastComps = filtered.filter(c => c.status === 'completed');

    const handleDelete = async (id, name) => {
        const confirmed = await confirm(`"${name}" isimli yarışmayı silmek istediğinize emin misiniz? Tüm başvuru ve sporcu verileri kalıcı olarak silinecektir!`, { title: 'Silme Onayı', type: 'danger' });
        if (confirmed) {
            try {
                await remove(ref(db, `competitions/${id}`));
            } catch (err) {
                if (import.meta.env.DEV) console.error("Delete failed", err);
                toast("Silme işlemi başarısız oldu.", "error");
            }
        }
    };

    const openModal = (comp = null) => {
        if (comp) {
            setEditingComp(comp);
            setFormData({
                isim: comp.name || '',
                baslangicTarihi: comp.baslangicTarihi || '',
                bitisTarihi: comp.bitisTarihi || '',
                il: comp.city || '',
                selectedCats: comp.kategoriler ? Object.keys(comp.kategoriler) : []
            });
        } else {
            setEditingComp(null);
            setFormData({ isim: '', baslangicTarihi: todayStr, bitisTarihi: todayStr, il: '', selectedCats: [] });
        }
        setIsModalOpen(true);
    };

    const handleCatToggle = (catKey) => {
        setFormData(prev => {
            const current = [...prev.selectedCats];
            if (current.includes(catKey)) return { ...prev, selectedCats: current.filter(c => c !== catKey) };
            return { ...prev, selectedCats: [...current, catKey] };
        });
    };

    const saveCompetition = async (e) => {
        e.preventDefault();
        if (new Date(formData.bitisTarihi) < new Date(formData.baslangicTarihi)) {
            toast("Bitiş tarihi başlangıç tarihinden önce olamaz!", "warning");
            return;
        }
        const saveData = { isim: formData.isim, baslangicTarihi: formData.baslangicTarihi, bitisTarihi: formData.bitisTarihi, il: formData.il };

        const generateKategoriler = (currentKategoriler = {}) => {
            const nextKategoriler = { ...currentKategoriler };
            formData.selectedCats.forEach(catKey => {
                if (!nextKategoriler[catKey]) {
                    const defaultData = DEFAULT_CRITERIA[catKey];
                    const aletler = Object.keys(defaultData || {}).filter(k => k !== 'metadata');
                    nextKategoriler[catKey] = { name: getCategoryLabel(catKey), aletler };
                }
            });
            Object.keys(nextKategoriler).forEach(catKey => {
                if (!formData.selectedCats.includes(catKey)) delete nextKategoriler[catKey];
            });
            return nextKategoriler;
        };

        try {
            if (editingComp) {
                await update(ref(db, `competitions/${editingComp.id}`), { ...saveData, kategoriler: generateKategoriler(editingComp.kategoriler || {}) });
            } else {
                const newRef = push(ref(db, 'competitions'));
                await set(newRef, { ...saveData, kategoriler: generateKategoriler({}), sporcular: {}, epanelToken: generateEPanelToken() });
            }
            setIsModalOpen(false);
        } catch (err) {
            if (import.meta.env.DEV) console.error("Save error", err);
            toast("Kaydetme işlemi başarısız oldu.", "error");
        }
    };

    const getCategoryLabel = (catKey) => catKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    const statusConfig = {
        active: { label: 'Devam Ediyor', color: 'var(--green)' },
        upcoming: { label: 'Yaklaşan', color: 'var(--blue)' },
        completed: { label: 'Tamamlandı', color: 'var(--text-muted)' },
    };

    const renderCompCard = (comp, i) => {
        const conf = statusConfig[comp.status] || statusConfig.upcoming;
        const daysLabel = formatDaysLabel(comp.daysUntilStart, comp.status);

        return (
            <div key={comp.id} className={`comp-card ${comp.status === 'completed' ? 'comp-card--past' : ''}`} style={{ animationDelay: `${(i % 10) * 0.05}s` }}>
                <div className="comp-card__header">
                    <div className="comp-card__status" style={{ backgroundColor: `${conf.color}20`, color: conf.color }}>
                        <span className="status-dot" style={{ backgroundColor: conf.color }}></span>
                        {conf.label}
                    </div>
                    {daysLabel && comp.status !== 'completed' && (
                        <span className="comp-card__countdown">{daysLabel}</span>
                    )}
                    <div className="comp-card__actions">
                        {hasPermission('competitions', 'duzenle') && (
                            <button className="icon-btn" onClick={() => openModal(comp)} title="Düzenle"><i className="material-icons-round">edit</i></button>
                        )}
                        {hasPermission('competitions', 'sil') && (
                            <button className="icon-btn icon-btn--danger" onClick={() => handleDelete(comp.id, comp.name)} title="Sil"><i className="material-icons-round">delete_outline</i></button>
                        )}
                    </div>
                </div>
                <h2 className="comp-card__title">{comp.name}</h2>
                <div className="comp-card__details">
                    <div className="detail-item">
                        <i className="material-icons-round">calendar_month</i>
                        <span>{comp.baslangicTarihi === comp.bitisTarihi ? formatDateTR(comp.baslangicTarihi) : `${formatDateTR(comp.baslangicTarihi)} — ${formatDateTR(comp.bitisTarihi)}`}</span>
                    </div>
                    <div className="detail-item">
                        <i className="material-icons-round">location_on</i>
                        <span>{comp.city || 'Konum Belirtilmemiş'}</span>
                    </div>
                </div>
                <div className="comp-card__stats">
                    <div className="stat-box">
                        <span className="stat-value">{comp.categoryCount}</span>
                        <span className="stat-label">Kategori</span>
                    </div>
                    <div className="stat-box">
                        <span className="stat-value">{comp.athleteCount}</span>
                        <span className="stat-label">Kayıtlı Sporcu</span>
                    </div>
                </div>
            </div>
        );
    };

    const renderCompRow = (comp) => {
        const conf = statusConfig[comp.status] || statusConfig.upcoming;
        const daysLabel = formatDaysLabel(comp.daysUntilStart, comp.status);

        return (
            <div key={comp.id} className={`comp-row ${comp.status === 'completed' ? 'comp-row--past' : ''}`}>
                <div className="comp-row__status" style={{ backgroundColor: `${conf.color}20`, color: conf.color }}>
                    <span className="status-dot" style={{ backgroundColor: conf.color }}></span>
                    {conf.label}
                </div>
                <div className="comp-row__main">
                    <span className="comp-row__name">{comp.name}</span>
                    <div className="comp-row__meta">
                        <span><i className="material-icons-round">location_on</i>{comp.city || '—'}</span>
                        <span><i className="material-icons-round">calendar_month</i>{formatDateTR(comp.baslangicTarihi)}</span>
                        <span><i className="material-icons-round">category</i>{comp.categoryCount} kat.</span>
                        <span><i className="material-icons-round">groups</i>{comp.athleteCount} sporcu</span>
                    </div>
                </div>
                {daysLabel && comp.status !== 'completed' && (
                    <span className="comp-row__countdown">{daysLabel}</span>
                )}
                <div className="comp-row__actions">
                    {hasPermission('competitions', 'duzenle') && (
                        <button className="icon-btn" onClick={() => openModal(comp)} title="Düzenle"><i className="material-icons-round">edit</i></button>
                    )}
                    {hasPermission('competitions', 'sil') && (
                        <button className="icon-btn icon-btn--danger" onClick={() => handleDelete(comp.id, comp.name)} title="Sil"><i className="material-icons-round">delete_outline</i></button>
                    )}
                </div>
            </div>
        );
    };

    const renderComps = (comps) => {
        if (viewMode === 'list') {
            return <div className="comp-list-view">{comps.map(c => renderCompRow(c))}</div>;
        }
        return <div className="comp-list">{comps.map((c, i) => renderCompCard(c, i))}</div>;
    };

    return (
        <div className="competitions-page">
            <header className="page-header">
                <div className="page-header__left">
                    <button className="back-btn" onClick={() => navigate('/')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div>
                        <h1 className="page-title">Yarışmalar</h1>
                        <p className="page-subtitle">Tüm yarışma ve etkinlikleri yönetin</p>
                    </div>
                </div>
                <div className="page-header__right">
                    {hasPermission('competitions', 'olustur') && (
                        <button className="btn btn--primary" onClick={() => openModal()}>
                            <i className="material-icons-round">add</i>
                            <span>Yeni Yarışma</span>
                        </button>
                    )}
                </div>
            </header>

            <main className="page-content">
                {/* Toolbar: Arama + İl + Görünüm Toggle */}
                <div className="comp-toolbar">
                    <div className="comp-search">
                        <i className="material-icons-round">search</i>
                        <input
                            type="text"
                            placeholder="Yarışma veya il ara..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                        {search && (
                            <button className="comp-search__clear" onClick={() => setSearch('')}>
                                <i className="material-icons-round">close</i>
                            </button>
                        )}
                    </div>

                    <div className="filter-select-wrapper">
                        <i className="material-icons-round filter-select-icon">place</i>
                        <select className="filter-select" value={filterCity} onChange={e => setFilterCity(e.target.value)}>
                            <option value="all">Tüm İller</option>
                            {cities.map(city => <option key={city} value={city}>{city}</option>)}
                        </select>
                    </div>

                    <div className="view-toggle">
                        <button className={`view-toggle__btn ${viewMode === 'card' ? 'active' : ''}`} onClick={() => setViewMode('card')} title="Kart Görünümü">
                            <i className="material-icons-round">grid_view</i>
                        </button>
                        <button className={`view-toggle__btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')} title="Liste Görünümü">
                            <i className="material-icons-round">view_list</i>
                        </button>
                    </div>

                    <div className="comp-toolbar__count">
                        <span>{activeComps.length}</span> aktif &middot; <span>{pastComps.length}</span> geçmiş
                    </div>
                </div>

                {loading ? (
                    <div className="loading-state">
                        <div className="spinner"></div>
                        <p>Yarışmalar yükleniyor...</p>
                    </div>
                ) : (
                    <>
                        {activeComps.length > 0 ? (
                            renderComps(activeComps)
                        ) : (
                            <div className="empty-state">
                                <div className="empty-state__icon"><i className="material-icons-round">event_available</i></div>
                                <p>{search ? 'Aramanızla eşleşen aktif yarışma bulunamadı.' : 'Aktif veya yaklaşan yarışma bulunmuyor.'}</p>
                            </div>
                        )}

                        {pastComps.length > 0 && (
                            <div className="past-section">
                                <button className="past-section__toggle" onClick={() => setShowPast(!showPast)}>
                                    <div className="past-section__left">
                                        <i className="material-icons-round">history</i>
                                        <span>Geçmiş Yarışmalar</span>
                                        <span className="past-section__count">{pastComps.length}</span>
                                    </div>
                                    <i className={`material-icons-round past-section__arrow ${showPast ? 'open' : ''}`}>expand_more</i>
                                </button>
                                {showPast && renderComps(pastComps)}
                            </div>
                        )}
                    </>
                )}
            </main>

            {/* Modal */}
            {isModalOpen && (
                <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal__header">
                            <h2>{editingComp ? 'Yarışma Düzenle' : 'Yeni Yarışma'}</h2>
                            <button className="modal__close" onClick={() => setIsModalOpen(false)}><i className="material-icons-round">close</i></button>
                        </div>
                        <form className="modal__form-grid" style={{ gridTemplateColumns: '1fr' }} onSubmit={saveCompetition}>
                            <div className="form-group form-group--full">
                                <label>Yarışma Adı *</label>
                                <input type="text" required value={formData.isim} onChange={e => setFormData({ ...formData, isim: e.target.value })} />
                            </div>
                            <div className="form-group form-group--full">
                                <label>İl *</label>
                                <select required value={formData.il} onChange={e => setFormData({ ...formData, il: e.target.value })}>
                                    <option value="">-- İl Seçiniz --</option>
                                    {cities.map(city => <option key={city} value={city}>{city}</option>)}
                                </select>
                            </div>
                            <div className="form-group-row">
                                <div className="form-group">
                                    <label>Başlangıç Tarihi *</label>
                                    <input type="date" required value={formData.baslangicTarihi} onChange={e => setFormData({ ...formData, baslangicTarihi: e.target.value })} />
                                </div>
                                <div className="form-group">
                                    <label>Bitiş Tarihi *</label>
                                    <input type="date" required value={formData.bitisTarihi} onChange={e => setFormData({ ...formData, bitisTarihi: e.target.value })} />
                                </div>
                            </div>
                            <div className="form-group form-group--full category-selection-box">
                                <label>Yarışma Kategorileri</label>
                                <p className="help-text">Seçilen kategoriler 2026 sezonu aletleriyle birlikte otomatik olarak eklenecektir.</p>
                                <div className="category-checkbox-grid">
                                    {Object.keys(DEFAULT_CRITERIA).map(catKey => {
                                        const isChecked = formData.selectedCats.includes(catKey);
                                        return (
                                            <div key={catKey} className={`cat-checkbox ${isChecked ? 'cat-checkbox--checked' : ''}`} onClick={() => handleCatToggle(catKey)}>
                                                <div className={`checkbox-indicator ${isChecked ? 'checked' : ''}`}>{isChecked && <i className="material-icons-round">check</i>}</div>
                                                <span>{getCategoryLabel(catKey)}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="modal__footer">
                                <button type="button" className="btn btn--secondary" onClick={() => setIsModalOpen(false)}>İptal</button>
                                <button type="submit" className="btn btn--primary">{editingComp ? 'Güncelle' : 'Kaydet'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
