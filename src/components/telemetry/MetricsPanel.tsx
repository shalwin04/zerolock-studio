'use client';

import { useMetrics, useIsRunning } from '@/hooks/useTelemetry';
import { Activity, Zap, Clock, CheckCircle, RotateCcw } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  icon: React.ReactNode;
  status?: 'normal' | 'warning' | 'danger';
}

function MetricCard({ label, value, unit, icon, status = 'normal' }: MetricCardProps) {
  const statusColors = {
    normal: 'text-white/70',
    warning: 'text-white/90',
    danger: 'text-white',
  };

  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3">
      <div className="flex items-center gap-2">
        <div className="text-white/30">{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-white/30 truncate font-medium">{label}</p>
          <p className={`text-lg font-medium tabular-nums ${statusColors[status]}`}>
            {value}
            {unit && <span className="text-xs font-normal ml-1 text-white/40">{unit}</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

export function MetricsPanel() {
  const metrics = useMetrics();
  const isRunning = useIsRunning();

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
      <MetricCard
        label="Throughput"
        value={metrics.throughput.toFixed(1)}
        unit="txn/s"
        icon={<Activity className="h-4 w-4" />}
      />
      <MetricCard
        label="Conflicts/sec"
        value={metrics.conflictsPerSec.toFixed(1)}
        icon={<Zap className="h-4 w-4" />}
        status={metrics.conflictsPerSec > 1 ? 'danger' : 'normal'}
      />
      <MetricCard
        label="Avg Latency"
        value={metrics.avgLatencyMs.toFixed(0)}
        unit="ms"
        icon={<Clock className="h-4 w-4" />}
      />
      <MetricCard
        label="Success Rate"
        value={(metrics.successRate * 100).toFixed(0)}
        unit="%"
        icon={<CheckCircle className="h-4 w-4" />}
        status={metrics.successRate < 0.9 ? 'warning' : 'normal'}
      />
      <MetricCard
        label="Retry Rate"
        value={metrics.retryRate.toFixed(2)}
        unit="per txn"
        icon={<RotateCcw className="h-4 w-4" />}
        status={metrics.retryRate > 2 ? 'danger' : 'normal'}
      />
    </div>
  );
}
