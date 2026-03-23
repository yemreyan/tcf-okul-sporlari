import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../lib/firebase';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell, ScatterChart, Scatter, ZAxis, RadarChart, Radar, PolarGrid,
    PolarAngleAxis, PolarRadiusAxis, LineChart, Line
} from 'recharts';
import { useAuth } from '../lib/AuthContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import './AnalyticsPage.css';

const COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];
const GENDER_COLORS = ['#3B82F6', '#EC4899'];

const APPARATUS_NAMES = {
    yer: 'Yer (FX)', atlama: 'Atlama (VT)', paralel: 'Paralel (PB)',
    halka: 'Halka (SR)', kulplu_bey: 'Kulplu B. (PH)', barfiks: 'Barfiks (HB)',
    denge: 'Denge (BB)', asimetrik: 'Asimetrik (UB)',
};

const APPARATUS_ICONS = {
    yer: 'sports_martial_arts', atlama: 'sports_gymnastics', paralel: 'fitness_center',
    halka: 'circle', kulplu_bey: 'fitness_center', barfiks: 'horizontal_rule',
    denge: 'straighten', asimetrik: 'vertical_align_center',
};

function calcStdDev(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sqDiffs = values.map(v => Math.pow(v - mean, 2));
    return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
}

// Tab definitions
const TABS = [
    { id: 'overview', label: 'Genel Bakış', icon: 'dashboard' },
    { id: 'apparatus', label: 'Alet Analizi', icon: 'fitness_center' },
    { id: 'referees', label: 'Hakem Analizi', icon: 'gavel' },
    { id: 'report-card', label: 'Hakem Karnesi', icon: 'assignment' },
];

export default function AnalyticsPage() {
    const navigate = useNavigate();
    const { currentUser } = useAuth();
    const reportCardRef = useRef(null);

    const [loading, setLoading] = useState(true);
    const [rawCompetitions, setRawCompetitions] = useState({});
    const [refereesData, setRefereesData] = useState({});
    const [selectedCompId, setSelectedCompId] = useState('all');
    const [activeTab, setActiveTab] = useState('overview');
    const [selectedReportComp, setSelectedReportComp] = useState('');

    useEffect(() => {
        const compsRef = ref(db, 'competitions');
        const refsRef = ref(db, 'referees');
        const unsubComps = onValue(compsRef, (snap) => setRawCompetitions(snap.val() || {}));
        const unsubRefs = onValue(refsRef, (snap) => { setRefereesData(snap.val() || {}); setLoading(false); });
        return () => { unsubComps(); unsubRefs(); };
    }, []);

    const filteredComps = useMemo(() => {
        const all = filterCompetitionsByUser(rawCompetitions, currentUser);
        if (selectedCompId === 'all') return all;
        if (all[selectedCompId]) return { [selectedCompId]: all[selectedCompId] };
        return {};
    }, [rawCompetitions, currentUser, selectedCompId]);

    const competitionsList = useMemo(() => {
        const all = filterCompetitionsByUser(rawCompetitions, currentUser);
        return Object.entries(all).map(([id, c]) => ({ id, isim: c.isim || 'İsimsiz' }));
    }, [rawCompetitions, currentUser]);

    // ─── CORE ANALYTICS ───
    const analytics = useMemo(() => {
        let totalAthletes = 0, totalScores = 0;
        let maleCount = 0, femaleCount = 0, teamCount = 0, indCount = 0;
        const categoryStats = {};
        const apparatusStats = {};
        const allTotals = [], allDScores = [], allEScores = [];

        // Referee tracking with NAMES from hakemler
        const namedRefereeStats = {};
        // { "refName": { name, deductions: [], dScores: [], apparatus: {}, competitions: Set, count } }

        // Per-competition per-apparatus referee analysis
        const compRefAnalysis = {};
        // { compId: { compName, categories: { catId: { apparatus: { appId: { refPanels: { e1: { name, deductions: [] }, ... }, avgDeduction } } } } } }

        // Apparatus-based E analysis
        const apparatusERaw = {};

        Object.entries(filteredComps).forEach(([compId, comp]) => {
            const hakemler = comp.hakemler || {};

            // Athletes
            if (comp.sporcular) {
                Object.entries(comp.sporcular).forEach(([catId, athletes]) => {
                    const athCount = Object.keys(athletes).length;
                    totalAthletes += athCount;
                    if (!categoryStats[catId]) categoryStats[catId] = { athletes: 0, scores: 0, totalD: 0, totalE: 0, totalFinal: 0, scoreEntries: 0 };
                    categoryStats[catId].athletes += athCount;
                    Object.values(athletes).forEach(ath => {
                        if (catId.includes('erkek')) maleCount++;
                        else if (catId.includes('kiz')) femaleCount++;
                        else if (ath.cinsiyet === 'Erkek') maleCount++;
                        else femaleCount++;
                        if (ath.turu === 'Takım') teamCount++; else indCount++;
                    });
                });
            }

            // Scores
            if (comp.puanlar) {
                if (!compRefAnalysis[compId]) {
                    compRefAnalysis[compId] = { compName: comp.isim || 'İsimsiz', categories: {} };
                }

                Object.entries(comp.puanlar).forEach(([catId, catScores]) => {
                    if (!categoryStats[catId]) categoryStats[catId] = { athletes: 0, scores: 0, totalD: 0, totalE: 0, totalFinal: 0, scoreEntries: 0 };
                    if (!compRefAnalysis[compId].categories[catId]) {
                        compRefAnalysis[compId].categories[catId] = { apparatus: {} };
                    }

                    Object.entries(catScores).forEach(([appId, appScores]) => {
                        const appLabel = appId;
                        if (!apparatusStats[appLabel]) apparatusStats[appLabel] = { count: 0, totalScore: 0, totalD: 0, totalE: 0 };
                        if (!apparatusERaw[appId]) apparatusERaw[appId] = { eScores: [], dScores: [], totals: [], judgeData: {} };

                        // Get referee name mapping for this cat/app
                        const catHakemler = hakemler[catId]?.[appId] || {};

                        if (!compRefAnalysis[compId].categories[catId].apparatus[appId]) {
                            compRefAnalysis[compId].categories[catId].apparatus[appId] = { refPanels: {}, allDeductions: [] };
                        }
                        const appRefData = compRefAnalysis[compId].categories[catId].apparatus[appId];

                        Object.entries(appScores).forEach(([athId, scoreEntry]) => {
                            totalScores++;
                            categoryStats[catId].scores++;
                            const d = parseFloat(scoreEntry.calc_D) || 0;
                            const e = parseFloat(scoreEntry.calc_E) || 0;
                            const total = parseFloat(scoreEntry.sonuc) || (d + e);

                            if (total > 0) {
                                allDScores.push(d); allEScores.push(e); allTotals.push(total);
                                categoryStats[catId].totalD += d;
                                categoryStats[catId].totalE += e;
                                categoryStats[catId].totalFinal += total;
                                categoryStats[catId].scoreEntries++;
                                apparatusStats[appLabel].count++;
                                apparatusStats[appLabel].totalScore += total;
                                apparatusStats[appLabel].totalD += d;
                                apparatusStats[appLabel].totalE += e;
                                apparatusERaw[appId].eScores.push(e);
                                apparatusERaw[appId].dScores.push(d);
                                apparatusERaw[appId].totals.push(total);
                            }

                            // Per-judge deductions with referee name resolution
                            const judgeKeys = Object.keys(scoreEntry).filter(k => /^e\d+$/.test(k));
                            judgeKeys.forEach(jKey => {
                                const deduction = parseFloat(scoreEntry[jKey]);
                                if (isNaN(deduction)) return;

                                // Resolve referee name
                                const hakemVal = catHakemler[jKey];
                                const refName = hakemVal
                                    ? (typeof hakemVal === 'object' ? hakemVal.name : String(hakemVal))
                                    : null;
                                const displayName = refName || `${jKey.toUpperCase()} (İsimsiz)`;

                                // Named referee stats
                                if (!namedRefereeStats[displayName]) {
                                    namedRefereeStats[displayName] = {
                                        name: displayName, hasRealName: !!refName,
                                        deductions: [], dScores: [], apparatus: {},
                                        competitions: new Set(), count: 0
                                    };
                                }
                                namedRefereeStats[displayName].deductions.push(deduction);
                                namedRefereeStats[displayName].dScores.push(d);
                                namedRefereeStats[displayName].competitions.add(compId);
                                namedRefereeStats[displayName].count++;
                                if (!namedRefereeStats[displayName].apparatus[appId]) {
                                    namedRefereeStats[displayName].apparatus[appId] = { deductions: [], count: 0 };
                                }
                                namedRefereeStats[displayName].apparatus[appId].deductions.push(deduction);
                                namedRefereeStats[displayName].apparatus[appId].count++;

                                // Per-competition referee tracking
                                if (!appRefData.refPanels[jKey]) {
                                    appRefData.refPanels[jKey] = { name: displayName, deductions: [] };
                                }
                                appRefData.refPanels[jKey].deductions.push(deduction);
                                appRefData.allDeductions.push(deduction);

                                // Apparatus E raw per-judge
                                if (!apparatusERaw[appId].judgeData[displayName]) {
                                    apparatusERaw[appId].judgeData[displayName] = { deductions: [], count: 0 };
                                }
                                apparatusERaw[appId].judgeData[displayName].deductions.push(deduction);
                                apparatusERaw[appId].judgeData[displayName].count++;
                            });
                        });
                    });
                });
            }
        });

        // ─── Referee Analysis (Named) ───
        const refereeAnalysis = Object.values(namedRefereeStats).map(r => {
            const avgDed = r.deductions.reduce((a, b) => a + b, 0) / r.deductions.length;
            const stdDev = calcStdDev(r.deductions);
            const consistency = Math.max(0, Math.min(100, 100 - (stdDev * 50)));
            const avgD = r.dScores.length > 0 ? r.dScores.reduce((a, b) => a + b, 0) / r.dScores.length : 0;

            // Per-apparatus breakdown
            const apparatusBreakdown = Object.entries(r.apparatus).map(([appId, data]) => ({
                appId,
                name: APPARATUS_NAMES[appId] || appId,
                avgDed: +(data.deductions.reduce((a, b) => a + b, 0) / data.deductions.length).toFixed(2),
                stdDev: +calcStdDev(data.deductions).toFixed(3),
                count: data.count,
            }));

            return {
                name: r.name, hasRealName: r.hasRealName,
                avgDeduction: +avgDed.toFixed(2), avgD: +avgD.toFixed(2),
                stdDev: +stdDev.toFixed(3), consistency: +consistency.toFixed(1),
                count: r.count, compCount: r.competitions.size,
                apparatusBreakdown,
            };
        }).sort((a, b) => b.count - a.count);

        // ─── Deviation Detection per Competition ───
        const deviationReport = [];
        Object.entries(compRefAnalysis).forEach(([compId, compData]) => {
            Object.entries(compData.categories).forEach(([catId, catData]) => {
                Object.entries(catData.apparatus).forEach(([appId, appData]) => {
                    const panels = Object.entries(appData.refPanels);
                    if (panels.length < 2) return;

                    // Calculate each panel's average
                    const panelAvgs = panels.map(([pId, p]) => ({
                        panelId: pId,
                        name: p.name,
                        avg: p.deductions.reduce((a, b) => a + b, 0) / p.deductions.length,
                        count: p.deductions.length,
                        stdDev: calcStdDev(p.deductions),
                    }));

                    // Group average
                    const groupAvg = appData.allDeductions.reduce((a, b) => a + b, 0) / appData.allDeductions.length;
                    const groupStdDev = calcStdDev(appData.allDeductions);

                    panelAvgs.forEach(p => {
                        const deviation = Math.abs(p.avg - groupAvg);
                        const deviationRatio = groupStdDev > 0 ? deviation / groupStdDev : 0;
                        // Flag if deviation is >1 std dev from group mean
                        if (deviationRatio > 1 && p.count >= 3) {
                            deviationReport.push({
                                compId, compName: compData.compName,
                                catId, appId,
                                appName: APPARATUS_NAMES[appId] || appId,
                                refName: p.name, panelId: p.panelId,
                                refAvg: +p.avg.toFixed(2),
                                groupAvg: +groupAvg.toFixed(2),
                                deviation: +deviation.toFixed(2),
                                deviationRatio: +deviationRatio.toFixed(1),
                                direction: p.avg > groupAvg ? 'yüksek' : 'düşük',
                                count: p.count,
                                severity: deviationRatio > 2 ? 'critical' : deviationRatio > 1.5 ? 'warning' : 'info',
                            });
                        }
                    });
                });
            });
        });
        deviationReport.sort((a, b) => b.deviationRatio - a.deviationRatio);

        // ─── Apparatus E Analysis ───
        const apparatusEAnalysis = Object.entries(apparatusERaw)
            .filter(([, data]) => data.eScores.length > 0)
            .map(([appId, data]) => {
                const avgE = +(data.eScores.reduce((a, b) => a + b, 0) / data.eScores.length).toFixed(2);
                const avgD = +(data.dScores.reduce((a, b) => a + b, 0) / data.dScores.length).toFixed(2);
                const avgTotal = +(data.totals.reduce((a, b) => a + b, 0) / data.totals.length).toFixed(2);
                const stdDevE = +calcStdDev(data.eScores).toFixed(3);
                const minE = +Math.min(...data.eScores).toFixed(2);
                const maxE = +Math.max(...data.eScores).toFixed(2);

                // Per-judge breakdown for this apparatus
                const judgeBreakdown = Object.entries(data.judgeData)
                    .map(([jName, jData]) => ({
                        name: jName,
                        avgDed: +(jData.deductions.reduce((a, b) => a + b, 0) / jData.deductions.length).toFixed(2),
                        stdDev: +calcStdDev(jData.deductions).toFixed(3),
                        count: jData.count,
                    }))
                    .sort((a, b) => b.count - a.count);

                return {
                    appId, name: APPARATUS_NAMES[appId] || appId,
                    count: data.eScores.length, avgD, avgE, avgTotal, stdDevE, minE, maxE,
                    judgeBreakdown,
                };
            })
            .sort((a, b) => b.count - a.count);

        const apparatusEChartData = apparatusEAnalysis.map(a => ({
            name: a.name, avgD: a.avgD, avgE: a.avgE, avgTotal: a.avgTotal,
        }));

        // ─── Histogram ───
        const histogramBins = [
            { range: '0-5', count: 0 }, { range: '5-8', count: 0 },
            { range: '8-10', count: 0 }, { range: '10-12', count: 0 },
            { range: '12-14', count: 0 }, { range: '14-16', count: 0 },
            { range: '16-18', count: 0 }, { range: '18-20', count: 0 },
            { range: '20+', count: 0 }
        ];
        allTotals.forEach(t => {
            if (t < 5) histogramBins[0].count++;
            else if (t < 8) histogramBins[1].count++;
            else if (t < 10) histogramBins[2].count++;
            else if (t < 12) histogramBins[3].count++;
            else if (t < 14) histogramBins[4].count++;
            else if (t < 16) histogramBins[5].count++;
            else if (t < 18) histogramBins[6].count++;
            else if (t < 20) histogramBins[7].count++;
            else histogramBins[8].count++;
        });

        // ─── Category Chart Data ───
        const categoryChartData = Object.entries(categoryStats)
            .filter(([, s]) => s.scoreEntries > 0)
            .map(([catId, s]) => ({
                name: catId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                avgD: +(s.totalD / s.scoreEntries).toFixed(2),
                avgE: +(s.totalE / s.scoreEntries).toFixed(2),
                sporcu: s.athletes, puan: s.scores
            }))
            .sort((a, b) => b.sporcu - a.sporcu).slice(0, 12);

        // ─── Apparatus Chart Data ───
        const apparatusChartData = Object.entries(apparatusStats)
            .map(([name, s]) => ({
                name: APPARATUS_NAMES[name] || name,
                avgScore: +(s.totalScore / s.count).toFixed(2),
                avgD: +(s.totalD / s.count).toFixed(2),
                avgE: +(s.totalE / s.count).toFixed(2),
                count: s.count
            }))
            .sort((a, b) => b.count - a.count);

        // ─── D-E Correlation (per apparatus) ───
        const deCorrelation = apparatusEAnalysis.map(a => ({
            name: a.name, avgD: a.avgD, avgE: a.avgE,
            eRange: +(a.maxE - a.minE).toFixed(2),
        }));

        // Global stats
        const globalAvgD = allDScores.length > 0 ? +(allDScores.reduce((a, b) => a + b, 0) / allDScores.length).toFixed(2) : 0;
        const globalAvgE = allEScores.length > 0 ? +(allEScores.reduce((a, b) => a + b, 0) / allEScores.length).toFixed(2) : 0;
        const globalAvgTotal = allTotals.length > 0 ? +(allTotals.reduce((a, b) => a + b, 0) / allTotals.length).toFixed(2) : 0;

        const qualifiedRefs = refereeAnalysis.filter(r => r.count >= 5);
        const mostConsistent = [...qualifiedRefs].sort((a, b) => a.stdDev - b.stdDev).slice(0, 5);
        const leastConsistent = [...qualifiedRefs].sort((a, b) => b.stdDev - a.stdDev).slice(0, 5);

        // Scatter data
        const scatterData = refereeAnalysis.filter(r => r.count >= 3).map(r => ({
            name: r.name, x: r.avgDeduction, y: r.stdDev, z: r.count
        }));

        // Inter-rater difference
        let agreementSum = 0, agreementCount = 0;
        Object.entries(compRefAnalysis).forEach(([, compData]) => {
            Object.entries(compData.categories).forEach(([, catData]) => {
                Object.entries(catData.apparatus).forEach(([, appData]) => {
                    const panels = Object.values(appData.refPanels);
                    if (panels.length < 2) return;
                    const avgs = panels.map(p => p.deductions.reduce((a, b) => a + b, 0) / p.deductions.length);
                    for (let i = 0; i < avgs.length; i++) {
                        for (let j = i + 1; j < avgs.length; j++) {
                            agreementSum += Math.abs(avgs[i] - avgs[j]);
                            agreementCount++;
                        }
                    }
                });
            });
        });
        const avgInterRaterDiff = agreementCount > 0 ? +(agreementSum / agreementCount).toFixed(3) : 0;

        // Referee report card data (per competition)
        const reportCardData = {};
        Object.entries(compRefAnalysis).forEach(([compId, compData]) => {
            const refMap = {};
            Object.entries(compData.categories).forEach(([catId, catData]) => {
                Object.entries(catData.apparatus).forEach(([appId, appData]) => {
                    const groupAvg = appData.allDeductions.length > 0
                        ? appData.allDeductions.reduce((a, b) => a + b, 0) / appData.allDeductions.length : 0;

                    Object.entries(appData.refPanels).forEach(([panelId, pData]) => {
                        const key = pData.name;
                        if (!refMap[key]) {
                            refMap[key] = { name: pData.name, apparatus: [], totalDeductions: [], totalCount: 0 };
                        }
                        const avg = pData.deductions.reduce((a, b) => a + b, 0) / pData.deductions.length;
                        const std = calcStdDev(pData.deductions);
                        refMap[key].apparatus.push({
                            appId, appName: APPARATUS_NAMES[appId] || appId,
                            catId, panelId,
                            avg: +avg.toFixed(2), stdDev: +std.toFixed(3),
                            count: pData.deductions.length,
                            groupAvg: +groupAvg.toFixed(2),
                            diff: +(avg - groupAvg).toFixed(2),
                        });
                        refMap[key].totalDeductions.push(...pData.deductions);
                        refMap[key].totalCount += pData.deductions.length;
                    });
                });
            });

            // Compute overall stats for each referee
            Object.values(refMap).forEach(r => {
                r.overallAvg = r.totalDeductions.length > 0
                    ? +(r.totalDeductions.reduce((a, b) => a + b, 0) / r.totalDeductions.length).toFixed(2) : 0;
                r.overallStdDev = +calcStdDev(r.totalDeductions).toFixed(3);
                r.consistency = +Math.max(0, Math.min(100, 100 - (r.overallStdDev * 50))).toFixed(1);
            });

            reportCardData[compId] = {
                compName: compData.compName,
                referees: Object.values(refMap).sort((a, b) => b.totalCount - a.totalCount),
            };
        });

        return {
            totalComps: Object.keys(filteredComps).length,
            totalAthletes, totalScores,
            totalReferees: Object.keys(refereesData).length,
            globalAvgD, globalAvgE, globalAvgTotal, avgInterRaterDiff,
            genderData: [{ name: 'Erkek', value: maleCount }, { name: 'Kadın', value: femaleCount }],
            typeData: [{ name: 'Takım', value: teamCount }, { name: 'Ferdi', value: indCount }],
            refereeAnalysis, mostConsistent, leastConsistent,
            histogramBins, categoryChartData, apparatusChartData,
            apparatusEAnalysis, apparatusEChartData, deCorrelation,
            scatterData, deviationReport, reportCardData,
            activeRefereeCount: refereeAnalysis.filter(r => r.count > 0).length,
        };
    }, [filteredComps, refereesData]);

    // Auto-select first comp for report card
    useEffect(() => {
        if (!selectedReportComp && competitionsList.length > 0) {
            setSelectedReportComp(competitionsList[0].id);
        }
    }, [competitionsList, selectedReportComp]);

    const handlePrintReportCard = () => {
        if (!reportCardRef.current) return;
        const printContent = reportCardRef.current.innerHTML;
        const win = window.open('', '_blank');
        win.document.write(`<!DOCTYPE html><html><head><title>Hakem Karnesi</title>
        <style>
            body { font-family: 'Inter', system-ui, sans-serif; padding: 24px; color: #1E293B; }
            h1 { font-size: 20px; margin-bottom: 4px; }
            h2 { font-size: 16px; color: #4F46E5; margin: 24px 0 8px; border-bottom: 2px solid #E2E8F0; padding-bottom: 4px; }
            h3 { font-size: 13px; color: #64748B; margin: 0 0 16px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
            th { background: #F1F5F9; padding: 8px; text-align: left; font-weight: 700; border-bottom: 2px solid #E2E8F0; }
            td { padding: 6px 8px; border-bottom: 1px solid #F1F5F9; }
            .summary-row { background: #F8FAFC; font-weight: 700; }
            .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; }
            .badge-green { background: #DCFCE7; color: #16A34A; }
            .badge-yellow { background: #FEF3C7; color: #D97706; }
            .badge-red { background: #FEE2E2; color: #DC2626; }
            .ref-section { page-break-inside: avoid; margin-bottom: 32px; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; }
            .ref-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
            .ref-name { font-size: 15px; font-weight: 800; }
            .ref-stats { display: flex; gap: 16px; font-size: 12px; }
            .ref-stats span { display: flex; flex-direction: column; align-items: center; }
            .ref-stats label { font-size: 10px; color: #94A3B8; text-transform: uppercase; }
            .ref-stats strong { font-size: 14px; }
            .positive { color: #DC2626; }
            .negative { color: #16A34A; }
            @media print { body { padding: 12px; } .ref-section { break-inside: avoid; } }
        </style></head><body>${printContent}</body></html>`);
        win.document.close();
        win.print();
    };

    // Tooltips
    const barTooltip = ({ active, payload, label }) => {
        if (!active || !payload?.length) return null;
        return (
            <div className="an-tooltip">
                <strong>{label}</strong>
                {payload.map((p, i) => (
                    <div key={i} style={{ color: p.color }}>{p.name}: {p.value}</div>
                ))}
            </div>
        );
    };

    const pieTooltip = ({ active, payload }) => {
        if (!active || !payload?.length) return null;
        return (<div className="an-tooltip"><strong>{payload[0].name}</strong>: {payload[0].value}</div>);
    };

    // ─── RENDER ───
    return (
        <div className="analytics-page premium-layout">
            <header className="page-header--bento premium-header">
                <div className="page-header__left">
                    <button className="back-btn back-btn--light" onClick={() => navigate('/artistik')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div className="header-title-wrapper">
                        <h1 className="page-title text-white">Raporlar & Analiz</h1>
                        <p className="page-subtitle text-white-50">Detaylı performans analizi, hakem tutarlılık ve alet bazlı değerlendirme</p>
                    </div>
                </div>
                <div className="page-header__actions">
                    <div className="filter-group">
                        <i className="material-icons-round text-white-50">filter_alt</i>
                        <select className="select-glass" value={selectedCompId} onChange={(e) => setSelectedCompId(e.target.value)}>
                            <option value="all">Tüm Yarışmalar</option>
                            {competitionsList.map(c => <option key={c.id} value={c.id}>{c.isim}</option>)}
                        </select>
                    </div>
                </div>
            </header>

            {/* Tab Navigation */}
            <nav className="an-tabs">
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        className={`an-tab ${activeTab === tab.id ? 'an-tab--active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        <i className="material-icons-round">{tab.icon}</i>
                        <span>{tab.label}</span>
                    </button>
                ))}
            </nav>

            <main className="premium-main-content analytics-main">
                {loading ? (
                    <div className="loading-state h-full w-full"><div className="spinner"></div><p>Veriler işleniyor...</p></div>
                ) : (
                    <>
                        {/* ════════════ OVERVIEW TAB ════════════ */}
                        {activeTab === 'overview' && (
                            <>
                                {/* KPI Cards */}
                                <section className="an-kpi-row">
                                    {[
                                        { icon: 'emoji_events', color: 'blue', value: analytics.totalComps, label: 'Yarışma' },
                                        { icon: 'groups', color: 'green', value: analytics.totalAthletes, label: 'Sporcu' },
                                        { icon: 'done_all', color: 'orange', value: analytics.totalScores, label: 'Puan Girişi' },
                                        { icon: 'gavel', color: 'purple', value: analytics.activeRefereeCount, label: 'Aktif Hakem' },
                                    ].map((kpi, i) => (
                                        <div key={i} className="an-kpi glass-panel">
                                            <div className={`an-kpi__icon an-kpi__icon--${kpi.color}`}>
                                                <i className="material-icons-round">{kpi.icon}</i>
                                            </div>
                                            <div className="an-kpi__data">
                                                <span className="an-kpi__value">{kpi.value}</span>
                                                <span className="an-kpi__label">{kpi.label}</span>
                                            </div>
                                        </div>
                                    ))}
                                </section>

                                {/* Secondary KPI */}
                                <section className="an-kpi-secondary">
                                    {[
                                        { label: 'Ort. D', value: analytics.globalAvgD, cls: 'blue-text' },
                                        { label: 'Ort. E', value: analytics.globalAvgE, cls: 'green-text' },
                                        { label: 'Ort. Toplam', value: analytics.globalAvgTotal, cls: '' },
                                        { label: 'Hakemler Arası Fark', value: analytics.avgInterRaterDiff, cls: 'orange-text' },
                                    ].map((kpi, i) => (
                                        <div key={i} className="an-kpi-mini glass-panel">
                                            <span className="an-kpi-mini__label">{kpi.label}</span>
                                            <span className={`an-kpi-mini__value ${kpi.cls}`}>{kpi.value}</span>
                                        </div>
                                    ))}
                                </section>

                                {/* Demographics + Histogram */}
                                <section className="an-grid an-grid--3">
                                    <div className="chart-panel glass-panel">
                                        <div className="chart-header">
                                            <h3 className="chart-title"><i className="material-icons-round">wc</i> Cinsiyet Dağılımı</h3>
                                        </div>
                                        <div className="chart-container">
                                            {analytics.genderData.every(d => d.value === 0) ? <div className="empty-chart">Veri Yok</div> : (
                                                <ResponsiveContainer width="100%" height={220}>
                                                    <PieChart>
                                                        <Pie data={analytics.genderData} cx="50%" cy="50%" innerRadius={55} outerRadius={75} paddingAngle={5} dataKey="value">
                                                            {analytics.genderData.map((_, i) => <Cell key={i} fill={GENDER_COLORS[i]} />)}
                                                        </Pie>
                                                        <RechartsTooltip content={pieTooltip} />
                                                        <Legend verticalAlign="bottom" height={36} />
                                                    </PieChart>
                                                </ResponsiveContainer>
                                            )}
                                        </div>
                                    </div>

                                    <div className="chart-panel glass-panel">
                                        <div className="chart-header">
                                            <h3 className="chart-title"><i className="material-icons-round">category</i> Katılım Modeli</h3>
                                        </div>
                                        <div className="chart-container">
                                            {analytics.typeData.every(d => d.value === 0) ? <div className="empty-chart">Veri Yok</div> : (
                                                <ResponsiveContainer width="100%" height={220}>
                                                    <PieChart>
                                                        <Pie data={analytics.typeData} cx="50%" cy="50%" innerRadius={55} outerRadius={75} paddingAngle={5} dataKey="value">
                                                            {analytics.typeData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                                                        </Pie>
                                                        <RechartsTooltip content={pieTooltip} />
                                                        <Legend verticalAlign="bottom" height={36} />
                                                    </PieChart>
                                                </ResponsiveContainer>
                                            )}
                                        </div>
                                    </div>

                                    <div className="chart-panel glass-panel">
                                        <div className="chart-header">
                                            <h3 className="chart-title"><i className="material-icons-round">bar_chart</i> Puan Dağılımı</h3>
                                        </div>
                                        <div className="chart-container">
                                            {analytics.histogramBins.every(b => b.count === 0) ? <div className="empty-chart">Veri Yok</div> : (
                                                <ResponsiveContainer width="100%" height={220}>
                                                    <BarChart data={analytics.histogramBins}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                                        <XAxis dataKey="range" tick={{ fontSize: 11, fill: '#64748B' }} />
                                                        <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                                                        <RechartsTooltip content={barTooltip} />
                                                        <Bar dataKey="count" name="Puan" fill="#6366F1" radius={[4, 4, 0, 0]} />
                                                    </BarChart>
                                                </ResponsiveContainer>
                                            )}
                                        </div>
                                    </div>
                                </section>

                                {/* Category Analysis */}
                                <section className="an-grid an-grid--2">
                                    <div className="chart-panel glass-panel">
                                        <div className="chart-header">
                                            <h3 className="chart-title"><i className="material-icons-round">leaderboard</i> Kategori Bazlı Ortalamalar</h3>
                                            <p className="chart-subtitle">D ve E puan ortalamaları</p>
                                        </div>
                                        <div className="chart-container">
                                            {analytics.categoryChartData.length === 0 ? <div className="empty-chart">Veri Yok</div> : (
                                                <ResponsiveContainer width="100%" height={300}>
                                                    <BarChart data={analytics.categoryChartData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                                        <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748B' }} angle={-25} textAnchor="end" height={70} />
                                                        <YAxis tick={{ fill: '#64748B' }} />
                                                        <RechartsTooltip content={barTooltip} />
                                                        <Legend iconType="circle" />
                                                        <Bar dataKey="avgD" name="Ort. D" fill="#4F46E5" radius={[3, 3, 0, 0]} />
                                                        <Bar dataKey="avgE" name="Ort. E" fill="#10B981" radius={[3, 3, 0, 0]} />
                                                    </BarChart>
                                                </ResponsiveContainer>
                                            )}
                                        </div>
                                    </div>

                                    <div className="chart-panel glass-panel">
                                        <div className="chart-header">
                                            <h3 className="chart-title"><i className="material-icons-round">fitness_center</i> Alet Bazlı Ortalamalar</h3>
                                            <p className="chart-subtitle">Alet başına ortalama puan</p>
                                        </div>
                                        <div className="chart-container">
                                            {analytics.apparatusChartData.length === 0 ? <div className="empty-chart">Veri Yok</div> : (
                                                <ResponsiveContainer width="100%" height={300}>
                                                    <BarChart data={analytics.apparatusChartData} layout="vertical" margin={{ top: 10, right: 30, left: 80, bottom: 5 }}>
                                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                                                        <XAxis type="number" tick={{ fill: '#64748B' }} />
                                                        <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: '#64748B' }} width={80} />
                                                        <RechartsTooltip content={barTooltip} />
                                                        <Legend iconType="circle" />
                                                        <Bar dataKey="avgD" name="Ort. D" fill="#4F46E5" radius={[0, 3, 3, 0]} />
                                                        <Bar dataKey="avgE" name="Ort. E" fill="#10B981" radius={[0, 3, 3, 0]} />
                                                    </BarChart>
                                                </ResponsiveContainer>
                                            )}
                                        </div>
                                    </div>
                                </section>
                            </>
                        )}

                        {/* ════════════ APPARATUS TAB ════════════ */}
                        {activeTab === 'apparatus' && (
                            <>
                                {/* Apparatus E Chart */}
                                <section className="chart-panel glass-panel an-full-width">
                                    <div className="chart-header">
                                        <h3 className="chart-title"><i className="material-icons-round">assessment</i> Alet Bazlı D / E / Toplam Karşılaştırması</h3>
                                        <p className="chart-subtitle">Her alet için ortalama D, E ve toplam puan dağılımı</p>
                                    </div>
                                    <div className="chart-container" style={{ minHeight: 350 }}>
                                        {analytics.apparatusEChartData.length === 0 ? <div className="empty-chart">Yeterli veri yok</div> : (
                                            <ResponsiveContainer width="100%" height={350}>
                                                <BarChart data={analytics.apparatusEChartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748B' }} />
                                                    <YAxis tick={{ fill: '#64748B' }} />
                                                    <RechartsTooltip content={barTooltip} />
                                                    <Legend iconType="circle" />
                                                    <Bar dataKey="avgD" name="Ort. D" fill="#4F46E5" radius={[4, 4, 0, 0]} />
                                                    <Bar dataKey="avgE" name="Ort. E" fill="#10B981" radius={[4, 4, 0, 0]} />
                                                    <Bar dataKey="avgTotal" name="Toplam" fill="#D97706" radius={[4, 4, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>
                                </section>

                                {/* Apparatus Summary Table */}
                                <section className="chart-panel glass-panel an-full-width">
                                    <div className="chart-header">
                                        <h3 className="chart-title"><i className="material-icons-round">table_chart</i> Alet Bazlı Detaylı İstatistikler</h3>
                                    </div>
                                    <div className="an-table-wrap">
                                        {analytics.apparatusEAnalysis.length === 0 ? <div className="empty-chart">Veri yok</div> : (
                                            <table className="an-table">
                                                <thead>
                                                    <tr>
                                                        <th>Alet</th>
                                                        <th>Puan Sayısı</th>
                                                        <th>Ort. D</th>
                                                        <th>Ort. E</th>
                                                        <th>Ort. Toplam</th>
                                                        <th>E Std.Sapma</th>
                                                        <th>Min E</th>
                                                        <th>Max E</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {analytics.apparatusEAnalysis.map(app => (
                                                        <tr key={app.appId}>
                                                            <td><strong>{app.name}</strong></td>
                                                            <td>{app.count}</td>
                                                            <td className="blue-text">{app.avgD}</td>
                                                            <td className="green-text">{app.avgE}</td>
                                                            <td><strong>{app.avgTotal}</strong></td>
                                                            <td className="orange-text">{app.stdDevE}</td>
                                                            <td className="red-text">{app.minE}</td>
                                                            <td className="green-text">{app.maxE}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                </section>

                                {/* Per-Apparatus Referee Breakdown */}
                                {analytics.apparatusEAnalysis.filter(a => a.judgeBreakdown.length > 0).map(app => (
                                    <section key={app.appId} className="chart-panel glass-panel an-full-width">
                                        <div className="chart-header">
                                            <h3 className="chart-title">
                                                <i className="material-icons-round">{APPARATUS_ICONS[app.appId] || 'fitness_center'}</i>
                                                {app.name} — Hakem Bazlı E Kesinti Analizi
                                            </h3>
                                            <p className="chart-subtitle">{app.count} puanlama, {app.judgeBreakdown.length} hakem</p>
                                        </div>

                                        <div className="an-judge-cards">
                                            {app.judgeBreakdown.map(judge => {
                                                const globalAvg = app.judgeBreakdown.reduce((sum, j) => sum + j.avgDed, 0) / app.judgeBreakdown.length;
                                                const diff = judge.avgDed - globalAvg;
                                                const absDiff = Math.abs(diff);
                                                const severity = absDiff > 0.5 ? 'critical' : absDiff > 0.3 ? 'warning' : 'normal';
                                                return (
                                                    <div key={judge.name} className={`an-judge-card an-judge-card--${severity}`}>
                                                        <div className="an-judge-card__header">
                                                            <i className="material-icons-round">person</i>
                                                            <strong>{judge.name}</strong>
                                                        </div>
                                                        <div className="an-judge-card__stats">
                                                            <div className="an-judge-stat">
                                                                <label>Ort. Kesinti</label>
                                                                <span>{judge.avgDed}</span>
                                                            </div>
                                                            <div className="an-judge-stat">
                                                                <label>Std Sapma</label>
                                                                <span>{judge.stdDev}</span>
                                                            </div>
                                                            <div className="an-judge-stat">
                                                                <label>Puanlama</label>
                                                                <span>{judge.count}</span>
                                                            </div>
                                                            <div className="an-judge-stat">
                                                                <label>Sapma</label>
                                                                <span className={diff > 0 ? 'red-text' : 'green-text'}>
                                                                    {diff > 0 ? '+' : ''}{diff.toFixed(2)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </section>
                                ))}

                                {/* D-E Correlation */}
                                {analytics.deCorrelation.length > 0 && (
                                    <section className="chart-panel glass-panel an-full-width">
                                        <div className="chart-header">
                                            <h3 className="chart-title"><i className="material-icons-round">trending_up</i> Zorluk-Uygulama İlişkisi (D vs E)</h3>
                                            <p className="chart-subtitle">Yüksek zorluk puanının uygulama puanına etkisi</p>
                                        </div>
                                        <div className="chart-container" style={{ minHeight: 300 }}>
                                            <ResponsiveContainer width="100%" height={300}>
                                                <ScatterChart margin={{ top: 20, right: 20, bottom: 30, left: 10 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                                                    <XAxis type="number" dataKey="avgD" name="Ort. D" tick={{ fontSize: 11, fill: '#64748B' }} label={{ value: 'Ort. D Puanı', position: 'bottom', fontSize: 12, fill: '#94A3B8' }} />
                                                    <YAxis type="number" dataKey="avgE" name="Ort. E" tick={{ fontSize: 11, fill: '#64748B' }} label={{ value: 'Ort. E Puanı', angle: -90, position: 'left', fontSize: 12, fill: '#94A3B8' }} />
                                                    <ZAxis type="number" dataKey="eRange" range={[80, 400]} name="E Aralığı" />
                                                    <RechartsTooltip content={({ active, payload }) => {
                                                        if (!active || !payload?.length) return null;
                                                        const d = payload[0].payload;
                                                        return (
                                                            <div className="an-tooltip">
                                                                <strong>{d.name}</strong>
                                                                <div>D: {d.avgD} | E: {d.avgE}</div>
                                                                <div>E Aralığı: {d.eRange}</div>
                                                            </div>
                                                        );
                                                    }} />
                                                    <Scatter data={analytics.deCorrelation} fill="#6366F1" fillOpacity={0.8} />
                                                </ScatterChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </section>
                                )}
                            </>
                        )}

                        {/* ════════════ REFEREES TAB ════════════ */}
                        {activeTab === 'referees' && (
                            <>
                                {/* Referee Consistency Chart */}
                                <section className="chart-panel glass-panel an-full-width">
                                    <div className="chart-header">
                                        <h3 className="chart-title"><i className="material-icons-round">balance</i> Hakem Puanlama Tutarlılığı</h3>
                                        <p className="chart-subtitle">Ortalama düşüm ve standart sapma. Düşük std sapma = yüksek tutarlılık.</p>
                                    </div>
                                    <div className="chart-container" style={{ minHeight: 350 }}>
                                        {analytics.refereeAnalysis.length === 0 ? <div className="empty-chart">Yeterli veri yok</div> : (
                                            <ResponsiveContainer width="100%" height={350}>
                                                <BarChart data={analytics.refereeAnalysis.slice(0, 15)} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748B' }} angle={-20} textAnchor="end" height={60} />
                                                    <YAxis tick={{ fill: '#64748B' }} />
                                                    <RechartsTooltip content={({ active, payload, label }) => {
                                                        if (!active || !payload?.length) return null;
                                                        const data = analytics.refereeAnalysis.find(r => r.name === label);
                                                        return (
                                                            <div className="an-tooltip an-tooltip--wide">
                                                                <strong>{label}</strong>
                                                                <div className="an-tooltip-grid">
                                                                    <span>Ort. Düşüm:</span><span className="red-text">{data?.avgDeduction}</span>
                                                                    <span>Std Sapma:</span><span className="orange-text">{data?.stdDev}</span>
                                                                    <span>Tutarlılık:</span><span className="green-text">%{data?.consistency}</span>
                                                                    <span>Puanlama:</span><span>{data?.count}</span>
                                                                    <span>Yarışma:</span><span>{data?.compCount}</span>
                                                                </div>
                                                            </div>
                                                        );
                                                    }} />
                                                    <Legend iconType="circle" />
                                                    <Bar dataKey="avgDeduction" name="Ort. Düşüm" fill="#EF4444" radius={[4, 4, 0, 0]} />
                                                    <Bar dataKey="stdDev" name="Std. Sapma" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>
                                </section>

                                {/* Consistent vs Inconsistent */}
                                <section className="an-grid an-grid--2">
                                    <div className="chart-panel glass-panel">
                                        <h3 className="chart-title"><i className="material-icons-round" style={{ color: '#16A34A' }}>verified</i> En Tutarlı Hakemler</h3>
                                        <p className="chart-subtitle">En düşük standart sapma (min. 5 puanlama)</p>
                                        {analytics.mostConsistent.length === 0 ? <div className="empty-chart" style={{ minHeight: 120 }}>Yeterli veri yok</div> : (
                                            <div className="an-ref-list">
                                                {analytics.mostConsistent.map((ref, i) => (
                                                    <div key={i} className="an-ref-item">
                                                        <div className="an-ref-rank an-ref-rank--good">{i + 1}</div>
                                                        <div className="an-ref-info">
                                                            <strong>{ref.name}</strong>
                                                            <span>{ref.count} puan • {ref.compCount} yarışma</span>
                                                        </div>
                                                        <div className="an-ref-metrics">
                                                            <span className="an-metric"><label>Std.S</label><strong>{ref.stdDev}</strong></span>
                                                            <span className="an-metric"><label>Tutarlılık</label><strong className="green-text">%{ref.consistency}</strong></span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div className="chart-panel glass-panel">
                                        <h3 className="chart-title"><i className="material-icons-round" style={{ color: '#DC2626' }}>warning</i> Dikkat Gereken Hakemler</h3>
                                        <p className="chart-subtitle">En yüksek standart sapma (min. 5 puanlama)</p>
                                        {analytics.leastConsistent.length === 0 ? <div className="empty-chart" style={{ minHeight: 120 }}>Yeterli veri yok</div> : (
                                            <div className="an-ref-list">
                                                {analytics.leastConsistent.map((ref, i) => (
                                                    <div key={i} className="an-ref-item">
                                                        <div className="an-ref-rank an-ref-rank--warn">{i + 1}</div>
                                                        <div className="an-ref-info">
                                                            <strong>{ref.name}</strong>
                                                            <span>{ref.count} puan • {ref.compCount} yarışma</span>
                                                        </div>
                                                        <div className="an-ref-metrics">
                                                            <span className="an-metric"><label>Std.S</label><strong>{ref.stdDev}</strong></span>
                                                            <span className="an-metric"><label>Tutarlılık</label><strong className="red-text">%{ref.consistency}</strong></span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </section>

                                {/* Scatter + Table */}
                                <section className="an-grid an-grid--2">
                                    <div className="chart-panel glass-panel">
                                        <div className="chart-header">
                                            <h3 className="chart-title"><i className="material-icons-round">scatter_plot</i> Düşüm vs Tutarlılık</h3>
                                            <p className="chart-subtitle">X = Ort. Düşüm, Y = Std Sapma. Boyut = puanlama sayısı.</p>
                                        </div>
                                        <div className="chart-container">
                                            {analytics.scatterData.length === 0 ? <div className="empty-chart">Veri Yok</div> : (
                                                <ResponsiveContainer width="100%" height={300}>
                                                    <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
                                                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                                                        <XAxis type="number" dataKey="x" name="Düşüm" tick={{ fontSize: 11, fill: '#64748B' }} />
                                                        <YAxis type="number" dataKey="y" name="Std.S" tick={{ fontSize: 11, fill: '#64748B' }} />
                                                        <ZAxis type="number" dataKey="z" range={[40, 400]} />
                                                        <RechartsTooltip content={({ active, payload }) => {
                                                            if (!active || !payload?.length) return null;
                                                            const d = payload[0].payload;
                                                            return (
                                                                <div className="an-tooltip">
                                                                    <strong>{d.name}</strong>
                                                                    <div>Düşüm: {d.x} | Std.S: {d.y}</div>
                                                                    <div>{d.z} puanlama</div>
                                                                </div>
                                                            );
                                                        }} />
                                                        <Scatter data={analytics.scatterData} fill="#6366F1" fillOpacity={0.7} />
                                                    </ScatterChart>
                                                </ResponsiveContainer>
                                            )}
                                        </div>
                                    </div>

                                    <div className="chart-panel glass-panel">
                                        <div className="chart-header">
                                            <h3 className="chart-title"><i className="material-icons-round">table_chart</i> Hakem Detay Tablosu</h3>
                                        </div>
                                        <div className="an-table-wrap">
                                            {analytics.refereeAnalysis.length === 0 ? <div className="empty-chart" style={{ minHeight: 120 }}>Veri yok</div> : (
                                                <table className="an-table">
                                                    <thead>
                                                        <tr>
                                                            <th>Hakem</th>
                                                            <th>Say.</th>
                                                            <th>Ort. Düşüm</th>
                                                            <th>Std.S</th>
                                                            <th>Tutarlılık</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {analytics.refereeAnalysis.slice(0, 20).map((ref, i) => (
                                                            <tr key={i}>
                                                                <td><strong>{ref.name}</strong></td>
                                                                <td>{ref.count}</td>
                                                                <td className="red-text">{ref.avgDeduction}</td>
                                                                <td className="orange-text">{ref.stdDev}</td>
                                                                <td>
                                                                    <div className="an-consistency-bar">
                                                                        <div style={{ background: '#E2E8F0' }}>
                                                                            <div className="an-consistency-fill" style={{
                                                                                width: `${Math.min(ref.consistency, 100)}%`,
                                                                                background: ref.consistency >= 80 ? '#16A34A' : ref.consistency >= 60 ? '#F59E0B' : '#DC2626'
                                                                            }} />
                                                                        </div>
                                                                        <span>%{ref.consistency}</span>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            )}
                                        </div>
                                    </div>
                                </section>

                                {/* ─── DEVIATION REPORT ─── */}
                                <section className="chart-panel glass-panel an-full-width">
                                    <div className="chart-header">
                                        <h3 className="chart-title"><i className="material-icons-round" style={{ color: '#DC2626' }}>report_problem</i> Standarttan Sapan Hakemler</h3>
                                        <p className="chart-subtitle">Grup ortalamasından 1+ standart sapma uzakta puanlayan hakemler (min. 3 puanlama)</p>
                                    </div>
                                    {analytics.deviationReport.length === 0 ? (
                                        <div className="empty-chart" style={{ minHeight: 100 }}>Belirgin sapma tespit edilmedi</div>
                                    ) : (
                                        <div className="an-deviation-list">
                                            {analytics.deviationReport.map((dev, i) => (
                                                <div key={i} className={`an-deviation-item an-deviation-item--${dev.severity}`}>
                                                    <div className="an-deviation-item__icon">
                                                        <i className="material-icons-round">
                                                            {dev.severity === 'critical' ? 'error' : dev.severity === 'warning' ? 'warning' : 'info'}
                                                        </i>
                                                    </div>
                                                    <div className="an-deviation-item__content">
                                                        <strong>{dev.refName}</strong>
                                                        <span className="an-deviation-item__meta">
                                                            {dev.compName} • {dev.appName} • {dev.catId.replace(/_/g, ' ')}
                                                        </span>
                                                    </div>
                                                    <div className="an-deviation-item__stats">
                                                        <div className="an-deviation-stat">
                                                            <label>Hakem Ort.</label>
                                                            <strong>{dev.refAvg}</strong>
                                                        </div>
                                                        <div className="an-deviation-stat">
                                                            <label>Grup Ort.</label>
                                                            <strong>{dev.groupAvg}</strong>
                                                        </div>
                                                        <div className="an-deviation-stat">
                                                            <label>Fark</label>
                                                            <strong className={dev.direction === 'yüksek' ? 'red-text' : 'green-text'}>
                                                                {dev.direction === 'yüksek' ? '+' : '-'}{dev.deviation}
                                                            </strong>
                                                        </div>
                                                        <div className="an-deviation-stat">
                                                            <label>Sapma</label>
                                                            <strong className="orange-text">{dev.deviationRatio}x</strong>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </section>
                            </>
                        )}

                        {/* ════════════ REPORT CARD TAB ════════════ */}
                        {activeTab === 'report-card' && (
                            <>
                                <section className="an-report-controls glass-panel">
                                    <div className="an-report-controls__left">
                                        <i className="material-icons-round">assignment</i>
                                        <select
                                            className="an-report-select"
                                            value={selectedReportComp}
                                            onChange={e => setSelectedReportComp(e.target.value)}
                                        >
                                            <option value="">Yarışma Seçin</option>
                                            {competitionsList.map(c => <option key={c.id} value={c.id}>{c.isim}</option>)}
                                        </select>
                                    </div>
                                    <button className="an-print-btn" onClick={handlePrintReportCard}>
                                        <i className="material-icons-round">print</i>
                                        Yazdır / PDF
                                    </button>
                                </section>

                                <div ref={reportCardRef}>
                                    {!selectedReportComp || !analytics.reportCardData[selectedReportComp] ? (
                                        <div className="chart-panel glass-panel an-full-width">
                                            <div className="empty-chart" style={{ minHeight: 200 }}>
                                                {!selectedReportComp ? 'Hakem karnesi için bir yarışma seçin' : 'Bu yarışmada puan verisi bulunamadı'}
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="an-report-header">
                                                <h1>Hakem Karnesi</h1>
                                                <h3>{analytics.reportCardData[selectedReportComp].compName}</h3>
                                            </div>

                                            {analytics.reportCardData[selectedReportComp].referees.map((ref, ri) => (
                                                <section key={ri} className="an-report-card glass-panel">
                                                    <div className="an-report-card__header">
                                                        <div className="an-report-card__name">
                                                            <i className="material-icons-round">person</i>
                                                            <div>
                                                                <strong>{ref.name}</strong>
                                                                <span>{ref.totalCount} puanlama • {ref.apparatus.length} görev</span>
                                                            </div>
                                                        </div>
                                                        <div className="an-report-card__summary">
                                                            <div className="an-report-stat">
                                                                <label>Genel Ort.</label>
                                                                <strong>{ref.overallAvg}</strong>
                                                            </div>
                                                            <div className="an-report-stat">
                                                                <label>Std Sapma</label>
                                                                <strong className="orange-text">{ref.overallStdDev}</strong>
                                                            </div>
                                                            <div className="an-report-stat">
                                                                <label>Tutarlılık</label>
                                                                <strong className={ref.consistency >= 70 ? 'green-text' : ref.consistency >= 50 ? 'orange-text' : 'red-text'}>
                                                                    %{ref.consistency}
                                                                </strong>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="an-table-wrap">
                                                        <table className="an-table">
                                                            <thead>
                                                                <tr>
                                                                    <th>Alet</th>
                                                                    <th>Kategori</th>
                                                                    <th>Panel</th>
                                                                    <th>Puanlama</th>
                                                                    <th>Ort. Kesinti</th>
                                                                    <th>Grup Ort.</th>
                                                                    <th>Fark</th>
                                                                    <th>Std Sapma</th>
                                                                    <th>Değerlendirme</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {ref.apparatus.map((a, ai) => {
                                                                    const absDiff = Math.abs(a.diff);
                                                                    const grade = absDiff <= 0.2 ? 'A' : absDiff <= 0.4 ? 'B' : absDiff <= 0.6 ? 'C' : 'D';
                                                                    const gradeColor = grade === 'A' ? '#16A34A' : grade === 'B' ? '#D97706' : grade === 'C' ? '#EA580C' : '#DC2626';
                                                                    return (
                                                                        <tr key={ai}>
                                                                            <td><strong>{a.appName}</strong></td>
                                                                            <td>{a.catId.replace(/_/g, ' ')}</td>
                                                                            <td>{a.panelId.toUpperCase()}</td>
                                                                            <td>{a.count}</td>
                                                                            <td>{a.avg}</td>
                                                                            <td>{a.groupAvg}</td>
                                                                            <td style={{ color: a.diff > 0 ? '#DC2626' : a.diff < 0 ? '#16A34A' : '#64748B', fontWeight: 700 }}>
                                                                                {a.diff > 0 ? '+' : ''}{a.diff}
                                                                            </td>
                                                                            <td className="orange-text">{a.stdDev}</td>
                                                                            <td>
                                                                                <span className="an-grade" style={{ background: `${gradeColor}15`, color: gradeColor }}>
                                                                                    {grade}
                                                                                </span>
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                })}
                                                                <tr className="an-table-summary">
                                                                    <td colSpan={4}><strong>GENEL</strong></td>
                                                                    <td><strong>{ref.overallAvg}</strong></td>
                                                                    <td>—</td>
                                                                    <td>—</td>
                                                                    <td className="orange-text"><strong>{ref.overallStdDev}</strong></td>
                                                                    <td>
                                                                        <span className="an-grade" style={{
                                                                            background: ref.consistency >= 70 ? '#DCFCE7' : ref.consistency >= 50 ? '#FEF3C7' : '#FEE2E2',
                                                                            color: ref.consistency >= 70 ? '#16A34A' : ref.consistency >= 50 ? '#D97706' : '#DC2626'
                                                                        }}>
                                                                            %{ref.consistency}
                                                                        </span>
                                                                    </td>
                                                                </tr>
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </section>
                                            ))}
                                        </>
                                    )}
                                </div>
                            </>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}
