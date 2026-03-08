import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../lib/firebase';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell
} from 'recharts';
import './AnalyticsPage.css';

const COLORS = ['#6366F1', '#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
const GENDER_COLORS = ['#3B82F6', '#EC4899']; // Blue for Erkek, Pink for Kadın

export default function AnalyticsPage() {
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);

    // Global Stats
    const [stats, setStats] = useState({
        totalCompetitions: 0,
        totalAthletes: 0,
        totalScores: 0,
        totalReferees: 0
    });

    // Chart Data
    const [genderData, setGenderData] = useState([]);
    const [typeData, setTypeData] = useState([]); // Takım vs Ferdi
    const [refereeConsistency, setRefereeConsistency] = useState([]); // Hakem analizi

    // Filters
    const [competitions, setCompetitions] = useState([]);
    const [selectedCompId, setSelectedCompId] = useState('all');

    // 1. Fetch initial definitions (Competitions, Global counts)
    useEffect(() => {
        const compsRef = ref(db, 'competitions');
        const refsRef = ref(db, 'referees');

        let compsCount = 0;
        let athletesCount = 0;
        let scoresCount = 0;
        let refsCount = 0;

        let compsList = [];

        // Global counters & Chart prep
        let maleCount = 0;
        let femaleCount = 0;
        let teamCount = 0;
        let indCount = 0;

        // Referee Scores dictionary for consistency standard deviation
        // { refName: { count: x, totalDelta: y } } 
        // We'll simplify this to just average D and E scores per referee across all/selected events for now
        let refereeStats = {};

        const unsubscribeComps = onValue(compsRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                compsCount = Object.keys(data).length;

                Object.keys(data).forEach(compId => {
                    const comp = data[compId];
                    compsList.push({ id: compId, isim: comp.isim || 'İsimsiz Yarışma' });

                    // Only process details if "all" is selected OR it matches the specific dropdown
                    if (selectedCompId === 'all' || selectedCompId === compId) {

                        // Count Athletes & their Types/Genders
                        if (comp.sporcular) {
                            Object.keys(comp.sporcular).forEach(catId => {
                                const athletesInCat = comp.sporcular[catId];
                                athletesCount += Object.keys(athletesInCat).length;

                                Object.values(athletesInCat).forEach(ath => {
                                    // Gender
                                    if (catId.includes('erkek')) maleCount++;
                                    else if (catId.includes('kiz')) femaleCount++;
                                    else {
                                        // Fallback heuristics if category name doesn't imply it clearly
                                        if (ath.cinsiyet === 'Erkek') maleCount++;
                                        else femaleCount++;
                                    }

                                    // Takım vs Ferdi
                                    if (ath.turu === 'Takım') teamCount++;
                                    else indCount++;
                                });
                            });
                        }

                        // Count Scores & prep Referee Analysis
                        if (comp.puanlar) {
                            Object.keys(comp.puanlar).forEach(catId => {
                                const catScores = comp.puanlar[catId];
                                Object.keys(catScores).forEach(appId => {
                                    const appScores = catScores[appId];
                                    Object.keys(appScores).forEach(athId => {
                                        scoresCount++;
                                        const scoreEntry = appScores[athId];

                                        // Referee consistency prep
                                        if (scoreEntry.hakemPuanlari) {
                                            Object.keys(scoreEntry.hakemPuanlari).forEach(refKey => {
                                                const dPuan = parseFloat(scoreEntry.hakemPuanlari[refKey].d) || 0;
                                                const ePuan = parseFloat(scoreEntry.hakemPuanlari[refKey].e) || 0;

                                                if (!refereeStats[refKey]) {
                                                    refereeStats[refKey] = { name: refKey.replace('_', ' Hakem '), dTotal: 0, eTotal: 0, count: 0 };
                                                }
                                                refereeStats[refKey].dTotal += dPuan;
                                                refereeStats[refKey].eTotal += ePuan;
                                                refereeStats[refKey].count++;
                                            });
                                        }
                                    });
                                });
                            });
                        }
                    }
                });
            }

            setCompetitions(compsList);

            // Fetch Refs
            onValue(refsRef, (refSnap) => {
                const refsData = refSnap.val();
                if (refsData) {
                    refsCount = Object.keys(refsData).length;
                }

                setStats({
                    totalCompetitions: compsCount,
                    totalAthletes: athletesCount,
                    totalScores: scoresCount,
                    totalReferees: refsCount
                });

                setGenderData([
                    { name: 'Erkek', value: maleCount },
                    { name: 'Kadın', value: femaleCount }
                ]);

                setTypeData([
                    { name: 'Takım', value: teamCount },
                    { name: 'Ferdi', value: indCount }
                ]);

                const formattedRefStats = Object.keys(refereeStats).map(k => {
                    return {
                        name: refereeStats[k].name,
                        avgD: +(refereeStats[k].dTotal / refereeStats[k].count).toFixed(2),
                        avgE: +(refereeStats[k].eTotal / refereeStats[k].count).toFixed(2),
                        count: refereeStats[k].count
                    };
                }).sort((a, b) => b.count - a.count).slice(0, 10); // Top 10 most active

                setRefereeConsistency(formattedRefStats);
                setLoading(false);
            }, { onlyOnce: true });

        }, (error) => {
            console.error("Fetch error:", error);
            setLoading(false);
        });

        return () => unsubscribeComps();
    }, [selectedCompId]);

    // Custom Tooltip for Pie Charts
    const renderCustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            return (
                <div className="custom-pie-tooltip">
                    <p className="pt-label">{`${payload[0].name}: ${payload[0].value} Sporcu`}</p>
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
                        <p className="page-subtitle text-white-50">Big Data Dashboard ve Hakem Tutarlılık Analizleri.</p>
                    </div>
                </div>

                <div className="page-header__actions">
                    <div className="filter-group">
                        <i className="material-icons-round text-white-50">filter_alt</i>
                        <select
                            className="select-glass"
                            value={selectedCompId}
                            onChange={(e) => setSelectedCompId(e.target.value)}
                        >
                            <option value="all">Tüm Zamanlar (Genel)</option>
                            {competitions.map(c => (
                                <option key={c.id} value={c.id}>{c.isim}</option>
                            ))}
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
                        {/* KPI Cards */}
                        <section className="kpi-grid">
                            <div className="kpi-card glass-panel">
                                <div className="kpi-icon blue"><i className="material-icons-round">emoji_events</i></div>
                                <div className="kpi-data">
                                    <span className="kpi-value">{stats.totalCompetitions}</span>
                                    <span className="kpi-label">Toplam Yarışma</span>
                                </div>
                            </div>
                            <div className="kpi-card glass-panel">
                                <div className="kpi-icon green"><i className="material-icons-round">groups</i></div>
                                <div className="kpi-data">
                                    <span className="kpi-value">{stats.totalAthletes}</span>
                                    <span className="kpi-label">Kayıtlı Sporcu</span>
                                </div>
                            </div>
                            <div className="kpi-card glass-panel">
                                <div className="kpi-icon orange"><i className="material-icons-round">done_all</i></div>
                                <div className="kpi-data">
                                    <span className="kpi-value">{stats.totalScores}</span>
                                    <span className="kpi-label">Girilen Puan</span>
                                </div>
                            </div>
                            <div className="kpi-card glass-panel">
                                <div className="kpi-icon purple"><i className="material-icons-round">gavel</i></div>
                                <div className="kpi-data">
                                    <span className="kpi-value">{stats.totalReferees}</span>
                                    <span className="kpi-label">Hakem Havuzu</span>
                                </div>
                            </div>
                        </section>

                        {/* Charts Area */}
                        <section className="charts-grid mt-4">

                            {/* Left Column: Demographics */}
                            <div className="charts-col">
                                <div className="chart-panel glass-panel">
                                    <h3 className="chart-title">
                                        <i className="material-icons-round">wc</i> Cinsiyet Dağılımı
                                    </h3>
                                    <div className="chart-container">
                                        {genderData[0].value === 0 && genderData[1].value === 0 ? (
                                            <div className="empty-chart">Veri Yok</div>
                                        ) : (
                                            <ResponsiveContainer width="100%" height={250}>
                                                <PieChart>
                                                    <Pie
                                                        data={genderData}
                                                        cx="50%" cy="50%"
                                                        innerRadius={60} outerRadius={80}
                                                        paddingAngle={5}
                                                        dataKey="value"
                                                    >
                                                        {genderData.map((entry, index) => (
                                                            <Cell key={`cell-${index}`} fill={GENDER_COLORS[index % GENDER_COLORS.length]} />
                                                        ))}
                                                    </Pie>
                                                    <RechartsTooltip content={renderCustomTooltip} />
                                                    <Legend verticalAlign="bottom" height={36} />
                                                </PieChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>
                                </div>

                                <div className="chart-panel glass-panel mt-4">
                                    <h3 className="chart-title">
                                        <i className="material-icons-round">category</i> Katılım Modeli (Takım / Ferdi)
                                    </h3>
                                    <div className="chart-container">
                                        {typeData[0].value === 0 && typeData[1].value === 0 ? (
                                            <div className="empty-chart">Veri Yok</div>
                                        ) : (
                                            <ResponsiveContainer width="100%" height={250}>
                                                <PieChart>
                                                    <Pie
                                                        data={typeData}
                                                        cx="50%" cy="50%"
                                                        innerRadius={60} outerRadius={80}
                                                        paddingAngle={5}
                                                        dataKey="value"
                                                    >
                                                        {typeData.map((entry, index) => (
                                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                        ))}
                                                    </Pie>
                                                    <RechartsTooltip content={renderCustomTooltip} />
                                                    <Legend verticalAlign="bottom" height={36} />
                                                </PieChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Right Column: Referee Analysis (The core legacy feature) */}
                            <div className="charts-col right-col">
                                <div className="chart-panel glass-panel h-full flex flex-col">
                                    <div className="chart-header">
                                        <h3 className="chart-title">
                                            <i className="material-icons-round">balance</i> Hakem Puanlama Tutarlılığı
                                        </h3>
                                        <p className="text-xs text-slate-500">En çok puan giren 10 paneli baz alır. Ort. D ve E puan sapmaları.</p>
                                    </div>
                                    <div className="chart-container flex-1 mt-4">
                                        {refereeConsistency.length === 0 ? (
                                            <div className="empty-chart">Henüz puan verisi işlenmedi.</div>
                                        ) : (
                                            <ResponsiveContainer width="100%" height="100%" minHeight={400}>
                                                <BarChart data={refereeConsistency} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} />
                                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B' }} />
                                                    <RechartsTooltip
                                                        cursor={{ fill: 'rgba(99, 102, 241, 0.05)' }}
                                                        contentStyle={{ borderRadius: '0.75rem', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                                                    />
                                                    <Legend iconType="circle" />
                                                    <Bar dataKey="avgD" name="Ort. D Puanı" fill="#4F46E5" radius={[4, 4, 0, 0]} />
                                                    <Bar dataKey="avgE" name="Ort. E Puanı" fill="#10B981" radius={[4, 4, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>
                                </div>
                            </div>

                        </section>
                    </>
                )}
            </main>
        </div>
    );
}
