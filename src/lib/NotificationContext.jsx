import { createContext, useContext, useState, useCallback, useRef } from 'react';
import './Notification.css';

const NotificationContext = createContext(null);

export function useNotification() {
    const ctx = useContext(NotificationContext);
    if (!ctx) throw new Error('useNotification must be used within NotificationProvider');
    return ctx;
}

export function NotificationProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    const [confirmState, setConfirmState] = useState(null);
    const resolveRef = useRef(null);
    const toastIdRef = useRef(0);

    // Toast — replaces alert()
    const toast = useCallback((message, type = 'info') => {
        const id = ++toastIdRef.current;
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, type === 'error' ? 5000 : 3500);
    }, []);

    // Confirm — replaces window.confirm()
    const confirm = useCallback((message, { title, type = 'warning' } = {}) => {
        return new Promise(resolve => {
            resolveRef.current = resolve;
            setConfirmState({ message, title, type });
        });
    }, []);

    const handleConfirm = (result) => {
        if (resolveRef.current) resolveRef.current(result);
        resolveRef.current = null;
        setConfirmState(null);
    };

    const toastIcon = (type) => {
        switch (type) {
            case 'success': return 'check_circle';
            case 'error': return 'error';
            case 'warning': return 'warning';
            default: return 'info';
        }
    };

    const confirmIcon = (type) => {
        switch (type) {
            case 'danger': return 'delete_forever';
            case 'warning': return 'warning';
            default: return 'help_outline';
        }
    };

    return (
        <NotificationContext.Provider value={{ toast, confirm }}>
            {children}

            {/* Toast Stack */}
            {toasts.length > 0 && (
                <div className="n-toast-container">
                    {toasts.map(t => (
                        <div key={t.id} className={`n-toast n-toast-${t.type}`}>
                            <i className="material-icons-round">{toastIcon(t.type)}</i>
                            <span>{t.message}</span>
                            <button className="n-toast-close" onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}>
                                <i className="material-icons-round">close</i>
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Confirm Modal */}
            {confirmState && (
                <div className="n-confirm-overlay" onClick={() => handleConfirm(false)}>
                    <div className="n-confirm-dialog" onClick={e => e.stopPropagation()}>
                        <div className={`n-confirm-icon-area n-confirm-${confirmState.type}`}>
                            <i className="material-icons-round">{confirmIcon(confirmState.type)}</i>
                        </div>
                        <h3 className="n-confirm-title">{confirmState.title || 'Onay'}</h3>
                        <p className="n-confirm-message">{confirmState.message}</p>
                        <div className="n-confirm-actions">
                            <button className="n-confirm-btn n-btn-cancel" onClick={() => handleConfirm(false)}>Vazgeç</button>
                            <button className={`n-confirm-btn n-btn-ok n-btn-${confirmState.type}`} onClick={() => handleConfirm(true)}>Evet, Devam Et</button>
                        </div>
                    </div>
                </div>
            )}
        </NotificationContext.Provider>
    );
}
