/**
 * Trampolin Cimnastik — Puanlama Kriter Sabitleri
 * 2025-2026 GSB Okul Spor Faaliyetleri Resmi Talimatnamesi
 *
 * Final Skor = D + E + T − HD − Ceza
 *   D  = Zorluk (hareket zorluklarının toplamı)
 *   E  = İcra (4 hakem, en yüksek/düşük kesinti atılır, kalan 2 ortalanır → 10 − avg)
 *   T  = Uçuş Süresi / ToF (manuel girilir, saniye cinsinden)
 *   HD = Yatay Yer Değiştirme kesintisi
 *
 * Kategoriler: Sadece Bireysel (FERDİ) — Okul sporlarında senkron yok
 * Kademeler: Minikler A (mahalli), Küçükler, Yıldızlar, Gençler B, Gençler A
 */

// ─── Kategoriler (Resmi 2025-2026) ───
export const TRAMPOLIN_CATEGORIES = {
    // ── Minikler A (İlkokul) — Sadece Mahalli ──
    minik_a_kiz: {
        label: 'Minikler A Kız',
        group: 'Minikler A',
        cinsiyet: 'Kız',
        kademe: 'İlkokul',
        yarismaSeviye: 'mahalli',
        dobYears: '2015-2016-2017-2018',
        skillCount: 6,
        judgeCount: 4,
        hasToF: false,
        athleteCount: 1,
    },
    minik_a_erkek: {
        label: 'Minikler A Erkek',
        group: 'Minikler A',
        cinsiyet: 'Erkek',
        kademe: 'İlkokul',
        yarismaSeviye: 'mahalli',
        dobYears: '2015-2016-2017-2018',
        skillCount: 6,
        judgeCount: 4,
        hasToF: false,
        athleteCount: 1,
    },

    // ── Küçükler (Ortaokul) — Mahalli / Ulusal ──
    kucuk_kiz: {
        label: 'Küçükler Kız',
        group: 'Küçükler',
        cinsiyet: 'Kız',
        kademe: 'Ortaokul',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2014-2015',
        skillCount: 8,
        judgeCount: 4,
        hasToF: true,
        athleteCount: 1,
    },
    kucuk_erkek: {
        label: 'Küçükler Erkek',
        group: 'Küçükler',
        cinsiyet: 'Erkek',
        kademe: 'Ortaokul',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2014-2015',
        skillCount: 8,
        judgeCount: 4,
        hasToF: true,
        athleteCount: 1,
    },

    // ── Yıldızlar (Ortaokul) — Mahalli / Ulusal ──
    yildiz_kiz: {
        label: 'Yıldızlar Kız',
        group: 'Yıldızlar',
        cinsiyet: 'Kız',
        kademe: 'Ortaokul',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2011-2012-2013',
        skillCount: 10,
        judgeCount: 4,
        hasToF: true,
        athleteCount: 1,
    },
    yildiz_erkek: {
        label: 'Yıldızlar Erkek',
        group: 'Yıldızlar',
        cinsiyet: 'Erkek',
        kademe: 'Ortaokul',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2011-2012-2013',
        skillCount: 10,
        judgeCount: 4,
        hasToF: true,
        athleteCount: 1,
    },

    // ── Gençler B (Lise) — Mahalli / Ulusal ──
    genc_b_kiz: {
        label: 'Gençler B Kız',
        group: 'Gençler B',
        cinsiyet: 'Kız',
        kademe: 'Lise',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2010-2011',
        skillCount: 10,
        judgeCount: 4,
        hasToF: true,
        athleteCount: 1,
    },
    genc_b_erkek: {
        label: 'Gençler B Erkek',
        group: 'Gençler B',
        cinsiyet: 'Erkek',
        kademe: 'Lise',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2010-2011',
        skillCount: 10,
        judgeCount: 4,
        hasToF: true,
        athleteCount: 1,
    },

    // ── Gençler A (Lise) — Mahalli / Ulusal ──
    genc_a_kiz: {
        label: 'Gençler A Kız',
        group: 'Gençler A',
        cinsiyet: 'Kız',
        kademe: 'Lise',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2007-2008-2009-2010-2011',
        skillCount: 10,
        judgeCount: 4,
        hasToF: true,
        athleteCount: 1,
    },
    genc_a_erkek: {
        label: 'Gençler A Erkek',
        group: 'Gençler A',
        cinsiyet: 'Erkek',
        kademe: 'Lise',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2007-2008-2009-2010-2011',
        skillCount: 10,
        judgeCount: 4,
        hasToF: true,
        athleteCount: 1,
    },
};

// ─── Hareket Zorluk Değerleri ───
export const DIFFICULTY_STEP    = 0.1;
export const DIFFICULTY_MIN     = 0.0;
export const DIFFICULTY_MAX     = 2.0;

// Hızlı seçim presetleri
export const DIFFICULTY_PRESETS = [
    0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9,
    1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0,
];

// ─── Yatay Yer Değiştirme (HD) Kesintisi ───
export const HD_OPTIONS = [
    { value: 0.0, label: '0.0 — Yok'      },
    { value: 0.3, label: '0.3 — Az'       },
    { value: 0.6, label: '0.6 — Orta'     },
    { value: 0.9, label: '0.9'            },
    { value: 1.2, label: '1.2'            },
    { value: 1.5, label: '1.5 — Fazla'    },
    { value: 1.8, label: '1.8'            },
    { value: 2.1, label: '2.1'            },
    { value: 2.4, label: '2.4'            },
    { value: 3.0, label: '3.0 — Maksimum' },
];

// ─── Ceza Türleri ───
export const TRAMPOLIN_PENALTY_TYPES = {
    dusman: {
        label: 'Düşme',
        icon: 'airline_seat_flat',
        options: [0, 0.5, 1.0],
    },
    durma: {
        label: 'Durma / Ayak Vurma',
        icon: 'pan_tool',
        options: [0, 0.5, 1.0],
    },
    sinir: {
        label: 'Sınır Dışı',
        icon: 'border_outer',
        options: [0, 0.2, 0.5],
    },
    kiyafet: {
        label: 'Kıyafet İhlali',
        icon: 'checkroom',
        options: [0, 0.3],
    },
    diger: {
        label: 'Diğer',
        icon: 'report_problem',
        options: [0, 0.1, 0.2, 0.3, 0.5, 1.0],
    },
};
