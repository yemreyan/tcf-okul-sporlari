import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { AEROBIK_CATEGORIES, ELEMENT_FAMILIES, DIFFICULTY_VALUES, PENALTY_TYPES, FAMILY_CONSTRAINTS } from '../data/aerobikCriteriaDefaults';
import { useAuth } from '../lib/AuthContext';
import { useDiscipline } from '../lib/DisciplineContext';
import { useOffline } from '../lib/OfflineContext';
import { useNotification } from '../lib/NotificationContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { logAction } from '../lib/auditLogger';
import './AerobikScoringPage.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Trim highest and lowest, return average of remaining. */
function calcTrimmedAvg(panelLocal, count) {
    const scores = [];
    for (let i = 1; i <= count; i++) {
        const val = panelLocal[`j${i}`];
        if (val !== undefined && val !== null && val !== '' && !isNaN(parseFloat(val))) {
            scores.push(parseFloat(val));
        }
    }
    if (scores.length === 0) return 0;
    if (scores.length >= 4) {
        scores.sort((a, b) => a - b);
        const trimmed = scores.slice(1, -1);
        return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    }
    return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * Returns a status map { j1: 'kept'|'low'|'high'|'only' } for 4-judge panels.
 * Used to show Ortalamada / Kesildi ↓ / Kesildi ↑ badges.
 */
function getJudgeStatuses(panelLocal, count) {
    const entries = [];
    for (let i = 1; i <= count; i++) {
        const v = panelLocal[`j${i}`];
        if (v !== undefined && v !== null && v !== '' && !isNaN(parseFloat(v))) {
            entries.push({ key: `j${i}`, value: parseFloat(v) });
        }
    }
    if (entries.length < 4) {
        // Not enough for trim — all are 'only'
        const m = {};
        entries.forEach(e => { m[e.key] = 'only'; });
        return m;
    }
    const sorted = [...entries].sort((a, b) => a.value - b.value);
    const lowKey  = sorted[0].key;
    const highKey = sorted[sorted.length - 1].key;
    const m = {};
    entries.forEach(e => {
        if (e.key === lowKey)  m[e.key] = 'low';
        else if (e.key === highKey) m[e.key] = 'high';
        else m[e.key] = 'kept';
    });
    return m;
}

const JUDGE_COUNT = 4;

const D_SLOTS = ['e1','e2','e3','e4','e5','e6','e7','e8','c'];
const D_SLOT_LABELS = { e1:'E1', e2:'E2', e3:'E3', e4:'E4', e5:'E5', e6:'E6', e7:'E7', e8:'E8', c:'C' };

// A panel criteria labels (same keys used in AerobikAPanelPage)
const A_CRITERIA_LABELS = {
    music:           'Müzik',
    content2:        'Aerobik / Step İçeriği',
    generalContent:  'Genel İçerik',
    artisticRoutine: 'Artistik Seri',
    performance:     'Performans',
};
const A_DEDUCTION_LABELS = {
    ampSetMissing:       'Eksik AMP Seti',
    ampBlockMissing:     'Eksik AMP Blok',
    lessThan3Collab:     "3'ten az işbirliği",
    missingZone:         'Alan/Bölge eksik',
    missingIntro:        'Giriş/Açılış eksik',
    endingWithElements:  'Elementle biten seri',
    multipleTouchFall:   'Çoklu temas / Düşme',
    missingSteppingSet:  'Eksik 9 Step Seti',
    missingStepBlock:    'Eksik Step Blok',
    missingTheme:        'Tema eksik',
    fall:                'Düşme',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AerobikScoringPage() {
    const navigate = useNavigate();
    const { currentUser, hasPermission, hashPassword } = useAuth();
    const { firebasePath } = useDiscipline();
    const { offlineWrite } = useOffline();
    const { toast } = useNotification();

    // Data
    const [competitions, setCompetitions]         = useState({});
    const [selectedCity, setSelectedCity]         = useState('');
    const [selectedCompId, setSelectedCompId]     = useState('');
    const [selectedCategory, setSelectedCategory] = useState('');

    // Athletes & scores
    const [athletesByRotation, setAthletesByRotation] = useState([]);
    const [existingScores, setExistingScores]         = useState({});
    const [selectedAthlete, setSelectedAthlete]       = useState(null);
    const [isAthleteCalled, setIsAthleteCalled]       = useState(false);

    // Judge inputs
    const [aPanelLocal, setAPanelLocal] = useState({});
    const [ePanelLocal, setEPanelLocal] = useState({});

    // D elements
    const [selectedElements, setSelectedElements] = useState([]);

    // Penalties
    const [penalties, setPenalties] = useState({ fall: 0, time: 0, line: 0, music: 0, lift: 0, costume: 0 });

    // Lock
    const [scoreLocked, setScoreLocked]               = useState(false);
    const [unlockModal, setUnlockModal]               = useState(null);
    const [unlockPassword, setUnlockPassword]         = useState('');
    const [unlockError, setUnlockError]               = useState('');
    const [unlockingInProgress, setUnlockingInProgress] = useState(false);
    const [scoringFieldsTouched, setScoringFieldsTouched] = useState(false);

    // D Divisor (mandatory manual selection: 1.8 / 1.9 / 2.0)
    const [selectedDivisor, setSelectedDivisor] = useState(null);

    // UI
    const [sidebarOpen, setSidebarOpen]         = useState(true);
    const [isSubmitting, setIsSubmitting]       = useState(false);
    const [confirmModal, setConfirmModal]       = useState(null);
    const [successModal, setSuccessModal]       = useState(null);
    const [showElementPicker, setShowElementPicker] = useState(false);
    const [showADetail, setShowADetail]         = useState(false);

    // ── Firebase: competitions ──────────────────────────────────────────────
    useEffect(() => {
        return onValue(ref(db, firebasePath), (snap) => {
            setCompetitions(filterCompetitionsByUser(snap.val() || {}, currentUser));
        });
    }, [currentUser, firebasePath]);

    // ── Firebase: athletes & scores ─────────────────────────────────────────
    useEffect(() => {
        if (!selectedCompId || !selectedCategory) {
            setAthletesByRotation([]);
            setExistingScores({});
            setSelectedAthlete(null);
            setIsAthleteCalled(false);
            return;
        }

        const orderRef  = ref(db, `${firebasePath}/${selectedCompId}/siralama/${selectedCategory}`);
        const scoresRef = ref(db, `${firebasePath}/${selectedCompId}/puanlar/${selectedCategory}`);

        const unsubOrder = onValue(orderRef, (snap) => {
            const orderData = snap.val();
            const rotations = [];
            if (orderData) {
                const maxRots = Math.max(...Object.keys(orderData).map(k => parseInt(k.replace('rotation_', ''))).filter(n => !isNaN(n)));
                for (let i = 0; i <= maxRots; i++) {
                    const rotData = orderData[`rotation_${i}`];
                    if (rotData) {
                        const arr = Object.keys(rotData).map(id => ({ id, ...rotData[id] })).sort((a, b) => a.sirasi - b.sirasi);
                        rotations.push(arr);
                    } else {
                        rotations.push([]);
                    }
                }
                setAthletesByRotation(rotations);
            } else {
                // Fallback: load from sporcular
                get(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${selectedCategory}`)).then((fbSnap) => {
                    const fbData = fbSnap.val();
                    if (fbData) {
                        const arr = Object.keys(fbData).map((id, idx) => ({ id, ...fbData[id], _kayitSirasi: idx + 1 }));
                        arr.sort((a, b) => {
                            const sA = (a.cikisSirasi !== undefined && a.cikisSirasi !== null && a.cikisSirasi !== 999) ? a.cikisSirasi : a._kayitSirasi;
                            const sB = (b.cikisSirasi !== undefined && b.cikisSirasi !== null && b.cikisSirasi !== 999) ? b.cikisSirasi : b._kayitSirasi;
                            return sA - sB;
                        });
                        setAthletesByRotation([arr]);
                    }
                });
            }
        });

        const unsubScores = onValue(scoresRef, (snap) => {
            setExistingScores(snap.val() || {});
        });

        return () => { unsubOrder(); unsubScores(); };
    }, [selectedCompId, selectedCategory, firebasePath]);

    // Reactively sync lock state
    useEffect(() => {
        if (!selectedAthlete) return;
        setScoreLocked(existingScores[selectedAthlete.id]?.kilitli === true);
    }, [existingScores, selectedAthlete?.id]);

    // Sync server data → form (only if not touched by user yet)
    // Elements, divisor, penalties only sync on initial load (scoringFieldsTouched guard)
    useEffect(() => {
        if (!selectedAthlete || scoringFieldsTouched) return;
        const scores = existingScores[selectedAthlete.id];
        if (!scores) return;
        setSelectedElements(scores.dElements || []);
        if (scores.dDivisor != null) setSelectedDivisor(Number(scores.dDivisor));
        const base = scores.penalties || { fall: 0, time: 0, line: 0, music: 0, lift: 0, costume: 0 };
        const synced = { ...base };
        if (scores.tPanel?.deduction !== undefined) synced.time = scores.tPanel.deduction;
        if (scores.lPanel?.totalDeduction !== undefined) synced.line = scores.lPanel.totalDeduction;
        setPenalties(synced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [existingScores, selectedAthlete?.id]);

    // A ve E panel puanları ALWAYS Firebase'den merge edilir:
    // Hakem gönderimi her zaman kazanır; hakem göndermemiş slotlarda admin girişi korunur.
    useEffect(() => {
        if (!selectedAthlete) return;
        const scores = existingScores[selectedAthlete.id];
        if (!scores) return;
        if (scores.aPanel) {
            setAPanelLocal(prev => ({ ...prev, ...scores.aPanel }));
        }
        if (scores.ePanel) {
            setEPanelLocal(prev => ({ ...prev, ...scores.ePanel }));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [existingScores, selectedAthlete?.id]);

    // ── Derived Data ────────────────────────────────────────────────────────
    const availableCities = useMemo(
        () => [...new Set(Object.values(competitions).map(c => (c.il || c.city || '').toLocaleUpperCase('tr-TR')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr-TR')),
        [competitions]
    );

    const compOptions = useMemo(
        () => Object.entries(competitions)
            .filter(([, comp]) => !selectedCity || (comp.il || comp.city || '').toLocaleUpperCase('tr-TR') === selectedCity)
            .sort((a, b) => new Date(b[1].tarih || b[1].baslangicTarihi || 0) - new Date(a[1].tarih || a[1].baslangicTarihi || 0)),
        [competitions, selectedCity]
    );

    let categoryOptions = [];
    if (selectedCompId && competitions[selectedCompId]?.sporcular) {
        categoryOptions = Object.keys(competitions[selectedCompId].sporcular);
    } else if (selectedCompId && competitions[selectedCompId]?.kategoriler) {
        categoryOptions = Object.keys(competitions[selectedCompId].kategoriler);
    }

    const categoryConfig  = AEROBIK_CATEGORIES[selectedCategory] || Object.values(AEROBIK_CATEGORIES)[0];
    const maxElements     = categoryConfig?.maxElements || 8;
    // dDivisor is now manually selected; null means not yet chosen
    const dDivisor        = selectedDivisor;
    // Step kategorileri: grup = 'Step Aerobik', tip = 'takim'
    const isStepCategory  = categoryConfig?.group === 'Step Aerobik';

    // Step: Firebase key için okul adını güvenli hale getir
    const toStepKey = (name) => (name || '').trim().replace(/[.#$[\]/]/g, '-').slice(0, 60);

    // Step: athletesByRotation'dan benzersiz okulları çıkar
    const stepTeams = useMemo(() => {
        if (!isStepCategory) return [];
        const seen = new Set();
        const teams = [];
        athletesByRotation.flat().forEach(a => {
            const school = a.okul || '';
            if (school && !seen.has(school)) {
                seen.add(school);
                teams.push({
                    id:     toStepKey(school),
                    ad:     school,
                    soyad:  '',
                    okul:   school,
                    sirasi: teams.length + 1,
                    isTeam: true,
                });
            }
        });
        return teams;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isStepCategory, athletesByRotation]);

    // ── Score Calculations ───────────────────────────────────────────────────
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const aScore = useMemo(() => calcTrimmedAvg(aPanelLocal, JUDGE_COUNT), [aPanelLocal]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const avgEDeduction = useMemo(() => calcTrimmedAvg(ePanelLocal, JUDGE_COUNT), [ePanelLocal]);
    const eScore = Math.max(0, 10.0 - avgEDeduction);

    // D Panel data submitted by the D judge — live from Firebase via existingScores
    const dPanelData = selectedAthlete
        ? (existingScores[selectedAthlete.id]?.dPanel ?? null)
        : null;

    // Element-based D sum (from admin element picker — fallback)
    const dElementsRawSum = useMemo(
        () => selectedElements.reduce((sum, el) => sum + (parseFloat(el.value) || 0), 0),
        [selectedElements]
    );

    // Prefer D judge panel rawTotal when submitted; else use element picker
    const dRawSum       = dPanelData?.rawTotal != null ? Number(dPanelData.rawTotal) : dElementsRawSum;
    const dJudgeDed     = dPanelData?.deduction != null ? Number(dPanelData.deduction) : 0;
    // dScore is 0 (hidden) when divisor not selected yet
    const dScore        = dDivisor != null && dDivisor > 0 ? dRawSum / dDivisor : 0;

    const totalPenalties = useMemo(
        () => Object.values(penalties).reduce((sum, v) => sum + (parseFloat(v) || 0), 0),
        [penalties]
    );

    const finalScore = useMemo(
        () => dScore === 0
            ? '0.000'
            : Math.max(0, aScore + eScore + dScore - dJudgeDed - totalPenalties).toFixed(3),
        [dScore, aScore, eScore, dJudgeDed, totalPenalties]
    );

    // Judge status maps (Ortalamada / Kesildi)
    const aStatuses = useMemo(() => getJudgeStatuses(aPanelLocal, JUDGE_COUNT), [aPanelLocal]);
    const eStatuses = useMemo(() => getJudgeStatuses(ePanelLocal, JUDGE_COUNT), [ePanelLocal]);

    // ── Handlers ────────────────────────────────────────────────────────────
    const handleSelectAthlete = (athlete) => {
        if (selectedAthlete?.id === athlete.id) return;
        const prev     = existingScores[athlete.id];
        const isLocked = prev?.kilitli === true;
        setSelectedAthlete(athlete);
        setIsAthleteCalled(false);
        setScoreLocked(isLocked);
        setScoringFieldsTouched(false);
        if (prev) {
            setAPanelLocal(prev.aPanel || {});
            setEPanelLocal(prev.ePanel || {});
            setSelectedElements(prev.dElements || []);
            setSelectedDivisor(prev.dDivisor != null ? Number(prev.dDivisor) : null);
            setPenalties(prev.penalties || { fall: 0, time: 0, line: 0, music: 0, lift: 0, costume: 0 });
        } else {
            resetPanel();
        }
    };

    const resetPanel = () => {
        setAPanelLocal({});
        setEPanelLocal({});
        setSelectedElements([]);
        setSelectedDivisor(null);
        setPenalties({ fall: 0, time: 0, line: 0, music: 0, lift: 0, costume: 0 });
        setScoringFieldsTouched(false);
    };

    const handleCallAthlete = async () => {
        setIsAthleteCalled(true);
        try {
            // Write an object so panels receive name + id in one atomic payload —
            // avoids the race condition where aktifSporcu arrives before aktifSporcuBilgi.
            const payload = {
                id:    selectedAthlete.id,
                ad:    selectedAthlete.ad    || '',
                soyad: selectedAthlete.soyad || '',
                okul:  selectedAthlete.okul  || selectedAthlete.kulup || '',
            };
            await update(ref(db), {
                [`${firebasePath}/${selectedCompId}/aktifSporcu/${selectedCategory}`]:     payload,
                [`${firebasePath}/${selectedCompId}/aktifSporcuBilgi/${selectedCategory}`]: payload,
            });
        } catch (e) { if (import.meta.env.DEV) console.error('Could not set active athlete', e); }
    };

    const getNextAthlete = () => {
        if (!selectedAthlete) return null;
        if (isStepCategory) {
            const idx = stepTeams.findIndex(t => t.id === selectedAthlete.id);
            if (idx === -1 || idx >= stepTeams.length - 1) return null;
            return stepTeams[idx + 1];
        }
        if (athletesByRotation.length === 0) return null;
        const all = athletesByRotation.flat();
        const idx = all.findIndex(a => a.id === selectedAthlete.id);
        if (idx === -1 || idx >= all.length - 1) return null;
        return all[idx + 1];
    };

    const addElement = (family, value) => {
        if (selectedElements.length >= maxElements) {
            return toast(`Bu kategoride en fazla ${maxElements} element eklenebilir.`, 'warning');
        }
        const familyCount = selectedElements.filter(el => el.familyId === family.id).length;
        if (familyCount >= FAMILY_CONSTRAINTS.maxPerFamily) {
            return toast(`Aynı aileden en fazla ${FAMILY_CONSTRAINTS.maxPerFamily} element eklenebilir (${family.name}).`, 'warning');
        }
        setSelectedElements(prev => [...prev, {
            id: Date.now(),
            group: family.group,
            groupLabel: family.groupLabel,
            familyId: family.id,
            familyName: family.name,
            value: parseFloat(value)
        }]);
        setShowElementPicker(false);
    };

    const removeElement = (id) => setSelectedElements(prev => prev.filter(el => el.id !== id));

    const handleSubmitScore = () => {
        if (!selectedAthlete) return toast('Lütfen bir sporcu seçin.', 'warning');
        if (scoreLocked) return toast('Bu sporcunun puanı kilitli. Düzenlemek için kilidi açın.', 'warning');

        const filledA = Object.values(aPanelLocal).filter(v => v !== undefined && v !== null && v !== '' && !isNaN(parseFloat(v)));
        if (filledA.length === 0) return toast('A puanı girilmeden kayıt yapılamaz.', 'warning');

        const filledE = Object.values(ePanelLocal).filter(v => v !== undefined && v !== null && v !== '' && !isNaN(parseFloat(v)));
        if (filledE.length === 0) return toast('E puanı girilmeden kayıt yapılamaz.', 'warning');

        if (dDivisor == null) {
            return toast('D katsayısı seçilmedi. Kaydetmeden önce 1.8 / 1.9 / 2.0 değerlerinden birini seçiniz.', 'warning');
        }

        if (dScore === 0) {
            if (dPanelData) {
                return toast('D puanı 0 — D hakemi tüm slotları boş bırakmış.', 'warning');
            }
            return toast('D puanı (güçlük) 0 — hiç element seçilmemiş. Önce element ekleyiniz veya D hakeminin göndermesini bekleyin.', 'warning');
        }

        // Element-based validation only when D panel hasn't been submitted
        if (!dPanelData) {
            const uniqueFamilies = new Set(selectedElements.map(el => el.familyId));
            if (selectedElements.length > 0 && uniqueFamilies.size < FAMILY_CONSTRAINTS.minFamilies) {
                return toast(`En az ${FAMILY_CONSTRAINTS.minFamilies} farklı element ailesi kullanılmalıdır (şu an: ${uniqueFamilies.size}).`, 'warning');
            }
        }

        const fVal = parseFloat(finalScore);
        if (isNaN(fVal) || fVal < 0 || fVal > 30) return toast('Final puanı geçersiz.', 'error');

        setConfirmModal({
            athlete: selectedAthlete,
            aScore, eScore, dScore, totalPenalties, finalScore,
            category: selectedCategory
        });
    };

    const executeScoreSave = async () => {
        const savedAthlete = confirmModal.athlete;
        setConfirmModal(null);
        setIsSubmitting(true);
        try {
            const scorePath  = `${firebasePath}/${selectedCompId}/puanlar/${selectedCategory}/${savedAthlete.id}`;
            const activePath = `${firebasePath}/${selectedCompId}/aktifSporcu/${selectedCategory}`;
            const ts = new Date().toISOString();

            await offlineWrite({
                [scorePath + '/aScore']:         aScore,
                [scorePath + '/eScore']:         eScore,
                [scorePath + '/dScore']:         dScore,
                [scorePath + '/dRawSum']:        dRawSum,
                [scorePath + '/dDivisor']:       selectedDivisor,
                [scorePath + '/penalties']:      penalties,
                [scorePath + '/totalPenalties']: totalPenalties,
                [scorePath + '/aPanel']:         aPanelLocal,
                [scorePath + '/ePanel']:         ePanelLocal,
                [scorePath + '/dElements']:      selectedElements,
                [scorePath + '/sonuc']:          parseFloat(finalScore),
                [scorePath + '/timestamp']:      ts,
                [scorePath + '/durum']:          'tamamlandi',
                [scorePath + '/kilitli']:        true,
                [activePath]:                    null,
                [`${firebasePath}/${selectedCompId}/aktifSporcuBilgi/${selectedCategory}`]: null,
            });

            const _entityLabel = isStepCategory ? savedAthlete.ad : `${savedAthlete.ad} ${savedAthlete.soyad}`.trim();
            logAction('score_create', `[Aerobik] ${_entityLabel} — ${selectedCategory}: ${finalScore}`, {
                user: currentUser?.kullaniciAdi || 'admin',
                competitionId: selectedCompId,
            });

            const nextAth = getNextAthlete();
            setSuccessModal({
                athlete: savedAthlete,
                finalScore, aScore, eScore, dScore,
                category: selectedCategory,
                nextAthlete: nextAth
            });
        } catch (error) {
            if (import.meta.env.DEV) console.error('Score save error:', error);
            toast('Puan kaydedilirken bir hata oluştu.', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleNextAthlete = (nextAth) => {
        setSuccessModal(null);
        handleSelectAthlete(nextAth);
    };

    // ── Score Unlock ─────────────────────────────────────────────────────────
    const handleUnlockRequest = () => {
        if (!selectedAthlete) return;
        const displayName = isStepCategory
            ? selectedAthlete.ad
            : `${selectedAthlete.ad} ${selectedAthlete.soyad}`.trim();
        setUnlockModal({ athleteId: selectedAthlete.id, athleteName: displayName });
        setUnlockPassword('');
        setUnlockError('');
    };

    const handleUnlockSubmit = async () => {
        if (!unlockPassword.trim()) { setUnlockError('Şifre giriniz.'); return; }
        setUnlockingInProgress(true);
        setUnlockError('');
        try {
            const compKomiteSnap   = await get(ref(db, `${firebasePath}/${selectedCompId}/komiteSifresi`));
            const globalKomiteSnap = await get(ref(db, 'ayarlar/komiteSifresi'));
            const komiteSifre      = compKomiteSnap.val() || globalKomiteSnap.val();
            const usersSnap        = await get(ref(db, 'kullanicilar'));
            const usersData        = usersSnap.val() || {};
            const inputPwd         = unlockPassword.trim();
            const inputHash        = await hashPassword(inputPwd);
            const isKomiteMatch    = komiteSifre && inputPwd === komiteSifre;
            let   isUserMatch      = false;
            for (const [, ud] of Object.entries(usersData)) {
                if ((ud.sifreHash && inputHash === ud.sifreHash) || (ud.sifre && inputPwd === ud.sifre)) {
                    isUserMatch = true; break;
                }
            }
            if (isKomiteMatch || isUserMatch) {
                const scorePath = `${firebasePath}/${selectedCompId}/puanlar/${selectedCategory}/${unlockModal.athleteId}`;
                await offlineWrite({ [scorePath + '/kilitli']: false });
                setScoreLocked(false);
                setUnlockModal(null);
                toast('Puan kilidi kaldırıldı. Düzenleme yapabilirsiniz.', 'success');
                logAction('score_unlock', `[Aerobik] ${unlockModal.athleteName} — puan kilidi kaldırıldı`, {
                    user: currentUser?.kullaniciAdi || 'admin',
                    competitionId: selectedCompId,
                });
            } else {
                setUnlockError('Şifre hatalı. Süper Admin veya Komite şifresi gereklidir.');
            }
        } catch (err) {
            if (import.meta.env.DEV) console.error('Unlock error:', err);
            setUnlockError('Bir hata oluştu. Tekrar deneyin.');
        } finally {
            setUnlockingInProgress(false);
        }
    };

    // ── Judge input helper ───────────────────────────────────────────────────
    const renderJudgeRows = (panelLocal, setPanelFn, prefix, count, statuses, colorClass) => {
        return Array.from({ length: count }, (_, i) => {
            const key    = `j${i + 1}`;
            const val    = panelLocal[key];
            const hasVal = val !== undefined && val !== null && val !== '';
            const st     = statuses[key];
            const rowCls = `as-judge-row${hasVal ? (colorClass === 'purple' ? ' as-judge-row--filled' : ' as-judge-row--filled-green') : ''}`;
            let badgeCls = 'as-judge-badge--empty';
            let badgeTxt = '—';
            if (st === 'kept') { badgeCls = 'as-judge-badge--kept'; badgeTxt = 'Ortalamada'; }
            else if (st === 'low')  { badgeCls = 'as-judge-badge--low';  badgeTxt = 'Kesildi ↓'; }
            else if (st === 'high') { badgeCls = 'as-judge-badge--high'; badgeTxt = 'Kesildi ↑'; }
            else if (st === 'only') { badgeCls = 'as-judge-badge--kept'; badgeTxt = 'Geçerli'; }
            return (
                <div key={key} className={rowCls}>
                    <span className="as-judge-row-label">{prefix}{i + 1}</span>
                    <input
                        type="number" step="0.1" min="0" max="10"
                        value={hasVal ? val : ''}
                        placeholder="—"
                        className="as-judge-input"
                        disabled={scoreLocked}
                        onChange={e => {
                            let v = e.target.value;
                            if (v !== '' && !isNaN(parseFloat(v))) {
                                v = Math.min(10, Math.max(0, parseFloat(v))).toString();
                            }
                            setScoringFieldsTouched(true);
                            setPanelFn(p => ({ ...p, [key]: v }));
                        }}
                    />
                    {hasVal && (
                        <span className={`as-judge-badge ${badgeCls}`}>{badgeTxt}</span>
                    )}
                </div>
            );
        });
    };

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="as-page">
            {/* Header */}
            <header className="as-header">
                <div className="as-header-left">
                    <button className="as-btn-back" onClick={() => navigate('/aerobik')}>
                        <i className="material-icons-round">home</i>
                    </button>
                    <div>
                        <h1>Aerobik Puanlama</h1>
                        <p className="as-subtitle">Sekreter / Baş Hakem Paneli · A + E + D − Ceza</p>
                    </div>
                </div>
                <div className="as-header-right">
                    {selectedAthlete && isAthleteCalled && (
                        <div className="as-live-badge">
                            <div className="as-pulse-dot" />
                            <span>CANLI</span>
                        </div>
                    )}
                    <button className="as-btn-toggle" onClick={() => setSidebarOpen(p => !p)}>
                        <i className="material-icons-round">{sidebarOpen ? 'menu_open' : 'menu'}</i>
                    </button>
                </div>
            </header>

            <div className="as-layout">
                {/* ─── Sidebar ─── */}
                <aside className={`as-sidebar${!sidebarOpen ? ' sidebar-collapsed' : ''}`}>
                    <div className="as-sidebar-controls">
                        <select className="as-select" value={selectedCity} onChange={e => { setSelectedCity(e.target.value); setSelectedCompId(''); setSelectedCategory(''); setSelectedAthlete(null); }}>
                            <option value="">Tüm İller</option>
                            {availableCities.map(city => <option key={city} value={city}>{city}</option>)}
                        </select>
                        <select className="as-select" value={selectedCompId} onChange={e => { setSelectedCompId(e.target.value); setSelectedCategory(''); setSelectedAthlete(null); }}>
                            <option value="">Yarışma Seçin</option>
                            {compOptions.map(([id, comp]) => <option key={id} value={id}>{comp.isim}</option>)}
                        </select>
                        <select className="as-select" value={selectedCategory} onChange={e => { setSelectedCategory(e.target.value); setSelectedAthlete(null); }} disabled={!selectedCompId}>
                            <option value="">Kategori Seçin</option>
                            {categoryOptions.map(cat => (
                                <option key={cat} value={cat}>{AEROBIK_CATEGORIES[cat]?.label || cat}</option>
                            ))}
                        </select>
                    </div>

                    <div className="as-roster-container">
                        {!selectedCategory ? (
                            <div className="as-roster-empty">
                                <i className="material-icons-round">touch_app</i>
                                <p>Yarışma ve kategori seçin.</p>
                            </div>
                        ) : isStepCategory ? (
                            /* ── Step: Takım Listesi ── */
                            <div className="as-roster-list">
                                <h3 className="as-section-title">
                                    <i className="material-icons-round" style={{ fontSize: '15px', marginRight: '4px' }}>groups</i>
                                    Takım Listesi
                                </h3>
                                {stepTeams.length === 0 ? (
                                    <div className="as-roster-empty">
                                        <i className="material-icons-round">group_off</i>
                                        <p>Bu kategoride kayıtlı takım bulunamadı.</p>
                                    </div>
                                ) : stepTeams.map(team => {
                                    const isSelected    = selectedAthlete?.id === team.id;
                                    const scoreData     = existingScores[team.id];
                                    const hasScore      = scoreData?.durum === 'tamamlandi';
                                    const isLockedScore = scoreData?.kilitli === true;
                                    const display       = scoreData ? parseFloat(scoreData.sonuc ?? 0).toFixed(3) : '0.000';
                                    return (
                                        <div key={team.id}
                                            className={`as-roster-athlete${isSelected ? ' selected' : ''}${hasScore ? ' scored' : ''}`}
                                            onClick={() => handleSelectAthlete(team)}>
                                            <div className="as-ra-info">
                                                <span className="as-ra-order">{team.sirasi}.</span>
                                                <span className="as-ra-name">{team.ad}</span>
                                            </div>
                                            {hasScore ? (
                                                <div className="as-ra-score-badge success-glow">
                                                    {isLockedScore && <i className="material-icons-round as-lock-icon">lock</i>}
                                                    {display}
                                                </div>
                                            ) : (
                                                <div className="as-ra-status-badge pending">Bekliyor</div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            /* ── Bireysel: Çıkış Sırası ── */
                            <div className="as-roster-list">
                                <h3 className="as-section-title">Çıkış Sırası</h3>
                                {athletesByRotation.map((rotation, rIdx) =>
                                    rotation.length > 0 && (
                                        <div key={rIdx} className="as-roster-group">
                                            <div className="as-rg-title">Rotasyon {rIdx + 1}</div>
                                            {rotation.map(ath => {
                                                const isSelected  = selectedAthlete?.id === ath.id;
                                                const scoreData   = existingScores[ath.id];
                                                const hasScore    = scoreData?.durum === 'tamamlandi';
                                                const isLockedScore = scoreData?.kilitli === true;
                                                const display     = scoreData ? parseFloat(scoreData.sonuc ?? 0).toFixed(3) : '0.000';
                                                return (
                                                    <div key={ath.id}
                                                        className={`as-roster-athlete${isSelected ? ' selected' : ''}${hasScore ? ' scored' : ''}`}
                                                        onClick={() => handleSelectAthlete(ath)}>
                                                        <div className="as-ra-info">
                                                            <span className="as-ra-order">{ath.sirasi || ath.cikisSirasi}.</span>
                                                            <span className="as-ra-name">{ath.ad} {ath.soyad}</span>
                                                        </div>
                                                        {hasScore ? (
                                                            <div className="as-ra-score-badge success-glow">
                                                                {isLockedScore && <i className="material-icons-round as-lock-icon">lock</i>}
                                                                {display}
                                                            </div>
                                                        ) : (
                                                            <div className="as-ra-status-badge pending">Bekliyor</div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )
                                )}
                            </div>
                        )}
                    </div>
                </aside>

                {/* ─── Main ─── */}
                <main className="as-main">
                    {!selectedAthlete ? (
                        <div className="as-empty">
                            <i className="material-icons-round" style={{ fontSize: '3.5rem', color: '#CBD5E1' }}>
                                {isStepCategory ? 'groups' : 'directions_run'}
                            </i>
                            <h2>Puanlamaya Hazır</h2>
                            <p>Sol taraftaki listeden {isStepCategory ? 'bir takım' : 'bir sporcu'} seçin.</p>
                        </div>
                    ) : !isAthleteCalled ? (
                        <div className="as-call-view">
                            <div className="as-athlete-card">
                                <h3>{isStepCategory ? 'Sıradaki Takım' : 'Sıradaki Sporcu'}</h3>
                                <h1>{selectedAthlete.ad}{!isStepCategory && ` ${selectedAthlete.soyad}`}</h1>
                                {!isStepCategory && (
                                    <p className="as-club">{selectedAthlete.okul || selectedAthlete.kulup || ''}</p>
                                )}
                                <div className="as-meta">
                                    {!isStepCategory && (
                                        <span className="as-badge">Sıra: {selectedAthlete.sirasi || selectedAthlete.cikisSirasi}</span>
                                    )}
                                    <span className="as-badge">{isStepCategory ? 'Takım' : 'Kategori'}: {AEROBIK_CATEGORIES[selectedCategory]?.label || selectedCategory}</span>
                                </div>
                            </div>
                            <button className="as-btn-call" onClick={handleCallAthlete}>
                                <i className="material-icons-round">campaign</i>
                                {isStepCategory ? 'Takımı Çağır ve Puanla' : 'Sporcuyu Çağır ve Puanla'}
                            </button>
                        </div>
                    ) : (
                        <div className="as-scoring-panel">
                            {/* Athlete / Team Header */}
                            <div className="as-athlete-header">
                                <div className="as-avatar">
                                    {isStepCategory
                                        ? (selectedAthlete.ad || '?').charAt(0)
                                        : `${(selectedAthlete.ad || '?').charAt(0)}${(selectedAthlete.soyad || '').charAt(0)}`
                                    }
                                </div>
                                <div className="as-athlete-details">
                                    <h2>
                                        {isStepCategory
                                            ? selectedAthlete.ad
                                            : `${selectedAthlete.ad} ${selectedAthlete.soyad}`
                                        }
                                    </h2>
                                    <p className="as-subtitle">
                                        {isStepCategory
                                            ? <><i className="material-icons-round" style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: '4px' }}>groups</i>{AEROBIK_CATEGORIES[selectedCategory]?.label || selectedCategory}</>
                                            : <>{selectedAthlete.okul || selectedAthlete.kulup} &bull; {AEROBIK_CATEGORIES[selectedCategory]?.label || selectedCategory}</>
                                        }
                                    </p>
                                </div>
                                {scoreLocked ? (
                                    <div className="as-lock-banner">
                                        <i className="material-icons-round">lock</i>
                                        <span>Puan Kilitli</span>
                                        <button className="as-btn-unlock" onClick={handleUnlockRequest}>Kilidi Aç</button>
                                    </div>
                                ) : existingScores[selectedAthlete.id] && (
                                    <div className="as-override-warning">
                                        <i className="material-icons-round">warning</i> Önceki Puan Değiştiriliyor
                                    </div>
                                )}
                            </div>

                            <div className="as-scoring-grid">
                                {/* ══ A SCORE (Artistik) ══ */}
                                <div className="as-card as-card-purple">
                                    <div className="as-card-header as-card-header--purple">
                                        <h3>A Puanı — Artistik</h3>
                                        <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                                            {Object.keys(aPanelLocal).some(k => aPanelLocal[k] !== '' && aPanelLocal[k] != null) && (
                                                <button className="as-detail-btn" onClick={() => setShowADetail(true)}>
                                                    <i className="material-icons-round">info_outline</i>
                                                    Detay
                                                </button>
                                            )}
                                            <i className="material-icons-round">palette</i>
                                        </div>
                                    </div>
                                    <div className="as-card-body">
                                        <div className="as-judge-rows">
                                            {renderJudgeRows(aPanelLocal, setAPanelLocal, 'A', JUDGE_COUNT, aStatuses, 'purple')}
                                        </div>
                                        <div className="as-official-avg">
                                            <div className="as-official-avg-label">Resmî Ortalama</div>
                                            <div className="as-official-avg-value as-official-avg-value--purple">
                                                {aScore.toFixed(3)}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* ══ E SCORE (Uygulama) ══ */}
                                <div className="as-card as-card-green">
                                    <div className="as-card-header as-card-header--green">
                                        <h3>E Puanı — Uygulama</h3>
                                        <i className="material-icons-round">fitness_center</i>
                                    </div>
                                    <div className="as-card-body">
                                        <p className="as-hint">Hakem kesinti değerini girer (10.0'dan düşülür)</p>
                                        <div className="as-judge-rows">
                                            {renderJudgeRows(ePanelLocal, setEPanelLocal, 'E', JUDGE_COUNT, eStatuses, 'green')}
                                        </div>
                                        <div className="as-official-avg">
                                            <div className="as-official-avg-label">Ort. Kesinti → E Puanı</div>
                                            <div className="as-official-avg-value as-official-avg-value--green">
                                                {eScore.toFixed(3)}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* ══ D SCORE (Zorluk) ══ */}
                                <div className="as-card as-card-blue as-card-full-width">
                                    <div className="as-card-header as-card-header--blue">
                                        <h3>
                                            D Puanı — Zorluk
                                            {dPanelData ? (
                                                <span className="as-dpanel-badge as-dpanel-badge--sent">D Hakemi Gönderdi</span>
                                            ) : (
                                                <span className="as-dpanel-badge as-dpanel-badge--waiting">D Hakemi Bekleniyor</span>
                                            )}
                                        </h3>
                                        <i className="material-icons-round">emoji_events</i>
                                    </div>
                                    <div className="as-card-body">

                                        {/* ── Divisor selector (mandatory) ── */}
                                        <div className="as-divisor-row">
                                            <span className="as-divisor-label">
                                                <i className="material-icons-round">calculate</i>
                                                D Katsayısı
                                                {!selectedDivisor && <span className="as-divisor-required">Zorunlu</span>}
                                            </span>
                                            <div className="as-divisor-btns">
                                                {[1.8, 1.9, 2.0].map(v => (
                                                    <button
                                                        key={v}
                                                        className={`as-divisor-btn${selectedDivisor === v ? ' as-divisor-btn--active' : ''}`}
                                                        disabled={scoreLocked}
                                                        onClick={() => { setScoringFieldsTouched(true); setSelectedDivisor(v); }}
                                                    >
                                                        {v.toFixed(1)}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* ── D Panel Slots (from D judge) ── */}
                                        {dPanelData ? (
                                            <>
                                                <div className="as-dpanel-slots">
                                                    {D_SLOTS.map(s => {
                                                        const v = dPanelData.slots?.[s];
                                                        const filled = v != null;
                                                        return (
                                                            <div key={s} className={`as-dpanel-slot${filled ? ' as-dpanel-slot--filled' : ''}`}>
                                                                <span className="as-dpanel-slot-label">{D_SLOT_LABELS[s]}</span>
                                                                <span className="as-dpanel-slot-val">{filled ? Number(v).toFixed(1) : '—'}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                {dJudgeDed > 0 && (
                                                    <div className="as-dpanel-ded">
                                                        <span>D Hakemi Kesintisi</span>
                                                        <strong>−{dJudgeDed.toFixed(1)}</strong>
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            /* ── Fallback: element picker (admin entry) ── */
                                            <>
                                                <div className="as-hint">D hakemi henüz göndermedi. Manuel element girebilirsiniz.</div>
                                                <div className="as-element-list">
                                                    {selectedElements.length === 0 && (
                                                        <p className="as-hint">Henüz element eklenmedi.</p>
                                                    )}
                                                    {selectedElements.map(el => (
                                                        <div key={el.id} className="as-element-row">
                                                            <span className={`as-group-badge as-group-${el.group}`}>{el.group}</span>
                                                            <span className="as-element-family">{el.familyName}</span>
                                                            <span className="as-element-value">{el.value.toFixed(1)}</span>
                                                            {!scoreLocked && (
                                                                <button className="as-element-remove" onClick={() => removeElement(el.id)}>
                                                                    <i className="material-icons-round">close</i>
                                                                </button>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                                {!scoreLocked && selectedElements.length < maxElements && (
                                                    <button className="as-btn-add-element" onClick={() => setShowElementPicker(true)}>
                                                        <i className="material-icons-round">add_circle</i>
                                                        Element Ekle ({selectedElements.length}/{maxElements})
                                                    </button>
                                                )}
                                            </>
                                        )}

                                        <div className="as-d-summary">
                                            <span>Ham Toplam: {dRawSum.toFixed(2)}</span>
                                            <span>÷ {selectedDivisor != null ? selectedDivisor.toFixed(1) : '?'}</span>
                                            <strong className={selectedDivisor == null ? 'as-d-summary-placeholder' : ''}>
                                                = {selectedDivisor != null ? dScore.toFixed(3) : '—'}
                                            </strong>
                                        </div>
                                    </div>
                                </div>

                                {/* ══ PENALTIES / KESİNTİLER ══ */}
                                <div className="as-card as-card-red as-card-full-width">
                                    <div className="as-card-header as-card-header--red">
                                        <h3>Kesintiler</h3>
                                        <i className="material-icons-round">gavel</i>
                                    </div>
                                    <div className="as-card-body">
                                        {Object.entries(PENALTY_TYPES).map(([key, penType]) => {
                                            const curVal = parseFloat(penalties[key]) || 0;
                                            return (
                                                <div key={key} className="as-penalty-row">
                                                    <span className="as-penalty-label">{penType.label}</span>
                                                    <div className="as-penalty-btns">
                                                        {penType.options.map(v => (
                                                            <button key={v}
                                                                className={`as-penalty-btn${curVal === v ? ' selected' : ''}`}
                                                                disabled={scoreLocked}
                                                                onClick={() => { setScoringFieldsTouched(true); setPenalties(p => ({ ...p, [key]: v })); }}>
                                                                {v.toFixed(1)}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    {/* Manuel kesinti girişi */}
                                                    <input
                                                        type="number"
                                                        step="0.1"
                                                        min="0"
                                                        max="10"
                                                        className={`as-penalty-input${curVal > 0 && !penType.options.includes(curVal) ? ' as-penalty-input--custom' : ''}`}
                                                        value={curVal === 0 ? '' : curVal}
                                                        placeholder="0"
                                                        disabled={scoreLocked}
                                                        onChange={e => {
                                                            const raw = e.target.value;
                                                            const num = raw === '' ? 0 : Math.max(0, Math.min(10, parseFloat(raw) || 0));
                                                            setScoringFieldsTouched(true);
                                                            setPenalties(p => ({ ...p, [key]: num }));
                                                        }}
                                                    />
                                                </div>
                                            );
                                        })}
                                        <div className="as-score-summary">
                                            <span>Toplam Kesinti:</span>
                                            <span className="as-text-red">−{totalPenalties.toFixed(1)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Final Score Bar */}
                            <div className="as-final-bar">
                                <div className="as-fs-calc">
                                    <span className="as-fs-part as-score-chip-purple">A: {aScore.toFixed(3)}</span>
                                    <span className="as-fs-math">+</span>
                                    <span className="as-fs-part as-score-chip-green">E: {eScore.toFixed(3)}</span>
                                    <span className="as-fs-math">+</span>
                                    <span className={`as-fs-part as-score-chip-blue${selectedDivisor == null ? ' as-score-chip-pending' : ''}`}>
                                        D: {selectedDivisor != null ? dScore.toFixed(3) : '—'}
                                    </span>
                                    {dJudgeDed > 0 && (
                                        <>
                                            <span className="as-fs-math">−</span>
                                            <span className="as-fs-part as-score-chip-red">D Kes: {dJudgeDed.toFixed(1)}</span>
                                        </>
                                    )}
                                    {totalPenalties > 0 && (
                                        <>
                                            <span className="as-fs-math">−</span>
                                            <span className="as-fs-part as-score-chip-red">Kesinti: {totalPenalties.toFixed(1)}</span>
                                        </>
                                    )}
                                    <span className="as-fs-math">=</span>
                                </div>
                                <div className="as-final-score">{finalScore}</div>
                                {hasPermission('scoring', 'puanla') && (
                                    <button className="as-btn-save" onClick={handleSubmitScore} disabled={isSubmitting || scoreLocked}>
                                        {isSubmitting
                                            ? <div className="as-spinner" />
                                            : <i className="material-icons-round">{scoreLocked ? 'lock' : 'publish'}</i>}
                                        <span>{scoreLocked ? 'Puan Kilitli' : 'Kaydet'}</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </main>
            </div>

            {/* ─── Element Picker Modal ─── */}
            {showElementPicker && (
                <div className="as-modal-overlay" onClick={() => setShowElementPicker(false)}>
                    <div className="as-modal as-modal-wide" onClick={e => e.stopPropagation()}>
                        <div className="as-modal-header as-header-confirm">
                            <i className="material-icons-round">add_circle</i>
                            <h2>Element Seç ({selectedElements.length}/{maxElements})</h2>
                        </div>
                        <div className="as-modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                            {ELEMENT_FAMILIES.map(family => {
                                const familyCount  = selectedElements.filter(el => el.familyId === family.id).length;
                                const isFamilyFull = familyCount >= FAMILY_CONSTRAINTS.maxPerFamily;
                                return (
                                    <div key={family.id} className={`as-family-section${isFamilyFull ? ' as-family-full' : ''}`}>
                                        <div className="as-family-header">
                                            <span className={`as-group-badge as-group-${family.group}`}>{family.group}</span>
                                            <strong>{family.name}</strong>
                                            <span className="as-family-desc">{family.description}</span>
                                            {isFamilyFull && <span className="as-family-limit-badge">Dolu ({familyCount}/{FAMILY_CONSTRAINTS.maxPerFamily})</span>}
                                        </div>
                                        <div className="as-value-btns">
                                            {DIFFICULTY_VALUES.map(v => (
                                                <button key={v} className="as-value-btn" onClick={() => addElement(family, v)} disabled={isFamilyFull}>
                                                    {v.toFixed(1)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="as-modal-actions">
                            <button className="as-modal-btn as-modal-cancel" onClick={() => setShowElementPicker(false)}>Kapat</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Confirm Modal ─── */}
            {confirmModal && (
                <div className="as-modal-overlay" onClick={() => setConfirmModal(null)}>
                    <div className="as-modal" onClick={e => e.stopPropagation()}>
                        <div className="as-modal-header as-header-confirm">
                            <i className="material-icons-round">fact_check</i>
                            <h2>Puan Onayı</h2>
                        </div>
                        <div className="as-modal-body">
                            <div className="as-modal-athlete">
                                <div className="as-modal-avatar">
                                    {isStepCategory
                                        ? confirmModal.athlete.ad.charAt(0)
                                        : `${confirmModal.athlete.ad.charAt(0)}${confirmModal.athlete.soyad.charAt(0)}`
                                    }
                                </div>
                                <div>
                                    <h3>{isStepCategory ? confirmModal.athlete.ad : `${confirmModal.athlete.ad} ${confirmModal.athlete.soyad}`}</h3>
                                    <p>{isStepCategory ? confirmModal.category : `${confirmModal.athlete.okul || confirmModal.athlete.kulup} • ${confirmModal.category}`}</p>
                                </div>
                            </div>
                            <div className="as-modal-scores">
                                <div className="as-modal-score-item purple"><span>A Puanı</span><strong>{confirmModal.aScore.toFixed(3)}</strong></div>
                                <div className="as-modal-score-item green"><span>E Puanı</span><strong>{confirmModal.eScore.toFixed(3)}</strong></div>
                                <div className="as-modal-score-item blue"><span>D Puanı</span><strong>{confirmModal.dScore.toFixed(3)}</strong></div>
                                {confirmModal.totalPenalties > 0 && (
                                    <div className="as-modal-score-item red"><span>Kesinti</span><strong>−{confirmModal.totalPenalties.toFixed(1)}</strong></div>
                                )}
                            </div>
                            <div className="as-modal-final">
                                <span>Final Puanı</span>
                                <strong>{confirmModal.finalScore}</strong>
                            </div>
                        </div>
                        <div className="as-modal-actions">
                            <button className="as-modal-btn as-modal-cancel" onClick={() => setConfirmModal(null)}>
                                <i className="material-icons-round">close</i> Vazgeç
                            </button>
                            <button className="as-modal-btn as-modal-confirm" onClick={executeScoreSave} disabled={isSubmitting}>
                                {isSubmitting ? <div className="as-spinner" /> : <i className="material-icons-round">check</i>}
                                Onayla ve Kaydet
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Success Modal ─── */}
            {successModal && (
                <div className="as-modal-overlay">
                    <div className="as-modal">
                        <div className="as-modal-header as-header-success">
                            <i className="material-icons-round">check_circle</i>
                            <h2>Puan Kaydedildi</h2>
                        </div>
                        <div className="as-modal-body">
                            <div className="as-modal-athlete">
                                <div className="as-modal-avatar as-avatar-success">
                                    {isStepCategory
                                        ? successModal.athlete.ad.charAt(0)
                                        : `${successModal.athlete.ad.charAt(0)}${successModal.athlete.soyad.charAt(0)}`
                                    }
                                </div>
                                <div>
                                    <h3>{isStepCategory ? successModal.athlete.ad : `${successModal.athlete.ad} ${successModal.athlete.soyad}`}</h3>
                                    <p>{successModal.category}</p>
                                </div>
                                <div className="as-saved-badge">{successModal.finalScore}</div>
                            </div>
                            {successModal.nextAthlete ? (
                                <div className="as-next-section">
                                    <div className="as-next-divider"><span>{isStepCategory ? 'Sıradaki Takım' : 'Sıradaki Sporcu'}</span></div>
                                    <div className="as-next-card">
                                        <div className="as-next-avatar">
                                            {isStepCategory
                                                ? successModal.nextAthlete.ad.charAt(0)
                                                : `${successModal.nextAthlete.ad.charAt(0)}${successModal.nextAthlete.soyad.charAt(0)}`
                                            }
                                        </div>
                                        <div className="as-next-info">
                                            <h3>{isStepCategory ? successModal.nextAthlete.ad : `${successModal.nextAthlete.ad} ${successModal.nextAthlete.soyad}`}</h3>
                                            {!isStepCategory && <p>{successModal.nextAthlete.okul || ''}</p>}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="as-next-section">
                                    <div className="as-next-divider"><span>{isStepCategory ? 'Tüm takımlar puanlandı' : 'Tüm sporcular puanlandı'}</span></div>
                                </div>
                            )}
                        </div>
                        <div className="as-modal-actions">
                            <button className="as-modal-btn as-modal-cancel" onClick={() => setSuccessModal(null)}>Kapat</button>
                            {successModal.nextAthlete && (
                                <button className="as-modal-btn as-modal-next" onClick={() => handleNextAthlete(successModal.nextAthlete)}>
                                    <i className="material-icons-round">campaign</i>
                                    {isStepCategory ? 'Takımı Çağır' : 'Sporcuyu Çağır'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Unlock Modal ─── */}
            {unlockModal && (
                <div className="as-modal-overlay" onClick={() => setUnlockModal(null)}>
                    <div className="as-modal" onClick={e => e.stopPropagation()}>
                        <div className="as-modal-header as-header-unlock">
                            <i className="material-icons-round">lock_open</i>
                            <h2>Puan Kilidi Aç</h2>
                        </div>
                        <div className="as-modal-body">
                            <div className="as-modal-athlete">
                                <div className="as-modal-avatar">{unlockModal.athleteName.charAt(0)}</div>
                                <div>
                                    <h3>{unlockModal.athleteName}</h3>
                                    <p>Bu {isStepCategory ? 'takımın' : 'sporcunun'} puanı kilitlidir. Düzenleme için kilidi açın.</p>
                                </div>
                            </div>
                            <div className="as-unlock-form">
                                <label>Süper Admin veya Komite Şifresi</label>
                                <input
                                    type="password"
                                    className="as-unlock-input"
                                    value={unlockPassword}
                                    onChange={e => setUnlockPassword(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleUnlockSubmit()}
                                    placeholder="Şifre girin..."
                                    autoFocus
                                />
                                {unlockError && <p className="as-unlock-error">{unlockError}</p>}
                            </div>
                        </div>
                        <div className="as-modal-actions">
                            <button className="as-modal-btn as-modal-cancel" onClick={() => setUnlockModal(null)}>
                                <i className="material-icons-round">close</i> Vazgeç
                            </button>
                            <button className="as-modal-btn as-modal-confirm" onClick={handleUnlockSubmit} disabled={unlockingInProgress}>
                                {unlockingInProgress ? <div className="as-spinner" /> : <i className="material-icons-round">lock_open</i>}
                                Kilidi Aç
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* ─── A Panel Detail Modal ─── */}
            {showADetail && selectedAthlete && (
                <div className="as-modal-overlay" onClick={() => setShowADetail(false)}>
                    <div className="as-adetail-modal" onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div className="as-adetail-header">
                            <div className="as-adetail-header-left">
                                <i className="material-icons-round">palette</i>
                                <div>
                                    <div className="as-adetail-title">A Jürisi Detayı</div>
                                    <div className="as-adetail-sub">
                                    {isStepCategory ? selectedAthlete.ad : `${selectedAthlete.ad} ${selectedAthlete.soyad}`}
                                </div>
                                </div>
                            </div>
                            <button className="as-adetail-close" onClick={() => setShowADetail(false)}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>

                        {/* Judge rows */}
                        <div className="as-adetail-body">
                            {[1, 2, 3, 4].map(i => {
                                const jKey     = `j${i}`;
                                const panelId  = `a${i}`;
                                const name     = competitions[selectedCompId]?.hakemler?.[selectedCategory]?.[panelId]
                                                 || `A${i} Hakemi`;
                                const score    = aPanelLocal[jKey];
                                const hasScore = score !== undefined && score !== null && score !== '';
                                const st       = aStatuses[jKey];
                                const breakdown = existingScores[selectedAthlete.id]?.aPanelBreakdown?.[jKey];

                                let statusCls = 'as-adetail-status--empty';
                                let statusTxt = 'Bekleniyor';
                                if (hasScore) {
                                    if (st === 'kept' || st === 'only') { statusCls = 'as-adetail-status--kept'; statusTxt = 'Ortalamada'; }
                                    else if (st === 'low')              { statusCls = 'as-adetail-status--low';  statusTxt = 'Kesildi ↓'; }
                                    else if (st === 'high')             { statusCls = 'as-adetail-status--high'; statusTxt = 'Kesildi ↑'; }
                                }

                                return (
                                    <div key={jKey} className={`as-adetail-judge${hasScore ? ' as-adetail-judge--scored' : ''}`}>
                                        {/* Judge summary row */}
                                        <div className="as-adetail-judge-top">
                                            <div className="as-adetail-judge-num">A{i}</div>
                                            <div className="as-adetail-judge-name">{name}</div>
                                            <div className={`as-adetail-status ${statusCls}`}>{statusTxt}</div>
                                            <div className="as-adetail-score">
                                                {hasScore ? Number(score).toFixed(1) : '—'}
                                            </div>
                                        </div>

                                        {/* Criteria breakdown (if available) */}
                                        {breakdown?.criteriaValues && (
                                            <div className="as-adetail-breakdown">
                                                {Object.entries(breakdown.criteriaValues).map(([k, v]) => (
                                                    <div key={k} className="as-adetail-criterion">
                                                        <span className="as-adetail-criterion-label">
                                                            {A_CRITERIA_LABELS[k] || k}
                                                        </span>
                                                        <span className="as-adetail-criterion-val">{Number(v).toFixed(1)}</span>
                                                    </div>
                                                ))}
                                                {/* Deductions */}
                                                {Object.entries(breakdown.deductionValues || {}).filter(([, v]) => v > 0).map(([k, v]) => (
                                                    <div key={k} className="as-adetail-criterion as-adetail-criterion--ded">
                                                        <span className="as-adetail-criterion-label">
                                                            {A_DEDUCTION_LABELS[k] || k} ×{v}
                                                        </span>
                                                        <span className="as-adetail-criterion-val">−{(v * 0.5).toFixed(1)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Footer: official average */}
                        <div className="as-adetail-footer">
                            <span>Resmî Ortalama</span>
                            <strong>{aScore.toFixed(3)}</strong>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
