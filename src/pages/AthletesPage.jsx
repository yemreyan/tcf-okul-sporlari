import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, remove, push, set, update } from 'firebase/database';
import { db } from '../lib/firebase';
import * as XLSX from 'xlsx';
import './AthletesPage.css';

export default function AthletesPage() {
    const navigate = useNavigate();
    const [competitions, setCompetitions] = useState({});
    const [selectedCompId, setSelectedCompId] = useState('');

    const [athletes, setAthletes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('');

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingAthlete, setEditingAthlete] = useState(null); // null = new, object = edit

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
        const compsRef = ref(db, 'competitions');
        const unsubscribe = onValue(compsRef, (snap) => {
            const data = snap.val() || {};
            setCompetitions(data);
        });
        return () => unsubscribe();
    }, []);

    // Seçilen yarışmaya göre sporcuları yükle
    useEffect(() => {
        if (!selectedCompId) {
            setAthletes([]);
            return;
        }

        setLoading(true);
        const athletesRef = ref(db, `competitions/${selectedCompId}/sporcular`);

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
        if (window.confirm(`${name} isimli sporcuyu silmek istediğinize emin misiniz?`)) {
            try {
                const athRef = ref(db, `competitions/${selectedCompId}/sporcular/${catId}/${athId}`);
                await remove(athRef);
            } catch (err) {
                console.error("Delete failed", err);
                alert("Silme işlemi başarısız.");
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
        if (!selectedCompId) return alert("Önce bir yarışma seçmelisiniz.");
        if (!formData.categoryId) return alert("Kategori seçimi zorunludur.");

        try {
            if (editingAthlete) {
                // Kategori değiştiyse eski yerden sil, yeni yere ekle
                if (editingAthlete.categoryId !== formData.categoryId) {
                    await remove(ref(db, `competitions/${selectedCompId}/sporcular/${editingAthlete.categoryId}/${editingAthlete.id}`));
                    await set(ref(db, `competitions/${selectedCompId}/sporcular/${formData.categoryId}/${editingAthlete.id}`), {
                        ...formData,
                        sirasi: editingAthlete.sirasi || 999
                    });
                } else {
                    // Sadece güncelle
                    await update(ref(db, `competitions/${selectedCompId}/sporcular/${formData.categoryId}/${editingAthlete.id}`), formData);
                }
            } else {
                // Yeni Ekle
                const newRef = push(ref(db, `competitions/${selectedCompId}/sporcular/${formData.categoryId}`));
                await set(newRef, {
                    ...formData,
                    sirasi: 999
                });
            }
            setIsModalOpen(false);
        } catch (err) {
            console.error("Save error:", err);
            alert("Kaydedilirken hata oluştu.");
        }
    };

    const handleExcelImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!selectedCompId) {
            alert("Lütfen önce Excel'in aktarılacağı yarışmayı seçin!");
            e.target.value = null;
            return;
        }

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const bstr = evt.target.result;
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const data = XLSX.utils.sheet_to_json(ws, { defval: "" });

                if (data.length === 0) {
                    alert("Excel dosyası boş veya format hatalı.");
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
                        const newKey = push(ref(db, `competitions/${selectedCompId}/sporcular/${categoryId}`)).key;
                        updates[`competitions/${selectedCompId}/sporcular/${categoryId}/${newKey}`] = {
                            ad, soyad, tckn, lisans, dob, okul, il, yarismaTuru,
                            sirasi: 999,
                            appId: "excel_import"
                        };
                        addedCount++;
                    }
                });

                if (Object.keys(updates).length > 0) {
                    await update(ref(db), updates);
                    alert(`${addedCount} sporcu başarıyla içeri aktarıldı!`);
                } else {
                    alert("Geçerli veri bulunamadı. Lütfen Excel sütun başlıklarını kontrol edin (Ad, Soyad, Kategori zorunlu).");
                }
            } catch (error) {
                console.error("Excel import error", error);
                alert("Excel aktarımında bir hata meydana geldi.");
            }
            e.target.value = null; // reset input
        };
        reader.readAsBinaryString(file);
    };

    const compOptions = Object.entries(competitions)
        .sort((a, b) => new Date(b[1].tarih) - new Date(a[1].tarih));

    const filteredAthletes = athletes.filter(ath => {
        const fullName = `${ath.ad || ''} ${ath.soyad || ''}`.toLowerCase();
        const searchLower = searchTerm.toLowerCase();

        const matchesSearch = fullName.includes(searchLower) ||
            (ath.okul && ath.okul.toLowerCase().includes(searchLower)) ||
            (ath.tckn && ath.tckn.includes(searchLower));

        const matchesCategory = filterCategory === '' || ath.categoryId === filterCategory;

        return matchesSearch && matchesCategory;
    });

    const uniqueCategories = [...new Set(athletes.map(a => a.categoryId))];

    return (
        <div className="athletes-page">
            <header className="page-header">
                <div className="page-header__left">
                    <button className="back-btn" onClick={() => navigate('/')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div className="header-title-wrapper">
                        <h1 className="page-title">Sporcular</h1>
                        <p className="page-subtitle">Onaylı sporcu listesi ve yönetimi</p>
                    </div>
                </div>
                <div className="page-header__right">
                    <input
                        type="file"
                        accept=".xlsx, .xls"
                        style={{ display: 'none' }}
                        ref={fileInputRef}
                        onChange={handleExcelImport}
                    />
                    <button
                        className="action-btn-outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!selectedCompId}
                        title={!selectedCompId ? "Önce Yarışma Seçin" : "Excel Aktar"}
                    >
                        <i className="material-icons-round">upload_file</i>
                        <span>Excel Aktar</span>
                    </button>

                    <button
                        className="create-btn"
                        onClick={() => openModal()}
                        disabled={!selectedCompId}
                    >
                        <i className="material-icons-round">person_add</i>
                        <span>Manuel Ekle</span>
                    </button>
                </div>
            </header>

            <main className="page-content">
                <div className="athletes-controls">
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
                                                <button className="edit-btn" onClick={() => openModal(ath)} title="Düzenle">
                                                    <i className="material-icons-round">edit</i>
                                                </button>
                                                <button className="del-btn" onClick={() => handleDelete(ath.categoryId, ath.id, `${ath.ad} ${ath.soyad}`)} title="Sil">
                                                    <i className="material-icons-round">delete_outline</i>
                                                </button>
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
        </div>
    );
}
