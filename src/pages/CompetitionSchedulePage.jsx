/**
 * CompetitionSchedulePage — Adım Adım Yarışma Planlama
 *
 * Akış (tek sayfa, numaralı bölümler):
 *  1) Hangi kategoriler yarışacak?  (checkbox)
 *  2) Hangi kategori hangi gün ve kaçta başlasın? (kategori başına gün+saat)
 *  3) Günlerin başlangıç/bitiş penceresi  (her gün için)
 *  4) Alet bazında sporcu başına dakika  (klasik rotasyonda max-bound)
 *  5) Önizleme + "Planı Oluştur"
 *
 *  Oluşturma → program node'una yazılır. Plan ayarları planAyarlari node'unda saklanır.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, set, update, remove, get, push } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { useDiscipline } from '../lib/DisciplineContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { logAction } from '../lib/auditLogger';
import { generateSchedulePDFv2 } from '../utils/schedulePDFv2';
import { RITMIK_CATEGORIES } from '../data/ritmikCriteriaDefaults';
import './CompetitionSchedulePage.css';

/* ── Sabitler & Yardımcılar ───────────────────────────────────────────── */
const ALET_LABELS = {
    atlama: 'Atlama', barfiks: 'Barfiks', halka: 'Halka', kulplu: 'Kulplu Beygir',
    mantar: 'Mantar Beygir', paralel: 'Paralel', yer: 'Yer', denge: 'Denge',
    asimetrik: 'Asimetrik Paralel', serbest: 'Serbest', sirik: 'Sırık',
    top: 'Top', kurdele: 'Kurdele',
};
const aletLabel = (k) => ALET_LABELS[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : '');
const catLabel = (catKey) => String(catKey || '').split('_')
    .map(w => w ? w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1) : w).join(' ');

const OLIMPIK_KIZ = ['atlama', 'asimetrik', 'denge', 'yer', 'serbest'];
const OLIMPIK_ERKEK = ['yer', 'kulplu', 'mantar', 'halka', 'atlama', 'paralel', 'barfiks', 'sirik'];
function olimpikSira(catKey, aletler) {
    const isKiz = /kiz|kız/i.test(String(catKey));
    const r = isKiz ? OLIMPIK_KIZ : OLIMPIK_ERKEK;
    const ordered = r.filter(a => aletler.includes(a));
    const extra = aletler.filter(a => !ordered.includes(a));
    return [...ordered, ...extra];
}

const SESSION_LABELS = { bekliyor: 'Bekliyor', devam: 'Devam', tamamlandi: 'Tamamlandı' };
const SESSION_COLORS = { bekliyor: '#94A3B8', devam: '#2563EB', tamamlandi: '#16A34A' };

const DEFAULT_ALET_DK = {
    yer: 2.5, atlama: 1.0, paralel: 2.0, barfiks: 2.0, kulplu: 2.5, halka: 2.5,
    mantar: 2.0, denge: 2.5, asimetrik: 2.0, serbest: 2.5, sirik: 2.0,
    top: 2.0, kurdele: 2.0,
};

function dateRange(start, end) {
    const days = [];
    if (!start) return days;
    const s = new Date(start), e = new Date(end || start);
    if (isNaN(s) || isNaN(e)) return days;
    const cur = new Date(s);
    while (cur <= e) { days.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 1); }
    return days;
}
function fmtDate(d) {
    if (!d) return '';
    const x = new Date(d);
    return isNaN(x) ? d : x.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
}
function hmToMin(t) {
    if (!t || !/^\d{1,2}:\d{2}/.test(t)) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}
function minToHm(min) {
    min = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
    const h = Math.floor(min / 60), m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function distributeGroups(athleteIds, k) {
    const groups = Array.from({ length: k }, () => []);
    athleteIds.forEach((a, i) => groups[i % k].push(a));
    return groups;
}

// Yeni: N sporcuyu groupCount kadar gruba böl (sıralı blok-bölme)
function splitIntoGroups(athleteIds, groupCount) {
    if (groupCount <= 0) return [];
    const groups = Array.from({ length: groupCount }, () => []);
    if (athleteIds.length === 0) return groups;
    const size = Math.ceil(athleteIds.length / groupCount);
    athleteIds.forEach((id, i) => {
        const gi = Math.min(groupCount - 1, Math.floor(i / size));
        groups[gi].push(id);
    });
    return groups;
}

// Toplam grup sayısını hesapla: K'nın katları olacak şekilde, hedef grup büyüklüğüne göre.
// targetSize ~ kullanıcının istediği (default 6) sporcu/grup.
function calcGroupCount(N, K, targetSize) {
    if (K === 0) return 0;
    let g = Math.max(K, Math.ceil((N || 0) / Math.max(1, targetSize)));
    return Math.ceil(g / K) * K; // K'nın katı
}
const groupAt = (alet_i, rotation_r, K) => ((alet_i - rotation_r) % K + K) % K;
const GROUP_LETTER = (i) => String.fromCharCode(65 + i);
const GROUP_COLOR = ['#6366F1', '#F59E0B', '#10B981', '#EC4899', '#0EA5E9', '#A855F7', '#EF4444', '#84CC16'];

/* ── Sayfa ────────────────────────────────────────────────────────────── */
export default function CompetitionSchedulePage() {
    const navigate = useNavigate();
    const { currentUser } = useAuth();
    const { toast, confirm } = useNotification();
    const { firebasePath, routePrefix, label: disciplineLabel } = useDiscipline();

    const [competitions, setCompetitions] = useState({});
    const [selectedCompId, setSelectedCompId] = useState('');
    const [sessions, setSessions] = useState({});
    const [siralama, setSiralama] = useState({});
    const [savedConfig, setSavedConfig] = useState(null);

    // Wizard config
    const [planConfig, setPlanConfig] = useState({
        selectedCats: [],
        catSettings: {},   // {catKey: {gunIndex, baslangic, isinmaDk, odulDk}}
        daySettings: {},   // {gunIndex: {baslangic, bitis, araBaslangic, araBitis, odulSuresi}}
        aletDk: {},        // {alet: dk}
        grupBuyukluğu: 6,  // hedef sporcu/grup
        bloklarArasiDk: 5, // bloklar arası geçiş
    });

    const [activeDay, setActiveDay] = useState(0);
    const [expanded, setExpanded] = useState(new Set());
    const [generating, setGenerating] = useState(false);
    const [pdfBusy, setPdfBusy] = useState(false);

    const exportPdf = async () => {
        if (!Object.keys(sessions).length) {
            toast('Önce planı oluşturun.', 'warning');
            return;
        }
        setPdfBusy(true);
        try {
            const athleteCounts = {};
            Object.keys(comp?.kategoriler || {}).forEach(k => {
                athleteCounts[k] = Object.keys(comp?.sporcular?.[k] || {}).length;
            });
            await generateSchedulePDFv2({
                comp,
                days,
                sessions,
                daySettings: planConfig.daySettings,
                kategoriler,
                athleteCounts,
            });
            toast('PDF indirildi.', 'success');
        } catch (e) {
            toast('PDF üretirken hata oluştu.', 'error');
        } finally {
            setPdfBusy(false);
        }
    };

    /* ── Yarışmalar ── */
    useEffect(() => {
        const u = onValue(ref(db, firebasePath), s => {
            setCompetitions(filterCompetitionsByUser(s.val() || {}, currentUser));
        });
        return () => u();
    }, [firebasePath, currentUser]);

    /* ── Seçili yarışma: program + siralama + planAyarlari ── */
    useEffect(() => {
        if (!selectedCompId) {
            setSessions({}); setSiralama({}); setSavedConfig(null);
            setPlanConfig({ selectedCats: [], catSettings: {}, daySettings: {}, aletDk: {} });
            return;
        }
        const u1 = onValue(ref(db, `${firebasePath}/${selectedCompId}/program`), s => setSessions(s.val() || {}));
        get(ref(db, `${firebasePath}/${selectedCompId}/siralama`)).then(s => setSiralama(s.val() || {}));
        get(ref(db, `${firebasePath}/${selectedCompId}/planAyarlari`)).then(s => {
            const cfg = s.val();
            if (cfg) {
                setSavedConfig(cfg);
                setPlanConfig({
                    selectedCats: cfg.selectedCats || [],
                    catSettings: cfg.catSettings || {},
                    daySettings: cfg.daySettings || {},
                    aletDk: cfg.aletDk || {},
                    grupBuyukluğu: cfg.grupBuyukluğu ?? 6,
                    bloklarArasiDk: cfg.bloklarArasiDk ?? 5,
                });
            }
        });
        return () => u1();
    }, [firebasePath, selectedCompId]);

    const comp = competitions[selectedCompId];
    // Ritmik için kategoriler tablosunu in-memory olarak defaults ile override et —
    // DB'deki aletler henüz güncellenmemiş olsa bile planlama doğru K=1 ile çalışsın.
    const kategoriler = useMemo(() => {
        const raw = comp?.kategoriler || {};
        const isRitmik = firebasePath === 'ritmik_yarismalar' || (firebasePath || '').includes('ritmik');
        if (!isRitmik) return raw;
        const overridden = {};
        Object.entries(raw).forEach(([catKey, catData]) => {
            const defaults = RITMIK_CATEGORIES[catKey];
            if (defaults && Array.isArray(defaults.aletler) && defaults.aletler.length > 0) {
                overridden[catKey] = { ...catData, aletler: defaults.aletler };
            } else {
                overridden[catKey] = catData;
            }
        });
        return overridden;
    }, [comp, firebasePath]);

    /* ── Ritmik: kategorilerin aletlerini defaults ile otomatik senkronla ── */
    // (Defaults dosyası değişince mevcut yarışmaya otomatik yansıması için.)
    useEffect(() => {
        if (!selectedCompId || !comp?.kategoriler) return;
        const isRitmik = firebasePath === 'ritmik_yarismalar' || firebasePath?.includes('ritmik');
        if (!isRitmik) return;
        const updates = {};
        Object.entries(comp.kategoriler).forEach(([catKey, catData]) => {
            const defaults = RITMIK_CATEGORIES[catKey];
            if (!defaults || !Array.isArray(defaults.aletler)) return;
            const cur = Array.isArray(catData.aletler) ? catData.aletler : [];
            const same = cur.length === defaults.aletler.length && cur.every((a, i) => a === defaults.aletler[i]);
            if (!same) {
                updates[`${firebasePath}/${selectedCompId}/kategoriler/${catKey}/aletler`] = defaults.aletler;
            }
        });
        if (Object.keys(updates).length > 0) {
            update(ref(db), updates).catch(() => {});
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCompId, comp?.kategoriler]);
    const days = useMemo(() => dateRange(comp?.baslangicTarihi || comp?.tarih, comp?.bitisTarihi), [comp]);

    // İlk yüklemede / yarışma değişince default değerleri doldur
    useEffect(() => {
        if (!comp || days.length === 0) return;
        setPlanConfig(prev => {
            const next = { ...prev };
            // Day settings — boşları doldur
            const ds = { ...prev.daySettings };
            days.forEach((_, i) => {
                if (!ds[i]) ds[i] = { baslangic: '09:00', bitis: '17:00' };
            });
            next.daySettings = ds;
            // Alet defaults — seçili kategorilerin aletleri için
            const aletDk = { ...prev.aletDk };
            const allAletler = new Set();
            Object.values(kategoriler).forEach(kc => (kc.aletler || []).forEach(a => allAletler.add(a)));
            allAletler.forEach(a => {
                if (aletDk[a] == null) aletDk[a] = DEFAULT_ALET_DK[a] ?? 2.0;
            });
            next.aletDk = aletDk;
            return next;
        });
    }, [comp, kategoriler, days]);

    /* ── Sporcu sayısı (kategori bazında) ── */
    const catAthleteCount = useCallback((catKey) => {
        const sp = comp?.sporcular?.[catKey];
        if (!sp || typeof sp !== 'object') return 0;
        return Object.keys(sp).length;
    }, [comp]);

    /* ── Önceden gruplanmış mı? — sporcuların rotasyonGrubu alanına bakılır ── */
    const catGroupInfo = useCallback((catKey) => {
        const sp = comp?.sporcular?.[catKey] || {};
        const ids = Object.keys(sp);
        const N = ids.length;
        if (N === 0) return { N: 0, groups: [], groupCount: 0, groupSize: 0, source: 'empty' };
        // rotasyonGrubu varsa önceden gruplanmış demektir
        const byGrup = {};
        let withGrup = 0;
        ids.forEach(id => {
            const g = sp[id]?.rotasyonGrubu;
            if (g != null && g !== '') {
                const gk = String(g);
                (byGrup[gk] = byGrup[gk] || []).push(id);
                withGrup++;
            }
        });
        // Çoğunluğu (>=%50) gruplanmışsa o gruplamayı kullan
        if (withGrup >= N * 0.5) {
            const sortedEntries = Object.entries(byGrup)
                .sort(([a], [b]) => (Number(a) || 0) - (Number(b) || 0));
            const groups = sortedEntries.map(([, list]) => list);
            // Çıkış Sırası 0-tabanlı rotasyonGrubu yazar (0,1,2,...); kullanıcıya
            // 1-tabanlı göstermek için sayısal etiketler +1 ile gösterilir.
            const groupLabels = sortedEntries.map(([k]) => {
                const n = Number(k);
                return Number.isFinite(n) && k !== '' ? String(n + 1) : String(k);
            });
            const grouped = new Set(groups.flat());
            const orphans = ids.filter(id => !grouped.has(id));
            if (orphans.length && groups.length) groups[groups.length - 1].push(...orphans);
            else if (orphans.length) { groups.push(orphans); groupLabels.push('?'); }
            const groupCount = groups.length;
            const groupSize = Math.max(...groups.map(g => g.length));
            return { N, groups, groupLabels, groupCount, groupSize, source: 'precomputed' };
        }
        // Otomatik: targetSize'a göre
        const K = (kategoriler[catKey]?.aletler || []).length;
        if (K === 0) return { N, groups: [ids], groupLabels: ['1'], groupCount: 1, groupSize: N, source: 'auto' };
        const targetSize = Math.max(1, planConfig.grupBuyukluğu || 6);
        let groupCount = calcGroupCount(N, K, targetSize);
        if (groupCount === 0) groupCount = K;
        const groupSize = Math.ceil(N / groupCount);
        const groups = splitIntoGroups(ids, groupCount);
        const groupLabels = groups.map((_, i) => String(i + 1));
        return { N, groups, groupLabels, groupCount, groupSize, source: 'auto' };
    }, [comp, kategoriler, planConfig.grupBuyukluğu]);

    const getCatAthletes = useCallback(async (catKey) => {
        const sira = siralama?.[catKey];
        if (sira && typeof sira === 'object') {
            const out = new Set();
            const walk = (node) => {
                if (!node || typeof node !== 'object') return;
                Object.entries(node).forEach(([k, v]) => {
                    if (typeof v === 'object' && v && (v.ad || v.adSoyad || v.soyadAd || v.lisansNo)) out.add(k);
                    else walk(v);
                });
            };
            walk(sira);
            if (out.size > 0) return [...out];
        }
        const snap = await get(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${catKey}`));
        return Object.keys(snap.val() || {});
    }, [firebasePath, selectedCompId, siralama]);

    /* ── Tahmini süre hesabı (blok modeli) ──
     * K alet → K grup aynı anda dönüp K rotasyonda bitirir (= 1 BLOK).
     * Sporcu sayısı / hedef grup büyüklüğüne göre toplam grup sayısı belirlenir;
     * her blok K grup içerir. Sonraki blok bekler, geçiş süresi eklenir.
     */
    const estimateDuration = useCallback((catKey, settings) => {
        const aletler = (kategoriler[catKey]?.aletler || []).slice();
        if (aletler.length === 0) return null;
        const sira = olimpikSira(catKey, aletler);
        const K = sira.length;
        const info = catGroupInfo(catKey);
        const N = info.N;
        const groupCount = Math.max(K, info.groupCount || K);
        const blockCount = Math.ceil(groupCount / K);
        const actualSize = info.groupSize || (N > 0 ? Math.ceil(N / groupCount) : 0);

        // Bir rotasyonda K grup paralel çalışır; rotasyon süresi en uzun alete bağlı
        const maxAletDk = Math.max(...sira.map(a => planConfig.aletDk[a] || DEFAULT_ALET_DK[a] || 2));
        const rotationMin = actualSize * maxAletDk;
        const blockMin = K * rotationMin;
        const transitionDk = Math.max(0, planConfig.bloklarArasiDk ?? 5);

        const isinma = settings?.isinmaDk ?? 15;
        const odul = settings?.odulDk ?? 10;
        const total = Math.max(1, Math.round(
            blockCount * blockMin + Math.max(0, blockCount - 1) * transitionDk + isinma + odul
        ));
        return {
            K, N, groupCount, blockCount, actualSize,
            aletler: sira,
            rotationMin: Math.round(rotationMin),
            blockMin: Math.round(blockMin),
            total,
            source: info.source, // 'precomputed' | 'auto' | 'empty'
        };
    }, [kategoriler, planConfig.aletDk, planConfig.bloklarArasiDk, catGroupInfo]);

    /* ── FİZİBİLİTE: bir blok günün penceresine sığıyor mu? ─────────────── */
    const feasibility = useMemo(() => {
        if (planConfig.selectedCats.length === 0 || days.length === 0) return null;
        const minDayWindow = Math.min(...days.map((_, i) => {
            const ds = planConfig.daySettings?.[i] || {};
            const s = (ds.baslangic && /^\d{1,2}:\d{2}/.test(ds.baslangic)) ? ds.baslangic : '09:00';
            const e = (ds.bitis && /^\d{1,2}:\d{2}/.test(ds.bitis)) ? ds.bitis : '17:00';
            return Math.max(0, hmToMin(e) - hmToMin(s));
        }));
        let worst = null;
        for (const cat of planConfig.selectedCats) {
            const est = estimateDuration(cat, planConfig.catSettings[cat] || {});
            if (est && est.blockMin > 0) {
                if (!worst || est.blockMin > worst.blockMin) worst = { cat, blockMin: est.blockMin, est };
            }
        }
        if (!worst) return null;
        const fits = worst.blockMin <= minDayWindow;
        return {
            fits,
            worstCat: worst.cat,
            blockMin: worst.blockMin,
            minDayWindow,
            // Sığması için önerilen grup büyüklüğü
            suggestedGroupSize: (() => {
                if (fits) return null;
                const aletler = (kategoriler[worst.cat]?.aletler || []);
                const K = aletler.length;
                const maxAletDk = Math.max(...aletler.map(a => planConfig.aletDk[a] || DEFAULT_ALET_DK[a] || 2));
                // block_dk = K × groupSize × maxAletDk ≤ minDayWindow
                // groupSize ≤ minDayWindow / (K × maxAletDk)
                return Math.max(1, Math.floor(minDayWindow / (K * maxAletDk)));
            })(),
        };
    }, [planConfig, days, kategoriler, estimateDuration]);

    /* ── BLOK BAZLI ZAMAN YÜRÜYÜCÜ ──
     * Bloklar atomik birimler; bir blok ister mevcut günde, ister sonraki
     * günde başlasın. Gün penceresi dolduğunda bir sonraki günün başlangıcına
     * atlanır ve oradan devam edilir. Bir kategori birden çok güne yayılabilir.
     *
     * Dönüş: her kategori için { perDay: { gunIndex: { baslangic, bitis,
     *        bloklar: [{bIdx, baslangic, bitis}], }}, overflow, est, ... }
     */
    const computeBlockPlacements = useCallback(() => {
        const results = [];
        const dayStartM = (d) => {
            const v = planConfig.daySettings?.[d]?.baslangic;
            return hmToMin((v && /^\d{1,2}:\d{2}/.test(v)) ? v : '09:00');
        };
        const dayEndM = (d) => {
            const v = planConfig.daySettings?.[d]?.bitis;
            const end = hmToMin((v && /^\d{1,2}:\d{2}/.test(v)) ? v : '17:00');
            // Ödül töreni günün sonundan ayrılır — efektif bitiş daha erken
            const odulS = Number(planConfig.daySettings?.[d]?.odulSuresi) || 0;
            return end - odulS;
        };
        // Öğle arası penceresi [araStart, araEnd]; ikisi de varsa cursor bu pencereyi atlar
        const lunchWindow = (d) => {
            const a = planConfig.daySettings?.[d]?.araBaslangic;
            const b = planConfig.daySettings?.[d]?.araBitis;
            if (!a || !b || !/^\d{1,2}:\d{2}/.test(a) || !/^\d{1,2}:\d{2}/.test(b)) return null;
            const ms = hmToMin(a), me = hmToMin(b);
            return me > ms ? { ms, me } : null;
        };
        // cursor + duration aralığı öğle arası ile çakışırsa cursor'u öğle sonrasına ittir
        const skipLunch = (d, c, duration) => {
            const lw = lunchWindow(d);
            if (!lw) return c;
            // [c, c+duration] ile [ms, me] çakışıyor mu?
            if (c < lw.me && c + duration > lw.ms) {
                return lw.me; // öğle bitişine atla
            }
            return c;
        };

        // Sıralama: gunIndex+baslangic
        const orderedCats = [...planConfig.selectedCats].sort((A, B) => {
            const a = planConfig.catSettings[A] || {};
            const b = planConfig.catSettings[B] || {};
            const dA = a.gunIndex ?? 0, dB = b.gunIndex ?? 0;
            if (dA !== dB) return dA - dB;
            return hmToMin(a.baslangic || '09:00') - hmToMin(b.baslangic || '09:00');
        });

        for (const cat of orderedCats) {
            const s = planConfig.catSettings[cat] || {};
            const est = estimateDuration(cat, s);
            if (!est) { results.push({ cat, error: 'Alet yok.', perDay: {} }); continue; }
            const { K, blockCount, blockMin } = est;
            const isinma = s.isinmaDk ?? 15;
            const odul = s.odulDk ?? 10;
            const blokArasi = planConfig.bloklarArasiDk ?? 5;

            // HER KATEGORİ BAĞIMSIZ — paralel salon/platform
            let dayIdx = Math.min(Math.max(0, s.gunIndex ?? 0), Math.max(0, days.length - 1));
            let cursor = dayStartM(dayIdx);
            const userStart = hmToMin(s.baslangic || '');
            if (userStart && userStart > cursor) cursor = userStart;

            // Isınma için yer aç; ısınma + ilk blok sığmıyorsa sonraki güne atla
            while (cursor + isinma + blockMin > dayEndM(dayIdx) && dayIdx + 1 < days.length) {
                dayIdx++;
                cursor = dayStartM(dayIdx);
            }
            // Isınma öğle arasıyla çakışıyorsa öğle sonrasına atla
            cursor = skipLunch(dayIdx, cursor, isinma);
            cursor += isinma;

            const perDay = {};
            let overflow = false;
            let placedBlocks = 0;
            for (let b = 0; b < blockCount; b++) {
                if (b > 0) {
                    // Bloklar arası geçiş; sığmazsa sonraki güne atla (geçişsiz)
                    if (cursor + blokArasi + blockMin > dayEndM(dayIdx) && dayIdx + 1 < days.length) {
                        dayIdx++;
                        cursor = dayStartM(dayIdx);
                    } else {
                        cursor += blokArasi;
                    }
                }
                // Blok öğle arasıyla çakışıyorsa öğle sonrasına atla
                cursor = skipLunch(dayIdx, cursor, blockMin);
                // Tek blok hâlâ sığmıyorsa sonraki güne
                while (cursor + blockMin > dayEndM(dayIdx) && dayIdx + 1 < days.length) {
                    dayIdx++;
                    cursor = dayStartM(dayIdx);
                    cursor = skipLunch(dayIdx, cursor, blockMin);
                }
                // Eğer tek blok herhangi bir güne SIĞMIYORSA (blockMin > dayWindow)
                // YA DA son güne bile sığmıyorsa, durur ve overflow işaretler.
                if (cursor + blockMin > dayEndM(dayIdx)) {
                    overflow = true;
                    break; // sonraki blokları yerleştirmeye çalışma
                }
                const bStart = cursor;
                cursor += blockMin;
                const bEnd = cursor;
                // Bu blokta hangi gruplar var: K, K+1, ...
                const blockGroups = [];
                for (let g = 0; g < K; g++) {
                    const gIdx = b * K + g;
                    blockGroups.push(gIdx); // indeks; etiket için groupLabels kullanılacak
                }
                if (!perDay[dayIdx]) perDay[dayIdx] = { baslangic: minToHm(bStart), bitis: minToHm(bEnd), bloklar: [], gruplar: [] };
                perDay[dayIdx].bitis = minToHm(bEnd);
                perDay[dayIdx].bloklar.push({ bIdx: b, baslangic: minToHm(bStart), bitis: minToHm(bEnd), gruplar: blockGroups });
                perDay[dayIdx].gruplar.push(...blockGroups);
                placedBlocks++;
            }
            cursor += odul; // ödül sonraki kategoriden önce
            results.push({
                cat, est, perDay, overflow, totalBlocks: blockCount, placedBlocks,
                unplacedBlocks: blockCount - placedBlocks,
            });
        }
        return results;
    }, [planConfig, estimateDuration, days]);

    /* ── ESKİ computePlacements (geriye dönük; bazı yerlerde hâlâ kullanılabilir) ── */
    const computePlacements = useCallback(() => {
        const gap = 10;
        const placements = [];
        const cursorByDay = {};
        // Gün başı/bitiş — undefined / null / boş string güvenli
        const dayStart = (d) => {
            const v = planConfig.daySettings?.[d]?.baslangic;
            return (v && /^\d{1,2}:\d{2}/.test(v)) ? v : '09:00';
        };
        const dayEnd = (d) => {
            const v = planConfig.daySettings?.[d]?.bitis;
            return (v && /^\d{1,2}:\d{2}/.test(v)) ? v : '17:00';
        };

        // Kategorileri kullanıcının tercih ettiği (gün, başlangıç) sırasına göre yerleştir
        const orderedCats = [...planConfig.selectedCats].sort((A, B) => {
            const a = planConfig.catSettings[A] || {};
            const b = planConfig.catSettings[B] || {};
            const dA = a.gunIndex ?? 0, dB = b.gunIndex ?? 0;
            if (dA !== dB) return dA - dB;
            return hmToMin(a.baslangic || '09:00') - hmToMin(b.baslangic || '09:00');
        });

        for (const cat of orderedCats) {
            const s = planConfig.catSettings[cat] || {};
            const est = estimateDuration(cat, s);
            if (!est) { placements.push({ cat, error: 'Bu kategoride alet yok.' }); continue; }

            // Kullanıcının istediği gün
            let dayIdx = Math.min(Math.max(0, s.gunIndex ?? 0), Math.max(0, days.length - 1));
            if (cursorByDay[dayIdx] == null) cursorByDay[dayIdx] = hmToMin(dayStart(dayIdx));

            // Başlangıç: cursor ile kullanıcının baslangici'nin max'ı
            let startMin = cursorByDay[dayIdx];
            const userStart = hmToMin(s.baslangic || '');
            if (userStart && userStart > startMin) startMin = userStart;

            // Sığmıyorsa sonraki güne kaydır
            let shifted = false;
            const requestedDay = dayIdx;
            while (startMin + est.total > hmToMin(dayEnd(dayIdx)) && dayIdx + 1 < days.length) {
                dayIdx++;
                shifted = true;
                if (cursorByDay[dayIdx] == null) cursorByDay[dayIdx] = hmToMin(dayStart(dayIdx));
                startMin = cursorByDay[dayIdx];
            }

            const bitis = minToHm(startMin + est.total);
            placements.push({
                cat, est, gunIndex: dayIdx,
                baslangic: minToHm(startMin),
                bitis,
                isinma: s.isinmaDk ?? 15, odul: s.odulDk ?? 10,
                shifted, requestedDay,
                overflow: (startMin + est.total > hmToMin(dayEnd(dayIdx))),
            });
            cursorByDay[dayIdx] = startMin + est.total + gap;
        }
        return placements;
    }, [planConfig, estimateDuration, days]);

    /* ── Ön izleme: BLOK BAZLI çoklu-gün yerleştirme ── */
    const previews = useMemo(() => {
        return computeBlockPlacements().map(r => {
            if (r.error) return { cat: r.cat, error: r.error, placements: [] };
            const info = catGroupInfo(r.cat);
            const labels = info.groupLabels || [];
            const placements = Object.entries(r.perDay)
                .map(([gi, d]) => ({
                    gunIndex: +gi,
                    baslangic: d.baslangic,
                    bitis: d.bitis,
                    bloklar: d.bloklar,
                    gruplar: d.gruplar, // indeksler
                    grupEtiketleri: (d.gruplar || []).map(gi => labels[gi] || String(gi + 1)),
                }))
                .sort((a, b) => a.gunIndex - b.gunIndex);
            const first = placements[0] || {};
            const last = placements[placements.length - 1] || {};
            return {
                cat: r.cat, est: r.est, placements, overflow: r.overflow, totalBlocks: r.totalBlocks,
                groupLabels: labels,
                gunIndex: first.gunIndex,
                baslangic: first.baslangic,
                bitis: last.bitis,
                lastGun: last.gunIndex,
                spansMultipleDays: placements.length > 1,
                isinma: 0, odul: 0,
            };
        });
    }, [computeBlockPlacements, catGroupInfo]);

    /* ── Uyarılar (çakışma / gün penceresi taşma) ── */
    const warnings = useMemo(() => {
        const w = [];
        // Bilgi: paralel kategori sayısı (farklı platformlar varsayılır)
        const byDay = {};
        previews.forEach(p => {
            if (p.error || !p.placements) return;
            p.placements.forEach(pp => {
                (byDay[pp.gunIndex] = byDay[pp.gunIndex] || []).push({ cat: p.cat, baslangic: pp.baslangic, bitis: pp.bitis });
            });
        });
        Object.entries(byDay).forEach(([gi, arr]) => {
            arr.sort((a, b) => hmToMin(a.baslangic) - hmToMin(b.baslangic));
            const parallels = new Set();
            for (let i = 0; i < arr.length; i++) {
                for (let j = i + 1; j < arr.length; j++) {
                    const a = arr[i], b = arr[j];
                    if (hmToMin(a.bitis) > hmToMin(b.baslangic) && hmToMin(b.bitis) > hmToMin(a.baslangic) && a.cat !== b.cat) {
                        parallels.add(`${catLabel(a.cat)} ↔ ${catLabel(b.cat)}`);
                    }
                }
            }
            if (parallels.size > 0) {
                w.push({
                    kind: 'parallel',
                    text: `${days[gi] ? fmtDate(days[gi]) : (+gi + 1) + '. Gün'}: paralel platformlarda eş zamanlı kategoriler — ${[...parallels].join(', ')}`,
                });
            }
        });
        // Çoklu güne yayılan + tamamen taşan kategoriler
        previews.forEach(p => {
            if (p.error) return;
            if (p.overflow) {
                w.push({ kind: 'overflow', text: `${catLabel(p.cat)} son güne bile sığmıyor — gün penceresini genişletin veya alet sürelerini azaltın.` });
            }
            if (p.spansMultipleDays) {
                const gunler = p.placements.map(pp => pp.gunIndex + 1).join(', ');
                w.push({ kind: 'shift', text: `${catLabel(p.cat)} kategorisi ${p.placements.length} güne yayıldı (Gün: ${gunler}).` });
            }
        });
        // Sporcu yoksa
        previews.forEach(p => {
            if (p.error) return;
            if ((p.est?.N ?? 0) === 0) {
                w.push({ kind: 'bos', text: `${catLabel(p.cat)} kategorisinde sporcu yok — yine de seans oluşturulur.` });
            }
        });
        return w;
    }, [previews, days, planConfig.daySettings]);

    /* ── Wizard event handler'ları ── */
    const toggleCat = (catKey) => {
        setPlanConfig(prev => {
            const sel = new Set(prev.selectedCats);
            const settings = { ...prev.catSettings };
            if (sel.has(catKey)) {
                sel.delete(catKey);
                delete settings[catKey];
            } else {
                sel.add(catKey);
                if (!settings[catKey]) {
                    settings[catKey] = { gunIndex: 0, baslangic: '09:00', isinmaDk: 15, odulDk: 10 };
                }
            }
            return { ...prev, selectedCats: [...sel], catSettings: settings };
        });
    };

    const updateCatSetting = (catKey, field, val) => {
        setPlanConfig(prev => ({
            ...prev,
            catSettings: { ...prev.catSettings, [catKey]: { ...prev.catSettings[catKey], [field]: val } },
        }));
    };
    const updateDaySetting = (gi, field, val) => {
        setPlanConfig(prev => ({
            ...prev,
            daySettings: { ...prev.daySettings, [gi]: { ...prev.daySettings[gi], [field]: val } },
        }));
    };
    const updateAletDk = (alet, val) => {
        setPlanConfig(prev => ({ ...prev, aletDk: { ...prev.aletDk, [alet]: val } }));
    };

    /* ── Akıllı yardım: kategorileri günün başlangıcından itibaren otomatik dizmek ── */
    // Aynı günde sırayla diz — gün penceresi dolarsa sonraki güne otomatik geçer
    const autoStaggerStartTimes = () => {
        const gap = 10; // dk
        setPlanConfig(prev => {
            const next = { ...prev, catSettings: { ...prev.catSettings } };
            const dayStart = (d) => prev.daySettings[d]?.baslangic || '09:00';
            const dayEnd = (d) => prev.daySettings[d]?.bitis || '17:00';

            // Mevcut kullanıcı seçimine saygılı: önce kullanıcının atadığı güne yerleştirmeyi dene,
            // o güne sığmazsa sonraki güne taşı. Sırayı korumak için selectedCats sırasını kullan.
            const cursorByDay = {}; // gunIndex -> dakika
            let lastDayIdx = 0;

            for (const cat of prev.selectedCats) {
                const est = estimateDuration(cat, prev.catSettings[cat]);
                if (!est) continue;
                // Başlangıç olarak istenen gün (varsa)
                let dayIdx = prev.catSettings[cat]?.gunIndex ?? lastDayIdx;
                if (dayIdx >= days.length) dayIdx = days.length - 1;

                // O güne başla — günün üstüne (sayfada başka kategori eklenmediyse) dayStart
                if (cursorByDay[dayIdx] == null) cursorByDay[dayIdx] = hmToMin(dayStart(dayIdx));

                // Sığmıyorsa sonraki güne kaydır
                while (cursorByDay[dayIdx] + est.total > hmToMin(dayEnd(dayIdx)) && dayIdx + 1 < days.length) {
                    dayIdx++;
                    if (cursorByDay[dayIdx] == null) cursorByDay[dayIdx] = hmToMin(dayStart(dayIdx));
                }

                next.catSettings[cat] = {
                    ...next.catSettings[cat],
                    gunIndex: dayIdx,
                    baslangic: minToHm(cursorByDay[dayIdx]),
                };
                cursorByDay[dayIdx] += est.total + gap;
                lastDayIdx = dayIdx;
            }
            return next;
        });
        toast('Kategoriler güne sığmazsa sonraki güne taşınarak otomatik dizildi.', 'success');
    };

    // ROUND-ROBIN dağıtım: cat1→gün1, cat2→gün2, cat3→gün1, cat4→gün2…
    // Kapasiteden bağımsız olarak günlere serpiştirir. Her gün içinde
    // kategoriler sıralı olarak başlangıç saatleriyle yerleşir.
    const autoDistributeAllDays = () => {
        if (planConfig.selectedCats.length === 0) {
            toast('Önce kategori seçin.', 'warning'); return;
        }
        if (days.length === 0) {
            toast('Yarışmaya tarih atayın.', 'warning'); return;
        }
        const gap = 10;
        setPlanConfig(prev => {
            const next = { ...prev, catSettings: { ...prev.catSettings } };
            const dayStart = (d) => {
                const v = prev.daySettings?.[d]?.baslangic;
                return (v && /^\d{1,2}:\d{2}/.test(v)) ? v : '09:00';
            };

            // 1) Kategorileri round-robin günlere böl
            const catsByDay = days.map(() => []);
            prev.selectedCats.forEach((cat, idx) => {
                const dayIdx = idx % days.length;
                catsByDay[dayIdx].push(cat);
            });

            // 2) Her gün için sıralı yerleştir (cursor günün başlangıcından)
            catsByDay.forEach((catsOfDay, dayIdx) => {
                let cursor = hmToMin(dayStart(dayIdx));
                catsOfDay.forEach(cat => {
                    const settings = prev.catSettings[cat] || {};
                    const est = estimateDuration(cat, settings);
                    const dur = Math.max(1, est?.total || 25);
                    next.catSettings[cat] = {
                        ...settings,
                        gunIndex: dayIdx,
                        baslangic: minToHm(cursor),
                    };
                    cursor += dur + gap;
                });
            });
            return next;
        });
        toast(`Kategoriler ${days.length} güne dağıtıldı (round-robin).`, 'success');
    };

    /* ── Planı oluştur — program node'una yaz ── */
    const buildAndSavePlan = async () => {
        if (planConfig.selectedCats.length === 0) {
            toast('En az bir kategori seçin.', 'warning');
            return;
        }
        const ok = await confirm('Mevcut program silinip yeniden oluşturulacak. Onaylıyor musunuz?');
        if (!ok) return;
        setGenerating(true);
        try {
            // Plan ayarlarını kaydet
            await set(ref(db, `${firebasePath}/${selectedCompId}/planAyarlari`), planConfig);

            // Eski programı sil ve yeniden yaz — placement'lardan otomatik gün-yerleştirmesiyle
            await remove(ref(db, `${firebasePath}/${selectedCompId}/program`));

            // YENİ: blok-bazlı çoklu-gün placements
            const blockPlacements = computeBlockPlacements();
            const newProgram = {};
            let spannedCount = 0;
            for (const pl of blockPlacements) {
                if (pl.error) continue;
                const cat = pl.cat;
                const kc = kategoriler[cat];
                if (!kc || !(kc.aletler || []).length) continue;
                const aletler = olimpikSira(cat, kc.aletler);
                const info = catGroupInfo(cat);
                const K = aletler.length;
                const groupCount = pl.est?.groupCount || Math.max(K, info.groupCount || K);
                const blockCount = Math.ceil(groupCount / K);
                // ÖNCE pre-grouped (rotasyonGrubu) varsa o gruplamayı kullan
                const gruplar = info.groups && info.groups.length === groupCount
                    ? info.groups
                    : splitIntoGroups(Object.keys(comp?.sporcular?.[cat] || {}), groupCount);
                const grupEtiketleri = info.groupLabels && info.groupLabels.length === gruplar.length
                    ? info.groupLabels
                    : gruplar.map((_, i) => String(i + 1));
                const dayKeys = Object.keys(pl.perDay).map(Number).sort((a, b) => a - b);
                if (dayKeys.length > 1) spannedCount++;
                for (const gi of dayKeys) {
                    const d = pl.perDay[gi];
                    const tarih = days[gi] || '';
                    const key = push(ref(db, `${firebasePath}/${selectedCompId}/program`)).key;
                    newProgram[key] = {
                        tarih, gunIndex: gi,
                        baslangic: d.baslangic, saat: d.baslangic,
                        bitis: d.bitis, bitisSaat: d.bitis,
                        kategori: cat,
                        aletler,
                        aletDk: aletler.reduce((acc, a) => { acc[a] = planConfig.aletDk[a] || DEFAULT_ALET_DK[a] || 2; return acc; }, {}),
                        sporcuSayisi: info.N,
                        gruplar,
                        grupEtiketleri,
                        grupSayisi: groupCount,
                        blokSayisi: blockCount,
                        grupBuyukluğu: pl.est?.actualSize || 0,
                        bugünBloklar: d.bloklar, // bu gündeki bloklar [{bIdx, baslangic, bitis}]
                        toplamBlok: blockCount,
                        çokGünlü: dayKeys.length > 1,
                        günSira: dayKeys.indexOf(gi) + 1, // bu kategorinin kaçıncı günü
                        günToplam: dayKeys.length,
                        isinmaDk: dayKeys.indexOf(gi) === 0 ? ((planConfig.catSettings[cat]?.isinmaDk) ?? 15) : 0,
                        odulDk: dayKeys.indexOf(gi) === dayKeys.length - 1 ? ((planConfig.catSettings[cat]?.odulDk) ?? 10) : 0,
                        rotasyonDk: pl.est?.rotationMin || 0,
                        blokDk: pl.est?.blockMin || 0,
                        bloklarArasiDk: planConfig.bloklarArasiDk ?? 5,
                        toplamDk: Math.max(0, hmToMin(d.bitis) - hmToMin(d.baslangic)),
                        durum: 'bekliyor',
                    };
                }
            }
            // ─── Öğle arası + Ödül töreni özel seansları ───
            days.forEach((tarih, gi) => {
                const ds = planConfig.daySettings?.[gi] || {};
                // Öğle arası
                if (ds.araBaslangic && ds.araBitis && /^\d{1,2}:\d{2}/.test(ds.araBaslangic) && /^\d{1,2}:\d{2}/.test(ds.araBitis)) {
                    const k = push(ref(db, `${firebasePath}/${selectedCompId}/program`)).key;
                    newProgram[k] = {
                        tip: 'ogle_arasi', tarih, gunIndex: gi,
                        baslangic: ds.araBaslangic, saat: ds.araBaslangic,
                        bitis: ds.araBitis, bitisSaat: ds.araBitis,
                        kategori: '__ogle__', aletler: [],
                        sporcuSayisi: 0, durum: 'bekliyor',
                        baslik: 'Öğle Arası',
                    };
                }
                // Ödül töreni — günün sonundan odulSuresi kadar
                const odulS = Number(ds.odulSuresi) || 0;
                if (odulS > 0 && ds.bitis && /^\d{1,2}:\d{2}/.test(ds.bitis)) {
                    const endM = hmToMin(ds.bitis);
                    const startM = Math.max(0, endM - odulS);
                    const k = push(ref(db, `${firebasePath}/${selectedCompId}/program`)).key;
                    newProgram[k] = {
                        tip: 'odul_toreni', tarih, gunIndex: gi,
                        baslangic: minToHm(startM), saat: minToHm(startM),
                        bitis: minToHm(endM), bitisSaat: minToHm(endM),
                        kategori: '__odul__', aletler: [],
                        sporcuSayisi: 0, durum: 'bekliyor',
                        baslik: 'Ödül Töreni',
                    };
                }
            });
            await set(ref(db, `${firebasePath}/${selectedCompId}/program`), newProgram);
            if (spannedCount > 0) {
                toast(`${spannedCount} kategori birden çok güne yayıldı (günler dolduğu için bloklar ertesi günde devam ediyor).`, 'info');
            }
            logAction('schedule_generate', `Plan oluşturuldu (${Object.keys(newProgram).length} seans)`, { user: currentUser?.kullaniciAdi, competitionId: selectedCompId });
            toast(`${Object.keys(newProgram).length} seans oluşturuldu.`, 'success');
        } catch (e) {
            toast('Plan oluşturulurken hata: ' + (e.message || ''), 'error');
        } finally {
            setGenerating(false);
        }
    };

    /* ── Oluşan program: günlere böl ── */
    const sessionsByDay = useMemo(() => {
        const out = days.map(() => []);
        Object.entries(sessions).forEach(([id, s]) => {
            const idx = (typeof s.gunIndex === 'number') ? s.gunIndex : Math.max(0, days.indexOf(s.tarih));
            if (idx >= 0 && idx < out.length) out[idx].push({ id, ...s });
        });
        out.forEach(arr => arr.sort((a, b) => hmToMin(a.baslangic || a.saat) - hmToMin(b.baslangic || b.saat)));
        return out;
    }, [sessions, days]);

    const currentDaySessions = sessionsByDay[activeDay] || [];
    const dayTotalMin = currentDaySessions.reduce((s, x) => s + Math.max(0, hmToMin(x.bitis || x.bitisSaat) - hmToMin(x.baslangic || x.saat)), 0);

    const setStatus = (s, durum) => update(ref(db, `${firebasePath}/${selectedCompId}/program/${s.id}`), { durum });
    const deleteSession = async (s) => {
        const ok = await confirm(`'${catLabel(s.kategori)}' planlamasını silmek istiyor musunuz?`);
        if (!ok) return;
        await remove(ref(db, `${firebasePath}/${selectedCompId}/program/${s.id}`));
    };

    /* ── Tüm seçili kategorilerin aletleri (Adım 4 için) ── */
    const aletlerUsed = useMemo(() => {
        const s = new Set();
        planConfig.selectedCats.forEach(cat => (kategoriler[cat]?.aletler || []).forEach(a => s.add(a)));
        return [...s];
    }, [planConfig.selectedCats, kategoriler]);

    /* ── Render ───────────────────────────────────────────────────────── */
    const compEntries = Object.entries(competitions).sort((a, b) =>
        new Date(b[1].baslangicTarihi || b[1].tarih || 0) - new Date(a[1].baslangicTarihi || a[1].tarih || 0)
    );
    const hasCats = Object.keys(kategoriler).length > 0;

    return (
        <div className="schedule-v3">
            <header className="csv3-header">
                <button className="csv3-back" onClick={() => navigate(routePrefix)} title="Geri">
                    <i className="material-icons-round">arrow_back</i>
                </button>
                <div>
                    <h1>{disciplineLabel} — Yarışma Planlama</h1>
                    <p>Adım adım: kategori seç → gün/saat → günü düzenle → alet süresi → planı oluştur.</p>
                </div>
            </header>

            <div className="csv3-comp-pick">
                <label>YARIŞMA</label>
                <select value={selectedCompId} onChange={e => { setSelectedCompId(e.target.value); setActiveDay(0); }}>
                    <option value="">— Yarışma Seçin —</option>
                    {compEntries.map(([id, c]) => (
                        <option key={id} value={id}>
                            {c.isim} {c.il ? `· ${c.il}` : ''} {c.baslangicTarihi ? `· ${c.baslangicTarihi}` : ''}
                        </option>
                    ))}
                </select>
            </div>

            {!selectedCompId ? (
                <div className="csv3-empty">
                    <i className="material-icons-round">event_note</i>
                    <h2>Yarışma seçin</h2>
                </div>
            ) : !hasCats || days.length === 0 ? (
                <div className="csv3-empty">
                    <i className="material-icons-round">warning</i>
                    <h2>Eksik veri</h2>
                    <p>Yarışmaya kategori ve tarih (başlangıç/bitiş) atanmış olmalı.</p>
                </div>
            ) : (
                <>
                    {/* ── Adım 1: Kategori seçimi ── */}
                    <section className="csv3-step">
                        <div className="csv3-step-head"><span className="csv3-step-no">1</span> Hangi kategoriler yarışacak?</div>
                        <div className="csv3-cat-grid">
                            {Object.entries(kategoriler).map(([k, v]) => {
                                const checked = planConfig.selectedCats.includes(k);
                                const sayi = catAthleteCount(k);
                                const aletSayi = (v.aletler || []).length;
                                return (
                                    <label key={k} className={`csv3-cat-card ${checked ? 'on' : ''}`}>
                                        <input type="checkbox" checked={checked} onChange={() => toggleCat(k)} />
                                        <div>
                                            <strong>{v.name || catLabel(k)}</strong>
                                            <div className="csv3-cat-meta">{sayi} sporcu · {aletSayi} alet</div>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </section>

                    {/* ── Adım 2: Gün + başlangıç saati ── */}
                    <section className="csv3-step">
                        <div className="csv3-step-head">
                            <span className="csv3-step-no">2</span>
                            Hangi gün ve kaçta başlasın?
                            {planConfig.selectedCats.length > 0 && (
                                <>
                                    <button className="csv3-mini-btn" onClick={autoStaggerStartTimes}
                                        title="Kategorileri sırayla diz; sığmazsa sonraki güne taşır">
                                        <i className="material-icons-round">schedule</i> Otomatik Sırala
                                    </button>
                                    <button className="csv3-mini-btn" onClick={autoDistributeAllDays}
                                        title={`Tüm kategorileri ${days.length} güne eşit dağıt (≈ ${Math.ceil(planConfig.selectedCats.length / Math.max(1, days.length))} kat/gün)`}
                                        style={{ background: '#dcfce7', color: '#15803d', borderColor: '#86efac' }}>
                                        <i className="material-icons-round">auto_awesome</i> Eşit Günlere Dağıt
                                    </button>
                                </>
                            )}
                        </div>
                        {planConfig.selectedCats.length === 0 ? (
                            <div className="csv3-hint">Önce kategori seçin.</div>
                        ) : (
                            <table className="csv3-cat-table">
                                <thead>
                                    <tr>
                                        <th>KATEGORİ</th>
                                        <th>GÜN (tercih)</th>
                                        <th>BAŞLANGIÇ (tercih)</th>
                                        <th className="ta-c">ISINMA (DK)</th>
                                        <th className="ta-c">ÖDÜL (DK)</th>
                                        <th>GERÇEKLEŞEN PLAN</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {planConfig.selectedCats.map(cat => {
                                        const cs = planConfig.catSettings[cat] || {};
                                        const preview = previews.find(p => p.cat === cat);
                                        return (
                                            <tr key={cat}>
                                                <td><strong>{catLabel(cat)}</strong></td>
                                                <td>
                                                    <select value={cs.gunIndex ?? 0}
                                                        onChange={e => updateCatSetting(cat, 'gunIndex', +e.target.value)}>
                                                        {days.map((d, i) => <option key={d} value={i}>{i + 1}. Gün · {fmtDate(d)}</option>)}
                                                    </select>
                                                </td>
                                                <td>
                                                    <input type="time" value={cs.baslangic || '09:00'}
                                                        onChange={e => updateCatSetting(cat, 'baslangic', e.target.value)} />
                                                </td>
                                                <td className="ta-c">
                                                    <input type="number" min="0" value={cs.isinmaDk ?? 15}
                                                        onChange={e => updateCatSetting(cat, 'isinmaDk', +e.target.value)} />
                                                </td>
                                                <td className="ta-c">
                                                    <input type="number" min="0" value={cs.odulDk ?? 10}
                                                        onChange={e => updateCatSetting(cat, 'odulDk', +e.target.value)} />
                                                </td>
                                                <td>
                                                    {preview?.spansMultipleDays && (
                                                        <span className="csv3-shifted-badge" title="Bloklar birden çok güne yayıldı">
                                                            ⏭ {preview.placements.length} güne yayıldı
                                                        </span>
                                                    )}
                                                    {preview?.overflow && (
                                                        <span className="csv3-overflow-badge" title="Tüm günlere de sığmıyor">⚠ taşma</span>
                                                    )}
                                                    <div className="csv3-plan-line">
                                                        {(preview?.placements || []).map((p, pi) => {
                                                            const labels = p.grupEtiketleri || [];
                                                            const grupRange = labels.length
                                                                ? (labels.length > 4
                                                                    ? `Grup ${labels[0]} – ${labels[labels.length - 1]}`
                                                                    : `Grup ${labels.join(', ')}`)
                                                                : '';
                                                            return (
                                                                <div key={pi} className="csv3-plan-day-line">
                                                                    <span className="csv3-day-tag">{p.gunIndex + 1}. gün</span>
                                                                    <strong className="csv3-bitis">{p.baslangic} → {p.bitis}</strong>
                                                                    <span className="csv3-dur">({p.bloklar.length} blok · {grupRange})</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    {preview?.est && (
                                                        <div className="csv3-block-line">
                                                            Toplam: {preview.est.groupCount} grup ({preview.est.actualSize}/grup) · {preview.est.blockCount} blok · {preview.est.total} dk
                                                            {preview.est.source === 'precomputed' && (
                                                                <span style={{ marginLeft: 6, background: '#dcfce7', color: '#15803d', padding: '1px 6px', borderRadius: 4, fontSize: 10 }}>
                                                                    ✓ önceden gruplandı
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </section>

                    {/* ── Adım 3: Gün pencereleri ── */}
                    <section className="csv3-step">
                        <div className="csv3-step-head"><span className="csv3-step-no">3</span> Günlerin başlangıç ve bitiş hedefi</div>
                        {days.length === 1 && (
                            <div className="csv3-hint" style={{ color: '#b91c1c', fontWeight: 700 }}>
                                ⚠ Yarışma tek günlük — sığmayan kategoriler için ek gün yok. Yarışma tarihini uzatın veya alet sürelerini azaltın.
                            </div>
                        )}
                        <table className="csv3-cat-table">
                            <thead>
                                <tr>
                                    <th>GÜN</th>
                                    <th>BAŞLANGIÇ</th>
                                    <th>HEDEF BİTİŞ</th>
                                    <th className="ta-c" title="Öğle arası penceresi (boş = yok)">ÖĞLE ARASI</th>
                                    <th className="ta-c" title="Günün sonunda ödül töreni için ayrılacak dakika">ÖDÜL (dk)</th>
                                    <th className="ta-c">PENCERE</th>
                                    <th>PLANLI</th>
                                    <th>KAPASİTE KULLANIMI</th>
                                </tr>
                            </thead>
                            <tbody>
                                {days.map((d, i) => {
                                    const ds = planConfig.daySettings[i] || {};
                                    const inDay = previews.filter(p => p.gunIndex === i && !p.error);
                                    const usedMin = inDay.reduce((s, p) => s + (p.est?.total || 0), 0);
                                    const odulS = Number(ds.odulSuresi) || 0;
                                    const araDk = (ds.araBaslangic && ds.araBitis)
                                        ? Math.max(0, hmToMin(ds.araBitis) - hmToMin(ds.araBaslangic))
                                        : 0;
                                    const windowMin = Math.max(0, hmToMin(ds.bitis || '17:00') - hmToMin(ds.baslangic || '09:00') - araDk - odulS);
                                    const pct = windowMin ? Math.min(100, Math.round(usedMin * 100 / windowMin)) : 0;
                                    const overUse = usedMin > windowMin;
                                    return (
                                        <tr key={d}>
                                            <td><strong>{i + 1}. Gün</strong> · {fmtDate(d)}</td>
                                            <td>
                                                <input type="time" value={ds.baslangic || '09:00'}
                                                    onChange={e => updateDaySetting(i, 'baslangic', e.target.value)} />
                                            </td>
                                            <td>
                                                <input type="time" value={ds.bitis || '17:00'}
                                                    onChange={e => updateDaySetting(i, 'bitis', e.target.value)} />
                                            </td>
                                            <td className="ta-c" style={{ whiteSpace: 'nowrap' }}>
                                                <input type="time" value={ds.araBaslangic || ''} style={{ width: 88 }}
                                                    onChange={e => updateDaySetting(i, 'araBaslangic', e.target.value)} />
                                                <span style={{ margin: '0 4px', color: '#94a3b8' }}>→</span>
                                                <input type="time" value={ds.araBitis || ''} style={{ width: 88 }}
                                                    onChange={e => updateDaySetting(i, 'araBitis', e.target.value)} />
                                            </td>
                                            <td className="ta-c">
                                                <input type="number" min="0" max="120" step="5"
                                                    value={ds.odulSuresi ?? 0} style={{ width: 64 }}
                                                    onChange={e => updateDaySetting(i, 'odulSuresi', Math.max(0, +e.target.value || 0))} />
                                            </td>
                                            <td className="ta-c">
                                                <strong>{windowMin}</strong> dk
                                            </td>
                                            <td>
                                                {inDay.length} kategori · <strong>{usedMin}</strong> dk
                                            </td>
                                            <td>
                                                <div className="csv3-cap-bar">
                                                    <div className="csv3-cap-fill" style={{
                                                        width: `${Math.min(100, pct)}%`,
                                                        background: overUse ? '#ef4444' : pct > 85 ? '#f59e0b' : '#22c55e',
                                                    }} />
                                                </div>
                                                <span className="csv3-cap-pct">{pct}%{overUse && ' ⚠'}</span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </section>

                    {/* ── Adım 4: Grup büyüklüğü + Alet bazlı dk/sporcu ── */}
                    <section className="csv3-step">
                        <div className="csv3-step-head"><span className="csv3-step-no">4</span> Grup büyüklüğü ve alet süreleri</div>

                        <div className="csv3-grid-2" style={{ marginBottom: 12 }}>
                            <label className="csv3-alet-card">
                                <span style={{ flex: 1 }}>
                                    Grup başına hedef sporcu sayısı
                                    <span style={{ display: 'block', fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>
                                        Genelde 5-8 önerilir
                                    </span>
                                </span>
                                <input type="number" min="1" max="50"
                                    value={planConfig.grupBuyukluğu ?? 6}
                                    onChange={e => setPlanConfig(p => ({ ...p, grupBuyukluğu: Math.max(1, Math.min(50, +e.target.value || 6)) }))} />
                                <span className="csv3-alet-unit">sporcu</span>
                            </label>
                            <label className="csv3-alet-card">
                                <span style={{ flex: 1 }}>Bloklar arası geçiş</span>
                                <input type="number" min="0" max="60"
                                    value={planConfig.bloklarArasiDk ?? 5}
                                    onChange={e => setPlanConfig(p => ({ ...p, bloklarArasiDk: Math.max(0, +e.target.value || 0) }))} />
                                <span className="csv3-alet-unit">dakika</span>
                            </label>
                        </div>

                        <div className="csv3-step-head" style={{ fontSize: '0.95rem', marginTop: 8 }}>
                            <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, marginRight: 6 }}>4b)</span>
                            Sporcu başına dakika — alet bazında
                        </div>
                        {aletlerUsed.length === 0 ? (
                            <div className="csv3-hint">Önce kategori seçin.</div>
                        ) : (
                            <div className="csv3-alet-grid">
                                {aletlerUsed.map(a => (
                                    <label key={a} className="csv3-alet-card">
                                        <span>{aletLabel(a)}</span>
                                        <input type="number" step="0.5" min="0.5"
                                            value={planConfig.aletDk[a] ?? DEFAULT_ALET_DK[a] ?? 2}
                                            onChange={e => updateAletDk(a, +e.target.value)} />
                                        <span className="csv3-alet-unit">dk/sporcu</span>
                                    </label>
                                ))}
                            </div>
                        )}
                        <p className="csv3-hint">
                            K alet → K grup paralel çalışır = <strong>1 blok</strong>. Sporcu sayısı &gt; grup×K ise birden çok blok olur, blok aralarına geçiş süresi eklenir.
                        </p>
                    </section>

                    {/* ── Adım 5: Uyarılar + Oluştur ── */}
                    <section className="csv3-step csv3-step-final">
                        <div className="csv3-step-head"><span className="csv3-step-no">5</span> Önizleme & Oluştur</div>
                        {feasibility && !feasibility.fits && (
                            <div className="csv3-fatal">
                                <strong>⛔ Plan imkânsız — bir blok günün penceresinden uzun</strong>
                                <p>
                                    En uzun blok: <strong>{feasibility.blockMin} dk</strong> (<em>{catLabel(feasibility.worstCat)}</em>),
                                    en kısa gün penceresi: <strong>{feasibility.minDayWindow} dk</strong>.
                                </p>
                                <p>
                                    <strong>Çözüm:</strong> Adım 4'ten <em>Grup başına hedef sporcu</em> değerini düşürün
                                    {feasibility.suggestedGroupSize && <> (önerilen: <strong>≤ {feasibility.suggestedGroupSize}</strong>)</>}
                                    , veya alet dakikalarını azaltın, ya da Adım 3'te günü uzatın.
                                </p>
                            </div>
                        )}
                        {warnings.length > 0 && (
                            <div className="csv3-warnings">
                                <strong>Uyarılar:</strong>
                                <ul>{warnings.map((w, i) => <li key={i}>{w.text}</li>)}</ul>
                            </div>
                        )}
                        <div className="csv3-summary">
                            <div><strong>Seçili kategori:</strong> {planConfig.selectedCats.length}</div>
                            <div><strong>Toplam seans:</strong> {previews.filter(p => !p.error && !p.overflow).length}</div>
                            <div><strong>Toplam süre:</strong> {previews.reduce((s, p) => s + (p.est?.total || 0), 0)} dk</div>
                        </div>
                        <div className="csv3-actions">
                            <button className="csv3-btn-primary" onClick={buildAndSavePlan}
                                disabled={generating || planConfig.selectedCats.length === 0 || (feasibility && !feasibility.fits)}>
                                <i className="material-icons-round">{generating ? 'hourglass_top' : 'auto_awesome'}</i>
                                {generating ? 'Oluşturuluyor…' : 'Planı Oluştur'}
                            </button>
                        </div>
                    </section>

                    {/* ── Oluşmuş Plan Görünümü ── */}
                    {Object.keys(sessions).length > 0 && (
                        <section className="csv3-step csv3-result">
                            <div className="csv3-step-head">
                                <span className="csv3-step-no done">✓</span>
                                Oluşturulmuş Plan ({Object.keys(sessions).length} seans)
                                <button onClick={exportPdf} disabled={pdfBusy}
                                    style={{ marginLeft: 'auto' }}
                                    className="csv3-btn-primary">
                                    <i className="material-icons-round">{pdfBusy ? 'hourglass_top' : 'picture_as_pdf'}</i>
                                    {pdfBusy ? 'PDF hazırlanıyor…' : 'TCF Resmi PDF'}
                                </button>
                            </div>
                            <div className="csv2-day-tabs">
                                {days.map((d, i) => (
                                    <button key={d} className={`csv2-day-tab ${i === activeDay ? 'active' : ''}`}
                                        onClick={() => setActiveDay(i)}>
                                        <div className="csv2-day-name">{i + 1}. Gün</div>
                                        <div className="csv2-day-date">{fmtDate(d)}</div>
                                        <div className="csv2-day-count">{sessionsByDay[i]?.length || 0} seans</div>
                                    </button>
                                ))}
                            </div>
                            <div className="csv2-table-wrap">
                                {currentDaySessions.length === 0 ? (
                                    <div className="csv2-empty small"><p>Bu güne plan yok.</p></div>
                                ) : (
                                    <table className="csv2-table">
                                        <thead>
                                            <tr>
                                                <th>BAŞLANGIÇ</th><th>KATEGORİ</th><th className="ta-c">SPORCU</th>
                                                <th className="ta-c">ALET</th><th className="ta-c">SÜRE</th>
                                                <th>BİTİŞ</th><th>DURUM</th><th></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {currentDaySessions.map(s => {
                                                const isOpen = expanded.has(s.id);
                                                const baslangic = s.baslangic || s.saat || '—';
                                                const bitis = s.bitis || s.bitisSaat || '—';
                                                const dur = Math.max(0, hmToMin(bitis) - hmToMin(baslangic));
                                                return (
                                                    <FragmentRow key={s.id}>
                                                        <tr className={`csv2-row ${isOpen ? 'open' : ''} ${s.tip === 'ogle_arasi' ? 'csv2-row--ara' : s.tip === 'odul_toreni' ? 'csv2-row--odul' : ''}`}
                                                            onClick={() => s.tip ? null : setExpanded(prev => { const n = new Set(prev); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}>
                                                            <td className="csv2-time">{baslangic}</td>
                                                            <td className="csv2-cat">
                                                                {!s.tip && <i className="material-icons-round csv2-chev">{isOpen ? 'expand_more' : 'chevron_right'}</i>}
                                                                {s.tip === 'ogle_arasi' && <i className="material-icons-round" style={{ color: '#f59e0b', marginRight: 6 }}>restaurant</i>}
                                                                {s.tip === 'odul_toreni' && <i className="material-icons-round" style={{ color: '#d4af37', marginRight: 6 }}>emoji_events</i>}
                                                                <strong>{s.tip ? s.baslik : catLabel(s.kategori)}</strong>
                                                            </td>
                                                            <td className="ta-c">{s.tip ? '—' : (s.sporcuSayisi ?? '—')}</td>
                                                            <td className="ta-c">{s.tip ? '—' : (s.aletler || []).length}</td>
                                                            <td className="ta-c">{dur} dk</td>
                                                            <td className="csv2-time">{bitis}</td>
                                                            <td>
                                                                <span className="csv2-status" style={{ background: SESSION_COLORS[s.durum] || '#94a3b8' }}>
                                                                    {SESSION_LABELS[s.durum] || 'Bekliyor'}
                                                                </span>
                                                            </td>
                                                            <td className="csv2-actions" onClick={e => e.stopPropagation()}>
                                                                <select className="csv2-status-sel" value={s.durum || 'bekliyor'}
                                                                    onChange={e => setStatus(s, e.target.value)}>
                                                                    <option value="bekliyor">Bekliyor</option>
                                                                    <option value="devam">Devam</option>
                                                                    <option value="tamamlandi">Tamamlandı</option>
                                                                </select>
                                                                <button className="csv2-icon-btn danger" onClick={() => deleteSession(s)} title="Sil">
                                                                    <i className="material-icons-round">delete</i>
                                                                </button>
                                                            </td>
                                                        </tr>
                                                        {isOpen && !s.tip && (
                                                            <tr className="csv2-detail-row">
                                                                <td colSpan={8}><RotationGrid session={s} comp={comp} /></td>
                                                            </tr>
                                                        )}
                                                    </FragmentRow>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot>
                                            <tr>
                                                <td colSpan={4} className="csv2-foot-label">Bu gün toplam</td>
                                                <td className="ta-c"><strong>{dayTotalMin} dk</strong></td>
                                                <td colSpan={3}>{currentDaySessions.length} seans</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                )}
                            </div>
                        </section>
                    )}
                </>
            )}
        </div>
    );
}

function FragmentRow({ children }) { return <>{children}</>; }

/* ── Rotasyon Izgarası ─────────────────────────────────────────────────── */
function RotationGrid({ session, comp }) {
    const aletler = session.aletler || [];
    const K = aletler.length;
    const gruplar = session.gruplar || [];
    const grupEtiketleri = session.grupEtiketleri || gruplar.map((_, i) => String(i + 1));
    const grupAdi = (idx) => `Grup ${grupEtiketleri[idx] ?? (idx + 1)}`;
    if (K === 0) return <div className="csv2-empty small"><p>Bu seansta alet yok.</p></div>;
    const sporcular = comp?.sporcular?.[session.kategori] || {};
    const fullName = (id) => {
        const a = sporcular[id] || {};
        const ad = (a.ad || a.adSoyad || '').trim();
        const soyad = (a.soyad || '').trim();
        return (ad || soyad) ? `${ad} ${soyad}`.trim() : id;
    };

    // Bu güne düşen bloklar — bugünBloklar varsa onları, yoksa tüm blokları göster
    const bugün = session.bugünBloklar || null;
    const allBlockCount = Math.max(1, Math.ceil(gruplar.length / K));
    const blocks = [];
    if (bugün && bugün.length) {
        for (const bug of bugün) {
            const bIdx = bug.bIdx;
            blocks.push({
                bIdx,
                startIdx: bIdx * K,
                baslangic: bug.baslangic,
                bitis: bug.bitis,
                groups: gruplar.slice(bIdx * K, (bIdx + 1) * K),
            });
        }
    } else {
        for (let b = 0; b < allBlockCount; b++) {
            blocks.push({ bIdx: b, startIdx: b * K, groups: gruplar.slice(b * K, (b + 1) * K) });
        }
    }
    const blokDk = session.blokDk || 0;
    const transDk = session.bloklarArasiDk || 0;

    return (
        <div className="csv2-rotgrid">
            <div className="csv2-rotgrid-title">
                Rotasyon Planı — {catLabel(session.kategori)}
            </div>
            <div className="csv2-rotgrid-hint">
                {gruplar.length} grup · {allBlockCount} blok toplam
                {bugün ? ` · bu gün ${blocks.length} blok` : ''}
                {blokDk ? ` · blok süresi ≈ ${blokDk} dk` : ''}
                {session.çokGünlü ? ` · ${session.günSira}/${session.günToplam}. gün` : ''}
            </div>

            {blocks.map((blk, idx) => (
                <div key={blk.bIdx} className="csv2-rotgrid-block">
                    <div className="csv2-rotgrid-block-head">
                        <strong>Blok {blk.bIdx + 1}</strong>
                        {blk.baslangic && <span style={{ color: '#4F46E5', fontWeight: 700 }}>{blk.baslangic} → {blk.bitis}</span>}
                        <span>Gruplar: {blk.groups.map((_, i) => grupAdi(blk.startIdx + i)).join(', ')}</span>
                        {idx > 0 && transDk > 0 && (
                            <span className="csv2-rotgrid-trans">↻ {transDk} dk geçiş</span>
                        )}
                    </div>
                    <table className="csv2-rotgrid-table">
                        <thead>
                            <tr>
                                <th>ALET</th>
                                {Array.from({ length: K }, (_, r) => <th key={r}>Rotasyon {r + 1}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {aletler.map((al, i) => (
                                <tr key={al}>
                                    <td className="csv2-rotgrid-alet">{aletLabel(al)}</td>
                                    {Array.from({ length: K }, (_, r) => {
                                        const localG = groupAt(i, r, K);
                                        const globalG = blk.startIdx + localG;
                                        const color = GROUP_COLOR[globalG % GROUP_COLOR.length];
                                        const grupIds = blk.groups[localG] || [];
                                        return (
                                            <td key={r} className="csv2-rotgrid-cell" style={{ borderLeft: `4px solid ${color}` }}>
                                                <div className="csv2-rotgrid-grup" style={{ color }}>{grupAdi(globalG)}</div>
                                                <div className="csv2-rotgrid-count">{grupIds.length} sporcu</div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ))}

            <div className="csv2-rotgrid-groups">
                {gruplar.map((ids, i) => (
                    <div key={i} className="csv2-rotgrid-grup-card" style={{ borderTop: `3px solid ${GROUP_COLOR[i % GROUP_COLOR.length]}` }}>
                        <div className="csv2-rotgrid-grup-head">
                            <span style={{ color: GROUP_COLOR[i % GROUP_COLOR.length] }}>{grupAdi(i)}</span>
                            <span className="csv2-rotgrid-grup-count">{ids.length} sporcu · Blok {Math.floor(i / K) + 1}</span>
                        </div>
                        <ul>
                            {ids.slice(0, 6).map(id => <li key={id}>{fullName(id)}</li>)}
                            {ids.length > 6 && <li className="more">…ve {ids.length - 6} kişi daha</li>}
                        </ul>
                    </div>
                ))}
            </div>
        </div>
    );
}
