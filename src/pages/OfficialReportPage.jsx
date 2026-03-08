import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { ref, onValue, set, get } from 'firebase/database';
import './OfficialReportPage.css';

const OfficialReportPage = () => {
    const [competitions, setCompetitions] = useState([]);
    const [selectedCompId, setSelectedCompId] = useState('');
    const [reportData, setReportData] = useState({
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
    });

    useEffect(() => {
        const compRef = ref(db, 'competitions');
        onValue(compRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                const list = Object.entries(data).map(([id, val]) => ({ id, ...val }));
                setCompetitions(list.sort((a, b) => new Date(b.tarih) - new Date(a.tarih)));
            }
        });
    }, []);

    const handleCompChange = async (e) => {
        const compId = e.target.value;
        setSelectedCompId(compId);
        if (compId) {
            const snap = await get(ref(db, `reports/${compId}`));
            if (snap.exists()) {
                setReportData(snap.val());
            } else {
                const comp = competitions.find(c => c.id === compId);
                setReportData({
                    ...reportData,
                    baslik: comp.isim,
                    tarih: comp.tarih,
                    yer: comp.sehir || ''
                });
            }
        }
    };

    const handleSave = () => {
        if (!selectedCompId) return;
        set(ref(db, `reports/${selectedCompId}`), reportData);
        alert('Rapor kaydedildi.');
    };

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="report-container">
            <div className="report-sidebar no-print">
                <h2>Resmi Yarışma Raporu</h2>
                <div className="form-group">
                    <label>Yarışma Seçin</label>
                    <select value={selectedCompId} onChange={handleCompChange}>
                        <option value="">Seçiniz...</option>
                        {competitions.map(c => <option key={c.id} value={c.id}>{c.isim}</option>)}
                    </select>
                </div>

                {selectedCompId && (
                    <>
                        <div className="form-group">
                            <label>Gözlemci</label>
                            <input type="text" value={reportData.gozlemci} onChange={e => setReportData({ ...reportData, gozlemci: e.target.value })} />
                        </div>
                        <div className="form-group">
                            <label>Baş Hakem</label>
                            <input type="text" value={reportData.basHakem} onChange={e => setReportData({ ...reportData, basHakem: e.target.value })} />
                        </div>
                        <div className="form-group">
                            <label>Önemli Olaylar</label>
                            <textarea value={reportData.olaylar} onChange={e => setReportData({ ...reportData, olaylar: e.target.value })} />
                        </div>
                        <div className="action-buttons">
                            <button className="btn-save" onClick={handleSave}>Kaydet</button>
                            <button className="btn-print" onClick={handlePrint}>Yazdır (A4)</button>
                        </div>
                    </>
                )}
            </div>

            <div className="report-preview-canvas">
                <div className="a4-page">
                    <div className="report-header">
                        <img src="/logo.png" alt="TCF Logo" className="report-logo" />
                        <div className="header-text">
                            <h3>TÜRKİYE CİMNASTİK FEDERASYONU</h3>
                            <h4>YARIŞMA SONUÇ VE GÖZLEMCİ RAPORU</h4>
                        </div>
                    </div>

                    <div className="report-section">
                        <table>
                            <tbody>
                                <tr>
                                    <td className="label">Yarışma Adı:</td>
                                    <td className="val">{reportData.baslik}</td>
                                </tr>
                                <tr>
                                    <td className="label">Tarih / Yer:</td>
                                    <td className="val">{reportData.tarih} / {reportData.yer}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div className="report-section">
                        <h5>TEKNİK BİLGİLER</h5>
                        <p><strong>Gözlemci / Temsilci:</strong> {reportData.gozlemci}</p>
                        <p><strong>Baş Hakem:</strong> {reportData.basHakem}</p>
                    </div>

                    <div className="report-section">
                        <h5>TESİS VE ORGANİZASYON</h5>
                        <p>Tesisin yarışmaya uygunluğu: {reportData.tesisDurumu}</p>
                        <p>Sağlık ve Emniyet Tedbirleri: {reportData.saglikOnlemleri}</p>
                    </div>

                    <div className="report-section">
                        <h5>MÜSABAKA NOTLARI VE OLAYLAR</h5>
                        <div className="notes-box">{reportData.olaylar || 'Herhangi bir olumsuzluk yaşanmamıştır.'}</div>
                    </div>

                    <div className="report-footer">
                        <div className="sign-box">
                            <p>Yarışma Gözlemcisi</p>
                            <br /><br />
                            <p>İmza</p>
                        </div>
                        <div className="sign-box">
                            <p>Baş Hakem</p>
                            <br /><br />
                            <p>İmza</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OfficialReportPage;
