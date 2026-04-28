import fs from 'fs';

const file = 'src/basvuru-app.js';
let content = fs.readFileSync(file, 'utf8');

const oldLogic = `function updateActiveBranches() {
  const city = document.getElementById('citySelect').value;
  const branchSelect = document.getElementById('branchSelect');
  const currentBranch = branchSelect.value;
  const availableBranches = getAvailablePublicBranchOptions(
    Object.values(competitionsCache),
    city,
    { isOpen: isCompetitionOpen },
  );`;

const newLogic = `function updateActiveBranches() {
  const city = isTurkiyeMode ? null : document.getElementById('citySelect').value;
  const branchSelect = document.getElementById('branchSelect');
  const currentBranch = branchSelect.value;
  
  // Türkiye modundaysa, filter'da sadece tur === 'turkiye' olanlar dikkate alınsın
  const validComps = Object.values(competitionsCache).filter(c => 
      isTurkiyeMode ? (c.tur === 'turkiye') : ((c.tur || 'il') !== 'turkiye')
  );

  const availableBranches = getAvailablePublicBranchOptions(
    validComps,
    city,
    { isOpen: isCompetitionOpen },
  );`;

content = content.replace(oldLogic, newLogic);
fs.writeFileSync(file, content, 'utf8');
console.log('Fixed updateActiveBranches.');
