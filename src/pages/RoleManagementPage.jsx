import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, set, remove } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import turkeyData from '../data/turkey_data.json';
import './RoleManagementPage.css';

/* ============================
   İZİN TANIMLARI
   ============================ */
const PERMISSION_PAGES = [
    {
        key: 'competitions',
        label: 'Yarışmalar',
        icon: 'emoji_events',
        actions: [
            { key: 'goruntule', label: 'Görüntüle' },
            { key: 'olustur', label: 'Oluştur' },
            { key: 'duzenle', label: 'Düzenle' },
            { key: 'sil', label: 'Sil' },
        ],
    },
    {
        key: 'applications',
        label: 'Başvurular',
        icon: 'assignment_turned_in',
        actions: [
            { key: 'goruntule', label: 'Görüntüle' },
            { key: 'onayla', label: 'Onayla' },
            { key: 'reddet', label: 'Reddet' },
            { key: 'yas_atla', label: 'Yaş Uyarısını Atla' },
        ],
    },
    {
        key: 'athletes',
        label: 'Sporcular',
        icon: 'groups',
        actions: [
            { key: 'goruntule', label: 'Görüntüle' },
            { key: 'ekle', label: 'Ekle' },
            { key: 'duzenle', label: 'Düzenle' },
            { key: 'sil', label: 'Sil' },
        ],
    },
    {
        key: 'scoring',
        label: 'Puanlama',
        icon: 'scoreboard',
        actions: [
            { key: 'goruntule', label: 'Görüntüle' },
            { key: 'puanla', label: 'Puanla' },
        ],
    },
    {
        key: 'criteria',
        label: 'Kriterler',
        icon: 'tune',
        actions: [
            { key: 'goruntule', label: 'Görüntüle' },
            { key: 'duzenle', label: 'Düzenle' },
        ],
    },
    {
        key: 'referees',
        label: 'Hakemler',
        icon: 'gavel',
        actions: [
            { key: 'goruntule', label: 'Görüntüle' },
            { key: 'ekle', label: 'Ekle' },
            { key: 'duzenle', label: 'Düzenle' },
            { key: 'sil', label: 'Sil' },
        ],
    },
    {
        key: 'scoreboard',
        label: 'Canlı Skor',
        icon: 'live_tv',
        actions: [
            { key: 'goruntule', label: 'Görüntüle' },
        ],
    },
    {
        key: 'finals',
        label: 'Finaller',
        icon: 'military_tech',
        actions: [
            { key: 'goruntule', label: 'Görüntüle' },
            { key: 'duzenle', label: 'Ceza Ekle / Sil' },
        ],
    },
    {
        key: 'analytics',
        label: 'Raporlar',
        icon: 'analytics',
        actions: [
            { key: 'goruntule', label: 'Görüntüle' },
        ],
    },
    {
        key: 'start_order',
        label: 'Çıkış Sırası',
        icon: 'format_list_numbered',
        actions: [
            { key: 'goruntule', label: 'Görüntüle' },
            { key: 'duzenle', label: 'Düzenle' },
            { key: 'pdf', label: 'PDF' },
        ],
    },
    {
        key: 'links',
        label: 'QR & Linkler',
        icon: 'qr_code_2',
        actions: [
            { key: 'goruntule', label: 'Görüntüle' },
        ],
    },
    {
        key: 'official_report',
        label: 'Yarışma Raporu',
        icon: 'description',
        actions: [
            { key: 'goruntule', label: 'Görüntüle' },
            { key: 'duzenle', label: 'Düzenle' },
            { key: 'sil', label: 'Sil' },
        ],
    },
    {
        key: 'schedule',
        label: 'Program',
        icon: 'calendar_month',
        actions: [
            { key: 'goruntule', label: 'Görüntüle' },
            { key: 'olustur', label: 'Oluştur' },
            { key: 'duzenle', label: 'Düzenle' },
            { key: 'sil', label: 'Sil' },
        ],
    },
    {
        key: 'announcements',
        label: 'Duyurular',
        icon: 'campaign',
        actions: [
            { key: 'goruntule', label: 'Görüntüle' },
            { key: 'olustur', label: 'Oluştur' },
            { key: 'duzenle', label: 'Düzenle' },
            { key: 'sil', label: 'Sil' },
            { key: 'zamanla', label: 'Zamanlanmış Duyuru' },
        ],
    },
    {
        key: 'certificates',
        label: 'Sertifikalar',
        icon: 'workspace_premium',
        actions: [
            { key: 'goruntule', label: 'Görüntüle' },
            { key: 'olustur', label: 'Oluştur / İndir' },
        ],
    },
    {
        key: 'coaches',
        label: 'Antrenörler',
        icon: 'sports',
        actions: [
            { key: 'goruntule', label: 'Görüntüle' },
            { key: 'ekle', label: 'Ekle' },
            { key: 'duzenle', label: 'Düzenle' },
            { key: 'sil', label: 'Sil' },
        ],
    },
];

// Boş izin objesi oluştur
function createEmptyPermissions() {
    const perms = {};
    PERMISSION_PAGES.forEach(page => {
        perms[page.key] = {};
        page.actions.forEach(action => {
            perms[page.key][action.key] = false;
        });
    });
    return perms;
}

// Sadece görüntüleme izinleri
function createViewOnlyPermissions() {
    const perms = {};
    PERMISSION_PAGES.forEach(page => {
        perms[page.key] = {};
        page.actions.forEach(action => {
            perms[page.key][action.key] = action.key === 'goruntule';
        });
    });
    return perms;
}

// Tüm izinler
function createFullPermissions() {
    const perms = {};
    PERMISSION_PAGES.forEach(page => {
        perms[page.key] = {};
        page.actions.forEach(action => {
            perms[page.key][action.key] = true;
        });
    });
    return perms;
}

// İzin sayacı
function countPermissions(izinler) {
    if (!izinler) return { granted: 0, total: 0 };
    let granted = 0;
    let total = 0;
    PERMISSION_PAGES.forEach(page => {
        page.actions.forEach(action => {
            total++;
            if (izinler[page.key]?.[action.key]) granted++;
        });
    });
    return { granted, total };
}

const BRANSLAR = [
    { id: 'artistik',  label: 'Artistik',  icon: 'sports_gymnastics', color: '#E30613' },
    { id: 'aerobik',   label: 'Aerobik',   icon: 'directions_run',    color: '#2563EB' },
    { id: 'trampolin', label: 'Trampolin', icon: 'height',            color: '#7C3AED' },
    { id: 'parkur',    label: 'Parkur',    icon: 'terrain',           color: '#059669' },
    { id: 'ritmik',    label: 'Ritmik',    icon: 'self_improvement',  color: '#DB2777' },
];

const cities = Object.keys(turkeyData).sort();

const EMPTY_FORM = {
    kullaniciAdi: '',
    sifre: '',
    rolAdi: '',
    il: '',
    aktif: true,
    izinler: createEmptyPermissions(),
    bransIzinler: {}, // branşId -> izin objesi (null = global'e devret)
};

export default function RoleManagementPage() {
    const navigate = useNavigate();
    const { hashPassword } = useAuth();
    const [users, setUsers] = useState({});
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterIl, setFilterIl] = useState('');
    const [filterRole, setFilterRole] = useState('');
    const [filterAktif, setFilterAktif] = useState('all'); // all, active, passive

    // Modal state
    const [modalOpen, setModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState(null); // null = yeni kullanıcı
    const [formData, setFormData] = useState({ ...EMPTY_FORM });
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const [permTab, setPermTab] = useState('global'); // 'global' | branş id

    // Delete confirmation
    const [deleteConfirm, setDeleteConfirm] = useState(null);

    // Bulk assignment modal
    const [bulkModalOpen, setBulkModalOpen] = useState(false);
    const [bulkSelectedUsers, setBulkSelectedUsers] = useState([]); // usernames
    const [bulkPermissions, setBulkPermissions] = useState({}); // pageKey -> { actionKey: true/false }
    const [bulkSaving, setBulkSaving] = useState(false);
    const [bulkMode, setBulkMode] = useState('add'); // 'add' | 'remove' | 'set'

    // Firebase'den kullanıcıları yükle
    useEffect(() => {
        const usersRef = ref(db, 'kullanicilar');
        const unsubscribe = onValue(usersRef, (snapshot) => {
            setUsers(snapshot.val() || {});
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    // Filtrelenmiş kullanıcı listesi
    const filteredUsers = useMemo(() => {
        return Object.entries(users)
            .map(([id, data]) => ({ id, ...data }))
            .filter(user => {
                // Arama
                if (search) {
                    const s = search.toLocaleLowerCase('tr-TR');
                    const matchName = (user.id || '').toLocaleLowerCase('tr-TR').includes(s);
                    const matchRole = (user.rolAdi || '').toLocaleLowerCase('tr-TR').includes(s);
                    const matchIl = (user.il || '').toLocaleLowerCase('tr-TR').includes(s);
                    if (!matchName && !matchRole && !matchIl) return false;
                }
                // İl filtresi
                if (filterIl && (user.il || '') !== filterIl) return false;
                // Rol filtresi
                if (filterRole && (user.rolAdi || '') !== filterRole) return false;
                // Aktiflik filtresi
                if (filterAktif === 'active' && user.aktif === false) return false;
                if (filterAktif === 'passive' && user.aktif !== false) return false;
                return true;
            })
            .sort((a, b) => a.id.localeCompare(b.id, 'tr-TR'));
    }, [users, search, filterIl, filterRole, filterAktif]);

    // İllerde kullanılan iller (filtre dropdown için)
    const usedCities = useMemo(() => {
        const set = new Set();
        Object.values(users).forEach(u => { if (u.il) set.add(u.il); });
        return [...set].sort((a, b) => a.localeCompare(b, 'tr-TR'));
    }, [users]);

    // Kullanılan rol adları (filtre dropdown için)
    const usedRoles = useMemo(() => {
        const set = new Set();
        Object.values(users).forEach(u => { if (u.rolAdi) set.add(u.rolAdi); });
        return [...set].sort((a, b) => a.localeCompare(b, 'tr-TR'));
    }, [users]);

    // Modal aç
    const openModal = (user = null) => {
        if (user) {
            // Düzenleme — şifre alanı boş açılır; boş bırakılırsa mevcut hash korunur
            setEditingUser(user.id);
            // bransIzinler: her branş için mergePermissions uygula (yoksa null bırak)
            const bransIzinler = {};
            BRANSLAR.forEach(b => {
                const raw = user.bransIzinler?.[b.id];
                bransIzinler[b.id] = raw ? mergePermissions(raw) : null;
            });
            setFormData({
                kullaniciAdi: user.id,
                sifre: '',
                rolAdi: user.rolAdi || '',
                il: user.il || '',
                aktif: user.aktif !== false,
                izinler: mergePermissions(user.izinler),
                bransIzinler,
            });
        } else {
            // Yeni kullanıcı
            setEditingUser(null);
            setFormData({ ...EMPTY_FORM, izinler: createEmptyPermissions(), bransIzinler: {} });
        }
        setPermTab('global');
        setFormError('');
        setModalOpen(true);
    };

    // Firebase'deki izinleri şablon ile birleştir (eksik page/action varsa ekle)
    function mergePermissions(existing) {
        const merged = createEmptyPermissions();
        if (!existing) return merged;
        PERMISSION_PAGES.forEach(page => {
            page.actions.forEach(action => {
                if (existing[page.key]?.[action.key] === true) {
                    merged[page.key][action.key] = true;
                }
            });
        });
        return merged;
    }

    // Modal kapat
    const closeModal = () => {
        setModalOpen(false);
        setEditingUser(null);
        setFormData({ ...EMPTY_FORM });
        setFormError('');
        setPermTab('global');
    };

    // Aktif tab'da izin okuma yardımcısı
    const getActivePerms = (prev) => {
        if (permTab === 'global') return prev.izinler;
        return prev.bransIzinler[permTab] || createEmptyPermissions();
    };
    const setActivePerms = (prev, newPerms) => {
        if (permTab === 'global') return { ...prev, izinler: newPerms };
        return { ...prev, bransIzinler: { ...prev.bransIzinler, [permTab]: newPerms } };
    };

    // İzin toggle
    const togglePermission = (pageKey, actionKey) => {
        setFormData(prev => {
            const cur = getActivePerms(prev);
            const newPerms = { ...cur, [pageKey]: { ...cur[pageKey], [actionKey]: !cur[pageKey]?.[actionKey] } };
            return setActivePerms(prev, newPerms);
        });
    };

    // Sayfa tüm izinlerini toggle
    const togglePageAll = (pageKey) => {
        const page = PERMISSION_PAGES.find(p => p.key === pageKey);
        if (!page) return;
        setFormData(prev => {
            const cur = getActivePerms(prev);
            const allTrue = page.actions.every(a => cur[pageKey]?.[a.key]);
            const newPagePerms = {};
            page.actions.forEach(a => { newPagePerms[a.key] = !allTrue; });
            return setActivePerms(prev, { ...cur, [pageKey]: newPagePerms });
        });
    };

    // Hızlı seçim butonları — aktif tab'a göre
    const setAllPermissions = () => setFormData(prev => setActivePerms(prev, createFullPermissions()));
    const clearAllPermissions = () => setFormData(prev => setActivePerms(prev, createEmptyPermissions()));
    const setViewOnlyPermissions = () => setFormData(prev => setActivePerms(prev, createViewOnlyPermissions()));

    // Branş özel izin etkinleştir (global'den kopyala)
    const enableBranchPerms = (bransId) => {
        setFormData(prev => ({
            ...prev,
            bransIzinler: { ...prev.bransIzinler, [bransId]: mergePermissions(prev.izinler) },
        }));
    };
    // Branş özel izni kaldır (global'e dön)
    const disableBranchPerms = (bransId) => {
        setFormData(prev => ({
            ...prev,
            bransIzinler: { ...prev.bransIzinler, [bransId]: null },
        }));
    };

    // Kaydet
    const handleSave = async (e) => {
        e.preventDefault();
        setFormError('');

        const username = formData.kullaniciAdi.trim();
        if (!username) {
            setFormError('Kullanıcı adı zorunludur.');
            return;
        }
        // Yeni kullanıcıda şifre zorunlu; düzenlemede boş bırakılırsa mevcut hash korunur
        if (!editingUser && !formData.sifre.trim()) {
            setFormError('Şifre zorunludur.');
            return;
        }
        if (!formData.rolAdi.trim()) {
            setFormError('Rol adı zorunludur.');
            return;
        }

        // Yeni kullanıcı mı? Varsa çakışma kontrolü
        if (!editingUser && users[username]) {
            setFormError('Bu kullanıcı adı zaten mevcut.');
            return;
        }

        setSaving(true);
        try {
            // bransIzinler: null değerli branşları çıkar (gereksiz veri yazılmasın)
            const cleanBransIzinler = {};
            BRANSLAR.forEach(b => {
                if (formData.bransIzinler[b.id]) {
                    cleanBransIzinler[b.id] = formData.bransIzinler[b.id];
                }
            });

            const userData = {
                rolAdi: formData.rolAdi.trim(),
                il: formData.il || null,
                aktif: formData.aktif,
                izinler: formData.izinler,
                bransIzinler: Object.keys(cleanBransIzinler).length > 0 ? cleanBransIzinler : null,
            };

            if (formData.sifre.trim()) {
                // Yeni şifre girildi — hashle ve kaydet
                userData.sifreHash = await hashPassword(formData.sifre.trim());
            } else {
                // Şifre boş bırakıldı (sadece düzenlemede mümkün) — mevcut hash'i koru
                userData.sifreHash = users[username]?.sifreHash || '';
            }

            // Yeni kullanıcı ise oluşturma tarihi ekle
            if (!editingUser) {
                userData.olusturmaTarihi = new Date().toISOString();
            } else {
                // Mevcut oluşturma tarihini koru
                userData.olusturmaTarihi = users[username]?.olusturmaTarihi || new Date().toISOString();
            }

            await set(ref(db, `kullanicilar/${username}`), userData);
            closeModal();
        } catch (err) {
            if (import.meta.env.DEV) console.error('Kayıt hatası:', err);
            setFormError('Kayıt sırasında bir hata oluştu.');
        } finally {
            setSaving(false);
        }
    };

    // Toplu izin atama — modal aç
    const openBulkModal = () => {
        setBulkSelectedUsers([]);
        setBulkPermissions(createEmptyPermissions());
        setBulkMode('add');
        setBulkModalOpen(true);
    };

    const toggleBulkUser = (username) => {
        setBulkSelectedUsers(prev =>
            prev.includes(username) ? prev.filter(u => u !== username) : [...prev, username]
        );
    };

    const selectAllBulkUsers = () => {
        const allIds = filteredUsers.map(u => u.id);
        setBulkSelectedUsers(prev => prev.length === allIds.length ? [] : allIds);
    };

    const toggleBulkPermission = (pageKey, actionKey) => {
        setBulkPermissions(prev => ({
            ...prev,
            [pageKey]: {
                ...prev[pageKey],
                [actionKey]: !prev[pageKey]?.[actionKey],
            },
        }));
    };

    const handleBulkSave = async () => {
        if (bulkSelectedUsers.length === 0) return;
        setBulkSaving(true);
        try {
            const updates = {};
            for (const username of bulkSelectedUsers) {
                const existingPerms = users[username]?.izinler || {};
                const merged = {};
                PERMISSION_PAGES.forEach(page => {
                    merged[page.key] = {};
                    page.actions.forEach(action => {
                        const existing = existingPerms[page.key]?.[action.key] === true;
                        const selected = bulkPermissions[page.key]?.[action.key] === true;
                        if (bulkMode === 'add') {
                            merged[page.key][action.key] = existing || selected;
                        } else if (bulkMode === 'remove') {
                            merged[page.key][action.key] = selected ? false : existing;
                        } else {
                            // set — sadece seçileni uygula
                            merged[page.key][action.key] = selected;
                        }
                    });
                });
                updates[`kullanicilar/${username}/izinler`] = merged;
            }
            const { update: fbUpdate } = await import('firebase/database');
            await fbUpdate(ref(db), updates);
            setBulkModalOpen(false);
        } catch (err) {
            if (import.meta.env.DEV) console.error('Toplu atama hatası:', err);
        } finally {
            setBulkSaving(false);
        }
    };

    // Sil
    const handleDelete = async (userId) => {
        try {
            await remove(ref(db, `kullanicilar/${userId}`));
            setDeleteConfirm(null);
        } catch (err) {
            if (import.meta.env.DEV) console.error('Silme hatası:', err);
        }
    };

    return (
        <div className="role-page">
            {/* Header */}
            <header className="page-header">
                <div className="page-header__left">
                    <button className="back-btn" onClick={() => navigate('/artistik')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div>
                        <h1 className="page-title">Rol Yönetimi</h1>
                        <p className="page-subtitle">Kullanıcı ve yetki yönetimi</p>
                    </div>
                </div>
                <div className="page-header__right">
                    <button className="btn btn--outline" onClick={openBulkModal}>
                        <i className="material-icons-round">group_add</i>
                        <span>Toplu İzin Ata</span>
                    </button>
                    <button className="btn btn--primary" onClick={() => openModal()}>
                        <i className="material-icons-round">person_add</i>
                        <span>Yeni Kullanıcı</span>
                    </button>
                </div>
            </header>

            {/* Content */}
            <main className="page-content">
                {/* Filtreler */}
                <div className="rm-filters">
                    <div className="rm-search">
                        <i className="material-icons-round">search</i>
                        <input
                            type="text"
                            placeholder="Kullanıcı, rol veya il ara..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>
                    <select className="rm-filter-select" value={filterRole} onChange={e => setFilterRole(e.target.value)}>
                        <option value="">Tüm Roller</option>
                        {usedRoles.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <select className="rm-filter-select" value={filterIl} onChange={e => setFilterIl(e.target.value)}>
                        <option value="">Tüm İller</option>
                        {usedCities.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select className="rm-filter-select" value={filterAktif} onChange={e => setFilterAktif(e.target.value)}>
                        <option value="all">Tümü</option>
                        <option value="active">Aktif</option>
                        <option value="passive">Pasif</option>
                    </select>
                    <div className="rm-count">
                        <span>{filteredUsers.length}</span> kullanıcı
                    </div>
                </div>

                {/* Kullanıcı Listesi */}
                {loading ? (
                    <div className="rm-loading">
                        <div className="rm-spinner" />
                        <p>Yükleniyor...</p>
                    </div>
                ) : filteredUsers.length === 0 ? (
                    <div className="rm-empty">
                        <i className="material-icons-round">person_off</i>
                        <p>Kullanıcı bulunamadı</p>
                    </div>
                ) : (
                    <div className="rm-user-grid">
                        {filteredUsers.map(user => {
                            const permCount = countPermissions(user.izinler);
                            return (
                                <div key={user.id} className={`rm-user-card ${user.aktif === false ? 'rm-user-card--passive' : ''}`}>
                                    <div className="rm-user-card__header">
                                        <div className="rm-user-card__avatar" style={{ background: user.aktif === false ? '#9CA3AF' : '#3B82F6' }}>
                                            {(user.id || '?')[0].toUpperCase()}
                                        </div>
                                        <div className="rm-user-card__info">
                                            <h3 className="rm-user-card__name">{user.id}</h3>
                                            <div className="rm-user-card__badges">
                                                <span className="rm-badge rm-badge--role">{user.rolAdi || 'Tanımsız'}</span>
                                                {user.il && (
                                                    <span className="rm-badge rm-badge--il">
                                                        <i className="material-icons-round" style={{ fontSize: 12 }}>location_on</i>
                                                        {user.il}
                                                    </span>
                                                )}
                                                {user.aktif === false && (
                                                    <span className="rm-badge rm-badge--passive">Pasif</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="rm-user-card__perms">
                                        <div className="rm-perm-bar">
                                            <div
                                                className="rm-perm-bar__fill"
                                                style={{ width: `${permCount.total > 0 ? (permCount.granted / permCount.total) * 100 : 0}%` }}
                                            />
                                        </div>
                                        <span className="rm-perm-text">{permCount.granted}/{permCount.total} global izin</span>
                                    </div>
                                    {/* Özel branş izni rozetleri */}
                                    {user.bransIzinler && Object.keys(user.bransIzinler).length > 0 && (
                                        <div className="rm-branch-badges">
                                            {BRANSLAR.filter(b => user.bransIzinler?.[b.id]).map(b => (
                                                <span key={b.id} className="rm-branch-badge" style={{ background: b.color + '22', color: b.color, borderColor: b.color + '55' }}>
                                                    <i className="material-icons-round" style={{ fontSize: 11 }}>{b.icon}</i>
                                                    {b.label}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    <div className="rm-user-card__actions">
                                        <button className="rm-action-btn rm-action-btn--edit" onClick={() => openModal(user)} title="Düzenle">
                                            <i className="material-icons-round">edit</i>
                                        </button>
                                        <button className="rm-action-btn rm-action-btn--delete" onClick={() => setDeleteConfirm(user.id)} title="Sil">
                                            <i className="material-icons-round">delete</i>
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>

            {/* Kullanıcı Ekle/Düzenle Modal */}
            {modalOpen && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="rm-modal" onClick={e => e.stopPropagation()}>
                        <div className="rm-modal__header">
                            <h2>{editingUser ? 'Kullanıcı Düzenle' : 'Yeni Kullanıcı'}</h2>
                            <button className="rm-modal__close" onClick={closeModal}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>

                        <form onSubmit={handleSave} className="rm-modal__body">
                            {/* Temel Bilgiler */}
                            <div className="rm-section">
                                <h3 className="rm-section__title">
                                    <i className="material-icons-round">person</i>
                                    Kullanıcı Bilgileri
                                </h3>
                                <div className="rm-form-grid">
                                    <div className="rm-form-group">
                                        <label>Kullanıcı Adı *</label>
                                        <input
                                            type="text"
                                            value={formData.kullaniciAdi}
                                            onChange={e => setFormData({ ...formData, kullaniciAdi: e.target.value })}
                                            disabled={!!editingUser}
                                            placeholder="ornek_kullanici"
                                            autoFocus={!editingUser}
                                        />
                                    </div>
                                    <div className="rm-form-group">
                                        <label>{editingUser ? 'Yeni Şifre (boş = değiştirme)' : 'Şifre *'}</label>
                                        <input
                                            type="password"
                                            value={formData.sifre}
                                            onChange={e => setFormData({ ...formData, sifre: e.target.value })}
                                            placeholder={editingUser ? 'Boş bırakın — şifre değişmez' : 'Şifre'}
                                            autoComplete="new-password"
                                        />
                                    </div>
                                    <div className="rm-form-group">
                                        <label>Rol Adı *</label>
                                        <input
                                            type="text"
                                            value={formData.rolAdi}
                                            onChange={e => setFormData({ ...formData, rolAdi: e.target.value })}
                                            placeholder="Hakem, İl Temsilcisi, Ziyaretçi..."
                                        />
                                    </div>
                                    <div className="rm-form-group">
                                        <label>İl</label>
                                        <select
                                            value={formData.il}
                                            onChange={e => setFormData({ ...formData, il: e.target.value })}
                                        >
                                            <option value="">-- Seçilmedi --</option>
                                            {cities.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div className="rm-toggle-row">
                                    <label className="rm-toggle">
                                        <input
                                            type="checkbox"
                                            checked={formData.aktif}
                                            onChange={e => setFormData({ ...formData, aktif: e.target.checked })}
                                        />
                                        <span className="rm-toggle__slider" />
                                        <span className="rm-toggle__label">
                                            {formData.aktif ? 'Aktif' : 'Pasif'}
                                        </span>
                                    </label>
                                </div>
                            </div>

                            {/* İzin Grid */}
                            <div className="rm-section">
                                <h3 className="rm-section__title" style={{ marginBottom: 12 }}>
                                    <i className="material-icons-round">security</i>
                                    Sayfa İzinleri
                                </h3>

                                {/* Branş Sekme Çubuğu */}
                                <div className="rm-perm-tabs">
                                    <button
                                        type="button"
                                        className={`rm-perm-tab ${permTab === 'global' ? 'rm-perm-tab--active' : ''}`}
                                        onClick={() => setPermTab('global')}
                                    >
                                        <i className="material-icons-round">public</i>
                                        Global
                                    </button>
                                    {BRANSLAR.map(b => {
                                        const hasCustom = !!formData.bransIzinler?.[b.id];
                                        return (
                                            <button
                                                key={b.id}
                                                type="button"
                                                className={`rm-perm-tab ${permTab === b.id ? 'rm-perm-tab--active' : ''}`}
                                                style={permTab === b.id ? { borderBottomColor: b.color } : {}}
                                                onClick={() => setPermTab(b.id)}
                                            >
                                                <i className="material-icons-round">{b.icon}</i>
                                                {b.label}
                                                {hasCustom && <span className="rm-perm-tab__dot" style={{ background: b.color }} />}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Tab içeriği */}
                                {(() => {
                                    const isBrans = permTab !== 'global';
                                    const brans = isBrans ? BRANSLAR.find(b => b.id === permTab) : null;
                                    const hasCustom = isBrans && !!formData.bransIzinler?.[permTab];
                                    const activePerms = isBrans
                                        ? (hasCustom ? formData.bransIzinler[permTab] : formData.izinler)
                                        : formData.izinler;
                                    const isReadOnly = isBrans && !hasCustom;

                                    return (
                                        <>
                                            {/* Branş kontrol çubuğu */}
                                            {isBrans && (
                                                <div className="rm-branch-bar" style={{ borderColor: brans.color + '55' }}>
                                                    <i className="material-icons-round" style={{ color: brans.color }}>{brans.icon}</i>
                                                    {hasCustom ? (
                                                        <>
                                                            <span className="rm-branch-bar__text">
                                                                <strong>{brans.label}</strong> için özel izinler aktif
                                                            </span>
                                                            <button type="button" className="rm-branch-bar__btn rm-branch-bar__btn--danger" onClick={() => disableBranchPerms(permTab)}>
                                                                <i className="material-icons-round">link_off</i>
                                                                Global'e Dön
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span className="rm-branch-bar__text rm-branch-bar__text--muted">
                                                                <strong>{brans.label}</strong> için global izinler geçerli
                                                            </span>
                                                            <button type="button" className="rm-branch-bar__btn rm-branch-bar__btn--primary" onClick={() => enableBranchPerms(permTab)}>
                                                                <i className="material-icons-round">edit_note</i>
                                                                Özel İzin Tanımla
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            )}

                                            {/* Hızlı seçim — sadece düzenlenebilir modda */}
                                            {!isReadOnly && (
                                                <div className="rm-quick-btns" style={{ marginBottom: 10 }}>
                                                    <button type="button" className="rm-quick-btn rm-quick-btn--all" onClick={setAllPermissions}>Tümünü Seç</button>
                                                    <button type="button" className="rm-quick-btn rm-quick-btn--view" onClick={setViewOnlyPermissions}>Sadece Görüntüle</button>
                                                    <button type="button" className="rm-quick-btn rm-quick-btn--clear" onClick={clearAllPermissions}>Tümünü Kaldır</button>
                                                </div>
                                            )}

                                            <div className={`rm-perm-grid ${isReadOnly ? 'rm-perm-grid--readonly' : ''}`}>
                                                {PERMISSION_PAGES.map(page => {
                                                    const allChecked = page.actions.every(a => activePerms[page.key]?.[a.key]);
                                                    return (
                                                        <div key={page.key} className="rm-perm-row">
                                                            <div className="rm-perm-row__label">
                                                                <button
                                                                    type="button"
                                                                    className={`rm-perm-row__toggle ${allChecked ? 'rm-perm-row__toggle--active' : ''}`}
                                                                    onClick={() => !isReadOnly && togglePageAll(page.key)}
                                                                    title={isReadOnly ? 'Global izin (salt okunur)' : (allChecked ? 'Tümünü kaldır' : 'Tümünü seç')}
                                                                    style={isReadOnly ? { cursor: 'default' } : {}}
                                                                >
                                                                    <i className="material-icons-round" style={{ fontSize: 18 }}>{page.icon}</i>
                                                                </button>
                                                                <span>{page.label}</span>
                                                            </div>
                                                            <div className="rm-perm-row__actions">
                                                                {page.actions.map(action => (
                                                                    <label key={action.key} className={`rm-checkbox ${isReadOnly ? 'rm-checkbox--readonly' : ''}`}>
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={!!activePerms[page.key]?.[action.key]}
                                                                            onChange={() => !isReadOnly && togglePermission(page.key, action.key)}
                                                                            readOnly={isReadOnly}
                                                                        />
                                                                        <span className="rm-checkbox__box">
                                                                            <i className="material-icons-round">check</i>
                                                                        </span>
                                                                        <span className="rm-checkbox__text">{action.label}</span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>

                            {/* Hata ve Butonlar */}
                            {formError && (
                                <div className="rm-form-error">
                                    <i className="material-icons-round">error</i>
                                    {formError}
                                </div>
                            )}

                            <div className="rm-modal__footer">
                                <button type="button" className="btn btn--cancel" onClick={closeModal}>İptal</button>
                                <button type="submit" className="btn btn--primary" disabled={saving}>
                                    {saving ? (
                                        <>
                                            <span className="rm-btn-spinner" />
                                            Kaydediliyor...
                                        </>
                                    ) : (
                                        <>
                                            <i className="material-icons-round">save</i>
                                            {editingUser ? 'Güncelle' : 'Oluştur'}
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Toplu İzin Atama Modal */}
            {bulkModalOpen && (
                <div className="modal-overlay" onClick={() => setBulkModalOpen(false)}>
                    <div className="rm-modal rm-modal--wide" onClick={e => e.stopPropagation()}>
                        <div className="rm-modal__header">
                            <h2>Toplu İzin Atama</h2>
                            <button className="rm-modal__close" onClick={() => setBulkModalOpen(false)}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>
                        <div className="rm-modal__body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                            {/* Mod Seçimi */}
                            <div className="rm-section">
                                <h3 className="rm-section__title">
                                    <i className="material-icons-round">settings</i>
                                    Atama Modu
                                </h3>
                                <div className="rm-bulk-modes">
                                    <button type="button" className={`rm-bulk-mode-btn ${bulkMode === 'add' ? 'active' : ''}`} onClick={() => setBulkMode('add')}>
                                        <i className="material-icons-round">add_circle</i>
                                        <span>Ekle</span>
                                        <small>Mevcut izinlere eklenir</small>
                                    </button>
                                    <button type="button" className={`rm-bulk-mode-btn ${bulkMode === 'remove' ? 'active' : ''}`} onClick={() => setBulkMode('remove')}>
                                        <i className="material-icons-round">remove_circle</i>
                                        <span>Kaldır</span>
                                        <small>Seçili izinler kaldırılır</small>
                                    </button>
                                    <button type="button" className={`rm-bulk-mode-btn ${bulkMode === 'set' ? 'active' : ''}`} onClick={() => setBulkMode('set')}>
                                        <i className="material-icons-round">swap_horiz</i>
                                        <span>Değiştir</span>
                                        <small>Tüm izinler yeniden yazılır</small>
                                    </button>
                                </div>
                            </div>

                            {/* Kullanıcı Seçimi */}
                            <div className="rm-section">
                                <div className="rm-section__header">
                                    <h3 className="rm-section__title">
                                        <i className="material-icons-round">people</i>
                                        Kullanıcılar ({bulkSelectedUsers.length} seçili)
                                    </h3>
                                    <button type="button" className="rm-quick-btn rm-quick-btn--all" onClick={selectAllBulkUsers}>
                                        {bulkSelectedUsers.length === filteredUsers.length ? 'Tümünü Kaldır' : 'Tümünü Seç'}
                                    </button>
                                </div>
                                <div className="rm-bulk-users">
                                    {filteredUsers.map(user => (
                                        <label key={user.id} className={`rm-bulk-user-chip ${bulkSelectedUsers.includes(user.id) ? 'selected' : ''}`}>
                                            <input type="checkbox" checked={bulkSelectedUsers.includes(user.id)} onChange={() => toggleBulkUser(user.id)} />
                                            <span className="rm-bulk-user-chip__avatar" style={{ background: bulkSelectedUsers.includes(user.id) ? '#3B82F6' : '#9CA3AF' }}>
                                                {(user.id || '?')[0].toUpperCase()}
                                            </span>
                                            <span className="rm-bulk-user-chip__name">{user.id}</span>
                                            <span className="rm-bulk-user-chip__role">{user.rolAdi || ''}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* İzin Seçimi */}
                            <div className="rm-section">
                                <div className="rm-section__header">
                                    <h3 className="rm-section__title">
                                        <i className="material-icons-round">security</i>
                                        Atanacak İzinler
                                    </h3>
                                    <div className="rm-quick-btns">
                                        <button type="button" className="rm-quick-btn rm-quick-btn--all" onClick={() => setBulkPermissions(createFullPermissions())}>Tümü</button>
                                        <button type="button" className="rm-quick-btn rm-quick-btn--view" onClick={() => setBulkPermissions(createViewOnlyPermissions())}>Görüntüle</button>
                                        <button type="button" className="rm-quick-btn rm-quick-btn--clear" onClick={() => setBulkPermissions(createEmptyPermissions())}>Temizle</button>
                                    </div>
                                </div>
                                <div className="rm-perm-grid">
                                    {PERMISSION_PAGES.map(page => {
                                        const allChecked = page.actions.every(a => bulkPermissions[page.key]?.[a.key]);
                                        return (
                                            <div key={page.key} className="rm-perm-row">
                                                <div className="rm-perm-row__label">
                                                    <button
                                                        type="button"
                                                        className={`rm-perm-row__toggle ${allChecked ? 'rm-perm-row__toggle--active' : ''}`}
                                                        onClick={() => {
                                                            const newPerms = { ...bulkPermissions };
                                                            newPerms[page.key] = {};
                                                            page.actions.forEach(a => { newPerms[page.key][a.key] = !allChecked; });
                                                            setBulkPermissions(newPerms);
                                                        }}
                                                    >
                                                        <i className="material-icons-round" style={{ fontSize: 18 }}>{page.icon}</i>
                                                    </button>
                                                    <span>{page.label}</span>
                                                </div>
                                                <div className="rm-perm-row__actions">
                                                    {page.actions.map(action => (
                                                        <label key={action.key} className="rm-checkbox">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!bulkPermissions[page.key]?.[action.key]}
                                                                onChange={() => toggleBulkPermission(page.key, action.key)}
                                                            />
                                                            <span className="rm-checkbox__box">
                                                                <i className="material-icons-round">check</i>
                                                            </span>
                                                            <span className="rm-checkbox__text">{action.label}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                        <div className="rm-modal__footer">
                            <button type="button" className="btn btn--cancel" onClick={() => setBulkModalOpen(false)}>İptal</button>
                            <button
                                type="button"
                                className="btn btn--primary"
                                disabled={bulkSaving || bulkSelectedUsers.length === 0}
                                onClick={handleBulkSave}
                            >
                                {bulkSaving ? (
                                    <><span className="rm-btn-spinner" /> Uygulanıyor...</>
                                ) : (
                                    <><i className="material-icons-round">done_all</i> {bulkSelectedUsers.length} Kullanıcıya Uygula</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Silme Onay Modal */}
            {deleteConfirm && (
                <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
                    <div className="rm-delete-modal" onClick={e => e.stopPropagation()}>
                        <div className="rm-delete-modal__icon">
                            <i className="material-icons-round">warning</i>
                        </div>
                        <h3>Kullanıcıyı Sil</h3>
                        <p><strong>{deleteConfirm}</strong> kullanıcısını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.</p>
                        <div className="rm-delete-modal__actions">
                            <button className="btn btn--cancel" onClick={() => setDeleteConfirm(null)}>İptal</button>
                            <button className="btn btn--danger" onClick={() => handleDelete(deleteConfirm)}>
                                <i className="material-icons-round">delete</i>
                                Sil
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
