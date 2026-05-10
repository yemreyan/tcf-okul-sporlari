import { ref, push } from 'firebase/database';
import { db } from './firebase';

/**
 * Sisteme audit log kaydı yazar.
 *
 * UYARI: Firebase rules ('database.rules.json') logs/* için 'mesaj' alanı
 * isteyen bir validator içeriyor olabilir. Geriye dönük uyumluluk için hem
 * 'message' hem 'mesaj' yazıyoruz. Mesaj 500 karakteri aşarsa kesilir.
 *
 * @param {string} type - Log tipi (score_create, score_submitted, score_field_cleared, vb.)
 * @param {string|object} messageOrMeta - Açıklama mesajı VEYA meta object (eski extra)
 * @param {object} [extra] - Ek bilgiler. İçindeki 'data' alanı JSON string'e çevrilir.
 */
export function logAction(type, messageOrMeta, extra = {}) {
    try {
        // İki çağrı stilini destekle:
        //   logAction('login', 'aydin giriş yaptı', { user: 'aydin' })   ← string + extra
        //   logAction('score_submitted', { competitionId, athleteId, ... })  ← obje (eski)
        let message = '';
        let meta = {};
        if (typeof messageOrMeta === 'string') {
            message = messageOrMeta;
            meta = extra || {};
        } else if (messageOrMeta && typeof messageOrMeta === 'object') {
            meta = messageOrMeta;
            // Otomatik mesaj türet
            message = `[${type}]`;
            if (meta.athleteId) message += ` ath=${meta.athleteId}`;
            if (meta.alet) message += ` alet=${meta.alet}`;
            if (meta.field) message += ` field=${meta.field}`;
        }
        // Mesajı 500 ile sınırla (validator)
        const msgClipped = String(message).slice(0, 500);

        // 'data' anahtarı obje ise JSON string yap (sınırsız değil ama makul)
        const dataField = (meta.data && typeof meta.data === 'object')
            ? JSON.stringify(meta.data).slice(0, 4000)
            : (meta.data || null);

        const logData = {
            type,
            message:  msgClipped,
            mesaj:    msgClipped,                  // Firebase rule uyumu (eski validator)
            timestamp: Date.now(),
            user:           meta.user           || '',
            competitionId:  meta.competitionId  || '',
            // Yapısal alanlar — search/inceleme için
            athleteId:      meta.athleteId      || null,
            athleteName:    meta.athleteName    || null,
            category:       meta.category       || null,
            alet:           meta.alet           || null,
            field:          meta.field          || null,
            oldValue:       meta.oldValue !== undefined ? meta.oldValue : null,
            newValue:       meta.newValue !== undefined ? meta.newValue : null,
            finalScore:     meta.finalScore !== undefined ? meta.finalScore : null,
            discipline:     meta.discipline     || null,
            data:           dataField,
        };
        push(ref(db, 'logs'), logData);
    } catch (err) {
        console.error('Audit log yazma hatası:', err);
    }
}
