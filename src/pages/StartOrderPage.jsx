import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useAuth } from '../lib/AuthContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import './StartOrderPage.css';

export default function StartOrderPage() {
    const navigate = useNavigate();
    const { currentUser, hasPermission, isSuperAdmin } = useAuth();
    const [competitions, setCompetitions] = useState({});
    const [selectedCompId, setSelectedCompId] = useState('');
    const [filterCategory, setFilterCategory] = useState('');

    const MAX_PER_ROTATION = 8;

    // State
    const [rotations, setRotations] = useState([]); // Dynamic rotation count
    const [unassigned, setUnassigned] = useState([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [pdfGenerating, setPdfGenerating] = useState(false);
    const [bulkAssigning, setBulkAssigning] = useState(false);

    // Toast System
    const [toasts, setToasts] = useState([]);
    const toastIdRef = useRef(0);

    const showToast = useCallback((message, type = 'info', duration = 3500) => {
        const id = ++toastIdRef.current;
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    // Confirm Modal
    const [confirmModal, setConfirmModal] = useState(null);

    const showConfirm = useCallback((message) => {
        return new Promise((resolve) => {
            setConfirmModal({
                message,
                onConfirm: () => { setConfirmModal(null); resolve(true); },
                onCancel: () => { setConfirmModal(null); resolve(false); }
            });
        });
    }, []);

    // Initial load
    useEffect(() => {
        const compsRef = ref(db, 'competitions');
        const unsubscribe = onValue(compsRef, (snap) => {
            const data = snap.val() || {};
            setCompetitions(filterCompetitionsByUser(data, currentUser));
        });
        return () => unsubscribe();
    }, [currentUser]);

    // Load data when selections change
    useEffect(() => {
        if (!selectedCompId || !filterCategory) {
            setUnassigned([]);
            setRotations([]);
            return;
        }

        setLoading(true);

        const loadData = async () => {
            try {
                // Her iki veriyi de aynı anda oku
                const [athletesSnap, orderSnap] = await Promise.all([
                    get(ref(db, `competitions/${selectedCompId}/sporcular/${filterCategory}`)),
                    get(ref(db, `competitions/${selectedCompId}/siralama/${filterCategory}`))
                ]);

                const data = athletesSnap.val();
                const loadedAthletes = [];
                if (data) {
                    Object.keys(data).forEach(athId => {
                        loadedAthletes.push({
                            ...data[athId],
                            id: athId,
                            categoryId: filterCategory
                        });
                    });
                }

                const orderData = orderSnap.val();
                let maxRotIndex = -1;
                const rotationsMap = {};
                let currentUnassigned = [...loadedAthletes];

                if (orderData) {
                    Object.keys(orderData).forEach(rotKey => {
                        const rotIndex = parseInt(rotKey.replace('rotation_', ''));
                        if (!isNaN(rotIndex)) {
                            if (rotIndex > maxRotIndex) maxRotIndex = rotIndex;
                            const athletesInRot = orderData[rotKey];
                            const sortedAthletes = Object.keys(athletesInRot).map(id => {
                                const athDetails = loadedAthletes.find(a => a.id === id);
                                return athDetails ? { ...athDetails, sirasi: athletesInRot[id].sirasi } : null;
                            }).filter(a => a !== null).sort((a, b) => a.sirasi - b.sirasi);

                            rotationsMap[rotIndex] = sortedAthletes;
                            sortedAthletes.forEach(a => {
                                currentUnassigned = currentUnassigned.filter(ua => ua.id !== a.id);
                            });
                        }
                    });
                }

                const currentRotations = [];
                for (let i = 0; i <= maxRotIndex; i++) {
                    currentRotations.push(rotationsMap[i] || []);
                }

                currentUnassigned.sort((a, b) => `${a.ad} ${a.soyad}`.localeCompare(`${b.ad} ${b.soyad}`));
                setRotations(currentRotations);
                setUnassigned(currentUnassigned);
            } catch (err) {
                if (import.meta.env.DEV) console.error('Load error:', err);
            } finally {
                setLoading(false);
            }
        };

        loadData();
    }, [selectedCompId, filterCategory]);

    // -- Random Assignment Logic --
    // Kural: Takım grupları ayrı, ferdi grupları ayrı. Dengeli dağılım. Max 8/grup.
    const handleRandomAssign = async () => {
        if (!selectedCompId || !filterCategory) return;
        if (rotations.some(r => r.length > 0)) {
            const confirmed = await showConfirm("Mevcut atanmış grupların üzerine yazılacak. Emin misiniz?");
            if (!confirmed) return;
        }

        // Combine all athletes
        const allAthletes = [...unassigned, ...rotations.flat()];

        // 1. Separate Teams from Individuals based on yarismaTuru
        const teamsMap = {}; // { 'Okul Adi': [Athletes] }
        const individuals = [];

        allAthletes.forEach(ath => {
            const type = (ath.yarismaTuru || 'ferdi').toLowerCase();
            if (type === 'takim' || type === 'takım') {
                const school = ath.okul || 'Bilinmeyen Takım';
                if (!teamsMap[school]) teamsMap[school] = [];
                teamsMap[school].push(ath);
            } else {
                individuals.push(ath);
            }
        });

        // Convert teamsMap to array and shuffle
        const teamsList = Object.values(teamsMap);
        shuffleArray(teamsList);
        shuffleArray(individuals);

        // ===== PHASE 1: Takım grupları (sadece takım sporcuları) =====
        const teamGroups = [];

        const findBestTeamGroup = (requiredSlots) => {
            let bestIndex = -1;
            let bestCount = Infinity;
            for (let i = 0; i < teamGroups.length; i++) {
                if (teamGroups[i].length + requiredSlots <= MAX_PER_ROTATION && teamGroups[i].length < bestCount) {
                    bestCount = teamGroups[i].length;
                    bestIndex = i;
                }
            }
            if (bestIndex === -1) {
                teamGroups.push([]);
                bestIndex = teamGroups.length - 1;
            }
            return bestIndex;
        };

        teamsList.forEach(teamMembers => {
            const targetIndex = findBestTeamGroup(teamMembers.length);
            teamGroups[targetIndex].push(...teamMembers);
        });

        // ===== PHASE 2: Ferdi grupları (sadece bireysel sporcular, dengeli) =====
        const individualGroups = [];

        if (individuals.length > 0) {
            // Kaç grup lazım? Dengeli dağıtım için: ceil(total / MAX)
            const numIndGroups = Math.ceil(individuals.length / MAX_PER_ROTATION);
            for (let i = 0; i < numIndGroups; i++) individualGroups.push([]);

            // Round-robin ile dengeli dağıt
            individuals.forEach((ath, idx) => {
                individualGroups[idx % numIndGroups].push(ath);
            });
        }

        // ===== Birleştir: önce takım grupları, sonra ferdi grupları =====
        const newRotations = [...teamGroups, ...individualGroups];

        // Ensure at least 1 group exists
        if (newRotations.length === 0) newRotations.push([]);

        setUnassigned([]);
        setRotations(newRotations);

        // Otomatik kaydet
        const ok = await saveToFirebase(newRotations, [], true);
        if (ok) showToast('Rastgele atama yapıldı ve kaydedildi.', 'success');
    };

    // Fisher-Yates shuffle
    const shuffleArray = (array) => {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    };

    // -- Drag and Drop Logic --
    const [draggedItem, setDraggedItem] = useState(null);

    const handleDragStart = (e, athlete, sourceMap) => {
        setDraggedItem({ athlete, sourceMap });
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e, targetMap, targetIndex = null) => {
        e.preventDefault();
        if (!draggedItem) return;

        const { athlete, sourceMap } = draggedItem;

        if (sourceMap === targetMap && targetIndex !== null) {
            const list = Array.isArray(targetMap) ? targetMap : (targetMap === 'unassigned' ? unassigned : rotations[targetMap]);
            const currentIndex = list.findIndex(a => a.id === athlete.id);
            if (currentIndex === targetIndex) return;
        }

        // Max 8 check: if target is a rotation and already full (and not same source)
        if (targetMap !== 'unassigned' && typeof targetMap === 'number') {
            const isMovingWithinSameGroup = sourceMap === targetMap;
            if (!isMovingWithinSameGroup && rotations[targetMap]?.length >= MAX_PER_ROTATION) {
                showToast(`Bu grupta zaten ${MAX_PER_ROTATION} sporcu var. Daha fazla eklenemez.`, 'warning');
                setDraggedItem(null);
                return;
            }
        }

        let newUnassigned = [...unassigned];
        let newRotations = [...rotations.map(r => [...r])];

        if (sourceMap === 'unassigned') {
            newUnassigned = newUnassigned.filter(a => a.id !== athlete.id);
        } else {
            newRotations[sourceMap] = newRotations[sourceMap].filter(a => a.id !== athlete.id);
        }

        if (targetMap === 'unassigned') {
            newUnassigned.push(athlete);
            newUnassigned.sort((a, b) => `${a.ad} ${a.soyad}`.localeCompare(`${b.ad} ${b.soyad}`));
        } else {
            if (targetIndex !== null) {
                newRotations[targetMap].splice(targetIndex, 0, athlete);
            } else {
                newRotations[targetMap].push(athlete);
            }
        }

        setUnassigned(newUnassigned);
        setRotations(newRotations);
        setDraggedItem(null);
    };

    // Yeni boş grup ekle
    const addRotation = () => {
        setRotations(prev => [...prev, []]);
    };

    // Boş grubu sil
    const removeRotation = async (index) => {
        if (rotations[index].length > 0) {
            const confirmed = await showConfirm(`Grup ${index + 1} içinde ${rotations[index].length} sporcu var. Sporcular boştakiler listesine taşınacak. Devam?`);
            if (!confirmed) return;
            setUnassigned(prev => {
                const merged = [...prev, ...rotations[index]];
                merged.sort((a, b) => `${a.ad} ${a.soyad}`.localeCompare(`${b.ad} ${b.soyad}`));
                return merged;
            });
        }
        setRotations(prev => prev.filter((_, i) => i !== index));
    };

    // -- Save & Export --
    // Kaydetme mantığı: rotasyonları ve boştakileri parametre olarak alır (veya state'den okur)
    const saveToFirebase = async (rotationsToSave, unassignedToSave, silent = false) => {
        if (!selectedCompId || !filterCategory) {
            if (!silent) showToast("Kategori seçilmelidir.", 'error');
            return false;
        }
        setSaving(true);

        const siralamaData = {};
        const updates = {};
        let globalOrder = 0;

        rotationsToSave.forEach((rotation, rotIndex) => {
            if (rotation.length > 0) {
                const rotationObj = {};
                rotation.forEach((ath, athIndex) => {
                    globalOrder++;
                    const grupIciSirasi = athIndex + 1;

                    rotationObj[ath.id] = {
                        sirasi: grupIciSirasi,
                        ad: ath.ad,
                        soyad: ath.soyad,
                        tckn: ath.tckn || '',
                        okul: ath.okul || '',
                        yarismaTuru: ath.yarismaTuru || 'ferdi'
                    };

                    const athPath = `competitions/${selectedCompId}/sporcular/${filterCategory}/${ath.id}`;
                    updates[`${athPath}/sirasi`] = grupIciSirasi;
                    updates[`${athPath}/cikisSirasi`] = globalOrder;
                    updates[`${athPath}/rotasyonGrubu`] = rotIndex;
                });
                siralamaData[`rotation_${rotIndex}`] = rotationObj;
            }
        });

        unassignedToSave.forEach((ath) => {
            const athPath = `competitions/${selectedCompId}/sporcular/${filterCategory}/${ath.id}`;
            updates[`${athPath}/sirasi`] = 999;
            updates[`${athPath}/cikisSirasi`] = null;
            updates[`${athPath}/rotasyonGrubu`] = null;
        });

        updates[`competitions/${selectedCompId}/siralama/${filterCategory}`] = Object.keys(siralamaData).length > 0 ? siralamaData : null;

        try {
            await update(ref(db), updates);
            if (!silent) showToast("Çıkış sırası başarıyla kaydedildi.", 'success');
            return true;
        } catch (err) {
            console.error(err);
            showToast("Kaydetme işlemi başarısız.", 'error');
            return false;
        } finally {
            setSaving(false);
        }
    };

    const handleSave = () => saveToFirebase(rotations, unassigned);

    // ===== SUPER ADMIN: Tüm yarışmalarda tüm kategorilerde toplu atama =====
    const handleBulkAssignAll = async () => {
        const confirmed = await showConfirm(
            "Tüm yarışmalardaki tüm kategorilerde atanmamış sporcular rastgele gruplara atanacak. Mevcut atamalar korunacak. Devam etmek istiyor musunuz?"
        );
        if (!confirmed) return;

        setBulkAssigning(true);
        let totalAssigned = 0;
        let totalCategories = 0;

        try {
            const compEntries = Object.entries(competitions);

            for (const [compId, comp] of compEntries) {
                const categories = Object.keys(comp.sporcular || {});

                for (const category of categories) {
                    // Her kategori için verileri çek
                    const [athletesSnap, orderSnap] = await Promise.all([
                        get(ref(db, `competitions/${compId}/sporcular/${category}`)),
                        get(ref(db, `competitions/${compId}/siralama/${category}`))
                    ]);

                    const data = athletesSnap.val();
                    if (!data) continue;

                    const allAthletes = [];
                    Object.keys(data).forEach(athId => {
                        allAthletes.push({ ...data[athId], id: athId, categoryId: category });
                    });

                    // Mevcut sıralamayı oku
                    const orderData = orderSnap.val();
                    const assignedIds = new Set();

                    const existingRotations = [];
                    if (orderData) {
                        let maxIdx = -1;
                        Object.keys(orderData).forEach(rotKey => {
                            const rotIndex = parseInt(rotKey.replace('rotation_', ''));
                            if (!isNaN(rotIndex) && rotIndex > maxIdx) maxIdx = rotIndex;
                        });
                        for (let i = 0; i <= maxIdx; i++) existingRotations.push([]);

                        Object.keys(orderData).forEach(rotKey => {
                            const rotIndex = parseInt(rotKey.replace('rotation_', ''));
                            if (!isNaN(rotIndex)) {
                                const athletesInRot = orderData[rotKey];
                                const sorted = Object.keys(athletesInRot).map(id => {
                                    const ath = allAthletes.find(a => a.id === id);
                                    if (ath) assignedIds.add(id);
                                    return ath ? { ...ath, sirasi: athletesInRot[id].sirasi } : null;
                                }).filter(Boolean).sort((a, b) => a.sirasi - b.sirasi);
                                existingRotations[rotIndex] = sorted;
                            }
                        });
                    }

                    // Atanmamış sporcuları bul
                    const unassignedAthletes = allAthletes.filter(a => !assignedIds.has(a.id));
                    if (unassignedAthletes.length === 0) continue; // Zaten hepsi atanmış

                    // Takım / ferdi ayrımı
                    const teamsMap = {};
                    const individuals = [];
                    unassignedAthletes.forEach(ath => {
                        const type = (ath.yarismaTuru || 'ferdi').toLowerCase();
                        if (type === 'takim' || type === 'takım') {
                            const school = ath.okul || 'Bilinmeyen Takım';
                            if (!teamsMap[school]) teamsMap[school] = [];
                            teamsMap[school].push(ath);
                        } else {
                            individuals.push(ath);
                        }
                    });

                    const teamsList = Object.values(teamsMap);
                    shuffleArray(teamsList);
                    shuffleArray(individuals);

                    // Takım grupları
                    const teamGroups = [];
                    const findBestTG = (slots) => {
                        let best = -1, bestC = Infinity;
                        for (let i = 0; i < teamGroups.length; i++) {
                            if (teamGroups[i].length + slots <= MAX_PER_ROTATION && teamGroups[i].length < bestC) {
                                bestC = teamGroups[i].length; best = i;
                            }
                        }
                        if (best === -1) { teamGroups.push([]); best = teamGroups.length - 1; }
                        return best;
                    };
                    teamsList.forEach(members => {
                        teamGroups[findBestTG(members.length)].push(...members);
                    });

                    // Ferdi grupları (dengeli)
                    const indGroups = [];
                    if (individuals.length > 0) {
                        const numG = Math.ceil(individuals.length / MAX_PER_ROTATION);
                        for (let i = 0; i < numG; i++) indGroups.push([]);
                        individuals.forEach((ath, idx) => { indGroups[idx % numG].push(ath); });
                    }

                    // Birleştir: mevcut + yeni
                    const finalRotations = [...existingRotations, ...teamGroups, ...indGroups];

                    // Firebase'e kaydet
                    const siralamaData = {};
                    const updates = {};
                    let globalOrder = 0;

                    finalRotations.forEach((rotation, rotIndex) => {
                        const validAthletes = rotation.filter(a => a && a.id && a.ad);
                        if (validAthletes.length > 0) {
                            const rotObj = {};
                            validAthletes.forEach((ath, athIndex) => {
                                globalOrder++;
                                const grupIci = athIndex + 1;
                                rotObj[ath.id] = {
                                    sirasi: grupIci, ad: ath.ad, soyad: ath.soyad || '',
                                    tckn: ath.tckn || '', okul: ath.okul || '',
                                    yarismaTuru: ath.yarismaTuru || 'ferdi'
                                };
                                const p = `competitions/${compId}/sporcular/${category}/${ath.id}`;
                                updates[`${p}/sirasi`] = grupIci;
                                updates[`${p}/cikisSirasi`] = globalOrder;
                                updates[`${p}/rotasyonGrubu`] = rotIndex;
                            });
                            siralamaData[`rotation_${rotIndex}`] = rotObj;
                        }
                    });

                    updates[`competitions/${compId}/siralama/${category}`] = Object.keys(siralamaData).length > 0 ? siralamaData : null;
                    await update(ref(db), updates);

                    totalAssigned += unassignedAthletes.length;
                    totalCategories++;
                }
            }

            if (totalCategories === 0) {
                showToast('Atanmamış sporcu bulunamadı. Tüm sporcular zaten gruplara atanmış.', 'info');
            } else {
                showToast(`${totalCategories} kategoride toplam ${totalAssigned} sporcu başarıyla atandı.`, 'success', 5000);
            }

            // Eğer şu an bir kategori seçiliyse, güncel veriyi tekrar yükle
            if (selectedCompId && filterCategory) {
                const savedCat = filterCategory;
                setFilterCategory('');
                setTimeout(() => setFilterCategory(savedCat), 150);
            }
        } catch (err) {
            console.error('Toplu atama hatası:', err);
            showToast('Toplu atama sırasında hata oluştu: ' + err.message, 'error', 5000);
        } finally {
            setBulkAssigning(false);
        }
    };

    const handleExportPDF = async () => {
        if (!selectedCompId) { showToast("Dışa aktarmak için yarışma seçiniz.", 'warning'); return; }
        if (pdfGenerating) return;

        setPdfGenerating(true);

        try {
            const compName = competitions[selectedCompId]?.isim || 'Yarışma';
            const allCategories = Object.keys(
                competitions[selectedCompId]?.sporcular || {}
            ).sort();

            if (allCategories.length === 0) {
                showToast("Bu yarışma için kategori bulunamadı.", 'warning');
                return;
            }

            const doc = new jsPDF();
            let activeFontName = 'helvetica';

            // --- Türkçe karakter desteği için Unicode font yükle ---
            try {
                const fontResponse = await fetch(
                    'https://fonts.gstatic.com/s/roboto/v32/KFOmCnqEu92Fr1Me5Q.ttf'
                );
                if (fontResponse.ok) {
                    const fontBuffer = await fontResponse.arrayBuffer();
                    const uint8Array = new Uint8Array(fontBuffer);
                    let binaryString = '';
                    const CHUNK = 8192;
                    for (let i = 0; i < uint8Array.length; i += CHUNK) {
                        binaryString += String.fromCharCode(
                            ...uint8Array.subarray(i, i + CHUNK)
                        );
                    }
                    const base64Font = btoa(binaryString);
                    doc.addFileToVFS('Roboto-Regular.ttf', base64Font);
                    doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
                    activeFontName = 'Roboto';
                }
            } catch {
                console.warn('Roboto font yüklenemedi, varsayılan font kullanılıyor.');
            }

            doc.setFont(activeFontName);

            // --- İlk sayfa başlığı ---
            doc.setFontSize(18);
            doc.text('Cikis Sirasi Listesi', 14, 18);
            doc.setFontSize(12);
            doc.text(`Yarisma: ${compName}`, 14, 27);
            doc.setFontSize(9);
            doc.setTextColor(130);
            const now = new Date();
            doc.text(
                `Olusturulma: ${now.toLocaleDateString('tr-TR')} ${now.toLocaleTimeString('tr-TR')}`,
                14, 34
            );
            doc.setTextColor(0);

            let pageCount = 0;

            // --- Her kategori için Firebase'den veri çek ve PDF'e ekle ---
            for (const category of allCategories) {
                // Sporcuları çek
                const athletesSnap = await get(
                    ref(db, `competitions/${selectedCompId}/sporcular/${category}`)
                );
                const athletesData = athletesSnap.val() || {};
                const athletes = Object.entries(athletesData).map(([id, data]) => ({
                    ...data,
                    id,
                }));

                // Sıralama verisini çek
                const siraSnap = await get(
                    ref(db, `competitions/${selectedCompId}/siralama/${category}`)
                );
                const siraData = siraSnap.val();

                // Rotasyonları oluştur
                const catRotations = [];
                if (siraData) {
                    let maxIdx = -1;
                    Object.keys(siraData).forEach((rotKey) => {
                        const rotIndex = parseInt(rotKey.replace('rotation_', ''));
                        if (!isNaN(rotIndex) && rotIndex > maxIdx) maxIdx = rotIndex;
                    });
                    for (let i = 0; i <= maxIdx; i++) catRotations.push([]);

                    Object.keys(siraData).forEach((rotKey) => {
                        const rotIndex = parseInt(rotKey.replace('rotation_', ''));
                        if (!isNaN(rotIndex)) {
                            const athletesInRot = siraData[rotKey];
                            const sorted = Object.keys(athletesInRot)
                                .map((id) => {
                                    const ath = athletes.find((a) => a.id === id);
                                    return ath
                                        ? { ...ath, sirasi: athletesInRot[id].sirasi }
                                        : null;
                                })
                                .filter(Boolean)
                                .sort((a, b) => a.sirasi - b.sirasi);
                            catRotations[rotIndex] = sorted;
                        }
                    });
                }

                // Sıralaması olmayan kategorileri atla
                if (!catRotations.some((r) => r.length > 0)) continue;

                // Yeni sayfa (ilk kategori hariç)
                if (pageCount > 0) doc.addPage();
                const startYBase = pageCount === 0 ? 44 : 15;
                pageCount++;

                let startY = startYBase;
                doc.setFont(activeFontName);
                doc.setFontSize(14);
                doc.setTextColor(79, 70, 229);
                doc.text(`Kategori: ${category}`, 14, startY);
                doc.setTextColor(0);
                startY += 10;

                catRotations.forEach((rotation, index) => {
                    if (rotation.length === 0) return;

                    doc.setFontSize(11);
                    doc.text(`Grup ${index + 1}`, 14, startY);

                    const tableData = rotation.map((ath, idx) => [
                        (idx + 1).toString(),
                        `${ath.ad} ${ath.soyad}`,
                        ath.okul || '-',
                        (ath.yarismaTuru || 'ferdi').toUpperCase(),
                    ]);

                    autoTable(doc, {
                        startY: startY + 5,
                        head: [['Sira', 'Sporcu Adi', 'Okul/Kulup', 'Turu']],
                        body: tableData,
                        theme: 'striped',
                        headStyles: { fillColor: [79, 70, 229] },
                        styles: { font: activeFontName, fontSize: 10 },
                        margin: { left: 14 },
                    });

                    startY = doc.lastAutoTable.finalY + 12;

                    if (startY > doc.internal.pageSize.getHeight() - 30) {
                        doc.addPage();
                        startY = 15;
                    }
                });
            }

            if (pageCount === 0) {
                showToast("Henüz hiçbir kategoride sıralama yapılmamış.", 'warning');
                return;
            }

            const safeCompName = compName.replace(/[\\/:*?"<>|]/g, '_');
            doc.save(`${safeCompName}_Tum_Kategoriler_Cikis_Sirasi.pdf`);
        } catch (err) {
            console.error('PDF oluşturma hatası:', err);
            showToast('PDF oluşturulurken bir hata oluştu: ' + err.message, 'error');
        } finally {
            setPdfGenerating(false);
        }
    };


    const compOptions = Object.entries(competitions).sort((a, b) => new Date(b[1].tarih) - new Date(a[1].tarih));
    let uniqueCategories = [];
    if (selectedCompId && competitions[selectedCompId]?.sporcular) {
        uniqueCategories = Object.keys(competitions[selectedCompId].sporcular);
    }

    return (
        <div className="order-page">
            <header className="page-header--bento">
                <div className="page-header__left">
                    <button className="back-btn back-btn--light" onClick={() => navigate('/')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div className="header-title-wrapper">
                        <h1 className="page-title text-white">Çıkış Sırası & Gruplama</h1>
                        <p className="page-subtitle text-white-50">Sporcuları takımlara öncelik vererek gruplara dağıtın veya manuel sürükleyin.</p>
                    </div>
                </div>
                <div className="page-header__right flex-gap">
                    {isSuperAdmin() && (
                        <button
                            className="btn-bulk-assign"
                            onClick={handleBulkAssignAll}
                            disabled={bulkAssigning || Object.keys(competitions).length === 0}
                            title="Tüm yarışmalarda tüm kategorilerde atanmamış sporcuları otomatik ata"
                        >
                            {bulkAssigning
                                ? <><div className="spinner-small"></div><span>Atanıyor...</span></>
                                : <><i className="material-icons-round">bolt</i><span>Tümünü Ata</span></>
                            }
                        </button>
                    )}
                    {hasPermission('start_order', 'pdf') && (
                        <button
                            className="btn-bento-secondary"
                            onClick={handleExportPDF}
                            title="Tüm kategorileri PDF olarak indir"
                            disabled={!selectedCompId || pdfGenerating}
                        >
                            {pdfGenerating
                                ? <><div className="spinner-small"></div><span>Hazırlanıyor...</span></>
                                : <><i className="material-icons-round">picture_as_pdf</i><span>PDF İndir</span></>
                            }
                        </button>
                    )}
                    {hasPermission('start_order', 'duzenle') && (
                        <button
                            className="btn-bento-primary shadow-lg"
                            onClick={handleSave}
                            disabled={saving || !selectedCompId || !filterCategory}
                        >
                            {saving ? <div className="spinner-small"></div> : <i className="material-icons-round">save</i>}
                            <span>Kaydet</span>
                        </button>
                    )}
                </div>
            </header>

            <main className="bento-content">
                <div className="bento-controls">
                    <div className="bento-control-group">
                        <i className="material-icons-round">emoji_events</i>
                        <select
                            className="bento-select"
                            value={selectedCompId}
                            onChange={(e) => { setSelectedCompId(e.target.value); setFilterCategory(''); }}
                        >
                            <option value="">-- Yarışma Seçiniz --</option>
                            {compOptions.map(([id, comp]) => <option key={id} value={id}>{comp.isim}</option>)}
                        </select>
                    </div>

                    <div className="bento-control-group">
                        <i className="material-icons-round">category</i>
                        <select
                            className="bento-select"
                            value={filterCategory}
                            onChange={(e) => setFilterCategory(e.target.value)}
                            disabled={!selectedCompId || uniqueCategories.length === 0}
                        >
                            <option value="">-- Kategori Seçiniz --</option>
                            {uniqueCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                    </div>

                    {hasPermission('start_order', 'duzenle') && (
                        <button
                            className="btn-random-assign"
                            onClick={handleRandomAssign}
                            disabled={!selectedCompId || !filterCategory}
                        >
                            <i className="material-icons-round">auto_awesome</i>
                            Rastgele Atama Yap
                        </button>
                    )}
                </div>

                {loading ? (
                    <div className="loading-state">
                        <div className="spinner"></div><p>Veriler yükleniyor...</p>
                    </div>
                ) : (!selectedCompId || !filterCategory) ? (
                    <div className="empty-state">
                        <div className="empty-state__icon"><i className="material-icons-round">groups</i></div>
                        <p>Başlamak için lütfen yarışma ve kategori seçin.</p>
                    </div>
                ) : (
                    <div className="order-workspace">
                        <div className="order-panel unassigned-pool">
                            <div className="panel-header">
                                <h2>
                                    <i className="material-icons-round">person_off</i>
                                    Boştaki Sporcular <span className="count-badge">{unassigned.length}</span>
                                </h2>
                            </div>
                            <div className="pool-container" onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, 'unassigned')}>
                                {unassigned.length === 0 ? <div className="pool-empty">Tüm sporcular atandı 🎉</div> : (
                                    <div className="athlete-list">
                                        {unassigned.map(ath => (
                                            <div key={ath.id} className="order-athlete-card" draggable onDragStart={(e) => handleDragStart(e, ath, 'unassigned')}>
                                                <i className="material-icons-round drag-handle">drag_indicator</i>
                                                <div className="ath-info">
                                                    <strong>{ath.ad} {ath.soyad}</strong>
                                                    <small>{ath.okul || 'Okul Yok'} <span className={`type-badge ${(ath.yarismaTuru || 'ferdi').toLowerCase()}`}>{ath.yarismaTuru || 'Ferdi'}</span></small>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="rotations-grid">
                            {rotations.map((rotation, index) => {
                                const isFull = rotation.length >= MAX_PER_ROTATION;
                                return (
                                    <div key={index} className={`rotation-card ${isFull ? 'rotation-card--full' : ''}`} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, index)}>
                                        <div className="rotation-header">
                                            <h3>Grup {index + 1}</h3>
                                            <div className="rotation-header__right">
                                                <span className={`count-badge ${isFull ? 'count-badge--full' : ''}`}>{rotation.length}/{MAX_PER_ROTATION}</span>
                                                {hasPermission('start_order', 'duzenle') && (
                                                    <button className="rotation-remove-btn" onClick={() => removeRotation(index)} title="Grubu sil">
                                                        <i className="material-icons-round">close</i>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="rotation-list">
                                            {rotation.length === 0 ? <div className="pool-empty">Boş Grup</div> : (
                                                rotation.map((ath, athIndex) => (
                                                    <div key={ath.id} className={`order-athlete-card assigned ${(ath.yarismaTuru || 'ferdi').toLowerCase() === 'takim' || (ath.yarismaTuru || 'ferdi').toLowerCase() === 'takım' ? 'assigned--team' : ''}`} draggable onDragStart={(e) => handleDragStart(e, ath, index)} onDragOver={handleDragOver} onDrop={(e) => { e.stopPropagation(); handleDrop(e, index, athIndex); }}>
                                                        <div className="order-number">{athIndex + 1}</div>
                                                        <div className="ath-info">
                                                            <strong>{ath.ad} {ath.soyad}</strong>
                                                            <small>{ath.okul ? ath.okul.substring(0, 20) : ''} <span className={`type-badge ${(ath.yarismaTuru || 'ferdi').toLowerCase()}`}>{ath.yarismaTuru || 'Ferdi'}</span></small>
                                                        </div>
                                                        <i className="material-icons-round drag-handle">drag_indicator</i>
                                                    </div>
                                                ))
                                            )}
                                            <div className="drop-zone-end" onDragOver={handleDragOver} onDrop={(e) => { e.stopPropagation(); handleDrop(e, index); }}></div>
                                        </div>
                                    </div>
                                );
                            })}
                            {/* Yeni Grup Ekle butonu */}
                            {hasPermission('start_order', 'duzenle') && (
                                <button className="add-rotation-btn" onClick={addRotation}>
                                    <i className="material-icons-round">add_circle_outline</i>
                                    <span>Yeni Grup Ekle</span>
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </main>

            {/* Toast Container */}
            {toasts.length > 0 && (
                <div className="toast-container">
                    {toasts.map(toast => (
                        <div key={toast.id} className={`toast toast--${toast.type}`} onClick={() => removeToast(toast.id)}>
                            <i className="material-icons-round toast__icon">
                                {toast.type === 'success' ? 'check_circle' : toast.type === 'error' ? 'error' : toast.type === 'warning' ? 'warning' : 'info'}
                            </i>
                            <span className="toast__message">{toast.message}</span>
                            <i className="material-icons-round toast__close">close</i>
                        </div>
                    ))}
                </div>
            )}

            {/* Confirm Modal */}
            {confirmModal && (
                <div className="confirm-overlay" onClick={confirmModal.onCancel}>
                    <div className="confirm-modal" onClick={e => e.stopPropagation()}>
                        <div className="confirm-modal__icon">
                            <i className="material-icons-round">help_outline</i>
                        </div>
                        <p className="confirm-modal__message">{confirmModal.message}</p>
                        <div className="confirm-modal__actions">
                            <button className="confirm-btn confirm-btn--cancel" onClick={confirmModal.onCancel}>
                                İptal
                            </button>
                            <button className="confirm-btn confirm-btn--ok" onClick={confirmModal.onConfirm}>
                                Evet, Devam Et
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
