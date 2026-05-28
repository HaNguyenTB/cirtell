import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Sidebar } from './Sidebar';
import { apiRequest } from '../lib/api';

export function DashboardLayout() {
  const { isAuthenticated, tenantContext, setUser, currentCompanyId, selectedTenantId } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated || tenantContext) return;
    apiRequest('/api/auth/me', { redirectOnUnauthorized: false })
      .then((context) => {
        const payload = context as Parameters<typeof setUser>[1] & { user?: Parameters<typeof setUser>[0] };
        if (payload.user) setUser(payload.user, payload);
      })
      .catch(() => {});
  }, [isAuthenticated, setUser, tenantContext]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen bg-[#F9FAFB]">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-3 sm:p-4 lg:p-8 max-w-7xl mx-auto animate-fade-in">
          <Outlet key={`${selectedTenantId || 'all'}:${currentCompanyId || 'none'}`} />
        </div>
      </main>
    </div>
  );
}
