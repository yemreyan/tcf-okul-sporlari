/**
 * TCF Resmi Yarışma Programı PDF — v2 (Blok bazlı planlama)
 * Sade, doğal renk paleti. Beyaz zemin + tek koyu vurgu rengi.
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const W = 210, H = 297;
const ML = 16, MR = 16, MT = 14, MB = 16;
const CW = W - ML - MR;

// Sade ve doğal palet: beyaz zemin, koyu lacivert metin, tek altın vurgu
const C = {
    ink: [30, 41, 59],        // koyu lacivert metin
    body: [71, 85, 105],      // gövde metin
    muted: [100, 116, 139],   // ikincil
    faint: [148, 163, 184],   // çok soluk
    border: [226, 232, 240],  // ince çizgi
    softBg: [248, 250, 252],  // çok soluk gri
    accent: [120, 95, 50],    // koyu altın/bronz — tek vurgu
    accentSoft: [250, 245, 230], // krem
    gold: [180, 142, 70],
    white: [255, 255, 255],
};

const TR_MAP = { 304: 'I', 305: 'i', 286: 'G', 287: 'g', 350: 'S', 351: 's', 214: 'O', 246: 'o', 220: 'U', 252: 'u', 199: 'C', 231: 'c' };
function tr(t) { return String(t ?? '').split('').map(c => TR_MAP[c.charCodeAt(0)] ?? c).join(''); }

const ALET_MAP = { atlama: 'Atlama', barfiks: 'Barfiks', halka: 'Halka', kulplu: 'Kulplu Beygir', mantar: 'Mantar Beygir', paralel: 'Paralel', yer: 'Yer', denge: 'Denge', asimetrik: 'Asimetrik Paralel', serbest: 'Serbest', sirik: 'Sirik', top: 'Top', kurdele: 'Kurdele' };
const aletL = (k) => tr(ALET_MAP[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : ''));
const catL = (k) => tr(k ? k.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '');

const DAY_NAMES = ['Pazar', 'Pazartesi', 'Sali', 'Carsamba', 'Persembe', 'Cuma', 'Cumartesi'];
const MONTH_NAMES = ['Ocak', 'Subat', 'Mart', 'Nisan', 'Mayis', 'Haziran', 'Temmuz', 'Agustos', 'Eylul', 'Ekim', 'Kasim', 'Aralik'];

function fmtDayLong(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d)) return dateStr;
    return `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

async function loadLogo() {
    try {
        const r = await fetch('/logo.png');
        if (!r.ok) return null;
        const b = await r.blob();
        return new Promise(res => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.onerror = () => res(null);
            fr.readAsDataURL(b);
        });
    } catch { return null; }
}

function fillRect(doc, x, y, w, h, color) {
    doc.setFillColor(...color); doc.rect(x, y, w, h, 'F');
}
function strokeRect(doc, x, y, w, h, color, lw = 0.2) {
    doc.setDrawColor(...color); doc.setLineWidth(lw); doc.rect(x, y, w, h, 'S');
}
function hLine(doc, x, y, w, color, lw = 0.2) {
    doc.setDrawColor(...color); doc.setLineWidth(lw); doc.line(x, y, x + w, y);
}
function txt(doc, text, x, y, opts = {}) {
    const { size = 8, color = C.ink, bold = false, align = 'left', maxWidth } = opts;
    doc.setFontSize(size); doc.setTextColor(...color);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const o = { align }; if (maxWidth) o.maxWidth = maxWidth;
    doc.text(tr(String(text)), x, y, o);
}

// athlete lookup helper
function athleteInfo(comp, catKey, id) {
    const a = comp?.sporcular?.[catKey]?.[id];
    if (!a) return { name: '', okul: '', tur: '', missing: true };
    const ad = String(a.ad || '').trim();
    const soyad = String(a.soyad || '').trim();
    const name = `${ad} ${soyad}`.trim();
    const okul = String(a.okul || a.kulup || '').trim();
    const tur = String(a.yarismaTuru || a.tip || '').trim().toLowerCase();
    const turLabel = tur === 'takim' ? 'Takim' : (tur === 'ferdi' ? 'Ferdi' : '');
    return { name, okul, tur: turLabel, missing: !name };
}

/* ── ANA EXPORT ─────────────────────────────────────────────────────── */
export async function generateSchedulePDFv2({ comp, days, sessions, daySettings, kategoriler, athleteCounts }) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const logo = await loadLogo();
    let pageNum = 1;
    let y = MT;

    const drawFooter = () => {
        hLine(doc, ML, H - MB, CW, C.border, 0.2);
        txt(doc, 'Turkiye Cimnastik Federasyonu', ML, H - 8, { size: 6.5, color: C.faint });
        txt(doc, `Sayfa ${pageNum}`, W / 2, H - 8, { size: 6.5, color: C.muted, align: 'center' });
        txt(doc, new Date().toLocaleDateString('tr-TR'), W - MR, H - 8, { size: 6.5, color: C.faint, align: 'right' });
    };
    const drawMiniHeader = () => {
        if (logo) doc.addImage(logo, 'PNG', ML, MT - 2, 7, 7);
        txt(doc, 'TURKIYE CIMNASTIK FEDERASYONU', ML + (logo ? 9 : 0), MT + 1, { size: 6.5, color: C.muted, bold: true });
        txt(doc, tr((comp?.isim || '').toUpperCase()), W - MR, MT + 1, {
            size: 7.5, color: C.ink, bold: true, align: 'right', maxWidth: 130,
        });
        hLine(doc, ML, MT + 4, CW, C.border, 0.2);
        // tek altın vurgu çubuğu
        fillRect(doc, ML, MT + 4, 16, 0.6, C.gold);
        y = MT + 11;
    };
    const ensureSpace = (n) => {
        if (y + n > H - MB - 8) {
            drawFooter(); doc.addPage(); pageNum++; drawMiniHeader();
        }
    };

    /* ── KAPAK ── (sade, beyaz zemin) */
    if (logo) doc.addImage(logo, 'PNG', ML, 30, 22, 22);
    else {
        doc.setDrawColor(...C.gold); doc.setLineWidth(0.8);
        doc.circle(ML + 11, 41, 11, 'S');
        txt(doc, 'TCF', ML + 11, 44, { size: 11, color: C.gold, bold: true, align: 'center' });
    }
    txt(doc, 'TURKIYE CIMNASTIK FEDERASYONU', ML + 28, 35, { size: 9, color: C.muted, bold: true });
    txt(doc, 'Resmi Yarisma Programi', ML + 28, 41, { size: 7.5, color: C.faint });
    fillRect(doc, ML, 55, 40, 0.8, C.gold);
    txt(doc, tr((comp?.isim || '').toUpperCase()), ML, 65, {
        size: 17, color: C.ink, bold: true, maxWidth: CW,
    });
    if (comp?.il) txt(doc, tr(comp.il), ML, 73, { size: 11, color: C.body });
    const dateRangeText = days.length ? `${fmtDayLong(days[0])} — ${fmtDayLong(days[days.length - 1])}` : '';
    txt(doc, dateRangeText, ML, 79, { size: 9, color: C.muted });

    y = 92;

    /* ── ÖZET ── */
    const totalSessions = Object.keys(sessions || {}).length;
    const cats = new Set();
    const catBlockCounts = {};
    Object.values(sessions || {}).forEach(s => {
        if (!s) return;
        cats.add(s.kategori);
        catBlockCounts[s.kategori] = Math.max(catBlockCounts[s.kategori] || 0, s.toplamBlok || 0);
    });

    const stats = [
        ['KATEGORI', String(cats.size)],
        ['GUN', String(days.length)],
        ['OTURUM', String(totalSessions)],
        ['TOPLAM BLOK', String(Object.values(catBlockCounts).reduce((a, b) => a + b, 0))],
    ];
    const sw = CW / stats.length;
    stats.forEach(([lab, val], i) => {
        const sx = ML + sw * i;
        txt(doc, lab, sx, y, { size: 6.5, color: C.muted, bold: true });
        txt(doc, val, sx, y + 9, { size: 16, color: C.ink, bold: true });
    });
    y += 16;
    hLine(doc, ML, y, CW, C.border, 0.2);
    y += 6;

    /* ── KATEGORİ LİSTESİ ── */
    if (cats.size > 0) {
        txt(doc, 'KATEGORILER', ML, y, { size: 7.5, color: C.muted, bold: true });
        y += 3;
        const catBody = Array.from(cats).map(ck => {
            const aletler = (kategoriler?.[ck]?.aletler || []).map(aletL).join(', ');
            return [catL(ck), String(athleteCounts?.[ck] ?? '?'), String(catBlockCounts[ck] || 0), aletler];
        });
        autoTable(doc, {
            startY: y,
            head: [['KATEGORI', 'SPORCU', 'BLOK', 'ALETLER'].map(tr)],
            body: catBody.map(r => r.map(tr)),
            margin: { left: ML, right: MR },
            styles: { font: 'helvetica', fontSize: 8.5, cellPadding: [2.4, 3.5, 2.4, 3.5], lineColor: C.border, lineWidth: 0.15, textColor: C.body },
            theme: 'plain',
            headStyles: { fillColor: C.white, textColor: C.muted, fontStyle: 'bold', fontSize: 7, lineColor: C.border, lineWidth: 0.3 },
            columnStyles: {
                0: { fontStyle: 'bold', textColor: C.ink, cellWidth: 52 },
                1: { halign: 'center', cellWidth: 22 },
                2: { halign: 'center', cellWidth: 22 },
            },
        });
        y = (doc.lastAutoTable?.finalY ?? y) + 4;
    }
    drawFooter();

    /* ── GÜN BAZLI SAYFALAR ── */
    days.forEach((dateStr, gunIdx) => {
        const daySessions = Object.values(sessions || {})
            .filter(s => s && (s.gunIndex === gunIdx || s.tarih === dateStr))
            .sort((a, b) => (a.baslangic || a.saat || '').localeCompare(b.baslangic || b.saat || ''));
        if (!daySessions.length) return;

        doc.addPage(); pageNum++; drawMiniHeader();
        ensureSpace(16);

        const ds = daySettings?.[gunIdx] || {};
        const dayLabel = fmtDayLong(dateStr);
        const window = (ds.baslangic && ds.bitis) ? `${ds.baslangic} - ${ds.bitis}` : '';

        // Sade gün başlığı — beyaz, alta ince altın çizgi
        txt(doc, `${gunIdx + 1}. GUN`, ML, y, { size: 7, color: C.gold, bold: true });
        txt(doc, dayLabel, ML, y + 7, { size: 12, color: C.ink, bold: true });
        if (window) txt(doc, window, W - MR, y + 2, { size: 8.5, color: C.body, align: 'right' });
        txt(doc, `${daySessions.length} oturum`, W - MR, y + 7, { size: 8, color: C.muted, align: 'right' });
        y += 11;
        fillRect(doc, ML, y, 24, 0.6, C.gold);
        hLine(doc, ML + 24, y + 0.3, CW - 24, C.border, 0.2);
        y += 5;

        // Her kategori ayrı kart
        for (const sess of daySessions) {
            const blocks = sess.bugünBloklar || [];
            const aletler = (sess.aletler || []).map(aletL).join(' / ');
            const grupEtiketleri = sess.grupEtiketleri || (sess.gruplar || []).map((_, i) => String(i + 1));
            const K = (sess.aletler || []).length;

            ensureSpace(20 + Math.min(blocks.length, 12) * 6);

            // Kategori başlığı — beyaz zemin, ince üst çizgi
            hLine(doc, ML, y, CW, C.ink, 0.4);
            y += 4;
            txt(doc, catL(sess.kategori).toUpperCase(), ML, y, { size: 11, color: C.ink, bold: true });
            const headerR = [];
            headerR.push(`${sess.baslangic || sess.saat || ''} - ${sess.bitis || sess.bitisSaat || ''}`);
            headerR.push(`${sess.sporcuSayisi ?? '?'} sporcu`);
            if (sess.çokGünlü) headerR.push(`${sess.günSira}/${sess.günToplam}. gun`);
            txt(doc, headerR.join('  ·  '), W - MR, y, { size: 8, color: C.body, align: 'right' });
            y += 4;
            txt(doc, `Aletler: ${aletler}`, ML, y, { size: 7.5, color: C.muted });
            y += 4;

            // Blok tablosu
            const blockRows = blocks.map((b, i) => {
                const groupLabels = [];
                for (let g = 0; g < K; g++) {
                    const gIdx = b.bIdx * K + g;
                    if (gIdx < grupEtiketleri.length) groupLabels.push(grupEtiketleri[gIdx]);
                }
                return [
                    `Blok ${b.bIdx + 1}`,
                    `${b.baslangic} - ${b.bitis}`,
                    groupLabels.map(g => `Grup ${g}`).join(', '),
                ];
            });
            autoTable(doc, {
                startY: y,
                head: [['BLOK', 'SAAT', 'GRUPLAR (PARALEL)'].map(tr)],
                body: blockRows.map(r => r.map(tr)),
                margin: { left: ML, right: MR },
                styles: { font: 'helvetica', fontSize: 8.5, cellPadding: [2.2, 3, 2.2, 3], lineColor: C.border, lineWidth: 0.15, textColor: C.body },
                theme: 'plain',
                headStyles: { fillColor: C.white, textColor: C.muted, fontStyle: 'bold', fontSize: 7, lineColor: C.border, lineWidth: 0.3 },
                columnStyles: {
                    0: { fontStyle: 'bold', textColor: C.ink, cellWidth: 22, halign: 'center' },
                    1: { cellWidth: 32, halign: 'center', fontStyle: 'bold', textColor: C.ink },
                },
            });
            y = (doc.lastAutoTable?.finalY ?? y) + 5;
            ensureSpace(6);
        }
        drawFooter();
    });

    /* ── TÜM GRUPLAR (kategorilere göre, gerçek isimlerle) ── */
    const groupsByCat = {};
    Object.values(sessions || {}).forEach(s => {
        if (!s) return;
        if (groupsByCat[s.kategori]) return;
        if (Array.isArray(s.gruplar) && s.gruplar.length) {
            groupsByCat[s.kategori] = {
                gruplar: s.gruplar,
                grupEtiketleri: s.grupEtiketleri || s.gruplar.map((_, i) => String(i + 1)),
            };
        }
    });
    if (Object.keys(groupsByCat).length) {
        doc.addPage(); pageNum++; drawMiniHeader();
        txt(doc, 'TUM GRUPLAR', ML, y, { size: 12, color: C.ink, bold: true });
        y += 4;
        fillRect(doc, ML, y, 24, 0.6, C.gold);
        y += 6;

        for (const [ck, info] of Object.entries(groupsByCat)) {
            ensureSpace(14);
            hLine(doc, ML, y, CW, C.border, 0.3);
            y += 4;
            const totalAth = info.gruplar.reduce((a, ids) => a + ids.length, 0);
            const missingCount = info.gruplar.reduce((acc, ids) => acc + ids.filter(id => athleteInfo(comp, ck, id).missing).length, 0);
            txt(doc, catL(ck).toUpperCase(), ML, y, { size: 9.5, color: C.ink, bold: true });
            const rightInfo = `${info.gruplar.length} grup · ${totalAth} sporcu` + (missingCount ? `  ·  ${missingCount} EKSIK` : '');
            txt(doc, rightInfo, W - MR, y, { size: 8, color: missingCount ? [180, 70, 70] : C.muted, align: 'right' });
            y += 4;

            // Düz tablo: her sporcu bir satır
            const rows = [];
            info.gruplar.forEach((ids, gi) => {
                const label = info.grupEtiketleri[gi] ?? (gi + 1);
                if (!ids || !ids.length) {
                    rows.push([`Grup ${label}`, '—', '— (bos)', '', '']);
                    return;
                }
                ids.forEach((id, ai) => {
                    const inf = athleteInfo(comp, ck, id);
                    rows.push([
                        ai === 0 ? `Grup ${label}` : '',
                        String(ai + 1),
                        inf.name || `(eksik: ${String(id).slice(-6)})`,
                        inf.okul,
                        inf.tur,
                    ]);
                });
            });

            autoTable(doc, {
                startY: y,
                head: [['GRUP', '#', 'AD SOYAD', 'OKUL', 'TUR'].map(tr)],
                body: rows.map(r => r.map(tr)),
                margin: { left: ML, right: MR },
                styles: { font: 'helvetica', fontSize: 7.8, cellPadding: [1.4, 2.5, 1.4, 2.5], lineColor: C.border, lineWidth: 0.12, textColor: C.body, overflow: 'linebreak' },
                theme: 'plain',
                headStyles: { fillColor: C.white, textColor: C.muted, fontStyle: 'bold', fontSize: 7, lineColor: C.border, lineWidth: 0.3 },
                columnStyles: {
                    0: { fontStyle: 'bold', textColor: C.ink, cellWidth: 22 },
                    1: { halign: 'center', cellWidth: 8, textColor: C.muted },
                    2: { cellWidth: 60, textColor: C.ink },
                    3: { cellWidth: 'auto' },
                    4: { halign: 'center', cellWidth: 16, textColor: C.muted },
                },
                didParseCell: (data) => {
                    // grup ayraçları: yeni grup başlangıcında üst çizgi
                    if (data.section === 'body' && data.column.index === 0 && data.cell.raw && String(data.cell.raw).startsWith('Grup ')) {
                        if (data.row.index > 0) data.cell.styles.lineWidth = 0.0;
                    }
                    if (data.section === 'body' && data.row.index > 0 && data.column.index === 0 && data.cell.raw && String(data.cell.raw).startsWith('Grup ')) {
                        // ince üst ayraç
                        data.cell.styles.fontStyle = 'bold';
                    }
                    // eksik sporcu vurgusu
                    if (data.section === 'body' && data.column.index === 2 && typeof data.cell.raw === 'string' && data.cell.raw.startsWith('(eksik')) {
                        data.cell.styles.textColor = [180, 70, 70];
                        data.cell.styles.fontStyle = 'italic';
                    }
                },
                didDrawCell: (data) => {
                    // Yeni grup üstüne ince ayırıcı çizgi
                    if (data.section === 'body' && data.column.index === 0 && data.row.index > 0 &&
                        data.cell.raw && String(data.cell.raw).startsWith('Grup ')) {
                        doc.setDrawColor(...C.gold);
                        doc.setLineWidth(0.25);
                        doc.line(data.cell.x, data.cell.y, data.cell.x + CW, data.cell.y);
                    }
                },
            });
            y = (doc.lastAutoTable?.finalY ?? y) + 6;
        }
        drawFooter();
    }

    const safeName = String(comp?.isim || 'program').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
    doc.save(`TCF_${safeName}_Program.pdf`);
}
