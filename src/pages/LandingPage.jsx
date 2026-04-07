import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, set } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
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
        active: true,
    },
    {
        id: 'aerobik',
        title: 'Aerobik Cimnastik',
        subtitle: 'Aerobic Gymnastics',
        icon: 'directions_run',
        color: '#10B981',
        gradient: 'linear-gradient(135deg, #10B981, #34D399)',
        path: '/aerobik',
        active: true,
    },
    {
        id: 'parkur',
        title: 'Parkur Cimnastik',
        subtitle: 'Parkour',
        icon: 'terrain',
        color: '#F59E0B',
        gradient: 'linear-gradient(135deg, #F59E0B, #FBBF24)',
        path: '/parkur',
        active: true,
    },
    {
        id: 'trampolin',
        title: 'Trampolin Cimnastik',
        subtitle: 'Trampoline Gymnastics',
        icon: 'height',
        color: '#F97316',
        gradient: 'linear-gradient(135deg, #F97316, #FB923C)',
        path: '/trampolin',
        active: true,
    },
];

const SETTING_PATH = 'system_settings/gorevli_kartlari_aktif';

export default function LandingPage() {
    const navigate = useNavigate();
    const { isAuthenticated, isSuperAdmin } = useAuth();
    const superAdmin = isAuthenticated && isSuperAdmin();

    const [gorevliAktif, setGorevliAktif] = useState(false);
    const [toggling, setToggling] = useState(false);

    // Firebase'den ayarı dinle
    useEffect(() => {
        const unsub = onValue(ref(db, SETTING_PATH), (snap) => {
            setGorevliAktif(snap.val() === true);
        });
        return () => unsub();
    }, []);

    const handleToggle = async () => {
        if (!superAdmin || toggling) return;
        setToggling(true);
        try {
            await set(ref(db, SETTING_PATH), !gorevliAktif);
        } catch (e) {
            if (import.meta.env.DEV) console.error('Ayar güncellenemedi:', e);
        }
        setToggling(false);
    };

    const handleClick = (disc) => {
        if (disc.active) navigate(disc.path);
    };

    // Araçlar bölümü: süper admin her zaman görür, diğerleri sadece aktifse
    const showTools = superAdmin || gorevliAktif;

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

            {/* Araçlar — sadece aktifse veya süper admin ise göster */}
            {showTools && (
                <section className="landing-main landing-tools">
                    <h2 className="landing-section-title">
                        <i className="material-icons-round">build_circle</i>
                        Araçlar
                        {/* Süper admin toggle */}
                        {superAdmin && (
                            <button
                                className={`landing-feature-toggle ${gorevliAktif ? 'active' : ''} ${toggling ? 'toggling' : ''}`}
                                onClick={handleToggle}
                                title={gorevliAktif ? 'Araçları kapat' : 'Araçları aç'}
                                disabled={toggling}
                            >
                                <div className="lft-track">
                                    <div className="lft-thumb" />
                                </div>
                                <span>{gorevliAktif ? 'Açık' : 'Kapalı'}</span>
                            </button>
                        )}
                    </h2>
                    <div className="landing-tools-grid">
                        <button
                            className="landing-tool-card"
                            onClick={() => navigate('/gorevli-kartlari')}
                        >
                            <div className="landing-tool-card__icon" style={{ background: 'linear-gradient(135deg, #0EA5E9, #38BDF8)' }}>
                                <i className="material-icons-round">badge</i>
                            </div>
                            <div className="landing-tool-card__content">
                                <h3>Görevli Yaka Kartları</h3>
                                <span>Antrenör &amp; öğretmen kart çıktısı</span>
                            </div>
                            <i className="material-icons-round landing-tool-card__arrow">arrow_forward</i>
                        </button>
                    </div>
                </section>
            )}

            {/* Footer */}
            <footer className="landing-footer">
                <p>&copy; {new Date().getFullYear()} Türkiye Cimnastik Federasyonu &mdash; Okul Sporları Yönetim Sistemi</p>
            </footer>
        </div>
    );
}
