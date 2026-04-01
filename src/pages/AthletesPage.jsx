import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, remove, push, set, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
// XLSX — sadece Excel upload sırasında dynamic import ile yüklenir
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { useDiscipline } from '../lib/DisciplineContext';
import './AthletesPage.css';

// ─── Okul Benzerlik Algılama ───
function normalizeSchoolName(name) {
    return (name || '')
        .toLocaleUpperCase('tr-TR')
        .replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G')
        .replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C')
        .replace(/[.,\-'"/()]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    return dp[m][n];
}

// schoolList: [{ name, count }]
// Döner: [{ id, names:[{name,count}], canonical, dismissed }]
function findSimilarSchoolGroups(schoolList) {
    // 1. Normalize et ve grupla
    const byNorm = {};
    schoolList.forEach(s => {
        const key = normalizeSchoolName(s.name);
        if (!byNorm[key]) byNorm[key] = [];
        byNorm[key].push(s);
    });

    const groups = [];
    const usedNames = new Set();

    // Kesin eşleşme grupları (normalize → aynı)
    Object.values(byNorm).forEach(group => {
        if (group.length >= 2) {
            group.forEach(s => usedNames.add(s.name));
            const canonical = [...group].sort((a, b) => b.count - a.count)[0].name;
            groups.push({ id: `g${groups.length}`, names: group, canonical, dismissed: false, type: 'normalize' });
        }
    });

    // Levenshtein benzerliği (normalize edilmiş isimler arası mesafe ≤ 4)
    const remaining = schoolList.filter(s => !usedNames.has(s.name));
    const paired = new Set();
    for (let i = 0; i < remaining.length; i++) {
        for (let j = i + 1; j < remaining.length; j++) {
            const na = normalizeSchoolName(remaining[i].name);
            const nb = normalizeSchoolName(remaining[j].name);
            const shorter = Math.min(na.length, nb.length);
            const threshold = shorter <= 8 ? 1 : shorter <= 15 ? 2 : shorter <= 25 ? 3 : 4;
            if (levenshtein(na, nb) <= threshold && !paired.has(i) && !paired.has(j)) {
                paired.add(i); paired.add(j);
                const pair = [remaining[i], remaining[j]];
                const canonical = [...pair].sort((a, b) => b.count - a.count)[0].name;
                groups.push({ id: `g${groups.length}`, names: pair, canonical, dismissed: false, type: 'similar' });
            }
        }
    }

    return groups;
}

// ─── Takım Kontenjan Kuralları ───
const TEAM_RULES = {
    minik:  { min: 4, max: 7 },
    kucuk:  { min: 4, max: 5 },
    yildiz: { min: 2, max: 3 },
    genc:   { min: 2, max: 3 },
};

function getTeamRules(catName) {
    const n = (catName || '').toLocaleLowerCase('tr-TR');
    if (n.includes('minik'))                                   return TEAM_RULES.minik;
    if (n.includes('küçük') || n.includes('kucuk'))            return TEAM_RULES.kucuk;
    if (n.includes('yıldız') || n.includes('yildiz'))          return TEAM_RULES.yildiz;
    if (n.includes('genç')  || n.includes('genc'))             return TEAM_RULES.genc;
    return null;
}

export default function AthletesPage() {
    const navigate = useNavigate();
    const { currentUser, hasPermission } = useAuth();
    const { toast, confirm } = useNotification();
    const { firebasePath, routePrefix } = useDiscipline();
    const [competitions, setCompetitions] = useState({});
    const [selectedCompId, setSelectedCompId] = useState('');

    const [athletes, setAthletes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filterCity, setFilterCity] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('');
    const [filterSchool, setFilterSchool] = useState(''); // Kontenjan panelinden okul filtresi
    const [expandedSchool, setExpandedSchool] = useState(''); // Kontenjan panelinde açık okul

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingAthlete, setEditingAthlete] = useState(null); // null = new, object = edit

    // Global Search State
    const [isGlobalModalOpen, setIsGlobalModalOpen] = useState(false);
    const [globalSearchText, setGlobalSearchText] = useState('');

    // Görünüm modu
    const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'grouped'
    const [collapsedIls, setCollapsedIls] = useState(new Set());
    const [collapsedSchools, setCollapsedSchools] = useState(new Set());

    // Bulk Edit State
    const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
    const [bulkEditTab, setBulkEditTab] = useState('okul'); // 'okul' | 'tur' | 'transfer'
    const [bulkOldValue, setBulkOldValue] = useState('');
    const [bulkNewValue, setBulkNewValue] = useState('');
    const [bulkSaving, setBulkSaving] = useState(false);
    const [bulkCustomSchool, setBulkCustomSchool] = useState(false);
    const [bulkAthleteOverrides, setBulkAthleteOverrides] = useState({}); // { athId: { categoryId: 'new_cat' } }

    // Transfer State
    const [transferTargetCompId, setTransferTargetCompId] = useState('');
    const [transferCategory, setTransferCategory] = useState('');
    const [transferSelectedIds, setTransferSelectedIds] = useState(new Set());
    const [transferSelectAll, setTransferSelectAll] = useState(false);

    // Benzer Okul Birleştirme State
    const [similarGroups, setSimilarGroups] = useState([]); // bulunan gruplar
    const [isFindingSchools, setIsFindingSchools] = useState(false);

    // Form State
    const [formData, setFormData] = useState({
        ad: '',
        soyad: '',
        tckn: '',
        lisans: '',
        dob: '',
        okul: '',
        il: '',
        categoryId: '',
        yarismaTuru: 'ferdi'
    });

    const fileInputRef = useRef(null);

    // Sadece yarışma listesini yükle
    useEffect(() => {
        const compsRef = ref(db, firebasePath);
        const unsubscribe = onValue(compsRef, (snap) => {
            const data = snap.val() || {};
            setCompetitions(filterCompetitionsByUser(data, currentUser));
        });
        return () => unsubscribe();
    }, [currentUser, firebasePath]);

    // Seçilen yarışmaya göre sporcuları yükle
    useEffect(() => {
        if (!selectedCompId) {
            setAthletes([]);
            return;
        }

        setLoading(true);
        const athletesRef = ref(db, `${firebasePath}/${selectedCompId}/sporcular`);

        const unsubscribe = onValue(athletesRef, (snapshot) => {
            const data = snapshot.val();
            const loadedAthletes = [];

            if (data) {
                Object.keys(data).forEach(catId => {
                    const categoryAthletes = data[catId];
                    Object.keys(categoryAthletes).forEach(athId => {
                        const athData = categoryAthletes[athId];
                        loadedAthletes.push({
                            id: athId,
                            categoryId: catId,
                            ...athData
                        });
                    });
                });
            }

            loadedAthletes.sort((a, b) => {
                const nameA = `${a.ad} ${a.soyad}`.toLowerCase();
                const nameB = `${b.ad} ${b.soyad}`.toLowerCase();
                return nameA.localeCompare(nameB);
            });

            setAthletes(loadedAthletes);
            setLoading(false);
        }, (error) => {
            console.error("Firebase fetch error:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [selectedCompId]);

    // Belirtilen kategorilerde okul bazlı takım türünü otomatik hesapla ve güncelle
    const autoSyncTeamStatus = async (compId, catIdList) => {
        const catNames = competitions[compId]?.kategoriler || {};
        const uniqueCats = [...new Set(catIdList)].filter(Boolean);

        for (const catId of uniqueCats) {
            const catObj = catNames[catId] || {};
            const catName = catObj.isim || catObj.name || catObj.ad || catId;
            const rules = getTeamRules(catName);
            if (!rules) continue;

            const snap = await get(ref(db, `${firebasePath}/${compId}/sporcular/${catId}`));
            if (!snap.exists()) continue;

            const allAthletes = snap.val();

            // Okul bazlı gruplama
            const schoolGroups = {};
            Object.entries(allAthletes).forEach(([id, ath]) => {
                const okul = (ath.okul || ath.kulup || '').trim();
                if (!okul) return;
                if (!schoolGroups[okul]) schoolGroups[okul] = [];
                schoolGroups[okul].push({ id, ...ath });
            });

            const updates = {};
            Object.values(schoolGroups).forEach(group => {
                const newTur = group.length >= rules.min ? 'takim' : 'ferdi';
                group.forEach(ath => {
                    if ((ath.yarismaTuru || 'ferdi') !== newTur) {
                        updates[`${firebasePath}/${compId}/sporcular/${catId}/${ath.id}/yarismaTuru`] = newTur;
                    }
                });
            });

            if (Object.keys(updates).length > 0) {
                await update(ref(db), updates);
            }
        }
    };

    const handleDelete = async (catId, athId, name) => {
        const confirmed = await confirm(`${name} isimli sporcuyu silmek istediğinize emin misiniz?`, { title: 'Silme Onayı', type: 'danger' });
        if (confirmed) {
            try {
                const athRef = ref(db, `${firebasePath}/${selectedCompId}/sporcular/${catId}/${athId}`);
                await remove(athRef);
                // Sporcu silindi — okulun kalan sporcuları için takım türünü güncelle
                await autoSyncTeamStatus(selectedCompId, [catId]);
            } catch (err) {
                console.error("Delete failed", err);
                toast("Silme işlemi başarısız.", "error");
            }
        }
    };

    const openModal = (athlete = null) => {
        if (athlete) {
            setEditingAthlete(athlete);
            setFormData({
                ad: athlete.ad || '',
                soyad: athlete.soyad || '',
                tckn: athlete.tckn || '',
                lisans: athlete.lisans || '',
                dob: athlete.dob || '',
                okul: athlete.okul || '',
                il: athlete.il || '',
                categoryId: athlete.categoryId || '',
                yarismaTuru: athlete.yarismaTuru || 'ferdi'
            });
        } else {
            setEditingAthlete(null);
            setFormData({
                ad: '',
                soyad: '',
                tckn: '',
                lisans: '',
                dob: '',
                okul: '',
                il: '',
                categoryId: filterCategory || '',
                yarismaTuru: 'ferdi'
            });
        }
        setIsModalOpen(true);
    };

    const saveAthlete = async (e) => {
        e.preventDefault();
        if (!selectedCompId) return toast("Önce bir yarışma seçmelisiniz.", "warning");
        if (!formData.categoryId) return toast("Kategori seçimi zorunludur.", "warning");

        try {
            if (editingAthlete) {
                // Kategori değiştiyse eski yerden sil, yeni yere ekle
                if (editingAthlete.categoryId !== formData.categoryId) {
                    const oldCatId = editingAthlete.categoryId;
                    const newCatId = formData.categoryId;
                    const athId = editingAthlete.id;

                    // Sporcuyu eski kategoriden sil, yeni kategoriye ekle
                    const updates = {};
                    updates[`${firebasePath}/${selectedCompId}/sporcular/${oldCatId}/${athId}`] = null;
                    updates[`${firebasePath}/${selectedCompId}/sporcular/${newCatId}/${athId}`] = {
                        ...formData,
                        id: athId,
                        adSoyad: `${formData.ad} ${formData.soyad}`.trim(),
                        soyadAd: `${formData.soyad} ${formData.ad}`.trim(),
                        sirasi: editingAthlete.sirasi || 999
                    };

                    // Eski kategorideki puanları da taşı
                    const oldScoresSnap = await get(ref(db, `${firebasePath}/${selectedCompId}/puanlar/${oldCatId}`));
                    if (oldScoresSnap.exists()) {
                        const oldScores = oldScoresSnap.val();
                        Object.keys(oldScores).forEach(aletId => {
                            if (oldScores[aletId]?.[athId]) {
                                updates[`${firebasePath}/${selectedCompId}/puanlar/${oldCatId}/${aletId}/${athId}`] = null;
                                updates[`${firebasePath}/${selectedCompId}/puanlar/${newCatId}/${aletId}/${athId}`] = oldScores[aletId][athId];
                            }
                        });
                    }

                    // Eski kategorideki çıkış sırası (siralama) verisinden de sil
                    const oldOrderSnap = await get(ref(db, `${firebasePath}/${selectedCompId}/siralama/${oldCatId}`));
                    if (oldOrderSnap.exists()) {
                        const oldOrder = oldOrderSnap.val();
                        Object.keys(oldOrder).forEach(rotKey => {
                            if (oldOrder[rotKey]?.[athId]) {
                                updates[`${firebasePath}/${selectedCompId}/siralama/${oldCatId}/${rotKey}/${athId}`] = null;
                            }
                        });
                    }

                    await update(ref(db), updates);
                    // Eski ve yeni kategori için takım türünü güncelle
                    await autoSyncTeamStatus(selectedCompId, [oldCatId, newCatId]);
                } else {
                    // Sadece güncelle
                    await update(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${formData.categoryId}/${editingAthlete.id}`), formData);
                    // Aynı kategorideki okul takım türünü güncelle
                    await autoSyncTeamStatus(selectedCompId, [formData.categoryId]);
                }
            } else {
                // Yeni Ekle
                const newRef = push(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${formData.categoryId}`));
                await set(newRef, {
                    ...formData,
                    id: newRef.key,
                    adSoyad: `${formData.ad} ${formData.soyad}`.trim(),
                    soyadAd: `${formData.soyad} ${formData.ad}`.trim(),
                    sirasi: 999
                });
                // Yeni sporcu eklendi — okulun takım eşiğine ulaşıp ulaşmadığını kontrol et
                await autoSyncTeamStatus(selectedCompId, [formData.categoryId]);
            }
            setIsModalOpen(false);
        } catch (err) {
            console.error("Save error:", err);
            toast("Kaydedilirken hata oluştu.", "error");
        }
    };

    const handleExcelExport = async () => {
        if (filteredAthletes.length === 0) {
            toast('Aktarılacak sporcu bulunamadı.', 'warning');
            return;
        }

        try {
            const XLSX = await import('xlsx');
            const comp = selectedCompId ? competitions[selectedCompId] : null;
            const compName = comp?.isim || 'Yarışma';

            // Kategori adlarını yarışmanın kategoriler node'undan al
            const kategoriler = comp?.kategoriler || {};
            const getCatName = (catId) => kategoriler[catId]?.isim || kategoriler[catId]?.ad || catId;

            const rows = filteredAthletes.map((ath, i) => ({
                'Sıra':         i + 1,
                'Ad':           ath.ad || '',
                'Soyad':        ath.soyad || '',
                'T.C. Kimlik':  ath.tckn || '',
                'Lisans No':    ath.lisansNo || ath.lisans || '',
                'Doğum Tarihi': ath.dogumTarihi || ath.dob || '',
                'Okul / Kulüp': ath.okul || ath.kulup || '',
                'İl':           ath.il || '',
                'İlçe':         ath.ilce || '',
                'Kategori':     getCatName(ath.categoryId),
                'Tür':          ath.yarismaTuru || 'ferdi',
            }));

            const ws = XLSX.utils.json_to_sheet(rows);

            // Sütun genişlikleri
            ws['!cols'] = [
                { wch: 5 }, { wch: 18 }, { wch: 18 }, { wch: 14 },
                { wch: 14 }, { wch: 14 }, { wch: 28 }, { wch: 12 },
                { wch: 14 }, { wch: 20 }, { wch: 10 },
            ];

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Sporcular');

            const safeCompName = compName.replace(/[\\/:*?"<>|]/g, '_');
            const dateStr = new Date().toLocaleDateString('tr-TR').replace(/\./g, '-');
            XLSX.writeFile(wb, `${safeCompName}_Sporcular_${dateStr}.xlsx`);

            toast(`${filteredAthletes.length} sporcu Excel'e aktarıldı.`, 'success');
        } catch (err) {
            console.error('Excel export error:', err);
            toast('Excel aktarımında bir hata oluştu.', 'error');
        }
    };

    const handleExcelImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!selectedCompId) {
            toast("Lütfen önce Excel'in aktarılacağı yarışmayı seçin!", "warning");
            e.target.value = null;
            return;
        }

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const bstr = evt.target.result;
                const XLSX = await import('xlsx');
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const data = XLSX.utils.sheet_to_json(ws, { defval: "" });

                if (data.length === 0) {
                    toast("Excel dosyası boş veya format hatalı.", "error");
                    return;
                }

                let addedCount = 0;
                const updates = {};

                data.forEach(row => {
                    // Beklenen Sütunlar: Ad, Soyad, TC, Lisans, DogumTarihi, Okul, Il, Kategori, Tur
                    const ad = row['Ad'] || row['AD'] || '';
                    const soyad = row['Soyad'] || row['SOYAD'] || '';
                    const tckn = row['TC'] || row['TCKN'] || '';
                    const lisans = row['Lisans'] || row['LİSANS'] || '';
                    const dob = row['DogumTarihi'] || row['D.Tarihi'] || row['Doğum Tarihi'] || '';
                    const okul = row['Okul'] || row['OKUL'] || '';
                    const il = row['Il'] || row['İL'] || row['İl'] || '';
                    const categoryId = row['Kategori'] || row['KATEGORİ'] || '';
                    const yarismaTuru = (row['Tur'] || row['TÜR'] || row['Tür'] || 'ferdi').toLowerCase();

                    if (ad && soyad && categoryId) {
                        const newKey = push(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${categoryId}`)).key;
                        updates[`${firebasePath}/${selectedCompId}/sporcular/${categoryId}/${newKey}`] = {
                            ad, soyad, tckn, lisans, dob, okul, il, yarismaTuru,
                            sirasi: 999,
                            appId: "excel_import"
                        };
                        addedCount++;
                    }
                });

                if (Object.keys(updates).length > 0) {
                    await update(ref(db), updates);
                    toast(`${addedCount} sporcu başarıyla içeri aktarıldı!`, "success");
                    // Excel'den eklenen kategorilerde takım türünü otomatik hesapla
                    const affectedCats = [...new Set(data.map(r => r['Kategori'] || r['KATEGORİ'] || '').filter(Boolean))];
                    if (affectedCats.length > 0) await autoSyncTeamStatus(selectedCompId, affectedCats);
                } else {
                    toast("Geçerli veri bulunamadı. Lütfen Excel sütun başlıklarını kontrol edin (Ad, Soyad, Kategori zorunlu).", "warning");
                }
            } catch (error) {
                console.error("Excel import error", error);
                toast("Excel aktarımında bir hata meydana geldi.", "error");
            }
            e.target.value = null; // reset input
        };
        reader.readAsBinaryString(file);
    };

    const availableCities = [...new Set(Object.values(competitions).map(c => (c.il || c.city || '').toLocaleUpperCase('tr-TR')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr-TR'));

    const compOptions = Object.entries(competitions)
        .filter(([id, comp]) => !filterCity || (comp.il || comp.city || '').toLocaleUpperCase('tr-TR') === filterCity)
        .sort((a, b) => new Date(b[1].tarih || b[1].baslangicTarihi || 0) - new Date(a[1].tarih || a[1].baslangicTarihi || 0));

    // Global Search Logic
    const globalSearchResults = useMemo(() => {
        if (!globalSearchText || globalSearchText.length < 3) return [];
        const resultsMap = {};
        const searchLower = globalSearchText.toLowerCase();

        Object.entries(competitions).forEach(([compId, comp]) => {
            if (comp.sporcular) {
                Object.entries(comp.sporcular).forEach(([catId, athletesCat]) => {
                    Object.entries(athletesCat).forEach(([athId, ath]) => {
                        const fullName = `${ath.ad || ''} ${ath.soyad || ''}`.toLowerCase();
                        if (
                            fullName.includes(searchLower) ||
                            (ath.tckn && String(ath.tckn).includes(searchLower)) ||
                            (ath.lisans && String(ath.lisans).includes(searchLower))
                        ) {
                            const adSafe = String(ath.ad || '').trim().toLowerCase();
                            const soyadSafe = String(ath.soyad || '').trim().toLowerCase();
                            const uniqueKey = `${adSafe}_${soyadSafe}_${ath.dob || ath.tckn || ath.lisans || ''}`;
                            if (!resultsMap[uniqueKey]) {
                                resultsMap[uniqueKey] = {
                                    athlete: ath,
                                    competitions: []
                                };
                            }
                            if (!resultsMap[uniqueKey].competitions.some(c => c.compId === compId)) {
                                resultsMap[uniqueKey].competitions.push({
                                    compId,
                                    compName: comp.isim,
                                    date: new Date(comp.tarih || comp.baslangicTarihi || 0),
                                    catId,
                                    okul: ath.okul || ath.kulup || '',
                                    id: athId
                                });
                            }
                        }
                    });
                });
            }
        });

        const resultsArray = Object.values(resultsMap);
        resultsArray.forEach(res => {
            res.competitions.sort((a, b) => b.date - a.date);
        });

        return resultsArray.sort((a, b) => {
            const nameA = `${a.athlete.ad} ${a.athlete.soyad}`.toLowerCase();
            const nameB = `${b.athlete.ad} ${b.athlete.soyad}`.toLowerCase();
            return nameA.localeCompare(nameB);
        });
    }, [competitions, globalSearchText]);

    const filteredAthletes = athletes.filter(ath => {
        const fullName = `${ath.ad || ''} ${ath.soyad || ''}`.toLowerCase();
        const searchLower = searchTerm.toLowerCase();

        const matchesSearch = fullName.includes(searchLower) ||
            (ath.okul && String(ath.okul).toLowerCase().includes(searchLower)) ||
            (ath.tckn && String(ath.tckn).includes(searchLower));

        const matchesCategory = filterCategory === '' || ath.categoryId === filterCategory;
        const matchesSchool   = filterSchool === '' ||
            (ath.okul || ath.kulup || '').toLocaleUpperCase('tr-TR') === filterSchool;

        return matchesSearch && matchesCategory && matchesSchool;
    });

    const uniqueCategories = [...new Set(athletes.map(a => a.categoryId))];

    // Benzersiz okul isimleri ve yarışma türleri
    const uniqueSchools = [...new Set(athletes.map(a => a.okul || a.kulup || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr-TR'));
    const uniqueTurTypes = [...new Set(athletes.map(a => (a.yarismaTuru || 'ferdi').toLowerCase()))].sort();

    // Transfer: aynı il altındaki diğer yarışmalar
    const currentComp = selectedCompId ? competitions[selectedCompId] : null;
    const transferableComps = Object.entries(competitions)
        .filter(([id, c]) => {
            if (id === selectedCompId) return false;
            // Aynı il
            if ((c.il || c.city) !== (currentComp?.il || currentComp?.city)) return false;
            return true;
        })
        .sort((a, b) => (b[1].baslangicTarihi || '').localeCompare(a[1].baslangicTarihi || ''));

    // Transfer: hedef yarışmanın kategorileri
    const transferTargetComp = transferTargetCompId ? competitions[transferTargetCompId] : null;
    const transferTargetCategories = transferTargetComp?.kategoriler ? Object.keys(transferTargetComp.kategoriler) : [];

    // Transfer: filtrelenmiş sporcular (kategori bazlı)
    const transferFilteredAthletes = transferCategory
        ? athletes.filter(a => a.categoryId === transferCategory)
        : athletes;

    // Benzer okul isimlerini tara
    const handleFindSimilarSchools = () => {
        setIsFindingSchools(true);
        const schoolList = uniqueSchools.map(name => ({
            name,
            count: athletes.filter(a => (a.okul || a.kulup || '') === name).length
        }));
        const groups = findSimilarSchoolGroups(schoolList);
        setSimilarGroups(groups);
        setIsFindingSchools(false);
    };

    // Seçilen birleştirme kararlarını uygula
    const handleMergeSchools = async () => {
        const activeGroups = similarGroups.filter(g => !g.dismissed && g.names.some(n => n.name !== g.canonical));
        if (activeGroups.length === 0) {
            toast('Birleştirilecek okul çifti yok.', 'info');
            return;
        }

        const totalAthletes = activeGroups.reduce((sum, g) =>
            sum + g.names.filter(n => n.name !== g.canonical).reduce((s, n) => s + n.count, 0), 0);

        const confirmed = await confirm(
            `${activeGroups.length} grupta toplam ${totalAthletes} sporcunun okul ismi "${activeGroups.map(g => g.canonical).join('", "')}" gibi standart isimlere güncellenecek. Devam?`,
            { title: 'Okul İsimlerini Birleştir', type: 'warning' }
        );
        if (!confirmed) return;

        setBulkSaving(true);
        try {
            const updates = {};
            const affectedCats = new Set();

            activeGroups.forEach(group => {
                const nonCanonicals = new Set(group.names.filter(n => n.name !== group.canonical).map(n => n.name));
                athletes.forEach(ath => {
                    const athOkul = ath.okul || ath.kulup || '';
                    if (nonCanonicals.has(athOkul)) {
                        updates[`${firebasePath}/${selectedCompId}/sporcular/${ath.categoryId}/${ath.id}/okul`] = group.canonical;
                        updates[`${firebasePath}/${selectedCompId}/sporcular/${ath.categoryId}/${ath.id}/kulup`] = group.canonical;
                        affectedCats.add(ath.categoryId);
                    }
                });
            });

            if (Object.keys(updates).length > 0) {
                await update(ref(db), updates);
                await autoSyncTeamStatus(selectedCompId, [...affectedCats]);
                toast(`${Object.keys(updates).length / 2} sporcu güncellendi, takım türleri yeniden hesaplandı.`, 'success');
                setSimilarGroups([]);
            }
        } catch (err) {
            console.error('Okul birleştirme hatası:', err);
            toast('Birleştirme sırasında hata oluştu.', 'error');
        } finally {
            setBulkSaving(false);
        }
    };

    // Toplu okul ismi veya yarışma türü değiştirme (+ kategori düzeltme)
    const handleBulkEdit = async () => {
        if (!selectedCompId || !bulkOldValue || !bulkNewValue) {
            toast('Lütfen eski ve yeni değerleri seçin/girin.', 'warning');
            return;
        }
        if (bulkOldValue === bulkNewValue) {
            toast('Eski ve yeni değer aynı olamaz.', 'warning');
            return;
        }

        const field = bulkEditTab === 'okul' ? 'okul' : 'yarismaTuru';
        const matchAthletes = athletes.filter(a => {
            const val = (a[field] || (field === 'yarismaTuru' ? 'ferdi' : '')).toLowerCase();
            return val === bulkOldValue.toLowerCase();
        });

        if (matchAthletes.length === 0) {
            toast('Eşleşen sporcu bulunamadı.', 'warning');
            return;
        }

        // Kategori değişen sporcuları belirle
        const catChanges = matchAthletes.filter(a => bulkAthleteOverrides[a.id]?.categoryId && bulkAthleteOverrides[a.id].categoryId !== a.categoryId);
        const catChangeText = catChanges.length > 0 ? `\n${catChanges.length} sporcunun kategorisi de değişecek.` : '';

        const confirmed = await confirm(
            `${matchAthletes.length} sporcu için "${bulkOldValue}" → "${bulkNewValue}" olarak güncellenecek.${catChangeText} Devam?`,
            { title: 'Toplu Güncelleme', type: 'warning' }
        );
        if (!confirmed) return;

        setBulkSaving(true);
        try {
            const updates = {};
            const matchIds = new Set(matchAthletes.map(a => a.id));

            // Kategori değişecek sporcular için Firebase'den orijinal veri al
            const catsToRead = new Set(matchAthletes.map(a => a.categoryId));
            catChanges.forEach(a => catsToRead.add(bulkAthleteOverrides[a.id].categoryId));
            const srcAthCache = {};
            const siraCache = {};
            const scoresCache = {};

            for (const catId of catsToRead) {
                const [athSnap, siraSnap, scSnap] = await Promise.all([
                    get(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${catId}`)),
                    get(ref(db, `${firebasePath}/${selectedCompId}/siralama/${catId}`)),
                    get(ref(db, `${firebasePath}/${selectedCompId}/puanlar/${catId}`))
                ]);
                srcAthCache[catId] = athSnap.exists() ? athSnap.val() : {};
                siraCache[catId] = siraSnap.exists() ? siraSnap.val() : {};
                scoresCache[catId] = scSnap.exists() ? scSnap.val() : {};
            }

            for (const ath of matchAthletes) {
                const override = bulkAthleteOverrides[ath.id];
                const newCatId = override?.categoryId && override.categoryId !== ath.categoryId ? override.categoryId : null;

                if (newCatId) {
                    // Kategori de değişiyor — sporcu verisini taşı
                    const firebaseAth = srcAthCache[ath.categoryId]?.[ath.id] || {};
                    updates[`${firebasePath}/${selectedCompId}/sporcular/${ath.categoryId}/${ath.id}`] = null;
                    updates[`${firebasePath}/${selectedCompId}/sporcular/${newCatId}/${ath.id}`] = {
                        ...firebaseAth,
                        [field]: bulkNewValue,
                        kulup: field === 'okul' ? bulkNewValue : (firebaseAth.kulup || firebaseAth.okul || ''),
                        id: ath.id,
                        adSoyad: `${firebaseAth.ad || ''} ${firebaseAth.soyad || ''}`.trim(),
                        soyadAd: `${firebaseAth.soyad || ''} ${firebaseAth.ad || ''}`.trim(),
                        sirasi: firebaseAth.sirasi || 999
                    };

                    // Puanları taşı
                    const catScores = scoresCache[ath.categoryId];
                    if (catScores) {
                        Object.keys(catScores).forEach(aletId => {
                            if (catScores[aletId]?.[ath.id]) {
                                updates[`${firebasePath}/${selectedCompId}/puanlar/${ath.categoryId}/${aletId}/${ath.id}`] = null;
                                updates[`${firebasePath}/${selectedCompId}/puanlar/${newCatId}/${aletId}/${ath.id}`] = catScores[aletId][ath.id];
                            }
                        });
                    }

                    // Eski sıralamadan sil
                    const catSira = siraCache[ath.categoryId];
                    if (catSira) {
                        Object.keys(catSira).forEach(rotKey => {
                            if (catSira[rotKey]?.[ath.id]) {
                                updates[`${firebasePath}/${selectedCompId}/siralama/${ath.categoryId}/${rotKey}/${ath.id}`] = null;
                            }
                        });
                    }
                } else {
                    // Sadece alan güncelleme (kategori aynı)
                    const basePath = `${firebasePath}/${selectedCompId}/sporcular/${ath.categoryId}/${ath.id}`;
                    updates[`${basePath}/${field}`] = bulkNewValue;
                    if (field === 'okul') {
                        updates[`${basePath}/kulup`] = bulkNewValue;
                    }

                    // Siralama verisini güncelle
                    const siraField = field === 'okul' ? 'okul' : 'yarismaTuru';
                    const catSira = siraCache[ath.categoryId];
                    if (catSira) {
                        Object.keys(catSira).forEach(rotKey => {
                            if (catSira[rotKey]?.[ath.id]) {
                                updates[`${firebasePath}/${selectedCompId}/siralama/${ath.categoryId}/${rotKey}/${ath.id}/${siraField}`] = bulkNewValue;
                            }
                        });
                    }
                }
            }

            await update(ref(db), updates);
            toast(`${matchAthletes.length} sporcu başarıyla güncellendi.${catChanges.length > 0 ? ` ${catChanges.length} sporcunun kategorisi değiştirildi.` : ''}`, 'success');
            setBulkOldValue('');
            setBulkNewValue('');
            setBulkAthleteOverrides({});
        } catch (err) {
            console.error('Toplu güncelleme hatası:', err);
            toast('Güncelleme sırasında hata oluştu: ' + err.message, 'error');
        } finally {
            setBulkSaving(false);
        }
    };

    // Toplu kategori değişikliği
    const handleBulkCategoryChange = async () => {
        if (!selectedCompId || !bulkOldValue || !bulkNewValue) {
            toast('Eski ve yeni kategori seçilmelidir.', 'warning');
            return;
        }
        if (bulkOldValue === bulkNewValue) {
            toast('Eski ve yeni kategori aynı olamaz.', 'warning');
            return;
        }

        const matchAthletes = athletes.filter(a => a.categoryId === bulkOldValue);
        if (matchAthletes.length === 0) {
            toast('Bu kategoride sporcu bulunamadı.', 'warning');
            return;
        }

        const confirmed = await confirm(
            `${matchAthletes.length} sporcu "${bulkOldValue}" → "${bulkNewValue}" kategorisine taşınacak. Puanlar ve sıralama da taşınacak. Devam?`,
            { title: 'Toplu Kategori Değişikliği', type: 'warning' }
        );
        if (!confirmed) return;

        setBulkSaving(true);
        try {
            const updates = {};

            // Firebase'den güncel sporcu verisini oku (client-side eklenen alanlar olmasın)
            const srcAthSnap = await get(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${bulkOldValue}`));
            const srcAthData = srcAthSnap.exists() ? srcAthSnap.val() : {};
            const matchIds = new Set(matchAthletes.map(a => a.id));

            for (const ath of matchAthletes) {
                const athId = ath.id;
                // Firebase'deki orijinal veriyi kullan (categoryId gibi client alanları olmadan)
                const firebaseAth = srcAthData[athId] || {};

                updates[`${firebasePath}/${selectedCompId}/sporcular/${bulkOldValue}/${athId}`] = null;
                updates[`${firebasePath}/${selectedCompId}/sporcular/${bulkNewValue}/${athId}`] = {
                    ...firebaseAth,
                    id: athId,
                    adSoyad: `${firebaseAth.ad || ''} ${firebaseAth.soyad || ''}`.trim(),
                    soyadAd: `${firebaseAth.soyad || ''} ${firebaseAth.ad || ''}`.trim(),
                    sirasi: firebaseAth.sirasi || 999
                };
            }

            // Puanları taşı (tek okuma)
            const oldScoresSnap = await get(ref(db, `${firebasePath}/${selectedCompId}/puanlar/${bulkOldValue}`));
            if (oldScoresSnap.exists()) {
                const oldScores = oldScoresSnap.val();
                Object.keys(oldScores).forEach(aletId => {
                    if (oldScores[aletId]) {
                        Object.keys(oldScores[aletId]).forEach(athId => {
                            if (matchIds.has(athId)) {
                                updates[`${firebasePath}/${selectedCompId}/puanlar/${bulkOldValue}/${aletId}/${athId}`] = null;
                                updates[`${firebasePath}/${selectedCompId}/puanlar/${bulkNewValue}/${aletId}/${athId}`] = oldScores[aletId][athId];
                            }
                        });
                    }
                });
            }

            // Sıralamadan sil (tek okuma)
            const oldOrderSnap = await get(ref(db, `${firebasePath}/${selectedCompId}/siralama/${bulkOldValue}`));
            if (oldOrderSnap.exists()) {
                const oldOrder = oldOrderSnap.val();
                Object.keys(oldOrder).forEach(rotKey => {
                    if (oldOrder[rotKey]) {
                        Object.keys(oldOrder[rotKey]).forEach(athId => {
                            if (matchIds.has(athId)) {
                                updates[`${firebasePath}/${selectedCompId}/siralama/${bulkOldValue}/${rotKey}/${athId}`] = null;
                            }
                        });
                    }
                });
            }

            await update(ref(db), updates);
            toast(`${matchAthletes.length} sporcu "${bulkNewValue}" kategorisine taşındı.`, 'success');
            setBulkOldValue('');
            setBulkNewValue('');
        } catch (err) {
            console.error('Toplu kategori değişikliği hatası:', err);
            toast('Kategori değişikliği sırasında hata oluştu: ' + err.message, 'error');
        } finally {
            setBulkSaving(false);
        }
    };

    // Yarışmalar arası sporcu transferi
    const handleTransfer = async () => {
        if (!selectedCompId || !transferTargetCompId) {
            toast('Hedef yarışma seçilmelidir.', 'warning');
            return;
        }
        if (transferSelectedIds.size === 0) {
            toast('Transfer edilecek sporcu seçin.', 'warning');
            return;
        }

        const selectedAthletes = athletes.filter(a => transferSelectedIds.has(a.id));
        const targetCompName = competitions[transferTargetCompId]?.isim || transferTargetCompId;

        const confirmed = await confirm(
            `${selectedAthletes.length} sporcu "${targetCompName}" yarışmasına transfer edilecek. Kaynak yarışmadan silinecek. Devam?`,
            { title: 'Sporcu Transferi', type: 'warning' }
        );
        if (!confirmed) return;

        setBulkSaving(true);
        try {
            const updates = {};
            const selectedIds = new Set(selectedAthletes.map(a => a.id));

            // Etkilenen kategorileri belirle
            const affectedCats = [...new Set(selectedAthletes.map(a => a.categoryId))];

            // Kategoriye göre Firebase verisini cache'le (tek okuma per kategori)
            const srcAthCache = {};
            const scoresCache = {};
            const siraCache = {};

            for (const catId of affectedCats) {
                const [athSnap, scSnap, siSnap] = await Promise.all([
                    get(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${catId}`)),
                    get(ref(db, `${firebasePath}/${selectedCompId}/puanlar/${catId}`)),
                    get(ref(db, `${firebasePath}/${selectedCompId}/siralama/${catId}`))
                ]);
                srcAthCache[catId] = athSnap.exists() ? athSnap.val() : {};
                scoresCache[catId] = scSnap.exists() ? scSnap.val() : {};
                siraCache[catId] = siSnap.exists() ? siSnap.val() : {};

                // Hedef yarışmada aynı kategori yoksa oluştur
                if (transferTargetComp && !transferTargetComp.kategoriler?.[catId]) {
                    const sourceCatData = currentComp?.kategoriler?.[catId];
                    if (sourceCatData) {
                        updates[`${firebasePath}/${transferTargetCompId}/kategoriler/${catId}`] = sourceCatData;
                    }
                }
            }

            for (const ath of selectedAthletes) {
                const catId = ath.categoryId;
                const athId = ath.id;
                // Firebase'deki orijinal veriyi kullan
                const firebaseAth = srcAthCache[catId]?.[athId] || {};

                // Kaynak yarışmadan sil
                updates[`${firebasePath}/${selectedCompId}/sporcular/${catId}/${athId}`] = null;

                // Hedef yarışmaya ekle
                updates[`${firebasePath}/${transferTargetCompId}/sporcular/${catId}/${athId}`] = {
                    ...firebaseAth,
                    id: athId,
                    adSoyad: `${firebaseAth.ad || ''} ${firebaseAth.soyad || ''}`.trim(),
                    soyadAd: `${firebaseAth.soyad || ''} ${firebaseAth.ad || ''}`.trim(),
                    sirasi: firebaseAth.sirasi || 999
                };

                // Puanları taşı
                const catScores = scoresCache[catId];
                if (catScores) {
                    Object.keys(catScores).forEach(aletId => {
                        if (catScores[aletId]?.[athId]) {
                            updates[`${firebasePath}/${selectedCompId}/puanlar/${catId}/${aletId}/${athId}`] = null;
                            updates[`${firebasePath}/${transferTargetCompId}/puanlar/${catId}/${aletId}/${athId}`] = catScores[aletId][athId];
                        }
                    });
                }

                // Sıralamadan sil
                const catSira = siraCache[catId];
                if (catSira) {
                    Object.keys(catSira).forEach(rotKey => {
                        if (catSira[rotKey]?.[athId]) {
                            updates[`${firebasePath}/${selectedCompId}/siralama/${catId}/${rotKey}/${athId}`] = null;
                        }
                    });
                }
            }

            await update(ref(db), updates);
            toast(`${selectedAthletes.length} sporcu başarıyla transfer edildi.`, 'success');
            setTransferSelectedIds(new Set());
            setTransferSelectAll(false);
        } catch (err) {
            console.error('Transfer hatası:', err);
            toast('Transfer sırasında hata oluştu: ' + err.message, 'error');
        } finally {
            setBulkSaving(false);
        }
    };

    // Sporcu yarışma türünü (ferdi/takim) kural bazlı otomatik hesapla
    const handleRecalculateTur = async () => {
        if (!selectedCompId || athletes.length === 0) {
            toast('Önce yarışma seçin ve sporcuların yüklenmesini bekleyin.', 'warning');
            return;
        }

        // Kategori adlarını al
        const catNames = competitions[selectedCompId]?.kategoriler || {};

        // Grup: { catId_okul: [athlete, ...] }
        const groups = {};
        athletes.forEach(ath => {
            const okul = (ath.okul || ath.kulup || '').trim();
            if (!okul) return;
            const key = `${ath.categoryId}___${okul}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(ath);
        });

        // Her grup için yeni yarismaTuru hesapla
        const updates = {};
        let changedCount = 0;
        let unchangedCount = 0;
        const summary = [];

        Object.entries(groups).forEach(([key, grpAthletes]) => {
            const [catId] = key.split('___');
            const catName = catNames[catId]?.name || catId;
            const rules = getTeamRules(catName);

            let newTur;
            if (!rules) {
                // Kural tanımsız kategori → dokunma
                unchangedCount += grpAthletes.length;
                return;
            }
            newTur = grpAthletes.length >= rules.min ? 'takim' : 'ferdi';

            grpAthletes.forEach(ath => {
                const oldTur = ath.yarismaTuru || 'ferdi';
                if (oldTur !== newTur) {
                    updates[`${firebasePath}/${selectedCompId}/sporcular/${ath.categoryId}/${ath.id}/yarismaTuru`] = newTur;
                    changedCount++;
                    summary.push(`${ath.ad} ${ath.soyad} (${catName}): ${oldTur} → ${newTur}`);
                } else {
                    unchangedCount++;
                }
            });
        });

        if (changedCount === 0) {
            toast(`Tüm sporcuların türü zaten doğru. (${unchangedCount} sporcu kontrol edildi)`, 'success');
            return;
        }

        const confirmText = `${changedCount} sporcunun türü değiştirilecek:\n\n${summary.slice(0, 10).join('\n')}${summary.length > 10 ? `\n...ve ${summary.length - 10} daha` : ''}\n\nDevam edilsin mi?`;
        const confirmed = await confirm(confirmText, { title: 'Tür Hesaplama', type: 'warning' });
        if (!confirmed) return;

        try {
            await update(ref(db), updates);
            toast(`${changedCount} sporcu güncellendi, ${unchangedCount} sporcu değiştirilmedi.`, 'success');
        } catch (err) {
            console.error('Tür hesaplama hatası:', err);
            toast('Güncelleme sırasında hata oluştu: ' + err.message, 'error');
        }
    };

    return (
        <div className="athletes-page">
            <header className="page-header">
                <div className="page-header__left">
                    <button className="back-btn" onClick={() => navigate(routePrefix)}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div className="header-title-wrapper">
                        <h1 className="page-title">Sporcular</h1>
                        <p className="page-subtitle">Onaylı sporcu listesi ve yönetimi</p>
                    </div>
                </div>
                <div className="page-header__right">
                    <button
                        className="action-btn-outline"
                        style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
                        onClick={() => { setIsGlobalModalOpen(true); setGlobalSearchText(''); }}
                    >
                        <i className="material-icons-round">travel_explore</i>
                        <span>Tüm Yarışmalarda Ara</span>
                    </button>
                    <input
                        type="file"
                        accept=".xlsx, .xls"
                        style={{ display: 'none' }}
                        ref={fileInputRef}
                        onChange={handleExcelImport}
                    />
                    {hasPermission('athletes', 'duzenle') && (
                        <button
                            className="action-btn-outline"
                            style={{ borderColor: '#7C3AED', color: '#7C3AED' }}
                            onClick={handleRecalculateTur}
                            disabled={!selectedCompId || athletes.length === 0}
                            title="Okul başına sporcu sayısına göre ferdi/takım türünü otomatik hesapla"
                        >
                            <i className="material-icons-round">calculate</i>
                            <span>Tür Hesapla</span>
                        </button>
                    )}
                    {hasPermission('athletes', 'duzenle') && (
                        <button
                            className="action-btn-outline"
                            style={{ borderColor: '#D97706', color: '#D97706' }}
                            onClick={() => { setIsBulkEditOpen(true); setBulkOldValue(''); setBulkNewValue(''); setBulkEditTab('okul'); }}
                            disabled={!selectedCompId || athletes.length === 0}
                            title="Toplu okul ismi veya yarışma türü düzelt"
                        >
                            <i className="material-icons-round">find_replace</i>
                            <span>Toplu Düzenle</span>
                        </button>
                    )}
                    {hasPermission('athletes', 'ekle') && (
                        <button
                            className="action-btn-outline"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={!selectedCompId}
                            title={!selectedCompId ? "Önce Yarışma Seçin" : "Excel ile Yükle"}
                        >
                            <i className="material-icons-round">upload_file</i>
                            <span>Excel ile Yükle</span>
                        </button>
                    )}
                    <button
                        className="action-btn-outline"
                        style={{ borderColor: '#059669', color: '#059669' }}
                        onClick={handleExcelExport}
                        disabled={!selectedCompId || filteredAthletes.length === 0}
                        title={!selectedCompId ? "Önce Yarışma Seçin" : `Filtrelenmiş ${filteredAthletes.length} sporcuyu Excel'e aktar`}
                    >
                        <i className="material-icons-round">download</i>
                        <span>Excel'e Aktar</span>
                    </button>

                    {hasPermission('athletes', 'ekle') && (
                        <button
                            className="create-btn"
                            onClick={() => openModal()}
                            disabled={!selectedCompId}
                        >
                            <i className="material-icons-round">person_add</i>
                            <span>Manuel Ekle</span>
                        </button>
                    )}
                </div>
            </header>

            <main className="page-content">
                <div className="athletes-controls">
                    <div className="control-group">
                        <i className="material-icons-round control-icon">place</i>
                        <select
                            className="control-select"
                            value={filterCity}
                            onChange={(e) => { setFilterCity(e.target.value); setSelectedCompId(''); }}
                        >
                            <option value="">-- Tüm İller --</option>
                            {availableCities.map(city => (
                                <option key={city} value={city}>{city}</option>
                            ))}
                        </select>
                    </div>

                    <div className="control-group">
                        <i className="material-icons-round control-icon">emoji_events</i>
                        <select
                            className="control-select"
                            value={selectedCompId}
                            onChange={(e) => { setSelectedCompId(e.target.value); setFilterCategory(''); setFilterSchool(''); }}
                        >
                            <option value="">-- Yarışma Seçiniz --</option>
                            {compOptions.map(([id, comp]) => (
                                <option key={id} value={id}>{comp.isim}</option>
                            ))}
                        </select>
                    </div>

                    <div className="control-group">
                        <i className="material-icons-round control-icon">search</i>
                        <input
                            type="text"
                            className="control-input"
                            placeholder="Sporcu adı, okul veya TC ara..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            disabled={!selectedCompId}
                        />
                    </div>

                    <div className="control-group">
                        <i className="material-icons-round control-icon">category</i>
                        <select
                            className="control-select"
                            value={filterCategory}
                            onChange={(e) => { setFilterCategory(e.target.value); setFilterSchool(''); }}
                            disabled={!selectedCompId || uniqueCategories.length === 0}
                        >
                            <option value="">-- Tüm Kategoriler --</option>
                            {uniqueCategories.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {loading ? (
                    <div className="loading-state">
                        <div className="spinner"></div>
                        <p>Sporcular yükleniyor...</p>
                    </div>
                ) : !selectedCompId ? (
                    <div className="empty-state">
                        <div className="empty-state__icon">
                            <i className="material-icons-round">touch_app</i>
                        </div>
                        <p>Sporcuları görüntülemek için lütfen bir yarışma seçin.</p>
                    </div>
                ) : (
                    <div className="athletes-container">
                        <div className="athletes-stats">
                            <div className="stat-pill">Toplam: <strong>{athletes.length}</strong> Sporcu</div>
                            <div className="stat-pill">Bulunan: <strong>{filteredAthletes.length}</strong> Sonuç</div>
                            <div className="view-toggle">
                                <button
                                    className={`view-toggle-btn ${viewMode === 'cards' ? 'view-toggle-btn--active' : ''}`}
                                    onClick={() => setViewMode('cards')}
                                    title="Kart görünümü"
                                >
                                    <i className="material-icons-round">grid_view</i>
                                </button>
                                <button
                                    className={`view-toggle-btn ${viewMode === 'grouped' ? 'view-toggle-btn--active' : ''}`}
                                    onClick={() => setViewMode('grouped')}
                                    title="İl / Okul gruplu görünüm"
                                >
                                    <i className="material-icons-round">account_tree</i>
                                </button>
                            </div>
                        </div>

                        {/* ─── Okul Kontenjan Paneli ─── */}
                        {(() => {
                            // Hangi kategoriler gösterilecek?
                            const catsToShow = filterCategory
                                ? [filterCategory]
                                : [...new Set(athletes.map(a => a.categoryId))];

                            const panels = catsToShow.map(catId => {
                                const catName = competitions[selectedCompId]?.kategoriler?.[catId]?.name || catId;
                                const rules = getTeamRules(catName || catId);
                                if (!rules) return null; // Kural tanımsız kategorileri atla

                                // Bu kategorideki okul bazlı grupla — il+okul bileşik anahtar ile aynı isimli farklı okullara karışmasın
                                const catAthletes = athletes.filter(a => a.categoryId === catId);
                                const schoolMap = {}; // key: "IL___OKUL", value: { count, il, okul }
                                catAthletes.forEach(a => {
                                    const okul = (a.okul || a.kulup || 'Belirtilmemiş').toLocaleUpperCase('tr-TR');
                                    const il = (a.il || '').toLocaleUpperCase('tr-TR');
                                    const key = `${il}___${okul}`;
                                    if (!schoolMap[key]) schoolMap[key] = { count: 0, il, okul };
                                    schoolMap[key].count++;
                                });
                                if (Object.keys(schoolMap).length === 0) return null;

                                return { catId, catName, rules, schoolMap };
                            }).filter(Boolean);

                            if (panels.length === 0) return null;

                            return (
                                <div className="quota-panel">
                                    <div className="quota-panel__header">
                                        <i className="material-icons-round">bar_chart</i>
                                        <span>Okul Kontenjanları</span>
                                    </div>
                                    {panels.map(({ catId, catName, rules, schoolMap }) => (
                                        <div key={catId} className="quota-category">
                                            {!filterCategory && (
                                                <div className="quota-category__title">{catName || catId}</div>
                                            )}
                                            <div className="quota-schools">
                                                {Object.entries(schoolMap)
                                                    .sort((a, b) => b[1].count - a[1].count)
                                                    .map(([schoolKey2, { count, il, okul }]) => {
                                                        const pct = Math.min((count / rules.max) * 100, 100);
                                                        const remaining = rules.max - count;
                                                        const isTeam = count >= rules.min;
                                                        const isFull = count >= rules.max;
                                                        const barColor = isFull ? '#EF4444' : isTeam ? '#16A34A' : '#F59E0B';
                                                        const schoolKey = `${catId}__${schoolKey2}`;
                                                        const isOpen = expandedSchool === schoolKey;
                                                        // il + okul bileşik filtresi: aynı isimli farklı il okulları ayrı listelenir
                                                        const schoolAthletes = athletes.filter(a =>
                                                            a.categoryId === catId &&
                                                            (a.okul || a.kulup || '').toLocaleUpperCase('tr-TR') === okul &&
                                                            (a.il || '').toLocaleUpperCase('tr-TR') === il
                                                        );
                                                        return (
                                                            <div
                                                                key={schoolKey2}
                                                                className={`quota-school-row${isOpen ? ' quota-school-row--active' : ''}`}
                                                            >
                                                                <div
                                                                    className="quota-school-row__info"
                                                                    onClick={() => setExpandedSchool(isOpen ? '' : schoolKey)}
                                                                    style={{ cursor: 'pointer' }}
                                                                    title={isOpen ? 'Kapat' : 'Sporcuları göster'}
                                                                >
                                                                    <span className="quota-school-name">
                                                                        <i className="material-icons-round" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 3, color: isOpen ? '#4F46E5' : '#9CA3AF', transition: 'transform .2s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>chevron_right</i>
                                                                        {okul}{il ? <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 4 }}>({il})</span> : null}
                                                                    </span>
                                                                    <span className="quota-school-badges">
                                                                        <span className="quota-count" style={{ color: barColor }}>
                                                                            {count}/{rules.max}
                                                                        </span>
                                                                        {isTeam && <span className="quota-badge quota-badge--team">Takım</span>}
                                                                        {isFull
                                                                            ? <span className="quota-badge quota-badge--full">Dolu</span>
                                                                            : <span className="quota-badge quota-badge--remaining">{remaining} yer kaldı</span>
                                                                        }
                                                                    </span>
                                                                </div>
                                                                <div className="quota-bar-track">
                                                                    <div
                                                                        className="quota-bar-fill"
                                                                        style={{ width: `${pct}%`, background: barColor }}
                                                                    />
                                                                    {/* Min eşik işareti */}
                                                                    <div
                                                                        className="quota-bar-min"
                                                                        style={{ left: `${(rules.min / rules.max) * 100}%` }}
                                                                        title={`Takım eşiği: ${rules.min}`}
                                                                    />
                                                                </div>

                                                                {/* Accordion: sporcu listesi */}
                                                                {isOpen && (
                                                                    <div className="quota-accordion">
                                                                        {schoolAthletes.length === 0 ? (
                                                                            <p className="quota-accordion__empty">Sporcu bulunamadı.</p>
                                                                        ) : (
                                                                            <table className="quota-athlete-table">
                                                                                <thead>
                                                                                    <tr>
                                                                                        <th>#</th>
                                                                                        <th>Ad Soyad</th>
                                                                                        <th>TCKN</th>
                                                                                        <th>Doğum</th>
                                                                                        <th>Tür</th>
                                                                                        <th></th>
                                                                                    </tr>
                                                                                </thead>
                                                                                <tbody>
                                                                                    {schoolAthletes.map((ath, i) => (
                                                                                        <tr key={ath.id}>
                                                                                            <td className="quota-athlete-table__num">{i + 1}</td>
                                                                                            <td className="quota-athlete-table__name">{ath.ad} {ath.soyad}</td>
                                                                                            <td className="quota-athlete-table__tckn">{ath.tckn || '—'}</td>
                                                                                            <td className="quota-athlete-table__dob">{ath.dogumTarihi || ath.dob || '—'}</td>
                                                                                            <td>
                                                                                                <span className={`quota-tur-badge quota-tur-badge--${(ath.yarismaTuru || 'ferdi').toLowerCase()}`}>
                                                                                                    {ath.yarismaTuru === 'takim' ? 'Takım' : 'Ferdi'}
                                                                                                </span>
                                                                                            </td>
                                                                                            <td>
                                                                                                {hasPermission('athletes', 'duzenle') && (
                                                                                                    <button
                                                                                                        className="quota-edit-btn"
                                                                                                        onClick={() => {
                                                                                                            setEditingAthlete(ath);
                                                                                                            setFormData({
                                                                                                                ad: ath.ad || '',
                                                                                                                soyad: ath.soyad || '',
                                                                                                                tckn: ath.tckn || '',
                                                                                                                lisans: ath.lisansNo || ath.lisans || '',
                                                                                                                dob: ath.dogumTarihi || ath.dob || '',
                                                                                                                okul: ath.okul || ath.kulup || '',
                                                                                                                il: ath.il || '',
                                                                                                                categoryId: ath.categoryId || '',
                                                                                                                yarismaTuru: ath.yarismaTuru || 'ferdi'
                                                                                                            });
                                                                                                            setIsModalOpen(true);
                                                                                                        }}
                                                                                                        title="Düzenle"
                                                                                                    >
                                                                                                        <i className="material-icons-round">edit</i>
                                                                                                    </button>
                                                                                                )}
                                                                                            </td>
                                                                                        </tr>
                                                                                    ))}
                                                                                </tbody>
                                                                            </table>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}

                        {filteredAthletes.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-state__icon">
                                    <i className="material-icons-round">groups</i>
                                </div>
                                <p>Arama kriterlerine uygun sporcu bulunamadı.</p>
                            </div>
                        ) : viewMode === 'grouped' ? (() => {
                            // İl → Okul → Sporcular hiyerarşisi
                            const catNames = competitions[selectedCompId]?.kategoriler || {};
                            const byCitySchool = {};
                            filteredAthletes.forEach(ath => {
                                const il = (ath.il || 'Belirtilmemiş').toLocaleUpperCase('tr-TR');
                                const okul = (ath.okul || ath.kulup || 'Belirtilmemiş').toLocaleUpperCase('tr-TR');
                                if (!byCitySchool[il]) byCitySchool[il] = {};
                                if (!byCitySchool[il][okul]) byCitySchool[il][okul] = [];
                                byCitySchool[il][okul].push(ath);
                            });
                            const sortedIls = Object.keys(byCitySchool).sort((a, b) => a.localeCompare(b, 'tr-TR'));

                            return (
                                <div className="grouped-view">
                                    {sortedIls.map(il => {
                                        const ilCollapsed = collapsedIls.has(il);
                                        const ilAthletes = Object.values(byCitySchool[il]).flat();
                                        const sortedSchools = Object.keys(byCitySchool[il]).sort((a, b) => a.localeCompare(b, 'tr-TR'));
                                        return (
                                            <div key={il} className="group-il">
                                                <button
                                                    className="group-il__header"
                                                    onClick={() => setCollapsedIls(prev => {
                                                        const next = new Set(prev);
                                                        next.has(il) ? next.delete(il) : next.add(il);
                                                        return next;
                                                    })}
                                                >
                                                    <i className="material-icons-round">place</i>
                                                    <span className="group-il__name">{il}</span>
                                                    <span className="group-il__count">{sortedSchools.length} okul · {ilAthletes.length} sporcu</span>
                                                    <i className="material-icons-round group-il__chevron">{ilCollapsed ? 'expand_more' : 'expand_less'}</i>
                                                </button>

                                                {!ilCollapsed && sortedSchools.map(okul => {
                                                    const schoolAthletes = byCitySchool[il][okul];
                                                    const schoolKey = `${il}__${okul}`;
                                                    const schoolCollapsed = collapsedSchools.has(schoolKey);
                                                    const takimCount = schoolAthletes.filter(a => a.yarismaTuru === 'takim').length;
                                                    const ferdiCount = schoolAthletes.length - takimCount;
                                                    return (
                                                        <div key={okul} className="group-school">
                                                            <button
                                                                className="group-school__header"
                                                                onClick={() => setCollapsedSchools(prev => {
                                                                    const next = new Set(prev);
                                                                    next.has(schoolKey) ? next.delete(schoolKey) : next.add(schoolKey);
                                                                    return next;
                                                                })}
                                                            >
                                                                <i className="material-icons-round">school</i>
                                                                <span className="group-school__name">{okul}</span>
                                                                <div className="group-school__badges">
                                                                    <span className="group-badge group-badge--total">{schoolAthletes.length} sporcu</span>
                                                                    {takimCount > 0 && <span className="group-badge group-badge--takim">Takım: {takimCount}</span>}
                                                                    {ferdiCount > 0 && <span className="group-badge group-badge--ferdi">Ferdi: {ferdiCount}</span>}
                                                                </div>
                                                                <i className="material-icons-round group-school__chevron">{schoolCollapsed ? 'expand_more' : 'expand_less'}</i>
                                                            </button>

                                                            {!schoolCollapsed && (
                                                                <div className="group-school__athletes">
                                                                    <table className="group-athletes-table">
                                                                        <thead>
                                                                            <tr>
                                                                                <th>#</th>
                                                                                <th>Ad Soyad</th>
                                                                                <th>Kategori</th>
                                                                                <th>Tür</th>
                                                                                <th>T.C.</th>
                                                                                <th>Doğum</th>
                                                                                <th></th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {schoolAthletes
                                                                                .sort((a, b) => `${a.ad} ${a.soyad}`.localeCompare(`${b.ad} ${b.soyad}`, 'tr-TR'))
                                                                                .map((ath, i) => {
                                                                                    const catObj = catNames[ath.categoryId] || {};
                                                                                    const catLabel = catObj.isim || catObj.name || catObj.ad || ath.categoryId;
                                                                                    return (
                                                                                        <tr key={ath.id}>
                                                                                            <td className="col-num">{i + 1}</td>
                                                                                            <td className="col-name">{ath.ad} {ath.soyad}</td>
                                                                                            <td><span className="athlete-cat-badge" style={{ fontSize: '0.75rem' }}>{catLabel}</span></td>
                                                                                            <td>
                                                                                                <span className={`tur-badge ${ath.yarismaTuru === 'takim' ? 'tur-badge--takim' : 'tur-badge--ferdi'}`}>
                                                                                                    {ath.yarismaTuru === 'takim' ? 'TAKIM' : 'FERDİ'}
                                                                                                </span>
                                                                                            </td>
                                                                                            <td className="col-tc">{ath.tckn || '-'}</td>
                                                                                            <td className="col-dob">{ath.dob || '-'}</td>
                                                                                            <td className="col-actions">
                                                                                                {hasPermission('athletes', 'duzenle') && (
                                                                                                    <button className="edit-btn" onClick={() => openModal(ath)} title="Düzenle">
                                                                                                        <i className="material-icons-round">edit</i>
                                                                                                    </button>
                                                                                                )}
                                                                                                {hasPermission('athletes', 'sil') && (
                                                                                                    <button className="del-btn" onClick={() => handleDelete(ath.categoryId, ath.id, `${ath.ad} ${ath.soyad}`)} title="Sil">
                                                                                                        <i className="material-icons-round">delete_outline</i>
                                                                                                    </button>
                                                                                                )}
                                                                                            </td>
                                                                                        </tr>
                                                                                    );
                                                                                })}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })() : (
                            <div className="athletes-grid">
                                {filteredAthletes.map((ath, index) => (
                                    <div className="athlete-card" key={ath.id} style={{ animationDelay: `${(index % 10) * 0.03}s` }}>
                                        <div className="athlete-card__header">
                                            <div className="athlete-avatar">
                                                {ath.ad ? ath.ad.charAt(0).toUpperCase() : '?'}
                                            </div>
                                            <div className="athlete-card__title">
                                                <h3>{ath.ad} {ath.soyad}</h3>
                                                <span className="athlete-cat-badge" title={ath.categoryId}>{ath.categoryId}</span>
                                            </div>
                                            <div className="athlete-actions">
                                                {hasPermission('athletes', 'duzenle') && (
                                                    <button className="edit-btn" onClick={() => openModal(ath)} title="Düzenle">
                                                        <i className="material-icons-round">edit</i>
                                                    </button>
                                                )}
                                                {hasPermission('athletes', 'sil') && (
                                                    <button className="del-btn" onClick={() => handleDelete(ath.categoryId, ath.id, `${ath.ad} ${ath.soyad}`)} title="Sil">
                                                        <i className="material-icons-round">delete_outline</i>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="athlete-card__body">
                                            <div className="detail-row">
                                                <i className="material-icons-round">school</i>
                                                <span title={ath.okul}>{ath.okul || 'Okul Belirtilmemiş'}</span>
                                            </div>
                                            <div className="detail-row">
                                                <i className="material-icons-round">badge</i>
                                                <span>TC: {ath.tckn} • Lisans: {ath.lisans}</span>
                                            </div>
                                            <div className="detail-row">
                                                <i className="material-icons-round">cake</i>
                                                <span>Doğum: {ath.dob}</span>
                                            </div>
                                            <div className="detail-row">
                                                <i className="material-icons-round">place</i>
                                                <span>{ath.il || '-'} • Tür: {ath.yarismaTuru === 'takim' ? 'TAKIM' : 'FERDİ'}</span>
                                            </div>
                                            <button
                                                className="athlete-profile-link"
                                                onClick={(e) => { e.stopPropagation(); navigate(`${routePrefix}/athlete/${selectedCompId}/${ath.categoryId}/${ath.id}`); }}
                                            >
                                                <i className="material-icons-round">person</i>
                                                Profil & Puanlar
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* Ek/Düzenle Modal */}
            {isModalOpen && (
                <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="modal modal--large" onClick={e => e.stopPropagation()}>
                        <div className="modal__header">
                            <h2>{editingAthlete ? 'Sporcu Düzenle' : 'Yeni Sporcu Ekle'}</h2>
                            <button className="modal__close" onClick={() => setIsModalOpen(false)}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>

                        <form className="modal__form-grid" onSubmit={saveAthlete}>
                            <div className="form-group">
                                <label>Ad *</label>
                                <input type="text" required value={formData.ad} onChange={e => setFormData({ ...formData, ad: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Soyad *</label>
                                <input type="text" required value={formData.soyad} onChange={e => setFormData({ ...formData, soyad: e.target.value })} />
                            </div>

                            <div className="form-group">
                                <label>Kategori (Örn: Minik A Kız) *</label>
                                <input type="text" required value={formData.categoryId} onChange={e => setFormData({ ...formData, categoryId: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Tür</label>
                                <select value={formData.yarismaTuru} onChange={e => setFormData({ ...formData, yarismaTuru: e.target.value })}>
                                    <option value="ferdi">Ferdi</option>
                                    <option value="takim">Takım</option>
                                </select>
                            </div>

                            <div className="form-group">
                                <label>TC Kimlik No</label>
                                <input type="text" value={formData.tckn} onChange={e => setFormData({ ...formData, tckn: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Lisans No</label>
                                <input type="text" value={formData.lisans} onChange={e => setFormData({ ...formData, lisans: e.target.value })} />
                            </div>

                            <div className="form-group">
                                <label>Doğum Tarihi</label>
                                <input type="date" value={formData.dob} onChange={e => setFormData({ ...formData, dob: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>İl</label>
                                <input type="text" value={formData.il} onChange={e => setFormData({ ...formData, il: e.target.value })} />
                            </div>

                            <div className="form-group form-group--full">
                                <label>Okul Adı</label>
                                <input type="text" value={formData.okul} onChange={e => setFormData({ ...formData, okul: e.target.value })} />
                            </div>

                            <div className="modal__footer">
                                <button type="button" className="btn btn--secondary" onClick={() => setIsModalOpen(false)}>İptal</button>
                                <button type="submit" className="btn btn--primary">
                                    {editingAthlete ? 'Güncelle' : 'Kaydet'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Global Search Modal */}
            {isGlobalModalOpen && (
                <div className="modal-overlay" onClick={() => setIsGlobalModalOpen(false)}>
                    <div className="modal modal--large" onClick={e => e.stopPropagation()}>
                        <div className="modal__header">
                            <h2>Tüm Yarışmalarda Sporcu Ara</h2>
                            <button className="modal__close" onClick={() => setIsGlobalModalOpen(false)}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>
                        <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.5rem' }}>
                            <div className="control-group" style={{ margin: 0, width: '100%', maxWidth: 'none' }}>
                                <i className="material-icons-round control-icon">search</i>
                                <input
                                    type="text"
                                    className="control-input"
                                    placeholder="Sporcu adı, lisans veya TC yazın (En az 3 harf)..."
                                    value={globalSearchText}
                                    onChange={(e) => setGlobalSearchText(e.target.value)}
                                    autoFocus
                                />
                            </div>

                            <div className="global-search-results" style={{ maxHeight: '60vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {globalSearchText.length > 0 && globalSearchText.length < 3 && (
                                    <p style={{ color: 'var(--text-secondary)', textAlign: 'center', margin: '2rem 0' }}>Aramak için en az 3 karakter girin.</p>
                                )}
                                {globalSearchText.length >= 3 && globalSearchResults.length === 0 && (
                                    <div className="empty-state" style={{ margin: '2rem 0' }}>
                                        <i className="material-icons-round" style={{ fontSize: '3rem', color: 'var(--text-tertiary)', marginBottom: '0.5rem' }}>person_off</i>
                                        <p>Eşleşen sporcu bulunamadı.</p>
                                    </div>
                                )}
                                {globalSearchResults.map((res, i) => (
                                    <div key={i} className="global-search-card" style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <div>
                                                <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.1rem' }}>{res.athlete.ad} {res.athlete.soyad}</h3>
                                                <p style={{ margin: '0.2rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <i className="material-icons-round" style={{ fontSize: '1rem' }}>badge</i> TC: {res.athlete.tckn || '-'} • Lisans: {res.athlete.lisans || '-'}
                                                </p>
                                            </div>
                                            <div style={{ textAlign: 'right', fontSize: '0.9rem', color: 'var(--text-tertiary)' }}>
                                                Doğum: {res.athlete.dob || '-'}
                                            </div>
                                        </div>
                                        <div style={{ marginTop: '0.5rem' }}>
                                            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Katıldığı Yarışmalar ({res.competitions.length})</h4>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                {res.competitions.map((c, j) => (
                                                    <div key={j} onClick={() => navigate(`${routePrefix}/athlete/${c.compId}/${c.catId}/${c.id}`)} style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', flexDirection: 'column', gap: '0.2rem' }} className="hover-lift">
                                                        <strong style={{ color: 'var(--primary)' }}>{c.compName}</strong>
                                                        <span style={{ color: 'var(--text-secondary)' }}>{c.catId} • {c.okul || 'Okul Yok'}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Edit Modal */}
            {isBulkEditOpen && (
                <div className="modal-overlay" onClick={() => setIsBulkEditOpen(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: bulkEditTab === 'transfer' ? '700px' : bulkEditTab === 'birleştir' ? '640px' : '560px' }}>
                        <div className="modal__header">
                            <h2>Toplu Düzenleme</h2>
                            <button className="modal__close" onClick={() => setIsBulkEditOpen(false)}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>
                        <div className="modal__body" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                            {/* Tab seçimi */}
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                {[
                                    { key: 'okul', icon: 'school', label: 'Okul İsmi' },
                                    { key: 'tur', icon: 'groups', label: 'Yarışma Türü' },
                                    { key: 'kategori', icon: 'category', label: 'Kategori' },
                                    { key: 'transfer', icon: 'swap_horiz', label: 'Transfer' },
                                    { key: 'birleştir', icon: 'merge', label: 'Benzer Okul' },
                                ].map(tab => (
                                    <button
                                        key={tab.key}
                                        style={{
                                            flex: 1,
                                            background: bulkEditTab === tab.key ? 'var(--primary)' : 'transparent',
                                            color: bulkEditTab === tab.key ? '#fff' : 'var(--text-primary)',
                                            border: `1px solid ${bulkEditTab === tab.key ? 'var(--primary)' : 'var(--border)'}`,
                                            borderRadius: '8px', padding: '10px', cursor: 'pointer', fontWeight: 600,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.85rem'
                                        }}
                                        onClick={() => { setBulkEditTab(tab.key); setBulkOldValue(''); setBulkNewValue(''); setBulkCustomSchool(false); setTransferSelectedIds(new Set()); setTransferSelectAll(false); setTransferTargetCompId(''); setTransferCategory(''); setBulkAthleteOverrides({}); setSimilarGroups([]); }}
                                    >
                                        <i className="material-icons-round" style={{ fontSize: '18px' }}>{tab.icon}</i>
                                        {tab.label}
                                    </button>
                                ))}
                            </div>

                            {/* ── OKUL İSMİ DÜZELT ── */}
                            {bulkEditTab === 'okul' && (
                                <>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Mevcut Okul İsmi (Yanlış)</label>
                                        <select className="control-select" style={{ width: '100%', padding: '10px 12px' }}
                                            value={bulkOldValue} onChange={e => { setBulkOldValue(e.target.value); setBulkAthleteOverrides({}); }}>
                                            <option value="">-- Okul seçin --</option>
                                            {uniqueSchools.map(s => {
                                                const count = athletes.filter(a => (a.okul || a.kulup || '') === s).length;
                                                return <option key={s} value={s}>{s} ({count} sporcu)</option>;
                                            })}
                                        </select>
                                    </div>
                                    <div style={{ textAlign: 'center', color: 'var(--text-tertiary)' }}>
                                        <i className="material-icons-round" style={{ fontSize: '24px' }}>arrow_downward</i>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Doğru Okul İsmi</label>
                                            <button type="button" onClick={() => { setBulkCustomSchool(!bulkCustomSchool); setBulkNewValue(''); }}
                                                style={{ fontSize: '0.78rem', padding: '3px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: bulkCustomSchool ? 'var(--primary)' : 'var(--bg-secondary)', color: bulkCustomSchool ? '#fff' : 'var(--text-secondary)', cursor: 'pointer' }}>
                                                {bulkCustomSchool ? 'Listeden Seç' : 'Özel İsim Yaz'}
                                            </button>
                                        </div>
                                        {bulkCustomSchool ? (
                                            <input type="text" className="control-input" style={{ width: '100%', padding: '10px 12px' }}
                                                placeholder="Doğru okul ismini yazın..." value={bulkNewValue} onChange={e => setBulkNewValue(e.target.value)} />
                                        ) : (
                                            <select className="control-select" style={{ width: '100%', padding: '10px 12px' }}
                                                value={bulkNewValue} onChange={e => setBulkNewValue(e.target.value)}>
                                                <option value="">-- Birleştirilecek okul seçin --</option>
                                                {uniqueSchools.filter(s => s !== bulkOldValue).map(s => {
                                                    const count = athletes.filter(a => (a.okul || a.kulup || '') === s).length;
                                                    return <option key={s} value={s}>{s} ({count} sporcu)</option>;
                                                })}
                                            </select>
                                        )}
                                    </div>
                                </>
                            )}

                            {/* ── YARIŞMA TÜRÜ DEĞİŞTİR ── */}
                            {bulkEditTab === 'tur' && (
                                <>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Mevcut Yarışma Türü</label>
                                        <select className="control-select" style={{ width: '100%', padding: '10px 12px' }}
                                            value={bulkOldValue} onChange={e => setBulkOldValue(e.target.value)}>
                                            <option value="">-- Tür seçin --</option>
                                            {uniqueTurTypes.map(t => {
                                                const count = athletes.filter(a => (a.yarismaTuru || 'ferdi').toLowerCase() === t).length;
                                                return <option key={t} value={t}>{t.toUpperCase()} ({count} sporcu)</option>;
                                            })}
                                        </select>
                                    </div>
                                    <div style={{ textAlign: 'center', color: 'var(--text-tertiary)' }}>
                                        <i className="material-icons-round" style={{ fontSize: '24px' }}>arrow_downward</i>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Yeni Yarışma Türü</label>
                                        <select className="control-select" style={{ width: '100%', padding: '10px 12px' }}
                                            value={bulkNewValue} onChange={e => setBulkNewValue(e.target.value)}>
                                            <option value="">-- Yeni tür seçin --</option>
                                            <option value="ferdi">FERDİ</option>
                                            <option value="takim">TAKIM</option>
                                        </select>
                                    </div>
                                </>
                            )}

                            {/* ── KATEGORİ DEĞİŞTİR ── */}
                            {bulkEditTab === 'kategori' && (
                                <>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Mevcut Kategori</label>
                                        <select className="control-select" style={{ width: '100%', padding: '10px 12px' }}
                                            value={bulkOldValue} onChange={e => setBulkOldValue(e.target.value)}>
                                            <option value="">-- Kategori seçin --</option>
                                            {uniqueCategories.map(c => {
                                                const count = athletes.filter(a => a.categoryId === c).length;
                                                return <option key={c} value={c}>{c} ({count} sporcu)</option>;
                                            })}
                                        </select>
                                    </div>
                                    <div style={{ textAlign: 'center', color: 'var(--text-tertiary)' }}>
                                        <i className="material-icons-round" style={{ fontSize: '24px' }}>arrow_downward</i>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Hedef Kategori</label>
                                        <select className="control-select" style={{ width: '100%', padding: '10px 12px' }}
                                            value={bulkNewValue} onChange={e => setBulkNewValue(e.target.value)}>
                                            <option value="">-- Hedef kategori seçin --</option>
                                            {(() => {
                                                const comp = competitions[selectedCompId];
                                                const allCats = new Set();
                                                if (comp?.kategoriler) Object.keys(comp.kategoriler).forEach(k => allCats.add(k));
                                                if (comp?.sporcular) Object.keys(comp.sporcular).forEach(k => allCats.add(k));
                                                return [...allCats].filter(c => c && c !== 'undefined' && c !== bulkOldValue).sort().map(c => (
                                                    <option key={c} value={c}>{c}</option>
                                                ));
                                            })()}
                                        </select>
                                    </div>
                                </>
                            )}

                            {/* ── TRANSFER ── */}
                            {bulkEditTab === 'transfer' && (
                                <>
                                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                        <div style={{ flex: 1, minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Hedef Yarışma</label>
                                            <select className="control-select" style={{ width: '100%', padding: '10px 12px' }}
                                                value={transferTargetCompId} onChange={e => setTransferTargetCompId(e.target.value)}>
                                                <option value="">-- Hedef yarışma seçin --</option>
                                                {transferableComps.map(([id, c]) => (
                                                    <option key={id} value={id}>{c.isim} ({c.il})</option>
                                                ))}
                                            </select>
                                            {transferableComps.length === 0 && (
                                                <p style={{ fontSize: '0.8rem', color: '#EA580C', margin: '4px 0 0' }}>
                                                    Aynı ildeki başka yarışma bulunamadı.
                                                </p>
                                            )}
                                        </div>
                                        <div style={{ flex: 1, minWidth: '150px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Kategori Filtresi</label>
                                            <select className="control-select" style={{ width: '100%', padding: '10px 12px' }}
                                                value={transferCategory} onChange={e => { setTransferCategory(e.target.value); setTransferSelectedIds(new Set()); setTransferSelectAll(false); }}>
                                                <option value="">Tüm Kategoriler</option>
                                                {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                        </div>
                                    </div>

                                    {/* Sporcu listesi */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 }}>
                                            <input type="checkbox" checked={transferSelectAll}
                                                onChange={e => {
                                                    setTransferSelectAll(e.target.checked);
                                                    if (e.target.checked) {
                                                        setTransferSelectedIds(new Set(transferFilteredAthletes.map(a => a.id)));
                                                    } else {
                                                        setTransferSelectedIds(new Set());
                                                    }
                                                }}
                                            />
                                            Tümünü Seç
                                        </label>
                                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                            {transferSelectedIds.size} / {transferFilteredAthletes.length} seçili
                                        </span>
                                    </div>

                                    <div style={{
                                        maxHeight: '250px', overflowY: 'auto', border: '1px solid var(--border)',
                                        borderRadius: '10px', background: 'var(--bg-secondary)'
                                    }}>
                                        {transferFilteredAthletes.length === 0 ? (
                                            <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-tertiary)' }}>Sporcu bulunamadı.</p>
                                        ) : (
                                            transferFilteredAthletes.map(ath => (
                                                <label key={ath.id} style={{
                                                    display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px',
                                                    borderBottom: '1px solid var(--border)', cursor: 'pointer',
                                                    background: transferSelectedIds.has(ath.id) ? 'rgba(37,99,235,0.06)' : 'transparent'
                                                }}>
                                                    <input type="checkbox" checked={transferSelectedIds.has(ath.id)}
                                                        onChange={e => {
                                                            const newSet = new Set(transferSelectedIds);
                                                            if (e.target.checked) newSet.add(ath.id); else newSet.delete(ath.id);
                                                            setTransferSelectedIds(newSet);
                                                            setTransferSelectAll(newSet.size === transferFilteredAthletes.length);
                                                        }}
                                                    />
                                                    <div style={{ flex: 1 }}>
                                                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{ath.ad} {ath.soyad}</div>
                                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                                            {ath.categoryId} • {ath.okul || '-'} • {(ath.yarismaTuru || 'ferdi').toUpperCase()}
                                                        </div>
                                                    </div>
                                                </label>
                                            ))
                                        )}
                                    </div>
                                </>
                            )}

                            {/* Etkilenecek sporcu önizleme — okul sekmesi: per-athlete kategori dropdown */}
                            {bulkEditTab === 'okul' && bulkOldValue && (() => {
                                const matchedAthletes = athletes.filter(a => {
                                    const field = a.okul || a.kulup || '';
                                    return field.toLowerCase() === bulkOldValue.toLowerCase();
                                });
                                const comp = competitions[selectedCompId];
                                const allCats = new Set();
                                if (comp?.kategoriler) Object.keys(comp.kategoriler).forEach(k => allCats.add(k));
                                if (comp?.sporcular) Object.keys(comp.sporcular).forEach(k => allCats.add(k));
                                const catList = [...allCats].filter(c => c && c !== 'undefined').sort();
                                return (
                                    <div style={{
                                        background: 'var(--bg-secondary)', borderRadius: '10px', padding: '12px',
                                        border: '1px solid var(--border)', maxHeight: '320px', overflowY: 'auto'
                                    }}>
                                        <p style={{ margin: '0 0 8px 0', fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                            Etkilenecek sporcular ({matchedAthletes.length}) — Kategori değişikliği gerekiyorsa seçin:
                                        </p>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            {matchedAthletes.map(a => {
                                                const override = bulkAthleteOverrides[a.id]?.categoryId || '';
                                                const changed = override && override !== a.categoryId;
                                                return (
                                                    <div key={a.id} style={{
                                                        display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px',
                                                        borderRadius: '8px', background: changed ? 'rgba(124, 58, 237, 0.08)' : 'var(--bg-primary)',
                                                        border: `1px solid ${changed ? 'rgba(124, 58, 237, 0.3)' : 'var(--border)'}`
                                                    }}>
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <div style={{ fontWeight: 600, fontSize: '0.82rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                {a.ad} {a.soyad}
                                                            </div>
                                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                                                                Mevcut: {a.categoryId} • {(a.yarismaTuru || 'ferdi').toUpperCase()}
                                                            </div>
                                                        </div>
                                                        <select
                                                            style={{
                                                                padding: '4px 8px', borderRadius: '6px', fontSize: '0.78rem',
                                                                border: `1px solid ${changed ? 'rgba(124, 58, 237, 0.5)' : 'var(--border)'}`,
                                                                background: changed ? 'rgba(124, 58, 237, 0.12)' : 'var(--bg-secondary)',
                                                                color: 'var(--text-primary)', minWidth: '140px'
                                                            }}
                                                            value={override || a.categoryId}
                                                            onChange={e => {
                                                                const val = e.target.value;
                                                                setBulkAthleteOverrides(prev => {
                                                                    const next = { ...prev };
                                                                    if (val === a.categoryId) {
                                                                        delete next[a.id];
                                                                    } else {
                                                                        next[a.id] = { categoryId: val };
                                                                    }
                                                                    return next;
                                                                });
                                                            }}
                                                        >
                                                            {catList.map(c => (
                                                                <option key={c} value={c}>{c}{c === a.categoryId ? ' (mevcut)' : ''}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {Object.keys(bulkAthleteOverrides).length > 0 && (
                                            <p style={{ margin: '8px 0 0 0', fontSize: '0.78rem', color: '#7C3AED', fontWeight: 600 }}>
                                                <i className="material-icons-round" style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: '4px' }}>info</i>
                                                {Object.keys(bulkAthleteOverrides).length} sporcunun kategorisi değiştirilecek
                                            </p>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* Etkilenecek sporcu önizleme — tür/kategori sekmeleri (basit badge) */}
                            {(bulkEditTab === 'tur' || bulkEditTab === 'kategori') && bulkOldValue && (() => {
                                const matchedAthletes = athletes.filter(a => {
                                    if (bulkEditTab === 'kategori') return a.categoryId === bulkOldValue;
                                    const field = a.yarismaTuru || 'ferdi';
                                    return field.toLowerCase() === bulkOldValue.toLowerCase();
                                });
                                return (
                                    <div style={{
                                        background: 'var(--bg-secondary)', borderRadius: '10px', padding: '12px',
                                        border: '1px solid var(--border)', maxHeight: '200px', overflowY: 'auto'
                                    }}>
                                        <p style={{ margin: '0 0 8px 0', fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                            Etkilenecek sporcular ({matchedAthletes.length}):
                                        </p>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                            {matchedAthletes.slice(0, 20).map(a => (
                                                <span key={a.id} style={{
                                                    fontSize: '0.78rem', padding: '3px 8px', borderRadius: '6px',
                                                    background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)'
                                                }}>{a.ad} {a.soyad}</span>
                                            ))}
                                            {matchedAthletes.length > 20 && (
                                                <span style={{ fontSize: '0.78rem', padding: '3px 8px', color: 'var(--text-tertiary)' }}>
                                                    +{matchedAthletes.length - 20} sporcu daha...
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* ── BENZER OKUL BİRLEŞTİR ── */}
                            {bulkEditTab === 'birleştir' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                                        Yazım farkı olan aynı okul isimlerini tespit eder. Her grup için hangi ismin esas alınacağını siz seçersiniz.
                                    </p>
                                    <button
                                        className="action-btn-outline"
                                        style={{ borderColor: '#6366F1', color: '#6366F1', justifyContent: 'center' }}
                                        onClick={handleFindSimilarSchools}
                                        disabled={isFindingSchools || athletes.length === 0}
                                    >
                                        <i className="material-icons-round">manage_search</i>
                                        {isFindingSchools ? 'Taranıyor...' : 'Benzer Okulları Tara'}
                                    </button>

                                    {similarGroups.length === 0 && !isFindingSchools && athletes.length > 0 && (
                                        <p style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                                            Tarama yapılmadı veya benzer okul bulunamadı.
                                        </p>
                                    )}

                                    {similarGroups.map((group, gi) => (
                                        <div key={group.id} style={{
                                            border: `1.5px solid ${group.dismissed ? 'var(--border)' : '#F59E0B'}`,
                                            borderRadius: '10px', padding: '12px', opacity: group.dismissed ? 0.45 : 1,
                                            background: group.dismissed ? 'var(--bg-secondary)' : 'rgba(245,158,11,0.05)'
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', flex: 1 }}>
                                                    {group.names.map(n => (
                                                        <span key={n.name} style={{
                                                            fontSize: '0.8rem', padding: '3px 10px', borderRadius: '6px',
                                                            background: n.name === group.canonical ? '#D1FAE5' : 'var(--bg-primary)',
                                                            border: `1px solid ${n.name === group.canonical ? '#34D399' : 'var(--border)'}`,
                                                            color: n.name === group.canonical ? '#065F46' : 'var(--text-primary)',
                                                            fontWeight: n.name === group.canonical ? 700 : 400
                                                        }}>
                                                            {n.name} <span style={{ opacity: 0.6 }}>({n.count})</span>
                                                        </span>
                                                    ))}
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', alignSelf: 'center' }}>
                                                        {group.type === 'normalize' ? '• yazım farkı' : '• benzer isim'}
                                                    </span>
                                                </div>
                                                <button
                                                    title={group.dismissed ? 'Geri Al' : 'Farklı Okul — Atla'}
                                                    onClick={() => setSimilarGroups(prev => prev.map((g, i) => i === gi ? { ...g, dismissed: !g.dismissed } : g))}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: '2px', flexShrink: 0 }}
                                                >
                                                    <i className="material-icons-round" style={{ fontSize: '20px' }}>
                                                        {group.dismissed ? 'undo' : 'close'}
                                                    </i>
                                                </button>
                                            </div>
                                            {!group.dismissed && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', flexShrink: 0 }}>Esas isim:</span>
                                                    <select
                                                        className="control-select"
                                                        style={{ flex: 1, padding: '6px 10px', fontSize: '0.85rem' }}
                                                        value={group.canonical}
                                                        onChange={e => setSimilarGroups(prev => prev.map((g, i) => i === gi ? { ...g, canonical: e.target.value } : g))}
                                                    >
                                                        {group.names.map(n => (
                                                            <option key={n.name} value={n.name}>{n.name}</option>
                                                        ))}
                                                        <option value="__custom__">— Özel isim yaz —</option>
                                                    </select>
                                                </div>
                                            )}
                                            {!group.dismissed && group.canonical === '__custom__' && (
                                                <input
                                                    type="text"
                                                    className="control-input"
                                                    style={{ marginTop: '6px', width: '100%', padding: '6px 10px', fontSize: '0.85rem', boxSizing: 'border-box' }}
                                                    placeholder="Standart okul adını yazın..."
                                                    onBlur={e => { if (e.target.value.trim()) setSimilarGroups(prev => prev.map((g, i) => i === gi ? { ...g, canonical: e.target.value.trim() } : g)); }}
                                                />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Aksiyon butonu */}
                            {bulkEditTab === 'kategori' ? (
                                <button className="create-btn"
                                    style={{ width: '100%', justifyContent: 'center', padding: '12px', fontSize: '1rem', background: '#7C3AED' }}
                                    onClick={handleBulkCategoryChange}
                                    disabled={bulkSaving || !bulkOldValue || !bulkNewValue}>
                                    {bulkSaving
                                        ? <><span className="spinner-small" style={{ marginRight: '8px' }}></span>Taşınıyor...</>
                                        : <><i className="material-icons-round" style={{ marginRight: '8px' }}>drive_file_move</i>Kategori Değiştir</>
                                    }
                                </button>
                            ) : bulkEditTab === 'birleştir' ? (
                                <button className="create-btn"
                                    style={{ width: '100%', justifyContent: 'center', padding: '12px', fontSize: '1rem', background: '#F59E0B' }}
                                    onClick={handleMergeSchools}
                                    disabled={bulkSaving || similarGroups.filter(g => !g.dismissed).length === 0}>
                                    {bulkSaving
                                        ? <><span className="spinner-small" style={{ marginRight: '8px' }}></span>Birleştiriliyor...</>
                                        : <><i className="material-icons-round" style={{ marginRight: '8px' }}>merge</i>
                                            {similarGroups.filter(g => !g.dismissed).length} Grubu Birleştir</>
                                    }
                                </button>
                            ) : bulkEditTab !== 'transfer' ? (
                                <button className="create-btn"
                                    style={{ width: '100%', justifyContent: 'center', padding: '12px', fontSize: '1rem' }}
                                    onClick={handleBulkEdit}
                                    disabled={bulkSaving || !bulkOldValue || !bulkNewValue}>
                                    {bulkSaving
                                        ? <><span className="spinner-small" style={{ marginRight: '8px' }}></span>Güncelleniyor...</>
                                        : <><i className="material-icons-round" style={{ marginRight: '8px' }}>check_circle</i>Toplu Güncelle</>
                                    }
                                </button>
                            ) : (
                                <button className="create-btn"
                                    style={{ width: '100%', justifyContent: 'center', padding: '12px', fontSize: '1rem', background: '#D97706' }}
                                    onClick={handleTransfer}
                                    disabled={bulkSaving || !transferTargetCompId || transferSelectedIds.size === 0}>
                                    {bulkSaving
                                        ? <><span className="spinner-small" style={{ marginRight: '8px' }}></span>Transfer Ediliyor...</>
                                        : <><i className="material-icons-round" style={{ marginRight: '8px' }}>swap_horiz</i>{transferSelectedIds.size} Sporcuyu Transfer Et</>
                                    }
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
