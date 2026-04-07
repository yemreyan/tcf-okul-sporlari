/**
 * KVKK uyumluluğu için kişisel veri maskeleme yardımcıları.
 * Tüm UI gösterimlerinde ham veri yerine bu fonksiyonları kullanın.
 */

/**
 * TC Kimlik numarasını maskeler.
 * "12345678901" → "123*****901"
 * Düzensiz veya kısa girdilerde ortasını maskeler.
 */
export function maskTckn(tckn) {
    if (!tckn || tckn === '-' || tckn === '—') return tckn || '-';
    const s = String(tckn).trim();
    if (s.length < 4) return '***';
    if (s.length <= 6) return s.slice(0, 1) + '*'.repeat(s.length - 2) + s.slice(-1);
    // Standart 11 hane: ilk 3 + yıldız + son 3
    const prefix = s.slice(0, 3);
    const suffix = s.slice(-3);
    const masked = '*'.repeat(Math.max(s.length - 6, 3));
    return `${prefix}${masked}${suffix}`;
}
