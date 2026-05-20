import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import {
  Leaf,
  Package,
  ArrowLeftRight,
  Warehouse,
  BarChart3,
  ArrowRight,
  Globe,
  Shield,
  Zap,
  Recycle,
  ChevronRight,
} from 'lucide-react';

const features = [
  {
    icon: Package,
    title: 'Parts Catalog',
    desc: 'Central registry for telecom equipment with vendor mapping, weight tracking, and emission factors.',
    color: 'from-emerald-400 to-emerald-600',
  },
  {
    icon: ArrowLeftRight,
    title: 'Transaction Tracking',
    desc: 'Record purchases, sales, redeployments, and recycling with a complete audit trail.',
    color: 'from-green-500 to-emerald-700',
  },
  {
    icon: Warehouse,
    title: 'Warehouse Management',
    desc: 'Multi-warehouse inventory with zones, stock movements, and real-time visibility.',
    color: 'from-lime-500 to-green-600',
  },
  {
    icon: Leaf,
    title: 'Carbon Accounting',
    desc: 'Scope 1/2/3 GHG emission tracking with category breakdowns and compliance reports.',
    color: 'from-emerald-500 to-green-700',
  },
  {
    icon: BarChart3,
    title: 'Dashboard & KPIs',
    desc: 'Live headline metrics for parts, transactions, and emissions at a glance.',
    color: 'from-green-600 to-emerald-800',
  },
  {
    icon: Shield,
    title: 'Secure by Design',
    desc: 'Google SSO, role-based access control, rate limiting, and full audit logging.',
    color: 'from-emerald-700 to-green-900',
  },
];

const stats = [
  { label: 'Edge Locations', value: '300+', icon: Zap },
  { label: 'Latency', value: '<50ms', icon: Globe },
  { label: 'Uptime', value: '99.9%', icon: Shield },
];

export function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();
  const cta = isAuthenticated ? '/' : '/login';

  return (
    <div className="min-h-screen bg-white">
      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-gradient-to-br from-green-500 to-emerald-700 rounded-xl flex items-center justify-center shadow-sm shadow-emerald-500/25">
              <Recycle className="text-white" size={18} />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-emerald-900 to-green-600 bg-clip-text text-transparent">
              Cirtell
            </span>
          </div>
          <button onClick={() => navigate(cta)} className="btn-primary">
            {isAuthenticated ? 'Dashboard' : 'Sign In'}
            <ArrowRight size={15} />
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-to-b from-emerald-50 via-green-50/50 to-transparent rounded-full blur-3xl" />
          <div className="absolute top-20 right-0 w-72 h-72 bg-gradient-to-bl from-lime-50 to-transparent rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-gradient-to-tr from-green-50/50 to-transparent rounded-full blur-3xl" />
        </div>

        <div className="max-w-6xl mx-auto px-6 pt-24 pb-20 text-center">
          <div className="animate-fade-in">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-semibold mb-8 border border-emerald-100">
              <Recycle size={13} className="animate-spin" style={{ animationDuration: '3s' }} />
              Circular Economy Platform
            </div>
          </div>

          <h1 className="animate-slide-up text-5xl sm:text-6xl lg:text-7xl font-extrabold text-gray-900 leading-[1.1] max-w-4xl mx-auto tracking-tight">
            Track telecom assets from{' '}
            <span className="bg-gradient-to-r from-emerald-700 via-green-600 to-lime-500 bg-clip-text text-transparent">
              deployment to decommission
            </span>
          </h1>

          <p className="animate-slide-up mt-6 text-lg sm:text-xl text-gray-500 max-w-2xl mx-auto leading-relaxed"
             style={{ animationDelay: '0.1s', animationFillMode: 'both' }}>
            One platform to manage your parts catalog, warehouse inventory,
            transactions, and carbon emissions — designed for circular economy operations.
          </p>

          <div className="animate-slide-up mt-10 flex items-center justify-center gap-4"
               style={{ animationDelay: '0.2s', animationFillMode: 'both' }}>
            <button
              onClick={() => navigate(cta)}
              className="group inline-flex items-center gap-2 px-7 py-3.5 bg-emerald-800 text-white rounded-2xl text-sm font-semibold
                         shadow-xl shadow-emerald-800/20 hover:shadow-2xl hover:shadow-emerald-800/30 hover:bg-emerald-900
                         active:scale-[0.98] transition-all duration-200"
            >
              Get Started
              <ChevronRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
            <button
              onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
              className="btn-secondary px-6 py-3.5 rounded-2xl"
            >
              Learn More
            </button>
          </div>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <section className="border-y border-gray-100 bg-gray-50/50">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="flex items-center justify-center gap-12 sm:gap-20">
            {stats.map(({ label, value, icon: Icon }) => (
              <div key={label} className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm border border-gray-100">
                  <Icon size={18} className="text-emerald-600" />
                </div>
                <div>
                  <p className="text-lg font-bold text-gray-900">{value}</p>
                  <p className="text-xs text-gray-400 font-medium">{label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-24">
        <div className="text-center mb-14">
          <p className="text-sm font-semibold text-emerald-600 tracking-wide uppercase mb-3">Capabilities</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 tracking-tight">
            Everything you need to close the loop
          </h2>
          <p className="mt-4 text-gray-500 max-w-xl mx-auto">
            From asset intake to disposition, Cirtell tracks every part, movement, and emission across your operation.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, desc, color }) => (
            <div
              key={title}
              className="group relative bg-white rounded-2xl border border-gray-100 p-6
                         hover:border-gray-200 hover:shadow-lg hover:shadow-gray-900/5
                         transition-all duration-300 cursor-default"
            >
              <div className={`w-11 h-11 bg-gradient-to-br ${color} rounded-xl flex items-center justify-center mb-4
                              shadow-sm group-hover:scale-110 transition-transform duration-300`}>
                <Icon className="text-white" size={20} />
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-2">{title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="bg-gradient-to-br from-emerald-950 via-green-900 to-emerald-950 py-20">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center mx-auto mb-6 backdrop-blur-sm border border-white/10">
            <Recycle className="text-emerald-400" size={28} />
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 tracking-tight">
            Ready to go circular?
          </h2>
          <p className="text-gray-400 max-w-md mx-auto mb-8">
            Start tracking your telecom assets, reduce waste, and measure your environmental impact today.
          </p>
          <button
            onClick={() => navigate(cta)}
            className="group inline-flex items-center gap-2 px-7 py-3.5 bg-emerald-500 text-white rounded-2xl text-sm font-semibold
                       shadow-lg shadow-emerald-500/25 hover:bg-emerald-400 hover:shadow-xl hover:shadow-emerald-500/30
                       active:scale-[0.98] transition-all duration-200"
          >
            {isAuthenticated ? 'Go to Dashboard' : 'Get Started for Free'}
            <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-100 bg-white py-8">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-green-500 to-emerald-700 rounded-lg flex items-center justify-center">
              <Recycle className="text-white" size={12} />
            </div>
            <span className="text-sm font-semibold text-gray-400">Cirtell</span>
          </div>
          <span className="text-xs text-gray-400">
            &copy; {new Date().getFullYear()} &middot; Built on Cloudflare
          </span>
        </div>
      </footer>
    </div>
  );
}
