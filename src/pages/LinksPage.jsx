import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, get, update } from 'firebase/database';
import { db } from '../lib/firebase';
import QRCode from 'react-qr-code';
import { useAuth } from '../lib/AuthContext';
import { filterCompetitionsArrayByUser } from '../lib/useFilteredCompetitions';
import { generateEPanelToken } from '../lib/epanelToken';
import './LinksPage.css';

export default function LinksPage() {
    const navigate = useNavigate();
    const { currentUser } = useAuth();
    const [competitions, setCompetitions] = useState([]);
    const [selectedCompId, setSelectedCompId] = useState('');
    const [competitionData, setCompetitionData] = useState(null);
    const [baseUrl, setBaseUrl] = useState('');
    const [activeCategory, setActiveCategory] = useState('all');
    const [copiedId, setCopiedId] = useState(null);
    const [expandedCats, setExpandedCats] = useState({});
    const [epanelToken, setEpanelToken] = useState('');
    const [selectedPanel, setSelectedPanel] = useState(null); // null | 'd' | 'e'

    useEffect(() => {
        const parsedUrl = new URL(window.location.href);
        setBaseUrl(`${parsedUrl.protocol}//${parsedUrl.host}`);

        const compsRef = ref(db, 'competitions');
        const unsubscribe = onValue(compsRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                const compsList = Object.keys(data)
                    .map(key => ({
                        id: key,
                        isim: data[key].isim || 'İsimsiz Yarışma',
                        tarih: data[key].tarih || '',
                        arsiv: data[key].arsiv || false,
                    }))
                    .filter(c => !c.arsiv)
                    .sort((a, b) => a.isim.localeCompare(b.isim, 'tr-TR')); // İsim sırasına göre

                const filtered = filterCompetitionsArrayByUser(compsList, currentUser);
                setCompetitions(filtered);
                if (filtered.length > 0 && !selectedCompId) {
                    setSelectedCompId(filtered[0].id);
                }
            } else {
                setCompetitions([]);
            }
        });
        return () => unsubscribe();
    }, [selectedCompId, currentUser]);

    // E-Panel token yönetimi: yoksa oluştur, varsa yükle
    useEffect(() => {
        if (!selectedCompId) { setEpanelToken(''); return; }
        const tokenRef = ref(db, `competitions/${selectedCompId}/epanelToken`);
        get(tokenRef).then((snap) => {
            const existing = snap.val();
            if (existing) {
                setEpanelToken(existing);
            } else {
                const newToken = generateEPanelToken();
                update(ref(db, `competitions/${selectedCompId}`), { epanelToken: newToken });
                setEpanelToken(newToken);
            }
        });
    }, [selectedCompId]);

    useEffect(() => {
        if (!selectedCompId) { setCompetitionData(null); return; }
        const compRef = ref(db, `competitions/${selectedCompId}`);
        const unsubscribe = onValue(compRef, (snapshot) => {
            const data = snapshot.val();
            setCompetitionData(data);
            if (data?.kategoriler) {
                const expanded = {};
                Object.keys(data.kategoriler).forEach(k => expanded[k] = true);
                setExpandedCats(expanded);
            }
        });
        return () => unsubscribe();
    }, [selectedCompId]);

    // Panel seçimi değiştiğinde kategori filtresini sıfırla
    useEffect(() => {
        setActiveCategory('all');
    }, [selectedPanel]);

    const copyToClipboard = useCallback((text, id) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
        });
    }, []);

    const toggleCategory = (catId) => {
        setExpandedCats(prev => ({ ...prev, [catId]: !prev[catId] }));
    };

    // Yarışma verisi hazırla
    const categories = competitionData?.kategoriler || {};
    const categoryList = Object.entries(categories).map(([id, cat]) => ({
        id,
        name: cat.name || id,
        aletler: (cat.aletler || []).map(a => typeof a === 'string' ? { id: a, name: a } : a)
    }));

    const panelIds = ['e1', 'e2', 'e3', 'e4'];
    const scoreboardUrl = `${baseUrl}/scoreboard`;

    const filteredCategories = activeCategory === 'all'
        ? categoryList
        : categoryList.filter(c => c.id === activeCategory);

    // D Panel URL'i
    const getDPanelUrl = (catId, aletId) => {
        return `${baseUrl}/scoring?competitionId=${selectedCompId}&catId=${catId}&aletId=${aletId}`;
    };

    // Tüm linkleri kopyala
    const copyAllLinks = () => {
        let allLinks = `Skorboard: ${scoreboardUrl}\n\n`;

        if (selectedPanel === 'd') {
            allLinks += `=== D-PANEL LİNKLERİ ===\n\n`;
            filteredCategories.forEach(cat => {
                allLinks += `--- ${cat.name} ---\n`;
                cat.aletler.forEach(alet => {
                    allLinks += `D-Panel | ${cat.name} | ${alet.name}: ${getDPanelUrl(cat.id, alet.id)}\n`;
                });
                allLinks += '\n';
            });
        } else if (selectedPanel === 'e') {
            allLinks += `=== E-PANEL LİNKLERİ ===\n\n`;
            filteredCategories.forEach(cat => {
                allLinks += `--- ${cat.name} ---\n`;
                cat.aletler.forEach(alet => {
                    panelIds.forEach(pid => {
                        const url = `${baseUrl}/epanel?competitionId=${selectedCompId}&catId=${cat.id}&aletId=${alet.id}&panelId=${pid}${epanelToken ? `&token=${epanelToken}` : ''}`;
                        allLinks += `${cat.name} | ${alet.name} | ${pid.toUpperCase()}: ${url}\n`;
                    });
                });
                allLinks += '\n';
            });
        }

        copyToClipboard(allLinks, 'all-links');
    };

    // Loading state
    if (!competitionData) {
        return (
            <div className="links-page">
                <div className="page-header">
                    <div className="page-header__left">
                        <button className="back-btn" onClick={() => navigate('/')}>
                            <i className="material-icons-round">arrow_back</i>
                        </button>
                        <div>
                            <h1 className="page-title">QR ve Link Panosu</h1>
                            <p className="page-subtitle">Hakem paneli QR kodları ve erişim linkleri</p>
                        </div>
                    </div>
                </div>
                <div className="page-content">
                    <div className="loading-state">
                        <div className="spinner"></div>
                        <span>Yükleniyor...</span>
                    </div>
                </div>
            </div>
        );
    }

    // Panel seçim ekranı (D veya E seçilmediğinde)
    const renderPanelSelector = () => (
        <div className="panel-selector">
            <div className="panel-selector__header">
                <i className="material-icons-round">qr_code_scanner</i>
                <h2>Panel Türü Seçin</h2>
                <p>QR kod ve linkleri oluşturmak istediğiniz panel türünü seçin</p>
            </div>
            <div className="panel-selector__cards">
                {/* D Panel Card */}
                <button className="panel-type-card panel-type-card--d" onClick={() => setSelectedPanel('d')}>
                    <div className="panel-type-card__icon">
                        <i className="material-icons-round">gavel</i>
                    </div>
                    <div className="panel-type-card__badge">D</div>
                    <h3 className="panel-type-card__title">D-Panel</h3>
                    <p className="panel-type-card__subtitle">Başhakem Paneli</p>
                    <p className="panel-type-card__desc">Zorluk puanı (D-Score) girişi, sporcu çağırma, E-puanları yönetme ve ana puanlama kontrolü</p>
                    <div className="panel-type-card__footer">
                        <span><i className="material-icons-round">category</i>{categoryList.length} kategori</span>
                        <span><i className="material-icons-round">arrow_forward</i>Linkleri Gör</span>
                    </div>
                </button>

                {/* E Panel Card */}
                <button className="panel-type-card panel-type-card--e" onClick={() => setSelectedPanel('e')}>
                    <div className="panel-type-card__icon">
                        <i className="material-icons-round">sports_score</i>
                    </div>
                    <div className="panel-type-card__badge">E</div>
                    <h3 className="panel-type-card__title">E-Panel</h3>
                    <p className="panel-type-card__subtitle">Uygulama Hakemleri</p>
                    <p className="panel-type-card__desc">Uygulama kesintileri (E-Score) girişi. Her alet için 4 hakem paneli (E1–E4) QR kodları</p>
                    <div className="panel-type-card__footer">
                        <span><i className="material-icons-round">groups</i>4 hakem / alet</span>
                        <span><i className="material-icons-round">arrow_forward</i>QR Kodları Gör</span>
                    </div>
                </button>
            </div>
        </div>
    );

    // D Panel Linkleri
    const renderDPanelContent = () => (
        <div className="categories-container">
            {filteredCategories.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-state__icon"><i className="material-icons-round">qr_code</i></div>
                    <p>Henüz kategori tanımlanmamış</p>
                </div>
            ) : (
                filteredCategories.map(cat => (
                    <div className="category-section" key={cat.id}>
                        <div className="category-section__header" onClick={() => toggleCategory(cat.id)}>
                            <div className="category-section__title-group">
                                <i className="material-icons-round category-section__icon">sports_gymnastics</i>
                                <h3 className="category-section__title">{cat.name}</h3>
                                <span className="category-section__badge">{cat.aletler.length} alet</span>
                            </div>
                            <button className="category-section__toggle">
                                <i className="material-icons-round">{expandedCats[cat.id] ? 'expand_less' : 'expand_more'}</i>
                            </button>
                        </div>
                        {expandedCats[cat.id] && (
                            <div className="category-section__content">
                                {cat.aletler.map(alet => {
                                    const url = getDPanelUrl(cat.id, alet.id);
                                    const cardId = `d-${cat.id}-${alet.id}`;
                                    return (
                                        <div className="d-panel-row" key={alet.id}>
                                            <div className="d-panel-row__info">
                                                <span className="d-panel-row__badge">D</span>
                                                <div className="d-panel-row__text">
                                                    <span className="d-panel-row__alet">{alet.name}</span>
                                                    <span className="d-panel-row__cat">{cat.name}</span>
                                                </div>
                                            </div>
                                            <div className="d-panel-row__qr">
                                                <QRCode value={url} size={80} level="M" />
                                            </div>
                                            <div className="d-panel-row__actions">
                                                <button
                                                    className={`panel-action ${copiedId === cardId ? 'panel-action--copied' : ''}`}
                                                    onClick={() => copyToClipboard(url, cardId)}
                                                    title="Linki kopyala"
                                                >
                                                    <i className="material-icons-round">{copiedId === cardId ? 'check' : 'content_copy'}</i>
                                                </button>
                                                <a href={url} target="_blank" rel="noreferrer" className="panel-action" title="Yeni sekmede aç">
                                                    <i className="material-icons-round">open_in_new</i>
                                                </a>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ))
            )}
        </div>
    );

    // E Panel QR Kartları (mevcut yapı)
    const renderEPanelContent = () => (
        <div className="categories-container">
            {filteredCategories.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-state__icon"><i className="material-icons-round">qr_code</i></div>
                    <p>Henüz kategori tanımlanmamış</p>
                </div>
            ) : (
                filteredCategories.map(cat => (
                    <div className="category-section" key={cat.id}>
                        <div className="category-section__header" onClick={() => toggleCategory(cat.id)}>
                            <div className="category-section__title-group">
                                <i className="material-icons-round category-section__icon">sports_gymnastics</i>
                                <h3 className="category-section__title">{cat.name}</h3>
                                <span className="category-section__badge">{cat.aletler.length} alet</span>
                            </div>
                            <button className="category-section__toggle">
                                <i className="material-icons-round">{expandedCats[cat.id] ? 'expand_less' : 'expand_more'}</i>
                            </button>
                        </div>
                        {expandedCats[cat.id] && (
                            <div className="category-section__content">
                                {cat.aletler.map(alet => (
                                    <div className="apparatus-group" key={alet.id}>
                                        <div className="apparatus-group__header">
                                            <span className="apparatus-group__name">{alet.name}</span>
                                            <div className="apparatus-group__line"></div>
                                        </div>
                                        <div className="panels-grid">
                                            {panelIds.map(pid => {
                                                const url = `${baseUrl}/epanel?competitionId=${selectedCompId}&catId=${cat.id}&aletId=${alet.id}&panelId=${pid}${epanelToken ? `&token=${epanelToken}` : ''}`;
                                                const cardId = `${cat.id}-${alet.id}-${pid}`;
                                                return (
                                                    <div className="panel-card printable-card" key={pid}>
                                                        <div className="panel-card__badge-row">
                                                            <span className="panel-card__badge">{pid.toUpperCase()}</span>
                                                            <span className="panel-card__meta">{cat.name}</span>
                                                        </div>
                                                        <div className="panel-card__alet">{alet.name}</div>
                                                        <div className="panel-card__qr">
                                                            <QRCode value={url} size={100} level="M" />
                                                        </div>
                                                        <div className="panel-card__actions no-print">
                                                            <button
                                                                className={`panel-action ${copiedId === cardId ? 'panel-action--copied' : ''}`}
                                                                onClick={() => copyToClipboard(url, cardId)}
                                                                title="Linki kopyala"
                                                            >
                                                                <i className="material-icons-round">{copiedId === cardId ? 'check' : 'content_copy'}</i>
                                                            </button>
                                                            <a href={url} target="_blank" rel="noreferrer" className="panel-action" title="Yeni sekmede aç">
                                                                <i className="material-icons-round">open_in_new</i>
                                                            </a>
                                                        </div>
                                                        <div className="panel-card__print-label print-only">Okut & Puanla</div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))
            )}
        </div>
    );

    return (
        <div className="links-page no-print-bg">
            {/* Sticky Header */}
            <div className="page-header no-print">
                <div className="page-header__left">
                    <button className="back-btn" onClick={() => navigate('/')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div>
                        <h1 className="page-title">QR ve Link Panosu</h1>
                        <p className="page-subtitle">Hakem paneli QR kodları ve erişim linkleri</p>
                    </div>
                </div>
                <div className="page-header__right">
                    <div className="header-select-wrapper">
                        <i className="material-icons-round header-select-icon">emoji_events</i>
                        <select
                            className="header-select"
                            value={selectedCompId}
                            onChange={(e) => setSelectedCompId(e.target.value)}
                        >
                            {competitions.map(c => (
                                <option key={c.id} value={c.id}>{c.isim}</option>
                            ))}
                        </select>
                    </div>
                    {selectedPanel && (
                        <>
                            <button className="btn btn--secondary" onClick={copyAllLinks}>
                                <i className="material-icons-round">content_copy</i>
                                <span>Tümünü Kopyala</span>
                            </button>
                            <button className="btn btn--primary" onClick={() => window.print()}>
                                <i className="material-icons-round">print</i>
                                <span>Yazdır</span>
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div className="page-content">
                {/* Scoreboard Card — her zaman görünür */}
                <div className="scoreboard-card">
                    <div className="scoreboard-card__qr">
                        <QRCode value={scoreboardUrl} size={120} level="M" />
                    </div>
                    <div className="scoreboard-card__info">
                        <div className="scoreboard-card__badge">
                            <i className="material-icons-round">live_tv</i>
                            Canlı Skor
                        </div>
                        <h2 className="scoreboard-card__title">Seyirci & Canlı Skor Ekranı</h2>
                        <p className="scoreboard-card__desc">Bu QR kodu taratarak veya linke tıklayarak seyirciler anlık skorları takip edebilir.</p>
                        <div className="scoreboard-card__url">
                            <code>{scoreboardUrl}</code>
                        </div>
                        <div className="scoreboard-card__actions">
                            <button
                                className={`btn btn--outline ${copiedId === 'scoreboard' ? 'btn--copied' : ''}`}
                                onClick={() => copyToClipboard(scoreboardUrl, 'scoreboard')}
                            >
                                <i className="material-icons-round">{copiedId === 'scoreboard' ? 'check' : 'content_copy'}</i>
                                {copiedId === 'scoreboard' ? 'Kopyalandı!' : 'Linki Kopyala'}
                            </button>
                            <a href={scoreboardUrl} target="_blank" rel="noreferrer" className="btn btn--primary">
                                <i className="material-icons-round">open_in_new</i>
                                Ekranı Aç
                            </a>
                        </div>
                    </div>
                </div>

                {/* Panel seçimi veya seçilen panel içeriği */}
                {!selectedPanel ? (
                    renderPanelSelector()
                ) : (
                    <>
                        {/* Panel Toolbar */}
                        <div className="links-toolbar no-print">
                            <div className="links-toolbar__left">
                                <button className="panel-back-btn" onClick={() => setSelectedPanel(null)} title="Panel seçimine dön">
                                    <i className="material-icons-round">arrow_back</i>
                                </button>
                                <div className={`links-toolbar__panel-badge links-toolbar__panel-badge--${selectedPanel}`}>
                                    <i className="material-icons-round">{selectedPanel === 'd' ? 'gavel' : 'sports_score'}</i>
                                    {selectedPanel === 'd' ? 'D-Panel' : 'E-Panel'}
                                </div>
                                <h2 className="links-toolbar__title">
                                    {selectedPanel === 'd' ? 'Başhakem Paneli Linkleri' : 'Hakem E-Panel Kartları'}
                                </h2>
                                <span className="links-toolbar__count">{categoryList.length} kategori</span>
                            </div>
                            <div className="category-filters">
                                <button
                                    className={`filter-btn ${activeCategory === 'all' ? 'filter-btn--active' : ''}`}
                                    onClick={() => setActiveCategory('all')}
                                >
                                    Tümü
                                </button>
                                {categoryList.map(cat => (
                                    <button
                                        key={cat.id}
                                        className={`filter-btn ${activeCategory === cat.id ? 'filter-btn--active' : ''}`}
                                        onClick={() => setActiveCategory(cat.id)}
                                    >
                                        {cat.name}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Panel İçeriği */}
                        {selectedPanel === 'd' ? renderDPanelContent() : renderEPanelContent()}
                    </>
                )}
            </div>
        </div>
    );
}
