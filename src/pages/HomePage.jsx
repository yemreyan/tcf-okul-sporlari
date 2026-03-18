import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import './HomePage.css';

const MENU_ITEMS = [
    { id: 'competitions', icon: 'emoji_events', label: 'Yarışmalar', desc: 'Yarışma oluştur ve yönet', color: '#E30613', path: '/competitions', permKey: 'competitions' },
    { id: 'applications', icon: 'assignment_turned_in', label: 'Başvurular', desc: 'Başvuruları incele ve onayla', color: '#2563EB', path: '/applications', permKey: 'applications' },
    { id: 'athletes', icon: 'groups', label: 'Sporcular', desc: 'Sporcu kayıt ve yönetimi', color: '#16A34A', path: '/athletes', permKey: 'athletes' },
    { id: 'scoring', icon: 'scoreboard', label: 'Puanlama', desc: 'Canlı puan girişi', color: '#EA580C', path: '/scoring', permKey: 'scoring' },
    { id: 'criteria', icon: 'tune', label: 'Kriterler', desc: 'Puanlama kuralları', color: '#7C3AED', path: '/criteria', permKey: 'criteria' },
    { id: 'judges', icon: 'gavel', label: 'Hakem Listesi', desc: 'Hakem ekleme ve excel yükleme', color: '#0D9488', path: '/referees', permKey: 'referees' },
    { id: 'scoreboard', icon: 'live_tv', label: 'Canlı Skor', desc: 'Canlı skorboard ekranı', color: '#DB2777', path: '/scoreboard', permKey: 'scoreboard' },
    { id: 'finals', icon: 'military_tech', label: 'Finaller', desc: 'Final sonuçları', color: '#D97706', path: '/finals', permKey: 'finals' },
    { id: 'analytics', icon: 'analytics', label: 'Raporlar', desc: 'İstatistik ve analiz', color: '#4F46E5', path: '/analytics', permKey: 'analytics' },
    { id: 'order', icon: 'format_list_numbered', label: 'Çıkış Sırası', desc: 'Sporcu sıralama ve rotasyon', color: '#0891B2', path: '/start-order', permKey: 'start_order' },
    { id: 'links', icon: 'qr_code_2', label: 'QR & Linkler', desc: 'Link ve QR oluştur', color: '#059669', path: '/links', permKey: 'links' },
    { id: 'report', icon: 'description', label: 'Yarışma Raporu', desc: 'Resmi müsabaka raporu oluştur', color: '#475569', path: '/official-report', permKey: 'official_report' },
];

export default function HomePage() {
    const navigate = useNavigate();
    const { login, isAuthenticated, logout, currentUser, isSuperAdmin, hasPermission } = useAuth();

    const [showLoginModal, setShowLoginModal] = useState(false);
    const [loginTarget, setLoginTarget] = useState(null); // hedef path (menu tıklandığında)
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loginLoading, setLoginLoading] = useState(false);

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
                // Rate limiting hatası
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

    // Kullanıcı bilgi metni
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

    return (
        <div className="dashboard">
            {/* Header */}
            <header className="header">
                <div className="header__left">
                    <div className="header__logo">
                        <i className="material-icons-round">sports_gymnastics</i>
                    </div>
                    <div>
                        <h1 className="header__title">TCF Okul Sporları</h1>
                        <p className="header__subtitle">Yönetim Paneli</p>
                    </div>
                </div>
                <div className="header__right">
                    {isAuthenticated ? (
                        <div className="header__user-info">
                            {currentUser?.rolAdi && (
                                <span className="header__role-badge">{currentUser.rolAdi}</span>
                            )}
                            {currentUser?.il && (
                                <span className="header__il-badge">
                                    <i className="material-icons-round" style={{ fontSize: 13 }}>location_on</i>
                                    {currentUser.il}
                                </span>
                            )}
                            <button className="header__user" onClick={logout} title="Çıkış Yap">
                                <div className="header__avatar" style={{ background: isSuperAdmin() ? 'var(--green)' : 'var(--blue)' }}>
                                    {getUserInitial()}
                                </div>
                                <span className="header__username">{getUserDisplayName()}</span>
                                <i className="material-icons-round" style={{ fontSize: 16, marginLeft: 4 }}>logout</i>
                            </button>
                        </div>
                    ) : (
                        <button className="header__login-btn" onClick={() => { setShowLoginModal(true); setLoginTarget(null); }}>
                            <i className="material-icons-round" style={{ fontSize: 18 }}>login</i>
                            Giriş Yap
                        </button>
                    )}
                </div>
            </header>

            {/* Main Grid */}
            <main className="main">
                <div className="menu-grid">
                    {visibleMenuItems.map((item, i) => (
                        <button
                            key={item.id}
                            className="menu-card"
                            onClick={() => handleMenuClick(item)}
                            style={{ '--card-color': item.color, animationDelay: `${i * 0.04}s` }}
                        >
                            <div className="menu-card__icon">
                                <i className="material-icons-round">{item.icon}</i>
                            </div>
                            <div className="menu-card__text">
                                <span className="menu-card__label">{item.label}</span>
                                <span className="menu-card__desc">{item.desc}</span>
                            </div>
                            {!isAuthenticated && <i className="material-icons-round menu-card__lock">lock</i>}
                        </button>
                    ))}

                    {/* Rol Yönetimi — Sadece Super Admin */}
                    {isAuthenticated && isSuperAdmin() && (
                        <button
                            className="menu-card"
                            onClick={() => navigate('/role-management')}
                            style={{ '--card-color': '#6B7280', animationDelay: `${visibleMenuItems.length * 0.04}s` }}
                        >
                            <div className="menu-card__icon">
                                <i className="material-icons-round">admin_panel_settings</i>
                            </div>
                            <div className="menu-card__text">
                                <span className="menu-card__label">Rol Yönetimi</span>
                                <span className="menu-card__desc">Kullanıcı ve yetki yönetimi</span>
                            </div>
                        </button>
                    )}

                    {/* Başvuru Formu — Sadece Super Admin */}
                    {isAuthenticated && isSuperAdmin() && (
                        <button
                            className="menu-card"
                            onClick={() => window.open('/basvuru.html', '_blank')}
                            style={{ '--card-color': '#E30613', animationDelay: `${(visibleMenuItems.length + 1) * 0.04}s` }}
                        >
                            <div className="menu-card__icon">
                                <i className="material-icons-round">assignment</i>
                            </div>
                            <div className="menu-card__text">
                                <span className="menu-card__label">Başvuru Formu</span>
                                <span className="menu-card__desc">Halka açık yarışma başvuru sayfası</span>
                            </div>
                            <i className="material-icons-round" style={{ fontSize: '1rem', opacity: 0.4 }}>open_in_new</i>
                        </button>
                    )}
                </div>
            </main>

            {/* Footer */}
            <footer className="dash-footer">
                <p>&copy; 2026 Türkiye Cimnastik Federasyonu — Okul Sporları Yönetim Sistemi</p>
            </footer>

            {/* Login Modal */}
            {showLoginModal && !isAuthenticated && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal__icon" style={{ background: loginTarget?.color || '#6B7280' }}>
                            <i className="material-icons-round">{loginTarget?.icon || 'login'}</i>
                        </div>
                        <h2 className="modal__title">{loginTarget?.label || 'Giriş Yap'}</h2>
                        <p className="modal__desc">Kullanıcı adınız ve şifrenizle giriş yapın</p>

                        <form onSubmit={handleLogin} className="modal__form">
                            <div className="modal__input-wrap" style={{ borderColor: error ? 'var(--red)' : '' }}>
                                <i className="material-icons-round" style={{ color: error ? 'var(--red)' : '' }}>person</i>
                                <input
                                    type="text"
                                    className="modal__input"
                                    placeholder="Kullanıcı adı"
                                    value={username}
                                    onChange={(e) => { setUsername(e.target.value); setError(''); }}
                                    autoFocus
                                    autoComplete="username"
                                />
                            </div>
                            <div className="modal__input-wrap" style={{ borderColor: error ? 'var(--red)' : '' }}>
                                <i className="material-icons-round" style={{ color: error ? 'var(--red)' : '' }}>vpn_key</i>
                                <input
                                    type="password"
                                    className="modal__input"
                                    placeholder="Şifre"
                                    value={password}
                                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                                    autoComplete="current-password"
                                />
                            </div>
                            {error && <p className="modal__error"><i className="material-icons-round" style={{ fontSize: 16 }}>error</i> {error}</p>}
                            <div className="modal__buttons">
                                <button type="button" className="modal__btn modal__btn--cancel" onClick={closeModal}>
                                    İptal
                                </button>
                                <button
                                    type="submit"
                                    className="modal__btn modal__btn--enter"
                                    style={{ background: loginTarget?.color || '#6B7280' }}
                                    disabled={loginLoading}
                                >
                                    {loginLoading ? (
                                        <span className="login-spinner" />
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
