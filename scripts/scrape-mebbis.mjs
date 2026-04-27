#!/usr/bin/env node
/**
 * MEBBİS Okul Listesi Scraper v2
 * ─────────────────────────────────────────────────────────────────────────────
 * Kullanım:
 *   node scripts/scrape-mebbis.mjs               # Tüm iller
 *   node scripts/scrape-mebbis.mjs --il ANKARA   # Sadece belirtilen il
 *   node scripts/scrape-mebbis.mjs --test        # İlk 3 il
 *   node scripts/scrape-mebbis.mjs --json-only   # Sadece schools.json
 *
 * Önemli: Postback sonrası page navigation olur → waitForNavigation gerekli
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEBBIS_URL = 'https://mebbis.meb.gov.tr/kurumlistesi.aspx';
const OUTPUT_PATH = join(__dirname, '../public/data/schools.json');

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const singleIl = args.includes('--il') ? args[args.indexOf('--il') + 1]?.toUpperCase() : null;
const testMode = args.includes('--test');
const jsonOnly = args.includes('--json-only');

// ── Firebase (opsiyonel) ─────────────────────────────────────────────────────
async function initFirebase() {
  if (jsonOnly) return null;
  try {
    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    const { getDatabase } = await import('firebase-admin/database');
    if (getApps().length > 0) return getDatabase();
    let sa;
    const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (saEnv) {
      try { sa = JSON.parse(Buffer.from(saEnv, 'base64').toString('utf8')); }
      catch { try { sa = JSON.parse(saEnv); } catch { return null; } }
    } else {
      const p = join(__dirname, '../firebase-service-account.json');
      if (!existsSync(p)) return null;
      sa = JSON.parse(readFileSync(p, 'utf8'));
    }
    initializeApp({ credential: cert(sa), databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://okulsporlari-6db6e-default-rtdb.firebaseio.com' });
    return getDatabase();
  } catch { return null; }
}

// ── Yardımcı ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function normalizeKey(str) { return str.replace(/[.#$[\]/]/g, '_').toLocaleUpperCase('tr-TR'); }

// ── Sayfaya git ve kontrollerin yüklenmesini bekle ──────────────────────────
async function loadMebbisPage(page) {
  await page.goto(MEBBIS_URL, { waitUntil: 'load', timeout: 60000 });
  // DevExpress kontrollerinin yüklenmesini bekle
  await page.waitForFunction(
    () => typeof window.cmbKurumTuru !== 'undefined' && typeof window.cmbil !== 'undefined',
    { timeout: 15000 }
  );
  await sleep(1000);
}

// ── İl listesini al ─────────────────────────────────────────────────────────
async function getCityList(page) {
  return page.evaluate(() => {
    const ctrl = window.cmbil;
    if (!ctrl || !ctrl.GetItemCount) return [];
    const list = [];
    for (let i = 0; i < ctrl.GetItemCount(); i++) {
      const item = ctrl.GetItem(i);
      const text = (item?.text || '').trim();
      if (text && text !== 'Seçiniz' && text !== 'Seçiniz!') {
        list.push({ index: i, text });
      }
    }
    return list;
  });
}

// ── Seçim yap + Listele + Postback bekle ────────────────────────────────────
async function selectCityAndSearch(page, cityIndex) {
  // İl seç
  await page.evaluate((idx) => {
    window.cmbKurumTuru.SetSelectedIndex(1); // Resmi Kurumlar
    window.cmbil.SetSelectedIndex(idx);
  }, cityIndex);
  await sleep(500);

  // "Kurum Listele" butonuna tıkla ve postback navigation'ı bekle
  // page.click + waitForNavigation aynı anda çalışmalı
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load', timeout: 60000 }),
    page.click('#btnKurumListelex'),
  ]);

  // İçeriğin tam yüklenmesini bekle
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await sleep(1000);
}

// ── Grid'den tüm satırları çek ──────────────────────────────────────────────
async function extractAllRows(page) {
  return page.evaluate(() => {
    const rows = document.querySelectorAll('[id^="gvKurumListe_DXDataRow"]');
    if (rows.length > 0) {
      return Array.from(rows).map(row => {
        const tds = row.querySelectorAll('td');
        return {
          ilce: (tds[2]?.textContent || '').trim(),
          kurum: (tds[3]?.textContent || '').trim(),
        };
      }).filter(r => r.kurum.length > 0);
    }
    // Fallback: normal table rows
    const table = document.getElementById('gvKurumListe');
    if (!table) return [];
    const trs = table.querySelectorAll('tr');
    const results = [];
    for (let i = 1; i < trs.length; i++) {
      const tds = trs[i].querySelectorAll('td');
      if (tds.length >= 4) {
        const kurum = (tds[3]?.textContent || '').trim();
        const ilce = (tds[2]?.textContent || '').trim();
        if (kurum) results.push({ ilce, kurum });
      }
    }
    return results;
  }).catch(() => []);
}

// ── Toplam kayıt sayısı ─────────────────────────────────────────────────────
async function getTotalCount(page) {
  return page.evaluate(() => {
    const match = document.body.innerText.match(/(\d+)\s*adet\s*kay[ıi]t/i);
    return match ? parseInt(match[1], 10) : 0;
  }).catch(() => 0);
}

// ══════════════════════════════════════════════════════════════════════════════
async function scrape() {
  console.log('\n🏫 MEBBİS Okul Listesi Scraper v2');
  console.log('═'.repeat(60));

  let existingData = {};
  if (existsSync(OUTPUT_PATH)) {
    try {
      existingData = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));
      console.log(`📂 Mevcut schools.json: ${Object.keys(existingData).length} il`);
    } catch { existingData = {}; }
  }

  const firebaseDb = await initFirebase();
  console.log(firebaseDb ? '🔥 Firebase bağlı' : '📝 Sadece JSON');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await (await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1280, height: 900 },
  })).newPage();

  console.log('\n🌐 MEBBİS yükleniyor...');
  await loadMebbisPage(page);
  console.log('✓ Sayfa yüklendi');

  // İl listesi
  const allCities = await getCityList(page);
  console.log(`📋 ${allCities.length} il`);

  let cities = allCities;
  if (singleIl) {
    cities = cities.filter(c => c.text.toLocaleUpperCase('tr-TR').includes(singleIl));
    if (cities.length === 0) { console.error(`❌ "${singleIl}" bulunamadı`); process.exit(1); }
    console.log(`🎯 ${cities.map(c => c.text).join(', ')}`);
  }
  if (testMode) {
    cities = cities.slice(0, 3);
    console.log(`🧪 Test: ${cities.map(c => c.text).join(', ')}`);
  }

  console.log(`${'─'.repeat(60)}`);

  let totalSchools = 0;
  let processedCities = 0;
  const errors = [];
  const allData = { ...existingData };

  for (const { index: cityIdx, text: cityName } of cities) {
    processedCities++;
    const cityKey = normalizeKey(cityName);
    console.log(`\n[${processedCities}/${cities.length}] 🏙 ${cityName}`);

    try {
      // Seç + Listele + Postback bekle
      await selectCityAndSearch(page, cityIdx);

      const total = await getTotalCount(page);
      console.log(`   📊 ${total} kayıt`);

      if (total === 0) {
        errors.push(`${cityName}: kayıt yok`);
        await loadMebbisPage(page);
        continue;
      }

      // Tüm satırları çek (DOM'da hepsi var, sayfalama yok)
      const records = await extractAllRows(page);
      console.log(`   ✓ ${records.length} okul çekildi`);

      // İlçeye göre grupla
      const cityData = {};
      for (const rec of records) {
        const ilceKey = normalizeKey(rec.ilce || 'BİLİNMEYEN');
        if (!cityData[ilceKey]) cityData[ilceKey] = [];
        if (!cityData[ilceKey].includes(rec.kurum)) {
          cityData[ilceKey].push(rec.kurum);
        }
      }
      for (const k of Object.keys(cityData)) {
        cityData[k].sort((a, b) => a.localeCompare(b, 'tr-TR'));
      }

      const cityTotal = Object.values(cityData).reduce((s, a) => s + a.length, 0);
      totalSchools += cityTotal;
      allData[cityKey] = cityData;
      console.log(`   📁 ${Object.keys(cityData).length} ilçe, ${cityTotal} okul`);

      // Firebase
      if (firebaseDb) {
        try {
          const updates = {};
          Object.entries(cityData).forEach(([dist, schools]) => {
            updates[`okullar/${cityKey}/${dist}`] = schools;
          });
          await firebaseDb.ref('/').update(updates);
          console.log(`   🔥 Firebase güncellendi`);
        } catch (e) { console.warn(`   ⚠ Firebase: ${e.message}`); }
      }

      // Her il sonrası kaydet
      writeFileSync(OUTPUT_PATH, JSON.stringify(allData, null, 2), 'utf8');

      // Sonraki il için sayfayı yenile
      await loadMebbisPage(page);

    } catch (err) {
      console.error(`   ❌ ${err.message}`);
      errors.push(`${cityName}: ${err.message}`);
      try { await loadMebbisPage(page); } catch {}
    }
  }

  // Final kaydet
  writeFileSync(OUTPUT_PATH, JSON.stringify(allData, null, 2), 'utf8');
  writeFileSync(join(__dirname, '../schools.json'), JSON.stringify(allData, null, 2), 'utf8');
  console.log(`\n💾 schools.json güncellendi`);

  if (firebaseDb) {
    try {
      await firebaseDb.ref('_meta/okullar_guncelleme').set({
        tarih: new Date().toISOString(), toplamOkul: totalSchools,
        toplamIl: processedCities,
        durum: errors.length === 0 ? 'tamamlandi' : 'hatalarla_tamamlandi',
        hatalar: errors.slice(0, 20),
      });
    } catch {}
  }

  await browser.close();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 Toplam: ${totalSchools.toLocaleString('tr-TR')} okul, ${processedCities} il`);
  if (errors.length > 0) {
    console.log(`⚠ ${errors.length} hata:`);
    errors.slice(0, 5).forEach(e => console.log(`  - ${e}`));
  }
  console.log(`${'═'.repeat(60)}\n`);
}

scrape().catch(err => { console.error('❌ Kritik hata:', err); process.exit(1); });
