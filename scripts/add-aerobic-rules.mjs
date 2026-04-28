import fs from 'fs';

const file = 'src/basvuru-app.js';
let content = fs.readFileSync(file, 'utf8');

const oldLogic = `function updateStepIndicators() {
  const steps = document.querySelectorAll('.step-dot');`;

const newLogic = `function enforceAerobicTurkeyRules() {
  const branchSelect = document.getElementById('branchSelect');
  const isAerobik = branchSelect && branchSelect.value === 'Aerobik';
  
  const teacherCard = document.querySelector('.card[data-section="3"]');
  const teacherStep = document.querySelector('.step-dot[data-step="3"]');
  const btnTakim = document.getElementById('btnTakim');
  const btnFerdi = document.getElementById('btnFerdi');

  if (isAerobik && isTurkiyeMode) {
    if (teacherCard) teacherCard.style.display = 'none';
    if (teacherStep) teacherStep.style.display = 'none';
    if (btnTakim) btnTakim.style.display = 'none';
    if (btnFerdi && !btnFerdi.classList.contains('active')) btnFerdi.click();
    document.getElementById('teacherRows').innerHTML = '';
  } else {
    if (teacherCard) teacherCard.style.display = '';
    if (teacherStep) teacherStep.style.display = '';
    if (btnTakim) btnTakim.style.display = '';
  }
}

function updateStepIndicators() {
  enforceAerobicTurkeyRules();
  const steps = document.querySelectorAll('.step-dot');`;

content = content.replace(oldLogic, newLogic);
fs.writeFileSync(file, content, 'utf8');
console.log('Added enforceAerobicTurkeyRules.');
