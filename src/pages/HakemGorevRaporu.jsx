/**
 * HakemGorevRaporu — Çok branşlı hakem görev raporu.
 * RefereesPage içindeki "Görev Raporu" sekmesi olarak render edilir.
 * Tüm branşların tüm yarışmalarındaki hakem atamalarını (hakemler düğümü)
 * tarayıp her hakemin görev geçmişini, bröve atlama durumunu gösterir,
 * Excel dışa/içe aktarma ve FIG Hakem Karnesi'ne derin bağlantı sağlar.
 */
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, get, update, remove } from 'firebase/database';
import { db } from '../lib/firebase';
import { DISCIPLINE_CONFIG } from '../lib/DisciplineContext';

/* ── Yardımcılar ─────────────────────────────────────────────────────── */
const normName = (s) => String(s || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Levenshtein — fuzzy dupe için
function lev(a, b) {
    if (a === b) return 0;
    if (!a || !b) return (a || b).length;
    const m = b.length;
    let prev = new Array(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 0; i < a.length; i++) {
        let cur = [i + 1];
        for (let j = 0; j < m; j++) {
            cur.push(Math.min(prev[j + 1] + 1, cur[j] + 1, prev[j] + (a[i] === b[j] ? 0 : 1)));
        }
        prev = cur;
    }
    return prev[m];
}

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

// Branş görsel meta — renk + ikon + kısa etiket
const DISCIPLINE_META = {
    artistik:  { color: '#4F46E5', light: '#EEF2FF', icon: 'sports_gymnastics', label: 'Artistik' },
    ritmik:    { color: '#EC4899', light: '#FDF2F8', icon: 'auto_awesome',      label: 'Ritmik' },
    aerobik:   { color: '#10B981', light: '#ECFDF5', icon: 'directions_run',    label: 'Aerobik' },
    parkur:    { color: '#F59E0B', light: '#FFFBEB', icon: 'accessibility_new', label: 'Parkur' },
    trampolin: { color: '#F97316', light: '#FFF7ED', icon: 'rocket_launch',     label: 'Trampolin' },
};
const DM_FALLBACK = { color: '#64748B', light: '#F1F5F9', icon: 'edit_note', label: 'Elle' };
const dmeta = (id) => DISCIPLINE_META[id] || DM_FALLBACK;

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
    const [disFilter, setDisFilter] = useState('all'); // all | artistik | aerobik | ritmik | parkur | trampolin
    const [expanded, setExpanded] = useState({});
    const [importing, setImporting] = useState(false);
    const [msg, setMsg] = useState('');
    // Yönetim modu (birleştirme/silme)
    const [manageMode, setManageMode] = useState(false);
    const [selected, setSelected] = useState(() => new Set());
    const [mergeModal, setMergeModal] = useState(null); // { items }
    const [deleteModal, setDeleteModal] = useState(null); // { id, name } | { ids: [] }
    const [dupesOnly, setDupesOnly] = useState(false);
    // Görev ekleme / silme modalları
    const [addGorevModal, setAddGorevModal] = useState(null); // { ref }
    const [addForm, setAddForm] = useState({ tarih: '', yarisma: '', brans: 'artistik', rol: '' });
    const [delGorevConfirm, setDelGorevConfirm] = useState(null); // { refId, ad, entry }
    const [autoMergeModal, setAutoMergeModal] = useState(null); // { clusters }

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
        // referee index (id, isim, alias)
        const byId = {}, byName = {}, byAlias = {};
        (referees || []).forEach(r => {
            byId[r.id] = r;
            byName[normName(r.adSoyad)] = r;
            const aliases = Array.isArray(r.nameAliases) ? r.nameAliases : (r.nameAliases ? Object.values(r.nameAliases) : []);
            aliases.forEach(a => { const n = normName(a); if (n) byAlias[n] = r; });
        });
        // hakem → { ref, assignments[], comps Set, disciplines Set }
        const map = {};
        const lookup = (name, idHint) => (idHint && byId[idHint]) || byName[normName(name)] || byAlias[normName(name)];
        const keyFor = (a) => {
            const r = lookup(a.refName, a.refId);
            return r ? `ref:${r.id}` : `name:${normName(a.refName)}`;
        };
        (scan?.assignments || []).forEach(a => {
            const r = lookup(a.refName, a.refId);
            const key = keyFor(a);
            const rec = map[key] = map[key] || {
                key, referee: r || null,
                adSoyad: r?.adSoyad || a.refName,
                il: r?.il || '', brove: r?.brove || '',
                matched: !!r,
                assignments: [], comps: new Set(), disciplines: new Set(), disciplineIds: new Set(),
            };
            rec.assignments.push(a);
            rec.comps.add(`${a.discipline}|${a.compId}`);
            rec.disciplines.add(a.disciplineLabel);
            if (a.discipline) rec.disciplineIds.add(a.discipline);
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
                matched: true, assignments: [], comps: new Set(), disciplines: new Set(), disciplineIds: new Set(),
            };
            list.forEach((g, i) => {
                if (!g || !g.compName) return;
                // taramada zaten bulunan yarışmayı elle kayıttan tekrar sayma
                if (rec.scannedCompNames && rec.scannedCompNames.has(normName(g.compName))) return;
                rec.assignments.push({
                    discipline: '', disciplineLabel: 'Elle', routePrefix: '',
                    compId: '', compName: g.compName, date: g.date || '',
                    catId: '', aletId: '', panelId: g.role || '',
                    refId: r.id, refName: r.adSoyad, manual: true, manualEntry: g,
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
                disciplineIdsArr: [...rec.disciplineIds],
                lastDate: sortedA[0]?.date || '',
                sortedAssignments: sortedA,
                breveUygun: gorevSayisi >= 2,
                breveNext: nextBrove(rec.brove),
            };
        }).sort((a, b) => b.gorevSayisi - a.gorevSayisi || a.adSoyad.localeCompare(b.adSoyad, 'tr'));
        return rows;
    }, [scan, referees]);

    // Tam mükerrer — normalize edilmiş ismi birebir aynı kayıtlar (otomatik birleştirilebilir)
    const exactDupeClusters = useMemo(() => {
        const map = {};
        report.forEach(r => {
            if (!r.referee?.id) return; // sadece DB'de olanları birleştirebiliriz
            const k = normName(r.adSoyad);
            (map[k] = map[k] || []).push(r);
        });
        return Object.values(map).filter(arr => arr.length >= 2);
    }, [report]);

    // Olası mükerrer hakemler — isim lev<=2, aynı soyad-baş-3
    const dupeClusterIds = useMemo(() => {
        const names = report.map(r => normName(r.adSoyad));
        const parent = names.map((_, i) => i);
        const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
        for (let i = 0; i < names.length; i++) {
            for (let j = i + 1; j < names.length; j++) {
                const a = names[i], b = names[j];
                if (Math.abs(a.length - b.length) > 2) continue;
                const sa = a.split(' ').slice(-1)[0], sb = b.split(' ').slice(-1)[0];
                if (sa.slice(0, 3) !== sb.slice(0, 3)) continue;
                if (lev(a, b) <= 2) parent[find(i)] = find(j);
            }
        }
        const buckets = {};
        report.forEach((_, i) => { const root = find(i); (buckets[root] = buckets[root] || []).push(i); });
        const dupKeys = new Set();
        Object.values(buckets).forEach(arr => { if (arr.length >= 2) arr.forEach(i => dupKeys.add(report[i].key)); });
        return dupKeys;
    }, [report]);

    const filtered = useMemo(() => {
        const s = normName(search);
        return report.filter(r => {
            if (s && !normName(r.adSoyad).includes(s) && !normName(r.il).includes(s)) return false;
            if (broveFilter && String(r.brove).toLocaleUpperCase('tr-TR') !== broveFilter) return false;
            if (disFilter !== 'all' && !r.disciplineIds.has(disFilter)) return false;
            if (dupesOnly && !dupeClusterIds.has(r.key)) return false;
            return true;
        });
    }, [report, search, broveFilter, disFilter, dupesOnly, dupeClusterIds]);

    // Branş başına hakem sayısı (filtre çiplerinde sayaç için)
    const disCounts = useMemo(() => {
        const m = { all: report.length };
        Object.keys(DISCIPLINE_META).forEach(k => {
            m[k] = report.filter(r => r.disciplineIds.has(k)).length;
        });
        return m;
    }, [report]);

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

    /* ── Yönetim modu yardımcıları ───────────────────────────────────── */
    const toggleSelect = (key) => {
        if (!key) return;
        setSelected(prev => {
            const s = new Set(prev);
            s.has(key) ? s.delete(key) : s.add(key);
            return s;
        });
    };
    const clearSelection = () => setSelected(new Set());
    const exitManageMode = () => { setManageMode(false); clearSelection(); };

    const openMergeModal = () => {
        const items = report.filter(r => selected.has(r.key));
        if (items.length < 2) { setMsg('Birleştirmek için en az 2 hakem seçin.'); return; }
        const dbItems = items.filter(r => r.referee?.id);
        if (dbItems.length === 0) {
            setMsg('En az 1 DB-kayıtlı hakem seçmelisiniz (kazanan o olacak; "listede yok" olanlar alias olarak eklenir).');
            return;
        }
        setMergeModal({ items, winnerId: dbItems[0].referee.id });
    };
    const performMerge = async (winnerId) => {
        if (!mergeModal) return;
        try {
            const winner = mergeModal.items.find(r => r.referee?.id === winnerId);
            if (!winner) return;
            const losers = mergeModal.items.filter(r => r !== winner);
            const dbLosers = losers.filter(r => r.referee?.id);
            // gecmisYarismalar union (compName+date dedupe) — sadece DB kayıtlardan
            const all = []; const seen = new Set();
            const pushList = (rec) => {
                const gy = rec.referee?.gecmisYarismalar;
                const list = Array.isArray(gy) ? gy : (gy ? Object.values(gy) : []);
                list.forEach(g => {
                    if (!g || !g.compName) return;
                    const k = normName(g.compName) + '|' + (g.date || '');
                    if (seen.has(k)) return;
                    seen.add(k); all.push(g);
                });
            };
            pushList(winner); dbLosers.forEach(pushList);
            // nameAliases — hem DB hem "listede yok" kaybedenlerin isimlerini ekle
            const existing = Array.isArray(winner.referee?.nameAliases)
                ? winner.referee.nameAliases
                : (winner.referee?.nameAliases ? Object.values(winner.referee.nameAliases) : []);
            const aliasSet = new Set(existing.map(a => normName(a)));
            aliasSet.add(normName(winner.adSoyad));
            const newAliases = [...existing];
            losers.forEach(l => {
                const nm = l.adSoyad; if (!nm) return;
                const k = normName(nm);
                if (aliasSet.has(k)) return;
                aliasSet.add(k); newAliases.push(nm);
            });
            const updates = {};
            updates[`referees/${winnerId}/gecmisYarismalar`] = all;
            updates[`referees/${winnerId}/gorevSayisi`] = all.length;
            if (newAliases.length) updates[`referees/${winnerId}/nameAliases`] = newAliases;
            ['il', 'brove', 'email', 'telefon', 'disiplin', 'brans'].forEach(f => {
                if (!winner.referee?.[f]) {
                    const v = dbLosers.map(l => l.referee?.[f]).find(x => x);
                    if (v) updates[`referees/${winnerId}/${f}`] = v;
                }
            });
            await update(ref(db), updates);
            for (const l of dbLosers) await remove(ref(db, `referees/${l.referee.id}`));
            const nonDb = losers.length - dbLosers.length;
            setMsg(`Birleştirildi → ${winner.adSoyad}. ${dbLosers.length} DB kaydı silindi` + (nonDb ? `, ${nonDb} "listede yok" kayıt alias olarak eklendi.` : '.'));
            setMergeModal(null); clearSelection();
        } catch (e) {
            setMsg('Birleştirme sırasında hata oluştu.');
        }
    };
    // Yeni görev ekle — referee.gecmisYarismalar listesine ekler
    const openAddGorev = (ref) => {
        if (!ref?.id) { setMsg('Bu hakem henüz DB\'de değil — önce eklenmesi gerekir.'); return; }
        setAddForm({ tarih: '', yarisma: '', brans: ref.disiplin || 'artistik', rol: '' });
        setAddGorevModal({ ref });
    };
    const submitAddGorev = async () => {
        if (!addGorevModal?.ref?.id) return;
        if (!addForm.yarisma.trim()) { setMsg('Yarışma adı zorunlu.'); return; }
        const r = (referees || []).find(x => x.id === addGorevModal.ref.id);
        const gy = r?.gecmisYarismalar;
        const list = Array.isArray(gy) ? [...gy] : (gy ? Object.values(gy) : []);
        list.push({
            compName: addForm.yarisma.trim(),
            date: addForm.tarih.trim(),
            role: [addForm.brans, addForm.rol].filter(Boolean).join(' · '),
            addedAt: new Date().toISOString(),
            manualAdd: true,
        });
        try {
            await update(ref(db, `referees/${addGorevModal.ref.id}`), {
                gecmisYarismalar: list,
                gorevSayisi: list.length,
            });
            setMsg(`'${addGorevModal.ref.adSoyad}' kaydına yeni görev eklendi.`);
            setAddGorevModal(null);
        } catch (e) { setMsg('Görev eklenirken hata oluştu.'); }
    };

    // Görev sil — referee.gecmisYarismalar'dan bir kaydı kaldırır
    const performGorevDelete = async () => {
        if (!delGorevConfirm) return;
        const { refId, entry } = delGorevConfirm;
        const r = (referees || []).find(x => x.id === refId);
        if (!r) { setDelGorevConfirm(null); return; }
        const gy = r.gecmisYarismalar;
        const list = Array.isArray(gy) ? [...gy] : (gy ? Object.values(gy) : []);
        // İlk eşleşeni (compName + date) kaldır
        const match = (g) => g && normName(g.compName) === normName(entry.compName)
            && String(g.date || '') === String(entry.date || '');
        const idx = list.findIndex(match);
        if (idx < 0) { setMsg('Görev kaydı bulunamadı.'); setDelGorevConfirm(null); return; }
        list.splice(idx, 1);
        try {
            await update(ref(db, `referees/${refId}`), {
                gecmisYarismalar: list,
                gorevSayisi: list.length,
            });
            setMsg(`'${r.adSoyad}' kaydından bir görev silindi.`);
            setDelGorevConfirm(null);
        } catch (e) { setMsg('Görev silinirken hata oluştu.'); }
    };

    // Aynı isimli tam mükerrer kayıtları otomatik birleştir
    const autoMergeExact = async () => {
        if (!autoMergeModal) return;
        let mergedClusters = 0, deleted = 0;
        try {
            for (const cluster of autoMergeModal.clusters) {
                // En çok görev geçmişine sahip olanı kazanan seç
                const score = (r) => {
                    const gy = r.referee?.gecmisYarismalar;
                    const len = Array.isArray(gy) ? gy.length : (gy ? Object.keys(gy).length : 0);
                    return len * 10 + (r.referee?.brove ? 1 : 0) + (r.referee?.il ? 1 : 0);
                };
                const sorted = [...cluster].sort((a, b) => score(b) - score(a));
                const winner = sorted[0];
                const losers = sorted.slice(1);
                // gecmisYarismalar birleşimi (compName+date dedupe)
                const all = []; const seen = new Set();
                [winner, ...losers].forEach(rec => {
                    const gy = rec.referee?.gecmisYarismalar;
                    const list = Array.isArray(gy) ? gy : (gy ? Object.values(gy) : []);
                    list.forEach(g => {
                        if (!g || !g.compName) return;
                        const k = normName(g.compName) + '|' + (g.date || '');
                        if (seen.has(k)) return;
                        seen.add(k); all.push(g);
                    });
                });
                const updates = {};
                updates[`referees/${winner.referee.id}/gecmisYarismalar`] = all;
                updates[`referees/${winner.referee.id}/gorevSayisi`] = all.length;
                ['il', 'brove', 'email', 'telefon', 'disiplin', 'brans'].forEach(f => {
                    if (!winner.referee?.[f]) {
                        const v = losers.map(l => l.referee?.[f]).find(x => x);
                        if (v) updates[`referees/${winner.referee.id}/${f}`] = v;
                    }
                });
                await update(ref(db), updates);
                for (const l of losers) {
                    await remove(ref(db, `referees/${l.referee.id}`));
                    deleted++;
                }
                mergedClusters++;
            }
            setMsg(`${mergedClusters} grup birleştirildi; ${deleted} mükerrer kayıt silindi.`);
            setAutoMergeModal(null);
        } catch (e) {
            setMsg('Otomatik birleştirme sırasında hata oluştu.');
        }
    };

    const performDelete = async (ids) => {
        try {
            for (const id of ids) await remove(ref(db, `referees/${id}`));
            setMsg(`${ids.length} hakem silindi.`);
            setDeleteModal(null); clearSelection();
        } catch (e) {
            setMsg('Silme sırasında hata oluştu.');
        }
    };

    /* ── Render ──────────────────────────────────────────────────────── */
    const disChips = [['all', 'Tümü', '#0f172a', '#f1f5f9', 'apps'], ...Object.entries(DISCIPLINE_META).map(([k, m]) => [k, m.label, m.color, m.light, m.icon])];

    return (
        <div style={{ padding: '1.25rem 1.25rem 2rem', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Üst banner — başlık + araçlar */}
            <div style={{
                background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
                color: '#fff', borderRadius: 14, padding: '1.1rem 1.3rem',
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16,
            }}>
                <div style={{ flex: 1, minWidth: 260 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <i className="material-icons-round" style={{ fontSize: 26 }}>insights</i>
                        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, letterSpacing: 0.2 }}>Hakem Görev Raporu</h2>
                    </div>
                    <div style={{ fontSize: 12.5, opacity: 0.9, marginTop: 4 }}>
                        Tüm branşların yarışmalarındaki atamalar tek panelde · branş ayrımı · bröve atlama takibi
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={runScan} disabled={scanning} style={primaryBtn(scanning)}>
                        <i className="material-icons-round" style={{ fontSize: 18 }}>
                            {scanning ? 'hourglass_top' : 'travel_explore'}
                        </i>
                        {scanning ? 'Taranıyor…' : (scan ? 'Yeniden Tara' : 'Tüm Görevleri Tara')}
                    </button>
                    <button onClick={exportExcel} disabled={!scan} style={ghostBtn(!scan)}>
                        <i className="material-icons-round" style={{ fontSize: 18 }}>file_download</i>
                        Excel'e Aktar
                    </button>
                    <label style={{ ...ghostBtn(importing), cursor: importing ? 'default' : 'pointer' }}>
                        <i className="material-icons-round" style={{ fontSize: 18 }}>file_upload</i>
                        {importing ? 'Yükleniyor…' : "Excel'den Yükle"}
                        <input type="file" accept=".xlsx,.xls" onChange={importExcel} disabled={importing} style={{ display: 'none' }} />
                    </label>
                    <button onClick={() => manageMode ? exitManageMode() : setManageMode(true)}
                        style={{ ...ghostBtn(false), background: manageMode ? '#fff' : 'transparent', color: manageMode ? '#4F46E5' : '#fff', borderColor: manageMode ? '#fff' : 'rgba(255,255,255,0.5)' }}>
                        <i className="material-icons-round" style={{ fontSize: 18 }}>{manageMode ? 'close' : 'rule'}</i>
                        {manageMode ? 'Modu Kapat' : 'Yönetim Modu'}
                    </button>
                </div>
            </div>

            {/* Yönetim modu aksiyon çubuğu */}
            {manageMode && (
                <div style={{
                    background: '#FEF3C7', border: '1px solid #FCD34D', color: '#78350F',
                    borderRadius: 10, padding: '0.7rem 0.9rem', display: 'flex',
                    gap: 10, flexWrap: 'wrap', alignItems: 'center',
                }}>
                    <i className="material-icons-round" style={{ fontSize: 20 }}>rule</i>
                    <strong style={{ fontSize: 13 }}>Yönetim Modu</strong>
                    <span style={{ fontSize: 12 }}>Satırlardan hakem seçin; birleştirme veya silme yapın.</span>
                    <span style={{ marginLeft: 'auto', background: '#fff', padding: '3px 10px', borderRadius: 999, fontWeight: 700, fontSize: 12 }}>
                        Seçili: {selected.size}
                    </span>
                    <button onClick={openMergeModal} disabled={selected.size < 2}
                        style={btn('#6366f1', selected.size < 2)}>
                        <i className="material-icons-round" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>merge_type</i>
                        Birleştir
                    </button>
                    <button onClick={() => setAutoMergeModal({ clusters: exactDupeClusters })}
                        disabled={exactDupeClusters.length === 0}
                        style={btn('#0EA5E9', exactDupeClusters.length === 0)}
                        title="Aynı isimle birden çok kez kayıtlı hakemleri tek tuşla birleştir">
                        <i className="material-icons-round" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>auto_awesome</i>
                        Aynı İsimleri Birleştir ({exactDupeClusters.length})
                    </button>
                    <button onClick={() => {
                        const ids = report.filter(r => selected.has(r.key) && r.referee?.id).map(r => r.referee.id);
                        if (ids.length === 0) { setMsg('Silinecek DB-kayıtlı hakem seçilmedi (listede yok kayıtlar silinemez).'); return; }
                        setDeleteModal({ ids });
                    }} disabled={selected.size < 1}
                        style={btn('#ef4444', selected.size < 1)}>
                        <i className="material-icons-round" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>delete</i>
                        Sil
                    </button>
                </div>
            )}

            {/* Bilgi/mesaj satırı */}
            {msg && (
                <div style={{ background: '#EEF2FF', border: '1px solid #C7D2FE', color: '#3730A3', padding: '0.6rem 0.9rem', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
                    <i className="material-icons-round" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 6 }}>info</i>
                    {msg}
                </div>
            )}

            {!scan ? (
                <div style={{
                    padding: '3rem 1rem', textAlign: 'center', background: '#fff',
                    border: '2px dashed #cbd5e1', borderRadius: 12, color: '#64748b',
                }}>
                    <i className="material-icons-round" style={{ fontSize: 48, color: '#94a3b8', display: 'block', marginBottom: 8 }}>radar</i>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#475569' }}>Görev raporu için tarama gerekiyor</div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                        Üstteki <strong>"Tüm Görevleri Tara"</strong> butonuna basın. Tüm branşların tüm yarışmalarındaki
                        hakem atamaları taranıp burada raporlanır.
                    </div>
                </div>
            ) : (
                <>
                    {/* KPI şeridi */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
                        <Kpi color="#6366f1" icon="groups" label="Görevli Hakem" value={kpi.hakem} />
                        <Kpi color="#0ea5e9" icon="event_available" label="Toplam Görev" value={kpi.gorev} />
                        <Kpi color="#22c55e" icon="upgrade" label="Bröve Atlamaya Uygun" value={kpi.uygun} />
                        <Kpi color="#f59e0b" icon="category" label="Branş Sayısı" value={kpi.brans} />
                    </div>

                    {/* Branş çipleri */}
                    <div style={{ ...cardBox, padding: '0.7rem 0.9rem' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>Branş</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {disChips.map(([key, label, col, bg, icon]) => {
                                const active = disFilter === key;
                                const n = disCounts[key] || 0;
                                return (
                                    <button key={key} onClick={() => setDisFilter(key)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 6,
                                            padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                                            border: `1.5px solid ${col}`,
                                            background: active ? col : bg,
                                            color: active ? '#fff' : col,
                                            fontWeight: 700, fontSize: 12.5,
                                        }}>
                                        <i className="material-icons-round" style={{ fontSize: 15 }}>{icon}</i>
                                        {label}
                                        <span style={{
                                            background: active ? 'rgba(255,255,255,0.25)' : '#fff',
                                            color: active ? '#fff' : col,
                                            borderRadius: 999, padding: '0 7px', fontSize: 11, fontWeight: 800,
                                        }}>{n}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Arama + bröve + sonuç sayısı */}
                    <div style={{ ...cardBox, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '0.7rem 0.9rem' }}>
                        <div style={{ flex: 1, minWidth: 220, position: 'relative' }}>
                            <i className="material-icons-round" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 18, color: '#94a3b8' }}>search</i>
                            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Hakem ara (isim / il)…"
                                style={{ width: '100%', padding: '0.5rem 0.7rem 0.5rem 2.1rem', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, outline: 'none' }} />
                        </div>
                        <select value={broveFilter} onChange={e => setBroveFilter(e.target.value)}
                            style={{ padding: '0.5rem 0.7rem', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, background: '#fff' }}>
                            <option value="">Tüm Bröveler</option>
                            <option value="ULUSLARARASI">Uluslararası</option>
                            <option value="MİLLİ">Milli</option>
                            <option value="BÖLGE">Bölge</option>
                            <option value="ADAY">Aday</option>
                        </select>
                        <button onClick={() => setDupesOnly(v => !v)}
                            title="Olası mükerrer hakemleri göster"
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
                                border: `1.5px solid ${dupesOnly ? '#EF4444' : '#FCA5A5'}`,
                                background: dupesOnly ? '#EF4444' : '#FEF2F2',
                                color: dupesOnly ? '#fff' : '#B91C1C',
                                fontWeight: 700, fontSize: 12,
                            }}>
                            <i className="material-icons-round" style={{ fontSize: 14 }}>warning</i>
                            Olası Mükerrer
                            <span style={{
                                background: dupesOnly ? 'rgba(255,255,255,0.25)' : '#fff',
                                color: dupesOnly ? '#fff' : '#B91C1C',
                                borderRadius: 999, padding: '0 7px', fontSize: 11, fontWeight: 800,
                            }}>{dupeClusterIds.size}</span>
                        </button>
                        <span style={{
                            fontSize: 12, color: '#475569', fontWeight: 700, background: '#f1f5f9',
                            padding: '5px 10px', borderRadius: 999,
                        }}>
                            <strong style={{ color: '#0f172a' }}>{filtered.length}</strong> / {report.length} hakem
                        </span>
                    </div>

                    {/* Tablo */}
                    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                                        {manageMode && <th style={th}></th>}
                                        <th style={{ ...th, textAlign: 'left', paddingLeft: 16 }}>HAKEM</th>
                                        <th style={th}>İL</th>
                                        <th style={th}>BRÖVE</th>
                                        <th style={th}>BRANŞ(LAR)</th>
                                        <th style={th}>GÖREV</th>
                                        <th style={th}>BRÖVE DURUMU</th>
                                        <th style={th}>SON GÖREV</th>
                                        {manageMode && <th style={th}></th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map((r, idx) => (
                                        <FragmentRow key={r.key} r={r} idx={idx} expanded={!!expanded[r.key]}
                                            onToggle={() => setExpanded(s => ({ ...s, [r.key]: !s[r.key] }))}
                                            navigate={navigate}
                                            manageMode={manageMode}
                                            isSelected={selected.has(r.key)}
                                            onToggleSelect={() => toggleSelect(r.key)}
                                            isDupe={dupeClusterIds.has(r.key)}
                                            onDelete={() => r.referee?.id && setDeleteModal({ ids: [r.referee.id], name: r.adSoyad })}
                                            onAddGorev={() => openAddGorev(r.referee)}
                                            onDeleteGorev={(a) => setDelGorevConfirm({ refId: r.referee?.id, ad: r.adSoyad, entry: a.manualEntry })}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {filtered.length === 0 && (
                            <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#94a3b8' }}>
                                <i className="material-icons-round" style={{ fontSize: 36, display: 'block', marginBottom: 4 }}>filter_alt_off</i>
                                <div style={{ fontWeight: 700 }}>Eşleşen hakem yok</div>
                                <div style={{ fontSize: 12 }}>Branş/bröve filtresini veya aramayı değiştirin.</div>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* Birleştirme modalı */}
            {mergeModal && (
                <ModalOverlay onClose={() => setMergeModal(null)}>
                    <div style={modalCard}>
                        <div style={modalHead('#6366f1')}>
                            <i className="material-icons-round">merge_type</i>
                            Hakemleri Birleştir ({mergeModal.items.length} kayıt)
                        </div>
                        <div style={{ padding: '1rem 1.2rem' }}>
                            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
                                Hangi kayıt <strong>kalsın</strong>? Diğer kayıtların görev geçmişi seçili kayda taşınacak ve diğerleri silinecek.
                            </div>
                            {mergeModal.items.map((it, i) => {
                                const id = it.referee?.id;
                                const dbReg = !!id;
                                return (
                                    <label key={it.key || i} style={{
                                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                                        borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 6,
                                        cursor: dbReg ? 'pointer' : 'default',
                                        background: dbReg && mergeModal.winnerId === id ? '#EEF2FF' : (dbReg ? '#fff' : '#FEF2F2'),
                                    }}>
                                        <input type="radio" name="winner" disabled={!dbReg}
                                            checked={dbReg && mergeModal.winnerId === id}
                                            onChange={() => dbReg && setMergeModal({ ...mergeModal, winnerId: id })} />
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 800 }}>
                                                {it.adSoyad}
                                                {!dbReg && <span style={{ ...badge('#ef4444'), marginLeft: 6 }}>listede yok → alias olur</span>}
                                            </div>
                                            <div style={{ fontSize: 11, color: '#64748b' }}>
                                                il: {it.il || '—'} · brove: {it.brove || '—'} · {it.gorevSayisi} görev · {it.disciplineList || '—'}
                                            </div>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                        <div style={modalFoot}>
                            <button onClick={() => setMergeModal(null)} style={btn('#94a3b8', false)}>İptal</button>
                            <button onClick={() => performMerge(mergeModal.winnerId)} style={btn('#6366f1', false)}>
                                <i className="material-icons-round" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>merge_type</i>
                                Birleştir
                            </button>
                        </div>
                    </div>
                </ModalOverlay>
            )}

            {/* Aynı İsimleri Otomatik Birleştir modalı */}
            {autoMergeModal && (
                <ModalOverlay onClose={() => setAutoMergeModal(null)}>
                    <div style={{ ...modalCard, maxWidth: 620 }}>
                        <div style={modalHead('#0EA5E9')}>
                            <i className="material-icons-round">auto_awesome</i>
                            Aynı İsimleri Otomatik Birleştir
                        </div>
                        <div style={{ padding: '1rem 1.2rem' }}>
                            {autoMergeModal.clusters.length === 0 ? (
                                <div style={{ color: '#22c55e', fontWeight: 600 }}>Birebir aynı isimli mükerrer kayıt bulunamadı.</div>
                            ) : (
                                <>
                                    <div style={{ fontSize: 13, color: '#475569', marginBottom: 10 }}>
                                        <strong>{autoMergeModal.clusters.length}</strong> grup tek kayda indirilecek
                                        (en çok görev geçmişine sahip kayıt korunur, diğerleri silinip görev geçmişi taşınır).
                                    </div>
                                    <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                                        {autoMergeModal.clusters.map((cl, i) => (
                                            <div key={i} style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9' }}>
                                                <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a' }}>{cl[0].adSoyad}</div>
                                                <div style={{ fontSize: 11, color: '#64748b' }}>
                                                    {cl.length} kayıt → 1 kayda indirilecek
                                                    ({cl.reduce((s, r) => s + r.gorevSayisi, 0)} toplam görev)
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                        <div style={modalFoot}>
                            <button onClick={() => setAutoMergeModal(null)} style={btn('#94a3b8', false)}>İptal</button>
                            <button onClick={autoMergeExact} disabled={autoMergeModal.clusters.length === 0}
                                style={btn('#0EA5E9', autoMergeModal.clusters.length === 0)}>
                                <i className="material-icons-round" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>merge_type</i>
                                Hepsini Birleştir
                            </button>
                        </div>
                    </div>
                </ModalOverlay>
            )}

            {/* Yeni Görev Ekle modalı */}
            {addGorevModal && (
                <ModalOverlay onClose={() => setAddGorevModal(null)}>
                    <div style={modalCard}>
                        <div style={modalHead('#22c55e')}>
                            <i className="material-icons-round">add_circle</i>
                            Yeni Görev Ekle — {addGorevModal.ref?.adSoyad}
                        </div>
                        <div style={{ padding: '1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <Field label="Tarih" hint="dd.mm.yyyy ya da '12 Mart 2026'">
                                <input value={addForm.tarih} onChange={e => setAddForm({ ...addForm, tarih: e.target.value })}
                                    placeholder="örn. 12.03.2026"
                                    style={inp} />
                            </Field>
                            <Field label="Yarışma" hint="örn. EDİRNE - AC, Şanlıurfa">
                                <input value={addForm.yarisma} onChange={e => setAddForm({ ...addForm, yarisma: e.target.value })}
                                    placeholder="Yarışma adı / yer"
                                    style={inp} />
                            </Field>
                            <Field label="Branş">
                                <select value={addForm.brans} onChange={e => setAddForm({ ...addForm, brans: e.target.value })}
                                    style={inp}>
                                    <option value="artistik">Artistik</option>
                                    <option value="ritmik">Ritmik</option>
                                    <option value="aerobik">Aerobik</option>
                                    <option value="parkur">Parkur</option>
                                    <option value="trampolin">Trampolin</option>
                                </select>
                            </Field>
                            <Field label="Rol / Açıklama (ops.)">
                                <input value={addForm.rol} onChange={e => setAddForm({ ...addForm, rol: e.target.value })}
                                    placeholder="örn. Baş Hakem, Hakem 3"
                                    style={inp} />
                            </Field>
                        </div>
                        <div style={modalFoot}>
                            <button onClick={() => setAddGorevModal(null)} style={btn('#94a3b8', false)}>İptal</button>
                            <button onClick={submitAddGorev} style={btn('#22c55e', false)}>
                                <i className="material-icons-round" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>save</i>
                                Görevi Kaydet
                            </button>
                        </div>
                    </div>
                </ModalOverlay>
            )}

            {/* Görev silme onay modalı */}
            {delGorevConfirm && (
                <ModalOverlay onClose={() => setDelGorevConfirm(null)}>
                    <div style={modalCard}>
                        <div style={modalHead('#ef4444')}>
                            <i className="material-icons-round">delete</i>
                            Görev Sil
                        </div>
                        <div style={{ padding: '1rem 1.2rem', fontSize: 14, color: '#475569' }}>
                            <strong>{delGorevConfirm.ad}</strong> hakeminin şu görev kaydı silinecek:
                            <div style={{ background: '#f1f5f9', borderRadius: 6, padding: '8px 10px', marginTop: 8, fontSize: 13 }}>
                                <strong>{delGorevConfirm.entry?.compName}</strong>
                                {delGorevConfirm.entry?.date && <span style={{ color: '#64748b' }}> · {delGorevConfirm.entry.date}</span>}
                                {delGorevConfirm.entry?.role && <div style={{ fontSize: 11, color: '#94a3b8' }}>{delGorevConfirm.entry.role}</div>}
                            </div>
                            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
                                Yalnız bu hakemin görev kaydı silinir; yarışma panelleri etkilenmez.
                            </div>
                        </div>
                        <div style={modalFoot}>
                            <button onClick={() => setDelGorevConfirm(null)} style={btn('#94a3b8', false)}>İptal</button>
                            <button onClick={performGorevDelete} style={btn('#ef4444', false)}>
                                <i className="material-icons-round" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>delete_forever</i>
                                Sil
                            </button>
                        </div>
                    </div>
                </ModalOverlay>
            )}

            {/* Silme modalı */}
            {deleteModal && (
                <ModalOverlay onClose={() => setDeleteModal(null)}>
                    <div style={modalCard}>
                        <div style={modalHead('#ef4444')}>
                            <i className="material-icons-round">delete</i>
                            Hakemi Sil
                        </div>
                        <div style={{ padding: '1rem 1.2rem', fontSize: 14, color: '#475569' }}>
                            {deleteModal.name ? (
                                <span><strong>{deleteModal.name}</strong> kalıcı olarak silinecek. Onaylıyor musunuz?</span>
                            ) : (
                                <span>Seçili <strong>{deleteModal.ids.length}</strong> hakem kalıcı olarak silinecek. Onaylıyor musunuz?</span>
                            )}
                            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
                                Yarışmalardaki hakem atamaları etkilenmez; yalnız hakem ana kaydı silinir.
                            </div>
                        </div>
                        <div style={modalFoot}>
                            <button onClick={() => setDeleteModal(null)} style={btn('#94a3b8', false)}>İptal</button>
                            <button onClick={() => performDelete(deleteModal.ids)} style={btn('#ef4444', false)}>
                                <i className="material-icons-round" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>delete_forever</i>
                                Sil
                            </button>
                        </div>
                    </div>
                </ModalOverlay>
            )}
        </div>
    );
}

function Field({ label, hint, children }) {
    return (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
            {children}
            {hint && <span style={{ fontSize: 10.5, color: '#94a3b8' }}>{hint}</span>}
        </label>
    );
}

function ModalOverlay({ onClose, children }) {
    return (
        <div onClick={onClose} style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
        }}>
            <div onClick={(e) => e.stopPropagation()}>{children}</div>
        </div>
    );
}

/* ── Hakem satırı + açılır görev detayı ──────────────────────────────── */
function FragmentRow({ r, idx, expanded, onToggle, navigate, manageMode, isSelected, onToggleSelect, isDupe, onDelete, onAddGorev, onDeleteGorev }) {
    const primaryDis = (r.disciplineIdsArr && r.disciplineIdsArr[0]) || null;
    const stripeColor = primaryDis ? dmeta(primaryDis).color : '#cbd5e1';
    return (
        <>
            <tr onClick={(e) => {
                if (manageMode) { e.stopPropagation(); onToggleSelect(); return; }
                onToggle();
            }} style={{
                borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
                background: isSelected ? '#EEF2FF' : (expanded ? '#f8fafc' : (idx % 2 ? '#fafbff' : '#fff')),
            }}>
                {manageMode && (
                    <td style={{ ...tdc, width: 40 }} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={onToggleSelect}
                            title={r.referee?.id ? '' : 'Listede yok — birleştirme için seçebilirsiniz; bir DB kaydına alias olarak eklenir'}
                            style={{ cursor: 'pointer', width: 16, height: 16 }} />
                    </td>
                )}
                <td style={{ ...td, fontWeight: 700, paddingLeft: 16, borderLeft: `4px solid ${stripeColor}` }}>
                    {!manageMode && (
                        <i className="material-icons-round" style={{ fontSize: 18, verticalAlign: 'middle', color: '#64748b', marginRight: 4 }}>
                            {expanded ? 'expand_more' : 'chevron_right'}
                        </i>
                    )}
                    <span>{r.adSoyad}</span>
                    {!r.matched && <span style={badge('#ef4444')}>listede yok</span>}
                    {isDupe && <span style={{ ...badge('#F59E0B'), marginLeft: 6 }}>⚠ olası mükerrer</span>}
                </td>
                <td style={tdc}>{r.il || '—'}</td>
                <td style={tdc}>
                    {r.brove ? <span style={{ ...badge('#64748B'), marginLeft: 0 }}>{r.brove}</span> : '—'}
                </td>
                <td style={tdc}>
                    <div style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
                        {(r.disciplineIdsArr || []).map(d => {
                            const m = dmeta(d);
                            return (
                                <span key={d} title={m.label} style={{
                                    background: m.light, color: m.color, border: `1px solid ${m.color}`,
                                    padding: '2px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 800,
                                    display: 'inline-flex', alignItems: 'center', gap: 3,
                                }}>
                                    <i className="material-icons-round" style={{ fontSize: 12 }}>{m.icon}</i>
                                    {m.label}
                                </span>
                            );
                        })}
                        {(!r.disciplineIdsArr || r.disciplineIdsArr.length === 0) && <span style={{ color: '#cbd5e1' }}>—</span>}
                    </div>
                </td>
                <td style={{ ...tdc, fontWeight: 900, fontSize: 15, color: '#0f172a' }}>{r.gorevSayisi}</td>
                <td style={tdc}>
                    {r.breveUygun ? (
                        <span style={{ ...badge('#22c55e'), marginLeft: 0 }}>
                            ✓ Bröve atlamaya uygun{r.breveNext ? ` → ${r.breveNext}` : ''}
                        </span>
                    ) : (
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>
                            {Math.max(0, 2 - r.gorevSayisi)} görev daha
                        </span>
                    )}
                </td>
                <td style={tdc}>{fmtDate(r.lastDate)}</td>
                {manageMode && (
                    <td style={{ ...tdc, width: 50 }} onClick={(e) => e.stopPropagation()}>
                        {r.referee?.id && (
                            <button onClick={onDelete} title="Bu hakemi sil"
                                style={{ background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: 6, padding: '3px 6px', cursor: 'pointer' }}>
                                <i className="material-icons-round" style={{ fontSize: 14 }}>delete</i>
                            </button>
                        )}
                    </td>
                )}
            </tr>
            {expanded && !manageMode && (
                <tr>
                    <td colSpan={7} style={{ background: '#f8fafc', padding: '14px 18px', borderLeft: `4px solid ${stripeColor}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                            <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', letterSpacing: 0.4, textTransform: 'uppercase' }}>
                                <i className="material-icons-round" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4, color: stripeColor }}>list_alt</i>
                                Görev Listesi ({r.sortedAssignments.length})
                            </div>
                            <div style={{ marginLeft: 'auto' }}>
                                {r.referee?.id && (
                                    <button onClick={(e) => { e.stopPropagation(); onAddGorev && onAddGorev(); }}
                                        style={{
                                            background: '#22c55e', color: '#fff', border: 'none', borderRadius: 6,
                                            padding: '5px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer',
                                            display: 'inline-flex', alignItems: 'center', gap: 4,
                                        }}>
                                        <i className="material-icons-round" style={{ fontSize: 14 }}>add_circle</i>
                                        Görev Ekle
                                    </button>
                                )}
                            </div>
                        </div>
                        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                <thead>
                                    <tr style={{ background: '#f1f5f9' }}>
                                        <th style={th}>TARİH</th>
                                        <th style={{ ...th, textAlign: 'left' }}>YARIŞMA</th>
                                        <th style={th}>BRANŞ</th>
                                        <th style={th}>KATEGORİ</th>
                                        <th style={th}>ALET / PANEL</th>
                                        <th style={th}>KARNE</th>
                                        <th style={th}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {r.sortedAssignments.map((a, i) => {
                                        const m = dmeta(a.discipline);
                                        return (
                                            <tr key={i} style={{ borderBottom: '1px solid #eef2f7' }}>
                                                <td style={{ ...tdc, fontWeight: 700 }}>{fmtDate(a.date)}</td>
                                                <td style={{ ...td, fontWeight: 600 }}>{a.compName}</td>
                                                <td style={tdc}>
                                                    <span style={{
                                                        background: m.light, color: m.color, border: `1px solid ${m.color}`,
                                                        padding: '2px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 800,
                                                        display: 'inline-flex', alignItems: 'center', gap: 3,
                                                    }}>
                                                        <i className="material-icons-round" style={{ fontSize: 12 }}>{m.icon}</i>
                                                        {m.label}
                                                    </span>
                                                </td>
                                                <td style={tdc}>{a.catId ? catLabel(a.catId) : '—'}</td>
                                                <td style={tdc}>{[a.aletId, a.panelId].filter(Boolean).join(' / ') || '—'}</td>
                                                <td style={tdc}>
                                                    {a.routePrefix && a.compId ? (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); navigate(`${a.routePrefix}/hakem-karnesi?comp=${a.compId}&tab=fig&judge=${encodeURIComponent(r.adSoyad)}`); }}
                                                            style={btn(m.color, false, true)}>
                                                            <i className="material-icons-round" style={{ fontSize: 13, verticalAlign: 'middle', marginRight: 2 }}>open_in_new</i>
                                                            Karne
                                                        </button>
                                                    ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                                                </td>
                                                <td style={tdc}>
                                                    {a.manual ? (
                                                        <button onClick={(e) => { e.stopPropagation(); onDeleteGorev && onDeleteGorev(a); }}
                                                            title="Bu görevi sil"
                                                            style={{ background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: 6, padding: '3px 6px', cursor: 'pointer' }}>
                                                            <i className="material-icons-round" style={{ fontSize: 14 }}>delete</i>
                                                        </button>
                                                    ) : (
                                                        <span title="Yarışma kaydından geliyor — silmek için ilgili yarışmadan kaldırın" style={{ color: '#cbd5e1', fontSize: 16 }}>🔒</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}

function Kpi({ color, icon, label, value }) {
    return (
        <div style={{
            background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
            padding: '0.85rem 1rem', borderLeft: `4px solid ${color}`,
            display: 'flex', alignItems: 'center', gap: 12,
        }}>
            <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: color + '18', color, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
                <i className="material-icons-round" style={{ fontSize: 22 }}>{icon}</i>
            </div>
            <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
                <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#0f172a', lineHeight: 1.1 }}>{value}</div>
            </div>
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
// Banner içi butonlar
const primaryBtn = (disabled) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '0.55rem 1rem', borderRadius: 8, border: 'none',
    background: disabled ? 'rgba(255,255,255,0.25)' : '#fff',
    color: disabled ? 'rgba(255,255,255,0.7)' : '#4F46E5',
    fontWeight: 800, fontSize: 13, cursor: disabled ? 'default' : 'pointer',
    boxShadow: disabled ? 'none' : '0 2px 6px rgba(0,0,0,0.12)',
});
// Form input stili
const inp = {
    width: '100%', padding: '0.5rem 0.7rem', borderRadius: 8,
    border: '1px solid #cbd5e1', fontSize: 13, outline: 'none', background: '#fff',
};
// Modal stilleri
const modalCard = {
    background: '#fff', borderRadius: 12, minWidth: 340, maxWidth: 520,
    boxShadow: '0 18px 48px rgba(0,0,0,0.25)', overflow: 'hidden',
};
const modalHead = (color) => ({
    background: color, color: '#fff', padding: '0.9rem 1.2rem',
    display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 15,
});
const modalFoot = {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    padding: '0.8rem 1.2rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0',
};
const ghostBtn = (disabled) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '0.55rem 1rem', borderRadius: 8,
    border: '1.5px solid rgba(255,255,255,0.5)',
    background: 'transparent', color: '#fff',
    fontWeight: 700, fontSize: 13, cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.55 : 1,
});
