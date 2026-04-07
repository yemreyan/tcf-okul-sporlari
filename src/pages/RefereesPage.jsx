import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, remove, push, set, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { useDiscipline } from '../lib/DisciplineContext';
// XLSX — sadece Excel upload sırasında dynamic import ile yüklenir
import './RefereesPage.css';

// ─── Hakem Hesap Oluşturma Yardımcı Fonksiyonlar ───

// Türkçe karakterleri ASCII'ye çevir
function turkishToAscii(str) {
    const map = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u',
                  'Ç': 'c', 'Ğ': 'g', 'İ': 'i', 'Ö': 'o', 'Ş': 's', 'Ü': 'u' };
    return str.replace(/[çğıöşüÇĞİÖŞÜ]/g, c => map[c] || c);
}

// Ad soyad'dan kullanıcı adı oluştur: "Ahmet Yılmaz" → "ahmet.yilmaz"
function generateUsername(adSoyad) {
    const cleaned = turkishToAscii(adSoyad.trim().toLowerCase());
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'hakem';
    if (parts.length === 1) return parts[0].replace(/[^a-z0-9]/g, '');
    // İlk ad + son soyad
    const ad = parts[0].replace(/[^a-z0-9]/g, '');
    const soyad = parts[parts.length - 1].replace(/[^a-z0-9]/g, '');
    return `${ad}_${soyad}`;
}

// Basit rastgele şifre oluştur (6 karakter: harf + rakam)
function generateSimplePassword() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let pwd = '';
    for (let i = 0; i < 6; i++) {
        pwd += chars[Math.floor(Math.random() * chars.length)];
    }
    return pwd;
}

// Hakem için sadece puanlama izinleri
function createRefereePermissions() {
    return {
        competitions: { goruntule: true, olustur: false, duzenle: false, sil: false },
        applications: { goruntule: false, onayla: false, reddet: false },
        athletes: { goruntule: true, ekle: false, duzenle: false, sil: false },
        scoring: { goruntule: true, puanla: true },
        criteria: { goruntule: true, duzenle: false },
        referees: { goruntule: false, ekle: false, duzenle: false, sil: false },
        scoreboard: { goruntule: true },
        finals: { goruntule: true, duzenle: false },
        analytics: { goruntule: false },
        start_order: { goruntule: true, duzenle: false, pdf: false },
        links: { goruntule: true },
        official_report: { goruntule: false, duzenle: false, sil: false },
    };
}

export default function RefereesPage() {
    const navigate = useNavigate();
    const { hasPermission, hashPassword, isSuperAdmin } = useAuth();
    const { toast, confirm } = useNotification();
    const { firebasePath, routePrefix } = useDiscipline();

    const [referees, setReferees] = useState([]);
    const [competitionsList, setCompetitionsList] = useState([]);
    const [existingUsers, setExistingUsers] = useState({}); // kullanicilar verisi
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterGender, setFilterGender] = useState('');

    // Modal & Slide-over State
    const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
    const [isAddHistoryModalOpen, setIsAddHistoryModalOpen] = useState(false);
    const [editingReferee, setEditingReferee] = useState(null);
    const [selectedReferee, setSelectedReferee] = useState(null); // Triggers slide-over

    // Hesap oluşturma modal state
    const [credentialsModal, setCredentialsModal] = useState(null); // { username, password, adSoyad }
    const [bulkCreating, setBulkCreating] = useState(false);
    const [bulkResults, setBulkResults] = useState(null); // [{ adSoyad, username, password }]

    const [filterBrove, setFilterBrove] = useState('');

    // Form State for Add/Edit
    const [formData, setFormData] = useState({
        adSoyad: '',
        brans: 'MAG',
        il: '',
        brove: '',
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

            // A-Z Sort by Name default (Turkish locale)
            loadedReferees.sort((a, b) =>
                (a.adSoyad || '').localeCompare(b.adSoyad || '', 'tr')
            );

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
        const compsRef = ref(db, firebasePath);
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

        // Fetch existing users (to check who has an account)
        const usersRef = ref(db, 'kullanicilar');
        const unsubscribeUsers = onValue(usersRef, (snapshot) => {
            setExistingUsers(snapshot.val() || {});
        });

        return () => {
            unsubscribeRefs();
            unsubscribeComps();
            unsubscribeUsers();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedReferee?.id]);


    // 2. Handlers
    const handleDelete = async (refId, name) => {
        if (!hasPermission('referees', 'sil')) { toast('Hakem silme yetkiniz yok.', 'error'); return; }
        const ok = await confirm(`${name} isimli hakemi kalıcı olarak silmek istediğinize emin misiniz?`, { title: 'Silme Onayı', type: 'danger' });
        if (ok) {
            try {
                await remove(ref(db, `referees/${refId}`));
                if (selectedReferee && selectedReferee.id === refId) {
                    setSelectedReferee(null);
                }
            } catch (err) {
                console.error("Delete failed", err);
                toast("Silme işlemi başarısız.", "error");
            }
        }
    };

    const openAddEditModal = (referee = null) => {
        if (referee) {
            setEditingReferee(referee);
            setFormData({
                adSoyad: referee.adSoyad || '',
                brans: referee.brans || 'MAG',
                il: referee.il || '',
                brove: referee.brove || '',
                email: referee.email || '',
                telefon: referee.telefon || ''
            });
        } else {
            setEditingReferee(null);
            setFormData({
                adSoyad: '',
                brans: 'MAG',
                il: '',
                brove: '',
                email: '',
                telefon: ''
            });
        }
        setIsAddEditModalOpen(true);
    };

    const saveReferee = async (e) => {
        e.preventDefault();
        const action = editingReferee ? 'duzenle' : 'ekle';
        if (!hasPermission('referees', action)) { toast('Bu işlem için yetkiniz yok.', 'error'); return; }
        if (!formData.adSoyad) return toast("Ad Soyad zorunludur.", "warning");

        try {
            if (editingReferee) {
                await update(ref(db, `referees/${editingReferee.id}`), formData);
                setIsAddEditModalOpen(false);
            } else {
                // Yeni hakem kaydet
                const newRefRef = push(ref(db, `referees`));
                const newRefId = newRefRef.key;
                await set(newRefRef, {
                    ...formData,
                    gorevSayisi: 0,
                    gecmisYarismalar: {},
                    createdAt: new Date().toISOString()
                });
                setIsAddEditModalOpen(false);

                // Otomatik hesap oluştur
                try {
                    const newReferee = { id: newRefId, ...formData };
                    const { username, password } = await createRefereeAccount(newReferee);
                    setCredentialsModal({ username, password, adSoyad: formData.adSoyad });
                    toast(`${formData.adSoyad} kaydedildi ve giriş hesabı oluşturuldu.`, 'success');
                } catch (accErr) {
                    console.error('Auto account creation failed:', accErr);
                    toast(`Hakem kaydedildi ancak otomatik hesap oluşturulamadı.`, 'warning');
                }
            }
        } catch (err) {
            console.error("Save failed", err);
            toast("Kaydetme işlemi başarısız oldu.", "error");
        }
    };

    const handleAddPastCompetition = async (e) => {
        e.preventDefault();
        if (!hasPermission('referees', 'duzenle')) { toast('Hakem düzenleme yetkiniz yok.', 'error'); return; }
        if (!selectedReferee) return;
        if (!pastCompForm.compName || !pastCompForm.date) return toast("Yarışma adı ve tarihi zorunludur.", "warning");

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
            toast("Geçmiş görev eklenemedi.", "error");
        }
    };


    // ─── Hakem Hesabı Oluşturma ───

    // Mevcut kullanıcılar arasında çakışma kontrolü ile benzersiz username üret
    async function findUniqueUsername(adSoyad) {
        const base = generateUsername(adSoyad);
        const snapshot = await get(ref(db, 'kullanicilar'));
        const allUsers = snapshot.val() || {};
        if (!allUsers[base]) return base;
        // Çakışma varsa numara ekle
        let i = 2;
        while (allUsers[`${base}${i}`]) i++;
        return `${base}${i}`;
    }

    // Tek hakem için hesap oluştur
    async function createRefereeAccount(referee) {
        const username = await findUniqueUsername(referee.adSoyad);
        const password = generateSimplePassword();
        const sifreHash = await hashPassword(password);

        const userData = {
            rolAdi: 'Hakem',
            il: referee.il || null,
            aktif: true,
            izinler: createRefereePermissions(),
            sifreHash,
            olusturmaTarihi: new Date().toISOString(),
            hakemId: referee.id || null, // Hakem kaydı ile bağlantı
        };

        await set(ref(db, `kullanicilar/${username}`), userData);

        // Hakem kaydına kullanıcı adını kaydet
        if (referee.id) {
            await update(ref(db, `referees/${referee.id}`), { hesapKullaniciAdi: username });
        }

        return { username, password };
    }

    // Tek hakem için hesap oluştur (buton handler)
    const handleCreateAccount = async (referee) => {
        if (!hasPermission('referees', 'ekle') && !isSuperAdmin()) { toast('Hesap oluşturma yetkiniz yok.', 'error'); return; }
        try {
            const result = await createRefereeAccount(referee);
            setCredentialsModal({ ...result, adSoyad: referee.adSoyad });
            toast(`${referee.adSoyad} için hesap oluşturuldu.`, 'success');
        } catch (err) {
            console.error('Hesap oluşturma hatası:', err);
            toast('Hesap oluşturma başarısız.', 'error');
        }
    };

    // Toplu hesap oluşturma (hesabı olmayanlar için)
    const handleBulkCreateAccounts = async () => {
        if (!hasPermission('referees', 'ekle') && !isSuperAdmin()) { toast('Toplu hesap oluşturma yetkiniz yok.', 'error'); return; }
        const refereesWithoutAccount = referees.filter(r => !r.hesapKullaniciAdi);
        if (refereesWithoutAccount.length === 0) {
            toast('Tüm hakemlerin zaten hesabı var.', 'info');
            return;
        }

        const ok = await confirm(
            `${refereesWithoutAccount.length} hakem için otomatik hesap oluşturulacak. Devam etmek istiyor musunuz?`,
            { title: 'Toplu Hesap Oluşturma', type: 'info' }
        );
        if (!ok) return;

        setBulkCreating(true);
        const results = [];
        let success = 0;
        let fail = 0;

        for (const referee of refereesWithoutAccount) {
            try {
                const { username, password } = await createRefereeAccount(referee);
                results.push({ adSoyad: referee.adSoyad, username, password, status: 'ok' });
                success++;
            } catch (err) {
                console.error(`Hesap oluşturulamadı: ${referee.adSoyad}`, err);
                results.push({ adSoyad: referee.adSoyad, username: '-', password: '-', status: 'fail' });
                fail++;
            }
        }

        setBulkCreating(false);
        setBulkResults(results);
        toast(`Toplu hesap oluşturma tamamlandı. Başarılı: ${success}, Başarısız: ${fail}`, success > 0 ? 'success' : 'error');
    };

    // Hakemlerin hesap durumu bilgisi
    const refereesWithAccountCount = useMemo(() => {
        return referees.filter(r => r.hesapKullaniciAdi).length;
    }, [referees]);

    // 3. Excel Upload Logic (Initializes stats)
    const handleFileUpload = (e) => {
        if (!hasPermission('referees', 'ekle')) { toast('Hakem yükleme yetkiniz yok.', 'error'); return; }
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const bstr = evt.target.result;
                const XLSX = await import('xlsx');
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const data = XLSX.utils.sheet_to_json(ws);

                if (data.length === 0) return toast("Excel dosyası boş.", "warning");

                toast(`${data.length} kayıt bulundu. Yükleme başlıyor...`, "info");
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
                toast(`İşlem tamamlandı. Başarılı: ${successCount}, Başarısız: ${failCount}`, "success");
            } catch (err) {
                console.error("Excel parse error", err);
                toast("Hata oluştu.", "error");
            } finally {
                if (fileInputRef.current) fileInputRef.current.value = "";
            }
        };
        reader.readAsBinaryString(file);
    };


    // 4. Filtering
    const filteredReferees = referees.filter(r => {
        const term = searchTerm.toLowerCase();
        const matchesSearch = (r.adSoyad || '').toLowerCase().includes(term) || (r.il || '').toLowerCase().includes(term);
        const matchesGender = filterGender === '' || r.brans === filterGender;
        const matchesBrove = filterBrove === '' || r.brove === filterBrove;
        return matchesSearch && matchesGender && matchesBrove;
    });

    return (
        <div className="referees-page premium-layout">
            {/* Header */}
            <header className="page-header--bento premium-header">
                <div className="page-header__left">
                    <button className="back-btn back-btn--light" onClick={() => navigate(routePrefix)}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div className="header-title-wrapper">
                        <h1 className="page-title text-white">Global Hakem Veritabanı</h1>
                        <p className="page-subtitle text-white-50">Kapsamlı hakem havuzu, görev istatistikleri ve geçmiş yarışma kayıtları.</p>
                    </div>
                </div>

                <div className="page-header__actions">
                    <input type="file" accept=".xlsx, .xls" style={{ display: 'none' }} ref={fileInputRef} onChange={handleFileUpload} />
                    {hasPermission('referees', 'ekle') && (
                        <button className="btn-premium-secondary" onClick={() => fileInputRef.current.click()}>
                            <i className="material-icons-round">file_upload</i> Toplu Excel Yükle
                        </button>
                    )}
                    {hasPermission('referees', 'ekle') && (
                        <button
                            className="btn-premium-secondary"
                            onClick={handleBulkCreateAccounts}
                            disabled={bulkCreating}
                            title={`${referees.length - refereesWithAccountCount} hakem hesapsız`}
                        >
                            <i className="material-icons-round">{bulkCreating ? 'hourglass_top' : 'manage_accounts'}</i>
                            {bulkCreating ? 'Oluşturuluyor...' : `Toplu Hesap (${referees.length - refereesWithAccountCount})`}
                        </button>
                    )}
                    {hasPermission('referees', 'ekle') && (
                        <button className="btn-premium-primary" onClick={() => openAddEditModal()}>
                            <i className="material-icons-round">person_add</i> Yeni Hakem
                        </button>
                    )}
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
                        <select className="filter-select premium" value={filterBrove} onChange={(e) => setFilterBrove(e.target.value)}>
                            <option value="">Tüm Bröveler</option>
                            <option value="ULUSLARARASI">Uluslararası</option>
                            <option value="MİLLİ">Milli</option>
                            <option value="BÖLGE">Bölge</option>
                            <option value="ADAY">Aday</option>
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
                                        <th>İl</th>
                                        <th>Bröve</th>
                                        <th>İletişim</th>
                                        <th className="text-center">Görev Sayısı</th>
                                        <th className="text-center">Hesap</th>
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
                                                <span className="text-sm text-slate-600">{ref.il || '—'}</span>
                                            </td>
                                            <td>
                                                {ref.brove && (
                                                    <span className={`badge-brove ${ref.brove === 'ULUSLARARASI' ? 'intl' : ref.brove === 'MİLLİ' ? 'national' : ref.brove === 'BÖLGE' ? 'regional' : 'candidate'}`}>
                                                        {ref.brove}
                                                    </span>
                                                )}
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
                                            <td className="text-center">
                                                {ref.hesapKullaniciAdi ? (
                                                    <span className="badge-account active" title={`Kullanıcı: ${ref.hesapKullaniciAdi}`}>
                                                        <i className="material-icons-round" style={{ fontSize: 14 }}>verified_user</i>
                                                        {ref.hesapKullaniciAdi}
                                                    </span>
                                                ) : (
                                                    <span className="badge-account inactive" title="Hesap yok">
                                                        <i className="material-icons-round" style={{ fontSize: 14 }}>person_off</i>
                                                        Yok
                                                    </span>
                                                )}
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
                                    {hasPermission('referees', 'duzenle') && (
                                        <button className="icon-btn" style={{ background: '#EEF2FF', color: '#4F46E5', width: 'auto', padding: '0 1rem', display: 'flex', gap: '0.5rem', fontWeight: 'bold' }} onClick={() => setIsAddHistoryModalOpen(true)} title="Görev Ekle">
                                            <i className="material-icons-round">add_circle</i> Görev Ekle
                                        </button>
                                    )}
                                    {hasPermission('referees', 'duzenle') && (
                                        <button className="icon-btn edit-btn" onClick={() => openAddEditModal(selectedReferee)} title="Düzenle">
                                            <i className="material-icons-round">edit</i>
                                        </button>
                                    )}
                                    {hasPermission('referees', 'sil') && (
                                        <button className="icon-btn delete-btn" onClick={() => handleDelete(selectedReferee.id, selectedReferee.adSoyad)} title="Sil">
                                            <i className="material-icons-round">delete_forever</i>
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="profile-hero">
                                <div className={`hero-avatar ${selectedReferee.brans}`}>
                                    {selectedReferee.brans === 'MAG' ? '🤸‍♂️' : '🤸‍♀️'}
                                </div>
                                <h2 className="hero-name">{selectedReferee.adSoyad}</h2>
                                <div className="hero-badges">
                                    <span className={`badge-branch large ${selectedReferee.brans === 'MAG' ? 'mag' : 'wag'}`}>
                                        {selectedReferee.brans === 'MAG' ? 'Erkekler Artistik (MAG)' : 'Kadınlar Artistik (WAG)'}
                                    </span>
                                    {selectedReferee.brove && (
                                        <span className={`badge-brove ${selectedReferee.brove === 'ULUSLARARASI' ? 'intl' : selectedReferee.brove === 'MİLLİ' ? 'national' : selectedReferee.brove === 'BÖLGE' ? 'regional' : 'candidate'}`}>
                                            {selectedReferee.brove}
                                        </span>
                                    )}
                                </div>
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
                                        <i className="material-icons-round">location_city</i>
                                        <span>{selectedReferee.il || 'İl belirtilmedi'}</span>
                                    </div>
                                    <div className="info-item">
                                        <i className="material-icons-round">phone_iphone</i>
                                        <span>{selectedReferee.telefon || 'Telefon belirtilmedi'}</span>
                                    </div>
                                    <div className="info-item">
                                        <i className="material-icons-round">email</i>
                                        <span>{selectedReferee.email || 'Email belirtilmedi'}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Sistem Hesabı */}
                            <div className="profile-section">
                                <h3 className="section-title">Sistem Hesabı</h3>
                                {selectedReferee.hesapKullaniciAdi ? (
                                    <div className="ref-account-info">
                                        <div className="ref-account-badge active">
                                            <i className="material-icons-round">verified_user</i>
                                            <div>
                                                <strong>Hesap Aktif</strong>
                                                <span>Kullanıcı: <code>{selectedReferee.hesapKullaniciAdi}</code></span>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="ref-account-info">
                                        <div className="ref-account-badge inactive">
                                            <i className="material-icons-round">person_off</i>
                                            <div>
                                                <strong>Hesap Yok</strong>
                                                <span>Bu hakem henüz sisteme giriş yapamaz.</span>
                                            </div>
                                        </div>
                                        {hasPermission('referees', 'ekle') && (
                                            <button
                                                className="ref-create-account-btn"
                                                onClick={() => handleCreateAccount(selectedReferee)}
                                            >
                                                <i className="material-icons-round">person_add</i>
                                                Hesap Oluştur
                                            </button>
                                        )}
                                    </div>
                                )}
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
                                        <label>İl</label>
                                        <div className="pm-input-wrapper">
                                            <i className="material-icons-round">location_city</i>
                                            <input type="text" value={formData.il} onChange={e => setFormData({ ...formData, il: e.target.value })} placeholder="Örn: ANKARA" />
                                        </div>
                                    </div>
                                    <div className="pm-form-group">
                                        <label>Bröve</label>
                                        <div className="pm-input-wrapper">
                                            <i className="material-icons-round">workspace_premium</i>
                                            <select value={formData.brove} onChange={e => setFormData({ ...formData, brove: e.target.value })} style={{ width: '100%', padding: '1rem 1rem 1rem 3rem', border: 'none', fontSize: '1rem', background: 'transparent', outline: 'none' }}>
                                                <option value="">Seçiniz</option>
                                                <option value="ULUSLARARASI">Uluslararası</option>
                                                <option value="MİLLİ">Milli</option>
                                                <option value="BÖLGE">Bölge</option>
                                                <option value="ADAY">Aday</option>
                                            </select>
                                        </div>
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

            {/* Hesap Bilgileri Modal (Tek hakem) */}
            {credentialsModal && (
                <div className="premium-modal-overlay" onClick={() => setCredentialsModal(null)}>
                    <div className="premium-modal-dialog cred-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
                        <div className="pm-header">
                            <div className="pm-title">
                                <i className="material-icons-round" style={{ color: '#16A34A', background: '#DCFCE7' }}>how_to_reg</i>
                                <h2>Hesap Oluşturuldu</h2>
                            </div>
                            <button className="pm-close-btn" onClick={() => setCredentialsModal(null)}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>
                        <div className="pm-body">
                            <div className="cred-info-box">
                                <div className="cred-warning">
                                    <i className="material-icons-round">warning</i>
                                    <span>Bu bilgileri not edin! Şifre tekrar gösterilmez.</span>
                                </div>
                                <div className="cred-card">
                                    <div className="cred-name">{credentialsModal.adSoyad}</div>
                                    <div className="cred-row">
                                        <label>Kullanıcı Adı:</label>
                                        <code className="cred-value">{credentialsModal.username}</code>
                                    </div>
                                    <div className="cred-row">
                                        <label>Şifre:</label>
                                        <code className="cred-value">{credentialsModal.password}</code>
                                    </div>
                                    <div className="cred-row">
                                        <label>Rol:</label>
                                        <span className="cred-role-badge">Hakem (Sadece Puanlama)</span>
                                    </div>
                                </div>
                                <button
                                    className="cred-copy-btn"
                                    onClick={() => {
                                        const text = `Hakem: ${credentialsModal.adSoyad}\nKullanıcı Adı: ${credentialsModal.username}\nŞifre: ${credentialsModal.password}`;
                                        navigator.clipboard.writeText(text).then(() => toast('Panoya kopyalandı!', 'success'));
                                    }}
                                >
                                    <i className="material-icons-round">content_copy</i>
                                    Bilgileri Kopyala
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Toplu Hesap Sonuçları Modal */}
            {bulkResults && (
                <div className="premium-modal-overlay" onClick={() => setBulkResults(null)}>
                    <div className="premium-modal-dialog" onClick={e => e.stopPropagation()} style={{ maxWidth: '700px' }}>
                        <div className="pm-header">
                            <div className="pm-title">
                                <i className="material-icons-round" style={{ color: '#4F46E5', background: '#EEF2FF' }}>assignment_turned_in</i>
                                <h2>Toplu Hesap Oluşturma Sonuçları</h2>
                            </div>
                            <button className="pm-close-btn" onClick={() => setBulkResults(null)}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>
                        <div className="pm-body">
                            <div className="cred-warning">
                                <i className="material-icons-round">warning</i>
                                <span>Bu listeyi kaydedin! Şifreler tekrar gösterilmez.</span>
                            </div>
                            <div className="bulk-results-table-wrap">
                                <table className="bulk-results-table">
                                    <thead>
                                        <tr>
                                            <th>Hakem</th>
                                            <th>Kullanıcı Adı</th>
                                            <th>Şifre</th>
                                            <th>Durum</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {bulkResults.map((r, i) => (
                                            <tr key={i} className={r.status === 'fail' ? 'row-fail' : ''}>
                                                <td><strong>{r.adSoyad}</strong></td>
                                                <td><code>{r.username}</code></td>
                                                <td><code>{r.password}</code></td>
                                                <td>
                                                    {r.status === 'ok'
                                                        ? <span className="badge-account active"><i className="material-icons-round" style={{ fontSize: 14 }}>check_circle</i> Başarılı</span>
                                                        : <span className="badge-account inactive"><i className="material-icons-round" style={{ fontSize: 14 }}>error</i> Hata</span>
                                                    }
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <button
                                className="cred-copy-btn"
                                style={{ marginTop: '1rem' }}
                                onClick={() => {
                                    const lines = bulkResults
                                        .filter(r => r.status === 'ok')
                                        .map(r => `${r.adSoyad}\t${r.username}\t${r.password}`)
                                        .join('\n');
                                    const header = 'Hakem\tKullanıcı Adı\tŞifre\n';
                                    navigator.clipboard.writeText(header + lines).then(() => toast('Tüm bilgiler panoya kopyalandı!', 'success'));
                                }}
                            >
                                <i className="material-icons-round">content_copy</i>
                                Tümünü Kopyala (Tab ile Ayrılmış)
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
