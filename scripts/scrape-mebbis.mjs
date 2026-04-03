#!/usr/bin/env node
/**
 * MEBBİS Okul Listesi Scraper
 * ─────────────────────────────────────────────────────────────────────────────
 * Kullanım:
 *   node scripts/scrape-mebbis.mjs               # Tüm iller
 *   node scripts/scrape-mebbis.mjs --il ANKARA   # Sadece belirtilen il
 *   node scripts/scrape-mebbis.mjs --test        # İlk 2 il, 3 ilçe (test)
 *
 * Environment değişkenleri:
 *   FIREBASE_DATABASE_URL      — Firebase RTDB URL (zorunlu)
 *   FIREBASE_SERVICE_ACCOUNT   — Service account JSON (base64 veya JSON string)
 *                                Yoksa: firebase-service-account.json dosyasına bakılır
 *
 * Firebase yazma yapısı:
 *   okullar/{IL}/{ILCE} = ["Okul1", "Okul2", ...]
 *   _meta/okullar_guncelleme = { tarih, toplamOkul, toplamIl, durum, hatalar }
 *
 * MEBBİS Sitesi: https://mebbis.meb.gov.tr/kurumlistesi.aspx
 *   - DevExpress ASP.NET WebForms
 *   - Dropdown ID'leri: cmbKurumTuru, cmbil, cmbilce
 *   - Listeleme butonu: btnKurumListelex
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { chromium } from 'playwright';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEBBIS_URL = 'https://mebbis.meb.gov.tr/kurumlistesi.aspx';
const DELAY_MS = 800;       // ilçeler arası bekleme (rate limit koruma)
const CITY_DELAY_MS = 1500; // iller arası bekleme

// ── CLI argümanları ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const singleIl = args.includes('--il') ? args[args.indexOf('--il') + 1] : null;
const testMode = args.includes('--test'); // Sadece ilk 2 il, 3 ilçe

// ── Firebase Admin başlatma ──────────────────────────────────────────────────
function initFirebase() {
  if (getApps().length > 0) return getDatabase();

  let serviceAccount;
  const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (saEnv) {
    try {
      // Önce base64 decode dene
      const decoded = Buffer.from(saEnv, 'base64').toString('utf8');
      serviceAccount = JSON.parse(decoded);
    } catch {
      // Direkt JSON string olabilir
      try {
        serviceAccount = JSON.parse(saEnv);
      } catch (e) {
        console.error('FIREBASE_SERVICE_ACCOUNT parse edilemedi:', e.message);
        process.exit(1);
      }
    }
  } else {
    // Yerel geliştirme: dosyadan oku
    const saPath = join(__dirname, '../firebase-service-account.json');
    try {
      serviceAccount = JSON.parse(readFileSync(saPath, 'utf8'));
    } catch (e) {
      console.error('Service account dosyası bulunamadı:', saPath);
      console.error('FIREBASE_SERVICE_ACCOUNT env değişkeni veya firebase-service-account.json gerekli');
      process.exit(1);
    }
  }

  initializeApp({
    credential: cert(serviceAccount),
    databaseURL:
      process.env.FIREBASE_DATABASE_URL ||
      'https://tcfcimnastik-default-rtdb.firebaseio.com',
  });

  return getDatabase();
}

// ── Yardımcı fonksiyonlar ────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Firebase key'lerinde geçersiz karakterleri temizler: . # $ [ ] /
 */
function normalizeKey(str) {
  return str.replace(/[.#$[\]/]/g, '_');
}

// ── Ana Scraper ──────────────────────────────────────────────────────────────
async function scrape() {
  const db = initFirebase();

  // Turkey şehir listesini yükle
  const turkeyDataPath = join(__dirname, '../src/data/turkey_data.json');
  let turkeyData;
  try {
    turkeyData = JSON.parse(readFileSync(turkeyDataPath, 'utf8'));
  } catch (e) {
    console.error('turkey_data.json okunamadı:', e.message);
    process.exit(1);
  }

  let cities = Object.keys(turkeyData).sort();

  if (singleIl) {
    cities = cities.filter((c) =>
      c.toUpperCase().includes(singleIl.toUpperCase())
    );
    if (cities.length === 0) {
      console.error(`"${singleIl}" ile eşleşen il bulunamadı`);
      process.exit(1);
    }
    console.log(`Tek il modu: ${cities.join(', ')}`);
  }

  if (testMode) {
    cities = cities.slice(0, 2);
    console.log(`Test modu aktif: ${cities.join(', ')}`);
  }

  console.log(`\nScraping başlıyor: ${cities.length} il işlenecek\n`);

  // Tarayıcı başlat
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  // Konsol hatalarını logla
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      // Sadece kritik hataları logla, DevExpress noise'ını ignore et
    }
  });

  // MEBBİS'e git
  console.log('MEBBİS sayfası yükleniyor...');
  await page.goto(MEBBIS_URL, { waitUntil: 'networkidle', timeout: 60000 });
  console.log('Sayfa yüklendi');

  // "Resmi Kurumlar" seç
  await selectDevExpress(page, 'cmbKurumTuru', 'Resmi Kurumlar');
  await sleep(1000);
  console.log('Kurum türü: Resmi Kurumlar seçildi\n');

  let totalSchools = 0;
  let processedCities = 0;
  const errors = [];

  for (const city of cities) {
    const cityKey = normalizeKey(city);
    processedCities++;
    console.log(
      `[${processedCities}/${cities.length}] ${city} işleniyor...`
    );

    try {
      // İl seç
      await selectDevExpress(page, 'cmbil', city);
      await sleep(CITY_DELAY_MS);

      // İlçe listesini al
      const districts = await getDevExpressOptions(page, 'cmbilce');
      const validDistricts = districts.filter(
        (d) => d && d !== 'Seçiniz!' && d !== '-' && d.trim() !== ''
      );

      if (testMode) {
        validDistricts.splice(3); // Test modunda max 3 ilçe
      }

      console.log(`  ${validDistricts.length} ilçe bulundu`);

      if (validDistricts.length === 0) {
        console.log(`  Uyarı: ${city} için ilçe listesi boş`);
        errors.push(`${city}: ilçe listesi boş`);
        continue;
      }

      const citySchoolData = {};

      for (const district of validDistricts) {
        const districtKey = normalizeKey(district);

        try {
          // İlçe seç
          await selectDevExpress(page, 'cmbilce', district);
          await sleep(500);

          // Kurum Listele butonuna tıkla
          await clickKurumListele(page);
          await sleep(DELAY_MS);

          // Okul listesini çek
          const schools = await extractSchools(page);

          if (schools.length > 0) {
            citySchoolData[districtKey] = schools;
            totalSchools += schools.length;
            console.log(`    + ${district}: ${schools.length} okul`);
          } else {
            console.log(`    ~ ${district}: okul bulunamadı`);
            citySchoolData[districtKey] = [];
          }
        } catch (err) {
          console.error(`    ! ${district} hatası: ${err.message}`);
          errors.push(`${city}/${district}: ${err.message}`);
          citySchoolData[districtKey] = [];
        }
      }

      // Şehir verilerini Firebase'e tek seferde yaz
      if (Object.keys(citySchoolData).length > 0) {
        const updates = {};
        Object.entries(citySchoolData).forEach(([dist, schools]) => {
          updates[`okullar/${cityKey}/${dist}`] = schools;
        });
        await db.ref('/').update(updates);
        const ilceCount = Object.keys(citySchoolData).length;
        const cityTotal = Object.values(citySchoolData).reduce(
          (sum, s) => sum + s.length,
          0
        );
        console.log(
          `  Firebase'e yazildi: ${ilceCount} ilçe, ${cityTotal} okul`
        );
      }
    } catch (err) {
      console.error(`  !! ${city} hata: ${err.message}`);
      errors.push(`${city}: ${err.message}`);

      // Sayfayı yeniden yükleyerek kurtarma dene
      console.log('  Sayfa yenileniyor...');
      try {
        await page.goto(MEBBIS_URL, {
          waitUntil: 'networkidle',
          timeout: 60000,
        });
        await selectDevExpress(page, 'cmbKurumTuru', 'Resmi Kurumlar');
        await sleep(2000);
        console.log('  Sayfa yenilendi, devam ediliyor');
      } catch (recoverErr) {
        console.error('  Kurtarma başarısız:', recoverErr.message);
      }
    }

    // İller arası bellek temizliği
    await page.evaluate(() => {
      if (window.gc) window.gc();
    }).catch(() => {});
  }

  // Meta veri yaz
  await db.ref('_meta/okullar_guncelleme').set({
    tarih: new Date().toISOString(),
    toplamOkul: totalSchools,
    toplamIl: processedCities,
    durum:
      errors.length === 0 ? 'tamamlandi' : 'hatalarla_tamamlandi',
    hatalar: errors.slice(0, 20), // En fazla 20 hata sakla
  });

  await browser.close();

  console.log('\n=== Scraping Tamamlandi ===');
  console.log(`Toplam okul   : ${totalSchools}`);
  console.log(`Islenen il    : ${processedCities}`);
  console.log(`Hata sayisi   : ${errors.length}`);
  if (errors.length > 0) {
    console.log('Ilk 5 hata:');
    errors.slice(0, 5).forEach((e) => console.log(' -', e));
  }

  return { totalSchools, processedCities, errors };
}

// ── DevExpress Yardımcıları ──────────────────────────────────────────────────

/**
 * DevExpress ComboBox'ta bir değeri seçer.
 * Üç strateji dener: JS API → dropdown tıklama → fallback
 */
async function selectDevExpress(page, controlId, value) {
  // Strateji 1: DevExpress JavaScript API
  const apiResult = await page
    .evaluate(
      ({ id, val }) => {
        try {
          // ASPxClientControl global koleksiyonunu dene
          const tryGet = (ns) => {
            const ctrl = ns?.GetControlCollection?.()?.Get?.(id);
            if (ctrl) {
              // SetValue dene
              if (ctrl.SetValue) {
                ctrl.SetValue(val);
                return 'set_value';
              }
              // Item bazlı seçim dene
              if (ctrl.GetItemCount) {
                const count = ctrl.GetItemCount();
                for (let i = 0; i < count; i++) {
                  const item = ctrl.GetItem(i);
                  if (
                    item &&
                    (item.GetValue() === val || item.GetText() === val)
                  ) {
                    ctrl.SetSelectedItem(item);
                    return 'set_item';
                  }
                }
              }
            }
            return null;
          };

          const r1 =
            tryGet(window.ASPxClientControl) || tryGet(window.ASPx);
          if (r1) return r1;

          // DevExpress namespace'i arama
          for (const key of Object.keys(window)) {
            if (
              key.startsWith('ASPx') &&
              window[key]?.GetControlCollection
            ) {
              const r = tryGet(window[key]);
              if (r) return r;
            }
          }
        } catch (e) {
          return null;
        }
        return null;
      },
      { id: controlId, val: value }
    )
    .catch(() => null);

  if (apiResult) {
    await page
      .waitForLoadState('networkidle', { timeout: 15000 })
      .catch(() => {});
    await sleep(300);
    return;
  }

  // Strateji 2: Dropdown butonuna tıkla, listeden seç
  const dropdownBtnSel = `#${controlId}_B`;
  const inputSel = `#${controlId}_I`;
  const listSel = `#${controlId}_DDD_L`;

  try {
    // Dropdown aç
    const btnExists = await page.$(dropdownBtnSel);
    if (btnExists) {
      await page.click(dropdownBtnSel, { timeout: 5000 });
    } else {
      await page.click(inputSel, { timeout: 5000 });
    }

    await page
      .waitForSelector(listSel, { state: 'visible', timeout: 5000 })
      .catch(() => {});
    await sleep(200);

    // Listede değeri bul ve tıkla
    const clicked = await page.evaluate(
      ({ listSelector, val }) => {
        const list = document.querySelector(listSelector);
        if (!list) return false;
        const cells = list.querySelectorAll('td');
        for (const cell of cells) {
          if (cell.textContent.trim() === val) {
            cell.click();
            return true;
          }
        }
        // Kısmi eşleşme dene
        for (const cell of cells) {
          if (cell.textContent.trim().includes(val)) {
            cell.click();
            return true;
          }
        }
        return false;
      },
      { listSelector: listSel, val: value }
    );

    if (clicked) {
      await page
        .waitForLoadState('networkidle', { timeout: 15000 })
        .catch(() => {});
      await sleep(300);
      return;
    }
  } catch (err) {
    // Strateji 2 başarısız, devam et
  }

  // Strateji 3: Standard select element (fallback)
  try {
    await page.selectOption(`#${controlId}`, { label: value }, { timeout: 3000 });
    await page
      .waitForLoadState('networkidle', { timeout: 10000 })
      .catch(() => {});
    return;
  } catch {
    // Yok say
  }

  // Strateji 4: Input'a yaz + Enter
  try {
    await page.fill(inputSel, value, { timeout: 3000 });
    await sleep(300);
    await page.keyboard.press('Enter');
    await page
      .waitForLoadState('networkidle', { timeout: 10000 })
      .catch(() => {});
  } catch {
    // Son strateji de başarısız
    console.warn(`    selectDevExpress: "${value}" seçilemedi (${controlId})`);
  }
}

/**
 * DevExpress ComboBox'taki tüm seçenekleri döndürür.
 */
async function getDevExpressOptions(page, controlId) {
  return page
    .evaluate((id) => {
      const results = [];

      // Strateji 1: JS API ile item listesi
      try {
        const tryGet = (ns) => {
          const ctrl = ns?.GetControlCollection?.()?.Get?.(id);
          if (ctrl && ctrl.GetItemCount) {
            const count = ctrl.GetItemCount();
            for (let i = 0; i < count; i++) {
              const item = ctrl.GetItem(i);
              if (item) {
                const text = item.GetText?.() || item.GetValue?.() || '';
                if (text) results.push(text);
              }
            }
            return results.length > 0;
          }
          return false;
        };

        if (
          tryGet(window.ASPxClientControl) ||
          tryGet(window.ASPx) ||
          Object.keys(window).some(
            (k) =>
              k.startsWith('ASPx') &&
              window[k]?.GetControlCollection &&
              tryGet(window[k])
          )
        ) {
          return results;
        }
      } catch (e) {}

      // Strateji 2: DOM'daki gizli liste öğeleri
      // DevExpress listesi genellikle DDD_L ID'li div içinde td'ler
      const listEl = document.querySelector(`#${id}_DDD_L`);
      if (listEl) {
        const cells = listEl.querySelectorAll('td');
        cells.forEach((c) => {
          const text = c.textContent.trim();
          if (text) results.push(text);
        });
        if (results.length > 0) return results;
      }

      // Strateji 3: Standard select element
      const selectEl = document.querySelector(`#${id}`);
      if (selectEl && selectEl.tagName === 'SELECT') {
        Array.from(selectEl.options).forEach((o) => {
          if (o.value) results.push(o.text || o.value);
        });
        return results;
      }

      // Strateji 4: Input value'yu dene ve dropdown aç
      // (Bu noktada dropdown açık değilse içerik görünmez)
      return results;
    }, controlId)
    .catch(() => []);
}

/**
 * "Kurum Listele" butonuna tıklar ve sayfa yüklenip güncellenene kadar bekler.
 */
async function clickKurumListele(page) {
  const selectors = [
    '#btnKurumListelex',
    'input[id*="btnKurumListelex"]',
    'button[id*="btnKurumListelex"]',
    'span[id*="btnKurumListelex"]',
    '[id*="KurumListele"]',
    '[id*="kurumlistele"]',
  ];

  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click({ timeout: 5000 });
        await page
          .waitForLoadState('networkidle', { timeout: 25000 })
          .catch(() => {});
        return;
      }
    } catch {
      // Bu selector çalışmadı, devam et
    }
  }

  // Fallback: Sayfada "Listele" veya "Ara" içeren buton ara
  try {
    await page.evaluate(() => {
      const btns = document.querySelectorAll(
        'input[type="button"], input[type="submit"], button'
      );
      for (const btn of btns) {
        const val = (btn.value || btn.textContent || '').toLowerCase();
        if (val.includes('listele') || val.includes('ara')) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    await page
      .waitForLoadState('networkidle', { timeout: 25000 })
      .catch(() => {});
  } catch {
    // Son çare: Enter tuşu
    await page.keyboard.press('Enter');
    await page
      .waitForLoadState('networkidle', { timeout: 25000 })
      .catch(() => {});
  }
}

/**
 * Sayfadan okul adlarını çıkarır.
 * Birden fazla strateji dener.
 */
async function extractSchools(page) {
  return page
    .evaluate(() => {
      const schools = new Set();

      // Strateji 1: ASPxGridView ID kalıpları
      const gridSelectors = [
        // Birinci sütun hücreleri (okul adı genellikle ilk sütundadır)
        '#grdKurum_DXMainTable td:first-child',
        '[id*="grdKurum"] td:first-child',
        '[id*="GridKurum"] td:first-child',
        '[id*="gridKurum"] td:first-child',
        '[id*="ASPxGrid"] td:first-child',
        // DevExpress grid değer hücreleri
        'td.dxgv',
        'td[class*="dxgv"]',
      ];

      for (const sel of gridSelectors) {
        const cells = document.querySelectorAll(sel);
        if (cells.length > 1) {
          cells.forEach((cell) => {
            const text = cell.textContent.trim();
            // En az 4 karakter, "Seçiniz" gibi placeholder değil
            if (
              text.length >= 4 &&
              !text.toLowerCase().includes('seçiniz') &&
              !text.toLowerCase().includes('secin') &&
              !/^\d+$/.test(text) // Sadece sayı olan hücreleri atla
            ) {
              schools.add(text);
            }
          });
          if (schools.size > 0) return [...schools];
        }
      }

      // Strateji 2: Okul anahtar kelimeleri içeren tablolar
      const schoolKeywords = [
        'OKUL',
        'LİSE',
        'LISE',
        'ORTAOKUL',
        'İLKOKUL',
        'ILKOKUL',
        'ANAOKUL',
        'KOLEJ',
        'ÖZEL',
        'OZEL',
        'MESLEKİ',
        'MESLEKI',
        'İMAM',
        'IMAM',
        'ANADOLU',
        'FEN LİSESİ',
        'SOSYAL BİLİMLER',
        'GÜZEL SANATLAR',
      ];

      const tables = document.querySelectorAll('table');
      for (const table of tables) {
        const rows = table.querySelectorAll('tr');
        if (rows.length > 3) {
          const firstCells = table.querySelectorAll('td:first-child');
          const candidates = [];
          firstCells.forEach((cell) => {
            const text = cell.textContent.trim();
            const upper = text.toUpperCase();
            if (
              text.length > 5 &&
              text.length < 200 &&
              schoolKeywords.some((k) => upper.includes(k))
            ) {
              candidates.push(text);
            }
          });
          if (candidates.length > 2) {
            candidates.forEach((c) => schools.add(c));
            return [...schools];
          }
        }
      }

      // Strateji 3: Tüm td hücrelerinden okul anahtar kelimesiyle filtre
      const allCells = document.querySelectorAll('td');
      allCells.forEach((cell) => {
        const text = cell.textContent.trim();
        const upper = text.toUpperCase();
        if (
          text.length > 5 &&
          text.length < 200 &&
          schoolKeywords.some((k) => upper.includes(k)) &&
          !text.includes('\n') // Multi-line hücreleri atla
        ) {
          schools.add(text);
        }
      });

      return [...schools];
    })
    .catch(() => []);
}

// ── Çalıştır ─────────────────────────────────────────────────────────────────
scrape().catch((err) => {
  console.error('Scraper kritik hata:', err);
  process.exit(1);
});
