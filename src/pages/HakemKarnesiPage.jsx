/**
 * HakemKarnesiPage — Detaylı hakem performans analizi
 *
 * Disipline göre:
 *  - RİTMİK: puanlar/{cat}/{ath}/{alet}/aPanel|ePanel  (A + E panel, j1..j4)
 *  - ARTİSTİK: puanlar/{cat}/{aletId}/{athId}  (E panel: e1..eN düz alanlar)
 *
 * Sekmeler:
 *  1) ANALİZ (artistik) — KPI kartları + recharts grafikler + hakem tablosu +
 *     alet×hakem matrisi + hakem detay (scatter + PDF karne)
 *  2) HAKEM BAZLI — hakem performans tablosu
 *  3) SPORCU BAZLI — sporcu × alet panel notları
 */
import { useEffect, useMemo, useState } from 'react';
import { ref, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { useDiscipline } from '../lib/DisciplineContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { useAuth } from '../lib/AuthContext';
import * as XLSX from 'xlsx';
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    Cell, ReferenceLine, RadarChart, Radar, PolarGrid, PolarAngleAxis,
    ScatterChart, Scatter, ZAxis, Legend,
} from 'recharts';

/* ── Sabitler ───────────────────────────────────────────────────────── */
const PALETTE = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];
const RITMIK_ALETS = ['top', 'kurdele'];
const ALET_LABELS = {
    yer: 'Yer', atlama: 'Atlama', paralel: 'Paralel', barfiks: 'Barfiks',
    halka: 'Halka', kulplu: 'Kulplu', denge: 'Denge', asimetrik: 'Asimetrik',
    mantar: 'Mantar', kasa: 'Kasa', trampolin: 'Trambolin', tumbling: 'Tumbling',
    top: 'Top', kurdele: 'Kurdele',
};
const aletLabel = (id) => ALET_LABELS[id] || id;

/* ── Yardımcılar ─────────────────────────────────────────────────────── */
// 4+ değer varsa en yüksek + en düşük atılır. j1..j4 veya e1..eN anahtarları.
function findTrimmedKeys(panel) {
    const arr = Object.entries(panel || {})
        .filter(([k]) => /^[ej]\d+$/i.test(k))
        .map(([k, v]) => ({ k, v: parseFloat(v) }))
        .filter(e => !isNaN(e.v));
    if (arr.length < 4) {
        return { trimmed: [], values: arr, trimmedAvg: arr.length ? arr.reduce((s, e) => s + e.v, 0) / arr.length : 0 };
    }
    arr.sort((a, b) => a.v - b.v);
    const trimmed = [arr[0].k, arr[arr.length - 1].k];
    const middle = arr.slice(1, -1);
    const trimmedAvg = middle.reduce((s, e) => s + e.v, 0) / middle.length;
    return { trimmed, values: arr, trimmedAvg };
}

const fmt2 = (n) => (n == null || isNaN(n)) ? '—' : Number(n).toFixed(2);
const fmt3 = (n) => (n == null || isNaN(n)) ? '—' : Number(n).toFixed(3);
const pct  = (n) => (n == null || isNaN(n)) ? '—' : `%${(n * 100).toFixed(1)}`;
const stdDev = (arr) => {
    if (!arr.length) return 0;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
};

export default function HakemKarnesiPage() {
    const { firebasePath, label: discLabel, id: disciplineId } = useDiscipline();
    const { currentUser } = useAuth();
    const isRitmik = disciplineId === 'ritmik';
    const isArtistik = disciplineId === 'artistik';

    const [competitions, setCompetitions] = useState({});
    const [selectedCompId, setSelectedCompId] = useState('');
    const [data, setData] = useState({ scores: {}, athletes: {} });
    const [loading, setLoading] = useState(false);
    const [tab, setTab] = useState(isArtistik ? 'analiz' : 'judge'); // analiz | judge | athlete
    const [selectedJudge, setSelectedJudge] = useState(null); // drill-down
    const [pdfBusy, setPdfBusy] = useState(false);

    // Yarışmalar
    useEffect(() => {
        get(ref(db, firebasePath)).then(snap => {
            setCompetitions(filterCompetitionsByUser(snap.val() || {}, currentUser));
        });
    }, [firebasePath, currentUser]);

    // Skor + sporcu verisi
    useEffect(() => {
        if (!selectedCompId) { setData({ scores: {}, athletes: {} }); return; }
        setLoading(true);
        setSelectedJudge(null);
        Promise.all([
            get(ref(db, `${firebasePath}/${selectedCompId}/puanlar`)),
            get(ref(db, `${firebasePath}/${selectedCompId}/sporcular`)),
        ]).then(([scoresSnap, athsSnap]) => {
            setData({ scores: scoresSnap.val() || {}, athletes: athsSnap.val() || {} });
        }).finally(() => setLoading(false));
    }, [selectedCompId, firebasePath]);

    /* ── evaluations: disipline göre düzleştirme ───────────────────────── */
    const evaluations = useMemo(() => {
        const list = [];
        if (isArtistik) {
            // puanlar/{cat}/{aletId}/{athId} — E panel: e1..eN düz alanlar
            Object.entries(data.scores || {}).forEach(([catId, catScores]) => {
                Object.entries(catScores || {}).forEach(([aletId, aletScores]) => {
                    if (!aletScores || typeof aletScores !== 'object') return;
                    Object.entries(aletScores).forEach(([athId, scoreNode]) => {
                        if (!scoreNode || typeof scoreNode !== 'object') return;
                        const ath = data.athletes?.[catId]?.[athId] || {};
                        const ePanel = {};
                        Object.entries(scoreNode).forEach(([k, v]) => {
                            if (/^e\d+$/i.test(k)) ePanel[k] = v;
                        });
                        const eRes = findTrimmedKeys(ePanel);
                        if (eRes.values.length === 0) return;
                        list.push({
                            catId, aletId, athId,
                            athName: `${ath.ad || ''} ${ath.soyad || ''}`.trim(),
                            athIl: ath.il || '', athOkul: ath.okul || ath.kulup || '',
                            alet: aletId,
                            ePanel, eTrimmed: eRes.trimmed, eValues: eRes.values, eAvg: eRes.trimmedAvg,
                            aPanel: {}, aTrimmed: [], aValues: [], aAvg: 0,
                        });
                    });
                });
            });
        } else {
            // RİTMİK / diğer: puanlar/{cat}/{athId}/{alet}/aPanel|ePanel
            Object.entries(data.scores || {}).forEach(([catId, catScores]) => {
                Object.entries(catScores || {}).forEach(([athId, athScore]) => {
                    const ath = data.athletes?.[catId]?.[athId] || {};
                    const alets = isRitmik ? RITMIK_ALETS : ['_total'];
                    alets.forEach(alet => {
                        const aletScore = isRitmik ? athScore?.[alet] : athScore;
                        if (!aletScore) return;
                        const aRes = findTrimmedKeys(aletScore.aPanel || {});
                        const eRes = findTrimmedKeys(aletScore.ePanel || {});
                        list.push({
                            catId, athId,
                            athName: `${ath.ad || ''} ${ath.soyad || ''}`.trim(),
                            athIl: ath.il || '', athOkul: ath.okul || ath.kulup || '',
                            alet,
                            aPanel: aletScore.aPanel || {}, ePanel: aletScore.ePanel || {},
                            aTrimmed: aRes.trimmed, aValues: aRes.values, aAvg: aRes.trimmedAvg,
                            eTrimmed: eRes.trimmed, eValues: eRes.values, eAvg: eRes.trimmedAvg,
                        });
                    });
                });
            });
        }
        return list;
    }, [data, isRitmik, isArtistik]);

    /* ── judgeStats: temel hakem agregatı (her iki disiplin) ───────────── */
    const judgeStats = useMemo(() => {
        const stats = {};
        const init = (key) => stats[key] = stats[key] || { total: 0, trimmed: 0, ilDist: {}, devs: [] };
        evaluations.forEach(ev => {
            ev.aValues.forEach(({ k, v }) => {
                const jk = 'A' + k.replace(/[ej]/i, '');
                init(jk); stats[jk].total++;
                if (ev.aTrimmed.includes(k)) {
                    stats[jk].trimmed++;
                    if (ev.athIl) stats[jk].ilDist[ev.athIl] = (stats[jk].ilDist[ev.athIl] || 0) + 1;
                }
                stats[jk].devs.push(Math.abs(v - ev.aAvg));
            });
            ev.eValues.forEach(({ k, v }) => {
                const jk = 'E' + k.replace(/[ej]/i, '');
                init(jk); stats[jk].total++;
                if (ev.eTrimmed.includes(k)) {
                    stats[jk].trimmed++;
                    if (ev.athIl) stats[jk].ilDist[ev.athIl] = (stats[jk].ilDist[ev.athIl] || 0) + 1;
                }
                stats[jk].devs.push(Math.abs(v - ev.eAvg));
            });
        });
        return Object.entries(stats).map(([key, s]) => ({
            judge: key, total: s.total, trimmed: s.trimmed, counted: s.total - s.trimmed,
            trimmedRatio: s.total > 0 ? s.trimmed / s.total : 0,
            avgDeviation: s.devs.length ? s.devs.reduce((a, b) => a + b, 0) / s.devs.length : 0,
            ilDist: s.ilDist,
        })).sort((a, b) => a.judge.localeCompare(b.judge));
    }, [evaluations]);

    /* ── judgeStatsArtistik: zengin metrikler (sadece artistik) ────────── */
    const judgeStatsArtistik = useMemo(() => {
        if (!isArtistik) return [];
        const m = {}; // jk → {total, trimmed, absDevs, signedDevs, ilDist, perAlet}
        const init = (jk) => m[jk] = m[jk] || { total: 0, trimmed: 0, absDevs: [], signedDevs: [], ilDist: {}, perAlet: {} };
        evaluations.forEach(ev => {
            ev.eValues.forEach(({ k, v }) => {
                const jk = 'E' + k.replace(/[ej]/i, '');
                init(jk);
                const rec = m[jk];
                rec.total++;
                const isTrim = ev.eTrimmed.includes(k);
                if (isTrim) {
                    rec.trimmed++;
                    if (ev.athIl) rec.ilDist[ev.athIl] = (rec.ilDist[ev.athIl] || 0) + 1;
                }
                const signed = v - ev.eAvg;
                rec.absDevs.push(Math.abs(signed));
                rec.signedDevs.push(signed);
                // alet bazlı
                const pa = rec.perAlet[ev.alet] = rec.perAlet[ev.alet] || { count: 0, abs: [], signed: [] };
                pa.count++; pa.abs.push(Math.abs(signed)); pa.signed.push(signed);
            });
        });
        return Object.entries(m).map(([judge, s]) => {
            const avgAbs = s.absDevs.length ? s.absDevs.reduce((a, b) => a + b, 0) / s.absDevs.length : 0;
            const avgSigned = s.signedDevs.length ? s.signedDevs.reduce((a, b) => a + b, 0) / s.signedDevs.length : 0;
            const perApparatus = {};
            Object.entries(s.perAlet).forEach(([alet, pa]) => {
                perApparatus[alet] = {
                    count: pa.count,
                    avgAbsDev: pa.abs.length ? pa.abs.reduce((a, b) => a + b, 0) / pa.abs.length : 0,
                    avgSignedDev: pa.signed.length ? pa.signed.reduce((a, b) => a + b, 0) / pa.signed.length : 0,
                };
            });
            return {
                judge, total: s.total, trimmed: s.trimmed, counted: s.total - s.trimmed,
                trimmedRatio: s.total > 0 ? s.trimmed / s.total : 0,
                avgAbsDeviation: avgAbs,
                avgSignedDeviation: avgSigned,
                stdDeviation: stdDev(s.signedDevs),
                perApparatus, ilDist: s.ilDist,
            };
        }).sort((a, b) => a.judge.localeCompare(b.judge));
    }, [evaluations, isArtistik]);

    // Artistik aletleri (mevcut verideki)
    const artistikAlets = useMemo(() => {
        const set = new Set();
        evaluations.forEach(ev => set.add(ev.alet));
        return [...set].sort();
    }, [evaluations]);

    /* ── KPI ──────────────────────────────────────────────────────────── */
    const kpi = useMemo(() => {
        if (!isArtistik || judgeStatsArtistik.length === 0) return null;
        const totalEval = judgeStatsArtistik.reduce((s, j) => s + j.total, 0);
        const judgeCount = judgeStatsArtistik.length;
        const avgConsistency = judgeStatsArtistik.reduce((s, j) => s + j.avgAbsDeviation, 0) / judgeCount;
        const best = [...judgeStatsArtistik].sort((a, b) => a.avgAbsDeviation - b.avgAbsDeviation)[0];
        return { totalEval, judgeCount, avgConsistency, bestJudge: best?.judge || '—' };
    }, [isArtistik, judgeStatsArtistik]);

    /* ── Grafik verileri ──────────────────────────────────────────────── */
    const chartData = useMemo(() => {
        const countedRatio = judgeStatsArtistik.map(j => ({
            judge: j.judge,
            value: +(((j.counted) / (j.total || 1)) * 100).toFixed(1),
        }));
        const absDev = judgeStatsArtistik.map(j => ({
            judge: j.judge, value: +j.avgAbsDeviation.toFixed(3),
        }));
        const bias = judgeStatsArtistik.map(j => ({
            judge: j.judge, value: +j.avgSignedDeviation.toFixed(3),
        }));
        // Radar: her alet bir eksen, her hakem bir seri
        const radar = artistikAlets.map(alet => {
            const row = { alet: aletLabel(alet) };
            judgeStatsArtistik.forEach(j => {
                row[j.judge] = +(j.perApparatus[alet]?.avgAbsDev || 0).toFixed(3);
            });
            return row;
        });
        return { countedRatio, absDev, bias, radar };
    }, [judgeStatsArtistik, artistikAlets]);

    // Drill-down scatter: seçili hakemin notu vs panel ortalaması
    const scatterData = useMemo(() => {
        if (!selectedJudge) return [];
        const jNum = selectedJudge.replace(/\D/g, '');
        const eKey = 'e' + jNum;
        return evaluations
            .map(ev => {
                const v = ev.ePanel[eKey];
                if (v == null || isNaN(parseFloat(v))) return null;
                return {
                    x: +ev.eAvg.toFixed(3),
                    y: +parseFloat(v).toFixed(3),
                    name: ev.athName,
                    alet: aletLabel(ev.alet),
                    trimmed: ev.eTrimmed.includes(eKey),
                };
            })
            .filter(Boolean);
    }, [selectedJudge, evaluations]);

    // Sporcu bazlı görünüm
    const athleteRows = useMemo(() =>
        evaluations
            .filter(e => e.aValues.length > 0 || e.eValues.length > 0)
            .sort((a, b) => a.athName.localeCompare(b.athName, 'tr-TR')),
    [evaluations]);

    const compEntries = Object.entries(competitions).sort((a, b) =>
        new Date(b[1].tarih || b[1].baslangicTarihi || 0) - new Date(a[1].tarih || a[1].baslangicTarihi || 0)
    );

    /* ── Excel ────────────────────────────────────────────────────────── */
    const exportExcel = () => {
        const compName = competitions[selectedCompId]?.isim || selectedCompId;
        const wb = XLSX.utils.book_new();

        if (isArtistik && judgeStatsArtistik.length > 0) {
            // Sheet 1: Hakem Karnesi
            const jr = judgeStatsArtistik.map(j => ({
                'Hakem': j.judge,
                'Toplam': j.total,
                'Sayılan': j.counted,
                'Sayılmayan': j.trimmed,
                'Sayılmama %': pct(j.trimmedRatio),
                'Ort. Mutlak Sapma': fmt3(j.avgAbsDeviation),
                'Eğilim (işaretli)': fmt3(j.avgSignedDeviation),
                'Eğilim Yorumu': j.avgSignedDeviation > 0.05 ? 'Sert' : j.avgSignedDeviation < -0.05 ? 'Yumuşak' : 'Dengeli',
                'Tutarlılık (std)': fmt3(j.stdDeviation),
                'Sayılmayan İl': Object.entries(j.ilDist).sort((a, b) => b[1] - a[1]).map(([il, c]) => `${il}:${c}`).join(', '),
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(jr), 'Hakem Karnesi');

            // Sheet 2: Alet Bazlı matris
            const mr = judgeStatsArtistik.map(j => {
                const row = { 'Hakem': j.judge };
                artistikAlets.forEach(a => {
                    row[aletLabel(a)] = fmt3(j.perApparatus[a]?.avgAbsDev);
                });
                return row;
            });
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mr), 'Alet Bazlı Sapma');
        } else {
            const jr = judgeStats.map(j => ({
                'Hakem': j.judge, 'Toplam': j.total, 'Sayılan': j.counted, 'Sayılmayan': j.trimmed,
                'Sayılmama %': pct(j.trimmedRatio), 'Ort. Sapma': fmt3(j.avgDeviation),
                'Sayılmayan İl': Object.entries(j.ilDist).sort((a, b) => b[1] - a[1]).map(([il, c]) => `${il}:${c}`).join(', '),
            }));
            if (jr.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(jr), 'Hakem Karnesi');
        }

        // Sporcu Bazlı
        const ar = [];
        athleteRows.forEach(ev => {
            const row = { 'Sporcu': ev.athName, 'Okul': ev.athOkul, 'İl': ev.athIl, 'Alet': aletLabel(ev.alet) };
            if (isArtistik) {
                ev.eValues.forEach(({ k, v }) => {
                    row[k.toUpperCase()] = ev.eTrimmed.includes(k) ? `${v} (X)` : v;
                });
                row['E Ort.'] = fmt3(ev.eAvg);
            } else {
                ['j1', 'j2', 'j3', 'j4'].forEach((k, i) => {
                    const av = ev.aPanel[k], ev2 = ev.ePanel[k];
                    row[`A${i + 1}`] = av != null ? (ev.aTrimmed.includes(k) ? `${av} (X)` : av) : '';
                    row[`E${i + 1}`] = ev2 != null ? (ev.eTrimmed.includes(k) ? `${ev2} (X)` : ev2) : '';
                });
                row['A Ort.'] = fmt3(ev.aAvg); row['E Ort.'] = fmt3(ev.eAvg);
            }
            ar.push(row);
        });
        if (ar.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ar), 'Sporcu Bazlı');

        XLSX.writeFile(wb, `Hakem_Karnesi_${String(compName).slice(0, 40)}.xlsx`);
    };

    /* ── PDF hakem karnesi ────────────────────────────────────────────── */
    const exportPdf = async (onlyJudge = null) => {
        if (judgeStatsArtistik.length === 0) return;
        setPdfBusy(true);
        try {
            const { jsPDF } = await import('jspdf');
            const autotablePkg = await import('jspdf-autotable');
            const autoTable = autotablePkg.default || autotablePkg;
            const doc = new jsPDF('portrait', 'mm', 'a4');
            let font = 'helvetica';
            try {
                const r = await fetch('https://fonts.gstatic.com/s/roboto/v32/KFOmCnqEu92Fr1Me5Q.ttf');
                if (r.ok) {
                    const buf = new Uint8Array(await r.arrayBuffer());
                    let bin = '';
                    for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
                    doc.addFileToVFS('Roboto.ttf', btoa(bin));
                    doc.addFont('Roboto.ttf', 'Roboto', 'normal');
                    font = 'Roboto';
                }
            } catch { /* fallback helvetica */ }

            const compName = competitions[selectedCompId]?.isim || selectedCompId;
            const list = onlyJudge ? judgeStatsArtistik.filter(j => j.judge === onlyJudge) : judgeStatsArtistik;

            list.forEach((j, idx) => {
                if (idx > 0) doc.addPage();
                doc.setFont(font); doc.setFontSize(17);
                doc.text('HAKEM KARNESİ', 14, 18);
                doc.setFontSize(11); doc.setTextColor(90);
                doc.text(String(compName), 14, 26);
                doc.setTextColor(0); doc.setFontSize(22);
                doc.text(`${j.judge} Hakemi`, 14, 38);

                const egilim = j.avgSignedDeviation > 0.05 ? 'Sert (panele gore daha cok kesinti)'
                    : j.avgSignedDeviation < -0.05 ? 'Yumusak (panele gore daha az kesinti)' : 'Dengeli';
                autoTable(doc, {
                    startY: 44,
                    head: [['Metrik', 'Deger']],
                    body: [
                        ['Toplam Degerlendirme', String(j.total)],
                        ['Sayilan Not', String(j.counted)],
                        ['Sayilmayan Not', String(j.trimmed)],
                        ['Sayilmama Orani', pct(j.trimmedRatio)],
                        ['Ort. Mutlak Sapma', fmt3(j.avgAbsDeviation)],
                        ['Egilim (isaretli sapma)', `${fmt3(j.avgSignedDeviation)}  —  ${egilim}`],
                        ['Tutarlilik (std sapma)', fmt3(j.stdDeviation)],
                    ],
                    theme: 'grid', styles: { font, fontSize: 10 },
                    headStyles: { fillColor: [99, 102, 241] },
                    margin: { left: 14, right: 14 },
                });

                const aletBody = Object.entries(j.perApparatus).map(([a, pa]) => [
                    aletLabel(a), String(pa.count), fmt3(pa.avgAbsDev), fmt3(pa.avgSignedDev),
                ]);
                if (aletBody.length) {
                    autoTable(doc, {
                        startY: doc.lastAutoTable.finalY + 8,
                        head: [['Alet', 'Deg. Sayisi', 'Ort. Mutlak Sapma', 'Egilim']],
                        body: aletBody,
                        theme: 'striped', styles: { font, fontSize: 9 },
                        headStyles: { fillColor: [16, 185, 129] },
                        margin: { left: 14, right: 14 },
                    });
                }

                doc.setFontSize(8); doc.setTextColor(120);
                doc.text(
                    'Sapma = hakem notunun panel ortalamasindan (en yuksek+en dusuk atilmis) farki. ' +
                    'Dusuk mutlak sapma = tutarli hakem.',
                    14, doc.internal.pageSize.getHeight() - 14, { maxWidth: 180 }
                );
            });

            const safe = String(compName).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
            doc.save(onlyJudge ? `Hakem_Karnesi_${onlyJudge}_${safe}.pdf` : `Hakem_Karneleri_${safe}.pdf`);
        } catch (e) {
            if (import.meta.env.DEV) console.error('pdf error', e);
        } finally {
            setPdfBusy(false);
        }
    };

    /* ── Render ───────────────────────────────────────────────────────── */
    const tabs = isArtistik
        ? [['analiz', 'Analiz'], ['judge', 'Hakem Bazlı'], ['athlete', 'Sporcu Bazlı']]
        : [['judge', 'Hakem Bazlı'], ['athlete', 'Sporcu Bazlı']];

    return (
        <div className="page-container" style={{ padding: '1.5rem', maxWidth: 1500, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: 12 }}>
                <h1 style={{ margin: 0 }}>
                    <i className="material-icons-round" style={{ verticalAlign: 'middle', marginRight: 8 }}>assessment</i>
                    Hakem Karnesi — {discLabel || disciplineId}
                </h1>
                <div style={{ display: 'flex', gap: 8 }}>
                    {isArtistik && judgeStatsArtistik.length > 0 && (
                        <button onClick={() => exportPdf(null)} disabled={pdfBusy}
                            style={btnStyle('#6366f1', pdfBusy)}>
                            <i className="material-icons-round" style={{ verticalAlign: 'middle', marginRight: 4, fontSize: 18 }}>picture_as_pdf</i>
                            {pdfBusy ? 'Hazırlanıyor…' : 'Tüm Karneler (PDF)'}
                        </button>
                    )}
                    <button onClick={exportExcel} disabled={evaluations.length === 0}
                        style={btnStyle('#22c55e', evaluations.length === 0)}>
                        <i className="material-icons-round" style={{ verticalAlign: 'middle', marginRight: 4, fontSize: 18 }}>download</i>
                        Excel İndir
                    </button>
                </div>
            </div>

            {/* Yarışma + sekme */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: 1, minWidth: 300 }}>
                    <label style={lbl}>YARIŞMA</label>
                    <select value={selectedCompId} onChange={e => setSelectedCompId(e.target.value)}
                        style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1' }}>
                        <option value="">— Seçiniz —</option>
                        {compEntries.map(([id, c]) => (
                            <option key={id} value={id}>{c.isim} {c.il ? `· ${c.il}` : ''}</option>
                        ))}
                    </select>
                </div>
                <div style={{ display: 'flex' }}>
                    {tabs.map(([key, label], i) => (
                        <button key={key} onClick={() => setTab(key)}
                            style={{
                                padding: '0.55rem 1rem',
                                borderRadius: i === 0 ? '0.4rem 0 0 0.4rem' : i === tabs.length - 1 ? '0 0.4rem 0.4rem 0' : 0,
                                border: '1px solid #cbd5e1', borderLeft: i === 0 ? '1px solid #cbd5e1' : 'none',
                                background: tab === key ? '#0ea5e9' : '#fff',
                                color: tab === key ? '#fff' : '#475569',
                                fontWeight: 700, cursor: 'pointer',
                            }}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {loading && <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>Yükleniyor…</div>}

            {!loading && selectedCompId && evaluations.length === 0 && (
                <div style={emptyBox}>Bu yarışmada henüz panel notu girilmemiş.</div>
            )}

            {/* ═══ ANALİZ SEKMESİ (artistik) ═══ */}
            {!loading && tab === 'analiz' && isArtistik && judgeStatsArtistik.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* KPI kartları */}
                    {kpi && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                            <KpiCard color="#6366F1" icon="fact_check" label="Toplam Değerlendirme" value={kpi.totalEval} />
                            <KpiCard color="#0EA5E9" icon="groups" label="Hakem Sayısı" value={kpi.judgeCount} />
                            <KpiCard color="#F59E0B" icon="speed" label="Ort. Panel Sapması" value={fmt3(kpi.avgConsistency)} />
                            <KpiCard color="#22C55E" icon="emoji_events" label="En Tutarlı Hakem" value={kpi.bestJudge} />
                        </div>
                    )}

                    {/* Grafikler — 2 sütun */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
                        <ChartCard title="Sayılma Oranı (%)" hint="Yüksek = notları daha sık ortalamada kalan, tutarlı hakem">
                            <ResponsiveContainer width="100%" height={260}>
                                <BarChart data={chartData.countedRatio}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                    <XAxis dataKey="judge" tick={{ fontSize: 12 }} />
                                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                                    <Tooltip formatter={(v) => `%${v}`} />
                                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                                        {chartData.countedRatio.map((d, i) => (
                                            <Cell key={i} fill={d.value >= 65 ? '#22C55E' : d.value >= 50 ? '#F59E0B' : '#EF4444'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </ChartCard>

                        <ChartCard title="Ortalama Mutlak Sapma" hint="Düşük = panele yakın puanlayan tutarlı hakem">
                            <ResponsiveContainer width="100%" height={260}>
                                <BarChart data={chartData.absDev}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                    <XAxis dataKey="judge" tick={{ fontSize: 12 }} />
                                    <YAxis tick={{ fontSize: 11 }} />
                                    <Tooltip />
                                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                                        {chartData.absDev.map((d, i) => (
                                            <Cell key={i} fill={d.value <= 0.15 ? '#22C55E' : d.value <= 0.3 ? '#F59E0B' : '#EF4444'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </ChartCard>

                        <ChartCard title="Hakem Eğilimi (Sert ↔ Yumuşak)" hint="Pozitif = panelden sert (çok kesinti) · Negatif = yumuşak">
                            <ResponsiveContainer width="100%" height={260}>
                                <BarChart data={chartData.bias} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                    <XAxis type="number" tick={{ fontSize: 11 }} />
                                    <YAxis type="category" dataKey="judge" tick={{ fontSize: 12 }} width={40} />
                                    <Tooltip formatter={(v) => fmt3(v)} />
                                    <ReferenceLine x={0} stroke="#64748b" />
                                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                                        {chartData.bias.map((d, i) => (
                                            <Cell key={i} fill={d.value > 0 ? '#EF4444' : '#0EA5E9'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </ChartCard>

                        <ChartCard title="Alet Bazlı Sapma (Radar)" hint="Her hakemin alet alet ortalama mutlak sapması">
                            <ResponsiveContainer width="100%" height={260}>
                                <RadarChart data={chartData.radar}>
                                    <PolarGrid />
                                    <PolarAngleAxis dataKey="alet" tick={{ fontSize: 11 }} />
                                    {judgeStatsArtistik.map((j, i) => (
                                        <Radar key={j.judge} name={j.judge} dataKey={j.judge}
                                            stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.12} />
                                    ))}
                                    <Legend wrapperStyle={{ fontSize: 11 }} />
                                    <Tooltip />
                                </RadarChart>
                            </ResponsiveContainer>
                        </ChartCard>
                    </div>

                    {/* Hakem performans tablosu */}
                    <div style={cardBox}>
                        <div style={cardTitle}>Hakem Performans Tablosu <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: 12 }}>— satıra tıkla: detay</span></div>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
                                        <th style={th}>HAKEM</th><th style={th}>TOPLAM</th><th style={th}>SAYILAN</th>
                                        <th style={th}>SAYILMAYAN %</th><th style={th}>ORT. SAPMA</th>
                                        <th style={th}>EĞİLİM</th><th style={th}>TUTARLILIK</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {judgeStatsArtistik.map(j => {
                                        const sel = selectedJudge === j.judge;
                                        const egilim = j.avgSignedDeviation > 0.05 ? { t: 'SERT', c: '#ef4444' }
                                            : j.avgSignedDeviation < -0.05 ? { t: 'YUMUŞAK', c: '#0ea5e9' }
                                            : { t: 'DENGELİ', c: '#22c55e' };
                                        const devC = j.avgAbsDeviation <= 0.15 ? '#22c55e' : j.avgAbsDeviation <= 0.3 ? '#f59e0b' : '#ef4444';
                                        return (
                                            <tr key={j.judge}
                                                onClick={() => setSelectedJudge(sel ? null : j.judge)}
                                                style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: sel ? 'rgba(99,102,241,0.08)' : 'transparent' }}>
                                                <td style={{ ...td, fontWeight: 800, color: '#0f172a' }}>{j.judge}</td>
                                                <td style={tdCenter}>{j.total}</td>
                                                <td style={{ ...tdCenter, color: '#22c55e', fontWeight: 700 }}>{j.counted}</td>
                                                <td style={tdCenter}>{pct(j.trimmedRatio)}</td>
                                                <td style={{ ...tdCenter, color: devC, fontWeight: 700 }}>{fmt3(j.avgAbsDeviation)}</td>
                                                <td style={tdCenter}>
                                                    <span style={{ background: egilim.c, color: '#fff', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 800 }}>
                                                        {egilim.t}
                                                    </span>
                                                    <span style={{ marginLeft: 6, color: '#94a3b8', fontSize: 11 }}>{fmt3(j.avgSignedDeviation)}</span>
                                                </td>
                                                <td style={tdCenter}>{fmt3(j.stdDeviation)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Hakem detay drill-down */}
                    {selectedJudge && (() => {
                        const j = judgeStatsArtistik.find(x => x.judge === selectedJudge);
                        if (!j) return null;
                        return (
                            <div style={{ ...cardBox, borderColor: '#6366f1' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                                    <div style={cardTitle}>{selectedJudge} Hakemi — Detay</div>
                                    <button onClick={() => exportPdf(selectedJudge)} disabled={pdfBusy}
                                        style={btnStyle('#6366f1', pdfBusy)}>
                                        <i className="material-icons-round" style={{ verticalAlign: 'middle', marginRight: 4, fontSize: 16 }}>picture_as_pdf</i>
                                        PDF Karne İndir
                                    </button>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginTop: 12 }}>
                                    {/* Scatter */}
                                    <div>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>
                                            Hakem Notu ↔ Panel Ortalaması
                                        </div>
                                        <ResponsiveContainer width="100%" height={280}>
                                            <ScatterChart margin={{ top: 10, right: 16, bottom: 10, left: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                <XAxis type="number" dataKey="x" name="Panel Ort." tick={{ fontSize: 11 }} />
                                                <YAxis type="number" dataKey="y" name="Hakem Notu" tick={{ fontSize: 11 }} />
                                                <ZAxis range={[60, 60]} />
                                                <Tooltip cursor={{ strokeDasharray: '3 3' }}
                                                    formatter={(v) => fmt3(v)}
                                                    content={({ payload }) => {
                                                        if (!payload || !payload.length) return null;
                                                        const p = payload[0].payload;
                                                        return (
                                                            <div style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>
                                                                <div style={{ fontWeight: 700 }}>{p.name}</div>
                                                                <div style={{ color: '#64748b' }}>{p.alet}</div>
                                                                <div>Hakem: {fmt2(p.y)} · Panel: {fmt2(p.x)}</div>
                                                                {p.trimmed && <div style={{ color: '#ef4444' }}>Sayılmadı (uç değer)</div>}
                                                            </div>
                                                        );
                                                    }} />
                                                <Scatter data={scatterData}>
                                                    {scatterData.map((d, i) => (
                                                        <Cell key={i} fill={d.trimmed ? '#ef4444' : '#6366f1'} />
                                                    ))}
                                                </Scatter>
                                            </ScatterChart>
                                        </ResponsiveContainer>
                                    </div>
                                    {/* Alet bazlı mini özet */}
                                    <div>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>
                                            Alet Bazlı Performans
                                        </div>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                            <thead>
                                                <tr style={{ background: '#f1f5f9' }}>
                                                    <th style={th}>ALET</th><th style={th}>DEĞ.</th>
                                                    <th style={th}>MUTLAK SAPMA</th><th style={th}>EĞİLİM</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {Object.entries(j.perApparatus).map(([a, pa]) => (
                                                    <tr key={a} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                        <td style={{ ...td, fontWeight: 700 }}>{aletLabel(a)}</td>
                                                        <td style={tdCenter}>{pa.count}</td>
                                                        <td style={tdCenter}>{fmt3(pa.avgAbsDev)}</td>
                                                        <td style={{ ...tdCenter, color: pa.avgSignedDev > 0 ? '#ef4444' : '#0ea5e9' }}>
                                                            {fmt3(pa.avgSignedDev)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        {Object.keys(j.ilDist).length > 0 && (
                                            <div style={{ marginTop: 10 }}>
                                                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>
                                                    SAYILMAYAN NOTLARIN İL DAĞILIMI
                                                </div>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                    {Object.entries(j.ilDist).sort((a, b) => b[1] - a[1]).map(([il, c]) => (
                                                        <span key={il} style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                                                            {il}: <strong>{c}</strong>
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Alet × Hakem matris */}
                    <div style={cardBox}>
                        <div style={cardTitle}>Alet × Hakem Sapma Matrisi</div>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                <thead>
                                    <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
                                        <th style={{ ...th, textAlign: 'left' }}>HAKEM</th>
                                        {artistikAlets.map(a => <th key={a} style={th}>{aletLabel(a)}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {judgeStatsArtistik.map(j => (
                                        <tr key={j.judge} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ ...td, fontWeight: 800 }}>{j.judge}</td>
                                            {artistikAlets.map(a => {
                                                const dev = j.perApparatus[a]?.avgAbsDev;
                                                if (dev == null) return <td key={a} style={{ ...tdCenter, color: '#cbd5e1' }}>—</td>;
                                                const intensity = Math.min(dev / 0.5, 1);
                                                return (
                                                    <td key={a} style={{
                                                        ...tdCenter, fontWeight: 700,
                                                        background: `rgba(239,68,68,${(intensity * 0.5).toFixed(2)})`,
                                                        color: intensity > 0.6 ? '#fff' : '#0f172a',
                                                    }}>
                                                        {fmt3(dev)}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div style={hintBar}>Koyu kırmızı = yüksek sapma (panelden uzak puanlama). Açık = tutarlı.</div>
                    </div>
                </div>
            )}

            {/* ═══ HAKEM BAZLI ═══ */}
            {!loading && tab === 'judge' && judgeStats.length > 0 && (
                <div style={cardBox}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
                                    <th style={th}>HAKEM</th><th style={th}>TOPLAM</th><th style={th}>SAYILAN</th>
                                    <th style={th}>SAYILMAYAN</th><th style={th}>SAYILMAMA %</th>
                                    <th style={th}>ORT. SAPMA</th><th style={{ ...th, textAlign: 'left' }}>SAYILMAYAN İL DAĞILIMI</th>
                                </tr>
                            </thead>
                            <tbody>
                                {judgeStats.map(j => {
                                    const ratioColor = j.trimmedRatio > 0.5 ? '#ef4444' : j.trimmedRatio > 0.35 ? '#f59e0b' : '#22c55e';
                                    const ilDist = Object.entries(j.ilDist).sort((a, b) => b[1] - a[1]);
                                    return (
                                        <tr key={j.judge} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ ...td, fontWeight: 800, color: '#0f172a' }}>{j.judge}</td>
                                            <td style={tdCenter}>{j.total}</td>
                                            <td style={{ ...tdCenter, color: '#22c55e', fontWeight: 700 }}>{j.counted}</td>
                                            <td style={{ ...tdCenter, color: '#ef4444', fontWeight: 700 }}>{j.trimmed}</td>
                                            <td style={{ ...tdCenter, color: ratioColor, fontWeight: 700 }}>{pct(j.trimmedRatio)}</td>
                                            <td style={tdCenter}>{fmt3(j.avgDeviation)}</td>
                                            <td style={td}>
                                                {ilDist.length === 0 ? <span style={{ color: '#94a3b8' }}>—</span> :
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                        {ilDist.map(([il, count]) => (
                                                            <span key={il} style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                                                                {il}: <strong>{count}</strong>
                                                            </span>
                                                        ))}
                                                    </div>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div style={hintBar}>
                        <strong>SAYILMAYAN</strong>: trimmed-mean'de en yüksek/en düşük olduğu için atılan notlar.
                        <strong> Ort. Sapma</strong>: notun trimmed ortalamadan ortalama uzaklığı.
                    </div>
                </div>
            )}

            {/* ═══ SPORCU BAZLI ═══ */}
            {!loading && tab === 'athlete' && athleteRows.length > 0 && (
                <div style={{ ...cardBox, overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                            <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
                                <th style={th}>SPORCU</th><th style={th}>İL/OKUL</th><th style={th}>ALET</th>
                                {!isArtistik && <th style={{ ...th, borderLeft: '2px solid #cbd5e1' }} colSpan={4}>A PANELİ</th>}
                                {!isArtistik && <th style={th}>A ORT.</th>}
                                <th style={{ ...th, borderLeft: '2px solid #cbd5e1' }} colSpan={isArtistik ? 6 : 4}>E PANELİ</th>
                                <th style={th}>E ORT.</th>
                            </tr>
                        </thead>
                        <tbody>
                            {athleteRows.map((ev, idx) => (
                                <tr key={`${ev.catId}-${ev.athId}-${ev.alet}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                    <td style={{ ...td, fontWeight: 700 }}>{ev.athName || ev.athId}</td>
                                    <td style={td}>
                                        <div>{ev.athOkul}</div>
                                        <div style={{ fontSize: 10, color: '#94a3b8' }}>{ev.athIl}</div>
                                    </td>
                                    <td style={tdCenter}>{aletLabel(ev.alet)}</td>
                                    {!isArtistik && ['j1', 'j2', 'j3', 'j4'].map((k, i) => {
                                        const v = ev.aPanel[k], trimmed = ev.aTrimmed.includes(k);
                                        return <td key={k} style={cellStyle(v, trimmed, i === 0)}>{v == null ? '—' : fmt2(v)}</td>;
                                    })}
                                    {!isArtistik && <td style={{ ...tdCenter, fontWeight: 800, color: '#0ea5e9' }}>{fmt3(ev.aAvg)}</td>}
                                    {isArtistik
                                        ? Array.from({ length: 6 }, (_, i) => {
                                            const k = `e${i + 1}`;
                                            const v = ev.ePanel[k], trimmed = ev.eTrimmed.includes(k);
                                            return <td key={k} style={cellStyle(v, trimmed, i === 0)}>{v == null ? '—' : fmt2(v)}</td>;
                                        })
                                        : ['j1', 'j2', 'j3', 'j4'].map((k, i) => {
                                            const v = ev.ePanel[k], trimmed = ev.eTrimmed.includes(k);
                                            return <td key={k} style={cellStyle(v, trimmed, i === 0)}>{v == null ? '—' : fmt2(v)}</td>;
                                        })}
                                    <td style={{ ...tdCenter, fontWeight: 800, color: '#22c55e' }}>{fmt3(ev.eAvg)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div style={hintBar}>
                        <span style={{ color: '#ef4444', fontWeight: 700, textDecoration: 'line-through' }}>Kırmızı/üstü çizili</span>: trimmed-mean'de sayılmayan (uç) notlar.
                    </div>
                </div>
            )}
        </div>
    );
}

/* ── Alt bileşenler ──────────────────────────────────────────────────── */
function KpiCard({ color, icon, label, value }) {
    return (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '0.9rem 1rem', borderLeft: `4px solid ${color}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                <i className="material-icons-round" style={{ fontSize: 16, color }}>{icon}</i>
                {label}
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#0f172a', marginTop: 4 }}>{value}</div>
        </div>
    );
}

function ChartCard({ title, hint, children }) {
    return (
        <div style={cardBox}>
            <div style={cardTitle}>{title}</div>
            {hint && <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>{hint}</div>}
            {children}
        </div>
    );
}

/* ── Stiller ─────────────────────────────────────────────────────────── */
const th = { padding: '8px 10px', textAlign: 'center', fontSize: 11, color: '#475569', whiteSpace: 'nowrap' };
const td = { padding: '6px 10px', whiteSpace: 'nowrap' };
const tdCenter = { ...td, textAlign: 'center', fontVariantNumeric: 'tabular-nums' };
const lbl = { display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: '#64748b' };
const cardBox = { background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', padding: '1rem' };
const cardTitle = { fontSize: 14, fontWeight: 800, color: '#0f172a', marginBottom: 4 };
const emptyBox = { padding: 24, textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' };
const hintBar = { padding: '8px 4px 0', fontSize: 11, color: '#64748b' };
const btnStyle = (bg, disabled) => ({
    background: bg, color: '#fff', border: 'none', padding: '0.6rem 1rem',
    borderRadius: '0.4rem', fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
});
const cellStyle = (v, trimmed, first) => ({
    ...tdCenter,
    borderLeft: first ? '2px solid #e2e8f0' : 'none',
    color: v == null ? '#cbd5e1' : trimmed ? '#ef4444' : '#0f172a',
    fontWeight: trimmed ? 800 : 600,
    background: trimmed ? 'rgba(239,68,68,0.08)' : 'transparent',
    textDecoration: trimmed ? 'line-through' : 'none',
});
