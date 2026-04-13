/**
 * TCF Yarışma Programı PDF Oluşturucu
 * Vektörel PDF — jsPDF + jspdf-autotable
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/* ── Sabitler ── */
const W = 210, H = 297;
const ML = 12, MR = 12, MT = 14, MB = 14;
const CW = W - ML - MR;

const C = {
    navy:     [18,  51,  89],   // #123359 — TCF ana mavi
    navyMid:  [30,  58,  95],   // #1e3a5f
    navyLight:[44,  82, 130],   // #2c5282
    gold:     [212, 160,  23],  // #d4a017 — TCF altın
    goldLight:[254, 243, 199],  // #fef3c7
    purple:   [79,  70, 229],   // #4f46e5
    purpleL:  [238,237,254],    // #eeeffe
    amber:    [180, 100,   5],  // amber dark
    amberBg:  [255, 237, 213],  // #ffedd5
    green:    [ 22,101, 52],    // #166534
    greenBg:  [240,253,244],    // #f0fdf4
    red:      [153,  27,  27],
    redBg:    [254, 226, 226],
    white:    [255, 255, 255],
    light:    [248, 250, 252],
    border:   [226, 232, 240],
    dark:     [ 15,  23,  42],
    mid:      [ 71,  85, 105],
    muted:    [148, 163, 184],
};

const ALET_LABELS = {
    atlama:'Atlama', barfiks:'Barfiks', halka:'Halka',
    kulplu:'Kulplu Beygir', mantar:'Mantar Beygir',
    paralel:'Paralel', yer:'Yer', denge:'Denge Aleti',
    asimetrik:'Asimetrik Par.', serbest:'Serbest',
};
const aletL = (k) => ALET_LABELS[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : '');
const catL  = (k) => k ? k.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '';

/* ── Logo yükle ── */
async function loadLogo() {
    try {
        const resp = await fetch('/logo.png');
        if (!resp.ok) return null;
        const blob = await resp.blob();
        return new Promise(res => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.onerror = () => res(null);
            r.readAsDataURL(blob);
        });
    } catch { return null; }
}

/* ── Yardımcı çizim fonksiyonları ── */
function fillRect(doc, x, y, w, h, color) {
    doc.setFillColor(...color);
    doc.rect(x, y, w, h, 'F');
}
function strokeRect(doc, x, y, w, h, color, lw = 0.3) {
    doc.setDrawColor(...color);
    doc.setLineWidth(lw);
    doc.rect(x, y, w, h, 'S');
}
function txt(doc, text, x, y, opts = {}) {
    const { size = 8, color = C.dark, bold = false, align = 'left', maxWidth } = opts;
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const options = { align };
    if (maxWidth) options.maxWidth = maxWidth;
    doc.text(String(text), x, y, options);
}

/* ── Ana export fonksiyonu ── */
export async function generateCompetitionPDF({
    selectedComp, compCatKeys, dateRange, sessionsByDate,
    gruplar, athleteCounts,
}) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const logoData = await loadLogo();
    let pageNum = 1;
    let y = MT;

    /* ─── Footer ─── */
    const drawFooter = () => {
        fillRect(doc, 0, H - 9, W, 9, C.navy);
        // Gradient line above footer
        fillRect(doc, 0, H - 9, W * 0.35, 1.5, C.gold);
        fillRect(doc, W * 0.35, H - 9, W * 0.35, 1.5, C.purple);
        fillRect(doc, W * 0.70, H - 9, W * 0.30, 1.5, C.navyLight);

        txt(doc, 'Turkiye Cimnastik Federasyonu | Yarisma Yonetim Sistemi', ML, H - 4.5, { size: 6.5, color: C.muted });
        txt(doc, `Sayfa ${pageNum}`, W - MR, H - 4.5, { size: 6.5, color: C.muted, align: 'right' });
        txt(doc, new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }), W / 2, H - 4.5, { size: 6.5, color: C.muted, align: 'center' });
    };

    /* ─── Mini sayfa başlığı (2. sayfa ve sonrası) ─── */
    const drawMiniHeader = () => {
        fillRect(doc, 0, 0, W, 10, C.navy);
        fillRect(doc, 0, 10, W, 0.8, C.gold);
        if (logoData) doc.addImage(logoData, 'PNG', ML, 1.5, 6.5, 6.5);
        txt(doc, 'TURKIYE CIMNASTIK FEDERASYONU', ML + 8.5, 5, { size: 6.5, color: C.muted, bold: false });
        txt(doc, (selectedComp?.isim || '').toUpperCase(), W - MR, 5, { size: 7, color: C.white, bold: true, align: 'right' });
        y = 14;
    };

    /* ─── Sayfa kırılma kontrolü ─── */
    const ensureSpace = (needed) => {
        if (y + needed > H - MB - 10) {
            drawFooter();
            doc.addPage();
            pageNum++;
            drawMiniHeader();
        }
    };

    /* ═══════════════════════════════
       KAPAK BAŞLIĞI (1. sayfa)
    ═══════════════════════════════ */
    // Navy header band
    fillRect(doc, 0, 0, W, 42, C.navy);
    // Decorative gold stripe left
    fillRect(doc, 0, 0, 4, 42, C.gold);
    // Bottom accent line
    fillRect(doc, 0, 42, W, 1.2, C.gold);
    fillRect(doc, 0, 43.2, W, 0.6, C.purple);

    // Logo
    if (logoData) {
        doc.addImage(logoData, 'PNG', ML + 2, 5, 28, 28);
    } else {
        // Fallback circle placeholder
        doc.setDrawColor(...C.gold);
        doc.setLineWidth(1);
        doc.circle(ML + 16, 19, 12, 'S');
        txt(doc, 'TCF', ML + 16, 21.5, { size: 9, color: C.gold, bold: true, align: 'center' });
    }

    // TCF header text
    txt(doc, 'TURKIYE CIMNASTIK FEDERASYONU', ML + 36, 14, { size: 10, color: C.gold, bold: true });
    txt(doc, 'Yarisma Yonetim Sistemi — Resmi Program', ML + 36, 20, { size: 7.5, color: C.muted });

    // Competition name
    const compName = (selectedComp?.isim || 'YARISMA PROGRAMI').toUpperCase();
    txt(doc, compName, ML + 36, 32, { size: 16, color: C.white, bold: true, maxWidth: CW - 40 });

    y = 50;

    // Metadata info boxes
    const metaItems = [
        { icon: 'Il:', value: selectedComp?.il || '—' },
        {
            icon: 'Tarih:',
            value: selectedComp?.baslangicTarihi && selectedComp?.bitisTarihi && selectedComp.bitisTarihi !== selectedComp.baslangicTarihi
                ? `${selectedComp.baslangicTarihi} - ${selectedComp.bitisTarihi}`
                : selectedComp?.baslangicTarihi || '—'
        },
        { icon: 'Kategoriler:', value: `${compCatKeys.length} kategori` },
        { icon: 'Toplam Sporcu:', value: `${Object.values(athleteCounts).reduce((a, b) => a + b, 0)} sporcu` },
    ];

    const boxW = CW / metaItems.length - 2;
    metaItems.forEach((item, i) => {
        const bx = ML + i * (boxW + 2.67);
        fillRect(doc, bx, y, boxW, 14, C.light);
        strokeRect(doc, bx, y, boxW, 14, C.border, 0.2);
        fillRect(doc, bx, y, boxW, 3, C.navy);
        txt(doc, item.icon, bx + 2, y + 2.2, { size: 6, color: C.gold, bold: true });
        txt(doc, item.value, bx + 2, y + 9.5, { size: 8, color: C.dark, bold: true, maxWidth: boxW - 4 });
    });

    y += 20;

    // Separator
    fillRect(doc, ML, y, CW, 0.4, C.border);
    y += 5;

    /* ═══════════════════════════════
       GÜN BAZLI PROGRAM
    ═══════════════════════════════ */
    for (const dateStr of dateRange) {
        const daySessions = sessionsByDate[dateStr] || [];
        if (!daySessions.length) continue;

        ensureSpace(18);

        // Day header
        fillRect(doc, ML, y, CW, 9, C.navy);
        fillRect(doc, ML, y, 4, 9, C.gold); // left gold stripe

        const dayLabel = new Date(dateStr + 'T12:00:00').toLocaleDateString('tr-TR', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        }).toUpperCase();
        txt(doc, dayLabel, ML + 7, y + 6, { size: 8.5, color: C.white, bold: true });

        // Day session count badge
        const dayCountTxt = `${daySessions.length} oturum`;
        txt(doc, dayCountTxt, W - MR, y + 6, { size: 7, color: C.gold, align: 'right' });

        y += 12;

        // Group by category
        const catMap = {};
        daySessions.forEach(sess => {
            const ck = sess.kategori || '';
            if (!catMap[ck]) catMap[ck] = [];
            catMap[ck].push(sess);
        });

        for (const [catKey, catSessions] of Object.entries(catMap)) {
            if (!catKey) continue;
            ensureSpace(16);

            // Category header
            fillRect(doc, ML, y, CW, 7, C.purple);
            fillRect(doc, ML, y, 3, 7, [139, 92, 246]); // lighter purple stripe
            txt(doc, catL(catKey).toUpperCase(), ML + 6, y + 5, { size: 8, color: C.white, bold: true });

            const catAthleteCount = athleteCounts[catKey] || 0;
            txt(doc, `${catAthleteCount} sporcu`, W - MR, y + 5, { size: 7, color: [200, 180, 255], align: 'right' });

            y += 9;

            // Isınma info
            const isinmaSessions = catSessions.filter(s => s.tip === 'isinma');
            if (isinmaSessions.length) {
                isinmaSessions.forEach(s => {
                    ensureSpace(7);
                    fillRect(doc, ML + 2, y, CW - 2, 5.5, C.goldLight);
                    strokeRect(doc, ML + 2, y, CW - 2, 5.5, C.gold, 0.3);
                    txt(doc, `ISINMA${s.dalgaNo ? ' — ' + s.dalgaNo + '. Dalga' : ''}: ${s.saat || ''} – ${s.bitisSaat || ''}`, ML + 5, y + 3.8, { size: 7.5, color: C.amber, bold: true });
                    y += 7;
                });
            }

            // Group by wave
            const waveMap = {};
            catSessions.filter(s => s.tip === 'rotasyon').forEach(s => {
                const wk = s.dalgaNo || 1;
                if (!waveMap[wk]) waveMap[wk] = {};
                const rk = s.rotasyonNo || 1;
                if (!waveMap[wk][rk]) waveMap[wk][rk] = [];
                waveMap[wk][rk].push(s);
            });

            const molaSessions = catSessions.filter(s => s.tip === 'mola' && s.rotasyonNo > 0);

            for (const [dalgaNo, rotMap] of Object.entries(waveMap).sort(([a],[b]) => +a - +b)) {
                ensureSpace(22);

                // Wave header
                fillRect(doc, ML + 2, y, CW - 2, 6.5, C.amberBg);
                strokeRect(doc, ML + 2, y, CW - 2, 6.5, [251, 191, 36], 0.4);
                fillRect(doc, ML + 2, y, 3, 6.5, [245, 158, 11]);

                const waveGroupList = [...new Set(
                    Object.values(rotMap).flat().map(s => `Grup ${s.grupNo}${s.bolumAdi || ''}`)
                )].join(', ');
                const firstSess = Object.values(rotMap)[0]?.[0];
                const lastRotSess = Object.values(rotMap).slice(-1)[0];
                const lastSess = lastRotSess?.[lastRotSess.length - 1];

                txt(doc, `${dalgaNo}. DALGA`, ML + 7, y + 4.5, { size: 8, color: C.amber, bold: true });
                txt(doc, waveGroupList, ML + 30, y + 4.5, { size: 7, color: C.mid });
                if (firstSess && lastSess) {
                    txt(doc, `${firstSess.saat} – ${lastSess.bitisSaat}`, W - MR, y + 4.5, { size: 7, color: C.amber, align: 'right' });
                }

                y += 8.5;

                /* Rotasyon özet tablosu (alet × rotasyon) */
                ensureSpace(25);
                const rotNums = Object.keys(rotMap).map(Number).sort((a, b) => a - b);
                const aletlerSet = new Set();
                Object.values(rotMap).flat().forEach(s => { if (s.alet) aletlerSet.add(s.alet); });
                const aletler = [...aletlerSet];

                if (aletler.length && rotNums.length) {
                    const head = [[
                        { content: 'ALET', styles: { halign: 'left', fontStyle: 'bold', fillColor: C.navyMid, textColor: [255,255,255] } },
                        ...rotNums.map(r => {
                            const s0 = rotMap[r]?.[0];
                            const molaSonrasi = molaSessions.find(m => m.rotasyonNo === r && (m.dalgaNo || 1) == dalgaNo);
                            return {
                                content: `ROT. ${r}\n${s0?.saat || ''} – ${s0?.bitisSaat || ''}${molaSonrasi ? `\n(+${Math.round(parseTimeToMinLocal(molaSonrasi.bitisSaat) - parseTimeToMinLocal(molaSonrasi.saat))} dk mola)` : ''}`,
                                styles: { halign: 'center', fontStyle: 'bold', fillColor: C.purple, textColor: [255,255,255] }
                            };
                        }),
                    ]];

                    const body = aletler.map(alet => [
                        { content: aletL(alet), styles: { fontStyle: 'bold', fillColor: C.light, textColor: C.dark } },
                        ...rotNums.map(r => {
                            const groups = (rotMap[r] || []).filter(s => s.alet === alet);
                            return {
                                content: groups.map(s => `G${s.grupNo}${s.bolumAdi || ''}`).join('\n') || '—',
                                styles: { halign: 'center', textColor: groups.length ? C.purple : C.muted, fontStyle: groups.length ? 'bold' : 'normal' }
                            };
                        }),
                    ]);

                    autoTable(doc, {
                        startY: y,
                        head,
                        body,
                        margin: { left: ML + 2, right: MR },
                        styles: { fontSize: 7.5, cellPadding: [2, 3, 2, 3], lineColor: C.border, lineWidth: 0.2 },
                        theme: 'grid',
                        tableLineColor: C.border,
                        tableLineWidth: 0.2,
                    });
                    y = (doc.lastAutoTable?.finalY ?? y + 20) + 3;
                }

                /* Sporcu listeleri (her grup için) */
                const groupKeys = [...new Set(
                    Object.values(rotMap).flat().map(s => `${s.grupNo}${s.bolumAdi || ''}`)
                )].sort();

                for (const groupKey of groupKeys) {
                    const gi = parseInt(groupKey) - 1;
                    const bolumAdi = groupKey.replace(/^\d+/, '');
                    const catAthletes = gruplar[catKey];
                    if (!catAthletes) continue;
                    const groupAthletes = catAthletes[gi] || [];
                    let athletes = groupAthletes;
                    if (bolumAdi) {
                        const half = Math.ceil(groupAthletes.length / 2);
                        athletes = bolumAdi === 'A' ? groupAthletes.slice(0, half) : groupAthletes.slice(half);
                    }
                    if (!athletes.length) continue;

                    // Starting apparatus
                    const startSess = Object.values(rotMap)[0]?.find(s => `${s.grupNo}${s.bolumAdi || ''}` === groupKey);

                    ensureSpace(athletes.length * 5.5 + 14);

                    // Group sub-header
                    fillRect(doc, ML + 4, y, CW - 4, 6, C.purpleL);
                    strokeRect(doc, ML + 4, y, CW - 4, 6, C.purple, 0.25);
                    fillRect(doc, ML + 4, y, 2.5, 6, C.purple);
                    txt(doc, `GRUP ${groupKey}${startSess ? '  —  ' + aletL(startSess.alet) + ' ile Baslar' : ''}`, ML + 9, y + 4.2, { size: 7.5, color: C.purple, bold: true });
                    txt(doc, `${athletes.length} sporcu`, W - MR, y + 4.2, { size: 7, color: C.mid, align: 'right' });
                    y += 7;

                    // Athlete table
                    const athHead = [[
                        { content: '#', styles: { halign: 'center', fillColor: C.purple, textColor: [255,255,255] } },
                        { content: 'AD SOYAD', styles: { fillColor: C.purple, textColor: [255,255,255] } },
                        { content: 'KULUP / OKUL', styles: { fillColor: C.purple, textColor: [255,255,255] } },
                        { content: 'TIP', styles: { halign: 'center', fillColor: C.purple, textColor: [255,255,255] } },
                    ]];

                    const athBody = athletes.map((ath, ai) => {
                        const isTakim = (ath.yarismaTuru || 'ferdi').toLowerCase().includes('tak');
                        return [
                            { content: String(ath.sirasi || ai + 1), styles: { halign: 'center', textColor: C.mid } },
                            { content: `${ath.ad || ''} ${ath.soyad || ''}`.trim(), styles: { fontStyle: 'bold', textColor: C.dark } },
                            { content: ath.kulup || ath.okul || '—', styles: { textColor: C.mid } },
                            {
                                content: isTakim ? 'TAKIM' : 'FERDI',
                                styles: {
                                    halign: 'center', fontStyle: 'bold',
                                    textColor: isTakim ? C.green : C.purple,
                                    fillColor: isTakim ? C.greenBg : C.purpleL,
                                }
                            },
                        ];
                    });

                    autoTable(doc, {
                        startY: y,
                        head: athHead,
                        body: athBody,
                        margin: { left: ML + 4, right: MR },
                        styles: {
                            fontSize: 7, cellPadding: [1.8, 3, 1.8, 3],
                            lineColor: C.border, lineWidth: 0.15,
                        },
                        columnStyles: {
                            0: { cellWidth: 9 },
                            1: { cellWidth: 54 },
                            2: { cellWidth: 65 },
                            3: { cellWidth: 20 },
                        },
                        alternateRowStyles: { fillColor: C.light },
                        theme: 'grid',
                        tableLineColor: C.border,
                        tableLineWidth: 0.15,
                    });
                    y = (doc.lastAutoTable?.finalY ?? y + 20) + 3;
                }

                y += 3;
            }
            y += 5;
        }

        // Day separator
        fillRect(doc, ML, y, CW, 0.4, C.border);
        y += 6;
    }

    drawFooter();

    // Save
    const safeName = (selectedComp?.isim || 'Yarisma')
        .replace(/[^a-zA-Z0-9çğışöüÇĞİŞÖÜ\s]/g, '')
        .replace(/\s+/g, '_');
    const dateStr = new Date().toLocaleDateString('tr-TR').replace(/\./g, '-');
    doc.save(`TCF_${safeName}_Program_${dateStr}.pdf`);
}

/* Yardımcı: lokal saat → dakika (util dosyasında erişilebilir) */
function parseTimeToMinLocal(t) {
    const [h, m] = (t || '00:00').split(':').map(Number);
    return h * 60 + m;
}
