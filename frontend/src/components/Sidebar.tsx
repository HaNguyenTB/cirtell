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
    <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center text-white text-xs font-bold shadow-sm shadow-emerald-500/20">
      {initials}
    </div>
  );
}

export function Sidebar() {
  const { user } = useAuthStore();
  const { logout } = useGoogleSSO({ initialize: false });

  return (
    <aside className="w-[260px] bg-white border-r border-gray-100 flex flex-col">
      {/* Logo */}
      <div className="h-16 flex items-center gap-2.5 px-5 border-b border-gray-100">
        <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-sm shadow-emerald-500/20">
          <Recycle className="text-white" size={16} />
        </div>
        <span className="text-lg font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
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
                  ? 'bg-emerald-50 text-emerald-700 shadow-sm shadow-emerald-500/5'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors duration-200 ${
                  isActive ? 'bg-emerald-100' : 'bg-gray-100 group-hover:bg-gray-200'
                }`}>
                  <Icon size={16} className={isActive ? 'text-emerald-600' : ''} />
                </div>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User info */}
      <div className="border-t border-gray-100 p-3">
        <div className="flex items-center gap-3 px-2 py-2">
          <UserAvatar name={user?.name} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{user?.name}</p>
            <p className="text-[11px] text-gray-400 truncate">{user?.role}</p>
          </div>
          <button
            onClick={logout}
            className="p-2 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors duration-200"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
