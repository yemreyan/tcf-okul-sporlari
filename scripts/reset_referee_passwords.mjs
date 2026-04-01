/**
 * Hakem Şifrelerini Sıfırla ve CSV'ye Kaydet
 * Mevcut hakem hesaplarının şifrelerini yeniler ve CSV dosyasına yazar.
 */

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, update } from 'firebase/database';
import { createHash } from 'crypto';
import { writeFileSync } from 'fs';

const firebaseConfig = {
    apiKey: "AIzaSyDYtaWg0QdpuG_aAcGe2KrPpc3fhxmoKp4",
    authDomain: "okulsporlari-6db6e.firebaseapp.com",
    databaseURL: "https://okulsporlari-6db6e-default-rtdb.firebaseio.com",
    projectId: "okulsporlari-6db6e",
    appId: "1:445126405585:web:35e7f90397445670c13c998"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

function generatePassword() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let pwd = '';
    for (let i = 0; i < 6; i++) {
        pwd += chars[Math.floor(Math.random() * chars.length)];
    }
    return pwd;
}

function hashPassword(password) {
    return createHash('sha256').update(password).digest('hex');
}

async function main() {
    console.log('🔄 Firebase\'den hakemler okunuyor...');

    const refereesSnap = await get(ref(db, 'referees'));
    const referees = refereesSnap.val() || {};

    const refList = Object.entries(referees)
        .map(([id, r]) => ({ id, ...r }))
        .filter(r => r.hesapKullaniciAdi); // Hesabı olanlar

    console.log(`📊 Hesabı olan hakem: ${refList.length}`);

    const results = [];
    const updates = {};

    for (const referee of refList) {
        const username = referee.hesapKullaniciAdi;
        const password = generatePassword();
        const sifreHash = hashPassword(password);

        updates[`kullanicilar/${username}/sifreHash`] = sifreHash;

        results.push({
            adSoyad: referee.adSoyad,
            username,
            password,
            il: referee.il || '',
            brans: referee.brans || '',
            email: referee.email || '',
            telefon: referee.telefon || ''
        });
    }

    console.log(`📝 ${results.length} hakem şifresi güncelleniyor...`);
    await update(ref(db), updates);
    console.log('✅ Şifreler güncellendi!');

    // CSV kaydet
    const csvHeader = 'Ad Soyad,Kullanıcı Adı,Şifre,İl,Branş,Email,Telefon';
    const csvRows = results.map(r =>
        `"${r.adSoyad}","${r.username}","${r.password}","${r.il}","${r.brans}","${r.email}","${r.telefon}"`
    );
    const csvContent = [csvHeader, ...csvRows].join('\n');

    const outputPath = '/Users/emre.yalciner/Desktop/Aktif Cimnastik Sistemleri/TCF Okullar/new/hakem_hesaplari.csv';
    writeFileSync(outputPath, '\uFEFF' + csvContent, 'utf-8');

    console.log(`\n📄 Hesap bilgileri kaydedildi: ${outputPath}`);
    console.log('\n🔑 İlk 10 hesap:');
    results.slice(0, 10).forEach(r => {
        console.log(`   ${r.adSoyad.padEnd(35)} → ${r.username.padEnd(25)} / ${r.password}`);
    });
    console.log(`   ... ve ${results.length - 10} hesap daha.`);

    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
