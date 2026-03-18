import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/firebase';
import { ref, onValue, set, get, remove } from 'firebase/database';
import { useAuth } from '../lib/AuthContext';
import { filterCompetitionsArrayByUser } from '../lib/useFilteredCompetitions';
import turkeyData from '../data/turkey_data.json';
import './OfficialReportPage.css';

const EMPTY_REPORT = {
    baslik: '',
    tarih: '',
    yer: '',
    gozlemci: '',
    basHakem: '',
    teknikKurul: '',
    tesisDurumu: 'UYGUN',
    saglikOnlemleri: 'ALINDI',
    emniyetOnlemleri: 'ALINDI',
    olaylar: '',
    sonuc: ''
};

const OfficialReportPage = () => {
    const navigate = useNavigate();
    const { currentUser, hasPermission } = useAuth();

    // Data
    const [competitions, setCompetitions] = useState([]);
    const [allReports, setAllReports] = useState({}); // { compId: reportData }

    // Filters
    const [filterIl, setFilterIl] = useState('');

    // Editing
    const [editingCompId, setEditingCompId] = useState(null);
    const [competitionData, setCompetitionData] = useState(null);
    const [reportData, setReportData] = useState({ ...EMPTY_REPORT });
    const [isLoaded, setIsLoaded] = useState(false);

    // UI
    const [saveStatus, setSaveStatus] = useState(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState(null);
    const [showNewReportModal, setShowNewReportModal] = useState(false);
    const [newReportCompId, setNewReportCompId] = useState('');

    const canEdit = hasPermission('official_report', 'duzenle');
    const canDelete = hasPermission('official_report', 'sil');

    // Normalize old-format report (English fields → Turkish)
    const normalizeReport = useCallback((report, pushId, groupKey) => {
        return {
            baslik: report.activity || report.baslik || '',
            tarih: report.date || report.tarih || '',
            yer: report.place || report.yer || '',
            gozlemci: report.observer || report.gozlemci || '',
            basHakem: report.chief || report.basHakem || '',
            teknikKurul: report.org || report.teknikKurul || '',
            tesisDurumu: report.tesisDurumu || 'UYGUN',
            saglikOnlemleri: report.saglikOnlemleri || (report.chkDoctor ? 'ALINDI' : 'ALINMADI'),
            emniyetOnlemleri: report.emniyetOnlemleri || (report.chkSecurity ? 'ALINDI' : 'ALINMADI'),
            olaylar: report.complainants || report.olaylar || '',
            sonuc: report.evaluation || report.sonuc || '',
            // Internal tracking
            _compId: report.compId !== 'undefined' ? report.compId : null,
            _dbPath: `reports/${groupKey}/${pushId}`,
            _directorate: report.directorate || '',
            // Keep raw data for any extra fields
            _raw: report,
        };
    }, []);

    // Province list from turkey_data
    const ilListesi = useMemo(() => {
        return Object.keys(turkeyData).sort((a, b) => a.localeCompare(b, 'tr'));
    }, []);

    // Fetch competitions
    useEffect(() => {
        const compRef = ref(db, 'competitions');
        const unsubscribe = onValue(compRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                const list = Object.entries(data).map(([id, val]) => ({ id, ...val }));
                const sorted = list.sort((a, b) => new Date(b.tarih || b.baslangicTarihi || 0) - new Date(a.tarih || a.baslangicTarihi || 0));
                setCompetitions(filterCompetitionsArrayByUser(sorted, currentUser));
            }
        });
        return () => unsubscribe();
    }, [currentUser]);

    // Fetch all reports — handles both old nested format and new flat format
    useEffect(() => {
        const reportsRef = ref(db, 'reports');
        const unsubscribe = onValue(reportsRef, (snapshot) => {
            const raw = snapshot.val() || {};
            const flattened = {};

            Object.entries(raw).forEach(([groupKey, groupValue]) => {
                if (!groupValue || typeof groupValue !== 'object') return;

                // Check if this is old nested format (reports/{groupKey}/{pushId}/...)
                // Old format has push IDs as children (keys starting with '-')
                const childKeys = Object.keys(groupValue);
                const isNested = childKeys.length > 0 && childKeys.every(k => k.startsWith('-') && typeof groupValue[k] === 'object' && groupValue[k] !== null);

                if (isNested) {
                    // Old format: flatten each sub-report
                    Object.entries(groupValue).forEach(([pushId, report]) => {
                        // Normalize old English field names to Turkish
                        flattened[pushId] = normalizeReport(report, pushId, groupKey);
                    });
                } else {
                    // New format: groupKey IS the compId, groupValue IS the report
                    flattened[groupKey] = { ...groupValue, _compId: groupKey, _dbPath: `reports/${groupKey}` };
                }
            });

            setAllReports(flattened);
        });
        return () => unsubscribe();
    }, []);

    // Toast auto-dismiss
    useEffect(() => {
        if (saveStatus === 'saved' || saveStatus === 'error' || saveStatus === 'deleted') {
            const timer = setTimeout(() => setSaveStatus(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [saveStatus]);

    // Build report list from flattened reports
    const reportList = useMemo(() => {
        const list = [];
        Object.entries(allReports).forEach(([reportId, report]) => {
            // Try to match with a competition
            const comp = report._compId ? competitions.find(c => c.id === report._compId) : null;

            // For il: use competition il, or directorate from old report, or yer field
            const il = comp?.il || report._directorate?.trim() || report.yer || '';

            list.push({
                reportId,
                compId: report._compId,
                dbPath: report._dbPath,
                report,
                compName: comp?.isim || report.baslik || 'Bilinmeyen Yarışma',
                il,
                tarih: comp?.baslangicTarihi || report.tarih || '',
                gozlemci: report.gozlemci || '',
                basHakem: report.basHakem || '',
                tesisDurumu: report.tesisDurumu || 'UYGUN',
            });
        });
        // Sort by date desc
        list.sort((a, b) => {
            const parseDate = (d) => {
                if (!d) return 0;
                // Handle "12.02.2026-13.02.2026" format
                const part = d.split('-')[0].trim();
                const parts = part.split('.');
                if (parts.length === 3) return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
                return new Date(d).getTime();
            };
            return parseDate(b.tarih) - parseDate(a.tarih);
        });
        return list;
    }, [allReports, competitions]);

    // Filtered reports
    const filteredReports = useMemo(() => {
        if (!filterIl) return reportList;
        return reportList.filter(r =>
            r.il.toLocaleUpperCase('tr-TR') === filterIl.toLocaleUpperCase('tr-TR')
        );
    }, [reportList, filterIl]);

    // Competitions that don't have a report yet (for "new report")
    const availableComps = useMemo(() => {
        const reportedCompIds = new Set(Object.values(allReports).map(r => r._compId).filter(Boolean));
        return competitions.filter(c => !reportedCompIds.has(c.id));
    }, [competitions, allReports]);

    // Get competition stats
    const getCompStats = useCallback(() => {
        if (!competitionData) return { kategoriSayisi: 0, sporcuSayisi: 0, kulupSayisi: 0 };
        const kategoriler = competitionData.kategoriler || {};
        const kategoriSayisi = Object.keys(kategoriler).length;
        let sporcuSet = new Set();
        let kulupSet = new Set();
        const sporcular = competitionData.sporcular || {};
        Object.values(sporcular).forEach(catSporcular => {
            if (catSporcular && typeof catSporcular === 'object') {
                Object.values(catSporcular).forEach(sporcu => {
                    if (sporcu && sporcu.ad) {
                        sporcuSet.add(sporcu.ad);
                        if (sporcu.kulup) kulupSet.add(sporcu.kulup);
                    }
                });
            }
        });
        return { kategoriSayisi, sporcuSayisi: sporcuSet.size, kulupSayisi: kulupSet.size };
    }, [competitionData]);

    // Open existing report for editing (by reportId from list)
    const openExistingReport = (reportId) => {
        const report = allReports[reportId];
        if (!report) return;

        setEditingCompId(reportId); // use reportId as editing key
        setIsLoaded(true);

        // Load competition data if we have a valid compId
        if (report._compId) {
            get(ref(db, `competitions/${report._compId}`)).then(snap => {
                if (snap.exists()) setCompetitionData(snap.val());
            }).catch(() => {});
        } else {
            setCompetitionData(null);
        }

        // Set report data (already normalized)
        const { _compId, _dbPath, _directorate, _raw, ...fields } = report;
        setReportData({ ...EMPTY_REPORT, ...fields });
    };

    // Open new report for a competition
    const openNewReport = async (compId) => {
        setEditingCompId(`new_${compId}`); // prefix to distinguish from existing
        setIsLoaded(false);
        setCompetitionData(null);

        try {
            const compSnap = await get(ref(db, `competitions/${compId}`));
            if (compSnap.exists()) setCompetitionData(compSnap.val());

            const comp = competitions.find(c => c.id === compId);
            if (comp) {
                const tarihStr = comp.baslangicTarihi && comp.bitisTarihi
                    ? `${comp.baslangicTarihi} - ${comp.bitisTarihi}`
                    : comp.tarih || '';
                setReportData({ ...EMPTY_REPORT, baslik: comp.isim || '', tarih: tarihStr, yer: comp.il || '' });
            }
        } catch (err) {
            console.error('Rapor yükleme hatası:', err);
        }
    };

    // Go back to list
    const backToList = () => {
        setEditingCompId(null);
        setReportData({ ...EMPTY_REPORT });
        setCompetitionData(null);
        setIsLoaded(false);
    };

    // Save report
    const handleSave = async () => {
        if (!editingCompId) return;
        setSaveStatus('saving');
        try {
            let savePath;
            if (editingCompId.startsWith('new_')) {
                // New report — save as reports/{compId}
                const compId = editingCompId.replace('new_', '');
                savePath = `reports/${compId}`;
            } else {
                // Existing report — use stored dbPath or fallback
                const existing = allReports[editingCompId];
                savePath = existing?._dbPath || `reports/${editingCompId}`;
            }
            await set(ref(db, savePath), reportData);
            setSaveStatus('saved');
            setIsLoaded(true);
        } catch {
            setSaveStatus('error');
        }
    };

    // Delete report
    const handleDelete = async (reportId) => {
        try {
            const report = allReports[reportId];
            const deletePath = report?._dbPath || `reports/${reportId}`;
            await remove(ref(db, deletePath));
            setSaveStatus('deleted');
            setDeleteConfirmId(null);
            if (editingCompId === reportId) backToList();
        } catch {
            setSaveStatus('error');
        }
    };

    // Create new report
    const handleNewReport = () => {
        if (!newReportCompId) return;
        setShowNewReportModal(false);
        setNewReportCompId('');
        openNewReport(newReportCompId);
    };

    const handlePrint = () => window.print();
    const updateField = (field, value) => setReportData(prev => ({ ...prev, [field]: value }));
    const stats = getCompStats();

    // ============ REPORT LIST VIEW ============
    if (!editingCompId) {
        return (
            <div className="report-page-wrapper">
                {/* Toast */}
                {saveStatus && (
                    <div className={`report-toast report-toast--${saveStatus}`}>
                        <i className="material-icons-round">
                            {saveStatus === 'deleted' ? 'delete' : saveStatus === 'saved' ? 'check_circle' : 'error'}
                        </i>
                        <span>
                            {saveStatus === 'deleted' ? 'Rapor silindi.' : saveStatus === 'saved' ? 'Rapor kaydedildi!' : 'Bir hata oluştu!'}
                        </span>
                    </div>
                )}

                {/* Header */}
                <div className="report-header-card classic-card no-print">
                    <div className="report-header-top">
                        <div className="report-header-left">
                            <button className="report-back-btn" onClick={() => navigate('/')}>
                                <i className="material-icons-round">arrow_back</i>
                            </button>
                            <div className="report-icon-box">
                                <i className="material-icons-round">description</i>
                            </div>
                            <div className="report-header-info">
                                <h1 className="report-title">Yarışma Raporları</h1>
                                <p className="report-subtitle">Geçmiş raporları görüntüleyin, düzenleyin veya yeni rapor oluşturun.</p>
                            </div>
                        </div>
                        <div className="report-header-actions">
                            <div className="report-stat-badge">
                                <i className="material-icons-round">folder</i>
                                <span>{filteredReports.length} Rapor</span>
                            </div>
                            {canEdit && (
                                <button className="report-btn report-btn--new" onClick={() => setShowNewReportModal(true)}>
                                    <i className="material-icons-round">add</i>
                                    <span>Yeni Rapor</span>
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="report-header-bottom">
                        <div className="report-filter-group">
                            <div className="report-filter">
                                <i className="material-icons-round">location_on</i>
                                <select value={filterIl} onChange={e => setFilterIl(e.target.value)}>
                                    <option value="">Tüm İller</option>
                                    {ilListesi.map(il => (
                                        <option key={il} value={il}>{il}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Report List */}
                {filteredReports.length === 0 ? (
                    <div className="report-empty-state classic-card">
                        <div className="empty-icon-wrapper">
                            <i className="material-icons-round">
                                {reportList.length > 0 ? 'filter_list_off' : 'assignment'}
                            </i>
                        </div>
                        <h2>{reportList.length > 0 ? 'Bu ile ait rapor bulunamadı' : 'Henüz rapor oluşturulmamış'}</h2>
                        <p>
                            {reportList.length > 0
                                ? 'Farklı bir il seçin veya "Tüm İller" ile tüm raporları görün.'
                                : 'Yeni rapor oluşturmak için yukarıdaki "Yeni Rapor" butonunu kullanın.'
                            }
                        </p>
                    </div>
                ) : (
                    <div className="report-list-container">
                        <div className="report-list-grid">
                            {filteredReports.map(item => (
                                <div key={item.reportId} className="report-list-card classic-card">
                                    <div className="report-card-top">
                                        <div className="report-card-icon">
                                            <i className="material-icons-round">description</i>
                                        </div>
                                        <div className="report-card-info">
                                            <h3>{item.compName}</h3>
                                            <div className="report-card-meta">
                                                {item.il && (
                                                    <span className="meta-tag">
                                                        <i className="material-icons-round">location_on</i>
                                                        {item.il}
                                                    </span>
                                                )}
                                                {item.tarih && (
                                                    <span className="meta-tag">
                                                        <i className="material-icons-round">calendar_today</i>
                                                        {item.tarih}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="report-card-details">
                                        <div className="detail-row">
                                            <span className="detail-label">Gözlemci</span>
                                            <span className="detail-value">{item.gozlemci || '—'}</span>
                                        </div>
                                        <div className="detail-row">
                                            <span className="detail-label">Baş Hakem</span>
                                            <span className="detail-value">{item.basHakem || '—'}</span>
                                        </div>
                                        <div className="detail-row">
                                            <span className="detail-label">Tesis</span>
                                            <span className={`detail-badge detail-badge--${item.tesisDurumu === 'UYGUN' ? 'success' : item.tesisDurumu === 'UYGUN DEĞİL' ? 'danger' : 'warning'}`}>
                                                {item.tesisDurumu}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="report-card-actions">
                                        <button className="card-action-btn card-action-btn--view" onClick={() => openExistingReport(item.reportId)}>
                                            <i className="material-icons-round">visibility</i>
                                            <span>Görüntüle</span>
                                        </button>
                                        {canEdit && (
                                            <button className="card-action-btn card-action-btn--edit" onClick={() => openExistingReport(item.reportId)}>
                                                <i className="material-icons-round">edit</i>
                                                <span>Düzenle</span>
                                            </button>
                                        )}
                                        {canDelete && (
                                            <button className="card-action-btn card-action-btn--delete" onClick={() => setDeleteConfirmId(item.reportId)}>
                                                <i className="material-icons-round">delete</i>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Delete Confirm Modal */}
                {deleteConfirmId && (
                    <div className="modal-overlay" onClick={() => setDeleteConfirmId(null)}>
                        <div className="report-modal" onClick={e => e.stopPropagation()}>
                            <div className="report-modal-icon report-modal-icon--danger">
                                <i className="material-icons-round">warning</i>
                            </div>
                            <h3>Raporu Sil</h3>
                            <p>Bu yarışma raporunu silmek istediğinize emin misiniz? Bu işlem geri alınamaz.</p>
                            <div className="report-modal-actions">
                                <button className="modal-btn modal-btn--cancel" onClick={() => setDeleteConfirmId(null)}>
                                    İptal
                                </button>
                                <button className="modal-btn modal-btn--danger" onClick={() => handleDelete(deleteConfirmId)}>
                                    <i className="material-icons-round">delete</i>
                                    Sil
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* New Report Modal */}
                {showNewReportModal && (
                    <div className="modal-overlay" onClick={() => setShowNewReportModal(false)}>
                        <div className="report-modal" onClick={e => e.stopPropagation()}>
                            <div className="report-modal-icon report-modal-icon--primary">
                                <i className="material-icons-round">add_circle</i>
                            </div>
                            <h3>Yeni Rapor Oluştur</h3>
                            <p>Rapor oluşturmak istediğiniz yarışmayı seçin.</p>
                            <div className="report-modal-form">
                                <select value={newReportCompId} onChange={e => setNewReportCompId(e.target.value)}>
                                    <option value="">Yarışma seçiniz...</option>
                                    {availableComps.map(c => (
                                        <option key={c.id} value={c.id}>{c.isim}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="report-modal-actions">
                                <button className="modal-btn modal-btn--cancel" onClick={() => setShowNewReportModal(false)}>
                                    İptal
                                </button>
                                <button
                                    className="modal-btn modal-btn--primary"
                                    onClick={handleNewReport}
                                    disabled={!newReportCompId}
                                >
                                    <i className="material-icons-round">arrow_forward</i>
                                    Oluştur
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ============ EDIT / DETAIL VIEW ============
    return (
        <div className="report-page-wrapper">
            {/* Toast */}
            {saveStatus && (
                <div className={`report-toast report-toast--${saveStatus}`}>
                    <i className="material-icons-round">
                        {saveStatus === 'saving' ? 'sync' : saveStatus === 'saved' ? 'check_circle' : 'error'}
                    </i>
                    <span>
                        {saveStatus === 'saving' ? 'Kaydediliyor...' : saveStatus === 'saved' ? 'Rapor başarıyla kaydedildi!' : 'Kaydetme hatası!'}
                    </span>
                </div>
            )}

            {/* Header */}
            <div className="report-header-card classic-card no-print">
                <div className="report-header-top">
                    <div className="report-header-left">
                        <button className="report-back-btn" onClick={backToList}>
                            <i className="material-icons-round">arrow_back</i>
                        </button>
                        <div className="report-icon-box">
                            <i className="material-icons-round">edit_document</i>
                        </div>
                        <div className="report-header-info">
                            <h1 className="report-title">{reportData.baslik || 'Rapor Düzenle'}</h1>
                            <p className="report-subtitle">{reportData.yer ? `${reportData.yer} — ${reportData.tarih}` : 'Raporu düzenleyin ve kaydedin.'}</p>
                        </div>
                    </div>
                    {isLoaded && (
                        <div className="report-loaded-badge">
                            <i className="material-icons-round">cloud_done</i>
                            <span>Kayıtlı Rapor Yüklendi</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Content Grid */}
            <div className="report-content-grid">
                {/* Left: Form */}
                <div className="report-form-column no-print">
                    {/* Card: Görevliler */}
                    <div className="report-section-card classic-card">
                        <div className="section-header">
                            <i className="material-icons-round">badge</i>
                            <h3>Görevliler</h3>
                        </div>
                        <div className="form-grid">
                            <div className="form-field">
                                <label>Gözlemci / Temsilci</label>
                                <input type="text" placeholder="Gözlemci adını girin..." value={reportData.gozlemci} onChange={e => updateField('gozlemci', e.target.value)} readOnly={!canEdit} />
                            </div>
                            <div className="form-field">
                                <label>Baş Hakem</label>
                                <input type="text" placeholder="Baş hakem adını girin..." value={reportData.basHakem} onChange={e => updateField('basHakem', e.target.value)} readOnly={!canEdit} />
                            </div>
                            <div className="form-field">
                                <label>Teknik Kurul</label>
                                <input type="text" placeholder="Teknik kurul üyesini girin..." value={reportData.teknikKurul} onChange={e => updateField('teknikKurul', e.target.value)} readOnly={!canEdit} />
                            </div>
                        </div>
                    </div>

                    {/* Card: Tesis ve Organizasyon */}
                    <div className="report-section-card classic-card">
                        <div className="section-header">
                            <i className="material-icons-round">domain</i>
                            <h3>Tesis ve Organizasyon</h3>
                        </div>
                        <div className="form-grid">
                            <div className="form-field">
                                <label>Tesis Durumu</label>
                                <select value={reportData.tesisDurumu} onChange={e => updateField('tesisDurumu', e.target.value)} disabled={!canEdit}>
                                    <option value="UYGUN">Uygun</option>
                                    <option value="UYGUN DEĞİL">Uygun Değil</option>
                                    <option value="KISMEN UYGUN">Kısmen Uygun</option>
                                </select>
                            </div>
                            <div className="form-field">
                                <label>Sağlık Önlemleri</label>
                                <select value={reportData.saglikOnlemleri} onChange={e => updateField('saglikOnlemleri', e.target.value)} disabled={!canEdit}>
                                    <option value="ALINDI">Alındı</option>
                                    <option value="ALINMADI">Alınmadı</option>
                                    <option value="KISMEN ALINDI">Kısmen Alındı</option>
                                </select>
                            </div>
                            <div className="form-field">
                                <label>Emniyet Önlemleri</label>
                                <select value={reportData.emniyetOnlemleri} onChange={e => updateField('emniyetOnlemleri', e.target.value)} disabled={!canEdit}>
                                    <option value="ALINDI">Alındı</option>
                                    <option value="ALINMADI">Alınmadı</option>
                                    <option value="KISMEN ALINDI">Kısmen Alındı</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Card: Müsabaka Notları */}
                    <div className="report-section-card classic-card">
                        <div className="section-header">
                            <i className="material-icons-round">edit_note</i>
                            <h3>Müsabaka Notları</h3>
                        </div>
                        <div className="form-grid">
                            <div className="form-field full-width">
                                <label>Önemli Olaylar</label>
                                <textarea rows="4" placeholder="Yarışma sırasında yaşanan önemli olayları yazın..." value={reportData.olaylar} onChange={e => updateField('olaylar', e.target.value)} readOnly={!canEdit} />
                            </div>
                            <div className="form-field full-width">
                                <label>Sonuç ve Değerlendirme</label>
                                <textarea rows="3" placeholder="Genel değerlendirme ve sonuçları yazın..." value={reportData.sonuc} onChange={e => updateField('sonuc', e.target.value)} readOnly={!canEdit} />
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="report-actions">
                        {canEdit && (
                            <button className="report-btn report-btn--save" onClick={handleSave} disabled={saveStatus === 'saving'}>
                                <i className="material-icons-round">{saveStatus === 'saving' ? 'sync' : 'save'}</i>
                                <span>{saveStatus === 'saving' ? 'Kaydediliyor...' : 'Raporu Kaydet'}</span>
                            </button>
                        )}
                        <button className="report-btn report-btn--print" onClick={handlePrint}>
                            <i className="material-icons-round">print</i>
                            <span>Yazdır (A4)</span>
                        </button>
                    </div>
                </div>

                {/* Right: A4 Preview */}
                <div className="report-preview-area">
                    <div className="a4-page">
                        <div className="a4-header">
                            <img src="/logo.png" alt="TCF Logo" className="a4-logo" />
                            <div className="a4-header-text">
                                <h3>TÜRKİYE CİMNASTİK FEDERASYONU</h3>
                                <h4>YARIŞMA SONUÇ VE GÖZLEMCİ RAPORU</h4>
                            </div>
                        </div>

                        <div className="a4-section">
                            <table className="a4-info-table">
                                <tbody>
                                    <tr><td className="a4-label">Yarışma Adı:</td><td className="a4-value">{reportData.baslik}</td></tr>
                                    <tr><td className="a4-label">Tarih:</td><td className="a4-value">{reportData.tarih}</td></tr>
                                    <tr><td className="a4-label">Yer:</td><td className="a4-value">{reportData.yer}</td></tr>
                                </tbody>
                            </table>
                        </div>

                        {competitionData && (
                            <div className="a4-section">
                                <h5 className="a4-section-title">YARIŞMA İSTATİSTİKLERİ</h5>
                                <div className="a4-stats-grid">
                                    <div className="a4-stat-item"><span className="a4-stat-number">{stats.kategoriSayisi}</span><span className="a4-stat-label">Kategori</span></div>
                                    <div className="a4-stat-item"><span className="a4-stat-number">{stats.sporcuSayisi}</span><span className="a4-stat-label">Sporcu</span></div>
                                    <div className="a4-stat-item"><span className="a4-stat-number">{stats.kulupSayisi}</span><span className="a4-stat-label">Kulüp</span></div>
                                </div>
                            </div>
                        )}

                        <div className="a4-section">
                            <h5 className="a4-section-title">TEKNİK BİLGİLER</h5>
                            <p><strong>Gözlemci / Temsilci:</strong> {reportData.gozlemci || '—'}</p>
                            <p><strong>Baş Hakem:</strong> {reportData.basHakem || '—'}</p>
                            {reportData.teknikKurul && <p><strong>Teknik Kurul:</strong> {reportData.teknikKurul}</p>}
                        </div>

                        <div className="a4-section">
                            <h5 className="a4-section-title">TESİS VE ORGANİZASYON</h5>
                            <p>Tesisin yarışmaya uygunluğu: <strong>{reportData.tesisDurumu}</strong></p>
                            <p>Sağlık Tedbirleri: <strong>{reportData.saglikOnlemleri}</strong></p>
                            <p>Emniyet Tedbirleri: <strong>{reportData.emniyetOnlemleri}</strong></p>
                        </div>

                        <div className="a4-section">
                            <h5 className="a4-section-title">MÜSABAKA NOTLARI VE OLAYLAR</h5>
                            <div className="a4-notes-box">{reportData.olaylar || 'Herhangi bir olumsuzluk yaşanmamıştır.'}</div>
                        </div>

                        {reportData.sonuc && (
                            <div className="a4-section">
                                <h5 className="a4-section-title">SONUÇ VE DEĞERLENDİRME</h5>
                                <div className="a4-notes-box">{reportData.sonuc}</div>
                            </div>
                        )}

                        <div className="a4-footer">
                            <div className="a4-sign-box">
                                <p className="a4-sign-title">Yarışma Gözlemcisi</p>
                                {reportData.gozlemci && <p className="a4-sign-name">{reportData.gozlemci}</p>}
                                <div className="a4-sign-line"></div>
                                <p className="a4-sign-label">İmza</p>
                            </div>
                            <div className="a4-sign-box">
                                <p className="a4-sign-title">Baş Hakem</p>
                                {reportData.basHakem && <p className="a4-sign-name">{reportData.basHakem}</p>}
                                <div className="a4-sign-line"></div>
                                <p className="a4-sign-label">İmza</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OfficialReportPage;
