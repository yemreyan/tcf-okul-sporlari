import React, { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../lib/firebase';
import './ScoreboardPage.css';

export default function ScoreboardPage() {
    const [competitions, setCompetitions] = useState({});
    const [selectedCompId, setSelectedCompId] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('');

    const [athletes, setAthletes] = useState([]);
    const [allScores, setAllScores] = useState({});

    // UI State
    const [isLive, setIsLive] = useState(false);
    const [viewIndex, setViewIndex] = useState(0);
    const [views, setViews] = useState([]);

    // Flash Overlay State
    const [flashData, setFlashData] = useState(null);
    const [isFlashing, setIsFlashing] = useState(false);

    // Initial Data Fetch
    useEffect(() => {
        const compRef = ref(db, 'competitions');
        const unsubscribe = onValue(compRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                setCompetitions(data);
            }
        });
        return () => unsubscribe();
    }, []);

    // Load detailed data once competition is selected and Go Live is clicked
    const handleGoLive = () => {
        if (!selectedCompId || !selectedCategory) return;
        setIsLive(true);

        // 1. Fetch Athletes
        const athletesRef = ref(db, `competitions/${selectedCompId}/sporcular/${selectedCategory}`);
        onValue(athletesRef, (snap) => {
            const data = snap.val();
            if (data) {
                setAthletes(Object.values(data));
            } else {
                setAthletes([]);
            }
        });

        // 2. Fetch Scores
        const scoresRef = ref(db, `competitions/${selectedCompId}/puanlar/${selectedCategory}`);
        onValue(scoresRef, (snap) => {
            const data = snap.val() || {};
            setAllScores(data);
        });

        // 3. Listen for Flash Triggers
        const flashRef = ref(db, `competitions/${selectedCompId}/flashTrigger`);
        let isInitialLoad = true;

        onValue(flashRef, (snap) => {
            if (isInitialLoad) {
                isInitialLoad = false;
                return;
            }
            const data = snap.val();
            if (data && (Date.now() - data.timestamp < 10000)) {
                triggerFlash(data);
            }
        });

        // Setup Views based on category (Male vs Female)
        const catName = competitions[selectedCompId]?.kategoriler?.[selectedCategory]?.name || '';
        const lowerCatId = selectedCategory.toLowerCase();
        const lowerCatName = catName.toLowerCase();

        const isErkek = lowerCatId.includes('erkek') || lowerCatName.includes('erkek');
        const isKadin = lowerCatId.includes('kadin') || lowerCatId.includes('kiz') || lowerCatName.includes('kadın') || lowerCatName.includes('kız');

        let newViews = [];
        if (isErkek) {
            newViews.push({ type: 'all', title: 'GENEL TASNİF | ERKEKLER', color: '#3b82f6', gender: 'erkek' });
        } else if (isKadin) {
            newViews.push({ type: 'all', title: 'GENEL TASNİF | KIZLAR', color: '#ec4899', gender: 'kadin' });
        } else {
            // Mixed
            newViews.push({ type: 'ind', gender: 'kadin', title: 'GENEL TASNİF | KIZLAR', color: '#ec4899' });
            newViews.push({ type: 'ind', gender: 'erkek', title: 'GENEL TASNİF | ERKEKLER', color: '#3b82f6' });
        }
        newViews.push({ type: 'team', title: 'TAKIM SIRALAMASI', color: '#22c55e' });

        setViews(newViews);
    };

    // Cycle Timer
    useEffect(() => {
        if (!isLive || isFlashing || views.length === 0) return;

        const timer = setInterval(() => {
            setViewIndex(prev => (prev + 1) % views.length);
        }, 12000);

        return () => clearInterval(timer);
    }, [isLive, isFlashing, views]);

    // Enter / Exit Fullscreen
    useEffect(() => {
        if (isLive) {
            if (document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen().catch((err) => {
                    console.log(`Error attempting to enable full-screen mode: ${err.message}`);
                });
            }
        }
    }, [isLive]);

    const exitLiveMode = () => {
        setIsLive(false);
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(err => console.log(err));
        }
    };

    const triggerFlash = (data) => {
        setFlashData(data);
        setIsFlashing(true);
        setTimeout(() => {
            setIsFlashing(false);
            setFlashData(null);
        }, 5000); // Hide after 5 seconds
    };

    // Configuration View
    if (!isLive) {
        return (
            <div className="scoreboard-config page-container">
                <div className="config-card neon-panel">
                    <div className="cc-icon cyber-gradient">
                        <i className="material-icons-round">live_tv</i>
                    </div>
                    <h2>Seyirci Ekranı (Canlı Skor)</h2>
                    <p className="text-cyber">Seyirciler için dev ekran modunu başlat</p>

                    <div className="config-form">
                        <div className="input-group">
                            <label>Yarışma Seçin</label>
                            <select
                                className="cyber-input"
                                value={selectedCompId}
                                onChange={e => { setSelectedCompId(e.target.value); setSelectedCategory(''); }}
                            >
                                <option value="">-- Yarışma Seçiniz --</option>
                                {Object.entries(competitions).map(([id, comp]) => (
                                    <option key={id} value={id}>{comp.isim}</option>
                                ))}
                            </select>
                        </div>

                        {selectedCompId && competitions[selectedCompId]?.kategoriler && (
                            <div className="input-group slide-in">
                                <label>Kategori Seçin</label>
                                <select
                                    className="cyber-input"
                                    value={selectedCategory}
                                    onChange={e => setSelectedCategory(e.target.value)}
                                >
                                    <option value="">-- Kategori Seçiniz --</option>
                                    {Object.entries(competitions[selectedCompId].kategoriler).map(([id, cat]) => (
                                        <option key={id} value={id}>{cat.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <button
                            className="btn-primary giant-btn neon-glow-green"
                            onClick={handleGoLive}
                            disabled={!selectedCompId || !selectedCategory}
                            style={{ marginTop: '2rem', width: '100%' }}
                        >
                            <i className="material-icons-round">cast</i> EKRANA YANSIT
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // LIVE VIEW
    const compOptions = competitions[selectedCompId];
    const catOptions = compOptions?.kategoriler?.[selectedCategory] || {};
    const apparatusList = catOptions.aletler || [];
    const currentView = views[viewIndex];

    // Calculate Rankings
    let displayHtml = null;
    let gridTemplate = `80px 3.5fr repeat(${apparatusList.length}, 1fr) 1.5fr`;

    if (currentView?.type === 'all' || currentView?.type === 'ind') {
        const list = currentView.type === 'all' ? athletes : athletes.filter(a => a.cinsiyet === currentView.gender);
        const preparedList = list.map(ath => {
            let total = 0;
            const appScores = {};
            apparatusList.forEach(alet => {
                const s = allScores[alet.id]?.[ath.id];
                const val = (s && s.durum === 'tamamlandi') ? parseFloat(s.sonuc) : 0;
                appScores[alet.id] = val;
                total += val;
            });
            return { ...ath, total, appScores };
        });

        preparedList.sort((a, b) => b.total - a.total);

        displayHtml = preparedList.map((ath, index) => {
            const rankClass = index < 3 ? `rank-${index + 1}` : '';
            return (
                <div key={ath.id} className={`sb-row ${rankClass}`} style={{ gridTemplateColumns: gridTemplate }}>
                    <div className="sb-cell rank-num">{ath.total > 0 ? index + 1 : '-'}</div>
                    <div className="sb-cell sb-name-col">
                        <div className="sb-name">{ath.ad} {ath.soyad}</div>
                        <div className="sb-club">{ath.kulup}</div>
                    </div>
                    {apparatusList.map(alet => (
                        <div key={alet.id} className="sb-cell center score-detail">
                            {ath.appScores[alet.id] > 0 ? ath.appScores[alet.id].toFixed(3) : '-'}
                        </div>
                    ))}
                    <div className="sb-cell right total-score text-gold">
                        {ath.total.toFixed(3)}
                    </div>
                </div>
            );
        });
    } else if (currentView?.type === 'team') {
        const teams = {};
        const teamAthletes = {};

        athletes.forEach(a => {
            if (a.yarismaTuru !== 'ferdi' && a.kulup) {
                if (!teamAthletes[a.kulup]) teamAthletes[a.kulup] = [];
                teamAthletes[a.kulup].push(String(a.id));
            }
        });

        Object.keys(teamAthletes).forEach(teamName => {
            const members = teamAthletes[teamName];
            let grandTotal = 0;
            const appTotals = {};

            apparatusList.forEach(alet => {
                let scoresArr = [];
                members.forEach(mId => {
                    const s = allScores[alet.id]?.[mId];
                    if (s && s.sonuc) scoresArr.push(parseFloat(s.sonuc));
                });
                scoresArr.sort((a, b) => b - a);
                // Top 3 scores per apparatus for team total
                const top3Sum = scoresArr.slice(0, 3).reduce((a, b) => a + b, 0);
                appTotals[alet.id] = top3Sum;
                grandTotal += top3Sum;
            });

            if (grandTotal > 0) {
                teams[teamName] = { name: teamName, total: grandTotal, appTotals };
            }
        });

        const ranking = Object.values(teams).sort((a, b) => b.total - a.total);

        if (ranking.length === 0) {
            displayHtml = <div className="sb-empty">Takım Puanı Oluşmadı</div>;
        } else {
            displayHtml = ranking.map((t, index) => {
                const rankClass = index < 3 ? `rank-${index + 1}` : '';
                return (
                    <div key={t.name} className={`sb-row ${rankClass}`} style={{ gridTemplateColumns: gridTemplate }}>
                        <div className="sb-cell rank-num">{index + 1}</div>
                        <div className="sb-cell sb-name-col">
                            <div className="sb-name team-name">{t.name}</div>
                        </div>
                        {apparatusList.map(alet => (
                            <div key={alet.id} className="sb-cell center score-detail">
                                {t.appTotals[alet.id].toFixed(3)}
                            </div>
                        ))}
                        <div className="sb-cell right total-score text-gold">
                            {t.total.toFixed(3)}
                        </div>
                    </div>
                );
            });
        }
    }


    return (
        <div className="scoreboard-live fullscreen-mode">

            {/* Live Header */}
            <div className="sb-header">
                <div>
                    <h1 className="sb-comp-title">{compOptions?.isim}</h1>
                    <div className="sb-cat-title">{catOptions?.name}</div>
                </div>
                <div className="sb-view-title" style={{ color: currentView?.color, borderBottomColor: currentView?.color }}>
                    {currentView?.title}
                </div>
                <button className="sb-exit-btn" onClick={exitLiveMode} title="Yayını Kapat">
                    <i className="material-icons-round">close</i>
                </button>
            </div>

            {/* Table Header */}
            <div className="sb-table-header" style={{ gridTemplateColumns: gridTemplate }}>
                <div className="sb-th center">SIRA</div>
                <div className="sb-th pl-20">SPORCU / KULÜP</div>
                {apparatusList.map(a => (
                    <div key={a.id} className="sb-th center">{a.name.toUpperCase()}</div>
                ))}
                <div className="sb-th right">TOPLAM</div>
            </div>

            {/* Table Body (Fades out and in when changing views, handled by simple CSS opacity on .sb-container) */}
            <div className="sb-container fade-in" key={currentView?.title}>
                {displayHtml && displayHtml.length > 0 ? displayHtml : <div className="sb-empty">Kayıt Bulunamadı.</div>}
            </div>

            {/* FLASH OVERLAY (Yeni Puan Bildirimi) */}
            <div className={`sb-flash-overlay ${isFlashing ? 'visible' : ''}`}>
                {flashData && (
                    <div className="sb-flash-card animate-pop-in">
                        <div className="f-title text-neon-blue">YENİ PUAN</div>
                        <h1 className="f-name">{flashData.adSoyad}</h1>
                        <p className="f-club text-cyber">{flashData.kulup}</p>
                        <h2 className="f-apparatus">Alet: {flashData.aletAd?.toUpperCase()}</h2>

                        <div className="f-stats">
                            <div className="f-stat-box border-purple">
                                <span className="lbl">ZORLUK (D)</span>
                                <span className="val text-purple">{parseFloat(flashData.d || 0).toFixed(2)}</span>
                            </div>
                            <div className="f-stat-box border-green">
                                <span className="lbl">UYGULAMA (E)</span>
                                <span className="val text-green">{parseFloat(flashData.e || 0).toFixed(3)}</span>
                            </div>
                            <div className="f-stat-box border-red">
                                <span className="lbl">KESİNTİ</span>
                                <span className="val text-red">{parseFloat(flashData.pen || 0) > 0 ? '-' : ''}{parseFloat(flashData.pen || 0).toFixed(2)}</span>
                            </div>
                        </div>

                        <div className="f-total-box neon-glow-gold">
                            <span className="ft-lbl">SONUÇ</span>
                            <span className="ft-val">{parseFloat(flashData.total || 0).toFixed(3)}</span>
                        </div>
                    </div>
                )}
            </div>

        </div>
    );
}
