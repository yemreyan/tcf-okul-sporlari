#!/usr/bin/env node
/**
 * schools.json → Firebase RTDB aktarma scripti
 * 
 * Firebase client SDK kullanır (Admin SDK service account gerekmez)
 * 
 * Kullanım:
 *   node scripts/upload-schools-to-firebase.mjs
 *   node scripts/upload-schools-to-firebase.mjs --il ANKARA    # Sadece bir il
 */

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, update } from 'firebase/database';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const firebaseConfig = {
  apiKey: "AIzaSyDYtaWg0QdpuG_aAcGe2KrPpc3fhxmoKp4",
  authDomain: "okulsporlari-6db6e.firebaseapp.com",
  databaseURL: "https://okulsporlari-6db6e-default-rtdb.firebaseio.com",
  projectId: "okulsporlari-6db6e",
  storageBucket: "okulsporlari-6db6e.firebasestorage.app",
  messagingSenderId: "445126405585",
  appId: "1:445126405585:web:35e7f90397445670c13c998",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const args = process.argv.slice(2);
const singleIl = args.includes('--il') ? args[args.indexOf('--il') + 1]?.toUpperCase() : null;

async function upload() {
  console.log('\n🔥 schools.json → Firebase RTDB aktarma');
  console.log('═'.repeat(50));

  const schoolsPath = join(__dirname, '../public/data/schools.json');
  const data = JSON.parse(readFileSync(schoolsPath, 'utf8'));
  let cities = Object.keys(data);

  if (singleIl) {
    cities = cities.filter(c => c.toLocaleUpperCase('tr-TR').includes(singleIl));
    console.log(`🎯 Tek il: ${cities.join(', ')}`);
  }

  console.log(`📋 ${cities.length} il aktarılacak\n`);

  let totalSchools = 0;
  let processedCities = 0;

  for (const city of cities) {
    processedCities++;
    const cityData = data[city];
    const updates = {};

    Object.entries(cityData).forEach(([district, schools]) => {
      updates[`okullar/${city}/${district}`] = schools;
      totalSchools += schools.length;
    });

    try {
      await update(ref(db), updates);
      const ilceCount = Object.keys(cityData).length;
      const okulCount = Object.values(cityData).reduce((s, a) => s + a.length, 0);
      console.log(`[${processedCities}/${cities.length}] ✓ ${city}: ${ilceCount} ilçe, ${okulCount} okul`);
    } catch (err) {
      console.error(`[${processedCities}/${cities.length}] ❌ ${city}: ${err.message}`);
    }
  }

  // Meta güncelle
  try {
    await update(ref(db), {
      '_meta/okullar_guncelleme': {
        tarih: new Date().toISOString(),
        toplamOkul: totalSchools,
        toplamIl: processedCities,
        durum: 'tamamlandi',
        kaynak: 'schools.json upload',
      }
    });
  } catch {}

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 ${totalSchools.toLocaleString('tr-TR')} okul, ${processedCities} il aktarıldı`);
  console.log(`${'═'.repeat(50)}\n`);

  process.exit(0);
}

upload().catch(err => {
  console.error('❌ Hata:', err);
  process.exit(1);
});
