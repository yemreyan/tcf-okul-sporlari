import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, remove, push, set, update } from 'firebase/database';
import { db } from '../lib/firebase';
import * as XLSX from 'xlsx';
import './RefereesPage.css';

export default function RefereesPage() {
    const navigate = useNavigate();

    const [referees, setReferees] = useState([]);
    const [competitionsList, setCompetitionsList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterGender, setFilterGender] = useState('');

    // Modal & Slide-over State
    const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
    const [isAddHistoryModalOpen, setIsAddHistoryModalOpen] = useState(false);
    const [editingReferee, setEditingReferee] = useState(null);
    const [selectedReferee, setSelectedReferee] = useState(null); // Triggers slide-over

    // Form State for Add/Edit
    const [formData, setFormData] = useState({
        adSoyad: '',
        brans: 'MAG', // instead of cinsiyet
        email: '',
        telefon: ''
    });

    // Form State for Adding Past Competition manually
    const [pastCompForm, setPastCompForm] = useState({
        compName: '',
        date: '',
        role: ''
    });

    const fileInputRef = useRef(null);

    // 1. Fetch all referees
    useEffect(() => {
        const refereesRef = ref(db, 'referees');
        const unsubscribeRefs = onValue(refereesRef, (snapshot) => {
            const data = snapshot.val();
            const loadedReferees = [];

            if (data) {
                Object.keys(data).forEach(refId => {
                    loadedReferees.push({
                        id: refId,
                        gorevSayisi: 0,
                        gecmisYarismalar: [],
                        ...data[refId]
                    });
                });
            }

            // A-Z Sort by Name default
            loadedReferees.sort((a, b) => {
                const nameA = (a.adSoyad || '').toLowerCase();
                const nameB = (b.adSoyad || '').toLowerCase();
                return nameA.localeCompare(nameB);
            });

            setReferees(loadedReferees);

            // If a referee is currently selected in the slide-over, update their data
            if (selectedReferee) {
                const updatedSelected = loadedReferees.find(r => r.id === selectedReferee.id);
                if (updatedSelected) {
                    setSelectedReferee(updatedSelected);
                } else {
                    setSelectedReferee(null); // They were deleted
                }
            }

            setLoading(false);
        }, (error) => {
            console.error("Firebase fetch error:", error);
            setLoading(false);
        });

        // Fetch Competitions for the dropdown
        const compsRef = ref(db, 'competitions');
        const unsubscribeComps = onValue(compsRef, (snapshot) => {
            const data = snapshot.val();
            const list = [];
            if (data) {
                Object.keys(data).forEach(compId => {
                    list.push({
                        id: compId,
                        name: data[compId].isim || 'İsimsiz Yarışma',
                        date: data[compId].tarih || ''
                    });
                });
            }
            // newest first (assuming ID or date sorting or just alphabetical)
            list.sort((a, b) => b.name.localeCompare(a.name));
            setCompetitionsList(list);
        });

        return () => {
            unsubscribeRefs();
            unsubscribeComps();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedReferee?.id]);


    // 2. Handlers
    const handleDelete = async (refId, name) => {
        if (window.confirm(`${name} isimli hakemi kalıcı olarak silmek istediğinize emin misiniz?`)) {
            try {
                await remove(ref(db, `referees/${refId}`));
                if (selectedReferee && selectedReferee.id === refId) {
                    setSelectedReferee(null);
                }
            } catch (err) {
                console.error("Delete failed", err);
                alert("Silme işlemi başarısız.");
            }
        }
    };

    const openAddEditModal = (referee = null) => {
        if (referee) {
            setEditingReferee(referee);
            setFormData({
                adSoyad: referee.adSoyad || '',
                brans: referee.brans || 'MAG',
                email: referee.email || '',
                telefon: referee.telefon || ''
            });
        } else {
            setEditingReferee(null);
            setFormData({
                adSoyad: '',
                brans: 'MAG',
                email: '',
                telefon: ''
            });
        }
        setIsAddEditModalOpen(true);
    };

    const saveReferee = async (e) => {
        e.preventDefault();
        if (!formData.adSoyad) return alert("Ad Soyad zorunludur.");

        try {
            if (editingReferee) {
                await update(ref(db, `referees/${editingReferee.id}`), formData);
            } else {
                const newRefRef = push(ref(db, `referees`));
                await set(newRefRef, {
                    ...formData,
                    gorevSayisi: 0,
                    gecmisYarismalar: {},
                    createdAt: new Date().toISOString()
                });
            }
            setIsAddEditModalOpen(false);
        } catch (err) {
            console.error("Save failed", err);
            alert("Kaydetme işlemi başarısız oldu.");
        }
    };

    const handleAddPastCompetition = async (e) => {
        e.preventDefault();
        if (!selectedReferee) return;
        if (!pastCompForm.compName || !pastCompForm.date) return alert("Yarışma adı ve tarihi zorunludur.");

        try {
            const newCompRef = push(ref(db, `referees/${selectedReferee.id}/gecmisYarismalar`));
            await set(newCompRef, {
                compName: pastCompForm.compName,
                date: pastCompForm.date,
                role: pastCompForm.role || 'Hakem',
                addedAt: new Date().toISOString()
            });

            // Increment gorevSayisi
            const currentCount = selectedReferee.gorevSayisi || 0;
            await update(ref(db, `referees/${selectedReferee.id}`), {
                gorevSayisi: currentCount + 1
            });

            setPastCompForm({ compName: '', date: '', role: '' });
            setIsAddHistoryModalOpen(false);
        } catch (err) {
            console.error("Adding past comp failed", err);
            alert("Geçmiş görev eklenemedi.");
        }
    };


    // 3. Excel Upload Logic (Initializes stats)
    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const bstr = evt.target.result;
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const data = XLSX.utils.sheet_to_json(ws);

                if (data.length === 0) return alert("Excel dosyası boş.");

                alert(`${data.length} kayıt bulundu. Yükleme başlıyor...`);
                let successCount = 0;
                let failCount = 0;

                for (let row of data) {
                    const adSoyad = row['Ad Soyad'] || row['Adı Soyadı'] || row['İsim'] || '';
                    const rawBrans = row['Branş'] || row['Cinsiyet'] || '';
                    let brans = 'MAG'; // Default Boy's Artistic

                    const normalized = rawBrans.toString().toLowerCase().trim();
                    if (normalized.includes('k') || normalized.includes('w') || normalized.includes('kadın')) {
                        brans = 'WAG'; // Women's Artistic
                    }

                    const email = row['Email'] || row['E-mail'] || row['E-Posta'] || row['Eposta'] || '';
                    const telefon = row['Telefon'] || row['Tel'] || row['Cep'] || '';

                    if (!adSoyad) { failCount++; continue; }

                    const newRef = {
                        adSoyad: adSoyad.toString().trim(),
                        brans: brans,
                        email: email.toString().trim(),
                        telefon: telefon.toString().trim(),
                        gorevSayisi: 0,
                        createdAt: new Date().toISOString()
                    };

                    await push(ref(db, `referees`), newRef);
                    successCount++;
                }
                alert(`İşlem tamamlandı. Başarılı: ${successCount}, Başarısız: ${failCount}`);
            } catch (err) {
                console.error("Excel parse error", err);
                alert("Hata oluştu.");
            } finally {
                if (fileInputRef.current) fileInputRef.current.value = "";
            }
        };
        reader.readAsBinaryString(file);
    };


    // 4. Filtering
    const filteredReferees = referees.filter(r => {
        const matchesSearch = (r.adSoyad || '').toLowerCase().includes(searchTerm.toLowerCase());
        const matchesGender = filterGender === '' || r.brans === filterGender;
        return matchesSearch && matchesGender;
    });

    return (
        <div className="referees-page premium-layout">
            {/* Header */}
            <header className="page-header--bento premium-header">
                <div className="page-header__left">
                    <button className="back-btn back-btn--light" onClick={() => navigate('/')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div className="header-title-wrapper">
                        <h1 className="page-title text-white">Global Hakem Veritabanı</h1>
                        <p className="page-subtitle text-white-50">Kapsamlı hakem havuzu, görev istatistikleri ve geçmiş yarışma kayıtları.</p>
                    </div>
                </div>

                <div className="page-header__actions">
                    <input type="file" accept=".xlsx, .xls" style={{ display: 'none' }} ref={fileInputRef} onChange={handleFileUpload} />
                    <button className="btn-premium-secondary" onClick={() => fileInputRef.current.click()}>
                        <i className="material-icons-round">file_upload</i> Toplu Excel Yükle
                    </button>
                    <button className="btn-premium-primary" onClick={() => openAddEditModal()}>
                        <i className="material-icons-round">person_add</i> Yeni Hakem
                    </button>
                </div>
            </header>

            <main className="premium-main-content">
                {/* Master View (Left/Center) */}
                <div className={`master-view ${selectedReferee ? 'panel-open' : ''}`}>
                    {/* Filters */}
                    <div className="premium-filters glass-panel">
                        <div className="search-box premium">
                            <i className="material-icons-round search-icon">search</i>
                            <input
                                type="text"
                                placeholder="Hakem ara..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="search-input"
                            />
                        </div>
                        <select className="filter-select premium" value={filterGender} onChange={(e) => setFilterGender(e.target.value)}>
                            <option value="">Tüm Branşlar</option>
                            <option value="MAG">MAG (Erkekler)</option>
                            <option value="WAG">WAG (Kadınlar)</option>
                        </select>
                        <div className="stats-badge">
                            <i className="material-icons-round">groups</i>
                            <span>Havuz: <strong>{referees.length}</strong></span>
                        </div>
                    </div>

                    {/* Data Table / List */}
                    <div className="premium-table-wrapper glass-panel mt-4 flex-1">
                        {loading ? (
                            <div className="loading-state h-full">
                                <div className="spinner"></div><p>Veritabanı yükleniyor...</p>
                            </div>
                        ) : filteredReferees.length === 0 ? (
                            <div className="empty-state h-full">
                                <i className="material-icons-round">search_off</i>
                                <h2>Sonuç Bulunamadı</h2>
                                <p>Kriterlerinize uygun hakem verisi yok.</p>
                            </div>
                        ) : (
                            <table className="premium-table">
                                <thead>
                                    <tr>
                                        <th>Ad Soyad</th>
                                        <th>İletişim</th>
                                        <th className="text-center">Görev Sayısı</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredReferees.map(ref => (
                                        <tr
                                            key={ref.id}
                                            className={`table-row ${selectedReferee?.id === ref.id ? 'active-row' : ''}`}
                                            onClick={() => setSelectedReferee(ref)}
                                        >
                                            <td>
                                                <div className="user-cell">
                                                    <div className={`avatar__small ${ref.brans}`}>
                                                        {ref.brans === 'MAG' ? '🤸‍♂️' : '🤸‍♀️'}
                                                    </div>
                                                    <div className="user-info">
                                                        <strong>{ref.adSoyad}</strong>
                                                        <span className={`badge-branch ${ref.brans === 'MAG' ? 'mag' : 'wag'}`}>
                                                            {ref.brans} HAKEMİ
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>
                                                <div className="contact-cell">
                                                    {ref.telefon && <span className="text-sm"><i className="material-icons-round text-xs">phone</i> {ref.telefon}</span>}
                                                    {ref.email && <span className="text-sm"><i className="material-icons-round text-xs">email</i> {ref.email}</span>}
                                                </div>
                                            </td>
                                            <td className="text-center">
                                                <div className="stat-pill">
                                                    {ref.gorevSayisi || 0} Görev
                                                </div>
                                            </td>
                                            <td className="text-right pr-4">
                                                <i className="material-icons-round row-chevron text-slate-400">chevron_right</i>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                {/* Detail View (Slide-over Panel) */}
                <aside className={`slide-over-panel ${selectedReferee ? 'open' : ''}`}>
                    {selectedReferee && (
                        <div className="profile-container">
                            <div className="profile-header">
                                <button className="close-panel-btn" onClick={() => setSelectedReferee(null)}>
                                    <i className="material-icons-round">close</i> İptal
                                </button>
                                <div className="profile-actions">
                                    <button className="icon-btn" style={{ background: '#EEF2FF', color: '#4F46E5', width: 'auto', padding: '0 1rem', display: 'flex', gap: '0.5rem', fontWeight: 'bold' }} onClick={() => setIsAddHistoryModalOpen(true)} title="Görev Ekle">
                                        <i className="material-icons-round">add_circle</i> Görev Ekle
                                    </button>
                                    <button className="icon-btn edit-btn" onClick={() => openAddEditModal(selectedReferee)} title="Düzenle">
                                        <i className="material-icons-round">edit</i>
                                    </button>
                                    <button className="icon-btn delete-btn" onClick={() => handleDelete(selectedReferee.id, selectedReferee.adSoyad)} title="Sil">
                                        <i className="material-icons-round">delete_forever</i>
                                    </button>
                                </div>
                            </div>

                            <div className="profile-hero">
                                <div className={`hero-avatar ${selectedReferee.brans}`}>
                                    {selectedReferee.brans === 'MAG' ? '🤸‍♂️' : '🤸‍♀️'}
                                </div>
                                <h2 className="hero-name">{selectedReferee.adSoyad}</h2>
                                <span className={`badge-branch large ${selectedReferee.brans === 'MAG' ? 'mag' : 'wag'}`}>
                                    {selectedReferee.brans === 'MAG' ? 'Erkekler Artistik (MAG)' : 'Kadınlar Artistik (WAG)'}
                                </span>
                            </div>

                            <div className="profile-stats-grid">
                                <div className="stat-card">
                                    <div className="sc-icon blue"><i className="material-icons-round">military_tech</i></div>
                                    <div className="sc-data">
                                        <span className="sc-value">{selectedReferee.gorevSayisi || 0}</span>
                                        <span className="sc-label">Toplam Görev</span>
                                    </div>
                                </div>
                                <div className="stat-card">
                                    <div className="sc-icon green"><i className="material-icons-round">event_available</i></div>
                                    <div className="sc-data">
                                        <span className="sc-value">Aktif</span>
                                        <span className="sc-label">Durum</span>
                                    </div>
                                </div>
                            </div>

                            <div className="profile-section">
                                <h3 className="section-title">İletişim Bilgileri</h3>
                                <div className="info-list">
                                    <div className="info-item">
                                        <i className="material-icons-round">email</i>
                                        <span>{selectedReferee.email || 'Email belirtilmedi'}</span>
                                    </div>
                                    <div className="info-item">
                                        <i className="material-icons-round">phone_iphone</i>
                                        <span>{selectedReferee.telefon || 'Telefon belirtilmedi'}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="profile-section flex-1 overflow-hidden flex flex-col">
                                <h3 className="section-title flex justify-between items-center">
                                    Geçmiş Görevler (Timeline)
                                </h3>

                                <div className="timeline-container">
                                    {(!selectedReferee.gecmisYarismalar || Object.keys(selectedReferee.gecmisYarismalar).length === 0) ? (
                                        <div className="empty-timeline">
                                            <i className="material-icons-round">history_toggle_off</i>
                                            <p>Henüz görev kaydı bulunmuyor.</p>
                                        </div>
                                    ) : (
                                        <ul className="timeline-list">
                                            {Object.entries(selectedReferee.gecmisYarismalar)
                                                .sort((a, b) => new Date(b[1].date) - new Date(a[1].date))
                                                .map(([key, record]) => (
                                                    <li key={key} className="timeline-item">
                                                        <div className="tl-bullet"></div>
                                                        <div className="tl-content">
                                                            <div className="tl-date">{new Date(record.date).toLocaleDateString('tr-TR')}</div>
                                                            <div className="tl-title">{record.compName}</div>
                                                            <div className="tl-role">{record.role}</div>
                                                        </div>
                                                    </li>
                                                ))}
                                        </ul>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </aside>
            </main>

            {/* Premium Centered Modal for Add/Edit */}
            {isAddEditModalOpen && (
                <div className="premium-modal-overlay" onClick={() => setIsAddEditModalOpen(false)}>
                    <div className="premium-modal-dialog" onClick={e => e.stopPropagation()}>
                        <div className="pm-header">
                            <div className="pm-title">
                                <i className="material-icons-round">{editingReferee ? 'edit_square' : 'person_add'}</i>
                                <h2>{editingReferee ? 'Hakem Düzenle' : 'Yeni Hakem Kaydı'}</h2>
                            </div>
                            <button className="pm-close-btn" onClick={() => setIsAddEditModalOpen(false)}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>

                        <div className="pm-body">
                            <form onSubmit={saveReferee} className="pm-form">
                                <div className="pm-form-group">
                                    <label>Hakem Adı Soyadı <span className="text-red-500">*</span></label>
                                    <div className="pm-input-wrapper">
                                        <i className="material-icons-round">badge</i>
                                        <input type="text" value={formData.adSoyad} onChange={e => setFormData({ ...formData, adSoyad: e.target.value })} required placeholder="Örn: Ahmet Yılmaz" />
                                    </div>
                                </div>

                                <div className="pm-form-group">
                                    <label>Cimnastik Branşı <span className="text-red-500">*</span></label>
                                    <div className="pm-branch-selector">
                                        <label className={`branch-card mag ${formData.brans === 'MAG' ? 'active' : ''}`}>
                                            <input type="radio" name="brans" value="MAG" checked={formData.brans === 'MAG'} onChange={e => setFormData({ ...formData, brans: e.target.value })} />
                                            <div className="bc-icon">🤸‍♂️</div>
                                            <div className="bc-info">
                                                <strong>MAG</strong>
                                                <span>Erkekler Artistik</span>
                                            </div>
                                            <i className="material-icons-round check-icon">check_circle</i>
                                        </label>
                                        <label className={`branch-card wag ${formData.brans === 'WAG' ? 'active' : ''}`}>
                                            <input type="radio" name="brans" value="WAG" checked={formData.brans === 'WAG'} onChange={e => setFormData({ ...formData, brans: e.target.value })} />
                                            <div className="bc-icon">🤸‍♀️</div>
                                            <div className="bc-info">
                                                <strong>WAG</strong>
                                                <span>Kadınlar Artistik</span>
                                            </div>
                                            <i className="material-icons-round check-icon">check_circle</i>
                                        </label>
                                    </div>
                                </div>

                                <div className="pm-form-row">
                                    <div className="pm-form-group">
                                        <label>E-Posta Adresi</label>
                                        <div className="pm-input-wrapper">
                                            <i className="material-icons-round">alternate_email</i>
                                            <input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="ornek@mail.com" />
                                        </div>
                                    </div>
                                    <div className="pm-form-group">
                                        <label>Telefon Numarası</label>
                                        <div className="pm-input-wrapper">
                                            <i className="material-icons-round">phone_iphone</i>
                                            <input type="tel" value={formData.telefon} onChange={e => setFormData({ ...formData, telefon: e.target.value })} placeholder="05XX XXX XX XX" />
                                        </div>
                                    </div>
                                </div>

                                <div className="pm-footer">
                                    <button type="button" className="pm-btn-cancel" onClick={() => setIsAddEditModalOpen(false)}>İptal Et</button>
                                    <button type="submit" className="pm-btn-submit">
                                        <span>{editingReferee ? 'Değişiklikleri Kaydet' : 'Sisteme Ekle'}</span>
                                        <i className="material-icons-round">arrow_forward</i>
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* Premium Centered Modal for Add History */}
            {isAddHistoryModalOpen && (
                <div className="premium-modal-overlay" onClick={() => setIsAddHistoryModalOpen(false)}>
                    <div className="premium-modal-dialog" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
                        <div className="pm-header">
                            <div className="pm-title">
                                <i className="material-icons-round" style={{ color: '#059669', background: '#D1FAE5' }}>post_add</i>
                                <h2>Yeni Görev Ekle</h2>
                            </div>
                            <button className="pm-close-btn" onClick={() => setIsAddHistoryModalOpen(false)}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>

                        <div className="pm-body">
                            <form onSubmit={handleAddPastCompetition} className="pm-form">
                                <div className="pm-form-group">
                                    <label>Yarışma Seçimi <span className="text-red-500">*</span></label>
                                    <div className="pm-input-wrapper">
                                        <i className="material-icons-round">emoji_events</i>
                                        <select
                                            required
                                            value={pastCompForm.compName}
                                            onChange={e => {
                                                const selectedName = e.target.value;
                                                const selectedComp = competitionsList.find(c => c.name === selectedName);
                                                setPastCompForm({
                                                    ...pastCompForm,
                                                    compName: selectedName,
                                                    date: selectedComp?.date || pastCompForm.date
                                                });
                                            }}
                                            style={{ width: '100%', padding: '1rem 1rem 1rem 3rem', border: '2px solid #E2E8F0', borderRadius: '0.75rem', fontSize: '1rem', background: '#F8FAFC', outline: 'none' }}
                                        >
                                            <option value="" disabled>Sistemden Yarışma Seçin...</option>
                                            {competitionsList.map(c => (
                                                <option key={c.id} value={c.name}>{c.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="pm-form-row">
                                    <div className="pm-form-group">
                                        <label>Tarih <span className="text-red-500">*</span></label>
                                        <div className="pm-input-wrapper">
                                            <i className="material-icons-round">event</i>
                                            <input
                                                type="date"
                                                required
                                                value={pastCompForm.date}
                                                onChange={e => setPastCompForm({ ...pastCompForm, date: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div className="pm-form-group">
                                        <label>Görevi</label>
                                        <div className="pm-input-wrapper">
                                            <i className="material-icons-round">record_voice_over</i>
                                            <input
                                                type="text"
                                                placeholder="Örn: Baş Hakem"
                                                value={pastCompForm.role}
                                                onChange={e => setPastCompForm({ ...pastCompForm, role: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="pm-footer">
                                    <button type="button" className="pm-btn-cancel" onClick={() => setIsAddHistoryModalOpen(false)}>İptal</button>
                                    <button type="submit" className="pm-btn-submit">
                                        <span>Görevi Ekle</span>
                                        <i className="material-icons-round">arrow_forward</i>
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
