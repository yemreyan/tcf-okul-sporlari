/**
 * Artistik Çizgi Hakemi Paneli (yer aleti için)
 *
 * URL: /artistik/lpanel?competitionId=X&catId=Y&aletId=Z&token=T
 *
 * Davranış: Her çizgi ihlali için -0.1 veya -0.3 butonu. Aktif sporcunun
 * tarafsız kesinti toplamına eklenir. İhlal sayacı tutulur.
 */
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { validateEPanelToken } from '../lib/epanelToken';
import { useNotification } from '../lib/NotificationContext';
import { useDiscipline } from '../lib/DisciplineContext';
import { logAction } from '../lib/auditLogger';
import './EPanelPage.css';

const ALET_LABELS = {
    yer: 'Yer (FX)', atlama: 'Atlama (VT)', paralel: 'Paralel (PB)',
    barfiks: 'Barfiks (HB)', halka: 'Halka (SR)', kulplu: 'Kulplu (PH)',
    denge: 'Denge (BB)', asimetrik: 'Asimetrik (UB)',
};

export default function ArtistikLPanelPage() {
    const { toast } = useNotification();
    const { firebasePath } = useDiscipline();
    const [searchParams] = useSearchParams();

    const compId = searchParams.get('competitionId');
    const catId  = searchParams.get('catId');
    const aletId = searchParams.get('aletId');
    const urlToken = searchParams.get('token');

    const [activeAthleteId, setActiveAthleteId] = useState(null);
    const [athleteInfo, setAthleteInfo] = useState(null);
    const [status, setStatus] = useState('waiting');
    const [tokenChecking, setTokenChecking] = useState(true);
    const [tokenVerified, setTokenVerified] = useState(false);
    const [serverDeduction, setServerDeduction] = useState(0);
    const [violationCount, setViolationCount] = useState(0);
    const [sessionDeduction, setSessionDeduction] = useState(0);
    const [compName, setCompName] = useState('...');

    useEffect(() => {
        if (!compId || !urlToken) { setTokenChecking(false); setTokenVerified(false); return; }
        get(ref(db, `${firebasePath}/${compId}/epanelToken`)).then(snap => {
            setTokenVerified(!!(snap.val() && validateEPanelToken(urlToken, snap.val())));
            setTokenChecking(false);
        }).catch(() => { setTokenChecking(false); setTokenVerified(false); });
    }, [compId, urlToken, firebasePath]);

    useEffect(() => {
        if (!compId || !tokenVerified) return;
        const unsub = onValue(ref(db, `${firebasePath}/${compId}/isim`), s => s.val() && setCompName(s.val()));
        return () => unsub();
    }, [compId, tokenVerified, firebasePath]);

    useEffect(() => {
        if (!compId || !catId || !aletId || !tokenVerified) return;
        const activeRef = ref(db, `${firebasePath}/${compId}/aktifSporcu/${catId}/${aletId}`);
        const unsub = onValue(activeRef, async snap => {
            const val = snap.val();
            if (!val) {
                setActiveAthleteId(null);
                setAthleteInfo(null);
                setStatus('waiting');
                setViolationCount(0);
                setSessionDeduction(0);
                return;
            }
            const athId = typeof val === 'object' ? val.id : String(val);
            setActiveAthleteId(athId);
            setViolationCount(0);
            setSessionDeduction(0);
            try {
                const athSnap = await get(ref(db, `${firebasePath}/${compId}/sporcular/${catId}/${athId}`));
                setAthleteInfo(athSnap.val() || null);
            } catch { /* noop */ }
        });
        return () => unsub();
    }, [compId, catId, aletId, tokenVerified, firebasePath]);

    useEffect(() => {
        if (!activeAthleteId || !aletId) return;
        const scoreRef = ref(db, `${firebasePath}/${compId}/puanlar/${catId}/${aletId}/${activeAthleteId}`);
        const unsub = onValue(scoreRef, snap => {
            const data = snap.val() || {};
            const isLocked = data.durum === 'tamamlandi' || data.kilitli === true;
            const ded = parseFloat(data.tarafsiz ?? data.neutralDeductions ?? 0) || 0;
            setServerDeduction(ded);
            setStatus(isLocked ? 'locked' : 'scoring');
        });
        return () => unsub();
    }, [activeAthleteId, compId, catId, aletId, firebasePath]);

    const handleAddDeduction = async (amount) => {
        if (status !== 'scoring' || !activeAthleteId) return;
        const newTotal = +(serverDeduction + amount).toFixed(2);
        try {
            await update(ref(db, `${firebasePath}/${compId}/puanlar/${catId}/${aletId}/${activeAthleteId}`), {
                tarafsiz: newTotal,
            });
            setSessionDeduction(s => +(s + amount).toFixed(2));
            setViolationCount(c => c + 1);
            try {
                await logAction('judge_score_submit', `ÇİZGİ hakemi → ${aletId} kesinti +${amount.toFixed(1)} (toplam ${newTotal.toFixed(2)})`, {
                    user: 'panel:cizgi',
                    competitionId: compId,
                    category: catId,
                    athleteId: activeAthleteId,
                    athleteName: athleteInfo ? `${athleteInfo.ad || ''} ${athleteInfo.soyad || ''}`.trim() : '',
                    alet: aletId,
                    field: 'tarafsiz',
                    oldValue: serverDeduction,
                    newValue: newTotal,
                    discipline: 'artistik',
                    data: { source: 'hakem', panel: 'cizgi', delta: amount },
                });
            } catch { /* noop */ }
        } catch {
            toast('Kesinti kaydedilemedi.', 'error');
        }
    };

    if (!compId || !catId || !aletId) {
        return <div className="epanel-wrapper epanel-error"><h2>Hatalı Link</h2><p>competitionId, catId ve aletId parametreleri gereklidir.</p></div>;
    }
    if (tokenChecking) {
        return <div className="epanel-wrapper"><div className="epanel-main"><div className="view-section active waiting-view"><span className="material-icons-round waiting-icon">hourglass_empty</span><div className="waiting-text">Doğrulanıyor...</div></div></div></div>;
    }
    if (!tokenVerified) {
        return <div className="epanel-wrapper epanel-error"><h2>Yetkisiz Erişim</h2></div>;
    }

    const aletLabel = ALET_LABELS[aletId] || aletId;

    return (
        <div className="epanel-wrapper">
            <div className="epanel-header">
                <div>
                    <div className="header-sub">{compName}</div>
                    <div className="header-title">ÇİZGİ HAKEMİ — {aletLabel}</div>
                </div>
                <div className="panel-badge" style={{ background: 'linear-gradient(135deg,#06b6d4,#0e7490)' }}>L</div>
            </div>

            <div className="epanel-main">
                {status === 'waiting' && (
                    <div className="view-section active waiting-view">
                        <span className="material-icons-round waiting-icon">hourglass_empty</span>
                        <div className="waiting-text">Sporcu Bekleniyor...</div>
                    </div>
                )}

                {(status === 'scoring' || status === 'locked') && athleteInfo && (
                    <div className="view-section active scoring-view">
                        <div className="athlete-card">
                            <div className="athlete-name">{athleteInfo.ad} {athleteInfo.soyad}</div>
                            <div className="athlete-club">{athleteInfo.okul || athleteInfo.kulup || '-'}</div>
                        </div>

                        {/* İhlal sayacı + toplam kesinti */}
                        <div style={{
                            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: '0.85rem',
                        }}>
                            <div style={{
                                background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.35)',
                                borderRadius: 10, padding: '0.7rem', textAlign: 'center',
                            }}>
                                <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#67e8f9', letterSpacing: 1.5, textTransform: 'uppercase' }}>İhlal Sayısı</div>
                                <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                                    {violationCount}
                                </div>
                            </div>
                            <div style={{
                                background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)',
                                borderRadius: 10, padding: '0.7rem', textAlign: 'center',
                            }}>
                                <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#fbbf24', letterSpacing: 1.5, textTransform: 'uppercase' }}>Toplam Kesinti</div>
                                <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#fbbf24', fontVariantNumeric: 'tabular-nums' }}>
                                    -{serverDeduction.toFixed(2)}
                                </div>
                            </div>
                        </div>
                        {sessionDeduction > 0 && (
                            <div style={{ fontSize: '0.78rem', color: '#86efac', textAlign: 'center', marginBottom: '0.7rem' }}>
                                ✓ Bu sporcuda eklediğiniz: -{sessionDeduction.toFixed(2)}
                            </div>
                        )}

                        {status === 'scoring' ? (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <button onClick={() => handleAddDeduction(0.1)} style={dedBtnStyle('linear-gradient(135deg,#0891b2,#0e7490)')}>
                                    <div style={{ fontSize: '0.72rem', opacity: 0.9, letterSpacing: 1.5 }}>ÇİZGİ İHLALİ</div>
                                    <div style={{ fontSize: '2.4rem', fontWeight: 900, marginTop: 2 }}>-0.1</div>
                                </button>
                                <button onClick={() => handleAddDeduction(0.3)} style={dedBtnStyle('linear-gradient(135deg,#ef4444,#b91c1c)')}>
                                    <div style={{ fontSize: '0.72rem', opacity: 0.9, letterSpacing: 1.5 }}>ÇİZGİ İHLALİ</div>
                                    <div style={{ fontSize: '2.4rem', fontWeight: 900, marginTop: 2 }}>-0.3</div>
                                </button>
                            </div>
                        ) : (
                            <div style={{ padding: '1rem', textAlign: 'center', background: 'rgba(107,114,128,0.2)', borderRadius: 10, color: '#94a3b8', fontSize: '0.9rem' }}>
                                <span className="material-icons-round" style={{ fontSize: 28 }}>lock</span>
                                <div style={{ marginTop: 4 }}>Puan kilitlendi — yeni kesinti eklenemez</div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

const dedBtnStyle = (bg) => ({
    padding: '1.1rem 0.5rem', background: bg, color: '#fff',
    border: 'none', borderRadius: 12, cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
});
