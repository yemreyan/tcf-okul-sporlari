import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, update } from 'firebase/database';
import { db } from '../lib/firebase';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import './StartOrderPage.css';

export default function StartOrderPage() {
    const navigate = useNavigate();
    const [competitions, setCompetitions] = useState({});
    const [selectedCompId, setSelectedCompId] = useState('');
    const [filterCategory, setFilterCategory] = useState('');

    // State
    const [rotations, setRotations] = useState([[], [], [], [], [], []]); // Supporting up to 6 groups
    const [unassigned, setUnassigned] = useState([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // Initial load
    useEffect(() => {
        const compsRef = ref(db, 'competitions');
        const unsubscribe = onValue(compsRef, (snap) => {
            const data = snap.val() || {};
            setCompetitions(data);
        });
        return () => unsubscribe();
    }, []);

    // Load data when selections change
    useEffect(() => {
        if (!selectedCompId || !filterCategory) {
            setUnassigned([]);
            setRotations([[], [], [], [], [], []]);
            return;
        }

        setLoading(true);
        const athletesRef = ref(db, `competitions/${selectedCompId}/sporcular/${filterCategory}`);

        const unsubscribeAthletes = onValue(athletesRef, (snapshot) => {
            const data = snapshot.val();
            const loadedAthletes = [];

            if (data) {
                Object.keys(data).forEach(athId => {
                    loadedAthletes.push({
                        id: athId,
                        categoryId: filterCategory,
                        ...data[athId]
                    });
                });
            }

            const orderRef = ref(db, `competitions/${selectedCompId}/siralama/${filterCategory}`);
            onValue(orderRef, (orderSnap) => {
                const orderData = orderSnap.val();
                let currentRotations = [[], [], [], [], [], []];
                let currentUnassigned = [...loadedAthletes];

                if (orderData) {
                    Object.keys(orderData).forEach(rotKey => {
                        const rotIndex = parseInt(rotKey.replace('rotation_', ''));
                        if (!isNaN(rotIndex) && rotIndex < 6) {
                            const athletesInRot = orderData[rotKey];
                            const sortedAthletes = Object.keys(athletesInRot).map(id => {
                                const athDetails = loadedAthletes.find(a => a.id === id);
                                return athDetails ? { ...athDetails, sirasi: athletesInRot[id].sirasi } : null;
                            }).filter(a => a !== null).sort((a, b) => a.sirasi - b.sirasi);

                            currentRotations[rotIndex] = sortedAthletes;
                            sortedAthletes.forEach(a => {
                                currentUnassigned = currentUnassigned.filter(ua => ua.id !== a.id);
                            });
                        }
                    });
                }

                currentUnassigned.sort((a, b) => `${a.ad} ${a.soyad}`.localeCompare(`${b.ad} ${b.soyad}`));
                setRotations(currentRotations);
                setUnassigned(currentUnassigned);
                setLoading(false);
            }, { onlyOnce: true });
        });

        return () => unsubscribeAthletes();
    }, [selectedCompId, filterCategory]);

    // -- Random Assignment Logic --
    const handleRandomAssign = () => {
        if (!selectedCompId || !filterCategory) return;
        if (rotations.some(r => r.length > 0)) {
            if (!window.confirm("Mevcut atanmış grupların üzerine yazılacak. Emin misiniz?")) return;
        }

        // Combine all athletes
        const allAthletes = [...unassigned, ...rotations.flat()];

        // 1. Separate Teams from Individuals based on yarismaTuru
        const teamsMap = {}; // { 'Okul Adi': [Athletes] }
        const individuals = [];

        allAthletes.forEach(ath => {
            const type = (ath.yarismaTuru || 'ferdi').toLowerCase();
            if (type === 'takim' || type === 'takım') {
                const school = ath.okul || 'Bilinmeyen Takım';
                if (!teamsMap[school]) teamsMap[school] = [];
                teamsMap[school].push(ath);
            } else {
                individuals.push(ath);
            }
        });

        // Convert teamsMap to array and shuffle
        const teamsList = Object.values(teamsMap);
        shuffleArray(teamsList);
        shuffleArray(individuals);

        // Prepare new 6 empty groups
        const newRotations = [[], [], [], [], [], []];

        // Helper to find the group with the minimum number of athletes currently
        const getGroupWithMinAthletes = () => {
            let minIndex = 0;
            let minCount = newRotations[0].length;
            for (let i = 1; i < newRotations.length; i++) {
                if (newRotations[i].length < minCount) {
                    minCount = newRotations[i].length;
                    minIndex = i;
                }
            }
            return minIndex;
        };

        // 2. Distribute Teams first. Entire team goes to the same group.
        teamsList.forEach(teamMembers => {
            const targetGroupIndex = getGroupWithMinAthletes();
            newRotations[targetGroupIndex].push(...teamMembers);
        });

        // 3. Distribute Individuals evenly
        individuals.forEach(individual => {
            const targetGroupIndex = getGroupWithMinAthletes();
            newRotations[targetGroupIndex].push(individual);
        });

        setUnassigned([]);
        setRotations(newRotations);
    };

    // Fisher-Yates shuffle
    const shuffleArray = (array) => {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    };

    // -- Drag and Drop Logic --
    const [draggedItem, setDraggedItem] = useState(null);

    const handleDragStart = (e, athlete, sourceMap) => {
        setDraggedItem({ athlete, sourceMap });
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e, targetMap, targetIndex = null) => {
        e.preventDefault();
        if (!draggedItem) return;

        const { athlete, sourceMap } = draggedItem;

        if (sourceMap === targetMap && targetIndex !== null) {
            const list = Array.isArray(targetMap) ? targetMap : (targetMap === 'unassigned' ? unassigned : rotations[targetMap]);
            const currentIndex = list.findIndex(a => a.id === athlete.id);
            if (currentIndex === targetIndex) return;
        }

        let newUnassigned = [...unassigned];
        let newRotations = [...rotations.map(r => [...r])];

        if (sourceMap === 'unassigned') {
            newUnassigned = newUnassigned.filter(a => a.id !== athlete.id);
        } else {
            newRotations[sourceMap] = newRotations[sourceMap].filter(a => a.id !== athlete.id);
        }

        if (targetMap === 'unassigned') {
            newUnassigned.push(athlete);
            newUnassigned.sort((a, b) => `${a.ad} ${a.soyad}`.localeCompare(`${b.ad} ${b.soyad}`));
        } else {
            if (targetIndex !== null) {
                newRotations[targetMap].splice(targetIndex, 0, athlete);
            } else {
                newRotations[targetMap].push(athlete);
            }
        }

        setUnassigned(newUnassigned);
        setRotations(newRotations);
        setDraggedItem(null);
    };

    // -- Save & Export --
    const handleSave = async () => {
        if (!selectedCompId || !filterCategory) return alert("Kategori seçilmelidir.");
        setSaving(true);

        // Instead of setting parent to null and updating children, we build the entire object
        const siralamaData = {};

        rotations.forEach((rotation, rotIndex) => {
            if (rotation.length > 0) {
                const rotationObj = {};
                rotation.forEach((ath, athIndex) => {
                    rotationObj[ath.id] = {
                        sirasi: athIndex + 1,
                        ad: ath.ad,
                        soyad: ath.soyad,
                        tckn: ath.tckn || '',
                        okul: ath.okul || '',
                        yarismaTuru: ath.yarismaTuru || 'ferdi'
                    };
                });
                siralamaData[`rotation_${rotIndex}`] = rotationObj;
            }
        });

        const updates = {};
        // Replace the entire node with the newly built structure
        updates[`competitions/${selectedCompId}/siralama/${filterCategory}`] = Object.keys(siralamaData).length > 0 ? siralamaData : null;

        try {
            await update(ref(db), updates);
            alert("Çıkış sırası başarıyla kaydedildi.");
        } catch (err) {
            console.error(err);
            alert("Kaydetme işlemi başarısız.");
        } finally {
            setSaving(false);
        }
    };

    const handleExportPDF = () => {
        if (!selectedCompId || !filterCategory) return alert("Dışa aktarmak için kategori seçiniz.");
        const doc = new jsPDF();
        const compName = competitions[selectedCompId]?.isim || 'Yarışma';

        doc.setFontSize(16);
        doc.text("Çıkış Sırası Listesi", 14, 15);

        doc.setFontSize(11);
        doc.text(`Yarışma: ${compName}`, 14, 23);
        doc.text(`Kategori: ${filterCategory}`, 14, 29);

        let startY = 35;

        rotations.forEach((rotation, index) => {
            if (rotation.length === 0) return;

            doc.setFontSize(12);
            doc.text(`Grup ${index + 1}`, 14, startY);

            const tableData = rotation.map((ath, idx) => [
                (idx + 1).toString(),
                `${ath.ad} ${ath.soyad}`,
                ath.okul || '-',
                (ath.yarismaTuru || 'ferdi').toUpperCase()
            ]);

            autoTable(doc, {
                startY: startY + 5,
                head: [['Sıra', 'Sporcu Adı', 'Okul/Kulüp', 'Türü']],
                body: tableData,
                theme: 'striped',
                headStyles: { fillColor: [79, 70, 229] },
                margin: { left: 14 }
            });

            startY = doc.lastAutoTable.finalY + 15;

            // Handle page breaks if content gets too long
            if (startY > doc.internal.pageSize.getHeight() - 20) {
                doc.addPage();
                startY = 15;
            }
        });

        doc.save(`${compName}_${filterCategory}_Cikis_Sirasi.pdf`);
    };


    const compOptions = Object.entries(competitions).sort((a, b) => new Date(b[1].tarih) - new Date(a[1].tarih));
    let uniqueCategories = [];
    if (selectedCompId && competitions[selectedCompId]?.sporcular) {
        uniqueCategories = Object.keys(competitions[selectedCompId].sporcular);
    }

    return (
        <div className="order-page">
            <header className="page-header--bento">
                <div className="page-header__left">
                    <button className="back-btn back-btn--light" onClick={() => navigate('/')}>
                        <i className="material-icons-round">arrow_back</i>
                    </button>
                    <div className="header-title-wrapper">
                        <h1 className="page-title text-white">Çıkış Sırası & Gruplama</h1>
                        <p className="page-subtitle text-white-50">Sporcuları takımlara öncelik vererek gruplara dağıtın veya manuel sürükleyin.</p>
                    </div>
                </div>
                <div className="page-header__right flex-gap">
                    <button className="btn-bento-secondary" onClick={handleExportPDF} title="PDF İndir">
                        <i className="material-icons-round">picture_as_pdf</i>
                        <span>PDF Çıktısı</span>
                    </button>
                    <button
                        className="btn-bento-primary shadow-lg"
                        onClick={handleSave}
                        disabled={saving || !selectedCompId || !filterCategory}
                    >
                        {saving ? <div className="spinner-small"></div> : <i className="material-icons-round">save</i>}
                        <span>Kaydet</span>
                    </button>
                </div>
            </header>

            <main className="bento-content">
                <div className="bento-controls">
                    <div className="bento-control-group">
                        <i className="material-icons-round">emoji_events</i>
                        <select
                            className="bento-select"
                            value={selectedCompId}
                            onChange={(e) => { setSelectedCompId(e.target.value); setFilterCategory(''); }}
                        >
                            <option value="">-- Yarışma Seçiniz --</option>
                            {compOptions.map(([id, comp]) => <option key={id} value={id}>{comp.isim}</option>)}
                        </select>
                    </div>

                    <div className="bento-control-group">
                        <i className="material-icons-round">category</i>
                        <select
                            className="bento-select"
                            value={filterCategory}
                            onChange={(e) => setFilterCategory(e.target.value)}
                            disabled={!selectedCompId || uniqueCategories.length === 0}
                        >
                            <option value="">-- Kategori Seçiniz --</option>
                            {uniqueCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                    </div>

                    <button
                        className="btn-random-assign"
                        onClick={handleRandomAssign}
                        disabled={!selectedCompId || !filterCategory}
                    >
                        <i className="material-icons-round">auto_awesome</i>
                        Rastgele Atama Yap
                    </button>
                </div>

                {loading ? (
                    <div className="loading-state">
                        <div className="spinner"></div><p>Veriler yükleniyor...</p>
                    </div>
                ) : (!selectedCompId || !filterCategory) ? (
                    <div className="empty-state">
                        <div className="empty-state__icon"><i className="material-icons-round">groups</i></div>
                        <p>Başlamak için lütfen yarışma ve kategori seçin.</p>
                    </div>
                ) : (
                    <div className="order-workspace">
                        <div className="order-panel unassigned-pool">
                            <div className="panel-header">
                                <h2>
                                    <i className="material-icons-round">person_off</i>
                                    Boştaki Sporcular <span className="count-badge">{unassigned.length}</span>
                                </h2>
                            </div>
                            <div className="pool-container" onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, 'unassigned')}>
                                {unassigned.length === 0 ? <div className="pool-empty">Tüm sporcular atandı 🎉</div> : (
                                    <div className="athlete-list">
                                        {unassigned.map(ath => (
                                            <div key={ath.id} className="order-athlete-card" draggable onDragStart={(e) => handleDragStart(e, ath, 'unassigned')}>
                                                <i className="material-icons-round drag-handle">drag_indicator</i>
                                                <div className="ath-info">
                                                    <strong>{ath.ad} {ath.soyad}</strong>
                                                    <small>{ath.okul || 'Okul Yok'} <span className={`type-badge ${(ath.yarismaTuru || 'ferdi').toLowerCase()}`}>{ath.yarismaTuru || 'Ferdi'}</span></small>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="rotations-grid">
                            {rotations.map((rotation, index) => (
                                <div key={index} className="rotation-card" onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, index)}>
                                    <div className="rotation-header">
                                        <h3>Grup {index + 1}</h3>
                                        <span className="count-badge">{rotation.length}</span>
                                    </div>
                                    <div className="rotation-list">
                                        {rotation.length === 0 ? <div className="pool-empty">Boş Grup</div> : (
                                            rotation.map((ath, athIndex) => (
                                                <div key={ath.id} className="order-athlete-card assigned" draggable onDragStart={(e) => handleDragStart(e, ath, index)} onDragOver={handleDragOver} onDrop={(e) => { e.stopPropagation(); handleDrop(e, index, athIndex); }}>
                                                    <div className="order-number">{athIndex + 1}</div>
                                                    <div className="ath-info">
                                                        <strong>{ath.ad} {ath.soyad}</strong>
                                                        <small>{ath.okul ? ath.okul.substring(0, 15) + '...' : ''} <span className={`type-badge ${(ath.yarismaTuru || 'ferdi').toLowerCase()}`}>{ath.yarismaTuru || 'Ferdi'}</span></small>
                                                    </div>
                                                    <i className="material-icons-round drag-handle">drag_indicator</i>
                                                </div>
                                            ))
                                        )}
                                        <div className="drop-zone-end" onDragOver={handleDragOver} onDrop={(e) => { e.stopPropagation(); handleDrop(e, index); }}></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
