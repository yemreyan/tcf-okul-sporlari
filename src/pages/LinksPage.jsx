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
    const isAerobik = disciplineId === 'aerobik';
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

    // Auto-select KALDIRILDI — kullanıcı açıkça yarışma seçmeli

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
        // Firebase'de aletler array, object veya undefined olabilir → normalize
        let rawAletler = cat.aletler;
        if (!rawAletler) {
            rawAletler = [];
        } else if (!Array.isArray(rawAletler) && typeof rawAletler === 'object') {
            // Object format → keys'i dön
            rawAletler = Object.keys(rawAletler);
        }
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
                if (typeof a === 'object' && a !== null) {
                    return a.id ? a : { id: a.value || a.key, name: a.name || a.label };
                }
                return { id: String(a), name: String(a) };
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

    // Ritmik A-Panel URL'i (Artistlik hakem) — aletId opsiyonel; verilmezse alet bağımsız tek QR
    const getRitmikAPanelUrl = (catId, aletId, pid) => {
        const aletParam = aletId ? `&aletId=${aletId}` : '';
        return `${baseUrl}${routePrefix}/epanel?competitionId=${selectedCompId}&catId=${catId}${aletParam}&panelId=${pid}&panelType=a${epanelToken ? `&token=${epanelToken}` : ''}`;
    };

    // Ritmik E-Panel URL'i (İcra hakem) — aletId opsiyonel
    const getRitmikEPanelUrl = (catId, aletId, pid) => {
        const aletParam = aletId ? `&aletId=${aletId}` : '';
        return `${baseUrl}${routePrefix}/epanel?competitionId=${selectedCompId}&catId=${catId}${aletParam}&panelId=${pid}&panelType=e${epanelToken ? `&token=${epanelToken}` : ''}`;
    };

    // Ritmik DA/DB Panel URL'i (Zorluk hakemi) — aletId opsiyonel
    const getRitmikDPanelUrl = (catId, aletId, panelType) => {
        const aletParam = aletId ? `&aletId=${aletId}` : '';
        return `${baseUrl}${routePrefix}/dpanel?competitionId=${selectedCompId}&catId=${catId}${aletParam}&panelType=${panelType}${epanelToken ? `&token=${epanelToken}` : ''}`;
    };

    // Ritmik Çizgi Hakemi URL'i (L1 / L2) — alet zorunlu (top/kurdele ayrı QR)
    // aletId verilmezse alet bağımsız (eski davranış)
    const getRitmikLPanelUrl = (catId, aletId, panelType /* 'cizgi1' | 'cizgi2' */) => {
        const aletParam = aletId ? `&aletId=${aletId}` : '';
        return `${baseUrl}${routePrefix}/lpanel?competitionId=${selectedCompId}&catId=${catId}${aletParam}&panelType=${panelType}${epanelToken ? `&token=${epanelToken}` : ''}`;
    };

    // Ritmik Zaman Hakemi URL'i — alet zorunlu (top/kurdele ayrı QR)
    const getRitmikTPanelUrl = (catId, aletId) => {
        const aletParam = aletId ? `&aletId=${aletId}` : '';
        return `${baseUrl}${routePrefix}/tpanel?competitionId=${selectedCompId}&catId=${catId}${aletParam}${epanelToken ? `&token=${epanelToken}` : ''}`;
    };

    // Aerobik panel URL'leri
    const getAerobikEPanelUrl = (catId, pid) =>
        `${baseUrl}${routePrefix}/epanel?competitionId=${selectedCompId}&catId=${catId}&panelId=${pid}${epanelToken ? `&token=${epanelToken}` : ''}`;
    const getAerobikAPanelUrl = (catId, pid) =>
        `${baseUrl}${routePrefix}/apanel?competitionId=${selectedCompId}&catId=${catId}&panelId=${pid}${epanelToken ? `&token=${epanelToken}` : ''}`;
    const getAerobikDPanelUrl = (catId) =>
        `${baseUrl}${routePrefix}/dpanel?competitionId=${selectedCompId}&catId=${catId}${epanelToken ? `&token=${epanelToken}` : ''}`;
    const getAerobikTPanelUrl = (catId) =>
        `${baseUrl}${routePrefix}/tpanel?competitionId=${selectedCompId}&catId=${catId}${epanelToken ? `&token=${epanelToken}` : ''}`;
    const getAerobikLPanelUrl = (catId) =>
        `${baseUrl}${routePrefix}/lpanel?competitionId=${selectedCompId}&catId=${catId}${epanelToken ? `&token=${epanelToken}` : ''}`;

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
        } else if (selectedPanel === 'ritmik-l') {
            allLinks += `=== L-PANEL LİNKLERİ (ÇİZGİ HAKEMLERİ — Top + Kurdele Tek QR) ===\n\n`;
            filteredCategories.forEach(cat => {
                allLinks += `${cat.name} | L1: ${getRitmikLPanelUrl(cat.id, null, 'cizgi1')}\n`;
                allLinks += `${cat.name} | L2: ${getRitmikLPanelUrl(cat.id, null, 'cizgi2')}\n`;
            });
        } else if (selectedPanel === 'ritmik-t') {
            allLinks += `=== T-PANEL LİNKLERİ (ZAMAN HAKEMİ — Top + Kurdele Tek QR) ===\n\n`;
            filteredCategories.forEach(cat => {
                allLinks += `${cat.name} | T: ${getRitmikTPanelUrl(cat.id, null)}\n`;
            });
        } else if (selectedPanel === 'a') {
            allLinks += `=== A-PANEL LİNKLERİ (ARTİSTLİK — Top + Kurdele Tek QR) ===\n\n`;
            filteredCategories.forEach(cat => {
                allLinks += `--- ${cat.name} ---\n`;
                aPanelIds.forEach(pid => {
                    allLinks += `${cat.name} | ${pid.toUpperCase()}: ${getRitmikAPanelUrl(cat.id, null, pid)}\n`;
                });
                allLinks += `${cat.name} | SJA: ${getRitmikDPanelUrl(cat.id, null, 'sja')}\n\n`;
            });
        } else if (selectedPanel === 'e') {
            allLinks += `=== E-PANEL LİNKLERİ ===\n\n`;
            filteredCategories.forEach(cat => {
                allLinks += `--- ${cat.name} ---\n`;
                if (isRitmik) {
                    panelIds.forEach(pid => {
                        allLinks += `${cat.name} | ${pid.toUpperCase()}: ${getRitmikEPanelUrl(cat.id, null, pid)}\n`;
                    });
                    allLinks += `${cat.name} | SJE: ${getRitmikDPanelUrl(cat.id, null, 'sje')}\n`;
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
                            <p className="panel-type-card__desc">Artistlik kesinti (A-Score) girişi. Top ve Kurdele için hakem panelleri: A1 · A2 · A3 · A4 · SJA QR kodları.</p>
                            <div className="panel-type-card__footer">
                                <span><i className="material-icons-round">groups</i>5 panel / alet</span>
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
                            <p className="panel-type-card__desc">İcra kesinti (E-Score) girişi. Top ve Kurdele için hakem panelleri: E1 · E2 · E3 · E4 · SJE QR kodları.</p>
                            <div className="panel-type-card__footer">
                                <span><i className="material-icons-round">groups</i>5 panel / alet</span>
                                <span><i className="material-icons-round">arrow_forward</i>QR Kodları Gör</span>
                            </div>
                        </button>

                        <button className="panel-type-card" style={{ borderColor: '#7c3aed', background: 'linear-gradient(135deg,#f5f3ff,#ede9fe)' }} onClick={() => setSelectedPanel('dp')}>
                            <div className="panel-type-card__icon" style={{ background: '#ede9fe', color: '#6d28d9' }}>
                                <i className="material-icons-round">calculate</i>
                            </div>
                            <div className="panel-type-card__badge" style={{ background: '#7c3aed' }}>D</div>
                            <h3 className="panel-type-card__title">DA/DB Panel</h3>
                            <p className="panel-type-card__subtitle">Zorluk Hakemler</p>
                            <p className="panel-type-card__desc">Alet (DA) ve Vücut (DB) zorluk girişi. Her alet için ayrı ayrı: SJDA · DA1 (Kesin+Not) · DA2 ve SJDB · DB1 (Kesin+Not) · DB2 QR kodları.</p>
                            <div className="panel-type-card__footer">
                                <span><i className="material-icons-round">groups</i>6 panel / alet</span>
                                <span><i className="material-icons-round">arrow_forward</i>QR Kodları Gör</span>
                            </div>
                        </button>

                        <button className="panel-type-card" style={{ borderColor: '#10b981', background: 'linear-gradient(135deg,#ecfdf5,#d1fae5)' }} onClick={() => setSelectedPanel('ritmik-l')}>
                            <div className="panel-type-card__icon" style={{ background: '#d1fae5', color: '#059669' }}>
                                <i className="material-icons-round">border_outer</i>
                            </div>
                            <div className="panel-type-card__badge" style={{ background: '#10b981' }}>L</div>
                            <h3 className="panel-type-card__title">L-Panel</h3>
                            <p className="panel-type-card__subtitle">Çizgi Hakemleri (L1, L2)</p>
                            <p className="panel-type-card__desc">Çizgi ihlali kesintisi girişi. Her alet için L1 ve L2 hakemlerine ayrı QR kodları (Top × 2 + Kurdele × 2).</p>
                            <div className="panel-type-card__footer">
                                <span><i className="material-icons-round">groups</i>2 hakem / alet</span>
                                <span><i className="material-icons-round">arrow_forward</i>QR Kodları Gör</span>
                            </div>
                        </button>

                        <button className="panel-type-card" style={{ borderColor: '#0ea5e9', background: 'linear-gradient(135deg,#f0f9ff,#e0f2fe)' }} onClick={() => setSelectedPanel('ritmik-t')}>
                            <div className="panel-type-card__icon" style={{ background: '#e0f2fe', color: '#0284c7' }}>
                                <i className="material-icons-round">timer</i>
                            </div>
                            <div className="panel-type-card__badge" style={{ background: '#0ea5e9' }}>T</div>
                            <h3 className="panel-type-card__title">T-Panel</h3>
                            <p className="panel-type-card__subtitle">Zaman Hakemi</p>
                            <p className="panel-type-card__desc">Süre ihlali kesintisi girişi. Her alet için ayrı QR (Top + Kurdele). Hızlı seçim veya manuel kesinti girişi.</p>
                            <div className="panel-type-card__footer">
                                <span><i className="material-icons-round">groups</i>1 hakem / alet</span>
                                <span><i className="material-icons-round">arrow_forward</i>QR Kodları Gör</span>
                            </div>
                        </button>
                    </>
                ) : isAerobik ? (
                    <>
                        {/* Aerobik: E, A, D, T, L panelleri */}
                        <button className="panel-type-card panel-type-card--e" onClick={() => setSelectedPanel('e')}>
                            <div className="panel-type-card__icon"><i className="material-icons-round">sports_score</i></div>
                            <div className="panel-type-card__badge">E</div>
                            <h3 className="panel-type-card__title">E-Panel</h3>
                            <p className="panel-type-card__subtitle">İcra Hakemleri (E1–E4)</p>
                            <p className="panel-type-card__desc">İcra kesintisi girişi. Her kategori için 4 hakem paneli QR kodu.</p>
                            <div className="panel-type-card__footer">
                                <span><i className="material-icons-round">groups</i>4 hakem / kategori</span>
                                <span><i className="material-icons-round">arrow_forward</i>QR Kodları Gör</span>
                            </div>
                        </button>

                        <button className="panel-type-card" style={{ borderColor: '#f59e0b', background: 'linear-gradient(135deg,#fffbeb,#fef3c7)' }} onClick={() => setSelectedPanel('aerobik-a')}>
                            <div className="panel-type-card__icon" style={{ background: '#fef3c7', color: '#d97706' }}><i className="material-icons-round">palette</i></div>
                            <div className="panel-type-card__badge" style={{ background: '#f59e0b' }}>A</div>
                            <h3 className="panel-type-card__title">A-Panel</h3>
                            <p className="panel-type-card__subtitle">Artistik Hakemleri (A1–A4)</p>
                            <p className="panel-type-card__desc">5 kriter × ölçek grid (1.0–2.0) + kesinti girişi. Her kategori için 4 hakem QR kodu.</p>
                            <div className="panel-type-card__footer">
                                <span><i className="material-icons-round">groups</i>4 hakem / kategori</span>
                                <span><i className="material-icons-round">arrow_forward</i>QR Kodları Gör</span>
                            </div>
                        </button>

                        <button className="panel-type-card panel-type-card--d" onClick={() => setSelectedPanel('aerobik-d')}>
                            <div className="panel-type-card__icon"><i className="material-icons-round">calculate</i></div>
                            <div className="panel-type-card__badge">D</div>
                            <h3 className="panel-type-card__title">D-Panel</h3>
                            <p className="panel-type-card__subtitle">Zorluk Hakemi</p>
                            <p className="panel-type-card__desc">Element slot girişi (E1–E8 + C). Her kategori için tek D-hakem QR kodu.</p>
                            <div className="panel-type-card__footer">
                                <span><i className="material-icons-round">category</i>{categoryList.length} kategori</span>
                                <span><i className="material-icons-round">arrow_forward</i>QR Kodları Gör</span>
                            </div>
                        </button>

                        <button className="panel-type-card" style={{ borderColor: '#06b6d4', background: 'linear-gradient(135deg,#ecfeff,#cffafe)' }} onClick={() => setSelectedPanel('aerobik-t')}>
                            <div className="panel-type-card__icon" style={{ background: '#cffafe', color: '#0891b2' }}><i className="material-icons-round">timer</i></div>
                            <div className="panel-type-card__badge" style={{ background: '#06b6d4' }}>T</div>
                            <h3 className="panel-type-card__title">T-Panel</h3>
                            <p className="panel-type-card__subtitle">Süre Hakemi</p>
                            <p className="panel-type-card__desc">Canlı kronometre, kesinti süresi ve geç çıkış kesintisi girişi.</p>
                            <div className="panel-type-card__footer">
                                <span><i className="material-icons-round">category</i>{categoryList.length} kategori</span>
                                <span><i className="material-icons-round">arrow_forward</i>QR Kodları Gör</span>
                            </div>
                        </button>

                        <button className="panel-type-card" style={{ borderColor: '#10b981', background: 'linear-gradient(135deg,#ecfdf5,#d1fae5)' }} onClick={() => setSelectedPanel('aerobik-l')}>
                            <div className="panel-type-card__icon" style={{ background: '#d1fae5', color: '#059669' }}><i className="material-icons-round">border_outer</i></div>
                            <div className="panel-type-card__badge" style={{ background: '#10b981' }}>L</div>
                            <h3 className="panel-type-card__title">L-Panel</h3>
                            <p className="panel-type-card__subtitle">Çizgi Hakemi</p>
                            <p className="panel-type-card__desc">Alan ihlali sayacı (×0.1/ihlal). Her kategori için tek L-hakem QR kodu.</p>
                            <div className="panel-type-card__footer">
                                <span><i className="material-icons-round">category</i>{categoryList.length} kategori</span>
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

    // Ritmik DA/DB Panel QR Kartları — her alet için 6 ayrı panel
    const DA_PANELS = [
        { type: 'sjda', label: 'SJDA', desc: 'SJ · Alet Ref',  color: '#6b7280' },
        { type: 'da1',  label: 'DA1',  desc: 'DA1 + Kesin',    color: '#7c3aed' },
        { type: 'da2',  label: 'DA2',  desc: 'DA2 Notu',       color: '#7c3aed' },
    ];
    const DB_PANELS = [
        { type: 'sjdb', label: 'SJDB', desc: 'SJ · Vücut Ref', color: '#6b7280' },
        { type: 'db1',  label: 'DB1',  desc: 'DB1 + Kesin',    color: '#4f46e5' },
        { type: 'db2',  label: 'DB2',  desc: 'DB2 Notu',       color: '#4f46e5' },
    ];

    const renderRitmikDPanelContent = () => (
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
                                {/* Top ve Kurdele için ayrı QR setleri */}
                                {cat.aletler.map(alet => (
                                    <div className="apparatus-group" key={alet.id}>
                                        <div className="apparatus-group__header">
                                            <span className="apparatus-group__name">{alet.name}</span>
                                            <div className="apparatus-group__line"></div>
                                        </div>

                                        {/* DA Grubu */}
                                        <div className="dp-group-label">
                                            <span className="dp-group-label__text" style={{ color: '#7c3aed' }}>
                                                <i className="material-icons-round" style={{ fontSize: 14 }}>calculate</i> Alet Zorluğu (DA)
                                            </span>
                                        </div>
                                        <div className="panels-grid">
                                            {DA_PANELS.map(({ type, label, desc, color }) => {
                                                const url    = getRitmikDPanelUrl(cat.id, alet.id, type);
                                                const cardId = `${cat.id}-${alet.id}-${type}`;
                                                return (
                                                    <div className="panel-card printable-card" key={type}>
                                                        <div className="panel-card__badge-row">
                                                            <span className="panel-card__badge" style={{ background: color }}>{label}</span>
                                                            <span className="panel-card__meta">{cat.name}</span>
                                                        </div>
                                                        <div className="panel-card__alet">{alet.name} · {desc}</div>
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

                                        {/* DB Grubu */}
                                        <div className="dp-group-label">
                                            <span className="dp-group-label__text" style={{ color: '#4f46e5' }}>
                                                <i className="material-icons-round" style={{ fontSize: 14 }}>fitness_center</i> Vücut Zorluğu (DB)
                                            </span>
                                        </div>
                                        <div className="panels-grid">
                                            {DB_PANELS.map(({ type, label, desc, color }) => {
                                                const url    = getRitmikDPanelUrl(cat.id, alet.id, type);
                                                const cardId = `${cat.id}-${alet.id}-${type}`;
                                                return (
                                                    <div className="panel-card printable-card" key={type}>
                                                        <div className="panel-card__badge-row">
                                                            <span className="panel-card__badge" style={{ background: color }}>{label}</span>
                                                            <span className="panel-card__meta">{cat.name}</span>
                                                        </div>
                                                        <div className="panel-card__alet">{alet.name} · {desc}</div>
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
                    // Sadece Başhakem (DA+DB) — L1, L2, T ayrı panel kartlarında
                    const panelRows = [
                        {
                            id: `scoring-${cat.id}`,
                            badge: 'D',
                            title: 'DA + DB Puanlama (Başhakem)',
                            sub: 'Top & Kurdele · Tek panel',
                            url: getRitmikScoringUrl(cat.id),
                            badgeColor: '#7c3aed',
                        },
                    ];

                    return (
                        <div className="category-section" key={cat.id}>
                            <div className="category-section__header" style={{ cursor: 'default' }}>
                                <div className="category-section__title-group">
                                    <i className="material-icons-round category-section__icon">self_improvement</i>
                                    <h3 className="category-section__title">{cat.name}</h3>
                                    <span className="category-section__badge">D · L · T</span>
                                </div>
                            </div>
                            <div className="category-section__content">
                                {panelRows.map(row => (
                                    <div className="d-panel-row" key={row.id}>
                                        <div className="d-panel-row__info">
                                            <span className="d-panel-row__badge" style={{ background: row.badgeColor }}>{row.badge}</span>
                                            <div className="d-panel-row__text">
                                                <span className="d-panel-row__alet">{row.title}</span>
                                                <span className="d-panel-row__cat">{cat.name} · {row.sub}</span>
                                            </div>
                                        </div>
                                        <div className="d-panel-row__qr">
                                            <QRCode value={row.url} size={80} level="M" />
                                        </div>
                                        <div className="d-panel-row__actions">
                                            <button
                                                className={`panel-action ${copiedId === row.id ? 'panel-action--copied' : ''}`}
                                                onClick={() => copyToClipboard(row.url, row.id)}
                                                title="Linki kopyala"
                                            >
                                                <i className="material-icons-round">{copiedId === row.id ? 'check' : 'content_copy'}</i>
                                            </button>
                                            <a href={row.url} target="_blank" rel="noreferrer" className="panel-action" title="Yeni sekmede aç">
                                                <i className="material-icons-round">open_in_new</i>
                                            </a>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })
            )}
        </div>
    );

    // Ritmik L (Çizgi) Panel — Alet bağımsız tek QR / hakem (L1, L2)
    const renderRitmikLPanelContent = () => (
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
                                <span className="category-section__badge">2 hakem</span>
                            </div>
                            <button className="category-section__toggle">
                                <i className="material-icons-round">{expandedCats[cat.id] ? 'expand_less' : 'expand_more'}</i>
                            </button>
                        </div>
                        {expandedCats[cat.id] && (
                            <div className="category-section__content">
                                {/* Alet bağımsız: tek QR — aktif aleti dinler */}
                                <div className="apparatus-group">
                                    <div className="apparatus-group__header">
                                        <span className="apparatus-group__name">Top + Kurdele (Tek QR)</span>
                                        <div className="apparatus-group__line"></div>
                                    </div>
                                    <div className="panels-grid">
                                        {[
                                            { type: 'cizgi1', label: 'L1', desc: 'Çizgi Hakemi 1' },
                                            { type: 'cizgi2', label: 'L2', desc: 'Çizgi Hakemi 2' },
                                        ].map(({ type, label, desc }) => {
                                            const url    = getRitmikLPanelUrl(cat.id, null, type);
                                            const cardId = `lpanel-${cat.id}-all-${type}`;
                                            return (
                                                <div className="panel-card printable-card" key={type}>
                                                    <div className="panel-card__badge-row">
                                                        <span className="panel-card__badge" style={{ background: '#10b981' }}>{label}</span>
                                                        <span className="panel-card__meta">{cat.name}</span>
                                                    </div>
                                                    <div className="panel-card__alet">Aktif aleti otomatik takip eder · {desc}</div>
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
                            </div>
                        )}
                    </div>
                ))
            )}
        </div>
    );

    // Ritmik T (Zaman) Panel — Alet bağımsız tek QR / kategori
    const renderRitmikTPanelContent = () => (
        <div className="categories-container">
            {filteredCategories.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-state__icon"><i className="material-icons-round">qr_code</i></div>
                    <p>Henüz kategori tanımlanmamış</p>
                </div>
            ) : (
                filteredCategories.map(cat => {
                    const url    = getRitmikTPanelUrl(cat.id, null);
                    const cardId = `tpanel-${cat.id}-all`;
                    return (
                        <div className="category-section" key={cat.id}>
                            <div className="category-section__header" style={{ cursor: 'default' }}>
                                <div className="category-section__title-group">
                                    <i className="material-icons-round category-section__icon">self_improvement</i>
                                    <h3 className="category-section__title">{cat.name}</h3>
                                    <span className="category-section__badge">1 hakem</span>
                                </div>
                            </div>
                            <div className="category-section__content">
                                <div className="d-panel-row">
                                    <div className="d-panel-row__info">
                                        <span className="d-panel-row__badge" style={{ background: '#0ea5e9' }}>T</span>
                                        <div className="d-panel-row__text">
                                            <span className="d-panel-row__alet">Zaman Hakemi</span>
                                            <span className="d-panel-row__cat">{cat.name} · Aktif aleti otomatik takip eder</span>
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

    // Ritmik A veya E Panel QR Kartları (per apparatus) — A1-A4 + SJA veya E1-E4 + SJE
    const renderRitmikPanelContent = (pType) => {
        const ids        = pType === 'a' ? aPanelIds : panelIds;
        const getUrl     = pType === 'a' ? getRitmikAPanelUrl : getRitmikEPanelUrl;
        const panelLabel = pType === 'a' ? 'A' : 'E';
        const sjType     = pType === 'a' ? 'sja'  : 'sje';
        const sjLabel    = pType === 'a' ? 'SJA'  : 'SJE';
        const sjColor    = pType === 'a' ? '#ec4899' : '#10b981';
        const sjDesc     = pType === 'a' ? 'Artistlik Ref' : 'İcra Ref';

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
                                    {/* Alet bağımsız: aletId=null → her hakem için tek QR (top + kurdele aktif aleti dinler) */}
                                    {(() => {
                                        const sjUrl    = getRitmikDPanelUrl(cat.id, null, sjType);
                                        const sjCardId = `${cat.id}-all-${sjType}`;
                                        return (
                                            <div className="apparatus-group">
                                                <div className="apparatus-group__header">
                                                    <span className="apparatus-group__name">Top + Kurdele (Tek QR)</span>
                                                    <div className="apparatus-group__line"></div>
                                                </div>
                                                <div className="panels-grid">
                                                    {/* A1-A4 / E1-E4 */}
                                                    {ids.map(pid => {
                                                        const url    = getUrl(cat.id, null, pid);
                                                        const cardId = `${cat.id}-all-${pid}`;
                                                        return (
                                                            <div className="panel-card printable-card" key={pid}>
                                                                <div className="panel-card__badge-row">
                                                                    <span className="panel-card__badge">{pid.toUpperCase()}</span>
                                                                    <span className="panel-card__meta">{cat.name}</span>
                                                                </div>
                                                                <div className="panel-card__alet">Aktif aleti otomatik takip eder · {panelLabel === 'A' ? 'Artistlik' : 'İcra'}</div>
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

                                                    {/* SJA / SJE — dpanel route ile */}
                                                    <div className="panel-card printable-card" key={sjType}>
                                                        <div className="panel-card__badge-row">
                                                            <span className="panel-card__badge" style={{ background: sjColor }}>{sjLabel}</span>
                                                            <span className="panel-card__meta">{cat.name}</span>
                                                        </div>
                                                        <div className="panel-card__alet">Aktif aleti otomatik takip eder · {sjDesc}</div>
                                                        <div className="panel-card__qr">
                                                            <QRCode value={sjUrl} size={100} level="M" />
                                                        </div>
                                                        <div className="panel-card__actions no-print">
                                                            <button
                                                                className={`panel-action ${copiedId === sjCardId ? 'panel-action--copied' : ''}`}
                                                                onClick={() => copyToClipboard(sjUrl, sjCardId)}
                                                                title="Linki kopyala"
                                                            >
                                                                <i className="material-icons-round">{copiedId === sjCardId ? 'check' : 'content_copy'}</i>
                                                            </button>
                                                            <a href={sjUrl} target="_blank" rel="noreferrer" className="panel-action" title="Yeni sekmede aç">
                                                                <i className="material-icons-round">open_in_new</i>
                                                            </a>
                                                        </div>
                                                        <div className="panel-card__print-label print-only">Okut &amp; Puanla</div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        );
    };

    // Aerobik — tek QR kart per kategori (D, T, L panelleri)
    const renderAerobikSingleCardPanel = (panelKey, getUrl, badgeLabel, badgeColor, iconName, panelTitle) => (
        <div className="categories-container">
            {filteredCategories.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-state__icon"><i className="material-icons-round">qr_code</i></div>
                    <p>Henüz kategori tanımlanmamış</p>
                </div>
            ) : (
                filteredCategories.map(cat => {
                    const url = getUrl(cat.id);
                    const cardId = `${panelKey}-${cat.id}`;
                    return (
                        <div className="category-section" key={cat.id}>
                            <div className="category-section__header" style={{ cursor: 'default' }}>
                                <div className="category-section__title-group">
                                    <i className="material-icons-round category-section__icon">sports_gymnastics</i>
                                    <h3 className="category-section__title">{cat.name}</h3>
                                    <span className="category-section__badge">{badgeLabel}</span>
                                </div>
                            </div>
                            <div className="category-section__content">
                                <div className="d-panel-row">
                                    <div className="d-panel-row__info">
                                        <span className="d-panel-row__badge" style={{ background: badgeColor }}>{badgeLabel}</span>
                                        <div className="d-panel-row__text">
                                            <span className="d-panel-row__alet">{panelTitle}</span>
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
                            </div>
                        </div>
                    );
                })
            )}
        </div>
    );

    // Aerobik — A-Panel: a1-a4 per kategori
    const aerobikAPanelIds = ['a1', 'a2', 'a3', 'a4'];
    const renderAerobikAPanelContent = () => (
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
                                <span className="category-section__badge">4 hakem</span>
                            </div>
                            <button className="category-section__toggle">
                                <i className="material-icons-round">{expandedCats[cat.id] ? 'expand_less' : 'expand_more'}</i>
                            </button>
                        </div>
                        {expandedCats[cat.id] && (
                            <div className="category-section__content">
                                <div className="panels-grid">
                                    {aerobikAPanelIds.map(pid => {
                                        const url = getAerobikAPanelUrl(cat.id, pid);
                                        const cardId = `${cat.id}-${pid}`;
                                        return (
                                            <div className="panel-card printable-card" key={pid}>
                                                <div className="panel-card__badge-row">
                                                    <span className="panel-card__badge" style={{ background: '#f59e0b' }}>{pid.toUpperCase()}</span>
                                                    <span className="panel-card__meta">{cat.name}</span>
                                                </div>
                                                <div className="panel-card__alet">Artistik · {cat.name}</div>
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
                        )}
                    </div>
                ))
            )}
        </div>
    );

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
                            onChange={(e) => { setSelectedCompId(e.target.value); setSelectedPanel(null); }}
                        >
                            <option value="">— Yarışma Seçin —</option>
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
                {/* Yarışma seçilmeden hiçbir şey gösterme */}
                {!selectedCompId && (
                    <div className="empty-state" style={{ marginTop: 60 }}>
                        <div className="empty-state__icon">
                            <i className="material-icons-round">emoji_events</i>
                        </div>
                        <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Yarışma Seçin</p>
                        <p style={{ color: 'var(--text-secondary, #888)' }}>QR kodları ve hakem linkleri görmek için yukarıdan bir yarışma seçin.</p>
                    </div>
                )}

                {/* Yarışma seçildiyse: Scoreboard + Paneller */}
                {selectedCompId && (<><div className="scoreboard-card">
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
                                            : selectedPanel === 'a' || selectedPanel === 'aerobik-a' ? 'palette'
                                            : selectedPanel === 'dp' || selectedPanel === 'aerobik-d' ? 'calculate'
                                            : selectedPanel === 'ritmik-t' || selectedPanel === 'aerobik-t' ? 'timer'
                                            : selectedPanel === 'ritmik-l' || selectedPanel === 'aerobik-l' ? 'border_outer'
                                            : 'sports_score'}
                                    </i>
                                    {selectedPanel === 'd' ? 'D-Panel'
                                        : selectedPanel === 'scoring' ? 'DA+DB (Başhakem)'
                                        : selectedPanel === 'a' ? 'A-Panel'
                                        : selectedPanel === 'dp' ? 'DA/DB Panel'
                                        : selectedPanel === 'ritmik-l' ? 'L-Panel'
                                        : selectedPanel === 'ritmik-t' ? 'T-Panel'
                                        : selectedPanel === 'aerobik-a' ? 'A-Panel'
                                        : selectedPanel === 'aerobik-d' ? 'D-Panel'
                                        : selectedPanel === 'aerobik-t' ? 'T-Panel'
                                        : selectedPanel === 'aerobik-l' ? 'L-Panel'
                                        : 'E-Panel'}
                                </div>
                                <h2 className="links-toolbar__title">
                                    {selectedPanel === 'd' ? 'Başhakem Paneli Linkleri'
                                        : selectedPanel === 'scoring' ? 'Puanlama Paneli Linkleri (DA + DB) — Başhakem'
                                        : selectedPanel === 'a' ? 'Artistlik Hakem Kartları (A1–A4)'
                                        : selectedPanel === 'dp' ? 'DA/DB Zorluk Hakem Kartları'
                                        : selectedPanel === 'ritmik-l' ? 'Çizgi Hakem Kartları (L1, L2)'
                                        : selectedPanel === 'ritmik-t' ? 'Zaman Hakem Kartları (T)'
                                        : selectedPanel === 'aerobik-a' ? 'Artistik Hakem Kartları (A1–A4)'
                                        : selectedPanel === 'aerobik-d' ? 'Zorluk Hakem Kartı (D)'
                                        : selectedPanel === 'aerobik-t' ? 'Süre Hakem Kartı (T)'
                                        : selectedPanel === 'aerobik-l' ? 'Çizgi Hakem Kartı (L)'
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
                            : selectedPanel === 'dp' ? renderRitmikDPanelContent()
                            : selectedPanel === 'ritmik-l' ? renderRitmikLPanelContent()
                            : selectedPanel === 'ritmik-t' ? renderRitmikTPanelContent()
                            : selectedPanel === 'aerobik-a' ? renderAerobikAPanelContent()
                            : selectedPanel === 'aerobik-d' ? renderAerobikSingleCardPanel('aerobik-d', getAerobikDPanelUrl, 'D', '#6366f1', 'calculate', 'D-Panel (Zorluk Hakemi)')
                            : selectedPanel === 'aerobik-t' ? renderAerobikSingleCardPanel('aerobik-t', getAerobikTPanelUrl, 'T', '#06b6d4', 'timer', 'T-Panel (Süre Hakemi)')
                            : selectedPanel === 'aerobik-l' ? renderAerobikSingleCardPanel('aerobik-l', getAerobikLPanelUrl, 'L', '#10b981', 'border_outer', 'L-Panel (Çizgi Hakemi)')
                            : isRitmik ? renderRitmikPanelContent('e')
                            : renderEPanelContent()}
                    </>
                )}
            </>)}
            </div>
        </div>
    );
}
