/* eslint-disable react-refresh/only-export-components */
import { useState, createContext, useContext } from 'react';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState(
        localStorage.getItem('isSuperAdmin') === 'true'
    );

    const login = (password) => {
        // Super admin şifresi kontrolü
        if (password === '63352180') {
            setIsAuthenticated(true);
            localStorage.setItem('isSuperAdmin', 'true');
            return true;
        }
        return false;
    };

    const logout = () => {
        setIsAuthenticated(false);
        localStorage.removeItem('isSuperAdmin');
    };

    return (
        <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
