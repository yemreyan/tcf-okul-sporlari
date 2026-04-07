import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ref, onValue, set, remove, push, get } from "firebase/database";
import { db } from "../lib/firebase";
// XLSX — sadece Excel export sırasında dynamic import ile yüklenir
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { useDiscipline } from '../lib/DisciplineContext';
import { filterCompetitionsArrayByUser } from '../lib/useFilteredCompetitions';
import "./FinalsPage.css";

const APPARATUS_INFO = {
    yer: { tr: 'Yer', en: 'FX', bg: '#fef3c7', color: '#d97706' },
    atlama: { tr: 'Atlama', en: 'VT', bg: '#fee2e2', color: '#dc2626' },
    barfiks: { tr: 'Barfiks', en: 'HB', bg: '#e0f2fe', color: '#0284c7' },
    denge: { tr: 'Denge', en: 'BB', bg: '#f3e8ff', color: '#9333ea' },
    asimetrik: { tr: 'As. Paralel', en: 'UB', bg: '#fce7f3', color: '#db2777' },
    halka: { tr: 'Halka', en: 'SR', bg: '#ffedd5', color: '#ea580c' },
    kulplu: { tr: 'Kulplu Beygir', en: 'PH', bg: '#dcfce7', color: '#16a34a' },
    paralel: { tr: 'Paralel', en: 'PB', bg: '#e0e7ff', color: '#4f46e5' },
    sirik: { tr: 'Sırık', en: 'PV', bg: '#f3f4f6', color: '#4b5563' },
    mantar: { tr: 'Mantar', en: 'MB', bg: '#dcfce7', color: '#16a34a' }
};

export default function FinalsPage() {
    const navigate = useNavigate();
    const { currentUser, hasPermission } = useAuth();
    const { toast, confirm } = useNotification();
    const { firebasePath, routePrefix, hasApparatus } = useDiscipline();
    const [competitions, setCompetitions] = useState([]);
    const [selectedCity, setSelectedCity] = useState('');
    const [selectedCompId, setSelectedCompId] = useState("");
    const [competitionData, setCompetitionData] = useState(null);
    const [selectedCategoryId, setSelectedCategoryId] = useState("");
    const [categoryAthletes, setCategoryAthletes] = useState({});
    const [categoryScores, setCategoryScores] = useState({});
    const [globalAthletes, setGlobalAthletes] = useState({});

    const [teamDeductions, setTeamDeductions] = useState({});
    const [activeTab, setActiveTab] = useState("all-around");

    const [excludedTeams, setExcludedTeams] = useState(new Set());

    const [isDeductionModalOpen, setIsDeductionModalOpen] = useState(false);
    const [deductionForm, setDeductionForm] = useState({ team: "", amount: "", reason: "" });

    // 1. Fetch Competitions List
    useEffect(() => {
        const compsRef = ref(db, firebasePath);
        const unsubscribeComps = onValue(compsRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                const list = Object.keys(data).map((key) => ({
                    id: key,
                    ...data[key],
                })).sort((a, b) => new Date(b.tarih || b.baslangicTarihi || 0) - new Date(a.tarih || a.baslangicTarihi || 0));
                setCompetitions(filterCompetitionsArrayByUser(list, currentUser));
            }
        });

        const globalAthletesRef = ref(db, "globalSporcular");
        const unsubscribeGlobal = onValue(globalAthletesRef, (snapshot) => {
            setGlobalAthletes(snapshot.val() || {});
        });

        return () => {
            unsubscribeComps();
            unsubscribeGlobal();
        };
    }, [currentUser, firebasePath]);

    const availableCities = [...new Set(competitions.map(c => (c.il || c.city || '').toLocaleUpperCase('tr-TR')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr-TR'));
    const filteredCompetitions = selectedCity ? competitions.filter(c => (c.il || c.city || '').toLocaleUpperCase('tr-TR') === selectedCity) : competitions;

    // 2. Load Selected Competition Data
    // Sadece meta node'ları dinle (kategoriler, teamDeductions, isim vb.)
    // Tüm yarışma node'unu dinlemek, her puan girişinde yeniden render'a neden oluyordu
    useEffect(() => {
        if (!selectedCompId) {
            setCompetitionData(null);
            setSelectedCategoryId("");
            return;
        }

        const compRef = ref(db, `${firebasePath}/${selectedCompId}`);
        const unsubscribeComp = onValue(compRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                // puanlar ve sporcular zaten ayrı effect'lerden geliyor,
                // competitionData'ya yazılmıyor — gereksiz re-render engellendi
                const { puanlar: _p, sporcular: _s, ...meta } = data;
                setCompetitionData(meta);
                setTeamDeductions(data.teamDeductions || {});
            } else {
                setCompetitionData(null);
            }
        });

        return () => unsubscribeComp();
    }, [selectedCompId, firebasePath]);

    // Yarışma yüklendiğinde varsayılan kategoriyi bir kez seç
    // (onValue callback'inden ayrıldı — stale closure hatası önlendi)
    useEffect(() => {
        if (competitionData?.kategoriler && !selectedCategoryId) {
            setSelectedCategoryId(Object.keys(competitionData.kategoriler)[0]);
        }
    }, [competitionData, selectedCategoryId]);

    // 3. Load Athletes and Scores
    useEffect(() => {
        if (!selectedCompId || !selectedCategoryId) {
            setCategoryAthletes({});
            setCategoryScores({});
            return;
        }

        const athletesRef = ref(db, `${firebasePath}/${selectedCompId}/sporcular/${selectedCategoryId}`);
        const scoresRef = ref(db, `${firebasePath}/${selectedCompId}/puanlar/${selectedCategoryId}`);

        const unsubAthletes = onValue(athletesRef, snap => setCategoryAthletes(snap.val() || {}));
        const unsubScores = onValue(scoresRef, snap => setCategoryScores(snap.val() || {}));

        return () => {
            unsubAthletes();
            unsubScores();
        };
    }, [selectedCompId, selectedCategoryId]);

    // 4. Data Processing Logic (Derived State)
    const fullResults = useMemo(() => {
        if (!competitionData || !selectedCategoryId) return [];

        const catData = competitionData.kategoriler?.[selectedCategoryId];
        if (!catData || !catData.aletler) return [];

        let rawAletler = catData.aletler;
        let apparatusKeys = [];
        if (Array.isArray(rawAletler)) {
            apparatusKeys = rawAletler.map(a => typeof a === 'object' ? a.id || a.value : a);
        } else {
            apparatusKeys = Object.keys(rawAletler);
        }

        let participantIds = Object.keys(categoryAthletes);
        let useGlobalAthletes = false;

        if (participantIds.length === 0 && competitionData.katilimcilar) {
            participantIds = Object.keys(competitionData.katilimcilar);
            useGlobalAthletes = true;
        }

        const sortedResults = participantIds.map(id => {
            const athlete = useGlobalAthletes ? globalAthletes[id] : categoryAthletes[id];
            if (!athlete) return null;

            if (useGlobalAthletes && athlete.kategori) {
                const normSelected = (catData.name || catData.ad || selectedCategoryId).toLowerCase().replace(/[^a-z0-9]/g, '');
                const normAth = athlete.kategori.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (normSelected !== normAth) return null;
            }

            let totalScore = 0;
            const scores = {};
            const allScoreDetails = {};

            apparatusKeys.forEach(key => {
                let scoreData = categoryScores[key]?.[id];
                if (!scoreData && categoryScores[id]?.[`${key}Puanlari`]) {
                    const oldData = categoryScores[id][`${key}Puanlari`];
                    scoreData = { finalScore: oldData.sonuc || oldData.sonPuan || 0, dScore: oldData.dToplami || oldData.dPuani || 0, eScore: oldData.ePuani || 0, neutralDeductions: oldData.tarafsiz || oldData.TarafsizKesinti || 0 };
                }
                if (!scoreData && competitionData.cimnastikVerileri?.[`${key}Puanlari`]?.[id]) {
                    const superOldData = competitionData.cimnastikVerileri[`${key}Puanlari`][id];
                    scoreData = { finalScore: superOldData.sonPuan || superOldData.sonuc || 0, dScore: superOldData.dToplami || superOldData.dPuani || 0, eScore: superOldData.ePuani || 0, neutralDeductions: superOldData.TarafsizKesinti || superOldData.eksikElementKesintisi || 0 };
                }

                let finalScoreVal = scoreData?.finalScore || scoreData?.sonuc || scoreData?.sonPuan || 0;
                let dScoreVal = scoreData?.dScore || scoreData?.calc_D || scoreData?.dToplami || scoreData?.dPuani || 0;
                let eScoreVal = scoreData?.eScore || scoreData?.calc_E || scoreData?.ePuani || 0;
                let penVal = scoreData?.neutralDeductions || scoreData?.calc_MissingPen || scoreData?.tarafsiz || scoreData?.TarafsizKesinti || 0;

                const score = parseFloat(finalScoreVal || 0);
                const isGecersiz = !!(scoreData?.gecersiz);
                const isDNS = !!(scoreData?.yarismadi);
                scores[key] = score;

                const detail = {
                    final: score,
                    D: parseFloat(dScoreVal || 0),
                    E: parseFloat(eScoreVal || 0),
                    P: parseFloat(penVal || 0),
                    ME: 0,
                    isGecersiz,
                    isDNS,
                };
                allScoreDetails[key] = detail;
                totalScore += score;
            });

            return { ...athlete, okul: athlete.okul || athlete.kulup || '', scores, allScoreDetails, totalScore, id };
        }).filter(r => r !== null).sort((a, b) => b.totalScore - a.totalScore);

        let lastS = -1;
        let lastR = 0;
        const rankedResults = sortedResults.map((res, index) => {
            if (res.totalScore !== lastS) { lastR = index + 1; }
            lastS = res.totalScore;
            return { ...res, totalRank: lastR };
        });

        // Apparatus Ranks
        const apparatusRanks = {};
        apparatusKeys.forEach(key => {
            const scoredAthletes = [...rankedResults].filter(r => r.scores[key] > 0);
            scoredAthletes.sort((a, b) => b.scores[key] - a.scores[key]);
            let lsVal = -Infinity;
            let lrVal = 0;
            scoredAthletes.forEach((result, idx) => {
                const sVal = result.scores[key];
                if (sVal !== lsVal) { lrVal = idx + 1; }
                if (!apparatusRanks[result.id]) apparatusRanks[result.id] = {};
                apparatusRanks[result.id][key] = lrVal;
                lsVal = sVal;
            });
        });

        return rankedResults.map(r => ({ ...r, apparatusRanks: apparatusRanks[r.id] || {} }));
    }, [competitionData, selectedCategoryId, categoryAthletes, categoryScores, globalAthletes]);

    const formatScore = (s) => {
        const score = Number(s);
        if (s === null || s === undefined || isNaN(score)) return '0.000';
        return score.toFixed(3);
    };

    // Render Helpers
    const getMedalClass = (rank) => {
        if (rank === 1) return 'row-gold';
        if (rank === 2) return 'row-silver';
        if (rank === 3) return 'row-bronze';
        return '';
    };

    const categoryData = competitionData?.kategoriler?.[selectedCategoryId];
    let apparatusKeys = [];
    if (categoryData?.aletler) {
        if (Array.isArray(categoryData.aletler)) {
            apparatusKeys = categoryData.aletler.map(a => typeof a === 'object' ? a.id || a.value : a);
        } else {
            apparatusKeys = Object.keys(categoryData.aletler);
        }
    }

    // Teams Processing
    const computeTeamResults = () => {
        const filteredResults = fullResults.filter(res => {
            if (excludedTeams.has(res.okul)) return false;
            const t = (res.yarismaTuru || res.katilimTuru || '').toLowerCase();
            return t === 'takim' || t === 'takım';
        });
        const clubScores = {};

        filteredResults.forEach(res => {
            if (!res.okul) return;
            if (!clubScores[res.okul]) {
                clubScores[res.okul] = { name: res.okul, scores: {} };
                apparatusKeys.forEach(key => clubScores[res.okul].scores[key] = []);
            }
            apparatusKeys.forEach(key => clubScores[res.okul].scores[key].push(res.scores[key]));
        });

        const teamList = Object.values(clubScores).map(team => {
            let totalScore = 0;
            const topScores = (arr) => [...arr].sort((a, b) => b - a).slice(0, 3).reduce((sum, s) => sum + s, 0);
            const apparatusTotals = {};

            apparatusKeys.forEach(key => {
                const appTotal = topScores(team.scores[key]);
                apparatusTotals[key] = appTotal;
                totalScore += appTotal;
            });

            const deductionTotal = Object.values(teamDeductions)
                .filter(d => d.teamName === team.name)
                .reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);

            const finalScore = totalScore - deductionTotal;

            return {
                name: team.name,
                apparatusTotals,
                totalScore,
                deduction: deductionTotal,
                finalScore
            };
        }).sort((a, b) => b.finalScore - a.finalScore);

        let lastTS = -1;
        let lastTR = 0;
        return teamList.map((team, index) => {
            if (team.finalScore !== lastTS) {
                lastTR = index + 1;
            }
            lastTS = team.finalScore;
            return { ...team, rank: lastTR };
        });
    };

    const uniqueTeams = [...new Set(fullResults.map(r => r.okul).filter(Boolean))].sort();

    // Deductions Handlers
    const handleAddDeduction = async (e) => {
        e.preventDefault();
        if (!deductionForm.team || !deductionForm.amount || !deductionForm.reason) return;

        const amountNum = parseFloat(deductionForm.amount.replace(',', '.'));
        if (isNaN(amountNum) || amountNum <= 0) {
            toast("Ceza puanı geçerli bir sayı olmalıdır.", "warning");
            return;
        }

        try {
            const deductionRef = ref(db, `${firebasePath}/${selectedCompId}/teamDeductions`);
            const newDeductionRef = push(deductionRef);
            await set(newDeductionRef, {
                teamName: deductionForm.team,
                amount: amountNum.toFixed(3),
                reason: deductionForm.reason,
                timestamp: new Date().toISOString()
            });
            setDeductionForm({ team: "", amount: "", reason: "" });
            setIsDeductionModalOpen(false);
        } catch (err) {
            console.error("Ceza eklenirken hata oluştu:", err);
            toast("Ceza kaydedilemedi!", "error");
        }
    };

    const handleDeleteDeduction = async (deductionId) => {
        const confirmed = await confirm("Bu cezayı silmek istediğinize emin misiniz?", { title: "Silme Onayı", type: "danger" });
        if (confirmed) {
            try {
                const refPath = `${firebasePath}/${selectedCompId}/teamDeductions/${deductionId}`;
                await remove(ref(db, refPath));
            } catch (err) {
                console.error("Ceza silinirken hata:", err);
            }
        }
    };

    // Export Data Processor Helpers
    const fetchAllExportData = async () => {
        const compAthletesRef = ref(db, `${firebasePath}/${selectedCompId}/sporcular`);
        const compScoresRef = ref(db, `${firebasePath}/${selectedCompId}/puanlar`);
        const [athSnap, scoSnap] = await Promise.all([get(compAthletesRef), get(compScoresRef)]);
        return { compAthletes: athSnap.val() || {}, compScores: scoSnap.val() || {} };
    };

    const computeCategoryResults = (catId, catData, compAthletes, compScores) => {
        let apparatusKeysList = [];
        if (Array.isArray(catData?.aletler)) {
            apparatusKeysList = catData.aletler.map(a => typeof a === 'object' ? a.id || a.value : a);
        } else {
            apparatusKeysList = Object.keys(catData?.aletler || {});
        }

        let catAth = compAthletes[catId] || {};
        let catSco = compScores[catId] || {};
        let participantIds = Object.keys(catAth);
        let useGlobalAthletes = false;

        if (participantIds.length === 0 && competitionData.katilimcilar) {
            participantIds = Object.keys(competitionData.katilimcilar);
            useGlobalAthletes = true;
        }

        const sortedC = participantIds.map(id => {
            const athlete = useGlobalAthletes ? globalAthletes[id] : catAth[id];
            if (!athlete) return null;

            if (useGlobalAthletes && athlete.kategori) {
                const normSelected = (catData.name || catData.ad || catId).toLowerCase().replace(/[^a-z0-9]/g, '');
                const normAth = athlete.kategori.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (normSelected !== normAth) return null;
            }

            let totalScore = 0;
            const scores = {};
            const allScoreDetails = {};

            apparatusKeysList.forEach(key => {
                let scoreData = catSco[key]?.[id];
                if (!scoreData && catSco[id]?.[`${key}Puanlari`]) {
                    const oldData = catSco[id][`${key}Puanlari`];
                    scoreData = { finalScore: oldData.sonuc || oldData.sonPuan || 0, dScore: oldData.dToplami || oldData.dPuani || 0, eScore: oldData.ePuani || 0, neutralDeductions: oldData.tarafsiz || oldData.TarafsizKesinti || 0 };
                }
                if (!scoreData && competitionData.cimnastikVerileri?.[`${key}Puanlari`]?.[id]) {
                    const superOldData = competitionData.cimnastikVerileri[`${key}Puanlari`][id];
                    scoreData = { finalScore: superOldData.sonPuan || superOldData.sonuc || 0, dScore: superOldData.dToplami || superOldData.dPuani || 0, eScore: superOldData.ePuani || 0, neutralDeductions: superOldData.TarafsizKesinti || superOldData.eksikElementKesintisi || 0 };
                }

                let finalScoreVal = scoreData?.finalScore || scoreData?.sonuc || scoreData?.sonPuan || 0;
                let dScoreVal = scoreData?.dScore || scoreData?.calc_D || scoreData?.dToplami || scoreData?.dPuani || 0;
                let eScoreVal = scoreData?.eScore || scoreData?.calc_E || scoreData?.ePuani || 0;
                let penVal = scoreData?.neutralDeductions || scoreData?.calc_MissingPen || scoreData?.tarafsiz || scoreData?.TarafsizKesinti || 0;

                const score = parseFloat(finalScoreVal || 0);
                scores[key] = score;

                const isGecersiz = !!(scoreData?.gecersiz);
                const isDNS = !!(scoreData?.yarismadi);
                allScoreDetails[key] = { final: score, D: parseFloat(dScoreVal || 0), E: parseFloat(eScoreVal || 0), P: parseFloat(penVal || 0), ME: 0, isGecersiz, isDNS };
                totalScore += score;
            });

            return { ...athlete, okul: athlete.okul || athlete.kulup || '', scores, allScoreDetails, totalScore, id };
        }).filter(r => r !== null).sort((a, b) => b.totalScore - a.totalScore);

        let ls = -1;
        let lr = 0;
        const rankedResults = sortedC.map((res, index) => {
            if (res.totalScore !== ls) {
                lr = index + 1;
            }
            ls = res.totalScore;
            return { ...res, totalRank: lr };
        });

        const apparatusRanks = {};
        apparatusKeysList.forEach(key => {
            const scoredAthletes = [...rankedResults].filter(r => r.scores[key] > 0);
            scoredAthletes.sort((a, b) => b.scores[key] - a.scores[key]);
            let lScore = -Infinity;
            let lRank = 0;
            scoredAthletes.forEach((result, idx) => {
                const sVal = result.scores[key];
                if (sVal !== lScore) { lRank = idx + 1; }
                if (!apparatusRanks[result.id]) apparatusRanks[result.id] = {};
                apparatusRanks[result.id][key] = lRank;
                lScore = sVal;
            });
        });

        const results = rankedResults.map(r => ({ ...r, apparatusRanks: apparatusRanks[r.id] || {} }));
        const teamResults = computeCatTeamResults(results, apparatusKeysList);
        return { results, teamResults, apparatusKeysList, catName: catData.name || catData.ad || catId };
    };

    const computeCatTeamResults = (resultsArr, appKeys) => {
        const filtered = resultsArr.filter(res => {
            if (excludedTeams.has(res.okul)) return false;
            const t = (res.yarismaTuru || res.katilimTuru || '').toLowerCase();
            return t === 'takim' || t === 'takım';
        });
        const clubScores = {};

        filtered.forEach(res => {
            if (!res.okul) return;
            if (!clubScores[res.okul]) {
                clubScores[res.okul] = { name: res.okul, scores: {} };
                appKeys.forEach(k => clubScores[res.okul].scores[k] = []);
            }
            appKeys.forEach(k => clubScores[res.okul].scores[k].push(res.scores[k]));
        });

        const teamsList = Object.values(clubScores).map(team => {
            let total = 0;
            const topScores = (arr) => [...arr].sort((a, b) => b - a).slice(0, 3).reduce((s, x) => s + x, 0);
            const appTotals = {};
            appKeys.forEach(k => {
                const t = topScores(team.scores[k]);
                appTotals[k] = t;
                total += t;
            });

            const dTotal = Object.values(teamDeductions || {})
                .filter(d => d.teamName === team.name)
                .reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);
            
            return { name: team.name, apparatusTotals: appTotals, totalScore: total, deduction: dTotal, finalScore: total - dTotal };
        }).sort((a, b) => b.finalScore - a.finalScore);

        let ctLastS = -1;
        let ctLastR = 0;
        return teamsList.map((team, index) => {
            if (team.finalScore !== ctLastS) {
                ctLastR = index + 1;
            }
            ctLastS = team.finalScore;
            return { ...team, rank: ctLastR };
        });
    };

    // Export handlers
    const handleExportPDF = async () => {
        if (!competitionData) return;
        toast("PDF hazırlanıyor, lütfen bekleyin...", "info");

        try {
            const { jsPDF } = await import("jspdf");
            const autotablePkg = await import("jspdf-autotable");
            const autoTable = autotablePkg.default || autotablePkg;
            const doc = new jsPDF("landscape", "mm", "a4");
            const { compAthletes, compScores } = await fetchAllExportData();

            // Load logo
            let logoData = null;
            try {
                const resp = await fetch('/logo.png');
                const blob = await resp.blob();
                logoData = await new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });
            } catch (e) { /* logo optional */ }

            const normalizeTR = (text) => {
                if (typeof text !== 'string') return String(text || '');
                return text.replace(/İ/g, 'I').replace(/ı/g, 'i').replace(/Ş/g, 'S').replace(/ş/g, 's')
                           .replace(/Ğ/g, 'G').replace(/ğ/g, 'g').replace(/Ü/g, 'U').replace(/ü/g, 'u')
                           .replace(/Ö/g, 'O').replace(/ö/g, 'o').replace(/Ç/g, 'C').replace(/ç/g, 'c');
            };

            const fmtScore = (s) => {
                const score = Number(s);
                if (s === null || s === undefined || isNaN(score)) return '0,000';
                return score.toFixed(3).replace('.', ',');
            };

            const pageW = 297;
            const pageH = 210;
            const mg = 10;
            let pageCount = 0;

            // Competition info
            const compName = normalizeTR(competitionData.isim || '');
            const compCity = normalizeTR(competitionData.il || '');
            const compDateRaw = competitionData.tarih || competitionData.baslangicTarihi || '';
            const compEndRaw = competitionData.bitisTarihi || '';
            let dateStr = '';
            try {
                if (compDateRaw) {
                    const d1 = new Date(compDateRaw);
                    const d2 = compEndRaw ? new Date(compEndRaw) : null;
                    const fmt = (d) => `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getFullYear()}`;
                    dateStr = d2 && d2.getTime() !== d1.getTime() ? `${fmt(d1)} - ${fmt(d2)}` : fmt(d1);
                }
            } catch(e) { dateStr = compDateRaw; }

            const drawHeader = (catName, subtitle) => {
                if (pageCount > 0) doc.addPage();
                pageCount++;

                const headerH = 40;
                const centerX = pageW / 2;

                // Border box
                doc.setDrawColor(0, 56, 117);
                doc.setLineWidth(0.6);
                doc.rect(mg, 5, pageW - 2 * mg, headerH, 'S');

                // Thin inner line separating logo area
                doc.setDrawColor(200, 210, 220);
                doc.setLineWidth(0.2);
                doc.line(mg + 30, 5, mg + 30, 5 + headerH);
                doc.line(pageW - mg - 30, 5, pageW - mg - 30, 5 + headerH);

                // Logo left
                if (logoData) {
                    try { doc.addImage(logoData, 'PNG', mg + 4, 9, 22, 22); } catch(e) {}
                }

                // Center text
                doc.setFont("helvetica", "bold");
                doc.setFontSize(13);
                doc.setTextColor(0, 56, 117);
                doc.text(normalizeTR("TURKIYE CIMNASTIK FEDERASYONU"), centerX, 14, { align: 'center' });

                doc.setFont("helvetica", "normal");
                doc.setFontSize(9);
                doc.setTextColor(30, 41, 59);
                doc.text(compName, centerX, 20, { align: 'center' });

                if (dateStr || compCity) {
                    doc.text(normalizeTR(`${dateStr}${compCity ? ' / ' + compCity : ''}`), centerX, 25, { align: 'center' });
                }

                doc.setFont("helvetica", "bold");
                doc.setFontSize(12);
                doc.setTextColor(0, 56, 117);
                doc.text(normalizeTR(catName.toUpperCase()), centerX, 32, { align: 'center' });

                doc.setFontSize(10);
                doc.text(normalizeTR(subtitle), centerX, 38, { align: 'center' });

                // Logo right (same logo mirrored)
                if (logoData) {
                    try { doc.addImage(logoData, 'PNG', pageW - mg - 26, 9, 22, 22); } catch(e) {}
                }
            };

            // Table styles matching screenshot
            const headStyles = {
                fillColor: [0, 56, 117],
                textColor: [255, 255, 255],
                fontStyle: 'bold',
                halign: 'center',
                valign: 'middle',
                fontSize: 8,
                cellPadding: 3,
                lineWidth: 0.2,
                lineColor: [0, 56, 117]
            };
            const bodyStyles = {
                textColor: [15, 23, 42],
                fontSize: 8.5,
                valign: 'middle',
                lineWidth: 0.1,
                lineColor: [200, 210, 220],
                cellPadding: 2.5
            };
            const alternateRowStyles = { fillColor: [240, 244, 248] };

            const medalRowStyle = (data) => {
                if (data.section === 'body' && data.row.index < 3) {
                    const medals = [[255, 215, 0, 0.15], [192, 192, 192, 0.18], [205, 127, 50, 0.14]];
                    const [r, g, b, a] = medals[data.row.index];
                    data.cell.styles.fillColor = [Math.round(255 - (255 - r) * a), Math.round(255 - (255 - g) * a), Math.round(255 - (255 - b) * a)];
                }
            };

            const categoryIds = Object.keys(competitionData.kategoriler || {});

            categoryIds.forEach((cId) => {
                const catData = competitionData.kategoriler[cId];
                const { results, teamResults, apparatusKeysList, catName } = computeCategoryResults(cId, catData, compAthletes, compScores);

                // Skip if no athlete has any score
                const scoredResults = results.filter(r => r.totalScore > 0);
                if (scoredResults.length === 0) return;

                const appCount = apparatusKeysList.length;

                // ── BIREYSEL GENEL TASNIF ──
                drawHeader(catName, 'GENEL TASNIF');

                const indHead = [[
                    'Sira', 'Adi', 'Soyadi', 'Okul',
                    ...apparatusKeysList.map(k => {
                        const info = APPARATUS_INFO[k];
                        return info ? normalizeTR(info.en) : normalizeTR(k);
                    }),
                    'Toplam'
                ]];

                const indBody = scoredResults.map((r) => {
                    const row = [
                        `${r.totalRank}-`,
                        normalizeTR((r.ad || '').toUpperCase()),
                        normalizeTR((r.soyad || '').toUpperCase()),
                        normalizeTR(r.okul || r.kulup || '-')
                    ];
                    apparatusKeysList.forEach(k => {
                        const score = r.allScoreDetails[k]?.final || 0;
                        row.push(fmtScore(score));
                    });
                    row.push(fmtScore(r.totalScore));
                    return row;
                });

                const indColStyles = {
                    0: { halign: 'center', cellWidth: 12, fontStyle: 'bold' },
                    1: { cellWidth: 30, fontStyle: 'bold' },
                    2: { cellWidth: 30, fontStyle: 'bold' },
                    3: { cellWidth: 42 }
                };
                for (let i = 0; i < appCount; i++) {
                    indColStyles[4 + i] = { halign: 'center' };
                }
                indColStyles[4 + appCount] = { halign: 'center', fontStyle: 'bold', cellWidth: 18 };

                autoTable(doc, {
                    startY: 50,
                    head: indHead,
                    body: indBody,
                    theme: 'grid',
                    headStyles,
                    bodyStyles,
                    alternateRowStyles,
                    margin: { left: mg, right: mg },
                    columnStyles: indColStyles,
                    didParseCell: function(data) { medalRowStyle(data); }
                });

                // ── TAKIM GENEL TASNIF ──
                if (teamResults.length > 0) {
                    drawHeader(catName, 'TAKIM TASNIF');

                    const teamHead = [[
                        'Sira', 'Takim',
                        ...apparatusKeysList.map(k => {
                            const info = APPARATUS_INFO[k];
                            return info ? normalizeTR(info.en) : normalizeTR(k);
                        }),
                        'Alet Top.', 'Kesinti', 'Net Skor'
                    ]];

                    const teamBody = teamResults.map((t) => {
                        const row = [`${t.rank}-`, normalizeTR(t.name)];
                        apparatusKeysList.forEach(k => row.push(fmtScore(t.apparatusTotals[k])));
                        row.push(fmtScore(t.totalScore));
                        row.push(t.deduction > 0 ? `-${fmtScore(t.deduction)}` : '0,000');
                        row.push(fmtScore(t.finalScore));
                        return row;
                    });

                    const teamColStyles = {
                        0: { halign: 'center', cellWidth: 12, fontStyle: 'bold' },
                        1: { cellWidth: 55, fontStyle: 'bold' }
                    };
                    for (let i = 0; i < appCount; i++) {
                        teamColStyles[2 + i] = { halign: 'center' };
                    }
                    teamColStyles[2 + appCount] = { halign: 'center' };
                    teamColStyles[3 + appCount] = { halign: 'center', textColor: [220, 38, 38] };
                    teamColStyles[4 + appCount] = { halign: 'center', fontStyle: 'bold' };

                    autoTable(doc, {
                        startY: 50,
                        head: teamHead,
                        body: teamBody,
                        theme: 'grid',
                        headStyles,
                        bodyStyles,
                        alternateRowStyles,
                        margin: { left: mg, right: mg },
                        columnStyles: teamColStyles,
                        didParseCell: function(data) { medalRowStyle(data); }
                    });
                }
            });

            if (pageCount === 0) {
                toast("Dışa aktarılacak veri bulunamadı.", "warning");
                return;
            }

            // Page numbers
            const totalPages = doc.internal.getNumberOfPages();
            for (let i = 1; i <= totalPages; i++) {
                doc.setPage(i);
                doc.setFontSize(8);
                doc.setTextColor(150, 150, 150);
                doc.text(`Sayfa ${i} / ${totalPages}`, pageW - mg, pageH - 6, { align: 'right' });
            }

            const fName = normalizeTR(competitionData.isim || 'sonuclar').replace(/[^a-z0-9]/gi, '_').toLowerCase();
            doc.save(`${fName}_sonuclar.pdf`);
            toast("PDF başarıyla indirildi.", "success");
        } catch (error) {
            console.error("PDF Export Error:", error);
            toast("PDF oluşturulurken bir hata oluştu.", "error");
        }
    };

    const handleExportExcel = async () => {
        if (!competitionData) return;
        toast("Excel hazırlanıyor, lütfen bekleyin...", "info");

        try {
            const XLSX = await import("xlsx");
            const { compAthletes, compScores } = await fetchAllExportData();
            const wb = XLSX.utils.book_new();
            
            let hasAnyData = false;
            const categoryIds = Object.keys(competitionData.kategoriler || {});

            categoryIds.forEach((cId) => {
                const catData = competitionData.kategoriler[cId];
                const { results, teamResults, apparatusKeysList, catName } = computeCategoryResults(cId, catData, compAthletes, compScores);
                if (results.length === 0 && teamResults.length === 0) return;
                hasAnyData = true;

                // Tabname limits: Max 31 chars
                const getSheetName = (str) => {
                    const cleanStr = str.replace(/[^a-zA-Z0-9 ]/g, '').trim();
                    return cleanStr.substring(0, 31);
                };

                if (activeTab === 'all-around') {
                    const exportData = results.map((r) => {
                        const row = {
                            'S.N.': r.totalRank,
                            'Sporcu': `${r.ad} ${r.soyad}`,
                            'Kulüp/Okul': r.okul || '-'
                        };
                        apparatusKeysList.forEach(key => {
                            const val = formatScore(r.allScoreDetails[key]?.final);
                            const rank = r.apparatusRanks[key] || '-';
                            row[`${APPARATUS_INFO[key]?.tr || key} (${APPARATUS_INFO[key]?.en || key})`] = `${val} (${rank})`;
                        });
                        row['Genel Toplam'] = parseFloat(formatScore(r.totalScore));
                        return row;
                    });
                    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportData), getSheetName(`BG_${catName}`));
                } else if (activeTab === 'apparatus') {
                    apparatusKeysList.forEach(key => {
                        const items = results.map(r => ({ ...r, score: r.scores[key] || 0, D: r.allScoreDetails[key]?.D || 0, E: r.allScoreDetails[key]?.E || 0, Pen: (r.allScoreDetails[key]?.P || 0) + (r.allScoreDetails[key]?.ME || 0) })).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
                        const appData = items.map((r) => ({
                            'S.N.': r.apparatusRanks[key] || '-',
                            'Sporcu': `${r.ad} ${r.soyad}`,
                            'Kulüp/Okul': r.okul || '-',
                            'D Puanı': parseFloat(formatScore(r.D)),
                            'E Puanı': parseFloat(formatScore(r.E)),
                            'Ceza': r.Pen > 0 ? -parseFloat(formatScore(r.Pen)) : 0,
                            'Final Puanı': parseFloat(formatScore(r.score))
                        }));
                        if (appData.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(appData), getSheetName(`A_${catName}_${APPARATUS_INFO[key]?.en || key}`));
                    });
                } else if (activeTab === 'team') {
                    const exportTeam = teamResults.map((t) => {
                        const row = {
                            'S.N.': t.rank,
                            'Takım': t.name
                        };
                        apparatusKeysList.forEach(key => row[`${APPARATUS_INFO[key]?.tr || key} (${APPARATUS_INFO[key]?.en || key})`] = parseFloat(formatScore(t.apparatusTotals[key])));
                        row['Alet Toplamı'] = parseFloat(formatScore(t.totalScore));
                        row['Kesinti'] = t.deduction > 0 ? -parseFloat(formatScore(t.deduction)) : 0;
                        row['Net Skor'] = parseFloat(formatScore(t.finalScore));
                        return row;
                    });
                    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportTeam), getSheetName(`T_${catName}`));
                }
            });

            if (!hasAnyData) {
                toast("Dışa aktarılacak veri bulunamadı.", "warning");
                return;
            }

            let titleSuffix = "";
            if (activeTab === 'all-around') titleSuffix = "bireysel";
            if (activeTab === 'apparatus') titleSuffix = "alet_finalleri";
            if (activeTab === 'team') titleSuffix = "takim";

            const fileName = `${competitionData.isim}_Tum_${titleSuffix}.xlsx`.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
            XLSX.writeFile(wb, fileName);
            toast("Excel başarıyla dışa aktarıldı.", "success");
        } catch (error) {
            console.error("Excel Export Error:", error);
            toast("Excel oluşturulurken bir hata oluştu.", "error");
        }
    };

    return (
        <div className="finals-page-wrapper">
            <div className="finals-container">

                {/* Header Section */}
                <div className="classic-card finals-header">
                    <div className="finals-header-left">
                        <button type="button" className="back-btn" onClick={() => navigate(routePrefix)}>
                            <i className="material-icons-round">arrow_back</i>
                        </button>
                        <div className="finals-icon">
                            <i className="material-icons-round">emoji_events</i>
                        </div>
                        <div>
                            <h1 className="finals-title">Final Sonuçları</h1>
                            <p className="finals-subtitle">Yarışma sıralamaları, alet finalleri ve PDF raporları</p>
                        </div>
                    </div>
                    <div className="finals-selector">
                        <select
                            value={selectedCity}
                            onChange={(e) => {
                                setSelectedCity(e.target.value);
                                setSelectedCompId('');
                                setSelectedCategoryId('');
                            }}
                            className="classic-select"
                        >
                            <option value="">-- Tüm İller --</option>
                            {availableCities.map(city => (
                                <option key={city} value={city}>{city}</option>
                            ))}
                        </select>
                        <select
                            value={selectedCompId}
                            onChange={(e) => {
                                setSelectedCompId(e.target.value);
                                setSelectedCategoryId("");
                            }}
                            className="classic-select"
                            style={{ marginLeft: '12px' }}
                        >
                            <option value="">-- Yarışma Seçiniz --</option>
                            {filteredCompetitions.map((comp) => (
                                <option key={comp.id} value={comp.id}>
                                    {comp.isim} ({new Date(comp.tarih || comp.baslangicTarihi || 0).toLocaleDateString("tr-TR")})
                                </option>
                            ))}
                        </select>
                        {selectedCompId && competitionData?.kategoriler && (
                            <select
                                value={selectedCategoryId}
                                onChange={(e) => setSelectedCategoryId(e.target.value)}
                                className="classic-select"
                                style={{ marginLeft: '12px' }}
                            >
                                <option value="">-- Kategori Seçiniz --</option>
                                {Object.keys(competitionData.kategoriler).map(catKey => {
                                    const catItem = competitionData.kategoriler[catKey];
                                    const catLabel = catItem.name || catItem.ad || catKey;
                                    return (
                                        <option key={catKey} value={catKey}>
                                            {catLabel}
                                        </option>
                                    );
                                })}
                            </select>
                        )}
                    </div>
                </div>

                {!selectedCompId ? (
                    <div className="finals-empty-state classic-card">
                        <i className="material-icons-round">troubleshoot</i>
                        <h2>Sonuçları Görmek İçin Yarışma Seçin</h2>
                        <p>Yukarıdaki menüden bir yarışma seçerek bireysel, alet ve takım finallerini inceleyebilirsiniz.</p>
                    </div>
                ) : !competitionData ? (
                    <div className="finals-loading classic-card">
                        <div className="spinner"></div>
                        <p>Veriler yükleniyor...</p>
                    </div>
                ) : (
                    <>
                        {/* Actions & Tabs */}
                        <div className="classic-card finals-actions">
                            <div className="finals-tabs">
                                <button className={`tab-btn ${activeTab === 'all-around' ? 'active' : ''}`} onClick={() => setActiveTab('all-around')}>Bireysel Genel Tasnif</button>
                                {hasApparatus && <button className={`tab-btn ${activeTab === 'apparatus' ? 'active' : ''}`} onClick={() => setActiveTab('apparatus')}>Alet Finalleri</button>}
                                <button className={`tab-btn ${activeTab === 'team' ? 'active' : ''}`} onClick={() => setActiveTab('team')}>Takım Genel Tasnif</button>
                            </div>
                            <div className="finals-export-buttons">
                                {hasPermission('finals', 'duzenle') && (
                                    <button className="action-btn penalty-btn" onClick={() => setIsDeductionModalOpen(true)}>
                                        <i className="material-icons-round">remove_circle_outline</i> Takım Cezası
                                    </button>
                                )}
                                <button className="action-btn excel-btn" onClick={handleExportExcel}>
                                    <i className="material-icons-round">table_chart</i> Excel Export
                                </button>
                                <button className="action-btn pdf-btn" onClick={handleExportPDF}>
                                    <i className="material-icons-round">picture_as_pdf</i> PDF İndir
                                </button>
                            </div>
                        </div>

                        {/* TAB CONTENT: ALL AROUND */}
                        {activeTab === 'all-around' && (
                            <div className="finals-card classic-card print-section">
                                <div className="card-header">
                                    <h2>Bireysel Genel Tasnif</h2>
                                    <span className="badge">{fullResults.length} Sporcu</span>
                                </div>
                                <div className="table-responsive">
                                    <table className="classic-table">
                                        <thead>
                                            <tr>
                                                <th className="th-center">S.N.</th>
                                                <th>Soyadı, Adı</th>
                                                <th>Kulüp</th>
                                                {apparatusKeys.map(key => {
                                                    const info = APPARATUS_INFO[key];
                                                    return (
                                                        <th key={key} className="th-center">
                                                            {info ? (
                                                                <div className="app-header-badge" style={{ backgroundColor: info.bg, color: info.color }}>
                                                                    <span className="app-en">{info.en}</span>
                                                                    <span className="app-tr">{info.tr}</span>
                                                                </div>
                                                            ) : key}
                                                        </th>
                                                    )
                                                })}
                                                <th className="th-right th-highlight">Toplam</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {fullResults.map((res) => {
                                                const rank = res.totalRank;
                                                return (
                                                    <tr key={res.id} className={getMedalClass(rank)}>
                                                        <td className="td-center rank-col">
                                                            <span className="rank-badge">{rank}</span>
                                                        </td>
                                                        <td>
                                                            <div className="athlete-name">{res.soyad}, {res.ad}</div>
                                                        </td>
                                                        <td className="team-col">{res.okul || '-'}</td>
                                                        {apparatusKeys.map(key => {
                                                            const detail = res.allScoreDetails[key];
                                                            const penalty = detail.P + detail.ME;
                                                            if (detail.final > 0 || detail.isGecersiz || detail.isDNS) {
                                                                return (
                                                                    <td key={key} className="td-center score-col">
                                                                        <div className="score-header">
                                                                            <span className="main-score">{formatScore(detail.final)}</span>
                                                                            <span className="app-rank-badge" title={`${APPARATUS_INFO[key]?.tr || key} Sıralaması`}>{res.apparatusRanks[key] || '-'}</span>
                                                                        </div>
                                                                        <div className="score-details">
                                                                            <span className="d-val">D:{formatScore(detail.D)}</span>
                                                                            <span className="e-val">E:{formatScore(detail.E)}</span>
                                                                            {penalty > 0 && <span className="p-val">P:-{formatScore(penalty)}</span>}
                                                                        </div>
                                                                    </td>
                                                                )
                                                            }
                                                            return <td key={key} className="td-center text-muted">-</td>;
                                                        })}
                                                        <td className="td-right total-col">{formatScore(res.totalScore)}</td>
                                                    </tr>
                                                );
                                            })}
                                            {fullResults.length === 0 && (
                                                <tr><td colSpan={apparatusKeys.length + 4} className="td-center">Sporcu verisi bulunamadı.</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* TAB CONTENT: APPARATUS FINALS */}
                        {hasApparatus && activeTab === 'apparatus' && (
                            <div className="apparatus-grid print-section">
                                {apparatusKeys.map(key => {
                                    const items = fullResults
                                        .map(r => ({
                                            ...r,
                                            score: r.scores[key] || 0,
                                            D: r.allScoreDetails[key]?.D || 0,
                                            E: r.allScoreDetails[key]?.E || 0,
                                            TotalPenalty: (r.allScoreDetails[key]?.P || 0) + (r.allScoreDetails[key]?.ME || 0)
                                        }))
                                        .filter(r => r.score > 0 || r.allScoreDetails[key]?.isGecersiz || r.allScoreDetails[key]?.isDNS)
                                        .sort((a, b) => b.score - a.score);

                                    return (
                                        <div key={key} className="finals-card classic-card apparatus-card">
                                            <div className="card-header">
                                                <h2 className="app-final-title">
                                                    {APPARATUS_INFO[key] ? (
                                                        <>
                                                            <span className="app-icon-badge" style={{ backgroundColor: APPARATUS_INFO[key].bg, color: APPARATUS_INFO[key].color }}>
                                                                {APPARATUS_INFO[key].en}
                                                            </span>
                                                            <span style={{ marginLeft: '12px' }}>{APPARATUS_INFO[key].tr} Finali</span>
                                                        </>
                                                    ) : `${key} Finali`}
                                                </h2>
                                            </div>
                                            <div className="table-responsive">
                                                <table className="classic-table condensed">
                                                    <thead>
                                                        <tr>
                                                            <th className="th-center">S.N.</th>
                                                            <th>Sporcu</th>
                                                            <th className="th-center">D</th>
                                                            <th className="th-center">E</th>
                                                            <th className="th-center">Ceza</th>
                                                            <th className="th-right th-highlight">Puan</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {items.map((item) => {
                                                            const rank = item.apparatusRanks[key];
                                                            return (
                                                                <tr key={item.id} className={getMedalClass(rank)}>
                                                                    <td className="td-center rank-col"><span className="rank-badge">{rank}</span></td>
                                                                    <td><div className="athlete-name-small">{item.soyad}, {item.ad}</div><div className="team-col-small">{item.okul}</div></td>
                                                                    <td className="td-center">{formatScore(item.D)}</td>
                                                                    <td className="td-center">{formatScore(item.E)}</td>
                                                                    <td className="td-center penalty-text">{item.TotalPenalty > 0 ? `-${formatScore(item.TotalPenalty)}` : '0.000'}</td>
                                                                    <td className="td-right total-col">{formatScore(item.score)}</td>
                                                                </tr>
                                                            );
                                                        })}
                                                        {items.length === 0 && <tr><td colSpan="6" className="td-center text-muted">Alet puanı yok.</td></tr>}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* TAB CONTENT: TEAM ALL AROUND */}
                        {activeTab === 'team' && (
                            <div className="finals-card classic-card print-section">
                                <div className="card-header">
                                    <h2>Takım Genel Tasnif</h2>
                                </div>

                                {/* Team Exclusion Toggles */}
                                <div className="team-exclusion-bar no-print">
                                    <span className="exclusion-label">Sıralamaya Dahil Takımlar:</span>
                                    <div className="exclusion-chips">
                                        {uniqueTeams.map(team => {
                                            const isExcluded = excludedTeams.has(team);
                                            return (
                                                <button
                                                    key={team}
                                                    className={`exclusion-chip ${isExcluded ? 'excluded' : 'included'}`}
                                                    onClick={() => {
                                                        const newSet = new Set(excludedTeams);
                                                        if (isExcluded) newSet.delete(team);
                                                        else newSet.add(team);
                                                        setExcludedTeams(newSet);
                                                    }}
                                                >
                                                    <i className="material-icons-round">{isExcluded ? "visibility_off" : "check_circle"}</i>
                                                    {team}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>

                                <div className="table-responsive mt-6">
                                    <table className="classic-table">
                                        <thead>
                                            <tr>
                                                <th className="th-center">S.N.</th>
                                                <th>Takım</th>
                                                {apparatusKeys.map(key => {
                                                    const info = APPARATUS_INFO[key];
                                                    return (
                                                        <th key={key} className="th-center">
                                                            {info ? (
                                                                <div className="app-header-badge" style={{ backgroundColor: info.bg, color: info.color }}>
                                                                    <span className="app-en">{info.en}</span>
                                                                </div>
                                                            ) : key}
                                                        </th>
                                                    )
                                                })}
                                                <th className="th-right text-muted">Alet Toplamı</th>
                                                <th className="th-center penalty-text">Kesinti</th>
                                                <th className="th-right th-highlight">Net Skor</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {computeTeamResults().map((team) => {
                                                const rank = team.rank;
                                                return (
                                                    <tr key={team.name} className={getMedalClass(rank)}>
                                                        <td className="td-center rank-col"><span className="rank-badge">{rank}</span></td>
                                                        <td className="team-col-bold">{team.name}</td>
                                                        {apparatusKeys.map(key => (
                                                            <td key={key} className="td-center score-col">{formatScore(team.apparatusTotals[key])}</td>
                                                        ))}
                                                        <td className="td-right text-muted">{formatScore(team.totalScore)}</td>
                                                        <td className="td-center penalty-text">{team.deduction > 0 ? `-${formatScore(team.deduction)}` : '0.000'}</td>
                                                        <td className="td-right total-col">{formatScore(team.finalScore)}</td>
                                                    </tr>
                                                )
                                            })}
                                            {computeTeamResults().length === 0 && (
                                                <tr><td colSpan={apparatusKeys.length + 5} className="td-center">Takım verisi bulunamadı.</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* DEDUCTION MODAL */}
            {isDeductionModalOpen && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <div className="modal-header">
                            <div>
                                <h3>Takım Ceza Yönetimi</h3>
                                <p style={{margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)'}}>Kural ihlalleri için takımlardan puan düşün</p>
                            </div>
                            <button className="close-btn" onClick={() => setIsDeductionModalOpen(false)}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>

                        <div className="modal-body">
                            <form onSubmit={handleAddDeduction}>
                                <div className="form-group">
                                    <label>Takım Seçin</label>
                                    <select
                                        value={deductionForm.team}
                                        onChange={e => setDeductionForm({ ...deductionForm, team: e.target.value })}
                                        required
                                    >
                                        <option value="">-- Takım Seçiniz --</option>
                                        {uniqueTeams.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div style={{ display: 'flex', gap: '16px' }}>
                                    <div className="form-group" style={{ flex: 1 }}>
                                        <label>Ceza Puanı</label>
                                        <input
                                            type="number"
                                            step="0.001"
                                            min="0.100"
                                            placeholder="Örn: 0.500"
                                            value={deductionForm.amount}
                                            onChange={e => setDeductionForm({ ...deductionForm, amount: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div className="form-group" style={{ flex: 2 }}>
                                        <label>Ceza Nedeni</label>
                                        <input
                                            type="text"
                                            placeholder="Geç başlama, itiraz vb."
                                            value={deductionForm.reason}
                                            onChange={e => setDeductionForm({ ...deductionForm, reason: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>
                                <div className="modal-footer" style={{ marginTop: '24px' }}>
                                    <button type="submit" className="btn-primary" style={{ width: '100%' }}>Cezayı Kaydet</button>
                                </div>
                            </form>

                            <div className="existing-deductions">
                                <h3>Mevcut Kesintiler</h3>
                                {Object.keys(teamDeductions).length === 0 ? (
                                    <p className="empty-text">Bu yarışma için henüz takım cezası tanımlanmamış.</p>
                                ) : (
                                    <div className="deduction-list">
                                        {Object.entries(teamDeductions).map(([id, d]) => (
                                            <div key={id} className="deduction-item">
                                                <div className="deduction-info">
                                                    <strong>{d.teamName}</strong>
                                                    <span>{d.reason}</span>
                                                </div>
                                                <div className="deduction-action">
                                                    <span className="deduction-value">-{formatScore(d.amount)}</span>
                                                    {hasPermission('finals', 'duzenle') && (
                                                        <button onClick={() => handleDeleteDeduction(id)} title="Cezayı Sil">
                                                            <i className="material-icons-round">delete</i>
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
