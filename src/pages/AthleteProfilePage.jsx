import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { useDiscipline } from '../lib/DisciplineContext';
import './AthleteProfilePage.css';
import { maskTckn } from '../lib/privacy';

const ALET_LABELS = {
    atlama: 'Atlama', barfiks: 'Barfiks', halka: 'Halka', kulplu: 'Kulplu Beygir',
    mantar: 'Mantar Beygir', paralel: 'Paralel', yer: 'Yer', denge: 'Denge Aleti',
    asimetrik: 'Asimetrik Paralel', ritmik: 'Ritmik',
};
const getAletLabel = (key) => ALET_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
const getCategoryLabel = (catKey) => catKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

function formatDateTR(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function AthleteProfilePage() {
    const navigate = useNavigate();
    const { compId, catId, athId } = useParams();
    const { currentUser } = useAuth();
    const { firebasePath, routePrefix } = useDiscipline();

    const [competitions, setCompetitions] = useState({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = onValue(ref(db, firebasePath), s => {
            setCompetitions(s.val() || {});
            setLoading(false);
        });
        return () => unsub();
    }, []);

    const filteredComps = useMemo(
        () => filterCompetitionsByUser(competitions, currentUser),
        [competitions, currentUser]
    );

    // Ana sporcu verisi
    const athlete = useMemo(() => {
        const comp = filteredComps[compId];
        if (!comp?.sporcular?.[catId]?.[athId]) return null;
        return { id: athId, categoryId: catId, compId, ...comp.sporcular[catId][athId] };
    }, [filteredComps, compId, catId, athId]);

    // Bu yarışmadaki puanlar
    const currentScores = useMemo(() => {
        const comp = filteredComps[compId];
        if (!comp?.puanlar?.[catId]) return [];
        const scores = [];
        Object.entries(comp.puanlar[catId]).forEach(([aletId, aletData]) => {
            if (aletData?.[athId]) {
                scores.push({
                    aletId,
                    aletLabel: getAletLabel(aletId),
                    ...aletData[athId]
                });
            }
        });
        return scores.sort((a, b) => a.aletLabel.localeCompare(b.aletLabel));
    }, [filteredComps, compId, catId, athId]);

    // Diğer yarışmalardaki geçmiş (TCKN veya lisans eşleşmesi)
    const history = useMemo(() => {
        if (!athlete) return [];
        const tckn = athlete.tckn;
        const lisans = athlete.lisans || athlete.lisansNo;
        const results = [];

        Object.entries(filteredComps).forEach(([cId, comp]) => {
            if (cId === compId) return; // Mevcut yarışmayı atla
            if (!comp.sporcular) return;

            Object.entries(comp.sporcular).forEach(([cCatId, catData]) => {
                Object.entries(catData).forEach(([cAthId, ath]) => {
                    const match = (tckn && ath.tckn === tckn) ||
                                  (lisans && (ath.lisans === lisans || ath.lisansNo === lisans));
                    if (!match) return;

                    // Puanları topla
                    const scores = [];
                    if (comp.puanlar?.[cCatId]) {
                        Object.entries(comp.puanlar[cCatId]).forEach(([aletId, aletData]) => {
                            if (aletData?.[cAthId]) {
                                scores.push({
                                    aletId,
                                    aletLabel: getAletLabel(aletId),
                                    ...aletData[cAthId]
                                });
                            }
                        });
                    }

                    results.push({
                        compId: cId,
                        compIsim: comp.isim,
                        compTarih: comp.baslangicTarihi,
                        compIl: comp.il,
                        categoryId: cCatId,
                        categoryLabel: getCategoryLabel(cCatId),
                        scores,
                    });
                });
            });
        });

        return results.sort((a, b) => (b.compTarih || '').localeCompare(a.compTarih || ''));
    }, [athlete, filteredComps, compId]);

    // Genel istatistikler
    const stats = useMemo(() => {
        const allScores = [...currentScores];
        history.forEach(h => allScores.push(...h.scores));
        if (allScores.length === 0) return null;

        const totals = allScores.filter(s => s.sonuc != null).map(s => s.sonuc);
        if (totals.length === 0) return null;

        return {
            totalEntries: allScores.length,
            avgScore: (totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(3),
            bestScore: Math.max(...totals).toFixed(3),
            compCount: history.length + 1,
        };
    }, [currentScores, history]);

    const currentComp = filteredComps[compId];

    if (loading) {
        return (
            <div className="ath-profile">
                <div className="ath-profile__loading">
                    <div className="ath-profile__spinner" />
                    <span>Yükleniyor...</span>
                </div>
            </div>
        );
    }

    if (!athlete) {
        return (
            <div className="ath-profile">
                <header className="ath-header">
                    <button className="ath-back" onClick={() => { if (window.history.length > 1) navigate(-1); else navigate(routePrefix); }}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <h1>Sporcu Bulunamadı</h1>
                </header>
                <div className="ath-profile__empty">
                    <i className="material-icons-round">person_off</i>
                    <p>Bu sporcu kaydı bulunamadı veya erişim yetkiniz yok.</p>
                    <button className="ath-btn ath-btn--back" onClick={() => navigate(`${routePrefix}/athletes`)}>
                        Sporculara Dön
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="ath-profile">
            {/* Header */}
            <header className="ath-header">
                <div className="ath-header__left">
                    <button className="ath-back" onClick={() => { if (window.history.length > 1) navigate(-1); else navigate(routePrefix); }}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div>
                        <h1 className="ath-header__name">{athlete.ad} {athlete.soyad}</h1>
                        <p className="ath-header__sub">Sporcu Profili</p>
                    </div>
                </div>
            </header>

            <main className="ath-main">
                {/* Profil Kartı */}
                <div className="ath-card ath-card--profile">
                    <div className="ath-avatar">
                        <span>{(athlete.ad || '?')[0]}{(athlete.soyad || '?')[0]}</span>
                    </div>
                    <div className="ath-info-grid">
                        {athlete.tckn && (
                            <div className="ath-info-item">
                                <i className="material-icons-round">badge</i>
                                <div>
                                    <span className="ath-info-label">TCKN</span>
                                    <span className="ath-info-value">{maskTckn(athlete.tckn)}</span>
                                </div>
                            </div>
                        )}
                        {(athlete.lisans || athlete.lisansNo) && (
                            <div className="ath-info-item">
                                <i className="material-icons-round">confirmation_number</i>
                                <div>
                                    <span className="ath-info-label">Lisans No</span>
                                    <span className="ath-info-value">{athlete.lisans || athlete.lisansNo}</span>
                                </div>
                            </div>
                        )}
                        {athlete.dob && (
                            <div className="ath-info-item">
                                <i className="material-icons-round">cake</i>
                                <div>
                                    <span className="ath-info-label">Doğum Tarihi</span>
                                    <span className="ath-info-value">{athlete.dob}</span>
                                </div>
                            </div>
                        )}
                        {athlete.okul && (
                            <div className="ath-info-item">
                                <i className="material-icons-round">school</i>
                                <div>
                                    <span className="ath-info-label">Okul</span>
                                    <span className="ath-info-value">{athlete.okul}</span>
                                </div>
                            </div>
                        )}
                        {athlete.il && (
                            <div className="ath-info-item">
                                <i className="material-icons-round">location_on</i>
                                <div>
                                    <span className="ath-info-label">İl</span>
                                    <span className="ath-info-value">{athlete.il}</span>
                                </div>
                            </div>
                        )}
                        <div className="ath-info-item">
                            <i className="material-icons-round">category</i>
                            <div>
                                <span className="ath-info-label">Kategori</span>
                                <span className="ath-info-value">{getCategoryLabel(catId)}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* İstatistikler */}
                {stats && (
                    <div className="ath-stats-row">
                        <div className="ath-stat-box ath-stat-box--blue">
                            <span className="ath-stat-val">{stats.compCount}</span>
                            <span className="ath-stat-lbl">Yarışma</span>
                        </div>
                        <div className="ath-stat-box ath-stat-box--green">
                            <span className="ath-stat-val">{stats.bestScore}</span>
                            <span className="ath-stat-lbl">En İyi Puan</span>
                        </div>
                        <div className="ath-stat-box ath-stat-box--purple">
                            <span className="ath-stat-val">{stats.avgScore}</span>
                            <span className="ath-stat-lbl">Ortalama</span>
                        </div>
                        <div className="ath-stat-box ath-stat-box--orange">
                            <span className="ath-stat-val">{stats.totalEntries}</span>
                            <span className="ath-stat-lbl">Puan Girişi</span>
                        </div>
                    </div>
                )}

                {/* Mevcut Yarışma Puanları */}
                <div className="ath-card">
                    <div className="ath-card__header">
                        <i className="material-icons-round" style={{ color: 'var(--red)' }}>emoji_events</i>
                        <div>
                            <h3>{currentComp?.isim || 'Yarışma'}</h3>
                            <span className="ath-card__sub">{currentComp?.il} — {currentComp?.baslangicTarihi}</span>
                        </div>
                    </div>

                    {currentScores.length === 0 ? (
                        <div className="ath-card__empty">Henüz puan girişi yapılmamış</div>
                    ) : (
                        <div className="ath-score-table">
                            <div className="ath-score-row ath-score-row--header">
                                <span>Alet</span>
                                <span>D</span>
                                <span>E</span>
                                <span>Tarafsız</span>
                                <span>Toplam</span>
                            </div>
                            {currentScores.map(s => (
                                <div key={s.aletId} className="ath-score-row">
                                    <span className="ath-score-alet">{s.aletLabel}</span>
                                    <span>{s.calc_D != null ? Number(s.calc_D).toFixed(3) : '—'}</span>
                                    <span>{s.calc_E != null ? Number(s.calc_E).toFixed(3) : '—'}</span>
                                    <span>{s.tarafsiz != null || s.neutralDeductions != null ? Number(s.tarafsiz || s.neutralDeductions || 0).toFixed(1) : '—'}</span>
                                    <span className="ath-score-total">{s.sonuc != null ? Number(s.sonuc).toFixed(3) : '—'}</span>
                                </div>
                            ))}
                            {currentScores.length > 1 && (
                                <div className="ath-score-row ath-score-row--total">
                                    <span>Genel Toplam</span>
                                    <span />
                                    <span />
                                    <span />
                                    <span className="ath-score-grand">
                                        {currentScores.reduce((sum, s) => sum + (s.sonuc || 0), 0).toFixed(3)}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Geçmiş Yarışmalar */}
                {history.length > 0 && (
                    <div className="ath-card">
                        <div className="ath-card__header">
                            <i className="material-icons-round" style={{ color: 'var(--purple)' }}>history</i>
                            <div>
                                <h3>Yarışma Geçmişi</h3>
                                <span className="ath-card__sub">{history.length} önceki yarışma</span>
                            </div>
                        </div>

                        <div className="ath-history-list">
                            {history.map((h, idx) => (
                                <div key={idx} className="ath-history-item">
                                    <div className="ath-history-top">
                                        <strong>{h.compIsim}</strong>
                                        <span className="ath-history-meta">
                                            {h.compIl} — {h.compTarih} — {h.categoryLabel}
                                        </span>
                                    </div>
                                    {h.scores.length > 0 ? (
                                        <div className="ath-history-scores">
                                            {h.scores.map(s => (
                                                <div key={s.aletId} className="ath-history-score">
                                                    <span className="ath-history-alet">{s.aletLabel}</span>
                                                    <span className="ath-history-val">
                                                        {s.sonuc != null ? Number(s.sonuc).toFixed(3) : '—'}
                                                    </span>
                                                </div>
                                            ))}
                                            {h.scores.length > 1 && (
                                                <div className="ath-history-score ath-history-score--total">
                                                    <span>Toplam</span>
                                                    <span className="ath-history-val">
                                                        {h.scores.reduce((sum, s) => sum + (s.sonuc || 0), 0).toFixed(3)}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <span className="ath-history-noscores">Puan kaydı yok</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
