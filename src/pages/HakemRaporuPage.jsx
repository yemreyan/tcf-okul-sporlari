/**
 * HakemRaporuPage — Yarışma bazında hakem aktivite raporu.
 *
 * Audit log'dan ilgili yarışma için tüm 'judge_score_submit', 'sj_field_override',
 * 'score_field_cleared' eventlerini çekip:
 *   • Sporcu × Alet × Field bazında zaman çizelgesi
 *   • Hakem (panelType / panelId) bazında özet (kaç değişiklik, hangi alanlar)
 *   • Başhakem override'ları ayrı renkte
 * gösterir. PDF / Excel olarak çıkarılabilir.
 */
import { useEffect, useMemo, useState } from 'react';
import { ref, get, query, orderByChild, equalTo } from 'firebase/database';
import { db } from '../lib/firebase';
import { useDiscipline } from '../lib/DisciplineContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { useAuth } from '../lib/AuthContext';
import * as XLSX from 'xlsx';

const TYPE_LABELS = {
    judge_score_submit:   { label: 'Hakem Notu',     color: '#0ea5e9' },
    sj_field_override:    { label: 'Başhakem Müdahale', color: '#f59e0b' },
    score_field_cleared:  { label: 'Alan Silindi',   color: '#ef4444' },
    score_submitted:      { label: 'Skor Kaydedildi', color: '#22c55e' },
    score_create:         { label: 'Skor Kaydı',     color: '#16a34a' },
    score_unlock:         { label: 'Kilit Açıldı',   color: '#8b5cf6' },
    alet_transfer:        { label: 'Alet Taşıma',    color: '#a855f7' },
    login:                { label: 'Giriş',          color: '#64748b' },
    logout:               { label: 'Çıkış',          color: '#94a3b8' },
    competition_update:   { label: 'Yarışma Güncelleme', color: '#0891b2' },
};

const formatDateTime = (ts) => {
    if (!ts) return '—';
    const d = new Date(ts);
    return `${d.toLocaleDateString('tr-TR')} ${d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
};

const formatVal = (v) => v === null || v === undefined ? '—' : String(v);

export default function HakemRaporuPage() {
    const { firebasePath, label: discLabel, id: disciplineId } = useDiscipline();
    const { currentUser } = useAuth();

    const [competitions, setCompetitions] = useState({});
    const [selectedCompId, setSelectedCompId] = useState('');
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filterAth, setFilterAth] = useState('');
    const [filterField, setFilterField] = useState('');
    const [filterType, setFilterType] = useState('all');

    // Yarışmaları çek
    useEffect(() => {
        get(ref(db, firebasePath)).then(snap => {
            const data = snap.val() || {};
            setCompetitions(filterCompetitionsByUser(data, currentUser));
        }).catch(() => setCompetitions({}));
    }, [firebasePath, currentUser]);

    // Seçili yarışmanın audit log'larını çek
    useEffect(() => {
        if (!selectedCompId) { setLogs([]); return; }
        setLoading(true);
        // Tüm logları çek (orderByChild index'i yoksa Firebase eski tarz tarama yapar — yavaş ama çalışır)
        // 1) İlk olarak indexed query dene
        const q = query(ref(db, 'logs'), orderByChild('competitionId'), equalTo(selectedCompId));
        get(q).then(snap => {
            const data = snap.val() || {};
            const arr = Object.entries(data)
                .map(([id, v]) => ({ id, ...v }))
                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            setLogs(arr);
            // Eğer indexed sorgu boş döndüyse, fallback: tüm logları çek + JS'de filtrele
            // (eski log'larda competitionId eksik olabilir)
            if (arr.length === 0) {
                return get(ref(db, 'logs')).then(allSnap => {
                    const all = allSnap.val() || {};
                    const matched = Object.entries(all)
                        .map(([id, v]) => ({ id, ...v }))
                        .filter(l => l.competitionId === selectedCompId)
                        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                    setLogs(matched);
                });
            }
        }).catch(async () => {
            // Indexed query başarısız → tam tarama fallback
            try {
                const allSnap = await get(ref(db, 'logs'));
                const all = allSnap.val() || {};
                const matched = Object.entries(all)
                    .map(([id, v]) => ({ id, ...v }))
                    .filter(l => l.competitionId === selectedCompId)
                    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                setLogs(matched);
            } catch {
                setLogs([]);
            }
        }).finally(() => setLoading(false));
    }, [selectedCompId]);

    const filtered = useMemo(() => {
        return logs.filter(l => {
            if (filterType !== 'all' && l.type !== filterType) return false;
            if (filterAth && !((l.athleteName || '').toLowerCase().includes(filterAth.toLowerCase()) || (l.athleteId || '').includes(filterAth))) return false;
            if (filterField && !((l.field || '').toLowerCase().includes(filterField.toLowerCase()))) return false;
            return true;
        });
    }, [logs, filterAth, filterField, filterType]);

    // Hakem-bazlı özet (kim kaç değişiklik yaptı)
    const refereeSummary = useMemo(() => {
        const m = {};
        logs.forEach(l => {
            const key = l.user || (l.data && l.data.panelType) || 'bilinmeyen';
            if (!m[key]) m[key] = { user: key, total: 0, byType: {} };
            m[key].total++;
            m[key].byType[l.type] = (m[key].byType[l.type] || 0) + 1;
        });
        return Object.values(m).sort((a, b) => b.total - a.total);
    }, [logs]);

    const exportExcel = () => {
        const rows = filtered.map(l => ({
            'Tarih':   formatDateTime(l.timestamp),
            'Tip':     TYPE_LABELS[l.type]?.label || l.type,
            'Sporcu':  l.athleteName || l.athleteId || '',
            'Alet':    l.alet || '',
            'Alan':    l.field || '',
            'Eski':    formatVal(l.oldValue),
            'Yeni':    formatVal(l.newValue),
            'Hakem':   l.user || '',
            'Mesaj':   l.message || l.mesaj || '',
        }));
        if (rows.length === 0) { alert('Dışa aktarılacak veri yok.'); return; }
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Hakem Raporu');
        const compName = competitions[selectedCompId]?.isim || selectedCompId;
        XLSX.writeFile(wb, `Hakem_Raporu_${compName.slice(0, 40)}.xlsx`);
    };

    const compEntries = Object.entries(competitions).sort((a, b) =>
        new Date(b[1].tarih || b[1].baslangicTarihi || 0) - new Date(a[1].tarih || a[1].baslangicTarihi || 0)
    );

    return (
        <div className="page-container" style={{ padding: '1.5rem', maxWidth: 1400, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h1 style={{ margin: 0 }}>
                    <i className="material-icons-round" style={{ verticalAlign: 'middle', marginRight: 8 }}>fact_check</i>
                    Hakem Raporu — {discLabel || disciplineId}
                </h1>
                <button
                    onClick={exportExcel}
                    disabled={filtered.length === 0}
                    style={{
                        background: '#22c55e', color: '#fff', border: 'none',
                        padding: '0.6rem 1rem', borderRadius: '0.4rem',
                        fontWeight: 700, cursor: 'pointer', opacity: filtered.length ? 1 : 0.5,
                    }}
                >
                    <i className="material-icons-round" style={{ verticalAlign: 'middle', marginRight: 4, fontSize: 18 }}>download</i>
                    Excel İndir
                </button>
            </div>

            {/* Yarışma seçimi */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 280 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: '#64748b' }}>YARIŞMA</label>
                    <select value={selectedCompId} onChange={e => setSelectedCompId(e.target.value)}
                        style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1' }}>
                        <option value="">— Seçiniz —</option>
                        {compEntries.map(([id, c]) => (
                            <option key={id} value={id}>{c.isim} {c.il ? `· ${c.il}` : ''}</option>
                        ))}
                    </select>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: '#64748b' }}>SPORCU (ad/soyad/id)</label>
                    <input value={filterAth} onChange={e => setFilterAth(e.target.value)} placeholder="Filtre..."
                        style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1' }} />
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: '#64748b' }}>ALAN (örn. da1, aPanel.j2)</label>
                    <input value={filterField} onChange={e => setFilterField(e.target.value)} placeholder="Filtre..."
                        style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1' }} />
                </div>
                <div style={{ minWidth: 200 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: '#64748b' }}>OLAY TİPİ</label>
                    <select value={filterType} onChange={e => setFilterType(e.target.value)}
                        style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', border: '1px solid #cbd5e1' }}>
                        <option value="all">Tümü</option>
                        {Object.entries(TYPE_LABELS).map(([t, c]) => (
                            <option key={t} value={t}>{c.label}</option>
                        ))}
                    </select>
                </div>
            </div>

            {loading && <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>Yükleniyor…</div>}

            {!loading && selectedCompId && (
                <>
                    {/* Hakem özeti */}
                    {refereeSummary.length > 0 && (
                        <div style={{ marginBottom: 16, padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>HAKEM ÖZETİ ({refereeSummary.length} kaynak, toplam {logs.length} olay)</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {refereeSummary.map(s => (
                                    <span key={s.user} style={{
                                        background: '#fff', padding: '4px 10px', borderRadius: 999,
                                        border: '1px solid #cbd5e1', fontSize: 12, fontWeight: 600,
                                    }}>
                                        <strong>{s.user}</strong> · {s.total} olay
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Detay tablosu */}
                    <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
                                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, color: '#475569' }}>TARİH</th>
                                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, color: '#475569' }}>TİP</th>
                                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, color: '#475569' }}>SPORCU</th>
                                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, color: '#475569' }}>ALET</th>
                                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, color: '#475569' }}>ALAN</th>
                                    <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 11, color: '#475569' }}>ESKİ</th>
                                    <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 11, color: '#475569' }}>YENİ</th>
                                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, color: '#475569' }}>KAYNAK</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(l => {
                                    const tcfg = TYPE_LABELS[l.type] || { label: l.type, color: '#94a3b8' };
                                    const isSj = l.type === 'sj_field_override' || (l.data?.source === 'basHakem');
                                    const fullMsg = l.message || l.mesaj || '';
                                    return (
                                        <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9', background: isSj ? 'rgba(245,158,11,0.06)' : 'transparent' }}>
                                            <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{formatDateTime(l.timestamp)}</td>
                                            <td style={{ padding: '6px 10px' }}>
                                                <span style={{ background: tcfg.color, color: '#fff', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700 }}>
                                                    {tcfg.label}
                                                </span>
                                            </td>
                                            <td style={{ padding: '6px 10px', fontWeight: 600 }}>
                                                {l.athleteName || l.athleteId || (
                                                    <span style={{ color: '#64748b', fontWeight: 400, fontStyle: 'italic' }}>{fullMsg.split(' — ')[0] || '—'}</span>
                                                )}
                                            </td>
                                            <td style={{ padding: '6px 10px' }}>{l.alet || '—'}</td>
                                            <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 11, color: '#475569' }}>{l.field || '—'}</td>
                                            <td style={{ padding: '6px 10px', textAlign: 'right', color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>{formatVal(l.oldValue)}</td>
                                            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: isSj ? '#d97706' : '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
                                                {l.newValue !== null && l.newValue !== undefined ? formatVal(l.newValue) : (
                                                    // Eski score_create: değeri mesajdan çıkar (örn. "Yer: 14.050")
                                                    (() => {
                                                        const m = fullMsg.match(/:\s*([\d.,]+)\s*$/);
                                                        return m ? <span style={{ color: '#22c55e' }}>{m[1]}</span> : '—';
                                                    })()
                                                )}
                                            </td>
                                            <td style={{ padding: '6px 10px', fontSize: 11, color: '#64748b' }} title={fullMsg}>{l.user || (fullMsg.length > 40 ? fullMsg.slice(0, 40) + '…' : fullMsg) || '—'}</td>
                                        </tr>
                                    );
                                })}
                                {filtered.length === 0 && (
                                    <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>Kayıt bulunamadı</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
