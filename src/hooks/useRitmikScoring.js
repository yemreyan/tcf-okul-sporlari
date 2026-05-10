/**
 * useRitmikScoring — Ritmik Puanlama Paylaşılan Mantık Hook'u
 * Tüm Firebase okuma/yazma, hesaplama ve handler'lar burada.
 * Modern ve Classic layout aynı hook'u kullanır.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { RITMIK_CATEGORIES, RITMIK_ALETLER } from '../data/ritmikCriteriaDefaults';
import { useAuth } from '../lib/AuthContext';
import { useDiscipline } from '../lib/DisciplineContext';
import { useOffline } from '../lib/OfflineContext';
import { useNotification } from '../lib/NotificationContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { logAction } from '../lib/auditLogger';

// Eşikler — backward compat (kullanılan eski değerler korunuyor)
export const DA_GAP_THRESHOLD = 0.5;
export const DB_GAP_THRESHOLD = 0.5;
export const AE_GAP_THRESHOLD = 1.0;

// 3-seviyeli renkli gap eşikleri (kesin/ortalama ↔ SJ karşılaştırması için)
export const GAP_LEVEL_OK   = 0.30; // ≤ 0.30 → yeşil
export const GAP_LEVEL_WARN = 0.50; // ≤ 0.50 → turuncu, > 0.50 → kırmızı

export const getGapLevel = (gap) => {
    if (!isFinite(gap) || gap <= GAP_LEVEL_OK)   return 'ok';
    if (gap <= GAP_LEVEL_WARN)                    return 'warn';
    return 'err';
};

export function useRitmikScoring() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { currentUser, hashPassword } = useAuth();
    const { firebasePath } = useDiscipline();
    const { offlineWrite } = useOffline();
    const { toast } = useNotification();

    // URL parametrelerinden başlangıç değerleri (QR link ile açılınca)
    const initCompId  = searchParams.get('competitionId') || '';
    const initCatId   = searchParams.get('catId')         || '';

    // ─── Seçimler ───
    const [competitions, setCompetitions]         = useState({});
    const [selectedCity, setSelectedCity]         = useState('');
    const [selectedCompId, setSelectedCompId]     = useState(initCompId);
    const [selectedCategory, setSelectedCategory] = useState(initCatId);

    // ─── Sporcular ───
    const [athletesByRotation, setAthletesByRotation] = useState([]);
    const [existingScores, setExistingScores]         = useState({});
    const [selectedAthlete, setSelectedAthlete]       = useState(null);
    const [isAthleteCalled, setIsAthleteCalled]       = useState(false);

    // ─── Alet ───
    const [selectedAlet, setSelectedAlet] = useState('top');

    // ─── Modern Layout Alanları ───
    const [aPanelLocal, setAPanelLocal] = useState({});
    const [ePanelLocal, setEPanelLocal] = useState({});
    const [dbScoreInput, setDbScoreInput] = useState('');
    const [daScoreInput, setDaScoreInput] = useState('');
    const [penaltyInput, setPenaltyInput] = useState('');

    // ─── Classic Layout Ek Alanları ───
    // da/db = DA1 hakeminin girdiği kesin skor (hesaba katılan)
    // da1/da2/sjda = bilgi amaçlı (hesaba dahil değil)
    const [classicDA, setClassicDA] = useState({ da: '', da1: '', da2: '', sjda: '' });
    const [classicDB, setClassicDB] = useState({ db: '', db1: '', db2: '', sjdb: '' });
    const [sjaInput, setSjaInput]   = useState('');
    const [sjeInput, setSjeInput]   = useState('');
    const [classicPenalty, setClassicPenalty] = useState({
        koordinator: '', cizgi1: '', cizgi2: '', zaman: '',
    });

    // ─── Kilit ───
    const [unlockModal, setUnlockModal]               = useState(null);
    const [unlockPassword, setUnlockPassword]         = useState('');
    const [unlockError, setUnlockError]               = useState('');
    const [unlockingInProgress, setUnlockingInProgress] = useState(false);
    const [scoringFieldsTouched, setScoringFieldsTouched] = useState(false);

    // ─── UI ───
    const [sidebarOpen, setSidebarOpen]   = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [confirmModal, setConfirmModal] = useState(null);
    const [successModal, setSuccessModal] = useState(null);

    // ─── Firebase: Yarışmalar ───
    useEffect(() => {
        const unsub = onValue(ref(db, firebasePath), (snap) => {
            setCompetitions(filterCompetitionsByUser(snap.val() || {}, currentUser));
        });
        return () => unsub();
    }, [currentUser, firebasePath]);

    // ─── Firebase: Sporcular + Puanlar ───
    useEffect(() => {
        if (!selectedCompId || !selectedCategory) {
            setAthletesByRotation([]);
            setExistingScores({});
            setSelectedAthlete(null);
            setIsAthleteCalled(false);
            return;
        }
        const orderRef = ref(db, `${firebasePath}/${selectedCompId}/siralama/${selectedCategory}`);
        const unsubOrder = onValue(orderRef, (snap) => {
            const orderData = snap.val();
            const rotations = [];
            if (orderData) {
                const maxRots = Math.max(...Object.keys(orderData)
                    .map(k => parseInt(k.replace('rotation_', '')))
                    .filter(n => !isNaN(n)));
                for (let i = 0; i <= maxRots; i++) {
                    const rotData = orderData[`rotation_${i}`];
                    if (rotData) {
                        const arr = Object.keys(rotData)
                            .map(id => ({ id, ...rotData[id] }))
                            .sort((a, b) => a.sirasi - b.sirasi);
                        rotations.push(arr);
                    } else {
                        rotations.push([]);
                    }
                }
                setAthletesByRotation(rotations);
            } else {
                const fbRef = ref(db, `${firebasePath}/${selectedCompId}/sporcular/${selectedCategory}`);
                get(fbRef).then((fbSnap) => {
                    const fbData = fbSnap.val();
                    if (fbData) {
                        const arr = Object.keys(fbData).map((id, idx) => ({
                            id, ...fbData[id], _kayitSirasi: idx + 1,
                        }));
                        arr.sort((a, b) => {
                            const sa = (a.cikisSirasi !== undefined && a.cikisSirasi !== 999)
                                ? a.cikisSirasi : a._kayitSirasi;
                            const sb = (b.cikisSirasi !== undefined && b.cikisSirasi !== 999)
                                ? b.cikisSirasi : b._kayitSirasi;
                            return sa - sb;
                        });
                        setAthletesByRotation([arr]);
                    }
                });
            }
        });

        const scoresRef = ref(db, `${firebasePath}/${selectedCompId}/puanlar/${selectedCategory}`);
        let firstScoreSnap = true;
        const unsubScores = onValue(scoresRef, (snap) => {
            const val = snap.val();
            // Network glitch / kısa süreli null koruması:
            //   İlk yüklemede null gelirse {} set et.
            //   Sonraki onay'larda null gelirse önceki state'i koru (veri kaybı olmasın).
            if (val !== null && val !== undefined) {
                setExistingScores(val);
                firstScoreSnap = false;
            } else if (firstScoreSnap) {
                setExistingScores({});
                firstScoreSnap = false;
            }
            // val === null && !firstScoreSnap → mevcut state'e dokunma
        });

        return () => { unsubOrder(); unsubScores(); };
    }, [selectedCompId, selectedCategory, firebasePath]);

    // ── Manuel refresh: hakem notları gecikirse buton ile zorla çek ──
    // Önemli: scoringFieldsTouched=true ise sync useEffect Firebase verilerini panellere yansıtmaz.
    //         Bu yüzden refresh sırasında touched flag'ini de sıfırlıyoruz.
    const refreshScores = useCallback(async () => {
        if (!selectedCompId || !selectedCategory) return;
        try {
            const snap = await get(ref(db, `${firebasePath}/${selectedCompId}/puanlar/${selectedCategory}`));
            setScoringFieldsTouched(false);   // touched filtresini bypass et
            setExistingScores(snap.val() || {});
        } catch (e) {
            if (import.meta.env.DEV) console.error('refreshScores error', e);
        }
    }, [selectedCompId, selectedCategory, firebasePath]);

    // ─── A/E panel hakem notları için ÖZEL sync (touched bağımsız) ───
    // Başhakem A1-A4 / E1-E4 alanlarına genelde manuel müdahale etmez;
    // sadece SİL yapınca o alan unlock olur. Bu yüzden hakem notları
    // her existingScores değişiminde panellere yansımalı, touched filtresi UYGULANMAMALI.
    useEffect(() => {
        if (!selectedAthlete) return;
        const sc = existingScores[selectedAthlete.id]?.[selectedAlet];
        if (sc) {
            if (sc.aPanel) setAPanelLocal(sc.aPanel);
            if (sc.ePanel) setEPanelLocal(sc.ePanel);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [existingScores, selectedAthlete?.id, selectedAlet]);

    // ─── Panel senkronizasyonu (sporcu/alet değişince) ───
    useEffect(() => {
        if (!selectedAthlete || scoringFieldsTouched) return;
        const sc = existingScores[selectedAthlete.id]?.[selectedAlet];
        if (sc) {
            // Modern
            setAPanelLocal(sc.aPanel || {});
            setEPanelLocal(sc.ePanel || {});
            setDbScoreInput(sc.dbScore != null ? String(sc.dbScore) : '');
            setDaScoreInput(sc.daScore != null ? String(sc.daScore) : '');
            setPenaltyInput(sc.penaltyTotal != null ? String(sc.penaltyTotal) : '');
            // Classic
            setClassicDA({
                da:   sc.da   != null ? String(sc.da)   : '',
                da1:  sc.da1  != null ? String(sc.da1)  : '',
                da2:  sc.da2  != null ? String(sc.da2)  : '',
                sjda: sc.sjda != null ? String(sc.sjda) : '',
            });
            setClassicDB({
                db:   sc.db   != null ? String(sc.db)   : '',
                db1:  sc.db1  != null ? String(sc.db1)  : '',
                db2:  sc.db2  != null ? String(sc.db2)  : '',
                sjdb: sc.sjdb != null ? String(sc.sjdb) : '',
            });
            setSjaInput(sc.sja != null ? String(sc.sja) : '');
            setSjeInput(sc.sje != null ? String(sc.sje) : '');
            // L (Çizgi 1/2) ve T (Zaman) hakem panellerinden gelen otomatik veri fallback'i:
            // Başhakem manuel girmediyse panel hakemlerinin verisi gösterilir.
            setClassicPenalty({
                koordinator: sc.penaltyKoordinatör != null ? String(sc.penaltyKoordinatör) : '',
                cizgi1:      sc.penaltyCizgi1      != null ? String(sc.penaltyCizgi1)
                            : sc.lPanel?.cizgi1   != null ? String(sc.lPanel.cizgi1) : '',
                cizgi2:      sc.penaltyCizgi2      != null ? String(sc.penaltyCizgi2)
                            : sc.lPanel?.cizgi2   != null ? String(sc.lPanel.cizgi2) : '',
                zaman:       sc.penaltyZaman       != null ? String(sc.penaltyZaman)
                            : sc.tPanel?.zaman    != null ? String(sc.tPanel.zaman) : '',
            });
        }
        // Not: sc yoksa resetPanel ÇAĞIRMIYORUZ — Firebase listener bir anlık null/boş
        // yanıt verirse mevcut panel verisi kaybolmamalı. Reset sadece sporcu/alet
        // değişiminde (handleSelectAthlete, handleSelectAlet) yapılır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [existingScores, selectedAthlete?.id, selectedAlet]);

    // ─── Türevler ───
    const catConfig  = RITMIK_CATEGORIES[selectedCategory] || {};
    const judgeCount = catConfig.judgeCount || 4;
    const scoreLocked = existingScores[selectedAthlete?.id]?.[selectedAlet]?.kilitli === true;

    const availableCities = [...new Set(
        Object.values(competitions)
            .map(c => (c.il || c.city || '').toLocaleUpperCase('tr-TR'))
            .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'tr-TR'));

    const compOptions = Object.entries(competitions)
        .filter(([, comp]) => !selectedCity ||
            (comp.il || comp.city || '').toLocaleUpperCase('tr-TR') === selectedCity)
        .sort((a, b) =>
            new Date(b[1].tarih || b[1].baslangicTarihi || 0) -
            new Date(a[1].tarih || a[1].baslangicTarihi || 0));

    let categoryOptions = [];
    if (selectedCompId && competitions[selectedCompId]?.sporcular) {
        categoryOptions = Object.keys(competitions[selectedCompId].sporcular);
    } else if (selectedCompId && competitions[selectedCompId]?.kategoriler) {
        categoryOptions = Object.keys(competitions[selectedCompId].kategoriler);
    }

    // ─── Hesaplamalar: Modern ───
    const calcPanelScore = useCallback((panelLocal, jCount) => {
        const vals = [];
        for (let i = 1; i <= jCount; i++) {
            const v = parseFloat(panelLocal[`j${i}`]);
            if (!isNaN(v)) vals.push(v);
        }
        if (vals.length === 0) return 0;
        if (vals.length >= 4) {
            vals.sort((a, b) => a - b);
            const trimmed = vals.slice(1, -1);
            const avg = trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
            return Math.max(0, 10 - avg);
        }
        const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
        return Math.max(0, 10 - avg);
    }, []);

    const aScore         = calcPanelScore(aPanelLocal, judgeCount);
    const eScore         = calcPanelScore(ePanelLocal, judgeCount);
    const dbScore        = parseFloat(dbScoreInput) || 0;
    const daScoreNum     = parseFloat(daScoreInput)  || 0;
    const totalPenalties = parseFloat(penaltyInput)   || 0;
    const modernFinalScore = Math.max(0,
        daScoreNum + dbScore + aScore + eScore - totalPenalties
    ).toFixed(3);

    // ─── Hesaplamalar: Classic D Paneli ───
    // da / db  = DA1 hakeminin girdiği KESİN SKOR → hesaba katılan tek değer
    // da1/da2/sjda ve db1/db2/sjdb = BİLGİ AMAÇLI (hesaba dahil değil)
    // Uyarı: "da", "db" adları import { db } ile çakışmasın diye "Num" soneki eklendi
    const daNum   = parseFloat(classicDA.da)   || 0;
    const da1Num  = parseFloat(classicDA.da1)  || 0;
    const da2Num  = parseFloat(classicDA.da2)  || 0;
    const sjdaNum = parseFloat(classicDA.sjda) || 0;
    // GAP DA: kesin DA skoru ile SJDA arasındaki fark
    //   ≤ 0.30 yeşil, 0.30-0.50 turuncu, > 0.50 kırmızı
    const daGap      = (classicDA.da !== '' && classicDA.sjda !== '')
        ? Math.abs(daNum - sjdaNum) : 0;
    const daGapLevel = getGapLevel(daGap);
    const daGapOk    = daGapLevel === 'ok';
    // Kesin skor = classicDA.da alanından
    const classicDaScore = classicDA.da !== '' ? parseFloat((daNum).toFixed(3)) : 0;

    const dbNum   = parseFloat(classicDB.db)   || 0;
    const db1Num  = parseFloat(classicDB.db1)  || 0;
    const db2Num  = parseFloat(classicDB.db2)  || 0;
    const sjdbNum = parseFloat(classicDB.sjdb) || 0;
    // GAP DB: kesin DB ile SJDB arası
    const dbGap      = (classicDB.db !== '' && classicDB.sjdb !== '')
        ? Math.abs(dbNum - sjdbNum) : 0;
    const dbGapLevel = getGapLevel(dbGap);
    const dbGapOk    = dbGapLevel === 'ok';
    const classicDbScore = classicDB.db !== '' ? parseFloat((dbNum).toFixed(3)) : 0;

    const classicDTotal = parseFloat((classicDaScore + classicDbScore).toFixed(3));

    // ─── Hesaplamalar: Classic A/E Paneli ───
    // SJA / SJE = BİLGİ AMAÇLI — A/E ortalamasına dahil değil
    // A/E hakemler kesinti (0-10) girer → skor = 10 - trimmedAvg(kesintiler)
    // GAP: A ortalaması ↔ SJA / E ortalaması ↔ SJE arasındaki fark
    //   ≤ 0.30 yeşil, 0.30-0.50 turuncu, > 0.50 kırmızı
    const calcClassicPanel = useCallback((panelLocal, jCount, sjValue) => {
        const vals = [];
        for (let i = 1; i <= jCount; i++) {
            const v = parseFloat(panelLocal[`j${i}`]);
            if (!isNaN(v)) vals.push(v);
        }

        if (vals.length === 0) {
            return { score: 0, avg: 0, gap: 0, gapOk: true, gapLevel: 'ok', trimmedAvg: 0 };
        }

        const sorted = [...vals].sort((a, b) => a - b);
        // 4 veya daha fazla hakem varsa en yüksek ve en düşüğü at
        const trimmed    = vals.length >= 4 ? sorted.slice(1, -1) : sorted;
        const trimmedAvg = trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
        const avgAll     = vals.reduce((s, v) => s + v, 0) / vals.length;
        const score      = Math.max(0, 10 - trimmedAvg);

        // SJ değeri ile karşılaştır → gap = |panel ortalaması (trimmedAvg) - SJ|
        // Not: ekranda gösterilen "A Ortalama" / "E Ortalama" trimmedAvg (en yüksek+en düşük atılmış)
        // GAP de aynı değer üzerinden hesaplanır ki UI ile tutarlı olsun.
        const sjNum   = parseFloat(sjValue);
        const sjValid = sjValue !== '' && sjValue !== null && sjValue !== undefined && !isNaN(sjNum);
        const gap     = sjValid ? Math.abs(trimmedAvg - sjNum) : 0;
        const gapLevel = getGapLevel(gap);
        const gapOk   = gapLevel === 'ok';

        return { score, avg: avgAll, trimmedAvg, gap, gapOk, gapLevel };
    }, []);

    // A/E paneli SJ değeri ile karşılaştır
    const classicAResult = calcClassicPanel(aPanelLocal, judgeCount, sjaInput);
    const classicEResult = calcClassicPanel(ePanelLocal, judgeCount, sjeInput);

    // ─── Hesaplamalar: Classic Kesintiler ───
    const cKoord  = parseFloat(classicPenalty.koordinator) || 0;
    const cCizgi1 = parseFloat(classicPenalty.cizgi1)      || 0;
    const cCizgi2 = parseFloat(classicPenalty.cizgi2)      || 0;
    const cZaman  = parseFloat(classicPenalty.zaman)        || 0;
    const classicTotalPenalty = parseFloat((cKoord + cCizgi1 + cCizgi2 + cZaman).toFixed(3));

    const classicFinalScore = Math.max(0,
        classicDTotal + classicAResult.score + classicEResult.score - classicTotalPenalty
    ).toFixed(3);

    // ─── Handlers ───
    const resetPanel = useCallback(() => {
        setAPanelLocal({});
        setEPanelLocal({});
        setDbScoreInput('');
        setDaScoreInput('');
        setPenaltyInput('');
        setClassicDA({ da: '', da1: '', da2: '', sjda: '' });
        setClassicDB({ db: '', db1: '', db2: '', sjdb: '' });
        setSjaInput('');
        setSjeInput('');
        setClassicPenalty({ koordinator: '', cizgi1: '', cizgi2: '', zaman: '' });
        setScoringFieldsTouched(false);
    }, []);

    const handleSelectAthlete = useCallback((athlete) => {
        if (selectedAthlete?.id === athlete.id) return;
        setSelectedAthlete(athlete);
        setIsAthleteCalled(false);
        setScoringFieldsTouched(false);
        setSelectedAlet('top');
        const sc = existingScores[athlete.id]?.['top'];
        if (sc) {
            setAPanelLocal(sc.aPanel || {});
            setEPanelLocal(sc.ePanel || {});
            setDbScoreInput(sc.dbScore != null ? String(sc.dbScore) : '');
            setDaScoreInput(sc.daScore != null ? String(sc.daScore) : '');
            setPenaltyInput(sc.penaltyTotal != null ? String(sc.penaltyTotal) : '');
            setClassicDA({
                da:   sc.da   != null ? String(sc.da)   : '',
                da1:  sc.da1  != null ? String(sc.da1)  : '',
                da2:  sc.da2  != null ? String(sc.da2)  : '',
                sjda: sc.sjda != null ? String(sc.sjda) : '',
            });
            setClassicDB({
                db:   sc.db   != null ? String(sc.db)   : '',
                db1:  sc.db1  != null ? String(sc.db1)  : '',
                db2:  sc.db2  != null ? String(sc.db2)  : '',
                sjdb: sc.sjdb != null ? String(sc.sjdb) : '',
            });
            setSjaInput(sc.sja != null ? String(sc.sja) : '');
            setSjeInput(sc.sje != null ? String(sc.sje) : '');
            // L (Çizgi 1/2) ve T (Zaman) hakem panellerinden gelen otomatik veri fallback'i:
            // Başhakem manuel girmediyse panel hakemlerinin verisi gösterilir.
            setClassicPenalty({
                koordinator: sc.penaltyKoordinatör != null ? String(sc.penaltyKoordinatör) : '',
                cizgi1:      sc.penaltyCizgi1      != null ? String(sc.penaltyCizgi1)
                            : sc.lPanel?.cizgi1   != null ? String(sc.lPanel.cizgi1) : '',
                cizgi2:      sc.penaltyCizgi2      != null ? String(sc.penaltyCizgi2)
                            : sc.lPanel?.cizgi2   != null ? String(sc.lPanel.cizgi2) : '',
                zaman:       sc.penaltyZaman       != null ? String(sc.penaltyZaman)
                            : sc.tPanel?.zaman    != null ? String(sc.tPanel.zaman) : '',
            });
        } else {
            resetPanel();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedAthlete?.id, existingScores, resetPanel]);

    const handleSelectAlet = useCallback((aletKey) => {
        if (aletKey === selectedAlet) return;
        setSelectedAlet(aletKey);
        setScoringFieldsTouched(false);
        if (isAthleteCalled && selectedCompId && selectedCategory) {
            update(ref(db), {
                [`${firebasePath}/${selectedCompId}/aktifAlet/${selectedCategory}`]: aletKey,
            }).catch(() => {});
        }
        const sc = existingScores[selectedAthlete?.id]?.[aletKey];
        if (sc) {
            setAPanelLocal(sc.aPanel || {});
            setEPanelLocal(sc.ePanel || {});
            setDbScoreInput(sc.dbScore != null ? String(sc.dbScore) : '');
            setDaScoreInput(sc.daScore != null ? String(sc.daScore) : '');
            setPenaltyInput(sc.penaltyTotal != null ? String(sc.penaltyTotal) : '');
            setClassicDA({
                da:   sc.da   != null ? String(sc.da)   : '',
                da1:  sc.da1  != null ? String(sc.da1)  : '',
                da2:  sc.da2  != null ? String(sc.da2)  : '',
                sjda: sc.sjda != null ? String(sc.sjda) : '',
            });
            setClassicDB({
                db:   sc.db   != null ? String(sc.db)   : '',
                db1:  sc.db1  != null ? String(sc.db1)  : '',
                db2:  sc.db2  != null ? String(sc.db2)  : '',
                sjdb: sc.sjdb != null ? String(sc.sjdb) : '',
            });
            setSjaInput(sc.sja != null ? String(sc.sja) : '');
            setSjeInput(sc.sje != null ? String(sc.sje) : '');
            // L (Çizgi 1/2) ve T (Zaman) hakem panellerinden gelen otomatik veri fallback'i:
            // Başhakem manuel girmediyse panel hakemlerinin verisi gösterilir.
            setClassicPenalty({
                koordinator: sc.penaltyKoordinatör != null ? String(sc.penaltyKoordinatör) : '',
                cizgi1:      sc.penaltyCizgi1      != null ? String(sc.penaltyCizgi1)
                            : sc.lPanel?.cizgi1   != null ? String(sc.lPanel.cizgi1) : '',
                cizgi2:      sc.penaltyCizgi2      != null ? String(sc.penaltyCizgi2)
                            : sc.lPanel?.cizgi2   != null ? String(sc.lPanel.cizgi2) : '',
                zaman:       sc.penaltyZaman       != null ? String(sc.penaltyZaman)
                            : sc.tPanel?.zaman    != null ? String(sc.tPanel.zaman) : '',
            });
        } else {
            resetPanel();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedAlet, isAthleteCalled, selectedCompId, selectedCategory,
        firebasePath, existingScores, selectedAthlete?.id, resetPanel]);

    const handleCallAthlete = useCallback(async () => {
        setIsAthleteCalled(true);
        try {
            // Sporcu bilgilerini object olarak yaz → panel sayfaları (L, T) tek event'te ad/soyad/okul'u alır
            const payload = {
                id:    selectedAthlete.id,
                ad:    selectedAthlete.ad    || '',
                soyad: selectedAthlete.soyad || '',
                okul:  selectedAthlete.okul  || selectedAthlete.kulup || '',
            };
            await update(ref(db), {
                [`${firebasePath}/${selectedCompId}/aktifSporcu/${selectedCategory}`]:     payload,
                [`${firebasePath}/${selectedCompId}/aktifSporcuBilgi/${selectedCategory}`]: payload,
                [`${firebasePath}/${selectedCompId}/aktifAlet/${selectedCategory}`]:        selectedAlet,
            });
        } catch (e) { if (import.meta.env.DEV) console.error('aktifSporcu error', e); }
    }, [firebasePath, selectedCompId, selectedCategory, selectedAthlete, selectedAlet]);

    const getNextAthlete = useCallback(() => {
        if (!selectedAthlete || athletesByRotation.length === 0) return null;
        const all = athletesByRotation.flat();
        const idx = all.findIndex(a => a.id === selectedAthlete.id);
        if (idx === -1 || idx >= all.length - 1) return null;
        return all[idx + 1];
    }, [selectedAthlete, athletesByRotation]);

    // ─── Submit: ortak kayıt ───
    const handleConfirmSubmit = useCallback(async (scoreData) => {
        if (!confirmModal) return;
        setIsSubmitting(true);
        const basePath = `${firebasePath}/${selectedCompId}/puanlar/${selectedCategory}/${selectedAthlete.id}`;
        try {
            const otherAlet  = selectedAlet === 'top' ? 'kurdele' : 'top';
            const otherScore = existingScores[selectedAthlete.id]?.[otherAlet];
            const otherSonuc = otherScore?.durum === 'tamamlandi' ? (parseFloat(otherScore.sonuc) || 0) : 0;
            const bothDone   = otherScore?.durum === 'tamamlandi';
            const newToplam  = scoreData.sonuc + otherSonuc;

            const updates = {
                [`${basePath}/${selectedAlet}`]:  scoreData,
                [`${basePath}/sonuc`]:             newToplam,
                [`${basePath}/durum`]:             bothDone ? 'tamamlandi' : 'kismitamamlandi',
                [`${basePath}/ad`]:                selectedAthlete.ad    || selectedAthlete.name || '',
                [`${basePath}/soyad`]:             selectedAthlete.soyad || '',
                [`${basePath}/okul`]:              selectedAthlete.okul  || '',
                [`${basePath}/timestamp`]:         Date.now(),
                [`${basePath}/hakem`]:             scoreData.hakem,
            };

            await offlineWrite(updates);

            // ─── Canlı Sonuçlar flash tetikleyici ───
            try {
                await update(ref(db), {
                    [`${firebasePath}/${selectedCompId}/flashTrigger`]: {
                        adSoyad:  `${selectedAthlete.ad || ''} ${selectedAthlete.soyad || ''}`.trim(),
                        kulup:    selectedAthlete.okul || selectedAthlete.kulup || '',
                        aletAd:   RITMIK_ALETLER[selectedAlet]?.label || selectedAlet,
                        da:       scoreData.daScore       || 0,
                        db:       scoreData.dbScore       || 0,
                        a:        scoreData.aScore        || 0,
                        e:        scoreData.eScore        || 0,
                        pen:      scoreData.penaltyTotal  || 0,
                        total:    scoreData.sonuc         || 0,
                        isRitmik: true,
                        timestamp: Date.now(),
                    }
                });
            } catch (_fe) { /* flash trigger hatası kritik değil */ }

            await logAction('score_submitted', {
                competitionId: selectedCompId,
                category:      selectedCategory,
                athleteId:     selectedAthlete.id,
                alet:          selectedAlet,
                finalScore:    scoreData.sonuc,
                discipline:    'ritmik',
                layout:        scoreData._layout || 'modern',
            });

            const next = getNextAthlete();
            const sonucNum = (scoreData.sonuc != null && !isNaN(scoreData.sonuc))
                ? scoreData.sonuc : 0;
            setSuccessModal({
                athlete:    selectedAthlete,
                finalScore: sonucNum.toFixed(3),
                aletLabel:  RITMIK_ALETLER[selectedAlet]?.label || selectedAlet,
                next,
            });
            setConfirmModal(null);
            setScoringFieldsTouched(false);
        } catch (err) {
            toast('Kayıt sırasında hata: ' + err.message, 'error');
        } finally {
            setIsSubmitting(false);
        }
    }, [confirmModal, firebasePath, selectedCompId, selectedCategory,
        selectedAthlete, selectedAlet, existingScores, offlineWrite, getNextAthlete, toast]);

    // ─── Submit: Modern ───
    const handleModernSubmit = useCallback(() => {
        if (!selectedAthlete) return toast('Lütfen bir sporcu seçin.', 'warning');
        if (scoreLocked)       return toast('Bu aletin puanı kilitli.', 'warning');
        const filledA = Object.values(aPanelLocal).filter(v => v !== '' && !isNaN(parseFloat(v)));
        if (filledA.length === 0) return toast('A (Artistlik) puanı girilmeden kayıt yapılamaz.', 'warning');
        const filledE = Object.values(ePanelLocal).filter(v => v !== '' && !isNaN(parseFloat(v)));
        if (filledE.length === 0) return toast('E (İcra) puanı girilmeden kayıt yapılamaz.', 'warning');
        if (dbScoreInput === '' || isNaN(parseFloat(dbScoreInput)))
            return toast('DB (Vücut Zorluğu) puanı girilmeden kayıt yapılamaz.', 'warning');
        if (daScoreInput === '' || isNaN(parseFloat(daScoreInput)))
            return toast('DA (Alet Zorluğu) puanı girilmeden kayıt yapılamaz.', 'warning');

        const aletLabel = RITMIK_ALETLER[selectedAlet]?.label || selectedAlet;
        const scoreData = {
            aPanel:       aPanelLocal,
            ePanel:       ePanelLocal,
            dbScore:      parseFloat(dbScore.toFixed(3)),
            daScore:      parseFloat(daScoreNum.toFixed(3)),
            penaltyTotal: parseFloat(totalPenalties.toFixed(3)),
            aScore:       parseFloat(aScore.toFixed(3)),
            eScore:       parseFloat(eScore.toFixed(3)),
            dScore:       parseFloat((daScoreNum + dbScore).toFixed(3)),
            sonuc:        parseFloat(modernFinalScore),
            durum:        'tamamlandi',
            kilitli:      true,
            timestamp:    Date.now(),
            hakem:        currentUser?.adSoyad || currentUser?.kullaniciAdi || '',
            _layout:      'modern',
            // Classic ek alanlar — hem classic hem modern kayıt aynı yapıyı kullanır
            da: daNum, da1: da1Num, da2: da2Num, sjda: sjdaNum,
            db: dbNum, db1: db1Num, db2: db2Num, sjdb: sjdbNum,
            daGap:  parseFloat(daGap.toFixed(3)),
            dbGap:  parseFloat(dbGap.toFixed(3)),
            sja:    sjaInput !== '' ? parseFloat(sjaInput) : null,
            sje:    sjeInput !== '' ? parseFloat(sjeInput) : null,
            aGap:   parseFloat(classicAResult.gap.toFixed(3)),
            eGap:   parseFloat(classicEResult.gap.toFixed(3)),
            penaltyKoordinatör: cKoord,
            penaltyCizgi1:      cCizgi1,
            penaltyCizgi2:      cCizgi2,
            penaltyZaman:       cZaman,
        };
        setConfirmModal({ athlete: selectedAthlete, aletLabel, scoreData, finalScore: modernFinalScore });
    }, [selectedAthlete, scoreLocked, aPanelLocal, ePanelLocal, dbScoreInput,
        daScoreInput, selectedAlet, dbScore, daScoreNum, totalPenalties, aScore,
        eScore, modernFinalScore, currentUser,
        daNum, da1Num, da2Num, sjdaNum, dbNum, db1Num, db2Num, sjdbNum,
        daGap, dbGap, sjaInput, sjeInput,
        classicAResult, classicEResult, cKoord, cCizgi1, cCizgi2, cZaman, toast]);

    // ─── Submit: Classic ───
    const handleClassicSubmit = useCallback(() => {
        if (!selectedAthlete) return toast('Lütfen bir sporcu seçin.', 'warning');
        if (scoreLocked)       return toast('Bu aletin puanı kilitli.', 'warning');
        // DA ve DB kesin skorları zorunlu
        if (classicDA.da === '' || isNaN(parseFloat(classicDA.da)))
            return toast('DA skoru (DA1 hakeminin notu) girilmeden kayıt yapılamaz.', 'warning');
        if (classicDB.db === '' || isNaN(parseFloat(classicDB.db)))
            return toast('DB skoru (DB1 hakeminin notu) girilmeden kayıt yapılamaz.', 'warning');
        const filledA = Object.values(aPanelLocal).filter(v => v !== '' && !isNaN(parseFloat(v)));
        if (filledA.length === 0) return toast('A paneli değerleri girilmeden kayıt yapılamaz.', 'warning');
        const filledE = Object.values(ePanelLocal).filter(v => v !== '' && !isNaN(parseFloat(v)));
        if (filledE.length === 0) return toast('E paneli değerleri girilmeden kayıt yapılamaz.', 'warning');

        const aletLabel = RITMIK_ALETLER[selectedAlet]?.label || selectedAlet;
        const scoreData = {
            // Modern uyumlu alanlar (scoreboard/finals için)
            aPanel:       aPanelLocal,
            ePanel:       ePanelLocal,
            dbScore:      parseFloat(classicDbScore.toFixed(3)),
            daScore:      parseFloat(classicDaScore.toFixed(3)),
            penaltyTotal: parseFloat(classicTotalPenalty.toFixed(3)),
            aScore:       parseFloat(classicAResult.score.toFixed(3)),
            eScore:       parseFloat(classicEResult.score.toFixed(3)),
            dScore:       parseFloat(classicDTotal.toFixed(3)),
            sonuc:        parseFloat(classicFinalScore),
            durum:        'tamamlandi',
            kilitli:      true,
            timestamp:    Date.now(),
            hakem:        currentUser?.adSoyad || currentUser?.kullaniciAdi || '',
            _layout:      'classic',
            // Classic ek alanlar (da/db = kesin skor; da1/da2/sjda/db1/db2/sjdb = bilgi)
            da: daNum, da1: da1Num, da2: da2Num, sjda: sjdaNum,
            db: dbNum, db1: db1Num, db2: db2Num, sjdb: sjdbNum,
            daGap:  parseFloat(daGap.toFixed(3)),
            dbGap:  parseFloat(dbGap.toFixed(3)),
            sja:    sjaInput !== '' ? parseFloat(sjaInput) : null,
            sje:    sjeInput !== '' ? parseFloat(sjeInput) : null,
            aGap:   parseFloat(classicAResult.gap.toFixed(3)),
            eGap:   parseFloat(classicEResult.gap.toFixed(3)),
            penaltyKoordinatör: cKoord,
            penaltyCizgi1:      cCizgi1,
            penaltyCizgi2:      cCizgi2,
            penaltyZaman:       cZaman,
        };
        setConfirmModal({ athlete: selectedAthlete, aletLabel, scoreData, finalScore: classicFinalScore });
    }, [selectedAthlete, scoreLocked, classicDA, classicDB, aPanelLocal, ePanelLocal,
        selectedAlet, classicDbScore, classicDaScore, classicTotalPenalty,
        classicAResult, classicEResult, classicDTotal, classicFinalScore,
        currentUser, daNum, da1Num, da2Num, sjdaNum, dbNum, db1Num, db2Num, sjdbNum,
        daGap, dbGap, sjaInput, sjeInput, cKoord, cCizgi1, cCizgi2, cZaman, toast]);

    // ─── Kilit Aç ───
    const handleUnlock = useCallback(async () => {
        if (!unlockModal) return;
        setUnlockingInProgress(true);
        setUnlockError('');
        try {
            const inputPwd  = unlockPassword.trim();
            const inputHash = await hashPassword(inputPwd);

            const compSnap   = await get(ref(db, `${firebasePath}/${selectedCompId}/komiteSifresi`));
            const globalSnap = await get(ref(db, 'ayarlar/komiteSifresi'));
            const komite     = compSnap.val() || globalSnap.val();
            const isKomite   = komite && inputPwd === komite;

            let isUser = false;
            const usersSnap = await get(ref(db, 'kullanicilar'));
            const usersData = usersSnap.val() || {};
            for (const [, u] of Object.entries(usersData)) {
                if ((u.sifreHash && inputHash === u.sifreHash) || (u.sifre && inputPwd === u.sifre)) {
                    isUser = true; break;
                }
            }

            if (isKomite || isUser) {
                const basePath = `${firebasePath}/${selectedCompId}/puanlar/${selectedCategory}/${unlockModal.athleteId}`;
                // offlineWrite false değeri atlayabiliyor; update() direkt kullan
                await update(ref(db), { [`${basePath}/${unlockModal.aletKey}/kilitli`]: false });
                setUnlockModal(null);
                setUnlockPassword('');
                toast(`${RITMIK_ALETLER[unlockModal.aletKey]?.label || unlockModal.aletKey} kilidi kaldırıldı.`, 'success');
                logAction('score_unlock', `[Ritmik] ${unlockModal.athleteId} ${unlockModal.aletKey}`, {
                    user: currentUser?.kullaniciAdi || 'admin',
                    competitionId: selectedCompId,
                });
            } else {
                setUnlockError('Şifre hatalı.');
            }
        } catch (e) {
            setUnlockError('Hata: ' + e.message);
        } finally {
            setUnlockingInProgress(false);
        }
    }, [unlockModal, unlockPassword, hashPassword, firebasePath, selectedCompId,
        selectedCategory, offlineWrite, toast, currentUser]);

    // ─── Sporcu Durum ───
    const getAthleteStatus = useCallback((athlete) => {
        const score = existingScores[athlete.id];
        if (!score) return 'bekliyor';
        const topDone     = score.top?.durum     === 'tamamlandi';
        const kurdeleDone = score.kurdele?.durum  === 'tamamlandi';
        const topLocked   = score.top?.kilitli    === true;
        const kurdLocked  = score.kurdele?.kilitli === true;
        if (topLocked && kurdLocked) return 'kilitli';
        if (topDone && kurdeleDone)  return 'tamamlandi';
        if (topDone || kurdeleDone)  return 'kismi';
        return 'bekliyor';
    }, [existingScores]);

    const getAletStatus = useCallback((athlete, aletKey) => {
        const sc = existingScores[athlete?.id]?.[aletKey];
        if (!sc || sc.durum !== 'tamamlandi') return 'bekliyor';
        if (sc.kilitli) return 'kilitli';
        return 'tamamlandi';
    }, [existingScores]);

    return {
        // Navigation
        navigate,
        // Data
        competitions, selectedCity, setSelectedCity,
        selectedCompId, setSelectedCompId,
        selectedCategory, setSelectedCategory,
        // Athletes
        athletesByRotation, existingScores,
        selectedAthlete, isAthleteCalled,
        // Alet
        selectedAlet,
        // Modern fields
        aPanelLocal, setAPanelLocal,
        ePanelLocal, setEPanelLocal,
        dbScoreInput, setDbScoreInput,
        daScoreInput, setDaScoreInput,
        penaltyInput, setPenaltyInput,
        // Classic fields
        classicDA, setClassicDA,
        classicDB, setClassicDB,
        sjaInput, setSjaInput,
        sjeInput, setSjeInput,
        classicPenalty, setClassicPenalty,
        // Modern computed
        aScore, eScore, dbScore, daScoreNum, totalPenalties, modernFinalScore,
        // Classic computed D
        classicDaScore, classicDbScore, classicDTotal,
        da: daNum, da1: da1Num, da2: da2Num, sjda: sjdaNum, daGap, daGapOk, daGapLevel,
        db: dbNum, db1: db1Num, db2: db2Num, sjdb: sjdbNum, dbGap, dbGapOk, dbGapLevel,
        // Classic computed A/E
        classicAResult, classicEResult,
        // Classic computed penalty
        cKoord, cCizgi1, cCizgi2, cZaman, classicTotalPenalty,
        // Classic final
        classicFinalScore,
        // Lock
        unlockModal, setUnlockModal,
        unlockPassword, setUnlockPassword,
        unlockError, setUnlockError,
        unlockingInProgress,
        scoringFieldsTouched, setScoringFieldsTouched,
        // UI
        sidebarOpen, setSidebarOpen,
        isSubmitting, confirmModal, setConfirmModal,
        successModal, setSuccessModal,
        // Derived
        catConfig, judgeCount, scoreLocked,
        availableCities, compOptions, categoryOptions,
        // Handlers
        resetPanel,
        handleSelectAthlete, handleSelectAlet,
        handleCallAthlete, getNextAthlete,
        handleModernSubmit, handleClassicSubmit,
        handleConfirmSubmit, handleUnlock,
        refreshScores,
        getAthleteStatus, getAletStatus,
        // Constants
        RITMIK_CATEGORIES, RITMIK_ALETLER,
    };
}
