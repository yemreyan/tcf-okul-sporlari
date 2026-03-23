import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import './AerobikHomePage.css';

const MENU_ITEMS = [
    { id: 'competitions', icon: 'emoji_events', label: 'Yarışmalar', desc: 'Yarışma oluştur ve yönet', color: '#10B981', path: '/aerobik/competitions', permKey: 'competitions' },
    { id: 'applications', icon: 'assignment_turned_in', label: 'Başvurular', desc: 'Başvuruları incele ve onayla', color: '#2563EB', path: '/aerobik/applications', permKey: 'applications' },
    { id: 'athletes', icon: 'groups', label: 'Sporcular', desc: 'Sporcu kayıt ve yönetimi', color: '#16A34A', path: '/aerobik/athletes', permKey: 'athletes' },
    { id: 'scoring', icon: 'scoreboard', label: 'Puanlama', desc: 'Canlı puan girişi', color: '#EA580C', path: '/aerobik/scoring', permKey: 'scoring' },
    { id: 'criteria', icon: 'tune', label: 'Kriterler', desc: 'Puanlama kuralları', color: '#7C3AED', path: '/aerobik/criteria', permKey: 'criteria' },
    { id: 'judges', icon: 'gavel', label: 'Hakem Listesi', desc: 'Hakem ekleme ve excel yükleme', color: '#0D9488', path: '/aerobik/referees', permKey: 'referees' },
    { id: 'scoreboard', icon: 'live_tv', label: 'Canlı Skor', desc: 'Canlı skorboard ekranı', color: '#DB2777', path: '/aerobik/scoreboard', permKey: 'scoreboard' },
    { id: 'finals', icon: 'military_tech', label: 'Finaller', desc: 'Final sonuçları', color: '#D97706', path: '/aerobik/finals', permKey: 'finals' },
    { id: 'analytics', icon: 'analytics', label: 'Raporlar', desc: 'İstatistik ve analiz', color: '#4F46E5', path: '/aerobik/analytics', permKey: 'analytics' },
    { id: 'order', icon: 'format_list_numbered', label: 'Çıkış Sırası', desc: 'Sporcu sıralama ve rotasyon', color: '#0891B2', path: '/aerobik/start-order', permKey: 'start_order' },
    { id: 'schedule', icon: 'calendar_month', label: 'Program', desc: 'Yarışma gün programı', color: '#8B5CF6', path: '/aerobik/schedule', permKey: 'schedule' },
    { id: 'links', icon: 'qr_code_2', label: 'QR & Linkler', desc: 'Link ve QR oluştur', color: '#059669', path: '/aerobik/links', permKey: 'links' },
    { id: 'report', icon: 'description', label: 'Yarışma Raporu', desc: 'Resmi müsabaka raporu oluştur', color: '#475569', path: '/aerobik/official-report', permKey: 'official_report' },
    { id: 'announcements', icon: 'campaign', label: 'Duyurular', desc: 'Yarışma duyuruları yönetimi', color: '#4F46E5', path: '/aerobik/announcements', permKey: 'announcements' },
    { id: 'certificates', icon: 'card_membership', label: 'Sertifikalar', desc: 'Katılım ve derece belgeleri', color: '#D97706', path: '/aerobik/certificates', permKey: 'certificates' },
];

// Yarışma durumu hesapla
function computeCompStatus(comp) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const start = comp.baslangicTarihi ? new Date(comp.baslangicTarihi.split('.').reverse().join('-') || comp.baslangicTarihi) : null;
    const end = comp.bitisTarihi ? new Date(comp.bitisTarihi.split('.').reverse().join('-') || comp.bitisTarihi) : start;
    if (!start || isNaN(start.getTime())) return 'unknown';
    const s = new Date(start); s.setHours(0, 0, 0, 0);
    const e = end && !isNaN(end.getTime()) ? new Date(end) : new Date(s);
    e.setHours(23, 59, 59, 999);
    if (now < s) return 'upcoming';
    if (now <= e) return 'active';
    return 'completed';
}

export default function AerobikHomePage() {
    const navigate = useNavigate();
    const { login, isAuthenticated, logout, currentUser, isSuperAdmin, hasPermission } = useAuth();

    const [showLoginModal, setShowLoginModal] = useState(false);
    const [loginTarget, setLoginTarget] = useState(null);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loginLoading, setLoginLoading] = useState(false);

    // Dashboard data
    const [rawComps, setRawComps] = useState({});
    const [rawApps, setRawApps] = useState({});
    const [refCount, setRefCount] = useState(0);
    const [athCount, setAthCount] = useState(0);
    const [dashLoaded, setDashLoaded] = useState(false);

    // Dashboard Firebase listeners
    useEffect(() => {
        if (!isAuthenticated) { setDashLoaded(false); return; }

        const unsubs = [];

        unsubs.push(onValue(ref(db, 'aerobik_yarismalar'), s => setRawComps(s.val() || {})));
        unsubs.push(onValue(ref(db, 'applications'), s => setRawApps(s.val() || {})));
        unsubs.push(onValue(ref(db, 'referees'), s => {
            const d = s.val();
            setRefCount(d ? Object.keys(d).length : 0);
        }));
        unsubs.push(onValue(ref(db, 'globalSporcular'), s => {
            const d = s.val();
            setAthCount(d ? Object.keys(d).length : 0);
            setDashLoaded(true);
        }));

        return () => unsubs.forEach(u => u());
    }, [isAuthenticated]);

    // Dashboard istatistikleri hesapla
    const stats = useMemo(() => {
        const comps = filterCompetitionsByUser(rawComps, currentUser);
        let activeCount = 0, upcomingCount = 0, completedCount = 0;
        let nextComp = null;
        let nextDate = null;
        let totalScoreEntries = 0;

        Object.entries(comps).forEach(([, comp]) => {
            const status = computeCompStatus(comp);
            if (status === 'active') activeCount++;
            else if (status === 'upcoming') {
                upcomingCount++;
                const d = comp.baslangicTarihi ? new Date(comp.baslangicTarihi.split('.').reverse().join('-') || comp.baslangicTarihi) : null;
                if (d && !isNaN(d.getTime()) && (!nextDate || d < nextDate)) {
                    nextDate = d;
                    nextComp = comp;
                }
            } else if (status === 'completed') completedCount++;

            // Toplam puan girişi
            if (comp.puanlar) {
                Object.values(comp.puanlar).forEach(cat => {
                    if (cat && typeof cat === 'object') {
                        Object.values(cat).forEach(app => {
                            if (app && typeof app === 'object') {
                                totalScoreEntries += Object.keys(app).length;
                            }
                        });
                    }
                });
            }
        });

        // Bekleyen başvuru sayısı
        let pendingApps = 0;
        Object.values(rawApps).forEach(app => {
            if ((app.durum === 'bekliyor' || app.status === 'bekliyor')) pendingApps++;
        });

        return {
            activeCount, upcomingCount, completedCount,
            totalComps: Object.keys(comps).length,
            pendingApps, nextComp, nextDate, totalScoreEntries
        };
    }, [rawComps, rawApps, currentUser]);

    // Menüyü izinlere göre filtrele
    const visibleMenuItems = isAuthenticated
        ? MENU_ITEMS.filter(item => hasPermission(item.permKey))
        : MENU_ITEMS;

    const handleMenuClick = (item) => {
        if (isAuthenticated) {
            navigate(item.path);
        } else {
            setLoginTarget(item);
            setShowLoginModal(true);
            setUsername('');
            setPassword('');
            setError('');
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoginLoading(true);
        setError('');

        try {
            const loggedInUser = await login(username, password);
            if (loggedInUser && loggedInUser.error) {
                setError(loggedInUser.error);
            } else if (loggedInUser) {
                setShowLoginModal(false);
                setUsername('');
                setPassword('');
                setError('');
                if (loginTarget) {
                    const isSA = loggedInUser.rolAdi === 'Super Admin' || loggedInUser.kullaniciAdi === 'admin';
                    const userPerms = loggedInUser.izinler?.[loginTarget.permKey];
                    if (isSA || userPerms?.goruntule) {
                        navigate(loginTarget.path);
                    }
                }
            } else {
                setError('Hatalı kullanıcı adı veya şifre!');
            }
        } catch {
            setError('Giriş sırasında bir hata oluştu.');
        } finally {
            setLoginLoading(false);
        }
    };

    const closeModal = () => {
        setShowLoginModal(false);
        setLoginTarget(null);
        setUsername('');
        setPassword('');
        setError('');
    };

    const getUserDisplayName = () => {
        if (!currentUser) return 'Misafir';
        if (isSuperAdmin()) return 'Süper Admin';
        return currentUser.kullaniciAdi || 'Kullanıcı';
    };

    const getUserInitial = () => {
        if (!currentUser) return '?';
        if (isSuperAdmin()) return 'A';
        return (currentUser.kullaniciAdi || '?')[0].toUpperCase();
    };

    // Yaklaşan yarışma gün farkı
    const daysUntilNext = stats.nextDate ? Math.ceil((stats.nextDate - new Date()) / (1000 * 60 * 60 * 24)) : null;

    return (
        <div className="aerobik-home-dashboard">
            {/* Header */}
            <header className="aerobik-home-header">
                <div className="aerobik-home-header__left">
                    <button className="aerobik-home-header__back" onClick={() => navigate('/')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div className="aerobik-home-header__logo">
                        <i className="material-icons-round">sports_gymnastics</i>
                    </div>
                    <div>
                        <h1 className="aerobik-home-header__title">Aerobik Cimnastik</h1>
                        <p className="aerobik-home-header__subtitle">Okul Sporları Yönetim Paneli</p>
                    </div>
                </div>
                <div className="aerobik-home-header__right">
                    {isAuthenticated ? (
                        <div className="aerobik-home-header__user-info">
                            {currentUser?.rolAdi && (
                                <span className="aerobik-home-header__role-badge">{currentUser.rolAdi}</span>
                            )}
                            {currentUser?.il && (
                                <span className="aerobik-home-header__il-badge">
                                    <i className="material-icons-round" style={{ fontSize: 13 }}>location_on</i>
                                    {currentUser.il}
                                </span>
                            )}
                            <button className="aerobik-home-header__user" onClick={logout} title="Çıkış Yap">
                                <div className="aerobik-home-header__avatar" style={{ background: isSuperAdmin() ? '#10B981' : '#059669' }}>
                                    {getUserInitial()}
                                </div>
                                <span className="aerobik-home-header__username">{getUserDisplayName()}</span>
                                <i className="material-icons-round" style={{ fontSize: 16, marginLeft: 4 }}>logout</i>
                            </button>
                        </div>
                    ) : (
                        <button className="aerobik-home-header__login-btn" onClick={() => { setShowLoginModal(true); setLoginTarget(null); }}>
                            <i className="material-icons-round" style={{ fontSize: 18 }}>login</i>
                            Giriş Yap
                        </button>
                    )}
                </div>
            </header>

            {/* Main Grid */}
            <main className="aerobik-home-main">

                {/* DASHBOARD STATS */}
                {isAuthenticated && dashLoaded && (
                    <section className="aerobik-home-dash-stats">
                        <div className="aerobik-home-dash-stats__grid">
                            <div className="aerobik-home-stat-card aerobik-home-stat-card--green" onClick={() => navigate('/aerobik/competitions')}>
                                <div className="aerobik-home-stat-card__icon"><i className="material-icons-round">play_circle</i></div>
                                <div className="aerobik-home-stat-card__body">
                                    <span className="aerobik-home-stat-card__value">{stats.activeCount}</span>
                                    <span className="aerobik-home-stat-card__label">Aktif Yarışma</span>
                                </div>
                                {stats.activeCount > 0 && <span className="aerobik-home-stat-card__pulse" />}
                            </div>

                            <div className="aerobik-home-stat-card aerobik-home-stat-card--blue" onClick={() => navigate('/aerobik/competitions')}>
                                <div className="aerobik-home-stat-card__icon"><i className="material-icons-round">event</i></div>
                                <div className="aerobik-home-stat-card__body">
                                    <span className="aerobik-home-stat-card__value">{stats.upcomingCount}</span>
                                    <span className="aerobik-home-stat-card__label">Yaklaşan</span>
                                </div>
                                {stats.nextComp && daysUntilNext !== null && (
                                    <span className="aerobik-home-stat-card__sub">{daysUntilNext <= 0 ? 'Bugün!' : `${daysUntilNext} gün`}</span>
                                )}
                            </div>

                            <div className="aerobik-home-stat-card aerobik-home-stat-card--emerald" onClick={() => navigate('/aerobik/athletes')}>
                                <div className="aerobik-home-stat-card__icon"><i className="material-icons-round">groups</i></div>
                                <div className="aerobik-home-stat-card__body">
                                    <span className="aerobik-home-stat-card__value">{athCount.toLocaleString('tr-TR')}</span>
                                    <span className="aerobik-home-stat-card__label">Toplam Sporcu</span>
                                </div>
                            </div>

                            <div className="aerobik-home-stat-card aerobik-home-stat-card--orange" onClick={() => hasPermission('applications') && navigate('/aerobik/applications')}>
                                <div className="aerobik-home-stat-card__icon"><i className="material-icons-round">pending_actions</i></div>
                                <div className="aerobik-home-stat-card__body">
                                    <span className="aerobik-home-stat-card__value">{stats.pendingApps}</span>
                                    <span className="aerobik-home-stat-card__label">Bekleyen Başvuru</span>
                                </div>
                                {stats.pendingApps > 0 && <span className="aerobik-home-stat-card__badge">{stats.pendingApps}</span>}
                            </div>

                            <div className="aerobik-home-stat-card aerobik-home-stat-card--teal" onClick={() => hasPermission('referees') && navigate('/aerobik/referees')}>
                                <div className="aerobik-home-stat-card__icon"><i className="material-icons-round">gavel</i></div>
                                <div className="aerobik-home-stat-card__body">
                                    <span className="aerobik-home-stat-card__value">{refCount}</span>
                                    <span className="aerobik-home-stat-card__label">Hakem</span>
                                </div>
                            </div>

                            <div className="aerobik-home-stat-card aerobik-home-stat-card--purple">
                                <div className="aerobik-home-stat-card__icon"><i className="material-icons-round">fact_check</i></div>
                                <div className="aerobik-home-stat-card__body">
                                    <span className="aerobik-home-stat-card__value">{stats.totalScoreEntries.toLocaleString('tr-TR')}</span>
                                    <span className="aerobik-home-stat-card__label">Puan Girişi</span>
                                </div>
                            </div>
                        </div>

                        {/* Yaklaşan yarışma banner */}
                        {stats.nextComp && (
                            <div className="aerobik-home-dash-next-comp" onClick={() => navigate('/aerobik/competitions')}>
                                <i className="material-icons-round">notifications_active</i>
                                <div className="aerobik-home-dash-next-comp__info">
                                    <span className="aerobik-home-dash-next-comp__title">Sıradaki Yarışma</span>
                                    <strong>{stats.nextComp.isim}</strong>
                                </div>
                                <div className="aerobik-home-dash-next-comp__date">
                                    <i className="material-icons-round" style={{ fontSize: 16 }}>calendar_today</i>
                                    {stats.nextComp.baslangicTarihi}
                                    {daysUntilNext !== null && (
                                        <span className="aerobik-home-dash-next-comp__days">
                                            {daysUntilNext <= 0 ? 'BUGÜN' : `${daysUntilNext} gün kaldı`}
                                        </span>
                                    )}
                                </div>
                                <i className="material-icons-round" style={{ opacity: 0.4 }}>chevron_right</i>
                            </div>
                        )}
                    </section>
                )}

                <div className="aerobik-home-menu-grid">
                    {visibleMenuItems.map((item, i) => (
                        <button
                            key={item.id}
                            className="aerobik-home-menu-card"
                            onClick={() => handleMenuClick(item)}
                            style={{ '--card-color': item.color, animationDelay: `${i * 0.04}s` }}
                        >
                            <div className="aerobik-home-menu-card__icon">
                                <i className="material-icons-round">{item.icon}</i>
                            </div>
                            <div className="aerobik-home-menu-card__text">
                                <span className="aerobik-home-menu-card__label">{item.label}</span>
                                <span className="aerobik-home-menu-card__desc">{item.desc}</span>
                            </div>
                            {!isAuthenticated && <i className="material-icons-round aerobik-home-menu-card__lock">lock</i>}
                        </button>
                    ))}

                    {/* Rol Yönetimi — Sadece Super Admin */}
                    {isAuthenticated && isSuperAdmin() && (
                        <button
                            className="aerobik-home-menu-card"
                            onClick={() => navigate('/aerobik/role-management')}
                            style={{ '--card-color': '#6B7280', animationDelay: `${visibleMenuItems.length * 0.04}s` }}
                        >
                            <div className="aerobik-home-menu-card__icon">
                                <i className="material-icons-round">admin_panel_settings</i>
                            </div>
                            <div className="aerobik-home-menu-card__text">
                                <span className="aerobik-home-menu-card__label">Rol Yönetimi</span>
                                <span className="aerobik-home-menu-card__desc">Kullanıcı ve yetki yönetimi</span>
                            </div>
                        </button>
                    )}

                    {/* İşlem Geçmişi — Sadece Super Admin */}
                    {isAuthenticated && isSuperAdmin() && (
                        <button
                            className="aerobik-home-menu-card"
                            onClick={() => navigate('/aerobik/audit-log')}
                            style={{ '--card-color': '#475569', animationDelay: `${(visibleMenuItems.length + 1) * 0.04}s` }}
                        >
                            <div className="aerobik-home-menu-card__icon">
                                <i className="material-icons-round">history</i>
                            </div>
                            <div className="aerobik-home-menu-card__text">
                                <span className="aerobik-home-menu-card__label">İşlem Geçmişi</span>
                                <span className="aerobik-home-menu-card__desc">Sistem aktivite günlüğü</span>
                            </div>
                        </button>
                    )}

                    {/* Başvuru Formu — Sadece Super Admin */}
                    {isAuthenticated && isSuperAdmin() && (
                        <button
                            className="aerobik-home-menu-card"
                            onClick={() => window.open('/basvuru.html', '_blank')}
                            style={{ '--card-color': '#10B981', animationDelay: `${(visibleMenuItems.length + 1) * 0.04}s` }}
                        >
                            <div className="aerobik-home-menu-card__icon">
                                <i className="material-icons-round">assignment</i>
                            </div>
                            <div className="aerobik-home-menu-card__text">
                                <span className="aerobik-home-menu-card__label">Başvuru Formu</span>
                                <span className="aerobik-home-menu-card__desc">Halka açık yarışma başvuru sayfası</span>
                            </div>
                            <i className="material-icons-round" style={{ fontSize: '1rem', opacity: 0.4 }}>open_in_new</i>
                        </button>
                    )}
                </div>
            </main>

            {/* Footer */}
            <footer className="aerobik-home-dash-footer">
                <p>&copy; 2026 Türkiye Cimnastik Federasyonu — Okul Sporları Yönetim Sistemi</p>
            </footer>

            {/* Login Modal */}
            {showLoginModal && !isAuthenticated && (
                <div className="aerobik-home-modal-overlay" onClick={closeModal}>
                    <div className="aerobik-home-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="aerobik-home-modal__icon" style={{ background: loginTarget?.color || '#6B7280' }}>
                            <i className="material-icons-round">{loginTarget?.icon || 'login'}</i>
                        </div>
                        <h2 className="aerobik-home-modal__title">{loginTarget?.label || 'Giriş Yap'}</h2>
                        <p className="aerobik-home-modal__desc">Kullanıcı adınız ve şifrenizle giriş yapın</p>

                        <form onSubmit={handleLogin} className="aerobik-home-modal__form">
                            <div className="aerobik-home-modal__input-wrap" style={{ borderColor: error ? '#DC2626' : '' }}>
                                <i className="material-icons-round" style={{ color: error ? '#DC2626' : '' }}>person</i>
                                <input
                                    type="text"
                                    className="aerobik-home-modal__input"
                                    placeholder="Kullanıcı adı"
                                    value={username}
                                    onChange={(e) => { setUsername(e.target.value); setError(''); }}
                                    autoFocus
                                    autoComplete="username"
                                />
                            </div>
                            <div className="aerobik-home-modal__input-wrap" style={{ borderColor: error ? '#DC2626' : '' }}>
                                <i className="material-icons-round" style={{ color: error ? '#DC2626' : '' }}>vpn_key</i>
                                <input
                                    type="password"
                                    className="aerobik-home-modal__input"
                                    placeholder="Şifre"
                                    value={password}
                                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                                    autoComplete="current-password"
                                />
                            </div>
                            {error && <p className="aerobik-home-modal__error"><i className="material-icons-round" style={{ fontSize: 16 }}>error</i> {error}</p>}
                            <div className="aerobik-home-modal__buttons">
                                <button type="button" className="aerobik-home-modal__btn aerobik-home-modal__btn--cancel" onClick={closeModal}>
                                    İptal
                                </button>
                                <button
                                    type="submit"
                                    className="aerobik-home-modal__btn aerobik-home-modal__btn--enter"
                                    style={{ background: loginTarget?.color || '#6B7280' }}
                                    disabled={loginLoading}
                                >
                                    {loginLoading ? (
                                        <span className="aerobik-home-login-spinner" />
                                    ) : (
                                        <i className="material-icons-round">login</i>
                                    )}
                                    {loginLoading ? 'Giriş yapılıyor...' : 'Giriş'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
