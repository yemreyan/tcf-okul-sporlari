/**
 * One-time script to import referees from Excel (MAG) and Word (WAG) files.
 * Run: node scripts/import-referees.mjs
 */
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, set, get } from 'firebase/database';
import { createRequire } from 'module';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '../.env') });

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

// Firebase config — .env dosyasından oku
const firebaseConfig = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.VITE_FIREBASE_DATABASE_URL,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ── Parse Excel (MAG referees) ──────────────────────────────────
function parseExcel(filePath) {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

    const referees = [];
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        // Left side (cols 0-4)
        if (row[1]) {
            referees.push({
                adSoyad: String(row[1]).trim(),
                il: String(row[2] || '').trim(),
                brove: String(row[3] || '').trim(),
                telefon: String(row[4] || '').trim(),
                brans: 'MAG',
            });
        }
        // Right side (cols 6-10)
        if (row[7]) {
            referees.push({
                adSoyad: String(row[7]).trim(),
                il: String(row[8] || '').trim(),
                brove: String(row[9] || '').trim(),
                telefon: String(row[10] || '').trim(),
                brans: 'MAG',
            });
        }
    }
    return referees;
}

// ── Parse Word/Docx (WAG referees) ─────────────────────────────
function parseDocx(filePath) {
    const docXml = execSync(`unzip -p '${filePath}' word/document.xml`).toString();
    const rows = docXml.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [];
    const referees = [];

    for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].match(/<w:tc[\s\S]*?<\/w:tc>/g) || [];
        const cellTexts = cells.map(cell => {
            const ts = cell.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
            return ts.map(t => t.replace(/<[^>]+>/g, '')).join(' ').trim();
        });
        if (cellTexts[1]) {
            referees.push({
                adSoyad: cellTexts[1].trim(),
                il: (cellTexts[2] || '').trim(),
                brove: (cellTexts[3] || '').trim(),
                telefon: (cellTexts[4] || '').trim(),
                brans: 'WAG',
            });
        }
    }
    return referees;
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
    console.log('Parsing Excel (MAG)...');
    const magReferees = parseExcel('/Users/emre.yalciner/Downloads/ERKEK_HAKEM_UPDATED-2.xlsx');
    console.log(`  Found ${magReferees.length} MAG referees`);

    console.log('Parsing Word (WAG)...');
    const wagReferees = parseDocx('/Users/emre.yalciner/Downloads/KADIN_HAKEM_UPDATED-1 (1).docx');
    console.log(`  Found ${wagReferees.length} WAG referees`);

    const allReferees = [...magReferees, ...wagReferees];
    console.log(`\nTotal: ${allReferees.length} referees to import`);

    // Check existing referees to avoid duplicates
    console.log('\nChecking existing referees in Firebase...');
    const snapshot = await get(ref(db, 'referees'));
    const existing = snapshot.val() || {};
    const existingNames = new Set();
    Object.values(existing).forEach(r => {
        if (r.adSoyad) existingNames.add(r.adSoyad.toUpperCase().trim());
    });
    console.log(`  Found ${existingNames.size} existing referees`);

    // Filter out duplicates
    const newReferees = allReferees.filter(r => !existingNames.has(r.adSoyad.toUpperCase().trim()));
    const duplicates = allReferees.length - newReferees.length;
    if (duplicates > 0) {
        console.log(`  Skipping ${duplicates} duplicates`);
    }

    console.log(`  Will import ${newReferees.length} new referees\n`);

    if (newReferees.length === 0) {
        console.log('Nothing to import. All referees already exist.');
        process.exit(0);
    }

    // Import
    let success = 0;
    let fail = 0;
    for (const r of newReferees) {
        try {
            const newRef = push(ref(db, 'referees'));
            await set(newRef, {
                adSoyad: r.adSoyad,
                brans: r.brans,
                il: r.il,
                brove: r.brove,
                email: '',
                telefon: r.telefon,
                gorevSayisi: 0,
                gecmisYarismalar: {},
                createdAt: new Date().toISOString(),
            });
            success++;
            if (success % 20 === 0) console.log(`  Imported ${success}/${newReferees.length}...`);
        } catch (err) {
            fail++;
            console.error(`  FAILED: ${r.adSoyad} - ${err.message}`);
        }
    }

    console.log(`\nDone! Imported: ${success}, Failed: ${fail}`);
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
