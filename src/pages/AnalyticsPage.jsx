import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../lib/firebase';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell, ScatterChart, Scatter, ZAxis, LineChart, Line, RadarChart, Radar, PolarGrid,
    PolarAngleAxis, PolarRadiusAxis
} from 'recharts';
import { useAuth } from '../lib/AuthContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import './AnalyticsPage.css';

const COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];
const GENDER_COLORS = ['#3B82F6', '#EC4899'];

// Standart sapma hesapla
function calcStdDev(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sqDiffs = values.map(v => Math.pow(v - mean, 2));
    return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
}

export default function AnalyticsPage() {
    const navigate = useNavigate();
    const { currentUser } = useAuth();

    const [loading, setLoading] = useState(true);
    const [rawCompetitions, setRawCompetitions] = useState({});
    const [refereesData, setRefereesData] = useState({});
    const [selectedCompId, setSelectedCompId] = useState('all');

    // Firebase'den veri çek
    useEffect(() => {
        const compsRef = ref(db, 'competitions');
        const refsRef = ref(db, 'referees');

        const unsubComps = onValue(compsRef, (snap) => {
            setRawCompetitions(snap.val() || {});
        });

        const unsubRefs = onValue(refsRef, (snap) => {
            setRefereesData(snap.val() || {});
            setLoading(false);
        });

        return () => { unsubComps(); unsubRefs(); };
    }, []);

    // Filtrelenmiş yarışmalar
    const filteredComps = useMemo(() => {
        const all = filterCompetitionsByUser(rawCompetitions, currentUser);
        if (selectedCompId === 'all') return all;
        if (all[selectedCompId]) return { [selectedCompId]: all[selectedCompId] };
        return {};
    }, [rawCompetitions, currentUser, selectedCompId]);

    // Yarışma listesi (dropdown)
    const competitionsList = useMemo(() => {
        const all = filterCompetitionsByUser(rawCompetitions, currentUser);
        return Object.entries(all).map(([id, c]) => ({ id, isim: c.isim || 'İsimsiz' }));
    }, [rawCompetitions, currentUser]);

    // ─── TÜM VERİLERİ İŞLE ───
    const analytics = useMemo(() => {
        let totalAthletes = 0;
        let totalScores = 0;
        let maleCount = 0, femaleCount = 0;
        let teamCount = 0, indCount = 0;
        const categoryStats = {}; // { catId: { athletes, scores, avgTotal } }
        const apparatusStats = {}; // { appName: { count, totalScore } }
        const allTotals = []; // Tüm toplam puanlar (histogram için)
        const allDScores = [];
        const allEScores = [];

        // Hakem detaylı istatistikleri
        const refereeDetailed = {};
        // { refKey: { name, dScores: [], eScores: [], totalScores: [], count } }

        // Hakem çiftleri arası tutarlılık
        const pairwiseScores = {};
        // { "athId_appId": { refKey: totalScore } }

        Object.entries(filteredComps).forEach(([compId, comp]) => {
            // Sporcular
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

                        if (ath.turu === 'Takım') teamCount++;
                        else indCount++;
                    });
                });
            }

            // Puanlar — Gerçek yapı: puanlar/{catId}/{appId}/{athId} = { calc_D, calc_E, sonuc, e1, e2, e3, tarafsiz, ... }
            if (comp.puanlar) {
                Object.entries(comp.puanlar).forEach(([catId, catScores]) => {
                    if (!categoryStats[catId]) categoryStats[catId] = { athletes: 0, scores: 0, totalD: 0, totalE: 0, totalFinal: 0, scoreEntries: 0 };

                    Object.entries(catScores).forEach(([appId, appScores]) => {
                        const appLabel = appId.replace(/_/g, ' ');
                        if (!apparatusStats[appLabel]) apparatusStats[appLabel] = { count: 0, totalScore: 0 };

                        Object.entries(appScores).forEach(([athId, scoreEntry]) => {
                            totalScores++;
                            categoryStats[catId].scores++;

                            const d = parseFloat(scoreEntry.calc_D) || 0;
                            const e = parseFloat(scoreEntry.calc_E) || 0;
                            const total = parseFloat(scoreEntry.sonuc) || (d + e);

                            if (total > 0) {
                                allDScores.push(d);
                                allEScores.push(e);
                                allTotals.push(total);

                                categoryStats[catId].totalD += d;
                                categoryStats[catId].totalE += e;
                                categoryStats[catId].totalFinal += total;
                                categoryStats[catId].scoreEntries++;

                                apparatusStats[appLabel].count++;
                                apparatusStats[appLabel].totalScore += total;
                            }

                            // Hakem E paneli düşüm puanları: e1, e2, e3, e4, ... + tarafsiz
                            const pairKey = `${compId}_${catId}_${appId}_${athId}`;
                            const judgeKeys = Object.keys(scoreEntry).filter(k => /^e\d+$/.test(k));

                            judgeKeys.forEach(jKey => {
                                const deduction = parseFloat(scoreEntry[jKey]);
                                if (isNaN(deduction)) return;

                                const refLabel = `E Hakem ${jKey.replace('e', '')}`;
                                if (!refereeDetailed[refLabel]) {
                                    refereeDetailed[refLabel] = { name: refLabel, deductions: [], dScores: [], eScores: [], totalScores: [], count: 0 };
                                }
                                refereeDetailed[refLabel].deductions.push(deduction);
                                refereeDetailed[refLabel].dScores.push(d);
                                refereeDetailed[refLabel].eScores.push(deduction); // Hakem düşümü
                                refereeDetailed[refLabel].totalScores.push(deduction);
                                refereeDetailed[refLabel].count++;

                                // Çiftli karşılaştırma (hakemler arası uyum için)
                                if (!pairwiseScores[pairKey]) pairwiseScores[pairKey] = {};
                                pairwiseScores[pairKey][jKey] = deduction;
                            });

                            // Tarafsız hakem
                            if (scoreEntry.tarafsiz !== undefined && scoreEntry.tarafsiz !== null) {
                                const neutralVal = parseFloat(scoreEntry.tarafsiz);
                                if (!isNaN(neutralVal)) {
                                    const nLabel = 'Tarafsız Hakem';
                                    if (!refereeDetailed[nLabel]) {
                                        refereeDetailed[nLabel] = { name: nLabel, deductions: [], dScores: [], eScores: [], totalScores: [], count: 0 };
                                    }
                                    refereeDetailed[nLabel].deductions.push(neutralVal);
                                    refereeDetailed[nLabel].eScores.push(neutralVal);
                                    refereeDetailed[nLabel].totalScores.push(neutralVal);
                                    refereeDetailed[nLabel].dScores.push(d);
                                    refereeDetailed[nLabel].count++;
                                }
                            }
                        });
                    });
                });
            }
        });

        // ─── Hakem Tutarlılık Metrikleri ───
        const refereeAnalysis = Object.entries(refereeDetailed).map(([key, ref]) => {
            const deductions = ref.deductions || ref.eScores;
            const avgDeduction = deductions.reduce((a, b) => a + b, 0) / deductions.length;
            const avgD = ref.dScores.length > 0 ? ref.dScores.reduce((a, b) => a + b, 0) / ref.dScores.length : 0;
            const stdDev = calcStdDev(deductions);
            // Tutarlılık skoru: düşük std dev = yüksek tutarlılık (max ~3 std dev for deductions)
            const consistency = Math.max(0, Math.min(100, 100 - (stdDev * 50)));

            return {
                name: key,
                key,
                avgDeduction: +avgDeduction.toFixed(2),
                avgD: +avgD.toFixed(2),
                avgE: +avgDeduction.toFixed(2), // For chart compat
                avgTotal: +(avgD + (10 - avgDeduction)).toFixed(2), // Approximate total
                stdDev: +stdDev.toFixed(3),
                stdDevD: +stdDev.toFixed(3),
                stdDevE: +stdDev.toFixed(3),
                stdDevTotal: +stdDev.toFixed(3),
                consistency: +consistency.toFixed(1),
                count: ref.count
            };
        }).sort((a, b) => b.count - a.count);

        // ─── Hakem Arası Uyum (Inter-rater Agreement) ───
        let agreementSum = 0;
        let agreementCount = 0;
        Object.values(pairwiseScores).forEach(refScores => {
            const refs = Object.keys(refScores);
            if (refs.length < 2) return;
            for (let i = 0; i < refs.length; i++) {
                for (let j = i + 1; j < refs.length; j++) {
                    const diff = Math.abs(refScores[refs[i]] - refScores[refs[j]]);
                    agreementSum += diff;
                    agreementCount++;
                }
            }
        });
        const avgInterRaterDiff = agreementCount > 0 ? +(agreementSum / agreementCount).toFixed(3) : 0;

        // ─── Puan Dağılım Histogramı ───
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

        // ─── Kategori Bazlı Ortalamalar ───
        const categoryChartData = Object.entries(categoryStats)
            .filter(([, s]) => s.scoreEntries > 0)
            .map(([catId, s]) => ({
                name: catId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                avgD: +(s.totalD / s.scoreEntries).toFixed(2),
                avgE: +(s.totalE / s.scoreEntries).toFixed(2),
                sporcu: s.athletes,
                puan: s.scores
            }))
            .sort((a, b) => b.sporcu - a.sporcu)
            .slice(0, 12);

        // ─── Alet Bazlı Ortalamalar ───
        const apparatusChartData = Object.entries(apparatusStats)
            .map(([name, s]) => ({
                name: name.toUpperCase().slice(0, 10),
                avgScore: +(s.totalScore / s.count).toFixed(2),
                count: s.count
            }))
            .sort((a, b) => b.count - a.count);

        // ─── Genel İstatistikler ───
        const globalAvgD = allDScores.length > 0 ? +(allDScores.reduce((a, b) => a + b, 0) / allDScores.length).toFixed(2) : 0;
        const globalAvgE = allEScores.length > 0 ? +(allEScores.reduce((a, b) => a + b, 0) / allEScores.length).toFixed(2) : 0;
        const globalAvgTotal = allTotals.length > 0 ? +(allTotals.reduce((a, b) => a + b, 0) / allTotals.length).toFixed(2) : 0;

        // En tutarlı ve en tutarsız hakemler (min 5 puanlama)
        const qualifiedRefs = refereeAnalysis.filter(r => r.count >= 5);
        const mostConsistent = [...qualifiedRefs].sort((a, b) => a.stdDevTotal - b.stdDevTotal).slice(0, 5);
        const leastConsistent = [...qualifiedRefs].sort((a, b) => b.stdDevTotal - a.stdDevTotal).slice(0, 5);

        // Scatter: Ort. Düşüm vs Std Sapma (hakem başına)
        const scatterData = refereeAnalysis.filter(r => r.count >= 3).map(r => ({
            name: r.name,
            x: r.avgDeduction,
            y: r.stdDev,
            z: r.count
        }));

        // Radar: Top 5 hakem profili
        const top5Refs = refereeAnalysis.slice(0, 5);
        const radarData = top5Refs.length > 0 ? [
            { metric: 'Ort. D', ...Object.fromEntries(top5Refs.map(r => [r.name, r.avgD])) },
            { metric: 'Ort. E', ...Object.fromEntries(top5Refs.map(r => [r.name, r.avgE])) },
            { metric: 'Tutarlılık', ...Object.fromEntries(top5Refs.map(r => [r.name, r.consistency / 10])) },
            { metric: 'Deneyim', ...Object.fromEntries(top5Refs.map(r => [r.name, Math.min(r.count / 5, 10)])) },
        ] : [];

        return {
            totalComps: Object.keys(filteredComps).length,
            totalAthletes,
            totalScores,
            totalReferees: Object.keys(refereesData).length,
            globalAvgD, globalAvgE, globalAvgTotal,
            avgInterRaterDiff,
            genderData: [{ name: 'Erkek', value: maleCount }, { name: 'Kadın', value: femaleCount }],
            typeData: [{ name: 'Takım', value: teamCount }, { name: 'Ferdi', value: indCount }],
            refereeAnalysis,
            mostConsistent,
            leastConsistent,
            histogramBins,
            categoryChartData,
            apparatusChartData,
            scatterData,
            radarData,
            top5Refs,
            activeRefereeCount: refereeAnalysis.filter(r => r.count > 0).length,
        };
    }, [filteredComps, refereesData]);

    // Tooltip'ler
    const pieTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            return (
                <div className="an-tooltip">
                    <strong>{payload[0].name}</strong>: {payload[0].value} sporcu
                </div>
            );
        }
        return null;
    };

    const barTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            return (
                <div className="an-tooltip">
                    <strong>{label}</strong>
                    {payload.map((p, i) => (
                        <div key={i} style={{ color: p.color }}>{p.name}: {p.value}</div>
                    ))}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="analytics-page premium-layout">
            <header className="page-header--bento premium-header">
                <div className="page-header__left">
                    <button className="back-btn back-btn--light" onClick={() => navigate('/')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div className="header-title-wrapper">
                        <h1 className="page-title text-white">Raporlar & Analiz</h1>
                        <p className="page-subtitle text-white-50">Puan dağılımları, hakem tutarlılık analizleri ve kategori istatistikleri</p>
                    </div>
                </div>
                <div className="page-header__actions">
                    <div className="filter-group">
                        <i className="material-icons-round text-white-50">filter_alt</i>
                        <select className="select-glass" value={selectedCompId} onChange={(e) => setSelectedCompId(e.target.value)}>
                            <option value="all">Tüm Yarışmalar (Genel)</option>
                            {competitionsList.map(c => <option key={c.id} value={c.id}>{c.isim}</option>)}
                        </select>
                    </div>
                </div>
            </header>

            <main className="premium-main-content analytics-main">
                {loading ? (
                    <div className="loading-state h-full w-full">
                        <div className="spinner"></div><p>Veriler işleniyor...</p>
                    </div>
                ) : (
                    <>
                        {/* ─── KPI CARDS ─── */}
                        <section className="kpi-grid">
                            <div className="kpi-card glass-panel">
                                <div className="kpi-icon blue"><i className="material-icons-round">emoji_events</i></div>
                                <div className="kpi-data">
                                    <span className="kpi-value">{analytics.totalComps}</span>
                                    <span className="kpi-label">Toplam Yarışma</span>
                                </div>
                            </div>
                            <div className="kpi-card glass-panel">
                                <div className="kpi-icon green"><i className="material-icons-round">groups</i></div>
                                <div className="kpi-data">
                                    <span className="kpi-value">{analytics.totalAthletes}</span>
                                    <span className="kpi-label">Kayıtlı Sporcu</span>
                                </div>
                            </div>
                            <div className="kpi-card glass-panel">
                                <div className="kpi-icon orange"><i className="material-icons-round">done_all</i></div>
                                <div className="kpi-data">
                                    <span className="kpi-value">{analytics.totalScores}</span>
                                    <span className="kpi-label">Girilen Puan</span>
                                </div>
                            </div>
                            <div className="kpi-card glass-panel">
                                <div className="kpi-icon purple"><i className="material-icons-round">gavel</i></div>
                                <div className="kpi-data">
                                    <span className="kpi-value">{analytics.totalReferees}</span>
                                    <span className="kpi-label">Hakem Havuzu</span>
                                </div>
                            </div>
                        </section>

                        {/* ─── PUAN ORTALAMA KPI ─── */}
                        <section className="kpi-grid kpi-grid--secondary">
                            <div className="kpi-card-mini glass-panel">
                                <span className="kpi-mini-label">Ort. D Puanı</span>
                                <span className="kpi-mini-value blue-text">{analytics.globalAvgD}</span>
                            </div>
                            <div className="kpi-card-mini glass-panel">
                                <span className="kpi-mini-label">Ort. E Puanı</span>
                                <span className="kpi-mini-value green-text">{analytics.globalAvgE}</span>
                            </div>
                            <div className="kpi-card-mini glass-panel">
                                <span className="kpi-mini-label">Ort. Toplam</span>
                                <span className="kpi-mini-value">{analytics.globalAvgTotal}</span>
                            </div>
                            <div className="kpi-card-mini glass-panel">
                                <span className="kpi-mini-label">Aktif Hakem</span>
                                <span className="kpi-mini-value purple-text">{analytics.activeRefereeCount}</span>
                            </div>
                            <div className="kpi-card-mini glass-panel">
                                <span className="kpi-mini-label">Hakemler Arası Fark</span>
                                <span className="kpi-mini-value orange-text">{analytics.avgInterRaterDiff}</span>
                            </div>
                        </section>

                        {/* ─── ROW 1: Demografi + Puan Dağılımı ─── */}
                        <section className="charts-grid charts-grid--3col">
                            {/* Cinsiyet */}
                            <div className="chart-panel glass-panel">
                                <h3 className="chart-title"><i className="material-icons-round">wc</i> Cinsiyet Dağılımı</h3>
                                <div className="chart-container">
                                    {analytics.genderData[0].value === 0 && analytics.genderData[1].value === 0 ? (
                                        <div className="empty-chart">Veri Yok</div>
                                    ) : (
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

                            {/* Katılım Modeli */}
                            <div className="chart-panel glass-panel">
                                <h3 className="chart-title"><i className="material-icons-round">category</i> Katılım Modeli</h3>
                                <div className="chart-container">
                                    {analytics.typeData[0].value === 0 && analytics.typeData[1].value === 0 ? (
                                        <div className="empty-chart">Veri Yok</div>
                                    ) : (
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

                            {/* Puan Histogramı */}
                            <div className="chart-panel glass-panel">
                                <h3 className="chart-title"><i className="material-icons-round">bar_chart</i> Toplam Puan Dağılımı</h3>
                                <div className="chart-container">
                                    {analytics.histogramBins.every(b => b.count === 0) ? (
                                        <div className="empty-chart">Veri Yok</div>
                                    ) : (
                                        <ResponsiveContainer width="100%" height={220}>
                                            <BarChart data={analytics.histogramBins}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                                <XAxis dataKey="range" tick={{ fontSize: 11, fill: '#64748B' }} />
                                                <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                                                <RechartsTooltip content={barTooltip} />
                                                <Bar dataKey="count" name="Puan Sayısı" fill="#6366F1" radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    )}
                                </div>
                            </div>
                        </section>

                        {/* ─── ROW 2: Hakem Tutarlılık Ana Panel ─── */}
                        <section className="chart-panel glass-panel an-full-width">
                            <div className="chart-header">
                                <h3 className="chart-title"><i className="material-icons-round">balance</i> Hakem Puanlama Tutarlılığı</h3>
                                <p className="chart-subtitle">Her hakemin ortalama D/E puanları ve standart sapması. Düşük std sapma = yüksek tutarlılık.</p>
                            </div>
                            <div className="chart-container" style={{ minHeight: 350 }}>
                                {analytics.refereeAnalysis.length === 0 ? (
                                    <div className="empty-chart">Henüz yeterli puan verisi yok.</div>
                                ) : (
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
                                                            <span>Puanlama:</span><span>{data?.count} adet</span>
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

                        {/* ─── ROW 3: Tutarlılık Karşılaştırma Kartları ─── */}
                        <section className="charts-grid charts-grid--2col">
                            {/* En Tutarlı Hakemler */}
                            <div className="chart-panel glass-panel">
                                <h3 className="chart-title"><i className="material-icons-round" style={{ color: '#16A34A' }}>verified</i> En Tutarlı Hakemler</h3>
                                <p className="chart-subtitle">En düşük standart sapmaya sahip hakemler (min. 5 puanlama)</p>
                                {analytics.mostConsistent.length === 0 ? (
                                    <div className="empty-chart" style={{ minHeight: 120 }}>Yeterli veri yok</div>
                                ) : (
                                    <div className="an-ref-list">
                                        {analytics.mostConsistent.map((ref, i) => (
                                            <div key={ref.key} className="an-ref-item">
                                                <div className="an-ref-rank an-ref-rank--good">{i + 1}</div>
                                                <div className="an-ref-info">
                                                    <strong>{ref.name}</strong>
                                                    <span>{ref.count} puanlama</span>
                                                </div>
                                                <div className="an-ref-metrics">
                                                    <span className="an-metric">
                                                        <label>Std Sapma</label>
                                                        <strong>{ref.stdDevTotal}</strong>
                                                    </span>
                                                    <span className="an-metric">
                                                        <label>Tutarlılık</label>
                                                        <strong className="green-text">%{ref.consistency}</strong>
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* En Tutarsız Hakemler */}
                            <div className="chart-panel glass-panel">
                                <h3 className="chart-title"><i className="material-icons-round" style={{ color: '#DC2626' }}>warning</i> Dikkat Edilmesi Gereken Hakemler</h3>
                                <p className="chart-subtitle">En yüksek standart sapmaya sahip hakemler (min. 5 puanlama)</p>
                                {analytics.leastConsistent.length === 0 ? (
                                    <div className="empty-chart" style={{ minHeight: 120 }}>Yeterli veri yok</div>
                                ) : (
                                    <div className="an-ref-list">
                                        {analytics.leastConsistent.map((ref, i) => (
                                            <div key={ref.key} className="an-ref-item">
                                                <div className="an-ref-rank an-ref-rank--warn">{i + 1}</div>
                                                <div className="an-ref-info">
                                                    <strong>{ref.name}</strong>
                                                    <span>{ref.count} puanlama</span>
                                                </div>
                                                <div className="an-ref-metrics">
                                                    <span className="an-metric">
                                                        <label>Std Sapma</label>
                                                        <strong>{ref.stdDevTotal}</strong>
                                                    </span>
                                                    <span className="an-metric">
                                                        <label>Tutarlılık</label>
                                                        <strong className="red-text">%{ref.consistency}</strong>
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </section>

                        {/* ─── ROW 4: Hakem D vs E Scatter + Kategori Analizi ─── */}
                        <section className="charts-grid charts-grid--2col">
                            {/* Scatter: D vs E */}
                            <div className="chart-panel glass-panel">
                                <h3 className="chart-title"><i className="material-icons-round">scatter_plot</i> Hakem Düşüm vs Tutarlılık</h3>
                                <p className="chart-subtitle">Her nokta bir hakem. X = Ort. Düşüm, Y = Std Sapma. Boyut = puanlama sayısı.</p>
                                <div className="chart-container">
                                    {analytics.scatterData.length === 0 ? (
                                        <div className="empty-chart">Veri Yok</div>
                                    ) : (
                                        <ResponsiveContainer width="100%" height={300}>
                                            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                                                <XAxis type="number" dataKey="x" name="Ort. Düşüm" tick={{ fontSize: 11, fill: '#64748B' }} label={{ value: 'Ort. Düşüm', position: 'bottom', fontSize: 12, fill: '#94A3B8' }} />
                                                <YAxis type="number" dataKey="y" name="Std Sapma" tick={{ fontSize: 11, fill: '#64748B' }} label={{ value: 'Std Sapma', angle: -90, position: 'left', fontSize: 12, fill: '#94A3B8' }} />
                                                <ZAxis type="number" dataKey="z" range={[40, 400]} name="Puanlama" />
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

                            {/* Kategori Bazlı */}
                            <div className="chart-panel glass-panel">
                                <h3 className="chart-title"><i className="material-icons-round">leaderboard</i> Kategori Bazlı Ortalamalar</h3>
                                <p className="chart-subtitle">Her kategorideki ortalama D ve E puanları</p>
                                <div className="chart-container">
                                    {analytics.categoryChartData.length === 0 ? (
                                        <div className="empty-chart">Veri Yok</div>
                                    ) : (
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
                        </section>

                        {/* ─── ROW 5: Alet Bazlı + Hakem Tablo ─── */}
                        <section className="charts-grid charts-grid--2col">
                            {/* Alet Bazlı */}
                            <div className="chart-panel glass-panel">
                                <h3 className="chart-title"><i className="material-icons-round">fitness_center</i> Alet Bazlı Ortalama Puanlar</h3>
                                <div className="chart-container">
                                    {analytics.apparatusChartData.length === 0 ? (
                                        <div className="empty-chart">Veri Yok</div>
                                    ) : (
                                        <ResponsiveContainer width="100%" height={280}>
                                            <BarChart data={analytics.apparatusChartData} layout="vertical" margin={{ top: 10, right: 30, left: 60, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                                                <XAxis type="number" tick={{ fill: '#64748B' }} />
                                                <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: '#64748B' }} width={80} />
                                                <RechartsTooltip content={barTooltip} />
                                                <Bar dataKey="avgScore" name="Ort. Puan" fill="#8B5CF6" radius={[0, 4, 4, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    )}
                                </div>
                            </div>

                            {/* Detaylı Hakem Tablosu */}
                            <div className="chart-panel glass-panel">
                                <h3 className="chart-title"><i className="material-icons-round">table_chart</i> Hakem Detaylı İstatistikler</h3>
                                <div className="an-table-wrap">
                                    {analytics.refereeAnalysis.length === 0 ? (
                                        <div className="empty-chart" style={{ minHeight: 120 }}>Veri yok</div>
                                    ) : (
                                        <table className="an-table">
                                            <thead>
                                                <tr>
                                                    <th>Hakem</th>
                                                    <th>Say.</th>
                                                    <th>Ort. Düşüm</th>
                                                    <th>Std. Sapma</th>
                                                    <th>Tutarlılık</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {analytics.refereeAnalysis.slice(0, 20).map(ref => (
                                                    <tr key={ref.key}>
                                                        <td><strong>{ref.name}</strong></td>
                                                        <td>{ref.count}</td>
                                                        <td className="red-text">{ref.avgDeduction}</td>
                                                        <td className="orange-text">{ref.stdDev}</td>
                                                        <td>
                                                            <div className="an-consistency-bar">
                                                                <div
                                                                    className="an-consistency-fill"
                                                                    style={{
                                                                        width: `${Math.min(ref.consistency, 100)}%`,
                                                                        background: ref.consistency >= 80 ? '#16A34A' : ref.consistency >= 60 ? '#F59E0B' : '#DC2626'
                                                                    }}
                                                                />
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
                    </>
                )}
            </main>
        </div>
    );
}
