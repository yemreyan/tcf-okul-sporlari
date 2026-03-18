/**
 * E-Panel Token Yönetimi
 * QR kodlar ve linkler üzerinden hakem erişimi için basit token sistemi.
 * Token yarışma oluşturulduğunda generate edilir ve Firebase'de saklanır.
 */

// Token üretme
export function generateEPanelToken() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Token doğrulama (Firebase'den gelen token ile URL'deki token karşılaştırma)
export function validateEPanelToken(urlToken, dbToken) {
    if (!urlToken || !dbToken) return false;
    // Timing-safe karşılaştırma (basit versiyon — client-side)
    if (urlToken.length !== dbToken.length) return false;
    let result = 0;
    for (let i = 0; i < urlToken.length; i++) {
        result |= urlToken.charCodeAt(i) ^ dbToken.charCodeAt(i);
    }
    return result === 0;
}
