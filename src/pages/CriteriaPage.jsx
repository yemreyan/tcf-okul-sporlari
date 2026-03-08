import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_CRITERIA } from '../data/criteriaDefaults.js';
import './CriteriaPage.css';

const APPARATUS_ICONS = {
    'yer': 'accessibility_new',
    'atlama': 'directions_run',
    'halka': 'radio_button_unchecked',
    'kulplu': 'sports',
    'paralel': 'drag_handle',
    'barfiks': 'horizontal_rule',
    'asimetrik': 'format_align_center',
    'denge': 'minimize',
    'mantar': 'lens'
};

const APPARATUS_NAMES = {
    'yer': 'Yer Hareketleri',
    'atlama': 'Atlama Masası',
    'halka': 'Halka',
    'kulplu': 'Kulplu Beygir',
    'paralel': 'Paralel Bar',
    'barfiks': 'Barfiks',
    'asimetrik': 'Asimetrik Paralel',
    'denge': 'Denge Aleti',
    'mantar': 'Mantar'
};

export default function CriteriaPage() {
    const navigate = useNavigate();

    // State for viewing detailed criteria
    const [viewingCriteria, setViewingCriteria] = useState(null); // { catId, catName, appId, appName, details }

    const getCategoryLabel = (catKey) => {
        return catKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    };

    // Filter out 'metadata' key while mapping
    const categories = Object.keys(DEFAULT_CRITERIA).map(catKey => {
        const catData = DEFAULT_CRITERIA[catKey];
        const aletler = Object.keys(catData).filter(k => k !== 'metadata');
        return {
            id: catKey,
            name: getCategoryLabel(catKey),
            aletler: aletler.map(a => ({
                id: a,
                name: APPARATUS_NAMES[a] || a,
                icon: APPARATUS_ICONS[a] || 'fitness_center',
                details: catData[a]
            }))
        };
    });

    return (
        <div className="criteria-page rulebook-page">
            <header className="page-header page-header--rulebook">
                <div className="page-header__left">
                    <button className="back-btn back-btn--light" onClick={() => navigate('/')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div className="header-title-wrapper">
                        <h1 className="page-title text-white">2026 Genel Yarışma Kuralları</h1>
                        <p className="page-subtitle text-white-50">Tüm kategoriler için alet bazlı değerlendirme kriterleri ve hareket tabloları.</p>
                    </div>
                </div>
            </header>

            <main className="page-content rulebook-content">
                <div className="rulebook-grid">
                    {categories.map((cat) => (
                        <div key={cat.id} className="rule-card">
                            <div className="rule-card__header">
                                <div className="rule-card__icon">
                                    <i className="material-icons-round">emoji_events</i>
                                </div>
                                <h2>{cat.name}</h2>
                            </div>

                            <div className="rule-card__apparatuses">
                                {cat.aletler.map(app => (
                                    <button
                                        key={app.id}
                                        className="app-pill"
                                        onClick={() => setViewingCriteria({
                                            catId: cat.id,
                                            catName: cat.name,
                                            appId: app.id,
                                            appName: app.name,
                                            details: app.details
                                        })}
                                        title={`${app.name} Kriterlerini İncele`}
                                    >
                                        <i className="material-icons-round">{app.icon}</i>
                                        <span>{app.name}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </main>

            {/* Criteria Info Modal */}
            {viewingCriteria && (() => {
                const criteria = viewingCriteria.details;

                return (
                    <div className="modal-overlay" onClick={() => setViewingCriteria(null)}>
                        <div className="modal modal--criteria" onClick={e => e.stopPropagation()}>
                            <div className="modal__header">
                                <h2>{viewingCriteria.catName} - {viewingCriteria.appName} Kriterleri</h2>
                                <button className="modal__close" onClick={() => setViewingCriteria(null)}>
                                    <i className="material-icons-round">close</i>
                                </button>
                            </div>

                            <div className="modal__content criteria-details">
                                {!criteria ? (
                                    <div className="empty-state empty-state--small">Bu alete ait özel bir kriter tanımlanmamış.</div>
                                ) : (
                                    <>
                                        <div className="criteria-stat-cards">
                                            <div className="stat-card">
                                                <i className="material-icons-round">group</i>
                                                <div className="stat-data">
                                                    <span className="stat-label">Hakem Sayısı</span>
                                                    <span className="stat-value">{criteria.hakemSayisi || 0} Hakem</span>
                                                </div>
                                            </div>
                                            {criteria.bonus && (
                                                <div className="stat-card">
                                                    <i className="material-icons-round">star</i>
                                                    <div className="stat-data">
                                                        <span className="stat-label">Max E Puanı</span>
                                                        <span className="stat-value">{criteria.bonus.maxE || 10}</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {criteria.eksikKesintiTiers && criteria.eksikKesintiTiers.length > 0 && (
                                            <div className="criteria-section">
                                                <h3>Eksik Hareket Kesintileri</h3>
                                                <table className="criteria-table">
                                                    <thead>
                                                        <tr>
                                                            <th>Eksik Hareket Sayısı</th>
                                                            <th>Kesinti (Puan)</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {criteria.eksikKesintiTiers.map((tier, idx) => {
                                                            if (tier === null) return null;
                                                            return (
                                                                <tr key={idx}>
                                                                    <td>{idx} Hareket</td>
                                                                    <td>-{tier} Puan</td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}

                                        {criteria.hareketler && criteria.hareketler.length > 0 && (
                                            <div className="criteria-section">
                                                <h3>Hareket Tablosu</h3>
                                                <div className="table-responsive">
                                                    <table className="criteria-table">
                                                        <thead>
                                                            <tr>
                                                                <th>Sıra</th>
                                                                <th>Hareket İsmi</th>
                                                                <th>D Değeri Seçenekleri</th>
                                                                <th>Özel Durum</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {criteria.hareketler.map((h, i) => (
                                                                <tr key={h.id || i}>
                                                                    <td>{i + 1}</td>
                                                                    <td><strong>{h.isim || `H${i + 1}`}</strong></td>
                                                                    <td>
                                                                        <div className="d-value-pills">
                                                                            {h.dValues ? h.dValues.split(',').map((val, vi) => (
                                                                                <span key={vi} className="d-pill">{val}</span>
                                                                            )) : '-'}
                                                                        </div>
                                                                    </td>
                                                                    <td>
                                                                        {h.puansiz ? (
                                                                            <span className="badge badge--warning">Düz Puansız Elem.</span>
                                                                        ) : '-'}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
