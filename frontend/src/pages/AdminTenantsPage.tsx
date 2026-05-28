import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Crown,
  Globe,
  Loader2,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Store,
  Wrench,
  X,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuthStore, type CompanyRecord, type TenantRecord } from '../stores/authStore';

interface Tenant extends TenantRecord {
  is_active?: number;
  parent_name?: string | null;
  company_count?: number;
  created_at?: string;
  allowed_apps?: string[];
}

interface TenantNode {
  tenant: Tenant;
  children: TenantNode[];
}

interface TenantForm {
  name: string;
  domain: string;
  parent_tenant_id: string;
  group_type: string;
  is_active: boolean;
}

interface CompanyForm {
  tenant_id: string;
  code: string;
  name: string;
  logo_url: string;
}

const emptyTenantForm: TenantForm = {
  name: '',
  domain: '',
  parent_tenant_id: '',
  group_type: '',
  is_active: true,
};

const emptyCompanyForm: CompanyForm = {
  tenant_id: '',
  code: '',
  name: '',
  logo_url: '',
};

const groupMeta: Record<string, { label: string; icon: typeof Radio }> = {
  telco: { label: 'Telecommunication', icon: Radio },
  si: { label: 'System Integrator', icon: Wrench },
  vendor: { label: 'Vendor', icon: Store },
};

function isPlatform(tenant: Tenant) {
  return tenant.is_platform_tenant === true || tenant.is_platform_tenant === 1;
}

function buildTree(tenants: Tenant[]): TenantNode[] {
  const map = new Map<string, TenantNode>();
  tenants.forEach((tenant) => map.set(tenant.id, { tenant, children: [] }));
  const roots: TenantNode[] = [];

  tenants.forEach((tenant) => {
    const node = map.get(tenant.id);
    if (!node) return;
    if (tenant.parent_tenant_id && map.has(tenant.parent_tenant_id)) {
      map.get(tenant.parent_tenant_id)?.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const promoted: TenantNode[] = [];
  for (const root of roots) {
    promoted.push(root);
    if (isPlatform(root.tenant)) {
      promoted.push(...root.children);
      root.children = [];
    }
  }

  const sortNodes = (nodes: TenantNode[]) => {
    nodes.sort((a, b) => {
      if (isPlatform(a.tenant)) return -1;
      if (isPlatform(b.tenant)) return 1;
      return a.tenant.name.localeCompare(b.tenant.name);
    });
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(promoted);
  return promoted;
}

export function AdminTenantsPage() {
  const { user } = useAuthStore();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showTenantForm, setShowTenantForm] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [tenantForm, setTenantForm] = useState<TenantForm>(emptyTenantForm);
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [companyForm, setCompanyForm] = useState<CompanyForm>(emptyCompanyForm);

  const canManage = user?.is_super_admin === true;

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [tenantResult, companyResult] = await Promise.all([
        apiRequest<{ tenants: Tenant[] }>('/api/admin/tenants'),
        apiRequest<{ companies: CompanyRecord[] }>('/api/admin/companies'),
      ]);
      setTenants(tenantResult.tenants || []);
      setCompanies(companyResult.companies || []);
      setExpanded(new Set((tenantResult.tenants || []).filter((tenant) => tenant.group_type || isPlatform(tenant)).map((tenant) => tenant.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenant hierarchy');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const tree = useMemo(() => buildTree(tenants), [tenants]);
  const companiesByTenant = useMemo(() => {
    return companies.reduce<Record<string, CompanyRecord[]>>((acc, company) => {
      const key = company.tenant_id || 'unassigned';
      if (!acc[key]) acc[key] = [];
      acc[key].push(company);
      return acc;
    }, {});
  }, [companies]);

  const openTenantForm = (tenant?: Tenant) => {
    if (tenant) {
      setEditingTenant(tenant);
      setTenantForm({
        name: tenant.name,
        domain: tenant.domain || '',
        parent_tenant_id: tenant.parent_tenant_id || '',
        group_type: tenant.group_type || '',
        is_active: tenant.is_active !== 0,
      });
    } else {
      setEditingTenant(null);
      setTenantForm(emptyTenantForm);
    }
    setShowTenantForm(true);
  };

  const openCompanyForm = (tenantId?: string) => {
    setCompanyForm({ ...emptyCompanyForm, tenant_id: tenantId || '' });
    setShowCompanyForm(true);
  };

  const submitTenant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...tenantForm,
        parent_tenant_id: tenantForm.parent_tenant_id || null,
        group_type: tenantForm.group_type || null,
      };
      if (editingTenant) {
        await apiRequest(`/api/admin/tenants/${editingTenant.id}`, { method: 'PUT', body: payload });
      } else {
        await apiRequest('/api/admin/tenants', { method: 'POST', body: payload });
      }
      setShowTenantForm(false);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save group');
    } finally {
      setSaving(false);
    }
  };

  const submitCompany = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiRequest('/api/admin/companies', {
        method: 'POST',
        body: { ...companyForm, code: companyForm.code.toUpperCase() },
      });
      setShowCompanyForm(false);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create company');
    } finally {
      setSaving(false);
    }
  };

  const toggleExpand = (tenantId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(tenantId)) next.delete(tenantId);
      else next.add(tenantId);
      return next;
    });
  };

  const renderTenantRow = (node: TenantNode, depth: number): React.ReactNode => {
    const tenant = node.tenant;
    const meta = tenant.group_type ? groupMeta[tenant.group_type] : null;
    const Icon = isPlatform(tenant) ? Crown : meta?.icon || Globe;
    const children = node.children;
    const tenantCompanies = companiesByTenant[tenant.id] || [];
    const hasChildren = children.length > 0 || tenantCompanies.length > 0;
    const isOpen = expanded.has(tenant.id);

    return (
      <div key={tenant.id}>
        <div
          className={`flex items-center gap-2 px-4 py-3 hover:bg-gray-50 border-b border-gray-100 transition-colors ${depth === 0 ? 'bg-gray-50/50' : ''}`}
          style={{ paddingLeft: `${16 + depth * 28}px` }}
        >
          <button
            type="button"
            onClick={() => hasChildren && toggleExpand(tenant.id)}
            className={`w-5 h-5 flex items-center justify-center rounded ${hasChildren ? 'hover:bg-gray-200' : 'opacity-0'}`}
          >
            {hasChildren && (isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />)}
          </button>

          <div className={`h-8 w-8 rounded-apple flex items-center justify-center ${isPlatform(tenant) ? 'bg-verified-green/10' : 'bg-signal-teal/10'}`}>
            <Icon className={`h-4 w-4 ${isPlatform(tenant) ? 'text-verified-green' : 'text-signal-teal'}`} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900 truncate">{tenant.name}</span>
              {isPlatform(tenant) && <span className="px-1.5 py-0.5 text-[10px] font-bold bg-verified-green/10 text-verified-green rounded">PLATFORM</span>}
              {meta && <span className="px-1.5 py-0.5 text-[10px] font-bold bg-signal-teal/10 text-signal-teal rounded">{meta.label.toUpperCase()}</span>}
            </div>
            <p className="text-micro text-gray-500 truncate">{tenant.domain || 'No domain'} - {tenant.company_count || tenantCompanies.length} companies</p>
          </div>

          {canManage && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => openCompanyForm(tenant.id)}
                className="p-2 text-gray-400 hover:text-signal-teal hover:bg-signal-teal/10 rounded-apple transition-colors"
                title="Add company"
              >
                <Building2 className="h-4 w-4" />
              </button>
              {!isPlatform(tenant) && (
                <button
                  type="button"
                  onClick={() => openTenantForm(tenant)}
                  className="p-2 text-gray-400 hover:text-signal-teal hover:bg-signal-teal/10 rounded-apple transition-colors"
                  title="Edit group"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>

        {isOpen && (
          <div className="animate-dropdown-in">
            {tenantCompanies.map((company) => (
              <div
                key={company.id}
                className="flex items-center gap-3 px-4 py-2.5 bg-white hover:bg-gray-50 border-b border-gray-50"
                style={{ paddingLeft: `${58 + depth * 28}px` }}
              >
                <span className="h-7 w-7 rounded-apple bg-gray-100 text-gray-500 flex items-center justify-center text-micro font-bold">
                  {company.code.slice(0, 2)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-caption font-medium text-gray-800 truncate">{company.name}</p>
                  <p className="text-micro text-gray-400 truncate">{company.code}</p>
                </div>
              </div>
            ))}
            {children.map((child) => renderTenantRow(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="font-display text-tile font-semibold text-gray-900">Group Hierarchy & App Access</h1>
          <p className="text-gray-600 mt-1">{tenants.length} groups - {companies.length} companies configured</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-apple transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => openTenantForm()}
              className="flex items-center gap-2 px-4 py-2 bg-signal-teal text-white rounded-apple transition-colors hover:bg-signal-teal/90"
            >
              <Plus className="h-5 w-5" />
              New Group
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-signal-teal/10 border border-signal-teal/20 rounded-apple-lg p-4 text-caption text-deep-teal">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard label="Groups" value={tenants.length.toString()} icon={Globe} />
        <SummaryCard label="Companies" value={companies.length.toString()} icon={Building2} />
        <SummaryCard label="Platform Admin" value={canManage ? 'Enabled' : 'Read only'} icon={Crown} />
      </div>

      <div className="bg-white rounded-apple-lg border border-gray-100 shadow-none overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sub-heading font-semibold text-gray-900">Tenant Tree</h2>
          <p className="text-caption text-gray-500 mt-0.5">Platform group, category groups, tenant groups, and companies.</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-caption text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading groups...
          </div>
        ) : tree.length > 0 ? (
          <div>{tree.map((node) => renderTenantRow(node, 0))}</div>
        ) : (
          <div className="text-center py-16">
            <Globe className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-caption text-gray-500">No groups configured</p>
          </div>
        )}
      </div>

      {showTenantForm && (
        <TenantFormModal
          title={editingTenant ? 'Edit Group' : 'Create Group'}
          form={tenantForm}
          tenants={tenants}
          saving={saving}
          onChange={(updates) => setTenantForm((current) => ({ ...current, ...updates }))}
          onClose={() => setShowTenantForm(false)}
          onSubmit={submitTenant}
        />
      )}

      {showCompanyForm && (
        <CompanyFormModal
          form={companyForm}
          tenants={tenants}
          saving={saving}
          onChange={(updates) => setCompanyForm((current) => ({ ...current, ...updates }))}
          onClose={() => setShowCompanyForm(false)}
          onSubmit={submitCompany}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Globe }) {
  return (
    <div className="bg-white rounded-apple-lg shadow-none border border-gray-100 p-5 hover:shadow-apple-sm transition-all">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-caption font-medium text-gray-500">{label}</p>
          <p className="text-tile font-semibold text-gray-900 mt-2">{value}</p>
        </div>
        <div className="w-12 h-12 rounded-apple-xl flex items-center justify-center bg-signal-teal/15 text-signal-teal">
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}

function TenantFormModal({
  title,
  form,
  tenants,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  title: string;
  form: TenantForm;
  tenants: Tenant[];
  saving: boolean;
  onChange: (updates: Partial<TenantForm>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-apple-lg shadow-apple max-w-lg w-full mx-4" onClick={(event) => event.stopPropagation()}>
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sub-heading font-bold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded-apple hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="p-6 space-y-4">
          <Field label="Group Name *">
            <input required value={form.name} onChange={(event) => onChange({ name: event.target.value })} className="input-base" placeholder="e.g., Vietnam Mobile Group" />
          </Field>
          <Field label="Domain *">
            <input required value={form.domain} onChange={(event) => onChange({ domain: event.target.value })} className="input-base" placeholder="example.com" />
          </Field>
          <Field label="Parent Group">
            <select value={form.parent_tenant_id} onChange={(event) => onChange({ parent_tenant_id: event.target.value })} className="input-base">
              <option value="">No parent</option>
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Group Type">
            <select value={form.group_type} onChange={(event) => onChange({ group_type: event.target.value })} className="input-base">
              <option value="">Tenant group</option>
              <option value="telco">Telecommunication category</option>
              <option value="si">System integrator category</option>
              <option value="vendor">Vendor category</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 text-caption text-gray-700">
            <input type="checkbox" checked={form.is_active} onChange={(event) => onChange({ is_active: event.target.checked })} className="accent-signal-teal" />
            Active
          </label>
          <ModalActions saving={saving} onClose={onClose} submitLabel="Save Group" />
        </form>
      </div>
    </div>
  );
}

function CompanyFormModal({
  form,
  tenants,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  form: CompanyForm;
  tenants: Tenant[];
  saving: boolean;
  onChange: (updates: Partial<CompanyForm>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-apple-lg shadow-apple max-w-lg w-full mx-4" onClick={(event) => event.stopPropagation()}>
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sub-heading font-bold text-gray-900">Create Company</h2>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded-apple hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="p-6 space-y-4">
          <Field label="Tenant Group *">
            <select required value={form.tenant_id} onChange={(event) => onChange({ tenant_id: event.target.value })} className="input-base">
              <option value="">Select group...</option>
              {tenants.filter((tenant) => !tenant.group_type && !isPlatform(tenant)).map((tenant) => (
                <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Company Code *">
            <input required value={form.code} onChange={(event) => onChange({ code: event.target.value.toUpperCase() })} className="input-base uppercase" placeholder="VNM" />
          </Field>
          <Field label="Company Name *">
            <input required value={form.name} onChange={(event) => onChange({ name: event.target.value })} className="input-base" placeholder="Vietnam Mobile" />
          </Field>
          <Field label="Logo URL">
            <input value={form.logo_url} onChange={(event) => onChange({ logo_url: event.target.value })} className="input-base" placeholder="https://..." />
          </Field>
          <ModalActions saving={saving} onClose={onClose} submitLabel="Create Company" />
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-caption font-medium text-gray-700 mb-2">{label}</label>
      {children}
    </div>
  );
}

function ModalActions({ saving, onClose, submitLabel }: { saving: boolean; onClose: () => void; submitLabel: string }) {
  return (
    <div className="flex justify-end gap-3 pt-4">
      <button type="button" onClick={onClose} className="px-5 py-2.5 text-gray-700 hover:bg-gray-100 rounded-apple-md transition-colors" disabled={saving}>
        Cancel
      </button>
      <button type="submit" className="px-5 py-2.5 bg-signal-teal text-white rounded-apple-md transition-colors hover:bg-signal-teal/90 disabled:opacity-50 flex items-center gap-2" disabled={saving}>
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        {submitLabel}
      </button>
    </div>
  );
}
