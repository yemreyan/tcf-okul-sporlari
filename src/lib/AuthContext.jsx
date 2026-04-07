/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect, createContext, useContext, useRef } from 'react';
import { ref, get } from 'firebase/database';
import { db } from './firebase';
import { logAction } from './auditLogger';

const AuthContext = createContext();

// SHA-256 hash fonksiyonu (Web Crypto API)
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Timing-safe karşılaştırma (side-channel saldırılarına karşı)
function timingSafeEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}

// Brute-force koruması
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 2 * 60 * 1000; // 2 dakika

// Session token expiration: 24 saat
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

export const AuthProvider = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [currentUser, setCurrentUser] = useState(null);
    const [loading, setLoading] = useState(true);

    // Rate limiting state
    const loginAttemptsRef = useRef(0);
    const lockoutUntilRef = useRef(0);

    // Sayfa yüklendiğinde localStorage'dan oturum bilgisini al
    useEffect(() => {
        const savedUser = localStorage.getItem('currentUser');
        if (savedUser) {
            try {
                const user = JSON.parse(savedUser);
                const savedToken = localStorage.getItem('sessionToken');
                if (savedToken && user.sessionToken === savedToken) {
                    // Session süresi dolmuş mu kontrol et
                    if (user.expiresAt && Date.now() > user.expiresAt) {
                        localStorage.removeItem('currentUser');
                        localStorage.removeItem('sessionToken');
                    } else {
                        const { sessionToken: _, expiresAt: __, ...cleanUser } = user;
                        setCurrentUser(cleanUser);
                        setIsAuthenticated(true);
                    }
                } else {
                    localStorage.removeItem('currentUser');
                    localStorage.removeItem('sessionToken');
                }
            } catch {
                localStorage.removeItem('currentUser');
                localStorage.removeItem('sessionToken');
            }
        }
        // Eski isSuperAdmin flag'i varsa migrate et
        if (localStorage.getItem('isSuperAdmin') === 'true' && !savedUser) {
            const superAdminUser = {
                kullaniciAdi: 'admin',
                rolAdi: 'Super Admin',
                il: null,
                izinler: {}
            };
            const token = generateSessionToken();
            setCurrentUser(superAdminUser);
            setIsAuthenticated(true);
            localStorage.setItem('currentUser', JSON.stringify({ ...superAdminUser, sessionToken: token }));
            localStorage.setItem('sessionToken', token);
            localStorage.removeItem('isSuperAdmin');
        }
        setLoading(false);
    }, []);

    // Rastgele session token üret
    function generateSessionToken() {
        const arr = new Uint8Array(32);
        crypto.getRandomValues(arr);
        return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    const login = async (username, password) => {
        // Rate limiting kontrolü
        const now = Date.now();
        if (now < lockoutUntilRef.current) {
            const remainSec = Math.ceil((lockoutUntilRef.current - now) / 1000);
            return { error: `Çok fazla deneme. ${remainSec} saniye sonra tekrar deneyin.` };
        }

        if (!username || !username.trim()) return false;

        // Kullanıcı adı sanitizasyonu — sadece güvenli karakterlere izin ver (whitelist)
        const sanitizedUsername = username.trim().replace(/[^a-zA-Z0-9_çğıöşüÇĞİÖŞÜ]/g, '');
        if (!sanitizedUsername || sanitizedUsername.length > 100) return false;

        try {
            const userRef = ref(db, `kullanicilar/${sanitizedUsername}`);
            const snapshot = await get(userRef);

            if (!snapshot.exists()) {
                loginAttemptsRef.current++;
                if (loginAttemptsRef.current >= MAX_LOGIN_ATTEMPTS) {
                    lockoutUntilRef.current = Date.now() + LOCKOUT_DURATION_MS;
                    loginAttemptsRef.current = 0;
                }
                return false;
            }

            const userData = snapshot.val();

            // Hashlenmiş şifre kontrolü (timing-safe karşılaştırma)
            let passwordMatch = false;
            if (userData.sifreHash) {
                const inputHash = await hashPassword(password);
                passwordMatch = timingSafeEqual(inputHash, userData.sifreHash);
            } else if (userData.sifre) {
                // Eski format: düz metin → otomatik hash'e çevir ve kaydet
                if (userData.sifre === password) {
                    passwordMatch = true;
                    // Asenkron olarak hash'e migrate et (sonucu beklemiyoruz)
                    hashPassword(password).then(async hash => {
                        try {
                            const { update: fbUpdate, ref: fbRef } = await import('firebase/database');
                            const { db: fbDb } = await import('./firebase');
                            await fbUpdate(fbRef(fbDb, `kullanicilar/${sanitizedUsername}`), {
                                sifreHash: hash,
                                sifre: null
                            });
                        } catch { /* sessiz hata */ }
                    });
                }
            }

            if (!passwordMatch) {
                loginAttemptsRef.current++;
                if (loginAttemptsRef.current >= MAX_LOGIN_ATTEMPTS) {
                    lockoutUntilRef.current = Date.now() + LOCKOUT_DURATION_MS;
                    loginAttemptsRef.current = 0;
                }
                return false;
            }

            if (userData.aktif === false) return false;

            loginAttemptsRef.current = 0;
            const user = {
                kullaniciAdi: sanitizedUsername,
                rolAdi: userData.rolAdi || 'Kullanıcı',
                il: userData.il || null,
                izinler: userData.izinler || {},
                bransIzinler: userData.bransIzinler || {},
            };

            const token = generateSessionToken();
            const expiresAt = Date.now() + SESSION_EXPIRY_MS;
            setCurrentUser(user);
            setIsAuthenticated(true);
            localStorage.setItem('currentUser', JSON.stringify({ ...user, sessionToken: token, expiresAt }));
            localStorage.setItem('sessionToken', token);
            logAction('login', `${sanitizedUsername} giriş yaptı (${userData.rolAdi || 'Kullanıcı'})`, { user: sanitizedUsername });
            return user;
        } catch (err) {
            if (import.meta.env.DEV) {
                console.error('Giriş hatası:', err);
            }
            return false;
        }
    };

    const logout = () => {
        if (currentUser) logAction('logout', `${currentUser.kullaniciAdi} çıkış yaptı`, { user: currentUser.kullaniciAdi });
        setIsAuthenticated(false);
        setCurrentUser(null);
        localStorage.removeItem('currentUser');
        localStorage.removeItem('sessionToken');
        localStorage.removeItem('isSuperAdmin');
    };

    const isSuperAdmin = () => {
        return currentUser?.rolAdi === 'Super Admin' || currentUser?.kullaniciAdi === 'admin';
    };

    /**
     * Sayfa ve alt özellik izin kontrolü
     * @param {string} pageKey   - Sayfa anahtarı (ör: 'competitions')
     * @param {string} action    - Alt izin (ör: 'goruntule', 'olustur'). Varsayılan: 'goruntule'
     * @param {string} discipline - Branş id (ör: 'artistik'). Verilirse önce branş izinlerine bakılır.
     * @returns {boolean}
     */
    const hasPermission = (pageKey, action = 'goruntule', discipline = null) => {
        if (!currentUser) return false;
        if (isSuperAdmin()) return true;

        // Branş bazlı izin — tanımlanmışsa global'e göre önceliklidir
        if (discipline && currentUser.bransIzinler?.[discipline]) {
            const bp = currentUser.bransIzinler[discipline];
            if (bp[pageKey] !== undefined && bp[pageKey][action] !== undefined) {
                return bp[pageKey][action] === true;
            }
        }

        // Global fallback
        const pagePerms = currentUser.izinler?.[pageKey];
        if (!pagePerms) return false;
        return pagePerms[action] === true;
    };

    return (
        <AuthContext.Provider value={{
            isAuthenticated,
            currentUser,
            loading,
            login,
            logout,
            isSuperAdmin,
            hasPermission,
            hashPassword // Export for RoleManagementPage
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
