import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { useDiscipline } from '../lib/DisciplineContext';
import './CertificatePage.css';

const getCategoryLabel = (catKey) =>
    catKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const ALET_LABELS = {
    atlama: 'Atlama', barfiks: 'Barfiks', halka: 'Halka', kulplu: 'Kulplu Beygir',
    mantar: 'Mantar Beygir', paralel: 'Paralel', yer: 'Yer', denge: 'Denge Aleti',
    asimetrik: 'Asimetrik Paralel',
};
const getAletLabel = (key) => ALET_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);

const CERT_TYPES = [
    { id: 'katilim', label: 'Katılım Belgesi', icon: 'card_membership', color: '#2563EB', desc: 'Tüm sporcular için katılım belgesi' },
    { id: 'derece', label: 'Derece Belgesi', icon: 'military_tech', color: '#D97706', desc: 'İlk 3 sporcu için başarı belgesi' },
    { id: 'hakem', label: 'Hakem Görev Belgesi', icon: 'gavel', color: '#0D9488', desc: 'Görev alan hakemler için' },
];

/* Helper: load an image as a promise */
const loadImage = (src) =>
    new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });

export default function CertificatePage() {
    const navigate = useNavigate();
    const { currentUser, hasPermission } = useAuth();
    const { toast } = useNotification();
    const { firebasePath, routePrefix } = useDiscipline();
    const canvasRef = useRef(null);

    const canGenerate = hasPermission('certificates', 'olustur');

    const [competitions, setCompetitions] = useState({});
    const [selectedCity, setSelectedCity] = useState('');
    const [selectedCompId, setSelectedCompId] = useState('');
    const [selectedCat, setSelectedCat] = useState('');
    const [certType, setCertType] = useState('katilim');
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [previewData, setPreviewData] = useState(null);
    const [ilMuduru, setIlMuduru] = useState('');
    const [fedTemsilcisi, setFedTemsilcisi] = useState('');

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

    const availableCities = [...new Set(Object.values(filteredComps).map(c => (c.il || c.city || '').toLocaleUpperCase('tr-TR')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr-TR'));

    const compList = useMemo(
        () => Object.entries(filteredComps)
            .filter(([, c]) => !selectedCity || (c.il || c.city || '').toLocaleUpperCase('tr-TR') === selectedCity)
            .map(([id, c]) => ({ id, ...c }))
            .sort((a, b) => (b.baslangicTarihi || '').localeCompare(a.baslangicTarihi || '')),
        [filteredComps, selectedCity]
    );

    const selectedComp = selectedCompId ? filteredComps[selectedCompId] : null;

    const compCatKeys = useMemo(() => {
        if (!selectedComp?.kategoriler) return [];
        return Object.keys(selectedComp.kategoriler);
    }, [selectedComp]);

    // Sporcu ve puanları al
    const athletes = useMemo(() => {
        if (!selectedComp?.sporcular || !selectedCat) return [];
        const catData = selectedComp.sporcular[selectedCat];
        if (!catData) return [];
        return Object.entries(catData).map(([id, ath]) => ({
            id,
            ...ath,
            ad: ath.ad || '',
            soyad: ath.soyad || '',
            okul: ath.okul || '',
        }));
    }, [selectedComp, selectedCat]);

    // Derece hesapla (genel toplam puanlarına göre sıralama)
    const rankedAthletes = useMemo(() => {
        if (!selectedComp?.puanlar?.[selectedCat]) return athletes.map(a => ({ ...a, toplamPuan: 0, siralama: '-' }));

        const withScores = athletes.map(ath => {
            let total = 0;
            const catScores = selectedComp.puanlar[selectedCat];
            Object.values(catScores).forEach(aletData => {
                if (aletData?.[ath.id]?.sonuc) {
                    total += aletData[ath.id].sonuc;
                }
            });
            return { ...ath, toplamPuan: total };
        });

        withScores.sort((a, b) => b.toplamPuan - a.toplamPuan);
        withScores.forEach((ath, idx) => { ath.siralama = idx + 1; });
        return withScores;
    }, [athletes, selectedComp, selectedCat]);

    // Hakemler
    const [referees, setReferees] = useState([]);
    useEffect(() => {
        if (certType !== 'hakem' || !selectedCompId) return;
        const hakemlerObj = selectedComp?.hakemler;
        if (hakemlerObj) {
            const list = Object.entries(hakemlerObj).map(([id, h]) => ({
                id,
                adSoyad: h.adSoyad || h.name || 'Bilinmiyor',
                brans: h.brans || '',
                il: h.il || '',
            }));
            setReferees(list);
        } else {
            setReferees([]);
        }
    }, [certType, selectedCompId, selectedComp]);

    // Canvas ile sertifika oluştur
    const generateCertificate = async (person, type, sigIlMuduru, sigFedTemsilcisi) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;

        const ctx = canvas.getContext('2d');
        const W = 1600;
        const H = 1130;
        canvas.width = W;
        canvas.height = H;

        const accentColor = type === 'derece' ? '#D97706' : type === 'hakem' ? '#0D9488' : '#2563EB';
        const accentLight = type === 'derece' ? '#FEF3C7' : type === 'hakem' ? '#CCFBF1' : '#DBEAFE';
        const accentMid = type === 'derece' ? '#F59E0B' : type === 'hakem' ? '#14B8A6' : '#3B82F6';

        // ── Background ──
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, W, H);

        // Subtle gradient overlay at top
        const topGrad = ctx.createLinearGradient(0, 0, 0, 200);
        topGrad.addColorStop(0, accentLight);
        topGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = topGrad;
        ctx.fillRect(0, 0, W, 200);

        // ── Decorative outer border ──
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 6;
        ctx.strokeRect(24, 24, W - 48, H - 48);

        // Inner border (double-line effect)
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(36, 36, W - 72, H - 72);

        // ── Corner accents ──
        const cLen = 70;
        const cThick = 5;
        const cOff = 24;
        const corners = [
            [cOff, cOff, 1, 1],
            [W - cOff, cOff, -1, 1],
            [cOff, H - cOff, 1, -1],
            [W - cOff, H - cOff, -1, -1],
        ];
        ctx.fillStyle = accentColor;
        corners.forEach(([cx, cy, dx, dy]) => {
            ctx.fillRect(cx, cy, cLen * dx, cThick * dy);
            ctx.fillRect(cx, cy, cThick * dx, cLen * dy);
        });

        // Small diamond shapes at each corner
        corners.forEach(([cx, cy, dx, dy]) => {
            const ox = cx + 12 * dx;
            const oy = cy + 12 * dy;
            ctx.beginPath();
            ctx.moveTo(ox, oy - 6 * dy);
            ctx.lineTo(ox + 6 * dx, oy);
            ctx.lineTo(ox, oy + 6 * dy);
            ctx.lineTo(ox - 6 * dx, oy);
            ctx.closePath();
            ctx.fill();
        });

        // ── Load and draw TCF logo ──
        try {
            const logo = await loadImage('/logo.png');
            const logoH = 100;
            const logoW = (logo.width / logo.height) * logoH;
            ctx.drawImage(logo, (W - logoW) / 2, 60, logoW, logoH);
        } catch {
            // If logo fails to load, just skip it
        }

        // ── Top text ──
        ctx.textAlign = 'center';
        ctx.fillStyle = '#374151';
        ctx.font = '700 20px Nunito, sans-serif';
        ctx.fillText('TÜRKİYE CİMNASTİK FEDERASYONU', W / 2, 195);

        ctx.fillStyle = '#6B7280';
        ctx.font = '600 17px Nunito, sans-serif';
        ctx.letterSpacing = '2px';
        ctx.fillText('OKUL SPORLARI', W / 2, 222);

        // ── Decorative divider under subtitle ──
        const divY = 240;
        ctx.beginPath();
        ctx.moveTo(W / 2 - 200, divY);
        ctx.lineTo(W / 2 + 200, divY);
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Small diamond in center of divider
        ctx.fillStyle = accentColor;
        ctx.beginPath();
        ctx.moveTo(W / 2, divY - 5);
        ctx.lineTo(W / 2 + 5, divY);
        ctx.lineTo(W / 2, divY + 5);
        ctx.lineTo(W / 2 - 5, divY);
        ctx.closePath();
        ctx.fill();

        // ── Certificate type title ──
        const titleText = type === 'derece' ? 'BAŞARI BELGESİ' : type === 'hakem' ? 'GÖREV BELGESİ' : 'KATILIM BELGESİ';
        ctx.fillStyle = accentColor;
        ctx.font = '900 44px Nunito, sans-serif';
        ctx.fillText(titleText, W / 2, 300);

        // Accent line under title
        const titleMetrics = ctx.measureText(titleText);
        const ulY = 314;
        ctx.beginPath();
        ctx.moveTo(W / 2 - titleMetrics.width / 2 - 10, ulY);
        ctx.lineTo(W / 2 + titleMetrics.width / 2 + 10, ulY);
        ctx.strokeStyle = accentMid;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // ── Person name ──
        const personName = (person.adSoyad || `${person.ad || ''} ${person.soyad || ''}`.trim()).toUpperCase();
        ctx.fillStyle = '#111827';
        ctx.font = '900 54px Nunito, sans-serif';
        ctx.fillText(personName, W / 2, 400);

        // Decorative line under name
        ctx.beginPath();
        ctx.moveTo(W / 2 - 160, 418);
        ctx.lineTo(W / 2 + 160, 418);
        ctx.strokeStyle = '#D1D5DB';
        ctx.lineWidth = 1;
        ctx.stroke();

        // ── Body content based on type ──
        if (type === 'katilim' || type === 'derece') {
            ctx.fillStyle = '#374151';
            ctx.font = '600 26px Nunito, sans-serif';
            ctx.fillText(`${selectedComp?.isim || 'Yarışma'}`, W / 2, 475);

            ctx.fillStyle = '#4B5563';
            ctx.font = '600 22px Nunito, sans-serif';
            ctx.fillText(`${getCategoryLabel(selectedCat)} Kategorisi`, W / 2, 512);

            if (person.okul) {
                ctx.fillStyle = '#6B7280';
                ctx.font = '500 20px Nunito, sans-serif';
                ctx.fillText(person.okul, W / 2, 548);
            }

            if (type === 'derece' && person.siralama) {
                const dereceLbl = person.siralama === 1 ? 'BİRİNCİ' : person.siralama === 2 ? 'İKİNCİ' : person.siralama === 3 ? 'ÜÇÜNCÜ' : `${person.siralama}. SIRADA`;

                // Ranking badge background
                const badgeY = 610;
                const badgeW = 260;
                const badgeH = 50;
                const badgeR = 10;
                ctx.fillStyle = accentLight;
                ctx.beginPath();
                ctx.roundRect(W / 2 - badgeW / 2, badgeY - badgeH / 2, badgeW, badgeH, badgeR);
                ctx.fill();
                ctx.strokeStyle = accentColor;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.roundRect(W / 2 - badgeW / 2, badgeY - badgeH / 2, badgeW, badgeH, badgeR);
                ctx.stroke();

                ctx.fillStyle = accentColor;
                ctx.font = '900 30px Nunito, sans-serif';
                ctx.fillText(dereceLbl, W / 2, badgeY + 10);

                if (person.toplamPuan > 0) {
                    ctx.fillStyle = '#6B7280';
                    ctx.font = '700 20px Nunito, sans-serif';
                    ctx.fillText(`Toplam Puan: ${person.toplamPuan.toFixed(3)}`, W / 2, badgeY + 55);
                }
            } else {
                // Katılım mesajı
                ctx.fillStyle = '#6B7280';
                ctx.font = '500 22px Nunito, sans-serif';
                ctx.fillText('müsabakasına katılmıştır.', W / 2, 590);
            }
        } else if (type === 'hakem') {
            ctx.fillStyle = '#374151';
            ctx.font = '600 26px Nunito, sans-serif';
            ctx.fillText(`${selectedComp?.isim || 'Yarışma'}`, W / 2, 475);

            ctx.fillStyle = '#4B5563';
            ctx.font = '600 22px Nunito, sans-serif';
            ctx.fillText('müsabakasında hakem olarak görev yapmıştır.', W / 2, 515);

            if (person.brans) {
                ctx.fillStyle = '#6B7280';
                ctx.font = '500 20px Nunito, sans-serif';
                ctx.fillText(`Branş: ${person.brans}`, W / 2, 560);
            }
        }

        // ── Date and city ──
        const dateStr = selectedComp?.baslangicTarihi || new Date().toLocaleDateString('tr-TR');
        const cityStr = selectedComp?.il || '';
        ctx.fillStyle = '#9CA3AF';
        ctx.font = '500 17px Nunito, sans-serif';
        ctx.fillText(`${cityStr} — ${dateStr}`, W / 2, H - 190);

        // ── Signature areas ──
        const sigY = H - 120;
        const sigLineHalf = 130;
        const leftX = 350;
        const rightX = W - 350;

        // Left signature: İl Gençlik Spor Müdürü
        ctx.strokeStyle = '#C7C7CC';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(leftX - sigLineHalf, sigY);
        ctx.lineTo(leftX + sigLineHalf, sigY);
        ctx.stroke();

        if (sigIlMuduru) {
            ctx.fillStyle = '#374151';
            ctx.font = '700 16px Nunito, sans-serif';
            ctx.fillText(sigIlMuduru, leftX, sigY - 10);
        }
        ctx.fillStyle = '#9CA3AF';
        ctx.font = '600 13px Nunito, sans-serif';
        ctx.fillText('İl Gençlik Spor Müdürü', leftX, sigY + 20);

        // Right signature: Federasyon Temsilcisi
        ctx.strokeStyle = '#C7C7CC';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(rightX - sigLineHalf, sigY);
        ctx.lineTo(rightX + sigLineHalf, sigY);
        ctx.stroke();

        if (sigFedTemsilcisi) {
            ctx.fillStyle = '#374151';
            ctx.font = '700 16px Nunito, sans-serif';
            ctx.fillText(sigFedTemsilcisi, rightX, sigY - 10);
        }
        ctx.fillStyle = '#9CA3AF';
        ctx.font = '600 13px Nunito, sans-serif';
        ctx.fillText('Federasyon Temsilcisi', rightX, sigY + 20);

        // ── Bottom decorative line ──
        ctx.beginPath();
        ctx.moveTo(W / 2 - 250, H - 55);
        ctx.lineTo(W / 2 + 250, H - 55);
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1;
        ctx.stroke();
        // diamond
        ctx.fillStyle = accentColor;
        ctx.beginPath();
        ctx.moveTo(W / 2, H - 60);
        ctx.lineTo(W / 2 + 4, H - 55);
        ctx.lineTo(W / 2, H - 50);
        ctx.lineTo(W / 2 - 4, H - 55);
        ctx.closePath();
        ctx.fill();

        return canvas.toDataURL('image/png');
    };

    const handlePreview = async () => {
        const person = certType === 'hakem'
            ? (referees[0] || { adSoyad: 'Örnek Hakem' })
            : (rankedAthletes[0] || { ad: 'Örnek', soyad: 'Sporcu', okul: 'Örnek Okul' });

        const img = await generateCertificate(person, certType, ilMuduru, fedTemsilcisi);
        setPreviewData(img);
    };

    const handleGenerateAll = async () => {
        if (!selectedCompId) {
            toast('Yarışma seçin', 'error');
            return;
        }

        setGenerating(true);

        try {
            const { jsPDF } = await import('jspdf');
            const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            const pageW = 297;
            const pageH = 210;

            let persons;
            if (certType === 'hakem') {
                persons = referees;
            } else if (certType === 'derece') {
                persons = rankedAthletes.filter(a => a.siralama <= 3);
            } else {
                persons = rankedAthletes;
            }

            if (persons.length === 0) {
                toast('Oluşturulacak kişi bulunamadı', 'error');
                setGenerating(false);
                return;
            }

            for (let i = 0; i < persons.length; i++) {
                if (i > 0) pdf.addPage();
                const imgData = await generateCertificate(persons[i], certType, ilMuduru, fedTemsilcisi);
                pdf.addImage(imgData, 'PNG', 0, 0, pageW, pageH);
            }

            const compName = (selectedComp?.isim || 'yarisma').replace(/[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ ]/g, '').replace(/\s+/g, '_');
            const typeName = certType === 'derece' ? 'basari' : certType === 'hakem' ? 'hakem_gorev' : 'katilim';
            pdf.save(`${compName}_${typeName}_belgeleri.pdf`);

            toast(`${persons.length} adet ${CERT_TYPES.find(t => t.id === certType)?.label || 'belge'} oluşturuldu`, 'success');
        } catch (err) {
            toast('Hata: ' + err.message, 'error');
        } finally {
            setGenerating(false);
        }
    };

    if (loading) {
        return (
            <div className="cert-page">
                <div className="cert-loading">
                    <div className="cert-loading__spinner" />
                    <span>Yükleniyor...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="cert-page">
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {/* Header */}
            <header className="cert-header">
                <div className="cert-header__left">
                    <button className="cert-back" onClick={() => navigate(routePrefix)}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div>
                        <h1 className="cert-header__title">Sertifika Oluşturucu</h1>
                        <p className="cert-header__sub">Katılım, derece ve görev belgeleri</p>
                    </div>
                </div>
            </header>

            <main className="cert-main">
                {/* Sertifika Tipi Seçimi */}
                <div className="cert-types">
                    {CERT_TYPES.map(type => (
                        <button
                            key={type.id}
                            className={`cert-type-card ${certType === type.id ? 'cert-type-card--active' : ''}`}
                            onClick={() => { setCertType(type.id); setPreviewData(null); }}
                            style={{ '--ct-color': type.color }}
                        >
                            <div className="cert-type-icon">
                                <i className="material-icons-round">{type.icon}</i>
                            </div>
                            <strong>{type.label}</strong>
                            <span>{type.desc}</span>
                        </button>
                    ))}
                </div>

                {/* Seçimler */}
                <div className="cert-controls">
                    <div className="cert-field">
                        <label>İl</label>
                        <select
                            value={selectedCity}
                            onChange={e => { setSelectedCity(e.target.value); setSelectedCompId(''); setSelectedCat(''); setPreviewData(null); }}
                        >
                            <option value="">— Tüm İller —</option>
                            {availableCities.map(city => (
                                <option key={city} value={city}>{city}</option>
                            ))}
                        </select>
                    </div>
                    <div className="cert-field">
                        <label>Yarışma</label>
                        <select
                            value={selectedCompId}
                            onChange={e => { setSelectedCompId(e.target.value); setSelectedCat(''); setPreviewData(null); }}
                        >
                            <option value="">— Yarışma seçin —</option>
                            {compList.map(c => (
                                <option key={c.id} value={c.id}>{c.isim} ({c.il})</option>
                            ))}
                        </select>
                    </div>

                    {certType !== 'hakem' && (
                        <div className="cert-field">
                            <label>Kategori</label>
                            <select
                                value={selectedCat}
                                onChange={e => { setSelectedCat(e.target.value); setPreviewData(null); }}
                                disabled={!selectedCompId}
                            >
                                <option value="">— Kategori seçin —</option>
                                {compCatKeys.map(ck => (
                                    <option key={ck} value={ck}>{getCategoryLabel(ck)}</option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>

                {/* İmza Alanları */}
                <div className="cert-controls">
                    <div className="cert-field">
                        <label>İl Gençlik Spor Müdürü</label>
                        <input
                            type="text"
                            className="cert-input"
                            placeholder="Ad Soyad girin..."
                            value={ilMuduru}
                            onChange={e => setIlMuduru(e.target.value)}
                        />
                    </div>
                    <div className="cert-field">
                        <label>Federasyon Temsilcisi</label>
                        <input
                            type="text"
                            className="cert-input"
                            placeholder="Ad Soyad girin..."
                            value={fedTemsilcisi}
                            onChange={e => setFedTemsilcisi(e.target.value)}
                        />
                    </div>
                </div>

                {/* Kişi Sayısı Bilgisi */}
                {selectedCompId && (
                    <div className="cert-info-bar">
                        <i className="material-icons-round">
                            {certType === 'hakem' ? 'gavel' : 'groups'}
                        </i>
                        <span>
                            {certType === 'hakem'
                                ? `${referees.length} hakem bulundu`
                                : certType === 'derece'
                                    ? `${rankedAthletes.filter(a => a.siralama <= 3).length} sporcu (ilk 3)`
                                    : `${rankedAthletes.length} sporcu`
                            }
                        </span>
                    </div>
                )}

                {/* Butonlar */}
                <div className="cert-actions">
                    <button
                        className="cert-btn cert-btn--preview"
                        onClick={handlePreview}
                        disabled={!selectedCompId || (certType !== 'hakem' && !selectedCat)}
                    >
                        <i className="material-icons-round">visibility</i>
                        Önizle
                    </button>
                    {canGenerate && (
                        <button
                            className="cert-btn cert-btn--generate"
                            onClick={handleGenerateAll}
                            disabled={generating || !selectedCompId || (certType !== 'hakem' && !selectedCat)}
                        >
                            {generating ? (
                                <>
                                    <div className="cert-btn-spinner" />
                                    Oluşturuluyor...
                                </>
                            ) : (
                                <>
                                    <i className="material-icons-round">picture_as_pdf</i>
                                    PDF Oluştur & İndir
                                </>
                            )}
                        </button>
                    )}
                </div>

                {/* Önizleme */}
                {previewData && (
                    <div className="cert-preview">
                        <h3>Önizleme</h3>
                        <img src={previewData} alt="Sertifika önizleme" className="cert-preview__img" />
                    </div>
                )}

                {/* Sporcu/Hakem Listesi */}
                {selectedCompId && (certType === 'hakem' ? referees.length > 0 : (selectedCat && rankedAthletes.length > 0)) && (
                    <div className="cert-person-list">
                        <h3>
                            {certType === 'hakem' ? 'Hakemler' : 'Sporcular'}
                            {certType === 'derece' && ' (Derece Sırasına Göre)'}
                        </h3>
                        <div className="cert-person-grid">
                            {(certType === 'hakem' ? referees : (certType === 'derece' ? rankedAthletes.filter(a => a.siralama <= 3) : rankedAthletes)).map((person, idx) => (
                                <div key={person.id || idx} className="cert-person-row">
                                    <span className="cert-person-rank">
                                        {certType === 'hakem' ? (idx + 1) : (person.siralama || idx + 1)}
                                    </span>
                                    <span className="cert-person-name">
                                        {person.adSoyad || `${person.ad} ${person.soyad}`}
                                    </span>
                                    <span className="cert-person-detail">
                                        {certType === 'hakem'
                                            ? person.brans || person.il || ''
                                            : person.okul || ''
                                        }
                                    </span>
                                    {certType === 'derece' && person.toplamPuan > 0 && (
                                        <span className="cert-person-score">{person.toplamPuan.toFixed(3)}</span>
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
