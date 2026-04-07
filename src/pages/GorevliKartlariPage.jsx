import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, get, onValue, query, orderByChild, equalTo } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import './GorevliKartlariPage.css';

const SETTING_PATH = 'system_settings/gorevli_kartlari_aktif';

const COMP_PATHS = [
    { path: 'competitions',         brans: 'Artistik Cimnastik'  },
    { path: 'aerobik_yarismalar',   brans: 'Aerobik Cimnastik'   },
    { path: 'trampolin_yarismalar', brans: 'Trampolin Cimnastik' },
    { path: 'parkur_yarismalar',    brans: 'Parkur Cimnastik'    },
    { path: 'ritmik_yarismalar',    brans: 'Ritmik Cimnastik'    },
];

const BRANS_COLOR = {
    'Artistik Cimnastik':  '#4F46E5',
    'Aerobik Cimnastik':   '#10B981',
    'Trampolin Cimnastik': '#F97316',
    'Parkur Cimnastik':    '#EF4444',
    'Ritmik Cimnastik':    '#EC4899',
};

const ROLE_COLOR = {
    'ANTRENÖR':   '#1D4ED8',
    'ÖĞRETMENİ':  '#047857',
};

export default function GorevliKartlariPage() {
    const navigate = useNavigate();
    const { isAuthenticated, loading: authLoading, isSuperAdmin } = useAuth();
    const superAdmin = isAuthenticated && isSuperAdmin();

    const [featureEnabled, setFeatureEnabled] = useState(null); // null = yükleniyor
    const [competitions, setCompetitions] = useState([]);
    const [filterBrans, setFilterBrans] = useState('');
    const [filterIl, setFilterIl] = useState('');
    const [selectedCompId, setSelectedCompId] = useState('');
    const [selectedComp, setSelectedComp] = useState(null);
    const [gorevliler, setGorevliler] = useState([]);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [loadingComps, setLoadingComps] = useState(true);
    const [loadingGorevli, setLoadingGorevli] = useState(false);
    const [showPreview, setShowPreview] = useState(false);

    // ─── Auth Guard + Feature Flag ───
    useEffect(() => {
        if (!authLoading && !isAuthenticated) navigate('/');
    }, [authLoading, isAuthenticated, navigate]);

    useEffect(() => {
        const unsub = onValue(ref(db, SETTING_PATH), (snap) => {
            setFeatureEnabled(snap.val() === true);
        });
        return () => unsub();
    }, []);

    // ─── Load all competitions from all branches ───
    useEffect(() => {
        const fetchAll = async () => {
            setLoadingComps(true);
            const all = [];
            await Promise.all(
                COMP_PATHS.map(async ({ path, brans }) => {
                    try {
                        const snap = await get(ref(db, path));
                        if (snap.exists()) {
                            Object.entries(snap.val()).forEach(([id, data]) => {
                                if (data && data.isim) {
                                    all.push({
                                        id,
                                        isim: data.isim,
                                        tarih: data.tarih || data.baslangicTarihi || '',
                                        il: data.il || data.city || '',
                                        brans: data.brans || brans,
                                        firebasePath: path,
                                    });
                                }
                            });
                        }
                    } catch {/* skip failed path */}
                })
            );
            // Sort by date desc
            all.sort((a, b) => (b.tarih > a.tarih ? 1 : -1));
            setCompetitions(all);
            setLoadingComps(false);
        };
        fetchAll();
    }, []);

    // ─── Load görevliler for selected competition ───
    const loadGorevliler = useCallback(async (compId) => {
        if (!compId) { setGorevliler([]); setSelectedIds(new Set()); return; }
        setLoadingGorevli(true);
        try {
            const snap = await get(
                query(ref(db, 'applications'), orderByChild('competitionId'), equalTo(compId))
            );
            const list = [];
            const seen = new Set();

            if (snap.exists()) {
                snap.forEach(child => {
                    const app = child.val();
                    if (!app) return;
                    const okul = app.okul || '';
                    const il   = app.il   || '';
                    const ilce = app.ilce || '';
                    const brans = app.brans || '';

                    const addPerson = (name, phone, role) => {
                        if (!name) return;
                        const key = `${role}__${name}__${okul}__${ilce}`;
                        if (seen.has(key)) return;
                        seen.add(key);
                        list.push({
                            id: key,
                            ad: name.toLocaleUpperCase('tr-TR'),
                            telefon: phone || '',
                            rol: role,
                            okul,
                            il,
                            ilce,
                            brans,
                        });
                    };

                    // antrenorler
                    const antrenorler = Array.isArray(app.antrenorler)
                        ? app.antrenorler
                        : app.antrenorler
                            ? Object.values(app.antrenorler)
                            : [];
                    antrenorler.forEach(a => addPerson(a.name || a.ad, a.phone || a.telefon, 'ANTRENÖR'));

                    // ogretmenler
                    const ogretmenler = Array.isArray(app.ogretmenler)
                        ? app.ogretmenler
                        : app.ogretmenler
                            ? Object.values(app.ogretmenler)
                            : [];
                    ogretmenler.forEach(o => addPerson(o.name || o.ad, o.phone || o.telefon, 'ÖĞRETMENİ'));
                });
            }

            // Sort: antrenörler önce, sonra öğretmen; alfabe
            list.sort((a, b) => {
                if (a.rol !== b.rol) return a.rol === 'ANTRENÖR' ? -1 : 1;
                return a.ad.localeCompare(b.ad, 'tr-TR');
            });

            setGorevliler(list);
            setSelectedIds(new Set(list.map(g => g.id)));
        } catch (e) {
            if (import.meta.env.DEV) console.error('Görevli yükleme hatası:', e);
            setGorevliler([]);
        }
        setLoadingGorevli(false);
    }, []);

    // Benzersiz il ve branş listesi
    const ilOptions = [...new Set(competitions.map(c => c.il).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr-TR'));
    const bransOptions = [...new Set(competitions.map(c => c.brans).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr-TR'));

    // Filtreli yarışma listesi
    const filteredComps = competitions.filter(c => {
        if (filterBrans && c.brans !== filterBrans) return false;
        if (filterIl && c.il !== filterIl) return false;
        return true;
    });

    const handleFilterBransChange = (e) => {
        setFilterBrans(e.target.value);
        setSelectedCompId('');
        setSelectedComp(null);
        setGorevliler([]);
        setSelectedIds(new Set());
    };

    const handleFilterIlChange = (e) => {
        setFilterIl(e.target.value);
        setSelectedCompId('');
        setSelectedComp(null);
        setGorevliler([]);
        setSelectedIds(new Set());
    };

    const handleCompChange = (e) => {
        const id = e.target.value;
        setSelectedCompId(id);
        const comp = filteredComps.find(c => c.id === id) || null;
        setSelectedComp(comp);
        loadGorevliler(id);
    };

    const toggleSelect = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleAll = () => {
        if (selectedIds.size === gorevliler.length) setSelectedIds(new Set());
        else setSelectedIds(new Set(gorevliler.map(g => g.id)));
    };

    const handlePrint = () => {
        // Tarayıcı kaydet diyaloğunda dosya adı sayfa başlığından gelir
        const originalTitle = document.title;
        document.title = `TCF Okul Sporları — Görevli Yaka Kartları${compName ? ` — ${compName}` : ''}`;
        window.print();
        // Kısa gecikme sonra eski başlığa geri dön
        setTimeout(() => { document.title = originalTitle; }, 2000);
    };

    const selected = gorevliler.filter(g => selectedIds.has(g.id));
    const compName = selectedComp?.isim || '';
    const compIl   = selectedComp?.il   || '';
    const compBrans = selectedComp?.brans || '';

    if (authLoading || featureEnabled === null) return null;

    // Özellik kapalıysa ve süper admin değilse erişim yok
    if (!featureEnabled && !superAdmin) {
        return (
            <div className="gk-root">
                <div className="gk-screen">
                    <header className="gk-header">
                        <button className="gk-back" onClick={() => navigate('/')}>
                            <i className="material-icons-round">arrow_back</i>
                        </button>
                        <div className="gk-header-title">
                            <i className="material-icons-round">badge</i>
                            <div>
                                <h1>Görevli Yaka Kartları</h1>
                                <p>Antrenör ve öğretmen kartı çıktısı</p>
                            </div>
                        </div>
                    </header>
                    <div className="gk-access-denied">
                        <i className="material-icons-round">lock</i>
                        <h2>Bu özellik şu an devre dışı</h2>
                        <p>Süper admin tarafından aktif edilmesi gerekmektedir.</p>
                        <button className="gk-back-btn" onClick={() => navigate('/')}>
                            <i className="material-icons-round">arrow_back</i>
                            Ana Sayfaya Dön
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="gk-root">
            {/* ─── Ekran: Kontrol Paneli ─── */}
            <div className="gk-screen no-print">
                <header className="gk-header">
                    <button className="gk-back" onClick={() => navigate('/')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div className="gk-header-title">
                        <i className="material-icons-round">badge</i>
                        <div>
                            <h1>Görevli Yaka Kartları</h1>
                            <p>Antrenör ve öğretmen kartı çıktısı</p>
                        </div>
                    </div>
                </header>

                <div className="gk-content">
                    {/* Filtreler + Yarışma seçimi */}
                    <div className="gk-select-card">
                        {loadingComps ? (
                            <div className="gk-loading-inline">
                                <div className="gk-spinner-sm"></div> Yarışmalar yükleniyor...
                            </div>
                        ) : (
                            <>
                                <div className="gk-filter-row">
                                    <div className="gk-filter-group">
                                        <label className="gk-label">
                                            <i className="material-icons-round">sports_gymnastics</i>
                                            Branş
                                        </label>
                                        <select className="gk-select" value={filterBrans} onChange={handleFilterBransChange}>
                                            <option value="">Tüm Branşlar</option>
                                            {bransOptions.map(b => (
                                                <option key={b} value={b}>{b}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="gk-filter-group">
                                        <label className="gk-label">
                                            <i className="material-icons-round">location_on</i>
                                            İl
                                        </label>
                                        <select className="gk-select" value={filterIl} onChange={handleFilterIlChange}>
                                            <option value="">Tüm İller</option>
                                            {ilOptions.map(il => (
                                                <option key={il} value={il}>{il}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="gk-filter-divider" />

                                <label className="gk-label">
                                    <i className="material-icons-round">emoji_events</i>
                                    Yarışma Seçin
                                    {filteredComps.length !== competitions.length && (
                                        <span className="gk-filter-badge">{filteredComps.length} yarışma</span>
                                    )}
                                </label>
                                <select className="gk-select" value={selectedCompId} onChange={handleCompChange} disabled={filteredComps.length === 0}>
                                    <option value="">— Yarışma seçiniz —</option>
                                    {filteredComps.map(c => (
                                        <option key={`${c.firebasePath}__${c.id}`} value={c.id}>
                                            {c.isim}{c.il ? ` — ${c.il}` : ''}{c.tarih ? ` (${c.tarih})` : ''}
                                        </option>
                                    ))}
                                </select>
                                {filteredComps.length === 0 && (filterBrans || filterIl) && (
                                    <p className="gk-filter-empty">Seçili filtrelerde yarışma bulunamadı.</p>
                                )}
                            </>
                        )}
                    </div>

                    {/* Kişi listesi */}
                    {loadingGorevli && (
                        <div className="gk-loading">
                            <div className="gk-spinner"></div>
                            <span>Görevliler yükleniyor...</span>
                        </div>
                    )}

                    {!loadingGorevli && selectedCompId && gorevliler.length === 0 && (
                        <div className="gk-empty">
                            <i className="material-icons-round">person_search</i>
                            <p>Bu yarışmada kayıtlı antrenör veya öğretmen bulunamadı.</p>
                        </div>
                    )}

                    {!loadingGorevli && gorevliler.length > 0 && (
                        <>
                            <div className="gk-toolbar">
                                <div className="gk-toolbar-left">
                                    <button className="gk-btn-toggle-all" onClick={toggleAll}>
                                        <i className="material-icons-round">
                                            {selectedIds.size === gorevliler.length ? 'deselect' : 'select_all'}
                                        </i>
                                        {selectedIds.size === gorevliler.length ? 'Tümünü Kaldır' : 'Tümünü Seç'}
                                    </button>
                                    <span className="gk-count">
                                        {selectedIds.size}/{gorevliler.length} kişi seçili
                                    </span>
                                </div>
                                <div className="gk-toolbar-right">
                                    <button
                                        className="gk-btn-preview"
                                        onClick={() => setShowPreview(true)}
                                        disabled={selectedIds.size === 0}
                                    >
                                        <i className="material-icons-round">visibility</i>
                                        Ön İzleme
                                    </button>
                                    <button
                                        className="gk-btn-print"
                                        onClick={handlePrint}
                                        disabled={selectedIds.size === 0}
                                    >
                                        <i className="material-icons-round">print</i>
                                        Yazdır ({selectedIds.size})
                                    </button>
                                </div>
                            </div>

                            <div className="gk-person-list">
                                {gorevliler.map(g => (
                                    <div
                                        key={g.id}
                                        className={`gk-person-row ${selectedIds.has(g.id) ? 'selected' : ''}`}
                                        onClick={() => toggleSelect(g.id)}
                                    >
                                        <div className="gk-person-check">
                                            <div className="gk-checkbox">
                                                {selectedIds.has(g.id) && (
                                                    <i className="material-icons-round">check</i>
                                                )}
                                            </div>
                                        </div>
                                        <div
                                            className="gk-person-role-badge"
                                            style={{ background: ROLE_COLOR[g.rol] || '#374151' }}
                                        >
                                            {g.rol}
                                        </div>
                                        <div className="gk-person-info">
                                            <strong>{g.ad}</strong>
                                            <span>{g.okul}{g.ilce ? ` — ${g.ilce}` : ''}</span>
                                        </div>
                                        {g.telefon && (
                                            <div className="gk-person-phone">
                                                <i className="material-icons-round">phone</i>
                                                {g.telefon}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* ─── Ön İzleme Modal ─── */}
            {showPreview && (
                <div className="gk-preview-overlay no-print" onClick={() => setShowPreview(false)}>
                    <div className="gk-preview-modal" onClick={e => e.stopPropagation()}>
                        <div className="gk-preview-header">
                            <div className="gk-preview-title">
                                <i className="material-icons-round">visibility</i>
                                <span>Ön İzleme — {selected.length} kart ({chunkArray(selected, 4).length} sayfa A4)</span>
                            </div>
                            <div className="gk-preview-actions">
                                <button className="gk-btn-print" onClick={handlePrint}>
                                    <i className="material-icons-round">print</i>
                                    Yazdır / PDF
                                </button>
                                <button className="gk-preview-close" onClick={() => setShowPreview(false)}>
                                    <i className="material-icons-round">close</i>
                                </button>
                            </div>
                        </div>
                        <div className="gk-preview-body">
                            {chunkArray(selected, 4).map((pageCards, pageIdx) => (
                                <div key={pageIdx} className="gk-preview-page">
                                    <div className="gk-preview-page-label">Sayfa {pageIdx + 1}</div>
                                    <div className="gk-preview-grid">
                                        {pageCards.map(g => (
                                            <YakaKartiPreview
                                                key={g.id}
                                                kisi={g}
                                                compName={compName}
                                                compIl={compIl}
                                                compBrans={compBrans}
                                            />
                                        ))}
                                        {Array.from({ length: 4 - pageCards.length }).map((_, i) => (
                                            <div key={`ep-${i}`} className="gk-preview-kart gk-preview-kart-empty" />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Baskı Görünümü ─── */}
            <div className="gk-print-area print-only">
                {chunkArray(selected, 4).map((pageCards, pageIdx) => (
                    <div key={pageIdx} className="gk-print-page">
                        {pageCards.map((g) => (
                            <YakaKarti
                                key={g.id}
                                kisi={g}
                                compName={compName}
                                compIl={compIl}
                                compBrans={compBrans}
                            />
                        ))}
                        {/* Boş kart doldurma (4'e tamamla) */}
                        {Array.from({ length: 4 - pageCards.length }).map((_, i) => (
                            <div key={`empty-${i}`} className="gk-kart gk-kart-empty" />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Yaka Kartı Bileşeni ───
function YakaKarti({ kisi, compName, compIl, compBrans }) {
    const roleColor = ROLE_COLOR[kisi.rol] || '#374151';
    const bransColor = BRANS_COLOR[kisi.brans || compBrans] || '#4F46E5';

    return (
        <div className="gk-kart">
            {/* Üst bant — branş rengi */}
            <div className="gk-kart-header" style={{ background: bransColor }}>
                <div className="gk-kart-logo-row">
                    <div className="gk-kart-logo-box">
                        <span>TCF</span>
                    </div>
                    <div className="gk-kart-org">
                        <strong>Türkiye Cimnastik Federasyonu</strong>
                        <span>Okul Sporları</span>
                    </div>
                </div>
                <div className="gk-kart-comp-name">{compName}</div>
                {compIl && <div className="gk-kart-comp-il">{compIl}</div>}
            </div>

            {/* Ortadaki kişi bilgisi */}
            <div className="gk-kart-body">
                <div className="gk-kart-avatar" style={{ borderColor: roleColor }}>
                    <i className="material-icons-round">person</i>
                </div>
                <div className="gk-kart-ad">{kisi.ad}</div>
                <div className="gk-kart-okul">{kisi.okul}</div>
                {kisi.ilce && <div className="gk-kart-ilce">{kisi.ilce}{kisi.il ? ` / ${kisi.il}` : ''}</div>}
            </div>

            {/* Alt bant — rol */}
            <div className="gk-kart-footer" style={{ background: roleColor }}>
                <span className="gk-kart-rol">{kisi.rol}</span>
                <span className="gk-kart-brans">{kisi.brans || compBrans}</span>
            </div>
        </div>
    );
}

// ─── Ön İzleme Kartı (ekran görünümü, scale ile küçültülmüş) ───
function YakaKartiPreview({ kisi, compName, compIl, compBrans }) {
    const roleColor = ROLE_COLOR[kisi.rol] || '#374151';
    const bransColor = BRANS_COLOR[kisi.brans || compBrans] || '#4F46E5';

    return (
        <div className="gk-preview-kart">
            <div className="gk-preview-kart-header" style={{ background: bransColor }}>
                <div className="gk-preview-logo-row">
                    <div className="gk-preview-logo-box"><span>TCF</span></div>
                    <div className="gk-preview-org">
                        <strong>Türkiye Cimnastik Federasyonu</strong>
                        <span>Okul Sporları</span>
                    </div>
                </div>
                <div className="gk-preview-comp-name">{compName}</div>
                {compIl && <div className="gk-preview-comp-il">{compIl}</div>}
            </div>
            <div className="gk-preview-kart-body">
                <div className="gk-preview-avatar" style={{ borderColor: roleColor }}>
                    <i className="material-icons-round">person</i>
                </div>
                <div className="gk-preview-ad">{kisi.ad}</div>
                <div className="gk-preview-okul">{kisi.okul}</div>
                {kisi.ilce && <div className="gk-preview-ilce">{kisi.ilce}{kisi.il ? ` / ${kisi.il}` : ''}</div>}
            </div>
            <div className="gk-preview-kart-footer" style={{ background: roleColor }}>
                <span className="gk-preview-rol">{kisi.rol}</span>
                <span className="gk-preview-brans">{kisi.brans || compBrans}</span>
            </div>
        </div>
    );
}

// Diziyi n'li gruplara ayır
function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}
