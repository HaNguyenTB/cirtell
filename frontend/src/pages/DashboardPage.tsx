import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import {
  ArrowLeftRight,
  DollarSign,
  Leaf,
  Package,
  Recycle,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

interface HeadlineData {
  total_transactions: number;
  total_value_usd: number;
  total_units: number;
  reuse_rate: number;
  total_co2e_kg: number;
  actual_co2e_kg?: number;
  avoided_co2e_kg: number;
  net_co2e_kg?: number;
  avoided_redeploy_co2e_kg?: number;
  avoided_recycle_co2e_kg?: number;
  scope1_kg: number;
  scope2_kg: number;
  scope3_kg: number;
  total_parts: number;
}

function SkeletonCards() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-5 mb-8">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="stat-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="skeleton w-12 h-12 rounded-apple-xl" />
            <div className="skeleton w-24 h-3 rounded" />
          </div>
          <div className="skeleton w-28 h-8 rounded" />
        </div>
      ))}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  tone,
  delay,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: 'deep' | 'signal' | 'verified';
  delay: number;
}) {
  const styles = {
    deep: 'bg-deep-teal/15 text-deep-teal',
    signal: 'bg-signal-teal/15 text-signal-teal',
    verified: 'bg-verified-green/15 text-verified-green',
  };

  return (
    <div className="stat-card animate-slide-up" style={{ animationDelay: `${delay}s`, animationFillMode: 'both' }}>
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-12 h-12 rounded-apple-xl flex items-center justify-center ${styles[tone]}`}>
          <Icon size={22} />
        </div>
        <span className="text-micro font-semibold text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <p className="font-display text-tile font-semibold text-gray-900 tracking-tight">{value}</p>
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
      <div className="animate-slide-up bg-red-50 border border-red-200 text-red-800 p-5 rounded-apple-lg text-caption">
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
          tone: 'signal' as const,
        },
        {
          label: 'Total Value',
          value: `$${data.total_value_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          icon: DollarSign,
          tone: 'deep' as const,
        },
        {
          label: 'Reuse Rate',
          value: `${data.reuse_rate}%`,
          icon: Recycle,
          tone: 'verified' as const,
        },
        {
          label: 'Actual CO2e',
          value: (data.actual_co2e_kg ?? data.total_co2e_kg).toLocaleString(undefined, { maximumFractionDigits: 1 }),
          icon: Leaf,
          tone: 'verified' as const,
        },
        {
          label: 'Avoided CO2e',
          value: data.avoided_co2e_kg.toLocaleString(undefined, { maximumFractionDigits: 1 }),
          icon: Recycle,
          tone: 'deep' as const,
        },
        {
          label: 'Parts in Catalog',
          value: data.total_parts.toLocaleString(),
          icon: Package,
          tone: 'signal' as const,
        },
      ]
    : [];

  const scopes = data
    ? [
        { label: 'Scope 1', sub: 'Direct Emissions', value: data.scope1_kg, color: 'bg-deep-teal' },
        { label: 'Scope 2', sub: 'Energy Indirect', value: data.scope2_kg, color: 'bg-signal-teal' },
        { label: 'Scope 3', sub: 'Value Chain', value: data.scope3_kg, color: 'bg-verified-green' },
      ]
    : [];

  const totalEmissions = data ? data.scope1_kg + data.scope2_kg + data.scope3_kg : 1;
  const actualCo2e = data ? data.actual_co2e_kg ?? data.total_co2e_kg : 0;
  const avoidedCo2e = data?.avoided_co2e_kg ?? 0;
  const netCo2e = data ? data.net_co2e_kg ?? actualCo2e - avoidedCo2e : 0;

  return (
    <div className="space-y-8 pb-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Key performance indicators at a glance</p>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-caption text-gray-500 bg-white border border-gray-100 rounded-apple-md px-3 py-2">
          <TrendingUp size={14} className="text-signal-teal" />
          Live data
        </div>
      </div>

      {loading ? (
        <SkeletonCards />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-5">
          {cards.map((card, i) => (
            <KpiCard key={card.label} {...card} delay={i * 0.05} />
          ))}
        </div>
      )}

      {data && (
        <div className="stat-card animate-slide-up" style={{ animationDelay: '0.3s', animationFillMode: 'both' }}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">GHG Emissions Breakdown</h2>
              <p className="text-caption text-gray-500 mt-0.5">Kilograms of CO2 equivalent</p>
            </div>
            <div className="text-right">
              <p className="font-display text-tile font-semibold text-gray-900">{actualCo2e.toLocaleString(undefined, { maximumFractionDigits: 1 })}</p>
              <p className="text-caption text-gray-500">Actual kg CO2e</p>
              <p className="text-micro font-semibold text-verified-green mt-1">
                Avoided {avoidedCo2e.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg
              </p>
              <p
                className="text-micro font-semibold text-deep-teal mt-1"
                title="Net CO2e = actual emissions minus avoided emissions"
              >
                Net {netCo2e.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg
              </p>
            </div>
          </div>

          <div className="flex h-3 rounded-pill overflow-hidden bg-gray-100 mb-6">
            {scopes.map((scope) => {
              const pct = totalEmissions > 0 ? (scope.value / totalEmissions) * 100 : 0;
              return pct > 0 ? (
                <div
                  key={scope.label}
                  className={`${scope.color} transition-all duration-500`}
                  style={{ width: `${pct}%` }}
                  title={`${scope.label}: ${pct.toFixed(1)}%`}
                />
              ) : null;
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {scopes.map((scope) => (
              <div key={scope.label} className="bg-gray-50 rounded-apple-lg p-4 border border-black/[0.04]">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${scope.color}`} />
                  <span className="text-caption font-semibold text-gray-500">{scope.label}</span>
                </div>
                <p className="text-sub-heading font-semibold text-gray-900">
                  {scope.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  <span className="text-caption font-normal text-gray-400 ml-1">kg</span>
                </p>
                <p className="text-micro text-gray-400 mt-0.5">{scope.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div className="bg-verified-green/5 rounded-apple-lg p-4 border border-verified-green/10">
              <p className="text-caption font-semibold text-gray-500">Redeploy avoided</p>
              <p className="text-sub-heading font-semibold text-gray-900 mt-1">
                {(data.avoided_redeploy_co2e_kg || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                <span className="text-caption font-normal text-gray-400 ml-1">kg</span>
              </p>
            </div>
            <div className="bg-deep-teal/5 rounded-apple-lg p-4 border border-deep-teal/10">
              <p className="text-caption font-semibold text-gray-500">Recycle avoided</p>
              <p className="text-sub-heading font-semibold text-gray-900 mt-1">
                {(data.avoided_recycle_co2e_kg || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                <span className="text-caption font-normal text-gray-400 ml-1">kg</span>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
