import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useDiscipline } from '../lib/DisciplineContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import './ScoreboardPage.css';

/* ================================================================
   SCOREBOARD — Light Theme Live Display
   ================================================================ */

const PAGE_SIZE = 8;

// Apparatus abbreviations
const APPARATUS_MAP = {
    yer: { abbr: 'FX' },
    atlama: { abbr: 'VT' },
    paralel: { abbr: 'PB' },
    barfiks: { abbr: 'HB' },
    halka: { abbr: 'SR' },
    kulplu: { abbr: 'PH' },
    denge: { abbr: 'BB' },
    asimetrik: { abbr: 'UB' },
    mantar: { abbr: 'MH' },
    kasa: { abbr: 'VT' },
    trampolin: { abbr: 'TR' },
    tumbling: { abbr: 'TU' },
};

// Apparatus SVG illustrations
const APPARATUS_IMAGES = {
    yer: '<svg viewBox="0 0 40 28" fill="none"><rect x="2" y="18" width="36" height="8" rx="2" fill="#94A3B8"/><rect x="4" y="20" width="32" height="4" rx="1" fill="#CBD5E1"/><path d="M14 8L20 2L26 8" stroke="#64748B" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="20" cy="13" r="3" fill="#64748B"/></svg>',
    atlama: '<svg viewBox="0 0 40 28" fill="none"><rect x="8" y="12" width="24" height="14" rx="3" fill="#94A3B8"/><rect x="10" y="14" width="20" height="10" rx="2" fill="#CBD5E1"/><rect x="2" y="22" width="6" height="4" rx="1" fill="#64748B"/><rect x="32" y="22" width="6" height="4" rx="1" fill="#64748B"/></svg>',
    paralel: '<svg viewBox="0 0 40 28" fill="none"><rect x="6" y="6" width="2" height="20" rx="1" fill="#64748B"/><rect x="32" y="6" width="2" height="20" rx="1" fill="#64748B"/><rect x="4" y="6" width="6" height="3" rx="1" fill="#94A3B8"/><rect x="30" y="6" width="6" height="3" rx="1" fill="#94A3B8"/><rect x="8" y="7" width="24" height="2" rx="1" fill="#CBD5E1"/><rect x="8" y="14" width="24" height="2" rx="1" fill="#CBD5E1"/></svg>',
    barfiks: '<svg viewBox="0 0 40 28" fill="none"><rect x="6" y="4" width="3" height="22" rx="1" fill="#64748B"/><rect x="31" y="4" width="3" height="22" rx="1" fill="#64748B"/><rect x="5" y="4" width="30" height="3" rx="1.5" fill="#94A3B8"/></svg>',
    halka: '<svg viewBox="0 0 40 28" fill="none"><rect x="18" y="0" width="4" height="8" rx="1" fill="#64748B"/><line x1="12" y1="8" x2="20" y2="8" stroke="#94A3B8" stroke-width="1.5"/><line x1="20" y1="8" x2="28" y2="8" stroke="#94A3B8" stroke-width="1.5"/><circle cx="12" cy="16" r="5" stroke="#94A3B8" stroke-width="2.5" fill="none"/><circle cx="28" cy="16" r="5" stroke="#94A3B8" stroke-width="2.5" fill="none"/></svg>',
    kulplu: '<svg viewBox="0 0 40 28" fill="none"><rect x="4" y="16" width="32" height="8" rx="3" fill="#94A3B8"/><rect x="6" y="18" width="28" height="4" rx="2" fill="#CBD5E1"/><path d="M12 16Q12 10 16 10Q20 10 20 16" stroke="#64748B" stroke-width="2" fill="none"/><path d="M20 16Q20 10 24 10Q28 10 28 16" stroke="#64748B" stroke-width="2" fill="none"/><rect x="2" y="22" width="6" height="4" rx="1" fill="#64748B"/><rect x="32" y="22" width="6" height="4" rx="1" fill="#64748B"/></svg>',
    denge: '<svg viewBox="0 0 40 28" fill="none"><rect x="4" y="10" width="32" height="3" rx="1.5" fill="#94A3B8"/><rect x="6" y="12" width="28" height="2" rx="1" fill="#CBD5E1"/><rect x="8" y="13" width="3" height="13" rx="1" fill="#64748B"/><rect x="29" y="13" width="3" height="13" rx="1" fill="#64748B"/></svg>',
    asimetrik: '<svg viewBox="0 0 40 28" fill="none"><rect x="6" y="2" width="3" height="24" rx="1" fill="#64748B"/><rect x="31" y="2" width="3" height="24" rx="1" fill="#64748B"/><rect x="5" y="4" width="30" height="2.5" rx="1" fill="#94A3B8"/><rect x="5" y="16" width="30" height="2.5" rx="1" fill="#94A3B8"/></svg>',
    mantar: '<svg viewBox="0 0 40 28" fill="none"><ellipse cx="20" cy="18" rx="16" ry="6" fill="#94A3B8"/><ellipse cx="20" cy="17" rx="14" ry="5" fill="#CBD5E1"/><rect x="8" y="22" width="4" height="4" rx="1" fill="#64748B"/><rect x="28" y="22" width="4" height="4" rx="1" fill="#64748B"/></svg>',
    kasa: '<svg viewBox="0 0 40 28" fill="none"><rect x="8" y="12" width="24" height="14" rx="3" fill="#94A3B8"/><rect x="10" y="14" width="20" height="10" rx="2" fill="#CBD5E1"/><rect x="2" y="22" width="6" height="4" rx="1" fill="#64748B"/><rect x="32" y="22" width="6" height="4" rx="1" fill="#64748B"/></svg>',
    trampolin: '<svg viewBox="0 0 40 28" fill="none"><rect x="4" y="20" width="32" height="6" rx="2" fill="#94A3B8"/><path d="M6 20Q20 10 34 20" stroke="#64748B" stroke-width="2" fill="none"/><rect x="4" y="20" width="2" height="6" rx="1" fill="#64748B"/><rect x="34" y="20" width="2" height="6" rx="1" fill="#64748B"/></svg>',
    tumbling: '<svg viewBox="0 0 40 28" fill="none"><rect x="2" y="20" width="36" height="6" rx="2" fill="#94A3B8"/><rect x="4" y="22" width="32" height="2" rx="1" fill="#CBD5E1"/><path d="M10 14L16 8L22 14L28 8" stroke="#64748B" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
};

export default function ScoreboardPage() {
    const navigate = useNavigate();
    const { currentUser } = useAuth();
    const { firebasePath, routePrefix, hasApparatus } = useDiscipline();
    const [competitions, setCompetitions] = useState({});
    const [selectedCity, setSelectedCity] = useState('');
    const [selectedCompId, setSelectedCompId] = useState('');
    const [selectedCategories, setSelectedCategories] = useState(new Set());

    // Per-category data: { [catId]: { athletes: [], scores: {} } }
    const [categoryData, setCategoryData] = useState({});

    // UI State
    const [isLive, setIsLive] = useState(false);
    const [viewIndex, setViewIndex] = useState(0);
    const [views, setViews] = useState([]);
    const [viewTransition, setViewTransition] = useState(false);

    // Pagination within each view
    const [pageIndex, setPageIndex] = useState(0);

    // Flash State
    const [flashData, setFlashData] = useState(null);
    const [isFlashing, setIsFlashing] = useState(false);
    const [flashPhase, setFlashPhase] = useState(0);
    const flashTimeoutRef = useRef(null);
    const flashPhaseRef = useRef(null);
    const isFlashingRef = useRef(false);
    const flashQueue = useRef([]);

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

    // Initial Data Fetch — tek seferlik okuma (puanlar dahil tüm node'u sürekli dinlemek gereksiz)
    useEffect(() => {
        get(ref(db, firebasePath)).then(snapshot => {
            const data = snapshot.val();
            if (data) setCompetitions(filterCompetitionsByUser(data, currentUser));
        });
    }, [currentUser, firebasePath]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            liveUnsubsRef.current.forEach(unsub => unsub());
            if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
            if (flashPhaseRef.current) clearTimeout(flashPhaseRef.current);
            if (cycleTimerRef.current) clearInterval(cycleTimerRef.current);
            if (progressTimerRef.current) clearInterval(progressTimerRef.current);
            flashQueue.current = [];
            isFlashingRef.current = false;
        };
    }, []);

    const cleanupListeners = useCallback(() => {
        liveUnsubsRef.current.forEach(unsub => unsub());
        liveUnsubsRef.current = [];
    }, []);

    // Toggle category selection
    const toggleCategory = useCallback((catId) => {
        setSelectedCategories(prev => {
            const next = new Set(prev);
            if (next.has(catId)) {
                next.delete(catId);
            } else {
                next.add(catId);
            }
            return next;
        });
    }, []);

    // Get apparatus list for a given category
    const getApparatusListForCategory = useCallback((catId) => {
        if (!selectedCompId) return [];
        const catOptions = competitions[selectedCompId]?.kategoriler?.[catId] || {};
        const raw = catOptions.aletler || [];
        return raw.map(a => typeof a === 'string' ? { id: a, name: a } : a);
    }, [selectedCompId, competitions]);

    // Go Live
    const handleGoLive = useCallback(() => {
        if (!selectedCompId || selectedCategories.size === 0) return;
        cleanupListeners();
        setIsLive(true);
        setViewIndex(0);
        setPageIndex(0);
        setCycleProgress(0);
        setCategoryData({});

        const cats = Array.from(selectedCategories);

        // Set up listeners for each category
        cats.forEach(catId => {
            // Athletes
            const athletesRef = ref(db, `${firebasePath}/${selectedCompId}/sporcular/${catId}`);
            const unsubAthletes = onValue(athletesRef, (snap) => {
                const data = snap.val();
                setCategoryData(prev => ({
                    ...prev,
                    [catId]: {
                        ...prev[catId],
                        athletes: data ? Object.entries(data).map(([key, val]) => ({ ...val, id: key })) : [],
                    }
                }));
            });
            liveUnsubsRef.current.push(unsubAthletes);

            // Scores
            const scoresRef = ref(db, `${firebasePath}/${selectedCompId}/puanlar/${catId}`);
            const unsubScores = onValue(scoresRef, (snap) => {
                setCategoryData(prev => ({
                    ...prev,
                    [catId]: {
                        ...prev[catId],
                        scores: snap.val() || {},
                    }
                }));
            });
            liveUnsubsRef.current.push(unsubScores);
        });

        // Flash trigger (shared across categories)
        const flashRef = ref(db, `${firebasePath}/${selectedCompId}/flashTrigger`);
        let isInitialLoad = true;
        const unsubFlash = onValue(flashRef, (snap) => {
            if (isInitialLoad) { isInitialLoad = false; return; }
            const data = snap.val();
            if (data && (Date.now() - data.timestamp < 10000)) {
                triggerFlash(data);
            }
        });
        liveUnsubsRef.current.push(unsubFlash);

        // Build views for all selected categories
        const newViews = [];
        cats.forEach(catId => {
            const catName = competitions[selectedCompId]?.kategoriler?.[catId]?.name || '';
            const lid = catId.toLowerCase();
            const lname = catName.toLowerCase();
            const isErkek = lid.includes('erkek') || lname.includes('erkek');
            const isKadin = lid.includes('kadin') || lid.includes('kiz') || lname.includes('kadın') || lname.includes('kız');

            if (isErkek) {
                newViews.push({ type: 'all', title: 'BİREYSEL GENEL TASNİF', subtitle: catName, color: '#0ea5e9', gender: 'erkek', catId });
            } else if (isKadin) {
                newViews.push({ type: 'all', title: 'BİREYSEL GENEL TASNİF', subtitle: catName, color: '#e879a8', gender: 'kadin', catId });
            } else {
                newViews.push({ type: 'ind', gender: 'kadin', title: 'BİREYSEL GENEL TASNİF', subtitle: `${catName} — KIZLAR`, color: '#e879a8', catId });
                newViews.push({ type: 'ind', gender: 'erkek', title: 'BİREYSEL GENEL TASNİF', subtitle: `${catName} — ERKEKLER`, color: '#0ea5e9', catId });
            }
            newViews.push({ type: 'team', title: 'TAKIM SIRALAMASI', subtitle: catName, color: '#22c55e', catId });
        });

        setViews(newViews);
    }, [selectedCompId, selectedCategories, competitions, cleanupListeners]);

    // Current view
    const currentView = views[viewIndex];

    // Get data for the current view's category
    const currentCatData = useMemo(() => {
        if (!currentView) return { athletes: [], scores: {} };
        return categoryData[currentView.catId] || { athletes: [], scores: {} };
    }, [currentView, categoryData]);

    const athletes = currentCatData.athletes || [];
    const allScores = currentCatData.scores || {};

    // Apparatus list for current view's category
    const apparatusList = useMemo(() => {
        if (!isLive || !currentView) return [];
        return getApparatusListForCategory(currentView.catId);
    }, [isLive, currentView, getApparatusListForCategory]);

    // Branşın alet bazlı olup olmadığı (Artistik=true, diğerleri=false)
    const isApparatusBased = hasApparatus && apparatusList.length > 0;

    const gridTemplate = useMemo(() => {
        const appCols = isApparatusBased ? apparatusList.length : 0;
        return appCols > 0
            ? `64px 2.8fr repeat(${appCols}, 1fr) 1.4fr`
            : `64px 2.8fr 1.4fr`;
    }, [isApparatusBased, apparatusList.length]);

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

                let athIsGecersiz = false;
                let athIsDNS = false;

                if (isApparatusBased) {
                    // Artistik: puanlar/{catId}/{aletId}/{athId}
                    apparatusList.forEach(alet => {
                        const s = allScores[alet.id]?.[ath.id];
                        const isGecersiz = s?.gecersiz === true;
                        const isDNS = s?.yarismadi === true;
                        const done = s && (s.durum === 'tamamlandi' || isGecersiz || isDNS);
                        const val = done ? parseFloat(s.sonuc ?? 0) : 0;
                        appScores[alet.id] = {
                            total: val,
                            d: done ? parseFloat(s.calc_D ?? s.dScore ?? 0) : 0,
                            e: done ? parseFloat(s.calc_E ?? 0) : 0,
                            isGecersiz,
                            isDNS,
                        };
                        total += val;
                        if (val > 0) completedCount++;
                        if (isGecersiz) athIsGecersiz = true;
                        if (isDNS) athIsDNS = true;
                    });
                } else {
                    // Aerobik/Trampolin/Parkur/Ritmik: puanlar/{catId}/{athId}
                    const s = allScores[ath.id];
                    const isGecersiz = s?.gecersiz === true;
                    const isDNS = s?.yarismadi === true;
                    const done = s && (s.durum === 'tamamlandi' || isGecersiz || isDNS);
                    total = done ? parseFloat(s.sonuc ?? 0) : 0;
                    if (total > 0) completedCount = 1;
                    athIsGecersiz = isGecersiz;
                    athIsDNS = isDNS;
                    appScores['_total'] = {
                        total,
                        d: done ? parseFloat(s.dScore ?? s.calc_D ?? 0) : 0,
                        e: done ? parseFloat(s.eScore ?? s.calc_E ?? 0) : 0,
                        a: done ? parseFloat(s.aScore ?? 0) : 0,
                        isGecersiz,
                        isDNS,
                    };
                }

                return { ...ath, total, appScores, completedCount, isGecersiz: athIsGecersiz, isDNS: athIsDNS };
            })
            .sort((a, b) => b.total - a.total);
    }, [athletes, allScores, apparatusList, isApparatusBased, currentView, categoryData]);

    // Memoized team ranking
    const teamRanking = useMemo(() => {
        if (!currentView || currentView.type !== 'team') return [];

        const teamAthletes = {};
        athletes.forEach(a => {
            const t = (a.yarismaTuru || a.katilimTuru || '').toLowerCase();
            if (t !== 'takim' && t !== 'takım') return;
            const club = a.kulup || a.okul;
            if (club) {
                if (!teamAthletes[club]) teamAthletes[club] = [];
                teamAthletes[club].push(String(a.id));
            }
        });

        const teams = [];
        Object.entries(teamAthletes).forEach(([teamName, members]) => {
            let grandTotal = 0;
            const appTotals = {};
            let hasScore = false;

            if (isApparatusBased) {
                // Artistik: alet bazlı toplam
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
            } else {
                // Non-apparatus: doğrudan sporcu toplam puanları
                const scoresArr = [];
                members.forEach(mId => {
                    const s = allScores[mId];
                    if (s && s.sonuc) scoresArr.push(parseFloat(s.sonuc));
                });
                scoresArr.sort((x, y) => y - x);
                const top3Sum = scoresArr.slice(0, 3).reduce((x, y) => x + y, 0);
                appTotals['_total'] = top3Sum;
                grandTotal = top3Sum;
                if (top3Sum > 0) hasScore = true;
            }

            if (hasScore) {
                teams.push({ name: teamName, total: grandTotal, appTotals, memberCount: members.length });
            }
        });

        return teams.sort((a, b) => b.total - a.total);
    }, [athletes, allScores, apparatusList, isApparatusBased, currentView, categoryData]);

    // Full ranking for current view (used for pagination)
    const fullRanking = currentView?.type === 'team' ? teamRanking : individualRanking;
    const totalPages = Math.max(1, Math.ceil(fullRanking.length / PAGE_SIZE));
    const pagedRanking = fullRanking.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE);

    // Cycle Timer — handles view cycling and pagination
    useEffect(() => {
        if (!isLive || isFlashing || views.length === 0) return;

        const PAGE_DURATION = 8000;
        const PROGRESS_INTERVAL = 50;
        let elapsed = 0;
        setCycleProgress(0);

        progressTimerRef.current = setInterval(() => {
            elapsed += PROGRESS_INTERVAL;
            setCycleProgress(Math.min((elapsed / PAGE_DURATION) * 100, 100));
        }, PROGRESS_INTERVAL);

        cycleTimerRef.current = setInterval(() => {
            setViewTransition(true);
            setTimeout(() => {
                setPageIndex(prevPage => {
                    const currentTotalPages = Math.max(1, Math.ceil(fullRanking.length / PAGE_SIZE));
                    if (prevPage + 1 < currentTotalPages) {
                        // More pages in this view
                        setViewTransition(false);
                        elapsed = 0;
                        setCycleProgress(0);
                        return prevPage + 1;
                    } else {
                        // Move to next view
                        setViewIndex(prev => (prev + 1) % views.length);
                        setViewTransition(false);
                        elapsed = 0;
                        setCycleProgress(0);
                        return 0;
                    }
                });
            }, 400);
        }, PAGE_DURATION);

        return () => {
            clearInterval(cycleTimerRef.current);
            clearInterval(progressTimerRef.current);
        };
    }, [isLive, isFlashing, views, viewIndex, fullRanking.length]);

    // Reset pageIndex when viewIndex changes
    useEffect(() => {
        setPageIndex(0);
    }, [viewIndex]);

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
        isFlashingRef.current = false;
        flashQueue.current = [];
        if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
        if (flashPhaseRef.current) clearTimeout(flashPhaseRef.current);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    }, [cleanupListeners]);

    // Flash — show a single score for 10s
    const showFlash = useCallback((data) => {
        if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
        if (flashPhaseRef.current) clearTimeout(flashPhaseRef.current);

        isFlashingRef.current = true;
        setFlashData(data);
        setFlashPhase(0);
        setIsFlashing(true);

        const t1 = setTimeout(() => setFlashPhase(1), 800);
        const t2 = setTimeout(() => setFlashPhase(2), 1800);
        const t3 = setTimeout(() => setFlashPhase(3), 2800);
        flashPhaseRef.current = t3;

        flashTimeoutRef.current = setTimeout(() => {
            setIsFlashing(false);
            isFlashingRef.current = false;
            setTimeout(() => {
                setFlashData(null);
                setFlashPhase(0);
                // Check queue for next flash
                if (flashQueue.current.length > 0) {
                    const next = flashQueue.current.shift();
                    setTimeout(() => showFlash(next), 400);
                }
            }, 500);
        }, 10000);
    }, []);

    // Flash trigger — queues if already flashing
    const triggerFlash = useCallback((data) => {
        if (isFlashingRef.current) {
            flashQueue.current.push(data);
            return;
        }
        showFlash(data);
    }, [showFlash]);

    // Athlete + score counts for topbar
    const athleteCount = athletes.length;
    const scoredCount = useMemo(() => {
        let count = 0;
        athletes.forEach(ath => {
            let hasAny = false;
            if (isApparatusBased) {
                hasAny = apparatusList.some(alet => {
                    const s = allScores[alet.id]?.[ath.id];
                    return s && (s.durum === 'tamamlandi' || s.gecersiz === true || s.yarismadi === true);
                });
            } else {
                const s = allScores[ath.id];
                hasAny = s && (s.durum === 'tamamlandi' || s.gecersiz === true || s.yarismadi === true);
            }
            if (hasAny) count++;
        });
        return count;
    }, [athletes, allScores, apparatusList, isApparatusBased, categoryData]);

    // ─── CONFIG VIEW ───────────────────────────────────────────
    if (!isLive) {
        const availableCities = [...new Set(Object.values(competitions).map(c => (c.il || c.city || '').toLocaleUpperCase('tr-TR')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr-TR'));
        const compEntries = Object.entries(competitions)
            .filter(([id, comp]) => !selectedCity || (comp.il || comp.city || '').toLocaleUpperCase('tr-TR') === selectedCity);
        const categories = selectedCompId ? competitions[selectedCompId]?.kategoriler || {} : {};
        const catEntries = Object.entries(categories);

        return (
            <div className="sb-config page-container">
                <button type="button" className="back-btn" onClick={() => navigate(routePrefix)}>
                    <i className="material-icons-round">arrow_back</i>
                </button>

                <div className="sb-config-card">
                    <div className="sb-config-icon">
                        <i className="material-icons-round">live_tv</i>
                    </div>
                    <h2 className="sb-config-title">Canli Skor Ekrani</h2>
                    <p className="sb-config-desc">Seyirciler icin dev ekran modunu baslatin</p>

                    <div className="sb-config-form">
                        {/* City Select */}
                        <div className="sb-field">
                            <label className="sb-label">
                                <i className="material-icons-round">location_city</i>
                                Il
                            </label>
                            <select
                                className="sb-select"
                                value={selectedCity}
                                onChange={e => { setSelectedCity(e.target.value); setSelectedCompId(''); setSelectedCategories(new Set()); }}
                            >
                                <option value="">-- Tum Iller --</option>
                                {availableCities.map(city => (
                                    <option key={city} value={city}>{city}</option>
                                ))}
                            </select>
                        </div>

                        {/* Competition Select */}
                        <div className="sb-field">
                            <label className="sb-label">
                                <i className="material-icons-round">emoji_events</i>
                                Yarisma
                            </label>
                            <select
                                className="sb-select"
                                value={selectedCompId}
                                onChange={e => { setSelectedCompId(e.target.value); setSelectedCategories(new Set()); }}
                            >
                                <option value="">-- Yarisma Seciniz --</option>
                                {compEntries.map(([id, comp]) => (
                                    <option key={id} value={id}>{comp.isim}</option>
                                ))}
                            </select>
                        </div>

                        {/* Multi-category checkboxes */}
                        {selectedCompId && catEntries.length > 0 && (
                            <div className="sb-field sb-field-cats">
                                <label className="sb-label">
                                    <i className="material-icons-round">category</i>
                                    Kategoriler
                                    {selectedCategories.size > 0 && (
                                        <span className="sb-cat-count">{selectedCategories.size} secili</span>
                                    )}
                                </label>
                                <div className="sb-cat-grid">
                                    {catEntries.map(([id, cat]) => (
                                        <label key={id} className={`sb-cat-item ${selectedCategories.has(id) ? 'sb-cat-selected' : ''}`}>
                                            <input
                                                type="checkbox"
                                                checked={selectedCategories.has(id)}
                                                onChange={() => toggleCategory(id)}
                                            />
                                            <span className="sb-cat-check">
                                                <i className="material-icons-round">
                                                    {selectedCategories.has(id) ? 'check_box' : 'check_box_outline_blank'}
                                                </i>
                                            </span>
                                            <span className="sb-cat-name-label">{cat.name}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        <button
                            className="sb-go-live-btn"
                            onClick={handleGoLive}
                            disabled={!selectedCompId || selectedCategories.size === 0}
                        >
                            <i className="material-icons-round">cast</i>
                            YAYINI BASLAT
                        </button>
                    </div>

                    {selectedCompId && selectedCategories.size > 0 && (
                        <div className="sb-config-info">
                            <i className="material-icons-round">info</i>
                            {selectedCategories.size} kategori yayinlanacak. Tam ekran modunda acilacaktir. ESC ile cikabilirsiniz.
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ─── LIVE VIEW ─────────────────────────────────────────────
    const compOptions = competitions[selectedCompId];
    const currentCatName = currentView ? (competitions[selectedCompId]?.kategoriler?.[currentView.catId]?.name || '') : '';

    return (
        <div className="sb-live">

            {/* TOP BAR */}
            <div className="sb-topbar">
                <div className="sb-topbar-left">
                    <div className="sb-live-badge">
                        <span className="sb-live-dot" />
                        LIVE
                    </div>
                    <span className="sb-clock">{clock}</span>
                </div>

                <div className="sb-topbar-center">
                    <div className="sb-comp-name">{compOptions?.isim}</div>
                    <div className="sb-cat-label">{currentCatName}</div>
                </div>

                <div className="sb-topbar-right">
                    <div className="sb-stats-pill">
                        <span>{scoredCount}/{athleteCount}</span>
                        <i className="material-icons-round" style={{ fontSize: 16 }}>person</i>
                    </div>
                    <button className="sb-exit-btn" onClick={exitLiveMode} title="Yayini Kapat">
                        <i className="material-icons-round">close</i>
                    </button>
                </div>
            </div>

            {/* VIEW BANNER */}
            <div className="sb-view-banner" style={{ '--view-color': currentView?.color }}>
                <div className="sb-view-info">
                    <h2 className="sb-view-title">{currentView?.title}</h2>
                    <span className="sb-view-sub">{currentView?.subtitle}</span>
                    {totalPages > 1 && (
                        <span className="sb-page-indicator">Sayfa {pageIndex + 1}/{totalPages}</span>
                    )}
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
                <div className="sb-cycle-track">
                    <div className="sb-cycle-fill" style={{ width: `${cycleProgress}%` }} />
                </div>
            </div>

            {/* TABLE HEADER */}
            <div className="sb-thead" style={{ gridTemplateColumns: gridTemplate }}>
                <div className="sb-th sb-th-rank">SIRA</div>
                <div className="sb-th sb-th-name">{currentView?.type === 'team' ? 'TAKIM' : 'SPORCU'}</div>
                {isApparatusBased ? apparatusList.map(a => {
                    const mapping = APPARATUS_MAP[a.id] || { abbr: a.name.substring(0, 3).toUpperCase() };
                    return (
                        <div key={a.id} className="sb-th sb-th-app">
                            <span className="sb-app-abbr">{mapping.abbr}</span>
                            <div className="sb-app-img" dangerouslySetInnerHTML={{ __html: APPARATUS_IMAGES[a.id] || '' }} />
                        </div>
                    );
                }) : null}
                <div className="sb-th sb-th-total">TOPLAM</div>
            </div>

            {/* TABLE BODY */}
            <div className={`sb-tbody ${viewTransition ? 'sb-fade-out' : 'sb-fade-in'}`}>
                {pagedRanking.length === 0 ? (
                    <div className="sb-empty-state">
                        <i className="material-icons-round">hourglass_empty</i>
                        <span>{currentView?.type === 'team' ? 'Takim Puani Henuz Olusturulmadi' : 'Henuz Puan Girilmedi'}</span>
                    </div>
                ) : (
                    currentView?.type === 'team' ? (
                        pagedRanking.map((t, localIdx) => {
                            const globalIdx = pageIndex * PAGE_SIZE + localIdx;
                            return (
                                <div
                                    key={t.name}
                                    className={`sb-row ${globalIdx < 3 ? `sb-medal-${globalIdx + 1}` : ''}`}
                                    style={{ gridTemplateColumns: gridTemplate, animationDelay: `${localIdx * 0.05}s` }}
                                >
                                    <div className="sb-cell sb-rank">
                                        {globalIdx < 3 ? (
                                            <div className={`sb-medal-icon sb-medal-icon-${globalIdx + 1}`}>
                                                {globalIdx + 1}
                                            </div>
                                        ) : (
                                            <span className="sb-rank-num">{globalIdx + 1}</span>
                                        )}
                                    </div>
                                    <div className="sb-cell sb-name-cell">
                                        <div className="sb-athlete-name sb-team-name-label">
                                            {t.name}
                                            <span className="sb-rank-tag">({globalIdx + 1}.)</span>
                                        </div>
                                        <div className="sb-athlete-club">{t.memberCount} sporcu</div>
                                    </div>
                                    {isApparatusBased && apparatusList.map(alet => (
                                        <div key={alet.id} className={`sb-cell sb-score-cell ${t.appTotals[alet.id] > 0 ? 'sb-scored' : 'sb-pending'}`}>
                                            {t.appTotals[alet.id] > 0 ? t.appTotals[alet.id].toFixed(3) : '\u2014'}
                                        </div>
                                    ))}
                                    <div className="sb-cell sb-total-cell">
                                        {t.total.toFixed(3)}
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        pagedRanking.map((ath, localIdx) => {
                            const globalIdx = pageIndex * PAGE_SIZE + localIdx;
                            return (
                                <div
                                    key={ath.id}
                                    className={`sb-row ${globalIdx < 3 && ath.total > 0 ? `sb-medal-${globalIdx + 1}` : ''}`}
                                    style={{ gridTemplateColumns: gridTemplate, animationDelay: `${localIdx * 0.04}s` }}
                                >
                                    <div className="sb-cell sb-rank">
                                        {ath.total > 0 && globalIdx < 3 ? (
                                            <div className={`sb-medal-icon sb-medal-icon-${globalIdx + 1}`}>
                                                {globalIdx + 1}
                                            </div>
                                        ) : (
                                            <span className="sb-rank-num">{ath.total > 0 ? globalIdx + 1 : '\u2014'}</span>
                                        )}
                                    </div>
                                    <div className="sb-cell sb-name-cell">
                                        <div className="sb-athlete-name">
                                            {ath.ad} {ath.soyad}
                                            {ath.total > 0 && <span className="sb-rank-tag">({globalIdx + 1}.)</span>}
                                        </div>
                                        <div className="sb-athlete-club">{ath.kulup || ath.okul}</div>
                                    </div>
                                    {isApparatusBased ? apparatusList.map(alet => {
                                        const val = ath.appScores[alet.id];
                                        const hasScore = val && val.total > 0;
                                        const isValGecersiz = val?.isGecersiz || val?.isDNS;
                                        return (
                                            <div key={alet.id} className={`sb-cell sb-score-cell ${hasScore ? 'sb-scored' : isValGecersiz ? 'sb-scored sb-gecersiz' : 'sb-pending'}`}>
                                                {hasScore ? (
                                                    <>
                                                        <div className="sb-score-total">{val.total.toFixed(3)}</div>
                                                        <div className="sb-score-de">
                                                            <span className="sb-score-d">D {val.d.toFixed(2)}</span>
                                                            <span className="sb-score-e">E {val.e.toFixed(3)}</span>
                                                        </div>
                                                    </>
                                                ) : isValGecersiz ? (
                                                    <div className="sb-score-total">0.000</div>
                                                ) : '\u2014'}
                                            </div>
                                        );
                                    }) : null}
                                    <div className={`sb-cell sb-total-cell${!isApparatusBased && ath.total > 0 ? ' sb-total-cell--breakdown' : ''}`}>
                                        {ath.total > 0 ? (
                                            <>
                                                <span className="sb-score-total sb-score-total--total">{ath.total.toFixed(3)}</span>
                                                {!isApparatusBased && (() => {
                                                    const sc = ath.appScores['_total'];
                                                    return (
                                                        <div className="sb-score-de">
                                                            {sc?.d > 0 && <span className="sb-score-d">D {sc.d.toFixed(2)}</span>}
                                                            {sc?.e > 0 && <span className="sb-score-e">E {sc.e.toFixed(3)}</span>}
                                                            {sc?.a > 0 && <span className="sb-score-a">A {sc.a.toFixed(3)}</span>}
                                                        </div>
                                                    );
                                                })()}
                                            </>
                                        ) : (ath.isGecersiz || ath.isDNS) ? (
                                            <span className="sb-score-total sb-score-total--total">0.000</span>
                                        ) : '\u2014'}
                                    </div>
                                </div>
                            );
                        })
                    )
                )}
            </div>

            {/* FLASH OVERLAY */}
            <div className={`sb-flash ${isFlashing ? 'sb-flash-visible' : ''}`}>
                {flashData && (
                    <div className="sb-flash-card">
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

                        <div className={`sf-total ${flashPhase >= 3 ? 'sf-reveal-total' : ''}`}>
                            <span className="sf-total-value">{parseFloat(flashData.total || 0).toFixed(3)}</span>
                        </div>

                        <div className="sf-timer">
                            <div className="sf-timer-bar" />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
