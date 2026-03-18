/**
 * Yarışma filtreleme yardımcı fonksiyonları.
 * İl temsilcileri sadece kendi illerinin yarışmalarını görür.
 * Super admin tüm yarışmaları görür.
 */

/**
 * Object formatındaki yarışmaları kullanıcının iline göre filtreler.
 * @param {Object} competitionsObj - Firebase'den gelen { compId: { il, isim, ... } }
 * @param {Object|null} currentUser - currentUser objesi
 * @returns {Object} Filtrelenmiş yarışmalar
 */
export function filterCompetitionsByUser(competitionsObj, currentUser) {
    if (!competitionsObj) return {};
    // Super admin veya il atanmamış → hepsini göster
    if (!currentUser || currentUser.rolAdi === 'Super Admin' || currentUser.kullaniciAdi === 'admin') {
        return competitionsObj;
    }

    const userIl = currentUser.il;
    if (!userIl) return competitionsObj;

    const filtered = {};
    Object.entries(competitionsObj).forEach(([id, comp]) => {
        const compIl = comp.il || '';
        if (compIl.toLocaleUpperCase('tr-TR') === userIl.toLocaleUpperCase('tr-TR')) {
            filtered[id] = comp;
        }
    });
    return filtered;
}

/**
 * Array formatındaki yarışmaları kullanıcının iline göre filtreler.
 * @param {Array} competitionsArray - [ { id, il, isim, ... }, ... ]
 * @param {Object|null} currentUser - currentUser objesi
 * @returns {Array} Filtrelenmiş yarışmalar
 */
export function filterCompetitionsArrayByUser(competitionsArray, currentUser) {
    if (!competitionsArray) return [];
    if (!currentUser || currentUser.rolAdi === 'Super Admin' || currentUser.kullaniciAdi === 'admin') {
        return competitionsArray;
    }

    const userIl = currentUser.il;
    if (!userIl) return competitionsArray;

    return competitionsArray.filter(comp => {
        const compIl = comp.il || comp.city || '';
        return compIl.toLocaleUpperCase('tr-TR') === userIl.toLocaleUpperCase('tr-TR');
    });
}
