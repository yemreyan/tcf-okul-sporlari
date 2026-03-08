import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, update, get, push } from 'firebase/database';
import { db } from '../lib/firebase';
import './ApplicationsPage.css';

// Yardımcı fonksiyon - datayı array'e çevirir
function getAthletesArray(app) {
    if (!app || !app.athletes) return [];
    if (Array.isArray(app.athletes)) return app.athletes;
    return Object.values(app.athletes);
}

// Turkish Character Normalization (Legacy Matching)
function normalizeString(str) {
    return (str || '')
        .toLocaleUpperCase('tr-TR')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/İ/g, 'I');
}

// Automatic Team Promotion Logic (Legacy Port)
async function checkAndPromoteToTeam(compId, catId, catName, schoolName) {
    if (!compId || !catId || !schoolName) return;

    const nameLower = (catName || "").toLocaleLowerCase('tr-TR');
    let threshold = 100;

    if (nameLower.includes('minik') || nameLower.includes('küçük') || nameLower.includes('kucuk')) {
        threshold = 4;
    } else if (nameLower.includes('yıldız') || nameLower.includes('yildiz') || nameLower.includes('genç') || nameLower.includes('genc')) {
        threshold = 2;
    } else {
        return;
    }

    try {
        const snapshot = await get(ref(db, `competitions/${compId}/sporcular/${catId}`));
        if (!snapshot.exists()) return;

        const allAthletes = snapshot.val();
        const schoolAthletes = Object.entries(allAthletes).filter(([key, a]) => {
            const s1 = normalizeString(a.okul || a.kulup);
            const s2 = normalizeString(schoolName);
            return s1 === s2;
        });

        if (schoolAthletes.length >= threshold) {
            const updates = {};
            let updateCount = 0;
            schoolAthletes.forEach(([id, ath]) => {
                if (ath.yarismaTuru !== 'takim') {
                    updates[`competitions/${compId}/sporcular/${catId}/${id}/yarismaTuru`] = 'takim';
                    updateCount++;
                }
            });

            if (updateCount > 0) {
                await update(ref(db), updates);
            }
        }
    } catch (err) {
        console.error("Team check error:", err);
    }
}

export default function ApplicationsPage() {
    const navigate = useNavigate();
    const [applications, setApplications] = useState([]);
    const [competitions, setCompetitions] = useState({});
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState('bekliyor'); // bekliyor, onaylandi, reddedildi, all
    const [filterComp, setFilterComp] = useState(''); // Yarışma filtresi

    // Detay gösterme state'i
    const [expandedAppId, setExpandedAppId] = useState(null);

    useEffect(() => {
        // 1. Yarışmaları yükle (isimleri göstermek ve filtrelemek için)
        const compsRef = ref(db, 'competitions');
        onValue(compsRef, (snap) => {
            setCompetitions(snap.val() || {});
        });

        // 2. Başvuruları yükle
        const appsRef = ref(db, 'applications');
        const unsubscribe = onValue(appsRef, (snapshot) => {
            const data = snapshot.val();
            const apps = [];

            if (data) {
                Object.keys(data).forEach(appId => {
                    const app = data[appId];
                    const athletes = getAthletesArray(app);

                    apps.push({
                        id: appId,
                        compId: app.competitionId || '',
                        compName: '', // Ayrı eklenecek
                        schoolName: app.schoolName || 'İsimsiz Okul',
                        city: app.city || 'Belirtilmemiş',
                        district: app.district || '',
                        categoryId: app.categoryId || '',
                        categoryName: app.categoryName || 'Kategori Yok',
                        type: app.type || 'ferdi',
                        status: app.status || 'bekliyor',
                        timestamp: app.timestamp || 0,
                        athletes: athletes,
                        athleteCount: athletes.length,
                        teacherName: app.teacherName || '',
                        teacherPhone: app.teacherPhone || '',
                        coaches: app.coaches || []
                    });
                });

                apps.sort((a, b) => b.timestamp - a.timestamp);
                setApplications(apps);
            } else {
                setApplications([]);
            }
            setLoading(false);
        }, (error) => {
            console.error("Firebase fetch error:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const handleStatusChange = async (app, newStatus) => {
        try {
            const updates = {};
            updates[`applications/${app.id}/status`] = newStatus;

            // Eğer ONAYLANIRSA, sporcuları ana yarışma listesine de kopyala (Eski sistemdeki gibi)
            if (newStatus === 'onaylandi') {
                const compId = app.compId;
                const catId = app.categoryId;

                // 1. Okulu onaylı okullar listesine ekle
                const safeSchoolName = app.schoolName.replace(/[.#$[\]]/g, '');
                updates[`competitions/${compId}/onayli_okullar/${safeSchoolName}`] = {
                    city: app.city,
                    district: app.district
                };

                // 2. Sporcuları ilgili kategori altına ekle
                app.athletes.forEach(ath => {
                    const newAthKey = push(ref(db, `competitions/${compId}/sporcular/${catId}`)).key;

                    // Ad Soyad Ayırma (Legacy matching)
                    let ad = "";
                    let soyad = "";
                    if (ath.adSoyad) {
                        const parts = ath.adSoyad.trim().split(' ');
                        if (parts.length > 1) {
                            soyad = parts.pop();
                            ad = parts.join(' ');
                        } else {
                            ad = parts[0] || "";
                        }
                    }

                    // LEGACY COMPATIBILITY: We MUST add fields like adSoyad, soyadAd, dogumTarihi, etc.
                    // Otherwise they don't appear in the legacy scoring/result screens.
                    updates[`competitions/${compId}/sporcular/${catId}/${newAthKey}`] = {
                        id: newAthKey, // Inside ID used by some legacy scripts
                        adSoyad: ath.adSoyad || `${ad} ${soyad}`.trim(),
                        soyadAd: `${soyad} ${ad}`.trim(), // Consumer sorting uses this
                        ad: ad,
                        soyad: soyad,
                        dogumTarihi: ath.dob || "2010-01-01", // Legacy key
                        dob: ath.dob || "2010-01-01", // New key (redundant but safe)
                        lisansNo: ath.lisans || "-", // Legacy key
                        lisans: ath.lisans || "-", // New key
                        okul: app.schoolName,
                        kulup: app.schoolName, // Legacy fallback
                        il: app.city,
                        ilce: app.district || "",
                        sirasi: 999,
                        yarismaTuru: app.type === 'takim' ? 'takim' : 'ferdi', // Lowercase important
                        tckn: ath.tckn || "-",
                        appId: app.id
                    };
                });

                await update(ref(db), updates);

                // 3. Otomatik Takım Kontrolü (Legacy logic)
                await checkAndPromoteToTeam(compId, catId, app.categoryName, app.schoolName);
            } else {
                // Eğer GERİ ALINIRSA (Red veya tekrar Bekliyor), sporcuları yarışmadan çıkart
                if ((newStatus === 'bekliyor' || newStatus === 'reddedildi') && app.status === 'onaylandi') {
                    const snap = await get(ref(db, `competitions/${app.compId}/sporcular/${app.categoryId}`));
                    if (snap.exists()) {
                        Object.entries(snap.val()).forEach(([athKey, athData]) => {
                            if (athData.appId === app.id) {
                                updates[`competitions/${app.compId}/sporcular/${app.categoryId}/${athKey}`] = null;
                            }
                        });
                    }
                }
                await update(ref(db), updates);
            }

        } catch (err) {
            console.error("Status update failed", err);
            alert("Durum güncellenirken bir hata oluştu.");
        }
    };

    const filteredApps = applications.map(app => ({
        ...app,
        compName: competitions[app.compId]?.isim || 'Silinmiş Yarışma'
    })).filter(app => {
        if (filterComp && app.compId !== filterComp) return false;
        if (filterStatus === 'all') return true;
        return app.status === filterStatus;
    });

    const statusConfig = {
        bekliyor: { label: 'Bekliyor', color: 'var(--warning)', icon: 'schedule' },
        onaylandi: { label: 'Onaylandı', color: 'var(--success)', icon: 'check_circle' },
        reddedildi: { label: 'Reddedildi', color: 'var(--red)', icon: 'cancel' },
    };

    const compOptions = Object.entries(competitions)
        .sort((a, b) => new Date(b[1].tarih) - new Date(a[1].tarih));

    return (
        <div className="applications-page">
            <header className="page-header">
                <div className="page-header__left">
                    <button className="back-btn" onClick={() => navigate('/')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div className="header-title-wrapper">
                        <h1 className="page-title">Başvurular</h1>
                        <p className="page-subtitle">Okul ve sporcu kayıt onayları {loading ? '' : `(${applications.length})`}</p>
                    </div>
                </div>
            </header>

            <main className="page-content">
                <div className="filters">
                    <select
                        className="filter-select"
                        value={filterComp}
                        onChange={(e) => setFilterComp(e.target.value)}
                    >
                        <option value="">-- Tüm Yarışmalar --</option>
                        {compOptions.map(([id, comp]) => (
                            <option key={id} value={id}>{comp.isim}</option>
                        ))}
                    </select>

                    <button
                        className={`filter-btn ${filterStatus === 'bekliyor' ? 'filter-btn--active' : ''}`}
                        onClick={() => setFilterStatus('bekliyor')}
                    >
                        <i className="material-icons-round" style={{ fontSize: 18, color: filterStatus === 'bekliyor' ? 'white' : 'var(--warning)' }}>schedule</i>
                        Onay Bekleyenler
                    </button>
                    <button
                        className={`filter-btn ${filterStatus === 'onaylandi' ? 'filter-btn--active' : ''}`}
                        onClick={() => setFilterStatus('onaylandi')}
                    >
                        <i className="material-icons-round" style={{ fontSize: 18, color: filterStatus === 'onaylandi' ? 'white' : 'var(--success)' }}>check_circle</i>
                        Onaylananlar
                    </button>
                    <button
                        className={`filter-btn ${filterStatus === 'reddedildi' ? 'filter-btn--active' : ''}`}
                        onClick={() => setFilterStatus('reddedildi')}
                    >
                        <i className="material-icons-round" style={{ fontSize: 18, color: filterStatus === 'reddedildi' ? 'white' : 'var(--red)' }}>cancel</i>
                        Reddedilenler
                    </button>
                    <button
                        className={`filter-btn ${filterStatus === 'all' ? 'filter-btn--active' : ''}`}
                        onClick={() => setFilterStatus('all')}
                    >
                        Tümü
                    </button>
                </div>

                {loading ? (
                    <div className="loading-state">
                        <div className="spinner"></div>
                        <p>Başvurular yükleniyor...</p>
                    </div>
                ) : (
                    <div className="apps-container">
                        {filteredApps.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-state__icon">
                                    <i className="material-icons-round">inbox</i>
                                </div>
                                <p>Bu kategoride başvuru bulunmuyor.</p>
                            </div>
                        ) : (
                            <div className="apps-list">
                                {filteredApps.map((app, index) => {
                                    const currentStatus = statusConfig[app.status] || statusConfig['bekliyor'];
                                    const isExpanded = expandedAppId === app.id;

                                    return (
                                        <div className="app-card-wrapper" key={app.id} style={{ animationDelay: `${(index % 10) * 0.04}s` }}>
                                            <div className="app-card" >
                                                <div className="app-card__left">
                                                    <button className="expand-btn" onClick={() => setExpandedAppId(isExpanded ? null : app.id)}>
                                                        <i className="material-icons-round">{isExpanded ? 'keyboard_arrow_down' : 'keyboard_arrow_right'}</i>
                                                    </button>
                                                    <div className="app-card__icon" style={{ background: `${currentStatus.color}15`, color: currentStatus.color }}>
                                                        <i className="material-icons-round">{currentStatus.icon}</i>
                                                    </div>
                                                    <div className="app-card__info">
                                                        <h3 className="app-card__school">{app.schoolName}</h3>
                                                        <p className="app-card__comp">{app.compName}</p>
                                                        <div className="app-card__meta">
                                                            <span className="meta-badge"><i className="material-icons-round">category</i> {app.categoryName} ({app.type === 'takim' ? 'TAKIM' : 'FERDİ'})</span>
                                                            <span className="meta-badge"><i className="material-icons-round">place</i> {app.city} {app.district ? `/ ${app.district}` : ''}</span>
                                                            <span className="meta-badge"><i className="material-icons-round">groups</i> {app.athleteCount} Sporcu</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="app-card__right">
                                                    {app.status === 'bekliyor' && (
                                                        <div className="app-card__actions">
                                                            <button
                                                                className="action-btn action-btn--approve"
                                                                onClick={() => handleStatusChange(app, 'onaylandi')}
                                                                title="Onayla"
                                                            >
                                                                <i className="material-icons-round">check</i>
                                                                <span>Onayla</span>
                                                            </button>
                                                            <button
                                                                className="action-btn action-btn--reject"
                                                                onClick={() => handleStatusChange(app, 'reddedildi')}
                                                                title="Reddet"
                                                            >
                                                                <i className="material-icons-round">close</i>
                                                                <span>Reddet</span>
                                                            </button>
                                                        </div>
                                                    )}

                                                    {app.status !== 'bekliyor' && (
                                                        <div className="app-card__status-display" style={{ color: currentStatus.color, background: `${currentStatus.color}15` }}>
                                                            {currentStatus.label}
                                                            <button
                                                                className="status-undo-btn"
                                                                onClick={() => handleStatusChange(app, 'bekliyor')}
                                                                title="Geri Al"
                                                            >
                                                                <i className="material-icons-round">undo</i>
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Genişletilmiş Detay Görünümü */}
                                            {isExpanded && (
                                                <div className="app-card__detail">
                                                    <div className="detail-section">
                                                        <div className="detail-info-block">
                                                            <strong>Sorumlu Öğretmen:</strong>
                                                            <span>{app.teacherName || '-'} ({app.teacherPhone || '-'})</span>
                                                        </div>

                                                        <div className="detail-info-block">
                                                            <strong>Antrenörler:</strong>
                                                            {app.coaches && app.coaches.length > 0 ? (
                                                                app.coaches.map((c, i) => (
                                                                    <span key={i}>{c.ad} ({c.tel})</span>
                                                                ))
                                                            ) : <span>-</span>}
                                                        </div>
                                                    </div>

                                                    <div className="detail-athletes">
                                                        <strong>Sporcu Listesi ({app.athleteCount})</strong>
                                                        <div className="athlete-grid">
                                                            {app.athletes.map((ath, idx) => (
                                                                <div className="athlete-card" key={idx}>
                                                                    <div className="ath-name">{ath.adSoyad}</div>
                                                                    <div className="ath-detail">TCKN: {ath.tckn}</div>
                                                                    <div className="ath-detail">Lisans: {ath.lisans}</div>
                                                                    <div className="ath-detail">D.Tarihi: {ath.dob}</div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
