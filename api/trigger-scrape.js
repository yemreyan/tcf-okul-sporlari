// api/trigger-scrape.js
// Vercel Serverless Function — GitHub Actions workflow_dispatch tetikler
//
// POST /api/trigger-scrape
// Body: { il?: string, testMode?: boolean }
//
// Gerekli environment değişkenleri (Vercel Dashboard > Settings > Environment Variables):
//   GITHUB_ACTIONS_TOKEN  — repo:workflow iznine sahip GitHub Personal Access Token
//   GITHUB_REPO           — "kullanici/repo" formatında repo adı
//                           (varsayılan: yemreyan/tcf-okul-sporlari)

export default async function handler(req, res) {
  // CORS başlıkları
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Sadece POST kabul et
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // GitHub token kontrolü
  const githubToken = process.env.GITHUB_ACTIONS_TOKEN;
  const githubRepo =
    process.env.GITHUB_REPO || 'yemreyan/tcf-okul-sporlari';

  if (!githubToken) {
    return res
      .status(500)
      .json({ error: 'GitHub token yapılandırılmamış (GITHUB_ACTIONS_TOKEN)' });
  }

  // Body parametrelerini al
  const { il = '', testMode = false } = req.body || {};

  // Workflow inputs oluştur
  const inputs = {};
  if (il && typeof il === 'string') {
    inputs.il = il.trim().toUpperCase();
  }
  if (testMode === true || testMode === 'true') {
    inputs.test_mode = 'true';
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${githubRepo}/actions/workflows/scrape-mebbis.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `token ${githubToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'TCF-Okul-Sporlari/1.0',
        },
        body: JSON.stringify({ ref: 'main', inputs }),
      }
    );

    // GitHub 204 No Content döndürür — başarılı dispatch
    if (response.status === 204) {
      return res.status(200).json({
        success: true,
        message: 'GitHub Actions iş akışı başlatıldı',
        details: {
          repo: githubRepo,
          workflow: 'scrape-mebbis.yml',
          inputs,
        },
      });
    }

    // Hata durumu
    let errorData = {};
    try {
      errorData = await response.json();
    } catch {
      // JSON parse başarısız olabilir
    }

    const errorMessage =
      errorData.message ||
      `GitHub API hata kodu: ${response.status}`;

    return res.status(response.status).json({
      error: errorMessage,
      githubStatus: response.status,
    });
  } catch (err) {
    return res.status(500).json({
      error: `Bağlantı hatası: ${err.message}`,
    });
  }
}
