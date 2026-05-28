import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import { DashboardLayout } from './components/DashboardLayout';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PartsPage } from './pages/PartsPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { CarbonPage } from './pages/CarbonPage';
import { WarehousePage } from './pages/WarehousePage';
import { AdminTenantsPage } from './pages/AdminTenantsPage';

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
          <Route path="/carbon" element={<CarbonPage />} />
          <Route path="/warehouse" element={<WarehousePage />} />
          <Route path="/admin/tenants" element={<AdminTenantsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
