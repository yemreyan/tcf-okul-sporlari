/**
 * Ritmik Cimnastik — Kriter Sabitleri
 * TCF Okul Sporları Talinamesi'ne göre hazırlanmıştır.
 */

// ─── Kategoriler ─────────────────────────────────────────────────────────────
export const RITMIK_CATEGORIES = {
    minik_b_kiz: {
        label: 'Minik B Kız',
        group: 'Minik B',
        cinsiyet: 'K',
        kademe: 'Minik B',
        yarismaSeviye: 'Mahalli',
        dobYears: [2017, 2018, 2019],
        maxElements: 6,
        judgeCount: 4,
        athleteCount: 1,
        alet: 'Serbest',
        hasDA: false,  // Serbest seri — alet yok, DA puanı uygulanmaz
    },
    minik_a_kiz: {
        label: 'Minik A Kız',
        group: 'Minik A',
        cinsiyet: 'K',
        kademe: 'Minik A',
        yarismaSeviye: 'Mahalli',
        dobYears: [2014, 2015, 2016],
        maxElements: 5,
        judgeCount: 4,
        athleteCount: 1,
        alet: 'İp',
        hasDA: true,   // FIG Gençler Kuralları — DA + DB geçerli
    },
    kucuk_kiz: {
        label: 'Küçük Kız',
        group: 'Küçük',
        cinsiyet: 'K',
        kademe: 'Küçük',
        yarismaSeviye: 'Mahalli / Ulusal',
        dobYears: [2013, 2014],
        maxElements: 7,
        judgeCount: 4,
        athleteCount: 1,
        alet: 'İp',
        hasDA: true,   // FIG Gençler Kuralları — DA + DB geçerli
    },
    yildiz_kiz: {
        label: 'Yıldız Kız',
        group: 'Yıldız',
        cinsiyet: 'K',
        kademe: 'Yıldız',
        yarismaSeviye: 'Mahalli / Ulusal',
        dobYears: [2010, 2011, 2012],
        maxElements: 8,
        judgeCount: 4,
        athleteCount: 1,
        alet: 'Çember',
        hasDA: true,   // FIG Gençler Kuralları — DA + DB geçerli
    },
    genc_b_kiz: {
        label: 'Genç B Kız',
        group: 'Genç B',
        cinsiyet: 'K',
        kademe: 'Genç B',
        yarismaSeviye: 'Mahalli / Ulusal',
        dobYears: [2008, 2009, 2010],
        maxElements: 9,
        judgeCount: 4,
        athleteCount: 1,
        alet: 'Çember / Labut',
        hasDA: true,   // FIG Gençler Kuralları — DA + DB geçerli
    },
    genc_a_kiz: {
        label: 'Genç A Kız',
        group: 'Genç A',
        cinsiyet: 'K',
        kademe: 'Genç A',
        yarismaSeviye: 'Mahalli / Ulusal',
        dobYears: [2006, 2007, 2008],
        maxElements: 10,
        judgeCount: 4,
        athleteCount: 1,
        alet: 'Çember / Labut',
        hasDA: true,   // FIG Gençler Kuralları — DA + DB geçerli
    },
};

// ─── Element Aileleri ─────────────────────────────────────────────────────────
// Ritmik Cimnastik'te vücut unsurları 4 ana aileye ayrılır
export const RITMIK_ELEMENT_FAMILIES = [
    {
        id: 'denge_esneklik',
        group: 'A',
        groupLabel: 'A',
        name: 'Denge ve Esneklik',
        description: 'Denge duruşları, esneklik serileri, dalga hareketleri',
    },
    {
        id: 'sicrama_atlama',
        group: 'B',
        groupLabel: 'B',
        name: 'Sıçrama ve Atlama',
        description: 'Sıçramalar, atlamalar, şaseler',
    },
    {
        id: 'donme_piruet',
        group: 'C',
        groupLabel: 'C',
        name: 'Dönme ve Pirüet',
        description: 'Pirüetler, şalite dönmeleri, seri dönmeler',
    },
    {
        id: 'akrobatik',
        group: 'D',
        groupLabel: 'D',
        name: 'Akrobatik Unsurlar',
        description: 'Amut, takla, akrobatik geçişler',
    },
];

// ─── Zorluk Değerleri ─────────────────────────────────────────────────────────
export const RITMIK_DIFFICULTY_VALUES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

// ─── Aile Kısıtlamaları ───────────────────────────────────────────────────────
export const RITMIK_FAMILY_CONSTRAINTS = {
    maxPerFamily: 3,   // Aynı aileden en fazla 3 element
    minFamilies: 2,    // En az 2 farklı aile kullanılmalı
};

// ─── Ceza Tipleri ─────────────────────────────────────────────────────────────
export const RITMIK_PENALTY_TYPES = {
    alet_dusme: {
        label: 'Alet Düşmesi',
        icon: 'do_not_touch',
        options: [0, 0.5, 1.0],
    },
    alan_disi: {
        label: 'Alan Dışı',
        icon: 'crop_free',
        options: [0, 0.3, 0.5],
    },
    sure: {
        label: 'Süre İhlali',
        icon: 'timer_off',
        options: [0, 0.3, 0.5, 1.0],
    },
    teknik: {
        label: 'Teknik Hata',
        icon: 'warning',
        options: [0, 0.3, 0.5],
    },
    kiyafet: {
        label: 'Kıyafet İhlali',
        icon: 'checkroom',
        options: [0, 0.3],
    },
};
