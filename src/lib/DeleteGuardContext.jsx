/* eslint-disable react-refresh/only-export-components */
/**
 * DeleteGuardContext — Silme işlemleri için Süper Admin şifre koruması
 *
 * Kullanım:
 *   const { requestDelete } = useDeleteGuard();
 *   requestDelete('Yarışma "Ankara Kupası" silinecek', async () => {
 *       await remove(ref(db, `...`));
 *   });
 *
 * Şifre sadece Süper Admin rolündeki kullanıcıların şifresiyle eşleşirse
 * silme işlemi gerçekleşir.
 */
import { useState, useCallback, createContext, useContext } from 'react';
import { ref, get } from 'firebase/database';
import { db } from './firebase';
import './DeleteGuard.css';

const DeleteGuardContext = createContext(null);

// SHA-256 hash
async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256',
        new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0')).join('');
}

// Timing-safe compare
function timingSafeEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return result === 0;
}

export function DeleteGuardProvider({ children }) {
    const [pending, setPending] = useState(null);
    // pending = { label: string, onConfirm: async fn }

    const [password, setPassword] = useState('');
    const [error, setError]       = useState('');
    const [loading, setLoading]   = useState(false);
    const [showPwd, setShowPwd]   = useState(false);

    /**
     * requestDelete(label, onConfirm)
     * - label: gösterilecek açıklama metni
     * - onConfirm: async () => {} — şifre doğrulanınca çağrılır
     */
    const requestDelete = useCallback((label, onConfirm) => {
        setPassword('');
        setError('');
        setShowPwd(false);
        setPending({ label, onConfirm });
    }, []);

    const handleClose = useCallback(() => {
        setPending(null);
        setPassword('');
        setError('');
        setLoading(false);
    }, []);

    const handleConfirm = useCallback(async () => {
        if (!pending) return;
        const pwd = password.trim();
        if (!pwd) { setError('Şifre boş olamaz.'); return; }

        setLoading(true);
        setError('');

        try {
            // Tüm kullanıcıları al
            const snap = await get(ref(db, 'kullanicilar'));
            const users = snap.val() || {};
            const inputHash = await sha256(pwd);

            let authorized = false;

            for (const [uname, u] of Object.entries(users)) {
                // Sadece Süper Admin rolündeki veya "admin" adlı kullanıcılar
                const isSuperAdmin =
                    u.rolAdi === 'Super Admin' ||
                    uname === 'admin';

                if (!isSuperAdmin) continue;

                if (u.sifreHash && timingSafeEqual(inputHash, u.sifreHash)) {
                    authorized = true; break;
                }
                if (u.sifre && u.sifre === pwd) {
                    authorized = true; break;
                }
            }

            if (!authorized) {
                setError('Süper Admin şifresi hatalı.');
                setLoading(false);
                return;
            }

            // Şifre doğru — silme işlemini çalıştır
            await pending.onConfirm();
            handleClose();
        } catch (e) {
            setError('Hata: ' + e.message);
            setLoading(false);
        }
    }, [pending, password, handleClose]);

    return (
        <DeleteGuardContext.Provider value={{ requestDelete }}>
            {children}

            {/* ─── Modal ─── */}
            {pending && (
                <div className="dg-overlay" onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
                    <div className="dg-modal" role="dialog" aria-modal="true">
                        <div className="dg-modal-header">
                            <div className="dg-icon">
                                <i className="material-icons-round">delete_forever</i>
                            </div>
                            <h2 className="dg-title">Silme Onayı</h2>
                            <p className="dg-desc">{pending.label}</p>
                        </div>

                        <div className="dg-modal-body">
                            <p className="dg-pwd-hint">
                                Bu işlemi gerçekleştirmek için Süper Admin şifresi gereklidir.
                            </p>
                            <div className="dg-pwd-field">
                                <input
                                    className="dg-pwd-input"
                                    type={showPwd ? 'text' : 'password'}
                                    placeholder="Süper Admin şifresi"
                                    value={password}
                                    onChange={e => { setPassword(e.target.value); setError(''); }}
                                    onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    className="dg-pwd-toggle"
                                    onClick={() => setShowPwd(v => !v)}
                                    tabIndex={-1}
                                >
                                    <i className="material-icons-round">
                                        {showPwd ? 'visibility_off' : 'visibility'}
                                    </i>
                                </button>
                            </div>
                            {error && <p className="dg-error">{error}</p>}
                        </div>

                        <div className="dg-modal-footer">
                            <button
                                type="button"
                                className="dg-btn dg-btn--cancel"
                                onClick={handleClose}
                                disabled={loading}
                            >
                                İptal
                            </button>
                            <button
                                type="button"
                                className="dg-btn dg-btn--delete"
                                onClick={handleConfirm}
                                disabled={loading}
                            >
                                {loading
                                    ? <><i className="material-icons-round dg-spin">refresh</i> Doğrulanıyor…</>
                                    : <><i className="material-icons-round">delete_forever</i> Sil</>
                                }
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </DeleteGuardContext.Provider>
    );
}

export function useDeleteGuard() {
    const ctx = useContext(DeleteGuardContext);
    if (!ctx) throw new Error('useDeleteGuard must be used within DeleteGuardProvider');
    return ctx;
}
