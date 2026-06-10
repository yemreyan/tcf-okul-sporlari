import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, query, orderByChild, limitToLast } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import './AuditLogPage.css';

const LOG_TYPE_ICONS = {
    score_create: 'add_circle',
    score_update: 'edit',
    score_delete: 'remove_circle',
    athlete_create: 'person_add',
    athlete_update: 'person',
    athlete_delete: 'person_remove',
    competition_create: 'emoji_events',
    competition_update: 'settings',
    referee_create: 'gavel',
    application_approve: 'check_circle',
    application_reject: 'cancel',
    login: 'login',
    logout: 'logout',
    broadcast: 'campaign',
    schedule: 'calendar_month',
    default: 'history',
};

const LOG_TYPE_COLORS = {
    score_create: '#16A34A',
    score_update: '#2563EB',
    score_delete: '#DC2626',
    athlete_create: '#16A34A',
    athlete_update: '#2563EB',
    athlete_delete: '#DC2626',
    competition_create: '#7C3AED',
    competition_update: '#7C3AED',
    referee_create: '#0D9488',
    application_approve: '#16A34A',
    application_reject: '#DC2626',
    login: '#4F46E5',
    logout: '#6B7280',
    broadcast: '#4F46E5',
    schedule: '#8B5CF6',
    default: '#9CA3AF',
};

const LOG_TYPE_LABELS = {
    score_create: 'Puan Girişi',
    score_update: 'Puan Güncelleme',
    score_delete: 'Puan Silme',
    athlete_create: 'Sporcu Ekleme',
    athlete_update: 'Sporcu Güncelleme',
    athlete_delete: 'Sporcu Silme',
    competition_create: 'Yarışma Oluşturma',
    competition_update: 'Yarışma Güncelleme',
    referee_create: 'Hakem Ekleme',
    application_approve: 'Başvuru Onaylama',
    application_reject: 'Başvuru Reddetme',
    login: 'Giriş',
    logout: 'Çıkış',
    broadcast: 'Duyuru',
    schedule: 'Program',
};

function formatTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('tr-TR', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function formatDateGroup(ts) {
    if (!ts) return 'Tarih Bilinmiyor';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return 'Tarih Bilinmiyor';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dDate = new Date(d);
    dDate.setHours(0, 0, 0, 0);
    const diff = Math.floor((today - dDate) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Bugün';
    if (diff === 1) return 'Dün';
    if (diff < 7) return `${diff} gün önce`;
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function AuditLogPage() {
    const navigate = useNavigate();
    const { isSuperAdmin } = useAuth();
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refetching, setRefetching] = useState(false);  // sonraki yüklemelerde sayfa kaybolmasın
    const [filterType, setFilterType] = useState('all');
    const [filterUser, setFilterUser] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [limit, setLimit] = useState(500);
    const [dateFrom, setDateFrom] = useState(''); // YYYY-MM-DD
    const [dateTo, setDateTo] = useState('');
    const ALL_LIMIT = 100000; // pratik olarak tümü

    // Arama veya tarih filtresi aktifse otomatik olarak TÜM logları çek
    // (kullanıcı eski kayıtları arıyorsa 500 yetmez)
    const effectiveLimit = (searchTerm.trim() || dateFrom || dateTo) ? ALL_LIMIT : limit;

    useEffect(() => {
        // İlk yüklemede tam-ekran spinner, sonraki yüklemelerde inline rozet
        // (input focus'u kaybolmasın diye sayfa yapısı değişmemeli)
        setRefetching(true);
        const q = query(ref(db, 'logs'), orderByChild('timestamp'), limitToLast(effectiveLimit));
        const unsub = onValue(q, s => {
            const data = s.val() || {};
            const arr = Object.entries(data)
                .map(([id, log]) => ({ id, ...log }))
                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            setLogs(arr);
            setLoading(false);
            setRefetching(false);
        });
        return () => unsub();
    }, [effectiveLimit]);

    // Benzersiz kullanıcılar
    const uniqueUsers = useMemo(() => {
        const users = new Set();
        logs.forEach(l => { if (l.user) users.add(l.user); });
        return [...users].sort();
    }, [logs]);

    // Benzersiz tipler
    const uniqueTypes = useMemo(() => {
        const types = new Set();
        logs.forEach(l => { if (l.type) types.add(l.type); });
        return [...types].sort();
    }, [logs]);

    // Filtrele
    const filteredLogs = useMemo(() => {
        // Tarih aralığı: YYYY-MM-DD → timestamp ms
        const fromMs = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : null;
        const toMs   = dateTo   ? new Date(dateTo   + 'T23:59:59').getTime() : null;
        const s = searchTerm.trim().toLocaleLowerCase('tr-TR');
        return logs.filter(log => {
            if (filterType !== 'all' && log.type !== filterType) return false;
            if (filterUser !== 'all' && log.user !== filterUser) return false;
            if (fromMs && (log.timestamp || 0) < fromMs) return false;
            if (toMs   && (log.timestamp || 0) > toMs)   return false;
            if (s) {
                // Hepsinde case-insensitive substring ara: mesaj, kullanıcı,
                // sporcu adı, kategori, alet, yarışma ID, sonra ek data alanı
                const haystacks = [
                    log.message, log.mesaj, log.user, log.athleteName,
                    log.category, log.alet, log.competitionId, log.type,
                    log.data,
                ];
                const hit = haystacks.some(v => v && String(v).toLocaleLowerCase('tr-TR').includes(s));
                if (!hit) return false;
            }
            return true;
        });
    }, [logs, filterType, filterUser, searchTerm, dateFrom, dateTo]);

    // Tarihe göre grupla
    const groupedLogs = useMemo(() => {
        const groups = [];
        let currentGroup = null;

        filteredLogs.forEach(log => {
            const dateKey = log.timestamp ? new Date(log.timestamp).toDateString() : '__no_date__';
            if (!currentGroup || currentGroup.dateKey !== dateKey) {
                currentGroup = { dateKey, label: formatDateGroup(log.timestamp), logs: [] };
                groups.push(currentGroup);
            }
            currentGroup.logs.push(log);
        });

        return groups;
    }, [filteredLogs]);

    // İstatistikler
    const todayCount = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return logs.filter(l => l.timestamp && l.timestamp >= today.getTime()).length;
    }, [logs]);

    // İlk yüklemede henüz veri yok → tam-ekran spinner
    // Aksi takdirde sayfa görünür kalır, içerideki refetching durumu rozetle gösterilir
    if (loading && logs.length === 0) {
        return (
            <div className="audit-page">
                <div className="audit-loading">
                    <div className="audit-loading__spinner" />
                    <span>Yükleniyor...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="audit-page">
            {/* Header */}
            <header className="audit-header">
                <div className="audit-header__left">
                    <button className="audit-back" onClick={() => navigate('/artistik')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div>
                        <h1 className="audit-header__title">İşlem Geçmişi</h1>
                        <p className="audit-header__sub">Sistem aktivite günlüğü</p>
                    </div>
                </div>
                <div className="audit-header__stats">
                    <span className="audit-stat">
                        <i className="material-icons-round">today</i>
                        Bugün: {todayCount}
                    </span>
                    <span className="audit-stat">
                        <i className="material-icons-round">history</i>
                        Toplam: {filteredLogs.length}
                    </span>
                </div>
            </header>

            <main className="audit-main">
                {/* Filtreler */}
                <div className="audit-filters">
                    <div className="audit-search">
                        <i className="material-icons-round">search</i>
                        <input
                            type="text"
                            placeholder="Sporcu adı, mesaj, kullanıcı, kategori, alet..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                        {searchTerm && (
                            <button
                                className="audit-search-clear"
                                onClick={() => setSearchTerm('')}
                                title="Aramayı temizle"
                                style={{
                                    background: 'transparent', border: 'none', cursor: 'pointer',
                                    color: '#64748b', display: 'flex', alignItems: 'center', padding: 4
                                }}
                            >
                                <i className="material-icons-round" style={{ fontSize: 18 }}>close</i>
                            </button>
                        )}
                    </div>
                    <select
                        className="audit-filter-select"
                        value={filterType}
                        onChange={e => setFilterType(e.target.value)}
                    >
                        <option value="all">Tüm İşlemler</option>
                        {uniqueTypes.map(t => (
                            <option key={t} value={t}>{LOG_TYPE_LABELS[t] || t}</option>
                        ))}
                    </select>
                    <select
                        className="audit-filter-select"
                        value={filterUser}
                        onChange={e => setFilterUser(e.target.value)}
                    >
                        <option value="all">Tüm Kullanıcılar</option>
                        {uniqueUsers.map(u => (
                            <option key={u} value={u}>{u}</option>
                        ))}
                    </select>
                    <input
                        type="date"
                        className="audit-filter-select"
                        value={dateFrom}
                        onChange={e => setDateFrom(e.target.value)}
                        title="Başlangıç tarihi"
                        style={{ minWidth: 140 }}
                    />
                    <input
                        type="date"
                        className="audit-filter-select"
                        value={dateTo}
                        onChange={e => setDateTo(e.target.value)}
                        title="Bitiş tarihi"
                        style={{ minWidth: 140 }}
                    />
                    {(dateFrom || dateTo) && (
                        <button
                            onClick={() => { setDateFrom(''); setDateTo(''); }}
                            style={{
                                background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5',
                                borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                            }}
                            title="Tarih filtresini temizle"
                        >
                            Tarihi sıfırla
                        </button>
                    )}
                </div>
                {(searchTerm.trim() || dateFrom || dateTo) && (
                    <div style={{ fontSize: 12, color: '#0369a1', background: '#e0f2fe', border: '1px solid #7dd3fc', padding: '6px 12px', borderRadius: 6, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <i className="material-icons-round" style={{ fontSize: 14 }}>info</i>
                        <span>Arama/tarih filtresi aktif — TÜM loglar arasından arıyoruz ({logs.length.toLocaleString('tr-TR')} kayıt yüklü)</span>
                        {refetching && (
                            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, color: '#0c4a6e' }}>
                                <i className="material-icons-round" style={{ fontSize: 14, animation: 'spin 1s linear infinite' }}>refresh</i>
                                Yükleniyor...
                            </span>
                        )}
                    </div>
                )}

                {/* Log listesi */}
                {filteredLogs.length === 0 ? (
                    <div className="audit-empty">
                        <i className="material-icons-round">history</i>
                        <h3>İşlem Kaydı Yok</h3>
                        <p>Seçilen filtrelere uygun işlem bulunamadı</p>
                    </div>
                ) : (
                    <div className="audit-timeline">
                        {groupedLogs.map(group => (
                            <div key={group.dateKey} className="audit-group">
                                <div className="audit-group__header">
                                    <span>{group.label}</span>
                                    <span className="audit-group__count">{group.logs.length}</span>
                                </div>
                                {group.logs.map(log => {
                                    const icon = LOG_TYPE_ICONS[log.type] || LOG_TYPE_ICONS.default;
                                    const color = LOG_TYPE_COLORS[log.type] || LOG_TYPE_COLORS.default;
                                    return (
                                        <div key={log.id} className="audit-item">
                                            <div className="audit-item__dot" style={{ background: color }}>
                                                <i className="material-icons-round">{icon}</i>
                                            </div>
                                            <div className="audit-item__body">
                                                <div className="audit-item__top">
                                                    <span className="audit-item__type" style={{ color }}>
                                                        {LOG_TYPE_LABELS[log.type] || log.type || 'İşlem'}
                                                    </span>
                                                    <span className="audit-item__time">
                                                        {formatTimestamp(log.timestamp)}
                                                    </span>
                                                </div>
                                                <p className="audit-item__msg">{log.message}</p>
                                                {log.user && (
                                                    <span className="audit-item__user">
                                                        <i className="material-icons-round">person</i>
                                                        {log.user}
                                                    </span>
                                                )}
                                                {log.competitionId && (
                                                    <span className="audit-item__comp">
                                                        <i className="material-icons-round">emoji_events</i>
                                                        {log.competitionId}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ))}

                        {logs.length >= limit && limit < ALL_LIMIT && (
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 12 }}>
                                <button className="audit-load-more" onClick={() => setLimit(l => l + 500)}>
                                    <i className="material-icons-round">expand_more</i>
                                    +500 Daha
                                </button>
                                <button className="audit-load-more" onClick={() => setLimit(l => l + 2000)}>
                                    <i className="material-icons-round">expand_more</i>
                                    +2000 Daha
                                </button>
                                <button className="audit-load-more" style={{ background: '#dc2626', color: '#fff' }} onClick={() => setLimit(ALL_LIMIT)}>
                                    <i className="material-icons-round">all_inclusive</i>
                                    Tüm Logları Yükle
                                </button>
                            </div>
                        )}
                        {limit >= ALL_LIMIT && (
                            <div style={{ textAlign: 'center', marginTop: 12, color: '#64748b', fontSize: 12 }}>
                                Tüm loglar yüklendi ({logs.length.toLocaleString('tr-TR')} kayıt)
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
