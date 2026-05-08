import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { validateEPanelToken } from '../lib/epanelToken';
import { useNotification } from '../lib/NotificationContext';
import { useDiscipline } from '../lib/DisciplineContext';
import './AerobikAPanelPage.css';

// ─── Constants ───────────────────────────────────────────────────────────────

const A_SCALE_VALUES = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0];

const A_CRITERIA = {
    aerobik: [
        { key: 'music',           label: 'Müzik' },
        { key: 'content2',        label: 'Aerobik İçerik' },
        { key: 'generalContent',  label: 'Genel İçerik' },
        { key: 'artisticRoutine', label: 'Artistik Seri' },
        { key: 'performance',     label: 'Performans' },
    ],
    aero_step: [
        { key: 'music',           label: 'Müzik' },
        { key: 'content2',        label: 'Step İçeriği' },
        { key: 'generalContent',  label: 'Genel İçerik' },
        { key: 'artisticRoutine', label: 'Artistik Seri' },
        { key: 'performance',     label: 'Performans' },
    ],
};

const A_DEDUCTIONS = {
    aerobik: [
        { key: 'ampSetMissing',      label: 'Eksik AMP Seti',       reduce: -0.5, isCounter: true },
        { key: 'ampBlockMissing',    label: 'Eksik AMP Blok',       reduce: -0.5, isCounter: false },
        { key: 'lessThan3Collab',    label: "3'ten az işbirliği",    reduce: -0.5, isCounter: false },
        { key: 'missingZone',        label: 'Alan/Bölge eksik',      reduce: -0.5, isCounter: false },
        { key: 'missingIntro',       label: 'Giriş eksik',           reduce: -0.5, isCounter: false },
        { key: 'endingWithElements', label: 'Elementle biten seri',  reduce: -0.5, isCounter: false },
        { key: 'multipleTouchFall',  label: 'Çoklu temas / Düşme',  reduce: -0.5, isCounter: false },
    ],
    aero_step: [
        { key: 'missingSteppingSet', label: 'Eksik 9 Step Seti',    reduce: -0.5, isCounter: true },
        { key: 'missingStepBlock',   label: 'Eksik Step Blok',      reduce: -0.5, isCounter: false },
        { key: 'missingZone',        label: 'Alan/Bölge eksik',     reduce: -0.5, isCounter: false },
        { key: 'missingTheme',       label: 'Tema eksik',           reduce: -0.5, isCounter: false },
        { key: 'missingIntro',       label: 'Açılış/Giriş eksik',   reduce: -0.5, isCounter: false },
        { key: 'fall',               label: 'Düşme',                reduce: -0.5, isCounter: false },
    ],
};

function getCategoryType(catId) {
    return catId?.startsWith('step_') ? 'aero_step' : 'aerobik';
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AerobikAPanelPage() {
    const { toast }         = useNotification();
    const { firebasePath }  = useDiscipline();
    const [searchParams]    = useSearchParams();

    const compId   = searchParams.get('competitionId');
    const catId    = searchParams.get('catId');
    const panelId  = searchParams.get('panelId'); // 'a1' | 'a2' | 'a3' | 'a4'
    const urlToken = searchParams.get('token');

    // ── Auth ─────────────────────────────────────────────────────────────────
    const [tokenVerified, setTokenVerified] = useState(false);
    const [tokenChecking, setTokenChecking] = useState(true);

    // ── Data ─────────────────────────────────────────────────────────────────
    const [compName, setCompName]               = useState('...');
    const [activeAthleteId, setActiveAthleteId] = useState(null);
    const [athleteInfo, setAthleteInfo]         = useState(null);

    // ── Scoring ──────────────────────────────────────────────────────────────
    const [criteriaValues, setCriteriaValues]   = useState({});
    const [deductionValues, setDeductionValues] = useState({});
    const [serverBreakdown, setServerBreakdown] = useState(null);
    const [status, setStatus]                   = useState('waiting');

    // ── Derived ──────────────────────────────────────────────────────────────
    const catType    = getCategoryType(catId);
    const criteria   = A_CRITERIA[catType]   || A_CRITERIA.aerobik;
    const deductions = A_DEDUCTIONS[catType] || A_DEDUCTIONS.aerobik;
    const judgeKey   = panelId ? panelId.replace(/^a/, 'j') : 'j1';

    const scaleTotal        = criteria.reduce((s, c) => s + (criteriaValues[c.key] || 0), 0);
    const scaleTotalRounded = Math.round(scaleTotal * 10) / 10;
    const deductionTotal    = deductions.reduce((s, d) => s + (deductionValues[d.key] || 0) * d.reduce, 0);
    const finalAScore       = Math.max(0, Math.round((scaleTotalRounded + deductionTotal) * 10) / 10);
    const filledCount       = criteria.filter(c => criteriaValues[c.key] != null).length;
    const allFilled         = filledCount === criteria.length;

    // ── Token ────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!compId || !urlToken) { setTokenChecking(false); return; }
        get(ref(db, `${firebasePath}/${compId}/epanelToken`))
            .then(snap => {
                setTokenVerified(!!(snap.val() && validateEPanelToken(urlToken, snap.val())));
                setTokenChecking(false);
            })
            .catch(() => { setTokenVerified(false); setTokenChecking(false); });
    }, [compId, urlToken, firebasePath]);

    // ── Competition name ──────────────────────────────────────────────────────
    useEffect(() => {
        if (!compId || !tokenVerified) return;
        return onValue(ref(db, `${firebasePath}/${compId}/isim`), snap => setCompName(snap.val() || 'Yarışma'));
    }, [compId, tokenVerified, firebasePath]);

    // ── Active athlete ────────────────────────────────────────────────────────
    useEffect(() => {
        if (!compId || !catId || !tokenVerified) return;
        return onValue(ref(db, `${firebasePath}/${compId}/aktifSporcu/${catId}`), snap => {
            const val = snap.val();
            if (val) {
                if (typeof val === 'object' && val.id) {
                    // New format: object with id + name info — no second lookup needed
                    setActiveAthleteId(val.id);
                    setAthleteInfo({ ad: val.ad || '', soyad: val.soyad || '', okul: val.okul || '' });
                } else {
                    // Legacy format: plain string id
                    const id = String(val);
                    setActiveAthleteId(id);
                    fetchAthleteData(id);
                }
            } else {
                setActiveAthleteId(null);
                setAthleteInfo(null);
                setStatus('waiting');
                resetState();
            }
        });
    }, [compId, catId, tokenVerified, firebasePath]);

    // ── Score listener ────────────────────────────────────────────────────────
    useEffect(() => {
        if (!compId || !catId || !activeAthleteId || !tokenVerified) return;
        return onValue(ref(db, `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}`), snap => {
            const data      = snap.val() || {};
            const isLocked  = data.kilitli === true;
            const myScore   = data.aPanel?.[judgeKey];
            const breakdown = data.aPanelBreakdown?.[judgeKey] || null;
            setServerBreakdown(breakdown);
            if (isLocked)                          setStatus('locked');
            else if (myScore != null)              setStatus('sent');
            else setStatus(p => p === 'waiting' ? 'scoring' : p);
        });
    }, [compId, catId, activeAthleteId, judgeKey, tokenVerified, firebasePath]);

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

    const resetState = () => { setCriteriaValues({}); setDeductionValues({}); setServerBreakdown(null); };

    // ── Submit ────────────────────────────────────────────────────────────────
    const handleSubmit = async () => {
        if (!activeAthleteId || !allFilled) return;
        const base = `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}`;
        try {
            await update(ref(db), {
                [`${base}/aPanel/${judgeKey}`]:           finalAScore,
                [`${base}/aPanelBreakdown/${judgeKey}`]:  { criteriaValues, deductionValues, finalAScore },
            });
        } catch {
            toast('Hata oluştu. Lütfen tekrar deneyin.', 'error');
        }
    };

    const handleEdit = () => {
        if (serverBreakdown) {
            setCriteriaValues(serverBreakdown.criteriaValues || {});
            setDeductionValues(serverBreakdown.deductionValues || {});
        } else { resetState(); }
        setStatus('scoring');
    };

    // ── Guards ────────────────────────────────────────────────────────────────
    if (!compId || !catId || !panelId) return (
        <div className="ap-error">
            <span className="material-icons-round">error</span>
            <p>Hatalı link. Başhakeminizden QR kodu yeniden alın.</p>
        </div>
    );

    if (tokenChecking) return (
        <div className="ap-page"><div className="ap-center-state">
            <span className="material-icons-round ap-state-icon">hourglass_empty</span>
            <div className="ap-state-title">Doğrulanıyor…</div>
        </div></div>
    );

    if (!tokenVerified) return (
        <div className="ap-error">
            <span className="material-icons-round">lock</span>
            <p>Yetkisiz erişim. Geçersiz veya süresi dolmuş bağlantı.</p>
        </div>
    );

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="ap-page">
            {/* Header */}
            <div className="ap-header">
                <div className="ap-header__info">
                    <div className="ap-header__comp">{compName}</div>
                    <div className="ap-header__title">A — Artistik Hakem</div>
                </div>
                <div className="ap-header__badge">{panelId?.toUpperCase()}</div>
            </div>

            {/* Waiting */}
            {status === 'waiting' && (
                <div className="ap-center-state">
                    <span className="material-icons-round ap-state-icon">hourglass_empty</span>
                    <div className="ap-state-title">Sporcu Bekleniyor…</div>
                    <p className="ap-state-sub">Başhakem sporcu çağırdığında ekran açılacak.</p>
                </div>
            )}

            {/* Scoring */}
            {status === 'scoring' && athleteInfo && (
                <div className="ap-scoring">
                    {/* Athlete */}
                    <div className="ap-athlete">
                        <span className="material-icons-round ap-athlete__icon">person</span>
                        <div>
                            <div className="ap-athlete__name">{athleteInfo.ad} {athleteInfo.soyad}</div>
                            <div className="ap-athlete__club">{athleteInfo.kulup || athleteInfo.okul || '—'}</div>
                        </div>
                    </div>

                    {/* Criteria cards */}
                    <div className="ap-section-title">
                        <span>Artistik Puanlama</span>
                        <span className="ap-fill-badge">{filledCount}/{criteria.length}</span>
                    </div>

                    <div className="ap-criteria-list">
                        {criteria.map((c, idx) => {
                            const selected = criteriaValues[c.key];
                            return (
                                <div key={c.key} className={`ap-criterion${selected != null ? ' ap-criterion--filled' : ''}`}>
                                    <div className="ap-criterion__header">
                                        <div className="ap-criterion__num">{idx + 1}</div>
                                        <div className="ap-criterion__label">{c.label}</div>
                                        {selected != null && (
                                            <div className="ap-criterion__selected">{selected.toFixed(1)}</div>
                                        )}
                                    </div>
                                    <div className="ap-scale-row">
                                        {A_SCALE_VALUES.map((v) => (
                                            <button
                                                key={v}
                                                className={`ap-scale-btn${selected === v ? ' ap-scale-btn--active' : ''}`}
                                                onClick={() => setCriteriaValues(p => ({ ...p, [c.key]: v }))}
                                            >
                                                {v.toFixed(1)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Deductions */}
                    <div className="ap-section-title" style={{ marginTop: '1.5rem' }}>Kesintiler</div>
                    <div className="ap-deduction-list">
                        {deductions.map((d) => {
                            const val = deductionValues[d.key] || 0;
                            const active = val > 0;
                            return (
                                <div key={d.key} className={`ap-ded-item${active ? ' ap-ded-item--active' : ''}`}>
                                    <div className="ap-ded-info">
                                        <span className="ap-ded-label">{d.label}</span>
                                        <span className="ap-ded-amount">−0.5{d.isCounter && val > 0 ? ` × ${val}` : ''}</span>
                                    </div>
                                    {d.isCounter ? (
                                        <div className="ap-counter">
                                            <button className="ap-counter__btn ap-counter__btn--minus"
                                                onClick={() => setDeductionValues(p => ({ ...p, [d.key]: Math.max(0, (p[d.key] || 0) - 1) }))}>
                                                −
                                            </button>
                                            <span className="ap-counter__val">{val}</span>
                                            <button className="ap-counter__btn ap-counter__btn--plus"
                                                onClick={() => setDeductionValues(p => ({ ...p, [d.key]: (p[d.key] || 0) + 1 }))}>
                                                +
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            className={`ap-toggle${active ? ' ap-toggle--on' : ''}`}
                                            onClick={() => setDeductionValues(p => ({ ...p, [d.key]: active ? 0 : 1 }))}
                                        >
                                            <span className="material-icons-round">
                                                {active ? 'toggle_on' : 'toggle_off'}
                                            </span>
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Summary */}
                    <div className="ap-summary">
                        <div className="ap-summary__row">
                            <span>Ölçek Toplamı</span>
                            <strong>{scaleTotalRounded.toFixed(1)}</strong>
                        </div>
                        {deductionTotal < 0 && (
                            <div className="ap-summary__row ap-summary__row--ded">
                                <span>Kesinti</span>
                                <strong>{deductionTotal.toFixed(1)}</strong>
                            </div>
                        )}
                        <div className="ap-summary__divider" />
                        <div className="ap-summary__row ap-summary__row--final">
                            <span>A Puanı</span>
                            <strong className="ap-summary__final">{finalAScore.toFixed(1)}</strong>
                        </div>
                    </div>

                    {/* Submit */}
                    <button
                        className={`ap-submit-btn${!allFilled ? ' ap-submit-btn--disabled' : ''}`}
                        disabled={!allFilled}
                        onClick={handleSubmit}
                    >
                        <span className="material-icons-round">send</span>
                        {allFilled ? 'GÖNDER' : `${criteria.length - filledCount} kriter eksik`}
                    </button>
                </div>
            )}

            {/* Sent / Locked */}
            {(status === 'sent' || status === 'locked') && (
                <div className="ap-center-state">
                    <span
                        className="material-icons-round ap-state-icon"
                        style={{ color: status === 'locked' ? '#6b7280' : '#3fb950' }}
                    >
                        {status === 'locked' ? 'lock' : 'check_circle'}
                    </span>
                    <div className="ap-state-title">
                        {status === 'locked' ? 'Kilitlendi' : 'İletildi'}
                    </div>
                    <div className="ap-sent-score">
                        {serverBreakdown?.finalAScore != null
                            ? Number(serverBreakdown.finalAScore).toFixed(1)
                            : '—'}
                    </div>

                    {serverBreakdown?.criteriaValues && (
                        <div className="ap-sent-breakdown">
                            {criteria.map(c => (
                                <div key={c.key} className="ap-sent-row">
                                    <span>{c.label}</span>
                                    <span>{serverBreakdown.criteriaValues[c.key]?.toFixed(1) ?? '—'}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    <p className="ap-state-sub">
                        {status === 'locked'
                            ? 'Başhakem puanı onayladı. Değişiklik yapılamaz.'
                            : 'Puanınız Başhakem ekranına ulaştı.'}
                    </p>

                    {status !== 'locked' && (
                        <button className="ap-edit-btn" onClick={handleEdit}>
                            <span className="material-icons-round">edit</span>
                            Düzeltme Yap
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
