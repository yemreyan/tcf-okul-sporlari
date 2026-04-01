export const PUBLIC_COMPETITION_SOURCES = [
  {
    path: 'competitions',
    fallbackBranch: 'ARTİSTİK',
  },
  {
    path: 'aerobik_yarismalar',
    fallbackBranch: 'AEROBİK',
  },
  {
    path: 'trampolin_yarismalar',
    fallbackBranch: 'TRAMPOLİN',
  },
  {
    path: 'parkur_yarismalar',
    fallbackBranch: 'PARKUR',
  },
  {
    path: 'ritmik_yarismalar',
    fallbackBranch: 'RİTMİK',
  },
];

export const PUBLIC_COMPETITION_SOURCE_PATHS = PUBLIC_COMPETITION_SOURCES.map((source) => source.path);

export const PUBLIC_BRANCH_OPTIONS = [
  { value: 'Artistik', label: 'ARTİSTİK CİMNASTİK' },
  { value: 'Ritmik', label: 'RİTMİK CİMNASTİK' },
  { value: 'Parkur', label: 'PARKUR' },
  { value: 'Aerobik', label: 'AEROBİK CİMNASTİK' },
  { value: 'Trampolin', label: 'TRAMPOLİN CİMNASTİK' },
];

const SOURCE_BRANCH_MAP = new Map(
  PUBLIC_COMPETITION_SOURCES.map((source) => [source.path, source.fallbackBranch]),
);

export function inferCompetitionBranch(data = {}) {
  if (data.brans) {
    return data.brans.toLocaleUpperCase('tr-TR');
  }

  return getCompetitionBranchFromPath(data._firebasePath || data.firebasePath);
}

export function getCompetitionBranchFromPath(path) {
  return SOURCE_BRANCH_MAP.get(path) || 'ARTİSTİK';
}

export function normalizePublicMatchValue(value) {
  return String(value || '')
    .toLocaleUpperCase('tr-TR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/İ/g, 'I')
    .trim();
}

function countTruthy(fields) {
  return fields.filter(Boolean).length;
}

export function scorePublicCompetitionData(data = {}) {
  return countTruthy([
    data.il,
    data.isim || data.ad || data.name,
    data.baslangicTarihi || data.tarih,
    data.bitisTarihi || data.tarih,
    data.kategoriler && typeof data.kategoriler === 'object' && Object.keys(data.kategoriler).length > 0,
    data.brans,
  ]);
}

export function pickBetterCompetitionRecord(current, candidate) {
  if (!current) return candidate;
  if (!candidate) return current;

  const currentScore = scorePublicCompetitionData(current);
  const candidateScore = scorePublicCompetitionData(candidate);

  if (candidateScore > currentScore) return candidate;
  return current;
}

export function getAvailablePublicBranchOptions(competitions, city, options = {}) {
  const {
    includeAllWhenEmpty = true,
    isOpen = null,
  } = options;

  const cityUpper = city ? normalizePublicMatchValue(city) : null;
  const branches = new Set();

  (competitions || []).forEach((competition) => {
    if (typeof isOpen === 'function' && !isOpen(competition)) return;

    if (cityUpper) {
      const compCity = normalizePublicMatchValue(competition.il || '');
      if (compCity !== cityUpper) return;
    }

    branches.add(normalizePublicMatchValue(inferCompetitionBranch(competition)));
  });

  const available = PUBLIC_BRANCH_OPTIONS.filter((branch) =>
    branches.has(normalizePublicMatchValue(branch.value)),
  );

  if (available.length === 0 && includeAllWhenEmpty) {
    return [...PUBLIC_BRANCH_OPTIONS];
  }

  return available;
}
