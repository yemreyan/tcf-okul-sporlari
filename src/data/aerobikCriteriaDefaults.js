/**
 * Aerobik Cimnastik — Puanlama Kriter Sabitleri
 * FIG / TCF Okul Sporları Aerobik Kuralları
 *
 * Final Skor = A + E + D + CJP - Penalties
 */

// ─── Kategoriler ───
// IM/IW = Individual Men/Women → 9 element, divisor 2.0
// MP = Mixed Pair, TR = Trio, GR = Group → 8 element, divisor 1.8
export const AEROBIK_CATEGORIES = {
    IM: { label: 'Bireysel Erkek (IM)', maxElements: 9, dDivisor: 2.0 },
    IW: { label: 'Bireysel Kadın (IW)', maxElements: 9, dDivisor: 2.0 },
    MP: { label: 'Çift (MP)', maxElements: 8, dDivisor: 1.8 },
    TR: { label: 'Trio (TR)', maxElements: 8, dDivisor: 1.8 },
    GR: { label: 'Grup (GR)', maxElements: 8, dDivisor: 1.8 },
    // Yaş kategorileri — okul sporları
    minik_erkek: { label: 'Minik Erkek', maxElements: 7, dDivisor: 1.6 },
    minik_kadin: { label: 'Minik Kadın', maxElements: 7, dDivisor: 1.6 },
    yildiz_erkek: { label: 'Yıldız Erkek', maxElements: 8, dDivisor: 1.8 },
    yildiz_kadin: { label: 'Yıldız Kadın', maxElements: 8, dDivisor: 1.8 },
    genc_erkek: { label: 'Genç Erkek', maxElements: 9, dDivisor: 2.0 },
    genc_kadin: { label: 'Genç Kadın', maxElements: 9, dDivisor: 2.0 },
    genc_cift: { label: 'Genç Çift', maxElements: 8, dDivisor: 1.8 },
    genc_trio: { label: 'Genç Trio', maxElements: 8, dDivisor: 1.8 },
    genc_grup: { label: 'Genç Grup', maxElements: 8, dDivisor: 1.8 },
};

// ─── Element Aileleri ───
// FIG: 3 Grup (A-Floor, B-Airborne, C-Standing), 8 Aile
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

// ─── Zorluk Değerleri ───
// Her element 0.1 ile 1.0 arası değer alır
export const DIFFICULTY_VALUES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

// ─── Ceza Türleri ───
export const PENALTY_TYPES = {
    time: {
        label: 'Süre İhlali',
        options: [0, 0.1, 0.2, 0.3, 0.5],
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
