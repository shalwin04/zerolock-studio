'use client';

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useMetricsHistory, useConflictCount, useRetryCount } from '@/hooks/useTelemetry';

export function ConflictGraph() {
  const metricsHistory = useMetricsHistory();
  const conflictCount = useConflictCount();
  const retryCount = useRetryCount();

  const chartData = useMemo(() => {
    return metricsHistory.map((item, index) => ({
      time: index,
      conflicts: item.metrics.conflictsPerSec.toFixed(1),
      throughput: item.metrics.throughput.toFixed(1),
      latency: item.metrics.avgLatencyMs.toFixed(0),
    }));
  }, [metricsHistory]);

  return (
    <div className="h-full flex flex-col bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <span className="text-sm font-medium text-white/90">Conflicts</span>
        <div className="flex gap-3 text-xs">
          <span className="text-white/40">{conflictCount} conflicts</span>
          <span className="text-white/30">{retryCount} retries</span>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0 p-4">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }}
                tickFormatter={(v) => `${v}s`}
                stroke="rgba(255,255,255,0.1)"
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }}
                stroke="rgba(255,255,255,0.1)"
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0a0a0a',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  color: 'white',
                  fontSize: '12px',
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: '11px' }}
                formatter={(value) => <span style={{ color: 'rgba(255,255,255,0.5)' }}>{value}</span>}
              />
              <Line
                type="monotone"
                dataKey="conflicts"
                stroke="rgba(255,255,255,0.8)"
                strokeWidth={1.5}
                dot={false}
                name="Conflicts/sec"
              />
              <Line
                type="monotone"
                dataKey="throughput"
                stroke="rgba(255,255,255,0.3)"
                strokeWidth={1.5}
                dot={false}
                name="Throughput"
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-white/30 text-sm">
            Run a transaction to see metrics
          </div>
        )}
      </div>
    </div>
  );
}
