import { useState, useEffect, useMemo } from "react";

import { ref, onValue, set, remove, push } from "firebase/database";
import { db } from "../lib/firebase";
import * as XLSX from "xlsx";
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { filterCompetitionsArrayByUser } from '../lib/useFilteredCompetitions';
import "./FinalsPage.css";

const APPARATUS_NAMES = {
    yer: 'Yer',
    atlama: 'Atlama',
    barfiks: 'Barfiks',
    denge: 'Denge',
    asimetrik_paralel: 'As. Paralel',
    halka: 'Halka',
    kulplu_beygir: 'Kulplu Beygir',
    paralel: 'Paralel',
    sirik: 'Sırık'
};

export default function FinalsPage() {
    const { currentUser, hasPermission } = useAuth();
    const { toast, confirm } = useNotification();
    const [competitions, setCompetitions] = useState([]);
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
        const compsRef = ref(db, "competitions");
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
    }, [currentUser]);

    // 2. Load Selected Competition Data
    useEffect(() => {
        if (!selectedCompId) {
            setCompetitionData(null);
            setSelectedCategoryId("");
            return;
        }

        const compRef = ref(db, `competitions/${selectedCompId}`);
        const unsubscribeComp = onValue(compRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                setCompetitionData(data);
                setTeamDeductions(data.teamDeductions || {});

                // Set default category if not selected
                if (!selectedCategoryId && data.kategoriler) {
                    setSelectedCategoryId(Object.keys(data.kategoriler)[0]);
                }
            } else {
                setCompetitionData(null);
            }
        });

        return () => unsubscribeComp();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCompId]);

    // 3. Load Athletes and Scores
    useEffect(() => {
        if (!selectedCompId || !selectedCategoryId) {
            setCategoryAthletes({});
            setCategoryScores({});
            return;
        }

        const athletesRef = ref(db, `competitions/${selectedCompId}/sporcular/${selectedCategoryId}`);
        const scoresRef = ref(db, `competitions/${selectedCompId}/puanlar/${selectedCategoryId}`);

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
            // Legacy schema: aletler is an object { yer: {id: 'yer'}, atlama: {...} }
            apparatusKeys = Object.keys(rawAletler);
        }

        let participantIds = Object.keys(categoryAthletes);
        let useGlobalAthletes = false;

        // Fallback for legacy competitions that map directly to global athletes
        if (participantIds.length === 0 && competitionData.katilimcilar) {
            participantIds = Object.keys(competitionData.katilimcilar);
            useGlobalAthletes = true;
        }

        let initialResults = participantIds.map(id => {
            const athlete = useGlobalAthletes ? globalAthletes[id] : categoryAthletes[id];
            if (!athlete) return null;

            // If using global athletes, we must filter if this athlete actually belongs to the selected category
            if (useGlobalAthletes && athlete.kategori) {
                const normSelected = (catData.name || catData.ad || selectedCategoryId).toLowerCase().replace(/[^a-z0-9]/g, '');
                const normAth = athlete.kategori.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (normSelected !== normAth) return null;
            }

            let totalScore = 0;
            const scores = {};
            const allScoreDetails = {};

            apparatusKeys.forEach(key => {
                let scoreData = categoryScores[key]?.[id]; // New schema: puanlar/[category]/[apparatus]/[athleteId]

                // Legacy schema check: puanlar/[category]/[athleteId]/[apparatusPuanlari]
                if (!scoreData && categoryScores[id]?.[`${key}Puanlari`]) {
                    const oldData = categoryScores[id][`${key}Puanlari`];
                    scoreData = {
                        finalScore: oldData.sonuc || oldData.sonPuan || 0,
                        dScore: oldData.dToplami || oldData.dPuani || 0,
                        eScore: oldData.ePuani || 0,
                        neutralDeductions: oldData.tarafsiz || oldData.TarafsizKesinti || 0
                    };
                }

                // Super Legacy check: cimnastikVerileri/[apparatusPuanlari]/[athleteId]
                if (!scoreData && competitionData.cimnastikVerileri?.[`${key}Puanlari`]?.[id]) {
                    const superOldData = competitionData.cimnastikVerileri[`${key}Puanlari`][id];
                    scoreData = {
                        finalScore: superOldData.sonPuan || superOldData.sonuc || 0,
                        dScore: superOldData.dToplami || superOldData.dPuani || 0,
                        eScore: superOldData.ePuani || 0,
                        neutralDeductions: superOldData.TarafsizKesinti || superOldData.eksikElementKesintisi || 0
                    };
                }

                let finalScoreVal = scoreData?.finalScore || scoreData?.sonuc || scoreData?.sonPuan || 0;
                let dScoreVal = scoreData?.dScore || scoreData?.calc_D || scoreData?.dToplami || scoreData?.dPuani || 0;
                let eScoreVal = scoreData?.eScore || scoreData?.calc_E || scoreData?.ePuani || 0;
                let penVal = scoreData?.neutralDeductions || scoreData?.calc_MissingPen || scoreData?.tarafsiz || scoreData?.TarafsizKesinti || 0;

                const score = parseFloat(finalScoreVal || 0);
                scores[key] = score;

                const detail = {
                    final: score,
                    D: parseFloat(dScoreVal || 0),
                    E: parseFloat(eScoreVal || 0),
                    P: parseFloat(penVal || 0),
                    ME: 0,
                };
                allScoreDetails[key] = detail;
                totalScore += score;
            });

            return { ...athlete, scores, allScoreDetails, totalScore, id };
        }).filter(r => r !== null).sort((a, b) => b.totalScore - a.totalScore);

        // Calculate Apparatus Ranks
        const apparatusRanks = {};
        apparatusKeys.forEach(key => {
            const scoredAthletes = [...initialResults].filter(r => r.scores[key] > 0);
            scoredAthletes.sort((a, b) => b.scores[key] - a.scores[key]);

            let lastScore = -Infinity;
            let lastRank = 0;

            scoredAthletes.forEach((result, index) => {
                const score = result.scores[key];
                if (score !== lastScore) { lastRank = index + 1; }
                if (!apparatusRanks[result.id]) apparatusRanks[result.id] = {};
                apparatusRanks[result.id][key] = lastRank;
                lastScore = score;
            });
        });

        return initialResults.map(r => ({ ...r, apparatusRanks: apparatusRanks[r.id] || {} }));
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
        const filteredResults = fullResults.filter(res => !excludedTeams.has(res.kulup));
        const clubScores = {};

        filteredResults.forEach(res => {
            if (!res.kulup) return;
            if (!clubScores[res.kulup]) {
                clubScores[res.kulup] = { name: res.kulup, scores: {} };
                apparatusKeys.forEach(key => clubScores[res.kulup].scores[key] = []);
            }
            apparatusKeys.forEach(key => clubScores[res.kulup].scores[key].push(res.scores[key]));
        });

        return Object.values(clubScores).map(team => {
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
    };

    const uniqueTeams = [...new Set(fullResults.map(r => r.kulup).filter(Boolean))].sort();

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
            const deductionRef = ref(db, `competitions/${selectedCompId}/teamDeductions`);
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
                const refPath = `competitions/${selectedCompId}/teamDeductions/${deductionId}`;
                await remove(ref(db, refPath));
            } catch (err) {
                console.error("Ceza silinirken hata:", err);
            }
        }
    };

    // Export handlers
    const handlePrint = () => {
        window.print();
    };

    const handleExportExcel = () => {
        if (!competitionData) return;

        const wb = XLSX.utils.book_new();
        const appKeys = categoryData?.aletler || [];

        // 1. All-Around
        const generalData = fullResults.map((r, index) => {
            const row = { 'S.N.': index + 1, 'Soyadı': r.soyad, 'Adı': r.ad, 'Takım': r.kulup };
            appKeys.forEach(key => {
                const detail = r.allScoreDetails[key];
                const penalty = detail.P + detail.ME;
                row[`${APPARATUS_NAMES[key] || key}`] = `Final: ${formatScore(detail.final)} (Sıra: ${r.apparatusRanks[key] || '-'}) | D: ${formatScore(detail.D)} | E: ${formatScore(detail.E)} | Ceza: ${penalty > 0 ? '-' + formatScore(penalty) : '0'}`;
            });
            row['GENEL TOPLAM'] = formatScore(r.totalScore);
            return row;
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(generalData), "1-Bireysel Genel Tasnif");

        // 2. Team
        const teamResults = computeTeamResults();
        const teamData = teamResults.map((t, i) => {
            const row = { 'S.N.': i + 1, 'Takım': t.name };
            appKeys.forEach(key => row[APPARATUS_NAMES[key] || key] = formatScore(t.apparatusTotals[key]));
            row['Toplam'] = formatScore(t.totalScore);
            row['Kesinti'] = t.deduction > 0 ? '-' + formatScore(t.deduction) : '0.000';
            row['Son Skor'] = formatScore(t.finalScore);
            return row;
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(teamData), "2-Takım Sıralaması");

        // 3. Apparatuses
        appKeys.forEach(key => {
            const appResults = fullResults
                .map(r => ({
                    ...r,
                    score: r.scores[key] || 0,
                    D: r.allScoreDetails[key]?.D || 0,
                    E: r.allScoreDetails[key]?.E || 0,
                    TotalPenalty: (r.allScoreDetails[key]?.P || 0) + (r.allScoreDetails[key]?.ME || 0)
                }))
                .filter(r => r.score > 0)
                .sort((a, b) => b.score - a.score);

            const appData = appResults.map((r, index) => ({
                'S.N.': index + 1, 'Soyadı': r.soyad, 'Adı': r.ad, 'Kulüp': r.kulup,
                'D Puanı': formatScore(r.D), 'E Puanı': formatScore(r.E),
                'Ceza Puanı': formatScore(r.TotalPenalty),
                'FINAL PUAN': formatScore(r.score)
            }));
            if (appData.length > 0) {
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(appData), `3-${APPARATUS_NAMES[key] || key} Final`);
            }
        });

        const fName = (competitionData.isim || "Yarisma").replace(/[^a-z0-9]/gi, '_').toLowerCase();
        XLSX.writeFile(wb, `${fName}_SONUC_RAPORU.xlsx`);
    };

    return (
        <div className="finals-page-wrapper">
            <div className="finals-container">

                {/* Header Section */}
                <div className="classic-card finals-header">
                    <div className="finals-header-left">
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
                            value={selectedCompId}
                            onChange={(e) => {
                                setSelectedCompId(e.target.value);
                                setSelectedCategoryId("");
                            }}
                            className="classic-select"
                        >
                            <option value="">-- Yarışma Seçiniz --</option>
                            {competitions.map((comp) => (
                                <option key={comp.id} value={comp.id}>
                                    {comp.isim} ({new Date(comp.tarih).toLocaleDateString("tr-TR")})
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
                                <button className={`tab-btn ${activeTab === 'apparatus' ? 'active' : ''}`} onClick={() => setActiveTab('apparatus')}>Alet Finalleri</button>
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
                                <button className="action-btn pdf-btn" onClick={handlePrint}>
                                    <i className="material-icons-round">picture_as_pdf</i> PDF Yazdır
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
                                                {apparatusKeys.map(key => <th key={key} className="th-center">{APPARATUS_NAMES[key] || key}</th>)}
                                                <th className="th-right th-highlight">Toplam</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {fullResults.map((res, index) => {
                                                const rank = index + 1;
                                                return (
                                                    <tr key={res.id} className={getMedalClass(rank)}>
                                                        <td className="td-center rank-col">
                                                            <span className="rank-badge">{rank}</span>
                                                        </td>
                                                        <td>
                                                            <div className="athlete-name">{res.soyad}, {res.ad}</div>
                                                        </td>
                                                        <td className="team-col">{res.kulup || '-'}</td>
                                                        {apparatusKeys.map(key => {
                                                            const detail = res.allScoreDetails[key];
                                                            const penalty = detail.P + detail.ME;
                                                            if (detail.final > 0) {
                                                                return (
                                                                    <td key={key} className="td-center score-col">
                                                                        <div className="main-score">{formatScore(detail.final)}</div>
                                                                        <div className="score-details">
                                                                            <span>D:{formatScore(detail.D)}</span>
                                                                            <span>E:{formatScore(detail.E)}</span>
                                                                            {penalty > 0 && <span className="penalty">P:-{formatScore(penalty)}</span>}
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
                        {activeTab === 'apparatus' && (
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
                                        .filter(r => r.score > 0)
                                        .sort((a, b) => b.score - a.score);

                                    return (
                                        <div key={key} className="finals-card classic-card apparatus-card">
                                            <div className="card-header">
                                                <h2>{APPARATUS_NAMES[key] || key} Finali</h2>
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
                                                        {items.map((item, index) => {
                                                            const rank = index + 1;
                                                            return (
                                                                <tr key={item.id} className={getMedalClass(rank)}>
                                                                    <td className="td-center rank-col"><span className="rank-badge">{rank}</span></td>
                                                                    <td><div className="athlete-name-small">{item.soyad}, {item.ad}</div><div className="team-col-small">{item.kulup}</div></td>
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
                                                {apparatusKeys.map(key => <th key={key} className="th-center">{APPARATUS_NAMES[key] || key}</th>)}
                                                <th className="th-right text-muted">Alet Toplamı</th>
                                                <th className="th-center penalty-text">Kesinti</th>
                                                <th className="th-right th-highlight">Net Skor</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {computeTeamResults().map((team, index) => {
                                                const rank = index + 1;
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
                <div className="premium-modal-overlay">
                    <div className="premium-modal-dialog">
                        <div className="premium-modal-header">
                            <div className="premium-modal-icon warning">
                                <i className="material-icons-round">gavel</i>
                            </div>
                            <div className="premium-modal-title">
                                <h2>Takım Ceza Yönetimi</h2>
                                <p>Kural ihlalleri için takımlardan puan düşün</p>
                            </div>
                            <button className="premium-modal-close" onClick={() => setIsDeductionModalOpen(false)}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>

                        <div className="premium-modal-body">
                            <form onSubmit={handleAddDeduction} className="premium-form">
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
                                <div className="form-row">
                                    <div className="form-group">
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
                                <div className="form-actions">
                                    <button type="submit" className="premium-btn active penalty-submit-btn">Cezayı Kaydet</button>
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
