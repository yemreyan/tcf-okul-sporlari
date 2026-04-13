/**
 * TCF Yarisma Programi PDF Olusturucu
 * jsPDF + jspdf-autotable
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/* ── Sayfa boyutlari ── */
const W = 210, H = 297;
const ML = 12, MR = 12, MT = 12, MB = 14;
const CW = W - ML - MR;

/* ── Renkler ── */
const C = {
    navy:     [18,  51,  89],
    navyMid:  [30,  58,  95],
    gold:     [212, 160,  23],
    goldBg:   [254, 243, 199],
    purple:   [79,  70, 229],
    purpleL:  [238,237,254],
    amber:    [180, 100,   5],
    amberBg:  [255, 237, 213],
    green:    [ 22,101, 52],
    greenBg:  [240,253,244],
    white:    [255, 255, 255],
    light:    [248, 250, 252],
    border:   [203, 213, 225],
    dark:     [ 15,  23,  42],
    mid:      [ 71,  85, 105],
    muted:    [148, 163, 184],
};

/* ── Turkce karakter donusumu (Helvetica uyumlu) ── */
// charCode tablosu: regex yerine codePoint bazli - encoding sorunlarindan etkilenmez
const TR_MAP = {
    304:'I', 305:'i',   // İ ı
    286:'G', 287:'g',   // Ğ ğ
    350:'S', 351:'s',   // Ş ş
    214:'O', 246:'o',   // Ö ö
    220:'U', 252:'u',   // Ü ü
    199:'C', 231:'c',   // Ç ç
    194:'A', 226:'a',   // Â â
    206:'I', 238:'i',   // Î î
    219:'U', 251:'u',   // Û û
    208:'D', 240:'d',   // Ð ð (olasi)
};
function tr(text) {
    return String(text ?? '').split('').map(c => {
        const code = c.charCodeAt(0);
        return TR_MAP[code] !== undefined ? TR_MAP[code] : c;
    }).join('');
}

const ALET_LABELS = {
    atlama:'Atlama', barfiks:'Barfiks', halka:'Halka',
    kulplu:'Kulplu Beygir', mantar:'Mantar Beygir',
    paralel:'Paralel', yer:'Yer', denge:'Denge',
    asimetrik:'Asimetrik Par.', serbest:'Serbest',
};
const aletL = (k) => tr(ALET_LABELS[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : ''));
const catL  = (k) => tr(k ? k.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '');

function parseMin(t) {
    const [h, m] = (t || '00:00').split(':').map(Number);
    return h * 60 + m;
}

/* ── Logo yukle ── */
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

/* ── Cizim yardimcilari ── */
function fillRect(doc, x, y, w, h, color) {
    doc.setFillColor(...color);
    doc.rect(x, y, w, h, 'F');
}
function strokeRect(doc, x, y, w, h, color, lw = 0.25) {
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
    doc.text(tr(String(text)), x, y, options);
}

/* ── autoTable tablo stili ── */
function tableStyles() {
    return {
        styles: {
            font: 'helvetica',
            fontSize: 7.5,
            cellPadding: [2, 3, 2, 3],
            lineColor: C.border,
            lineWidth: 0.2,
            overflow: 'linebreak',
        },
        theme: 'grid',
        tableLineColor: C.border,
        tableLineWidth: 0.2,
    };
}

/* autoTable icin Turkce donusumu uygula */
function sanitizeTableData(data) {
    if (Array.isArray(data)) return data.map(sanitizeTableData);
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
        fillRect(doc, 0, H - 8, W, 8, C.navy);
        fillRect(doc, 0, H - 8, W * 0.4, 1, C.gold);
        fillRect(doc, W * 0.4, H - 8, W * 0.3, 1, C.purple);
        fillRect(doc, W * 0.7, H - 8, W * 0.3, 1, C.navyMid);
        txt(doc, 'Turkiye Cimnastik Federasyonu', ML, H - 3.5, { size: 6, color: C.muted });
        txt(doc, `Sayfa ${pageNum}`, W / 2, H - 3.5, { size: 6, color: C.muted, align: 'center' });
        txt(doc, new Date().toLocaleDateString('tr-TR'), W - MR, H - 3.5, { size: 6, color: C.muted, align: 'right' });
    };

    /* ── Mini baslik (2+ sayfa) ── */
    const drawMiniHeader = () => {
        fillRect(doc, 0, 0, W, 10, C.navy);
        fillRect(doc, 0, 10, W, 0.7, C.gold);
        if (logoData) doc.addImage(logoData, 'PNG', ML, 1.5, 6.5, 6.5);
        txt(doc, 'TURKIYE CIMNASTIK FEDERASYONU', ML + 8.5, 4.8, { size: 6, color: C.muted });
        txt(doc, tr((selectedComp?.isim || '').toUpperCase()), W - MR, 6.5, { size: 7.5, color: C.white, bold: true, align: 'right' });
        y = 14;
    };

    /* ── Sayfa kirma ── */
    const ensureSpace = (needed) => {
        if (y + needed > H - MB - 10) {
            drawFooter();
            doc.addPage();
            pageNum++;
            drawMiniHeader();
        }
    };

    /* ══════════════════════════════
       KAPAK (1. SAYFA)
    ══════════════════════════════ */
    // Ust bant
    fillRect(doc, 0, 0, W, 46, C.navy);
    fillRect(doc, 0, 0, 5, 46, C.gold);
    fillRect(doc, 0, 46, W, 1.5, C.gold);
    fillRect(doc, 0, 47.5, W, 0.5, C.purple);

    // Logo
    if (logoData) {
        doc.addImage(logoData, 'PNG', ML + 1, 5, 30, 30);
    } else {
        doc.setDrawColor(...C.gold);
        doc.setLineWidth(1);
        doc.circle(ML + 16, 20, 12, 'S');
        txt(doc, 'TCF', ML + 16, 22, { size: 10, color: C.gold, bold: true, align: 'center' });
    }

    txt(doc, 'TURKIYE CIMNASTIK FEDERASYONU', ML + 38, 14, { size: 10, color: C.gold, bold: true });
    txt(doc, 'Yarisma Yonetim Sistemi | Resmi Program', ML + 38, 20, { size: 7, color: C.muted });
    const compName = tr((selectedComp?.isim || 'YARISMA PROGRAMI').toUpperCase());
    // uzun isimler icin satir sar
    txt(doc, compName, ML + 38, 30, { size: 15, color: C.white, bold: true, maxWidth: CW - 44 });

    y = 54;

    // Meta kutular
    const totalAthletes = Object.values(athleteCounts).reduce((a, b) => a + b, 0);
    const tarihStr = selectedComp?.baslangicTarihi && selectedComp?.bitisTarihi && selectedComp.bitisTarihi !== selectedComp.baslangicTarihi
        ? `${selectedComp.baslangicTarihi} - ${selectedComp.bitisTarihi}`
        : selectedComp?.baslangicTarihi || '—';
    const meta = [
        { label: 'IL', val: tr(selectedComp?.il || '—') },
        { label: 'TARIH', val: tarihStr },
        { label: 'KATEGORI', val: `${compCatKeys.length} kategori` },
        { label: 'SPORCU', val: `${totalAthletes} sporcu` },
    ];
    const bw = (CW - 3 * 2) / 4;
    meta.forEach((m, i) => {
        const bx = ML + i * (bw + 2);
        fillRect(doc, bx, y, bw, 16, C.light);
        strokeRect(doc, bx, y, bw, 16, C.border);
        fillRect(doc, bx, y, bw, 4, C.navyMid);
        txt(doc, m.label, bx + 2, y + 3, { size: 5.5, color: C.gold, bold: true });
        txt(doc, m.val, bx + 2, y + 10, { size: 8.5, color: C.dark, bold: true, maxWidth: bw - 4 });
    });
    y += 20;

    fillRect(doc, ML, y, CW, 0.3, C.border);
    y += 5;

    /* ══════════════════════════════
       GUN BAZLI PROGRAM
    ══════════════════════════════ */
    for (const dateStr of dateRange) {
        const daySessions = sessionsByDate[dateStr] || [];
        if (!daySessions.length) continue;

        ensureSpace(20);

        // Gun baslik
        fillRect(doc, ML, y, CW, 9, C.navy);
        fillRect(doc, ML, y, 5, 9, C.gold);
        const dayLabel = (() => {
            const d = new Date(dateStr + 'T12:00:00');
            const days = ['Pazar','Pazartesi','Sali','Carsamba','Persembe','Cuma','Cumartesi'];
            const months = ['Ocak','Subat','Mart','Nisan','Mayis','Haziran','Temmuz','Agustos','Eylul','Ekim','Kasim','Aralik'];
            return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
        })();
        txt(doc, dayLabel.toUpperCase(), ML + 8, y + 6, { size: 8.5, color: C.white, bold: true });
        txt(doc, `${daySessions.length} oturum`, W - MR, y + 6, { size: 7, color: C.gold, align: 'right' });
        y += 12;

        // Kategoriye gore grupla
        const catMap = {};
        daySessions.forEach(sess => {
            const ck = sess.kategori || '';
            if (!catMap[ck]) catMap[ck] = [];
            catMap[ck].push(sess);
        });

        for (const [catKey, catSessions] of Object.entries(catMap)) {
            if (!catKey) {
                // Mola gibi kategorisiz oturumlar - basit satirla gec
                catSessions.filter(s => s.tip === 'mola' && !s.rotasyonNo).forEach(s => {
                    ensureSpace(8);
                    fillRect(doc, ML, y, CW, 6, C.goldBg);
                    strokeRect(doc, ML, y, CW, 6, C.gold, 0.25);
                    txt(doc, `MOLA: ${tr(s.molaAdi || 'Mola')}`, ML + 4, y + 4, { size: 7.5, color: C.amber, bold: true });
                    txt(doc, `${s.saat || ''} – ${s.bitisSaat || ''}`, W - MR, y + 4, { size: 7.5, color: C.amber, align: 'right' });
                    y += 7;
                });
                continue;
            }

            ensureSpace(16);

            // Kategori baslik
            fillRect(doc, ML, y, CW, 7.5, C.purple);
            fillRect(doc, ML, y, 4, 7.5, [100, 90, 240]);
            txt(doc, catL(catKey).toUpperCase(), ML + 7, y + 5.2, { size: 8, color: C.white, bold: true });
            const catAthCnt = athleteCounts[catKey] || 0;
            txt(doc, `${catAthCnt} sporcu`, W - MR, y + 5.2, { size: 7, color: [210,200,255], align: 'right' });
            y += 10;

            // Sabit molalar (kategorisiz)
            const sabMolalar = catSessions.filter(s => s.tip === 'mola' && (!s.rotasyonNo || s.rotasyonNo === 0) && !s.dalgaNo);
            sabMolalar.forEach(s => {
                ensureSpace(7);
                fillRect(doc, ML + 2, y, CW - 2, 5.5, C.goldBg);
                strokeRect(doc, ML + 2, y, CW - 2, 5.5, C.gold, 0.25);
                txt(doc, `MOLA: ${tr(s.molaAdi || s.aciklama || 'Mola')}  |  ${s.saat || ''} – ${s.bitisSaat || ''}`, ML + 5, y + 3.8, { size: 7, color: C.amber, bold: false });
                y += 6.5;
            });

            // Isinma oturumlari
            const isinmaList = catSessions.filter(s => s.tip === 'isinma');
            isinmaList.forEach(s => {
                ensureSpace(7);
                fillRect(doc, ML + 2, y, CW - 2, 5.5, C.goldBg);
                strokeRect(doc, ML + 2, y, CW - 2, 5.5, C.gold, 0.3);
                const dLabel = s.dalgaNo ? `${s.dalgaNo}. Dalga ` : '';
                txt(doc, `ISINMA  —  ${dLabel}${s.saat || ''} – ${s.bitisSaat || ''}`, ML + 5, y + 3.8, { size: 7.5, color: C.amber, bold: true });
                y += 7;
            });

            // Dalga bazli rotasyonlar
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
                ensureSpace(26);

                // Dalga baslik
                fillRect(doc, ML + 2, y, CW - 2, 7, C.amberBg);
                strokeRect(doc, ML + 2, y, CW - 2, 7, [251,191,36], 0.35);
                fillRect(doc, ML + 2, y, 3.5, 7, [245,158,11]);

                const waveGroups = [...new Set(
                    Object.values(rotMap).flat().map(s => `Grup ${s.grupNo}${s.bolumAdi || ''}`)
                )].join(', ');
                const allSessFlat = Object.values(rotMap).flat().sort((a,b) => (a.saat||'').localeCompare(b.saat||''));
                const firstSess = allSessFlat[0];
                const lastSess = allSessFlat[allSessFlat.length - 1];

                txt(doc, `${dalgaNo}. DALGA`, ML + 8, y + 4.8, { size: 8, color: C.amber, bold: true });
                txt(doc, tr(waveGroups), ML + 28, y + 4.8, { size: 7, color: C.mid });
                if (firstSess && lastSess) {
                    txt(doc, `${firstSess.saat} – ${lastSess.bitisSaat}`, W - MR, y + 4.8, { size: 7, color: C.amber, align: 'right' });
                }
                y += 9;

                /* Rotasyon matrisi tablosu */
                const rotNums = Object.keys(rotMap).map(Number).sort((a,b) => a-b);
                const aletlerArr = [...new Set(Object.values(rotMap).flat().map(s => s.alet).filter(Boolean))];

                if (aletlerArr.length && rotNums.length) {
                    ensureSpace(18 + aletlerArr.length * 7);

                    const headRow = [
                        { content: 'ALET', styles: { halign: 'left', fontStyle: 'bold', fillColor: C.navyMid, textColor: [255,255,255], cellWidth: 35 } },
                        ...rotNums.map(r => {
                            const s0 = (rotMap[r] || [])[0];
                            const mola = rotMolalar.find(m => m.rotasyonNo === r && (m.dalgaNo||1) == dalgaNo);
                            let txt2 = `ROT. ${r}`;
                            if (s0?.saat) txt2 += `  ${s0.saat}-${s0.bitisSaat}`;
                            if (mola) {
                                const molaDk = Math.round(parseMin(mola.bitisSaat) - parseMin(mola.saat));
                                txt2 += `  (+${molaDk}dk mola)`;
                            }
                            return { content: txt2, styles: { halign: 'center', fontStyle: 'bold', fillColor: C.purple, textColor: [255,255,255] } };
                        }),
                    ];

                    const bodyRows = aletlerArr.map(alet => [
                        { content: aletL(alet), styles: { fontStyle: 'bold', fillColor: C.light, textColor: C.dark } },
                        ...rotNums.map(r => {
                            const groups = (rotMap[r] || []).filter(s => s.alet === alet);
                            const label = groups.map(s => {
                                const pLabel = s.paralel ? '(P)' : '';
                                return `G${s.grupNo}${s.bolumAdi || ''}${pLabel}`;
                            }).join(' + ') || '-';
                            return {
                                content: label,
                                styles: {
                                    halign: 'center',
                                    textColor: groups.length ? C.purple : C.muted,
                                    fontStyle: groups.length ? 'bold' : 'normal',
                                },
                            };
                        }),
                    ]);

                    autoTable(doc, {
                        startY: y,
                        head: [sanitizeTableData(headRow)],
                        body: sanitizeTableData(bodyRows),
                        margin: { left: ML + 2, right: MR + 2 },
                        ...tableStyles(),
                    });
                    y = (doc.lastAutoTable?.finalY ?? y + 15) + 4;
                }

                /* Sporcu listeleri */
                const groupKeys = [...new Set(
                    Object.values(rotMap).flat().map(s => `${s.grupNo}${s.bolumAdi || ''}`)
                )].sort((a,b) => parseInt(a)-parseInt(b));

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

                    // Grup alt baslik
                    fillRect(doc, ML + 4, y, CW - 4, 6.5, C.purpleL);
                    strokeRect(doc, ML + 4, y, CW - 4, 6.5, C.purple, 0.25);
                    fillRect(doc, ML + 4, y, 3, 6.5, C.purple);
                    const startLabel = startSess ? `  |  ${aletL(startSess.alet)} ile baslar` : '';
                    txt(doc, `GRUP ${groupKey}${startLabel}`, ML + 9, y + 4.5, { size: 7.5, color: C.purple, bold: true });
                    txt(doc, `${athletes.length} sporcu`, W - MR, y + 4.5, { size: 7, color: C.mid, align: 'right' });
                    y += 8;

                    // Sporcu tablosu
                    const athHead = [sanitizeTableData([
                        { content: '#', styles: { halign: 'center', fillColor: C.purple, textColor: [255,255,255], cellWidth: 9 } },
                        { content: 'AD SOYAD', styles: { fillColor: C.purple, textColor: [255,255,255], cellWidth: 58 } },
                        { content: 'KULUP / OKUL', styles: { fillColor: C.purple, textColor: [255,255,255], cellWidth: 65 } },
                        { content: 'TIP', styles: { halign: 'center', fillColor: C.purple, textColor: [255,255,255], cellWidth: 18 } },
                    ])];

                    const athBody = sanitizeTableData(athletes.map((ath, ai) => {
                        const isTakim = (ath.yarismaTuru || 'ferdi').toLowerCase().includes('tak');
                        return [
                            { content: String(ath.sirasi || ai + 1), styles: { halign: 'center', textColor: C.mid } },
                            { content: `${ath.ad || ''} ${ath.soyad || ''}`.trim(), styles: { fontStyle: 'bold', textColor: C.dark } },
                            { content: ath.kulup || ath.okul || '-', styles: { textColor: C.mid } },
                            {
                                content: isTakim ? 'TAKIM' : 'FERDI',
                                styles: {
                                    halign: 'center', fontStyle: 'bold',
                                    textColor: isTakim ? C.green : C.purple,
                                    fillColor: isTakim ? C.greenBg : C.purpleL,
                                },
                            },
                        ];
                    }));

                    autoTable(doc, {
                        startY: y,
                        head: athHead,
                        body: athBody,
                        margin: { left: ML + 4, right: MR + 2 },
                        ...tableStyles(),
                        styles: {
                            ...tableStyles().styles,
                            fontSize: 7,
                            cellPadding: [1.8, 3, 1.8, 3],
                        },
                        alternateRowStyles: { fillColor: C.light },
                    });
                    y = (doc.lastAutoTable?.finalY ?? y + 15) + 3;
                }

                y += 3;
            }

            y += 4;
        }

        fillRect(doc, ML, y, CW, 0.3, C.border);
        y += 6;
    }

    drawFooter();

    // Dosya kaydet
    const safeName = tr(selectedComp?.isim || 'Yarisma').replace(/[^a-zA-Z0-9\s_-]/g, '').replace(/\s+/g, '_');
    const now = new Date();
    const dateStamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    doc.save(`TCF_${safeName}_Program_${dateStamp}.pdf`);
}
