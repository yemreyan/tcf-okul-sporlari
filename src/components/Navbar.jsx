import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './Navbar.css';

const NAV_ITEMS = [
    { path: '/', label: 'Ana Sayfa', icon: 'home' },
    { path: '/competitions', label: 'Yarışmalar', icon: 'emoji_events' },
    { path: '/athletes', label: 'Sporcular', icon: 'groups' },
    { path: '/analytics', label: 'Analitik', icon: 'analytics' },
    { path: '/finals', label: 'Finaller', icon: 'military_tech' },
];

export default function Navbar() {
    const location = useLocation();
    const [scrolled, setScrolled] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', onScroll);
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    return (
        <nav className={`navbar ${scrolled ? 'navbar--scrolled' : ''}`}>
            <div className="navbar__inner container">
                {/* Logo */}
                <Link to="/" className="navbar__brand">
                    <div className="navbar__logo">
                        <span className="navbar__logo-icon">
                            <i className="material-icons-round">sports_gymnastics</i>
                        </span>
                        <div className="navbar__logo-text">
                            <span className="navbar__logo-title">TCF</span>
                            <span className="navbar__logo-subtitle">Okul Sporları</span>
                        </div>
                    </div>
                </Link>

                {/* Desktop Nav */}
                <div className="navbar__links">
                    {NAV_ITEMS.map((item) => (
                        <Link
                            key={item.path}
                            to={item.path}
                            className={`navbar__link ${location.pathname === item.path ? 'navbar__link--active' : ''}`}
                        >
                            <i className="material-icons-round">{item.icon}</i>
                            <span>{item.label}</span>
                        </Link>
                    ))}
                </div>

                {/* Right side */}
                <div className="navbar__actions">
                    <button className="navbar__action-btn" title="Bildirimler">
                        <i className="material-icons-round">notifications_none</i>
                        <span className="navbar__badge">3</span>
                    </button>
                    <button className="navbar__user">
                        <div className="navbar__avatar">A</div>
                        <span className="navbar__username">Admin</span>
                        <i className="material-icons-round" style={{ fontSize: 18 }}>expand_more</i>
                    </button>

                    {/* Mobile menu button */}
                    <button
                        className="navbar__mobile-toggle"
                        onClick={() => setMobileOpen(!mobileOpen)}
                    >
                        <i className="material-icons-round">{mobileOpen ? 'close' : 'menu'}</i>
                    </button>
                </div>
            </div>

            {/* Mobile Menu */}
            {mobileOpen && (
                <div className="navbar__mobile-menu">
                    {NAV_ITEMS.map((item) => (
                        <Link
                            key={item.path}
                            to={item.path}
                            className={`navbar__mobile-link ${location.pathname === item.path ? 'navbar__mobile-link--active' : ''}`}
                            onClick={() => setMobileOpen(false)}
                        >
                            <i className="material-icons-round">{item.icon}</i>
                            {item.label}
                        </Link>
                    ))}
                </div>
            )}
        </nav>
    );
}
