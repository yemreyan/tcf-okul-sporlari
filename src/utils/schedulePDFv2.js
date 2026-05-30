/**
 * TCF Resmi Yarışma Programı PDF — v2 (Blok bazlı planlama)
 * Yeni planlama mantığına uygun: kategoriler paralel platformlarda,
 * her kategori K alet × K rotasyon = 1 blok; bloklar günlere yayılabilir.
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const W = 210, H = 297;
const ML = 14, MR = 14, MT = 14, MB = 16;
const CW = W - ML - MR;

const C = {
    ink: [15, 23, 42], body: [51, 65, 85], muted: [100, 116, 139],
    faint: [148, 163, 184], border: [226, 232, 240], surface: [248, 250, 252],
    indigo: [79, 70, 229], indigoBg: [238, 237, 254],
    indigoDk: [49, 46, 129], white: [255, 255, 255],
    gold: [212, 175, 55],
    teal: [13, 148, 136], tealBg: [240, 253, 250],
    amber: [180, 100, 5], amberBg: [255, 251, 235],
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
function strokeRect(doc, x, y, w, h, color, lw = 0.3) {
    doc.setDrawColor(...color); doc.setLineWidth(lw); doc.rect(x, y, w, h, 'S');
}
function hLine(doc, x, y, w, color, lw = 0.3) {
    doc.setDrawColor(...color); doc.setLineWidth(lw); doc.line(x, y, x + w, y);
}
function txt(doc, text, x, y, opts = {}) {
    const { size = 8, color = C.ink, bold = false, align = 'left', maxWidth } = opts;
    doc.setFontSize(size); doc.setTextColor(...color);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const o = { align }; if (maxWidth) o.maxWidth = maxWidth;
    doc.text(tr(String(text)), x, y, o);
}

/* ── ANA EXPORT ─────────────────────────────────────────────────────── */
export async function generateSchedulePDFv2({ comp, days, sessions, daySettings, kategoriler, athleteCounts }) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const logo = await loadLogo();
    let pageNum = 1;
    let y = MT;

    const drawFooter = () => {
        hLine(doc, 0, H - MB, W, C.border, 0.3);
        fillRect(doc, 0, H - MB + 0.3, W, MB - 0.3, C.surface);
        fillRect(doc, 0, H - MB, ML, 0.8, C.gold);
        txt(doc, 'Turkiye Cimnastik Federasyonu', ML, H - 4, { size: 6.5, color: C.faint });
        txt(doc, `Sayfa ${pageNum}`, W / 2, H - 4, { size: 6.5, color: C.muted, align: 'center' });
        txt(doc, new Date().toLocaleDateString('tr-TR'), W - MR, H - 4, { size: 6.5, color: C.faint, align: 'right' });
    };
    const drawMiniHeader = () => {
        fillRect(doc, 0, 0, W, 11, C.indigo);
        fillRect(doc, 0, 0, 4, 11, C.indigoDk);
        fillRect(doc, 4, 10.5, W - 4, 0.5, C.gold);
        if (logo) doc.addImage(logo, 'PNG', ML, 1.5, 7.5, 7.5);
        txt(doc, 'TURKIYE CIMNASTIK FEDERASYONU', ML + 10, 5, { size: 6, color: [180, 180, 230] });
        txt(doc, tr((comp?.isim || '').toUpperCase()), W - MR, 7, {
            size: 7.5, color: C.white, bold: true, align: 'right', maxWidth: 130,
        });
        y = 15;
    };
    const ensureSpace = (n) => {
        if (y + n > H - MB - 12) {
            drawFooter(); doc.addPage(); pageNum++; drawMiniHeader();
        }
    };

    /* ── KAPAK ── */
    fillRect(doc, 0, 0, W, 60, C.indigo);
    fillRect(doc, 0, 0, 5, 60, C.indigoDk);
    fillRect(doc, 0, 60, W, 0.8, C.gold);
    if (logo) doc.addImage(logo, 'PNG', ML + 2, 8, 36, 36);
    else {
        doc.setDrawColor(...C.gold); doc.setLineWidth(1.2);
        doc.circle(ML + 20, 26, 14, 'S');
        txt(doc, 'TCF', ML + 20, 29, { size: 12, color: C.gold, bold: true, align: 'center' });
    }
    txt(doc, 'TURKIYE CIMNASTIK FEDERASYONU', ML + 46, 18, { size: 9.5, color: [190, 185, 240], bold: true });
    txt(doc, 'Resmi Yarisma Programi', ML + 46, 25, { size: 7.5, color: [160, 155, 210] });
    txt(doc, tr((comp?.isim || '').toUpperCase()), ML + 46, 38, {
        size: 14, color: C.white, bold: true, maxWidth: W - ML - 46 - MR,
    });
    if (comp?.il) txt(doc, tr(comp.il), ML + 46, 47, { size: 9.5, color: [200, 200, 240] });
    const dateRangeText = days.length ? `${fmtDayLong(days[0])} — ${fmtDayLong(days[days.length - 1])}` : '';
    txt(doc, dateRangeText, ML + 46, 53, { size: 8.5, color: [200, 200, 240] });

    y = 70;

    /* ── ÖZET ── */
    const totalSessions = Object.keys(sessions || {}).length;
    const cats = new Set();
    const catBlockCounts = {};
    Object.values(sessions || {}).forEach(s => {
        if (!s) return;
        cats.add(s.kategori);
        catBlockCounts[s.kategori] = Math.max(catBlockCounts[s.kategori] || 0, s.toplamBlok || 0);
    });

    fillRect(doc, ML, y, CW, 22, C.surface);
    strokeRect(doc, ML, y, CW, 22, C.border);
    fillRect(doc, ML, y, 3, 22, C.indigo);
    const cw = (CW - 3) / 4;
    const cellY = y + 8;
    txt(doc, 'KATEGORI', ML + 6, y + 5, { size: 6.5, color: C.muted, bold: true });
    txt(doc, String(cats.size), ML + 6, cellY + 6, { size: 18, color: C.indigo, bold: true });
    txt(doc, 'GUN', ML + 6 + cw, y + 5, { size: 6.5, color: C.muted, bold: true });
    txt(doc, String(days.length), ML + 6 + cw, cellY + 6, { size: 18, color: C.indigo, bold: true });
    txt(doc, 'OTURUM', ML + 6 + cw * 2, y + 5, { size: 6.5, color: C.muted, bold: true });
    txt(doc, String(totalSessions), ML + 6 + cw * 2, cellY + 6, { size: 18, color: C.indigo, bold: true });
    txt(doc, 'TOPLAM BLOK', ML + 6 + cw * 3, y + 5, { size: 6.5, color: C.muted, bold: true });
    txt(doc, String(Object.values(catBlockCounts).reduce((a, b) => a + b, 0)), ML + 6 + cw * 3, cellY + 6, { size: 18, color: C.indigo, bold: true });
    y += 28;

    /* ── KATEGORİ LİSTESİ ── */
    if (cats.size > 0) {
        txt(doc, 'KATEGORILER', ML, y, { size: 8.5, color: C.indigo, bold: true });
        y += 4;
        hLine(doc, ML, y, CW, C.indigo, 0.4);
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
            styles: { font: 'helvetica', fontSize: 8, cellPadding: [2.2, 3.5, 2.2, 3.5], lineColor: C.border, lineWidth: 0.2 },
            theme: 'grid',
            headStyles: { fillColor: C.indigo, textColor: C.white, fontStyle: 'bold', fontSize: 7.5 },
            columnStyles: {
                0: { fontStyle: 'bold', cellWidth: 50 },
                1: { halign: 'center', cellWidth: 22 },
                2: { halign: 'center', cellWidth: 22 },
            },
            alternateRowStyles: { fillColor: C.surface },
        });
        y = (doc.lastAutoTable?.finalY ?? y) + 6;
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

        fillRect(doc, ML, y, CW, 12, C.indigo);
        fillRect(doc, ML, y, 4, 12, C.indigoDk);
        txt(doc, `${gunIdx + 1}. GUN`, ML + 8, y + 5.5, { size: 7, color: [200, 200, 230], bold: true });
        txt(doc, dayLabel.toUpperCase(), ML + 8, y + 10, { size: 10, color: C.white, bold: true });
        txt(doc, window, W - MR, y + 6, { size: 8, color: [200, 200, 240], align: 'right' });
        txt(doc, `${daySessions.length} oturum`, W - MR, y + 10.5, { size: 7.5, color: [180, 180, 220], align: 'right' });
        y += 16;

        // Her kategori ayrı bir kart
        for (const sess of daySessions) {
            const blocks = sess.bugünBloklar || [];
            const aletler = (sess.aletler || []).map(aletL).join(' / ');
            const grupEtiketleri = sess.grupEtiketleri || (sess.gruplar || []).map((_, i) => String(i + 1));
            const K = (sess.aletler || []).length;

            ensureSpace(18 + Math.min(blocks.length, 12) * 6);

            // Kategori başlığı
            fillRect(doc, ML, y, CW, 9, C.indigoBg);
            strokeRect(doc, ML, y, CW, 9, C.indigo, 0.4);
            fillRect(doc, ML, y, 3, 9, C.indigo);
            txt(doc, catL(sess.kategori).toUpperCase(), ML + 6, y + 5.5, { size: 10, color: C.indigoDk, bold: true });
            const headerR = [];
            headerR.push(`${sess.baslangic || sess.saat || ''} - ${sess.bitis || sess.bitisSaat || ''}`);
            headerR.push(`${sess.sporcuSayisi ?? '?'} sporcu`);
            if (sess.çokGünlü) headerR.push(`${sess.günSira}/${sess.günToplam}. gun`);
            txt(doc, headerR.join('  ·  '), W - MR, y + 5.5, { size: 7.5, color: C.indigo, align: 'right' });
            y += 11;

            // Alet bilgisi
            txt(doc, `Aletler: ${aletler}`, ML, y, { size: 7.5, color: C.muted });
            y += 5;

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
                styles: { font: 'helvetica', fontSize: 8.5, cellPadding: [2, 3, 2, 3], lineColor: C.border, lineWidth: 0.2 },
                theme: 'grid',
                headStyles: { fillColor: C.indigo, textColor: C.white, fontStyle: 'bold', fontSize: 7.5 },
                columnStyles: {
                    0: { fontStyle: 'bold', cellWidth: 22, halign: 'center' },
                    1: { cellWidth: 32, halign: 'center', fontStyle: 'bold' },
                },
                alternateRowStyles: { fillColor: C.surface },
                didDrawPage: () => { /* no-op */ },
            });
            y = (doc.lastAutoTable?.finalY ?? y) + 4;
            ensureSpace(6);
        }
        drawFooter();
    });

    /* ── TÜM GRUPLAR (kategorilere göre) ── */
    const groupsByCat = {};
    Object.values(sessions || {}).forEach(s => {
        if (!s) return;
        if (groupsByCat[s.kategori]) return; // her cat 1 kez
        if (Array.isArray(s.gruplar) && s.gruplar.length) {
            groupsByCat[s.kategori] = {
                gruplar: s.gruplar,
                grupEtiketleri: s.grupEtiketleri || s.gruplar.map((_, i) => String(i + 1)),
            };
        }
    });
    if (Object.keys(groupsByCat).length) {
        doc.addPage(); pageNum++; drawMiniHeader();
        fillRect(doc, ML, y, CW, 10, C.indigo);
        txt(doc, 'TUM GRUPLAR', ML + 5, y + 7, { size: 11, color: C.white, bold: true });
        y += 14;

        for (const [ck, info] of Object.entries(groupsByCat)) {
            ensureSpace(14);
            fillRect(doc, ML, y, CW, 7, C.indigoBg);
            txt(doc, catL(ck).toUpperCase(), ML + 4, y + 5, { size: 8.5, color: C.indigoDk, bold: true });
            txt(doc, `${info.gruplar.length} grup`, W - MR, y + 5, { size: 7.5, color: C.indigo, align: 'right' });
            y += 9;
            const rows = info.gruplar.map((ids, i) => {
                const label = info.grupEtiketleri[i] ?? (i + 1);
                return [`Grup ${label}`, String(ids.length), ids.slice(0, 3).map(id => '#' + String(id).slice(-4)).join(', ') + (ids.length > 3 ? `, +${ids.length - 3}` : '')];
            });
            autoTable(doc, {
                startY: y,
                head: [['GRUP', 'SPORCU', 'ORNEK'].map(tr)],
                body: rows.map(r => r.map(tr)),
                margin: { left: ML, right: MR },
                styles: { font: 'helvetica', fontSize: 7.5, cellPadding: [1.5, 3, 1.5, 3], lineColor: C.border, lineWidth: 0.2 },
                theme: 'grid',
                headStyles: { fillColor: C.indigo, textColor: C.white, fontSize: 7 },
                columnStyles: { 0: { fontStyle: 'bold', cellWidth: 28 }, 1: { halign: 'center', cellWidth: 22 } },
                alternateRowStyles: { fillColor: C.surface },
            });
            y = (doc.lastAutoTable?.finalY ?? y) + 4;
        }
        drawFooter();
    }

    const safeName = String(comp?.isim || 'program').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
    doc.save(`TCF_${safeName}_Program.pdf`);
}
