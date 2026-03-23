import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, push, remove, update } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { useDiscipline } from '../lib/DisciplineContext';
import './AnnouncementsPage.css';

const CATEGORY_ICONS = {
    genel: 'campaign',
    bilgi: 'info',
    uyari: 'warning',
    degisiklik: 'swap_horiz',
    iptal: 'cancel',
    sonuc: 'emoji_events',
};
const CATEGORY_LABELS = {
    genel: 'Genel',
    bilgi: 'Bilgilendirme',
    uyari: 'Uyarı',
    degisiklik: 'Değişiklik',
    iptal: 'İptal',
    sonuc: 'Sonuç',
};
const CATEGORY_COLORS = {
    genel: '#6366F1',
    bilgi: '#2563EB',
    uyari: '#EA580C',
    degisiklik: '#8B5CF6',
    iptal: '#DC2626',
    sonuc: '#16A34A',
};

const DURATION_OPTIONS = [
    { value: 0, label: 'Süresiz (Manuel Silme)' },
    { value: 1, label: '1 Saat' },
    { value: 6, label: '6 Saat' },
    { value: 12, label: '12 Saat' },
    { value: 24, label: '1 Gün' },
    { value: 48, label: '2 Gün' },
    { value: 72, label: '3 Gün' },
    { value: 168, label: '1 Hafta' },
    { value: 336, label: '2 Hafta' },
    { value: 720, label: '1 Ay' },
];

function timeAgo(timestamp) {
    if (!timestamp) return '';
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Az önce';
    if (minutes < 60) return `${minutes} dk önce`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} saat önce`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} gün önce`;
    return new Date(timestamp).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeRemaining(expiresAt) {
    if (!expiresAt) return null;
    const now = Date.now();
    const diff = expiresAt - now;
    if (diff <= 0) return 'Süresi doldu';
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes} dk kaldı`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} saat kaldı`;
    const days = Math.floor(hours / 24);
    return `${days} gün kaldı`;
}

function isExpired(ann) {
    if (!ann.expiresAt) return false; // süresiz = hiç expire olmaz
    return Date.now() > ann.expiresAt;
}

export default function AnnouncementsPage() {
    const navigate = useNavigate();
    const { currentUser, hasPermission } = useAuth();
    const { toast, confirm } = useNotification();
    const { firebasePath, routePrefix } = useDiscipline();

    const [competitions, setCompetitions] = useState({});
    const [selectedCompId, setSelectedCompId] = useState('all');
    const [announcements, setAnnouncements] = useState({});
    const [loading, setLoading] = useState(true);
    const [viewTab, setViewTab] = useState('active'); // 'active' | 'expired'

    // Bulk select
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState(new Set());

    // Modal
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState({
        baslik: '',
        mesaj: '',
        kategori: 'genel',
        competitionId: '',
        oncelik: 'normal',
        sureSaat: 24, // varsayılan 1 gün
    });

    // Firebase listeners
    useEffect(() => {
        const unsubs = [];
        unsubs.push(onValue(ref(db, firebasePath), s => {
            setCompetitions(s.val() || {});
        }));
        unsubs.push(onValue(ref(db, 'broadcasts'), s => {
            setAnnouncements(s.val() || {});
            setLoading(false);
        }));
        return () => unsubs.forEach(u => u());
    }, []);

    const filteredComps = useMemo(
        () => filterCompetitionsByUser(competitions, currentUser),
        [competitions, currentUser]
    );

    const compList = useMemo(
        () => Object.entries(filteredComps)
            .map(([id, c]) => ({ id, ...c }))
            .sort((a, b) => (b.baslangicTarihi || '').localeCompare(a.baslangicTarihi || '')),
        [filteredComps]
    );

    // Duyuruları filtrele ve sırala
    const allFiltered = useMemo(() => {
        return Object.entries(announcements)
            .map(([id, a]) => ({ id, ...a }))
            .filter(a => {
                if (selectedCompId === 'all') return true;
                return a.competitionId === selectedCompId || !a.competitionId;
            })
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }, [announcements, selectedCompId]);

    const activeAnnouncements = useMemo(() => allFiltered.filter(a => !isExpired(a)), [allFiltered]);
    const expiredAnnouncements = useMemo(() => allFiltered.filter(a => isExpired(a)), [allFiltered]);
    const sortedAnnouncements = viewTab === 'active' ? activeAnnouncements : expiredAnnouncements;

    const openAddModal = () => {
        setEditingId(null);
        setFormData({
            baslik: '',
            mesaj: '',
            kategori: 'genel',
            competitionId: selectedCompId !== 'all' ? selectedCompId : '',
            oncelik: 'normal',
            sureSaat: 24,
        });
        setIsModalOpen(true);
    };

    const openEditModal = (ann) => {
        setEditingId(ann.id);
        // Süreyi geri hesapla
        let sureSaat = 0;
        if (ann.expiresAt && ann.createdAt) {
            sureSaat = Math.round((ann.expiresAt - ann.createdAt) / 3600000);
        }
        setFormData({
            baslik: ann.baslik || '',
            mesaj: ann.mesaj || ann.message || '',
            kategori: ann.kategori || 'genel',
            competitionId: ann.competitionId || '',
            oncelik: ann.oncelik || 'normal',
            sureSaat: sureSaat,
        });
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingId(null);
    };

    const handleSave = async () => {
        if (!formData.baslik.trim() || !formData.mesaj.trim()) {
            toast('Başlık ve mesaj zorunludur', 'error');
            return;
        }

        const createdAt = editingId ? (announcements[editingId]?.createdAt || Date.now()) : Date.now();
        const sureSaat = parseInt(formData.sureSaat) || 0;
        const expiresAt = sureSaat > 0 ? createdAt + (sureSaat * 3600000) : null;

        const data = {
            baslik: formData.baslik.trim(),
            mesaj: formData.mesaj.trim(),
            message: formData.mesaj.trim(),
            kategori: formData.kategori,
            competitionId: formData.competitionId || '',
            oncelik: formData.oncelik,
            sureSaat: sureSaat,
            expiresAt: expiresAt,
            createdAt: createdAt,
            updatedAt: Date.now(),
            createdBy: currentUser?.kullaniciAdi || 'admin',
        };

        try {
            if (editingId) {
                await update(ref(db, `broadcasts/${editingId}`), data);
                toast('Duyuru güncellendi', 'success');
            } else {
                await push(ref(db, 'broadcasts'), data);
                toast('Duyuru yayınlandı', 'success');
            }
            closeModal();
        } catch (err) {
            toast('Hata: ' + err.message, 'error');
        }
    };

    const handleDelete = async (annId) => {
        const ok = await confirm('Bu duyuruyu silmek istediğinize emin misiniz?');
        if (!ok) return;
        try {
            await remove(ref(db, `broadcasts/${annId}`));
            toast('Duyuru silindi', 'success');
        } catch (err) {
            toast('Hata: ' + err.message, 'error');
        }
    };

    // Bulk select helpers
    const toggleSelectMode = () => {
        setSelectMode(prev => !prev);
        setSelectedIds(new Set());
    };

    const toggleSelectItem = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === sortedAnnouncements.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(sortedAnnouncements.map(a => a.id)));
        }
    };

    const handleBulkDelete = async (ids) => {
        if (!ids || ids.length === 0) return;
        const label = ids.length === 1 ? '1 duyuruyu' : `${ids.length} duyuruyu`;
        const ok = await confirm(`${label} silmek istediğinize emin misiniz?`);
        if (!ok) return;
        try {
            const updates = {};
            ids.forEach(id => { updates[`broadcasts/${id}`] = null; });
            await update(ref(db), updates);
            toast(`${ids.length} duyuru silindi`, 'success');
            setSelectedIds(new Set());
            setSelectMode(false);
        } catch (err) {
            toast('Hata: ' + err.message, 'error');
        }
    };

    const handleDeleteSelected = () => handleBulkDelete([...selectedIds]);
    const handleDeleteAll = () => handleBulkDelete(sortedAnnouncements.map(a => a.id));

    const canCreate = hasPermission('announcements', 'olustur');
    const canEdit = hasPermission('announcements', 'duzenle');
    const canDelete = hasPermission('announcements', 'sil');

    if (loading) {
        return (
            <div className="ann-page">
                <div className="ann-loading">
                    <div className="ann-loading__spinner" />
                    <span>Yükleniyor...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="ann-page">
            {/* Header */}
            <header className="ann-header">
                <div className="ann-header__left">
                    <button className="ann-back" onClick={() => navigate(routePrefix)}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div>
                        <h1 className="ann-header__title">Duyurular</h1>
                        <p className="ann-header__sub">Yarışma duyuruları ve bildirimler</p>
                    </div>
                </div>
                <div className="ann-header__right">
                    {canDelete && (
                        <button
                            className={`ann-select-toggle ${selectMode ? 'ann-select-toggle--active' : ''}`}
                            onClick={toggleSelectMode}
                        >
                            <i className="material-icons-round">{selectMode ? 'close' : 'checklist'}</i>
                            {selectMode ? 'Vazgeç' : 'Seç'}
                        </button>
                    )}
                    {canCreate && (
                        <button className="ann-create-btn" onClick={openAddModal}>
                            <i className="material-icons-round">add</i>
                            Yeni Duyuru
                        </button>
                    )}
                </div>
            </header>

            <main className="ann-main">
                {/* Filtre */}
                <div className="ann-filter-bar">
                    <div className="ann-filter-group">
                        <i className="material-icons-round">filter_list</i>
                        <select
                            className="ann-filter-select"
                            value={selectedCompId}
                            onChange={e => setSelectedCompId(e.target.value)}
                        >
                            <option value="all">Tüm Yarışmalar</option>
                            {compList.map(c => (
                                <option key={c.id} value={c.id}>{c.isim}</option>
                            ))}
                        </select>
                    </div>
                    <span className="ann-count">{sortedAnnouncements.length} duyuru</span>
                </div>

                {/* Aktif / Geçmiş Tab */}
                <div className="ann-tabs">
                    <button
                        className={`ann-tab ${viewTab === 'active' ? 'ann-tab--active' : ''}`}
                        onClick={() => { setViewTab('active'); setSelectMode(false); setSelectedIds(new Set()); }}
                    >
                        <i className="material-icons-round">campaign</i>
                        Aktif Duyurular
                        {activeAnnouncements.length > 0 && <span className="ann-tab-count">{activeAnnouncements.length}</span>}
                    </button>
                    <button
                        className={`ann-tab ${viewTab === 'expired' ? 'ann-tab--active' : ''}`}
                        onClick={() => { setViewTab('expired'); setSelectMode(false); setSelectedIds(new Set()); }}
                    >
                        <i className="material-icons-round">history</i>
                        Geçmiş Duyurular
                        {expiredAnnouncements.length > 0 && <span className="ann-tab-count">{expiredAnnouncements.length}</span>}
                    </button>
                </div>

                {/* Select bar */}
                {selectMode && sortedAnnouncements.length > 0 && (
                    <div className="ann-select-bar">
                        <label className="ann-checkbox">
                            <input
                                type="checkbox"
                                checked={selectedIds.size === sortedAnnouncements.length && sortedAnnouncements.length > 0}
                                onChange={toggleSelectAll}
                            />
                            <span className="ann-checkbox__box" />
                            <span className="ann-checkbox__label">Tümünü Seç</span>
                        </label>
                        <div className="ann-select-bar__actions">
                            {selectedIds.size > 0 && (
                                <button className="ann-bulk-btn ann-bulk-btn--delete" onClick={handleDeleteSelected}>
                                    <i className="material-icons-round">delete</i>
                                    Seçilenleri Sil
                                    <span className="ann-select-count">{selectedIds.size}</span>
                                </button>
                            )}
                            <button className="ann-bulk-btn ann-bulk-btn--delete-all" onClick={handleDeleteAll}>
                                <i className="material-icons-round">delete_sweep</i>
                                Tümünü Sil
                            </button>
                        </div>
                    </div>
                )}

                {/* Duyuru Listesi */}
                {sortedAnnouncements.length === 0 ? (
                    <div className="ann-empty">
                        <i className="material-icons-round">notifications_off</i>
                        <h3>Duyuru Yok</h3>
                        <p>Henüz yayınlanmış duyuru bulunmuyor</p>
                    </div>
                ) : (
                    <div className="ann-list">
                        {sortedAnnouncements.map(ann => {
                            const cat = ann.kategori || 'genel';
                            const compName = ann.competitionId ? filteredComps[ann.competitionId]?.isim : null;
                            return (
                                <div
                                    key={ann.id}
                                    className={`ann-card ${ann.oncelik === 'yuksek' ? 'ann-card--urgent' : ''} ${selectMode && selectedIds.has(ann.id) ? 'ann-card--selected' : ''}`}
                                    onClick={selectMode ? () => toggleSelectItem(ann.id) : undefined}
                                    style={selectMode ? { cursor: 'pointer' } : undefined}
                                >
                                    {selectMode && (
                                        <label className="ann-checkbox ann-checkbox--card" onClick={e => e.stopPropagation()}>
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(ann.id)}
                                                onChange={() => toggleSelectItem(ann.id)}
                                            />
                                            <span className="ann-checkbox__box" />
                                        </label>
                                    )}
                                    <div className="ann-card__icon" style={{ background: CATEGORY_COLORS[cat] || '#6366F1' }}>
                                        <i className="material-icons-round">{CATEGORY_ICONS[cat] || 'campaign'}</i>
                                    </div>
                                    <div className="ann-card__body">
                                        <div className="ann-card__top">
                                            <h3 className="ann-card__title">
                                                {ann.oncelik === 'yuksek' && (
                                                    <span className="ann-urgent-badge">ÖNEMLİ</span>
                                                )}
                                                {ann.baslik || 'Duyuru'}
                                            </h3>
                                            <span className="ann-card__time">{timeAgo(ann.createdAt)}</span>
                                        </div>
                                        <p className="ann-card__msg">{ann.mesaj || ann.message}</p>
                                        <div className="ann-card__meta">
                                            <span className="ann-cat-badge" style={{ background: `${CATEGORY_COLORS[cat]}18`, color: CATEGORY_COLORS[cat] }}>
                                                {CATEGORY_LABELS[cat] || 'Genel'}
                                            </span>
                                            {compName && (
                                                <span className="ann-comp-badge">
                                                    <i className="material-icons-round">emoji_events</i>
                                                    {compName}
                                                </span>
                                            )}
                                            {ann.expiresAt && (
                                                <span className={`ann-expiry-badge ${isExpired(ann) ? 'ann-expiry-badge--expired' : ''}`}>
                                                    <i className="material-icons-round">{isExpired(ann) ? 'timer_off' : 'timer'}</i>
                                                    {isExpired(ann) ? 'Süresi doldu' : timeRemaining(ann.expiresAt)}
                                                </span>
                                            )}
                                            {!ann.expiresAt && (
                                                <span className="ann-expiry-badge ann-expiry-badge--forever">
                                                    <i className="material-icons-round">all_inclusive</i>
                                                    Süresiz
                                                </span>
                                            )}
                                            {ann.createdBy && (
                                                <span className="ann-author">
                                                    <i className="material-icons-round">person</i>
                                                    {ann.createdBy}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {(canEdit || canDelete) && (
                                        <div className="ann-card__actions">
                                            {canEdit && (
                                                <button className="ann-action" onClick={() => openEditModal(ann)} title="Düzenle">
                                                    <i className="material-icons-round">edit</i>
                                                </button>
                                            )}
                                            {canDelete && (
                                                <button className="ann-action ann-action--del" onClick={() => handleDelete(ann.id)} title="Sil">
                                                    <i className="material-icons-round">delete</i>
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>

            {/* ═══ MODAL ═══ */}
            {isModalOpen && (
                <div className="ann-overlay" onClick={closeModal}>
                    <div className="ann-modal" onClick={e => e.stopPropagation()}>
                        <div className="ann-modal__header">
                            <h2>{editingId ? 'Duyuruyu Düzenle' : 'Yeni Duyuru'}</h2>
                            <button className="ann-modal__close" onClick={closeModal}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>

                        <div className="ann-modal__body">
                            <div className="ann-field">
                                <label>Başlık *</label>
                                <input
                                    type="text"
                                    value={formData.baslik}
                                    onChange={e => setFormData(p => ({ ...p, baslik: e.target.value }))}
                                    placeholder="Duyuru başlığı"
                                    maxLength={200}
                                />
                            </div>

                            <div className="ann-field">
                                <label>Mesaj *</label>
                                <textarea
                                    value={formData.mesaj}
                                    onChange={e => setFormData(p => ({ ...p, mesaj: e.target.value }))}
                                    placeholder="Duyuru içeriğini yazın..."
                                    rows={4}
                                    maxLength={1000}
                                />
                                <span className="ann-char-count">{formData.mesaj.length}/1000</span>
                            </div>

                            <div className="ann-field-row">
                                <div className="ann-field">
                                    <label>Kategori</label>
                                    <select
                                        value={formData.kategori}
                                        onChange={e => setFormData(p => ({ ...p, kategori: e.target.value }))}
                                    >
                                        {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                                            <option key={k} value={k}>{v}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="ann-field">
                                    <label>Öncelik</label>
                                    <div className="ann-priority-toggle">
                                        <button
                                            type="button"
                                            className={`ann-pri-btn ${formData.oncelik === 'normal' ? 'ann-pri-btn--active' : ''}`}
                                            onClick={() => setFormData(p => ({ ...p, oncelik: 'normal' }))}
                                        >Normal</button>
                                        <button
                                            type="button"
                                            className={`ann-pri-btn ann-pri-btn--urgent ${formData.oncelik === 'yuksek' ? 'ann-pri-btn--active' : ''}`}
                                            onClick={() => setFormData(p => ({ ...p, oncelik: 'yuksek' }))}
                                        >Yüksek</button>
                                    </div>
                                </div>
                            </div>

                            <div className="ann-field">
                                <label>Görünme Süresi</label>
                                <select
                                    value={formData.sureSaat}
                                    onChange={e => setFormData(p => ({ ...p, sureSaat: parseInt(e.target.value) }))}
                                >
                                    {DURATION_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                                <span className="ann-field-hint">
                                    {formData.sureSaat > 0
                                        ? `Duyuru ${formData.sureSaat} saat boyunca görünür, sonra geçmiş duyurulara taşınır`
                                        : 'Duyuru manuel silinene kadar aktif kalır'}
                                </span>
                            </div>

                            <div className="ann-field">
                                <label>Yarışma (Opsiyonel)</label>
                                <select
                                    value={formData.competitionId}
                                    onChange={e => setFormData(p => ({ ...p, competitionId: e.target.value }))}
                                >
                                    <option value="">Genel Duyuru (Tüm Yarışmalar)</option>
                                    {compList.map(c => (
                                        <option key={c.id} value={c.id}>{c.isim}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="ann-modal__footer">
                            <button className="ann-modal__btn ann-modal__btn--cancel" onClick={closeModal}>
                                İptal
                            </button>
                            <button className="ann-modal__btn ann-modal__btn--save" onClick={handleSave}>
                                <i className="material-icons-round">{editingId ? 'save' : 'send'}</i>
                                {editingId ? 'Güncelle' : 'Yayınla'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
