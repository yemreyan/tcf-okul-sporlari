/**
 * Aerobik Cimnastik — Puanlama Kriter Sabitleri
 * 2025-2026 GSB Okul Spor Faaliyetleri Resmi Talimatnamesi
 *
 * Final Skor = A + E + D - Ceza
 *
 * Kategoriler (No.26 — CİMNASTİK AEROBİK): TAKIM/FERDİ
 *   • FERDİ: Bireysel kız, Bireysel erkek (1 sporcu)
 *   • TAKIM: Karma çift — 1 kız + 1 erkek (2 sporcu)
 *
 * Step Aerobik (No.24 — CİMNASTİK STEP-AEROBİK): Sadece TAKIM
 */

// ─── Kategoriler (Resmi 2025-2026) ───
export const AEROBIK_CATEGORIES = {

    // ══ Minikler A (İlkokul) — Sadece Mahalli, Sadece Karma Çift ══
    minik_a_karma: {
        label: 'Minikler A Karma Çift',
        group: 'Minikler A',
        tip: 'karma',
        kademe: 'İlkokul',
        yarismaSeviye: 'mahalli',
        dobYears: '2015-2016-2017-2018',
        athleteCount: 2,
        maxElements: 7,
        dDivisor: 1.6,
        routineDuration: 75,
        tolerance: 5,
    },

    // ══ Küçükler (Ortaokul) — Mahalli / Ulusal ══
    kucuk_kiz: {
        label: 'Küçükler Kız (Bireysel)',
        group: 'Küçükler',
        tip: 'ferdi',
        cinsiyet: 'Kız',
        kademe: 'Ortaokul',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2014-2015',
        athleteCount: 1,
        maxElements: 8,
        dDivisor: 1.8,
        routineDuration: 75,
        tolerance: 5,
    },
    kucuk_erkek: {
        label: 'Küçükler Erkek (Bireysel)',
        group: 'Küçükler',
        tip: 'ferdi',
        cinsiyet: 'Erkek',
        kademe: 'Ortaokul',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2014-2015',
        athleteCount: 1,
        maxElements: 8,
        dDivisor: 1.8,
        routineDuration: 75,
        tolerance: 5,
    },
    kucuk_karma: {
        label: 'Küçükler Karma Çift',
        group: 'Küçükler',
        tip: 'karma',
        kademe: 'Ortaokul',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2014-2015',
        athleteCount: 2,
        maxElements: 8,
        dDivisor: 1.8,
        routineDuration: 75,
        tolerance: 5,
    },

    // ══ Yıldızlar (Ortaokul) — Mahalli / Ulusal ══
    yildiz_kiz: {
        label: 'Yıldızlar Kız (Bireysel)',
        group: 'Yıldızlar',
        tip: 'ferdi',
        cinsiyet: 'Kız',
        kademe: 'Ortaokul',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2011-2012-2013',
        athleteCount: 1,
        maxElements: 8,
        dDivisor: 1.8,
        routineDuration: 75,
        tolerance: 5,
    },
    yildiz_erkek: {
        label: 'Yıldızlar Erkek (Bireysel)',
        group: 'Yıldızlar',
        tip: 'ferdi',
        cinsiyet: 'Erkek',
        kademe: 'Ortaokul',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2011-2012-2013',
        athleteCount: 1,
        maxElements: 8,
        dDivisor: 1.8,
        routineDuration: 75,
        tolerance: 5,
    },
    yildiz_karma: {
        label: 'Yıldızlar Karma Çift',
        group: 'Yıldızlar',
        tip: 'karma',
        kademe: 'Ortaokul',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2011-2012-2013',
        athleteCount: 2,
        maxElements: 8,
        dDivisor: 1.8,
        routineDuration: 75,
        tolerance: 5,
    },

    // ══ Gençler (Lise) — Mahalli / Ulusal ══
    genc_kiz: {
        label: 'Gençler Kız (Bireysel)',
        group: 'Gençler',
        tip: 'ferdi',
        cinsiyet: 'Kız',
        kademe: 'Lise',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2007-2008-2009-2010-2011',
        athleteCount: 1,
        maxElements: 8,
        dDivisor: 2.0,
        routineDuration: 85,
        tolerance: 5,
    },
    genc_erkek: {
        label: 'Gençler Erkek (Bireysel)',
        group: 'Gençler',
        tip: 'ferdi',
        cinsiyet: 'Erkek',
        kademe: 'Lise',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2007-2008-2009-2010-2011',
        athleteCount: 1,
        maxElements: 8,
        dDivisor: 2.0,
        routineDuration: 85,
        tolerance: 5,
    },
    genc_karma: {
        label: 'Gençler Karma Çift',
        group: 'Gençler',
        tip: 'karma',
        kademe: 'Lise',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2007-2008-2009-2010-2011',
        athleteCount: 2,
        maxElements: 8,
        dDivisor: 2.0,
        routineDuration: 85,
        tolerance: 5,
    },

    // ══ Step Aerobik (No.24) — Sadece Takım ══
    step_minik: {
        label: 'Step Minikler Takım',
        group: 'Step Aerobik',
        tip: 'takim',
        kademe: 'İlkokul',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2015-2016-2017-2018',
        athleteCount: 6,
        athleteMin: 5, athleteMax: 8,
        maxElements: 7,
        dDivisor: 1.6,
        routineDuration: 75,
        tolerance: 5,
    },
    step_kucuk: {
        label: 'Step Küçükler Takım',
        group: 'Step Aerobik',
        tip: 'takim',
        kademe: 'Ortaokul',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2014-2015',
        athleteCount: 6,
        athleteMin: 5, athleteMax: 8,
        maxElements: 8,
        dDivisor: 1.8,
        routineDuration: 75,
        tolerance: 5,
    },
    step_yildiz: {
        label: 'Step Yıldızlar Takım',
        group: 'Step Aerobik',
        tip: 'takim',
        kademe: 'Ortaokul',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2011-2012-2013',
        athleteCount: 6,
        athleteMin: 5, athleteMax: 8,
        maxElements: 8,
        dDivisor: 1.8,
        routineDuration: 75,
        tolerance: 5,
    },
    step_genc: {
        label: 'Step Gençler Takım',
        group: 'Step Aerobik',
        tip: 'takim',
        kademe: 'Lise',
        yarismaSeviye: 'mahalli_ulusal',
        dobYears: '2007-2008-2009-2010-2011',
        athleteCount: 6,
        athleteMin: 5, athleteMax: 8,
        maxElements: 8,
        dDivisor: 1.8,
        routineDuration: 85,
        tolerance: 5,
    },
};

// ─── Element Aileleri ───
// FIG 2025-2028: 3 Grup (A-Zemin, B-Havai, C-Ayakta), 8 Aile
export const ELEMENT_FAMILIES = [
    // Grup A — Zemin (Floor)
    { id: 'A1', group: 'A', groupLabel: 'Zemin', name: 'Dinamik Kuvvet', description: 'Push-up varyasyonları' },
    { id: 'A2', group: 'A', groupLabel: 'Zemin', name: 'Statik Kuvvet', description: 'Planche, V-destek, tutma pozisyonları' },
    { id: 'A3', group: 'A', groupLabel: 'Zemin', name: 'Esneklik & Denge', description: 'Split, illusion, esneklik hareketleri' },

    // Grup B — Havai (Airborne)
    { id: 'B1', group: 'B', groupLabel: 'Havai', name: 'Sıçrama & Atılma', description: 'Straddle jump, pike jump, cossack' },
    { id: 'B2', group: 'B', groupLabel: 'Havai', name: 'Akrobatik Sıçrama', description: 'Salto, flic-flac, aerial hareketler' },

    // Grup C — Ayakta (Standing)
    { id: 'C1', group: 'C', groupLabel: 'Ayakta', name: 'Koreografi & Geçiş', description: 'Koreografik geçiş elementleri' },
    { id: 'C2', group: 'C', groupLabel: 'Ayakta', name: 'Dönüş & Pivot', description: 'Tek ayak pivot dönüşleri' },
    { id: 'C3', group: 'C', groupLabel: 'Ayakta', name: 'Kombine Hareketler', description: 'Birden fazla grubu birleştiren elementler' },
];

// ─── Aile Kısıtlamaları ───
// FIG 2025-2028: Min 4 farklı aile, max 2 element aynı aileden
export const FAMILY_CONSTRAINTS = {
    minFamilies: 4,
    maxPerFamily: 2,
};

// ─── Zorluk Değerleri ───
// FIG 2025-2028: Min 0.3, Max 1.0
export const DIFFICULTY_VALUES = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

// ─── Ceza Türleri ───
export const PENALTY_TYPES = {
    fall: {
        label: 'Düşme',
        options: [0, 0.5, 1.0, 1.5, 2.0],
    },
    time: {
        label: 'Süre İhlali',
        options: [0, 0.5],
    },
    line: {
        label: 'Alan İhlali',
        options: [0, 0.1, 0.2, 0.3],
    },
    music: {
        label: 'Müzik İhlali',
        options: [0, 0.5, 1.0],
    },
    lift: {
        label: 'Kaldırma/Partner',
        options: [0, 0.5, 1.0, 2.0],
    },
    costume: {
        label: 'Kıyafet İhlali',
        options: [0, 0.5],
    },
};
