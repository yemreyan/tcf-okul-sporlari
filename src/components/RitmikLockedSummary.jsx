/**
 * RitmikLockedSummary — Hakem panelleri için "Puan Kilitlendi" özet kartı
 *
 * Başhakem skoru onayladığında (kilitli=true), tüm hakem ekranlarında bu
 * komponent görünür. Sporcu adı + tüm panel sonuçları (DA Kesin, DB Kesin,
 * A Ortalama, E Ortalama) + toplam puan kalıcı olarak gösterilir.
 *
 * Props:
 *   athleteName — string (örn "Mina Kalem")
 *   aletLabel   — string (örn "Top" / "Kurdele")
 *   scores      — Firebase puanlar objesi (kilit sonrası)
 *                 { daScore, dbScore, aPanel:{j1..j4}, ePanel:{j1..j4},
 *                   penaltyTotal, sonuc, aScore, eScore, ... }
 */
export default function RitmikLockedSummary({ athleteName, aletLabel, scores }) {
    if (!scores) {
        return (
            <div className="rls-card rls-card--minimal">
                <span className="material-icons-round rls-icon">lock</span>
                <h2>Puan Kilitlendi</h2>
                <p>Başhakem puanı onayladı. Artık değişiklik yapılamaz.</p>
            </div>
        );
    }

    // A panel ortalaması (trimmed: en yüksek + en düşük atılır)
    const calcTrimmedAvg = (panel) => {
        if (!panel) return 0;
        const vals = Object.values(panel)
            .map(v => parseFloat(v))
            .filter(v => !isNaN(v));
        if (vals.length === 0) return 0;
        if (vals.length < 4) return vals.reduce((s, v) => s + v, 0) / vals.length;
        const sorted = [...vals].sort((a, b) => a - b);
        const trimmed = sorted.slice(1, -1);
        return trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
    };

    const daKesin    = parseFloat(scores.daScore ?? scores.da ?? 0) || 0;
    const dbKesin    = parseFloat(scores.dbScore ?? scores.db ?? 0) || 0;
    const aTrimmed   = calcTrimmedAvg(scores.aPanel);
    const eTrimmed   = calcTrimmedAvg(scores.ePanel);
    const penalty    = parseFloat(scores.penaltyTotal ?? 0) || 0;
    const total      = parseFloat(scores.sonuc ?? 0) || 0;

    return (
        <div className="rls-card">
            <div className="rls-header">
                <span className="material-icons-round rls-icon">verified</span>
                <div className="rls-titles">
                    <div className="rls-athlete">{athleteName || '—'}</div>
                    {aletLabel && <div className="rls-meta">{aletLabel.toUpperCase()}</div>}
                </div>
                <div className="rls-total">
                    <label>TOPLAM</label>
                    <span>{total.toFixed(3)}</span>
                </div>
            </div>

            <div className="rls-grid">
                <div className="rls-cell rls-cell--da">
                    <label>DA KESİN</label>
                    <span>{daKesin.toFixed(3)}</span>
                </div>
                <div className="rls-cell rls-cell--db">
                    <label>DB KESİN</label>
                    <span>{dbKesin.toFixed(3)}</span>
                </div>
                <div className="rls-cell rls-cell--a">
                    <label>A KESİNTİ ORT.</label>
                    <span>{aTrimmed.toFixed(3)}</span>
                </div>
                <div className="rls-cell rls-cell--e">
                    <label>E KESİNTİ ORT.</label>
                    <span>{eTrimmed.toFixed(3)}</span>
                </div>
                {penalty > 0 && (
                    <div className="rls-cell rls-cell--pen">
                        <label>CEZA</label>
                        <span>−{penalty.toFixed(3)}</span>
                    </div>
                )}
            </div>

            <div className="rls-footer">
                <span className="material-icons-round" style={{ fontSize: 14, verticalAlign: 'middle' }}>info</span>
                <span style={{ marginLeft: 4 }}>Puan kilitlendi · Sonraki sporcu çağrılana kadar gösterilir</span>
            </div>
        </div>
    );
}
