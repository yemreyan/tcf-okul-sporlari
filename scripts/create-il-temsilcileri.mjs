/**
 * 81 İl Temsilcisi kullanıcısını Firebase'e toplu ekleyen script.
 *
 * Kullanım: node scripts/create-il-temsilcileri.mjs
 *
 * İzinler (kullanıcının ekran görüntüsünden):
 *   - Yarışmalar: Görüntüle
 *   - Başvurular: Görüntüle, Onayla, Reddet
 *   - Canlı Skor: Görüntüle
 *   - Finaller: Görüntüle
 *   - Çıkış Sırası: Görüntüle, Düzenle, PDF
 */

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get } from 'firebase/database';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Firebase config
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

// SHA-256 hash (same as AuthContext.jsx)
function hashPassword(password) {
    return createHash('sha256').update(password).digest('hex');
}

// Generate simple 6-digit password
function generatePassword() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

// Turkish city name -> username (lowercase, replace special chars)
function cityToUsername(city) {
    return city
        .toLocaleLowerCase('tr-TR')
        .replace(/ç/g, 'c')
        .replace(/ğ/g, 'g')
        .replace(/ı/g, 'i')
        .replace(/ö/g, 'o')
        .replace(/ş/g, 's')
        .replace(/ü/g, 'u')
        .replace(/â/g, 'a')
        .replace(/î/g, 'i')
        .replace(/û/g, 'u')
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
}

// İl Temsilcisi permissions
function createIlTemsilcisiPermissions() {
    const perms = {
        competitions: { goruntule: true, olustur: false, duzenle: false, sil: false },
        applications: { goruntule: true, onayla: true, reddet: true },
        athletes: { goruntule: false, ekle: false, duzenle: false, sil: false },
        scoring: { goruntule: false, puanla: false },
        criteria: { goruntule: false, duzenle: false },
        referees: { goruntule: false, ekle: false, duzenle: false, sil: false },
        scoreboard: { goruntule: true },
        finals: { goruntule: true, duzenle: false },
        analytics: { goruntule: false },
        start_order: { goruntule: true, duzenle: true, pdf: true },
        links: { goruntule: false },
        official_report: { goruntule: false, duzenle: false, sil: false },
    };
    return perms;
}

async function main() {
    // Load turkey_data.json
    const turkeyData = JSON.parse(readFileSync(join(__dirname, '../src/data/turkey_data.json'), 'utf-8'));
    const cities = Object.keys(turkeyData).sort((a, b) => a.localeCompare(b, 'tr-TR'));

    console.log(`\n📋 ${cities.length} İl Temsilcisi oluşturulacak...\n`);

    const credentials = [];
    let created = 0;
    let skipped = 0;

    for (const city of cities) {
        const username = cityToUsername(city);
        const password = generatePassword();

        // Check if user already exists
        const userRef = ref(db, `kullanicilar/${username}`);
        const snap = await get(userRef);

        if (snap.exists()) {
            console.log(`⏭️  ${username} (${city}) zaten mevcut, atlanıyor.`);
            skipped++;
            continue;
        }

        const userData = {
            sifreHash: hashPassword(password),
            rolAdi: 'İl Temsilcisi',
            il: city,
            aktif: true,
            izinler: createIlTemsilcisiPermissions(),
            olusturmaTarihi: new Date().toISOString(),
        };

        await set(userRef, userData);
        credentials.push({ il: city, kullaniciAdi: username, sifre: password });
        created++;
        console.log(`✅ ${username} (${city}) oluşturuldu`);
    }

    console.log(`\n📊 Sonuç: ${created} oluşturuldu, ${skipped} atlandı\n`);

    if (credentials.length > 0) {
        // Save credentials to file
        const outputPath = join(__dirname, '../il-temsilcileri-sifreler.txt');
        const lines = [
            'İL TEMSİLCİLERİ GİRİŞ BİLGİLERİ',
            '='.repeat(50),
            `Oluşturulma Tarihi: ${new Date().toLocaleString('tr-TR')}`,
            '',
            'İl | Kullanıcı Adı | Şifre',
            '-'.repeat(50),
            ...credentials.map(c => `${c.il} | ${c.kullaniciAdi} | ${c.sifre}`),
        ];

        const { writeFileSync } = await import('fs');
        writeFileSync(outputPath, lines.join('\n'), 'utf-8');
        console.log(`🔑 Şifreler kaydedildi: ${outputPath}`);
        console.log(`⚠️  Bu dosyayı güvenli bir yerde saklayın ve git'e eklemeyin!\n`);
    }

    process.exit(0);
}

main().catch(err => {
    console.error('Hata:', err);
    process.exit(1);
});
