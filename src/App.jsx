import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { NotificationProvider } from './lib/NotificationContext';
import { DisciplineProvider } from './lib/DisciplineContext';
import AnnouncementPopup from './components/AnnouncementPopup';
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

function AppRoutes() {
  return (
    <>
    <AnnouncementPopup />
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
        <Route path="/artistik/scoreboard" element={<PD discipline="artistik" pageKey="scoreboard"><ScoreboardPage /></PD>} />
        <Route path="/artistik/links" element={<PD discipline="artistik" pageKey="links"><LinksPage /></PD>} />
        <Route path="/artistik/official-report" element={<PD discipline="artistik" pageKey="official_report"><OfficialReportPage /></PD>} />
        <Route path="/artistik/athlete/:compId/:catId/:athId" element={<PD discipline="artistik" pageKey="athletes"><AthleteProfilePage /></PD>} />
        <Route path="/artistik/schedule" element={<PD discipline="artistik" pageKey="schedule"><CompetitionSchedulePage /></PD>} />
        <Route path="/artistik/announcements" element={<PD discipline="artistik" pageKey="announcements"><AnnouncementsPage /></PD>} />
        <Route path="/artistik/certificates" element={<PD discipline="artistik" pageKey="certificates"><CertificatePage /></PD>} />
        <Route path="/artistik/audit-log" element={<SuperAdminRoute><AuditLogPage /></SuperAdminRoute>} />
        <Route path="/artistik/role-management" element={<SuperAdminRoute><RoleManagementPage /></SuperAdminRoute>} />
        <Route path="/artistik/epanel" element={<D discipline="artistik"><EPanelPage /></D>} />

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
        <Route path="/aerobik/scoreboard" element={<PD discipline="aerobik" pageKey="scoreboard"><ScoreboardPage /></PD>} />
        <Route path="/aerobik/links" element={<PD discipline="aerobik" pageKey="links"><LinksPage /></PD>} />
        <Route path="/aerobik/official-report" element={<PD discipline="aerobik" pageKey="official_report"><OfficialReportPage /></PD>} />
        <Route path="/aerobik/athlete/:compId/:catId/:athId" element={<PD discipline="aerobik" pageKey="athletes"><AthleteProfilePage /></PD>} />
        <Route path="/aerobik/schedule" element={<PD discipline="aerobik" pageKey="schedule"><CompetitionSchedulePage /></PD>} />
        <Route path="/aerobik/announcements" element={<PD discipline="aerobik" pageKey="announcements"><AnnouncementsPage /></PD>} />
        <Route path="/aerobik/certificates" element={<PD discipline="aerobik" pageKey="certificates"><CertificatePage /></PD>} />
        <Route path="/aerobik/epanel" element={<D discipline="aerobik"><EPanelPage /></D>} />

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
        <Router>
          <AppRoutes />
        </Router>
      </NotificationProvider>
    </AuthProvider>
  );
}

export default App;
