import fs from 'fs';

const file = 'src/pages/AnalyticsPage.jsx';
let content = fs.readFileSync(file, 'utf8');

// Replace all ResponsiveContainer occurrences
// For Pie charts (height 220), we use 300 width
// For Bar/Scatter charts, we use 700 width

let count = 0;
content = content.replace(/<ResponsiveContainer\s+width="100%"\s+height={(\d+)}>/g, (match, h) => {
    count++;
    const height = parseInt(h);
    const printWidth = (height <= 220 && count <= 2) ? 400 : 700; 
    return `<ResponsiveContainer width={isPrintingFullReport ? ${printWidth} : "100%"} height={${height}}>`;
});

fs.writeFileSync(file, content, 'utf8');
console.log(`Replaced ${count} occurrences.`);
