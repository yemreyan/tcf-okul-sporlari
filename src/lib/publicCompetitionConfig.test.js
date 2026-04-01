import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getAvailablePublicBranchOptions,
  normalizePublicMatchValue,
  pickBetterCompetitionRecord,
  PUBLIC_BRANCH_OPTIONS,
  PUBLIC_COMPETITION_SOURCES,
  scorePublicCompetitionData,
  inferCompetitionBranch,
} from './publicCompetitionConfig.js';

test('public competition sources include trampolin path', () => {
  assert.ok(
    PUBLIC_COMPETITION_SOURCES.some((source) => source.path === 'trampolin_yarismalar'),
    'Expected trampolin_yarismalar to be available on the public application page',
  );
});

test('public branch options include trampolin', () => {
  assert.ok(
    PUBLIC_BRANCH_OPTIONS.some((branch) => branch.value === 'Trampolin'),
    'Expected Trampolin to be selectable on the public application page',
  );
});

test('inferCompetitionBranch falls back to trampolin for trampolin competition path', () => {
  assert.equal(
    inferCompetitionBranch({ _firebasePath: 'trampolin_yarismalar' }),
    'TRAMPOLİN',
  );
});

test('available branch options infer artistic for legacy competitions without brans field', () => {
  const options = getAvailablePublicBranchOptions(
    [
      { il: 'Manisa', _firebasePath: 'competitions' },
    ],
    'Manisa',
  );

  assert.deepEqual(
    options.map((option) => option.value),
    ['Artistik'],
  );
});

test('scorePublicCompetitionData prefers complete records', () => {
  const rich = scorePublicCompetitionData({
    il: 'Manisa',
    isim: 'MANISA OKULLARARASI IL SECMESI',
    baslangicTarihi: '2026-04-07',
    bitisTarihi: '2026-04-08',
    kategoriler: { genc_erkek: { name: 'Genc Erkek' } },
  });
  const empty = scorePublicCompetitionData({});
  assert.ok(rich > empty);
});

test('pickBetterCompetitionRecord keeps richer source when ids collide across paths', () => {
  const artistic = {
    _firebasePath: 'competitions',
    il: 'Manisa',
    isim: 'MANISA OKULLARARASI IL SECMESI',
    baslangicTarihi: '2026-04-07',
  };
  const emptyAerobik = {
    _firebasePath: 'aerobik_yarismalar',
  };
  const chosen = pickBetterCompetitionRecord(artistic, emptyAerobik);
  assert.equal(chosen._firebasePath, 'competitions');
  assert.equal(chosen.il, 'Manisa');
});

test('normalizePublicMatchValue matches MANISA and MANİSA consistently', () => {
  assert.equal(normalizePublicMatchValue('MANISA'), normalizePublicMatchValue('MANİSA'));
  assert.equal(normalizePublicMatchValue('manisa'), normalizePublicMatchValue('MANİSA'));
});
