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

const cities = Object.keys(turkeyData).sort();

const EMPTY_FORM = {
    kullaniciAdi: '',
    sifre: '',
    rolAdi: '',
    il: '',
    aktif: true,
    izinler: createEmptyPermissions(),
};

export default function RoleManagementPage() {
    const navigate = useNavigate();
    const { hashPassword } = useAuth();
    const [users, setUsers] = useState({});
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterIl, setFilterIl] = useState('');
    const [filterAktif, setFilterAktif] = useState('all'); // all, active, passive

    // Modal state
    const [modalOpen, setModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState(null); // null = yeni kullanıcı
    const [formData, setFormData] = useState({ ...EMPTY_FORM });
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');

    // Delete confirmation
    const [deleteConfirm, setDeleteConfirm] = useState(null);

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
                // Aktiflik filtresi
                if (filterAktif === 'active' && user.aktif === false) return false;
                if (filterAktif === 'passive' && user.aktif !== false) return false;
                return true;
            })
            .sort((a, b) => a.id.localeCompare(b.id, 'tr-TR'));
    }, [users, search, filterIl, filterAktif]);

    // İllerde kullanılan iller (filtre dropdown için)
    const usedCities = useMemo(() => {
        const set = new Set();
        Object.values(users).forEach(u => { if (u.il) set.add(u.il); });
        return [...set].sort((a, b) => a.localeCompare(b, 'tr-TR'));
    }, [users]);

    // Modal aç
    const openModal = (user = null) => {
        if (user) {
            // Düzenleme — şifre alanı boş açılır; boş bırakılırsa mevcut hash korunur
            setEditingUser(user.id);
            setFormData({
                kullaniciAdi: user.id,
                sifre: '',
                rolAdi: user.rolAdi || '',
                il: user.il || '',
                aktif: user.aktif !== false,
                izinler: mergePermissions(user.izinler),
            });
        } else {
            // Yeni kullanıcı
            setEditingUser(null);
            setFormData({ ...EMPTY_FORM, izinler: createEmptyPermissions() });
        }
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
    };

    // İzin toggle
    const togglePermission = (pageKey, actionKey) => {
        setFormData(prev => ({
            ...prev,
            izinler: {
                ...prev.izinler,
                [pageKey]: {
                    ...prev.izinler[pageKey],
                    [actionKey]: !prev.izinler[pageKey][actionKey],
                },
            },
        }));
    };

    // Sayfa tüm izinlerini toggle
    const togglePageAll = (pageKey) => {
        const page = PERMISSION_PAGES.find(p => p.key === pageKey);
        if (!page) return;
        const allTrue = page.actions.every(a => formData.izinler[pageKey]?.[a.key]);
        setFormData(prev => {
            const newPagePerms = {};
            page.actions.forEach(a => { newPagePerms[a.key] = !allTrue; });
            return {
                ...prev,
                izinler: { ...prev.izinler, [pageKey]: newPagePerms },
            };
        });
    };

    // Hızlı seçim butonları
    const setAllPermissions = () => setFormData(prev => ({ ...prev, izinler: createFullPermissions() }));
    const clearAllPermissions = () => setFormData(prev => ({ ...prev, izinler: createEmptyPermissions() }));
    const setViewOnlyPermissions = () => setFormData(prev => ({ ...prev, izinler: createViewOnlyPermissions() }));

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
            const userData = {
                rolAdi: formData.rolAdi.trim(),
                il: formData.il || null,
                aktif: formData.aktif,
                izinler: formData.izinler,
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
                    <button className="back-btn" onClick={() => navigate('/')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div>
                        <h1 className="page-title">Rol Yönetimi</h1>
                        <p className="page-subtitle">Kullanıcı ve yetki yönetimi</p>
                    </div>
                </div>
                <div className="page-header__right">
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
                                        <span className="rm-perm-text">{permCount.granted}/{permCount.total} izin</span>
                                    </div>
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
                                <div className="rm-section__header">
                                    <h3 className="rm-section__title">
                                        <i className="material-icons-round">security</i>
                                        Sayfa İzinleri
                                    </h3>
                                    <div className="rm-quick-btns">
                                        <button type="button" className="rm-quick-btn rm-quick-btn--all" onClick={setAllPermissions}>
                                            Tümünü Seç
                                        </button>
                                        <button type="button" className="rm-quick-btn rm-quick-btn--view" onClick={setViewOnlyPermissions}>
                                            Sadece Görüntüle
                                        </button>
                                        <button type="button" className="rm-quick-btn rm-quick-btn--clear" onClick={clearAllPermissions}>
                                            Tümünü Kaldır
                                        </button>
                                    </div>
                                </div>

                                <div className="rm-perm-grid">
                                    {PERMISSION_PAGES.map(page => {
                                        const allChecked = page.actions.every(a => formData.izinler[page.key]?.[a.key]);
                                        return (
                                            <div key={page.key} className="rm-perm-row">
                                                <div className="rm-perm-row__label">
                                                    <button
                                                        type="button"
                                                        className={`rm-perm-row__toggle ${allChecked ? 'rm-perm-row__toggle--active' : ''}`}
                                                        onClick={() => togglePageAll(page.key)}
                                                        title={allChecked ? 'Tümünü kaldır' : 'Tümünü seç'}
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
                                                                checked={!!formData.izinler[page.key]?.[action.key]}
                                                                onChange={() => togglePermission(page.key, action.key)}
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
