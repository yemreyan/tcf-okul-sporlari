import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import './ScoreboardPage.css';

/* ================================================================
   SCOREBOARD — FIG / Olympic Style Live Display
   ================================================================
   Tasarım referansları:
   - SmartScoring (FIG World Cup): #080915 bg, mavi/mor accent
   - OMEGA Vionardo (Olimpiyat): Temiz tipografi, 4K UHD grafik
   - NBC Broadcast: Yeşil/Sarı/Kırmızı skor kalitesi göstergesi
   ================================================================ */

// Alet isimlerini Türkçe kısaltmalarla göster (FIG tarzı)
const APPARATUS_LABELS = {
    yer: 'YER', atlama: 'ATL', paralel: 'PAR', barfiks: 'BAR',
    halka: 'HAL', kulplu: 'KUL', mantar: 'MNT', denge: 'DNG',
    asimetrik: 'ASM', kasa: 'KAS', trampolin: 'TRA', tumbling: 'TUM',
};

// NBC tarzı skor kalitesi renklendirmesi (okul sporu seviyeleri)
function getScoreQualityClass(score) {
    if (!score || score <= 0) return '';
    if (score >= 14.0) return 'sq-excellent';  // Olağanüstü
    if (score >= 12.5) return 'sq-good';       // İyi
    if (score >= 10.5) return 'sq-average';    // Orta
    return 'sq-low';                            // Geliştirilmeli
}

export default function ScoreboardPage() {
    const { currentUser } = useAuth();
    const [competitions, setCompetitions] = useState({});
    const [selectedCompId, setSelectedCompId] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('');

    const [athletes, setAthletes] = useState([]);
    const [allScores, setAllScores] = useState({});

    // UI State
    const [isLive, setIsLive] = useState(false);
    const [viewIndex, setViewIndex] = useState(0);
    const [views, setViews] = useState([]);
    const [viewTransition, setViewTransition] = useState(false);

    // Flash State — Olimpiyat tarzı sıralı skor açılışı
    const [flashData, setFlashData] = useState(null);
    const [isFlashing, setIsFlashing] = useState(false);
    const [flashPhase, setFlashPhase] = useState(0); // 0=giriş, 1=D, 2=E, 3=Total
    const flashTimeoutRef = useRef(null);
    const flashPhaseRef = useRef(null);

    // Listener cleanup refs
    const liveUnsubsRef = useRef([]);

    // Cycle
    const [cycleProgress, setCycleProgress] = useState(0);
    const cycleTimerRef = useRef(null);
    const progressTimerRef = useRef(null);

    // Clock
    const [clock, setClock] = useState('');
    useEffect(() => {
        const tick = () => {
            const now = new Date();
            setClock(now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));
        };
        tick();
        const id = setInterval(tick, 30000);
        return () => clearInterval(id);
    }, []);

    // Initial Data Fetch
    useEffect(() => {
        const compRef = ref(db, 'competitions');
        const unsubscribe = onValue(compRef, (snapshot) => {
            const data = snapshot.val();
            if (data) setCompetitions(filterCompetitionsByUser(data, currentUser));
        });
        return () => unsubscribe();
    }, [currentUser]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            liveUnsubsRef.current.forEach(unsub => unsub());
            if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
            if (flashPhaseRef.current) clearTimeout(flashPhaseRef.current);
            if (cycleTimerRef.current) clearInterval(cycleTimerRef.current);
            if (progressTimerRef.current) clearInterval(progressTimerRef.current);
        };
    }, []);

    const cleanupListeners = useCallback(() => {
        liveUnsubsRef.current.forEach(unsub => unsub());
        liveUnsubsRef.current = [];
    }, []);

    // Go Live
    const handleGoLive = useCallback(() => {
        if (!selectedCompId || !selectedCategory) return;
        cleanupListeners();
        setIsLive(true);
        setViewIndex(0);
        setCycleProgress(0);

        // Athletes
        const athletesRef = ref(db, `competitions/${selectedCompId}/sporcular/${selectedCategory}`);
        const unsubAthletes = onValue(athletesRef, (snap) => {
            const data = snap.val();
            setAthletes(data ? Object.values(data) : []);
        });
        liveUnsubsRef.current.push(unsubAthletes);

        // Scores
        const scoresRef = ref(db, `competitions/${selectedCompId}/puanlar/${selectedCategory}`);
        const unsubScores = onValue(scoresRef, (snap) => {
            setAllScores(snap.val() || {});
        });
        liveUnsubsRef.current.push(unsubScores);

        // Flash trigger
        const flashRef = ref(db, `competitions/${selectedCompId}/flashTrigger`);
        let isInitialLoad = true;
        const unsubFlash = onValue(flashRef, (snap) => {
            if (isInitialLoad) { isInitialLoad = false; return; }
            const data = snap.val();
            if (data && (Date.now() - data.timestamp < 10000)) {
                triggerFlash(data);
            }
        });
        liveUnsubsRef.current.push(unsubFlash);

        // Views
        const catName = competitions[selectedCompId]?.kategoriler?.[selectedCategory]?.name || '';
        const lid = selectedCategory.toLowerCase();
        const lname = catName.toLowerCase();
        const isErkek = lid.includes('erkek') || lname.includes('erkek');
        const isKadin = lid.includes('kadin') || lid.includes('kiz') || lname.includes('kadın') || lname.includes('kız');

        let newViews = [];
        if (isErkek) {
            newViews.push({ type: 'all', title: 'BİREYSEL GENEL TASNİF', subtitle: 'ALL-AROUND', color: '#0ea5e9', gender: 'erkek' });
        } else if (isKadin) {
            newViews.push({ type: 'all', title: 'BİREYSEL GENEL TASNİF', subtitle: 'ALL-AROUND', color: '#e879a8', gender: 'kadin' });
        } else {
            newViews.push({ type: 'ind', gender: 'kadin', title: 'BİREYSEL GENEL TASNİF', subtitle: 'ALL-AROUND KIZLAR', color: '#e879a8' });
            newViews.push({ type: 'ind', gender: 'erkek', title: 'BİREYSEL GENEL TASNİF', subtitle: 'ALL-AROUND ERKEKLER', color: '#0ea5e9' });
        }
        newViews.push({ type: 'team', title: 'TAKIM SIRALAMASI', subtitle: 'TEAM RANKING', color: '#22c55e' });

        setViews(newViews);
    }, [selectedCompId, selectedCategory, competitions, cleanupListeners]);

    // Cycle Timer
    useEffect(() => {
        if (!isLive || isFlashing || views.length === 0) return;

        const CYCLE_DURATION = 12000;
        const PROGRESS_INTERVAL = 50;
        let elapsed = 0;
        setCycleProgress(0);

        progressTimerRef.current = setInterval(() => {
            elapsed += PROGRESS_INTERVAL;
            setCycleProgress(Math.min((elapsed / CYCLE_DURATION) * 100, 100));
        }, PROGRESS_INTERVAL);

        cycleTimerRef.current = setInterval(() => {
            setViewTransition(true);
            setTimeout(() => {
                setViewIndex(prev => (prev + 1) % views.length);
                setViewTransition(false);
                elapsed = 0;
                setCycleProgress(0);
            }, 400);
        }, CYCLE_DURATION);

        return () => {
            clearInterval(cycleTimerRef.current);
            clearInterval(progressTimerRef.current);
        };
    }, [isLive, isFlashing, views]);

    // Fullscreen
    useEffect(() => {
        if (isLive) {
            document.documentElement.requestFullscreen?.().catch(() => { });
        }
    }, [isLive]);

    const exitLiveMode = useCallback(() => {
        cleanupListeners();
        setIsLive(false);
        setFlashData(null);
        setIsFlashing(false);
        setFlashPhase(0);
        if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
        if (flashPhaseRef.current) clearTimeout(flashPhaseRef.current);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    }, [cleanupListeners]);

    // Olimpiyat tarzı sıralı flash açılışı: giriş → D → E → Total
    const triggerFlash = useCallback((data) => {
        if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
        if (flashPhaseRef.current) clearTimeout(flashPhaseRef.current);

        setFlashData(data);
        setFlashPhase(0);
        setIsFlashing(true);

        // Phase 1: D-Score (800ms sonra)
        const t1 = setTimeout(() => setFlashPhase(1), 600);
        // Phase 2: E-Score (1600ms sonra)
        const t2 = setTimeout(() => setFlashPhase(2), 1400);
        // Phase 3: Total (2400ms sonra)
        const t3 = setTimeout(() => setFlashPhase(3), 2200);

        flashPhaseRef.current = t3;

        // Kapat (7 saniye sonra)
        flashTimeoutRef.current = setTimeout(() => {
            setIsFlashing(false);
            setTimeout(() => { setFlashData(null); setFlashPhase(0); }, 500);
        }, 7000);

        // Cleanup ara timer'lar
        return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }, []);

    // Memoized apparatus list
    const apparatusList = useMemo(() => {
        if (!isLive || !selectedCompId) return [];
        const catOptions = competitions[selectedCompId]?.kategoriler?.[selectedCategory] || {};
        const raw = catOptions.aletler || [];
        return raw.map(a => typeof a === 'string' ? { id: a, name: a } : a);
    }, [isLive, selectedCompId, selectedCategory, competitions]);

    const gridTemplate = useMemo(() => {
        const appCols = apparatusList.length;
        return `64px 2.8fr repeat(${appCols}, 1fr) 1.4fr`;
    }, [apparatusList.length]);

    const currentView = views[viewIndex];

    // Memoized individual ranking
    const individualRanking = useMemo(() => {
        if (!currentView || (currentView.type !== 'all' && currentView.type !== 'ind')) return [];

        const list = currentView.type === 'all'
            ? athletes
            : athletes.filter(a => a.cinsiyet === currentView.gender);

        return list
            .map(ath => {
                let total = 0;
                const appScores = {};
                let completedCount = 0;
                apparatusList.forEach(alet => {
                    const s = allScores[alet.id]?.[ath.id];
                    const val = (s && s.durum === 'tamamlandi') ? parseFloat(s.sonuc) : 0;
                    appScores[alet.id] = val;
                    total += val;
                    if (val > 0) completedCount++;
                });
                return { ...ath, total, appScores, completedCount };
            })
            .sort((a, b) => b.total - a.total);
    }, [athletes, allScores, apparatusList, currentView]);

    // Memoized team ranking
    const teamRanking = useMemo(() => {
        if (!currentView || currentView.type !== 'team') return [];

        const teamAthletes = {};
        athletes.forEach(a => {
            const club = a.kulup || a.okul;
            if (a.yarismaTuru !== 'ferdi' && club) {
                if (!teamAthletes[club]) teamAthletes[club] = [];
                teamAthletes[club].push(String(a.id));
            }
        });

        const teams = [];
        Object.entries(teamAthletes).forEach(([teamName, members]) => {
            let grandTotal = 0;
            const appTotals = {};
            let hasScore = false;

            apparatusList.forEach(alet => {
                const scoresArr = [];
                members.forEach(mId => {
                    const s = allScores[alet.id]?.[mId];
                    if (s && s.sonuc) scoresArr.push(parseFloat(s.sonuc));
                });
                scoresArr.sort((x, y) => y - x);
                const top3Sum = scoresArr.slice(0, 3).reduce((x, y) => x + y, 0);
                appTotals[alet.id] = top3Sum;
                grandTotal += top3Sum;
                if (top3Sum > 0) hasScore = true;
            });

            if (hasScore) {
                teams.push({ name: teamName, total: grandTotal, appTotals, memberCount: members.length });
            }
        });

        return teams.sort((a, b) => b.total - a.total);
    }, [athletes, allScores, apparatusList, currentView]);

    // Sporcu sayısı bilgisi (header'da gösterilecek)
    const athleteCount = athletes.length;
    const scoredCount = useMemo(() => {
        let count = 0;
        athletes.forEach(ath => {
            const hasAny = apparatusList.some(alet => {
                const s = allScores[alet.id]?.[ath.id];
                return s && s.durum === 'tamamlandi';
            });
            if (hasAny) count++;
        });
        return count;
    }, [athletes, allScores, apparatusList]);

    // ─── CONFIG VIEW ───────────────────────────────────────────
    if (!isLive) {
        const compEntries = Object.entries(competitions);
        return (
            <div className="scoreboard-config page-container">
                <div className="config-card neon-panel">
                    <div className="cc-icon cyber-gradient">
                        <i className="material-icons-round">live_tv</i>
                    </div>
                    <h2>Canlı Skor Ekranı</h2>
                    <p className="text-cyber">Seyirciler için dev ekran modunu başlatın</p>

                    <div className="config-form">
                        <div className="input-group">
                            <label><i className="material-icons-round" style={{ fontSize: 16, verticalAlign: -3 }}>emoji_events</i> Yarisma</label>
                            <select
                                className="cyber-input"
                                value={selectedCompId}
                                onChange={e => { setSelectedCompId(e.target.value); setSelectedCategory(''); }}
                            >
                                <option value="">— Yarışma Seçiniz —</option>
                                {compEntries.map(([id, comp]) => (
                                    <option key={id} value={id}>{comp.isim}</option>
                                ))}
                            </select>
                        </div>

                        {selectedCompId && competitions[selectedCompId]?.kategoriler && (
                            <div className="input-group slide-in">
                                <label><i className="material-icons-round" style={{ fontSize: 16, verticalAlign: -3 }}>category</i> Kategori</label>
                                <select
                                    className="cyber-input"
                                    value={selectedCategory}
                                    onChange={e => setSelectedCategory(e.target.value)}
                                >
                                    <option value="">— Kategori Seçiniz —</option>
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
                            <i className="material-icons-round">cast</i> YAYINI BASLAT
                        </button>
                    </div>

                    {selectedCompId && selectedCategory && (
                        <div className="config-preview slide-in">
                            <i className="material-icons-round">info</i>
                            Tam ekran modunda açılacaktır. ESC ile çıkabilirsiniz.
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ─── LIVE VIEW ─────────────────────────────────────────────
    const compOptions = competitions[selectedCompId];
    const catOptions = compOptions?.kategoriler?.[selectedCategory] || {};
    const ranking = currentView?.type === 'team' ? teamRanking : individualRanking;

    return (
        <div className="sb-live">

            {/* ══ TOP BAR — FIG/Olimpiyat tarzı ══ */}
            <div className="sb-topbar">
                {/* Sol: Canlı gösterge + saat */}
                <div className="sb-topbar-left">
                    <div className="sb-live-badge">
                        <span className="sb-live-dot" />
                        LIVE
                    </div>
                    <span className="sb-clock">{clock}</span>
                </div>

                {/* Orta: Yarışma + Kategori */}
                <div className="sb-topbar-center">
                    <div className="sb-comp-name">{compOptions?.isim}</div>
                    <div className="sb-cat-name">{catOptions?.name}</div>
                </div>

                {/* Sağ: İstatistik + Çıkış */}
                <div className="sb-topbar-right">
                    <div className="sb-stats-pill">
                        <span>{scoredCount}/{athleteCount}</span>
                        <i className="material-icons-round" style={{ fontSize: 16 }}>person</i>
                    </div>
                    <button className="sb-exit-btn" onClick={exitLiveMode} title="Yayını Kapat">
                        <i className="material-icons-round">close</i>
                    </button>
                </div>
            </div>

            {/* ══ VIEW BANNER — Hangi sıralama gösteriliyor ══ */}
            <div className="sb-view-banner" style={{ '--view-color': currentView?.color }}>
                <div className="sb-view-info">
                    <h2 className="sb-view-title">{currentView?.title}</h2>
                    <span className="sb-view-sub">{currentView?.subtitle}</span>
                </div>
                <div className="sb-view-nav">
                    {views.map((v, i) => (
                        <div
                            key={i}
                            className={`sb-nav-dot ${i === viewIndex ? 'active' : ''}`}
                            style={i === viewIndex ? { background: v.color, boxShadow: `0 0 8px ${v.color}` } : {}}
                        />
                    ))}
                </div>
                {/* Progress bar */}
                <div className="sb-cycle-track">
                    <div className="sb-cycle-fill" style={{ width: `${cycleProgress}%` }} />
                </div>
            </div>

            {/* ══ TABLE HEADER ══ */}
            <div className="sb-thead" style={{ gridTemplateColumns: gridTemplate }}>
                <div className="sb-th sb-th-rank">SIRA</div>
                <div className="sb-th sb-th-name">{currentView?.type === 'team' ? 'TAKIM' : 'SPORCU'}</div>
                {apparatusList.map(a => (
                    <div key={a.id} className="sb-th sb-th-app">
                        {APPARATUS_LABELS[a.id] || a.name.substring(0, 3).toUpperCase()}
                    </div>
                ))}
                <div className="sb-th sb-th-total">TOPLAM</div>
            </div>

            {/* ══ TABLE BODY ══ */}
            <div className={`sb-tbody ${viewTransition ? 'sb-fade-out' : 'sb-fade-in'}`}>
                {ranking.length === 0 ? (
                    <div className="sb-empty-state">
                        <i className="material-icons-round">hourglass_empty</i>
                        <span>{currentView?.type === 'team' ? 'Takım Puanı Henüz Oluşturulmadı' : 'Henüz Puan Girilmedi'}</span>
                    </div>
                ) : (
                    currentView?.type === 'team' ? (
                        teamRanking.map((t, idx) => (
                            <div
                                key={t.name}
                                className={`sb-row ${idx < 3 ? `sb-medal-${idx + 1}` : ''}`}
                                style={{ gridTemplateColumns: gridTemplate, animationDelay: `${idx * 0.05}s` }}
                            >
                                <div className="sb-cell sb-rank">
                                    {idx < 3 ? (
                                        <div className={`sb-medal-icon sb-medal-icon-${idx + 1}`}>
                                            {idx + 1}
                                        </div>
                                    ) : (
                                        <span className="sb-rank-num">{idx + 1}</span>
                                    )}
                                </div>
                                <div className="sb-cell sb-name-cell">
                                    <div className="sb-athlete-name sb-team-label">{t.name}</div>
                                    <div className="sb-athlete-club">{t.memberCount} sporcu</div>
                                </div>
                                {apparatusList.map(alet => (
                                    <div key={alet.id} className={`sb-cell sb-score-cell ${t.appTotals[alet.id] > 0 ? 'sb-scored' : 'sb-pending'}`}>
                                        {t.appTotals[alet.id] > 0 ? t.appTotals[alet.id].toFixed(3) : '—'}
                                    </div>
                                ))}
                                <div className="sb-cell sb-total-cell">
                                    {t.total.toFixed(3)}
                                </div>
                            </div>
                        ))
                    ) : (
                        individualRanking.map((ath, idx) => (
                            <div
                                key={ath.id}
                                className={`sb-row ${idx < 3 && ath.total > 0 ? `sb-medal-${idx + 1}` : ''}`}
                                style={{ gridTemplateColumns: gridTemplate, animationDelay: `${idx * 0.04}s` }}
                            >
                                <div className="sb-cell sb-rank">
                                    {ath.total > 0 && idx < 3 ? (
                                        <div className={`sb-medal-icon sb-medal-icon-${idx + 1}`}>
                                            {idx + 1}
                                        </div>
                                    ) : (
                                        <span className="sb-rank-num">{ath.total > 0 ? idx + 1 : '—'}</span>
                                    )}
                                </div>
                                <div className="sb-cell sb-name-cell">
                                    <div className="sb-athlete-name">{ath.ad} {ath.soyad}</div>
                                    <div className="sb-athlete-club">{ath.kulup || ath.okul}</div>
                                </div>
                                {apparatusList.map(alet => {
                                    const val = ath.appScores[alet.id];
                                    return (
                                        <div key={alet.id} className={`sb-cell sb-score-cell ${val > 0 ? `sb-scored ${getScoreQualityClass(val)}` : 'sb-pending'}`}>
                                            {val > 0 ? val.toFixed(3) : '—'}
                                        </div>
                                    );
                                })}
                                <div className="sb-cell sb-total-cell">
                                    {ath.total > 0 ? ath.total.toFixed(3) : '—'}
                                </div>
                            </div>
                        ))
                    )
                )}
            </div>

            {/* ══ FLASH OVERLAY — Olimpiyat tarzı sıralı açılış ══ */}
            <div className={`sb-flash ${isFlashing ? 'sb-flash-visible' : ''}`}>
                {flashData && (
                    <div className="sb-flash-card">

                        {/* Üst kısım: Sporcu bilgileri */}
                        <div className="sf-header">
                            <div className="sf-new-score-tag">
                                <i className="material-icons-round">notifications_active</i>
                                YENi PUAN
                            </div>
                            <h1 className="sf-athlete">{flashData.adSoyad}</h1>
                            <p className="sf-club">{flashData.kulup}</p>
                            <div className="sf-apparatus">
                                {flashData.aletAd?.toUpperCase()}
                            </div>
                        </div>

                        {/* Ortada: D → E → Pen sıralı açılış */}
                        <div className="sf-scores">
                            <div className={`sf-score-item sf-d ${flashPhase >= 1 ? 'sf-reveal' : ''}`}>
                                <div className="sf-score-label">D SCORE</div>
                                <div className="sf-score-value">{parseFloat(flashData.d || 0).toFixed(2)}</div>
                            </div>
                            <div className="sf-score-divider">+</div>
                            <div className={`sf-score-item sf-e ${flashPhase >= 2 ? 'sf-reveal' : ''}`}>
                                <div className="sf-score-label">E SCORE</div>
                                <div className="sf-score-value">{parseFloat(flashData.e || 0).toFixed(3)}</div>
                            </div>
                            {parseFloat(flashData.pen || 0) > 0 && (
                                <>
                                    <div className="sf-score-divider">-</div>
                                    <div className={`sf-score-item sf-pen ${flashPhase >= 2 ? 'sf-reveal' : ''}`}>
                                        <div className="sf-score-label">PENALTY</div>
                                        <div className="sf-score-value">{parseFloat(flashData.pen || 0).toFixed(2)}</div>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Alt: Final skor — büyük gösterim */}
                        <div className={`sf-total ${flashPhase >= 3 ? 'sf-reveal-total' : ''}`}>
                            <span className="sf-total-value">{parseFloat(flashData.total || 0).toFixed(3)}</span>
                        </div>

                        {/* Zamanlayıcı bar */}
                        <div className="sf-timer">
                            <div className="sf-timer-bar" />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
