import { createContext, useContext } from 'react';

/**
 * Discipline Context — branş bazlı ayarları sağlar.
 * Artistik ve Aerobik sayfalar aynı bileşenleri kullanır,
 * sadece bu context üzerinden farklılaşır.
 */

const DISCIPLINE_CONFIG = {
    artistik: {
        id: 'artistik',
        label: 'Artistik Cimnastik',
        shortLabel: 'Artistik',
        firebasePath: 'competitions',
        routePrefix: '/artistik',
        homePath: '/artistik',
        hasApparatus: true,
        theme: {
            primary: '#4F46E5',
            primaryLight: '#EEF2FF',
            gradient: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #3730a3 100%)',
            headerGradient: 'linear-gradient(135deg, #1e1b4b, #312e81)',
        },
    },
    aerobik: {
        id: 'aerobik',
        label: 'Aerobik Cimnastik',
        shortLabel: 'Aerobik',
        firebasePath: 'aerobik_yarismalar',
        routePrefix: '/aerobik',
        homePath: '/aerobik',
        hasApparatus: false,
        theme: {
            primary: '#10B981',
            primaryLight: '#ECFDF5',
            gradient: 'linear-gradient(135deg, #064E3B 0%, #065F46 50%, #047857 100%)',
            headerGradient: 'linear-gradient(135deg, #064E3B, #0F766E)',
        },
    },
};

const DisciplineContext = createContext(DISCIPLINE_CONFIG.artistik);

export function DisciplineProvider({ discipline, children }) {
    const config = DISCIPLINE_CONFIG[discipline] || DISCIPLINE_CONFIG.artistik;
    return (
        <DisciplineContext.Provider value={config}>
            {children}
        </DisciplineContext.Provider>
    );
}

export function useDiscipline() {
    return useContext(DisciplineContext);
}

export { DISCIPLINE_CONFIG };
export default DisciplineContext;
