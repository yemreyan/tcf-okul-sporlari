import fs from 'fs';

const file = 'src/pages/AnalyticsPage.jsx';
let content = fs.readFileSync(file, 'utf8');

const oldLogic = `                                const hakemVal = catHakemler[jKey];
                                let refName = null;
                                if (hakemVal) {
                                    if (typeof hakemVal === 'object' && hakemVal.name) {
                                        refName = hakemVal.name;
                                    } else if (typeof hakemVal === 'string') {
                                        if (refereesData[hakemVal] && (refereesData[hakemVal].isim || refereesData[hakemVal].ad)) {
                                            const rName = refereesData[hakemVal].isim || refereesData[hakemVal].ad;
                                            const rSurname = refereesData[hakemVal].soyisim || refereesData[hakemVal].soyad || "";
                                            refName = \`\${rName} \${rSurname}\`.trim();
                                        } else {
                                            refName = hakemVal; // Fallback to raw string
                                        }
                                    }
                                }
                                const displayName = refName || \`\${jKey.toUpperCase()} (İsimsiz)\`;`;

const newLogic = `                                // Robust hakemVal lookup
                                const hakemVal = catHakemler[jKey] || catHakemler[jKey.toLowerCase()] || catHakemler[jKey.toUpperCase()];
                                let refName = null;
                                if (hakemVal) {
                                    if (typeof hakemVal === 'object' && hakemVal.name) {
                                        refName = hakemVal.name;
                                    } else if (typeof hakemVal === 'string') {
                                        const refObj = refereesData[hakemVal] || Object.values(refereesData).find(r => r.id === hakemVal);
                                        if (refObj) {
                                            const rName = refObj.adSoyad || refObj.isim || refObj.ad;
                                            const rSurname = refObj.soyisim || refObj.soyad || "";
                                            refName = rSurname ? \`\${rName} \${rSurname}\`.trim() : (rName || hakemVal);
                                        } else {
                                            refName = hakemVal; // Fallback to raw string
                                        }
                                    }
                                }
                                
                                // Fallback mapping in case catId or appId slightly mismatch in legacy data
                                if (!refName) {
                                    // Try to search entire hakemler object for this jKey
                                    for (const cId of Object.keys(hakemler)) {
                                        for (const aId of Object.keys(hakemler[cId])) {
                                            const pVal = hakemler[cId][aId][jKey] || hakemler[cId][aId][jKey.toLowerCase()];
                                            if (pVal) {
                                                if (typeof pVal === 'object' && pVal.name) {
                                                    refName = pVal.name; break;
                                                } else if (typeof pVal === 'string') {
                                                    const rObj = refereesData[pVal];
                                                    if (rObj) refName = rObj.adSoyad || rObj.isim || rObj.ad;
                                                    else refName = pVal;
                                                    break;
                                                }
                                            }
                                        }
                                        if (refName) break;
                                    }
                                }

                                const displayName = refName || \`\${jKey.toUpperCase()} (İsimsiz)\`;`;

content = content.replace(oldLogic, newLogic);
fs.writeFileSync(file, content, 'utf8');
console.log('Replaced referee resolution logic.');
