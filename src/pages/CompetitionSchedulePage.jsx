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
        daySettings: {},   // {gunIndex: {baslangic, bitis}}
        aletDk: {},        // {alet: dk}
    });

    const [activeDay, setActiveDay] = useState(0);
    const [expanded, setExpanded] = useState(new Set());
    const [generating, setGenerating] = useState(false);

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
                });
            }
        });
        return () => u1();
    }, [firebasePath, selectedCompId]);

    const comp = competitions[selectedCompId];
    const kategoriler = useMemo(() => comp?.kategoriler || {}, [comp]);
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

    /* ── Tahmini süre hesabı (parallel rotation; max alet süresi belirler) ── */
    const estimateDuration = useCallback((catKey, settings) => {
        const aletler = (kategoriler[catKey]?.aletler || []).slice();
        if (aletler.length === 0) return null;
        const sira = olimpikSira(catKey, aletler);
        const K = sira.length;
        const N = catAthleteCount(catKey);
        const groupSize = Math.ceil(N / K) || 0;
        const rotationMin = groupSize * Math.max(...sira.map(a => planConfig.aletDk[a] || DEFAULT_ALET_DK[a] || 2));
        const isinma = settings?.isinmaDk ?? 15;
        const odul = settings?.odulDk ?? 10;
        const total = Math.max(1, Math.round(rotationMin * K + isinma + odul));
        return { K, N, groupSize, aletler: sira, rotationMin: Math.round(rotationMin), total };
    }, [kategoriler, planConfig.aletDk, catAthleteCount]);

    /* ── AKILLI YERLEŞTİRİCİ: gün penceresine sığmazsa sonraki güne taşır ──
     * Kullanıcının seçtiği gün/saat tercih olarak kullanılır; sığmazsa
     * otomatik sonraki güne kayar ve o günün başlangıcından (veya o gündeki
     * son yerleşimin bitişinden) devam eder.
     */
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

    /* ── Ön izleme: akıllı yerleştirici ile gerçek tahmin ── */
    const previews = useMemo(() => computePlacements(), [computePlacements]);

    /* ── Uyarılar (çakışma / gün penceresi taşma) ── */
    const warnings = useMemo(() => {
        const w = [];
        // Gün bazlı çakışma
        const byDay = {};
        previews.forEach(p => {
            if (p.error || p.gunIndex == null) return;
            (byDay[p.gunIndex] = byDay[p.gunIndex] || []).push(p);
        });
        Object.entries(byDay).forEach(([gi, arr]) => {
            arr.sort((a, b) => hmToMin(a.baslangic) - hmToMin(b.baslangic));
            for (let i = 0; i < arr.length; i++) {
                for (let j = i + 1; j < arr.length; j++) {
                    const a = arr[i], b = arr[j];
                    if (hmToMin(a.bitis) > hmToMin(b.baslangic) && hmToMin(b.bitis) > hmToMin(a.baslangic)) {
                        w.push({ kind: 'cakisma', text: `${days[gi] ? fmtDate(days[gi]) : (+gi + 1) + '. Gün'}: ${catLabel(a.cat)} ile ${catLabel(b.cat)} çakışıyor.` });
                    }
                }
            }
        });
        // Hiçbir güne sığmayanlar (last-day overflow)
        previews.forEach(p => {
            if (p.error) return;
            if (p.overflow) {
                w.push({ kind: 'overflow', text: `${catLabel(p.cat)} hiçbir güne sığmıyor — gün penceresini genişletin veya alet sürelerini azaltın.` });
            }
            if (p.shifted) {
                w.push({ kind: 'shift', text: `${catLabel(p.cat)} gün dolduğu için ${p.gunIndex + 1}. güne otomatik taşındı.` });
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

    // Sıfırdan otomatik dağıtım: günleri başlangıçtan itibaren peş peşe doldurur.
    // Kullanıcının önceden seçtiği gün ve saat tercihlerini SIFIRLAR — tamamen yeni
    // dağıtım yapar. Sığmayan kategoriler sonraki güne taşınır.
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
            const dayEnd = (d) => {
                const v = prev.daySettings?.[d]?.bitis;
                return (v && /^\d{1,2}:\d{2}/.test(v)) ? v : '17:00';
            };

            let dayIdx = 0;
            let cursor = hmToMin(dayStart(0));
            let shiftedCount = 0;
            // Kategorileri selectedCats sırasında dağıt
            for (const cat of prev.selectedCats) {
                const settings = prev.catSettings[cat] || {};
                const est = estimateDuration(cat, settings);
                const dur = Math.max(1, est?.total || 25);
                // Sığmıyorsa sonraki güne kaydır
                let shifted = false;
                while (cursor + dur > hmToMin(dayEnd(dayIdx)) && dayIdx + 1 < days.length) {
                    dayIdx++;
                    cursor = hmToMin(dayStart(dayIdx));
                    shifted = true;
                }
                if (shifted) shiftedCount++;
                next.catSettings[cat] = {
                    ...settings,
                    gunIndex: dayIdx,
                    baslangic: minToHm(cursor),
                };
                cursor += dur + gap;
            }
            return next;
        });
        toast('Tüm kategoriler günlere otomatik dağıtıldı.', 'success');
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

            const placements = computePlacements();
            const newProgram = {};
            let shiftedCount = 0;
            for (const pl of placements) {
                if (pl.error) continue;
                const cat = pl.cat;
                const kc = kategoriler[cat];
                if (!kc || !(kc.aletler || []).length) continue;
                const aletler = olimpikSira(cat, kc.aletler);
                const athleteIds = await getCatAthletes(cat);
                const N = athleteIds.length;
                const K = aletler.length;
                const groupSize = Math.ceil(N / K) || 0;
                const rotationMin = groupSize * Math.max(...aletler.map(a => planConfig.aletDk[a] || DEFAULT_ALET_DK[a] || 2));
                const total = pl.est?.total ?? Math.max(1, Math.round(rotationMin * K + pl.isinma + pl.odul));
                const gunIndex = pl.gunIndex;
                const baslangic = pl.baslangic;
                const bitis = pl.bitis;
                if (pl.shifted) shiftedCount++;
                const tarih = days[gunIndex] || '';
                const gruplar = distributeGroups(athleteIds, K);
                const key = push(ref(db, `${firebasePath}/${selectedCompId}/program`)).key;
                newProgram[key] = {
                    tarih, gunIndex,
                    baslangic, saat: baslangic,
                    bitis, bitisSaat: bitis,
                    kategori: cat,
                    aletler,
                    aletDk: aletler.reduce((acc, a) => { acc[a] = planConfig.aletDk[a] || DEFAULT_ALET_DK[a] || 2; return acc; }, {}),
                    sporcuSayisi: N,
                    gruplar,
                    isinmaDk: pl.isinma,
                    odulDk: pl.odul,
                    rotasyonDk: Math.round(rotationMin),
                    toplamDk: total,
                    durum: 'bekliyor',
                };
            }
            await set(ref(db, `${firebasePath}/${selectedCompId}/program`), newProgram);
            if (shiftedCount > 0) {
                toast(`${shiftedCount} kategori gün penceresi dolduğu için sonraki güne taşındı.`, 'info');
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
                                        title="Sıfırdan: tüm kategorileri günlere otomatik dağıtır"
                                        style={{ background: '#dcfce7', color: '#15803d', borderColor: '#86efac' }}>
                                        <i className="material-icons-round">auto_awesome</i> Günlere Dağıt
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
                                                    {preview?.shifted && (
                                                        <span className="csv3-shifted-badge" title="Gün penceresi dolduğu için sonraki güne taşındı">
                                                            → {preview.gunIndex + 1}. güne taşındı
                                                        </span>
                                                    )}
                                                    {preview?.overflow && (
                                                        <span className="csv3-overflow-badge" title="Tüm günlere de sığmıyor">⚠ taşma</span>
                                                    )}
                                                    <div className="csv3-plan-line">
                                                        <strong className="csv3-bitis">{preview?.baslangic || '—'} → {preview?.bitis || '—'}</strong>
                                                        <span className="csv3-dur">({preview?.est?.total || 0} dk)</span>
                                                    </div>
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
                                    const windowMin = Math.max(0, hmToMin(ds.bitis || '17:00') - hmToMin(ds.baslangic || '09:00'));
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

                    {/* ── Adım 4: Alet bazlı dk/sporcu ── */}
                    <section className="csv3-step">
                        <div className="csv3-step-head"><span className="csv3-step-no">4</span> Sporcu başına dakika (alet bazında)</div>
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
                        <p className="csv3-hint">Klasik rotasyonda gruplar paralel çalışır; rotasyon süresi en uzun aletin sporcu sayısı × dk'sıdır.</p>
                    </section>

                    {/* ── Adım 5: Uyarılar + Oluştur ── */}
                    <section className="csv3-step csv3-step-final">
                        <div className="csv3-step-head"><span className="csv3-step-no">5</span> Önizleme & Oluştur</div>
                        {warnings.length > 0 && (
                            <div className="csv3-warnings">
                                <strong>Uyarılar:</strong>
                                <ul>{warnings.map((w, i) => <li key={i}>{w.text}</li>)}</ul>
                            </div>
                        )}
                        <div className="csv3-summary">
                            <div><strong>Seçili kategori:</strong> {planConfig.selectedCats.length}</div>
                            <div><strong>Toplam seans:</strong> {previews.filter(p => !p.error).length}</div>
                            <div><strong>Toplam süre:</strong> {previews.reduce((s, p) => s + (p.est?.total || 0), 0)} dk</div>
                        </div>
                        <div className="csv3-actions">
                            <button className="csv3-btn-primary" onClick={buildAndSavePlan}
                                disabled={generating || planConfig.selectedCats.length === 0}>
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
                                                        <tr className={`csv2-row ${isOpen ? 'open' : ''}`}
                                                            onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}>
                                                            <td className="csv2-time">{baslangic}</td>
                                                            <td className="csv2-cat">
                                                                <i className="material-icons-round csv2-chev">{isOpen ? 'expand_more' : 'chevron_right'}</i>
                                                                <strong>{catLabel(s.kategori)}</strong>
                                                            </td>
                                                            <td className="ta-c">{s.sporcuSayisi ?? '—'}</td>
                                                            <td className="ta-c">{(s.aletler || []).length}</td>
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
                                                        {isOpen && (
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
    if (K === 0) return <div className="csv2-empty small"><p>Bu seansta alet yok.</p></div>;
    const sporcular = comp?.sporcular?.[session.kategori] || {};
    const fullName = (id) => {
        const a = sporcular[id] || {};
        const ad = (a.ad || a.adSoyad || '').trim();
        const soyad = (a.soyad || '').trim();
        return (ad || soyad) ? `${ad} ${soyad}`.trim() : id;
    };

    return (
        <div className="csv2-rotgrid">
            <div className="csv2-rotgrid-title">Rotasyon Planı — {catLabel(session.kategori)}</div>
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
                                const gIdx = groupAt(i, r, K);
                                const color = GROUP_COLOR[gIdx % GROUP_COLOR.length];
                                return (
                                    <td key={r} className="csv2-rotgrid-cell" style={{ borderLeft: `4px solid ${color}` }}>
                                        <div className="csv2-rotgrid-grup" style={{ color }}>Grup {GROUP_LETTER(gIdx)}</div>
                                        <div className="csv2-rotgrid-count">{(gruplar[gIdx] || []).length} sporcu</div>
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
            <div className="csv2-rotgrid-groups">
                {gruplar.map((ids, i) => (
                    <div key={i} className="csv2-rotgrid-grup-card" style={{ borderTop: `3px solid ${GROUP_COLOR[i % GROUP_COLOR.length]}` }}>
                        <div className="csv2-rotgrid-grup-head">
                            <span style={{ color: GROUP_COLOR[i % GROUP_COLOR.length] }}>Grup {GROUP_LETTER(i)}</span>
                            <span className="csv2-rotgrid-grup-count">{ids.length} sporcu</span>
                        </div>
                        <ul>
                            {ids.slice(0, 6).map(id => <li key={id}>{fullName(id)}</li>)}
                            {ids.length > 6 && <li className="more">…ve {ids.length - 6} kişi daha</li>}
                        </ul>
                    </div>
                ))}
            </div>
            <div className="csv2-rotgrid-hint">
                Klasik olimpik rotasyon: her rotasyonda gruplar bir alet ileri kayar. Toplam {K} rotasyon.
            </div>
        </div>
    );
}
