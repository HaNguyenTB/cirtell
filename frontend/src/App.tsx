import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import { DashboardLayout } from './components/DashboardLayout';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PartsPage } from './pages/PartsPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { CarbonPage } from './pages/CarbonPage';
import { WarehousePage } from './pages/WarehousePage';
import { AdministrationPage } from './pages/AdministrationPage';
import { ProjectsPage } from './pages/ProjectsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/welcome" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route element={<DashboardLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/parts" element={<PartsPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectsPage />} />
          <Route path="/carbon" element={<CarbonPage />} />
          <Route path="/warehouse" element={<WarehousePage />} />
          <Route path="/admin" element={<AdministrationPage />} />
          <Route path="/admin/dashboard" element={<AdministrationPage />} />
          <Route path="/admin/users" element={<AdministrationPage />} />
          <Route path="/admin/tenants" element={<AdministrationPage />} />
          <Route path="/admin/companies" element={<AdministrationPage />} />
          <Route path="/admin/audit" element={<AdministrationPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
