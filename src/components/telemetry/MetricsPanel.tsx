'use client';

import { useMetrics, useTelemetryStore } from '@/hooks/useTelemetry';
import {
  Activity,
  Zap,
  Clock,
  CheckCircle,
  RotateCcw,
  Gauge,
  TrendingUp,
  AlertTriangle,
  Users,
  Timer,
  Target,
  BarChart3,
} from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  icon: React.ReactNode;
  status?: 'normal' | 'warning' | 'danger' | 'success';
  size?: 'sm' | 'md';
}

function MetricCard({ label, value, unit, icon, status = 'normal', size = 'md' }: MetricCardProps) {
  const statusColors = {
    normal: 'text-white/70',
    warning: 'text-white/90',
    danger: 'text-white',
    success: 'text-white/80',
  };

  const bgColors = {
    normal: 'bg-white/[0.02]',
    warning: 'bg-white/[0.04]',
    danger: 'bg-white/[0.06]',
    success: 'bg-white/[0.03]',
  };

  return (
    <div className={`${bgColors[status]} border border-white/[0.06] rounded-xl ${size === 'sm' ? 'p-2' : 'p-3'}`}>
      <div className="flex items-center gap-2">
        <div className="text-white/30">{icon}</div>
        <div className="flex-1 min-w-0">
          <p className={`uppercase tracking-wider text-white/30 truncate font-medium ${size === 'sm' ? 'text-[9px]' : 'text-[10px]'}`}>
            {label}
          </p>
          <p className={`font-medium tabular-nums ${statusColors[status]} ${size === 'sm' ? 'text-sm' : 'text-lg'}`}>
            {value}
            {unit && <span className={`font-normal ml-1 text-white/40 ${size === 'sm' ? 'text-[10px]' : 'text-xs'}`}>{unit}</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

function HotspotsDisplay({ hotspots }: { hotspots: { key: string; count: number }[] }) {
  if (hotspots.length === 0) {
    return (
      <div className="text-xs text-white/30 text-center py-2">No hotspots detected</div>
    );
  }

  const maxCount = Math.max(...hotspots.map(h => h.count));

  return (
    <div className="space-y-1">
      {hotspots.slice(0, 3).map((hotspot, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-white/50 truncate">{hotspot.key}</div>
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-white/30 rounded-full"
                style={{ width: `${(hotspot.count / maxCount) * 100}%` }}
              />
            </div>
          </div>
          <span className="text-xs text-white/60 tabular-nums">{hotspot.count}</span>
        </div>
      ))}
    </div>
  );
}

function RetryDistDisplay({ distribution }: { distribution: { attempts: number; count: number }[] }) {
  if (distribution.length === 0) {
    return (
      <div className="text-xs text-white/30 text-center py-2">No retries recorded</div>
    );
  }

  const maxCount = Math.max(...distribution.map(d => d.count));

  return (
    <div className="flex items-end gap-1 h-8">
      {distribution.slice(0, 6).map((item, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
          <div
            className="w-full bg-white/30 rounded-t"
            style={{ height: `${Math.max(4, (item.count / maxCount) * 32)}px` }}
          />
          <span className="text-[8px] text-white/40">{item.attempts}</span>
        </div>
      ))}
    </div>
  );
}

export function MetricsPanel() {
  const metrics = useMetrics();
  const transactionCount = useTelemetryStore((state) => state.transactionCount);
  const conflictCount = useTelemetryStore((state) => state.conflictCount);
  const retryCount = useTelemetryStore((state) => state.retryCount);

  // Use store counts as fallback for real-time updates
  const displayTransactions = metrics.totalTransactions || transactionCount || 0;
  const displayConflicts = metrics.totalConflicts || conflictCount || 0;
  const displayRetries = metrics.totalRetries || retryCount || 0;

  // Safe metric accessors with defaults
  const throughput = metrics.throughput ?? 0;
  const conflictsPerSec = metrics.conflictsPerSec ?? 0;
  const avgLatencyMs = metrics.avgLatencyMs ?? 0;
  const successRate = metrics.successRate ?? 1;
  const retryRate = metrics.retryRate ?? 0;
  const concurrentThreads = metrics.concurrentThreads ?? 1;
  const p50LatencyMs = metrics.p50LatencyMs ?? 0;
  const p95LatencyMs = metrics.p95LatencyMs ?? 0;
  const p99LatencyMs = metrics.p99LatencyMs ?? 0;
  const committedCount = metrics.committedCount ?? (displayTransactions - displayConflicts);
  const abortedCount = metrics.abortedCount ?? displayConflicts;
  const totalDurationMs = metrics.totalDurationMs ?? 0;
  const avgTransactionMs = metrics.avgTransactionMs ?? 0;
  const conflictHotspots = metrics.conflictHotspots ?? [];
  const retryDistribution = metrics.retryDistribution ?? [];

  const getConflictStatus = () => {
    if (conflictsPerSec > 5) return 'danger';
    if (conflictsPerSec > 1) return 'warning';
    return 'normal';
  };

  const getSuccessStatus = () => {
    if (successRate < 0.7) return 'danger';
    if (successRate < 0.9) return 'warning';
    return 'success';
  };

  const getRetryStatus = () => {
    if (retryRate > 3) return 'danger';
    if (retryRate > 1) return 'warning';
    return 'normal';
  };

  const getLatencyStatus = () => {
    if (avgLatencyMs > 500) return 'danger';
    if (avgLatencyMs > 200) return 'warning';
    return 'normal';
  };

  return (
    <div className="space-y-3">
      {/* Primary Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <MetricCard
          label="Throughput"
          value={throughput.toFixed(1)}
          unit="txn/s"
          icon={<Activity className="h-4 w-4" />}
          status={throughput > 10 ? 'success' : 'normal'}
        />
        <MetricCard
          label="Conflicts/sec"
          value={conflictsPerSec.toFixed(1)}
          icon={<Zap className="h-4 w-4" />}
          status={getConflictStatus()}
        />
        <MetricCard
          label="Avg Latency"
          value={avgLatencyMs.toFixed(0)}
          unit="ms"
          icon={<Clock className="h-4 w-4" />}
          status={getLatencyStatus()}
        />
        <MetricCard
          label="Success Rate"
          value={(successRate * 100).toFixed(0)}
          unit="%"
          icon={<CheckCircle className="h-4 w-4" />}
          status={getSuccessStatus()}
        />
        <MetricCard
          label="Retry Rate"
          value={retryRate.toFixed(2)}
          unit="per txn"
          icon={<RotateCcw className="h-4 w-4" />}
          status={getRetryStatus()}
        />
        <MetricCard
          label="Concurrency"
          value={concurrentThreads}
          unit="threads"
          icon={<Users className="h-4 w-4" />}
        />
      </div>

      {/* Secondary Metrics Row - Latency Percentiles & Counts */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        <MetricCard
          label="P50 Latency"
          value={p50LatencyMs.toFixed(0)}
          unit="ms"
          icon={<Gauge className="h-3.5 w-3.5" />}
          size="sm"
        />
        <MetricCard
          label="P95 Latency"
          value={p95LatencyMs.toFixed(0)}
          unit="ms"
          icon={<Gauge className="h-3.5 w-3.5" />}
          size="sm"
          status={p95LatencyMs > 500 ? 'warning' : 'normal'}
        />
        <MetricCard
          label="P99 Latency"
          value={p99LatencyMs.toFixed(0)}
          unit="ms"
          icon={<Gauge className="h-3.5 w-3.5" />}
          size="sm"
          status={p99LatencyMs > 1000 ? 'danger' : 'normal'}
        />
        <MetricCard
          label="Total TXNs"
          value={displayTransactions}
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          size="sm"
        />
        <MetricCard
          label="Committed"
          value={committedCount}
          icon={<CheckCircle className="h-3.5 w-3.5" />}
          size="sm"
          status="success"
        />
        <MetricCard
          label="Aborted"
          value={abortedCount}
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          size="sm"
          status={displayConflicts > 0 ? 'warning' : 'normal'}
        />
        <MetricCard
          label="Conflicts"
          value={displayConflicts}
          icon={<Zap className="h-3.5 w-3.5" />}
          size="sm"
          status={displayConflicts > displayTransactions * 0.3 ? 'danger' : 'normal'}
        />
        <MetricCard
          label="Retries"
          value={displayRetries}
          icon={<RotateCcw className="h-3.5 w-3.5" />}
          size="sm"
        />
      </div>

      {/* Detailed Analytics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {/* Hotspots Card */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <Target className="h-3.5 w-3.5 text-white/30" />
            <span className="text-[10px] uppercase tracking-wider text-white/30 font-medium">
              Conflict Hotspots
            </span>
          </div>
          <HotspotsDisplay hotspots={conflictHotspots} />
        </div>

        {/* Retry Distribution Card */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="h-3.5 w-3.5 text-white/30" />
            <span className="text-[10px] uppercase tracking-wider text-white/30 font-medium">
              Retry Distribution
            </span>
          </div>
          <RetryDistDisplay distribution={retryDistribution} />
        </div>

        {/* Duration Card */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <Timer className="h-3.5 w-3.5 text-white/30" />
            <span className="text-[10px] uppercase tracking-wider text-white/30 font-medium">
              Execution Summary
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] text-white/40">Duration</p>
              <p className="text-sm font-medium text-white/70 tabular-nums">
                {(totalDurationMs / 1000).toFixed(2)}
                <span className="text-[10px] text-white/40 ml-0.5">s</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] text-white/40">Avg TXN Time</p>
              <p className="text-sm font-medium text-white/70 tabular-nums">
                {avgTransactionMs.toFixed(0)}
                <span className="text-[10px] text-white/40 ml-0.5">ms</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
