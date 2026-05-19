/**
 * HakemGorevRaporu — Çok branşlı hakem görev raporu.
 * RefereesPage içindeki "Görev Raporu" sekmesi olarak render edilir.
 * Tüm branşların tüm yarışmalarındaki hakem atamalarını (hakemler düğümü)
 * tarayıp her hakemin görev geçmişini, bröve atlama durumunu gösterir,
 * Excel dışa/içe aktarma ve FIG Hakem Karnesi'ne derin bağlantı sağlar.
 */
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, get, update } from 'firebase/database';
import { db } from '../lib/firebase';
import { DISCIPLINE_CONFIG } from '../lib/DisciplineContext';

/* ── Yardımcılar ─────────────────────────────────────────────────────── */
const normName = (s) => String(s || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const catLabel = (catId) => String(catId || '')
    .split('_')
    .map(w => w ? w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1) : w)
    .join(' ');

const fmtDate = (d) => {
    if (!d) return '—';
    const s = String(d);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
    return s;
};

// Bröve sıralaması — sonraki seviye önerisi
function nextBrove(brove) {
    const b = String(brove || '').toLocaleLowerCase('tr-TR');
    if (b.includes('uluslararas')) return null;            // en üst
    if (b.includes('milli')) return 'Uluslararası';
    if (b.includes('bölge') || b.includes('bolge')) return 'Milli';
    return 'Bölge';                                         // Aday / yok
}

// hakemler ağacını özyinelemeli gez — her yaprak bir hakem girişi
function walkHakemler(node, path, emit) {
    if (node == null) return;
    if (typeof node === 'string') {
        if (node.trim()) emit(path, { name: node.trim(), id: null });
        return;
    }
    if (typeof node !== 'object') return;
    // Yaprak: {id,name} gibi bir hakem girişi
    const hasName = typeof node.name === 'string';
    const childObjs = Object.values(node).some(v => v && typeof v === 'object');
    if (hasName || (node.id && !childObjs)) {
        emit(path, { name: node.name || '', id: node.id || null });
        return;
    }
    for (const [k, v] of Object.entries(node)) walkHakemler(v, [...path, k], emit);
}

export default function HakemGorevRaporu({ referees }) {
    const navigate = useNavigate();
    const [scanning, setScanning] = useState(false);
    const [scan, setScan] = useState(null);     // { assignments: [...], scannedAt }
    const [search, setSearch] = useState('');
    const [broveFilter, setBroveFilter] = useState('');
    const [expanded, setExpanded] = useState({});
    const [importing, setImporting] = useState(false);
    const [msg, setMsg] = useState('');

    /* ── Tüm branşları tara ──────────────────────────────────────────── */
    const runScan = async () => {
        setScanning(true);
        setMsg('');
        try {
            const assignments = [];
            for (const cfg of Object.values(DISCIPLINE_CONFIG)) {
                let snap;
                try { snap = await get(ref(db, cfg.firebasePath)); }
                catch { continue; }
                const comps = snap.val() || {};
                Object.entries(comps).forEach(([compId, comp]) => {
                    if (!comp || !comp.hakemler) return;
                    const date = comp.baslangicTarihi || comp.tarih || comp.bitisTarihi || '';
                    walkHakemler(comp.hakemler, [], (path, entry) => {
                        if (!entry.name && !entry.id) return;
                        assignments.push({
                            discipline: cfg.id,
                            disciplineLabel: cfg.shortLabel,
                            routePrefix: cfg.routePrefix,
                            compId, compName: comp.isim || compId, date,
                            catId: path[0] || '',
                            aletId: path.length >= 3 ? path[1] : '',
                            panelId: path[path.length - 1] || '',
                            refId: entry.id || null,
                            refName: entry.name || '',
                        });
                    });
                });
            }
            setScan({ assignments, scannedAt: new Date() });
            setMsg(`${assignments.length} atama bulundu.`);
        } catch (e) {
            setMsg('Tarama sırasında hata oluştu.');
        } finally {
            setScanning(false);
        }
    };

    /* ── Hakem bazlı rapor ───────────────────────────────────────────── */
    const report = useMemo(() => {
        // referee index
        const byId = {}, byName = {};
        (referees || []).forEach(r => {
            byId[r.id] = r;
            byName[normName(r.adSoyad)] = r;
        });
        // hakem → { ref, assignments[], comps Set, disciplines Set }
        const map = {};
        const keyFor = (a) => {
            const r = (a.refId && byId[a.refId]) || byName[normName(a.refName)];
            return r ? `ref:${r.id}` : `name:${normName(a.refName)}`;
        };
        (scan?.assignments || []).forEach(a => {
            const r = (a.refId && byId[a.refId]) || byName[normName(a.refName)];
            const key = keyFor(a);
            const rec = map[key] = map[key] || {
                key, referee: r || null,
                adSoyad: r?.adSoyad || a.refName,
                il: r?.il || '', brove: r?.brove || '',
                matched: !!r,
                assignments: [], comps: new Set(), disciplines: new Set(),
            };
            rec.assignments.push(a);
            rec.comps.add(`${a.discipline}|${a.compId}`);
            rec.disciplines.add(a.disciplineLabel);
            (rec.scannedCompNames = rec.scannedCompNames || new Set()).add(normName(a.compName));
        });
        // elle eklenmiş geçmiş yarışmalar (gecmisYarismalar)
        (referees || []).forEach(r => {
            const gy = r.gecmisYarismalar;
            const list = Array.isArray(gy) ? gy : (gy ? Object.values(gy) : []);
            if (!list.length) return;
            const key = `ref:${r.id}`;
            const rec = map[key] = map[key] || {
                key, referee: r, adSoyad: r.adSoyad, il: r.il || '', brove: r.brove || '',
                matched: true, assignments: [], comps: new Set(), disciplines: new Set(),
            };
            list.forEach((g, i) => {
                if (!g || !g.compName) return;
                // taramada zaten bulunan yarışmayı elle kayıttan tekrar sayma
                if (rec.scannedCompNames && rec.scannedCompNames.has(normName(g.compName))) return;
                rec.assignments.push({
                    discipline: '', disciplineLabel: 'Elle', routePrefix: '',
                    compId: '', compName: g.compName, date: g.date || '',
                    catId: '', aletId: '', panelId: g.role || '',
                    refId: r.id, refName: r.adSoyad, manual: true,
                });
                rec.comps.add(`manual|${normName(g.compName)}|${g.date || i}`);
            });
        });
        const rows = Object.values(map).map(rec => {
            const gorevSayisi = rec.comps.size;
            const sortedA = [...rec.assignments].sort((a, b) => String(b.date).localeCompare(String(a.date)));
            return {
                ...rec,
                gorevSayisi,
                disciplineList: [...rec.disciplines].join(', '),
                lastDate: sortedA[0]?.date || '',
                sortedAssignments: sortedA,
                breveUygun: gorevSayisi >= 2,
                breveNext: nextBrove(rec.brove),
            };
        }).sort((a, b) => b.gorevSayisi - a.gorevSayisi || a.adSoyad.localeCompare(b.adSoyad, 'tr'));
        return rows;
    }, [scan, referees]);

    const filtered = useMemo(() => {
        const s = normName(search);
        return report.filter(r => {
            if (s && !normName(r.adSoyad).includes(s) && !normName(r.il).includes(s)) return false;
            if (broveFilter && String(r.brove).toLocaleUpperCase('tr-TR') !== broveFilter) return false;
            return true;
        });
    }, [report, search, broveFilter]);

    const kpi = useMemo(() => ({
        hakem: report.length,
        gorev: report.reduce((s, r) => s + r.gorevSayisi, 0),
        uygun: report.filter(r => r.breveUygun).length,
        brans: new Set(report.flatMap(r => [...r.disciplines])).size,
    }), [report]);

    /* ── Excel dışa aktarma ──────────────────────────────────────────── */
    const exportExcel = async () => {
        const XLSX = await import('xlsx');
        const rows = [];
        report.forEach(r => {
            r.sortedAssignments.forEach(a => {
                rows.push({
                    'Hakem ID': r.referee?.id || '',
                    'Ad Soyad': r.adSoyad,
                    'İl': r.il,
                    'Brove': r.brove,
                    'Branş': a.disciplineLabel,
                    'Tarih': fmtDate(a.date),
                    'Yarışma': a.compName,
                    'Kategori': a.catId ? catLabel(a.catId) : '',
                    'Rol/Açıklama': [a.aletId, a.panelId].filter(Boolean).join(' / '),
                });
            });
        });
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Hakem ID': '', 'Ad Soyad': '', 'İl': '', 'Brove': '', 'Branş': '', 'Tarih': '', 'Yarışma': '', 'Kategori': '', 'Rol/Açıklama': '' }]);
        ws['!cols'] = [{ wch: 22 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 30 }, { wch: 18 }, { wch: 22 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Görevler');
        XLSX.writeFile(wb, `Hakem_Gorev_Raporu_${new Date().toLocaleDateString('tr-TR').replace(/\./g, '-')}.xlsx`);
    };

    /* ── Excel içe aktarma — hakem görev kaydını günceller ───────────── */
    const importExcel = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImporting(true);
        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const XLSX = await import('xlsx');
                const wb = XLSX.read(evt.target.result, { type: 'binary' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
                const byId = {}, byName = {};
                (referees || []).forEach(r => { byId[r.id] = r; byName[normName(r.adSoyad)] = r; });
                // hakem → görev satırları
                const groups = {};
                data.forEach(row => {
                    const id = String(row['Hakem ID'] || '').trim();
                    const ad = String(row['Ad Soyad'] || '').trim();
                    const r = (id && byId[id]) || byName[normName(ad)];
                    if (!r) return;
                    (groups[r.id] = groups[r.id] || []).push({
                        compName: String(row['Yarışma'] || '').trim(),
                        date: String(row['Tarih'] || '').trim(),
                        role: [row['Branş'], row['Kategori'], row['Rol/Açıklama']].filter(Boolean).join(' · '),
                        addedAt: new Date().toISOString(),
                    });
                });
                const updates = {};
                Object.entries(groups).forEach(([refId, list]) => {
                    const valid = list.filter(g => g.compName);
                    updates[`referees/${refId}/gecmisYarismalar`] = valid;
                    updates[`referees/${refId}/gorevSayisi`] = valid.length;
                });
                if (Object.keys(updates).length) {
                    await update(ref(db), updates);
                    setMsg(`${Object.keys(groups).length} hakemin görev kaydı güncellendi.`);
                } else {
                    setMsg('Eşleşen hakem bulunamadı. "Hakem ID" veya "Ad Soyad" sütunlarını kontrol edin.');
                }
            } catch (err) {
                setMsg('Excel okunurken hata oluştu.');
            } finally {
                setImporting(false);
                e.target.value = '';
            }
        };
        reader.readAsBinaryString(file);
    };

    /* ── Render ──────────────────────────────────────────────────────── */
    return (
        <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Araç çubuğu */}
            <div style={cardBox}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button onClick={runScan} disabled={scanning} style={btn('#6366f1', scanning)}>
                        <i className="material-icons-round" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 4 }}>
                            {scanning ? 'hourglass_top' : 'travel_explore'}
                        </i>
                        {scanning ? 'Taranıyor…' : (scan ? 'Yeniden Tara' : 'Tüm Görevleri Tara')}
                    </button>
                    <button onClick={exportExcel} disabled={!scan} style={btn('#0ea5e9', !scan)}>
                        <i className="material-icons-round" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 4 }}>file_download</i>
                        Görevleri Excel'e Aktar
                    </button>
                    <label style={{ ...btn('#22c55e', importing), cursor: importing ? 'default' : 'pointer' }}>
                        <i className="material-icons-round" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 4 }}>file_upload</i>
                        {importing ? 'Yükleniyor…' : "Excel'den Görev Yükle"}
                        <input type="file" accept=".xlsx,.xls" onChange={importExcel} disabled={importing} style={{ display: 'none' }} />
                    </label>
                    {msg && <span style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>{msg}</span>}
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
                    Tarama tüm branşların tüm yarışmalarındaki hakem atamalarını okur — biraz sürebilir.
                    "Excel'den Görev Yükle" yalnız hakem görev kayıtlarını günceller, yarışma panellerine dokunmaz.
                </div>
            </div>

            {!scan ? (
                <div style={emptyBox}>Görev raporunu görmek için "Tüm Görevleri Tara" butonuna basın.</div>
            ) : (
                <>
                    {/* KPI */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 }}>
                        <Kpi color="#6366f1" label="Görevli Hakem" value={kpi.hakem} />
                        <Kpi color="#0ea5e9" label="Toplam Görev" value={kpi.gorev} />
                        <Kpi color="#22c55e" label="Bröve Atlamaya Uygun" value={kpi.uygun} />
                        <Kpi color="#f59e0b" label="Branş Sayısı" value={kpi.brans} />
                    </div>

                    {/* Filtre */}
                    <div style={{ ...cardBox, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Hakem ara (isim / il)…"
                            style={{ flex: 1, minWidth: 200, padding: '0.5rem 0.7rem', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }} />
                        <select value={broveFilter} onChange={e => setBroveFilter(e.target.value)}
                            style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }}>
                            <option value="">Tüm Bröveler</option>
                            <option value="ULUSLARARASI">Uluslararası</option>
                            <option value="MİLLİ">Milli</option>
                            <option value="BÖLGE">Bölge</option>
                            <option value="ADAY">Aday</option>
                        </select>
                        <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>{filtered.length} / {report.length}</span>
                    </div>

                    {/* Tablo */}
                    <div style={{ ...cardBox, overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
                                    <th style={th}>AD SOYAD</th>
                                    <th style={th}>İL</th>
                                    <th style={th}>BRÖVE</th>
                                    <th style={th}>BRANŞ</th>
                                    <th style={th}>GÖREV</th>
                                    <th style={th}>BRÖVE DURUMU</th>
                                    <th style={th}>SON GÖREV</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(r => (
                                    <FragmentRow key={r.key} r={r} expanded={!!expanded[r.key]}
                                        onToggle={() => setExpanded(s => ({ ...s, [r.key]: !s[r.key] }))}
                                        navigate={navigate} />
                                ))}
                            </tbody>
                        </table>
                        {filtered.length === 0 && <div style={{ ...emptyBox, marginTop: 8 }}>Eşleşen hakem yok.</div>}
                    </div>
                </>
            )}
        </div>
    );
}

/* ── Hakem satırı + açılır görev detayı ──────────────────────────────── */
function FragmentRow({ r, expanded, onToggle, navigate }) {
    return (
        <>
            <tr onClick={onToggle} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}>
                <td style={{ ...td, fontWeight: 700 }}>
                    <i className="material-icons-round" style={{ fontSize: 16, verticalAlign: 'middle', color: '#94a3b8' }}>
                        {expanded ? 'expand_more' : 'chevron_right'}
                    </i> {r.adSoyad}
                    {!r.matched && <span style={badge('#ef4444')}>listede yok</span>}
                </td>
                <td style={tdc}>{r.il || '—'}</td>
                <td style={tdc}>{r.brove || '—'}</td>
                <td style={tdc}>{r.disciplineList || '—'}</td>
                <td style={{ ...tdc, fontWeight: 800 }}>{r.gorevSayisi}</td>
                <td style={tdc}>
                    {r.breveUygun ? (
                        <span style={badge('#22c55e')}>
                            Bröve atlamaya uygun{r.breveNext ? ` → ${r.breveNext}` : ''}
                        </span>
                    ) : (
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>
                            {2 - r.gorevSayisi} görev daha
                        </span>
                    )}
                </td>
                <td style={tdc}>{fmtDate(r.lastDate)}</td>
            </tr>
            {expanded && (
                <tr>
                    <td colSpan={7} style={{ background: '#f8fafc', padding: '8px 14px' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>
                            GÖREV LİSTESİ ({r.sortedAssignments.length})
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                                <tr style={{ background: '#fff' }}>
                                    <th style={th}>TARİH</th><th style={th}>YARIŞMA</th><th style={th}>BRANŞ</th>
                                    <th style={th}>KATEGORİ</th><th style={th}>ALET / PANEL</th><th style={th}>KARNE</th>
                                </tr>
                            </thead>
                            <tbody>
                                {r.sortedAssignments.map((a, i) => (
                                    <tr key={i} style={{ borderBottom: '1px solid #eef2f7' }}>
                                        <td style={tdc}>{fmtDate(a.date)}</td>
                                        <td style={{ ...td, fontWeight: 600 }}>{a.compName}</td>
                                        <td style={tdc}>{a.disciplineLabel}</td>
                                        <td style={tdc}>{a.catId ? catLabel(a.catId) : '—'}</td>
                                        <td style={tdc}>{[a.aletId, a.panelId].filter(Boolean).join(' / ') || '—'}</td>
                                        <td style={tdc}>
                                            {a.routePrefix && a.compId ? (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); navigate(`${a.routePrefix}/hakem-karnesi?comp=${a.compId}&tab=fig&judge=${encodeURIComponent(r.adSoyad)}`); }}
                                                    style={btn('#6366f1', false, true)}>
                                                    Karne
                                                </button>
                                            ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </td>
                </tr>
            )}
        </>
    );
}

function Kpi({ color, label, value }) {
    return (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '0.9rem 1rem', borderLeft: `4px solid ${color}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: '1.7rem', fontWeight: 900, color: '#0f172a' }}>{value}</div>
        </div>
    );
}

/* ── Stiller ─────────────────────────────────────────────────────────── */
const cardBox = { background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', padding: '1rem' };
const emptyBox = { padding: 24, textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' };
const th = { padding: '8px 10px', textAlign: 'center', fontSize: 11, color: '#475569', whiteSpace: 'nowrap' };
const td = { padding: '6px 10px' };
const tdc = { ...td, textAlign: 'center' };
const btn = (color, disabled, small) => ({
    padding: small ? '3px 10px' : '0.5rem 0.9rem', borderRadius: 6, border: 'none',
    background: disabled ? '#94a3b8' : color, color: '#fff', fontWeight: 700,
    fontSize: small ? 11 : 13, cursor: disabled ? 'default' : 'pointer',
});
const badge = (color) => ({
    background: color, color: '#fff', fontSize: 10, fontWeight: 800,
    padding: '2px 8px', borderRadius: 999, marginLeft: 6, whiteSpace: 'nowrap',
});
