/**
 * HakemKarnesiPage — Detaylı hakem performans analizi (Ritmik & Aerobik)
 *
 * İki görünüm:
 *  1) HAKEM BAZLI: A1-A4, E1-E4 için her hakemin
 *     • Kaç değerlendirme yaptığı
 *     • Kaç notu trimmed-mean'de SAYILMADI (en yüksek veya en düşük → atıldı)
 *     • Sayılmama oranı (%)
 *     • Sayılmayan notların İL DAĞILIMI (sporcunun ilinden)
 *     • Final ortalamadan (trimmedAvg) ortalama sapması
 *
 *  2) SPORCU BAZLI: Her sporcu × alet için A panel + E panel hakem notları
 *     görünür, hangi notlar atılmış işaretlenir.
 *
 * Veri: puanlar/{cat}/{ath}/{alet}/aPanel|ePanel + sporcular/{cat}/{ath}/il
 */
import { useEffect, useMemo, useState } from 'react';
import { ref, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { useDiscipline } from '../lib/DisciplineContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { useAuth } from '../lib/AuthContext';
import * as XLSX from 'xlsx';

// 4+ değer varsa en yüksek + en düşük atılır → o key'ler "trimmed out"
function findTrimmedKeys(panel) {
    const arr = Object.entries(panel || {})
        .map(([k, v]) => ({ k, v: parseFloat(v) }))
        .filter(e => !isNaN(e.v));
    if (arr.length < 4) return { trimmed: [], values: arr, trimmedAvg: arr.length ? arr.reduce((s, e) => s + e.v, 0) / arr.length : 0 };
    arr.sort((a, b) => a.v - b.v);
    const trimmed = [arr[0].k, arr[arr.length - 1].k];
    const middle = arr.slice(1, -1);
    const trimmedAvg = middle.reduce((s, e) => s + e.v, 0) / middle.length;
    return { trimmed, values: arr, trimmedAvg };
}

// Para formatlama
const fmt2 = (n) => (n == null || isNaN(n)) ? '—' : Number(n).toFixed(2);
const fmt3 = (n) => (n == null || isNaN(n)) ? '—' : Number(n).toFixed(3);
const pct  = (n) => (n == null || isNaN(n)) ? '—' : `%${(n * 100).toFixed(1)}`;

// Ritmik aletleri
const RITMIK_ALETS = ['top', 'kurdele'];

export default function HakemKarnesiPage() {
    const { firebasePath, label: discLabel, id: disciplineId } = useDiscipline();
    const { currentUser } = useAuth();
    const isRitmik = disciplineId === 'ritmik';

    const [competitions, setCompetitions] = useState({});
    const [selectedCompId, setSelectedCompId] = useState('');
    const [data, setData] = useState({ scores: {}, athletes: {} });
    const [loading, setLoading] = useState(false);
    const [tab, setTab] = useState('judge'); // 'judge' | 'athlete'

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
        Promise.all([
            get(ref(db, `${firebasePath}/${selectedCompId}/puanlar`)),
            get(ref(db, `${firebasePath}/${selectedCompId}/sporcular`)),
        ]).then(([scoresSnap, athsSnap]) => {
            setData({
                scores:   scoresSnap.val() || {},
                athletes: athsSnap.val()   || {},
            });
        }).finally(() => setLoading(false));
    }, [selectedCompId, firebasePath]);

    // Tüm değerlendirme kayıtlarını düzleştir: her sporcu × alet × panel
    const evaluations = useMemo(() => {
        const list = [];
        Object.entries(data.scores || {}).forEach(([catId, catScores]) => {
            Object.entries(catScores || {}).forEach(([athId, athScore]) => {
                const ath = data.athletes?.[catId]?.[athId] || {};
                // Her alet için aPanel ve ePanel değerlendir
                const alets = isRitmik ? RITMIK_ALETS : ['_total'];
                alets.forEach(alet => {
                    const aletScore = isRitmik ? athScore?.[alet] : athScore;
                    if (!aletScore) return;
                    const aPanel = aletScore.aPanel || {};
                    const ePanel = aletScore.ePanel || {};
                    const aRes = findTrimmedKeys(aPanel);
                    const eRes = findTrimmedKeys(ePanel);

                    const evalEntry = {
                        catId, athId,
                        athName: `${ath.ad || ''} ${ath.soyad || ''}`.trim(),
                        athIl:   ath.il || '',
                        athOkul: ath.okul || ath.kulup || '',
                        alet,
                        aPanel,  ePanel,
                        aTrimmed: aRes.trimmed,  aValues: aRes.values,  aAvg: aRes.trimmedAvg,
                        eTrimmed: eRes.trimmed,  eValues: eRes.values,  eAvg: eRes.trimmedAvg,
                    };
                    list.push(evalEntry);
                });
            });
        });
        return list;
    }, [data, isRitmik]);

    // Hakem bazlı agregat
    const judgeStats = useMemo(() => {
        // panelKey: 'A1', 'A2', ..., 'E1', ..., 'E4'
        // Her hakem için: total, counted, trimmed, ilDist (sayılmayanların il dağılımı), devSum
        const stats = {}; // {panelKey: {total, trimmed, ilDist:{il:count}, devs:[]}}
        const init = (key) => stats[key] = stats[key] || { total: 0, trimmed: 0, ilDist: {}, devs: [] };

        evaluations.forEach(ev => {
            // A panel
            ev.aValues.forEach(({ k, v }) => {
                const judgeKey = 'A' + k.replace('j', '');  // 'j1' → 'A1'
                init(judgeKey);
                stats[judgeKey].total++;
                if (ev.aTrimmed.includes(k)) {
                    stats[judgeKey].trimmed++;
                    if (ev.athIl) stats[judgeKey].ilDist[ev.athIl] = (stats[judgeKey].ilDist[ev.athIl] || 0) + 1;
                }
                stats[judgeKey].devs.push(Math.abs(v - ev.aAvg));
            });
            // E panel
            ev.eValues.forEach(({ k, v }) => {
                const judgeKey = 'E' + k.replace('j', '');
                init(judgeKey);
                stats[judgeKey].total++;
                if (ev.eTrimmed.includes(k)) {
                    stats[judgeKey].trimmed++;
                    if (ev.athIl) stats[judgeKey].ilDist[ev.athIl] = (stats[judgeKey].ilDist[ev.athIl] || 0) + 1;
                }
                stats[judgeKey].devs.push(Math.abs(v - ev.eAvg));
            });
        });

        // Sıralı liste hazırla
        return Object.entries(stats)
            .map(([key, s]) => ({
                judge: key,
                total: s.total,
                trimmed: s.trimmed,
                counted: s.total - s.trimmed,
                trimmedRatio: s.total > 0 ? s.trimmed / s.total : 0,
                avgDeviation: s.devs.length > 0 ? s.devs.reduce((a, b) => a + b, 0) / s.devs.length : 0,
                ilDist: s.ilDist,
            }))
            .sort((a, b) => a.judge.localeCompare(b.judge));
    }, [evaluations]);

    // Sporcu bazlı görünüm: her sporcu × alet için panel detayı
    const athleteRows = useMemo(() => {
        return evaluations
            .filter(e => e.aValues.length > 0 || e.eValues.length > 0)
            .sort((a, b) => a.athName.localeCompare(b.athName, 'tr-TR'));
    }, [evaluations]);

    const compEntries = Object.entries(competitions).sort((a, b) =>
        new Date(b[1].tarih || b[1].baslangicTarihi || 0) - new Date(a[1].tarih || a[1].baslangicTarihi || 0)
    );

    // Excel export — tek dosyada 2 sheet
    const exportExcel = () => {
        const compName = competitions[selectedCompId]?.isim || selectedCompId;
        const wb = XLSX.utils.book_new();

        // Sheet 1: Hakem Karnesi
        const judgeRows = judgeStats.map(j => ({
            'Hakem': j.judge,
            'Toplam Değerlendirme': j.total,
            'Sayılan': j.counted,
            'Sayılmayan': j.trimmed,
            'Sayılmama Oranı': pct(j.trimmedRatio),
            'Ort. Sapma': fmt3(j.avgDeviation),
            'Sayılmayan İl Dağılımı': Object.entries(j.ilDist).sort((a,b)=>b[1]-a[1]).map(([il,c]) => `${il}:${c}`).join(', '),
        }));
        if (judgeRows.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(judgeRows), 'Hakem Karnesi');

        // Sheet 2: Sporcu Bazlı (panel notları detayı)
        const athRows = [];
        athleteRows.forEach(ev => {
            const row = {
                'Sporcu':  ev.athName,
                'Okul':    ev.athOkul,
                'İl':      ev.athIl,
                'Alet':    ev.alet,
            };
            ['j1','j2','j3','j4'].forEach((k, i) => {
                const aVal = ev.aPanel[k];
                const isATrimmed = ev.aTrimmed.includes(k);
                row[`A${i+1}`] = aVal != null ? (isATrimmed ? `${aVal} (X)` : aVal) : '';
                const eVal = ev.ePanel[k];
                const isETrimmed = ev.eTrimmed.includes(k);
                row[`E${i+1}`] = eVal != null ? (isETrimmed ? `${eVal} (X)` : eVal) : '';
            });
            row['A Ort.'] = fmt3(ev.aAvg);
            row['E Ort.'] = fmt3(ev.eAvg);
            athRows.push(row);
        });
        if (athRows.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(athRows), 'Sporcu Bazlı');

        XLSX.writeFile(wb, `Hakem_Karnesi_${compName.slice(0, 40)}.xlsx`);
    };

    return (
        <div className="page-container" style={{ padding: '1.5rem', maxWidth: 1400, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h1 style={{ margin: 0 }}>
                    <i className="material-icons-round" style={{ verticalAlign: 'middle', marginRight: 8 }}>assessment</i>
                    Hakem Karnesi — {discLabel || disciplineId}
                </h1>
                <button
                    onClick={exportExcel}
                    disabled={evaluations.length === 0}
                    style={{
                        background: '#22c55e', color: '#fff', border: 'none',
                        padding: '0.6rem 1rem', borderRadius: '0.4rem',
                        fontWeight: 700, cursor: 'pointer', opacity: evaluations.length ? 1 : 0.5,
                    }}
                >
                    <i className="material-icons-round" style={{ verticalAlign: 'middle', marginRight: 4, fontSize: 18 }}>download</i>
                    Excel İndir
                </button>
            </div>

            {/* Yarışma + sekme */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: 1, minWidth: 320 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: '#64748b' }}>YARIŞMA</label>
                    <select value={selectedCompId} onChange={e => setSelectedCompId(e.target.value)}
                        style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1' }}>
                        <option value="">— Seçiniz —</option>
                        {compEntries.map(([id, c]) => (
                            <option key={id} value={id}>{c.isim} {c.il ? `· ${c.il}` : ''}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <button onClick={() => setTab('judge')}
                        style={{
                            padding: '0.55rem 1rem',
                            borderRadius: '0.4rem 0 0 0.4rem',
                            border: '1px solid #cbd5e1',
                            background: tab === 'judge' ? '#0ea5e9' : '#fff',
                            color: tab === 'judge' ? '#fff' : '#475569',
                            fontWeight: 700, cursor: 'pointer',
                        }}>
                        Hakem Bazlı
                    </button>
                    <button onClick={() => setTab('athlete')}
                        style={{
                            padding: '0.55rem 1rem',
                            borderRadius: '0 0.4rem 0.4rem 0',
                            border: '1px solid #cbd5e1', borderLeft: 'none',
                            background: tab === 'athlete' ? '#0ea5e9' : '#fff',
                            color: tab === 'athlete' ? '#fff' : '#475569',
                            fontWeight: 700, cursor: 'pointer',
                        }}>
                        Sporcu Bazlı
                    </button>
                </div>
            </div>

            {loading && <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>Yükleniyor…</div>}

            {!loading && selectedCompId && evaluations.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                    Bu yarışmada henüz panel notu girilmemiş.
                </div>
            )}

            {/* HAKEM BAZLI */}
            {!loading && tab === 'judge' && judgeStats.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                            <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
                                <th style={th}>HAKEM</th>
                                <th style={th}>TOPLAM</th>
                                <th style={th}>SAYILAN</th>
                                <th style={th}>SAYILMAYAN</th>
                                <th style={th}>SAYILMAMA %</th>
                                <th style={th}>ORT. SAPMA</th>
                                <th style={{ ...th, textAlign: 'left' }}>SAYILMAYAN İL DAĞILIMI</th>
                            </tr>
                        </thead>
                        <tbody>
                            {judgeStats.map(j => {
                                const ratio = j.trimmedRatio;
                                const ratioColor = ratio > 0.5 ? '#ef4444' : ratio > 0.35 ? '#f59e0b' : '#22c55e';
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
                                                        <span key={il} style={{
                                                            background: '#f1f5f9', padding: '2px 8px',
                                                            borderRadius: 999, fontSize: 11, fontWeight: 600,
                                                        }}>
                                                            {il}: <strong>{count}</strong>
                                                        </span>
                                                    ))}
                                                </div>
                                            }
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <div style={{ padding: '8px 12px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', fontSize: 11, color: '#64748b' }}>
                        <strong>SAYILMAYAN</strong>: trimmed-mean hesabında en yüksek veya en düşük olduğu için atılan notlar.
                        4+ hakem varsa sıralanıp uçtaki ikisi atılır. <strong>Ort. Sapma</strong>: hakemin notunun trimmed ortalamadan ortalama sapması.
                    </div>
                </div>
            )}

            {/* SPORCU BAZLI */}
            {!loading && tab === 'athlete' && athleteRows.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                            <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
                                <th style={th}>SPORCU</th>
                                <th style={th}>İL/OKUL</th>
                                <th style={th}>ALET</th>
                                <th style={{ ...th, borderLeft: '2px solid #cbd5e1' }} colSpan={4}>A PANELİ</th>
                                <th style={th}>A ORT.</th>
                                <th style={{ ...th, borderLeft: '2px solid #cbd5e1' }} colSpan={4}>E PANELİ</th>
                                <th style={th}>E ORT.</th>
                            </tr>
                            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #cbd5e1', fontSize: 11 }}>
                                <th style={th}></th>
                                <th style={th}></th>
                                <th style={th}></th>
                                {['A1','A2','A3','A4'].map((j, i) => (
                                    <th key={j} style={{ ...th, borderLeft: i === 0 ? '2px solid #cbd5e1' : 'none', color: '#64748b' }}>{j}</th>
                                ))}
                                <th style={th}></th>
                                {['E1','E2','E3','E4'].map((j, i) => (
                                    <th key={j} style={{ ...th, borderLeft: i === 0 ? '2px solid #cbd5e1' : 'none', color: '#64748b' }}>{j}</th>
                                ))}
                                <th style={th}></th>
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
                                    <td style={tdCenter}>{ev.alet}</td>
                                    {['j1','j2','j3','j4'].map((k, i) => {
                                        const v = ev.aPanel[k];
                                        const trimmed = ev.aTrimmed.includes(k);
                                        return (
                                            <td key={k} style={{
                                                ...tdCenter,
                                                borderLeft: i === 0 ? '2px solid #e2e8f0' : 'none',
                                                color: v == null ? '#cbd5e1' : trimmed ? '#ef4444' : '#0f172a',
                                                fontWeight: trimmed ? 800 : 600,
                                                background: trimmed ? 'rgba(239,68,68,0.08)' : 'transparent',
                                                textDecoration: trimmed ? 'line-through' : 'none',
                                            }}>
                                                {v == null ? '—' : fmt2(v)}
                                            </td>
                                        );
                                    })}
                                    <td style={{ ...tdCenter, fontWeight: 800, color: '#0ea5e9' }}>{fmt3(ev.aAvg)}</td>
                                    {['j1','j2','j3','j4'].map((k, i) => {
                                        const v = ev.ePanel[k];
                                        const trimmed = ev.eTrimmed.includes(k);
                                        return (
                                            <td key={k} style={{
                                                ...tdCenter,
                                                borderLeft: i === 0 ? '2px solid #e2e8f0' : 'none',
                                                color: v == null ? '#cbd5e1' : trimmed ? '#ef4444' : '#0f172a',
                                                fontWeight: trimmed ? 800 : 600,
                                                background: trimmed ? 'rgba(239,68,68,0.08)' : 'transparent',
                                                textDecoration: trimmed ? 'line-through' : 'none',
                                            }}>
                                                {v == null ? '—' : fmt2(v)}
                                            </td>
                                        );
                                    })}
                                    <td style={{ ...tdCenter, fontWeight: 800, color: '#22c55e' }}>{fmt3(ev.eAvg)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div style={{ padding: '8px 12px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', fontSize: 11, color: '#64748b' }}>
                        <span style={{ color: '#ef4444', fontWeight: 700, textDecoration: 'line-through' }}>Kırmızı/üstü çizili</span>: trimmed-mean'de sayılmayan (en yüksek veya en düşük) notlar.
                    </div>
                </div>
            )}
        </div>
    );
}

const th = { padding: '8px 10px', textAlign: 'center', fontSize: 11, color: '#475569', whiteSpace: 'nowrap' };
const td = { padding: '6px 10px', whiteSpace: 'nowrap' };
const tdCenter = { ...td, textAlign: 'center', fontVariantNumeric: 'tabular-nums' };
