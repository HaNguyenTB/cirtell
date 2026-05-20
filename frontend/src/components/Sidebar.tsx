import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useGoogleSSO } from '../hooks/useGoogleSSO';
import {
  LayoutDashboard,
  Package,
  ArrowLeftRight,
  Leaf,
  Warehouse,
  LogOut,
  Recycle,
} from 'lucide-react';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/parts', label: 'Parts Catalog', icon: Package },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/warehouse', label: 'Warehouse', icon: Warehouse },
  { to: '/carbon', label: 'Carbon', icon: Leaf },
];

function UserAvatar({ name }: { name?: string }) {
  const initials = (name || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="w-8 h-8 bg-signal-teal rounded-apple flex items-center justify-center text-white text-xs font-bold shadow-sm shadow-signal-teal/20">
      {initials}
    </div>
  );
}

export function Sidebar() {
  const { user } = useAuthStore();
  const { logout } = useGoogleSSO({ initialize: false });

  return (
    <aside className="w-[260px] bg-white border-r border-gray-200/80 flex flex-col">
      {/* Logo */}
      <div className="h-16 flex items-center gap-2.5 px-5 border-b border-gray-200/80">
        <div className="w-8 h-8 bg-deep-teal rounded-apple-md flex items-center justify-center shadow-sm shadow-deep-teal/20">
          <Recycle className="text-white" size={16} />
        </div>
        <span className="font-display text-lg font-semibold text-gray-900">
          Cirtell
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-signal-teal/10 text-deep-teal shadow-sm shadow-signal-teal/5'
                  : 'text-gray-500 hover:bg-black/[0.04] hover:text-gray-900'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors duration-200 ${
                  isActive ? 'bg-signal-teal/15' : 'bg-gray-100 group-hover:bg-signal-teal/10'
                }`}>
                  <Icon size={16} className={isActive ? 'text-signal-teal' : ''} />
                </div>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User info */}
      <div className="border-t border-gray-200/80 p-3">
        <div className="flex items-center gap-3 px-2 py-2">
          <UserAvatar name={user?.name} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{user?.name}</p>
            <p className="text-[11px] text-gray-400 truncate">{user?.role}</p>
          </div>
          <button
            onClick={logout}
            className="p-2 text-gray-300 hover:text-signal-teal rounded-apple hover:bg-signal-teal/10 transition-colors duration-200"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
