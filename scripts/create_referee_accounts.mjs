/**
 * Toplu Hakem Hesabı Oluşturma Scripti
 * 239 hakem için kullanıcı adı + şifre oluşturur ve Firebase'e yazar.
 * Sonuçları CSV dosyasına kaydeder.
 */

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, update } from 'firebase/database';
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

// Türkçe → ASCII
function turkishToAscii(str) {
    const map = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u',
                  'Ç': 'c', 'Ğ': 'g', 'İ': 'i', 'Ö': 'o', 'Ş': 's', 'Ü': 'u',
                  'â': 'a', 'Â': 'a', 'î': 'i', 'Î': 'i', 'û': 'u', 'Û': 'u' };
    return str.replace(/[çğıöşüÇĞİÖŞÜâÂîÎûÛ]/g, c => map[c] || c);
}

// Ad soyad → kullanıcı adı
function generateUsername(adSoyad) {
    const cleaned = turkishToAscii(adSoyad.trim().toLowerCase());
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'hakem';
    if (parts.length === 1) return parts[0].replace(/[^a-z0-9]/g, '');
    const ad = parts[0].replace(/[^a-z0-9]/g, '');
    const soyad = parts[parts.length - 1].replace(/[^a-z0-9]/g, '');
    return `${ad}_${soyad}`;
}

// 6 karakter rastgele şifre
function generatePassword() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let pwd = '';
    for (let i = 0; i < 6; i++) {
        pwd += chars[Math.floor(Math.random() * chars.length)];
    }
    return pwd;
}

// SHA-256 hash (browser crypto.subtle ile aynı sonucu verir)
function hashPassword(password) {
    return createHash('sha256').update(password).digest('hex');
}

// Hakem izinleri
function createRefereePermissions() {
    return {
        competitions: { goruntule: true, olustur: false, duzenle: false, sil: false },
        applications: { goruntule: false, onayla: false, reddet: false },
        athletes: { goruntule: true, ekle: false, duzenle: false, sil: false },
        scoring: { goruntule: true, puanla: true },
        criteria: { goruntule: true, duzenle: false },
        referees: { goruntule: false, ekle: false, duzenle: false, sil: false },
        scoreboard: { goruntule: true },
        finals: { goruntule: true, duzenle: false },
        analytics: { goruntule: false },
        start_order: { goruntule: true, duzenle: false, pdf: false },
        links: { goruntule: true },
        official_report: { goruntule: false, duzenle: false, sil: false },
    };
}

async function main() {
    console.log('🔄 Firebase\'den hakemler ve mevcut kullanıcılar okunuyor...');

    const refereesSnap = await get(ref(db, 'referees'));
    const usersSnap = await get(ref(db, 'kullanicilar'));

    const referees = refereesSnap.val() || {};
    const existingUsers = usersSnap.val() || {};

    const refList = Object.entries(referees)
        .map(([id, r]) => ({ id, ...r }))
        .filter(r => !r.hesapKullaniciAdi); // Hesabı olmayanlar

    console.log(`📊 Toplam hakem: ${Object.keys(referees).length}`);
    console.log(`📊 Hesabı olmayan: ${refList.length}`);

    if (refList.length === 0) {
        console.log('✅ Tüm hakemlerin zaten hesabı var.');
        process.exit(0);
    }

    const usedUsernames = new Set(Object.keys(existingUsers));
    const results = [];
    const updates = {};
    let success = 0;
    let fail = 0;

    for (const referee of refList) {
        try {
            // Benzersiz username oluştur
            let base = generateUsername(referee.adSoyad || 'hakem');
            let username = base;
            let i = 2;
            while (usedUsernames.has(username)) {
                username = `${base}${i}`;
                i++;
            }
            usedUsernames.add(username);

            const password = generatePassword();
            const sifreHash = hashPassword(password);

            // Kullanıcı verisi
            updates[`kullanicilar/${username}`] = {
                rolAdi: 'Hakem',
                il: referee.il || null,
                aktif: true,
                izinler: createRefereePermissions(),
                sifreHash,
                olusturmaTarihi: new Date().toISOString(),
                hakemId: referee.id,
            };

            // Hakem kaydına username bağla
            updates[`referees/${referee.id}/hesapKullaniciAdi`] = username;

            results.push({
                adSoyad: referee.adSoyad,
                username,
                password,
                il: referee.il || '',
                brans: referee.brans || '',
                status: 'OK'
            });

            success++;
        } catch (err) {
            console.error(`❌ ${referee.adSoyad}: ${err.message}`);
            results.push({
                adSoyad: referee.adSoyad,
                username: '-',
                password: '-',
                il: referee.il || '',
                brans: referee.brans || '',
                status: 'HATA'
            });
            fail++;
        }
    }

    console.log(`\n📝 Firebase'e yazılıyor (${success} hesap)...`);

    // Tek seferde tüm update'leri yaz
    await update(ref(db), updates);

    console.log(`✅ Tamamlandı! Başarılı: ${success}, Başarısız: ${fail}`);

    // CSV dosyasına kaydet
    const csvHeader = 'Ad Soyad,Kullanıcı Adı,Şifre,İl,Branş,Durum';
    const csvRows = results.map(r =>
        `"${r.adSoyad}","${r.username}","${r.password}","${r.il}","${r.brans}","${r.status}"`
    );
    const csvContent = [csvHeader, ...csvRows].join('\n');

    const outputPath = '/Users/emre.yalciner/Desktop/Aktif Cimnastik Sistemleri/TCF Okullar/new/hakem_hesaplari.csv';
    writeFileSync(outputPath, '\uFEFF' + csvContent, 'utf-8'); // BOM for Excel Turkish

    console.log(`\n📄 Hesap bilgileri kaydedildi: ${outputPath}`);
    console.log('\n🔑 İlk 5 hesap:');
    results.slice(0, 5).forEach(r => {
        console.log(`   ${r.adSoyad} → ${r.username} / ${r.password}`);
    });

    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
