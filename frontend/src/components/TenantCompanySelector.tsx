import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, ChevronRight, Crown, Radio, Search, Store, Wrench, X } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuthStore, type CompanyRecord, type TenantRecord } from '../stores/authStore';

interface TenantTreeNode {
  tenant: TenantRecord;
  children: TenantTreeNode[];
}

const groupConfig: Record<string, { icon: typeof Radio; label: string }> = {
  telco: { icon: Radio, label: 'Telecommunication' },
  si: { icon: Wrench, label: 'System Integrator' },
  vendor: { icon: Store, label: 'Vendor' },
};

function buildTenantTree(tenants: TenantRecord[]): TenantTreeNode[] {
  const map = new Map<string, TenantTreeNode>();
  tenants.forEach((tenant) => map.set(tenant.id, { tenant, children: [] }));

  const roots: TenantTreeNode[] = [];
  tenants.forEach((tenant) => {
    const node = map.get(tenant.id);
    if (!node) return;
    if (tenant.parent_tenant_id && map.has(tenant.parent_tenant_id)) {
      map.get(tenant.parent_tenant_id)?.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const promoted: TenantTreeNode[] = [];
  for (const root of roots) {
    promoted.push(root);
    if (root.tenant.is_platform_tenant === 1 || root.tenant.is_platform_tenant === true) {
      promoted.push(...root.children);
      root.children = [];
    }
  }

  const sortNodes = (nodes: TenantTreeNode[]) => {
    nodes.sort((a, b) => {
      const aPlatform = a.tenant.is_platform_tenant === 1 || a.tenant.is_platform_tenant === true;
      const bPlatform = b.tenant.is_platform_tenant === 1 || b.tenant.is_platform_tenant === true;
      if (aPlatform) return -1;
      if (bPlatform) return 1;
      return a.tenant.name.localeCompare(b.tenant.name);
    });
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(promoted);
  return promoted;
}

function tenantMatches(node: TenantTreeNode, query: string, companiesByTenant: Record<string, CompanyRecord[]>): boolean {
  const q = query.toLowerCase();
  if (node.tenant.name.toLowerCase().includes(q)) return true;
  if ((companiesByTenant[node.tenant.id] || []).some((company) =>
    company.name.toLowerCase().includes(q) || company.code.toLowerCase().includes(q)
  )) return true;
  return node.children.some((child) => tenantMatches(child, query, companiesByTenant));
}

export function TenantCompanySelector() {
  const {
    user,
    tenantContext,
    currentCompanyId,
    selectedTenantId,
    setCurrentCompany,
    setSelectedTenant,
  } = useAuthStore();
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const companies = useMemo(() => tenantContext?.companies || [], [tenantContext?.companies]);
  const isSuperAdmin = user?.is_super_admin === true;
  const canUseScope = isSuperAdmin || companies.length > 1;

  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      try {
        const response = await apiRequest<{ tenants: TenantRecord[] }>('/api/admin/tenants');
        if (cancelled) return;
        const nextTenants = response.tenants || [];
        setTenants(nextTenants);
        setExpanded(new Set(nextTenants.filter((tenant) => tenant.group_type || tenant.is_platform_tenant).map((tenant) => tenant.id)));
      } catch {
        if (!cancelled) setTenants([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    if (open) document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const companiesByTenant = useMemo(() => {
    return companies.reduce<Record<string, CompanyRecord[]>>((acc, company) => {
      const key = company.tenant_id || 'unassigned';
      if (!acc[key]) acc[key] = [];
      acc[key].push(company);
      return acc;
    }, {});
  }, [companies]);

  const tenantList = tenants.length ? tenants : (tenantContext?.tenant ? [tenantContext.tenant] : []);
  const baseTree = buildTenantTree(tenantList);
  const tree = query ? baseTree.filter((node) => tenantMatches(node, query, companiesByTenant)) : baseTree;

  if (!canUseScope) return null;

  const currentCompany = currentCompanyId && currentCompanyId !== '__ALL__'
    ? companies.find((company) => company.id === currentCompanyId)
    : null;
  const currentTenant = selectedTenantId ? tenants.find((tenant) => tenant.id === selectedTenantId) || tenantContext?.tenant : null;
  const label = currentCompany?.name || (currentTenant ? `${currentTenant.name} (All)` : 'All Groups & Companies');

  const selectAll = () => {
    setSelectedTenant(null);
    setCurrentCompany('__ALL__');
    setOpen(false);
    setQuery('');
  };

  const selectTenant = (tenant: TenantRecord) => {
    const isPlatform = tenant.is_platform_tenant === 1 || tenant.is_platform_tenant === true;
    setSelectedTenant(isPlatform ? null : tenant.id);
    setCurrentCompany('__ALL__');
    setOpen(false);
    setQuery('');
  };

  const selectCompany = (company: CompanyRecord) => {
    setCurrentCompany(company.id);
    setOpen(false);
    setQuery('');
  };

  const toggle = (tenantId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(tenantId)) next.delete(tenantId);
      else next.add(tenantId);
      return next;
    });
  };

  const renderTenant = (node: TenantTreeNode, depth: number): React.ReactNode => {
    const { tenant, children } = node;
    const tenantCompanies = companiesByTenant[tenant.id] || [];
    const isPlatform = tenant.is_platform_tenant === 1 || tenant.is_platform_tenant === true;
    const meta = tenant.group_type ? groupConfig[tenant.group_type] : null;
    const Icon = isPlatform ? Crown : meta?.icon || Building2;
    const isExpanded = expanded.has(tenant.id);
    const selected = currentCompanyId === '__ALL__' && (selectedTenantId === tenant.id || (isPlatform && !selectedTenantId));
    const hasChildren = children.length > 0 || tenantCompanies.length > 0;

    return (
      <div key={tenant.id}>
        <div
          className={`flex items-center gap-2 px-3 py-2 hover:bg-black/[0.04] transition-colors ${selected ? 'bg-signal-teal/10' : ''}`}
          style={{ paddingLeft: `${12 + depth * 18}px` }}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (hasChildren) toggle(tenant.id);
            }}
            className={`w-5 h-5 flex items-center justify-center rounded ${hasChildren ? 'hover:bg-gray-200' : 'opacity-0'}`}
          >
            <ChevronRight className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          </button>
          <button type="button" onClick={() => selectTenant(tenant)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
            <span className={`h-8 w-8 rounded-apple flex items-center justify-center ${selected ? 'bg-signal-teal/15' : 'bg-gray-100'}`}>
              <Icon className={`h-4 w-4 ${selected ? 'text-signal-teal' : 'text-gray-500'}`} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-caption font-semibold text-gray-800 truncate">{tenant.name}</span>
              <span className="block text-micro text-gray-400 truncate">{meta?.label || tenant.domain || 'Group scope'}</span>
            </span>
            {selected && <Check className="h-4 w-4 text-signal-teal" />}
          </button>
        </div>

        {isExpanded && (
          <div className="animate-dropdown-in">
            {tenantCompanies.map((company) => {
              const companySelected = currentCompanyId === company.id;
              return (
                <button
                  key={company.id}
                  type="button"
                  onClick={() => selectCompany(company)}
                  className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-black/[0.04] transition-colors text-left ${companySelected ? 'bg-signal-teal/10' : ''}`}
                  style={{ paddingLeft: `${46 + depth * 18}px` }}
                >
                  <span className={`h-7 w-7 rounded-apple flex items-center justify-center text-micro font-bold ${companySelected ? 'bg-signal-teal/15 text-signal-teal' : 'bg-gray-100 text-gray-500'}`}>
                    {company.code.slice(0, 2)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-caption font-medium text-gray-700 truncate">{company.name}</span>
                    <span className="block text-micro text-gray-400 truncate">{company.code}</span>
                  </span>
                  {companySelected && <Check className="h-4 w-4 text-signal-teal" />}
                </button>
              );
            })}
            {children.map((child) => renderTenant(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-gray-50 hover:bg-black/[0.04] border border-black/[0.06] rounded-apple transition-all"
      >
        <Building2 className="h-5 w-5 text-gray-500 flex-shrink-0" />
        <span className="text-caption font-medium text-gray-700 truncate flex-1 text-left">{label}</span>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 mt-2 w-[min(22rem,calc(100vw-1rem))] bg-[#F9FAFB] border border-black/[0.06] rounded-apple shadow-apple z-50 max-h-[min(30rem,calc(100dvh-10rem))] overflow-hidden animate-dropdown-in">
          <div className="p-3 border-b border-black/[0.06]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search groups or companies..."
                className="input-base pl-9 pr-9 py-2"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[23rem] overflow-y-auto py-1">
            {isSuperAdmin && (
              <button
                type="button"
                onClick={selectAll}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-black/[0.04] border-b border-black/[0.04] ${currentCompanyId === '__ALL__' && !selectedTenantId ? 'bg-signal-teal/10' : ''}`}
              >
                <span className="h-8 w-8 rounded-apple bg-deep-teal/10 flex items-center justify-center">
                  <Crown className="h-4 w-4 text-signal-teal" />
                </span>
                <span className="flex-1 min-w-0 text-left">
                  <span className="block text-caption font-semibold text-gray-800 truncate">All Groups & Companies</span>
                  <span className="block text-micro text-gray-400">Portfolio view across every tenant</span>
                </span>
                {currentCompanyId === '__ALL__' && !selectedTenantId && <Check className="h-4 w-4 text-signal-teal" />}
              </button>
            )}

            {loading ? (
              <div className="px-4 py-5 text-caption text-gray-500">Loading groups...</div>
            ) : tree.length > 0 ? (
              tree.map((node) => renderTenant(node, 0))
            ) : (
              companies.map((company) => {
                const selected = currentCompanyId === company.id;
                return (
                  <button
                    key={company.id}
                    type="button"
                    onClick={() => selectCompany(company)}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-black/[0.04] ${selected ? 'bg-signal-teal/10' : ''}`}
                  >
                    <span className="h-8 w-8 rounded-apple bg-gray-100 flex items-center justify-center text-micro font-bold text-gray-500">{company.code.slice(0, 2)}</span>
                    <span className="flex-1 text-left min-w-0">
                      <span className="block text-caption font-medium text-gray-800 truncate">{company.name}</span>
                      <span className="block text-micro text-gray-400 truncate">{company.code}</span>
                    </span>
                    {selected && <Check className="h-4 w-4 text-signal-teal" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
