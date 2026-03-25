/**
 * Aerobik Cimnastik — Puanlama Kriter Sabitleri
 * FIG 2025-2028 Code of Points / TCF Okul Sporları
 *
 * Final Skor = A + E + D - Ceza
 */

// ─── Kategoriler ───
// FIG 2025-2028: Tüm kategorilerde max 8 element
// Divisor: IM/IW/MP = 2.0, Mixed Trio = 1.9, Women Trio/Group = 1.8
export const AEROBIK_CATEGORIES = {
    // FIG Resmi Kategoriler
    IM: { label: 'Bireysel Erkek (IM)', maxElements: 8, dDivisor: 2.0, routineDuration: 85, tolerance: 5 },
    IW: { label: 'Bireysel Kadın (IW)', maxElements: 8, dDivisor: 2.0, routineDuration: 85, tolerance: 5 },
    MP: { label: 'Çift (MP)', maxElements: 8, dDivisor: 2.0, routineDuration: 85, tolerance: 5 },
    TR: { label: 'Trio (TR)', maxElements: 8, dDivisor: 1.9, routineDuration: 85, tolerance: 5 },
    GR: { label: 'Grup (GR)', maxElements: 8, dDivisor: 1.8, routineDuration: 85, tolerance: 5 },

    // Okul Sporları — Minik (basitleştirilmiş)
    minik_erkek: { label: 'Minik Erkek', maxElements: 7, dDivisor: 1.6, routineDuration: 75, tolerance: 5 },
    minik_kiz: { label: 'Minik Kız', maxElements: 7, dDivisor: 1.6, routineDuration: 75, tolerance: 5 },
    minik_cift: { label: 'Minik Çift', maxElements: 7, dDivisor: 1.6, routineDuration: 75, tolerance: 5 },
    minik_grup: { label: 'Minik Grup', maxElements: 7, dDivisor: 1.6, routineDuration: 75, tolerance: 5 },

    // Okul Sporları — Yıldız
    yildiz_erkek: { label: 'Yıldız Erkek', maxElements: 8, dDivisor: 1.8, routineDuration: 75, tolerance: 5 },
    yildiz_kiz: { label: 'Yıldız Kız', maxElements: 8, dDivisor: 1.8, routineDuration: 75, tolerance: 5 },
    yildiz_cift: { label: 'Yıldız Çift', maxElements: 8, dDivisor: 1.8, routineDuration: 75, tolerance: 5 },
    yildiz_trio: { label: 'Yıldız Trio', maxElements: 8, dDivisor: 1.8, routineDuration: 75, tolerance: 5 },
    yildiz_grup: { label: 'Yıldız Grup', maxElements: 8, dDivisor: 1.8, routineDuration: 75, tolerance: 5 },

    // Okul Sporları — Genç
    genc_erkek: { label: 'Genç Erkek', maxElements: 8, dDivisor: 2.0, routineDuration: 85, tolerance: 5 },
    genc_kiz: { label: 'Genç Kız', maxElements: 8, dDivisor: 2.0, routineDuration: 85, tolerance: 5 },
    genc_cift: { label: 'Genç Çift', maxElements: 8, dDivisor: 2.0, routineDuration: 85, tolerance: 5 },
    genc_trio: { label: 'Genç Trio', maxElements: 8, dDivisor: 1.9, routineDuration: 85, tolerance: 5 },
    genc_grup: { label: 'Genç Grup', maxElements: 8, dDivisor: 1.8, routineDuration: 85, tolerance: 5 },

    // Step Aerobik
    step_minik: { label: 'Step Minik', maxElements: 7, dDivisor: 1.6, routineDuration: 75, tolerance: 5 },
    step_yildiz: { label: 'Step Yıldız', maxElements: 8, dDivisor: 1.8, routineDuration: 75, tolerance: 5 },
    step_genc: { label: 'Step Genç', maxElements: 8, dDivisor: 1.8, routineDuration: 85, tolerance: 5 },
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
