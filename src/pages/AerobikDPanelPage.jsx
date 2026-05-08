import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { validateEPanelToken } from '../lib/epanelToken';
import { useNotification } from '../lib/NotificationContext';
import { useDiscipline } from '../lib/DisciplineContext';
import './AerobikDPanelPage.css';

// ─── Constants ───────────────────────────────────────────────────────────────

const SLOTS = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'c'];

const SLOT_OPTIONS = {
    e1: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    e2: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    e3: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    e4: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    e5: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    e6: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    e7: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    e8: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    c:  [0.1, 0.2],
};

const SLOT_LABELS = {
    e1: 'E1', e2: 'E2', e3: 'E3', e4: 'E4',
    e5: 'E5', e6: 'E6', e7: 'E7', e8: 'E8',
    c: 'C',
};

const DEDUCTION_PRESETS = [0, 0.5, 1.0, 1.5, 2.0];

// ─── Component ───────────────────────────────────────────────────────────────

export default function AerobikDPanelPage() {
    const { toast } = useNotification();
    const { firebasePath } = useDiscipline();
    const [searchParams] = useSearchParams();

    const compId   = searchParams.get('competitionId');
    const catId    = searchParams.get('catId');
    const urlToken = searchParams.get('token');

    // ── Auth state ──────────────────────────────────────────────────────────
    const [tokenVerified, setTokenVerified]   = useState(false);
    const [tokenChecking, setTokenChecking]   = useState(true);

    // ── Data state ──────────────────────────────────────────────────────────
    const [compName, setCompName]             = useState('...');
    const [activeAthleteId, setActiveAthleteId] = useState(null);
    const [athleteInfo, setAthleteInfo]       = useState(null);

    // ── Scoring state ───────────────────────────────────────────────────────
    const [slotValues, setSlotValues]         = useState({});
    const [activeSlot, setActiveSlot]         = useState('e1');
    const [dJudgeDeduction, setDJudgeDeduction] = useState(0);
    const [serverDPanel, setServerDPanel]     = useState(null);

    // ── Panel status ────────────────────────────────────────────────────────
    const [status, setStatus] = useState('waiting');

    // ── Derived ─────────────────────────────────────────────────────────────
    const rawTotal        = SLOTS.reduce((sum, s) => sum + (slotValues[s] || 0), 0);
    const rawTotalRounded = Math.round(rawTotal * 100) / 100;
    const filledCount     = SLOTS.filter(s => slotValues[s] != null).length;

    // ── Token validation ────────────────────────────────────────────────────
    useEffect(() => {
        if (!compId || !urlToken) { setTokenChecking(false); return; }
        const tokenRef = ref(db, `${firebasePath}/${compId}/epanelToken`);
        get(tokenRef)
            .then((snap) => {
                setTokenVerified(!!(snap.val() && validateEPanelToken(urlToken, snap.val())));
                setTokenChecking(false);
            })
            .catch(() => { setTokenVerified(false); setTokenChecking(false); });
    }, [compId, urlToken, firebasePath]);

    // ── Competition name ────────────────────────────────────────────────────
    useEffect(() => {
        if (!compId || !tokenVerified) return;
        return onValue(ref(db, `${firebasePath}/${compId}/isim`), (snap) => {
            setCompName(snap.val() || 'Yarışma');
        });
    }, [compId, tokenVerified, firebasePath]);

    // ── Active athlete listener ─────────────────────────────────────────────
    useEffect(() => {
        if (!compId || !catId || !tokenVerified) return;
        return onValue(ref(db, `${firebasePath}/${compId}/aktifSporcu/${catId}`), (snap) => {
            const val = snap.val();
            if (val) {
                if (typeof val === 'object' && val.id) {
                    setActiveAthleteId(val.id);
                    setAthleteInfo({ ad: val.ad || '', soyad: val.soyad || '', okul: val.okul || '' });
                } else {
                    const id = String(val);
                    setActiveAthleteId(id);
                    fetchAthleteData(id);
                }
            } else {
                setActiveAthleteId(null);
                setAthleteInfo(null);
                setStatus('waiting');
                resetScoringState();
            }
        });
    }, [compId, catId, tokenVerified, firebasePath]);

    // ── dPanel / lock listener ──────────────────────────────────────────────
    useEffect(() => {
        if (!compId || !catId || !activeAthleteId || !tokenVerified) return;
        return onValue(ref(db, `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}`), (snap) => {
            const data    = snap.val() || {};
            const isLocked = data.kilitli === true;
            const dpanel   = data.dPanel || null;
            setServerDPanel(dpanel);
            if (isLocked)                          setStatus('locked');
            else if (dpanel?.rawTotal != null)     setStatus('sent');
            else setStatus((p) => p === 'waiting' ? 'scoring' : p);
        });
    }, [compId, catId, activeAthleteId, tokenVerified, firebasePath]);

    // ── Athlete data ────────────────────────────────────────────────────────
    const fetchAthleteData = async (id) => {
        const snap = await get(ref(db, `${firebasePath}/${compId}/sporcular/${catId}/${id}`));
        let ath = snap.val();
        if (!ath) { const g = await get(ref(db, `globalSporcular/${id}`)); ath = g.val(); }
        if (!ath) {
            // Fallback: aktifSporcuBilgi (covers step aerobik team ids)
            const bilgiSnap = await get(ref(db, `${firebasePath}/${compId}/aktifSporcuBilgi/${catId}`));
            const bilgi = bilgiSnap.val();
            if (bilgi && bilgi.id === id) ath = bilgi;
        }
        setAthleteInfo(ath || { ad: 'Bilinmeyen', soyad: 'Sporcu', kulup: '' });
    };

    const resetScoringState = () => {
        setSlotValues({});
        setActiveSlot('e1');
        setDJudgeDeduction(0);
        setServerDPanel(null);
    };

    // ── Submit ──────────────────────────────────────────────────────────────
    const handleSubmit = async () => {
        if (!activeAthleteId) return;
        try {
            await update(ref(db, `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}/dPanel`), {
                slots:     slotValues,
                deduction: dJudgeDeduction,
                rawTotal:  rawTotalRounded,
                timestamp: Date.now(),
            });
        } catch {
            toast('Hata oluştu. Lütfen tekrar deneyin.', 'error');
        }
    };

    // ── Düzeltme Yap ───────────────────────────────────────────────────────
    const handleEdit = () => {
        if (serverDPanel) {
            setSlotValues(serverDPanel.slots || {});
            setDJudgeDeduction(serverDPanel.deduction ?? 0);
        } else {
            resetScoringState();
        }
        setActiveSlot('e1');
        setStatus('scoring');
    };

    // ── Guards ──────────────────────────────────────────────────────────────
    if (!compId || !catId) return (
        <div className="epanel-wrapper epanel-error">
            <h2>Hatalı Link!</h2>
            <p>Lütfen Başhakeminizden size iletilen tam linke tıklayın.</p>
        </div>
    );

    if (tokenChecking) return (
        <div className="epanel-wrapper">
            <div className="epanel-main">
                <div className="view-section active waiting-view">
                    <span className="material-icons-round waiting-icon">hourglass_empty</span>
                    <div className="waiting-text">Doğrulanıyor...</div>
                </div>
            </div>
        </div>
    );

    if (!tokenVerified) return (
        <div className="epanel-wrapper epanel-error">
            <h2>Yetkisiz Erişim</h2>
            <p>Bu bağlantı geçersiz veya süresi dolmuş.</p>
        </div>
    );

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="dp-page">
            {/* Header */}
            <div className="dp-header">
                <div className="dp-header__info">
                    <div className="dp-header__comp">{compName}</div>
                    <div className="dp-header__title">D — Zorluk Hakemi</div>
                </div>
                <div className="dp-header__badge">D</div>
            </div>

            {/* Waiting */}
            {status === 'waiting' && (
                <div className="dp-center-state">
                    <span className="material-icons-round dp-state-icon">hourglass_empty</span>
                    <div className="dp-state-title">Sporcu Bekleniyor…</div>
                    <p className="dp-state-sub">Başhakem sporcu çağırdığında ekran açılacak.</p>
                </div>
            )}

            {/* Scoring */}
            {status === 'scoring' && athleteInfo && (
                <div className="dp-scoring">
                    {/* Athlete */}
                    <div className="dp-athlete">
                        <span className="material-icons-round dp-athlete__icon">person</span>
                        <div>
                            <div className="dp-athlete__name">{athleteInfo.ad} {athleteInfo.soyad}</div>
                            <div className="dp-athlete__club">{athleteInfo.kulup || athleteInfo.okul || '—'}</div>
                        </div>
                    </div>

                    {/* Slot grid */}
                    <div className="dp-section-title">
                        <span>Element Slotları</span>
                        <span className="dp-fill-badge">{filledCount}/9</span>
                    </div>
                    <div className="dp-slot-grid">
                        {SLOTS.map((s) => {
                            const filled  = slotValues[s] != null;
                            const active  = activeSlot === s;
                            return (
                                <button
                                    key={s}
                                    className={`dp-slot${active ? ' dp-slot--active' : ''}${filled ? ' dp-slot--filled' : ''}`}
                                    onClick={() => setActiveSlot(s)}
                                >
                                    <span className="dp-slot__label">{SLOT_LABELS[s]}</span>
                                    <span className="dp-slot__val">
                                        {filled ? slotValues[s].toFixed(1) : '—'}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Value picker */}
                    <div className="dp-picker-header">
                        <span className="dp-picker-title">{SLOT_LABELS[activeSlot]} için Değer</span>
                        <button className="dp-clear-btn" onClick={() => setSlotValues(p => { const n = {...p}; delete n[activeSlot]; return n; })}>
                            <span className="material-icons-round">backspace</span>
                            Temizle
                        </button>
                    </div>
                    <div className={`dp-values dp-values--${activeSlot === 'c' ? 'small' : 'large'}`}>
                        {(SLOT_OPTIONS[activeSlot] || []).map((v) => (
                            <button
                                key={v}
                                className={`dp-val-btn${slotValues[activeSlot] === v ? ' dp-val-btn--selected' : ''}`}
                                onClick={() => setSlotValues(p => ({ ...p, [activeSlot]: v }))}
                            >
                                {v.toFixed(1)}
                            </button>
                        ))}
                    </div>

                    {/* Deduction */}
                    <div className="dp-section-title">D Hakemi Kesintisi</div>
                    <div className="dp-deduction-row">
                        {DEDUCTION_PRESETS.map((v) => (
                            <button
                                key={v}
                                className={`dp-ded-btn${dJudgeDeduction === v ? ' dp-ded-btn--active' : ''}`}
                                onClick={() => setDJudgeDeduction(v)}
                            >
                                {v === 0 ? '0' : `-${v.toFixed(1)}`}
                            </button>
                        ))}
                    </div>

                    {/* Summary */}
                    <div className="dp-summary">
                        <div className="dp-summary__row">
                            <span>Ham Toplam</span>
                            <strong>{rawTotalRounded.toFixed(2)}</strong>
                        </div>
                        {dJudgeDeduction > 0 && (
                            <div className="dp-summary__row dp-summary__row--ded">
                                <span>D Kesinti</span>
                                <strong>−{dJudgeDeduction.toFixed(1)}</strong>
                            </div>
                        )}
                    </div>

                    {/* Submit */}
                    <button className="dp-submit-btn" onClick={handleSubmit}>
                        <span className="material-icons-round">send</span>
                        GÖNDER
                    </button>
                </div>
            )}

            {/* Sent / Locked */}
            {(status === 'sent' || status === 'locked') && (
                <div className="dp-center-state">
                    <span
                        className="material-icons-round dp-state-icon"
                        style={{ color: status === 'locked' ? '#6b7280' : '#3fb950' }}
                    >
                        {status === 'locked' ? 'lock' : 'check_circle'}
                    </span>
                    <div className="dp-state-title">
                        {status === 'locked' ? 'Kilitlendi' : 'İletildi'}
                    </div>
                    <div className="dp-sent-total">
                        {serverDPanel?.rawTotal != null ? Number(serverDPanel.rawTotal).toFixed(2) : '—'}
                    </div>

                    {serverDPanel?.slots && (
                        <div className="dp-sent-grid">
                            {SLOTS.map((s) => (
                                <div key={s} className={`dp-sent-slot${serverDPanel.slots[s] != null ? ' dp-sent-slot--filled' : ''}`}>
                                    <span className="dp-sent-slot__label">{SLOT_LABELS[s]}</span>
                                    <span className="dp-sent-slot__val">
                                        {serverDPanel.slots[s] != null
                                            ? Number(serverDPanel.slots[s]).toFixed(1)
                                            : '—'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}

                    {serverDPanel?.deduction > 0 && (
                        <div className="dp-sent-ded">Kesinti: −{Number(serverDPanel.deduction).toFixed(1)}</div>
                    )}

                    <p className="dp-state-sub">
                        {status === 'locked'
                            ? 'Başhakem puanı onayladı. Değişiklik yapılamaz.'
                            : 'Puanınız Başhakem ekranına ulaştı.'}
                    </p>

                    {status !== 'locked' && (
                        <button className="dp-edit-btn" onClick={handleEdit}>
                            <span className="material-icons-round">edit</span>
                            Düzeltme Yap
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
