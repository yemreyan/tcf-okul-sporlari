/**
 * CompetitionSchedulePage — Sade & Akıllı Planlama
 *
 * Tek görünüm: yarışma seçici + gün sekmeleri + saat tablosu.
 * Her satıra tıklandığında o kategorinin rotasyon ızgarası (alet × grup) açılır.
 * "+ Kategori Ekle" modal: dak/sporcu × grup büyüklüğü × rotasyon hesabıyla
 * süre/bitiş canlı tahmin edilir.
 *
 * Veri yazımı: {firebasePath}/{compId}/program/{sessionId}
 * Şema: { tarih, gunIndex, baslangic, bitis, kategori, aletler[], sporcuSayisi,
 *         gruplar[[athId]], minDkSporcu, isinmaDk, odulDk, durum }
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, push, update, remove, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { useNotification } from '../lib/NotificationContext';
import { useDiscipline } from '../lib/DisciplineContext';
import { filterCompetitionsByUser } from '../lib/useFilteredCompetitions';
import { logAction } from '../lib/auditLogger';
import './CompetitionSchedulePage.css';

/* ── Sabitler & Yardımcılar ───────────────────────────────────────────── */
const ALET_LABELS = {
    atlama: 'Atlama', barfiks: 'Barfiks', halka: 'Halka', kulplu: 'Kulplu Beygir',
    mantar: 'Mantar Beygir', paralel: 'Paralel', yer: 'Yer', denge: 'Denge',
    asimetrik: 'Asimetrik Paralel', serbest: 'Serbest', sirik: 'Sırık',
    top: 'Top', kurdele: 'Kurdele',
};
const aletLabel = (k) => ALET_LABELS[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : '');

const catLabel = (catKey) => String(catKey || '').split('_')
    .map(w => w ? w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1) : w).join(' ');

// Klasik olimpik rotasyon sırası
const OLIMPIK_KIZ = ['atlama', 'asimetrik', 'denge', 'yer', 'serbest'];
const OLIMPIK_ERKEK = ['yer', 'kulplu', 'mantar', 'halka', 'atlama', 'paralel', 'barfiks', 'sirik'];
function olimpikSira(catKey, aletler) {
    const isKiz = String(catKey).toLowerCase().includes('kiz') || String(catKey).toLowerCase().includes('kız');
    const r = isKiz ? OLIMPIK_KIZ : OLIMPIK_ERKEK;
    const ordered = r.filter(a => aletler.includes(a));
    const extra = aletler.filter(a => !ordered.includes(a));
    return [...ordered, ...extra];
}

const SESSION_LABELS = { bekliyor: 'Bekliyor', devam: 'Devam', tamamlandi: 'Tamamlandı' };
const SESSION_COLORS = { bekliyor: '#94A3B8', devam: '#2563EB', tamamlandi: '#16A34A' };

function dateRange(start, end) {
    const days = [];
    if (!start) return days;
    const s = new Date(start), e = new Date(end || start);
    if (isNaN(s) || isNaN(e)) return days;
    const cur = new Date(s);
    while (cur <= e) { days.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 1); }
    return days;
}
function fmtDate(d) {
    if (!d) return '';
    const x = new Date(d);
    return isNaN(x) ? d : x.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
}
function hmToMin(t) {
    if (!t || !/^\d{1,2}:\d{2}/.test(t)) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}
function minToHm(min) {
    min = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
    const h = Math.floor(min / 60), m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function distributeGroups(athleteIds, k) {
    const groups = Array.from({ length: k }, () => []);
    athleteIds.forEach((a, i) => groups[i % k].push(a));
    return groups;
}
// Rotasyon r'de alet i'de hangi grup var: (i - r + K) mod K
const groupAt = (alet_i, rotation_r, K) => ((alet_i - rotation_r) % K + K) % K;
const GROUP_LETTER = (i) => String.fromCharCode(65 + i);
const GROUP_COLOR = ['#6366F1', '#F59E0B', '#10B981', '#EC4899', '#0EA5E9', '#A855F7', '#EF4444', '#84CC16'];

/* ── Bileşen ──────────────────────────────────────────────────────────── */
export default function CompetitionSchedulePage() {
    const navigate = useNavigate();
    const { hasPermission, currentUser } = useAuth();
    const { toast, confirm } = useNotification();
    const { firebasePath, routePrefix, label: disciplineLabel } = useDiscipline();

    const [competitions, setCompetitions] = useState({});
    const [selectedCompId, setSelectedCompId] = useState('');
    const [sessions, setSessions] = useState({});
    const [siralama, setSiralama] = useState({});
    const [activeDay, setActiveDay] = useState(0);
    const [expanded, setExpanded] = useState(new Set());
    const [modal, setModal] = useState(null); // null | { editing: id|null, form: {...} }

    /* ── Yarışmalar ── */
    useEffect(() => {
        const u = onValue(ref(db, firebasePath), s => {
            setCompetitions(filterCompetitionsByUser(s.val() || {}, currentUser));
        });
        return () => u();
    }, [firebasePath, currentUser]);

    /* ── Seçili yarışmanın program & sıralama ── */
    useEffect(() => {
        if (!selectedCompId) { setSessions({}); setSiralama({}); return; }
        const u1 = onValue(ref(db, `${firebasePath}/${selectedCompId}/program`), s => setSessions(s.val() || {}));
        get(ref(db, `${firebasePath}/${selectedCompId}/siralama`)).then(s => setSiralama(s.val() || {}));
        return () => u1();
    }, [firebasePath, selectedCompId]);

    const comp = competitions[selectedCompId];
    const kategoriler = useMemo(() => comp?.kategoriler || {}, [comp]);
    const days = useMemo(() => dateRange(comp?.baslangicTarihi || comp?.tarih, comp?.bitisTarihi), [comp]);

    /* ── Sporcu listesi: önce siralama'dan, yoksa sporcular'dan ── */
    const getCatAthletes = useCallback(async (catKey) => {
        const sira = siralama?.[catKey];
        if (sira && typeof sira === 'object') {
            const out = new Set();
            const walk = (node) => {
                if (!node || typeof node !== 'object') return;
                Object.entries(node).forEach(([k, v]) => {
                    if (typeof v === 'object' && v && (v.ad || v.adSoyad || v.soyadAd || v.lisansNo)) out.add(k);
                    else walk(v);
                });
            };
            walk(sira);
            if (out.size > 0) return [...out];
        }
        const snap = await get(ref(db, `${firebasePath}/${selectedCompId}/sporcular/${catKey}`));
        const obj = snap.val() || {};
        return Object.keys(obj);
    }, [firebasePath, selectedCompId, siralama]);

    /* ── Gün bazlı seans listesi ── */
    const sessionsByDay = useMemo(() => {
        const out = days.map(() => []);
        Object.entries(sessions).forEach(([id, s]) => {
            const idx = (typeof s.gunIndex === 'number')
                ? s.gunIndex
                : Math.max(0, days.indexOf(s.tarih));
            if (idx >= 0 && idx < out.length) out[idx].push({ id, ...s });
        });
        out.forEach(arr => arr.sort((a, b) => hmToMin(a.baslangic || a.saat) - hmToMin(b.baslangic || b.saat)));
        return out;
    }, [sessions, days]);

    const currentDaySessions = sessionsByDay[activeDay] || [];

    /* ── Çakışma kontrolü ── */
    const conflicts = useMemo(() => {
        const set = new Set();
        for (let i = 0; i < currentDaySessions.length; i++) {
            for (let j = i + 1; j < currentDaySessions.length; j++) {
                const a = currentDaySessions[i], b = currentDaySessions[j];
                const aS = hmToMin(a.baslangic || a.saat), aE = hmToMin(a.bitis || a.bitisSaat);
                const bS = hmToMin(b.baslangic || b.saat), bE = hmToMin(b.bitis || b.bitisSaat);
                if (aE > bS && bE > aS) { set.add(a.id); set.add(b.id); }
            }
        }
        return set;
    }, [currentDaySessions]);

    /* ── Süre hesabı ── */
    const computeDuration = (sporcuSayisi, aletSayisi, minDk, isinma, odul) => {
        const K = Math.max(1, aletSayisi || 1);
        const groupSize = Math.ceil((sporcuSayisi || 0) / K);
        const rotMinutes = groupSize * (minDk || 0) * K;
        return Math.max(1, Math.round(rotMinutes + (isinma || 0) + (odul || 0)));
    };

    /* ── Modal ── */
    const openAddModal = () => {
        const last = currentDaySessions[currentDaySessions.length - 1];
        const baseStart = last ? minToHm(hmToMin(last.bitis || last.bitisSaat) + 5) : '09:00';
        setModal({
            editing: null, form: {
                kategori: '', baslangic: baseStart,
                minDkSporcu: 2.5, isinmaDk: 15, odulDk: 10, durum: 'bekliyor',
            },
        });
    };
    const openEditModal = (s) => {
        setModal({
            editing: s.id, form: {
                kategori: s.kategori,
                baslangic: s.baslangic || s.saat || '09:00',
                minDkSporcu: s.minDkSporcu ?? 2.5,
                isinmaDk: s.isinmaDk ?? 15,
                odulDk: s.odulDk ?? 10,
                durum: s.durum || 'bekliyor',
            },
        });
    };
    const closeModal = () => setModal(null);

    const modalPreview = useMemo(() => {
        if (!modal || !modal.form.kategori) return null;
        const cat = modal.form.kategori;
        const kc = kategoriler[cat] || {};
        const aletler = kc.aletler || [];
        const sporcular = comp?.sporcular?.[cat] || {};
        const sporcuSayisi = Object.keys(sporcular).length;
        const dur = computeDuration(sporcuSayisi, aletler.length, +modal.form.minDkSporcu, +modal.form.isinmaDk, +modal.form.odulDk);
        const bitis = minToHm(hmToMin(modal.form.baslangic) + dur);
        return { aletler, sporcuSayisi, dur, bitis };
    }, [modal, kategoriler, comp]);

    const saveSession = async () => {
        if (!modal || !modal.form.kategori) { toast('Kategori seçiniz.', 'warning'); return; }
        const cat = modal.form.kategori;
        const kc = kategoriler[cat];
        if (!kc) { toast('Kategori bulunamadı.', 'error'); return; }
        const aletler = (kc.aletler || []).slice();
        if (aletler.length === 0) { toast('Bu kategoride aktif alet yok.', 'warning'); return; }
        const sira = olimpikSira(cat, aletler);
        const athleteIds = await getCatAthletes(cat);
        const sporcuSayisi = athleteIds.length;
        const K = sira.length;
        const gruplar = distributeGroups(athleteIds, K);
        const dur = computeDuration(sporcuSayisi, K, +modal.form.minDkSporcu, +modal.form.isinmaDk, +modal.form.odulDk);
        const bitis = minToHm(hmToMin(modal.form.baslangic) + dur);
        const data = {
            tarih: days[activeDay] || '',
            gunIndex: activeDay,
            baslangic: modal.form.baslangic, saat: modal.form.baslangic,
            bitis, bitisSaat: bitis,
            kategori: cat,
            aletler: sira,
            sporcuSayisi,
            gruplar,
            minDkSporcu: +modal.form.minDkSporcu,
            isinmaDk: +modal.form.isinmaDk,
            odulDk: +modal.form.odulDk,
            durum: modal.form.durum,
        };
        try {
            if (modal.editing) {
                await update(ref(db, `${firebasePath}/${selectedCompId}/program/${modal.editing}`), data);
                logAction('schedule_update', `Plan güncellendi: ${catLabel(cat)}`, { user: currentUser?.kullaniciAdi, competitionId: selectedCompId });
            } else {
                await push(ref(db, `${firebasePath}/${selectedCompId}/program`), data);
                logAction('schedule_add', `Plan eklendi: ${catLabel(cat)}`, { user: currentUser?.kullaniciAdi, competitionId: selectedCompId });
            }
            toast(`${catLabel(cat)} planlandı (${dur} dk).`, 'success');
            closeModal();
        } catch (e) {
            toast('Kaydetme başarısız.', 'error');
        }
    };

    const deleteSession = async (s) => {
        const ok = await confirm(`'${catLabel(s.kategori)}' planlamasını silmek istiyor musunuz?`);
        if (!ok) return;
        await remove(ref(db, `${firebasePath}/${selectedCompId}/program/${s.id}`));
        toast('Plan silindi.', 'info');
    };

    const setStatus = async (s, durum) => {
        await update(ref(db, `${firebasePath}/${selectedCompId}/program/${s.id}`), { durum });
    };

    const autoSchedule = async () => {
        if (currentDaySessions.length === 0) { toast('Bu günde plan yok.', 'info'); return; }
        const ok = await confirm("Bu günün seansları sırayla otomatik yerleştirilsin mi?");
        if (!ok) return;
        const gap = 10;
        const startMin = hmToMin(currentDaySessions[0].baslangic || currentDaySessions[0].saat || '09:00');
        let cursor = startMin;
        const updates = {};
        for (const s of currentDaySessions) {
            const dur = computeDuration(s.sporcuSayisi || 0, (s.aletler || []).length, s.minDkSporcu, s.isinmaDk, s.odulDk);
            const baslangic = minToHm(cursor);
            const bitis = minToHm(cursor + dur);
            updates[`${firebasePath}/${selectedCompId}/program/${s.id}/baslangic`] = baslangic;
            updates[`${firebasePath}/${selectedCompId}/program/${s.id}/saat`] = baslangic;
            updates[`${firebasePath}/${selectedCompId}/program/${s.id}/bitis`] = bitis;
            updates[`${firebasePath}/${selectedCompId}/program/${s.id}/bitisSaat`] = bitis;
            cursor += dur + gap;
        }
        await update(ref(db), updates);
        toast('Saatler otomatik düzenlendi.', 'success');
    };

    /* ── Render ───────────────────────────────────────────────────────── */
    const compEntries = Object.entries(competitions).sort((a, b) =>
        new Date(b[1].baslangicTarihi || b[1].tarih || 0) - new Date(a[1].baslangicTarihi || a[1].tarih || 0)
    );
    const dayTotalMin = currentDaySessions.reduce((s, x) => s + Math.max(0, hmToMin(x.bitis || x.bitisSaat) - hmToMin(x.baslangic || x.saat)), 0);
    const dayEnd = currentDaySessions.length ? (currentDaySessions[currentDaySessions.length - 1].bitis || currentDaySessions[currentDaySessions.length - 1].bitisSaat) : '';
    const usedCats = new Set(currentDaySessions.map(s => s.kategori));

    return (
        <div className="schedule-v2">
            <header className="csv2-header">
                <button className="csv2-back" onClick={() => navigate(routePrefix)} title="Geri">
                    <i className="material-icons-round">arrow_back</i>
                </button>
                <div>
                    <h1>{disciplineLabel} — Yarışma Planlama</h1>
                    <p>Hangi gün hangi kategori, başlangıç/bitiş ve rotasyon tek bakışta.</p>
                </div>
            </header>

            <div className="csv2-toolbar">
                <select value={selectedCompId} onChange={e => { setSelectedCompId(e.target.value); setActiveDay(0); }}>
                    <option value="">— Yarışma Seçin —</option>
                    {compEntries.map(([id, c]) => (
                        <option key={id} value={id}>
                            {c.isim} {c.il ? `· ${c.il}` : ''} {c.baslangicTarihi ? `· ${c.baslangicTarihi}` : ''}
                        </option>
                    ))}
                </select>
                {selectedCompId && (
                    <div className="csv2-toolbar-actions">
                        <button className="csv2-btn-secondary" onClick={autoSchedule} title="Bu günün seanslarını sırayla yerleştir">
                            <i className="material-icons-round">schedule</i> Otomatik Saatlendir
                        </button>
                        {hasPermission?.('competitions', 'duzenle') !== false && (
                            <button className="csv2-btn-primary" onClick={openAddModal}>
                                <i className="material-icons-round">add</i> Kategori Ekle
                            </button>
                        )}
                    </div>
                )}
            </div>

            {!selectedCompId ? (
                <div className="csv2-empty">
                    <i className="material-icons-round">event_note</i>
                    <h2>Yarışma seçin</h2>
                    <p>Planlama yapmak istediğiniz yarışmayı yukarıdan seçin.</p>
                </div>
            ) : days.length === 0 ? (
                <div className="csv2-empty">
                    <i className="material-icons-round">date_range</i>
                    <h2>Tarih yok</h2>
                    <p>Yarışmaya başlangıç/bitiş tarihi atayın.</p>
                </div>
            ) : (
                <>
                    <div className="csv2-day-tabs">
                        {days.map((d, i) => (
                            <button key={d} className={`csv2-day-tab ${i === activeDay ? 'active' : ''}`}
                                onClick={() => setActiveDay(i)}>
                                <div className="csv2-day-name">{i + 1}. Gün</div>
                                <div className="csv2-day-date">{fmtDate(d)}</div>
                                <div className="csv2-day-count">{sessionsByDay[i]?.length || 0} seans</div>
                            </button>
                        ))}
                    </div>

                    <div className="csv2-table-wrap">
                        {currentDaySessions.length === 0 ? (
                            <div className="csv2-empty small">
                                <i className="material-icons-round">add_box</i>
                                <h3>Bu güne plan yok</h3>
                                <p>"Kategori Ekle" ile başlayın.</p>
                            </div>
                        ) : (
                            <table className="csv2-table">
                                <thead>
                                    <tr>
                                        <th>BAŞLANGIÇ</th>
                                        <th>KATEGORİ</th>
                                        <th className="ta-c">SPORCU</th>
                                        <th className="ta-c">ALET</th>
                                        <th className="ta-c">SÜRE</th>
                                        <th>BİTİŞ</th>
                                        <th>DURUM</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {currentDaySessions.map(s => {
                                        const conflict = conflicts.has(s.id);
                                        const isOpen = expanded.has(s.id);
                                        const baslangic = s.baslangic || s.saat || '—';
                                        const bitis = s.bitis || s.bitisSaat || '—';
                                        const dur = Math.max(0, hmToMin(bitis) - hmToMin(baslangic));
                                        return (
                                            <FragmentRow key={s.id}>
                                                <tr className={`csv2-row ${isOpen ? 'open' : ''} ${conflict ? 'conflict' : ''}`}
                                                    onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}>
                                                    <td className="csv2-time">{baslangic}</td>
                                                    <td className="csv2-cat">
                                                        <i className="material-icons-round csv2-chev">{isOpen ? 'expand_more' : 'chevron_right'}</i>
                                                        <strong>{catLabel(s.kategori)}</strong>
                                                        {conflict && <span className="csv2-badge warn">⚠ çakışma</span>}
                                                    </td>
                                                    <td className="ta-c">{s.sporcuSayisi ?? '—'}</td>
                                                    <td className="ta-c">{(s.aletler || []).length}</td>
                                                    <td className="ta-c">{dur} dk</td>
                                                    <td className="csv2-time">{bitis}</td>
                                                    <td>
                                                        <span className="csv2-status" style={{ background: SESSION_COLORS[s.durum] || '#94a3b8' }}>
                                                            {SESSION_LABELS[s.durum] || 'Bekliyor'}
                                                        </span>
                                                    </td>
                                                    <td className="csv2-actions" onClick={e => e.stopPropagation()}>
                                                        <button className="csv2-icon-btn" onClick={() => openEditModal(s)} title="Düzenle">
                                                            <i className="material-icons-round">edit</i>
                                                        </button>
                                                        <select className="csv2-status-sel" value={s.durum || 'bekliyor'}
                                                            onChange={e => setStatus(s, e.target.value)}>
                                                            <option value="bekliyor">Bekliyor</option>
                                                            <option value="devam">Devam</option>
                                                            <option value="tamamlandi">Tamamlandı</option>
                                                        </select>
                                                        <button className="csv2-icon-btn danger" onClick={() => deleteSession(s)} title="Sil">
                                                            <i className="material-icons-round">delete</i>
                                                        </button>
                                                    </td>
                                                </tr>
                                                {isOpen && (
                                                    <tr className="csv2-detail-row">
                                                        <td colSpan={8}>
                                                            <RotationGrid session={s} comp={comp} />
                                                        </td>
                                                    </tr>
                                                )}
                                            </FragmentRow>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr>
                                        <td colSpan={4} className="csv2-foot-label">Bu gün toplam</td>
                                        <td className="ta-c"><strong>{dayTotalMin} dk</strong></td>
                                        <td className="csv2-time"><strong>{dayEnd || '—'}</strong></td>
                                        <td colSpan={2}>{currentDaySessions.length} seans</td>
                                    </tr>
                                </tfoot>
                            </table>
                        )}
                    </div>
                </>
            )}

            {modal && (
                <div className="csv2-modal-overlay" onClick={closeModal}>
                    <div className="csv2-modal" onClick={e => e.stopPropagation()}>
                        <div className="csv2-modal-head">
                            <h2>{modal.editing ? 'Plan Düzenle' : 'Kategori Ekle'}</h2>
                            <button onClick={closeModal}><i className="material-icons-round">close</i></button>
                        </div>
                        <div className="csv2-modal-body">
                            <label className="csv2-field">
                                <span>KATEGORİ</span>
                                <select value={modal.form.kategori}
                                    disabled={!!modal.editing}
                                    onChange={e => setModal({ ...modal, form: { ...modal.form, kategori: e.target.value } })}>
                                    <option value="">— Seçin —</option>
                                    {Object.entries(kategoriler).map(([k, v]) => {
                                        const sayi = Object.keys(comp?.sporcular?.[k] || {}).length;
                                        const alet = (v.aletler || []).length;
                                        const inUse = !modal.editing && usedCats.has(k);
                                        return (
                                            <option key={k} value={k} disabled={inUse && !modal.editing}>
                                                {v.name || catLabel(k)} · {sayi} sporcu · {alet} alet{inUse ? ' (bugün eklendi)' : ''}
                                            </option>
                                        );
                                    })}
                                </select>
                            </label>
                            <div className="csv2-grid-2">
                                <label className="csv2-field">
                                    <span>BAŞLANGIÇ</span>
                                    <input type="time" value={modal.form.baslangic}
                                        onChange={e => setModal({ ...modal, form: { ...modal.form, baslangic: e.target.value } })} />
                                </label>
                                <label className="csv2-field">
                                    <span>DURUM</span>
                                    <select value={modal.form.durum}
                                        onChange={e => setModal({ ...modal, form: { ...modal.form, durum: e.target.value } })}>
                                        <option value="bekliyor">Bekliyor</option>
                                        <option value="devam">Devam</option>
                                        <option value="tamamlandi">Tamamlandı</option>
                                    </select>
                                </label>
                            </div>
                            <div className="csv2-grid-3">
                                <label className="csv2-field">
                                    <span>DAK / SPORCU</span>
                                    <input type="number" step="0.5" min="0.5" value={modal.form.minDkSporcu}
                                        onChange={e => setModal({ ...modal, form: { ...modal.form, minDkSporcu: e.target.value } })} />
                                </label>
                                <label className="csv2-field">
                                    <span>ISINMA (DK)</span>
                                    <input type="number" min="0" value={modal.form.isinmaDk}
                                        onChange={e => setModal({ ...modal, form: { ...modal.form, isinmaDk: e.target.value } })} />
                                </label>
                                <label className="csv2-field">
                                    <span>ÖDÜL/GEÇİŞ (DK)</span>
                                    <input type="number" min="0" value={modal.form.odulDk}
                                        onChange={e => setModal({ ...modal, form: { ...modal.form, odulDk: e.target.value } })} />
                                </label>
                            </div>

                            {modalPreview && (
                                <div className="csv2-preview">
                                    <div className="csv2-preview-row">
                                        <span>Sporcu</span><strong>{modalPreview.sporcuSayisi}</strong>
                                    </div>
                                    <div className="csv2-preview-row">
                                        <span>Alet</span><strong>{modalPreview.aletler.length}</strong>
                                    </div>
                                    <div className="csv2-preview-row">
                                        <span>Grup başına</span>
                                        <strong>~{Math.ceil((modalPreview.sporcuSayisi || 0) / Math.max(1, modalPreview.aletler.length))} sporcu</strong>
                                    </div>
                                    <div className="csv2-preview-row">
                                        <span>Tahmini süre</span><strong>{modalPreview.dur} dk</strong>
                                    </div>
                                    <div className="csv2-preview-row big">
                                        <span>BİTİŞ</span><strong>{modalPreview.bitis}</strong>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="csv2-modal-foot">
                            <button className="csv2-btn-secondary" onClick={closeModal}>İptal</button>
                            <button className="csv2-btn-primary" onClick={saveSession}>
                                <i className="material-icons-round">save</i>
                                {modal.editing ? 'Güncelle' : 'Planla'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function FragmentRow({ children }) { return <>{children}</>; }

/* ── Rotasyon Izgarası ─────────────────────────────────────────────────── */
function RotationGrid({ session, comp }) {
    const aletler = session.aletler || [];
    const K = aletler.length;
    const gruplar = session.gruplar || [];
    if (K === 0) return <div className="csv2-empty small"><p>Bu seansta alet yok.</p></div>;
    const sporcular = comp?.sporcular?.[session.kategori] || {};
    const fullName = (id) => {
        const a = sporcular[id] || {};
        const ad = (a.ad || a.adSoyad || '').trim();
        const soyad = (a.soyad || '').trim();
        return (ad || soyad) ? `${ad} ${soyad}`.trim() : id;
    };

    return (
        <div className="csv2-rotgrid">
            <div className="csv2-rotgrid-title">Rotasyon Planı — {catLabel(session.kategori)}</div>
            <table className="csv2-rotgrid-table">
                <thead>
                    <tr>
                        <th>ALET</th>
                        {Array.from({ length: K }, (_, r) => <th key={r}>Rotasyon {r + 1}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {aletler.map((al, i) => (
                        <tr key={al}>
                            <td className="csv2-rotgrid-alet">{aletLabel(al)}</td>
                            {Array.from({ length: K }, (_, r) => {
                                const gIdx = groupAt(i, r, K);
                                const color = GROUP_COLOR[gIdx % GROUP_COLOR.length];
                                return (
                                    <td key={r} className="csv2-rotgrid-cell" style={{ borderLeft: `4px solid ${color}` }}>
                                        <div className="csv2-rotgrid-grup" style={{ color }}>Grup {GROUP_LETTER(gIdx)}</div>
                                        <div className="csv2-rotgrid-count">{(gruplar[gIdx] || []).length} sporcu</div>
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
            <div className="csv2-rotgrid-groups">
                {gruplar.map((ids, i) => (
                    <div key={i} className="csv2-rotgrid-grup-card" style={{ borderTop: `3px solid ${GROUP_COLOR[i % GROUP_COLOR.length]}` }}>
                        <div className="csv2-rotgrid-grup-head">
                            <span style={{ color: GROUP_COLOR[i % GROUP_COLOR.length] }}>Grup {GROUP_LETTER(i)}</span>
                            <span className="csv2-rotgrid-grup-count">{ids.length} sporcu</span>
                        </div>
                        <ul>
                            {ids.slice(0, 6).map(id => <li key={id}>{fullName(id)}</li>)}
                            {ids.length > 6 && <li className="more">…ve {ids.length - 6} kişi daha</li>}
                        </ul>
                    </div>
                ))}
            </div>
            <div className="csv2-rotgrid-hint">
                Klasik olimpik rotasyon: her rotasyonda gruplar bir alet ileri kayar. Toplam {K} rotasyon.
            </div>
        </div>
    );
}
