import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, update, get, push, remove } from 'firebase/database';
import { db } from '../lib/firebase';
import './ApplicationsPage.css';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { useDiscipline, DISCIPLINE_CONFIG } from '../lib/DisciplineContext';
import { logAction } from '../lib/auditLogger';
import { AEROBIK_CATEGORIES } from '../data/aerobikCriteriaDefaults';
import { TRAMPOLIN_CATEGORIES } from '../data/trampolinCriteriaDefaults';
import { PARKUR_CATEGORIES } from '../data/parkurCriteriaDefaults';
import { RITMIK_CATEGORIES } from '../data/ritmikCriteriaDefaults';

// Yardımcı fonksiyon - datayı array'e çevirir (Türkçe & İngilizce fallback)
function getAthletesArray(app) {
    const src = app?.sporcular || app?.athletes;
    if (!src) return [];
    if (Array.isArray(src)) return src;
    return Object.values(src);
}

// Turkish Character Normalization (Legacy Matching)
function normalizeString(str) {
    return (str || '')
        .toLocaleUpperCase('tr-TR')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/İ/g, 'I')
        .replace(/Ş/g, 'S')
        .replace(/Ğ/g, 'G')
        .replace(/Ç/g, 'C')
        .replace(/Ö/g, 'O')
        .replace(/Ü/g, 'U');
}

function normalizeStatusValue(status) {
    const value = (status || '').toString().trim().toLocaleLowerCase('tr-TR');
    if (!value) return 'bekliyor';

    const normalized = value
        .replace(/ı/g, 'i')
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c');

    if (normalized === 'approved' || normalized === 'onaylandi') return 'onaylandi';
    if (normalized === 'rejected' || normalized === 'reddedildi') return 'reddedildi';
    if (normalized === 'pending' || normalized === 'bekliyor') return 'bekliyor';
    return normalized;
}

function getCompetitionPathByBranch(branchValue, fallbackPath) {
    const branch = normalizeString(branchValue || '');

    if (branch.includes('AEROB')) return DISCIPLINE_CONFIG.aerobik.firebasePath;
    if (branch.includes('TRAMP')) return DISCIPLINE_CONFIG.trampolin.firebasePath;
    if (branch.includes('PARKUR')) return DISCIPLINE_CONFIG.parkur.firebasePath;
    if (branch.includes('RITMIK')) return DISCIPLINE_CONFIG.ritmik.firebasePath;
    if (branch.includes('ARTISTIK')) {
        return DISCIPLINE_CONFIG.artistik.firebasePath;
    }

    return fallbackPath || DISCIPLINE_CONFIG.artistik.firebasePath;
}

function buildApplicationBackfillPayload(app, fallbackBrans) {
    const safeSchoolName = ((app.schoolName || 'BILINMEYEN OKUL').toString().trim() || 'BILINMEYEN OKUL');
    const safeCity = ((app.city || 'BELIRTILMEDI').toString().trim() || 'BELIRTILMEDI');
    const safeDistrict = ((app.district || app.city || 'BELIRTILMEDI').toString().trim() || 'BELIRTILMEDI');
    const safeBranch = ((app.brans || fallbackBrans || 'Artistik').toString().trim() || 'Artistik').toLocaleUpperCase('tr-TR');
    const safeStatus = normalizeStatusValue(app.status);

    const payload = {
        competitionId: app.compId || '',
        okul: safeSchoolName,
        il: safeCity,
        ilce: safeDistrict,
        kategoriId: app.categoryId || '',
        brans: safeBranch,
        durum: safeStatus,
        status: safeStatus,
    };
    // Sporcu verisi varsa yaz — boş array yazarsak Firebase siler, mevcut veri kaybolur
    if (Array.isArray(app.athletes) && app.athletes.length > 0) {
        payload.sporcular = app.athletes;
    }
    return payload;
}

// ─── Takım Kuralları Tablosu ───
// Her kategori grubu için: min = takım olma eşiği, max = takımdaki max sporcu
const TEAM_RULES = {
    minik:  { min: 4, max: 7 },  // Minik A & Minik B
    kucuk:  { min: 4, max: 5 },  // Küçükler
    yildiz: { min: 2, max: 3 },  // Yıldızlar
    genc:   { min: 2, max: 3 },  // Gençler
};

// Kategori adından takım kuralını belirle → { min, max } veya null
function getTeamRules(catName) {
    const nameLower = (catName || "").toLocaleLowerCase('tr-TR');
    if (nameLower.includes('minik'))                                        return TEAM_RULES.minik;
    if (nameLower.includes('küçük') || nameLower.includes('kucuk'))         return TEAM_RULES.kucuk;
    if (nameLower.includes('yıldız') || nameLower.includes('yildiz'))       return TEAM_RULES.yildiz;
    if (nameLower.includes('genç')  || nameLower.includes('genc'))          return TEAM_RULES.genc;
    return null; // Bu kategori için takım kuralı tanımlı değil
}

// ─── Yaş Doğrulama Yardımcıları ───

// Branş adından kategori haritasını döndürür
function getCategoryMap(brans) {
    const b = normalizeString(brans || '');
    if (b.includes('AEROB')) return AEROBIK_CATEGORIES;
    if (b.includes('TRAMP')) return TRAMPOLIN_CATEGORIES;
    if (b.includes('PARKUR')) return PARKUR_CATEGORIES;
    if (b.includes('RITMIK')) return RITMIK_CATEGORIES;
    return null; // Artistik için yaş doğrulaması yok
}

// dobYears string/array → valid year set (Set<number>)
function parseDobYears(dobYears) {
    if (!dobYears) return null;
    if (Array.isArray(dobYears)) {
        return new Set(dobYears.map(Number));
    }
    if (typeof dobYears === 'string') {
        return new Set(dobYears.split('-').map(Number).filter(Boolean));
    }
    return null;
}

// dob string → year number (handles "DD.MM.YYYY", "YYYY-MM-DD", "YYYY")
function parseBirthYear(dob) {
    if (!dob) return null;
    const s = dob.trim();
    // DD.MM.YYYY
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return parseInt(s.split('.')[2]);
    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return parseInt(s.split('-')[0]);
    // YYYY
    if (/^\d{4}$/.test(s)) return parseInt(s);
    // fallback: try Date.parse
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.getFullYear();
    return null;
}

// ─── Yardımcı: Bir okulun mevcut sporcu sayısını getirir ───
async function getSchoolAthleteCount(compId, catId, schoolName, firebasePath) {
    if (!compId || !catId || !schoolName) return 0;
    try {
        const snapshot = await get(ref(db, `${firebasePath}/${compId}/sporcular/${catId}`));
        if (!snapshot.exists()) return 0;
        const all = snapshot.val();
        const normalizedSchool = normalizeString(schoolName);
        return Object.values(all).filter(a => normalizeString(a.okul || a.kulup) === normalizedSchool).length;
    } catch { return 0; }
}

// ─── Automatic Team Promotion & Demotion Logic ───
// Sporcu sayısı >= min → tüm okul sporcuları 'takim'
// Sporcu sayısı <  min → tüm okul sporcuları 'ferdi'
async function syncTeamStatus(compId, catId, catName, schoolName, firebasePath) {
    if (!compId || !catId || !schoolName) return;

    const rules = getTeamRules(catName);
    if (!rules) return; // Bu kategori için takım kuralı yok

    try {
        const snapshot = await get(ref(db, `${firebasePath}/${compId}/sporcular/${catId}`));
        if (!snapshot.exists()) return;

        const allAthletes = snapshot.val();
        const normalizedSchool = normalizeString(schoolName);
        const schoolAthletes = Object.entries(allAthletes).filter(([, a]) => {
            return normalizeString(a.okul || a.kulup) === normalizedSchool;
        });

        const count = schoolAthletes.length;
        const shouldBeTeam = count >= rules.min;
        const targetType = shouldBeTeam ? 'takim' : 'ferdi';

        const updates = {};
        let updateCount = 0;
        schoolAthletes.forEach(([id, ath]) => {
            if (ath.yarismaTuru !== targetType) {
                updates[`${firebasePath}/${compId}/sporcular/${catId}/${id}/yarismaTuru`] = targetType;
                updateCount++;
            }
        });

        if (updateCount > 0) {
            await update(ref(db), updates);
            console.log(`[syncTeamStatus] ${schoolName} / ${catName}: ${count} sporcu → ${targetType} (min: ${rules.min}, max: ${rules.max})`);
        }

        // Max aşımı uyarısı (konsol'a log — admin bilgilendirilir)
        if (count > rules.max) {
            console.warn(`[syncTeamStatus] ⚠️ ${schoolName} / ${catName}: ${count} sporcu var ama max ${rules.max}! Fazla sporcu düzeltilmeli.`);
        }
    } catch (err) {
        console.error("Team sync error:", err);
    }
}

export default function ApplicationsPage() {
    const navigate = useNavigate();
    const { currentUser, hasPermission } = useAuth();
    const { toast, confirm } = useNotification();
    const { firebasePath, routePrefix, brans: disciplineBrans } = useDiscipline();
    const isSuperAdmin = currentUser?.rolAdi === 'Super Admin' || currentUser?.kullaniciAdi === 'admin';
    const [applications, setApplications] = useState([]);
    const [competitions, setCompetitions] = useState({});
    const [loading, setLoading] = useState(true);
    const [filterCity, setFilterCity] = useState(''); // İl filtresi
    const [filterStatus, setFilterStatus] = useState('bekliyor'); // bekliyor, onaylandi, reddedildi, all
    const [filterComp, setFilterComp] = useState(''); // Yarışma filtresi
    const [filterBrans, setFilterBrans] = useState(''); // Branş filtresi (Super Admin)
    const [searchQuery, setSearchQuery] = useState(''); // Sporcu adı veya okul adı araması
    const [isSyncingAll, setIsSyncingAll] = useState(false); // Toplu senkronizasyon durumu
    const [isCheckingMissing, setIsCheckingMissing] = useState(false); // Eksik sporcuları kontrol etme
    const [missingAthletesModal, setMissingAthletesModal] = useState({ isOpen: false, data: [] });

    // Detay gösterme state'i
    const [expandedAppId, setExpandedAppId] = useState(null);

    useEffect(() => {
        // 1. Yarışmaları yükle (isimleri göstermek ve filtrelemek için)
        const compsRef = ref(db, firebasePath);
        const unsubComps = onValue(compsRef, (snap) => {
            setCompetitions(filterCompetitionsByUser(snap.val() || {}, currentUser));
        });

        // 2. Başvuruları yükle — tüm başvurular alınır, branş filtresi filteredApps'de yapılır
        const appsRef = ref(db, 'applications');
        const unsubscribe = onValue(appsRef, (snapshot) => {
            const data = snapshot.val();
            const apps = [];

            if (data) {
                Object.keys(data).forEach(appId => {
                    const app = data[appId];

                    const athletes = getAthletesArray(app);

                    // Antrenörler: Türkçe (antrenorler) veya İngilizce (coaches) fallback
                    const coachesRaw = app.antrenorler || app.coaches || [];
                    const coachesArr = Array.isArray(coachesRaw) ? coachesRaw : Object.values(coachesRaw);

                    // Öğretmenler: Türkçe (ogretmenler) veya eski format (teacherName)
                    const teachersRaw = app.ogretmenler || [];
                    const teachersArr = Array.isArray(teachersRaw) ? teachersRaw : Object.values(teachersRaw);
                    const firstTeacher = teachersArr[0] || {};

                    apps.push({
                        id: appId,
                        compId: app.competitionId || '',
                        compName: app.yarismaAdi || app.compName || '',
                        schoolName: (app.okul || app.schoolName || 'İsimsiz Okul').toLocaleUpperCase('tr-TR'),
                        city: (app.il || app.city || 'Belirtilmemiş').toLocaleUpperCase('tr-TR'),
                        district: (app.ilce || app.district || '').toLocaleUpperCase('tr-TR'),
                        categoryId: app.kategoriId || app.categoryId || '',
                        categoryName: app.kategoriAdi || app.categoryName || 'Kategori Yok',
                        type: app.katilimTuru || app.type || 'ferdi',
                        status: normalizeStatusValue(app.durum || app.status || 'bekliyor'),
                        // brans boşsa boş bırak, filteredApps'de compId ile kurtarılır
                        brans: (app.brans || app.branch || '').toLocaleUpperCase('tr-TR'),
                        timestamp: app.olusturmaTarihi || app.timestamp || 0,
                        athletes: athletes,
                        athleteCount: athletes.length,
                        teacherName: firstTeacher.name || app.teacherName || '',
                        teacherPhone: firstTeacher.phone || app.teacherPhone || '',
                        coaches: coachesArr,
                        teachers: teachersArr
                    });
                });

                apps.sort((a, b) => b.timestamp - a.timestamp);
                setApplications(apps);
            } else {
                setApplications([]);
            }
            setLoading(false);
        }, (error) => {
            console.error("Firebase fetch error:", error);
            setLoading(false);
        });

        return () => { unsubComps(); unsubscribe(); };
    }, [currentUser, firebasePath, isSuperAdmin]);

    const handleStatusChange = async (app, newStatus) => {
        try {
            const normalizedCurrentStatus = normalizeStatusValue(app.status);
            const appFirebasePath = getCompetitionPathByBranch(app.brans, firebasePath);
            const basePayload = buildApplicationBackfillPayload(app, disciplineBrans);

            const updates = {};
            // Legacy kayıtlar için zorunlu TR alanları her statü güncellemesinde garanti altına alınır.
            Object.entries(basePayload).forEach(([field, value]) => {
                updates[`applications/${app.id}/${field}`] = value;
            });

            // Her iki alan adını da güncelle (eski EN + yeni TR uyumluluğu)
            updates[`applications/${app.id}/durum`] = newStatus;
            updates[`applications/${app.id}/status`] = newStatus;

            const compId = app.compId;
            const catId = app.categoryId;

            // ═══ ONAYLAMA ═══
            if (newStatus === 'onaylandi') {

                // 0. Zorunlu alan kontrolleri
                if (!compId) {
                    toast('Bu başvuruda yarışma bilgisi eksik. Onaylanamaz.', 'error');
                    return;
                }
                if (!catId) {
                    toast('Bu başvuruda kategori bilgisi eksik. Onaylanamaz.', 'error');
                    return;
                }
                if (!app.athletes || app.athletes.length === 0) {
                    toast('Bu başvuruda sporcu listesi boş. Onaylanamaz.', 'error');
                    return;
                }

                // 0a. Yaş doğrulama kontrolü
                const catMap = getCategoryMap(app.brans);
                if (catMap && app.categoryId && catMap[app.categoryId]) {
                    const validYears = parseDobYears(catMap[app.categoryId].dobYears);
                    if (validYears && validYears.size > 0) {
                        const outOfRange = app.athletes.filter(ath => {
                            const birthYear = parseBirthYear(ath.dob || ath.dogumTarihi);
                            return birthYear && !validYears.has(birthYear);
                        });
                        if (outOfRange.length > 0) {
                            const validYearsStr = [...validYears].sort().join(', ');
                            const athleteList = outOfRange.map(a => `• ${a.name || a.adSoyad} (${a.dob || a.dogumTarihi || '?'})`).join('\n');
                            const proceed = await confirm(
                                `Aşağıdaki sporcuların doğum yılı "${app.categoryName}" kategorisi için geçerli değil (izin verilen: ${validYearsStr}):\n\n${athleteList}\n\nYine de onaylamak istiyor musunuz?`,
                                { title: 'Yaş Uyumsuzluğu', type: 'warning' }
                            );
                            if (!proceed) return;
                        }
                    }
                }

                // 0b. Max sporcu kontrolü — onaylanırsa toplam max'ı aşar mı?
                const rules = getTeamRules(app.categoryName);
                if (rules) {
                    const currentCount = await getSchoolAthleteCount(compId, catId, app.schoolName, appFirebasePath);
                    const afterCount = currentCount + app.athleteCount;
                    if (afterCount > rules.max) {
                        const proceed = await confirm(
                            `${app.schoolName} okulunun "${app.categoryName}" kategorisinde şu an ${currentCount} sporcusu var. Bu başvuru onaylanırsa toplam ${afterCount} olacak ama max limit ${rules.max}. Yine de onaylamak istiyor musunuz?`,
                            { title: 'Max Sporcu Limiti Aşılacak', type: 'warning' }
                        );
                        if (!proceed) return;
                    }
                }

                // 1. Okulu onaylı okullar listesine ekle
                const safeSchoolName = app.schoolName.replace(/[.#$[\]]/g, '');
                updates[`${appFirebasePath}/${compId}/onayli_okullar/${safeSchoolName}`] = {
                    city: app.city,
                    district: app.district
                };

                // 2. Sporcuları ilgili kategori altına ekle
                app.athletes.forEach(ath => {
                    const newAthKey = push(ref(db, `${appFirebasePath}/${compId}/sporcular/${catId}`)).key;

                    // Ad Soyad: yeni format (name) veya eski format (adSoyad)
                    const fullName = ath.name || ath.adSoyad || '';

                    // Ad Soyad Ayırma
                    let ad = "";
                    let soyad = "";
                    if (fullName) {
                        const parts = fullName.trim().split(' ');
                        if (parts.length > 1) {
                            soyad = parts.pop();
                            ad = parts.join(' ');
                        } else {
                            ad = parts[0] || "";
                        }
                    }

                    const lisans = ath.license || ath.lisans || "-";

                    // yarismaTuru her zaman 'ferdi' başlar → syncTeamStatus eşiğe göre günceller
                    updates[`${appFirebasePath}/${compId}/sporcular/${catId}/${newAthKey}`] = {
                        id: newAthKey,
                        adSoyad: fullName,
                        soyadAd: `${soyad} ${ad}`.trim(),
                        ad: ad,
                        soyad: soyad,
                        dogumTarihi: ath.dob || "",
                        dob: ath.dob || "",
                        lisansNo: lisans,
                        lisans: lisans,
                        okul: app.schoolName,
                        kulup: app.schoolName,
                        il: app.city,
                        ilce: app.district || "",
                        sirasi: 999,
                        yarismaTuru: 'ferdi',
                        tckn: ath.tckn || "-",
                        appId: app.id
                    };
                });

                await update(ref(db), updates);

                // 3. Eşik kontrolü: Yeterli sporcu varsa takım'e yükselt, yoksa ferdi bırak
                await syncTeamStatus(compId, catId, app.categoryName, app.schoolName, appFirebasePath);

                // 4. Cross-discipline uyarısı: sporcular farklı bir branşın sayfasına yazıldıysa kullanıcıyı bilgilendir
                if (appFirebasePath !== firebasePath) {
                    const branchLabel = app.brans || 'ilgili branş';
                    toast(`${app.athletes.length} sporcu onaylandı. Sporcuları görmek için "${branchLabel}" Sporcular sayfasına gidin.`, 'info');
                }

            // ═══ GERİ ALMA / REDDETME ═══
            } else {
                if ((newStatus === 'bekliyor' || newStatus === 'reddedildi') && normalizedCurrentStatus === 'onaylandi') {
                    // Sporcuları yarışmadan çıkart
                    const snap = await get(ref(db, `${appFirebasePath}/${compId}/sporcular/${catId}`));
                    if (snap.exists()) {
                        Object.entries(snap.val()).forEach(([athKey, athData]) => {
                            if (athData.appId === app.id) {
                                updates[`${appFirebasePath}/${compId}/sporcular/${catId}/${athKey}`] = null;
                            }
                        });
                    }
                }
                await update(ref(db), updates);

                // Kalan sporcu sayısı eşiğin altına düşmüş olabilir → demotion kontrolü
                if ((newStatus === 'bekliyor' || newStatus === 'reddedildi') && normalizedCurrentStatus === 'onaylandi') {
                    await syncTeamStatus(compId, catId, app.categoryName, app.schoolName, appFirebasePath);
                }
            }

        } catch (err) {
            console.error("Status update failed", err);
            toast("Durum güncellenirken bir hata oluştu.", "error");
        }
    };

    const handleBransChange = async (app, newBrans) => {
        try {
            const basePayload = buildApplicationBackfillPayload({ ...app, brans: newBrans }, newBrans || disciplineBrans);
            const updates = {};
            Object.entries(basePayload).forEach(([field, value]) => {
                updates[`applications/${app.id}/${field}`] = value;
            });
            // Eski alan adı uyumluluğu
            updates[`applications/${app.id}/branch`] = newBrans;

            await update(ref(db), updates);
            toast(`Branş "${newBrans}" olarak güncellendi.`, 'success');
        } catch (err) {
            console.error('Brans update failed:', err);
            toast('Branş güncellenirken hata oluştu.', 'error');
        }
    };

    // Onaylı ama sporcuları yanlış/eksik yazılmış başvurular için yeniden senkronize et
    const handleResyncAthletes = async (app) => {
        if (app.status !== 'onaylandi') return;
        const proceed = await confirm(
            `"${app.schoolName}" okulunun onaylı başvurusundaki sporcular yarışmaya yeniden yazılacak. Zaten mevcut kayıtlar güncellenmeyecek. Devam etmek istiyor musunuz?`,
            { title: 'Sporcuları Yeniden Senkronize Et', type: 'warning' }
        );
        if (!proceed) return;
        try {
            const appFirebasePath = getCompetitionPathByBranch(app.brans, firebasePath);
            const compId = app.compId;
            const catId = app.categoryId;
            if (!compId || !catId) {
                toast('Yarışma veya kategori bilgisi eksik!', 'error');
                return;
            }

            // Eğer sporcular verisi yoksa → başvuruyu silme seçeneği sun
            if (!app.athletes || app.athletes.length === 0) {
                const shouldDelete = await confirm(
                    `Bu onaylı başvuruda sporcu verisi bulunamadı. Başvuru listede engel oluşturuyorsa silebilirsiniz. Başvuruyu silmek istiyor musunuz?`,
                    { title: 'Sporcu Verisi Yok', type: 'warning', confirmText: 'Başvuruyu Sil', cancelText: 'İptal' }
                );
                if (shouldDelete) {
                    await remove(ref(db, `applications/${app.id}`));
                    toast('Boş başvuru silindi. Okul yeniden başvuru yapabilir.', 'success');
                    logAction('delete_empty_application', `Sporcu verisi olmayan başvuru silindi: ${app.schoolName}`, { user: currentUser?.kullaniciAdi || 'admin', appId: app.id });
                }
                return;
            }

            // Mevcut sporcuları kontrol et — appId eşleşmesi VEYA TCKN eşleşmesi
            const existingSnap = await get(ref(db, `${appFirebasePath}/${compId}/sporcular/${catId}`));
            const existing = existingSnap.val() || {};
            const existingList = Object.values(existing);
            const appTcknSet = new Set(app.athletes.map(a => a.tckn).filter(Boolean));
            const alreadySynced =
                existingList.some(a => a.appId === app.id) ||
                (appTcknSet.size > 0 && existingList.some(a => appTcknSet.has(a.tckn)));

            if (alreadySynced) {
                toast('Bu başvurunun sporcuları zaten sistemde mevcut.', 'info');
                return;
            }

            const updates = {};
            app.athletes.forEach(ath => {
                const newAthKey = push(ref(db, `${appFirebasePath}/${compId}/sporcular/${catId}`)).key;
                const fullName = ath.name || ath.adSoyad || '';
                const parts = fullName.trim().split(' ');
                let ad = '', soyad = '';
                if (parts.length > 1) { soyad = parts.pop(); ad = parts.join(' '); }
                else { ad = parts[0] || ''; }
                const lisans = ath.license || ath.lisans || '-';
                updates[`${appFirebasePath}/${compId}/sporcular/${catId}/${newAthKey}`] = {
                    id: newAthKey, adSoyad: fullName, soyadAd: `${soyad} ${ad}`.trim(),
                    ad, soyad, dogumTarihi: ath.dob || '', dob: ath.dob || '',
                    lisansNo: lisans, lisans, okul: app.schoolName, kulup: app.schoolName,
                    il: app.city, ilce: app.district || '', sirasi: 999,
                    yarismaTuru: 'ferdi', tckn: ath.tckn || '-', appId: app.id
                };
            });
            await update(ref(db), updates);
            await syncTeamStatus(compId, catId, app.categoryName, app.schoolName, appFirebasePath);
            toast(`${app.athletes.length} sporcu başarıyla yeniden yazıldı.`, 'success');
            logAction('resync_athletes', `Sporcular yeniden senkronize edildi: ${app.schoolName} — ${app.categoryName}`, { user: currentUser?.kullaniciAdi || 'admin', appId: app.id });
        } catch (err) {
            console.error('Resync failed:', err);
            toast('Senkronizasyon başarısız oldu.', 'error');
        }
    };

    // Tüm onaylı başvuruları tara — sistemde olmayan sporcuları ekle, mevcut olanları atla
    const handleResyncAll = async () => {
        const approvedApps = applications.filter(a => a.status === 'onaylandi' && a.athletes?.length > 0);
        if (approvedApps.length === 0) {
            toast('Sporcu verisi olan onaylı başvuru bulunamadı.', 'info');
            return;
        }

        const proceed = await confirm(
            `${approvedApps.length} onaylı başvuru taranacak. Sistemde kaydı olmayan sporcular eklenecek, mevcut kayıtlara dokunulmayacak. Devam etmek istiyor musunuz?`,
            { title: 'Tümünü Senkronize Et', type: 'warning' }
        );
        if (!proceed) return;

        setIsSyncingAll(true);
        let addedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        try {
            // Her onaylı başvuruyu sırayla işle
            for (const app of approvedApps) {
                try {
                    const appFirebasePath = getCompetitionPathByBranch(app.brans, firebasePath);
                    const compId = app.compId;
                    const catId = app.categoryId;
                    if (!compId || !catId) { skippedCount++; continue; }

                    // Mevcut sporcuları oku
                    const existingSnap = await get(ref(db, `${appFirebasePath}/${compId}/sporcular/${catId}`));
                    const existing = existingSnap.val() || {};
                    const existingList = Object.values(existing);

                    // Zaten bu appId ile senkronize edilmiş mi?
                    const appAlreadySynced = existingList.some(a => a.appId === app.id);
                    if (appAlreadySynced) { skippedCount++; continue; }

                    // Hangi sporcular henüz sistemde yok? (TCKN kontrolü)
                    const existingTcknSet = new Set(existingList.map(a => a.tckn).filter(Boolean));
                    const newAthletes = app.athletes.filter(a => !a.tckn || !existingTcknSet.has(a.tckn));

                    if (newAthletes.length === 0) { skippedCount++; continue; }

                    // Sadece eksik sporcuları yaz
                    const updates = {};
                    newAthletes.forEach(ath => {
                        const newAthKey = push(ref(db, `${appFirebasePath}/${compId}/sporcular/${catId}`)).key;
                        const fullName = ath.name || ath.adSoyad || '';
                        const parts = fullName.trim().split(' ');
                        let ad = '', soyad = '';
                        if (parts.length > 1) { soyad = parts.pop(); ad = parts.join(' '); }
                        else { ad = parts[0] || ''; }
                        const lisans = ath.license || ath.lisans || '-';
                        updates[`${appFirebasePath}/${compId}/sporcular/${catId}/${newAthKey}`] = {
                            id: newAthKey, adSoyad: fullName, soyadAd: `${soyad} ${ad}`.trim(),
                            ad, soyad, dogumTarihi: ath.dob || '', dob: ath.dob || '',
                            lisansNo: lisans, lisans, okul: app.schoolName, kulup: app.schoolName,
                            il: app.city, ilce: app.district || '', sirasi: 999,
                            yarismaTuru: 'ferdi', tckn: ath.tckn || '-', appId: app.id
                        };
                    });

                    await update(ref(db), updates);
                    await syncTeamStatus(compId, catId, app.categoryName, app.schoolName, appFirebasePath);
                    addedCount += newAthletes.length;
                } catch (e) {
                    console.error('Resync all — app error:', app.id, e);
                    errorCount++;
                }
            }

            const parts = [];
            if (addedCount > 0) parts.push(`${addedCount} sporcu eklendi`);
            if (skippedCount > 0) parts.push(`${skippedCount} başvuru zaten günceldi`);
            if (errorCount > 0) parts.push(`${errorCount} başvuruda hata oluştu`);

            toast(parts.join(' · '), addedCount > 0 ? 'success' : 'info');
            logAction('resync_all', `Toplu senkronizasyon tamamlandı: +${addedCount} sporcu, ${skippedCount} atlandı`, {
                user: currentUser?.kullaniciAdi || 'admin', addedCount, skippedCount, errorCount
            });
        } catch (err) {
            console.error('Resync all failed:', err);
            toast('Toplu senkronizasyon başarısız oldu.', 'error');
        } finally {
            setIsSyncingAll(false);
        }
    };

    const handleCheckMissing = async () => {
        const approvedApps = filteredApps.filter(a => a.status === 'onaylandi' && a.athletes?.length > 0);
        if (approvedApps.length === 0) {
            toast('Şu anki filtrede kontrol edilecek onaylı başvuru bulunmuyor.', 'info');
            return;
        }

        setIsCheckingMissing(true);
        let missingList = [];

        try {
            for (const app of approvedApps) {
                const appFirebasePath = getCompetitionPathByBranch(app.brans, firebasePath);
                const compId = app.compId;
                const catId = app.categoryId;
                if (!compId || !catId) continue;

                // Mevcut sporcuları oku
                const existingSnap = await get(ref(db, `${appFirebasePath}/${compId}/sporcular/${catId}`));
                const existing = existingSnap.val() || {};
                const existingList = Object.values(existing);

                // TCKN üzerinden kontrol et
                const existingTcknSet = new Set(existingList.map(a => a.tckn).filter(Boolean));
                const newAthletes = app.athletes.filter(a => !a.tckn || !existingTcknSet.has(a.tckn));

                if (newAthletes.length > 0) {
                    missingList.push({
                        app,
                        missingAthletes: newAthletes
                    });
                }
            }

            if (missingList.length > 0) {
                setMissingAthletesModal({ isOpen: true, data: missingList });
            } else {
                toast('Seçili filtredeki tüm onaylı sporcular sistemde kayıtlı. Eksik bulunamadı.', 'success');
            }
        } catch (err) {
            console.error('Check missing failed:', err);
            toast('Eksik sporcu kontrolü sırasında hata oluştu.', 'error');
        } finally {
            setIsCheckingMissing(false);
        }
    };

    const handleAddMissingAthletes = async () => {
        if (!missingAthletesModal.data || missingAthletesModal.data.length === 0) return;
        setIsSyncingAll(true);
        let addedCount = 0;
        let errorCount = 0;

        try {
            for (const item of missingAthletesModal.data) {
                const { app, missingAthletes } = item;
                try {
                    const appFirebasePath = getCompetitionPathByBranch(app.brans, firebasePath);
                    const compId = app.compId;
                    const catId = app.categoryId;
                    
                    const updates = {};
                    missingAthletes.forEach(ath => {
                        const newAthKey = push(ref(db, `${appFirebasePath}/${compId}/sporcular/${catId}`)).key;
                        const fullName = ath.name || ath.adSoyad || '';
                        const parts = fullName.trim().split(' ');
                        let ad = '', soyad = '';
                        if (parts.length > 1) { soyad = parts.pop(); ad = parts.join(' '); }
                        else { ad = parts[0] || ''; }
                        const lisans = ath.license || ath.lisans || '-';
                        updates[`${appFirebasePath}/${compId}/sporcular/${catId}/${newAthKey}`] = {
                            id: newAthKey, adSoyad: fullName, soyadAd: `${soyad} ${ad}`.trim(),
                            ad, soyad, dogumTarihi: ath.dob || '', dob: ath.dob || '',
                            lisansNo: lisans, lisans, okul: app.schoolName, kulup: app.schoolName,
                            il: app.city, ilce: app.district || '', sirasi: 999,
                            yarismaTuru: 'ferdi', tckn: ath.tckn || '-', appId: app.id
                        };
                    });

                    await update(ref(db), updates);
                    await syncTeamStatus(compId, catId, app.categoryName, app.schoolName, appFirebasePath);
                    addedCount += missingAthletes.length;
                } catch (e) {
                    console.error('Add missing app error:', app.id, e);
                    errorCount++;
                }
            }

            toast(`${addedCount} eksik sporcu sisteme eklendi.`, addedCount > 0 ? 'success' : 'info');
            logAction('add_missing_athletes', `Eksik sporcular eklendi: +${addedCount}`, { user: currentUser?.kullaniciAdi || 'admin', addedCount, errorCount });
        } catch (err) {
            console.error('Add missing failed:', err);
            toast('Eksik sporcular eklenirken bir hata oluştu.', 'error');
        } finally {
            setIsSyncingAll(false);
            setMissingAthletesModal({ isOpen: false, data: [] });
        }
    };

    const handleDeleteApplication = async (app) => {
        const proceed = await confirm(
            `"${app.schoolName}" okulunun başvurusunu kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`,
            { title: 'Başvuru Silme', type: 'warning' }
        );
        if (!proceed) return;
        try {
            await remove(ref(db, `applications/${app.id}`));
            toast('Başvuru başarıyla silindi.', 'success');
        } catch (err) {
            console.error('Delete failed:', err);
            toast('Başvuru silinirken bir hata oluştu.', 'error');
        }
    };

    const BRANS_LIST = ['ARTİSTİK', 'RİTMİK', 'AEROBİK', 'TRAMPOLİN', 'PARKUR'];
    const BRANS_COLORS = {
        'ARTİSTİK':   { bg: '#EEF2FF', color: '#4F46E5' },
        'RİTMİK':     { bg: '#FDF4FF', color: '#9333EA' },
        'AEROBİK':    { bg: '#ECFDF5', color: '#059669' },
        'TRAMPOLİN':  { bg: '#FFF7ED', color: '#F97316' },
        'PARKUR':     { bg: '#FFFBEB', color: '#EA580C' },
    };

    const disciplineBransUpper = (disciplineBrans || '').toLocaleUpperCase('tr-TR');

    const filteredApps = useMemo(() => applications.map(app => ({
        ...app,
        compName: competitions[app.compId]?.isim || app.compName || app.compId || 'Bilinmeyen Yarışma'
    })).filter(app => {
        // ── Branş filtresi ──────────────────────────────────────────────────
        if (!isSuperAdmin) {
            const appBrans = app.brans; // zaten uppercase
            const compIsInThisDiscipline = !!competitions[app.compId]; // compId bu branşın yarışmasına ait mi?
            if (appBrans && appBrans !== disciplineBransUpper && !compIsInThisDiscipline) return false;
            if (!appBrans && !compIsInThisDiscipline) return false; // brans da yok, yarışma da bu branşta değil
        } else {
            // Super Admin: filterBrans seçildiyse uygula
            if (filterBrans && app.brans !== filterBrans) return false;
        }
        // ── Diğer filtreler ──────────────────────────────────────────────────
        if (filterCity && app.city !== filterCity) return false;
        if (filterComp && app.compId !== filterComp) return false;

        // ── Arama: sporcu adı veya okul adı ─────────────────────────────────
        if (searchQuery) {
            const q = searchQuery.toLocaleUpperCase('tr-TR').trim();
            const inSchool = (app.schoolName || '').includes(q);
            const inAthletes = (app.athletes || []).some(a =>
                (a.name || a.adSoyad || '').toLocaleUpperCase('tr-TR').includes(q)
            );
            if (!inSchool && !inAthletes) return false;
        }

        if (filterStatus === 'all') return true;
        return app.status === filterStatus;
    }), [applications, competitions, isSuperAdmin, disciplineBransUpper, filterBrans, filterCity, filterComp, searchQuery, filterStatus]);

    const statusConfig = {
        bekliyor: { label: 'Bekliyor', color: '#EA580C', icon: 'schedule' },
        onaylandi: { label: 'Onaylandı', color: '#16A34A', icon: 'check_circle' },
        reddedildi: { label: 'Reddedildi', color: '#EF4444', icon: 'cancel' },
    };

    const availableCities = useMemo(
        () => [...new Set(applications.map(app => app.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr-TR')),
        [applications]
    );

    const compOptions = useMemo(
        () => Object.entries(competitions)
            .filter(([, comp]) => !filterCity || (comp.il || comp.city || '').toLocaleUpperCase('tr-TR') === filterCity)
            .sort((a, b) => new Date(b[1].tarih || b[1].baslangicTarihi || 0) - new Date(a[1].tarih || a[1].baslangicTarihi || 0)),
        [competitions, filterCity]
    );

    return (
        <div className="applications-page">
            <header className="page-header">
                <div className="page-header__left">
                    <button className="back-btn" onClick={() => navigate(routePrefix)}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div className="header-title-wrapper">
                        <h1 className="page-title">Başvurular</h1>
                        <p className="page-subtitle">Okul ve sporcu kayıt onayları {loading ? '' : `(${applications.length})`}</p>
                    </div>
                </div>
            </header>

            <main className="page-content">
                <div className="filters-bar">
                    <div className="filters-row filters-row--selects">
                        {isSuperAdmin && (
                            <select
                                className="filter-select filter-select--brans"
                                value={filterBrans}
                                onChange={(e) => { setFilterBrans(e.target.value); setFilterComp(''); }}
                                style={{ fontWeight: filterBrans ? 700 : 400 }}
                            >
                                <option value="">-- Tüm Branşlar --</option>
                                {BRANS_LIST.map(b => (
                                    <option key={b} value={b}>{b}</option>
                                ))}
                            </select>
                        )}
                        <select
                            className="filter-select"
                            value={filterCity}
                            onChange={(e) => { setFilterCity(e.target.value); setFilterComp(''); }}
                        >
                            <option value="">-- Tüm İller --</option>
                            {availableCities.map(city => (
                                <option key={city} value={city}>{city}</option>
                            ))}
                        </select>

                        <select
                            className="filter-select"
                            value={filterComp}
                            onChange={(e) => setFilterComp(e.target.value)}
                        >
                            <option value="">-- Tüm Yarışmalar --</option>
                            {compOptions.map(([id, comp]) => (
                                <option key={id} value={id}>{comp.isim}</option>
                            ))}
                        </select>
                    </div>

                    <div className="filters-row filters-row--search">
                        <div className="search-input-wrapper">
                            <i className="material-icons-round search-input-icon">search</i>
                            <input
                                type="text"
                                className="search-input"
                                placeholder="Sporcu adı veya okul adı ara..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                            {searchQuery && (
                                <button className="search-input-clear" onClick={() => setSearchQuery('')} title="Temizle">
                                    <i className="material-icons-round">close</i>
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="filters-row filters-row--status">
                        <button
                            className={`filter-btn ${filterStatus === 'bekliyor' ? 'filter-btn--active' : ''}`}
                            onClick={() => setFilterStatus('bekliyor')}
                        >
                            <i className="material-icons-round" style={{ fontSize: 18, color: filterStatus === 'bekliyor' ? 'white' : '#EA580C' }}>schedule</i>
                            Onay Bekleyenler
                        </button>
                        <button
                            className={`filter-btn ${filterStatus === 'onaylandi' ? 'filter-btn--active' : ''}`}
                            onClick={() => setFilterStatus('onaylandi')}
                        >
                            <i className="material-icons-round" style={{ fontSize: 18, color: filterStatus === 'onaylandi' ? 'white' : '#16A34A' }}>check_circle</i>
                            Onaylananlar
                        </button>
                        <button
                            className={`filter-btn ${filterStatus === 'reddedildi' ? 'filter-btn--active' : ''}`}
                            onClick={() => setFilterStatus('reddedildi')}
                        >
                            <i className="material-icons-round" style={{ fontSize: 18, color: filterStatus === 'reddedildi' ? 'white' : '#EF4444' }}>cancel</i>
                            Reddedilenler
                        </button>
                        <button
                            className={`filter-btn ${filterStatus === 'all' ? 'filter-btn--active' : ''}`}
                            onClick={() => setFilterStatus('all')}
                        >
                            Tümü
                        </button>

                        {hasPermission('applications', 'onayla') && (
                            <button
                                className="sync-all-btn"
                                onClick={handleCheckMissing}
                                disabled={isCheckingMissing}
                                title="Yarışmaya dahil edilmemiş sporcuları bul"
                                style={{ backgroundColor: '#2563EB' }}
                            >
                                <i className="material-icons-round" style={{ fontSize: 18, animation: isCheckingMissing ? 'spin 1s linear infinite' : 'none' }}>
                                    person_search
                                </i>
                                {isCheckingMissing ? 'Kontrol ediliyor...' : 'Eksik Sporcuları Kontrol Et'}
                            </button>
                        )}

                        {isSuperAdmin && (
                            <button
                                className="sync-all-btn"
                                onClick={handleResyncAll}
                                disabled={isSyncingAll}
                                title="Tüm onaylı başvuruları tara — sistemde olmayan sporcuları ekle"
                            >
                                <i className="material-icons-round" style={{ fontSize: 18, animation: isSyncingAll ? 'spin 1s linear infinite' : 'none' }}>
                                    sync
                                </i>
                                {isSyncingAll ? 'Senkronize ediliyor...' : 'Tümünü Senkronize Et'}
                            </button>
                        )}
                    </div>
                </div>

                {loading ? (
                    <div className="loading-state">
                        <div className="spinner"></div>
                        <p>Başvurular yükleniyor...</p>
                    </div>
                ) : (
                    <div className="apps-container">
                        {filteredApps.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-state__icon">
                                    <i className="material-icons-round">inbox</i>
                                </div>
                                <p>Bu kategoride başvuru bulunmuyor.</p>
                            </div>
                        ) : (
                            <div className="apps-list">
                                {filteredApps.map((app, index) => {
                                    const currentStatus = statusConfig[app.status] || statusConfig['bekliyor'];
                                    const isExpanded = expandedAppId === app.id;

                                    return (
                                        <div className="app-card-wrapper" key={app.id} data-status={app.status} style={{ animationDelay: `${(index % 10) * 0.04}s` }}>
                                            <div className="app-card" >
                                                <div className="app-card__left">
                                                    <button className="expand-btn" onClick={() => setExpandedAppId(isExpanded ? null : app.id)}>
                                                        <i className="material-icons-round">{isExpanded ? 'keyboard_arrow_down' : 'keyboard_arrow_right'}</i>
                                                    </button>
                                                    <div className="app-card__icon" style={{ background: `${currentStatus.color}15`, color: currentStatus.color }}>
                                                        <i className="material-icons-round">{currentStatus.icon}</i>
                                                    </div>
                                                    <div className="app-card__info">
                                                        <h3 className="app-card__school">{app.schoolName}</h3>
                                                        <p className="app-card__comp">{app.compName}</p>
                                                        <div className="app-card__meta">
                                                            {/* Branş badge — Super Admin'de değiştirilebilir */}
                                                            {isSuperAdmin ? (
                                                                <span className="meta-badge meta-badge--brans" style={{ background: (BRANS_COLORS[app.brans] || BRANS_COLORS['ARTİSTİK']).bg, color: (BRANS_COLORS[app.brans] || BRANS_COLORS['ARTİSTİK']).color, padding: '2px 4px' }}>
                                                                    <i className="material-icons-round">sports_gymnastics</i>
                                                                    <select
                                                                        value={app.brans}
                                                                        onChange={(e) => handleBransChange(app, e.target.value)}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        style={{ background: 'transparent', border: 'none', color: 'inherit', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer', outline: 'none' }}
                                                                    >
                                                                        {BRANS_LIST.map(b => <option key={b} value={b}>{b}</option>)}
                                                                    </select>
                                                                </span>
                                                            ) : (
                                                                <span className="meta-badge" style={{ background: (BRANS_COLORS[app.brans] || BRANS_COLORS['ARTİSTİK']).bg, color: (BRANS_COLORS[app.brans] || BRANS_COLORS['ARTİSTİK']).color }}>
                                                                    <i className="material-icons-round">sports_gymnastics</i> {app.brans}
                                                                </span>
                                                            )}
                                                            <span className="meta-badge"><i className="material-icons-round">category</i> {app.categoryName}</span>
                                                            <span className="meta-badge"><i className="material-icons-round">place</i> {app.city} {app.district ? `/ ${app.district}` : ''}</span>
                                                            <span className="meta-badge"><i className="material-icons-round">groups</i> {app.athleteCount} Sporcu</span>
                                                            {(() => {
                                                                const rules = getTeamRules(app.categoryName);
                                                                if (!rules) return null;
                                                                return (
                                                                    <span className="meta-badge meta-badge--rule" title={`Takım kuralı: min ${rules.min}, max ${rules.max}`}>
                                                                        <i className="material-icons-round">rule</i>
                                                                        Takım: {rules.min}-{rules.max} sporcu
                                                                    </span>
                                                                );
                                                            })()}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="app-card__right">
                                                    {app.status === 'bekliyor' && (
                                                        <div className="app-card__actions">
                                                            {hasPermission('applications', 'onayla') && (
                                                                <button
                                                                    className="action-btn action-btn--approve"
                                                                    onClick={() => handleStatusChange(app, 'onaylandi')}
                                                                    title="Onayla"
                                                                >
                                                                    <i className="material-icons-round">check</i>
                                                                    <span>Onayla</span>
                                                                </button>
                                                            )}
                                                            {hasPermission('applications', 'reddet') && (
                                                                <button
                                                                    className="action-btn action-btn--reject"
                                                                    onClick={() => handleStatusChange(app, 'reddedildi')}
                                                                    title="Reddet"
                                                                >
                                                                    <i className="material-icons-round">close</i>
                                                                    <span>Reddet</span>
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}

                                                    {app.status !== 'bekliyor' && (
                                                        <div className="app-card__status-display" style={{ color: currentStatus.color, background: `${currentStatus.color}15` }}>
                                                            {currentStatus.label}
                                                            {(hasPermission('applications', 'onayla') || hasPermission('applications', 'reddet')) && (
                                                                <button
                                                                    className="status-undo-btn"
                                                                    onClick={() => handleStatusChange(app, 'bekliyor')}
                                                                    title="Geri Al"
                                                                >
                                                                    <i className="material-icons-round">undo</i>
                                                                </button>
                                                            )}
                                                            {app.status === 'onaylandi' && hasPermission('applications', 'onayla') && (
                                                                <button
                                                                    className="status-resync-btn"
                                                                    onClick={() => handleResyncAthletes(app)}
                                                                    title="Sporcuları Yeniden Senkronize Et — Sporcu listesinde görünmüyorsa kullanın"
                                                                >
                                                                    <i className="material-icons-round">sync</i>
                                                                </button>
                                                            )}
                                                            {app.status === 'reddedildi' && hasPermission('applications', 'reddet') && (
                                                                <button
                                                                    className="status-delete-btn"
                                                                    onClick={() => handleDeleteApplication(app)}
                                                                    title="Başvuruyu Sil"
                                                                >
                                                                    <i className="material-icons-round">delete_forever</i>
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Genişletilmiş Detay Görünümü */}
                                            {isExpanded && (
                                                <div className="app-card__detail">
                                                    <div className="detail-section">
                                                        <div className="detail-info-block">
                                                            <strong>Öğretmenler:</strong>
                                                            {app.teachers && app.teachers.length > 0 ? (
                                                                app.teachers.map((t, i) => (
                                                                    <span key={i}>{t.name || '-'} ({t.phone || '-'}){t.email ? ` — ${t.email}` : ''}</span>
                                                                ))
                                                            ) : app.teacherName ? (
                                                                <span>{app.teacherName} ({app.teacherPhone || '-'})</span>
                                                            ) : <span>-</span>}
                                                        </div>

                                                        <div className="detail-info-block">
                                                            <strong>Antrenörler:</strong>
                                                            {app.coaches && app.coaches.length > 0 ? (
                                                                app.coaches.map((c, i) => (
                                                                    <span key={i}>{c.name || c.ad || '-'} ({c.phone || c.tel || '-'}){c.email ? ` — ${c.email}` : ''}</span>
                                                                ))
                                                            ) : <span>-</span>}
                                                        </div>
                                                    </div>

                                                    <div className="detail-athletes">
                                                        <strong>Sporcu Listesi ({app.athleteCount})</strong>
                                                        <div className="athlete-grid">
                                                            {app.athletes.map((ath, idx) => (
                                                                <div className="athlete-card" key={idx}>
                                                                    <div className="ath-name">{ath.name || ath.adSoyad || '-'}</div>
                                                                    <div className="ath-detail">TCKN: {ath.tckn || '-'}</div>
                                                                    <div className="ath-detail">Lisans: {ath.license || ath.lisans || '-'}</div>
                                                                    <div className="ath-detail">D.Tarihi: {ath.dob || '-'}</div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* Eksik Sporcular Modalı */}
            {missingAthletesModal.isOpen && (
                <div className="modal-overlay animate-fade-in" style={{ zIndex: 9999 }}>
                    <div className="modal-content animate-slide-up" style={{ maxWidth: '800px', width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
                        <div className="modal-header">
                            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                                <i className="material-icons-round" style={{ color: '#EA580C' }}>warning</i>
                                Eksik Sporcular Bulundu
                            </h2>
                            <button className="btn-close" onClick={() => setMissingAthletesModal({ isOpen: false, data: [] })}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>
                        <div className="modal-body">
                            <p style={{ marginBottom: '1.5rem', color: '#64748b' }}>
                                Aşağıdaki başvurularda yer alan, ancak henüz yarışma "Sporcular" listesine dahil edilmemiş sporcular tespit edildi.
                            </p>
                            
                            <div className="missing-list" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
                                {missingAthletesModal.data.map((item, index) => (
                                    <div key={index} style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem', backgroundColor: '#f8fafc' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem' }}>
                                            <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#334155' }}>{item.app.schoolName}</h3>
                                            <span style={{ fontSize: '0.85rem', backgroundColor: '#e0e7ff', color: '#4338ca', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                                                {item.app.categoryName} <span style={{ marginLeft: 4, opacity: 0.8 }}>({item.app.brans})</span>
                                            </span>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.5rem' }}>
                                            {item.missingAthletes.map((ath, athIdx) => (
                                                <div key={athIdx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', color: '#475569' }}>
                                                    <i className="material-icons-round" style={{ fontSize: '1rem', color: '#cbd5e1' }}>person</i>
                                                    {ath.name || ath.adSoyad} (TC: {ath.tckn || '*'})
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="modal-footer" style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                            <button className="btn-outline-gray" onClick={() => setMissingAthletesModal({ isOpen: false, data: [] })}>
                                İptal
                            </button>
                            <button 
                                className="btn-primary" 
                                onClick={handleAddMissingAthletes}
                                disabled={isSyncingAll}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                            >
                                <i className="material-icons-round" style={{ animation: isSyncingAll ? 'spin 1s linear infinite' : 'none' }}>add_circle</i>
                                {isSyncingAll ? 'İşleniyor...' : 'Listelediklerimi Senkronize Et ve Ekle'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
