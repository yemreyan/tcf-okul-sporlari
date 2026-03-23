import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { NotificationProvider } from './lib/NotificationContext';
import AnnouncementPopup from './components/AnnouncementPopup';
import './App.css';

// ─── Lazy-loaded Pages (Code Splitting) ───
// Her sayfa ayrı chunk olarak yüklenir — ilk açılışta sadece LandingPage indirilir
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

// ─── Aerobik Cimnastik Pages ───
const AerobikHomePage = lazy(() => import('./pages/AerobikHomePage'));
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

// Korumalı Route Bileşeni — pageKey ile sayfa izni kontrolü
const ProtectedRoute = ({ children, pageKey }) => {
  const { isAuthenticated, loading, hasPermission } = useAuth();

  if (loading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/artistik" replace />;
  }

  // pageKey verilmişse sayfa izni kontrolü yap
  if (pageKey && !hasPermission(pageKey)) {
    return <Navigate to="/artistik" replace />;
  }

  return children;
};

// Super Admin Only Route
const SuperAdminRoute = ({ children }) => {
  const { isAuthenticated, loading, isSuperAdmin } = useAuth();

  if (loading) return null;
  if (!isAuthenticated || !isSuperAdmin()) {
    return <Navigate to="/artistik" replace />;
  }
  return children;
};

function AppRoutes() {
  return (
    <>
    <AnnouncementPopup />
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/artistik" element={<HomePage />} />
        <Route path="/artistik/competitions" element={<ProtectedRoute pageKey="competitions"><CompetitionsPage /></ProtectedRoute>} />
        <Route path="/artistik/applications" element={<ProtectedRoute pageKey="applications"><ApplicationsPage /></ProtectedRoute>} />
        <Route path="/artistik/athletes" element={<ProtectedRoute pageKey="athletes"><AthletesPage /></ProtectedRoute>} />
        <Route path="/artistik/criteria" element={<ProtectedRoute pageKey="criteria"><CriteriaPage /></ProtectedRoute>} />
        <Route path="/artistik/start-order" element={<ProtectedRoute pageKey="start_order"><StartOrderPage /></ProtectedRoute>} />
        <Route path="/artistik/scoring" element={<ProtectedRoute pageKey="scoring"><ScoringPage /></ProtectedRoute>} />
        <Route path="/artistik/referees" element={<ProtectedRoute pageKey="referees"><RefereesPage /></ProtectedRoute>} />
        <Route path="/artistik/analytics" element={<ProtectedRoute pageKey="analytics"><AnalyticsPage /></ProtectedRoute>} />
        <Route path="/artistik/finals" element={<ProtectedRoute pageKey="finals"><FinalsPage /></ProtectedRoute>} />
        <Route path="/artistik/scoreboard" element={<ProtectedRoute pageKey="scoreboard"><ScoreboardPage /></ProtectedRoute>} />
        <Route path="/artistik/links" element={<ProtectedRoute pageKey="links"><LinksPage /></ProtectedRoute>} />
        <Route path="/artistik/official-report" element={<ProtectedRoute pageKey="official_report"><OfficialReportPage /></ProtectedRoute>} />
        <Route path="/artistik/athlete/:compId/:catId/:athId" element={<ProtectedRoute pageKey="athletes"><AthleteProfilePage /></ProtectedRoute>} />
        <Route path="/artistik/schedule" element={<ProtectedRoute pageKey="schedule"><CompetitionSchedulePage /></ProtectedRoute>} />
        <Route path="/artistik/announcements" element={<ProtectedRoute pageKey="announcements"><AnnouncementsPage /></ProtectedRoute>} />
        <Route path="/artistik/certificates" element={<ProtectedRoute pageKey="certificates"><CertificatePage /></ProtectedRoute>} />
        <Route path="/artistik/audit-log" element={<SuperAdminRoute><AuditLogPage /></SuperAdminRoute>} />
        <Route path="/artistik/role-management" element={<SuperAdminRoute><RoleManagementPage /></SuperAdminRoute>} />
        {/* E-Panel — public, QR ile erişim */}
        <Route path="/artistik/epanel" element={<EPanelPage />} />

        {/* ═══ AEROBİK CİMNASTİK ═══ */}
        <Route path="/aerobik" element={<AerobikHomePage />} />
        <Route path="/aerobik/scoring" element={<ProtectedRoute pageKey="scoring"><AerobikScoringPage /></ProtectedRoute>} />

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
