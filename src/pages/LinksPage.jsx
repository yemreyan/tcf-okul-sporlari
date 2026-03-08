import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../lib/firebase';
import QRCode from 'react-qr-code';
import './LinksPage.css';

export default function LinksPage() {
    const navigate = useNavigate();
    const [competitions, setCompetitions] = useState([]);
    const [selectedCompId, setSelectedCompId] = useState('');
    const [competitionData, setCompetitionData] = useState(null);
    const [baseUrl, setBaseUrl] = useState('');

    useEffect(() => {
        // Compute base URL dynamically based on where the app is hosted
        const currentUrl = window.location.href;
        const parsedUrl = new URL(currentUrl);
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
                    .filter(c => !c.arsiv) // Sadece aktif olanları göster
                    .sort((a, b) => new Date(b.tarih) - new Date(a.tarih));

                setCompetitions(compsList);
                if (compsList.length > 0 && !selectedCompId) {
                    setSelectedCompId(compsList[0].id);
                }
            } else {
                setCompetitions([]);
            }
        });

        return () => unsubscribe();
    }, [selectedCompId]);

    // Fetch details of selected competition
    useEffect(() => {
        if (!selectedCompId) {
            setCompetitionData(null);
            return;
        }

        const compRef = ref(db, `competitions/${selectedCompId}`);
        const unsubscribe = onValue(compRef, (snapshot) => {
            setCompetitionData(snapshot.val());
        });

        return () => unsubscribe();
    }, [selectedCompId]);


    // Handlers for printing
    const handlePrintScoreboard = () => {
        window.print();
        // Standard print flow handled by browser + CSS @media print
    };


    if (!competitionData) {
        return (
            <div className="links-page premium-layout">
                <header className="page-header--bento premium-header">
                    <div className="page-header__left">
                        <button className="back-btn back-btn--light" onClick={() => navigate('/')}>
                            <i className="material-icons-round">arrow_back</i>
                        </button>
                        <div className="header-title-wrapper">
                            <h1 className="page-title text-white">QR ve Link Panosu</h1>
                            <p className="page-subtitle text-white-50">Sistem linkleri ve Hakem paneli QR kodları</p>
                        </div>
                    </div>
                </header>
                <div className="loading-state"><div className="spinner"></div><p>Yükleniyor...</p></div>
            </div>
        );
    }

    // Prepare E-Panel links for all selected categories and apparatuses
    const categories = competitionData.kategoriler || {};
    const ePanels = [];

    // TCF standard says up to E4 for most panels, we'll generate E1-E4 by default.
    const panelIds = ['e1', 'e2', 'e3', 'e4'];

    Object.keys(categories).forEach(catId => {
        const cat = categories[catId];
        const aletler = cat.aletler || [];

        aletler.forEach(alet => {
            panelIds.forEach(panelId => {
                const url = `${baseUrl}/epanel?competitionId=${selectedCompId}&catId=${catId}&aletId=${alet.id}&panelId=${panelId}`;
                ePanels.push({
                    catName: cat.name,
                    aletName: alet.name,
                    panelId: panelId.toUpperCase(),
                    url: url
                });
            });
        });
    });

    const scoreboardUrl = `${baseUrl}/scoreboard`;

    return (
        <div className="links-page premium-layout no-print-bg">
            <header className="page-header--bento premium-header no-print">
                <div className="page-header__left">
                    <button className="back-btn back-btn--light" onClick={() => navigate('/')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div className="header-title-wrapper">
                        <h1 className="page-title text-white">QR ve Link Panosu</h1>
                        <p className="page-subtitle text-white-50">Sahadaki hakemler ve seyirciler için erişim linkleri.</p>
                    </div>
                </div>

                <div className="page-header__actions">
                    <div className="filter-group">
                        <i className="material-icons-round text-white-50">emoji_events</i>
                        <select
                            className="select-glass"
                            value={selectedCompId}
                            onChange={(e) => setSelectedCompId(e.target.value)}
                        >
                            {competitions.map(c => (
                                <option key={c.id} value={c.id}>{c.isim}</option>
                            ))}
                        </select>
                    </div>
                    <button className="btn btn-primary" onClick={handlePrintScoreboard}>
                        <i className="material-icons-round">print</i> Yazdır (A4)
                    </button>
                </div>
            </header>

            <main className="premium-main-content">
                <div className="links-container">

                    {/* Public Links Section (Scoreboard) */}
                    <div className="links-section glass-panel">
                        <h2 className="section-title"><i className="material-icons-round">live_tv</i> Seyirci & Canlı Skor Ekranı</h2>
                        <p className="section-desc">Bu kodu taratarak veya linke tıklayarak seyirciler anlık skorları takip edebilir.</p>

                        <div className="qr-card main-qr">
                            <div className="qr-box">
                                <QRCode value={scoreboardUrl} size={150} level="M" />
                            </div>
                            <div className="qr-info">
                                <h3 className="qr-title">Canlı Skorboard Eğriseli</h3>
                                <div className="url-box">
                                    <code>{scoreboardUrl}</code>
                                    <button className="btn-icon" onClick={() => navigator.clipboard.writeText(scoreboardUrl)} title="Kopyala">
                                        <i className="material-icons-round">content_copy</i>
                                    </button>
                                </div>
                                <a href={scoreboardUrl} target="_blank" rel="noreferrer" className="btn btn-secondary mt-3 inline-flex">
                                    <i className="material-icons-round">open_in_new</i> Ekranı Aç
                                </a>
                            </div>
                        </div>
                    </div>

                    {/* E-Panel QR Grid (For Printing) */}
                    <div className="links-section glass-panel">
                        <div className="section-header-flex">
                            <div>
                                <h2 className="section-title"><i className="material-icons-round">qr_code_scanner</i> Hakem (E-Panel) Giriş Kartları</h2>
                                <p className="section-desc">Aşağıdaki QR kodları A4'e yazdırıp hakem masalarına yerleştirin. Hakemler tabletlerinden taratarak direkt kendi panellerine şifresiz giriş yapabilirler.</p>
                            </div>
                            <div className="print-hint no-print">
                                <span className="badge badge-info"><i className="material-icons-round text-sm mr-1">info</i> Yazdırma için optimize edilmiştir</span>
                            </div>
                        </div>

                        <div className="qr-grid" id="printable-qr-grid">
                            {ePanels.map((panel, idx) => (
                                <div className="qr-card small-qr printable-card" key={idx}>
                                    <div className="qr-card-header">
                                        <div className="panel-badge">{panel.panelId}</div>
                                        <div className="cat-info">
                                            <div className="cat-name">{panel.catName}</div>
                                            <div className="alet-name text-primary-500 font-bold">{panel.aletName}</div>
                                        </div>
                                    </div>
                                    <div className="qr-box-small">
                                        <QRCode value={panel.url} size={110} level="M" />
                                    </div>
                                    <div className="qr-footer">
                                        <span>Okut & Puanla</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                </div>
            </main>
        </div>
    );
}
