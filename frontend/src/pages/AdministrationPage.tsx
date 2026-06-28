import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Crown,
  Database,
  Globe,
  LayoutDashboard,
  Loader2,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Store,
  UserCheck,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuthStore, type CompanyRecord, type TenantRecord } from '../stores/authStore';

type AdminView = 'overview' | 'users' | 'groups' | 'companies' | 'audit';

interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  adminUsers: number;
  recentLogins: number;
  tenants: number;
  companies: number;
  projects: number;
  auditEvents: number;
}

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'Admin' | 'User' | 'Viewer';
  status: 'active' | 'suspended' | 'deleted';
  last_login?: string | null;
  created_at?: string | null;
  tenant_id?: string | null;
  company_id?: string | null;
  tenant_name?: string | null;
  company_name?: string | null;
  is_super_admin?: number | boolean | null;
  company_count?: number | null;
}

interface UserInvitation {
  id: string;
  email: string;
  name?: string | null;
  role: 'Admin' | 'User' | 'Viewer';
  status: 'pending' | 'accepted' | 'cancelled' | 'expired';
  expires_at?: string | null;
  accepted_at?: string | null;
  created_at?: string | null;
  tenant_id?: string | null;
  company_id?: string | null;
  tenant_name?: string | null;
  company_name?: string | null;
  invited_by_name?: string | null;
}

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

interface AuditEvent {
  id: string;
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  details?: string | null;
  created_at: string;
  user_name?: string | null;
  user_email?: string | null;
  tenant_name?: string | null;
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

interface UserForm {
  name: string;
  role: 'Admin' | 'User' | 'Viewer';
  status: 'active' | 'suspended' | 'deleted';
  company_id: string;
  is_super_admin: boolean;
}

interface InviteForm {
  email: string;
  name: string;
  role: 'Admin' | 'User' | 'Viewer';
  company_id: string;
}

const viewMeta: Record<AdminView, { path: string; label: string; icon: LucideIcon; description: string }> = {
  overview: { path: '/admin', label: 'Overview', icon: LayoutDashboard, description: 'Platform health and shortcuts' },
  users: { path: '/admin/users', label: 'Users', icon: Users, description: 'Accounts and access level' },
  groups: { path: '/admin/tenants', label: 'Groups', icon: Globe, description: 'Tenant hierarchy' },
  companies: { path: '/admin/companies', label: 'Companies', icon: Building2, description: 'Company records' },
  audit: { path: '/admin/audit', label: 'Audit', icon: Activity, description: 'Recent admin activity' },
};

const emptyStats: AdminStats = {
  totalUsers: 0,
  activeUsers: 0,
  adminUsers: 0,
  recentLogins: 0,
  tenants: 0,
  companies: 0,
  projects: 0,
  auditEvents: 0,
};

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

const groupMeta: Record<string, { label: string; icon: LucideIcon }> = {
  telco: { label: 'Telecommunication', icon: Globe },
  si: { label: 'System Integrator', icon: Wrench },
  vendor: { label: 'Vendor', icon: Store },
};

function currentView(pathname: string): AdminView {
  if (pathname.startsWith('/admin/users')) return 'users';
  if (pathname.startsWith('/admin/tenants')) return 'groups';
  if (pathname.startsWith('/admin/companies')) return 'companies';
  if (pathname.startsWith('/admin/audit')) return 'audit';
  return 'overview';
}

function isPlatform(tenant: Tenant) {
  return tenant.is_platform_tenant === true || tenant.is_platform_tenant === 1;
}

function isTruthy(value: unknown) {
  return value === true || value === 1 || value === '1';
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

function formatDate(value?: string | null) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?';
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function AdministrationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, selectedTenantId, currentCompanyId } = useAuthStore();
  const view = currentView(location.pathname);
  const canManageGroups = user?.is_super_admin === true;
  const canManageUsers = user?.role === 'Admin' || user?.is_super_admin === true;

  const [stats, setStats] = useState<AdminStats>(emptyStats);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invitations, setInvitations] = useState<UserInvitation[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const [statsResult, usersResult, invitationsResult, tenantsResult, companiesResult, auditResult] = await Promise.all([
        apiRequest<{ stats: AdminStats }>('/api/admin/stats'),
        apiRequest<{ users: AdminUser[] }>('/api/admin/users'),
        apiRequest<{ invitations: UserInvitation[] }>('/api/admin/invitations'),
        apiRequest<{ tenants: Tenant[] }>('/api/admin/tenants'),
        apiRequest<{ companies: CompanyRecord[] }>('/api/admin/companies'),
        apiRequest<{ audit: AuditEvent[] }>('/api/admin/audit-log'),
      ]);
      setStats(statsResult.stats || emptyStats);
      setUsers(usersResult.users || []);
      setInvitations(invitationsResult.invitations || []);
      setTenants(tenantsResult.tenants || []);
      setCompanies(companiesResult.companies || []);
      setAudit(auditResult.audit || []);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load administration data'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, selectedTenantId, currentCompanyId]);

  const refresh = () => void load(true);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="font-display text-tile font-semibold text-gray-900">Administration</h1>
          <p className="mt-1 text-caption text-gray-500">Cirtell control center for users, companies, groups, and audit activity.</p>
        </div>
        <button type="button" onClick={refresh} className="btn-secondary w-fit" disabled={refreshing || loading}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid gap-3 xl:grid-cols-5">
        {(Object.keys(viewMeta) as AdminView[]).map((key) => {
          const meta = viewMeta[key];
          const Icon = meta.icon;
          const active = view === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => navigate(meta.path)}
              className={`rounded-apple-md border p-4 text-left transition-all ${
                active
                  ? 'border-signal-teal bg-signal-teal/10 shadow-sm shadow-signal-teal/5'
                  : 'border-gray-100 bg-white hover:border-signal-teal/30 hover:bg-signal-teal/5'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`flex h-9 w-9 items-center justify-center rounded-apple ${active ? 'bg-signal-teal text-white' : 'bg-gray-100 text-gray-500'}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className={`block text-caption font-semibold ${active ? 'text-deep-teal' : 'text-gray-900'}`}>{meta.label}</span>
                  <span className="block text-micro text-gray-500">{meta.description}</span>
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-apple-lg border border-signal-teal/20 bg-signal-teal/5 p-4 text-caption font-medium text-deep-teal">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[360px] items-center justify-center rounded-apple-lg border border-gray-100 bg-white">
          <Loader2 className="h-7 w-7 animate-spin text-signal-teal" />
        </div>
      ) : (
        <>
          {view === 'overview' && <AdminOverview stats={stats} users={users} companies={companies} audit={audit} onNavigate={(next) => navigate(viewMeta[next].path)} />}
          {view === 'users' && <AdminUsers users={users} invitations={invitations} companies={companies} canManage={canManageUsers} onChanged={refresh} />}
          {view === 'groups' && <AdminGroups tenants={tenants} companies={companies} canManage={canManageGroups} onChanged={refresh} />}
          {view === 'companies' && <AdminCompanies companies={companies} tenants={tenants} canManage={canManageUsers} onChanged={refresh} />}
          {view === 'audit' && <AdminAudit audit={audit} />}
        </>
      )}
    </div>
  );
}

function AdminOverview({
  stats,
  users,
  companies,
  audit,
  onNavigate,
}: {
  stats: AdminStats;
  users: AdminUser[];
  companies: CompanyRecord[];
  audit: AuditEvent[];
  onNavigate: (view: AdminView) => void;
}) {
  const recentUsers = users.slice(0, 5);
  const recentAudit = audit.slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Users} label="Total Users" value={stats.totalUsers} detail={`${stats.adminUsers} administrators`} />
        <MetricCard icon={UserCheck} label="Active Users" value={stats.activeUsers} detail={`${stats.recentLogins} logins this week`} />
        <MetricCard icon={Globe} label="Groups" value={stats.tenants} detail={`${stats.companies} companies`} />
        <MetricCard icon={Database} label="Projects" value={stats.projects} detail={`${stats.auditEvents} audit events`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.85fr]">
        <div className="rounded-apple-lg border border-gray-100 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sub-heading font-semibold text-gray-900">Quick Actions</h2>
              <p className="text-caption text-gray-500">Common administration tasks</p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <QuickAction icon={Users} title="Manage Users" description="Review account status and roles" onClick={() => onNavigate('users')} />
            <QuickAction icon={Globe} title="Group Hierarchy" description="Manage tenant groups and categories" onClick={() => onNavigate('groups')} />
            <QuickAction icon={Building2} title="Companies" description="Configure company records and logos" onClick={() => onNavigate('companies')} />
            <QuickAction icon={Activity} title="Audit Activity" description="Inspect recent system changes" onClick={() => onNavigate('audit')} />
          </div>
        </div>

        <div className="rounded-apple-lg border border-gray-100 bg-white p-5">
          <h2 className="mb-4 text-sub-heading font-semibold text-gray-900">Recent Users</h2>
          <div className="space-y-3">
            {recentUsers.map((item) => (
              <UserRowCompact key={item.id} user={item} />
            ))}
            {recentUsers.length === 0 && <EmptyState icon={Users} text="No users found" compact />}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-apple-lg border border-gray-100 bg-white p-5">
          <h2 className="mb-4 text-sub-heading font-semibold text-gray-900">Companies</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {companies.slice(0, 6).map((company) => (
              <div key={company.id} className="rounded-apple border border-gray-100 bg-gray-50 p-3">
                <p className="text-caption font-semibold text-gray-900">{company.name}</p>
                <p className="text-micro text-gray-500">{company.code} - {company.tenant_name || 'Tenant'}</p>
              </div>
            ))}
          </div>
          {companies.length === 0 && <EmptyState icon={Building2} text="No companies configured" compact />}
        </div>
        <div className="rounded-apple-lg border border-gray-100 bg-white p-5">
          <h2 className="mb-4 text-sub-heading font-semibold text-gray-900">Recent Audit</h2>
          <AuditList audit={recentAudit} compact />
        </div>
      </div>
    </div>
  );
}

function AdminUsers({
  users,
  invitations,
  companies,
  canManage,
  onChanged,
}: {
  users: AdminUser[];
  invitations: UserInvitation[];
  companies: CompanyRecord[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const pendingInvitations = invitations.filter((item) => item.status === 'pending');

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((item) => {
      if (role !== 'all' && item.role !== role) return false;
      if (status !== 'all' && item.status !== status) return false;
      if (!query) return true;
      return [item.name, item.email, item.role, item.tenant_name, item.company_name].filter(Boolean).join(' ').toLowerCase().includes(query);
    });
  }, [role, search, status, users]);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Users"
        subtitle="Manage accounts, invites, roles, status, and primary company"
        action={canManage ? (
          <button type="button" onClick={() => setShowInvite(true)} className="btn-primary">
            <Mail className="h-4 w-4" />
            Invite User
          </button>
        ) : null}
      />
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard icon={Users} label="Total" value={users.length} detail="Visible users" />
        <MetricCard icon={Check} label="Active" value={users.filter((item) => item.status === 'active').length} detail="Can sign in" />
        <MetricCard icon={Shield} label="Admins" value={users.filter((item) => item.role === 'Admin' || isTruthy(item.is_super_admin)).length} detail="Elevated access" />
        <MetricCard icon={Mail} label="Pending Invites" value={pendingInvitations.length} detail="Waiting for first login" />
      </div>

      <PendingInvitations invitations={pendingInvitations} />

      <div className="rounded-apple-lg border border-gray-100 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users..." className="input-base pl-9" />
          </div>
          <select value={role} onChange={(event) => setRole(event.target.value)} className="input-base lg:w-44">
            <option value="all">All Roles</option>
            <option value="Admin">Admin</option>
            <option value="User">User</option>
            <option value="Viewer">Viewer</option>
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="input-base lg:w-44">
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-apple-lg border border-gray-100 bg-white">
        {filtered.length === 0 ? (
          <EmptyState icon={Users} text="No users match the current filters" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  {['User', 'Role', 'Tenant / Company', 'Status', 'Last Login', 'Actions'].map((header) => (
                    <th key={header} className="px-5 py-3 text-left text-micro font-semibold uppercase tracking-wider text-gray-500">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-5 py-4">
                      <UserIdentity user={item} />
                    </td>
                    <td className="px-5 py-4">
                      <RoleBadge user={item} />
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-caption font-medium text-gray-800">{item.tenant_name || '-'}</p>
                      <p className="text-micro text-gray-500">{item.company_name || `${item.company_count || 0} company assignment(s)`}</p>
                    </td>
                    <td className="px-5 py-4"><StatusBadge status={item.status} /></td>
                    <td className="px-5 py-4 text-caption text-gray-500">{formatDate(item.last_login)}</td>
                    <td className="px-5 py-4 text-right">
                      {canManage && (
                        <button type="button" onClick={() => setEditing(item)} className="rounded-apple p-2 text-gray-500 transition-colors hover:bg-signal-teal/10 hover:text-signal-teal" title="Edit user">
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <UserEditModal user={editing} companies={companies} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />
      )}
      {showInvite && (
        <InviteUserModal companies={companies} onClose={() => setShowInvite(false)} onInvited={onChanged} />
      )}
    </div>
  );
}

function PendingInvitations({ invitations }: { invitations: UserInvitation[] }) {
  if (invitations.length === 0) return null;
  return (
    <div className="rounded-apple-lg border border-signal-teal/15 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-caption font-semibold text-gray-900">Pending invitations</h3>
          <p className="text-micro text-gray-500">Invited users become active when they sign in with the same Google email.</p>
        </div>
        <span className="rounded-apple bg-signal-teal/10 px-2.5 py-1 text-micro font-semibold text-signal-teal">
          {invitations.length} pending
        </span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {invitations.slice(0, 6).map((item) => (
          <div key={item.id} className="rounded-apple border border-gray-100 bg-gray-50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-caption font-semibold text-gray-900">{item.name || item.email}</p>
                <p className="truncate text-micro text-gray-500">{item.email}</p>
              </div>
              <span className="rounded-apple bg-white px-2 py-1 text-micro font-semibold text-signal-teal">{item.role}</span>
            </div>
            <p className="mt-2 truncate text-micro text-gray-500">
              {item.company_name || 'Company'} - expires {formatDate(item.expires_at)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminGroups({
  tenants,
  companies,
  canManage,
  onChanged,
}: {
  tenants: Tenant[];
  companies: CompanyRecord[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(tenants.filter((tenant) => tenant.group_type || isPlatform(tenant)).map((tenant) => tenant.id)));
  const [showTenantForm, setShowTenantForm] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [tenantForm, setTenantForm] = useState<TenantForm>(emptyTenantForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    setExpanded(new Set(tenants.filter((tenant) => tenant.group_type || isPlatform(tenant)).map((tenant) => tenant.id)));
  }, [tenants]);

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
    setFormError('');
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

  const submitTenant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFormError('');
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
      onChanged();
    } catch (err) {
      setFormError(errorMessage(err, 'Failed to save group'));
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

  const renderTenantRow = (node: TenantNode, depth: number): ReactNode => {
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
          className={`flex items-center gap-2 border-b border-gray-100 px-4 py-3 transition-colors hover:bg-gray-50 ${depth === 0 ? 'bg-gray-50/50' : ''}`}
          style={{ paddingLeft: `${16 + depth * 28}px` }}
        >
          <button
            type="button"
            onClick={() => hasChildren && toggleExpand(tenant.id)}
            className={`flex h-5 w-5 items-center justify-center rounded ${hasChildren ? 'hover:bg-gray-200' : 'opacity-0'}`}
          >
            {hasChildren && (isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />)}
          </button>
          <div className={`flex h-8 w-8 items-center justify-center rounded-apple ${isPlatform(tenant) ? 'bg-verified-green/10' : 'bg-signal-teal/10'}`}>
            <Icon className={`h-4 w-4 ${isPlatform(tenant) ? 'text-verified-green' : 'text-signal-teal'}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-gray-900">{tenant.name}</span>
              {isPlatform(tenant) && <span className="rounded bg-verified-green/10 px-1.5 py-0.5 text-[10px] font-bold text-verified-green">PLATFORM</span>}
              {meta && <span className="rounded bg-signal-teal/10 px-1.5 py-0.5 text-[10px] font-bold text-signal-teal">{meta.label.toUpperCase()}</span>}
            </div>
            <p className="truncate text-micro text-gray-500">{tenant.domain || 'No domain'} - {tenant.company_count || tenantCompanies.length} companies</p>
          </div>
          {canManage && !isPlatform(tenant) && (
            <button type="button" onClick={() => openTenantForm(tenant)} className="rounded-apple p-2 text-gray-400 transition-colors hover:bg-signal-teal/10 hover:text-signal-teal" title="Edit group">
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </div>
        {isOpen && (
          <div className="animate-dropdown-in">
            {tenantCompanies.map((company) => (
              <div
                key={company.id}
                className="flex items-center gap-3 border-b border-gray-50 bg-white px-4 py-2.5 hover:bg-gray-50"
                style={{ paddingLeft: `${58 + depth * 28}px` }}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-apple bg-gray-100 text-micro font-bold text-gray-500">
                  {company.code.slice(0, 2)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-caption font-medium text-gray-800">{company.name}</p>
                  <p className="truncate text-micro text-gray-400">{company.code}</p>
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
    <div className="space-y-4">
      <SectionHeader
        title="Groups"
        subtitle={`${tenants.length} groups and ${companies.length} companies configured`}
        action={canManage ? <button type="button" onClick={() => openTenantForm()} className="btn-primary"><Plus className="h-4 w-4" />New Group</button> : null}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard icon={Globe} label="Groups" value={tenants.length} detail="Tenant hierarchy" />
        <MetricCard icon={Building2} label="Companies" value={companies.length} detail="Configured companies" />
        <MetricCard icon={Crown} label="Platform Admin" value={canManage ? 'On' : 'Read'} detail={canManage ? 'Can edit groups' : 'Scoped access'} />
      </div>
      <div className="overflow-hidden rounded-apple-lg border border-gray-100 bg-white">
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 className="text-sub-heading font-semibold text-gray-900">Tenant Tree</h2>
          <p className="mt-0.5 text-caption text-gray-500">Platform group, category groups, tenant groups, and companies.</p>
        </div>
        {tree.length > 0 ? <div>{tree.map((node) => renderTenantRow(node, 0))}</div> : <EmptyState icon={Globe} text="No groups configured" />}
      </div>
      {showTenantForm && (
        <TenantFormModal
          title={editingTenant ? 'Edit Group' : 'Create Group'}
          form={tenantForm}
          tenants={tenants}
          saving={saving}
          error={formError}
          onChange={(updates) => setTenantForm((current) => ({ ...current, ...updates }))}
          onClose={() => setShowTenantForm(false)}
          onSubmit={submitTenant}
        />
      )}
    </div>
  );
}

function AdminCompanies({
  companies,
  tenants,
  canManage,
  onChanged,
}: {
  companies: CompanyRecord[];
  tenants: Tenant[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CompanyForm>(emptyCompanyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return companies;
    return companies.filter((company) => [company.name, company.code, company.tenant_name].filter(Boolean).join(' ').toLowerCase().includes(query));
  }, [companies, search]);

  const submitCompany = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await apiRequest('/api/admin/companies', {
        method: 'POST',
        body: { ...form, code: form.code.toUpperCase() },
      });
      setShowForm(false);
      setForm(emptyCompanyForm);
      onChanged();
    } catch (err) {
      setFormError(errorMessage(err, 'Failed to create company'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Companies"
        subtitle="Simple company records used by tenant scope and app ownership"
        action={canManage ? <button type="button" onClick={() => setShowForm(true)} className="btn-primary"><Plus className="h-4 w-4" />New Company</button> : null}
      />
      <div className="rounded-apple-lg border border-gray-100 bg-white p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search companies..." className="input-base pl-9" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((company) => (
          <div key={company.id} className="rounded-apple-lg border border-gray-100 bg-white p-5 transition-all hover:border-signal-teal/30 hover:shadow-apple-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-apple-md bg-signal-teal text-caption font-bold text-white">
                {company.code.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-caption font-semibold text-gray-900">{company.name}</h3>
                <p className="mt-1 text-micro text-gray-500">{company.code}</p>
                <p className="mt-2 truncate text-caption text-gray-500">{company.tenant_name || 'No tenant'}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      {filtered.length === 0 && <EmptyState icon={Building2} text="No companies match the current search" />}
      {showForm && (
        <CompanyFormModal
          form={form}
          tenants={tenants}
          saving={saving}
          error={formError}
          onChange={(updates) => setForm((current) => ({ ...current, ...updates }))}
          onClose={() => setShowForm(false)}
          onSubmit={submitCompany}
        />
      )}
    </div>
  );
}

function AdminAudit({ audit }: { audit: AuditEvent[] }) {
  return (
    <div className="space-y-4">
      <SectionHeader title="Audit" subtitle="Recent admin and data events across the selected scope" />
      <div className="rounded-apple-lg border border-gray-100 bg-white p-5">
        <AuditList audit={audit} />
      </div>
    </div>
  );
}

function InviteUserModal({
  companies,
  onClose,
  onInvited,
}: {
  companies: CompanyRecord[];
  onClose: () => void;
  onInvited: () => void;
}) {
  const [form, setForm] = useState<InviteForm>({
    email: '',
    name: '',
    role: 'User',
    company_id: companies[0]?.id || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<{
    invitation?: { invite_url?: string; expires_at?: string };
    user?: AdminUser;
  } | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setCopied(false);
    try {
      const response = await apiRequest<{
        invitation?: { invite_url?: string; expires_at?: string };
        user?: AdminUser;
      }>('/api/admin/users/invite', {
        method: 'POST',
        body: {
          ...form,
          name: form.name.trim() || undefined,
        },
      });
      setResult(response);
      onInvited();
    } catch (err) {
      setError(errorMessage(err, 'Failed to invite user'));
    } finally {
      setSaving(false);
    }
  };

  const copyInvite = async () => {
    const url = result?.invitation?.invite_url;
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };

  return (
    <Modal title="Invite User" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        {error && <FormError message={error} />}
        <Field label="Email">
          <input
            required
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            className="input-base"
            placeholder="teammate@example.com"
          />
        </Field>
        <Field label="Name">
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            className="input-base"
            placeholder="Optional display name"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role">
            <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as InviteForm['role'] })} className="input-base">
              <option value="Admin">Admin</option>
              <option value="User">User</option>
              <option value="Viewer">Viewer</option>
            </select>
          </Field>
          <Field label="Primary Company">
            <select required value={form.company_id} onChange={(event) => setForm({ ...form, company_id: event.target.value })} className="input-base">
              <option value="">Select company...</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>{company.name} ({company.code})</option>
              ))}
            </select>
          </Field>
        </div>
        {result?.invitation?.invite_url && (
          <div className="rounded-apple-md border border-signal-teal/20 bg-signal-teal/5 p-3">
            <p className="mb-2 text-caption font-semibold text-gray-900">Invite link</p>
            <div className="flex gap-2">
              <input readOnly value={result.invitation.invite_url} className="input-base bg-white text-micro" />
              <button type="button" onClick={() => void copyInvite()} className="btn-secondary shrink-0">
                <Copy className="h-4 w-4" />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="mt-2 text-micro text-gray-500">Expires {formatDate(result.invitation.expires_at)}.</p>
          </div>
        )}
        <ModalActions saving={saving} onClose={onClose} submitLabel={result ? 'Invite Another' : 'Send Invite'} />
      </form>
    </Modal>
  );
}

function MetricCard({ icon: Icon, label, value, detail }: { icon: LucideIcon; label: string; value: string | number; detail: string }) {
  return (
    <div className="rounded-apple-lg border border-gray-100 bg-white p-5 transition-all hover:shadow-apple-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex h-11 w-11 items-center justify-center rounded-apple-lg bg-signal-teal/15 text-signal-teal">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="text-caption font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-tile font-semibold text-gray-900">{value}</p>
      <p className="mt-2 text-micro text-gray-400">{detail}</p>
    </div>
  );
}

function QuickAction({ icon: Icon, title, description, onClick }: { icon: LucideIcon; title: string; description: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-3 rounded-apple-md border border-gray-100 p-4 text-left transition-colors hover:border-signal-teal/30 hover:bg-signal-teal/5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-apple bg-signal-teal/10 text-signal-teal">
        <Icon className="h-5 w-5" />
      </span>
      <span>
        <span className="block text-caption font-semibold text-gray-900">{title}</span>
        <span className="block text-micro text-gray-500">{description}</span>
      </span>
    </button>
  );
}

function UserRowCompact({ user }: { user: AdminUser }) {
  return (
    <div className="flex items-center gap-3 rounded-apple border border-gray-100 p-3">
      <UserAvatar user={user} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-caption font-semibold text-gray-900">{user.name}</p>
        <p className="truncate text-micro text-gray-500">{user.email}</p>
      </div>
      <RoleBadge user={user} />
    </div>
  );
}

function UserIdentity({ user }: { user: AdminUser }) {
  return (
    <div className="flex items-center gap-3">
      <UserAvatar user={user} />
      <div>
        <div className="flex items-center gap-2">
          <p className="font-medium text-gray-900">{user.name}</p>
          {isTruthy(user.is_super_admin) && <Shield className="h-4 w-4 text-signal-teal" />}
        </div>
        <p className="text-caption text-gray-500">{user.email}</p>
      </div>
    </div>
  );
}

function UserAvatar({ user }: { user: AdminUser }) {
  return (
    <div className={`flex h-10 w-10 items-center justify-center rounded-apple-lg text-caption font-bold text-white ${isTruthy(user.is_super_admin) ? 'bg-deep-teal' : 'bg-signal-teal'}`}>
      {initials(user.name)}
    </div>
  );
}

function RoleBadge({ user }: { user: AdminUser }) {
  return (
    <span className="inline-flex items-center rounded-apple bg-signal-teal/15 px-2.5 py-1 text-micro font-semibold text-signal-teal">
      {isTruthy(user.is_super_admin) ? 'SuperAdmin' : user.role}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const active = status === 'active';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-apple px-2.5 py-1 text-micro font-semibold ${active ? 'bg-verified-green/15 text-verified-green' : 'bg-deep-teal/10 text-deep-teal'}`}>
      {active ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      {active ? 'Active' : status}
    </span>
  );
}

function SectionHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-sub-heading font-semibold text-gray-900">{title}</h2>
        <p className="text-caption text-gray-500">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function AuditList({ audit, compact = false }: { audit: AuditEvent[]; compact?: boolean }) {
  if (audit.length === 0) return <EmptyState icon={Activity} text="No audit events found" compact={compact} />;
  return (
    <div className="space-y-3">
      {audit.map((item) => (
        <div key={item.id} className="flex gap-3 rounded-apple border border-gray-100 p-3">
          <span className="mt-1 h-2 w-2 rounded-full bg-signal-teal" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="truncate text-caption font-semibold text-gray-900">{item.action.replaceAll('_', ' ')}</p>
              <span className="text-micro text-gray-400">{formatDate(item.created_at)}</span>
            </div>
            <p className="mt-0.5 text-micro text-gray-500">
              {item.user_name || item.user_email || 'System'} - {item.resource_type || 'record'} {item.tenant_name ? `- ${item.tenant_name}` : ''}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon: Icon, text, compact = false }: { icon: LucideIcon; text: string; compact?: boolean }) {
  return (
    <div className={`text-center ${compact ? 'py-6' : 'py-14'}`}>
      <Icon className="mx-auto mb-3 h-10 w-10 text-gray-300" />
      <p className="text-caption text-gray-500">{text}</p>
    </div>
  );
}

function UserEditModal({
  user,
  companies,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  companies: CompanyRecord[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<UserForm>({
    name: user.name,
    role: user.role,
    status: user.status === 'deleted' ? 'suspended' : user.status,
    company_id: user.company_id || '',
    is_super_admin: isTruthy(user.is_super_admin),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiRequest(`/api/admin/users/${user.id}`, { method: 'PATCH', body: form });
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Failed to update user'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit User" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        {error && <FormError message={error} />}
        <Field label="Name">
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="input-base" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role">
            <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as UserForm['role'] })} className="input-base">
              <option value="Admin">Admin</option>
              <option value="User">User</option>
              <option value="Viewer">Viewer</option>
            </select>
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as UserForm['status'] })} className="input-base">
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          </Field>
        </div>
        <Field label="Primary Company">
          <select value={form.company_id} onChange={(event) => setForm({ ...form, company_id: event.target.value })} className="input-base">
            <option value="">No primary company</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>{company.name} ({company.code})</option>
            ))}
          </select>
        </Field>
        <label className="flex items-start gap-3 rounded-apple-md border border-signal-teal/20 bg-signal-teal/5 p-3">
          <input type="checkbox" checked={form.is_super_admin} onChange={(event) => setForm({ ...form, is_super_admin: event.target.checked })} className="mt-0.5 h-4 w-4 accent-signal-teal" />
          <span>
            <span className="block text-caption font-semibold text-gray-900">Platform SuperAdmin</span>
            <span className="block text-micro text-gray-500">Grants cross-tenant platform access.</span>
          </span>
        </label>
        <ModalActions saving={saving} onClose={onClose} submitLabel="Save User" />
      </form>
    </Modal>
  );
}

function TenantFormModal({
  title,
  form,
  tenants,
  saving,
  error,
  onChange,
  onClose,
  onSubmit,
}: {
  title: string;
  form: TenantForm;
  tenants: Tenant[];
  saving: boolean;
  error: string;
  onChange: (updates: Partial<TenantForm>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <FormError message={error} />}
        <Field label="Group Name">
          <input required value={form.name} onChange={(event) => onChange({ name: event.target.value })} className="input-base" placeholder="e.g., Vietnam Mobile Group" />
        </Field>
        <Field label="Domain">
          <input required value={form.domain} onChange={(event) => onChange({ domain: event.target.value })} className="input-base" placeholder="example.com" />
        </Field>
        <Field label="Parent Group">
          <select value={form.parent_tenant_id} onChange={(event) => onChange({ parent_tenant_id: event.target.value })} className="input-base">
            <option value="">No parent</option>
            {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
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
    </Modal>
  );
}

function CompanyFormModal({
  form,
  tenants,
  saving,
  error,
  onChange,
  onClose,
  onSubmit,
}: {
  form: CompanyForm;
  tenants: Tenant[];
  saving: boolean;
  error: string;
  onChange: (updates: Partial<CompanyForm>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Modal title="Create Company" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <FormError message={error} />}
        <Field label="Tenant Group">
          <select required value={form.tenant_id} onChange={(event) => onChange({ tenant_id: event.target.value })} className="input-base">
            <option value="">Select group...</option>
            {tenants.filter((tenant) => !tenant.group_type && !isPlatform(tenant)).map((tenant) => (
              <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Company Code">
          <input required value={form.code} onChange={(event) => onChange({ code: event.target.value.toUpperCase() })} className="input-base uppercase" placeholder="VNM" />
        </Field>
        <Field label="Company Name">
          <input required value={form.name} onChange={(event) => onChange({ name: event.target.value })} className="input-base" placeholder="Vietnam Mobile" />
        </Field>
        <Field label="Logo URL">
          <input value={form.logo_url} onChange={(event) => onChange({ logo_url: event.target.value })} className="input-base" placeholder="https://..." />
        </Field>
        <ModalActions saving={saving} onClose={onClose} submitLabel="Create Company" />
      </form>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-apple-lg bg-white shadow-apple" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 p-6">
          <h2 className="text-sub-heading font-bold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-apple p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-2 block text-caption font-medium text-gray-700">{label}</label>
      {children}
    </div>
  );
}

function ModalActions({ saving, onClose, submitLabel }: { saving: boolean; onClose: () => void; submitLabel: string }) {
  return (
    <div className="flex justify-end gap-3 pt-4">
      <button type="button" onClick={onClose} className="btn-secondary" disabled={saving}>Cancel</button>
      <button type="submit" className="btn-primary" disabled={saving}>
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        {submitLabel}
      </button>
    </div>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <div className="rounded-apple-md border border-signal-teal/20 bg-signal-teal/5 p-3 text-caption text-deep-teal">
      {message}
    </div>
  );
}
