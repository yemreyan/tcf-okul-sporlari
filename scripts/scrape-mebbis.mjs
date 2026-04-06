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
const DELAY_MS = 600;        // ilçeler arası bekleme
const CITY_DELAY_MS = 1200;  // iller arası bekleme

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
      const decoded = Buffer.from(saEnv, 'base64').toString('utf8');
      serviceAccount = JSON.parse(decoded);
    } catch {
      try {
        serviceAccount = JSON.parse(saEnv);
      } catch (e) {
        console.error('FIREBASE_SERVICE_ACCOUNT parse edilemedi:', e.message);
        process.exit(1);
      }
    }
  } else {
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
      'https://okulsporlari-6db6e-default-rtdb.firebaseio.com',
  });

  return getDatabase();
}

// ── Yardımcı fonksiyonlar ────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeKey(str) {
  return str.replace(/[.#$[\]/]/g, '_');
}

/** networkidle veya timeout — hangisi önce gelirse */
async function waitForIdle(page, timeout = 8000) {
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
}

// ── DevExpress: Il seç ve ilçe dropdown'ını bekle ────────────────────────────
async function selectIl(page, city) {
  // Strateji 1: DevExpress JS API
  const ok = await page.evaluate((val) => {
    try {
      const tryNs = (ns) => {
        const ctrl = ns?.GetControlCollection?.()?.Get?.('cmbil');
        if (!ctrl) return false;
        if (ctrl.SetValue) { ctrl.SetValue(val); return true; }
        if (ctrl.GetItemCount) {
          for (let i = 0; i < ctrl.GetItemCount(); i++) {
            const item = ctrl.GetItem(i);
            if (item && (item.GetValue?.() === val || item.GetText?.() === val)) {
              ctrl.SetSelectedItem(item);
              return true;
            }
          }
        }
        return false;
      };
      if (tryNs(window.ASPxClientControl) || tryNs(window.ASPx)) return true;
      for (const k of Object.keys(window)) {
        if (k.startsWith('ASPx') && window[k]?.GetControlCollection && tryNs(window[k])) return true;
      }
    } catch {}
    return false;
  }, city).catch(() => false);

  if (!ok) {
    // Strateji 2: dropdown tıkla → listeden seç
    try {
      const btn = await page.$('#cmbil_B') || await page.$('#cmbil_I');
      if (btn) await btn.click({ timeout: 5000 });
      await sleep(400);
      const clicked = await page.evaluate((val) => {
        const list = document.querySelector('#cmbil_DDD_L');
        if (!list) return false;
        for (const cell of list.querySelectorAll('td')) {
          if (cell.textContent.trim() === val || cell.textContent.trim().includes(val)) {
            cell.click(); return true;
          }
        }
        return false;
      }, city);
      if (!clicked) throw new Error('list item not found');
    } catch {
      // Strateji 3: fill + Enter
      try {
        await page.fill('#cmbil_I', city, { timeout: 3000 });
        await sleep(200);
        await page.keyboard.press('Enter');
      } catch {}
    }
  }

  // İlçe dropdown'ının dolmasını bekle (max 10s)
  await waitForIdle(page, 10000);
  await sleep(500);
}

// ── DevExpress: İlçe seç ─────────────────────────────────────────────────────
async function selectIlce(page, district) {
  const ok = await page.evaluate((val) => {
    try {
      const tryNs = (ns) => {
        const ctrl = ns?.GetControlCollection?.()?.Get?.('cmbilce');
        if (!ctrl) return false;
        if (ctrl.SetValue) { ctrl.SetValue(val); return true; }
        if (ctrl.GetItemCount) {
          for (let i = 0; i < ctrl.GetItemCount(); i++) {
            const item = ctrl.GetItem(i);
            if (item && (item.GetValue?.() === val || item.GetText?.() === val)) {
              ctrl.SetSelectedItem(item);
              return true;
            }
          }
        }
        return false;
      };
      if (tryNs(window.ASPxClientControl) || tryNs(window.ASPx)) return true;
      for (const k of Object.keys(window)) {
        if (k.startsWith('ASPx') && window[k]?.GetControlCollection && tryNs(window[k])) return true;
      }
    } catch {}
    return false;
  }, district).catch(() => false);

  if (!ok) {
    try {
      const btn = await page.$('#cmbilce_B') || await page.$('#cmbilce_I');
      if (btn) await btn.click({ timeout: 5000 });
      await sleep(400);
      const clicked = await page.evaluate((val) => {
        const list = document.querySelector('#cmbilce_DDD_L');
        if (!list) return false;
        for (const cell of list.querySelectorAll('td')) {
          if (cell.textContent.trim() === val || cell.textContent.trim().includes(val)) {
            cell.click(); return true;
          }
        }
        return false;
      }, district);
      if (!clicked) throw new Error('list item not found');
    } catch {
      try {
        await page.fill('#cmbilce_I', district, { timeout: 3000 });
        await sleep(200);
        await page.keyboard.press('Enter');
      } catch {}
    }
  }

  await waitForIdle(page, 8000);
  await sleep(300);
}

// ── DevExpress: İlçe listesini oku ──────────────────────────────────────────
async function getIlceOptions(page) {
  // Strateji 1: DevExpress JS API
  const fromApi = await page.evaluate(() => {
    const results = [];
    try {
      const tryNs = (ns) => {
        const ctrl = ns?.GetControlCollection?.()?.Get?.('cmbilce');
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
      if (tryNs(window.ASPxClientControl) || tryNs(window.ASPx)) return results;
      for (const k of Object.keys(window)) {
        if (k.startsWith('ASPx') && window[k]?.GetControlCollection && tryNs(window[k])) return results;
      }
    } catch {}
    return null;
  }).catch(() => null);

  if (fromApi && fromApi.length > 0) return fromApi;

  // Strateji 2: Dropdown'ı açarak DOM'dan oku
  try {
    const btn = await page.$('#cmbilce_B') || await page.$('#cmbilce_I');
    if (btn) {
      await btn.click({ timeout: 5000 });
      // Liste görünür olana kadar bekle (max 5s)
      await page.waitForSelector('#cmbilce_DDD_L', { state: 'visible', timeout: 5000 }).catch(() => {});
      await sleep(300);

      const fromDom = await page.evaluate(() => {
        const list = document.querySelector('#cmbilce_DDD_L');
        if (!list) return [];
        return Array.from(list.querySelectorAll('td'))
          .map(c => c.textContent.trim())
          .filter(t => t.length > 0);
      });

      // Dropdown'ı kapat
      await page.keyboard.press('Escape');
      await sleep(200);

      if (fromDom.length > 0) return fromDom;
    }
  } catch {}

  // Strateji 3: Gizli select element
  const fromSelect = await page.evaluate(() => {
    const el = document.querySelector('#cmbilce');
    if (el && el.tagName === 'SELECT') {
      return Array.from(el.options).map(o => o.text || o.value).filter(t => t);
    }
    return [];
  }).catch(() => []);

  return fromSelect;
}

// ── Kurum Listele tıkla ──────────────────────────────────────────────────────
async function clickKurumListele(page) {
  const selectors = [
    '#btnKurumListelex',
    'input[id*="btnKurumListelex"]',
    'button[id*="btnKurumListelex"]',
    '[id*="KurumListele"]',
  ];

  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click({ timeout: 5000 });
        await waitForIdle(page, 15000);
        return;
      }
    } catch {}
  }

  // Fallback: "Listele" veya "Ara" butonu
  try {
    await page.evaluate(() => {
      const btns = document.querySelectorAll('input[type="button"], input[type="submit"], button');
      for (const btn of btns) {
        const val = (btn.value || btn.textContent || '').toLowerCase();
        if (val.includes('listele') || val.includes('ara')) { btn.click(); return; }
      }
    });
    await waitForIdle(page, 15000);
  } catch {
    await page.keyboard.press('Enter');
    await waitForIdle(page, 10000);
  }
}

// ── Okul listesini çek ───────────────────────────────────────────────────────
async function extractSchools(page) {
  return page.evaluate(() => {
    const schools = new Set();
    const schoolKeywords = [
      'OKUL', 'LİSE', 'LISE', 'ORTAOKUL', 'İLKOKUL', 'ILKOKUL',
      'ANAOKUL', 'KOLEJ', 'ÖZEL', 'OZEL', 'MESLEKİ', 'MESLEKI',
      'İMAM', 'IMAM', 'ANADOLU', 'FEN', 'SOSYAL', 'SANATLAR',
    ];

    // Strateji 1: ASPxGridView grid hücreleri
    const gridSelectors = [
      '#grdKurum_DXMainTable td:first-child',
      '[id*="grdKurum"] td:first-child',
      '[id*="GridKurum"] td:first-child',
      'td.dxgv',
      'td[class*="dxgv"]',
    ];
    for (const sel of gridSelectors) {
      const cells = document.querySelectorAll(sel);
      if (cells.length > 1) {
        cells.forEach((cell) => {
          const text = cell.textContent.trim();
          if (text.length >= 4 && !text.toLowerCase().includes('seçiniz') && !/^\d+$/.test(text)) {
            schools.add(text);
          }
        });
        if (schools.size > 0) return [...schools];
      }
    }

    // Strateji 2: Okul anahtar kelimeleri içeren hücreler
    const allCells = document.querySelectorAll('td');
    allCells.forEach((cell) => {
      const text = cell.textContent.trim();
      const upper = text.toUpperCase();
      if (
        text.length > 5 && text.length < 200 &&
        schoolKeywords.some((k) => upper.includes(k)) &&
        !text.includes('\n')
      ) {
        schools.add(text);
      }
    });

    return [...schools];
  }).catch(() => []);
}

// ── Kurum Türü seç (Resmi Kurumlar) ─────────────────────────────────────────
async function selectKurumTuru(page) {
  const ok = await page.evaluate(() => {
    try {
      const tryNs = (ns) => {
        const ctrl = ns?.GetControlCollection?.()?.Get?.('cmbKurumTuru');
        if (!ctrl) return false;
        if (ctrl.SetValue) { ctrl.SetValue('Resmi Kurumlar'); return true; }
        if (ctrl.GetItemCount) {
          for (let i = 0; i < ctrl.GetItemCount(); i++) {
            const item = ctrl.GetItem(i);
            if (item && (item.GetText?.() === 'Resmi Kurumlar' || item.GetValue?.() === 'Resmi Kurumlar')) {
              ctrl.SetSelectedItem(item);
              return true;
            }
          }
        }
        return false;
      };
      if (tryNs(window.ASPxClientControl) || tryNs(window.ASPx)) return true;
      for (const k of Object.keys(window)) {
        if (k.startsWith('ASPx') && window[k]?.GetControlCollection && tryNs(window[k])) return true;
      }
    } catch {}
    return false;
  }).catch(() => false);

  if (!ok) {
    try {
      const btn = await page.$('#cmbKurumTuru_B') || await page.$('#cmbKurumTuru_I');
      if (btn) await btn.click({ timeout: 5000 });
      await sleep(400);
      await page.evaluate(() => {
        const list = document.querySelector('#cmbKurumTuru_DDD_L');
        if (!list) return;
        for (const cell of list.querySelectorAll('td')) {
          if (cell.textContent.trim().includes('Resmi')) { cell.click(); return; }
        }
      });
    } catch {}
  }

  await waitForIdle(page, 8000);
  await sleep(500);
}

// ── Ana Scraper ──────────────────────────────────────────────────────────────
async function scrape() {
  const db = initFirebase();

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
    cities = cities.filter((c) => c.toUpperCase().includes(singleIl.toUpperCase()));
    if (cities.length === 0) { console.error(`"${singleIl}" ile eşleşen il bulunamadı`); process.exit(1); }
    console.log(`Tek il modu: ${cities.join(', ')}`);
  }

  if (testMode) {
    cities = cities.slice(0, 2);
    console.log(`Test modu aktif: ${cities.join(', ')}`);
  }

  console.log(`\nScraping başlıyor: ${cities.length} il işlenecek\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  console.log('MEBBİS sayfası yükleniyor...');
  await page.goto(MEBBIS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForIdle(page, 15000);
  console.log('Sayfa yüklendi');

  await selectKurumTuru(page);
  console.log('Kurum türü: Resmi Kurumlar seçildi\n');

  let totalSchools = 0;
  let processedCities = 0;
  const errors = [];

  for (const city of cities) {
    const cityKey = normalizeKey(city.toLocaleUpperCase('tr-TR'));
    processedCities++;
    console.log(`[${processedCities}/${cities.length}] ${city} işleniyor...`);

    try {
      await selectIl(page, city);
      await sleep(CITY_DELAY_MS);

      const districts = await getIlceOptions(page);
      const validDistricts = districts.filter(
        (d) => d && d !== 'Seçiniz!' && d !== '-' && d.trim() !== ''
      );

      if (testMode) validDistricts.splice(3);

      console.log(`  ${validDistricts.length} ilçe bulundu`);

      if (validDistricts.length === 0) {
        console.log(`  Uyarı: ${city} için ilçe listesi boş`);
        errors.push(`${city}: ilçe listesi boş`);
        // Sayfayı yenile ve devam et
        await page.goto(MEBBIS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForIdle(page, 10000);
        await selectKurumTuru(page);
        continue;
      }

      const citySchoolData = {};

      for (const district of validDistricts) {
        const districtKey = normalizeKey(district.toLocaleUpperCase('tr-TR'));
        try {
          await selectIlce(page, district);
          await sleep(300);
          await clickKurumListele(page);
          await sleep(DELAY_MS);

          const schools = await extractSchools(page);

          citySchoolData[districtKey] = schools;
          if (schools.length > 0) {
            totalSchools += schools.length;
            console.log(`    + ${district}: ${schools.length} okul`);
          } else {
            console.log(`    ~ ${district}: okul bulunamadı`);
          }
        } catch (err) {
          console.error(`    ! ${district} hatası: ${err.message}`);
          errors.push(`${city}/${district}: ${err.message}`);
          citySchoolData[districtKey] = [];
        }
      }

      // Firebase'e yaz
      if (Object.keys(citySchoolData).length > 0) {
        const updates = {};
        Object.entries(citySchoolData).forEach(([dist, schools]) => {
          updates[`okullar/${cityKey}/${dist}`] = schools;
        });
        await db.ref('/').update(updates);
        const cityTotal = Object.values(citySchoolData).reduce((s, a) => s + a.length, 0);
        console.log(`  Firebase'e yazildi: ${Object.keys(citySchoolData).length} ilçe, ${cityTotal} okul`);
      }
    } catch (err) {
      console.error(`  !! ${city} hata: ${err.message}`);
      errors.push(`${city}: ${err.message}`);

      console.log('  Sayfa yenileniyor...');
      try {
        await page.goto(MEBBIS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForIdle(page, 10000);
        await selectKurumTuru(page);
        await sleep(2000);
        console.log('  Sayfa yenilendi, devam ediliyor');
      } catch (recoverErr) {
        console.error('  Kurtarma başarısız:', recoverErr.message);
      }
    }
  }

  await db.ref('_meta/okullar_guncelleme').set({
    tarih: new Date().toISOString(),
    toplamOkul: totalSchools,
    toplamIl: processedCities,
    durum: errors.length === 0 ? 'tamamlandi' : 'hatalarla_tamamlandi',
    hatalar: errors.slice(0, 20),
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

scrape().catch((err) => {
  console.error('Scraper kritik hata:', err);
  process.exit(1);
});
