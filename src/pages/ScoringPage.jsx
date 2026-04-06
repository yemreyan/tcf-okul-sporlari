import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { DEFAULT_CRITERIA } from '../data/criteriaDefaults';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { logAction } from '../lib/auditLogger';
import { useDiscipline } from '../lib/DisciplineContext';
import { useOffline } from '../lib/OfflineContext';
import './ScoringPage.css';

export default function ScoringPage() {
    const navigate = useNavigate();
    const { currentUser, hasPermission, hashPassword } = useAuth();
    const { toast } = useNotification();
    const { firebasePath, routePrefix } = useDiscipline();
    const { offlineWrite } = useOffline();
    const [competitions, setCompetitions] = useState({});

    // Selections
    const [selectedCity, setSelectedCity] = useState('');
    const [selectedCompId, setSelectedCompId] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('');
    const [selectedApparatus, setSelectedApparatus] = useState('');

    // Athlete State
    const [selectedAthlete, setSelectedAthlete] = useState(null);
    const [isAthleteCalled, setIsAthleteCalled] = useState(false);

    // Data mapped from Firebase
    const [athletesByRotation, setAthletesByRotation] = useState([]);
    const [existingScores, setExistingScores] = useState({});

    // Firebase criteria
    const [liveCriteria, setLiveCriteria] = useState(null);
    const [activeYear, setActiveYear] = useState(null);

    // Scoring Mode: 'separate' (D ve E ayrı panel) | 'combined' (tek hakem ikisini de girer)
    const [scoringMode, setScoringMode] = useState('separate');
    const [combinedEDeduction, setCombinedEDeduction] = useState(0);

    // Active Scoring State
    const [dScore, setDScore] = useState(0);
    const [skillScores, setSkillScores] = useState({});
    const [neutralDeductions, setNeutralDeductions] = useState(0);
    const [manualEksikSayisi, setManualEksikSayisi] = useState(0);
    const [ePanelLocal, setEPanelLocal] = useState({});
    const [ePanelTouched, setEPanelTouched] = useState({});
    // "Kullanıcı dokundu mu?" takibi — Firebase'den gelen güncelleme kullanıcı girişini ezmemesi için
    const [scoringFieldsTouched, setScoringFieldsTouched] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [confirmModal, setConfirmModal] = useState(null);
    const [successModal, setSuccessModal] = useState(null);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [athleteSearch, setAthleteSearch] = useState('');

    // Score Lock State
    const [scoreLocked, setScoreLocked] = useState(false);
    const [unlockModal, setUnlockModal] = useState(null); // { athleteId, athleteName }
    const [unlockPassword, setUnlockPassword] = useState('');
    const [unlockError, setUnlockError] = useState('');
    const [unlockingInProgress, setUnlockingInProgress] = useState(false);

    // Difficulty Mode State (yıldız/genç kategoriler için)
    const [difficultyMoves, setDifficultyMoves] = useState({});
    const [crValue, setCrValue] = useState(0);          // Kız kategoriler (tek CR)
    const [crGroupValues, setCrGroupValues] = useState([0, 0, 0, 0]); // Erkek kategoriler (4 Yapı Grubu)
    const [cvValue, setCvValue] = useState(0);
    const [btrsValue, setBtrsValue] = useState(0);

    // Zorluk grubu sabitleri
    const DIFFICULTY_POINTS = { A: 0.1, B: 0.2, C: 0.3, D: 0.4, E: 0.5, F: 0.6, G: 0.7, H: 0.8, I: 0.9, J: 1.0 };
    const DIFFICULTY_GROUPS = ['J', 'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A']; // J'den A'ya (yüksekten düşüğe)
    const MAX_MOVES_PER_GROUP = 8;

    // 1. Load Competitions
    useEffect(() => {
        const compsRef = ref(db, firebasePath);
        const unsubscribe = onValue(compsRef, (snap) => {
            const data = snap.val() || {};
            setCompetitions(filterCompetitionsByUser(data, currentUser));
        });
        return () => unsubscribe();
    }, [currentUser, firebasePath]);

    // 2. Load active year from Firebase
    useEffect(() => {
        const ayRef = ref(db, 'criteria/activeYear');
        const unsub = onValue(ayRef, (snap) => {
            setActiveYear(snap.val() || new Date().getFullYear());
        });
        return () => unsub();
    }, []);

    // 3. Load criteria from Firebase (fallback: DEFAULT_CRITERIA)
    useEffect(() => {
        if (!selectedCategory) {
            setLiveCriteria(null);
            return;
        }
        // activeYear henüz yüklenmediyse doğrudan DEFAULT_CRITERIA kullan
        if (!activeYear) {
            setLiveCriteria(DEFAULT_CRITERIA[selectedCategory] || null);
            return;
        }
        const criteriaRef = ref(db, `criteria/${activeYear}/${selectedCategory}`);
        const unsub = onValue(criteriaRef, (snap) => {
            const data = snap.val();
            setLiveCriteria(data || DEFAULT_CRITERIA[selectedCategory] || null);
        });
        return () => unsub();
    }, [selectedCategory, activeYear]);

    // 4. Load Start Order and Scores
    useEffect(() => {
        if (!selectedCompId || !selectedCategory || !selectedApparatus) {
            setAthletesByRotation([]);
            setExistingScores({});
            setSelectedAthlete(null);
            setIsAthleteCalled(false);
            return;
        }

        let fallbackUnsub = null;

        const orderRef = ref(db, `${firebasePath}/${selectedCompId}/siralama/${selectedCategory}`);
        const athletesRef = ref(db, `${firebasePath}/${selectedCompId}/sporcular/${selectedCategory}`);

        const unsubOrder = onValue(orderRef, async (orderSnap) => {
            const orderData = orderSnap.val();
            const formattedRotations = [];

            if (orderData) {
                // Güncel sporcu listesini al — kategorisi değişmiş sporcuları filtrele
                const athSnap = await get(athletesRef);
                const allAthData = athSnap.exists() ? athSnap.val() : {};
                const validIds = new Set(Object.keys(allAthData));
                const assignedIds = new Set();

                const maxRots = Math.max(...Object.keys(orderData).map(k => parseInt(k.replace('rotation_', ''))).filter(n => !isNaN(n)));

                for (let i = 0; i <= maxRots; i++) {
                    const rotData = orderData[`rotation_${i}`];
                    if (rotData) {
                        const athArr = Object.keys(rotData)
                            .filter(id => validIds.size === 0 || validIds.has(id))
                            .map(id => {
                                assignedIds.add(id);
                                return { id, ...rotData[id] };
                            })
                            .sort((a, b) => a.sirasi - b.sirasi);
                        formattedRotations.push(athArr);
                    } else {
                        formattedRotations.push([]);
                    }
                }

                // Siralama dışında kalan yeni sporcuları son gruba ekle
                const unassignedNew = Object.entries(allAthData)
                    .filter(([id]) => !assignedIds.has(id))
                    .map(([id, data]) => ({ id, ...data }))
                    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
                if (unassignedNew.length > 0) {
                    formattedRotations.push(unassignedNew);
                }

                setAthletesByRotation(formattedRotations);
            } else {
                fallbackUnsub = onValue(athletesRef, (fbSnap) => {
                    const fbData = fbSnap.val();
                    if (fbData) {
                        // Firebase push key'leri kronolojik sıralıdır — ID'ye göre sırala = kayıt sırası
                        const ids = Object.keys(fbData).sort();
                        const arr = ids.map((id, idx) => ({ id, ...fbData[id], _kayitSirasi: idx + 1 }));
                        setAthletesByRotation([arr]);
                    } else {
                        setAthletesByRotation([]);
                    }
                });
            }
        });

        const scoresRef = ref(db, `${firebasePath}/${selectedCompId}/puanlar/${selectedCategory}/${selectedApparatus}`);
        const unsubScores = onValue(scoresRef, (scoreSnap) => {
            setExistingScores(scoreSnap.val() || {});
        });

        return () => {
            unsubOrder();
            unsubScores();
            if (fallbackUnsub) fallbackUnsub();
        };

    }, [selectedCompId, selectedCategory, selectedApparatus]);

    // 5a. Sync lock state reactively when existingScores change
    useEffect(() => {
        if (!selectedAthlete) return;
        const scores = existingScores[selectedAthlete.id];
        setScoreLocked(scores?.kilitli === true);
    }, [existingScores, selectedAthlete?.id]);

    // 5. Sync remote E-panel scores to local state
    useEffect(() => {
        if (!selectedAthlete) return;
        const scores = existingScores[selectedAthlete.id] || {};
        setEPanelLocal(prev => {
            const updated = { ...prev };
            for (let i = 1; i <= 10; i++) {
                const key = `e${i}`;
                if (scores[key] !== undefined && scores[key] !== null && !ePanelTouched[key]) {
                    updated[key] = scores[key];
                }
            }
            return updated;
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [existingScores, selectedAthlete?.id]);

    // 5b. Sync D-score ve diğer alanları Firebase'den yükle (kullanıcı henüz dokunmadıysa)
    // Bu özellikle existingScores sporcu seçildikten sonra geldiğinde formu doldurmak için gerekli
    useEffect(() => {
        if (!selectedAthlete || scoringFieldsTouched) return;
        const scores = existingScores[selectedAthlete.id];
        if (!scores) return;
        // D puanı
        setDScore(scores.dScore ?? scores.calc_D ?? 0);
        // Tarafsız kesinti
        setNeutralDeductions(scores.tarafsiz ?? scores.neutralDeductions ?? 0);
        // Eksik sayısı
        setManualEksikSayisi(scores.eksikSayisi ?? 0);
        // Skill (hareket) puanları
        setSkillScores(scores.hareketler ?? {});
        // Scoring modu
        setScoringMode(scores.scoringMode ?? 'separate');
        setCombinedEDeduction(scores.combinedEDeduction ?? 0);
        // Difficulty modu
        setDifficultyMoves(scores.difficultyMoves ?? {});
        setCrValue(scores.crScore_val ?? 0);
        setCrGroupValues(scores.crGroupValues ?? [0, 0, 0, 0]);
        setCvValue(scores.cvScore_val ?? 0);
        setBtrsValue(scores.btrsScore_val ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [existingScores, selectedAthlete?.id]);

    // Available Cities for Filtering
    const availableCities = useMemo(
        () => [...new Set(Object.values(competitions).map(c => (c.il || c.city || '').toLocaleUpperCase('tr-TR')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr-TR')),
        [competitions]
    );

    // Dropdown Data & Criteria Options
    const compOptions = useMemo(
        () => Object.entries(competitions)
            .filter(([id, comp]) => !selectedCity || (comp.il || comp.city || '').toLocaleUpperCase('tr-TR') === selectedCity)
            .sort((a, b) => new Date(b[1].tarih || b[1].baslangicTarihi || 0) - new Date(a[1].tarih || a[1].baslangicTarihi || 0)),
        [competitions, selectedCity]
    );

    const categoryOptions = useMemo(() => {
        if (!selectedCompId) return [];
        const comp = competitions[selectedCompId];
        // kategoriler ve sporcular'dan gelen kategorileri birleştir
        const catSet = new Set();
        if (comp?.kategoriler) Object.keys(comp.kategoriler).forEach(k => catSet.add(k));
        if (comp?.sporcular) Object.keys(comp.sporcular).forEach(k => catSet.add(k));
        // "undefined" gibi geçersiz key'leri filtrele
        return [...catSet].filter(k => k && k !== 'undefined');
    }, [selectedCompId, competitions]);

    // Yarışma bazlı alet filtreleme
    const compData = selectedCompId ? competitions[selectedCompId] : null;
    const rawAletler = compData?.kategoriler?.[selectedCategory]?.aletler;
    // Firebase array'leri bazen obje olarak gelir ({0: "x", 1: "y"}) — normalize et
    const compAletler = Array.isArray(rawAletler)
        ? rawAletler
        : rawAletler && typeof rawAletler === 'object'
            ? Object.values(rawAletler)
            : [];

    // Criteria kaynağı: liveCriteria (Firebase) → DEFAULT_CRITERIA (fallback)
    const effectiveCriteria = liveCriteria || (selectedCategory ? DEFAULT_CRITERIA[selectedCategory] : null);

    const apparatusOptions = useMemo(() => {
        if (!selectedCategory || !effectiveCriteria) return [];
        const allKeys = Object.keys(effectiveCriteria).filter(key => key !== 'metadata' && key !== 'eksikKesintiTiers');
        // compAletler varsa sadece eşleşenleri göster, yoksa tümünü göster
        // Ek olarak: Aletin "isActive" flag'i false ise gösterme
        let opts = allKeys
            .filter(key => (compAletler.length === 0 || compAletler.includes(key)) && effectiveCriteria[key]?.isActive !== false)
            .map(key => ({ id: key, name: key.charAt(0).toUpperCase() + key.slice(1) }));

        // Eğer compAletler filtresi sonrası boş kaldıysa, sadece aktif olanları filtresiz göster
        if (opts.length === 0 && allKeys.some(key => effectiveCriteria[key]?.isActive !== false)) {
            opts = allKeys
                .filter(key => effectiveCriteria[key]?.isActive !== false)
                .map(key => ({ id: key, name: key.charAt(0).toUpperCase() + key.slice(1) }));
        }
        return opts;
    }, [selectedCategory, effectiveCriteria, compAletler]);

    const currentCriteria = useMemo(() => {
        if (!selectedCategory || !effectiveCriteria || !selectedApparatus) return null;
        return effectiveCriteria[selectedApparatus] || null;
    }, [selectedCategory, effectiveCriteria, selectedApparatus]);

    // D-Score Calculation
    // dScoreMode: Firebase criteria'da varsa onu kullan, yoksa DEFAULT_CRITERIA'dan fallback yap
    const defaultCriteriaForApparatus = useMemo(
        () => selectedCategory && selectedApparatus ? DEFAULT_CRITERIA[selectedCategory]?.[selectedApparatus] : null,
        [selectedCategory, selectedApparatus]
    );
    const dScoreMode = currentCriteria?.dScoreMode || defaultCriteriaForApparatus?.dScoreMode || 'skills'; // 'skills' | 'difficulty'
    // hasDynamicSkills: skills modunda VE en az bir geçerli hareket tanımlıysa (isim veya dValues dolu)
    const hasDynamicSkills = dScoreMode === 'skills' && currentCriteria?.hareketler && currentCriteria.hareketler.length > 0
        && currentCriteria.hareketler.some(h => (h.isim && h.isim.trim() !== '') || (h.dValues && String(h.dValues).trim() !== ''));
    const isDifficultyMode = dScoreMode === 'difficulty';

    // Erkek kategoriler: CR grupları (4 Yapı Grubu)
    const hasCrGroups = !!(defaultCriteriaForApparatus?.crGroups || currentCriteria?.crGroups);
    const crGroupDefs = defaultCriteriaForApparatus?.crGroups || currentCriteria?.crGroups || [];
    // Difficulty mode: max hareket sayısı (eksik kesinti kriterlerdeki eksikKesintiTiers'dan gelir)
    const diffMaxMoves = defaultCriteriaForApparatus?.maxDMoves ?? currentCriteria?.maxDMoves ?? Infinity;

    const calculatedDScore = useMemo(() => {
        if (isDifficultyMode) {
            // Zorluk grubu sistemi: Σ(grup_değeri × adet) + CR + CV + BTRS
            // Eksik eleman kesintisi burada DEĞİL, ayrı missingPenalty bloğunda hesaplanır
            const movesTotal = Object.entries(difficultyMoves).reduce((sum, [group, count]) => {
                return sum + ((parseInt(count) || 0) * (DIFFICULTY_POINTS[group] || 0));
            }, 0);
            // CR: erkek kategoriler → 4 Yapı Grubu toplamı; kız kategoriler → tek crValue
            const effectiveCrTotal = hasCrGroups
                ? crGroupValues.reduce((s, v) => s + (parseFloat(v) || 0), 0)
                : (parseFloat(crValue) || 0);
            return movesTotal + effectiveCrTotal + (parseFloat(cvValue) || 0) + (parseFloat(btrsValue) || 0);
        } else if (hasDynamicSkills) {
            return Object.values(skillScores).reduce((sum, val) => sum + (parseFloat(val) || 0), 0);
        } else {
            return parseFloat(dScore) || 0;
        }
    }, [isDifficultyMode, hasDynamicSkills, difficultyMoves, crValue, crGroupValues, hasCrGroups, cvValue, btrsValue, skillScores, dScore]);

    // Eksik Eleman Kesintisi
    let missingPenalty = 0;
    let missingCount = 0;

    if (isDifficultyMode) {
        // Difficulty modda: toplam hareket sayısı üzerinden eksik hesapla,
        // kesinti miktarı kriterlerdeki eksikKesintiTiers tablosundan gelir (CriteriaPage'den yönetilir)
        const totalMoveCount = Object.values(difficultyMoves).reduce((s, c) => s + (parseInt(c) || 0), 0);
        if (totalMoveCount > 0 && isFinite(diffMaxMoves)) {
            missingCount = Math.max(0, diffMaxMoves - totalMoveCount);
            if (missingCount > 0) {
                const tiers = currentCriteria?.eksikKesintiTiers;
                if (tiers && tiers[missingCount] !== undefined && tiers[missingCount] !== null) {
                    missingPenalty = parseFloat(tiers[missingCount]);
                }
            }
        }
    } else if (hasDynamicSkills && currentCriteria?.eksikKesintiTiers) {
        const moves = currentCriteria.hareketler || [];
        const performedCount = Object.values(skillScores).filter(val => (parseFloat(val) || 0) > 0).length;
        missingCount = Math.max(0, moves.length - performedCount);

        const tiers = currentCriteria.eksikKesintiTiers;
        if (tiers[missingCount] !== undefined && tiers[missingCount] !== null) {
            missingPenalty = parseFloat(tiers[missingCount]);
        }
    } else if (!hasDynamicSkills && !isDifficultyMode && currentCriteria?.eksikKesintiTiers) {
        missingCount = parseInt(manualEksikSayisi) || 0;
        const tiers = currentCriteria.eksikKesintiTiers;
        if (missingCount > 0 && tiers[missingCount] !== undefined && tiers[missingCount] !== null) {
            missingPenalty = parseFloat(tiers[missingCount]);
        }
    }

    // E-Score Calculation
    // Yarışma bazlı hakemSayisi (override) > criteria hakemSayisi > fallback 4
    const effectiveHakemSayisi = compData?.hakemSayisi || currentCriteria?.hakemSayisi || 4;

    const renderEPanels = () => {
        if (!currentCriteria) return [];
        const panels = [];
        for (let i = 1; i <= effectiveHakemSayisi; i++) {
            panels.push(`e${i}`);
        }
        return panels;
    };

    const ePanels = useMemo(() => renderEPanels(), [currentCriteria, effectiveHakemSayisi]); // eslint-disable-line react-hooks/exhaustive-deps
    const avgEDeduction = useMemo(() => {
        // Birleşik modda tek E kesinti değeri kullanılır
        if (scoringMode === 'combined') {
            return parseFloat(combinedEDeduction) || 0;
        }
        // Ayrı modda: hakem puanlarını topla
        let localScores = ePanels
            .map(p => ePanelLocal[p])
            .filter(val => val !== undefined && val !== null && val !== '' && !isNaN(parseFloat(val)))
            .map(val => parseFloat(val));

        if (localScores.length === 0) return 0;

        // FIG kuralı: 4+ hakem varsa en yüksek ve en düşük atılır, kalan ortalaması
        // 3 veya daha az hakem varsa düz ortalama
        if (localScores.length >= 4) {
            localScores.sort((a, b) => a - b);
            // En düşük ve en yüksek atılır
            const trimmed = localScores.slice(1, -1);
            const sum = trimmed.reduce((acc, val) => acc + val, 0);
            return sum / trimmed.length;
        }

        // 3 veya daha az: düz ortalama
        const sum = localScores.reduce((acc, val) => acc + val, 0);
        return sum / localScores.length;
    }, [scoringMode, combinedEDeduction, ePanels, ePanelLocal]);

    const E_SCORE_BASE = 10.0;
    const currentEScore = Math.max(0, E_SCORE_BASE - avgEDeduction);

    // Bonus
    let bonusValue = 0;
    if (currentCriteria?.bonus && currentCriteria.bonus.value > 0) {
        const reqD = parseFloat(currentCriteria.bonus.requiredD || 0);
        const maxE = parseFloat(currentCriteria.bonus.maxE !== undefined ? currentCriteria.bonus.maxE : 10);
        const eDed = E_SCORE_BASE - currentEScore;
        if (calculatedDScore >= reqD && eDed <= maxE) {
            bonusValue = parseFloat(currentCriteria.bonus.value);
        }
    }

    // Final Score
    const tarafsizKesinti = parseFloat(neutralDeductions) || 0;
    // D puanı 0 ise sporcu puanı da 0 olur
    const finalScore = calculatedDScore === 0
        ? '0.000'
        : Math.max(0, calculatedDScore + currentEScore - missingPenalty - tarafsizKesinti + bonusValue).toFixed(3);

    // Handlers
    const handleSelectAthlete = (athlete) => {
        if (selectedAthlete?.id === athlete.id) return;

        // Check if this athlete's score is locked
        const prevScore = existingScores[athlete.id];
        const isLocked = prevScore?.kilitli === true;

        setSelectedAthlete(athlete);
        setIsAthleteCalled(false);
        setScoreLocked(isLocked);

        if (selectedAthlete && isAthleteCalled) {
            update(ref(db, `${firebasePath}/${selectedCompId}/aktifSporcu/${selectedCategory}/${selectedApparatus}`), null);
        }

        if (prevScore) {
            setDScore(prevScore.dScore || prevScore.calc_D || 0);
            setNeutralDeductions(prevScore.tarafsiz || prevScore.neutralDeductions || 0);
            setManualEksikSayisi(prevScore.eksikSayisi || 0);
            setSkillScores(prevScore.hareketler || {});
            // Kaydedilmiş scoring mode ve combined E değerini geri yükle
            setScoringMode(prevScore.scoringMode || 'separate');
            setCombinedEDeduction(prevScore.combinedEDeduction || 0);
            // Difficulty mode state geri yükle
            setDifficultyMoves(prevScore.difficultyMoves || {});
            setCrValue(prevScore.crScore_val || 0);
            setCrGroupValues(prevScore.crGroupValues || [0, 0, 0, 0]);
            setCvValue(prevScore.cvScore_val || 0);
            setBtrsValue(prevScore.btrsScore_val || 0);
            const panels = {};
            for (let i = 1; i <= 10; i++) {
                const key = `e${i}`;
                if (prevScore[key] !== undefined && prevScore[key] !== null) {
                    panels[key] = prevScore[key];
                }
            }
            setEPanelLocal(panels);
        } else {
            resetScoringPanel();
        }
        setEPanelTouched({});
        setScoringFieldsTouched(false);
    };

    const resetScoringPanel = () => {
        setDScore(0);
        setSkillScores({});
        setNeutralDeductions(0);
        setManualEksikSayisi(0);
        setEPanelLocal({});
        setEPanelTouched({});
        setScoringMode('separate');
        setCombinedEDeduction(0);
        setScoreLocked(false);
        setScoringFieldsTouched(false);
        // Difficulty mode reset
        setDifficultyMoves({});
        setCrValue(0);
        setCrGroupValues([0, 0, 0, 0]);
        setCvValue(0);
        setBtrsValue(0);
    };

    // Kilit açma — super admin veya komite şifresi ile
    const handleUnlockRequest = () => {
        if (!selectedAthlete) return;
        setUnlockModal({
            athleteId: selectedAthlete.id,
            athleteName: `${selectedAthlete.ad} ${selectedAthlete.soyad}`
        });
        setUnlockPassword('');
        setUnlockError('');
    };

    const handleUnlockSubmit = async () => {
        if (!unlockPassword.trim()) {
            setUnlockError('Şifre giriniz.');
            return;
        }
        setUnlockingInProgress(true);
        setUnlockError('');
        try {
            // Komite şifresini yarışmadan veya genel ayarlardan kontrol et
            const compKomiteSnap = await get(ref(db, `${firebasePath}/${selectedCompId}/komiteSifresi`));
            const globalKomiteSnap = await get(ref(db, 'ayarlar/komiteSifresi'));
            const komiteSifre = compKomiteSnap.val() || globalKomiteSnap.val();

            // Tüm kullanıcı şifrelerini kontrol et (super admin dahil)
            const usersSnap = await get(ref(db, 'kullanicilar'));
            const usersData = usersSnap.val() || {};

            const inputPwd = unlockPassword.trim();
            const inputHash = await hashPassword(inputPwd);

            // Komite şifresi kontrolü — timing-safe karşılaştırma (side-channel önlemi)
            const isKomiteMatch = komiteSifre && (() => {
                const a = String(inputPwd), b = String(komiteSifre);
                if (a.length !== b.length) return false;
                let diff = 0;
                for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
                return diff === 0;
            })();

            // Kullanıcı şifresi kontrolü (hash veya düz metin)
            let isUserMatch = false;
            for (const [, userData] of Object.entries(usersData)) {
                if (userData.sifreHash && inputHash === userData.sifreHash) {
                    isUserMatch = true;
                    break;
                }
                if (userData.sifre && inputPwd === userData.sifre) {
                    isUserMatch = true;
                    break;
                }
            }

            if (isKomiteMatch || isUserMatch) {
                // Kilidi kaldır
                const scorePath = `${firebasePath}/${selectedCompId}/puanlar/${selectedCategory}/${selectedApparatus}/${unlockModal.athleteId}`;
                await offlineWrite({ [scorePath + '/kilitli']: false });
                setScoreLocked(false);
                setUnlockModal(null);
                toast('Puan kilidi kaldırıldı. Düzenleme yapabilirsiniz.', 'success');
                logAction('score_unlock', `${unlockModal.athleteName} — puan kilidi kaldırıldı`, {
                    user: currentUser?.kullaniciAdi || 'admin',
                    competitionId: selectedCompId,
                });
            } else {
                setUnlockError('Şifre hatalı. Süper Admin veya Komite şifresi gereklidir.');
            }
        } catch (err) {
            console.error('Unlock error:', err);
            setUnlockError('Bir hata oluştu. Tekrar deneyin.');
        } finally {
            setUnlockingInProgress(false);
        }
    };

    const isSuperAdminUser = () => {
        return currentUser?.rolAdi === 'Super Admin' || currentUser?.kullaniciAdi === 'admin';
    };

    const handleCallAthlete = async () => {
        setIsAthleteCalled(true);
        try {
            await update(ref(db), {
                [`${firebasePath}/${selectedCompId}/aktifSporcu/${selectedCategory}/${selectedApparatus}`]: selectedAthlete.id
            });
        } catch (e) { console.error("Could not set active athlete", e); }
    };

    // Sonraki sporcuyu bul
    const getNextAthlete = () => {
        if (!selectedAthlete || athletesByRotation.length === 0) return null;
        const allAthletes = athletesByRotation.flat();
        const currentIdx = allAthletes.findIndex(a => a.id === selectedAthlete.id);
        if (currentIdx === -1 || currentIdx >= allAthletes.length - 1) return null;
        return allAthletes[currentIdx + 1];
    };

    const handleSubmitScore = async () => {
        if (!selectedAthlete) return toast("Lütfen puanlamak için bir sporcu seçin.", "warning");
        if (scoreLocked) return toast("Bu sporcunun puanı kilitli. Düzenlemek için kilidi açın.", "warning");

        // Skor sınır doğrulaması
        const dVal = calculatedDScore;
        const finalVal = parseFloat(finalScore);
        if (dVal < 0 || dVal > 30) {
            return toast("D puanı 0-30 arasında olmalıdır.", "error");
        }
        if (isNaN(finalVal) || finalVal < 0 || finalVal > 40) {
            return toast("Final puanı geçersiz (0-40 arası olmalı).", "error");
        }
        if (scoringMode === 'combined') {
            const eVal = parseFloat(combinedEDeduction) || 0;
            if (eVal < 0 || eVal > 10) {
                return toast("E kesintisi 0-10 arasında olmalıdır.", "error");
            }
        }
        // Ayrı modda en az bir E paneli girilmiş olmalı
        if (scoringMode === 'separate') {
            const filledEPanels = ePanels.filter(p => {
                const val = ePanelLocal[p];
                return val !== undefined && val !== null && val !== '' && !isNaN(parseFloat(val));
            });
            if (filledEPanels.length === 0) {
                return toast("E puanı girilmeden kayıt yapılamaz.", "error");
            }
        }

        // Özel onay popup'ı göster
        setConfirmModal({
            athlete: selectedAthlete,
            dScore: calculatedDScore,
            eScore: currentEScore,
            missingPen: missingPenalty,
            neutralPen: tarafsizKesinti,
            bonus: bonusValue,
            finalScore: finalScore,
            apparatus: apparatusOptions.find(a => a.id === selectedApparatus)?.name || selectedApparatus
        });
    };

    const executeScoreSave = async () => {
        const savedAthlete = confirmModal.athlete;
        setConfirmModal(null);
        setIsSubmitting(true);
        try {
            const scorePath = `${firebasePath}/${selectedCompId}/puanlar/${selectedCategory}/${selectedApparatus}/${savedAthlete.id}`;
            const activePath = `${firebasePath}/${selectedCompId}/aktifSporcu/${selectedCategory}/${selectedApparatus}`;
            const flashPath = `${firebasePath}/${selectedCompId}/flashTrigger`;
            const ts = new Date().toISOString();

            // Ayrı modda E-panel verilerini kaydet, birleşik modda kaydetme
            const ePanelSaveData = {};
            if (scoringMode === 'separate') {
                ePanels.forEach(p => {
                    const val = ePanelLocal[p];
                    if (val !== undefined && val !== null && val !== '') {
                        ePanelSaveData[scorePath + '/' + p] = parseFloat(val);
                    }
                });
            }

            // Difficulty mode ek verileri
            const effectiveCrSaveTotal = hasCrGroups
                ? crGroupValues.reduce((s, v) => s + (parseFloat(v) || 0), 0)
                : parseFloat(crValue) || 0;
            const difficultyData = isDifficultyMode ? {
                [scorePath + '/dScoreMode']: 'difficulty',
                [scorePath + '/difficultyMoves']: difficultyMoves,
                [scorePath + '/crScore_val']: effectiveCrSaveTotal,
                [scorePath + '/crGroupValues']: hasCrGroups ? crGroupValues : null,
                [scorePath + '/cvScore_val']: parseFloat(cvValue) || 0,
                [scorePath + '/btrsScore_val']: parseFloat(btrsValue) || 0,
            } : {
                [scorePath + '/dScoreMode']: 'skills',
            };

            await offlineWrite({
                ...ePanelSaveData,
                ...difficultyData,
                [scorePath + '/scoringMode']: scoringMode,
                [scorePath + '/combinedEDeduction']: scoringMode === 'combined' ? parseFloat(combinedEDeduction) || 0 : null,
                [scorePath + '/dScore']: calculatedDScore,
                [scorePath + '/calc_D']: calculatedDScore,
                [scorePath + '/calc_E']: currentEScore,
                [scorePath + '/calc_MissingPen']: missingPenalty,
                [scorePath + '/calc_Bonus']: bonusValue,
                [scorePath + '/tarafsiz']: tarafsizKesinti,
                [scorePath + '/neutralDeductions']: tarafsizKesinti,
                [scorePath + '/eksikSayisi']: missingCount,
                [scorePath + '/sonuc']: parseFloat(finalScore),
                [scorePath + '/timestamp']: ts,
                [scorePath + '/durum']: "tamamlandi",
                [scorePath + '/kilitli']: true,
                [scorePath + '/hareketler']: isDifficultyMode ? null : skillScores,
                [activePath]: null,
                [flashPath]: {
                    adSoyad: `${savedAthlete.ad} ${savedAthlete.soyad}`,
                    kulup: savedAthlete.okul || savedAthlete.kulup,
                    aletAd: apparatusOptions.find(a => a.id === selectedApparatus)?.name || selectedApparatus,
                    d: calculatedDScore,
                    e: currentEScore,
                    pen: missingPenalty + tarafsizKesinti,
                    total: finalScore,
                    timestamp: Date.now()
                }
            });

            // Audit log
            logAction('score_create', `${savedAthlete.ad} ${savedAthlete.soyad} — ${apparatusOptions.find(a => a.id === selectedApparatus)?.name || selectedApparatus}: ${finalScore}`, {
                user: currentUser?.kullaniciAdi || 'admin',
                competitionId: selectedCompId,
            });

            // Kayıt tamamlandı — form state'ini temizle (bir sonraki sporcu için temiz başlangıç)
            resetScoringPanel();

            // Başarılı — sonraki sporcu modal'ı göster
            const nextAth = getNextAthlete();
            setSuccessModal({
                athlete: savedAthlete,
                finalScore: finalScore,
                dScore: calculatedDScore,
                eScore: currentEScore,
                apparatus: apparatusOptions.find(a => a.id === selectedApparatus)?.name || selectedApparatus,
                nextAthlete: nextAth
            });

        } catch (error) {
            if (import.meta.env.DEV) console.error('Score save error:', error);
            toast("Puan kaydedilirken bir hata oluştu.", "error");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleNextAthlete = (nextAth) => {
        setSuccessModal(null);
        resetScoringPanel();
        handleSelectAthlete(nextAth);
        // Otomatik çağır — kullanıcı tekrar "Çağır" butonuna basmasın
        setIsAthleteCalled(true);
        update(ref(db), {
            [`${firebasePath}/${selectedCompId}/aktifSporcu/${selectedCategory}/${selectedApparatus}`]: nextAth.id
        }).catch(e => console.error("Could not set active athlete", e));
    };

    return (
        <div className="scoring-page-light">
            <header className="scoring-header-light">
                <div className="sh-left">
                    <button className="btn-back-light" onClick={() => navigate(routePrefix)}>
                        <i className="material-icons-round">home</i>
                    </button>
                    <div>
                        <h1>Hakem Puanlama</h1>
                        <p className="text-subtitle">Puanlama Paneli</p>
                    </div>
                </div>
                <div className="sh-right">
                    {selectedAthlete && isAthleteCalled && (
                        <div className="live-badge">
                            <div className="pulse-dot"></div>
                            <span>CANLI PUANLAMA</span>
                        </div>
                    )}
                    <button className="btn-toggle-sidebar" onClick={() => setSidebarOpen(prev => !prev)}>
                        <i className="material-icons-round">{sidebarOpen ? 'menu_open' : 'menu'}</i>
                    </button>
                </div>
            </header>

            <div className="scoring-layout">
                {/* Left Sidebar: Controls & Roster */}
                <aside className={`scoring-sidebar-light ${!sidebarOpen ? 'sidebar-collapsed' : ''}`}>
                    <div className="sidebar-controls">
                        <select className="premium-select" value={selectedCity} onChange={e => { setSelectedCity(e.target.value); setSelectedCompId(''); setSelectedCategory(''); setSelectedApparatus(''); setSelectedAthlete(null); }}>
                            <option value="">Tüm İller</option>
                            {availableCities.map(city => <option key={city} value={city}>{city}</option>)}
                        </select>
                        <select className="premium-select" value={selectedCompId} onChange={e => { setSelectedCompId(e.target.value); setSelectedCategory(''); setSelectedApparatus(''); setSelectedAthlete(null); }}>
                            <option value="">Yarışma Seçin</option>
                            {compOptions.map(([id, comp]) => <option key={id} value={id}>{comp.isim}</option>)}
                        </select>
                        <select className="premium-select" value={selectedCategory} onChange={e => { setSelectedCategory(e.target.value); setSelectedApparatus(''); setSelectedAthlete(null); }} disabled={!selectedCompId}>
                            <option value="">Kategori Seçin</option>
                            {categoryOptions.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                        <select className="premium-select" value={selectedApparatus} onChange={e => { setSelectedApparatus(e.target.value); setSelectedAthlete(null); }} disabled={!selectedCategory}>
                            <option value="">Alet Seçin</option>
                            {apparatusOptions.map(app => <option key={app.id} value={app.id}>{app.name}</option>)}
                        </select>
                    </div>

                    {/* Puanlama Modu Toggle — sadece kategori seçildiyse göster */}
                    {selectedCategory && <div className="scoring-mode-section">
                        <div className="mode-label">Puanlama Modu</div>
                        <div className="scoring-mode-toggle">
                            <button
                                className={`mode-btn ${scoringMode === 'separate' ? 'active' : ''}`}
                                onClick={() => setScoringMode('separate')}
                            >
                                <i className="material-icons-round" style={{ fontSize: '1rem' }}>view_column</i>
                                Ayrı (D + E)
                            </button>
                            <button
                                className={`mode-btn ${scoringMode === 'combined' ? 'active' : ''}`}
                                onClick={() => setScoringMode('combined')}
                            >
                                <i className="material-icons-round" style={{ fontSize: '1rem' }}>join_full</i>
                                Birleşik (D &amp; E)
                            </button>
                        </div>
                    </div>}

                    <div className="roster-container">
                        {!selectedApparatus ? (
                            <div className="roster-empty">
                                <i className="material-icons-round">touch_app</i>
                                <p>Lütfen puanlanacak yarışma, kategori ve aleti seçin.</p>
                            </div>
                        ) : (
                            <div className="roster-list">
                                <h3 className="section-title-light">Çıkış Sırası</h3>
                                <div className="athlete-search-box">
                                    <i className="material-icons-round athlete-search-icon">search</i>
                                    <input
                                        type="text"
                                        className="athlete-search-input"
                                        placeholder="Sporcu ara..."
                                        value={athleteSearch}
                                        onChange={e => setAthleteSearch(e.target.value)}
                                    />
                                    {athleteSearch && (
                                        <button className="athlete-search-clear" onClick={() => setAthleteSearch('')}>
                                            <i className="material-icons-round">close</i>
                                        </button>
                                    )}
                                </div>
                                {athletesByRotation.length === 0 && <p className="text-muted">Bu kategori için çıkış sırası bulunamadı.</p>}

                                {athletesByRotation.map((rotation, rIdx) => {
                                    const searchTerm = athleteSearch.toLocaleLowerCase('tr-TR');
                                    const filteredRotation = searchTerm
                                        ? rotation.filter(ath => `${ath.ad} ${ath.soyad}`.toLocaleLowerCase('tr-TR').includes(searchTerm) || (ath.okul || '').toLocaleLowerCase('tr-TR').includes(searchTerm))
                                        : rotation;
                                    return filteredRotation.length > 0 && (
                                        <div key={rIdx} className="roster-group">
                                            <div className="rg-title">Rotasyon {rIdx + 1}</div>
                                            {filteredRotation.map(ath => {
                                                const isSelected = selectedAthlete?.id === ath.id;
                                                const scoreData = existingScores[ath.id];
                                                const hasScore = scoreData && (scoreData.sonuc !== undefined || scoreData.finalScore !== undefined || scoreData.durum === 'tamamlandi');
                                                const isLockedScore = scoreData?.kilitli === true;
                                                const finalDisplay = scoreData ? parseFloat(scoreData.sonuc ?? scoreData.finalScore ?? 0).toFixed(3) : "0.000";

                                                return (
                                                    <div
                                                        key={ath.id}
                                                        className={`roster-athlete ${isSelected ? 'selected' : ''} ${hasScore ? 'scored' : ''}`}
                                                        onClick={() => handleSelectAthlete(ath)}
                                                    >
                                                        <div className="ra-info">
                                                            <span className="ra-order">{ath.sirasi || ath.cikisSirasi || ath._kayitSirasi || ''}.</span>
                                                            <span className="ra-name">{ath.ad} {ath.soyad}</span>
                                                        </div>
                                                        {hasScore ? (
                                                            <div className={`ra-score-badge success-glow ${isLockedScore ? 'locked' : ''}`}>
                                                                {isLockedScore && <i className="material-icons-round ra-lock-icon">lock</i>}
                                                                {finalDisplay}
                                                            </div>
                                                        ) : (
                                                            <div className="ra-status-badge pending">Bekliyor</div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </aside>

                {/* Right Area: Active Scoring Panel */}
                <main className="scoring-main-light">
                    {!selectedAthlete ? (
                        <div className="main-empty">
                            <div className="empty-icon"><i className="material-icons-round">sports_gymnastics</i></div>
                            <h2>Puanlamaya Hazır</h2>
                            <p>Puanlamaya başlamak için sol taraftaki listeden sıradaki sporcuyu seçin.</p>
                        </div>
                    ) : !isAthleteCalled ? (
                        /* CALL ATHLETE STATE */
                        <div className="call-athlete-view animate-zoom-in">
                            <div className="ca-athlete-card">
                                <h3>Sıradaki Sporcu</h3>
                                <h1>{selectedAthlete.ad} {selectedAthlete.soyad}</h1>
                                <p className="ca-club">{selectedAthlete.okul || selectedAthlete.kulup || '{Kulüp Bilgisi Yok}'}</p>
                                <div className="ca-meta">
                                    <span className="ca-badge">Sıra: {selectedAthlete.sirasi || selectedAthlete.cikisSirasi}</span>
                                    <span className="ca-badge">Alet: {apparatusOptions.find(a => a.id === selectedApparatus)?.name}</span>
                                </div>
                            </div>
                            <button className="btn-call-athlete" onClick={handleCallAthlete}>
                                <i className="material-icons-round">campaign</i>
                                Sporcuyu Çağır ve Puanla
                            </button>
                        </div>
                    ) : (
                        /* ACTIVE SCORING STATE */
                        <div className={`active-scoring-panel animate-slide-up${scoreLocked ? ' scoring-panel-locked' : ''}`}>

                            <div className="athlete-header-card">
                                <div className="avatar-gradient">{selectedAthlete.ad.charAt(0)}{selectedAthlete.soyad.charAt(0)}</div>
                                <div className="aah-details">
                                    <h2>{selectedAthlete.ad} {selectedAthlete.soyad}</h2>
                                    <p className="text-subtitle">{selectedAthlete.okul || selectedAthlete.kulup} &bull; Alet: {apparatusOptions.find(a => a.id === selectedApparatus)?.name}</p>
                                </div>
                                {existingScores[selectedAthlete.id] && (
                                    scoreLocked ? (
                                        <div className="score-lock-banner">
                                            <i className="material-icons-round">lock</i>
                                            <span>Puan Kilitli</span>
                                            <button className="btn-unlock" onClick={handleUnlockRequest}>
                                                <i className="material-icons-round">lock_open</i> Kilidi Aç
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="score-override-warning">
                                            <i className="material-icons-round">warning</i> Önceki Puan Değiştiriliyor
                                        </div>
                                    )
                                )}
                            </div>

                            <div className="scoring-grid">
                                {/* D-Score Panel */}
                                <div className={`score-card card-blue ${isDifficultyMode ? 'card-difficulty-wide' : ''}`}>
                                    <div className="sc-header card-header-blue">
                                        <h3>D-Puanı (Zorluk)</h3>
                                        {isDifficultyMode && <span className="mode-indicator-badge difficulty-badge">Zorluk Grubu</span>}
                                        <i className="material-icons-round">emoji_events</i>
                                    </div>
                                    <div className="sc-body">
                                        {isDifficultyMode ? (
                                            /* === DIFFICULTY GROUP MODE (Yıldız/Genç) === */
                                            <div className="difficulty-mode-panel">
                                                <div className="difficulty-table-wrapper">
                                                    <table className="difficulty-table">
                                                        <thead>
                                                            <tr>
                                                                <th>Grup</th>
                                                                <th>Puan</th>
                                                                {[...Array(MAX_MOVES_PER_GROUP + 1)].map((_, i) => (
                                                                    <th key={i}>{i}</th>
                                                                ))}
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {DIFFICULTY_GROUPS.map(group => {
                                                                const selectedCount = difficultyMoves[group] || 0;
                                                                const totalMoveCount = Object.values(difficultyMoves).reduce((s, c) => s + (parseInt(c) || 0), 0);
                                                                return (
                                                                    <tr key={group}>
                                                                        <td className="diff-group-label"><strong>{group}</strong></td>
                                                                        <td className="diff-point-label">{DIFFICULTY_POINTS[group].toFixed(1)}</td>
                                                                        {[...Array(MAX_MOVES_PER_GROUP + 1)].map((_, i) => {
                                                                            const wouldExceed = isFinite(diffMaxMoves) && i > selectedCount && (totalMoveCount - selectedCount + i) > diffMaxMoves;
                                                                            return (
                                                                                <td key={i}>
                                                                                    <button
                                                                                        className={`diff-count-btn ${selectedCount === i ? 'diff-selected' : ''} ${wouldExceed ? 'diff-count-btn--disabled' : ''}`}
                                                                                        onClick={() => !wouldExceed && setDifficultyMoves(prev => ({ ...prev, [group]: i }))}
                                                                                        disabled={wouldExceed}
                                                                                        title={wouldExceed ? `Maksimum ${diffMaxMoves} hareket sınırına ulaşıldı` : ''}
                                                                                    >
                                                                                        {i}
                                                                                    </button>
                                                                                </td>
                                                                            );
                                                                        })}
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>

                                                {/* Hareket Puanı Toplamı + Sayaç */}
                                                {(() => {
                                                    const movesTotal = Object.entries(difficultyMoves).reduce((sum, [g, c]) => sum + ((parseInt(c) || 0) * (DIFFICULTY_POINTS[g] || 0)), 0);
                                                    const totalMoveCount = Object.values(difficultyMoves).reduce((s, c) => s + (parseInt(c) || 0), 0);
                                                    return (
                                                        <div className="diff-subtotal">
                                                            <span>Hareket Puanı: <strong>{movesTotal.toFixed(2)}</strong></span>
                                                            {isFinite(diffMaxMoves) && (
                                                                <span className={`diff-move-counter ${totalMoveCount >= diffMaxMoves ? 'diff-move-counter--full' : totalMoveCount > 0 ? 'diff-move-counter--partial' : ''}`}>
                                                                    {totalMoveCount}/{diffMaxMoves} hareket
                                                                </span>
                                                            )}
                                                        </div>
                                                    );
                                                })()}

                                                {/* CR - Kompozisyon Gereksinimi */}
                                                {hasCrGroups ? (
                                                    /* Erkek kategoriler: 4 Yapı Grubu */
                                                    crGroupDefs.map((group, idx) => (
                                                        <div key={idx} className="diff-component-section">
                                                            <label className="diff-comp-label">{group.label}</label>
                                                            <div className="diff-option-btns">
                                                                {group.options.map(val => (
                                                                    <button
                                                                        key={val}
                                                                        className={`diff-opt-btn ${parseFloat(crGroupValues[idx]) === val ? 'diff-opt-selected' : ''}`}
                                                                        onClick={() => {
                                                                            const next = [...crGroupValues];
                                                                            next[idx] = val;
                                                                            setCrGroupValues(next);
                                                                        }}
                                                                    >
                                                                        {Number(val).toFixed(1)}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))
                                                ) : (
                                                    /* Kız kategoriler: tek CR alanı */
                                                    <div className="diff-component-section">
                                                        <label className="diff-comp-label">CR (Kompozisyon Gereksinimi)</label>
                                                        <div className="diff-option-btns">
                                                            {(defaultCriteriaForApparatus?.crOptions || currentCriteria?.crOptions || [0, 0.5, 1.0, 1.5, 2.0]).map(val => (
                                                                <button
                                                                    key={val}
                                                                    className={`diff-opt-btn ${parseFloat(crValue) === val ? 'diff-opt-selected' : ''}`}
                                                                    onClick={() => setCrValue(val)}
                                                                >
                                                                    {Number(val).toFixed(1)}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* CV - Bağlantı Değeri */}
                                                <div className="diff-component-section">
                                                    <label className="diff-comp-label">CV (Bağlantı Değeri)</label>
                                                    <div className="diff-option-btns cv-scroll">
                                                        {(defaultCriteriaForApparatus?.cvOptions || currentCriteria?.cvOptions || [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5]).map(val => (
                                                            <button
                                                                key={val}
                                                                className={`diff-opt-btn ${parseFloat(cvValue) === val ? 'diff-opt-selected' : ''}`}
                                                                onClick={() => setCvValue(val)}
                                                            >
                                                                {Number(val).toFixed(1)}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* BTRS */}
                                                <div className="diff-component-section">
                                                    <label className="diff-comp-label">BTRS</label>
                                                    <div className="diff-option-btns">
                                                        {(defaultCriteriaForApparatus?.btrsOptions || currentCriteria?.btrsOptions || [0, 0.2]).map(val => (
                                                            <button
                                                                key={val}
                                                                className={`diff-opt-btn ${parseFloat(btrsValue) === val ? 'diff-opt-selected' : ''}`}
                                                                onClick={() => setBtrsValue(val)}
                                                            >
                                                                {Number(val).toFixed(1)}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* Toplam D-Puanı */}
                                                <div className="diff-total-display">
                                                    <span>Toplam D-Puanı</span>
                                                    <strong>{calculatedDScore.toFixed(2)}</strong>
                                                </div>

                                                <button className="btn-quick-blue clear-btn" style={{ marginTop: '0.5rem', width: '100%' }} onClick={() => { setDifficultyMoves({}); setCrValue(0); setCrGroupValues([0,0,0,0]); setCvValue(0); setBtrsValue(0); }}>
                                                    <i className="material-icons-round" style={{ fontSize: '1rem', verticalAlign: 'middle', marginRight: 4 }}>refresh</i> D-Puanını Sıfırla
                                                </button>
                                            </div>
                                        ) : hasDynamicSkills ? (
                                            <div className="dynamic-skills-list">
                                                {currentCriteria.hareketler.map(skill => {
                                                    const dVals = String(skill.dValues).split(',').map(v => v.trim()).filter(v => v !== '');
                                                    return (
                                                        <div key={skill.id} className="skill-row">
                                                            <div className="skill-name">{skill.isim || 'Hareket'}</div>
                                                            <div className="skill-btn-group">
                                                                <button
                                                                    className={`skill-val-btn ${(!skillScores[skill.id] || Number(skillScores[skill.id]) === 0) ? 'selected' : ''}`}
                                                                    onClick={() => setSkillScores(prev => ({ ...prev, [skill.id]: 0 }))}
                                                                >
                                                                    0.0
                                                                </button>
                                                                {dVals.map(v => (
                                                                    <button
                                                                        key={v}
                                                                        className={`skill-val-btn ${String(skillScores[skill.id]) === String(v) ? 'selected' : ''}`}
                                                                        onClick={() => setSkillScores(prev => ({ ...prev, [skill.id]: v }))}
                                                                    >
                                                                        {v}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                <div className="dynamic-score-display">
                                                    Toplam D: {calculatedDScore.toFixed(2)}
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="d-input-wrapper">
                                                    <input
                                                        type="number"
                                                        step="0.1"
                                                        min="0"
                                                        value={dScore}
                                                        onChange={e => { setDScore(e.target.value); setScoringFieldsTouched(true); }}
                                                        className="giant-num-input input-blue"
                                                    />
                                                </div>
                                                <div className="quick-d-buttons">
                                                    {[2.0, 2.5, 3.0, 3.5, 4.0, 4.5].map(val => (
                                                        <button key={val} className="btn-quick-blue" onClick={() => { setDScore(val); setScoringFieldsTouched(true); }}>
                                                            {val.toFixed(1)}
                                                        </button>
                                                    ))}
                                                    <button className="btn-quick-blue clear-btn" onClick={() => { setDScore(0); setScoringFieldsTouched(true); }}>Sıfırla</button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* E-Score Panel */}
                                <div className="score-card card-green">
                                    <div className="sc-header card-header-green">
                                        <h3>{scoringMode === 'combined' ? 'E-Puanı (Uygulama Kesintisi)' : 'E-Puanı Yönetimi'}</h3>
                                        {scoringMode === 'combined' && (
                                            <span className="mode-indicator-badge">Birleşik</span>
                                        )}
                                    </div>
                                    <div className="sc-body e-panel-body">
                                        {scoringMode === 'combined' ? (
                                            /* Birleşik mod: Tek E kesinti input'u */
                                            <>
                                                <div className="combined-e-wrapper">
                                                    <label className="combined-e-label">Toplam E Kesintisi</label>
                                                    <div className="d-input-wrapper">
                                                        <input
                                                            type="number"
                                                            step="0.1"
                                                            min="0"
                                                            value={combinedEDeduction}
                                                            onChange={e => setCombinedEDeduction(e.target.value)}
                                                            className="giant-num-input input-green"
                                                            placeholder="0.0"
                                                        />
                                                    </div>
                                                    <div className="combined-e-quick-btns">
                                                        {[0.5, 1.0, 1.5, 2.0, 2.5, 3.0].map(val => (
                                                            <button key={val} className="btn-quick-green" onClick={() => setCombinedEDeduction(val)}>
                                                                {val.toFixed(1)}
                                                            </button>
                                                        ))}
                                                        <button className="btn-quick-green clear-btn-green" onClick={() => setCombinedEDeduction(0)}>Sıfırla</button>
                                                    </div>
                                                </div>
                                                <div className="e-summary">
                                                    <span className="sum-label">Kesinti: <strong className="text-orange">-{avgEDeduction.toFixed(2)}</strong></span>
                                                    <span className="sum-label">Net E-Puanı: <strong className="text-green">{currentEScore.toFixed(3)}</strong></span>
                                                </div>
                                            </>
                                        ) : (
                                            /* Ayrı mod: Çoklu hakem panelleri */
                                            <>
                                                <div className="collaborative-panels">
                                                    {ePanels.map(panelId => {
                                                        const localVal = ePanelLocal[panelId];
                                                        const hasVal = localVal !== undefined && localVal !== null && localVal !== '';
                                                        const isTouched = ePanelTouched[panelId];
                                                        // Yarışmada atanmış hakem adını göster (yeni format: {id,name} | eski: string)
                                                        const assignedRef = compData?.hakemler?.[selectedCategory]?.[selectedApparatus]?.[panelId];
                                                        const panelLabel = assignedRef ? (typeof assignedRef === 'object' ? assignedRef.name : String(assignedRef)) || panelId.toUpperCase() : panelId.toUpperCase();
                                                        return (
                                                            <div key={panelId} className={`ref-panel-status ${hasVal ? 'status-ready' : 'status-waiting'} ${isTouched ? 'status-edited' : ''}`}>
                                                                <div className="rp-name" title={assignedRef?.name || panelId.toUpperCase()}>{panelLabel}</div>
                                                                <input
                                                                    type="number"
                                                                    step="0.1"
                                                                    min="0"
                                                                    value={hasVal ? localVal : ''}
                                                                    placeholder="—"
                                                                    className="rp-input"
                                                                    onChange={e => {
                                                                        const val = e.target.value;
                                                                        setEPanelLocal(prev => ({ ...prev, [panelId]: val }));
                                                                        setEPanelTouched(prev => ({ ...prev, [panelId]: true }));
                                                                    }}
                                                                />
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                <div className="e-summary">
                                                    {(() => {
                                                        const filledCount = ePanels.filter(p => ePanelLocal[p] !== undefined && ePanelLocal[p] !== null && ePanelLocal[p] !== '' && !isNaN(parseFloat(ePanelLocal[p]))).length;
                                                        return filledCount >= 4 ? (
                                                            <span className="sum-label trim-info"><i className="material-icons-round" style={{fontSize:'0.85rem',verticalAlign:'middle',marginRight:2}}>info</i>En yüksek ve en düşük atıldı</span>
                                                        ) : null;
                                                    })()}
                                                    <span className="sum-label">Ort. Kesinti: <strong className="text-orange">-{avgEDeduction.toFixed(2)}</strong></span>
                                                    <span className="sum-label">Net E-Puanı: <strong className="text-green">{currentEScore.toFixed(3)}</strong></span>
                                                </div>

                                                <div className="e-panel-actions">
                                                    <button className="btn-outline-gray" onClick={() => { setEPanelLocal({}); setEPanelTouched({}); }}>
                                                        <i className="material-icons-round" style={{ fontSize: '1rem', marginRight: '0.25rem', verticalAlign: 'middle' }}>refresh</i>
                                                        Panelleri Sıfırla
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Eksik Eleman Kesintisi */}
                                <div className="score-card card-orange">
                                    <div className="sc-header card-header-orange">
                                        <h3>Eksik Eleman Kesintisi</h3>
                                    </div>
                                    <div className="sc-body">
                                        {(hasDynamicSkills || isDifficultyMode) ? (
                                            <div className="eksik-auto-display">
                                                <div className="eksik-info-row">
                                                    <span className="eksik-label">Eksik Hareket:</span>
                                                    <span className={`eksik-value ${missingCount > 0 ? 'text-danger' : 'text-success'}`}>
                                                        {isDifficultyMode
                                                            ? (missingCount > 0 ? `${missingCount} hareket eksik (${Object.values(difficultyMoves).reduce((s,c)=>s+(parseInt(c)||0),0)}/${diffMaxMoves})` : `${diffMaxMoves}/${diffMaxMoves} — Tam`)
                                                            : (missingCount > 0 ? `${missingCount} hareket eksik` : 'Tümü yapıldı')
                                                        }
                                                    </span>
                                                </div>
                                                <div className="eksik-info-row">
                                                    <span className="eksik-label">Kesinti:</span>
                                                    <span className={`eksik-penalty ${missingPenalty > 0 ? 'badge-missing' : ''}`}>
                                                        {missingPenalty > 0 ? `-${missingPenalty.toFixed(2)}` : '0'}
                                                    </span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="eksik-manual-input">
                                                <label className="eksik-input-label">Eksik Eleman Sayısı:</label>
                                                <div className="eksik-input-row">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="1"
                                                        value={manualEksikSayisi}
                                                        onChange={e => setManualEksikSayisi(e.target.value)}
                                                        className="med-num-input input-orange"
                                                        placeholder="0"
                                                    />
                                                    <span className={`eksik-penalty ${missingPenalty > 0 ? 'badge-missing' : ''}`}>
                                                        Kesinti: {missingPenalty > 0 ? `-${missingPenalty}` : '0'}
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Tarafsiz Kesinti */}
                                <div className="score-card card-orange">
                                    <div className="sc-header card-header-orange">
                                        <h3>Tarafsız Kesinti (Çizgi, Süre vb.)</h3>
                                    </div>
                                    <div className="sc-body horizontal">
                                        <input
                                            type="number"
                                            step="0.1"
                                            min="0"
                                            value={neutralDeductions}
                                            onChange={e => { setNeutralDeductions(e.target.value); setScoringFieldsTouched(true); }}
                                            className="med-num-input input-orange"
                                        />
                                        <div className="nd-quick">
                                            <button className="btn-outline-orange" onClick={() => { setNeutralDeductions(prev => (parseFloat(prev || 0) + 0.1).toFixed(1)); setScoringFieldsTouched(true); }}>+0.1</button>
                                            <button className="btn-outline-orange" onClick={() => { setNeutralDeductions(prev => (parseFloat(prev || 0) + 0.3).toFixed(1)); setScoringFieldsTouched(true); }}>+0.3</button>
                                            <button className="btn-outline-gray" onClick={() => { setNeutralDeductions(0); setScoringFieldsTouched(true); }}>Sıfırla</button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="final-score-bar-light">
                                <div className="fs-calc">
                                    <span className="fs-part score-chip-blue">D: {calculatedDScore.toFixed(3)}</span>
                                    <span className="fs-math">+</span>
                                    <span className="fs-part score-chip-green">E: {currentEScore.toFixed(3)}</span>
                                    {missingPenalty > 0 && (
                                        <>
                                            <span className="fs-math">−</span>
                                            <span className="fs-part score-chip-red">Eksik: {missingPenalty.toFixed(1)}</span>
                                        </>
                                    )}
                                    {tarafsizKesinti > 0 && (
                                        <>
                                            <span className="fs-math">−</span>
                                            <span className="fs-part score-chip-orange">Trfs: {tarafsizKesinti.toFixed(1)}</span>
                                        </>
                                    )}
                                    {bonusValue > 0 && (
                                        <>
                                            <span className="fs-math">+</span>
                                            <span className="fs-part score-chip-purple">Bonus: {bonusValue.toFixed(1)}</span>
                                        </>
                                    )}
                                    <span className="fs-math">=</span>
                                </div>
                                <div className="text-hero">
                                    {finalScore}
                                </div>
                                {hasPermission('scoring', 'puanla') && (
                                    <button
                                        className="btn-save-score"
                                        onClick={handleSubmitScore}
                                        disabled={isSubmitting || scoreLocked}
                                    >
                                        {isSubmitting ? <div className="spinner-small"></div> : <i className="material-icons-round">{scoreLocked ? 'lock' : 'publish'}</i>}
                                        <span>{scoreLocked ? 'Puan Kilitli' : 'Puanı Kaydet'}</span>
                                    </button>
                                )}
                            </div>

                        </div>
                    )}
                </main>
            </div>

            {/* Puan Onay Modal */}
            {confirmModal && (
                <div className="scoring-modal-overlay" onClick={() => setConfirmModal(null)}>
                    <div className="scoring-modal" onClick={e => e.stopPropagation()}>
                        <div className="scoring-modal-header confirm-header">
                            <i className="material-icons-round">fact_check</i>
                            <h2>Puan Onayı</h2>
                        </div>
                        <div className="scoring-modal-body">
                            <div className="modal-athlete-info">
                                <div className="modal-avatar">{confirmModal.athlete.ad.charAt(0)}{confirmModal.athlete.soyad.charAt(0)}</div>
                                <div>
                                    <h3>{confirmModal.athlete.ad} {confirmModal.athlete.soyad}</h3>
                                    <p>{confirmModal.athlete.okul || confirmModal.athlete.kulup} &bull; {confirmModal.apparatus}</p>
                                </div>
                            </div>
                            <div className="modal-score-grid">
                                <div className="modal-score-item blue">
                                    <span className="msi-label">D Puanı</span>
                                    <span className="msi-value">{confirmModal.dScore.toFixed(3)}</span>
                                </div>
                                <div className="modal-score-item green">
                                    <span className="msi-label">E Puanı</span>
                                    <span className="msi-value">{confirmModal.eScore.toFixed(3)}</span>
                                </div>
                                {confirmModal.missingPen > 0 && (
                                    <div className="modal-score-item red">
                                        <span className="msi-label">Eksik Kesinti</span>
                                        <span className="msi-value">-{confirmModal.missingPen.toFixed(3)}</span>
                                    </div>
                                )}
                                {confirmModal.neutralPen > 0 && (
                                    <div className="modal-score-item orange">
                                        <span className="msi-label">Tarafsız Kesinti</span>
                                        <span className="msi-value">-{confirmModal.neutralPen.toFixed(3)}</span>
                                    </div>
                                )}
                                {confirmModal.bonus > 0 && (
                                    <div className="modal-score-item purple">
                                        <span className="msi-label">Bonus</span>
                                        <span className="msi-value">+{confirmModal.bonus.toFixed(3)}</span>
                                    </div>
                                )}
                            </div>
                            <div className="modal-final-score">
                                <span>Final Puanı</span>
                                <strong>{confirmModal.finalScore}</strong>
                            </div>
                        </div>
                        <div className="scoring-modal-actions">
                            <button className="modal-btn cancel" onClick={() => setConfirmModal(null)}>
                                <i className="material-icons-round">close</i> Vazgeç
                            </button>
                            <button className="modal-btn confirm" onClick={executeScoreSave} disabled={isSubmitting}>
                                {isSubmitting ? <div className="spinner-small"></div> : <i className="material-icons-round">check</i>}
                                Onayla ve Kaydet
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Kayıt Başarılı + Sonraki Sporcu Modal */}
            {successModal && (
                <div className="scoring-modal-overlay">
                    <div className="scoring-modal success-modal">
                        <div className="scoring-modal-header success-header">
                            <i className="material-icons-round">check_circle</i>
                            <h2>Puan Kaydedildi</h2>
                        </div>
                        <div className="scoring-modal-body">
                            <div className="modal-athlete-info">
                                <div className="modal-avatar success-avatar">{successModal.athlete.ad.charAt(0)}{successModal.athlete.soyad.charAt(0)}</div>
                                <div>
                                    <h3>{successModal.athlete.ad} {successModal.athlete.soyad}</h3>
                                    <p>{successModal.apparatus}</p>
                                </div>
                                <div className="saved-score-badge">{successModal.finalScore}</div>
                            </div>
                            <div className="modal-saved-details">
                                <span className="msd-chip blue">D: {successModal.dScore.toFixed(3)}</span>
                                <span className="msd-chip green">E: {successModal.eScore.toFixed(3)}</span>
                            </div>

                            {successModal.nextAthlete ? (
                                <div className="next-athlete-section">
                                    <div className="next-divider">
                                        <span>Sıradaki Sporcu</span>
                                    </div>
                                    <div className="next-athlete-card">
                                        <div className="na-avatar">{successModal.nextAthlete.ad.charAt(0)}{successModal.nextAthlete.soyad.charAt(0)}</div>
                                        <div className="na-info">
                                            <h3>{successModal.nextAthlete.ad} {successModal.nextAthlete.soyad}</h3>
                                            <p>{successModal.nextAthlete.okul || successModal.nextAthlete.kulup || ''}</p>
                                        </div>
                                        <span className="na-order">#{successModal.nextAthlete.sirasi || successModal.nextAthlete.cikisSirasi}</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="next-athlete-section">
                                    <div className="next-divider">
                                        <span>Bu alet için tüm sporcular puanlandı</span>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="scoring-modal-actions">
                            <button className="modal-btn cancel" onClick={() => setSuccessModal(null)}>
                                Kapat
                            </button>
                            {successModal.nextAthlete && (
                                <button className="modal-btn next-btn" onClick={() => handleNextAthlete(successModal.nextAthlete)}>
                                    <i className="material-icons-round">campaign</i>
                                    Sporcuyu Çağır
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Kilit Açma Modal */}
            {unlockModal && (
                <div className="scoring-modal-overlay" onClick={() => setUnlockModal(null)}>
                    <div className="scoring-modal unlock-modal" onClick={e => e.stopPropagation()}>
                        <div className="scoring-modal-header unlock-header">
                            <i className="material-icons-round">lock_open</i>
                            <h2>Puan Kilidi Aç</h2>
                        </div>
                        <div className="scoring-modal-body">
                            <div className="modal-athlete-info">
                                <div className="modal-avatar">{unlockModal.athleteName.charAt(0)}</div>
                                <div>
                                    <h3>{unlockModal.athleteName}</h3>
                                    <p>Bu sporcunun puanı kilitlidir. Düzenleme için kilidi açın.</p>
                                </div>
                            </div>
                            <div className="unlock-form">
                                <label className="unlock-label">
                                    <i className="material-icons-round">vpn_key</i>
                                    Süper Admin veya Komite Şifresi
                                </label>
                                <input
                                    type="password"
                                    className="unlock-input"
                                    placeholder="Şifre giriniz..."
                                    value={unlockPassword}
                                    onChange={e => { setUnlockPassword(e.target.value); setUnlockError(''); }}
                                    onKeyDown={e => e.key === 'Enter' && handleUnlockSubmit()}
                                    autoFocus
                                />
                                {unlockError && (
                                    <div className="unlock-error">
                                        <i className="material-icons-round">error</i> {unlockError}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="scoring-modal-actions">
                            <button className="modal-btn cancel" onClick={() => setUnlockModal(null)}>
                                <i className="material-icons-round">close</i> Vazgeç
                            </button>
                            <button className="modal-btn confirm" onClick={handleUnlockSubmit} disabled={unlockingInProgress}>
                                {unlockingInProgress ? <div className="spinner-small"></div> : <i className="material-icons-round">lock_open</i>}
                                Kilidi Aç
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
