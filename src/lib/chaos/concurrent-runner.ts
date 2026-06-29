// Concurrent Transaction Runner for Zero-Lock Studio
// Spawns real parallel transactions against Aurora DSQL to generate actual conflicts

import { v4 as uuidv4 } from 'uuid';
import { Pool, PoolClient } from 'pg';
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import { ChaosConfig } from '@/types/chaos';
import { TelemetryEvent, BackoffDataPoint } from '@/types/telemetry';
import { parseDSQLError } from '@/types/dsql';

export interface ConcurrentRunConfig {
  threadCount: number;          // Number of parallel transactions
  targetKeys: string[];         // Keys to contend on
  operationType: 'transfer' | 'counter' | 'custom';
  iterations: number;           // How many times each thread runs
  chaosConfig: ChaosConfig;
}

export interface ConcurrentRunResult {
  runId: string;
  duration: number;
  threadResults: ThreadResult[];
  summary: {
    totalTransactions: number;
    successCount: number;
    failureCount: number;
    totalConflicts: number;
    totalRetries: number;
    avgLatencyMs: number;
    conflictRate: number;       // Percentage
    throughput: number;         // Transactions per second
  };
  events: TelemetryEvent[];
  backoffData: BackoffDataPoint[];
}

export interface ThreadResult {
  threadId: string;
  transactionCount: number;
  successCount: number;
  failureCount: number;
  conflictCount: number;
  retryCount: number;
  totalLatencyMs: number;
  errors: string[];
}

// Pool singleton
let pool: Pool | null = null;

async function getPool(): Promise<Pool> {
  if (pool) return pool;

  const hostname = process.env.AWS_DSQL_CLUSTER_ENDPOINT;
  const region = process.env.AWS_REGION || 'us-east-1';

  if (!hostname) {
    throw new Error('AWS_DSQL_CLUSTER_ENDPOINT not configured');
  }

  const signer = new DsqlSigner({ hostname, region });
  const token = await signer.getDbConnectAdminAuthToken();

  pool = new Pool({
    host: hostname,
    port: 5432,
    database: process.env.AWS_DSQL_DATABASE || 'postgres',
    user: 'admin',
    password: token,
    ssl: { rejectUnauthorized: true },
    max: 50, // Higher pool for concurrent testing
    idleTimeoutMillis: 30000,
  });

  return pool;
}

// Main concurrent execution function
export async function runConcurrentTransactions(
  config: ConcurrentRunConfig,
  onEvent?: (event: TelemetryEvent) => void
): Promise<ConcurrentRunResult> {
  const runId = `run_${uuidv4()}`;
  const startTime = Date.now();
  const events: TelemetryEvent[] = [];
  const backoffData: BackoffDataPoint[] = [];

  const emitEvent = (event: TelemetryEvent) => {
    events.push(event);
    onEvent?.(event);
  };

  const dbPool = await getPool();

  // Create threads
  const threadPromises: Promise<ThreadResult>[] = [];

  for (let i = 0; i < config.threadCount; i++) {
    const threadId = `thread_${i}`;
    threadPromises.push(
      runThread(
        dbPool,
        threadId,
        config,
        emitEvent,
        backoffData
      )
    );
  }

  // Run all threads concurrently
  const threadResults = await Promise.all(threadPromises);

  const duration = Date.now() - startTime;

  // Calculate summary
  const totalTransactions = threadResults.reduce((sum, t) => sum + t.transactionCount, 0);
  const successCount = threadResults.reduce((sum, t) => sum + t.successCount, 0);
  const failureCount = threadResults.reduce((sum, t) => sum + t.failureCount, 0);
  const totalConflicts = threadResults.reduce((sum, t) => sum + t.conflictCount, 0);
  const totalRetries = threadResults.reduce((sum, t) => sum + t.retryCount, 0);
  const totalLatency = threadResults.reduce((sum, t) => sum + t.totalLatencyMs, 0);

  return {
    runId,
    duration,
    threadResults,
    summary: {
      totalTransactions,
      successCount,
      failureCount,
      totalConflicts,
      totalRetries,
      avgLatencyMs: totalTransactions > 0 ? totalLatency / totalTransactions : 0,
      conflictRate: totalTransactions > 0 ? (totalConflicts / totalTransactions) * 100 : 0,
      throughput: duration > 0 ? (totalTransactions / duration) * 1000 : 0,
    },
    events,
    backoffData,
  };
}

// Run a single thread's transactions
async function runThread(
  dbPool: Pool,
  threadId: string,
  config: ConcurrentRunConfig,
  emitEvent: (event: TelemetryEvent) => void,
  backoffData: BackoffDataPoint[]
): Promise<ThreadResult> {
  const result: ThreadResult = {
    threadId,
    transactionCount: 0,
    successCount: 0,
    failureCount: 0,
    conflictCount: 0,
    retryCount: 0,
    totalLatencyMs: 0,
    errors: [],
  };

  for (let i = 0; i < config.iterations; i++) {
    const client = await dbPool.connect();
    const txnId = `${threadId}_txn_${i}`;

    try {
      const txnResult = await executeTransactionWithRetry(
        client,
        txnId,
        config,
        emitEvent,
        backoffData
      );

      result.transactionCount++;
      result.successCount++;
      result.conflictCount += txnResult.conflictCount;
      result.retryCount += txnResult.retryCount;
      result.totalLatencyMs += txnResult.latencyMs;
    } catch (error) {
      result.transactionCount++;
      result.failureCount++;
      result.errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      client.release();
    }
  }

  return result;
}

// Execute a single transaction with retry logic
async function executeTransactionWithRetry(
  client: PoolClient,
  txnId: string,
  config: ConcurrentRunConfig,
  emitEvent: (event: TelemetryEvent) => void,
  backoffData: BackoffDataPoint[]
): Promise<{
  success: boolean;
  conflictCount: number;
  retryCount: number;
  latencyMs: number;
}> {
  const MAX_RETRIES = 5;
  const BASE_DELAY = 50;
  const MAX_DELAY = 5000;

  let attempt = 0;
  let conflictCount = 0;
  const startTime = Date.now();

  emitEvent({ txnId, timestamp: Date.now(), type: 'start' });

  while (attempt <= MAX_RETRIES) {
    try {
      await client.query('BEGIN');

      // Inject latency if configured
      if (config.chaosConfig.enabled && config.chaosConfig.latencyMs > 0) {
        await sleep(config.chaosConfig.latencyMs);
      }

      // Execute based on operation type
      switch (config.operationType) {
        case 'transfer':
          await executeTransferOperation(client, config.targetKeys, txnId, emitEvent);
          break;
        case 'counter':
          await executeCounterOperation(client, config.targetKeys[0] || 'hot_counter', txnId, emitEvent);
          break;
        default:
          await client.query('SELECT 1');
      }

      // Maybe inject synthetic conflict
      if (config.chaosConfig.enabled && Math.random() * 100 < config.chaosConfig.conflictProbability) {
        throw { code: '40001', message: 'Synthetic conflict', severity: 'ERROR' };
      }

      await client.query('COMMIT');

      const latencyMs = Date.now() - startTime;
      emitEvent({
        txnId,
        timestamp: Date.now(),
        type: 'commit',
        totalMs: latencyMs,
        retryCount: attempt,
      });

      return {
        success: true,
        conflictCount,
        retryCount: attempt,
        latencyMs,
      };
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => {});

      if (error.code === '40001' && attempt < MAX_RETRIES) {
        conflictCount++;
        attempt++;

        emitEvent({
          txnId,
          timestamp: Date.now(),
          type: 'conflict',
          code: '40001',
          subcode: 'OC000',
          message: error.message,
        });

        // Full jitter exponential backoff
        const maxDelay = Math.min(MAX_DELAY, BASE_DELAY * Math.pow(2, attempt));
        const delay = Math.random() * maxDelay;

        backoffData.push({
          attempt,
          delayMs: delay,
          timestamp: Date.now(),
          txnId,
        });

        emitEvent({
          txnId,
          timestamp: Date.now(),
          type: 'retry',
          attempt,
          delayMs: delay,
          reason: error.message,
        });

        await sleep(delay);
        continue;
      }

      const latencyMs = Date.now() - startTime;
      emitEvent({
        txnId,
        timestamp: Date.now(),
        type: 'abort',
        totalMs: latencyMs,
        retryCount: attempt,
      });

      throw error;
    }
  }

  throw new Error('Max retries exceeded');
}

// Transfer operation - contends on account rows
async function executeTransferOperation(
  client: PoolClient,
  targetKeys: string[],
  txnId: string,
  emitEvent: (event: TelemetryEvent) => void
): Promise<void> {
  // Use provided keys or defaults
  const fromId = targetKeys[0] || '11111111-1111-1111-1111-111111111111';
  const toId = targetKeys[1] || '22222222-2222-2222-2222-222222222222';
  const amount = Math.floor(Math.random() * 100) + 1;

  // Lock both accounts
  const start = Date.now();
  await client.query(
    'SELECT id, balance FROM accounts WHERE id IN ($1, $2) FOR UPDATE',
    [fromId, toId]
  );
  emitEvent({
    txnId,
    timestamp: Date.now(),
    type: 'query',
    sql: 'SELECT...FOR UPDATE',
    durationMs: Date.now() - start,
  });

  // Transfer
  await client.query(
    'UPDATE accounts SET balance = balance - $1 WHERE id = $2',
    [amount, fromId]
  );
  await client.query(
    'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
    [amount, toId]
  );
}

// Counter operation - hot key contention
async function executeCounterOperation(
  client: PoolClient,
  counterId: string,
  txnId: string,
  emitEvent: (event: TelemetryEvent) => void
): Promise<void> {
  const start = Date.now();
  await client.query(
    `UPDATE counters SET value = value + 1, update_count = update_count + 1, last_updated_at = NOW() WHERE id = $1`,
    [counterId]
  );
  emitEvent({
    txnId,
    timestamp: Date.now(),
    type: 'query',
    sql: 'UPDATE counters',
    durationMs: Date.now() - start,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run a quick chaos test
export async function runQuickChaosTest(
  threads: number = 10,
  iterations: number = 5,
  operationType: 'transfer' | 'counter' = 'transfer'
): Promise<ConcurrentRunResult> {
  return runConcurrentTransactions({
    threadCount: threads,
    targetKeys: [
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ],
    operationType,
    iterations,
    chaosConfig: {
      enabled: true,
      latencyMs: 50,
      concurrentThreads: threads,
      conflictProbability: 0, // Let real conflicts happen
      chaosLevel: 'moderate',
    },
  });
}
