import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { NotificationProvider } from './lib/NotificationContext';
import { DisciplineProvider } from './lib/DisciplineContext';
import { OfflineProvider } from './lib/OfflineContext';
import { DeleteGuardProvider } from './lib/DeleteGuardContext';
import AnnouncementPopup from './components/AnnouncementPopup';
import OfflineBanner from './components/OfflineBanner';
import './App.css';

// ─── Lazy-loaded Pages (Code Splitting) ───
const LandingPage = lazy(() => import('./pages/LandingPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const CompetitionsPage = lazy(() => import('./pages/CompetitionsPage'));
const ApplicationsPage = lazy(() => import('./pages/ApplicationsPage'));
const AthletesPage = lazy(() => import('./pages/AthletesPage'));
const CriteriaPage = lazy(() => import('./pages/CriteriaPage'));
const StartOrderPage = lazy(() => import('./pages/StartOrderPage'));
const ScoringPage = lazy(() => import('./pages/ScoringPage'));
const RefereesPage = lazy(() => import('./pages/RefereesPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const FinalsPage = lazy(() => import('./pages/FinalsPage'));
const EPanelPage = lazy(() => import('./pages/EPanelPage'));
const ScoreboardPage = lazy(() => import('./pages/ScoreboardPage'));
const LinksPage = lazy(() => import('./pages/LinksPage'));
const OfficialReportPage = lazy(() => import('./pages/OfficialReportPage'));
const RoleManagementPage = lazy(() => import('./pages/RoleManagementPage'));
const CompetitionSchedulePage = lazy(() => import('./pages/CompetitionSchedulePage'));
const AthleteProfilePage = lazy(() => import('./pages/AthleteProfilePage'));
const AnnouncementsPage = lazy(() => import('./pages/AnnouncementsPage'));
const CertificatePage = lazy(() => import('./pages/CertificatePage'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));

// Aerobik — özel puanlama sayfası (A+E+D+CJP formülü farklı)
const AerobikScoringPage = lazy(() => import('./pages/AerobikScoringPage'));

// Aerobik — hakem panelleri (A, D, T, L)
const AerobikAPanelPage = lazy(() => import('./pages/AerobikAPanelPage'));
const AerobikDPanelPage = lazy(() => import('./pages/AerobikDPanelPage'));
const AerobikTPanelPage = lazy(() => import('./pages/AerobikTPanelPage'));
const AerobikLPanelPage = lazy(() => import('./pages/AerobikLPanelPage'));

// Trampolin — özel puanlama sayfası (D+E+T−HD formülü)
const TrampolinScoringPage = lazy(() => import('./pages/TrampolinScoringPage'));

// Parkur — özel puanlama sayfası (D+E−Ceza formülü)
const ParkurScoringPage = lazy(() => import('./pages/ParkurScoringPage'));

// Ritmik — özel puanlama sayfası (D+E−Ceza formülü)
const RitmikScoringPage = lazy(() => import('./pages/RitmikScoringPage'));

// Ritmik — DA/DB hakem paneli (zorluk puan girişi)
const RitmikDPanelPage = lazy(() => import('./pages/RitmikDPanelPage'));
const HakemRaporuPage = lazy(() => import('./pages/HakemRaporuPage'));
const HakemKarnesiPage = lazy(() => import('./pages/HakemKarnesiPage'));
const ArtistikTPanelPage = lazy(() => import('./pages/ArtistikTPanelPage'));
const ArtistikLPanelPage = lazy(() => import('./pages/ArtistikLPanelPage'));
const RitmikLPanelPage = lazy(() => import('./pages/RitmikLPanelPage'));
const RitmikTPanelPage = lazy(() => import('./pages/RitmikTPanelPage'));

// Görevli Yaka Kartları — tüm branşlar için ortak
const GorevliKartlariPage = lazy(() => import('./pages/GorevliKartlariPage'));

// Antrenörler — tüm branşlar için ortak (federation-wide)
const CoachesPage = lazy(() => import('./pages/CoachesPage'));

// Okullar — MEB okul listesi yönetimi (federation-wide, super admin only)
const SchoolsPage = lazy(() => import('./pages/SchoolsPage'));

// Kategori Yönetimi — yaş grubu ve okul türü yapılandırması (super admin only)
const KategoriYonetimiPage = lazy(() => import('./pages/KategoriYonetimiPage'));

// ─── Loading Fallback ───
const PageLoader = () => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    background: '#0a0e1a',
    color: '#64748b',
    fontFamily: 'Inter, system-ui, sans-serif',
    gap: '12px'
  }}>
    <div style={{
      width: 32, height: 32,
      border: '3px solid #1e293b',
      borderTopColor: '#6366f1',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite'
    }} />
    <span>Yükleniyor...</span>
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

// Korumalı Route Bileşeni
const ProtectedRoute = ({ children, pageKey, redirectTo = '/artistik' }) => {
  const { isAuthenticated, loading, hasPermission } = useAuth();
  if (loading) return null;
  if (!isAuthenticated) return <Navigate to={redirectTo} replace />;
  if (pageKey && !hasPermission(pageKey)) return <Navigate to={redirectTo} replace />;
  return children;
};

// Super Admin Only Route
const SuperAdminRoute = ({ children }) => {
  const { isAuthenticated, loading, isSuperAdmin } = useAuth();
  if (loading) return null;
  if (!isAuthenticated || !isSuperAdmin()) return <Navigate to="/artistik" replace />;
  return children;
};

// ─── Discipline Wrapper — sayfa bileşenini DisciplineProvider ile sarar ───
const D = ({ discipline, children }) => (
  <DisciplineProvider discipline={discipline}>
    {children}
  </DisciplineProvider>
);

// ─── Protected + Discipline ───
const PD = ({ discipline, pageKey, children }) => (
  <DisciplineProvider discipline={discipline}>
    <ProtectedRoute pageKey={pageKey} redirectTo={`/${discipline}`}>
      {children}
    </ProtectedRoute>
  </DisciplineProvider>
);

// Public scoreboard proxy host — bu host'tan gelen istekler menüye/uygulamaya
// gidemez, SADECE scoreboard görür. Diğer tüm path'ler son ziyaret edilen
// scoreboard linkine (sessionStorage) veya default'a yönlenir.
const PUBLIC_HOSTS = ['tcfscore.vercel.app'];
const isPublicScoreboardHost = () =>
  typeof window !== 'undefined' && PUBLIC_HOSTS.includes(window.location.hostname);

const PublicScoreboardFallback = () => {
  const last = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('tcfscore_last_url')) || '/ritmik/scoreboard';
  return <Navigate to={last} replace />;
};

function PublicAppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/artistik/scoreboard" element={<D discipline="artistik"><ScoreboardPage /></D>} />
        <Route path="/aerobik/scoreboard" element={<D discipline="aerobik"><ScoreboardPage /></D>} />
        <Route path="/trampolin/scoreboard" element={<D discipline="trampolin"><ScoreboardPage /></D>} />
        <Route path="/parkur/scoreboard" element={<D discipline="parkur"><ScoreboardPage /></D>} />
        <Route path="/ritmik/scoreboard" element={<D discipline="ritmik"><ScoreboardPage /></D>} />
        <Route path="*" element={<PublicScoreboardFallback />} />
      </Routes>
    </Suspense>
  );
}

function AppRoutes() {
  if (isPublicScoreboardHost()) return <PublicAppRoutes />;
  return (
    <>
    <AnnouncementPopup />
    <OfflineBanner />
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />

        {/* ═══ ARTİSTİK CİMNASTİK ═══ */}
        <Route path="/artistik" element={<D discipline="artistik"><HomePage /></D>} />
        <Route path="/artistik/competitions" element={<PD discipline="artistik" pageKey="competitions"><CompetitionsPage /></PD>} />
        <Route path="/artistik/applications" element={<PD discipline="artistik" pageKey="applications"><ApplicationsPage /></PD>} />
        <Route path="/artistik/athletes" element={<PD discipline="artistik" pageKey="athletes"><AthletesPage /></PD>} />
        <Route path="/artistik/criteria" element={<PD discipline="artistik" pageKey="criteria"><CriteriaPage /></PD>} />
        <Route path="/artistik/start-order" element={<PD discipline="artistik" pageKey="start_order"><StartOrderPage /></PD>} />
        <Route path="/artistik/scoring" element={<PD discipline="artistik" pageKey="scoring"><ScoringPage /></PD>} />
        <Route path="/artistik/referees" element={<PD discipline="artistik" pageKey="referees"><RefereesPage /></PD>} />
        <Route path="/artistik/analytics" element={<PD discipline="artistik" pageKey="analytics"><AnalyticsPage /></PD>} />
        <Route path="/artistik/finals" element={<PD discipline="artistik" pageKey="finals"><FinalsPage /></PD>} />
        <Route path="/artistik/scoreboard" element={<D discipline="artistik"><ScoreboardPage /></D>} />
        <Route path="/artistik/links" element={<PD discipline="artistik" pageKey="links"><LinksPage /></PD>} />
        <Route path="/artistik/official-report" element={<PD discipline="artistik" pageKey="official_report"><OfficialReportPage /></PD>} />
        <Route path="/artistik/athlete/:compId/:catId/:athId" element={<PD discipline="artistik" pageKey="athletes"><AthleteProfilePage /></PD>} />
        <Route path="/artistik/schedule" element={<PD discipline="artistik" pageKey="schedule"><CompetitionSchedulePage /></PD>} />
        <Route path="/artistik/announcements" element={<PD discipline="artistik" pageKey="announcements"><AnnouncementsPage /></PD>} />
        <Route path="/artistik/certificates" element={<PD discipline="artistik" pageKey="certificates"><CertificatePage /></PD>} />
        <Route path="/artistik/coaches" element={<PD discipline="artistik" pageKey="coaches"><CoachesPage /></PD>} />
        <Route path="/artistik/audit-log" element={<SuperAdminRoute><AuditLogPage /></SuperAdminRoute>} />
        <Route path="/artistik/role-management" element={<SuperAdminRoute><RoleManagementPage /></SuperAdminRoute>} />
        <Route path="/artistik/epanel" element={<D discipline="artistik"><EPanelPage /></D>} />
        <Route path="/artistik/tpanel" element={<D discipline="artistik"><ArtistikTPanelPage /></D>} />
        <Route path="/artistik/lpanel" element={<D discipline="artistik"><ArtistikLPanelPage /></D>} />

        {/* ═══ AEROBİK CİMNASTİK ═══ */}
        <Route path="/aerobik" element={<D discipline="aerobik"><HomePage /></D>} />
        <Route path="/aerobik/competitions" element={<PD discipline="aerobik" pageKey="competitions"><CompetitionsPage /></PD>} />
        <Route path="/aerobik/applications" element={<PD discipline="aerobik" pageKey="applications"><ApplicationsPage /></PD>} />
        <Route path="/aerobik/athletes" element={<PD discipline="aerobik" pageKey="athletes"><AthletesPage /></PD>} />
        <Route path="/aerobik/criteria" element={<PD discipline="aerobik" pageKey="criteria"><CriteriaPage /></PD>} />
        <Route path="/aerobik/start-order" element={<PD discipline="aerobik" pageKey="start_order"><StartOrderPage /></PD>} />
        <Route path="/aerobik/scoring" element={<PD discipline="aerobik" pageKey="scoring"><AerobikScoringPage /></PD>} />
        <Route path="/aerobik/referees" element={<PD discipline="aerobik" pageKey="referees"><RefereesPage /></PD>} />
        <Route path="/aerobik/analytics" element={<PD discipline="aerobik" pageKey="analytics"><AnalyticsPage /></PD>} />
        <Route path="/aerobik/finals" element={<PD discipline="aerobik" pageKey="finals"><FinalsPage /></PD>} />
        <Route path="/aerobik/scoreboard" element={<D discipline="aerobik"><ScoreboardPage /></D>} />
        <Route path="/aerobik/links" element={<PD discipline="aerobik" pageKey="links"><LinksPage /></PD>} />
        <Route path="/aerobik/official-report" element={<PD discipline="aerobik" pageKey="official_report"><OfficialReportPage /></PD>} />
        <Route path="/aerobik/athlete/:compId/:catId/:athId" element={<PD discipline="aerobik" pageKey="athletes"><AthleteProfilePage /></PD>} />
        <Route path="/aerobik/schedule" element={<PD discipline="aerobik" pageKey="schedule"><CompetitionSchedulePage /></PD>} />
        <Route path="/aerobik/announcements" element={<PD discipline="aerobik" pageKey="announcements"><AnnouncementsPage /></PD>} />
        <Route path="/aerobik/certificates" element={<PD discipline="aerobik" pageKey="certificates"><CertificatePage /></PD>} />
        <Route path="/aerobik/coaches" element={<PD discipline="aerobik" pageKey="coaches"><CoachesPage /></PD>} />
        <Route path="/aerobik/epanel" element={<D discipline="aerobik"><EPanelPage /></D>} />
        <Route path="/aerobik/apanel" element={<D discipline="aerobik"><AerobikAPanelPage /></D>} />
        <Route path="/aerobik/dpanel" element={<D discipline="aerobik"><AerobikDPanelPage /></D>} />
        <Route path="/aerobik/tpanel" element={<D discipline="aerobik"><AerobikTPanelPage /></D>} />
        <Route path="/aerobik/lpanel" element={<D discipline="aerobik"><AerobikLPanelPage /></D>} />

        {/* ═══ TRAMPOLİN CİMNASTİK ═══ */}
        <Route path="/trampolin" element={<D discipline="trampolin"><HomePage /></D>} />
        <Route path="/trampolin/competitions" element={<PD discipline="trampolin" pageKey="competitions"><CompetitionsPage /></PD>} />
        <Route path="/trampolin/applications" element={<PD discipline="trampolin" pageKey="applications"><ApplicationsPage /></PD>} />
        <Route path="/trampolin/athletes" element={<PD discipline="trampolin" pageKey="athletes"><AthletesPage /></PD>} />
        <Route path="/trampolin/criteria" element={<PD discipline="trampolin" pageKey="criteria"><CriteriaPage /></PD>} />
        <Route path="/trampolin/start-order" element={<PD discipline="trampolin" pageKey="start_order"><StartOrderPage /></PD>} />
        <Route path="/trampolin/scoring" element={<PD discipline="trampolin" pageKey="scoring"><TrampolinScoringPage /></PD>} />
        <Route path="/trampolin/referees" element={<PD discipline="trampolin" pageKey="referees"><RefereesPage /></PD>} />
        <Route path="/trampolin/analytics" element={<PD discipline="trampolin" pageKey="analytics"><AnalyticsPage /></PD>} />
        <Route path="/trampolin/finals" element={<PD discipline="trampolin" pageKey="finals"><FinalsPage /></PD>} />
        <Route path="/trampolin/scoreboard" element={<D discipline="trampolin"><ScoreboardPage /></D>} />
        <Route path="/trampolin/links" element={<PD discipline="trampolin" pageKey="links"><LinksPage /></PD>} />
        <Route path="/trampolin/official-report" element={<PD discipline="trampolin" pageKey="official_report"><OfficialReportPage /></PD>} />
        <Route path="/trampolin/athlete/:compId/:catId/:athId" element={<PD discipline="trampolin" pageKey="athletes"><AthleteProfilePage /></PD>} />
        <Route path="/trampolin/schedule" element={<PD discipline="trampolin" pageKey="schedule"><CompetitionSchedulePage /></PD>} />
        <Route path="/trampolin/announcements" element={<PD discipline="trampolin" pageKey="announcements"><AnnouncementsPage /></PD>} />
        <Route path="/trampolin/certificates" element={<PD discipline="trampolin" pageKey="certificates"><CertificatePage /></PD>} />
        <Route path="/trampolin/coaches" element={<PD discipline="trampolin" pageKey="coaches"><CoachesPage /></PD>} />
        <Route path="/trampolin/epanel" element={<D discipline="trampolin"><EPanelPage /></D>} />

        {/* ═══ PARKUR CİMNASTİK ═══ */}
        <Route path="/parkur" element={<D discipline="parkur"><HomePage /></D>} />
        <Route path="/parkur/competitions" element={<PD discipline="parkur" pageKey="competitions"><CompetitionsPage /></PD>} />
        <Route path="/parkur/applications" element={<PD discipline="parkur" pageKey="applications"><ApplicationsPage /></PD>} />
        <Route path="/parkur/athletes" element={<PD discipline="parkur" pageKey="athletes"><AthletesPage /></PD>} />
        <Route path="/parkur/start-order" element={<PD discipline="parkur" pageKey="start_order"><StartOrderPage /></PD>} />
        <Route path="/parkur/scoring" element={<PD discipline="parkur" pageKey="scoring"><ParkurScoringPage /></PD>} />
        <Route path="/parkur/referees" element={<PD discipline="parkur" pageKey="referees"><RefereesPage /></PD>} />
        <Route path="/parkur/analytics" element={<PD discipline="parkur" pageKey="analytics"><AnalyticsPage /></PD>} />
        <Route path="/parkur/finals" element={<PD discipline="parkur" pageKey="finals"><FinalsPage /></PD>} />
        <Route path="/parkur/scoreboard" element={<D discipline="parkur"><ScoreboardPage /></D>} />
        <Route path="/parkur/links" element={<PD discipline="parkur" pageKey="links"><LinksPage /></PD>} />
        <Route path="/parkur/official-report" element={<PD discipline="parkur" pageKey="official_report"><OfficialReportPage /></PD>} />
        <Route path="/parkur/athlete/:compId/:catId/:athId" element={<PD discipline="parkur" pageKey="athletes"><AthleteProfilePage /></PD>} />
        <Route path="/parkur/schedule" element={<PD discipline="parkur" pageKey="schedule"><CompetitionSchedulePage /></PD>} />
        <Route path="/parkur/announcements" element={<PD discipline="parkur" pageKey="announcements"><AnnouncementsPage /></PD>} />
        <Route path="/parkur/certificates" element={<PD discipline="parkur" pageKey="certificates"><CertificatePage /></PD>} />
        <Route path="/parkur/coaches" element={<PD discipline="parkur" pageKey="coaches"><CoachesPage /></PD>} />
        <Route path="/parkur/epanel" element={<D discipline="parkur"><EPanelPage /></D>} />

        {/* ═══ RİTMİK CİMNASTİK ═══ */}
        <Route path="/ritmik" element={<D discipline="ritmik"><HomePage /></D>} />
        <Route path="/ritmik/competitions" element={<PD discipline="ritmik" pageKey="competitions"><CompetitionsPage /></PD>} />
        <Route path="/ritmik/applications" element={<PD discipline="ritmik" pageKey="applications"><ApplicationsPage /></PD>} />
        <Route path="/ritmik/athletes" element={<PD discipline="ritmik" pageKey="athletes"><AthletesPage /></PD>} />
        <Route path="/ritmik/start-order" element={<PD discipline="ritmik" pageKey="start_order"><StartOrderPage /></PD>} />
        <Route path="/ritmik/scoring" element={<PD discipline="ritmik" pageKey="scoring"><RitmikScoringPage /></PD>} />
        <Route path="/ritmik/referees" element={<PD discipline="ritmik" pageKey="referees"><RefereesPage /></PD>} />
        <Route path="/ritmik/analytics" element={<PD discipline="ritmik" pageKey="analytics"><AnalyticsPage /></PD>} />
        <Route path="/ritmik/finals" element={<PD discipline="ritmik" pageKey="finals"><FinalsPage /></PD>} />
        <Route path="/ritmik/scoreboard" element={<D discipline="ritmik"><ScoreboardPage /></D>} />
        <Route path="/ritmik/links" element={<PD discipline="ritmik" pageKey="links"><LinksPage /></PD>} />
        <Route path="/ritmik/official-report" element={<PD discipline="ritmik" pageKey="official_report"><OfficialReportPage /></PD>} />
        <Route path="/ritmik/athlete/:compId/:catId/:athId" element={<PD discipline="ritmik" pageKey="athletes"><AthleteProfilePage /></PD>} />
        <Route path="/ritmik/schedule" element={<PD discipline="ritmik" pageKey="schedule"><CompetitionSchedulePage /></PD>} />
        <Route path="/ritmik/announcements" element={<PD discipline="ritmik" pageKey="announcements"><AnnouncementsPage /></PD>} />
        <Route path="/ritmik/certificates" element={<PD discipline="ritmik" pageKey="certificates"><CertificatePage /></PD>} />
        <Route path="/ritmik/coaches" element={<PD discipline="ritmik" pageKey="coaches"><CoachesPage /></PD>} />
        <Route path="/ritmik/epanel" element={<D discipline="ritmik"><EPanelPage /></D>} />
        <Route path="/ritmik/dpanel" element={<D discipline="ritmik"><RitmikDPanelPage /></D>} />
        <Route path="/ritmik/lpanel" element={<D discipline="ritmik"><RitmikLPanelPage /></D>} />
        <Route path="/ritmik/tpanel" element={<D discipline="ritmik"><RitmikTPanelPage /></D>} />
        <Route path="/ritmik/hakem-raporu"    element={<PD discipline="ritmik"    pageKey="audit"><HakemRaporuPage /></PD>} />
        <Route path="/artistik/hakem-raporu"  element={<PD discipline="artistik"  pageKey="audit"><HakemRaporuPage /></PD>} />
        <Route path="/aerobik/hakem-raporu"   element={<PD discipline="aerobik"   pageKey="audit"><HakemRaporuPage /></PD>} />
        <Route path="/trampolin/hakem-raporu" element={<PD discipline="trampolin" pageKey="audit"><HakemRaporuPage /></PD>} />
        <Route path="/parkur/hakem-raporu"    element={<PD discipline="parkur"    pageKey="audit"><HakemRaporuPage /></PD>} />
        <Route path="/ritmik/hakem-karnesi"   element={<PD discipline="ritmik"    pageKey="audit"><HakemKarnesiPage /></PD>} />
        <Route path="/artistik/hakem-karnesi" element={<PD discipline="artistik"  pageKey="audit"><HakemKarnesiPage /></PD>} />
        <Route path="/aerobik/hakem-karnesi"  element={<PD discipline="aerobik"   pageKey="audit"><HakemKarnesiPage /></PD>} />
        <Route path="/trampolin/hakem-karnesi" element={<PD discipline="trampolin" pageKey="audit"><HakemKarnesiPage /></PD>} />
        <Route path="/parkur/hakem-karnesi"   element={<PD discipline="parkur"    pageKey="audit"><HakemKarnesiPage /></PD>} />

        {/* ═══ ORTAK ARAÇLAR ═══ */}
        <Route path="/gorevli-kartlari" element={<ProtectedRoute redirectTo="/"><GorevliKartlariPage /></ProtectedRoute>} />
        <Route path="/schools-admin" element={<SuperAdminRoute><SchoolsPage /></SuperAdminRoute>} />
        <Route path="/kategori-yonetimi" element={<SuperAdminRoute><KategoriYonetimiPage /></SuperAdminRoute>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <DeleteGuardProvider>
          <OfflineProvider>
            <Router>
              <AppRoutes />
            </Router>
          </OfflineProvider>
        </DeleteGuardProvider>
      </NotificationProvider>
    </AuthProvider>
  );
}

export default App;
