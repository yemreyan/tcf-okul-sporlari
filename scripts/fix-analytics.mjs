import fs from 'fs';

const file = 'src/pages/AnalyticsPage.jsx';
let content = fs.readFileSync(file, 'utf8');

// Fix compsData missing ID
content = content.replace(
    /const compsData = selectedComps\.length > 0\s*\n\s*\? selectedComps\.map\(id => filteredComps\[id\]\)\.filter\(Boolean\)\s*\n\s*: Object\.values\(filteredComps\);/g,
    `const compsData = selectedComps.length > 0 
            ? selectedComps.map(id => ({ id, ...filteredComps[id] })).filter(c => c.id)
            : Object.entries(filteredComps).map(([id, comp]) => ({ id, ...comp }));`
);

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed compsData id injection.');
