import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
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
import './App.css';

// Korumalı Route Bileşeni
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
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
          <ProtectedRoute>
            <CompetitionsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/applications"
        element={
          <ProtectedRoute>
            <ApplicationsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/athletes"
        element={
          <ProtectedRoute>
            <AthletesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/criteria"
        element={
          <ProtectedRoute>
            <CriteriaPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/start-order"
        element={
          <ProtectedRoute>
            <StartOrderPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/scoring"
        element={
          <ProtectedRoute>
            <ScoringPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/referees"
        element={
          <ProtectedRoute>
            <RefereesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/analytics"
        element={
          <ProtectedRoute>
            <AnalyticsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finals"
        element={
          <ProtectedRoute>
            <FinalsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/scoreboard"
        element={
          <ProtectedRoute>
            <ScoreboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/links"
        element={
          <ProtectedRoute>
            <LinksPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/official-report"
        element={
          <ProtectedRoute>
            <OfficialReportPage />
          </ProtectedRoute>
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
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}

export default App;
