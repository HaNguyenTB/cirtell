import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenant_id?: string | null;
  company_id?: string | null;
  tenant_name?: string | null;
  company_name?: string | null;
  is_super_admin?: boolean;
}

export interface TenantRecord {
  id: string;
  name: string;
  domain?: string | null;
  is_platform_tenant?: boolean | number;
  parent_tenant_id?: string | null;
  group_type?: string | null;
}

export interface CompanyRecord {
  id: string;
  tenant_id?: string | null;
  code: string;
  name: string;
  logo_url?: string | null;
  tenant_name?: string | null;
  tenant_domain?: string | null;
  role?: string | null;
}

export interface TenantContext {
  tenant: TenantRecord | null;
  company_ids: string[];
  companies: CompanyRecord[];
  managed_tenants: TenantRecord[];
}

export interface AuthContextPayload {
  tenant?: TenantRecord | null;
  company_ids?: string[];
  companies?: CompanyRecord[];
  managed_tenants?: TenantRecord[];
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  currentCompanyId: string | null;
  selectedTenantId: string | null;
  tenantContext: TenantContext | null;
  setUser: (user: AuthUser, context?: AuthContextPayload) => void;
  setTenantContext: (context: AuthContextPayload) => void;
  setCurrentCompany: (companyId: string | null) => void;
  setSelectedTenant: (tenantId: string | null) => void;
  logout: () => void;
}

function normalizeContext(context?: AuthContextPayload): TenantContext | null {
  if (!context) return null;
  return {
    tenant: context.tenant || null,
    company_ids: context.company_ids || [],
    companies: context.companies || [],
    managed_tenants: context.managed_tenants || [],
  };
}

function defaultCompanyId(user: AuthUser, context: TenantContext | null): string | null {
  if (user.is_super_admin) return '__ALL__';
  return user.company_id || context?.companies[0]?.id || null;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      currentCompanyId: null,
      selectedTenantId: null,
      tenantContext: null,
      setUser: (user, contextPayload) => {
        const context = normalizeContext(contextPayload);
        set({
          user,
          tenantContext: context,
          currentCompanyId: defaultCompanyId(user, context),
          selectedTenantId: user.is_super_admin ? null : user.tenant_id || context?.tenant?.id || null,
          isAuthenticated: true,
        });
      },
      setTenantContext: (contextPayload) => {
        const context = normalizeContext(contextPayload);
        set((state) => ({
          tenantContext: context,
          currentCompanyId: state.currentCompanyId || (state.user ? defaultCompanyId(state.user, context) : null),
          selectedTenantId: state.selectedTenantId || (state.user?.is_super_admin ? null : context?.tenant?.id || null),
        }));
      },
      setCurrentCompany: (companyId) => set((state) => {
        const company = state.tenantContext?.companies.find((item) => item.id === companyId);
        return {
          currentCompanyId: companyId,
          selectedTenantId: companyId === '__ALL__' ? state.selectedTenantId : company?.tenant_id || state.selectedTenantId,
        };
      }),
      setSelectedTenant: (tenantId) => set({ selectedTenantId: tenantId, currentCompanyId: '__ALL__' }),
      logout: () => set({
        user: null,
        isAuthenticated: false,
        currentCompanyId: null,
        selectedTenantId: null,
        tenantContext: null,
      }),
    }),
    {
      name: 'cirtell-auth',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
