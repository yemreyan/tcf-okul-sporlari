/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect, createContext, useContext, useRef } from 'react';
import { ref, get } from 'firebase/database';
import { db } from './firebase';

const AuthContext = createContext();

// Super admin şifresi artık env'den okunuyor
const SUPER_ADMIN_PASSWORD = import.meta.env.VITE_SUPER_ADMIN_PASSWORD || '';

// Basit SHA-256 hash fonksiyonu (Web Crypto API)
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Brute-force koruması: Login deneme sınırlandırma
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 2 * 60 * 1000; // 2 dakika

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
                // Session token kontrolü
                const savedToken = localStorage.getItem('sessionToken');
                if (savedToken && user.sessionToken === savedToken) {
                    // sessionToken'ı user objesinden temizle (memory'de tutma)
                    const { sessionToken: _, ...cleanUser } = user;
                    setCurrentUser(cleanUser);
                    setIsAuthenticated(true);
                } else {
                    // Token uyuşmazlığı — oturumu temizle
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

        // 1. Super admin şifresi (geriye uyumlu)
        if (SUPER_ADMIN_PASSWORD && password === SUPER_ADMIN_PASSWORD && (!username || username.trim() === '' || username.toLowerCase() === 'admin')) {
            loginAttemptsRef.current = 0;
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
            return superAdminUser;
        }

        // 2. Kullanıcı adı + şifre ile Firebase'den kontrol
        if (!username || !username.trim()) return false;

        // Kullanıcı adı sanitizasyonu — path traversal engelle
        const sanitizedUsername = username.trim().replace(/[.#$\[\]\/]/g, '');
        if (!sanitizedUsername) return false;

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

            // Hashlenmiş şifre kontrolü
            let passwordMatch = false;
            if (userData.sifreHash) {
                // Yeni format: hashlenmiş şifre
                const inputHash = await hashPassword(password);
                passwordMatch = inputHash === userData.sifreHash;
            } else {
                // Eski format: düz metin (geriye uyumluluk)
                passwordMatch = userData.sifre === password;
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
                izinler: userData.izinler || {}
            };

            const token = generateSessionToken();
            setCurrentUser(user);
            setIsAuthenticated(true);
            localStorage.setItem('currentUser', JSON.stringify({ ...user, sessionToken: token }));
            localStorage.setItem('sessionToken', token);
            return user;
        } catch (err) {
            if (import.meta.env.DEV) {
                console.error('Giriş hatası:', err);
            }
            return false;
        }
    };

    const logout = () => {
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
     * @param {string} pageKey - Sayfa anahtarı (ör: 'competitions')
     * @param {string} action - Alt izin (ör: 'goruntule', 'olustur', 'duzenle', 'sil'). Varsayılan: 'goruntule'
     * @returns {boolean}
     */
    const hasPermission = (pageKey, action = 'goruntule') => {
        if (!currentUser) return false;
        if (isSuperAdmin()) return true;

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
