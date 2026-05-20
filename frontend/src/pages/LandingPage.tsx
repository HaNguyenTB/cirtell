import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import {
  ArrowLeftRight,
  ArrowRight,
  BarChart3,
  Globe,
  Leaf,
  Package,
  Recycle,
  Shield,
  Warehouse,
  Zap,
} from 'lucide-react';

const features = [
  {
    icon: Package,
    title: 'Parts Catalog',
    desc: 'Central registry for telecom equipment with vendor mapping, weight tracking, and emission factors.',
    tone: 'bg-signal-teal/15 text-signal-teal',
  },
  {
    icon: ArrowLeftRight,
    title: 'Transaction Tracking',
    desc: 'Record purchases, sales, redeployments, and recycling with a complete audit trail.',
    tone: 'bg-deep-teal/15 text-deep-teal',
  },
  {
    icon: Warehouse,
    title: 'Warehouse Management',
    desc: 'Multi-warehouse inventory with zones, stock movements, and real-time visibility.',
    tone: 'bg-signal-teal/15 text-signal-teal',
  },
  {
    icon: Leaf,
    title: 'Carbon Accounting',
    desc: 'Scope 1/2/3 GHG emission tracking with category breakdowns and compliance reports.',
    tone: 'bg-verified-green/15 text-verified-green',
  },
  {
    icon: BarChart3,
    title: 'Dashboard & KPIs',
    desc: 'Live headline metrics for parts, transactions, and emissions at a glance.',
    tone: 'bg-signal-teal/15 text-signal-teal',
  },
  {
    icon: Shield,
    title: 'Secure by Design',
    desc: 'Google SSO, role-based access control, rate limiting, and full audit logging.',
    tone: 'bg-deep-teal/15 text-deep-teal',
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
    <div className="min-h-screen bg-[#F9FAFB]">
      <nav className="sticky top-0 z-40 bg-white/95 backdrop-blur-xl border-b border-gray-200/80">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-deep-teal rounded-apple-md flex items-center justify-center shadow-sm shadow-deep-teal/20">
              <Recycle className="text-verified-green" size={18} />
            </div>
            <span className="font-display text-xl font-semibold text-gray-900">Cirtell</span>
          </div>
          <button onClick={() => navigate(cta)} className="btn-primary">
            {isAuthenticated ? 'Dashboard' : 'Sign In'}
            <ArrowRight size={15} />
          </button>
        </div>
      </nav>

      <section className="relative overflow-hidden bg-midnight">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(37,149,123,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(37,149,123,0.08)_1px,transparent_1px)] bg-[size:64px_64px]" />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/90 to-black/30" />

        <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-16 lg:pt-24 lg:pb-20 grid lg:grid-cols-[1fr_440px] gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-signal-teal/10 text-verified-green rounded-pill text-micro font-semibold mb-8 border border-signal-teal/20">
              <Recycle size={13} />
              Circular Economy Platform
            </div>

            <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl font-semibold text-white leading-[1.05] max-w-4xl tracking-tight">
              Cirtell
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-white/55 max-w-2xl leading-relaxed">
              Track telecom assets from deployment to decommission with Cirveris-style inventory intelligence.
            </p>

            <div className="mt-10 flex items-center gap-4">
              <button
                onClick={() => navigate(cta)}
                className="group inline-flex items-center gap-2 px-7 py-3.5 bg-white text-midnight rounded-apple-md text-caption font-medium shadow-apple-sm hover:bg-white/90 active:scale-[0.98] transition-all duration-200"
              >
                Get Started
                <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
              <button
                onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-apple-md text-caption font-medium text-white/70 border border-white/[0.12] hover:bg-white/[0.06] hover:text-white transition-all"
              >
                Learn More
              </button>
            </div>
          </div>

          <div className="rounded-apple-lg border border-white/[0.08] bg-white/[0.04] p-4 shadow-apple">
            <div className="rounded-apple-md bg-[#111111] border border-white/[0.08] p-5">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <p className="text-micro uppercase tracking-wider text-white/35 font-semibold">Live snapshot</p>
                  <p className="text-sub-heading font-semibold text-white mt-1">Inventory Intelligence</p>
                </div>
                <div className="w-10 h-10 rounded-apple-xl bg-signal-teal/15 flex items-center justify-center">
                  <BarChart3 className="text-verified-green" size={20} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Parts', '1,248'],
                  ['Reuse', '78%'],
                  ['CO2e', '42.6t'],
                  ['Value', '$2.4M'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-apple-md border border-white/[0.08] bg-white/[0.04] p-4">
                    <p className="text-micro text-white/35 mb-1">{label}</p>
                    <p className="font-display text-2xl font-semibold text-white">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 space-y-3">
                {[82, 64, 48].map((width, index) => (
                  <div key={width} className="h-2 rounded-pill bg-white/[0.06] overflow-hidden">
                    <div
                      className={`${index === 0 ? 'bg-verified-green' : index === 1 ? 'bg-signal-teal' : 'bg-deep-teal'} h-full rounded-pill`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-gray-200/80 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-16">
            {stats.map(({ label, value, icon: Icon }) => (
              <div key={label} className="flex items-center gap-3">
                <div className="w-10 h-10 bg-signal-teal/10 rounded-apple-xl flex items-center justify-center">
                  <Icon size={18} className="text-signal-teal" />
                </div>
                <div>
                  <p className="text-sub-heading font-semibold text-gray-900">{value}</p>
                  <p className="text-micro text-gray-500 font-medium">{label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="max-w-6xl mx-auto px-6 py-24">
        <div className="mb-14">
          <p className="text-caption font-semibold text-signal-teal tracking-wide uppercase mb-3">Capabilities</p>
          <h2 className="font-display text-section font-semibold text-gray-900 tracking-tight">
            Everything you need to close the loop
          </h2>
          <p className="mt-4 text-body text-gray-500 max-w-xl">
            From asset intake to disposition, Cirtell tracks every part, movement, and emission across your operation.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, desc, tone }) => (
            <div key={title} className="group relative bg-white rounded-apple-lg border border-gray-100 p-6 hover:border-gray-200 hover:shadow-apple-sm transition-all duration-300">
              <div className={`w-12 h-12 ${tone} rounded-apple-xl flex items-center justify-center mb-4 transition-transform duration-300 group-hover:-translate-y-0.5`}>
                <Icon size={22} />
              </div>
              <h3 className="text-sub-heading font-semibold text-gray-900 mb-2">{title}</h3>
              <p className="text-caption text-gray-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-midnight py-20">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <div className="w-14 h-14 bg-signal-teal/15 rounded-apple-xl flex items-center justify-center mx-auto mb-6 border border-signal-teal/20">
            <Recycle className="text-verified-green" size={28} />
          </div>
          <h2 className="font-display text-section font-semibold text-white mb-4 tracking-tight">
            Ready to go circular?
          </h2>
          <p className="text-white/45 max-w-md mx-auto mb-8">
            Start tracking your telecom assets, reduce waste, and measure your environmental impact today.
          </p>
          <button onClick={() => navigate(cta)} className="btn-primary">
            {isAuthenticated ? 'Go to Dashboard' : 'Get Started'}
            <ArrowRight size={16} />
          </button>
        </div>
      </section>

      <footer className="border-t border-gray-200/80 bg-white py-8">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-deep-teal rounded-apple flex items-center justify-center">
              <Recycle className="text-verified-green" size={12} />
            </div>
            <span className="text-caption font-semibold text-gray-500">Cirtell</span>
          </div>
          <span className="text-micro text-gray-400">(c) {new Date().getFullYear()} - Built on Cloudflare</span>
        </div>
      </footer>
    </div>
  );
}
