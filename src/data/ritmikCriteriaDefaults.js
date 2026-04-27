/**
 * Ritmik Cimnastik — Kriter Sabitleri
 * TCF Okul Sporları Talinamesi'ne göre hazırlanmıştır.
 * 2025-2026 sezonu: tüm kategorilerde Top ve Kurdele aletleriyle yarışılır.
 */

// ─── Aletler ─────────────────────────────────────────────────────────────────
export const RITMIK_ALETLER = {
    top: { key: 'top', label: 'Top', icon: 'sports_handball' },
    kurdele: { key: 'kurdele', label: 'Kurdele', icon: 'gesture' },
};

// ─── Kategoriler ─────────────────────────────────────────────────────────────
// Her kategoride sporcular Top ve Kurdele ile ayrı ayrı yarışır.
// Takım kuralları (TCF/MEB 2025-2026 Uygulama Esasları):
//   Minikler B, A · Küçükler · Yıldızlar : en az 2, en fazla 4 sporcu (2 asil + 2 yedek)
//   Gençler                               : en az 2, en fazla 3 sporcu (2 asil + 1 yedek)
export const RITMIK_CATEGORIES = {
    minik_b_kiz: {
        label: 'Minik B Kız',
        group: 'Minik B',
        cinsiyet: 'K',
        kademe: 'Minik B',
        yarismaSeviye: 'Mahalli',
        dobYears: [2017, 2018, 2019],
        judgeCount: 4,
        aletler: ['top', 'kurdele'],
        hasDA: true,
        // Takım kadrosu
        minTeam: 2, maxTeam: 4, asiSayisi: 2, yedekSayisi: 2,
    },
    minik_a_kiz: {
        label: 'Minik A Kız',
        group: 'Minik A',
        cinsiyet: 'K',
        kademe: 'Minik A',
        yarismaSeviye: 'Mahalli',
        dobYears: [2014, 2015, 2016],
        judgeCount: 4,
        aletler: ['top', 'kurdele'],
        hasDA: true,
        minTeam: 2, maxTeam: 4, asiSayisi: 2, yedekSayisi: 2,
    },
    kucuk_kiz: {
        label: 'Küçük Kız',
        group: 'Küçük',
        cinsiyet: 'K',
        kademe: 'Küçük',
        yarismaSeviye: 'Mahalli / Ulusal',
        dobYears: [2013, 2014],
        judgeCount: 4,
        aletler: ['top', 'kurdele'],
        hasDA: true,
        minTeam: 2, maxTeam: 4, asiSayisi: 2, yedekSayisi: 2,
    },
    yildiz_kiz: {
        label: 'Yıldız Kız',
        group: 'Yıldız',
        cinsiyet: 'K',
        kademe: 'Yıldız',
        yarismaSeviye: 'Mahalli / Ulusal',
        dobYears: [2010, 2011, 2012],
        judgeCount: 4,
        aletler: ['top', 'kurdele'],
        hasDA: true,
        minTeam: 2, maxTeam: 4, asiSayisi: 2, yedekSayisi: 2,
    },
    genc_kiz: {
        label: 'Genç Kız',
        group: 'Genç',
        cinsiyet: 'K',
        kademe: 'Genç',
        yarismaSeviye: 'Mahalli / Ulusal',
        dobYears: [2006, 2007, 2008, 2009, 2010],
        judgeCount: 4,
        aletler: ['top', 'kurdele'],
        hasDA: true,
        minTeam: 2, maxTeam: 3, asiSayisi: 2, yedekSayisi: 1,
    },
};

// ─── Geriye dönük uyumluluk — eski genc_a/genc_b başvurularını genc_kiz'e yönlendir ───
export const RITMIK_CATEGORY_ALIASES = {
    genc_a_kiz: 'genc_kiz',
    genc_b_kiz: 'genc_kiz',
};

// ─── Element Aileleri (referans — artık puanlama ekranında kullanılmıyor) ────
export const RITMIK_ELEMENT_FAMILIES = [
    { id: 'denge_esneklik', group: 'A', groupLabel: 'A', name: 'Denge ve Esneklik', description: 'Denge duruşları, esneklik serileri, dalga hareketleri' },
    { id: 'sicrama_atlama', group: 'B', groupLabel: 'B', name: 'Sıçrama ve Atlama', description: 'Sıçramalar, atlamalar, şaseler' },
    { id: 'donme_piruet',   group: 'C', groupLabel: 'C', name: 'Dönme ve Pirüet',   description: 'Pirüetler, şalite dönmeleri, seri dönmeler' },
    { id: 'akrobatik',      group: 'D', groupLabel: 'D', name: 'Akrobatik Unsurlar', description: 'Amut, takla, akrobatik geçişler' },
];

export const RITMIK_DIFFICULTY_VALUES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

export const RITMIK_FAMILY_CONSTRAINTS = { maxPerFamily: 3, minFamilies: 2 };

// ─── Ceza Tipleri (referans — artık tek manuel giriş ile değiştirildi) ───────
export const RITMIK_PENALTY_TYPES = {
    alet_dusme: { label: 'Alet Düşmesi', icon: 'do_not_touch', options: [0, 0.5, 1.0] },
    alan_disi:  { label: 'Alan Dışı',    icon: 'crop_free',    options: [0, 0.3, 0.5] },
    sure:       { label: 'Süre İhlali',  icon: 'timer_off',    options: [0, 0.3, 0.5, 1.0] },
    teknik:     { label: 'Teknik Hata',  icon: 'warning',      options: [0, 0.3, 0.5] },
    kiyafet:    { label: 'Kıyafet İhlali', icon: 'checkroom',  options: [0, 0.3] },
};
