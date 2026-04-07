import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, push, update, remove } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { useDiscipline } from '../lib/DisciplineContext';
import './CoachesPage.css';

const EMPTY_FORM = {
    adSoyad: '',
    il: '',
    kademe: '1',
    tckn: '',
    telefon: '',
    eposta: '',
};

const KADEME_COLORS = {
    '1': 'blue',
    '2': 'green',
    '3': 'orange',
    '4': 'purple',
};

function KademeBadge({ kademe }) {
    const color = KADEME_COLORS[String(kademe)] || 'gray';
    return (
        <span className={`coaches-badge coaches-badge--${color}`}>
            {kademe}. Kademe
        </span>
    );
}

export default function CoachesPage() {
    const navigate = useNavigate();
    const { hasPermission } = useAuth();
    const { toast, confirm } = useNotification();
    const { routePrefix } = useDiscipline();

    const canEdit = hasPermission('coaches', 'duzenle');

    // ── Data state ──
    const [coaches, setCoaches] = useState([]);
    const [loading, setLoading] = useState(true);

    // ── Filter state ──
    const [searchTerm, setSearchTerm] = useState('');
    const [filterIl, setFilterIl] = useState('');
    const [filterKademe, setFilterKademe] = useState('');

    // ── Modal state ──
    const [modalOpen, setModalOpen] = useState(false);
    const [editingCoach, setEditingCoach] = useState(null); // null = add mode
    const [formData, setFormData] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);

    // ── Bulk select ──
    const [selectedIds, setSelectedIds] = useState(new Set());

    // ── Import state ──
    const [importing, setImporting] = useState(false);
    const [importProgress, setImportProgress] = useState(null); // { done, total }

    // ── Subscribe to Firebase ──
    useEffect(() => {
        const dbRef = ref(db, 'antrenorler');
        const unsub = onValue(dbRef, (snap) => {
            if (snap.exists()) {
                const data = snap.val();
                const list = Object.entries(data).map(([id, val]) => ({ id, ...val }));
                list.sort((a, b) => (a.adSoyad || '').localeCompare(b.adSoyad || '', 'tr'));
                setCoaches(list);
            } else {
                setCoaches([]);
            }
            setLoading(false);
        });
        return () => unsub();
    }, []);

    // ── Derived data ──
    const ilOptions = useMemo(() => {
        const set = new Set(coaches.map((c) => c.il).filter(Boolean));
        return Array.from(set).sort((a, b) => a.localeCompare(b, 'tr'));
    }, [coaches]);

    const filtered = useMemo(() => {
        return coaches.filter((c) => {
            const term = searchTerm.toLowerCase();
            const matchSearch =
                !term ||
                (c.adSoyad || '').toLowerCase().includes(term) ||
                (c.il || '').toLowerCase().includes(term) ||
                (c.telefon || '').includes(term);
            const matchIl = !filterIl || c.il === filterIl;
            const matchKademe = !filterKademe || String(c.kademe) === filterKademe;
            return matchSearch && matchIl && matchKademe;
        });
    }, [coaches, searchTerm, filterIl, filterKademe]);

    const kademeCounts = useMemo(() => {
        const counts = { '1': 0, '2': 0, '3': 0, '4': 0 };
        coaches.forEach((c) => {
            const k = String(c.kademe);
            if (counts[k] !== undefined) counts[k]++;
        });
        return counts;
    }, [coaches]);

    // ── Modal helpers ──
    function openAddModal() {
        setEditingCoach(null);
        setFormData(EMPTY_FORM);
        setModalOpen(true);
    }

    function openEditModal(coach) {
        setEditingCoach(coach);
        setFormData({
            adSoyad: coach.adSoyad || '',
            il: coach.il || '',
            kademe: String(coach.kademe || '1'),
            tckn: coach.tckn || '',
            telefon: coach.telefon || '',
            eposta: coach.eposta || '',
        });
        setModalOpen(true);
    }

    function closeModal() {
        setModalOpen(false);
        setEditingCoach(null);
        setFormData(EMPTY_FORM);
    }

    function handleFormChange(e) {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    }

    function handleAdSoyadBlur(e) {
        const upper = e.target.value.toLocaleUpperCase('tr-TR');
        setFormData((prev) => ({ ...prev, adSoyad: upper }));
    }

    async function handleSave() {
        if (!formData.adSoyad.trim()) {
            toast('Ad Soyad alanı zorunludur.', 'error');
            return;
        }
        setSaving(true);
        try {
            const now = Math.floor(Date.now() / 1000);
            const payload = {
                adSoyad: formData.adSoyad.trim().toLocaleUpperCase('tr-TR'),
                il: formData.il.trim().toLocaleUpperCase('tr-TR'),
                kademe: formData.kademe,
                tckn: formData.tckn.trim(),
                telefon: formData.telefon.trim(),
                eposta: formData.eposta.trim(),
                updatedAt: now,
            };
            if (editingCoach) {
                await update(ref(db, `antrenorler/${editingCoach.id}`), payload);
                toast('Antrenör güncellendi.', 'success');
            } else {
                payload.createdAt = now;
                await push(ref(db, 'antrenorler'), payload);
                toast('Antrenör eklendi.', 'success');
            }
            closeModal();
        } catch (err) {
            if (import.meta.env.DEV) console.error(err);
            toast('Kayıt sırasında hata oluştu.', 'error');
        } finally {
            setSaving(false);
        }
    }

    // ── Delete ──
    async function handleDelete(coach) {
        const ok = await confirm(`"${coach.adSoyad}" adlı antrenörü silmek istediğinize emin misiniz?`);
        if (!ok) return;
        try {
            await remove(ref(db, `antrenorler/${coach.id}`));
            toast('Antrenör silindi.', 'success');
            setSelectedIds((prev) => {
                const next = new Set(prev);
                next.delete(coach.id);
                return next;
            });
        } catch (err) {
            if (import.meta.env.DEV) console.error(err);
            toast('Silme sırasında hata oluştu.', 'error');
        }
    }

    async function handleBulkDelete() {
        if (selectedIds.size === 0) return;
        const ok = await confirm(`Seçili ${selectedIds.size} antrenörü silmek istediğinize emin misiniz?`);
        if (!ok) return;
        try {
            const updates = {};
            selectedIds.forEach((id) => {
                updates[`antrenorler/${id}`] = null;
            });
            await update(ref(db), updates);
            setSelectedIds(new Set());
            toast(`${selectedIds.size} antrenör silindi.`, 'success');
        } catch (err) {
            if (import.meta.env.DEV) console.error(err);
            toast('Toplu silme sırasında hata oluştu.', 'error');
        }
    }

    // ── Bulk select helpers ──
    const allFilteredSelected =
        filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));

    function toggleSelectAll() {
        if (allFilteredSelected) {
            setSelectedIds((prev) => {
                const next = new Set(prev);
                filtered.forEach((c) => next.delete(c.id));
                return next;
            });
        } else {
            setSelectedIds((prev) => {
                const next = new Set(prev);
                filtered.forEach((c) => next.add(c.id));
                return next;
            });
        }
    }

    function toggleSelect(id) {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    // ── Import from JSON ──
    async function handleImport() {
        const ok = await confirm(
            'coaches_2026.json dosyasından tüm antrenörler Firebase\'e aktarılacak. Devam etmek istiyor musunuz?'
        );
        if (!ok) return;
        setImporting(true);
        setImportProgress({ done: 0, total: 0 });
        try {
            const res = await fetch('/data/coaches_2026.json');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const records = Array.isArray(data) ? data : Object.values(data);
            const total = records.length;
            setImportProgress({ done: 0, total });
            let done = 0;
            const CHUNK = 20;
            for (let i = 0; i < records.length; i += CHUNK) {
                const chunk = records.slice(i, i + CHUNK);
                const promises = chunk.map((record) => {
                    const now = Math.floor(Date.now() / 1000);
                    const payload = {
                        adSoyad: (record.adSoyad || '').trim().toLocaleUpperCase('tr-TR'),
                        il: (record.il || '').trim().toLocaleUpperCase('tr-TR'),
                        kademe: String(record.kademe || '1'),
                        tckn: (record.tckn || '').trim(),
                        telefon: (record.telefon || '').trim(),
                        eposta: (record.eposta || '').trim(),
                        createdAt: record.createdAt || now,
                        updatedAt: now,
                    };
                    return push(ref(db, 'antrenorler'), payload);
                });
                await Promise.all(promises);
                done += chunk.length;
                setImportProgress({ done, total });
            }
            toast(`${total} antrenör başarıyla içe aktarıldı.`, 'success');
        } catch (err) {
            if (import.meta.env.DEV) console.error(err);
            toast('İçe aktarma sırasında hata oluştu: ' + err.message, 'error');
        } finally {
            setImporting(false);
            setImportProgress(null);
        }
    }

    // ── CSV Export ──
    function handleExport() {
        const BOM = '\uFEFF';
        const headers = ['No', 'Ad Soyad', 'İl', 'Kademe', 'TCKN', 'Telefon', 'E-posta'];
        const rows = filtered.map((c, i) => [
            i + 1,
            `"${(c.adSoyad || '').replace(/"/g, '""')}"`,
            `"${(c.il || '').replace(/"/g, '""')}"`,
            c.kademe || '',
            c.tckn || '',
            c.telefon || '',
            c.eposta || '',
        ]);
        const csvContent =
            BOM +
            [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'antrenorler.csv';
        a.click();
        URL.revokeObjectURL(url);
    }

    // ── Render ──
    return (
        <div className="coaches-page">
            {/* ── Header ── */}
            <header className="page-header">
                <div className="page-header__left">
                    <button className="back-btn" onClick={() => navigate(`${routePrefix}/`)}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div>
                        <div className="page-title">Kayıtlı Antrenörler</div>
                        <div className="page-subtitle">
                            {loading ? 'Yükleniyor…' : `${coaches.length} antrenör`}
                        </div>
                    </div>
                </div>
                <div className="page-header__right">
                    {canEdit && (
                        <>
                            <button
                                className="coaches-btn coaches-btn--outline"
                                onClick={handleImport}
                                disabled={importing}
                                title="coaches_2026.json'dan İçe Aktar"
                            >
                                <i className="material-icons-round">upload_file</i>
                                <span className="coaches-btn-label">
                                    {importing && importProgress
                                        ? `${importProgress.done} / ${importProgress.total} aktarılıyor…`
                                        : "JSON'dan İçe Aktar"}
                                </span>
                            </button>
                            <button
                                className="coaches-btn coaches-btn--outline"
                                onClick={handleExport}
                                disabled={filtered.length === 0}
                                title="Excel'e Aktar"
                            >
                                <i className="material-icons-round">download</i>
                                <span className="coaches-btn-label">Excel'e Aktar</span>
                            </button>
                            <button
                                className="coaches-btn coaches-btn--primary"
                                onClick={openAddModal}
                            >
                                <i className="material-icons-round">person_add</i>
                                <span className="coaches-btn-label">Antrenör Ekle</span>
                            </button>
                        </>
                    )}
                </div>
            </header>

            {/* ── Main content ── */}
            <main className="page-content coaches-content">
                {/* ── Stats row ── */}
                <div className="coaches-stats">
                    <div className="coaches-stat-card">
                        <span className="coaches-stat-value">{coaches.length}</span>
                        <span className="coaches-stat-label">Toplam</span>
                    </div>
                    {['1', '2', '3', '4'].map((k) => (
                        <div key={k} className={`coaches-stat-card coaches-stat-card--k${k}`}>
                            <span className="coaches-stat-value">{kademeCounts[k]}</span>
                            <span className="coaches-stat-label">{k}. Kademe</span>
                        </div>
                    ))}
                </div>

                {/* ── Controls ── */}
                <div className="coaches-controls">
                    <div className="coaches-search-wrapper">
                        <i className="material-icons-round coaches-search-icon">search</i>
                        <input
                            className="coaches-search-input"
                            type="text"
                            placeholder="Ad soyad, il veya telefon ara…"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        {searchTerm && (
                            <button
                                className="coaches-search-clear"
                                onClick={() => setSearchTerm('')}
                            >
                                <i className="material-icons-round">close</i>
                            </button>
                        )}
                    </div>

                    <select
                        className="coaches-filter-select"
                        value={filterIl}
                        onChange={(e) => setFilterIl(e.target.value)}
                    >
                        <option value="">Tüm İller</option>
                        {ilOptions.map((il) => (
                            <option key={il} value={il}>{il}</option>
                        ))}
                    </select>

                    <select
                        className="coaches-filter-select"
                        value={filterKademe}
                        onChange={(e) => setFilterKademe(e.target.value)}
                    >
                        <option value="">Tüm Kademeler</option>
                        <option value="1">1. Kademe</option>
                        <option value="2">2. Kademe</option>
                        <option value="3">3. Kademe</option>
                        <option value="4">4. Kademe</option>
                    </select>

                    {(filterIl || filterKademe || searchTerm) && (
                        <button
                            className="coaches-btn coaches-btn--ghost coaches-btn--sm"
                            onClick={() => { setFilterIl(''); setFilterKademe(''); setSearchTerm(''); }}
                        >
                            <i className="material-icons-round">filter_alt_off</i>
                            Filtreleri Temizle
                        </button>
                    )}

                    <div className="coaches-controls-spacer" />

                    {canEdit && selectedIds.size > 0 && (
                        <button
                            className="coaches-btn coaches-btn--danger coaches-btn--sm"
                            onClick={handleBulkDelete}
                        >
                            <i className="material-icons-round">delete_sweep</i>
                            {selectedIds.size} Kaydı Sil
                        </button>
                    )}
                </div>

                {/* ── Table card ── */}
                <div className="coaches-card">
                    {loading ? (
                        <div className="coaches-loading">
                            <div className="coaches-spinner" />
                            <span>Antrenörler yükleniyor…</span>
                        </div>
                    ) : coaches.length === 0 ? (
                        <div className="coaches-empty">
                            <i className="material-icons-round coaches-empty-icon">sports_gymnastics</i>
                            <h3 className="coaches-empty-title">Henüz antrenör kaydı yok</h3>
                            <p className="coaches-empty-desc">
                                Yeni bir antrenör ekleyin veya JSON dosyasından içe aktarın.
                            </p>
                            {canEdit && (
                                <div className="coaches-empty-actions">
                                    <button className="coaches-btn coaches-btn--primary" onClick={openAddModal}>
                                        <i className="material-icons-round">person_add</i>
                                        Antrenör Ekle
                                    </button>
                                    <button
                                        className="coaches-btn coaches-btn--outline"
                                        onClick={handleImport}
                                        disabled={importing}
                                    >
                                        <i className="material-icons-round">upload_file</i>
                                        {importing && importProgress
                                            ? `${importProgress.done} / ${importProgress.total} aktarılıyor…`
                                            : "coaches_2026.json'dan İçe Aktar"}
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="coaches-empty">
                            <i className="material-icons-round coaches-empty-icon">search_off</i>
                            <h3 className="coaches-empty-title">Sonuç bulunamadı</h3>
                            <p className="coaches-empty-desc">Arama veya filtre kriterlerini değiştirin.</p>
                        </div>
                    ) : (
                        <div className="coaches-table-wrapper">
                            <table className="coaches-table">
                                <thead>
                                    <tr>
                                        {canEdit && (
                                            <th className="coaches-th coaches-th--check">
                                                <input
                                                    type="checkbox"
                                                    className="coaches-checkbox"
                                                    checked={allFilteredSelected}
                                                    onChange={toggleSelectAll}
                                                    title="Tümünü seç"
                                                />
                                            </th>
                                        )}
                                        <th className="coaches-th coaches-th--no">No</th>
                                        <th className="coaches-th">Ad Soyad</th>
                                        <th className="coaches-th coaches-th--hide-sm">İl</th>
                                        <th className="coaches-th coaches-th--hide-sm">Kademe</th>
                                        <th className="coaches-th coaches-th--hide-md">Telefon</th>
                                        <th className="coaches-th coaches-th--hide-md">E-posta</th>
                                        {canEdit && (
                                            <th className="coaches-th coaches-th--actions">İşlemler</th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map((coach, idx) => (
                                        <tr
                                            key={coach.id}
                                            className={`coaches-tr${selectedIds.has(coach.id) ? ' coaches-tr--selected' : ''}`}
                                        >
                                            {canEdit && (
                                                <td className="coaches-td coaches-td--check">
                                                    <input
                                                        type="checkbox"
                                                        className="coaches-checkbox"
                                                        checked={selectedIds.has(coach.id)}
                                                        onChange={() => toggleSelect(coach.id)}
                                                    />
                                                </td>
                                            )}
                                            <td className="coaches-td coaches-td--no">{idx + 1}</td>
                                            <td className="coaches-td coaches-td--name">
                                                <span className="coaches-name">{coach.adSoyad}</span>
                                                {/* Mobile: show il and kademe inline */}
                                                <span className="coaches-meta-mobile">
                                                    {coach.il && <span className="coaches-meta-il">{coach.il}</span>}
                                                    {coach.kademe && <KademeBadge kademe={coach.kademe} />}
                                                </span>
                                            </td>
                                            <td className="coaches-td coaches-td--hide-sm">{coach.il || '—'}</td>
                                            <td className="coaches-td coaches-td--hide-sm">
                                                {coach.kademe ? <KademeBadge kademe={coach.kademe} /> : '—'}
                                            </td>
                                            <td className="coaches-td coaches-td--hide-md coaches-td--mono">
                                                {coach.telefon || '—'}
                                            </td>
                                            <td className="coaches-td coaches-td--hide-md coaches-td--email">
                                                {coach.eposta ? (
                                                    <a href={`mailto:${coach.eposta}`} className="coaches-email-link">
                                                        {coach.eposta}
                                                    </a>
                                                ) : '—'}
                                            </td>
                                            {canEdit && (
                                                <td className="coaches-td coaches-td--actions">
                                                    <button
                                                        className="coaches-action-btn coaches-action-btn--edit"
                                                        onClick={() => openEditModal(coach)}
                                                        title="Düzenle"
                                                    >
                                                        <i className="material-icons-round">edit</i>
                                                    </button>
                                                    <button
                                                        className="coaches-action-btn coaches-action-btn--delete"
                                                        onClick={() => handleDelete(coach)}
                                                        title="Sil"
                                                    >
                                                        <i className="material-icons-round">delete</i>
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div className="coaches-table-footer">
                                {filtered.length} antrenör gösteriliyor
                                {filtered.length !== coaches.length && ` (toplam ${coaches.length} içinden)`}
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {/* ── Add/Edit Modal ── */}
            {modalOpen && (
                <div className="coaches-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
                    <div className="coaches-modal">
                        <div className="coaches-modal-header">
                            <h2 className="coaches-modal-title">
                                {editingCoach ? 'Antrenörü Düzenle' : 'Yeni Antrenör Ekle'}
                            </h2>
                            <button className="coaches-modal-close" onClick={closeModal}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>

                        <div className="coaches-modal-body">
                            <div className="coaches-form-grid">
                                <div className="coaches-form-group coaches-form-group--full">
                                    <label className="coaches-label">
                                        Ad Soyad <span className="coaches-label-required">*</span>
                                    </label>
                                    <input
                                        className="coaches-input"
                                        type="text"
                                        name="adSoyad"
                                        value={formData.adSoyad}
                                        onChange={handleFormChange}
                                        onBlur={handleAdSoyadBlur}
                                        placeholder="AHMET YILMAZ"
                                        autoFocus
                                    />
                                </div>

                                <div className="coaches-form-group">
                                    <label className="coaches-label">İl</label>
                                    <input
                                        className="coaches-input"
                                        type="text"
                                        name="il"
                                        value={formData.il}
                                        onChange={handleFormChange}
                                        placeholder="ANKARA"
                                    />
                                </div>

                                <div className="coaches-form-group">
                                    <label className="coaches-label">Kademe</label>
                                    <select
                                        className="coaches-input coaches-select"
                                        name="kademe"
                                        value={formData.kademe}
                                        onChange={handleFormChange}
                                    >
                                        <option value="1">1. Kademe</option>
                                        <option value="2">2. Kademe</option>
                                        <option value="3">3. Kademe</option>
                                        <option value="4">4. Kademe</option>
                                    </select>
                                </div>

                                <div className="coaches-form-group">
                                    <label className="coaches-label">TC Kimlik No</label>
                                    <input
                                        className="coaches-input"
                                        type="text"
                                        name="tckn"
                                        value={formData.tckn}
                                        onChange={handleFormChange}
                                        placeholder="12345678901"
                                        maxLength={11}
                                    />
                                </div>

                                <div className="coaches-form-group">
                                    <label className="coaches-label">Telefon</label>
                                    <input
                                        className="coaches-input"
                                        type="tel"
                                        name="telefon"
                                        value={formData.telefon}
                                        onChange={handleFormChange}
                                        placeholder="5551234567"
                                    />
                                </div>

                                <div className="coaches-form-group coaches-form-group--full">
                                    <label className="coaches-label">E-posta</label>
                                    <input
                                        className="coaches-input"
                                        type="email"
                                        name="eposta"
                                        value={formData.eposta}
                                        onChange={handleFormChange}
                                        placeholder="ornek@eposta.com"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="coaches-modal-footer">
                            <button
                                className="coaches-btn coaches-btn--ghost"
                                onClick={closeModal}
                                disabled={saving}
                            >
                                İptal
                            </button>
                            <button
                                className="coaches-btn coaches-btn--primary"
                                onClick={handleSave}
                                disabled={saving}
                            >
                                {saving ? (
                                    <>
                                        <span className="coaches-spinner coaches-spinner--sm" />
                                        Kaydediliyor…
                                    </>
                                ) : (
                                    <>
                                        <i className="material-icons-round">save</i>
                                        {editingCoach ? 'Güncelle' : 'Kaydet'}
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Import progress overlay ── */}
            {importing && importProgress && importProgress.total > 0 && (
                <div className="coaches-import-overlay">
                    <div className="coaches-import-card">
                        <div className="coaches-spinner coaches-spinner--lg" />
                        <div className="coaches-import-text">
                            <strong>{importProgress.done} / {importProgress.total}</strong> aktarılıyor…
                        </div>
                        <div className="coaches-import-bar">
                            <div
                                className="coaches-import-bar-fill"
                                style={{ width: `${importProgress.total > 0 ? (importProgress.done / importProgress.total) * 100 : 0}%` }}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
