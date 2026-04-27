import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, push, set, remove, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { useDiscipline } from '../lib/DisciplineContext';
import { logAction } from '../lib/auditLogger';
import './CompetitionSchedulePage.css';
import { generateCompetitionPDF } from '../utils/competitionPDF';

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

const PLAN_DEFAULTS = {
    rotasyonSuresi: 30, molaSuresi: 10, isinmaSuresi: 15,
    kategoriBeklemeSuresi: 20, dalgaAraBekleme: 5, defaultBaslama: '09:00',
    sporculBasinaSure: 120, otomatikSureHesapla: true,
    gunAyarlari: {}, kategoriGunAtamalari: {}, molalar: []
};

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
    const [insertAfterSession, setInsertAfterSession] = useState(null); // araya ekleme modu
    const [generating, setGenerating] = useState(false);
    const [formData, setFormData] = useState({
        tarih: '',
        saat: '09:00',
        bitisSaat: '10:00',
        tip: 'manuel',
        kategori: '',
        alet: '',
        aciklama: '',
        durum: 'bekliyor',
    });

    // New state
    const [activeTab, setActiveTab] = useState('ayarlar'); // 'ayarlar'|'rotasyon'|'program'
    const [planAyarlari, setPlanAyarlari] = useState(PLAN_DEFAULTS);
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
        if (!selectedCompId) { setPlanAyarlari(PLAN_DEFAULTS); return; }
        setPlanAyarlari(PLAN_DEFAULTS); // yarışma değişince eski veriyi hemen temizle
        const unsub = onValue(ref(db, `${firebasePath}/${selectedCompId}/planAyarlari`), s => {
            const data = s.val();
            if (!data) return;
            // Firebase array'leri object olarak saklıyor → geri array'e çevir
            if (data.molalar && !Array.isArray(data.molalar)) {
                data.molalar = Object.values(data.molalar);
            }
            setPlanAyarlari({ ...PLAN_DEFAULTS, ...data });
        });
        return () => unsub();
    }, [selectedCompId, firebasePath]);

    // rotasyonPlani from Firebase
    useEffect(() => {
        if (!selectedCompId) { setRotasyonPlani({}); return; }
        setRotasyonPlani({}); // yarışma değişince temizle
        const unsub = onValue(ref(db, `${firebasePath}/${selectedCompId}/rotasyonPlani`), s => setRotasyonPlani(s.val() || {}));
        return () => unsub();
    }, [selectedCompId, firebasePath]);

    // gruplar from siralama
    useEffect(() => {
        if (!selectedCompId) { setGruplar({}); return; }
        setGruplar({}); // yarışma değişince temizle
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
        setInsertAfterSession(null);
        setFormData({
            tarih: tarih || dateRange[0] || '',
            saat: '09:00',
            bitisSaat: '10:00',
            tip: 'manuel',
            kategori: compCatKeys[0] || '',
            alet: '',
            aciklama: '',
            durum: 'bekliyor',
        });
        setIsModalOpen(true);
    };

    const openEditModal = (sess) => {
        setEditingSession(sess);
        setInsertAfterSession(null);
        setFormData({
            tarih: sess.tarih || '',
            saat: sess.saat || '09:00',
            bitisSaat: sess.bitisSaat || '10:00',
            tip: sess.tip || 'manuel',
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
        setInsertAfterSession(null);
    };

    // Oturumlar arasına ekleme modalı
    const openInsertAfterModal = useCallback((afterSess, tarih) => {
        setInsertAfterSession(afterSess);
        setEditingSession(null);
        const startMin = parseTimeToMin(afterSess.bitisSaat || '09:00');
        setFormData({
            tarih,
            saat: afterSess.bitisSaat || '09:00',
            bitisSaat: minToTimeStr(startMin + 30),
            tip: 'manuel',
            kategori: afterSess.kategori || compCatKeys[0] || '',
            alet: afterSess.alet || '',
            aciklama: '',
            durum: 'bekliyor',
        });
        setIsModalOpen(true);
    }, [compCatKeys]);

    // Ödül töreni hızlı ekleme modalı
    const openAwardCeremonyModal = useCallback((tarih) => {
        setEditingSession(null);
        setInsertAfterSession(null);
        const daySessions = sessionsByDate[tarih] || [];
        const lastSess = daySessions.length > 0 ? daySessions[daySessions.length - 1] : null;
        const startTime = lastSess?.bitisSaat || '17:00';
        const startMin = parseTimeToMin(startTime);
        setFormData({
            tarih,
            saat: startTime,
            bitisSaat: minToTimeStr(startMin + 45),
            tip: 'odulToreni',
            kategori: '',
            alet: '',
            aciklama: 'Ödül Töreni',
            durum: 'bekliyor',
        });
        setIsModalOpen(true);
    }, [sessionsByDate]);

    const handleSave = async () => {
        if (!formData.saat) {
            toast('Saat zorunludur', 'error');
            return;
        }
        if (formData.tip !== 'odulToreni' && !formData.kategori) {
            toast('Kategori zorunludur', 'error');
            return;
        }

        const sessionData = {
            tarih: formData.tarih,
            saat: formData.saat,
            bitisSaat: formData.bitisSaat,
            tip: formData.tip || 'manuel',
            kategori: formData.kategori,
            alet: formData.alet || '',
            aciklama: formData.aciklama || (
                formData.tip === 'odulToreni' ? 'Ödül Töreni' :
                `${getCategoryLabel(formData.kategori)}${formData.alet ? ' — ' + getAletLabel(formData.alet) : ''}`
            ),
            durum: formData.durum,
        };

        try {
            if (editingSession) {
                await update(ref(db, `${firebasePath}/${selectedCompId}/program/${editingSession.id}`), sessionData);
                toast('Oturum güncellendi', 'success');
            } else {
                await push(ref(db, `${firebasePath}/${selectedCompId}/program`), sessionData);

                // ── Araya ekleme: sonraki oturumları kaydır ──────────────────
                if (insertAfterSession) {
                    const insertAtTime = insertAfterSession.bitisSaat; // ekleme noktası
                    const newDurationMin = parseTimeToMin(formData.bitisSaat) - parseTimeToMin(formData.saat);
                    if (newDurationMin > 0) {
                        const daySessions = sessionsByDate[formData.tarih] || [];
                        // Ekleme noktasından sonra gelen tüm oturumları kaydır
                        const toShift = daySessions.filter(s => s.saat >= insertAtTime);
                        if (toShift.length > 0) {
                            const shiftUpdates = {};
                            toShift.forEach(s => {
                                shiftUpdates[`${firebasePath}/${selectedCompId}/program/${s.id}/saat`] =
                                    minToTimeStr(parseTimeToMin(s.saat) + newDurationMin);
                                shiftUpdates[`${firebasePath}/${selectedCompId}/program/${s.id}/bitisSaat`] =
                                    minToTimeStr(parseTimeToMin(s.bitisSaat) + newDurationMin);
                            });
                            await update(ref(db), shiftUpdates);
                            toast(`${toShift.length} oturum ${newDurationMin} dk ileriye kaydırıldı`, 'info');
                        }
                    }
                    setInsertAfterSession(null);
                } else {
                    toast('Oturum eklendi', 'success');
                }
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

    const handleReorderKategori = useCallback((tarih, fromIdx, toIdx) => {
        const dayKats = [...(planAyarlari.gunAyarlari?.[tarih]?.kategoriSirasi ||
            compCatKeys.filter(ck => (planAyarlari.kategoriGunAtamalari?.[ck] ?? 0) === dateRange.indexOf(tarih)))];
        if (toIdx < 0 || toIdx >= dayKats.length) return;
        const reordered = [...dayKats];
        const [moved] = reordered.splice(fromIdx, 1);
        reordered.splice(toIdx, 0, moved);
        const updated = {
            ...planAyarlari,
            gunAyarlari: {
                ...(planAyarlari.gunAyarlari || {}),
                [tarih]: { ...(planAyarlari.gunAyarlari?.[tarih] || {}), kategoriSirasi: reordered }
            }
        };
        setPlanAyarlari(updated);
        savePlanAyar(updated);
    }, [planAyarlari, compCatKeys, dateRange, savePlanAyar]);

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
        const numAlet = aletlerSirali.length;
        const newCatPlan = {};
        catGruplar.forEach((_, idx) => {
            const dalgaNo = Math.floor(idx / numAlet) + 1;
            newCatPlan[idx] = { ...(rotasyonPlani[catKey]?.[idx] || {}), baslangicAleti: aletlerSirali[idx % numAlet], bolunmus: false, bolumler: undefined, dalgaNo };
        });
        setRotasyonPlani(prev => ({ ...prev, [catKey]: newCatPlan }));
        await saveRotasyonPlaniForCat(catKey, newCatPlan);
        toast(`${getCategoryLabel(catKey)} için olimpik sıraya göre atandı`, 'success');
    }, [gruplar, rotasyonPlani, saveRotasyonPlaniForCat, compKategoriler]);

    const handleGroupDalgaNoChange = useCallback(async (catKey, idx, val) => {
        const dalgaNo = val ? Number(val) : null;
        const updatedCat = { ...(rotasyonPlani[catKey] || {}), [idx]: { ...(rotasyonPlani[catKey]?.[idx] || {}), dalgaNo } };
        setRotasyonPlani(prev => ({ ...prev, [catKey]: updatedCat }));
        await saveRotasyonPlaniForCat(catKey, updatedCat);
    }, [rotasyonPlani, saveRotasyonPlaniForCat]);

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

    // Paralel grup: aynı anda aynı alette iki grup birden
    const handleToggleParalel = useCallback(async (catKey, idx) => {
        const cur = rotasyonPlani[catKey]?.[idx] || {};
        const updatedCat = { ...(rotasyonPlani[catKey] || {}), [idx]: { ...cur, paralel: !cur.paralel } };
        setRotasyonPlani(prev => ({ ...prev, [catKey]: updatedCat }));
        await saveRotasyonPlaniForCat(catKey, updatedCat);
    }, [rotasyonPlani, saveRotasyonPlaniForCat]);

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
    // dalgaSlots: array of slots, her slot [grp] veya [grp1, grp2] (paralel)
    // Paralel slotta 2 grup aynı alette SIRAYLA yarışır → sporcu sayıları TOPLANIR
    // Dalganın en yavaş slotu rotasyon süresini belirler (slot'lar farklı aletlerde aynı anda)
    const calcRotasyonSuresi = useCallback((catKey, dalgaSlots) => {
        if (!planAyarlari.otomatikSureHesapla) return planAyarlari.rotasyonSuresi || 30;
        const sn = planAyarlari.sporculBasinaSure || 120;
        const maxSlotCount = (dalgaSlots || []).reduce((mx, slot) => {
            // slot Array.isArray → paralel çift; değilse tek grup
            const slotCount = Array.isArray(slot)
                ? slot.reduce((s, g) => s + (g.count || 0), 0)
                : (slot.count || 0);
            return Math.max(mx, slotCount);
        }, 0);
        if (!maxSlotCount) return planAyarlari.rotasyonSuresi || 30;
        return Math.ceil((maxSlotCount * sn) / 60);
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

    // DALGA (WAVE) tabanlı program oluşturucu
    // Mantık: numAlet adet alet varsa → bir dalgaya numAlet grup girer.
    // Bu numAlet grup hepsi ayrı aparatta aynı anda başlar, numAlet rotasyon adımı yapar → TÜMÜbitince sonraki dalga gelir.
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

            const sabitMolalar = (planAyarlari.molalar || [])
                .filter(m => m.baslangicSaat && m.bitisSaat)
                .sort((a, b) => parseTimeToMin(a.baslangicSaat) - parseTimeToMin(b.baslangicSaat));

            for (const tarih of dateRange) {
                const gunAyar = planAyarlari.gunAyarlari?.[tarih] || {};
                let curMin = parseTimeToMin(gunAyar.baslamaSaati || planAyarlari.defaultBaslama || '09:00');
                // Kullanıcı sırası varsa onu kullan, yoksa varsayılan sıra
                const rawKats = dayCategories[tarih] || [];
                const sirali = gunAyar.kategoriSirasi;
                const aktifKats = sirali && sirali.length > 0
                    ? [...sirali.filter(k => rawKats.includes(k)), ...rawKats.filter(k => !sirali.includes(k))]
                    : rawKats;
                const molaEklendi = new Set();

                // Sabit molayı programasekle ve zamanı öne al
                const advance = (dk) => {
                    for (const mola of sabitMolalar) {
                        const ms = parseTimeToMin(mola.baslangicSaat);
                        const me = parseTimeToMin(mola.bitisSaat);
                        if (!molaEklendi.has(mola.id) && curMin <= ms && curMin + dk > ms) {
                            molaEklendi.add(mola.id);
                            const k = push(ref(db, 'x')).key;
                            newSessions[k] = { tarih, tip: 'mola', molaAdi: mola.ad || 'Mola', alet: '', saat: minToTimeStr(ms), bitisSaat: minToTimeStr(me), aciklama: mola.ad || 'Mola', durum: 'bekliyor', rotasyonNo: 0, grupNo: 0, kategori: '' };
                            curMin = me;
                        }
                    }
                    curMin += dk;
                    curMin = skipMolalar(curMin);
                };

                for (let catIdx = 0; catIdx < aktifKats.length; catIdx++) {
                    const catKey = aktifKats[catIdx];
                    const aletlerSirali = getOlimpikSira(catKey, getAletlerForCat(catKey));
                    if (!aletlerSirali.length) continue;
                    const numAlet = aletlerSirali.length; // bir dalgadaki grup sayısı = alet sayısı
                    const catGruplar = gruplar[catKey] || [];
                    const catPlan = rotasyonPlani[catKey] || {};

                    // Tüm effective grupları oluştur
                    const effGroups = [];
                    if (catGruplar.length) {
                        catGruplar.forEach((athletes, gi) => {
                            const gp = catPlan[gi] || {};
                            if (gp.bolunmus && gp.bolumler?.length >= 2) {
                                gp.bolumler.forEach((b) => {
                                    effGroups.push({ gi, grupNo: gi + 1, bolumAdi: b.bolumAdi, baslangicAleti: b.aletKey, count: Math.ceil(athletes.length / gp.bolumler.length), etiket: `Grup ${gi + 1}${b.bolumAdi}` });
                                });
                            } else {
                                effGroups.push({ gi, grupNo: gi + 1, baslangicAleti: gp.baslangicAleti || '', count: athletes.length, etiket: `Grup ${gi + 1}` });
                            }
                        });
                    } else {
                        const total = athleteCounts[catKey] || 0;
                        const ng = Math.max(1, Math.ceil(total / 8));
                        for (let g = 0; g < ng; g++) effGroups.push({ gi: g, grupNo: g + 1, baslangicAleti: '', count: Math.ceil(total / ng), etiket: `Grup ${g + 1}` });
                    }

                    // Paralel grupları eşleştir: paralel=true olan grup bir sonrakiyle aynı slot'ta
                    const slots = [];
                    { let si = 0;
                      while (si < effGroups.length) {
                        const grp = effGroups[si];
                        const gp2 = catPlan[grp.gi] || {};
                        if (gp2.paralel && !gp2.bolunmus && si + 1 < effGroups.length) {
                            slots.push([grp, effGroups[si + 1]]);
                            si += 2;
                        } else {
                            slots.push([grp]);
                            si++;
                        }
                      }
                    }

                    // DALGALARA BÖL: kullanıcı dalgaNo seçtiyse ona göre, yoksa otomatik numAlet'e göre
                    const hasUserDalga = effGroups.some(g => catPlan[g.gi]?.dalgaNo != null);
                    const dalgalar = [];
                    if (hasUserDalga) {
                        const dalgaMap = {};
                        slots.forEach(slot => {
                            const dn = catPlan[slot[0].gi]?.dalgaNo || 1;
                            if (!dalgaMap[dn]) dalgaMap[dn] = [];
                            dalgaMap[dn].push(slot);
                        });
                        Object.entries(dalgaMap).sort(([a],[b]) => Number(a)-Number(b))
                            .forEach(([,slotsArr]) => dalgalar.push(slotsArr));
                    } else {
                        for (let i = 0; i < slots.length; i += numAlet) {
                            dalgalar.push(slots.slice(i, i + numAlet));
                        }
                    }

                    curMin = skipMolalar(curMin);

                    for (let dalgaIdx = 0; dalgaIdx < dalgalar.length; dalgaIdx++) {
                        const dalga = dalgalar[dalgaIdx];
                        const dalgaNo = dalgaIdx + 1;

                        // Rotasyon süresi: paralel slotlarda sporcu toplamı, tüm slotların maks'ı alınır
                        const rotSuresi = calcRotasyonSuresi(catKey, dalga);

                        // Isınma — her dalga için ayrı
                        if (planAyarlari.isinmaSuresi > 0) {
                            const k = push(ref(db, 'x')).key;
                            newSessions[k] = {
                                tarih, tip: 'isinma', kategori: catKey, alet: '',
                                saat: minToTimeStr(curMin), bitisSaat: minToTimeStr(curMin + planAyarlari.isinmaSuresi),
                                aciklama: `${getCategoryLabel(catKey)} — ${dalgaNo}. Dalga Isınma`,
                                durum: 'bekliyor', rotasyonNo: 0, grupNo: 0, dalgaNo
                            };
                            advance(planAyarlari.isinmaSuresi);
                        }

                        // numAlet adım rotasyon: her adımda dalganın TÜM slotları aynı anda farklı aparatlarda
                        for (let r = 0; r < numAlet; r++) {
                            const rotStart = minToTimeStr(curMin);
                            const rotEnd = minToTimeStr(curMin + rotSuresi);

                            dalga.forEach((slot, wi) => {
                                const firstGrp = slot[0];
                                // Pozisyona göre başlangıç aleti: baslangicAleti yoksa wi pozisyonuna göre
                                const startAletIdx = firstGrp.baslangicAleti
                                    ? aletlerSirali.indexOf(firstGrp.baslangicAleti)
                                    : wi;
                                const si2 = startAletIdx >= 0 ? startAletIdx : wi % numAlet;
                                const alet = aletlerSirali[(si2 + r) % numAlet];
                                const isParalelSlot = slot.length > 1;
                                slot.forEach(grp => {
                                    const k = push(ref(db, 'x')).key;
                                    newSessions[k] = {
                                        tarih, tip: 'rotasyon', kategori: catKey, alet,
                                        saat: rotStart, bitisSaat: rotEnd,
                                        rotasyonNo: r + 1, dalgaNo,
                                        grupNo: grp.grupNo, bolumAdi: grp.bolumAdi || null,
                                        sporcu_sayisi: grp.count, rotasyonSuresiDk: rotSuresi,
                                        paralel: isParalelSlot,
                                        aciklama: `${getCategoryLabel(catKey)} — ${dalgaNo}.Dalga ${grp.etiket}${isParalelSlot ? ' (PAR)' : ''} — ${getAletLabel(alet)} (${grp.count} sporcu, ${rotSuresi} dk)`,
                                        durum: 'bekliyor'
                                    };
                                });
                            });

                            advance(rotSuresi);

                            // Rotasyonlar arası mola (son adımdan sonra değil)
                            if (r < numAlet - 1 && planAyarlari.molaSuresi > 0) {
                                const k = push(ref(db, 'x')).key;
                                newSessions[k] = {
                                    tarih, tip: 'mola', kategori: catKey, alet: '',
                                    saat: minToTimeStr(curMin), bitisSaat: minToTimeStr(curMin + planAyarlari.molaSuresi),
                                    aciklama: `${dalgaNo}.Dalga Rot.${r + 1}→${r + 2} Arası Mola`,
                                    durum: 'bekliyor', rotasyonNo: r + 1, dalgaNo, grupNo: 0
                                };
                                advance(planAyarlari.molaSuresi);
                            }
                        }

                        // Dalgalar arası geçiş (son dalga hariç)
                        if (dalgaIdx < dalgalar.length - 1) {
                            advance(planAyarlari.dalgaAraBekleme || 5);
                        }
                    }

                    // Kategoriler arası geçiş (son kategori hariç)
                    if (catIdx < aktifKats.length - 1) {
                        advance(planAyarlari.kategoriBeklemeSuresi || 20);
                    }
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

    const [pdfGenerating, setPdfGenerating] = useState(false);
    const [excelGenerating, setExcelGenerating] = useState(false);

    // ── Excel Export ──
    const handleDownloadExcel = useCallback(async () => {
        if (!selectedComp) return;
        if (excelGenerating) return;
        setExcelGenerating(true);

        try {
            const XLSX = await import('xlsx');
            const wb = XLSX.utils.book_new();

            const compName = selectedComp.isim || 'Yarışma';
            const compTarih = selectedComp.baslangicTarihi || '';

            const TIP_LABELS = { isinma: 'Isınma', rotasyon: 'Rotasyon', mola: 'Mola', manuel: 'Genel', odulToreni: 'Ödül Töreni' };
            const DURUM_LABELS = { bekliyor: 'Bekliyor', devam: 'Devam Ediyor', tamamlandi: 'Tamamlandı' };

            const tipLabel = (t) => TIP_LABELS[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Manuel');
            const durumLabel = (d) => DURUM_LABELS[d] || d || 'Bekliyor';
            const catLabel = (k) => k ? k.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '';
            const aletLabel = (k) => {
                const MAP = { atlama:'Atlama', barfiks:'Barfiks', halka:'Halka', kulplu:'Kulplu Beygir', mantar:'Mantar Beygir', paralel:'Paralel', yer:'Yer', denge:'Denge', asimetrik:'Asimetrik Paralel', serbest:'Serbest' };
                return MAP[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : '');
            };

            // ── Tüm Program Sayfası (tüm günler tek sheet) ──────────────────────
            const allRows = [];

            // Başlık
            allRows.push([compName]);
            allRows.push([compTarih ? new Date(compTarih).toLocaleDateString('tr-TR', { day:'numeric', month:'long', year:'numeric' }) : '']);
            allRows.push([]); // boş satır

            // Tüm günleri sırayla ekle
            let totalSes = 0;
            for (const dateStr of dateRange) {
                const daySessions = (sessionsByDate[dateStr] || []).slice();
                if (!daySessions.length) continue;

                const dateFmt = new Date(dateStr).toLocaleDateString('tr-TR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
                allRows.push([dateFmt.toLocaleUpperCase('tr-TR')]);
                allRows.push(['Saat', 'Bitiş', 'Süre (dk)', 'Tip', 'Kategori', 'Alet', 'Dalga', 'Grup', 'Sporcu', 'Açıklama', 'Durum']);

                daySessions.forEach(sess => {
                    let sureDk = '';
                    if (sess.saat && sess.bitisSaat) {
                        const [sh, sm] = sess.saat.split(':').map(Number);
                        const [eh, em] = sess.bitisSaat.split(':').map(Number);
                        sureDk = (eh * 60 + em) - (sh * 60 + sm);
                    }
                    allRows.push([
                        sess.saat || '',
                        sess.bitisSaat || '',
                        sureDk || '',
                        tipLabel(sess.tip),
                        catLabel(sess.kategori),
                        aletLabel(sess.alet),
                        sess.dalgaNo || '',
                        sess.grupNo ? `Grup ${sess.grupNo}${sess.bolumAdi ? sess.bolumAdi : ''}` : '',
                        sess.sporcu_sayisi || '',
                        sess.aciklama || '',
                        durumLabel(sess.durum),
                    ]);
                    totalSes++;
                });
                allRows.push([]); // günler arası boşluk
            }

            const wsAll = XLSX.utils.aoa_to_sheet(allRows);
            wsAll['!cols'] = [
                { wch: 7 },   // Saat
                { wch: 7 },   // Bitiş
                { wch: 9 },   // Süre
                { wch: 10 },  // Tip
                { wch: 16 },  // Kategori
                { wch: 16 },  // Alet
                { wch: 6 },   // Dalga
                { wch: 10 },  // Grup
                { wch: 8 },   // Sporcu
                { wch: 50 },  // Açıklama
                { wch: 14 },  // Durum
            ];
            XLSX.utils.book_append_sheet(wb, wsAll, 'Tam Program');

            // ── Gün bazlı ayrı sayfalar ───────────────────────────────────────
            for (const dateStr of dateRange) {
                const daySessions = (sessionsByDate[dateStr] || []).slice();
                if (!daySessions.length) continue;

                const dayRows = [];
                const dateFmt = new Date(dateStr).toLocaleDateString('tr-TR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
                dayRows.push([compName]);
                dayRows.push([dateFmt]);
                dayRows.push([]);
                dayRows.push(['Saat', 'Bitiş', 'Süre (dk)', 'Tip', 'Kategori', 'Alet', 'Dalga', 'Grup', 'Sporcu', 'Açıklama', 'Durum']);

                daySessions.forEach(sess => {
                    let sureDk = '';
                    if (sess.saat && sess.bitisSaat) {
                        const [sh, sm] = sess.saat.split(':').map(Number);
                        const [eh, em] = sess.bitisSaat.split(':').map(Number);
                        sureDk = (eh * 60 + em) - (sh * 60 + sm);
                    }
                    dayRows.push([
                        sess.saat || '',
                        sess.bitisSaat || '',
                        sureDk || '',
                        tipLabel(sess.tip),
                        catLabel(sess.kategori),
                        aletLabel(sess.alet),
                        sess.dalgaNo || '',
                        sess.grupNo ? `Grup ${sess.grupNo}${sess.bolumAdi ? sess.bolumAdi : ''}` : '',
                        sess.sporcu_sayisi || '',
                        sess.aciklama || '',
                        durumLabel(sess.durum),
                    ]);
                });

                const ws = XLSX.utils.aoa_to_sheet(dayRows);
                ws['!cols'] = [
                    { wch: 7 }, { wch: 7 }, { wch: 9 }, { wch: 10 },
                    { wch: 16 }, { wch: 16 }, { wch: 6 }, { wch: 10 },
                    { wch: 8 }, { wch: 50 }, { wch: 14 },
                ];

                // Sheet adı: "Gün 1 - 15 Nis" gibi (max 31 karakter)
                const dayNum = dateRange.indexOf(dateStr) + 1;
                const dayLabel = new Date(dateStr).toLocaleDateString('tr-TR', { day:'numeric', month:'short' });
                const sheetName = `Gün ${dayNum} - ${dayLabel}`.substring(0, 31);
                XLSX.utils.book_append_sheet(wb, ws, sheetName);
            }

            if (wb.SheetNames.length === 0) {
                toast('Program henüz oluşturulmamış.', 'warning');
                return;
            }

            const safeCompName = compName.replace(/[\\/:*?"<>|]/g, '_');
            XLSX.writeFile(wb, `${safeCompName}_Program.xlsx`);
            toast(`Excel indirildi. Toplam ${totalSes} oturum.`, 'success');
        } catch (err) {
            if (import.meta.env.DEV) console.error('Excel oluşturma hatası:', err);
            toast('Excel oluşturulurken bir hata oluştu: ' + err.message, 'error');
        } finally {
            setExcelGenerating(false);
        }
    }, [selectedComp, dateRange, sessionsByDate, excelGenerating]);

    const handleDownloadPDF = useCallback(async () => {
        if (!selectedComp) return;
        setPdfGenerating(true);
        try {
            await generateCompetitionPDF({
                selectedComp,
                compCatKeys,
                dateRange,
                sessionsByDate,
                gruplar,
                athleteCounts,
            });
            toast('PDF indirildi', 'success');
        } catch (err) {
            toast('PDF oluşturma hatası: ' + err.message, 'error');
        } finally {
            setPdfGenerating(false);
        }
    }, [selectedComp, compCatKeys, dateRange, sessionsByDate, gruplar, athleteCounts]);

    // rotationMatrix — wave-aware: her dalga kendi matrisiyle gösterilir
    const rotationMatrix = useMemo(() => {
        const result = {};
        compCatKeys.forEach(catKey => {
            const aletlerSirali = getOlimpikSira(catKey, getAletlerForCat(catKey));
            if (!aletlerSirali.length) return;
            const numAlet = aletlerSirali.length;
            const catGruplar = gruplar[catKey] || [];
            const catPlan = rotasyonPlani[catKey] || {};

            // Effective groups (split aware)
            const effGroups = [];
            catGruplar.forEach((athletes, gi) => {
                const gp = catPlan[gi] || {};
                if (gp.bolunmus && gp.bolumler?.length >= 2) {
                    gp.bolumler.forEach(b => effGroups.push({ gi, etiket: `G${gi + 1}${b.bolumAdi}`, baslangicAleti: b.aletKey, count: Math.ceil(athletes.length / gp.bolumler.length) }));
                } else {
                    effGroups.push({ gi, etiket: `G${gi + 1}`, baslangicAleti: gp.baslangicAleti || '', count: athletes.length, paralel: !!gp.paralel });
                }
            });

            // Paralel grupları slot'lara eşleştir
            const slots = [];
            { let si = 0;
              while (si < effGroups.length) {
                const grp = effGroups[si];
                if (grp.paralel && !(catPlan[grp.gi]?.bolunmus) && si + 1 < effGroups.length) {
                    slots.push([grp, effGroups[si + 1]]);
                    si += 2;
                } else {
                    slots.push([grp]);
                    si++;
                }
              }
            }

            // Dalgalara böl (kullanıcı dalgaNo seçtiyse ona göre, yoksa otomatik)
            const hasUserDalga2 = effGroups.some(g => catPlan[g.gi]?.dalgaNo != null);
            const dalgalar = [];
            if (hasUserDalga2) {
                const dalgaMap = {};
                slots.forEach(slot => {
                    const dn = catPlan[slot[0].gi]?.dalgaNo || 1;
                    if (!dalgaMap[dn]) dalgaMap[dn] = [];
                    dalgaMap[dn].push(slot);
                });
                Object.entries(dalgaMap).sort(([a],[b]) => Number(a)-Number(b))
                    .forEach(([,slotsArr]) => dalgalar.push(slotsArr));
            } else {
                for (let i = 0; i < slots.length; i += numAlet) {
                    dalgalar.push(slots.slice(i, i + numAlet));
                }
            }

            // Her dalga için matris
            const dalgaMatrisleri = dalgalar.map((dalgaSlots) => {
                const matrix = {};
                aletlerSirali.forEach(a => { matrix[a] = {}; for (let r = 0; r < numAlet; r++) matrix[a][r] = []; });
                dalgaSlots.forEach((slot, wi) => {
                    const firstGrp = slot[0];
                    const si = firstGrp.baslangicAleti ? aletlerSirali.indexOf(firstGrp.baslangicAleti) : wi % numAlet;
                    const startIdx = si >= 0 ? si : wi % numAlet;
                    for (let r = 0; r < numAlet; r++) {
                        slot.forEach(grp => matrix[aletlerSirali[(startIdx + r) % numAlet]][r].push(grp));
                    }
                });
                const flatDalga = dalgaSlots.flatMap(s => s);
                return { dalga: flatDalga, matrix };
            });

            result[catKey] = { aletlerSirali, numAlet, dalgaMatrisleri, effGroups };
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
                                            { field: 'dalgaAraBekleme', label: 'Dalgalar Arası Geçiş (dk)', type: 'number', min: 0, max: 60 },
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
                                                        {(() => {
                                                            const rawKats = compCatKeys.filter(ck => (planAyarlari.kategoriGunAtamalari?.[ck] ?? 0) === di);
                                                            const sirali = planAyarlari.gunAyarlari?.[tarih]?.kategoriSirasi;
                                                            const orderedKats = sirali && sirali.length > 0
                                                                ? [...sirali.filter(k => rawKats.includes(k)), ...rawKats.filter(k => !sirali.includes(k))]
                                                                : rawKats;
                                                            if (orderedKats.length < 2) return null;
                                                            return (
                                                                <div className="gun-kat-sira">
                                                                    <label className="gun-kat-sira-label">
                                                                        <i className="material-icons-round">swap_vert</i> Kategori Sırası
                                                                    </label>
                                                                    <div className="gun-kat-list">
                                                                        {orderedKats.map((ck, idx) => (
                                                                            <div key={ck} className="gun-kat-row">
                                                                                <span className="gun-kat-idx">{idx + 1}.</span>
                                                                                <span className="gun-kat-name">{getCategoryLabel(ck)}</span>
                                                                                <div className="gun-kat-btns">
                                                                                    <button
                                                                                        className="btn-kat-order"
                                                                                        disabled={idx === 0}
                                                                                        onClick={() => handleReorderKategori(tarih, idx, idx - 1)}
                                                                                        title="Yukarı taşı"
                                                                                    >
                                                                                        <i className="material-icons-round">arrow_upward</i>
                                                                                    </button>
                                                                                    <button
                                                                                        className="btn-kat-order"
                                                                                        disabled={idx === orderedKats.length - 1}
                                                                                        onClick={() => handleReorderKategori(tarih, idx, idx + 1)}
                                                                                        title="Aşağı taşı"
                                                                                    >
                                                                                        <i className="material-icons-round">arrow_downward</i>
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}
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
                                                            <div key={gi} className={`rot-group-card ${isBol ? 'bolunmus' : ''} ${gp.paralel ? 'paralel' : ''}`}>
                                                                <div className="rot-group-top">
                                                                    <div className="rot-group-id">
                                                                        <span className="rot-group-num">Grup {gi + 1}</span>
                                                                        <span className="rot-group-count">{athletes.length} sporcu</span>
                                                                        {gp.paralel && <span className="paralel-badge"><i className="material-icons-round">group_work</i>Paralel</span>}
                                                                    </div>
                                                                    <div className="rot-dalga-select">
                                                                        <label>Dalga</label>
                                                                        <select value={gp.dalgaNo ?? ''} onChange={e => handleGroupDalgaNoChange(catKey, gi, e.target.value)} disabled={!canEdit}>
                                                                            <option value="">Oto</option>
                                                                            {Array.from({ length: Math.max(catGruplar.length, 4) }, (_, i) => i + 1).map(n => (
                                                                                <option key={n} value={n}>{n}. Dalga</option>
                                                                            ))}
                                                                        </select>
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
                                                                    {canEdit && !isBol && (
                                                                        <button className={`btn-paralel ${gp.paralel ? 'active' : ''}`} onClick={() => handleToggleParalel(catKey, gi)} title="Bir sonraki grupla aynı alette eş zamanlı">
                                                                            <i className="material-icons-round">group_work</i>
                                                                            {gp.paralel ? 'Paralel İptal' : 'Paralel'}
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

                                            {/* Rotation Matrix Preview — per wave */}
                                            {mat && mat.dalgaMatrisleri?.length > 0 && (
                                                <div className="rot-matrix-section">
                                                    <h4><i className="material-icons-round">grid_view</i> Rotasyon Matrisi
                                                        <span className="matrix-wave-hint">({mat.dalgaMatrisleri.length} dalga × {mat.numAlet} rotasyon adımı)</span>
                                                    </h4>
                                                    {mat.dalgaMatrisleri.map((dm, dalgaIdx) => (
                                                        <div key={dalgaIdx} className="matrix-wave-block">
                                                            <div className="matrix-wave-label">
                                                                <span className="wave-badge">{dalgaIdx + 1}. Dalga</span>
                                                                <span className="wave-groups">{dm.dalga.map(g => g.etiket).join(', ')}</span>
                                                            </div>
                                                            <div className="rot-matrix-scroll">
                                                                <table className="rot-matrix-table">
                                                                    <thead>
                                                                        <tr>
                                                                            <th className="alet-col">Alet</th>
                                                                            {Array.from({ length: mat.numAlet }, (_, r) => (
                                                                                <th key={r}><div className="rot-th-num">Rot. {r + 1}</div></th>
                                                                            ))}
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {mat.aletlerSirali.map(alet => (
                                                                            <tr key={alet}>
                                                                                <td className="alet-name-cell"><span className="alet-badge">{getAletLabel(alet)}</span></td>
                                                                                {Array.from({ length: mat.numAlet }, (_, r) => (
                                                                                    <td key={r} className="group-cell">
                                                                                        {(dm.matrix[alet][r] || []).map((g, gi) => (
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
                                                    ))}
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
                                            <>
                                                <button className="sched-excel-btn" onClick={handleDownloadExcel} disabled={excelGenerating}>
                                                    {excelGenerating
                                                        ? <><div className="spinner-small" style={{borderTopColor:'#16a34a'}} /><div><strong>Oluşturuluyor...</strong><small>Lütfen bekleyin</small></div></>
                                                        : <><i className="material-icons-round">table_view</i><div><strong>Excel İndir</strong><small>Gün bazlı program tablosu</small></div></>
                                                    }
                                                </button>
                                                <button className="sched-pdf-btn" onClick={handleDownloadPDF} disabled={pdfGenerating}>
                                                    {pdfGenerating
                                                        ? <><div className="spinner-small" style={{borderTopColor:'#ea580c'}} /><div><strong>Oluşturuluyor...</strong><small>Lütfen bekleyin</small></div></>
                                                        : <><i className="material-icons-round">picture_as_pdf</i><div><strong>PDF İndir</strong><small>TCF formatında program dosyası</small></div></>
                                                    }
                                                </button>
                                            </>
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
                                            {canCreate && (
                                                <div className="sched-day-header-btns">
                                                    <button className="sched-add-btn" onClick={() => openAddModal(dateStr)}>
                                                        <i className="material-icons-round">add</i>Oturum Ekle
                                                    </button>
                                                    <button className="sched-odul-btn no-print" onClick={() => openAwardCeremonyModal(dateStr)} title="Gün sonuna ödül töreni ekle">
                                                        <i className="material-icons-round">emoji_events</i>Ödül Töreni
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        {(sessionsByDate[dateStr] || []).length === 0 ? (
                                            <div className="sched-day__empty"><i className="material-icons-round">event_busy</i>Bu gün için oturum yok</div>
                                        ) : (
                                            <div className="sched-day__timeline">
                                                {(sessionsByDate[dateStr] || []).map((sess, sessIdx, sessArr) => {
                                                    const rotAthletes = getRotationAthletes(sess);
                                                    const isExpanded = expandedSessions.has(sess.id);
                                                    return (
                                                        <div key={sess.id} className="sched-session-wrapper">
                                                        <div className={`sched-session sched-session--${sess.durum || 'bekliyor'} sched-session--tip-${sess.tip || 'manuel'}${isExpanded ? ' expanded' : ''}`}>
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
                                                                            {sess.tip === 'isinma' ? 'Isınma'
                                                                            : sess.tip === 'mola' ? (sess.molaAdi || 'Mola')
                                                                            : sess.tip === 'rotasyon' ? `Rot.${sess.rotasyonNo || ''}`
                                                                            : sess.tip === 'odulToreni' ? '🏆 Ödül Töreni'
                                                                            : sess.tip}
                                                                        </span>
                                                                    )}
                                                                    {sess.dalgaNo > 0 && <span className="sess-dalga-badge">{sess.dalgaNo}.Dalga</span>}
                                                                    {sess.grupNo > 0 && <span className="sess-grup-badge">Grup {sess.grupNo}{sess.bolumAdi || ''}</span>}
                                                                    {sess.paralel && <span className="sess-paralel-badge"><i className="material-icons-round">group_work</i>Par</span>}
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
                                                        {/* Araya ekle butonu — oturumlar arası */}
                                                        {canCreate && sessIdx < sessArr.length - 1 && (
                                                            <div className="insert-divider no-print" onClick={() => openInsertAfterModal(sess, dateStr)}>
                                                                <span className="insert-divider__line" />
                                                                <button className="insert-divider__btn" title={`${sess.bitisSaat} saatinden sonra oturum ekle — sonrakiler kaydırılır`}>
                                                                    <i className="material-icons-round">add</i>
                                                                    <span>Araya Ekle</span>
                                                                </button>
                                                                <span className="insert-divider__line" />
                                                            </div>
                                                        )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                ))}

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
                            <h2>
                                {editingSession ? 'Oturumu Düzenle'
                                : formData.tip === 'odulToreni' ? '🏆 Ödül Töreni Ekle'
                                : insertAfterSession ? 'Araya Oturum Ekle'
                                : 'Yeni Oturum'}
                            </h2>
                            <button className="sched-modal__close" onClick={closeModal}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>

                        <div className="sched-modal__body">
                            {/* Araya ekleme bilgi notu */}
                            {insertAfterSession && (
                                <div className="insert-info-banner">
                                    <i className="material-icons-round">info</i>
                                    <span>Bu oturum eklendikten sonra <strong>{(sessionsByDate[formData.tarih] || []).filter(s => s.saat >= insertAfterSession.bitisSaat).length} oturum</strong> otomatik olarak kaydırılacak.</span>
                                </div>
                            )}

                            {/* Oturum Tipi */}
                            <div className="sched-field">
                                <label>Oturum Tipi</label>
                                <div className="sched-tip-pills">
                                    {[
                                        { key: 'manuel', icon: 'event_note', label: 'Genel' },
                                        { key: 'isinma', icon: 'directions_run', label: 'Isınma' },
                                        { key: 'mola', icon: 'free_breakfast', label: 'Mola' },
                                        { key: 'odulToreni', icon: 'emoji_events', label: 'Ödül Töreni' },
                                    ].map(({ key, icon, label }) => (
                                        <button key={key} type="button"
                                            className={`sched-tip-pill sched-tip-pill--${key}${formData.tip === key ? ' active' : ''}`}
                                            onClick={() => setFormData(p => ({
                                                ...p,
                                                tip: key,
                                                aciklama: key === 'odulToreni' && !p.aciklama ? 'Ödül Töreni' : p.aciklama,
                                                kategori: key === 'odulToreni' ? '' : p.kategori,
                                                alet: key === 'odulToreni' ? '' : p.alet,
                                            }))}
                                        >
                                            <i className="material-icons-round">{icon}</i>
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

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

                            {/* Kategori — Ödül Töreninde opsiyonel, diğerlerinde zorunlu */}
                            {formData.tip !== 'odulToreni' && (
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
                            )}

                            {/* Ödül Töreni: opsiyonel kategori seçimi */}
                            {formData.tip === 'odulToreni' && compCatKeys.length > 0 && (
                                <div className="sched-field">
                                    <label>Kategori (Opsiyonel — boş bırakılırsa genel tören)</label>
                                    <select
                                        value={formData.kategori}
                                        onChange={e => setFormData(p => ({ ...p, kategori: e.target.value }))}
                                    >
                                        <option value="">— Tüm Kategoriler —</option>
                                        {compCatKeys.map(catKey => (
                                            <option key={catKey} value={catKey}>{getCategoryLabel(catKey)}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Alet — Ödül Töreninde gizli */}
                            {formData.tip !== 'odulToreni' && formData.kategori && (
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
                                <label>Açıklama {formData.tip === 'odulToreni' ? '' : '(Opsiyonel)'}</label>
                                <input
                                    type="text"
                                    value={formData.aciklama}
                                    onChange={e => setFormData(p => ({ ...p, aciklama: e.target.value }))}
                                    placeholder={formData.tip === 'odulToreni' ? 'Ör: Küçük Erkek Ödül Töreni' : 'Ör: Genç Erkek yer serileri'}
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
