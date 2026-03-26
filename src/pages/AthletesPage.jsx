import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, remove, push, set, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
// XLSX — sadece Excel upload sırasında dynamic import ile yüklenir
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { useDiscipline } from '../lib/DisciplineContext';
import './AthletesPage.css';

export default function AthletesPage() {
    const navigate = useNavigate();
    const { currentUser, hasPermission } = useAuth();
    const { toast, confirm } = useNotification();
    const { firebasePath, routePrefix } = useDiscipline();
    const [competitions, setCompetitions] = useState({});
    const [selectedCompId, setSelectedCompId] = useState('');

    const [athletes, setAthletes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filterCity, setFilterCity] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('');

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingAthlete, setEditingAthlete] = useState(null); // null = new, object = edit

    // Global Search State
    const [isGlobalModalOpen, setIsGlobalModalOpen] = useState(false);
    const [globalSearchText, setGlobalSearchText] = useState('');

    // Form State
    const [formData, setFormData] = useState({
        ad: '',
        soyad: '',
        tckn: '',
        lisans: '',
        dob: '',
        okul: '',
        il: '',
        categoryId: '',
        yarismaTuru: 'ferdi'
    });

    const fileInputRef = useRef(null);

    // Sadece yarışma listesini yükle
    useEffect(() => {
        const compsRef = ref(db, firebasePath);
        const unsubscribe = onValue(compsRef, (snap) => {
            const data = snap.val() || {};
            setCompetitions(filterCompetitionsByUser(data, currentUser));
        });
        return () => unsubscribe();
    }, [currentUser, firebasePath]);

    // Seçilen yarışmaya göre sporcuları yükle
    useEffect(() => {
        if (!selectedCompId) {
            setAthletes([]);
            return;
        }

        setLoading(true);
        const athletesRef = ref(db, `${firebasePath}/${selectedCompId}/sporcular`);

        const unsubscribe = onValue(athletesRef, (snapshot) => {
            const data = snapshot.val();
            const loadedAthletes = [];

            if (data) {
                Object.keys(data).forEach(catId => {
                    const categoryAthletes = data[catId];
                    Object.keys(categoryAthletes).forEach(athId => {
                        const athData = categoryAthletes[athId];
                        loadedAthletes.push({
                            id: athId,
                            categoryId: catId,
                            ...athData
                        });
                    });
                });
            }

            loadedAthletes.sort((a, b) => {
                const nameA = `${a.ad} ${a.soyad}`.toLowerCase();
                const nameB = `${b.ad} ${b.soyad}`.toLowerCase();
                return nameA.localeCompare(nameB);
            });

            setAthletes(loadedAthletes);
            setLoading(false);
        }, (error) => {
            console.error("Firebase fetch error:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [selectedCompId]);

    const handleDelete = async (catId, athId, name) => {
        const confirmed = await confirm(`${name} isimli sporcuyu silmek istediğinize emin misiniz?`, { title: 'Silme Onayı', type: 'danger' });
        if (confirmed) {
            try {
                const athRef = ref(db, `${firebasePath}/${selectedCompId}/sporcular/${catId}/${athId}`);
                await remove(athRef);
            } catch (err) {
                console.error("Delete failed", err);
                toast("Silme işlemi başarısız.", "error");
            }
        }
    };

    const openModal = (athlete = null) => {
        if (athlete) {
            setEditingAthlete(athlete);
            setFormData({
                ad: athlete.ad || '',
                soyad: athlete.soyad || '',
                tckn: athlete.tckn || '',
                lisans: athlete.lisans || '',
                dob: athlete.dob || '',
                okul: athlete.okul || '',
                il: athlete.il || '',
                categoryId: athlete.categoryId || '',
                yarismaTuru: athlete.yarismaTuru || 'ferdi'
            });
        } else {
            setEditingAthlete(null);
            setFormData({
                ad: '',
                soyad: '',
                tckn: '',
                lisans: '',
                dob: '',
                okul: '',
                il: '',
                categoryId: filterCategory || '',
                yarismaTuru: 'ferdi'
            });
        }
        setIsModalOpen(true);
    };

    const saveAthlete = async (e) => {
        e.preventDefault();
        if (!selectedCompId) return toast("Önce bir yarışma seçmelisiniz.", "warning");
        if (!formData.categoryId) return toast("Kategori seçimi zorunludur.", "warning");

        try {
            if (editingAthlete) {
                // Kategori değiştiyse eski yerden sil, yeni yere ekle
                if (editingAthlete.categoryId !== formData.categoryId) {
                    const oldCatId = editingAthlete.categoryId;
                    const newCatId = formData.categoryId;
                    const athId = editingAthlete.id;

                    // Sporcuyu eski kategoriden sil, yeni kategoriye ekle
                    const updates = {};
                    updates[`${firebasePath}/${selectedCompId}/sporcular/${oldCatId}/${athId}`] = null;
                    updates[`${firebasePath}/${selectedCompId}/sporcular/${newCatId}/${athId}`] = {
                        ...formData,
                        id: athId,
                        adSoyad: `${formData.ad} ${formData.soyad}`.trim(),
                        soyadAd: `${formData.soyad} ${formData.ad}`.trim(),
                        sirasi: editingAthlete.sirasi || 999
                    };

                    // Eski kategorideki puanları da taşı
                    const oldScoresSnap = await get(ref(db, `${firebasePath}/${selectedCompId}/puanlar/${oldCatId}`));
                    if (oldScoresSnap.exists()) {
                        const oldScores = oldScoresSnap.val();
                        Object.keys(oldScores).forEach(aletId => {
                            if (oldScores[aletId]?.[athId]) {
                                updates[`${firebasePath}/${selectedCompId}/puanlar/${oldCatId}/${aletId}/${athId}`] = null;
                                updates[`${firebasePath}/${selectedCompId}/puanlar/${newCatId}/${aletId}/${athId}`] = oldScores[aletId][athId];
                            }
                        });
                    }

                    await update(ref(db), updates);
                } else {
                    // Sadece güncelle
                    await update(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${formData.categoryId}/${editingAthlete.id}`), formData);
                }
            } else {
                // Yeni Ekle
                const newRef = push(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${formData.categoryId}`));
                await set(newRef, {
                    ...formData,
                    id: newRef.key,
                    adSoyad: `${formData.ad} ${formData.soyad}`.trim(),
                    soyadAd: `${formData.soyad} ${formData.ad}`.trim(),
                    sirasi: 999
                });
            }
            setIsModalOpen(false);
        } catch (err) {
            console.error("Save error:", err);
            toast("Kaydedilirken hata oluştu.", "error");
        }
    };

    const handleExcelImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!selectedCompId) {
            toast("Lütfen önce Excel'in aktarılacağı yarışmayı seçin!", "warning");
            e.target.value = null;
            return;
        }

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const bstr = evt.target.result;
                const XLSX = await import('xlsx');
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const data = XLSX.utils.sheet_to_json(ws, { defval: "" });

                if (data.length === 0) {
                    toast("Excel dosyası boş veya format hatalı.", "error");
                    return;
                }

                let addedCount = 0;
                const updates = {};

                data.forEach(row => {
                    // Beklenen Sütunlar: Ad, Soyad, TC, Lisans, DogumTarihi, Okul, Il, Kategori, Tur
                    const ad = row['Ad'] || row['AD'] || '';
                    const soyad = row['Soyad'] || row['SOYAD'] || '';
                    const tckn = row['TC'] || row['TCKN'] || '';
                    const lisans = row['Lisans'] || row['LİSANS'] || '';
                    const dob = row['DogumTarihi'] || row['D.Tarihi'] || row['Doğum Tarihi'] || '';
                    const okul = row['Okul'] || row['OKUL'] || '';
                    const il = row['Il'] || row['İL'] || row['İl'] || '';
                    const categoryId = row['Kategori'] || row['KATEGORİ'] || '';
                    const yarismaTuru = (row['Tur'] || row['TÜR'] || row['Tür'] || 'ferdi').toLowerCase();

                    if (ad && soyad && categoryId) {
                        const newKey = push(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${categoryId}`)).key;
                        updates[`${firebasePath}/${selectedCompId}/sporcular/${categoryId}/${newKey}`] = {
                            ad, soyad, tckn, lisans, dob, okul, il, yarismaTuru,
                            sirasi: 999,
                            appId: "excel_import"
                        };
                        addedCount++;
                    }
                });

                if (Object.keys(updates).length > 0) {
                    await update(ref(db), updates);
                    toast(`${addedCount} sporcu başarıyla içeri aktarıldı!`, "success");
                } else {
                    toast("Geçerli veri bulunamadı. Lütfen Excel sütun başlıklarını kontrol edin (Ad, Soyad, Kategori zorunlu).", "warning");
                }
            } catch (error) {
                console.error("Excel import error", error);
                toast("Excel aktarımında bir hata meydana geldi.", "error");
            }
            e.target.value = null; // reset input
        };
        reader.readAsBinaryString(file);
    };

    const availableCities = [...new Set(Object.values(competitions).map(c => c.il || c.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr-TR'));

    const compOptions = Object.entries(competitions)
        .filter(([id, comp]) => !filterCity || (comp.il || comp.city) === filterCity)
        .sort((a, b) => new Date(b[1].tarih || b[1].baslangicTarihi || 0) - new Date(a[1].tarih || a[1].baslangicTarihi || 0));

    // Global Search Logic
    const globalSearchResults = useMemo(() => {
        if (!globalSearchText || globalSearchText.length < 3) return [];
        const resultsMap = {};
        const searchLower = globalSearchText.toLowerCase();

        Object.entries(competitions).forEach(([compId, comp]) => {
            if (comp.sporcular) {
                Object.entries(comp.sporcular).forEach(([catId, athletesCat]) => {
                    Object.entries(athletesCat).forEach(([athId, ath]) => {
                        const fullName = `${ath.ad || ''} ${ath.soyad || ''}`.toLowerCase();
                        if (
                            fullName.includes(searchLower) ||
                            (ath.tckn && String(ath.tckn).includes(searchLower)) ||
                            (ath.lisans && String(ath.lisans).includes(searchLower))
                        ) {
                            const adSafe = String(ath.ad || '').trim().toLowerCase();
                            const soyadSafe = String(ath.soyad || '').trim().toLowerCase();
                            const uniqueKey = `${adSafe}_${soyadSafe}_${ath.dob || ath.tckn || ath.lisans || ''}`;
                            if (!resultsMap[uniqueKey]) {
                                resultsMap[uniqueKey] = {
                                    athlete: ath,
                                    competitions: []
                                };
                            }
                            if (!resultsMap[uniqueKey].competitions.some(c => c.compId === compId)) {
                                resultsMap[uniqueKey].competitions.push({
                                    compId,
                                    compName: comp.isim,
                                    date: new Date(comp.tarih || comp.baslangicTarihi || 0),
                                    catId,
                                    okul: ath.okul || ath.kulup || '',
                                    id: athId
                                });
                            }
                        }
                    });
                });
            }
        });

        const resultsArray = Object.values(resultsMap);
        resultsArray.forEach(res => {
            res.competitions.sort((a, b) => b.date - a.date);
        });

        return resultsArray.sort((a, b) => {
            const nameA = `${a.athlete.ad} ${a.athlete.soyad}`.toLowerCase();
            const nameB = `${b.athlete.ad} ${b.athlete.soyad}`.toLowerCase();
            return nameA.localeCompare(nameB);
        });
    }, [competitions, globalSearchText]);

    const filteredAthletes = athletes.filter(ath => {
        const fullName = `${ath.ad || ''} ${ath.soyad || ''}`.toLowerCase();
        const searchLower = searchTerm.toLowerCase();

        const matchesSearch = fullName.includes(searchLower) ||
            (ath.okul && String(ath.okul).toLowerCase().includes(searchLower)) ||
            (ath.tckn && String(ath.tckn).includes(searchLower));

        const matchesCategory = filterCategory === '' || ath.categoryId === filterCategory;

        return matchesSearch && matchesCategory;
    });

    const uniqueCategories = [...new Set(athletes.map(a => a.categoryId))];

    return (
        <div className="athletes-page">
            <header className="page-header">
                <div className="page-header__left">
                    <button className="back-btn" onClick={() => navigate(routePrefix)}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div className="header-title-wrapper">
                        <h1 className="page-title">Sporcular</h1>
                        <p className="page-subtitle">Onaylı sporcu listesi ve yönetimi</p>
                    </div>
                </div>
                <div className="page-header__right">
                    <button
                        className="action-btn-outline"
                        style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
                        onClick={() => { setIsGlobalModalOpen(true); setGlobalSearchText(''); }}
                    >
                        <i className="material-icons-round">travel_explore</i>
                        <span>Tüm Yarışmalarda Ara</span>
                    </button>
                    <input
                        type="file"
                        accept=".xlsx, .xls"
                        style={{ display: 'none' }}
                        ref={fileInputRef}
                        onChange={handleExcelImport}
                    />
                    {hasPermission('athletes', 'ekle') && (
                        <button
                            className="action-btn-outline"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={!selectedCompId}
                            title={!selectedCompId ? "Önce Yarışma Seçin" : "Excel Aktar"}
                        >
                            <i className="material-icons-round">upload_file</i>
                            <span>Excel Aktar</span>
                        </button>
                    )}

                    {hasPermission('athletes', 'ekle') && (
                        <button
                            className="create-btn"
                            onClick={() => openModal()}
                            disabled={!selectedCompId}
                        >
                            <i className="material-icons-round">person_add</i>
                            <span>Manuel Ekle</span>
                        </button>
                    )}
                </div>
            </header>

            <main className="page-content">
                <div className="athletes-controls">
                    <div className="control-group">
                        <i className="material-icons-round control-icon">place</i>
                        <select
                            className="control-select"
                            value={filterCity}
                            onChange={(e) => { setFilterCity(e.target.value); setSelectedCompId(''); }}
                        >
                            <option value="">-- Tüm İller --</option>
                            {availableCities.map(city => (
                                <option key={city} value={city}>{city}</option>
                            ))}
                        </select>
                    </div>

                    <div className="control-group">
                        <i className="material-icons-round control-icon">emoji_events</i>
                        <select
                            className="control-select"
                            value={selectedCompId}
                            onChange={(e) => setSelectedCompId(e.target.value)}
                        >
                            <option value="">-- Yarışma Seçiniz --</option>
                            {compOptions.map(([id, comp]) => (
                                <option key={id} value={id}>{comp.isim}</option>
                            ))}
                        </select>
                    </div>

                    <div className="control-group">
                        <i className="material-icons-round control-icon">search</i>
                        <input
                            type="text"
                            className="control-input"
                            placeholder="Sporcu adı, okul veya TC ara..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            disabled={!selectedCompId}
                        />
                    </div>

                    <div className="control-group">
                        <i className="material-icons-round control-icon">category</i>
                        <select
                            className="control-select"
                            value={filterCategory}
                            onChange={(e) => setFilterCategory(e.target.value)}
                            disabled={!selectedCompId || uniqueCategories.length === 0}
                        >
                            <option value="">-- Tüm Kategoriler --</option>
                            {uniqueCategories.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {loading ? (
                    <div className="loading-state">
                        <div className="spinner"></div>
                        <p>Sporcular yükleniyor...</p>
                    </div>
                ) : !selectedCompId ? (
                    <div className="empty-state">
                        <div className="empty-state__icon">
                            <i className="material-icons-round">touch_app</i>
                        </div>
                        <p>Sporcuları görüntülemek için lütfen bir yarışma seçin.</p>
                    </div>
                ) : (
                    <div className="athletes-container">
                        <div className="athletes-stats">
                            <div className="stat-pill">Toplam: <strong>{athletes.length}</strong> Sporcu</div>
                            <div className="stat-pill">Bulunan: <strong>{filteredAthletes.length}</strong> Sonuç</div>
                        </div>

                        {filteredAthletes.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-state__icon">
                                    <i className="material-icons-round">groups</i>
                                </div>
                                <p>Arama kriterlerine uygun sporcu bulunamadı.</p>
                            </div>
                        ) : (
                            <div className="athletes-grid">
                                {filteredAthletes.map((ath, index) => (
                                    <div className="athlete-card" key={ath.id} style={{ animationDelay: `${(index % 10) * 0.03}s` }}>
                                        <div className="athlete-card__header">
                                            <div className="athlete-avatar">
                                                {ath.ad ? ath.ad.charAt(0).toUpperCase() : '?'}
                                            </div>
                                            <div className="athlete-card__title">
                                                <h3>{ath.ad} {ath.soyad}</h3>
                                                <span className="athlete-cat-badge" title={ath.categoryId}>{ath.categoryId}</span>
                                            </div>
                                            <div className="athlete-actions">
                                                {hasPermission('athletes', 'duzenle') && (
                                                    <button className="edit-btn" onClick={() => openModal(ath)} title="Düzenle">
                                                        <i className="material-icons-round">edit</i>
                                                    </button>
                                                )}
                                                {hasPermission('athletes', 'sil') && (
                                                    <button className="del-btn" onClick={() => handleDelete(ath.categoryId, ath.id, `${ath.ad} ${ath.soyad}`)} title="Sil">
                                                        <i className="material-icons-round">delete_outline</i>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="athlete-card__body">
                                            <div className="detail-row">
                                                <i className="material-icons-round">school</i>
                                                <span title={ath.okul}>{ath.okul || 'Okul Belirtilmemiş'}</span>
                                            </div>
                                            <div className="detail-row">
                                                <i className="material-icons-round">badge</i>
                                                <span>TC: {ath.tckn} • Lisans: {ath.lisans}</span>
                                            </div>
                                            <div className="detail-row">
                                                <i className="material-icons-round">cake</i>
                                                <span>Doğum: {ath.dob}</span>
                                            </div>
                                            <div className="detail-row">
                                                <i className="material-icons-round">place</i>
                                                <span>{ath.il || '-'} • Tür: {ath.yarismaTuru === 'takim' ? 'TAKIM' : 'FERDİ'}</span>
                                            </div>
                                            <button
                                                className="athlete-profile-link"
                                                onClick={(e) => { e.stopPropagation(); navigate(`${routePrefix}/athlete/${selectedCompId}/${ath.categoryId}/${ath.id}`); }}
                                            >
                                                <i className="material-icons-round">person</i>
                                                Profil & Puanlar
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* Ek/Düzenle Modal */}
            {isModalOpen && (
                <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="modal modal--large" onClick={e => e.stopPropagation()}>
                        <div className="modal__header">
                            <h2>{editingAthlete ? 'Sporcu Düzenle' : 'Yeni Sporcu Ekle'}</h2>
                            <button className="modal__close" onClick={() => setIsModalOpen(false)}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>

                        <form className="modal__form-grid" onSubmit={saveAthlete}>
                            <div className="form-group">
                                <label>Ad *</label>
                                <input type="text" required value={formData.ad} onChange={e => setFormData({ ...formData, ad: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Soyad *</label>
                                <input type="text" required value={formData.soyad} onChange={e => setFormData({ ...formData, soyad: e.target.value })} />
                            </div>

                            <div className="form-group">
                                <label>Kategori (Örn: Minik A Kız) *</label>
                                <input type="text" required value={formData.categoryId} onChange={e => setFormData({ ...formData, categoryId: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Tür</label>
                                <select value={formData.yarismaTuru} onChange={e => setFormData({ ...formData, yarismaTuru: e.target.value })}>
                                    <option value="ferdi">Ferdi</option>
                                    <option value="takim">Takım</option>
                                </select>
                            </div>

                            <div className="form-group">
                                <label>TC Kimlik No</label>
                                <input type="text" value={formData.tckn} onChange={e => setFormData({ ...formData, tckn: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Lisans No</label>
                                <input type="text" value={formData.lisans} onChange={e => setFormData({ ...formData, lisans: e.target.value })} />
                            </div>

                            <div className="form-group">
                                <label>Doğum Tarihi</label>
                                <input type="date" value={formData.dob} onChange={e => setFormData({ ...formData, dob: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>İl</label>
                                <input type="text" value={formData.il} onChange={e => setFormData({ ...formData, il: e.target.value })} />
                            </div>

                            <div className="form-group form-group--full">
                                <label>Okul Adı</label>
                                <input type="text" value={formData.okul} onChange={e => setFormData({ ...formData, okul: e.target.value })} />
                            </div>

                            <div className="modal__footer">
                                <button type="button" className="btn btn--secondary" onClick={() => setIsModalOpen(false)}>İptal</button>
                                <button type="submit" className="btn btn--primary">
                                    {editingAthlete ? 'Güncelle' : 'Kaydet'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Global Search Modal */}
            {isGlobalModalOpen && (
                <div className="modal-overlay" onClick={() => setIsGlobalModalOpen(false)}>
                    <div className="modal modal--large" onClick={e => e.stopPropagation()}>
                        <div className="modal__header">
                            <h2>Tüm Yarışmalarda Sporcu Ara</h2>
                            <button className="modal__close" onClick={() => setIsGlobalModalOpen(false)}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>
                        <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.5rem' }}>
                            <div className="control-group" style={{ margin: 0, width: '100%', maxWidth: 'none' }}>
                                <i className="material-icons-round control-icon">search</i>
                                <input
                                    type="text"
                                    className="control-input"
                                    placeholder="Sporcu adı, lisans veya TC yazın (En az 3 harf)..."
                                    value={globalSearchText}
                                    onChange={(e) => setGlobalSearchText(e.target.value)}
                                    autoFocus
                                />
                            </div>

                            <div className="global-search-results" style={{ maxHeight: '60vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {globalSearchText.length > 0 && globalSearchText.length < 3 && (
                                    <p style={{ color: 'var(--text-secondary)', textAlign: 'center', margin: '2rem 0' }}>Aramak için en az 3 karakter girin.</p>
                                )}
                                {globalSearchText.length >= 3 && globalSearchResults.length === 0 && (
                                    <div className="empty-state" style={{ margin: '2rem 0' }}>
                                        <i className="material-icons-round" style={{ fontSize: '3rem', color: 'var(--text-tertiary)', marginBottom: '0.5rem' }}>person_off</i>
                                        <p>Eşleşen sporcu bulunamadı.</p>
                                    </div>
                                )}
                                {globalSearchResults.map((res, i) => (
                                    <div key={i} className="global-search-card" style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <div>
                                                <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.1rem' }}>{res.athlete.ad} {res.athlete.soyad}</h3>
                                                <p style={{ margin: '0.2rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <i className="material-icons-round" style={{ fontSize: '1rem' }}>badge</i> TC: {res.athlete.tckn || '-'} • Lisans: {res.athlete.lisans || '-'}
                                                </p>
                                            </div>
                                            <div style={{ textAlign: 'right', fontSize: '0.9rem', color: 'var(--text-tertiary)' }}>
                                                Doğum: {res.athlete.dob || '-'}
                                            </div>
                                        </div>
                                        <div style={{ marginTop: '0.5rem' }}>
                                            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Katıldığı Yarışmalar ({res.competitions.length})</h4>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                {res.competitions.map((c, j) => (
                                                    <div key={j} onClick={() => navigate(`${routePrefix}/athlete/${c.compId}/${c.catId}/${c.id}`)} style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', flexDirection: 'column', gap: '0.2rem' }} className="hover-lift">
                                                        <strong style={{ color: 'var(--primary)' }}>{c.compName}</strong>
                                                        <span style={{ color: 'var(--text-secondary)' }}>{c.catId} • {c.okul || 'Okul Yok'}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
