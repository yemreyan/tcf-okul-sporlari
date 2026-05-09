import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ref, onValue, update, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { validateEPanelToken } from '../lib/epanelToken';
import { useNotification } from '../lib/NotificationContext';
import { useDiscipline } from '../lib/DisciplineContext';
import './EPanelPage.css';

// ── Panel konfigürasyonu ──────────────────────────────────────────────────────
// dual: true  → 2 giriş (kesinField + mainField)
// mainField   → Firebase'e yazılacak ana alan
// kesinField  → dual=true ise "kesin" alan adı
// also        → kesinField ile birlikte aynı değer yazılacak ek alanlar
const PANEL_CONFIG = {
    da1:  {
        badge: 'DA1',  title: 'Alet Zorluğu',  desc: 'DA1 Hakemi',
        color: '#7c3aed', dual: true,
        mainField: 'da1',   mainLabel: 'DA1 Notum',
        kesinField: 'da',   kesinLabel: 'DA ★ Kesin',
        also: ['daScore'],
    },
    da2:  {
        badge: 'DA2',  title: 'Alet Zorluğu',  desc: 'DA2 Hakemi',
        color: '#7c3aed', dual: false,
        mainField: 'da2',   mainLabel: 'DA2 Notum',
    },
    sjda: {
        badge: 'SJDA', title: 'Alet Zorluğu',  desc: 'SJ Hakemi',
        color: '#6b7280', dual: false,
        mainField: 'sjda',  mainLabel: 'SJDA Referans Notu',
    },
    db1:  {
        badge: 'DB1',  title: 'Vücut Zorluğu', desc: 'DB1 Hakemi',
        color: '#4f46e5', dual: true,
        mainField: 'db1',   mainLabel: 'DB1 Notum',
        kesinField: 'db',   kesinLabel: 'DB ★ Kesin',
        also: ['dbScore'],
    },
    db2:  {
        badge: 'DB2',  title: 'Vücut Zorluğu', desc: 'DB2 Hakemi',
        color: '#4f46e5', dual: false,
        mainField: 'db2',   mainLabel: 'DB2 Notum',
    },
    sjdb: {
        badge: 'SJDB', title: 'Vücut Zorluğu', desc: 'SJ Hakemi',
        color: '#6b7280', dual: false,
        mainField: 'sjdb',  mainLabel: 'SJDB Referans Notu',
    },
    sja:  {
        badge: 'SJA',  title: 'Artistlik',     desc: 'SJ Hakemi',
        color: '#ec4899', dual: false,
        mainField: 'sja',   mainLabel: 'SJA Referans Notu',
    },
    sje:  {
        badge: 'SJE',  title: 'İcra',          desc: 'SJ Hakemi',
        color: '#10b981', dual: false,
        mainField: 'sje',   mainLabel: 'SJE Referans Notu',
    },
    // Geriye dönük uyumluluk (eski da/db panelType)
    da:   {
        badge: 'DA',   title: 'Alet Zorluğu',  desc: 'DA Hakemi',
        color: '#7c3aed', dual: false,
        mainField: 'daScore', mainLabel: 'DA Puanı',
    },
    db:   {
        badge: 'DB',   title: 'Vücut Zorluğu', desc: 'DB Hakemi',
        color: '#4f46e5', dual: false,
        mainField: 'dbScore', mainLabel: 'DB Puanı',
    },
};

const RITMIK_ALET_LABELS = { top: 'Top', kurdele: 'Kurdele' };

export default function RitmikDPanelPage() {
    const { toast } = useNotification();
    const { firebasePath } = useDiscipline();
    const [searchParams] = useSearchParams();

    const compId    = searchParams.get('competitionId');
    const catId     = searchParams.get('catId');
    const aletId    = searchParams.get('aletId'); // Opsiyonel: yoksa activeAlet kullanılır
    const panelType = searchParams.get('panelType') || 'da1';
    const urlToken  = searchParams.get('token');

    const config    = PANEL_CONFIG[panelType] || PANEL_CONFIG['da'];
    const aletDynamic = !aletId;

    const [activeAthleteId, setActiveAthleteId] = useState(null);
    const [activeAlet, setActiveAlet]           = useState(null);
    // currentAlet: dinamik moddaysa activeAlet, sabit moddaysa URL aletId
    const currentAlet = aletDynamic ? activeAlet : aletId;
    const aletLabel   = RITMIK_ALET_LABELS[currentAlet] || currentAlet || '';
    const [athleteInfo, setAthleteInfo]         = useState(null);
    const [status, setStatus]                   = useState('waiting'); // 'waiting' | 'scoring' | 'sent' | 'locked'
    const [subStep, setSubStep]                 = useState('main');    // dual paneller: 'main' (1.aşama) | 'kesin' (2.aşama)
    const [tokenVerified, setTokenVerified]     = useState(false);
    const [tokenChecking, setTokenChecking]     = useState(true);
    const [scoreInput, setScoreInput]           = useState('');  // mainField değeri
    const [kesinInput, setKesinInput]           = useState('');  // kesinField değeri (dual only)
    const [serverScore, setServerScore]         = useState(null);
    const [serverKesin, setServerKesin]         = useState(null);
    const [compName, setCompName]               = useState('...');

    // ── Token doğrulama ──
    useEffect(() => {
        if (!compId || !urlToken) { setTokenChecking(false); setTokenVerified(false); return; }
        get(ref(db, `${firebasePath}/${compId}/epanelToken`)).then((snap) => {
            setTokenVerified(!!(snap.val() && validateEPanelToken(urlToken, snap.val())));
            setTokenChecking(false);
        }).catch(() => { setTokenVerified(false); setTokenChecking(false); });
    }, [compId, urlToken, firebasePath]);

    // ── Yarışma adı + aktif sporcu ──
    useEffect(() => {
        if (!compId || !catId || !tokenVerified) return;

        const unsubComp = onValue(ref(db, `${firebasePath}/${compId}/isim`), (snap) => {
            if (snap.val()) setCompName(snap.val());
        });

        const unsubActive = onValue(ref(db, `${firebasePath}/${compId}/aktifSporcu/${catId}`), (snap) => {
            const val = snap.val();
            if (val) {
                if (typeof val === 'object' && val.id) {
                    // New format: object with id + name info
                    setActiveAthleteId(val.id);
                    setAthleteInfo({ ad: val.ad || '', soyad: val.soyad || '', okul: val.okul || '' });
                } else {
                    // Legacy format: plain string id
                    const idStr = String(val);
                    setActiveAthleteId(idStr);
                    fetchAthlete(idStr);
                }
            } else {
                setActiveAthleteId(null);
                setAthleteInfo(null); setStatus('waiting');
                setScoreInput(''); setKesinInput('');
                setServerScore(null); setServerKesin(null);
            }
        });

        const unsubAlet = onValue(ref(db, `${firebasePath}/${compId}/aktifAlet/${catId}`), (snap) => {
            setActiveAlet(snap.val());
        });

        return () => { unsubComp(); unsubActive(); unsubAlet(); };
    }, [compId, catId, tokenVerified, firebasePath]);

    const fetchAthlete = async (id) => {
        const snap = await get(ref(db, `${firebasePath}/${compId}/sporcular/${catId}/${id}`));
        let ath = snap.val();
        if (!ath) { const g = await get(ref(db, `globalSporcular/${id}`)); ath = g.val(); }
        setAthleteInfo(ath || { ad: 'Bilinmeyen', soyad: 'Sporcu', kulup: '' });
    };

    // ── Puan dinleme ──
    useEffect(() => {
        if (!compId || !catId || !currentAlet || !activeAthleteId || !tokenVerified) return;
        const scoreRef = ref(db, `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}/${currentAlet}`);
        const unsub = onValue(scoreRef, (snap) => {
            const data     = snap.val() || {};
            const myScore  = data[config.mainField];
            const myKesin  = config.dual ? data[config.kesinField] : undefined;
            const isLocked = data.kilitli === true;
            const hasMain  = myScore !== undefined && myScore !== null;
            const hasKesin = myKesin !== undefined && myKesin !== null;

            setServerScore(myScore ?? null);
            setServerKesin(myKesin ?? null);

            if (isLocked) {
                setStatus('locked');
            } else if (config.dual) {
                // 2 aşamalı dual panel:
                //   hasMain && hasKesin  → tamamen iletildi
                //   hasMain (kesin yok) → 2. aşama (Kesin) bekleniyor
                //   hiçbiri yok          → 1. aşama (mainField)
                if (hasMain && hasKesin) {
                    setStatus('sent');
                    setSubStep('main');
                } else if (hasMain) {
                    setStatus('scoring');
                    setSubStep('kesin');
                } else {
                    setStatus('scoring');
                    setSubStep('main');
                }
            } else {
                // Tek aşamalı paneller (DA2, SJDA, SJDB, SJA, SJE …)
                if (hasMain) setStatus('sent');
                else         setStatus('scoring');
                setSubStep('main');
            }
        });
        return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [compId, catId, currentAlet, activeAthleteId, panelType, tokenVerified, firebasePath]);

    const parseVal = (str) => {
        const v = parseFloat(String(str).replace(',', '.'));
        return (isNaN(v) || v < 0) ? null : v;
    };
    const getPath = () => `${firebasePath}/${compId}/puanlar/${catId}/${activeAthleteId}/${currentAlet}`;

    // ── 1. Aşama: Ana not gönder (DA1 / DB1 / DA2 / SJDA / SJDB / SJA / SJE) ──
    const handleSendMain = async () => {
        if (!activeAthleteId || scoreInput === '') return;
        const mainVal = parseVal(scoreInput);
        if (mainVal === null) { toast('Geçersiz puan! 0 veya üzeri bir sayı girin.', 'warning'); return; }
        if (!currentAlet)     { toast('Henüz alet seçilmedi.', 'warning'); return; }
        try {
            await update(ref(db, getPath()), { [config.mainField]: mainVal });
            setScoreInput('');
            // Listener subStep='kesin'e otomatik geçirecek (dual ise)
        } catch {
            toast('Hata oluştu. Lütfen tekrar deneyin.', 'error');
        }
    };

    // ── 2. Aşama: Kesin not gönder (sadece dual paneller — DA Kesin / DB Kesin) ──
    const handleSendKesin = async () => {
        if (!activeAthleteId || kesinInput === '') return;
        const kesinVal = parseVal(kesinInput);
        if (kesinVal === null) { toast(`${config.kesinLabel} için geçersiz değer!`, 'warning'); return; }
        if (!currentAlet)      { toast('Henüz alet seçilmedi.', 'warning'); return; }
        try {
            const updates = { [config.kesinField]: kesinVal };
            if (config.also) config.also.forEach(f => { updates[f] = kesinVal; });
            await update(ref(db, getPath()), updates);
            setKesinInput('');
            // Listener status='sent'e otomatik geçirecek
        } catch {
            toast('Hata oluştu. Lütfen tekrar deneyin.', 'error');
        }
    };

    const requestEdit = () => {
        // Düzeltme yapma — hangi alanı düzeltecek?
        // Dual ise: kesin alanı varsa kesin'e dön, yoksa main'e dön
        if (config.dual && serverKesin !== null) {
            setSubStep('kesin');
            setKesinInput(serverKesin !== null ? String(serverKesin) : '');
        } else {
            setSubStep('main');
            setScoreInput(serverScore !== null ? String(serverScore) : '');
        }
        setStatus('scoring');
    };

    // ── Guard: eksik URL parametresi (aletId opsiyonel — yoksa activeAlet kullanılır) ──
    if (!compId || !catId) {
        return (
            <div className="epanel-wrapper epanel-error">
                <h2>Hatalı Link!</h2>
                <p>Lütfen Başhakeminizden iletilen tam linke tıklayın veya sayfayı yenileyin.</p>
            </div>
        );
    }
    if (tokenChecking) {
        return (
            <div className="epanel-wrapper">
                <div className="epanel-main">
                    <div className="view-section active waiting-view">
                        <span className="material-icons-round waiting-icon">hourglass_empty</span>
                        <div className="waiting-text">Doğrulanıyor...</div>
                    </div>
                </div>
            </div>
        );
    }
    if (!tokenVerified) {
        return (
            <div className="epanel-wrapper epanel-error">
                <h2>Yetkisiz Erişim</h2>
                <p>Bu bağlantı geçersiz veya süresi dolmuş. Lütfen Başhakeminizden yeni bir QR kod/link alın.</p>
            </div>
        );
    }

    // Dinamik mod: alet henüz seçilmemiş; Sabit mod: yanlış alet aktif
    const waitingForAlet = aletDynamic
        ? !activeAlet
        : (activeAlet !== null && activeAlet !== aletId);

    return (
        <div className="epanel-wrapper">
            <div className="epanel-header">
                <div>
                    <div className="header-sub">{compName}</div>
                    <div className="header-title">{config.desc} — {config.title}</div>
                    <div className="header-alet">{aletLabel}</div>
                </div>
                <div className="panel-badge" style={{ background: `linear-gradient(135deg,${config.color},${config.color}bb)` }}>
                    {config.badge}
                </div>
            </div>

            <div className="epanel-main">
                {/* Yanlış alet aktif mi? */}
                {waitingForAlet && (
                    <div className="view-section active waiting-view">
                        <span className="material-icons-round waiting-icon">swap_horiz</span>
                        <div className="waiting-text">{RITMIK_ALET_LABELS[activeAlet] || activeAlet} Değerlendiriliyor</div>
                        <p className="waiting-subtext">{aletLabel} değerlendirmesi başladığında ekranınız açılacaktır.</p>
                    </div>
                )}

                {/* Sporcu bekleniyor */}
                {!waitingForAlet && status === 'waiting' && (
                    <div className="view-section active waiting-view">
                        <span className="material-icons-round waiting-icon">hourglass_empty</span>
                        <div className="waiting-text">Sporcu Bekleniyor...</div>
                        <p className="waiting-subtext">Başhakem tarafından sporcu çağrıldığında ekranınız açılacaktır.</p>
                    </div>
                )}

                {/* Puan girişi */}
                {!waitingForAlet && status === 'scoring' && athleteInfo && (
                    <div className="view-section active scoring-view">
                        <div className="athlete-card">
                            <div className="athlete-name">{athleteInfo.ad} {athleteInfo.soyad}</div>
                            <div className="athlete-club">{athleteInfo.kulup || athleteInfo.okul || '-'}</div>
                        </div>
                        <div className="scoring-card">
                            {!config.dual ? (
                                /* ── Tek aşamalı paneller (DA2, SJDA, SJDB, SJA, SJE) ── */
                                <>
                                    <div className="input-label">{config.mainLabel}</div>
                                    <input
                                        type="number"
                                        className="score-input"
                                        placeholder="0.000"
                                        step="0.1"
                                        min="0"
                                        value={scoreInput}
                                        onChange={(e) => setScoreInput(e.target.value)}
                                        autoFocus
                                    />
                                    <div className="quick-buttons">
                                        <button type="button" onClick={() => setScoreInput('0.1')}>0.1</button>
                                        <button type="button" onClick={() => setScoreInput('0.3')}>0.3</button>
                                        <button type="button" onClick={() => setScoreInput('0.5')}>0.5</button>
                                        <button type="button" onClick={() => setScoreInput('1.0')}>1.0</button>
                                    </div>
                                    <button className="send-btn" onClick={handleSendMain}>
                                        <span className="material-icons-round">send</span> GÖNDER
                                    </button>
                                </>
                            ) : subStep === 'main' ? (
                                /* ── Aşama 1: Kendi notum (DA1 / DB1) ── */
                                <>
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        padding: '0.4rem 0.75rem',
                                        marginBottom: '0.85rem',
                                        background: 'rgba(124, 58, 237, 0.15)',
                                        borderRadius: '0.5rem',
                                        fontSize: '0.78rem',
                                        fontWeight: 700,
                                        letterSpacing: '0.04em',
                                    }}>
                                        <span style={{
                                            background: '#7c3aed', color: '#fff',
                                            width: 22, height: 22, borderRadius: '50%',
                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: '0.72rem',
                                        }}>1</span>
                                        AŞAMA 1 / 2 — KENDİ NOTUM
                                    </div>
                                    <div className="input-label">{config.mainLabel}</div>
                                    <input
                                        type="number"
                                        className="score-input"
                                        placeholder="0.000"
                                        step="0.1"
                                        min="0"
                                        value={scoreInput}
                                        onChange={(e) => setScoreInput(e.target.value)}
                                        autoFocus
                                    />
                                    <div className="quick-buttons">
                                        <button type="button" onClick={() => setScoreInput('0.1')}>0.1</button>
                                        <button type="button" onClick={() => setScoreInput('0.3')}>0.3</button>
                                        <button type="button" onClick={() => setScoreInput('0.5')}>0.5</button>
                                        <button type="button" onClick={() => setScoreInput('1.0')}>1.0</button>
                                    </div>
                                    <button className="send-btn" onClick={handleSendMain}>
                                        <span className="material-icons-round">send</span> {config.mainLabel} GÖNDER
                                    </button>
                                    <div style={{ marginTop: '0.55rem', fontSize: '0.74rem', color: 'rgba(255,255,255,0.55)', textAlign: 'center' }}>
                                        Gönderdikten sonra <strong style={{ color: '#fbbf24' }}>{config.kesinLabel}</strong> giriş ekranı açılacak.
                                    </div>
                                </>
                            ) : (
                                /* ── Aşama 2: Kesin not (ortak DA/DB Kesin) ── */
                                <>
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        padding: '0.4rem 0.75rem',
                                        marginBottom: '0.85rem',
                                        background: 'rgba(251, 191, 36, 0.15)',
                                        borderRadius: '0.5rem',
                                        fontSize: '0.78rem',
                                        fontWeight: 700,
                                        letterSpacing: '0.04em',
                                    }}>
                                        <span style={{
                                            background: '#fbbf24', color: '#1f2937',
                                            width: 22, height: 22, borderRadius: '50%',
                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: '0.72rem',
                                        }}>2</span>
                                        AŞAMA 2 / 2 — KESİN NOT
                                    </div>

                                    {/* Aşama 1 özeti */}
                                    <div style={{
                                        padding: '0.55rem 0.75rem',
                                        background: 'rgba(34, 197, 94, 0.1)',
                                        border: '1px solid rgba(34, 197, 94, 0.3)',
                                        borderRadius: '0.5rem',
                                        marginBottom: '0.85rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                    }}>
                                        <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.75)' }}>
                                            <span className="material-icons-round" style={{ fontSize: '0.95rem', color: '#22c55e', verticalAlign: 'middle', marginRight: 4 }}>check_circle</span>
                                            {config.mainLabel}: <strong style={{ color: '#86efac' }}>{Number(serverScore).toFixed(3)}</strong>
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => { setSubStep('main'); setScoreInput(String(serverScore)); }}
                                            style={{
                                                background: 'transparent',
                                                border: '1px solid rgba(255,255,255,0.2)',
                                                color: 'rgba(255,255,255,0.7)',
                                                padding: '0.25rem 0.55rem',
                                                borderRadius: '0.35rem',
                                                fontSize: '0.7rem',
                                                cursor: 'pointer',
                                            }}
                                            title="Önceki aşamaya dön"
                                        >
                                            DÜZELT
                                        </button>
                                    </div>

                                    <div className="input-label">{config.kesinLabel}</div>
                                    <input
                                        type="number"
                                        className="score-input"
                                        placeholder="0.000"
                                        step="0.1"
                                        min="0"
                                        value={kesinInput}
                                        onChange={(e) => setKesinInput(e.target.value)}
                                        autoFocus
                                    />
                                    <div className="quick-buttons">
                                        <button type="button" onClick={() => setKesinInput('0.1')}>0.1</button>
                                        <button type="button" onClick={() => setKesinInput('0.3')}>0.3</button>
                                        <button type="button" onClick={() => setKesinInput('0.5')}>0.5</button>
                                        <button type="button" onClick={() => setKesinInput('1.0')}>1.0</button>
                                    </div>
                                    <button className="send-btn" onClick={handleSendKesin}>
                                        <span className="material-icons-round">send</span> {config.kesinLabel} GÖNDER
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* Gönderildi / Kilitli */}
                {!waitingForAlet && (status === 'sent' || status === 'locked') && (
                    <div className="view-section active sent-view">
                        <span
                            className="material-icons-round sent-icon"
                            style={{ color: status === 'locked' ? '#6b7280' : 'var(--success)' }}
                        >
                            {status === 'locked' ? 'lock' : 'check_circle'}
                        </span>
                        <h2 className="sent-title">{status === 'locked' ? 'Puan Kilitlendi' : 'İletildi'}</h2>

                        {/* Dual: Kesin Puan göster */}
                        {config.dual && serverKesin !== null && (
                            <div className="sent-score-display" style={{ color: '#a78bfa', fontSize: '1.4rem', marginBottom: '4px' }}>
                                {config.kesinLabel}: {Number(serverKesin).toFixed(3)}
                            </div>
                        )}
                        {/* Ana puan */}
                        <div className="sent-score-display" style={{ color: status === 'locked' ? '#9ca3af' : 'var(--neon-green)' }}>
                            {config.mainLabel}: {serverScore !== null ? Number(serverScore).toFixed(3) : '—'}
                        </div>

                        <p className="sent-desc">
                            {status === 'locked'
                                ? 'Başhakem puanı onayladı. Artık değişiklik yapılamaz.'
                                : 'Puanınız Başhakem ekranına ulaştı. Onay bekleniyor.'}
                        </p>
                        {status !== 'locked' && (
                            <button className="edit-btn" onClick={requestEdit}>Düzeltme Yap</button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
