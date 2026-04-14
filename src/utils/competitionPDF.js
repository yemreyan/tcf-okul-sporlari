/**
 * TCF Yarışma Programı PDF — Temiz & Şık Tasarım
 * jsPDF + jspdf-autotable
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/* ── Sayfa boyutları ── */
const W = 210, H = 297;
const ML = 14, MR = 14, MT = 14, MB = 16;
const CW = W - ML - MR;

/* ── Renk paleti (temiz, minimal) ── */
const C = {
    ink:      [15,  23,  42],   // slate-900 — ana metin
    body:     [51,  65,  85],   // slate-700 — ikincil metin
    muted:    [100, 116, 139],  // slate-500 — soluk metin
    faint:    [148, 163, 184],  // slate-400 — çok soluk
    border:   [226, 232, 240],  // slate-200 — kenarlık
    surface:  [248, 250, 252],  // slate-50  — arkaplan

    indigo:   [79,  70, 229],   // indigo-600 — ana vurgu
    indigoBg: [238, 237, 254],  // indigo-50
    indigoMd: [99,  102, 241],  // indigo-500
    indigoDk: [49,  46, 129],   // indigo-900

    amber:    [180, 100,   5],  // amber-700
    amberBg:  [255, 251, 235],  // amber-50
    amberBd:  [252, 211,  77],  // amber-300

    teal:     [13,  148, 136],  // teal-600
    tealBg:   [240, 253, 250],  // teal-50

    green:    [22,  101,  52],  // green-800
    greenBg:  [240, 253, 244],  // green-50

    slate600: [71,   85, 105],
    white:    [255, 255, 255],

    // Brand aksanı (ince çizgiler için)
    gold:     [212, 175,  55],
};

/* ── Türkçe karakter dönüşümü (Helvetica uyumlu) ── */
const TR_MAP = {
    304:'I',305:'i', 286:'G',287:'g', 350:'S',351:'s',
    214:'O',246:'o', 220:'U',252:'u', 199:'C',231:'c',
};
function tr(text) {
    return String(text ?? '').split('').map(c => {
        const code = c.charCodeAt(0);
        return TR_MAP[code] !== undefined ? TR_MAP[code] : c;
    }).join('');
}

/* ── Etiket yardımcıları ── */
const ALET_MAP = {
    atlama:'Atlama', barfiks:'Barfiks', halka:'Halka',
    kulplu:'Kulplu Beygir', mantar:'Mantar Beygir',
    paralel:'Paralel', yer:'Yer', denge:'Denge',
    asimetrik:'Asimetrik Paralel', serbest:'Serbest',
};
const aletL = (k) => tr(ALET_MAP[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : ''));
const catL  = (k) => tr(k ? k.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '');

function parseMin(t) {
    const [h, m] = (t || '00:00').split(':').map(Number);
    return h * 60 + m;
}

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

/* ── Çizim yardımcıları ── */
function fillRect(doc, x, y, w, h, color) {
    doc.setFillColor(...color);
    doc.rect(x, y, w, h, 'F');
}
function strokeRect(doc, x, y, w, h, color, lw = 0.3) {
    doc.setDrawColor(...color);
    doc.setLineWidth(lw);
    doc.rect(x, y, w, h, 'S');
}
function hLine(doc, x, y, w, color, lw = 0.3) {
    doc.setDrawColor(...color);
    doc.setLineWidth(lw);
    doc.line(x, y, x + w, y);
}
function txt(doc, text, x, y, opts = {}) {
    const { size = 8, color = C.ink, bold = false, align = 'left', maxWidth, italic = false } = opts;
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.setFont('helvetica', bold ? 'bold' : italic ? 'italic' : 'normal');
    const options = { align };
    if (maxWidth) options.maxWidth = maxWidth;
    doc.text(tr(String(text)), x, y, options);
}

/* ── autoTable minimal stili ── */
function tblStyle() {
    return {
        styles: {
            font: 'helvetica', fontSize: 7.5,
            cellPadding: [2.2, 3.5, 2.2, 3.5],
            lineColor: C.border, lineWidth: 0.2,
            overflow: 'linebreak',
        },
        theme: 'grid',
        tableLineColor: C.border,
        tableLineWidth: 0.2,
    };
}

/* Türkçe dönüşümü autoTable içeriğine uygula */
function sanitize(data) {
    if (Array.isArray(data)) return data.map(sanitize);
    if (data && typeof data === 'object') {
        const out = { ...data };
        if (typeof out.content === 'string') out.content = tr(out.content);
        return out;
    }
    if (typeof data === 'string') return tr(data);
    return data;
}

/* ═══════════════════════════════════════════════════
   ANA EXPORT
═══════════════════════════════════════════════════ */
export async function generateCompetitionPDF({
    selectedComp, compCatKeys, dateRange, sessionsByDate,
    gruplar, athleteCounts,
}) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const logoData = await loadLogo();
    let pageNum = 1;
    let y = MT;

    /* ── Footer ── */
    const drawFooter = () => {
        hLine(doc, 0, H - MB, W, C.border, 0.3);
        fillRect(doc, 0, H - MB + 0.3, W, MB - 0.3, C.surface);
        // Brand çizgisi
        fillRect(doc, 0, H - MB, ML, 0.8, C.gold);
        txt(doc, 'Turkiye Cimnastik Federasyonu', ML, H - 4, { size: 6.5, color: C.faint });
        txt(doc, `Sayfa ${pageNum}`, W / 2, H - 4, { size: 6.5, color: C.muted, align: 'center' });
        txt(doc, new Date().toLocaleDateString('tr-TR'), W - MR, H - 4, { size: 6.5, color: C.faint, align: 'right' });
    };

    /* ── Mini başlık (2+ sayfa) ── */
    const drawMiniHeader = () => {
        fillRect(doc, 0, 0, W, 11, C.indigo);
        // Aksanlar
        fillRect(doc, 0, 0, 4, 11, C.indigoDk);
        fillRect(doc, 4, 10.5, W - 4, 0.5, C.gold);
        if (logoData) doc.addImage(logoData, 'PNG', ML, 1.5, 7.5, 7.5);
        txt(doc, 'TURKIYE CIMNASTIK FEDERASYONU', ML + 10, 5, { size: 6, color: [180, 180, 230] });
        txt(doc, tr((selectedComp?.isim || '').toUpperCase()), W - MR, 7, { size: 7.5, color: C.white, bold: true, align: 'right', maxWidth: 130 });
        y = 15;
    };

    /* ── Sayfa kırma ── */
    const ensureSpace = (needed) => {
        if (y + needed > H - MB - 12) {
            drawFooter();
            doc.addPage();
            pageNum++;
            drawMiniHeader();
        }
    };

    /* ══════════════════════════════════════════════
       KAPAK SAYFASI
    ══════════════════════════════════════════════ */

    // Üst başlık alanı — temiz, minimal
    fillRect(doc, 0, 0, W, 52, C.indigo);
    fillRect(doc, 0, 0, 5, 52, C.indigoDk);
    fillRect(doc, 0, 52, W, 0.8, C.gold);
    fillRect(doc, 0, 53, W, 0.3, [180, 160, 80]);

    // Logo
    if (logoData) {
        doc.addImage(logoData, 'PNG', ML + 2, 7, 32, 32);
    } else {
        doc.setDrawColor(...C.gold);
        doc.setLineWidth(1.2);
        doc.circle(ML + 18, 23, 13, 'S');
        txt(doc, 'TCF', ML + 18, 26, { size: 11, color: C.gold, bold: true, align: 'center' });
    }

    txt(doc, 'TURKIYE CIMNASTIK FEDERASYONU', ML + 42, 17, { size: 9, color: [190, 185, 240], bold: true });
    txt(doc, 'Resmi Yarisma Programi', ML + 42, 23, { size: 7, color: [160, 155, 210], italic: true });

    const compName = tr((selectedComp?.isim || 'YARISMA PROGRAMI').toUpperCase());
    const nameFontSize = compName.length > 50 ? 12 : compName.length > 35 ? 14 : 16;
    txt(doc, compName, ML + 42, 36, { size: nameFontSize, color: C.white, bold: true, maxWidth: CW - 46 });

    y = 60;

    // Meta bilgi kartları — ince border, beyaz zemin
    const totalAthletes = Object.values(athleteCounts).reduce((a, b) => a + b, 0);
    const tarihStr = selectedComp?.baslangicTarihi && selectedComp?.bitisTarihi &&
        selectedComp.bitisTarihi !== selectedComp.baslangicTarihi
        ? `${selectedComp.baslangicTarihi} / ${selectedComp.bitisTarihi}`
        : selectedComp?.baslangicTarihi || '—';
    const meta = [
        { label: 'ILI', val: tr(selectedComp?.il || '—'), icon: '◉' },
        { label: 'TARIH', val: tarihStr, icon: '▷' },
        { label: 'KATEGORI', val: `${compCatKeys.length}`, icon: '◈' },
        { label: 'SPORCU', val: `${totalAthletes}`, icon: '◎' },
    ];
    const bw = (CW - 3 * 3) / 4;
    meta.forEach((m, i) => {
        const bx = ML + i * (bw + 3);
        fillRect(doc, bx, y, bw, 20, C.white);
        strokeRect(doc, bx, y, bw, 20, C.border, 0.3);
        fillRect(doc, bx, y, bw, 0.4, C.indigo); // üst aksanı
        txt(doc, m.label, bx + 5, y + 7, { size: 5.5, color: C.indigo, bold: true });
        txt(doc, m.val, bx + 5, y + 15, { size: 9, color: C.ink, bold: true, maxWidth: bw - 6 });
    });
    y += 26;

    hLine(doc, ML, y, CW, C.border, 0.4);
    y += 8;

    // Günler ve kategori özeti (kapak sayfası içerik)
    const totalSessions = Object.values(sessionsByDate).flat().length;
    if (totalSessions > 0) {
        txt(doc, 'PROGRAM OZETI', ML, y, { size: 8, color: C.indigo, bold: true });
        y += 5;

        const summaryRows = dateRange.map(d => {
            const ds = sessionsByDate[d] || [];
            if (!ds.length) return null;
            const dayD = new Date(d + 'T12:00:00');
            const days = ['Paz','Pzt','Sal','Car','Per','Cum','Cmt'];
            const months = ['Oca','Sub','Mar','Nis','May','Haz','Tem','Agu','Eyl','Eki','Kas','Ara'];
            return [
                tr(`${days[dayD.getDay()]} ${dayD.getDate()} ${months[dayD.getMonth()]}`),
                tr(`${ds.filter(s => s.tip === 'isinma').length} isinma`),
                tr(`${ds.filter(s => s.tip === 'rotasyon').length} rotasyon`),
                tr(`${ds.filter(s => s.tip === 'mola').length} mola`),
                tr(`${ds.length} toplam`),
            ];
        }).filter(Boolean);

        if (summaryRows.length) {
            autoTable(doc, {
                startY: y,
                head: [sanitize(['GUN','ISINMA','ROTASYON','MOLA','TOPLAM'])],
                body: sanitize(summaryRows),
                margin: { left: ML, right: MR },
                ...tblStyle(),
                headStyles: { fillColor: C.indigo, textColor: C.white, fontStyle: 'bold', fontSize: 7 },
                alternateRowStyles: { fillColor: C.surface },
                columnStyles: {
                    0: { fontStyle: 'bold', cellWidth: 32 },
                    4: { fontStyle: 'bold', textColor: C.indigo },
                },
            });
            y = (doc.lastAutoTable?.finalY ?? y + 20) + 4;
        }
    }

    drawFooter();

    /* ══════════════════════════════════════════════
       GÜN BAZLI PROGRAM SAYFALARI
    ══════════════════════════════════════════════ */
    for (const dateStr of dateRange) {
        const daySessions = sessionsByDate[dateStr] || [];
        if (!daySessions.length) continue;

        doc.addPage();
        pageNum++;
        drawMiniHeader();

        /* ── Gün başlığı ── */
        ensureSpace(14);

        const dayD = new Date(dateStr + 'T12:00:00');
        const dayNames  = ['Pazar','Pazartesi','Sali','Carsamba','Persembe','Cuma','Cumartesi'];
        const monthNames = ['Ocak','Subat','Mart','Nisan','Mayis','Haziran','Temmuz','Agustos','Eylul','Ekim','Kasim','Aralik'];
        const dayLabel = `${dayNames[dayD.getDay()]}, ${dayD.getDate()} ${monthNames[dayD.getMonth()]} ${dayD.getFullYear()}`;

        // Gün başlık bar — temiz indigo
        fillRect(doc, ML, y, CW, 10, C.indigo);
        fillRect(doc, ML, y, 4, 10, C.indigoDk);
        txt(doc, dayLabel.toUpperCase(), ML + 8, y + 7, { size: 9, color: C.white, bold: true });
        txt(doc, `${daySessions.length} oturum`, W - MR, y + 7, { size: 7.5, color: [180,180,220], align: 'right' });
        y += 13;

        /* ── Kategoriye göre grupla ── */
        const catMap = {};
        daySessions.forEach(sess => {
            const ck = sess.kategori || '__mola__';
            if (!catMap[ck]) catMap[ck] = [];
            catMap[ck].push(sess);
        });

        for (const [catKey, catSessions] of Object.entries(catMap)) {

            /* Kategorisiz molalar */
            if (catKey === '__mola__') {
                catSessions.filter(s => s.tip === 'mola').forEach(s => {
                    ensureSpace(9);
                    fillRect(doc, ML, y, CW, 7, C.amberBg);
                    strokeRect(doc, ML, y, CW, 7, C.amberBd, 0.25);
                    const molaText = tr(`MOLA — ${s.molaAdi || s.aciklama || 'Ara'}`);
                    txt(doc, molaText, ML + 4, y + 4.8, { size: 8, color: C.amber, bold: true });
                    txt(doc, `${s.saat || ''} – ${s.bitisSaat || ''}`, W - MR, y + 4.8, { size: 8, color: C.amber, align: 'right' });
                    y += 9;
                });
                continue;
            }

            ensureSpace(18);

            /* Kategori başlığı — ince, temiz */
            hLine(doc, ML, y, CW, C.indigo, 0.5);
            y += 4;
            txt(doc, catL(catKey).toUpperCase(), ML, y, { size: 8.5, color: C.indigo, bold: true });
            const catAthCnt = athleteCounts[catKey] || 0;
            txt(doc, tr(`${catAthCnt} sporcu`), W - MR, y, { size: 7.5, color: C.muted, align: 'right' });
            y += 6;

            /* Sabit molalar */
            catSessions.filter(s => s.tip === 'mola' && (!s.rotasyonNo || s.rotasyonNo === 0) && !s.dalgaNo)
                .forEach(s => {
                    ensureSpace(8);
                    fillRect(doc, ML, y, CW, 6.5, C.amberBg);
                    strokeRect(doc, ML, y, CW, 6.5, C.amberBd, 0.25);
                    txt(doc, tr(`${s.molaAdi || s.aciklama || 'Mola'}`), ML + 4, y + 4.5, { size: 7.5, color: C.amber, bold: true });
                    txt(doc, `${s.saat || ''} – ${s.bitisSaat || ''}`, W - MR, y + 4.5, { size: 7.5, color: C.amber, align: 'right' });
                    y += 8;
                });

            /* Isınma oturumları */
            catSessions.filter(s => s.tip === 'isinma').forEach(s => {
                ensureSpace(8);
                fillRect(doc, ML, y, CW, 6.5, C.tealBg);
                strokeRect(doc, ML, y, CW, 6.5, [153, 220, 215], 0.25);
                const dLabel = s.dalgaNo ? `${s.dalgaNo}. Seans ` : '';
                txt(doc, tr(`ISINMA  ${dLabel}`), ML + 4, y + 4.5, { size: 7.5, color: C.teal, bold: true });
                txt(doc, `${s.saat || ''} – ${s.bitisSaat || ''}`, W - MR, y + 4.5, { size: 7.5, color: C.teal, align: 'right' });
                y += 8;
            });

            /* Dalga (seans) bazlı rotasyonlar */
            const rotSessions = catSessions.filter(s => s.tip === 'rotasyon');
            const waveMap = {};
            rotSessions.forEach(s => {
                const wk = s.dalgaNo || 1;
                if (!waveMap[wk]) waveMap[wk] = {};
                const rk = s.rotasyonNo || 1;
                if (!waveMap[wk][rk]) waveMap[wk][rk] = [];
                waveMap[wk][rk].push(s);
            });
            const rotMolalar = catSessions.filter(s => s.tip === 'mola' && s.rotasyonNo > 0);

            for (const [dalgaNo, rotMap] of Object.entries(waveMap).sort(([a],[b]) => +a - +b)) {
                ensureSpace(28);

                /* Dalga (seans) başlığı — ince kart */
                fillRect(doc, ML, y, CW, 8.5, C.surface);
                strokeRect(doc, ML, y, CW, 8.5, C.border, 0.3);
                fillRect(doc, ML, y, 3, 8.5, C.indigo); // sol aksanı

                const waveGroups = [...new Set(
                    Object.values(rotMap).flat().map(s => `Grup ${s.grupNo}${s.bolumAdi || ''}`)
                )].join(', ');
                const allFlat = Object.values(rotMap).flat().sort((a,b) => (a.saat||'').localeCompare(b.saat||''));
                const t0 = allFlat[0], tN = allFlat[allFlat.length - 1];

                txt(doc, tr(`${dalgaNo}. SEANS`), ML + 7, y + 5.8, { size: 8.5, color: C.indigo, bold: true });
                txt(doc, tr(waveGroups), ML + 32, y + 5.8, { size: 7, color: C.body });
                if (t0 && tN) {
                    txt(doc, `${t0.saat} – ${tN.bitisSaat}`, W - MR, y + 5.8, { size: 7.5, color: C.muted, align: 'right' });
                }
                y += 11;

                /* Rotasyon matrisi — minimal tablo */
                const rotNums  = Object.keys(rotMap).map(Number).sort((a,b) => a-b);
                const aletlerArr = [...new Set(Object.values(rotMap).flat().map(s => s.alet).filter(Boolean))];

                if (aletlerArr.length && rotNums.length) {
                    ensureSpace(16 + aletlerArr.length * 7);

                    const headRow = [
                        { content: 'ALET', styles: { halign: 'left', fontStyle: 'bold', fillColor: C.ink, textColor: C.white, cellWidth: 34 } },
                        ...rotNums.map(r => {
                            const s0r = (rotMap[r] || [])[0];
                            const mola = rotMolalar.find(m => m.rotasyonNo === r && (m.dalgaNo||1) == dalgaNo);
                            let label = `ROT. ${r}`;
                            if (s0r?.saat) label += `  ${s0r.saat}-${s0r.bitisSaat}`;
                            if (mola) {
                                const dk = Math.round(parseMin(mola.bitisSaat) - parseMin(mola.saat));
                                label += `  +${dk}dk`;
                            }
                            return { content: label, styles: { halign: 'center', fontStyle: 'bold', fillColor: C.indigoMd, textColor: C.white } };
                        }),
                    ];

                    const bodyRows = aletlerArr.map(alet => [
                        { content: aletL(alet), styles: { fontStyle: 'bold', fillColor: C.indigoBg, textColor: C.indigo } },
                        ...rotNums.map(r => {
                            const groups = (rotMap[r] || []).filter(s => s.alet === alet);
                            const label = groups.map(s =>
                                `G${s.grupNo}${s.bolumAdi || ''}${s.paralel ? '(P)' : ''}`
                            ).join(' + ') || '—';
                            return {
                                content: label,
                                styles: {
                                    halign: 'center',
                                    textColor: groups.length ? C.indigo : C.faint,
                                    fontStyle: groups.length ? 'bold' : 'normal',
                                    fillColor: groups.length ? C.white : C.surface,
                                },
                            };
                        }),
                    ]);

                    autoTable(doc, {
                        startY: y,
                        head: [sanitize(headRow)],
                        body: sanitize(bodyRows),
                        margin: { left: ML + 3, right: MR + 3 },
                        ...tblStyle(),
                    });
                    y = (doc.lastAutoTable?.finalY ?? y + 15) + 5;
                }

                /* Sporcu listeleri */
                const groupKeys = [...new Set(
                    Object.values(rotMap).flat().map(s => `${s.grupNo}${s.bolumAdi || ''}`)
                )].sort((a,b) => parseInt(a) - parseInt(b));

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

                    const startSess = Object.values(rotMap)[0]?.find(s => `${s.grupNo}${s.bolumAdi||''}` === groupKey);
                    const neededH = Math.min(athletes.length, 8) * 5.5 + 16;
                    ensureSpace(neededH);

                    /* Grup alt başlığı */
                    fillRect(doc, ML + 4, y, CW - 4, 7, C.indigoBg);
                    strokeRect(doc, ML + 4, y, CW - 4, 7, [190, 185, 250], 0.25);
                    const startLabel = startSess ? `  |  ${aletL(startSess.alet)} ile baslar` : '';
                    txt(doc, tr(`GRUP ${groupKey}${startLabel}`), ML + 8, y + 5, { size: 7.5, color: C.indigo, bold: true });
                    txt(doc, tr(`${athletes.length} sporcu`), W - MR, y + 5, { size: 7, color: C.muted, align: 'right' });
                    y += 9;

                    /* Sporcu tablosu */
                    const athHead = [sanitize([
                        { content: '#', styles: { halign: 'center', fillColor: C.ink, textColor: C.white, cellWidth: 9 } },
                        { content: 'AD SOYAD', styles: { fillColor: C.ink, textColor: C.white, cellWidth: 60 } },
                        { content: 'KULUP / OKUL', styles: { fillColor: C.ink, textColor: C.white } },
                        { content: 'TIP', styles: { halign: 'center', fillColor: C.ink, textColor: C.white, cellWidth: 18 } },
                    ])];

                    const athBody = sanitize(athletes.map((ath, ai) => {
                        const isTakim = (ath.yarismaTuru || 'ferdi').toLowerCase().includes('tak');
                        return [
                            { content: String(ath.sirasi || ai + 1), styles: { halign: 'center', textColor: C.muted } },
                            { content: `${ath.ad || ''} ${ath.soyad || ''}`.trim(), styles: { fontStyle: 'bold', textColor: C.ink } },
                            { content: ath.kulup || ath.okul || '—', styles: { textColor: C.body } },
                            {
                                content: isTakim ? 'TAKIM' : 'FERDI',
                                styles: {
                                    halign: 'center', fontStyle: 'bold',
                                    textColor: isTakim ? C.green : C.indigo,
                                    fillColor: isTakim ? C.greenBg : C.indigoBg,
                                },
                            },
                        ];
                    }));

                    autoTable(doc, {
                        startY: y,
                        head: athHead,
                        body: athBody,
                        margin: { left: ML + 4, right: MR + 2 },
                        ...tblStyle(),
                        styles: { ...tblStyle().styles, fontSize: 7, cellPadding: [1.8, 3, 1.8, 3] },
                        alternateRowStyles: { fillColor: C.surface },
                    });
                    y = (doc.lastAutoTable?.finalY ?? y + 15) + 4;
                }

                y += 4;
            }

            /* Manuel oturumlar (tip olmayan veya 'manuel') */
            const manuelSessions = catSessions.filter(s => !s.tip || s.tip === 'manuel');
            if (manuelSessions.length) {
                ensureSpace(10 + manuelSessions.length * 7);
                const manRows = manuelSessions.map(s => [
                    `${s.saat || ''} – ${s.bitisSaat || ''}`,
                    tr(s.aciklama || getCatLabelLocal(s.kategori)),
                    tr(aletL(s.alet)),
                ]);
                autoTable(doc, {
                    startY: y,
                    body: sanitize(manRows),
                    margin: { left: ML, right: MR },
                    ...tblStyle(),
                    alternateRowStyles: { fillColor: C.surface },
                    columnStyles: {
                        0: { cellWidth: 28, fontStyle: 'bold', textColor: C.indigo },
                        2: { cellWidth: 26, textColor: C.muted },
                    },
                });
                y = (doc.lastAutoTable?.finalY ?? y + 15) + 4;
            }

            y += 3;
        }

        drawFooter();
    }

    /* ── Dosya kaydet ── */
    const safeName = tr(selectedComp?.isim || 'Yarisma')
        .replace(/[^a-zA-Z0-9\s_-]/g, '').replace(/\s+/g, '_');
    const now = new Date();
    const ds = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    doc.save(`TCF_${safeName}_Program_${ds}.pdf`);
}

/* Local helper (PDF içi kullanım) */
function getCatLabelLocal(k) {
    return tr(k ? k.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '');
}
