import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ref, onValue, push, set, remove, update } from 'firebase/database';
import { db } from '../lib/firebase';
import turkeyData from '../data/turkey_data.json';
import { DEFAULT_CRITERIA } from '../data/criteriaDefaults.js';
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
    // If we have no start date somehow, just say upcoming
    if (!baslangic) return 'upcoming';

    // Convert to midnight to easily compare purely by date
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

export default function CompetitionsPage() {
    const navigate = useNavigate();
    const [competitions, setCompetitions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState('all');
    const [filterCity, setFilterCity] = useState('all');

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
                    // Migrate old data if necessary
                    const baslangic = compData.baslangicTarihi || compData.tarih || '';
                    const bitis = compData.bitisTarihi || compData.tarih || '';

                    return {
                        id: key,
                        ...compData,
                        name: compData.isim || 'İsimsiz Yarışma',
                        baslangicTarihi: baslangic,
                        bitisTarihi: bitis,
                        city: compData.il || '',
                        status: computeStatus(baslangic, bitis),
                        categoryCount: compData.kategoriler ? Object.keys(compData.kategoriler).length : 0,
                        athleteCount: countAthletes(compData.sporcular),
                    };
                });

                compArray.sort((a, b) => new Date(b.baslangicTarihi || 0) - new Date(a.baslangicTarihi || 0));
                setCompetitions(compArray);
            } else {
                setCompetitions([]);
            }
            setLoading(false);
        }, (error) => {
            console.error("Firebase fetch error:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const handleDelete = async (id, name) => {
        if (window.confirm(`"${name}" isimli yarışmayı silmek istediğinize emin misiniz? Tüm başvuru ve sporcu verileri kalıcı olarak silinecektir!`)) {
            try {
                await remove(ref(db, `competitions/${id}`));
            } catch (err) {
                console.error("Delete failed", err);
                alert("Silme işlemi başarısız oldu.");
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
            const todayStr = new Date().toISOString().split('T')[0];
            setEditingComp(null);
            setFormData({
                isim: '',
                baslangicTarihi: todayStr,
                bitisTarihi: todayStr,
                il: '',
                selectedCats: []
            });
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

        // Prevent end date being before start date
        if (new Date(formData.bitisTarihi) < new Date(formData.baslangicTarihi)) {
            alert("Bitiş tarihi başlangıç tarihinden önce olamaz!");
            return;
        }

        const saveData = {
            isim: formData.isim,
            baslangicTarihi: formData.baslangicTarihi,
            bitisTarihi: formData.bitisTarihi,
            il: formData.il,
        };

        const generateKategoriler = (currentKategoriler = {}) => {
            const nextKategoriler = { ...currentKategoriler };

            // Add selected categories if they don't exist
            formData.selectedCats.forEach(catKey => {
                if (!nextKategoriler[catKey]) {
                    const defaultData = DEFAULT_CRITERIA[catKey];
                    // Find apparatuses for this category from default data (skip metadata)
                    const aletler = Object.keys(defaultData || {}).filter(k => k !== 'metadata');
                    nextKategoriler[catKey] = {
                        name: getCategoryLabel(catKey),
                        aletler: aletler
                    };
                }
            });

            // Remove categories that were unselected (optional: could prompt or just remove)
            Object.keys(nextKategoriler).forEach(catKey => {
                if (!formData.selectedCats.includes(catKey)) {
                    delete nextKategoriler[catKey];
                }
            });

            return nextKategoriler;
        };

        try {
            if (editingComp) {
                const updatedKategoriler = generateKategoriler(editingComp.kategoriler || {});
                await update(ref(db, `competitions/${editingComp.id}`), {
                    ...saveData,
                    kategoriler: updatedKategoriler
                });
            } else {
                const newRef = push(ref(db, 'competitions'));
                await set(newRef, {
                    ...saveData,
                    kategoriler: generateKategoriler({}),
                    sporcular: {}
                });
            }
            setIsModalOpen(false);
        } catch (err) {
            console.error("Save error", err);
            alert("Kaydetme işlemi başarısız oldu.");
        }
    };

    const getCategoryLabel = (catKey) => {
        // e.g. "minik_a_kiz" -> "Minik A Kız"
        return catKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    };

    const filteredComps = competitions.filter(comp => {
        const statusMatch = filterStatus === 'all' ? true : comp.status === filterStatus;

        let cityMatch = true;
        if (filterCity !== 'all') {
            const compCity = comp.city ? comp.city.toUpperCase() : '';
            cityMatch = compCity === filterCity.toUpperCase();
        }

        return statusMatch && cityMatch;
    });

    const statusConfig = {
        active: { label: 'Devam Ediyor', color: 'var(--green)' },
        upcoming: { label: 'Yaklaşan', color: 'var(--blue)' },
        completed: { label: 'Tamamlandı', color: 'var(--text-muted)' },
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
                    <button className="btn btn--primary" onClick={() => openModal()}>
                        <i className="material-icons-round">add</i>
                        <span>Yeni Yarışma</span>
                    </button>
                </div>
            </header>

            <main className="page-content">
                <div className="filters">
                    <button
                        className={`filter-btn ${filterStatus === 'all' ? 'filter-btn--active' : ''}`}
                        onClick={() => setFilterStatus('all')}
                    >
                        Tümü
                    </button>
                    <button
                        className={`filter-btn ${filterStatus === 'active' ? 'filter-btn--active' : ''}`}
                        onClick={() => setFilterStatus('active')}
                    >
                        Devam Edenler
                    </button>
                    <button
                        className={`filter-btn ${filterStatus === 'upcoming' ? 'filter-btn--active' : ''}`}
                        onClick={() => setFilterStatus('upcoming')}
                    >
                        Yaklaşanlar
                    </button>
                    <button
                        className={`filter-btn ${filterStatus === 'completed' ? 'filter-btn--active' : ''}`}
                        onClick={() => setFilterStatus('completed')}
                    >
                        Tamamlananlar
                    </button>

                    <div className="filter-select-wrapper">
                        <i className="material-icons-round filter-select-icon">place</i>
                        <select
                            className="filter-select"
                            value={filterCity}
                            onChange={(e) => setFilterCity(e.target.value)}
                        >
                            <option value="all">Tüm İller</option>
                            {cities.map(city => (
                                <option key={city} value={city}>{city}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {loading ? (
                    <div className="loading-state">
                        <div className="spinner"></div>
                        <p>Yarışmalar yükleniyor...</p>
                    </div>
                ) : (
                    <div className="comp-list">
                        {filteredComps.map((comp, i) => {
                            const statusKey = statusConfig[comp.status] ? comp.status : 'upcoming';
                            const conf = statusConfig[statusKey];

                            return (
                                <div
                                    key={comp.id}
                                    className="comp-card"
                                    style={{ animationDelay: `${(i % 10) * 0.05}s` }}
                                >
                                    <div className="comp-card__header">
                                        <div
                                            className="comp-card__status"
                                            style={{ backgroundColor: `${conf.color}20`, color: conf.color }}
                                        >
                                            <span className="status-dot" style={{ backgroundColor: conf.color }}></span>
                                            {conf.label}
                                        </div>
                                        <div className="comp-card__actions">
                                            <button className="icon-btn" onClick={() => openModal(comp)} title="Düzenle">
                                                <i className="material-icons-round">edit</i>
                                            </button>
                                            <button className="icon-btn icon-btn--danger" onClick={() => handleDelete(comp.id, comp.name)} title="Sil">
                                                <i className="material-icons-round">delete_outline</i>
                                            </button>
                                        </div>
                                    </div>

                                    <h2 className="comp-card__title">{comp.name}</h2>

                                    <div className="comp-card__details">
                                        <div className="detail-item">
                                            <i className="material-icons-round">calendar_month</i>
                                            <span>
                                                {comp.baslangicTarihi === comp.bitisTarihi
                                                    ? comp.baslangicTarihi
                                                    : `${comp.baslangicTarihi} / ${comp.bitisTarihi}`}
                                            </span>
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

                                    <Link to={`/w1e4r7t2.html?competitionId=${comp.id}`} className="comp-card__btn">
                                        Yönetim Paneline Git
                                        <i className="material-icons-round">arrow_forward</i>
                                    </Link>
                                </div>
                            );
                        })}

                        {filteredComps.length === 0 && (
                            <div className="empty-state">
                                <div className="empty-state__icon">
                                    <i className="material-icons-round">search_off</i>
                                </div>
                                <p>Bu filtreye uygun yarışma bulunamadı.</p>
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* Yeni / Düzenle Modal */}
            {isModalOpen && (
                <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal__header">
                            <h2>{editingComp ? 'Yarışma Düzenle' : 'Yeni Yarışma'}</h2>
                            <button className="modal__close" onClick={() => setIsModalOpen(false)}>
                                <i className="material-icons-round">close</i>
                            </button>
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
                                    {cities.map(city => (
                                        <option key={city} value={city}>{city}</option>
                                    ))}
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
                                                <div className={`checkbox-indicator ${isChecked ? 'checked' : ''}`}>
                                                    {isChecked && <i className="material-icons-round">check</i>}
                                                </div>
                                                <span>{getCategoryLabel(catKey)}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="modal__footer">
                                <button type="button" className="btn btn--secondary" onClick={() => setIsModalOpen(false)}>İptal</button>
                                <button type="submit" className="btn btn--primary">
                                    {editingComp ? 'Cüncelle' : 'Kaydet'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
