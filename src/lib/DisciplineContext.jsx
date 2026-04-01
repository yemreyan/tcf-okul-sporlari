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
        brans: 'Artistik',
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
        brans: 'Aerobik',
        theme: {
            primary: '#10B981',
            primaryLight: '#ECFDF5',
            gradient: 'linear-gradient(135deg, #064E3B 0%, #065F46 50%, #047857 100%)',
            headerGradient: 'linear-gradient(135deg, #064E3B, #0F766E)',
        },
    },
    trampolin: {
        id: 'trampolin',
        label: 'Trampolin Cimnastik',
        shortLabel: 'Trampolin',
        firebasePath: 'trampolin_yarismalar',
        routePrefix: '/trampolin',
        homePath: '/trampolin',
        hasApparatus: false,
        brans: 'Trampolin',
        theme: {
            primary: '#F97316',
            primaryLight: '#FFF7ED',
            gradient: 'linear-gradient(135deg, #7C2D12 0%, #9A3412 50%, #C2410C 100%)',
            headerGradient: 'linear-gradient(135deg, #7C2D12, #EA580C)',
        },
    },
    parkur: {
        id: 'parkur',
        label: 'Parkur Cimnastik',
        shortLabel: 'Parkur',
        firebasePath: 'parkur_yarismalar',
        routePrefix: '/parkur',
        homePath: '/parkur',
        hasApparatus: false,
        brans: 'Parkur',
        theme: {
            primary: '#F59E0B',
            primaryLight: '#FFFBEB',
            gradient: 'linear-gradient(135deg, #78350F 0%, #92400E 50%, #B45309 100%)',
            headerGradient: 'linear-gradient(135deg, #78350F, #D97706)',
        },
    },
    ritmik: {
        id: 'ritmik',
        label: 'Ritmik Cimnastik',
        shortLabel: 'Ritmik',
        firebasePath: 'ritmik_yarismalar',
        routePrefix: '/ritmik',
        homePath: '/ritmik',
        hasApparatus: false,
        brans: 'Ritmik',
        theme: {
            primary: '#EC4899',
            primaryLight: '#FDF2F8',
            gradient: 'linear-gradient(135deg, #831843 0%, #9D174D 50%, #BE185D 100%)',
            headerGradient: 'linear-gradient(135deg, #831843, #DB2777)',
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
