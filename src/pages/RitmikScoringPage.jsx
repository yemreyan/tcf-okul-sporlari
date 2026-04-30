/**
 * RitmikScoringPage — Layout wrapper
 * Tüm mantık useRitmikScoring hook'unda.
 * Tercih localStorage'a kaydedilir, her an değiştirilebilir.
 */
import { useState } from 'react';
import { useRitmikScoring } from '../hooks/useRitmikScoring';
import RitmikModernLayout  from './RitmikModernLayout';
import RitmikClassicLayout from './RitmikClassicLayout';

const LAYOUT_KEY = 'rtm-layout'; // localStorage anahtarı

export default function RitmikScoringPage() {
    const [layout, setLayout] = useState(
        () => localStorage.getItem(LAYOUT_KEY) || 'modern'
    );

    const scoring = useRitmikScoring();

    const switchLayout = () => {
        const next = layout === 'modern' ? 'classic' : 'modern';
        setLayout(next);
        localStorage.setItem(LAYOUT_KEY, next);
    };

    if (layout === 'classic') {
        return <RitmikClassicLayout s={scoring} onSwitchLayout={switchLayout} />;
    }
    return <RitmikModernLayout s={scoring} onSwitchLayout={switchLayout} />;
}
