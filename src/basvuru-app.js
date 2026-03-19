// ─── Firebase Init (npm package — will be tree-shaken & bundled by Vite) ───
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, push, query, orderByChild, equalTo } from "firebase/database";

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

// ─── Utility Functions ───
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim();
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
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalMessage').textContent = message;
  document.getElementById('errorModal').classList.add('show');
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

function getCategoryLimits(categoryName) {
  if (!categoryName) return { min: 3, max: 8 };
  const lower = categoryName.toLowerCase().replace(/ı/g, 'i').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g');
  if (lower.includes('minik')) return { min: 4, max: 7 };
  if (lower.includes('kucuk') || lower.includes('küçük')) return { min: 4, max: 5 };
  if (lower.includes('yildiz') || lower.includes('yıldız') || lower.includes('genc') || lower.includes('genç')) return { min: 2, max: 3 };
  return { min: 3, max: 8 };
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
    const snapshot = await get(ref(db, 'competitions'));
    if (!snapshot.exists()) {
      competitionSelect.innerHTML = '<option value="">AKTİF YARIŞMA BULUNAMADI</option>';
      return;
    }
    competitionsCache = {};
    snapshot.forEach(child => {
      const data = child.val();
      if (data.durum === 'pasif') return;
      competitionsCache[child.key] = data;
    });
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

function filterCompetitions() {
  const city = document.getElementById('citySelect').value;
  const branch = document.getElementById('branchSelect').value;
  const competitionSelect = document.getElementById('competitionSelect');
  competitionSelect.innerHTML = '<option value="">YARIŞMA SEÇİNİZ</option>';
  if (!city) {
    competitionSelect.innerHTML = '<option value="">ÖNCE İL SEÇİNİZ</option>';
    return;
  }
  const cityUpper = city.toLocaleUpperCase('tr-TR');
  const branchUpper = branch.toLocaleUpperCase('tr-TR');
  let count = 0;
  Object.entries(competitionsCache).forEach(([key, data]) => {
    const compCity = (data.il || '').toLocaleUpperCase('tr-TR');
    if (compCity !== cityUpper) return;
    if (data.brans) {
      const compBranch = (data.brans || '').toLocaleUpperCase('tr-TR');
      if (compBranch !== branchUpper) return;
    }
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = (data.isim || data.ad || data.name || key).toLocaleUpperCase('tr-TR');
    competitionSelect.appendChild(opt);
    count++;
  });
  if (count === 0) {
    competitionSelect.innerHTML = '<option value="">BU İLDE AKTİF YARIŞMA BULUNAMADI</option>';
  }
  document.getElementById('categorySelect').innerHTML = '<option value="">ÖNCE YARIŞMA SEÇİNİZ</option>';
  selectedCompetition = null;
  updateStepIndicators();
}

function updateActiveBranches() {
  const city = document.getElementById('citySelect').value;
  const branchSelect = document.getElementById('branchSelect');
  const branches = ['Artistik', 'Ritmik', 'Parkur', 'Aerobik'];
  const branchLabels = {
    'Artistik': 'ARTİSTİK CİMNASTİK',
    'Ritmik': 'RİTMİK CİMNASTİK',
    'Parkur': 'PARKUR',
    'Aerobik': 'AEROBİK CİMNASTİK'
  };

  if (!city) {
    branchSelect.innerHTML = '';
    branches.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b;
      opt.textContent = branchLabels[b] || b.toLocaleUpperCase('tr-TR');
      if (b === 'Artistik') opt.selected = true;
      branchSelect.appendChild(opt);
    });
    return;
  }

  const cityUpper = city.toLocaleUpperCase('tr-TR');
  const activeBranches = new Set();
  let hasNoBranchField = false;
  Object.values(competitionsCache).forEach(data => {
    const compCity = (data.il || '').toLocaleUpperCase('tr-TR');
    if (compCity !== cityUpper) return;
    if (data.brans) {
      activeBranches.add(data.brans.toLocaleUpperCase('tr-TR'));
    } else {
      hasNoBranchField = true;
    }
  });

  const currentBranch = branchSelect.value;
  branchSelect.innerHTML = '';
  let hasCurrentBranch = false;

  branches.forEach(b => {
    const bUpper = b.toLocaleUpperCase('tr-TR');
    if (activeBranches.has(bUpper) || hasNoBranchField) {
      const opt = document.createElement('option');
      opt.value = b;
      opt.textContent = branchLabels[b] || b.toLocaleUpperCase('tr-TR');
      if (b === currentBranch) hasCurrentBranch = true;
      branchSelect.appendChild(opt);
    }
  });

  if (branchSelect.options.length === 0) {
    branches.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b;
      opt.textContent = branchLabels[b] || b.toLocaleUpperCase('tr-TR');
      branchSelect.appendChild(opt);
    });
  }

  if (!hasCurrentBranch) {
    branchSelect.value = 'Artistik';
  }
}

// ─── School Select (Combo) ───
let currentSchools = [];

function findSchoolKey(obj, target) {
  if (!obj || !target) return null;
  if (obj[target]) return target;
  const targetUpper = target.toLocaleUpperCase('tr-TR');
  if (obj[targetUpper]) return targetUpper;
  return Object.keys(obj).find(k => k.toLocaleUpperCase('tr-TR') === targetUpper) || null;
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

  currentSchools.forEach(s => {
    const name = typeof s === 'string' ? s : (s.name || s.ad || '');
    if (!name) return;
    if (filterUpper && !name.toLocaleUpperCase('tr-TR').includes(filterUpper)) return;
    const group = getSchoolGroup(name);
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

  const otherOpt = document.createElement('option');
  otherOpt.value = 'OTHER';
  otherOpt.textContent = 'OKULUMU BULAMADIM / DİĞER';
  schoolSelect.appendChild(otherOpt);
}

function loadSchoolsForDistrict() {
  const city = document.getElementById('citySelect').value;
  const district = document.getElementById('districtSelect').value;
  const schoolSelect = document.getElementById('schoolSelect');
  const schoolFilter = document.getElementById('schoolFilter');
  const schoolName = document.getElementById('schoolName');
  const hint = schoolSelect.parentElement.querySelector('.hint');

  currentSchools = [];
  schoolFilter.value = '';
  schoolName.value = '';

  if (!city || !district) {
    schoolSelect.style.display = 'none';
    schoolFilter.style.display = 'none';
    schoolName.style.display = 'none';
    schoolName.required = false;
    schoolSelect.required = true;
    schoolSelect.innerHTML = '<option value="">ÖNCE İLÇE SEÇİNİZ</option>';
    if (hint) hint.textContent = 'İLÇE SEÇTİKTEN SONRA OKUL LİSTESİ GÖRÜNECEK';
    return;
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
    schoolName.style.display = 'none';
    schoolName.required = false;
    if (hint) hint.textContent = 'LİSTEDEN OKULUNUZU SEÇİNİZ VEYA FİLTRELEYİNİZ';
  } else {
    schoolSelect.style.display = 'none';
    schoolFilter.style.display = 'none';
    schoolName.style.display = 'block';
    schoolName.required = true;
    schoolSelect.required = false;
    if (hint) hint.textContent = 'BU İLÇEDE KAYITLI OKUL BULUNAMADI - MANUEL GİRİNİZ';
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
        if (appData.sporcular && Array.isArray(appData.sporcular)) {
          appData.sporcular.forEach(sp => {
            if (tcknList.includes(sp.tckn)) {
              duplicates.push({ tckn: sp.tckn, source: 'başvuru', status: appData.durum || appData.status });
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
    const approvedSnap = await get(ref(db, `competitions/${competitionId}/sporcular/${categoryId}`));
    if (approvedSnap.exists()) {
      const approved = approvedSnap.val();
      Object.values(approved).forEach(sp => {
        if (tcknList.includes(sp.tckn)) {
          duplicates.push({ tckn: sp.tckn, source: 'onaylı sporcu' });
        }
      });
    }
  } catch (e) {
    console.warn('Onaylı sporcu kontrolünde hata:', e);
  }

  return duplicates;
}

async function checkSchoolQuota(competitionId, categoryId, schoolName, newAthleteCount) {
  let existingCount = 0;
  try {
    const appsSnap = await get(query(ref(db, 'applications'), orderByChild('competitionId'), equalTo(competitionId)));
    if (appsSnap.exists()) {
      appsSnap.forEach(child => {
        const appData = child.val();
        if (appData.okul === schoolName && appData.kategoriId === categoryId &&
            (appData.durum === 'bekliyor' || appData.durum === 'onaylandi' || appData.status === 'bekliyor' || appData.status === 'onaylandi')) {
          if (appData.sporcular && Array.isArray(appData.sporcular)) {
            existingCount += appData.sporcular.length;
          }
        }
      });
    }
    const approvedSnap = await get(ref(db, `competitions/${competitionId}/sporcular/${categoryId}`));
    if (approvedSnap.exists()) {
      Object.values(approvedSnap.val()).forEach(sp => {
        if (sp.okul === schoolName || sp.school === schoolName) {
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
    const appsSnap = await get(query(ref(db, 'applications'), orderByChild('competitionId'), equalTo(competitionId)));
    if (appsSnap.exists()) {
      appsSnap.forEach(child => {
        const appData = child.val();
        const appSchool = (appData.okul || '').toLocaleUpperCase('tr-TR');
        const targetSchool = schoolName.toLocaleUpperCase('tr-TR');
        if (appSchool === targetSchool && appData.kategoriId === categoryId &&
            (appData.durum === 'bekliyor' || appData.durum === 'onaylandi' || appData.status === 'bekliyor' || appData.status === 'onaylandi')) {
          if (appData.sporcular && Array.isArray(appData.sporcular)) {
            count += appData.sporcular.length;
          }
        }
      });
    }

    // 2. Zaten onaylanıp yarışmaya aktarılmış sporcuları say
    const approvedSnap = await get(ref(db, `competitions/${competitionId}/sporcular/${categoryId}`));
    if (approvedSnap.exists()) {
      const approved = approvedSnap.val();
      Object.values(approved).forEach(sp => {
        const spSchool = (sp.okul || sp.school || '').toLocaleUpperCase('tr-TR');
        if (spSchool === schoolName.toLocaleUpperCase('tr-TR')) {
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
    showToast(`⚠ FORMDA ${currentFormCount} SPORCU VAR AMA KALAN KONTENJAN ${remainingQuota}. LÜTFEN FAZLA SPORCULARI ÇIKARINIZ.`, 'warning');
  } else if (remainingQuota === 0) {
    showToast(`✗ BU OKUL VE KATEGORİ İÇİN KONTENJAN DOLMUŞTUR (${existingAthleteCount}/${categoryLimits.max})`, 'error');
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
  const schoolName = document.getElementById('schoolName');
  if (schoolSelect.style.display !== 'none' && schoolSelect.value && schoolSelect.value !== 'OTHER') {
    return schoolSelect.value;
  }
  return schoolName.value;
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
    if (tckn || name) athletes.push({ tckn, name, dob, license });
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
  if (!data.il) errors.push('✗ İL SEÇİNİZ');
  if (!data.ilce) errors.push('✗ İLÇE SEÇİNİZ');
  if (!data.okul) errors.push('✗ OKUL BİLGİSİ GİRİNİZ');
  else if (data.okul.length > 200) errors.push('✗ OKUL ADI ÇOK UZUN (MAX 200 KARAKTER)');
  if (!data.kategoriId && data.kategoriId !== 0) errors.push('✗ KATEGORİ SEÇİNİZ');

  // En az bir antrenör VEYA bir öğretmen olmalı
  if (data.antrenorler.length === 0 && data.ogretmenler.length === 0) {
    errors.push('✗ EN AZ BİR ANTRENÖR VEYA ÖĞRETMEN EKLEYİNİZ');
  }
  data.antrenorler.forEach((c, i) => {
    if (!c.name) errors.push(`✗ ${i + 1}. ANTRENÖR ADI BOŞ`);
    if (c.phone && !validatePhone(c.phone)) errors.push(`✗ ${i + 1}. ANTRENÖR TELEFON FORMATI HATALI`);
    if (c.email && !validateEmail(c.email)) errors.push(`✗ ${i + 1}. ANTRENÖR E-POSTA FORMATI HATALI`);
  });
  data.ogretmenler.forEach((t, i) => {
    if (!t.name) errors.push(`✗ ${i + 1}. ÖĞRETMEN ADI BOŞ`);
    if (t.phone && !validatePhone(t.phone)) errors.push(`✗ ${i + 1}. ÖĞRETMEN TELEFON FORMATI HATALI`);
    if (t.email && !validateEmail(t.email)) errors.push(`✗ ${i + 1}. ÖĞRETMEN E-POSTA FORMATI HATALI`);
  });

  if (data.sporcular.length === 0) errors.push('✗ EN AZ BİR SPORCU EKLEYİNİZ');

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
        // Uyarı — hata değil, toast ile bildir
        showToast(`⚠ ${i + 1}. SPORCU: ${dobResult.warning}`, 'warning');
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
    showToast('Lütfen birkaç saniye bekleyiniz', 'warning');
    return;
  }

  const submitBtn = document.getElementById('submitBtn');
  const data = collectFormData();

  const errors = validateForm(data);
  if (errors.length > 0) {
    errors.forEach(err => showToast(err, 'error'));
    return;
  }

  let hasInvalidCoach = false;
  data.antrenorler.forEach(c => {
    const result = verifyCoach(c.name);
    if (result === false) {
      hasInvalidCoach = true;
    }
  });
  if (hasInvalidCoach) {
    showToast('⚠ KAYITSIZ ANTRENÖR TESPİT EDİLDİ — BAŞVURU YİNE DE GÖNDERİLEBİLİR', 'warning');
  }

  submitBtn.classList.add('loading');
  submitBtn.disabled = true;
  submitCooldown = true;

  try {
    const tcknList = data.sporcular.map(a => a.tckn);
    const duplicates = await checkDuplicateTCKNs(data.competitionId, tcknList);
    if (duplicates.length > 0) {
      const dupInfo = duplicates.map(d => `T.C. ${d.tckn} (${d.source})`).join(', ');
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
      showErrorModal('MÜKERRER SPORCU TESPİT EDİLDİ', `ŞU SPORCULAR BU YARIŞMADA ZATEN KAYITLI: ${dupInfo}`);
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
      setTimeout(() => { submitCooldown = false; }, 5000);
      return;
    }

    // Son dakika kontenjan kontrolü (birden fazla kişi aynı anda başvuru yapıyor olabilir)
    const quota = await checkSchoolQuota(data.competitionId, data.kategoriId, data.okul, data.sporcular.length);
    if (quota.exceeded) {
      const kalanGercek = Math.max(0, categoryLimits.max - quota.existing);
      showErrorModal('KONTENJAN AŞILDI',
        `BU OKUL VE KATEGORİ İÇİN KONTENJAN DOLMUŞTUR.\n\n` +
        `MEVCUT KAYITLI SPORCU: ${quota.existing}\n` +
        `KATEGORİ LİMİTİ: ${categoryLimits.max}\n` +
        `EKLENEBİLECEK SPORCU: ${kalanGercek}\n` +
        `SİZİN BAŞVURUNUZ: ${data.sporcular.length} SPORCU\n\n` +
        `LÜTFEN SPORCU SAYINIZI ${kalanGercek} VEYA DAHA AZ YAPINIZ.`
      );
      // Güncel veriyle arayüzü de güncelle
      existingAthleteCount = quota.existing;
      remainingQuota = kalanGercek;
      updateQuotaInfoBox();
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
      setTimeout(() => { submitCooldown = false; }, 5000);
      return;
    }

    await push(ref(db, 'applications'), data);
    showToast('✓ BAŞVURUNUZ BAŞARIYLA GÖNDERİLDİ!', 'success');

    document.getElementById('applicationForm').reset();
    document.getElementById('coachRows').innerHTML = '';
    document.getElementById('teacherRows').innerHTML = '';
    document.getElementById('athleteRows').innerHTML = '';
    document.getElementById('schoolName').value = '';
    document.getElementById('schoolSelect').style.display = 'none';
    document.getElementById('schoolFilter').style.display = 'none';
    document.getElementById('schoolName').style.display = 'none';
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
    showToast('✗ BAŞVURU GÖNDERİLİRKEN BİR HATA OLUŞTU. LÜTFEN TEKRAR DENEYİNİZ.', 'error');
  } finally {
    submitBtn.classList.remove('loading');
    setTimeout(() => {
      submitCooldown = false;
      submitBtn.disabled = false;
    }, 5000);
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
    categoryLimits = getCategoryLimits(catName);
    remainingQuota = categoryLimits.max;
    updateTeamWarning();
    updateStepIndicators();
    fetchExistingAthleteCount(); // Kontenjan sorgula
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
    const schoolName = document.getElementById('schoolName');
    if (this.value === 'OTHER') {
      schoolName.style.display = 'block';
      schoolName.required = true;
      schoolName.value = '';
      schoolName.focus();
    } else {
      schoolName.style.display = 'none';
      schoolName.required = false;
      schoolName.value = this.value;
    }
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

  document.getElementById('modalCloseBtn').addEventListener('click', function() {
    document.getElementById('errorModal').classList.remove('show');
  });

  document.getElementById('errorModal').addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('show');
  });

  document.getElementById('applicationForm').addEventListener('input', updateStepIndicators);
  document.getElementById('applicationForm').addEventListener('change', updateStepIndicators);
}

// ─── Init ───
async function init() {
  initEventListeners();

  await Promise.all([
    loadTurkeyData(),
    loadSchools(),
    loadCoaches(),
    loadCompetitions()
  ]);

  addCoachRow();
  addTeacherRow();

  updateStepIndicators();
}

init();
