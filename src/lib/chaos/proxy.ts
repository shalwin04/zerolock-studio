// Chaos Proxy for Zero-Lock Studio
// Intercepts database connections to inject faults and measure latency

import { ChaosConfig } from '@/types/chaos';
import { TelemetryEvent, QueryEvent } from '@/types/telemetry';

export interface ProxyMetrics {
  totalQueries: number;
  totalLatencyInjected: number;
  avgLatencyMs: number;
  queriesByType: Record<string, number>;
  errorsByCode: Record<string, number>;
}

interface InterceptedQuery {
  id: string;
  sql: string;
  startTime: number;
  endTime?: number;
  injectedLatencyMs: number;
  error?: string;
}

// Query history for analysis
const queryHistory: InterceptedQuery[] = [];
const MAX_HISTORY_SIZE = 1000;

// Proxy configuration
let proxyConfig: ChaosConfig | null = null;
let proxyEnabled = false;

// Metrics accumulator
const metrics: ProxyMetrics = {
  totalQueries: 0,
  totalLatencyInjected: 0,
  avgLatencyMs: 0,
  queriesByType: {},
  errorsByCode: {},
};

export function enableProxy(config: ChaosConfig): void {
  proxyConfig = config;
  proxyEnabled = true;
}

export function disableProxy(): void {
  proxyEnabled = false;
  proxyConfig = null;
}

export function isProxyEnabled(): boolean {
  return proxyEnabled;
}

export function getProxyConfig(): ChaosConfig | null {
  return proxyConfig;
}

// Intercept and process a query
export async function interceptQuery(
  sql: string,
  execute: () => Promise<unknown>
): Promise<{ result: unknown; intercepted: InterceptedQuery }> {
  const queryId = `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const startTime = Date.now();

  const intercepted: InterceptedQuery = {
    id: queryId,
    sql: sanitizeSql(sql),
    startTime,
    injectedLatencyMs: 0,
  };

  metrics.totalQueries++;

  // Categorize query
  const queryType = categorizeQuery(sql);
  metrics.queriesByType[queryType] = (metrics.queriesByType[queryType] || 0) + 1;

  try {
    // Inject pre-execution latency if configured
    if (proxyEnabled && proxyConfig && proxyConfig.latencyMs > 0) {
      const latency = calculateLatency(proxyConfig.latencyMs);
      intercepted.injectedLatencyMs = latency;
      metrics.totalLatencyInjected += latency;
      await delay(latency);
    }

    // Execute the actual query
    const result = await execute();

    intercepted.endTime = Date.now();

    // Update average latency
    const totalTime = intercepted.endTime - startTime;
    metrics.avgLatencyMs =
      (metrics.avgLatencyMs * (metrics.totalQueries - 1) + totalTime) /
      metrics.totalQueries;

    // Store in history
    addToHistory(intercepted);

    return { result, intercepted };
  } catch (error) {
    intercepted.endTime = Date.now();
    intercepted.error = error instanceof Error ? error.message : String(error);

    // Track error codes
    if (error instanceof Error && 'code' in error) {
      const code = (error as Error & { code: string }).code;
      metrics.errorsByCode[code] = (metrics.errorsByCode[code] || 0) + 1;
    }

    addToHistory(intercepted);
    throw error;
  }
}

// Calculate latency with jitter
function calculateLatency(baseMs: number): number {
  // Add +/- 30% jitter for realism
  const jitterPercent = 0.3;
  const jitter = baseMs * jitterPercent * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(baseMs + jitter));
}

// Categorize query type
function categorizeQuery(sql: string): string {
  const normalized = sql.trim().toLowerCase();

  if (normalized.startsWith('select')) return 'SELECT';
  if (normalized.startsWith('insert')) return 'INSERT';
  if (normalized.startsWith('update')) return 'UPDATE';
  if (normalized.startsWith('delete')) return 'DELETE';
  if (normalized.startsWith('begin')) return 'BEGIN';
  if (normalized.startsWith('commit')) return 'COMMIT';
  if (normalized.startsWith('rollback')) return 'ROLLBACK';
  if (normalized.startsWith('create')) return 'CREATE';
  if (normalized.startsWith('alter')) return 'ALTER';
  if (normalized.startsWith('drop')) return 'DROP';

  return 'OTHER';
}

// Sanitize SQL for logging (remove potential sensitive data)
function sanitizeSql(sql: string): string {
  return sql
    .replace(/password\s*=\s*'[^']*'/gi, "password='***'")
    .replace(/token\s*=\s*'[^']*'/gi, "token='***'")
    .replace(/secret\s*=\s*'[^']*'/gi, "secret='***'")
    .substring(0, 500); // Limit length
}

// Add query to history with size limit
function addToHistory(query: InterceptedQuery): void {
  queryHistory.push(query);
  while (queryHistory.length > MAX_HISTORY_SIZE) {
    queryHistory.shift();
  }
}

// Delay helper
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Get proxy metrics
export function getProxyMetrics(): ProxyMetrics {
  return { ...metrics };
}

// Get query history
export function getQueryHistory(limit = 100): InterceptedQuery[] {
  return queryHistory.slice(-limit);
}

// Get queries by type
export function getQueriesByType(type: string, limit = 50): InterceptedQuery[] {
  const queryType = type.toUpperCase();
  return queryHistory
    .filter((q) => categorizeQuery(q.sql) === queryType)
    .slice(-limit);
}

// Get failed queries
export function getFailedQueries(limit = 50): InterceptedQuery[] {
  return queryHistory.filter((q) => q.error).slice(-limit);
}

// Reset metrics and history
export function resetProxyState(): void {
  queryHistory.length = 0;
  metrics.totalQueries = 0;
  metrics.totalLatencyInjected = 0;
  metrics.avgLatencyMs = 0;
  metrics.queriesByType = {};
  metrics.errorsByCode = {};
}

// Analyze query patterns
export function analyzeQueryPatterns(): {
  hotQueries: Array<{ sql: string; count: number }>;
  slowQueries: Array<{ sql: string; avgDuration: number }>;
  errorPatterns: Array<{ sql: string; errorRate: number }>;
} {
  // Group queries by normalized SQL
  const queryGroups = new Map<string, InterceptedQuery[]>();

  for (const query of queryHistory) {
    const normalized = normalizeQuery(query.sql);
    const group = queryGroups.get(normalized) || [];
    group.push(query);
    queryGroups.set(normalized, group);
  }

  // Find hot queries (most frequent)
  const hotQueries = Array.from(queryGroups.entries())
    .map(([sql, queries]) => ({ sql, count: queries.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Find slow queries (highest average duration)
  const slowQueries = Array.from(queryGroups.entries())
    .map(([sql, queries]) => {
      const durations = queries
        .filter((q) => q.endTime)
        .map((q) => q.endTime! - q.startTime);
      const avgDuration =
        durations.length > 0
          ? durations.reduce((a, b) => a + b, 0) / durations.length
          : 0;
      return { sql, avgDuration };
    })
    .sort((a, b) => b.avgDuration - a.avgDuration)
    .slice(0, 10);

  // Find error patterns
  const errorPatterns = Array.from(queryGroups.entries())
    .map(([sql, queries]) => {
      const errorCount = queries.filter((q) => q.error).length;
      const errorRate = queries.length > 0 ? errorCount / queries.length : 0;
      return { sql, errorRate };
    })
    .filter((p) => p.errorRate > 0)
    .sort((a, b) => b.errorRate - a.errorRate)
    .slice(0, 10);

  return { hotQueries, slowQueries, errorPatterns };
}

// Normalize SQL for grouping (remove specific values)
function normalizeQuery(sql: string): string {
  return sql
    .replace(/\$\d+/g, '$?') // Parameterized values
    .replace(/'[^']*'/g, "'?'") // String literals
    .replace(/\d+/g, '?') // Numbers
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
    .substring(0, 200);
}
