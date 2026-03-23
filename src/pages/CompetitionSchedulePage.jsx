import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, push, set, remove, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import './CompetitionSchedulePage.css';

/* ── Yardımcı fonksiyonlar ── */
const getCategoryLabel = (catKey) =>
    catKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const ALET_LABELS = {
    atlama: 'Atlama', barfiks: 'Barfiks', halka: 'Halka', kulplu: 'Kulplu Beygir',
    mantar: 'Mantar Beygir', paralel: 'Paralel', yer: 'Yer', denge: 'Denge Aleti',
    asimetrik: 'Asimetrik Paralel', ritmik: 'Ritmik',
};
const getAletLabel = (key) => ALET_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);

const SESSION_COLORS = {
    bekliyor: '#94A3B8',
    devam: '#2563EB',
    tamamlandi: '#16A34A',
};
const SESSION_LABELS = {
    bekliyor: 'Bekliyor',
    devam: 'Devam Ediyor',
    tamamlandi: 'Tamamlandı',
};

function formatDateTR(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function generateDateRange(start, end) {
    const dates = [];
    const s = new Date(start);
    const e = new Date(end || start);
    while (s <= e) {
        dates.push(s.toISOString().split('T')[0]);
        s.setDate(s.getDate() + 1);
    }
    return dates;
}

export default function CompetitionSchedulePage() {
    const navigate = useNavigate();
    const { currentUser, hasPermission } = useAuth();
    const { toast, confirm } = useNotification();

    const canCreate = hasPermission('schedule', 'olustur');
    const canEdit = hasPermission('schedule', 'duzenle');
    const canDelete = hasPermission('schedule', 'sil');

    const [competitions, setCompetitions] = useState({});
    const [selectedCompId, setSelectedCompId] = useState('');
    const [sessions, setSessions] = useState({});
    const [loading, setLoading] = useState(true);

    // Modal state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSession, setEditingSession] = useState(null);
    const [generating, setGenerating] = useState(false);
    const [formData, setFormData] = useState({
        tarih: '',
        saat: '09:00',
        bitisSaat: '10:00',
        kategori: '',
        alet: '',
        aciklama: '',
        durum: 'bekliyor',
    });

    // Firebase — yarışmalar
    useEffect(() => {
        const unsub = onValue(ref(db, 'competitions'), (s) => {
            const data = s.val() || {};
            setCompetitions(data);
            setLoading(false);
        });
        return () => unsub();
    }, []);

    // Firebase — seçili yarışmanın programı
    useEffect(() => {
        if (!selectedCompId) { setSessions({}); return; }
        const unsub = onValue(ref(db, `competitions/${selectedCompId}/program`), (s) => {
            setSessions(s.val() || {});
        });
        return () => unsub();
    }, [selectedCompId]);

    // Filtrelenmiş yarışmalar
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

    const selectedComp = selectedCompId ? filteredComps[selectedCompId] : null;

    // Yarışma kategorileri ve aletleri
    const compKategoriler = useMemo(() => {
        if (!selectedComp?.kategoriler) return {};
        return selectedComp.kategoriler;
    }, [selectedComp]);

    const compCatKeys = useMemo(() => Object.keys(compKategoriler), [compKategoriler]);

    const getAletlerForCat = (catKey) => {
        const cat = compKategoriler[catKey];
        if (!cat?.aletler) return [];
        const raw = cat.aletler;
        if (Array.isArray(raw)) return raw;
        if (raw && typeof raw === 'object') return Object.values(raw).map(a => typeof a === 'string' ? a : a?.id || '').filter(Boolean);
        return [];
    };

    // Tarihlere göre grupla
    const dateRange = useMemo(() => {
        if (!selectedComp) return [];
        const start = selectedComp.baslangicTarihi;
        const end = selectedComp.bitisTarihi || start;
        if (!start) return [];
        return generateDateRange(start, end);
    }, [selectedComp]);

    const sessionsByDate = useMemo(() => {
        const grouped = {};
        dateRange.forEach(d => { grouped[d] = []; });

        Object.entries(sessions).forEach(([id, sess]) => {
            const d = sess.tarih || dateRange[0];
            if (!grouped[d]) grouped[d] = [];
            grouped[d].push({ id, ...sess });
        });

        // Saate göre sırala
        Object.values(grouped).forEach(arr => arr.sort((a, b) => (a.saat || '').localeCompare(b.saat || '')));
        return grouped;
    }, [sessions, dateRange]);

    // ── Modal işlemleri ──
    const openAddModal = (tarih) => {
        setEditingSession(null);
        setFormData({
            tarih: tarih || dateRange[0] || '',
            saat: '09:00',
            bitisSaat: '10:00',
            kategori: compCatKeys[0] || '',
            alet: '',
            aciklama: '',
            durum: 'bekliyor',
        });
        setIsModalOpen(true);
    };

    const openEditModal = (sess) => {
        setEditingSession(sess);
        setFormData({
            tarih: sess.tarih || '',
            saat: sess.saat || '09:00',
            bitisSaat: sess.bitisSaat || '10:00',
            kategori: sess.kategori || '',
            alet: sess.alet || '',
            aciklama: sess.aciklama || '',
            durum: sess.durum || 'bekliyor',
        });
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingSession(null);
    };

    const handleSave = async () => {
        if (!formData.saat || !formData.kategori) {
            toast('Saat ve kategori zorunludur', 'error');
            return;
        }

        const sessionData = {
            tarih: formData.tarih,
            saat: formData.saat,
            bitisSaat: formData.bitisSaat,
            kategori: formData.kategori,
            alet: formData.alet || '',
            aciklama: formData.aciklama || `${getCategoryLabel(formData.kategori)}${formData.alet ? ' — ' + getAletLabel(formData.alet) : ''}`,
            durum: formData.durum,
        };

        try {
            if (editingSession) {
                await update(ref(db, `competitions/${selectedCompId}/program/${editingSession.id}`), sessionData);
                toast('Oturum güncellendi', 'success');
            } else {
                await push(ref(db, `competitions/${selectedCompId}/program`), sessionData);
                toast('Oturum eklendi', 'success');
            }
            closeModal();
        } catch (err) {
            toast('Hata: ' + err.message, 'error');
        }
    };

    const handleDelete = async (sessId) => {
        const ok = await confirm('Bu oturumu silmek istediğinize emin misiniz?');
        if (!ok) return;
        try {
            await remove(ref(db, `competitions/${selectedCompId}/program/${sessId}`));
            toast('Oturum silindi', 'success');
        } catch (err) {
            toast('Hata: ' + err.message, 'error');
        }
    };

    const handleStatusChange = async (sessId, newStatus) => {
        try {
            await update(ref(db, `competitions/${selectedCompId}/program/${sessId}`), { durum: newStatus });
        } catch (err) {
            toast('Hata: ' + err.message, 'error');
        }
    };

    // Sporcu sayılarını getir (yarışma verisindeki sporcular)
    const [athleteCounts, setAthleteCounts] = useState({});
    useEffect(() => {
        if (!selectedCompId) { setAthleteCounts({}); return; }
        const unsub = onValue(ref(db, `competitions/${selectedCompId}/sporcular`), (s) => {
            const data = s.val() || {};
            const counts = {};
            Object.entries(data).forEach(([catKey, athletes]) => {
                counts[catKey] = athletes && typeof athletes === 'object' ? Object.keys(athletes).length : 0;
            });
            setAthleteCounts(counts);
        });
        return () => unsub();
    }, [selectedCompId]);

    // ── Otomatik Program Oluştur ──
    const handleAutoGenerate = async () => {
        if (!selectedCompId) return;

        if (compCatKeys.length === 0) {
            toast('Yarışmada kategori bulunamadı', 'error');
            return;
        }

        // Mevcut oturumlar varsa onay iste
        if (Object.keys(sessions).length > 0) {
            const ok = await confirm('Mevcut program silinip yeniden oluşturulacak. Onaylıyor musunuz?');
            if (!ok) return;
        }

        setGenerating(true);

        try {
            // Sporcu sayılarını doğrudan Firebase'den oku (race condition önlemi)
            const athleteSnap = await get(ref(db, `competitions/${selectedCompId}/sporcular`));
            const athleteData = athleteSnap.val() || {};
            const freshAthleteCounts = {};
            Object.entries(athleteData).forEach(([catKey, athletes]) => {
                freshAthleteCounts[catKey] = athletes && typeof athletes === 'object' ? Object.keys(athletes).length : 0;
            });

            // Parametreler
            const ATHLETES_PER_SLOT = 8;
            const SLOT_DURATION_MIN = 30;
            const DAY_START_HOUR = 9;
            const DAY_END_HOUR = 18;
            const BREAK_DURATION_MIN = 15;

            const dates = [...dateRange];
            if (dates.length === 0) {
                toast('Yarışma tarih aralığı bulunamadı', 'error');
                setGenerating(false);
                return;
            }

            // Tüm kategori-alet çiftlerini sporcu sayısına göre oturumlara böl
            const allSlots = [];
            compCatKeys.forEach(catKey => {
                const aletler = getAletlerForCat(catKey);
                const totalAthletes = freshAthleteCounts[catKey] || 0;

                if (aletler.length === 0) {
                    const slotCount = Math.max(1, Math.ceil(totalAthletes / ATHLETES_PER_SLOT));
                    for (let i = 0; i < slotCount; i++) {
                        allSlots.push({ kategori: catKey, alet: '', aciklama: getCategoryLabel(catKey) });
                    }
                } else {
                    aletler.forEach(alet => {
                        const slotCount = Math.max(1, Math.ceil(totalAthletes / ATHLETES_PER_SLOT));
                        for (let i = 0; i < slotCount; i++) {
                            allSlots.push({
                                kategori: catKey,
                                alet: alet,
                                aciklama: `${getCategoryLabel(catKey)} — ${getAletLabel(alet)}`,
                            });
                        }
                    });
                }
            });

            // Slotları günlere dağıt (zaman taşmasını önle)
            const slotsPerDay = Math.floor(((DAY_END_HOUR - DAY_START_HOUR) * 60) / SLOT_DURATION_MIN);
            const newSessions = {};
            let currentDayIdx = 0;
            let currentSlotInDay = 0;
            let prevCategory = null;

            allSlots.forEach((slot) => {
                // Kategori değiştiğinde mola ekle
                if (prevCategory && prevCategory !== slot.kategori) {
                    const breakSlots = Math.ceil(BREAK_DURATION_MIN / SLOT_DURATION_MIN);
                    currentSlotInDay += breakSlots;
                }

                // Gün doluysa sonraki güne geç
                if (currentSlotInDay >= slotsPerDay) {
                    currentDayIdx++;
                    currentSlotInDay = 0;
                }

                const dayIdx = Math.min(currentDayIdx, dates.length - 1);

                const startMin = DAY_START_HOUR * 60 + currentSlotInDay * SLOT_DURATION_MIN;
                const endMin = startMin + SLOT_DURATION_MIN;

                const startH = String(Math.floor(startMin / 60)).padStart(2, '0');
                const startM = String(startMin % 60).padStart(2, '0');
                const endH = String(Math.floor(endMin / 60)).padStart(2, '0');
                const endM = String(endMin % 60).padStart(2, '0');

                const key = push(ref(db, `competitions/${selectedCompId}/program`)).key;
                newSessions[key] = {
                    tarih: dates[dayIdx],
                    saat: `${startH}:${startM}`,
                    bitisSaat: `${endH}:${endM}`,
                    kategori: slot.kategori,
                    alet: slot.alet,
                    aciklama: slot.aciklama,
                    durum: 'bekliyor',
                };

                prevCategory = slot.kategori;
                currentSlotInDay++;
            });

            await set(ref(db, `competitions/${selectedCompId}/program`), newSessions);
            toast(`${Object.keys(newSessions).length} oturum otomatik oluşturuldu`, 'success');
        } catch (err) {
            toast('Hata: ' + err.message, 'error');
        } finally {
            setGenerating(false);
        }
    };

    // İstatistikler
    const totalSessions = Object.keys(sessions).length;
    const completedSessions = Object.values(sessions).filter(s => s.durum === 'tamamlandi').length;
    const activeSessions = Object.values(sessions).filter(s => s.durum === 'devam').length;

    if (loading) {
        return (
            <div className="schedule-page">
                <div className="schedule-loading">
                    <div className="schedule-loading__spinner" />
                    <span>Yükleniyor...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="schedule-page">
            {/* Header */}
            <header className="sched-header">
                <div className="sched-header__left">
                    <button className="sched-back-btn" onClick={() => navigate('/artistik')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div>
                        <h1 className="sched-header__title">Yarışma Programı</h1>
                        <p className="sched-header__sub">Gün ve saat bazlı oturum planlaması</p>
                    </div>
                </div>
                {selectedCompId && (
                    <div className="sched-header__stats">
                        <span className="sched-stat" title="Toplam oturum">
                            <i className="material-icons-round">event_note</i> {totalSessions}
                        </span>
                        {activeSessions > 0 && (
                            <span className="sched-stat sched-stat--blue" title="Devam eden">
                                <i className="material-icons-round">play_circle</i> {activeSessions}
                            </span>
                        )}
                        <span className="sched-stat sched-stat--green" title="Tamamlanan">
                            <i className="material-icons-round">check_circle</i> {completedSessions}/{totalSessions}
                        </span>
                    </div>
                )}
            </header>

            <main className="sched-main">
                {/* Yarışma Seçici */}
                <div className="sched-selector">
                    <label className="sched-selector__label">
                        <i className="material-icons-round">emoji_events</i>
                        Yarışma Seçin
                    </label>
                    <select
                        className="sched-selector__select"
                        value={selectedCompId}
                        onChange={e => setSelectedCompId(e.target.value)}
                    >
                        <option value="">— Yarışma seçin —</option>
                        {compList.map(c => (
                            <option key={c.id} value={c.id}>{c.isim} ({c.il || 'Bilinmiyor'})</option>
                        ))}
                    </select>
                </div>

                {!selectedCompId && (
                    <div className="sched-empty">
                        <i className="material-icons-round">calendar_month</i>
                        <h3>Yarışma Seçin</h3>
                        <p>Program oluşturmak için yukarıdan bir yarışma seçin</p>
                    </div>
                )}

                {selectedCompId && selectedComp && (
                    <>
                        {/* Yarışma bilgi bandı */}
                        <div className="sched-comp-info">
                            <div className="sched-comp-info__detail">
                                <i className="material-icons-round">location_on</i>
                                <span>{selectedComp.il || '—'}</span>
                            </div>
                            <div className="sched-comp-info__detail">
                                <i className="material-icons-round">date_range</i>
                                <span>{selectedComp.baslangicTarihi} → {selectedComp.bitisTarihi || selectedComp.baslangicTarihi}</span>
                            </div>
                            <div className="sched-comp-info__detail">
                                <i className="material-icons-round">category</i>
                                <span>{compCatKeys.length} kategori</span>
                            </div>
                            <div className="sched-comp-info__detail">
                                <i className="material-icons-round">groups</i>
                                <span>{Object.values(athleteCounts).reduce((a, b) => a + b, 0)} sporcu</span>
                            </div>
                        </div>

                        {/* Otomatik Program Oluştur Butonu */}
                        {canCreate && (
                            <div className="sched-auto-generate">
                                <button className="sched-auto-btn" onClick={handleAutoGenerate} disabled={generating}>
                                    <i className="material-icons-round">{generating ? 'hourglass_top' : 'auto_fix_high'}</i>
                                    <div>
                                        <strong>{generating ? 'Program Oluşturuluyor...' : 'Otomatik Program Oluştur'}</strong>
                                        <small>{generating ? 'Lütfen bekleyin' : 'Sporcu sayılarına göre oturumları otomatik planla'}</small>
                                    </div>
                                </button>
                            </div>
                        )}

                        {/* Gün bazlı takvim */}
                        {dateRange.map(dateStr => (
                            <div key={dateStr} className="sched-day">
                                <div className="sched-day__header">
                                    <div className="sched-day__date">
                                        <span className="sched-day__num">{new Date(dateStr).getDate()}</span>
                                        <div className="sched-day__meta">
                                            <strong>{formatDateTR(dateStr)}</strong>
                                            <span className="sched-day__count">
                                                {(sessionsByDate[dateStr] || []).length} oturum
                                            </span>
                                        </div>
                                    </div>
                                    {canCreate && (
                                        <button className="sched-add-btn" onClick={() => openAddModal(dateStr)}>
                                            <i className="material-icons-round">add</i>
                                            Oturum Ekle
                                        </button>
                                    )}
                                </div>

                                {(sessionsByDate[dateStr] || []).length === 0 ? (
                                    <div className="sched-day__empty">
                                        <i className="material-icons-round">event_busy</i>
                                        Bu gün için henüz oturum eklenmemiş
                                    </div>
                                ) : (
                                    <div className="sched-day__timeline">
                                        {(sessionsByDate[dateStr] || []).map(sess => (
                                            <div
                                                key={sess.id}
                                                className={`sched-session sched-session--${sess.durum || 'bekliyor'}`}
                                            >
                                                <div className="sched-session__time">
                                                    <span className="sched-session__start">{sess.saat}</span>
                                                    <span className="sched-session__sep">—</span>
                                                    <span className="sched-session__end">{sess.bitisSaat}</span>
                                                </div>
                                                <div className="sched-session__line" />
                                                <div className="sched-session__body">
                                                    <div className="sched-session__top">
                                                        <span className="sched-session__cat">{getCategoryLabel(sess.kategori)}</span>
                                                        {sess.alet && (
                                                            <span className="sched-session__alet">{getAletLabel(sess.alet)}</span>
                                                        )}
                                                        <span
                                                            className="sched-session__status"
                                                            style={{ background: SESSION_COLORS[sess.durum || 'bekliyor'] }}
                                                        >
                                                            {SESSION_LABELS[sess.durum || 'bekliyor']}
                                                        </span>
                                                    </div>
                                                    {sess.aciklama && (
                                                        <p className="sched-session__desc">{sess.aciklama}</p>
                                                    )}
                                                    {(canEdit || canDelete) && (
                                                        <div className="sched-session__actions">
                                                            {/* Durum toggle */}
                                                            {canEdit && sess.durum !== 'tamamlandi' && (
                                                                <button
                                                                    className="sched-action sched-action--start"
                                                                    onClick={() => handleStatusChange(sess.id, sess.durum === 'devam' ? 'tamamlandi' : 'devam')}
                                                                    title={sess.durum === 'devam' ? 'Tamamla' : 'Başlat'}
                                                                >
                                                                    <i className="material-icons-round">
                                                                        {sess.durum === 'devam' ? 'check_circle' : 'play_arrow'}
                                                                    </i>
                                                                </button>
                                                            )}
                                                            {canEdit && sess.durum === 'tamamlandi' && (
                                                                <button
                                                                    className="sched-action sched-action--undo"
                                                                    onClick={() => handleStatusChange(sess.id, 'bekliyor')}
                                                                    title="Geri Al"
                                                                >
                                                                    <i className="material-icons-round">undo</i>
                                                                </button>
                                                            )}
                                                            {canEdit && (
                                                                <button
                                                                    className="sched-action sched-action--edit"
                                                                    onClick={() => openEditModal(sess)}
                                                                    title="Düzenle"
                                                                >
                                                                    <i className="material-icons-round">edit</i>
                                                                </button>
                                                            )}
                                                            {canDelete && (
                                                                <button
                                                                    className="sched-action sched-action--delete"
                                                                    onClick={() => handleDelete(sess.id)}
                                                                    title="Sil"
                                                                >
                                                                    <i className="material-icons-round">delete</i>
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </>
                )}
            </main>

            {/* ═══ ADD/EDIT MODAL ═══ */}
            {isModalOpen && (
                <div className="sched-overlay" onClick={closeModal}>
                    <div className="sched-modal" onClick={e => e.stopPropagation()}>
                        <div className="sched-modal__header">
                            <h2>{editingSession ? 'Oturumu Düzenle' : 'Yeni Oturum'}</h2>
                            <button className="sched-modal__close" onClick={closeModal}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>

                        <div className="sched-modal__body">
                            {/* Tarih */}
                            <div className="sched-field">
                                <label>Tarih</label>
                                <select
                                    value={formData.tarih}
                                    onChange={e => setFormData(p => ({ ...p, tarih: e.target.value }))}
                                >
                                    {dateRange.map(d => (
                                        <option key={d} value={d}>{formatDateTR(d)}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Saat Aralığı */}
                            <div className="sched-field-row">
                                <div className="sched-field">
                                    <label>Başlangıç</label>
                                    <input
                                        type="time"
                                        value={formData.saat}
                                        onChange={e => setFormData(p => ({ ...p, saat: e.target.value }))}
                                    />
                                </div>
                                <div className="sched-field">
                                    <label>Bitiş</label>
                                    <input
                                        type="time"
                                        value={formData.bitisSaat}
                                        onChange={e => setFormData(p => ({ ...p, bitisSaat: e.target.value }))}
                                    />
                                </div>
                            </div>

                            {/* Kategori */}
                            <div className="sched-field">
                                <label>Kategori</label>
                                <select
                                    value={formData.kategori}
                                    onChange={e => setFormData(p => ({ ...p, kategori: e.target.value, alet: '' }))}
                                >
                                    <option value="">Seçin</option>
                                    {compCatKeys.map(catKey => (
                                        <option key={catKey} value={catKey}>{getCategoryLabel(catKey)}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Alet */}
                            {formData.kategori && (
                                <div className="sched-field">
                                    <label>Alet (Opsiyonel)</label>
                                    <select
                                        value={formData.alet}
                                        onChange={e => setFormData(p => ({ ...p, alet: e.target.value }))}
                                    >
                                        <option value="">Tümü / Belirtilmemiş</option>
                                        {getAletlerForCat(formData.kategori).map(a => (
                                            <option key={a} value={a}>{getAletLabel(a)}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Açıklama */}
                            <div className="sched-field">
                                <label>Açıklama (Opsiyonel)</label>
                                <input
                                    type="text"
                                    value={formData.aciklama}
                                    onChange={e => setFormData(p => ({ ...p, aciklama: e.target.value }))}
                                    placeholder="Ör: Genç Erkek yer serileri"
                                />
                            </div>

                            {/* Durum */}
                            <div className="sched-field">
                                <label>Durum</label>
                                <div className="sched-status-pills">
                                    {Object.entries(SESSION_LABELS).map(([key, label]) => (
                                        <button
                                            key={key}
                                            className={`sched-pill ${formData.durum === key ? 'sched-pill--active' : ''}`}
                                            style={formData.durum === key ? { background: SESSION_COLORS[key], color: '#fff' } : {}}
                                            onClick={() => setFormData(p => ({ ...p, durum: key }))}
                                            type="button"
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="sched-modal__footer">
                            <button className="sched-modal__btn sched-modal__btn--cancel" onClick={closeModal}>
                                İptal
                            </button>
                            <button className="sched-modal__btn sched-modal__btn--save" onClick={handleSave}>
                                <i className="material-icons-round">{editingSession ? 'save' : 'add'}</i>
                                {editingSession ? 'Güncelle' : 'Ekle'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
