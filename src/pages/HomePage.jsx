import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import './HomePage.css';

const MENU_ITEMS = [
    { id: 'competitions', icon: 'emoji_events', label: 'Yarışmalar', desc: 'Yarışma oluştur ve yönet', color: '#E30613', path: '/competitions' },
    { id: 'applications', icon: 'assignment_turned_in', label: 'Başvurular', desc: 'Başvuruları incele ve onayla', color: '#2563EB', path: '/applications' },
    { id: 'athletes', icon: 'groups', label: 'Sporcular', desc: 'Sporcu kayıt ve yönetimi', color: '#16A34A', path: '/athletes' },
    { id: 'scoring', icon: 'scoreboard', label: 'Puanlama', desc: 'Canlı puan girişi', color: '#EA580C', path: '/scoring' },
    { id: 'criteria', icon: 'tune', label: 'Kriterler', desc: 'Puanlama kuralları', color: '#7C3AED', path: '/criteria' },
    { id: 'judges', icon: 'gavel', label: 'Hakem Listesi', desc: 'Hakem ekleme ve excel yükleme', color: '#0D9488', path: '/referees' },
    { id: 'scoreboard', icon: 'live_tv', label: 'Canlı Skor', desc: 'Canlı skorboard ekranı', color: '#DB2777', path: '/scoreboard' },
    { id: 'finals', icon: 'military_tech', label: 'Finaller', desc: 'Final sonuçları', color: '#D97706', path: '/finals' },
    { id: 'analytics', icon: 'analytics', label: 'Raporlar', desc: 'İstatistik ve analiz', color: '#4F46E5', path: '/analytics' },
    { id: 'order', icon: 'format_list_numbered', label: 'Çıkış Sırası', desc: 'Sporcu sıralama ve rotasyon', color: '#0891B2', path: '/start-order' },
    { id: 'links', icon: 'qr_code_2', label: 'QR & Linkler', desc: 'Link ve QR oluştur', color: '#059669', path: '/links' },
    { id: 'report', icon: 'description', label: 'Yarışma Raporu', desc: 'Resmi müsabaka raporu oluştur', color: '#475569', path: '/official-report' },
    { id: 'settings', icon: 'settings', label: 'Ayarlar', desc: 'Şifre ve erişim yönetimi', color: '#6B7280', path: '/settings' },
];

export default function HomePage() {
    const navigate = useNavigate();
    const { login, isAuthenticated, logout } = useAuth();

    const [passwordModal, setPasswordModal] = useState(null);
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleMenuClick = (item) => {
        // Eğer zaten giriş yapılmışsa direkt yönlendir
        if (isAuthenticated) {
            navigate(item.path);
        } else {
            setPasswordModal(item);
            setPassword('');
            setError('');
        }
    };

    const handleLogin = (e) => {
        e.preventDefault();

        // AuthContext üzerindeki login fonksiyonunu çağır (şifre: 63352180)
        if (login(password)) {
            const targetPath = passwordModal.path;
            setPasswordModal(null);
            setPassword('');
            setError('');
            navigate(targetPath);
        } else {
            setError('Hatalı şifre! Tekrar deneyin.');
        }
    };

    const closeModal = () => {
        setPasswordModal(null);
        setPassword('');
        setError('');
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
                        <button className="header__user" onClick={logout} title="Çıkış Yap">
                            <div className="header__avatar" style={{ background: 'var(--green)' }}>A</div>
                            <span className="header__username">Süper Admin</span>
                            <i className="material-icons-round" style={{ fontSize: 16, marginLeft: 4 }}>logout</i>
                        </button>
                    ) : (
                        <div className="header__user" style={{ cursor: 'default' }}>
                            <div className="header__avatar" style={{ background: 'var(--text-muted)' }}>?</div>
                            <span className="header__username">Misafir</span>
                        </div>
                    )}
                </div>
            </header>

            {/* Main Grid */}
            <main className="main">
                <div className="menu-grid">
                    {MENU_ITEMS.map((item, i) => (
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
                </div>
            </main>

            {/* Footer */}
            <footer className="dash-footer">
                <p>© 2026 Türkiye Cimnastik Federasyonu — Okul Sporları Yönetim Sistemi</p>
            </footer>

            {/* Password Modal */}
            {passwordModal && !isAuthenticated && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal__icon" style={{ background: passwordModal.color }}>
                            <i className="material-icons-round">{passwordModal.icon}</i>
                        </div>
                        <h2 className="modal__title">{passwordModal.label}</h2>
                        <p className="modal__desc">Bu modüle erişmek için Süper Admin şifresi giriniz</p>

                        <form onSubmit={handleLogin} className="modal__form">
                            <div className="modal__input-wrap" style={{ borderColor: error ? 'var(--red)' : '' }}>
                                <i className="material-icons-round" style={{ color: error ? 'var(--red)' : '' }}>vpn_key</i>
                                <input
                                    type="password"
                                    className="modal__input"
                                    placeholder="Şifre"
                                    value={password}
                                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                                    autoFocus
                                />
                            </div>
                            {error && <p className="modal__error"><i className="material-icons-round" style={{ fontSize: 16 }}>error</i> {error}</p>}
                            <div className="modal__buttons">
                                <button type="button" className="modal__btn modal__btn--cancel" onClick={closeModal}>
                                    İptal
                                </button>
                                <button type="submit" className="modal__btn modal__btn--enter" style={{ background: passwordModal.color }}>
                                    <i className="material-icons-round">login</i>
                                    Giriş
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
