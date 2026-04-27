// ─── Firebase Init (npm package — will be tree-shaken & bundled by Vite) ───
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, push, query, orderByChild, equalTo } from "firebase/database";
import {
  getAvailablePublicBranchOptions,
  normalizePublicMatchValue,
  pickBetterCompetitionRecord,
  PUBLIC_BRANCH_OPTIONS,
  PUBLIC_COMPETITION_SOURCES,
  PUBLIC_COMPETITION_SOURCE_PATHS,
  inferCompetitionBranch,
} from "./lib/publicCompetitionConfig.js";

// ─── Config decode (XOR) ───
const _k = 0x5A;
function _d(h) {
  let r = '';
  for (let i = 0; i < h.length; i += 2) {
    r += String.fromCharCode(parseInt(h.substr(i, 2), 16) ^ _k);
  }
  return r;
}

const _fc = {
  apiKey: _d("1b13203b09231e032e3b0d3d6a0b3e2a2f1d053b1b391d3f6811280a2a39693c32223735112a6e"),
  authDomain: _d("35312f36292a3528363b2833776c3e386c3f743c33283f383b293f3b2a2a74393537"),
  databaseURL: _d("322e2e2a2960757535312f36292a3528363b2833776c3e386c3f773e3f3c3b2f362e77282e3e38743c33283f383b293f333574393537"),
  projectId: _d("35312f36292a3528363b2833776c3e386c3f"),
  storageBucket: _d("35312f36292a3528363b2833776c3e386c3f743c33283f383b293f292e35283b3d3f743b2a2a"),
  messagingSenderId: _d("6e6e6f6b686c6e6a6f6f626f"),
  appId: _d("6b606e6e6f6b686c6e6a6f6f626f602d3f3860696f3f6d3c636a69636d6e6e6f6c6d6a396b6939636362"),
  measurementId: _d("1d77190a696b0e1c08140e10")
};

const app = initializeApp(_fc);
const db = getDatabase(app);

// ─── Türkiye Şampiyonası Modu ───
const isTurkiyeMode = new URLSearchParams(window.location.search).get('tur') === 'turkiye';

// ─── State ───
let turkeyData = {};
let schoolsData = {};
let coachesData = [];
let competitionsCache = {};
let selectedCompetition = null;
let selectedCategory = null;
let participationType = 'Ferdi';
let categoryLimits = { min: 3, max: 8 };
let existingAthleteCount = 0; // Bu okul+kategori için veritabanındaki mevcut sporcu sayısı
let remainingQuota = 8;       // Kalan kontenjan = max - existingAthleteCount
let quotaLoading = false;
let submitCooldown = false;
let categoryConfig = null; // { cinsiyet, dobRules, okulTurleri } — Firebase'den yüklenir

// ─── Utility Functions ───
function sanitize(str) {
  if (typeof str !== 'string') return '';
  // HTML tag + event handler kaldır, uzunluk sınırı uygula
  return str.replace(/<[^>]*>/g, '').replace(/on\w+\s*=/gi, '').trim().slice(0, 500);
}

// innerHTML'e veri eklerken XSS'i önlemek için HTML özel karakterleri kaçır
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Başvuru Rate Limiting ───
const _rl = { count: 0, resetAt: 0, MAX: 5, WINDOW_MS: 5 * 60 * 1000 }; // 5 dakikada max 5 başvuru
function checkSubmitRateLimit() {
  const now = Date.now();
  if (now > _rl.resetAt) { _rl.count = 0; _rl.resetAt = now + _rl.WINDOW_MS; }
  _rl.count++;
  if (_rl.count > _rl.MAX) {
    const wait = Math.ceil((_rl.resetAt - now) / 1000);
    showModal({ title: 'LÜTFEN BEKLEYIN', type: 'warning',
      message: `Kısa sürede çok fazla başvuru denemesi yapıldı. ${wait} saniye sonra tekrar deneyiniz.` });
    return false;
  }
  return true;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3200);
}

function showErrorModal(title, message) {
  showModal({ title, message, type: 'error' });
}

// Maskeli isim: ilk 2 karakter açık, geri kalanı yıldız
function maskName(name) {
  if (!name) return '***';
  const parts = name.split(' ');
  return parts.map(p => {
    if (p.length <= 2) return p;
    return p.substring(0, 2) + '*'.repeat(p.length - 2);
  }).join(' ');
}

// Maskeli TC: ilk 3 ve son 2 hane görünür, ortası *
function maskTCKN(tckn) {
  if (!tckn || tckn.length < 5) return '***';
  return tckn.slice(0, 3) + '•'.repeat(tckn.length - 5) + tckn.slice(-2);
}

// Maskeli okul: İlk kelime tam, diğer kelimeler ilk 2 harf + *
function maskSchool(name) {
  if (!name) return '***';
  const parts = name.split(' ');
  return parts.map((p, i) => {
    if (i === 0 || p.length <= 2) return p;
    return p.substring(0, 2) + '*'.repeat(Math.max(0, p.length - 2));
  }).join(' ');
}

// Genel popup — type: error, warning, success, info
function showModal({ title, message, type = 'error', html = '', buttons = null }) {
  const iconMap = { error: 'error_outline', warning: 'warning', success: 'check_circle', info: 'info' };
  const iconEl = document.getElementById('modalIcon');
  const iconWrap = document.getElementById('modalIconWrap');
  iconEl.textContent = iconMap[type] || 'info';
  iconWrap.className = 'modal-icon ' + type;
  document.getElementById('modalTitle').textContent = title;
  const msgEl = document.getElementById('modalMessage');
  if (html) {
    msgEl.innerHTML = html;
  } else {
    msgEl.textContent = message || '';
  }
  const actionsEl = document.getElementById('modalActions');
  actionsEl.innerHTML = '';
  if (buttons && buttons.length > 0) {
    buttons.forEach(btn => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = btn.primary ? 'btn btn-primary' : 'btn btn-secondary';
      b.textContent = btn.label;
      b.onclick = () => {
        document.getElementById('errorModal').classList.remove('show');
        if (btn.action) btn.action();
      };
      actionsEl.appendChild(b);
    });
  } else {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-primary';
    b.textContent = 'TAMAM';
    b.onclick = () => document.getElementById('errorModal').classList.remove('show');
    actionsEl.appendChild(b);
  }
  document.getElementById('errorModal').classList.add('show');
}

// Yarışmada mevcut tüm başvuruları sporcu isimleriyle çek
async function getExistingAthletes(competitionId, categoryId) {
  const athletes = [];
  try {
    const appsSnap = await get(query(ref(db, 'applications'), orderByChild('competitionId'), equalTo(competitionId)));
    if (appsSnap.exists()) {
      appsSnap.forEach(child => {
        const appData = child.val();
        if (appData.kategoriId !== categoryId) return;
        const status = appData.durum || appData.status || 'bekliyor';
        if (status === 'reddedildi') return;
        const school = appData.okul || '';
        if (appData.sporcular && Array.isArray(appData.sporcular)) {
          appData.sporcular.forEach(sp => {
            athletes.push({ name: sp.name || '', school, source: 'başvuru', status });
          });
        }
      });
    }
    const fbPath = getCompFirebasePath(competitionId);
    const approvedSnap = await get(ref(db, `${fbPath}/${competitionId}/sporcular/${categoryId}`));
    if (approvedSnap.exists()) {
      Object.values(approvedSnap.val()).forEach(sp => {
        const name = sp.ad ? `${sp.ad} ${sp.soyad || ''}` : (sp.name || '');
        athletes.push({ name, school: sp.okul || sp.school || '', source: 'onaylı', status: 'onaylandi' });
      });
    }
  } catch (e) {
    console.warn('Mevcut sporcu listesi alınamadı:', e);
  }
  return athletes;
}

// Maskeli sporcu listesi HTML oluştur
function buildAthleteListHTML(athletes) {
  if (athletes.length === 0) return '';
  let html = '<ul class="modal-athlete-list">';
  athletes.forEach(a => {
    const badge = a.status === 'onaylandi'
      ? '<span class="ath-badge approved">ONAYLI</span>'
      : '<span class="ath-badge pending">BEKLEMEDE</span>';
    // escapeHtml: maskName sonrası da kaçış yapılır — XSS önlemi
    html += `<li><span><span class="ath-name">${escapeHtml(maskName(a.name))}</span><span class="ath-school">${escapeHtml(maskName(a.school))}</span></span>${badge}</li>`;
  });
  html += '</ul>';
  return html;
}

function updateStepIndicators() {
  const steps = document.querySelectorAll('.step-dot');
  const sections = [1, 2, 3, 4, 5];
  sections.forEach((s, i) => {
    const dot = steps[i];
    if (!dot) return;
    const card = document.querySelector(`.card[data-section="${s}"]`);
    const inputs = card ? card.querySelectorAll('input[required],select[required]') : [];
    let allFilled = inputs.length > 0;
    inputs.forEach(inp => {
      if (!inp.value || (inp.type === 'checkbox' && !inp.checked)) allFilled = false;
    });
    dot.classList.remove('active', 'done');
    if (allFilled && inputs.length > 0) {
      dot.classList.add('done');
    }
  });
  // Mark first non-done as active
  const firstPending = document.querySelector('.step-dot:not(.done)');
  if (firstPending) firstPending.classList.add('active');
}

function getCategoryLimits(categoryName, categoryId) {
  if (!categoryName && !categoryId) return { min: 1, max: 8 };
  const lower = (categoryName || categoryId || '').toLowerCase()
    .replace(/ı/g, 'i').replace(/ü/g, 'u').replace(/ö/g, 'o')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g');

  // ── Aerobik Cimnastik ──
  // Çift karma kategorileri: tam 2 sporcu
  if (lower.includes('karma') || lower.includes('cift') || lower.includes('çift')) {
    return { min: 2, max: 2, exact: true };
  }
  // Step aerobik takım: 5-8 sporcu
  if (lower.includes('step')) {
    return { min: 5, max: 8 };
  }
  // Aerobik / Trampolin / Parkur / Ritmik bireysel: tam 1 sporcu
  if (lower.includes('aerobik') || lower.includes('trampolin') || lower.includes('parkur') || lower.includes('ritmik') || lower.includes('ferdi')) {
    return { min: 1, max: 1, exact: true };
  }

  // ── Artistik Cimnastik ──
  if (lower.includes('minik')) return { min: 4, max: 7 };
  if (lower.includes('kucuk') || lower.includes('küçük')) return { min: 4, max: 5 };
  if (lower.includes('yildiz') || lower.includes('yıldız') || lower.includes('genc') || lower.includes('genç')) return { min: 2, max: 3 };

  return { min: 1, max: 8 };
}

function validateTCKN(tckn) {
  if (!/^\d{11}$/.test(tckn)) return false;
  // İlk hane 0 olamaz
  if (tckn[0] === '0') return false;
  const d = tckn.split('').map(Number);
  // 10. hane kontrolü: ((d1+d3+d5+d7+d9)*7 - (d2+d4+d6+d8)) mod 10
  const oddSum = d[0] + d[2] + d[4] + d[6] + d[8];
  const evenSum = d[1] + d[3] + d[5] + d[7];
  if ((oddSum * 7 - evenSum) % 10 !== d[9]) return false;
  // 11. hane kontrolü: ilk 10 hanenin toplamı mod 10
  const first10Sum = d.slice(0, 10).reduce((a, b) => a + b, 0);
  if (first10Sum % 10 !== d[10]) return false;
  return true;
}

function validatePhone(phone) {
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  return /^(\+?90)?[0-9]{10}$/.test(cleaned) || /^[0-9]{10,11}$/.test(cleaned);
}

function validateEmail(email) {
  if (!email || !email.trim()) return true; // opsiyonel alan
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

async function loadCategoryConfig(branchValue, categoryId) {
  categoryConfig = null;
  if (!branchValue || !categoryId && categoryId !== 0) return;
  const disciplineKey = branchValue.toLowerCase(); // "Artistik" → "artistik"
  try {
    const snap = await get(ref(db, `kategoriYonetimi/${disciplineKey}/${categoryId}`));
    if (snap.exists()) {
      categoryConfig = snap.val();
    }
  } catch (e) {
    console.warn('Kategori yapılandırması yüklenemedi:', e);
  }
  // Okul listesini mevcut filtre metniyle yeniden çiz
  const schoolFilter = document.getElementById('schoolFilter');
  renderSchoolSelect(schoolFilter ? schoolFilter.value : '');
}

function validateDOBAgainstRules(dob, dobRules) {
  if (!dobRules || dobRules.length === 0) return { valid: true };
  const d = new Date(dob);
  if (isNaN(d.getTime())) return { valid: true }; // format hatası zaten validateDOBRange yakalar
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  for (const rule of dobRules) {
    if (rule.year !== year) continue;
    const mn = rule.monthMin || 1;
    const mx = rule.monthMax || 12;
    if (month >= mn && month <= mx) return { valid: true };
  }
  const allowedYears = [...new Set(dobRules.map(r => r.year))].sort().join(', ');
  return { valid: false, message: `DOĞUM YILI (${year}) BU KATEGORİ İÇİN UYGUN DEĞİL (İZİN VERİLEN: ${allowedYears})` };
}

function validateDOBRange(dob, categoryName) {
  if (!dob) return { valid: false, message: 'DOĞUM TARİHİ BOŞ' };
  const birthDate = new Date(dob);
  const today = new Date();
  if (isNaN(birthDate.getTime())) return { valid: false, message: 'GEÇERSİZ TARİH FORMATI' };
  // Gelecek tarih olamaz
  if (birthDate > today) return { valid: false, message: 'DOĞUM TARİHİ GELECEKTE OLAMAZ' };
  // Yaş hesapla
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age--;
  // Genel aralık: 5-25 yaş arası okul sporcusu olabilir
  if (age < 5) return { valid: false, message: `SPORCU YAŞI ÇOK KÜÇÜK (${age} YAŞ)` };
  if (age > 25) return { valid: false, message: `SPORCU YAŞI ÇOK BÜYÜK (${age} YAŞ)` };
  // Kategori bazlı yaş uyarıları (hata değil, uyarı)
  const lower = (categoryName || '').toLowerCase().replace(/ı/g, 'i').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g');
  let expectedMin = 5, expectedMax = 25;
  if (lower.includes('minik')) { expectedMin = 6; expectedMax = 11; }
  else if (lower.includes('kucuk')) { expectedMin = 9; expectedMax = 13; }
  else if (lower.includes('yildiz')) { expectedMin = 11; expectedMax = 15; }
  else if (lower.includes('genc')) { expectedMin = 13; expectedMax = 18; }
  if (age < expectedMin || age > expectedMax) {
    return { valid: true, warning: `SPORCU YAŞI (${age}) BU KATEGORİ İÇİN UYGUN OLMAYABİLİR (BEKLENen: ${expectedMin}-${expectedMax} YAŞ)` };
  }
  return { valid: true };
}

function validateLicenseNo(license) {
  if (!license || !license.trim()) return true; // opsiyonel
  const cleaned = license.trim();
  if (cleaned.length > 50) return false;
  // Sadece harf, rakam, tire ve boşluk
  return /^[a-zA-Z0-9çğıöşüÇĞİÖŞÜ\s\-]{1,50}$/.test(cleaned);
}

// ─── Data Loading ───
async function loadTurkeyData() {
  try {
    const res = await fetch('./data/turkey_data.json');
    if (!res.ok) throw new Error('Failed');
    turkeyData = await res.json();
    populateCities();
  } catch (e) {
    console.warn('turkey_data.json yüklenemedi, şehirler manuel girilecek.', e);
    const citySelect = document.getElementById('citySelect');
    citySelect.innerHTML = '<option value="">ŞEHİR YÜKLENEMEDİ - MANUEL GİRİNİZ</option>';
  }
}

function populateCities() {
  const citySelect = document.getElementById('citySelect');
  citySelect.innerHTML = '<option value="">İL SEÇİNİZ</option>';
  Object.keys(turkeyData).sort((a, b) => a.localeCompare(b, 'tr')).forEach(city => {
    const opt = document.createElement('option');
    opt.value = city;
    opt.textContent = city.toLocaleUpperCase('tr-TR');
    citySelect.appendChild(opt);
  });
}

function populateDistricts(city) {
  const districtSelect = document.getElementById('districtSelect');
  districtSelect.innerHTML = '<option value="">İLÇE SEÇİNİZ</option>';
  if (turkeyData[city]) {
    turkeyData[city].forEach(district => {
      const opt = document.createElement('option');
      opt.value = district;
      opt.textContent = district.toLocaleUpperCase('tr-TR');
      districtSelect.appendChild(opt);
    });
  }
}

async function loadSchools() {
  try {
    const res = await fetch('./data/schools.json');
    if (!res.ok) throw new Error('Failed');
    schoolsData = await res.json();
  } catch (e) {
    console.warn('schools.json yüklenemedi.', e);
    schoolsData = {};
  }
}

async function loadCoaches() {
  try {
    const res = await fetch('./data/coaches_2026.json');
    if (!res.ok) throw new Error('Failed');
    coachesData = await res.json();
  } catch (e) {
    console.warn('coaches_2026.json yüklenemedi, antrenör doğrulaması devre dışı.', e);
    coachesData = [];
  }
}

async function loadCompetitions() {
  const competitionSelect = document.getElementById('competitionSelect');
  try {
    competitionsCache = {};

    for (const source of PUBLIC_COMPETITION_SOURCES) {
      const compSnap = await get(ref(db, source.path));
      if (!compSnap.exists()) continue;

      compSnap.forEach(child => {
        const data = child.val();
        if (data.durum === 'pasif') return;
        const candidate = { ...data, _firebasePath: source.path };
        const existing = competitionsCache[child.key];
        competitionsCache[child.key] = pickBetterCompetitionRecord(existing, candidate);
      });
    }

    if (Object.keys(competitionsCache).length === 0) {
      competitionSelect.innerHTML = '<option value="">AKTİF YARIŞMA BULUNAMADI</option>';
    } else {
      competitionSelect.innerHTML = '<option value="">ÖNCE İL SEÇİNİZ</option>';
    }
  } catch (e) {
    console.error('Yarışmalar yüklenirken hata:', e);
    competitionSelect.innerHTML = '<option value="">YARIŞMALAR YÜKLENEMEDİ</option>';
    showToast('Yarışmalar yüklenirken hata oluştu', 'error');
  }
}

// Seçili yarışmanın Firebase path'ini döndürür
function getCompFirebasePath(competitionId) {
  const comp = competitionsCache[competitionId];
  return (comp && comp._firebasePath) || 'competitions';
}

// Bir yarışmanın başvuruya açık olup olmadığını kontrol eder
function isCompetitionOpen(data) {
  // Admin manuel olarak kapattıysa → kesinlikle kapalı (tarih hesabından bağımsız)
  if (data.basvuruKapaliMi === true) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const baslangic = data.baslangicTarihi || data.tarih;
  if (!baslangic) return true; // Tarih belirtilmemiş → açık kabul et
  const startDate = new Date(baslangic); startDate.setHours(0, 0, 0, 0);
  const kapanmaGunu = data.basvuruKapanmaGunu != null ? Number(data.basvuruKapanmaGunu) : 2;
  const deadlineDate = new Date(startDate);
  deadlineDate.setDate(deadlineDate.getDate() - kapanmaGunu);
  return today < deadlineDate;
}

// Başvuru kontrolünde gösterilebilir yarışma mı?
// - Yarışma silinmişse cache'de yoktur → gösterme
// - Yarışma pasif veya başvuru süresi geçmişse → gösterme
function isCompetitionVisibleInQuery(competitionId) {
  if (!competitionId) return false;
  const comp = competitionsCache[competitionId];
  if (!comp) return false;
  if (comp.durum === 'pasif') return false;
  return isCompetitionOpen(comp);
}

function filterCompetitions() {
  const city = document.getElementById('citySelect').value;
  const branch = document.getElementById('branchSelect').value;
  const competitionSelect = document.getElementById('competitionSelect');
  competitionSelect.innerHTML = '<option value="">YARIŞMA SEÇİNİZ</option>';

  // Türkiye Şampiyonası modunda şehir filtresi yok
  if (!isTurkiyeMode && !city) {
    competitionSelect.innerHTML = '<option value="">ÖNCE İL SEÇİNİZ</option>';
    return;
  }

  const cityUpper = normalizePublicMatchValue(city);
  const branchUpper = normalizePublicMatchValue(branch);
  let count = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let closedCount = 0;
  const openCompetitions = [];

  Object.entries(competitionsCache).forEach(([key, data]) => {
    // Türkiye modu: sadece tur==='turkiye' olan yarışmalar
    if (isTurkiyeMode) {
      if ((data.tur || 'il') !== 'turkiye') return;
    } else {
      // Normal mod: şehire göre filtrele
      const compCity = normalizePublicMatchValue(data.il || '');
      if (compCity !== cityUpper) return;
    }

    // Başvuru kapanma kontrolü
    const baslangic = data.baslangicTarihi || data.tarih;
    let isOpen = true;
    if (baslangic) {
      const startDate = new Date(baslangic);
      startDate.setHours(0, 0, 0, 0);
      const kapanmaGunu = data.basvuruKapanmaGunu != null ? Number(data.basvuruKapanmaGunu) : 2;
      const deadlineDate = new Date(startDate);
      deadlineDate.setDate(deadlineDate.getDate() - kapanmaGunu);
      isOpen = today < deadlineDate;
    }
    if (isOpen) {
      openCompetitions.push([key, data]);
    }

    const effectiveBrans = normalizePublicMatchValue(inferCompetitionBranch(data));
    if (effectiveBrans !== branchUpper) return;
    if (!isOpen) {
      closedCount++;
      return;
    }
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = (data.isim || data.ad || data.name || key).toLocaleUpperCase('tr-TR');
    competitionSelect.appendChild(opt);
    count++;
  });

  if (count === 0 && openCompetitions.length > 0) {
    const branchSelect = document.getElementById('branchSelect');
    const available = getAvailablePublicBranchOptions(
      openCompetitions.map(([, data]) => data),
      null,
      { includeAllWhenEmpty: false }
    );
    const suggestedBranch = available[0]?.value || null;
    if (suggestedBranch && normalizePublicMatchValue(suggestedBranch) !== branchUpper) {
      branchSelect.value = suggestedBranch;
      return filterCompetitions();
    }
  }

  if (count === 0 && closedCount > 0) {
    competitionSelect.innerHTML = isTurkiyeMode
      ? '<option value="">TÜRKİYE ŞAMPİYONASI BAŞVURULARI KAPANMIŞTIR</option>'
      : '<option value="">BU İLDEKİ YARIŞMALARIN BAŞVURULARI KAPANMIŞTIR</option>';
  } else if (count === 0) {
    competitionSelect.innerHTML = isTurkiyeMode
      ? '<option value="">AKTİF TÜRKİYE ŞAMPİYONASI BULUNAMADI</option>'
      : '<option value="">BU İLDE AKTİF YARIŞMA BULUNAMADI</option>';
  }
  document.getElementById('categorySelect').innerHTML = '<option value="">ÖNCE YARIŞMA SEÇİNİZ</option>';
  selectedCompetition = null;
  updateStepIndicators();
}

function updateActiveBranches() {
  const city = document.getElementById('citySelect').value;
  const branchSelect = document.getElementById('branchSelect');
  const currentBranch = branchSelect.value;
  const availableBranches = getAvailablePublicBranchOptions(
    Object.values(competitionsCache),
    city,
    { isOpen: isCompetitionOpen },
  );

  branchSelect.innerHTML = '';
  let hasCurrentBranch = false;

  availableBranches.forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label || value.toLocaleUpperCase('tr-TR');
    if (value === currentBranch) hasCurrentBranch = true;
    branchSelect.appendChild(opt);
  });

  if (!hasCurrentBranch) {
    branchSelect.value = branchSelect.options[0]?.value || PUBLIC_BRANCH_OPTIONS[0]?.value || 'Artistik';
  }
}

// ─── School Select (Combo) ───
let currentSchools = [];

function findSchoolKey(obj, target) {
  if (!obj || !target) return null;
  if (obj[target]) return target;
  const targetUpper = target.toLocaleUpperCase('tr-TR');
  if (obj[targetUpper]) return targetUpper;
  // Türkçe İ/I farkını tolere et: her ikisini de 'I' olarak normalize et
  const norm = (s) => s.toLocaleUpperCase('tr-TR').replace(/İ/g, 'I');
  const targetNorm = norm(target);
  return Object.keys(obj).find(k => norm(k) === targetNorm) || null;
}

function getSchoolGroup(name) {
  const u = name.toLocaleUpperCase('tr-TR');
  if (u.includes('ANAOKULU')) return 'ANAOKULU';
  if (u.includes('İLKOKULU') || u.includes('İLKOKUL')) return 'İLKOKULU';
  if (u.includes('ORTAOKULU') || u.includes('ORTAOKUL')) return 'ORTAOKULU';
  if (u.includes('LİSE') || u.includes('LİSESİ') || u.includes('MTAL') || u.includes('KOLEJİ') || u.includes('ANADOLU') || u.includes('FEN')) return 'LİSE';
  return 'DİĞER';
}

function renderSchoolSelect(filterText) {
  const schoolSelect = document.getElementById('schoolSelect');
  schoolSelect.innerHTML = '<option value="">OKUL SEÇİNİZ</option>';
  const filterUpper = (filterText || '').toLocaleUpperCase('tr-TR');
  const groups = { 'ANAOKULU': [], 'İLKOKULU': [], 'ORTAOKULU': [], 'LİSE': [], 'DİĞER': [] };

  // Kategori yapılandırmasından okul türü filtresi
  // okulTurleri: ['ilkokul', 'ortaokul', 'lise'] — Firebase değerleri
  const allowedGroupMap = { ilkokul: 'İLKOKULU', ortaokul: 'ORTAOKULU', lise: 'LİSE', anaokul: 'ANAOKULU' };
  const allowedGroups = (categoryConfig?.okulTurleri && categoryConfig.okulTurleri.length > 0)
    ? categoryConfig.okulTurleri.map(t => allowedGroupMap[t]).filter(Boolean)
    : null; // null = tümüne izin ver

  currentSchools.forEach(s => {
    const name = typeof s === 'string' ? s : (s.name || s.ad || '');
    if (!name) return;
    if (filterUpper && !name.toLocaleUpperCase('tr-TR').includes(filterUpper)) return;
    const group = getSchoolGroup(name);
    if (allowedGroups && !allowedGroups.includes(group)) return; // okul türü filtrele
    groups[group].push(name);
  });

  const groupLabels = { 'ANAOKULU': 'ANAOKULU', 'İLKOKULU': 'İLKOKULU', 'ORTAOKULU': 'ORTAOKULU', 'LİSE': 'LİSE / KOLEJ', 'DİĞER': 'DİĞER' };
  ['ANAOKULU', 'İLKOKULU', 'ORTAOKULU', 'LİSE', 'DİĞER'].forEach(g => {
    if (groups[g].length === 0) return;
    const optgroup = document.createElement('optgroup');
    optgroup.label = groupLabels[g];
    groups[g].sort((a, b) => a.localeCompare(b, 'tr-TR'));
    groups[g].forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      optgroup.appendChild(opt);
    });
    schoolSelect.appendChild(optgroup);
  });

}

async function loadSchoolsForDistrict() {
  const city = document.getElementById('citySelect').value;
  const district = document.getElementById('districtSelect').value;
  const schoolSelect = document.getElementById('schoolSelect');
  const schoolFilter = document.getElementById('schoolFilter');
  const hint = schoolSelect.parentElement.querySelector('.hint');

  currentSchools = [];
  schoolFilter.value = '';

  if (!city || !district) {
    schoolSelect.style.display = 'none';
    schoolFilter.style.display = 'none';
    schoolSelect.required = true;
    schoolSelect.innerHTML = '<option value="">ÖNCE İLÇE SEÇİNİZ</option>';
    if (hint) hint.textContent = 'İLÇE SEÇTİKTEN SONRA OKUL LİSTESİ GÖRÜNECEK';
    return;
  }

  // Firebase'den okul listesini kontrol et (önce Firebase, sonra statik fallback)
  // Anahtarlar schools.json gibi büyük harf (ADANA/ALADAĞ)
  const fbCity = city.toLocaleUpperCase('tr-TR');
  const fbDistrict = district.toLocaleUpperCase('tr-TR');
  try {
    const fbSnap = await get(ref(db, `okullar/${fbCity}/${fbDistrict}`));
    if (fbSnap.exists()) {
      const fbSchools = fbSnap.val();
      if (Array.isArray(fbSchools) && fbSchools.length > 0) {
        currentSchools = fbSchools;
        renderSchoolSelect('');
        schoolSelect.style.display = 'block';
        schoolFilter.style.display = 'block';
        schoolSelect.required = true;
        if (hint) hint.textContent = 'LİSTEDEN OKULUNUZU SEÇİNİZ VEYA FİLTRELEYİNİZ';
        updateStepIndicators();
        return; // Firebase'den yüklendi, statik dosyaya gerek yok
      }
    }
  } catch (fbErr) {
    // Firebase erişim hatası — statik dosyaya devam et
    console.warn('Firebase okul yüklenemedi, statik dosya kullanılıyor:', fbErr);
  }

  if (typeof schoolsData === 'object' && !Array.isArray(schoolsData)) {
    const cityKey = findSchoolKey(schoolsData, city);
    if (cityKey && schoolsData[cityKey]) {
      const districtKey = findSchoolKey(schoolsData[cityKey], district);
      if (districtKey && schoolsData[cityKey][districtKey]) {
        currentSchools = schoolsData[cityKey][districtKey];
      }
    }
  }

  if (currentSchools.length > 0) {
    renderSchoolSelect('');
    schoolSelect.style.display = 'block';
    schoolFilter.style.display = 'block';
    schoolSelect.required = true;
    if (hint) hint.textContent = 'LİSTEDEN OKULUNUZU SEÇİNİZ VEYA FİLTRELEYİNİZ';
  } else {
    schoolSelect.style.display = 'none';
    schoolFilter.style.display = 'none';
    schoolSelect.required = false;
    if (hint) hint.textContent = 'BU İLÇEDE KAYITLI OKUL BULUNAMADI';
  }
  updateStepIndicators();
}

// ─── Dynamic Row Helpers ───
function createDynamicRow(containerId, fields, index) {
  const row = document.createElement('div');
  row.className = 'dynamic-row';
  const numEl = document.createElement('div');
  numEl.className = 'row-num';
  numEl.textContent = index;
  row.appendChild(numEl);
  const fieldsDiv = document.createElement('div');
  fieldsDiv.className = 'fields';
  fields.forEach(f => {
    const input = document.createElement('input');
    input.type = f.type || 'text';
    input.placeholder = f.placeholder;
    input.setAttribute('data-field', f.name);
    if (f.maxlength) input.maxLength = f.maxlength;
    if (f.pattern) input.pattern = f.pattern;
    if (f.inputmode) input.inputMode = f.inputmode;
    // Coach name validation
    if (containerId === 'coachRows' && f.name === 'name') {
      input.addEventListener('input', function() { validateCoachInput(this); });
      input.addEventListener('blur', function() { handleCoachBlur(this); });
    }
    // E-posta doğrulaması (antrenör + öğretmen)
    if ((containerId === 'coachRows' || containerId === 'teacherRows') && f.name === 'email') {
      input.addEventListener('blur', function() {
        const val = (this.value || '').trim();
        if (!val) { this.classList.remove('valid', 'invalid'); return; }
        if (validateEmail(val)) {
          this.classList.remove('invalid'); this.classList.add('valid');
        } else {
          this.classList.remove('valid'); this.classList.add('invalid');
          showToast('✗ E-POSTA FORMATI GEÇERSİZ', 'error');
        }
      });
    }
    // Athlete field validations
    if (containerId === 'athleteRows') {
      if (f.name === 'tckn') {
        input.addEventListener('input', function() { validateAthleteTCKN(this); });
        input.addEventListener('blur', function() { handleAthleteTCKNBlur(this); });
      }
      if (f.name === 'name') {
        input.addEventListener('input', function() { validateAthleteNameInput(this); });
        input.addEventListener('blur', function() { handleAthleteNameBlur(this); });
      }
      if (f.name === 'dob') {
        input.addEventListener('change', function() { validateAthleteDOBInput(this); });
        input.addEventListener('blur', function() { handleAthleteDOBBlur(this); });
      }
    }
    fieldsDiv.appendChild(input);
  });
  row.appendChild(fieldsDiv);
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-remove-row';
  removeBtn.innerHTML = '<span class="material-icons-round">close</span>';
  removeBtn.addEventListener('click', () => {
    row.remove();
    renumberRows(containerId);
    if (containerId === 'athleteRows') { checkAthleteCount(); updateQuotaInfoBox(); }
    updateStepIndicators();
  });
  row.appendChild(removeBtn);
  return row;
}

function renumberRows(containerId) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('.dynamic-row').forEach((row, i) => {
    row.querySelector('.row-num').textContent = i + 1;
  });
}

function addCoachRow() {
  const container = document.getElementById('coachRows');
  const count = container.querySelectorAll('.dynamic-row').length + 1;
  const row = createDynamicRow('coachRows', [
    { name: 'name', placeholder: 'AD SOYAD', type: 'text' },
    { name: 'phone', placeholder: 'TELEFON', type: 'tel', inputmode: 'tel' },
    { name: 'email', placeholder: 'E-POSTA', type: 'email' }
  ], count);
  container.appendChild(row);
  updateStepIndicators();
}

function addTeacherRow() {
  const container = document.getElementById('teacherRows');
  const count = container.querySelectorAll('.dynamic-row').length + 1;
  const row = createDynamicRow('teacherRows', [
    { name: 'name', placeholder: 'AD SOYAD', type: 'text' },
    { name: 'phone', placeholder: 'TELEFON', type: 'tel', inputmode: 'tel' },
    { name: 'email', placeholder: 'E-POSTA', type: 'email' }
  ], count);
  container.appendChild(row);
  updateStepIndicators();
}

function addAthleteRow() {
  const container = document.getElementById('athleteRows');
  const currentCount = container.querySelectorAll('.dynamic-row').length;
  const newCount = currentCount + 1;

  // Kalan kontenjan kontrolü (mevcut kayıtlılar + formdakiler)
  if (remainingQuota === 0) {
    showToast(`✗ KONTENJAN DOLU! BU OKULDAN BU KATEGORİDE ${existingAthleteCount} SPORCU ZATEN KAYITLI (MAX: ${categoryLimits.max})`, 'error');
    return;
  }

  if (newCount > remainingQuota) {
    const kalan = remainingQuota - currentCount;
    if (kalan <= 0) {
      showToast(`✗ KONTENJAN DOLDU! MEVCUT: ${existingAthleteCount} KAYITLI + ${currentCount} FORMDA = ${existingAthleteCount + currentCount}/${categoryLimits.max}`, 'error');
    } else {
      showToast(`✗ EN FAZLA ${remainingQuota} SPORCU EKLENEBİLİR (MEVCUT KAYITLI: ${existingAthleteCount}, MAX: ${categoryLimits.max})`, 'warning');
    }
    return;
  }

  const row = createDynamicRow('athleteRows', [
    { name: 'tckn', placeholder: 'T.C. KİMLİK NO (11 HANE)', type: 'text', maxlength: '11', inputmode: 'numeric', pattern: '[0-9]{11}' },
    { name: 'name', placeholder: 'AD SOYAD', type: 'text' },
    { name: 'dob', placeholder: 'DOĞUM TARİHİ', type: 'date' },
    { name: 'license', placeholder: 'LİSANS NO', type: 'text' }
  ], newCount);

  // Cinsiyet seçimi — alanlar div'ine ekle
  const fieldsDiv = row.querySelector('.fields');
  if (fieldsDiv) {
    const genderSelect = document.createElement('select');
    genderSelect.setAttribute('data-field', 'gender');
    genderSelect.style.cssText = 'flex:0 0 auto;min-width:110px;';
    [['', 'CİNSİYET'], ['Kız', 'KIZ'], ['Erkek', 'ERKEK']].forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      genderSelect.appendChild(opt);
    });
    fieldsDiv.appendChild(genderSelect);
  }

  container.appendChild(row);

  const tcknInput = row.querySelector('[data-field="tckn"]');
  if (tcknInput) tcknInput.focus();

  checkAthleteCount();
  updateQuotaInfoBox();
  updateStepIndicators();

  const effectiveRemaining = remainingQuota - newCount;
  if (effectiveRemaining === 0) {
    const totalAll = existingAthleteCount + newCount;
    showToast(`KONTENJAN DOLDU (${totalAll}/${categoryLimits.max})`, 'info');
  } else if (effectiveRemaining === 1) {
    showToast(`KONTENJANA 1 SPORCU KALDI`, 'info');
  }
}

function checkAthleteCount() {
  const formCount = document.getElementById('athleteRows').querySelectorAll('.dynamic-row').length;
  const totalCount = existingAthleteCount + formCount; // Mevcut kayıtlı + formdaki

  // Toplam sporcu sayısı min'e ulaştıysa otomatik takım yap
  if (participationType === 'Ferdi' && totalCount >= categoryLimits.min) {
    participationType = 'Takım';
    document.getElementById('participationType').value = 'Takım';
    document.getElementById('btnFerdi').classList.remove('active');
    document.getElementById('btnTakim').classList.add('active');
    updateTeamWarning();
    if (existingAthleteCount > 0) {
      showToast(`TOPLAM SPORCU (${existingAthleteCount} KAYITLI + ${formCount} YENİ = ${totalCount}) TAKIM LİMİTİNE ULAŞTI`, 'info');
    } else {
      showToast(`SPORCU SAYISI TAKIM LİMİTİNE ULAŞTI — KATILIM TÜRÜ "TAKIM" OLARAK GÜNCELLENDİ`, 'info');
    }
  }
  if (participationType === 'Takım' && totalCount > 0 && totalCount < categoryLimits.min) {
    const gereken = categoryLimits.min - existingAthleteCount;
    showToast(`TAKIM İÇİN EN AZ ${categoryLimits.min} SPORCU GEREKLİ (MEVCUT: ${existingAthleteCount} KAYITLI + ${formCount} YENİ = ${totalCount})`, 'warning');
  }
  updateStepIndicators();
}

function updateTeamWarning() {
  const box = document.getElementById('teamWarning');
  const text = document.getElementById('teamWarningText');
  if (participationType === 'Takım') {
    if (existingAthleteCount > 0) {
      text.textContent = `Takım katılımı: Bu kategori için max ${categoryLimits.max} sporcu. Bu okuldan ${existingAthleteCount} sporcu zaten kayıtlı, ${remainingQuota} sporcu daha eklenebilir.`;
    } else {
      text.textContent = `Takım katılımı: Bu kategori için en az ${categoryLimits.min}, en fazla ${categoryLimits.max} sporcu gereklidir.`;
    }
    box.classList.add('show');
  } else {
    box.classList.remove('show');
  }
}

// ─── Category Handling ───
function populateCategories(competitionId) {
  const categorySelect = document.getElementById('categorySelect');
  categorySelect.innerHTML = '<option value="">KATEGORİ SEÇİNİZ</option>';
  const comp = competitionsCache[competitionId];
  if (!comp || !comp.kategoriler) return;
  if (Array.isArray(comp.kategoriler)) {
    comp.kategoriler.forEach((cat, idx) => {
      const opt = document.createElement('option');
      const catName = typeof cat === 'string' ? cat : (cat.ad || cat.name || '');
      const catId = typeof cat === 'string' ? idx.toString() : (cat.id || idx.toString());
      opt.value = catId;
      opt.textContent = catName.toLocaleUpperCase('tr-TR');
      opt.setAttribute('data-name', catName);
      categorySelect.appendChild(opt);
    });
  } else if (typeof comp.kategoriler === 'object') {
    Object.entries(comp.kategoriler).forEach(([key, cat]) => {
      const opt = document.createElement('option');
      const catName = typeof cat === 'string' ? cat : (cat.ad || cat.name || key);
      opt.value = key;
      opt.textContent = catName.toLocaleUpperCase('tr-TR');
      opt.setAttribute('data-name', catName);
      categorySelect.appendChild(opt);
    });
  }
}

// ─── Duplicate & Quota Checks ───
async function checkDuplicateTCKNs(competitionId, tcknList) {
  const duplicates = [];
  try {
    const appsSnap = await get(query(ref(db, 'applications'), orderByChild('competitionId'), equalTo(competitionId)));
    if (appsSnap.exists()) {
      appsSnap.forEach(child => {
        const appData = child.val();
        const durum = appData.durum || appData.status || '';
        // Reddedilmiş başvurulardaki sporcuları mükerrer sayma
        if (durum === 'reddedildi') return;
        if (appData.sporcular && Array.isArray(appData.sporcular)) {
          appData.sporcular.forEach(sp => {
            if (tcknList.includes(sp.tckn)) {
              duplicates.push({ tckn: sp.tckn, name: sp.name || '', school: appData.okul || '', source: 'başvuru', status: durum });
            }
          });
        }
      });
    }
  } catch (e) {
    console.warn('Başvuru kontrolünde hata:', e);
  }

  try {
    const categoryId = document.getElementById('categorySelect').value;
    const fbPath = getCompFirebasePath(competitionId);
    const approvedSnap = await get(ref(db, `${fbPath}/${competitionId}/sporcular/${categoryId}`));
    if (approvedSnap.exists()) {
      const approved = approvedSnap.val();
      Object.values(approved).forEach(sp => {
        if (tcknList.includes(sp.tckn)) {
          const name = sp.ad ? `${sp.ad} ${sp.soyad || ''}` : (sp.name || '');
          duplicates.push({ tckn: sp.tckn, name, school: sp.okul || sp.school || '', source: 'onaylı sporcu', status: 'onaylandi' });
        }
      });
    }
  } catch (e) {
    console.warn('Onaylı sporcu kontrolünde hata:', e);
  }

  return duplicates;
}

async function checkSchoolQuota(competitionId, categoryId, schoolName, il, ilce, newAthleteCount) {
  let existingCount = 0;
  const targetSchool = (schoolName || '').toLocaleUpperCase('tr-TR');
  const targetIl = (il || '').toLocaleUpperCase('tr-TR');
  const targetIlce = (ilce || '').toLocaleUpperCase('tr-TR');
  try {
    const appsSnap = await get(query(ref(db, 'applications'), orderByChild('competitionId'), equalTo(competitionId)));
    if (appsSnap.exists()) {
      appsSnap.forEach(child => {
        const appData = child.val();
        const appSchool = (appData.okul || '').toLocaleUpperCase('tr-TR');
        const appIl = (appData.il || '').toLocaleUpperCase('tr-TR');
        const appIlce = (appData.ilce || '').toLocaleUpperCase('tr-TR');
        // il + ilçe + okul bileşik eşleşmesi
        // Sadece bekleyen başvurular sayılır — onaylananlar zaten sporcular/ noduna transfer edildi
        if (appSchool === targetSchool && appIl === targetIl && appIlce === targetIlce &&
            appData.kategoriId === categoryId &&
            (appData.durum === 'bekliyor' || appData.status === 'bekliyor')) {
          if (appData.sporcular && Array.isArray(appData.sporcular)) {
            existingCount += appData.sporcular.length;
          }
        }
      });
    }
    const fbPath = getCompFirebasePath(competitionId);
    const approvedSnap = await get(ref(db, `${fbPath}/${competitionId}/sporcular/${categoryId}`));
    if (approvedSnap.exists()) {
      Object.values(approvedSnap.val()).forEach(sp => {
        const spSchool = (sp.okul || sp.school || '').toLocaleUpperCase('tr-TR');
        const spIl = (sp.il || '').toLocaleUpperCase('tr-TR');
        const ilMatch = !spIl || !targetIl || spIl === targetIl;
        if (spSchool === targetSchool && ilMatch) {
          existingCount++;
        }
      });
    }
  } catch (e) {
    console.warn('Kontenjan kontrolünde hata:', e);
  }
  const threshold = categoryLimits.max * 2;
  if (existingCount + newAthleteCount > threshold) {
    return { exceeded: true, existing: existingCount, threshold };
  }
  return { exceeded: false, existing: existingCount, threshold };
}

// ─── Realtime Quota Check (okul+kategori seçilince çağrılır) ───
async function fetchExistingAthleteCount() {
  const competitionId = document.getElementById('competitionSelect').value;
  const categoryId = document.getElementById('categorySelect').value;
  const schoolName = getSelectedSchool();

  if (!competitionId || !categoryId || !schoolName) {
    existingAthleteCount = 0;
    remainingQuota = categoryLimits.max;
    updateQuotaInfoBox();
    return;
  }

  quotaLoading = true;
  updateQuotaInfoBox();

  let count = 0;
  try {
    // 1. Bekleyen/onaylı başvurulardaki sporcuları say
    const selectedBranch = (document.getElementById('branchSelect')?.value || 'Artistik').toLocaleUpperCase('tr-TR');
    // Aynı isimli farklı ilçe okullarını ayırt etmek için il+ilçe+okul bileşik anahtar kullan
    const targetSchool = schoolName.toLocaleUpperCase('tr-TR');
    const targetIl = (document.getElementById('citySelect')?.value || '').toLocaleUpperCase('tr-TR');
    const targetIlce = (document.getElementById('districtSelect')?.value || '').toLocaleUpperCase('tr-TR');

    const appsSnap = await get(query(ref(db, 'applications'), orderByChild('competitionId'), equalTo(competitionId)));
    if (appsSnap.exists()) {
      appsSnap.forEach(child => {
        const appData = child.val();
        const appSchool = (appData.okul || '').toLocaleUpperCase('tr-TR');
        const appIl = (appData.il || '').toLocaleUpperCase('tr-TR');
        const appIlce = (appData.ilce || '').toLocaleUpperCase('tr-TR');
        // Branş filtresi: sadece aynı branşa ait başvuruları say
        const appBrans = (appData.brans || 'Artistik').toLocaleUpperCase('tr-TR');
        if (appBrans !== selectedBranch) return;
        // il + ilçe + okul bileşik eşleşmesi: aynı isimli farklı okullara karışmasın
        // Sadece bekleyen başvurular sayılır — onaylananlar zaten sporcular/ noduna transfer edildi (Adım 2)
        if (appSchool === targetSchool && appIl === targetIl && appIlce === targetIlce &&
            appData.kategoriId === categoryId &&
            (appData.durum === 'bekliyor' || appData.status === 'bekliyor')) {
          if (appData.sporcular && Array.isArray(appData.sporcular)) {
            count += appData.sporcular.length;
          }
        }
      });
    }

    // 2. Zaten onaylanıp yarışmaya aktarılmış sporcuları say
    // Onaylı sporcu kayıtlarında il bilgisi varsa onu da karşılaştır
    const fbPath = getCompFirebasePath(competitionId);
    const approvedSnap = await get(ref(db, `${fbPath}/${competitionId}/sporcular/${categoryId}`));
    if (approvedSnap.exists()) {
      const approved = approvedSnap.val();
      Object.values(approved).forEach(sp => {
        const spSchool = (sp.okul || sp.school || '').toLocaleUpperCase('tr-TR');
        const spIl = (sp.il || '').toLocaleUpperCase('tr-TR');
        // İl bilgisi varsa karşılaştır, yoksa sadece okul adına bak
        const ilMatch = !spIl || !targetIl || spIl === targetIl;
        if (spSchool === targetSchool && ilMatch) {
          count++;
        }
      });
    }
  } catch (e) {
    console.warn('Kontenjan sorgulamasında hata:', e);
  }

  existingAthleteCount = count;
  remainingQuota = Math.max(0, categoryLimits.max - existingAthleteCount);
  quotaLoading = false;

  updateQuotaInfoBox();

  // Eğer halihazırda eklenen sporcu sayısı kalan kontenjandan fazlaysa uyar
  const currentFormCount = document.getElementById('athleteRows').querySelectorAll('.dynamic-row').length;
  if (currentFormCount > remainingQuota && remainingQuota > 0) {
    showModal({
      title: 'KONTENJAN UYARISI',
      message: `Formda ${currentFormCount} sporcu var ama kalan kontenjan ${remainingQuota}. Lütfen fazla sporcuları çıkarınız.`,
      type: 'warning'
    });
  } else if (remainingQuota === 0) {
    showModal({
      title: 'KONTENJAN DOLU',
      message: `Bu okul ve kategori için kontenjan dolmuştur (${existingAthleteCount}/${categoryLimits.max}).`,
      type: 'error'
    });
  }
}

function updateQuotaInfoBox() {
  const infoBox = document.getElementById('athleteInfo');
  if (!infoBox) return;
  const infoSpan = infoBox.querySelector('span:last-child');
  if (!infoSpan) return;

  const competitionId = document.getElementById('competitionSelect').value;
  const categoryId = document.getElementById('categorySelect').value;
  const schoolName = getSelectedSchool();

  if (!competitionId || !categoryId || !schoolName) {
    infoSpan.textContent = 'SPORCU EKLEMEK İÇİN ÖNCE YARIŞMA, KATEGORİ VE OKUL SEÇİNİZ.';
    infoBox.className = 'info-box';
    return;
  }

  if (quotaLoading) {
    infoSpan.textContent = 'KONTENJAN SORGULANYOR...';
    infoBox.className = 'info-box';
    return;
  }

  const currentFormCount = document.getElementById('athleteRows').querySelectorAll('.dynamic-row').length;
  const effectiveRemaining = Math.max(0, remainingQuota - currentFormCount);

  if (remainingQuota === 0) {
    infoSpan.textContent = `✗ BU OKUL İÇİN KONTENJAN DOLU! MEVCUT KAYITLI SPORCU: ${existingAthleteCount} / MAX: ${categoryLimits.max}. YENİ SPORCU EKLENEMez.`;
    infoBox.className = 'info-box';
    infoBox.style.background = '#fef2f2';
    infoBox.style.borderColor = '#fca5a5';
    infoBox.style.color = '#991b1b';
    return;
  }

  if (existingAthleteCount > 0) {
    const totalAfter = existingAthleteCount + currentFormCount;
    infoSpan.textContent = `BU OKULDAN BU KATEGORİDE ${existingAthleteCount} SPORCU KAYITLI. EN FAZLA ${remainingQuota} SPORCU DAHA EKLENEBİLİR (MAX: ${categoryLimits.max}). ${currentFormCount > 0 ? `FORMDA: ${currentFormCount} | TOPLAM OLACAK: ${totalAfter}` : ''}`;
    if (effectiveRemaining <= 1 && effectiveRemaining >= 0) {
      infoBox.style.background = '#fffbeb';
      infoBox.style.borderColor = '#fde68a';
      infoBox.style.color = '#92400e';
    } else {
      infoBox.style.background = '#eff6ff';
      infoBox.style.borderColor = '#bfdbfe';
      infoBox.style.color = '#1e40af';
    }
  } else {
    infoSpan.textContent = `BU KATEGORİDE EN FAZLA ${categoryLimits.max} SPORCU EKLENEBİLİR.${currentFormCount > 0 ? ` FORMDA: ${currentFormCount}` : ''}`;
    infoBox.style.background = '#eff6ff';
    infoBox.style.borderColor = '#bfdbfe';
    infoBox.style.color = '#1e40af';
  }
}

// ─── Coach Verification ───
function verifyCoach(name) {
  if (!coachesData || coachesData.length === 0) return null;
  if (!name || !name.trim()) return null;
  const normalized = name.toLocaleUpperCase('tr-TR').trim();
  return coachesData.some(c => {
    const coachName = typeof c === 'string' ? c : (c.adSoyad || c.name || c.ad || '');
    return coachName.toLocaleUpperCase('tr-TR').trim() === normalized;
  });
}

function validateCoachInput(inputEl) {
  const name = (inputEl.value || '').trim();
  if (!name || name.length < 3) {
    inputEl.classList.remove('valid', 'invalid');
    return;
  }
  const result = verifyCoach(name);
  if (result === null) {
    inputEl.classList.remove('valid', 'invalid');
    return;
  }
  if (result) {
    inputEl.classList.remove('invalid');
    inputEl.classList.add('valid');
  } else {
    inputEl.classList.remove('valid');
    inputEl.classList.add('invalid');
  }
}

let coachToastShown = {};
function handleCoachBlur(inputEl) {
  const name = (inputEl.value || '').trim();
  if (!name || name.length < 3) return;
  const result = verifyCoach(name);
  if (result === null) return;
  const nameUpper = name.toLocaleUpperCase('tr-TR');
  if (result) {
    if (!coachToastShown[nameUpper + '_ok']) {
      showToast(`✓ ANTRENÖR "${nameUpper}" KAYITLI LİSTEDE BULUNDU`, 'success');
      coachToastShown[nameUpper + '_ok'] = true;
    }
  } else {
    if (!coachToastShown[nameUpper + '_err']) {
      showToast(`✗ ANTRENÖR "${nameUpper}" KAYITLI LİSTEDE BULUNAMADI`, 'error');
      coachToastShown[nameUpper + '_err'] = true;
    }
  }
}

// ─── Athlete Validation ───
let athleteTcknToastShown = {};

function validateAthleteTCKN(inputEl) {
  const val = (inputEl.value || '').trim();
  if (!val) {
    inputEl.classList.remove('valid', 'invalid');
    return;
  }
  const digitsOnly = val.replace(/\D/g, '');
  if (digitsOnly !== val) {
    inputEl.value = digitsOnly;
  }
  if (digitsOnly.length === 11) {
    if (validateTCKN(digitsOnly)) {
      inputEl.classList.remove('invalid');
      inputEl.classList.add('valid');
    } else {
      inputEl.classList.remove('valid');
      inputEl.classList.add('invalid');
    }
  } else if (digitsOnly.length > 0 && digitsOnly.length < 11) {
    inputEl.classList.remove('valid', 'invalid');
  } else {
    inputEl.classList.remove('valid');
    inputEl.classList.add('invalid');
  }
}

function checkDuplicateTCKNInForm(inputEl) {
  const val = (inputEl.value || '').trim();
  if (!val || val.length !== 11) return;
  const allTcknInputs = document.querySelectorAll('#athleteRows [data-field="tckn"]');
  let duplicateFound = false;
  allTcknInputs.forEach(inp => {
    if (inp === inputEl) return;
    if ((inp.value || '').trim() === val) {
      duplicateFound = true;
    }
  });
  if (duplicateFound) {
    inputEl.classList.remove('valid');
    inputEl.classList.add('invalid');
    const key = val + '_dup';
    if (!athleteTcknToastShown[key]) {
      showToast(`✗ T.C. KİMLİK NO "${val}" FORMDA TEKRAR EDİYOR`, 'error');
      athleteTcknToastShown[key] = true;
      setTimeout(() => { delete athleteTcknToastShown[key]; }, 10000);
    }
  }
}

function handleAthleteTCKNBlur(inputEl) {
  const val = (inputEl.value || '').trim();
  if (!val) return;
  if (val.length !== 11 || !/^\d{11}$/.test(val)) {
    inputEl.classList.remove('valid');
    inputEl.classList.add('invalid');
    const key = val + '_fmt';
    if (!athleteTcknToastShown[key]) {
      showToast(`✗ T.C. KİMLİK NO 11 HANELİ RAKAM OLMALIDIR`, 'error');
      athleteTcknToastShown[key] = true;
      setTimeout(() => { delete athleteTcknToastShown[key]; }, 10000);
    }
    return;
  }
  checkDuplicateTCKNInForm(inputEl);
  if (inputEl.classList.contains('valid')) {
    const key = val + '_ok';
    if (!athleteTcknToastShown[key]) {
      showToast(`✓ T.C. KİMLİK NO GEÇERLİ FORMAT`, 'success');
      athleteTcknToastShown[key] = true;
    }
  }
}

function validateAthleteNameInput(inputEl) {
  const val = (inputEl.value || '').trim();
  if (!val) {
    inputEl.classList.remove('valid', 'invalid');
    return;
  }
  if (val.length >= 3) {
    inputEl.classList.remove('invalid');
    inputEl.classList.add('valid');
  } else {
    inputEl.classList.remove('valid', 'invalid');
  }
}

function handleAthleteNameBlur(inputEl) {
  const val = (inputEl.value || '').trim();
  if (!val) {
    inputEl.classList.remove('valid');
    inputEl.classList.add('invalid');
    showToast('✗ SPORCU ADI SOYADI BOŞ BIRAKILAMAZ', 'warning');
    return;
  }
  if (val.length < 3) {
    inputEl.classList.remove('valid');
    inputEl.classList.add('invalid');
    showToast('✗ SPORCU ADI SOYADI EN AZ 3 KARAKTER OLMALIDIR', 'warning');
  }
}

function validateAthleteDOBInput(inputEl) {
  const val = inputEl.value;
  if (!val) {
    inputEl.classList.remove('valid', 'invalid');
    return;
  }
  const categorySelect = document.getElementById('categorySelect');
  const selectedOpt = categorySelect.options[categorySelect.selectedIndex];
  const catName = selectedOpt ? selectedOpt.getAttribute('data-name') || selectedOpt.textContent : '';
  const result = validateDOBRange(val, catName);
  if (!result.valid) {
    inputEl.classList.remove('valid');
    inputEl.classList.add('invalid');
  } else {
    inputEl.classList.remove('invalid');
    inputEl.classList.add('valid');
  }
}

function handleAthleteDOBBlur(inputEl) {
  const val = inputEl.value;
  if (!val) {
    inputEl.classList.remove('valid');
    inputEl.classList.add('invalid');
    showToast('✗ SPORCU DOĞUM TARİHİ BOŞ BIRAKILAMAZ', 'warning');
    return;
  }
  const categorySelect = document.getElementById('categorySelect');
  const selectedOpt = categorySelect.options[categorySelect.selectedIndex];
  const catName = selectedOpt ? selectedOpt.getAttribute('data-name') || selectedOpt.textContent : '';
  const result = validateDOBRange(val, catName);
  if (!result.valid) {
    showToast(`✗ ${result.message}`, 'error');
  } else if (result.warning) {
    showToast(`⚠ ${result.warning}`, 'warning');
  }
}

function getSelectedSchool() {
  const schoolSelect = document.getElementById('schoolSelect');
  return schoolSelect.value || '';
}

// ─── Collect Form Data ───
function collectFormData() {
  const competitionId = document.getElementById('competitionSelect').value;
  const competition = competitionsCache[competitionId];
  const categorySelect = document.getElementById('categorySelect');
  const selectedOpt = categorySelect.options[categorySelect.selectedIndex];
  const categoryName = selectedOpt ? selectedOpt.getAttribute('data-name') || selectedOpt.textContent : '';

  const coaches = [];
  document.getElementById('coachRows').querySelectorAll('.dynamic-row').forEach(row => {
    const name = sanitize(row.querySelector('[data-field="name"]')?.value || '');
    const phone = sanitize(row.querySelector('[data-field="phone"]')?.value || '');
    const email = sanitize(row.querySelector('[data-field="email"]')?.value || '');
    if (name) coaches.push({ name, phone, email });
  });

  const teachers = [];
  document.getElementById('teacherRows').querySelectorAll('.dynamic-row').forEach(row => {
    const name = sanitize(row.querySelector('[data-field="name"]')?.value || '');
    const phone = sanitize(row.querySelector('[data-field="phone"]')?.value || '');
    const email = sanitize(row.querySelector('[data-field="email"]')?.value || '');
    if (name) teachers.push({ name, phone, email });
  });

  const athletes = [];
  document.getElementById('athleteRows').querySelectorAll('.dynamic-row').forEach(row => {
    const tckn = sanitize(row.querySelector('[data-field="tckn"]')?.value || '');
    const name = sanitize(row.querySelector('[data-field="name"]')?.value || '');
    const dob = sanitize(row.querySelector('[data-field="dob"]')?.value || '');
    const license = sanitize(row.querySelector('[data-field="license"]')?.value || '');
    const gender = sanitize(row.querySelector('[data-field="gender"]')?.value || '');
    if (tckn || name) athletes.push({ tckn, name, dob, license, gender });
  });

  return {
    competitionId,
    yarismaAdi: competition ? (competition.isim || competition.ad || competition.name || '').toLocaleUpperCase('tr-TR') : '',
    brans: sanitize(document.getElementById('branchSelect').value).toLocaleUpperCase('tr-TR'),
    il: sanitize(document.getElementById('citySelect').value).toLocaleUpperCase('tr-TR'),
    ilce: sanitize(document.getElementById('districtSelect').value).toLocaleUpperCase('tr-TR'),
    okul: sanitize(getSelectedSchool()).toLocaleUpperCase('tr-TR'),
    kategoriId: categorySelect.value,
    kategoriAdi: categoryName.toLocaleUpperCase('tr-TR'),
    katilimTuru: participationType,
    antrenorler: coaches.map(c => ({ ...c, name: c.name.toLocaleUpperCase('tr-TR') })),
    ogretmenler: teachers.map(t => ({ ...t, name: t.name.toLocaleUpperCase('tr-TR') })),
    sporcular: athletes.map(a => ({ ...a, name: a.name.toLocaleUpperCase('tr-TR') })),
    durum: 'bekliyor',
    olusturmaTarihi: new Date().toISOString(),
    kvkkOnay: true
  };
}

// ─── Validation ───
function validateForm(data) {
  const errors = [];

  if (!data.competitionId) errors.push('✗ YARIŞMA SEÇİNİZ');
  if (!data.brans) errors.push('✗ BRANŞ SEÇİNİZ');

  // Branş - yarışma uyumu kontrolü
  if (data.competitionId && data.brans) {
    const comp = competitionsCache[data.competitionId];
    if (comp) {
      const compBrans = inferCompetitionBranch(comp);
      const selectedBrans = data.brans.toLocaleUpperCase('tr-TR');
      if (compBrans !== selectedBrans) {
        errors.push(`✗ SEÇİLEN YARIŞMA "${compBrans}" BRANŞINA AİT. LÜTFEN BRANŞ VEYA YARIŞMA SEÇİMİNİZİ DEĞİŞTİRİN.`);
      }
    }
  }
  if (!data.il) errors.push('✗ İL SEÇİNİZ');
  else if (data.il.length > 100) errors.push('✗ İL ADI ÇOK UZUN');
  if (!data.ilce) errors.push('✗ İLÇE SEÇİNİZ');
  else if (data.ilce.length > 100) errors.push('✗ İLÇE ADI ÇOK UZUN');
  if (!data.okul) errors.push('✗ OKUL BİLGİSİ GİRİNİZ');
  else if (data.okul.length > 200) errors.push('✗ OKUL ADI ÇOK UZUN (MAX 200 KARAKTER)');
  if (!data.kategoriId && data.kategoriId !== 0) errors.push('✗ KATEGORİ SEÇİNİZ');

  // En az bir antrenör VEYA bir öğretmen olmalı
  if (data.antrenorler.length === 0 && data.ogretmenler.length === 0) {
    errors.push('✗ EN AZ BİR ANTRENÖR VEYA ÖĞRETMEN EKLEYİNİZ');
  }
  if (data.antrenorler.length > 10) errors.push('✗ EN FAZLA 10 ANTRENÖR EKLENEBİLİR');
  if (data.ogretmenler.length > 10) errors.push('✗ EN FAZLA 10 ÖĞRETMEN EKLENEBİLİR');
  data.antrenorler.forEach((c, i) => {
    if (!c.name) errors.push(`✗ ${i + 1}. ANTRENÖR ADI BOŞ`);
    else if (c.name.length > 100) errors.push(`✗ ${i + 1}. ANTRENÖR ADI ÇOK UZUN`);
    if (c.phone && !validatePhone(c.phone)) errors.push(`✗ ${i + 1}. ANTRENÖR TELEFON FORMATI HATALI`);
    if (c.phone && c.phone.length > 20) errors.push(`✗ ${i + 1}. ANTRENÖR TELEFON ÇOK UZUN`);
    if (c.email && !validateEmail(c.email)) errors.push(`✗ ${i + 1}. ANTRENÖR E-POSTA FORMATI HATALI`);
    if (c.email && c.email.length > 150) errors.push(`✗ ${i + 1}. ANTRENÖR E-POSTA ÇOK UZUN`);
  });
  data.ogretmenler.forEach((t, i) => {
    if (!t.name) errors.push(`✗ ${i + 1}. ÖĞRETMEN ADI BOŞ`);
    else if (t.name.length > 100) errors.push(`✗ ${i + 1}. ÖĞRETMEN ADI ÇOK UZUN`);
    if (t.phone && !validatePhone(t.phone)) errors.push(`✗ ${i + 1}. ÖĞRETMEN TELEFON FORMATI HATALI`);
    if (t.email && !validateEmail(t.email)) errors.push(`✗ ${i + 1}. ÖĞRETMEN E-POSTA FORMATI HATALI`);
  });

  if (data.sporcular.length === 0) errors.push('✗ EN AZ BİR SPORCU EKLEYİNİZ');
  if (data.sporcular.length > 20) errors.push('✗ TEK BAŞVURUDA EN FAZLA 20 SPORCU EKLENEBİLİR');

  const tcknSet = new Set();
  const athleteRows = document.querySelectorAll('#athleteRows .dynamic-row');
  data.sporcular.forEach((a, i) => {
    const row = athleteRows[i];
    const tcknInput = row ? row.querySelector('[data-field="tckn"]') : null;
    const nameInput = row ? row.querySelector('[data-field="name"]') : null;
    const dobInput = row ? row.querySelector('[data-field="dob"]') : null;

    if (!a.tckn) {
      errors.push(`✗ ${i + 1}. SPORCU T.C. KİMLİK NO BOŞ`);
      if (tcknInput) { tcknInput.classList.remove('valid'); tcknInput.classList.add('invalid'); }
      return;
    }
    if (!validateTCKN(a.tckn)) {
      errors.push(`✗ ${i + 1}. SPORCU T.C. KİMLİK NO GEÇERSİZ (11 HANELİ RAKAM + ALGORİTMA HATASI)`);
      if (tcknInput) { tcknInput.classList.remove('valid'); tcknInput.classList.add('invalid'); }
    }
    if (tcknSet.has(a.tckn)) {
      errors.push(`✗ ${i + 1}. SPORCU T.C. KİMLİK NO AYNI FORMDA TEKRAR EDİYOR`);
      if (tcknInput) { tcknInput.classList.remove('valid'); tcknInput.classList.add('invalid'); }
    }
    tcknSet.add(a.tckn);
    if (!a.name) {
      errors.push(`✗ ${i + 1}. SPORCU ADI BOŞ`);
      if (nameInput) { nameInput.classList.remove('valid'); nameInput.classList.add('invalid'); }
    } else if (a.name.length > 100) {
      errors.push(`✗ ${i + 1}. SPORCU ADI ÇOK UZUN (MAX 100 KARAKTER)`);
      if (nameInput) { nameInput.classList.remove('valid'); nameInput.classList.add('invalid'); }
    }
    if (!a.dob) {
      errors.push(`✗ ${i + 1}. SPORCU DOĞUM TARİHİ BOŞ`);
      if (dobInput) { dobInput.classList.remove('valid'); dobInput.classList.add('invalid'); }
    } else {
      const dobResult = validateDOBRange(a.dob, data.kategoriAdi);
      if (!dobResult.valid) {
        errors.push(`✗ ${i + 1}. SPORCU ${dobResult.message}`);
        if (dobInput) { dobInput.classList.remove('valid'); dobInput.classList.add('invalid'); }
      } else if (dobResult.warning) {
        // Uyarı — hata değil, popup ile bilgilendirme
        showModal({ title: 'YAŞ UYARISI', message: `${i + 1}. Sporcu: ${dobResult.warning}`, type: 'warning' });
      }
      // Kategori yapılandırması dobRules varsa sıkı yıl/ay doğrulaması yap
      if (categoryConfig?.dobRules && categoryConfig.dobRules.length > 0) {
        const rulesResult = validateDOBAgainstRules(a.dob, categoryConfig.dobRules);
        if (!rulesResult.valid) {
          errors.push(`✗ ${i + 1}. SPORCU ${rulesResult.message}`);
          if (dobInput) { dobInput.classList.remove('valid'); dobInput.classList.add('invalid'); }
        }
      }
    }
    // Cinsiyet doğrulaması
    if (!a.gender) {
      errors.push(`✗ ${i + 1}. SPORCU CİNSİYETİ SEÇİNİZ`);
    } else if (categoryConfig?.cinsiyet && categoryConfig.cinsiyet !== 'karma') {
      const expectedGender = categoryConfig.cinsiyet === 'kiz' ? 'Kız' : 'Erkek';
      if (a.gender !== expectedGender) {
        errors.push(`✗ ${i + 1}. SPORCU CİNSİYETİ BU KATEGORİ İÇİN UYGUN DEĞİL (BEKLENEN: ${expectedGender.toLocaleUpperCase('tr-TR')})`);
      }
    }
    if (a.license && !validateLicenseNo(a.license)) {
      errors.push(`✗ ${i + 1}. SPORCU LİSANS NO FORMATI GEÇERSİZ (MAX 50 KARAKTER, ÖZEL KARAKTER YOK)`);
    }
  });

  // Kontenjan kontrolü — mevcut kayıtlılar dahil
  const totalAfterSubmit = existingAthleteCount + data.sporcular.length;
  if (totalAfterSubmit > categoryLimits.max) {
    errors.push(`✗ KONTENJAN AŞILIYOR! MEVCUT KAYITLI: ${existingAthleteCount} + YENİ: ${data.sporcular.length} = ${totalAfterSubmit} (MAX: ${categoryLimits.max}). EN FAZLA ${remainingQuota} SPORCU EKLENEBİLİR.`);
  }

  if (data.katilimTuru === 'Takım') {
    const totalForTeam = existingAthleteCount + data.sporcular.length;
    if (totalForTeam < categoryLimits.min) {
      errors.push(`✗ TAKIM İÇİN EN AZ ${categoryLimits.min} SPORCU GEREKLİ (KAYITLI: ${existingAthleteCount} + YENİ: ${data.sporcular.length} = ${totalForTeam})`);
    }
  }

  if (!document.getElementById('kvkkCheckbox').checked) errors.push('✗ KVKK ONAYI GEREKLİDİR');

  return errors;
}

// ─── Submit ───
async function handleSubmit(e) {
  e.preventDefault();

  if (submitCooldown) {
    showModal({ title: 'LÜTFEN BEKLEYİNİZ', message: 'Birkaç saniye bekleyip tekrar deneyiniz.', type: 'warning' });
    return;
  }
  // Rate limiting kontrolü
  if (!checkSubmitRateLimit()) return;

  // Başvuru kapanma kontrolü (submit anında tekrar kontrol)
  const selCompId = document.getElementById('competitionSelect').value;
  if (selCompId && competitionsCache[selCompId]) {
    const compData = competitionsCache[selCompId];
    // Admin manuel kapatma kontrolü
    if (compData.basvuruKapaliMi === true) {
      showModal({ title: 'BAŞVURU KAPANDI', message: 'Bu yarışma için başvurular admin tarafından kapatılmıştır.', type: 'error' });
      return;
    }
    const baslangic = compData.baslangicTarihi || compData.tarih;
    if (baslangic) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const startDate = new Date(baslangic);
      startDate.setHours(0, 0, 0, 0);
      const kapanmaGunu = compData.basvuruKapanmaGunu != null ? Number(compData.basvuruKapanmaGunu) : 2;
      const deadlineDate = new Date(startDate);
      deadlineDate.setDate(deadlineDate.getDate() - kapanmaGunu);
      if (now >= deadlineDate) {
        showModal({ title: 'BAŞVURU KAPANDI', message: 'Bu yarışma için başvuru süresi sona ermiştir.', type: 'error' });
        return;
      }
    }
  }

  const submitBtn = document.getElementById('submitBtn');
  const data = collectFormData();

  const errors = validateForm(data);
  if (errors.length > 0) {
    showModal({
      title: 'FORM HATALARI',
      type: 'error',
      html: '<ul style="text-align:left;padding-left:1rem;margin:0">' + errors.map(e => `<li style="margin-bottom:.35rem;font-size:.82rem">${escapeHtml(e)}</li>`).join('') + '</ul>'
    });
    return;
  }

  let hasInvalidCoach = false;
  data.antrenorler.forEach(c => {
    const result = verifyCoach(c.name);
    if (result === false) {
      hasInvalidCoach = true;
    }
  });

  submitBtn.classList.add('loading');
  submitBtn.disabled = true;
  submitCooldown = true;

  try {
    // Mükerrer kontrol
    const tcknList = data.sporcular.map(a => a.tckn);
    const duplicates = await checkDuplicateTCKNs(data.competitionId, tcknList);
    if (duplicates.length > 0) {
      const athleteRows = document.querySelectorAll('#athleteRows .dynamic-row');
      duplicates.forEach(d => {
        athleteRows.forEach(row => {
          const tcknInput = row.querySelector('[data-field="tckn"]');
          if (tcknInput && (tcknInput.value || '').trim() === d.tckn) {
            tcknInput.classList.remove('valid');
            tcknInput.classList.add('invalid');
          }
        });
      });
      const dupListHTML = buildAthleteListHTML(duplicates.map(d => ({ name: d.name, school: d.school, status: d.status })));
      showModal({
        title: 'MÜKERRER SPORCU TESPİT EDİLDİ',
        type: 'error',
        html: '<p style="margin-bottom:.5rem">Aşağıdaki sporcular bu yarışmada zaten kayıtlı:</p>' + dupListHTML
      });
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
      setTimeout(() => { submitCooldown = false; }, 5000);
      return;
    }

    // Son dakika kontenjan kontrolü
    const quota = await checkSchoolQuota(data.competitionId, data.kategoriId, data.okul, data.il, data.ilce, data.sporcular.length);
    if (quota.exceeded) {
      const kalanGercek = Math.max(0, categoryLimits.max - quota.existing);
      const existingAthletes = await getExistingAthletes(data.competitionId, data.kategoriId);
      const listHTML = buildAthleteListHTML(existingAthletes);
      showModal({
        title: 'KONTENJAN AŞILDI',
        type: 'error',
        html:
          `<p style="margin-bottom:.75rem">Bu okul ve kategori için kontenjan dolmuştur.</p>` +
          `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:.75rem;margin-bottom:.75rem;font-size:.82rem;text-align:left">` +
          `<strong>Mevcut kayıtlı:</strong> ${quota.existing} sporcu<br>` +
          `<strong>Kategori limiti:</strong> ${categoryLimits.max}<br>` +
          `<strong>Eklenebilecek:</strong> ${kalanGercek}<br>` +
          `<strong>Başvurunuz:</strong> ${data.sporcular.length} sporcu</div>` +
          (existingAthletes.length > 0 ? '<p style="font-weight:700;margin-bottom:.35rem;font-size:.82rem">Mevcut kayıtlı sporcular:</p>' + listHTML : '')
      });
      existingAthleteCount = quota.existing;
      remainingQuota = kalanGercek;
      updateQuotaInfoBox();
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
      setTimeout(() => { submitCooldown = false; }, 5000);
      return;
    }

    // Mevcut sporcuları göster ve onay al
    const existingAthletes = await getExistingAthletes(data.competitionId, data.kategoriId);
    const coachWarning = hasInvalidCoach ? '<p style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:.5rem;font-size:.8rem;margin-bottom:.75rem">⚠ Kayıtsız antrenör tespit edildi — başvuru yine de gönderilebilir.</p>' : '';

    const confirmHTML =
      coachWarning +
      `<p style="margin-bottom:.5rem;font-size:.85rem"><strong>${escapeHtml(data.okul)}</strong> okulundan <strong>${data.sporcular.length}</strong> sporcu başvurusu gönderilecek.</p>` +
      `<p style="margin-bottom:.5rem;font-size:.82rem;color:#64748b">Kategori: <strong>${escapeHtml(data.kategoriAdi)}</strong></p>` +
      (existingAthletes.length > 0
        ? '<p style="font-weight:700;margin-bottom:.35rem;font-size:.82rem;margin-top:.75rem">Bu kategoride daha önce başvuru yapılmış sporcular:</p>' + buildAthleteListHTML(existingAthletes)
        : '<p style="color:#059669;font-size:.82rem;margin-top:.5rem">Bu kategoride daha önce başvuru yapılmış sporcu bulunmamaktadır.</p>');

    showModal({
      title: 'BAŞVURU ONAYI',
      type: 'info',
      html: confirmHTML,
      buttons: [
        { label: 'VAZGEÇ', primary: false, action: () => {
          submitBtn.classList.remove('loading');
          submitBtn.disabled = false;
          submitCooldown = false;
        }},
        { label: 'BAŞVURUYU GÖNDER', primary: true, action: async () => {
          submitBtn.classList.add('loading');
          submitBtn.disabled = true;
          try {
            await push(ref(db, 'applications'), data);
            showModal({
              title: 'BAŞVURU BAŞARILI',
              type: 'success',
              html: '<p style="font-size:.9rem">Başvurunuz başarıyla gönderildi. Onay sürecinden sonra sporcularınız yarışmaya eklenecektir.</p>'
            });

            document.getElementById('applicationForm').reset();
            document.getElementById('coachRows').innerHTML = '';
            document.getElementById('teacherRows').innerHTML = '';
            document.getElementById('athleteRows').innerHTML = '';
            document.getElementById('schoolSelect').style.display = 'none';
            document.getElementById('schoolFilter').style.display = 'none';
            document.getElementById('schoolSelect').innerHTML = '<option value="">ÖNCE İLÇE SEÇİNİZ</option>';
            document.getElementById('participationType').value = 'Ferdi';
            participationType = 'Ferdi';
            document.getElementById('btnFerdi').classList.add('active');
            document.getElementById('btnTakim').classList.remove('active');
            document.getElementById('teamWarning').classList.remove('show');
            document.getElementById('categorySelect').innerHTML = '<option value="">ÖNCE YARIŞMA SEÇİNİZ</option>';
            document.getElementById('districtSelect').innerHTML = '<option value="">ÖNCE İL SEÇİNİZ</option>';
            document.getElementById('competitionSelect').innerHTML = '<option value="">ÖNCE İL SEÇİNİZ</option>';
            updateStepIndicators();
            addCoachRow();
            addTeacherRow();
          } catch (err) {
            console.error('Gönderme hatası:', err);
            showModal({ title: 'HATA', message: 'Başvuru gönderilirken bir hata oluştu. Lütfen tekrar deneyiniz.', type: 'error' });
          } finally {
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;
            setTimeout(() => { submitCooldown = false; }, 5000);
          }
        }}
      ]
    });

  } catch (err) {
    console.error('Gönderme hatası:', err);
    showModal({ title: 'HATA', message: 'Başvuru gönderilirken bir hata oluştu. Lütfen tekrar deneyiniz.', type: 'error' });
    submitBtn.classList.remove('loading');
    submitBtn.disabled = false;
    setTimeout(() => { submitCooldown = false; }, 5000);
  }
}

// ─── Event Listeners ───
function initEventListeners() {
  document.getElementById('competitionSelect').addEventListener('change', function() {
    const id = this.value;
    selectedCompetition = competitionsCache[id] || null;
    populateCategories(id);
    updateStepIndicators();
  });

  document.getElementById('categorySelect').addEventListener('change', function() {
    const opt = this.options[this.selectedIndex];
    const catName = opt ? opt.getAttribute('data-name') || opt.textContent : '';
    const catId = this.value || '';
    categoryLimits = getCategoryLimits(catName, catId);
    remainingQuota = categoryLimits.max;
    updateTeamWarning();
    updateStepIndicators();
    fetchExistingAthleteCount(); // Kontenjan sorgula
    // Kategori yapılandırması yükle (yaş kuralları + okul türü filtresi)
    const branch = document.getElementById('branchSelect')?.value || 'Artistik';
    loadCategoryConfig(branch, catId);
  });

  document.getElementById('citySelect').addEventListener('change', function() {
    populateDistricts(this.value);
    updateActiveBranches();
    filterCompetitions();
    loadSchoolsForDistrict();
    updateStepIndicators();
  });

  document.getElementById('districtSelect').addEventListener('change', function() {
    loadSchoolsForDistrict();
    updateStepIndicators();
  });

  document.getElementById('branchSelect').addEventListener('change', function() {
    filterCompetitions();
    updateStepIndicators();
  });

  document.getElementById('schoolFilter').addEventListener('input', function() {
    renderSchoolSelect(this.value);
  });

  document.getElementById('schoolSelect').addEventListener('change', function() {
    updateStepIndicators();
    fetchExistingAthleteCount(); // Okul değişince kontenjan sorgula
  });

  document.getElementById('btnFerdi').addEventListener('click', function() {
    participationType = 'Ferdi';
    document.getElementById('participationType').value = 'Ferdi';
    this.classList.add('active');
    document.getElementById('btnTakim').classList.remove('active');
    updateTeamWarning();
  });

  document.getElementById('btnTakim').addEventListener('click', function() {
    participationType = 'Takım';
    document.getElementById('participationType').value = 'Takım';
    this.classList.add('active');
    document.getElementById('btnFerdi').classList.remove('active');
    updateTeamWarning();
  });

  document.getElementById('addCoachBtn').addEventListener('click', addCoachRow);
  document.getElementById('addTeacherBtn').addEventListener('click', addTeacherRow);
  document.getElementById('addAthleteBtn').addEventListener('click', addAthleteRow);

  document.getElementById('kvkkCheckbox').addEventListener('change', function() {
    document.getElementById('submitBtn').disabled = !this.checked;
    updateStepIndicators();
  });

  document.getElementById('applicationForm').addEventListener('submit', handleSubmit);

  // Modal kapatma — overlay tıklama
  document.getElementById('errorModal').addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('show');
  });

  document.getElementById('errorModal').addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('show');
  });

  document.getElementById('applicationForm').addEventListener('input', updateStepIndicators);
  document.getElementById('applicationForm').addEventListener('change', updateStepIndicators);

  // ── Başvuru Durumu Sorgula ──
  document.getElementById('openStatusQueryBtn').addEventListener('click', () => {
    document.getElementById('queryTcknInput').value = '';
    document.getElementById('queryResults').innerHTML = '';
    document.getElementById('statusQueryModal').classList.add('show');
    // Aktif sekme TC ise inputa focusla
    if (document.getElementById('tabTckn').classList.contains('active')) {
      document.getElementById('queryTcknInput').focus();
    }
    // İl select'i doldur (turkeyData yüklenmiş olmalı)
    populateQueryCities();
  });

  document.getElementById('closeStatusQueryBtn').addEventListener('click', () => {
    document.getElementById('statusQueryModal').classList.remove('show');
  });

  document.getElementById('statusQueryModal').addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('show');
  });

  // Sekme geçiş
  document.getElementById('tabTckn').addEventListener('click', () => {
    document.getElementById('tabTckn').classList.add('active');
    document.getElementById('tabSchool').classList.remove('active');
    document.getElementById('queryPanelTckn').style.display = '';
    document.getElementById('queryPanelSchool').style.display = 'none';
    document.getElementById('queryResults').innerHTML = '';
    document.getElementById('queryTcknInput').focus();
  });

  document.getElementById('tabSchool').addEventListener('click', () => {
    document.getElementById('tabSchool').classList.add('active');
    document.getElementById('tabTckn').classList.remove('active');
    document.getElementById('queryPanelSchool').style.display = '';
    document.getElementById('queryPanelTckn').style.display = 'none';
    document.getElementById('queryResults').innerHTML = '';
    populateQueryCities();
  });

  document.getElementById('queryStatusBtn').addEventListener('click', handleStatusQuery);

  document.getElementById('queryTcknInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') handleStatusQuery();
  });

  // Okul sorgu — il/ilçe bağımlı select'ler
  document.getElementById('queryIlSelect').addEventListener('change', function() {
    populateQueryDistricts(this.value);
    document.getElementById('queryOkulSelect').innerHTML = '<option value="">OKUL SEÇİNİZ</option>';
    document.getElementById('queryResults').innerHTML = '';
  });

  document.getElementById('queryIlceSelect').addEventListener('change', function() {
    populateQuerySchools(
      document.getElementById('queryIlSelect').value,
      this.value
    );
    document.getElementById('queryResults').innerHTML = '';
  });

  document.getElementById('querySchoolBtn').addEventListener('click', handleSchoolQuery);
}

// ─── Sorgu modal: il/ilçe/okul select populators ───
function populateQueryCities() {
  const sel = document.getElementById('queryIlSelect');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">İL SEÇİNİZ</option>';
  Object.keys(turkeyData).sort((a, b) => a.localeCompare(b, 'tr')).forEach(city => {
    const opt = document.createElement('option');
    opt.value = city;
    opt.textContent = city;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

function populateQueryDistricts(city) {
  const sel = document.getElementById('queryIlceSelect');
  sel.innerHTML = '<option value="">İLÇE SEÇİNİZ</option>';
  if (turkeyData[city]) {
    turkeyData[city].sort((a, b) => a.localeCompare(b, 'tr')).forEach(district => {
      const opt = document.createElement('option');
      opt.value = district;
      opt.textContent = district;
      sel.appendChild(opt);
    });
  }
}

function populateQuerySchools(city, district) {
  const sel = document.getElementById('queryOkulSelect');
  sel.innerHTML = '<option value="">OKUL SEÇİNİZ</option>';
  if (!city || !district) return;
  const cityKey = findSchoolKey(schoolsData, city);
  if (!cityKey) return;
  const districtKey = findSchoolKey(schoolsData[cityKey], district);
  if (!districtKey) return;
  const schools = schoolsData[cityKey][districtKey] || [];
  schools.sort((a, b) => a.localeCompare(b, 'tr')).forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    sel.appendChild(opt);
  });
  // Ek seçenek: listede olmayan okul
  const other = document.createElement('option');
  other.value = '__OTHER__';
  other.textContent = 'Listede Yok — Manuel Gir';
  sel.appendChild(other);
}

// ─── Ortak sonuç render ───
function renderQueryResults(resultsEl, matches, emptyMsg) {
  if (matches.length === 0) {
    resultsEl.innerHTML = `<div class="query-empty"><span class="material-icons-round">search_off</span>${emptyMsg}</div>`;
    return;
  }

  const durumLabel = { bekliyor: 'ONAY BEKLİYOR', onaylandi: 'ONAYLANDI', reddedildi: 'REDDEDİLDİ' };
  const durumIcon  = { bekliyor: 'schedule', onaylandi: 'check_circle', reddedildi: 'cancel' };

  const countHtml = `<div class="query-count"><span class="material-icons-round" style="font-size:.8rem;vertical-align:middle">info_outline</span> ${matches.length} kayıt bulundu — bilgiler gizlilik amacıyla maskelenmiştir</div>`;

  const itemsHtml = matches.map(m => `
    <div class="query-result-item">
      <div class="qr-athlete">
        <span class="material-icons-round" style="font-size:.85rem">person</span>
        ${escapeHtml(maskName(m.athleteName))}
        ${m.tckn && m.tckn !== '—' ? `<span class="qr-masked">${escapeHtml(maskTCKN(m.tckn))}</span>` : ''}
      </div>
      <div class="qr-comp">${escapeHtml(m.yarismaAdi)}</div>
      <div class="qr-meta">${escapeHtml(m.brans)} · ${escapeHtml(m.kategoriAdi)} · ${escapeHtml(maskSchool(m.okul))} · ${escapeHtml(m.il)} · ${escapeHtml(m.tarih)}</div>
      <span class="qr-status ${escapeHtml(m.durum)}">
        <span class="material-icons-round" style="font-size:.85rem">${durumIcon[m.durum] || 'help'}</span>
        ${durumLabel[m.durum] || escapeHtml(m.durum.toLocaleUpperCase('tr-TR'))}
      </span>
    </div>
  `).join('');

  resultsEl.innerHTML = countHtml + itemsHtml;
}

// ─── TC Kimlik No ile sorgula ───
async function handleStatusQuery() {
  const tckn = (document.getElementById('queryTcknInput').value || '').trim();
  const resultsEl = document.getElementById('queryResults');
  const btn = document.getElementById('queryStatusBtn');

  if (!/^\d{11}$/.test(tckn)) {
    resultsEl.innerHTML = '<div class="query-empty"><span class="material-icons-round">error_outline</span>Lütfen geçerli bir 11 haneli T.C. Kimlik No giriniz.</div>';
    return;
  }

  btn.disabled = true;
  resultsEl.innerHTML = '<div class="query-empty"><span class="material-icons-round" style="animation:spin 1s linear infinite;display:block;margin-bottom:.5rem">refresh</span>Sorgulanıyor...</div>';

  try {
    const snap = await get(ref(db, 'applications'));
    const data = snap.val();
    const matches = [];

    // 1) applications/ altında ara
    if (data) {
      Object.values(data).forEach(app => {
        const compId = app.competitionId || app.compId || '';
        if (!isCompetitionVisibleInQuery(compId)) return;
        if (!app.sporcular) return;
        const sporcularArr = Array.isArray(app.sporcular) ? app.sporcular : Object.values(app.sporcular);
        const athlete = sporcularArr.find(sp => sp && sp.tckn === tckn);
        if (!athlete) return;
        const compData = competitionsCache[compId] || null;
        matches.push({
          athleteName: athlete.name || '—',
          tckn: athlete.tckn || '—',
          yarismaAdi: (compData?.isim || compData?.ad || app.yarismaAdi || compId || '—'),
          okul: app.okul || app.schoolName || '—',
          il: compData?.il || app.il || '—',
          kategoriAdi: app.kategoriAdi || '—',
          brans: app.brans || inferCompetitionBranch(compData || {}) || '—',
          durum: app.durum || app.status || 'bekliyor',
          tarih: app.olusturmaTarihi ? new Date(app.olusturmaTarihi).toLocaleDateString('tr-TR') : '—',
        });
      });
    }

    // 2) Onaylı sporcular (eski/silinmiş başvurular için)
    if (matches.length === 0) {
      for (const path of PUBLIC_COMPETITION_SOURCE_PATHS) {
        const compSnap = await get(ref(db, path));
        const comps = compSnap.val();
        if (!comps) continue;
        for (const [compId, compData] of Object.entries(comps)) {
          if (compData.durum === 'pasif' || !isCompetitionOpen(compData)) continue;
          if (!compData.sporcular) continue;
          for (const [catId, catData] of Object.entries(compData.sporcular)) {
            if (!catData || typeof catData !== 'object') continue;
            for (const ath of Object.values(catData)) {
              if (!ath || ath.tckn !== tckn) continue;
              matches.push({
                athleteName: ath.ad ? `${ath.ad} ${ath.soyad || ''}`.trim() : '—',
                tckn: ath.tckn || '—',
                yarismaAdi: compData.isim || compData.ad || compId || '—',
                okul: ath.okul || ath.kulup || '—',
                il: compData.il || '—',
                kategoriAdi: catId,
                brans: inferCompetitionBranch({ ...compData, _firebasePath: path }),
                durum: 'onaylandi',
                tarih: '—',
              });
            }
          }
        }
      }
    }

    renderQueryResults(resultsEl, matches, 'Bu T.C. Kimlik No ile kayıtlı başvuru bulunamadı.');
  } catch (err) {
    console.error('Başvuru sorgulama hatası:', err);
    resultsEl.innerHTML = '<div class="query-empty"><span class="material-icons-round">error</span>Sorgulama sırasında bir hata oluştu. Lütfen tekrar deneyin.</div>';
  } finally {
    btn.disabled = false;
  }
}

// ─── İl / İlçe / Okul ile sorgula ───
async function handleSchoolQuery() {
  const il = (document.getElementById('queryIlSelect').value || '').trim();
  const ilce = (document.getElementById('queryIlceSelect').value || '').trim();
  const okulRaw = (document.getElementById('queryOkulSelect').value || '').trim();
  const resultsEl = document.getElementById('queryResults');
  const btn = document.getElementById('querySchoolBtn');

  if (!il || !ilce || !okulRaw || okulRaw === '__OTHER__') {
    resultsEl.innerHTML = '<div class="query-empty"><span class="material-icons-round">info_outline</span>Lütfen il, ilçe ve okul seçimlerini tamamlayınız.</div>';
    return;
  }

  const targetIl = il.toLocaleUpperCase('tr-TR');
  const targetIlce = ilce.toLocaleUpperCase('tr-TR');
  const targetOkul = okulRaw.toLocaleUpperCase('tr-TR');

  btn.disabled = true;
  resultsEl.innerHTML = '<div class="query-empty"><span class="material-icons-round" style="animation:spin 1s linear infinite;display:block;margin-bottom:.5rem">refresh</span>Sorgulanıyor...</div>';

  try {
    const matches = [];

    // 1) Başvurular içinde ara
    const snap = await get(ref(db, 'applications'));
    const data = snap.val();
    if (data) {
      Object.values(data).forEach(app => {
        const compId = app.competitionId || app.compId || '';
        if (!isCompetitionVisibleInQuery(compId)) return;
        if (!app.sporcular) return;
        const appIl = (app.il || '').toLocaleUpperCase('tr-TR');
        const appIlce = (app.ilce || '').toLocaleUpperCase('tr-TR');
        const appOkul = (app.okul || '').toLocaleUpperCase('tr-TR');
        if (appIl !== targetIl || appIlce !== targetIlce || appOkul !== targetOkul) return;

        const sporcularArr = Array.isArray(app.sporcular) ? app.sporcular : Object.values(app.sporcular);
        const compData = competitionsCache[compId] || null;
        sporcularArr.forEach(sp => {
          if (!sp) return;
          matches.push({
            athleteName: sp.name || '—',
            tckn: sp.tckn || '—',
            yarismaAdi: (compData?.isim || compData?.ad || app.yarismaAdi || compId || '—'),
            okul: app.okul || '—',
            il: compData?.il || app.il || '—',
            kategoriAdi: app.kategoriAdi || '—',
            brans: app.brans || inferCompetitionBranch(compData || {}) || '—',
            durum: app.durum || app.status || 'bekliyor',
            tarih: app.olusturmaTarihi ? new Date(app.olusturmaTarihi).toLocaleDateString('tr-TR') : '—',
          });
        });
      });
    }

    // 2) Onaylı sporcular içinde ara
    const seenTcknSet = new Set(matches.map(m => m.tckn));
    for (const path of PUBLIC_COMPETITION_SOURCE_PATHS) {
      const compSnap = await get(ref(db, path));
      const comps = compSnap.val();
      if (!comps) continue;
      for (const [compId, compData] of Object.entries(comps)) {
        if (compData.durum === 'pasif' || !isCompetitionOpen(compData)) continue;
        if (!compData.sporcular) continue;
        for (const [catId, catData] of Object.entries(compData.sporcular)) {
          if (!catData || typeof catData !== 'object') continue;
          for (const ath of Object.values(catData)) {
            if (!ath) continue;
            const athOkul = (ath.okul || ath.kulup || '').toLocaleUpperCase('tr-TR');
            const athIl = (ath.il || '').toLocaleUpperCase('tr-TR');
            if (athOkul !== targetOkul) continue;
            if (athIl && athIl !== targetIl) continue;
            if (ath.tckn && seenTcknSet.has(ath.tckn)) continue; // başvuruda zaten var
            seenTcknSet.add(ath.tckn);
            matches.push({
              athleteName: ath.ad ? `${ath.ad} ${ath.soyad || ''}`.trim() : '—',
              tckn: ath.tckn || '—',
              yarismaAdi: compData.isim || compData.ad || compId || '—',
              okul: ath.okul || ath.kulup || '—',
              il: compData.il || '—',
              kategoriAdi: catId,
              brans: inferCompetitionBranch({ ...compData, _firebasePath: path }),
              durum: 'onaylandi',
              tarih: '—',
            });
          }
        }
      }
    }

    renderQueryResults(resultsEl, matches, `"${okulRaw}" okulu için kayıtlı başvuru bulunamadı.`);
  } catch (err) {
    console.error('Okul sorgulama hatası:', err);
    resultsEl.innerHTML = '<div class="query-empty"><span class="material-icons-round">error</span>Sorgulama sırasında bir hata oluştu. Lütfen tekrar deneyin.</div>';
  } finally {
    btn.disabled = false;
  }
}

// ─── Türkiye Şampiyonası UI ───
function applyTurkiyeModeUI() {
  if (!isTurkiyeMode) return;

  // Başlık güncelle
  const h1 = document.querySelector('.header h1');
  const subp = document.querySelector('.header p');
  if (h1) h1.textContent = 'TÜRKİYE ŞAMPİYONASI';
  if (subp) subp.textContent = 'TÜRKIYE ŞAMPIYONASI BAŞVURU FORMU';

  // Logo arka plan rengi — altın
  const logo = document.querySelector('.header-logo');
  if (logo) {
    logo.style.background = 'linear-gradient(135deg,#b8860b,#ffd700)';
    logo.style.boxShadow = '0 4px 14px rgba(184,134,11,.4)';
  }

  // Altın banner ekle
  const banner = document.createElement('div');
  banner.id = 'turkiyeBanner';
  banner.innerHTML = `
    <span class="material-icons-round" style="font-size:1.2rem;flex-shrink:0">emoji_events</span>
    <div>
      <strong>TÜRKİYE ŞAMPİYONASI ÖZEL BAŞVURU SAYFASI</strong><br>
      <span style="font-size:.8rem;font-weight:500">Bu sayfaya tüm illerden başvuru yapılabilir. İl seçimi adres bilgisi içindir, yarışma filtrelemesi yapmaz.</span>
    </div>`;
  banner.style.cssText = 'display:flex;align-items:flex-start;gap:.75rem;padding:.9rem 1.1rem;border-radius:12px;background:linear-gradient(135deg,#78350f,#92400e);color:#fef3c7;font-size:.85rem;font-weight:700;margin-bottom:1.5rem;text-transform:uppercase;border:1.5px solid #d97706;line-height:1.5;box-shadow:0 4px 12px rgba(120,53,15,.25)';

  const stepsEl = document.querySelector('.steps');
  if (stepsEl) stepsEl.after(banner);

  // İl seçim etiketi: "İL (ADRES)" yap ve ipucu ekle
  const cityLabel = document.querySelector('label[for="citySelect"], #citySelect')?.closest('.form-group')?.querySelector('label');
  // querySelector ile label'ı bul
  const cityFormGroup = document.getElementById('citySelect')?.closest('.form-group');
  if (cityFormGroup) {
    const lbl = cityFormGroup.querySelector('label');
    if (lbl) lbl.innerHTML = 'İL (ADRES) <span class="req">*</span>';
    // Varsa hint ekle
    let hint = cityFormGroup.querySelector('.hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'hint';
      cityFormGroup.appendChild(hint);
    }
    hint.textContent = 'Tüm iller başvuru yapabilir. İl seçimi sadece adres amaçlıdır.';
  }

  // Yarışma select ilk placeholder'ı güncelle (henüz yüklenmemişse)
  const compSel = document.getElementById('competitionSelect');
  if (compSel && compSel.options[0]) {
    compSel.options[0].textContent = 'YÜKLENİYOR...';
  }
}

// ─── Init ───
async function init() {
  applyTurkiyeModeUI();
  initEventListeners();

  await Promise.all([
    loadTurkeyData(),
    loadSchools(),
    loadCoaches(),
    loadCompetitions()
  ]);

  // Yarışmalar yüklendikten sonra aktif branşları güncelle (global)
  updateActiveBranches();
  filterCompetitions();

  addCoachRow();
  addTeacherRow();

  updateStepIndicators();
}

init();
