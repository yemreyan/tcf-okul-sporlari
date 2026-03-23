import { ref, push } from 'firebase/database';
import { db } from './firebase';

/**
 * Sisteme audit log kaydı yazar.
 * @param {string} type - Log tipi (score_create, athlete_create, login, vb.)
 * @param {string} message - Açıklama mesajı
 * @param {object} [extra] - Ek bilgiler { user, competitionId }
 */
export function logAction(type, message, extra = {}) {
    try {
        const logData = {
            type,
            message,
            timestamp: Date.now(),
            user: extra.user || '',
            competitionId: extra.competitionId || '',
        };
        push(ref(db, 'logs'), logData);
    } catch (err) {
        console.error('Audit log yazma hatası:', err);
    }
}
