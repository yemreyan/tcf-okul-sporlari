import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, get, update } from 'firebase/database';
import { db } from '../lib/firebase';
import QRCode from 'react-qr-code';
import { useAuth } from '../lib/AuthContext';
import { useDiscipline } from '../lib/DisciplineContext';
import { filterCompetitionsArrayByUser } from '../lib/useFilteredCompetitions';
import { generateEPanelToken } from '../lib/epanelToken';
import './LinksPage.css';

export default function LinksPage() {
    const navigate = useNavigate();
    const { currentUser } = useAuth();
    const { firebasePath, routePrefix, hasApparatus, id: disciplineId } = useDiscipline();
    const isRitmik = disciplineId === 'ritmik';
    const [competitions, setCompetitions] = useState([]);
    const [selectedCity, setSelectedCity] = useState('');
    const [selectedCompId, setSelectedCompId] = useState('');
    const [competitionData, setCompetitionData] = useState(null);
    const [baseUrl, setBaseUrl] = useState('');
    const [activeCategory, setActiveCategory] = useState('all');
    const [copiedId, setCopiedId] = useState(null);
    const [expandedCats, setExpandedCats] = useState({});
    const [epanelToken, setEpanelToken] = useState('');
    const [selectedPanel, setSelectedPanel] = useState(null); // null | 'd' | 'e' | 'scoring' | 'a'

    // baseUrl: sadece bir kez hesapla
    useEffect(() => {
        const parsedUrl = new URL(window.location.href);
        setBaseUrl(`${parsedUrl.protocol}//${parsedUrl.host}`);
    }, []);

    // Disiplin değişince seçimleri sıfırla
    useEffect(() => {
        setSelectedCompId('');
        setSelectedPanel(null);
        setCompetitionData(null);
    }, [firebasePath]);

    // Yarışmaları yükle — firebasePath veya currentUser değişince yeniden yükle
    useEffect(() => {
        const compsRef = ref(db, firebasePath);
        const unsubscribe = onValue(compsRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                const compsList = Object.keys(data)
                    .map(key => ({
                        id: key,
                        isim: data[key].isim || 'İsimsiz Yarışma',
                        tarih: data[key].tarih || data[key].baslangicTarihi || '',
                        arsiv: data[key].arsiv || false,
                        il: data[key].il || data[key].city || '',
                    }))
                    .filter(c => !c.arsiv)
                    .sort((a, b) => a.isim.localeCompare(b.isim, 'tr-TR'));

                const filtered = filterCompetitionsArrayByUser(compsList, currentUser);
                setCompetitions(filtered);
            } else {
                setCompetitions([]);
            }
        });
        return () => unsubscribe();
    }, [currentUser, firebasePath]);

    // E-Panel token yönetimi: yoksa oluştur, varsa yükle
    useEffect(() => {
        if (!selectedCompId) { setEpanelToken(''); return; }
        const tokenRef = ref(db, `${firebasePath}/${selectedCompId}/epanelToken`);
        get(tokenRef).then((snap) => {
            const existing = snap.val();
            if (existing) {
                setEpanelToken(existing);
            } else {
                const newToken = generateEPanelToken();
                update(ref(db, `${firebasePath}/${selectedCompId}`), { epanelToken: newToken });
                setEpanelToken(newToken);
            }
        });
    }, [selectedCompId]);

    useEffect(() => {
        if (!selectedCompId) { setCompetitionData(null); return; }
        const compRef = ref(db, `${firebasePath}/${selectedCompId}`);
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

    // Available cities from competitions
    const availableCities = [...new Set(competitions.map(c => (c.il || '').toLocaleUpperCase('tr-TR')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr-TR'));

    // Filter competitions by selected city
    const filteredCompetitions = selectedCity
        ? competitions.filter(c => (c.il || '').toLocaleUpperCase('tr-TR') === selectedCity)
        : competitions;

    // Auto-select first competition from filtered list when selectedCompId is empty
    useEffect(() => {
        if (!selectedCompId && filteredCompetitions.length > 0) {
            setSelectedCompId(filteredCompetitions[0].id);
        }
    }, [selectedCity, competitions]);

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
    const RITMIK_ALET_LABELS = { top: 'Top', kurdele: 'Kurdele' };
    const categories = competitionData?.kategoriler || {};
    const categoryList = Object.entries(categories).map(([id, cat]) => {
        let rawAletler = cat.aletler || [];
        if (isRitmik && rawAletler.length === 0) {
            rawAletler = ['top', 'kurdele'];
        }
        return {
            id,
            name: cat.name || cat.ad || id,
            aletler: rawAletler.map(a => {
                if (typeof a === 'string') {
                    const name = isRitmik ? (RITMIK_ALET_LABELS[a] || a) : a;
                    return { id: a, name };
                }
                return a;
            })
        };
    });
    // Panel IDs for Ritmik A-panel
    const aPanelIds = ['a1', 'a2', 'a3', 'a4'];

    const panelIds = ['e1', 'e2', 'e3', 'e4'];
    const scoreboardUrl = `${baseUrl}${routePrefix}/scoreboard`;

    const filteredCategories = activeCategory === 'all'
        ? categoryList
        : categoryList.filter(c => c.id === activeCategory);

    // D Panel URL'i (Artistik)
    const getDPanelUrl = (catId, aletId) => {
        return `${baseUrl}${routePrefix}/scoring?competitionId=${selectedCompId}&catId=${catId}&aletId=${aletId}`;
    };

    // Ritmik Puanlama URL'i (DA + DB girişi — başhakem paneli, kategori başına tek link)
    const getRitmikScoringUrl = (catId) => {
        return `${baseUrl}${routePrefix}/scoring?competitionId=${selectedCompId}&catId=${catId}`;
    };

    // Ritmik A-Panel URL'i (Artistlik hakem)
    const getRitmikAPanelUrl = (catId, aletId, pid) => {
        return `${baseUrl}${routePrefix}/epanel?competitionId=${selectedCompId}&catId=${catId}&aletId=${aletId}&panelId=${pid}&panelType=a${epanelToken ? `&token=${epanelToken}` : ''}`;
    };

    // Ritmik E-Panel URL'i (İcra hakem)
    const getRitmikEPanelUrl = (catId, aletId, pid) => {
        return `${baseUrl}${routePrefix}/epanel?competitionId=${selectedCompId}&catId=${catId}&aletId=${aletId}&panelId=${pid}&panelType=e${epanelToken ? `&token=${epanelToken}` : ''}`;
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
        } else if (selectedPanel === 'scoring') {
            allLinks += `=== PUANLAMA PANELİ LİNKLERİ (DA + DB) ===\n\n`;
            filteredCategories.forEach(cat => {
                allLinks += `${cat.name}: ${getRitmikScoringUrl(cat.id)}\n`;
            });
        } else if (selectedPanel === 'a') {
            allLinks += `=== A-PANEL LİNKLERİ (ARTİSTLİK) ===\n\n`;
            filteredCategories.forEach(cat => {
                allLinks += `--- ${cat.name} ---\n`;
                cat.aletler.forEach(alet => {
                    aPanelIds.forEach(pid => {
                        allLinks += `${cat.name} | ${alet.name} | ${pid.toUpperCase()}: ${getRitmikAPanelUrl(cat.id, alet.id, pid)}\n`;
                    });
                });
                allLinks += '\n';
            });
        } else if (selectedPanel === 'e') {
            allLinks += `=== E-PANEL LİNKLERİ ===\n\n`;
            filteredCategories.forEach(cat => {
                allLinks += `--- ${cat.name} ---\n`;
                if (isRitmik) {
                    cat.aletler.forEach(alet => {
                        panelIds.forEach(pid => {
                            allLinks += `${cat.name} | ${alet.name} | ${pid.toUpperCase()}: ${getRitmikEPanelUrl(cat.id, alet.id, pid)}\n`;
                        });
                    });
                } else if (hasApparatus) {
                    cat.aletler.forEach(alet => {
                        panelIds.forEach(pid => {
                            const url = `${baseUrl}${routePrefix}/epanel?competitionId=${selectedCompId}&catId=${cat.id}&aletId=${alet.id}&panelId=${pid}${epanelToken ? `&token=${epanelToken}` : ''}`;
                            allLinks += `${cat.name} | ${alet.name} | ${pid.toUpperCase()}: ${url}\n`;
                        });
                    });
                } else {
                    panelIds.forEach(pid => {
                        const url = `${baseUrl}${routePrefix}/epanel?competitionId=${selectedCompId}&catId=${cat.id}&panelId=${pid}${epanelToken ? `&token=${epanelToken}` : ''}`;
                        allLinks += `${cat.name} | ${pid.toUpperCase()}: ${url}\n`;
                    });
                }
                allLinks += '\n';
            });
        }

        copyToClipboard(allLinks, 'all-links');
    };

    // Loading state — sadece seçili yarışma varken veri bekleniyor
    if (selectedCompId && !competitionData) {
        return (
            <div className="links-page">
                <div className="page-header">
                    <div className="page-header__left">
                        <button className="back-btn" onClick={() => navigate(routePrefix)}>
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

    // Panel seçim ekranı
    const renderPanelSelector = () => (
        <div className="panel-selector">
            <div className="panel-selector__header">
                <i className="material-icons-round">qr_code_scanner</i>
                <h2>Panel Türü Seçin</h2>
                <p>QR kod ve linkleri oluşturmak istediğiniz panel türünü seçin</p>
            </div>
            <div className="panel-selector__cards">
                {/* Ritmik: 3 panel tipi — Puanlama (DA+DB), A, E */}
                {isRitmik ? (
                    <>
                        <button className="panel-type-card panel-type-card--d" onClick={() => setSelectedPanel('scoring')}>
                            <div className="panel-type-card__icon">
                                <i className="material-icons-round">gavel</i>
                            </div>
                            <div className="panel-type-card__badge">DA+DB</div>
                            <h3 className="panel-type-card__title">Puanlama Paneli</h3>
                            <p className="panel-type-card__subtitle">Başhakem / Zorluk Hakemler</p>
                            <p className="panel-type-card__desc">DA (Alet Zorluğu) ve DB (Vücut Zorluğu) puanı girişi. Top ve Kurdele alet seçimi içerir.</p>
                            <div className="panel-type-card__footer">
                                <span><i className="material-icons-round">category</i>{categoryList.length} kategori</span>
                                <span><i className="material-icons-round">arrow_forward</i>Linkleri Gör</span>
                            </div>
                        </button>

                        <button className="panel-type-card" style={{ borderColor: '#ec4899', background: 'linear-gradient(135deg,#fdf2f8,#fce7f3)' }} onClick={() => setSelectedPanel('a')}>
                            <div className="panel-type-card__icon" style={{ background: '#fce7f3', color: '#db2777' }}>
                                <i className="material-icons-round">palette</i>
                            </div>
                            <div className="panel-type-card__badge" style={{ background: '#ec4899' }}>A</div>
                            <h3 className="panel-type-card__title">A-Panel</h3>
                            <p className="panel-type-card__subtitle">Artistlik Hakemler</p>
                            <p className="panel-type-card__desc">Artistlik kesinti (A-Score) girişi. Top ve Kurdele için 4 hakem paneli (A1–A4) QR kodları.</p>
                            <div className="panel-type-card__footer">
                                <span><i className="material-icons-round">groups</i>4 hakem / alet</span>
                                <span><i className="material-icons-round">arrow_forward</i>QR Kodları Gör</span>
                            </div>
                        </button>

                        <button className="panel-type-card panel-type-card--e" onClick={() => setSelectedPanel('e')}>
                            <div className="panel-type-card__icon">
                                <i className="material-icons-round">sports_score</i>
                            </div>
                            <div className="panel-type-card__badge">E</div>
                            <h3 className="panel-type-card__title">E-Panel</h3>
                            <p className="panel-type-card__subtitle">İcra Hakemler</p>
                            <p className="panel-type-card__desc">İcra kesinti (E-Score) girişi. Top ve Kurdele için 4 hakem paneli (E1–E4) QR kodları.</p>
                            <div className="panel-type-card__footer">
                                <span><i className="material-icons-round">groups</i>4 hakem / alet</span>
                                <span><i className="material-icons-round">arrow_forward</i>QR Kodları Gör</span>
                            </div>
                        </button>
                    </>
                ) : (
                    <>
                        {/* D Panel Card — sadece alet gerektiren disiplinlerde (artistik) */}
                        {hasApparatus && (
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
                        )}

                        {/* E Panel Card */}
                        <button className="panel-type-card panel-type-card--e" onClick={() => setSelectedPanel('e')}>
                            <div className="panel-type-card__icon">
                                <i className="material-icons-round">sports_score</i>
                            </div>
                            <div className="panel-type-card__badge">E</div>
                            <h3 className="panel-type-card__title">E-Panel</h3>
                            <p className="panel-type-card__subtitle">Uygulama Hakemleri</p>
                            <p className="panel-type-card__desc">
                                {hasApparatus
                                    ? 'Uygulama kesintileri (E-Score) girişi. Her alet için 4 hakem paneli (E1–E4) QR kodları'
                                    : 'Uygulama kesintileri (E-Score) girişi. Her kategori için 4 hakem paneli (E1–E4) QR kodları'}
                            </p>
                            <div className="panel-type-card__footer">
                                <span><i className="material-icons-round">groups</i>4 hakem / {hasApparatus ? 'alet' : 'kategori'}</span>
                                <span><i className="material-icons-round">arrow_forward</i>QR Kodları Gör</span>
                            </div>
                        </button>
                    </>
                )}
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

    // Ritmik Puanlama Linkleri (DA + DB başhakem paneli)
    const renderRitmikScoringContent = () => (
        <div className="categories-container">
            {filteredCategories.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-state__icon"><i className="material-icons-round">qr_code</i></div>
                    <p>Henüz kategori tanımlanmamış</p>
                </div>
            ) : (
                filteredCategories.map(cat => {
                    const url = getRitmikScoringUrl(cat.id);
                    const cardId = `scoring-${cat.id}`;
                    return (
                        <div className="category-section" key={cat.id}>
                            <div className="category-section__header" style={{ cursor: 'default' }}>
                                <div className="category-section__title-group">
                                    <i className="material-icons-round category-section__icon">self_improvement</i>
                                    <h3 className="category-section__title">{cat.name}</h3>
                                    <span className="category-section__badge">DA · DB</span>
                                </div>
                            </div>
                            <div className="category-section__content">
                                <div className="d-panel-row">
                                    <div className="d-panel-row__info">
                                        <span className="d-panel-row__badge">D</span>
                                        <div className="d-panel-row__text">
                                            <span className="d-panel-row__alet">DA + DB Puanlama</span>
                                            <span className="d-panel-row__cat">{cat.name} · Top &amp; Kurdele</span>
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
                            </div>
                        </div>
                    );
                })
            )}
        </div>
    );

    // Ritmik A veya E Panel QR Kartları (per apparatus)
    const renderRitmikPanelContent = (pType) => {
        const ids = pType === 'a' ? aPanelIds : panelIds;
        const getUrl = pType === 'a' ? getRitmikAPanelUrl : getRitmikEPanelUrl;
        const panelLabel = pType === 'a' ? 'A' : 'E';
        return (
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
                                    <i className="material-icons-round category-section__icon">self_improvement</i>
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
                                                {ids.map(pid => {
                                                    const url = getUrl(cat.id, alet.id, pid);
                                                    const cardId = `${cat.id}-${alet.id}-${pid}`;
                                                    return (
                                                        <div className="panel-card printable-card" key={pid}>
                                                            <div className="panel-card__badge-row">
                                                                <span className="panel-card__badge">{pid.toUpperCase()}</span>
                                                                <span className="panel-card__meta">{cat.name}</span>
                                                            </div>
                                                            <div className="panel-card__alet">{alet.name} · {panelLabel === 'A' ? 'Artistlik' : 'İcra'}</div>
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
                                                            <div className="panel-card__print-label print-only">Okut &amp; Puanla</div>
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
    };

    // E Panel QR Kartları
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
                                {hasApparatus && (
                                    <span className="category-section__badge">{cat.aletler.length} alet</span>
                                )}
                            </div>
                            <button className="category-section__toggle">
                                <i className="material-icons-round">{expandedCats[cat.id] ? 'expand_less' : 'expand_more'}</i>
                            </button>
                        </div>
                        {expandedCats[cat.id] && (
                            <div className="category-section__content">
                                {hasApparatus ? (
                                    /* Alet gerektiren disiplin (artistik): alet → hakem QR */
                                    cat.aletler.map(alet => (
                                        <div className="apparatus-group" key={alet.id}>
                                            <div className="apparatus-group__header">
                                                <span className="apparatus-group__name">{alet.name}</span>
                                                <div className="apparatus-group__line"></div>
                                            </div>
                                            <div className="panels-grid">
                                                {panelIds.map(pid => {
                                                    const url = `${baseUrl}${routePrefix}/epanel?competitionId=${selectedCompId}&catId=${cat.id}&aletId=${alet.id}&panelId=${pid}${epanelToken ? `&token=${epanelToken}` : ''}`;
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
                                    ))
                                ) : (
                                    /* Aletsiz disiplin (aerobik, trampolin, parkur, ritmik): doğrudan hakem QR */
                                    <div className="panels-grid">
                                        {panelIds.map(pid => {
                                            const url = `${baseUrl}${routePrefix}/epanel?competitionId=${selectedCompId}&catId=${cat.id}&panelId=${pid}${epanelToken ? `&token=${epanelToken}` : ''}`;
                                            const cardId = `${cat.id}-${pid}`;
                                            return (
                                                <div className="panel-card printable-card" key={pid}>
                                                    <div className="panel-card__badge-row">
                                                        <span className="panel-card__badge">{pid.toUpperCase()}</span>
                                                        <span className="panel-card__meta">{cat.name}</span>
                                                    </div>
                                                    <div className="panel-card__alet">{cat.name}</div>
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
                                )}
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
                    <button className="back-btn" onClick={() => navigate(routePrefix)}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div>
                        <h1 className="page-title">QR ve Link Panosu</h1>
                        <p className="page-subtitle">Hakem paneli QR kodları ve erişim linkleri</p>
                    </div>
                </div>
                <div className="page-header__right">
                    <div className="header-select-wrapper">
                        <i className="material-icons-round header-select-icon">location_city</i>
                        <select
                            className="header-select"
                            value={selectedCity}
                            onChange={(e) => { setSelectedCity(e.target.value); setSelectedCompId(''); setSelectedPanel(null); }}
                        >
                            <option value="">Tüm İller</option>
                            {availableCities.map(city => (
                                <option key={city} value={city}>{city}</option>
                            ))}
                        </select>
                    </div>
                    <div className="header-select-wrapper">
                        <i className="material-icons-round header-select-icon">emoji_events</i>
                        <select
                            className="header-select"
                            value={selectedCompId}
                            onChange={(e) => setSelectedCompId(e.target.value)}
                        >
                            {filteredCompetitions.map(c => (
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
                                    <i className="material-icons-round">
                                        {selectedPanel === 'd' ? 'gavel'
                                            : selectedPanel === 'scoring' ? 'gavel'
                                            : selectedPanel === 'a' ? 'palette'
                                            : 'sports_score'}
                                    </i>
                                    {selectedPanel === 'd' ? 'D-Panel'
                                        : selectedPanel === 'scoring' ? 'DA+DB'
                                        : selectedPanel === 'a' ? 'A-Panel'
                                        : 'E-Panel'}
                                </div>
                                <h2 className="links-toolbar__title">
                                    {selectedPanel === 'd' ? 'Başhakem Paneli Linkleri'
                                        : selectedPanel === 'scoring' ? 'Puanlama Paneli Linkleri (DA + DB)'
                                        : selectedPanel === 'a' ? 'Artistlik Hakem Kartları (A1–A4)'
                                        : 'İcra Hakem Kartları (E1–E4)'}
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
                        {selectedPanel === 'd' ? renderDPanelContent()
                            : selectedPanel === 'scoring' ? renderRitmikScoringContent()
                            : selectedPanel === 'a' ? renderRitmikPanelContent('a')
                            : isRitmik ? renderRitmikPanelContent('e')
                            : renderEPanelContent()}
                    </>
                )}
            </div>
        </div>
    );
}
