import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, push, set, remove, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import turkeyData from '../data/turkey_data.json';
import { DEFAULT_CRITERIA } from '../data/criteriaDefaults.js';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { filterCompetitionsArrayByUser } from '../lib/useFilteredCompetitions';
import { generateEPanelToken } from '../lib/epanelToken';
import { logAction } from '../lib/auditLogger';
import { useDiscipline } from '../lib/DisciplineContext';
import './CompetitionsPage.css';

/* ─── HAKEM PANEL SAYISI SEÇENEKLERI ─── */
const HAKEM_SAYISI_OPTIONS = [2, 3, 4, 5, 6];

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
    const { firebasePath, routePrefix } = useDiscipline();
    const [competitions, setCompetitions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterCity, setFilterCity] = useState('all');
    const [viewMode, setViewMode] = useState('card'); // 'card' | 'list'
    const [showPast, setShowPast] = useState(false);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingComp, setEditingComp] = useState(null);

    // Hakem Yönetimi Modal State
    const [hakemModalComp, setHakemModalComp] = useState(null);
    const [hakemModalCat, setHakemModalCat] = useState('');
    const [hakemSayisi, setHakemSayisi] = useState(4);
    const [hakemAtama, setHakemAtama] = useState({});  // {catId: {aletId: {e1: {id, name}, e2: ...}}}
    const [referees, setReferees] = useState([]);
    const [hakemSaving, setHakemSaving] = useState(false);
    const todayStr = new Date().toISOString().split('T')[0];
    const [formData, setFormData] = useState({
        isim: '',
        baslangicTarihi: todayStr,
        bitisTarihi: todayStr,
        il: '',
        komiteSifresi: '',
        selectedCats: []
    });

    const cities = Object.keys(turkeyData).sort();

    useEffect(() => {
        const compsRef = ref(db, firebasePath);
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
    }, [currentUser, firebasePath]);

    // Hakem listesini yükle (hakem yönetimi için)
    useEffect(() => {
        const refsRef = ref(db, 'referees');
        const unsub = onValue(refsRef, (snap) => {
            const data = snap.val();
            if (data) {
                setReferees(
                    Object.entries(data)
                        .map(([id, r]) => ({ id, ...r }))
                        .sort((a, b) => (a.adSoyad || '').localeCompare(b.adSoyad || '', 'tr'))
                );
            } else {
                setReferees([]);
            }
        });
        return () => unsub();
    }, []);

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
                await remove(ref(db, `${firebasePath}/${id}`));
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
                komiteSifresi: comp.komiteSifresi || '',
                selectedCats: comp.kategoriler ? Object.keys(comp.kategoriler) : []
            });
        } else {
            setEditingComp(null);
            setFormData({ isim: '', baslangicTarihi: todayStr, bitisTarihi: todayStr, il: '', komiteSifresi: '', selectedCats: [] });
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
        const saveData = { isim: formData.isim, baslangicTarihi: formData.baslangicTarihi, bitisTarihi: formData.bitisTarihi, il: formData.il, komiteSifresi: formData.komiteSifresi || null };

        // Criteria'dan aktif aletleri çekmek için get kullanalım
        let liveCriteriaData = {};
        try {
            const activeYearSnap = await get(ref(db, 'criteria/activeYear'));
            const activeYear = activeYearSnap.val() || new Date().getFullYear();
            const criteriaSnap = await get(ref(db, `criteria/${activeYear}`));
            liveCriteriaData = criteriaSnap.val() || DEFAULT_CRITERIA;
        } catch (err) {
            console.error("Criteria fetch error", err);
            liveCriteriaData = DEFAULT_CRITERIA;
        }

        const generateKategoriler = (currentKategoriler = {}) => {
            const nextKategoriler = { ...currentKategoriler };
            formData.selectedCats.forEach(catKey => {
                const sourceData = liveCriteriaData[catKey] || DEFAULT_CRITERIA[catKey];
                const activeAletler = Object.keys(sourceData || {}).filter(k => k !== 'metadata' && sourceData[k].isActive !== false);

                if (!nextKategoriler[catKey]) {
                    nextKategoriler[catKey] = { name: getCategoryLabel(catKey), aletler: activeAletler };
                } else {
                    nextKategoriler[catKey].aletler = activeAletler;
                }
            });
            Object.keys(nextKategoriler).forEach(catKey => {
                if (!formData.selectedCats.includes(catKey)) delete nextKategoriler[catKey];
            });
            return nextKategoriler;
        };

        try {
            if (editingComp) {
                await update(ref(db, `${firebasePath}/${editingComp.id}`), { ...saveData, kategoriler: generateKategoriler(editingComp.kategoriler || {}) });
                logAction('competition_update', `Yarışma güncellendi: ${saveData.isim}`, { user: currentUser?.kullaniciAdi || 'admin', competitionId: editingComp.id });
            } else {
                const newRef = push(ref(db, firebasePath));
                await set(newRef, { ...saveData, kategoriler: generateKategoriler({}), sporcular: {}, epanelToken: generateEPanelToken() });
                logAction('competition_create', `Yeni yarışma: ${saveData.isim} (${saveData.il})`, { user: currentUser?.kullaniciAdi || 'admin', competitionId: newRef.key });
            }
            setIsModalOpen(false);
        } catch (err) {
            if (import.meta.env.DEV) console.error("Save error", err);
            toast("Kaydetme işlemi başarısız oldu.", "error");
        }
    };

    // ── Hakem Yönetimi Modal ──
    const normalizeHakemler = (hakemler) => {
        // Eski format: hakemler[cat][alet][panel] = "string name"
        // Yeni format: hakemler[cat][alet][panel] = {id, name}
        if (!hakemler || typeof hakemler !== 'object') return {};
        const normalized = {};
        try {
            Object.entries(hakemler).forEach(([catId, catObj]) => {
                if (!catObj || typeof catObj !== 'object') return;
                normalized[catId] = {};
                Object.entries(catObj).forEach(([aletId, aletObj]) => {
                    if (!aletObj || typeof aletObj !== 'object') return;
                    normalized[catId][aletId] = {};
                    Object.entries(aletObj).forEach(([panelId, val]) => {
                        if (typeof val === 'string') {
                            // Eski format: sadece isim
                            normalized[catId][aletId][panelId] = { id: '', name: val };
                        } else if (val && typeof val === 'object' && val.name) {
                            normalized[catId][aletId][panelId] = val;
                        }
                    });
                });
            });
        } catch { /* ignore */ }
        return normalized;
    };

    const openHakemModal = (comp) => {
        setHakemModalComp(comp);
        const cats = comp.kategoriler ? Object.keys(comp.kategoriler) : [];
        setHakemModalCat(cats[0] || '');
        setHakemSayisi(comp.hakemSayisi || 4);
        setHakemAtama(normalizeHakemler(comp.hakemler));
    };

    const closeHakemModal = () => {
        setHakemModalComp(null);
        setHakemModalCat('');
    };

    const handleHakemAssign = (catId, aletId, panelId, refereeId) => {
        const referee = referees.find(r => r.id === refereeId);
        setHakemAtama(prev => {
            const next = { ...prev };
            if (!next[catId]) next[catId] = {};
            if (!next[catId][aletId]) next[catId][aletId] = {};
            if (refereeId) {
                next[catId][aletId][panelId] = { id: refereeId, name: referee?.adSoyad || 'Bilinmiyor' };
            } else {
                delete next[catId][aletId][panelId];
                // Clean up empty objects
                if (Object.keys(next[catId][aletId]).length === 0) delete next[catId][aletId];
                if (Object.keys(next[catId]).length === 0) delete next[catId];
            }
            return next;
        });
    };

    const copyHakemToAllApparatus = (catId, sourceAletId) => {
        const sourceAssignments = hakemAtama?.[catId]?.[sourceAletId];
        if (!sourceAssignments) return;
        const comp = hakemModalComp;
        const aletler = getCompAletler(comp, catId);
        setHakemAtama(prev => {
            const next = { ...prev };
            if (!next[catId]) next[catId] = {};
            aletler.forEach(alet => {
                if (alet !== sourceAletId) {
                    next[catId][alet] = { ...sourceAssignments };
                }
            });
            return next;
        });
        toast("Hakem ataması tüm aletlere kopyalandı.", "success");
    };

    const saveHakemSettings = async () => {
        if (!hakemModalComp) return;
        setHakemSaving(true);
        try {
            await update(ref(db, `${firebasePath}/${hakemModalComp.id}`), {
                hakemSayisi: hakemSayisi,
                hakemler: hakemAtama
            });
            toast("Hakem ayarları kaydedildi.", "success");
            closeHakemModal();
        } catch (err) {
            console.error("Hakem save error", err);
            toast("Hakem ayarları kaydedilemedi.", "error");
        } finally {
            setHakemSaving(false);
        }
    };

    const getCompAletler = (comp, catId) => {
        try {
            if (!comp?.kategoriler?.[catId]) {
                const def = DEFAULT_CRITERIA[catId];
                if (def) return Object.keys(def).filter(k => k !== 'metadata' && k !== 'eksikKesintiTiers');
                return [];
            }
            const raw = comp.kategoriler[catId].aletler;
            const normalize = (arr) => arr.map(a => {
                if (typeof a === 'string') return a;
                if (a && typeof a === 'object' && a.id) return a.id;
                return null;
            }).filter(Boolean);

            if (Array.isArray(raw)) return normalize(raw);
            if (raw && typeof raw === 'object') return normalize(Object.values(raw));
            // Fallback: DEFAULT_CRITERIA
            const def = DEFAULT_CRITERIA[catId];
            if (def) return Object.keys(def).filter(k => k !== 'metadata' && k !== 'eksikKesintiTiers');
            return [];
        } catch { return []; }
    };

    const getAssignedCount = (comp) => {
        try {
            const h = comp.hakemler;
            if (!h || typeof h !== 'object') return 0;
            let count = 0;
            Object.values(h).forEach(catObj => {
                if (catObj && typeof catObj === 'object') {
                    Object.values(catObj).forEach(aletObj => {
                        if (aletObj && typeof aletObj === 'object') {
                            count += Object.keys(aletObj).length;
                        }
                    });
                }
            });
            return count;
        } catch { return 0; }
    };

    const getCategoryLabel = (catKey) => catKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    const getAletDisplayName = (comp, catId, aletId) => {
        try {
            const raw = comp?.kategoriler?.[catId]?.aletler;
            const arr = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
            const found = arr.find(a => (typeof a === 'object' && a?.id === aletId));
            if (found?.name) return found.name;
        } catch { /* ignore */ }
        return aletId.charAt(0).toUpperCase() + aletId.slice(1);
    };

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
                {hasPermission('competitions', 'duzenle') && (
                    <button className="comp-card__hakem-btn" onClick={() => openHakemModal(comp)}>
                        <i className="material-icons-round">gavel</i>
                        <span>Hakem Yönetimi</span>
                        {getAssignedCount(comp) > 0 && (
                            <span className="hakem-count-badge">{getAssignedCount(comp)}</span>
                        )}
                    </button>
                )}
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
                    <button className="back-btn" onClick={() => navigate(routePrefix)}>
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

            {/* Hakem Yönetimi Modal */}
            {hakemModalComp && (
                <div className="modal-overlay" onClick={closeHakemModal}>
                    <div className="modal hakem-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal__header">
                            <div>
                                <h2><i className="material-icons-round" style={{verticalAlign:'middle',marginRight:8,fontSize:'1.3rem'}}>gavel</i>Hakem Yönetimi</h2>
                                <p className="hakem-modal-subtitle">{hakemModalComp.name}</p>
                            </div>
                            <button className="modal__close" onClick={closeHakemModal}><i className="material-icons-round">close</i></button>
                        </div>

                        <div className="hakem-modal-body">
                            {/* Hakem Sayısı Seçimi */}
                            <div className="hakem-sayisi-section">
                                <label className="hakem-section-label">
                                    <i className="material-icons-round">groups</i>
                                    E-Panel Hakem Sayısı
                                </label>
                                <div className="hakem-sayisi-pills">
                                    {HAKEM_SAYISI_OPTIONS.map(n => (
                                        <button
                                            key={n}
                                            className={`hsayisi-pill ${hakemSayisi === n ? 'active' : ''}`}
                                            onClick={() => setHakemSayisi(n)}
                                        >
                                            {n} Hakem
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Kategori Tabs */}
                            {hakemModalComp.kategoriler && Object.keys(hakemModalComp.kategoriler).length > 0 ? (
                                <>
                                    <div className="hakem-cat-tabs">
                                        {Object.keys(hakemModalComp.kategoriler).map(catId => (
                                            <button
                                                key={catId}
                                                className={`hcat-tab ${hakemModalCat === catId ? 'active' : ''}`}
                                                onClick={() => setHakemModalCat(catId)}
                                            >
                                                {getCategoryLabel(catId)}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Alet Bazlı Hakem Atama */}
                                    {hakemModalCat && (
                                        <div className="hakem-alet-list">
                                            {getCompAletler(hakemModalComp, hakemModalCat).map(aletId => (
                                                <div key={aletId} className="hakem-alet-card">
                                                    <div className="halet-header">
                                                        <h4 className="halet-name">
                                                            <i className="material-icons-round">fitness_center</i>
                                                            {getAletDisplayName(hakemModalComp, hakemModalCat, aletId)}
                                                        </h4>
                                                        <button
                                                            className="halet-copy-btn"
                                                            onClick={() => copyHakemToAllApparatus(hakemModalCat, aletId)}
                                                            title="Bu atamaları tüm aletlere kopyala"
                                                        >
                                                            <i className="material-icons-round">content_copy</i>
                                                            Tümüne Kopyala
                                                        </button>
                                                    </div>
                                                    <div className="halet-panels">
                                                        {Array.from({ length: hakemSayisi }, (_, i) => {
                                                            const panelId = `e${i + 1}`;
                                                            const assigned = hakemAtama?.[hakemModalCat]?.[aletId]?.[panelId];
                                                            return (
                                                                <div key={panelId} className="hpanel-slot">
                                                                    <div className="hpanel-label">{panelId.toUpperCase()}</div>
                                                                    <select
                                                                        className="hpanel-select"
                                                                        value={assigned?.id || ''}
                                                                        onChange={e => handleHakemAssign(hakemModalCat, aletId, panelId, e.target.value)}
                                                                    >
                                                                        <option value="">— Hakem Seç —</option>
                                                                        {referees.map(r => (
                                                                            <option key={r.id} value={r.id}>{r.adSoyad}</option>
                                                                        ))}
                                                                    </select>
                                                                    {assigned && (
                                                                        <span className="hpanel-assigned-name">{assigned.name}</span>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="hakem-empty">
                                    <i className="material-icons-round">info</i>
                                    <p>Bu yarışmada henüz kategori tanımlanmamış.</p>
                                </div>
                            )}
                        </div>

                        <div className="modal__footer">
                            <button type="button" className="btn btn--secondary" onClick={closeHakemModal}>İptal</button>
                            <button
                                type="button"
                                className="btn btn--primary"
                                onClick={saveHakemSettings}
                                disabled={hakemSaving}
                            >
                                {hakemSaving ? 'Kaydediliyor...' : 'Kaydet'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
                            <div className="form-group form-group--full">
                                <label><i className="material-icons-round" style={{fontSize:'1rem',verticalAlign:'middle',marginRight:4}}>lock</i>Komite Şifresi (Puan Kilidi)</label>
                                <input type="text" placeholder="Puan kilidini açmak için kullanılacak şifre" value={formData.komiteSifresi} onChange={e => setFormData({ ...formData, komiteSifresi: e.target.value })} />
                                <p className="help-text">Kaydedilen puanları düzenlemek için bu şifre veya süper admin şifresi gerekir.</p>
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
