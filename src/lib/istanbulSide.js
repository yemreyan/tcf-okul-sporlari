/**
 * İstanbul Anadolu / Avrupa yaka tespiti.
 * Hem FinalsPage hem ScoreboardPage tarafından paylaşılır.
 *
 * - normalizeIlceKey: trim + NFD + diakritik temizliği + Türkçe→ASCII + harf-dışı atımı
 * - ISTANBUL_ANADOLU / ISTANBUL_AVRUPA: 39 ilçenin normalize edilmiş Set'leri
 * - istanbulSideOf(ilce, fallbackText): 'anadolu' | 'avrupa' | null
 *     1) ilce alanını dene
 *     2) bulunamazsa fallbackText (okul/adres) içinde ilçe adı geçiyor mu kontrol et
 */

export function normalizeIlceKey(s) {
    return String(s || '')
        .trim()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLocaleUpperCase('tr-TR')
        .replace(/İ/g, 'I')
        .replace(/Ş/g, 'S').replace(/Ğ/g, 'G')
        .replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C')
        .replace(/[^A-Z]/g, '');
}

export const ISTANBUL_ANADOLU = new Set([
    'ADALAR', 'ATASEHIR', 'BEYKOZ', 'CEKMEKOY',
    'KADIKOY', 'KARTAL', 'MALTEPE', 'PENDIK',
    'SANCAKTEPE', 'SULTANBEYLI', 'SILE',
    'TUZLA', 'UMRANIYE', 'USKUDAR',
].map(normalizeIlceKey));

export const ISTANBUL_AVRUPA = new Set([
    'ARNAVUTKOY', 'AVCILAR', 'BAGCILAR',
    'BAHCELIEVLER', 'BAKIRKOY',
    'BASAKSEHIR', 'BAYRAMPASA',
    'BESIKTAS', 'BEYLIKDUZU', 'BEYOGLU',
    'BUYUKCEKMECE', 'CATALCA',
    'ESENLER', 'ESENYURT', 'EYUPSULTAN', 'EYUP',
    'FATIH', 'GAZIOSMANPASA',
    'GUNGOREN', 'KAGITHANE',
    'KUCUKCEKMECE', 'SARIYER', 'SILIVRI',
    'SULTANGAZI', 'SISLI', 'ZEYTINBURNU',
].map(normalizeIlceKey));

export function istanbulSideOf(ilce, fallbackText) {
    const tryMatch = (raw) => {
        const k = normalizeIlceKey(raw);
        if (!k) return null;
        if (ISTANBUL_ANADOLU.has(k)) return 'anadolu';
        if (ISTANBUL_AVRUPA.has(k)) return 'avrupa';
        for (const il of ISTANBUL_ANADOLU) if (k.includes(il)) return 'anadolu';
        for (const il of ISTANBUL_AVRUPA) if (k.includes(il)) return 'avrupa';
        return null;
    };
    const direct = tryMatch(ilce);
    if (direct) return direct;
    if (fallbackText) {
        const fb = tryMatch(fallbackText);
        if (fb) return fb;
    }
    return null;
}
