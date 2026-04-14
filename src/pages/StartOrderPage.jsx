import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
// jsPDF ve autoTable — sadece PDF export sırasında dynamic import ile yüklenir (code splitting)
import { useAuth } from '../lib/AuthContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { useDiscipline } from '../lib/DisciplineContext';
import './StartOrderPage.css';

export default function StartOrderPage() {
    const navigate = useNavigate();
    const { currentUser, hasPermission, isSuperAdmin } = useAuth();
    const { firebasePath, routePrefix } = useDiscipline();
    const [competitions, setCompetitions] = useState({});
    const [selectedCity, setSelectedCity] = useState('');
    const [selectedCompId, setSelectedCompId] = useState('');
    const [filterCategory, setFilterCategory] = useState('');

    const MAX_PER_ROTATION = 8;

    // State
    const [rotations, setRotations] = useState([]); // Dynamic rotation count
    const [unassigned, setUnassigned] = useState([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [pdfGenerating, setPdfGenerating] = useState(false);
    const [excelGenerating, setExcelGenerating] = useState(false);
    const [bulkAssigning, setBulkAssigning] = useState(false);

    // Modals
    const [personGroupModal, setPersonGroupModal] = useState(null);
    const [districtModal, setDistrictModal] = useState(null);

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

    // ── Uygulama verisinden antrenör/öğretmen haritası ──────────────────────────
    const loadCoachMapForAthletes = useCallback(async (athletes) => {
        const appIds = [...new Set(athletes.map(a => a.appId).filter(Boolean))];
        if (appIds.length === 0) return {};
        const appMap = {};
        await Promise.all(appIds.map(async (appId) => {
            try {
                const snap = await get(ref(db, `applications/${appId}`));
                if (snap.exists()) {
                    const app = snap.val();
                    const coachesRaw = app.antrenorler || app.coaches || [];
                    const coaches = (Array.isArray(coachesRaw) ? coachesRaw : Object.values(coachesRaw)).filter(c => c && c.name);
                    const teachersRaw = app.ogretmenler || [];
                    const teachers = (Array.isArray(teachersRaw) ? teachersRaw : Object.values(teachersRaw)).filter(t => t && t.name);
                    appMap[appId] = { coaches, teachers };
                }
            } catch { /* ignore */ }
        }));
        return appMap;
    }, []);

    // Sporcu için birincil antrenör/öğretmen adını döndürür
    const getPersonName = (ath, appMap) => {
        if (!ath.appId || !appMap[ath.appId]) return '';
        const { coaches, teachers } = appMap[ath.appId];
        if (coaches && coaches.length > 0) return (coaches[0].name || '').trim();
        if (teachers && teachers.length > 0) return (teachers[0].name || '').trim();
        return '';
    };

    // Kişi bazlı modal için Promise döndüren yardımcı
    const showPersonGroupModal = useCallback((trainers) => {
        return new Promise((resolve) => {
            setPersonGroupModal({
                trainers: trainers.map(t => ({ ...t, groupSize: Math.min(MAX_PER_ROTATION, t.athletes.length) })),
                onConfirm: (result) => { setPersonGroupModal(null); resolve(result); },
                onCancel: () => { setPersonGroupModal(null); resolve(null); }
            });
        });
    }, []);

    // İlçe bazlı modal için Promise döndüren yardımcı
    const showDistrictPriorityModal = useCallback((districts) => {
        return new Promise((resolve) => {
            setDistrictModal({
                districts: districts.map(d => ({ ...d, priority: '' })),
                onConfirm: (result) => { setDistrictModal(null); resolve(result); },
                onCancel: () => { setDistrictModal(null); resolve(null); }
            });
        });
    }, []);

    // Initial load
    useEffect(() => {
        const compsRef = ref(db, firebasePath);
        const unsubscribe = onValue(compsRef, (snap) => {
            const data = snap.val() || {};
            setCompetitions(filterCompetitionsByUser(data, currentUser));
        });
        return () => unsubscribe();
    }, [currentUser, firebasePath]);

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
                    get(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${filterCategory}`)),
                    get(ref(db, `${firebasePath}/${selectedCompId}/siralama/${filterCategory}`))
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
                            // athletesInRot null veya object değilse bu rotasyonu atla
                            if (!athletesInRot || typeof athletesInRot !== 'object') return;
                            const sortedAthletes = Object.keys(athletesInRot).map(id => {
                                const athDetails = loadedAthletes.find(a => a.id === id);
                                const rotEntry = athletesInRot[id];
                                const sirasi = rotEntry && typeof rotEntry === 'object' ? rotEntry.sirasi : 999;
                                return athDetails ? { ...athDetails, sirasi } : null;
                            }).filter(a => a !== null).sort((a, b) => (a.sirasi || 999) - (b.sirasi || 999));

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
                if (import.meta.env.DEV) console.error('StartOrder loadData error:', err);
            } finally {
                setLoading(false);
            }
        };

        loadData();
    }, [selectedCompId, filterCategory]);

    // -- Firebase ID Sırasına Göre Atama (Kayıt Sırası) --
    const handleSortByFirebaseId = async () => {
        if (!selectedCompId || !filterCategory) {
            showToast('Lütfen yarışma ve kategori seçin.', 'warning');
            return;
        }

        const hasAssigned = rotations.some(r => r.length > 0);

        // Sadece atanmamış sporcuları kullan — mevcut gruplar korunur
        let athletesToAssign = [...unassigned];

        if (athletesToAssign.length === 0 && !hasAssigned) {
            const snap = await get(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${filterCategory}`));
            const data = snap.val();
            if (data) athletesToAssign = Object.keys(data).map(id => ({ ...data[id], id, categoryId: filterCategory }));
        }

        if (athletesToAssign.length === 0) {
            showToast(hasAssigned ? 'Atanacak sporcu yok. Gruplara eklemek için sporcuyu boş havuza çekin.' : 'Bu kategoride sporcu bulunamadı.', 'warning');
            return;
        }

        // Firebase ID'ye göre küçükten büyüğe sırala (= kayıt/başvuru sırası)
        athletesToAssign.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

        const newGroups = [];
        for (let i = 0; i < athletesToAssign.length; i += MAX_PER_ROTATION) {
            newGroups.push(athletesToAssign.slice(i, i + MAX_PER_ROTATION));
        }

        // Mevcut grupları koru, yeni grupları sonuna ekle
        const finalRotations = [...rotations.filter(r => r.length > 0), ...newGroups];
        if (finalRotations.length === 0) finalRotations.push([]);

        setRotations(finalRotations);
        setUnassigned([]);
        showToast(`Kayıt sırasına göre atama yapıldı. ${athletesToAssign.length} sporcu ${newGroups.length} yeni gruba dağıtıldı.`, 'success');
        await saveToFirebase(finalRotations, [], true);
    };

    // -- Random Assignment Logic --
    // Kural: Takım grupları ayrı, ferdi grupları ayrı. Dengeli dağılım. Max 8/grup.
    const handleRandomAssign = async () => {
        if (!selectedCompId || !filterCategory) {
            showToast('Lütfen yarışma ve kategori seçin.', 'warning');
            return;
        }

        try {
            const hasAssigned = rotations.some(r => r.length > 0);

            // Sadece atanmamış sporcuları kullan — mevcut gruplar korunur
            let athletesToAssign = [...unassigned];

            if (athletesToAssign.length === 0 && !hasAssigned) {
                const snap = await get(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${filterCategory}`));
                const data = snap.val();
                if (data) athletesToAssign = Object.keys(data).map(id => ({ ...data[id], id, categoryId: filterCategory }));
            }

            if (athletesToAssign.length === 0) {
                showToast(hasAssigned ? 'Atanacak sporcu yok. Gruplara eklemek için sporcuyu boş havuza çekin.' : 'Bu kategoride sporcu bulunamadı.', 'warning');
                return;
            }

            // 1. Separate Teams from Individuals based on yarismaTuru
            const teamsMap = {}; // { 'Okul Adi': [Athletes] }
            const individuals = [];

            athletesToAssign.forEach(ath => {
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

            // ===== Birleştir: mevcut gruplar + yeni takım grupları + yeni ferdi grupları =====
            const newGroups = [...teamGroups, ...individualGroups];
            if (newGroups.length === 0) newGroups.push([]);

            // Mevcut grupları koru, yeni grupları sonuna ekle
            const finalRotations = [...rotations.filter(r => r.length > 0), ...newGroups];
            if (finalRotations.length === 0) finalRotations.push([]);

            setUnassigned([]);
            setRotations(finalRotations);

            // Otomatik kaydet
            const ok = await saveToFirebase(finalRotations, [], true);
            if (ok) {
                showToast(`Rastgele atama yapıldı. ${athletesToAssign.length} sporcu ${newGroups.length} yeni gruba dağıtıldı.`, 'success');
            } else {
                showToast('Atama yapıldı ama kaydetme başarısız oldu. Manuel kaydedin.', 'warning');
            }
        } catch (err) {
            if (import.meta.env.DEV) console.error('Rastgele atama hatası:', err);
            showToast('Rastgele atama sırasında hata oluştu: ' + err.message, 'error');
        }
    };

    // -- Antrenöre Göre Gruplama --
    const handleGroupByCoach = async () => {
        if (!selectedCompId || !filterCategory) {
            showToast('Lütfen yarışma ve kategori seçin.', 'warning');
            return;
        }

        try {
            const hasAssigned = rotations.some(r => r.length > 0);

            // Sadece atanmamış sporcuları kullan — mevcut gruplar korunur
            let athletesToAssign = [...unassigned];

            if (athletesToAssign.length === 0 && !hasAssigned) {
                const snap = await get(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${filterCategory}`));
                const data = snap.val();
                if (data) athletesToAssign = Object.keys(data).map(id => ({ ...data[id], id, categoryId: filterCategory }));
            }

            if (athletesToAssign.length === 0) {
                showToast(hasAssigned ? 'Atanacak sporcu yok. Gruplara eklemek için sporcuyu boş havuza çekin.' : 'Bu kategoride sporcu bulunamadı.', 'warning');
                return;
            }

            // Önce takım / ferdi ayrımı yap
            const teamsMap = {};
            const individuals = [];

            athletesToAssign.forEach(ath => {
                const type = (ath.yarismaTuru || 'ferdi').toLowerCase();
                if (type === 'takim' || type === 'takım') {
                    const school = ath.okul || 'Bilinmeyen Takım';
                    if (!teamsMap[school]) teamsMap[school] = [];
                    teamsMap[school].push(ath);
                } else {
                    individuals.push(ath);
                }
            });

            // ── Phase 1: Takım grupları (okula göre, rastgele sıra) ──────
            const teamsList = Object.values(teamsMap);
            shuffleArray(teamsList);

            const teamGroups = [];
            const findBestTeamGroup = (requiredSlots) => {
                let bestIndex = -1, bestCount = Infinity;
                for (let i = 0; i < teamGroups.length; i++) {
                    if (teamGroups[i].length + requiredSlots <= MAX_PER_ROTATION && teamGroups[i].length < bestCount) {
                        bestCount = teamGroups[i].length;
                        bestIndex = i;
                    }
                }
                if (bestIndex === -1) { teamGroups.push([]); bestIndex = teamGroups.length - 1; }
                return bestIndex;
            };

            teamsList.forEach(teamMembers => {
                const targetIndex = findBestTeamGroup(teamMembers.length);
                teamGroups[targetIndex].push(...teamMembers);
            });

            // ── Phase 2: Ferdi grupları (antrenöre göre) ─────────────────
            // Antrenör/öğretmen bilgisini uygulama kaydından yükle
            const appMap = await loadCoachMapForAthletes(individuals);

            const coachMap = {};
            const noCoach = [];

            individuals.forEach(ath => {
                const coach = getPersonName(ath, appMap);
                if (coach) {
                    if (!coachMap[coach]) coachMap[coach] = [];
                    coachMap[coach].push(ath);
                } else {
                    noCoach.push(ath);
                }
            });

            const coachGroupsList = Object.values(coachMap);
            shuffleArray(coachGroupsList);
            shuffleArray(noCoach);

            const individualGroups = [];
            const findBestIndGroup = (requiredSlots) => {
                let bestIndex = -1, bestCount = Infinity;
                for (let i = 0; i < individualGroups.length; i++) {
                    if (individualGroups[i].length + requiredSlots <= MAX_PER_ROTATION && individualGroups[i].length < bestCount) {
                        bestCount = individualGroups[i].length;
                        bestIndex = i;
                    }
                }
                if (bestIndex === -1) { individualGroups.push([]); bestIndex = individualGroups.length - 1; }
                return bestIndex;
            };

            // Aynı antrenörün ferdilerini aynı gruba yerleştir
            coachGroupsList.forEach(members => {
                for (let i = 0; i < members.length; i += MAX_PER_ROTATION) {
                    const chunk = members.slice(i, i + MAX_PER_ROTATION);
                    const targetIndex = findBestIndGroup(chunk.length);
                    individualGroups[targetIndex].push(...chunk);
                }
            });

            // Antrenörü olmayanları mevcut ferdi gruplarına dengeli dağıt
            noCoach.forEach(ath => {
                const targetIndex = findBestIndGroup(1);
                individualGroups[targetIndex].push(ath);
            });

            // Mevcut grupları koru, yeni grupları sonuna ekle
            const newGroups = [...teamGroups, ...individualGroups];
            if (newGroups.length === 0) newGroups.push([]);
            const finalRotations = [...rotations.filter(r => r.length > 0), ...newGroups];
            if (finalRotations.length === 0) finalRotations.push([]);

            setUnassigned([]);
            setRotations(finalRotations);

            const ok = await saveToFirebase(finalRotations, [], true);
            const coachCount = Object.keys(coachMap).length;
            if (ok) {
                showToast(
                    `Antrenöre göre gruplama yapıldı. ${coachCount} antrenör grubu, ${athletesToAssign.length} sporcu ${newGroups.length} yeni gruba dağıtıldı.`,
                    'success'
                );
            } else {
                showToast('Gruplama yapıldı ama kaydetme başarısız oldu. Manuel kaydedin.', 'warning');
            }
        } catch (err) {
            if (import.meta.env.DEV) console.error('Antrenör gruplama hatası:', err);
            showToast('Antrenör gruplamada hata oluştu: ' + err.message, 'error');
        }
    };

    // -- Kişi Bazlı Gruplama (antrenör/öğretmen başına grup boyutu seçimi ile) --
    const handleGroupByPerson = async () => {
        if (!selectedCompId || !filterCategory) {
            showToast('Lütfen yarışma ve kategori seçin.', 'warning');
            return;
        }
        try {
            const hasAssigned = rotations.some(r => r.length > 0);

            // Sadece atanmamış sporcuları kullan — mevcut gruplar korunur
            let athletesToAssign = [...unassigned];
            if (athletesToAssign.length === 0 && !hasAssigned) {
                const snap = await get(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${filterCategory}`));
                const data = snap.val();
                if (data) athletesToAssign = Object.keys(data).map(id => ({ ...data[id], id, categoryId: filterCategory }));
            }
            if (athletesToAssign.length === 0) {
                showToast(hasAssigned ? 'Atanacak sporcu yok. Gruplara eklemek için sporcuyu boş havuza çekin.' : 'Bu kategoride sporcu bulunamadı.', 'warning');
                return;
            }

            // Takım / ferdi ayır
            const teamsMap = {};
            const individuals = [];
            athletesToAssign.forEach(ath => {
                const type = (ath.yarismaTuru || 'ferdi').toLowerCase();
                if (type === 'takim' || type === 'takım') {
                    const school = ath.okul || 'Bilinmeyen Takım';
                    if (!teamsMap[school]) teamsMap[school] = [];
                    teamsMap[school].push(ath);
                } else {
                    individuals.push(ath);
                }
            });

            // Antrenör/öğretmen bilgisini uygulama kaydından yükle
            const appMap = await loadCoachMapForAthletes(individuals);

            // Antrenör/öğretmen → sporcu listesi (uygulama kaydından)
            const trainerMap = {};
            const noTrainer = [];
            individuals.forEach(ath => {
                const name = getPersonName(ath, appMap);
                if (name) {
                    if (!trainerMap[name]) {
                        // Türünü belirle: antrenör mü öğretmen mi?
                        const appData = appMap[ath.appId];
                        const isCoach = appData && appData.coaches && appData.coaches.length > 0;
                        trainerMap[name] = { name, type: isCoach ? 'antrenör' : 'öğretmen', athletes: [] };
                    }
                    trainerMap[name].athletes.push(ath);
                } else {
                    noTrainer.push(ath);
                }
            });

            // Antrenörleri alfabetik sırala
            const trainerList = Object.values(trainerMap).sort((a, b) =>
                a.name.localeCompare(b.name, 'tr-TR')
            );
            // Her antrenörün sporcularını ada göre sırala
            trainerList.forEach(t => {
                t.athletes.sort((a, b) => `${a.ad} ${a.soyad}`.localeCompare(`${b.ad} ${b.soyad}`, 'tr-TR'));
            });

            // Modal'ı göster ve kullanıcının grup boyutlarını belirlemesini bekle
            const modalResult = await showPersonGroupModal(trainerList);
            if (modalResult === null) return; // İptal

            // Phase 1: Takım grupları (rastgele sıra)
            const teamsList = Object.values(teamsMap).map(members =>
                [...members].sort((a, b) => `${a.ad} ${a.soyad}`.localeCompare(`${b.ad} ${b.soyad}`, 'tr-TR'))
            );
            const teamGroups = [];
            const findBestTG = (n) => {
                let bi = -1, bc = Infinity;
                for (let i = 0; i < teamGroups.length; i++) {
                    if (teamGroups[i].length + n <= MAX_PER_ROTATION && teamGroups[i].length < bc) { bc = teamGroups[i].length; bi = i; }
                }
                if (bi === -1) { teamGroups.push([]); bi = teamGroups.length - 1; }
                return bi;
            };
            teamsList.forEach(members => { const ti = findBestTG(members.length); teamGroups[ti].push(...members); });

            // Phase 2: Ferdi grupları — modal'dan gelen grup boyutları ile
            const individualGroups = [];

            modalResult.forEach(({ athletes, groupSize }) => {
                const size = Math.max(1, Math.min(MAX_PER_ROTATION, groupSize));
                for (let k = 0; k < athletes.length; k += size) {
                    individualGroups.push(athletes.slice(k, k + size));
                }
            });

            // Antrenörü olmayan sporcuları sona ekle (mevcut gruplara sığdır)
            if (noTrainer.length > 0) {
                noTrainer.sort((a, b) => `${a.ad} ${a.soyad}`.localeCompare(`${b.ad} ${b.soyad}`, 'tr-TR'));
                const findBestIG = (n) => {
                    let bi = -1, bc = Infinity;
                    for (let i = 0; i < individualGroups.length; i++) {
                        if (individualGroups[i].length + n <= MAX_PER_ROTATION && individualGroups[i].length < bc) { bc = individualGroups[i].length; bi = i; }
                    }
                    if (bi === -1) { individualGroups.push([]); bi = individualGroups.length - 1; }
                    return bi;
                };
                noTrainer.forEach(ath => { const gi = findBestIG(1); individualGroups[gi].push(ath); });
            }

            const newGroups = [...teamGroups, ...individualGroups];
            if (newGroups.length === 0) newGroups.push([]);
            const finalRotations = [...rotations.filter(r => r.length > 0), ...newGroups];
            if (finalRotations.length === 0) finalRotations.push([]);
            setUnassigned([]);
            setRotations(finalRotations);
            const ok = await saveToFirebase(finalRotations, [], true);
            if (ok) showToast(`Kişi bazlı gruplama yapıldı. ${athletesToAssign.length} sporcu ${newGroups.length} yeni gruba dağıtıldı.`, 'success');
            else showToast('Gruplama yapıldı ama kaydetme başarısız oldu. Manuel kaydedin.', 'warning');
        } catch (err) {
            if (import.meta.env.DEV) console.error('Kişi bazlı gruplama hatası:', err);
            showToast('Kişi bazlı gruplamada hata oluştu: ' + err.message, 'error');
        }
    };

    // -- İlçe Bazlı Gruplama --
    const handleGroupByDistrict = async () => {
        if (!selectedCompId || !filterCategory) {
            showToast('Lütfen yarışma ve kategori seçin.', 'warning');
            return;
        }
        try {
            const hasAssigned = rotations.some(r => r.length > 0);

            // Sadece atanmamış sporcuları kullan — mevcut gruplar korunur
            let athletesToAssign = [...unassigned];
            if (athletesToAssign.length === 0 && !hasAssigned) {
                const snap = await get(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${filterCategory}`));
                const data = snap.val();
                if (data) athletesToAssign = Object.keys(data).map(id => ({ ...data[id], id, categoryId: filterCategory }));
            }
            if (athletesToAssign.length === 0) {
                showToast(hasAssigned ? 'Atanacak sporcu yok. Gruplara eklemek için sporcuyu boş havuza çekin.' : 'Bu kategoride sporcu bulunamadı.', 'warning');
                return;
            }

            // Takım / ferdi ayır
            const teamsMap = {};
            const individuals = [];
            athletesToAssign.forEach(ath => {
                const type = (ath.yarismaTuru || 'ferdi').toLowerCase();
                if (type === 'takim' || type === 'takım') {
                    const school = ath.okul || 'Bilinmeyen Takım';
                    if (!teamsMap[school]) teamsMap[school] = [];
                    teamsMap[school].push(ath);
                } else {
                    individuals.push(ath);
                }
            });

            // Phase 1: Takım grupları — ilçeye göre sıralı, ferdi üyeler ada göre
            const sortedTeams = Object.values(teamsMap).map(members =>
                [...members].sort((a, b) => `${a.ad} ${a.soyad}`.localeCompare(`${b.ad} ${b.soyad}`, 'tr-TR'))
            ).sort((a, b) => {
                const ia = (a[0]?.ilce || '').toLocaleUpperCase('tr-TR');
                const ib = (b[0]?.ilce || '').toLocaleUpperCase('tr-TR');
                return ia.localeCompare(ib, 'tr-TR');
            });
            const teamGroups = [];
            const findBestTGD = (n) => {
                let bi = -1, bc = Infinity;
                for (let i = 0; i < teamGroups.length; i++) {
                    if (teamGroups[i].length + n <= MAX_PER_ROTATION && teamGroups[i].length < bc) { bc = teamGroups[i].length; bi = i; }
                }
                if (bi === -1) { teamGroups.push([]); bi = teamGroups.length - 1; }
                return bi;
            };
            sortedTeams.forEach(members => { const ti = findBestTGD(members.length); teamGroups[ti].push(...members); });

            // Phase 2: Ferdi sporcuları ilçeye göre grupla
            const districtMap = {};
            individuals.forEach(ath => {
                const district = (ath.ilce || 'Bilinmeyen İlçe').toLocaleUpperCase('tr-TR');
                if (!districtMap[district]) districtMap[district] = [];
                districtMap[district].push(ath);
            });

            // İlçe listesini hazırla (sporcu sayısıyla birlikte)
            const districtEntries = Object.entries(districtMap).map(([name, members]) => ({
                name,
                athletes: members.sort((a, b) => `${a.ad} ${a.soyad}`.localeCompare(`${b.ad} ${b.soyad}`, 'tr-TR')),
                count: members.length
            })).sort((a, b) => a.name.localeCompare(b.name, 'tr-TR'));

            // Modal'ı göster — kullanıcı öncelik numarası girer
            const modalResult = await showDistrictPriorityModal(districtEntries);
            if (modalResult === null) return; // İptal

            // Öncelik numarasına göre sırala: numaralı olanlar önce (küçükten büyüğe), geri kalanlar alfabetik
            const prioritized = modalResult
                .filter(d => d.priority !== '' && !isNaN(parseInt(d.priority)))
                .sort((a, b) => parseInt(a.priority) - parseInt(b.priority));
            const unprioritized = modalResult
                .filter(d => d.priority === '' || isNaN(parseInt(d.priority)))
                .sort((a, b) => a.name.localeCompare(b.name, 'tr-TR'));
            const sortedDistricts = [...prioritized, ...unprioritized];

            const individualGroups = [];
            const findBestIGD = (n) => {
                let bi = -1, bc = Infinity;
                for (let i = 0; i < individualGroups.length; i++) {
                    if (individualGroups[i].length + n <= MAX_PER_ROTATION && individualGroups[i].length < bc) { bc = individualGroups[i].length; bi = i; }
                }
                if (bi === -1) { individualGroups.push([]); bi = individualGroups.length - 1; }
                return bi;
            };
            sortedDistricts.forEach(d => {
                for (let k = 0; k < d.athletes.length; k += MAX_PER_ROTATION) {
                    const part = d.athletes.slice(k, k + MAX_PER_ROTATION);
                    const gi = findBestIGD(part.length);
                    individualGroups[gi].push(...part);
                }
            });

            const newGroups = [...teamGroups, ...individualGroups];
            if (newGroups.length === 0) newGroups.push([]);
            const finalRotations = [...rotations.filter(r => r.length > 0), ...newGroups];
            if (finalRotations.length === 0) finalRotations.push([]);
            setUnassigned([]);
            setRotations(finalRotations);
            const ok = await saveToFirebase(finalRotations, [], true);
            const distCount = Object.keys(districtMap).length;
            if (ok) showToast(`İlçe bazlı gruplama yapıldı. ${distCount} ilçe, ${athletesToAssign.length} sporcu ${newGroups.length} yeni gruba dağıtıldı.`, 'success');
            else showToast('Gruplama yapıldı ama kaydetme başarısız oldu. Manuel kaydedin.', 'warning');
        } catch (err) {
            if (import.meta.env.DEV) console.error('İlçe bazlı gruplama hatası:', err);
            showToast('İlçe bazlı gruplamada hata oluştu: ' + err.message, 'error');
        }
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
            showToast("Kategori seçilmelidir.", 'error');
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

                    const athPath = `${firebasePath}/${selectedCompId}/sporcular/${filterCategory}/${ath.id}`;
                    updates[`${athPath}/sirasi`] = grupIciSirasi;
                    updates[`${athPath}/cikisSirasi`] = globalOrder;
                    updates[`${athPath}/rotasyonGrubu`] = rotIndex;
                });
                siralamaData[`rotation_${rotIndex}`] = rotationObj;
            }
        });

        unassignedToSave.forEach((ath) => {
            const athPath = `${firebasePath}/${selectedCompId}/sporcular/${filterCategory}/${ath.id}`;
            updates[`${athPath}/sirasi`] = 999;
            updates[`${athPath}/cikisSirasi`] = null;
            updates[`${athPath}/rotasyonGrubu`] = null;
        });

        updates[`${firebasePath}/${selectedCompId}/siralama/${filterCategory}`] = Object.keys(siralamaData).length > 0 ? siralamaData : null;

        try {
            await update(ref(db), updates);
            if (!silent) showToast("Çıkış sırası başarıyla kaydedildi.", 'success');
            return true;
        } catch (err) {
            if (import.meta.env.DEV) console.error(err);
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
            "Tüm yarışmalardaki tüm kategorilerde atanmamış sporcular mevcut gruplara dağıtılacak. Atanmış sporculara dokunulmayacak. Devam etmek istiyor musunuz?"
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
                    const [athletesSnap, orderSnap] = await Promise.all([
                        get(ref(db, `${firebasePath}/${compId}/sporcular/${category}`)),
                        get(ref(db, `${firebasePath}/${compId}/siralama/${category}`))
                    ]);

                    const data = athletesSnap.val();
                    if (!data) continue;

                    const allAthletes = Object.keys(data).map(athId => ({
                        ...data[athId], id: athId, categoryId: category
                    }));

                    // Mevcut sıralamayı oku — atanmış sporculara dokunma
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
                    if (unassignedAthletes.length === 0) continue;

                    // Takım / ferdi ayrımı (Rastgele Ata ile aynı kurallar)
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

                    // Mevcut rotasyonları kopyala (atanmışlar korunuyor)
                    const finalRotations = existingRotations.map(r => [...r]);

                    // Mevcut gruplarda boş yer bul helper
                    const findGroupWithSpace = (requiredSlots) => {
                        let best = -1, bestCount = Infinity;
                        for (let i = 0; i < finalRotations.length; i++) {
                            const available = MAX_PER_ROTATION - finalRotations[i].length;
                            if (available >= requiredSlots && finalRotations[i].length < bestCount) {
                                bestCount = finalRotations[i].length;
                                best = i;
                            }
                        }
                        return best;
                    };

                    // PHASE 1: Takım sporcularını yerleştir (Rastgele Ata ile aynı)
                    teamsList.forEach(teamMembers => {
                        // Önce mevcut gruplarda yer ara
                        let targetIdx = findGroupWithSpace(teamMembers.length);
                        if (targetIdx === -1) {
                            // Yer yoksa yeni grup oluştur
                            finalRotations.push([]);
                            targetIdx = finalRotations.length - 1;
                        }
                        finalRotations[targetIdx].push(...teamMembers);
                    });

                    // PHASE 2: Ferdi sporcuları yerleştir — mevcut gruplara dengeli dağıt
                    individuals.forEach(ath => {
                        // En az kişi olan ve yer olan grubu bul
                        let targetIdx = findGroupWithSpace(1);
                        if (targetIdx === -1) {
                            finalRotations.push([]);
                            targetIdx = finalRotations.length - 1;
                        }
                        finalRotations[targetIdx].push(ath);
                    });

                    if (finalRotations.length === 0) finalRotations.push([]);

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
                                const p = `${firebasePath}/${compId}/sporcular/${category}/${ath.id}`;
                                updates[`${p}/sirasi`] = grupIci;
                                updates[`${p}/cikisSirasi`] = globalOrder;
                                updates[`${p}/rotasyonGrubu`] = rotIndex;
                            });
                            siralamaData[`rotation_${rotIndex}`] = rotObj;
                        }
                    });

                    updates[`${firebasePath}/${compId}/siralama/${category}`] = Object.keys(siralamaData).length > 0 ? siralamaData : null;
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

            // Mevcut seçili kategoriyi yeniden yükle
            if (selectedCompId && filterCategory) {
                try {
                    const [athSnap, ordSnap] = await Promise.all([
                        get(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${filterCategory}`)),
                        get(ref(db, `${firebasePath}/${selectedCompId}/siralama/${filterCategory}`))
                    ]);

                    const data = athSnap.val();
                    const loadedAthletes = [];
                    if (data) {
                        Object.keys(data).forEach(athId => {
                            loadedAthletes.push({ ...data[athId], id: athId, categoryId: filterCategory });
                        });
                    }

                    const orderData = ordSnap.val();
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
                } catch (reloadErr) {
                    if (import.meta.env.DEV) console.error('Yeniden yükleme hatası:', reloadErr);
                }
            }
        } catch (err) {
            if (import.meta.env.DEV) console.error('Toplu atama hatası:', err);
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
                setPdfGenerating(false);
                return;
            }

            const { jsPDF } = await import('jspdf');
            const { default: autoTable } = await import('jspdf-autotable');
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
                if (import.meta.env.DEV) console.warn('Roboto font yüklenemedi, varsayılan font kullanılıyor.');
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
                    ref(db, `${firebasePath}/${selectedCompId}/sporcular/${category}`)
                );
                const athletesData = athletesSnap.val() || {};
                const athletes = Object.entries(athletesData).map(([id, data]) => ({
                    ...data,
                    id,
                }));

                // Sıralama verisini çek
                const siraSnap = await get(
                    ref(db, `${firebasePath}/${selectedCompId}/siralama/${category}`)
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

                    startY = (doc.lastAutoTable?.finalY ?? (startY + tableData.length * 8 + 15)) + 12;

                    if (startY > doc.internal.pageSize.getHeight() - 30) {
                        doc.addPage();
                        startY = 15;
                    }
                });
            }

            if (pageCount === 0) {
                showToast("Henüz hiçbir kategoride sıralama yapılmamış.", 'warning');
                setPdfGenerating(false);
                return;
            }

            const safeCompName = compName.replace(/[\\/:*?"<>|]/g, '_');
            doc.save(`${safeCompName}_Tum_Kategoriler_Cikis_Sirasi.pdf`);
        } catch (err) {
            if (import.meta.env.DEV) console.error('PDF oluşturma hatası:', err);
            showToast('PDF oluşturulurken bir hata oluştu: ' + err.message, 'error');
        } finally {
            setPdfGenerating(false);
        }
    };


    // ===== EXCEL EXPORT =====
    const CATEGORY_LABELS = {
        'genc_erkek': 'GENÇ ERKEKLER', 'genc_kiz': 'GENÇ KIZLAR',
        'kucuk_erkek': 'KÜÇÜK ERKEKLER', 'kucuk_kiz': 'KÜÇÜK KIZLAR',
        'minik_a_erkek': 'MİNİK A ERKEKLER', 'minik_a_kiz': 'MİNİK A KIZLAR',
        'minik_b_erkek': 'MİNİK B ERKEKLER', 'minik_b_kiz': 'MİNİK B KIZLAR',
        'yildiz_erkek': 'YILDIZ ERKEKLER', 'yildiz_kiz': 'YILDIZ KIZLAR'
    };

    const handleExportExcel = async () => {
        if (!selectedCompId) { showToast("Dışa aktarmak için yarışma seçiniz.", 'warning'); return; }
        if (excelGenerating) return;
        setExcelGenerating(true);

        try {
            const XLSX = await import('xlsx');
            const comp = competitions[selectedCompId];
            const compName = comp?.isim || 'Yarışma';
            const compTarih = comp?.tarih || '';

            // Tarih formatla
            let tarihStr = '';
            if (compTarih) {
                try {
                    const d = new Date(compTarih);
                    tarihStr = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
                } catch { tarihStr = compTarih; }
            }

            const allCategories = Object.keys(comp?.sporcular || {}).sort();
            if (allCategories.length === 0) {
                showToast("Bu yarışma için kategori bulunamadı.", 'warning');
                return;
            }

            const wb = XLSX.utils.book_new();

            for (const category of allCategories) {
                // Sporcuları ve sıralamayı çek
                const [athletesSnap, siraSnap] = await Promise.all([
                    get(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${category}`)),
                    get(ref(db, `${firebasePath}/${selectedCompId}/siralama/${category}`))
                ]);

                const athletesData = athletesSnap.val() || {};
                const athletes = Object.entries(athletesData).map(([id, data]) => ({ ...data, id }));
                const siraData = siraSnap.val();

                // Rotasyonları oluştur
                const catRotations = [];
                if (siraData) {
                    let maxIdx = -1;
                    Object.keys(siraData).forEach(rotKey => {
                        const rotIndex = parseInt(rotKey.replace('rotation_', ''));
                        if (!isNaN(rotIndex) && rotIndex > maxIdx) maxIdx = rotIndex;
                    });
                    for (let i = 0; i <= maxIdx; i++) catRotations.push([]);
                    Object.keys(siraData).forEach(rotKey => {
                        const rotIndex = parseInt(rotKey.replace('rotation_', ''));
                        if (!isNaN(rotIndex)) {
                            const athletesInRot = siraData[rotKey];
                            catRotations[rotIndex] = Object.keys(athletesInRot)
                                .map(id => {
                                    const ath = athletes.find(a => a.id === id);
                                    return ath ? { ...ath, sirasi: athletesInRot[id].sirasi } : null;
                                })
                                .filter(Boolean)
                                .sort((a, b) => a.sirasi - b.sirasi);
                        }
                    });
                }

                if (!catRotations.some(r => r.length > 0)) continue;

                const catLabel = CATEGORY_LABELS[category] || category.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                const sheetTitle = `${tarihStr ? tarihStr + ' ' : ''}${catLabel} YARIŞMA LİSTESİ`;

                // Sheet verisi oluştur
                const rows = [];
                // Boş satır + Başlık
                rows.push([]);
                rows.push([]);
                rows.push(['', '', sheetTitle, '', '']);

                let globalOrder = 0;

                catRotations.forEach((rotation, groupIndex) => {
                    if (rotation.length === 0) return;
                    // Grup başlığı
                    rows.push(['SIRA', '', 'GENEL ISINMA', '', '']);

                    rotation.forEach(ath => {
                        globalOrder++;
                        rows.push([
                            globalOrder,
                            '',
                            ath.okul || '',
                            ath.ad || '',
                            ath.soyad || ''
                        ]);
                    });
                });

                const ws = XLSX.utils.aoa_to_sheet(rows);

                // Sütun genişlikleri
                ws['!cols'] = [
                    { wch: 6 },   // A: SIRA
                    { wch: 4 },   // B: boş
                    { wch: 45 },  // C: Okul
                    { wch: 20 },  // D: Ad
                    { wch: 20 },  // E: Soyad
                ];

                // Başlık satırını birleştir
                ws['!merges'] = [
                    { s: { r: 2, c: 1 }, e: { r: 2, c: 4 } } // Başlık birleştirme
                ];

                // Grup başlık satırlarını birleştir (GENEL ISINMA)
                let rowIdx = 3;
                catRotations.forEach(rotation => {
                    if (rotation.length === 0) return;
                    ws['!merges'].push({ s: { r: rowIdx, c: 2 }, e: { r: rowIdx, c: 4 } });
                    rowIdx += 1 + rotation.length;
                });

                // Sheet adını kısalt (max 31 karakter)
                let sheetName = catLabel;
                if (sheetName.length > 31) sheetName = sheetName.substring(0, 31);

                XLSX.utils.book_append_sheet(wb, ws, sheetName);
            }

            if (wb.SheetNames.length === 0) {
                showToast("Henüz hiçbir kategoride sıralama yapılmamış.", 'warning');
                return;
            }

            const safeCompName = compName.replace(/[\\/:*?"<>|]/g, '_');
            XLSX.writeFile(wb, `${safeCompName}_Cikis_Sirasi.xlsx`);
            showToast("Excel başarıyla oluşturuldu.", 'success');
        } catch (err) {
            if (import.meta.env.DEV) console.error('Excel oluşturma hatası:', err);
            showToast('Excel oluşturulurken bir hata oluştu: ' + err.message, 'error');
        } finally {
            setExcelGenerating(false);
        }
    };

    const availableCities = [...new Set(Object.values(competitions).map(c => (c.il || c.city || '').toLocaleUpperCase('tr-TR')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr-TR'));
    const compOptions = Object.entries(competitions)
        .filter(([id, comp]) => !selectedCity || (comp.il || comp.city || '').toLocaleUpperCase('tr-TR') === selectedCity)
        .sort((a, b) => new Date(b[1].tarih) - new Date(a[1].tarih));
    let uniqueCategories = [];
    if (selectedCompId && competitions[selectedCompId]?.sporcular) {
        uniqueCategories = Object.keys(competitions[selectedCompId].sporcular).filter(k => k && k !== 'undefined');
    }

    return (
        <div className="order-page">
            <header className="page-header--bento">
                <div className="page-header__left">
                    <button className="back-btn back-btn--light" onClick={() => navigate(routePrefix)}>
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
                        <>
                            <button
                                className="btn-bento-secondary"
                                onClick={handleExportExcel}
                                title="Tüm kategorileri Excel olarak indir"
                                disabled={!selectedCompId || excelGenerating}
                            >
                                {excelGenerating
                                    ? <><div className="spinner-small"></div><span>Hazırlanıyor...</span></>
                                    : <><i className="material-icons-round">table_view</i><span>Excel İndir</span></>
                                }
                            </button>
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
                        </>
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
                        <i className="material-icons-round">location_city</i>
                        <select
                            className="bento-select"
                            value={selectedCity}
                            onChange={(e) => { setSelectedCity(e.target.value); setSelectedCompId(''); setFilterCategory(''); }}
                        >
                            <option value="">Tüm İller</option>
                            {availableCities.map(city => <option key={city} value={city}>{city}</option>)}
                        </select>
                    </div>

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
                        <>
                            <button
                                className="btn-random-assign"
                                onClick={handleSortByFirebaseId}
                                disabled={!selectedCompId || !filterCategory}
                                title="Sporcuları başvuru/kayıt sırasına göre (Firebase ID küçükten büyüğe) gruplara ata"
                            >
                                <i className="material-icons-round">format_list_numbered</i>
                                Kayıt Sırasına Göre Ata
                            </button>
                            <button
                                className="btn-random-assign"
                                onClick={handleRandomAssign}
                                disabled={!selectedCompId || !filterCategory}
                            >
                                <i className="material-icons-round">auto_awesome</i>
                                Rastgele Atama Yap
                            </button>
                            <button
                                className="btn-random-assign"
                                onClick={handleGroupByCoach}
                                disabled={!selectedCompId || !filterCategory}
                                title="Aynı antrenör/öğretmene sahip sporcuları aynı gruba ata"
                            >
                                <i className="material-icons-round">supervisor_account</i>
                                Antrenöre Göre Grupla
                            </button>
                            <button
                                className="btn-random-assign"
                                onClick={handleGroupByPerson}
                                disabled={!selectedCompId || !filterCategory}
                                title="Ferdi sporcuları antrenör adına göre alfabetik sırala, takım sporcuları önce gelir"
                            >
                                <i className="material-icons-round">sort_by_alpha</i>
                                Kişi Bazlı Grupla
                            </button>
                            <button
                                className="btn-random-assign"
                                onClick={handleGroupByDistrict}
                                disabled={!selectedCompId || !filterCategory}
                                title="Sporcuları ilçeye göre grupla, takım sporcuları önce gelir"
                            >
                                <i className="material-icons-round">location_city</i>
                                İlçe Bazlı Grupla
                            </button>
                        </>
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
                                                    <small>{ath.okul || 'Okul Yok'} <span className={`type-badge ${(ath.yarismaTuru || 'ferdi').toLowerCase()}`}>{ath.yarismaTuru || 'Ferdi'}</span>{(ath.antrenor || ath.ogretmen) ? <span className="coach-badge"> · {ath.antrenor || ath.ogretmen}</span> : null}</small>
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
                                                            <small>{ath.okul ? ath.okul.substring(0, 20) : ''} <span className={`type-badge ${(ath.yarismaTuru || 'ferdi').toLowerCase()}`}>{ath.yarismaTuru || 'Ferdi'}</span>{(ath.antrenor || ath.ogretmen) ? <span className="coach-badge"> · {ath.antrenor || ath.ogretmen}</span> : null}</small>
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

            {/* Kişi Bazlı Gruplama Modal */}
            {personGroupModal && (
                <div className="confirm-overlay" onClick={personGroupModal.onCancel}>
                    <div className="grouping-modal" onClick={e => e.stopPropagation()}>
                        <div className="grouping-modal__header">
                            <i className="material-icons-round">sort_by_alpha</i>
                            <h2>Kişi Bazlı Gruplama</h2>
                        </div>
                        <p className="grouping-modal__desc">Her antrenör/öğretmen için grup boyutunu belirleyin. Sporcular o boyutta gruplara bölünecektir.</p>
                        <div className="grouping-modal__table">
                            <div className="grouping-modal__thead">
                                <span>Antrenör / Öğretmen</span>
                                <span>Tür</span>
                                <span>Sporcu</span>
                                <span>Grup Boyutu</span>
                            </div>
                            {personGroupModal.trainers.map((trainer, idx) => (
                                <div key={trainer.name} className="grouping-modal__row">
                                    <span className="grouping-modal__name">{trainer.name}</span>
                                    <span className={`grouping-modal__type grouping-modal__type--${trainer.type === 'antrenör' ? 'coach' : 'teacher'}`}>{trainer.type}</span>
                                    <span className="grouping-modal__count">{trainer.athletes.length}</span>
                                    <input
                                        type="number"
                                        className="grouping-modal__input"
                                        min="1"
                                        max={MAX_PER_ROTATION}
                                        value={trainer.groupSize}
                                        onChange={e => {
                                            const val = Math.max(1, Math.min(MAX_PER_ROTATION, parseInt(e.target.value) || 1));
                                            setPersonGroupModal(prev => ({
                                                ...prev,
                                                trainers: prev.trainers.map((t, i) => i === idx ? { ...t, groupSize: val } : t)
                                            }));
                                        }}
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="confirm-modal__actions">
                            <button className="confirm-btn confirm-btn--cancel" onClick={personGroupModal.onCancel}>
                                İptal
                            </button>
                            <button className="confirm-btn confirm-btn--ok" onClick={() => personGroupModal.onConfirm(personGroupModal.trainers)}>
                                Gruplamayı Başlat
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* İlçe Öncelik Modal */}
            {districtModal && (
                <div className="confirm-overlay" onClick={districtModal.onCancel}>
                    <div className="grouping-modal grouping-modal--district" onClick={e => e.stopPropagation()}>
                        <div className="grouping-modal__header">
                            <i className="material-icons-round">location_city</i>
                            <h2>İlçe Öncelik Sıralaması</h2>
                        </div>
                        <p className="grouping-modal__desc">Önce çıkmasını istediğiniz ilçelere numara girin (1, 2, 3...). Numarasız ilçeler alfabetik sırada gelir.</p>
                        <div className="grouping-modal__table">
                            <div className="grouping-modal__thead">
                                <span>Öncelik No</span>
                                <span>İlçe</span>
                                <span>Sporcu</span>
                            </div>
                            {districtModal.districts.map((district, idx) => (
                                <div key={district.name} className="grouping-modal__row">
                                    <input
                                        type="number"
                                        className="grouping-modal__input grouping-modal__input--priority"
                                        min="1"
                                        placeholder="—"
                                        value={district.priority}
                                        onChange={e => {
                                            const val = e.target.value;
                                            setDistrictModal(prev => ({
                                                ...prev,
                                                districts: prev.districts.map((d, i) => i === idx ? { ...d, priority: val } : d)
                                            }));
                                        }}
                                    />
                                    <span className="grouping-modal__name">{district.name}</span>
                                    <span className="grouping-modal__count">{district.count}</span>
                                </div>
                            ))}
                        </div>
                        <div className="confirm-modal__actions">
                            <button className="confirm-btn confirm-btn--cancel" onClick={districtModal.onCancel}>
                                İptal
                            </button>
                            <button className="confirm-btn confirm-btn--ok" onClick={() => districtModal.onConfirm(districtModal.districts)}>
                                Gruplamayı Başlat
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
