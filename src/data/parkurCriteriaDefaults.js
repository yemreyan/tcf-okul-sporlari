/**
 * Parkur Cimnastik — Puanlama Kriter Sabitleri
 * 2025-2026 GSB Okul Spor Faaliyetleri Resmi Talimatnamesi (No.25 — CİMNASTİK PARKUR)
 *
 * Final Skor = D + E − Ceza
 *   D  = Zorluk (element değerlerinin toplamı)
 *   E  = İcra (4 hakem, en yüksek/düşük kesinti atılır, kalan 2 ortalanır → 10 − avg)
 *   Ceza = Çeşitli teknik ihlal kesintileri
 *
 * Kategoriler: Minikler A (sadece mahalli), Küçükler, Yıldızlar, Gençler B, Gençler A
 * Tümü Ferdi — Okul sporlarında parkurda takım kategorisi yok
 */

// ─── Kategoriler (Resmi 2025-2026) ───
export const PARKUR_CATEGORIES = {

    // ── Minikler A (İlkokul) — Sadece Mahalli ──
    minik_a_kiz: {
        label: 'Minikler A Kız',
        group: 'Minikler A',
        cinsiyet: 'Kız',
        kademe: 'İlkokul',
        yarismaSeviye: 'mahalli',
        dobYears: '2015-2016-2017-2018',
        maxElements: 5,
        judgeCount: 4,
        athleteCount: 1,
    },
    minik_a_erkek: {
        label: 'Minikler A Erkek',
        group: 'Minikler A',
        cinsiyet: 'Erkek',
        kademe: 'İlkokul',
        yarismaSeviye: 'mahalli',
        dobYears: '2015-2016-2017-2018',
        maxElements: 5,
        judgeCount: 4,
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
        maxElements: 7,
        judgeCount: 4,
        athleteCount: 1,
    },
    kucuk_erkek: {
        label: 'Küçükler Erkek',
        group: 'Küçükler',
        cinsiyet: 'Erkek',
        kademe: 'Ortaokul',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2014-2015',
        maxElements: 7,
        judgeCount: 4,
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
        maxElements: 8,
        judgeCount: 4,
        athleteCount: 1,
    },
    yildiz_erkek: {
        label: 'Yıldızlar Erkek',
        group: 'Yıldızlar',
        cinsiyet: 'Erkek',
        kademe: 'Ortaokul',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2011-2012-2013',
        maxElements: 8,
        judgeCount: 4,
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
        maxElements: 9,
        judgeCount: 4,
        athleteCount: 1,
    },
    genc_b_erkek: {
        label: 'Gençler B Erkek',
        group: 'Gençler B',
        cinsiyet: 'Erkek',
        kademe: 'Lise',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2010-2011',
        maxElements: 9,
        judgeCount: 4,
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
        maxElements: 10,
        judgeCount: 4,
        athleteCount: 1,
    },
    genc_a_erkek: {
        label: 'Gençler A Erkek',
        group: 'Gençler A',
        cinsiyet: 'Erkek',
        kademe: 'Lise',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2007-2008-2009-2010-2011',
        maxElements: 10,
        judgeCount: 4,
        athleteCount: 1,
    },
};

// ─── Element Aileleri (Parkur) ───
// 4 Grup (A–D): Vault, Dinamik, Denge, Akrobatik
export const PARKUR_ELEMENT_FAMILIES = [
    // Grup A — Temel Geçişler
    {
        id: 'vault',
        group: 'A',
        groupLabel: 'Temel Geçişler',
        name: 'Vault / Geçiş',
        description: 'Engel aşma ve geçiş hareketleri',
    },
    // Grup B — Dinamik Hareketler
    {
        id: 'dynamic',
        group: 'B',
        groupLabel: 'Dinamik Hareketler',
        name: 'Dinamik',
        description: 'Sıçrama, yuvarlanma ve ivme hareketleri',
    },
    // Grup C — Denge ve Kontrol
    {
        id: 'balance',
        group: 'C',
        groupLabel: 'Denge ve Kontrol',
        name: 'Denge / Kontrol',
        description: 'Denge, duruş ve kontrollü hareketler',
    },
    // Grup D — Akrobatik Unsurlar
    {
        id: 'acrobatic',
        group: 'D',
        groupLabel: 'Akrobatik Unsurlar',
        name: 'Akrobatik',
        description: 'Salto, el takla ve akrobatik geçişler',
    },
];

// ─── Zorluk Değerleri ───
export const PARKUR_DIFFICULTY_VALUES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

// ─── Aile Kısıtlamaları ───
// Min 2 farklı aile, aynı aileden max 3 element
export const FAMILY_CONSTRAINTS = {
    maxPerFamily: 3,
    minFamilies: 2,
};

// ─── Ceza Türleri ───
export const PARKUR_PENALTY_TYPES = {
    dusme: {
        label: 'Düşme / Temas',
        icon: 'airline_seat_flat',
        options: [0, 0.5, 1.0],
    },
    sinir_disi: {
        label: 'Sınır Dışı / Rota İhlali',
        icon: 'border_outer',
        options: [0, 0.3, 0.5],
    },
    zaman: {
        label: 'Süre İhlali',
        icon: 'timer_off',
        options: [0, 0.3, 0.5, 1.0],
    },
    teknik: {
        label: 'Teknik İhlal',
        icon: 'report_problem',
        options: [0, 0.3, 0.5],
    },
    kiyafet: {
        label: 'Kıyafet İhlali',
        icon: 'checkroom',
        options: [0, 0.3],
    },
};
