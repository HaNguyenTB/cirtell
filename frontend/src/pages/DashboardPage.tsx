import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import {
  ArrowLeftRight,
  DollarSign,
  Recycle,
  Leaf,
  Package,
  TrendingUp,
} from 'lucide-react';

interface HeadlineData {
  total_transactions: number;
  total_value_usd: number;
  total_units: number;
  reuse_rate: number;
  total_co2e_kg: number;
  scope1_kg: number;
  scope2_kg: number;
  scope3_kg: number;
  total_parts: number;
}

function SkeletonCards() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="stat-card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="skeleton w-10 h-10 rounded-xl" />
            <div className="skeleton w-24 h-3 rounded" />
          </div>
          <div className="skeleton w-28 h-7 rounded" />
        </div>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<HeadlineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest<{ success: boolean; data: HeadlineData }>('/api/overview/headline')
      .then((res) => setData(res.data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (error) {
    return (
      <div className="animate-slide-up bg-emerald-50 border border-emerald-200 text-emerald-800 p-5 rounded-2xl text-sm">
        {error}
      </div>
    );
  }

  const cards = data
    ? [
        {
          label: 'Total Transactions',
          value: data.total_transactions.toLocaleString(),
          icon: ArrowLeftRight,
          gradient: 'from-emerald-400 to-emerald-600',
          bg: 'bg-emerald-50',
        },
        {
          label: 'Total Value',
          value: `$${data.total_value_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          icon: DollarSign,
          gradient: 'from-green-500 to-emerald-700',
          bg: 'bg-emerald-50',
        },
        {
          label: 'Reuse Rate',
          value: `${data.reuse_rate}%`,
          icon: Recycle,
          gradient: 'from-lime-500 to-green-600',
          bg: 'bg-lime-50',
        },
        {
          label: 'Total CO₂e (kg)',
          value: data.total_co2e_kg.toLocaleString(undefined, { maximumFractionDigits: 1 }),
          icon: Leaf,
          gradient: 'from-emerald-500 to-green-700',
          bg: 'bg-emerald-50',
        },
        {
          label: 'Parts in Catalog',
          value: data.total_parts.toLocaleString(),
          icon: Package,
          gradient: 'from-green-600 to-emerald-800',
          bg: 'bg-green-50',
        },
      ]
    : [];

  const scopes = data
    ? [
        { label: 'Scope 1', sub: 'Direct Emissions', value: data.scope1_kg, color: 'from-lime-400 to-green-500', barColor: 'bg-lime-500' },
        { label: 'Scope 2', sub: 'Energy Indirect', value: data.scope2_kg, color: 'from-green-500 to-emerald-600', barColor: 'bg-green-600' },
        { label: 'Scope 3', sub: 'Value Chain', value: data.scope3_kg, color: 'from-emerald-600 to-green-800', barColor: 'bg-emerald-700' },
      ]
    : [];

  const totalEmissions = data ? data.scope1_kg + data.scope2_kg + data.scope3_kg : 1;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Key performance indicators at a glance</p>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-xs text-gray-400 bg-white border border-gray-100 rounded-xl px-3 py-2">
          <TrendingUp size={14} className="text-emerald-500" />
          Live data
        </div>
      </div>

      {/* KPI Cards */}
      {loading ? (
        <SkeletonCards />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
          {cards.map((card, i) => (
            <div
              key={card.label}
              className="stat-card p-5 animate-slide-up"
              style={{ animationDelay: `${i * 0.05}s`, animationFillMode: 'both' }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 bg-gradient-to-br ${card.gradient} rounded-xl flex items-center justify-center shadow-sm`}>
                  <card.icon size={18} className="text-white" />
                </div>
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">{card.label}</span>
              </div>
              <p className="text-2xl font-bold text-gray-900 tracking-tight">{card.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Emissions breakdown */}
      {data && (
        <div className="stat-card p-6 animate-slide-up" style={{ animationDelay: '0.3s', animationFillMode: 'both' }}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-semibold text-gray-900">GHG Emissions Breakdown</h2>
              <p className="text-xs text-gray-400 mt-0.5">Kilograms of CO₂ equivalent</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-900">{data.total_co2e_kg.toLocaleString(undefined, { maximumFractionDigits: 1 })}</p>
              <p className="text-xs text-gray-400">Total kg CO₂e</p>
            </div>
          </div>

          {/* Stacked bar */}
          <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 mb-6">
            {scopes.map((s) => {
              const pct = totalEmissions > 0 ? (s.value / totalEmissions) * 100 : 0;
              return pct > 0 ? (
                <div
                  key={s.label}
                  className={`${s.barColor} transition-all duration-500`}
                  style={{ width: `${pct}%` }}
                  title={`${s.label}: ${pct.toFixed(1)}%`}
                />
              ) : null;
            })}
          </div>

          <div className="grid grid-cols-3 gap-4">
            {scopes.map((s) => (
              <div key={s.label} className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-2.5 h-2.5 rounded-full bg-gradient-to-br ${s.color}`} />
                  <span className="text-xs font-semibold text-gray-500">{s.label}</span>
                </div>
                <p className="text-lg font-bold text-gray-900">
                  {s.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  <span className="text-xs font-normal text-gray-400 ml-1">kg</span>
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5">{s.sub}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
