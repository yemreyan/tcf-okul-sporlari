import { useNavigate } from 'react-router-dom';
import './LandingPage.css';

const DISCIPLINES = [
    {
        id: 'artistik',
        title: 'Artistik Cimnastik',
        subtitle: 'Artistic Gymnastics',
        icon: 'sports_gymnastics',
        color: '#4F46E5',
        gradient: 'linear-gradient(135deg, #4F46E5, #6366F1)',
        path: '/artistik',
        active: true,
    },
    {
        id: 'ritmik',
        title: 'Ritmik Cimnastik',
        subtitle: 'Rhythmic Gymnastics',
        icon: 'self_improvement',
        color: '#EC4899',
        gradient: 'linear-gradient(135deg, #EC4899, #F472B6)',
        path: '/ritmik',
        active: false,
    },
    {
        id: 'aerobik',
        title: 'Aerobik Cimnastik',
        subtitle: 'Aerobic Gymnastics',
        icon: 'directions_run',
        color: '#10B981',
        gradient: 'linear-gradient(135deg, #10B981, #34D399)',
        path: '/aerobik',
        active: false,
    },
    {
        id: 'parkur',
        title: 'Parkur Cimnastik',
        subtitle: 'Parkour',
        icon: 'terrain',
        color: '#F59E0B',
        gradient: 'linear-gradient(135deg, #F59E0B, #FBBF24)',
        path: '/parkur',
        active: false,
    },
    {
        id: 'trampolin',
        title: 'Trampolin Cimnastik',
        subtitle: 'Trampoline Gymnastics',
        icon: 'height',
        color: '#EF4444',
        gradient: 'linear-gradient(135deg, #EF4444, #F87171)',
        path: '/trampolin',
        active: false,
    },
];

export default function LandingPage() {
    const navigate = useNavigate();

    const handleClick = (disc) => {
        if (disc.active) {
            navigate(disc.path);
        }
    };

    return (
        <div className="landing">
            {/* Background decorations */}
            <div className="landing-bg">
                <div className="landing-bg__circle landing-bg__circle--1" />
                <div className="landing-bg__circle landing-bg__circle--2" />
                <div className="landing-bg__circle landing-bg__circle--3" />
            </div>

            {/* Header */}
            <header className="landing-header">
                <div className="landing-header__logo">
                    <img src="/logo.png" alt="TCF Logo" className="landing-logo-img" />
                </div>
                <div className="landing-header__text">
                    <h1>Türkiye Cimnastik Federasyonu</h1>
                    <p>Okul Sporları Yönetim Sistemi</p>
                </div>
            </header>

            {/* Discipline Grid */}
            <main className="landing-main">
                <h2 className="landing-section-title">
                    <i className="material-icons-round">category</i>
                    Branş Seçiniz
                </h2>

                <div className="landing-grid">
                    {DISCIPLINES.map((disc) => (
                        <button
                            key={disc.id}
                            className={`landing-card ${!disc.active ? 'landing-card--disabled' : ''}`}
                            onClick={() => handleClick(disc)}
                            style={{ '--card-color': disc.color, '--card-gradient': disc.gradient }}
                        >
                            <div className="landing-card__icon">
                                <i className="material-icons-round">{disc.icon}</i>
                            </div>
                            <div className="landing-card__content">
                                <h3>{disc.title}</h3>
                                <span>{disc.subtitle}</span>
                            </div>
                            {disc.active ? (
                                <div className="landing-card__badge landing-card__badge--active">
                                    <i className="material-icons-round">check_circle</i>
                                    Aktif
                                </div>
                            ) : (
                                <div className="landing-card__badge landing-card__badge--soon">
                                    <i className="material-icons-round">schedule</i>
                                    Yakında
                                </div>
                            )}
                            <div className="landing-card__arrow">
                                <i className="material-icons-round">arrow_forward</i>
                            </div>
                        </button>
                    ))}
                </div>
            </main>

            {/* Footer */}
            <footer className="landing-footer">
                <p>&copy; {new Date().getFullYear()} Türkiye Cimnastik Federasyonu &mdash; Okul Sporları Yönetim Sistemi</p>
            </footer>
        </div>
    );
}
