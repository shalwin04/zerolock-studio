'use client';

import { useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  TrendingUp,
  TrendingDown,
  Zap,
  Clock,
  RefreshCw,
  Shield,
  Lightbulb,
  Gauge,
  Users,
  Target,
} from 'lucide-react';
import { useMetrics, useConflictCount, useRetryCount, useBackoffAnalysis } from '@/hooks/useTelemetry';
import { useTelemetryStore } from '@/hooks/useTelemetry';

interface Insight {
  type: 'success' | 'warning' | 'danger' | 'info';
  title: string;
  description: string;
  recommendation?: string;
  icon: React.ReactNode;
}

export function InsightsPanel() {
  const metrics = useMetrics();
  const storeConflictCount = useConflictCount();
  const storeRetryCount = useRetryCount();
  const backoffAnalysis = useBackoffAnalysis();
  const storeTransactionCount = useTelemetryStore((state) => state.transactionCount);

  // Use metrics data with store counts as fallback for real-time updates
  const transactionCount = metrics.totalTransactions || storeTransactionCount;
  const conflictCount = metrics.totalConflicts || storeConflictCount;
  const retryCount = metrics.totalRetries || storeRetryCount;

  const insights = useMemo<Insight[]>(() => {
    const result: Insight[] = [];

    // Check if we have any data
    if (transactionCount === 0 && metrics.throughput === 0) {
      return [{
        type: 'info',
        title: 'No Data Yet',
        description: 'Run a transaction to see performance insights.',
        icon: <Lightbulb className="h-4 w-4" />,
      }];
    }

    // Conflict Rate Analysis
    if (conflictCount > 0 && transactionCount > 0) {
      const conflictRate = (conflictCount / transactionCount) * 100;

      if (conflictRate > 50) {
        result.push({
          type: 'danger',
          title: `High Conflict Rate: ${conflictRate.toFixed(0)}%`,
          description: `${conflictCount} of ${transactionCount} transactions hit OCC conflicts. This severely impacts throughput.`,
          recommendation: 'Consider: 1) Adding SELECT FOR UPDATE to lock rows, 2) Reducing concurrency, 3) Using UUIDs instead of sequential IDs',
          icon: <AlertTriangle className="h-4 w-4" />,
        });
      } else if (conflictRate > 20) {
        result.push({
          type: 'warning',
          title: `Moderate Conflict Rate: ${conflictRate.toFixed(0)}%`,
          description: `${conflictCount} conflicts detected. Some contention is normal under load.`,
          recommendation: 'Your retry logic is handling conflicts. Monitor if this increases with more concurrency.',
          icon: <Zap className="h-4 w-4" />,
        });
      } else {
        result.push({
          type: 'success',
          title: `Low Conflict Rate: ${conflictRate.toFixed(0)}%`,
          description: `Only ${conflictCount} conflicts. Your transaction design handles concurrency well.`,
          icon: <CheckCircle className="h-4 w-4" />,
        });
      }
    } else if (transactionCount > 0 && conflictCount === 0) {
      result.push({
        type: 'success',
        title: 'Zero Conflicts',
        description: `${transactionCount} transactions completed without any OCC conflicts.`,
        icon: <CheckCircle className="h-4 w-4" />,
      });
    }

    // Retry Analysis
    if (retryCount > 0) {
      const retriesPerConflict = conflictCount > 0 ? (retryCount / conflictCount).toFixed(1) : 'N/A';
      const retryRate = transactionCount > 0 ? retryCount / transactionCount : 0;

      if (retryRate > 3) {
        result.push({
          type: 'danger',
          title: `Excessive Retries: ${retryRate.toFixed(1)} per txn`,
          description: `Averaging ${retriesPerConflict} retries per conflict. Transactions are struggling to commit.`,
          recommendation: 'Increase max retry count or reduce conflict probability by improving isolation.',
          icon: <RefreshCw className="h-4 w-4" />,
        });
      } else {
        result.push({
          type: 'info',
          title: `Retries Working: ${retryCount} total`,
          description: `${retriesPerConflict} retries per conflict on average. Backoff strategy is recovering from conflicts.`,
          icon: <RefreshCw className="h-4 w-4" />,
        });
      }
    }

    // Backoff Pattern Analysis
    if (backoffAnalysis) {
      if (backoffAnalysis.retryStormRisk === 'high') {
        result.push({
          type: 'danger',
          title: 'Retry Storm Risk Detected!',
          description: 'Your retries use fixed intervals, causing all clients to retry simultaneously.',
          recommendation: 'Add full jitter: delay = random(0, min(maxDelay, baseDelay * 2^attempt))',
          icon: <AlertTriangle className="h-4 w-4" />,
        });
      } else if (backoffAnalysis.retryStormRisk === 'medium') {
        result.push({
          type: 'warning',
          title: 'Partial Jitter Detected',
          description: 'Some randomization in retries, but delays may still cluster.',
          recommendation: 'Consider full jitter for better distribution across time.',
          icon: <Clock className="h-4 w-4" />,
        });
      } else if (backoffAnalysis.hasJitter && backoffAnalysis.isExponential) {
        result.push({
          type: 'success',
          title: 'Excellent Backoff Pattern',
          description: 'Using exponential backoff with full jitter - optimal for distributed systems.',
          icon: <Shield className="h-4 w-4" />,
        });
      }
    }

    // Throughput Analysis
    if (metrics.throughput > 0) {
      if (metrics.throughput < 1) {
        result.push({
          type: 'warning',
          title: `Low Throughput: ${metrics.throughput.toFixed(1)} txn/sec`,
          description: 'Transactions are slow. High latency or conflicts may be the cause.',
          icon: <TrendingDown className="h-4 w-4" />,
        });
      } else if (metrics.throughput > 10) {
        result.push({
          type: 'success',
          title: `Good Throughput: ${metrics.throughput.toFixed(1)} txn/sec`,
          description: 'Healthy transaction rate despite concurrency.',
          icon: <TrendingUp className="h-4 w-4" />,
        });
      }
    }

    // Success Rate
    if (metrics.successRate < 0.7 && transactionCount > 0) {
      result.push({
        type: 'danger',
        title: `Low Success Rate: ${(metrics.successRate * 100).toFixed(0)}%`,
        description: 'More than 30% of transactions are failing or aborting.',
        recommendation: 'Check if max retries is sufficient or if conflicts are too frequent.',
        icon: <AlertTriangle className="h-4 w-4" />,
      });
    } else if (metrics.successRate >= 0.95 && transactionCount > 0) {
      result.push({
        type: 'success',
        title: `High Success Rate: ${(metrics.successRate * 100).toFixed(0)}%`,
        description: 'Excellent transaction completion rate.',
        icon: <CheckCircle className="h-4 w-4" />,
      });
    }

    // Latency Analysis - Average
    if (metrics.avgLatencyMs > 500) {
      result.push({
        type: 'warning',
        title: `High Avg Latency: ${metrics.avgLatencyMs.toFixed(0)}ms`,
        description: 'Transactions are taking longer than expected.',
        recommendation: 'Check network latency, query optimization, or reduce chaos latency injection.',
        icon: <Clock className="h-4 w-4" />,
      });
    } else if (metrics.avgLatencyMs > 0 && metrics.avgLatencyMs < 100) {
      result.push({
        type: 'success',
        title: `Fast Avg Latency: ${metrics.avgLatencyMs.toFixed(0)}ms`,
        description: 'Transactions are completing quickly.',
        icon: <Gauge className="h-4 w-4" />,
      });
    }

    // P99 Latency Analysis (tail latency)
    if (metrics.p99LatencyMs && metrics.p99LatencyMs > 1000) {
      result.push({
        type: 'warning',
        title: `High P99 Latency: ${metrics.p99LatencyMs.toFixed(0)}ms`,
        description: 'Tail latency is over 1 second. Some transactions are significantly slower than average.',
        recommendation: 'Check for lock contention or network issues affecting worst-case performance.',
        icon: <Gauge className="h-4 w-4" />,
      });
    }

    // Concurrency Analysis
    if (metrics.concurrentThreads && metrics.concurrentThreads > 20) {
      result.push({
        type: 'info',
        title: `High Concurrency: ${metrics.concurrentThreads} threads`,
        description: 'Running many concurrent transactions increases conflict probability.',
        icon: <Users className="h-4 w-4" />,
      });
    }

    // Hotspot Analysis
    if (metrics.conflictHotspots && metrics.conflictHotspots.length > 0) {
      const topHotspot = metrics.conflictHotspots[0];
      if (topHotspot.count > 5) {
        result.push({
          type: 'warning',
          title: `Hotspot Detected: ${topHotspot.key}`,
          description: `Key "${topHotspot.key}" caused ${topHotspot.count} conflicts. This is a contention point.`,
          recommendation: 'Consider partitioning this data or using a different key strategy.',
          icon: <Target className="h-4 w-4" />,
        });
      }
    }

    // If no insights generated but we have data, show a summary
    if (result.length === 0 && transactionCount > 0) {
      result.push({
        type: 'info',
        title: `${transactionCount} Transactions Analyzed`,
        description: 'No significant issues detected. Your transaction patterns look healthy.',
        icon: <CheckCircle className="h-4 w-4" />,
      });
    }

    return result;
  }, [metrics, conflictCount, retryCount, backoffAnalysis, transactionCount]);

  const typeStyles = {
    success: 'bg-white/[0.03] border-white/10',
    warning: 'bg-white/[0.04] border-white/15',
    danger: 'bg-white/[0.05] border-white/20',
    info: 'bg-white/[0.02] border-white/[0.06]',
  };

  const iconStyles = {
    success: 'text-white/60',
    warning: 'text-white/70',
    danger: 'text-white/90',
    info: 'text-white/40',
  };

  return (
    <div className="h-full flex flex-col bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <span className="text-sm font-medium text-white/90">Insights</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40">
          {insights.length} {insights.length === 1 ? 'finding' : 'findings'}
        </span>
      </div>

      {/* Insights List */}
      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-2">
        {insights.map((insight, i) => (
          <div
            key={i}
            className={`p-3 rounded-lg border ${typeStyles[insight.type]}`}
          >
            <div className="flex items-start gap-2">
              <div className={iconStyles[insight.type]}>{insight.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white/90">{insight.title}</p>
                <p className="text-xs text-white/50 mt-1">{insight.description}</p>
                {insight.recommendation && (
                  <div className="mt-2 p-2 rounded bg-white/[0.03] border border-white/[0.06]">
                    <p className="text-xs text-white/60">
                      <span className="font-medium text-white/70">Recommendation:</span>{' '}
                      {insight.recommendation}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
