import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, get, set, update } from 'firebase/database';
import { db } from '../lib/firebase';
import { useNotification } from '../lib/NotificationContext';
import turkeyData from '../data/turkey_data.json';
import './SchoolsPage.css';

export default function SchoolsPage() {
  const navigate = useNavigate();
  const { toast, confirm } = useNotification();

  const [selectedIl, setSelectedIl] = useState('');
  const [selectedIlce, setSelectedIlce] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [firebaseSchools, setFirebaseSchools] = useState(null); // null = not loaded, [] = empty, [...] = has data
  const [staticSchools, setStaticSchools] = useState([]);
  const [loadingFirebase, setLoadingFirebase] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStatus, setImportStatus] = useState('');
  const [importing, setImporting] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingSchool, setEditingSchool] = useState(null); // { index, name }
  const [schoolInput, setSchoolInput] = useState('');
  const [saving, setSaving] = useState(false);

  // MEBBİS senkronizasyon state'leri
  const [syncMeta, setSyncMeta] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');

  // MEBBİS meta verisini Firebase'den yükle
  useEffect(() => {
    get(ref(db, '_meta/okullar_guncelleme'))
      .then((snap) => snap.exists() && setSyncMeta(snap.val()))
      .catch(() => {});
  }, []);

  // MEBBİS senkronizasyonunu tetikle (doğrudan GitHub Actions workflow_dispatch)
  const handleMebbisSync = async (options = {}) => {
    setSyncing(true);
    setSyncError('');
    try {
      // GitHub token'ı Firebase'den oku
      const tokenSnap = await get(ref(db, 'settings/github_token'));
      const githubToken = tokenSnap.exists() ? tokenSnap.val() : null;

      if (!githubToken) {
        setSyncError('GitHub token ayarlanmamış');
        toast(
          'GitHub token bulunamadı. Firebase RTDB > settings/github_token alanına GitHub Personal Access Token ekleyin (repo:workflow izni gerekli).',
          'error'
        );
        return;
      }

      const githubRepo = 'yemreyan/tcf-okul-sporlari';
      const inputs = {};
      if (options.il && typeof options.il === 'string') {
        inputs.il = options.il.trim().toUpperCase();
      }
      if (options.testMode === true) {
        inputs.test_mode = 'true';
      }

      const response = await fetch(
        `https://api.github.com/repos/${githubRepo}/actions/workflows/scrape-mebbis.yml/dispatches`,
        {
          method: 'POST',
          headers: {
            Authorization: `token ${githubToken}`,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ref: 'main', inputs }),
        }
      );

      if (response.status === 204) {
        toast('GitHub Actions iş akışı başlatıldı. İşlem tamamlanınca Firebase güncellenir (birkaç dakika sürebilir).', 'success');
      } else {
        let errorData = {};
        try { errorData = await response.json(); } catch {}
        const msg = errorData.message || `GitHub API hata: ${response.status}`;
        setSyncError(msg);
        toast('Tetikleme başarısız: ' + msg, 'error');
      }
    } catch (err) {
      setSyncError(err.message);
      toast('Bağlantı hatası: ' + err.message, 'error');
    } finally {
      setSyncing(false);
    }
  };

  // Load static + Firebase data when il/ilce changes
  useEffect(() => {
    if (!selectedIl || !selectedIlce) {
      setStaticSchools([]);
      setFirebaseSchools(null);
      return;
    }

    // Load static schools.json
    fetch('/data/schools.json')
      .then(r => r.json())
      .then(data => {
        const cityKey = Object.keys(data).find(
          k => k.toLocaleUpperCase('tr-TR') === selectedIl.toLocaleUpperCase('tr-TR')
        );
        if (cityKey) {
          const distKey = Object.keys(data[cityKey]).find(
            k => k.toLocaleUpperCase('tr-TR') === selectedIlce.toLocaleUpperCase('tr-TR')
          );
          setStaticSchools(distKey ? data[cityKey][distKey] : []);
        } else {
          setStaticSchools([]);
        }
      })
      .catch(() => setStaticSchools([]));

    // Load Firebase (keys are UPPERCASE in Firebase, e.g. ADANA/ALADAĞ)
    const fbIl = selectedIl.toLocaleUpperCase('tr-TR');
    const fbIlce = selectedIlce.toLocaleUpperCase('tr-TR');
    setLoadingFirebase(true);
    get(ref(db, `okullar/${fbIl}/${fbIlce}`))
      .then(snap => setFirebaseSchools(snap.exists() ? snap.val() : null))
      .catch(() => setFirebaseSchools(null))
      .finally(() => setLoadingFirebase(false));
  }, [selectedIl, selectedIlce]);

  // Active schools: Firebase takes priority over static
  const filteredSchools = useMemo(() => {
    const active = firebaseSchools !== null ? firebaseSchools : staticSchools;
    if (!searchTerm) return active.map((name, idx) => ({ name, idx }));
    const term = searchTerm.toLocaleUpperCase('tr-TR');
    return active.map((name, idx) => ({ name, idx })).filter(({ name }) =>
      name.toLocaleUpperCase('tr-TR').includes(term)
    );
  }, [firebaseSchools, staticSchools, searchTerm]);

  // Bulk import: all schools.json → Firebase
  const handleBulkImport = async () => {
    setImporting(true);
    setImportProgress(0);
    try {
      const res = await fetch('/data/schools.json');
      const data = await res.json();
      const cities = Object.keys(data);
      for (let i = 0; i < cities.length; i++) {
        const city = cities[i];
        const cityData = data[city];
        const cityUpdates = {};
        Object.entries(cityData).forEach(([district, schools]) => {
          cityUpdates[`okullar/${city}/${district}`] = schools;
        });
        await update(ref(db), cityUpdates);
        setImportProgress(Math.round(((i + 1) / cities.length) * 100));
        setImportStatus(`${i + 1}/${cities.length} il işlendi: ${city}`);
      }
      setImportStatus("Tüm okullar başarıyla Firebase'e aktarıldı!");
      // Reload Firebase for current selection
      if (selectedIl && selectedIlce) {
        const snap = await get(ref(db, `okullar/${selectedIl.toLocaleUpperCase('tr-TR')}/${selectedIlce.toLocaleUpperCase('tr-TR')}`));
        setFirebaseSchools(snap.exists() ? snap.val() : null);
      }
    } catch (err) {
      setImportStatus('Aktarım sırasında hata: ' + err.message);
    } finally {
      setImporting(false);
    }
  };

  // Import single il/ilce from static to Firebase
  const handleImportCurrentDistrict = async () => {
    if (!selectedIl || !selectedIlce || staticSchools.length === 0) return;
    try {
      await set(ref(db, `okullar/${selectedIl.toLocaleUpperCase('tr-TR')}/${selectedIlce.toLocaleUpperCase('tr-TR')}`), staticSchools);
      setFirebaseSchools([...staticSchools]);
      toast(`${staticSchools.length} okul Firebase'e aktarıldı.`, 'success');
    } catch (err) {
      toast('Aktarım hatası: ' + err.message, 'error');
    }
  };

  // Add or edit school
  const saveSchool = async () => {
    const name = schoolInput.trim().toLocaleUpperCase('tr-TR');
    if (!name) return;
    const current = firebaseSchools !== null ? [...firebaseSchools] : [...staticSchools];
    if (editingSchool !== null) {
      current[editingSchool.index] = name;
    } else {
      if (current.includes(name)) {
        toast('Bu okul zaten listede var.', 'warning');
        return;
      }
      current.push(name);
      current.sort((a, b) => a.localeCompare(b, 'tr-TR'));
    }
    setSaving(true);
    try {
      await set(ref(db, `okullar/${selectedIl.toLocaleUpperCase('tr-TR')}/${selectedIlce.toLocaleUpperCase('tr-TR')}`), current);
      setFirebaseSchools(current);
      setAddModalOpen(false);
      setEditingSchool(null);
      setSchoolInput('');
      toast(editingSchool !== null ? 'Okul güncellendi.' : 'Okul eklendi.', 'success');
    } catch (err) {
      toast('Kayıt hatası: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Delete school
  const deleteSchool = async (index) => {
    const confirmed = await confirm('Bu okulu silmek istediğinize emin misiniz?', {
      title: 'Silme Onayı',
      type: 'danger',
    });
    if (!confirmed) return;
    const current = firebaseSchools !== null ? [...firebaseSchools] : [...staticSchools];
    current.splice(index, 1);
    try {
      await set(ref(db, `okullar/${selectedIl.toLocaleUpperCase('tr-TR')}/${selectedIlce.toLocaleUpperCase('tr-TR')}`), current);
      setFirebaseSchools(current);
      toast('Okul silindi.', 'success');
    } catch (err) {
      toast('Silme hatası: ' + err.message, 'error');
    }
  };

  const activeCount = firebaseSchools !== null ? firebaseSchools.length : staticSchools.length;

  return (
    <div className="schools-page">
      <header className="page-header">
        <div className="page-header__left">
          <button className="back-btn" onClick={() => navigate(-1)}>
            <i className="material-icons-round">arrow_back</i>
          </button>
          <div>
            <h1>Okul Yönetimi</h1>
            <p className="page-subtitle">MEB kayıtlı okul listesi · Firebase yönetimi</p>
          </div>
        </div>
        <div className="page-header__right">
          <button
            className="action-btn-outline"
            style={{ borderColor: '#D97706', color: '#D97706' }}
            onClick={() => setImportOpen(true)}
          >
            <i className="material-icons-round">upload_file</i>
            <span>JSON'dan Firebase'e Aktar</span>
          </button>
          <button
            className="create-btn"
            onClick={() => {
              setAddModalOpen(true);
              setEditingSchool(null);
              setSchoolInput('');
            }}
            disabled={!selectedIl || !selectedIlce}
          >
            <i className="material-icons-round">add</i>
            <span>Okul Ekle</span>
          </button>
        </div>
      </header>

      {/* MEBBİS Senkronizasyon Paneli */}
      <div className="mebbis-sync-panel">
        <div className="mebbis-sync-panel__left">
          <div className="mebbis-sync-panel__icon">
            <i className="material-icons-round">sync</i>
          </div>
          <div>
            <div className="mebbis-sync-panel__title">MEBBİS Senkronizasyonu</div>
            <div className="mebbis-sync-panel__sub">
              {syncMeta ? (
                <>
                  <span>
                    Son güncelleme:{' '}
                    <strong>
                      {new Date(syncMeta.tarih).toLocaleString('tr-TR')}
                    </strong>
                  </span>
                  <span className="mebbis-sync-dot">·</span>
                  <span>{syncMeta.toplamOkul?.toLocaleString('tr-TR')} okul</span>
                  <span className="mebbis-sync-dot">·</span>
                  <span
                    className={`mebbis-sync-status mebbis-sync-status--${
                      syncMeta.durum === 'tamamlandi' ? 'ok' : 'warn'
                    }`}
                  >
                    {syncMeta.durum === 'tamamlandi'
                      ? '✓ Başarılı'
                      : '⚠ Hatalarla tamamlandı'}
                  </span>
                </>
              ) : (
                <span>Henüz MEBBİS'ten güncelleme yapılmamış</span>
              )}
              {syncError && (
                <span className="mebbis-sync-status mebbis-sync-status--warn">
                  {syncError}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="mebbis-sync-panel__right">
          {selectedIl && (
            <button
              className="mebbis-sync-btn mebbis-sync-btn--secondary"
              onClick={() => handleMebbisSync({ il: selectedIl })}
              disabled={syncing}
              title={`Sadece ${selectedIl} ili için MEBBİS'ten güncelle`}
            >
              <i className="material-icons-round">place</i>
              <span>{selectedIl} İlini Güncelle</span>
            </button>
          )}
          <button
            className="mebbis-sync-btn mebbis-sync-btn--primary"
            onClick={() => handleMebbisSync()}
            disabled={syncing}
            title="Tüm Türkiye okullarını MEBBİS'ten çekerek Firebase'e yaz"
          >
            {syncing ? (
              <>
                <span className="spinner-small" style={{ marginRight: 6 }}></span>
                Başlatılıyor...
              </>
            ) : (
              <>
                <i className="material-icons-round">cloud_sync</i>
                <span>MEBBİS'ten Güncelle</span>
              </>
            )}
          </button>
        </div>
      </div>

      <main className="page-content">
        {/* Controls */}
        <div className="schools-controls">
          <select
            value={selectedIl}
            onChange={e => {
              setSelectedIl(e.target.value);
              setSelectedIlce('');
              setSearchTerm('');
            }}
          >
            <option value="">-- İl Seçiniz --</option>
            {Object.keys(turkeyData).sort().map(il => (
              <option key={il} value={il}>{il}</option>
            ))}
          </select>

          <select
            value={selectedIlce}
            onChange={e => {
              setSelectedIlce(e.target.value);
              setSearchTerm('');
            }}
            disabled={!selectedIl}
          >
            <option value="">-- İlçe Seçiniz --</option>
            {selectedIl && (Array.isArray(turkeyData[selectedIl])
              ? turkeyData[selectedIl]
              : Object.keys(turkeyData[selectedIl] || {})
            ).sort((a, b) => a.localeCompare(b, 'tr-TR')).map(ilce => (
              <option key={ilce} value={ilce}>{ilce}</option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Okul ara..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            disabled={!selectedIlce}
            className="school-search-input"
          />
        </div>

        {/* Stats / Status bar */}
        {selectedIlce && (
          <div className="schools-status-bar">
            <div className="schools-stat">
              <i className="material-icons-round">domain</i>
              <span>Statik: <strong>{staticSchools.length}</strong> okul</span>
            </div>
            <div className="schools-stat">
              <i className="material-icons-round">cloud</i>
              <span>Firebase: <strong>{firebaseSchools !== null ? firebaseSchools.length : '—'}</strong> okul</span>
            </div>
            {firebaseSchools !== null ? (
              <span className="schools-source-badge schools-source-badge--firebase">
                <i className="material-icons-round">cloud_done</i> Firebase verileri kullanılıyor
              </span>
            ) : (
              <>
                <span className="schools-source-badge schools-source-badge--static">
                  <i className="material-icons-round">storage</i> Statik veri kullanılıyor
                </span>
                {staticSchools.length > 0 && (
                  <button className="schools-import-district-btn" onClick={handleImportCurrentDistrict}>
                    <i className="material-icons-round">upload</i> Firebase'e Aktar
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* School list */}
        {!selectedIl ? (
          <div className="schools-empty">
            <i className="material-icons-round">location_city</i>
            <p>Başlamak için bir il seçin.</p>
          </div>
        ) : !selectedIlce ? (
          <div className="schools-empty">
            <i className="material-icons-round">map</i>
            <p>İlçe seçin.</p>
          </div>
        ) : loadingFirebase ? (
          <div className="schools-loading">
            <div className="spinner"></div>
            <p>Yükleniyor...</p>
          </div>
        ) : filteredSchools.length === 0 ? (
          <div className="schools-empty">
            <i className="material-icons-round">search_off</i>
            <p>{searchTerm ? 'Arama sonucu bulunamadı.' : 'Bu ilçede kayıtlı okul yok.'}</p>
          </div>
        ) : (
          <div className="schools-list">
            <div className="schools-list-header">
              <span>
                {filteredSchools.length} okul {searchTerm ? '(filtrelendi)' : ''}
              </span>
            </div>
            {filteredSchools.map(({ name, idx }) => (
              <div key={idx} className="school-row">
                <i className="material-icons-round school-row__icon">school</i>
                <span className="school-row__name">{name}</span>
                <div className="school-row__actions">
                  <button
                    className="school-row__btn school-row__btn--edit"
                    onClick={() => {
                      setEditingSchool({ index: idx, name });
                      setSchoolInput(name);
                      setAddModalOpen(true);
                    }}
                    title="Düzenle"
                  >
                    <i className="material-icons-round">edit</i>
                  </button>
                  <button
                    className="school-row__btn school-row__btn--delete"
                    onClick={() => deleteSchool(idx)}
                    title="Sil"
                  >
                    <i className="material-icons-round">delete</i>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Bulk Import Modal */}
      {importOpen && (
        <div className="modal-overlay" onClick={() => !importing && setImportOpen(false)}>
          <div className="modal modal--medium" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2>
                <i className="material-icons-round" style={{ verticalAlign: 'middle', marginRight: 8, color: '#D97706' }}>
                  upload_file
                </i>
                JSON'dan Firebase'e Aktar
              </h2>
              <button className="modal__close" onClick={() => setImportOpen(false)} disabled={importing}>
                <i className="material-icons-round">close</i>
              </button>
            </div>
            <div className="modal__body" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                <strong>schools.json</strong> dosyasındaki tüm okullar Firebase RTDB'ye aktarılacak.<br />
                Bu işlem birkaç dakika sürebilir ve mevcut Firebase verilerinin üzerine yazar.
              </p>
              {importing ? (
                <>
                  <div className="schools-import-progress">
                    <div className="schools-import-progress-bar" style={{ width: importProgress + '%' }}></div>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{importStatus}</p>
                </>
              ) : importStatus ? (
                <p style={{
                  margin: 0,
                  fontSize: '0.9rem',
                  color: importStatus.includes('hata') ? '#DC2626' : '#16A34A',
                  fontWeight: 600
                }}>
                  {importStatus}
                </p>
              ) : null}
            </div>
            <div className="modal__footer">
              <button className="btn btn--secondary" onClick={() => setImportOpen(false)} disabled={importing}>
                Kapat
              </button>
              <button
                className="btn btn--primary"
                style={{ background: '#D97706', borderColor: '#D97706' }}
                onClick={handleBulkImport}
                disabled={importing}
              >
                {importing ? (
                  <>
                    <span className="spinner-small" style={{ marginRight: 8 }}></span>
                    Aktarılıyor... {importProgress}%
                  </>
                ) : (
                  <>
                    <i className="material-icons-round" style={{ marginRight: 6 }}>upload_file</i>
                    Aktar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      {addModalOpen && (
        <div className="modal-overlay" onClick={() => setAddModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2>{editingSchool !== null ? 'Okul Düzenle' : 'Okul Ekle'}</h2>
              <button className="modal__close" onClick={() => setAddModalOpen(false)}>
                <i className="material-icons-round">close</i>
              </button>
            </div>
            <div className="modal__body" style={{ padding: '1.5rem' }}>
              <div className="form-group">
                <label>Okul Adı</label>
                <input
                  type="text"
                  value={schoolInput}
                  onChange={e => setSchoolInput(e.target.value)}
                  placeholder="Okul adını giriniz..."
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && saveSchool()}
                />
                <p className="help-text" style={{ marginTop: 6 }}>
                  Kayıt büyük harfe çevrilecek. Örn: ATATÜRK İLKOKULU
                </p>
              </div>
            </div>
            <div className="modal__footer">
              <button className="btn btn--secondary" onClick={() => setAddModalOpen(false)}>
                İptal
              </button>
              <button
                className="btn btn--primary"
                onClick={saveSchool}
                disabled={saving || !schoolInput.trim()}
              >
                {saving ? 'Kaydediliyor...' : editingSchool !== null ? 'Güncelle' : 'Ekle'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
