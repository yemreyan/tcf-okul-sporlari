import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { NotificationProvider } from './lib/NotificationContext';
import HomePage from './pages/HomePage';
import CompetitionsPage from './pages/CompetitionsPage';
import ApplicationsPage from './pages/ApplicationsPage';
import AthletesPage from './pages/AthletesPage';
import CriteriaPage from './pages/CriteriaPage';
import StartOrderPage from './pages/StartOrderPage';
import ScoringPage from './pages/ScoringPage';
import RefereesPage from './pages/RefereesPage';
import AnalyticsPage from './pages/AnalyticsPage';
import FinalsPage from './pages/FinalsPage';
import EPanelPage from './pages/EPanelPage';
import ScoreboardPage from './pages/ScoreboardPage';
import LinksPage from './pages/LinksPage';
import OfficialReportPage from './pages/OfficialReportPage';
import RoleManagementPage from './pages/RoleManagementPage';
import './App.css';

// Korumalı Route Bileşeni — pageKey ile sayfa izni kontrolü
const ProtectedRoute = ({ children, pageKey }) => {
  const { isAuthenticated, loading, hasPermission } = useAuth();

  if (loading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  // pageKey verilmişse sayfa izni kontrolü yap
  if (pageKey && !hasPermission(pageKey)) {
    return <Navigate to="/" replace />;
  }

  return children;
};

// Super Admin Only Route
const SuperAdminRoute = ({ children }) => {
  const { isAuthenticated, loading, isSuperAdmin } = useAuth();

  if (loading) return null;
  if (!isAuthenticated || !isSuperAdmin()) {
    return <Navigate to="/" replace />;
  }
  return children;
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route
        path="/competitions"
        element={
          <ProtectedRoute pageKey="competitions">
            <CompetitionsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/applications"
        element={
          <ProtectedRoute pageKey="applications">
            <ApplicationsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/athletes"
        element={
          <ProtectedRoute pageKey="athletes">
            <AthletesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/criteria"
        element={
          <ProtectedRoute pageKey="criteria">
            <CriteriaPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/start-order"
        element={
          <ProtectedRoute pageKey="start_order">
            <StartOrderPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/scoring"
        element={
          <ProtectedRoute pageKey="scoring">
            <ScoringPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/referees"
        element={
          <ProtectedRoute pageKey="referees">
            <RefereesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/analytics"
        element={
          <ProtectedRoute pageKey="analytics">
            <AnalyticsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finals"
        element={
          <ProtectedRoute pageKey="finals">
            <FinalsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/scoreboard"
        element={
          <ProtectedRoute pageKey="scoreboard">
            <ScoreboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/links"
        element={
          <ProtectedRoute pageKey="links">
            <LinksPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/official-report"
        element={
          <ProtectedRoute pageKey="official_report">
            <OfficialReportPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/role-management"
        element={
          <SuperAdminRoute>
            <RoleManagementPage />
          </SuperAdminRoute>
        }
      />
      {/* E-Panel is relatively public/unprotected because refs use external devices via QR code to access. Access control relies on IDs. */}
      <Route path="/epanel" element={<EPanelPage />} />
    </Routes>
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
