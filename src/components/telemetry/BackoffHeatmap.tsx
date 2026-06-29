'use client';

import { useMemo } from 'react';
import { AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { useTelemetryStore, useBackoffAnalysis } from '@/hooks/useTelemetry';

export function BackoffHeatmap() {
  const backoffData = useTelemetryStore((state) => state.backoffData);
  const backoffAnalysis = useBackoffAnalysis();

  // Group delays by attempt for visualization
  const heatmapData = useMemo(() => {
    const grouped = new Map<number, number[]>();

    for (const point of backoffData) {
      const existing = grouped.get(point.attempt) || [];
      existing.push(point.delayMs);
      grouped.set(point.attempt, existing);
    }

    return Array.from(grouped.entries())
      .map(([attempt, delays]) => ({
        attempt,
        min: Math.min(...delays),
        max: Math.max(...delays),
        avg: delays.reduce((a, b) => a + b, 0) / delays.length,
        count: delays.length,
      }))
      .sort((a, b) => a.attempt - b.attempt);
  }, [backoffData]);

  const getRiskLabel = (risk: string) => {
    switch (risk) {
      case 'high':
        return 'Retry Storm Risk!';
      case 'medium':
        return 'Partial Jitter';
      default:
        return 'Good Pattern';
    }
  };

  return (
    <div className="h-full flex flex-col bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <span className="text-sm font-medium text-white/90">Backoff Pattern</span>
        {backoffAnalysis && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            backoffAnalysis.retryStormRisk === 'high'
              ? 'bg-white/10 text-white/90'
              : backoffAnalysis.retryStormRisk === 'medium'
              ? 'bg-white/5 text-white/60'
              : 'bg-white/5 text-white/50'
          }`}>
            {getRiskLabel(backoffAnalysis.retryStormRisk)}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 p-4 space-y-4 overflow-auto">
        {/* Heatmap visualization */}
        {heatmapData.length > 0 ? (
          <div className="space-y-2">
            <div className="text-xs text-white/30 mb-2">
              Retry delay distribution by attempt
            </div>
            {heatmapData.map(({ attempt, min, max, avg }) => (
              <div key={attempt} className="flex items-center gap-2">
                <span className="w-16 text-xs font-mono text-white/50">Retry {attempt}</span>
                <div className="flex-1 h-6 bg-white/[0.03] rounded relative overflow-hidden">
                  {/* Range bar */}
                  <div
                    className="absolute h-full bg-white/10"
                    style={{
                      left: `${(min / 5000) * 100}%`,
                      width: `${((max - min) / 5000) * 100}%`,
                    }}
                  />
                  {/* Average marker */}
                  <div
                    className="absolute h-full w-0.5 bg-white/60"
                    style={{
                      left: `${(avg / 5000) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-20 text-xs text-right font-mono text-white/70">
                  {avg.toFixed(0)}ms
                </span>
              </div>
            ))}
            <div className="flex justify-between text-xs text-white/20 mt-1">
              <span>0ms</span>
              <span>5000ms</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-24 text-white/30 text-sm">
            No retry data yet
          </div>
        )}

        {/* Analysis results */}
        {backoffAnalysis && (
          <div className="space-y-2">
            {backoffAnalysis.retryStormRisk === 'high' && (
              <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.08]">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-white/70 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-white/90">Retry Storm Risk Detected!</p>
                    <p className="text-xs text-white/50 mt-1">
                      {backoffAnalysis.recommendation ||
                        'Your retries are using fixed intervals, which causes all clients to retry at the same time.'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {backoffAnalysis.retryStormRisk === 'low' && backoffData.length > 0 && (
              <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]">
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-white/50 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-white/70">Good Pattern!</p>
                    <p className="text-xs text-white/40 mt-1">
                      Your backoff uses exponential delays with full jitter - optimal
                      for distributed systems.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Formula reference */}
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3 text-xs font-mono text-white/50">
              <Info className="h-3 w-3 inline mr-1.5 text-white/40" />
              Expected: t = random(0, min({backoffAnalysis.maxDelay},{' '}
              {backoffAnalysis.baseDelay} * {backoffAnalysis.multiplier}^attempt))
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
