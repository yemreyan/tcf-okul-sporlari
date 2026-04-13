import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, push, set, remove, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { useDiscipline } from '../lib/DisciplineContext';
import './CompetitionSchedulePage.css';

/* ── Yardımcı fonksiyonlar ── */
const getCategoryLabel = (catKey) =>
    catKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const ALET_LABELS = {
    atlama: 'Atlama', barfiks: 'Barfiks', halka: 'Halka', kulplu: 'Kulplu Beygir',
    mantar: 'Mantar Beygir', paralel: 'Paralel', yer: 'Yer', denge: 'Denge Aleti',
    asimetrik: 'Asimetrik Paralel', ritmik: 'Ritmik',
};
const getAletLabel = (key) => ALET_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);

const SESSION_COLORS = {
    bekliyor: '#94A3B8',
    devam: '#2563EB',
    tamamlandi: '#16A34A',
};
const SESSION_LABELS = {
    bekliyor: 'Bekliyor',
    devam: 'Devam Ediyor',
    tamamlandi: 'Tamamlandı',
};

function formatDateTR(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function generateDateRange(start, end) {
    const dates = [];
    const s = new Date(start);
    const e = new Date(end || start);
    while (s <= e) {
        dates.push(s.toISOString().split('T')[0]);
        s.setDate(s.getDate() + 1);
    }
    return dates;
}

/* ── Rotasyon sabitleri ── */
const OLIMPIK_SIRA_KIZ   = ['atlama', 'asimetrik', 'denge', 'serbest'];
const OLIMPIK_SIRA_ERKEK = ['yer', 'kulplu', 'halka', 'atlama', 'paralel', 'barfiks', 'sirik'];

function getOlimpikSira(catKey, aletler) {
    const isKiz = catKey.toLowerCase().includes('kiz');
    const ref2 = isKiz ? OLIMPIK_SIRA_KIZ : OLIMPIK_SIRA_ERKEK;
    const ordered = ref2.filter(a => aletler.includes(a));
    const extra = aletler.filter(a => !ordered.includes(a));
    return [...ordered, ...extra];
}
function parseTimeToMin(t) { const [h, m] = (t || '09:00').split(':').map(Number); return h * 60 + m; }
function minToTimeStr(min) { const h = Math.floor(min / 60) % 24, m = min % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }

export default function CompetitionSchedulePage() {
    const navigate = useNavigate();
    const { currentUser, hasPermission } = useAuth();
    const { toast, confirm } = useNotification();
    const { firebasePath, routePrefix } = useDiscipline();

    const canCreate = hasPermission('schedule', 'olustur');
    const canEdit = hasPermission('schedule', 'duzenle');
    const canDelete = hasPermission('schedule', 'sil');

    const [competitions, setCompetitions] = useState({});
    const [selectedCity, setSelectedCity] = useState('');
    const [selectedCompId, setSelectedCompId] = useState('');
    const [sessions, setSessions] = useState({});
    const [loading, setLoading] = useState(true);

    // Modal state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSession, setEditingSession] = useState(null);
    const [generating, setGenerating] = useState(false);
    const [formData, setFormData] = useState({
        tarih: '',
        saat: '09:00',
        bitisSaat: '10:00',
        kategori: '',
        alet: '',
        aciklama: '',
        durum: 'bekliyor',
    });

    // New state
    const [activeTab, setActiveTab] = useState('ayarlar'); // 'ayarlar'|'rotasyon'|'program'
    const [planAyarlari, setPlanAyarlari] = useState({
        rotasyonSuresi: 30, molaSuresi: 10, isinmaSuresi: 15,
        kategoriBeklemeSuresi: 20, defaultBaslama: '09:00',
        sporculBasinaSure: 120, otomatikSureHesapla: true,
        gunAyarlari: {}, kategoriGunAtamalari: {},
        molalar: []  // [{ id, ad, baslangicSaat, bitisSaat }]
    });
    const [rotasyonPlani, setRotasyonPlani] = useState({}); // {catKey: {0:{baslangicAleti,bolunmus,bolumler}}}
    const [gruplar, setGruplar] = useState({});             // {catKey: [[ath,...],...]  loaded from siralama
    const [savingPlan, setSavingPlan] = useState(false);    // eslint-disable-line no-unused-vars
    const [expandedSessions, setExpandedSessions] = useState(new Set());

    // Firebase — yarışmalar
    useEffect(() => {
        const unsub = onValue(ref(db, firebasePath), (s) => {
            const data = s.val() || {};
            setCompetitions(data);
            setLoading(false);
        });
        return () => unsub();
    }, []);

    // Firebase — seçili yarışmanın programı
    useEffect(() => {
        if (!selectedCompId) { setSessions({}); return; }
        const unsub = onValue(ref(db, `${firebasePath}/${selectedCompId}/program`), (s) => {
            setSessions(s.val() || {});
        });
        return () => unsub();
    }, [selectedCompId]);

    // planAyarlari from Firebase
    useEffect(() => {
        if (!selectedCompId) { setPlanAyarlari({ rotasyonSuresi: 30, molaSuresi: 10, isinmaSuresi: 15, kategoriBeklemeSuresi: 20, defaultBaslama: '09:00', gunAyarlari: {}, kategoriGunAtamalari: {} }); return; }
        const unsub = onValue(ref(db, `${firebasePath}/${selectedCompId}/planAyarlari`), s => {
            if (s.val()) setPlanAyarlari(prev => ({ ...prev, ...s.val() }));
        });
        return () => unsub();
    }, [selectedCompId, firebasePath]);

    // rotasyonPlani from Firebase
    useEffect(() => {
        if (!selectedCompId) { setRotasyonPlani({}); return; }
        const unsub = onValue(ref(db, `${firebasePath}/${selectedCompId}/rotasyonPlani`), s => setRotasyonPlani(s.val() || {}));
        return () => unsub();
    }, [selectedCompId, firebasePath]);

    // gruplar from siralama
    useEffect(() => {
        if (!selectedCompId) { setGruplar({}); return; }
        get(ref(db, `${firebasePath}/${selectedCompId}/siralama`)).then(snap => {
            const data = snap.val() || {};
            const result = {};
            Object.entries(data).forEach(([catKey, catData]) => {
                if (!catData || typeof catData !== 'object') return;
                const keys = Object.keys(catData).filter(k => k.startsWith('rotation_'));
                const maxIdx = keys.length ? Math.max(...keys.map(k => parseInt(k.replace('rotation_', '')))) : -1;
                const groups = [];
                for (let i = 0; i <= maxIdx; i++) {
                    const rotData = catData[`rotation_${i}`] || {};
                    const athletes = typeof rotData === 'object'
                        ? Object.values(rotData).filter(a => a && a.ad).sort((a, b) => (a.sirasi || 0) - (b.sirasi || 0))
                        : [];
                    if (athletes.length) groups.push(athletes);
                }
                if (groups.length) result[catKey] = groups;
            });
            setGruplar(result);
        });
    }, [selectedCompId, firebasePath]);

    // Filtrelenmiş yarışmalar
    const filteredComps = useMemo(
        () => filterCompetitionsByUser(competitions, currentUser),
        [competitions, currentUser]
    );

    const availableCities = [...new Set(Object.values(filteredComps).map(c => (c.il || c.city || '').toLocaleUpperCase('tr-TR')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr-TR'));

    const compList = useMemo(
        () => Object.entries(filteredComps)
            .filter(([, c]) => !selectedCity || (c.il || c.city || '').toLocaleUpperCase('tr-TR') === selectedCity)
            .map(([id, c]) => ({ id, ...c }))
            .sort((a, b) => (b.baslangicTarihi || '').localeCompare(a.baslangicTarihi || '')),
        [filteredComps, selectedCity]
    );

    const selectedComp = selectedCompId ? filteredComps[selectedCompId] : null;

    // Yarışma kategorileri ve aletleri
    const compKategoriler = useMemo(() => {
        if (!selectedComp?.kategoriler) return {};
        return selectedComp.kategoriler;
    }, [selectedComp]);

    const compCatKeys = useMemo(() => Object.keys(compKategoriler), [compKategoriler]);

    const getAletlerForCat = (catKey) => {
        const cat = compKategoriler[catKey];
        if (!cat?.aletler) return [];
        const raw = cat.aletler;
        if (Array.isArray(raw)) return raw;
        if (raw && typeof raw === 'object') return Object.values(raw).map(a => typeof a === 'string' ? a : a?.id || '').filter(Boolean);
        return [];
    };

    // Tarihlere göre grupla
    const dateRange = useMemo(() => {
        if (!selectedComp) return [];
        const start = selectedComp.baslangicTarihi;
        const end = selectedComp.bitisTarihi || start;
        if (!start) return [];
        return generateDateRange(start, end);
    }, [selectedComp]);

    const sessionsByDate = useMemo(() => {
        const grouped = {};
        dateRange.forEach(d => { grouped[d] = []; });

        Object.entries(sessions).forEach(([id, sess]) => {
            const d = sess.tarih || dateRange[0];
            if (!grouped[d]) grouped[d] = [];
            grouped[d].push({ id, ...sess });
        });

        // Saate göre sırala
        Object.values(grouped).forEach(arr => arr.sort((a, b) => (a.saat || '').localeCompare(b.saat || '')));
        return grouped;
    }, [sessions, dateRange]);

    // ── Modal işlemleri ──
    const openAddModal = (tarih) => {
        setEditingSession(null);
        setFormData({
            tarih: tarih || dateRange[0] || '',
            saat: '09:00',
            bitisSaat: '10:00',
            kategori: compCatKeys[0] || '',
            alet: '',
            aciklama: '',
            durum: 'bekliyor',
        });
        setIsModalOpen(true);
    };

    const openEditModal = (sess) => {
        setEditingSession(sess);
        setFormData({
            tarih: sess.tarih || '',
            saat: sess.saat || '09:00',
            bitisSaat: sess.bitisSaat || '10:00',
            kategori: sess.kategori || '',
            alet: sess.alet || '',
            aciklama: sess.aciklama || '',
            durum: sess.durum || 'bekliyor',
        });
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingSession(null);
    };

    const handleSave = async () => {
        if (!formData.saat || !formData.kategori) {
            toast('Saat ve kategori zorunludur', 'error');
            return;
        }

        const sessionData = {
            tarih: formData.tarih,
            saat: formData.saat,
            bitisSaat: formData.bitisSaat,
            kategori: formData.kategori,
            alet: formData.alet || '',
            aciklama: formData.aciklama || `${getCategoryLabel(formData.kategori)}${formData.alet ? ' — ' + getAletLabel(formData.alet) : ''}`,
            durum: formData.durum,
        };

        try {
            if (editingSession) {
                await update(ref(db, `${firebasePath}/${selectedCompId}/program/${editingSession.id}`), sessionData);
                toast('Oturum güncellendi', 'success');
            } else {
                await push(ref(db, `${firebasePath}/${selectedCompId}/program`), sessionData);
                toast('Oturum eklendi', 'success');
            }
            closeModal();
        } catch (err) {
            toast('Hata: ' + err.message, 'error');
        }
    };

    const handleDelete = async (sessId) => {
        const ok = await confirm('Bu oturumu silmek istediğinize emin misiniz?');
        if (!ok) return;
        try {
            await remove(ref(db, `${firebasePath}/${selectedCompId}/program/${sessId}`));
            toast('Oturum silindi', 'success');
        } catch (err) {
            toast('Hata: ' + err.message, 'error');
        }
    };

    const handleStatusChange = async (sessId, newStatus) => {
        try {
            await update(ref(db, `${firebasePath}/${selectedCompId}/program/${sessId}`), { durum: newStatus });
        } catch (err) {
            toast('Hata: ' + err.message, 'error');
        }
    };

    // Sporcu sayılarını getir (yarışma verisindeki sporcular)
    const [athleteCounts, setAthleteCounts] = useState({});
    useEffect(() => {
        if (!selectedCompId) { setAthleteCounts({}); return; }
        const unsub = onValue(ref(db, `${firebasePath}/${selectedCompId}/sporcular`), (s) => {
            const data = s.val() || {};
            const counts = {};
            Object.entries(data).forEach(([catKey, athletes]) => {
                counts[catKey] = athletes && typeof athletes === 'object' ? Object.keys(athletes).length : 0;
            });
            setAthleteCounts(counts);
        });
        return () => unsub();
    }, [selectedCompId]);

    // ── Otomatik Program Oluştur ──
    const handleAutoGenerate = async () => {
        if (!selectedCompId) return;

        if (compCatKeys.length === 0) {
            toast('Yarışmada kategori bulunamadı', 'error');
            return;
        }

        // Mevcut oturumlar varsa onay iste
        if (Object.keys(sessions).length > 0) {
            const ok = await confirm('Mevcut program silinip yeniden oluşturulacak. Onaylıyor musunuz?');
            if (!ok) return;
        }

        setGenerating(true);

        try {
            // Sporcu sayılarını doğrudan Firebase'den oku (race condition önlemi)
            const athleteSnap = await get(ref(db, `${firebasePath}/${selectedCompId}/sporcular`));
            const athleteData = athleteSnap.val() || {};
            const freshAthleteCounts = {};
            Object.entries(athleteData).forEach(([catKey, athletes]) => {
                freshAthleteCounts[catKey] = athletes && typeof athletes === 'object' ? Object.keys(athletes).length : 0;
            });

            // Parametreler
            const ATHLETES_PER_SLOT = 8;
            const SLOT_DURATION_MIN = 30;
            const DAY_START_HOUR = 9;
            const DAY_END_HOUR = 18;
            const BREAK_DURATION_MIN = 15;

            const dates = [...dateRange];
            if (dates.length === 0) {
                toast('Yarışma tarih aralığı bulunamadı', 'error');
                setGenerating(false);
                return;
            }

            // Tüm kategori-alet çiftlerini sporcu sayısına göre oturumlara böl
            const allSlots = [];
            compCatKeys.forEach(catKey => {
                const aletler = getAletlerForCat(catKey);
                const totalAthletes = freshAthleteCounts[catKey] || 0;

                if (aletler.length === 0) {
                    const slotCount = Math.max(1, Math.ceil(totalAthletes / ATHLETES_PER_SLOT));
                    for (let i = 0; i < slotCount; i++) {
                        allSlots.push({ kategori: catKey, alet: '', aciklama: getCategoryLabel(catKey) });
                    }
                } else {
                    aletler.forEach(alet => {
                        const slotCount = Math.max(1, Math.ceil(totalAthletes / ATHLETES_PER_SLOT));
                        for (let i = 0; i < slotCount; i++) {
                            allSlots.push({
                                kategori: catKey,
                                alet: alet,
                                aciklama: `${getCategoryLabel(catKey)} — ${getAletLabel(alet)}`,
                            });
                        }
                    });
                }
            });

            // Slotları günlere dağıt (zaman taşmasını önle)
            const slotsPerDay = Math.floor(((DAY_END_HOUR - DAY_START_HOUR) * 60) / SLOT_DURATION_MIN);
            const newSessions = {};
            let currentDayIdx = 0;
            let currentSlotInDay = 0;
            let prevCategory = null;

            allSlots.forEach((slot) => {
                // Kategori değiştiğinde mola ekle
                if (prevCategory && prevCategory !== slot.kategori) {
                    const breakSlots = Math.ceil(BREAK_DURATION_MIN / SLOT_DURATION_MIN);
                    currentSlotInDay += breakSlots;
                }

                // Gün doluysa sonraki güne geç
                if (currentSlotInDay >= slotsPerDay) {
                    currentDayIdx++;
                    currentSlotInDay = 0;
                }

                const dayIdx = Math.min(currentDayIdx, dates.length - 1);

                const startMin = DAY_START_HOUR * 60 + currentSlotInDay * SLOT_DURATION_MIN;
                const endMin = startMin + SLOT_DURATION_MIN;

                const startH = String(Math.floor(startMin / 60)).padStart(2, '0');
                const startM = String(startMin % 60).padStart(2, '0');
                const endH = String(Math.floor(endMin / 60)).padStart(2, '0');
                const endM = String(endMin % 60).padStart(2, '0');

                const key = push(ref(db, `${firebasePath}/${selectedCompId}/program`)).key;
                newSessions[key] = {
                    tarih: dates[dayIdx],
                    saat: `${startH}:${startM}`,
                    bitisSaat: `${endH}:${endM}`,
                    kategori: slot.kategori,
                    alet: slot.alet,
                    aciklama: slot.aciklama,
                    durum: 'bekliyor',
                };

                prevCategory = slot.kategori;
                currentSlotInDay++;
            });

            await set(ref(db, `${firebasePath}/${selectedCompId}/program`), newSessions);
            toast(`${Object.keys(newSessions).length} oturum otomatik oluşturuldu`, 'success');
        } catch (err) {
            toast('Hata: ' + err.message, 'error');
        } finally {
            setGenerating(false);
        }
    };

    // ── Plan ayarları handlers ──
    const savePlanAyar = useCallback(async (updated) => {
        if (!selectedCompId) return;
        try { await set(ref(db, `${firebasePath}/${selectedCompId}/planAyarlari`), updated); }
        catch (err) { toast('Kayıt hatası: ' + err.message, 'error'); }
    }, [selectedCompId, firebasePath]);

    const updatePlanAyarlari = useCallback((field, value) => {
        const updated = { ...planAyarlari, [field]: value };
        setPlanAyarlari(updated);
        savePlanAyar(updated);
    }, [planAyarlari, savePlanAyar]);

    const updateGunAyar = useCallback((tarih, field, value) => {
        const updated = { ...planAyarlari, gunAyarlari: { ...(planAyarlari.gunAyarlari || {}), [tarih]: { ...(planAyarlari.gunAyarlari?.[tarih] || {}), [field]: value } } };
        setPlanAyarlari(updated);
        savePlanAyar(updated);
    }, [planAyarlari, savePlanAyar]);

    const handleSetGunSayisi = useCallback(async (days) => {
        if (!selectedCompId || !selectedComp?.baslangicTarihi) return;
        const start = new Date(selectedComp.baslangicTarihi);
        const end = new Date(start);
        end.setDate(start.getDate() + Math.max(1, days) - 1);
        const bitisTarihi = end.toISOString().split('T')[0];
        try {
            await update(ref(db, `${firebasePath}/${selectedCompId}`), { bitisTarihi });
            toast(`Yarışma süresi ${days} gün olarak güncellendi`, 'success');
        } catch (err) { toast('Hata: ' + err.message, 'error'); }
    }, [selectedCompId, selectedComp, firebasePath]);

    const handleSetBaslangicTarihi = useCallback(async (tarih) => {
        if (!selectedCompId) return;
        try {
            // Bitiş tarihi de güncelle (gün farkını koru)
            const oldStart = new Date(selectedComp?.baslangicTarihi || tarih);
            const oldEnd = new Date(selectedComp?.bitisTarihi || tarih);
            const dayDiff = Math.round((oldEnd - oldStart) / 86400000);
            const newStart = new Date(tarih);
            const newEnd = new Date(newStart);
            newEnd.setDate(newStart.getDate() + dayDiff);
            await update(ref(db, `${firebasePath}/${selectedCompId}`), {
                baslangicTarihi: tarih,
                bitisTarihi: newEnd.toISOString().split('T')[0]
            });
            toast('Başlangıç tarihi güncellendi', 'success');
        } catch (err) { toast('Hata: ' + err.message, 'error'); }
    }, [selectedCompId, selectedComp, firebasePath]);

    const updateKategoriGun = useCallback((catKey, dayIdx) => {
        const newAta = { ...(planAyarlari.kategoriGunAtamalari || {}), [catKey]: dayIdx };
        const updated = { ...planAyarlari, kategoriGunAtamalari: newAta };
        setPlanAyarlari(updated);
        savePlanAyar(updated);
    }, [planAyarlari, savePlanAyar]);

    const saveRotasyonPlaniForCat = useCallback(async (catKey, catPlan) => {
        if (!selectedCompId) return;
        await set(ref(db, `${firebasePath}/${selectedCompId}/rotasyonPlani/${catKey}`), catPlan);
    }, [selectedCompId, firebasePath]);

    const handleAutoAssign = useCallback(async (catKey) => {
        const aletlerSirali = getOlimpikSira(catKey, getAletlerForCat(catKey));
        const catGruplar = gruplar[catKey] || [];
        if (!catGruplar.length) { toast('Bu kategoride grup yok. Önce Çıkış Sırası sayfasından grupları oluşturun.', 'warning'); return; }
        const newCatPlan = {};
        catGruplar.forEach((_, idx) => {
            newCatPlan[idx] = { ...(rotasyonPlani[catKey]?.[idx] || {}), baslangicAleti: aletlerSirali[idx % aletlerSirali.length], bolunmus: false, bolumler: undefined };
        });
        setRotasyonPlani(prev => ({ ...prev, [catKey]: newCatPlan }));
        await saveRotasyonPlaniForCat(catKey, newCatPlan);
        toast(`${getCategoryLabel(catKey)} için olimpik sıraya göre atandı`, 'success');
    }, [gruplar, rotasyonPlani, saveRotasyonPlaniForCat, compKategoriler]);

    const handleGroupAletChange = useCallback(async (catKey, idx, aletKey) => {
        const updated = { ...rotasyonPlani, [catKey]: { ...(rotasyonPlani[catKey] || {}), [idx]: { ...(rotasyonPlani[catKey]?.[idx] || {}), baslangicAleti: aletKey } } };
        setRotasyonPlani(updated);
        await saveRotasyonPlaniForCat(catKey, updated[catKey]);
    }, [rotasyonPlani, saveRotasyonPlaniForCat]);

    const handleToggleBolunme = useCallback(async (catKey, idx) => {
        const cur = rotasyonPlani[catKey]?.[idx] || {};
        const aletlerSirali = getOlimpikSira(catKey, getAletlerForCat(catKey));
        const isBol = cur.bolunmus;
        const baseAlet = cur.baslangicAleti || aletlerSirali[0];
        const baseIdx = aletlerSirali.indexOf(baseAlet);
        const newPlan = {
            ...cur, bolunmus: !isBol,
            bolumler: !isBol ? [
                { aletKey: baseAlet, bolumAdi: 'A' },
                { aletKey: aletlerSirali[(baseIdx + 1) % aletlerSirali.length], bolumAdi: 'B' }
            ] : undefined
        };
        const updatedCat = { ...(rotasyonPlani[catKey] || {}), [idx]: newPlan };
        setRotasyonPlani(prev => ({ ...prev, [catKey]: updatedCat }));
        await saveRotasyonPlaniForCat(catKey, updatedCat);
    }, [rotasyonPlani, saveRotasyonPlaniForCat, compKategoriler]);

    const handleBolumAletChange = useCallback(async (catKey, idx, bi, aletKey) => {
        const cur = rotasyonPlani[catKey]?.[idx] || {};
        const newBolumler = [...(cur.bolumler || [])];
        newBolumler[bi] = { ...newBolumler[bi], aletKey };
        const updatedCat = { ...(rotasyonPlani[catKey] || {}), [idx]: { ...cur, bolumler: newBolumler } };
        setRotasyonPlani(prev => ({ ...prev, [catKey]: updatedCat }));
        await saveRotasyonPlaniForCat(catKey, updatedCat);
    }, [rotasyonPlani, saveRotasyonPlaniForCat]);

    // ── Mola yönetimi ──
    const addMola = useCallback(() => {
        const newMola = { id: Date.now().toString(), ad: 'Öğle Arası', baslangicSaat: '12:00', bitisSaat: '13:00' };
        const updated = { ...planAyarlari, molalar: [...(planAyarlari.molalar || []), newMola] };
        setPlanAyarlari(updated);
        savePlanAyar(updated);
    }, [planAyarlari, savePlanAyar]);

    const updateMola = useCallback((id, field, value) => {
        const updated = { ...planAyarlari, molalar: (planAyarlari.molalar || []).map(m => m.id === id ? { ...m, [field]: value } : m) };
        setPlanAyarlari(updated);
        savePlanAyar(updated);
    }, [planAyarlari, savePlanAyar]);

    const removeMola = useCallback((id) => {
        const updated = { ...planAyarlari, molalar: (planAyarlari.molalar || []).filter(m => m.id !== id) };
        setPlanAyarlari(updated);
        savePlanAyar(updated);
    }, [planAyarlari, savePlanAyar]);

    // ── Rotasyon süresi hesapla (sporcu sayısına göre) ──
    const calcRotasyonSuresi = useCallback((catKey, effGroups) => {
        if (!planAyarlari.otomatikSureHesapla) return planAyarlari.rotasyonSuresi || 30;
        const sn = planAyarlari.sporculBasinaSure || 120;
        const maxCount = effGroups.reduce((mx, g) => Math.max(mx, g.count || 0), 0);
        if (!maxCount) return planAyarlari.rotasyonSuresi || 30;
        return Math.ceil((maxCount * sn) / 60); // dakika
    }, [planAyarlari]);

    // ── Mola kontrolü: curMin bir molaya denk geliyorsa molanın sonuna atla ──
    const skipMolalar = useCallback((minTime) => {
        let cur = minTime;
        const molalar = (planAyarlari.molalar || []).slice().sort((a, b) => parseTimeToMin(a.baslangicSaat) - parseTimeToMin(b.baslangicSaat));
        let changed = true;
        while (changed) {
            changed = false;
            for (const mola of molalar) {
                const ms = parseTimeToMin(mola.baslangicSaat);
                const me = parseTimeToMin(mola.bitisSaat);
                if (cur >= ms && cur < me) { cur = me; changed = true; break; }
            }
        }
        return cur;
    }, [planAyarlari.molalar]);

    // NEW auto-generate that uses rotation plan
    const handleGenerateRotationSchedule = useCallback(async () => {
        if (!selectedCompId) return;
        if (Object.keys(sessions).length > 0) {
            const ok = await confirm('Mevcut program silinip rotasyon planına göre yeniden oluşturulacak. Onaylıyor musunuz?');
            if (!ok) return;
        }
        setGenerating(true);
        try {
            const newSessions = {};
            const kategoriGunAta = planAyarlari.kategoriGunAtamalari || {};
            const dayCategories = {};
            dateRange.forEach((tarih) => { dayCategories[tarih] = []; });
            compCatKeys.forEach(catKey => {
                const dayIdx = kategoriGunAta[catKey] ?? 0;
                const tarih = dateRange[Math.min(dayIdx, dateRange.length - 1)] || dateRange[0];
                if (tarih) dayCategories[tarih].push(catKey);
            });

            // Sabit molalar (öğle arası vb.)
            const sabitMolalar = (planAyarlari.molalar || [])
                .filter(m => m.baslangicSaat && m.bitisSaat)
                .sort((a, b) => parseTimeToMin(a.baslangicSaat) - parseTimeToMin(b.baslangicSaat));

            for (const tarih of dateRange) {
                const gunAyar = planAyarlari.gunAyarlari?.[tarih] || {};
                let curMin = parseTimeToMin(gunAyar.baslamaSaati || planAyarlari.defaultBaslama || '09:00');
                const aktifKats = dayCategories[tarih] || [];

                // Gün başında sabit molaları ekle (ileride schedule'a eklenmek üzere takip)
                const molaEklendi = new Set();

                for (const catKey of aktifKats) {
                    const aletlerSirali = getOlimpikSira(catKey, getAletlerForCat(catKey));
                    if (!aletlerSirali.length) continue;
                    const catGruplar = gruplar[catKey] || [];
                    const catPlan = rotasyonPlani[catKey] || {};
                    const numRot = aletlerSirali.length;

                    // Effective groups
                    const effGroups = [];
                    if (catGruplar.length) {
                        catGruplar.forEach((athletes, gi) => {
                            const gp = catPlan[gi] || {};
                            if (gp.bolunmus && gp.bolumler?.length >= 2) {
                                gp.bolumler.forEach((b) => {
                                    const half = Math.ceil(athletes.length / gp.bolumler.length);
                                    effGroups.push({ grupNo: gi + 1, bolumAdi: b.bolumAdi, baslangicAleti: b.aletKey, count: half, etiket: `Grup ${gi + 1}${b.bolumAdi}` });
                                });
                            } else {
                                effGroups.push({ grupNo: gi + 1, baslangicAleti: gp.baslangicAleti || aletlerSirali[gi % numRot], count: athletes.length, etiket: `Grup ${gi + 1}` });
                            }
                        });
                    } else {
                        const total = athleteCounts[catKey] || 0;
                        const ng = Math.max(1, Math.ceil(total / 8));
                        for (let g = 0; g < ng; g++) effGroups.push({ grupNo: g + 1, baslangicAleti: aletlerSirali[g % numRot], count: Math.ceil(total / ng), etiket: `Grup ${g + 1}` });
                    }

                    // Bu kategorinin rotasyon süresi (sporcu sayısına göre)
                    const rotSuresi = calcRotasyonSuresi(catKey, effGroups);

                    // Mola kontrolü yaparak ilerle
                    const advance = (dk) => {
                        // Geçilecek sabit molaları ekle
                        for (const mola of sabitMolalar) {
                            const ms = parseTimeToMin(mola.baslangicSaat);
                            const me = parseTimeToMin(mola.bitisSaat);
                            if (!molaEklendi.has(mola.id) && curMin <= ms && curMin + dk > ms) {
                                molaEklendi.add(mola.id);
                                const k = push(ref(db, 'x')).key;
                                newSessions[k] = { tarih, tip: 'mola', molaAdi: mola.ad || 'Mola', alet: '', saat: minToTimeStr(ms), bitisSaat: minToTimeStr(me), aciklama: mola.ad || 'Mola', durum: 'bekliyor', rotasyonNo: 0, grupNo: 0, kategori: catKey };
                                curMin = me;
                            }
                        }
                        curMin += dk;
                        // Artık molaya denk geliyorsa atla
                        curMin = skipMolalar(curMin);
                    };

                    // Mola kontrolü başlangıçta da yap
                    curMin = skipMolalar(curMin);

                    // Isınma
                    if (planAyarlari.isinmaSuresi > 0) {
                        const k = push(ref(db, 'x')).key;
                        newSessions[k] = { tarih, tip: 'isinma', kategori: catKey, alet: '', saat: minToTimeStr(curMin), bitisSaat: minToTimeStr(curMin + planAyarlari.isinmaSuresi), aciklama: `${getCategoryLabel(catKey)} — Isınma`, durum: 'bekliyor', rotasyonNo: 0, grupNo: 0 };
                        advance(planAyarlari.isinmaSuresi);
                    }

                    // Rotasyonlar
                    for (let r = 0; r < numRot; r++) {
                        const rotStart = minToTimeStr(curMin);
                        const rotEnd = minToTimeStr(curMin + rotSuresi);
                        effGroups.forEach(grp => {
                            const si = aletlerSirali.indexOf(grp.baslangicAleti);
                            const ei = si >= 0 ? si : 0;
                            const alet = aletlerSirali[(ei + r) % numRot];
                            const k = push(ref(db, 'x')).key;
                            const sureDk = rotSuresi;
                            newSessions[k] = {
                                tarih, tip: 'rotasyon', kategori: catKey, alet,
                                saat: rotStart, bitisSaat: rotEnd,
                                rotasyonNo: r + 1, grupNo: grp.grupNo,
                                bolumAdi: grp.bolumAdi || null,
                                sporcu_sayisi: grp.count,
                                rotasyonSuresiDk: sureDk,
                                aciklama: `${getCategoryLabel(catKey)} — ${grp.etiket} — ${getAletLabel(alet)} (${grp.count} sporcu, ${sureDk} dk)`,
                                durum: 'bekliyor'
                            };
                        });
                        advance(rotSuresi);
                        if (r < numRot - 1 && planAyarlari.molaSuresi > 0) {
                            const k = push(ref(db, 'x')).key;
                            newSessions[k] = { tarih, tip: 'mola', kategori: catKey, alet: '', saat: minToTimeStr(curMin), bitisSaat: minToTimeStr(curMin + planAyarlari.molaSuresi), aciklama: `Rotasyon ${r + 1}→${r + 2} Arası Mola`, durum: 'bekliyor', rotasyonNo: r + 1, grupNo: 0 };
                            advance(planAyarlari.molaSuresi);
                        }
                    }
                    advance(planAyarlari.kategoriBeklemeSuresi || 20);
                }
            }
            await set(ref(db, `${firebasePath}/${selectedCompId}/program`), newSessions);
            toast(`${Object.keys(newSessions).length} oturum rotasyon programı oluşturuldu`, 'success');
            setActiveTab('program');
        } catch (err) { toast('Hata: ' + err.message, 'error'); }
        finally { setGenerating(false); }
    }, [selectedCompId, dateRange, planAyarlari, rotasyonPlani, gruplar, compCatKeys, sessions, athleteCounts, firebasePath, calcRotasyonSuresi, skipMolalar]);

    // Rotation athletes lookup
    const getRotationAthletes = useCallback((sess) => {
        if (sess.tip !== 'rotasyon' || !sess.grupNo) return [];
        const catAthletes = gruplar[sess.kategori];
        if (!catAthletes) return [];
        const groupAthletes = catAthletes[sess.grupNo - 1] || [];
        if (sess.bolumAdi) {
            const half = Math.ceil(groupAthletes.length / 2);
            return sess.bolumAdi === 'A' ? groupAthletes.slice(0, half) : groupAthletes.slice(half);
        }
        return groupAthletes;
    }, [gruplar]);

    const toggleSessionExpand = useCallback((sessId) => {
        setExpandedSessions(prev => {
            const next = new Set(prev);
            if (next.has(sessId)) next.delete(sessId); else next.add(sessId);
            return next;
        });
    }, []);

    const handlePrint = useCallback(() => {
        window.print();
    }, []);

    // rotationMatrix computed
    const rotationMatrix = useMemo(() => {
        const result = {};
        compCatKeys.forEach(catKey => {
            const aletlerSirali = getOlimpikSira(catKey, getAletlerForCat(catKey));
            if (!aletlerSirali.length) return;
            const catGruplar = gruplar[catKey] || [];
            const catPlan = rotasyonPlani[catKey] || {};
            const numRot = aletlerSirali.length;
            const effGroups = [];
            catGruplar.forEach((athletes, gi) => {
                const gp = catPlan[gi] || {};
                if (gp.bolunmus && gp.bolumler?.length >= 2) {
                    gp.bolumler.forEach(b => effGroups.push({ etiket: `G${gi + 1}${b.bolumAdi}`, baslangicAleti: b.aletKey, count: Math.ceil(athletes.length / gp.bolumler.length) }));
                } else {
                    effGroups.push({ etiket: `G${gi + 1}`, baslangicAleti: gp.baslangicAleti || aletlerSirali[gi % numRot], count: athletes.length });
                }
            });
            const matrix = {};
            aletlerSirali.forEach(a => { matrix[a] = {}; for (let r = 0; r < numRot; r++) matrix[a][r] = []; });
            effGroups.forEach(grp => {
                const si = aletlerSirali.indexOf(grp.baslangicAleti);
                const ei = si >= 0 ? si : 0;
                for (let r = 0; r < numRot; r++) matrix[aletlerSirali[(ei + r) % numRot]][r].push(grp);
            });
            result[catKey] = { aletlerSirali, numRot, matrix, effGroups };
        });
        return result;
    }, [compCatKeys, gruplar, rotasyonPlani, compKategoriler]);

    // İstatistikler
    const totalSessions = Object.keys(sessions).length;
    const completedSessions = Object.values(sessions).filter(s => s.durum === 'tamamlandi').length;
    const activeSessions = Object.values(sessions).filter(s => s.durum === 'devam').length;

    if (loading) {
        return (
            <div className="schedule-page">
                <div className="schedule-loading">
                    <div className="schedule-loading__spinner" />
                    <span>Yükleniyor...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="schedule-page">
            {/* Header */}
            <header className="sched-header">
                <div className="sched-header__left">
                    <button className="sched-back-btn" onClick={() => navigate(routePrefix)}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div>
                        <h1 className="sched-header__title">Yarışma Programı</h1>
                        <p className="sched-header__sub">Gün ve saat bazlı oturum planlaması</p>
                    </div>
                </div>
                {selectedCompId && (
                    <div className="sched-header__stats">
                        <span className="sched-stat" title="Toplam oturum">
                            <i className="material-icons-round">event_note</i> {totalSessions}
                        </span>
                        {activeSessions > 0 && (
                            <span className="sched-stat sched-stat--blue" title="Devam eden">
                                <i className="material-icons-round">play_circle</i> {activeSessions}
                            </span>
                        )}
                        <span className="sched-stat sched-stat--green" title="Tamamlanan">
                            <i className="material-icons-round">check_circle</i> {completedSessions}/{totalSessions}
                        </span>
                    </div>
                )}
            </header>

            <main className="sched-main">
                {/* Yarışma Seçici */}
                <div className="sched-selector" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <div>
                        <label className="sched-selector__label">
                            <i className="material-icons-round">location_city</i>
                            İl
                        </label>
                        <select
                            className="sched-selector__select"
                            value={selectedCity}
                            onChange={e => { setSelectedCity(e.target.value); setSelectedCompId(''); }}
                        >
                            <option value="">— Tüm İller —</option>
                            {availableCities.map(city => (
                                <option key={city} value={city}>{city}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="sched-selector__label">
                            <i className="material-icons-round">emoji_events</i>
                            Yarışma Seçin
                        </label>
                        <select
                            className="sched-selector__select"
                            value={selectedCompId}
                            onChange={e => setSelectedCompId(e.target.value)}
                        >
                            <option value="">— Yarışma seçin —</option>
                            {compList.map(c => (
                                <option key={c.id} value={c.id}>{c.isim} ({c.il || 'Bilinmiyor'})</option>
                            ))}
                        </select>
                    </div>
                </div>

                {!selectedCompId && (
                    <div className="sched-empty">
                        <i className="material-icons-round">calendar_month</i>
                        <h3>Yarışma Seçin</h3>
                        <p>Program oluşturmak için yukarıdan bir yarışma seçin</p>
                    </div>
                )}

                {selectedCompId && selectedComp && (
                    <>
                        {/* Yarışma bilgi bandı */}
                        <div className="sched-comp-info">
                            <div className="sched-comp-info__detail">
                                <i className="material-icons-round">location_on</i>
                                <span>{selectedComp.il || '—'}</span>
                            </div>
                            <div className="sched-comp-info__detail">
                                <i className="material-icons-round">date_range</i>
                                <span>{selectedComp.baslangicTarihi} → {selectedComp.bitisTarihi || selectedComp.baslangicTarihi}</span>
                            </div>
                            <div className="sched-comp-info__detail">
                                <i className="material-icons-round">category</i>
                                <span>{compCatKeys.length} kategori</span>
                            </div>
                            <div className="sched-comp-info__detail">
                                <i className="material-icons-round">groups</i>
                                <span>{Object.values(athleteCounts).reduce((a, b) => a + b, 0)} sporcu</span>
                            </div>
                        </div>

                        {/* NEW: Three tabs */}
                        <div className="sched-tabs">
                            {[
                                { id: 'ayarlar', icon: 'tune', label: 'Ayarlar' },
                                { id: 'rotasyon', icon: 'rotate_right', label: 'Rotasyon Planı' },
                                { id: 'program', icon: 'calendar_view_week', label: 'Program' },
                            ].map(tab => (
                                <button key={tab.id} className={`sched-tab ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>
                                    <i className="material-icons-round">{tab.icon}</i>
                                    {tab.label}
                                    {tab.id === 'program' && totalSessions > 0 && <span className="tab-badge">{totalSessions}</span>}
                                </button>
                            ))}
                        </div>

                        {/* TAB: AYARLAR */}
                        {activeTab === 'ayarlar' && (
                            <div className="sched-tab-content">
                                <div className="plan-settings-grid">
                                    <div className="plan-card">
                                        <h3><i className="material-icons-round">event</i> Yarışma Tarihleri</h3>
                                        <div className="plan-field">
                                            <label>Başlangıç Tarihi</label>
                                            <input type="date" value={selectedComp?.baslangicTarihi || ''}
                                                onChange={e => handleSetBaslangicTarihi(e.target.value)}
                                                disabled={!canEdit} />
                                        </div>
                                        <div className="plan-field">
                                            <label>Bitiş Tarihi</label>
                                            <input type="date" value={selectedComp?.bitisTarihi || selectedComp?.baslangicTarihi || ''}
                                                min={selectedComp?.baslangicTarihi || ''}
                                                onChange={e => {
                                                    if (!selectedCompId) return;
                                                    update(ref(db, `${firebasePath}/${selectedCompId}`), { bitisTarihi: e.target.value })
                                                        .then(() => toast('Bitiş tarihi güncellendi', 'success'))
                                                        .catch(err => toast('Hata: ' + err.message, 'error'));
                                                }}
                                                disabled={!canEdit} />
                                        </div>
                                        <div className="plan-field">
                                            <label>Toplam Gün Sayısı</label>
                                            <div className="gun-sayisi-control">
                                                <button className="gun-btn" onClick={() => handleSetGunSayisi(Math.max(1, dateRange.length - 1))} disabled={dateRange.length <= 1 || !canEdit}>
                                                    <i className="material-icons-round">remove</i>
                                                </button>
                                                <span className="gun-count">{dateRange.length}</span>
                                                <button className="gun-btn" onClick={() => handleSetGunSayisi(dateRange.length + 1)} disabled={!canEdit}>
                                                    <i className="material-icons-round">add</i>
                                                </button>
                                                <span className="gun-count-label">gün</span>
                                            </div>
                                        </div>
                                        <div className="plan-divider" />
                                        <h3 style={{marginBottom:'12px'}}><i className="material-icons-round">timer</i> Süre Ayarları</h3>
                                        {/* Başlama saati + ısınma + kategoriler arası geçiş */}
                                        {[
                                            { field: 'defaultBaslama', label: 'Varsayılan Başlama Saati', type: 'time' },
                                            { field: 'isinmaSuresi', label: 'Isınma Süresi (dk)', type: 'number', min: 0, max: 60 },
                                            { field: 'molaSuresi', label: 'Rotasyonlar Arası Mola (dk)', type: 'number', min: 0, max: 60 },
                                            { field: 'kategoriBeklemeSuresi', label: 'Kategoriler Arası Geçiş (dk)', type: 'number', min: 0, max: 120 },
                                        ].map(({ field, label, type, min, max }) => (
                                            <div key={field} className="plan-field">
                                                <label>{label}</label>
                                                <input type={type} min={min} max={max}
                                                    value={planAyarlari[field] ?? ''}
                                                    onChange={e => updatePlanAyarlari(field, type === 'number' ? +e.target.value : e.target.value)} />
                                            </div>
                                        ))}

                                        {/* Sporcu başına süre */}
                                        <div className="plan-divider" />
                                        <div className="plan-field plan-field--toggle">
                                            <label>Rotasyon süresini otomatik hesapla</label>
                                            <label className="toggle-switch">
                                                <input type="checkbox" checked={!!planAyarlari.otomatikSureHesapla}
                                                    onChange={e => updatePlanAyarlari('otomatikSureHesapla', e.target.checked)} />
                                                <span className="toggle-track" />
                                            </label>
                                        </div>
                                        {planAyarlari.otomatikSureHesapla ? (
                                            <div className="plan-field">
                                                <label>Sporcu başına süre (saniye)</label>
                                                <input type="number" min={30} max={600} step={10}
                                                    value={planAyarlari.sporculBasinaSure ?? 120}
                                                    onChange={e => updatePlanAyarlari('sporculBasinaSure', +e.target.value)} />
                                                <small className="plan-field-hint">Örn: 120 sn → 8 sporculuk grup = 16 dk rotasyon</small>
                                            </div>
                                        ) : (
                                            <div className="plan-field">
                                                <label>Sabit Rotasyon Süresi (dk)</label>
                                                <input type="number" min={5} max={120}
                                                    value={planAyarlari.rotasyonSuresi ?? 30}
                                                    onChange={e => updatePlanAyarlari('rotasyonSuresi', +e.target.value)} />
                                            </div>
                                        )}

                                        {/* Süre Özeti */}
                                        <div className="plan-summary">
                                            <strong>Rotasyon süresi tahmini</strong>
                                            {planAyarlari.otomatikSureHesapla ? (
                                                <>
                                                    <span>6 sporcu: {Math.ceil(6 * (planAyarlari.sporculBasinaSure || 120) / 60)} dk</span>
                                                    <span>8 sporcu: {Math.ceil(8 * (planAyarlari.sporculBasinaSure || 120) / 60)} dk</span>
                                                    <span>10 sporcu: {Math.ceil(10 * (planAyarlari.sporculBasinaSure || 120) / 60)} dk</span>
                                                </>
                                            ) : (
                                                <>
                                                    <span>4 alet: {(planAyarlari.isinmaSuresi || 0) + 4 * (planAyarlari.rotasyonSuresi || 30) + 3 * (planAyarlari.molaSuresi || 10)} dk</span>
                                                    <span>6 alet: {(planAyarlari.isinmaSuresi || 0) + 6 * (planAyarlari.rotasyonSuresi || 30) + 5 * (planAyarlari.molaSuresi || 10)} dk</span>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {/* Sabit Molalar Kartı */}
                                    <div className="plan-card plan-card--full">
                                        <div className="plan-card-header">
                                            <h3><i className="material-icons-round">free_breakfast</i> Sabit Molalar</h3>
                                            {canEdit && (
                                                <button className="btn-add-mola" onClick={addMola}>
                                                    <i className="material-icons-round">add</i> Mola Ekle
                                                </button>
                                            )}
                                        </div>
                                        <p className="plan-card-hint">Öğle arası veya diğer sabit molalar — program oluştururken otomatik eklenir</p>
                                        {(planAyarlari.molalar || []).length === 0 && (
                                            <div className="mola-empty">Henüz sabit mola eklenmedi</div>
                                        )}
                                        {(planAyarlari.molalar || []).map(mola => (
                                            <div key={mola.id} className="mola-row">
                                                <input className="mola-ad-input" type="text" placeholder="Mola adı"
                                                    value={mola.ad || ''} onChange={e => updateMola(mola.id, 'ad', e.target.value)} />
                                                <div className="mola-time-group">
                                                    <span className="mola-time-label">Başlangıç</span>
                                                    <input type="time" value={mola.baslangicSaat || '12:00'}
                                                        onChange={e => updateMola(mola.id, 'baslangicSaat', e.target.value)} />
                                                </div>
                                                <div className="mola-time-group">
                                                    <span className="mola-time-label">Bitiş</span>
                                                    <input type="time" value={mola.bitisSaat || '13:00'}
                                                        onChange={e => updateMola(mola.id, 'bitisSaat', e.target.value)} />
                                                </div>
                                                <span className="mola-dur">
                                                    {Math.round(parseTimeToMin(mola.bitisSaat || '13:00') - parseTimeToMin(mola.baslangicSaat || '12:00'))} dk
                                                </span>
                                                {canEdit && (
                                                    <button className="btn-remove-mola" onClick={() => removeMola(mola.id)}>
                                                        <i className="material-icons-round">delete</i>
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    {dateRange.length > 0 && (
                                        <div className="plan-card">
                                            <h3><i className="material-icons-round">date_range</i> Günlük Ayarlar</h3>
                                            {dateRange.map((tarih, di) => {
                                                const ga = planAyarlari.gunAyarlari?.[tarih] || {};
                                                return (
                                                    <div key={tarih} className="gun-ayar-block">
                                                        <div className="gun-ayar-header">
                                                            <span className="gun-badge">{di + 1}. Gün</span>
                                                            <span className="gun-tarih">{formatDateTR(tarih)}</span>
                                                        </div>
                                                        <div className="gun-ayar-fields">
                                                            <div className="plan-field">
                                                                <label>Başlama Saati</label>
                                                                <input type="time" value={ga.baslamaSaati || planAyarlari.defaultBaslama || '09:00'}
                                                                    onChange={e => updateGunAyar(tarih, 'baslamaSaati', e.target.value)} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {compCatKeys.length > 0 && (
                                        <div className="plan-card">
                                            <h3><i className="material-icons-round">view_week</i> Kategori → Gün Ataması</h3>
                                            <p className="plan-card-hint">Her kategori için hangi gün yarışılacağını seçin</p>
                                            <div className="cat-day-assign-table">
                                                <div className="cat-day-row cat-day-header">
                                                    <span className="cat-day-name">Kategori</span>
                                                    {dateRange.map((d, i) => (
                                                        <span key={d} className="cat-day-col">
                                                            <strong>{i + 1}. Gün</strong>
                                                            <small>{new Date(d).toLocaleDateString('tr-TR', {day:'numeric', month:'short'})}</small>
                                                        </span>
                                                    ))}
                                                </div>
                                                {compCatKeys.map(catKey => {
                                                    const curDay = planAyarlari.kategoriGunAtamalari?.[catKey] ?? 0;
                                                    return (
                                                        <div key={catKey} className="cat-day-row">
                                                            <span className="cat-day-name">{getCategoryLabel(catKey)}</span>
                                                            {dateRange.map((d, i) => (
                                                                <span key={d} className="cat-day-col">
                                                                    {dateRange.length === 1 ? (
                                                                        <span className="cat-day-dot active" title="Tek gün — tüm kategoriler bu günde" />
                                                                    ) : (
                                                                        <label className="cat-day-radio">
                                                                            <input type="radio" name={`day-cat-${catKey}`} checked={curDay === i}
                                                                                onChange={() => updateKategoriGun(catKey, i)} />
                                                                            <span className={`cat-day-dot ${curDay === i ? 'active' : ''}`} />
                                                                        </label>
                                                                    )}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* TAB: ROTASYON PLANI */}
                        {activeTab === 'rotasyon' && (
                            <div className="sched-tab-content">
                                {compCatKeys.length === 0 && <div className="sched-empty"><i className="material-icons-round">category</i><p>Yarışmada kategori bulunamadı</p></div>}
                                {compCatKeys.map(catKey => {
                                    const aletlerSirali = getOlimpikSira(catKey, getAletlerForCat(catKey));
                                    const catGruplar = gruplar[catKey] || [];
                                    const catPlan = rotasyonPlani[catKey] || {};
                                    const mat = rotationMatrix[catKey];
                                    return (
                                        <div key={catKey} className="rot-cat-section">
                                            {/* Category header */}
                                            <div className="rot-cat-header">
                                                <div className="rot-cat-title">
                                                    <h3>{getCategoryLabel(catKey)}</h3>
                                                    <div className="olimpik-sira-chips">
                                                        <span className="olimpik-label">Olimpik Sıra:</span>
                                                        {aletlerSirali.map((a, i) => (
                                                            <span key={a}>{i > 0 && <span className="arrow-chip">→</span>}<span className="alet-chip-small">{getAletLabel(a)}</span></span>
                                                        ))}
                                                    </div>
                                                </div>
                                                {canEdit && (
                                                    <button className="btn-auto-assign" onClick={() => handleAutoAssign(catKey)}>
                                                        <i className="material-icons-round">auto_fix_high</i>Olimpik Sıraya Göre Ata
                                                    </button>
                                                )}
                                            </div>

                                            {catGruplar.length === 0 ? (
                                                <div className="no-groups-msg">
                                                    <i className="material-icons-round">info</i>
                                                    Bu kategori için henüz çıkış sırası oluşturulmamış.
                                                    <strong> Çıkış Sırası</strong> sayfasından grupları oluşturun.
                                                </div>
                                            ) : (
                                                <div className="rot-groups-list">
                                                    {catGruplar.map((athletes, gi) => {
                                                        const gp = catPlan[gi] || {};
                                                        const isBol = gp.bolunmus;
                                                        const startAlet = gp.baslangicAleti || '';
                                                        const startIdx = aletlerSirali.indexOf(startAlet);
                                                        return (
                                                            <div key={gi} className={`rot-group-card ${isBol ? 'bolunmus' : ''}`}>
                                                                <div className="rot-group-top">
                                                                    <div className="rot-group-id">
                                                                        <span className="rot-group-num">Grup {gi + 1}</span>
                                                                        <span className="rot-group-count">{athletes.length} sporcu</span>
                                                                    </div>
                                                                    {!isBol && (
                                                                        <div className="rot-alet-select">
                                                                            <label>Başlangıç Aleti</label>
                                                                            <select value={startAlet} onChange={e => handleGroupAletChange(catKey, gi, e.target.value)} disabled={!canEdit}>
                                                                                <option value="">— Seç —</option>
                                                                                {aletlerSirali.map(a => <option key={a} value={a}>{getAletLabel(a)}</option>)}
                                                                            </select>
                                                                        </div>
                                                                    )}
                                                                    {canEdit && aletlerSirali.length > 1 && (
                                                                        <button className={`btn-bol ${isBol ? 'active' : ''}`} onClick={() => handleToggleBolunme(catKey, gi)}>
                                                                            <i className="material-icons-round">{isBol ? 'call_merge' : 'call_split'}</i>
                                                                            {isBol ? 'Birleştir' : 'Böl'}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                {isBol && gp.bolumler && (
                                                                    <div className="rot-bolumler">
                                                                        {gp.bolumler.map((b, bi) => (
                                                                            <div key={bi} className="rot-bolum">
                                                                                <span className="bolum-badge">{b.bolumAdi}</span>
                                                                                <span className="bolum-count">~{Math.ceil(athletes.length / gp.bolumler.length)} sporcu</span>
                                                                                <label>Alet:</label>
                                                                                <select value={b.aletKey || ''} onChange={e => handleBolumAletChange(catKey, gi, bi, e.target.value)} disabled={!canEdit}>
                                                                                    {aletlerSirali.map(a => <option key={a} value={a}>{getAletLabel(a)}</option>)}
                                                                                </select>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                                {!isBol && startAlet && (
                                                                    <div className="rot-sequence">
                                                                        {aletlerSirali.map((_, ri) => {
                                                                            const ai = (startIdx + ri) % aletlerSirali.length;
                                                                            return (
                                                                                <span key={ri} className="rot-seq-step">
                                                                                    {ri > 0 && <i className="material-icons-round seq-arrow">arrow_forward</i>}
                                                                                    <span className="seq-num">{ri + 1}</span>
                                                                                    <span className="seq-alet">{getAletLabel(aletlerSirali[ai])}</span>
                                                                                </span>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                            {/* Rotation Matrix Preview */}
                                            {mat && mat.effGroups.length > 0 && (
                                                <div className="rot-matrix-section">
                                                    <h4><i className="material-icons-round">grid_view</i> Rotasyon Matrisi</h4>
                                                    <div className="rot-matrix-scroll">
                                                        <table className="rot-matrix-table">
                                                            <thead>
                                                                <tr>
                                                                    <th className="alet-col">Alet</th>
                                                                    {Array.from({ length: mat.numRot }, (_, r) => {
                                                                        const bas = parseTimeToMin(planAyarlari.defaultBaslama || '09:00');
                                                                        const sm = bas + (planAyarlari.isinmaSuresi || 15) + r * ((planAyarlari.rotasyonSuresi || 30) + (planAyarlari.molaSuresi || 10));
                                                                        return <th key={r}><div className="rot-th-num">Rot. {r + 1}</div><div className="rot-th-time">{minToTimeStr(sm)}–{minToTimeStr(sm + (planAyarlari.rotasyonSuresi || 30))}</div></th>;
                                                                    })}
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {mat.aletlerSirali.map(alet => (
                                                                    <tr key={alet}>
                                                                        <td className="alet-name-cell"><span className="alet-badge">{getAletLabel(alet)}</span></td>
                                                                        {Array.from({ length: mat.numRot }, (_, r) => (
                                                                            <td key={r} className="group-cell">
                                                                                {(mat.matrix[alet][r] || []).map((g, gi) => (
                                                                                    <div key={gi} className="group-chip">
                                                                                        <span>{g.etiket}</span>
                                                                                        {g.count > 0 && <span className="chip-count">{g.count}</span>}
                                                                                    </div>
                                                                                ))}
                                                                            </td>
                                                                        ))}
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {canCreate && compCatKeys.length > 0 && (
                                    <div className="generate-wrapper">
                                        <button className="btn-generate-rot" onClick={handleGenerateRotationSchedule} disabled={generating}>
                                            {generating ? <><div className="spinner-small" /><span>Oluşturuluyor...</span></> : <><i className="material-icons-round">play_circle</i><span>Rotasyon Programını Oluştur ve Kaydet</span></>}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* TAB: PROGRAM */}
                        {activeTab === 'program' && (
                            <div className="sched-tab-content">
                                {/* Print-only header */}
                                <div className="print-header print-only">
                                    <h1>{selectedComp?.isim || 'Yarışma'}</h1>
                                    <div className="print-meta">
                                        <span><strong>İl:</strong> {selectedComp?.il || '—'}</span>
                                        <span><strong>Tarih:</strong> {selectedComp?.baslangicTarihi} {selectedComp?.bitisTarihi && selectedComp.bitisTarihi !== selectedComp.baslangicTarihi ? `— ${selectedComp.bitisTarihi}` : ''}</span>
                                        <span><strong>Kategori:</strong> {compCatKeys.length} | <strong>Sporcu:</strong> {Object.values(athleteCounts).reduce((a, b) => a + b, 0)}</span>
                                    </div>
                                </div>
                                {canCreate && (
                                    <div className="sched-program-actions">
                                        <button className="sched-auto-btn" onClick={handleAutoGenerate} disabled={generating}>
                                            <i className="material-icons-round">auto_fix_high</i>
                                            <div><strong>Temel Otomatik Program</strong><small>Sporcu sayısına göre basit plan</small></div>
                                        </button>
                                        <button className="sched-rot-btn" onClick={() => setActiveTab('rotasyon')} disabled={generating}>
                                            <i className="material-icons-round">rotate_right</i>
                                            <div><strong>Rotasyon Planla</strong><small>Olimpik sıra ve grup ataması</small></div>
                                        </button>
                                        {totalSessions > 0 && (
                                            <button className="sched-pdf-btn" onClick={handlePrint}>
                                                <i className="material-icons-round">picture_as_pdf</i>
                                                <div><strong>PDF İndir</strong><small>Programı yazdır / PDF kaydet</small></div>
                                            </button>
                                        )}
                                    </div>
                                )}
                                {dateRange.map(dateStr => (
                                    <div key={dateStr} className="sched-day">
                                        <div className="sched-day__header">
                                            <div className="sched-day__date">
                                                <span className="sched-day__num">{new Date(dateStr).getDate()}</span>
                                                <div className="sched-day__meta">
                                                    <strong>{formatDateTR(dateStr)}</strong>
                                                    <span className="sched-day__count">{(sessionsByDate[dateStr] || []).length} oturum</span>
                                                </div>
                                            </div>
                                            {canCreate && <button className="sched-add-btn" onClick={() => openAddModal(dateStr)}><i className="material-icons-round">add</i>Oturum Ekle</button>}
                                        </div>
                                        {(sessionsByDate[dateStr] || []).length === 0 ? (
                                            <div className="sched-day__empty"><i className="material-icons-round">event_busy</i>Bu gün için oturum yok</div>
                                        ) : (
                                            <div className="sched-day__timeline">
                                                {(sessionsByDate[dateStr] || []).map(sess => {
                                                    const rotAthletes = getRotationAthletes(sess);
                                                    const isExpanded = expandedSessions.has(sess.id);
                                                    return (
                                                        <div key={sess.id} className={`sched-session sched-session--${sess.durum || 'bekliyor'} sched-session--tip-${sess.tip || 'manuel'}${isExpanded ? ' expanded' : ''}`}>
                                                            <div className="sched-session__time">
                                                                <span className="sched-session__start">{sess.saat}</span>
                                                                <span className="sched-session__sep">—</span>
                                                                <span className="sched-session__end">{sess.bitisSaat}</span>
                                                            </div>
                                                            <div className="sched-session__line" />
                                                            <div className="sched-session__body">
                                                                <div className="sched-session__top">
                                                                    {sess.tip && sess.tip !== 'manuel' && (
                                                                        <span className={`sess-tip-badge sess-tip--${sess.tip}`}>
                                                                            {sess.tip === 'isinma' ? 'Isınma' : sess.tip === 'mola' ? 'Mola' : sess.tip === 'rotasyon' ? `Rot.${sess.rotasyonNo || ''}` : sess.tip}
                                                                        </span>
                                                                    )}
                                                                    {sess.grupNo > 0 && <span className="sess-grup-badge">Grup {sess.grupNo}{sess.bolumAdi || ''}</span>}
                                                                    <span className="sched-session__cat">{getCategoryLabel(sess.kategori)}</span>
                                                                    {sess.alet && <span className="sched-session__alet">{getAletLabel(sess.alet)}</span>}
                                                                    <span className="sched-session__status" style={{ background: SESSION_COLORS[sess.durum || 'bekliyor'] }}>{SESSION_LABELS[sess.durum || 'bekliyor']}</span>
                                                                    {rotAthletes.length > 0 && (
                                                                        <button className="btn-expand-athletes no-print" onClick={() => toggleSessionExpand(sess.id)} title={isExpanded ? 'Sporcuları gizle' : 'Sporcuları göster'}>
                                                                            <i className="material-icons-round">{isExpanded ? 'expand_less' : 'people'}</i>
                                                                            <span>{rotAthletes.length} sporcu</span>
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                {sess.aciklama && <p className="sched-session__desc">{sess.aciklama}</p>}
                                                                {/* Athlete list - shown when expanded */}
                                                                {rotAthletes.length > 0 && isExpanded && (
                                                                    <div className="sess-athlete-list">
                                                                        <div className="athlete-list-grid">
                                                                            {rotAthletes.map((ath, ai) => (
                                                                                <div key={ath.id || ai} className="athlete-list-row">
                                                                                    <span className="ath-order">{ath.sirasi || ai + 1}</span>
                                                                                    <span className="ath-name">{ath.ad} {ath.soyad}</span>
                                                                                    <span className="ath-club">{ath.kulup || ath.okul || ''}</span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                {(canEdit || canDelete) && (
                                                                    <div className="sched-session__actions no-print">
                                                                        {canEdit && sess.durum !== 'tamamlandi' && <button className="sched-action sched-action--start" onClick={() => handleStatusChange(sess.id, sess.durum === 'devam' ? 'tamamlandi' : 'devam')}><i className="material-icons-round">{sess.durum === 'devam' ? 'check_circle' : 'play_arrow'}</i></button>}
                                                                        {canEdit && sess.durum === 'tamamlandi' && <button className="sched-action sched-action--undo" onClick={() => handleStatusChange(sess.id, 'bekliyor')}><i className="material-icons-round">undo</i></button>}
                                                                        {canEdit && <button className="sched-action sched-action--edit" onClick={() => openEditModal(sess)}><i className="material-icons-round">edit</i></button>}
                                                                        {canDelete && <button className="sched-action sched-action--delete" onClick={() => handleDelete(sess.id)}><i className="material-icons-round">delete</i></button>}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                ))}

                                {/* ── Premium Print View (hidden normally, shown @media print) ── */}
                                <div className="print-schedule-view">
                                    {/* Header */}
                                    <div className="psv-header">
                                        <img src="/logo.png" alt="TCF Logo" className="psv-logo" />
                                        <div className="psv-title-block">
                                            <h1 className="psv-comp-name">{selectedComp?.isim}</h1>
                                            <div className="psv-meta">
                                                <span><i className="material-icons-round">location_on</i>{selectedComp?.il}</span>
                                                <span><i className="material-icons-round">calendar_today</i>{selectedComp?.baslangicTarihi}{selectedComp?.bitisTarihi && selectedComp.bitisTarihi !== selectedComp.baslangicTarihi ? ` — ${selectedComp.bitisTarihi}` : ''}</span>
                                                <span><i className="material-icons-round">category</i>{compCatKeys.length} Kategori</span>
                                                <span><i className="material-icons-round">groups</i>{Object.values(athleteCounts).reduce((a, b) => a + b, 0)} Sporcu</span>
                                            </div>
                                        </div>
                                        <div className="psv-stamp">TÜRKİYE CİMNASTİK<br/>FEDERASYONU</div>
                                    </div>
                                    <div className="psv-divider" />

                                    {/* Per-day sections */}
                                    {dateRange.map((dateStr, di) => {
                                        const daySessions = sessionsByDate[dateStr] || [];
                                        if (!daySessions.length) return null;

                                        // Group by category then by rotasyonNo+saat
                                        const catSessions = {};
                                        daySessions.forEach(sess => {
                                            if (!catSessions[sess.kategori]) catSessions[sess.kategori] = { isinma: [], rotasyons: {}, molas: {} };
                                            if (sess.tip === 'isinma') catSessions[sess.kategori].isinma.push(sess);
                                            else if (sess.tip === 'rotasyon') {
                                                const rk = `${sess.rotasyonNo}__${sess.saat}`;
                                                if (!catSessions[sess.kategori].rotasyons[rk]) catSessions[sess.kategori].rotasyons[rk] = [];
                                                catSessions[sess.kategori].rotasyons[rk].push(sess);
                                            }
                                        });

                                        return (
                                            <div key={dateStr} className="psv-day">
                                                <div className="psv-day-header">
                                                    <span className="psv-day-num">{di + 1}. GÜN</span>
                                                    <span className="psv-day-date">{formatDateTR(dateStr)}</span>
                                                </div>

                                                {Object.entries(catSessions).map(([catKey, catData]) => (
                                                    <div key={catKey} className="psv-cat-block">
                                                        <div className="psv-cat-header">
                                                            <span className="psv-cat-name">{getCategoryLabel(catKey)}</span>
                                                            {catData.isinma[0] && <span className="psv-isinma">Isınma: {catData.isinma[0].saat} — {catData.isinma[0].bitisSaat}</span>}
                                                        </div>

                                                        {Object.entries(catData.rotasyons)
                                                            .sort(([, a], [, b]) => (a[0]?.saat || '').localeCompare(b[0]?.saat || ''))
                                                            .map(([rk, rotSessions]) => {
                                                                const rotNo = rotSessions[0]?.rotasyonNo;
                                                                const saat = rotSessions[0]?.saat;
                                                                const bitisSaat = rotSessions[0]?.bitisSaat;
                                                                return (
                                                                    <div key={rk} className="psv-rotation-block">
                                                                        <div className="psv-rot-header">
                                                                            <span className="psv-rot-badge">ROT. {rotNo}</span>
                                                                            <span className="psv-rot-time">{saat} — {bitisSaat}</span>
                                                                        </div>
                                                                        <table className="psv-rot-table">
                                                                            <thead>
                                                                                <tr>
                                                                                    {rotSessions.map(sess => (
                                                                                        <th key={sess.id} className="psv-group-th">
                                                                                            <span className="psv-grp-badge">GRUP {sess.grupNo}{sess.bolumAdi || ''}</span>
                                                                                            <span className="psv-alet-name">{getAletLabel(sess.alet)}</span>
                                                                                        </th>
                                                                                    ))}
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody>
                                                                                {(() => {
                                                                                    const cols = rotSessions.map(sess => getRotationAthletes(sess));
                                                                                    const maxLen = Math.max(...cols.map(c => c.length), 0);
                                                                                    return Array.from({ length: maxLen }, (_, ai) => (
                                                                                        <tr key={ai}>
                                                                                            {cols.map((col, ci) => {
                                                                                                const ath = col[ai];
                                                                                                return (
                                                                                                    <td key={ci} className="psv-ath-cell">
                                                                                                        {ath ? (
                                                                                                            <>
                                                                                                                <span className="psv-ath-no">{ath.sirasi || ai + 1}</span>
                                                                                                                <span className="psv-ath-name">{ath.ad} {ath.soyad}</span>
                                                                                                                <span className="psv-ath-club">{ath.kulup || ath.okul || ''}</span>
                                                                                                                <span className={`psv-ath-type ${(ath.yarismaTuru || 'ferdi').toLowerCase().includes('tak') ? 'takim' : 'ferdi'}`}>
                                                                                                                    {(ath.yarismaTuru || 'ferdi').toLowerCase().includes('tak') ? 'TAK' : 'FRD'}
                                                                                                                </span>
                                                                                                            </>
                                                                                                        ) : null}
                                                                                                    </td>
                                                                                                );
                                                                                            })}
                                                                                        </tr>
                                                                                    ));
                                                                                })()}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                );
                                                            })}
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })}

                                    <div className="psv-footer">
                                        <span>Bu belge TCF Yarışma Yönetim Sistemi tarafından oluşturulmuştur.</span>
                                        <span>{new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </main>

            {/* ═══ ADD/EDIT MODAL ═══ */}
            {isModalOpen && (
                <div className="sched-overlay" onClick={closeModal}>
                    <div className="sched-modal" onClick={e => e.stopPropagation()}>
                        <div className="sched-modal__header">
                            <h2>{editingSession ? 'Oturumu Düzenle' : 'Yeni Oturum'}</h2>
                            <button className="sched-modal__close" onClick={closeModal}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>

                        <div className="sched-modal__body">
                            {/* Tarih */}
                            <div className="sched-field">
                                <label>Tarih</label>
                                <select
                                    value={formData.tarih}
                                    onChange={e => setFormData(p => ({ ...p, tarih: e.target.value }))}
                                >
                                    {dateRange.map(d => (
                                        <option key={d} value={d}>{formatDateTR(d)}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Saat Aralığı */}
                            <div className="sched-field-row">
                                <div className="sched-field">
                                    <label>Başlangıç</label>
                                    <input
                                        type="time"
                                        value={formData.saat}
                                        onChange={e => setFormData(p => ({ ...p, saat: e.target.value }))}
                                    />
                                </div>
                                <div className="sched-field">
                                    <label>Bitiş</label>
                                    <input
                                        type="time"
                                        value={formData.bitisSaat}
                                        onChange={e => setFormData(p => ({ ...p, bitisSaat: e.target.value }))}
                                    />
                                </div>
                            </div>

                            {/* Kategori */}
                            <div className="sched-field">
                                <label>Kategori</label>
                                <select
                                    value={formData.kategori}
                                    onChange={e => setFormData(p => ({ ...p, kategori: e.target.value, alet: '' }))}
                                >
                                    <option value="">Seçin</option>
                                    {compCatKeys.map(catKey => (
                                        <option key={catKey} value={catKey}>{getCategoryLabel(catKey)}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Alet */}
                            {formData.kategori && (
                                <div className="sched-field">
                                    <label>Alet (Opsiyonel)</label>
                                    <select
                                        value={formData.alet}
                                        onChange={e => setFormData(p => ({ ...p, alet: e.target.value }))}
                                    >
                                        <option value="">Tümü / Belirtilmemiş</option>
                                        {getAletlerForCat(formData.kategori).map(a => (
                                            <option key={a} value={a}>{getAletLabel(a)}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Açıklama */}
                            <div className="sched-field">
                                <label>Açıklama (Opsiyonel)</label>
                                <input
                                    type="text"
                                    value={formData.aciklama}
                                    onChange={e => setFormData(p => ({ ...p, aciklama: e.target.value }))}
                                    placeholder="Ör: Genç Erkek yer serileri"
                                />
                            </div>

                            {/* Durum */}
                            <div className="sched-field">
                                <label>Durum</label>
                                <div className="sched-status-pills">
                                    {Object.entries(SESSION_LABELS).map(([key, label]) => (
                                        <button
                                            key={key}
                                            className={`sched-pill ${formData.durum === key ? 'sched-pill--active' : ''}`}
                                            style={formData.durum === key ? { background: SESSION_COLORS[key], color: '#fff' } : {}}
                                            onClick={() => setFormData(p => ({ ...p, durum: key }))}
                                            type="button"
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="sched-modal__footer">
                            <button className="sched-modal__btn sched-modal__btn--cancel" onClick={closeModal}>
                                İptal
                            </button>
                            <button className="sched-modal__btn sched-modal__btn--save" onClick={handleSave}>
                                <i className="material-icons-round">{editingSession ? 'save' : 'add'}</i>
                                {editingSession ? 'Güncelle' : 'Ekle'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
