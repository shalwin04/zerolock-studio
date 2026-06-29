// POST /api/execute/stream - Execute with real-time SSE streaming
import { NextRequest } from 'next/server';
import { executeCode, ExecutionRequest } from '@/lib/sandbox/executor';
import { ChaosConfig, CHAOS_PRESETS } from '@/types/chaos';
import { subscribe } from '@/lib/dsql/monitor';
import { TelemetryEvent, TelemetryMetrics } from '@/types/telemetry';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ConnectionConfig {
  clusterEndpoint?: string;
  region?: string;
  database?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

interface ExecuteRequestBody {
  code: string;
  language?: 'typescript' | 'sql';
  chaosConfig?: Partial<ChaosConfig>;
  timeout?: number;
  connection?: ConnectionConfig;
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  // Parse request body
  let body: ExecuteRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Validate request
  if (!body.code || typeof body.code !== 'string') {
    return new Response(
      JSON.stringify({ error: 'Code is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Apply connection config
  if (body.connection?.clusterEndpoint) {
    process.env.AWS_DSQL_CLUSTER_ENDPOINT = body.connection.clusterEndpoint;
    if (body.connection.region) process.env.AWS_REGION = body.connection.region;
    if (body.connection.database) process.env.AWS_DSQL_DATABASE = body.connection.database;
    if (body.connection.accessKeyId) process.env.AWS_ACCESS_KEY_ID = body.connection.accessKeyId;
    if (body.connection.secretAccessKey) process.env.AWS_SECRET_ACCESS_KEY = body.connection.secretAccessKey;
  }

  if (!process.env.AWS_DSQL_CLUSTER_ENDPOINT) {
    return new Response(
      JSON.stringify({ error: 'DSQL not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Build chaos config
  const chaosConfig: ChaosConfig = { ...CHAOS_PRESETS.none, enabled: false };
  if (body.chaosConfig) {
    if (body.chaosConfig.chaosLevel && body.chaosConfig.chaosLevel !== 'none') {
      Object.assign(chaosConfig, CHAOS_PRESETS[body.chaosConfig.chaosLevel]);
    }
    if (body.chaosConfig.latencyMs !== undefined) chaosConfig.latencyMs = body.chaosConfig.latencyMs;
    if (body.chaosConfig.conflictProbability !== undefined) chaosConfig.conflictProbability = body.chaosConfig.conflictProbability;
    if (body.chaosConfig.concurrentThreads !== undefined) chaosConfig.concurrentThreads = body.chaosConfig.concurrentThreads;
    if (body.chaosConfig.enabled !== undefined) chaosConfig.enabled = body.chaosConfig.enabled;
    if (chaosConfig.latencyMs > 0 || chaosConfig.conflictProbability > 0) chaosConfig.enabled = true;
  }

  const executionRequest: ExecutionRequest = {
    code: body.code,
    language: body.language || 'typescript',
    chaosConfig,
    timeout: body.timeout,
  };

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const send = (eventType: string, data: unknown) => {
        try {
          const event = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(event));
        } catch {
          // Stream closed
        }
      };

      // Metrics tracking for real-time updates
      let totalTransactions = 0;
      let totalConflicts = 0;
      let totalRetries = 0;
      let totalLatency = 0;
      let completedCount = 0;
      const startTime = Date.now();

      // Send initial connection event
      send('connected', { timestamp: Date.now() });

      // Subscribe to transaction events
      const unsubscribe = subscribe((event: TelemetryEvent) => {
        // Send individual event
        send(event.type, event);

        // Update running metrics
        if (event.type === 'start') totalTransactions++;
        if (event.type === 'conflict') totalConflicts++;
        if (event.type === 'retry') totalRetries++;
        if (event.type === 'commit' || event.type === 'abort') {
          completedCount++;
          if ('totalMs' in event) totalLatency += event.totalMs;
        }

        // Send metrics update every few events
        if (completedCount > 0 && (completedCount % 3 === 0 || event.type === 'commit' || event.type === 'abort')) {
          const elapsed = (Date.now() - startTime) / 1000;
          const metrics: Partial<TelemetryMetrics> = {
            totalTransactions,
            totalConflicts,
            totalRetries,
            throughput: elapsed > 0 ? completedCount / elapsed : 0,
            conflictsPerSec: elapsed > 0 ? totalConflicts / elapsed : 0,
            avgLatencyMs: completedCount > 0 ? totalLatency / completedCount : 0,
            successRate: totalTransactions > 0 ? (totalTransactions - totalConflicts) / totalTransactions : 1,
            retryRate: totalTransactions > 0 ? totalRetries / totalTransactions : 0,
            committedCount: completedCount - totalConflicts,
            abortedCount: totalConflicts,
          };
          send('metrics', metrics);
        }
      });

      try {
        // Execute code
        const result = await executeCode(executionRequest);

        // Unsubscribe from events
        unsubscribe();

        // Calculate final metrics
        const finalDuration = Date.now() - startTime;
        const durationSec = finalDuration / 1000;

        // Calculate latency percentiles
        const latencies = result.events
          .filter(e => e.type === 'commit' || e.type === 'abort')
          .map(e => ('totalMs' in e ? e.totalMs : 0))
          .filter(l => l > 0)
          .sort((a, b) => a - b);

        const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : result.metrics.avgLatency;
        const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : result.metrics.avgLatency * 1.5;
        const p99 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.99)] : result.metrics.avgLatency * 2;

        // Calculate retry distribution
        const retryMap = new Map<number, number>();
        result.events
          .filter(e => e.type === 'retry')
          .forEach(e => {
            const attempt = 'attempt' in e ? e.attempt : 1;
            retryMap.set(attempt, (retryMap.get(attempt) || 0) + 1);
          });
        const retryDistribution = Array.from(retryMap.entries())
          .map(([attempts, count]) => ({ attempts, count }))
          .sort((a, b) => a.attempts - b.attempts);

        // Calculate conflict hotspots
        const hotspotMap = new Map<string, number>();
        result.events
          .filter(e => e.type === 'conflict')
          .forEach(e => {
            const key = 'key' in e ? (e.key || 'unknown') : 'unknown';
            hotspotMap.set(key, (hotspotMap.get(key) || 0) + 1);
          });
        const conflictHotspots = Array.from(hotspotMap.entries())
          .map(([key, count]) => ({ key, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);

        // Send final metrics
        const finalMetrics: Partial<TelemetryMetrics> = {
          conflictsPerSec: result.metrics.conflictCount / durationSec,
          avgLatencyMs: result.metrics.avgLatency,
          throughput: result.metrics.transactionCount / durationSec,
          successRate: result.metrics.transactionCount > 0
            ? (result.metrics.transactionCount - result.metrics.conflictCount) / result.metrics.transactionCount
            : 1,
          retryRate: result.metrics.transactionCount > 0
            ? result.metrics.retryCount / result.metrics.transactionCount
            : 0,
          p50LatencyMs: p50,
          p95LatencyMs: p95,
          p99LatencyMs: p99,
          totalTransactions: result.metrics.transactionCount,
          committedCount: result.metrics.transactionCount - result.metrics.conflictCount,
          abortedCount: result.metrics.conflictCount,
          totalConflicts: result.metrics.conflictCount,
          totalRetries: result.metrics.retryCount,
          totalDurationMs: finalDuration,
          avgTransactionMs: result.metrics.avgLatency,
          concurrentThreads: chaosConfig.concurrentThreads || 1,
          peakConcurrency: chaosConfig.concurrentThreads || 1,
          conflictHotspots,
          retryDistribution,
        };

        send('metrics', finalMetrics);

        // Send completion event
        send('done', {
          success: result.success,
          executionId: result.executionId,
          result: result.success ? {
            output: result.output,
            duration: result.metrics.duration,
            transactionCount: result.metrics.transactionCount,
            queryCount: result.metrics.queryCount,
            conflictCount: result.metrics.conflictCount,
            retryCount: result.metrics.retryCount,
            avgLatency: Math.round(result.metrics.avgLatency),
            rowsAffected: result.metrics.rowsAffected,
          } : undefined,
          error: result.error,
          finalMetrics,
          backoffData: result.backoffData,
        });

      } catch (error) {
        unsubscribe();
        send('error', {
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
